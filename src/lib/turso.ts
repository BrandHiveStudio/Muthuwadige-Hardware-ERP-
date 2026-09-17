import { createClient, type Client } from '@libsql/client';

// SECURITY: no hardcoded fallback credential - see lib/turso.js (the live Turso client actually
// used by the app) for the full rationale. This file is not imported anywhere in the codebase.
const isWebOrServerless = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.DATABASE_ENGINE === 'turso';
const hasTursoCreds = Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);

if (!hasTursoCreds) {
  if (isWebOrServerless) {
    throw new Error('Turso credentials missing: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must both be set as environment variables.');
  }
}

let dbUrl = process.env.TURSO_DATABASE_URL || '';
// Convert libsql:// to https:// for reliable HTTP-based serverless requests without websocket dropouts
if (dbUrl.startsWith('libsql://')) {
  dbUrl = dbUrl.replace('libsql://', 'https://');
}

const globalForTurso = globalThis as unknown as {
  turso?: Client | null;
  __tursoClient?: Client | null;
  __tursoClientSingleton?: Client | null;
};

export const turso: Client | null = hasTursoCreds
  ? (globalForTurso.__tursoClient ??
     globalForTurso.__tursoClientSingleton ??
     globalForTurso.turso ??
     (typeof global !== 'undefined' && (global as any).__tursoClient) ??
     createClient({
       url: dbUrl,
       authToken: process.env.TURSO_AUTH_TOKEN,
     }))
  : null;

if (turso) {
  globalForTurso.turso = turso;
  globalForTurso.__tursoClient = turso;
  globalForTurso.__tursoClientSingleton = turso;
  if (typeof global !== 'undefined') {
    (global as any).__tursoClient = turso;
  }
}

export default turso;
