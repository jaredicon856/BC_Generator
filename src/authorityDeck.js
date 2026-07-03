const client = require('./anthropic');
const { parseJSON } = require('./utils');
const { getConfig } = require('./prompts');

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
Known fields (use these; don't overwrite with guesses):
Client Name: ${clientName || '(not provided — pull from transcript)'}
Client Email: ${clientEmail || '(not provided)'}
Location (city / region): ${location || '(not provided)'}
Target launch / timeline: ${targetTimeline || '(not provided)'}
Presented (Month Year): ${presentedDate || '(not provided)'}
Next Call (day time tz): ${nextCall || '(not provided)'}

Fathom Call Transcript:
${transcript || '(none provided)'}

Pull the facts JSON now. Put Location into identity.location and the launch/timeline into identity.target_timeline so the roadmap and bio can use real dates instead of TBD.
`.trim();

  const cfg  = getConfig('authority_extract');
  const text = await stream(cfg, userContent, onProgress);
  return parseJSON(text);
}

// ── PART C — write the deck (confirmed facts → markdown) ─
async function assembleDeck(confirmedJson, onProgress) {
  const userContent = `Here are the CONFIRMED facts. Write the full ICON Authority Deck as clean markdown, high-level and concise.

${JSON.stringify(confirmedJson, null, 2)}`;

  const cfg = getConfig('authority_document');
  return stream(cfg, userContent, onProgress);
}

module.exports = { extractDeck, assembleDeck };
