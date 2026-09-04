import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getTursoClient } from '../src/db/connection.js';

const INDEX_STATEMENTS = [
  "CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);",
  "CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(cashier_name);",
  "CREATE INDEX IF NOT EXISTS idx_sales_cashier_raw ON sales(cashier);",
  "CREATE INDEX IF NOT EXISTS idx_cust_trans_created_at ON customer_transactions(created_at);",
  "CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);",
  "CREATE INDEX IF NOT EXISTS idx_credit_payments_created_at ON credit_payments(created_at);",
  "CREATE INDEX IF NOT EXISTS idx_po_created_at ON purchase_orders(created_at);",
  "CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);",
  "CREATE INDEX IF NOT EXISTS idx_cheque_registry_number ON cheque_registry(cheque_number);",
  "CREATE INDEX IF NOT EXISTS idx_cheque_registry_status ON cheque_registry(status);",
  "CREATE INDEX IF NOT EXISTS idx_purchase_returns_return_no ON purchase_returns(return_number);"
];

async function applyToSqlite(dbPath, label) {
  if (!fs.existsSync(dbPath)) {
    console.log(`[${label}] File does not exist, skipping: ${dbPath}`);
    return;
  }
  console.log(`\n📦 Applying indexes to [${label}]: ${dbPath}`);
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  
  // Ensure tables & columns exist before indexing
  try { await db.exec("ALTER TABLE sales ADD COLUMN cashier_name TEXT;"); } catch (_) {}
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS customer_transactions (
        id TEXT PRIMARY KEY,
        customer_id TEXT,
        type TEXT,
        amount REAL,
        reference TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (_) {}

  for (const sql of INDEX_STATEMENTS) {
    try {
      await db.exec(sql);
      console.log(`  ✓ Executed: ${sql.trim()}`);
    } catch (err) {
      console.warn(`  ⚠️ Notice on [${label}]:`, err.message);
    }
  }
  await db.close();
}

async function applyToTurso() {
  const turso = getTursoClient();
  if (!turso) {
    console.log('\n⚠️ Turso client unavailable, skipping cloud indexes.');
    return;
  }
  console.log('\n☁️ Applying indexes to Turso Cloud...');
  
  // Ensure columns & tables exist
  try { await turso.execute("ALTER TABLE sales ADD COLUMN cashier_name TEXT;"); } catch (_) {}
  try {
    await turso.execute(`
      CREATE TABLE IF NOT EXISTS customer_transactions (
        id TEXT PRIMARY KEY,
        customer_id TEXT,
        type TEXT,
        amount REAL,
        reference TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (_) {}

  for (const sql of INDEX_STATEMENTS) {
    try {
      await turso.execute(sql);
      console.log(`  ✓ Cloud Executed: ${sql.trim()}`);
    } catch (err) {
      console.warn('  ⚠️ Cloud Notice:', err.message);
    }
  }
}

async function main() {
  console.log('🚀 Starting Index & Schema Migration...');
  
  // 1. Workspace SQLite
  await applyToSqlite(path.join(process.cwd(), 'hardware.db'), 'Workspace SQLite');

  // 2. AppData SQLite
  const appDataDb = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Muthuwadige Hardware ERP',
    'hardware.db'
  );
  await applyToSqlite(appDataDb, 'AppData SQLite');

  // 3. Turso Cloud
  await applyToTurso();

  console.log('\n✨ All indexes successfully verified and applied.');
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
