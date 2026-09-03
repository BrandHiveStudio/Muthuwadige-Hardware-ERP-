import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { getTursoClient, FALLBACK_TURSO_DATABASE_URL, FALLBACK_TURSO_AUTH_TOKEN } from '../src/db/connection.js';
import { createClient } from '@libsql/client';

const TABLES_TO_TRUNCATE = [
  'sales',
  'sale_items',
  'customer_transactions',
  'products',
  'customers',
  'suppliers',
  'categories',
  'sync_queue',
  'audit_logs',
  'discounts',
  'promotions',
  'credit_payments',
  'credit_settlements',
  'transactions',
  'stock_adjustments',
  'purchase_orders',
  'purchase_returns',
  'purchase_return_items',
  'sales_returns',
  'quotations',
  'delivery_notes',
  'cheques',
  'cheque_registry',
  'bill_holds',
  'backup_logs',
  'credit_notes',
  'credit_note_usage',
  'employees'
];

async function resetSqliteDb(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.log(`[${label}] File not found at ${filePath}, skipping.`);
    return;
  }
  console.log(`\n========================================`);
  console.log(`[${label}] Wiping local database: ${filePath}`);
  console.log(`========================================`);

  const db = await open({
    filename: filePath,
    driver: sqlite3.Database
  });

  for (const table of TABLES_TO_TRUNCATE) {
    try {
      await db.run(`DELETE FROM "${table}"`);
      console.log(`  ✓ Truncated table: ${table}`);
    } catch (err) {
      if (err.message.includes('no such table')) {
        // Table doesn't exist, which is fine
      } else {
        console.warn(`  ! Notice truncating ${table}:`, err.message);
      }
    }
  }

  // Wipe profiles except sanojhardware@gmail.com
  try {
    const res = await db.run(
      "DELETE FROM profiles WHERE id != 'u1' AND LOWER(email) != 'sanojhardware@gmail.com'"
    );
    console.log(`  ✓ Pruned extra profiles. Remaining accounts: 1 (sanojhardware@gmail.com)`);
  } catch (err) {
    console.warn('  ! Error cleaning profiles:', err.message);
  }

  // Reset system_settings
  try {
    await db.run(
      "UPDATE system_settings SET counter_pending_count = 0, last_counter_sync_timestamp = NULL, last_sync_timestamp = NULL WHERE id = 'global' OR 1=1"
    );
    console.log(`  ✓ Reset system_settings sync counters to 0 / NULL`);
  } catch (err) {
    console.warn('  ! Error resetting system_settings:', err.message);
  }

  // Verification counts
  const prodCount = await db.get("SELECT COUNT(*) as count FROM products").catch(() => ({ count: 0 }));
  const salesCount = await db.get("SELECT COUNT(*) as count FROM sales").catch(() => ({ count: 0 }));
  const profCount = await db.get("SELECT COUNT(*) as count FROM profiles").catch(() => ({ count: 0 }));

  console.log(`  📊 Verification [${label}]:`);
  console.log(`     - Products count: ${prodCount?.count}`);
  console.log(`     - Sales count:    ${salesCount?.count}`);
  console.log(`     - Profiles count: ${profCount?.count}`);

  await db.close();
}

async function resetTursoCloud() {
  console.log(`\n========================================`);
  console.log(`[Turso Cloud] Wiping cloud database...`);
  console.log(`========================================`);

  let turso = getTursoClient();
  if (!turso) {
    const url = process.env.TURSO_DATABASE_URL || FALLBACK_TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN || FALLBACK_TURSO_AUTH_TOKEN;
    turso = createClient({ url, authToken });
  }

  for (const table of TABLES_TO_TRUNCATE) {
    try {
      await turso.execute(`DELETE FROM "${table}"`);
      console.log(`  ✓ Truncated remote table: ${table}`);
    } catch (err) {
      if (err.message.includes('no such table')) {
        // Table doesn't exist
      } else {
        console.warn(`  ! Notice truncating remote ${table}:`, err.message);
      }
    }
  }

  // Wipe profiles except sanojhardware@gmail.com
  try {
    await turso.execute("DELETE FROM profiles WHERE id != 'u1' AND LOWER(email) != 'sanojhardware@gmail.com'");
    console.log(`  ✓ Pruned extra remote profiles. Remaining accounts: 1 (sanojhardware@gmail.com)`);
  } catch (err) {
    console.warn('  ! Error cleaning remote profiles:', err.message);
  }

  // Reset system_settings
  try {
    await turso.execute(
      "UPDATE system_settings SET counter_pending_count = 0, last_counter_sync_timestamp = NULL, last_sync_timestamp = NULL WHERE id = 'global' OR 1=1"
    );
    console.log(`  ✓ Reset remote system_settings sync counters to 0 / NULL`);
  } catch (err) {
    console.warn('  ! Error resetting remote system_settings:', err.message);
  }

  // Verification counts
  const prodRes = await turso.execute("SELECT COUNT(*) as count FROM products").catch(() => ({ rows: [{ count: 0 }] }));
  const salesRes = await turso.execute("SELECT COUNT(*) as count FROM sales").catch(() => ({ rows: [{ count: 0 }] }));
  const profRes = await turso.execute("SELECT COUNT(*) as count FROM profiles").catch(() => ({ rows: [{ count: 0 }] }));

  console.log(`  📊 Verification [Turso Cloud]:`);
  console.log(`     - Products count: ${prodRes?.rows?.[0]?.count}`);
  console.log(`     - Sales count:    ${salesRes?.rows?.[0]?.count}`);
  console.log(`     - Profiles count: ${profRes?.rows?.[0]?.count}`);
}

async function main() {
  console.log('🧹 Starting Complete Database Reset (Baseline Zero)...');

  // 1. Workspace SQLite
  const workspaceDb = path.resolve('hardware.db');
  await resetSqliteDb(workspaceDb, 'Workspace SQLite');

  // 2. AppData SQLite
  const appDataDb = path.join(
    process.env.APPDATA || 'C:\\Users\\lipca\\AppData\\Roaming',
    'Muthuwadige Hardware ERP',
    'hardware.db'
  );
  await resetSqliteDb(appDataDb, 'AppData SQLite');

  // 3. Turso Cloud
  await resetTursoCloud();

  console.log('\n✨ Database wipe to baseline zero complete across all local and cloud targets.');
}

main().catch(err => {
  console.error('Fatal reset error:', err);
  process.exit(1);
});
