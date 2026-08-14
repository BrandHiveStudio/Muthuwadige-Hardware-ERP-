import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import XLSX from 'xlsx-js-style';
import fs from 'fs';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let DB_FILE = path.join(__dirname, 'hardware.db');
let backupsDir = path.join(__dirname, 'backups');
let envPath = path.join(__dirname, '.env');

// Dynamically check if running inside Electron to write databases, backups & env configs to Local AppData
try {
  const electron = await import('electron');
  const electronApp = electron.app || (electron.default && electron.default.app);
  if (electronApp) {
    const isPackaged = electronApp.isPackaged;
    if (isPackaged) {
      const appDataPath = electronApp.getPath('userData');
      DB_FILE = path.join(appDataPath, 'hardware.db');
      backupsDir = path.join(appDataPath, 'backups');
      envPath = path.join(appDataPath, '.env');

      // In production packaged mode: DB_FILE is located in Electron userData directory.
      // On fresh installation (when DB_FILE does not exist), initializeDatabase() programmatically
      // creates a clean SQLite database with full schema and default configurations (without dev/test data).
      // Existing user databases are untouched and preserved with 0 data loss.
      console.log('📂 Production Electron database path:', DB_FILE);

      // Auto-migrate env config: copy/restore .env from bundled code or dev workspace to AppData folder
      const bundledEnv = path.join(__dirname, '.env');
      const devWorkspaceEnv = 'C:\\Users\\amash\\OneDrive\\Desktop\\Hardware\\hardwarer\\.env';
      if (!fs.existsSync(envPath)) {
        try {
          if (fs.existsSync(bundledEnv)) {
            fs.copyFileSync(bundledEnv, envPath);
            console.log('✅ .env file successfully initialized in AppData:', envPath);
          } else if (fs.existsSync(devWorkspaceEnv)) {
            fs.copyFileSync(devWorkspaceEnv, envPath);
            console.log('✅ .env file auto-restored from workspace to AppData:', envPath);
          }
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
  }
} catch (e) {
  // Fallback for standalone Node.js environments
}

dotenv.config({ path: envPath });

const app = express();
app.use(cors());
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
app.use('/backups', express.static(backupsDir));

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

const PORT = 5001;

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
  next_invoice_number: 'INV001',
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
    logo_path: payload.logo_path || payload.logoPath || '',
    printer_settings: safeParseJson(payload.printer_settings || payload.printerSettings),
    branch_settings: safeParseJson(payload.branch_settings || payload.branchSettings),
    next_invoice_number: payload.next_invoice_number || payload.nextInvoiceNumber || DEFAULT_RUNTIME_SETTINGS.next_invoice_number,
    updated_at: payload.updated_at || new Date().toISOString()
  };

  return normalized;
}

async function getRuntimeSettingsSnapshot() {
  let settings = await db.get('SELECT * FROM system_settings WHERE id = ?', ['global']);
  if (!settings) {
    const initial = { ...DEFAULT_RUNTIME_SETTINGS, id: 'global' };
    await db.run(
      'INSERT INTO system_settings (id, shop_name, address, phone, email, currency, tax_rate, backup_email, backup_enabled, logo_path, printer_settings, branch_settings, next_invoice_number, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [initial.id, initial.shop_name, initial.address, initial.phone, initial.email, initial.currency, initial.tax_rate, initial.backup_email, initial.backup_enabled, '', '', '', initial.next_invoice_number, initial.updated_at]
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
      logo_path, 
      printer_settings, 
      branch_settings, 
      next_invoice_number,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      updated.logo_path || '',
      typeof updated.printer_settings === 'object' ? JSON.stringify(updated.printer_settings) : updated.printer_settings || '',
      typeof updated.branch_settings === 'object' ? JSON.stringify(updated.branch_settings) : updated.branch_settings || '',
      updated.next_invoice_number,
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
      payment_received REAL DEFAULT 0
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
      logo_path TEXT DEFAULT '',
      printer_settings TEXT DEFAULT '',
      branch_settings TEXT DEFAULT '',
      next_invoice_number TEXT DEFAULT 'INV001',
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

  // Dynamic migration: Ensure new columns exist on existing DB files
  try {
    await db.exec("ALTER TABLE profiles ADD COLUMN password TEXT DEFAULT '123456'");
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
    await db.exec("ALTER TABLE system_settings ADD COLUMN next_invoice_number TEXT DEFAULT 'INV001'");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE sales ADD COLUMN transportation_fee REAL DEFAULT 0");
  } catch(e) {}
  try {
    await db.exec("ALTER TABLE bill_holds ADD COLUMN transportation_fee REAL DEFAULT 0");
  } catch(e) {}
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
      created_at TEXT
    )
  `);

  // Performance Indexes for fast barcode, invoice, and customer lookups
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_invoice_no ON sales(invoice_no)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales(customer_id)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_credit_notes_no ON credit_notes(credit_note_no)"); } catch(e) {}
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_returns_inv ON sales_returns(invoice_no)"); } catch(e) {}

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
      'INSERT INTO system_settings (id, shop_name, address, phone, email, currency, tax_rate, backup_email, backup_enabled, logo_path, printer_settings, branch_settings, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [initial.id, initial.shop_name, initial.address, initial.phone, initial.email, initial.currency, initial.tax_rate, initial.backup_email, initial.backup_enabled, '', '', '', initial.updated_at]
    );
  }

  // Seed custom permissions if empty
  try {
    const permCheck = await db.get('SELECT COUNT(*) as count FROM custom_permissions');
    if (permCheck?.count === 0) {
      const defaultPermissions = {
        super_admin: [
          'dashboard', 'inventory', 'sales', 'purchasing',
          'customers', 'suppliers', 'reports', 'users', 'database', 'settings', 'finance', 'audit_logs'
        ],
        admin: [
          'dashboard', 'inventory', 'sales', 'purchasing', 'customers', 'suppliers', 'reports', 'settings', 'finance'
        ],
        manager: [
          'dashboard', 'inventory', 'sales', 'purchasing', 'customers', 'suppliers', 'reports', 'finance'
        ],
        cashier: [
          'dashboard', 'sales', 'customers'
        ],
        retail_user: [
          'dashboard', 'sales', 'customers'
        ]
      };
      for (const [role, pages] of Object.entries(defaultPermissions)) {
        await db.run(
          'INSERT INTO custom_permissions (role, pages) VALUES (?, ?)',
          [role, JSON.stringify(pages)]
        );
      }
      console.log('[Startup] Seeded default permissions table.');
    }
  } catch (err) {
    console.error('[Startup] Failed to seed custom permissions:', err.message);
  }

  console.log('✅ SQLite database has been sanitized, created required tables, and seeded initial settings.');
}

// ----------------------------------------------------
// 📧 INTEGRATED EXCEL BACKUP SERVICE
// ----------------------------------------------------

const sendNotificationEmail = async (subject, text) => {
  try {
    const settings = await getRuntimeSettingsSnapshot();
    const targetEmail = settings.backup_email || settings.email || 'sanojhardware@gmail.com';
    const gmailUser = process.env.GMAIL_USER || 'sanojhardware@gmail.com';
    const gmailPass = process.env.GMAIL_PASS;

    if (!gmailPass) {
      console.warn(`[Notification Email Fallback] GMAIL_PASS missing in .env. Would send email to ${targetEmail} with Subject: "${subject}". Text: "${text}"`);
      return { success: false, reason: 'GMAIL_PASS missing' };
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass }
    });

    await transporter.sendMail({
      from: gmailUser,
      to: targetEmail,
      subject,
      text
    });

    console.log(`[Notification Email] Email sent successfully to ${targetEmail}`);
    return { success: true };
  } catch (err) {
    console.error('[Notification Email] Failed to send email:', err);
    return { success: false, error: err.message };
  }
};

const sendResetEmail = async (toEmail, code) => {
  try {
    const gmailUser = process.env.GMAIL_USER || 'sanojhardware@gmail.com';
    const gmailPass = process.env.GMAIL_PASS;

    if (!gmailPass) {
      console.warn(`[Reset Password Fallback] GMAIL_PASS missing in .env. Code for ${toEmail}: ${code}`);
      return { success: false, reason: 'GMAIL_PASS missing' };
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass }
    });

    await transporter.sendMail({
      from: gmailUser,
      to: toEmail,
      subject: 'Muthuwadige Hardware - Password Reset Code',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 500px; margin: 0 auto; border: 1px solid #f3f4f6; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="text-align: center; margin-bottom: 20px;">
            <h2 style="color: #DAA520; margin: 0; font-size: 22px; font-weight: 800;">Password Reset Request</h2>
            <p style="color: #6b7280; font-size: 13px; margin-top: 5px;">Muthuwadige Hardware ERP</p>
          </div>
          <p style="font-size: 14px; line-height: 1.5; color: #4b5563;">We received a request to reset the password for your staff account. Use the verification code below to complete the reset process:</p>
          <div style="background-color: #f9fafb; padding: 18px; text-align: center; font-size: 28px; font-weight: 800; letter-spacing: 6px; border-radius: 12px; margin: 25px 0; color: #464646; border: 1px solid #f3f4f6;">
            ${code}
          </div>
          <p style="font-size: 13px; line-height: 1.5; color: #6b7280; text-align: center;">This code will expire in <strong>15 minutes</strong> for security.</p>
          <p style="font-size: 13px; line-height: 1.5; color: #9ca3af; margin-top: 25px; border-top: 1px solid #f3f4f6; padding-top: 15px;">If you did not make this request, you can safely ignore this email.</p>
        </div>
      `
    });

    console.log(`[Reset Password] Email sent successfully to ${toEmail}`);
    return { success: true };
  } catch (err) {
    console.error('[Reset Password] Failed to send email:', err);
    return { success: false, error: err.message };
  }
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
  // Helper to convert date string/ISO to Excel serial decimal date number
  const getExcelDecimalDate = (dateVal) => {
    if (!dateVal || dateVal === '---') return null;
    let cleanStr = '';
    if (typeof dateVal === 'string') {
      cleanStr = dateVal.substring(0, 10);
    } else if (dateVal instanceof Date) {
      cleanStr = dateVal.toISOString().substring(0, 10);
    } else {
      cleanStr = String(dateVal).substring(0, 10);
    }
    
    // Check if it matches YYYY-MM-DD
    if (!cleanStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
      // Fallback: try to parse it with new Date
      const parsed = new Date(dateVal);
      if (isNaN(parsed.getTime())) return null;
      cleanStr = parsed.toISOString().substring(0, 10);
    }
    
    // Parse the date part as UTC to ensure consistency across timezones
    const [year, month, day] = cleanStr.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    
    // Excel date epoch is 1899-12-30 (due to leap year bug in 1900)
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const diff = date.getTime() - epoch.getTime();
    return diff / (24 * 60 * 60 * 1000);
  };

  console.log("[Backup] Starting compilation of SQLite tables to Excel...");
  let dateStr = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  if (fromDate || toDate) {
    const fromStr = fromDate || 'Start';
    const toStr = toDate || 'End';
    dateStr = `${fromStr}_to_${toStr}`;
  }
  const fileName = `Backup_${dateStr}.xlsx`;
  const backupDir = backupsDir;
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
  const filePath = path.join(backupDir, fileName);

  try {
    const customers = await db.all('SELECT * FROM customers');
    let sales = await db.all('SELECT * FROM sales');
    const products = await db.all('SELECT * FROM products');
    const profiles = await db.all('SELECT * FROM profiles');
    const settings = [await getRuntimeSettingsSnapshot()];
    const employees = await getRuntimeEmployeesSnapshot();
    let transactions = await db.all('SELECT * FROM transactions');
    const suppliers = await db.all('SELECT * FROM suppliers');
    let purchaseOrders = await db.all('SELECT * FROM purchase_orders');
    let stockAdjustments = await db.all('SELECT * FROM stock_adjustments');
    let quotations = await db.all('SELECT * FROM quotations');
    const branches = await db.all('SELECT * FROM branches');

    const isWithinDateRange = (dateVal) => {
      if (!fromDate && !toDate) return true;
      if (!dateVal || dateVal === '---') return false;
      let checkStr = '';
      if (typeof dateVal === 'string') {
        checkStr = dateVal.substring(0, 10);
      } else if (dateVal instanceof Date) {
        checkStr = dateVal.toISOString().substring(0, 10);
      } else {
        checkStr = String(dateVal).substring(0, 10);
      }
      const match = checkStr.match(/^\d{4}-\d{2}-\d{2}$/);
      if (!match) {
        try {
          const parsedDate = new Date(dateVal);
          if (!isNaN(parsedDate.getTime())) {
            checkStr = parsedDate.toISOString().substring(0, 10);
          }
        } catch (e) {}
      }
      if (fromDate && checkStr < fromDate) return false;
      if (toDate && checkStr > toDate) return false;
      return true;
    };

    if (fromDate || toDate) {
      sales = sales.filter(s => isWithinDateRange(s.created_at || s.date));
      transactions = transactions.filter(t => isWithinDateRange(t.date || t.created_at));
      purchaseOrders = purchaseOrders.filter(po => isWithinDateRange(po.created_at));
      stockAdjustments = stockAdjustments.filter(sa => isWithinDateRange(sa.created_at));
      quotations = quotations.filter(q => isWithinDateRange(q.created_at));
    }

    // 1. Calculate dashboard statistics for the beautiful Overview page
    const totalInventoryValue = products.reduce((sum, p) => sum + ((p.stock || 0) * (p.cost_price || p.price || 0)), 0);
    const totalSalesCount = sales.length;
    const totalSalesRevenue = sales.filter(s => s.status?.toLowerCase() !== 'cancelled').reduce((sum, s) => sum + (s.total_amount || 0), 0);
    const totalCustomersCount = customers.length;
    const activeEmployeesCount = employees.filter(e => e.status === 'active' || e.status === 'Active').length;
    const lowStockItemsCount = products.filter(p => {
      const minStock = p.min_stock !== undefined ? p.min_stock : 10;
      return (p.stock || 0) < minStock;
    }).length;

    // Calculate total net profit
    let totalSalesProfit = 0;
    sales.filter(s => s.status?.toLowerCase() !== 'cancelled').forEach(s => {
      try {
        const items = typeof s.items === 'string' ? JSON.parse(s.items) : s.items;
        if (Array.isArray(items)) {
          items.forEach(it => {
            const product = products.find(p => p.id === it.productId || p.id === it.product_id);
            let baseCost = product ? Number(product.cost_price || 0) : 0;
            let convRate = Number(it.conversionRate) || 1;
            if (product && (!it.conversionRate || convRate === 1) && (it.unit && it.unit.toLowerCase() !== (product.unit || '').toLowerCase())) {
              const measureDetailsStr = product.measure_details || product.measureDetails;
              if (measureDetailsStr) {
                try {
                  const parsed = typeof measureDetailsStr === 'string' ? JSON.parse(measureDetailsStr) : measureDetailsStr;
                  if (parsed && Array.isArray(parsed.conversions)) {
                    const matchedConv = parsed.conversions.find(c => (c.unit || '').toLowerCase() === it.unit.toLowerCase());
                    if (matchedConv) {
                      const rawVal = Number(matchedConv.kgVal) || 1;
                      if ((product.unit || '').toLowerCase() === 'cube' && rawVal > 0 && rawVal < 1) {
                        convRate = 1 / rawVal;
                      } else {
                        convRate = rawVal;
                      }
                    }
                  }
                } catch (e) {}
              }
            }
            const unitCost = convRate > 0 ? baseCost / convRate : baseCost;
            const price = Number(it.price || 0);
            const qty = Number(it.qty || 0);
            totalSalesProfit += qty * (price - unitCost);
          });
        }
      } catch (err) {
        console.warn("Failed to parse items for profit calculation", err);
      }
    });

    // Payment Method Breakdown
    let cashAmount = 0;
    let cardAmount = 0;
    let creditAmount = 0;
    let bankTransferAmount = 0;

    sales.filter(s => s.status?.toUpperCase() !== 'CANCELLED').forEach(s => {
      const amt = Number(s.total_amount !== undefined ? s.total_amount : (s.total || 0));
      const rawMethod = (s.payment_method || s.paymentMethod || '').toString().trim();
      const methodLower = rawMethod.toLowerCase();
      const statusStr = (s.status || '').toString();

      if (methodLower === 'card') {
        cardAmount += amt;
      } else if (methodLower === 'bank transfer' || methodLower === 'bank' || methodLower === 'banktransfer' || methodLower === 'online') {
        bankTransferAmount += amt;
      } else if (methodLower === 'credit' || statusStr === 'Non Paid' || statusStr === 'Non-Paid' || statusStr === 'pending') {
        creditAmount += amt;
      } else {
        cashAmount += amt;
      }
    });
    const paymentTotal = cashAmount + cardAmount + creditAmount + bankTransferAmount;

    // Scan all dates to find min and max date when fromDate and/or toDate are not provided
    let minDate = null;
    let maxDate = null;

    const checkDate = (d) => {
      if (!d) return;
      let checkStr = '';
      if (typeof d === 'string') {
        checkStr = d.substring(0, 10);
      } else if (d instanceof Date) {
        checkStr = d.toISOString().substring(0, 10);
      } else {
        checkStr = String(d).substring(0, 10);
      }
      if (checkStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        if (!minDate || checkStr < minDate) minDate = checkStr;
        if (!maxDate || checkStr > maxDate) maxDate = checkStr;
      }
    };

    sales.forEach(s => checkDate(s.created_at || s.date));
    transactions.forEach(t => checkDate(t.date || t.created_at));
    purchaseOrders.forEach(po => checkDate(po.created_at));

    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    const dateStartStr = currentMonthStart.toISOString().split('T')[0];
    
    const currentMonthEnd = new Date();
    currentMonthEnd.setMonth(currentMonthEnd.getMonth() + 1);
    currentMonthEnd.setDate(0);
    const dateEndStr = currentMonthEnd.toISOString().split('T')[0];

    const finalStart = fromDate || minDate || dateStartStr;
    const finalEnd = toDate || maxDate || dateEndStr;

    // Pre-calculate exact static values to write to B6:B12 so Excel shows correct figures immediately on open
    const valB6 = sales.filter(s => s.status?.toUpperCase() !== 'CANCELLED').reduce((sum, s) => sum + (s.total_amount || 0), 0);
    const valB8 = sales.filter(s => s.status?.toUpperCase() !== 'CANCELLED' && s.status?.toLowerCase() !== 'paid').reduce((sum, s) => sum + Math.max(0, (s.total_amount || 0) - (s.payment_received || 0)), 0);
    const valB7 = valB6 - valB8; // Cash Received = Total Sales - Customer Credit Outstanding
    const valB9 = purchaseOrders.filter(po => po.status?.toUpperCase() !== 'CANCELLED').reduce((sum, po) => sum + (po.total || 0), 0);
    const valB10 = transactions.filter(t => t.type?.toUpperCase() === 'EXPENSE' && t.category !== 'Purchases').reduce((sum, t) => sum + (t.amount || 0), 0);
    
    let totalCostOfSales = 0;
    sales.filter(s => s.status?.toUpperCase() !== 'CANCELLED').forEach(s => {
      try {
        const items = typeof s.items === 'string' ? JSON.parse(s.items) : s.items;
        if (Array.isArray(items)) {
          items.forEach(it => {
            const product = products.find(p => p.id === it.productId || p.id === it.product_id);
            let baseCost = product ? Number(product.cost_price || 0) : 0;
            let convRate = Number(it.conversionRate) || 1;
            if (product && (!it.conversionRate || convRate === 1) && (it.unit && it.unit.toLowerCase() !== (product.unit || '').toLowerCase())) {
              const measureDetailsStr = product.measure_details || product.measureDetails;
              if (measureDetailsStr) {
                try {
                  const parsed = typeof measureDetailsStr === 'string' ? JSON.parse(measureDetailsStr) : measureDetailsStr;
                  if (parsed && Array.isArray(parsed.conversions)) {
                    const matchedConv = parsed.conversions.find(c => (c.unit || '').toLowerCase() === it.unit.toLowerCase());
                    if (matchedConv) {
                      const rawVal = Number(matchedConv.kgVal) || 1;
                      if ((product.unit || '').toLowerCase() === 'cube' && rawVal > 0 && rawVal < 1) {
                        convRate = 1 / rawVal;
                      } else {
                        convRate = rawVal;
                      }
                    }
                  }
                } catch (e) {}
              }
            }
            const unitCost = convRate > 0 ? baseCost / convRate : baseCost;
            const qty = Number(it.qty || 1);
            totalCostOfSales += qty * unitCost;
          });
        }
      } catch (err) {}
    });
    
    const valB11 = valB6 - totalCostOfSales;
    const valB12 = products.reduce((sum, p) => sum + ((p.stock || 0) * (p.cost_price || 0)), 0);

    const overviewRows = [
      ["MUTHUWADIGE HARDWARE - BUSINESS & ACCOUNTING BACKUP REPORT", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", ""],
      ["Report Start Date", "Report End Date", "", "", "", "", "", "", ""],
      [finalStart, finalEnd, "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", ""],
      ["KEY BUSINESS METRICS (ERP SUMMARY)", "", "", "", "", "", "", "", ""],
      ["Total Sales Revenue", "", "", "", "", "", "", "", ""],
      ["Cash Received", "", "", "", "", "", "", "", ""],
      ["Customer Credit Outstanding", "", "", "", "", "", "", "", ""],
      ["Total Purchases", "", "", "", "", "", "", "", ""],
      ["Net Profit", "", "", "", "", "", "", "", ""],
      ["Total Stock Value", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", ""],
      ["PAYMENT METHOD BREAKDOWN", "", "", "", "", "", "", "", ""],
      ["Cash Amount", "", "", "", "", "", "", "", ""],
      ["Card Amount", "", "", "", "", "", "", "", ""],
      ["Credit Amount", "", "", "", "", "", "", "", ""],
      ["Bank Transfer Amount", "", "", "", "", "", "", "", ""],
      ["Total Payment Methods", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", ""],
      ["REMARKS & USEFUL NOTES", "", "", "", "", "", "", "", ""],
      ["• Sales sheet contains daily invoices, customer payments, and payment methods.", "", "", "", "", "", "", "", ""],
      ["• Inventory Stock sheet provides real-time stock quantities and market valuations.", "", "", "", "", "", "", "", ""],
      ["• Accounting Ledger contains all business expense and income transaction records.", "", "", "", "", "", "", "", ""],
      ["• Report figures are generated directly from Muthuwadige Hardware ERP.", "", "", "", "", "", "", "", ""]
    ];

    const wsOverview = XLSX.utils.aoa_to_sheet(overviewRows);
    wsOverview['!cols'] = [
      { wch: 34 }, { wch: 24 }, { wch: 5 }, 
      { wch: 15 }, { wch: 15 }, { wch: 15 }, 
      { wch: 15 }, { wch: 15 }, { wch: 15 }
    ];

    wsOverview['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 8 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 8 } },
      { s: { r: 13, c: 0 }, e: { r: 13, c: 8 } },
      { s: { r: 20, c: 0 }, e: { r: 20, c: 8 } },
      { s: { r: 21, c: 0 }, e: { r: 21, c: 8 } },
      { s: { r: 22, c: 0 }, e: { r: 22, c: 8 } },
      { s: { r: 23, c: 0 }, e: { r: 23, c: 8 } },
      { s: { r: 24, c: 0 }, e: { r: 24, c: 8 } }
    ];

    wsOverview['A4'] = { t: 'n', v: getExcelDecimalDate(finalStart), z: 'yyyy-mm-dd' };
    wsOverview['B4'] = { t: 'n', v: getExcelDecimalDate(finalEnd), z: 'yyyy-mm-dd' };

    wsOverview['B7'] = { t: 'n', v: valB6, f: "SUMIFS('Sales & Invoices'!G:G, 'Sales & Invoices'!L:L, \">=\"&A4, 'Sales & Invoices'!L:L, \"<=\"&B4, 'Sales & Invoices'!J:J, \"<>CANCELLED\")", z: '#,##0.00' };
    wsOverview['B8'] = { t: 'n', v: valB7, f: "B7-B9", z: '#,##0.00' };
    wsOverview['B9'] = { t: 'n', v: valB8, f: "SUMIFS('Sales & Invoices'!I:I, 'Sales & Invoices'!L:L, \">=\"&A4, 'Sales & Invoices'!L:L, \"<=\"&B4, 'Sales & Invoices'!J:J, \"<>CANCELLED\")", z: '#,##0.00' };
    wsOverview['B10'] = { t: 'n', v: valB9, f: "SUMIFS('Purchase Orders'!D:D, 'Purchase Orders'!G:G, \">=\"&A4, 'Purchase Orders'!G:G, \"<=\"&B4, 'Purchase Orders'!E:E, \"<>CANCELLED\")", z: '#,##0.00' };
    wsOverview['B11'] = { t: 'n', v: valB11, f: "B7-SUMIFS('Sales & Invoices'!O:O, 'Sales & Invoices'!L:L, \">=\"&A4, 'Sales & Invoices'!L:L, \"<=\"&B4, 'Sales & Invoices'!J:J, \"<>CANCELLED\")", z: '#,##0.00' };
    wsOverview['B12'] = { t: 'n', v: valB12, f: "SUM('Inventory Stock'!I:I)", z: '#,##0.00' };

    wsOverview['B15'] = { t: 'n', v: cashAmount, z: '#,##0.00' };
    wsOverview['B16'] = { t: 'n', v: cardAmount, z: '#,##0.00' };
    wsOverview['B17'] = { t: 'n', v: creditAmount, z: '#,##0.00' };
    wsOverview['B18'] = { t: 'n', v: bankTransferAmount, z: '#,##0.00' };
    wsOverview['B19'] = { t: 'n', v: paymentTotal, f: "SUM(B15:B18)", z: '#,##0.00' };

    const setColWidths = (ws, structuredData, headers) => {
      if (!structuredData || structuredData.length === 0) {
        if (headers) {
          ws['!cols'] = headers.map(h => ({ wch: Math.max(h.toString().length + 6, 16) }));
        }
        return;
      }
      const keys = Object.keys(structuredData[0]);
      ws['!cols'] = keys.map(key => {
        let maxLen = key.toString().length;
        structuredData.forEach(row => {
          const val = row[key];
          if (val !== null && val !== undefined) {
            const valLen = val.toString().length;
            if (valLen > maxLen) maxLen = valLen;
          }
        });
        return { wch: Math.min(Math.max(maxLen + 6, 16), 55) };
      });
    };

    const createWorksheet = (structuredData, headers) => {
      if (!structuredData || structuredData.length === 0) {
        return XLSX.utils.aoa_to_sheet([headers]);
      }
      return XLSX.utils.json_to_sheet(structuredData);
    };

    const applyTableStyles = (ws, themeColor = "1E3A8A") => {
      const ref = ws['!ref'];
      if (!ref) return;
      const range = XLSX.utils.decode_range(ref);
      const headerRow = range.s.r;
      ws['!rows'] = ws['!rows'] || [];
      ws['!rows'][headerRow] = { hpt: 28 };
      const dateColIndices = [];
      const amountColIndices = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: headerRow, c: col });
        const cell = ws[cellRef];
        if (cell && cell.v) {
          const label = String(cell.v).toLowerCase();
          if (label.includes('date') || label.includes('time') || label.includes('timestamp')) {
            dateColIndices.push(col);
          }
          if (label.includes('(rs.)') || label.includes('price') || label.includes('cost') || label.includes('subtotal') || label.includes('discount') || label.includes('tax amount') || label.includes('total amount') || label.includes('balance') || label.includes('value') || label.includes('salary')) {
            amountColIndices.push(col);
          }
        }
      }
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: range.s.r, c: col });
        const cell = ws[cellRef];
        if (cell) {
          cell.s = {
            font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 11 },
            fill: { fgColor: { rgb: themeColor } }, 
            alignment: { vertical: "center", horizontal: "center", wrapText: true },
            border: {
              bottom: { style: "medium", color: { rgb: "0F172A" } },
              top: { style: "thin", color: { rgb: "94A3B8" } },
              left: { style: "thin", color: { rgb: "94A3B8" } },
              right: { style: "thin", color: { rgb: "94A3B8" } }
            }
          };
        }
      }
      for (let row = range.s.r + 1; row <= range.e.r; row++) {
        ws['!rows'][row] = { hpt: 22 };
        const firstCellRef = XLSX.utils.encode_cell({ r: row, c: range.s.c });
        const firstCell = ws[firstCellRef];
        const isTotalRow = firstCell && String(firstCell.v).toUpperCase().includes("TOTAL");
        const isEven = (row % 2 === 0);
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
          const cell = ws[cellRef];
          if (cell) {
            let alignment = "left";
            if (typeof cell.v === 'number') {
              alignment = "right";
            }
            if (dateColIndices.includes(col) && typeof cell.v === 'number') {
              cell.z = 'yyyy-mm-dd';
              alignment = "center";
            }
            if (amountColIndices.includes(col) && typeof cell.v === 'number') {
              cell.z = '#,##0.00';
              alignment = "right";
            }
            if (isTotalRow) {
              cell.s = {
                font: { bold: true, name: "Segoe UI", sz: 11, color: { rgb: "0F172A" } },
                fill: { fgColor: { rgb: "E0F2FE" } },
                alignment: { vertical: "center", horizontal: alignment },
                border: {
                  top: { style: "thin", color: { rgb: "0284C7" } },
                  bottom: { style: "double", color: { rgb: "0369A1" } },
                  left: { style: "thin", color: { rgb: "BAE6FD" } },
                  right: { style: "thin", color: { rgb: "BAE6FD" } }
                }
              };
            } else {
              const bgColor = isEven ? "F8FAFC" : "FFFFFF";
              cell.s = {
                font: { name: "Segoe UI", sz: 11, color: { rgb: "1E293B" } },
                fill: { fgColor: { rgb: bgColor } },
                alignment: { vertical: "center", horizontal: alignment },
                border: {
                  bottom: { style: "thin", color: { rgb: "E2E8F0" } },
                  top: { style: "thin", color: { rgb: "E2E8F0" } },
                  left: { style: "thin", color: { rgb: "E2E8F0" } },
                  right: { style: "thin", color: { rgb: "E2E8F0" } }
                }
              };
            }
          }
        }
      }
    };

    const styleOverviewSheet = (ws) => {
      const ref = ws['!ref'];
      if (!ref) return;
      const range = XLSX.utils.decode_range(ref);
      ws['!rows'] = ws['!rows'] || [];
      ws['!rows'][0] = { hpt: 36 };
      ws['!rows'][1] = { hpt: 36 };
      for (let row = range.s.r; row <= range.e.r; row++) {
        if (row >= 2) ws['!rows'][row] = { hpt: 24 };
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
          const cell = ws[cellRef];
          if (!cell) continue;
          cell.s = {
            font: { name: "Segoe UI", sz: 11, color: { rgb: "1E293B" } }
          };
          if (row === 0 || row === 1) {
            cell.s = {
              font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 18 },
              fill: { fgColor: { rgb: "1E1B4B" } },
              alignment: { vertical: "center", horizontal: "center" }
            };
          }
          else if (row === 2 && (col === 0 || col === 1)) {
            cell.s = {
              font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 11 },
              fill: { fgColor: { rgb: "312E81" } },
              alignment: { vertical: "center", horizontal: "center" }
            };
          }
          else if (row === 3 && (col === 0 || col === 1)) {
            cell.s = {
              font: { name: "Segoe UI", sz: 11, bold: true, color: { rgb: "1E1B4B" } },
              fill: { fgColor: { rgb: "F3E8FF" } },
              alignment: { vertical: "center", horizontal: "center" },
              border: {
                bottom: { style: "thin", color: { rgb: "C084FC" } },
                top: { style: "thin", color: { rgb: "C084FC" } },
                left: { style: "thin", color: { rgb: "C084FC" } },
                right: { style: "thin", color: { rgb: "C084FC" } }
              }
            };
          }
          else if ((row === 5 || row === 13) && col >= 0 && col <= 8) {
            cell.s = {
              font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 12 },
              fill: { fgColor: { rgb: "312E81" } },
              alignment: { vertical: "center", horizontal: "left" }
            };
          }
          else if (((row >= 6 && row <= 11) || (row >= 14 && row <= 17)) && (col === 0 || col === 1)) {
            const isLeftColumn = (col === 0);
            if (isLeftColumn) {
              cell.s = {
                font: { bold: true, color: { rgb: "1E1B4B" }, name: "Segoe UI", sz: 11 },
                fill: { fgColor: { rgb: "F5F3FF" } },
                alignment: { vertical: "center", horizontal: "left" },
                border: {
                  bottom: { style: "thin", color: { rgb: "DDD6FE" } },
                  top: { style: "thin", color: { rgb: "DDD6FE" } },
                  left: { style: "thin", color: { rgb: "DDD6FE" } },
                  right: { style: "thin", color: { rgb: "DDD6FE" } }
                }
              };
            } else {
              cell.s = {
                font: { bold: true, name: "Segoe UI", sz: 11, color: { rgb: "0F172A" } },
                fill: { fgColor: { rgb: "FFFFFF" } },
                alignment: { vertical: "center", horizontal: "right" },
                border: {
                  bottom: { style: "thin", color: { rgb: "E2E8F0" } },
                  top: { style: "thin", color: { rgb: "E2E8F0" } },
                  left: { style: "thin", color: { rgb: "E2E8F0" } },
                  right: { style: "thin", color: { rgb: "E2E8F0" } }
                }
              };
            }
          }
          else if (row === 18 && (col === 0 || col === 1)) {
            const isLeftColumn = (col === 0);
            cell.s = {
              font: { bold: true, color: { rgb: "0369A1" }, name: "Segoe UI", sz: 12 },
              fill: { fgColor: { rgb: "E0F2FE" } },
              alignment: { vertical: "center", horizontal: isLeftColumn ? "left" : "right" },
              border: {
                top: { style: "thin", color: { rgb: "0284C7" } },
                bottom: { style: "double", color: { rgb: "0369A1" } },
                left: { style: "thin", color: { rgb: "BAE6FD" } },
                right: { style: "thin", color: { rgb: "BAE6FD" } }
              }
            };
          }
          else if (row === 20 && col >= 0 && col <= 8) {
            cell.s = {
              font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 12 },
              fill: { fgColor: { rgb: "312E81" } },
              alignment: { vertical: "center", horizontal: "left" }
            };
          }
          else if (row >= 21 && row <= 24 && col >= 0 && col <= 8) {
            cell.s = {
              font: { name: "Segoe UI", sz: 10, italic: true, color: { rgb: "475569" } },
              alignment: { vertical: "center", horizontal: "left" }
            };
          }
        }
      }
    };

    const structuredInventory = products.map(p => ({
      "Item Name": p.name,
      "Category": p.category || 'Other',
      "Base Retail Price (Rs.)": p.price || 0,
      "Base Cost Price (Rs.)": p.cost_price || 0,
      "Current Stock Level": p.stock || 0,
      "Measurement Unit": p.unit || 'pcs',
      "Brand": p.brand || '',
      "Supplier Entity": p.supplier || '',
      "Total Cost Value (Rs.)": (p.stock || 0) * (p.cost_price || 0),
      "Total Market Value (Rs.)": (p.stock || 0) * (p.price || 0)
    }));
    if (structuredInventory.length > 0) {
      const costValSum = products.reduce((sum, p) => sum + ((p.stock || 0) * (p.cost_price || 0)), 0);
      const marketValSum = products.reduce((sum, p) => sum + ((p.stock || 0) * (p.price || 0)), 0);
      structuredInventory.push({
        "Item Name": "TOTAL",
        "Category": "",
        "Base Retail Price (Rs.)": null,
        "Base Cost Price (Rs.)": null,
        "Current Stock Level": null,
        "Measurement Unit": "",
        "Brand": "",
        "Supplier Entity": "",
        "Total Cost Value (Rs.)": costValSum,
        "Total Market Value (Rs.)": marketValSum
      });
    }
    const wsInventoryHeaders = [
      "Item Name", "Category", "Base Retail Price (Rs.)", "Base Cost Price (Rs.)", 
      "Current Stock Level", "Measurement Unit", "Brand", "Supplier Entity", 
      "Total Cost Value (Rs.)", "Total Market Value (Rs.)"
    ];
    const wsInventory = createWorksheet(structuredInventory, wsInventoryHeaders);
    setColWidths(wsInventory, structuredInventory, wsInventoryHeaders);
    applyTableStyles(wsInventory, "1E3A8A");

    const structuredSales = sales.map(s => {
      let itemsList = '---';
      try {
        const items = typeof s.items === 'string' ? JSON.parse(s.items) : s.items;
        if (Array.isArray(items)) {
          itemsList = items.map(it => `${it.productName || it.name || 'Item'} (x${it.qty || 1})`).join(', ');
        }
      } catch (e) {}

      return {
        "Invoice Number": s.invoice_no,
        "Customer Name": s.customer_name || 'Guest Customer',
        "Products Sold": itemsList,
        "Subtotal (Rs.)": s.subtotal || 0,
        "Discount (Rs.)": s.discount || 0,
        "Tax Amount (Rs.)": s.tax || 0,
        "Total Amount (Rs.)": s.total_amount || 0,
        "Payment Received (Rs.)": s.status?.toLowerCase() === 'paid' ? (s.total_amount || 0) : (s.payment_received || 0),
        "Outstanding Balance (Rs.)": s.status?.toLowerCase() === 'paid' ? 0 : Math.max(0, (s.total_amount || 0) - (s.payment_received || 0)),
        "Payment Status": s.status ? s.status.toUpperCase() : 'PAID',
        "Payment Method": s.payment_method || 'Cash',
        "Checkout Date & Time": getExcelDecimalDate(s.created_at) || '---',
        "Due Date": getExcelDecimalDate(s.due_date) || '---',
        "Credit Period (Days)": s.credit_period_days || 0,
        "Cost of Goods Sold (Rs.)": (() => {
          let totalCostOfSale = 0;
          try {
            const items = typeof s.items === 'string' ? JSON.parse(s.items) : s.items;
            if (Array.isArray(items)) {
              items.forEach(it => {
                const product = products.find(p => p.id === it.productId || p.id === it.product_id);
                let baseCost = product ? Number(product.cost_price || 0) : 0;
                let convRate = Number(it.conversionRate) || 1;
                if (product && (!it.conversionRate || convRate === 1) && (it.unit && it.unit.toLowerCase() !== (product.unit || '').toLowerCase())) {
                  const measureDetailsStr = product.measure_details || product.measureDetails;
                  if (measureDetailsStr) {
                    try {
                      const parsed = typeof measureDetailsStr === 'string' ? JSON.parse(measureDetailsStr) : measureDetailsStr;
                      if (parsed && Array.isArray(parsed.conversions)) {
                        const matchedConv = parsed.conversions.find(c => (c.unit || '').toLowerCase() === it.unit.toLowerCase());
                        if (matchedConv) {
                          const rawVal = Number(matchedConv.kgVal) || 1;
                          if ((product.unit || '').toLowerCase() === 'cube' && rawVal > 0 && rawVal < 1) {
                            convRate = 1 / rawVal;
                          } else {
                            convRate = rawVal;
                          }
                        }
                      }
                    } catch (e) {}
                  }
                }
                const unitCost = convRate > 0 ? baseCost / convRate : baseCost;
                const qty = Number(it.qty || 1);
                totalCostOfSale += qty * unitCost;
              });
            }
          } catch (e) {}
          return totalCostOfSale;
        })()
      };
    });

    if (structuredSales.length > 0) {
      const subtotalSum = sales.reduce((sum, s) => sum + (s.subtotal || 0), 0);
      const discountSum = sales.reduce((sum, s) => sum + (s.discount || 0), 0);
      const taxSum = sales.reduce((sum, s) => sum + (s.tax || 0), 0);
      const totalSum = sales.reduce((sum, s) => sum + (s.total_amount || 0), 0);
      const receivedSum = sales.reduce((sum, s) => sum + (s.status?.toLowerCase() === 'paid' ? (s.total_amount || 0) : (s.payment_received || 0)), 0);
      const balanceSum = sales.reduce((sum, s) => sum + (s.status?.toLowerCase() === 'paid' ? 0 : Math.max(0, (s.total_amount || 0) - (s.payment_received || 0))), 0);
      
      structuredSales.push({
        "Invoice Number": "TOTAL",
        "Customer Name": "",
        "Products Sold": "",
        "Subtotal (Rs.)": subtotalSum,
        "Discount (Rs.)": discountSum,
        "Tax Amount (Rs.)": taxSum,
        "Total Amount (Rs.)": totalSum,
        "Payment Received (Rs.)": receivedSum,
        "Outstanding Balance (Rs.)": balanceSum,
        "Payment Status": "",
        "Payment Method": "",
        "Checkout Date & Time": "",
        "Due Date": "",
        "Credit Period (Days)": "",
        "Cost of Goods Sold (Rs.)": totalCostOfSales
      });
    }

    const wsSalesHeaders = [
      "Invoice Number", "Customer Name", "Products Sold", "Subtotal (Rs.)", 
      "Discount (Rs.)", "Tax Amount (Rs.)", "Total Amount (Rs.)", 
      "Payment Received (Rs.)", "Outstanding Balance (Rs.)", "Payment Status", 
      "Payment Method", "Checkout Date & Time", "Due Date", 
      "Credit Period (Days)", "Cost of Goods Sold (Rs.)"
    ];
    const wsSales = createWorksheet(structuredSales, wsSalesHeaders);
    setColWidths(wsSales, structuredSales, wsSalesHeaders);
    applyTableStyles(wsSales, "1E3A8A");

    const structuredTransactions = transactions.map(t => ({
      "Record Date": getExcelDecimalDate(t.date) || '---',
      "Flow Type": t.type ? t.type.toUpperCase() : 'INCOME',
      "Finance Category": t.category || 'Other',
      "Description Details": t.description,
      "Reference Invoice / PO": t.reference || '---',
      "Transaction Value (Rs.)": t.amount || 0,
      "System Log Date": getExcelDecimalDate(t.created_at) || '---'
    }));
    if (structuredTransactions.length > 0) {
      const transSum = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
      structuredTransactions.push({
        "Record Date": "TOTAL",
        "Flow Type": "",
        "Finance Category": "",
        "Description Details": "",
        "Reference Invoice / PO": "",
        "Transaction Value (Rs.)": transSum,
        "System Log Date": ""
      });
    }
    const wsTransactionsHeaders = [
      "Record Date", "Flow Type", "Finance Category", "Description Details", 
      "Reference Invoice / PO", "Transaction Value (Rs.)", "System Log Date"
    ];
    const wsTransactions = createWorksheet(structuredTransactions, wsTransactionsHeaders);
    setColWidths(wsTransactions, structuredTransactions, wsTransactionsHeaders);
    applyTableStyles(wsTransactions, "1E3A8A");

    const structuredCustomers = customers.map(c => ({
      "Customer Name": c.name,
      "Email": c.email || '',
      "Phone Number": c.phone || '—',
      "Address": c.address || '—',
      "NIC Number": c.nic || '—',
      "Loyalty Points": c.loyalty_points || 0,
      "Total Purchases (Rs.)": c.total_purchases || 0,
      "Registered Date": getExcelDecimalDate(c.created_at) || '---'
    }));
    const wsCustomersHeaders = [
      "Customer Name", "Email", "Phone Number", "Address", 
      "NIC Number", "Loyalty Points", "Total Purchases (Rs.)", "Registered Date"
    ];
    const wsCustomers = createWorksheet(structuredCustomers, wsCustomersHeaders);
    setColWidths(wsCustomers, structuredCustomers, wsCustomersHeaders);
    applyTableStyles(wsCustomers, "1E3A8A");

    const structuredEmployees = employees.map(e => ({
      "Full Name": e.name,
      "Designated Role": e.role,
      "Department": e.department,
      "Email Address": e.email,
      "Phone Number": e.phone,
      "Salary (Rs.)": e.salary || 0,
      "Active Status": e.status ? e.status.toUpperCase() : 'ACTIVE',
      "Attendance Percentage (%)": `${e.attendance || 100}%`,
      "Date of Joining": getExcelDecimalDate(e.join_date) || '---'
    }));
    const wsEmployeesHeaders = [
      "Full Name", "Designated Role", "Department", "Email Address", 
      "Phone Number", "Salary (Rs.)", "Active Status", 
      "Attendance Percentage (%)", "Date of Joining"
    ];
    const wsEmployees = createWorksheet(structuredEmployees, wsEmployeesHeaders);
    setColWidths(wsEmployees, structuredEmployees, wsEmployeesHeaders);
    applyTableStyles(wsEmployees, "1E3A8A");

    const structuredProfiles = profiles.map(pr => ({
      "User Full Name": pr.name,
      "User Email": pr.email,
      "Access Privilege Level": pr.role ? pr.role.toUpperCase() : 'CASHIER',
      "Created Date": getExcelDecimalDate(pr.created_at) || '---'
    }));
    const wsProfilesHeaders = [
      "User Full Name", "User Email", "Access Privilege Level", "Created Date"
    ];
    const wsProfiles = createWorksheet(structuredProfiles, wsProfilesHeaders);
    setColWidths(wsProfiles, structuredProfiles, wsProfilesHeaders);
    applyTableStyles(wsProfiles, "1E3A8A");

    const structuredSettings = settings.map(set => ({
      "Shop Name": set.shop_name,
      "Address": set.address,
      "Phone": set.phone,
      "Email": set.email,
      "Currency": set.currency,
      "Tax Rate (%)": set.tax_rate,
      "Backup Email": set.backup_email,
      "Weekly Auto-Backup": set.backup_enabled ? "ENABLED" : "DISABLED",
      "Last Synced Time": getExcelDecimalDate(set.updated_at) || '---'
    }));
    const wsSettingsHeaders = [
      "Shop Name", "Address", "Phone", "Email", "Currency", "Tax Rate (%)", 
      "Backup Email", "Weekly Auto-Backup", "Last Synced Time"
    ];
    const wsSettings = createWorksheet(structuredSettings, wsSettingsHeaders);
    setColWidths(wsSettings, structuredSettings, wsSettingsHeaders);
    applyTableStyles(wsSettings, "1E3A8A");

    const structuredSuppliers = suppliers.map(s => ({
      "Supplier Name": s.name,
      "Email Address": s.email || '---',
      "Phone Number": s.phone || '---',
      "Address": s.address || '---',
      "Credit Terms": s.credit_terms || '---',
      "Payable Balance (Rs.)": s.payable_balance || 0,
      "Registered Date": getExcelDecimalDate(s.created_at) || '---'
    }));
    const wsSuppliersHeaders = [
      "Supplier Name", "Email Address", "Phone Number", "Address", 
      "Credit Terms", "Payable Balance (Rs.)", "Registered Date"
    ];
    const wsSuppliers = createWorksheet(structuredSuppliers, wsSuppliersHeaders);
    setColWidths(wsSuppliers, structuredSuppliers, wsSuppliersHeaders);
    applyTableStyles(wsSuppliers, "1E3A8A");

    const structuredPO = purchaseOrders.map(po => {
      let poItems = '---';
      try {
        const parsed = typeof po.items === 'string' ? JSON.parse(po.items) : po.items;
        if (Array.isArray(parsed)) {
          poItems = parsed.map(it => `${it.name || it.productName || 'Item'} (x${it.qty || 1})`).join(', ');
        }
      } catch(e) {}
      return {
        "PO Number": po.po_no,
        "Supplier Name": po.supplier_name,
        "PO Items": poItems,
        "Total Amount (Rs.)": po.total || 0,
        "PO Status": po.status ? po.status.toUpperCase() : 'PENDING',
        "Due Date": getExcelDecimalDate(po.due_date) || '---',
        "Created Date": getExcelDecimalDate(po.created_at) || '---'
      };
    });
    if (structuredPO.length > 0) {
      const poSum = purchaseOrders.reduce((sum, po) => sum + (po.total || 0), 0);
      structuredPO.push({
        "PO Number": "TOTAL",
        "Supplier Name": "",
        "PO Items": "",
        "Total Amount (Rs.)": poSum,
        "PO Status": "",
        "Due Date": "",
        "Created Date": ""
      });
    }
    const wsPOHeaders = [
      "PO Number", "Supplier Name", "PO Items", "Total Amount (Rs.)", 
      "PO Status", "Due Date", "Created Date"
    ];
    const wsPO = createWorksheet(structuredPO, wsPOHeaders);
    setColWidths(wsPO, structuredPO, wsPOHeaders);
    applyTableStyles(wsPO, "1E3A8A");

    const structuredAdjustments = stockAdjustments.map(sa => ({
      "Product Name": sa.product_name,
      "Old Quantity": sa.old_qty || 0,
      "New Quantity": sa.new_qty || 0,
      "Adjustment Type": sa.type || 'Adjustment',
      "Reason Details": sa.reason || '---',
      "Staff Email": sa.user_email || '---',
      "Timestamp": getExcelDecimalDate(sa.created_at) || '---'
    }));
    const wsAdjustmentsHeaders = [
      "Product Name", "Old Quantity", "New Quantity", "Adjustment Type", 
      "Reason Details", "Staff Email", "Timestamp"
    ];
    const wsAdjustments = createWorksheet(structuredAdjustments, wsAdjustmentsHeaders);
    setColWidths(wsAdjustments, structuredAdjustments, wsAdjustmentsHeaders);
    applyTableStyles(wsAdjustments, "1E3A8A");

    const structuredQuotes = quotations.map(q => ({
      "Quotation Number": q.quote_no,
      "Customer Name": q.customer_name,
      "Total Amount (Rs.)": q.total || 0,
      "Created Date": getExcelDecimalDate(q.created_at) || '---'
    }));
    const wsQuotesHeaders = [
      "Quotation Number", "Customer Name", "Total Amount (Rs.)", "Created Date"
    ];
    const wsQuotes = createWorksheet(structuredQuotes, wsQuotesHeaders);
    setColWidths(wsQuotes, structuredQuotes, wsQuotesHeaders);
    applyTableStyles(wsQuotes, "1E3A8A");

    const structuredBranches = branches.map(b => ({
      "Branch Name": b.name,
      "Branch Code": b.code,
      "Address": b.address || '---',
      "Phone Number": b.phone || '---',
      "Created Date": getExcelDecimalDate(b.created_at) || '---'
    }));
    const wsBranchesHeaders = [
      "Branch Name", "Branch Code", "Address", "Phone Number", "Created Date"
    ];
    const wsBranches = createWorksheet(structuredBranches, wsBranchesHeaders);
    setColWidths(wsBranches, structuredBranches, wsBranchesHeaders);
    applyTableStyles(wsBranches, "1E3A8A");

    styleOverviewSheet(wsOverview);

    // --- CREDIT CUSTOMERS SHEET ---
    const salesReturnsList = await db.all('SELECT * FROM sales_returns ORDER BY created_at DESC');
    const creditPaymentsList = await db.all('SELECT * FROM credit_payments ORDER BY payment_date DESC');

    let creditSalesList = sales.filter(s => {
      const isCredit = s.status === 'Non Paid' || s.status === 'Partially Paid' || s.status === 'Partially Settled' || s.status === 'Pending' || (s.payment_method && s.payment_method.toLowerCase() === 'credit');
      const rem = Math.max(0, (s.total_amount || 0) - (s.payment_received || 0));
      return isCredit && rem > 0;
    });

    const totOutstandingAll = creditSalesList.reduce((sum, s) => sum + Math.max(0, (s.total_amount || 0) - (s.payment_received || 0)), 0);
    const totOverdueAll = creditSalesList.filter(s => s.due_date && new Date(s.due_date) < new Date()).reduce((sum, s) => sum + Math.max(0, (s.total_amount || 0) - (s.payment_received || 0)), 0);

    const structuredCreditCustomers = creditSalesList.map(s => {
      const totalAmt = Number(s.total_amount || 0);
      const paidAmt = Number(s.payment_received || 0);
      const outstandingAmt = Math.max(0, totalAmt - paidAmt);
      const isOverdue = s.due_date && new Date(s.due_date) < new Date();
      return {
        "Customer": s.customer_name || 'Walk-in Credit Customer',
        "Invoice Number": s.invoice_no,
        "Invoice Date": s.created_at ? s.created_at.slice(0, 10) : (s.date || '---'),
        "Invoice Amount": totalAmt,
        "Amount Paid": paidAmt,
        "Outstanding Amount": outstandingAmt,
        "Due Date": s.due_date ? s.due_date.slice(0, 10) : '---',
        "Payment Status": outstandingAmt <= 0 ? "Fully Settled" : "Partially Settled",
        "Payment History": paidAmt > 0 ? `Paid Rs. ${paidAmt.toLocaleString()}` : "No payments recorded",
        "Total Outstanding": totOutstandingAll,
        "Total Overdue": totOverdueAll
      };
    });
    const wsCCHeaders = ["Customer", "Invoice Number", "Invoice Date", "Invoice Amount", "Amount Paid", "Outstanding Amount", "Due Date", "Payment Status", "Payment History", "Total Outstanding", "Total Overdue"];
    const wsCreditCustomers = createWorksheet(structuredCreditCustomers, wsCCHeaders);
    setColWidths(wsCreditCustomers, structuredCreditCustomers, wsCCHeaders);
    applyTableStyles(wsCreditCustomers, "B8860B");

    // --- CUSTOMER STATEMENT SHEET ---
    const statementEntries = [];
    sales.forEach(s => {
      statementEntries.push({
        "Customer": s.customer_name || 'Walk-in Customer',
        "Transaction Date": s.created_at ? s.created_at.slice(0, 10) : (s.date || '---'),
        "Invoice / Reference #": s.invoice_no,
        "Transaction Type": "Credit Sale",
        "Credit Sales": Number(s.total_amount || 0),
        "Payments": Number(s.payment_received || 0),
        "Returns / Credit Notes": 0,
        "Remaining Balance": Math.max(0, Number(s.total_amount || 0) - Number(s.payment_received || 0))
      });
    });

    salesReturnsList.forEach(sr => {
      statementEntries.push({
        "Customer": sr.customer_name || 'Walk-in Customer',
        "Transaction Date": sr.created_at ? sr.created_at.slice(0, 10) : '---',
        "Invoice / Reference #": sr.return_no || sr.invoice_no,
        "Transaction Type": `Sales Return (${sr.return_method || 'Refund'})`,
        "Credit Sales": 0,
        "Payments": 0,
        "Returns / Credit Notes": Number(sr.return_amount || 0),
        "Remaining Balance": 0
      });
    });

    const wsCSHeaders = ["Customer", "Transaction Date", "Invoice / Reference #", "Transaction Type", "Credit Sales", "Payments", "Returns / Credit Notes", "Remaining Balance"];
    // const wsCustomerStatement = createWorksheet(statementEntries, wsCSHeaders);
    // setColWidths(wsCustomerStatement, statementEntries, wsCSHeaders);
    // applyTableStyles(wsCustomerStatement, "1E3A8A");

    // --- SALES RETURNS SHEET ---
    const structuredSalesReturns = salesReturnsList.map(sr => {
      let returnedProd = '---';
      let returnedQty = 0;
      try {
        const items = typeof sr.returned_items === 'string' ? JSON.parse(sr.returned_items) : sr.returned_items;
        if (Array.isArray(items) && items.length > 0) {
          returnedProd = items.map(i => i.productName || i.name).join(', ');
          returnedQty = items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
        }
      } catch (e) {}

      let exchangeProd = 'N/A';
      let exchangeAmt = Number(sr.exchange_amount || 0);
      try {
        const xItems = typeof sr.exchange_items === 'string' ? JSON.parse(sr.exchange_items) : sr.exchange_items;
        if (Array.isArray(xItems) && xItems.length > 0) {
          exchangeProd = xItems.map(i => i.productName || i.name).join(', ');
        }
      } catch (e) {}

      return {
        "Return ID": sr.return_no || sr.id,
        "Original Invoice Number": sr.invoice_no,
        "Return Date": sr.created_at ? sr.created_at.slice(0, 10) : '---',
        "Customer": sr.customer_name || 'Walk-in Customer',
        "Return Type": sr.return_method || 'Cash Refund',
        "Product": returnedProd,
        "Quantity": returnedQty,
        "Return Amount": Number(sr.return_amount || 0),
        "Payment/Refund Amount": Number(sr.total_refunded || sr.customer_paid || 0),
        "Payment Method": sr.return_method === 'Exchange' ? 'Exchange Balance' : (sr.return_method || 'Cash'),
        "Replacement Product (for Exchange)": exchangeProd,
        "Replacement Amount": exchangeAmt,
        "Difference": Number(sr.balance_amount || 0),
        "Credit Note Number (for Credit Note)": sr.credit_note_no || 'N/A',
        "Notes": sr.reason || '---'
      };
    });
    const wsSRHeaders = ["Return ID", "Original Invoice Number", "Return Date", "Customer", "Return Type", "Product", "Quantity", "Return Amount", "Payment/Refund Amount", "Payment Method", "Replacement Product (for Exchange)", "Replacement Amount", "Difference", "Credit Note Number (for Credit Note)", "Notes"];
    const wsSalesReturns = createWorksheet(structuredSalesReturns, wsSRHeaders);
    setColWidths(wsSalesReturns, structuredSalesReturns, wsSRHeaders);
    applyTableStyles(wsSalesReturns, "991B1B");

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsOverview, "Dashboard");
    XLSX.utils.book_append_sheet(wb, wsInventory, "Inventory Stock");
    XLSX.utils.book_append_sheet(wb, wsSales, "Sales & Invoices");
    XLSX.utils.book_append_sheet(wb, wsCreditCustomers, "Credit Customers");
    // // XLSX.utils.book_append_sheet(wb, wsCustomerStatement, "Customer Statement"); // Removed per user request // Removed per user request
    XLSX.utils.book_append_sheet(wb, wsSalesReturns, "Sales Returns");
    XLSX.utils.book_append_sheet(wb, wsTransactions, "Accounting Ledger");
    XLSX.utils.book_append_sheet(wb, wsCustomers, "Customers");
    XLSX.utils.book_append_sheet(wb, wsSuppliers, "Suppliers Directory");
    XLSX.utils.book_append_sheet(wb, wsPO, "Purchase Orders");
    XLSX.utils.book_append_sheet(wb, wsAdjustments, "Stock Adjustments");
    XLSX.utils.book_append_sheet(wb, wsQuotes, "Quotations");
    XLSX.utils.book_append_sheet(wb, wsEmployees, "Employees");
    XLSX.utils.book_append_sheet(wb, wsProfiles, "User Profiles");
    XLSX.utils.book_append_sheet(wb, wsSettings, "System Settings");
    XLSX.utils.book_append_sheet(wb, wsBranches, "Branches");

    XLSX.writeFile(wb, filePath);

    const gmailUser = process.env.GMAIL_USER || 'sanojhardware@gmail.com';
    const gmailPass = process.env.GMAIL_PASS;

    if (!gmailPass) {
      console.warn("[Backup] GMAIL_PASS credentials missing in .env. Saved Excel file locally.");
      
      // Save success log to db
      const id = 'b_' + Date.now();
      await db.run(
        'INSERT INTO backup_logs (id, file_name, file_path, status, type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [id, fileName, filePath, 'Success', type, new Date().toISOString()]
      );

      return { 
        success: true, // Mark success since local save worked
        message: 'GMAIL_PASS credentials missing. Excel backup successfully generated and saved locally inside backups/ folder.', 
        path: filePath, 
        file: fileName 
      };
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass }
    });

    const currSymbol = settings[0]?.currency || "Rs.";
    const formattedCash = `${currSymbol} ${cashAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const formattedCard = `${currSymbol} ${cardAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const formattedCredit = `${currSymbol} ${creditAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const formattedBank = `${currSymbol} ${bankTransferAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const formattedTotal = `${currSymbol} ${paymentTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const backupHtml = `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Muthuwadige Hardware - System Backup Report</title></head>
    <body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
      <div style="max-width:680px;margin:0 auto;padding:24px 16px;">
        <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 60%,#1a1a2e 100%);border-radius:20px 20px 0 0;padding:36px 32px;position:relative;overflow:hidden;">
          <div style="position:relative;">
            <div style="display:inline-block;background:rgba(218,165,32,0.2);border:1px solid rgba(218,165,32,0.4);border-radius:12px;padding:8px 16px;margin-bottom:16px;">
              <span style="color:#DAA520;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">🔐 Automated Daily Backup</span>
            </div>
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:900;">${settings[0]?.shop_name || 'Muthuwadige Hardware'}</h1>
            <p style="margin:6px 0 0 0;color:#94a3b8;font-size:13px;">${settings[0]?.address || 'No: 80, Mahahunupitiya, Negombo'} | ${settings[0]?.phone || '077 076 076 7'}</p>
          </div>
        </div>

        <div style="background:#ffffff;padding:24px 28px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
          <h2 style="margin:0 0 16px 0;color:#0f172a;font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #f1f5f9;padding-bottom:12px;">📊 Financial Performance Summary</h2>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:20px;">
            <div style="background:#f8fafc;padding:14px;border-radius:10px;border:1px solid #e2e8f0;">
              <span style="color:#64748b;font-size:11px;font-weight:700;">Total Gross Sales</span>
              <div style="color:#0f172a;font-size:18px;font-weight:900;margin-top:4px;">${currSymbol} ${totalSalesRevenue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            </div>
            <div style="background:#f0fdf4;padding:14px;border-radius:10px;border:1px solid #bbf7d0;">
              <span style="color:#166534;font-size:11px;font-weight:700;">Net Sales Profit</span>
              <div style="color:#15803d;font-size:18px;font-weight:900;margin-top:4px;">${currSymbol} ${totalSalesProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            </div>
          </div>
        </div>

        <!-- Payment Method Breakdown Section -->
        <div style="background:#ffffff;padding:24px 28px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;border-top:1px solid #f1f5f9;">
          <h2 style="margin:0 0 16px 0;color:#0f172a;font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #f1f5f9;padding-bottom:12px;">💳 Payment Method Breakdown</h2>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
              <tbody>
                <tr>
                  <td style="padding:8px 0;color:#334155;font-weight:600;">💵 Cash:</td>
                  <td style="padding:8px 0;font-weight:800;color:#0f172a;text-align:right;">${formattedCash}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#334155;font-weight:600;">💳 Card:</td>
                  <td style="padding:8px 0;font-weight:800;color:#0f172a;text-align:right;">${formattedCard}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#334155;font-weight:600;">📜 Credit:</td>
                  <td style="padding:8px 0;font-weight:800;color:#0f172a;text-align:right;">${formattedCredit}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#334155;font-weight:600;">🏦 Bank Transfer:</td>
                  <td style="padding:8px 0;font-weight:800;color:#0f172a;text-align:right;">${formattedBank}</td>
                </tr>
                <tr style="border-top:2px dashed #cbd5e1;">
                  <td style="padding:10px 0 2px 0;color:#0f172a;font-weight:800;font-size:14px;">Total:</td>
                  <td style="padding:10px 0 2px 0;font-weight:900;color:#0f172a;font-size:15px;text-align:right;">${formattedTotal}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:20px 32px;border-radius:0 0 20px 20px;text-align:center;">
          <p style="margin:0;color:#DAA520;font-size:12px;font-weight:800;">${settings[0]?.shop_name || 'MUTHUWADIGE HARDWARE'}</p>
          <p style="margin:4px 0 0 0;color:#475569;font-size:11px;">Automated Backup ID: ${dateStr}</p>
        </div>
      </div>
    </body></html>
    `;

    await transporter.sendMail({
      from: gmailUser,
      to: targetEmail || 'sanojhardware@gmail.com',
      subject: `Muthuwadige Hardware - Automated System Backup - ${dateStr}`,
      text: `Greetings,

Please find attached the comprehensive Excel database report backup from the Muthuwadige Hardware ERP system.

Summary of Business & Financial Performance:
---------------------------------------------
📈 Total Gross Sales Revenue: ${currSymbol} ${totalSalesRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
💰 Total Net Sales Profit:   ${currSymbol} ${totalSalesProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
📦 Total Inventory Asset Value: ${currSymbol} ${totalInventoryValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
🛒 Total Orders Processed:   ${totalSalesCount}
🔧 Stock Adjustments Recorded: ${stockAdjustments.length} logs
🤝 Loyalty Registered Customers: ${totalCustomersCount}
👔 Active Staff Members (Employees): ${activeEmployeesCount}

Payment Method Breakdown:
----------------------------
Cash: ${formattedCash}
Card: ${formattedCard}
Credit: ${formattedCredit}
Bank Transfer: ${formattedBank}
----------------------------
Total: ${formattedTotal}

💡 Tip: Use the Excel tabs in the attached spreadsheet file to explore each database table in detail (including Inventory Stock, Stock Adjustments, Sales & Invoices, Accounting Ledger, etc.).`,
      html: backupHtml,
      attachments: [{ filename: fileName, path: filePath }]
    });

    console.log(`[Backup] Email successfully sent to ${targetEmail}!`);
    
    // Save success log to db
    const id = 'b_' + Date.now();
    await db.run(
      'INSERT INTO backup_logs (id, file_name, file_path, status, type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      [id, fileName, filePath, 'Success', type, new Date().toISOString()]
    );

    return { success: true, message: `Backup spreadsheet generated and emailed successfully to ${targetEmail}!`, path: filePath, file: fileName };
  } catch (e) {
    console.error("[Backup] Service Failed:", e);
    // Save failed log to db
    const id = 'b_' + Date.now();
    try {
      await db.run(
        'INSERT INTO backup_logs (id, file_name, file_path, status, type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [id, fileName || 'Error_Backup', filePath || 'N/A', 'Failed', type, new Date().toISOString()]
      );
    } catch(dbErr) {
      console.error("[Backup Log] Failed to save backup error log to SQLite:", dbErr);
    }
    return { success: false, message: e.message };
  }
};

// 🕰️ Cron Scheduler: Every 6 hours ('0 */6 * * *')
cron.schedule('0 */6 * * *', async () => {
  console.log('[Cron] Running automated tasks (6-Hourly Backup & WhatsApp Credit Reminders)...');
  try {
    const settings = await getRuntimeSettingsSnapshot();
    if (settings.backup_enabled === 1 && settings.backup_email) {
      console.log(`[Cron] 6-hourly automated backup triggered for target email: ${settings.backup_email}`);
      await performBackup(settings.backup_email);
    } else {
      console.log('[Cron] Automated 6-hourly backup is disabled or email is missing. Skipping.');
    }
  } catch (err) {
    console.error('[Cron] 6-hourly backup scheduler failed:', err);
  }


  // Check for overdue credit sales and simulate automated WhatsApp dispatch
  try {
    console.log('[Cron] Checking for overdue credit sales...');
    const overdueSales = await db.all(`
      SELECT s.id, s.invoice_no, s.customer_name, s.total_amount, s.due_date, c.phone as customer_phone 
      FROM sales s 
      LEFT JOIN customers c ON s.customer_id = c.id 
      WHERE s.status = 'Non Paid' AND s.due_date IS NOT NULL AND date(s.due_date) < date('now')
    `);

    for (const sale of overdueSales) {
      // Check if reminder was already sent today (to avoid spamming)
      const existingLog = await db.get(
        "SELECT id FROM audit_logs WHERE action = 'AUTOMATED_WHATSAPP_REMINDER' AND details LIKE ? AND date(timestamp) = date('now')",
        [`%${sale.invoice_no}%`]
      );

      if (!existingLog) {
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
      res.status(500).json(result);
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/trigger-backup', async (req, res) => {
  // Legacy GET support for backward compatibility with Settings.tsx fetch call
  try {
    const { fromDate, toDate } = req.query || {};
    const settings = await getRuntimeSettingsSnapshot();
    const email = settings.backup_email || 'sanojhardware@gmail.com';
    const result = await performBackup(email, 'Manual', fromDate, toDate);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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

    // Return standard mock payload resembling Supabase structure
    res.json({
      user: {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        name: profile.name,
        avatar: profile.avatar
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, role } = req.body;
  const id = 'u_' + Date.now();
  try {
    await db.run(
      'INSERT INTO profiles (id, name, email, role, avatar, password) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name || 'Staff User', email, role || 'cashier', email.charAt(0).toUpperCase(), password || '123456']
    );
    res.json({ success: true, user: { id, email, role: role || 'cashier', name: name || 'Staff User' } });
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
    if (!emailResult.success && emailResult.reason === 'GMAIL_PASS missing') {
      console.warn(`[Reset Password Simulation] Reset code for ${email} is ${resetCode}`);
      return res.json({ success: true, message: 'Reset code generated (simulated in console).' });
    }

    if (!emailResult.success) {
      throw new Error(emailResult.error || 'Failed to send password reset email.');
    }

    res.json({ success: true, message: 'Password reset code has been sent to your email address.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    // 2. Insert Sale Order
    await db.run(
      'INSERT INTO sales (id, invoice_no, customer_id, customer_name, customer_phone, customer_address, items, subtotal, discount, tax, tax_rate, total_amount, status, user_id, payment_method, created_at, due_date, credit_period_days, payment_received, transportation_fee, credit_note_applied, credit_note_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, finalInvoiceNo, s.customer_id, customerNameVal, customerPhoneVal, customerAddressVal, JSON.stringify(s.items), s.subtotal, s.discount, s.tax, s.tax_rate, s.total_amount, s.status, s.user_id, s.payment_method || 'Cash', created_at, s.due_date || null, s.credit_period_days || 0, s.payment_received || 0, transportationFeeVal, creditNoteApplied, creditNoteCode]
    );

    // 3. Decrement Product Stock levels & validate available stock
    for (const item of s.items) {
      const convRate = Number(item.conversionRate) || 1;
      const baseQtyDeduction = convRate > 0 ? (Number(item.qty || 0) / convRate) : Number(item.qty || 0);

      // Backend stock validation check
      const prod = await db.get('SELECT stock, name FROM products WHERE id = ?', [item.productId]);
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
      replaceRuntimeTransactionByDescription(`POS Sale ${finalInvoiceNo}`, {
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
      replaceRuntimeTransactionByDescription(`POS Credit Payment ${existing.invoice_no}`, {
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

app.post('/api/credit_payments', async (req, res) => {
  const p = req.body;
  const id = p.id || 'cp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const paymentDate = p.payment_date || new Date().toISOString();
  try {
    await db.run(
      'INSERT INTO credit_payments (id, sale_id, invoice_no, customer_id, customer_name, amount_paid, remaining_balance, payment_method, payment_date, recorded_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        p.sale_id,
        p.invoice_no,
        p.customer_id || null,
        p.customer_name || null,
        Number(p.amount_paid) || 0,
        Number(p.remaining_balance) || 0,
        p.payment_method || 'Cash',
        paymentDate,
        p.recorded_by || 'system',
        p.notes || ''
      ]
    );

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sales/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const sale = await db.get('SELECT * FROM sales WHERE id = ?', [id]);
    if (sale) {
      removeRuntimeTransactionsForSale(sale.invoice_no);
    }
    await db.run('DELETE FROM sales WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
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
    removeRuntimeTransactionsForSale(sale.invoice_no);

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
        created_at TEXT
      )
    `);
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
      userId: r.user_id,
      status: r.status || 'active',
      reason: r.reason || '',
      created_at: r.created_at
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

    // Calculate actual returnAmount if 0
    const calcReturnAmount = returnAmount || returnedItems.reduce((acc, i) => acc + (Number(i.qty || 0) * Number(i.price || 0)), 0);
    const calcExchangeAmount = exchangeAmount || exchangeItems.reduce((acc, i) => acc + (Number(i.qty || 0) * Number(i.price || 0)), 0);

    let finalCreditNoteNo = creditNoteNo;
    if (returnMethod === 'Credit Note' && !finalCreditNoteNo) {
      finalCreditNoteNo = 'CN-' + String(timestamp).slice(-6);
    }

    // 2. Save Sales Return record
    await db.run(
      `INSERT INTO sales_returns (
        id, return_no, invoice_no, customer_name, customer_phone, 
        returned_items, exchange_items, return_method, return_amount, exchange_amount, 
        balance_amount, total_refunded, customer_paid, change_given, credit_note_no, 
        user_id, status, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, return_no, invoiceNo, resolvedCustName, resolvedCustPhone,
        JSON.stringify(returnedItems), JSON.stringify(exchangeItems), returnMethod, calcReturnAmount, calcExchangeAmount,
        balanceAmount, totalRefunded, customerPaid, changeGiven, finalCreditNoteNo,
        userEmail || 'system', 'active', reason || '', created_at
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

    // 4. Handle Exchange items stock deduction
    if (returnMethod === 'Exchange' && exchangeItems.length > 0) {
      for (const exItem of exchangeItems) {
        const convRate = Number(exItem.conversionRate) || 1;
        const rawBaseDeduction = convRate > 0 ? (Number(exItem.qty || 0) / convRate) : Number(exItem.qty || 0);
        const baseQtyDeduction = Math.round(rawBaseDeduction * 1000000) / 1000000;
        await db.run(
          'UPDATE products SET stock = stock - ? WHERE id = ?',
          [baseQtyDeduction, exItem.productId || exItem.product_id]
        );
      }
    }

    // 5. Handle Credit Note creation if returnMethod === 'Credit Note'
    if (returnMethod === 'Credit Note') {
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

    // 6. Log financial transactions
    if (returnMethod === 'Cash Refund' && totalRefunded > 0) {
      const txId = 't_' + Date.now();
      await db.run(
        'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [txId, 'contra_revenue', 'Sales Return', `Sales Return Refund for ${invoiceNo}`, totalRefunded, new Date(created_at).toLocaleDateString('sv-SE'), invoiceNo, userEmail || 'system']
      );
    } else if (returnMethod === 'Exchange') {
      if (customerPaid > 0) {
        const txId = 't_' + Date.now();
        await db.run(
          'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, 'income', 'Exchange Payment', `Exchange Balance Payment for ${invoiceNo}`, customerPaid - changeGiven, new Date(created_at).toLocaleDateString('sv-SE'), invoiceNo, userEmail || 'system']
        );
      } else if (totalRefunded > 0) {
        const txId = 't_' + Date.now();
        await db.run(
          'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, 'contra_revenue', 'Exchange Refund', `Exchange Balance Refund for ${invoiceNo}`, totalRefunded, new Date(created_at).toLocaleDateString('sv-SE'), invoiceNo, userEmail || 'system']
        );
      }
    }

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

    await logAudit(userEmail || 'system', 'SALES_RETURN', `Processed ${returnMethod} (Return No: ${return_no}) for Invoice ${invoiceNo} (Amount: Rs. ${calcReturnAmount})`);

    await commitTxn(db, txn);
    console.log(`[END] Process Sales Return: Invoice ${invoiceNo} - ${Date.now() - startTime}ms`);
    res.json({ 
      success: true, 
      id, 
      returnNo: return_no, 
      return_no,
      invoice_no: invoiceNo, 
      totalRefunded,
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
      await db.run("UPDATE credit_notes SET status = 'voided' WHERE credit_note_no = ?", [sr.credit_note_no]);
    }

    // 5. Reverse financial refund transaction
    await db.run("DELETE FROM transactions WHERE reference = ? AND (category = 'Sales Return' OR category = 'Exchange Payment' OR category = 'Exchange Refund')", [sr.invoice_no]);

    // 6. Update sales invoice status
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
      if (totalReturnedQty === 0) {
        newStatus = 'Paid';
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
        await db.run("UPDATE credit_notes SET status = 'voided' WHERE credit_note_no = ?", [sr.credit_note_no]);
      }

      await db.run("DELETE FROM transactions WHERE reference = ? AND (category = 'Sales Return' OR category = 'Exchange Payment' OR category = 'Exchange Refund')", [sr.invoice_no]);

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
        if (totalReturnedQty === 0) {
          newStatus = 'Paid';
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
  try {
    const po = await db.get('SELECT * FROM purchase_orders WHERE id = ?', [id]);
    if (po) {
      removeRuntimeTransactionsForPurchaseOrder(po.po_number);
    }
    await db.run('DELETE FROM purchase_orders WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
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
  const { id } = req.params;
  try {
    await db.run('DELETE FROM transactions WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SYSTEM SETTINGS
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getRuntimeSettingsSnapshot();
    res.json({
      ...settings,
      backup_enabled: settings.backup_enabled === 1
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  const s = req.body;
  try {
    await setRuntimeSettings(s);
    await logAudit(s.user_email || 'system', 'SETTINGS_UPDATED', 'System settings were updated.');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BACKUP HISTORY LOGS API
app.get('/api/backup_logs', async (req, res) => {
  try {
    const logs = await db.all('SELECT * FROM backup_logs ORDER BY timestamp DESC');
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/backup-logs', async (req, res) => {
  try {
    const logs = await db.all('SELECT * FROM backup_logs ORDER BY timestamp DESC');
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/backup-logs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const log = await db.get('SELECT * FROM backup_logs WHERE id = ?', [id]);
    if (log && log.file_name) {
      const filePath = path.join(backupsDir, log.file_name);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (fileErr) {
          console.error("Error deleting physical backup file:", fileErr);
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
    for (const id of ids) {
      const log = await db.get('SELECT * FROM backup_logs WHERE id = ?', [id]);
      if (log && log.file_name) {
        const filePath = path.join(backupsDir, log.file_name);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (fileErr) {
            console.error("Error deleting physical backup file:", fileErr);
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
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/profiles/:id', async (req, res) => {
  const { id } = req.params;
  const p = req.body;
  try {
    await db.run(
      'UPDATE profiles SET name = ?, role = ?, avatar = ? WHERE id = ?',
      [p.name, p.role, p.avatar, id]
    );
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
      await db.run('UPDATE customers SET current_credit = 0, credit_balance = 0');
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
        Number(tax_amount || 0),
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
        tax,
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

// Express server launch hook listening on all network interfaces
app.listen(PORT, '0.0.0.0', async () => {
  try {
    await initializeDatabase();
    console.log(`🚀 REST API Server running on port ${PORT} (accepts local network connections)`);
  } catch (err) {
    console.error('🔴 Failed to initialize local SQLite database:', err);
  }
});
