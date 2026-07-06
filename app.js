require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

const express = require('express');
const multer  = require('multer');
const path    = require('path');

const { generateBattlecard }     = require('./src/generator');
const { generatePitch }          = require('./src/pitchGenerator');
const { generateAuthorityDeck }  = require('./src/authorityDeckGenerator');
const { generatePDF }            = require('./src/pdfExport');
const { generateAuthorityDeckPDF } = require('./src/authorityDeckPdf');

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
