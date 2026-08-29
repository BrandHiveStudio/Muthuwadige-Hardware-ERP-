import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import XLSX from 'xlsx-js-style';
import { createMailTransporter, sendResetEmail as mailerSendResetEmail, sendNotificationEmail as mailerSendNotificationEmail, sendBackupEmail as mailerSendBackupEmail } from './src/utils/mailer.js';
import fs from 'fs';
import dotenv from 'dotenv';
import { exec, execSync, spawn } from 'child_process';
import os from 'os';
import https from 'https';
import selfsigned from 'selfsigned';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let DB_FILE = path.join(__dirname, 'hardware.db');
let backupsDir = path.join(__dirname, 'backups');
let envPath = path.join(__dirname, '.env');
let USER_DATA_PATH = process.env.USER_DATA_PATH || '';

// Dynamically check if running inside Electron / Node-in-Electron to write databases, backups & env configs to Local AppData
const isNodeInElectron = process.env.ELECTRON_RUN_AS_NODE === '1';
const isProduction = process.env.NODE_ENV === 'production';

if (!USER_DATA_PATH && (isNodeInElectron || isProduction)) {
  const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  USER_DATA_PATH = path.join(appDataRoot, 'Muthuwadige Hardware ERP');
}

let electronApp = null;
try {
  const electron = await import('electron');
  electronApp = electron.app || (electron.default && electron.default.app) || null;
} catch (e) {
  // Silent fallback for standalone Node environments
}

const isPackagedApp = (electronApp && electronApp.isPackaged) || isNodeInElectron || (isProduction && Boolean(USER_DATA_PATH));

if (isPackagedApp && USER_DATA_PATH) {
  // Ensure target AppData directory exists before database initialization
  if (!fs.existsSync(USER_DATA_PATH)) {
    fs.mkdirSync(USER_DATA_PATH, { recursive: true });
  }

  DB_FILE = path.join(USER_DATA_PATH, 'hardware.db');
  backupsDir = path.join(USER_DATA_PATH, 'backups');
  envPath = path.join(USER_DATA_PATH, '.env');

  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  console.log('📂 Production Electron database path:', DB_FILE);

  // Auto-migrate env config: copy .env from bundled code to AppData folder
  const bundledEnv = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath) && fs.existsSync(bundledEnv)) {
    try {
      fs.copyFileSync(bundledEnv, envPath);
      console.log('✅ .env file successfully initialized in AppData:', envPath);
    } catch (err) {
      console.error('❌ Failed to copy .env to AppData path:', err);
    }
  }
} else {
  // In development mode, write directly to the workspace folder so that changes are saved permanently in the repository
  DB_FILE = path.join(__dirname, 'hardware.db');
  backupsDir = path.join(__dirname, 'backups');
  envPath = path.join(__dirname, '.env');
}

dotenv.config({ path: envPath });

const app = express();
const PORT = process.env.PORT || 5001;
const HTTPS_PORT = process.env.HTTPS_PORT || 5443;

const allowedOrigins = [
  'https://hardware-store-psi.vercel.app',
  'https://hardware-store-production-v2.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(null, true); // Fallback for local desktop / dev
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Global Request Logging Middleware
app.use((req, res, next) => {
  const reqId = ++requestCounter;
  const reqStart = Date.now();
  console.log(`[API] Request received #${reqId} | ${req.method} ${req.originalUrl} | Timestamp: ${new Date().toISOString()}`);
  res.on('finish', () => {
    console.log(`[API] Response sent #${reqId} | ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | Duration: ${Date.now() - reqStart}ms`);
  });
  next();
});
app.get('/backups/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);

  const candidateDirs = [
    backupsDir,
    path.join(__dirname, 'backups'),
    USER_DATA_PATH ? path.join(USER_DATA_PATH, 'backups') : null,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', 'backups') : null
  ].filter(Boolean);

  let foundPath = null;
  for (const dir of candidateDirs) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) {
      foundPath = candidate;
      break;
    }
  }

  if (foundPath) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.sendFile(foundPath);
  } else {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Backup File Not Found</title>
          <meta charset="utf-8">
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
            .card { text-align: center; max-width: 480px; padding: 40px 32px; background: #1e293b; border-radius: 16px; border: 1px solid #334155; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
            .icon { font-size: 48px; margin-bottom: 16px; }
            h2 { color: #f43f5e; margin: 0 0 12px 0; font-size: 22px; font-weight: 800; }
            p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0; }
            code { background: #0f172a; padding: 2px 6px; border-radius: 4px; color: #f1f5f9; font-size: 13px; }
            .btn { display: inline-block; padding: 10px 20px; background: #3b82f6; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">📁</div>
            <h2>Backup File Missing</h2>
            <p>The requested backup file <code>${filename}</code> could not be located in the backup directory. It may have been moved or deleted.</p>
            <a href="javascript:window.close()" class="btn">Close Window</a>
          </div>
        </body>
      </html>
    `);
  }
});

// Express request timeout middleware (prevents hanging HTTP sockets)
app.use((req, res, next) => {
  res.setTimeout(25000, () => {
    if (!res.headersSent) {
      console.error(`[Server Timeout] Request to ${req.method} ${req.url} timed out after 25s.`);
      res.status(504).json({ error: 'Server request timed out. Please retry.' });
    }
  });
  next();
});

let requestCounter = 0;
let txnCounter = 0;

async function beginTxn(database, label = '') {
  const txnId = ++txnCounter;
  const start = Date.now();
  console.log(`[DB] [BEGIN #${txnId}] Query started: ${label} | Timestamp: ${new Date().toISOString()}`);
  await database.run('BEGIN TRANSACTION');
  return { id: txnId, label, start };
}

async function commitTxn(database, txn) {
  await database.run('COMMIT');
  console.log(`[DB] [COMMIT #${txn.id}] Query completed: ${txn.label} | Duration: ${Date.now() - txn.start}ms`);
}

async function rollbackTxn(database, txn) {
  try {
    if (database) await database.run('ROLLBACK');
    console.log(`[DB] [ROLLBACK #${txn?.id || 0}] Transaction rolled back: ${txn?.label || ''} | Duration: ${Date.now() - (txn?.start || Date.now())}ms`);
  } catch (err) {}
}

// Helper to safely rollback transactions without throwing uncaught exceptions
async function safeRollback(database) {
  try {
    if (database) await database.run('ROLLBACK');
  } catch (_) {}
}

const isDecimalUnit = (unit) => {
  if (!unit) return false;
  const PREDEFINED_UNITS = ['pcs', 'kg', 'g', 'liters', 'ml', 'meters', 'boxes', 'packets', 'rolls', 'bundles'];
  const decimals = ['kg', 'g', 'liters', 'ml', 'meters'];
  const name = unit.toLowerCase().trim();
  return decimals.includes(name) || !PREDEFINED_UNITS.includes(name);
};

let db;

const SUPER_ADMIN = {
  id: 'u1',
  name: 'Sanoj Hardware',
  email: 'sanojhardware@gmail.com',
  role: 'super_admin',
  avatar: 'S',
  password: 'sanoj123'
};

const LEGACY_PRODUCT_SKUS = [
  'PD-001',
  'HM-001',
  'PP-001',
  'CB-001',
  'WS-001',
  'PB-001',
  'MT-001',
  'SH-001',
  'AG-001',
  'PE-001',
  'WR-001',
  'SP-001',
  'LV-001',
  'WG-001',
  'CG-001'
];

export async function checkpointWal() {
  if (db) {
    try {
      await db.exec('PRAGMA wal_checkpoint(FULL);');
      console.log('✅ SQLite WAL Checkpoint executed successfully.');
    } catch (err) {
      console.error('❌ Failed to execute WAL Checkpoint:', err);
    }
  }
}

async function ensureSuperAdminProfile() {
  const existing = await db.get('SELECT * FROM profiles WHERE id = ?', [SUPER_ADMIN.id]);

  if (!existing) {
    await db.run(
      'INSERT INTO profiles (id, name, email, role, avatar, password) VALUES (?, ?, ?, ?, ?, ?)',
      [SUPER_ADMIN.id, SUPER_ADMIN.name, SUPER_ADMIN.email, SUPER_ADMIN.role, SUPER_ADMIN.avatar, SUPER_ADMIN.password]
    );
    console.log(`[Startup] Seeded Super Admin profile: ${SUPER_ADMIN.email}`);
  } else if (
    existing.name !== SUPER_ADMIN.name ||
    existing.role !== SUPER_ADMIN.role ||
    existing.avatar !== SUPER_ADMIN.avatar
  ) {
    await db.run(
      'UPDATE profiles SET name = ?, role = ?, avatar = ? WHERE id = ?',
      [SUPER_ADMIN.name, SUPER_ADMIN.role, SUPER_ADMIN.avatar, SUPER_ADMIN.id]
    );
    console.log(`[Startup] Updated Super Admin profile details (excluding email & password): ${existing.email}`);
  }
}

async function cleanupLegacyProducts() {
  const placeholders = LEGACY_PRODUCT_SKUS.map(() => '?').join(', ');
  const result = await db.run(`DELETE FROM products WHERE sku IN (${placeholders})`, LEGACY_PRODUCT_SKUS);
  if (result?.changes > 0) {
    console.log(`[Startup] Removed ${result.changes} legacy hardcoded product record(s).`);
  }
}

const DEFAULT_RUNTIME_SETTINGS = {
  id: 'global',
  shop_name: 'MUTHUWADIGE HARDWARE',
  address: 'No: 80, Mahahunupitiya, Negombo',
  phone: '077 076 076 7',
  email: 'sanojhardware@gmail.com',
  currency: 'Rs.',
  tax_rate: 0,
  backup_email: 'sanojhardware@gmail.com',
  backup_enabled: 0,
  backup_interval_hours: 6,
  next_invoice_number: 'INV001',
  return_passkey: '1234',
  void_passkey: '1234',
  updated_at: new Date().toISOString()
};

let runtimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };
let runtimeTransactions = [];
let runtimeEmployees = [];

async function logAudit(userEmail, action, details) {
  const id = 'al_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const timestamp = new Date().toISOString();
  try {
    await db.run(
      'INSERT INTO audit_logs (id, user_email, action, details, timestamp) VALUES (?, ?, ?, ?, ?)',
      [id, userEmail || 'system', action, details, timestamp]
    );
  } catch (err) {
    console.error('Failed to log audit:', err);
  }
}

function safeParseJson(str, fallback = {}) {
  if (!str) return fallback;
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch (e) {
    return fallback;
  }
}

function normalizeRuntimeSettings(payload = {}) {
  const passkeyVal = (
    payload.return_passkey ||
    payload.returnPasskey ||
    payload.void_passkey ||
    payload.voidPasskey ||
    DEFAULT_RUNTIME_SETTINGS.return_passkey ||
    '1234'
  ).toString().trim();

  let rawInterval = payload.backup_interval_hours ?? payload.backupIntervalHours ?? payload.backup_interval ?? DEFAULT_RUNTIME_SETTINGS.backup_interval_hours;
  let intervalHours = Number(rawInterval);
  if (isNaN(intervalHours) || !Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 168) {
    intervalHours = 6;
  }

  const normalized = {
    ...DEFAULT_RUNTIME_SETTINGS,
    ...payload,
    id: payload.id || 'global',
    shop_name: payload.shop_name || payload.shopName || DEFAULT_RUNTIME_SETTINGS.shop_name,
    address: payload.address || '',
    phone: payload.phone || '',
    email: payload.email || '',
    currency: payload.currency || DEFAULT_RUNTIME_SETTINGS.currency,
    tax_rate: payload.tax_rate !== undefined ? Number(payload.tax_rate) : Number(payload.taxRate ?? DEFAULT_RUNTIME_SETTINGS.tax_rate),
    backup_email: payload.backup_email || payload.backupEmail || '',
    backup_enabled: payload.backup_enabled === true || payload.backup_enabled === 1 || payload.backupEnabled === true ? 1 : 0,
    backup_interval_hours: intervalHours,
    logo_path: payload.logo_path || payload.logoPath || '',
    printer_settings: safeParseJson(payload.printer_settings || payload.printerSettings),
    branch_settings: safeParseJson(payload.branch_settings || payload.branchSettings),
    next_invoice_number: payload.next_invoice_number || payload.nextInvoiceNumber || DEFAULT_RUNTIME_SETTINGS.next_invoice_number,
    return_passkey: passkeyVal,
    void_passkey: passkeyVal,
    updated_at: payload.updated_at || new Date().toISOString()
  };

  return normalized;
}

async function getRuntimeSettingsSnapshot() {
  let settings = await db.get('SELECT * FROM system_settings WHERE id = ?', ['global']);
  if (!settings) {
    const initial = { ...DEFAULT_RUNTIME_SETTINGS, id: 'global' };
    await db.run(
      'INSERT INTO system_settings (id, shop_name, address, phone, email, currency, tax_rate, backup_email, backup_enabled, backup_interval_hours, logo_path, printer_settings, branch_settings, next_invoice_number, return_passkey, void_passkey, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [initial.id, initial.shop_name, initial.address, initial.phone, initial.email, initial.currency, initial.tax_rate, initial.backup_email, initial.backup_enabled, initial.backup_interval_hours, '', '', '', initial.next_invoice_number, initial.return_passkey, initial.void_passkey, initial.updated_at]
    );
    settings = initial;
  }
  return normalizeRuntimeSettings(settings);
}

async function setRuntimeSettings(payload = {}) {
  const current = await getRuntimeSettingsSnapshot();
  const updated = normalizeRuntimeSettings({ ...current, ...payload });
  await db.run(
    `INSERT OR REPLACE INTO system_settings (
      id,
      shop_name, 
      address, 
      phone, 
      email, 
      currency, 
      tax_rate, 
      backup_email, 
      backup_enabled, 
      backup_interval_hours,
      logo_path, 
      printer_settings, 
      branch_settings, 
      next_invoice_number,
      return_passkey,
      void_passkey,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'global',
      updated.shop_name,
      updated.address,
      updated.phone,
      updated.email,
      updated.currency,
      updated.tax_rate,
      updated.backup_email,
      updated.backup_enabled,
      updated.backup_interval_hours,
      updated.logo_path || '',
      typeof updated.printer_settings === 'object' ? JSON.stringify(updated.printer_settings) : updated.printer_settings || '',
      typeof updated.branch_settings === 'object' ? JSON.stringify(updated.branch_settings) : updated.branch_settings || '',
      updated.next_invoice_number,
      updated.return_passkey,
      updated.void_passkey,
      updated.updated_at
    ]
  );
  return updated;
}

function normalizeRuntimeTransaction(payload = {}) {
  return {
    id: payload.id || `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: payload.type || 'income',
    category: payload.category || 'Other',
    description: payload.description || '',
    amount: Number(payload.amount) || 0,
    date: payload.date || new Date().toLocaleDateString('sv-SE'),
    reference: payload.reference || '',
    user_id: payload.user_id || payload.userId || null,
    created_at: payload.created_at || new Date().toISOString()
  };
}

async function replaceRuntimeTransactionByDescription(description, payload) {
  await db.run('DELETE FROM transactions WHERE description = ?', [description]);
  const t = normalizeRuntimeTransaction({ ...payload, description });
  await db.run(
    'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [t.id, t.type, t.category, t.description, t.amount, t.date, t.reference, t.user_id, t.created_at]
  );
}

async function removeRuntimeTransactionsForSale(invoiceNo) {
  await db.run(
    "DELETE FROM transactions WHERE reference = ? AND (description = ? OR description = ?)",
    [invoiceNo, `POS Sale ${invoiceNo}`, `POS Credit Payment ${invoiceNo}`]
  );
}

async function removeRuntimeTransactionsForPurchaseOrder(poNumber) {
  await db.run(
    "DELETE FROM transactions WHERE reference = ? AND description = ?",
    [poNumber, `Stock Check-in ${poNumber}`]
  );
}

function normalizeRuntimeEmployee(payload = {}) {
  return {
    id: payload.id || `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: payload.name || '',
    role: payload.role || 'Cashier',
    department: payload.department || 'Sales',
    email: payload.email || '',
    phone: payload.phone || '',
    salary: Number(payload.salary) || 0,
    status: payload.status || 'active',
    attendance: Number(payload.attendance) || 100,
    join_date: payload.join_date || payload.joinDate || new Date().toLocaleDateString('sv-SE'),
    user_id: payload.user_id || payload.userId || null,
    created_at: payload.created_at || new Date().toISOString()
  };
}

async function getRuntimeEmployeesSnapshot() {
  const data = await db.all('SELECT * FROM employees ORDER BY name ASC');
  return data.map((employee) => ({
    ...employee,
    attendance: employee.attendance !== undefined ? employee.attendance : 100
  }));
}

// Standard helper to initialize and migrate SQLite tables
async function initializeDatabase() {
  db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database
  });

  await db.exec("PRAGMA busy_timeout = 15000;");
  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA synchronous = NORMAL;");

  console.log('✅ Connected to SQLite Database with WAL mode enabled:', DB_FILE);

  // 1. Create Profiles/Users Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      avatar TEXT,
      password TEXT DEFAULT '123456',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 1.5 Create Custom Permissions Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS custom_permissions (
      role TEXT PRIMARY KEY,
      pages TEXT NOT NULL
    )
  `);

  // 2. Create Products Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      category TEXT,
      price REAL,
      cost_price REAL,
      stock INTEGER DEFAULT 0,
      min_stock INTEGER DEFAULT 5,
      supplier TEXT,
      unit TEXT DEFAULT 'pcs',
      barcode TEXT,
      brand TEXT DEFAULT '',
      serial_no TEXT DEFAULT '',
      batch_code TEXT DEFAULT '',
      expiry_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 3. Create Customers Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      nic TEXT,
      loyalty_points INTEGER DEFAULT 0,
      total_purchases REAL DEFAULT 0,
      join_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 4. Create Sales Orders Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      invoice_no TEXT UNIQUE NOT NULL,
      customer_id TEXT,
      customer_name TEXT,
      items TEXT NOT NULL, -- JSON String of SaleItem[]
      subtotal REAL,
      discount REAL,
      tax REAL,
      tax_rate REAL,
      total_amount REAL,
      status TEXT, -- 'paid' | 'pending' | 'cancelled'
      user_id TEXT,
      payment_method TEXT DEFAULT 'Cash',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      due_date TEXT,
      credit_period_days INTEGER DEFAULT 0,
      payment_received REAL DEFAULT 0,
      client_tx_id TEXT UNIQUE
    )
  `);

  // 5. Create Purchase Orders Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      po_number TEXT UNIQUE NOT NULL,
      supplier_name TEXT,
      items TEXT NOT NULL, -- JSON String of PurchaseItem[]
      total REAL,
      status TEXT, -- 'received' | 'pending' | 'cancelled'
      due_date TEXT,
      user_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 6. Create Persistent Settings Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY,
      shop_name TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      currency TEXT,
      tax_rate REAL,
      backup_email TEXT,
      backup_enabled INTEGER DEFAULT 0,
      backup_interval_hours INTEGER DEFAULT 6,
      logo_path TEXT DEFAULT '',
      printer_settings TEXT DEFAULT '',
      branch_settings TEXT DEFAULT '',
      next_invoice_number TEXT DEFAULT 'INV001',
      return_passkey TEXT DEFAULT '1234',
      void_passkey TEXT DEFAULT '1234',
      updated_at TEXT
    )
  `);

  // 7. Create Persistent Employees Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      department TEXT,
      email TEXT,
      phone TEXT,
      salary REAL,
      status TEXT DEFAULT 'active',
      attendance REAL DEFAULT 100,
      join_date TEXT,
      user_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 8. Create Transactions Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      type TEXT, -- 'income' | 'expense' | 'contra_revenue'
      category TEXT,
      description TEXT,
      amount REAL,
      date TEXT,
      reference TEXT,
      user_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Auto-migrate historical Sales Return transactions from 'expense' to 'contra_revenue'
  try {
    await db.run("UPDATE transactions SET type = 'contra_revenue' WHERE (category = 'Sales Return' OR category = 'Exchange Refund' OR category LIKE 'Sales Return%') AND type = 'expense'");
    
    // Backfill contra_revenue transactions for credit sale returns/exchanges if missing
    const creditReturns = await db.all("SELECT * FROM sales_returns WHERE status = 'active' AND (is_credit = 1 OR return_method IN ('Return', 'Exchange'))");
    for (const r of creditReturns) {
      const isCredit = Boolean(r.is_credit);
      if (isCredit) {
        const existingTx = await db.get("SELECT id FROM transactions WHERE reference = ? AND (category LIKE '%Credit Adjustment%' OR category LIKE 'Sales Return%')", [r.invoice_no]);
        if (!existingTx) {
          const retAmt = Number(r.return_amount || 0);
          const exAmt = Number(r.exchange_amount || 0);
          const netReturnVal = Math.max(0, retAmt - exAmt);
          if (netReturnVal > 0) {
            const txId = 't_sr_bf_' + (r.id || Date.now());
            await db.run(
              'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [txId, 'contra_revenue', 'Sales Return (Credit Adjustment)', `Credit Return Revenue Adjustment for ${r.invoice_no}`, netReturnVal, new Date(r.created_at || Date.now()).toLocaleDateString('sv-SE'), r.invoice_no, r.user_id || 'system']
            );
          }
        }
      }
    }
  } catch (e) {}

  // 9. Create Suppliers Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      credit_terms TEXT,
      payable_balance REAL DEFAULT 0,
      nic TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 10. Create Audit Logs Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_email TEXT,
      action TEXT,
      details TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create SQLite triggers for database auditing
  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_products_update AFTER UPDATE ON products
    BEGIN
      INSERT INTO audit_logs (id, user_email, action, details, timestamp)
      VALUES (
        'al_' || strftime('%s', 'now') || '_' || hex(randomblob(2)),
        'system_trigger',
        'PRODUCT_UPDATED',
        'Product ' || OLD.name || ' (SKU: ' || OLD.sku || ') was updated. Stock: ' || OLD.stock || ' -> ' || NEW.stock || ', Price: ' || OLD.price || ' -> ' || NEW.price,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;
  `);

  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_products_delete AFTER DELETE ON products
    BEGIN
      INSERT INTO audit_logs (id, user_email, action, details, timestamp)
      VALUES (
        'al_' || strftime('%s', 'now') || '_' || hex(randomblob(2)),
        'system_trigger',
        'PRODUCT_DELETED',
        'Product ' || OLD.name || ' (SKU: ' || OLD.sku || ') was deleted.',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;
  `);

  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_customers_update AFTER UPDATE ON customers
    BEGIN
      INSERT INTO audit_logs (id, user_email, action, details, timestamp)
      VALUES (
        'al_' || strftime('%s', 'now') || '_' || hex(randomblob(2)),
        'system_trigger',
        'CUSTOMER_UPDATED',
        'Customer ' || OLD.name || ' details were updated.',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;
  `);

  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_settings_update AFTER UPDATE ON system_settings
    BEGIN
      INSERT INTO audit_logs (id, user_email, action, details, timestamp)
      VALUES (
        'al_' || strftime('%s', 'now') || '_' || hex(randomblob(2)),
        'system_trigger',
        'SETTINGS_UPDATED',
        'System settings were updated.',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;
  `);

  await db.exec(`
    CREATE TRIGGER IF NOT EXISTS audit_suppliers_update AFTER UPDATE ON suppliers
    BEGIN
      INSERT INTO audit_logs (id, user_email, action, details, timestamp)
      VALUES (
        'al_' || strftime('%s', 'now') || '_' || hex(randomblob(2)),
        'system_trigger',
        'SUPPLIER_UPDATED',
        'Supplier ' || OLD.name || ' was updated.',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;
  `);

  // 11. Create Stock Adjustments Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      product_name TEXT,
      old_qty INTEGER,
      new_qty INTEGER,
      reason TEXT, -- 'Discrepancy', 'Damage', 'Sale Return', 'Purchase Return'
      type TEXT, -- 'Adjustment' | 'Damage' | 'Sale Return' | 'Purchase Return'
      user_email TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 12. Create Bill Holds Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bill_holds (
      id TEXT PRIMARY KEY,
      hold_name TEXT,
      customer_id TEXT,
      customer_name TEXT,
      items TEXT,
      subtotal REAL,
      discount REAL,
      tax REAL,
      total_amount REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 13. Create Quotations Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS quotations (
      id TEXT PRIMARY KEY,
      quote_no TEXT UNIQUE,
      customer_name TEXT,
      customer_phone TEXT,
      customer_address TEXT,
      validity_period TEXT DEFAULT '30 Days',
      items TEXT,
      subtotal REAL DEFAULT 0,
      discount_type TEXT DEFAULT 'amount',
      discount_value REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      transportation_fee REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      status TEXT DEFAULT 'Active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 14. Create Delivery Notes Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS delivery_notes (
      id TEXT PRIMARY KEY,
      dn_no TEXT UNIQUE,
      customer_name TEXT,
      items TEXT,
      reference_invoice TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 15. Create Backup Logs Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS backup_logs (
      id TEXT PRIMARY KEY,
      file_name TEXT,
      file_path TEXT,
      status TEXT,
      type TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 16. Create Credit Payments Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS credit_payments (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      invoice_no TEXT,
      customer_id TEXT,
      customer_name TEXT,
      amount_paid REAL NOT NULL,
      remaining_balance REAL NOT NULL,
      payment_method TEXT DEFAULT 'Cash',
      payment_date TEXT DEFAULT CURRENT_TIMESTAMP,
      recorded_by TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      notes TEXT
    )
  `);

  // 17. Create Branches Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      address TEXT,
      phone TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Auto-migrate column additions for author & cashier identity
  try { await db.exec('ALTER TABLE sales ADD COLUMN cashier TEXT;'); } catch (_) {}
  try { await db.exec('ALTER TABLE sales ADD COLUMN user_email TEXT;'); } catch (_) {}
  try { await db.exec('ALTER TABLE sales ADD COLUMN user_name TEXT;'); } catch (_) {}
  try { await db.exec('ALTER TABLE credit_payments ADD COLUMN cashier TEXT;'); } catch (_) {}
  try { await db.exec('ALTER TABLE credit_payments ADD COLUMN user_email TEXT;'); } catch (_) {}

  // Dynamic migration: Ensure new columns exist on existing DB files
  try {
    await db.exec("ALTER TABLE profiles ADD COLUMN password TEXT DEFAULT '123456'");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE profiles ADD COLUMN permissions TEXT");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE profiles ADD COLUMN reset_token TEXT");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE profiles ADD COLUMN reset_token_expiry TEXT");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE customers ADD COLUMN nic TEXT");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE suppliers ADD COLUMN nic TEXT");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE products ADD COLUMN brand TEXT DEFAULT ''");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE products ADD COLUMN serial_no TEXT DEFAULT ''");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE products ADD COLUMN batch_code TEXT DEFAULT ''");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE products ADD COLUMN expiry_date TEXT");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE sales ADD COLUMN payment_method TEXT DEFAULT 'Cash'");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE sales ADD COLUMN due_date TEXT");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE sales ADD COLUMN credit_period_days INTEGER DEFAULT 0");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE sales ADD COLUMN payment_received REAL DEFAULT 0");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE products ADD COLUMN supplier_phone TEXT");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE products ADD COLUMN measure_details TEXT");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE products ADD COLUMN barcode TEXT");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE system_settings ADD COLUMN next_invoice_number TEXT DEFAULT 'INV001'");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE system_settings ADD COLUMN return_passkey TEXT DEFAULT '1234'");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE system_settings ADD COLUMN void_passkey TEXT DEFAULT '1234'");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE system_settings ADD COLUMN backup_interval_hours INTEGER DEFAULT 6");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE system_settings ADD COLUMN label_printer_settings TEXT");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE sales ADD COLUMN transportation_fee REAL DEFAULT 0");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE bill_holds ADD COLUMN transportation_fee REAL DEFAULT 0");
  } catch(e) {}
  try { await db.exec("ALTER TABLE credit_payments ADD COLUMN created_by TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_payments ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN return_no TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN customer_name TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN customer_phone TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN exchange_items TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN return_amount REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN exchange_amount REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN balance_amount REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN customer_paid REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN change_given REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN credit_note_no TEXT"); } catch(e) {}

  try { await db.exec("ALTER TABLE sales ADD COLUMN credit_note_applied REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales ADD COLUMN credit_note_code TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales ADD COLUMN customer_phone TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales ADD COLUMN customer_address TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales ADD COLUMN client_tx_id TEXT"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_client_tx_id ON sales(client_tx_id)"); } catch(e) {}

  await db.exec(`
    CREATE TABLE IF NOT EXISTS credit_notes (
      id TEXT PRIMARY KEY,
      credit_note_no TEXT UNIQUE,
      invoice_no TEXT,
      customer_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      items TEXT,
      amount REAL,
      balance_remaining REAL,
      status TEXT DEFAULT 'active',
      reason TEXT,
      user_id TEXT,
      created_at TEXT
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS credit_note_usage (
      id TEXT PRIMARY KEY,
      credit_note_no TEXT,
      invoice_no TEXT,
      customer_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      amount_applied REAL,
      previous_balance REAL,
      remaining_balance REAL,
      action TEXT DEFAULT 'applied',
      user_email TEXT,
      created_at TEXT
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS sales_returns (
      id TEXT PRIMARY KEY,
      return_no TEXT,
      invoice_no TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      returned_items TEXT,
      exchange_items TEXT,
      return_method TEXT,
      return_amount REAL DEFAULT 0,
      exchange_amount REAL DEFAULT 0,
      balance_amount REAL DEFAULT 0,
      total_refunded REAL DEFAULT 0,
      customer_paid REAL DEFAULT 0,
      change_given REAL DEFAULT 0,
      credit_note_no TEXT,
      user_id TEXT,
      status TEXT DEFAULT 'active',
      reason TEXT,
      created_at TEXT,
      difference_payment_method TEXT DEFAULT 'Cash'
    )
  `);
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN difference_payment_method TEXT DEFAULT 'Cash'"); } catch (e) {}

  // Performance Indexes for fast barcode, invoice, and customer lookups
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_invoice_no ON sales(invoice_no)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales(customer_id)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_credit_notes_no ON credit_notes(credit_note_no)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_returns_inv ON sales_returns(invoice_no)"); } catch(e) {}

  // Phase 2A: Performance optimization indexes
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_credit_notes_status ON credit_notes(status)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_credit_notes_customer_id ON credit_notes(customer_id)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_returns_status ON sales_returns(status)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_audit_logs_action_date ON audit_logs(action, timestamp)"); } catch(e) {}

  // Database Engine Level Constraint Trigger: Prevent negative stock
  try {
    await db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_prevent_negative_product_stock
      BEFORE UPDATE OF stock ON products
      FOR EACH ROW
      WHEN NEW.stock < 0
      BEGIN
        SELECT RAISE(ABORT, 'Database Constraint Violation: Stock cannot drop below 0');
      END;
    `);
  } catch(e) {}

  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN credit_note_no TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN code TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN invoice_no TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN customer_id TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN customer_name TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN customer_phone TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN items TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN amount REAL"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN value REAL"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN balance_remaining REAL"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN status TEXT DEFAULT 'active'"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN reason TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN user_id TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN created_at TEXT"); } catch(e) {}

  try { await db.exec("ALTER TABLE quotations ADD COLUMN customer_phone TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE quotations ADD COLUMN customer_address TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE quotations ADD COLUMN validity_period TEXT DEFAULT '30 Days'"); } catch(e) {}
  try { await db.exec("ALTER TABLE quotations ADD COLUMN subtotal REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE quotations ADD COLUMN discount_type TEXT DEFAULT 'amount'"); } catch(e) {}
  try { await db.exec("ALTER TABLE quotations ADD COLUMN discount_value REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE quotations ADD COLUMN discount_amount REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE quotations ADD COLUMN transportation_fee REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE quotations ADD COLUMN tax_amount REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE quotations ADD COLUMN status TEXT DEFAULT 'Active'"); } catch(e) {}

  // Safe Non-Destructive Schema Migrations for Excel Import & Universal Operations
  try { await db.exec("ALTER TABLE products ADD COLUMN min_stock INTEGER DEFAULT 5"); } catch(e) {}
  try { await db.exec("ALTER TABLE customers ADD COLUMN total_purchases REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE customers ADD COLUMN join_date TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE suppliers ADD COLUMN credit_terms TEXT DEFAULT '30 Days'"); } catch(e) {}
  try { await db.exec("ALTER TABLE suppliers ADD COLUMN payable_balance REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE employees ADD COLUMN department TEXT DEFAULT 'General'"); } catch(e) {}
  try { await db.exec("ALTER TABLE employees ADD COLUMN attendance REAL DEFAULT 100"); } catch(e) {}
  try { await db.exec("ALTER TABLE employees ADD COLUMN join_date TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE employees ADD COLUMN user_id TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE stock_adjustments ADD COLUMN old_qty REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE stock_adjustments ADD COLUMN new_qty REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE stock_adjustments ADD COLUMN user_email TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales ADD COLUMN user_id TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN due_date TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN user_id TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN po_no TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN return_method TEXT"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN total_refunded REAL DEFAULT 0"); } catch(e) {}
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN user_id TEXT"); } catch(e) {}

  await seedInitialData();
}

async function seedInitialData() {
  await ensureSuperAdminProfile();
  await cleanupLegacyProducts();
  
  // Seed settings if empty
  const hasSettings = await db.get('SELECT * FROM system_settings WHERE id = ?', ['global']);
  if (!hasSettings) {
    const initial = { ...DEFAULT_RUNTIME_SETTINGS, id: 'global' };
    await db.run(
      'INSERT INTO system_settings (id, shop_name, address, phone, email, currency, tax_rate, backup_email, backup_enabled, backup_interval_hours, logo_path, printer_settings, branch_settings, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [initial.id, initial.shop_name, initial.address, initial.phone, initial.email, initial.currency, initial.tax_rate, initial.backup_email, initial.backup_enabled, initial.backup_interval_hours, '', '', '', initial.updated_at]
    );
  }

  // Seed custom permissions if empty
  try {
    const permCheck = await db.get('SELECT COUNT(*) as count FROM custom_permissions');
    if (permCheck?.count === 0) {
      const defaultPermissions = {
        super_admin: [
          'dashboard', 'inventory', 'sales', 'purchasing', 'barcode-print', 'barcode_print', 'barcodes',
          'customers', 'suppliers', 'reports', 'users', 'database', 'settings', 'finance', 'audit_logs',
          'sales_create', 'sales_today', 'sales_own_history', 'sales_all_history', 'sales_customer_history',
          'sales_credit_history', 'sales_customer_credit', 'sales_invoice_details', 'sales_payment_status', 'sales_returns',
          'credit_view_history', 'credit_customer_details', 'credit_create_sale', 'credit_record_payment', 'credit_returns',
          'credit_edit', 'credit_delete_void'
        ],
        admin: [
          'dashboard', 'inventory', 'sales', 'purchasing', 'barcode-print', 'barcode_print', 'barcodes', 'customers', 'suppliers', 'reports', 'settings', 'finance',
          'sales_create', 'sales_today', 'sales_own_history', 'sales_all_history', 'sales_customer_history',
          'sales_credit_history', 'sales_customer_credit', 'sales_invoice_details', 'sales_payment_status', 'sales_returns',
          'credit_view_history', 'credit_customer_details', 'credit_create_sale', 'credit_record_payment', 'credit_returns',
          'credit_edit'
        ],
        manager: [
          'dashboard', 'inventory', 'sales', 'purchasing', 'barcode-print', 'barcode_print', 'barcodes', 'customers', 'suppliers', 'reports', 'finance',
          'sales_create', 'sales_today', 'sales_own_history', 'sales_all_history', 'sales_customer_history',
          'sales_credit_history', 'sales_customer_credit', 'sales_invoice_details', 'sales_payment_status', 'sales_returns',
          'credit_view_history', 'credit_customer_details', 'credit_create_sale', 'credit_record_payment', 'credit_returns',
          'credit_edit'
        ],
        cashier: [
          'dashboard', 'sales', 'inventory', 'barcode-print', 'barcode_print', 'barcodes', 'customers',
          'sales_create', 'sales_today', 'sales_own_history', 'sales_customer_history',
          'sales_credit_history', 'sales_customer_credit', 'sales_invoice_details', 'sales_payment_status', 'sales_returns',
          'credit_view_history', 'credit_customer_details', 'credit_create_sale', 'credit_record_payment', 'credit_returns'
        ],
        retail_user: [
          'dashboard', 'sales', 'inventory', 'barcode-print', 'barcode_print', 'barcodes', 'customers',
          'sales_create', 'sales_today', 'sales_own_history', 'sales_customer_history',
          'sales_credit_history', 'sales_customer_credit', 'sales_invoice_details', 'sales_payment_status', 'sales_returns',
          'credit_view_history', 'credit_customer_details', 'credit_create_sale', 'credit_record_payment', 'credit_returns'
        ]
      };
      for (const [role, pages] of Object.entries(defaultPermissions)) {
        await db.run(
          'INSERT INTO custom_permissions (role, pages) VALUES (?, ?)',
          [role, JSON.stringify(pages)]
        );
      }
      console.log('[Startup] Seeded default permissions table.');
    } else {
      // Ensure existing custom_permissions table rows contain barcode-print
      const existingRows = await db.all('SELECT * FROM custom_permissions');
      for (const row of existingRows) {
        try {
          let pages = JSON.parse(row.pages);
          if (Array.isArray(pages)) {
            let updated = false;
            ['barcode-print', 'barcode_print', 'barcodes'].forEach(k => {
              if (!pages.includes(k)) {
                pages.push(k);
                updated = true;
              }
            });
            if (updated) {
              await db.run('UPDATE custom_permissions SET pages = ? WHERE role = ?', [JSON.stringify(pages), row.role]);
            }
          }
        } catch (e) {}
      }
    }
  } catch (err) {
    console.error('[Startup] Failed to seed custom permissions:', err.message);
  }

  console.log('✅ SQLite database has been sanitized, created required tables, and seeded initial settings.');
}

// ----------------------------------------------------
// 📧 INTEGRATED EXCEL BACKUP SERVICE
// ----------------------------------------------------

const sendNotificationEmail = async (subject, text, targetEmail = null) => {
  const settings = await getRuntimeSettingsSnapshot();
  return mailerSendNotificationEmail(subject, text, settings, targetEmail);
};

const sendResetEmail = async (toEmail, code) => {
  const settings = await getRuntimeSettingsSnapshot();
  return mailerSendResetEmail(toEmail, code, settings);
};

async function checkAndEmailLowStockAlerts(productIds = []) {
  if (!productIds || productIds.length === 0) return;
  try {
    const placeholders = productIds.map(() => '?').join(',');
    const products = await db.all(`SELECT * FROM products WHERE id IN (${placeholders})`, productIds);
    const lowStockProducts = products.filter(p => {
      const minStock = p.min_stock !== undefined ? p.min_stock : 5;
      return (p.stock || 0) <= minStock;
    });

    if (lowStockProducts.length > 0) {
      console.log(`[Stock Check] Low stock detected for: ${lowStockProducts.map(p => p.name).join(', ')}`);
      
      const emailText = `Dear Admin,

The following products have fallen below their minimum stock thresholds:

${lowStockProducts.map(p => `- ${p.name} (SKU: ${p.sku})
  Current Stock: ${p.stock} (Threshold: ${p.min_stock || 5})
  Supplier: ${p.supplier || 'N/A'}`).join('\n\n')}

Please review your inventory levels and prepare purchase orders if necessary.

Muthuwadige Hardware ERP System`;

      await sendNotificationEmail(
        `[Alert] Low Stock Warning - Muthuwadige Hardware ERP`,
        emailText
      );
    }
  } catch (err) {
    console.error('[Stock Check] Low stock email alert failed:', err);
  }
}

const performBackup = async (targetEmail, type = 'Manual', fromDate = null, toDate = null) => {
  const workerPath = path.join(__dirname, 'backup-worker.js');

  if (!fs.existsSync(workerPath)) {
    console.error('❌ backup-worker.js not found at:', workerPath);
    return { success: false, error: 'Worker script missing', message: 'Backup worker script not found' };
  }

  // Build worker arguments
  const args = [];
  if (targetEmail) args.push('--email', targetEmail);
  if (type) args.push('--type', type);
  if (fromDate) args.push('--fromDate', fromDate);
  if (toDate) args.push('--toDate', toDate);

  const workerEnv = { 
    ...process.env, 
    ELECTRON_RUN_AS_NODE: '1',
    DB_FILE: DB_FILE,
    BACKUPS_DIR: backupsDir,
    ENV_PATH: envPath
  };
  if (USER_DATA_PATH) {
    workerEnv.USER_DATA_PATH = USER_DATA_PATH;
  }

  console.log(`\n📦 Spawning backup worker from main process (Main PID: ${process.pid})...`);
  console.log(`   Worker args: ${args.length > 0 ? args.join(' ') : '(default auto backup)'}\n`);

  try {
    const worker = spawn(process.execPath, [workerPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: workerEnv
    });

    const workerPid = worker.pid;
    console.log(`✓ Backup worker spawned in background with PID: ${workerPid}`);

    // Capture worker output asynchronously for background logging
    worker.stdout.on('data', (data) => {
      console.log(`[Worker ${workerPid}] ${data.toString().trim()}`);
    });

    worker.stderr.on('data', (data) => {
      console.error(`[Worker ${workerPid}] ERROR: ${data.toString().trim()}`);
    });

    worker.on('error', (err) => {
      console.error(`❌ Backup worker spawn error (PID ${workerPid}):`, err.message);
    });

    worker.on('exit', (code, signal) => {
      if (code === 0) {
        console.log(`✅ Backup worker completed successfully (PID ${workerPid})`);
      } else {
        console.error(`❌ Backup worker finished with code ${code} (PID ${workerPid})`);
      }
    });

    // Unref worker process so parent Express server returns response immediately without blocking
    worker.unref();

    return {
      success: true,
      pid: workerPid,
      status: 'processing',
      message: 'Full database Excel backup has been triggered in the background.'
    };
  } catch (err) {
    console.error('❌ Failed to spawn backup worker process:', err);
    return { success: false, error: err.message, message: 'Failed to spawn backup worker' };
  }
};

// OLD performBackup REPLACED WITH WORKER PATTERN ABOVE
// THE FOLLOWING CODE WAS REMOVED TO PREVENT BLOCKING THE EXPRESS SERVER
// Original function was 1170 lines (lines 1095-2264) and included:
// - getExcelDecimalDate helper
// - XLSX workbook creation
// - Email sending via nodemailer
// - Database logging
// All functionality now executed in backup-worker.js child process

// ----------------------------------------------------
// 🕰️ DYNAMIC AUTOMATED BACKUP SCHEDULER
// ----------------------------------------------------
let activeBackupScheduleTimer = null;

async function scheduleAutomaticBackups() {
  // 1. Stop any existing active backup schedule timer
  if (activeBackupScheduleTimer) {
    clearInterval(activeBackupScheduleTimer);
    activeBackupScheduleTimer = null;
    console.log('[Backup Scheduler] Previous active backup scheduler stopped. Active scheduler count: 0');
  }

  try {
    // 2. Read runtime settings
    const settings = await getRuntimeSettingsSnapshot();

    // 3. Verify automated backup is enabled and target email is valid
    if (settings.backup_enabled !== 1 || !settings.backup_email || !settings.backup_email.trim()) {
      console.log('[Backup Scheduler] Automated backups disabled or destination email missing. Active scheduler count: 0');
      return;
    }

    // 4. Validate backup interval hours (whole integer 1..168, default 6)
    let intervalHours = Number(settings.backup_interval_hours);
    if (isNaN(intervalHours) || !Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 168) {
      intervalHours = 6;
    }

    const intervalMs = intervalHours * 3600 * 1000;
    const targetEmail = settings.backup_email.trim();

    console.log(`[Backup Scheduler] Initialized automated backup scheduler for "${targetEmail}" every ${intervalHours} hour(s) (${intervalMs} ms). Active scheduler count: 1`);

    // 5. Create EXACTLY ONE dynamic interval timer
    activeBackupScheduleTimer = setInterval(async () => {
      try {
        const currentSettings = await getRuntimeSettingsSnapshot();
        if (currentSettings.backup_enabled === 1 && currentSettings.backup_email) {
          console.log(`[Backup Scheduler] ${intervalHours}-hourly automated backup triggered for target email: ${currentSettings.backup_email}`);
          await performBackup(currentSettings.backup_email, 'Auto');
        } else {
          console.log('[Backup Scheduler] Automated backup tick skipped (feature disabled or email missing).');
        }
      } catch (err) {
        console.error('[Backup Scheduler] Automated backup execution failed:', err);
      }
    }, intervalMs);

  } catch (err) {
    console.error('[Backup Scheduler] Failed to initialize backup scheduler:', err);
  }
}

function getBackupSchedulerStatus() {
  return {
    active: activeBackupScheduleTimer !== null,
    activeSchedulerCount: activeBackupScheduleTimer !== null ? 1 : 0
  };
}

// 🕰️ Cron Scheduler: Checking for overdue credit sales every 6 hours ('0 */6 * * *')
cron.schedule('0 */6 * * *', async () => {
  try {
    console.log('[Cron] Checking for overdue credit sales...');
    const overdueSales = await db.all(`
      SELECT s.id, s.invoice_no, s.customer_name, s.total_amount, s.due_date, c.phone as customer_phone
      FROM sales s
      LEFT JOIN customers c ON s.customer_id = c.id
      WHERE s.status = 'Non Paid' AND s.due_date IS NOT NULL AND date(s.due_date) < date('now')
    `);

    // Phase 2B optimization: batch fetch all reminders sent today
    const todayReminders = await db.all(
      "SELECT details FROM audit_logs WHERE action = 'AUTOMATED_WHATSAPP_REMINDER' AND date(timestamp) = date('now')"
    );
    const reminderSet = new Set();
    todayReminders.forEach(log => {
      // Extract invoice number from the message format
      const match = log.details.match(/invoice (\S+) \(/);
      if (match) reminderSet.add(match[1]);
    });

    for (const sale of overdueSales) {
      // Check if reminder was already sent today (using batched data)
      if (!reminderSet.has(sale.invoice_no)) {
        const phone = sale.customer_phone || '---';
        const msg = `Automated WhatsApp reminder sent to ${sale.customer_name} (${phone}) for overdue invoice ${sale.invoice_no} (Due: ${sale.due_date}, Outstanding: Rs. ${sale.total_amount})`;
        console.log(`[AUTOMATED WHATSAPP] 📲 ${msg}`);

        // Insert into audit logs
        const logId = 'al_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const timestamp = new Date().toISOString();
        await db.run(
          'INSERT INTO audit_logs (id, user_email, action, details, timestamp) VALUES (?, ?, ?, ?, ?)',
          [logId, 'automated_whatsapp_bot@hardware.com', 'AUTOMATED_WHATSAPP_REMINDER', msg, timestamp]
        );
      }
    }
  } catch (err) {
    console.error('[Cron] Automated WhatsApp reminder checking failed:', err);
  }
});

// 🕰️ Cron Scheduler: Weekly Sunday at 6:00 PM ('0 18 * * 0')
cron.schedule('0 18 * * 0', async () => {
  console.log('[Cron] Running weekly automated Sunday backup at 6:00 PM...');
  try {
    const settings = await getRuntimeSettingsSnapshot();
    const targetEmail = settings.backup_email || settings.email || 'sanojhardware@gmail.com';
    console.log(`[Cron] Weekly Sunday automated backup triggered for target email: ${targetEmail}`);
    await performBackup(targetEmail, 'Auto');
  } catch (err) {
    console.error('[Cron] Weekly Sunday backup scheduler failed:', err);
  }
});

// ----------------------------------------------------
// 🚀 REST API ROUTING
// ----------------------------------------------------

// TRIGGER MANUAL BACKUP API
app.post('/api/settings/trigger-backup', async (req, res) => {
  try {
    const { fromDate, toDate } = req.body || {};
    const settings = await getRuntimeSettingsSnapshot();
    const email = settings.backup_email || 'sanojhardware@gmail.com';
    const result = await performBackup(email, 'Manual', fromDate, toDate);
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({
        success: false,
        message: result.message || result.error || 'Backup operation failed.',
        error: result.error || result.message || 'Backup operation failed.',
        code: result.code
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Backup server error', error: err.message });
  }
});

app.get('/api/trigger-backup', async (req, res) => {
  // Legacy GET support for backward compatibility with Settings.tsx fetch call
  try {
    const { fromDate, toDate } = req.query || {};
    const settings = await getRuntimeSettingsSnapshot();
    const email = settings.backup_email || 'sanojhardware@gmail.com';
    const result = await performBackup(email, 'Manual', fromDate, toDate);
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({
        success: false,
        message: result.message || result.error || 'Backup operation failed.',
        error: result.error || result.message || 'Backup operation failed.',
        code: result.code
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Backup server error', error: err.message });
  }
});

// AUTHENTICATION
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const profile = await db.get('SELECT * FROM profiles WHERE email = ?', [email]);
    if (!profile) {
      return res.status(400).json({ error: 'User profile not found. Try: sanojhardware@gmail.com' });
    }
    
    // Validate password
    if (profile.password && profile.password !== password) {
      return res.status(400).json({ error: 'Incorrect password.' });
    }

    let parsedPermissions = undefined;
    if (profile.permissions) {
      try {
        parsedPermissions = typeof profile.permissions === 'string' ? JSON.parse(profile.permissions) : profile.permissions;
      } catch (_) {}
    }

    // Return standard mock payload resembling Supabase structure
    res.json({
      user: {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        name: profile.name,
        avatar: profile.avatar,
        permissions: parsedPermissions
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, role, permissions } = req.body;
  try {
    // Filter out super_admin / Admin when evaluating staff quota limit (3 max additional staff)
    const countRow = await db.get("SELECT COUNT(*) as count FROM profiles WHERE LOWER(role) NOT IN ('super_admin', 'super admin', 'superadmin') AND email != 'admin@hardware.com'");
    if (countRow && countRow.count >= 3) {
      return res.status(400).json({ error: 'Staff quota limit reached. Maximum 3 staff accounts allowed.' });
    }
    const id = 'u_' + Date.now();
    const normalizedRole = role ? (role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()) : 'Cashier';
    const permsStr = permissions ? (typeof permissions === 'string' ? permissions : JSON.stringify(permissions)) : null;
    await db.run(
      'INSERT INTO profiles (id, name, email, role, avatar, password, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name || 'Staff User', email, normalizedRole, email.charAt(0).toUpperCase(), password || '123456', permsStr]
    );
    res.json({ success: true, user: { id, email, role: normalizedRole, name: name || 'Staff User', permissions: permissions || undefined } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const profile = await db.get('SELECT * FROM profiles WHERE email = ?', [email]);
    if (!profile) {
      return res.status(404).json({ error: 'User with this email address does not exist.' });
    }

    // Generate random 6-digit code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await db.run(
      'UPDATE profiles SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
      [resetCode, expiry, profile.id]
    );

    const emailResult = await sendResetEmail(email, resetCode);
    if (emailResult.success) {
      return res.json({ 
        success: true, 
        message: 'Password reset code has been sent to your email address.',
        emailDelivered: true,
        messageId: emailResult.messageId 
      });
    }

    if (emailResult.reason === 'GMAIL_PASS missing' || emailResult.error === 'SMTP credentials missing') {
      console.warn(`[Reset Password Simulation] Missing SMTP credentials. Reset code for ${email} is ${resetCode}`);
      return res.json({ 
        success: true, 
        message: 'SMTP credentials not configured. Reset code generated and logged to console.',
        emailDelivered: false,
        simulated: true 
      });
    }

    return res.status(500).json({ 
      error: `Failed to transmit password reset email via SMTP: ${emailResult.error || 'Transport error'}`,
      emailDelivered: false 
    });
  } catch (err) {
    res.status(500).json({ error: err.message, emailDelivered: false });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  try {
    const profile = await db.get('SELECT * FROM profiles WHERE email = ?', [email]);
    if (!profile) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    if (!profile.reset_token || profile.reset_token !== code.trim()) {
      return res.status(400).json({ error: 'Invalid verification code.' });
    }

    const expiryDate = new Date(profile.reset_token_expiry);
    if (isNaN(expiryDate.getTime()) || expiryDate.getTime() < Date.now()) {
      return res.status(400).json({ error: 'Verification code has expired.' });
    }

    await db.run(
      'UPDATE profiles SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
      [newPassword, profile.id]
    );

    res.json({ success: true, message: 'Password has been updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PRODUCTS API
app.get('/api/products', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM products ORDER BY name ASC');
    // Map backend snake_case column names back to frontend camelCase
    const mapped = data.map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category,
      price: p.price,
      costPrice: p.cost_price,
      stock: p.stock,
      minStock: p.min_stock,
      supplier: p.supplier,
      unit: p.unit,
      barcode: p.barcode,
      brand: p.brand || '',
      serialNo: p.serial_no || '',
      batchCode: p.batch_code || '',
      expiryDate: p.expiry_date || '',
      supplierPhone: p.supplier_phone || '',
      measureDetails: p.measure_details || ''
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  const p = req.body;
  const id = 'p_' + Date.now();
  const user_email = req.headers['x-user-email'] || p.user_email || 'system';
  try {
    let finalSupplier = p.supplier ? p.supplier.trim() : '';
    let finalSupplierPhone = p.supplier_phone !== undefined ? p.supplier_phone : (p.supplierPhone || '');

    if (finalSupplier) {
      try {
        const existingSup = await db.get(
          "SELECT * FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))",
          [finalSupplier]
        );
        if (existingSup) {
          finalSupplier = existingSup.name;
          if (!finalSupplierPhone && existingSup.phone) {
            finalSupplierPhone = existingSup.phone;
          }
        }
      } catch (e) {}
    }

    await db.run(
      'INSERT INTO products (id, name, sku, category, price, cost_price, stock, min_stock, supplier, unit, barcode, brand, serial_no, batch_code, expiry_date, supplier_phone, measure_details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id, 
        p.name, 
        p.sku, 
        p.category, 
        p.price, 
        p.cost_price !== undefined ? p.cost_price : p.costPrice, 
        p.stock || 0, 
        p.min_stock !== undefined ? p.min_stock : p.minStock || 5, 
        finalSupplier, 
        p.unit || 'pcs', 
        p.barcode, 
        p.brand || '',
        p.serial_no !== undefined ? p.serial_no : p.serialNo || '',
        p.batch_code !== undefined ? p.batch_code : p.batchCode || '',
        p.expiry_date !== undefined ? p.expiry_date : p.expiryDate || '',
        finalSupplierPhone,
        p.measure_details !== undefined ? p.measure_details : p.measureDetails || ''
      ]
    );
    await logAudit(user_email, 'PRODUCT_CREATED', `Product ${p.name} (SKU: ${p.sku}) was added to the inventory.`);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const p = req.body;
  const user_email = req.headers['x-user-email'] || p.user_email || 'system';
  try {
    const existing = await db.get('SELECT * FROM products WHERE id = ? OR sku = ?', [id, id]);
    if (!existing) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const targetId = existing.id;

    const name = p.name !== undefined ? p.name : existing.name;
    const sku = p.sku !== undefined ? p.sku : existing.sku;
    const category = p.category !== undefined ? p.category : existing.category;
    const price = p.price !== undefined ? p.price : existing.price;
    
    let cost_price = existing.cost_price;
    if (p.cost_price !== undefined) cost_price = p.cost_price;
    else if (p.costPrice !== undefined) cost_price = p.costPrice;

    const stock = p.stock !== undefined ? p.stock : existing.stock;

    let min_stock = existing.min_stock;
    if (p.min_stock !== undefined) min_stock = p.min_stock;
    else if (p.minStock !== undefined) min_stock = p.minStock;

    let supplier = p.supplier !== undefined ? p.supplier : existing.supplier;
    const unit = p.unit !== undefined ? p.unit : existing.unit;
    const barcode = p.barcode !== undefined ? p.barcode : existing.barcode;
    const brand = p.brand !== undefined ? p.brand : existing.brand || '';
    const serial_no = p.serial_no !== undefined ? p.serial_no : p.serialNo !== undefined ? p.serialNo : existing.serial_no || '';
    const batch_code = p.batch_code !== undefined ? p.batch_code : p.batchCode !== undefined ? p.batchCode : existing.batch_code || '';
    const expiry_date = p.expiry_date !== undefined ? p.expiry_date : p.expiryDate !== undefined ? p.expiryDate : existing.expiry_date || '';
    let supplier_phone = p.supplier_phone !== undefined ? p.supplier_phone : p.supplierPhone !== undefined ? p.supplierPhone : existing.supplier_phone || '';
    const measure_details = p.measure_details !== undefined ? p.measure_details : p.measureDetails !== undefined ? p.measureDetails : existing.measure_details || '';

    if (supplier && typeof supplier === 'string' && supplier.trim()) {
      try {
        const existingSup = await db.get(
          "SELECT * FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))",
          [supplier.trim()]
        );
        if (existingSup) {
          supplier = existingSup.name;
          if (!supplier_phone && existingSup.phone) {
            supplier_phone = existingSup.phone;
          }
        }
      } catch (e) {}
    }

    await db.run(
      'UPDATE products SET name = ?, sku = ?, category = ?, price = ?, cost_price = ?, stock = ?, min_stock = ?, supplier = ?, unit = ?, barcode = ?, brand = ?, serial_no = ?, batch_code = ?, expiry_date = ?, supplier_phone = ?, measure_details = ? WHERE id = ?',
      [name, sku, category, price, cost_price, stock, min_stock, supplier, unit, barcode, brand, serial_no, batch_code, expiry_date, supplier_phone, measure_details, targetId]
    );
    await logAudit(user_email, 'PRODUCT_UPDATED', `Product ${name} (SKU: ${sku}) details were updated.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const user_email = req.headers['x-user-email'] || 'system';
  try {
    const existing = await db.get('SELECT * FROM products WHERE id = ?', [id]);
    const prodName = existing ? existing.name : id;
    const prodSku = existing ? existing.sku : '';
    await db.run('DELETE FROM products WHERE id = ?', [id]);
    await logAudit(user_email, 'PRODUCT_DELETED', `Product ${prodName} (SKU: ${prodSku}) was deleted.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CUSTOMERS API
app.get('/api/customers', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM customers ORDER BY name ASC');
    const mapped = data.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      address: c.address,
      nic: c.nic,
      loyaltyPoints: c.loyalty_points,
      totalPurchases: c.total_purchases,
      joinDate: c.join_date
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/customers', async (req, res) => {
  const c = req.body;
  const id = 'c_' + Date.now();
  try {
    await db.run(
      'INSERT INTO customers (id, name, email, phone, address, nic, loyalty_points, total_purchases, join_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, c.name, c.email, c.phone, c.address, c.nic, c.loyalty_points !== undefined ? c.loyalty_points : c.loyaltyPoints || 0, c.total_purchases !== undefined ? c.total_purchases : c.totalPurchases || 0, c.join_date !== undefined ? c.join_date : c.joinDate]
    );
    res.json({ success: true, id, name: c.name, email: c.email, phone: c.phone, address: c.address, nic: c.nic });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/customers/:id', async (req, res) => {
  const { id } = req.params;
  const c = req.body;
  try {
    await db.run(
      'UPDATE customers SET name = ?, email = ?, phone = ?, address = ?, nic = ?, loyalty_points = ?, total_purchases = ?, join_date = ? WHERE id = ?',
      [c.name, c.email, c.phone, c.address, c.nic, c.loyalty_points !== undefined ? c.loyalty_points : c.loyaltyPoints, c.total_purchases !== undefined ? c.total_purchases : c.totalPurchases, c.join_date !== undefined ? c.join_date : c.joinDate, id]
    );
    await logAudit(c.user_email || 'system', 'CUSTOMER_UPDATED', `Customer ${c.name} details were updated.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/customers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM customers WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SUPPLIERS API
app.get('/api/suppliers', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM suppliers ORDER BY name ASC');
    const mapped = data.map(s => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      address: s.address,
      creditTerms: s.credit_terms,
      payableBalance: s.payable_balance,
      nic: s.nic,
      createdAt: s.created_at
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/suppliers', async (req, res) => {
  const s = req.body;
  const id = 's_' + Date.now();
  try {
    await db.run(
      'INSERT INTO suppliers (id, name, email, phone, address, credit_terms, payable_balance, nic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, s.name, s.email, s.phone, s.address, s.creditTerms || s.credit_terms, s.payableBalance !== undefined ? s.payableBalance : s.payable_balance || 0, s.nic]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/suppliers/:id', async (req, res) => {
  const { id } = req.params;
  const s = req.body;
  try {
    const existing = await db.get('SELECT * FROM suppliers WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const name = s.name !== undefined ? s.name : existing.name;
    const email = s.email !== undefined ? s.email : existing.email;
    const phone = s.phone !== undefined ? s.phone : existing.phone;
    const address = s.address !== undefined ? s.address : existing.address;
    const nic = s.nic !== undefined ? s.nic : existing.nic;
    
    let credit_terms = existing.credit_terms;
    if (s.creditTerms !== undefined) credit_terms = s.creditTerms;
    else if (s.credit_terms !== undefined) credit_terms = s.credit_terms;

    let payable_balance = existing.payable_balance;
    if (s.payableBalance !== undefined) payable_balance = s.payableBalance;
    else if (s.payable_balance !== undefined) payable_balance = s.payable_balance;

    await db.run(
      'UPDATE suppliers SET name = ?, email = ?, phone = ?, address = ?, credit_terms = ?, payable_balance = ?, nic = ? WHERE id = ?',
      [name, email, phone, address, credit_terms, payable_balance, nic, id]
    );

    // Sync supplier_phone (and supplier name if changed) across all matching products in Inventory!
    // The supplier name is the identifier for matching.
    const oldSupplierName = (existing.name || '').trim();
    const newSupplierName = (name || '').trim();

    if (oldSupplierName || newSupplierName) {
      await db.run(
        'UPDATE products SET supplier_phone = ?, supplier = ? WHERE LOWER(TRIM(supplier)) = LOWER(TRIM(?)) OR LOWER(TRIM(supplier)) = LOWER(TRIM(?))',
        [phone || '', newSupplierName || oldSupplierName, oldSupplierName, newSupplierName]
      );
    }

    await logAudit(s.user_email || 'system', 'SUPPLIER_UPDATED', `Supplier ${name} details were updated.`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/suppliers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM suppliers WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SALES API (POS Billing & Checkout)
app.get('/api/sales', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM sales ORDER BY created_at DESC');
    const mapped = data.map(s => ({
      id: s.id,
      invoice_no: s.invoice_no,
      invoiceNo: s.invoice_no,
      customer_id: s.customer_id,
      customer_name: s.customer_name || '',
      customerName: s.customer_name || '',
      customer_phone: s.customer_phone || '',
      customerPhone: s.customer_phone || '',
      customer_address: s.customer_address || '',
      customerAddress: s.customer_address || '',
      items: JSON.parse(s.items),
      subtotal: s.subtotal,
      discount: s.discount,
      tax: s.tax,
      tax_rate: s.tax_rate,
      total_amount: s.total_amount,
      total: s.total_amount,
      status: s.status,
      payment_method: s.payment_method || 'Cash',
      user_id: s.user_id,
      user_email: s.user_email || s.user_id || '',
      cashier: s.cashier || s.user_name || s.user_id || 'Admin',
      date: new Date(s.created_at).toLocaleDateString(),
      created_at: s.created_at,
      due_date: s.due_date,
      credit_period_days: s.credit_period_days || 0,
      payment_received: s.payment_received || 0,
      transportation_fee: Number(s.transportation_fee || 0),
      transportationFee: Number(s.transportation_fee || 0),
      credit_note_applied: Number(s.credit_note_applied || 0),
      creditNoteApplied: Number(s.credit_note_applied || 0),
      credit_note_code: s.credit_note_code || '',
      creditNoteCode: s.credit_note_code || ''
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function generateNextInvoiceNumber(currentInvoiceNumber) {
  if (!currentInvoiceNumber) return 'INV001';
  
  // Extract trailing digits
  const match = currentInvoiceNumber.match(/^(.*?)(\d+)$/);
  if (!match) {
    // If no trailing numbers, e.g. "INV", append "001"
    return currentInvoiceNumber + '001';
  }
  
  const prefix = match[1];
  const numStr = match[2];
  const nextNum = parseInt(numStr, 10) + 1;
  
  // Pad the incremented number to match the original width
  const paddedNum = String(nextNum).padStart(numStr.length, '0');
  
  return prefix + paddedNum;
}

app.post('/api/sales', async (req, res) => {
  const s = req.body;
  const clientTxId = s.client_tx_id || req.headers['idempotency-key'] || null;

  // 0. Pre-transaction Idempotency Check
  if (clientTxId && typeof clientTxId === 'string' && clientTxId.trim()) {
    try {
      const existingSale = await db.get(
        'SELECT * FROM sales WHERE client_tx_id = ? AND client_tx_id IS NOT NULL AND client_tx_id != ""',
        [clientTxId.trim()]
      );
      if (existingSale) {
        console.log(`[Idempotency] Pre-txn duplicate transaction detected for client_tx_id "${clientTxId}". Returning existing invoice ${existingSale.invoice_no}.`);
        let itemsArr = [];
        try {
          itemsArr = typeof existingSale.items === 'string' ? JSON.parse(existingSale.items) : (existingSale.items || []);
        } catch (e) {
          itemsArr = existingSale.items || [];
        }
        return res.status(200).json({
          ...existingSale,
          items: itemsArr,
          invoiceNo: existingSale.invoice_no,
          total: existingSale.total_amount,
          idempotent_replay: true
        });
      }
    } catch (e) {
      console.warn('[Idempotency] Notice checking existing client_tx_id:', e);
    }
  }

  const id = 'so_' + Date.now();
  const created_at = new Date().toISOString();
  const creditNoteApplied = Number(s.credit_note_applied || s.creditNoteApplied || 0);
  const creditNoteCode = s.credit_note_code || s.creditNoteCode || '';
  const transportationFeeVal = Number(s.transportation_fee !== undefined ? s.transportation_fee : (s.transportationFee || 0));
  const customerNameVal = s.customer_name !== undefined ? s.customer_name : (s.customerName !== undefined ? s.customerName : (s.customer_id ? '' : 'Guest Customer'));
  const customerPhoneVal = s.customer_phone || s.customerPhone || '';
  const customerAddressVal = s.customer_address || s.customerAddress || '';

  const startTime = Date.now();
  console.log(`[START] Save Sale Invoice: ${s.invoice_no || 'New'}`);
  let txn = null;

  try {
    // 1. Start SQLite Transaction
    txn = await beginTxn(db, `Save Sale Invoice ${s.invoice_no || 'New'}`);

    // In-transaction Idempotency Check (handles concurrent requests)
    if (clientTxId && typeof clientTxId === 'string' && clientTxId.trim()) {
      const existingTxnSale = await db.get(
        'SELECT * FROM sales WHERE client_tx_id = ? AND client_tx_id IS NOT NULL AND client_tx_id != ""',
        [clientTxId.trim()]
      );
      if (existingTxnSale) {
        await rollbackTxn(db, txn);
        console.log(`[Idempotency] Transactional check detected duplicate client_tx_id "${clientTxId}". Returning existing invoice ${existingTxnSale.invoice_no}.`);
        let itemsArr = [];
        try {
          itemsArr = typeof existingTxnSale.items === 'string' ? JSON.parse(existingTxnSale.items) : (existingTxnSale.items || []);
        } catch (e) {
          itemsArr = existingTxnSale.items || [];
        }
        return res.status(200).json({
          ...existingTxnSale,
          items: itemsArr,
          invoiceNo: existingTxnSale.invoice_no,
          total: existingTxnSale.total_amount,
          idempotent_replay: true
        });
      }
    }

    // Determine final invoice number
    let finalInvoiceNo = s.invoice_no;
    const isTempInvoice = !s.invoice_no || s.invoice_no.startsWith('INV-');
    if (isTempInvoice) {
      // Fetch current next_invoice_number from system_settings
      const settings = await db.get('SELECT next_invoice_number FROM system_settings WHERE id = ?', ['global']);
      finalInvoiceNo = (settings && settings.next_invoice_number) ? settings.next_invoice_number : 'INV001';
      
      // Compute the next invoice number and update system_settings
      const nextInv = generateNextInvoiceNumber(finalInvoiceNo);
      await db.run('UPDATE system_settings SET next_invoice_number = ? WHERE id = ?', [nextInv, 'global']);
    }

    // Phase 2A Historical Cost Snapshot Protection: batch fetch products with cost_price before sale insertion
    const rawItemsArr = Array.isArray(s.items) ? s.items : [];
    const productIds = rawItemsArr.map(item => item.productId || item.product_id).filter(Boolean);
    const placeholders = productIds.map(() => '?').join(',');
    const productsMap = new Map();
    if (productIds.length > 0) {
      const products = await db.all(`SELECT id, stock, name, cost_price FROM products WHERE id IN (${placeholders})`, productIds);
      products.forEach(p => productsMap.set(p.id, p));
    }

    const enrichedItems = rawItemsArr.map(item => {
      const prod = productsMap.get(item.productId || item.product_id);
      const snapshotCostPrice = Number(
        item.cost_price !== undefined && item.cost_price !== null ? item.cost_price :
        (item.costPrice !== undefined && item.costPrice !== null ? item.costPrice :
        (prod ? (prod.cost_price !== undefined ? prod.cost_price : 0) : 0))
      );
      return {
        ...item,
        cost_price: snapshotCostPrice,
        costPrice: snapshotCostPrice
      };
    });

    // 2. Insert Sale Order
    const cashierName = s.cashier || s.user_name || s.user_id || 'Admin';
    const userEmail = s.user_email || 'admin@hardware.erp';
    await db.run(
      'INSERT INTO sales (id, invoice_no, customer_id, customer_name, customer_phone, customer_address, items, subtotal, discount, tax, tax_rate, total_amount, status, user_id, user_email, cashier, payment_method, created_at, due_date, credit_period_days, payment_received, transportation_fee, credit_note_applied, credit_note_code, client_tx_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, finalInvoiceNo, s.customer_id, customerNameVal, customerPhoneVal, customerAddressVal, JSON.stringify(enrichedItems), s.subtotal, s.discount, 0, 0, s.total_amount, s.status, s.user_id, userEmail, cashierName, s.payment_method || 'Cash', created_at, s.due_date || null, s.credit_period_days || 0, s.payment_received || 0, transportationFeeVal, creditNoteApplied, creditNoteCode, clientTxId]
    );

    // 3. Decrement Product Stock levels & validate available stock
    for (const item of enrichedItems) {
      const convRate = Number(item.conversionRate) || 1;
      const baseQtyDeduction = convRate > 0 ? (Number(item.qty || 0) / convRate) : Number(item.qty || 0);

      // Backend stock validation check using batched product data
      const prod = productsMap.get(item.productId || item.product_id);
      if (prod) {
        const availableStock = Number(prod.stock || 0);
        if (baseQtyDeduction > availableStock + 0.0001) {
          await rollbackTxn(db, txn);
          const maxAvailableInUnit = Math.round((availableStock * convRate) * 100) / 100;
          return res.status(400).json({
            error: `Only ${maxAvailableInUnit} ${item.unit || ''} available in stock for "${prod.name}".`
          });
        }
      }

      await db.run(
        'UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?',
        [baseQtyDeduction, item.productId]
      );
    }

    // 4. Increment Customer LTV & Loyalty Points
    if (s.customer_id) {
      const addedPoints = Math.floor(s.total_amount / 10); // 1 point per 10 LKR
      await db.run(
        'UPDATE customers SET total_purchases = total_purchases + ?, loyalty_points = loyalty_points + ? WHERE id = ?',
        [s.total_amount, addedPoints, s.customer_id]
      );
    }

    // 5. Handle Credit Note Balance Deduction if Credit Note Applied > 0
    if (creditNoteApplied > 0) {
      if (!creditNoteCode && !s.customer_id && !s.customer_name) {
        throw new Error('Credit Note code or customer must be specified to apply credit.');
      }

      let cn = null;
      if (creditNoteCode) {
        cn = await db.get(
          "SELECT * FROM credit_notes WHERE (credit_note_no = ? OR code = ? OR id = ?)",
          [creditNoteCode, creditNoteCode, creditNoteCode]
        );
      }

      if (!cn && (s.customer_id || s.customer_name)) {
        cn = await db.get(
          "SELECT * FROM credit_notes WHERE (customer_id = ? OR customer_name = ?) AND balance_remaining > 0 AND status NOT IN ('Fully Used', 'used', 'voided') ORDER BY created_at ASC",
          [s.customer_id || '', s.customer_name || '']
        );
      }

      if (!cn) {
        throw new Error(`Credit Note ${creditNoteCode || ''} not found or has 0 available balance.`);
      }

      const cnOriginalVal = Number(cn.amount !== undefined ? cn.amount : (cn.value || 0));
      const prevBal = Number(cn.balance_remaining !== undefined ? cn.balance_remaining : cnOriginalVal);

      const cnStatus = (cn.status || '').toLowerCase();
      if (cnStatus === 'fully used' || cnStatus === 'used' || cnStatus === 'voided' || prevBal <= 0) {
        throw new Error(`Credit Note ${cn.credit_note_no || creditNoteCode} is fully used or voided.`);
      }

      if (creditNoteApplied > prevBal) {
        throw new Error(`Credit Note balance is only Rs. ${prevBal.toLocaleString()}. Cannot apply Rs. ${creditNoteApplied.toLocaleString()}.`);
      }

      const deductAmt = creditNoteApplied;
      const remBal = Math.max(0, prevBal - deductAmt);

      let newStatus = 'Active';
      if (remBal <= 0.001) {
        newStatus = 'Fully Used';
      } else if (remBal < cnOriginalVal) {
        newStatus = 'Partially Used';
      }

      // Update Credit Note Balance & Status
      await db.run(
        "UPDATE credit_notes SET balance_remaining = ?, status = ? WHERE id = ?",
        [remBal, newStatus, cn.id]
      );

      // Record Detailed Credit Note Usage Log
      const usageId = 'cnu_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      await db.run(
        `INSERT INTO credit_note_usage (
          id, credit_note_no, invoice_no, customer_id, customer_name, customer_phone,
          amount_applied, previous_balance, remaining_balance, action, user_email, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          usageId,
          cn.credit_note_no || cn.code || creditNoteCode,
          finalInvoiceNo,
          cn.customer_id || s.customer_id || '',
          cn.customer_name || s.customer_name || 'Guest Customer',
          cn.customer_phone || s.customer_phone || '',
          deductAmt,
          prevBal,
          remBal,
          'applied',
          s.user_email || s.user_id || 'system',
          created_at
        ]
      );

      await logAudit(s.user_email || 'system', 'CREDIT_NOTE_APPLIED', `Applied Rs. ${deductAmt} from Credit Note ${cn.credit_note_no || creditNoteCode} to Invoice ${finalInvoiceNo}`);
    }

    if (s.payment_method !== 'Credit' && s.status !== 'Non Paid') {
      await replaceRuntimeTransactionByDescription(`POS Sale ${finalInvoiceNo}`, {
        type: 'income',
        category: 'Sales',
        amount: s.total_amount,
        date: new Date(created_at).toLocaleDateString('sv-SE'),
        reference: finalInvoiceNo,
        user_id: s.user_id
      });
    }

    // 6. Commit Transaction
    await commitTxn(db, txn);
    console.log(`[END] Save Sale Invoice: ${finalInvoiceNo} - ${Date.now() - startTime}ms`);

    // Trigger low stock checks asynchronously in the background
    try {
      const productIds = s.items.map(item => item.productId);
      checkAndEmailLowStockAlerts(productIds).catch(err => console.error("[Stock Warning Background Task Failed]:", err));
    } catch (checkErr) {
      console.error("[Low Stock Trigger Error]:", checkErr);
    }

    await logAudit(s.user_email || 'system', 'SALE_COMPLETED', `Invoice ${finalInvoiceNo} (Total: Rs. ${s.total_amount}) was generated.`);

    // Return mock database record resembling database insertion output
    res.json({
      success: true,
      id,
      invoice_no: finalInvoiceNo,
      invoiceNo: finalInvoiceNo,
      customer_id: s.customer_id,
      customer_name: customerNameVal,
      customerName: customerNameVal,
      customer_phone: customerPhoneVal,
      customerPhone: customerPhoneVal,
      customer_address: customerAddressVal,
      customerAddress: customerAddressVal,
      total_amount: s.total_amount,
      created_at
    });
  } catch (err) {
    if (txn) await rollbackTxn(db, txn); else await safeRollback(db);

    if (clientTxId && typeof clientTxId === 'string' && clientTxId.trim()) {
      const cleanTxId = clientTxId.trim();
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const existingSale = await db.get(
            'SELECT * FROM sales WHERE client_tx_id = ? AND client_tx_id IS NOT NULL AND client_tx_id != ""',
            [cleanTxId]
          );
          if (existingSale) {
            console.log(`[Idempotency] Catch-block recovered completed sale for client_tx_id "${cleanTxId}" on attempt ${attempt + 1}. Returning existing invoice ${existingSale.invoice_no}.`);
            let itemsArr = [];
            try {
              itemsArr = typeof existingSale.items === 'string' ? JSON.parse(existingSale.items) : (existingSale.items || []);
            } catch (e) {
              itemsArr = existingSale.items || [];
            }
            return res.status(200).json({
              ...existingSale,
              items: itemsArr,
              invoiceNo: existingSale.invoice_no,
              total: existingSale.total_amount,
              idempotent_replay: true
            });
          }
        } catch (e) {
          console.warn('[Idempotency] Notice in catch-block sale recovery:', e);
        }
        await new Promise(r => setTimeout(r, 50));
      }
    }

    res.status(500).json({ error: err.message });
  }
});

app.put('/api/sales/:id', async (req, res) => {
  const { id } = req.params;
  const { status, payment_received } = req.body;
  try {
    const existing = await db.get('SELECT * FROM sales WHERE id = ?', [id]);
    
    const finalStatus = status ? (status === 'paid' ? 'Paid' : status) : undefined;
    
    if (existing && (finalStatus === 'Paid' || finalStatus === 'paid') && existing.status !== 'Paid' && existing.status !== 'paid') {
      await replaceRuntimeTransactionByDescription(`POS Credit Payment ${existing.invoice_no}`, {
        type: 'income',
        category: 'Sales',
        amount: existing.total_amount,
        date: new Date().toLocaleDateString('sv-SE'),
        reference: existing.invoice_no,
        user_id: existing.user_id
      });
    }

    const fields = [];
    const params = [];
    if (finalStatus !== undefined) {
      fields.push('status = ?');
      params.push(finalStatus);
    }
    if (payment_received !== undefined) {
      fields.push('payment_received = ?');
      params.push(Number(payment_received) || 0);
    }

    if (fields.length > 0) {
      params.push(id);
      await db.run(`UPDATE sales SET ${fields.join(', ')} WHERE id = ?`, params);
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/credit_payments', async (req, res) => {
  try {
    const records = await db.all('SELECT * FROM credit_payments ORDER BY payment_date DESC');
    res.json(records || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/credit_payments/sale/:saleId', async (req, res) => {
  try {
    const records = await db.all('SELECT * FROM credit_payments WHERE sale_id = ? ORDER BY payment_date DESC', [req.params.saleId]);
    res.json(records || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const handleCreditPaymentInsert = async (req, res) => {
  const p = Array.isArray(req.body) ? req.body[0] : req.body;
  if (!p) {
    return res.status(400).json({ error: 'Payload is required' });
  }

  const id = p.id || 'cp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const paymentDate = p.payment_date || p.created_at || new Date().toISOString();
  const createdAt = p.created_at || new Date().toISOString();

  // Replace fallback string with active session username
  const authorName =
    (p.created_by && p.created_by !== 'system' ? p.created_by : null) ||
    (p.recorded_by && p.recorded_by !== 'system' ? p.recorded_by : null) ||
    req.headers['x-user-name'] ||
    req.headers['x-user-email'] ||
    'Super_admin';

  const amountPaid = Number(
    p.amount_paid !== undefined
      ? p.amount_paid
      : p.amount !== undefined
      ? p.amount
      : 0
  );
  const remainingBalance = Number(p.remaining_balance || 0);
  const invoiceNo = p.invoice_no || p.invoice_id || 'INV';
  const saleId = p.sale_id || p.invoice_id || invoiceNo;

  try {
    await db.run(
      'INSERT INTO credit_payments (id, sale_id, invoice_no, customer_id, customer_name, amount_paid, remaining_balance, payment_method, payment_date, recorded_by, created_by, created_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        saleId,
        invoiceNo,
        p.customer_id || null,
        p.customer_name || null,
        amountPaid,
        remainingBalance,
        p.payment_method || 'Cash',
        paymentDate,
        authorName,
        authorName,
        createdAt,
        p.notes || ''
      ]
    );

    // Phase 2B Unified Accounting: Log transaction for credit repayments to reflect cash inflow in Finance page
    if (amountPaid > 0) {
      const txId = 'tx_cp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const txDate = (paymentDate || createdAt).substring(0, 10);
      const isPartial = remainingBalance > 0.01;
      const category = isPartial ? 'Sales Income (Partial Credit Settlement)' : 'Sales Income (Credit Settlement)';
      const description = isPartial
        ? `Partial Credit Payment for Invoice #${invoiceNo} (${p.customer_name || 'Customer'})`
        : `Credit Settlement for Invoice #${invoiceNo} (${p.customer_name || 'Customer'})`;

      await db.run(
        'INSERT INTO transactions (id, date, description, amount, type, category, reference, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [txId, txDate, description, amountPaid, 'income', category, invoiceNo, authorName, createdAt]
      ).catch(e => console.error('Error logging credit repayment transaction:', e));
    }

    res.json({ success: true, id, authorName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.post('/api/credit_payments', handleCreditPaymentInsert);
app.post('/api/credit_settlements', handleCreditPaymentInsert);

app.get('/api/credit_settlements', async (req, res) => {
  try {
    const records = await db.all('SELECT * FROM credit_payments ORDER BY payment_date DESC');
    res.json(records || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sales/:id', async (req, res) => {
  const { id } = req.params;
  let txn = null;
  try {
    const sale = await db.get('SELECT * FROM sales WHERE id = ?', [id]);
    if (sale) {
      txn = await beginTxn(db, `Delete Sale ${sale.invoice_no}`);
      await removeRuntimeTransactionsForSale(sale.invoice_no);
      await db.run('DELETE FROM sales WHERE id = ?', [id]);
      await commitTxn(db, txn);
    } else {
      await db.run('DELETE FROM sales WHERE id = ?', [id]);
    }
    res.json({ success: true });
  } catch (err) {
    if (txn) await rollbackTxn(db, txn); else await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales/:id/void', async (req, res) => {
  const { id } = req.params;
  const { user_email } = req.body;
  try {
    await db.run('BEGIN TRANSACTION');

    const sale = await db.get('SELECT * FROM sales WHERE id = ?', [id]);
    if (!sale) {
      await safeRollback(db);
      return res.status(404).json({ error: 'Sale invoice not found' });
    }

    if (sale.status === 'cancelled') {
      await safeRollback(db);
      return res.status(400).json({ error: 'Invoice is already voided' });
    }

    await db.run("UPDATE sales SET status = 'cancelled' WHERE id = ?", [id]);

    const items = JSON.parse(sale.items);
    for (const item of items) {
      const convRate = Number(item.conversionRate) || 1;
      const baseQtyRestock = convRate > 0 ? (Number(item.qty || 0) / convRate) : Number(item.qty || 0);
      await db.run(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [baseQtyRestock, item.productId]
      );
    }

    const auditId = 'al_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    await db.run(
      'INSERT INTO audit_logs (id, user_email, action, details) VALUES (?, ?, ?, ?)',
      [auditId, user_email || 'System', 'VOID_INVOICE', `Voided invoice ${sale.invoice_no} (Total: Rs. ${sale.total_amount})`]
    );

    await db.run("DELETE FROM transactions WHERE reference = ? OR reference = ? OR description LIKE ?", [sale.invoice_no, id, `%${sale.invoice_no}%`]);
    await removeRuntimeTransactionsForSale(sale.invoice_no);

    await db.run('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

// SALES RETURNS API
app.get('/api/sales/returns', async (req, res) => {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sales_returns (
        id TEXT PRIMARY KEY,
        return_no TEXT,
        invoice_no TEXT,
        customer_name TEXT,
        customer_phone TEXT,
        returned_items TEXT,
        exchange_items TEXT,
        return_method TEXT,
        return_amount REAL DEFAULT 0,
        exchange_amount REAL DEFAULT 0,
        balance_amount REAL DEFAULT 0,
        total_refunded REAL DEFAULT 0,
        customer_paid REAL DEFAULT 0,
        change_given REAL DEFAULT 0,
        credit_note_no TEXT,
        user_id TEXT,
        status TEXT DEFAULT 'active',
        reason TEXT,
        created_at TEXT,
        is_credit INTEGER DEFAULT 0,
        difference_payment_method TEXT DEFAULT 'Cash'
      )
    `);
    try { await db.exec("ALTER TABLE sales_returns ADD COLUMN is_credit INTEGER DEFAULT 0"); } catch (e) {}
    try { await db.exec("ALTER TABLE sales_returns ADD COLUMN difference_payment_method TEXT DEFAULT 'Cash'"); } catch (e) {}
    const returns = await db.all('SELECT * FROM sales_returns ORDER BY created_at DESC');
    const mapped = returns.map(r => ({
      id: r.id,
      returnNo: r.return_no || r.id,
      return_no: r.return_no || r.id,
      invoiceNo: r.invoice_no,
      invoice_no: r.invoice_no,
      customerName: r.customer_name || 'Guest Customer',
      customer_name: r.customer_name || 'Guest Customer',
      customerPhone: r.customer_phone || '',
      returnedItems: safeParseJson(r.returned_items, []),
      exchangeItems: safeParseJson(r.exchange_items, []),
      returnMethod: r.return_method || 'Cash Refund',
      returnAmount: Number(r.return_amount || 0),
      exchangeAmount: Number(r.exchange_amount || 0),
      balanceAmount: Number(r.balance_amount || 0),
      totalRefunded: Number(r.total_refunded || 0),
      customerPaid: Number(r.customer_paid || 0),
      changeGiven: Number(r.change_given || 0),
      creditNoteNo: r.credit_note_no || '',
      differencePaymentMethod: r.difference_payment_method || 'Cash',
      difference_payment_method: r.difference_payment_method || 'Cash',
      userId: r.user_id,
      status: r.status || 'active',
      reason: r.reason || '',
      created_at: r.created_at,
      isCredit: Boolean(r.is_credit),
      is_credit: Boolean(r.is_credit)
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales/returns', async (req, res) => {
  const { 
    invoiceNo, 
    returnedItems = [], 
    exchangeItems = [], 
    returnMethod = 'Cash Refund', 
    returnAmount = 0,
    exchangeAmount = 0,
    balanceAmount = 0,
    totalRefunded = 0, 
    customerPaid = 0,
    changeGiven = 0,
    creditNoteNo = '',
    customerName = '',
    customerPhone = '',
    differencePaymentMethod,
    difference_payment_method,
    userEmail = 'system', 
    reason = '' 
  } = req.body;

  const timestamp = Date.now();
  const id = 'sr_' + timestamp;
  const return_no = 'RET-' + String(timestamp).slice(-6);
  const created_at = new Date().toISOString();

  const startTime = Date.now();
  console.log(`[START] Process Sales Return: Invoice ${invoiceNo}`);
  let txn = null;

  try {
    txn = await beginTxn(db, `Sales Return ${invoiceNo}`);

    // 1. Verify original invoice & remaining returnable quantities
    const sale = await db.get('SELECT * FROM sales WHERE invoice_no = ?', [invoiceNo]);
    if (!sale) {
      await rollbackTxn(db, txn);
      return res.status(404).json({ error: `Invoice ${invoiceNo} not found.` });
    }

    const originalItems = safeParseJson(sale.items, []);
    const activeReturns = await db.all('SELECT returned_items FROM sales_returns WHERE invoice_no = ? AND status = ?', [invoiceNo, 'active']);
    
    // Map cumulative returned quantities per unique invoice line item (invoiceNo + lineId or lineIndex)
    const getInvoiceLineKey = (i, defaultIdx) => {
      if (i.lineId || i.line_id) return `${invoiceNo}_${i.lineId || i.line_id}`;
      const pId = i.productId || i.product_id || i.id || '';
      const uKey = (i.unit || '').toLowerCase().trim();
      const idxStr = i.lineIndex !== undefined ? i.lineIndex : defaultIdx;
      return idxStr !== undefined ? `${invoiceNo}_line_${idxStr}` : `${invoiceNo}_${pId}_${uKey}`;
    };

    const alreadyReturnedMap = {};
    activeReturns.forEach(r => {
      const rItems = safeParseJson(r.returned_items, []);
      rItems.forEach((ri, riIdx) => {
        const key = getInvoiceLineKey(ri, ri.lineIndex !== undefined ? ri.lineIndex : riIdx);
        alreadyReturnedMap[key] = (alreadyReturnedMap[key] || 0) + Number(ri.qty || 0);
      });
    });

    // Validate that current return qtys do not exceed remaining returnable qty per unique invoice line
    for (let idx = 0; idx < returnedItems.length; idx++) {
      const item = returnedItems[idx];
      const pId = item.productId || item.product_id;
      const uKey = (item.unit || '').toLowerCase().trim();
      const lineKey = getInvoiceLineKey(item, item.lineIndex !== undefined ? item.lineIndex : idx);

      const origItem = (item.lineIndex !== undefined && originalItems[item.lineIndex])
        ? originalItems[item.lineIndex]
        : (originalItems.find(i => (i.lineId && (i.lineId === item.lineId || i.lineId === item.line_id))) ||
           originalItems.find(i => (i.productId || i.id || i.product_id) === pId && (i.unit || '').toLowerCase().trim() === uKey) ||
           originalItems.find(i => (i.productId || i.id || i.product_id) === pId));

      if (!origItem) {
        await safeRollback(db);
        return res.status(400).json({ error: `Line item ${item.productName || pId} (${item.unit || ''}) was not found in original invoice.` });
      }

      const origQty = Number(origItem.qty || 0);
      const alreadyReturnedQty = alreadyReturnedMap[lineKey] !== undefined ? alreadyReturnedMap[lineKey] : 0;
      const remainingQty = origQty - alreadyReturnedQty;

      if (Number(item.qty || 0) > remainingQty + 0.0001) {
        await safeRollback(db);
        return res.status(400).json({ 
          error: `Cannot return ${item.qty} ${item.unit || ''} of ${item.productName}. Maximum remaining returnable quantity for this invoice line is ${remainingQty}.` 
        });
      }
    }

    const resolvedCustName = customerName || sale.customer_name || sale.customerName || 'Guest Customer';
    const resolvedCustPhone = customerPhone || sale.customer_phone || sale.customerPhone || '';

    // Detect if invoice / customer is a Credit Customer
    const salePayMethod = (sale.payment_method || sale.paymentMethod || '').toString().toLowerCase().trim();
    const saleStatus = (sale.status || '').toString().toLowerCase().trim();
    let isCreditCustomer = salePayMethod === 'credit' || salePayMethod === 'credit sale' || sale.is_credit === 1 || sale.is_credit === true || saleStatus === 'non paid' || saleStatus === 'non-paid' || saleStatus === 'partially paid' || saleStatus === 'partially settled';

    if (!isCreditCustomer && sale.customer_id) {
      const custRecord = await db.get('SELECT * FROM customers WHERE id = ?', [sale.customer_id]);
      if (custRecord) {
        const custType = (custRecord.type || '').toString().toLowerCase().trim();
        if (custType === 'credit' || custRecord.is_credit === 1 || custRecord.is_credit === true) {
          isCreditCustomer = true;
        }
      }
    }

    // Calculate actual returnAmount & exchangeAmount
    const calcReturnAmount = returnAmount || returnedItems.reduce((acc, i) => acc + (Number(i.qty || 0) * Number(i.price || 0)), 0);
    const calcExchangeAmount = exchangeAmount || exchangeItems.reduce((acc, i) => acc + (Number(i.qty || 0) * Number(i.price || 0)), 0);

    // Safety Rule 8: For Credit Customers, force Return & Exchange method, 0 cash refund, 0 cash change
    let finalReturnMethod = returnMethod;
    let finalTotalRefunded = totalRefunded;
    let finalChangeGiven = changeGiven;
    let finalCustomerPaid = customerPaid;

    if (isCreditCustomer) {
      finalReturnMethod = (exchangeItems && exchangeItems.length > 0) ? 'Exchange' : 'Return';
      finalTotalRefunded = 0;
      finalChangeGiven = 0;
      const netDiff = calcExchangeAmount - calcReturnAmount;
      if (netDiff <= 0) {
        finalCustomerPaid = 0;
      }
    }

    let finalCreditNoteNo = creditNoteNo;
    if (finalReturnMethod === 'Credit Note' && !finalCreditNoteNo) {
      finalCreditNoteNo = 'CN-' + String(timestamp).slice(-6);
    }

    const finalDiffMethod = differencePaymentMethod || difference_payment_method || (isCreditCustomer ? 'Customer Credit Debt' : 'Cash');

    // 2. Save Sales Return record
    await db.run(
      `INSERT INTO sales_returns (
        id, return_no, invoice_no, customer_name, customer_phone, 
        returned_items, exchange_items, return_method, return_amount, exchange_amount, 
        balance_amount, total_refunded, customer_paid, change_given, credit_note_no, 
        user_id, status, reason, created_at, is_credit, difference_payment_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, return_no, invoiceNo, resolvedCustName, resolvedCustPhone,
        JSON.stringify(returnedItems), JSON.stringify(exchangeItems), finalReturnMethod, calcReturnAmount, calcExchangeAmount,
        balanceAmount, finalTotalRefunded, finalCustomerPaid, finalChangeGiven, finalCreditNoteNo,
        userEmail || 'system', 'active', reason || '', created_at, isCreditCustomer ? 1 : 0, finalDiffMethod
      ]
    );

    // 3. Restock returned items (preserving original sale conversion rate)
    for (const item of returnedItems) {
      const pId = item.productId || item.product_id;
      const uKey = (item.unit || '').toLowerCase().trim();
      const origItem = originalItems.find(i => 
        (i.lineId && (i.lineId === item.lineId || i.lineId === item.line_id)) ||
        ((i.productId || i.id || i.product_id) === pId && (i.unit || '').toLowerCase().trim() === uKey)
      ) || originalItems.find(i => (i.productId || i.id || i.product_id) === pId);

      const convRate = Number(item.conversionRate) || Number(origItem?.conversionRate) || 1;
      const rawBaseRestock = convRate > 0 ? (Number(item.qty || 0) / convRate) : Number(item.qty || 0);
      const baseQtyRestock = Math.round(rawBaseRestock * 1000000) / 1000000;
      await db.run(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [baseQtyRestock, pId]
      );
    }

    // 4. Handle Exchange items stock deduction with ATOMIC AVAILABILITY GUARD
    if (finalReturnMethod === 'Exchange' && exchangeItems.length > 0) {
      for (const exItem of exchangeItems) {
        const exProdId = exItem.productId || exItem.product_id;
        const prod = await db.get('SELECT id, name, sku, stock FROM products WHERE id = ? OR sku = ?', [exProdId, exProdId]);
        
        if (!prod) {
          throw new Error(`Replacement product (ID/SKU: ${exProdId}) not found in inventory.`);
        }

        const convRate = Number(exItem.conversionRate) || 1;
        const rawBaseDeduction = convRate > 0 ? (Number(exItem.qty || 0) / convRate) : Number(exItem.qty || 0);
        const baseQtyDeduction = Math.round(rawBaseDeduction * 1000000) / 1000000;

        if (Number(prod.stock || 0) < baseQtyDeduction) {
          throw new Error(`Insufficient inventory: "${prod.name}" only has ${prod.stock} available. Cannot fulfill exchange of ${exItem.qty} pcs.`);
        }

        await db.run(
          'UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?',
          [baseQtyDeduction, prod.id]
        );
      }
    }

    // 5. Handle Credit Note creation if finalReturnMethod === 'Credit Note'
    if (finalReturnMethod === 'Credit Note') {
      const cnId = 'cn_' + timestamp;
      await db.run(
        `INSERT INTO credit_notes (
          id, credit_note_no, code, invoice_no, customer_id, customer_name, customer_phone, 
          items, amount, value, balance_remaining, status, reason, user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          cnId, finalCreditNoteNo, finalCreditNoteNo, invoiceNo, sale.customer_id || '', resolvedCustName, resolvedCustPhone,
          JSON.stringify(returnedItems), calcReturnAmount, calcReturnAmount, calcReturnAmount, 'active', reason || 'Sales Return Credit Note', userEmail || 'system', created_at
        ]
      );
    }

    // 6. Log financial transactions & revenue adjustments
    if (isCreditCustomer) {
      const netReturnVal = calcReturnAmount - calcExchangeAmount;
      if (netReturnVal > 0) {
        // Credit sale return/exchange where returned value > exchange value:
        // Log contra_revenue to decrease Total Revenue by netReturnVal
        const txId = 't_' + Date.now();
        await db.run(
          'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, 'contra_revenue', 'Sales Return (Credit Adjustment)', `Credit Return Revenue Adjustment for ${invoiceNo}`, netReturnVal, new Date(created_at).toLocaleDateString('sv-SE'), invoiceNo, userEmail || 'system']
        );
      }
      if (finalCustomerPaid > 0) {
        const txId = 't_' + Date.now() + '_ex';
        await db.run(
          'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, 'income', 'Exchange Payment', `Exchange Balance Payment for ${invoiceNo}`, finalCustomerPaid - finalChangeGiven, new Date(created_at).toLocaleDateString('sv-SE'), invoiceNo, userEmail || 'system']
        );
      }
    } else {
      // Non-credit (Cash / Normal Sale Return)
      if (finalReturnMethod === 'Cash Refund' && finalTotalRefunded > 0) {
        const txId = 't_' + Date.now();
        await db.run(
          'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, 'contra_revenue', 'Sales Return', `Sales Return Refund for ${invoiceNo}`, finalTotalRefunded, new Date(created_at).toLocaleDateString('sv-SE'), invoiceNo, userEmail || 'system']
        );
      } else if (finalReturnMethod === 'Exchange') {
        if (finalCustomerPaid > 0) {
          const txId = 't_' + Date.now();
          await db.run(
            'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [txId, 'income', 'Exchange Payment', `Exchange Balance Payment for ${invoiceNo}`, finalCustomerPaid - finalChangeGiven, new Date(created_at).toLocaleDateString('sv-SE'), invoiceNo, userEmail || 'system']
          );
        } else if (finalTotalRefunded > 0) {
          const txId = 't_' + Date.now();
          await db.run(
            'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [txId, 'contra_revenue', 'Exchange Refund', `Exchange Balance Refund for ${invoiceNo}`, finalTotalRefunded, new Date(created_at).toLocaleDateString('sv-SE'), invoiceNo, userEmail || 'system']
          );
        }
      }
    }

    // Credit return balance adjustments are derived dynamically from sales_returns without mutating sales.payment_received or sales.total_amount

    // 7. Update sales invoice status (Partially Returned / Fully Returned)
    const updatedActiveReturns = await db.all('SELECT returned_items FROM sales_returns WHERE invoice_no = ? AND status = ?', [invoiceNo, 'active']);
    let totalReturnedQty = 0;
    let totalOriginalQty = 0;
    originalItems.forEach(i => { totalOriginalQty += Number(i.qty || 0); });
    updatedActiveReturns.forEach(r => {
      const rItems = safeParseJson(r.returned_items, []);
      rItems.forEach(ri => { totalReturnedQty += Number(ri.qty || 0); });
    });

    let newStatus = sale.status;
    if (totalReturnedQty >= totalOriginalQty && totalOriginalQty > 0) {
      newStatus = 'Fully Returned';
    } else if (totalReturnedQty > 0) {
      newStatus = 'Partially Returned';
    }
    await db.run('UPDATE sales SET status = ? WHERE id = ?', [newStatus, sale.id]);

    await logAudit(userEmail || 'system', 'SALES_RETURN', `Processed ${finalReturnMethod} (Return No: ${return_no}) for Invoice ${invoiceNo} (Amount: Rs. ${calcReturnAmount})`);

    await commitTxn(db, txn);
    console.log(`[END] Process Sales Return: Invoice ${invoiceNo} - ${Date.now() - startTime}ms`);
    res.json({ 
      success: true, 
      id, 
      returnNo: return_no, 
      return_no,
      invoice_no: invoiceNo, 
      totalRefunded: finalTotalRefunded,
      creditNoteNo: finalCreditNoteNo
    });
  } catch (err) {
    try { await db.run('ROLLBACK'); } catch (e) {}
    console.error('Error processing sales return:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales/returns/:id/void', async (req, res) => {
  const { id } = req.params;
  const { userEmail, user_email, reason } = req.body;
  const user = userEmail || user_email || 'system';
  try {
    await db.run('BEGIN TRANSACTION');

    const sr = await db.get('SELECT * FROM sales_returns WHERE id = ?', [id]);
    if (!sr) {
      await safeRollback(db);
      return res.status(404).json({ error: 'Sales Return record not found' });
    }

    if (sr.status === 'voided') {
      await safeRollback(db);
      return res.status(400).json({ error: 'Sales Return is already voided' });
    }

    // 1. Mark status as voided
    await db.run("UPDATE sales_returns SET status = 'voided' WHERE id = ?", [id]);

    // 2. Re-deduct stock for returned items
    const returnedItems = safeParseJson(sr.returned_items, []);
    for (const item of returnedItems) {
      const convRate = Number(item.conversionRate) || 1;
      const baseQtyDeduction = convRate > 0 ? (Number(item.qty || 0) / convRate) : Number(item.qty || 0);
      await db.run(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [baseQtyDeduction, item.productId || item.product_id]
      );
    }

    // 3. Re-add stock for exchange items if applicable
    const exchangeItems = safeParseJson(sr.exchange_items, []);
    for (const item of exchangeItems) {
      const convRate = Number(item.conversionRate) || 1;
      const baseQtyRestock = convRate > 0 ? (Number(item.qty || 0) / convRate) : Number(item.qty || 0);
      await db.run(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [baseQtyRestock, item.productId || item.product_id]
      );
    }

    // 4. Void associated Credit Note if applicable
    if (sr.credit_note_no) {
      await db.run("UPDATE credit_notes SET status = 'voided', balance_remaining = 0 WHERE credit_note_no = ?", [sr.credit_note_no]);
    }

    // 5. Reverse financial refund & credit adjustment transactions
    await db.run("DELETE FROM transactions WHERE reference = ? AND (category LIKE 'Sales Return%' OR category LIKE 'Exchange%' OR category = 'Sales Return')", [sr.invoice_no]);

    // 6. Update sales invoice status accurately
    const sale = await db.get('SELECT * FROM sales WHERE invoice_no = ?', [sr.invoice_no]);
    if (sale) {
      const originalItems = safeParseJson(sale.items, []);
      const allActiveReturns = await db.all('SELECT returned_items FROM sales_returns WHERE invoice_no = ? AND status = ?', [sr.invoice_no, 'active']);
      let totalReturnedQty = 0;
      let totalOriginalQty = 0;
      originalItems.forEach(i => { totalOriginalQty += Number(i.qty || 0); });
      allActiveReturns.forEach(r => {
        const rItems = safeParseJson(r.returned_items, []);
        rItems.forEach(ri => { totalReturnedQty += Number(ri.qty || 0); });
      });

      let newStatus = sale.status;
      const salePayMethod = (sale.payment_method || sale.paymentMethod || '').toString().toLowerCase().trim();
      const isCreditSale = salePayMethod === 'credit' || salePayMethod === 'credit sale' || sale.is_credit === 1 || sale.is_credit === true;

      if (totalReturnedQty === 0) {
        if (isCreditSale) {
          const rec = Number(sale.payment_received || 0);
          const tot = Number(sale.total_amount !== undefined ? sale.total_amount : (sale.total || 0));
          if (rec >= tot - 0.01) {
            newStatus = 'Paid';
          } else if (rec > 0) {
            newStatus = 'Partially Paid';
          } else {
            const dueDate = sale.due_date ? new Date(sale.due_date) : null;
            if (dueDate && dueDate < new Date()) {
              newStatus = 'Overdue';
            } else {
              newStatus = 'Non Paid';
            }
          }
        } else {
          newStatus = 'Paid';
        }
      } else if (totalReturnedQty >= totalOriginalQty && totalOriginalQty > 0) {
        newStatus = 'Fully Returned';
      } else {
        newStatus = 'Partially Returned';
      }
      await db.run('UPDATE sales SET status = ? WHERE id = ?', [newStatus, sale.id]);
    }

    await logAudit(user, 'VOID_SALES_RETURN', `Voided Sales Return ${id} for Invoice ${sr.invoice_no}. Reason: ${reason || 'N/A'}`);

    await db.run('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sales/returns/:id', async (req, res) => {
  const { id } = req.params;
  const { userEmail, user_email } = req.body || {};
  const user = userEmail || user_email || 'system';
  try {
    await db.run('BEGIN TRANSACTION');

    const sr = await db.get('SELECT * FROM sales_returns WHERE id = ? OR return_no = ?', [id, id]);
    if (!sr) {
      await safeRollback(db);
      return res.status(404).json({ error: 'Sales Return record not found' });
    }

    if (sr.status !== 'voided') {
      const returnedItems = safeParseJson(sr.returned_items, []);
      for (const item of returnedItems) {
        const convRate = Number(item.conversionRate) || 1;
        const baseQtyDeduction = convRate > 0 ? (Number(item.qty || 0) / convRate) : Number(item.qty || 0);
        await db.run(
          'UPDATE products SET stock = stock - ? WHERE id = ?',
          [baseQtyDeduction, item.productId || item.product_id]
        );
      }

      const exchangeItems = safeParseJson(sr.exchange_items, []);
      for (const item of exchangeItems) {
        const convRate = Number(item.conversionRate) || 1;
        const baseQtyRestock = convRate > 0 ? (Number(item.qty || 0) / convRate) : Number(item.qty || 0);
        await db.run(
          'UPDATE products SET stock = stock + ? WHERE id = ?',
          [baseQtyRestock, item.productId || item.product_id]
        );
      }

      if (sr.credit_note_no) {
        await db.run("UPDATE credit_notes SET status = 'voided', balance_remaining = 0 WHERE credit_note_no = ?", [sr.credit_note_no]);
      }

      await db.run("DELETE FROM transactions WHERE reference = ? AND (category LIKE 'Sales Return%' OR category LIKE 'Exchange%' OR category = 'Sales Return')", [sr.invoice_no]);

      const sale = await db.get('SELECT * FROM sales WHERE invoice_no = ?', [sr.invoice_no]);
      if (sale) {
        const originalItems = safeParseJson(sale.items, []);
        const remainingActiveReturns = await db.all('SELECT returned_items FROM sales_returns WHERE invoice_no = ? AND status = ? AND id != ?', [sr.invoice_no, 'active', sr.id]);
        let totalReturnedQty = 0;
        let totalOriginalQty = 0;
        originalItems.forEach(i => { totalOriginalQty += Number(i.qty || 0); });
        remainingActiveReturns.forEach(r => {
          const rItems = safeParseJson(r.returned_items, []);
          rItems.forEach(ri => { totalReturnedQty += Number(ri.qty || 0); });
        });

        let newStatus = sale.status;
        const salePayMethod = (sale.payment_method || sale.paymentMethod || '').toString().toLowerCase().trim();
        const isCreditSale = salePayMethod === 'credit' || salePayMethod === 'credit sale' || sale.is_credit === 1 || sale.is_credit === true;

        if (totalReturnedQty === 0) {
          if (isCreditSale) {
            const rec = Number(sale.payment_received || 0);
            const tot = Number(sale.total_amount !== undefined ? sale.total_amount : (sale.total || 0));
            if (rec >= tot - 0.01) {
              newStatus = 'Paid';
            } else if (rec > 0) {
              newStatus = 'Partially Paid';
            } else {
              const dueDate = sale.due_date ? new Date(sale.due_date) : null;
              if (dueDate && dueDate < new Date()) {
                newStatus = 'Overdue';
              } else {
                newStatus = 'Non Paid';
              }
            }
          } else {
            newStatus = 'Paid';
          }
        } else if (totalReturnedQty >= totalOriginalQty && totalOriginalQty > 0) {
          newStatus = 'Fully Returned';
        } else {
          newStatus = 'Partially Returned';
        }
        await db.run('UPDATE sales SET status = ? WHERE id = ?', [newStatus, sale.id]);
      }
    }

    await db.run('DELETE FROM sales_returns WHERE id = ? OR return_no = ?', [sr.id, sr.return_no || id]);

    await logAudit(user, 'DELETE_SALES_RETURN', `Deleted Sales Return ${id} for Invoice ${sr.invoice_no}`);

    await db.run('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});


// CREDIT NOTES API
const handleGetCreditNotes = async (req, res) => {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS credit_notes (
        id TEXT PRIMARY KEY,
        credit_note_no TEXT UNIQUE,
        invoice_no TEXT,
        customer_id TEXT,
        customer_name TEXT,
        customer_phone TEXT,
        items TEXT,
        amount REAL,
        balance_remaining REAL,
        status TEXT DEFAULT 'active',
        reason TEXT,
        user_id TEXT,
        created_at TEXT
      )
    `);
    const notes = await db.all('SELECT * FROM credit_notes ORDER BY created_at DESC');
    const mapped = notes.map(cn => ({
      id: cn.id,
      creditNoteNo: cn.credit_note_no || cn.code || cn.id,
      credit_note_no: cn.credit_note_no || cn.code || cn.id,
      code: cn.code || cn.credit_note_no || cn.id,
      invoiceNo: cn.invoice_no || '',
      invoice_no: cn.invoice_no || '',
      customerId: cn.customer_id || '',
      customerName: cn.customer_name || 'Guest Customer',
      customer_name: cn.customer_name || 'Guest Customer',
      customerPhone: cn.customer_phone || '',
      items: safeParseJson(cn.items, []),
      amount: Number(cn.amount || cn.value || 0),
      value: Number(cn.amount || cn.value || 0),
      balanceRemaining: Number(cn.balance_remaining !== undefined ? cn.balance_remaining : (cn.amount || cn.value || 0)),
      balance_remaining: Number(cn.balance_remaining !== undefined ? cn.balance_remaining : (cn.amount || cn.value || 0)),
      status: cn.status || 'active',
      reason: cn.reason || '',
      userId: cn.user_id || 'system',
      created_at: cn.created_at
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.get('/api/sales/credit-notes', handleGetCreditNotes);
app.get('/api/credit-notes', handleGetCreditNotes);

app.post('/api/credit-notes/redeem', async (req, res) => {
  const { code, creditNoteNo, amountApplied = 0, invoiceNo = 'MANUAL_REDEEM', userEmail = 'system' } = req.body;
  const targetCode = code || creditNoteNo;
  try {
    const cn = await db.get(
      "SELECT * FROM credit_notes WHERE (credit_note_no = ? OR code = ?) AND status NOT IN ('Fully Used', 'used', 'voided') AND balance_remaining > 0",
      [targetCode, targetCode]
    );

    if (!cn) {
      return res.status(404).json({ error: `Active Credit Note ${targetCode} not found or fully used.` });
    }

    const cnOriginalVal = Number(cn.amount || cn.value || 0);
    const prevBal = Number(cn.balance_remaining !== undefined ? cn.balance_remaining : cnOriginalVal);
    const redeemAmt = amountApplied > 0 ? Math.min(prevBal, Number(amountApplied)) : prevBal;
    const newBal = Math.max(0, prevBal - redeemAmt);
    let newStatus = 'Active';
    if (newBal <= 0.001) {
      newStatus = 'Fully Used';
    } else if (newBal < (cnOriginalVal > 0 ? cnOriginalVal : prevBal)) {
      newStatus = 'Partially Used';
    }

    await db.run(
      "UPDATE credit_notes SET balance_remaining = ?, status = ? WHERE id = ?",
      [newBal, newStatus, cn.id]
    );

    const usageId = 'cnu_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const created_at = new Date().toISOString();
    await db.run(
      `INSERT INTO credit_note_usage (
        id, credit_note_no, invoice_no, customer_id, customer_name, customer_phone,
        amount_applied, previous_balance, remaining_balance, action, user_email, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usageId,
        cn.credit_note_no || cn.code || targetCode,
        invoiceNo,
        cn.customer_id || '',
        cn.customer_name || 'Guest Customer',
        cn.customer_phone || '',
        redeemAmt,
        prevBal,
        newBal,
        'applied',
        userEmail,
        created_at
      ]
    );

    res.json({
      success: true,
      redeemedAmount: redeemAmt,
      remainingBalance: newBal,
      status: newStatus
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Credit Note Usage History
app.get('/api/credit-notes/usage', async (req, res) => {
  try {
    const logs = await db.all('SELECT * FROM credit_note_usage ORDER BY created_at DESC');
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/credit-notes/:code/usage', async (req, res) => {
  const { code } = req.params;
  try {
    const logs = await db.all('SELECT * FROM credit_note_usage WHERE credit_note_no = ? OR credit_note_no = ? ORDER BY created_at DESC', [code, code]);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Separate Authorized Action: Cash Refund of Credit Note
app.post('/api/credit-notes/refund-cash', async (req, res) => {
  const { code, reason = 'Authorized Cash Refund of Credit Note', userEmail = 'system' } = req.body;
  if (!code) return res.status(400).json({ error: 'Credit Note code is required' });

  try {
    await db.run('BEGIN TRANSACTION');
    const cn = await db.get(
      "SELECT * FROM credit_notes WHERE (credit_note_no = ? OR code = ?) AND balance_remaining > 0 AND status NOT IN ('Fully Used', 'used', 'voided')",
      [code, code]
    );

    if (!cn) {
      await safeRollback(db);
      return res.status(404).json({ error: `Active Credit Note ${code} not found or balance is 0.` });
    }

    const prevBal = Number(cn.balance_remaining !== undefined ? cn.balance_remaining : (cn.amount || cn.value || 0));
    if (prevBal <= 0) {
      await safeRollback(db);
      return res.status(400).json({ error: 'Credit Note balance is 0' });
    }

    // 1. Set Credit Note balance to 0 and status to Fully Used
    await db.run("UPDATE credit_notes SET balance_remaining = 0, status = 'Fully Used' WHERE id = ?", [cn.id]);

    // 2. Log expense transaction in accounting ledger
    const txId = 't_' + Date.now();
    const created_at = new Date().toISOString();
    await db.run(
      'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [txId, 'expense', 'Credit Note Cash Refund', `Authorized Cash Refund of Credit Note ${cn.credit_note_no || code}`, prevBal, new Date().toLocaleDateString('sv-SE'), cn.credit_note_no || code, userEmail]
    );

    // 3. Log usage history
    const usageId = 'cnu_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    await db.run(
      `INSERT INTO credit_note_usage (
        id, credit_note_no, invoice_no, customer_id, customer_name, customer_phone,
        amount_applied, previous_balance, remaining_balance, action, user_email, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        usageId,
        cn.credit_note_no || cn.code || code,
        'CASH_REFUND',
        cn.customer_id || '',
        cn.customer_name || 'Guest Customer',
        cn.customer_phone || '',
        prevBal,
        prevBal,
        0,
        'cash_refund',
        userEmail,
        created_at
      ]
    );

    await logAudit(userEmail, 'CREDIT_NOTE_CASH_REFUND', `Refunded Rs. ${prevBal} cash for Credit Note ${cn.credit_note_no || code}`);

    await db.run('COMMIT');
    res.json({ success: true, message: `Successfully refunded Rs. ${prevBal} cash for Credit Note ${cn.credit_note_no || code}`, refundedAmount: prevBal });
  } catch (err) {
    try { await db.run('ROLLBACK'); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales/credit-notes', async (req, res) => {
  const { 
    invoiceNo = '', 
    customerId = '', 
    customerName = '', 
    customerPhone = '', 
    items = [], 
    amount = 0, 
    reason = '', 
    userEmail = 'system' 
  } = req.body;

  const timestamp = Date.now();
  const id = 'cn_' + timestamp;
  const credit_note_no = 'CN-' + String(timestamp).slice(-6);
  const created_at = new Date().toISOString();

  const startTime = Date.now();
  console.log(`[START] Create Credit Note: ${customer_name}`);
  let txn = null;

  try {
    txn = await beginTxn(db, `Create Credit Note ${customer_name}`);

    await db.run(
      `INSERT INTO credit_notes (
        id, credit_note_no, code, invoice_no, customer_id, customer_name, customer_phone, 
        items, amount, value, balance_remaining, status, reason, user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, credit_note_no, credit_note_no, invoiceNo, customerId, customerName || 'Guest Customer', customerPhone,
        JSON.stringify(items), amount, amount, amount, 'Active', reason || 'Direct Credit Note', userEmail || 'system', created_at
      ]
    );

    await logAudit(userEmail || 'system', 'CREATE_CREDIT_NOTE', `Created Credit Note ${credit_note_no} for ${customerName || 'Customer'} (Amount: Rs. ${amount})`);
    await commitTxn(db, txn);
    console.log(`[END] Create Credit Note: ${credit_note_no} - ${Date.now() - startTime}ms`);
    res.json({ success: true, id, creditNoteNo: credit_note_no, credit_note_no, amount });
  } catch (err) {
    await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales/credit-notes/:id/void', async (req, res) => {
  const { id } = req.params;
  const { userEmail } = req.body;
  try {
    await db.run("UPDATE credit_notes SET status = 'voided' WHERE id = ? OR credit_note_no = ?", [id, id]);
    await logAudit(userEmail || 'system', 'VOID_CREDIT_NOTE', `Voided Credit Note ${id}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREDIT PAYMENTS & SETTLEMENTS API
app.get('/api/credit_payments', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM credit_payments ORDER BY created_at DESC');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/credit-settlements', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM credit_payments ORDER BY created_at DESC');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/credit_payments/sale/:saleId', async (req, res) => {
  const { saleId } = req.params;
  try {
    const data = await db.all('SELECT * FROM credit_payments WHERE sale_id = ? OR invoice_no = ? ORDER BY created_at DESC', [saleId, saleId]);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/credit_payments', async (req, res) => {
  const p = req.body;
  const id = p.id || 'cp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const created_at = p.created_at || new Date().toISOString();
  const payment_date = p.payment_date || created_at;
  const author = p.recorded_by || p.created_by || p.cashier || 'Admin';

  try {
    await db.run(
      `INSERT INTO credit_payments (
        id, sale_id, invoice_no, customer_id, customer_name, amount_paid,
        remaining_balance, payment_method, payment_date, recorded_by, created_by, cashier, user_email, created_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        p.sale_id || p.invoice_id || p.invoice_no || 'INV',
        p.invoice_no || p.invoice_id || 'INV',
        p.customer_id || null,
        p.customer_name || null,
        Number(p.amount_paid !== undefined ? p.amount_paid : (p.amount || 0)),
        Number(p.remaining_balance || 0),
        p.payment_method || 'Cash',
        payment_date,
        author,
        author,
        author,
        p.user_email || 'admin@hardware.erp',
        created_at,
        p.notes || ''
      ]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/credit-settlements', async (req, res) => {
  const p = req.body;
  const id = p.id || 'cp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const created_at = p.created_at || new Date().toISOString();
  const payment_date = p.payment_date || created_at;
  const author = p.recorded_by || p.created_by || p.cashier || 'Admin';

  try {
    await db.run(
      `INSERT INTO credit_payments (
        id, sale_id, invoice_no, customer_id, customer_name, amount_paid,
        remaining_balance, payment_method, payment_date, recorded_by, created_by, cashier, user_email, created_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        p.sale_id || p.invoice_id || p.invoice_no || 'INV',
        p.invoice_no || p.invoice_id || 'INV',
        p.customer_id || null,
        p.customer_name || null,
        Number(p.amount_paid !== undefined ? p.amount_paid : (p.amount || 0)),
        Number(p.remaining_balance || 0),
        p.payment_method || 'Cash',
        payment_date,
        author,
        author,
        author,
        p.user_email || 'admin@hardware.erp',
        created_at,
        p.notes || ''
      ]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// PURCHASE ORDERS API
app.get('/api/purchase-orders', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM purchase_orders ORDER BY created_at DESC');
    const mapped = data.map(po => ({
      id: po.id,
      poNumber: po.po_number,
      supplierName: po.supplier_name,
      items: JSON.parse(po.items),
      total: po.total,
      status: po.status,
      dueDate: po.due_date,
      date: new Date(po.created_at).toLocaleDateString(),
      created_at: po.created_at
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/purchase-orders', async (req, res) => {
  const po = req.body;
  const id = 'po_' + Date.now();
  const created_at = new Date().toISOString();
  try {
    await db.run(
      'INSERT INTO purchase_orders (id, po_number, supplier_name, items, total, status, due_date, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, po.po_number, po.supplier_name, JSON.stringify(po.items), po.total, po.status, po.due_date, po.user_id, created_at]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/purchase-orders/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await db.run('BEGIN TRANSACTION');

    // Fetch PO first to know items
    const po = await db.get('SELECT * FROM purchase_orders WHERE id = ?', [id]);
    if (!po) {
      await safeRollback(db);
      return res.status(404).json({ error: 'Purchase order not found' });
    }

    await db.run('UPDATE purchase_orders SET status = ? WHERE id = ?', [status, id]);

    // If marked received, increment product stock levels, update cost price, increment supplier payable balance, and log expense
    if (status === 'received') {
      const items = JSON.parse(po.items);
      for (const item of items) {
        await db.run(
          'UPDATE products SET stock = stock + ?, cost_price = ? WHERE id = ?',
          [item.qty, item.costPrice || item.cost_price || 0, item.productId]
        );
      }

      if (po.supplier_name) {
        await db.run(
          'UPDATE suppliers SET payable_balance = payable_balance + ? WHERE name = ?',
          [po.total, po.supplier_name]
        );
      }

      await replaceRuntimeTransactionByDescription(`Stock Check-in ${po.po_number}`, {
        type: 'expense',
        category: 'Purchases',
        amount: po.total,
        date: new Date().toLocaleDateString('sv-SE'),
        reference: po.po_number,
        user_id: po.user_id
      });
    }

    await db.run('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/purchase-orders/:id', async (req, res) => {
  const { id } = req.params;
  let txn = null;
  try {
    const po = await db.get('SELECT * FROM purchase_orders WHERE id = ?', [id]);
    if (po) {
      txn = await beginTxn(db, `Delete Purchase Order ${po.po_number}`);
      await removeRuntimeTransactionsForPurchaseOrder(po.po_number);
      await db.run('DELETE FROM purchase_orders WHERE id = ?', [id]);
      await commitTxn(db, txn);
    } else {
      await db.run('DELETE FROM purchase_orders WHERE id = ?', [id]);
    }
    res.json({ success: true });
  } catch (err) {
    if (txn) await rollbackTxn(db, txn); else await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

// EMPLOYEES API
app.get('/api/employees', async (req, res) => {
  try {
    const emps = await getRuntimeEmployeesSnapshot();
    res.json(emps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/employees', async (req, res) => {
  const e = req.body;
  try {
    const employee = normalizeRuntimeEmployee(e);
    await db.run(
      'INSERT INTO employees (id, name, role, department, email, phone, salary, status, attendance, join_date, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [employee.id, employee.name, employee.role, employee.department, employee.email, employee.phone, employee.salary, employee.status, employee.attendance, employee.join_date, employee.user_id]
    );
    res.json({ success: true, id: employee.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/employees/:id', async (req, res) => {
  const { id } = req.params;
  const e = req.body;
  try {
    const existing = await db.get('SELECT * FROM employees WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    const updated = normalizeRuntimeEmployee({ ...existing, ...e, id });
    await db.run(
      'UPDATE employees SET name = ?, role = ?, department = ?, email = ?, phone = ?, salary = ?, status = ?, attendance = ?, join_date = ?, user_id = ? WHERE id = ?',
      [updated.name, updated.role, updated.department, updated.email, updated.phone, updated.salary, updated.status, updated.attendance, updated.join_date, updated.user_id, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/employees/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM employees WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// TRANSACTIONS API (Ledger / Accounting)
app.get('/api/transactions', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM transactions ORDER BY date DESC, created_at DESC');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transactions', async (req, res) => {
  const t = req.body;
  try {
    const transaction = normalizeRuntimeTransaction(t);
    await db.run(
      'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [transaction.id, transaction.type, transaction.category, transaction.description, transaction.amount, transaction.date, transaction.reference, transaction.user_id, transaction.created_at]
    );
    res.json({ success: true, id: transaction.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/transactions/:id', async (req, res) => {
  return res.status(403).json({ error: 'Deleting finance/accounting transaction records is disabled for financial audit compliance.' });
});

// SYSTEM SETTINGS
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getRuntimeSettingsSnapshot();
    res.json({
      ...settings,
      backup_enabled: settings.backup_enabled === 1,
      backup_interval_hours: settings.backup_interval_hours || 6
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  const s = req.body;
  try {
    const updated = await setRuntimeSettings(s);
    await scheduleAutomaticBackups();
    await logAudit(s.user_email || 'system', 'SETTINGS_UPDATED', 'System settings were updated.');
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings/scheduler-status', async (req, res) => {
  try {
    const settings = await getRuntimeSettingsSnapshot();
    const status = getBackupSchedulerStatus();
    res.json({
      ...status,
      backup_enabled: settings.backup_enabled === 1,
      backup_email: settings.backup_email,
      backup_interval_hours: settings.backup_interval_hours || 6
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BACKUP HISTORY LOGS API
const getBackupLogsHandler = async (req, res) => {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS backup_logs (
        id TEXT PRIMARY KEY,
        file_name TEXT,
        file_path TEXT,
        status TEXT,
        type TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    let logs = await db.all('SELECT * FROM backup_logs ORDER BY timestamp DESC');
    
    // Auto-reconcile physical backup files in candidate directories with DB logs
    const candidateDirs = [
      backupsDir,
      path.join(__dirname, 'backups'),
      USER_DATA_PATH ? path.join(USER_DATA_PATH, 'backups') : null,
      process.env.APPDATA ? path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', 'backups') : null
    ].filter(Boolean);

    const loggedNames = new Set(logs.map(l => l.file_name));
    let newLogInserted = false;

    for (const bDir of candidateDirs) {
      try {
        await fs.promises.access(bDir);
        const files = (await fs.promises.readdir(bDir)).filter(f => f.endsWith('.xlsx'));
        for (const file of files) {
          if (!loggedNames.has(file)) {
            const filePath = path.join(bDir, file);
            let stats = { mtimeMs: Date.now(), mtime: new Date() };
            try { stats = await fs.promises.stat(filePath); } catch (e) {}
            const logId = `b_${Math.floor(stats.mtimeMs || Date.now())}`;
            const timestamp = stats.mtime ? stats.mtime.toISOString() : new Date().toISOString();
            
            await db.run(
              'INSERT INTO backup_logs (id, file_name, file_path, status, type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
              [logId, file, filePath, 'Success', 'Manual', timestamp]
            );
            loggedNames.add(file);
            newLogInserted = true;
          }
        }
      } catch (e) {
        // Directory inaccessible or missing
      }
    }

    if (newLogInserted) {
      logs = await db.all('SELECT * FROM backup_logs ORDER BY timestamp DESC');
    }

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.get('/api/backup_logs', getBackupLogsHandler);
app.get('/api/backup-logs', getBackupLogsHandler);

app.delete('/api/backup-logs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const log = await db.get('SELECT * FROM backup_logs WHERE id = ?', [id]);
    if (log && log.file_name) {
      const filename = path.basename(log.file_name);
      const candidateDirs = [
        backupsDir,
        path.join(__dirname, 'backups'),
        USER_DATA_PATH ? path.join(USER_DATA_PATH, 'backups') : null,
        process.env.APPDATA ? path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', 'backups') : null
      ].filter(Boolean);

      for (const bDir of candidateDirs) {
        const filePath = path.join(bDir, filename);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (fileErr) {
            console.error("Error deleting physical backup file:", fileErr);
          }
        }
      }
    }
    await db.run('DELETE FROM backup_logs WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/backup-logs/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: 'Invalid or missing ids array' });
  }
  try {
    const candidateDirs = [
      backupsDir,
      path.join(__dirname, 'backups'),
      USER_DATA_PATH ? path.join(USER_DATA_PATH, 'backups') : null,
      process.env.APPDATA ? path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', 'backups') : null
    ].filter(Boolean);

    for (const id of ids) {
      const log = await db.get('SELECT * FROM backup_logs WHERE id = ?', [id]);
      if (log && log.file_name) {
        const filename = path.basename(log.file_name);
        for (const bDir of candidateDirs) {
          const filePath = path.join(bDir, filename);
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch (fileErr) {
              console.error("Error deleting physical backup file:", fileErr);
            }
          }
        }
      }
      await db.run('DELETE FROM backup_logs WHERE id = ?', [id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const updateEnvCredentials = async (newEnvObj) => {
  try {
    let content = '';
    try {
      await fs.promises.access(envPath);
      content = await fs.promises.readFile(envPath, 'utf8');
    } catch (e) {}

    let lines = content.split(/\r?\n/);

    for (const [key, value] of Object.entries(newEnvObj)) {
      if (!key) continue;
      process.env[key] = value;
      let found = false;
      lines = lines.map(line => {
        if (line.trim().startsWith(`${key}=`)) {
          found = true;
          return `${key}=${value}`;
        }
        return line;
      });
      if (!found) {
        lines.push(`${key}=${value}`);
      }
    }

    const newContent = lines.join('\n');
    const envDir = path.dirname(envPath);
    try {
      await fs.promises.mkdir(envDir, { recursive: true });
    } catch (e) {}

    await fs.promises.writeFile(envPath, newContent, 'utf8');
    console.log('✅ AppData .env configuration updated successfully at:', envPath);
    return true;
  } catch (err) {
    console.error('❌ Failed to update AppData .env file:', err);
    throw err;
  }
};

// GET SMTP CONFIGURATION STATUS (NEVER RETURNS PASSWORD)
app.get('/api/settings/smtp-config', async (req, res) => {
  try {
    const settings = await getRuntimeSettingsSnapshot();
    const user = settings.smtp_user || process.env.SMTP_USER || process.env.GMAIL_USER || '';
    const pass = settings.smtp_pass || process.env.SMTP_PASS || process.env.GMAIL_PASS || '';
    res.json({
      configured: Boolean(user && pass && pass.trim().length > 0),
      gmail_user: user,
      smtp_user: user,
      gmail_pass_configured: Boolean(pass && pass.trim().length > 0),
      smtp_pass_configured: Boolean(pass && pass.trim().length > 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST SMTP CONFIGURATION (SAVES TO APPDATA .ENV)
app.post('/api/settings/smtp-config', async (req, res) => {
  try {
    const { gmail_user, gmail_pass, smtp_host, smtp_port, smtp_user, smtp_pass } = req.body || {};
    const updates = {};
    const effectiveUser = smtp_user || gmail_user;
    const effectivePass = smtp_pass || gmail_pass;

    if (effectiveUser !== undefined && typeof effectiveUser === 'string') {
      updates.GMAIL_USER = effectiveUser.trim();
      updates.SMTP_USER = effectiveUser.trim();
    }
    if (effectivePass && typeof effectivePass === 'string' && effectivePass.trim() !== '' && effectivePass !== '••••••••') {
      updates.GMAIL_PASS = effectivePass.trim();
      updates.SMTP_PASS = effectivePass.trim();
    }
    if (smtp_host) updates.SMTP_HOST = smtp_host.trim();
    if (smtp_port) updates.SMTP_PORT = String(smtp_port).trim();

    await updateEnvCredentials(updates);
    res.json({ success: true, message: 'SMTP credentials saved successfully to AppData configuration!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST TEST SMTP CONNECTION
app.post('/api/settings/test-smtp', async (req, res) => {
  try {
    const settings = await getRuntimeSettingsSnapshot();
    const transporter = createMailTransporter(settings);

    if (!transporter) {
      return res.status(400).json({
        success: false,
        message: 'SMTP credentials missing: GMAIL_USER or GMAIL_PASS / SMTP_USER or SMTP_PASS environment variables are not configured in AppData .env file.'
      });
    }

    const user = settings.smtp_user || process.env.SMTP_USER || process.env.GMAIL_USER;
    await transporter.verify();
    res.json({ success: true, message: `SMTP Connection Successful! Account ${user} authenticated.` });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `SMTP Connection Failed: ${err.message || 'Authentication error. Verify App Password.'}`
    });
  }
});

// TEST EMAIL NOTIFICATION CONFIGURATION
app.post('/api/settings/test-notification', async (req, res) => {
  try {
    const settings = await getRuntimeSettingsSnapshot();
    const email = settings.backup_email || settings.email || 'sanojhardware@gmail.com';
    const emailText = `Greetings,

This is a test notification from the Muthuwadige Hardware ERP system.
Your email system alerts and automated reporting configurations are working correctly!

Details:
- Timestamp: ${new Date().toString()}
- Target Email: ${email}
- Shop Name: ${settings.shop_name}

Muthuwadige Hardware ERP System`;

    const result = await sendNotificationEmail(
      `[Test] Muthuwadige Hardware - Alert Verification`,
      emailText
    );

    if (result.success) {
      res.json({ success: true, message: `Test email alert successfully sent to ${email}!` });
    } else {
      res.status(500).json({ success: false, error: result.reason || result.error || 'SMTP Error. Verify credentials.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// SAFE TRANSACTIONAL DATABASE RESTORE UTILITY
app.post('/api/settings/restore', async (req, res) => {
  const payload = req.body;
  try {
    await db.run('BEGIN TRANSACTION');

    if (payload.products && Array.isArray(payload.products)) {
      await db.run('DELETE FROM products');
      for (const p of payload.products) {
        await db.run(
          `INSERT INTO products (id, name, sku, category, price, cost_price, stock, min_stock, supplier, unit, barcode, brand, serial_no, batch_code, expiry_date, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id || p["Product ID"] || 'p_' + Date.now() + Math.random().toString(36).substr(2, 5),
            p.name || p["Item Name"] || 'Unnamed Product',
            p.sku || p["Product SKU"] || 'sku_' + Date.now() + Math.random().toString(36).substr(2, 5),
            p.category || p["Category"] || 'Other',
            Number(p.price || p["Base Retail Price (Rs.)"] || 0),
            Number(p.cost_price || p.costPrice || p["Base Cost Price (Rs.)"] || 0),
            Number(p.stock || p["Current Stock Level"] || 0),
            Number(p.min_stock || p.minStock || p["Min Stock Threshold"] || 5),
            p.supplier || p["Supplier Entity"] || '',
            p.unit || p["Measurement Unit"] || p["Unit"] || 'pcs',
            p.barcode || p["Barcode"] || '',
            p.brand || p["Brand"] || '',
            p.serial_no || p.serialNo || p["Serial Number"] || '',
            p.batch_code || p.batchCode || p["Batch Code"] || '',
            p.expiry_date || p.expiryDate || p["Expiry Date"] || '',
            p.created_at || new Date().toISOString()
          ]
        );
      }
    }

    if (payload.sales && Array.isArray(payload.sales)) {
      await db.run('DELETE FROM sales');
      for (const s of payload.sales) {
        await db.run(
          `INSERT INTO sales (id, invoice_no, customer_id, customer_name, items, subtotal, discount, tax, tax_rate, total_amount, status, user_id, payment_method, created_at, due_date, credit_period_days)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            s.id || s["Sale ID"] || 'so_' + Date.now(),
            s.invoice_no || s["Invoice Number"] || '',
            s.customer_id || s["Customer ID"] || '',
            s.customer_name || s["Customer Name"] || 'Guest Customer',
            s.items || s["Sold Items (JSON)"] || '[]',
            Number(s.subtotal || s["Subtotal (Rs.)"] || 0),
            Number(s.discount || s["Discount (Rs.)"] || 0),
            Number(s.tax || s["Tax Amount (Rs.)"] || 0),
            Number(s.tax_rate || s.taxRate || parseFloat(s["Tax Rate (%)"]) || 0),
            Number(s.total_amount || s["Total Amount (Rs.)"] || 0),
            s.status || s["Payment Status"] || 'Paid',
            s.user_id || s["Logged Cashier"] || '---',
            s.payment_method || s["Payment Method"] || 'Cash',
            s.created_at || s["Checkout Date & Time"] || new Date().toISOString(),
            s.due_date || s["Due Date"] || null,
            Number(s.credit_period_days || s["Credit Period (Days)"] || 0)
          ]
        );
      }
    }

    if (payload.transactions && Array.isArray(payload.transactions)) {
      await db.run('DELETE FROM transactions');
      for (const t of payload.transactions) {
        await db.run(
          `INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            t.id || t["Transaction ID"] || 't_' + Date.now(),
            t.type || (t["Flow Type"] ? t["Flow Type"].toLowerCase() : 'income'),
            t.category || t["Finance Category"] || 'Other',
            t.description || t["Description Details"] || '',
            Number(t.amount || t["Transaction Value (Rs.)"] || 0),
            t.date || t["Record Date"] || new Date().toLocaleDateString('sv-SE'),
            t.reference || t["Reference Invoice / PO"] || '---',
            t.user_id || t["Cashier Staff ID"] || '---',
            t.created_at || t["System Log Date"] || new Date().toISOString()
          ]
        );
      }
    }

    if (payload.customers && Array.isArray(payload.customers)) {
      await db.run('DELETE FROM customers');
      for (const c of payload.customers) {
        await db.run(
          `INSERT INTO customers (id, name, email, phone, address, nic, loyalty_points, total_purchases, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            c.id || c["Customer ID"] || 'c_' + Date.now(),
            c.name || c["Customer Name"] || 'Unnamed Customer',
            c.email || c["Email"] || '',
            c.phone || c["Phone Number"] || '',
            c.address || c["Address"] || '',
            c.nic || c["NIC Number"] || '',
            Number(c.loyalty_points || c["Loyalty Points"] || 0),
            Number(c.total_purchases || c["Total Purchases (Rs.)"] || 0),
            c.created_at || c["Registered Date"] || new Date().toISOString()
          ]
        );
      }
    }

    if (payload.employees && Array.isArray(payload.employees)) {
      await db.run('DELETE FROM employees');
      for (const e of payload.employees) {
        await db.run(
          `INSERT INTO employees (id, name, role, department, email, phone, salary, status, attendance, join_date, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            e.id || e["Staff ID"] || 'e_' + Date.now(),
            e.name || e["Full Name"] || 'Unnamed Staff',
            e.role || e["Designated Role"] || 'cashier',
            e.department || e["Department"] || '',
            e.email || e["Email Address"] || '',
            e.phone || e["Phone Number"] || '',
            Number(e.salary || e["Salary (Rs.)"] || 0),
            e.status || e["Active Status"] || 'Active',
            Number(e.attendance || parseFloat(e["Attendance Percentage (%)"]) || 100),
            e.join_date || e["Date of Joining"] || '',
            e.user_id || '',
            e.created_at || new Date().toISOString()
          ]
        );
      }
    }

    if (payload.profiles && Array.isArray(payload.profiles)) {
      await db.run('DELETE FROM profiles');
      for (const pr of payload.profiles) {
        await db.run(
          `INSERT INTO profiles (id, name, email, role, avatar, password, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            pr.id || pr["Profile ID"] || 'u_' + Date.now(),
            pr.name || pr["User Full Name"] || '',
            pr.email || pr["User Email"],
            pr.role || (pr["Access Privilege Level"] ? pr["Access Privilege Level"].toLowerCase() : 'cashier'),
            pr.avatar || pr["Profile Avatar"] || '',
            pr.password || pr["User Password"] || '123456',
            pr.created_at || pr["Created Date"] || new Date().toISOString()
          ]
        );
      }
    }

    if (payload.system_settings && Array.isArray(payload.system_settings)) {
      await db.run('DELETE FROM system_settings');
      for (const set of payload.system_settings) {
        await db.run(
          `INSERT INTO system_settings (id, shop_name, address, phone, email, currency, tax_rate, backup_email, backup_enabled, logo_path, printer_settings, branch_settings, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            'global',
            set.shop_name || set["Shop Name"] || 'MUTHUWADIGE HARDWARE',
            set.address || set["Address"] || '',
            set.phone || set["Phone"] || '',
            set.email || set["Email"] || '',
            set.currency || set["Currency"] || 'Rs.',
            Number(set.tax_rate || set["Tax Rate (%)"] || 8),
            set.backup_email || set["Backup Email"] || '',
            (set.backup_enabled === 1 || set.backup_enabled === true || set["Weekly Auto-Backup"] === 'ENABLED') ? 1 : 0,
            set.logo_path || set["Logo Path Base64"] || '',
            set.printer_settings || set["Printer Config JSON"] || '',
            set.branch_settings || set["Branch Config JSON"] || '',
            set.updated_at || set["Last Synced Time"] || new Date().toISOString()
          ]
        );
      }
    }

    if (payload.suppliers && Array.isArray(payload.suppliers)) {
      await db.run('DELETE FROM suppliers');
      for (const s of payload.suppliers) {
        await db.run(
          `INSERT INTO suppliers (id, name, email, phone, address, credit_terms, payable_balance, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            s.id || s["Supplier ID"] || 'sup_' + Date.now(),
            s.name || s["Supplier Name"] || 'Unnamed Supplier',
            s.email || s["Email Address"] || '',
            s.phone || s["Phone Number"] || '',
            s.address || s["Address"] || '',
            s.credit_terms || s["Credit Terms"] || '',
            Number(s.payable_balance || s["Payable Balance (Rs.)"] || 0),
            s.created_at || s["Registered Date"] || new Date().toISOString()
          ]
        );
      }
    }

    if (payload.purchase_orders && Array.isArray(payload.purchase_orders)) {
      await db.run('DELETE FROM purchase_orders');
      for (const po of payload.purchase_orders) {
        await db.run(
          `INSERT INTO purchase_orders (id, po_no, supplier_id, supplier_name, items, total, status, due_date, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            po.id || po["PO ID"] || 'po_' + Date.now(),
            po.po_no || po["PO Number"] || '',
            po.supplier_id || po["Supplier ID"] || '',
            po.supplier_name || po["Supplier Name"] || '',
            po.items || po["PO Items (JSON)"] || '[]',
            Number(po.total || po["Total Amount (Rs.)"] || 0),
            po.status || po["PO Status"] || 'Pending',
            po.due_date || po["Due Date"] || '',
            po.user_id || '',
            po.created_at || po["Created Date"] || new Date().toISOString()
          ]
        );
      }
    }

    if (payload.stock_adjustments && Array.isArray(payload.stock_adjustments)) {
      await db.run('DELETE FROM stock_adjustments');
      for (const sa of payload.stock_adjustments) {
        await db.run(
          `INSERT INTO stock_adjustments (id, product_id, product_name, old_qty, new_qty, reason, type, user_email, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sa.id || sa["Adjustment ID"] || 'sa_' + Date.now(),
            sa.product_id || sa["Product ID"] || '',
            sa.product_name || sa["Product Name"] || '',
            Number(sa.old_qty || sa["Old Quantity"] || 0),
            Number(sa.new_qty || sa["New Quantity"] || 0),
            sa.reason || sa["Reason Details"] || '',
            sa.type || sa["Adjustment Type"] || 'Adjustment',
            sa.user_email || sa["Staff Email"] || '',
            sa.created_at || sa["Timestamp"] || new Date().toISOString()
          ]
        );
      }
    }

    if (payload.quotations && Array.isArray(payload.quotations)) {
      await db.run('DELETE FROM quotations');
      for (const q of payload.quotations) {
        await db.run(
          `INSERT INTO quotations (id, quote_no, customer_name, items, total, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            q.id || q["Quotation ID"] || 'q_' + Date.now(),
            q.quote_no || q["Quotation Number"] || '',
            q.customer_name || q["Customer Name"] || '',
            q.items || q["Items (JSON)"] || '[]',
            Number(q.total || q["Total Amount (Rs.)"] || 0),
            q.created_at || q["Created Date"] || new Date().toISOString()
          ]
        );
      }
    }

    if (payload.delivery_notes && Array.isArray(payload.delivery_notes)) {
      await db.run('DELETE FROM delivery_notes');
      for (const dn of payload.delivery_notes) {
        await db.run(
          `INSERT INTO delivery_notes (id, dn_no, customer_name, items, reference_invoice, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            dn.id || dn["DN ID"] || 'dn_' + Date.now(),
            dn.dn_no || dn["DN Number"] || '',
            dn.customer_name || dn["Customer Name"] || '',
            dn.items || dn["Items (JSON)"] || '[]',
            dn.reference_invoice || dn["Reference Invoice"] || '',
            dn.created_at || dn["Created Date"] || new Date().toISOString()
          ]
        );
      }
    }

    if (payload.branches && Array.isArray(payload.branches)) {
      await db.run('DELETE FROM branches');
      for (const b of payload.branches) {
        await db.run(
          `INSERT INTO branches (id, name, code, address, phone, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            b.id || b["Branch ID"] || 'b_' + Date.now(),
            b.name || b["Branch Name"] || '',
            b.code || b["Branch Code"] || '',
            b.address || b["Address"] || '',
            b.phone || b["Phone Number"] || '',
            b.created_at || b["Created Date"] || new Date().toISOString()
          ]
        );
      }
    }

    await db.run('COMMIT');
    res.json({ success: true, message: 'Database successfully restored from Excel workbook!' });
  } catch (err) {
    await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

// PROFILES (All staff users)
app.get('/api/profiles', async (req, res) => {
  try {
    const profiles = await db.all('SELECT * FROM profiles ORDER BY created_at DESC');
    const mapped = profiles.map(pr => {
      let parsedPerms = undefined;
      if (pr.permissions) {
        try {
          parsedPerms = typeof pr.permissions === 'string' ? JSON.parse(pr.permissions) : pr.permissions;
        } catch (_) {}
      }
      return {
        ...pr,
        permissions: parsedPerms
      };
    });
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/profiles/:id', async (req, res) => {
  const { id } = req.params;
  const p = req.body;
  try {
    let permsVal = null;
    if (p.permissions !== undefined) {
      permsVal = p.permissions ? (typeof p.permissions === 'string' ? p.permissions : JSON.stringify(p.permissions)) : null;
    }
    if (p.permissions !== undefined) {
      await db.run(
        'UPDATE profiles SET name = ?, role = ?, avatar = ?, permissions = ? WHERE id = ?',
        [p.name, p.role, p.avatar, permsVal, id]
      );
    } else {
      await db.run(
        'UPDATE profiles SET name = ?, role = ?, avatar = ? WHERE id = ?',
        [p.name, p.role, p.avatar, id]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/profiles/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM profiles WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/profiles/:id/password', async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  try {
    await db.run('UPDATE profiles SET password = ? WHERE id = ?', [password, id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CUSTOM PERMISSIONS API
app.get('/api/permissions', async (req, res) => {
  try {
    const rows = await db.all('SELECT * FROM custom_permissions');
    const perms = {};
    rows.forEach(r => {
      perms[r.role] = JSON.parse(r.pages);
    });
    res.json(perms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/permissions', async (req, res) => {
  const perms = req.body;
  try {
    await db.run('BEGIN TRANSACTION');
    for (const [role, pages] of Object.entries(perms)) {
      await db.run(
        'INSERT OR REPLACE INTO custom_permissions (role, pages) VALUES (?, ?)',
        [role, JSON.stringify(pages)]
      );
    }
    await db.run('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

// SYSTEM DATA RESET ENDPOINT
app.post('/api/system/reset-data', async (req, res) => {
  const { mode, user_email, passkey } = req.body;
  
  try {
    const settings = await db.get("SELECT * FROM system_settings WHERE id = 'global'");
    const validPasskey = settings?.void_passkey || settings?.return_passkey || '1234';
    if (passkey && passkey.trim() !== validPasskey) {
      return res.status(401).json({ error: 'Invalid Security Passkey! Reset operation denied.' });
    }

    await db.run('BEGIN TRANSACTION');

    if (mode === 'full_reset' || mode === 'customer_handoff') {
      await db.run('DELETE FROM sales');
      await db.run('DELETE FROM sales_returns');
      await db.run('DELETE FROM credit_payments');
      await db.run('DELETE FROM credit_notes');
      await db.run('DELETE FROM credit_note_usage');
      await db.run('DELETE FROM transactions');
      await db.run('DELETE FROM audit_logs');
      await db.run('DELETE FROM bill_holds');
      await db.run('DELETE FROM quotations');
      await db.run('DELETE FROM delivery_notes');
      await db.run('DELETE FROM purchase_orders');
      await db.run('DELETE FROM products');
      await db.run('DELETE FROM customers');
      await db.run('DELETE FROM suppliers');
      await db.run('DELETE FROM employees');
      await db.run('DELETE FROM backup_logs');
      await db.run('DELETE FROM stock_adjustments');
      await db.run("UPDATE system_settings SET next_invoice_number = 'INV001'");
    } else if (mode === 'sales_inventory') {
      await db.run('DELETE FROM sales');
      await db.run('DELETE FROM sales_returns');
      await db.run('DELETE FROM credit_payments');
      await db.run('DELETE FROM transactions');
      await db.run('DELETE FROM audit_logs');
      await db.run('DELETE FROM bill_holds');
      await db.run('DELETE FROM products');
    } else {
      await db.run('DELETE FROM sales');
      await db.run('DELETE FROM sales_returns');
      await db.run('DELETE FROM credit_payments');
      await db.run('DELETE FROM transactions');
      await db.run('DELETE FROM audit_logs');
      await db.run('DELETE FROM bill_holds');
      await db.run('UPDATE customers SET current_credit = 0');
    }

    const auditId = 'al_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    await db.run(
      'INSERT INTO audit_logs (id, user_email, action, details) VALUES (?, ?, ?, ?)',
      [auditId, user_email || 'System', 'SYSTEM_RESET', `Performed system data reset (Mode: ${mode || 'transactions_only'})`]
    );

    await db.run('COMMIT');
    res.json({ success: true, message: 'System data reset successfully completed.' });
  } catch (err) {
    await safeRollback(db);
    res.status(500).json({ error: 'Failed to reset data: ' + err.message });
  }
});

// AUDIT LOGS API
app.get('/api/audit_logs', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM audit_logs ORDER BY timestamp DESC');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/audit_logs', async (req, res) => {
  const { user_email, action, details } = req.body;
  const id = 'al_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const timestamp = new Date().toISOString();
  try {
    await db.run(
      'INSERT INTO audit_logs (id, user_email, action, details, timestamp) VALUES (?, ?, ?, ?, ?)',
      [id, user_email, action, details, timestamp]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// QUOTATIONS API
app.get('/api/quotations', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM quotations ORDER BY created_at DESC');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/quotations/next-number', async (req, res) => {
  try {
    const rows = await db.all('SELECT quote_no FROM quotations');
    let maxNum = 0;
    let prefix = 'Q-';
    
    rows.forEach(r => {
      if (r.quote_no) {
        const match = r.quote_no.match(/^(.*?)(\d+)$/);
        if (match) {
          prefix = match[1] || 'Q-';
          const num = parseInt(match[2], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    });

    const nextNum = maxNum + 1;
    const formattedNum = `${prefix}${String(nextNum).padStart(4, '0')}`;
    res.json({ nextNumber: formattedNum });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/quotations', async (req, res) => {
  const {
    quote_no,
    customer_name,
    customer_phone,
    customer_address,
    validity_period,
    items,
    subtotal,
    discount_type,
    discount_value,
    discount_amount,
    transportation_fee,
    tax_amount,
    total,
    status
  } = req.body;

  const id = 'q_' + Date.now();
  const created_at = new Date().toISOString();

  let finalQuoteNo = quote_no;
  if (!finalQuoteNo) {
    const rows = await db.all('SELECT quote_no FROM quotations');
    let maxNum = 0;
    let prefix = 'Q-';
    rows.forEach(r => {
      if (r.quote_no) {
        const match = r.quote_no.match(/^(.*?)(\d+)$/);
        if (match) {
          prefix = match[1] || 'Q-';
          const num = parseInt(match[2], 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      }
    });
    finalQuoteNo = `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
  }

  try {
    await db.run(
      `INSERT INTO quotations (
        id, quote_no, customer_name, customer_phone, customer_address,
        validity_period, items, subtotal, discount_type, discount_value,
        discount_amount, transportation_fee, tax_amount, total, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        finalQuoteNo,
        customer_name || 'Guest Customer',
        customer_phone || '',
        customer_address || '',
        validity_period || '30 Days',
        typeof items === 'string' ? items : JSON.stringify(items || []),
        Number(subtotal || 0),
        discount_type || 'amount',
        Number(discount_value || 0),
        Number(discount_amount || 0),
        Number(transportation_fee || 0),
        0,
        Number(total || 0),
        status || 'Active',
        created_at
      ]
    );
    res.json({ success: true, id, quote_no: finalQuoteNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/quotations/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM quotations WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELIVERY NOTES API
app.get('/api/delivery_notes', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM delivery_notes ORDER BY created_at DESC');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/delivery_notes', async (req, res) => {
  const { dn_no, customer_name, items, reference_invoice } = req.body;
  const id = 'dn_' + Date.now();
  const created_at = new Date().toISOString();
  try {
    await db.run(
      'INSERT INTO delivery_notes (id, dn_no, customer_name, items, reference_invoice, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, dn_no, customer_name, typeof items === 'string' ? items : JSON.stringify(items), reference_invoice, created_at]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/delivery_notes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM delivery_notes WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// STOCK ADJUSTMENTS API
app.get('/api/stock_adjustments', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM stock_adjustments ORDER BY created_at DESC');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stock_adjustments', async (req, res) => {
  const { id, product_id, product_name, old_qty, new_qty, reason, type, user_email, created_at } = req.body;
  const adjId = id || 'sa_' + Date.now();
  const timestamp = created_at || new Date().toISOString();
  try {
    await db.run(
      `INSERT INTO stock_adjustments (id, product_id, product_name, old_qty, new_qty, reason, type, user_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [adjId, product_id, product_name, old_qty || 0, new_qty || 0, reason || '', type || 'Adjustment', user_email || '', timestamp]
    );
    res.json({ success: true, id: adjId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BILL HOLDS API
app.get('/api/bill_holds', async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM bill_holds ORDER BY created_at DESC');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/bill_holds', async (req, res) => {
  const { id, hold_name, customer_id, customer_name, items, subtotal, discount, tax, total_amount, transportation_fee } = req.body;
  const created_at = new Date().toISOString();
  try {
    await db.run(
      'INSERT INTO bill_holds (id, hold_name, customer_id, customer_name, items, subtotal, discount, tax, total_amount, transportation_fee, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id || 'hb_' + Date.now(),
        hold_name,
        customer_id,
        customer_name,
        typeof items === 'string' ? items : JSON.stringify(items),
        subtotal,
        discount,
        0,
        total_amount,
        transportation_fee || 0,
        created_at
      ]
    );
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/bill_holds/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM bill_holds WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Host network interfaces for client/mobile configuration
app.get('/api/system/network-info', (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal loopback and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push({
            interface: name,
            address: iface.address
          });
        }
      }
    }
    
    res.json({
      addresses,
      port: PORT
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Open external URLs (WhatsApp, browser links) via OS shell
app.post('/api/open-url', (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Valid URL is required' });
  }

  // Security check: only allow http, https, and wa.me protocols
  if (!url.startsWith('https://') && !url.startsWith('http://') && !url.startsWith('wa.me')) {
    return res.status(400).json({ error: 'Unsupported URL protocol' });
  }

  const cmd = process.platform === 'win32'
    ? `start "" "${url.replace(/"/g, '""')}"`
    : process.platform === 'darwin'
    ? `open "${url}"`
    : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) {
      console.error("Failed to launch URL via OS shell:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

// =========================================================================
// WIRELESS MOBILE BARCODE SCANNER SIGNALING ENGINE
// =========================================================================

// Active SSE Connections Store for Desktop POS Listeners: Map<sessionId, Set<res>>
const scannerClients = new Map();

// Active Mobile Scanner Clients Map: Map<clientId, { id, ip, userAgent, deviceName, connectedAt, lastSeen, sessionId, res }>
const connectedMobileClients = new Map();

// Helper to parse human-readable device name from User-Agent
function parseDeviceName(ua = '') {
  if (!ua || typeof ua !== 'string') return 'Mobile Browser';
  const lower = ua.toLowerCase();
  if (lower.includes('iphone')) return 'Apple iPhone';
  if (lower.includes('ipad')) return 'Apple iPad';
  if (lower.includes('ipod')) return 'Apple iPod';
  if (lower.includes('android')) {
    const match = ua.match(/Android\s+[\d.]+;\s*([^;]+?)\s*(?:Build|;|\))/i);
    if (match && match[1] && !match[1].toLowerCase().includes('k')) {
      const model = match[1].trim();
      return `Android (${model})`;
    }
    return 'Android Phone';
  }
  if (lower.includes('macintosh') || lower.includes('mac os')) return 'Mac Device';
  if (lower.includes('windows')) return 'Windows PC';
  if (lower.includes('linux')) return 'Linux Device';
  if (lower.includes('cros')) return 'ChromeOS Device';
  return 'Mobile Device';
}

// Helper to extract clean IPv4/IPv6 client address
function getClientIp(req) {
  const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || req.ip || '127.0.0.1';
  return rawIp.replace(/^.*:/, '') || rawIp;
}

// Helper to get mobile clients for a specific session or all sessions
function getSessionClients(sessionId) {
  const target = (sessionId || '').toString().trim();
  const list = [];
  for (const [, c] of connectedMobileClients.entries()) {
    if (!target || target === '*' || c.sessionId === target || c.sessionId === '*') {
      list.push({
        id: c.id,
        ip: c.ip,
        deviceName: c.deviceName,
        connectedAt: c.connectedAt,
        sessionId: c.sessionId
      });
    }
  }
  return list;
}

// Helper to broadcast updated client list to desktop listeners
function notifySessionClientsChanged(sessionId) {
  const targetSession = (sessionId || 'default').toString().trim();
  const clients = getSessionClients(targetSession);
  const payload = JSON.stringify({
    type: 'clients_update',
    sessionId: targetSession,
    count: clients.length,
    clients
  });

  const sessionSet = scannerClients.get(targetSession);
  if (sessionSet) {
    sessionSet.forEach((clientRes) => {
      try {
        clientRes.write(`data: ${payload}\n\n`);
      } catch (_) {}
    });
  }

  const allSubscribers = scannerClients.get('*');
  if (allSubscribers && targetSession !== '*') {
    allSubscribers.forEach((clientRes) => {
      try {
        clientRes.write(`data: ${payload}\n\n`);
      } catch (_) {}
    });
  }
}

// Helper to determine local Wi-Fi / LAN IP addresses
function getLocalNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const [name, nets] of Object.entries(interfaces)) {
    if (!nets) continue;
    for (const net of nets) {
      const isIPv4 = net.family === 'IPv4' || net.family === 4;
      if (isIPv4 && !net.internal) {
        addresses.push({
          name,
          address: net.address,
          isWifi: name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('wifi') || name.toLowerCase().includes('wlan') || name.toLowerCase().includes('wireless')
        });
      }
    }
  }

  // Sort Wi-Fi interfaces first
  addresses.sort((a, b) => (b.isWifi ? 1 : 0) - (a.isWifi ? 1 : 0));

  const primaryIp = addresses.length > 0 ? addresses[0].address : '127.0.0.1';
  return { primaryIp, addresses };
}

// Helper to get or generate persistent self-signed SSL certificates for mobile HTTPS
async function getOrCreateSslCertificate() {
  const certDir = USER_DATA_PATH ? path.join(USER_DATA_PATH, 'certs') : path.join(__dirname, 'certs');
  if (!fs.existsSync(certDir)) {
    fs.mkdirSync(certDir, { recursive: true });
  }
  const certFile = path.join(certDir, 'cert.pem');
  const keyFile = path.join(certDir, 'key.pem');

  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    try {
      const cert = fs.readFileSync(certFile, 'utf8');
      const key = fs.readFileSync(keyFile, 'utf8');
      if (cert && key) {
        return { cert, key };
      }
    } catch (e) {}
  }

  const { addresses } = getLocalNetworkAddresses();
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' }
  ];
  addresses.forEach(a => {
    if (a.address && a.address !== '127.0.0.1') {
      altNames.push({ type: 7, ip: a.address });
    }
  });

  const pems = await selfsigned.generate(
    [
      { name: 'commonName', value: 'Muthuwadige Hardware ERP Mobile Scanner' },
      { name: 'organizationName', value: 'Muthuwadige Hardware' }
    ],
    {
      days: 3650,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames }]
    }
  );

  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(keyFile, pems.private);

  return { cert: pems.cert, key: pems.private };
}

// 1. GET /api/scanner/local-ip
app.get('/api/scanner/local-ip', (req, res) => {
  const { primaryIp, addresses } = getLocalNetworkAddresses();
  const scannerUrl = `https://${primaryIp}:${HTTPS_PORT}/mobile-scanner`;
  const httpScannerUrl = `http://${primaryIp}:${PORT}/mobile-scanner`;
  res.json({
    success: true,
    ip: primaryIp,
    port: PORT,
    httpsPort: HTTPS_PORT,
    ips: addresses,
    scannerUrl,
    httpScannerUrl,
    protocol: 'https'
  });
});

// 2. GET /api/scanner/stream (Server-Sent Events)
app.get('/api/scanner/stream', (req, res) => {
  const sessionId = (req.query.sessionId || req.query.session || 'default').toString().trim();
  const clientType = (req.query.clientType || req.query.type || 'desktop').toString().trim().toLowerCase();
  const isMobile = clientType === 'mobile' || req.query.mobile === 'true';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  if (isMobile) {
    const userAgent = req.headers['user-agent'] || '';
    const ip = getClientIp(req);
    const deviceName = parseDeviceName(userAgent);
    const clientId = `mob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const clientRecord = {
      id: clientId,
      ip,
      userAgent,
      deviceName,
      connectedAt: new Date().toISOString(),
      lastSeen: Date.now(),
      sessionId,
      res
    };

    connectedMobileClients.set(clientId, clientRecord);

    console.log(`📱 [Mobile Scanner Connected] ${deviceName} (${ip}) paired with session "${sessionId}" [ID: ${clientId}]`);

    // Send immediate welcome handshake to mobile client
    res.write(`data: ${JSON.stringify({ type: 'connected', role: 'mobile', clientId, sessionId, message: 'Mobile scanner registered successfully' })}\n\n`);

    // Notify desktop POS clients listening to this session
    notifySessionClientsChanged(sessionId);

    // Emit periodic heartbeat (ping every 5s)
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (_) {
        clearInterval(pingInterval);
      }
    }, 5000);

    req.on('close', () => {
      clearInterval(pingInterval);
      connectedMobileClients.delete(clientId);
      console.log(`📴 [Mobile Scanner Disconnected] ${deviceName} (${ip}) left session "${sessionId}"`);
      notifySessionClientsChanged(sessionId);
    });

  } else {
    // Desktop POS Listener (NOT counted as a mobile device)
    if (!scannerClients.has(sessionId)) {
      scannerClients.set(sessionId, new Set());
    }
    scannerClients.get(sessionId).add(res);

    const currentClients = getSessionClients(sessionId);

    // Send immediate welcome handshake with active mobile clients
    res.write(`data: ${JSON.stringify({
      type: 'connected',
      role: 'desktop',
      sessionId,
      message: 'Connected to local POS scanner stream',
      count: currentClients.length,
      clients: currentClients
    })}\n\n`);

    // Heartbeat ping every 15s to keep desktop socket alive
    const pingInterval = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch (_) {
        clearInterval(pingInterval);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(pingInterval);
      const sessionSet = scannerClients.get(sessionId);
      if (sessionSet) {
        sessionSet.delete(res);
        if (sessionSet.size === 0) {
          scannerClients.delete(sessionId);
        }
      }
    });
  }
});

// 3. GET /api/scanner/clients (Query Active Mobile Devices)
app.get('/api/scanner/clients', (req, res) => {
  const sessionId = (req.query.sessionId || req.query.session || '').toString().trim();
  const clients = getSessionClients(sessionId);
  return res.json({
    success: true,
    sessionId: sessionId || '*',
    count: clients.length,
    clients
  });
});

// 4. POST /api/scanner/broadcast
app.post('/api/scanner/broadcast', (req, res) => {
  const { barcode, sessionId, scannerName, format } = req.body || {};

  if (!barcode || typeof barcode !== 'string' || !barcode.trim()) {
    return res.status(400).json({ error: 'Valid barcode string is required' });
  }

  const cleanBarcode = barcode.trim();
  const targetSession = (sessionId || 'default').toString().trim();
  const sessionSet = scannerClients.get(targetSession);

  const payload = JSON.stringify({
    type: 'scan',
    barcode: cleanBarcode,
    sessionId: targetSession,
    scannerName: scannerName || 'Mobile Camera',
    format: format || 'AUTO',
    timestamp: Date.now()
  });

  let deliveredCount = 0;
  if (sessionSet && sessionSet.size > 0) {
    sessionSet.forEach((client) => {
      try {
        client.write(`data: ${payload}\n\n`);
        deliveredCount++;
      } catch (err) {
        console.warn('[Scanner SSE] Failed to write to client:', err);
      }
    });
  }

  // Also broadcast to wildcard subscribers if any
  const allSubscribers = scannerClients.get('*');
  if (allSubscribers && targetSession !== '*') {
    allSubscribers.forEach((client) => {
      try {
        client.write(`data: ${payload}\n\n`);
        deliveredCount++;
      } catch (_) {}
    });
  }

  console.log(`📱 [Scanner Broadcast] Barcode "${cleanBarcode}" sent to session "${targetSession}" (Delivered to ${deliveredCount} client(s))`);

  return res.json({
    success: true,
    delivered: deliveredCount,
    barcode: cleanBarcode,
    sessionId: targetSession
  });
});

// 4. Standalone Mobile Scanner HTML Client Route
const serveMobileScannerHtml = (req, res) => {
  const candidatePaths = [
    path.join(__dirname, 'public', 'mobile-scanner.html'),
    path.join(__dirname, 'dist', 'mobile-scanner.html'),
    path.join(__dirname, 'mobile-scanner.html'),
    USER_DATA_PATH ? path.join(USER_DATA_PATH, 'mobile-scanner.html') : null
  ].filter(Boolean);

  let targetPath = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      targetPath = p;
      break;
    }
  }

  if (targetPath) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.sendFile(targetPath);
  } else {
    return res.status(404).send(`
      <!DOCTYPE html>
      <html>
        <head><title>Mobile Scanner Not Found</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #0f172a; color: white;">
          <h2>Mobile Scanner Web App is initializing...</h2>
          <p>Please ensure public/mobile-scanner.html exists or reload the page.</p>
        </body>
      </html>
    `);
  }
};

app.get('/mobile-scanner', serveMobileScannerHtml);
app.get('/mobile-scanner.html', serveMobileScannerHtml);

// Serve static React production build files from the 'dist' directory
let distPath = path.join(__dirname, 'dist');
try {
  // If running in packaged Electron environment, read dist folder relative to app.getAppPath()
  const electron = await import('electron');
  const electronApp = electron.app || (electron.default && electron.default.app);
  if (electronApp && electronApp.isPackaged) {
    distPath = path.join(electronApp.getAppPath(), 'dist');
  }
} catch (e) {
  // Silent fallback for standalone Node environment
}

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  // Catch-all middleware to serve the React SPA for any client-side routes (independent of Express routing wildcards)
  app.use((req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }
    if (req.path.startsWith('/api') || req.path.startsWith('/backups')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Express server launch hook listening on all network interfaces (HTTP & HTTPS)
(async () => {
  try {
    console.log('[Startup] Initializing SQLite Database & Schema...');
    await initializeDatabase();
    await scheduleAutomaticBackups();

    // 1. HTTP Server for desktop app and fast local REST API
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 REST API Server running on http://0.0.0.0:${PORT}`);
    });

    // 2. HTTPS Server for Mobile Camera Scanner (getUserMedia requires Secure Context)
    try {
      const ssl = await getOrCreateSslCertificate();
      const httpsServer = https.createServer({ key: ssl.key, cert: ssl.cert }, app);
      httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`🔒 HTTPS Server running on https://0.0.0.0:${HTTPS_PORT} (Camera enabled for mobile devices)`);
      });
    } catch (sslErr) {
      console.warn('⚠️ Could not start HTTPS listener for mobile scanner:', sslErr.message);
    }
  } catch (err) {
    console.error('🔴 Failed to initialize local SQLite database:', err);
    process.exit(1);
  }
})();
