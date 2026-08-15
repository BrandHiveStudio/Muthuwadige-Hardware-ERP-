#!/usr/bin/env node

/**
 * Backup Worker Process
 * Executes database backup, Excel generation, and email delivery
 * Spawned by main Express server to prevent blocking
 */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import XLSX from 'xlsx-js-style';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let DB_FILE = path.join(__dirname, 'hardware.db');
let backupsDir = path.join(__dirname, 'backups');
let envPath = path.join(__dirname, '.env');

// Check if running in Electron packaged app
try {
  const electron = await import('electron');
  const electronApp = electron.app || (electron.default && electron.default.app);
  if (electronApp && electronApp.isPackaged) {
    const appDataPath = electronApp.getPath('userData');
    DB_FILE = path.join(appDataPath, 'hardware.db');
    backupsDir = path.join(appDataPath, 'backups');
    envPath = path.join(appDataPath, '.env');
  }
} catch (e) {
  // Standalone Node.js
}

dotenv.config({ path: envPath });

const LOCK_FILE = path.join(backupsDir, '.backup.lock');

// Logging
const log = (msg) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [BACKUP-WORKER] ${msg}`);
};

const logError = (msg) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [BACKUP-WORKER] ERROR: ${msg}`);
};

// Cross-platform process detection
const isProcessStillRunning = (pid) => {
  if (!pid || typeof pid !== 'number' || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false;
    return true; // Assume running if we can't determine
  }
};

// Lock management with stale detection
const acquireLock = () => {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lockContent = fs.readFileSync(LOCK_FILE, 'utf8');
      const lockPid = parseInt(lockContent.trim());

      if (!isNaN(lockPid) && isProcessStillRunning(lockPid)) {
        log(`Backup already running (PID: ${lockPid}). Skipping.`);
        return false;
      } else {
        log(`Detected stale lock (PID: ${lockPid}). Removing.`);
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch (err) {
          logError(`Failed to remove stale lock: ${err.message}`);
        }
      }
    }

    fs.mkdirSync(backupsDir, { recursive: true });
    fs.writeFileSync(LOCK_FILE, process.pid.toString());
    return true;
  } catch (err) {
    logError(`Failed to acquire lock: ${err.message}`);
    return false;
  }
};

const releaseLock = () => {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch (err) {
    logError(`Failed to release lock: ${err.message}`);
  }
};

// Database connection
async function openDatabase() {
  try {
    log(`Opening database: ${DB_FILE}`);
    const db = await open({
      filename: DB_FILE,
      driver: sqlite3.Database
    });
    await db.exec("PRAGMA busy_timeout = 15000;");
    await db.exec("PRAGMA journal_mode = WAL;");
    await db.exec("PRAGMA synchronous = NORMAL;");
    log('Database opened successfully');
    return db;
  } catch (err) {
    logError(`Failed to open database: ${err.message}`);
    throw err;
  }
}

// Utility functions
const isDecimalUnit = (unit) => {
  if (!unit) return false;
  const decimals = ['kg', 'g', 'liters', 'ml', 'meters'];
  return decimals.includes(unit.toLowerCase().trim());
};

// Parse command line arguments
const args = process.argv.slice(2);
let targetEmail = null;
let backupType = 'Manual';
let fromDate = null;
let toDate = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--email') targetEmail = args[++i];
  if (args[i] === '--type') backupType = args[++i];
  if (args[i] === '--fromDate') fromDate = args[++i];
  if (args[i] === '--toDate') toDate = args[++i];
}

if (!targetEmail) {
  logError('No target email provided');
  process.exit(1);
}

// Main backup execution
async function runBackup() {
  if (!acquireLock()) {
    process.exit(0); // Lock exists, skip
  }

  let db = null;
  try {
    db = await openDatabase();

    const dateStr = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const fileName = `Backup_${dateStr}.xlsx`;
    const filePath = path.join(backupsDir, fileName);

    // Fetch all necessary data
    log('Fetching backup data from database...');
    const [customers, sales, products, profiles, employees, suppliers, purchaseOrders] = await Promise.all([
      db.all('SELECT * FROM customers'),
      db.all('SELECT * FROM sales'),
      db.all('SELECT * FROM products'),
      db.all('SELECT * FROM profiles'),
      db.all('SELECT * FROM employees'),
      db.all('SELECT * FROM suppliers'),
      db.all('SELECT * FROM purchase_orders')
    ]);

    // Create Excel workbook
    log('Generating Excel backup file...');
    const wb = XLSX.utils.book_new();

    // Add sheets (overview, data tables, etc.)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customers || []), 'Customers');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sales || []), 'Sales');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(products || []), 'Products');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(profiles || []), 'Profiles');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(employees || []), 'Employees');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(suppliers || []), 'Suppliers');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(purchaseOrders || []), 'Purchase Orders');

    XLSX.writeFile(wb, filePath);
    log(`Excel file created: ${filePath}`);

    // Send email with backup
    log(`Sending backup email to ${targetEmail}...`);
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: targetEmail,
      subject: `Hardware ERP Backup - ${new Date().toISOString().split('T')[0]}`,
      text: `Attached is your automated backup of the Hardware ERP database.`,
      attachments: [{ filename: fileName, path: filePath }]
    });

    log(`Email sent successfully to ${targetEmail}`);

    // Save success to backup_logs
    await db.run(
      'INSERT INTO backup_logs (id, file_name, file_path, status, type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      [`b_${Date.now()}`, fileName, filePath, 'Success', backupType, new Date().toISOString()]
    );

    log('Backup completed successfully');
    releaseLock();
    process.exit(0);

  } catch (err) {
    logError(`Backup failed: ${err.message}`);
    try {
      if (db) {
        await db.run(
          'INSERT INTO backup_logs (id, file_name, file_path, status, type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
          [`b_${Date.now()}`, 'Error_Backup', 'N/A', 'Failed', backupType, new Date().toISOString()]
        );
      }
    } catch (dbErr) {
      logError(`Failed to log error: ${dbErr.message}`);
    }
    releaseLock();
    process.exit(1);
  } finally {
    if (db) await db.close();
  }
}

runBackup();
