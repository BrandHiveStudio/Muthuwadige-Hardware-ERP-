import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Safety check: require explicit destructive operation flag
if (process.env.DESTRUCTIVE_OPERATION !== 'cleanup_production_data') {
  console.error('❌ SAFETY LOCK: This script performs destructive database operations.');
  console.error('To run this script, set the environment variable:');
  console.error('  export DESTRUCTIVE_OPERATION=cleanup_production_data');
  console.error('Then run: node scripts/clean_production_data.js');
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

// 1. Create Timestamped Pre-Handover Backup
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupsDir, `pre_handover_backup_${timestamp}.db`);

console.log('📦 Creating database backup before cleanup...');
if (fs.existsSync(workspaceDbPath)) {
  try {
    fs.copyFileSync(workspaceDbPath, backupPath);
    const backupSize = fs.statSync(backupPath).size;
    console.log(`✅ Pre-handover database backup created successfully: ${backupPath}`);
    console.log(`   Backup size: ${(backupSize / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error('❌ BACKUP FAILED - cleanup will not proceed:', err.message);
    process.exit(1);
  }
}

const cleanDatabase = (dbPath, label) => {
  if (!fs.existsSync(dbPath)) {
    console.log(`⚠️ Database file not found at [${label}]: ${dbPath}`);
    return;
  }

  const db = new sqlite3.Database(dbPath);

  db.serialize(() => {
    console.log(`\n🧹 Starting production data cleanup for [${label}]...`);

    // Clear test transaction tables
    const tablesToClear = [
      'sales',
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
      'transactions',
      'purchase_orders',
      'stock_adjustments',
      'audit_logs',
      'backup_logs',
      'customers',
      'suppliers',
      'employees'
    ];

    tablesToClear.forEach((tbl) => {
      db.run(`DELETE FROM ${tbl}`, (err) => {
        if (err) {
          console.warn(`  Notice: Table ${tbl} clear error:`, err.message);
        } else {
          console.log(`  ✓ Cleared table: ${tbl}`);
        }
      });
    });

    // Restore clean baseline opening stock for products (without deleting product master data)
    db.run(`UPDATE products SET stock = 10`, (err) => {
      if (err) {
        console.error('  ❌ Product stock restore error:', err.message);
      } else {
        console.log('  ✓ Product master data preserved & restored to clean baseline opening stock (stock = 10)');
      }
    });

    // Reset sequence numbering to starting invoice number
    db.run(`UPDATE system_settings SET next_invoice_number = 'INV001' WHERE id = 'global'`, (err) => {
      if (err) {
        console.error('  ❌ Sequence reset error:', err.message);
      } else {
        console.log('  ✓ Invoice sequence reset to INV001 in system_settings');
      }
    });

    // Optimize database space & truncate WAL journal
    db.run(`VACUUM`, (err) => {
      if (err) {
        console.error('  ❌ VACUUM error:', err.message);
      } else {
        console.log('  ✓ Database VACUUM complete (optimized DB file size)');
      }
    });

    db.run(`PRAGMA wal_checkpoint(TRUNCATE)`, (err) => {
      if (!err) console.log('  ✓ SQLite WAL journal truncated');
    });
  });

  db.close(() => {
    console.log(`✅ Production data cleanup complete for [${label}].`);
  });
};

// Interactive confirmation before cleanup
console.log('\n⚠️  WARNING: This script will DELETE transactional data from the database.');
console.log('   Backup has been created at:', backupPath);
console.log('\nThe following tables will be cleared:');
console.log('   sales, bill_holds, sales_returns, credit_notes, customers, suppliers,');
console.log('   employees, transactions, purchase_orders, stock_adjustments, audit_logs,');
console.log('   credit_payments, credit_note_usage, quotations, delivery_notes, backup_logs');
console.log('\nProduct master data will be preserved with stock reset to baseline (10 units).');
console.log('\nType "confirm cleanup" to proceed, or press Ctrl+C to cancel:');

rl.question('> ', (answer) => {
  if (answer.trim() === 'confirm cleanup') {
    console.log('\n✅ Confirmed. Proceeding with database cleanup...\n');
    cleanDatabase(workspaceDbPath, 'Workspace DB');
    cleanDatabase(appDataDbPath, 'AppData DB');
    rl.close();
  } else {
    console.log('\n❌ Cleanup cancelled. No changes made.');
    rl.close();
    process.exit(0);
  }
});
