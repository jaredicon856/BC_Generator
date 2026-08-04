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
const { markdownToPdf }             = require('./src/mdPdf');
const { pushDocumentsToSalesApp, fetchClientPackage } = require('./src/salesApp');
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

// Prompt overrides load asynchronously from Redis on cold start; make sure
// they're in the cache before any handler builds a system prompt. Resolved
// promise after first load, so this is effectively free per-request.
app.use('/api', async (req, res, next) => {
  try { await prompts.ready(); } catch (_) {}
  next();
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
  // Calendar convention: Call 1 has NO marker ("ICON Podcast Strategy Call",
  // "... with Justin Heuff"); Call 2 has an explicit "Part 2" ("... Strategy
  // Call Part 2 with Justin Heuff"). Match ONLY an explicit part-2 marker --
  // never a stray "2" elsewhere in the title (a date, a time, "2.0"), which
  // would wrongly classify a real Call 1 as phase 2 and, now that phase 2 is
  // a no-op, silently skip it. Everything else that is a strategy call is
  // Call 1.
  if (/\bpart\s*(2|two)\b/.test(t)) return 2;
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
app.post('/api/generate', upload.fields([{ name: 'figmaPdf', maxCount: 1 }, { name: 'authorityDeckPdf', maxCount: 1 }, { name: 'ancillaryDocs', maxCount: 10 }]), async (req, res) => {
  startSSE(res);
  try {
    let offers = [];
    try { offers = req.body.offers ? JSON.parse(req.body.offers) : []; } catch (_) {}

    const figmaFile = req.files?.figmaPdf?.[0];
    const authorityDeckFile = req.files?.authorityDeckPdf?.[0];
    const ancillaryFiles = req.files?.ancillaryDocs || [];

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
      figmaPdf: figmaFile ? figmaFile.buffer.toString('base64') : null,
      authorityDeck:   req.body.authorityDeck   || '',
      authorityDeckPdf: authorityDeckFile ? authorityDeckFile.buffer.toString('base64') : null,
      ancillaryDocs: ancillaryFiles.map(f => ({
        name: f.originalname,
        isPdf: /\.pdf$/i.test(f.originalname),
        base64: f.buffer.toString('base64'),
        text: /\.pdf$/i.test(f.originalname) ? null : f.buffer.toString('utf8'),
      })),
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
// ── POST /api/simulate-call ─────────────────────────────
// Manually trigger the full Strategy Call 1 package (Authority Codex +
// Podcast Strategy Guide + voice recap -> Slack) without a Fathom webhook.
// Gated by the normal APP_PASSWORD access code (this route is NOT exempt like
// /webhook/fathom), so it needs no Fathom secret. Useful for testing the
// pipeline and for manually re-running a client whose real webhook failed.
app.post('/api/simulate-call', async (req, res) => {
  const { clientName, clientKey, transcript, presentedDate, package: packageOverride, customDeliverables } = req.body || {};
  if (!clientName || !transcript) {
    return res.status(400).json({ ok: false, error: 'clientName and transcript are required' });
  }
  const storeKey = normalizeKey(clientKey || clientName);
  res.json({ ok: true, accepted: true, clientName, storeKey, note: 'Generating the full Call 1 package -> Slack. This takes a few minutes.' });
  waitUntil(
    processFathomCall({ clientName, clientKey, storeKey, transcript, presentedDate, recordingId: null, packageOverride, customDeliverables }).catch((err) => {
      console.error('[simulate-call] Background processing failed:', err.message);
    })
  );
});

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
  if (phase !== 1) {
    // Strategy Call 1 now produces the FULL package (Authority Codex +
    // Podcast Strategy Guide + voice recap), so Strategy Call 2 automation is
    // retired. A "Part 2" meeting (phase 2) is acknowledged and skipped, as
    // is any title that isn't an "ICON Podcast Strategy Call".
    const reason = phase === 2
      ? 'Strategy Call 2 automation retired -- the full package is delivered at Call 1'
      : 'title did not match the "ICON Podcast Strategy Call" pattern';
    console.log(`[webhook/fathom] Skipping "${meetingTitle}" (phase ${phase}): ${reason}`);
    return res.json({ ok: true, skipped: true, reason });
  }

  // Respond to Zapier/Make right away -- Claude generation + PDF rendering
  // can take well past what a webhook client is willing to wait for. The
  // actual work happens in processFathomCall below, registered with
  // waitUntil so Vercel explicitly keeps this invocation alive until that
  // promise settles (up to maxDuration). Just not awaiting it before
  // responding is NOT sufficient on Vercel -- the platform can freeze the
  // execution environment right after the response is sent otherwise, with
  // no error thrown. waitUntil is the actual supported mechanism for this.
  res.json({ ok: true, accepted: true, phase: 1, clientName, storeKey });

  waitUntil(
    processFathomCall({ clientName, clientKey, storeKey, transcript, presentedDate, recordingId }).catch((err) => {
      console.error('[webhook/fathom] Background processing failed:', err.message);
    })
  );
});

// Strategy Call 1 -> the full client package, all delivered to one Slack
// channel (authority_codex_delivery via SLACK_CHANNEL_AUTHORITY_DECK):
//   1) Authority Codex (PDF)
//   2) Podcast Strategy Guide / Battlecard (PDF) -- ICP list ALWAYS on, the
//      referral pitch ALWAYS built, and the codex fed in as context
//   3) Voice meeting summary (mp3)
// Every delivery step is independently try/caught: one failure never blocks
// the others.
async function processFathomCall({ clientName, clientKey, storeKey, transcript, presentedDate, recordingId, packageOverride, customDeliverables }) {
  if (recordingId) await store.set(`processed:${recordingId}`, true);

  const channel = process.env.SLACK_CHANNEL_AUTHORITY_DECK || process.env.SLACK_CHANNEL_ID;

  // The voice recap only needs the transcript -- start it now, concurrently
  // with the (slower) document generation.
  const voicePromise = generateVoiceSummary(transcript).catch((err) => {
    console.error('[webhook/fathom] Voice summary failed:', err.message);
    return null;
  });

  // 1) Authority Codex ------------------------------------------------------
  // Scope the codex to the client's PACKAGE (looked up from the sales app) so
  // Accelerator/Ecosystem clients get the Book/Stage/Community sections. When
  // the package is known, use the package-scoped Studio generator (extract →
  // assemble → PDF). When it can't be determined, fall back to the original
  // podcast-funnel generator so there's no regression.
  let pkg = packageOverride || null;
  if (!pkg) {
    try { pkg = await fetchClientPackage(clientKey); }
    catch (e) { console.warn('[webhook/fathom] Package lookup failed:', e.message); }
  }
  const VALID_PACKAGES = ['ecosystem', 'accelerator', 'podcast', 'custom'];

  let codexPdf, authorityDeck, codexJson, codexMarkdown, codexPackage;
  if (VALID_PACKAGES.includes(pkg)) {
    const extraction = await extractDeck({ clientName, clientEmail: clientKey || '', presentedDate, transcript, package: pkg, customDeliverables: customDeliverables || '' });
    codexMarkdown = await assembleDeck(extraction, pkg, customDeliverables || '');
    codexPdf      = await markdownToPdf(codexMarkdown);
    authorityDeck = codexMarkdown;   // battlecard context (markdown)
    codexJson     = extraction;
    codexPackage  = pkg;
    console.log(`[webhook/fathom] Codex via package-scoped Studio generator (package=${pkg})`);
  } else {
    const deck    = await generateAuthorityDeck({ clientName, transcript, presentedDate });
    codexPdf      = await generateAuthorityDeckPDF(deck);
    authorityDeck = deck;            // battlecard context (object)
    codexJson     = deck;
    codexMarkdown = '';
    codexPackage  = '';
    console.log(`[webhook/fathom] Codex via fallback podcast-funnel generator (package=${pkg || 'unknown'})`);
  }

  await store.set(`authorityDeck:${storeKey}`, authorityDeck);
  try {
    await memory.save({ email: clientKey || '', name: clientName, docType: 'authority_deck', package: codexPackage, json: codexJson, markdown: codexMarkdown });
  } catch (memErr) {
    console.warn('[webhook/fathom] Could not save codex to Studio Memory Bank:', memErr.message);
  }

  // 2) Podcast Strategy Guide (battlecard) ----------------------------------
  // ICP list is forced on for the automated flow, and the codex is passed as
  // authoritative context (same continuity the retired Call 2 used to give).
  const battlecard = await generateBattlecard({ clientName, transcript, authorityDeck, icpListNeeded: true });

  // 3) Referral pitch -- always built (AI Brain mode), from the battlecard.
  // Folded into the guide PDF. Non-fatal: a failed pitch just omits it.
  let pitch = null;
  try {
    pitch = await generatePitch({
      pitchMode: 'ai',
      hostName: clientName,
      podcastName: battlecard.meta?.podcastName || '',
      niche:      battlecard.meta?.niche || '',
      geography:  battlecard.meta?.geography || 'North America',
      offerStack: battlecard.offerStack || [],
      irpList:    battlecard.irpList || {},
      idealClientDescription: '',
    });
  } catch (pitchErr) {
    console.warn('[webhook/fathom] Referral pitch failed, guide will omit it:', pitchErr.message);
  }
  const guidePdf = await generatePDF(battlecard, {}, pitch);

  const voiceBuffer = await voicePromise;
  console.log(`[webhook/fathom] Call 1 package for "${clientName}" (key: ${storeKey}): codex ${codexPdf.length}B, guide ${guidePdf.length}B, voice ${voiceBuffer ? voiceBuffer.length + 'B' : 'none'}, pitch ${pitch ? 'yes' : 'no'}`);

  // Push the two PDFs to the ICON sales app to attach under the client profile
  // (matched by email). Non-fatal; attaches to existing clients only.
  try {
    const salesRes = await pushDocumentsToSalesApp({
      clientEmail: clientKey || '',
      clientName,
      documents: [
        { type: 'authority_codex',         filename: `${clientName} - Authority Codex.pdf`,        bytes: codexPdf },
        { type: 'podcast_strategy_guide',  filename: `${clientName} - Podcast Strategy Guide.pdf`, bytes: guidePdf },
      ],
    });
    if (salesRes) {
      console.log(`[sales-app] ${salesRes.attached ? `attached ${salesRes.stored?.length || 0} doc(s) to client ${salesRes.clientId}` : `not attached (${salesRes.reason})`}`);
    }
  } catch (salesErr) {
    console.error('[sales-app] Document push failed:', salesErr.message);
  }

  if (!channel) {
    console.warn('[webhook/fathom] No SLACK_CHANNEL_AUTHORITY_DECK / SLACK_CHANNEL_ID set -- package generated but not delivered anywhere.');
    return;
  }

  try {
    await slack.uploadFile(channel, Buffer.from(codexPdf), `${clientName} - Authority Codex.pdf`,
      `<!channel> :page_facing_up: *Strategy Call 1 complete* -- Authority Codex for *${clientName}*`);
  } catch (e) { console.error('[webhook/fathom] Slack codex upload failed:', e.message); }

  try {
    await slack.uploadFile(channel, Buffer.from(guidePdf), `${clientName} - Podcast Strategy Guide.pdf`,
      `:dart: *Podcast Strategy Guide* for *${clientName}* -- ICP list + referral pitch included`);
  } catch (e) { console.error('[webhook/fathom] Slack guide upload failed:', e.message); }

  if (voiceBuffer) {
    try {
      await slack.uploadFile(channel, voiceBuffer, `${clientName} - Call 1 Recap.mp3`,
        `:studio_microphone: *Call 1 voice recap* for *${clientName}*`);
    } catch (e) { console.error('[webhook/fathom] Slack voice upload failed:', e.message); }
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
    // memory.save persists to Upstash Redis on Vercel (local files in dev).
    // Defense-in-depth: a failed save must not kill an otherwise-successful
    // generation — return the deck anyway, flag saved as null.
    let saved = null;
    try {
      saved = await memory.save({
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

    // Bridge: mirror the deck into the webhook pipeline's store so a Fathom
    // "Strategy Call 2" webhook finds it even though Call 1 happened in the
    // Studio. Same key convention as the webhook (normalized email, falling
    // back to name). generateBattlecard accepts the markdown string directly.
    const bridgeName  = (client && client.name)  || (extraction.client && extraction.client.name) || '';
    const bridgeEmail = (client && client.email) || '';
    const bridgeKey   = normalizeKey(bridgeEmail || bridgeName);
    if (bridgeKey) {
      try {
        await store.set(`authorityDeck:${bridgeKey}`, markdown);
      } catch (storeErr) {
        console.warn('[/api/authority/generate] Could not mirror deck for webhook Call 2:', storeErr.message);
      }
    }

    // Bridge: announce Studio-generated codexes in Slack, same channel and
    // style as the webhook pipeline. Attach a rendered PDF; fall back to the
    // raw markdown if PDF rendering fails. Non-fatal either way.
    const studioDeckChannel = process.env.SLACK_CHANNEL_AUTHORITY_DECK || process.env.SLACK_CHANNEL_ID;
    if (studioDeckChannel) {
      const comment = `<!channel> :page_facing_up: *Authority Codex generated in the Studio* for *${bridgeName || bridgeKey}*${saved ? ` (Memory Bank: ${saved.key})` : ''}`;
      try {
        let fileBuffer, fileName;
        try {
          const pdfBytes = await markdownToPdf(markdown);
          fileBuffer = Buffer.from(pdfBytes);
          fileName   = `${bridgeName || 'Client'} - Authority Codex.pdf`;
        } catch (pdfErr) {
          console.warn('[/api/authority/generate] PDF render failed, sending markdown instead:', pdfErr.message);
          fileBuffer = Buffer.from(markdown, 'utf8');
          fileName   = `${bridgeName || 'Client'} - Authority Codex.md`;
        }
        await slack.uploadFile(studioDeckChannel, fileBuffer, fileName, comment);
      } catch (slackErr) {
        console.warn('[/api/authority/generate] Slack delivery failed:', slackErr.message);
      }
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
// memory.* is async (Upstash Redis on Vercel, local files in dev). Express 4
// doesn't catch rejected promises in async handlers, so each one try/catches.
app.get('/api/memory', async (req, res) => {
  try {
    res.json({ ok: true, decks: await memory.list() });
  } catch (err) {
    console.error('[/api/memory]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Lookup for Stage 2 (define BEFORE /:key so "find" isn't captured as a key).
app.get('/api/memory/find', async (req, res) => {
  try {
    const r = await memory.findByClient(req.query.email || '', req.query.name || '');
    res.json({
      ok: true,
      deck: r ? { key: r.key, name: r.name, email: r.email, docType: r.docType, updatedAt: r.updatedAt, json: r.json, markdown: r.markdown } : null,
    });
  } catch (err) {
    console.error('[/api/memory/find]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/memory/:key', async (req, res) => {
  try {
    const r = await memory.get(req.params.key);
    if (!r) return res.status(404).json({ ok: false, error: 'Deck not found' });
    res.json({ ok: true, deck: r });
  } catch (err) {
    console.error('[/api/memory/:key]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/memory/:key', async (req, res) => {
  try {
    res.json({ ok: await memory.remove(req.params.key) });
  } catch (err) {
    console.error('[DELETE /api/memory/:key]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Prompt settings (the AI logic behind each tab) ─────
// GET    /api/prompts                 → all groups + cards (values + defaults)
// PUT    /api/prompts/card/:id        → save { text?, model?, maxTokens? }
// POST   /api/prompts/card/:id/reset  → restore that card's defaults
app.get('/api/prompts', (req, res) => {
  res.json({ ok: true, ...prompts.getAll() });
});

app.put('/api/prompts/card/:id', async (req, res) => {
  try {
    const card = await prompts.save(req.params.id, req.body || {});
    res.json({ ok: true, card });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post('/api/prompts/card/:id/reset', async (req, res) => {
  try {
    const card = await prompts.reset(req.params.id);
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
