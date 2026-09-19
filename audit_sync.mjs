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
const localDbPath = path.resolve('hardware.db');

console.log('==================================================');
console.log('1. ENVIRONMENT & CONFIGURATION CHECK');
console.log('==================================================');
console.log('Workspace .env exists:      ', fs.existsSync('.env'));
console.log('AppData .env exists:        ', fs.existsSync(appDataEnvPath));
console.log('TURSO_DATABASE_URL loaded:  ', Boolean(process.env.TURSO_DATABASE_URL));
console.log('TURSO_AUTH_TOKEN loaded:     ', Boolean(process.env.TURSO_AUTH_TOKEN));

if (fs.existsSync(appDataEnvPath)) {
  const appDataEnvContent = fs.readFileSync(appDataEnvPath, 'utf8');
  console.log('\n--- AppData .env Sample ---');
  console.log(appDataEnvContent.split('\n').filter(l => l.includes('TURSO') || l.includes('PORT')).join('\n'));
} else {
  console.log('\n[CRITICAL WARNING] AppData .env DOES NOT EXIST at:', appDataEnvPath);
}

console.log('\n==================================================');
console.log('2. TURSO CLOUD GROUND TRUTH');
console.log('==================================================');
if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
  try {
    const turso = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN
    });
    const ping = await turso.execute('SELECT 1 as connected');
    console.log('Turso Connection Status:     ONLINE');

    const tables = ['products', 'purchase_orders', 'purchase_order_items', 'sales', 'transactions', 'sync_queue', 'deleted_records'];
    for (const t of tables) {
      try {
        const res = await turso.execute(`SELECT COUNT(*) as count FROM ${t}`);
        console.log(`- Turso Cloud [${t}]:`.padEnd(35), res.rows[0].count);
      } catch (err) {
        console.log(`- Turso Cloud [${t}]:`.padEnd(35), 'TABLE NOT FOUND / ERROR:', err.message);
      }
    }
  } catch (err) {
    console.log('[ERROR] Failed to connect to Turso Cloud:', err.message);
  }
} else {
  console.log('[ERROR] Cannot test Turso Cloud: credentials missing in process.env');
}

async function auditSqlite(label, dbPath) {
  console.log(`\n==================================================`);
  console.log(`3. LOCAL DATABASE AUDIT: ${label}`);
  console.log(`Path: ${dbPath}`);
  console.log(`==================================================`);
  if (!fs.existsSync(dbPath)) {
    console.log('[WARNING] Database file does not exist at path.');
    return;
  }
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  const tables = ['products', 'purchase_orders', 'purchase_order_items', 'sales', 'transactions', 'sync_queue', 'deleted_records'];
  for (const t of tables) {
    try {
      const res = await db.get(`SELECT COUNT(*) as count FROM ${t}`);
      console.log(`- ${label} [${t}]:`.padEnd(35), res.count);
    } catch (err) {
      console.log(`- ${label} [${t}]:`.padEnd(35), 'ERROR:', err.message);
    }
  }

  try {
    const queue = await db.all('SELECT table_name, action, status, count(*) as qty FROM sync_queue GROUP BY table_name, action, status');
    console.log(`- ${label} Sync Queue Breakdown:`, queue.length > 0 ? queue : 'EMPTY');
  } catch (e) {
    console.log(`- ${label} Sync Queue Read Error:`, e.message);
  }
  await db.close();
}

await auditSqlite('LOCAL REPO DB', localDbPath);
await auditSqlite('APPDATA INSTALLED DB', appDataDbPath);

console.log('\n==================================================');
console.log('4. RUNNING ELECTRON SERVER PING TEST');
console.log('==================================================');
try {
  const resp = await fetch('http://127.0.0.1:5001/api/sync/status').catch(() => null);
  if (resp) {
    const data = await resp.json();
    console.log('Port 5001 Sync Status Endpoint:', JSON.stringify(data, null, 2));
  } else {
    console.log('Local Server (127.0.0.1:5001) is currently NOT RUNNING or unreachable.');
  }
} catch (e) {
  console.log('Local Server Ping Error:', e.message);
}
process.exit(0);
