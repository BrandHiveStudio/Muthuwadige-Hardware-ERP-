import { createClient } from '@libsql/client';

let dbUrl = process.env.TURSO_DATABASE_URL || 'libsql://mwhardware-db-sanoj-hardware.aws-ap-south-1.turso.io';
// Convert libsql:// to https:// for reliable HTTP-based serverless requests without websocket dropouts
if (dbUrl.startsWith('libsql://')) {
  dbUrl = dbUrl.replace('libsql://', 'https://');
}

const globalForTurso = globalThis;

export const turso =
  globalForTurso.__tursoClientSingleton ??
  createClient({
    url: dbUrl,
    authToken: process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg0NTg4MjQsImlkIjoiMDFhMDY3Y2YtZWQwMS03MDYzLWE3MjQtNmIyZTE1ZjJmZWU5Iiwia2lkIjoiSUNBcmxEQWtuSmRPOVBfalA3WG03dDlvdE91NGI1SjFTbWpmY281b1dJayIsInJpZCI6IjQzNzRjMmFjLThiZjQtNDczNi05NzllLTdlYTUyNTk1MWVjNiJ9.Gz4XtMMKAAEGHQN2uEO4tTN3ZRaIWMBU7QrXkHkxRae-1nkw35-old6H_o_S6BioJPtiPvncMxVdP4uN_yOyAQ',
  });

globalForTurso.__tursoClientSingleton = turso;

export default turso;
