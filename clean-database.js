import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbs = [
  path.join(__dirname, 'hardware.db'),
  process.env.APPDATA ? path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', 'hardware.db') : null
].filter(Boolean);

const tablesToClear = [
  'sales', 'sales_returns', 'credit_payments', 'credit_notes', 'credit_note_usage',
  'cheque_registry', 'purchase_returns', 'purchase_return_items',
  'transactions', 'audit_logs', 'bill_holds', 'quotations', 'delivery_notes',
  'purchase_orders', 'products', 'customers', 'suppliers', 'employees',
  'backup_logs', 'stock_adjustments'
];

async function main() {
  for (const dbPath of dbs) {
    if (fs.existsSync(dbPath)) {
      console.log('Cleaning database:', dbPath);
      try {
        const db = await open({ filename: dbPath, driver: sqlite3.Database });
        for (const table of tablesToClear) {
          try {
            await db.run('DELETE FROM ' + table);
            console.log('  Cleared table:', table);
          } catch (err) {
            console.log('  Table ' + table + ' missing or error:', err.message);
          }
        }
        try {
          await db.run("UPDATE system_settings SET next_invoice_number = 'INV001'");
          console.log('  Reset invoice counter to INV001');
        } catch (err) {}
        await db.close();
        console.log('  Database clean finished successfully for:', dbPath);
      } catch(err) {
        console.error('  Failed to clean db at ' + dbPath + ':', err.message);
      }
    }
  }

  const backupDirs = [
    path.join(__dirname, 'backups'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', 'backups') : null
  ].filter(Boolean);

  for (const bDir of backupDirs) {
    if (fs.existsSync(bDir)) {
      const files = fs.readdirSync(bDir);
      for (const f of files) {
        if (f.endsWith('.xlsx')) {
          try {
            fs.unlinkSync(path.join(bDir, f));
            console.log('Deleted backup file:', f, 'from', bDir);
          } catch(e) {}
        }
      }
    }
  }

  console.log('✅ ALL TEST AND DEMO DATA CLEANED SUCCESSFULLY!');
}

main();
