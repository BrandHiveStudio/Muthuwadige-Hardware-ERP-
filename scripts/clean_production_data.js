import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceDbPath = path.join(__dirname, '..', 'hardware.db');
const backupsDir = path.join(__dirname, '..', 'backups');
const appDataDbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'magic-patterns-vite-template', 'hardware.db');

if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

// 1. Create Timestamped Pre-Handover Backup
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupsDir, `pre_handover_backup_${timestamp}.db`);

if (fs.existsSync(workspaceDbPath)) {
  fs.copyFileSync(workspaceDbPath, backupPath);
  console.log(`✅ Pre-handover database backup created successfully: ${backupPath}`);
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

    // Optimize database space
    db.run(`VACUUM`, (err) => {
      if (err) {
        console.error('  ❌ VACUUM error:', err.message);
      } else {
        console.log('  ✓ Database VACUUM complete (optimized DB file size)');
      }
    });
  });

  db.close(() => {
    console.log(`✅ Production data cleanup complete for [${label}].`);
  });
};

cleanDatabase(workspaceDbPath, 'Workspace DB');
cleanDatabase(appDataDbPath, 'AppData DB');
