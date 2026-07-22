// ── Memory bank ────────────────────────────────────────
// Server-side persistence for saved Authority Decks, keyed by client.
// Stage 1 saves a deck here; days later Stage 2 pulls it by client to build
// the Strategy Guide. A client is identified by email (primary) + name.
//
// Storage backend:
//   - Upstash Redis when KV_REST_API_URL / KV_REST_API_TOKEN are set (Vercel —
//     the serverless filesystem is read-only, so disk persistence is not an
//     option there). One record per client at deckmem:<key>, plus a
//     deckmem:index set for listing.
//   - Local JSON files under data/decks/ otherwise (dev without Redis creds).
// All read/write functions are async so both backends share one interface.

const fs   = require('fs');
const path = require('path');

const DECKS_DIR = path.join(__dirname, '..', 'data', 'decks');

const HAS_REDIS = !!(
  (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
  (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
);

// Lazily constructed so local dev without creds never touches the client.
let redis = null;
function getRedis() {
  if (!redis) {
    const { Redis } = require('@upstash/redis');
    redis = Redis.fromEnv();
  }
  return redis;
}

const REC_PREFIX = 'deckmem:';
const INDEX_KEY  = 'deckmem:index';

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

// ── File backend helpers (local dev) ───────────────────
function fileFor(key) {
  return path.join(DECKS_DIR, `${key}.json`);
}

function readFileRecord(key) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(key), 'utf8'));
  } catch (_) {
    return null;
  }
}

// ── Backend-agnostic record access ─────────────────────
async function readRecord(key) {
  if (!key) return null;
  if (HAS_REDIS) {
    const rec = await getRedis().get(REC_PREFIX + key);
    return rec || null;
  }
  return readFileRecord(key);
}

async function writeRecord(key, record) {
  if (HAS_REDIS) {
    // No TTL: the memory bank is a client library, not transient call state.
    const r = getRedis();
    await r.set(REC_PREFIX + key, record);
    await r.sadd(INDEX_KEY, key);
    return;
  }
  fs.mkdirSync(DECKS_DIR, { recursive: true });
  fs.writeFileSync(fileFor(key), JSON.stringify(record, null, 2));
}

async function allKeys() {
  if (HAS_REDIS) {
    const keys = await getRedis().smembers(INDEX_KEY);
    return keys || [];
  }
  try {
    return fs.readdirSync(DECKS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch (_) {
    return [];
  }
}

// ── Save (create or update) ────────────────────────────
async function save({ email, name, docType, package: pkg, json, markdown }) {
  const key = keyFor(email, name);
  if (!key) throw new Error('A client email or name is required to save a deck');

  const now      = new Date().toISOString();
  const existing = await readRecord(key);

  const record = {
    key,
    email:     (email || '').trim(),
    name:      (name || '').trim(),
    docType:   docType || (json && json.doc_type) || '',
    package:   pkg || (existing && existing.package) || '',
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

  await writeRecord(key, record);
  return record;
}

// ── Read helpers ───────────────────────────────────────
function summarize(r) {
  return {
    key:       r.key,
    email:     r.email,
    name:      r.name,
    docType:   r.docType,
    package:   r.package || '',
    updatedAt: r.updatedAt,
    createdAt: r.createdAt,
    versionCount: (r.versions || []).length,
  };
}

async function list() {
  const keys = await allKeys();
  if (!keys.length) return [];
  let records;
  if (HAS_REDIS) {
    records = await getRedis().mget(...keys.map((k) => REC_PREFIX + k));
  } else {
    records = keys.map(readFileRecord);
  }
  return records
    .filter(Boolean)
    .map(summarize)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

async function get(key) {
  return readRecord(key);
}

// Look a client up for Stage 2. Match on email first (exact, normalized),
// then fall back to name.
async function findByClient(email, name) {
  const byEmail = slug(email) ? await readRecord(slug(email)) : null;
  if (byEmail) return byEmail;

  const nk = slug(name);
  if (nk) {
    const byNameKey = await readRecord(`name-${nk}`);
    if (byNameKey) return byNameKey;
    // Last resort: a deck saved under an email key whose stored name matches.
    const match = (await list()).find((r) => slug(r.name) === nk);
    if (match) return readRecord(match.key);
  }
  return null;
}

async function remove(key) {
  if (HAS_REDIS) {
    const r = getRedis();
    const deleted = await r.del(REC_PREFIX + key);
    await r.srem(INDEX_KEY, key);
    return deleted > 0;
  }
  try { fs.unlinkSync(fileFor(key)); return true; } catch (_) { return false; }
}

module.exports = { save, list, get, findByClient, remove, keyFor };
