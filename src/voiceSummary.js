// Text-to-speech for the "Jarvis" call-summary voice note.
// Anthropic's Claude API is text-only, so this step calls OpenAI's TTS API
// directly over HTTPS (no SDK dependency) rather than going through Claude.

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';

/**
 * Converts a call-summary text into an MP3 audio buffer via OpenAI TTS.
 * @param {string} text - the call recap to speak (e.g. Fathom's summary of the call).
 * @param {object} opts
 * @param {string} [opts.voice='alloy'] - OpenAI voice name.
 * @param {string} [opts.model='tts-1'] - 'tts-1' (fast/cheap) or 'tts-1-hd' (higher quality).
 * @returns {Promise<Buffer>} MP3 audio bytes.
 */
async function generateVoiceSummary(text, opts = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Add it as an environment variable.');
  }
  if (!text || !text.trim()) {
    throw new Error('No text provided to speak.');
  }

  const { voice = 'alloy', model = 'tts-1' } = opts;

  const res = await fetch(OPENAI_TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, voice, input: text }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenAI TTS request failed (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { generateVoiceSummary };
