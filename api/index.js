// Vercel serverless entrypoint — wraps the Express app exported by app.js.
// Vercel auto-detects files in /api as serverless functions; vercel.json
// rewrites all /api/* requests here so Express handles its own routing.
module.exports = require('../app.js');
