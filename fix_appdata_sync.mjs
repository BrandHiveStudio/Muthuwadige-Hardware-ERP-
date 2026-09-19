import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

// 1. Load Workspace .env
dotenv.config();

const appDataDir = path.join(process.env.APPDATA || '', 'Muthuwadige Hardware ERP');
const appDataEnvPath = path.join(appDataDir, '.env');
const appDataDbPath = path.join(appDataDir, 'hardware.db');

console.log('==================================================');
console.log('STEP 1: INJECTING REAL CREDENTIALS INTO APPDATA');
console.log('==================================================');

if (!fs.existsSync('.env')) {
  console.error('[ERROR] Workspace .env file not found!');
  process.exit(1);
}

const workspaceEnv = fs.readFileSync('.env', 'utf8');
if (!fs.existsSync(appDataDir)) {
  fs.mkdirSync(appDataDir, { recursive: true });
}
fs.writeFileSync(appDataEnvPath, workspaceEnv, 'utf8');
console.log('Successfully wrote real credentials to:', appDataEnvPath);

console.log('\n==================================================');
console.log('STEP 2: DIRECT HYDRATION PULL FROM TURSO TO APPDATA');
console.log('==================================================');

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

const localDb = await open({ filename: appDataDbPath, driver: sqlite3.Database });

const tablesToHydrate = [
  'products',
  'suppliers',
  'customers',
  'purchase_orders',
  'purchase_order_items',
  'transactions',
  'app_settings',
  'system_settings'
];

for (const tableName of tablesToHydrate) {
  try {
    // Check if table exists in local SQLite
    const tableExists = await localDb.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      [tableName]
    );
    if (!tableExists) {
      console.log(`- Skipping ${tableName}: does not exist in local schema.`);
      continue;
    }

    const cloudRows = await turso.execute(`SELECT * FROM ${tableName}`);
    if (!cloudRows.rows || cloudRows.rows.length === 0) {
      console.log(`- ${tableName}: Cloud has 0 rows.`);
      continue;
    }

    const cols = cloudRows.columns;
    const placeholders = cols.map(() => '?').join(', ');
    const insertSql = `INSERT OR REPLACE INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`;

    await localDb.run('BEGIN TRANSACTION');
    let inserted = 0;
    for (const row of cloudRows.rows) {
      const values = cols.map(c => row[c]);
      await localDb.run(insertSql, values);
      inserted++;
    }
    await localDb.run('COMMIT');
    console.log(`- Successfully hydrated ${tableName}: ${inserted} rows pulled.`);
  } catch (err) {
    await localDb.run('ROLLBACK').catch(() => {});
    console.error(`- Error hydrating ${tableName}:`, err.message);
  }
}

const productCount = await localDb.get('SELECT COUNT(*) as count FROM products');
const poCount = await localDb.get('SELECT COUNT(*) as count FROM purchase_orders');

console.log('\n==================================================');
console.log('VERIFICATION: APPDATA DATABASE AFTER HYDRATION');
console.log('==================================================');
console.log('Local AppData Products count:        ', productCount.count);
console.log('Local AppData Purchase Orders count: ', poCount.count);

await localDb.close();
process.exit(0);
