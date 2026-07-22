// ── Markdown → branded PDF ─────────────────────────────
// Renders an Authority Codex markdown document to a Project ICON-styled PDF
// (dark cover page, gold rules, serif headings) so Slack delivery can attach
// a real PDF instead of a raw .md file. Handles the markdown subset the deck
// generator produces: #/##/###/#### headings, paragraphs, bullets, numbered
// lists, blockquotes, horizontal rules, and pipe tables. Inline emphasis
// markers are stripped (no inline styling in v1).

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

function hex(h) {
  const s = (h || '#000000').replace('#', '');
  return rgb(parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255);
}

const C = {
  dark:    hex('#032225'),
  gold:    hex('#E9BF5E'),
  goldMid: hex('#B0863C'),
  text:    hex('#041A1C'),
  muted:   hex('#5A6B6D'),
  rule:    hex('#D8D2C4'),
  white:   rgb(1, 1, 1),
  dimWhite: rgb(0.8, 0.8, 0.8),
};

const PAGE_W = 612, PAGE_H = 792, MARGIN = 58;
const CONTENT_W = PAGE_W - MARGIN * 2;

// WinAnsi can't encode everything Claude writes — normalize the usual suspects
// and drop the rest.
function sanitize(s) {
  return String(s || '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/→/g, '->').replace(/←/g, '<-')
    .replace(/[•●▪]/g, '•')
    .replace(/✓|✔/g, '+').replace(/✕|✖|✗/g, 'x')
    .replace(/…/g, '...')
    .replace(/[^\x00-\xFF–—• -ÿ]/g, '');
}

// Strip inline markdown emphasis/code markers.
function plain(s) {
  return sanitize(s)
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1').replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim();
}

function wrap(text, font, size, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) <= maxW) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

async function markdownToPdf(markdown) {
  const doc = await PDFDocument.create();
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const serif     = await doc.embedFont(StandardFonts.TimesRoman);
  const sansBold  = await doc.embedFont(StandardFonts.HelveticaBold);
  const sans      = await doc.embedFont(StandardFonts.Helvetica);
  const italic    = await doc.embedFont(StandardFonts.TimesRomanItalic);

  const lines = String(markdown || '').split('\n');

  // The cover is everything before the first numbered section heading.
  const firstSection = lines.findIndex((l) => /^#{1,4}\s*(SECTION\s+)?\d{2}\b/.test(l));
  const coverLines = firstSection > 0 ? lines.slice(0, firstSection) : [];
  const bodyLines  = firstSection > 0 ? lines.slice(firstSection) : lines;

  // ── Cover page (dark, centered) ──────────────────────
  if (coverLines.length) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: C.dark });
    const items = coverLines
      .map((l) => l.trim())
      .filter((l) => l && l !== '---');
    // Measure total height first for vertical centering.
    const spec = items.map((l) => {
      if (/^#\s+/.test(l))  return { text: plain(l.replace(/^#\s+/, '')), font: serifBold, size: 30, color: C.gold, gap: 22 };
      if (/^##\s+/.test(l)) return { text: plain(l.replace(/^##\s+/, '')), font: serifBold, size: 20, color: C.white, gap: 18 };
      if (/^###\s+/.test(l)) return { text: plain(l.replace(/^###\s+/, '')), font: sansBold, size: 11, color: C.gold, gap: 14 };
      if (/^\*[^*].*\*$/.test(l)) return { text: plain(l), font: italic, size: 12, color: C.dimWhite, gap: 14 };
      if (/^\*\*.*\*\*$/.test(l)) return { text: plain(l), font: sansBold, size: 13, color: C.white, gap: 14 };
      return { text: plain(l), font: sans, size: 10.5, color: C.dimWhite, gap: 12 };
    }).filter((s) => s.text);
    const totalH = spec.reduce((a, s) => a + s.size + s.gap, 0);
    let y = (PAGE_H + totalH) / 2;
    for (const s of spec) {
      const w = s.font.widthOfTextAtSize(s.text, s.size);
      page.drawText(s.text, { x: (PAGE_W - w) / 2, y: y - s.size, size: s.size, font: s.font, color: s.color });
      y -= s.size + s.gap;
    }
    // gold rule near the bottom
    page.drawRectangle({ x: PAGE_W / 2 - 40, y: 70, width: 80, height: 2, color: C.goldMid });
  }

  // ── Body pages ───────────────────────────────────────
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const newPage = () => { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; };
  const need = (h) => { if (y - h < MARGIN) newPage(); };
  const para = (text, font, size, color, opts = {}) => {
    const maxW = CONTENT_W - (opts.indent || 0);
    for (const ln of wrap(text, font, size, maxW)) {
      need(size * 1.45);
      page.drawText(ln, { x: MARGIN + (opts.indent || 0), y: y - size, size, font, color });
      y -= size * 1.45;
    }
    y -= opts.after == null ? 6 : opts.after;
  };

  let i = 0;
  while (i < bodyLines.length) {
    const raw = bodyLines[i];
    const l = raw.trim();

    if (!l) { i++; continue; }

    if (l === '---') { need(20); page.drawRectangle({ x: MARGIN, y: y - 8, width: CONTENT_W, height: 0.7, color: C.rule }); y -= 20; i++; continue; }

    // Table block
    if (/^\|.*\|$/.test(l)) {
      const rows = [];
      while (i < bodyLines.length && /^\|.*\|$/.test(bodyLines[i].trim())) {
        const cells = bodyLines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => plain(c));
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      if (rows.length) {
        const cols = Math.max(...rows.map((r) => r.length));
        const colW = CONTENT_W / cols;
        rows.forEach((cells, rIdx) => {
          const cellLines = cells.map((c) => wrap(c, rIdx === 0 ? sansBold : sans, 8.5, colW - 10));
          const rowH = Math.max(...cellLines.map((cl) => cl.length)) * 12 + 8;
          need(rowH + 4);
          if (rIdx === 0) page.drawRectangle({ x: MARGIN, y: y - rowH, width: CONTENT_W, height: rowH, color: hex('#F0EDE5') });
          cellLines.forEach((cl, cIdx) => {
            cl.forEach((txt, lnIdx) => {
              page.drawText(txt, { x: MARGIN + cIdx * colW + 5, y: y - 14 - lnIdx * 12, size: 8.5, font: rIdx === 0 ? sansBold : sans, color: C.text });
            });
          });
          page.drawRectangle({ x: MARGIN, y: y - rowH, width: CONTENT_W, height: 0.5, color: C.rule });
          y -= rowH;
        });
        y -= 10;
      }
      continue;
    }

    // Section heading (## SECTION 05 | ... or ## 05 ...)
    if (/^#{1,4}\s*(SECTION\s+)?\d{2}\b/.test(l)) {
      if (y < PAGE_H - MARGIN - 40) { need(120); if (y < 200) newPage(); }
      y -= 10;
      para(plain(l.replace(/^#+\s*/, '')), serifBold, 15, C.text, { after: 2 });
      need(14);
      page.drawRectangle({ x: MARGIN, y: y - 4, width: 64, height: 2, color: C.goldMid });
      y -= 16;
      i++; continue;
    }

    if (/^####\s+/.test(l)) { y -= 4; para(plain(l.replace(/^####\s+/, '')), sansBold, 10, C.text, { after: 4 }); i++; continue; }
    if (/^###\s+/.test(l))  { y -= 6; para(plain(l.replace(/^###\s+/, '')), sansBold, 11, C.goldMid === undefined ? C.text : hex('#7A5A22'), { after: 4 }); i++; continue; }
    if (/^##\s+/.test(l))   { y -= 8; para(plain(l.replace(/^##\s+/, '')), serifBold, 14, C.text, { after: 4 }); i++; continue; }
    if (/^#\s+/.test(l))    { y -= 8; para(plain(l.replace(/^#\s+/, '')), serifBold, 17, C.text, { after: 6 }); i++; continue; }

    // Blockquote / pull-quote
    if (/^>\s?/.test(l)) {
      const q = plain(l.replace(/^>\s?/, ''));
      const startY = y;
      para(q, italic, 11, hex('#3A4A4C'), { indent: 16, after: 4 });
      page.drawRectangle({ x: MARGIN + 4, y: y + 2, width: 2.5, height: Math.max(10, startY - y - 6), color: C.goldMid });
      y -= 4;
      i++; continue;
    }

    // Bullets / numbered
    const bullet = l.match(/^[-*]\s+(.*)$/);
    const numbered = l.match(/^(\d+)[.)]\s+(.*)$/);
    if (bullet)   { need(14); page.drawText('•', { x: MARGIN + 6, y: y - 9.5, size: 9.5, font: sans, color: hex('#7A5A22') }); para(plain(bullet[1]), sans, 9.5, C.text, { indent: 18, after: 3 }); i++; continue; }
    if (numbered) { need(14); page.drawText(numbered[1] + '.', { x: MARGIN + 4, y: y - 9.5, size: 9.5, font: sansBold, color: hex('#7A5A22') }); para(plain(numbered[2]), sans, 9.5, C.text, { indent: 20, after: 3 }); i++; continue; }

    // Paragraph (merge soft-wrapped lines)
    let text = l; let j = i + 1;
    while (j < bodyLines.length) {
      const nxt = bodyLines[j].trim();
      if (!nxt || /^([#>|]|[-*]\s|\d+[.)]\s|---$)/.test(nxt)) break;
      text += ' ' + nxt; j++;
    }
    para(plain(text), sans, 9.5, C.text, { after: 8 });
    i = j;
  }

  // Footer page numbers (skip the cover)
  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    if (coverLines.length && idx === 0) return;
    const label = `${idx + (coverLines.length ? 0 : 1)}`;
    p.drawText(label, { x: PAGE_W / 2 - 4, y: 28, size: 8, font: sans, color: C.muted });
  });

  return doc.save();
}

module.exports = { markdownToPdf };
