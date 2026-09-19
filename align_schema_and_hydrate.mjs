import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();

const appDataDir = path.join(process.env.APPDATA || '', 'Muthuwadige Hardware ERP');
const appDataDbPath = path.join(appDataDir, 'hardware.db');

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

const localDb = await open({ filename: appDataDbPath, driver: sqlite3.Database });

console.log('==================================================');
console.log('SCHEMA ALIGNMENT & FINAL HYDRATION');
console.log('==================================================');

const tablesToSync = [
  'suppliers',
  'purchase_orders',
  'system_settings'
];

for (const tableName of tablesToSync) {
  try {
    const tableExists = await localDb.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      [tableName]
    );
    if (!tableExists) {
      console.log(`- Skipping ${tableName}: not found in local SQLite.`);
      continue;
    }

    // 1. Fetch remote column metadata
    const cloudColsRes = await turso.execute(`PRAGMA table_info(${tableName})`);
    const localCols = await localDb.all(`PRAGMA table_info(${tableName})`);
    const localColNames = new Set(localCols.map(c => c.name));

    // 2. Add any missing columns to local SQLite
    for (const c of cloudColsRes.rows) {
      const colName = c.name;
      const colType = c.type || 'TEXT';
      if (!localColNames.has(colName)) {
        try {
          await localDb.run(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${colType}`);
          console.log(`+ Added missing column [${colName} ${colType}] to local ${tableName}`);
        } catch (e) {
          console.log(`! Note on adding [${colName}] to ${tableName}:`, e.message);
        }
      }
    }

    // 3. Hydrate data rows
    const cloudRows = await turso.execute(`SELECT * FROM ${tableName}`);
    if (!cloudRows.rows || cloudRows.rows.length === 0) {
      console.log(`- ${tableName}: Cloud has 0 rows.`);
      continue;
    }

    // Query updated local columns to ensure valid insert list
    const updatedLocalCols = await localDb.all(`PRAGMA table_info(${tableName})`);
    const validLocalColNames = new Set(updatedLocalCols.map(c => c.name));
    
    // Only insert columns that exist both in cloud and local
    const commonCols = cloudRows.columns.filter(col => validLocalColNames.has(col));
    const placeholders = commonCols.map(() => '?').join(', ');
    const insertSql = `INSERT OR REPLACE INTO ${tableName} (${commonCols.join(', ')}) VALUES (${placeholders})`;

    await localDb.run('BEGIN TRANSACTION');
    let inserted = 0;
    for (const row of cloudRows.rows) {
      const values = commonCols.map(c => row[c]);
      await localDb.run(insertSql, values);
      inserted++;
    }
    await localDb.run('COMMIT');
    console.log(`- Successfully hydrated ${tableName}: ${inserted} rows pulled.`);
  } catch (err) {
    await localDb.run('ROLLBACK').catch(() => {});
    console.error(`[ERROR] Processing ${tableName}:`, err.message);
  }
}

console.log('\n==================================================');
console.log('FINAL DATABASE VERIFICATION');
console.log('==================================================');
const pCount = await localDb.get('SELECT COUNT(*) as count FROM products');
const poCount = await localDb.get('SELECT COUNT(*) as count FROM purchase_orders');
const sCount = await localDb.get('SELECT COUNT(*) as count FROM suppliers');

console.log('- Local AppData Products:        ', pCount.count);
console.log('- Local AppData Purchase Orders: ', poCount.count);
console.log('- Local AppData Suppliers:       ', sCount.count);

await localDb.close();
process.exit(0);
