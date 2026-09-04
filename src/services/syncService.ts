import { getTursoClient } from '../db/connection.ts';
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

async function executeWithTimeout(tursoClient: Client, sqlOrObj: any, timeoutMs = 5000): Promise<any> {
  const queryPromise = tursoClient.execute(sqlOrObj);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Query timeout after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([queryPromise, timeoutPromise]);
}

let schemaEnsured = false;
export async function ensureSyncSchema(db: any): Promise<void> {
  if (!db || schemaEnsured) return;
  try {
    await db.exec(`
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
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);"); } catch {}
    try { await db.exec("ALTER TABLE system_settings ADD COLUMN last_counter_sync_timestamp TEXT;"); } catch {}
    try { await db.exec("ALTER TABLE system_settings ADD COLUMN last_sync_timestamp TEXT;"); } catch {}
    try { await db.exec("ALTER TABLE system_settings ADD COLUMN counter_sync_status TEXT DEFAULT 'IDLE';"); } catch {}
    try { await db.exec("ALTER TABLE system_settings ADD COLUMN counter_pending_count INTEGER DEFAULT 0;"); } catch {}
    schemaEnsured = true;
  } catch {}
}

export async function enqueueSync(
  db: any,
  tableName: string,
  recordId: string,
  action: 'INSERT' | 'UPDATE' | 'DELETE' = 'INSERT',
  payload: any = null
): Promise<void> {
  if (!db || isWebClient) return;
  await ensureSyncSchema(db);
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
  }
}

/**
 * Push pending local mutations to Turso Cloud
 */
export async function pushUpstreamChanges(localDb: any, tursoClient: Client | null): Promise<void> {
  if (!localDb || !tursoClient) return;
  const nowIso = new Date().toISOString();

  const pendingItems: SyncQueueItem[] = await localDb.all(
    "SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 100"
  );

  if (pendingItems && pendingItems.length > 0) {
    const statements: Array<{ sql: string; args: any[] }> = [];
    const successfulIds: string[] = [];

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

      if (item.action === 'DELETE') {
        statements.push({
          sql: `DELETE FROM "${item.table_name}" WHERE id = ?`,
          args: [item.record_id]
        });
        successfulIds.push(item.id);
      } else if (row && typeof row === 'object') {
        const columns = Object.keys(row);
        const colNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const args = columns.map(c => (row as any)[c] !== undefined ? (row as any)[c] : null);

        statements.push({
          sql: `INSERT OR REPLACE INTO "${item.table_name}" (${colNames}) VALUES (${placeholders})`,
          args
        });
        successfulIds.push(item.id);
      } else {
        successfulIds.push(item.id);
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
    const qCount = await localDb.get("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'");
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
}

export async function runSyncCycle(localDb: any): Promise<void> {
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
export async function pullDownstreamChanges(localDb: any, tursoClient: Client | null): Promise<void> {
  if (!localDb || !tursoClient) return;

  const syncAndPruneEntity = async (tableName: string, selectSql?: string, excludeClause = '', idCol = 'id') => {
    try {
      const tableExists = await localDb.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [tableName]
      );
      if (!tableExists) return;

      const res = await executeWithTimeout(tursoClient, selectSql || `SELECT * FROM "${tableName}"`, 5000);
      const activeCloudIds: string[] = [];
      if (res?.rows && res.rows.length > 0) {
        for (const row of res.rows) {
          if ((row as any)[idCol] !== undefined && (row as any)[idCol] !== null) {
            activeCloudIds.push(String((row as any)[idCol]));
          }
          const cols = Object.keys(row);
          const colNames = cols.map(c => `"${c}"`).join(', ');
          const placeholders = cols.map(() => '?').join(', ');
          const args = cols.map(c => (row as any)[c] !== undefined ? (row as any)[c] : null);
          await localDb.run(
            `INSERT OR REPLACE INTO "${tableName}" (${colNames}) VALUES (${placeholders})`,
            args
          );
        }
      }

      // Deletion pruning:
      // Exclude local records that are currently awaiting upstream sync in sync_queue (offline creations)
      const pendingExclude = `AND "${idCol}" NOT IN (SELECT record_id FROM sync_queue WHERE table_name = '${tableName}' AND status = 'PENDING')`;
      const fullExclude = `${pendingExclude} ${excludeClause}`.trim();

      if (activeCloudIds.length > 0) {
        const placeholders = activeCloudIds.map(() => '?').join(', ');
        const deletedResult = await localDb.run(
          `DELETE FROM "${tableName}" WHERE "${idCol}" NOT IN (${placeholders}) ${fullExclude}`,
          activeCloudIds
        );
        if (deletedResult?.changes && deletedResult.changes > 0) {
          console.log(`[BackgroundSync] Pruned ${deletedResult.changes} deleted ${tableName} record(s) locally.`);
        }
      } else {
        // Cloud table has 0 records -> Prune all local records for this entity
        const deletedResult = await localDb.run(
          `DELETE FROM "${tableName}" WHERE 1=1 ${fullExclude}`
        );
        if (deletedResult?.changes && deletedResult.changes > 0) {
          console.log(`[BackgroundSync] Pruned all ${deletedResult.changes} local ${tableName} record(s) (cloud table is empty).`);
        }
      }
    } catch (err: any) {
      if (!err?.message?.includes('no such table')) {
        console.warn(`[BackgroundSync] Notice syncing/pruning ${tableName} downstream:`, err?.message);
      }
    }
  };

  // 1. Profiles (with super_admin / u1 protection)
  await syncAndPruneEntity('profiles', 'SELECT * FROM profiles', "AND LOWER(role) != 'super_admin' AND id != 'u1'");

  // 2. Products (catalog, stock, prices, SKUs)
  await syncAndPruneEntity('products', 'SELECT * FROM products ORDER BY created_at DESC LIMIT 1000');

  // 3. Customers (profiles, balances, credit limits)
  await syncAndPruneEntity('customers', 'SELECT * FROM customers');

  // 4. Suppliers (vendor records)
  await syncAndPruneEntity('suppliers', 'SELECT * FROM suppliers');

  // 5. Categories
  await syncAndPruneEntity('categories', 'SELECT * FROM categories');

  // 6. Custom Permissions (keyed by role)
  await syncAndPruneEntity('custom_permissions', 'SELECT * FROM custom_permissions', '', 'role');

  // 7. Discounts & Promotions
  await syncAndPruneEntity('discounts', 'SELECT * FROM discounts');
  await syncAndPruneEntity('promotions', 'SELECT * FROM promotions');

  // 8. Purchase Orders & PO Items
  await syncAndPruneEntity('purchase_orders', 'SELECT * FROM purchase_orders ORDER BY created_at DESC LIMIT 1000');
  await syncAndPruneEntity('purchase_order_items', 'SELECT * FROM purchase_order_items');
  await syncAndPruneEntity('supplier_transactions', 'SELECT * FROM supplier_transactions');

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

export function startBackgroundSyncWorker(localDb: any, intervalMs = 3000): any {
  if (isWebClient) return null;

  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }

  console.log(`⏱️ [BackgroundSync] Starting automated 3s near-real-time background sync worker...`);

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
