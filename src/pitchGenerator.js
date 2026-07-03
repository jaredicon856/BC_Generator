const client = require('./anthropic');
const { parseJSON } = require('./utils');
const { getConfig } = require('./prompts');

async function generatePitch(inputs, onProgress) {
  const {
    pitchMode = 'ai',
    hostName, podcastName, niche, geography,
    whatYouWant, whatYouGive, howYouMakeItHappen,
    painPoint, nextStep, icpRequested,
    offerStack, irpList, idealClientDescription,
  } = inputs;

  const offerSummary = (offerStack || []).length
    ? offerStack.map((o, i) => `  ${i + 1}. ${o.name} | ${o.format} | ${o.price} | Transformation: ${o.transformation}`).join('\n')
    : '(not provided)';

  const irpSummary = irpList && irpList.jobTitles
    ? `Job Titles: ${(irpList.jobTitles || []).join(', ')}\nIndustry: ${(irpList.industryTags || []).join(', ')}\nIntent Signals: ${(irpList.intentSignals || []).join(', ')}`
    : '(not provided)';

  let pitchInputsBlock = '';
  if (pitchMode === 'manual') {
    pitchInputsBlock = `
--- THE 3 PITCH QUESTIONS (manually provided) ---
[WHAT YOU WANT]: ${whatYouWant || '(not provided)'}
[WHAT YOU ARE GOING TO GIVE]: ${whatYouGive || '(not provided)'}
[HOW YOU MAKE IT HAPPEN QUICKLY]: ${howYouMakeItHappen || '(not provided)'}
`;
  } else {
    pitchInputsBlock = `
--- AI BRAIN MODE ---
Infer [WHAT YOU WANT], [WHAT YOU ARE GOING TO GIVE], and [HOW YOU MAKE IT HAPPEN QUICKLY] from the battlecard context. The free give must come from the host's existing offer stack. Build the most compelling, specific version possible.
`;
  }

  const userContent = `
--- BATTLECARD CONTEXT ---
Host Name: ${hostName || '(not provided)'}
Podcast Name: ${podcastName || '(not provided)'}
Niche: ${niche || '(not provided)'}
Geography: ${geography || 'North America'}
Ideal Client: ${idealClientDescription || '(not provided)'}

Offer Stack:
${offerSummary}

IRP Profile:
${irpSummary}
${pitchInputsBlock}
ICP Requested: ${icpRequested ? 'Yes' : 'No'}
${icpRequested ? `Pain Point: ${painPoint || '(not provided)'}\nNext Step: ${nextStep || '(not provided)'}` : ''}

FINAL REMINDER: Use {guest_name} — the exact literal string including curly braces — every single time the guest is addressed or named in the pitch. Do not use the host name or any real name in place of {guest_name}.

Generate the full pitch JSON now.
`.trim();

  const cfg = getConfig('pitch');

  let text = '';
  const stream = await client.messages.stream({
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    system: cfg.system,
    messages: [{ role: 'user', content: userContent }],
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

module.exports = { generatePitch };
