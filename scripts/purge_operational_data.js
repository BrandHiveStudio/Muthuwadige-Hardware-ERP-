import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@libsql/client';

dotenv.config();

// PROTECTED TABLES & VIEWS - NEVER TOUCH / PURGE
const STRICT_PROTECTED_TABLES = [
  'users',
  'roles',
  'profiles',
  'custom_permissions',
  'system_settings',
  'sqlite_master',
  'sqlite_sequence',
  'sqlite_stat1',
  'sqlite_stat2',
  'sqlite_stat3',
  'sqlite_stat4'
];

// Target operational tables and any operational data tables
const EXPLICIT_OPERATIONAL_TABLES = [
  // 1. Inventory & Products
  'products',
  'product_batches',
  'stock_adjustments',
  'inventory_logs',
  'categories',
  'product_categories',
  'product_conversions',
  'barcodes',

  // 2. Purchasing & Suppliers
  'purchase_orders',
  'purchase_order_items',
  'purchase_returns',
  'purchase_return_items',
  'purchases',
  'purchase_items',
  'suppliers',
  'supplier_ledger',
  'supplier_advances',
  'supplier_settlements',

  // 3. Sales & POS
  'sales',
  'sale_items',
  'sales_returns',
  'sales_return_items',
  'quotations',
  'quotation_items',
  'hold_bills',
  'bill_holds',
  'invoices',
  'receipts',
  'delivery_notes',
  'discounts',
  'promotions',
  'credit_notes',
  'credit_note_usage',

  // 4. Customers & Accounts
  'customers',
  'customer_ledger',
  'customer_credits',
  'credit_settlements',
  'credit_payments',
  'customer_transactions',
  'cheques',
  'cheque_registry',

  // 5. Finance & Sessions
  'transactions',
  'cash_drawers',
  'cash_drawer_logs',
  'cash_book',
  'daily_cash_flow',
  'shift_logs',
  'expenses',

  // 6. Sync & Audit Queues
  'sync_queue',
  'sync_logs',
  'offline_queue',
  'system_logs',
  'audit_logs',
  'backup_logs',
  'deleted_records',
  'employees'
];

async function purgeSqliteDb(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`[${label}] File not found at ${filePath}, skipping.`);
    return null;
  }
  console.log(`\n======================================================`);
  console.log(`[${label}] Purging database: ${filePath}`);
  console.log(`======================================================`);

  const db = await open({
    filename: filePath,
    driver: sqlite3.Database
  });

  // Get all real tables (not views, not system tables)
  const masterTables = await db.all("SELECT name, type FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const existingTableNames = masterTables.map(t => t.name);

  try {
    await db.run('PRAGMA foreign_keys = OFF;');
  } catch (_) {}

  // Determine tables to wipe: combine EXPLICIT_OPERATIONAL_TABLES and any table in DB that is not protected
  const wipedTables = [];
  for (const tbl of existingTableNames) {
    if (STRICT_PROTECTED_TABLES.includes(tbl)) {
      continue;
    }
    try {
      await db.run(`DELETE FROM "${tbl}"`);
      wipedTables.push(tbl);
      console.log(`  ✓ Cleared table: ${tbl}`);
    } catch (err) {
      console.warn(`  ! Notice on table ${tbl}:`, err.message);
    }
  }

  // Also iterate through EXPLICIT_OPERATIONAL_TABLES if any were missed
  for (const tbl of EXPLICIT_OPERATIONAL_TABLES) {
    if (!wipedTables.includes(tbl) && !STRICT_PROTECTED_TABLES.includes(tbl)) {
      try {
        await db.run(`DELETE FROM "${tbl}"`);
        wipedTables.push(tbl);
        console.log(`  ✓ Cleared table: ${tbl}`);
      } catch (err) {
        if (!err.message.includes('no such table') && !err.message.includes('cannot modify') && !err.message.includes('view')) {
          console.warn(`  ! Notice on ${tbl}:`, err.message);
        }
      }
    }
  }

  // Reset sqlite_sequence entries for wiped tables
  try {
    if (wipedTables.length > 0) {
      const placeholders = wipedTables.map(t => `'${t}'`).join(',');
      await db.run(`DELETE FROM sqlite_sequence WHERE name IN (${placeholders})`);
      console.log(`  ✓ Cleared sqlite_sequence for ${wipedTables.length} operational tables`);
    }
  } catch (err) {
    if (!err.message.includes('no such table')) {
      console.warn('  ! Notice resetting sqlite_sequence:', err.message);
    }
  }

  // Reset sync metadata & counters in system_settings if table exists
  try {
    const hasSysSettings = existingTableNames.includes('system_settings');
    if (hasSysSettings) {
      await db.run(`
        UPDATE system_settings 
        SET next_invoice_number = 'POS1-INV-00001',
            counter_pending_count = 0,
            last_counter_sync_timestamp = NULL,
            last_sync_timestamp = NULL
        WHERE id = 'global' OR 1=1
      `);
      console.log(`  ✓ Reset system_settings sync counters & next_invoice_number`);
    }
  } catch (err) {
    console.warn('  ! Notice updating system_settings:', err.message);
  }

  try {
    await db.run('PRAGMA foreign_keys = ON;');
  } catch (_) {}

  // Run VACUUM
  try {
    await db.run('VACUUM;');
    console.log(`  ✓ Database VACUUM complete.`);
  } catch (err) {
    console.warn(`  ! VACUUM notice:`, err.message);
  }

  // Collect verification counts
  const report = {};
  for (const tbl of existingTableNames) {
    try {
      const row = await db.get(`SELECT count(*) as count FROM "${tbl}"`);
      report[tbl] = row?.count ?? 0;
    } catch {
      report[tbl] = 'ERR';
    }
  }

  await db.close();
  return report;
}

async function purgeTursoCloud() {
  const dbUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!dbUrl || !authToken) {
    console.warn('⚠️ TURSO_DATABASE_URL or TURSO_AUTH_TOKEN missing in .env. Skipping cloud purge.');
    return null;
  }

  console.log(`\n======================================================`);
  console.log(`[Turso Cloud] Purging remote database: ${dbUrl}`);
  console.log(`======================================================`);

  const turso = createClient({ url: dbUrl, authToken });

  // Get remote tables
  let remoteTables = [];
  try {
    const res = await turso.execute("SELECT name, type FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    remoteTables = res.rows.map(r => r.name);
  } catch (err) {
    console.warn('  ! Could not fetch remote sqlite_master tables, using explicit list:', err.message);
    remoteTables = EXPLICIT_OPERATIONAL_TABLES;
  }

  const wipedTables = [];
  for (const tbl of remoteTables) {
    if (STRICT_PROTECTED_TABLES.includes(tbl)) {
      continue;
    }
    try {
      await turso.execute(`DELETE FROM "${tbl}"`);
      wipedTables.push(tbl);
      console.log(`  ✓ Cleared remote table: ${tbl}`);
    } catch (err) {
      if (!err.message.includes('no such table') && !err.message.includes('cannot modify') && !err.message.includes('view')) {
        console.warn(`  ! Notice on remote ${tbl}:`, err.message);
      }
    }
  }

  for (const tbl of EXPLICIT_OPERATIONAL_TABLES) {
    if (!wipedTables.includes(tbl) && !STRICT_PROTECTED_TABLES.includes(tbl)) {
      try {
        await turso.execute(`DELETE FROM "${tbl}"`);
        wipedTables.push(tbl);
        console.log(`  ✓ Cleared remote table: ${tbl}`);
      } catch (err) {
        if (!err.message.includes('no such table') && !err.message.includes('cannot modify') && !err.message.includes('view')) {
          console.warn(`  ! Notice on remote ${tbl}:`, err.message);
        }
      }
    }
  }

  // Clear sqlite_sequence on Turso
  try {
    if (wipedTables.length > 0) {
      const placeholders = wipedTables.map(t => `'${t}'`).join(',');
      await turso.execute(`DELETE FROM sqlite_sequence WHERE name IN (${placeholders})`);
      console.log(`  ✓ Cleared remote sqlite_sequence for operational tables`);
    }
  } catch (err) {
    if (!err.message.includes('no such table')) {
      console.warn('  ! Notice resetting remote sqlite_sequence:', err.message);
    }
  }

  // Reset remote system_settings sync counters
  try {
    await turso.execute(`
      UPDATE system_settings 
      SET next_invoice_number = 'POS1-INV-00001',
          counter_pending_count = 0,
          last_counter_sync_timestamp = NULL,
          last_sync_timestamp = NULL
      WHERE id = 'global' OR 1=1
    `);
    console.log(`  ✓ Reset remote system_settings sync counters`);
  } catch (_) {}

  // Collect remote verification counts
  const report = {};
  for (const tbl of remoteTables) {
    try {
      const res = await turso.execute(`SELECT count(*) as count FROM "${tbl}"`);
      report[tbl] = res?.rows?.[0]?.count ?? 0;
    } catch {
      report[tbl] = 'ERR';
    }
  }

  return report;
}

async function main() {
  console.log('🚀 [DATABASE RESET] Executing Operational Data Purge (Local & Remote Cloud)...');

  // 1. Workspace local SQLite (hardware.db)
  const workspaceDb = path.resolve('hardware.db');
  const wsReport = await purgeSqliteDb(workspaceDb, 'Workspace SQLite');

  // 2. User AppData local SQLite
  const appDataDb = path.join(
    process.env.APPDATA || 'C:\\Users\\lipca\\AppData\\Roaming',
    'Muthuwadige Hardware ERP',
    'hardware.db'
  );
  const appDataReport = await purgeSqliteDb(appDataDb, 'AppData Roaming SQLite');

  // 3. Turso Remote Cloud
  const tursoReport = await purgeTursoCloud();

  console.log('\n========================================================================');
  console.log('📊 FINAL AUDIT VERIFICATION');
  console.log('========================================================================');

  const checkKeys = [
    'users',
    'roles',
    'profiles',
    'custom_permissions',
    'products',
    'product_batches',
    'stock_adjustments',
    'inventory_logs',
    'categories',
    'purchase_orders',
    'purchase_order_items',
    'purchase_returns',
    'purchase_return_items',
    'suppliers',
    'supplier_ledger',
    'supplier_advances',
    'sales',
    'sale_items',
    'sales_returns',
    'sales_return_items',
    'quotations',
    'quotation_items',
    'hold_bills',
    'bill_holds',
    'customers',
    'customer_ledger',
    'customer_credits',
    'credit_settlements',
    'cheque_registry',
    'transactions',
    'cash_drawers',
    'cash_drawer_logs',
    'expenses',
    'sync_queue',
    'sync_logs',
    'offline_queue',
    'system_logs',
    'audit_logs'
  ];

  const summary = [];
  for (const key of checkKeys) {
    const isProtected = STRICT_PROTECTED_TABLES.includes(key);
    const wsVal = wsReport ? wsReport[key] : 'N/A';
    const appVal = appDataReport ? appDataReport[key] : 'N/A';
    const tursoVal = tursoReport ? tursoReport[key] : 'N/A';

    let status = '✓ Clean (0)';
    if (isProtected) {
      status = (wsVal > 0 || wsVal === 0) ? '✓ Preserved' : 'N/A';
    } else {
      const allZeroOrNA = (wsVal === 0 || wsVal === undefined) &&
                          (appVal === 0 || appVal === undefined) &&
                          (tursoVal === 0 || tursoVal === undefined);
      status = allZeroOrNA ? '✓ Clean (0)' : '❌ Non-Zero';
    }

    summary.push({
      Table: key,
      Classification: isProtected ? 'PROTECTED (Preserved)' : 'OPERATIONAL (Wiped)',
      'Workspace SQLite': wsVal !== undefined ? wsVal : '-',
      'AppData SQLite': appVal !== undefined ? appVal : '-',
      'Turso Cloud': tursoVal !== undefined ? tursoVal : '-',
      Status: status
    });
  }

  console.table(summary);

  // Check specific users
  const db = await open({ filename: workspaceDb, driver: sqlite3.Database });
  const userRows = await db.all('SELECT * FROM users');
  console.log('\n🔒 Preserved User Accounts in Workspace SQLite:');
  console.table(userRows);

  const profileRows = await db.all('SELECT * FROM profiles');
  console.log('\n🔒 Preserved User Profiles in Workspace SQLite:');
  console.table(profileRows);

  await db.close();
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
