require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const express = require('express');
const multer = require('multer');
const path = require('path');

const { generateBattlecard } = require('./src/generator');
const { generatePitch }     = require('./src/pitchGenerator');
const { generatePDF }       = require('./src/pdfExport');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// POST /api/generate — SSE stream: sends progress events then final battlecard
app.post('/api/generate', upload.single('figmaPdf'), async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const inputs = {
      clientName: req.body.clientName,
      podcastName: req.body.podcastName,
      niche: req.body.niche,
      geography: req.body.geography,
      idealBuyer: req.body.idealBuyer,
      referralPartners: req.body.referralPartners,
      transcript: req.body.transcript,
      icpListNeeded: req.body.icpListNeeded === 'true',
      offers: req.body.offers ? JSON.parse(req.body.offers) : [],
      figmaPdf: req.file ? req.file.buffer.toString('base64') : null,
    };
    const battlecard = await generateBattlecard(inputs, (tokens) => send('progress', { tokens }));
    send('done', { battlecard });
  } catch (err) {
    console.error('Generate error:', err);
    send('error', { error: err.message });
  } finally {
    res.end();
  }
});

// POST /api/generate-pitch — SSE stream for pitch generation
app.post('/api/generate-pitch', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const pitch = await generatePitch(req.body, (tokens) => send('progress', { tokens }));
    send('done', { pitch });
  } catch (err) {
    console.error('Pitch error:', err);
    send('error', { error: err.message });
  } finally {
    res.end();
  }
});

// POST /api/export-pdf — generate branded PDF
app.post('/api/export-pdf', async (req, res) => {
  try {
    const { battlecard } = req.body;
    if (!battlecard) return res.status(400).json({ ok: false, error: 'battlecard required' });

    const { pitch } = req.body;
    const pdfBytes = await generatePDF(battlecard, {}, pitch || null);
    const clientSlug = (battlecard.meta?.clientName || 'battlecard').toLowerCase().replace(/\s+/g, '-');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${clientSlug}-battlecard.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Podcast Battlecard running at http://localhost:${PORT}`));
