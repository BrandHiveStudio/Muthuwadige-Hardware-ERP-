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
  'sales_return_items'
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
 * Execute a Turso query with a strict 5-second timeout to prevent UI/server hangs
 */
async function executeWithTimeout(tursoClient, sqlOrObj, timeoutMs = 15000) {
  const queryPromise = tursoClient.execute(sqlOrObj);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Query timeout after ${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([queryPromise, timeoutPromise]);
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
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          password TEXT,
          role TEXT,
          name TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch(_) {}
    try { await db.exec("ALTER TABLE system_settings ADD COLUMN last_counter_sync_timestamp TEXT;"); } catch(_) {}
    try { await db.exec("ALTER TABLE system_settings ADD COLUMN last_sync_timestamp TEXT;"); } catch(_) {}
    try { await db.exec("ALTER TABLE system_settings ADD COLUMN counter_sync_status TEXT DEFAULT 'IDLE';"); } catch(_) {}
    try { await db.exec("ALTER TABLE system_settings ADD COLUMN counter_pending_count INTEGER DEFAULT 0;"); } catch(_) {}
    try { await db.exec("ALTER TABLE products ADD COLUMN updated_at TEXT;"); } catch(_) {}
    try { await db.exec("ALTER TABLE products ADD COLUMN selling_price REAL;"); } catch(_) {}
    try { await db.exec("ALTER TABLE products ADD COLUMN stock_quantity REAL;"); } catch(_) {}
    try { await db.exec("ALTER TABLE customers ADD COLUMN updated_at TEXT;"); } catch(_) {}
    try { await db.exec("ALTER TABLE customers ADD COLUMN credit_limit REAL DEFAULT 0;"); } catch(_) {}
    try { await db.exec("ALTER TABLE customers ADD COLUMN credit_period INTEGER DEFAULT 0;"); } catch(_) {}
    try { await db.exec("ALTER TABLE customers ADD COLUMN type TEXT DEFAULT 'registered';"); } catch(_) {}
    try { await db.exec("ALTER TABLE suppliers ADD COLUMN updated_at TEXT;"); } catch(_) {}
    try { await db.exec("ALTER TABLE profiles ADD COLUMN updated_at TEXT;"); } catch(_) {}
    try { await db.exec("ALTER TABLE users ADD COLUMN updated_at TEXT;"); } catch(_) {}
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
  const nowIso = new Date().toISOString();

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

      if (item.action === 'DELETE') {
        statements.push({
          sql: `DELETE FROM "${targetTable}" WHERE id = ?`,
          args: [item.record_id]
        });
        successfulIds.push(item.id);
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

        statements.push({
          sql: `INSERT INTO "profiles" (${colNames}) VALUES (${placeholders})
                ON CONFLICT("id") ${conflictClause}`,
          args
        });
        successfulIds.push(item.id);
      } else if (row && typeof row === 'object' && targetTable === 'products') {
        // Enforce Cloud Wins (LWW) on Master Data:
        // Never allow an unmodified local product row to push up and overwrite newer cloud prices or stock counts.
        let cloudProd = null;
        try {
          const cRes = await executeWithTimeout(tursoClient, {
            sql: 'SELECT id, sku, price, selling_price, cost_price, stock, stock_quantity, updated_at, created_at FROM products WHERE id = ? OR sku = ? LIMIT 1',
            args: [item.record_id, row.sku || item.record_id]
          }, 3000);
          if (cRes?.rows?.[0]) cloudProd = cRes.rows[0];
        } catch (_) {}

        if (cloudProd) {
          const cloudPrice = Number(cloudProd.price !== undefined ? cloudProd.price : cloudProd.selling_price);
          const localPrice = Number(row.price !== undefined ? row.price : row.selling_price);
          const cloudCost = Number(cloudProd.cost_price !== undefined ? cloudProd.cost_price : 0);
          const localCost = Number(row.cost_price !== undefined ? row.cost_price : 0);
          const cloudStock = Number(cloudProd.stock !== undefined ? cloudProd.stock : cloudProd.stock_quantity);
          const localStock = Number(row.stock !== undefined ? row.stock : row.stock_quantity);

          const cloudUpdated = cloudProd.updated_at || cloudProd.created_at;
          const localUpdated = row.updated_at || row.created_at;
          const cloudTime = cloudUpdated ? new Date(cloudUpdated).getTime() : 0;
          const localTime = localUpdated ? new Date(localUpdated).getTime() : 0;

          // 1. If cloud product is newer, cloud wins! Do not push stale local data up.
          if (cloudTime > localTime) {
            console.log(`[BackgroundSync] Cloud Wins (LWW): Cloud product ${cloudProd.sku || item.record_id} is newer (${cloudUpdated} > ${localUpdated}). Skipping upstream push.`);
            try {
              await localDb.run(
                'UPDATE products SET price = ?, selling_price = ?, cost_price = ?, stock = ?, stock_quantity = ?, updated_at = ? WHERE id = ?',
                [cloudPrice, cloudPrice, cloudCost, cloudStock, cloudStock, cloudUpdated, row.id || item.record_id]
              );
            } catch (_) {}
            successfulIds.push(item.id);
            continue;
          }

          // 2. If unmodified local product (identical price, cost_price, and stock), skip upstream push
          if (cloudPrice === localPrice && cloudCost === localCost && cloudStock === localStock) {
            console.log(`[BackgroundSync] Skipping upstream push for unmodified product ${row.sku || item.record_id}.`);
            successfulIds.push(item.id);
            continue;
          }
        }

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

        statements.push({
          sql: `INSERT INTO "products" (${colNames}) VALUES (${placeholders})
                ON CONFLICT("sku") DO UPDATE SET
                  "stock" = excluded."stock",
                  "stock_quantity" = excluded."stock_quantity",
                  "price" = excluded."price",
                  "selling_price" = excluded."selling_price",
                  "cost_price" = excluded."cost_price",
                  "updated_at" = excluded."updated_at"`,
          args
        });
        successfulIds.push(item.id);
      } else if (row && typeof row === 'object') {
        const columns = Object.keys(row);
        const colNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        const args = columns.map(c => row[c] !== undefined ? row[c] : null);

        statements.push({
          sql: `INSERT OR REPLACE INTO "${targetTable}" (${colNames}) VALUES (${placeholders})`,
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

    // Purge processed items from local sync_queue
    if (successfulIds.length > 0) {
      const placeholders = successfulIds.map(() => '?').join(', ');
      await localDb.run(`DELETE FROM sync_queue WHERE id IN (${placeholders})`, successfulIds);
    }
    console.log(`[BackgroundSync] Successfully synced ${statements.length} record(s) to Turso Cloud.`);
  } else {
    if (!lastUpstreamSync) lastUpstreamSync = new Date().toISOString();
  }

  // Update remaining count & timestamps
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
        console.warn(`🚨 [SyncEngine] Cloud SYSTEM_WIPE_TIMESTAMP (${cloudWipeTimestamp}) > local (${localWipeTimestamp}). Executing Terminal Factory Reset...`);

        const tablesToWipe = [
          'sales', 'sale_items', 'sales_returns', 'sales_return_items',
          'transactions', 'credit_payments', 'cheque_registry',
          'purchase_orders', 'purchase_order_items', 'quotations', 'quotation_items',
          'customers', 'suppliers', 'products', 'categories'
        ];

        for (const t of tablesToWipe) {
          try {
            await localDb.run(`DELETE FROM "${t}";`);
          } catch (_) {}
        }

        // Clear local sync_queue completely
        try {
          await localDb.run('DELETE FROM sync_queue;');
        } catch (_) {}

        // Delete all non-root users from local SQLite
        try {
          await localDb.run("DELETE FROM users WHERE LOWER(email) != 'sanojhardware@gmail.com';");
          await localDb.run("DELETE FROM profiles WHERE LOWER(email) != 'sanojhardware@gmail.com';");
          await localDb.run("DELETE FROM custom_permissions WHERE user_id NOT IN (SELECT id FROM users WHERE LOWER(email) = 'sanojhardware@gmail.com');");
        } catch (_) {}

        // Record wipe timestamp in local SQLite system_settings and system_meta
        try {
          await localDb.run(
            "INSERT OR REPLACE INTO system_settings (id, key, value, system_wipe_timestamp) VALUES ('SYSTEM_WIPE_TIMESTAMP', 'SYSTEM_WIPE_TIMESTAMP', ?, ?)",
            [String(cloudWipeTimestamp), String(cloudWipeTimestamp)]
          );
          await localDb.run(
            "INSERT OR REPLACE INTO system_meta (key, value) VALUES ('SYSTEM_WIPE_TIMESTAMP', ?)",
            [String(cloudWipeTimestamp)]
          );
        } catch (_) {}

        globalThis.__systemWipeDetected = true;
        globalThis.__systemWipeTimestamp = cloudWipeTimestamp;
        console.log('✅ [SyncEngine] Terminal factory reset wipe completed successfully.');
      }
    }
  } catch (wipeErr) {
    console.warn('[SyncEngine] Notice checking SYSTEM_WIPE_TIMESTAMP:', wipeErr.message);
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

      const MASTER_TABLES = new Set(['products', 'categories', 'customers', 'suppliers', 'users', 'profiles']);
      const isMasterTable = MASTER_TABLES.has(tableName);

      const res = await executeWithTimeout(tursoClient, selectSql || `SELECT * FROM "${tableName}"`, 15000);
      const activeCloudIds = [];
      if (res?.rows && res.rows.length > 0) {
        for (const row of res.rows) {
          if (row[idCol] !== undefined && row[idCol] !== null) {
            activeCloudIds.push(String(row[idCol]));
          }

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
              let pendingOutbox = null;
              try {
                pendingOutbox = await localDb.get(
                  `SELECT id FROM sync_queue WHERE table_name = ? AND (record_id = ? OR record_id = ?) AND status = 'PENDING'`,
                  [tableName, String(row[idCol]), String(localRow[idCol])]
                );
              } catch (_) {}

              const cloudUpdated = row.updated_at || row.created_at;
              const localUpdated = localRow.updated_at || localRow.created_at;
              const cloudTime = cloudUpdated ? new Date(cloudUpdated).getTime() : 0;
              const localTime = localUpdated ? new Date(localUpdated).getTime() : 0;
              const isCloudNewerOrEqual = cloudTime >= localTime;

              // If local record has pending outbox changes AND local is newer, keep local; otherwise Cloud Wins!
              if (pendingOutbox && !isCloudNewerOrEqual) {
                continue;
              }
            }
          }

          if (tableName === 'products') {
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
                 "stock" = excluded."stock",
                 "stock_quantity" = excluded."stock_quantity",
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
      // Exclude local records that are currently awaiting upstream sync in sync_queue (offline creations)
      const tableFilter = tableName === 'transactions' ? "('transactions', 'cash_book')" : `('${tableName}')`;
      const pendingExclude = `AND "${idCol}" NOT IN (SELECT record_id FROM sync_queue WHERE table_name IN ${tableFilter} AND status = 'PENDING')`;
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
    syncAndPruneEntity('transactions', 'SELECT * FROM transactions ORDER BY created_at DESC LIMIT 1000')
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
export async function triggerPush(localDb) {
  if (!localDb || isWebClient) return;
  const tursoClient = getTursoClient();
  if (tursoClient) {
    return pushUpstreamChanges(localDb, tursoClient);
  }
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
