import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();

const TABLES_TO_WIPE = [
  'sales',
  'sale_items',
  'sales_returns',
  'sales_return_items',
  'products',
  'stock_adjustments',
  'product_categories',
  'product_conversions',
  'barcodes',
  'purchases',
  'purchase_items',
  'purchase_orders',
  'purchase_order_items',
  'purchase_returns',
  'purchase_return_items',
  'transactions',
  'cash_book',
  'cheque_registry',
  'credit_payments',
  'daily_cash_flow',
  'expenses',
  'customers',
  'suppliers',
  'quotations',
  'quotation_items',
  'sync_queue',
  'sync_logs',
  'audit_logs',
  'customer_transactions',
  'credit_notes',
  'credit_note_usage',
  'debit_notes',
  'delivery_notes',
  'bill_holds',
  'backup_logs',
  'shift_logs',
  'deleted_records',
  'scanner_signals',
  'employees',
  'branches'
];

const PRESERVED_TABLES = [
  'users',
  'roles',
  'profiles',
  'custom_permissions'
];

async function wipeSqlite(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`[${label}] File does not exist at "${filePath}", skipping.`);
    return null;
  }

  console.log(`\n======================================================`);
  console.log(`[${label}] Starting Database Clean Wipe: ${filePath}`);
  console.log(`======================================================`);

  const db = await open({
    filename: filePath,
    driver: sqlite3.Database
  });

  // Enable foreign keys OFF during wipe to prevent order constraints
  await db.run('PRAGMA foreign_keys = OFF');

  for (const table of TABLES_TO_WIPE) {
    try {
      await db.run(`DELETE FROM "${table}"`);
      // Reset autoincrement sequence if sqlite_sequence exists
      try {
        await db.run(`DELETE FROM sqlite_sequence WHERE name = ?`, [table]);
      } catch (_) {}
      console.log(`  ✓ Wiped table: ${table}`);
    } catch (err) {
      if (!err.message.includes('no such table')) {
        console.warn(`  ! Warning wiping ${table}:`, err.message);
      }
    }
  }

  // Reset system_settings sync counters
  try {
    await db.run(
      "UPDATE system_settings SET counter_pending_count = 0, last_counter_sync_timestamp = NULL, last_sync_timestamp = NULL WHERE id = 'global' OR 1=1"
    );
    console.log(`  ✓ Reset system_settings sync counters to 0 / NULL`);
  } catch (err) {
    if (!err.message.includes('no such table')) {
      console.warn(`  ! Warning resetting system_settings:`, err.message);
    }
  }

  // Reset sync_pull_marker
  try {
    await db.run("UPDATE sync_pull_marker SET last_pull_timestamp = 0 WHERE 1=1");
    console.log(`  ✓ Reset sync_pull_marker`);
  } catch (_) {}

  // Clear audit_logs and sync_queue after system_settings triggers to ensure exactly 0 rows
  try {
    await db.run('DELETE FROM audit_logs');
    await db.run('DELETE FROM sync_queue');
    console.log(`  ✓ Cleared audit_logs and sync_queue to 0`);
  } catch (_) {}

  // Run VACUUM
  try {
    await db.run('VACUUM');
  } catch (_) {}

  // Fetch counts
  const results = {};
  for (const table of [...PRESERVED_TABLES, ...TABLES_TO_WIPE]) {
    try {
      const res = await db.get(`SELECT COUNT(*) as c FROM "${table}"`);
      results[table] = res.c;
    } catch (err) {
      if (err.message.includes('no such table')) {
        results[table] = 'N/A';
      } else {
        results[table] = 'ERR';
      }
    }
  }

  await db.close();
  return results;
}

async function wipeTursoCloud() {
  console.log(`\n======================================================`);
  console.log(`[Turso Cloud] Starting Cloud Database Clean Wipe...`);
  console.log(`======================================================`);

  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error('TURSO_DATABASE_URL or TURSO_AUTH_TOKEN missing in environment!');
  }

  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });

  // Check if custom_permissions has rows in local workspace db to copy to Turso if empty
  const workspaceDb = path.resolve('hardware.db');
  if (fs.existsSync(workspaceDb)) {
    const localDb = await open({ filename: workspaceDb, driver: sqlite3.Database });
    const localPerms = await localDb.all('SELECT * FROM custom_permissions').catch(() => []);
    await localDb.close();

    if (localPerms.length > 0) {
      const tPermsRes = await turso.execute('SELECT COUNT(*) as c FROM custom_permissions').catch(() => ({ rows: [{ c: 0 }] }));
      if (Number(tPermsRes.rows[0].c) === 0) {
        console.log(`  -> Syncing ${localPerms.length} custom_permissions to Turso Cloud...`);
        for (const perm of localPerms) {
          await turso.execute({
            sql: 'INSERT OR REPLACE INTO custom_permissions (role, pages) VALUES (?, ?)',
            args: [perm.role, perm.pages]
          });
        }
        console.log(`  ✓ Preserved and populated custom_permissions in Turso Cloud`);
      }
    }
  }

  for (const table of TABLES_TO_WIPE) {
    try {
      await turso.execute(`DELETE FROM "${table}"`);
      try {
        await turso.execute({ sql: `DELETE FROM sqlite_sequence WHERE name = ?`, args: [table] });
      } catch (_) {}
      console.log(`  ✓ Wiped cloud table: ${table}`);
    } catch (err) {
      if (!err.message.includes('no such table')) {
        console.warn(`  ! Warning wiping cloud ${table}:`, err.message);
      }
    }
  }

  // Reset system_settings
  try {
    await turso.execute(
      "UPDATE system_settings SET counter_pending_count = 0, last_counter_sync_timestamp = NULL, last_sync_timestamp = NULL WHERE id = 'global' OR 1=1"
    );
    console.log(`  ✓ Reset cloud system_settings sync counters to 0 / NULL`);
  } catch (err) {
    if (!err.message.includes('no such table')) {
      console.warn(`  ! Warning resetting cloud system_settings:`, err.message);
    }
  }

  // Clear cloud audit_logs and sync_queue after system_settings reset to ensure exactly 0 rows
  try {
    await turso.execute('DELETE FROM audit_logs');
    await turso.execute('DELETE FROM sync_queue');
    console.log(`  ✓ Cleared cloud audit_logs and sync_queue to 0`);
  } catch (_) {}

  // Fetch counts
  const results = {};
  for (const table of [...PRESERVED_TABLES, ...TABLES_TO_WIPE]) {
    try {
      const res = await turso.execute(`SELECT COUNT(*) as c FROM "${table}"`);
      results[table] = res.rows[0].c;
    } catch (err) {
      if (err.message.includes('no such table')) {
        results[table] = 'N/A';
      } else {
        results[table] = 'ERR';
      }
    }
  }

  return results;
}

async function main() {
  console.log('🧹 EXECUTING COMPLETE DATABASE WIPE (PRESERVING USERS & ROLES)...');

  // 1. Workspace SQLite
  const workspaceDbPath = path.resolve('hardware.db');
  const workspaceResults = await wipeSqlite(workspaceDbPath, 'Workspace SQLite');

  // 2. AppData SQLite
  const appDataDbPath = path.join(
    process.env.APPDATA || 'C:\\Users\\lipca\\AppData\\Roaming',
    'Muthuwadige Hardware ERP',
    'hardware.db'
  );
  const appDataResults = await wipeSqlite(appDataDbPath, 'AppData SQLite');

  // 3. Turso Cloud
  const tursoResults = await wipeTursoCloud();

  // Print Summary Table
  console.log('\n\n========================================================================================');
  console.log('FINAL DATABASE VERIFICATION SUMMARY TABLE');
  console.log('========================================================================================');
  console.log(
    'Table Name'.padEnd(28) +
    'Category'.padEnd(16) +
    'Workspace DB'.padEnd(16) +
    'AppData DB'.padEnd(16) +
    'Turso Cloud'.padEnd(16)
  );
  console.log('-'.repeat(92));

  for (const table of PRESERVED_TABLES) {
    const ws = workspaceResults ? String(workspaceResults[table] ?? '-') : '-';
    const ad = appDataResults ? String(appDataResults[table] ?? '-') : 'Not Present';
    const tc = tursoResults ? String(tursoResults[table] ?? '-') : '-';
    console.log(
      table.padEnd(28) +
      'PRESERVED (>0)'.padEnd(16) +
      ws.padEnd(16) +
      ad.padEnd(16) +
      tc.padEnd(16)
    );
  }

  console.log('-'.repeat(92));

  for (const table of TABLES_TO_WIPE) {
    const ws = workspaceResults ? String(workspaceResults[table] ?? '-') : '-';
    const ad = appDataResults ? String(appDataResults[table] ?? '-') : 'Not Present';
    const tc = tursoResults ? String(tursoResults[table] ?? '-') : '-';
    console.log(
      table.padEnd(28) +
      'WIPED (=0)'.padEnd(16) +
      ws.padEnd(16) +
      ad.padEnd(16) +
      tc.padEnd(16)
    );
  }

  console.log('========================================================================================\n');
}

main().catch(err => {
  console.error('Fatal clean wipe error:', err);
  process.exit(1);
});
