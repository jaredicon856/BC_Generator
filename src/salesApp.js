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
async function pushDocumentsToSalesApp({ clientEmail, clientName, documents }) {
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

module.exports = { pushDocumentsToSalesApp, fetchClientPackage };
