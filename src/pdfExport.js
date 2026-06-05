const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// ── Brand colors (exact from brand guide) ──────────────
const B = {
  primary:    '#032225',
  primaryAlt: '#041A1C',
  gold:       '#E9BF5E',
  goldMid:    '#B0863C',
  goldDeep:   '#966C2B',
  goldDark:   '#A87E36',
  cardBg:     '#F7F5F0',
  white:      '#FFFFFF',
  black:      '#000000',
};

function hex(h) {
  const s = (h||'#000').replace('#','');
  return rgb(parseInt(s.slice(0,2),16)/255, parseInt(s.slice(2,4),16)/255, parseInt(s.slice(4,6),16)/255);
}

const C = {
  primary:  hex(B.primary),
  gold:     hex(B.gold),
  goldMid:  hex(B.goldMid),
  goldDeep: hex(B.goldDeep),
  goldDark: hex(B.goldDark),
  cardBg:   hex(B.cardBg),
  white:    hex(B.white),
  black:    hex(B.black),
  text:     hex(B.primaryAlt),
  offWhite: rgb(0.97,0.96,0.94),
  dimWhite: rgb(0.85,0.85,0.85),
  subtleGold: rgb(0.91,0.75,0.37),
};

function wrap(text, font, size, maxW) {
  const words = String(text||'').split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur+' '+w : w;
    if (font.widthOfTextAtSize(t, size) <= maxW) { cur = t; }
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function clip(text, font, size, maxW) {
  let s = String(text||'');
  while (s.length > 1 && font.widthOfTextAtSize(s+'…', size) > maxW) s = s.slice(0,-1);
  return font.widthOfTextAtSize(String(text||''), size) > maxW ? s+'…' : String(text||'');
}

async function generatePDF(battlecard, _colors={}, pitch=null) {
  const pdfDoc = await PDFDocument.create();

  // Use Times for serif display (closest to Playfair), Helvetica for body
  const serifBold  = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const serif      = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const sansBold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const sans       = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const mono       = await pdfDoc.embedFont(StandardFonts.Courier);

  const W = 612, H = 792;
  const ML = 48, MR = 48;
  const CW = W - ML - MR;
  const FOOTER_H = 28;
  const BOTTOM = FOOTER_H + 20;

  const meta    = battlecard?.meta || {};
  const podName = meta.podcastName || 'Podcast Battlecard';
  const client  = meta.clientName  || '';
  const niche   = meta.niche       || '';
  const dateStr = meta.generatedAt
    ? new Date(meta.generatedAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})
    : new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

  let page, y, pageNum = 0, currentSection = '';

  // ── Footer ─────────────────────────────────────────────
  function drawFooter(pg, num, label) {
    pg.drawRectangle({x:0, y:0, width:W, height:FOOTER_H, color:C.primary});
    pg.drawLine({start:{x:0,y:FOOTER_H}, end:{x:W,y:FOOTER_H}, thickness:1, color:C.gold});
    pg.drawText('PROJECT ICON', {x:ML, y:10, font:sansBold, size:7, color:C.gold});
    if (label) pg.drawText(label.toUpperCase(), {x:ML+90, y:10, font:sans, size:7, color:C.dimWhite});
    const pg_str = `${num}`;
    const pw = sans.widthOfTextAtSize(pg_str, 8);
    pg.drawText(pg_str, {x:W-MR-pw, y:10, font:sans, size:8, color:C.dimWhite});
  }

  // ── Page header bar ────────────────────────────────────
  function drawHeader(pg, subtitle) {
    const HBAR = 80;
    pg.drawRectangle({x:0, y:H-HBAR, width:W, height:HBAR, color:C.primary});
    // Gold accent line at bottom of header
    pg.drawLine({start:{x:0,y:H-HBAR}, end:{x:W,y:H-HBAR}, thickness:1.5, color:C.gold});

    // "PROJECT ICON" tiny label
    pg.drawText('PROJECT ICON', {x:ML, y:H-16, font:sansBold, size:7.5, color:C.gold});

    // Podcast name — large serif
    const pnSize = 20;
    pg.drawText(clip(podName, serifBold, pnSize, CW*0.72), {x:ML, y:H-38, font:serifBold, size:pnSize, color:C.white});

    // Client + niche below
    const sub = `${client}${niche ? '  ·  '+niche : ''}`;
    pg.drawText(clip(sub, sans, 9, CW*0.72), {x:ML, y:H-56, font:sans, size:9, color:C.subtleGold});

    // Subtitle label right-aligned
    if (subtitle) {
      const sw = sans.widthOfTextAtSize(subtitle.toUpperCase(), 8);
      pg.drawText(subtitle.toUpperCase(), {x:W-MR-sw, y:H-56, font:sansBold, size:8, color:C.dimWhite});
    }

    // Date far right
    const dw = sans.widthOfTextAtSize(dateStr, 8);
    pg.drawText(dateStr, {x:W-MR-dw, y:H-38, font:sans, size:8, color:C.dimWhite});
  }

  function newPage(subtitle='') {
    pageNum++;
    currentSection = subtitle;
    page = pdfDoc.addPage([W, H]);
    page.drawRectangle({x:0, y:0, width:W, height:H, color:C.white});
    drawHeader(page, subtitle);
    drawFooter(page, pageNum, subtitle);
    y = H - 80 - 28; // below header, above footer
  }

  function needsSpace(h) {
    if (y - h < BOTTOM) newPage(currentSection);
  }

  function gap(n=14) { y -= n; }

  // ── Section heading ────────────────────────────────────
  function sectionHeading(label) {
    needsSpace(32);
    const lw = sansBold.widthOfTextAtSize(label.toUpperCase(), 8.5);
    page.drawText(label.toUpperCase(), {x:ML, y, font:sansBold, size:8.5, color:C.goldDeep});
    // Full-width gold rule
    page.drawLine({start:{x:ML,y:y-5}, end:{x:W-MR,y:y-5}, thickness:1, color:C.gold});
    y -= 18;
  }

  // ── Stat pill row (two columns) ─────────────────────────
  function statRow(items) {
    // items: [{label, value}]
    const colW = (CW - 12) / 2;
    let col = 0;
    for (let i=0; i<items.length; i+=2) {
      const rowH = 52;
      needsSpace(rowH);
      const pairs = items.slice(i, i+2);
      pairs.forEach((item, idx) => {
        const bx = ML + idx*(colW+12);
        page.drawRectangle({x:bx, y:y-rowH, width:colW, height:rowH, color:C.cardBg});
        page.drawLine({start:{x:bx,y:y-rowH+rowH}, end:{x:bx+colW,y:y-rowH+rowH}, thickness:0, color:C.gold});
        page.drawRectangle({x:bx, y:y-rowH, width:3, height:rowH, color:C.gold});
        page.drawText(item.label.toUpperCase(), {x:bx+10, y:y-16, font:sansBold, size:7.5, color:C.goldDeep});
        const val = clip(item.value||'—', serifBold, 16, colW-18);
        page.drawText(val, {x:bx+10, y:y-34, font:serifBold, size:16, color:C.text});
      });
      y -= rowH + 8;
    }
  }

  // ── Tag cloud ───────────────────────────────────────────
  function tagCloud(items, opts={}) {
    if (!items?.length) return;
    const TAG_H = 20, TAG_PAD = 10, GAP = 6, LINE_GAP = 7;
    let cx = ML;
    let rowTop = y;
    needsSpace(TAG_H);

    for (const item of items) {
      const tw = (opts.font||sans).widthOfTextAtSize(item, opts.size||9.5) + TAG_PAD*2;
      if (cx + tw > W - MR && cx > ML) {
        y -= TAG_H + LINE_GAP;
        cx = ML;
        rowTop = y;
        needsSpace(TAG_H);
      }
      const tagBg = opts.dark ? C.primary : C.cardBg;
      const tagTxt = opts.dark ? C.gold : C.text;
      page.drawRectangle({x:cx, y:y-TAG_H, width:tw, height:TAG_H, color:tagBg});
      page.drawLine({start:{x:cx,y:y-TAG_H}, end:{x:cx+tw,y:y-TAG_H}, thickness:1, color:C.gold});
      page.drawLine({start:{x:cx,y:y}, end:{x:cx+tw,y:y}, thickness:0.5, color:C.gold});
      page.drawLine({start:{x:cx,y:y-TAG_H}, end:{x:cx,y:y}, thickness:0.5, color:C.gold});
      page.drawLine({start:{x:cx+tw,y:y-TAG_H}, end:{x:cx+tw,y:y}, thickness:0.5, color:C.gold});
      page.drawText(item, {x:cx+TAG_PAD, y:y-TAG_H+6, font:opts.font||sans, size:opts.size||9.5, color:tagTxt});
      cx += tw + GAP;
    }
    y -= TAG_H + 10;
  }

  // ── Content card ────────────────────────────────────────
  function card(lines, opts={}) {
    const LH = opts.lineH || 16;
    const PAD_V = opts.padV || 12;
    const PAD_H = 14;
    const h = lines.length * LH + PAD_V * 2;
    needsSpace(h);
    if (opts.bg !== false) {
      page.drawRectangle({x:ML, y:y-h, width:CW, height:h, color:opts.bg||C.cardBg});
    }
    if (opts.leftBar) {
      page.drawRectangle({x:ML, y:y-h, width:4, height:h, color:opts.leftBar});
    }
    if (opts.topRule) {
      page.drawLine({start:{x:ML,y:y}, end:{x:ML+CW,y:y}, thickness:0.75, color:C.gold});
    }
    let ty = y - PAD_V - LH + 4;
    for (const ln of lines) {
      if (typeof ln === 'string') {
        page.drawText(clip(ln, sans, 10.5, CW-PAD_H*2), {x:ML+PAD_H+(opts.leftBar?6:0), y:ty, font:sans, size:10.5, color:C.text});
      } else {
        const font = ln.serif ? serifBold : (ln.bold ? sansBold : (ln.mono ? mono : sans));
        const size = ln.size || 10.5;
        const color = ln.color || C.text;
        const maxW = CW - PAD_H*2 - (opts.leftBar?6:0);
        const wrapped = wrap(ln.text||'', font, size, maxW);
        for (let wi=0; wi<wrapped.length; wi++) {
          if (wi > 0) { ty -= LH; }
          page.drawText(wrapped[wi], {x:ML+PAD_H+(opts.leftBar?6:0), y:ty, font, size, color});
        }
        if (wrapped.length > 1) ty -= LH * (wrapped.length - 1);
      }
      ty -= LH;
    }
    y -= h + 8;
  }

  // ── Dark box (boolean string, pitch steps) ─────────────
  function darkBox(lines, label) {
    const LH = 15;
    const PAD_V = 14, PAD_H = 16;
    const h = lines.length * LH + PAD_V * 2 + (label ? 22 : 0);
    needsSpace(h);
    page.drawRectangle({x:ML, y:y-h, width:CW, height:h, color:C.primary});
    page.drawLine({start:{x:ML,y:y-h}, end:{x:ML+CW,y:y-h}, thickness:0.5, color:C.goldMid});
    page.drawLine({start:{x:ML,y:y}, end:{x:ML+CW,y:y}, thickness:0.5, color:C.goldMid});
    page.drawRectangle({x:ML, y:y-h, width:4, height:h, color:C.gold});
    let ty = y - PAD_V - (label ? 22 : 0);
    if (label) {
      page.drawText(label.toUpperCase(), {x:ML+PAD_H, y:ty+8, font:sansBold, size:7.5, color:C.goldDeep});
      page.drawLine({start:{x:ML+PAD_H,y:ty}, end:{x:ML+CW-PAD_H,y:ty}, thickness:0.5, color:C.goldMid});
      ty -= 14;
    }
    for (const ln of lines) {
      const t = typeof ln === 'string' ? ln : (ln.text||'');
      const font = (typeof ln === 'object' && ln.mono) ? mono : sans;
      const size = (typeof ln === 'object' && ln.size) ? ln.size : 9.5;
      const color = (typeof ln === 'object' && ln.color) ? ln.color : C.gold;
      const ws = wrap(t, font, size, CW-PAD_H*2-8);
      for (const w of ws) {
        page.drawText(w, {x:ML+PAD_H, y:ty, font, size, color});
        ty -= LH;
      }
    }
    y -= h + 10;
  }

  // ── IRP / ICP section renderer ─────────────────────────
  function renderListSection(data, prefix) {
    if (!data) return;

    // Job Titles
    sectionHeading(`${prefix} — Job Titles`);
    tagCloud(data.jobTitles||[], {});
    gap(4);

    // Seniority Levels
    if ((data.seniorityLevels||[]).length) {
      sectionHeading(`${prefix} — Seniority Levels`);
      for (const s of data.seniorityLevels) {
        card([
          {text: s.level||'', serif:true, size:13, color:C.text},
          {text: `Priority: ${s.priority||''}  ·  ${s.reason||''}`, size:10, color:C.goldDeep},
        ], {topRule:true});
      }
      gap(4);
    }

    // Industry Tags
    sectionHeading(`${prefix} — Industry Tags`);
    tagCloud(data.industryTags||[], {size:9.5});
    gap(4);

    // Company Size & Revenue
    const cs = data.companySize;
    if (cs) {
      sectionHeading(`${prefix} — Company Size`);
      statRow([
        {label:'Employees', value: cs.employeeRange||'—'},
        {label:'Revenue',   value: cs.revenueRange||'—'},
      ]);
      if (cs.rationale) {
        const ratLines = wrap(cs.rationale, sans, 10, CW-28).map(l=>({text:l,size:10,color:C.goldDeep}));
        card(ratLines, {bg:C.cardBg});
      }
      gap(4);
    }

    // Geography
    if (data.geography?.primary) {
      sectionHeading(`${prefix} — Geography`);
      const geoLines = [{text:data.geography.primary, bold:true, size:12}];
      if (data.geography.notes) {
        wrap(data.geography.notes, sans, 10, CW-28).forEach(l=>geoLines.push({text:l,size:10,color:C.goldDeep}));
      }
      card(geoLines, {bg:C.cardBg});
      gap(4);
    }

    // Keywords
    sectionHeading(`${prefix} — Keywords & Skills`);
    tagCloud(data.keywords||[], {size:9.5});
    gap(4);

    // Intent Signals
    sectionHeading(`${prefix} — Intent Signals`);
    tagCloud(data.intentSignals||[], {dark:true, size:9});
    gap(4);

    // Boolean String
    if (data.booleanString) {
      sectionHeading(`${prefix} — Boolean Search String`);
      darkBox(
        wrap(data.booleanString, mono, 8.5, CW-40).map(l=>({text:l,mono:true,size:8.5})),
        'Ready to paste into Sales Nav or Apollo'
      );
      gap(4);
    }
  }

  // ══════════════════════════════════════════════════════════
  // COVER PAGE
  // ══════════════════════════════════════════════════════════
  page = pdfDoc.addPage([W, H]);
  pageNum++;

  // Full dark background
  page.drawRectangle({x:0,y:0,width:W,height:H,color:C.primary});

  // Top gold line
  page.drawLine({start:{x:0,y:H-1},end:{x:W,y:H-1},thickness:2,color:C.gold});

  // "PROJECT ICON" wordmark
  const piW = serifBold.widthOfTextAtSize('PROJECT ICON', 11);
  page.drawText('PROJECT ICON', {x:(W-piW)/2, y:H-52, font:serifBold, size:11, color:C.gold});

  // Thin gold rule
  page.drawLine({start:{x:ML*2,y:H-68},end:{x:W-ML*2,y:H-68},thickness:0.75,color:hex(B.goldMid)});

  // "PODCAST GUEST BATTLECARD" label
  const bcW = sans.widthOfTextAtSize('PODCAST GUEST BATTLECARD', 9);
  page.drawText('PODCAST GUEST BATTLECARD', {x:(W-bcW)/2, y:H-88, font:sans, size:9, color:C.dimWhite});

  // Large podcast name - centered
  const pnSize = podName.length > 28 ? 26 : 32;
  const pnLines = wrap(podName, serifBold, pnSize, CW);
  const pnTotalH = pnLines.length * (pnSize + 8);
  let pnY = H/2 + pnTotalH/2 + 30;
  for (const line of pnLines) {
    const lw = serifBold.widthOfTextAtSize(line, pnSize);
    page.drawText(line, {x:(W-lw)/2, y:pnY, font:serifBold, size:pnSize, color:C.gold});
    pnY -= pnSize + 8;
  }

  // Decorative gold rule below name
  page.drawLine({start:{x:ML*2,y:H/2-18},end:{x:W-ML*2,y:H/2-18},thickness:0.75,color:hex(B.goldMid)});

  // Client name
  if (client) {
    const cnW = sans.widthOfTextAtSize(client, 14);
    page.drawText(client, {x:(W-cnW)/2, y:H/2-42, font:sans, size:14, color:C.white});
  }
  if (niche) {
    const niW = sans.widthOfTextAtSize(niche, 11);
    page.drawText(niche, {x:(W-niW)/2, y:H/2-62, font:sans, size:11, color:C.subtleGold});
  }

  // Date at bottom
  const dtW = sans.widthOfTextAtSize(dateStr, 9);
  page.drawText(dateStr, {x:(W-dtW)/2, y:80, font:sans, size:9, color:C.dimWhite});

  // Bottom gold line
  page.drawLine({start:{x:0,y:40},end:{x:W,y:40},thickness:1,color:C.gold});
  page.drawLine({start:{x:0,y:1},end:{x:W,y:1},thickness:2,color:C.gold});

  drawFooter(page, pageNum, 'Cover');

  // ══════════════════════════════════════════════════════════
  // PAGE GROUP 1 — Offer Stack
  // ══════════════════════════════════════════════════════════
  newPage('Offer Stack');
  sectionHeading('Offer Stack');
  for (const o of (battlecard?.offerStack||[])) {
    const offerLines = [
      {text: o.name||'Untitled', serif:true, size:15, color:C.text},
      {text: `${o.format||''} · ${o.price||''}`, size:10, color:C.goldMid, bold:true},
      ...wrap(o.transformation||'', sans, 10.5, CW-36).map(l=>({text:l, size:10.5})),
    ];
    card(offerLines, {bg:C.cardBg, leftBar:C.gold, topRule:true});
  }
  if (!(battlecard?.offerStack||[]).length) card([{text:'(none provided)', size:10.5, color:C.goldDeep}], {bg:C.cardBg});

  // ══════════════════════════════════════════════════════════
  // PAGE GROUP 2 — IRP List
  // ══════════════════════════════════════════════════════════
  newPage('IRP List — Ideal Referral Partner');
  renderListSection(battlecard?.irpList, 'IRP');

  // ══════════════════════════════════════════════════════════
  // PAGE GROUP 3 — ICP List (only if present)
  // ══════════════════════════════════════════════════════════
  if (battlecard?.icpList) {
    newPage('ICP List — Ideal Client Profile');
    renderListSection(battlecard.icpList, 'ICP');
  }

  // ══════════════════════════════════════════════════════════
  // PAGE GROUP 4 — Booking Form
  // ══════════════════════════════════════════════════════════
  newPage('Booking Form');

  sectionHeading('Qualifying Questions');
  for (const q of (battlecard?.bookingForm?.qualifyingQuestions||[])) {
    const lines = [
      {text: q.question||'', serif:true, size:13},
      {text: 'Disqualify if:', bold:true, size:8.5, color:C.goldMid},
      ...(q.disqualifyingAnswers||[]).flatMap(a=>
        wrap(`· ${a}`, sans, 10, CW-42).map(l=>({text:l, size:10, color:C.goldDeep}))
      ),
    ];
    card(lines, {bg:C.cardBg, leftBar:hex(B.goldMid)});
  }
  gap(8);

  sectionHeading('Strong Fit Signals');
  for (const s of (battlecard?.bookingForm?.strongFitSignals||[])) {
    card(wrap(`— ${s}`, sans, 10.5, CW-28).map(l=>({text:l,size:10.5})), {bg:C.cardBg});
  }
  gap(8);

  // ══════════════════════════════════════════════════════════
  // PAGE GROUP 5 — Referral Detection
  // ══════════════════════════════════════════════════════════
  newPage('Referral Detection');

  sectionHeading('Referral Detection Questions');
  for (const q of (battlecard?.bookingForm?.referralDetectionQuestions||[])) {
    const lines = [
      {text: q.question||'', serif:true, size:13},
      ...(q.options||[]).flatMap(o=>
        wrap(`· ${o}`, sans, 10, CW-42).map(l=>({text:l, size:10, color:C.goldDeep}))
      ),
      {text: `Signal: ${q.signalNote||''}`, size:9.5, color:hex('#059669'), bold:true},
    ];
    card(lines, {bg:C.cardBg, topRule:true});
  }
  gap(8);

  // ══════════════════════════════════════════════════════════
  // PAGE GROUP 6 — Offer Matching
  // ══════════════════════════════════════════════════════════
  newPage('Offer Matching Guide');

  sectionHeading('Offer Matching Guide');
  for (const e of (battlecard?.offerMatchingGuide||[])) {
    const lines = [
      {text: e.partnerType||'', serif:true, size:14},
      {text: `Lead Offer: ${e.leadOffer||''}`, bold:true, size:10, color:C.goldMid},
      ...wrap(e.positioningAngle||'', sans, 10.5, CW-28).map(l=>({text:l,size:10.5})),
      {text: `Relationship Type: ${e.relationshipType||''}`, size:9.5, color:C.goldDeep},
    ];
    card(lines, {bg:C.cardBg, leftBar:C.goldMid});
  }

  // ══════════════════════════════════════════════════════════
  // PAGE GROUP 7 — Referral Pitch
  // ══════════════════════════════════════════════════════════
  if (pitch?.irpReferralPitch) {
    newPage('Referral Pitch — Post-Episode Script');

    const irp = pitch.irpReferralPitch;
    const steps = [
      {num:'01', label:'Transition Line',       body: irp.transitionLine},
      {num:'02', label:'Synergy Observation',   body: irp.synergyObservation},
      {num:'03', label:'The Offer Frame',       body: irp.offerFrame},
      {num:'04', label:'The Ask',              body: irp.theAsk},
      {num:'05', label:'The Free Give',         body: irp.theFreeGive},
      {num:'06', label:'Urgency Close',         body: irp.urgencyClose},
      {num:'07', label:'Soft Close',            body: irp.softClose},
    ];

    for (const s of steps) {
      if (!s.body) continue;
      sectionHeading(`${s.num}  ${s.label}`);
      const bodyLines = wrap(s.body, sans, 11, CW-28).map(l=>({text:l,size:11}));
      card(bodyLines, {bg:C.cardBg, lineH:17, padV:14});
      gap(4);
    }
  }

  if (pitch?.missingInputs?.length) {
    newPage('Pitch — Missing Inputs');
    sectionHeading('Missing Inputs Required');
    for (const m of pitch.missingInputs) {
      card([{text:`· ${m}`, size:11, color:C.goldDeep}], {bg:C.cardBg, leftBar:hex(B.goldMid)});
    }
  }

  if (pitch?.icpSalesPitch) {
    newPage('ICP Sales Pitch — Post-Episode Script');
    const icp = pitch.icpSalesPitch;
    const steps = [
      {num:'01', label:'Transition Line',         body: icp.transitionLine},
      {num:'02', label:'Reflection & Validation', body: icp.reflectionValidation},
      {num:'03', label:'The Problem Bridge',      body: icp.problemBridge},
      {num:'04', label:'The Offer Invitation',    body: icp.offerInvitation},
      {num:'05', label:'The Next Step',           body: icp.nextStep},
      {num:'06', label:'Soft Close',              body: icp.softClose},
    ];
    for (const s of steps) {
      if (!s.body) continue;
      sectionHeading(`${s.num}  ${s.label}`);
      const bodyLines = wrap(s.body, sans, 11, CW-28).map(l=>({text:l,size:11}));
      card(bodyLines, {bg:C.cardBg, lineH:17, padV:14});
      gap(4);
    }
  }

  return await pdfDoc.save();
}

module.exports = { generatePDF };
