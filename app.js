require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });

const express = require('express');
const multer  = require('multer');
const path    = require('path');

const { generateBattlecard }        = require('./src/generator');
const { generatePitch }             = require('./src/pitchGenerator');
const { generatePDF }               = require('./src/pdfExport');
const { extractDeck, assembleDeck } = require('./src/authorityDeck');
const prompts                       = require('./src/prompts');
const memory                        = require('./src/memory');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

// ── Authority Deck (Stage 1) ───────────────────────────
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
    const { extraction, client } = req.body || {};
    if (!extraction) throw new Error('extraction JSON is required');
    const markdown = await assembleDeck(extraction, (t) => sseEvent(res, 'progress', { tokens: t }));
    const saved = memory.save({
      email:    (client && client.email) || '',
      name:     (client && client.name)  || (extraction.client && extraction.client.name) || '',
      docType:  'authority_deck',
      json:     extraction,
      markdown,
    });
    sseEvent(res, 'done', {
      markdown,
      saved: { key: saved.key, name: saved.name, email: saved.email, updatedAt: saved.updatedAt },
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  Podcast Battlecard running at http://localhost:${PORT}\n`);
});
