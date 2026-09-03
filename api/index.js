import app, { ensureDbInitialized } from '../server.js';

/**
 * Vercel Serverless Function entry point for Express API
 */
export default async function handler(req, res) {
  try {
    if (typeof ensureDbInitialized === 'function') {
      await ensureDbInitialized();
    }
    return app(req, res);
  } catch (err) {
    console.error('🔴 Serverless function handler error:', err);
    return res.status(500).json({ error: 'Internal Server Error: ' + (err?.message || err) });
  }
}

export { app };
