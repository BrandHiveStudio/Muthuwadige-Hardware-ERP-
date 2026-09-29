import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@libsql/client';

dotenv.config();

const TABLES_TO_WIPE = [
  // Sales & Billing
  'sales',
  'sale_items',
  'sales_returns',
  'sales_return_items',
  'invoices',
  'receipts',
  'quotations',
  'quotation_items',
  'delivery_notes',
  'bill_holds',
  'discounts',
  'promotions',
  'credit_notes',
  'credit_note_usage',

  // Inventory & Products
  'products',
  'stock_adjustments',
  'product_categories',
  'product_conversions',
  'barcodes',
  'categories',

  // Purchasing
  'purchases',
  'purchase_items',
  'purchase_orders',
  'purchase_order_items',
  'purchase_returns',
  'purchase_return_items',

  // Financials & Ledger
  'transactions',
  'cash_book',
  'cheques',
  'cheque_registry',
  'credit_payments',
  'credit_settlements',
  'daily_cash_flow',
  'expenses',
  'customer_transactions',

  // Entities (preserving users, profiles, roles, custom_permissions)
  'customers',
  'suppliers',
  'employees',

  // Synchronization & Logs
  'sync_queue',
  'sync_logs',
  'audit_logs',
  'backup_logs'
];

const PRESERVED_TABLES = [
  'users',
  'profiles',
  'roles',
  'custom_permissions'
];

async function wipeSqlite(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`[${label}] File does not exist at ${filePath} — skipping.`);
    return null;
  }

  console.log(`\n========================================`);
  console.log(`[${label}] Wiping local database: ${filePath}`);
  console.log(`========================================`);

  const db = await open({
    filename: filePath,
    driver: sqlite3.Database
  });

  for (const table of TABLES_TO_WIPE) {
    try {
      await db.run(`DELETE FROM "${table}"`);
      console.log(`  ✓ Wiped table: ${table}`);
    } catch (err) {
      if (!err.message.includes('no such table')) {
        console.warn(`  ! Notice on ${table}:`, err.message);
      }
    }
  }

  // Reset sync tracking in system_settings if table exists
  try {
    await db.run(
      "UPDATE system_settings SET counter_pending_count = 0, last_counter_sync_timestamp = NULL, last_sync_timestamp = NULL WHERE id = 'global' OR 1=1"
    );
    console.log(`  ✓ Reset system_settings sync counters`);
  } catch (_) {}

  // Vacuum SQLite database
  try {
    await db.run("VACUUM;");
    console.log(`  ✓ Database VACUUM complete.`);
  } catch (err) {
    console.warn(`  ! VACUUM notice:`, err.message);
  }

  // Report counts
  const report = {};
  for (const table of PRESERVED_TABLES) {
    try {
      const res = await db.get(`SELECT COUNT(*) as count FROM "${table}"`);
      report[table] = res?.count ?? 'N/A';
    } catch {
      report[table] = 'Table not present';
    }
  }

  const sampleWiped = ['products', 'sales', 'transactions', 'customers', 'suppliers', 'sync_queue'];
  for (const table of sampleWiped) {
    try {
      const res = await db.get(`SELECT COUNT(*) as count FROM "${table}"`);
      report[table] = res?.count ?? 0;
    } catch {
      report[table] = 0;
    }
  }

  await db.close();
  return report;
}

async function wipeTurso() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (!tursoUrl || !tursoToken) {
    console.warn('[Turso Cloud] TURSO_DATABASE_URL or TURSO_AUTH_TOKEN missing in .env. Skipping cloud wipe.');
    return null;
  }

  console.log(`\n========================================`);
  console.log(`[Turso Cloud] Wiping cloud database: ${tursoUrl}`);
  console.log(`========================================`);

  const client = createClient({ url: tursoUrl, authToken: tursoToken });

  for (const table of TABLES_TO_WIPE) {
    try {
      await client.execute(`DELETE FROM "${table}"`);
      console.log(`  ✓ Wiped remote table: ${table}`);
    } catch (err) {
      if (!err.message.includes('no such table')) {
        console.warn(`  ! Notice on remote ${table}:`, err.message);
      }
    }
  }

  // Reset remote sync tracking in system_settings
  try {
    await client.execute(
      "UPDATE system_settings SET counter_pending_count = 0, last_counter_sync_timestamp = NULL, last_sync_timestamp = NULL WHERE id = 'global' OR 1=1"
    );
    console.log(`  ✓ Reset remote system_settings sync counters`);
  } catch (_) {}

  // Report counts
  const report = {};
  for (const table of PRESERVED_TABLES) {
    try {
      const res = await client.execute(`SELECT COUNT(*) as count FROM "${table}"`);
      report[table] = res?.rows?.[0]?.count ?? 'N/A';
    } catch {
      report[table] = 'Table not present';
    }
  }

  const sampleWiped = ['products', 'sales', 'transactions', 'customers', 'suppliers', 'sync_queue'];
  for (const table of sampleWiped) {
    try {
      const res = await client.execute(`SELECT COUNT(*) as count FROM "${table}"`);
      report[table] = res?.rows?.[0]?.count ?? 0;
    } catch {
      report[table] = 0;
    }
  }

  return report;
}

async function run() {
  console.log('🚀 Starting Clean Wipe (Preserving Users, Roles, and Permissions)...');

  // 1. Workspace SQLite
  const wsDbPath = path.resolve('hardware.db');
  const wsReport = await wipeSqlite(wsDbPath, 'Workspace SQLite');

  // 2. AppData SQLite
  const appDataDbPath = path.join(
    process.env.APPDATA || 'C:\\Users\\lipca\\AppData\\Roaming',
    'Muthuwadige Hardware ERP',
    'hardware.db'
  );
  const appDataReport = await wipeSqlite(appDataDbPath, 'AppData SQLite');

  // 3. Turso Cloud
  const tursoReport = await wipeTurso();

  console.log('\n========================================');
  console.log('📊 DATABASE CLEAN STATE VERIFICATION:');
  console.log('========================================');
  if (wsReport) {
    console.log('\n[Workspace SQLite]:');
    console.table(wsReport);
  }
  if (appDataReport) {
    console.log('\n[AppData SQLite]:');
    console.table(appDataReport);
  }
  if (tursoReport) {
    console.log('\n[Turso Cloud]:');
    console.table(tursoReport);
  }
}

run().catch(err => {
  console.error('Fatal clean wipe error:', err);
  process.exit(1);
});
