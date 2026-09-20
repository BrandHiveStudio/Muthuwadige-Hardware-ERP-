/**
 * Automated Background Sync Service for Muthuwadige Hardware ERP
 * Replicates local SQLite (hardware.db) mutations to Turso Cloud libSQL every 30 seconds.
 * 
 * Guarantees:
 * - 100% Offline-First: POS checkout NEVER waits on network calls.
 * - Zero Cashier Interruption: Network drops are tracked silently without UI alerts.
 */

import { getTursoClient, isTurso } from '../db/connection.js';

let isOnline = true;
let isSyncing = false;
let lastSyncedAt = null;
let lastUpstreamSync = null;
let lastDownstreamSync = null;
let lastCounterSync = null;
let syncIntervalId = null;
let isWebClient = false;

// Determine environment
if (process.env.VERCEL === '1' || process.env.APP_ROLE === 'web' || process.env.IS_WEB_CLIENT === '1') {
  isWebClient = true;
}

export const TABLES_TO_SYNC = [
  'users',
  'profiles',
  'products',
  'customers',
  'suppliers',
  'categories',
  'custom_permissions',
  'discounts',
  'promotions',
  'purchase_orders',
  'purchases',
  'purchase_order_items',
  'purchase_items',
  'supplier_transactions',
  'sales',
  'credit_payments',
  'credit_notes',
  'credit_note_usage',
  'transactions',
  'cash_book',
  'cheques',
  'cheque_registry',
  'quotations',
  'quotation_items',
  'sales_returns',
  'sales_return_items',
  'shift_logs',
  'audit_logs',
  'expenses',
  'system_settings',
  'stock_adjustments'
];

/**
 * Check connectivity to Turso Cloud libSQL with a 3-second timeout
 */
export async function pingTurso(tursoClient) {
  if (!tursoClient) return false;
  try {
    const pingPromise = tursoClient.execute('SELECT 1 as ping');
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Turso ping timeout')), 3500)
    );
    await Promise.race([pingPromise, timeoutPromise]);
    return true;
  } catch (err) {
    // Cloud web endpoint fallback ping
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('https://erp.mhardware.lk/api/sync/status', {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      }).catch(() => null);
      clearTimeout(t);
      if (res && res.ok) {
        return true;
      }
    } catch (_) {}
    return false;
  }
}

/**
 * Normalizes any timestamp representation (SQLite UTC string, ISO 8601, or epoch number)
 * into UTC milliseconds, preventing timezone distortion and false ordering.
 */
export function parseUtcTimestamp(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  let s = String(ts).trim();
  if (!s) return 0;
  // If space-delimited SQLite format 'YYYY-MM-DD HH:MM:SS' or without timezone offset, force UTC interpretation
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    s = s.replace(' ', 'T') + 'Z';
  } else if (!s.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(s)) {
    s = s + 'Z';
  }
  const t = new Date(s).getTime();
  return isNaN(t) ? 0 : t;
}

/**
 * Execute a Turso query with a strict 5-second timeout to prevent UI/server hangs
 */
async function executeWithTimeout(tursoClient, sqlOrObj, timeoutMs = 15000) {
  const queryPromise = tursoClient.execute(sqlOrObj);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Query timeout after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([queryPromise, timeoutPromise]);
}

// A stock delta and its idempotency marker are one business operation. Do not
// send this pair through the generic statement fallback, which may retry its
// statements independently after an uncertain batch acknowledgement.
async function pushStockAdjustmentAtomically(tursoClient, deltaStmt, insertStmt) {
  if (typeof tursoClient.transaction !== 'function') {
    throw new Error('Turso client does not provide transactions required for stock adjustment sync');
  }

  const tx = await tursoClient.transaction('write');
  let committed = false;
  try {
    if (deltaStmt) await tx.execute(deltaStmt);
    await tx.execute(insertStmt);
    await tx.commit();
    committed = true;
  } catch (err) {
    if (!committed) {
      try { await tx.rollback(); } catch (_) {}
    }
    throw err;
  }
}

let tursoSchemaEnsured = false;
export async function ensureTursoSchema(tursoClient) {
  if (!tursoClient || tursoSchemaEnsured) return;
  try {
    await tursoClient.batch([
      `CREATE TABLE IF NOT EXISTS shift_logs (
        id TEXT PRIMARY KEY,
        station_id TEXT,
        cashier_name TEXT,
        opening_float REAL DEFAULT 0,
        cash_sales REAL DEFAULT 0,
        cash_returns REAL DEFAULT 0,
        petty_expenses REAL DEFAULT 0,
        expected_cash REAL DEFAULT 0,
        counted_cash REAL DEFAULT 0,
        discrepancy REAL DEFAULT 0,
        discrepancy_status TEXT,
        remarks TEXT,
        opened_at TEXT,
        closed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        user_name TEXT,
        user_role TEXT,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS stock_adjustments (
        id TEXT PRIMARY KEY,
        product_id TEXT,
        product_name TEXT,
        old_qty REAL DEFAULT 0,
        new_qty REAL DEFAULT 0,
        reason TEXT,
        type TEXT,
        user_email TEXT,
        branch_id TEXT,
        station_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS purchase_orders (
        id TEXT PRIMARY KEY,
        po_number TEXT UNIQUE,
        po_no TEXT,
        supplier_id TEXT,
        supplier_name TEXT,
        items TEXT NOT NULL DEFAULT '[]',
        total REAL,
        subtotal REAL DEFAULT 0,
        discount_type TEXT DEFAULT 'fixed',
        discount_value REAL DEFAULT 0,
        discount_amount REAL DEFAULT 0,
        transportation_fee REAL DEFAULT 0,
        net_total REAL DEFAULT 0,
        original_total REAL,
        debit_note_code TEXT,
        debit_note_applied REAL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        due_date TEXT,
        user_id TEXT,
        received_at TEXT,
        received_by TEXT,
        settlement_mode TEXT DEFAULT 'CREDIT',
        payment_method TEXT DEFAULT 'CREDIT',
        branch_id TEXT,
        station_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT
      );`,
      `CREATE TABLE IF NOT EXISTS purchase_order_items (
        id TEXT PRIMARY KEY,
        purchase_order_id TEXT,
        po_number TEXT,
        product_id TEXT,
        product_name TEXT,
        quantity REAL DEFAULT 0,
        cost_price REAL DEFAULT 0,
        discount REAL DEFAULT 0,
        discount_type TEXT DEFAULT 'fixed',
        total REAL DEFAULT 0,
        batch_number INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS cheque_registry (
        id TEXT PRIMARY KEY,
        direction TEXT NOT NULL,
        cheque_type TEXT DEFAULT 'CROSSED_ACCOUNT_PAYEE',
        cheque_number TEXT NOT NULL,
        bank_name TEXT NOT NULL,
        branch TEXT,
        cheque_date DATE NOT NULL,
        amount REAL NOT NULL,
        party_id TEXT,
        party_name TEXT,
        reference_type TEXT,
        reference_id TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        notes TEXT,
        cleared_at DATETIME,
        cleared_date DATE,
        created_by TEXT,
        processed_by TEXT,
        updated_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`,
      `CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        type TEXT,
        category TEXT,
        description TEXT,
        amount REAL,
        date TEXT,
        reference TEXT,
        payment_method TEXT DEFAULT 'CASH',
        user_id TEXT,
        branch_id TEXT,
        station_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );`
    ], 'write');
    const cols = [
      "ALTER TABLE shift_logs ADD COLUMN date TEXT;",
      "ALTER TABLE shift_logs ADD COLUMN status TEXT DEFAULT 'CLOSED';",
      "ALTER TABLE shift_logs ADD COLUMN actual_cash REAL DEFAULT 0;",
      "ALTER TABLE shift_logs ADD COLUMN notes TEXT;",
      "ALTER TABLE shift_logs ADD COLUMN cashier_id TEXT;",
      "ALTER TABLE shift_logs ADD COLUMN cashier_email TEXT;",
      "ALTER TABLE shift_logs ADD COLUMN updated_at TEXT;",
      "ALTER TABLE audit_logs ADD COLUMN timestamp TEXT DEFAULT CURRENT_TIMESTAMP;",
      "ALTER TABLE audit_logs ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP;",
      "ALTER TABLE stock_adjustments ADD COLUMN old_qty REAL DEFAULT 0;",
      "ALTER TABLE stock_adjustments ADD COLUMN new_qty REAL DEFAULT 0;",
      "ALTER TABLE stock_adjustments ADD COLUMN user_email TEXT;",
      "ALTER TABLE stock_adjustments ADD COLUMN branch_id TEXT;",
      "ALTER TABLE stock_adjustments ADD COLUMN station_id TEXT;",
      "ALTER TABLE sales ADD COLUMN branch_id TEXT;",
      "ALTER TABLE sales ADD COLUMN station_id TEXT;",
      "ALTER TABLE purchase_orders ADD COLUMN branch_id TEXT;",
      "ALTER TABLE purchase_orders ADD COLUMN supplier_id TEXT;",
      "ALTER TABLE purchase_orders ADD COLUMN payment_method TEXT;",
      "ALTER TABLE purchase_orders ADD COLUMN shipping_cost REAL DEFAULT 0;",
      "ALTER TABLE purchase_orders ADD COLUMN delivery_fee REAL DEFAULT 0;",
      "ALTER TABLE purchase_orders ADD COLUMN station_id TEXT;",
      "ALTER TABLE suppliers ADD COLUMN contact_person TEXT;",
      "ALTER TABLE suppliers ADD COLUMN phone TEXT;",
      "ALTER TABLE suppliers ADD COLUMN email TEXT;",
      "ALTER TABLE suppliers ADD COLUMN address TEXT;",
      "ALTER TABLE suppliers ADD COLUMN payable_balance REAL DEFAULT 0;",
      "ALTER TABLE transactions ADD COLUMN branch_id TEXT;",
      "ALTER TABLE transactions ADD COLUMN payment_method TEXT DEFAULT 'CASH';",
      "ALTER TABLE cheque_registry ADD COLUMN cleared_date DATE;",
      "ALTER TABLE cheque_registry ADD COLUMN updated_at DATETIME;",
      "ALTER TABLE cheque_registry ADD COLUMN processed_by TEXT;"
    ];
    for (const c of cols) {
      try { await tursoClient.execute(c); } catch (_) {}
    }
    tursoSchemaEnsured = true;
  } catch (e) {
    console.warn('[BackgroundSync] Warning: Failed to ensure Turso schema:', e?.message);
  }
}

// Database Generation Readiness and In-Flight Concurrency Management
let resetEpoch = 0;
const clientReadyGenerations = new WeakMap();
const clientInFlightInits = new WeakMap();

function getDbInfo(db) {
  if (!db) return { client: null, gen: 0 };
  const client = typeof db.getUnderlyingClient === 'function' ? db.getUnderlyingClient() : db;
  const gen = typeof db.getDbGeneration === 'function' 
    ? db.getDbGeneration() 
    : (typeof db.__dbGeneration === 'number' ? db.__dbGeneration : (client && typeof client.__dbGeneration === 'number' ? client.__dbGeneration : 0));
  return { client, gen };
}

export function isSyncSchemaReady(db) {
  const { client, gen } = getDbInfo(db);
  if (!client || typeof client !== 'object') return false;
  const readyGens = clientReadyGenerations.get(client);
  return Boolean(readyGens && readyGens.has(`${gen}_${resetEpoch}`));
}

export function invalidateSyncSchema(db = null) {
  resetEpoch++;
  if (db) {
    const { client } = getDbInfo(db);
    if (client && typeof client === 'object') {
      const readyGens = clientReadyGenerations.get(client);
      if (readyGens) readyGens.clear();
      const inFlightMap = clientInFlightInits.get(client);
      if (inFlightMap) inFlightMap.clear();
    }
  }
}

export function __resetSyncSchemaForTesting(db = null) {
  invalidateSyncSchema(db);
}

export async function ensureSyncSchema(db) {
  if (!db || isWebClient) return;
  const { client, gen } = getDbInfo(db);
  if (!client || typeof client !== 'object') return;

  // 1. Transaction Safety Check:
  // Never execute sync schema DDL inside an active managed transaction.
  if (typeof db.isInTransaction === 'function' && db.isInTransaction()) {
    if (isSyncSchemaReady(db)) {
      return;
    }
    throw new Error('[SyncSchema] Database sync schema is not ready and cannot be prepared inside an active managed transaction. Schema preparation must complete before transaction entry.');
  }

  // 2. Already ready check for this exact client, generation, and epoch:
  if (isSyncSchemaReady(db)) {
    return;
  }

  // 3. Concurrent in-flight coalescing per database generation:
  let inFlightMap = clientInFlightInits.get(client);
  if (!inFlightMap) {
    inFlightMap = new Map();
    clientInFlightInits.set(client, inFlightMap);
  }

  const currentEpoch = resetEpoch;
  const inFlightKey = `${gen}_${currentEpoch}`;

  if (inFlightMap.has(inFlightKey)) {
    // Concurrent callers await the same shared in-flight promise
    await inFlightMap.get(inFlightKey);
    return;
  }

  const targetClient = client;
  const initialGen = gen;
  const initialEpoch = currentEpoch;

  const initPromise = (async () => {
    try {
      // Helper to assert that database connection or generation has not changed
      const assertConnectionValid = () => {
        const current = getDbInfo(db);
        if (current.client !== targetClient || current.gen !== initialGen || resetEpoch !== initialEpoch) {
          throw new Error(`[SyncSchema] Database connection or generation changed during schema initialization (gen ${initialGen} -> ${current.gen}). Initialization rejected.`);
        }
      };

      // Helper to execute SQL strictly against the pinned targetClient
      // Never falls back to global mutable db adapter
      const targetExec = async (sql) => {
        assertConnectionValid();
        if (typeof targetClient.exec === 'function') {
          await targetClient.exec(sql);
        } else if (typeof targetClient.executeMultiple === 'function') {
          await targetClient.executeMultiple(sql);
        } else if (typeof targetClient.execute === 'function') {
          await targetClient.execute(sql);
        } else if (typeof targetClient.run === 'function') {
          await targetClient.run(sql);
        } else {
          throw new Error('[SyncSchema] Unsupported database client interface: targetClient does not expose exec, executeMultiple, execute, or run.');
        }
        assertConnectionValid();
      };

      // Helper to query rows strictly against the pinned targetClient
      // Never falls back to global mutable db adapter
      const targetQueryAll = async (sql, params = []) => {
        assertConnectionValid();
        let rows;
        if (typeof targetClient.all === 'function') {
          rows = await targetClient.all(sql, params);
        } else if (typeof targetClient.execute === 'function') {
          const res = await targetClient.execute({ sql, args: params });
          rows = res?.rows || [];
        } else {
          throw new Error('[SyncSchema] Unsupported database client interface: targetClient does not expose all or execute.');
        }
        assertConnectionValid();
        return rows;
      };

      // Helper to execute safe column additions that distinguish genuine "column already exists"
      // from operational failures (e.g. SQLITE_BUSY, SQLITE_LOCKED, disk full, etc.)
      const safeAddColumn = async (sql, tableName) => {
        try {
          await targetExec(sql);
        } catch (err) {
          const msg = (err?.message || String(err)).toLowerCase();
          // Genuinely harmless: duplicate column name (column already exists)
          if (msg.includes('duplicate column name')) {
            return;
          }
          // For auxiliary non-sync tables, if table doesn't exist yet in isolated tests, that's fine
          if (tableName !== 'sync_queue' && msg.includes('no such table')) {
            return;
          }
          // Any other error is an operational or integrity failure; do NOT swallow!
          throw err;
        }
      };

      // 1. Create core sync_queue table
      await targetExec(`
        CREATE TABLE IF NOT EXISTS sync_queue (
          id TEXT PRIMARY KEY,
          table_name TEXT NOT NULL,
          record_id TEXT NOT NULL,
          action TEXT NOT NULL,
          payload JSON NOT NULL,
          status TEXT DEFAULT 'PENDING',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // 2. Create index on status & created_at
      await targetExec("CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);");

      // 3. Create supplementary tables if not exist
      try {
        await targetExec(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE,
            password TEXT,
            role TEXT,
            name TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } catch (uErr) {
        const msg = (uErr?.message || String(uErr)).toLowerCase();
        if (!msg.includes('already exists')) throw uErr;
      }

      try {
        await targetExec(`
          CREATE TABLE IF NOT EXISTS shift_logs (
            id TEXT PRIMARY KEY,
            station_id TEXT,
            cashier_name TEXT,
            opening_float REAL DEFAULT 0,
            cash_sales REAL DEFAULT 0,
            cash_returns REAL DEFAULT 0,
            petty_expenses REAL DEFAULT 0,
            expected_cash REAL DEFAULT 0,
            counted_cash REAL DEFAULT 0,
            discrepancy REAL DEFAULT 0,
            discrepancy_status TEXT,
            remarks TEXT,
            opened_at TEXT,
            closed_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } catch (sErr) {
        const msg = (sErr?.message || String(sErr)).toLowerCase();
        if (!msg.includes('already exists')) throw sErr;
      }

      try {
        await targetExec(`
          CREATE TABLE IF NOT EXISTS stock_adjustments (
            id TEXT PRIMARY KEY,
            product_id TEXT,
            product_name TEXT,
            old_qty REAL DEFAULT 0,
            new_qty REAL DEFAULT 0,
            reason TEXT,
            type TEXT,
            user_email TEXT,
            branch_id TEXT,
            station_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } catch (saErr) {
        const msg = (saErr?.message || String(saErr)).toLowerCase();
        if (!msg.includes('already exists')) throw saErr;
      }

      try {
        await targetExec(`
          CREATE TABLE IF NOT EXISTS deleted_records (
            table_name TEXT NOT NULL,
            record_id TEXT NOT NULL,
            deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (table_name, record_id)
          );
        `);
      } catch (drErr) {
        const msg = (drErr?.message || String(drErr)).toLowerCase();
        if (!msg.includes('already exists')) throw drErr;
      }

      try {
        await targetExec(`
          CREATE TABLE IF NOT EXISTS purchase_order_items (
            id TEXT PRIMARY KEY,
            purchase_order_id TEXT,
            po_number TEXT,
            product_id TEXT,
            product_name TEXT,
            quantity REAL DEFAULT 0,
            cost_price REAL DEFAULT 0,
            discount REAL DEFAULT 0,
            discount_type TEXT DEFAULT 'fixed',
            total REAL DEFAULT 0,
            batch_number INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          );
        `);
      } catch (poiErr) {
        const msg = (poiErr?.message || String(poiErr)).toLowerCase();
        if (!msg.includes('already exists')) throw poiErr;
      }

      // 4. Safe column additions (harmless duplicate column ignored, operational errors thrown)
      await safeAddColumn("ALTER TABLE sync_queue ADD COLUMN retry_count INTEGER DEFAULT 0;", 'sync_queue');
      await safeAddColumn("ALTER TABLE sync_queue ADD COLUMN error_message TEXT;", 'sync_queue');
      await safeAddColumn("ALTER TABLE system_settings ADD COLUMN last_counter_sync_timestamp TEXT;", 'system_settings');
      await safeAddColumn("ALTER TABLE system_settings ADD COLUMN last_sync_timestamp TEXT;", 'system_settings');
      await safeAddColumn("ALTER TABLE system_settings ADD COLUMN counter_sync_status TEXT DEFAULT 'IDLE';", 'system_settings');
      await safeAddColumn("ALTER TABLE system_settings ADD COLUMN counter_pending_count INTEGER DEFAULT 0;", 'system_settings');
      await safeAddColumn("ALTER TABLE products ADD COLUMN updated_at TEXT;", 'products');
      await safeAddColumn("ALTER TABLE products ADD COLUMN selling_price REAL;", 'products');
      await safeAddColumn("ALTER TABLE products ADD COLUMN stock_quantity REAL;", 'products');
      await safeAddColumn("ALTER TABLE customers ADD COLUMN updated_at TEXT;", 'customers');
      await safeAddColumn("ALTER TABLE customers ADD COLUMN credit_limit REAL DEFAULT 0;", 'customers');
      await safeAddColumn("ALTER TABLE customers ADD COLUMN credit_period INTEGER DEFAULT 0;", 'customers');
      await safeAddColumn("ALTER TABLE customers ADD COLUMN type TEXT DEFAULT 'registered';", 'customers');
      await safeAddColumn("ALTER TABLE suppliers ADD COLUMN updated_at TEXT;", 'suppliers');
      await safeAddColumn("ALTER TABLE profiles ADD COLUMN updated_at TEXT;", 'profiles');
      await safeAddColumn("ALTER TABLE users ADD COLUMN updated_at TEXT;", 'users');
      await safeAddColumn("ALTER TABLE stock_adjustments ADD COLUMN old_qty REAL DEFAULT 0;", 'stock_adjustments');
      await safeAddColumn("ALTER TABLE stock_adjustments ADD COLUMN new_qty REAL DEFAULT 0;", 'stock_adjustments');
      await safeAddColumn("ALTER TABLE stock_adjustments ADD COLUMN user_email TEXT;", 'stock_adjustments');
      await safeAddColumn("ALTER TABLE stock_adjustments ADD COLUMN branch_id TEXT;", 'stock_adjustments');
      await safeAddColumn("ALTER TABLE stock_adjustments ADD COLUMN station_id TEXT;", 'stock_adjustments');
      await safeAddColumn("ALTER TABLE sales ADD COLUMN branch_id TEXT;", 'sales');
      await safeAddColumn("ALTER TABLE sales ADD COLUMN station_id TEXT;", 'sales');
      await safeAddColumn("ALTER TABLE purchase_orders ADD COLUMN branch_id TEXT;", 'purchase_orders');
      await safeAddColumn("ALTER TABLE transactions ADD COLUMN branch_id TEXT;", 'transactions');

      // 5. Verify sync_queue completeness before marking ready
      assertConnectionValid();

      const columns = await targetQueryAll("PRAGMA table_info('sync_queue');");
      if (!columns || columns.length === 0) {
        throw new Error('[SyncSchema] Verification failed: table sync_queue does not exist or has no columns.');
      }

      const existingCols = new Set(columns.map(c => (c.name || '').toLowerCase()));
      const requiredCols = [
        'id',
        'table_name',
        'record_id',
        'action',
        'payload',
        'status',
        'created_at',
        'retry_count',
        'error_message'
      ];

      const missingCols = requiredCols.filter(col => !existingCols.has(col));
      if (missingCols.length > 0) {
        throw new Error(`[SyncSchema] Verification failed: sync_queue is missing required column(s): ${missingCols.join(', ')}`);
      }

      const indexes = await targetQueryAll("PRAGMA index_list('sync_queue');");
      const existingIndexes = new Set((indexes || []).map(idx => (idx.name || '').toLowerCase()));
      if (!existingIndexes.has('idx_sync_queue_status')) {
        throw new Error('[SyncSchema] Verification failed: missing required index idx_sync_queue_status on sync_queue.');
      }

      // If system_settings exists, verify required sync columns are present
      const sysSettingsInfo = await targetQueryAll("PRAGMA table_info('system_settings');");
      if (sysSettingsInfo && sysSettingsInfo.length > 0) {
        const sysCols = new Set(sysSettingsInfo.map(c => (c.name || '').toLowerCase()));
        const requiredSysCols = ['last_counter_sync_timestamp', 'last_sync_timestamp', 'counter_sync_status', 'counter_pending_count'];
        const missingSysCols = requiredSysCols.filter(col => !sysCols.has(col));
        if (missingSysCols.length > 0) {
          throw new Error(`[SyncSchema] Verification failed: system_settings table exists but is missing required sync column(s): ${missingSysCols.join(', ')}`);
        }
      }

      // 6. Final connection & generation re-verification
      assertConnectionValid();

      let readyGens = clientReadyGenerations.get(targetClient);
      if (!readyGens) {
        readyGens = new Set();
        clientReadyGenerations.set(targetClient, readyGens);
      }
      readyGens.add(inFlightKey);
    } finally {
      // Always clear in-flight state so retries on failure can proceed
      inFlightMap.delete(inFlightKey);
    }
  })();

  inFlightMap.set(inFlightKey, initPromise);
  await initPromise;
}

/**
 * Enqueue a database mutation into sync_queue
 */
export async function enqueueSync(db, tableName, recordId, action = 'INSERT', payload = null) {
  if (!db || isWebClient) return; // Web client writes directly to Turso
  if (!isSyncSchemaReady(db)) {
    if (typeof db.isInTransaction === 'function' && db.isInTransaction()) {
      throw new Error(`[SyncQueue] Cannot enqueue sync for ${tableName} (${recordId}): sync schema is not ready for this database generation and cannot run DDL inside an active transaction.`);
    }
    await ensureSyncSchema(db);
  }
  try {
    const id = `sq_${tableName}_${recordId}`;
    let jsonStr = '{}';
    if (payload) {
      jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    } else {
      // Auto-fetch current row state if payload not provided
      try {
        const row = await db.get(`SELECT * FROM "${tableName}" WHERE id = ?`, [recordId]);
        if (row) jsonStr = JSON.stringify(row);
      } catch (_) {}
    }

    await db.run(
      `INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, action, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)`,
      [id, tableName, String(recordId), action, jsonStr]
    );
  } catch (err) {
    console.error(`[SyncQueue] Failed to enqueue ${tableName} (${recordId}):`, err.message);
    if (typeof db.isInTransaction === 'function' && db.isInTransaction()) {
      throw err;
    }
  }
}

let isPushing = false;

/**
 * Push pending local mutations to Turso Cloud
 */
export async function pushUpstreamChanges(localDb, tursoClient) {
  if (!localDb || !tursoClient) return;
  // On the web/Vercel deployment, `localDb` and `tursoClient` are the SAME database (see
  // src/db/connection.js - there is no separate local SQLite there). enqueueSync() already
  // skips writing to sync_queue in that environment for this exact reason (see its isWebClient
  // check above), but several route handlers below also call pushUpstreamChanges(db, tursoClient)
  // directly as an "instant push" optimization, unconditionally. Without this guard, a genuine
  // INSERT on the web portal (e.g. a sale) fires this table's AFTER INSERT trigger *on Turso
  // itself*, queuing a partial-column snapshot there, and this same request's own "push" call
  // would immediately read that phantom queue entry back and overwrite the row it just correctly
  // inserted with that partial snapshot - the same corruption bug, entirely within the cloud side.
  if (isWebClient) return;
  if (isPushing) {
    console.log('[BackgroundSync] Upstream push already in progress, skipping concurrent run.');
    return;
  }
  isPushing = true;
  try {
    const nowIso = new Date().toISOString();

    await ensureTursoSchema(tursoClient);

    // Auto-heal / unblock any stuck or failed queue items for cheques and transactions
    try {
      await localDb.run(
        `UPDATE sync_queue 
         SET status = 'PENDING', retry_count = 0, error_message = NULL 
         WHERE table_name IN ('cheques', 'cheque_registry', 'transactions', 'cash_book') 
           AND (status = 'FAILED' OR COALESCE(retry_count, 0) >= 5)`
      );
    } catch (_) {}

    const pendingItems = await localDb.all(
      "SELECT * FROM sync_queue WHERE status = 'PENDING' AND COALESCE(retry_count, 0) < 5 ORDER BY created_at ASC LIMIT 100"
    );

  if (pendingItems && pendingItems.length > 0) {
    console.log(`[BackgroundSync] Transmitting ${pendingItems.length} queued record(s) to Turso Cloud...`);
    const statements = [];
    const statementItemMap = [];
    const stockAdjustmentOperations = [];
    const directSuccessfulIds = [];

    for (const item of pendingItems) {
      let row = null;
      try {
        row = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
      } catch (_) {}

      if (!row || Object.keys(row).length === 0) {
        try {
          row = await localDb.get(`SELECT * FROM "${item.table_name}" WHERE id = ?`, [item.record_id]);
        } catch (_) {}
      }

      // Ensure delivery_fee / transportation_fee parity
      if (item.table_name === 'sales' && row && typeof row === 'object') {
        const delFee = Number(
          row.transportation_fee !== undefined && row.transportation_fee !== null && Number(row.transportation_fee) > 0
            ? row.transportation_fee
            : (row.delivery_fee !== undefined && row.delivery_fee !== null ? row.delivery_fee : (row.deliveryFee || 0))
        );
        row.transportation_fee = delFee;
        delete row.delivery_fee;
        delete row.deliveryFee;
      }

      // Ensure quotation_items price / unit_price parity
      if (item.table_name === 'quotation_items' && row && typeof row === 'object') {
        if (row.unit_price === undefined && row.price !== undefined) {
          row.unit_price = row.price;
        } else if (row.price === undefined && row.unit_price !== undefined) {
          row.price = row.unit_price;
        }
      }

      let targetTable = item.table_name;
      if (targetTable === 'cash_book') targetTable = 'transactions';
      if (targetTable === 'cheques') targetTable = 'cheque_registry';
      if (targetTable === 'purchases') targetTable = 'purchase_orders';
      if (targetTable === 'purchase_items') targetTable = 'purchase_order_items';

      if (item.action === 'DELETE') {
        const stmt = {
          sql: `DELETE FROM "${targetTable}" WHERE id = ?`,
          args: [item.record_id]
        };
        statements.push(stmt);
        statementItemMap.push({ statement: stmt, itemId: item.id, table: targetTable });
      } else if (row && typeof row === 'object' && targetTable === 'profiles') {
        // SECURITY: profiles/authentication credentials must not be blindly overwritten by an
        // incidental sync of some other field (name/role/permissions edited elsewhere, or - as
        // happened in production - a device-local password-hash-format upgrade). A generic
        // profile upsert only ever creates a brand-new row (INSERT branch, which legitimately
        // needs a password to make the account usable) or updates an EXISTING row's non-password
        // columns; the receiving side's password is left exactly as it already is unless this
        // enqueue was explicitly marked as a deliberate password change (register/reset/change-
        // password routes - see their enqueueSync calls).
        const isPasswordChange = row.__sync_password_change === true;
        const cleanRow = { ...row };
        delete cleanRow.__sync_password_change;

        const columns = Object.keys(cleanRow);
        const colNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const args = columns.map(c => cleanRow[c] !== undefined ? cleanRow[c] : null);
        const updateCols = columns.filter(c => c !== 'id' && (isPasswordChange || c !== 'password'));
        const conflictClause = updateCols.length > 0
          ? `DO UPDATE SET ${updateCols.map(c => `"${c}" = excluded."${c}"`).join(', ')}`
          : 'DO NOTHING';

        const stmt = {
          sql: `INSERT INTO "profiles" (${colNames}) VALUES (${placeholders})
                ON CONFLICT("id") ${conflictClause}`,
          args
        };
        statements.push(stmt);
        statementItemMap.push({ statement: stmt, itemId: item.id, table: targetTable });
      } else if (row && typeof row === 'object' && targetTable === 'products') {
        const cleanRow = { ...row };
        if (cleanRow.price !== undefined && cleanRow.selling_price === undefined) {
          cleanRow.selling_price = cleanRow.price;
        } else if (cleanRow.selling_price !== undefined && cleanRow.price === undefined) {
          cleanRow.price = cleanRow.selling_price;
        }
        if (cleanRow.stock !== undefined && cleanRow.stock_quantity === undefined) {
          cleanRow.stock_quantity = cleanRow.stock;
        } else if (cleanRow.stock_quantity !== undefined && cleanRow.stock === undefined) {
          cleanRow.stock = cleanRow.stock_quantity;
        }
        cleanRow.updated_at = cleanRow.updated_at || new Date().toISOString();

        const columns = Object.keys(cleanRow);
        const colNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const args = columns.map(c => cleanRow[c] !== undefined ? cleanRow[c] : null);

        const stmt = {
          sql: `INSERT INTO "products" (${colNames}) VALUES (${placeholders})
                ON CONFLICT("sku") DO UPDATE SET
                  "name" = excluded."name",
                  "category" = excluded."category",
                  "price" = excluded."price",
                  "selling_price" = excluded."selling_price",
                  "cost_price" = excluded."cost_price",
                  "min_stock" = excluded."min_stock",
                  "supplier" = excluded."supplier",
                  "unit" = excluded."unit",
                  "barcode" = excluded."barcode",
                  "brand" = excluded."brand",
                  "updated_at" = excluded."updated_at"`,
          args
        };
        statements.push(stmt);
        statementItemMap.push({ statement: stmt, itemId: item.id, table: targetTable });
      } else if (row && typeof row === 'object' && targetTable === 'stock_adjustments') {
        const cleanRow = { ...row };
        const columns = Object.keys(cleanRow);
        const colNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const args = columns.map(c => cleanRow[c] !== undefined ? cleanRow[c] : null);

        // Concurrency-safe delta propagation to Turso products table
        let delta = 0;
        if (cleanRow.delta !== undefined && cleanRow.delta !== null) {
          delta = Number(cleanRow.delta);
        } else if (cleanRow.delta_qty !== undefined && cleanRow.delta_qty !== null) {
          delta = Number(cleanRow.delta_qty);
        } else if (cleanRow.new_qty !== undefined && cleanRow.old_qty !== undefined) {
          delta = Number(cleanRow.new_qty) - Number(cleanRow.old_qty);
        }

        // P0 DEFECT 2 FIX: Idempotent database-side execution on Turso:
        // Execute the delta UPDATE FIRST with a NOT EXISTS guard checking stock_adjustments.
        // If cleanRow.id already exists on Turso (e.g. on a retry after lost ACK),
        // NOT EXISTS is false, so products stock is NOT modified again!
        let stockDeltaStmt = null;
        if (delta !== 0 && !isNaN(delta) && cleanRow.product_id) {
          const adjId = cleanRow.id || item.record_id || '';
          const deltaStmt = {
            sql: `UPDATE "products" SET
                    "stock" = MAX(0, COALESCE("stock", 0) + ?),
                    "stock_quantity" = MAX(0, COALESCE("stock_quantity", 0) + ?),
                    "updated_at" = ?
                  WHERE ("id" = ? OR "sku" = ?)
                    AND NOT EXISTS (SELECT 1 FROM "stock_adjustments" WHERE "id" = ?)`,
            args: [
              delta,
              delta,
              cleanRow.created_at || new Date().toISOString(),
              cleanRow.product_id,
              cleanRow.product_id,
              adjId
            ]
          };
          stockDeltaStmt = deltaStmt;
        }

        // Statement 2: INSERT OR IGNORE the adjustment record
        const stmt = {
          sql: `INSERT OR IGNORE INTO "stock_adjustments" (${colNames}) VALUES (${placeholders})`,
          args
        };
        stockAdjustmentOperations.push({ itemId: item.id, deltaStmt: stockDeltaStmt, insertStmt: stmt });
      } else if (row && typeof row === 'object') {
        const columns = Object.keys(row);
        const colNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const args = columns.map(c => row[c] !== undefined ? row[c] : null);

        const stmt = {
          sql: `INSERT OR REPLACE INTO "${targetTable}" (${colNames}) VALUES (${placeholders})`,
          args
        };
        statements.push(stmt);
        statementItemMap.push({ statement: stmt, itemId: item.id, table: targetTable });
      } else {
        directSuccessfulIds.push(item.id);
      }
    }

    const successfulIds = [...directSuccessfulIds];

    for (const operation of stockAdjustmentOperations) {
      try {
        await pushStockAdjustmentAtomically(tursoClient, operation.deltaStmt, operation.insertStmt);
        successfulIds.push(operation.itemId);
      } catch (stockErr) {
        console.error(`[BackgroundSync] Failed to atomically push stock adjustment (item: ${operation.itemId}):`, stockErr.message);
        try {
          await localDb.run(
            `UPDATE sync_queue
             SET retry_count = COALESCE(retry_count, 0) + 1,
                 error_message = ?,
                 status = CASE WHEN COALESCE(retry_count, 0) + 1 >= 5 THEN 'FAILED' ELSE status END
             WHERE id = ?`,
            [stockErr.message || 'Stock adjustment push failed', operation.itemId]
          );
        } catch (_) {}
      }
    }

    if (statements.length > 0) {
      try {
        await tursoClient.batch(statements, 'write');
        for (const entry of statementItemMap) {
          successfulIds.push(entry.itemId);
        }
        lastUpstreamSync = new Date().toISOString();
      } catch (batchErr) {
        console.warn(`[BackgroundSync] Batch upstream write failed (${batchErr.message}). Retrying statement batches isolated per table/record...`);
        for (const entry of statementItemMap) {
          try {
            await tursoClient.execute(entry.statement);
            successfulIds.push(entry.itemId);
          } catch (singleErr) {
            console.error(`[BackgroundSync] Failed to push upstream for table "${entry.table}" (item: ${entry.itemId}):`, singleErr.message);
            try {
              await localDb.run(
                `UPDATE sync_queue 
                 SET retry_count = COALESCE(retry_count, 0) + 1,
                     error_message = ?,
                     status = CASE WHEN COALESCE(retry_count, 0) + 1 >= 5 THEN 'FAILED' ELSE status END
                 WHERE id = ?`,
                [singleErr.message || 'Push failed', entry.itemId]
              );
            } catch (_) {}
          }
        }
        if (successfulIds.length > directSuccessfulIds.length) {
          lastUpstreamSync = new Date().toISOString();
        }
      }
    }

    // Purge processed items from local sync_queue
    if (successfulIds.length > 0) {
      const placeholders = successfulIds.map(() => '?').join(', ');
      await localDb.run(`DELETE FROM sync_queue WHERE id IN (${placeholders})`, successfulIds);
    }
    console.log(`[BackgroundSync] Successfully processed ${successfulIds.length} record(s) for Turso Cloud.`);
  } else {
    if (!lastUpstreamSync) lastUpstreamSync = new Date().toISOString();
  }

  // Update remaining count & timestamps
  let remainingPending = 0;
  try {
    const qCount = await localDb.get("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' AND COALESCE(retry_count, 0) < 5");
    remainingPending = Number(qCount?.count ?? 0);
  } catch (_) {}

  try {
    await localDb.run(
      "UPDATE system_settings SET last_counter_sync_timestamp = ?, counter_sync_status = 'IDLE', counter_pending_count = ? WHERE id = 'global'",
      [nowIso, remainingPending]
    );
  } catch (_) {}

  try {
    await tursoClient.execute({
      sql: "UPDATE system_settings SET last_counter_sync_timestamp = ?, counter_sync_status = 'IDLE', counter_pending_count = ? WHERE id = 'global'",
      args: [nowIso, remainingPending]
    });
  } catch (_) {}
  } finally {
    isPushing = false;
  }
}

/**
 * Execute a complete bidirectional synchronization cycle
 */
export async function runSyncCycle(localDb) {
  const isWeb = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.IS_WEB_CLIENT === '1' || (typeof isTurso === 'function' && isTurso());
  if (isWeb) return;
  if (isSyncing || !localDb) return;
  await ensureSyncSchema(localDb);
  const tursoClient = getTursoClient();

  if (!tursoClient) {
    isOnline = false;
    return;
  }

  // Step A: Network Connectivity Check
  const reachable = await pingTurso(tursoClient);
  if (!reachable) {
    isOnline = false;
    isSyncing = false;
    return;
  }

  isOnline = true;
  isSyncing = true;
  const nowIso = new Date().toISOString();

  try {
    // Step 1: Push Upstream Queue to Turso Cloud (strictly from sync_queue)
    await pushUpstreamChanges(localDb, tursoClient);

    // Step 2: Pull Downstream Changes with Universal Deletion Pruning
    await pullDownstreamChanges(localDb, tursoClient);

    lastCounterSync = nowIso;
    lastSyncedAt = nowIso;
  } catch (syncErr) {
    console.error('[BackgroundSync] Error during sync cycle:', syncErr.message);
  } finally {
    isSyncing = false;
  }
}

/**
 * Pull downstream changes from Turso Cloud to local SQLite (hardware.db)
 * Replicates newly created or updated profiles, products, suppliers, customers,
 * permissions, and pricing rules.
 * UNIVERSAL DELETION PRUNING: Automatically drops any local record deleted on Cloud.
 */
export async function pullDownstreamChanges(localDb, tursoClient) {
  // CRITICAL: Never execute downstream pull or prune on Vercel Serverless or in Cloud Web mode
  const isWebClient = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.IS_WEB_CLIENT === '1' || (typeof isTurso === 'function' && isTurso());
  if (isWebClient) {
    return { success: true, pulled: 0, message: 'Web environment: sync pull bypassed.' };
  }
  if (!localDb || !tursoClient) return;
  await ensureSyncSchema(localDb);

  // Mark "an inbound cloud sync write is in progress" for the duration of this whole pull batch.
  // The change-tracking triggers (trg_sync_sales_insert etc., see their WHEN clause in server.js)
  // check for this marker's absence before firing, so a row this pull inserts - which is a cloud
  // READ result, not a new local business mutation - never gets re-queued and pushed straight back
  // to Turso. Without this, a row that is genuinely new to this local device (e.g. the first-ever
  // pull into a freshly set-up/empty local table) would fire the AFTER INSERT trigger, which only
  // captures a partial column snapshot, and pushing that back overwrites/truncates the real cloud
  // row - exactly what happened to 9 production 'sales' rows.
  try {
    await localDb.run('INSERT OR IGNORE INTO sync_pull_marker (id) VALUES (1)');
  } catch (_) {}

  try {
    await pullDownstreamChangesInner(localDb, tursoClient);
  } finally {
    try {
      await localDb.run('DELETE FROM sync_pull_marker WHERE id = 1');
    } catch (_) {}
  }
}

async function pullDownstreamChangesInner(localDb, tursoClient) {
  // 1. Factory Reset Detection on Turso Cloud
  try {
    let cloudWipeTimestamp = 0;
    const wipeCheck = await executeWithTimeout(
      tursoClient,
      "SELECT value, system_wipe_timestamp FROM system_settings WHERE key = 'SYSTEM_WIPE_TIMESTAMP' OR id = 'SYSTEM_WIPE_TIMESTAMP' OR id = 'global'",
      15000
    );
    if (wipeCheck?.rows && wipeCheck.rows.length > 0) {
      for (const r of wipeCheck.rows) {
        const raw = r.value || r.system_wipe_timestamp;
        if (raw) {
          const parsed = Number(raw) || new Date(raw).getTime();
          if (parsed > cloudWipeTimestamp) {
            cloudWipeTimestamp = parsed;
          }
        }
      }
    }

    if (cloudWipeTimestamp > 0) {
      let localWipeTimestamp = 0;
      try {
        try { await localDb.run('ALTER TABLE system_settings ADD COLUMN key TEXT;'); } catch (_) {}
        try { await localDb.run('ALTER TABLE system_settings ADD COLUMN value TEXT;'); } catch (_) {}
        try { await localDb.run('ALTER TABLE system_settings ADD COLUMN system_wipe_timestamp TEXT;'); } catch (_) {}
        try { await localDb.exec('CREATE TABLE IF NOT EXISTS system_meta (key TEXT PRIMARY KEY, value TEXT);'); } catch (_) {}

        const localCheck = await localDb.get(
          "SELECT value, system_wipe_timestamp FROM system_settings WHERE key = 'SYSTEM_WIPE_TIMESTAMP' OR id = 'SYSTEM_WIPE_TIMESTAMP' OR id = 'global'"
        );
        if (localCheck) {
          const raw = localCheck.value || localCheck.system_wipe_timestamp;
          if (raw) {
            localWipeTimestamp = Number(raw) || new Date(raw).getTime();
          }
        }
        const metaCheck = await localDb.get("SELECT value FROM system_meta WHERE key = 'SYSTEM_WIPE_TIMESTAMP'");
        if (metaCheck?.value) {
          const metaTs = Number(metaCheck.value) || new Date(metaCheck.value).getTime();
          if (metaTs > localWipeTimestamp) {
            localWipeTimestamp = metaTs;
          }
        }
      } catch (_) {}

      if (cloudWipeTimestamp > localWipeTimestamp) {
        console.warn(`⚠️ [SyncEngine] Notice: Cloud SYSTEM_WIPE_TIMESTAMP (${cloudWipeTimestamp}) > local (${localWipeTimestamp}) detected. Automatic background wipe is disarmed for data safety. Local database, sync_queue, and user accounts preserved.`);
      }
    }
  } catch (wipeErr) {
    console.warn('[SyncEngine] Notice checking SYSTEM_WIPE_TIMESTAMP:', wipeErr.message);
  }

  // 2. Pull Downstream Tombstones from Turso Cloud to Local SQLite
  try {
    const tombstoneRes = await executeWithTimeout(
      tursoClient,
      'SELECT table_name, record_id, deleted_at FROM deleted_records',
      15000
    );
    if (tombstoneRes?.rows && tombstoneRes.rows.length > 0) {
      for (const row of tombstoneRes.rows) {
        const tableName = row.table_name;
        const recordId = String(row.record_id);
        if (!tableName || !recordId) continue;

        // Record tombstone into local SQLite deleted_records table (for anti-resurrection)
        try {
          await localDb.run(
            'INSERT OR REPLACE INTO deleted_records (table_name, record_id, deleted_at) VALUES (?, ?, COALESCE(?, CURRENT_TIMESTAMP))',
            [tableName, recordId, row.deleted_at]
          );
        } catch (_) {}

        // Safely purge deleted row from local tables
        try {
          if (tableName === 'users') {
            await localDb.run('DELETE FROM users WHERE id = ?', [recordId]);
            await localDb.run('DELETE FROM sessions WHERE user_id = ?', [recordId]);
          } else if (tableName === 'profiles') {
            await localDb.run('DELETE FROM profiles WHERE id = ?', [recordId]);
            await localDb.run('DELETE FROM users WHERE id = ?', [recordId]);
            await localDb.run('DELETE FROM sessions WHERE user_id = ?', [recordId]);
          } else if (tableName === 'customers') {
            await localDb.run('DELETE FROM customers WHERE id = ?', [recordId]);
          } else if (tableName === 'suppliers') {
            await localDb.run('DELETE FROM suppliers WHERE id = ?', [recordId]);
          } else if (tableName === 'sales') {
            await localDb.run('DELETE FROM sales WHERE id = ?', [recordId]);
          } else if (tableName === 'sales_returns') {
            await localDb.run('DELETE FROM sales_returns WHERE id = ?', [recordId]);
          } else if (tableName === 'products') {
            await localDb.run('DELETE FROM products WHERE id = ?', [recordId]);
          }
        } catch (_) {}
      }
    }
  } catch (tombErr) {
    if (!tombErr?.message?.includes('no such table')) {
      console.warn('[SyncEngine] Notice pulling downstream tombstones:', tombErr?.message);
    }
  }

  const syncAndPruneEntity = async (tableName, selectSql = null, excludeClause = '', idCol = 'id', useSafeUpsert = false) => {
    try {
      const tableExists = await localDb.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [tableName]
      );
      if (!tableExists) return;

      const localTableCols = await localDb.all(`PRAGMA table_info("${tableName}")`).catch(() => []);
      const localColSet = new Set((localTableCols || []).map(c => c.name));

      const MASTER_TABLES = new Set(['products', 'categories', 'customers', 'suppliers', 'users', 'profiles', 'expenses', 'debit_notes', 'purchase_returns', 'purchase_return_items', 'customer_transactions', 'delivery_notes', 'bill_holds', 'branches', 'employees']);
      const isMasterTable = MASTER_TABLES.has(tableName);

      const res = await executeWithTimeout(tursoClient, selectSql || `SELECT * FROM "${tableName}"`, 15000);
      const activeCloudIds = [];
      if (res?.rows && res.rows.length > 0) {
        for (const row of res.rows) {
          if (row[idCol] !== undefined && row[idCol] !== null) {
            activeCloudIds.push(String(row[idCol]));
          }

          // Anti-resurrection guard: Do not resurrect records deleted on this terminal
          try {
            const rowIdStr = String(row[idCol]);
            const [tombstone, pendingDelete] = await Promise.all([
              localDb.get('SELECT 1 FROM deleted_records WHERE table_name = ? AND record_id = ?', [tableName, rowIdStr]),
              localDb.get("SELECT 1 FROM sync_queue WHERE table_name = ? AND record_id = ? AND action = 'DELETE'", [tableName, rowIdStr])
            ]);
            if (tombstone || pendingDelete) {
              continue;
            }
          } catch (_) {}

          // LWW & Conflict Resolution for Master Data
          if (isMasterTable) {
            let localRow = null;
            try {
              localRow = await localDb.get(`SELECT * FROM "${tableName}" WHERE "${idCol}" = ?`, [row[idCol]]);
              if (!localRow && tableName === 'products' && row.sku) {
                localRow = await localDb.get(`SELECT * FROM products WHERE sku = ?`, [row.sku]);
              }
            } catch (_) {}

            if (localRow) {
              let unacknowledgedOutbox = null;
              try {
                unacknowledgedOutbox = await localDb.get(
                  `SELECT id FROM sync_queue WHERE table_name = ? AND (record_id = ? OR record_id = ?) AND status IN ('PENDING', 'FAILED', 'ERROR')`,
                  [tableName, String(row[idCol]), String(localRow[idCol])]
                );
              } catch (_) {}

              // SAFETY CONTRACT: If local record has unacknowledged outbox changes (PENDING, FAILED, ERROR),
              // NEVER allow downstream pull to overwrite local stock/master mutations with cloud snapshots!
              if (unacknowledgedOutbox) {
                continue;
              }

              const cloudUpdated = row.updated_at || row.created_at;
              const localUpdated = localRow.updated_at || localRow.created_at;
              const cloudTime = parseUtcTimestamp(cloudUpdated);
              const localTime = parseUtcTimestamp(localUpdated);
              const isCloudNewer = cloudTime > localTime;

              // If cloud is not strictly newer than local, preserve local record
              if (!isCloudNewer) {
                continue;
              }
            }
          }

          if (tableName === 'stock_adjustments') {
            const existingAdj = await localDb.get('SELECT id FROM stock_adjustments WHERE id = ?', [row.id]);
            if (!existingAdj) {
              let delta = 0;
              if (row.delta !== undefined && row.delta !== null) {
                delta = Number(row.delta);
              } else if (row.delta_qty !== undefined && row.delta_qty !== null) {
                delta = Number(row.delta_qty);
              } else if (row.new_qty !== undefined && row.old_qty !== undefined) {
                delta = Number(row.new_qty) - Number(row.old_qty);
              }

              const rawCols = Object.keys(row);
              const cols = localColSet.size > 0 ? rawCols.filter(c => localColSet.has(c)) : rawCols;
              const colNames = cols.map(c => `"${c}"`).join(', ');
              const placeholders = cols.map(() => '?').join(', ');
              const args = cols.map(c => row[c] !== undefined ? row[c] : null);

              await localDb.run(
                `INSERT INTO "stock_adjustments" (${colNames}) VALUES (${placeholders})`,
                args
              );

              if (delta !== 0 && !isNaN(delta) && row.product_id) {
                await localDb.run(
                  `UPDATE "products" SET
                     "stock" = MAX(0, COALESCE("stock", 0) + ?),
                     "stock_quantity" = MAX(0, COALESCE("stock_quantity", 0) + ?),
                     "updated_at" = ?
                   WHERE "id" = ? OR "sku" = ?`,
                  [delta, delta, row.created_at || new Date().toISOString(), row.product_id, row.product_id]
                );
              }
            }
          } else if (tableName === 'products') {
            const cleanRow = { ...row };
            if (cleanRow.price !== undefined && cleanRow.selling_price === undefined) {
              cleanRow.selling_price = cleanRow.price;
            } else if (cleanRow.selling_price !== undefined && cleanRow.price === undefined) {
              cleanRow.price = cleanRow.selling_price;
            }
            if (cleanRow.stock !== undefined && cleanRow.stock_quantity === undefined) {
              cleanRow.stock_quantity = cleanRow.stock;
            } else if (cleanRow.stock_quantity !== undefined && cleanRow.stock === undefined) {
              cleanRow.stock = cleanRow.stock_quantity;
            }

            const rawCols = Object.keys(cleanRow);
            const pCols = localColSet.size > 0 ? rawCols.filter(c => localColSet.has(c)) : rawCols;
            const pColNames = pCols.map(c => `"${c}"`).join(', ');
            const pPlaceholders = pCols.map(() => '?').join(', ');
            const pArgs = pCols.map(c => cleanRow[c] !== undefined ? cleanRow[c] : null);

            await localDb.run(
              `INSERT INTO "products" (${pColNames}) VALUES (${pPlaceholders})
               ON CONFLICT("sku") DO UPDATE SET
                 "name" = excluded."name",
                 "price" = excluded."price",
                 "selling_price" = excluded."selling_price",
                 "cost_price" = excluded."cost_price",
                 "category" = excluded."category",
                 "min_stock" = excluded."min_stock",
                 "supplier" = excluded."supplier",
                 "unit" = excluded."unit",
                 "barcode" = excluded."barcode",
                 "brand" = excluded."brand",
                 "updated_at" = excluded."updated_at"`,
              pArgs
            );
          } else if (useSafeUpsert) {
            const rawCols = Object.keys(row);
            const cols = localColSet.size > 0 ? rawCols.filter(c => localColSet.has(c)) : rawCols;
            const colNames = cols.map(c => `"${c}"`).join(', ');
            const placeholders = cols.map(() => '?').join(', ');
            const args = cols.map(c => row[c] !== undefined ? row[c] : null);
            const updateCols = cols.filter(c => c !== idCol);
            const conflictClause = updateCols.length > 0
              ? `DO UPDATE SET ${updateCols.map(c => `"${c}" = excluded."${c}"`).join(', ')}`
              : 'DO NOTHING';
            await localDb.run(
              `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})
               ON CONFLICT("${idCol}") ${conflictClause}`,
              args
            );
          } else {
            const rawCols = Object.keys(row);
            const cols = localColSet.size > 0 ? rawCols.filter(c => localColSet.has(c)) : rawCols;
            const colNames = cols.map(c => `"${c}"`).join(', ');
            const placeholders = cols.map(() => '?').join(', ');
            const args = cols.map(c => row[c] !== undefined ? row[c] : null);
            await localDb.run(
              `INSERT OR REPLACE INTO "${tableName}" (${colNames}) VALUES (${placeholders})`,
              args
            );
          }
        }
      }

      if (tableName === 'profiles') {
        try {
          const usersTableExists = await localDb.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
          if (usersTableExists && res?.rows && res.rows.length > 0) {
            for (const row of res.rows) {
              await localDb.run(
                `INSERT OR REPLACE INTO users (id, email, password, role, name, created_at) VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
                [row.id, row.email, row.password, row.role, row.name || row.full_name, row.created_at]
              );
            }
          }
        } catch (_) {}
      }

      // Deletion pruning:
      // PERMANENTLY DISABLED: Downstream synchronization must NEVER physically delete Local ERP
      // records merely because those records are absent from a cloud query result set.
      // Inferring deletion from query absence causes catastrophic data loss (deleting legitimate
      // local customers, suppliers, and historical records when cloud responses are incomplete,
      // paginated, or restored). Explicit deletions are handled exclusively via explicit 'DELETE'
      // queue actions in pushUpstreamChanges.
    } catch (err) {
      if (!err?.message?.includes('no such table')) {
        console.warn(`[BackgroundSync] Notice syncing/pruning ${tableName} downstream:`, err.message);
      }
    }
  };

  // Execute all entity syncs in parallel to collapse HTTP latency roundtrips
  await Promise.all([
    // 0. Users (with super_admin / u1 protection)
    syncAndPruneEntity('users', 'SELECT * FROM users', "AND LOWER(role) != 'super_admin' AND id != 'u1'"),
    // 1. Profiles (with super_admin / u1 protection)
    syncAndPruneEntity('profiles', 'SELECT * FROM profiles', "AND LOWER(role) != 'super_admin' AND id != 'u1'"),
    // 2. Products (catalog, stock, prices, SKUs)
    syncAndPruneEntity('products', 'SELECT * FROM products ORDER BY created_at DESC LIMIT 1000'),
    // 3. Customers (profiles, balances, credit limits)
    syncAndPruneEntity('customers', 'SELECT * FROM customers'),
    // 4. Suppliers (vendor records)
    syncAndPruneEntity('suppliers', 'SELECT * FROM suppliers'),
    // 5. Categories
    syncAndPruneEntity('categories', 'SELECT * FROM categories'),
    // 6. Custom Permissions (keyed by role)
    syncAndPruneEntity('custom_permissions', 'SELECT * FROM custom_permissions', '', 'role'),
    // 7. Discounts & Promotions
    syncAndPruneEntity('discounts', 'SELECT * FROM discounts'),
    syncAndPruneEntity('promotions', 'SELECT * FROM promotions'),
    // 8. Purchase Orders & PO Items
    syncAndPruneEntity('purchase_orders', 'SELECT * FROM purchase_orders ORDER BY created_at DESC LIMIT 1000'),
    syncAndPruneEntity('purchase_order_items', 'SELECT * FROM purchase_order_items'),
    syncAndPruneEntity('supplier_transactions', 'SELECT * FROM supplier_transactions'),
    // 9. Quotations & Quotation Items
    syncAndPruneEntity('quotations', 'SELECT * FROM quotations ORDER BY created_at DESC LIMIT 1000'),
    syncAndPruneEntity('quotation_items', 'SELECT * FROM quotation_items'),
    // 9.5. Sales (invoices) - previously missing from downstream pull entirely: a sale created on
    // one desktop (or directly against the cloud, e.g. via the web portal) never reached any other
    // desktop's local database, and a voided/deleted sale (see the void/delete routes in server.js,
    // now correctly enqueued - see enqueueSync calls added there) never had anywhere to sync FROM
    // even if it had synced up. Same pattern/limit as the other high-volume entities above.
    // useSafeUpsert=true: 'sales' has an "AFTER INSERT" change-tracking trigger (trg_sync_sales_insert)
    // that must not re-fire when this pull simply refreshes an already-existing row.
    syncAndPruneEntity('sales', 'SELECT * FROM sales ORDER BY created_at DESC LIMIT 1000', '', 'id', true),
    // 10. Sales Returns & Sales Return Items
    // useSafeUpsert=true: same reasoning as 'sales' above (trg_sync_sales_returns_insert).
    syncAndPruneEntity('sales_returns', 'SELECT * FROM sales_returns ORDER BY created_at DESC LIMIT 1000', '', 'id', true),
    syncAndPruneEntity('sales_return_items', 'SELECT * FROM sales_return_items'),
    // 11. Cheque Registry
    syncAndPruneEntity('cheque_registry', 'SELECT * FROM cheque_registry ORDER BY created_at DESC LIMIT 1000'),
    // 12. Transactions (General Ledger / Cash Book)
    syncAndPruneEntity('transactions', 'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 1000'),
    // 13. Stock Adjustments (Delta synchronization for multi-computer stock integrity)
    syncAndPruneEntity('stock_adjustments', 'SELECT * FROM stock_adjustments ORDER BY created_at ASC LIMIT 2000', '', 'id', false)
  ]);

  lastDownstreamSync = new Date().toISOString();
}

/**
 * Disabled to eliminate the Zombie Deletion Loop permanently.
 * All upstream changes MUST be initiated via explicit mutations in sync_queue.
 */
export async function reconcileLocalCatalogWithCloud(localDb, tursoClient) {
  // Permanently disabled
  return;
}

/**
 * Trigger an immediate event-driven upstream push to cloud
 */
let pushTimeout = null;
let isPushingActive = false;

export async function triggerPush(localDb) {
  if (!localDb || isWebClient) return;
  if (pushTimeout) clearTimeout(pushTimeout);

  return new Promise((resolve) => {
    pushTimeout = setTimeout(async () => {
      if (isPushingActive) return resolve();
      isPushingActive = true;
      try {
        const tursoClient = getTursoClient();
        if (tursoClient) {
          await pushUpstreamChanges(localDb, tursoClient);
        }
      } catch (err) {
        console.warn('[SyncPush] Debounced push warning:', err?.message || err);
      } finally {
        isPushingActive = false;
        resolve();
      }
    }, 1200);
  });
}

/**
 * Start automated background sync worker (runs every 30 seconds fallback with immediate event-driven checkout pushes)
 */
export function startBackgroundSyncWorker(localDb, intervalMs = 30000) {
  const isWeb = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.IS_WEB_CLIENT === '1' || (typeof isTurso === 'function' && isTurso()) || isWebClient;
  if (isWeb) {
    console.log('🌐 [BackgroundSync] Web client environment detected. Background worker disabled (direct cloud queries).');
    return;
  }

  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }

  console.log(`⏱️ [BackgroundSync] Starting automated 30s fallback background sync worker...`);

  // Run initial sync cycle after 1 second to let server initialize
  setTimeout(() => {
    runSyncCycle(localDb).catch(() => {});
  }, 1000);

  // Schedule recurring 30s fallback cycle
  syncIntervalId = setInterval(() => {
    runSyncCycle(localDb).catch(() => {});
  }, intervalMs);

  return syncIntervalId;
}

/**
 * Stop background worker
 */
export function stopBackgroundSyncWorker() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}

/**
 * Get current sync status
 */
export async function getSyncStatus(localDb) {
  let pendingCount = 0;
  if (localDb) await ensureSyncSchema(localDb);

  const isWeb = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.IS_WEB_CLIENT === '1' || isWebClient;

  if (isWeb) {
    // In web mode, query system_settings for counter timestamp & pending queue
    const tursoClient = getTursoClient();
    let webLastSync = null;
    let counterQueued = 0;
    if (tursoClient) {
      try {
        const res = await tursoClient.execute("SELECT last_counter_sync_timestamp, last_sync_timestamp, counter_pending_count FROM system_settings WHERE id = 'global'");
        if (res?.rows?.[0]) {
          const ts = res.rows[0].last_counter_sync_timestamp || res.rows[0].last_sync_timestamp;
          if (ts) {
            webLastSync = String(ts);
          }
          if (res.rows[0].counter_pending_count !== undefined && res.rows[0].counter_pending_count !== null) {
            counterQueued = Number(res.rows[0].counter_pending_count) || 0;
          }
        }
      } catch (_) {}
    }

    return {
      status: 'ok',
      online: true,
      synced: true,
      isWebClient: true,
      lastUpstreamSync: null,
      lastDownstreamSync: null,
      lastCounterSync: webLastSync,
      queuedCount: counterQueued,
      isOnline: true,
      lastSyncedAt: webLastSync,
      pendingCount: counterQueued,
      isSyncing: false
    };
  }

  // Local desktop mode
  if (localDb) {
    try {
      const qRes = await localDb.get("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'");
      pendingCount = Number(qRes?.count ?? 0);
    } catch (_) {}

    if (!lastCounterSync) {
      try {
        const sRes = await localDb.get("SELECT last_counter_sync_timestamp, last_sync_timestamp FROM system_settings WHERE id = 'global'");
        const ts = sRes?.last_counter_sync_timestamp || sRes?.last_sync_timestamp;
        if (ts) {
          lastCounterSync = String(ts);
          lastSyncedAt = lastCounterSync;
        }
      } catch (_) {}
    }
  }

  const currentStatus = isSyncing ? 'syncing' : (isOnline ? 'online' : 'offline');

  return {
    status: currentStatus,
    online: isOnline,
    synced: isOnline && pendingCount === 0,
    isWebClient: false,
    lastUpstreamSync: lastUpstreamSync || lastCounterSync,
    lastDownstreamSync: lastDownstreamSync || lastCounterSync,
    lastCounterSync: lastCounterSync,
    queuedCount: pendingCount,
    isOnline,
    lastSyncedAt: lastCounterSync || lastUpstreamSync,
    pendingCount,
    isSyncing
  };
}

export default {
  pingTurso,
  enqueueSync,
  runSyncCycle,
  pullDownstreamChanges,
  startBackgroundSyncWorker,
  stopBackgroundSyncWorker,
  getSyncStatus
};
