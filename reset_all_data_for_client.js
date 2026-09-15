import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@libsql/client';

dotenv.config();

const TABLES_TO_PURGE = [
  'sales',
  'sale_items',
  'products',
  'customers',
  'suppliers',
  'purchase_orders',
  'purchase_order_items',
  'supplier_settlements',
  'credit_payments',
  'credit_settlements',
  'stock_adjustments',
  'transactions',
  'shift_logs',
  'cheques',
  'cheque_registry',
  'quotations',
  'quotation_items',
  'delivery_notes',
  'bill_holds',
  'sync_queue',
  'sales_returns',
  'sales_return_items',
  'credit_notes',
  'credit_note_usage',
  'purchase_returns',
  'purchase_return_items',
  'customer_transactions',
  'audit_logs',
  'backup_logs',
  'categories',
  'discounts',
  'promotions'
];

async function purgeSqliteDb(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`[${label}] File not found at ${filePath}, skipping.`);
    return;
  }
  console.log(`\n======================================================`);
  console.log(`[${label}] Purging database: ${filePath}`);
  console.log(`======================================================`);

  const db = await open({
    filename: filePath,
    driver: sqlite3.Database
  });

  // 1. Purge all transaction and entity tables
  for (const table of TABLES_TO_PURGE) {
    try {
      await db.run(`DELETE FROM "${table}"`);
      console.log(`  ✓ Cleared table: ${table}`);
    } catch (err) {
      if (!err.message.includes('no such table')) {
        console.warn(`  ! Notice on ${table}:`, err.message);
      }
    }
  }

  // 2. Reset sqlite_sequence to start all auto-increments from 1
  try {
    await db.run('DELETE FROM sqlite_sequence');
    console.log(`  ✓ Reset sqlite_sequence counters to 0`);
  } catch (err) {
    if (!err.message.includes('no such table')) {
      console.warn('  ! Notice resetting sqlite_sequence:', err.message);
    }
  }

  // 3. Preserve admin profiles (store owner), remove test accounts
  try {
    await db.run(
      "DELETE FROM profiles WHERE id != 'u1' AND LOWER(email) NOT IN ('sanojhardware@gmail.com', 'krishleo439@gmail.com')"
    );
    await db.run(
      "DELETE FROM users WHERE id != 'u1' AND LOWER(email) NOT IN ('sanojhardware@gmail.com', 'krishleo439@gmail.com')"
    );
    console.log(`  ✓ Preserved store owner and admin credentials in profiles and users`);
  } catch (err) {
    console.warn('  ! Notice pruning profiles/users:', err.message);
  }

  // 4. Reset sequence and sync metadata in system_settings while preserving store branding
  try {
    await db.run(`
      UPDATE system_settings 
      SET next_invoice_number = 'POS1-INV-00001',
          counter_pending_count = 0,
          last_counter_sync_timestamp = NULL,
          last_sync_timestamp = NULL
      WHERE id = 'global' OR 1=1
    `);
    console.log(`  ✓ Reset next_invoice_number to POS1-INV-00001 and cleared sync timestamps`);
  } catch (err) {
    console.warn('  ! Notice updating system_settings:', err.message);
  }

  // 5. Verification Query
  const verifyQuery = `
    SELECT 'products' as tbl, count(*) as count FROM products
    UNION ALL SELECT 'customers', count(*) FROM customers
    UNION ALL SELECT 'sales', count(*) FROM sales
    UNION ALL SELECT 'system_settings', count(*) FROM system_settings
    UNION ALL SELECT 'profiles', count(*) FROM profiles;
  `;
  const counts = await db.all(verifyQuery).catch(() => []);
  console.log(`\n  📊 Verification [${label}]:`);
  console.table(counts);

  await db.close();
}

async function purgeTursoCloud() {
  const dbUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!dbUrl || !authToken) {
    console.warn('⚠️ TURSO_DATABASE_URL or TURSO_AUTH_TOKEN missing in .env. Skipping cloud purge.');
    return;
  }

  console.log(`\n======================================================`);
  console.log(`[Turso Cloud] Purging remote database: ${dbUrl}`);
  console.log(`======================================================`);

  const turso = createClient({ url: dbUrl, authToken });

  // 1. Purge remote tables
  for (const table of TABLES_TO_PURGE) {
    try {
      await turso.execute(`DELETE FROM "${table}"`);
      console.log(`  ✓ Cleared remote table: ${table}`);
    } catch (err) {
      if (!err.message.includes('no such table')) {
        console.warn(`  ! Notice on remote ${table}:`, err.message);
      }
    }
  }

  // 2. Reset sqlite_sequence on Turso Cloud
  try {
    await turso.execute('DELETE FROM sqlite_sequence');
    console.log(`  ✓ Reset remote sqlite_sequence counters to 0`);
  } catch (err) {
    if (!err.message.includes('no such table')) {
      console.warn('  ! Notice resetting remote sqlite_sequence:', err.message);
    }
  }

  // 3. Preserve admin profiles on Turso Cloud
  try {
    await turso.execute(
      "DELETE FROM profiles WHERE id != 'u1' AND LOWER(email) NOT IN ('sanojhardware@gmail.com', 'krishleo439@gmail.com')"
    );
    await turso.execute(
      "DELETE FROM users WHERE id != 'u1' AND LOWER(email) NOT IN ('sanojhardware@gmail.com', 'krishleo439@gmail.com')"
    );
    console.log(`  ✓ Preserved store owner and admin accounts on Turso Cloud`);
  } catch (err) {
    console.warn('  ! Notice pruning remote profiles/users:', err.message);
  }

  // 4. Reset sequence and sync metadata in system_settings on Turso Cloud
  try {
    await turso.execute(`
      UPDATE system_settings 
      SET next_invoice_number = 'POS1-INV-00001',
          counter_pending_count = 0,
          last_counter_sync_timestamp = NULL,
          last_sync_timestamp = NULL
      WHERE id = 'global' OR 1=1
    `);
    console.log(`  ✓ Reset remote next_invoice_number to POS1-INV-00001`);
  } catch (err) {
    console.warn('  ! Notice updating remote system_settings:', err.message);
  }

  // 5. Remote Verification Query
  const verifyQuery = `
    SELECT 'products' as tbl, count(*) as count FROM products
    UNION ALL SELECT 'customers', count(*) FROM customers
    UNION ALL SELECT 'sales', count(*) FROM sales
    UNION ALL SELECT 'system_settings', count(*) FROM system_settings
    UNION ALL SELECT 'profiles', count(*) FROM profiles;
  `;
  try {
    const res = await turso.execute(verifyQuery);
    console.log(`\n  📊 Verification [Turso Cloud]:`);
    console.table(res.rows);
  } catch (err) {
    console.warn('  ! Failed to query remote verification:', err.message);
  }
}

async function main() {
  console.log('✨ [SANIDATIZATION PROTOCOL] Starting Full Client Handover Database Purge...');

  // 1. Workspace local SQLite
  const workspaceDb = path.resolve('hardware.db');
  await purgeSqliteDb(workspaceDb, 'Workspace SQLite');

  // 2. User AppData local SQLite
  const appDataDb = path.join(
    process.env.APPDATA || 'C:\\Users\\lipca\\AppData\\Roaming',
    'Muthuwadige Hardware ERP',
    'hardware.db'
  );
  await purgeSqliteDb(appDataDb, 'AppData Roaming SQLite');

  // 3. Turso Cloud
  await purgeTursoCloud();

  console.log('\n🎉 [SUCCESS] Local SQLite and Turso Cloud databases have been cleanly purged to Baseline Zero!');
}

main().catch(err => {
  console.error('Fatal purge error:', err);
  process.exit(1);
});
