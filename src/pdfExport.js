const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const BRAND = {
  primary:   '#032225',
  accent:    '#E9BF5E',
  accentMid: '#B0863C',
  text:      '#041A1C',
  muted:     '#966C2B',
  cardBg:    '#F7F5F0',
  signal:    '#059669',
};

function hexToRgb(hex) {
  const h = (hex || '#000000').replace('#', '');
  return rgb(
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  );
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text || '').split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

async function generatePDF(battlecard, _colors = {}, pitch = null) {
  const C = {
    primary:   hexToRgb(BRAND.primary),
    accent:    hexToRgb(BRAND.accent),
    accentMid: hexToRgb(BRAND.accentMid),
    text:      hexToRgb(BRAND.text),
    muted:     hexToRgb(BRAND.muted),
    cardBg:    hexToRgb(BRAND.cardBg),
    signal:    hexToRgb(BRAND.signal),
    white:     rgb(1, 1, 1),
    whiteDim:  rgb(0.8, 0.8, 0.8),
  };

  const pdfDoc = await PDFDocument.create();
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const mono    = await pdfDoc.embedFont(StandardFonts.Courier);

  const PAGE_W   = 612;
  const PAGE_H   = 792;
  const MARGIN   = 40;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const HEADER_H  = 72;
  const BOTTOM    = 50;

  const meta = battlecard.meta || {};
  const dateStr = meta.generatedAt
    ? new Date(meta.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  // ── Page / cursor state ──────────────────────────────
  let page, y;

  function addPage(subtitle = '') {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);

    // Header bar
    page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: PAGE_W, height: HEADER_H, color: C.primary });

    const podName = meta.podcastName || '';
    const client  = meta.clientName  || '';
    const niche   = meta.niche        || '';

    page.drawText(podName, { x: MARGIN, y: PAGE_H - 26, font: bold, size: 16, color: C.white });
    page.drawText(`${client}${niche ? '  ·  ' + niche : ''}`, { x: MARGIN, y: PAGE_H - 44, font: regular, size: 9, color: C.accent });
    page.drawText(subtitle, { x: MARGIN, y: PAGE_H - 60, font: regular, size: 8, color: C.whiteDim });

    if (dateStr) {
      const dw = regular.widthOfTextAtSize(dateStr, 8);
      page.drawText(dateStr, { x: PAGE_W - MARGIN - dw, y: PAGE_H - 44, font: regular, size: 8, color: C.whiteDim });
    }

    y = PAGE_H - HEADER_H - 20;
  }

  // ── Helpers ─────────────────────────────────────────
  function needsSpace(h) {
    if (y - h < BOTTOM) addPage(currentSubtitle);
  }

  let currentSubtitle = '';
  function setSubtitle(s) { currentSubtitle = s; }

  function sectionTitle(text) {
    needsSpace(26);
    page.drawText(text.toUpperCase(), { x: MARGIN, y, font: bold, size: 8, color: C.muted });
    y -= 5;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: C.accent });
    y -= 14;
  }

  function gap(n = 10) { y -= n; }

  // Draw a card block — handles overflow onto new pages
  function card(drawFn, estimatedHeight) {
    if (y - estimatedHeight < BOTTOM) addPage(currentSubtitle);
    drawFn(page, y);
    y -= estimatedHeight + 6;
  }

  // Simple text card (fill + optional left border)
  function textCard(lines, opts = {}) {
    const LINE_H = 13;
    const PAD    = 9;
    const h = lines.length * LINE_H + PAD * 2;

    card((pg, startY) => {
      if (opts.fill) pg.drawRectangle({ x: MARGIN, y: startY - h, width: CONTENT_W, height: h, color: opts.fill });
      if (opts.border) pg.drawRectangle({ x: MARGIN, y: startY - h, width: 3, height: h, color: opts.border });

      let ty = startY - PAD - LINE_H + 3;
      const xOff = MARGIN + (opts.border ? 9 : 6);
      for (const ln of lines) {
        const txt  = String(ln.text !== undefined ? ln.text : ln);
        const font = ln.bold   ? bold : (ln.mono ? mono : regular);
        const size = ln.size   || 9;
        const col  = ln.color  || C.text;
        // clip to content width
        let clipped = txt;
        while (clipped.length > 1 && font.widthOfTextAtSize(clipped, size) > CONTENT_W - 20) {
          clipped = clipped.slice(0, -1);
        }
        pg.drawText(clipped, { x: xOff, y: ty, font, size, color: col });
        ty -= LINE_H;
      }
    }, h);
  }

  function txt(text, opts = {}) {
    return { text, ...opts };
  }

  // ════════════════════════════════════════════════════
  // PAGE 1 — Offer Stack + IRP
  // ════════════════════════════════════════════════════
  setSubtitle('Offer Stack · IRP List');
  addPage(currentSubtitle);

  // ── Offer Stack ──
  sectionTitle('Offer Stack');
  for (const o of (battlecard.offerStack || [])) {
    const lines = [
      txt(`${o.name || 'Untitled'}  —  ${o.format || ''}`, { bold: true, size: 11, color: C.text }),
      txt(`Price: ${o.price || 'N/A'}`, { size: 9, color: C.muted }),
      ...wrapText(o.transformation || '', regular, 9, CONTENT_W - 20).map(l => txt(l, { size: 9 })),
    ];
    textCard(lines, { fill: C.cardBg });
  }
  if (!(battlecard.offerStack || []).length) textCard([txt('(none)')], {});
  gap();

  // ── Job Titles ──
  sectionTitle('Job Titles');
  const jobTitles = (battlecard.irpList?.jobTitles || []).join('  ·  ');
  const jtLines = wrapText(jobTitles || '(none)', regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9 }));
  textCard(jtLines, { fill: C.cardBg });
  gap();

  // ── Industry Tags ──
  sectionTitle('Industry Tags');
  const indTags = (battlecard.irpList?.industryTags || []).join('  ·  ');
  const itLines = wrapText(indTags || '(none)', regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9 }));
  textCard(itLines, {});
  gap();

  // ── Seniority Levels ──
  sectionTitle('Seniority Levels');
  for (const s of (battlecard.irpList?.seniorityLevels || [])) {
    const lines = [
      txt(`${s.level || ''}`, { bold: true, size: 10 }),
      txt(`Priority: ${s.priority || ''}  —  ${s.reason || ''}`, { size: 9, color: C.muted }),
    ];
    textCard(lines, { fill: C.cardBg });
  }
  if (!(battlecard.irpList?.seniorityLevels || []).length) textCard([txt('(none)')], {});
  gap();

  // ── Company Size ──
  const cs = battlecard.irpList?.companySize;
  if (cs) {
    sectionTitle('Company Size');
    const lines = [
      txt(`Employees: ${cs.employeeRange || 'N/A'}     Revenue: ${cs.revenueRange || 'N/A'}`, { bold: true, size: 10 }),
      ...wrapText(cs.rationale || '', regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9, color: C.muted })),
    ];
    textCard(lines, { fill: C.cardBg });
    gap();
  }

  // ── Geography ──
  const geo = battlecard.irpList?.geography;
  if (geo?.primary) {
    sectionTitle('Geography');
    const lines = [
      txt(geo.primary, { bold: true, size: 10 }),
      ...wrapText(geo.notes || '', regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9, color: C.muted })),
    ];
    textCard(lines, { fill: C.cardBg });
    gap();
  }

  // ── Keywords ──
  sectionTitle('Keywords');
  const kw = (battlecard.irpList?.keywords || []).join(',  ');
  const kwLines = wrapText(kw || '(none)', regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9 }));
  textCard(kwLines, {});
  gap();

  // ── Intent Signals ──
  sectionTitle('Intent Signals');
  const sig = (battlecard.irpList?.intentSignals || []).join('  ·  ');
  const sigLines = wrapText(sig || '(none)', regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9, color: C.muted }));
  textCard(sigLines, { fill: C.cardBg });
  gap();

  // ── Boolean String ──
  if (battlecard.irpList?.booleanString) {
    sectionTitle('Boolean Search String');
    const boolLines = wrapText(battlecard.irpList.booleanString, mono, 8, CONTENT_W - 20)
      .map(l => txt(l, { mono: true, size: 8, color: C.accent }));
    textCard(boolLines, { fill: C.primary });
    gap();
  }

  // ════════════════════════════════════════════════════
  // PAGE 2 — Booking Form
  // ════════════════════════════════════════════════════
  setSubtitle('Booking Form');
  addPage(currentSubtitle);

  // ── Qualifying Questions ──
  sectionTitle('Qualifying Questions');
  for (const q of (battlecard.bookingForm?.qualifyingQuestions || [])) {
    const lines = [
      txt(q.question || '', { bold: true, size: 10 }),
      txt('Disqualify if selected:', { size: 8, color: C.accentMid }),
      ...(q.disqualifyingAnswers || []).flatMap(a =>
        wrapText(`· ${a}`, regular, 9, CONTENT_W - 22).map(l => txt(l, { size: 9, color: C.muted }))
      ),
    ];
    textCard(lines, { fill: C.cardBg, border: C.accentMid });
  }
  if (!(battlecard.bookingForm?.qualifyingQuestions || []).length) textCard([txt('(none)')], {});
  gap();

  // ── Strong Fit Signals ──
  sectionTitle('Strong Fit Signals');
  for (const s of (battlecard.bookingForm?.strongFitSignals || [])) {
    const lines = wrapText(`- ${s}`, regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9 }));
    textCard(lines, { fill: C.cardBg });
  }
  if (!(battlecard.bookingForm?.strongFitSignals || []).length) textCard([txt('(none)')], {});
  gap();

  // ════════════════════════════════════════════════════
  // PAGE 3 — Referral Detection + Offer Matching
  // ════════════════════════════════════════════════════
  setSubtitle('Referral Detection · Offer Matching');
  addPage(currentSubtitle);

  // ── Referral Detection ──
  sectionTitle('Referral Detection Questions');
  for (const q of (battlecard.bookingForm?.referralDetectionQuestions || [])) {
    const lines = [
      txt(q.question || '', { bold: true, size: 10 }),
      ...(q.options || []).flatMap(o =>
        wrapText(`· ${o}`, regular, 9, CONTENT_W - 22).map(l => txt(l, { size: 9, color: C.muted }))
      ),
      txt(`Signal: ${q.signalNote || ''}`, { size: 9, color: C.signal }),
    ];
    textCard(lines, { fill: C.cardBg });
  }
  if (!(battlecard.bookingForm?.referralDetectionQuestions || []).length) textCard([txt('(none)')], {});
  gap();

  // ── Offer Matching Guide ──
  sectionTitle('Offer Matching Guide');
  for (const entry of (battlecard.offerMatchingGuide || [])) {
    const lines = [
      txt(entry.partnerType || '', { bold: true, size: 11 }),
      txt(`Lead Offer: ${entry.leadOffer || ''}`, { size: 9, color: C.accentMid }),
      ...wrapText(entry.positioningAngle || '', regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9 })),
      txt(`Relationship: ${entry.relationshipType || ''}`, { size: 8, color: C.muted }),
    ];
    textCard(lines, { fill: C.cardBg });
  }
  if (!(battlecard.offerMatchingGuide || []).length) textCard([txt('(none)')], {});

  // ════════════════════════════════════════════════════
  // PITCH PAGES (if pitch data provided)
  // ════════════════════════════════════════════════════
  if (pitch) {

    // ── IRP Referral Pitch ──
    if (pitch.irpReferralPitch) {
      setSubtitle('IRP Referral Pitch');
      addPage(currentSubtitle);

      sectionTitle('IRP Referral Pitch — Post-Episode Script');

      const irp = pitch.irpReferralPitch;
      const pitchSections = [
        { label: '1. Transition Line',         body: irp.transitionLine },
        { label: '2. Synergy Observation',      body: irp.synergyObservation },
        { label: '3. The Offer Frame',          body: irp.offerFrame },
        { label: '4. The Ask',                  body: irp.theAsk },
        { label: '5. The Free Give',            body: irp.theFreeGive },
        { label: '6. Urgency Close',            body: irp.urgencyClose },
        { label: '7. Soft Close',               body: irp.softClose },
      ];

      for (const s of pitchSections) {
        if (!s.body) continue;
        const labelLines = [txt(s.label, { bold: true, size: 9, color: C.accentMid })];
        const bodyLines  = wrapText(s.body, regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9 }));
        textCard([...labelLines, ...bodyLines], { fill: C.cardBg });
        gap(4);
      }
    }

    // Missing inputs notice
    if (pitch.missingInputs && pitch.missingInputs.length) {
      setSubtitle('Pitch — Missing Inputs');
      addPage(currentSubtitle);
      sectionTitle('Missing Inputs — Pitch Cannot Be Generated');
      for (const m of pitch.missingInputs) {
        textCard([txt(`· ${m}`, { size: 9, color: C.accentMid })], { fill: C.cardBg });
      }
    }

    // ── ICP List ──
    if (pitch.icpList) {
      setSubtitle('ICP List');
      addPage(currentSubtitle);
      sectionTitle('ICP List — Ideal Client Profile');

      const icp = pitch.icpList;

      sectionTitle('Job Titles');
      textCard(
        wrapText((icp.jobTitles || []).join('  ·  ') || '(none)', regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9 })),
        { fill: C.cardBg }
      );
      gap();

      sectionTitle('Industry Tags');
      textCard(
        wrapText((icp.industryTags || []).join('  ·  ') || '(none)', regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9 })),
        {}
      );
      gap();

      if (icp.companySize || icp.revenueRange) {
        sectionTitle('Company Size & Revenue');
        textCard([
          txt(`Employees: ${icp.companySize || 'N/A'}     Revenue: ${icp.revenueRange || 'N/A'}`, { bold: true, size: 10 }),
        ], { fill: C.cardBg });
        gap();
      }

      sectionTitle('Keywords & Intent Signals');
      const kwLine = [...(icp.keywords || []), ...(icp.intentSignals || [])].join(',  ');
      textCard(
        wrapText(kwLine || '(none)', regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9 })),
        {}
      );
      gap();

      if (icp.booleanString) {
        sectionTitle('Boolean Search String');
        textCard(
          wrapText(icp.booleanString, mono, 8, CONTENT_W - 20).map(l => txt(l, { mono: true, size: 8, color: C.accent })),
          { fill: C.primary }
        );
        gap();
      }
    }

    // ── ICP Sales Pitch ──
    if (pitch.icpSalesPitch) {
      setSubtitle('ICP Sales Pitch');
      addPage(currentSubtitle);
      sectionTitle('ICP Sales Pitch — Post-Episode Script');

      const icp = pitch.icpSalesPitch;
      const icpSections = [
        { label: '1. Transition Line',          body: icp.transitionLine },
        { label: '2. Reflection & Validation',  body: icp.reflectionValidation },
        { label: '3. The Problem Bridge',       body: icp.problemBridge },
        { label: '4. The Offer Invitation',     body: icp.offerInvitation },
        { label: '5. The Next Step',            body: icp.nextStep },
        { label: '6. Soft Close',               body: icp.softClose },
      ];

      for (const s of icpSections) {
        if (!s.body) continue;
        const labelLines = [txt(s.label, { bold: true, size: 9, color: C.accentMid })];
        const bodyLines  = wrapText(s.body, regular, 9, CONTENT_W - 14).map(l => txt(l, { size: 9 }));
        textCard([...labelLines, ...bodyLines], { fill: C.cardBg });
        gap(4);
      }
    }
  }

  return await pdfDoc.save();
}

module.exports = { generatePDF };
