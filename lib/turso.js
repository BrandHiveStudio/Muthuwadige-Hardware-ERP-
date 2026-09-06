import { createClient } from '@libsql/client';

// SECURITY: no hardcoded fallback credential. TURSO_DATABASE_URL / TURSO_AUTH_TOKEN must be
// supplied via environment variables (Vercel project env vars in the cloud, local .env on desktop).
// A previous version of this file hardcoded a live read-write Turso credential here as a "fallback
// default" - that credential must be treated as compromised and rotated in the Turso dashboard/CLI;
// this code no longer has any ability to silently fall back to a baked-in secret.
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error(
    'Turso credentials missing: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must both be set as environment variables. Refusing to start with no hardcoded fallback.'
  );
}

let dbUrl = process.env.TURSO_DATABASE_URL;
// Convert libsql:// to https:// for reliable HTTP-based serverless requests without websocket dropouts
if (dbUrl.startsWith('libsql://')) {
  dbUrl = dbUrl.replace('libsql://', 'https://');
}

const globalForTurso = globalThis;

export const turso =
  globalForTurso.__tursoClientSingleton ??
  createClient({
    url: dbUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

globalForTurso.__tursoClientSingleton = turso;

export default turso;
