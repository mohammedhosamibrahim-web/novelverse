/**
 * Vercel serverless entry — @vercel/node wraps the Express app.
 * The app's static client serving (client/dist) is handled by vercel.json
 * routes; /api/* is handled here.
 */
const { app } = require('../server/index');
module.exports = app;
