import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

const DB_PATH = path.join(rootDir, 'hardware.db');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const BACKUP_PATH = path.join(rootDir, `hardware.db.pre-zero-reset-${TIMESTAMP}.bak`);
const STATIC_BACKUP_PATH = path.join(rootDir, 'hardware.db.pre-zero-reset.bak');

async function main() {
  console.log('======================================================================');
  console.log('🚀 PHASE 1: DATABASE ZERO-RESET (LOCAL SQLITE & TURSO CLOUD)');
  console.log('======================================================================\n');

  // Step 1: Backup hardware.db
  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, BACKUP_PATH);
    fs.copyFileSync(DB_PATH, STATIC_BACKUP_PATH);
    console.log(`[BACKUP] Created timestamped backup: ${BACKUP_PATH}`);
    console.log(`[BACKUP] Created canonical backup:   ${STATIC_BACKUP_PATH}\n`);
  } else {
    console.warn(`[BACKUP] hardware.db does not exist at ${DB_PATH}`);
  }

  // Connect local db
  const localDb = new sqlite3.Database(DB_PATH);
  const runLocal = (sql, params = []) => new Promise((resolve, reject) => {
    localDb.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
  const allLocal = (sql, params = []) => new Promise((resolve, reject) => {
    localDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

  // Connect Turso client
  let turso = null;
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    turso = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN
    });
    console.log('[TURSO] Client connected to Turso Cloud.\n');
  } else {
    console.warn('[TURSO] Missing credentials in .env!\n');
  }

  // Discover all tables
  const localTableRows = await allLocal("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const localTables = localTableRows.map(r => r.name);

  let tursoTables = [];
  if (turso) {
    const tursoTableRes = await turso.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    tursoTables = tursoTableRes.rows.map(r => r.name);
  }

  // Union of all tables
  const allTables = Array.from(new Set([...localTables, ...tursoTables])).sort();

  // Define tables to PRESERVE:
  // - users, profiles, custom_permissions, system_settings
  const PROTECTED_TABLES = new Set([
    'users',
    'profiles',
    'custom_permissions',
    'system_settings',
    'sqlite_sequence',
    'schema_migrations',
    'migrations'
  ]);

  // Tables to wipe
  const tablesToWipe = allTables.filter(t => !PROTECTED_TABLES.has(t));

  // Enforce retention of ONLY the two approved accounts:
  // 1. usr_super_admin_01 (sanojhardware@gmail.com) - Root Super Admin
  // 2. u_1789829748029 (krishleo439@gmail.com) - Admin
  console.log('\n--- Pruning Unauthorized Accounts from Local SQLite ---');
  try {
    if (localTables.includes('user_capabilities')) {
      await runLocal("DELETE FROM user_capabilities WHERE user_id NOT IN ('usr_super_admin_01', 'u_1789829748029')");
    }
    await runLocal("DELETE FROM profiles WHERE id NOT IN ('usr_super_admin_01', 'u_1789829748029') AND email NOT IN ('sanojhardware@gmail.com', 'krishleo439@gmail.com')");
    await runLocal("DELETE FROM users WHERE id NOT IN ('usr_super_admin_01', 'u_1789829748029') AND email NOT IN ('sanojhardware@gmail.com', 'krishleo439@gmail.com')");
    console.log('[LOCAL] Pruned unauthorized accounts. Retained ONLY usr_super_admin_01 and u_1789829748029.');
  } catch (e) {
    console.warn('[LOCAL] Unauthorized account prune note:', e.message);
  }

  // Verify users before purge
  console.log('--- Protected User Accounts (Local SQLite) ---');
  const localUsers = await allLocal('SELECT id, email, role, name FROM users');
  localUsers.forEach(u => console.log(` - ${u.id}: ${u.name} <${u.email}> [${u.role}]`));

  console.log('\n--- Protected Profiles (Local SQLite) ---');
  const localProfiles = await allLocal('SELECT id, email, role, name FROM profiles');
  localProfiles.forEach(p => console.log(` - ${p.id}: ${p.name} <${p.email}> [${p.role}]`));

  // Execute deletion on local SQLite
  console.log('\n--- Executing Deletions on Local SQLite ---');
  await runLocal('PRAGMA foreign_keys = OFF');
  for (const table of tablesToWipe) {
    if (localTables.includes(table)) {
      try {
        await runLocal(`DELETE FROM "${table}"`);
        console.log(`[LOCAL] Purged table: ${table}`);
      } catch (e) {
        console.error(`[LOCAL] Error purging ${table}:`, e.message);
      }
    }
  }

  // Reset sqlite_sequence on Local SQLite
  try {
    await runLocal("DELETE FROM sqlite_sequence WHERE name NOT IN ('users', 'profiles', 'system_settings')");
    console.log('[LOCAL] Reset sqlite_sequence counters (preserved user sequences).');
  } catch (e) {
    console.warn('[LOCAL] sqlite_sequence reset note:', e.message);
  }

  // Reset system_settings invoice numbering
  try {
    await runLocal("UPDATE system_settings SET next_invoice_number = 'INV001', counter_pending_count = 0 WHERE id = 'global'");
    console.log("[LOCAL] Reset system_settings next_invoice_number to 'INV001'.");
  } catch (e) {
    console.warn('[LOCAL] system_settings invoice counter update:', e.message);
  }

  await runLocal('PRAGMA foreign_keys = ON');

  // Execute deletion on Turso Cloud
  if (turso) {
    console.log('\n--- Executing Deletions on Turso Cloud ---');
    for (const table of tablesToWipe) {
      if (tursoTables.includes(table)) {
        try {
          await turso.execute(`DELETE FROM "${table}"`);
          console.log(`[TURSO] Purged table: ${table}`);
        } catch (e) {
          console.error(`[TURSO] Error purging ${table}:`, e.message);
        }
      }
    }

    // Prune unauthorized accounts from Turso Cloud
    try {
      if (tursoTables.includes('user_capabilities')) {
        await turso.execute("DELETE FROM user_capabilities WHERE user_id NOT IN ('usr_super_admin_01', 'u_1789829748029')");
      }
      await turso.execute("DELETE FROM profiles WHERE id NOT IN ('usr_super_admin_01', 'u_1789829748029') AND email NOT IN ('sanojhardware@gmail.com', 'krishleo439@gmail.com')");
      await turso.execute("DELETE FROM users WHERE id NOT IN ('usr_super_admin_01', 'u_1789829748029') AND email NOT IN ('sanojhardware@gmail.com', 'krishleo439@gmail.com')");
      console.log('[TURSO] Pruned unauthorized accounts. Retained ONLY usr_super_admin_01 and u_1789829748029.');
    } catch (e) {
      console.warn('[TURSO] Unauthorized account prune note:', e.message);
    }

    // Reset sqlite_sequence on Turso
    try {
      await turso.execute("DELETE FROM sqlite_sequence WHERE name NOT IN ('users', 'profiles', 'system_settings')");
      console.log('[TURSO] Reset sqlite_sequence counters.');
    } catch (e) {
      console.warn('[TURSO] sqlite_sequence reset note:', e.message);
    }

    // Sync all local users to Turso Cloud so all protected accounts are present on Cloud
    console.log('\n--- Ensuring All Protected Users Synced to Turso Cloud ---');
    const fullLocalUsers = await allLocal('SELECT * FROM users');
    for (const u of fullLocalUsers) {
      try {
        await turso.execute({
          sql: `INSERT INTO users (id, email, password, role, name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  email = excluded.email,
                  password = excluded.password,
                  role = excluded.role,
                  name = excluded.name,
                  updated_at = excluded.updated_at`,
          args: [u.id, u.email, u.password, u.role, u.name, u.created_at, u.updated_at]
        });
        console.log(`[TURSO] Synced user: ${u.id} (${u.email})`);
      } catch (e) {
        console.warn(`[TURSO] Sync user ${u.id} note:`, e.message);
      }
    }

    const fullLocalProfiles = await allLocal('SELECT * FROM profiles');
    for (const p of fullLocalProfiles) {
      try {
        await turso.execute({
          sql: `INSERT INTO profiles (id, name, email, role, avatar, password, permissions, custom_permissions, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name,
                  email = excluded.email,
                  role = excluded.role,
                  avatar = excluded.avatar,
                  password = excluded.password,
                  permissions = excluded.permissions,
                  custom_permissions = excluded.custom_permissions,
                  updated_at = excluded.updated_at`,
          args: [p.id, p.name, p.email, p.role, p.avatar, p.password, p.permissions, p.custom_permissions, p.created_at, p.updated_at]
        });
        console.log(`[TURSO] Synced profile: ${p.id} (${p.email})`);
      } catch (e) {
        console.warn(`[TURSO] Sync profile ${p.id} note:`, e.message);
      }
    }

    // Reset system_settings invoice numbering on Turso
    try {
      await turso.execute("UPDATE system_settings SET next_invoice_number = 'INV001', counter_pending_count = 0 WHERE id = 'global'");
      console.log("[TURSO] Reset system_settings next_invoice_number to 'INV001'.");
    } catch (e) {
      console.warn('[TURSO] system_settings invoice counter update:', e.message);
    }
  }

  // Final purge of audit_logs (so triggers firing during user sync/settings update leave 0 rows)
  try {
    await runLocal('DELETE FROM audit_logs');
    if (turso) await turso.execute('DELETE FROM audit_logs');
  } catch (e) {
    console.warn('Final audit_logs purge note:', e.message);
  }

  // Verification Report
  console.log('\n================================================================================================');
  console.log('✅ PHASE 1: ZERO-RESET VERIFICATION SUMMARY (LOCAL SQLITE & TURSO CLOUD)');
  console.log('================================================================================================');
  console.log('Table Name                    | Local SQLite | Turso Cloud | Status');
  console.log('------------------------------+--------------+-------------+------------------------------------');

  const reportRows = [];
  for (const table of allTables) {
    let lCount = 'N/A';
    let tCount = 'N/A';
    if (localTables.includes(table)) {
      try {
        const r = await allLocal(`SELECT COUNT(*) AS c FROM "${table}"`);
        lCount = r[0].c;
      } catch (e) { lCount = 'ERR'; }
    }
    if (turso && tursoTables.includes(table)) {
      try {
        const r = await turso.execute(`SELECT COUNT(*) AS c FROM "${table}"`);
        tCount = r.rows[0].c;
      } catch (e) { tCount = 'ERR'; }
    }

    let status = 'CLEARED (0)';
    if (table === 'users' || table === 'profiles') {
      status = `PROTECTED (${lCount} accounts preserved)`;
    } else if (table === 'custom_permissions' || table === 'system_settings') {
      status = `CONFIG PRESERVED (${lCount} rows)`;
    } else if ((lCount === 0 || lCount === 'N/A') && (tCount === 0 || tCount === 'N/A')) {
      status = 'CLEARED (0)';
    } else {
      status = `ATTN (Local:${lCount}, Turso:${tCount})`;
    }

    console.log(`${table.padEnd(29)} | ${String(lCount).padStart(12)} | ${String(tCount).padStart(11)} | ${status}`);
    reportRows.push({ table, local: lCount, turso: tCount, status });
  }
  console.log('================================================================================================\n');

  localDb.close();
}

main().catch(err => {
  console.error('Fatal error during zero-reset:', err);
  process.exit(1);
});
