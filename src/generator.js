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
    authorityDeckPdf,
    ancillaryDocs,
  } = inputs;

  const ancillaryTextDocs = (ancillaryDocs || []).filter(d => !d.isPdf);
  const ancillaryPdfDocs  = (ancillaryDocs || []).filter(d => d.isPdf);

  const textContent = `
Client Name: ${clientName || '(not provided)'}
Podcast Name: ${podcastName || '(not provided)'}
Niche / Topic Focus: ${niche || '(not provided)'}
Geography: ${geography || 'North America'}
ICP List Needed: ${icpListNeeded ? 'Yes' : 'No'}
${figmaPdf ? 'Figma PDF: attached — extract offer stack from it.' : ''}
${authorityDeckPdf ? 'Client Authority Deck: attached as a PDF — use it as authoritative context for this client\'s story, north star, ICP, and positioning.' : ''}
${authorityDeck ? `Client Authority Deck (Stage 1 output — use as authoritative context for this client's story, north star, ICP, and positioning):
${authorityDeck}
` : ''}
${ancillaryPdfDocs.length ? `Additional Reference Documents attached as PDFs (supplementary context beyond the Authority Codex — e.g. brand guides, past call notes, other codices; not necessarily structured like the Authority Codex): ${ancillaryPdfDocs.map(d => d.name).join(', ')}` : ''}
${ancillaryTextDocs.map(d => `Additional Reference Document — "${d.name}" (supplementary context, not necessarily structured like the Authority Codex):\n${d.text}`).join('\n\n')}

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

  const documentBlocks = [];
  if (figmaPdf) documentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: figmaPdf } });
  if (authorityDeckPdf) documentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: authorityDeckPdf } });
  ancillaryPdfDocs.forEach(d => documentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.base64 } }));

  const userMessage = documentBlocks.length
    ? [...documentBlocks, { type: 'text', text: textContent }]
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
