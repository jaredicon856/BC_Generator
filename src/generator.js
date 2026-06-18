const client = require('./anthropic');
const { parseJSON } = require('./utils');

const SYSTEM_PROMPT = `You are a Podcast Guest Prospecting and Booking Intelligence Strategist.
Return ONLY valid JSON. No markdown. No preamble. No explanation outside the JSON.

PRE-PROCESSING:
Analyze the full input before generating any output.
If a call transcript is provided, treat it as the primary source of truth.
If a Figma PDF is provided, extract the offer stack directly from it — names, formats, prices, and transformations as written.
Extract offer stack, buyer signals, referral partner types, and disqualifiers
directly from what the host said. Do not override their words with assumptions.
If no transcript, derive everything from the structured inputs.

Return this exact JSON structure:

{
  "meta": {
    "clientName": "",
    "podcastName": "",
    "niche": "",
    "geography": "",
    "generatedAt": ""
  },
  "offerStack": [
    {
      "name": "",
      "format": "",
      "price": "",
      "transformation": ""
    }
  ],
  "irpList": {
    "jobTitles": [],
    "seniorityLevels": [
      { "level": "", "priority": "", "reason": "" }
    ],
    "industryTags": [],
    "companySize": {
      "employeeRange": "",
      "revenueRange": "",
      "rationale": ""
    },
    "geography": {
      "primary": "",
      "notes": ""
    },
    "keywords": [],
    "intentSignals": [],
    "booleanString": ""
  },
  "bookingForm": {
    "qualifyingQuestions": [
      {
        "question": "",
        "disqualifyingAnswers": []
      }
    ],
    "strongFitSignals": [],
    "referralDetectionQuestions": [
      {
        "question": "",
        "options": [],
        "signalNote": ""
      }
    ]
  },
  "offerMatchingGuide": [
    {
      "partnerType": "",
      "leadOffer": "",
      "positioningAngle": "",
      "relationshipType": ""
    }
  ],
  "icpList": null
}

If icpListNeeded is true, populate icpList with this structure (these are the podcast host's IDEAL CLIENTS — potential buyers, not referral partners):
{
  "jobTitles": [],
  "seniorityLevels": [
    { "level": "", "priority": "", "reason": "" }
  ],
  "industryTags": [],
  "companySize": {
    "employeeRange": "",
    "revenueRange": "",
    "rationale": ""
  },
  "geography": {
    "primary": "",
    "notes": ""
  },
  "keywords": [],
  "intentSignals": [],
  "booleanString": ""
}
If icpListNeeded is false, set icpList to null.`;

async function generateBattlecard(inputs, onProgress) {
  const {
    clientName,
    podcastName,
    niche,
    offers,
    idealBuyer,
    geography,
    referralPartners,
    transcript,
    icpListNeeded,
    figmaPdf,
  } = inputs;

  const textContent = `
Client Name: ${clientName || '(not provided)'}
Podcast Name: ${podcastName || '(not provided)'}
Niche / Topic Focus: ${niche || '(not provided)'}
Geography: ${geography || 'North America'}
ICP List Needed: ${icpListNeeded ? 'Yes' : 'No'}
${figmaPdf ? 'Figma PDF: attached — extract offer stack from it.' : ''}

${(offers && offers.length) ? `Manual Offer Stack (use only if Figma PDF not provided or incomplete):
${offers.map((o, i) => `  ${i + 1}. Name: ${o.name} | Format: ${o.format} | Price: ${o.price} | Transformation: ${o.transformation}`).join('\n')}` : ''}

Ideal Buyer Description:
${idealBuyer || '(not provided)'}

Referral Partners Already Identified:
${referralPartners || '(none)'}

Call Transcript:
${transcript || '(none provided — derive from structured inputs above)'}

Generate the full battlecard JSON now. Set generatedAt to: ${new Date().toISOString()}
`.trim();

  const userMessage = figmaPdf
    ? [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: figmaPdf },
        },
        { type: 'text', text: textContent },
      ]
    : textContent;

  let text = '';
  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-5',
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
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

module.exports = { generateBattlecard };
