const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROJECT_ICON_COLORS = {
  primary: '#032225',
  secondary: '#041A1C',
  accent: '#E9BF5E',
  background: '#FFFFFF',
  text: '#041A1C',
  muted: '#966C2B',
};

async function extractBrandColors(content) {
  if (!content || !content.trim()) return PROJECT_ICON_COLORS;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 500,
    system: `You are a brand color extractor. Given brand guide text or CSS, extract the main colors.
Return ONLY valid JSON with these exact keys: primary, secondary, accent, background, text, muted.
Each value must be a hex color string like "#RRGGBB". No markdown. No explanation.`,
    messages: [
      {
        role: 'user',
        content: `Extract brand colors from this content:\n\n${content}`,
      },
    ],
  });

  try {
    const raw = message.content[0].text.trim()
      .replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = JSON.parse(raw);
    // Merge with defaults so all keys always exist
    return { ...PROJECT_ICON_COLORS, ...parsed };
  } catch {
    return PROJECT_ICON_COLORS;
  }
}

module.exports = { extractBrandColors, PROJECT_ICON_COLORS };
