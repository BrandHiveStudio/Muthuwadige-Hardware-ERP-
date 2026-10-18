import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Preserved tables (Authentication, Logins, Role Definitions & Mappings)
export const PRESERVED_TABLES = [
  'users',
  'roles',
  'profiles',
  'custom_permissions'
];

// Operational, Master Entity, Ledger & Transaction tables to purge
export const TABLES_TO_PURGE = [
  // Child / Line items
  'sale_items',
  'sales_return_items',
  'purchase_items',
  'purchase_order_items',
  'purchase_return_items',
  'quotation_items',
  'credit_note_usage',

  // Master Entities
  'products',
  'product_categories',
  'product_conversions',
  'barcodes',
  'stock_adjustments',
  'customers',
  'suppliers',
  'supplier_ledger',
  'employees',
  'branches',

  // Operational & Ledger
  'sales',
  'sales_returns',
  'purchase_orders',
  'purchase_returns',
  'purchases',
  'quotations',
  'delivery_notes',
  'bill_holds',
  'transactions',
  'customer_transactions',
  'cash_book',
  'cheque_registry',
  'credit_payments',
  'credit_notes',
  'debit_notes',
  'daily_cash_flow',
  'expenses',
  'sessions',
  'shift_logs',
  'cash_drawers',
  'cash_transactions',

  // Sync, audit & temp state
  'sync_queue',
  'sync_logs',
  'sync_pull_marker',
  'audit_logs',
  'backup_logs',
  'deleted_records',
  'scanner_signals'
];

/**
 * Creates a safety backup of a SQLite file before modifying it.
 */
function backupSqliteFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.pre-reset-${timestamp}.bak`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`  🛡️ Backup created: ${backupPath}`);
  return backupPath;
}

/**
 * Purges and resets a local SQLite database file using an atomic transaction.
 */
export async function wipeSqliteDatabase(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`[${label}] File does not exist at "${filePath}", skipping.`);
    return null;
  }

  console.log(`\n======================================================================`);
  console.log(`[${label}] Executing Complete Wipe on: ${filePath}`);
  console.log(`======================================================================`);

  backupSqliteFile(filePath);

  const db = await open({
    filename: filePath,
    driver: sqlite3.Database
  });

  // Query existing tables
  const masterTables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const existingTableNames = new Set(masterTables.map(t => t.name));

  // 1. Disable foreign keys
  await db.run('PRAGMA foreign_keys = OFF');

  // 2. Begin atomic transaction
  await db.run('BEGIN TRANSACTION');

  try {
    for (const table of TABLES_TO_PURGE) {
      if (existingTableNames.has(table)) {
        await db.run(`DELETE FROM "${table}"`);
        console.log(`  ✓ Purged table: ${table}`);
      }
    }

    // Reset sqlite_sequence excluding preserved tables
    try {
      const preservedPlaceholders = PRESERVED_TABLES.map(() => '?').join(', ');
      await db.run(`DELETE FROM sqlite_sequence WHERE name NOT IN (${preservedPlaceholders})`, PRESERVED_TABLES);
      console.log(`  ✓ Reset auto-increment counters in sqlite_sequence (preserved: users/roles/profiles)`);
    } catch (err) {
      if (!err.message.includes('no such table')) {
        console.warn('  ! Notice on sqlite_sequence reset:', err.message);
      }
    }

    // Reset system_settings counters
    if (existingTableNames.has('system_settings')) {
      await db.run(`
        UPDATE system_settings 
        SET next_invoice_number = 'POS1-INV-00001',
            counter_pending_count = 0,
            last_counter_sync_timestamp = NULL,
            last_sync_timestamp = NULL
        WHERE id = 'global' OR 1=1
      `);
      console.log(`  ✓ Reset system_settings invoice counter & sync markers`);
    }

    // Reset sync_pull_marker if present
    if (existingTableNames.has('sync_pull_marker')) {
      await db.run("UPDATE sync_pull_marker SET last_pull_timestamp = 0 WHERE 1=1");
    }

    // Commit atomic transaction
    await db.run('COMMIT');
    console.log('  ✅ Atomic transaction COMMITTED successfully.');
  } catch (err) {
    await db.run('ROLLBACK');
    console.error('  ❌ Transaction ROLLED BACK due to error:', err);
    throw err;
  } finally {
    // 3. Re-enable foreign keys
    await db.run('PRAGMA foreign_keys = ON');
  }

  // 4. Run VACUUM to reclaim space
  try {
    await db.run('VACUUM');
    console.log('  ✓ Executed VACUUM to optimize pages and reclaim disk space.');
  } catch (err) {
    console.warn('  ! VACUUM notice:', err.message);
  }

  // Verification counts
  const counts = {};
  for (const table of masterTables.map(t => t.name)) {
    try {
      const res = await db.get(`SELECT COUNT(*) as c FROM "${table}"`);
      counts[table] = res.c;
    } catch {
      counts[table] = 'ERR';
    }
  }

  await db.close();
  return counts;
}

/**
 * Purges and resets the Turso Cloud remote database using atomic batch transactions.
 */
export async function wipeTursoCloudDatabase() {
  const dbUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!dbUrl || !authToken) {
    throw new Error('TURSO_DATABASE_URL or TURSO_AUTH_TOKEN is missing in environment variables.');
  }

  console.log(`\n======================================================================`);
  console.log(`[Turso Cloud] Executing Complete Wipe on Remote Database`);
  console.log(`Target: ${dbUrl}`);
  console.log(`======================================================================`);

  const turso = createClient({ url: dbUrl, authToken });

  // Discover remote tables
  const masterTablesRes = await turso.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%'");
  const existingTableNames = new Set(masterTablesRes.rows.map(r => r.name));

  // Pre-backup export of critical non-empty tables to JSON artifact
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const cloudSnapshotPath = path.resolve(`turso_cloud_backup_pre_reset_${timestamp}.json`);
  const snapshotData = {};

  for (const tableName of existingTableNames) {
    try {
      const r = await turso.execute(`SELECT * FROM "${tableName}"`);
      if (r.rows.length > 0) {
        snapshotData[tableName] = r.rows;
      }
    } catch (_) {}
  }
  fs.writeFileSync(cloudSnapshotPath, JSON.stringify(snapshotData, null, 2));
  console.log(`  🛡️ Cloud snapshot saved to: ${cloudSnapshotPath}`);

  // Build batch delete statements
  const batchStatements = [];

  for (const table of TABLES_TO_PURGE) {
    if (existingTableNames.has(table)) {
      batchStatements.push(`DELETE FROM "${table}"`);
    }
  }

  // Reset sequence
  const preservedQuotes = PRESERVED_TABLES.map(t => `'${t}'`).join(', ');
  batchStatements.push(`DELETE FROM sqlite_sequence WHERE name NOT IN (${preservedQuotes})`);

  // Reset system_settings
  if (existingTableNames.has('system_settings')) {
    batchStatements.push(`
      UPDATE system_settings 
      SET next_invoice_number = 'POS1-INV-00001',
          counter_pending_count = 0,
          last_counter_sync_timestamp = NULL,
          last_sync_timestamp = NULL
      WHERE id = 'global' OR 1=1
    `);
  }

  // Reset sync_pull_marker
  if (existingTableNames.has('sync_pull_marker')) {
    batchStatements.push("UPDATE sync_pull_marker SET last_pull_timestamp = 0 WHERE 1=1");
  }

  // Explicitly clear sync_queue and audit_logs in case of trigger writes
  if (existingTableNames.has('sync_queue')) {
    batchStatements.push("DELETE FROM sync_queue");
  }
  if (existingTableNames.has('audit_logs')) {
    batchStatements.push("DELETE FROM audit_logs");
  }

  console.log(`  Executing atomic batch with ${batchStatements.length} statements on Turso Cloud...`);
  await turso.batch(batchStatements, 'write');
  console.log('  ✅ Remote batch statements executed & committed successfully.');

  // Verification counts
  const counts = {};
  for (const tableName of existingTableNames) {
    try {
      const res = await turso.execute(`SELECT COUNT(*) as c FROM "${tableName}"`);
      counts[tableName] = Number(res.rows[0].c);
    } catch {
      counts[tableName] = 'ERR';
    }
  }

  return counts;
}

/**
 * Main execution function
 */
export async function runCompletePurge(options = {}) {
  const { wipeLocal = true, wipeCloud = true } = options;

  console.log('🧹 [RESET INITIALIZATION] Starting Complete Database Purge & Reset Protocol');
  console.log(`Preserved Tables: ${PRESERVED_TABLES.join(', ')}`);

  const results = {};

  if (wipeLocal) {
    // 1. Workspace Local DB
    const workspaceDbPath = path.resolve('hardware.db');
    results['Workspace SQLite'] = await wipeSqliteDatabase(workspaceDbPath, 'Workspace SQLite');

    // 2. AppData Roaming Local DB
    const appDataDbPath = path.join(
      process.env.APPDATA || 'C:\\Users\\lipca\\AppData\\Roaming',
      'Muthuwadige Hardware ERP',
      'hardware.db'
    );
    results['AppData SQLite'] = await wipeSqliteDatabase(appDataDbPath, 'AppData SQLite');
  }

  if (wipeCloud) {
    // 3. Turso Cloud
    results['Turso Cloud'] = await wipeTursoCloudDatabase();
  }

  // Compile Summary Audit Table
  console.log('\n\n========================================================================================');
  console.log('POST-WIPE COMPLETE VERIFICATION AUDIT MATRIX');
  console.log('========================================================================================');
  console.log(
    'Table Name'.padEnd(28) +
    'Target Category'.padEnd(20) +
    'Workspace DB'.padEnd(16) +
    'AppData DB'.padEnd(16) +
    'Turso Cloud'.padEnd(16)
  );
  console.log('-'.repeat(96));

  for (const table of PRESERVED_TABLES) {
    const ws = results['Workspace SQLite'] ? String(results['Workspace SQLite'][table] ?? 'N/A') : '-';
    const ad = results['AppData SQLite'] ? String(results['AppData SQLite'][table] ?? 'N/A') : '-';
    const tc = results['Turso Cloud'] ? String(results['Turso Cloud'][table] ?? 'N/A') : '-';
    console.log(
      table.padEnd(28) +
      'PRESERVED (>0)'.padEnd(20) +
      ws.padEnd(16) +
      ad.padEnd(16) +
      tc.padEnd(16)
    );
  }

  console.log('-'.repeat(96));

  for (const table of TABLES_TO_PURGE) {
    const ws = results['Workspace SQLite'] ? String(results['Workspace SQLite'][table] ?? 'N/A') : '-';
    const ad = results['AppData SQLite'] ? String(results['AppData SQLite'][table] ?? 'N/A') : '-';
    const tc = results['Turso Cloud'] ? String(results['Turso Cloud'][table] ?? 'N/A') : '-';
    if (ws !== 'N/A' || ad !== 'N/A' || tc !== 'N/A') {
      console.log(
        table.padEnd(28) +
        'WIPED (=0)'.padEnd(20) +
        ws.padEnd(16) +
        ad.padEnd(16) +
        tc.padEnd(16)
      );
    }
  }

  console.log('========================================================================================\n');
  return results;
}

// Allow direct execution via node
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCompletePurge().catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}
