const client = require('./anthropic');
const { parseJSON } = require('./utils');
const { getConfig } = require('./prompts');


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
    authorityDeck,
  } = inputs;

  const textContent = `
Client Name: ${clientName || '(not provided)'}
Podcast Name: ${podcastName || '(not provided)'}
Niche / Topic Focus: ${niche || '(not provided)'}
Geography: ${geography || 'North America'}
ICP List Needed: ${icpListNeeded ? 'Yes' : 'No'}
${figmaPdf ? 'Figma PDF: attached — extract offer stack from it.' : ''}
${authorityDeck ? `Client Authority Deck (established context from Strategy Call 1 — authoritative for this client's story, north star, offer stack, ICP, and positioning; use for continuity rather than re-deriving):
${typeof authorityDeck === 'string' ? authorityDeck : JSON.stringify(authorityDeck)}
` : ''}

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

  const cfg = getConfig('battlecard');

  let text = '';
  const stream = await client.messages.stream({
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    system: cfg.system,
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
