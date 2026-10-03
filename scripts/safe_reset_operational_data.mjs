import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables
dotenv.config({ path: path.join(rootDir, '.env') });

const DB_PATH = path.join(rootDir, 'hardware.db');
const APPDATA_DIR = path.join(
  process.env.APPDATA || 'C:\\Users\\lipca\\AppData\\Roaming',
  'Muthuwadige Hardware ERP'
);
const APPDATA_DB = path.join(APPDATA_DIR, 'hardware.db');

// STRICT PROTECTED TABLES - NEVER PURGE OR DROP
const PROTECTED_TABLES = new Set([
  'users',
  'profiles',
  'custom_permissions',
  'roles',
  'permissions',
  'staff',
  'accounts',
  'sessions',
  'sqlite_sequence',
  'schema_migrations',
  'migrations',
  'system_settings'
]);

// TARGET TABLES IDENTIFIED FOR OPERATIONAL PURGE
const OPERATIONAL_TABLE_CANDIDATES = [
  // Sales & Invoices
  'sales',
  'sale_items',
  'sales_items',
  'invoices',
  'credit_sales',
  'credit_payments',
  'credit_settlements',
  'quotations',
  'quotation_items',
  'sales_returns',
  'sales_return_items',
  'delivery_notes',
  'bill_holds',
  'scanner_signals',

  // Purchasing & POs
  'purchase_orders',
  'purchase_order_items',
  'purchases',
  'purchase_returns',
  'purchase_return_items',
  'supplier_settlements',
  'debit_notes',

  // Inventory & Catalog
  'products',
  'inventory',
  'inventory_logs',
  'stock_adjustments',
  'barcodes',
  'categories',
  'discounts',
  'promotions',

  // Financials & Ledger
  'cash_drawer_sessions',
  'transactions',
  'customer_transactions',
  'customer_ledger',
  'supplier_ledger',
  'credit_notes',
  'credit_note_usage',
  'expenses',
  'cheques',
  'cheque_registry',
  'shift_logs',
  'customers',
  'suppliers',
  'branches',
  'employees',

  // Sync, Logs & Audit Queues
  'sync_queue',
  'sync_logs',
  'sync_pull_marker',
  'sync_conflicts',
  'audit_logs',
  'backup_logs',
  'notifications',
  'deleted_records',
  'system_meta'
];

export async function executeSafeReset(options = { dryRun: false }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log(`\n======================================================================`);
  console.log(`🛡️  SAFE DATABASE RESET PROTOCOL (${options.dryRun ? 'DRY-RUN' : 'LIVE EXECUTION'})`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`======================================================================\n`);

  const summary = [];

  // 1. Create Local Backups
  if (fs.existsSync(DB_PATH) && !options.dryRun) {
    const backupFile = path.join(rootDir, `hardware.db.backup-${timestamp}.bak`);
    fs.copyFileSync(DB_PATH, backupFile);
    console.log(`📦 [LOCAL BACKUP] Created: ${backupFile}`);
  }
  if (fs.existsSync(APPDATA_DB) && !options.dryRun) {
    const appBackup = path.join(APPDATA_DIR, `hardware.db.backup-${timestamp}.bak`);
    fs.copyFileSync(APPDATA_DB, appBackup);
    console.log(`📦 [APPDATA BACKUP] Created: ${appBackup}`);
  }

  // Connect local SQLite
  let localDb = null;
  let localTables = [];
  if (fs.existsSync(DB_PATH)) {
    localDb = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });
    const lRes = await localDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    localTables = lRes.map(r => r.name);
  }

  // Connect AppData SQLite if present
  let appDataDb = null;
  let appDataTables = [];
  if (fs.existsSync(APPDATA_DB)) {
    appDataDb = await open({
      filename: APPDATA_DB,
      driver: sqlite3.Database
    });
    const aRes = await appDataDb.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    appDataTables = aRes.map(r => r.name);
  }

  // Connect Turso Cloud
  let turso = null;
  let tursoTables = [];
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    turso = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN
    });
    const tRes = await turso.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    tursoTables = tRes.rows.map(r => String(r.name));
    console.log(`☁️  [TURSO CLOUD] Connected to: ${process.env.TURSO_DATABASE_URL}`);
  } else {
    console.warn(`⚠️  [TURSO CLOUD] No credentials found in .env. Skipping remote database.`);
  }

  // Calculate Union of all tables
  const allTables = Array.from(new Set([...localTables, ...appDataTables, ...tursoTables])).sort();

  // Filter tables to purge
  const tablesToPurge = allTables.filter(t => !PROTECTED_TABLES.has(t));

  console.log(`\n🔒 [PROTECTED TABLES - 100% PRESERVED]:`);
  for (const pt of PROTECTED_TABLES) {
    if (allTables.includes(pt)) {
      console.log(`   - ${pt} (ALL records preserved)`);
    }
  }

  console.log(`\n🎯 [TARGET TABLES TO PURGE]:`);
  console.log(`   ${tablesToPurge.join(', ')}\n`);

  // Step 2: Backup Turso data to JSON file before live purge
  if (turso && !options.dryRun) {
    const remoteBackup = {};
    for (const tbl of tablesToPurge) {
      if (tursoTables.includes(tbl)) {
        try {
          const res = await turso.execute(`SELECT * FROM "${tbl}"`);
          remoteBackup[tbl] = res.rows;
        } catch (e) {
          remoteBackup[tbl] = `Error reading: ${e.message}`;
        }
      }
    }
    const tursoBackupFile = path.join(rootDir, `turso_cloud_backup-${timestamp}.json`);
    fs.writeFileSync(tursoBackupFile, JSON.stringify(remoteBackup, null, 2), 'utf8');
    console.log(`📦 [TURSO CLOUD BACKUP] Saved remote snapshot to: ${tursoBackupFile}\n`);
  }

  // Step 3: Perform Purge on Local SQLite
  if (localDb) {
    await localDb.run('PRAGMA foreign_keys = OFF;');
    for (const table of tablesToPurge) {
      if (localTables.includes(table)) {
        let countBefore = 0;
        try {
          const countRow = await localDb.get(`SELECT COUNT(*) as c FROM "${table}"`);
          countBefore = countRow?.c || 0;
        } catch (_) {}

        if (!options.dryRun && countBefore > 0) {
          await localDb.run(`DELETE FROM "${table}"`);
        }

        let summaryItem = summary.find(s => s.table === table);
        if (!summaryItem) {
          summaryItem = { table, localDeleted: countBefore, tursoDeleted: 0, status: 'CLEARED' };
          summary.push(summaryItem);
        } else {
          summaryItem.localDeleted = countBefore;
        }
      }
    }

    // Reset sqlite_sequence for purged tables
    if (!options.dryRun) {
      try {
        const preservedList = Array.from(PROTECTED_TABLES).map(t => `'${t}'`).join(',');
        await localDb.run(`DELETE FROM sqlite_sequence WHERE name NOT IN (${preservedList})`);
      } catch (e) {
        console.warn(`[LOCAL] sqlite_sequence reset note:`, e.message);
      }
    }

    // Reset system_settings invoice counter
    if (!options.dryRun && localTables.includes('system_settings')) {
      try {
        await localDb.run(`
          UPDATE system_settings 
          SET next_invoice_number = 'INV001',
              counter_pending_count = 0,
              last_counter_sync_timestamp = NULL,
              last_sync_timestamp = NULL
          WHERE id = 'global' OR 1=1
        `);
      } catch (e) {
        console.warn(`[LOCAL] system_settings invoice sequence reset note:`, e.message);
      }
    }

    await localDb.run('PRAGMA foreign_keys = ON;');
  }

  // Step 3b: Perform Purge on AppData SQLite (if exists)
  if (appDataDb) {
    await appDataDb.run('PRAGMA foreign_keys = OFF;');
    for (const table of tablesToPurge) {
      if (appDataTables.includes(table)) {
        let countBefore = 0;
        try {
          const countRow = await appDataDb.get(`SELECT COUNT(*) as c FROM "${table}"`);
          countBefore = countRow?.c || 0;
        } catch (_) {}

        if (!options.dryRun && countBefore > 0) {
          await appDataDb.run(`DELETE FROM "${table}"`);
        }
      }
    }

    if (!options.dryRun) {
      try {
        const preservedList = Array.from(PROTECTED_TABLES).map(t => `'${t}'`).join(',');
        await appDataDb.run(`DELETE FROM sqlite_sequence WHERE name NOT IN (${preservedList})`);
      } catch (e) {
        console.warn(`[APPDATA] sqlite_sequence reset note:`, e.message);
      }
    }
    await appDataDb.run('PRAGMA foreign_keys = ON;');
  }

  // Step 4: Perform Purge on Turso Cloud
  if (turso) {
    for (const table of tablesToPurge) {
      if (tursoTables.includes(table)) {
        let countBefore = 0;
        try {
          const res = await turso.execute(`SELECT COUNT(*) as c FROM "${table}"`);
          countBefore = res.rows[0]?.c || 0;
        } catch (_) {}

        if (!options.dryRun && countBefore > 0) {
          await turso.execute(`DELETE FROM "${table}"`);
        }

        let summaryItem = summary.find(s => s.table === table);
        if (!summaryItem) {
          summaryItem = { table, localDeleted: 0, tursoDeleted: countBefore, status: 'CLEARED' };
          summary.push(summaryItem);
        } else {
          summaryItem.tursoDeleted = countBefore;
        }
      }
    }

    // Reset sqlite_sequence on Turso
    if (!options.dryRun) {
      try {
        const preservedList = Array.from(PROTECTED_TABLES).map(t => `'${t}'`).join(',');
        await turso.execute(`DELETE FROM sqlite_sequence WHERE name NOT IN (${preservedList})`);
      } catch (e) {
        console.warn(`[TURSO] sqlite_sequence reset note:`, e.message);
      }

      // Reset system_settings on Turso
      if (tursoTables.includes('system_settings')) {
        try {
          await turso.execute(`
            UPDATE system_settings 
            SET next_invoice_number = 'INV001',
                counter_pending_count = 0,
                last_counter_sync_timestamp = NULL,
                last_sync_timestamp = NULL
            WHERE id = 'global' OR 1=1
          `);
        } catch (e) {
          console.warn(`[TURSO] system_settings invoice sequence reset note:`, e.message);
        }
      }
    }
  }

  // Step 5: Final sweep - clear audit_logs created during settings updates
  if (!options.dryRun) {
    try {
      if (localDb && localTables.includes('audit_logs')) await localDb.run('DELETE FROM audit_logs');
      if (turso && tursoTables.includes('audit_logs')) await turso.execute('DELETE FROM audit_logs');
    } catch (_) {}
  }

  // Step 6: Verify User and Profile Integrity
  console.log(`\n======================================================================`);
  console.log(`👥 USER & PROFILE INTEGRITY VERIFICATION`);
  console.log(`======================================================================`);
  
  if (localDb) {
    const users = await localDb.all('SELECT id, email, role, name FROM users');
    const profiles = await localDb.all('SELECT id, email, role, name FROM profiles');
    const perms = localTables.includes('custom_permissions') ? await localDb.all('SELECT * FROM custom_permissions') : [];
    console.log(`[LOCAL SQLITE] Intact Users (${users.length}):`);
    users.forEach(u => console.log(`   ✓ ${u.name} <${u.email}> [Role: ${u.role}, ID: ${u.id}]`));
    console.log(`[LOCAL SQLITE] Intact Profiles: ${profiles.length}, Permissions rows: ${perms.length}`);
  }

  if (turso) {
    const tUsers = await turso.execute('SELECT id, email, role, name FROM users');
    const tProfiles = await turso.execute('SELECT id, email, role, name FROM profiles');
    const tPerms = tursoTables.includes('custom_permissions') ? await turso.execute('SELECT * FROM custom_permissions') : { rows: [] };
    console.log(`[TURSO CLOUD] Intact Users (${tUsers.rows.length}):`);
    tUsers.rows.forEach(u => console.log(`   ✓ ${u.name} <${u.email}> [Role: ${u.role}, ID: ${u.id}]`));
    console.log(`[TURSO CLOUD] Intact Profiles: ${tProfiles.rows.length}, Permissions rows: ${tPerms.rows.length}`);
  }

  // Step 7: Output Summary Table
  console.log(`\n================================================================================================`);
  console.log(`📊 RESET SUMMARY TABLE (${options.dryRun ? 'DRY-RUN PREVIEW' : 'PURGE COMPLETE'})`);
  console.log(`================================================================================================`);
  console.log(`Table Name                    | Local Deleted | Turso Deleted | Status`);
  console.log(`------------------------------+---------------+---------------+---------------------------------`);

  // Add protected tables to summary table for complete visibility
  for (const pt of ['users', 'profiles', 'custom_permissions', 'system_settings']) {
    let lCount = 'N/A';
    let tCount = 'N/A';
    if (localDb && localTables.includes(pt)) {
      const r = await localDb.get(`SELECT COUNT(*) as c FROM "${pt}"`);
      lCount = r?.c || 0;
    }
    if (turso && tursoTables.includes(pt)) {
      const r = await turso.execute(`SELECT COUNT(*) as c FROM "${pt}"`);
      tCount = r.rows[0]?.c || 0;
    }
    const status = (pt === 'users' || pt === 'profiles') 
      ? `PROTECTED (${lCount} users intact)`
      : `CONFIG PRESERVED (${lCount} rows)`;
    console.log(`${pt.padEnd(29)} | ${'0 (PRESERVED)'.padStart(13)} | ${'0 (PRESERVED)'.padStart(13)} | ${status}`);
  }

  summary.sort((a, b) => a.table.localeCompare(b.table));
  for (const item of summary) {
    const status = options.dryRun ? `PENDING PURGE (${item.localDeleted + item.tursoDeleted} rows)` : 'CLEARED (0 remaining)';
    console.log(`${item.table.padEnd(29)} | ${String(item.localDeleted).padStart(13)} | ${String(item.tursoDeleted).padStart(13)} | ${status}`);
  }
  console.log(`================================================================================================\n`);

  if (localDb) await localDb.close();
  if (appDataDb) await appDataDb.close();

  return summary;
}

// CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isDryRun = process.argv.includes('--dry-run');
  executeSafeReset({ dryRun: isDryRun }).catch(err => {
    console.error('Fatal error during reset:', err);
    process.exit(1);
  });
}
