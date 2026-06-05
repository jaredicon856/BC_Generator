/**
 * Robustly parse JSON from Claude's output.
 * Handles: code fences, leading/trailing prose, truncated responses.
 */
function parseJSON(raw) {
  if (!raw || !raw.trim()) throw new Error('Empty response from Claude');

  // 1. Strip markdown code fences
  let text = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // 2. Try direct parse
  try { return JSON.parse(text); } catch (_) {}

  // 3. Extract the outermost { ... } block
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }

  // 4. Nothing worked — throw with context
  const preview = text.slice(0, 120).replace(/\n/g, ' ');
  throw new Error(`Could not parse Claude response as JSON. Preview: "${preview}"`);
}

module.exports = { parseJSON };
