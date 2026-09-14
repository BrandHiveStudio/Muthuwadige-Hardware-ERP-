/**
 * Offline Server CLI Maintenance Script: System Factory Reset
 * 
 * PURPOSE:
 * Allows terminal administrators to perform an offline reset of transactional
 * and operational business data on local SQLite database files while strictly
 * preserving Root Admin credentials (sanojhardware@gmail.com / super_admin)
 * and core hardware settings.
 * 
 * USAGE:
 * node scripts/offline-reset.cjs [--confirm]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const projectRoot = path.resolve(__dirname, '..');
const localDbPath = path.join(projectRoot, 'hardware.db');
const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const appDataDbPath = path.join(appDataRoot, 'Muthuwadige Hardware ERP', 'hardware.db');

// Tables to clear during operational wipe
const OPERATIONAL_TABLES = [
  'sale_items',
  'sales',
  'sales_return_items',
  'sales_returns',
  'bill_holds',
  'quotations',
  'quotation_items',
  'delivery_notes',
  'purchase_order_items',
  'purchase_orders',
  'supplier_transactions',
  'purchase_return_items',
  'purchase_returns',
  'debit_notes',
  'customer_transactions',
  'credit_payments',
  'credit_notes',
  'credit_note_usage',
  'transactions',
  'cash_book',
  'cheques',
  'cheque_registry',
  'stock_adjustments',
  'shift_logs',
  'sync_queue',
  'audit_logs',
  'backup_logs'
];

async function resetDbFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`[Offline Reset] Database file does not exist at: ${filePath} (Skipping)`);
    return;
  }

  console.log(`\n========================================================`);
  console.log(`[Offline Reset] Processing database: ${filePath}`);
  console.log(`========================================================`);

  // Create a backup snapshot before wipe
  const backupSnapshot = `${filePath}.bak_${Date.now()}`;
  try {
    fs.copyFileSync(filePath, backupSnapshot);
    console.log(`[Offline Reset] Safety backup snapshot saved: ${backupSnapshot}`);
  } catch (err) {
    console.warn(`[Offline Reset] Notice creating backup snapshot: ${err.message}`);
  }

  const db = await open({
    filename: filePath,
    driver: sqlite3.Database
  });

  try {
    await db.run('PRAGMA foreign_keys = OFF;');

    for (const table of OPERATIONAL_TABLES) {
      try {
        const tableCheck = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
        if (tableCheck) {
          await db.run(`DELETE FROM ${table};`);
          console.log(`  ✓ Cleared table: ${table}`);
        }
      } catch (tableErr) {
        console.warn(`  ! Notice on table ${table}: ${tableErr.message}`);
      }
    }

    // Preserve Root Admin accounts only
    try {
      await db.run("DELETE FROM users WHERE LOWER(email) != 'sanojhardware@gmail.com' AND role != 'super_admin';");
      console.log(`  ✓ Cleared non-root users`);
    } catch (_) { }

    try {
      await db.run("DELETE FROM profiles WHERE LOWER(email) != 'sanojhardware@gmail.com' AND role != 'super_admin';");
      console.log(`  ✓ Cleared non-root profiles`);
    } catch (_) { }

    try {
      await db.run("DELETE FROM custom_permissions WHERE user_id NOT IN (SELECT id FROM users WHERE LOWER(email) = 'sanojhardware@gmail.com' OR role = 'super_admin');");
      console.log(`  ✓ Reset custom permissions`);
    } catch (_) { }

    // Update system wipe timestamp in system_settings
    const wipeTimestamp = Math.floor(Date.now() / 1000).toString();
    try {
      await db.run(`
        CREATE TABLE IF NOT EXISTS system_settings (
          id TEXT PRIMARY KEY,
          key TEXT,
          value TEXT,
          system_wipe_timestamp TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await db.run(
        `INSERT OR REPLACE INTO system_settings (id, key, value, system_wipe_timestamp, updated_at) 
         VALUES ('SYSTEM_WIPE_TIMESTAMP', 'SYSTEM_WIPE_TIMESTAMP', ?, ?, CURRENT_TIMESTAMP);`,
        [wipeTimestamp, wipeTimestamp]
      );
      console.log(`  ✓ System wipe timestamp updated: ${wipeTimestamp}`);
    } catch (setErr) {
      console.warn(`  ! Notice updating system_settings: ${setErr.message}`);
    }

    // Vacuum database
    try {
      await db.run('VACUUM;');
      console.log(`  ✓ Database vacuumed and optimized`);
    } catch (_) { }

    await db.run('PRAGMA foreign_keys = ON;');
    console.log(`✅ [Offline Reset] Completed for: ${filePath}`);
  } finally {
    await db.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const isConfirmed = args.includes('--confirm') || args.includes('-y');

  if (!isConfirmed) {
    console.log(`
⚠️  OFFLINE FACTORY RESET CLI SCRIPT ⚠️
This script will wipe all operational data (sales, POs, returns, credit, transactions, staff accounts)
from the local SQLite databases while strictly preserving the Root Administrator.

To execute, run:
  node scripts/offline-reset.cjs --confirm
`);
    process.exit(0);
  }

  console.log(`[Offline Reset] Starting offline system reset at ${new Date().toISOString()}...`);

  await resetDbFile(localDbPath);
  await resetDbFile(appDataDbPath);

  console.log(`\n🎉 Offline reset complete. The server can now be started safely.`);
}

main().catch(err => {
  console.error('❌ Fatal error during offline reset:', err);
  process.exit(1);
});
