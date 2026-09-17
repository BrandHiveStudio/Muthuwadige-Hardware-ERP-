import { createClient } from '@libsql/client';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import os from 'os';
import { AsyncLocalStorage } from 'node:async_hooks';

let __dirname = '';
try {
  const __filename = fileURLToPath(import.meta.url);
  __dirname = path.dirname(__filename);
} catch {
  __dirname = process.cwd();
}

// Load .env from workspace or AppData if available (guarded against test environments for strict isolation)
if (process.env.NODE_ENV !== 'test') {
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
}

let tursoClient = null;
let localSqliteDb = null;
let activeTursoTxn = null;
let isTursoActive = false;

/**
 * ARCHITECTURAL NOTICE:
 * Legacy string transactions (db.run('BEGIN TRANSACTION') / db.run('COMMIT')) do NOT
 * acquire full-transaction exclusive ownership on sqliteQueue and share global activeTursoTxn.
 * The database adapter remains UNSUITABLE FOR CONCURRENT BUSINESS USE until all legacy
 * transaction callers in server.js are migrated to db.transaction(callback).
 */

const txnStorage = new AsyncLocalStorage();
let txnCounter = 0;
let opCounter = 0;

class SqliteConnectionQueue {
  constructor() {
    this.activeOwner = null; // { id, isTxn }
    this.waitQueue = [];     // Array of { resolve, reject, id, isTxn }
    this.isQuarantined = false;
    this.quarantineError = null;
    this.isShuttingDown = false;
    this.isClosed = false;
  }

  async acquire(id, isTxn) {
    if (this.isQuarantined) {
      throw new Error(`[DB-QUARANTINE] Database connection is quarantined: ${this.quarantineError}`);
    }
    if (this.isShuttingDown || this.isClosed) {
      throw new Error('[DB-CLOSED] Database connection is closing or closed');
    }
    if (!this.activeOwner) {
      this.activeOwner = { id, isTxn };
      return;
    }
    await new Promise((resolve, reject) => {
      this.waitQueue.push({ resolve, reject, id, isTxn });
    });
  }

  release(id) {
    if (this.activeOwner && this.activeOwner.id === id) {
      this.activeOwner = null;
      if (this.waitQueue.length > 0) {
        const next = this.waitQueue.shift();
        this.activeOwner = { id: next.id, isTxn: next.isTxn };
        next.resolve();
      }
    }
  }

  quarantine(errorMsg) {
    this.isQuarantined = true;
    this.quarantineError = errorMsg;
    const waiters = this.waitQueue;
    this.waitQueue = [];
    for (const w of waiters) {
      try {
        w.reject(new Error(`[DB-QUARANTINE] Database connection is quarantined: ${errorMsg}`));
      } catch (_) {}
    }
    // Note: activeOwner is NOT released to prevent any subsequent queries from using this corrupted handle.
  }

  async shutdown(timeoutMs = 5000) {
    this.isShuttingDown = true;
    const waiters = this.waitQueue;
    this.waitQueue = [];
    for (const w of waiters) {
      try {
        w.reject(new Error('[DB-CLOSED] Database connection was closed while operation was waiting'));
      } catch (_) {}
    }

    const start = Date.now();
    while (this.activeOwner) {
      if (this.isQuarantined) {
        // Safe termination on quarantine: break waiting loop without releasing activeOwner lock
        break;
      }
      if (Date.now() - start > timeoutMs) {
        this.isClosed = true;
        this.isShuttingDown = false;
        throw new Error('[DB-SHUTDOWN-BLOCKED] Database shutdown timed out waiting for active operation to complete');
      }
      await new Promise(r => setImmediate(r));
    }
    this.isClosed = true;
    this.isShuttingDown = false;
  }

  reset() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('reset() is only permitted in test mode');
    }
    const waiters = this.waitQueue;
    this.waitQueue = [];
    for (const w of waiters) {
      try {
        w.reject(new Error('[DB-RESET] Database connection reset for testing'));
      } catch (_) {}
    }
    this.activeOwner = null;
    this.isQuarantined = false;
    this.quarantineError = null;
    this.isShuttingDown = false;
    this.isClosed = false;
  }
}

const sqliteQueue = new SqliteConnectionQueue();

function validateTransactionContext(store, sql) {
  if (!store) return;

  if (store.state !== 'active') {
    throw new Error(`[DB-CONTEXT] Transaction #${store.id} is not active (${store.state}); cannot execute: ${sql ? sql.trim().slice(0, 50) : 'query'}`);
  }

  if (store.mode === 'sqlite') {
    if (sqliteQueue.isQuarantined) {
      throw new Error(`[DB-QUARANTINE] Database connection is quarantined: ${sqliteQueue.quarantineError}`);
    }
    if (!sqliteQueue.activeOwner || sqliteQueue.activeOwner.id !== store.id) {
      throw new Error(`[DB-CONTEXT] Stale transaction context: #${store.id} does not hold active connection ownership`);
    }
  }

  if (store.mode === 'turso') {
    if (!store.tx || store.tx.closed) {
      throw new Error(`[DB-CONTEXT] Turso transaction stream for #${store.id} is closed`);
    }
  }
}

function normalizeParams(params) {
  if (!params || params.length === 0) return [];
  let p = params;
  if (params.length === 1 && (Array.isArray(params[0]) || (typeof params[0] === 'object' && params[0] !== null))) {
    p = params[0];
  }
  if (Array.isArray(p)) {
    return p.map(v => (v === undefined ? null : v));
  }
  if (typeof p === 'object' && p !== null) {
    const sanitized = {};
    for (const [k, v] of Object.entries(p)) {
      sanitized[k] = v === undefined ? null : v;
    }
    return sanitized;
  }
  return p === undefined ? [null] : [p];
}

export function resolveEngineMode() {
  const isVercel = Boolean(process.env.VERCEL);
  const appRole = process.env.APP_ROLE;
  const dbEngine = process.env.DATABASE_ENGINE;

  // Conflict detection: Contradictory configuration must fail closed
  if (dbEngine === 'sqlite' && (isVercel || appRole === 'web')) {
    throw new Error('[CONFIG-CONFLICT] Contradictory configuration: DATABASE_ENGINE=sqlite cannot be combined with VERCEL or APP_ROLE=web');
  }
  if (dbEngine === 'turso' && appRole === 'desktop') {
    throw new Error('[CONFIG-CONFLICT] Contradictory configuration: DATABASE_ENGINE=turso cannot be combined with APP_ROLE=desktop');
  }

  // Explicit directives
  if (isVercel || appRole === 'web' || dbEngine === 'turso') {
    return 'turso';
  }

  if (appRole === 'desktop' || dbEngine === 'sqlite') {
    return 'sqlite';
  }

  // Standalone Local Node default: SQLite
  return 'sqlite';
}

function resolveLocalDbPath() {
  const engine = resolveEngineMode();
  if (engine === 'turso') {
    throw new Error('Local SQLite is disabled in web/serverless environment. All database operations must target Turso Cloud.');
  }
  if (process.env.NODE_ENV === 'test') {
    return ':memory:';
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

// Default Turso database URL and token fallbacks (defaults to empty string for offline local SQLite operation)
export const DEFAULT_TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || '';
export const DEFAULT_TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || '';

export function getTursoClient() {
  let tursoUrl = process.env.TURSO_DATABASE_URL;
  let tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (typeof tursoUrl === 'string') {
    tursoUrl = tursoUrl.trim().replace(/^["']|["']$/g, '');
    if (tursoUrl.startsWith('libsql://')) {
      tursoUrl = tursoUrl.replace('libsql://', 'https://');
    }
  }

  if (typeof tursoToken === 'string') {
    tursoToken = tursoToken.trim().replace(/^["']|["']$/g, '');
  }

  if (tursoUrl && tursoToken && tursoToken !== '<valid_token>') {
    if (!globalThis.__tursoClientSingleton && !globalThis.__tursoClient) {
      const client = createClient({ url: tursoUrl, authToken: tursoToken });
      globalThis.__tursoClientSingleton = client;
      globalThis.__tursoClient = client;
      if (typeof global !== 'undefined') {
        global.__tursoClient = client;
      }
    }
    tursoClient = globalThis.__tursoClient || globalThis.__tursoClientSingleton;
    return tursoClient;
  }
  return null;
}

let dbGeneration = 0;

export function getDbGeneration() {
  return dbGeneration;
}

export async function initDb(customDbPath) {
  const engine = resolveEngineMode();
  let tursoUrl = process.env.TURSO_DATABASE_URL;
  let tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (typeof tursoUrl === 'string') {
    tursoUrl = tursoUrl.trim().replace(/^["']|["']$/g, '');
    if (tursoUrl.startsWith('libsql://')) {
      tursoUrl = tursoUrl.replace('libsql://', 'https://');
    }
  }

  if (typeof tursoToken === 'string') {
    tursoToken = tursoToken.trim().replace(/^["']|["']$/g, '');
  }

  if (engine === 'turso') {
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
    dbGeneration++;
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
    dbGeneration++;
    console.log(`✅ [DualEngine] Connected to local SQLite database with WAL enabled: ${targetDbPath}`);
  }

  return db;
}

export async function getDb() {
  if (sqliteQueue.isQuarantined) {
    throw new Error(`[DB-QUARANTINE] Database connection is quarantined: ${sqliteQueue.quarantineError}`);
  }
  if (sqliteQueue.isClosed || sqliteQueue.isShuttingDown) {
    throw new Error('[DB-CLOSED] Database connection is closing or closed');
  }
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

export function isTurso() {
  if (isTursoActive) return true;
  return resolveEngineMode() === 'turso';
}

export async function all(sql, ...params) {
  const store = txnStorage.getStore();
  if (store) {
    validateTransactionContext(store, sql);
    store.inFlightCount = (store.inFlightCount || 0) + 1;
    try {
      await getDb();
      const normalized = normalizeParams(params);
      if (store.mode === 'turso') {
        const res = await store.tx.execute({ sql, args: normalized });
        return res.rows || [];
      }
      if (store.mode === 'sqlite') {
        if (params.length === 1 && Array.isArray(params[0])) {
          return await localSqliteDb.all(sql, params[0]);
        }
        return await localSqliteDb.all(sql, ...params);
      }
    } catch (opErr) {
      store.hasFailedOperation = true;
      if (!store.lastOperationError) {
        store.lastOperationError = opErr;
      }
      throw opErr;
    } finally {
      store.inFlightCount--;
    }
  }

  await getDb();
  const normalized = normalizeParams(params);

  if (isTurso()) {
    const client = tursoClient || getTursoClient();
    if (!client) throw new Error('Turso client is not initialized in web mode.');
    const executor = activeTursoTxn || client;
    const res = await executor.execute({ sql, args: normalized });
    return res.rows || [];
  }

  if (localSqliteDb) {
    const opId = `op_${++opCounter}`;
    await sqliteQueue.acquire(opId, false);
    try {
      if (params.length === 1 && Array.isArray(params[0])) {
        return await localSqliteDb.all(sql, params[0]);
      }
      return await localSqliteDb.all(sql, ...params);
    } finally {
      sqliteQueue.release(opId);
    }
  }

  throw new Error('Database is not initialized');
}

export async function get(sql, ...params) {
  const store = txnStorage.getStore();
  if (store) {
    validateTransactionContext(store, sql);
    store.inFlightCount = (store.inFlightCount || 0) + 1;
    try {
      await getDb();
      const normalized = normalizeParams(params);
      if (store.mode === 'turso') {
        const res = await store.tx.execute({ sql, args: normalized });
        if (res.rows && res.rows.length > 0) {
          return res.rows[0];
        }
        return undefined;
      }
      if (store.mode === 'sqlite') {
        if (params.length === 1 && Array.isArray(params[0])) {
          return await localSqliteDb.get(sql, params[0]);
        }
        return await localSqliteDb.get(sql, ...params);
      }
    } catch (opErr) {
      store.hasFailedOperation = true;
      if (!store.lastOperationError) {
        store.lastOperationError = opErr;
      }
      throw opErr;
    } finally {
      store.inFlightCount--;
    }
  }

  await getDb();
  const normalized = normalizeParams(params);

  if (isTurso()) {
    const client = tursoClient || getTursoClient();
    if (!client) throw new Error('Turso client is not initialized in web mode.');
    const executor = activeTursoTxn || client;
    const res = await executor.execute({ sql, args: normalized });
    if (res.rows && res.rows.length > 0) {
      return res.rows[0];
    }
    return undefined;
  }

  if (localSqliteDb) {
    const opId = `op_${++opCounter}`;
    await sqliteQueue.acquire(opId, false);
    try {
      if (params.length === 1 && Array.isArray(params[0])) {
        return await localSqliteDb.get(sql, params[0]);
      }
      return await localSqliteDb.get(sql, ...params);
    } finally {
      sqliteQueue.release(opId);
    }
  }

  throw new Error('Database is not initialized');
}

export async function run(sql, ...params) {
  const trimmed = sql.trim().toUpperCase();
  const store = txnStorage.getStore();

  // If inside a managed transaction:
  if (store) {
    validateTransactionContext(store, sql);

    if (trimmed === 'BEGIN' || trimmed === 'BEGIN TRANSACTION') {
      throw new Error('Cannot execute BEGIN inside an active managed transaction');
    }
    if (trimmed === 'COMMIT' || trimmed === 'COMMIT TRANSACTION' || trimmed === 'END TRANSACTION' || trimmed === 'END') {
      throw new Error('Cannot execute COMMIT inside an active managed transaction; return from the transaction callback to commit');
    }
    if (trimmed === 'ROLLBACK' || trimmed === 'ROLLBACK TRANSACTION') {
      throw new Error('Cannot execute ROLLBACK inside an active managed transaction; throw an error from the transaction callback to rollback');
    }

    store.inFlightCount = (store.inFlightCount || 0) + 1;
    try {
      await getDb();
      if (store.mode === 'turso') {
        if (trimmed.startsWith('PRAGMA WAL_CHECKPOINT') || trimmed.startsWith('PRAGMA JOURNAL_MODE') || trimmed.startsWith('PRAGMA BUSY_TIMEOUT') || trimmed.startsWith('PRAGMA SYNCHRONOUS')) {
          return { changes: 0, rowsAffected: 0 };
        }
        const normalized = normalizeParams(params);
        const res = await store.tx.execute({ sql, args: normalized });
        return {
          changes: Number(res?.rowsAffected || 0),
          rowsAffected: Number(res?.rowsAffected || 0),
          lastID: res?.lastInsertRowid !== undefined ? Number(res.lastInsertRowid) : undefined,
          lastInsertRowid: res?.lastInsertRowid
        };
      }

      if (store.mode === 'sqlite') {
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
    } catch (opErr) {
      store.hasFailedOperation = true;
      if (!store.lastOperationError) {
        store.lastOperationError = opErr;
      }
      throw opErr;
    } finally {
      store.inFlightCount--;
    }
  }

  // Not in a managed transaction:
  await getDb();

  if (isTurso()) {
    const client = tursoClient || getTursoClient();
    if (!client) throw new Error('Turso client is not initialized in web mode.');

    // Intercept legacy raw transactions transparently for Turso Cloud over HTTP
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
    const opId = `op_${++opCounter}`;
    await sqliteQueue.acquire(opId, false);
    try {
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
    } finally {
      sqliteQueue.release(opId);
    }
  }

  throw new Error('Database is not initialized');
}

export async function exec(sql) {
  const trimmed = sql.trim().toUpperCase();
  const store = txnStorage.getStore();

  if (store) {
    validateTransactionContext(store, sql);
    store.inFlightCount = (store.inFlightCount || 0) + 1;
    try {
      await getDb();
      if (store.mode === 'turso') {
        if (trimmed.startsWith('PRAGMA WAL_CHECKPOINT') || trimmed.startsWith('PRAGMA JOURNAL_MODE') || trimmed.startsWith('PRAGMA BUSY_TIMEOUT') || trimmed.startsWith('PRAGMA SYNCHRONOUS')) {
          return;
        }
        await store.tx.executeMultiple(sql);
        return;
      }
      if (store.mode === 'sqlite') {
        await localSqliteDb.exec(sql);
        return;
      }
    } catch (opErr) {
      store.hasFailedOperation = true;
      if (!store.lastOperationError) {
        store.lastOperationError = opErr;
      }
      throw opErr;
    } finally {
      store.inFlightCount--;
    }
  }

  await getDb();

  if (isTurso()) {
    const client = tursoClient || getTursoClient();
    if (!client) throw new Error('Turso client is not initialized in web mode.');
    if (trimmed.startsWith('PRAGMA WAL_CHECKPOINT') || trimmed.startsWith('PRAGMA JOURNAL_MODE') || trimmed.startsWith('PRAGMA BUSY_TIMEOUT') || trimmed.startsWith('PRAGMA SYNCHRONOUS')) {
      return;
    }
    await client.executeMultiple(sql);
    return;
  }

  if (localSqliteDb) {
    const opId = `op_${++opCounter}`;
    await sqliteQueue.acquire(opId, false);
    try {
      await localSqliteDb.exec(sql);
      return;
    } finally {
      sqliteQueue.release(opId);
    }
  }

  throw new Error('Database is not initialized');
}

export async function transaction(callback) {
  await getDb();

  const parentStore = txnStorage.getStore();
  if (parentStore) {
    throw new Error('Nested transactions are not supported');
  }

  if (isTurso()) {
    const client = tursoClient || getTursoClient();
    if (!client) throw new Error('Turso client is not initialized in web mode.');

    const tx = await client.transaction('write');
    const txnId = `turso_tx_${++txnCounter}`;
    let committed = false;
    let rolledBack = false;

    const store = {
      isTxn: true,
      mode: 'turso',
      id: txnId,
      state: 'active',
      inFlightCount: 0,
      hasFailedOperation: false,
      lastOperationError: null,
      tx
    };

    return await txnStorage.run(store, async () => {
      try {
        const result = await callback();
        store.state = 'finalizing';
        while (store.inFlightCount > 0) {
          await new Promise(r => setImmediate(r));
        }
        if (store.hasFailedOperation) {
          throw store.lastOperationError || new Error(`[DB-TXN-FAILED] One or more unawaited operations failed inside transaction #${txnId}`);
        }
        try {
          await tx.commit();
          committed = true;
        } catch (commitErr) {
          try {
            await tx.rollback();
          } catch (_) {}
          throw new Error(`Turso transaction commit failed: ${commitErr.message}`);
        }
        return result;
      } catch (err) {
        store.state = 'finalizing';
        if (!committed && !rolledBack) {
          while (store.inFlightCount > 0) {
            await new Promise(r => setImmediate(r));
          }
          try {
            await tx.rollback();
            rolledBack = true;
          } catch (rbErr) {
            console.error(`[DB] Turso transaction rollback error: ${rbErr.message}`);
          }
        }
        throw err;
      } finally {
        store.state = 'closed';
        try {
          tx.close();
        } catch (_) {}
      }
    });
  }

  if (localSqliteDb) {
    if (sqliteQueue.isQuarantined) {
      throw new Error(`[DB-QUARANTINE] Database connection is quarantined: ${sqliteQueue.quarantineError}`);
    }
    const txnId = `tx_${++txnCounter}`;
    await sqliteQueue.acquire(txnId, true);
    let committed = false;
    let rolledBack = false;
    let commitError = null;

    const store = {
      isTxn: true,
      mode: 'sqlite',
      id: txnId,
      state: 'active',
      inFlightCount: 0,
      hasFailedOperation: false,
      lastOperationError: null
    };

    return await txnStorage.run(store, async () => {
      try {
        await localSqliteDb.run('BEGIN TRANSACTION');
        const result = await callback();
        store.state = 'finalizing';
        while (store.inFlightCount > 0) {
          await new Promise(r => setImmediate(r));
        }
        if (store.hasFailedOperation) {
          throw store.lastOperationError || new Error(`[DB-TXN-FAILED] One or more unawaited operations failed inside transaction #${txnId}`);
        }
        try {
          await localSqliteDb.run('COMMIT');
          committed = true;
        } catch (cErr) {
          commitError = cErr;
          throw cErr;
        }
        return result;
      } catch (err) {
        store.state = 'finalizing';
        if (!committed && !rolledBack) {
          while (store.inFlightCount > 0) {
            await new Promise(r => setImmediate(r));
          }
          try {
            await localSqliteDb.run('ROLLBACK');
            rolledBack = true;
          } catch (rbErr) {
            const qMsg = `Rollback failed (${rbErr.message}) after error: ${err.message}${commitError ? ' [Commit error: ' + commitError.message + ']' : ''}`;
            sqliteQueue.quarantine(qMsg);
            const fatalError = new Error(`[DB-QUARANTINE] Database connection quarantined: ${qMsg}`);
            fatalError.originalError = err;
            fatalError.rollbackError = rbErr;
            if (commitError) fatalError.commitError = commitError;
            throw fatalError;
          }
        }
        throw err;
      } finally {
        store.state = 'closed';
        if (!sqliteQueue.isQuarantined) {
          sqliteQueue.release(txnId);
        }
      }
    });
  }

  throw new Error('Database is not initialized');
}

export async function close() {
  await sqliteQueue.shutdown();

  if (activeTursoTxn) {
    try {
      await activeTursoTxn.rollback();
    } catch {}
    activeTursoTxn = null;
  }

  if (tursoClient) {
    if (typeof tursoClient.close === 'function') {
      tursoClient.close();
    }
    tursoClient = null;
  }

  if (localSqliteDb) {
    if (!sqliteQueue.isQuarantined) {
      await localSqliteDb.close();
      localSqliteDb = null;
    }
  }

  isTursoActive = false;
  dbGeneration++;
}

export function prepare(sql) {
  return {
    get: (...params) => get(sql, ...params),
    all: (...params) => all(sql, ...params),
    run: (...params) => run(sql, ...params)
  };
}

export function __setLocalSqliteDbForTesting(dbInstance) {
  localSqliteDb = dbInstance;
  isTursoActive = false;
  dbGeneration++;
}

export function __setTursoClientForTesting(clientInstance) {
  tursoClient = clientInstance;
  isTursoActive = true;
  dbGeneration++;
}

export function isInTransaction() {
  const store = txnStorage.getStore();
  return Boolean(store && store.isTxn && store.state === 'active');
}

export function __resetForTesting() {
  localSqliteDb = null;
  tursoClient = null;
  activeTursoTxn = null;
  isTursoActive = false;
  sqliteQueue.reset();
  dbGeneration++;
}

export const db = {
  isTurso,
  resolveEngineMode,
  isInTransaction,
  getDbGeneration,
  all,
  get,
  run,
  exec,
  transaction,
  prepare,
  close,
  getUnderlyingClient: () => (isTursoActive ? tursoClient : localSqliteDb)
};

export default db;
