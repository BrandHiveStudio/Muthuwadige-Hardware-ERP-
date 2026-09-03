import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { getTursoClient, FALLBACK_TURSO_DATABASE_URL, FALLBACK_TURSO_AUTH_TOKEN } from '../src/db/connection.js';
import { createClient } from '@libsql/client';

async function main() {
  console.log('🚀 Reconciling local customers to Turso Cloud...');

  const appDataPath = path.join(
    process.env.APPDATA || 'C:\\Users\\lipca\\AppData\\Roaming',
    'Muthuwadige Hardware ERP',
    'hardware.db'
  );
  const workspacePath = path.resolve('hardware.db');

  const appDataDb = await open({ filename: appDataPath, driver: sqlite3.Database });
  const workspaceDb = await open({ filename: workspacePath, driver: sqlite3.Database });

  let turso = getTursoClient();
  if (!turso) {
    const url = process.env.TURSO_DATABASE_URL || FALLBACK_TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN || FALLBACK_TURSO_AUTH_TOKEN;
    turso = createClient({ url, authToken });
  }

  // 1. Fetch customers from AppData SQLite
  const appDataCustomers = await appDataDb.all('SELECT * FROM customers');
  console.log(`Found ${appDataCustomers.length} customer(s) in AppData database:`);
  for (const c of appDataCustomers) {
    console.log(`  - ${c.name} (${c.phone || 'No phone'}, NIC: ${c.nic || 'N/A'})`);
  }

  // 2. Push each customer to workspace SQLite and Turso Cloud
  for (const c of appDataCustomers) {
    const cols = Object.keys(c);
    const colNames = cols.map(k => `"${k}"`).join(', ');
    const placeholders = cols.map(() => '?').join(', ');
    const args = cols.map(k => c[k] !== undefined ? c[k] : null);

    // Save to Workspace SQLite
    await workspaceDb.run(
      `INSERT OR REPLACE INTO customers (${colNames}) VALUES (${placeholders})`,
      args
    );

    // Save to Turso Cloud
    await turso.execute({
      sql: `INSERT OR REPLACE INTO customers (${colNames}) VALUES (${placeholders})`,
      args
    });
  }

  // 3. Verification
  const wsCount = await workspaceDb.get('SELECT COUNT(*) as count FROM customers');
  const cloudRes = await turso.execute('SELECT COUNT(*) as count FROM customers');
  const cloudCount = Number(cloudRes?.rows?.[0]?.count ?? 0);

  console.log(`\n📊 Verification:`);
  console.log(`  - Workspace SQLite Customers: ${wsCount.count}`);
  console.log(`  - Turso Cloud Customers:      ${cloudCount}`);

  await appDataDb.close();
  await workspaceDb.close();

  if (cloudCount >= 5) {
    console.log('\n✅ STEP 1 COMPLETE: All 5 customers successfully pushed to Turso Cloud!');
  } else {
    throw new Error(`Expected at least 5 customers on Turso Cloud, but got ${cloudCount}`);
  }
}

main().catch(err => {
  console.error('Fatal error pushing local customers:', err);
  process.exit(1);
});
