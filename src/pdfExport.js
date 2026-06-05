const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');

// ── Exact brand colors from Project ICON brand guide ───
function hex(h) {
  const s = (h||'#000').replace('#','');
  return rgb(parseInt(s.slice(0,2),16)/255, parseInt(s.slice(2,4),16)/255, parseInt(s.slice(4,6),16)/255);
}
const C = {
  dark:      hex('#032225'),
  darkAlt:   hex('#041A1C'),
  gold:      hex('#E9BF5E'),
  goldMid:   hex('#B0863C'),
  goldDeep:  hex('#966C2B'),
  goldDark:  hex('#A87E36'),
  goldLight: hex('#E9BF5E'),
  white:     rgb(1,1,1),
  offWhite:  hex('#F7F5F0'),
  dimWhite:  rgb(0.78,0.76,0.72),
  muted:     rgb(0.55,0.53,0.48),
  signal:    hex('#059669'),
  cardLine:  hex('#B0863C'),
};

function wrap(text, font, size, maxW) {
  const words = String(text||'').split(' ');
  const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur+' '+w : w;
    if (font.widthOfTextAtSize(t,size) <= maxW) { cur=t; }
    else { if(cur) lines.push(cur); cur=w; }
  }
  if(cur) lines.push(cur);
  return lines.length ? lines : [''];
}
function clip(text, font, size, maxW) {
  let s = String(text||'');
  while(s.length>1 && font.widthOfTextAtSize(s+'...', size)>maxW) s=s.slice(0,-1);
  return font.widthOfTextAtSize(String(text||''),size)>maxW ? s+'...' : String(text||'');
}
function center(text, font, size, x, w) {
  return x + (w - font.widthOfTextAtSize(text,size))/2;
}

async function generatePDF(battlecard, _c={}, pitch=null) {
  const pdfDoc = await PDFDocument.create();
  const SB  = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const SR  = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const HB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const H   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const HO  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const MO  = await pdfDoc.embedFont(StandardFonts.Courier);

  const W=612, PH=792, ML=52, MR=52, CW=W-ML-MR;
  const FOOTER=32, BOTTOM=FOOTER+16;

  const meta    = battlecard?.meta||{};
  const podName = meta.podcastName||'Podcast Battlecard';
  const client  = meta.clientName||'';
  const niche   = meta.niche||'';
  const dateStr = meta.generatedAt
    ? new Date(meta.generatedAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})
    : new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

  let pg, y, pgNum=0, pgSection='';

  // ── Diamond ornament ──────────────────────────────────
  function diamond(pg, cx, cy, size, color) {
    pg.drawSvgPath(`M 0 ${size} L ${size} 0 L ${size*2} ${size} L ${size} ${size*2} Z`,
      {x:cx-size, y:cy+size, color, scale:1});
  }

  // ── Thin horizontal rule with center diamond ──────────
  function goldRule(pg, rx, ry, rw, withDiamond=false) {
    pg.drawLine({start:{x:rx,y:ry},end:{x:rx+rw,y:ry},thickness:0.75,color:C.gold});
    if (withDiamond) {
      diamond(pg, rx+rw/2, ry, 4, C.gold);
    }
  }

  // ── Page footer ────────────────────────────────────────
  function footer(pg, num, section) {
    pg.drawRectangle({x:0,y:0,width:W,height:FOOTER,color:C.dark});
    pg.drawLine({start:{x:0,y:FOOTER},end:{x:W,y:FOOTER},thickness:0.75,color:C.gold});
    pg.drawText('PROJECT ICON', {x:ML,y:10,font:HB,size:7,color:C.gold});
    if(section) pg.drawText('· '+section.toUpperCase(), {x:ML+72,y:10,font:H,size:7,color:C.dimWhite});
    const pstr = String(num);
    pg.drawText(pstr, {x:W-MR-HB.widthOfTextAtSize(pstr,8)-2,y:10,font:HB,size:8,color:C.dimWhite});
  }

  // ── Section icon badge ─────────────────────────────────
  // Draws a filled dark circle with number, + label to the right
  function sectionBadge(pg, cx, cy, num, label, sublabel='') {
    const R=18;
    pg.drawEllipse({x:cx,y:cy,xScale:R,yScale:R,color:C.dark,borderColor:C.gold,borderWidth:1.5});
    const ns = String(num).padStart(2,'0');
    const nw = HB.widthOfTextAtSize(ns,9);
    pg.drawText(ns,{x:cx-nw/2,y:cy-5,font:HB,size:9,color:C.gold});
    pg.drawText(label.toUpperCase(),{x:cx+R+10,y:cy+3,font:HB,size:13,color:C.dark});
    if(sublabel) pg.drawText(sublabel,{x:cx+R+10,y:cy-12,font:H,size:9,color:C.goldDeep});
  }

  // ── New page ───────────────────────────────────────────
  function newPage(section='') {
    pgNum++;
    pgSection=section;
    pg = pdfDoc.addPage([W,PH]);
    pg.drawRectangle({x:0,y:0,width:W,height:PH,color:C.white});
    footer(pg,pgNum,section);
    y = PH-36;
  }

  // ── Dark page header bar (used at top of content pages) ─
  function pageHeader(title, subtitle='') {
    const HBAR=70;
    pg.drawRectangle({x:0,y:PH-HBAR,width:W,height:HBAR,color:C.dark});
    pg.drawLine({start:{x:0,y:PH-HBAR},end:{x:W,y:PH-HBAR},thickness:1.5,color:C.gold});
    // Small PROJECT ICON label
    pg.drawText('PROJECT ICON',{x:ML,y:PH-15,font:HB,size:7,color:C.gold});
    // Date
    const dw=H.widthOfTextAtSize(dateStr,8);
    pg.drawText(dateStr,{x:W-MR-dw,y:PH-15,font:H,size:8,color:C.dimWhite});
    // Podcast name
    pg.drawText(clip(podName,SB,18,CW*0.65),{x:ML,y:PH-36,font:SB,size:18,color:C.white});
    // Subtitle / section label right-aligned
    if(subtitle){
      const sw=H.widthOfTextAtSize(subtitle.toUpperCase(),8.5);
      pg.drawText(subtitle.toUpperCase(),{x:W-MR-sw,y:PH-36,font:HB,size:8.5,color:C.gold});
    }
    // Client + niche
    const sub=`${client}${niche?' · '+niche:''}`;
    pg.drawText(clip(sub,H,9,CW*0.65),{x:ML,y:PH-52,font:H,size:9,color:C.dimWhite});
    y = PH-HBAR-22;
  }

  function needsSpace(h) { if(y-h < BOTTOM) { newPage(pgSection); pageHeader(pgSection,pgSection); } }

  function gap(n=12) { y-=n; }

  // ── Section heading with icon ─────────────────────────
  let sectionCounter=0;
  function sectionHeading(label, sublabel='') {
    sectionCounter++;
    needsSpace(52);
    const sy = y-8;
    // Background strip
    pg.drawRectangle({x:ML-8,y:sy-34,width:CW+16,height:42,color:C.offWhite});
    pg.drawLine({start:{x:ML-8,y:sy+8},end:{x:ML+CW+8,y:sy+8},thickness:1,color:C.gold});
    pg.drawLine({start:{x:ML-8,y:sy-26},end:{x:ML+CW+8,y:sy-26},thickness:0.5,color:C.goldMid});
    // Badge circle
    const bx=ML+10, by=sy-9;
    pg.drawEllipse({x:bx,y:by,xScale:14,yScale:14,color:C.dark,borderColor:C.gold,borderWidth:1.5});
    const ns=String(sectionCounter).padStart(2,'0');
    pg.drawText(ns,{x:bx-HB.widthOfTextAtSize(ns,8)/2,y:by-4,font:HB,size:8,color:C.gold});
    // Label
    pg.drawText(label.toUpperCase(),{x:bx+22,y:by+2,font:HB,size:11,color:C.dark});
    if(sublabel) pg.drawText(sublabel,{x:bx+22,y:by-12,font:H,size:8.5,color:C.goldDeep});
    y -= 52;
  }

  // ── Content card ───────────────────────────────────────
  function card(lines, opts={}) {
    const LH=opts.lh||15.5;
    const PV=opts.pv||12, PH2=opts.ph||14;
    let totalLines=0;
    for(const ln of lines) {
      const t=typeof ln==='string'?ln:(ln.text||'');
      const font=typeof ln==='object'&&ln.serif?SB:(typeof ln==='object'&&ln.bold?HB:(typeof ln==='object'&&ln.mono?MO:H));
      const size=typeof ln==='object'&&ln.size?ln.size:10.5;
      totalLines+=wrap(t,font,size,CW-PH2*2-(opts.bar?8:0)).length;
    }
    const h=totalLines*LH+PV*2;
    needsSpace(h);

    // Card background
    const bg=opts.bg===false?null:(opts.bg||C.offWhite);
    if(bg) pg.drawRectangle({x:ML,y:y-h,width:CW,height:h,color:bg});

    // Top rule
    if(opts.topRule!==false) pg.drawLine({start:{x:ML,y:y},end:{x:ML+CW,y:y},thickness:0.5,color:C.gold});
    pg.drawLine({start:{x:ML,y:y-h},end:{x:ML+CW,y:y-h},thickness:0.5,color:C.offWhite});

    // Left accent bar
    if(opts.bar) pg.drawRectangle({x:ML,y:y-h,width:4,height:h,color:opts.bar});

    const xOff=ML+PH2+(opts.bar?6:0);
    let ty=y-PV;
    for(const ln of lines) {
      const t=typeof ln==='string'?ln:(ln.text||'');
      let font=H;
      if(typeof ln==='object'){
        if(ln.serif) font=SB;
        else if(ln.bold) font=HB;
        else if(ln.mono) font=MO;
        else if(ln.italic) font=HO;
      }
      const size=typeof ln==='object'&&ln.size?ln.size:10.5;
      const color=typeof ln==='object'&&ln.color?ln.color:C.dark;
      const mw=CW-PH2*2-(opts.bar?8:0);
      const ws=wrap(t,font,size,mw);
      for(const w of ws){
        ty-=LH;
        pg.drawText(w,{x:xOff,y:ty,font,size,color});
      }
    }
    y-=h+6;
  }

  // ── Tags / pills grid ──────────────────────────────────
  function tagGrid(items, opts={}) {
    if(!items?.length) { card([{text:'(none)',size:10,color:C.muted}],{bg:C.offWhite}); return; }
    const FONT=opts.bold?HB:H;
    const FS=opts.size||9.5;
    const PH2=9, GAP=6, PILL_H=21;
    let cx=ML;
    needsSpace(PILL_H);
    let rowStart=y;

    for(const item of items){
      const tw=FONT.widthOfTextAtSize(String(item),FS)+PH2*2;
      if(cx+tw>W-MR && cx>ML){
        y-=PILL_H+GAP; cx=ML;
        needsSpace(PILL_H);
      }
      const bg=opts.dark?C.dark:C.offWhite;
      const tc=opts.dark?C.gold:(opts.accent?C.goldDeep:C.darkAlt);
      const bc=opts.dark?C.goldMid:C.goldMid;
      pg.drawRectangle({x:cx,y:y-PILL_H,width:tw,height:PILL_H,color:bg});
      pg.drawLine({start:{x:cx,y:y-PILL_H},end:{x:cx+tw,y:y-PILL_H},thickness:0.75,color:bc});
      pg.drawLine({start:{x:cx,y:y},end:{x:cx+tw,y:y},thickness:0.75,color:bc});
      pg.drawLine({start:{x:cx,y:y-PILL_H},end:{x:cx,y:y},thickness:0.75,color:bc});
      pg.drawLine({start:{x:cx+tw,y:y-PILL_H},end:{x:cx+tw,y:y},thickness:0.75,color:bc});
      pg.drawText(String(item),{x:cx+PH2,y:y-PILL_H+6,font:FONT,size:FS,color:tc});
      cx+=tw+GAP;
    }
    y-=PILL_H+10;
  }

  // ── Two-column stat cards ──────────────────────────────
  function statCards(pairs) {
    const colW=(CW-10)/2, H2=58;
    needsSpace(H2+6);
    pairs.forEach(({label,value,sub},i)=>{
      const bx=ML+i*(colW+10);
      pg.drawRectangle({x:bx,y:y-H2,width:colW,height:H2,color:C.dark});
      pg.drawLine({start:{x:bx,y:y-H2},end:{x:bx+colW,y:y-H2},thickness:0.5,color:C.goldMid});
      pg.drawLine({start:{x:bx,y:y},end:{x:bx+colW,y:y},thickness:1.5,color:C.gold});
      pg.drawRectangle({x:bx,y:y-H2,width:4,height:H2,color:C.gold});
      pg.drawText(label.toUpperCase(),{x:bx+12,y:y-16,font:HB,size:7.5,color:C.goldDeep});
      pg.drawText(clip(value||'—',SB,17,colW-20),{x:bx+12,y:y-37,font:SB,size:17,color:C.gold});
      if(sub) pg.drawText(clip(sub,H,8,colW-20),{x:bx+12,y:y-51,font:H,size:8,color:C.dimWhite});
    });
    y-=H2+8;
  }

  // ── Boolean box ───────────────────────────────────────
  function boolBox(str) {
    if(!str) return;
    const PV=14,PH2=16;
    const LABEL_H=26;
    const lines=wrap(str,MO,8.5,CW-PH2*2-10);
    const h=lines.length*14+PV*2+LABEL_H;
    needsSpace(h);
    pg.drawRectangle({x:ML,y:y-h,width:CW,height:h,color:C.dark});
    pg.drawLine({start:{x:ML,y:y},end:{x:ML+CW,y:y},thickness:1,color:C.gold});
    pg.drawLine({start:{x:ML,y:y-h},end:{x:ML+CW,y:y-h},thickness:1,color:C.gold});
    pg.drawRectangle({x:ML,y:y-h,width:4,height:h,color:C.gold});
    // Label area
    pg.drawRectangle({x:ML,y:y-LABEL_H,width:CW,height:LABEL_H,color:hex('#021619')});
    pg.drawLine({start:{x:ML,y:y-LABEL_H},end:{x:ML+CW,y:y-LABEL_H},thickness:0.5,color:C.goldMid});
    pg.drawText('BOOLEAN SEARCH STRING',{x:ML+PH2,y:y-17,font:HB,size:8,color:C.gold});
    pg.drawText('Ready to paste into Sales Nav or Apollo',{x:ML+PH2,y:y-28,font:H,size:7.5,color:C.dimWhite});
    let ty=y-LABEL_H-PV;
    for(const ln of lines){
      ty-=14;
      pg.drawText(ln,{x:ML+PH2,y:ty,font:MO,size:8.5,color:C.gold});
    }
    y-=h+10;
  }

  // ── IRP/ICP section renderer ──────────────────────────
  function renderList(data, prefix, iconNum) {
    if(!data) return;

    sectionCounter--;
    sectionHeading(`${prefix} — Job Titles`,'Roles to target on LinkedIn & Apollo');
    tagGrid(data.jobTitles||[]);
    gap(6);

    if((data.seniorityLevels||[]).length){
      sectionHeading(`${prefix} — Seniority Levels`,'Prioritized by buying authority');
      for(const s of data.seniorityLevels){
        card([
          {text:s.level||'',serif:true,size:14,color:C.dark},
          {text:`Priority: ${s.priority||''}`,bold:true,size:9.5,color:C.goldMid},
          {text:s.reason||'',size:10,color:C.goldDeep},
        ],{bar:C.gold,topRule:false});
        gap(2);
      }
      gap(4);
    }

    sectionHeading(`${prefix} — Industry Tags`,'Apollo / Sales Nav compatible');
    tagGrid(data.industryTags||[],{accent:true});
    gap(6);

    const cs=data.companySize;
    if(cs){
      sectionHeading(`${prefix} — Company Size & Revenue`,'Niche-derived targeting filters');
      statCards([
        {label:'Employee Range',value:cs.employeeRange||'—'},
        {label:'Revenue Range',value:cs.revenueRange||'—'},
      ]);
      if(cs.rationale){
        card([{text:cs.rationale,size:10.5,italic:true,color:C.goldDeep}],{bg:false,topRule:false});
      }
      gap(4);
    }

    if(data.geography?.primary){
      sectionHeading(`${prefix} — Geography`,'Primary targeting region');
      card([
        {text:data.geography.primary,bold:true,size:13,color:C.dark},
        ...(data.geography.notes?[{text:data.geography.notes,size:10,color:C.goldDeep}]:[]),
      ],{bar:C.goldMid});
      gap(4);
    }

    sectionHeading(`${prefix} — Keywords & Skills`,'LinkedIn-style search terms');
    tagGrid(data.keywords||[],{size:9});
    gap(6);

    sectionHeading(`${prefix} — Intent Signals`,'Behavioral triggers indicating active need');
    tagGrid(data.intentSignals||[],{dark:true,size:9});
    gap(6);

    boolBox(data.booleanString);
    gap(4);
  }

  // ════════════════════════════════════════════════════════
  // COVER PAGE
  // ════════════════════════════════════════════════════════
  pg = pdfDoc.addPage([W,PH]); pgNum++;

  // Full dark background
  pg.drawRectangle({x:0,y:0,width:W,height:PH,color:C.dark});

  // Outer frame — top & bottom bars
  pg.drawRectangle({x:0,y:PH-4,width:W,height:4,color:C.gold});
  pg.drawRectangle({x:0,y:0,width:W,height:4,color:C.gold});
  // Side bars
  pg.drawRectangle({x:0,y:0,width:3,height:PH,color:C.gold});
  pg.drawRectangle({x:W-3,y:0,width:3,height:PH,color:C.gold});

  // Inner decorative frame
  const IF=22;
  pg.drawLine({start:{x:IF,y:PH-IF},end:{x:W-IF,y:PH-IF},thickness:0.5,color:C.goldMid});
  pg.drawLine({start:{x:IF,y:IF},end:{x:W-IF,y:IF},thickness:0.5,color:C.goldMid});
  pg.drawLine({start:{x:IF,y:IF},end:{x:IF,y:PH-IF},thickness:0.5,color:C.goldMid});
  pg.drawLine({start:{x:W-IF,y:IF},end:{x:W-IF,y:PH-IF},thickness:0.5,color:C.goldMid});

  // Corner ornaments (small diamonds)
  diamond(pg, IF, IF+4, 4, C.goldMid);
  diamond(pg, IF, PH-IF-4, 4, C.goldMid);
  diamond(pg, W-IF, IF+4, 4, C.goldMid);
  diamond(pg, W-IF, PH-IF-4, 4, C.goldMid);

  // "PROJECT" small caps above ICON
  const projW=HB.widthOfTextAtSize('PROJECT',10);
  pg.drawText('PROJECT',{x:(W-projW)/2,y:PH-70,font:HB,size:10,color:C.gold});
  const iconW=SB.widthOfTextAtSize('ICON',64);
  pg.drawText('ICON',{x:(W-iconW)/2,y:PH-140,font:SB,size:64,color:C.gold});

  // Gold rule + diamond center
  goldRule(pg, ML*2, PH-155, CW-ML*2, true);

  // "PODCAST GUEST BATTLECARD" label
  const bcLabel='PODCAST  GUEST  BATTLECARD';
  const bcW=H.widthOfTextAtSize(bcLabel,9.5);
  pg.drawText(bcLabel,{x:(W-bcW)/2,y:PH-173,font:H,size:9.5,color:C.dimWhite});

  // Divider
  goldRule(pg, ML*2.5, PH-186, CW-ML*3, false);

  // Podcast name — large centered serif
  const pnSize = podName.length>24?22:podName.length>18?26:30;
  const pnLines=wrap(podName,SB,pnSize,CW-ML);
  let pny=PH-220;
  for(const line of pnLines){
    const lw=SB.widthOfTextAtSize(line,pnSize);
    pg.drawText(line,{x:(W-lw)/2,y:pny,font:SB,size:pnSize,color:C.white});
    pny-=pnSize+8;
  }

  // Diamond rule
  goldRule(pg, ML*2.5, pny-8, CW-ML*3, true);

  // Client name + niche
  if(client){
    const cw=SR.widthOfTextAtSize(client,16);
    pg.drawText(client,{x:(W-cw)/2,y:pny-30,font:SR,size:16,color:C.gold});
  }
  if(niche){
    const nw2=H.widthOfTextAtSize(niche,11);
    pg.drawText(niche,{x:(W-nw2)/2,y:pny-50,font:H,size:11,color:C.dimWhite});
  }

  // Table of contents
  const tocY = 240;
  goldRule(pg, ML*2, tocY+20, CW-ML*2, false);
  const tocLabel='CONTENTS';
  const tlw=HB.widthOfTextAtSize(tocLabel,8);
  pg.drawText(tocLabel,{x:(W-tlw)/2,y:tocY+6,font:HB,size:8,color:C.goldDeep});
  goldRule(pg, ML*2, tocY-2, CW-ML*2, false);

  const sections=['Offer Stack','IRP List — Ideal Referral Partner'];
  if(battlecard?.icpList) sections.push('ICP List — Ideal Client Profile');
  sections.push('Booking Form','Referral Detection','Offer Matching Guide');
  if(pitch?.irpReferralPitch) sections.push('Referral Pitch');

  const tocStartX=W/2-90, numX=tocStartX-28;
  let ty2=tocY-22;
  sections.forEach((s,i)=>{
    const num=String(i+1).padStart(2,'0');
    pg.drawEllipse({x:numX,y:ty2+5,xScale:9,yScale:9,color:C.dark,borderColor:C.goldMid,borderWidth:0.75});
    pg.drawText(num,{x:numX-HB.widthOfTextAtSize(num,7)/2,y:ty2+2,font:HB,size:7,color:C.gold});
    pg.drawText(s.toUpperCase(),{x:tocStartX,y:ty2+2,font:H,size:8.5,color:C.dimWhite});
    ty2-=20;
  });

  // Date at bottom
  goldRule(pg, ML*2, 68, CW-ML*2, true);
  const dtw=H.widthOfTextAtSize(dateStr,9);
  pg.drawText(dateStr,{x:(W-dtw)/2,y:50,font:H,size:9,color:C.dimWhite});

  footer(pg,pgNum,'Cover');

  // ════════════════════════════════════════════════════════
  // PAGE 2 — OFFER STACK
  // ════════════════════════════════════════════════════════
  sectionCounter=0;
  newPage('Offer Stack');
  pageHeader('Offer Stack','01  Offer Stack');
  sectionHeading('Offer Stack','Services, programs & price points');

  for(const [i,o] of (battlecard?.offerStack||[]).entries()){
    needsSpace(80);
    // Numbered offer card header
    pg.drawRectangle({x:ML,y:y-24,width:CW,height:24,color:C.dark});
    pg.drawEllipse({x:ML+16,y:y-12,xScale:9,yScale:9,color:C.gold});
    pg.drawText(String(i+1),{x:ML+16-H.widthOfTextAtSize(String(i+1),8)/2,y:y-16,font:HB,size:8,color:C.dark});
    pg.drawText(clip(o.name||'Untitled',HB,12,CW-50),{x:ML+30,y:y-16,font:HB,size:12,color:C.gold});
    y-=24;
    card([
      {text:`Format: ${o.format||''}  ·  Price: ${o.price||''}`,bold:true,size:10,color:C.goldMid},
      ...wrap(o.transformation||'',H,10.5,CW-28).map(l=>({text:l,size:10.5})),
    ],{bg:C.offWhite,topRule:false,bar:C.goldMid});
    gap(4);
  }
  if(!(battlecard?.offerStack||[]).length)
    card([{text:'(no offers provided)',size:10.5,color:C.muted}],{bg:C.offWhite});

  // ════════════════════════════════════════════════════════
  // IRP LIST
  // ════════════════════════════════════════════════════════
  newPage('IRP List');
  pageHeader('IRP List','02  Ideal Referral Partner');
  renderList(battlecard?.irpList,'IRP',2);

  // ════════════════════════════════════════════════════════
  // ICP LIST (if present)
  // ════════════════════════════════════════════════════════
  if(battlecard?.icpList){
    newPage('ICP List');
    pageHeader('ICP List','03  Ideal Client Profile');
    renderList(battlecard.icpList,'ICP',3);
  }

  // ════════════════════════════════════════════════════════
  // BOOKING FORM
  // ════════════════════════════════════════════════════════
  sectionCounter=0;
  newPage('Booking Form');
  pageHeader('Booking Form','Qualifying Questions & Disqualifiers');

  sectionHeading('Qualifying Questions','Screen for fit before they appear on the show');
  for(const [i,q] of (battlecard?.bookingForm?.qualifyingQuestions||[]).entries()){
    needsSpace(70);
    pg.drawRectangle({x:ML,y:y-20,width:CW,height:20,color:C.dark});
    pg.drawText(`Q${i+1}`,{x:ML+10,y:y-14,font:HB,size:9,color:C.gold});
    pg.drawText(clip(q.question||'',HB,10,CW-40),{x:ML+30,y:y-14,font:HB,size:10,color:C.white});
    y-=20;
    card([
      {text:'Disqualify if selected:',bold:true,size:8.5,color:C.goldMid},
      ...(q.disqualifyingAnswers||[]).flatMap(a=>
        wrap(`· ${a}`,H,10,CW-38).map(l=>({text:l,size:10,color:C.goldDeep}))
      ),
    ],{bg:C.offWhite,topRule:false,bar:hex('#B0863C')});
    gap(4);
  }
  gap(8);

  sectionHeading('Strong Fit Signals','Green flags that confirm a high-quality guest');
  for(const s of (battlecard?.bookingForm?.strongFitSignals||[])){
    const lines=wrap(s,H,10.5,CW-34);
    card([
      {text:'-',bold:true,size:11,color:C.gold},
      ...lines.map(l=>({text:l,size:10.5})),
    ],{bg:C.offWhite,topRule:true});
    gap(2);
  }

  // ════════════════════════════════════════════════════════
  // REFERRAL DETECTION
  // ════════════════════════════════════════════════════════
  sectionCounter=0;
  newPage('Referral Detection');
  pageHeader('Referral Detection','Passive intelligence questions for booking forms');

  sectionHeading('Referral Detection Questions','Identify warm referral networks passively');
  for(const [i,q] of (battlecard?.bookingForm?.referralDetectionQuestions||[]).entries()){
    needsSpace(100);
    pg.drawRectangle({x:ML,y:y-20,width:CW,height:20,color:C.dark});
    pg.drawText(`Q${i+1}`,{x:ML+10,y:y-14,font:HB,size:9,color:C.gold});
    pg.drawText(clip(q.question||'',HB,10,CW-40),{x:ML+30,y:y-14,font:HB,size:10,color:C.white});
    y-=20;
    const optLines=[
      {text:'Answer Options:',bold:true,size:8.5,color:C.goldMid},
      ...(q.options||[]).flatMap(o=>
        wrap(`· ${o}`,H,10,CW-38).map(l=>({text:l,size:10,color:C.darkAlt}))
      ),
    ];
    card(optLines,{bg:C.offWhite,topRule:false});
    // Signal note
    if(q.signalNote){
      needsSpace(30);
      pg.drawRectangle({x:ML,y:y-26,width:CW,height:26,color:hex('#F0FDF4')});
      pg.drawLine({start:{x:ML,y:y},end:{x:ML+CW,y:y},thickness:0.5,color:C.signal});
      pg.drawLine({start:{x:ML,y:y-26},end:{x:ML+CW,y:y-26},thickness:0.5,color:C.signal});
      pg.drawRectangle({x:ML,y:y-26,width:4,height:26,color:C.signal});
      pg.drawText('SIGNAL',{x:ML+12,y:y-11,font:HB,size:7.5,color:C.signal});
      pg.drawText(clip(q.signalNote,H,9.5,CW-65),{x:ML+55,y:y-11,font:H,size:9.5,color:hex('#065F46')});
      y-=32;
    }
    gap(6);
  }

  // ════════════════════════════════════════════════════════
  // OFFER MATCHING GUIDE
  // ════════════════════════════════════════════════════════
  sectionCounter=0;
  newPage('Offer Matching Guide');
  pageHeader('Offer Matching','Partner Type / Lead Offer / Positioning');

  sectionHeading('Offer Matching Guide','Who to pitch, what to lead with, how to frame it');
  for(const [i,e] of (battlecard?.offerMatchingGuide||[]).entries()){
    needsSpace(90);
    pg.drawRectangle({x:ML,y:y-22,width:CW,height:22,color:C.dark});
    pg.drawEllipse({x:ML+14,y:y-11,xScale:8,yScale:8,color:C.gold});
    pg.drawText(String(i+1),{x:ML+14-H.widthOfTextAtSize(String(i+1),7)/2,y:y-15,font:HB,size:7,color:C.dark});
    pg.drawText(clip(e.partnerType||'',SB,13,CW-45),{x:ML+28,y:y-15,font:SB,size:13,color:C.gold});
    y-=22;
    card([
      {text:`Lead Offer: ${e.leadOffer||''}`,bold:true,size:10,color:C.goldMid},
      ...wrap(e.positioningAngle||'',H,10.5,CW-36).map(l=>({text:l,size:10.5})),
      {text:`Relationship: ${e.relationshipType||''}`,size:9.5,color:C.goldDeep,italic:true},
    ],{bg:C.offWhite,topRule:false,bar:C.goldMid});
    gap(4);
  }

  // ════════════════════════════════════════════════════════
  // REFERRAL PITCH
  // ════════════════════════════════════════════════════════
  if(pitch?.irpReferralPitch){
    sectionCounter=0;
    newPage('Referral Pitch');
    pageHeader('Referral Pitch','Post-episode script — cameras off');

    // Intro callout box
    needsSpace(46);
    pg.drawRectangle({x:ML,y:y-42,width:CW,height:42,color:C.dark});
    pg.drawLine({start:{x:ML,y:y},end:{x:ML+CW,y:y},thickness:1,color:C.gold});
    pg.drawLine({start:{x:ML,y:y-42},end:{x:ML+CW,y:y-42},thickness:1,color:C.gold});
    pg.drawRectangle({x:ML,y:y-42,width:4,height:42,color:C.gold});
    pg.drawText('HOW TO USE',{x:ML+14,y:y-13,font:HB,size:8,color:C.gold});
    pg.drawText('Deliver this script verbally after recording ends. Cameras off. Keep it warm and conversational.',
      {x:ML+14,y:y-27,font:H,size:9,color:C.dimWhite});
    pg.drawText('Replace {guest_name} with the guest\'s actual name before delivering.',
      {x:ML+14,y:y-38,font:H,size:8.5,color:C.goldDeep});
    y-=50;

    const irp=pitch.irpReferralPitch;
    const PITCH_STEPS=[
      {num:'01',label:'Transition Line',body:irp.transitionLine,hint:'Bridge from recording into the pitch'},
      {num:'02',label:'Synergy Observation',body:irp.synergyObservation,hint:'Name the exact audience overlap'},
      {num:'03',label:'The Offer Frame',body:irp.offerFrame,hint:'Context so they know who to send'},
      {num:'04',label:'The Ask',body:irp.theAsk,hint:'Personal intros + broad sharing'},
      {num:'05',label:'The Free Give',body:irp.theFreeGive,hint:'Unconditional — given before the urgency close'},
      {num:'06',label:'Urgency Close',body:irp.urgencyClose,hint:'Specific number, date, or timeframe'},
      {num:'07',label:'Soft Close',body:irp.softClose,hint:'Leave the door open — no pressure'},
    ];

    for(const s of PITCH_STEPS){
      if(!s.body) continue;
      needsSpace(60);
      // Step header
      pg.drawRectangle({x:ML,y:y-22,width:CW,height:22,color:C.dark});
      pg.drawEllipse({x:ML+14,y:y-11,xScale:10,yScale:10,color:C.gold});
      pg.drawText(s.num,{x:ML+14-HB.widthOfTextAtSize(s.num,7.5)/2,y:y-15,font:HB,size:7.5,color:C.dark});
      pg.drawText(s.label.toUpperCase(),{x:ML+30,y:y-12,font:HB,size:10,color:C.gold});
      if(s.hint){
        const hw=H.widthOfTextAtSize(s.hint,8);
        pg.drawText(s.hint,{x:W-MR-hw,y:y-14,font:H,size:8,color:C.dimWhite});
      }
      y-=22;
      const bodyLines=wrap(s.body,H,11,CW-28).map(l=>({text:l,size:11,lh:17}));
      card(bodyLines,{bg:C.offWhite,topRule:false,pv:14,lh:17});
      gap(4);
    }
  }

  // Missing inputs notice
  if(pitch?.missingInputs?.length){
    newPage('Missing Inputs');
    pageHeader('Missing Inputs','Required before pitch can be generated');
    sectionCounter=0;
    sectionHeading('Missing Inputs Required');
    for(const m of pitch.missingInputs)
      card([{text:`· ${m}`,size:11,color:C.goldDeep}],{bg:C.offWhite,bar:C.goldMid});
  }

  return await pdfDoc.save();
}

module.exports = { generatePDF };
