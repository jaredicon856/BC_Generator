const client = require('./anthropic');
const { parseJSON } = require('./utils');
const { getConfig, scaffoldFor } = require('./prompts');

// ── Package scope ──────────────────────────────────────
// Each package is its OWN document ("logic in a box"): the DOCUMENT call is fed
// the package's SECTION SCAFFOLD (prompts.scaffoldFor). This block is the short
// summary that heads the user message. Accelerator is modeled on the Zach Lott
// reference; Ecosystem is synthesized from the Jason Yormark + JW Radford
// references; Podcast is still a provisional fallback pending its own reference.
const PACKAGE_SCOPE = {
  accelerator: {
    label: 'ICON Accelerator ($19k · 180-day delivery)',
    pillars: 'Book + Podcast + Press + Stage',
    flagship: 'The Book + the signature stage/keynote strategy',
    note: 'Use the ACCELERATOR scaffold below (16 sections, Zach-reference format). Section 12 (Course & Training) is CONDITIONAL on the client raising it. Roadmap = Foundation → Construction → Arrival over ~12–18 months.',
  },
  ecosystem: {
    label: 'ICON Authority Ecosystem ($30k · 12-month delivery)',
    pillars: 'Book + Podcast + Press + Stage + Community',
    flagship: 'The whole engine — brand + monetized community/tiers + podcast referral engine + book + press + stage, built to be sellable',
    note: 'Use the ECOSYSTEM scaffold below (16 sections in 3 PARTS, synthesized from the Jason Yormark + JW Radford references). The Core Identity table, the named 3-pillar Framework, and the tier PRICING are central — never thin the community/monetization engine.',
  },
  podcast: {
    label: 'ICON Podcast ($10k · 180-day delivery)',
    pillars: 'Podcast only',
    flagship: 'The podcast as a client-and-referral engine — guests become partners, partners become referrals, referrals become revenue',
    note: 'Use the PODCAST scaffold below (Podcast Funnel & Referral model, synthesized from the Wildman + Saroni Kundu references). Backbone method = the funnel stages, the ICP/IRP two-profile guest rule, the value-first post-show conversion, and the one-way referral. Section 02 (Offer, Reviewed) is CONDITIONAL on the client having a discrete offer.',
  },
  custom: {
    label: 'ICON Custom (build to fit)',
    pillars: 'Client-specific — see CUSTOM DELIVERABLES below',
    flagship: 'Whatever this client actually bought',
    note: 'Use the CUSTOM scaffold: compose the codex from ICON\'s module library to match the CUSTOM DELIVERABLES line below (corroborated by the transcript). Always build the spine (Exec Summary, positioning core, roadmap, action items, next steps); add ONLY the pillar modules in scope. Podcast, if included, is built to full depth.',
  },
};

function packageNote(pkg, deliverables) {
  const key = String(pkg || '').toLowerCase();
  const p = PACKAGE_SCOPE[key] || PACKAGE_SCOPE.accelerator;
  const lines = [
    `SELECTED PACKAGE: ${p.label}`,
    `Pillars purchased: ${p.pillars}`,
    `Flagship goal for this client: ${p.flagship}`,
    `Package note: ${p.note}`,
  ];
  if (key === 'custom') {
    const d = String(deliverables || '').trim();
    lines.push(`CUSTOM DELIVERABLES: ${d || '(not specified — infer the client\'s deliverables from the transcript)'}`);
  }
  lines.push('Build ONLY the sections the SECTION SCAFFOLD below calls for (for custom, only the modules matching the deliverables) — never invent a Book, Stage, or Community track the client did not buy.');
  return lines.join('\n');
}

// Stream one Claude call (no tools), forwarding a token count to onProgress,
// and return the concatenated text.
async function stream(cfg, userContent, onProgress) {
  let text = '';
  const s = await client.messages.stream({
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    system: cfg.system,
    messages: [{ role: 'user', content: userContent }],
  });
  let n = 0;
  for await (const chunk of s) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      text += chunk.delta.text;
      if (onProgress && (++n % 10 === 0)) onProgress(n);
    }
  }
  return text;
}

// ── PART B — fast facts pass (transcript → review JSON) ─
async function extractDeck(inputs, onProgress) {
  const { clientName, clientEmail, presentedDate, nextCall, location, targetTimeline, transcript } = inputs;

  const userContent = `
${packageNote(inputs.package, inputs.customDeliverables)}

Known fields (use these; don't overwrite with guesses):
Client Name: ${clientName || '(not provided — pull from transcript)'}
Client Email: ${clientEmail || '(not provided)'}
Location (city / region): ${location || '(not provided)'}
Target launch / timeline: ${targetTimeline || '(not provided)'}
Presented (Month Year): ${presentedDate || '(not provided)'}
Next Call (day time tz): ${nextCall || '(not provided)'}

Fathom Call Transcript:
${transcript || '(none provided)'}

Pull the facts JSON now. Put Location into positioning.location, the launch/timeline into positioning.target_timeline, and the Presented (Month Year) value into identity.presented_date (the cover uses it verbatim — do NOT invent a date).
`.trim();

  const cfg  = getConfig('authority_extract');
  const text = await stream(cfg, userContent, onProgress);
  return parseJSON(text);
}

// ── PART C — write the deck (confirmed facts → markdown) ─
// The codex is a 15k+-token document; one sequential Claude call takes 6-7
// minutes and can hit the output ceiling mid-document. Fixed-scaffold packages
// are therefore written as THREE CONCURRENT SLICE CALLS — each gets the full
// house prompt + scaffold + facts (so voice and strategy stay coherent) but
// writes only its slice — then the slices are stitched in order and section
// numbering is normalized. Wall-clock drops to roughly the longest slice
// (~2 min) and each slice has the full token budget, so truncation is gone.
// The CUSTOM package composes its section list dynamically, so it can't be
// pre-sliced — it keeps the original single-call path.
const SLICE_PLANS = {
  accelerator: [
    'the COVER and sections 01 through 06',
    'sections 07 through 12',
    'sections 13 through 17',
  ],
  ecosystem: [
    'the COVER and sections 01 through 05 (including the PART 1 divider where the scaffold places it)',
    'sections 06 through 10 (including the PART 2 divider where the scaffold places it)',
    'sections 11 through 16 (including the PART 3 divider where the scaffold places it)',
  ],
  podcast: [
    'the COVER and sections 01 through 04',
    'sections 05 through 08',
    'sections 09 through 11',
  ],
};

function slicePrompt(baseContext, sliceRange, sliceIndex, sliceCount) {
  return `${baseContext}

PARALLEL ASSEMBLY — WRITE YOUR SLICE ONLY:
This codex is being written in ${sliceCount} slices simultaneously and stitched together in scaffold order afterwards. Your job is ONLY ${sliceRange}.
- ${sliceIndex === 0 ? 'Begin with the COVER exactly as the scaffold specifies, then your sections.' : 'Do NOT write the cover or any section outside your slice.'}
- Write your sections exactly as they will appear inside the finished document — same altitude, same voice, fully built out.
- Use the scaffold's section numbers exactly as given. If a CONDITIONAL section in your slice does not apply, omit it entirely WITHOUT renumbering — numbering is normalized after assembly.
- Do not reference other sections by number, and do not summarize or preview content that belongs to another slice.
- No preamble, no commentary, no closing note: your output starts at your first heading and ends at the end of your last section.`;
}

// After stitching, rewrite two-digit section numbers into one clean sequence
// (fixes gaps left by omitted CONDITIONAL sections) and normalize every
// section heading to the same "## " level (slices sometimes disagree on # vs
// ##). Only touches heading lines like "## SECTION 12   |   TITLE" or
// "## 04   TITLE"; PART dividers, pillar subheads ("### 1. ..."), and body
// text are left alone.
function renumberSections(markdown) {
  let n = 0;
  return markdown.replace(
    /^#{1,4}(\s*)((?:SECTION\s+)?)(\d{2})(\b.*)$/gm,
    (_, sp, secWord, _num, rest) => `##${sp || ' '}${secWord}${String(++n).padStart(2, '0')}${rest}`
  );
}

async function assembleDeck(confirmedJson, pkg, deliverables, onProgress) {
  const cfg = getConfig('authority_document');
  const key = String(pkg || '').toLowerCase();
  const plan = SLICE_PLANS[key] || (key === 'custom' ? null : SLICE_PLANS.accelerator);

  const baseContext = `${packageNote(pkg, deliverables)}

${scaffoldFor(pkg)}

Here are the CONFIRMED facts. Write the AUTHORITY CODEX as clean markdown, building EXACTLY the cover + sections the SECTION SCAFFOLD above specifies for this package, in order.

${JSON.stringify(confirmedJson, null, 2)}`;

  // Custom package: dynamic section list — single call, as before.
  if (!plan) return stream(cfg, baseContext, onProgress);

  // Aggregate per-slice token counts into one monotonic progress number.
  const counts = plan.map(() => 0);
  const emit = () => onProgress && onProgress(counts.reduce((a, b) => a + b, 0));

  const slices = await Promise.all(
    plan.map((range, i) =>
      stream(cfg, slicePrompt(baseContext, range, i, plan.length), (n) => { counts[i] = n; emit(); })
    )
  );

  slices.forEach((text, i) => {
    if (!text || !text.trim()) throw new Error(`Deck slice ${i + 1}/${plan.length} came back empty — please retry`);
  });

  return renumberSections(slices.map((s) => s.trim()).join('\n\n---\n\n'));
}

module.exports = { extractDeck, assembleDeck };
