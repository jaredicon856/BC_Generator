const client = require('./anthropic');
const { parseJSON } = require('./utils');

const SYSTEM_PROMPT = `You are a Podcast Funnel & Referral Partner Strategist producing a client-facing Authority Deck.
Return ONLY valid JSON. No markdown. No preamble. No explanation outside the JSON.

CONTEXT:
This document is generated from Strategy Call 1 with a new or prospective client. It is the deliverable presented back to the client on Strategy Call 2 to earn their buy-in on a podcast-driven referral partner strategy before deeper engagement work begins. Tone is confident strategic consultancy — specific, grounded in what the client actually said, never generic filler. Every claim should trace back to something in the transcript. Where the transcript is silent, make a reasonable strategic inference and note it, rather than inventing specifics (names, numbers, institutions) that were never said.

PRE-PROCESSING:
Treat the call transcript as the primary source of truth. Extract: the client's business, their existing authority proof points (books, credentials, past employers, years of experience, existing audience), their ideal client, their revenue priorities, referral partner categories with the actual rationale and specific openings/warm contacts named on the call, and any next-call logistics (date, time, agenda items) mentioned.

Do not fabricate specific institution names, contact names, or numbers that were not said. If a section has no support in the transcript, populate it with a clearly labeled strategic recommendation instead, and add a corresponding entry to missingInputs.

Return this exact JSON structure:

{
  "meta": {
    "clientName": "",
    "podcastName": "",
    "tagline": "",
    "preparedBy": "Project ICON",
    "presentedDate": "",
    "generatedAt": ""
  },
  "executiveSummary": "",
  "coreStrategyIdentity": {
    "missionPlatform": "",
    "authorityProofPoint": "",
    "primaryBusiness": "",
    "idealClient": "",
    "revenuePriority": [],
    "northStar": ""
  },
  "podcastFunnel": {
    "howItWorks": "",
    "corePrinciple": ""
  },
  "idealClientProfile": {
    "segments": [
      { "title": "", "description": "" }
    ],
    "whoWeAvoid": ""
  },
  "referralPartnerTargets": [
    { "partnerCategory": "", "whyTheyRefer": "", "notesAndOpenings": "" }
  ],
  "outreachAndConversion": {
    "conversionPlays": [
      { "partnerType": "", "postShowConversionPlay": "" }
    ],
    "conversionInfrastructure": []
  },
  "ecosystem": [
    { "destination": "", "whatItOffers": "", "status": "" }
  ],
  "implementationRoadmap": [
    { "phase": "", "tasks": [] }
  ],
  "actionItems": {
    "clientActions": [],
    "icoActions": []
  },
  "nextSteps": {
    "agenda": []
  },
  "missingInputs": []
}

SYSTEM RULES:
1. executiveSummary is 2-3 tight paragraphs — who the client is, why the podcast funnel fits them, what this document contains.
2. revenuePriority is an ordered list, highest priority first (e.g. "1) Clinic client volume").
3. idealClientProfile.segments should reflect real client-data patterns mentioned on the call, not generic personas.
4. referralPartnerTargets should be as specific as the transcript allows — real category names, real rationale, real named openings (board memberships, warm contacts, prior conversations) where mentioned.
5. implementationRoadmap should be phased and sequential (Phase 1, 2, 3... plus an Ongoing phase), tasks within a phase run in parallel.
6. actionItems splits clearly between what the CLIENT does and what the AGENCY (Project ICON) does.
7. If required inputs are missing or the transcript is thin, list exactly what's missing in missingInputs — do not silently pad sections with invented specifics.`;

async function generateAuthorityDeck(inputs, onProgress) {
  const {
    clientName,
    podcastName,
    niche,
    geography,
    idealBuyer,
    offers,
    referralPartners,
    transcript,
    presentedDate,
  } = inputs;

  const offerSummary = (offers || []).length
    ? offers.map((o, i) => `  ${i + 1}. ${o.name} | ${o.format} | ${o.price} | Transformation: ${o.transformation}`).join('\n')
    : '(not provided)';

  const textContent = `
Client Name: ${clientName || '(not provided)'}
Podcast Name: ${podcastName || '(not provided)'}
Niche / Business Focus: ${niche || '(not provided)'}
Geography: ${geography || 'North America'}
Presented Date: ${presentedDate || '(not provided)'}

Ideal Buyer Description:
${idealBuyer || '(not provided)'}

Offer Stack:
${offerSummary}

Referral Partners Already Identified:
${referralPartners || '(none)'}

Strategy Call 1 Transcript:
${transcript || '(none provided — flag as missing input)'}

Generate the full Authority Deck JSON now. Set generatedAt to: ${new Date().toISOString()}
`.trim();

  let text = '';
  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-5',
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: textContent }],
  });

  let tokenCount = 0;
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
      text += chunk.delta.text;
      tokenCount++;
      if (onProgress && tokenCount % 10 === 0) onProgress(tokenCount);
    }
  }

  return parseJSON(text);
}

module.exports = { generateAuthorityDeck };
