import { getTursoClient, isTurso } from '../db/connection.ts';
import type { Database } from 'sqlite';
import type { Client } from '@libsql/client';

export interface SyncStatus {
  isWebClient: boolean;
  lastUpstreamSync: string | null;
  lastDownstreamSync: string | null;
  lastCounterSync: string | null;
  queuedCount: number;
  status: 'online' | 'offline' | 'syncing';
  // Legacy / convenience aliases
  isOnline?: boolean;
  lastSyncedAt?: string | null;
  pendingCount?: number;
  isSyncing?: boolean;
}

export interface SyncQueueItem {
  id: string;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: string;
  status: 'PENDING' | 'SYNCED' | 'FAILED';
  created_at: string;
}

let isOnline = true;
let isSyncing = false;
let lastSyncedAt: string | null = null;
let lastUpstreamSync: string | null = null;
let lastDownstreamSync: string | null = null;
let lastCounterSync: string | null = null;
let syncIntervalId: any = null;
let isWebClient = false;

if (
  (typeof process !== 'undefined' && process.env?.VERCEL === '1') ||
  (typeof process !== 'undefined' && process.env?.APP_ROLE === 'web') ||
  (typeof process !== 'undefined' && process.env?.IS_WEB_CLIENT === '1')
) {
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
  'purchase_order_items',
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

export async function pingTurso(tursoClient: Client | null): Promise<boolean> {
  if (!tursoClient) return false;
  try {
    const pingPromise = tursoClient.execute('SELECT 1 as ping');
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Turso ping timeout')), 3000)
    );
    await Promise.race([pingPromise, timeoutPromise]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes any timestamp representation (SQLite UTC string, ISO 8601, or epoch number)
 * into UTC milliseconds, preventing timezone distortion and false ordering.
 */
export function parseUtcTimestamp(ts: any): number {
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
async function executeWithTimeout(tursoClient: Client, sqlOrObj: any, timeoutMs = 15000): Promise<any> {
  const queryPromise = tursoClient.execute(sqlOrObj);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Query timeout after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([queryPromise, timeoutPromise]);
}

// A stock delta and its idempotency marker are one business operation. Do not
// send this pair through a generic statement fallback that may split retries.
async function pushStockAdjustmentAtomically(tursoClient: Client, deltaStmt: any, insertStmt: any): Promise<void> {
  if (typeof (tursoClient as any).transaction !== 'function') {
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
export async function ensureTursoSchema(tursoClient: Client | null): Promise<void> {
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
      "ALTER TABLE transactions ADD COLUMN branch_id TEXT;"
    ];
    for (const c of cols) {
      try { await tursoClient.execute(c); } catch (_) {}
    }
    tursoSchemaEnsured = true;
  } catch (e: any) {
    console.warn('[BackgroundSync] Warning: Failed to ensure Turso schema:', e?.message);
  }
}

// Database Generation Readiness and In-Flight Concurrency Management
let resetEpoch = 0;
const clientReadyGenerations = new WeakMap<object, Set<string>>();
const clientInFlightInits = new WeakMap<object, Map<string, Promise<void>>>();

function getDbInfo(db: any): { client: any; gen: number } {
  if (!db) return { client: null, gen: 0 };
  const client = typeof db.getUnderlyingClient === 'function' ? db.getUnderlyingClient() : db;
  const gen = typeof db.getDbGeneration === 'function' 
    ? db.getDbGeneration() 
    : (typeof db.__dbGeneration === 'number' ? db.__dbGeneration : (client && typeof client.__dbGeneration === 'number' ? client.__dbGeneration : 0));
  return { client, gen };
}

export function isSyncSchemaReady(db: any): boolean {
  const { client, gen } = getDbInfo(db);
  if (!client || typeof client !== 'object') return false;
  const readyGens = clientReadyGenerations.get(client);
  return Boolean(readyGens && readyGens.has(`${gen}_${resetEpoch}`));
}

export function invalidateSyncSchema(db: any = null): void {
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

export function __resetSyncSchemaForTesting(db: any = null): void {
  invalidateSyncSchema(db);
}

export async function ensureSyncSchema(db: any): Promise<void> {
  if (!db) return;
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
      const targetExec = async (sql: string) => {
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
      const targetQueryAll = async (sql: string, params: any[] = []): Promise<any[]> => {
        assertConnectionValid();
        let rows: any[];
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
      const safeAddColumn = async (sql: string, tableName: string) => {
        try {
          await targetExec(sql);
        } catch (err: any) {
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
      } catch (uErr: any) {
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
      } catch (sErr: any) {
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
      } catch (saErr: any) {
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
      } catch (drErr: any) {
        const msg = (drErr?.message || String(drErr)).toLowerCase();
        if (!msg.includes('already exists')) throw drErr;
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

      const existingCols = new Set(columns.map((c: any) => (c.name || '').toLowerCase()));
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
      const existingIndexes = new Set((indexes || []).map((idx: any) => (idx.name || '').toLowerCase()));
      if (!existingIndexes.has('idx_sync_queue_status')) {
        throw new Error('[SyncSchema] Verification failed: missing required index idx_sync_queue_status on sync_queue.');
      }

      // If system_settings exists, verify required sync columns are present
      const sysSettingsInfo = await targetQueryAll("PRAGMA table_info('system_settings');");
      if (sysSettingsInfo && sysSettingsInfo.length > 0) {
        const sysCols = new Set(sysSettingsInfo.map((c: any) => (c.name || '').toLowerCase()));
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

export async function enqueueSync(
  db: any,
  tableName: string,
  recordId: string,
  action: 'INSERT' | 'UPDATE' | 'DELETE' = 'INSERT',
  payload: any = null
): Promise<void> {
  if (!db || isWebClient) return;
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
      try {
        const row = await db.get(`SELECT * FROM "${tableName}" WHERE id = ?`, [recordId]);
        if (row) jsonStr = JSON.stringify(row);
      } catch {}
    }

    await db.run(
      `INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, action, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)`,
      [id, tableName, String(recordId), action, jsonStr]
    );
  } catch (err: any) {
    console.error(`[SyncQueue] Failed to enqueue ${tableName} (${recordId}):`, err?.message);
    if (typeof db.isInTransaction === 'function' && db.isInTransaction()) {
      throw err;
    }
  }
}

let isPushing = false;

/**
 * Push pending local mutations to Turso Cloud
 */
export async function pushUpstreamChanges(localDb: any, tursoClient: Client | null): Promise<void> {
  if (!localDb || !tursoClient) return;
  if (isWebClient) return;
  if (isPushing) {
    console.log('[BackgroundSync] Upstream push already in progress, skipping concurrent run.');
    return;
  }
  isPushing = true;
  try {
    await ensureTursoSchema(tursoClient);
    const nowIso = new Date().toISOString();

    const pendingItems: SyncQueueItem[] = await localDb.all(
      "SELECT * FROM sync_queue WHERE status = 'PENDING' AND COALESCE(retry_count, 0) < 5 ORDER BY created_at ASC LIMIT 100"
    );

  if (pendingItems && pendingItems.length > 0) {
    const statements: Array<{ sql: string; args: any[] }> = [];
    const successfulIds: string[] = [];
    const stockAdjustmentOperations: Array<{ itemId: string; deltaStmt: any; insertStmt: any }> = [];

    for (const item of pendingItems) {
      let row: any = null;
      try {
        row = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
      } catch {}

      if (!row || Object.keys(row).length === 0) {
        try {
          row = await localDb.get(`SELECT * FROM "${item.table_name}" WHERE id = ?`, [item.record_id]);
        } catch {}
      }

      // Ensure delivery_fee / transportation_fee parity
      if (item.table_name === 'sales' && row && typeof row === 'object') {
        const delFee = Number(
          (row as any).transportation_fee !== undefined && (row as any).transportation_fee !== null && Number((row as any).transportation_fee) > 0
            ? (row as any).transportation_fee
            : ((row as any).delivery_fee !== undefined && (row as any).delivery_fee !== null ? (row as any).delivery_fee : ((row as any).deliveryFee || 0))
        );
        (row as any).transportation_fee = delFee;
        delete (row as any).delivery_fee;
        delete (row as any).deliveryFee;
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

      if (item.action === 'DELETE') {
        statements.push({
          sql: `DELETE FROM "${targetTable}" WHERE id = ?`,
          args: [item.record_id]
        });
        successfulIds.push(item.id);
      } else if (row && typeof row === 'object' && targetTable === 'products') {
        const cleanRow = { ...row };
        if (cleanRow.price !== undefined && cleanRow.selling_price === undefined) {
          cleanRow.selling_price = cleanRow.price;
        } else if (cleanRow.selling_price !== undefined && cleanRow.price === undefined) {
          cleanRow.price = cleanRow.selling_price;
        }
        delete cleanRow.stock;
        delete cleanRow.stock_quantity;
        cleanRow.updated_at = cleanRow.updated_at || new Date().toISOString();

        const columns = Object.keys(cleanRow);
        const colNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const args = columns.map(c => cleanRow[c] !== undefined ? cleanRow[c] : null);

        statements.push({
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
        });
        successfulIds.push(item.id);
      } else if (row && typeof row === 'object' && targetTable === 'stock_adjustments') {
        const cleanRow = { ...row };
        const columns = Object.keys(cleanRow);
        const colNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const args = columns.map(c => cleanRow[c] !== undefined ? cleanRow[c] : null);

        let delta = 0;
        if (cleanRow.delta !== undefined && cleanRow.delta !== null) {
          delta = Number(cleanRow.delta);
        } else if (cleanRow.delta_qty !== undefined && cleanRow.delta_qty !== null) {
          delta = Number(cleanRow.delta_qty);
        } else if (cleanRow.new_qty !== undefined && cleanRow.old_qty !== undefined) {
          delta = Number(cleanRow.new_qty) - Number(cleanRow.old_qty);
        }

        // P0 DEFECT 2 FIX: Idempotent database-side execution on Turso
        let stockDeltaStmt: any = null;
        if (delta !== 0 && !isNaN(delta) && cleanRow.product_id) {
          const adjId = cleanRow.id || item.record_id || '';
          stockDeltaStmt = {
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
        }

        const stockInsertStmt = {
          sql: `INSERT OR IGNORE INTO "stock_adjustments" (${colNames}) VALUES (${placeholders})`,
          args
        };
        stockAdjustmentOperations.push({ itemId: item.id, deltaStmt: stockDeltaStmt, insertStmt: stockInsertStmt });
      } else if (row && typeof row === 'object') {
        const columns = Object.keys(row);
        const colNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const args = columns.map(c => (row as any)[c] !== undefined ? (row as any)[c] : null);

        statements.push({
          sql: `INSERT OR REPLACE INTO "${targetTable}" (${colNames}) VALUES (${placeholders})`,
          args
        });
        successfulIds.push(item.id);
      } else {
        successfulIds.push(item.id);
      }
    }

    for (const operation of stockAdjustmentOperations) {
      try {
        await pushStockAdjustmentAtomically(tursoClient, operation.deltaStmt, operation.insertStmt);
        successfulIds.push(operation.itemId);
      } catch (stockErr: any) {
        console.error(`[BackgroundSync] Failed to atomically push stock adjustment (item: ${operation.itemId}):`, stockErr?.message);
        try {
          await localDb.run(
            `UPDATE sync_queue
             SET retry_count = COALESCE(retry_count, 0) + 1,
                 error_message = ?,
                 status = CASE WHEN COALESCE(retry_count, 0) + 1 >= 5 THEN 'FAILED' ELSE status END
             WHERE id = ?`,
            [stockErr?.message || 'Stock adjustment push failed', operation.itemId]
          );
        } catch (_) {}
      }
    }

    if (statements.length > 0) {
      await tursoClient.batch(statements, 'write');
      lastUpstreamSync = new Date().toISOString();
    }

    if (successfulIds.length > 0) {
      const placeholders = successfulIds.map(() => '?').join(', ');
      await localDb.run(`DELETE FROM sync_queue WHERE id IN (${placeholders})`, successfulIds);
    }
  } else {
    if (!lastUpstreamSync) lastUpstreamSync = new Date().toISOString();
  }

  let remainingPending = 0;
  try {
    const qCount = await localDb.get("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING' AND COALESCE(retry_count, 0) < 5");
    remainingPending = Number(qCount?.count ?? 0);
  } catch {}

  try {
    await localDb.run(
      "UPDATE system_settings SET last_counter_sync_timestamp = ?, counter_sync_status = 'IDLE', counter_pending_count = ? WHERE id = 'global'",
      [nowIso, remainingPending]
    );
  } catch {}

  try {
    await tursoClient.execute({
      sql: "UPDATE system_settings SET last_counter_sync_timestamp = ?, counter_sync_status = 'IDLE', counter_pending_count = ? WHERE id = 'global'",
      args: [nowIso, remainingPending]
    });
  } catch {}
  } finally {
    isPushing = false;
  }
}

export async function runSyncCycle(localDb: any): Promise<void> {
  const isWeb = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.IS_WEB_CLIENT === '1' || (typeof isTurso === 'function' && isTurso());
  if (isWeb) return;
  if (isSyncing || !localDb) return;
  await ensureSyncSchema(localDb);
  const tursoClient = getTursoClient();

  if (!tursoClient) {
    isOnline = false;
    return;
  }

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
    // Step 1: Push Upstream Queue to Cloud (strictly from sync_queue)
    await pushUpstreamChanges(localDb, tursoClient);

    // Step 2: Pull Downstream Changes with Universal Deletion Pruning
    await pullDownstreamChanges(localDb, tursoClient);

    lastCounterSync = nowIso;
    lastSyncedAt = nowIso;
  } catch (syncErr: any) {
    console.error('[BackgroundSync] Error during sync cycle:', syncErr?.message);
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
export async function pullDownstreamChanges(localDb: any, tursoClient: Client | null): Promise<any> {
  // CRITICAL: Never execute downstream pull or prune on Vercel Serverless or in Cloud Web mode
  const isWebClient = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.IS_WEB_CLIENT === '1' || (typeof isTurso === 'function' && isTurso());
  if (isWebClient) {
    return { success: true, pulled: 0, message: 'Web environment: sync pull bypassed.' };
  }
  if (!localDb || !tursoClient) return;
  await ensureSyncSchema(localDb);

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
        const raw = (r as any).value || (r as any).system_wipe_timestamp;
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
        try { await localDb.run('ALTER TABLE system_settings ADD COLUMN key TEXT;'); } catch {}
        try { await localDb.run('ALTER TABLE system_settings ADD COLUMN value TEXT;'); } catch {}
        try { await localDb.run('ALTER TABLE system_settings ADD COLUMN system_wipe_timestamp TEXT;'); } catch {}
        try { await localDb.exec('CREATE TABLE IF NOT EXISTS system_meta (key TEXT PRIMARY KEY, value TEXT);'); } catch {}

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
      } catch {}

      if (cloudWipeTimestamp > localWipeTimestamp) {
        console.warn(`⚠️ [SyncEngine] Notice: Cloud SYSTEM_WIPE_TIMESTAMP (${cloudWipeTimestamp}) > local (${localWipeTimestamp}) detected. Automatic background wipe is disarmed for data safety. Local database, sync_queue, and user accounts preserved.`);
      }
    }
  } catch (wipeErr: any) {
    console.warn('[SyncEngine] Notice checking SYSTEM_WIPE_TIMESTAMP:', wipeErr.message);
  }

  // 2. Pull Downstream Tombstones from Turso Cloud to Local SQLite
  try {
    const tombstoneRes: any = await executeWithTimeout(
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
  } catch (tombErr: any) {
    if (!tombErr?.message?.includes('no such table')) {
      console.warn('[SyncEngine] Notice pulling downstream tombstones:', tombErr?.message);
    }
  }

  const syncAndPruneEntity = async (tableName: string, selectSql?: string, excludeClause = '', idCol = 'id', useSafeUpsert = false) => {
    try {
      const tableExists = await localDb.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [tableName]
      );
      if (!tableExists) return;

      const localTableCols = await localDb.all(`PRAGMA table_info("${tableName}")`).catch(() => []);
      const localColSet = new Set((localTableCols || []).map((c: any) => c.name));

      const MASTER_TABLES = new Set(['products', 'categories', 'customers', 'suppliers', 'users', 'profiles']);
      const isMasterTable = MASTER_TABLES.has(tableName);

      const res = await executeWithTimeout(tursoClient, selectSql || `SELECT * FROM "${tableName}"`, 15000);
      const activeCloudIds: string[] = [];
      if (res?.rows && res.rows.length > 0) {
        for (const row of res.rows) {
          if ((row as any)[idCol] !== undefined && (row as any)[idCol] !== null) {
            activeCloudIds.push(String((row as any)[idCol]));
          }

          // Anti-resurrection guard: Do not resurrect records deleted on this terminal
          try {
            const rowIdStr = String((row as any)[idCol]);
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
            let localRow: any = null;
            try {
              localRow = await localDb.get(`SELECT * FROM "${tableName}" WHERE "${idCol}" = ?`, [(row as any)[idCol]]);
              if (!localRow && tableName === 'products' && (row as any).sku) {
                localRow = await localDb.get(`SELECT * FROM products WHERE sku = ?`, [(row as any).sku]);
              }
            } catch {}

            if (localRow) {
              let unacknowledgedOutbox: any = null;
              try {
                unacknowledgedOutbox = await localDb.get(
                  `SELECT id FROM sync_queue WHERE table_name = ? AND (record_id = ? OR record_id = ?) AND status IN ('PENDING', 'FAILED', 'ERROR')`,
                  [tableName, String((row as any)[idCol]), String(localRow[idCol])]
                );
              } catch {}

              // SAFETY CONTRACT: If local record has unacknowledged outbox changes (PENDING, FAILED, ERROR),
              // NEVER allow downstream pull to overwrite local stock/master mutations with cloud snapshots!
              if (unacknowledgedOutbox) {
                continue;
              }

              const cloudUpdated = (row as any).updated_at || (row as any).created_at;
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
            const existingAdj = await localDb.get('SELECT id FROM stock_adjustments WHERE id = ?', [(row as any).id]);
            if (!existingAdj) {
              let delta = 0;
              if ((row as any).delta !== undefined && (row as any).delta !== null) {
                delta = Number((row as any).delta);
              } else if ((row as any).delta_qty !== undefined && (row as any).delta_qty !== null) {
                delta = Number((row as any).delta_qty);
              } else if ((row as any).new_qty !== undefined && (row as any).old_qty !== undefined) {
                delta = Number((row as any).new_qty) - Number((row as any).old_qty);
              }

              const rawCols = Object.keys(row);
              const cols = localColSet.size > 0 ? rawCols.filter(c => localColSet.has(c)) : rawCols;
              const colNames = cols.map(c => `"${c}"`).join(', ');
              const placeholders = cols.map(() => '?').join(', ');
              const args = cols.map(c => (row as any)[c] !== undefined ? (row as any)[c] : null);

              await localDb.run(
                `INSERT INTO "stock_adjustments" (${colNames}) VALUES (${placeholders})`,
                args
              );

              if (delta !== 0 && !isNaN(delta) && (row as any).product_id) {
                await localDb.run(
                  `UPDATE "products" SET
                     "stock" = MAX(0, COALESCE("stock", 0) + ?),
                     "stock_quantity" = MAX(0, COALESCE("stock_quantity", 0) + ?),
                     "updated_at" = ?
                   WHERE "id" = ? OR "sku" = ?`,
                  [delta, delta, (row as any).created_at || new Date().toISOString(), (row as any).product_id, (row as any).product_id]
                );
              }
            }
          } else if (tableName === 'products') {
            const cleanRow = { ...row as any };
            if (cleanRow.price !== undefined && cleanRow.selling_price === undefined) {
              cleanRow.selling_price = cleanRow.price;
            } else if (cleanRow.selling_price !== undefined && cleanRow.price === undefined) {
              cleanRow.price = cleanRow.selling_price;
            }
            delete cleanRow.stock;
            delete cleanRow.stock_quantity;

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
            const args = cols.map(c => (row as any)[c] !== undefined ? (row as any)[c] : null);
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
            const args = cols.map(c => (row as any)[c] !== undefined ? (row as any)[c] : null);
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
                [(row as any).id, (row as any).email, (row as any).password, (row as any).role, (row as any).name || (row as any).full_name, (row as any).created_at]
              );
            }
          }
        } catch {}
      }

      // Deletion pruning:
      // PERMANENTLY DISABLED: Downstream synchronization must NEVER physically delete Local ERP
      // records merely because those records are absent from a cloud query result set.
      // Inferring deletion from query absence causes catastrophic data loss (deleting legitimate
      // local customers, suppliers, and historical records when cloud responses are incomplete,
      // paginated, or restored). Explicit deletions are handled exclusively via explicit 'DELETE'
      // queue actions in pushUpstreamChanges.
    } catch (err: any) {
      if (!err?.message?.includes('no such table')) {
        console.warn(`[BackgroundSync] Notice syncing/pruning ${tableName} downstream:`, err?.message);
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
    // 10. Sales Returns & Sales Return Items
    syncAndPruneEntity('sales_returns', 'SELECT * FROM sales_returns ORDER BY created_at DESC LIMIT 1000'),
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
export async function reconcileLocalCatalogWithCloud(localDb: any, tursoClient: Client | null): Promise<void> {
  // Permanently disabled
  return;
}

/**
 * Trigger an immediate event-driven upstream push to cloud
 */
export async function triggerPush(localDb: any): Promise<void> {
  if (!localDb || isWebClient) return;
  const tursoClient = getTursoClient();
  if (tursoClient) {
    return pushUpstreamChanges(localDb, tursoClient);
  }
}

export function startBackgroundSyncWorker(localDb: any, intervalMs = 30000): any {
  const isWeb = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.IS_WEB_CLIENT === '1' || (typeof isTurso === 'function' && isTurso()) || isWebClient;
  if (isWeb) return null;

  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }

  console.log(`⏱️ [BackgroundSync] Starting automated 30s fallback background sync worker...`);

  setTimeout(() => {
    runSyncCycle(localDb).catch(() => {});
  }, 1000);

  syncIntervalId = setInterval(() => {
    runSyncCycle(localDb).catch(() => {});
  }, intervalMs);

  return syncIntervalId;
}

export function stopBackgroundSyncWorker(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}

export async function getSyncStatus(localDb: any): Promise<SyncStatus> {
  let pendingCount = 0;
  if (localDb) await ensureSyncSchema(localDb);

  const isWeb = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.IS_WEB_CLIENT === '1' || isWebClient;

  if (isWeb) {
    const tursoClient = getTursoClient();
    let webLastSync: string | null = null;
    let counterQueued = 0;
    if (tursoClient) {
      try {
        const res = await tursoClient.execute("SELECT last_counter_sync_timestamp, last_sync_timestamp, counter_pending_count FROM system_settings WHERE id = 'global'");
        if (res?.rows?.[0]) {
          const row = res.rows[0] as any;
          const ts = row.last_counter_sync_timestamp || row.last_sync_timestamp;
          if (ts) {
            webLastSync = String(ts);
          }
          if (row.counter_pending_count !== undefined && row.counter_pending_count !== null) {
            counterQueued = Number(row.counter_pending_count) || 0;
          }
        }
      } catch {}
    }

    return {
      isWebClient: true,
      lastUpstreamSync: null,
      lastDownstreamSync: null,
      lastCounterSync: webLastSync,
      queuedCount: counterQueued,
      status: 'online',
      isOnline: true,
      lastSyncedAt: webLastSync,
      pendingCount: counterQueued,
      isSyncing: false
    };
  }

  if (localDb) {
    try {
      const qRes = await localDb.get("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'");
      pendingCount = Number(qRes?.count ?? 0);
    } catch {}

    if (!lastCounterSync) {
      try {
        const sRes = await localDb.get("SELECT last_counter_sync_timestamp, last_sync_timestamp FROM system_settings WHERE id = 'global'");
        const ts = sRes?.last_counter_sync_timestamp || sRes?.last_sync_timestamp;
        if (ts) {
          lastCounterSync = String(ts);
          lastSyncedAt = lastCounterSync;
        }
      } catch {}
    }
  }

  const currentStatus: 'online' | 'offline' | 'syncing' = isSyncing ? 'syncing' : (isOnline ? 'online' : 'offline');

  return {
    isWebClient: false,
    lastUpstreamSync: lastUpstreamSync || lastCounterSync,
    lastDownstreamSync: lastDownstreamSync || lastCounterSync,
    lastCounterSync: lastCounterSync,
    queuedCount: pendingCount,
    status: currentStatus,
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
