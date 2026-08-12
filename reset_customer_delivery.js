import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPaths = [
  path.join(__dirname, 'hardware.db'),
  path.join(process.env.APPDATA || '', 'hardware-erp', 'hardware.db'),
  path.join(process.env.APPDATA || '', 'Hardware Store', 'hardware.db')
].filter(p => fs.existsSync(p));

console.log('Found Database Files to Clean:', dbPaths);

async function resetDb(dbPath) {
  console.log(`\n🧹 Cleaning database at: ${dbPath}`);
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await db.exec('PRAGMA foreign_keys = OFF;');
  await db.run('BEGIN TRANSACTION;');

  const tablesToClear = [
    'sales',
    'sales_returns',
    'credit_payments',
    'credit_notes',
    'credit_note_usage',
    'transactions',
    'audit_logs',
    'bill_holds',
    'quotations',
    'delivery_notes',
    'purchase_orders',
    'products',
    'customers',
    'suppliers',
    'employees',
    'backup_logs',
    'stock_adjustments'
  ];

  for (const tbl of tablesToClear) {
    try {
      const res = await db.run(`DELETE FROM ${tbl}`);
      console.log(`  ✓ Cleared table '${tbl}' (${res.changes} rows deleted)`);
    } catch (e) {
      console.log(`  ℹ Table '${tbl}' skipped: ${e.message}`);
    }
  }

  try {
    await db.run("UPDATE system_settings SET next_invoice_number = 'INV001'");
    console.log("  ✓ Reset system_settings next_invoice_number to 'INV001'");
  } catch (e) {}

  // Ensure default admin user account exists
  try {
    await db.run(
      `INSERT OR REPLACE INTO profiles (id, name, email, role, avatar, password) 
       VALUES ('u1', 'Sanoj Hardware', 'sanojhardware@gmail.com', 'super_admin', 'S', 'sanoj123')`
    );
    await db.run(
      `INSERT OR REPLACE INTO profiles (id, name, email, role, avatar, password) 
       VALUES ('u2', 'Steven Clark', 'admin@hardware.com', 'admin', 'S', '123456')`
    );
    console.log("  ✓ Preserved super_admin and admin login profiles");
  } catch (e) {}

  await db.run('COMMIT;');
  await db.close();
  console.log(`✅ Database ${dbPath} successfully reset for customer delivery!`);
}

async function main() {
  for (const p of dbPaths) {
    await resetDb(p);
  }
  if (dbPaths.length === 0) {
    console.log('No existing database files found to clean.');
  }
}

main().catch(err => {
  console.error('❌ Data Reset Error:', err);
});
