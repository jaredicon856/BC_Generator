// ── ICON sales-app push ────────────────────────────────
// After a Strategy Call 1 package is generated, push the PDFs to the ICON
// sales app (icon-sales-app) so they attach to the client's profile, matched
// by email. Additive and non-fatal: a failure here never affects Slack
// delivery or generation. The sales app attaches to EXISTING clients only —
// a "no_matching_client" response is a normal, expected outcome.

const SALES_APP_URL = (process.env.SALES_APP_URL || '').replace(/\/+$/, '');
const BC_INGEST_SECRET = process.env.BC_INGEST_SECRET || '';

// documents: [{ type: 'authority_codex' | 'podcast_strategy_guide',
//               filename, bytes: Buffer|Uint8Array, mimeType? }]
// packageId (optional): the package this codex was generated for
// (ecosystem|accelerator|podcast|custom) — the sales app applies it to the
// client when their package is still unknown, so Iris becomes package-aware.
async function pushDocumentsToSalesApp({ clientEmail, clientName, documents, packageId }) {
  if (!SALES_APP_URL || !BC_INGEST_SECRET) {
    console.warn('[salesApp] SALES_APP_URL / BC_INGEST_SECRET not set — skipping sales-app push.');
    return null;
  }
  if (!clientEmail) {
    console.warn('[salesApp] No client email — cannot match a client profile, skipping push.');
    return null;
  }

  const now = new Date().toISOString();
  const payload = {
    clientEmail,
    clientName: clientName || '',
    packageId: packageId || undefined,
    documents: (documents || []).map((d) => ({
      type: d.type,
      filename: d.filename,
      mimeType: d.mimeType || 'application/pdf',
      generatedAt: now,
      base64: Buffer.from(d.bytes).toString('base64'),
    })),
  };

  const res = await fetch(`${SALES_APP_URL}/api/ingest/client-documents`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${BC_INGEST_SECRET}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`sales-app ingest ${res.status}: ${data.error || 'failed'}`);
  }
  return data; // { ok, attached, clientId?, stored?, reason? }
}

// Look up a client's package (ecosystem|accelerator|podcast|custom) from the
// sales app by email, so the codex can be scoped to what they bought. Returns
// the package id, or null if not configured / no matching client / no package.
async function fetchClientPackage(clientEmail) {
  if (!SALES_APP_URL || !BC_INGEST_SECRET || !clientEmail) return null;
  const url = `${SALES_APP_URL}/api/ingest/client-package?email=${encodeURIComponent(clientEmail)}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${BC_INGEST_SECRET}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.found) return null;
  return data.packageId || null;
}

// Pull a client's Strategy Call transcript from the sales app's already-synced
// Fathom data, so Regenerate can reuse the existing recording instead of
// asking anyone to paste one. Returns { transcript, recordingId, presentedDate,
// title, source } or null if not configured / no matching call / no content.
async function fetchClientTranscript(clientEmail, clientName) {
  if (!SALES_APP_URL || !BC_INGEST_SECRET) return null;
  if (!clientEmail && !clientName) return null;
  const params = new URLSearchParams();
  if (clientEmail) params.set('email', clientEmail);
  if (clientName)  params.set('name', clientName);
  const url = `${SALES_APP_URL}/api/ingest/client-transcript?${params.toString()}`;
  let res;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${BC_INGEST_SECRET}` } });
  } catch (err) {
    console.warn('[salesApp] client-transcript fetch failed:', err.message);
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.found || !data.transcript) return null;
  return {
    transcript:    data.transcript,
    recordingId:   data.recordingId || '',
    presentedDate: data.presentedDate || '',
    title:         data.title || '',
    source:        data.source || 'transcript',
  };
}

module.exports = { pushDocumentsToSalesApp, fetchClientPackage, fetchClientTranscript };
