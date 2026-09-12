import { createClient, type Client } from '@libsql/client';

// SECURITY: no hardcoded fallback credential - see lib/turso.js (the live Turso client actually
// used by the app) for the full rationale. This file is not imported anywhere in the codebase.
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error('Turso credentials missing: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must both be set as environment variables.');
}

let dbUrl = process.env.TURSO_DATABASE_URL;
// Convert libsql:// to https:// for reliable HTTP-based serverless requests without websocket dropouts
if (dbUrl.startsWith('libsql://')) {
  dbUrl = dbUrl.replace('libsql://', 'https://');
}

const globalForTurso = globalThis as unknown as {
  turso?: Client;
  __tursoClient?: Client;
  __tursoClientSingleton?: Client;
};

export const turso: Client =
  globalForTurso.__tursoClient ??
  globalForTurso.__tursoClientSingleton ??
  globalForTurso.turso ??
  (typeof global !== 'undefined' && (global as any).__tursoClient) ??
  createClient({
    url: dbUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

globalForTurso.turso = turso;
globalForTurso.__tursoClient = turso;
globalForTurso.__tursoClientSingleton = turso;
if (typeof global !== 'undefined') {
  (global as any).__tursoClient = turso;
}

export default turso;
