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
      setTimeout(() => reject(new Error('Turso ping timeout')), 4000)
    );
    await Promise.race([pingPromise, timeoutPromise]);
    return true;
  } catch {
    return false;
  }
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

  try {
    // Step A.5: Reconcile un-synced local items (e.g. initial desktop inventory) with Cloud
    await reconcileLocalCatalogWithCloud(localDb, tursoClient);
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
          const args = columns.map(c => row[c] !== undefined ? row[c] : null);

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

    // Step C: Pull Remote Admin Updates from Cloud
    await pullDownstreamChanges(localDb, tursoClient);
    lastDownstreamSync = new Date().toISOString();

    const nowIso = new Date().toISOString();
    lastCounterSync = nowIso;
    lastSyncedAt = nowIso;

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

  } catch (syncErr: any) {
    console.error('[BackgroundSync] Error during sync cycle:', syncErr?.message);
  } finally {
    isSyncing = false;
  }
}

/**
 * Pull downstream changes from Turso Cloud to local SQLite (hardware.db)
 * Replicates newly created or updated profiles and product catalogue records.
 */
export async function pullDownstreamChanges(localDb: any, tursoClient: Client | null): Promise<void> {
  if (!localDb || !tursoClient) return;

  // 1. Pull user profiles (ensures cloud web users are available for offline desktop login)
  try {
    const remoteProfiles = await tursoClient.execute('SELECT * FROM profiles');
    if (remoteProfiles?.rows?.length > 0) {
      for (const prof of remoteProfiles.rows) {
        const cols = Object.keys(prof);
        const colNames = cols.map(c => `"${c}"`).join(', ');
        const placeholders = cols.map(() => '?').join(', ');
        const args = cols.map(c => (prof as any)[c] !== undefined ? (prof as any)[c] : null);
        await localDb.run(
          `INSERT OR REPLACE INTO profiles (${colNames}) VALUES (${placeholders})`,
          args
        );
      }
      console.log(`[BackgroundSync] Synced ${remoteProfiles.rows.length} user profile(s) from Turso Cloud.`);
    }
  } catch (profErr: any) {
    console.warn('[BackgroundSync] Notice during remote profiles sync:', profErr?.message);
  }

  // 2. Pull remote products catalogue updates
  try {
    const remoteProducts = await tursoClient.execute('SELECT * FROM products ORDER BY created_at DESC LIMIT 200');
    if (remoteProducts?.rows?.length > 0) {
      for (const prod of remoteProducts.rows) {
        const cols = Object.keys(prod);
        const colNames = cols.map(c => `"${c}"`).join(', ');
        const placeholders = cols.map(() => '?').join(', ');
        const args = cols.map(c => (prod as any)[c] !== undefined ? (prod as any)[c] : null);
        await localDb.run(
          `INSERT OR REPLACE INTO products (${colNames}) VALUES (${placeholders})`,
          args
        );
      }
    }
  } catch (prodErr: any) {
    console.warn('[BackgroundSync] Notice during remote products sync:', prodErr?.message);
  }
}

/**
 * Startup & periodic catalog reconciliation:
 * Scans local products, categories, and suppliers in local SQLite (hardware.db).
 * If records exist locally that are not yet recorded on Turso Cloud,
 * pushes them directly upstream to ensure catalog consistency across web and desktop.
 */
export async function reconcileLocalCatalogWithCloud(localDb: any, tursoClient: Client | null): Promise<void> {
  if (!localDb || !tursoClient) return;

  // 1. Categories reconciliation
  try {
    const localCats = await localDb.all('SELECT * FROM categories');
    if (localCats && localCats.length > 0) {
      const cloudRes = await tursoClient.execute('SELECT id FROM categories');
      const cloudIds = new Set((cloudRes?.rows || []).map(r => String(r.id)));
      for (const cat of localCats) {
        if (!cloudIds.has(String(cat.id))) {
          const cols = Object.keys(cat);
          const colNames = cols.map(c => `"${c}"`).join(', ');
          const placeholders = cols.map(() => '?').join(', ');
          const args = cols.map(c => (cat as any)[c] !== undefined ? (cat as any)[c] : null);
          await tursoClient.execute({
            sql: `INSERT OR REPLACE INTO categories (${colNames}) VALUES (${placeholders})`,
            args
          });
        }
      }
    }
  } catch (catErr: any) {
    console.warn('[Reconciliation] Notice reconciling categories:', catErr?.message);
  }

  // 2. Suppliers reconciliation
  try {
    const localSups = await localDb.all('SELECT * FROM suppliers');
    if (localSups && localSups.length > 0) {
      const cloudRes = await tursoClient.execute('SELECT id FROM suppliers');
      const cloudIds = new Set((cloudRes?.rows || []).map(r => String(r.id)));
      for (const sup of localSups) {
        if (!cloudIds.has(String(sup.id))) {
          const cols = Object.keys(sup);
          const colNames = cols.map(c => `"${c}"`).join(', ');
          const placeholders = cols.map(() => '?').join(', ');
          const args = cols.map(c => (sup as any)[c] !== undefined ? (sup as any)[c] : null);
          await tursoClient.execute({
            sql: `INSERT OR REPLACE INTO suppliers (${colNames}) VALUES (${placeholders})`,
            args
          });
        }
      }
    }
  } catch (supErr: any) {
    console.warn('[Reconciliation] Notice reconciling suppliers:', supErr?.message);
  }

  // 3. Products catalog reconciliation (e.g. Drills, Paint, Pipes, Hammer, Pliers)
  try {
    const localProds = await localDb.all('SELECT * FROM products');
    if (localProds && localProds.length > 0) {
      const cloudRes = await tursoClient.execute('SELECT id, sku FROM products');
      const cloudIds = new Set((cloudRes?.rows || []).map(r => String(r.id)));
      const cloudSkus = new Set((cloudRes?.rows || []).map(r => String(r.sku || '')));

      let pushed = 0;
      for (const prod of localProds) {
        const prodId = String(prod.id);
        const prodSku = String(prod.sku || '');
        if (!cloudIds.has(prodId) && (!prodSku || !cloudSkus.has(prodSku))) {
          const cols = Object.keys(prod);
          const colNames = cols.map(c => `"${c}"`).join(', ');
          const placeholders = cols.map(() => '?').join(', ');
          const args = cols.map(c => (prod as any)[c] !== undefined ? (prod as any)[c] : null);
          await tursoClient.execute({
            sql: `INSERT OR REPLACE INTO products (${colNames}) VALUES (${placeholders})`,
            args
          });
          cloudIds.add(prodId);
          if (prodSku) cloudSkus.add(prodSku);
          pushed++;
        }
      }
      if (pushed > 0) {
        console.log(`[Reconciliation] Successfully pushed ${pushed} local product(s) to Turso Cloud catalog.`);
      }
    }
  } catch (prodErr: any) {
    console.warn('[Reconciliation] Notice reconciling products:', prodErr?.message);
  }
}

export function startBackgroundSyncWorker(localDb: any, intervalMs = 30000): any {
  if (isWebClient) return null;

  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }

  console.log(`⏱️ [BackgroundSync] Starting automated 30s background sync worker...`);

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
