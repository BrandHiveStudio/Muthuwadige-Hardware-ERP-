import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(rootDir, '.env') });

const KEEP_EMAILS = ['sanojhardware@gmail.com', 'krishleo439@gmail.com'];
const PROTECTED_TABLES = new Set([
  'users',
  'profiles',
  'roles',
  'custom_permissions',
  'system_settings',
  'schema_migrations',
  'migrations',
  'sqlite_sequence'
]);

// Step 0: Backup workspace hardware.db
const wsDbPath = path.join(rootDir, 'hardware.db');
if (fs.existsSync(wsDbPath)) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(rootDir, `hardware.db.pre-nuclear-reset-${ts}.bak`);
  fs.copyFileSync(wsDbPath, backupFile);
  console.log(`🛡️ [BACKUP] Created safety backup: ${backupFile}`);
}

async function resetSqliteInstance(dbPath, label) {
  if (!fs.existsSync(dbPath)) {
    console.log(`ℹ️ [${label}] Database file does not exist at ${dbPath} (skipping)`);
    return { status: 'NOT_FOUND', tableCounts: {} };
  }

  console.log(`\n======================================================================`);
  console.log(`🧹 RESETTING SQLITE: ${label}`);
  console.log(`📍 Path: ${dbPath}`);
  console.log(`======================================================================`);

  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  await db.run('PRAGMA foreign_keys = OFF;');
  await db.run('BEGIN TRANSACTION;');

  const tableCounts = {};

  try {
    // 1. Get all tables
    const tableRows = await db.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const tableNames = tableRows.map(r => r.name);

    // 2. Wipe all non-protected tables
    for (const tbl of tableNames) {
      if (!PROTECTED_TABLES.has(tbl)) {
        await db.run(`DELETE FROM "${tbl}";`);
        console.log(`  ✓ Purged table: ${tbl}`);
      }
    }

    // 3. Filter users & profiles
    const placeholders = KEEP_EMAILS.map(() => '?').join(',');
    if (tableNames.includes('users')) {
      const deletedUsers = await db.run(
        `DELETE FROM users WHERE LOWER(email) NOT IN (${placeholders})`,
        KEEP_EMAILS
      );
      console.log(`  ✓ Pruned users (kept only ${KEEP_EMAILS.join(', ')}). Rows removed: ${deletedUsers.changes}`);
    }

    if (tableNames.includes('profiles')) {
      const deletedProfiles = await db.run(
        `DELETE FROM profiles WHERE LOWER(email) NOT IN (${placeholders})`,
        KEEP_EMAILS
      );
      console.log(`  ✓ Pruned profiles. Rows removed: ${deletedProfiles.changes}`);
    }

    if (tableNames.includes('user_capabilities')) {
      await db.run(
        `DELETE FROM user_capabilities WHERE user_id NOT IN (SELECT id FROM users WHERE LOWER(email) IN (${placeholders}))`,
        KEEP_EMAILS
      );
    }

    // 4. Reset sqlite_sequence for wiped tables
    try {
      await db.run("DELETE FROM sqlite_sequence WHERE name NOT IN ('users', 'profiles', 'system_settings')");
      console.log(`  ✓ Reset auto-increment sequences.`);
    } catch (e) {
      // sqlite_sequence might be empty or not present
    }

    // 5. Reset system_settings invoice numbering & sync markers
    if (tableNames.includes('system_settings')) {
      try {
        await db.run(
          `UPDATE system_settings SET 
            next_invoice_number = 'INV001', 
            counter_pending_count = 0, 
            last_counter_sync_timestamp = NULL, 
            last_sync_timestamp = NULL 
          WHERE id = 'global' OR 1=1`
        );
        console.log(`  ✓ Reset system_settings invoice sequence to 'INV001' and sync markers.`);
      } catch (e) {
        console.warn(`  ! system_settings notice:`, e.message);
      }
    }

    // 6. Extra cleanup for triggers that might have inserted into audit_logs or sync_queue
    if (tableNames.includes('audit_logs')) await db.run('DELETE FROM "audit_logs";').catch(() => {});
    if (tableNames.includes('sync_queue')) await db.run('DELETE FROM "sync_queue";').catch(() => {});
    if (tableNames.includes('backup_logs')) await db.run('DELETE FROM "backup_logs";').catch(() => {});

    await db.run('COMMIT;');
    await db.run('PRAGMA foreign_keys = ON;');
    await db.run('PRAGMA wal_checkpoint(TRUNCATE);').catch(() => {});
    await db.run('VACUUM;');

    // 7. Verify counts
    for (const tbl of tableNames) {
      const res = await db.get(`SELECT COUNT(*) as cnt FROM "${tbl}"`);
      tableCounts[tbl] = res ? res.cnt : 0;
    }

    console.log(`✅ [${label}] Reset and VACUUM completed successfully.`);
  } catch (err) {
    await db.run('ROLLBACK;').catch(() => {});
    await db.run('PRAGMA foreign_keys = ON;').catch(() => {});
    console.error(`❌ [${label}] Error:`, err);
    throw err;
  } finally {
    await db.close();
  }

  return { status: 'RESET_OK', tableCounts };
}

async function resetTursoCloud(localRefUsers, localRefProfiles) {
  const url = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN;

  if (!url || !authToken) {
    console.warn('\n⚠️ [TURSO] No TURSO_DATABASE_URL or TURSO_AUTH_TOKEN found in .env. Skipping cloud reset.');
    return { status: 'SKIPPED', tableCounts: {} };
  }

  console.log(`\n======================================================================`);
  console.log(`☁️ RESETTING REMOTE TURSO CLOUD DATABASE`);
  console.log(`🌐 URL: ${url}`);
  console.log(`======================================================================`);

  const turso = createClient({ url, authToken });
  const tableCounts = {};

  try {
    // 1. Fetch tables
    const tableRes = await turso.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const tableNames = tableRes.rows.map(r => r.name);

    // 2. Wipe non-protected tables
    for (const tbl of tableNames) {
      if (!PROTECTED_TABLES.has(tbl)) {
        await turso.execute(`DELETE FROM "${tbl}"`);
        console.log(`  ✓ Cloud purged table: ${tbl}`);
      }
    }

    // 3. Filter users & profiles
    const emailList = KEEP_EMAILS.map(e => `'${e.toLowerCase()}'`).join(',');
    if (tableNames.includes('users')) {
      await turso.execute(`DELETE FROM users WHERE LOWER(email) NOT IN (${emailList})`);
      console.log(`  ✓ Cloud pruned users.`);
    }

    if (tableNames.includes('profiles')) {
      await turso.execute(`DELETE FROM profiles WHERE LOWER(email) NOT IN (${emailList})`);
      console.log(`  ✓ Cloud pruned profiles.`);
    }

    if (tableNames.includes('user_capabilities')) {
      await turso.execute(
        `DELETE FROM user_capabilities WHERE user_id NOT IN (SELECT id FROM users WHERE LOWER(email) IN (${emailList}))`
      );
    }

    // 4. Ensure the 2 preserved users and profiles exist on Turso
    if (localRefUsers && localRefUsers.length > 0 && tableNames.includes('users')) {
      for (const u of localRefUsers) {
        await turso.execute({
          sql: `INSERT INTO users (id, email, password, role, name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  email = excluded.email,
                  password = excluded.password,
                  role = excluded.role,
                  name = excluded.name,
                  updated_at = excluded.updated_at`,
          args: [u.id, u.email, u.password, u.role, u.name, u.created_at || null, u.updated_at || null]
        });
        console.log(`  ✓ Verified synced user on Turso: ${u.email} (${u.role})`);
      }
    }

    if (localRefProfiles && localRefProfiles.length > 0 && tableNames.includes('profiles')) {
      for (const p of localRefProfiles) {
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
          args: [
            p.id,
            p.name,
            p.email,
            p.role,
            p.avatar || null,
            p.password || null,
            p.permissions || null,
            p.custom_permissions || null,
            p.created_at || null,
            p.updated_at || null
          ]
        });
        console.log(`  ✓ Verified synced profile on Turso: ${p.email}`);
      }
    }

    // 5. Reset system_settings on Turso
    if (tableNames.includes('system_settings')) {
      try {
        await turso.execute(
          `UPDATE system_settings SET 
            next_invoice_number = 'INV001', 
            counter_pending_count = 0, 
            last_counter_sync_timestamp = NULL, 
            last_sync_timestamp = NULL 
          WHERE id = 'global' OR 1=1`
        );
        console.log(`  ✓ Cloud reset system_settings invoice numbering & sync timestamps.`);
      } catch (e) {
        console.warn(`  ! Cloud system_settings note:`, e.message);
      }
    }

    // 6. Reset sqlite_sequence on Turso
    try {
      await turso.execute("DELETE FROM sqlite_sequence WHERE name NOT IN ('users', 'profiles', 'system_settings')");
      console.log(`  ✓ Cloud reset sqlite_sequence counters.`);
    } catch (e) {}

    // 7. Extra cleanup for triggers that may have inserted into audit_logs or sync_queue
    if (tableNames.includes('audit_logs')) await turso.execute('DELETE FROM audit_logs;').catch(() => {});
    if (tableNames.includes('sync_queue')) await turso.execute('DELETE FROM sync_queue;').catch(() => {});
    if (tableNames.includes('backup_logs')) await turso.execute('DELETE FROM backup_logs;').catch(() => {});

    // 8. Verify counts
    for (const tbl of tableNames) {
      try {
        const res = await turso.execute(`SELECT COUNT(*) as cnt FROM "${tbl}"`);
        tableCounts[tbl] = res.rows[0].cnt;
      } catch (e) {
        tableCounts[tbl] = 'ERR';
      }
    }

    console.log(`✅ [TURSO CLOUD] Reset verified successfully.`);
  } catch (err) {
    console.error(`❌ [TURSO CLOUD] Error:`, err);
    throw err;
  }

  return { status: 'RESET_OK', tableCounts };
}

function cleanElectronFrontendCache() {
  console.log(`\n======================================================================`);
  console.log(`🧼 CLEANING ELECTRON FRONTEND STORAGE & CACHE`);
  console.log(`======================================================================`);

  const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const targetDirs = [
    path.join(appDataRoot, 'Muthuwadige Hardware ERP'),
    path.join(appDataRoot, 'muthuwadige-hardware-erp'),
    path.join(appDataRoot, 'ERP-Template')
  ];

  const subDirsToPurge = [
    'Local Storage',
    'Session Storage',
    'IndexedDB',
    'GPUCache',
    'Cache',
    'Code Cache',
    'DawnCache'
  ];

  for (const tDir of targetDirs) {
    if (fs.existsSync(tDir)) {
      for (const sub of subDirsToPurge) {
        const targetPath = path.join(tDir, sub);
        if (fs.existsSync(targetPath)) {
          try {
            fs.rmSync(targetPath, { recursive: true, force: true });
            console.log(`  ✓ Purged frontend cache: ${targetPath}`);
          } catch (e) {
            console.warn(`  ! Notice clearing ${targetPath}:`, e.message);
          }
        }
      }
    }
  }
}

async function main() {
  console.log('🚀 INITIATING COMPLETE FACTORY NUCLEAR RESET ACROSS ALL DATA STORES');

  // 1. Reset Workspace DB
  const wsResult = await resetSqliteInstance(wsDbPath, 'Local Workspace SQLite (hardware.db)');

  // Read preserved users & profiles from workspace DB to feed into Turso Cloud
  let preservedUsers = [];
  let preservedProfiles = [];
  if (fs.existsSync(wsDbPath)) {
    const db = await open({ filename: wsDbPath, driver: sqlite3.Database });
    try {
      preservedUsers = await db.all('SELECT * FROM users');
      preservedProfiles = await db.all('SELECT * FROM profiles');
    } catch (e) {}
    await db.close();
  }

  // 2. Reset Electron AppData DBs if any exist
  const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const appDataDb1 = path.join(appDataRoot, 'Muthuwadige Hardware ERP', 'hardware.db');
  const appDataDb2 = path.join(appDataRoot, 'muthuwadige-hardware-erp', 'hardware.db');
  const appDataDb3 = path.join(appDataRoot, 'ERP-Template', 'hardware.db');

  const ad1Result = await resetSqliteInstance(appDataDb1, 'AppData (Muthuwadige Hardware ERP)');
  const ad2Result = await resetSqliteInstance(appDataDb2, 'AppData (muthuwadige-hardware-erp)');
  const ad3Result = await resetSqliteInstance(appDataDb3, 'AppData (ERP-Template)');

  // 3. Reset Turso Cloud DB
  const tursoResult = await resetTursoCloud(preservedUsers, preservedProfiles);

  // 4. Clean frontend caches
  cleanElectronFrontendCache();

  // 5. Final Comprehensive Verification Table
  console.log('\n========================================================================================================');
  console.log('📊 FINAL FACTORY RESET VERIFICATION AUDIT');
  console.log('========================================================================================================');
  console.log(
    'Table Name'.padEnd(28) +
    ' | ' + 'Workspace DB'.padEnd(12) +
    ' | ' + 'AppData DB'.padEnd(12) +
    ' | ' + 'Turso Cloud'.padEnd(12) +
    ' | Status'
  );
  console.log('-----------------------------+--------------+--------------+--------------+-----------------------------');

  const allKeys = Array.from(new Set([
    ...Object.keys(wsResult.tableCounts || {}),
    ...Object.keys(ad1Result.tableCounts || {}),
    ...Object.keys(tursoResult.tableCounts || {})
  ])).sort();

  for (const tbl of allKeys) {
    const wsCnt = wsResult.tableCounts?.[tbl] !== undefined ? wsResult.tableCounts[tbl] : '-';
    const adCnt = ad1Result.tableCounts?.[tbl] !== undefined ? ad1Result.tableCounts[tbl] : '-';
    const tcCnt = tursoResult.tableCounts?.[tbl] !== undefined ? tursoResult.tableCounts[tbl] : '-';

    let status = 'CLEARED (0)';
    if (tbl === 'users' || tbl === 'profiles') {
      status = `ADMINS ONLY (${wsCnt} accounts)`;
    } else if (tbl === 'system_settings' || tbl === 'roles' || tbl === 'custom_permissions') {
      status = `CONFIG PRESERVED (${wsCnt} rows)`;
    } else if (wsCnt === 0 && (tcCnt === 0 || tcCnt === '-')) {
      status = 'VERIFIED ZERO (0)';
    } else {
      status = `CHECK (WS:${wsCnt}, Turso:${tcCnt})`;
    }

    console.log(
      tbl.padEnd(28) +
      ' | ' + String(wsCnt).padStart(12) +
      ' | ' + String(adCnt).padStart(12) +
      ' | ' + String(tcCnt).padStart(12) +
      ' | ' + status
    );
  }
  console.log('========================================================================================================\n');
}

main().catch(err => {
  console.error('Fatal reset error:', err);
  process.exit(1);
});
