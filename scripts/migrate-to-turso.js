/**
 * Migration & Seeding Script: Local SQLite (hardware.db) -> Turso Cloud libSQL
 * 
 * Usage:
 *   node scripts/migrate-to-turso.js
 *   node scripts/migrate-to-turso.js --dry-run
 */

import { createClient } from '@libsql/client';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Load environment variables
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
if (process.env.APPDATA) {
  const appDataEnv = path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', '.env');
  if (fs.existsSync(appDataEnv)) {
    dotenv.config({ path: appDataEnv });
  }
}

// 2. Resolve local SQLite database file
function resolveLocalDb() {
  const candidates = [
    path.join(rootDir, 'hardware.db'),
    process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, 'hardware.db') : null,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', 'hardware.db') : null
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(rootDir, 'hardware.db');
}

async function runMigration() {
  const isDryRun = process.argv.includes('--dry-run') || process.argv.includes('--test');
  let tursoUrl = process.env.TURSO_DATABASE_URL;
  let tursoToken = process.env.TURSO_AUTH_TOKEN;

  console.log('================================================================');
  console.log('🚀 TURSO libSQL CLOUD MIGRATION & SEEDING ENGINE');
  console.log('================================================================\n');

  const localDbPath = resolveLocalDb();
  if (!fs.existsSync(localDbPath)) {
    console.error(`❌ Local SQLite database not found at: ${localDbPath}`);
    process.exit(1);
  }
  console.log(`📂 Source Local SQLite Database: ${localDbPath}`);

  // Open local SQLite database
  const localDb = await open({
    filename: localDbPath,
    driver: sqlite3.Database
  });

  // Extract all tables
  const tables = await localDb.all(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  console.log(`📊 Discovered ${tables.length} table(s) in local SQLite database.`);

  // Extract all indexes
  const indexes = await localDb.all(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY tbl_name, name"
  );
  console.log(`📑 Discovered ${indexes.length} custom index(es).`);

  // Extract triggers
  const triggers = await localDb.all(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL ORDER BY tbl_name, name"
  );
  console.log(`⚙️  Discovered ${triggers.length} trigger(s).\n`);

  // Check Turso credentials
  if (!tursoUrl || !tursoToken) {
    if (isDryRun) {
      console.log('⚠️  TURSO_DATABASE_URL or TURSO_AUTH_TOKEN not found in .env.');
      console.log('🧪 --dry-run mode requested: Initializing libSQL in-memory target to validate migration engine...');
      tursoUrl = ':memory:';
      tursoToken = 'dry-run-token';
    } else {
      console.log('----------------------------------------------------------------');
      console.log('⚠️  TURSO CLOUD CREDENTIALS MISSING IN .env');
      console.log('----------------------------------------------------------------');
      console.log('To migrate and seed your database to Turso Cloud, please add the');
      console.log('following environment variables to your .env file:\n');
      console.log('  TURSO_DATABASE_URL=libsql://your-database-name-org.turso.io');
      console.log('  TURSO_AUTH_TOKEN=your-turso-jwt-auth-token\n');
      console.log('Local schema and row counts ready for migration:');

      for (const t of tables) {
        const rowCount = await localDb.get(`SELECT COUNT(*) as count FROM "${t.name}"`);
        console.log(`  • ${t.name.padEnd(25)} : ${rowCount.count} rows`);
      }

      console.log('\nTip: You can test the migration engine right now with:');
      console.log('  node scripts/migrate-to-turso.js --dry-run\n');
      await localDb.close();
      return;
    }
  }

  console.log(`🌐 Target Turso libSQL Database: ${tursoUrl}`);
  const tursoClient = createClient({
    url: tursoUrl,
    authToken: tursoToken
  });

  try {
    // Phase 1: Create Tables on Turso
    console.log('\n--- Phase 1: Applying Table Schemas to Turso ---');
    for (const table of tables) {
      let ddl = table.sql;
      // Ensure IF NOT EXISTS is present
      if (!ddl.toUpperCase().includes('IF NOT EXISTS')) {
        ddl = ddl.replace(/CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS ');
      }
      try {
        await tursoClient.execute(ddl);
        console.log(`  ✅ Table schema verified: ${table.name}`);
      } catch (err) {
        console.error(`  ❌ Failed to create table ${table.name}:`, err.message);
        throw err;
      }
    }

    // Phase 2: Create Indexes on Turso
    console.log('\n--- Phase 2: Applying Indexes to Turso ---');
    for (const idx of indexes) {
      let ddl = idx.sql;
      if (!ddl.toUpperCase().includes('IF NOT EXISTS')) {
        ddl = ddl.replace(/CREATE INDEX /i, 'CREATE INDEX IF NOT EXISTS ');
      }
      try {
        await tursoClient.execute(ddl);
        console.log(`  ✅ Index created: ${idx.name} on ${idx.tbl_name}`);
      } catch (err) {
        // Skip duplicate or auto-index warnings
        console.log(`  ℹ️  Index ${idx.name} note: ${err.message}`);
      }
    }

    // Phase 3: Migrate & Seed Rows
    console.log('\n--- Phase 3: Migrating Table Rows (Batch INSERT OR REPLACE) ---');
    let totalMigratedRows = 0;

    for (const table of tables) {
      const rows = await localDb.all(`SELECT * FROM "${table.name}"`);
      if (!rows || rows.length === 0) {
        console.log(`  ⚪ Table ${table.name}: 0 rows to seed (empty).`);
        continue;
      }

      const columns = Object.keys(rows[0]);
      const colList = columns.map(c => `"${c}"`).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      const insertSql = `INSERT OR REPLACE INTO "${table.name}" (${colList}) VALUES (${placeholders})`;

      // Chunk rows into batches of 50 for safe HTTP payload size
      const BATCH_SIZE = 50;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const batchStatements = chunk.map(row => ({
          sql: insertSql,
          args: columns.map(col => {
            const val = row[col];
            return val !== undefined ? val : null;
          })
        }));

        await tursoClient.batch(batchStatements, 'write');
      }

      totalMigratedRows += rows.length;
      console.log(`  ✅ Table ${table.name.padEnd(24)}: Seeded ${rows.length} row(s) cleanly.`);
    }

    // Phase 4: Apply Database Triggers
    console.log('\n--- Phase 4: Applying Database Triggers ---');
    for (const trg of triggers) {
      let ddl = trg.sql;
      if (!ddl.toUpperCase().includes('IF NOT EXISTS')) {
        ddl = ddl.replace(/CREATE TRIGGER /i, 'CREATE TRIGGER IF NOT EXISTS ');
      }
      try {
        await tursoClient.execute(ddl);
        console.log(`  ✅ Trigger created: ${trg.name} on ${trg.tbl_name}`);
      } catch (err) {
        console.log(`  ℹ️  Trigger ${trg.name} note: ${err.message}`);
      }
    }

    // Phase 5: Parity Verification
    console.log('\n--- Phase 5: Parity & Integrity Verification ---');
    console.log('----------------------------------------------------------------');
    console.log('TABLE NAME                  | LOCAL SQLITE | TURSO CLOUD | PARITY');
    console.log('----------------------------------------------------------------');

    let allMatched = true;
    for (const table of tables) {
      const localCountRes = await localDb.get(`SELECT COUNT(*) as count FROM "${table.name}"`);
      const tursoCountRes = await tursoClient.execute(`SELECT COUNT(*) as count FROM "${table.name}"`);

      const localCount = Number(localCountRes?.count ?? 0);
      const tursoCount = Number(tursoCountRes?.rows?.[0]?.count ?? 0);
      const match = localCount === tursoCount;

      if (!match) allMatched = false;

      const statusStr = match ? '✅ MATCH' : '❌ MISMATCH';
      console.log(
        `${table.name.padEnd(27)} | ${String(localCount).padStart(12)} | ${String(tursoCount).padStart(11)} | ${statusStr}`
      );
    }
    console.log('----------------------------------------------------------------');

    if (allMatched) {
      console.log(`\n🎉 PARITY CONFIRMED! All ${tables.length} tables and ${totalMigratedRows} rows match 100% between Local SQLite and Turso libSQL Cloud.`);
    } else {
      console.error('\n⚠️ Discrepancies detected between local SQLite and Turso Cloud row counts. Please inspect above table.');
      process.exit(1);
    }

  } finally {
    await localDb.close();
    tursoClient.close();
  }
}

runMigration().catch(err => {
  console.error('\n❌ Migration failed with error:', err);
  process.exit(1);
});
