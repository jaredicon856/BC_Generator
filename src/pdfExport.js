const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

function hex(h) {
  const s = (h || '#000000').replace('#', '');
  return rgb(parseInt(s.slice(0,2),16)/255, parseInt(s.slice(2,4),16)/255, parseInt(s.slice(4,6),16)/255);
}

const C = {
  dark:     hex('#032225'),
  gold:     hex('#E9BF5E'),
  goldMid:  hex('#B0863C'),
  goldDeep: hex('#966C2B'),
  cardBg:   hex('#F7F5F0'),
  text:     hex('#041A1C'),
  white:    rgb(1, 1, 1),
  dimWhite: rgb(0.75, 0.75, 0.75),
  signal:   hex('#059669'),
};

function wrapText(text, font, size, maxW) {
  const words = String(text || '').split(' ');
  const lines = []; let cur = '';
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

async function generatePDF(battlecard, _colors = {}, pitch = null) {
  const pdfDoc = await PDFDocument.create();
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const mono    = await pdfDoc.embedFont(StandardFonts.Courier);

  const W = 612, H = 792, ML = 44, MR = 44;
  const CW = W - ML - MR;
  const HEADER_H = 68;
  const FOOTER_H = 24;
  const BOTTOM = FOOTER_H + 14;

  const meta    = battlecard?.meta || {};
  const dateStr = meta.generatedAt
    ? new Date(meta.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  let page, y, section = '';

  function addPage(sec = '') {
    section = sec;
    page = pdfDoc.addPage([W, H]);

    // Header
    page.drawRectangle({ x: 0, y: H - HEADER_H, width: W, height: HEADER_H, color: C.dark });
    page.drawLine({ start: { x: 0, y: H - HEADER_H }, end: { x: W, y: H - HEADER_H }, thickness: 1.5, color: C.gold });

    const podName = clipText(meta.podcastName || '', bold, 17, CW * 0.68);
    page.drawText(podName, { x: ML, y: H - 30, font: bold, size: 17, color: C.white });

    const sub = `${meta.clientName || ''}${meta.niche ? '  ·  ' + meta.niche : ''}`;
    page.drawText(clipText(sub, regular, 9, CW * 0.68), { x: ML, y: H - 48, font: regular, size: 9, color: C.gold });

    if (sec) {
      const sw = bold.widthOfTextAtSize(sec.toUpperCase(), 8);
      page.drawText(sec.toUpperCase(), { x: W - MR - sw, y: H - 30, font: bold, size: 8, color: C.dimWhite });
    }
    if (dateStr) {
      const dw = regular.widthOfTextAtSize(dateStr, 8);
      page.drawText(dateStr, { x: W - MR - dw, y: H - 48, font: regular, size: 8, color: C.dimWhite });
    }

    // Footer
    page.drawLine({ start: { x: 0, y: FOOTER_H }, end: { x: W, y: FOOTER_H }, thickness: 0.5, color: C.gold });
    page.drawText('PROJECT ICON', { x: ML, y: 8, font: bold, size: 7, color: C.gold });

    y = H - HEADER_H - 20;
  }

  function needs(h) { if (y - h < BOTTOM) addPage(section); }
  function gap(n = 10) { y -= n; }

  // Section title with gold rule
  function sectionTitle(label) {
    needs(24);
    page.drawText(label.toUpperCase(), { x: ML, y, font: bold, size: 8.5, color: C.goldDeep });
    y -= 5;
    page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.75, color: C.gold });
    y -= 14;
  }

  // Simple card
  function card(lines, opts = {}) {
    const LH = 14, PV = 10, PH = 12;
    let totalH = 0;
    for (const ln of lines) {
      const t = typeof ln === 'string' ? ln : (ln.text || '');
      const f = typeof ln === 'object' && ln.bold ? bold : regular;
      const s = typeof ln === 'object' && ln.size ? ln.size : 10;
      totalH += wrapText(t, f, s, CW - PH * 2 - (opts.bar ? 8 : 0)).length * LH;
    }
    const h = totalH + PV * 2;
    needs(h);

    if (opts.fill !== false) {
      page.drawRectangle({ x: ML, y: y - h, width: CW, height: h, color: opts.fill || C.cardBg });
    }
    if (opts.bar) {
      page.drawRectangle({ x: ML, y: y - h, width: 3, height: h, color: opts.bar });
    }

    const xOff = ML + PH + (opts.bar ? 6 : 0);
    let ty = y - PV;
    for (const ln of lines) {
      const t = typeof ln === 'string' ? ln : (ln.text || '');
      const f = typeof ln === 'object' && ln.bold ? bold : (typeof ln === 'object' && ln.mono ? mono : regular);
      const s = typeof ln === 'object' && ln.size ? ln.size : 10;
      const col = typeof ln === 'object' && ln.color ? ln.color : C.text;
      const mw = CW - PH * 2 - (opts.bar ? 8 : 0);
      for (const line of wrapText(t, f, s, mw)) {
        ty -= LH;
        page.drawText(line, { x: xOff, y: ty, font: f, size: s, color: col });
      }
    }
    y -= h + 6;
  }

  // Tag row
  function tags(items, opts = {}) {
    if (!items?.length) return;
    const FS = opts.size || 9, PH = 8, GAP = 5, PILL_H = 18;
    const FONT = opts.bold ? bold : regular;
    let cx = ML;
    needs(PILL_H);

    for (const item of items) {
      const tw = FONT.widthOfTextAtSize(String(item), FS) + PH * 2;
      if (cx + tw > W - MR && cx > ML) { y -= PILL_H + 5; cx = ML; needs(PILL_H); }
      const bg  = opts.dark ? C.dark : C.cardBg;
      const col = opts.dark ? C.gold : C.text;
      page.drawRectangle({ x: cx, y: y - PILL_H, width: tw, height: PILL_H, color: bg });
      page.drawLine({ start: { x: cx, y: y - PILL_H }, end: { x: cx + tw, y: y - PILL_H }, thickness: 0.5, color: C.goldMid });
      page.drawLine({ start: { x: cx, y }, end: { x: cx + tw, y }, thickness: 0.5, color: C.goldMid });
      page.drawLine({ start: { x: cx, y: y - PILL_H }, end: { x: cx, y }, thickness: 0.5, color: C.goldMid });
      page.drawLine({ start: { x: cx + tw, y: y - PILL_H }, end: { x: cx + tw, y }, thickness: 0.5, color: C.goldMid });
      page.drawText(String(item), { x: cx + PH, y: y - PILL_H + 5, font: FONT, size: FS, color: col });
      cx += tw + GAP;
    }
    y -= PILL_H + 10;
  }

  // Two-column stat cards
  function statRow(left, right) {
    const colW = (CW - 8) / 2, h = 46;
    needs(h);
    [[ML, left], [ML + colW + 8, right]].forEach(([bx, item]) => {
      if (!item) return;
      page.drawRectangle({ x: bx, y: y - h, width: colW, height: h, color: C.cardBg });
      page.drawRectangle({ x: bx, y: y - h, width: 3, height: h, color: C.gold });
      page.drawText(item.label.toUpperCase(), { x: bx + 10, y: y - 14, font: bold, size: 7.5, color: C.goldDeep });
      page.drawText(clipText(item.value || '—', bold, 14, colW - 20), { x: bx + 10, y: y - 32, font: bold, size: 14, color: C.text });
    });
    y -= h + 8;
  }

  // Boolean string box
  function boolBox(str) {
    if (!str) return;
    const PV = 12, PH = 14;
    const lines = wrapText(str, mono, 8.5, CW - PH * 2 - 10);
    const h = lines.length * 13 + PV * 2 + 20;
    needs(h);
    page.drawRectangle({ x: ML, y: y - h, width: CW, height: h, color: C.dark });
    page.drawLine({ start: { x: ML, y }, end: { x: ML + CW, y }, thickness: 1, color: C.gold });
    page.drawLine({ start: { x: ML, y: y - h }, end: { x: ML + CW, y: y - h }, thickness: 1, color: C.gold });
    page.drawRectangle({ x: ML, y: y - h, width: 3, height: h, color: C.gold });
    page.drawText('BOOLEAN SEARCH STRING', { x: ML + PH, y: y - 14, font: bold, size: 7.5, color: C.goldDeep });
    page.drawLine({ start: { x: ML + PH, y: y - 19 }, end: { x: ML + CW - PH, y: y - 19 }, thickness: 0.5, color: C.goldMid });
    let ty = y - 19 - 13;
    for (const line of lines) {
      page.drawText(line, { x: ML + PH, y: ty, font: mono, size: 8.5, color: C.gold });
      ty -= 13;
    }
    y -= h + 10;
  }

  // Shared IRP/ICP renderer
  function renderList(data, prefix) {
    if (!data) return;

    sectionTitle(`${prefix} — Job Titles`);
    tags(data.jobTitles || []);
    gap(4);

    if ((data.seniorityLevels || []).length) {
      sectionTitle(`${prefix} — Seniority Levels`);
      for (const s of data.seniorityLevels) {
        card([
          { text: s.level || '', bold: true, size: 11 },
          { text: `Priority: ${s.priority || ''}  ·  ${s.reason || ''}`, size: 9.5, color: C.goldDeep },
        ], { bar: C.gold });
        gap(2);
      }
      gap(4);
    }

    sectionTitle(`${prefix} — Industry Tags`);
    tags(data.industryTags || [], { size: 9 });
    gap(4);

    if (data.companySize) {
      sectionTitle(`${prefix} — Company Size`);
      statRow(
        { label: 'Employees', value: data.companySize.employeeRange || '—' },
        { label: 'Revenue',   value: data.companySize.revenueRange  || '—' }
      );
      if (data.companySize.rationale) {
        card([{ text: data.companySize.rationale, size: 9.5, color: C.goldDeep }], { fill: false });
      }
      gap(4);
    }

    if (data.geography?.primary) {
      sectionTitle(`${prefix} — Geography`);
      card([
        { text: data.geography.primary, bold: true, size: 11 },
        ...(data.geography.notes ? [{ text: data.geography.notes, size: 9.5, color: C.goldDeep }] : []),
      ], { bar: C.goldMid });
      gap(4);
    }

    sectionTitle(`${prefix} — Keywords`);
    tags(data.keywords || [], { size: 9 });
    gap(4);

    sectionTitle(`${prefix} — Intent Signals`);
    tags(data.intentSignals || [], { dark: true, size: 9 });
    gap(4);

    boolBox(data.booleanString);
    gap(4);
  }

  // ── OFFER STACK ──────────────────────────────────────────
  addPage('Offer Stack');
  sectionTitle('Offer Stack');
  for (const o of (battlecard?.offerStack || [])) {
    card([
      { text: `${o.name || 'Untitled'}  —  ${o.format || ''}`, bold: true, size: 12 },
      { text: `Price: ${o.price || 'N/A'}`, size: 9.5, color: C.goldMid },
      ...wrapText(o.transformation || '', regular, 10, CW - 28).map(l => ({ text: l, size: 10 })),
    ], { bar: C.gold });
    gap(2);
  }
  if (!(battlecard?.offerStack || []).length) {
    card([{ text: '(none provided)', size: 10, color: C.goldDeep }], {});
  }

  // ── IRP LIST ─────────────────────────────────────────────
  addPage('IRP List');
  renderList(battlecard?.irpList, 'IRP');

  // ── ICP LIST ─────────────────────────────────────────────
  if (battlecard?.icpList) {
    addPage('ICP List');
    renderList(battlecard.icpList, 'ICP');
  }

  // ── BOOKING FORM ─────────────────────────────────────────
  addPage('Booking Form');

  sectionTitle('Qualifying Questions');
  for (const q of (battlecard?.bookingForm?.qualifyingQuestions || [])) {
    card([
      { text: q.question || '', bold: true, size: 11 },
      { text: 'Disqualify if selected:', size: 8.5, color: C.goldMid },
      ...(q.disqualifyingAnswers || []).flatMap(a =>
        wrapText(`· ${a}`, regular, 9.5, CW - 36).map(l => ({ text: l, size: 9.5, color: C.goldDeep }))
      ),
    ], { bar: C.goldMid });
    gap(2);
  }
  gap(8);

  sectionTitle('Strong Fit Signals');
  for (const s of (battlecard?.bookingForm?.strongFitSignals || [])) {
    card(wrapText(`- ${s}`, regular, 10, CW - 24).map(l => ({ text: l, size: 10 })), {});
    gap(2);
  }

  // ── REFERRAL DETECTION ───────────────────────────────────
  addPage('Referral Detection');

  sectionTitle('Referral Detection Questions');
  for (const q of (battlecard?.bookingForm?.referralDetectionQuestions || [])) {
    card([
      { text: q.question || '', bold: true, size: 11 },
      ...(q.options || []).flatMap(o =>
        wrapText(`· ${o}`, regular, 9.5, CW - 36).map(l => ({ text: l, size: 9.5, color: C.goldDeep }))
      ),
      { text: `Signal: ${q.signalNote || ''}`, size: 9.5, color: C.signal },
    ], {});
    gap(2);
  }

  // ── OFFER MATCHING ───────────────────────────────────────
  addPage('Offer Matching');

  sectionTitle('Offer Matching Guide');
  for (const e of (battlecard?.offerMatchingGuide || [])) {
    card([
      { text: e.partnerType || '', bold: true, size: 12 },
      { text: `Lead Offer: ${e.leadOffer || ''}`, size: 9.5, color: C.goldMid },
      ...wrapText(e.positioningAngle || '', regular, 10, CW - 24).map(l => ({ text: l, size: 10 })),
      { text: `Relationship: ${e.relationshipType || ''}`, size: 9, color: C.goldDeep },
    ], { bar: C.goldMid });
    gap(2);
  }

  // ── REFERRAL PITCH ───────────────────────────────────────
  if (pitch?.irpReferralPitch) {
    addPage('Referral Pitch');
    sectionTitle('IRP Referral Pitch — Post-Episode Script');

    const irp = pitch.irpReferralPitch;
    const steps = [
      { label: '01  Transition Line',       body: irp.transitionLine },
      { label: '02  Synergy Observation',   body: irp.synergyObservation },
      { label: '03  The Offer Frame',       body: irp.offerFrame },
      { label: '04  The Ask',              body: irp.theAsk },
      { label: '05  The Free Give',         body: irp.theFreeGive },
      { label: '06  Urgency Close',         body: irp.urgencyClose },
      { label: '07  Soft Close',            body: irp.softClose },
    ];

    for (const s of steps) {
      if (!s.body) continue;
      card([
        { text: s.label, bold: true, size: 9, color: C.goldMid },
        ...wrapText(s.body, regular, 10.5, CW - 28).map(l => ({ text: l, size: 10.5 })),
      ], { bar: C.gold });
      gap(4);
    }
  }

  if (pitch?.missingInputs?.length) {
    addPage('Missing Inputs');
    sectionTitle('Missing Inputs');
    for (const m of pitch.missingInputs) {
      card([{ text: `· ${m}`, size: 10.5, color: C.goldDeep }], { bar: C.goldMid });
    }
  }

  return await pdfDoc.save();
}

module.exports = { generatePDF };
