import { createClient } from '@libsql/client';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import os from 'os';

let __dirname = '';
try {
  const __filename = fileURLToPath(import.meta.url);
  __dirname = path.dirname(__filename);
} catch {
  __dirname = process.cwd();
}

// Load .env from workspace or AppData if available
const projectEnvPath = path.join(process.cwd(), '.env');
if (fs.existsSync(projectEnvPath)) {
  dotenv.config({ path: projectEnvPath });
}
if (process.env.APPDATA) {
  const appDataEnvPath = path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', '.env');
  if (fs.existsSync(appDataEnvPath)) {
    dotenv.config({ path: appDataEnvPath });
  }
}

let tursoClient = null;
let localSqliteDb = null;
let activeTursoTxn = null;
let isTursoActive = false;

function normalizeParams(params) {
  if (params.length === 0) return [];
  if (params.length === 1) {
    const p = params[0];
    if (p === undefined || p === null) return [];
    if (Array.isArray(p)) return p;
    if (typeof p === 'object') return p;
    return [p];
  }
  return params;
}

function resolveLocalDbPath() {
  if (process.env.VERCEL) return '/tmp/hardware.db';
  const isNodeInElectron = process.env.ELECTRON_RUN_AS_NODE === '1';
  const isProduction = process.env.NODE_ENV === 'production';
  let userDataPath = process.env.USER_DATA_PATH || '';

  if (!userDataPath && (isNodeInElectron || isProduction)) {
    const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    userDataPath = path.join(appDataRoot, 'Muthuwadige Hardware ERP');
  }

  if (userDataPath && fs.existsSync(userDataPath)) {
    return path.join(userDataPath, 'hardware.db');
  }

  const workspaceDb = path.join(process.cwd(), 'hardware.db');
  if (fs.existsSync(workspaceDb)) {
    return workspaceDb;
  }

  return workspaceDb;
}

export const FALLBACK_TURSO_DATABASE_URL = 'libsql://mwhardware-db-sanoj-hardware.aws-ap-south-1.turso.io';
export const FALLBACK_TURSO_AUTH_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg0NTg4MjQsImlkIjoiMDFhMDY3Y2YtZWQwMS03MDYzLWE3MjQtNmIyZTE1ZjJmZWU5Iiwia2lkIjoiSUNBcmxEQWtuSmRPOVBfalA3WG03dDlvdE91NGI1SjFTbWpmY281b1dJayIsInJpZCI6IjQzNzRjMmFjLThiZjQtNDczNi05NzllLTdlYTUyNTk1MWVjNiJ9.Gz4XtMMKAAEGHQN2uEO4tTN3ZRaIWMBU7QrXkHkxRae-1nkw35-old6H_o_S6BioJPtiPvncMxVdP4uN_yOyAQ';

if (!process.env.TURSO_DATABASE_URL) process.env.TURSO_DATABASE_URL = FALLBACK_TURSO_DATABASE_URL;
if (!process.env.TURSO_AUTH_TOKEN) process.env.TURSO_AUTH_TOKEN = FALLBACK_TURSO_AUTH_TOKEN;

export function getTursoClient() {
  let tursoUrl = process.env.TURSO_DATABASE_URL || FALLBACK_TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN || FALLBACK_TURSO_AUTH_TOKEN;

  if (tursoUrl && tursoUrl.startsWith('libsql://')) {
    tursoUrl = tursoUrl.replace('libsql://', 'https://');
  }

  if (tursoUrl && tursoToken) {
    if (!globalThis.__tursoClientSingleton) {
      globalThis.__tursoClientSingleton = createClient({ url: tursoUrl, authToken: tursoToken });
    }
    tursoClient = globalThis.__tursoClientSingleton;
    return tursoClient;
  }
  return null;
}

export async function initDb(customDbPath) {
  const isWebEnvironment = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.DATABASE_ENGINE === 'turso';
  let tursoUrl = process.env.TURSO_DATABASE_URL || FALLBACK_TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN || FALLBACK_TURSO_AUTH_TOKEN;

  if (tursoUrl && tursoUrl.startsWith('libsql://')) {
    tursoUrl = tursoUrl.replace('libsql://', 'https://');
  }

  if (isWebEnvironment || (tursoUrl && tursoToken && (process.env.VERCEL || process.env.APP_ROLE === 'web'))) {
    if (!tursoUrl || !tursoToken) {
      throw new Error('Vercel serverless environment detected, but TURSO_DATABASE_URL or TURSO_AUTH_TOKEN environment variable is missing.');
    }
    console.log('⚡ [DualEngine] Web environment detected. Primary: Turso Cloud libSQL (HTTPS Transport).');
    if (!globalThis.__tursoClientSingleton) {
      globalThis.__tursoClientSingleton = createClient({
        url: tursoUrl,
        authToken: tursoToken
      });
    }
    tursoClient = globalThis.__tursoClientSingleton;
    isTursoActive = true;
    console.log(`✅ [DualEngine] Connected to Turso Cloud at: ${tursoUrl}`);
  } else {
    // Desktop / In-Store local SQLite fallback: lazily load sqlite3 so Vercel never touches native binaries
    const { open } = await import('sqlite');
    const sqlite3Module = await import('sqlite3');
    const sqlite3Driver = sqlite3Module.default || sqlite3Module;

    const targetDbPath = customDbPath || resolveLocalDbPath();
    console.log(`📁 [DualEngine] In-Store Desktop Counter mode. Primary: Local SQLite (${targetDbPath})`);

    localSqliteDb = await open({
      filename: targetDbPath,
      driver: sqlite3Driver.Database
    });

    try {
      await localSqliteDb.exec('PRAGMA busy_timeout = 15000;');
      await localSqliteDb.exec('PRAGMA journal_mode = WAL;');
      await localSqliteDb.exec('PRAGMA synchronous = NORMAL;');
    } catch {
      // Best-effort local pragma initialization
    }

    isTursoActive = false;
    console.log(`✅ [DualEngine] Connected to local SQLite database with WAL enabled: ${targetDbPath}`);
  }

  return db;
}

export async function getDb() {
  if (!tursoClient && !localSqliteDb) {
    await initDb();
  }
  return db;
}

export function isTurso() {
  return isTursoActive;
}

export async function all(sql, ...params) {
  await getDb();
  const normalized = normalizeParams(params);

  if (isTursoActive && tursoClient) {
    const executor = activeTursoTxn || tursoClient;
    const res = await executor.execute({ sql, args: normalized });
    return res.rows || [];
  }

  if (localSqliteDb) {
    if (params.length === 1 && Array.isArray(params[0])) {
      return localSqliteDb.all(sql, params[0]);
    }
    return localSqliteDb.all(sql, ...params);
  }

  throw new Error('Database is not initialized');
}

export async function get(sql, ...params) {
  await getDb();
  const normalized = normalizeParams(params);

  if (isTursoActive && tursoClient) {
    const executor = activeTursoTxn || tursoClient;
    const res = await executor.execute({ sql, args: normalized });
    if (res.rows && res.rows.length > 0) {
      return res.rows[0];
    }
    return undefined;
  }

  if (localSqliteDb) {
    if (params.length === 1 && Array.isArray(params[0])) {
      return localSqliteDb.get(sql, params[0]);
    }
    return localSqliteDb.get(sql, ...params);
  }

  throw new Error('Database is not initialized');
}

export async function run(sql, ...params) {
  await getDb();
  const trimmed = sql.trim().toUpperCase();

  if (isTursoActive && tursoClient) {
    // Intercept transactions transparently for Turso Cloud over HTTP
    if (trimmed === 'BEGIN' || trimmed === 'BEGIN TRANSACTION') {
      if (!activeTursoTxn) {
        activeTursoTxn = await tursoClient.transaction('write');
      }
      return { changes: 0, rowsAffected: 0 };
    }

    if (trimmed === 'COMMIT' || trimmed === 'END TRANSACTION') {
      if (activeTursoTxn) {
        await activeTursoTxn.commit();
        activeTursoTxn = null;
      }
      return { changes: 0, rowsAffected: 0 };
    }

    if (trimmed === 'ROLLBACK' || trimmed === 'ROLLBACK TRANSACTION') {
      if (activeTursoTxn) {
        try {
          await activeTursoTxn.rollback();
        } catch {
          // Ignore rollback errors if already aborted
        } finally {
          activeTursoTxn = null;
        }
      }
      return { changes: 0, rowsAffected: 0 };
    }

    // Safely skip SQLite-only WAL pragmas on remote cloud databases
    if (trimmed.startsWith('PRAGMA WAL_CHECKPOINT') || trimmed.startsWith('PRAGMA JOURNAL_MODE')) {
      return { changes: 0, rowsAffected: 0 };
    }

    const normalized = normalizeParams(params);
    const executor = activeTursoTxn || tursoClient;
    const res = await executor.execute({ sql, args: normalized });

    return {
      changes: res.rowsAffected,
      rowsAffected: res.rowsAffected,
      lastID: res.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : undefined,
      lastInsertRowid: res.lastInsertRowid
    };
  }

  if (localSqliteDb) {
    let rawRes;
    if (params.length === 1 && Array.isArray(params[0])) {
      rawRes = await localSqliteDb.run(sql, params[0]);
    } else {
      rawRes = await localSqliteDb.run(sql, ...params);
    }

    const changes = rawRes?.changes ?? 0;
    const lastID = rawRes?.lastID;
    return {
      changes,
      rowsAffected: changes,
      lastID,
      lastInsertRowid: lastID !== undefined ? BigInt(lastID) : undefined
    };
  }

  throw new Error('Database is not initialized');
}

export async function exec(sql) {
  await getDb();

  if (isTursoActive && tursoClient) {
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('PRAGMA WAL_CHECKPOINT') || trimmed.startsWith('PRAGMA JOURNAL_MODE')) {
      return;
    }
    await tursoClient.executeMultiple(sql);
    return;
  }

  if (localSqliteDb) {
    await localSqliteDb.exec(sql);
    return;
  }

  throw new Error('Database is not initialized');
}

export async function close() {
  if (activeTursoTxn) {
    try {
      await activeTursoTxn.rollback();
    } catch {}
    activeTursoTxn = null;
  }

  if (tursoClient) {
    tursoClient.close();
    tursoClient = null;
  }

  if (localSqliteDb) {
    await localSqliteDb.close();
    localSqliteDb = null;
  }

  isTursoActive = false;
}

export const db = {
  isTurso,
  all,
  get,
  run,
  exec,
  close,
  getUnderlyingClient: () => (isTursoActive ? tursoClient : localSqliteDb)
};

export default db;
