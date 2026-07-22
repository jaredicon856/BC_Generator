require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

const express = require('express');
const multer  = require('multer');
const path    = require('path');

const { generateBattlecard }        = require('./src/generator');
const { generatePitch }             = require('./src/pitchGenerator');
const { generatePDF }               = require('./src/pdfExport');
// Fathom webhook pipeline (Authority Deck → Battlecard → Slack + voice)
const { generateAuthorityDeck }     = require('./src/authorityDeckGenerator');
const { generateAuthorityDeckPDF }  = require('./src/authorityDeckPdf');
const { generateVoiceSummary }      = require('./src/voiceSummary');
const store                         = require('./src/store');
const slack                         = require('./src/slack');
const { waitUntil }                 = require('@vercel/functions');
// Client Strategy Studio (Authority Codex extract/assemble + memory + prompts)
const { extractDeck, assembleDeck } = require('./src/authorityDeck');
const prompts                       = require('./src/prompts');
const memory                        = require('./src/memory');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Password gate ──────────────────────────────────────
// Protects the API (which spends Anthropic credits) behind a shared access
// code. Set APP_PASSWORD in the environment to enable. If unset, the gate is
// disabled — convenient for local dev, but never deploy publicly without it.
const APP_PASSWORD = process.env.APP_PASSWORD || '';
app.use('/api', (req, res, next) => {
  // The Fathom webhook authenticates with its own x-webhook-secret header
  // (checked inside its own route handler) -- it's called by Zapier/Make,
  // not a browser with the access code, so it's exempt from this gate.
  if (req.path === '/webhook/fathom') return next();
  if (!APP_PASSWORD) return next();
  const provided = req.get('x-access-code') || '';
  if (provided === APP_PASSWORD) return next();
  return res.status(401).json({ ok: false, error: 'Invalid or missing access code' });
});

// ── SSE helpers ────────────────────────────────────────
function startSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // prevent nginx/proxy buffering
  res.flushHeaders();
}

function sseEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── Fathom webhook helpers ──────────────────────────────
// Expects the meeting title to contain the words "strategy call" plus
// either "1"/"one" or "2"/"two" -- e.g. "Strategy Call 1 -- Acme Corp".
// Returns 1, 2, or 'unknown'.
function detectCallPhase(title) {
  const t = String(title || '').toLowerCase();
  if (!t.includes('strategy call')) return 'unknown';
  // Real calendar convention has no marker at all on Call 1 (e.g. "ICON
  // Podcast Strategy Call", "ICON Podcast Strategy Call with Justin Heuff")
  // and "Part 2" / "2" / "two" explicitly on Call 2 (e.g. "ICON Podcast
  // Strategy Call Part 2 with Justin Heuff"). Treat any explicit Part-2-style
  // marker as phase 2, an explicit Part-1-style marker as phase 1, and no
  // marker at all as phase 1 by default (it's the first call in the series).
  if (/\bpart\s*2\b/.test(t) || /\b(2|two)\b/.test(t)) return 2;
  if (/\bpart\s*1\b/.test(t) || /\b(1|one)\b/.test(t)) return 1;
  return 1;
}

// Store keys need to be exact-match stable across Call 1 and Call 2. A
// typed/displayed name can drift (capitalization, nicknames, whitespace) --
// an email address copied straight from Fathom's attendee data doesn't.
// Always normalize whatever identifier is used as the lookup key.
function normalizeKey(s) {
  return String(s || '').trim().toLowerCase();
}


// ── POST /api/generate ─────────────────────────────────
app.post('/api/generate', upload.single('figmaPdf'), async (req, res) => {
  startSSE(res);
  try {
    let offers = [];
    try { offers = req.body.offers ? JSON.parse(req.body.offers) : []; } catch (_) {}

    const inputs = {
      clientName:      req.body.clientName      || '',
      podcastName:     req.body.podcastName     || '',
      niche:           req.body.niche           || '',
      geography:       req.body.geography       || 'North America',
      idealBuyer:      req.body.idealBuyer      || '',
      referralPartners:req.body.referralPartners|| '',
      transcript:      req.body.transcript      || '',
      icpListNeeded:   req.body.icpListNeeded === 'true',
      offers,
      figmaPdf: req.file ? req.file.buffer.toString('base64') : null,
      authorityDeck:   req.body.authorityDeck   || '',
    };

    const battlecard = await generateBattlecard(inputs, (tokens) => sseEvent(res, 'progress', { tokens }));
    sseEvent(res, 'done', { battlecard });
  } catch (err) {
    console.error('[/api/generate]', err.message);
    sseEvent(res, 'error', { error: err.message });
  } finally {
    res.end();
  }
});

// ── POST /api/generate-pitch ───────────────────────────
app.post('/api/generate-pitch', async (req, res) => {
  startSSE(res);
  try {
    const pitch = await generatePitch(req.body, (tokens) => sseEvent(res, 'progress', { tokens }));
    sseEvent(res, 'done', { pitch });
  } catch (err) {
    console.error('[/api/generate-pitch]', err.message);
    sseEvent(res, 'error', { error: err.message });
  } finally {
    res.end();
  }
});

// ── POST /api/webhook/fathom ────────────────────────────
// Called by Zapier/Make's "Webhooks by Zapier/Make" action, triggered off
// Fathom's "New Transcript" / "New AI Summary" trigger. Expects JSON body:
//   { meetingTitle, clientName, transcript, recordingId, presentedDate }
// meetingTitle must contain "Strategy Call 1" or "Strategy Call 2" (case-
// insensitive, "one"/"two" also accepted) so the handler knows which phase
// to run. clientName is required explicitly -- we don't try to parse a
// client name out of the title, too unreliable across naming conventions.
app.post('/api/webhook/fathom', async (req, res) => {
  const providedSecret = req.get('x-webhook-secret') || '';
  if (!process.env.FATHOM_WEBHOOK_SECRET || providedSecret !== process.env.FATHOM_WEBHOOK_SECRET) {
    return res.status(401).json({ ok: false, error: 'Invalid or missing webhook secret' });
  }

  const { meetingTitle, clientName, clientKey, transcript, recordingId, presentedDate } = req.body || {};

  if (!meetingTitle || !clientName || !transcript) {
    return res.status(400).json({ ok: false, error: 'meetingTitle, clientName, and transcript are required' });
  }

  // clientKey should be the client's email from Fathom's attendee data --
  // stable across both calls. Falls back to a normalized clientName if no
  // email is available, but that's the less reliable option (see
  // normalizeKey comment above).
  const storeKey = normalizeKey(clientKey || clientName);

  // Express 4 doesn't auto-catch rejected promises in async route handlers,
  // so this dedupe check (a real network call to Redis) needs its own
  // try/catch -- otherwise a transient Redis error here would just hang
  // the request instead of returning a clean 500.
  let alreadyProcessed = false;
  try {
    alreadyProcessed = recordingId ? await store.has(`processed:${recordingId}`) : false;
  } catch (err) {
    console.error('[webhook/fathom] Dedupe check failed:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
  if (alreadyProcessed) {
    return res.json({ ok: true, skipped: true, reason: 'recording already processed' });
  }

  const phase = detectCallPhase(meetingTitle);
  if (phase === 'unknown') {
    console.warn(`[webhook/fathom] Could not detect call phase from title: "${meetingTitle}" -- skipping`);
    return res.json({ ok: true, skipped: true, reason: 'title did not match "Strategy Call 1/2" pattern' });
  }

  // Respond to Zapier/Make right away -- Claude generation + PDF rendering
  // can take well past what a webhook client is willing to wait for. The
  // actual work happens in processFathomCall below, registered with
  // waitUntil so Vercel explicitly keeps this invocation alive until that
  // promise settles (up to maxDuration). Just not awaiting it before
  // responding is NOT sufficient on Vercel -- the platform can freeze the
  // execution environment right after the response is sent otherwise, with
  // no error thrown. waitUntil is the actual supported mechanism for this.
  res.json({ ok: true, accepted: true, phase, clientName, storeKey });

  waitUntil(
    processFathomCall({ phase, clientName, storeKey, transcript, presentedDate, recordingId }).catch((err) => {
      console.error('[webhook/fathom] Background processing failed:', err.message);
    })
  );
});

async function processFathomCall({ phase, clientName, storeKey, transcript, presentedDate, recordingId }) {
  if (recordingId) await store.set(`processed:${recordingId}`, true);

  if (phase === 1) {
    const authorityDeck = await generateAuthorityDeck({ clientName, transcript, presentedDate });
    await store.set(`authorityDeck:${storeKey}`, authorityDeck);
    const pdfBytes = await generateAuthorityDeckPDF(authorityDeck);
    console.log(`[webhook/fathom] Phase 1 complete for "${clientName}" (key: ${storeKey}), PDF ${pdfBytes.length} bytes`);

    const authorityChannel = process.env.SLACK_CHANNEL_AUTHORITY_DECK || process.env.SLACK_CHANNEL_ID;
    if (authorityChannel) {
      try {
        await slack.uploadFile(
          authorityChannel,
          Buffer.from(pdfBytes),
          `${clientName} - Authority Deck.pdf`,
          `<!channel> :page_facing_up: *Phase 1 complete* -- Authority Deck ready for *${clientName}* (key: ${storeKey})`
        );
      } catch (slackErr) {
        console.error('[webhook/fathom] Slack Authority Deck upload failed:', slackErr.message);
      }

      try {
        const voiceBuffer = await generateVoiceSummary(transcript);
        await slack.uploadFile(
          authorityChannel,
          voiceBuffer,
          `${clientName} - Call 1 Recap.mp3`,
          `<!channel> :studio_microphone: *Phase 1* -- Call 1 recap for *${clientName}*`
        );
      } catch (voiceErr) {
        console.error('[webhook/fathom] Voice summary (Call 1) failed:', voiceErr.message);
      }
    } else {
      console.warn('[webhook/fathom] No SLACK_CHANNEL_AUTHORITY_DECK / SLACK_CHANNEL_ID set -- Authority Deck generated but not delivered anywhere.');
    }
    return;
  }

  // phase === 2
  const authorityDeck = await store.get(`authorityDeck:${storeKey}`);
  const battlecardChannel = process.env.SLACK_CHANNEL_BATTLECARD || process.env.SLACK_CHANNEL_ID;

  if (!authorityDeck) {
    console.error(`[webhook/fathom] No stored Authority Deck for key "${storeKey}" (clientName: "${clientName}") -- Call 2 fired before Call 1 completed, or the clientKey/clientName didn't match between calls.`);
    if (battlecardChannel) {
      try {
        await slack.postMessage(
          battlecardChannel,
          `<!channel> :warning: *Phase 2* -- Generating the Battlecard for *${clientName}* with no stored Authority Deck found -- Call 1 may not have completed, or the client key didn't match between calls. Proceeding anyway, but double-check this one.`
        );
      } catch (slackErr) {
        console.error('[webhook/fathom] Slack alert (missing Authority Deck) failed:', slackErr.message);
      }
    }
  }

  const battlecard = await generateBattlecard({ clientName, transcript, authorityDeck });
  const pdfBytes = await generatePDF(battlecard);
  console.log(`[webhook/fathom] Phase 2 complete for "${clientName}" (key: ${storeKey}), PDF ${pdfBytes.length} bytes, missingAuthorityDeck=${!authorityDeck}`);

  if (battlecardChannel) {
    try {
      await slack.uploadFile(
        battlecardChannel,
        Buffer.from(pdfBytes),
        `${clientName} - Battlecard.pdf`,
        `<!channel> :dart: *Phase 2 complete* -- Battlecard ready for *${clientName}* (key: ${storeKey})`
      );
    } catch (slackErr) {
      console.error('[webhook/fathom] Slack Battlecard upload failed:', slackErr.message);
    }

    try {
      const voiceBuffer = await generateVoiceSummary(transcript);
      await slack.uploadFile(
        battlecardChannel,
        voiceBuffer,
        `${clientName} - Call 2 Recap.mp3`,
        `<!channel> :studio_microphone: *Phase 2* -- Call 2 recap for *${clientName}*`
      );
    } catch (voiceErr) {
      console.error('[webhook/fathom] Voice summary (Call 2) failed:', voiceErr.message);
    }
  } else {
    console.warn('[webhook/fathom] No SLACK_CHANNEL_BATTLECARD / SLACK_CHANNEL_ID set -- Battlecard generated but not delivered anywhere.');
  }
}

// ── POST /api/generate-authority-deck ──────────────────
app.post('/api/generate-authority-deck', async (req, res) => {
  startSSE(res);
  try {
    let offers = [];
    try { offers = req.body.offers ? JSON.parse(req.body.offers) : []; } catch (_) {}

    const inputs = {
      clientName:       req.body.clientName       || '',
      podcastName:      req.body.podcastName      || '',
      niche:            req.body.niche            || '',
      geography:        req.body.geography        || 'North America',
      idealBuyer:       req.body.idealBuyer       || '',
      referralPartners: req.body.referralPartners || '',
      transcript:       req.body.transcript       || '',
      presentedDate:    req.body.presentedDate    || '',
      offers,
    };

    const authorityDeck = await generateAuthorityDeck(inputs, (tokens) => sseEvent(res, 'progress', { tokens }));
    sseEvent(res, 'done', { authorityDeck });
  } catch (err) {
    console.error('[/api/generate-authority-deck]', err.message);
    sseEvent(res, 'error', { error: err.message });
  } finally {
    res.end();
  }
});

// ── POST /api/export-authority-pdf ─────────────────────
app.post('/api/export-authority-pdf', async (req, res) => {
  try {
    const { authorityDeck } = req.body;
    if (!authorityDeck) return res.status(400).json({ ok: false, error: 'authorityDeck required' });

    const pdfBytes = await generateAuthorityDeckPDF(authorityDeck);
    const clientSlug = (authorityDeck.meta?.clientName || 'authority-deck')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${clientSlug}-authority-deck.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('[/api/export-authority-pdf]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/generate-voice-summary ───────────────────
// "Jarvis" step — converts a call recap (e.g. Fathom's summary text) into an
// MP3 voice note via OpenAI TTS. Returns raw audio so the caller (webhook
// handler / Slack upload step) can post it directly.
app.post('/api/generate-voice-summary', async (req, res) => {
  try {
    const { text, voice, model } = req.body;
    if (!text) return res.status(400).json({ ok: false, error: 'text required' });

    const audioBuffer = await generateVoiceSummary(text, { voice, model });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="call-summary.mp3"');
    res.send(audioBuffer);
  } catch (err) {
    console.error('[/api/generate-voice-summary]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/export-pdf ───────────────────────────────
app.post('/api/export-pdf', async (req, res) => {
  try {
    const { battlecard, pitch } = req.body;
    if (!battlecard) return res.status(400).json({ ok: false, error: 'battlecard required' });

    const pdfBytes  = await generatePDF(battlecard, {}, pitch || null);
    const clientSlug = (battlecard.meta?.clientName || 'podcast-strategy-guide')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${clientSlug}-podcast-strategy-guide.pdf"`);
    res.send(Buffer.from(pdfBytes)); // pdfBytes is Uint8Array — Buffer.from is zero-copy
  } catch (err) {
    console.error('[/api/export-pdf]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Authority Codex (Stage 1) ──────────────────────────
// POST /api/authority/extract  → transcript → review-ready JSON (SSE)
app.post('/api/authority/extract', async (req, res) => {
  startSSE(res);
  try {
    const extraction = await extractDeck(req.body || {}, (t) => sseEvent(res, 'progress', { tokens: t }));
    sseEvent(res, 'done', { extraction });
  } catch (err) {
    console.error('[/api/authority/extract]', err.message);
    sseEvent(res, 'error', { error: err.message });
  } finally {
    res.end();
  }
});

// POST /api/authority/generate → confirmed JSON → markdown deck, auto-saved (SSE)
app.post('/api/authority/generate', async (req, res) => {
  startSSE(res);
  try {
    const { extraction, client, package: pkg, customDeliverables } = req.body || {};
    if (!extraction) throw new Error('extraction JSON is required');
    const markdown = await assembleDeck(extraction, pkg, customDeliverables, (t) => sseEvent(res, 'progress', { tokens: t }));
    // memory.save writes to local disk (data/decks) — on Vercel's read-only
    // serverless filesystem this throws. A failed save must not kill an
    // otherwise-successful generation: return the deck, flag saved as null.
    let saved = null;
    try {
      saved = memory.save({
        email:    (client && client.email) || '',
        name:     (client && client.name)  || (extraction.client && extraction.client.name) || '',
        docType:  'authority_deck',
        package:  pkg || '',
        json:     extraction,
        markdown,
      });
    } catch (saveErr) {
      console.warn('[/api/authority/generate] Deck generated but not persisted:', saveErr.message);
    }
    sseEvent(res, 'done', {
      markdown,
      saved: saved ? { key: saved.key, name: saved.name, email: saved.email, updatedAt: saved.updatedAt } : null,
    });
  } catch (err) {
    console.error('[/api/authority/generate]', err.message);
    sseEvent(res, 'error', { error: err.message });
  } finally {
    res.end();
  }
});

// ── Memory bank ────────────────────────────────────────
app.get('/api/memory', (req, res) => {
  res.json({ ok: true, decks: memory.list() });
});

// Lookup for Stage 2 (define BEFORE /:key so "find" isn't captured as a key).
app.get('/api/memory/find', (req, res) => {
  const r = memory.findByClient(req.query.email || '', req.query.name || '');
  res.json({
    ok: true,
    deck: r ? { key: r.key, name: r.name, email: r.email, docType: r.docType, updatedAt: r.updatedAt, json: r.json, markdown: r.markdown } : null,
  });
});

app.get('/api/memory/:key', (req, res) => {
  const r = memory.get(req.params.key);
  if (!r) return res.status(404).json({ ok: false, error: 'Deck not found' });
  res.json({ ok: true, deck: r });
});

app.delete('/api/memory/:key', (req, res) => {
  res.json({ ok: memory.remove(req.params.key) });
});

// ── Prompt settings (the AI logic behind each tab) ─────
// GET    /api/prompts                 → all groups + cards (values + defaults)
// PUT    /api/prompts/card/:id        → save { text?, model?, maxTokens? }
// POST   /api/prompts/card/:id/reset  → restore that card's defaults
app.get('/api/prompts', (req, res) => {
  res.json({ ok: true, ...prompts.getAll() });
});

app.put('/api/prompts/card/:id', (req, res) => {
  try {
    const card = prompts.save(req.params.id, req.body || {});
    res.json({ ok: true, card });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/prompts/card/:id/reset', (req, res) => {
  try {
    const card = prompts.reset(req.params.id);
    res.json({ ok: true, card });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Only start a listener when run directly (local dev / `npm start`).
// On Vercel the app is imported as a serverless handler (see api/index.js).
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Podcast Battlecard running at http://localhost:${PORT}\n`);
  });
}

module.exports = app;
