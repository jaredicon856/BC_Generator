const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

function hex(h) {
  const s = (h || '#000000').replace('#', '');
  return rgb(parseInt(s.slice(0, 2), 16) / 255, parseInt(s.slice(2, 4), 16) / 255, parseInt(s.slice(4, 6), 16) / 255);
}

const C = {
  dark:     hex('#032225'),
  gold:     hex('#E9BF5E'),
  goldMid:  hex('#B0863C'),
  goldDeep: hex('#966C2B'),
  cardBg:   hex('#F7F5F0'),
  rowAlt:   hex('#EFEBE1'),
  text:     hex('#041A1C'),
  white:    rgb(1, 1, 1),
  dimWhite: rgb(0.75, 0.75, 0.75),
};

function wrapText(text, font, size, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) <= maxW) { cur = t; }
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function clipText(text, font, size, maxW) {
  let s = String(text || '');
  while (s.length > 1 && font.widthOfTextAtSize(s + '...', size) > maxW) s = s.slice(0, -1);
  return font.widthOfTextAtSize(String(text || ''), size) > maxW ? s + '...' : String(text || '');
}

/**
 * Renders an Authority Deck (as produced by src/authorityDeckGenerator.js) into a
 * multi-page branded PDF: cover page, executive summary, strategy identity snapshot,
 * ideal client profile, referral partner + conversion + ecosystem tables, roadmap,
 * action items, and next-call agenda.
 */
async function generateAuthorityDeckPDF(deck) {
  const pdfDoc  = await PDFDocument.create();
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const italic  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const W = 612, H = 792, ML = 48, MR = 48;
  const CW = W - ML - MR;
  const HEADER_H = 60;
  const FOOTER_H = 24;
  const BOTTOM = FOOTER_H + 14;

  const meta = deck?.meta || {};
  const dateStr = meta.generatedAt
    ? new Date(meta.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  let page, y, section = '', sectionNum = 0;

  function addPage(sec = '', { header = true } = {}) {
    section = sec;
    page = pdfDoc.addPage([W, H]);

    if (header) {
      page.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: C.dark });
      page.drawLine({ start: { x: 0, y: H - HEADER_H }, end: { x: W, y: H - HEADER_H }, thickness: 1.5, color: C.gold });

      const title = clipText(meta.clientName || 'Authority Deck', bold, 15, CW * 0.62);
      page.drawText(title, { x: ML, y: H - 27, font: bold, size: 15, color: C.white });

      const sub = meta.podcastName || '';
      page.drawText(clipText(sub, regular, 9, CW * 0.62), { x: ML, y: H - 44, font: regular, size: 9, color: C.gold });

      if (sec) {
        const sw = bold.widthOfTextAtSize(sec.toUpperCase(), 8);
        page.drawText(sec.toUpperCase(), { x: W - MR - sw, y: H - 27, font: bold, size: 8, color: C.dimWhite });
      }
      if (dateStr) {
        const dw = regular.widthOfTextAtSize(dateStr, 8);
        page.drawText(dateStr, { x: W - MR - dw, y: H - 44, font: regular, size: 8, color: C.dimWhite });
      }
    }

    page.drawLine({ start: { x: 0, y: FOOTER_H }, end: { x: W, y: FOOTER_H }, thickness: 0.5, color: C.gold });
    page.drawText('PROJECT ICON — CONFIDENTIAL', { x: ML, y: 8, font: bold, size: 6.5, color: C.goldDeep });
    const pn = String(pdfDoc.getPageCount());
    const pw = regular.widthOfTextAtSize(pn, 7);
    page.drawText(pn, { x: W - MR - pw, y: 8, font: regular, size: 7, color: C.goldDeep });

    y = header ? H - HEADER_H - 24 : H - 80;
  }

  function needs(h) { if (y - h < BOTTOM) addPage(section); }
  function gap(n = 10) { y -= n; }

  function sectionTitle(label, numbered = true) {
    needs(28);
    if (numbered) sectionNum++;
    const prefix = numbered ? `${String(sectionNum).padStart(2, '0')}  |  ` : '';
    page.drawText((prefix + label).toUpperCase(), { x: ML, y, font: bold, size: 11, color: C.dark });
    y -= 6;
    page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 1, color: C.gold });
    y -= 16;
  }

  function subTitle(label) {
    needs(18);
    page.drawText(label.toUpperCase(), { x: ML, y, font: bold, size: 8.5, color: C.goldDeep });
    y -= 14;
  }

  // Flowing paragraph text
  function paragraph(text, opts = {}) {
    const f = opts.italic ? italic : regular;
    const size = opts.size || 10;
    const lh = opts.lh || 14;
    for (const line of wrapText(text, f, size, CW)) {
      needs(lh);
      page.drawText(line, { x: ML, y, font: f, size, color: opts.color || C.text });
      y -= lh;
    }
    gap(opts.gapAfter ?? 8);
  }

  // Bulleted list
  function bulletList(items, opts = {}) {
    if (!items?.length) return;
    const size = opts.size || 10, lh = 14, indent = 14;
    for (const item of items) {
      const lines = wrapText(item, regular, size, CW - indent);
      needs(lines.length * lh);
      page.drawText('•', { x: ML, y, font: bold, size, color: C.goldMid });
      lines.forEach((line, i) => {
        page.drawText(line, { x: ML + indent, y, font: regular, size, color: C.text });
        y -= lh;
      });
    }
    gap(opts.gapAfter ?? 6);
  }

  // Key/value snapshot card
  function kvGrid(pairs) {
    const rowH = 32, PH = 12;
    for (const [label, value] of pairs) {
      if (!value) continue;
      const lines = wrapText(value, regular, 10, CW - 160);
      const h = Math.max(rowH, lines.length * 13 + 14);
      needs(h);
      page.drawRectangle({ x: ML, y: y - h, width: CW, height: h, color: C.cardBg });
      page.drawRectangle({ x: ML, y: y - h, width: 3, height: h, color: C.gold });
      page.drawText(label.toUpperCase(), { x: ML + PH, y: y - 16, font: bold, size: 7.5, color: C.goldDeep });
      let ty = y - 16;
      lines.forEach(line => {
        page.drawText(line, { x: ML + 150, y: ty, font: regular, size: 10, color: C.text });
        ty -= 13;
      });
      y -= h + 4;
    }
    gap(6);
  }

  // Generic table with wrapped cells
  function table(headers, rows, colWidths) {
    const PV = 8, PH = 8, size = 9, lh = 11.5;
    const totalW = colWidths.reduce((a, b) => a + b, 0);
    const scale = CW / totalW;
    const widths = colWidths.map(w => w * scale);

    // Header row
    needs(26);
    let x = ML;
    const headerH = 22;
    page.drawRectangle({ x: ML, y: y - headerH, width: CW, height: headerH, color: C.dark });
    headers.forEach((h, i) => {
      page.drawText(h.toUpperCase(), { x: x + PH, y: y - 15, font: bold, size: 7.5, color: C.gold });
      x += widths[i];
    });
    y -= headerH;

    rows.forEach((row, ri) => {
      const cellLines = row.map((cell, i) => wrapText(cell || '—', regular, size, widths[i] - PH * 2));
      const rowLines = Math.max(...cellLines.map(l => l.length));
      const rowH = rowLines * lh + PV * 2;
      needs(rowH);
      page.drawRectangle({ x: ML, y: y - rowH, width: CW, height: rowH, color: ri % 2 === 0 ? C.cardBg : C.rowAlt });
      let cx = ML;
      cellLines.forEach((lines, i) => {
        let ty = y - PV - 9;
        lines.forEach(line => {
          page.drawText(line, { x: cx + PH, y: ty, font: i === 0 ? bold : regular, size, color: C.text });
          ty -= lh;
        });
        cx += widths[i];
      });
      y -= rowH;
    });
    gap(10);
  }

  // ── COVER PAGE ────────────────────────────────────────────
  addPage('', { header: false });
  y = H - 220;
  page.drawRectangle({ x: 0, y: H - 320, width: W, height: 320, color: C.dark });
  page.drawLine({ start: { x: 0, y: H - 320 }, end: { x: W, y: H - 320 }, thickness: 2, color: C.gold });
  page.drawText('AUTHORITY DECK', { x: ML, y: H - 140, font: bold, size: 13, color: C.gold });
  const clientTitle = clipText((meta.clientName || 'Client Strategy').toUpperCase(), bold, 26, CW);
  page.drawText(clientTitle, { x: ML, y: H - 175, font: bold, size: 26, color: C.white });
  if (meta.podcastName) page.drawText(meta.podcastName, { x: ML, y: H - 200, font: regular, size: 12, color: C.gold });
  if (meta.tagline) page.drawText(clipText(meta.tagline, regular, 10, CW), { x: ML, y: H - 218, font: regular, size: 10, color: C.dimWhite });
  page.drawText(`Prepared by  ${meta.preparedBy || 'Project ICON'}  |  Presented: ${meta.presentedDate || dateStr || ''}`, {
    x: ML, y: H - 300, font: regular, size: 9, color: C.dimWhite,
  });
  y = H - 380;

  // ── EXECUTIVE SUMMARY ─────────────────────────────────────
  sectionTitle('Executive Summary');
  paragraph(deck?.executiveSummary || '(not provided)', { size: 10.5, lh: 15 });

  // ── CORE STRATEGY IDENTITY ────────────────────────────────
  const csi = deck?.coreStrategyIdentity || {};
  sectionTitle('Core Strategy Identity');
  kvGrid([
    ['Mission Platform', csi.missionPlatform],
    ['Authority Proof Point', csi.authorityProofPoint],
    ['Primary Business', csi.primaryBusiness],
    ['Ideal Client', csi.idealClient],
    ['Revenue Priority', (csi.revenuePriority || []).join('  ·  ')],
    ['The North Star', csi.northStar],
  ]);

  // ── PODCAST FUNNEL ────────────────────────────────────────
  addPage('Funnel');
  sectionTitle('The Podcast Funnel — How the Engine Works');
  paragraph(deck?.podcastFunnel?.howItWorks || '(not provided)');
  if (deck?.podcastFunnel?.corePrinciple) {
    subTitle('Core Principle');
    paragraph(deck.podcastFunnel.corePrinciple, { italic: true, color: C.goldDeep });
  }

  // ── IDEAL CLIENT PROFILE ──────────────────────────────────
  sectionTitle('Ideal Client Profile');
  for (const seg of (deck?.idealClientProfile?.segments || [])) {
    needs(20);
    page.drawText(seg.title || '', { x: ML, y, font: bold, size: 10.5, color: C.text });
    y -= 14;
    paragraph(seg.description || '', { size: 9.5, gapAfter: 4 });
  }
  if (deck?.idealClientProfile?.whoWeAvoid) {
    subTitle('Who We Avoid');
    paragraph(deck.idealClientProfile.whoWeAvoid, { size: 9.5, color: C.goldDeep });
  }

  // ── REFERRAL PARTNER TARGETS ──────────────────────────────
  addPage('Referral Partners');
  sectionTitle('Referral Partner Targets — The Who');
  table(
    ['Partner Category', 'Why They Refer', 'Notes & Known Openings'],
    (deck?.referralPartnerTargets || []).map(r => [r.partnerCategory, r.whyTheyRefer, r.notesAndOpenings]),
    [1, 1, 1.2]
  );

  // ── OUTREACH & CONVERSION ─────────────────────────────────
  addPage('Conversion Plays');
  sectionTitle('The How — Outreach & Post-Show Conversion');
  table(
    ['Partner Type', 'Post-Show Conversion Play'],
    (deck?.outreachAndConversion?.conversionPlays || []).map(r => [r.partnerType, r.postShowConversionPlay]),
    [1, 2]
  );
  if (deck?.outreachAndConversion?.conversionInfrastructure?.length) {
    subTitle('Conversion Infrastructure');
    bulletList(deck.outreachAndConversion.conversionInfrastructure);
  }

  // ── ECOSYSTEM ──────────────────────────────────────────────
  addPage('Ecosystem');
  sectionTitle('Where Referrals Land');
  table(
    ['Destination', 'What It Offers', 'Status'],
    (deck?.ecosystem || []).map(r => [r.destination, r.whatItOffers, r.status]),
    [0.8, 1.4, 1]
  );

  // ── ROADMAP ────────────────────────────────────────────────
  addPage('Roadmap');
  sectionTitle('Implementation Roadmap');
  for (const phase of (deck?.implementationRoadmap || [])) {
    subTitle(phase.phase || '');
    bulletList(phase.tasks || [], { gapAfter: 8 });
  }

  // ── ACTION ITEMS ───────────────────────────────────────────
  addPage('Action Items');
  sectionTitle('Immediate Action Items');
  subTitle("Client's Actions");
  bulletList(deck?.actionItems?.clientActions || []);
  subTitle("Project ICON's Actions");
  bulletList(deck?.actionItems?.icoActions || []);

  // ── NEXT STEPS ─────────────────────────────────────────────
  if (deck?.nextSteps?.agenda?.length) {
    sectionTitle('Next Steps — Call Agenda');
    bulletList(deck.nextSteps.agenda);
  }

  // ── MISSING INPUTS ─────────────────────────────────────────
  if (deck?.missingInputs?.length) {
    addPage('Missing Inputs');
    sectionTitle('Missing Inputs', false);
    bulletList(deck.missingInputs);
  }

  return await pdfDoc.save();
}

module.exports = { generateAuthorityDeckPDF };
