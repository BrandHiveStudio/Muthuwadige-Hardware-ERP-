/**
 * Automated Background Sync Service for Muthuwadige Hardware ERP
 * Replicates local SQLite (hardware.db) mutations to Turso Cloud libSQL every 30 seconds.
 * 
 * Guarantees:
 * - 100% Offline-First: POS checkout NEVER waits on network calls.
 * - Zero Cashier Interruption: Network drops are tracked silently without UI alerts.
 */

import { getTursoClient } from '../db/connection.js';

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

/**
 * Check connectivity to Turso Cloud libSQL with a 4-second timeout
 */
export async function pingTurso(tursoClient) {
  if (!tursoClient) return false;
  try {
    const pingPromise = tursoClient.execute('SELECT 1 as ping');
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Turso ping timeout')), 4000)
    );
    await Promise.race([pingPromise, timeoutPromise]);
    return true;
  } catch (err) {
    return false;
  }
}

let schemaEnsured = false;
export async function ensureSyncSchema(db) {
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
    try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);"); } catch(_) {}
    try { await db.exec("ALTER TABLE system_settings ADD COLUMN last_counter_sync_timestamp TEXT;"); } catch(_) {}
    try { await db.exec("ALTER TABLE system_settings ADD COLUMN last_sync_timestamp TEXT;"); } catch(_) {}
    try { await db.exec("ALTER TABLE system_settings ADD COLUMN counter_sync_status TEXT DEFAULT 'IDLE';"); } catch(_) {}
    try { await db.exec("ALTER TABLE system_settings ADD COLUMN counter_pending_count INTEGER DEFAULT 0;"); } catch(_) {}
    schemaEnsured = true;
  } catch (e) {
    // best-effort schema bootstrap
  }
}

/**
 * Enqueue a database mutation into sync_queue
 */
export async function enqueueSync(db, tableName, recordId, action = 'INSERT', payload = null) {
  if (!db || isWebClient) return; // Web client writes directly to Turso
  await ensureSyncSchema(db);
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
  }
}

/**
 * Run a full sync cycle: Ping -> Push Pending Queue -> Pull Remote Updates -> Update Timestamps
 */
export async function runSyncCycle(localDb) {
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

  try {
    // Step B: Push Pending Queue to Turso Cloud
    const pendingItems = await localDb.all(
      "SELECT * FROM sync_queue WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 100"
    );

    if (pendingItems && pendingItems.length > 0) {
      console.log(`[BackgroundSync] Transmitting ${pendingItems.length} queued record(s) to Turso Cloud...`);
      const statements = [];
      const successfulIds = [];

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
          // If record no longer exists locally and action was insert/update, purge queue item
          successfulIds.push(item.id);
        }
      }

      if (statements.length > 0) {
        await tursoClient.batch(statements, 'write');
        lastUpstreamSync = new Date().toISOString();
      }

      // Purge processed items from local sync_queue
      if (successfulIds.length > 0) {
        const placeholders = successfulIds.map(() => '?').join(', ');
        await localDb.run(`DELETE FROM sync_queue WHERE id IN (${placeholders})`, successfulIds);
      }
      console.log(`[BackgroundSync] Successfully synced ${statements.length} record(s) to cloud.`);
    } else {
      if (!lastUpstreamSync) lastUpstreamSync = new Date().toISOString();
    }

    // Step C: Pull Remote Admin Updates from Cloud
    await pullDownstreamChanges(localDb, tursoClient);
    lastDownstreamSync = new Date().toISOString();

    // Step D: Update last_counter_sync_timestamp in both local and Cloud system_settings
    lastCounterSync = nowIso;
    lastSyncedAt = nowIso;

    let remainingPending = 0;
    try {
      const qCount = await localDb.get("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'");
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

  } catch (syncErr) {
    console.error('[BackgroundSync] Error during sync cycle:', syncErr.message);
  } finally {
    isSyncing = false;
  }
}

/**
 * Pull downstream changes from Turso Cloud to local SQLite (hardware.db)
 * Replicates newly created or updated profiles and product catalogue records.
 */
export async function pullDownstreamChanges(localDb, tursoClient) {
  if (!localDb || !tursoClient) return;

  // 1. Pull user profiles (ensures cloud web users are available for offline desktop login)
  try {
    const remoteProfiles = await tursoClient.execute('SELECT * FROM profiles');
    if (remoteProfiles?.rows?.length > 0) {
      for (const prof of remoteProfiles.rows) {
        const cols = Object.keys(prof);
        const colNames = cols.map(c => `"${c}"`).join(', ');
        const placeholders = cols.map(() => '?').join(', ');
        const args = cols.map(c => prof[c] !== undefined ? prof[c] : null);
        await localDb.run(
          `INSERT OR REPLACE INTO profiles (${colNames}) VALUES (${placeholders})`,
          args
        );
      }
      console.log(`[BackgroundSync] Synced ${remoteProfiles.rows.length} user profile(s) from Turso Cloud.`);
    }
  } catch (profErr) {
    console.warn('[BackgroundSync] Notice during remote profiles sync:', profErr.message);
  }

  // 2. Pull remote products catalogue updates
  try {
    const remoteProducts = await tursoClient.execute('SELECT * FROM products ORDER BY created_at DESC LIMIT 200');
    if (remoteProducts?.rows?.length > 0) {
      for (const prod of remoteProducts.rows) {
        const cols = Object.keys(prod);
        const colNames = cols.map(c => `"${c}"`).join(', ');
        const placeholders = cols.map(() => '?').join(', ');
        const args = cols.map(c => prod[c] !== undefined ? prod[c] : null);
        await localDb.run(
          `INSERT OR REPLACE INTO products (${colNames}) VALUES (${placeholders})`,
          args
        );
      }
    }
  } catch (prodErr) {
    console.warn('[BackgroundSync] Notice during remote products sync:', prodErr.message);
  }
}

/**
 * Start automated background sync worker (runs every 30 seconds)
 */
export function startBackgroundSyncWorker(localDb, intervalMs = 30000) {
  if (isWebClient) {
    console.log('🌐 [BackgroundSync] Web client environment detected. Background worker disabled (direct cloud queries).');
    return;
  }

  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }

  console.log(`⏱️ [BackgroundSync] Starting automated 30s background sync worker...`);

  // Run initial sync cycle after 3 seconds to let server initialize
  setTimeout(() => {
    runSyncCycle(localDb).catch(() => {});
  }, 3000);

  // Schedule recurring 30s cycle
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
