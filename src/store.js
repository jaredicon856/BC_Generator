// Placeholder key/value store for cross-call state -- e.g. the Authority Deck
// output that has to survive between Strategy Call 1 and Strategy Call 2, and
// a processed-recording set so Zapier retries don't double-generate a deck.
//
// WARNING: this is an IN-MEMORY implementation. Vercel serverless functions
// do not share memory across invocations and are recycled on cold starts, so
// this will NOT reliably carry data from Call 1 to Call 2 in production --
// it exists so the webhook logic below has something to call today. Before
// relying on this for real client data, swap it for Vercel KV, Upstash
// Redis, or an Airtable/Google Sheet row -- same get/set/has interface, just
// change what's inside these three functions.

const memory = new Map();

async function get(key) {
  return memory.has(key) ? memory.get(key) : null;
}

async function set(key, value) {
  memory.set(key, value);
}

async function has(key) {
  return memory.has(key);
}

module.exports = { get, set, has };
