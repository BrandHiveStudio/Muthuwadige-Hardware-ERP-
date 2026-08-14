import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceDbPath = path.join(__dirname, '..', 'hardware.db');
const backupsDir = path.join(__dirname, '..', 'backups');
const appDataDbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'ERP-Template', 'hardware.db');

if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

// 1. Create Timestamped Backup
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(backupsDir, `full_handover_reset_${timestamp}.db`);

if (fs.existsSync(workspaceDbPath)) {
  fs.copyFileSync(workspaceDbPath, backupPath);
  console.log(`✅ Backup created at: ${backupPath}`);
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

wipeDatabase(workspaceDbPath, 'Workspace DB');
wipeDatabase(appDataDbPath, 'AppData DB');
