// Slack delivery for the Fathom -> deck pipeline. Uses the current file
// upload flow (files.upload was sunset Nov 12, 2025): getUploadURLExternal
// -> POST the raw bytes to that URL -> completeUploadExternal to share it
// into a channel. Confirmed against Slack's own docs.
const SLACK_API = 'https://slack.com/api';

function authHeader() {
  if (!process.env.SLACK_BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN is not set.');
  }
  return { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` };
}

async function callSlack(method, body) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error || 'unknown error'}`);
  return data;
}

/** Post a plain text message to a channel (e.g. a missing-Authority-Deck alert). */
async function postMessage(channelId, text) {
  return callSlack('chat.postMessage', { channel: channelId, text });
}

/**
 * Upload a file (PDF, MP3, whatever) and share it into a channel with an
 * optional message. channelId can be omitted to upload privately, but for
 * this pipeline we always want it shared.
 */
async function uploadFile(channelId, buffer, filename, initialComment) {
  const getUrlRes = await fetch(`${SLACK_API}/files.getUploadURLExternal`, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, length: buffer.length }),
  });
  const getUrlData = await getUrlRes.json();
  if (!getUrlData.ok) throw new Error(`Slack files.getUploadURLExternal failed: ${getUrlData.error}`);

  const uploadRes = await fetch(getUrlData.upload_url, { method: 'POST', body: buffer });
  if (!uploadRes.ok) throw new Error(`Slack file upload POST failed with status ${uploadRes.status}`);

  return callSlack('files.completeUploadExternal', {
    files: [{ id: getUrlData.file_id, title: filename }],
    channel_id: channelId,
    initial_comment: initialComment,
  });
}

module.exports = { postMessage, uploadFile };
