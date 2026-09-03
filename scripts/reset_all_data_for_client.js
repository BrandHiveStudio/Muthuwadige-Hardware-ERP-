import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Safety check: require explicit destructive operation flag
if (process.env.DESTRUCTIVE_OPERATION !== 'reset_all_data_for_client') {
  console.error('❌ SAFETY LOCK: This script performs destructive database operations.');
  console.error('To run this script, set the environment variable:');
  console.error('  export DESTRUCTIVE_OPERATION=reset_all_data_for_client');
  console.error('Then run: node scripts/reset_all_data_for_client.js');
  process.exit(1);
}

const workspaceDbPath = path.join(__dirname, '..', 'hardware.db');
const backupsDir = path.join(__dirname, '..', 'backups');
const appDataDbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'ERP-Template', 'hardware.db');

if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

// Interactive confirmation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 1. Create Timestamped Backup
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupsDir, `full_handover_reset_${timestamp}.db`);

console.log('📦 Creating complete database backup before reset...');
if (fs.existsSync(workspaceDbPath)) {
  try {
    fs.copyFileSync(workspaceDbPath, backupPath);
    const backupSize = fs.statSync(backupPath).size;
    console.log(`✅ Backup created successfully: ${backupPath}`);
    console.log(`   Backup size: ${(backupSize / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error('❌ BACKUP FAILED - reset will not proceed:', err.message);
    process.exit(1);
  }
}

const wipeDatabase = (dbPath, label) => {
  if (!fs.existsSync(dbPath)) {
    console.log(`⚠️ Database file not found at [${label}]: ${dbPath}`);
    return;
  }

  const db = new sqlite3.Database(dbPath);

  db.serialize(() => {
    console.log(`\n🧹 Performing COMPLETE DATA RESET for [${label}]...`);

    const tablesToWipe = [
      'products',
      'sales',
      'customers',
      'suppliers',
      'employees',
      'transactions',
      'purchase_orders',
      'stock_adjustments',
      'bill_holds',
      'sales_returns',
      'credit_notes',
      'credit_payments',
      'credit_note_usage',
      'cheque_registry',
      'purchase_returns',
      'purchase_return_items',
      'quotations',
      'delivery_notes',
      'audit_logs',
      'backup_logs',
      'branches'
    ];

    tablesToWipe.forEach((tbl) => {
      db.run(`DELETE FROM ${tbl}`, (err) => {
        if (err) {
          console.warn(`  Notice: Table ${tbl} clear error:`, err.message);
        } else {
          console.log(`  ✓ Wiped all records from table: ${tbl}`);
        }
      });
    });

    // Reset sequence numbering in system_settings
    db.run(`UPDATE system_settings SET next_invoice_number = 'INV001' WHERE id = 'global'`, (err) => {
      if (err) {
        console.error('  ❌ Sequence reset error:', err.message);
      } else {
        console.log('  ✓ Reset next_invoice_number to INV001');
      }
    });

    // Wipe audit logs completely
    db.run(`DELETE FROM audit_logs`, (err) => {
      if (!err) console.log('  ✓ Wiped all audit logs');
    });

    // Vacuum database & truncate WAL log
    db.run(`VACUUM`, (err) => {
      if (err) {
        console.error('  ❌ VACUUM error:', err.message);
      } else {
        console.log('  ✓ Database VACUUM complete');
      }
    });

    db.run(`PRAGMA wal_checkpoint(TRUNCATE)`, (err) => {
      if (!err) console.log('  ✓ SQLite WAL journal truncated');
    });
  });

  db.close(() => {
    console.log(`✅ Complete data reset finished for [${label}].`);
  });
};

// Interactive confirmation before reset
console.log('\n⚠️  WARNING: This script will COMPLETELY RESET the database.');
console.log('   All transactional and master data will be deleted.');
console.log('   Backup has been created at:', backupPath);
console.log('\nThe following tables will be wiped:');
console.log('   products, sales, customers, suppliers, employees, transactions,');
console.log('   purchase_orders, stock_adjustments, bill_holds, sales_returns,');
console.log('   credit_notes, credit_payments, credit_note_usage, quotations,');
console.log('   delivery_notes, audit_logs, backup_logs, branches');
console.log('\nThis operation CANNOT be undone without restoring from backup.');
console.log('\nType "confirm full reset" to proceed, or press Ctrl+C to cancel:');

rl.question('> ', (answer) => {
  if (answer.trim() === 'confirm full reset') {
    console.log('\n✅ Confirmed. Proceeding with complete database reset...\n');
    wipeDatabase(workspaceDbPath, 'Workspace DB');
    wipeDatabase(appDataDbPath, 'AppData DB');
    rl.close();
  } else {
    console.log('\n❌ Reset cancelled. No changes made.');
    rl.close();
    process.exit(0);
  }
});
