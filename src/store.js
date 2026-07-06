// Cross-call state store -- backed by Upstash Redis (connected via Vercel's
// Storage integration). Used to carry a client's Authority Deck output from
// Strategy Call 1 forward to Strategy Call 2, and to dedupe processed
// Fathom recordings so a Zapier/Make retry doesn't regenerate a deck.
const { Redis } = require('@upstash/redis');

if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
  console.error('[ERROR] KV_REST_API_URL / KV_REST_API_TOKEN not set. Connect the Upstash for Redis storage integration to this project in the Vercel dashboard.');
}

const redis = Redis.fromEnv();

// 30-day TTL: comfortably longer than the real-world gap between Strategy
// Call 1 and Strategy Call 2, short enough that stale/abandoned client data
// doesn't accumulate forever. Override per-call with opts.ttlSeconds if needed.
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

async function get(key) {
  const value = await redis.get(key);
  return value ?? null;
}

async function set(key, value, opts = {}) {
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  await redis.set(key, value, { ex: ttlSeconds });
}

async function has(key) {
  const exists = await redis.exists(key);
  return exists === 1;
}

module.exports = { get, set, has };
