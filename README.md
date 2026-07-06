# Podcast Battlecard Generator — Project ICON

A full-stack web app that generates a complete podcast guest prospecting profile (IRP list, booking form, referral detection questions, and offer matching guide) from a client onboarding call transcript.

---

## Setup

1. **Install dependencies**
   ```bash
   cd podcast-battlecard
   npm install
   ```

2. **Add your API keys**
   ```bash
   # Edit .env and replace the placeholders
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...           # required for /api/generate-voice-summary
   FATHOM_WEBHOOK_SECRET=...       # required for /api/webhook/fathom -- pick any long random string,
                                   # set the same value as a header in the Zapier/Make webhook action
   ```

   **Cross-call storage note:** `src/store.js` is currently an in-memory placeholder --
   it does NOT persist between Strategy Call 1 and Strategy Call 2 in a real
   deployment, since serverless functions don't share memory. Swap it for
   Vercel KV, Upstash Redis, or an Airtable/Sheet row before relying on the
   automated Call 2 -> Battlecard flow in production.

3. **Run the server**
   ```bash
   npm start
   # or for auto-reload during development:
   npm run dev
   ```

4. **Open in browser**
   ```
   http://localhost:3000
   ```

---

## How to use

### Generate a battlecard

1. Fill in **Client Name**, **Podcast Name**, **Niche**, and **Geography** in the left sidebar
2. Add one or more **offers** (name, format, price, transformation)
3. Describe the **Ideal Buyer**
4. List any **Referral Partners Already Identified** (optional)
5. **Paste the call transcript** — this is the primary data source. The AI treats what the host actually said as the source of truth
6. Click **Generate Battlecard**

The four tabs will populate with:
- **IRP List** — job titles, industry tags, seniority, company size, keywords, intent signals, boolean search string
- **Booking Form** — qualifying questions with disqualifying answers, strong fit signals
- **Referral Detection** — questions with signal notes for identifying warm referral partners
- **Offer Matching** — partner type → lead offer → positioning angle mapping

### Add a client brand guide (for PDF theming)

- **Upload a file** — paste a `.txt`, `.css`, `.html`, or `.md` file containing brand colors or CSS variables
- **Or paste brand text** — paste CSS variables, color hex codes, or a plain-English description like "primary color is #1A2B3C, accent is #FFD700"

The app extracts up to 6 hex colors (primary, secondary, accent, background, text, muted) and uses them to theme the exported PDF. If nothing is provided, it falls back to Project ICON's brand colors.

### Export PDF

Once a battlecard is generated, the **Export PDF** button in the top-right activates. Click it to download a two-page branded PDF:
- **Page 1** — Offer Stack + IRP (job titles, industry, company size, keywords, boolean string)
- **Page 2** — Booking Form questions, Referral Detection questions, Offer Matching guide

---

## File structure

```
podcast-battlecard/
├── .env                       ← ANTHROPIC_API_KEY goes here
├── package.json
├── app.js                     ← Express server, API routes
├── src/
│   ├── generator.js           ← /api/generate — calls Claude, returns JSON battlecard
│   │                            (accepts an optional `authorityDeck` input for continuity
│   │                             from a client's Phase 1 Authority Deck)
│   ├── authorityDeckGenerator.js ← /api/generate-authority-deck — Phase 1 output, calls Claude
│   ├── authorityDeckPdf.js    ← /api/export-authority-pdf — builds the Authority Deck PDF
│   ├── pitchGenerator.js      ← /api/generate-pitch — calls Claude, returns JSON pitch
│   ├── brandParser.js         ← /api/brand — extracts hex colors from brand guide
│   └── pdfExport.js           ← /api/export-pdf — builds the Battlecard PDF with pdf-lib
└── public/
    └── index.html             ← Full frontend (self-contained HTML/CSS/JS)
```

---

## API routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/generate-authority-deck` | Phase 1. Accepts Strategy Call 1 inputs (client name, podcast/business name, niche, geography, ideal buyer, offers, referral partners, transcript), returns `{ ok, authorityDeck }` |
| POST | `/api/generate-voice-summary` | "Jarvis" step. Accepts `{ text, voice, model }` (a call recap), returns an MP3 voice note generated via OpenAI TTS. Requires `OPENAI_API_KEY` env var. |
| POST | `/api/webhook/fathom` | Automation entry point. Called by a Zapier/Make "Webhooks" action off Fathom's "New Transcript"/"New AI Summary" trigger. Body: `{ meetingTitle, clientName, transcript, recordingId, presentedDate }`. `meetingTitle` must contain "Strategy Call 1" or "Strategy Call 2" (also accepts "one"/"two"). Routes to the Authority Deck generator (Call 1) or the Battlecard generator with the stored Authority Deck as context (Call 2). Requires header `x-webhook-secret` matching `FATHOM_WEBHOOK_SECRET` env var. |
| POST | `/api/export-authority-pdf` | Accepts `{ authorityDeck }` JSON, returns the branded Authority Deck PDF |
| POST | `/api/generate` | Accepts form inputs as JSON, returns `{ ok, battlecard }` |
| POST | `/api/brand` | Accepts `multipart/form-data` with `brandFile` and/or `brandText`, returns `{ ok, colors }` |
| POST | `/api/export-pdf` | Accepts `{ battlecard, colors }` JSON, returns PDF file |
