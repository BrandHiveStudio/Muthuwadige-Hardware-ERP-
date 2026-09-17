import { createClient, type Client } from '@libsql/client';

// SECURITY: no hardcoded fallback credential - see lib/turso.js (the live twin of this unused
// file) for the full rationale.
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
  turso: Client | null | undefined;
};

export const turso: Client | null = hasTursoCreds
  ? (globalForTurso.turso ??
     createClient({
       url: dbUrl,
       authToken: process.env.TURSO_AUTH_TOKEN,
     }))
  : null;

if (process.env.NODE_ENV !== 'production') globalForTurso.turso = turso;

export default turso;
