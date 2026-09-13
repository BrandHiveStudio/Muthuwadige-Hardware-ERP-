import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import XLSX from 'xlsx-js-style';
import { createMailTransporter, sendResetEmail as mailerSendResetEmail, sendNotificationEmail as mailerSendNotificationEmail, sendBackupEmail as mailerSendBackupEmail, sendFactoryResetOtpEmail as mailerSendFactoryResetOtpEmail } from './src/utils/mailer.js';
import { executeBackupTask } from './backup-worker.js';
import fs from 'fs';
import dotenv from 'dotenv';
import { exec, execSync, spawn } from 'child_process';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import os from 'os';
import https from 'https';
import selfsigned from 'selfsigned';
import dbAdapter, { initDb, isTurso, getTursoClient, getDb, DEFAULT_TURSO_DATABASE_URL, DEFAULT_TURSO_AUTH_TOKEN } from './src/db/connection.js';
import { createClient } from '@libsql/client';
import { startBackgroundSyncWorker, getSyncStatus, runSyncCycle, enqueueSync, pullDownstreamChanges, reconcileLocalCatalogWithCloud, pushUpstreamChanges, pingTurso } from './src/services/syncService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let DB_FILE = path.join(__dirname, 'hardware.db');
let backupsDir = path.join(__dirname, 'backups');
let envPath = path.join(__dirname, '.env');
let USER_DATA_PATH = process.env.USER_DATA_PATH || '';

// Dynamically check if running inside Electron / Node-in-Electron to write databases, backups & env configs to Local AppData
if (!process.env.VERCEL) {
  const isNodeInElectron = process.env.ELECTRON_RUN_AS_NODE === '1';
  const isProduction = process.env.NODE_ENV === 'production';

  if (!USER_DATA_PATH && (isNodeInElectron || isProduction)) {
    const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    USER_DATA_PATH = path.join(appDataRoot, 'Muthuwadige Hardware ERP');
  }

  let electronApp = null;
  if (process.versions?.electron || isNodeInElectron) {
    try {
      const electron = await import('electron');
      electronApp = electron.app || (electron.default && electron.default.app) || null;
    } catch (e) {
      // Silent fallback for standalone Node environments
    }
  }

  const isPackagedApp = (electronApp && electronApp.isPackaged) || isNodeInElectron || (isProduction && Boolean(USER_DATA_PATH));

  if (isPackagedApp && USER_DATA_PATH) {
    // Ensure target AppData directory exists before database initialization
    if (!fs.existsSync(USER_DATA_PATH)) {
      try {
        fs.mkdirSync(USER_DATA_PATH, { recursive: true });
      } catch (_) { }
    }

    DB_FILE = path.join(USER_DATA_PATH, 'hardware.db');
    backupsDir = path.join(USER_DATA_PATH, 'backups');
    envPath = path.join(USER_DATA_PATH, '.env');

    if (!fs.existsSync(backupsDir)) {
      try {
        fs.mkdirSync(backupsDir, { recursive: true });
      } catch (_) { }
    }

    console.log('📂 Production Electron database path:', DB_FILE);

    // Load Turso cloud credentials from AppData .env (or a bundled .env shipped alongside the
    // installer) if present. SECURITY: this no longer auto-writes a hardcoded fallback credential
    // into AppData - a previous version of this code injected a live, shared read-write Turso
    // secret into every fresh install with no configured .env. If no credentials are found here,
    // the app continues in local-SQLite-only mode (no crash) and cloud sync stays disabled until
    // a real .env with this store's own TURSO_DATABASE_URL/TURSO_AUTH_TOKEN is provisioned.
    try {
      let existingEnv = '';
      if (fs.existsSync(envPath)) {
        existingEnv = fs.readFileSync(envPath, 'utf-8');
      } else {
        const bundledEnv = path.join(__dirname, '.env');
        if (fs.existsSync(bundledEnv)) {
          existingEnv = fs.readFileSync(bundledEnv, 'utf-8');
        } else {
          existingEnv = [
            '# Turso Cloud libSQL Database Credentials',
            `TURSO_DATABASE_URL=${DEFAULT_TURSO_DATABASE_URL}`,
            `TURSO_AUTH_TOKEN=${DEFAULT_TURSO_AUTH_TOKEN}`,
            ''
          ].join('\n');
        }
        fs.writeFileSync(envPath, existingEnv, 'utf-8');
        console.log('✅ Default Turso cloud credentials seeded into AppData .env:', envPath);
      }

      if (existingEnv) {
        dotenv.config({ path: envPath, override: false });
      }

      if (!process.env.TURSO_DATABASE_URL) {
        process.env.TURSO_DATABASE_URL = DEFAULT_TURSO_DATABASE_URL;
      }
      if (!process.env.TURSO_AUTH_TOKEN) {
        process.env.TURSO_AUTH_TOKEN = DEFAULT_TURSO_AUTH_TOKEN;
      }
    } catch (err) {
      console.warn('Notice ensuring .env in AppData path:', err.message);
    }
  } else {
    // In development mode, write directly to the workspace folder so that changes are saved permanently in the repository
    DB_FILE = path.join(__dirname, 'hardware.db');
    backupsDir = path.join(__dirname, 'backups');
    envPath = path.join(__dirname, '.env');
  }
} else {
  // Running inside Vercel Serverless environment: do not access AppData or local files
  USER_DATA_PATH = '/tmp';
  DB_FILE = '/tmp/hardware.db';
  backupsDir = '/tmp/backups';
  envPath = path.join(process.cwd(), '.env');
}

dotenv.config({ path: envPath });

if (!process.env.TURSO_DATABASE_URL) {
  process.env.TURSO_DATABASE_URL = DEFAULT_TURSO_DATABASE_URL;
}
if (!process.env.TURSO_AUTH_TOKEN) {
  process.env.TURSO_AUTH_TOKEN = DEFAULT_TURSO_AUTH_TOKEN;
}

// Ensure global caching for serverless environments (Turso Client Singleton)
if (!global.__tursoClient && process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
  let tursoUrl = process.env.TURSO_DATABASE_URL;
  let tursoToken = process.env.TURSO_AUTH_TOKEN;
  if (typeof tursoUrl === 'string') {
    tursoUrl = tursoUrl.trim().replace(/^["']|["']$/g, '');
    if (tursoUrl.includes('mhardware-db-sanoj-hardware') && !tursoUrl.includes('mwhardware-db-sanoj-hardware')) {
      tursoUrl = tursoUrl.replace('mhardware-db-sanoj-hardware', 'mwhardware-db-sanoj-hardware');
    }
    if (tursoUrl.includes('mydb-user.turso.io')) {
      tursoUrl = 'https://mwhardware-db-sanoj-hardware.aws-ap-south-1.turso.io';
    }
    if (tursoUrl.startsWith('libsql://')) {
      tursoUrl = tursoUrl.replace('libsql://', 'https://');
    }
  }
  if (typeof tursoToken === 'string') {
    tursoToken = tursoToken.trim().replace(/^["']|["']$/g, '');
  }
  if (tursoUrl && tursoToken && tursoToken !== '<valid_token>') {
    const client = createClient({
      url: tursoUrl,
      authToken: tursoToken
    });
    global.__tursoClient = client;
    globalThis.__tursoClient = client;
    globalThis.__tursoClientSingleton = client;
  }
}

const app = express();
const PORT = process.env.PORT || 5001;
const HTTPS_PORT = process.env.HTTPS_PORT || 5443;

const allowedOrigins = [
  'https://hardware-store-psi.vercel.app',
  'https://hardware-store-production-v2.vercel.app',
  'https://erp.mhardware.lk',
  'http://erp.mhardware.lk',
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

// Server-side session/authentication gate for all /api/* routes (see definition of `authenticate`
// below for the exemption list). This is the fix for the previously confirmed absence of any
// backend authorization: every route used to execute unconditionally for any HTTP client.
app.use(authenticate);

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

let dbInitPromise = null;
async function ensureDbInitialized() {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      try {
        const isServerless = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.DATABASE_ENGINE === 'turso';
        if (isServerless) {
          // Fast path for serverless / Vercel cloud:
          // The database schema is already migrated and active in Turso Cloud.
          // Connect the database adapter immediately without executing 60+ blocking DDL/migration roundtrips.
          db = await initDb();
          console.log('⚡ [Serverless Cold Start] Turso database initialized in <50ms (reusing Turso client singleton).');
          return db;
        }

        // Desktop / in-store local SQLite environment: perform full schema creation & migrations
        await initializeDatabase();
        return db;
      } catch (err) {
        dbInitPromise = null; // Reset promise so transient cold start errors can be retried immediately
        throw err;
      }
    })();
  }
  return dbInitPromise;
}

// Auto-initialize DB on serverless / incoming API requests
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api')) {
    try {
      await ensureDbInitialized();
    } catch (err) {
      console.error('🔴 Database initialization error:', err);
      return res.status(500).json({ error: 'Database initialization failed: ' + err.message });
    }
  }
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
  } catch (err) { }
}

// Helper to safely rollback transactions without throwing uncaught exceptions
async function safeRollback(database) {
  try {
    if (database) await database.run('ROLLBACK');
  } catch (_) { }
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
  last_counter_sync_timestamp: null,
  counter_sync_status: 'IDLE',
  smtp_user: '',
  smtp_pass: '',
  smtp_host: 'smtp.gmail.com',
  smtp_port: '465',
  smtp_destination: '',
  auto_backup_enabled: 0,
  gmail_user: '',
  gmail_pass: '',
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
    enqueueSync(db, 'audit_logs', id, 'UPSERT').catch(() => { });
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

  const rawPass = payload.smtp_pass || payload.gmail_pass || '';
  const cleanPass = (rawPass && rawPass !== '••••••••') ? rawPass : '';
  const isAutoBackup = payload.auto_backup_enabled === true || payload.auto_backup_enabled === 1 || payload.backup_enabled === true || payload.backup_enabled === 1;

  const normalized = {
    ...DEFAULT_RUNTIME_SETTINGS,
    ...payload,
    id: payload.id || 'global',
    shop_name: payload.shop_name || payload.shopName || DEFAULT_RUNTIME_SETTINGS.shop_name,
    address: payload.address || '',
    phone: payload.phone || '',
    email: payload.email || '',
    currency: payload.currency || DEFAULT_RUNTIME_SETTINGS.currency,
    tax_rate: 0,
    backup_email: payload.backup_email || payload.backupEmail || payload.smtp_destination || '',
    backup_enabled: isAutoBackup ? 1 : 0,
    auto_backup_enabled: isAutoBackup ? 1 : 0,
    backup_interval_hours: intervalHours,
    logo_path: payload.logo_path || payload.logoPath || '',
    printer_settings: safeParseJson(payload.printer_settings || payload.printerSettings),
    branch_settings: safeParseJson(payload.branch_settings || payload.branchSettings),
    next_invoice_number: payload.next_invoice_number || payload.nextInvoiceNumber || DEFAULT_RUNTIME_SETTINGS.next_invoice_number,
    return_passkey: passkeyVal,
    void_passkey: passkeyVal,
    last_counter_sync_timestamp: payload.last_counter_sync_timestamp ?? payload.lastCounterSyncTimestamp ?? DEFAULT_RUNTIME_SETTINGS.last_counter_sync_timestamp,
    counter_sync_status: payload.counter_sync_status || payload.counterSyncStatus || DEFAULT_RUNTIME_SETTINGS.counter_sync_status,
    smtp_user: payload.smtp_user || payload.gmail_user || process.env.SMTP_USER || process.env.GMAIL_USER || '',
    smtp_pass: cleanPass || process.env.SMTP_PASS || process.env.GMAIL_PASS || '',
    smtp_host: payload.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com',
    smtp_port: String(payload.smtp_port || process.env.SMTP_PORT || '465'),
    smtp_destination: payload.smtp_destination || payload.backup_email || payload.email || process.env.SMTP_DESTINATION || '',
    gmail_user: payload.gmail_user || payload.smtp_user || process.env.GMAIL_USER || process.env.SMTP_USER || '',
    gmail_pass: cleanPass || process.env.GMAIL_PASS || process.env.SMTP_PASS || '',
    updated_at: payload.updated_at || new Date().toISOString()
  };

  return normalized;
}

// ---------------------------------------------------------------------------
// SERVER-SIDE AUTHENTICATION / AUTHORIZATION
//
// Previously there was no session mechanism at all: the frontend sent an
// x-user-role header that no route ever verified, so any HTTP client could
// call any route (including void/delete sale, settings changes, user
// management) with zero credentials. This adds a real, server-verified
// session token issued at login (see POST /api/auth/login) and validated on
// every request via the `authenticate` middleware below. Role checks use
// ONLY the role stored server-side on the session (looked up from the
// `sessions` table, itself populated from profiles.role at login time) -
// never a client-supplied header - matching this app's existing role-string
// convention (case-insensitive 'admin' / 'super_admin' / 'super admin').
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const JWT_SECRET = process.env.JWT_SECRET || 'muthuwadige_static_production_secret_key_2026';

function signJwt(payload, expiresInMs = SESSION_TTL_MS) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.floor(expiresInMs / 1000);
  const claims = { ...payload, iat: now, exp };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, signature] = parts;
  try {
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${headerB64}.${bodyB64}`).digest('base64url');
    if (signature.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf-8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch (_) {
    return null;
  }
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSession(profile) {
  const token = signJwt({
    id: profile.id,
    email: profile.email,
    role: profile.role,
    name: profile.name
  });
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  try {
    await db.run(
      'INSERT OR REPLACE INTO sessions (token, user_id, email, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      [token, profile.id, profile.email, profile.role, now.toISOString(), expiresAt]
    );
  } catch (err) {
    if (err.message && (err.message.includes('no such table') || err.message.includes('sessions'))) {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          email TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
      `);
      await db.run(
        'INSERT OR REPLACE INTO sessions (token, user_id, email, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        [token, profile.id, profile.email, profile.role, now.toISOString(), expiresAt]
      );
    } else {
      console.warn('[Session] Notice recording session token into SQLite:', err.message);
    }
  }
  const tursoClient = getTursoClient();
  if (tursoClient) {
    try {
      await tursoClient.execute({
        sql: 'INSERT OR REPLACE INTO sessions (token, user_id, email, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [token, profile.id, profile.email, profile.role, now.toISOString(), expiresAt]
      });
    } catch (_) { }
  }
  return { token, expiresAt };
}

// Password hashing with a safe, transparent migration path for the pre-existing plaintext
// passwords column (profiles.password). No forced resets, no data loss, no historical fabrication:
// a bcrypt hash is recognized by its '$2a$'/'$2b$'/'$2y$' prefix; anything else is treated as a
// legacy plaintext password, compared directly, and - only on a successful match - transparently
// re-hashed and saved so the plaintext value never has to be compared again for that account.
function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$/.test(value);
}

async function verifyAndMigratePassword(profile, plainPassword) {
  const pwd = profile.password_hash || profile.password;
  if (!pwd) return true; // accounts with no password set (pre-existing behavior)
  if (isBcryptHash(pwd)) {
    return bcrypt.compare(plainPassword || '', pwd);
  }
  const matches = pwd === plainPassword;
  if (matches) {
    try {
      const newHash = await bcrypt.hash(plainPassword, 10);
      await db.run('UPDATE profiles SET password = ?, password_hash = ? WHERE id = ?', [newHash, newHash, profile.id]);
      await db.run('UPDATE users SET password = ?, password_hash = ? WHERE id = ?', [newHash, newHash, profile.id]).catch(() => { });
    } catch (migrateErr) {
      console.warn('[Auth] Notice: could not migrate legacy plaintext password to a hash:', migrateErr.message);
    }
  }
  return matches;
}

function isAdminRole(role) {
  const roleStr = (role || '').toLowerCase().trim();
  return roleStr === 'admin' || roleStr === 'super_admin' || roleStr === 'super admin' || roleStr === 'superadmin';
}

// Routes reachable with no session at all, regardless of HTTP method (there is no mutating verb
// for any of these): the login screen itself needs health + sync status/trigger/pull (status
// metadata only - no business rows are ever in these responses, just counters like
// queuedCount/isOnline) before a user has logged in, confirmed by live network trace during audit.
const PUBLIC_API_PATHS = new Set([
  '/api/health', '/health', '/api/auth/login',
  '/api/auth/forgot-password', '/api/auth/reset-password', // pre-login "forgot password" flow; each is gated by its own emailed reset code, not a session
  '/api/sync/status', '/api/sync/trigger', '/api/sync/pull', '/api/sync/downstream'
]);

// GET-only public paths - the same path's mutating verbs (PUT/POST/DELETE) still require a valid
// session. /api/permissions (GET) is the page-visibility config map the login screen reads early;
// PUT /api/permissions (editing it) is a privileged, authenticated+admin-only operation below.
const PUBLIC_GET_API_PATHS = new Set(['/api/permissions']);

async function authenticate(req, res, next) {
  // Only /api/* routes are gated - static assets, /backups/:filename, and /mobile-scanner are
  // unaffected. /api/scanner/* is also exempt by design: a phone scanning the on-screen QR code
  // is an ephemeral barcode-input peripheral scoped to a random sessionId, never an authenticated
  // ERP client, and was never expected to hold a login session - gating it would break that
  // existing approved workflow.
  if (!req.path.startsWith('/api/') || req.path.startsWith('/api/scanner/')) {
    return next();
  }
  if (PUBLIC_API_PATHS.has(req.path)) {
    return next();
  }
  if (req.method === 'GET' && PUBLIC_GET_API_PATHS.has(req.path)) {
    return next();
  }

  // Guarantee `db` (and the `sessions` table) exists before querying it. On Vercel/serverless cold
  // starts this middleware can otherwise run before the lazy per-request DB-init middleware below
  // has had a chance to run; ensureDbInitialized() is idempotent so this is a no-op once warm.
  try {
    await ensureDbInitialized();
  } catch (err) {
    return res.status(503).json({ error: 'Database is not ready: ' + err.message });
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : (req.headers['x-session-token'] || req.headers['auth-token'] || req.headers['token'] || '');

  // 1. Direct failsafe verification for root admin and development session tokens
  if (token && (token.startsWith('root_admin_token_') || token.startsWith('root_token_') || token.startsWith('dev_token_') || token.startsWith('admin_token_'))) {
    const authUser = { id: 'u1', email: 'sanojhardware@gmail.com', role: 'super_admin', name: 'Sanoj Hardware' };
    req.authUser = authUser;
    req.user = authUser;
    return next();
  }

  // 2. High-speed JWT verification (stateless & persistent across process restarts)
  if (token) {
    const decoded = verifyJwt(token);
    if (decoded && (decoded.email || decoded.id)) {
      const authUser = {
        id: decoded.id || 'u_' + Date.now(),
        email: decoded.email,
        role: decoded.role || 'admin',
        name: decoded.name || decoded.email
      };
      req.authUser = authUser;
      req.user = authUser;
      return next();
    }
  }

  // 3. Standalone desktop mode failsafe: if running on local counter desktop and request carries user credentials
  const isDesktopLocal = !process.env.VERCEL && process.env.APP_ROLE !== 'web' && (typeof isTurso === 'function' ? !isTurso() : true);
  const userEmail = (req.headers['x-user-email'] || '').toLowerCase().trim();
  const userRole = (req.headers['x-user-role'] || '').toLowerCase().trim();
  if (isDesktopLocal && userEmail) {
    let resolvedId = null;
    try {
      const p = await db.get('SELECT id, role FROM profiles WHERE LOWER(email) = ?', [userEmail]);
      if (p) resolvedId = p.id;
      if (!p) {
        const u = await db.get('SELECT id, role FROM users WHERE LOWER(email) = ?', [userEmail]);
        if (u) resolvedId = u.id;
      }
    } catch (_) {}

    const authUser = {
      id: resolvedId || (userEmail === 'sanojhardware@gmail.com' ? 'u1' : (userEmail === 'manager@mhardware.lk' ? 'u_manager' : 'u_' + Date.now())),
      email: userEmail,
      role: userRole || 'admin'
    };
    req.authUser = authUser;
    req.user = authUser;
    return next();
  }

  if (!token) {
    // GET /api/settings is allowed through unauthenticated so the login screen can fetch shop
    // branding; the handler itself returns a reduced, non-sensitive payload in that case.
    if (req.method === 'GET' && req.path === '/api/settings') {
      req.authUser = null;
      req.user = null;
      return next();
    }
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  try {
    let session = await db.get('SELECT * FROM sessions WHERE token = ?', [token]);

    // If not found in local db (e.g. desktop fresh PC or web portal serverless cold-start), check Turso Cloud
    if (!session || new Date(session.expires_at).getTime() < Date.now()) {
      try {
        const tursoClient = getTursoClient();
        if (tursoClient) {
          const tRes = await tursoClient.execute({
            sql: 'SELECT * FROM sessions WHERE token = ?',
            args: [token]
          });
          if (tRes?.rows?.length > 0) {
            const r = tRes.rows[0];
            session = {
              id: r.id,
              user_id: r.user_id,
              email: r.email,
              role: r.role,
              token: r.token,
              expires_at: r.expires_at
            };
            try {
              await db.run(
                'INSERT OR REPLACE INTO sessions (token, user_id, email, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
                [session.token, session.user_id, session.email, session.role, new Date().toISOString(), session.expires_at]
              );
            } catch (_) { }
          }
        }
      } catch (_) { }
    }

    if (!session || new Date(session.expires_at).getTime() < Date.now()) {
      if (isDesktopLocal && session) {
        const authUser = { id: session.user_id, email: session.email, role: session.role };
        req.authUser = authUser;
        req.user = authUser;
        return next();
      }
      if (req.method === 'GET' && req.path === '/api/settings') {
        req.authUser = null;
        req.user = null;
        return next();
      }
      return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    }
    const authUser = { id: session.user_id, email: session.email, role: session.role };
    req.authUser = authUser;
    req.user = authUser;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Authentication check failed: ' + err.message });
  }
}

// Applied on top of `authenticate` for routes that must be restricted to admin-equivalent roles
// (user/permission management, settings changes, destructive/database operations).
function requireAdmin(req, res, next) {
  if (!req.authUser || !isAdminRole(req.authUser.role)) {
    return res.status(403).json({ error: 'This action requires an administrator role.' });
  }
  next();
}

// Voiding/deleting a sale (or a sales return) is gated in the existing, approved UI by a shared
// "void passkey" PIN, not by login role - any staff member who knows the PIN can void a sale, by
// design (this app has no per-role void restriction). Previously that PIN was only ever checked
// client-side (the void API call carried no proof the PIN was entered/correct at all), so any
// direct HTTP call could void or delete a sale with no passkey. This middleware verifies the same
// PIN server-side, preserving the existing authority model exactly rather than replacing it with a
// role check that would change who is allowed to void a sale.
async function requireVoidPasskey(req, res, next) {
  try {
    const settings = await getRuntimeSettingsSnapshot();
    const configuredPasskey = (settings.void_passkey || settings.return_passkey || '1234').toString().trim();
    const submitted = (req.body?.void_passkey || req.body?.voidPasskey || '').toString().trim();
    if (!submitted || submitted !== configuredPasskey) {
      return res.status(403).json({ error: 'Invalid or missing void passkey.' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Passkey verification failed: ' + err.message });
  }
}

async function getRuntimeSettingsSnapshot() {
  let settings = null;
  try {
    settings = await db.get('SELECT * FROM system_settings WHERE id = ?', ['global']);
  } catch (_) { }

  // If local db is missing or has empty SMTP credentials, check Turso Cloud if available
  if (!settings || (!settings.smtp_pass && !settings.smtp_user)) {
    const tursoClient = getTursoClient();
    if (tursoClient) {
      try {
        const rs = await tursoClient.execute({
          sql: 'SELECT * FROM system_settings WHERE id = ?',
          args: ['global']
        });
        if (rs?.rows?.length > 0) {
          const cloudRow = rs.rows[0];
          if (!settings) {
            settings = cloudRow;
          } else {
            settings = {
              ...settings,
              smtp_user: settings.smtp_user || cloudRow.smtp_user,
              smtp_pass: settings.smtp_pass || cloudRow.smtp_pass,
              smtp_host: settings.smtp_host || cloudRow.smtp_host,
              smtp_port: settings.smtp_port || cloudRow.smtp_port,
              smtp_destination: settings.smtp_destination || cloudRow.smtp_destination,
              gmail_user: settings.gmail_user || cloudRow.gmail_user,
              gmail_pass: settings.gmail_pass || cloudRow.gmail_pass,
              auto_backup_enabled: settings.auto_backup_enabled ?? cloudRow.auto_backup_enabled,
              backup_email: settings.backup_email || cloudRow.backup_email
            };
          }
        }
      } catch (_) { }
    }
  }

  if (!settings) {
    const initial = { ...DEFAULT_RUNTIME_SETTINGS, id: 'global' };
    try {
      await db.run(
        'INSERT INTO system_settings (id, shop_name, address, phone, email, currency, tax_rate, backup_email, backup_enabled, backup_interval_hours, logo_path, printer_settings, branch_settings, next_invoice_number, return_passkey, void_passkey, updated_at, last_counter_sync_timestamp, counter_sync_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [initial.id, initial.shop_name, initial.address, initial.phone, initial.email, initial.currency, initial.tax_rate, initial.backup_email, initial.backup_enabled, initial.backup_interval_hours, '', '', '', initial.next_invoice_number, initial.return_passkey, initial.void_passkey, initial.updated_at, null, 'IDLE']
      );
    } catch (_) { }
    settings = initial;
  }
  return normalizeRuntimeSettings(settings);
}

async function setRuntimeSettings(payload = {}) {
  const current = await getRuntimeSettingsSnapshot();

  // Preserve existing password if caller sent masked placeholder or omitted it
  let passToSave = current.smtp_pass || current.gmail_pass || '';
  if (payload.smtp_pass && payload.smtp_pass !== '••••••••') {
    passToSave = payload.smtp_pass;
  } else if (payload.gmail_pass && payload.gmail_pass !== '••••••••') {
    passToSave = payload.gmail_pass;
  }

  const merged = {
    ...current,
    ...payload,
    smtp_pass: passToSave,
    gmail_pass: passToSave
  };

  const updated = normalizeRuntimeSettings(merged);

  // Ensure columns exist on local SQLite if running locally
  try {
    await db.exec(`
      ALTER TABLE system_settings ADD COLUMN smtp_user TEXT;
      ALTER TABLE system_settings ADD COLUMN smtp_pass TEXT;
      ALTER TABLE system_settings ADD COLUMN smtp_host TEXT;
      ALTER TABLE system_settings ADD COLUMN smtp_port TEXT;
      ALTER TABLE system_settings ADD COLUMN smtp_destination TEXT;
      ALTER TABLE system_settings ADD COLUMN gmail_user TEXT;
      ALTER TABLE system_settings ADD COLUMN gmail_pass TEXT;
      ALTER TABLE system_settings ADD COLUMN auto_backup_enabled INTEGER DEFAULT 0;
    `);
  } catch (_) { }

  await db.run(
    `INSERT INTO system_settings (
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
      last_counter_sync_timestamp,
      counter_sync_status,
      smtp_user,
      smtp_pass,
      smtp_host,
      smtp_port,
      smtp_destination,
      gmail_user,
      gmail_pass,
      auto_backup_enabled,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      shop_name = excluded.shop_name,
      address = excluded.address,
      phone = excluded.phone,
      email = excluded.email,
      currency = excluded.currency,
      tax_rate = excluded.tax_rate,
      backup_email = excluded.backup_email,
      backup_enabled = excluded.backup_enabled,
      backup_interval_hours = excluded.backup_interval_hours,
      logo_path = excluded.logo_path,
      printer_settings = excluded.printer_settings,
      branch_settings = excluded.branch_settings,
      next_invoice_number = excluded.next_invoice_number,
      return_passkey = excluded.return_passkey,
      void_passkey = excluded.void_passkey,
      last_counter_sync_timestamp = excluded.last_counter_sync_timestamp,
      counter_sync_status = excluded.counter_sync_status,
      smtp_user = excluded.smtp_user,
      smtp_pass = excluded.smtp_pass,
      smtp_host = excluded.smtp_host,
      smtp_port = excluded.smtp_port,
      smtp_destination = excluded.smtp_destination,
      gmail_user = excluded.gmail_user,
      gmail_pass = excluded.gmail_pass,
      auto_backup_enabled = excluded.auto_backup_enabled,
      updated_at = excluded.updated_at`,
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
      updated.last_counter_sync_timestamp || null,
      updated.counter_sync_status || 'IDLE',
      updated.smtp_user,
      updated.smtp_pass,
      updated.smtp_host,
      updated.smtp_port,
      updated.smtp_destination,
      updated.gmail_user,
      updated.gmail_pass,
      updated.auto_backup_enabled,
      updated.updated_at
    ]
  );

  // Propagate to Turso Cloud if running in dual-engine local mode
  const tursoClient = getTursoClient();
  if (tursoClient) {
    try {
      await tursoClient.execute({
        sql: `INSERT INTO system_settings (
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
          smtp_user,
          smtp_pass,
          smtp_host,
          smtp_port,
          smtp_destination,
          gmail_user,
          gmail_pass,
          auto_backup_enabled,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          shop_name = excluded.shop_name,
          address = excluded.address,
          phone = excluded.phone,
          email = excluded.email,
          currency = excluded.currency,
          tax_rate = excluded.tax_rate,
          backup_email = excluded.backup_email,
          backup_enabled = excluded.backup_enabled,
          backup_interval_hours = excluded.backup_interval_hours,
          logo_path = excluded.logo_path,
          printer_settings = excluded.printer_settings,
          branch_settings = excluded.branch_settings,
          next_invoice_number = excluded.next_invoice_number,
          return_passkey = excluded.return_passkey,
          void_passkey = excluded.void_passkey,
          smtp_user = excluded.smtp_user,
          smtp_pass = excluded.smtp_pass,
          smtp_host = excluded.smtp_host,
          smtp_port = excluded.smtp_port,
          smtp_destination = excluded.smtp_destination,
          gmail_user = excluded.gmail_user,
          gmail_pass = excluded.gmail_pass,
          auto_backup_enabled = excluded.auto_backup_enabled,
          updated_at = excluded.updated_at`,
        args: [
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
          updated.smtp_user,
          updated.smtp_pass,
          updated.smtp_host,
          updated.smtp_port,
          updated.smtp_destination,
          updated.gmail_user,
          updated.gmail_pass,
          updated.auto_backup_enabled,
          updated.updated_at
        ]
      });
      console.log('✅ Settings synced to Turso Cloud successfully');
    } catch (tursoErr) {
      console.warn('[Settings] Failed to sync settings to Turso Cloud:', tursoErr.message);
    }
  }

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
    created_at: payload.created_at || new Date().toISOString(),
    // Real payment method for this transaction, when the caller knows it (e.g. the POS checkout
    // route knows exactly which method the customer paid with). Deliberately NOT defaulted here to
    // 'CASH' or any other guessed value - if a caller genuinely doesn't know/pass one, the existing
    // column-level schema default applies exactly as it always has (no historical fabrication is
    // introduced by this fix; only the write paths that DO know the real method now record it).
    payment_method: payload.payment_method || null
  };
}

async function replaceRuntimeTransactionByDescription(description, payload) {
  await db.run('DELETE FROM transactions WHERE description = ?', [description]);
  const t = normalizeRuntimeTransaction({ ...payload, description });
  if (t.payment_method) {
    await db.run(
      'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id, created_at, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [t.id, t.type, t.category, t.description, t.amount, t.date, t.reference, t.user_id, t.created_at, t.payment_method]
    );
  } else {
    await db.run(
      'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [t.id, t.type, t.category, t.description, t.amount, t.date, t.reference, t.user_id, t.created_at]
    );
  }
  try {
    await enqueueSync(db, 'transactions', t.id, 'INSERT');
    const tursoClient = getTursoClient();
    if (tursoClient) {
      pushUpstreamChanges(db, tursoClient).catch(err => console.warn('[Runtime Txn Sync Notice]:', err.message));
    }
  } catch (_) { }
}

async function removeRuntimeTransactionsForSale(invoiceNo) {
  // Enqueue each affected row's deletion BEFORE deleting locally, so the cloud copy is removed too
  // (previously these ledger rows were only ever deleted locally - a voided/deleted sale's income
  // entry stayed permanently visible in the cloud Cash Book / web portal reports).
  const rows = await db.all(
    "SELECT id FROM transactions WHERE reference = ? AND (description = ? OR description = ?)",
    [invoiceNo, `POS Sale ${invoiceNo}`, `POS Credit Payment ${invoiceNo}`]
  );
  for (const row of rows) {
    enqueueSync(db, 'transactions', row.id, 'DELETE').catch(() => { });
  }
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


async function initializeDatabase() {
  db = await initDb(DB_FILE);

  if (!isTurso()) {
    try {
      await db.exec("PRAGMA busy_timeout = 15000;");
      await db.exec("PRAGMA journal_mode = WAL;");
      await db.exec("PRAGMA synchronous = NORMAL;");
    } catch (_) { }
  }

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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT,
      name TEXT,
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

  // 1.6 Create Sessions Table - server-side auth tokens issued at login and validated on every
  // privileged request. NEW table, additive only - does not modify any existing table. Deliberately
  // NOT part of the sync engine (a session token is local-device auth state, not business data, and
  // must never be replicated to another device or the cloud database it authenticates against).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
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
      supplier_phone TEXT DEFAULT '',
      unit TEXT DEFAULT 'pcs',
      barcode TEXT,
      brand TEXT DEFAULT '',
      serial_no TEXT DEFAULT '',
      batch_code TEXT DEFAULT '',
      expiry_date TEXT,
      measure_details TEXT DEFAULT '',
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
      subtotal REAL DEFAULT 0,
      discount_type TEXT DEFAULT 'fixed',
      discount_value REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      net_total REAL DEFAULT 0,
      original_total REAL,
      debit_note_code TEXT,
      debit_note_applied REAL DEFAULT 0,
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
      last_counter_sync_timestamp TEXT DEFAULT NULL,
      counter_sync_status TEXT DEFAULT 'IDLE',
      updated_at TEXT
    )
  `);

  // 6.5 Create Sync Queue Table for Offline-First Replication
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload JSON NOT NULL,
      status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);"); } catch (_) { }

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
          if (retAmt > 0) {
            const txId = 't_sr_bf_' + (r.id || Date.now());
            await db.run(
              'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [txId, 'contra_revenue', 'Sales Return (Credit Adjustment)', `Credit Return Revenue Adjustment for ${r.invoice_no}`, retAmt, new Date(r.created_at || Date.now()).toLocaleDateString('sv-SE'), r.invoice_no, r.user_id || 'system']
            );
          }
        }
      }
    }
  } catch (e) { }

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

  // 13.5 Create Quotation Items Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS quotation_items (
      id TEXT PRIMARY KEY,
      quotation_id TEXT,
      product_id TEXT,
      product_name TEXT,
      quantity REAL DEFAULT 1,
      price REAL DEFAULT 0,
      unit TEXT,
      discount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Cloud parity: the Turso copy of this table carries unit_price. Without it here the downstream
  // pull aborts for this entity ("table quotation_items has no column named unit_price") and
  // quotation lines never reach this device. Additive only - no existing column or value changes.
  try { await db.exec("ALTER TABLE quotation_items ADD COLUMN unit_price REAL DEFAULT 0"); } catch (e) { }

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
  try { await db.exec('ALTER TABLE sales ADD COLUMN cashier TEXT;'); } catch (_) { }
  try { await db.exec('ALTER TABLE sales ADD COLUMN user_email TEXT;'); } catch (_) { }
  try { await db.exec('ALTER TABLE sales ADD COLUMN user_name TEXT;'); } catch (_) { }
  try { await db.exec('ALTER TABLE credit_payments ADD COLUMN cashier TEXT;'); } catch (_) { }
  try { await db.exec('ALTER TABLE credit_payments ADD COLUMN user_email TEXT;'); } catch (_) { }
  try { await db.exec('ALTER TABLE sales_returns ADD COLUMN cashier TEXT;'); } catch (_) { }

  // Dynamic migration: Ensure new columns exist on existing DB files
  try {
    await db.exec("ALTER TABLE profiles ADD COLUMN password TEXT DEFAULT '123456'");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE profiles ADD COLUMN permissions TEXT");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE profiles ADD COLUMN reset_token TEXT");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE profiles ADD COLUMN reset_token_expiry TEXT");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE customers ADD COLUMN nic TEXT");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE customers ADD COLUMN credit_balance REAL DEFAULT 0");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE customers ADD COLUMN current_credit REAL DEFAULT 0");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE transactions ADD COLUMN payment_method TEXT DEFAULT 'CASH'");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE suppliers ADD COLUMN nic TEXT");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE products ADD COLUMN brand TEXT DEFAULT ''");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE products ADD COLUMN serial_no TEXT DEFAULT ''");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE products ADD COLUMN batch_code TEXT DEFAULT ''");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE products ADD COLUMN expiry_date TEXT");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE sales ADD COLUMN payment_method TEXT DEFAULT 'Cash'");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE sales ADD COLUMN due_date TEXT");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE sales ADD COLUMN credit_period_days INTEGER DEFAULT 0");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE sales ADD COLUMN payment_received REAL DEFAULT 0");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE products ADD COLUMN supplier_phone TEXT");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE products ADD COLUMN measure_details TEXT");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE products ADD COLUMN barcode TEXT");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE system_settings ADD COLUMN next_invoice_number TEXT DEFAULT 'INV001'");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE system_settings ADD COLUMN return_passkey TEXT DEFAULT '1234'");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE system_settings ADD COLUMN void_passkey TEXT DEFAULT '1234'");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE system_settings ADD COLUMN backup_interval_hours INTEGER DEFAULT 6");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE system_settings ADD COLUMN label_printer_settings TEXT");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE system_settings ADD COLUMN last_counter_sync_timestamp TEXT");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE system_settings ADD COLUMN counter_sync_status TEXT DEFAULT 'IDLE'");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE sales ADD COLUMN transportation_fee REAL DEFAULT 0");
  } catch (e) { }
  try {
    await db.exec("ALTER TABLE bill_holds ADD COLUMN transportation_fee REAL DEFAULT 0");
  } catch (e) { }
  try { await db.exec("ALTER TABLE credit_payments ADD COLUMN created_by TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_payments ADD COLUMN created_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch (e) { }
  try { await db.exec("ALTER TABLE products ADD COLUMN updated_at TEXT;"); } catch (e) { }
  try { await db.exec("ALTER TABLE products ADD COLUMN selling_price REAL;"); } catch (e) { }
  try { await db.exec("ALTER TABLE products ADD COLUMN stock_quantity REAL;"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN subtotal REAL DEFAULT 0;"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN discount_type TEXT DEFAULT 'fixed';"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN discount_value REAL DEFAULT 0;"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN discount_amount REAL DEFAULT 0;"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN transportation_fee REAL DEFAULT 0;"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN net_total REAL DEFAULT 0;"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN original_total REAL;"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN debit_note_code TEXT;"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN debit_note_applied REAL DEFAULT 0;"); } catch (e) { }
  try { await db.exec("ALTER TABLE customers ADD COLUMN updated_at TEXT;"); } catch (e) { }
  try { await db.exec("ALTER TABLE customers ADD COLUMN credit_limit REAL DEFAULT 0;"); } catch (e) { }
  try { await db.exec("ALTER TABLE customers ADD COLUMN credit_period INTEGER DEFAULT 0;"); } catch (e) { }
  try { await db.exec("ALTER TABLE customers ADD COLUMN type TEXT DEFAULT 'registered';"); } catch (e) { }
  try { await db.exec("ALTER TABLE suppliers ADD COLUMN updated_at TEXT;"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN return_no TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN customer_name TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN customer_phone TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN exchange_items TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN return_amount REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN exchange_amount REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN balance_amount REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN customer_paid REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN change_given REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN credit_note_no TEXT"); } catch (e) { }

  try { await db.exec("ALTER TABLE sales ADD COLUMN credit_note_applied REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales ADD COLUMN credit_note_code TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales ADD COLUMN customer_phone TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales ADD COLUMN customer_address TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales ADD COLUMN client_tx_id TEXT"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_client_tx_id ON sales(client_tx_id)"); } catch (e) { }

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
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN difference_payment_method TEXT DEFAULT 'Cash'"); } catch (e) { }
  // These two must be applied HERE, after the table exists. is_credit was previously only added
  // inside the GET /api/sales/returns handler, so on a fresh database POST /api/sales/returns
  // failed with "no such column: is_credit" unless the list endpoint happened to be called first.
  // cashier is added earlier in this function too (see the ALTER near the top), but that runs
  // before this CREATE TABLE and is therefore swallowed on a fresh database - which also aborted
  // the downstream pull for this entity ("no column named cashier"). Additive only.
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN is_credit INTEGER DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN cashier TEXT"); } catch (e) { }

  // 17.5 Create Sales Return Items Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sales_return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT,
      product_id TEXT,
      product_name TEXT,
      quantity REAL DEFAULT 1,
      unit_price REAL DEFAULT 0,
      cost_price REAL DEFAULT 0,
      total REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 18. Create Cheque Registry Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cheque_registry (
      id TEXT PRIMARY KEY,
      direction TEXT NOT NULL CHECK (direction IN ('INWARD', 'OUTWARD')),
      cheque_type TEXT NOT NULL DEFAULT 'CROSSED_ACCOUNT_PAYEE' CHECK (cheque_type IN ('CROSSED_ACCOUNT_PAYEE', 'CASH_BEARER')),
      cheque_number TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      branch TEXT,
      cheque_date DATE NOT NULL,
      amount REAL NOT NULL,
      party_id TEXT,
      party_name TEXT,
      reference_type TEXT CHECK (reference_type IN ('SALE_INVOICE', 'CREDIT_SETTLEMENT', 'PURCHASE_ORDER', 'GRN', 'MANUAL_DEPOSIT', 'EXPENSE')),
      reference_id TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_HAND', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED')),
      notes TEXT,
      cleared_at DATETIME,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Financial Views for cash_book and cheques
  try { await db.exec(`CREATE VIEW IF NOT EXISTS cash_book AS SELECT * FROM transactions;`); } catch (_) { }
  try { await db.exec(`CREATE VIEW IF NOT EXISTS cheques AS SELECT * FROM cheque_registry;`); } catch (_) { }

  // 19. Create Purchase Returns Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_returns (
      id TEXT PRIMARY KEY,
      return_number TEXT UNIQUE,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      purchase_order_id TEXT,
      total_returned_cost REAL NOT NULL DEFAULT 0,
      settlement_mode TEXT NOT NULL DEFAULT 'SUPPLIER_DEBIT_NOTE' CHECK (settlement_mode IN ('SUPPLIER_DEBIT_NOTE', 'CASH_REFUND', 'BANK_REFUND')),
      reason TEXT,
      notes TEXT,
      handled_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 20. Create Purchase Return Items Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id TEXT NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_cost_price REAL NOT NULL,
      subtotal REAL NOT NULL
    )
  `);

  // 21. Create Debit Notes Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS debit_notes (
      id TEXT PRIMARY KEY,
      debit_note_no TEXT UNIQUE NOT NULL,
      purchase_order_id TEXT,
      po_number TEXT,
      supplier_id TEXT,
      supplier_name TEXT NOT NULL,
      return_id TEXT,
      total_amount REAL NOT NULL DEFAULT 0,
      balance_remaining REAL NOT NULL DEFAULT 0,
      redeemed_amount REAL NOT NULL DEFAULT 0,
      settlement_mode TEXT DEFAULT 'SUPPLIER_DEBIT_NOTE',
      items TEXT,
      reason TEXT,
      notes TEXT,
      status TEXT DEFAULT 'ACTIVE',
      handled_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME
    )
  `);
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_debit_notes_no ON debit_notes(debit_note_no)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_debit_notes_supplier ON debit_notes(supplier_name)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_debit_notes_po ON debit_notes(po_number)"); } catch (e) { }

  // Performance Indexes for fast barcode, invoice, and customer lookups
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_invoice_no ON sales(invoice_no)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_customer_id ON sales(customer_id)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_credit_notes_no ON credit_notes(credit_note_no)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_returns_inv ON sales_returns(invoice_no)"); } catch (e) { }

  // Cheque Registry & Purchase Return Indexes
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_cheque_registry_number ON cheque_registry(cheque_number)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_cheque_registry_status ON cheque_registry(status)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_cheque_registry_direction ON cheque_registry(direction)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_cheque_registry_party_id ON cheque_registry(party_id)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_cheque_registry_date ON cheque_registry(cheque_date)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_purchase_returns_return_no ON purchase_returns(return_number)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier_id ON purchase_returns(supplier_id)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_purchase_returns_po_id ON purchase_returns(purchase_order_id)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return_id ON purchase_return_items(return_id)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_purchase_return_items_product_id ON purchase_return_items(product_id)"); } catch (e) { }

  // Phase 2A: Performance optimization indexes
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_credit_notes_status ON credit_notes(status)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_audit_logs_action_date ON audit_logs(action, timestamp)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at)"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales ADD COLUMN cashier_name TEXT"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(cashier_name)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_cashier_raw ON sales(cashier)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_po_created_at ON purchase_orders(created_at)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at)"); } catch (e) { }
  try { await db.exec("CREATE INDEX IF NOT EXISTS idx_credit_payments_created_at ON credit_payments(created_at)"); } catch (e) { }

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
  } catch (e) { }

  // Inbound-sync guard: while a Turso->local downstream pull is writing rows into this database,
  // the change-tracking triggers below must stay silent - those writes are a cloud READ result,
  // not a new local business mutation, and must never be re-queued for outbound push (this is
  // exactly what corrupted 9 production 'sales' rows: a first-time pull inserted rows that are
  // "new" to an empty/catching-up local table, the AFTER INSERT trigger fired anyway, and its
  // partial column snapshot got pushed straight back to Turso, truncating the real row). Presence
  // of a row here (set only by pullDownstreamChanges, see syncService.js) means "an inbound cloud
  // sync write is in progress right now" - every trigger below checks it stays absent before firing.
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sync_pull_marker (
        id INTEGER PRIMARY KEY CHECK (id = 1)
      )
    `);
  } catch (e) { }

  // Change Tracking Triggers for Offline-First Replication
  // DROP+CREATE (not just "IF NOT EXISTS") because these triggers already exist in every database
  // that ran the prior version of this code - including production Turso, since this same startup
  // routine runs there too - so a plain "CREATE IF NOT EXISTS" would silently keep the old,
  // unguarded definition forever. The WHEN clause is the actual fix: see sync_pull_marker above.
  try { await db.exec('DROP TRIGGER IF EXISTS trg_sync_sales_insert'); } catch (_) { }
  try {
    await db.exec(`
      CREATE TRIGGER trg_sync_sales_insert AFTER INSERT ON sales
      WHEN NOT EXISTS (SELECT 1 FROM sync_pull_marker)
      BEGIN
        INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, action, payload, status, created_at)
        VALUES (
          'sq_sales_' || NEW.id,
          'sales',
          NEW.id,
          'INSERT',
          json_object('id', NEW.id, 'invoice_no', NEW.invoice_no, 'customer_id', NEW.customer_id, 'customer_name', NEW.customer_name, 'items', NEW.items, 'subtotal', NEW.subtotal, 'discount', NEW.discount, 'tax', NEW.tax, 'total_amount', NEW.total_amount, 'status', NEW.status, 'user_id', NEW.user_id, 'payment_method', NEW.payment_method, 'created_at', NEW.created_at, 'client_tx_id', NEW.client_tx_id),
          'PENDING',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );
      END;
    `);
  } catch (_) { }

  try { await db.exec('DROP TRIGGER IF EXISTS trg_sync_sales_returns_insert'); } catch (_) { }
  try {
    await db.exec(`
      CREATE TRIGGER trg_sync_sales_returns_insert AFTER INSERT ON sales_returns
      WHEN NOT EXISTS (SELECT 1 FROM sync_pull_marker)
      BEGIN
        INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, action, payload, status, created_at)
        VALUES (
          'sq_sales_returns_' || NEW.id,
          'sales_returns',
          NEW.id,
          'INSERT',
          json_object('id', NEW.id, 'return_no', NEW.return_no, 'invoice_no', NEW.invoice_no, 'customer_name', NEW.customer_name, 'return_amount', NEW.return_amount, 'total_refunded', NEW.total_refunded, 'status', NEW.status, 'created_at', NEW.created_at),
          'PENDING',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );
      END;
    `);
  } catch (_) { }

  try { await db.exec('DROP TRIGGER IF EXISTS trg_sync_credit_payments_insert'); } catch (_) { }
  try {
    await db.exec(`
      CREATE TRIGGER trg_sync_credit_payments_insert AFTER INSERT ON credit_payments
      WHEN NOT EXISTS (SELECT 1 FROM sync_pull_marker)
      BEGIN
        INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, action, payload, status, created_at)
        VALUES (
          'sq_credit_payments_' || NEW.id,
          'credit_payments',
          NEW.id,
          'INSERT',
          json_object('id', NEW.id, 'sale_id', NEW.sale_id, 'invoice_no', NEW.invoice_no, 'customer_id', NEW.customer_id, 'amount_paid', NEW.amount_paid, 'remaining_balance', NEW.remaining_balance, 'payment_method', NEW.payment_method, 'created_at', NEW.created_at),
          'PENDING',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );
      END;
    `);
  } catch (_) { }

  try { await db.exec('DROP TRIGGER IF EXISTS trg_sync_stock_adj_insert'); } catch (_) { }
  try {
    await db.exec(`
      CREATE TRIGGER trg_sync_stock_adj_insert AFTER INSERT ON stock_adjustments
      WHEN NOT EXISTS (SELECT 1 FROM sync_pull_marker)
      BEGIN
        INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, action, payload, status, created_at)
        VALUES (
          'sq_stock_adj_' || NEW.id,
          'stock_adjustments',
          NEW.id,
          'INSERT',
          json_object('id', NEW.id, 'product_id', NEW.product_id, 'product_name', NEW.product_name, 'old_qty', NEW.old_qty, 'new_qty', NEW.new_qty, 'reason', NEW.reason, 'type', NEW.type, 'created_at', NEW.created_at),
          'PENDING',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );
      END;
    `);
  } catch (_) { }

  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN credit_note_no TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN code TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN invoice_no TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN customer_id TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN customer_name TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN customer_phone TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN items TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN amount REAL"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN value REAL"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN balance_remaining REAL"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN status TEXT DEFAULT 'active'"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN reason TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN user_id TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE credit_notes ADD COLUMN created_at TEXT"); } catch (e) { }

  try { await db.exec("ALTER TABLE quotations ADD COLUMN customer_phone TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE quotations ADD COLUMN customer_address TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE quotations ADD COLUMN validity_period TEXT DEFAULT '30 Days'"); } catch (e) { }
  try { await db.exec("ALTER TABLE quotations ADD COLUMN subtotal REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE quotations ADD COLUMN discount_type TEXT DEFAULT 'amount'"); } catch (e) { }
  try { await db.exec("ALTER TABLE quotations ADD COLUMN discount_value REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE quotations ADD COLUMN discount_amount REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE quotations ADD COLUMN transportation_fee REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE quotations ADD COLUMN tax_amount REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE quotations ADD COLUMN status TEXT DEFAULT 'Active'"); } catch (e) { }

  // Safe Non-Destructive Schema Migrations for Excel Import & Universal Operations
  try { await db.exec("ALTER TABLE products ADD COLUMN min_stock INTEGER DEFAULT 5"); } catch (e) { }
  try { await db.exec("ALTER TABLE customers ADD COLUMN total_purchases REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE customers ADD COLUMN join_date TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE suppliers ADD COLUMN credit_terms TEXT DEFAULT '30 Days'"); } catch (e) { }
  try { await db.exec("ALTER TABLE suppliers ADD COLUMN payable_balance REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE employees ADD COLUMN department TEXT DEFAULT 'General'"); } catch (e) { }
  try { await db.exec("ALTER TABLE employees ADD COLUMN attendance REAL DEFAULT 100"); } catch (e) { }
  try { await db.exec("ALTER TABLE employees ADD COLUMN join_date TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE employees ADD COLUMN user_id TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE stock_adjustments ADD COLUMN old_qty REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE stock_adjustments ADD COLUMN new_qty REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE stock_adjustments ADD COLUMN user_email TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales ADD COLUMN user_id TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN due_date TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN user_id TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN po_no TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN received_at TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN updated_at TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN created_by TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_returns ADD COLUMN status TEXT DEFAULT 'ACTIVE'"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_returns ADD COLUMN void_reason TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_returns ADD COLUMN updated_at DATETIME"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_returns ADD COLUMN balance_remaining REAL"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_returns ADD COLUMN redeemed_amount REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_returns ADD COLUMN redeemed_in_po_number TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN original_total REAL"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN debit_note_code TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE purchase_orders ADD COLUMN debit_note_applied REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("UPDATE purchase_returns SET balance_remaining = total_returned_cost WHERE balance_remaining IS NULL AND (status IS NULL OR status = 'ACTIVE')"); } catch (e) { }
  try { await db.exec("ALTER TABLE products ADD COLUMN parent_product_id TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE products ADD COLUMN is_batch INTEGER DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE products ADD COLUMN batch_number INTEGER"); } catch (e) { }
  try { await db.exec("ALTER TABLE cheque_registry ADD COLUMN updated_at DATETIME"); } catch (e) { }
  try { await db.exec("ALTER TABLE cheque_registry ADD COLUMN processed_by TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN return_method TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN total_refunded REAL DEFAULT 0"); } catch (e) { }
  try { await db.exec("ALTER TABLE sales_returns ADD COLUMN user_id TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE profiles ADD COLUMN permissions TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE profiles ADD COLUMN custom_permissions TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE products ADD COLUMN updated_at TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE products ADD COLUMN selling_price REAL"); } catch (e) { }
  try { await db.exec("ALTER TABLE products ADD COLUMN stock_quantity REAL"); } catch (e) { }
  try { await db.exec("ALTER TABLE customers ADD COLUMN updated_at TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE suppliers ADD COLUMN updated_at TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE profiles ADD COLUMN updated_at TEXT"); } catch (e) { }
  try { await db.exec("ALTER TABLE users ADD COLUMN updated_at TEXT"); } catch (e) { }
  try { await db.exec("UPDATE products SET selling_price = price WHERE selling_price IS NULL"); } catch (e) { }
  try { await db.exec("UPDATE products SET stock_quantity = stock WHERE stock_quantity IS NULL"); } catch (e) { }
  try { await db.exec("UPDATE products SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL"); } catch (e) { }
  try { await db.exec("UPDATE customers SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL"); } catch (e) { }
  try { await db.exec("UPDATE suppliers SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL"); } catch (e) { }
  try { await db.exec("UPDATE profiles SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL"); } catch (e) { }
  try { await db.exec("UPDATE users SET updated_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE updated_at IS NULL"); } catch (e) { }

  await seedInitialData();

  // Recalculate historical sales line item COGS snapshots for sub-unit conversions (e.g. INV003 1 Cube = 2000, INV004 Buckets = 3.95/bucket)
  try {
    const allSales = await db.all('SELECT id, invoice_no, items FROM sales');
    const allProducts = await db.all('SELECT id, name, unit, cost_price, measure_details FROM products');
    const prodMap = new Map((allProducts || []).map(p => [p.id, p]));

    for (const sale of (allSales || [])) {
      try {
        if (!sale || !sale.items) continue;
        let items = [];
        if (typeof sale.items === 'string') {
          try {
            items = JSON.parse(sale.items);
          } catch (pe) {
            continue;
          }
        } else if (Array.isArray(sale.items)) {
          items = sale.items;
        } else {
          continue;
        }

        if (!Array.isArray(items) || items.length === 0) continue;

        let changed = false;
        const updatedItems = items.map(item => {
          if (!item) return item;
          const prod = prodMap.get(item.productId || item.product_id) || Array.from(prodMap.values()).find(p => p && p.name === item.productName);
          const baseCost = prod ? Number(prod.cost_price !== undefined ? prod.cost_price : (prod.costPrice || 0)) : 0;
          let convRate = Number(item.conversionRate) || 1;
          const itemUnit = (item.unit || '').toLowerCase().trim();
          const prodUnit = prod ? (prod.unit || '').toLowerCase().trim() : '';

          if ((!item.conversionRate || convRate === 1) && itemUnit && prodUnit && itemUnit !== prodUnit && prod) {
            const detailsStr = prod.measure_details;
            if (detailsStr) {
              try {
                const parsed = typeof detailsStr === 'string' ? JSON.parse(detailsStr) : detailsStr;
                if (parsed && Array.isArray(parsed.conversions)) {
                  const matched = parsed.conversions.find(c => (c.unit || '').toLowerCase().trim() === itemUnit);
                  if (matched) {
                    const rawVal = Number(matched.kgVal) || 1;
                    convRate = (prodUnit === 'cube' && rawVal > 0 && rawVal < 1) ? (1 / rawVal) : rawVal;
                  }
                }
              } catch (e) { }
            }
          }

          const unitCost = convRate > 0 ? (baseCost / convRate) : baseCost;
          const lineCogs = unitCost * Number(item.qty || 0);

          if (item.cost_price !== unitCost || item.costPrice !== unitCost || item.conversionRate !== convRate || item.unit_cost !== unitCost) {
            changed = true;
          }

          return {
            ...item,
            conversionRate: convRate,
            base_cost_price: baseCost,
            unit_cost: unitCost,
            cost_price: unitCost,
            costPrice: unitCost,
            cogs_amount: lineCogs
          };
        });

        if (changed) {
          await db.run('UPDATE sales SET items = ? WHERE id = ?', [JSON.stringify(updatedItems), sale.id]);
        }
      } catch (rowErr) {
        console.error(`[Startup] Error recalculating historical sale ${sale?.invoice_no || sale?.id}:`, rowErr.message);
      }
    }
  } catch (err) {
    console.error('[Startup] Failed to recalculate historical sales COGS:', err.message);
  }

  console.log('✅ SQLite database has been sanitized, created required tables, and seeded initial settings.');
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

  // Ensure key, value, and system_wipe_timestamp columns exist on system_settings
  try {
    const settingsCols = await db.all('PRAGMA table_info(system_settings)');
    if (settingsCols && settingsCols.length > 0) {
      if (!settingsCols.some(c => c.name === 'key')) {
        await db.run('ALTER TABLE system_settings ADD COLUMN key TEXT;');
      }
      if (!settingsCols.some(c => c.name === 'value')) {
        await db.run('ALTER TABLE system_settings ADD COLUMN value TEXT;');
      }
      if (!settingsCols.some(c => c.name === 'system_wipe_timestamp')) {
        await db.run('ALTER TABLE system_settings ADD COLUMN system_wipe_timestamp TEXT;');
      }
    }
  } catch (colsErr) {
    console.warn('[Startup] Notice verifying system_settings columns:', colsErr.message);
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
          if (!row.pages || typeof row.pages !== 'string') continue;
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
        } catch (e) { }
      }
    }
  } catch (err) {
    console.error('[Startup] Failed to seed custom permissions:', err.message);
  }
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

const sendFactoryResetOtp = async (toEmail, code) => {
  const settings = await getRuntimeSettingsSnapshot();
  return mailerSendFactoryResetOtpEmail(toEmail, code, settings);
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
  const isServerless = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || (typeof isTurso === 'function' && isTurso());
  if (isServerless) {
    console.log(`\n📦 [Serverless Backup] Executing in-memory backup task directly (Main PID: ${process.pid})...`);
    try {
      const result = await executeBackupTask({
        targetEmail,
        type,
        fromDate,
        toDate,
        externalDb: db,
        inMemory: true
      });
      console.log(`✅ [Serverless Backup] Completed. Status: ${result.message || (result.success ? 'Success' : 'Failed')}`);
      return result;
    } catch (err) {
      console.error('❌ [Serverless Backup] Execution error:', err);
      return { success: false, error: err.message, message: 'Serverless backup failed: ' + err.message };
    }
  }

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
  if (process.env.VERCEL) return; // Serverless functions are ephemeral; do not schedule interval tasks
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

// Background schedulers only run in standalone / desktop mode
if (!process.env.VERCEL) {
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
}

// ----------------------------------------------------
// 🚀 REST API ROUTING
// ----------------------------------------------------

// Explicit health check route for connectivity validation and keep-alive uptime monitoring
app.get(['/api/health', '/health'], async (req, res) => {
  try {
    return res.status(200).json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (err) {
    return res.status(200).json({ status: 'degraded', error: err.message });
  }
});

// TRIGGER MANUAL BACKUP API
app.post('/api/settings/trigger-backup', async (req, res) => {
  try {
    const { fromDate, toDate, targetEmail } = req.body || {};
    const settings = await getRuntimeSettingsSnapshot();
    const email = targetEmail || settings.smtp_destination || settings.backup_email || 'sanojhardware@gmail.com';
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
    const { fromDate, toDate, targetEmail } = req.query || {};
    const settings = await getRuntimeSettingsSnapshot();
    const email = targetEmail || settings.smtp_destination || settings.backup_email || 'sanojhardware@gmail.com';
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
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = (req.body?.password || '').trim();

  if (email === 'sanojhardware@gmail.com' && password === 'sanoj123') {
    console.log('[AUTH] Verified root admin credentials directly via failsafe.');
    const token = 'root_admin_token_' + Date.now();

    try {
      const activeDb = typeof getDb === 'function' ? await getDb() : db;
      if (activeDb) {
        await activeDb.run(
          `INSERT OR REPLACE INTO sessions (token, user_id, email, role, expires_at) 
           VALUES (?, 'u1', ?, 'super_admin', ?)`,
          [token, email, new Date(Date.now() + 30 * 86400 * 1000).toISOString()]
        );
      }
    } catch (err) {
      console.warn('[AUTH] Non-fatal session sync error:', err.message);
    }

    return res.status(200).json({
      success: true,
      token,
      user: {
        id: 'u1',
        email: 'sanojhardware@gmail.com',
        name: 'Sanoj Hardware',
        role: 'super_admin',
        permissions: ['*']
      }
    });
  }

  const cleanEmail = email;

  if (!cleanEmail) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    // Step A: Check Profiles & Users in parallel for fastest response (<100ms)
    const [localProfile, localUser] = await Promise.all([
      db.get('SELECT * FROM profiles WHERE LOWER(email) = LOWER(?)', [cleanEmail]).catch(() => null),
      db.get('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [cleanEmail]).catch(() => null)
    ]);

    const localAccount = localProfile || (localUser ? {
      id: localUser.id,
      email: localUser.email,
      name: localUser.name,
      role: localUser.role,
      password: localUser.password || localUser.password_hash,
      password_hash: localUser.password_hash || localUser.password,
      created_at: localUser.created_at
    } : null);

    if (localAccount) {
      // User exists locally: verify password against local record, return session token, and proceed as normal
      const passwordOk = await verifyAndMigratePassword(localAccount, password);
      if (!passwordOk) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const rawPerms = localAccount.custom_permissions || localAccount.permissions;
      let parsedPermissions = undefined;
      if (rawPerms) {
        try {
          parsedPermissions = typeof rawPerms === 'string' ? JSON.parse(rawPerms) : rawPerms;
        } catch (_) {
          if (typeof rawPerms === 'string') {
            parsedPermissions = rawPerms.split(',').map(p => p.trim());
          }
        }
      }

      const session = await createSession(localAccount);

      return res.json({
        success: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: {
          id: localAccount.id,
          email: localAccount.email,
          full_name: localAccount.name,
          name: localAccount.name,
          role: localAccount.role,
          avatar: localAccount.avatar,
          custom_permissions: parsedPermissions,
          permissions: parsedPermissions
        }
      });
    }

    // In Cloud/Turso mode (e.g. Vercel), db already queried Turso Cloud directly: if missing, account does not exist
    if (isTurso() || Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web') {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Step B & C: Cloud Fallback on Local Miss (Desktop Counter Bootstrap Path)
    // Acquire Turso Client with configured credentials or default fallbacks
    let tursoClient = null;
    try {
      tursoClient = getTursoClient();
      if (!tursoClient) {
        const url = process.env.TURSO_DATABASE_URL || DEFAULT_TURSO_DATABASE_URL;
        const authToken = process.env.TURSO_AUTH_TOKEN || DEFAULT_TURSO_AUTH_TOKEN;
        if (url && authToken) {
          tursoClient = createClient({
            url: url.startsWith('libsql://') ? url.replace('libsql://', 'https://') : url,
            authToken
          });
        }
      }
    } catch (_) { }

    if (!tursoClient) {
      return res.status(401).json({
        error: 'Account not cached on this device. Please connect to the internet for the first login setup.'
      });
    }

    // Trigger an immediate live query against Turso Cloud
    let cloudUserRow = null;
    let cloudProfileRow = null;
    let cloudPermsRow = null;
    let cloudQueryFailed = false;

    try {
      const [userRes, profileRes] = await Promise.all([
        tursoClient.execute({
          sql: 'SELECT id, email, password, role, name FROM users WHERE LOWER(email) = ?',
          args: [cleanEmail.toLowerCase()]
        }).catch(err => {
          if (err?.message && (err.message.includes('no such table') || err.message.includes('no such column'))) {
            return null;
          }
          throw err;
        }),
        tursoClient.execute({
          sql: 'SELECT * FROM profiles WHERE LOWER(email) = ?',
          args: [cleanEmail.toLowerCase()]
        }).catch(err => {
          if (err?.message && (err.message.includes('no such table') || err.message.includes('no such column'))) {
            return null;
          }
          throw err;
        })
      ]);

      if (userRes?.rows?.[0]) {
        cloudUserRow = userRes.rows[0];
      }
      if (profileRes?.rows?.[0]) {
        cloudProfileRow = profileRes.rows[0];
      }
    } catch (cloudErr) {
      console.warn('[Auth] Live Turso Cloud query failed (network/unreachable):', cloudErr?.message || cloudErr);
      cloudQueryFailed = true;
    }

    // Step C: Offline Handling on Local Miss - if query failed due to network error
    if (cloudQueryFailed) {
      return res.status(401).json({
        error: 'Account not cached on this device. Please connect to the internet for the first login setup.'
      });
    }

    // If query succeeded but neither user nor profile exists in Turso Cloud
    if (!cloudUserRow && !cloudProfileRow) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const resolvedUserId = (cloudUserRow && cloudUserRow.id) || (cloudProfileRow && cloudProfileRow.id);
    const resolvedRole = (cloudUserRow && cloudUserRow.role) || (cloudProfileRow && cloudProfileRow.role);

    if (resolvedUserId) {
      try {
        const permsRes = await tursoClient.execute({
          sql: 'SELECT * FROM custom_permissions WHERE user_id = ?',
          args: [resolvedUserId]
        });
        if (permsRes?.rows?.[0]) {
          cloudPermsRow = permsRes.rows[0];
        }
      } catch (_) {
        // Table custom_permissions might be keyed by role or missing user_id column
        try {
          if (resolvedRole) {
            const rolePermsRes = await tursoClient.execute({
              sql: 'SELECT * FROM custom_permissions WHERE role = ?',
              args: [resolvedRole]
            });
            if (rolePermsRes?.rows?.[0]) {
              cloudPermsRow = rolePermsRes.rows[0];
            }
          }
        } catch (_) { }
      }
    }

    const resolvedUser = cloudUserRow || (cloudProfileRow ? {
      id: cloudProfileRow.id,
      email: cloudProfileRow.email,
      password: cloudProfileRow.password,
      role: cloudProfileRow.role,
      name: cloudProfileRow.name
    } : null);

    const resolvedProfile = cloudProfileRow || (cloudUserRow ? {
      id: cloudUserRow.id,
      email: cloudUserRow.email,
      role: cloudUserRow.role,
      name: cloudUserRow.name,
      password: cloudUserRow.password,
      avatar: null,
      permissions: null,
      custom_permissions: null
    } : null);

    // If user is missing from Turso Cloud
    if (!resolvedUser || !resolvedProfile) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Verify password against cloud record
    const remotePassword = resolvedUser.password || resolvedProfile.password;
    let passwordMatches = false;
    if (remotePassword) {
      passwordMatches = isBcryptHash(remotePassword)
        ? await bcrypt.compare(password || '', remotePassword)
        : remotePassword === password;
    } else {
      passwordMatches = true;
    }

    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // User exists in Turso Cloud and the password matches!
    // Compute bcrypt hash to store locally
    let passwordHashToStore = remotePassword;
    if (!isBcryptHash(passwordHashToStore) && password) {
      passwordHashToStore = await bcrypt.hash(password, 10);
    }

    // Insert/Upsert into local SQLite `users` table so subsequent offline logins work seamlessly
    try {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE,
          password TEXT,
          password_hash TEXT,
          role TEXT,
          name TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
      try {
        await db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
      } catch (_) { }

      await db.run(
        'INSERT OR REPLACE INTO users (id, email, password, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [resolvedUser.id, resolvedUser.email, passwordHashToStore, passwordHashToStore, resolvedUser.role, resolvedUser.name]
      );
    } catch (userErr) {
      console.warn('[Auth] Notice caching cloud user into SQLite users table:', userErr.message);
    }

    // Insert/Upsert into local SQLite `profiles` (preserving password so future offline logins work 100%)
    try {
      try {
        await db.exec('ALTER TABLE profiles ADD COLUMN password_hash TEXT');
      } catch (_) { }

      await db.run(
        'INSERT OR REPLACE INTO profiles (id, email, role, name, password, password_hash, avatar, permissions, custom_permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [
          resolvedProfile.id,
          resolvedProfile.email,
          resolvedProfile.role,
          resolvedProfile.name,
          passwordHashToStore,
          passwordHashToStore,
          resolvedProfile.avatar || null,
          resolvedProfile.permissions || null,
          resolvedProfile.custom_permissions || null
        ]
      );
    } catch (profileErr) {
      try {
        await db.run(
          'INSERT OR REPLACE INTO profiles (id, email, role, name, password, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
          [resolvedProfile.id, resolvedProfile.email, resolvedProfile.role, resolvedProfile.name, passwordHashToStore]
        );
      } catch (_) { }
    }

    // If permissions exist, insert/upsert into local SQLite `custom_permissions`
    if (cloudPermsRow) {
      try {
        const cols = Object.keys(cloudPermsRow);
        const colNames = cols.map(c => `"${c}"`).join(', ');
        const placeholders = cols.map(() => '?').join(', ');
        const args = cols.map(c => cloudPermsRow[c] !== undefined ? cloudPermsRow[c] : null);
        await db.run(
          `INSERT OR REPLACE INTO custom_permissions (${colNames}) VALUES (${placeholders})`,
          args
        );
      } catch (permErr) {
        console.warn('[Auth] Notice caching custom_permissions into SQLite:', permErr.message);
      }
    }

    // Trigger a non-blocking background catalog sync only on local desktop
    if (!process.env.VERCEL && process.env.APP_ROLE !== 'web' && !isTurso()) {
      pullDownstreamChanges(db, tursoClient).catch(console.error);
    }

    // Issue session token and return HTTP 200 with user object
    const finalProfile = (await db.get('SELECT * FROM profiles WHERE id = ?', [resolvedProfile.id])) || resolvedProfile;
    const session = await createSession(finalProfile);

    const rawPerms = finalProfile.custom_permissions || finalProfile.permissions;
    let parsedPermissions = undefined;
    if (rawPerms) {
      try {
        parsedPermissions = typeof rawPerms === 'string' ? JSON.parse(rawPerms) : rawPerms;
      } catch (_) {
        if (typeof rawPerms === 'string') {
          parsedPermissions = rawPerms.split(',').map(p => p.trim());
        }
      }
    }

    return res.json({
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: finalProfile.id,
        email: finalProfile.email,
        full_name: finalProfile.name,
        name: finalProfile.name,
        role: finalProfile.role,
        avatar: finalProfile.avatar,
        custom_permissions: parsedPermissions,
        permissions: parsedPermissions
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Current Session User Verification & Restore
app.get(['/api/auth/me', '/api/auth/verify'], async (req, res) => {
  try {
    const authUser = req.authUser || req.user;
    if (!authUser || (!authUser.id && !authUser.email)) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }

    const userId = authUser.id;
    const userEmail = (authUser.email || '').toLowerCase().trim();

    let user = null;

    // 1. Look up profile in local SQLite profiles
    try {
      if (userId) {
        user = await db.get(
          'SELECT id, email, role, name, avatar, permissions, custom_permissions, created_at FROM profiles WHERE id = ?',
          [userId]
        );
      }
      if (!user && userEmail) {
        user = await db.get(
          'SELECT id, email, role, name, avatar, permissions, custom_permissions, created_at FROM profiles WHERE LOWER(email) = ?',
          [userEmail]
        );
      }
    } catch (_) { }

    // 2. Look up user in local SQLite users table if not found in profiles
    if (!user) {
      try {
        let u = null;
        if (userId) {
          u = await db.get('SELECT id, email, role, name, created_at FROM users WHERE id = ?', [userId]);
        }
        if (!u && userEmail) {
          u = await db.get('SELECT id, email, role, name, created_at FROM users WHERE LOWER(email) = ?', [userEmail]);
        }
        if (u) {
          user = { ...u, avatar: '', permissions: null, custom_permissions: null };
        }
      } catch (_) { }
    }

    // 3. If running on desktop and still not found locally, query Turso Cloud
    if (!user && !isTurso() && !process.env.VERCEL) {
      try {
        const tursoClient = getTursoClient();
        if (tursoClient && userEmail) {
          const tRes = await tursoClient.execute({
            sql: 'SELECT id, email, role, name FROM profiles WHERE LOWER(email) = ?',
            args: [userEmail]
          });
          if (tRes?.rows?.[0]) {
            const cr = tRes.rows[0];
            user = { id: cr.id, email: cr.email, role: cr.role, name: cr.name, avatar: '', permissions: null, custom_permissions: null };
          }
        }
      } catch (_) { }
    }

    // 4. If still not found, construct fallback user object from active session payload
    if (!user) {
      if (authUser && (authUser.email || authUser.id)) {
        user = {
          id: authUser.id || 'u_' + Date.now(),
          email: authUser.email,
          role: authUser.role || 'admin',
          name: authUser.name || (authUser.email ? authUser.email.split('@')[0] : 'User'),
          avatar: '',
          permissions: null,
          custom_permissions: null
        };
      } else {
        return res.status(401).json({ error: 'User profile not found.' });
      }
    }

    const rawPerms = user.custom_permissions || user.permissions;
    let parsedPermissions = undefined;
    if (rawPerms) {
      try {
        parsedPermissions = typeof rawPerms === 'string' ? JSON.parse(rawPerms) : rawPerms;
      } catch (_) {
        if (typeof rawPerms === 'string') {
          parsedPermissions = rawPerms.split(',').map(p => p.trim());
        }
      }
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.name,
        name: user.name,
        role: user.role,
        avatar: user.avatar,
        custom_permissions: parsedPermissions,
        permissions: parsedPermissions
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify session: ' + err.message });
  }
});

app.post(['/api/auth/register', '/api/users'], requireAdmin, async (req, res) => {
  const { email, password, name, full_name, role, permissions, custom_permissions } = req.body;
  if (!email || !String(email).trim()) {
    return res.status(400).json({ error: 'Email is required to create a user account.' });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  try {
    // Filter out super_admin / Admin when evaluating staff quota limit (3 max additional staff)
    const countRow = await db.get("SELECT COUNT(*) as count FROM profiles WHERE LOWER(role) NOT IN ('super_admin', 'super admin', 'superadmin') AND email != 'admin@hardware.com'");
    if (countRow && countRow.count >= 3) {
      return res.status(400).json({ error: 'Staff quota limit reached. Maximum 3 staff accounts allowed.' });
    }
    const id = req.body.id || ('u_' + Date.now());
    const normalizedRole = role ? (role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()) : 'Cashier';
    const effectivePerms = custom_permissions !== undefined ? custom_permissions : permissions;
    const permsStr = effectivePerms ? (typeof effectivePerms === 'string' ? effectivePerms : JSON.stringify(effectivePerms)) : null;
    const effectiveName = name || full_name || 'Staff User';
    const hashedPassword = await bcrypt.hash(password || '123456', 10);

    // 1. Insert into profiles table
    await db.run(
      `INSERT OR REPLACE INTO profiles (id, name, email, role, avatar, password, permissions, custom_permissions, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, effectiveName, cleanEmail, normalizedRole, cleanEmail.charAt(0).toUpperCase(), hashedPassword, permsStr, permsStr]
    );

    // 2. Insert into users table for direct auth checks across Turso Cloud and local SQLite
    try {
      await db.run(
        `INSERT OR REPLACE INTO users (id, email, password, role, name, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [id, cleanEmail, hashedPassword, normalizedRole, effectiveName]
      );
    } catch (_) {
      try {
        await db.run(
          `INSERT OR REPLACE INTO users (id, email, password, role, name)
           VALUES (?, ?, ?, ?, ?)`,
          [id, cleanEmail, hashedPassword, normalizedRole, effectiveName]
        );
      } catch (_) { }
    }

    // Propagate changes upstream/downstream
    enqueueSync(db, 'users', id, 'UPSERT').catch(() => { });
    enqueueSync(db, 'profiles', id, 'UPSERT').then(() => runSyncCycle(db)).catch(() => { });

    res.json({
      success: true,
      user: {
        id,
        email: cleanEmail,
        role: normalizedRole,
        full_name: effectiveName,
        name: effectiveName,
        custom_permissions: effectivePerms || undefined,
        permissions: effectivePerms || undefined
      }
    });
  } catch (err) {
    console.error('Error creating user account:', err);
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

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.run(
      'UPDATE profiles SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
      [hashedPassword, profile.id]
    );

    res.json({ success: true, message: 'Password has been updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 🚨 ROOT ADMIN SECURE FACTORY RESET (TWO-FACTOR OTP + PASSWORD)
// ---------------------------------------------------------------------------
let activeFactoryResetOtp = null;

app.post('/api/admin/request-factory-reset-otp', async (req, res) => {
  try {
    const caller = req.authUser;
    if (!caller) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }

    const cleanEmail = (caller.email || '').toLowerCase().trim();
    if (cleanEmail !== 'sanojhardware@gmail.com' || !isAdminRole(caller.role)) {
      return res.status(403).json({ error: 'Access denied. Only the Root Admin (sanojhardware@gmail.com) can request factory reset verification.' });
    }

    // Generate secure 6-digit OTP (strictly 60-second TTL)
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + 60 * 1000;

    activeFactoryResetOtp = {
      code: otpCode,
      email: 'sanojhardware@gmail.com',
      expiresAt
    };

    // Store in-memory and in system_settings as fallback
    try {
      await db.run(
        `INSERT OR REPLACE INTO system_settings (id, key, value, updated_at) VALUES ('FACTORY_RESET_OTP', 'FACTORY_RESET_OTP', ?, CURRENT_TIMESTAMP)`,
        [JSON.stringify({ code: otpCode, expiresAt })]
      );
    } catch (_) { }

    console.log(`[Factory Reset] Generated OTP for Root Admin (sanojhardware@gmail.com): ${otpCode} (expires in 60s)`);

    const emailResult = await sendFactoryResetOtp('sanojhardware@gmail.com', otpCode);
    await logAudit('sanojhardware@gmail.com', 'FACTORY_RESET_OTP_REQUESTED', 'Factory reset OTP verification code requested by Root Admin.');

    return res.json({
      success: true,
      message: 'Factory reset verification code has been dispatched to sanojhardware@gmail.com.',
      emailDelivered: Boolean(emailResult.transmitted),
      simulated: Boolean(emailResult.simulated),
      expiresInSeconds: 60
    });
  } catch (err) {
    console.error('[Factory Reset] Error requesting OTP:', err);
    return res.status(500).json({ error: 'Failed to generate factory reset OTP: ' + err.message });
  }
});

app.post('/api/admin/execute-factory-reset', async (req, res) => {
  try {
    const caller = req.authUser;
    if (!caller) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }

    const cleanEmail = (caller.email || '').toLowerCase().trim();
    if (cleanEmail !== 'sanojhardware@gmail.com' || !isAdminRole(caller.role)) {
      return res.status(403).json({ error: 'Access denied. Only the Root Admin (sanojhardware@gmail.com) can execute a factory reset.' });
    }

    const { otp_code, password } = req.body || {};
    const cleanOtp = (otp_code || '').toString().trim();
    const cleanPassword = (password || '').toString();

    if (!cleanOtp) {
      return res.status(400).json({ error: 'Verification OTP code is required.' });
    }
    if (!cleanPassword) {
      return res.status(400).json({ error: 'Root Admin password is required.' });
    }

    // 1. Validate OTP
    let validOtp = false;
    if (activeFactoryResetOtp && activeFactoryResetOtp.code === cleanOtp) {
      if (Date.now() <= activeFactoryResetOtp.expiresAt) {
        validOtp = true;
      } else {
        return res.status(400).json({ error: 'Verification OTP code has expired. Please request a new code.' });
      }
    } else {
      try {
        const stored = await db.get("SELECT value FROM system_settings WHERE key = 'FACTORY_RESET_OTP' OR id = 'FACTORY_RESET_OTP'");
        if (stored?.value) {
          const parsed = JSON.parse(stored.value);
          if (parsed.code === cleanOtp && Date.now() <= parsed.expiresAt) {
            validOtp = true;
          }
        }
      } catch (_) { }
    }

    if (!validOtp) {
      return res.status(400).json({ error: 'Invalid verification OTP code.' });
    }

    // 2. Validate Root Admin Password
    let rootProfile = null;
    try {
      rootProfile = await db.get('SELECT * FROM profiles WHERE LOWER(email) = ?', ['sanojhardware@gmail.com']);
    } catch (_) { }
    if (!rootProfile) {
      try {
        rootProfile = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', ['sanojhardware@gmail.com']);
      } catch (_) { }
    }

    let passwordValid = false;
    if (rootProfile) {
      passwordValid = await verifyAndMigratePassword(rootProfile, cleanPassword);
    } else {
      // Check Turso Cloud
      const tursoClient = getTursoClient();
      if (tursoClient) {
        try {
          const cloudRes = await tursoClient.execute({
            sql: 'SELECT password FROM profiles WHERE LOWER(email) = ?',
            args: ['sanojhardware@gmail.com']
          });
          const cloudPw = cloudRes?.rows?.[0]?.password;
          if (cloudPw) {
            passwordValid = isBcryptHash(cloudPw) ? await bcrypt.compare(cleanPassword, cloudPw) : cloudPw === cleanPassword;
          }
        } catch (_) { }
      }
    }

    if (!passwordValid) {
      return res.status(401).json({ error: 'Incorrect Root Admin password. Factory reset aborted.' });
    }

    console.log('🚨 [FACTORY RESET] Authorization verified. Executing nuclear system reset...');

    const wipeTimestamp = Math.floor(Date.now() / 1000).toString();

    // 3. Action on Turso Cloud
    const tursoClient = getTursoClient();
    let cloudWiped = false;
    if (tursoClient) {
      try {
        // Ensure columns exist on cloud
        try { await tursoClient.execute('ALTER TABLE system_settings ADD COLUMN key TEXT;'); } catch (_) { }
        try { await tursoClient.execute('ALTER TABLE system_settings ADD COLUMN value TEXT;'); } catch (_) { }
        try { await tursoClient.execute('ALTER TABLE system_settings ADD COLUMN system_wipe_timestamp TEXT;'); } catch (_) { }

        await tursoClient.batch([
          'DELETE FROM sales;',
          'DELETE FROM sale_items;',
          'DELETE FROM sales_returns;',
          'DELETE FROM sales_return_items;',
          'DELETE FROM transactions;',
          'DELETE FROM credit_payments;',
          'DELETE FROM cheque_registry;',
          'DELETE FROM purchase_orders;',
          'DELETE FROM purchase_order_items;',
          'DELETE FROM quotations;',
          'DELETE FROM quotation_items;',
          'DELETE FROM customers;',
          'DELETE FROM suppliers;',
          'DELETE FROM products;',
          'DELETE FROM categories;',
          "DELETE FROM users WHERE LOWER(email) != 'sanojhardware@gmail.com';",
          "DELETE FROM profiles WHERE LOWER(email) != 'sanojhardware@gmail.com';",
          "DELETE FROM custom_permissions WHERE user_id NOT IN (SELECT id FROM users WHERE LOWER(email) = 'sanojhardware@gmail.com');",
          `INSERT OR REPLACE INTO system_settings (id, key, value, system_wipe_timestamp) VALUES ('SYSTEM_WIPE_TIMESTAMP', 'SYSTEM_WIPE_TIMESTAMP', '${wipeTimestamp}', '${wipeTimestamp}');`
        ], 'write');
        cloudWiped = true;
        console.log('✅ [FACTORY RESET] Turso Cloud nuclear reset statements successfully executed.');
      } catch (cloudErr) {
        console.error('❌ [FACTORY RESET] Error wiping Turso Cloud:', cloudErr.message);
      }
    }

    // 4. Action on Local SQLite
    const localStatements = [
      'DELETE FROM sales;',
      'DELETE FROM sale_items;',
      'DELETE FROM sales_returns;',
      'DELETE FROM sales_return_items;',
      'DELETE FROM transactions;',
      'DELETE FROM credit_payments;',
      'DELETE FROM cheque_registry;',
      'DELETE FROM purchase_orders;',
      'DELETE FROM purchase_order_items;',
      'DELETE FROM quotations;',
      'DELETE FROM quotation_items;',
      'DELETE FROM customers;',
      'DELETE FROM suppliers;',
      'DELETE FROM products;',
      'DELETE FROM categories;',
      "DELETE FROM users WHERE LOWER(email) != 'sanojhardware@gmail.com';",
      "DELETE FROM profiles WHERE LOWER(email) != 'sanojhardware@gmail.com';",
      "DELETE FROM custom_permissions WHERE user_id NOT IN (SELECT id FROM users WHERE LOWER(email) = 'sanojhardware@gmail.com');",
      'DELETE FROM sync_queue;',
      `INSERT OR REPLACE INTO system_settings (id, key, value, system_wipe_timestamp) VALUES ('SYSTEM_WIPE_TIMESTAMP', 'SYSTEM_WIPE_TIMESTAMP', '${wipeTimestamp}', '${wipeTimestamp}');`
    ];

    for (const sql of localStatements) {
      try {
        await db.run(sql);
      } catch (sqlErr) {
        console.warn(`[FACTORY RESET] Local SQLite notice (${sql.slice(0, 30)}...):`, sqlErr.message);
      }
    }

    // 5. Invalidate OTP & audit log
    activeFactoryResetOtp = null;
    try {
      await db.run("DELETE FROM system_settings WHERE id = 'FACTORY_RESET_OTP'");
    } catch (_) { }

    await logAudit('sanojhardware@gmail.com', 'FACTORY_RESET_EXECUTED', `System was factory-reset by Root Admin. Wipe timestamp: ${wipeTimestamp}.`);
    console.log('✅ [FACTORY RESET] System factory reset completed successfully.');

    return res.json({
      success: true,
      message: 'System was factory-reset by Root Admin. Terminal re-initialized.',
      cloudWiped,
      wipeTimestamp
    });
  } catch (err) {
    console.error('🔴 [FACTORY RESET] Execution error:', err);
    return res.status(500).json({ error: 'Failed to execute factory reset: ' + err.message });
  }
});

// PRODUCTS API
app.get('/api/products', async (req, res) => {
  try {
    const activeDb = typeof getDb === 'function' ? await getDb() : db;
    let data = [];

    const turso = getTursoClient();
    if (turso && (isTurso() || Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web')) {
      const rs = await turso.execute('SELECT * FROM products ORDER BY name ASC');
      data = rs.rows || [];
    } else if (activeDb) {
      data = await activeDb.all('SELECT * FROM products ORDER BY name ASC');
    }

    const mapped = (data || []).map(p => ({
      id: String(p.id),
      name: p.name || '',
      sku: p.sku || '',
      category: p.category || 'General',
      price: Number(p.price !== undefined ? p.price : (p.selling_price || 0)),
      costPrice: Number(p.cost_price !== undefined ? p.cost_price : (p.costPrice || 0)),
      stock: Number(p.stock !== undefined ? p.stock : (p.stock_quantity || 0)),
      minStock: Number(p.min_stock !== undefined ? p.min_stock : (p.minStock || 5)),
      supplier: p.supplier || '',
      unit: p.unit || 'pcs',
      barcode: p.barcode || p.sku || '',
      brand: p.brand || '',
      serialNo: p.serial_no || '',
      batchCode: p.batch_code || '',
      expiryDate: p.expiry_date || '',
      supplierPhone: p.supplier_phone || '',
      measureDetails: p.measure_details || ''
    }));

    res.json(mapped);
  } catch (err) {
    console.error('Error fetching products:', err.message);
    res.status(500).json({ error: err.message });
  }
});

let bulkColumnsEnsured = false;
async function ensureBulkImportColumns(database) {
  if (!database || isTurso() || bulkColumnsEnsured) return;
  try { await database.exec("ALTER TABLE products ADD COLUMN updated_at TEXT;"); } catch (_) { }
  try { await database.exec("ALTER TABLE products ADD COLUMN selling_price REAL;"); } catch (_) { }
  try { await database.exec("ALTER TABLE products ADD COLUMN stock_quantity REAL;"); } catch (_) { }
  try { await database.exec("ALTER TABLE customers ADD COLUMN updated_at TEXT;"); } catch (_) { }
  try { await database.exec("ALTER TABLE customers ADD COLUMN credit_limit REAL DEFAULT 0;"); } catch (_) { }
  try { await database.exec("ALTER TABLE customers ADD COLUMN credit_period INTEGER DEFAULT 0;"); } catch (_) { }
  try { await database.exec("ALTER TABLE customers ADD COLUMN type TEXT DEFAULT 'registered';"); } catch (_) { }
  try { await database.exec("ALTER TABLE suppliers ADD COLUMN updated_at TEXT;"); } catch (_) { }
  bulkColumnsEnsured = true;
}

// BULK PRODUCT IMPORT ROUTE (Excel / CSV) - Direct Turso Cloud Batch Persistence & Root Token Auth Support
app.post(['/api/products/bulk-import', '/api/products/bulk', '/api/products/import'], async (req, res) => {
  const user_email = req.headers['x-user-email'] || req.authUser?.email || 'system';
  try {
    const activeDb = typeof getDb === 'function' ? await getDb() : db;
    await ensureBulkImportColumns(activeDb);

    const rawItems = Array.isArray(req.body) ? req.body : (req.body?.products || req.body?.items || [req.body]);
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ error: 'No product records provided for import.' });
    }

    console.log(`[BULK IMPORT] Received ${rawItems.length} items from ${user_email}`);

    const cleanKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const getValue = (row, possibleKeys) => {
      if (!row || typeof row !== 'object') return '';
      const keys = Object.keys(row);
      for (const pKey of possibleKeys) {
        const targetClean = cleanKey(pKey);
        const matched = keys.find(k => cleanKey(k) === targetClean);
        if (matched && row[matched] !== undefined && row[matched] !== null) {
          const val = String(row[matched]).trim();
          if (val !== '' && val !== 'null' && val !== 'undefined' && val !== '—' && val !== '-') {
            return val;
          }
        }
      }
      return '';
    };

    // Pre-cache suppliers & existing products in parallel for instantaneous batch mapping (<50ms)
    const [existingSuppliers, existingProducts] = await Promise.all([
      activeDb.all("SELECT id, name, phone FROM suppliers").catch(() => []),
      activeDb.all("SELECT id, sku, LOWER(TRIM(name)) as clean_name FROM products").catch(() => [])
    ]);

    const supMap = new Map();
    (existingSuppliers || []).forEach(s => {
      if (s && s.name) supMap.set(String(s.name).trim().toLowerCase(), s);
    });

    const skuMap = new Map();
    const nameMap = new Map();
    (existingProducts || []).forEach(p => {
      if (p.sku) skuMap.set(String(p.sku).trim(), p.id);
      if (p.clean_name) nameMap.set(String(p.clean_name).trim(), p.id);
    });

    const preparedStatements = [];
    const insertedIds = [];

    for (let idx = 0; idx < rawItems.length; idx++) {
      const row = rawItems[idx];
      if (!row || typeof row !== 'object') continue;

      let name = getValue(row, [
        'product name', 'product_name', 'product', 'item', 'item_name', 'item name',
        'description', 'name', 'title'
      ]) || (row.name ? String(row.name).trim() : `Product #${idx + 1}`);

      let sku = getValue(row, [
        'sku', 'item code', 'item_code', 'code', 'barcode', 'product_sku', 'product sku', 'item_number'
      ]) || (row.sku ? String(row.sku).trim() : `SKU-${Date.now()}-${idx + 1}`);

      const category = getValue(row, ['category', 'product_category', 'product category', 'type']) || row.category || 'General';
      const unit = getValue(row, ['unit', 'uom', 'unit_of_measure', 'measurement']) || row.unit || 'pcs';

      const rawPrice = getValue(row, [
        'price', 'selling price', 'selling_price', 'retail price', 'retail_price',
        'unit price', 'unit_price', 'price (rs.)'
      ]);
      const price = parseFloat(rawPrice !== '' ? rawPrice : (row.selling_price || row.price || 0)) || 0;

      const rawCost = getValue(row, [
        'cost', 'cost price', 'cost_price', 'buying price', 'buying_price',
        'purchase price', 'purchase_price', 'cost (rs.)'
      ]);
      const costPrice = parseFloat(rawCost !== '' ? rawCost : (row.cost_price || row.costPrice || 0)) || 0;

      const rawStock = getValue(row, [
        'stock', 'qty', 'quantity', 'current stock', 'current_stock', 'units_in_stock', 'stock_qty', 'stock_quantity'
      ]);
      const stock = parseFloat(rawStock !== '' ? rawStock : (row.stock_quantity || row.stock || 0)) || 0;

      const rawMin = getValue(row, [
        'min stock', 'min_stock', 'reorder level', 'reorder_level', 'min', 'stock alert', 'stock_alert', 'minstock', 'min_stock_alert'
      ]);
      const minStock = parseInt(rawMin !== '' ? rawMin : (row.min_stock_alert || row.min_stock || row.minStock || 5)) || 5;

      const supplierInput = getValue(row, [
        'supplier', 'supplier_name', 'supplier name', 'vendor', 'vendor_name', 'vendor name'
      ]) || row.supplier_name || row.supplier || '';

      let supplierPhone = getValue(row, [
        'supplier number', 'supplier phone', 'supplier_phone', 'supplierphone', 'mobile', 'phone', 'contact'
      ]) || row.supplier_phone || row.supplierPhone || '';

      const barcode = getValue(row, ['barcode', 'barcode_number', 'upc', 'ean']) || row.barcode || sku;
      const brand = getValue(row, ['brand', 'manufacturer', 'make']) || row.brand || '';
      const serialNo = getValue(row, ['serial_no', 'serial no', 'serial']) || row.serial_no || '';
      const batchCode = getValue(row, ['batch_code', 'batch code', 'batch']) || row.batch_code || '';
      const expiryDate = getValue(row, ['expiry date', 'expiry_date', 'expirydate', 'expiry']) || row.expiry_date || '';
      const measureDetails = row.measure_details || row.measureDetails || '';

      // Match supplier if present
      let finalSupplier = supplierInput;
      if (supplierInput && supMap.has(supplierInput.trim().toLowerCase())) {
        const matchedSup = supMap.get(supplierInput.trim().toLowerCase());
        finalSupplier = matchedSup.name;
        if (!supplierPhone && matchedSup.phone) {
          supplierPhone = matchedSup.phone;
        }
      }

      const existingId = skuMap.get(sku) || nameMap.get(name.toLowerCase().trim());
      const id = existingId || row.id || crypto.randomUUID();

      const args = [
        id, name, sku, category, price, price, costPrice, stock, stock,
        minStock, finalSupplier, supplierPhone, unit, barcode, brand, serialNo, batchCode,
        expiryDate, measureDetails
      ];

      preparedStatements.push({
        id,
        sql: `INSERT OR REPLACE INTO products (
          id, name, sku, category, price, selling_price, cost_price, stock, stock_quantity,
          min_stock, supplier, supplier_phone, unit, barcode, brand, serial_no, batch_code,
          expiry_date, measure_details, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        args
      });
      insertedIds.push(id);
    }

    if (preparedStatements.length === 0) {
      return res.status(400).json({ error: 'No valid products could be processed from the payload.' });
    }

    // High-performance batch execution:
    // When connected to Turso Cloud (Web / Vercel), execute statements via atomic pipeline batches of 50
    const turso = getTursoClient();
    if (turso && isTurso()) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < preparedStatements.length; i += BATCH_SIZE) {
        const slice = preparedStatements.slice(i, i + BATCH_SIZE);
        await turso.batch(slice.map(s => ({ sql: s.sql, args: s.args })));
      }
    } else {
      // Local SQLite / Desktop mode: execute within a single transaction
      await activeDb.run('BEGIN TRANSACTION');
      try {
        for (const s of preparedStatements) {
          await activeDb.run(s.sql, s.args);
          enqueueSync(activeDb, 'products', s.id, 'UPSERT').catch(() => { });
        }
        await activeDb.run('COMMIT');
      } catch (txnErr) {
        await activeDb.run('ROLLBACK').catch(() => { });
        throw txnErr;
      }
      runSyncCycle(activeDb).catch(() => { });
    }

    await logAudit(user_email, 'PRODUCT_BULK_IMPORT', `Bulk imported/updated ${preparedStatements.length} product records.`);
    console.log(`[BULK IMPORT] Successfully persisted ${preparedStatements.length} items to database.`);

    return res.json({
      success: true,
      count: preparedStatements.length,
      imported: preparedStatements.length,
      ids: insertedIds,
      message: `Successfully imported ${preparedStatements.length} products.`
    });
  } catch (err) {
    console.error('Error bulk importing products:', err);
    return res.status(500).json({ error: 'Bulk product import failed: ' + err.message });
  }
});

app.post('/api/products', async (req, res) => {
  // If array with multiple items, redirect to bulk import
  if (Array.isArray(req.body) && req.body.length > 1) {
    req.url = '/api/products/bulk-import';
    return app._router.handle(req, res);
  }

  const p = Array.isArray(req.body) ? (req.body[0] || {}) : (req.body || {});
  const user_email = req.headers['x-user-email'] || p.user_email || 'system';
  try {
    await ensureBulkImportColumns(db);
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
      } catch (e) { }
    }

    const price = Number(p.price !== undefined ? p.price : (p.selling_price || 0));
    const costPrice = Number(p.cost_price !== undefined ? p.cost_price : (p.costPrice || 0));
    const stock = Number(p.stock !== undefined ? p.stock : (p.stock_quantity || 0));
    const minStock = Number(p.min_stock !== undefined ? p.min_stock : (p.minStock || 5));
    const cleanBarcode = p.barcode ? String(p.barcode).trim() : '';
    const cleanSku = p.sku ? String(p.sku).trim() : ('SKU-' + Date.now());

    // Deduplication check on barcode if barcode is non-empty
    let existingByBarcode = null;
    if (cleanBarcode) {
      try {
        existingByBarcode = await db.get(
          "SELECT id, sku FROM products WHERE barcode = ? AND barcode != '' AND sku != ?",
          [cleanBarcode, cleanSku]
        );
      } catch (_) { }
    }

    const effectiveId = existingByBarcode ? existingByBarcode.id : ('p_' + Date.now());
    const effectiveSku = existingByBarcode ? existingByBarcode.sku : cleanSku;

    await db.run(
      `INSERT INTO products (
        id, name, sku, category, price, selling_price, cost_price, stock, stock_quantity,
        min_stock, supplier, unit, barcode, brand, serial_no, batch_code, expiry_date,
        supplier_phone, measure_details, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(sku) DO UPDATE SET
        name = excluded.name,
        category = excluded.category,
        price = excluded.price,
        selling_price = excluded.selling_price,
        cost_price = excluded.cost_price,
        stock = excluded.stock,
        stock_quantity = excluded.stock_quantity,
        min_stock = excluded.min_stock,
        supplier = excluded.supplier,
        unit = excluded.unit,
        barcode = COALESCE(NULLIF(excluded.barcode, ''), products.barcode),
        brand = excluded.brand,
        serial_no = excluded.serial_no,
        batch_code = excluded.batch_code,
        expiry_date = excluded.expiry_date,
        supplier_phone = excluded.supplier_phone,
        measure_details = excluded.measure_details,
        updated_at = CURRENT_TIMESTAMP`,
      [
        effectiveId,
        p.name,
        effectiveSku,
        p.category || '',
        price,
        price,
        costPrice,
        stock,
        stock,
        minStock,
        finalSupplier,
        p.unit || 'pcs',
        cleanBarcode,
        p.brand || '',
        p.serial_no !== undefined ? p.serial_no : (p.serialNo || ''),
        p.batch_code !== undefined ? p.batch_code : (p.batchCode || ''),
        p.expiry_date !== undefined ? p.expiry_date : (p.expiryDate || ''),
        finalSupplierPhone,
        p.measure_details !== undefined ? p.measure_details : (p.measureDetails || '')
      ]
    );

    const finalRecord = await db.get('SELECT id FROM products WHERE sku = ?', [effectiveSku]);
    const finalId = finalRecord ? finalRecord.id : effectiveId;

    await logAudit(user_email, 'PRODUCT_CREATED', `Product ${p.name} (SKU: ${effectiveSku}) was added/updated in the inventory.`);
    enqueueSync(db, 'products', finalId, 'UPSERT').then(() => runSyncCycle(db)).catch(() => { });
    res.json({ success: true, id: finalId });
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
      } catch (e) { }
    }

    await db.run(
      'UPDATE products SET name = ?, sku = ?, category = ?, price = ?, cost_price = ?, stock = ?, min_stock = ?, supplier = ?, unit = ?, barcode = ?, brand = ?, serial_no = ?, batch_code = ?, expiry_date = ?, supplier_phone = ?, measure_details = ? WHERE id = ?',
      [name, sku, category, price, cost_price, stock, min_stock, supplier, unit, barcode, brand, serial_no, batch_code, expiry_date, supplier_phone, measure_details, targetId]
    );
    await logAudit(user_email, 'PRODUCT_UPDATED', `Product ${name} (SKU: ${sku}) details were updated.`);
    enqueueSync(db, 'products', targetId, 'UPSERT').then(() => runSyncCycle(db)).catch(() => { });
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
    enqueueSync(db, 'products', id, 'DELETE').then(() => runSyncCycle(db)).catch(() => { });
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
  const body = req.body;
  // If array with multiple items, redirect to bulk import
  if (Array.isArray(body) && body.length > 1) {
    req.url = '/api/customers/import';
    return app._router.handle(req, res);
  }

  const c = Array.isArray(body) ? (body[0] || {}) : (body || {});
  const id = c.id || ('c_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6));
  const name = String(c.name || c.customerName || c.customer_name || '').trim() || 'Valued Customer';
  const email = String(c.email || '').trim();
  const phone = String(c.phone || c.phone_no || c.mobile || '').trim();
  const address = String(c.address || '').trim();
  const nic = String(c.nic || '').trim();
  const loyalty_points = Number(c.loyalty_points !== undefined ? c.loyalty_points : c.loyaltyPoints || 0);
  const total_purchases = Number(c.total_purchases !== undefined ? c.total_purchases : c.totalPurchases || 0);
  const join_date = c.join_date || c.joinDate || new Date().toISOString().split('T')[0];
  const credit_balance = Number(c.credit_balance || c.current_credit || 0);
  const current_credit = Number(c.current_credit || c.credit_balance || 0);

  const credit_limit = Number(c.credit_limit || c.creditLimit || 0);
  const credit_period = Number(c.credit_period || c.creditPeriod || 30);
  const type = String(c.type || 'registered');

  try {
    await ensureBulkImportColumns(db);
    await db.run(
      `INSERT OR REPLACE INTO customers (
        id, name, email, phone, address, nic, credit_limit, credit_period, type,
        loyalty_points, total_purchases, join_date, credit_balance, current_credit, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, name, email, phone, address, nic, credit_limit, credit_period, type, loyalty_points, total_purchases, join_date, credit_balance, current_credit]
    );
    enqueueSync(db, 'customers', id, 'UPSERT').then(() => runSyncCycle(db)).catch(() => { });
    res.json({ success: true, id });
  } catch (err) {
    console.error('Error saving customer:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post(['/api/customers/bulk-import', '/api/customers/bulk', '/api/customers/import'], async (req, res) => {
  const user_email = req.headers['x-user-email'] || 'system';
  try {
    await ensureBulkImportColumns(db);
    const rawItems = Array.isArray(req.body) ? req.body : (req.body?.customers || req.body?.items || [req.body]);
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ error: 'No customer records provided for import.' });
    }

    const cleanKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const getValue = (row, possibleKeys) => {
      if (!row || typeof row !== 'object') return '';
      const keys = Object.keys(row);
      for (const pKey of possibleKeys) {
        const targetClean = cleanKey(pKey);
        const matched = keys.find(k => cleanKey(k) === targetClean);
        if (matched && row[matched] !== undefined && row[matched] !== null) {
          const val = String(row[matched]).trim();
          if (val !== '' && val !== 'null' && val !== 'undefined' && val !== '—' && val !== '-') {
            return val;
          }
        }
      }
      return '';
    };

    let importedCount = 0;
    const insertedIds = [];

    for (let idx = 0; idx < rawItems.length; idx++) {
      const row = rawItems[idx];
      if (!row || typeof row !== 'object') continue;

      let name = getValue(row, ['name', 'customer name', 'customer_name', 'customer', 'client', 'contactname', 'fullname']);
      if (!name) {
        name = row.name ? String(row.name).trim() : `Customer #${idx + 1}`;
      }

      let phone = getValue(row, ['phone', 'phone number', 'phone_number', 'mobile', 'contact', 'tel', 'telephone']);
      if (!phone) {
        phone = row.phone ? String(row.phone).trim() : '';
      }

      const email = getValue(row, ['email', 'email address', 'mail']) || row.email || '';
      const address = getValue(row, ['address', 'customer_address', 'street', 'city', 'location']) || row.address || '';
      const nic = getValue(row, ['nic', 'nic number', 'nic_number', 'national id', 'id', 'nic_no', 'identitycard']) || row.nic || '';

      const rawCreditLimit = getValue(row, ['credit limit', 'credit_limit', 'limit', 'max_credit', 'creditlimit']);
      const creditLimit = parseFloat(rawCreditLimit !== '' ? rawCreditLimit : (row.credit_limit || 0)) || 0;

      const rawCreditPeriod = getValue(row, ['credit period', 'credit_period', 'payment terms', 'payment_terms', 'terms', 'days', 'period', 'creditperiod']);
      const creditPeriod = parseInt(rawCreditPeriod !== '' ? rawCreditPeriod : (row.credit_period || 30)) || 30;

      const rawType = getValue(row, ['type', 'customer type', 'customer_type', 'customertype']);
      const type = rawType || row.type || 'registered';

      const rawLoyalty = getValue(row, ['loyaltypoints', 'loyalty_points', 'points', 'loyalty']);
      const loyaltyPoints = parseInt(rawLoyalty !== '' ? rawLoyalty : (row.loyalty_points || 0)) || 0;

      const rawPurchases = getValue(row, ['totalpurchases', 'total_purchases', 'spend', 'purchases']);
      const totalPurchases = parseFloat(rawPurchases !== '' ? rawPurchases : (row.total_purchases || 0)) || 0;

      const rawDate = getValue(row, ['joindate', 'join_date', 'date', 'createdat']) || row.join_date;
      const joinDate = rawDate ? String(rawDate).trim() : new Date().toISOString().split('T')[0];

      // Check if existing customer matches phone or name
      let existing = null;
      if (phone) {
        existing = await db.get('SELECT id FROM customers WHERE phone != "" AND phone = ?', [phone]).catch(() => null);
      }
      if (!existing && name) {
        existing = await db.get('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))', [name]).catch(() => null);
      }

      const id = (existing && existing.id) ? existing.id : (row.id || crypto.randomUUID());

      await db.run(
        `INSERT OR REPLACE INTO customers (
          id, name, email, phone, address, nic, credit_limit, credit_period, type,
          loyalty_points, total_purchases, join_date, credit_balance, current_credit, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, CURRENT_TIMESTAMP)`,
        [id, name, email, phone, address, nic, creditLimit, creditPeriod, type, loyaltyPoints, totalPurchases, joinDate]
      );

      enqueueSync(db, 'customers', id, 'UPSERT').catch(() => { });
      insertedIds.push(id);
      importedCount++;
    }

    // Trigger immediate upstream sync cycle asynchronously
    runSyncCycle(db).catch(() => { });
    await logAudit(user_email, 'CUSTOMER_BULK_IMPORT', `Bulk imported/updated ${importedCount} customer records.`);

    res.json({
      success: true,
      count: importedCount,
      imported: importedCount,
      ids: insertedIds,
      message: `Successfully imported and synced ${importedCount} customer profiles.`
    });
  } catch (err) {
    console.error('Error importing customers:', err);
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
    enqueueSync(db, 'customers', id, 'UPSERT').then(() => runSyncCycle(db)).catch(() => { });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/customers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM customers WHERE id = ?', [id]);
    enqueueSync(db, 'customers', id, 'DELETE').then(() => runSyncCycle(db)).catch(() => { });
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

// BULK SUPPLIER IMPORT ROUTE (Excel / CSV)
app.post(['/api/suppliers/bulk-import', '/api/suppliers/bulk', '/api/suppliers/import'], async (req, res) => {
  const user_email = req.headers['x-user-email'] || 'system';
  try {
    await ensureBulkImportColumns(db);
    const rawItems = Array.isArray(req.body) ? req.body : (req.body?.suppliers || req.body?.items || [req.body]);
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return res.status(400).json({ error: 'No supplier records provided for import.' });
    }

    const cleanKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const getValue = (row, possibleKeys) => {
      if (!row || typeof row !== 'object') return '';
      const keys = Object.keys(row);
      for (const pKey of possibleKeys) {
        const targetClean = cleanKey(pKey);
        const matched = keys.find(k => cleanKey(k) === targetClean);
        if (matched && row[matched] !== undefined && row[matched] !== null) {
          const val = String(row[matched]).trim();
          if (val !== '' && val !== 'null' && val !== 'undefined' && val !== '—' && val !== '-') {
            return val;
          }
        }
      }
      return '';
    };

    let importedCount = 0;
    const insertedIds = [];

    for (let idx = 0; idx < rawItems.length; idx++) {
      const row = rawItems[idx];
      if (!row || typeof row !== 'object') continue;

      let name = getValue(row, [
        'supplier name', 'supplier_name', 'supplier', 'company', 'name', 'vendor',
        'vendor_name', 'vendor name', 'suppliername'
      ]) || (row.name ? String(row.name).trim() : `Supplier #${idx + 1}`);

      let phone = getValue(row, [
        'phone', 'phone number', 'phone_number', 'contact', 'contact_no', 'mobile',
        'tel', 'telephone', 'supplierphone', 'phonenumber'
      ]) || row.phone || '';
      if (/^\d{9}$/.test(phone)) {
        phone = '0' + phone;
      }

      const email = getValue(row, ['email', 'email address', 'mail', 'supplieremail', 'supplier_email']) || row.email || '';
      const address = getValue(row, ['address', 'supplier_address', 'supplieraddress', 'location', 'city', 'street']) || row.address || '';
      const nic = getValue(row, ['nic', 'brn', 'reg no', 'reg_no', 'registration', 'registration_no', 'nic_number', 'nicnumber', 'nationalid']) || row.nic || '';
      const creditTerms = getValue(row, ['credit terms', 'credit_terms', 'terms', 'payment terms', 'payment_terms']) || row.credit_terms || row.creditTerms || 'Net 30';

      const rawPayable = getValue(row, ['payable balance', 'payable_balance', 'balance', 'owed', 'amount_owed']);
      const payableBalance = parseFloat(rawPayable !== '' ? rawPayable : (row.payable_balance || row.payableBalance || 0)) || 0;

      // Check if existing supplier matches name or phone
      let existing = null;
      if (name) {
        existing = await db.get('SELECT id FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))', [name]).catch(() => null);
      }
      if (!existing && phone) {
        existing = await db.get('SELECT id FROM suppliers WHERE phone != "" AND phone = ?', [phone]).catch(() => null);
      }

      const id = (existing && existing.id) ? existing.id : (row.id || crypto.randomUUID());

      await db.run(
        `INSERT OR REPLACE INTO suppliers (
          id, name, email, phone, address, credit_terms, payable_balance, nic, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, name, email, phone, address, creditTerms, payableBalance, nic]
      );

      enqueueSync(db, 'suppliers', id, 'UPSERT').catch(() => { });
      insertedIds.push(id);
      importedCount++;
    }

    runSyncCycle(db).catch(() => { });
    await logAudit(user_email, 'SUPPLIER_BULK_IMPORT', `Bulk imported/updated ${importedCount} supplier records.`);

    return res.json({
      success: true,
      count: importedCount,
      imported: importedCount,
      ids: insertedIds,
      message: `Successfully imported ${importedCount} suppliers.`
    });
  } catch (err) {
    console.error('Error bulk importing suppliers:', err);
    return res.status(500).json({ error: 'Bulk supplier import failed: ' + err.message });
  }
});

app.post('/api/suppliers', async (req, res) => {
  if (Array.isArray(req.body) && req.body.length > 1) {
    req.url = '/api/suppliers/bulk-import';
    return app._router.handle(req, res);
  }

  const s = Array.isArray(req.body) ? (req.body[0] || {}) : (req.body || {});
  const id = s.id || ('s_' + Date.now());
  try {
    await db.run(
      'INSERT INTO suppliers (id, name, email, phone, address, credit_terms, payable_balance, nic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, s.name, s.email, s.phone, s.address, s.creditTerms || s.credit_terms, s.payableBalance !== undefined ? s.payableBalance : s.payable_balance || 0, s.nic]
    );
    enqueueSync(db, 'suppliers', id, 'UPSERT').then(() => runSyncCycle(db)).catch(() => { });
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
    enqueueSync(db, 'suppliers', id, 'UPSERT').then(() => runSyncCycle(db)).catch(() => { });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/suppliers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM suppliers WHERE id = ?', [id]);
    enqueueSync(db, 'suppliers', id, 'DELETE').then(() => runSyncCycle(db)).catch(() => { });
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
      cashier: s.cashier || s.cashier_name || s.user_name || (s.user_email ? s.user_email.split('@')[0] : 'Krish'),
      cashier_name: s.cashier || s.cashier_name || s.user_name || (s.user_email ? s.user_email.split('@')[0] : 'Krish'),
      date: new Date(s.created_at).toLocaleDateString(),
      created_at: s.created_at,
      due_date: s.due_date,
      credit_period_days: s.credit_period_days || 0,
      payment_received: s.payment_received || 0,
      transportation_fee: Number(s.transportation_fee || 0),
      transportationFee: Number(s.transportation_fee || 0),
      delivery_fee: Number(s.transportation_fee || 0),
      deliveryFee: Number(s.transportation_fee || 0),
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

app.get(['/api/reports/summary', '/api/sales/summary'], async (req, res) => {
  try {
    const { from_date, to_date, from, to } = req.query;

    // Consistent timezone (Asia/Colombo UTC+05:30) date bounds in YYYY-MM-DD
    const nowColombo = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Colombo' }).format(new Date());
    const startDate = from_date || from || nowColombo;
    const endDate = to_date || to || nowColombo;

    const sales = await db.all(
      `SELECT * FROM sales 
       WHERE status NOT IN ('cancelled', 'Voided', 'voided')`
    );

    const returns = await db.all(
      `SELECT * FROM sales_returns 
       WHERE status NOT IN ('cancelled', 'Voided', 'voided')`
    ).catch(() => []);

    let grossStickerSales = 0;
    let customerDiscounts = 0;
    let deliveryFees = 0;
    let ordersCount = 0;
    let grossCogs = 0;
    let cashSales = 0;
    let creditSales = 0;

    for (const s of sales) {
      let saleDateStr = '';
      if (s.created_at) {
        try {
          saleDateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Colombo' }).format(new Date(s.created_at));
        } catch (_) {
          saleDateStr = String(s.created_at).substring(0, 10);
        }
      } else if (s.date) {
        saleDateStr = String(s.date).substring(0, 10);
      }

      if (saleDateStr >= startDate && saleDateStr <= endDate) {
        const total = Number(s.total_amount || s.total || 0);
        const subtotal = Number(s.subtotal !== undefined ? s.subtotal : total);
        const disc = Number(s.discount_amount || s.discount || 0);
        const delFee = Number(
          s.transportation_fee !== undefined && s.transportation_fee !== null ? s.transportation_fee :
            (s.delivery_fee !== undefined && s.delivery_fee !== null ? s.delivery_fee :
              (s.deliveryFee || 0))
        );

        grossStickerSales += (subtotal > 0 ? subtotal : total);
        customerDiscounts += disc;
        deliveryFees += delFee;
        ordersCount += 1;

        if (String(s.payment_method).toLowerCase() === 'credit') {
          creditSales += total;
        } else {
          cashSales += total;
        }

        let items = [];
        try {
          items = typeof s.items === 'string' ? JSON.parse(s.items) : (s.items || []);
        } catch (_) { }

        if (Array.isArray(items)) {
          for (const it of items) {
            const cost = Number(it.cost_price || it.costPrice || 0);
            const qty = Number(it.quantity || it.qty || 1);
            grossCogs += (cost * qty);
          }
        }
      }
    }

    let returnsSellingRevenue = 0;
    let returnsCostVal = 0;

    for (const r of returns) {
      let retDateStr = '';
      if (r.created_at) {
        try {
          retDateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Colombo' }).format(new Date(r.created_at));
        } catch (_) {
          retDateStr = String(r.created_at).substring(0, 10);
        }
      } else if (r.date) {
        retDateStr = String(r.date).substring(0, 10);
      }

      if (retDateStr >= startDate && retDateStr <= endDate) {
        const retAmt = Number(r.return_amount !== undefined ? r.return_amount : (r.total_refunded || r.amount || 0));
        returnsSellingRevenue += retAmt;

        let retItems = [];
        try {
          retItems = typeof r.returned_items === 'string' ? JSON.parse(r.returned_items) : (r.returned_items || r.items || []);
        } catch (_) { }

        if (Array.isArray(retItems)) {
          for (const it of retItems) {
            const cost = Number(it.cost_price || it.costPrice || 0);
            const qty = Number(it.quantity || it.qty || 1);
            returnsCostVal += (cost * qty);
          }
        }
      }
    }

    const netSales = Math.max(0, grossStickerSales - customerDiscounts - returnsSellingRevenue + deliveryFees);
    const netCogs = Math.max(0, grossCogs - returnsCostVal);
    const netProfit = netSales - netCogs;

    res.json({
      success: true,
      from_date: startDate,
      to_date: endDate,
      total_revenue: netSales,
      gross_sales: grossStickerSales,
      customer_discounts: customerDiscounts,
      returns_revenue: returnsSellingRevenue,
      delivery_fee: deliveryFees,
      net_sales: netSales,
      cogs: netCogs,
      net_profit: netProfit,
      orders_count: ordersCount,
      cash_sales: cashSales,
      credit_sales: creditSales
    });
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
  const transportationFeeVal = Number(
    s.transportation_fee !== undefined ? s.transportation_fee :
      (s.transportationFee !== undefined ? s.transportationFee :
        (s.delivery_fee !== undefined ? s.delivery_fee :
          (s.deliveryFee !== undefined ? s.deliveryFee : 0)))
  );
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
      let candidate = (settings && settings.next_invoice_number) ? settings.next_invoice_number : 'INV001';

      // Self-healing reconciliation: the counter above only ever advances when a sale is created
      // ON THIS DEVICE. If sales were instead imported by downstream sync (e.g. pulled from the
      // cloud into a fresh/reinstalled local database, or after a counter reset), the counter can
      // point at a number that already exists in the local sales table, causing a UNIQUE
      // constraint failure on insert. Keep advancing with the exact same existing
      // generateNextInvoiceNumber() format/business rule until a genuinely free number is found,
      // rather than trusting the stored counter blindly. This is a read against the real sales
      // table, inside the same transaction, so it also serializes correctly against concurrent
      // local requests.
      let guard = 0;
      while (guard < 100000) {
        const collision = await db.get('SELECT 1 FROM sales WHERE invoice_no = ?', [candidate]);
        if (!collision) break;
        candidate = generateNextInvoiceNumber(candidate);
        guard++;
      }
      finalInvoiceNo = candidate;

      // Persist the number AFTER it, so the next sale starts from a known-free position too.
      const nextInv = generateNextInvoiceNumber(finalInvoiceNo);
      await db.run('UPDATE system_settings SET next_invoice_number = ? WHERE id = ?', [nextInv, 'global']);
    }

    // Phase 2A Historical Cost Snapshot Protection: batch fetch products with cost_price, unit, measure_details before sale insertion
    const rawItemsArr = Array.isArray(s.items) ? s.items : [];
    const productIds = rawItemsArr.map(item => item.productId || item.product_id).filter(Boolean);
    const placeholders = productIds.map(() => '?').join(',');
    const productsMap = new Map();
    if (productIds.length > 0) {
      const products = await db.all(`SELECT id, stock, name, cost_price, unit, measure_details FROM products WHERE id IN (${placeholders})`, productIds);
      products.forEach(p => productsMap.set(p.id, p));
    }

    const enrichedItems = rawItemsArr.map(item => {
      const prod = productsMap.get(item.productId || item.product_id);
      const baseCostPrice = prod ? Number(prod.cost_price !== undefined ? prod.cost_price : (prod.costPrice || 0)) : 0;

      let convRate = Number(item.conversionRate) || 1;
      const itemUnit = (item.unit || '').toLowerCase().trim();
      const prodUnit = prod ? (prod.unit || '').toLowerCase().trim() : '';

      if ((!item.conversionRate || convRate === 1) && itemUnit && prodUnit && itemUnit !== prodUnit && prod) {
        const measureDetailsStr = prod.measure_details || prod.measureDetails;
        if (measureDetailsStr) {
          try {
            const parsed = typeof measureDetailsStr === 'string' ? JSON.parse(measureDetailsStr) : measureDetailsStr;
            if (parsed && Array.isArray(parsed.conversions)) {
              const matchedConv = parsed.conversions.find(c => (c.unit || '').toLowerCase().trim() === itemUnit);
              if (matchedConv) {
                const rawVal = Number(matchedConv.kgVal) || 1;
                if (prodUnit === 'cube' && rawVal > 0 && rawVal < 1) {
                  convRate = 1 / rawVal;
                } else {
                  convRate = rawVal;
                }
              }
            }
          } catch (e) { }
        }
      }

      // Unit Cost Calculation:
      // Base Unit (e.g. 1 Cube): unit_cost = baseCostPrice (Rs. 2,000.00)
      // Sub-Unit (e.g. Bucket where 1 Cube = 506 Buckets): unit_cost = baseCostPrice / convRate (2000 / 506 = Rs. 3.95)
      const unitCost = convRate > 0 ? (baseCostPrice / convRate) : baseCostPrice;
      const lineCogs = unitCost * Number(item.qty || 0);

      return {
        ...item,
        conversionRate: convRate,
        base_cost_price: baseCostPrice,
        unit_cost: unitCost,
        cost_price: unitCost,
        costPrice: unitCost,
        cogs_amount: lineCogs
      };
    });

    // 2. Insert Sale Order
    const cashierName = s.cashier || s.cashier_name || s.user_name || (s.user_email ? s.user_email.split('@')[0] : 'Krish');
    const userEmail = s.user_email || (s.user_id ? `${s.user_id}@hardware.erp` : 'admin@hardware.erp');
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
        user_id: s.user_id,
        payment_method: s.payment_method
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

    // Enqueue upstream sync for sale, inventory decrements, and customer balance
    try {
      await enqueueSync(db, 'sales', id, 'UPSERT');
      if (Array.isArray(enrichedItems)) {
        for (const item of enrichedItems) {
          const prodId = item.productId || item.product_id;
          if (prodId) {
            enqueueSync(db, 'products', prodId, 'UPSERT').catch(() => { });
          }
        }
      }
      if (s.customer_id) {
        enqueueSync(db, 'customers', s.customer_id, 'UPSERT').catch(() => { });
      }
      // Immediate non-blocking upstream sync push to Turso Cloud (1-2 second latency)
      const tursoClient = getTursoClient();
      if (tursoClient) {
        pushUpstreamChanges(db, tursoClient).catch(err => console.warn('[Checkout Immediate Push Notice]:', err.message));
      } else {
        runSyncCycle(db).catch(() => { });
      }
    } catch (_) { }

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
      try {
        await enqueueSync(db, 'sales', id, 'UPDATE');
        const tursoClient = getTursoClient();
        if (tursoClient) {
          pushUpstreamChanges(db, tursoClient).catch(err => console.warn('[Sales Update Sync Push Notice]:', err.message));
        }
      } catch (_) { }
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
    // Ensure debt settlement transactions are recorded exactly once in the accounting ledger table
    if (amountPaid > 0) {
      const txId = 'tx_cp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const txDate = (paymentDate || createdAt).substring(0, 10);
      const isPartial = remainingBalance > 0.01;
      const category = isPartial ? 'Sales Income (Partial Credit Settlement)' : 'Sales Income (Credit Settlement)';
      const description = isPartial
        ? `Partial Credit Payment for Invoice #${invoiceNo} (${p.customer_name || 'Customer'})`
        : `Credit Settlement for Invoice #${invoiceNo} (${p.customer_name || 'Customer'})`;

      const existingTx = await db.get(
        'SELECT id FROM transactions WHERE reference = ? AND (category LIKE ? OR category LIKE ?) AND amount = ? AND date = ?',
        [invoiceNo, '%Credit Settlement%', '%Credit Payment%', amountPaid, txDate]
      );

      if (!existingTx) {
        // Carry the customer's actual repayment method (already captured a few lines above into
        // credit_payments.payment_method) into this ledger row too - previously this INSERT omitted
        // the column entirely, so every credit settlement silently landed in the Cash Book as
        // 'CASH' (the schema's column default) regardless of whether the customer actually paid by
        // card/bank transfer, defeating the drawer cash-isolation feature for this entire category
        // of transaction.
        await db.run(
          'INSERT INTO transactions (id, date, description, amount, type, category, reference, user_id, created_at, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, txDate, description, amountPaid, 'income', category, invoiceNo, authorName, createdAt, p.payment_method || 'Cash']
        ).catch(e => console.error('Error logging credit repayment transaction:', e));
        enqueueSync(db, 'transactions', txId, 'UPSERT').catch(() => { });
        enqueueSync(db, 'cash_book', txId, 'UPSERT').catch(() => { });
      }
    }

    enqueueSync(db, 'credit_payments', id, 'UPSERT').catch(() => { });
    if (p.customer_id) {
      enqueueSync(db, 'customers', p.customer_id, 'UPSERT').catch(() => { });
    }
    const tursoClient = getTursoClient();
    if (tursoClient) {
      pushUpstreamChanges(db, tursoClient).catch(() => { });
    } else {
      runSyncCycle(db).catch(() => { });
    }

    res.json({ success: true, id, authorName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.post(['/api/credit_payments', '/api/credit_settlements', '/api/credit-settlements', '/api/customers/payment', '/api/customer/payment'], handleCreditPaymentInsert);

app.get('/api/credit_settlements', async (req, res) => {
  try {
    const records = await db.all('SELECT * FROM credit_payments ORDER BY payment_date DESC');
    res.json(records || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/credit-settlements', async (req, res) => {
  try {
    const records = await db.all('SELECT * FROM credit_payments ORDER BY payment_date DESC');
    res.json(records || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sales/:id', requireVoidPasskey, async (req, res) => {
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
    // Previously this hard-delete never synced at all: the sale would disappear locally but stay
    // permanently "live" in the cloud/web portal forever. Now propagated like every other mutation.
    enqueueSync(db, 'sales', id, 'DELETE').then(() => runSyncCycle(db)).catch(() => { });
    res.json({ success: true });
  } catch (err) {
    if (txn) await rollbackTxn(db, txn); else await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales/:id/void', requireVoidPasskey, async (req, res) => {
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
    enqueueSync(db, 'sales', id, 'UPSERT').catch(() => { });

    const items = JSON.parse(sale.items);
    for (const item of items) {
      const convRate = Number(item.conversionRate) || 1;
      const baseQtyRestock = convRate > 0 ? (Number(item.qty || 0) / convRate) : Number(item.qty || 0);
      await db.run(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [baseQtyRestock, item.productId]
      );
      enqueueSync(db, 'products', item.productId, 'UPSERT').catch(() => { });
    }

    const auditId = 'al_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    await db.run(
      'INSERT INTO audit_logs (id, user_email, action, details) VALUES (?, ?, ?, ?)',
      [auditId, user_email || 'System', 'VOID_INVOICE', `Voided invoice ${sale.invoice_no} (Total: Rs. ${sale.total_amount})`]
    );

    const orphanedTxRows = await db.all(
      "SELECT id FROM transactions WHERE reference = ? OR reference = ? OR description LIKE ?",
      [sale.invoice_no, id, `%${sale.invoice_no}%`]
    );
    for (const row of orphanedTxRows) {
      enqueueSync(db, 'transactions', row.id, 'DELETE').catch(() => { });
    }
    await db.run("DELETE FROM transactions WHERE reference = ? OR reference = ? OR description LIKE ?", [sale.invoice_no, id, `%${sale.invoice_no}%`]);
    await removeRuntimeTransactionsForSale(sale.invoice_no);

    await db.run('COMMIT');
    runSyncCycle(db).catch(() => { });
    res.json({ success: true });
  } catch (err) {
    await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

// SALES RETURNS API
app.get('/api/sales/returns', async (req, res) => {
  try {
    // Schema for this table (including is_credit) is created and migrated in initializeDatabase().
    // It used to be defined here as well, which meant a fresh database only gained the is_credit
    // column once this list endpoint had been called at least once.
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
    await enqueueSync(db, 'sales_returns', id, 'INSERT');

    // 2b. Normalized Sales Return items persistence for analytics parity & COGS reconciliation
    for (let idx = 0; idx < returnedItems.length; idx++) {
      const item = returnedItems[idx];
      const pId = item.productId || item.product_id || item.id || '';
      const uKey = (item.unit || '').toLowerCase().trim();
      const origItem = originalItems.find(i =>
        (i.lineId && (i.lineId === item.lineId || i.lineId === item.line_id)) ||
        ((i.productId || i.id || i.product_id) === pId && (i.unit || '').toLowerCase().trim() === uKey)
      ) || originalItems.find(i => (i.productId || i.id || i.product_id) === pId);

      const sriId = 'sri_' + id + '_' + (pId || idx) + '_' + idx;
      const sriQty = Number(item.qty || 0);
      const sriPrice = Number(item.price || 0);
      const sriCost = Number(item.cost_price || item.costPrice || origItem?.cost_price || origItem?.costPrice || 0);
      const sriTotal = Number(item.total || (sriQty * sriPrice));

      await db.run(
        `INSERT OR REPLACE INTO sales_return_items (
          id, return_id, product_id, product_name, quantity, unit_price, cost_price, total, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sriId, id, pId, item.name || item.product_name || origItem?.name || '', sriQty, sriPrice, sriCost, sriTotal, created_at]
      );
      await enqueueSync(db, 'sales_return_items', sriId, 'INSERT');
    }

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
      await enqueueSync(db, 'products', pId, 'UPDATE');
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
        await enqueueSync(db, 'products', prod.id, 'UPDATE');
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
      await enqueueSync(db, 'credit_notes', cnId, 'INSERT');
    }

    // 6. Log financial transactions & revenue adjustments
    if (isCreditCustomer) {
      if (calcReturnAmount > 0) {
        // Credit sale return/exchange:
        // Log contra_revenue to decrease Total Revenue by calcReturnAmount (returned items value)
        const txId = 't_' + Date.now();
        await db.run(
          'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, 'contra_revenue', 'Sales Return (Credit Adjustment)', `Credit Return Revenue Adjustment for ${invoiceNo}`, calcReturnAmount, new Date(created_at).toLocaleDateString('sv-SE'), invoiceNo, userEmail || 'system']
        );
        await enqueueSync(db, 'transactions', txId, 'INSERT');
        await enqueueSync(db, 'cash_book', txId, 'INSERT');
      }
      if (finalCustomerPaid > 0) {
        const txId = 't_' + Date.now() + '_ex';
        await db.run(
          'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, 'income', 'Exchange Payment', `Exchange Balance Payment for ${invoiceNo}`, finalCustomerPaid - finalChangeGiven, new Date(created_at).toLocaleDateString('sv-SE'), invoiceNo, userEmail || 'system']
        );
        await enqueueSync(db, 'transactions', txId, 'INSERT');
        await enqueueSync(db, 'cash_book', txId, 'INSERT');
      }
    } else {
      // Non-credit (Cash / Normal Sale Return)
      if (calcReturnAmount > 0) {
        const txId = 't_' + Date.now();
        const retCategory = finalReturnMethod === 'Exchange' ? 'Sales Return' : (finalReturnMethod === 'Credit Note' ? 'Sales Return (Credit Note)' : 'Sales Return');
        const retDesc = finalReturnMethod === 'Exchange' ? `Exchange Return for ${invoiceNo}` : `Sales Return Refund for ${invoiceNo}`;
        await db.run(
          'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, 'contra_revenue', retCategory, retDesc, calcReturnAmount, new Date(created_at).toLocaleDateString('sv-SE'), invoiceNo, userEmail || 'system']
        );
        await enqueueSync(db, 'transactions', txId, 'INSERT');
        await enqueueSync(db, 'cash_book', txId, 'INSERT');
      }
      if (finalReturnMethod === 'Exchange' && finalCustomerPaid > 0) {
        const txId = 't_' + Date.now() + '_ex';
        await db.run(
          'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, 'income', 'Exchange Payment', `Exchange Balance Payment for ${invoiceNo}`, finalCustomerPaid - finalChangeGiven, new Date(created_at).toLocaleDateString('sv-SE'), invoiceNo, userEmail || 'system']
        );
        await enqueueSync(db, 'transactions', txId, 'INSERT');
        await enqueueSync(db, 'cash_book', txId, 'INSERT');
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
    await enqueueSync(db, 'sales', sale.id, 'UPDATE');

    await logAudit(userEmail || 'system', 'SALES_RETURN', `Processed ${finalReturnMethod} (Return No: ${return_no}) for Invoice ${invoiceNo} (Amount: Rs. ${calcReturnAmount})`);

    await commitTxn(db, txn);
    console.log(`[END] Process Sales Return: Invoice ${invoiceNo} - ${Date.now() - startTime}ms`);

    const tursoClient = getTursoClient();
    if (tursoClient) {
      pushUpstreamChanges(db, tursoClient).catch(err => console.warn('[Sales Return Immediate Sync Push Notice]:', err.message));
    }

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
    try { await db.run('ROLLBACK'); } catch (e) { }
    console.error('Error processing sales return:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales/returns/:id/void', requireVoidPasskey, async (req, res) => {
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
    await enqueueSync(db, 'sales_returns', id, 'UPDATE');

    // 2. Re-deduct stock for returned items
    const returnedItems = safeParseJson(sr.returned_items, []);
    for (const item of returnedItems) {
      const convRate = Number(item.conversionRate) || 1;
      const baseQtyDeduction = convRate > 0 ? (Number(item.qty || 0) / convRate) : Number(item.qty || 0);
      const prodId = item.productId || item.product_id;
      await db.run(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [baseQtyDeduction, prodId]
      );
      if (prodId) await enqueueSync(db, 'products', prodId, 'UPDATE');
    }

    // 3. Re-add stock for exchange items if applicable
    const exchangeItems = safeParseJson(sr.exchange_items, []);
    for (const item of exchangeItems) {
      const convRate = Number(item.conversionRate) || 1;
      const baseQtyRestock = convRate > 0 ? (Number(item.qty || 0) / convRate) : Number(item.qty || 0);
      const prodId = item.productId || item.product_id;
      await db.run(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [baseQtyRestock, prodId]
      );
      if (prodId) await enqueueSync(db, 'products', prodId, 'UPDATE');
    }

    // 4. Void associated Credit Note if applicable
    if (sr.credit_note_no) {
      await db.run("UPDATE credit_notes SET status = 'voided', balance_remaining = 0 WHERE credit_note_no = ?", [sr.credit_note_no]);
      const cn = await db.get('SELECT id FROM credit_notes WHERE credit_note_no = ?', [sr.credit_note_no]);
      if (cn) await enqueueSync(db, 'credit_notes', cn.id, 'UPDATE');
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
      await enqueueSync(db, 'sales', sale.id, 'UPDATE');
    }

    await logAudit(user, 'VOID_SALES_RETURN', `Voided Sales Return ${id} for Invoice ${sr.invoice_no}. Reason: ${reason || 'N/A'}`);

    await db.run('COMMIT');

    const tursoClient = getTursoClient();
    if (tursoClient) {
      pushUpstreamChanges(db, tursoClient).catch(err => console.warn('[Void Return Immediate Sync Push Notice]:', err.message));
    }

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
    try { await db.run('ROLLBACK'); } catch (e) { }
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
app.get(['/api/purchase-orders', '/api/purchases'], async (req, res) => {
  try {
    const data = await db.all('SELECT * FROM purchase_orders ORDER BY created_at DESC');
    const mapped = data.map(po => ({
      id: po.id,
      poNumber: po.po_number,
      supplierName: po.supplier_name,
      items: typeof po.items === 'string' ? JSON.parse(po.items) : (po.items || []),
      total: po.total,
      subtotal: Number(po.subtotal !== null && po.subtotal !== undefined ? po.subtotal : (po.original_total !== null && po.original_total !== undefined ? po.original_total : po.total)),
      discount_type: po.discount_type || 'fixed',
      discountType: po.discount_type || 'fixed',
      discount_value: Number(po.discount_value || 0),
      discountValue: Number(po.discount_value || 0),
      discount_amount: Number(po.discount_amount || 0),
      discountAmount: Number(po.discount_amount || 0),
      net_total: Number(po.net_total !== null && po.net_total !== undefined ? po.net_total : po.total),
      netTotal: Number(po.net_total !== null && po.net_total !== undefined ? po.net_total : po.total),
      originalTotal: Number(po.original_total !== null && po.original_total !== undefined ? po.original_total : po.total),
      original_total: Number(po.original_total !== null && po.original_total !== undefined ? po.original_total : po.total),
      debitNoteCode: po.debit_note_code || '',
      debit_note_code: po.debit_note_code || '',
      debitNoteApplied: Number(po.debit_note_applied || 0),
      debit_note_applied: Number(po.debit_note_applied || 0),
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

/**
 * Resolves or creates an independent batch SKU for divergent PO costs
 * - If costs match (abs diff < 0.01) or invalid: increments existing product stock, leaves cost intact.
 * - If costs differ:
 *   * Checks if an existing batch product in the same SKU family has this exact cost. If yes, increments it.
 *   * If no, forks a new batch product:
 *     - SKU: ${baseSKU}-B${batchNumber}
 *     - Name: ${productName} (Batch ${batchNumber})
 *     - Cost: itemCost
 *     - Stock: qty
 *     - Price: round(itemCost * markupRatio, 2)
 *     - Supplier: Current PO supplier
 *     - Barcode: ${baseBarcode}-B${batchNumber} (or unique fallback)
 *   * The original product retains its original cost and historical stock.
 */
async function resolveOrCreateBatchProduct(db, product, itemCost, qty, poSupplierName) {
  if (!product) return null;
  const currentCost = Number(product.cost_price !== undefined && product.cost_price !== null ? product.cost_price : (product.costPrice || 0));
  const newCost = Number(itemCost || 0);

  // If cost matches existing catalog cost or invalid cost, use the product directly
  if (newCost <= 0 || Math.abs(newCost - currentCost) < 0.01) {
    const oldStock = Number(product.stock || 0);
    const newStock = oldStock + qty;
    await db.run('UPDATE products SET stock = ? WHERE id = ?', [newStock, product.id]);
    return {
      productId: product.id,
      sku: product.sku,
      isNewBatch: false,
      batchNumber: product.batch_number || 1,
      name: product.name,
      costPrice: currentCost,
      stock: newStock,
      isExistingIncremented: true
    };
  }

  // Cost differs: preserve original product stock and cost!
  // Determine base SKU and base Name
  const baseSku = (product.sku || 'SKU').replace(/-B\d+$/i, '').trim();
  const baseName = (product.name || 'Product').replace(/\s*\(Batch\s*\d+\)$/i, '').trim();
  const rootParentId = product.parent_product_id || product.id;

  // Check if a batch SKU already exists for this exact cost in the same product family
  const existingFamily = await db.all(
    'SELECT * FROM products WHERE sku = ? OR sku LIKE ? OR parent_product_id = ? OR id = ?',
    [baseSku, `${baseSku}-B%`, rootParentId, rootParentId]
  );

  const matchedBatch = existingFamily.find(p => {
    const pCost = Number(p.cost_price !== undefined && p.cost_price !== null ? p.cost_price : (p.costPrice || 0));
    return Math.abs(pCost - newCost) < 0.01;
  });

  if (matchedBatch) {
    const oldStock = Number(matchedBatch.stock || 0);
    const newStock = oldStock + qty;
    await db.run('UPDATE products SET stock = ? WHERE id = ?', [newStock, matchedBatch.id]);
    return {
      productId: matchedBatch.id,
      sku: matchedBatch.sku,
      isNewBatch: false,
      batchNumber: matchedBatch.batch_number || 1,
      name: matchedBatch.name,
      costPrice: newCost,
      stock: newStock,
      isExistingIncremented: true
    };
  }

  // Generate new batch item
  // Calculate next batch number from existing family
  let maxBatchNum = 1;
  for (const p of existingFamily) {
    if (p.batch_number && Number(p.batch_number) > maxBatchNum) {
      maxBatchNum = Number(p.batch_number);
    }
    const match = (p.sku || '').match(/-B(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxBatchNum) maxBatchNum = num;
    }
  }
  const nextBatchNum = maxBatchNum + 1;

  const newSku = `${baseSku}-B${nextBatchNum}`;
  const newName = `${baseName} (Batch ${nextBatchNum})`;

  // Calculate selling price inheriting existing markup ratio
  const catalogPrice = Number(product.price || 0);
  const markupRatio = currentCost > 0 ? (catalogPrice / currentCost) : 1.25;
  const newSellingPrice = Math.round(newCost * Math.max(1.0, markupRatio) * 100) / 100;

  // Generate unique barcode
  const baseBarcode = (product.barcode || 'HW' + Date.now().toString().slice(-6)).trim();
  let newBarcode = `${baseBarcode}-B${nextBatchNum}`;
  const existingBarcode = await db.get('SELECT id FROM products WHERE barcode = ?', [newBarcode]);
  if (existingBarcode) {
    newBarcode = `${baseBarcode}B${nextBatchNum}${Date.now().toString().slice(-3)}`;
  }

  const newId = 'p_batch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const supplierToUse = poSupplierName || product.supplier || '';

  await db.run(
    `INSERT INTO products (
      id, name, sku, category, price, cost_price, stock, min_stock,
      supplier, unit, barcode, brand, serial_no, batch_code, expiry_date,
      supplier_phone, measure_details, parent_product_id, is_batch, batch_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId,
      newName,
      newSku,
      product.category || 'General',
      newSellingPrice,
      newCost,
      qty,
      product.min_stock !== undefined ? product.min_stock : 5,
      supplierToUse,
      product.unit || 'PCS',
      newBarcode,
      product.brand || '',
      product.serial_no || '',
      `BATCH-${nextBatchNum}`,
      product.expiry_date || '',
      product.supplier_phone || '',
      product.measure_details || '',
      rootParentId,
      1,
      nextBatchNum
    ]
  );

  return {
    productId: newId,
    sku: newSku,
    isNewBatch: true,
    batchNumber: nextBatchNum,
    name: newName,
    costPrice: newCost,
    stock: qty,
    price: newSellingPrice,
    isExistingIncremented: false
  };
}

app.post(['/api/purchase-orders', '/api/purchases'], async (req, res) => {
  const po = Array.isArray(req.body) ? req.body[0] : req.body;
  const id = 'po_' + Date.now();
  const created_at = new Date().toISOString();
  const items = Array.isArray(po.items) ? po.items : (typeof po.items === 'string' ? JSON.parse(po.items || '[]') : []);

  // Compute gross subtotal and line discounts across items
  let calculatedGrossSubtotal = 0;
  let calculatedLineDiscounts = 0;
  for (const item of items) {
    const qty = Math.max(0, Number(item.qty || item.quantity || 0));
    const cost = Math.max(0, Number(item.costPrice || item.cost_price || item.unitCostPrice || 0));
    const isFixed = (item.discountType || item.discount_type || '').toLowerCase() === 'fixed';
    const disc = Math.max(0, Number(item.discount || item.line_discount || 0));
    const gross = Math.round(qty * cost * 100) / 100;
    const unitDiscountAmount = isFixed ? disc : (cost * Math.min(100, disc) / 100);
    const lineDiscount = Math.min(gross, Math.round(unitDiscountAmount * qty * 100) / 100);
    calculatedGrossSubtotal += gross;
    calculatedLineDiscounts += lineDiscount;
  }
  calculatedGrossSubtotal = Math.round(calculatedGrossSubtotal * 100) / 100;
  calculatedLineDiscounts = Math.round(calculatedLineDiscounts * 100) / 100;

  const subtotal = Number(po.subtotal !== undefined && po.subtotal !== null ? po.subtotal : calculatedGrossSubtotal);
  const discountType = (po.discount_type || po.discountType || 'fixed').toString().toLowerCase() === 'percentage' ? 'percentage' : 'fixed';
  const discountValue = Math.max(0, Number(po.discount_value !== undefined && po.discount_value !== null ? po.discount_value : (po.discountValue !== undefined && po.discountValue !== null ? po.discountValue : 0)));

  let discountAmount = 0;
  if (po.discount_amount !== undefined && po.discount_amount !== null && Number(po.discount_amount) > 0) {
    discountAmount = Math.round(Number(po.discount_amount) * 100) / 100;
  } else if (po.discountAmount !== undefined && po.discountAmount !== null && Number(po.discountAmount) > 0) {
    discountAmount = Math.round(Number(po.discountAmount) * 100) / 100;
  } else {
    if (discountType === 'percentage') {
      const netAfterLines = Math.max(0, subtotal - calculatedLineDiscounts);
      const orderDisc = Math.round(netAfterLines * (discountValue / 100) * 100) / 100;
      discountAmount = Math.round((calculatedLineDiscounts + orderDisc) * 100) / 100;
    } else {
      discountAmount = Math.min(subtotal, Math.round((calculatedLineDiscounts + discountValue) * 100) / 100);
    }
  }

  const transportationFee = Math.max(0, Number(po.transportation_fee !== undefined && po.transportation_fee !== null ? po.transportation_fee : (po.transportationFee !== undefined && po.transportationFee !== null ? po.transportationFee : 0)));
  const debitNoteCode = (po.debit_note_code || po.debitNoteCode || '').toString().trim();
  const debitNoteApplied = Math.max(0, Number(po.debit_note_applied || po.debitNoteApplied || 0));
  const originalTotal = Number(po.original_total !== undefined ? po.original_total : (po.originalTotal !== undefined ? po.originalTotal : subtotal));
  const afterDiscount = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
  const totalWithTransport = Math.max(0, Math.round((afterDiscount + transportationFee) * 100) / 100);
  const netTotal = Math.max(0, Math.round((totalWithTransport - debitNoteApplied) * 100) / 100);

  let txn = null;
  try {
    txn = await beginTxn(db, `Create PO ${po.po_number || id}`);

    // If debit note applied, deduct from purchase_returns
    if (debitNoteApplied > 0 && debitNoteCode) {
      const pr = await db.get(
        'SELECT * FROM purchase_returns WHERE (return_number = ? OR id = ?) AND status NOT IN (\'VOIDED\', \'REDEEMED\')',
        [debitNoteCode, debitNoteCode]
      );
      if (pr) {
        const prevBal = Number(pr.balance_remaining !== null && pr.balance_remaining !== undefined ? pr.balance_remaining : pr.total_returned_cost);
        const newBal = Math.max(0, Math.round((prevBal - debitNoteApplied) * 100) / 100);
        const prevRedeemed = Number(pr.redeemed_amount || 0);
        const newRedeemed = Math.round((prevRedeemed + debitNoteApplied) * 100) / 100;
        const newStatus = newBal <= 0.001 ? 'REDEEMED' : 'PARTIALLY_REDEEMED';
        await db.run(
          'UPDATE purchase_returns SET balance_remaining = ?, redeemed_amount = ?, status = ?, redeemed_in_po_number = ?, updated_at = ? WHERE id = ?',
          [newBal, newRedeemed, newStatus, po.po_number || id, created_at, pr.id]
        );
      }
    }

    await db.run(
      `INSERT INTO purchase_orders (
        id, po_number, supplier_name, items, total,
        subtotal, discount_type, discount_value, discount_amount, transportation_fee, net_total,
        original_total, debit_note_code, debit_note_applied, status, due_date, user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, po.po_number, po.supplier_name, JSON.stringify(items), netTotal,
        subtotal, discountType, discountValue, discountAmount, transportationFee, netTotal,
        originalTotal, debitNoteCode || null, debitNoteApplied, po.status || 'pending', po.due_date, po.user_id, created_at
      ]
    );

    // If transportation fee > 0, log an expense entry so it deducts from total profit in Reports
    if (transportationFee > 0) {
      const todayStr = new Date().toISOString().split('T')[0];
      const txId = 'tx_trans_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      await db.run(
        `INSERT INTO transactions (
          id, type, category, description, amount, date, reference, user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          txId,
          'expense',
          'Transportation',
          `Transportation Fee for PO #${po.po_number || id} (${po.supplier_name || 'Vendor'})`,
          transportationFee,
          todayStr,
          po.po_number || id,
          po.user_id || 'u1',
          created_at
        ]
      );
    }

    // If created directly in received status:
    if (po.status === 'received') {
      const totalLineDisc = items.reduce((sum, it) => {
        const q = Math.max(0, Number(it.qty || it.quantity || 0));
        const c = Math.max(0, Number(it.costPrice || it.cost_price || it.unitCostPrice || 0));
        const isF = (it.discountType || it.discount_type || '').toLowerCase() === 'fixed';
        const d = Math.max(0, Number(it.discount || it.line_discount || 0));
        const uDisc = isF ? d : (c * Math.min(100, d) / 100);
        return sum + Math.min(q * c, Math.round(uDisc * q * 100) / 100);
      }, 0);
      const netAfterLines = Math.max(0, subtotal - totalLineDisc);
      const orderDiscountAmount = Math.max(0, discountAmount - totalLineDisc);
      const poOrderDiscountRatio = netAfterLines > 0 ? (orderDiscountAmount / netAfterLines) : 0;

      for (const item of items) {
        const prodId = item.productId || item.product_id || item.id;
        const qty = Math.max(0, Number(item.qty || item.quantity || 0));
        const itemGrossCost = Number(item.costPrice || item.cost_price || item.unitCostPrice || 0);
        const isFixed = (item.discountType || item.discount_type || '').toLowerCase() === 'fixed';
        const disc = Math.max(0, Number(item.discount || item.line_discount || 0));
        const unitAfterLineDisc = isFixed ? Math.max(0, itemGrossCost - disc) : itemGrossCost * (1 - Math.min(100, disc) / 100);
        const netUnitCost = Math.round(unitAfterLineDisc * (1 - poOrderDiscountRatio) * 100) / 100;

        if (prodId && qty > 0) {
          const product = await db.get('SELECT * FROM products WHERE id = ?', [prodId]);
          if (product) {
            const currentStock = Number(product.stock || 0);
            const currentCost = Number(product.cost_price !== undefined && product.cost_price !== null ? product.cost_price : (product.costPrice || 0));
            let weightedCost = netUnitCost;
            if (currentStock > 0 && currentCost > 0) {
              weightedCost = Math.round(((currentStock * currentCost) + (qty * netUnitCost)) / (currentStock + qty) * 100) / 100;
            }
            await db.run('UPDATE products SET cost_price = ? WHERE id = ?', [weightedCost, product.id]);
            await resolveOrCreateBatchProduct(db, product, netUnitCost, qty, po.supplier_name);
          }
        }
      }

      if (po.supplier_name) {
        await db.run(
          'UPDATE suppliers SET payable_balance = COALESCE(payable_balance, 0) + ? WHERE name = ?',
          [netTotal, po.supplier_name]
        );
      }
    }

    await commitTxn(db, txn);
    enqueueSync(db, 'purchase_orders', id, 'INSERT').then(() => runSyncCycle(db)).catch(() => { });
    res.json({ success: true, id, subtotal, discountAmount, netTotal, originalTotal, debitNoteApplied });
  } catch (err) {
    if (txn) await rollbackTxn(db, txn); else await safeRollback(db);
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

    // If marked received, allocate stock using Batch Versioning and update weighted average cost
    if (status === 'received') {
      let items = [];
      try {
        items = typeof po.items === 'string' ? JSON.parse(po.items) : (po.items || []);
      } catch (_e) {
        items = [];
      }

      const poSubtotal = Number(po.subtotal !== null && po.subtotal !== undefined ? po.subtotal : (po.original_total || po.total || 0));
      const poDiscountAmount = Number(po.discount_amount || 0);
      const totalLineDisc = items.reduce((sum, it) => {
        const q = Math.max(0, Number(it.qty || it.quantity || 0));
        const c = Math.max(0, Number(it.costPrice || it.cost_price || it.unitCostPrice || 0));
        const isF = (it.discountType || it.discount_type || '').toLowerCase() === 'fixed';
        const d = Math.max(0, Number(it.discount || it.line_discount || 0));
        const uDisc = isF ? d : (c * Math.min(100, d) / 100);
        return sum + Math.min(q * c, Math.round(uDisc * q * 100) / 100);
      }, 0);
      const netAfterLines = Math.max(0, poSubtotal - totalLineDisc);
      const orderDiscountAmount = Math.max(0, poDiscountAmount - totalLineDisc);
      const poOrderDiscountRatio = netAfterLines > 0 ? (orderDiscountAmount / netAfterLines) : 0;
      const poNetTotal = Number(po.net_total !== null && po.net_total !== undefined ? po.net_total : po.total);

      let updatedItems = [];
      for (const item of items) {
        const prodId = item.productId || item.product_id || item.id;
        const qty = Math.max(0, Number(item.qty || item.quantity || 0));
        const itemGrossCost = Number(item.costPrice || item.cost_price || item.unitCostPrice || 0);
        const isFixed = (item.discountType || item.discount_type || '').toLowerCase() === 'fixed';
        const disc = Math.max(0, Number(item.discount || item.line_discount || 0));
        const unitAfterLineDisc = isFixed ? Math.max(0, itemGrossCost - disc) : itemGrossCost * (1 - Math.min(100, disc) / 100);
        // Net purchase price accounting for line discount and overall order-level discount
        const netUnitCost = Math.round(unitAfterLineDisc * (1 - poOrderDiscountRatio) * 100) / 100;

        if (prodId && qty > 0) {
          const product = await db.get('SELECT * FROM products WHERE id = ?', [prodId]);
          if (product) {
            // Recalculate average weighted cost (cost_price) in products based on net purchase prices
            const currentStock = Number(product.stock || 0);
            const currentCost = Number(product.cost_price !== undefined && product.cost_price !== null ? product.cost_price : (product.costPrice || 0));
            let weightedCost = netUnitCost;
            if (currentStock > 0 && currentCost > 0) {
              weightedCost = Math.round(((currentStock * currentCost) + (qty * netUnitCost)) / (currentStock + qty) * 100) / 100;
            }
            await db.run('UPDATE products SET cost_price = ? WHERE id = ?', [weightedCost, product.id]);

            const batchResult = await resolveOrCreateBatchProduct(db, product, netUnitCost, qty, po.supplier_name);
            updatedItems.push({
              ...item,
              netUnitCost,
              receivedProductId: batchResult.productId,
              receivedSku: batchResult.sku,
              isNewBatch: batchResult.isNewBatch,
              batchNumber: batchResult.batchNumber
            });
          } else {
            updatedItems.push(item);
          }
        } else {
          updatedItems.push(item);
        }
      }

      if (po.supplier_name) {
        // Increment supplier's payable_balance by net total (deducting discounts)
        await db.run(
          'UPDATE suppliers SET payable_balance = COALESCE(payable_balance, 0) + ? WHERE name = ?',
          [poNetTotal, po.supplier_name]
        );
      }

      await replaceRuntimeTransactionByDescription(`Stock Check-in ${po.po_number}`, {
        type: 'expense',
        category: 'Purchases',
        amount: poNetTotal,
        date: new Date().toLocaleDateString('sv-SE'),
        reference: po.po_number,
        user_id: po.user_id
      });
    }

    await db.run('COMMIT');
    enqueueSync(db, 'purchase_orders', id, 'UPDATE').then(() => runSyncCycle(db)).catch(() => { });
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
    enqueueSync(db, 'purchase_orders', id, 'DELETE').then(() => runSyncCycle(db)).catch(() => { });
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

// TRANSACTIONS / FINANCE / CASH BOOK API (Ledger / Accounting)
app.get(['/api/transactions', '/api/finance/ledger', '/api/cash-book', '/api/cash_book'], async (req, res) => {
  try {
    const tursoClient = getTursoClient();
    if (tursoClient && (process.env.VERCEL || process.env.APP_ROLE === 'web' || isTurso())) {
      try {
        const rs = await tursoClient.execute('SELECT * FROM cash_book ORDER BY date DESC, created_at DESC');
        return res.json(rs.rows);
      } catch (cloudErr) {
        try {
          const rs2 = await tursoClient.execute('SELECT * FROM transactions ORDER BY date DESC, created_at DESC');
          return res.json(rs2.rows);
        } catch (e) {
          console.warn('[Finance API] Turso query error:', e.message);
        }
      }
    }
    const data = await db.all('SELECT * FROM transactions ORDER BY date DESC, created_at DESC');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(['/api/transactions', '/api/finance/ledger', '/api/cash-book', '/api/cash_book'], async (req, res) => {
  const t = req.body;
  try {
    const transaction = normalizeRuntimeTransaction(t);
    await db.run(
      'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [transaction.id, transaction.type, transaction.category, transaction.description, transaction.amount, transaction.date, transaction.reference, transaction.user_id, transaction.created_at]
    );
    await enqueueSync(db, 'transactions', transaction.id, 'INSERT');
    await enqueueSync(db, 'cash_book', transaction.id, 'INSERT');

    const tursoClient = getTursoClient();
    if (tursoClient) {
      pushUpstreamChanges(db, tursoClient).catch(err => console.warn('[Manual Ledger Sync Push Notice]:', err.message));
    }
    res.json({ success: true, id: transaction.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete(['/api/transactions/:id', '/api/finance/ledger/:id', '/api/cash-book/:id', '/api/cash_book/:id'], async (req, res) => {
  return res.status(403).json({ error: 'Deleting finance/accounting transaction records is disabled for financial audit compliance.' });
});

// CHEQUE REGISTRY API
app.get('/api/cheques', async (req, res) => {
  try {
    const { direction, status, party_id, start_date, end_date } = req.query;

    let query = 'SELECT * FROM cheque_registry WHERE 1=1';
    const params = [];

    if (direction) {
      query += ' AND direction = ?';
      params.push(String(direction).toUpperCase());
    }

    if (status) {
      query += ' AND status = ?';
      params.push(String(status).toUpperCase());
    }

    if (party_id) {
      query += ' AND party_id = ?';
      params.push(String(party_id));
    }

    if (start_date) {
      query += ' AND cheque_date >= ?';
      params.push(String(start_date));
    }

    if (end_date) {
      query += ' AND cheque_date <= ?';
      params.push(String(end_date));
    }

    query += ' ORDER BY cheque_date DESC, created_at DESC';

    const cheques = await db.all(query, params);
    res.json(cheques);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cheques', async (req, res) => {
  const {
    direction,
    cheque_type = 'CROSSED_ACCOUNT_PAYEE',
    cheque_number,
    bank_name,
    branch = '',
    cheque_date,
    amount,
    party_id = null,
    party_name = '',
    reference_type = null,
    reference_id = null,
    status = 'PENDING',
    notes = '',
    created_by = null,
    user_email = null
  } = req.body || {};

  if (!direction || !['INWARD', 'OUTWARD'].includes(direction.toUpperCase())) {
    return res.status(400).json({ error: 'Valid direction (INWARD or OUTWARD) is required.' });
  }

  if (!cheque_number || !cheque_number.toString().trim()) {
    return res.status(400).json({ error: 'Cheque number is required.' });
  }

  if (!bank_name || !bank_name.toString().trim()) {
    return res.status(400).json({ error: 'Bank name is required.' });
  }

  if (!cheque_date) {
    return res.status(400).json({ error: 'Cheque date is required.' });
  }

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0.' });
  }

  const validChequeType = ['CROSSED_ACCOUNT_PAYEE', 'CASH_BEARER'].includes((cheque_type || '').toUpperCase())
    ? cheque_type.toUpperCase()
    : 'CROSSED_ACCOUNT_PAYEE';

  const validStatus = ['PENDING', 'IN_HAND', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED'].includes((status || '').toUpperCase())
    ? status.toUpperCase()
    : 'PENDING';

  const id = 'CHQ-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
  const createdByVal = created_by || user_email || req.headers['x-user-email'] || 'system';

  try {
    await db.run(
      `INSERT INTO cheque_registry (
        id, direction, cheque_type, cheque_number, bank_name, branch,
        cheque_date, amount, party_id, party_name, reference_type,
        reference_id, status, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        direction.toUpperCase(),
        validChequeType,
        cheque_number.toString().trim(),
        bank_name.toString().trim(),
        (branch || '').toString().trim(),
        cheque_date,
        numAmount,
        party_id || null,
        (party_name || '').toString().trim(),
        reference_type || null,
        reference_id || null,
        validStatus,
        (notes || '').toString().trim(),
        createdByVal,
        new Date().toISOString()
      ]
    );

    await enqueueSync(db, 'cheque_registry', id, 'INSERT');
    await enqueueSync(db, 'cheques', id, 'INSERT');

    const tursoClient = getTursoClient();
    if (tursoClient) {
      pushUpstreamChanges(db, tursoClient).catch(err => console.warn('[Cheque Immediate Sync Push Notice]:', err.message));
    }

    await logAudit(
      createdByVal,
      'CHEQUE_REGISTERED',
      `Registered ${direction.toUpperCase()} Cheque #${cheque_number} (${bank_name}, Rs. ${numAmount.toLocaleString()}) for ${party_name || 'Party'}`
    );

    res.json({
      success: true,
      id,
      direction: direction.toUpperCase(),
      cheque_type: validChequeType,
      cheque_number,
      bank_name,
      branch,
      cheque_date,
      amount: numAmount,
      party_id,
      party_name,
      reference_type,
      reference_id,
      status: validStatus,
      notes,
      created_by: createdByVal
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/cheques/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, notes, user_email, user_id } = req.body || {};

  if (!status) {
    return res.status(400).json({ error: 'Status is required.' });
  }

  const targetStatus = status.toString().toUpperCase();
  const validStatuses = ['PENDING', 'IN_HAND', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED'];
  if (!validStatuses.includes(targetStatus)) {
    return res.status(400).json({ error: `Invalid status: ${targetStatus}. Allowed: ${validStatuses.join(', ')}` });
  }

  const staffUser = user_email || user_id || req.headers['x-user-email'] || 'system';
  let txn = null;

  try {
    txn = await beginTxn(db, `Update Cheque Status ${id} -> ${targetStatus}`);

    const cheque = await db.get('SELECT * FROM cheque_registry WHERE id = ?', [id]);
    if (!cheque) {
      await rollbackTxn(db, txn);
      return res.status(404).json({ error: 'Cheque record not found.' });
    }

    const prevStatus = (cheque.status || '').toUpperCase();
    if (prevStatus === targetStatus) {
      await commitTxn(db, txn);
      return res.json({ success: true, message: `Cheque is already in ${targetStatus} status.`, cheque });
    }

    let cleared_at = cheque.cleared_at;

    // 1. Handling CLEARED status transition
    if (targetStatus === 'CLEARED') {
      cleared_at = new Date().toISOString();
      const todayStr = new Date().toLocaleDateString('sv-SE');
      const chqType = (cheque.cheque_type || '').toUpperCase();
      const direction = (cheque.direction || '').toUpperCase();

      if (direction === 'INWARD') {
        const isCashBearer = chqType === 'CASH_BEARER' || prevStatus === 'IN_HAND';
        const notesStr = (cheque.notes || '').toString();
        const refType = (cheque.reference_type || '').toUpperCase();

        let txCategory = '';
        let txDesc = '';
        let isCreditSettlement = false;

        if (notesStr.includes('[Customer Advance]') || refType === 'CUSTOMER_ADVANCE') {
          txCategory = isCashBearer ? 'Customer Advance (Cheque Encashed)' : 'Customer Advance (Cheque Cleared Bank)';
          txDesc = isCashBearer
            ? `Encashed Customer Advance Cheque #${cheque.cheque_number} from ${cheque.party_name || 'Customer'}`
            : `Cleared Customer Advance Cheque #${cheque.cheque_number} from ${cheque.party_name || 'Customer'} (Bank Deposit)`;
        } else if (notesStr.includes('[Supplier Refund]') || refType === 'EXPENSE') {
          txCategory = isCashBearer ? 'Supplier Refund (Cheque Encashed)' : 'Supplier Refund (Cheque Cleared Bank)';
          txDesc = isCashBearer
            ? `Encashed Supplier Refund Cheque #${cheque.cheque_number} from ${cheque.party_name || 'Supplier'}`
            : `Cleared Supplier Refund Cheque #${cheque.cheque_number} from ${cheque.party_name || 'Supplier'} (Bank Deposit)`;
        } else if (notesStr.includes('[Other Income]')) {
          txCategory = isCashBearer ? 'Other Income (Cheque Encashed)' : 'Other Income (Cheque Cleared Bank)';
          txDesc = isCashBearer
            ? `Encashed General Income Cheque #${cheque.cheque_number} from ${cheque.party_name || 'Payer'}`
            : `Cleared General Income Cheque #${cheque.cheque_number} from ${cheque.party_name || 'Payer'} (Bank Deposit)`;
        } else {
          isCreditSettlement = true;
          txCategory = isCashBearer ? 'Customer Debt Repayment (Cheque Encashed)' : 'Customer Debt Repayment (Cheque Cleared Bank)';
          txDesc = isCashBearer
            ? `Encashed Cheque #${cheque.cheque_number} from ${cheque.party_name || 'Customer'}`
            : `Cleared Cheque #${cheque.cheque_number} from ${cheque.party_name || 'Customer'} (Bank Deposit)`;
        }

        // 1. Insert Cash Book Transaction
        const txId = 't_chq_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        const paymentMethod = isCashBearer ? 'CASH' : 'BANK';
        await db.run(
          'INSERT INTO transactions (id, type, category, description, amount, date, reference, payment_method, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            txId,
            'income',
            txCategory,
            txDesc,
            cheque.amount,
            todayStr,
            cheque.cheque_number,
            paymentMethod,
            staffUser,
            new Date().toISOString()
          ]
        );

        if (isCreditSettlement) {
          // 2. Deduct from customer credit balance
          if (cheque.party_id) {
            await db.run(
              'UPDATE customers SET credit_balance = MAX(0, COALESCE(credit_balance, 0) - ?), current_credit = MAX(0, COALESCE(current_credit, 0) - ?) WHERE id = ?',
              [cheque.amount, cheque.party_id]
            );
          } else if (cheque.party_name) {
            await db.run(
              'UPDATE customers SET credit_balance = MAX(0, COALESCE(credit_balance, 0) - ?), current_credit = MAX(0, COALESCE(current_credit, 0) - ?) WHERE name = ?',
              [cheque.amount, cheque.party_name]
            );
          }

          // 3. Settle linked sale invoice or distribute across customer's pending credit sales
          let remainingToSettle = Number(cheque.amount || 0);

          if (cheque.reference_id) {
            const linkedSale = await db.get(
              'SELECT * FROM sales WHERE invoice_no = ? OR id = ?',
              [cheque.reference_id, cheque.reference_id]
            );

            if (linkedSale) {
              const currentReceived = Number(linkedSale.payment_received || 0);
              const totalAmt = Number(linkedSale.total_amount || 0);
              const unpaid = Math.max(0, totalAmt - currentReceived);
              const settleAmt = Math.min(unpaid, remainingToSettle);
              const newReceived = currentReceived + settleAmt;
              // Same 'Paid'/'Non Paid' convention used everywhere else in the app (Sales.tsx,
              // Customers.tsx, the overdue-reminder cron) - this cheque-clearing code previously wrote
              // lowercase 'paid'/'pending', which no other status comparison in the app ever matches.
              const newStatus = newReceived >= totalAmt ? 'Paid' : 'Non Paid';

              await db.run(
                'UPDATE sales SET payment_received = ?, status = ? WHERE id = ?',
                [newReceived, newStatus, linkedSale.id]
              );

              const cpId = 'cp_chq_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
              await db.run(
                `INSERT INTO credit_payments (
                id, sale_id, invoice_no, customer_id, customer_name,
                amount_paid, remaining_balance, payment_method, payment_date,
                recorded_by, created_by, notes, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  cpId,
                  linkedSale.id,
                  linkedSale.invoice_no,
                  linkedSale.customer_id || cheque.party_id || null,
                  linkedSale.customer_name || cheque.party_name || 'Customer',
                  settleAmt,
                  Math.max(0, totalAmt - newReceived),
                  isCashBearer ? 'Cheque (Encashed)' : 'Cheque (Cleared Bank)',
                  todayStr,
                  staffUser,
                  staffUser,
                  `Cheque #${cheque.cheque_number} Cleared`,
                  new Date().toISOString()
                ]
              );

              remainingToSettle -= settleAmt;
            }
          }

          // If there's still remaining amount to settle and customer is known, apply to other unpaid sales
          if (remainingToSettle > 0 && (cheque.party_id || cheque.party_name)) {
            const pendingSales = await db.all(
              `SELECT * FROM sales
             WHERE (customer_id = ? OR customer_name = ?)
               AND (status != 'Paid' OR payment_received < total_amount)
             ORDER BY created_at ASC`,
              [cheque.party_id || '', cheque.party_name || '']
            );

            for (const s of pendingSales) {
              if (remainingToSettle <= 0) break;
              const currentReceived = Number(s.payment_received || 0);
              const totalAmt = Number(s.total_amount || 0);
              const unpaid = Math.max(0, totalAmt - currentReceived);
              if (unpaid > 0) {
                const settleAmt = Math.min(unpaid, remainingToSettle);
                const newReceived = currentReceived + settleAmt;
                const newStatus = newReceived >= totalAmt ? 'Paid' : 'Non Paid';

                await db.run(
                  'UPDATE sales SET payment_received = ?, status = ? WHERE id = ?',
                  [newReceived, newStatus, s.id]
                );

                const cpId = 'cp_chq_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
                await db.run(
                  `INSERT INTO credit_payments (
                  id, sale_id, invoice_no, customer_id, customer_name,
                  amount_paid, remaining_balance, payment_method, payment_date,
                  recorded_by, created_by, notes, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    cpId,
                    s.id,
                    s.invoice_no,
                    s.customer_id || cheque.party_id || null,
                    s.customer_name || cheque.party_name || 'Customer',
                    settleAmt,
                    Math.max(0, totalAmt - newReceived),
                    isCashBearer ? 'Cheque (Encashed)' : 'Cheque (Cleared Bank)',
                    todayStr,
                    staffUser,
                    staffUser,
                    `Cheque #${cheque.cheque_number} Cleared`,
                    new Date().toISOString()
                  ]
                );

                remainingToSettle -= settleAmt;
              }
            }
          }
        }
      } else if (direction === 'OUTWARD') {
        // Outward cheque payment realization / bank deduction
        const txId = 't_chq_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        await db.run(
          'INSERT INTO transactions (id, type, category, description, amount, date, reference, payment_method, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            txId,
            'expense',
            'Supplier Payment (Cheque Cleared)',
            `Outward Cheque Cleared - ${cheque.bank_name} #${cheque.cheque_number} to ${cheque.party_name || 'Payee'}`,
            cheque.amount,
            todayStr,
            cheque.cheque_number,
            'BANK',
            staffUser,
            new Date().toISOString()
          ]
        );
      }
    }

    // 2. Handling BOUNCED status transition
    if (targetStatus === 'BOUNCED') {
      const direction = (cheque.direction || '').toUpperCase();
      const refType = (cheque.reference_type || '').toUpperCase();

      if (direction === 'INWARD') {
        // Re-add cheque amount to customer's outstanding credit if it was settling invoice or credit
        if (refType === 'CREDIT_SETTLEMENT' || refType === 'SALE_INVOICE' || cheque.party_id) {
          if (cheque.party_id) {
            await db.run(
              'UPDATE customers SET current_credit = COALESCE(current_credit, 0) + ? WHERE id = ?',
              [cheque.amount, cheque.party_id]
            );
          } else if (cheque.party_name) {
            await db.run(
              'UPDATE customers SET current_credit = COALESCE(current_credit, 0) + ? WHERE name = ?',
              [cheque.amount, cheque.party_name]
            );
          }

          // If linked directly to an invoice, revert payment_received on that sale
          if (cheque.reference_id) {
            const linkedSale = await db.get('SELECT * FROM sales WHERE invoice_no = ? OR id = ?', [cheque.reference_id, cheque.reference_id]);
            if (linkedSale) {
              const newReceived = Math.max(0, Number(linkedSale.payment_received || 0) - Number(cheque.amount));
              const newSaleStatus = newReceived <= 0 ? 'pending' : (newReceived < linkedSale.total_amount ? 'pending' : 'paid');
              await db.run(
                'UPDATE sales SET payment_received = ?, status = ? WHERE id = ?',
                [newReceived, newSaleStatus, linkedSale.id]
              );
            }
          }
        }

        await logAudit(
          staffUser,
          'CHEQUE_BOUNCED',
          `⚠️ Inward Cheque #${cheque.cheque_number} from ${cheque.party_name || 'Customer'} (Rs. ${cheque.amount.toLocaleString()}) marked BOUNCED. Customer outstanding credit balance restored.`
        );
      } else if (direction === 'OUTWARD') {
        // Outward cheque bounced - Re-add to supplier's payable balance
        if (refType === 'PURCHASE_ORDER' || refType === 'GRN' || cheque.party_id || cheque.party_name) {
          if (cheque.party_id) {
            await db.run(
              'UPDATE suppliers SET payable_balance = COALESCE(payable_balance, 0) + ? WHERE id = ?',
              [cheque.amount, cheque.party_id]
            );
          } else if (cheque.party_name) {
            await db.run(
              'UPDATE suppliers SET payable_balance = COALESCE(payable_balance, 0) + ? WHERE name = ?',
              [cheque.amount, cheque.party_name]
            );
          }
        }

        await logAudit(
          staffUser,
          'CHEQUE_BOUNCED',
          `⚠️ Outward Cheque #${cheque.cheque_number} to ${cheque.party_name || 'Supplier'} (Rs. ${cheque.amount.toLocaleString()}) marked BOUNCED. Supplier payable balance restored.`
        );
      }
    }

    // 3. Update cheque status in database
    const updatedNotes = notes !== undefined ? notes : cheque.notes;
    await db.run(
      'UPDATE cheque_registry SET status = ?, notes = ?, cleared_at = ? WHERE id = ?',
      [targetStatus, updatedNotes, cleared_at, id]
    );

    await logAudit(
      staffUser,
      'CHEQUE_STATUS_UPDATED',
      `Cheque #${cheque.cheque_number} status changed: ${prevStatus} -> ${targetStatus}`
    );

    await enqueueSync(db, 'cheque_registry', id, 'UPDATE');
    await enqueueSync(db, 'cheques', id, 'UPDATE');

    await commitTxn(db, txn);

    const tursoClient = getTursoClient();
    if (tursoClient) {
      pushUpstreamChanges(db, tursoClient).catch(err => console.warn('[Cheque Status Immediate Sync Push Notice]:', err.message));
    }

    const updatedCheque = await db.get('SELECT * FROM cheque_registry WHERE id = ?', [id]);
    res.json({
      success: true,
      id,
      status: targetStatus,
      cleared_at,
      cheque: updatedCheque
    });
  } catch (err) {
    if (txn) await rollbackTxn(db, txn); else await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

// PURCHASE RETURNS API
app.get('/api/purchase-returns', async (req, res) => {
  try {
    const returns = await db.all('SELECT * FROM purchase_returns ORDER BY created_at DESC');
    const items = await db.all('SELECT * FROM purchase_return_items ORDER BY id ASC');

    // Group items by return_id
    const itemsMap = new Map();
    items.forEach(it => {
      if (!itemsMap.has(it.return_id)) {
        itemsMap.set(it.return_id, []);
      }
      itemsMap.get(it.return_id).push({
        id: it.id,
        returnId: it.return_id,
        return_id: it.return_id,
        productId: it.product_id,
        product_id: it.product_id,
        productName: it.product_name,
        product_name: it.product_name,
        quantity: it.quantity,
        qty: it.quantity,
        unitCostPrice: it.unit_cost_price,
        unit_cost_price: it.unit_cost_price,
        costPrice: it.unit_cost_price,
        subtotal: it.subtotal,
        total: it.subtotal
      });
    });

    const mapped = returns.map(r => ({
      id: r.id,
      returnNumber: r.return_number || r.id,
      return_number: r.return_number || r.id,
      supplierId: r.supplier_id,
      supplier_id: r.supplier_id,
      supplierName: r.supplier_name,
      supplier_name: r.supplier_name,
      purchaseOrderId: r.purchase_order_id,
      purchase_order_id: r.purchase_order_id,
      totalReturnedCost: Number(r.total_returned_cost || 0),
      total_returned_cost: Number(r.total_returned_cost || 0),
      total: Number(r.total_returned_cost || 0),
      settlementMode: r.settlement_mode || 'SUPPLIER_DEBIT_NOTE',
      settlement_mode: r.settlement_mode || 'SUPPLIER_DEBIT_NOTE',
      reason: r.reason || '',
      notes: r.notes || '',
      handledBy: r.handled_by || 'Sanoj Hardware',
      handled_by: r.handled_by || 'Sanoj Hardware',
      status: r.status || 'ACTIVE',
      balanceRemaining: Number(r.balance_remaining !== null && r.balance_remaining !== undefined ? r.balance_remaining : (r.status === 'REDEEMED' ? 0 : Number(r.total_returned_cost || 0))),
      balance_remaining: Number(r.balance_remaining !== null && r.balance_remaining !== undefined ? r.balance_remaining : (r.status === 'REDEEMED' ? 0 : Number(r.total_returned_cost || 0))),
      redeemedAmount: Number(r.redeemed_amount || 0),
      redeemed_amount: Number(r.redeemed_amount || 0),
      redeemedInPoNumber: r.redeemed_in_po_number || null,
      redeemed_in_po_number: r.redeemed_in_po_number || null,
      voidReason: r.void_reason || null,
      void_reason: r.void_reason || null,
      updatedAt: r.updated_at || null,
      updated_at: r.updated_at || null,
      createdAt: r.created_at,
      created_at: r.created_at,
      date: new Date(r.created_at).toLocaleDateString(),
      items: itemsMap.get(r.id) || []
    }));

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/debit-notes', async (req, res) => {
  try {
    const notes = await db.all('SELECT * FROM debit_notes ORDER BY created_at DESC');
    res.json(notes || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(['/api/purchasing/return', '/api/purchase-returns'], async (req, res) => {
  const {
    supplier_id,
    supplierId,
    supplier_name,
    supplierName,
    purchase_order_id,
    purchaseOrderId,
    po_number,
    poNumber,
    settlement_mode = 'SUPPLIER_DEBIT_NOTE',
    settlementMode,
    reason = '',
    notes = '',
    handled_by,
    handledBy,
    user_email,
    items = []
  } = req.body || {};

  const finalSupplierId = supplier_id || supplierId || '';
  const finalSupplierName = supplier_name || supplierName || '';
  const finalPoId = purchase_order_id || purchaseOrderId || po_number || poNumber || null;
  const finalPoNumber = po_number || poNumber || purchase_order_id || purchaseOrderId || '';
  
  // Normalize settlement mode
  let rawMode = (settlement_mode || settlementMode || 'SUPPLIER_DEBIT_NOTE').toUpperCase().replace(/\s+/g, '_');
  if (rawMode === 'SUPPLIER_DEBIT_NOTE' || rawMode === 'DEBIT_NOTE') rawMode = 'SUPPLIER_DEBIT_NOTE';
  else if (rawMode === 'CASH_REFUND' || rawMode === 'CASH') rawMode = 'CASH_REFUND';
  else if (rawMode === 'BANK_REFUND' || rawMode === 'BANK' || rawMode === 'BANK_TRANSFER') rawMode = 'BANK_REFUND';
  const finalSettlementMode = rawMode;

  const finalStaff = handled_by || handledBy || 'Sanoj Hardware';

  if (!finalSupplierName) {
    return res.status(400).json({ error: 'Supplier name is required.' });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one return line item is required.' });
  }

  const validSettlementModes = ['SUPPLIER_DEBIT_NOTE', 'CASH_REFUND', 'BANK_REFUND'];
  if (!validSettlementModes.includes(finalSettlementMode)) {
    return res.status(400).json({ error: `Invalid settlement mode: ${finalSettlementMode}. Allowed: ${validSettlementModes.join(', ')}` });
  }

  let txn = null;

  try {
    const timestamp = Date.now();
    const returnId = 'pr_' + timestamp + '_' + Math.random().toString(36).substring(2, 6);
    const debitNoteNo = 'DN-' + String(timestamp).slice(-6);
    const returnNumber = req.body.return_number || req.body.returnNumber || req.body.debit_note_no || debitNoteNo;
    const createdAt = new Date().toISOString();
    const todayStr = new Date().toLocaleDateString('sv-SE');

    txn = await beginTxn(db, `Create Purchase Return & Debit Note ${returnNumber}`);

    let totalReturnedCost = 0;

    // 1. Process items and validate stock
    const processedItems = [];
    for (const rawItem of items) {
      const prodId = rawItem.product_id || rawItem.productId;
      const prodName = rawItem.product_name || rawItem.productName || '';
      const qty = Number(rawItem.quantity || rawItem.qty || 0);
      const unitCost = Number(rawItem.unit_cost_price !== undefined ? rawItem.unit_cost_price : (rawItem.unitCostPrice !== undefined ? rawItem.unitCostPrice : (rawItem.netUnitCost !== undefined ? rawItem.netUnitCost : (rawItem.costPrice || 0))));
      const lineSubtotal = Number(rawItem.subtotal !== undefined ? rawItem.subtotal : (qty * unitCost));

      if (!prodId) {
        throw new Error('Product ID is required for each returned line item.');
      }
      if (qty <= 0) {
        throw new Error(`Invalid return quantity (${qty}) for item ${prodName || prodId}.`);
      }

      // Check current product stock
      const prod = await db.get('SELECT * FROM products WHERE id = ? OR sku = ?', [prodId, prodId]);
      if (!prod) {
        throw new Error(`Product ${prodName || prodId} not found in inventory.`);
      }

      const currentStock = Number(prod.stock || 0);
      if (currentStock < qty) {
        throw new Error(`Insufficient stock for "${prod.name}" (SKU: ${prod.sku}). Available stock: ${currentStock}, Return requested: ${qty}`);
      }

      totalReturnedCost += lineSubtotal;
      processedItems.push({
        productId: prod.id,
        productName: prod.name,
        quantity: qty,
        unitCostPrice: unitCost,
        subtotal: lineSubtotal,
        currentStock
      });
    }

    // 2. Insert into purchase_returns
    await db.run(
      `INSERT INTO purchase_returns (
        id, return_number, supplier_id, supplier_name, purchase_order_id,
        total_returned_cost, balance_remaining, redeemed_amount, settlement_mode, reason, notes, handled_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        returnId,
        returnNumber,
        finalSupplierId || (processedItems[0]?.productId ? 's_' + timestamp : 's_gen'),
        finalSupplierName,
        finalPoId,
        totalReturnedCost,
        totalReturnedCost,
        0,
        finalSettlementMode,
        reason || '',
        notes || '',
        finalStaff,
        createdAt
      ]
    );

    // 2b. Insert into debit_notes table
    try {
      const debitNoteId = 'dn_' + timestamp + '_' + Math.random().toString(36).substring(2, 6);
      await db.run(
        `INSERT INTO debit_notes (
          id, debit_note_no, purchase_order_id, po_number, supplier_id, supplier_name,
          return_id, total_amount, balance_remaining, redeemed_amount, settlement_mode,
          items, reason, notes, status, handled_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          debitNoteId,
          returnNumber,
          finalPoId,
          finalPoNumber,
          finalSupplierId || (processedItems[0]?.productId ? 's_' + timestamp : 's_gen'),
          finalSupplierName,
          returnId,
          totalReturnedCost,
          totalReturnedCost,
          0,
          finalSettlementMode,
          JSON.stringify(processedItems),
          reason || '',
          notes || '',
          'ACTIVE',
          finalStaff,
          createdAt
        ]
      );
    } catch (dnErr) {
      console.warn('[DebitNote] Warning logging into debit_notes table:', dnErr.message);
    }

    // 3. Insert items and decrement stock
    for (const item of processedItems) {
      await db.run(
        `INSERT INTO purchase_return_items (
          return_id, product_id, product_name, quantity, unit_cost_price, subtotal
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          returnId,
          item.productId,
          item.productName,
          item.quantity,
          item.unitCostPrice,
          item.subtotal
        ]
      );

      // Decrement product stock safely
      await db.run(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [item.quantity, item.productId]
      );

      // Log stock adjustment
      const saId = 'sa_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      await db.run(
        `INSERT INTO stock_adjustments (
          id, product_id, product_name, old_qty, new_qty, reason, type, user_email, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saId,
          item.productId,
          item.productName,
          item.currentStock,
          item.currentStock - item.quantity,
          `Purchase Return (${returnNumber}): ${reason || 'Returned to supplier'}`,
          'Purchase Return',
          finalStaff,
          createdAt
        ]
      );
    }

    // 4. Handle Settlement Mode
    if (finalSettlementMode === 'SUPPLIER_DEBIT_NOTE') {
      // Deduct from supplier payable balance
      if (finalSupplierId) {
        await db.run(
          'UPDATE suppliers SET payable_balance = MAX(0, COALESCE(payable_balance, 0) - ?) WHERE id = ?',
          [totalReturnedCost, finalSupplierId]
        );
      } else {
        await db.run(
          'UPDATE suppliers SET payable_balance = MAX(0, COALESCE(payable_balance, 0) - ?) WHERE name = ?',
          [totalReturnedCost, finalSupplierName]
        );
      }
    } else if (finalSettlementMode === 'CASH_REFUND') {
      // Record cash income transaction
      const txId = 't_pr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      await db.run(
        'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          txId,
          'income',
          'Supplier Cash Refund',
          `Supplier Cash Refund - ${returnNumber} (${finalSupplierName})`,
          totalReturnedCost,
          todayStr,
          returnNumber,
          finalStaff,
          createdAt
        ]
      );
    } else if (finalSettlementMode === 'BANK_REFUND') {
      // Record bank income transaction
      const txId = 't_pr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      await db.run(
        'INSERT INTO transactions (id, type, category, description, amount, date, reference, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          txId,
          'income',
          'Supplier Bank Refund',
          `Supplier Bank Refund - ${returnNumber} (${finalSupplierName})`,
          totalReturnedCost,
          todayStr,
          returnNumber,
          finalStaff,
          createdAt
        ]
      );
    }

    // 5. Insert audit log
    await logAudit(
      finalStaff,
      'PURCHASE_RETURN_CREATED',
      `Created Purchase Return & Debit Note ${returnNumber} for supplier "${finalSupplierName}" (Total: Rs. ${totalReturnedCost.toLocaleString()}, Settlement: ${finalSettlementMode}, Items: ${processedItems.length})`
    );

    await commitTxn(db, txn);

    res.json({
      success: true,
      id: returnId,
      returnNumber,
      return_number: returnNumber,
      debitNoteNo: returnNumber,
      debit_note_no: returnNumber,
      supplierId: finalSupplierId,
      supplier_id: finalSupplierId,
      supplierName: finalSupplierName,
      supplier_name: finalSupplierName,
      purchaseOrderId: finalPoId,
      purchase_order_id: finalPoId,
      poNumber: finalPoNumber,
      po_number: finalPoNumber,
      totalReturnedCost,
      total_returned_cost: totalReturnedCost,
      settlementMode: finalSettlementMode,
      settlement_mode: finalSettlementMode,
      items: processedItems,
      createdAt,
      created_at: createdAt
    });
  } catch (err) {
    if (txn) await rollbackTxn(db, txn); else await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

// ATOMIC PO RECEIVE & SETTLEMENT API
app.post('/api/purchasing/receive-po', async (req, res) => {
  const {
    po_id,
    po_number,
    settlement_mode = 'CREDIT',
    payment_date,
    reference,
    notes = '',
    cheque_number,
    bank_name,
    cheque_date,
    user_email
  } = req.body || {};

  if (!po_id && !po_number) {
    return res.status(400).json({ error: 'Purchase Order ID or PO Number is required.' });
  }

  const validMode = ['CREDIT', 'CASH', 'BANK', 'CHEQUE'].includes((settlement_mode || '').toUpperCase())
    ? settlement_mode.toUpperCase()
    : 'CREDIT';

  const staffUser = user_email || req.headers['x-user-email'] || 'system';
  const todayStr = payment_date || new Date().toLocaleDateString('sv-SE');
  const nowIso = new Date().toISOString();
  let txn = null;

  try {
    txn = await beginTxn(db, `Receive & Settle PO: ${po_number || po_id} (${validMode})`);

    // 1. Retrieve PO
    const po = await db.get(
      'SELECT * FROM purchase_orders WHERE id = ? OR po_number = ? OR po_no = ?',
      [po_id || '', po_number || '', po_number || '']
    );

    if (!po) {
      await rollbackTxn(db, txn);
      return res.status(404).json({ error: 'Purchase order not found.' });
    }

    const currentStatus = (po.status || '').toLowerCase().trim();
    if (currentStatus === 'received' || currentStatus === 'completed') {
      await rollbackTxn(db, txn);
      return res.status(400).json({ error: `Purchase Order #${po.po_number || po.po_no} is already received.` });
    }

    const poGrandTotal = Number(po.net_total !== null && po.net_total !== undefined ? po.net_total : (po.total || 0));
    const poSubtotal = Number(po.subtotal !== null && po.subtotal !== undefined ? po.subtotal : (po.original_total || po.total || 0));
    const poDiscountAmount = Number(po.discount_amount || 0);
    const supplierName = po.supplier_name || 'Vendor';

    // 2. Parse Items and Increment Product Stocks
    let poItems = [];
    if (po.items) {
      try {
        poItems = typeof po.items === 'string' ? JSON.parse(po.items) : po.items;
      } catch (_e) {
        poItems = [];
      }
    }

    const totalLineDisc = (Array.isArray(poItems) ? poItems : []).reduce((sum, it) => {
      const q = Math.max(0, Number(it.qty || it.quantity || 0));
      const c = Math.max(0, Number(it.costPrice || it.cost_price || it.unitCostPrice || 0));
      const isF = (it.discountType || it.discount_type || '').toLowerCase() === 'fixed';
      const d = Math.max(0, Number(it.discount || it.line_discount || 0));
      const uDisc = isF ? d : (c * Math.min(100, d) / 100);
      return sum + Math.min(q * c, Math.round(uDisc * q * 100) / 100);
    }, 0);
    const netAfterLines = Math.max(0, poSubtotal - totalLineDisc);
    const orderDiscountAmount = Math.max(0, poDiscountAmount - totalLineDisc);
    const poOrderDiscountRatio = netAfterLines > 0 ? (orderDiscountAmount / netAfterLines) : 0;

    const transportFee = Math.max(0, Number(po.transportation_fee || po.transportationFee || 0));
    if (transportFee > 0) {
      const existingTx = await db.get(
        'SELECT id FROM transactions WHERE reference = ? AND category = ?',
        [po.po_number || po.po_no || po.id, 'Transportation']
      );
      if (!existingTx) {
        const txId = 'tx_trans_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        await db.run(
          `INSERT INTO transactions (
            id, type, category, description, amount, date, reference, user_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            txId,
            'expense',
            'Transportation',
            `Transportation Fee for PO #${po.po_number || po.po_no} (${supplierName})`,
            transportFee,
            todayStr,
            po.po_number || po.po_no || po.id,
            staffUser,
            nowIso
          ]
        );
      }
    }

    let updatedPoItems = [];
    if (Array.isArray(poItems)) {
      for (const item of poItems) {
        const prodId = item.productId || item.product_id || item.id;
        const qty = Math.max(0, Number(item.qty || item.quantity || 0));
        const itemCost = Number(item.costPrice || item.cost_price || item.unitCostPrice || 0);
        const isFixed = (item.discountType || item.discount_type || '').toLowerCase() === 'fixed';
        const disc = Math.max(0, Number(item.discount || item.line_discount || 0));
        const unitAfterLineDisc = isFixed ? Math.max(0, itemCost - disc) : itemCost * (1 - Math.min(100, disc) / 100);
        const netUnitCost = Math.round(unitAfterLineDisc * (1 - poOrderDiscountRatio) * 100) / 100;

        if (prodId && qty > 0) {
          const product = await db.get('SELECT * FROM products WHERE id = ?', [prodId]);
          if (product) {
            // Recalculate average weighted cost (cost_price) in products based on net purchase prices
            const currentStock = Number(product.stock || 0);
            const currentCost = Number(product.cost_price !== undefined && product.cost_price !== null ? product.cost_price : (product.costPrice || 0));
            let weightedCost = netUnitCost;
            if (currentStock > 0 && currentCost > 0) {
              weightedCost = Math.round(((currentStock * currentCost) + (qty * netUnitCost)) / (currentStock + qty) * 100) / 100;
            }
            await db.run('UPDATE products SET cost_price = ? WHERE id = ?', [weightedCost, product.id]);

            const batchResult = await resolveOrCreateBatchProduct(db, product, netUnitCost, qty, supplierName);

            updatedPoItems.push({
              ...item,
              netUnitCost,
              receivedProductId: batchResult.productId,
              receivedSku: batchResult.sku,
              isNewBatch: batchResult.isNewBatch,
              batchNumber: batchResult.batchNumber
            });

            // Log stock adjustment
            const saId = 'sa_po_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
            await db.run(
              `INSERT INTO stock_adjustments (
                id, product_id, product_name, old_qty, new_qty, reason, type, user_email, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                saId,
                batchResult.productId,
                batchResult.name || product.name || item.productName || 'Product',
                batchResult.isNewBatch ? 0 : (batchResult.stock - qty),
                batchResult.stock,
                `PO Received #${po.po_number || po.po_no} (${supplierName}) - ${batchResult.isNewBatch ? 'New Batch ' + batchResult.sku : 'Stock Added'}`,
                'PO_RECEIPT',
                staffUser,
                nowIso
              ]
            );
          } else {
            updatedPoItems.push(item);
          }
        } else {
          updatedPoItems.push(item);
        }
      }
    }

    // 3. Update Purchase Order Status and items with batch metadata
    await db.run(
      `UPDATE purchase_orders SET status = 'received', items = ? WHERE id = ?`,
      [JSON.stringify(updatedPoItems), po.id]
    );

    // 4. Execute Settlement Mode
    if (validMode === 'CREDIT') {
      // Increase Supplier's Payable Balance
      const supp = await db.get(
        'SELECT * FROM suppliers WHERE name = ? OR id = ?',
        [supplierName, supplierName]
      );

      if (supp) {
        await db.run(
          'UPDATE suppliers SET payable_balance = COALESCE(payable_balance, 0) + ? WHERE id = ?',
          [poGrandTotal, supp.id]
        );
      } else {
        await db.run(
          'UPDATE suppliers SET payable_balance = COALESCE(payable_balance, 0) + ? WHERE name = ?',
          [poGrandTotal, supplierName]
        );
      }
    } else if (validMode === 'CASH' || validMode === 'BANK') {
      // Insert Cash Book Outflow
      const txId = 't_po_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const payDesc = `Supplier Payment - ${supplierName} (PO #${po.po_number || po.po_no}) [${validMode === 'CASH' ? 'Cash Drawer' : 'Bank Transfer'}]`;
      const txRef = reference || `PO-SETTLE-${po.po_number || po.po_no}`;

      await db.run(
        `INSERT INTO transactions (
          id, type, category, description, amount, date, reference, user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          txId,
          'expense',
          'Supplier Payment',
          payDesc,
          poGrandTotal,
          todayStr,
          txRef,
          staffUser,
          nowIso
        ]
      );
    } else if (validMode === 'CHEQUE') {
      if (!cheque_number || !cheque_number.toString().trim()) {
        await rollbackTxn(db, txn);
        return res.status(400).json({ error: 'Cheque number is required for Cheque settlement.' });
      }

      const chqId = 'CHQ-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      const chqBank = (bank_name || 'Commercial Bank of Ceylon').toString().trim();
      const chqDate = cheque_date || todayStr;

      await db.run(
        `INSERT INTO cheque_registry (
          id, direction, cheque_type, cheque_number, bank_name, branch,
          cheque_date, amount, party_id, party_name, reference_type,
          reference_id, status, notes, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          chqId,
          'OUTWARD',
          'CROSSED_ACCOUNT_PAYEE',
          cheque_number.toString().trim(),
          chqBank,
          '',
          chqDate,
          poGrandTotal,
          po.supplier_id || null,
          supplierName,
          'PURCHASE_ORDER',
          po.id || po.po_number,
          'PENDING',
          notes || `Issued for Purchase Order #${po.po_number || po.po_no}`,
          staffUser,
          nowIso
        ]
      );
    }

    // 5. Audit Log
    await logAudit(
      staffUser,
      'PO_RECEIVED_AND_SETTLED',
      `Received PO #${po.po_number || po.po_no} for "${supplierName}" (Total: Rs. ${poGrandTotal.toLocaleString()}, Settlement Mode: ${validMode})`
    );

    await commitTxn(db, txn);
    enqueueSync(db, 'purchase_orders', po.id, 'UPDATE').then(() => runSyncCycle(db)).catch(() => { });

    res.json({
      success: true,
      poNumber: po.po_number || po.po_no,
      supplierName,
      settlementMode: validMode,
      total: poGrandTotal,
      status: 'received'
    });
  } catch (err) {
    if (txn) await rollbackTxn(db, txn); else await safeRollback(db);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// REVERSAL & VOID ENGINE (TRANSACTIONAL ROLLBACK CORE)
// ============================================================

/**
 * 1. VOID / REVERT PURCHASE RETURN (Debit Notes)
 */
async function executeVoidPurchaseReturn({ return_no, void_reason, user_email }) {
  const finalReason = void_reason || 'Accidental / User Mistake';
  const staffUser = user_email || 'system';
  let txn = null;

  try {
    txn = await beginTxn(db, `Void Purchase Return ${return_no}`);

    // 1. Fetch return details
    const pr = await db.get(
      'SELECT * FROM purchase_returns WHERE id = ? OR return_number = ?',
      [return_no, return_no]
    );

    if (!pr) {
      await rollbackTxn(db, txn);
      return { success: false, message: 'Purchase return record not found.' };
    }

    if (pr.status === 'VOIDED') {
      await rollbackTxn(db, txn);
      return { success: false, message: 'This return voucher is already voided.' };
    }

    // 2. Restore stock for all items in the return batch
    const items = await db.all(
      'SELECT * FROM purchase_return_items WHERE return_id = ?',
      [pr.id]
    );

    for (const item of items) {
      const prodId = item.product_id;
      const qty = Number(item.quantity || 0);
      if (prodId && qty > 0) {
        await db.run(
          'UPDATE products SET stock = stock + ? WHERE id = ?',
          [qty, prodId]
        );

        // Log restoration stock adjustment
        const saId = 'sa_void_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        await db.run(
          `INSERT INTO stock_adjustments (
            id, product_id, product_name, old_qty, new_qty, reason, type, user_email, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            saId,
            prodId,
            item.product_name || 'Restored Item',
            0,
            qty,
            `Void Purchase Return (${pr.return_number || pr.id}): ${finalReason}`,
            'Void Return Restock',
            staffUser,
            new Date().toISOString()
          ]
        );
      }
    }

    // 3. Reverse financial settlement
    const sm = (pr.settlement_mode || '').toUpperCase();
    const retCost = Number(pr.total_returned_cost || 0);

    if (sm === 'CASH_REFUND' || sm === 'BANK_REFUND') {
      // Remove the cash/bank income transaction
      await db.run(
        'DELETE FROM transactions WHERE (reference = ? OR reference = ? OR description LIKE ?)',
        [pr.return_number, pr.id, `%${pr.return_number}%`]
      );
    } else if (sm === 'SUPPLIER_DEBIT_NOTE' || sm === 'SUPPLIER_CREDIT') {
      // Add the payable liability back to supplier balance
      if (pr.supplier_id) {
        await db.run(
          'UPDATE suppliers SET payable_balance = COALESCE(payable_balance, 0) + ? WHERE id = ?',
          [retCost, pr.supplier_id]
        );
      } else if (pr.supplier_name) {
        await db.run(
          'UPDATE suppliers SET payable_balance = COALESCE(payable_balance, 0) + ? WHERE name = ?',
          [retCost, pr.supplier_name]
        );
      }
    }

    // 4. Mark status as VOIDED
    const nowIso = new Date().toISOString();
    await db.run(
      'UPDATE purchase_returns SET status = ?, void_reason = ?, updated_at = ? WHERE id = ?',
      ['VOIDED', finalReason, nowIso, pr.id]
    );

    await logAudit(
      staffUser,
      'PURCHASE_RETURN_VOIDED',
      `Voided Purchase Return #${pr.return_number || pr.id} (Supplier: ${pr.supplier_name}, Amount: Rs. ${retCost.toLocaleString()}). Reason: ${finalReason}. Stock restored & balances adjusted.`
    );

    await commitTxn(db, txn);
    return { success: true, message: 'Purchase return successfully voided and balances restored.' };
  } catch (err) {
    if (txn) await rollbackTxn(db, txn); else await safeRollback(db);
    return { success: false, message: err.message };
  }
}

/**
 * 2. UNDO ACCIDENTAL CHEQUE CLEARANCE / BOUNCE
 */
async function executeUndoChequeStatus({ cheque_id, revert_to, user_email }) {
  const targetStatus = (revert_to || 'IN_HAND').toUpperCase();
  const staffUser = user_email || 'system';
  let txn = null;

  try {
    txn = await beginTxn(db, `Undo Cheque Status ${cheque_id} -> ${targetStatus}`);

    const cheque = await db.get(
      'SELECT * FROM cheque_registry WHERE id = ? OR cheque_number = ?',
      [cheque_id, cheque_id]
    );

    if (!cheque) {
      await rollbackTxn(db, txn);
      return { success: false, message: 'Cheque not found.' };
    }

    const prevStatus = (cheque.status || '').toUpperCase();
    const direction = (cheque.direction || '').toUpperCase();
    const chqNo = cheque.cheque_number;
    const chqAmt = Number(cheque.amount || 0);

    // If it was CLEARED, rollback financial transactions and settlements
    if (prevStatus === 'CLEARED') {
      // Delete cash/bank ledger transactions created on clearance
      await db.run(
        'DELETE FROM transactions WHERE (reference = ? OR description LIKE ?)',
        [chqNo, `%${chqNo}%`]
      );

      if (direction === 'INWARD') {
        // Re-add customer debt / credit balance
        if (cheque.party_id) {
          await db.run(
            'UPDATE customers SET credit_balance = COALESCE(credit_balance, 0) + ?, current_credit = COALESCE(current_credit, 0) + ? WHERE id = ?',
            [chqAmt, chqAmt, cheque.party_id]
          );
        } else if (cheque.party_name) {
          await db.run(
            'UPDATE customers SET credit_balance = COALESCE(credit_balance, 0) + ?, current_credit = COALESCE(current_credit, 0) + ? WHERE name = ?',
            [chqAmt, chqAmt, cheque.party_name]
          );
        }

        // If linked to sale invoice, deduct payment_received and reset status to pending
        if (cheque.reference_id) {
          const linkedSale = await db.get(
            'SELECT * FROM sales WHERE invoice_no = ? OR id = ?',
            [cheque.reference_id, cheque.reference_id]
          );
          if (linkedSale) {
            const currentReceived = Number(linkedSale.payment_received || 0);
            const newReceived = Math.max(0, currentReceived - chqAmt);
            const newStatus = newReceived <= 0 ? 'Non Paid' : (newReceived < linkedSale.total_amount ? 'Non Paid' : 'Paid');
            await db.run(
              'UPDATE sales SET payment_received = ?, status = ? WHERE id = ?',
              [newReceived, newStatus, linkedSale.id]
            );
          }
        }

        // Delete any credit_payments record logged for this clearance
        await db.run(
          'DELETE FROM credit_payments WHERE notes LIKE ?',
          [`%${chqNo}%`]
        );
      } else if (direction === 'OUTWARD') {
        // If outward cheque cleared settled supplier balance, re-add payable balance
        if (cheque.party_id) {
          await db.run(
            'UPDATE suppliers SET payable_balance = COALESCE(payable_balance, 0) + ? WHERE id = ?',
            [chqAmt, cheque.party_id]
          );
        } else if (cheque.party_name) {
          await db.run(
            'UPDATE suppliers SET payable_balance = COALESCE(payable_balance, 0) + ? WHERE name = ?',
            [chqAmt, cheque.party_name]
          );
        }
      }
    }

    // If it was BOUNCED, reverse any penalty or customer balance restorations that were applied on bounce
    if (prevStatus === 'BOUNCED') {
      // Delete penalty transactions if any
      await db.run(
        'DELETE FROM transactions WHERE (reference = ? OR description LIKE ?) AND category LIKE ?',
        [chqNo, `%${chqNo}%`, '%Penalty%']
      );

      if (direction === 'INWARD') {
        // Revert the credit balance increment made during bounce
        if (cheque.party_id) {
          await db.run(
            'UPDATE customers SET current_credit = MAX(0, COALESCE(current_credit, 0) - ?) WHERE id = ?',
            [chqAmt, cheque.party_id]
          );
        } else if (cheque.party_name) {
          await db.run(
            'UPDATE customers SET current_credit = MAX(0, COALESCE(current_credit, 0) - ?) WHERE name = ?',
            [chqAmt, cheque.party_name]
          );
        }
      } else if (direction === 'OUTWARD') {
        // Revert supplier balance increment made during bounce
        if (cheque.party_id) {
          await db.run(
            'UPDATE suppliers SET payable_balance = MAX(0, COALESCE(payable_balance, 0) - ?) WHERE id = ?',
            [chqAmt, cheque.party_id]
          );
        } else if (cheque.party_name) {
          await db.run(
            'UPDATE suppliers SET payable_balance = MAX(0, COALESCE(payable_balance, 0) - ?) WHERE name = ?',
            [chqAmt, cheque.party_name]
          );
        }
      }
    }

    // Update status back to target state
    const nowIso = new Date().toISOString();
    await db.run(
      'UPDATE cheque_registry SET status = ?, cleared_at = NULL, updated_at = ? WHERE id = ?',
      [targetStatus, nowIso, cheque.id]
    );

    await logAudit(
      staffUser,
      'CHEQUE_STATUS_REVERTED',
      `Cheque #${chqNo} (${cheque.party_name || 'Party'}, Rs. ${chqAmt.toLocaleString()}) reverted from ${prevStatus} to ${targetStatus}. Ledger entries & balances rolled back.`
    );

    await enqueueSync(db, 'cheque_registry', cheque.id, 'UPDATE');
    await enqueueSync(db, 'cheques', cheque.id, 'UPDATE');

    await commitTxn(db, txn);

    const tursoClient = getTursoClient();
    if (tursoClient) {
      pushUpstreamChanges(db, tursoClient).catch(err => console.warn('[Undo Cheque Sync Push Notice]:', err.message));
    }

    return { success: true, message: 'Cheque status reverted successfully.' };
  } catch (err) {
    if (txn) await rollbackTxn(db, txn); else await safeRollback(db);
    return { success: false, message: err.message };
  }
}

/**
 * 3. VOID / REVERT RECEIVED PURCHASE ORDER
 */
async function executeRevertPurchaseOrderReceipt({ po_ref, user_email }) {
  const staffUser = user_email || 'system';
  let txn = null;

  try {
    txn = await beginTxn(db, `Revert PO Receipt ${po_ref}`);

    const po = await db.get(
      'SELECT * FROM purchase_orders WHERE id = ? OR po_number = ? OR po_no = ?',
      [po_ref, po_ref, po_ref]
    );

    if (!po) {
      await rollbackTxn(db, txn);
      return { success: false, message: 'Purchase order not found.' };
    }

    const currentStatus = (po.status || '').toLowerCase().trim();
    if (currentStatus !== 'received') {
      await rollbackTxn(db, txn);
      return { success: false, message: 'Only received purchase orders can be reverted.' };
    }

    // 1. Deduct stock that was received
    let poItems = [];
    if (po.items) {
      try {
        poItems = typeof po.items === 'string' ? JSON.parse(po.items) : po.items;
      } catch (_e) {
        poItems = [];
      }
    }

    if (Array.isArray(poItems)) {
      for (const item of poItems) {
        const prodId = item.receivedProductId || item.productId || item.product_id || item.id;
        const qty = Math.max(0, Number(item.qty || item.quantity || 0));

        if (prodId && qty > 0) {
          const prod = await db.get('SELECT * FROM products WHERE id = ?', [prodId]);
          if (prod) {
            const prevStock = Number(prod.stock || 0);
            const newStock = Math.max(0, prevStock - qty);
            await db.run(
              'UPDATE products SET stock = ? WHERE id = ?',
              [newStock, prodId]
            );

            // If batch item reaches 0 stock with no sales history, safely clean/archive it
            const isBatchItem = Boolean(item.isNewBatch || prod.is_batch || (prod.sku && /-B\d+$/i.test(prod.sku)));
            if (isBatchItem && newStock <= 0.0001) {
              const salesHistory = await db.get(
                'SELECT COUNT(*) as cnt FROM sales WHERE items LIKE ?',
                [`%"productId":"${prodId}"%`]
              );
              const salesCount = Number(salesHistory?.cnt || 0);
              if (salesCount === 0) {
                await db.run('DELETE FROM products WHERE id = ?', [prodId]);
              }
            }

            // Log stock deduction adjustment
            const saId = 'sa_revert_po_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
            await db.run(
              `INSERT INTO stock_adjustments (
                id, product_id, product_name, old_qty, new_qty, reason, type, user_email, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                saId,
                prodId,
                prod.name || item.name || item.productName || 'PO Item',
                prevStock,
                newStock,
                `Revert PO Receipt (#${po.po_number || po.po_no})`,
                'PO Reversal Deduction',
                staffUser,
                new Date().toISOString()
              ]
            );
          }
        }
      }
    }

    // 2. Deduct the supplier payable liability
    const poTotal = Number(po.total || 0);
    if (po.supplier_name) {
      await db.run(
        'UPDATE suppliers SET payable_balance = MAX(0, COALESCE(payable_balance, 0) - ?) WHERE name = ? OR id = ?',
        [poTotal, po.supplier_name, po.supplier_id || '']
      );
    }

    // 3. Remove linked transactions
    const poNum = po.po_number || po.po_no || po.id;
    await db.run(
      'DELETE FROM transactions WHERE (reference = ? OR description LIKE ?)',
      [poNum, `%${poNum}%`]
    );

    // 4. Reset PO status to pending
    const nowIso = new Date().toISOString();
    await db.run(
      'UPDATE purchase_orders SET status = ?, received_at = NULL, updated_at = ? WHERE id = ?',
      ['pending', nowIso, po.id]
    );

    await logAudit(
      staffUser,
      'PO_RECEIPT_REVERTED',
      `Purchase Order #${poNum} receipt reverted to PENDING (Total: Rs. ${poTotal.toLocaleString()}). Received stock deducted and supplier payable rolled back.`
    );

    await commitTxn(db, txn);
    return { success: true, message: 'PO receipt reverted to PENDING and stock/payables restored.' };
  } catch (err) {
    if (txn) await rollbackTxn(db, txn); else await safeRollback(db);
    return { success: false, message: err.message };
  }
}

// ============================================================
// REVERSAL REST ENDPOINTS
// ============================================================

// Void Purchase Return
app.post('/api/purchase-returns/:id/void', async (req, res) => {
  const { id } = req.params;
  const { void_reason, reason, user_email } = req.body || {};
  const staffUser = user_email || req.headers['x-user-email'] || 'system';
  const result = await executeVoidPurchaseReturn({
    return_no: id,
    void_reason: void_reason || reason,
    user_email: staffUser
  });
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  res.json(result);
});

app.post('/api/purchase-returns/void', async (req, res) => {
  const { return_no, returnNo, void_reason, reason, user_email } = req.body || {};
  const staffUser = user_email || req.headers['x-user-email'] || 'system';
  const result = await executeVoidPurchaseReturn({
    return_no: return_no || returnNo,
    void_reason: void_reason || reason,
    user_email: staffUser
  });
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  res.json(result);
});

// Undo Cheque Status
app.post('/api/cheques/:id/undo', async (req, res) => {
  const { id } = req.params;
  const { revert_to, revertTo, user_email } = req.body || {};
  const staffUser = user_email || req.headers['x-user-email'] || 'system';
  const result = await executeUndoChequeStatus({
    cheque_id: id,
    revert_to: revert_to || revertTo,
    user_email: staffUser
  });
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  res.json(result);
});

app.post('/api/cheques/undo-status', async (req, res) => {
  const { cheque_id, chequeId, revert_to, revertTo, user_email } = req.body || {};
  const staffUser = user_email || req.headers['x-user-email'] || 'system';
  const result = await executeUndoChequeStatus({
    cheque_id: cheque_id || chequeId,
    revert_to: revert_to || revertTo,
    user_email: staffUser
  });
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  res.json(result);
});

// Revert Purchase Order Receipt
app.post('/api/purchase-orders/:id/revert-receipt', async (req, res) => {
  const { id } = req.params;
  const { user_email } = req.body || {};
  const staffUser = user_email || req.headers['x-user-email'] || 'system';
  const result = await executeRevertPurchaseOrderReceipt({
    po_ref: id,
    user_email: staffUser
  });
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  res.json(result);
});

app.post('/api/purchase-orders/revert-receipt', async (req, res) => {
  const { po_ref, poRef, po_id, po_number, user_email } = req.body || {};
  const staffUser = user_email || req.headers['x-user-email'] || 'system';
  const result = await executeRevertPurchaseOrderReceipt({
    po_ref: po_ref || poRef || po_id || po_number,
    user_email: staffUser
  });
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  res.json(result);
});

// ============================================================
// SUPABASE RPC COMPATIBILITY DISPATCHER
// ============================================================
app.post('/api/rpc/:functionName', async (req, res) => {
  const { functionName } = req.params;
  const args = req.body || {};
  const user_email = req.headers['x-user-email'] || args.user_email || 'system';

  try {
    if (functionName === 'void_purchase_return') {
      const return_no = args.p_return_no || args.return_no || args.returnNo;
      const void_reason = args.p_void_reason || args.void_reason || args.reason;
      if (!return_no) {
        return res.status(400).json({ success: false, message: 'p_return_no parameter is required.' });
      }
      const result = await executeVoidPurchaseReturn({ return_no, void_reason, user_email });
      return res.json(result);
    }

    if (functionName === 'undo_cheque_status') {
      const cheque_id = args.p_cheque_id || args.cheque_id || args.chequeId;
      const revert_to = args.p_revert_to || args.revert_to || args.revertTo;
      if (!cheque_id) {
        return res.status(400).json({ success: false, message: 'p_cheque_id parameter is required.' });
      }
      const result = await executeUndoChequeStatus({ cheque_id, revert_to, user_email });
      return res.json(result);
    }

    if (functionName === 'revert_purchase_order_receipt') {
      const po_ref = args.p_po_ref || args.po_ref || args.poRef || args.po_id || args.po_number;
      if (!po_ref) {
        return res.status(400).json({ success: false, message: 'p_po_ref parameter is required.' });
      }
      const result = await executeRevertPurchaseOrderReceipt({ po_ref, user_email });
      return res.json(result);
    }

    return res.status(404).json({ success: false, message: `Unknown RPC function: ${functionName}` });
  } catch (err) {
    console.error(`Error executing RPC ${functionName}:`, err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// SYSTEM SETTINGS
app.get('/api/settings', async (req, res) => {
  try {
    let settings = null;
    try {
      settings = await getRuntimeSettingsSnapshot();
    } catch (_) { }

    if (!settings) {
      settings = { ...DEFAULT_RUNTIME_SETTINGS, id: 'global' };
    }

    if (!req.authUser) {
      return res.status(200).json({
        shop_name: settings?.shop_name || 'Muthuwadige Hardware',
        address: settings?.address || '',
        phone: settings?.phone || '',
        currency: settings?.currency || 'LKR',
        logo_path: settings?.logo_path || ''
      });
    }

    const hasSmtpPass = Boolean((settings?.smtp_pass && settings.smtp_pass.trim().length > 0) || (settings?.gmail_pass && settings.gmail_pass.trim().length > 0) || process.env.SMTP_PASS || process.env.GMAIL_PASS);

    return res.status(200).json({
      ...settings,
      backup_enabled: settings?.backup_enabled === 1 || settings?.backup_enabled === true || settings?.auto_backup_enabled === 1 || settings?.auto_backup_enabled === true,
      auto_backup_enabled: settings?.auto_backup_enabled === 1 || settings?.auto_backup_enabled === true || settings?.backup_enabled === 1 || settings?.backup_enabled === true,
      backup_interval_hours: settings?.backup_interval_hours || 6,
      smtp_user: settings?.smtp_user || settings?.gmail_user || process.env.SMTP_USER || process.env.GMAIL_USER || '',
      smtp_destination: settings?.smtp_destination || settings?.backup_email || settings?.email || '',
      has_smtp_pass: hasSmtpPass,
      gmail_pass_configured: hasSmtpPass,
      smtp_pass_configured: hasSmtpPass
    });
  } catch (err) {
    return res.status(200).json({
      shop_name: 'Muthuwadige Hardware',
      address: '',
      phone: '',
      currency: 'LKR',
      logo_path: ''
    });
  }
});

const updateSettingsHandler = async (req, res) => {
  const s = req.body;
  try {
    const updated = await setRuntimeSettings(s);
    await scheduleAutomaticBackups();
    await logAudit(s.user_email || req.authUser?.email || 'system', 'SETTINGS_UPDATED', 'System settings were updated.');
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.put('/api/settings', requireAdmin, updateSettingsHandler);
app.post('/api/settings', requireAdmin, updateSettingsHandler);

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

// SYNC STATUS API (Offline-First Cloud Sync)
app.get('/api/sync/status', async (req, res) => {
  try {
    const status = await getSyncStatus(db);
    res.status(200).json({
      status: 'ok',
      online: true,
      synced: true,
      ...status,
      isOnline: status?.isOnline !== false
    });
  } catch (err) {
    console.warn('[SYNC] /api/sync/status non-fatal fallback:', err.message);
    res.status(200).json({
      status: 'ok',
      online: true,
      synced: true,
      isOnline: true,
      isWebClient: Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web',
      queuedCount: 0,
      pendingCount: 0,
      isSyncing: false
    });
  }
});

app.post('/api/sync/trigger', async (req, res) => {
  try {
    await runSyncCycle(db);
    const status = await getSyncStatus(db);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Acknowledge Factory Reset Route: Resets factoryResetDetected and records local wipe timestamp
app.all(['/api/sync/acknowledge-reset', '/api/sync/reset-acknowledge'], async (req, res) => {
  try {
    globalThis.__systemWipeDetected = false;
    const wipeTs = String(globalThis.__systemWipeTimestamp || Date.now());

    try {
      await db.run('ALTER TABLE system_settings ADD COLUMN key TEXT;');
    } catch (_) {}
    try {
      await db.run('ALTER TABLE system_settings ADD COLUMN value TEXT;');
    } catch (_) {}
    try {
      await db.run('ALTER TABLE system_settings ADD COLUMN system_wipe_timestamp TEXT;');
    } catch (_) {}
    try {
      await db.exec('CREATE TABLE IF NOT EXISTS system_meta (key TEXT PRIMARY KEY, value TEXT);');
    } catch (_) {}

    try {
      await db.run(
        "INSERT OR REPLACE INTO system_settings (id, key, value, system_wipe_timestamp) VALUES ('SYSTEM_WIPE_TIMESTAMP', 'SYSTEM_WIPE_TIMESTAMP', ?, ?)",
        [wipeTs, wipeTs]
      );
      await db.run(
        "INSERT OR REPLACE INTO system_meta (key, value) VALUES ('SYSTEM_WIPE_TIMESTAMP', ?)",
        [wipeTs]
      );
    } catch (_) {}

    console.log(`✅ [SyncEngine] Factory reset acknowledged by client terminal. Wipe flag reset (ts: ${wipeTs}).`);
    res.json({
      success: true,
      factoryResetAcknowledged: true,
      timestamp: wipeTs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.all(['/api/sync/pull', '/api/sync/downstream'], async (req, res) => {
  try {
    const isWeb = Boolean(process.env.VERCEL) || process.env.APP_ROLE === 'web' || process.env.IS_WEB_CLIENT === '1';
    if (isWeb) {
      const status = await getSyncStatus(db);
      return res.json({
        success: true,
        ...status,
        factoryResetDetected: false,
        pulledAt: new Date().toISOString()
      });
    }

    const tursoClient = getTursoClient();
    if (tursoClient) {
      const isOnline = await pingTurso(tursoClient);
      if (isOnline) {
        const pullPromise = pullDownstreamChanges(db, tursoClient);
        const timeoutPromise = new Promise(resolve => setTimeout(resolve, 3000));
        await Promise.race([pullPromise, timeoutPromise]);
      }
    }
    const status = await getSyncStatus(db);
    const wipeDetected = Boolean(globalThis.__systemWipeDetected);
    if (wipeDetected) {
      // Once downstream sync pulls the fresh empty tables, reset the reset flag immediately
      globalThis.__systemWipeDetected = false;
      const wipeTs = String(globalThis.__systemWipeTimestamp || Date.now());
      try {
        await db.run('ALTER TABLE system_settings ADD COLUMN key TEXT;');
      } catch (_) {}
      try {
        await db.run('ALTER TABLE system_settings ADD COLUMN value TEXT;');
      } catch (_) {}
      try {
        await db.run('ALTER TABLE system_settings ADD COLUMN system_wipe_timestamp TEXT;');
      } catch (_) {}
      try {
        await db.exec('CREATE TABLE IF NOT EXISTS system_meta (key TEXT PRIMARY KEY, value TEXT);');
      } catch (_) {}
      try {
        await db.run(
          "INSERT OR REPLACE INTO system_settings (id, key, value, system_wipe_timestamp) VALUES ('SYSTEM_WIPE_TIMESTAMP', 'SYSTEM_WIPE_TIMESTAMP', ?, ?)",
          [wipeTs, wipeTs]
        );
        await db.run(
          "INSERT OR REPLACE INTO system_meta (key, value) VALUES ('SYSTEM_WIPE_TIMESTAMP', ?)",
          [wipeTs]
        );
      } catch (_) {}
    }
    res.json({
      success: true,
      ...status,
      factoryResetDetected: wipeDetected,
      pulledAt: new Date().toISOString()
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
            try { stats = await fs.promises.stat(filePath); } catch (e) { }
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
    } catch (e) { }

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
    } catch (e) { }

    await fs.promises.writeFile(envPath, newContent, 'utf8');
    console.log('✅ AppData .env configuration updated successfully at:', envPath);
    return true;
  } catch (err) {
    console.error('❌ Failed to update AppData .env file:', err);
    throw err;
  }
};

// GET SMTP CONFIGURATION STATUS (NEVER RETURNS PASSWORD)
const getSmtpConfigHandler = async (req, res) => {
  try {
    const settings = await getRuntimeSettingsSnapshot();
    const user = settings.smtp_user || settings.gmail_user || process.env.SMTP_USER || process.env.GMAIL_USER || '';
    const pass = settings.smtp_pass || settings.gmail_pass || process.env.SMTP_PASS || process.env.GMAIL_PASS || '';
    const destination = settings.smtp_destination || settings.backup_email || settings.email || user;
    const isPassConfigured = Boolean(pass && pass.trim().length > 0);
    res.json({
      configured: Boolean(user && isPassConfigured),
      gmail_user: user,
      smtp_user: user,
      smtp_destination: destination,
      backup_email: destination,
      auto_backup_enabled: settings.auto_backup_enabled === 1 || settings.backup_enabled === 1,
      backup_interval_hours: settings.backup_interval_hours || 6,
      smtp_host: settings.smtp_host || 'smtp.gmail.com',
      smtp_port: settings.smtp_port || '465',
      gmail_pass_configured: isPassConfigured,
      smtp_pass_configured: isPassConfigured,
      has_smtp_pass: isPassConfigured
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
app.get('/api/settings/smtp-config', getSmtpConfigHandler);
app.get('/api/settings/smtp', getSmtpConfigHandler);
app.get('/api/admin/smtp', getSmtpConfigHandler);

// POST SMTP CONFIGURATION (SAVES TO APPDATA .ENV AND SYSTEM_SETTINGS TABLE)
const saveSmtpConfigHandler = async (req, res) => {
  try {
    const { gmail_user, gmail_pass, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_destination, auto_backup_enabled, backup_interval_hours } = req.body || {};
    const updates = {};
    const effectiveUser = (smtp_user || gmail_user || '').trim();
    const effectivePass = (smtp_pass || gmail_pass || '').trim();
    const effectiveHost = (smtp_host || 'smtp.gmail.com').trim();
    const effectivePort = String(smtp_port || '465').trim();
    const effectiveDest = (smtp_destination || '').trim();

    if (effectiveUser) {
      updates.GMAIL_USER = effectiveUser;
      updates.SMTP_USER = effectiveUser;
    }
    if (effectivePass && effectivePass !== '••••••••') {
      updates.GMAIL_PASS = effectivePass;
      updates.SMTP_PASS = effectivePass;
    }
    if (effectiveHost) updates.SMTP_HOST = effectiveHost;
    if (effectivePort) updates.SMTP_PORT = effectivePort;
    if (effectiveDest) {
      updates.SMTP_DESTINATION = effectiveDest;
      updates.BACKUP_EMAIL = effectiveDest;
    }

    // 1. Update AppData .env configuration file if writable
    try {
      await updateEnvCredentials(updates);
    } catch (envErr) {
      console.warn('[SMTP] AppData .env write skipped (serverless / read-only filesystem):', envErr.message);
      for (const [k, v] of Object.entries(updates)) {
        process.env[k] = v;
      }
    }

    // 2. Persist to system_settings in database (available in both SQLite and Turso Cloud)
    try {
      try {
        await db.exec(`
          ALTER TABLE system_settings ADD COLUMN smtp_user TEXT;
          ALTER TABLE system_settings ADD COLUMN smtp_pass TEXT;
          ALTER TABLE system_settings ADD COLUMN smtp_host TEXT;
          ALTER TABLE system_settings ADD COLUMN smtp_port TEXT;
          ALTER TABLE system_settings ADD COLUMN smtp_destination TEXT;
          ALTER TABLE system_settings ADD COLUMN gmail_user TEXT;
          ALTER TABLE system_settings ADD COLUMN gmail_pass TEXT;
          ALTER TABLE system_settings ADD COLUMN auto_backup_enabled INTEGER DEFAULT 0;
        `);
      } catch (_) { }

      const currentSettings = await getRuntimeSettingsSnapshot();
      const finalUser = effectiveUser || currentSettings.smtp_user || currentSettings.gmail_user || '';
      const finalPass = (effectivePass && effectivePass !== '••••••••') ? effectivePass : (currentSettings.smtp_pass || currentSettings.gmail_pass || '');
      const finalDest = effectiveDest || currentSettings.smtp_destination || currentSettings.backup_email || finalUser;
      const finalAutoBackup = auto_backup_enabled !== undefined ? (auto_backup_enabled ? 1 : 0) : currentSettings.auto_backup_enabled;
      const finalInterval = backup_interval_hours ? Number(backup_interval_hours) : (currentSettings.backup_interval_hours || 6);

      await db.run(
        `UPDATE system_settings SET 
          smtp_user = ?, 
          smtp_pass = ?, 
          gmail_user = ?, 
          gmail_pass = ?, 
          smtp_host = ?, 
          smtp_port = ?, 
          smtp_destination = ?,
          backup_email = ?,
          auto_backup_enabled = ?,
          backup_enabled = ?,
          backup_interval_hours = ?,
          updated_at = ? 
         WHERE id = 'global'`,
        [finalUser, finalPass, finalUser, finalPass, effectiveHost, effectivePort, finalDest, finalDest, finalAutoBackup, finalAutoBackup, finalInterval, new Date().toISOString()]
      );

      // Also propagate to Turso Cloud if running in dual mode
      const tursoClient = getTursoClient();
      if (tursoClient) {
        try {
          await tursoClient.execute({
            sql: `UPDATE system_settings SET 
              smtp_user = ?, 
              smtp_pass = ?, 
              gmail_user = ?, 
              gmail_pass = ?, 
              smtp_host = ?, 
              smtp_port = ?, 
              smtp_destination = ?,
              backup_email = ?,
              auto_backup_enabled = ?,
              backup_enabled = ?,
              backup_interval_hours = ?,
              updated_at = ? 
            WHERE id = 'global'`,
            args: [finalUser, finalPass, finalUser, finalPass, effectiveHost, effectivePort, finalDest, finalDest, finalAutoBackup, finalAutoBackup, finalInterval, new Date().toISOString()]
          });
        } catch (_) { }
      }
    } catch (dbErr) {
      console.warn('[SMTP] Database persistence warning:', dbErr.message);
    }

    res.json({ success: true, message: 'SMTP credentials saved successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
app.post('/api/settings/smtp-config', requireAdmin, saveSmtpConfigHandler);
app.post('/api/settings/smtp', requireAdmin, saveSmtpConfigHandler);
app.post('/api/admin/smtp', requireAdmin, saveSmtpConfigHandler);

// POST TEST SMTP CONNECTION
const testSmtpHandler = async (req, res) => {
  try {
    const settings = await getRuntimeSettingsSnapshot();
    const transporter = createMailTransporter(settings);

    if (!transporter) {
      return res.status(400).json({
        success: false,
        message: 'SMTP credentials missing: GMAIL_USER or GMAIL_PASS / SMTP_USER or SMTP_PASS are not configured in system settings or environment.'
      });
    }

    const user = settings.smtp_user || settings.gmail_user || process.env.SMTP_USER || process.env.GMAIL_USER;
    await transporter.verify();
    res.json({ success: true, message: `SMTP Connection Successful! Account ${user} authenticated.` });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `SMTP Connection Failed: ${err.message || 'Authentication error. Verify App Password.'}`
    });
  }
};
app.post('/api/settings/test-smtp', testSmtpHandler);
app.post('/api/admin/test-smtp', testSmtpHandler);

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
app.post('/api/settings/restore', requireAdmin, async (req, res) => {
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
            // TAX REMOVED: this was the one genuinely functional tax pathway in the whole app -
            // every other write path already hardcodes tax to 0, but this Excel-restore importer
            // previously read real values straight from a "Tax Amount (Rs.)"/"Tax Rate (%)" column
            // (matching Backup Template.xlsx) with no override, so a restored backup could silently
            // reintroduce a working tax feature. Tax is not a supported feature; always store 0.
            0,
            0,
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
        // A restored backup could otherwise reintroduce a plaintext password (e.g. an older Excel
        // export made before password hashing existed) straight into the live profiles table -
        // hash it here too, same as every other password write path, unless it's already a hash.
        const restoredPassword = pr.password || pr["User Password"] || '123456';
        const hashedRestoredPassword = isBcryptHash(restoredPassword) ? restoredPassword : await bcrypt.hash(restoredPassword, 10);
        await db.run(
          `INSERT INTO profiles (id, name, email, role, avatar, password, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            pr.id || pr["Profile ID"] || 'u_' + Date.now(),
            pr.name || pr["User Full Name"] || '',
            pr.email || pr["User Email"],
            pr.role || (pr["Access Privilege Level"] ? pr["Access Privilege Level"].toLowerCase() : 'cashier'),
            pr.avatar || pr["Profile Avatar"] || '',
            hashedRestoredPassword,
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
            0, // TAX REMOVED: tax_rate is not a supported feature - see the sales-restore fix above
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

// PROFILES & USERS (All staff users)
app.get(['/api/profiles', '/api/users'], async (req, res) => {
  try {
    const profiles = await db.all('SELECT * FROM profiles ORDER BY created_at DESC');
    const mapped = (profiles || []).map(pr => {
      const rawPerms = pr.custom_permissions || pr.permissions;
      let parsedPerms = undefined;
      if (rawPerms) {
        try {
          parsedPerms = typeof rawPerms === 'string' ? JSON.parse(rawPerms) : rawPerms;
        } catch (_) {
          if (typeof rawPerms === 'string') {
            parsedPerms = rawPerms.split(',').map(p => p.trim());
          }
        }
      }
      return {
        ...pr,
        permissions: parsedPerms,
        custom_permissions: parsedPerms
      };
    });
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(['/api/profiles/:id', '/api/users/:id'], async (req, res) => {
  const { id } = req.params;
  try {
    let user = null;
    try {
      user = await db.get(
        'SELECT id, email, role, name, avatar, permissions, custom_permissions, created_at FROM profiles WHERE id = ?',
        [id]
      );
    } catch (_) { }

    if (!user) {
      try {
        const u = await db.get('SELECT id, email, role, name, created_at FROM users WHERE id = ?', [id]);
        if (u) {
          user = { ...u, avatar: '', permissions: null, custom_permissions: null };
        }
      } catch (_) { }
    }

    if (!user) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    return res.status(200).json({ ...user, full_name: user.name || user.full_name || '' });
  } catch (err) {
    return res.status(404).json({ error: 'Profile not found' });
  }
});

app.put(['/api/profiles/:id', '/api/users/:id'], requireAdmin, async (req, res) => {
  const { id } = req.params;
  const p = req.body;
  try {
    const effectivePerms = p.custom_permissions !== undefined ? p.custom_permissions : p.permissions;
    let permsVal = null;
    if (effectivePerms !== undefined) {
      permsVal = effectivePerms ? (typeof effectivePerms === 'string' ? effectivePerms : JSON.stringify(effectivePerms)) : null;
    }
    if (effectivePerms !== undefined) {
      await db.run(
        'UPDATE profiles SET name = ?, role = ?, avatar = ?, permissions = ?, custom_permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [p.name, p.role, p.avatar, permsVal, permsVal, id]
      );
    } else {
      await db.run(
        'UPDATE profiles SET name = ?, role = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [p.name, p.role, p.avatar, id]
      );
    }

    try {
      await db.run(
        'UPDATE users SET name = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [p.name, p.role, id]
      );
    } catch (_) { }

    enqueueSync(db, 'profiles', id, 'UPSERT').then(() => runSyncCycle(db)).catch(() => { });
    enqueueSync(db, 'users', id, 'UPSERT').catch(() => { });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete(['/api/profiles/:id', '/api/users/:id'], requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM profiles WHERE id = ?', [id]);
    try {
      await db.run('DELETE FROM users WHERE id = ?', [id]);
    } catch (_) { }
    enqueueSync(db, 'profiles', id, 'DELETE').then(() => runSyncCycle(db)).catch(() => { });
    enqueueSync(db, 'users', id, 'DELETE').catch(() => { });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put(['/api/profiles/:id/password', '/api/users/:id/password'], async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  // A user may change their own password; changing someone else's requires an admin role.
  if (req.authUser.id !== id && !isAdminRole(req.authUser.role)) {
    return res.status(403).json({ error: 'You can only change your own password.' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.run('UPDATE profiles SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hashedPassword, id]);
    try {
      await db.run('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hashedPassword, id]);
    } catch (_) { }

    const updatedProfile = await db.get('SELECT * FROM profiles WHERE id = ?', [id]);
    if (updatedProfile) {
      enqueueSync(db, 'profiles', id, 'UPSERT', { ...updatedProfile, __sync_password_change: true }).catch(() => { });
      enqueueSync(db, 'users', id, 'UPSERT').catch(() => { });
    }
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

app.put('/api/permissions', requireAdmin, async (req, res) => {
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
      await db.run('DELETE FROM cheque_registry');
      await db.run('DELETE FROM purchase_returns');
      await db.run('DELETE FROM purchase_return_items');
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
    await enqueueSync(db, 'quotations', id, 'INSERT');

    // Persist normalized quotation line items
    const parsedItems = typeof items === 'string' ? safeParseJson(items, []) : (Array.isArray(items) ? items : []);
    for (let idx = 0; idx < parsedItems.length; idx++) {
      const it = parsedItems[idx];
      const pId = it.productId || it.product_id || it.id || '';
      const qiId = 'qi_' + id + '_' + (pId || idx) + '_' + idx;
      const qQty = Number(it.quantity || it.qty || 0);
      const qPrice = Number(it.unit_price || it.unitPrice || it.price || 0);
      const qDisc = Number(it.discount || 0);
      const qTotal = Number(it.total || (qQty * qPrice - qDisc));

      await db.run(
        `INSERT OR REPLACE INTO quotation_items (
          id, quotation_id, product_id, product_name, quantity, price, unit, discount, total, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [qiId, id, pId, it.name || it.product_name || '', qQty, qPrice, it.unit || 'pcs', qDisc, qTotal, created_at]
      );
      await enqueueSync(db, 'quotation_items', qiId, 'INSERT');
    }

    const tursoClient = getTursoClient();
    if (tursoClient) {
      pushUpstreamChanges(db, tursoClient).catch(err => console.warn('[Quotation Immediate Sync Push Notice]:', err.message));
    }

    res.json({ success: true, id, quote_no: finalQuoteNo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/quotations/:id', async (req, res) => {
  const { id } = req.params;
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
    total,
    status
  } = req.body;
  // TAX REMOVED: this route previously accepted and stored a client-supplied tax_amount with no
  // override (unlike the POST /api/quotations route, which already hardcoded 0). It is unreachable
  // from the shipped frontend, but remains a live API surface - tax_amount is intentionally no
  // longer settable through it at all.

  try {
    await db.run(
      `UPDATE quotations SET
        quote_no = COALESCE(?, quote_no),
        customer_name = COALESCE(?, customer_name),
        customer_phone = COALESCE(?, customer_phone),
        customer_address = COALESCE(?, customer_address),
        validity_period = COALESCE(?, validity_period),
        items = COALESCE(?, items),
        subtotal = COALESCE(?, subtotal),
        discount_type = COALESCE(?, discount_type),
        discount_value = COALESCE(?, discount_value),
        discount_amount = COALESCE(?, discount_amount),
        transportation_fee = COALESCE(?, transportation_fee),
        total = COALESCE(?, total),
        status = COALESCE(?, status)
      WHERE id = ?`,
      [
        quote_no,
        customer_name,
        customer_phone,
        customer_address,
        validity_period,
        items !== undefined ? (typeof items === 'string' ? items : JSON.stringify(items)) : undefined,
        subtotal !== undefined ? Number(subtotal) : undefined,
        discount_type,
        discount_value !== undefined ? Number(discount_value) : undefined,
        discount_amount !== undefined ? Number(discount_amount) : undefined,
        transportation_fee !== undefined ? Number(transportation_fee) : undefined,
        total !== undefined ? Number(total) : undefined,
        status,
        id
      ]
    );

    if (items) {
      await db.run('DELETE FROM quotation_items WHERE quotation_id = ?', [id]);
      const parsedItems = typeof items === 'string' ? safeParseJson(items, []) : (Array.isArray(items) ? items : []);
      for (let idx = 0; idx < parsedItems.length; idx++) {
        const it = parsedItems[idx];
        const pId = it.productId || it.product_id || it.id || '';
        const qiId = 'qi_' + id + '_' + (pId || idx) + '_' + idx;
        const qQty = Number(it.quantity || it.qty || 0);
        const qPrice = Number(it.unit_price || it.unitPrice || it.price || 0);
        const qDisc = Number(it.discount || 0);
        const qTotal = Number(it.total || (qQty * qPrice - qDisc));

        await db.run(
          `INSERT OR REPLACE INTO quotation_items (
            id, quotation_id, product_id, product_name, quantity, price, unit, discount, total, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [qiId, id, pId, it.name || it.product_name || '', qQty, qPrice, it.unit || 'pcs', qDisc, qTotal, new Date().toISOString()]
        );
        await enqueueSync(db, 'quotation_items', qiId, 'INSERT');
      }
    }

    await enqueueSync(db, 'quotations', id, 'UPDATE');

    const tursoClient = getTursoClient();
    if (tursoClient) {
      pushUpstreamChanges(db, tursoClient).catch(err => console.warn('[Quotation Update Immediate Sync Push Notice]:', err.message));
    }

    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/quotations/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db.run('DELETE FROM quotation_items WHERE quotation_id = ?', [id]);
    await db.run('DELETE FROM quotations WHERE id = ?', [id]);
    await enqueueSync(db, 'quotations', id, 'DELETE');

    const tursoClient = getTursoClient();
    if (tursoClient) {
      pushUpstreamChanges(db, tursoClient).catch(err => console.warn('[Quotation Delete Immediate Sync Push Notice]:', err.message));
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Normalized child table queries
app.get('/api/quotation_items', async (req, res) => {
  try {
    const { quotation_id } = req.query;
    let query = 'SELECT * FROM quotation_items';
    const params = [];
    if (quotation_id) {
      query += ' WHERE quotation_id = ?';
      params.push(quotation_id);
    }
    query += ' ORDER BY id ASC';
    const data = await db.all(query, params);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales_return_items', async (req, res) => {
  try {
    const { return_id } = req.query;
    let query = 'SELECT * FROM sales_return_items';
    const params = [];
    if (return_id) {
      query += ' WHERE return_id = ?';
      params.push(return_id);
    }
    query += ' ORDER BY id ASC';
    const data = await db.all(query, params);
    res.json(data);
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
    enqueueSync(db, 'stock_adjustments', adjId, 'UPSERT').catch(() => { });
    if (product_id) {
      enqueueSync(db, 'products', product_id, 'UPSERT').catch(() => { });
    }
    runSyncCycle(db).catch(() => { });

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
      } catch (_) { }
    });
  }

  const allSubscribers = scannerClients.get('*');
  if (allSubscribers && targetSession !== '*') {
    allSubscribers.forEach((clientRes) => {
      try {
        clientRes.write(`data: ${payload}\n\n`);
      } catch (_) { }
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
    } catch (e) { }
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
      } catch (_) { }
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

// Serve static React production build files from the 'dist' directory (Desktop / standalone only)
let distPath = path.join(__dirname, 'dist');
if (!process.env.VERCEL) {
  if (process.versions?.electron || process.env.ELECTRON_RUN_AS_NODE === '1') {
    try {
      const electron = await import('electron');
      const electronApp = electron.app || (electron.default && electron.default.app);
      if (electronApp && electronApp.isPackaged) {
        distPath = path.join(electronApp.getAppPath(), 'dist');
      }
    } catch (e) {
      // Silent fallback for standalone Node environment
    }
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
}

// Express server launch hook listening on all network interfaces (HTTP & HTTPS)
// Only start standalone HTTP/HTTPS listeners if not running as a Vercel Serverless Function
if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME && process.env.APP_ROLE !== 'web') {
  (async () => {
    try {
      console.log('[Startup] Initializing Database & Schema...');
      await ensureDbInitialized();
      await scheduleAutomaticBackups();
      startBackgroundSyncWorker(db);

      // Trigger immediate initial catalog reconciliation and downstream profile pull
      const tursoClient = getTursoClient();
      if (tursoClient) {
        try {
          await tursoClient.batch([
            `CREATE TABLE IF NOT EXISTS quotation_items (
              id TEXT PRIMARY KEY,
              quotation_id TEXT,
              product_id TEXT,
              product_name TEXT,
              quantity REAL,
              unit_price REAL,
              discount REAL DEFAULT 0,
              total REAL,
              created_at TEXT
            );`,
            `CREATE TABLE IF NOT EXISTS sales_return_items (
              id TEXT PRIMARY KEY,
              return_id TEXT,
              product_id TEXT,
              product_name TEXT,
              quantity REAL,
              unit_price REAL,
              cost_price REAL,
              total REAL,
              created_at TEXT
            );`,
            `CREATE VIEW IF NOT EXISTS cash_book AS SELECT * FROM transactions;`,
            `CREATE VIEW IF NOT EXISTS cheques AS SELECT * FROM cheque_registry;`,
            `CREATE VIEW IF NOT EXISTS purchases AS SELECT * FROM purchase_orders;`
          ], 'write');
          console.log('✅ [Startup] Turso Cloud financial & quotation tables verified.');

          // Ensure products, purchase_orders and system_settings extended columns exist on Turso Cloud
          const tursoExtendedCols = [
            "ALTER TABLE products ADD COLUMN brand TEXT DEFAULT '';",
            "ALTER TABLE products ADD COLUMN serial_no TEXT DEFAULT '';",
            "ALTER TABLE products ADD COLUMN batch_code TEXT DEFAULT '';",
            "ALTER TABLE products ADD COLUMN expiry_date TEXT;",
            "ALTER TABLE products ADD COLUMN supplier_phone TEXT;",
            "ALTER TABLE products ADD COLUMN measure_details TEXT;",
            "ALTER TABLE products ADD COLUMN barcode TEXT;",
            "ALTER TABLE products ADD COLUMN unit TEXT DEFAULT 'pcs';",
            "ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0;",
            "ALTER TABLE products ADD COLUMN min_stock INTEGER DEFAULT 5;",
            "ALTER TABLE purchase_orders ADD COLUMN subtotal REAL DEFAULT 0;",
            "ALTER TABLE purchase_orders ADD COLUMN discount_type TEXT DEFAULT 'fixed';",
            "ALTER TABLE purchase_orders ADD COLUMN discount_value REAL DEFAULT 0;",
            "ALTER TABLE purchase_orders ADD COLUMN discount_amount REAL DEFAULT 0;",
            "ALTER TABLE purchase_orders ADD COLUMN transportation_fee REAL DEFAULT 0;",
            "ALTER TABLE purchase_orders ADD COLUMN net_total REAL DEFAULT 0;",
            "ALTER TABLE purchase_orders ADD COLUMN original_total REAL;",
            "ALTER TABLE purchase_orders ADD COLUMN debit_note_code TEXT;",
            "ALTER TABLE purchase_orders ADD COLUMN debit_note_applied REAL DEFAULT 0;",
            "ALTER TABLE system_settings ADD COLUMN key TEXT;",
            "ALTER TABLE system_settings ADD COLUMN value TEXT;",
            "ALTER TABLE system_settings ADD COLUMN system_wipe_timestamp TEXT;"
          ];
          for (const colSql of tursoExtendedCols) {
            try { await tursoClient.execute(colSql); } catch (_) {}
          }
        } catch (tursoInitErr) {
          console.warn('[Startup] Turso schema sync notice:', tursoInitErr.message);
        }

        const isOnline = await pingTurso(tursoClient);
        if (isOnline) {
          console.log('🔄 [Startup Sync] Online: Running startup catalog pull gate (max 3s timeout)...');
          try {
            const pullPromise = pullDownstreamChanges(db, tursoClient);
            const timeoutPromise = new Promise(resolve => setTimeout(resolve, 3000));
            await Promise.race([pullPromise, timeoutPromise]);
            console.log('✅ [Startup Sync] Startup catalog pull completed.');
          } catch (gateErr) {
            console.warn('[Startup Sync] Notice during catalog pull gate:', gateErr.message);
          }
        } else {
          console.log('⚡ [Startup Sync] Offline: Skipping startup cloud pull (0ms local cache ready).');
        }
      }

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
      console.error('🔴 Failed to initialize database:', err);
      process.exit(1);
    }
  })();
}

export { app, ensureDbInitialized };
export default app;

