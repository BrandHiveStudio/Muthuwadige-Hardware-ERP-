import { createClient, Client, Transaction } from '@libsql/client';
import type { Database } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import os from 'os';

export interface RunResult {
  changes: number;
  rowsAffected: number;
  lastID?: number | bigint;
  lastInsertRowid?: bigint;
}

export interface UnifiedDatabase {
  isTurso: () => boolean;
  all: <T = any>(sql: string, ...params: any[]) => Promise<T[]>;
  get: <T = any>(sql: string, ...params: any[]) => Promise<T | undefined>;
  run: (sql: string, ...params: any[]) => Promise<RunResult>;
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
  getUnderlyingClient: () => Client | Database | null;
}

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

let tursoClient: Client | null = null;
let localSqliteDb: Database | null = null;
let activeTursoTxn: Transaction | null = null;
let isTursoActive = false;

function normalizeParams(params: any[]): any {
  if (!params || params.length === 0) return [];
  let p = params;
  if (params.length === 1 && (Array.isArray(params[0]) || (typeof params[0] === 'object' && params[0] !== null))) {
    p = params[0];
  }
  if (Array.isArray(p)) {
    return p.map(v => (v === undefined ? null : v));
  }
  if (typeof p === 'object' && p !== null) {
    const sanitized: Record<string, any> = {};
    for (const [k, v] of Object.entries(p)) {
      sanitized[k] = v === undefined ? null : v;
    }
    return sanitized;
  }
  return p === undefined ? [null] : [p];
}

function resolveLocalDbPath(): string {
  if (process.env.VERCEL || process.env.APP_ROLE === 'web' || process.env.DATABASE_ENGINE === 'turso') {
    throw new Error('Local SQLite is disabled in web/serverless environment. All database operations must target Turso Cloud.');
  }
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

// SECURITY: no hardcoded fallback credential - see src/db/connection.js (the live twin of this
// unused file) for the full rationale. TURSO_DATABASE_URL / TURSO_AUTH_TOKEN must come from
// environment variables only.

export function getTursoClient(): Client | null {
  let tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl && tursoUrl.startsWith('libsql://')) {
    tursoUrl = tursoUrl.replace('libsql://', 'https://');
  }

  if (tursoUrl && tursoToken) {
    const globalForTurso = globalThis as unknown as { __tursoClientSingleton?: Client; __tursoClient?: Client };
    if (!globalForTurso.__tursoClientSingleton && !globalForTurso.__tursoClient) {
      const client = createClient({ url: tursoUrl, authToken: tursoToken });
      globalForTurso.__tursoClientSingleton = client;
      globalForTurso.__tursoClient = client;
      if (typeof global !== 'undefined') {
        (global as any).__tursoClient = client;
      }
    }
    tursoClient = (globalForTurso.__tursoClient || globalForTurso.__tursoClientSingleton) as Client;
    return tursoClient;
  }
  return null;
}

export async function initDb(customDbPath?: string): Promise<UnifiedDatabase> {
  const isWebEnvironment = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.DATABASE_ENGINE === 'turso';
  let tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl && tursoUrl.startsWith('libsql://')) {
    tursoUrl = tursoUrl.replace('libsql://', 'https://');
  }

  if (isWebEnvironment || (tursoUrl && tursoToken && (process.env.VERCEL || process.env.APP_ROLE === 'web'))) {
    if (!tursoUrl || !tursoToken) {
      throw new Error('Vercel serverless environment detected, but TURSO_DATABASE_URL or TURSO_AUTH_TOKEN environment variable is missing.');
    }
    console.log('⚡ [DualEngine] Web environment detected. Primary: Turso Cloud libSQL (HTTPS Transport).');
    const client = getTursoClient() || createClient({
      url: tursoUrl,
      authToken: tursoToken
    });
    tursoClient = client;
    isTursoActive = true;
    console.log(`✅ [DualEngine] Connected to Turso Cloud at: ${tursoUrl}`);
  } else {
    // Desktop / In-Store local SQLite fallback: lazily load sqlite3 so Vercel never touches native binaries
    const { open } = await import('sqlite');
    const sqlite3Module = await import('sqlite3');
    const sqlite3Driver = (sqlite3Module as any).default || sqlite3Module;

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

export async function getDb(): Promise<UnifiedDatabase> {
  if (isTurso()) {
    if (!tursoClient) {
      tursoClient = getTursoClient();
    }
    if (!tursoClient) {
      await initDb();
    }
    isTursoActive = true;
    return db;
  }
  if (!localSqliteDb) {
    await initDb();
  }
  return db;
}

export function isTurso(): boolean {
  return Boolean(
    isTursoActive ||
    process.env.VERCEL ||
    process.env.APP_ROLE === 'web' ||
    process.env.DATABASE_ENGINE === 'turso' ||
    (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN && !localSqliteDb)
  );
}

export async function all<T = any>(sql: string, ...params: any[]): Promise<T[]> {
  await getDb();
  const normalized = normalizeParams(params);

  if (isTurso()) {
    const client = tursoClient || getTursoClient();
    if (!client) throw new Error('Turso client is not initialized in web mode.');
    const executor = activeTursoTxn || client;
    const res = await executor.execute({ sql, args: normalized });
    return (res.rows || []) as unknown as T[];
  }

  if (localSqliteDb) {
    if (params.length === 1 && Array.isArray(params[0])) {
      return localSqliteDb.all<T[]>(sql, params[0]);
    }
    return (localSqliteDb.all as any)(sql, ...params);
  }

  throw new Error('Database is not initialized');
}

export async function get<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
  await getDb();
  const normalized = normalizeParams(params);

  if (isTurso()) {
    const client = tursoClient || getTursoClient();
    if (!client) throw new Error('Turso client is not initialized in web mode.');
    const executor = activeTursoTxn || client;
    const res = await executor.execute({ sql, args: normalized });
    if (res.rows && res.rows.length > 0) {
      return res.rows[0] as unknown as T;
    }
    return undefined;
  }

  if (localSqliteDb) {
    if (params.length === 1 && Array.isArray(params[0])) {
      return localSqliteDb.get<T>(sql, params[0]);
    }
    return (localSqliteDb.get as any)(sql, ...params);
  }

  throw new Error('Database is not initialized');
}

export async function run(sql: string, ...params: any[]): Promise<RunResult> {
  await getDb();
  const trimmed = sql.trim().toUpperCase();

  if (isTurso()) {
    const client = tursoClient || getTursoClient();
    if (!client) throw new Error('Turso client is not initialized in web mode.');

    // Intercept transactions transparently for Turso Cloud over HTTP
    if (trimmed === 'BEGIN' || trimmed === 'BEGIN TRANSACTION') {
      if (!activeTursoTxn) {
        try {
          activeTursoTxn = await client.transaction('write');
        } catch (_) {
          activeTursoTxn = null;
        }
      }
      return { changes: 0, rowsAffected: 0 };
    }

    if (trimmed === 'COMMIT' || trimmed === 'COMMIT TRANSACTION' || trimmed === 'END TRANSACTION' || trimmed === 'END') {
      if (activeTursoTxn) {
        try {
          await activeTursoTxn.commit();
        } finally {
          activeTursoTxn = null;
        }
      }
      return { changes: 0, rowsAffected: 0 };
    }

    if (trimmed === 'ROLLBACK' || trimmed === 'ROLLBACK TRANSACTION') {
      if (activeTursoTxn) {
        try {
          await activeTursoTxn.rollback();
        } catch (_) {
        } finally {
          activeTursoTxn = null;
        }
      }
      return { changes: 0, rowsAffected: 0 };
    }

    // Safely skip SQLite-only WAL pragmas on remote cloud databases
    if (trimmed.startsWith('PRAGMA WAL_CHECKPOINT') || trimmed.startsWith('PRAGMA JOURNAL_MODE') || trimmed.startsWith('PRAGMA BUSY_TIMEOUT') || trimmed.startsWith('PRAGMA SYNCHRONOUS')) {
      return { changes: 0, rowsAffected: 0 };
    }

    const normalized = normalizeParams(params);
    const executor = activeTursoTxn || client;
    const res = await executor.execute({ sql, args: normalized });

    return {
      changes: Number(res?.rowsAffected || 0),
      rowsAffected: Number(res?.rowsAffected || 0),
      lastID: res?.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : undefined,
      lastInsertRowid: res?.lastInsertRowid
    };
  }

  if (localSqliteDb) {
    let rawRes: any;
    if (params.length === 1 && Array.isArray(params[0])) {
      rawRes = await localSqliteDb.run(sql, params[0]);
    } else {
      rawRes = await (localSqliteDb.run as any)(sql, ...params);
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

export async function exec(sql: string): Promise<void> {
  await getDb();

  if (isTurso()) {
    const client = tursoClient || getTursoClient();
    if (!client) throw new Error('Turso client is not initialized in web mode.');
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('PRAGMA WAL_CHECKPOINT') || trimmed.startsWith('PRAGMA JOURNAL_MODE') || trimmed.startsWith('PRAGMA BUSY_TIMEOUT') || trimmed.startsWith('PRAGMA SYNCHRONOUS')) {
      return;
    }
    await client.executeMultiple(sql);
    return;
  }

  if (localSqliteDb) {
    await localSqliteDb.exec(sql);
    return;
  }

  throw new Error('Database is not initialized');
}

export async function close(): Promise<void> {
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

export const db: UnifiedDatabase = {
  isTurso,
  all,
  get,
  run,
  exec,
  close,
  getUnderlyingClient: () => (isTursoActive ? tursoClient : localSqliteDb)
};

export default db;
