import { turso } from '../lib/turso.js';
import { app, ensureDbInitialized } from '../server.js';

export default async function handler(req, res) {
  try {
    if (turso) {
      await turso.execute('SELECT 1');
    } else if (typeof ensureDbInitialized === 'function') {
      const db = await ensureDbInitialized();
      if (db) await db.get('SELECT 1');
    }
    return res.status(200).json({
      status: 'ok',
      environment: process.env.VERCEL ? 'vercel-serverless' : 'desktop-local',
      timestamp: Date.now()
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error?.message || 'Health probe failed',
      timestamp: Date.now()
    });
  }
}
