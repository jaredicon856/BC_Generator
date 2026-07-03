// ── Memory bank ────────────────────────────────────────
// Server-side persistence for saved Authority Decks, keyed by client.
// Stage 1 saves a deck here; days later Stage 2 pulls it by client to build
// the Strategy Guide. A client is identified by email (primary) + name.
//
// One JSON file per client under data/decks/. Each file holds the latest
// deck plus an archive of prior versions (regenerating a client's deck keeps
// the newest active and pushes the old one into `versions`).

const fs   = require('fs');
const path = require('path');

const DECKS_DIR = path.join(__dirname, '..', 'data', 'decks');

function slug(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// A client's storage key. Email is the strong identifier; fall back to name.
function keyFor(email, name) {
  const e = slug(email);
  if (e) return e;
  const n = slug(name);
  return n ? `name-${n}` : '';
}

function fileFor(key) {
  return path.join(DECKS_DIR, `${key}.json`);
}

function readFile(key) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(key), 'utf8'));
  } catch (_) {
    return null;
  }
}

// ── Save (create or update) ────────────────────────────
function save({ email, name, docType, json, markdown }) {
  const key = keyFor(email, name);
  if (!key) throw new Error('A client email or name is required to save a deck');

  fs.mkdirSync(DECKS_DIR, { recursive: true });
  const now      = new Date().toISOString();
  const existing = readFile(key);

  const record = {
    key,
    email:     (email || '').trim(),
    name:      (name || '').trim(),
    docType:   docType || (json && json.doc_type) || '',
    json:      json || null,
    markdown:  markdown || '',
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    versions:  existing ? (existing.versions || []) : [],
  };

  // Archive the prior active version (cap history to the last 10).
  if (existing && (existing.json || existing.markdown)) {
    record.versions = [
      { docType: existing.docType, json: existing.json, markdown: existing.markdown, savedAt: existing.updatedAt },
      ...record.versions,
    ].slice(0, 10);
  }

  fs.writeFileSync(fileFor(key), JSON.stringify(record, null, 2));
  return record;
}

// ── Read helpers ───────────────────────────────────────
function summarize(r) {
  return {
    key:       r.key,
    email:     r.email,
    name:      r.name,
    docType:   r.docType,
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
    versionCount: (r.versions || []).length,
  };
}

function list() {
  let files = [];
  try { files = fs.readdirSync(DECKS_DIR).filter((f) => f.endsWith('.json')); } catch (_) { return []; }
  return files
    .map((f) => readFile(f.replace(/\.json$/, '')))
    .filter(Boolean)
    .map(summarize)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function get(key) {
  return readFile(key);
}

// Look a client up for Stage 2. Match on email first (exact, normalized),
// then fall back to name.
function findByClient(email, name) {
  const byEmail = slug(email) ? readFile(slug(email)) : null;
  if (byEmail) return byEmail;

  const nk = slug(name);
  if (nk) {
    const byNameKey = readFile(`name-${nk}`);
    if (byNameKey) return byNameKey;
    // Last resort: a deck saved under an email key whose stored name matches.
    const match = list().find((r) => slug(r.name) === nk);
    if (match) return readFile(match.key);
  }
  return null;
}

function remove(key) {
  try { fs.unlinkSync(fileFor(key)); return true; } catch (_) { return false; }
}

module.exports = { save, list, get, findByClient, remove, keyFor };
