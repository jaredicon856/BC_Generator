require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

const express = require('express');
const multer  = require('multer');
const path    = require('path');

const { generateBattlecard }     = require('./src/generator');
const { generatePitch }          = require('./src/pitchGenerator');
const { generateAuthorityDeck }  = require('./src/authorityDeckGenerator');
const { generatePDF }            = require('./src/pdfExport');
const { generateAuthorityDeckPDF } = require('./src/authorityDeckPdf');
const { generateVoiceSummary }   = require('./src/voiceSummary');
const store                      = require('./src/store');

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

  try {
    const { meetingTitle, clientName, transcript, recordingId, presentedDate } = req.body || {};

    if (!meetingTitle || !clientName || !transcript) {
      return res.status(400).json({ ok: false, error: 'meetingTitle, clientName, and transcript are required' });
    }

    if (recordingId && (await store.has(`processed:${recordingId}`))) {
      return res.json({ ok: true, skipped: true, reason: 'recording already processed' });
    }

    const phase = detectCallPhase(meetingTitle);
    if (phase === 'unknown') {
      console.warn(`[webhook/fathom] Could not detect call phase from title: "${meetingTitle}" -- skipping`);
      return res.json({ ok: true, skipped: true, reason: 'title did not match "Strategy Call 1/2" pattern' });
    }

    if (phase === 1) {
      const authorityDeck = await generateAuthorityDeck({ clientName, transcript, presentedDate });
      await store.set(`authorityDeck:${clientName}`, authorityDeck);
      const pdfBytes = await generateAuthorityDeckPDF(authorityDeck);
      // TODO(#6): post pdfBytes to the #authority-deck-delivery Slack channel
      // once SLACK_BOT_TOKEN + channel ID are configured.
      if (recordingId) await store.set(`processed:${recordingId}`, true);
      return res.json({ ok: true, phase: 1, clientName, pdfBytes: pdfBytes.length });
    }

    // phase === 2
    const authorityDeck = await store.get(`authorityDeck:${clientName}`);
    if (!authorityDeck) {
      console.error(`[webhook/fathom] No stored Authority Deck for "${clientName}" -- Call 2 fired before Call 1 completed, or clientName didn't match between calls.`);
      // TODO(#6): post an alert to Slack instead of silently generating an
      // incomplete Battlecard once Slack delivery is wired.
    }

    const battlecard = await generateBattlecard({ clientName, transcript, authorityDeck });
    const pdfBytes = await generatePDF(battlecard);
    // TODO(#6): post pdfBytes to the Battlecard delivery Slack channel.
    if (recordingId) await store.set(`processed:${recordingId}`, true);
    return res.json({ ok: true, phase: 2, clientName, missingAuthorityDeck: !authorityDeck, pdfBytes: pdfBytes.length });
  } catch (err) {
    console.error('[/api/webhook/fathom]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

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
    const clientSlug = (battlecard.meta?.clientName || 'battlecard')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${clientSlug}-battlecard.pdf"`);
    res.send(Buffer.from(pdfBytes)); // pdfBytes is Uint8Array — Buffer.from is zero-copy
  } catch (err) {
    console.error('[/api/export-pdf]', err.message);
    res.status(500).json({ ok: false, error: err.message });
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
