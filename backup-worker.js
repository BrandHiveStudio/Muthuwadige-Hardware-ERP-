#!/usr/bin/env node

/**
 * Backup Worker Process — Authoritative Production Pipeline
 * Generates full 15-worksheet Excel workbook matching Master Template
 * Sends compact executive HTML email report matching approved design
 * Spawned by main Express server using ELECTRON_RUN_AS_NODE=1
 */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import XLSX from 'xlsx-js-style';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { createMailTransporter, sendBackupEmail } from './src/utils/mailer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let candidateDbs = [
  process.env.DB_FILE,
  process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, 'hardware.db') : null,
  path.join(__dirname, 'hardware.db'),
  process.env.APPDATA ? path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', 'hardware.db') : null
].filter(Boolean);

let DB_FILE = candidateDbs.find(p => fs.existsSync(p)) || path.join(__dirname, 'hardware.db');

let backupsDir = process.env.BACKUPS_DIR || (process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, 'backups') : path.join(__dirname, 'backups'));
let envPath = process.env.ENV_PATH || (process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, '.env') : path.join(__dirname, '.env'));

if (!fs.existsSync(backupsDir)) {
  try { fs.mkdirSync(backupsDir, { recursive: true }); } catch (e) { }
}

dotenv.config({ path: envPath });

const LOCK_FILE = path.join(backupsDir, '.backup.lock');

const log = (msg) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [BACKUP-WORKER] ${msg}`);
};

const logError = (msg) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [BACKUP-WORKER] ERROR: ${msg}`);
};

const isProcessStillRunning = (pid) => {
  if (!pid || typeof pid !== 'number' || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false;
    return true;
  }
};

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
    log('Database opened successfully');
    return db;
  } catch (err) {
    logError(`Failed to open database: ${err.message}`);
    throw err;
  }
}

const isDecimalUnit = (unit) => {
  if (!unit) return false;
  const PREDEFINED_UNITS = ['pcs', 'kg', 'g', 'liters', 'ml', 'meters', 'boxes', 'packets', 'rolls', 'bundles'];
  const decimals = ['kg', 'g', 'liters', 'ml', 'meters'];
  const name = unit.toLowerCase().trim();
  return decimals.includes(name) || !PREDEFINED_UNITS.includes(name);
};

const setColWidths = (ws, structuredData, headers) => {
  if (!structuredData || structuredData.length === 0) {
    if (headers) {
      ws['!cols'] = headers.map(h => ({ wch: Math.max(h.toString().length + 8, 22) }));
    }
    return;
  }
  const keys = headers || Object.keys(structuredData[0]);
  ws['!cols'] = keys.map(key => {
    let maxLen = key.toString().length;
    structuredData.forEach(row => {
      const val = row[key];
      if (val !== null && val !== undefined) {
        const valLen = val.toString().length;
        if (valLen > maxLen) maxLen = valLen;
      }
    });
    return { wch: Math.min(Math.max(maxLen + 8, 22), 65) };
  });
};

const setRowHeights = (ws) => {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const rows = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    if (r === range.s.r) {
      rows.push({ hpt: 40 });
    } else {
      const firstCellRef = XLSX.utils.encode_cell({ r, c: range.s.c });
      const firstCell = ws[firstCellRef];
      if (firstCell && (String(firstCell.v).toUpperCase() === 'TOTAL' || String(firstCell.v).toUpperCase() === 'SUMMARY')) {
        rows.push({ hpt: 34 });
      } else {
        rows.push({ hpt: 28 });
      }
    }
  }
  ws['!rows'] = rows;
};

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

  if (!cleanStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const parsed = new Date(dateVal);
    if (isNaN(parsed.getTime())) return null;
    cleanStr = parsed.toISOString().substring(0, 10);
  }

  const [year, month, day] = cleanStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const diff = date.getTime() - epoch.getTime();
  return diff / (24 * 60 * 60 * 1000);
};

const createWorksheet = (structuredData, headers) => {
  if (!structuredData || structuredData.length === 0) {
    return XLSX.utils.aoa_to_sheet([headers]);
  }
  return XLSX.utils.json_to_sheet(structuredData);
};

const applyTableStyles = (ws, themeColor = "1E293B") => {
  const ref = ws['!ref'];
  if (!ref) return;

  const range = XLSX.utils.decode_range(ref);
  const headerRow = range.s.r;

  const dateColIndices = [];
  const statusColIndices = [];
  const amountColIndices = [];
  const boldHighlightCols = [];

  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellRef = XLSX.utils.encode_cell({ r: headerRow, c: col });
    const cell = ws[cellRef];
    if (cell && cell.v) {
      const label = String(cell.v).toLowerCase();
      if (label.includes('date') || label.includes('time') || label.includes('timestamp')) {
        dateColIndices.push(col);
      }
      if (label.includes('status') || label.includes('state') || label.includes('type')) {
        statusColIndices.push(col);
      }
      if (label.includes('(rs.)') || label.includes('amount') || label.includes('total') || label.includes('balance') || label.includes('price') || label.includes('cost') || label.includes('received') || label.includes('salary') || label.includes('paid') || label.includes('outstanding') || label.includes('overdue') || label.includes('value') || label.includes('revenue') || label.includes('profit')) {
        amountColIndices.push(col);
      }
      if (col === 0 || label.includes('sku') || label.includes('invoice') || label.includes('customer') || label.includes('supplier') || label.includes('product') || label.includes('name') || label.includes('code') || label.includes('stock')) {
        boldHighlightCols.push(col);
      }
    }
  }

  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellRef = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    const cell = ws[cellRef];
    if (cell) {
      cell.s = {
        font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 12.5 },
        fill: { fgColor: { rgb: themeColor || "1E293B" } },
        alignment: { vertical: "center", horizontal: "center", wrapText: true },
        border: {
          bottom: { style: "medium", color: { rgb: "0F172A" } },
          top: { style: "medium", color: { rgb: "0F172A" } },
          left: { style: "thin", color: { rgb: "475569" } },
          right: { style: "thin", color: { rgb: "475569" } }
        }
      };
    }
  }

  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    const firstCellRef = XLSX.utils.encode_cell({ r: row, c: range.s.c });
    const firstCell = ws[firstCellRef];
    const isTotalRow = firstCell && String(firstCell.v).toUpperCase() === 'TOTAL';
    const isEven = (row % 2 === 0);

    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = ws[cellRef];
      if (!cell) continue;

      if (isTotalRow) {
        let horizAlign = "left";
        if (typeof cell.v === 'number' || amountColIndices.includes(col)) {
          horizAlign = "right";
          cell.z = '#,##0.00';
        } else if (col === 0) {
          horizAlign = "left";
        } else {
          horizAlign = "center";
        }
        cell.s = {
          font: { bold: true, color: { rgb: "047857" }, name: "Segoe UI", sz: 13 },
          fill: { fgColor: { rgb: "D1FAE5" } },
          alignment: { vertical: "center", horizontal: horizAlign },
          border: {
            top: { style: "medium", color: { rgb: "047857" } },
            bottom: { style: "double", color: { rgb: "047857" } },
            left: { style: "thin", color: { rgb: "6EE7B7" } },
            right: { style: "thin", color: { rgb: "6EE7B7" } }
          }
        };
      } else {
        const bgColor = isEven ? "F8FAFC" : "FFFFFF";
        let horizAlign = "left";
        let fontColor = "0F172A";
        let isBold = boldHighlightCols.includes(col);
        let fillBg = bgColor;
        let fontSize = 11.5;

        if (typeof cell.v === 'number') {
          horizAlign = "right";
          if (amountColIndices.includes(col)) {
            cell.z = '#,##0.00';
            isBold = true;
            fontColor = "0F172A";
          }
        }

        if (dateColIndices.includes(col) && typeof cell.v === 'number') {
          cell.z = 'yyyy-mm-dd';
          horizAlign = "center";
          isBold = true;
          fontColor = "334155";
          fillBg = "F1F5F9";
        }

        if (statusColIndices.includes(col) && cell.v) {
          const valStr = String(cell.v).toUpperCase();
          horizAlign = "center";
          isBold = true;
          fontSize = 11.5;
          if (valStr.includes('PAID') || valStr.includes('SETTLED') || valStr.includes('ACTIVE') || valStr.includes('ENABLED')) {
            fillBg = "DCFCE7";
            fontColor = "15803D";
          } else if (valStr.includes('NON') || valStr.includes('UNPAID') || valStr.includes('OVERDUE') || valStr.includes('CANCELLED') || valStr.includes('VOIDED') || valStr.includes('DISABLED')) {
            fillBg = "FFE4E6";
            fontColor = "B91C1C";
          } else if (valStr.includes('PARTIAL') || valStr.includes('PENDING') || valStr.includes('EXCHANGE') || valStr.includes('CREDIT NOTE')) {
            fillBg = "FEF3C7";
            fontColor = "B45309";
          }
        }

        cell.s = {
          font: { name: "Segoe UI", sz: fontSize, bold: isBold, color: { rgb: fontColor } },
          fill: { fgColor: { rgb: fillBg } },
          alignment: { vertical: "center", horizontal: horizAlign },
          border: {
            bottom: { style: "thin", color: { rgb: "CBD5E1" } },
            top: { style: "thin", color: { rgb: "CBD5E1" } },
            left: { style: "thin", color: { rgb: "CBD5E1" } },
            right: { style: "thin", color: { rgb: "CBD5E1" } }
          }
        };
      }
    }
  }

  setRowHeights(ws);
};

const styleOverviewSheet = (ws) => {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);

  ws['!rows'] = [
    { hpt: 48 }, { hpt: 48 }, // 0, 1: Title
    { hpt: 24 }, { hpt: 28 }, // 2, 3: Date
    { hpt: 18 },              // 4: Gap
    { hpt: 38 },              // 5: Header Key Business Metrics
    { hpt: 30 }, { hpt: 30 }, { hpt: 30 }, { hpt: 30 }, { hpt: 30 }, { hpt: 30 }, { hpt: 30 }, { hpt: 30 }, // 6-13: 8 metrics
    { hpt: 18 },              // 14: Gap
    { hpt: 38 },              // 15: Header Payment Method Breakdown
    { hpt: 28 }, { hpt: 28 }, { hpt: 28 }, { hpt: 28 }, { hpt: 28 }, { hpt: 28 }, { hpt: 28 }, { hpt: 32 }, // 16-23: 8 payment breakdown rows
    { hpt: 18 },              // 24: Gap
    { hpt: 38 },              // 25: Header Remarks & Notes
    { hpt: 26 }, { hpt: 26 }, { hpt: 26 }, { hpt: 26 }, { hpt: 26 }, { hpt: 26 } // 26-31: Notes
  ];

  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = ws[cellRef];
      if (!cell) continue;

      cell.s = { font: { name: "Segoe UI", sz: 11.5, color: { rgb: "334155" } } };

      if (row === 0 || row === 1) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 18 },
          fill: { fgColor: { rgb: "4C1D95" } },
          alignment: { vertical: "center", horizontal: "center" }
        };
      } else if (row === 2 && (col === 0 || col === 1)) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 12 },
          fill: { fgColor: { rgb: "1E293B" } },
          alignment: { vertical: "center", horizontal: "center" }
        };
      } else if (row === 3 && (col === 0 || col === 1)) {
        cell.s = {
          font: { name: "Segoe UI", sz: 12, bold: true, color: { rgb: "0F172A" } },
          fill: { fgColor: { rgb: "F1F5F9" } },
          alignment: { vertical: "center", horizontal: "center" },
          border: {
            bottom: { style: "thin", color: { rgb: "CBD5E1" } },
            top: { style: "thin", color: { rgb: "CBD5E1" } },
            left: { style: "thin", color: { rgb: "CBD5E1" } },
            right: { style: "thin", color: { rgb: "CBD5E1" } }
          }
        };
      } else if ((row === 5 || row === 15 || row === 25) && col >= 0 && col <= 8) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 13.5 },
          fill: { fgColor: { rgb: "1E293B" } },
          alignment: { vertical: "center", horizontal: "left" },
          border: {
            bottom: { style: "medium", color: { rgb: "0F172A" } },
            top: { style: "medium", color: { rgb: "0F172A" } }
          }
        };
      } else if (row >= 6 && row <= 13 && (col === 0 || col === 1)) {
        if (col === 0) {
          cell.s = {
            font: { bold: true, color: { rgb: "3B0764" }, name: "Segoe UI", sz: 12 },
            fill: { fgColor: { rgb: "F3E8FF" } },
            alignment: { vertical: "center", horizontal: "left" },
            border: {
              bottom: { style: "thin", color: { rgb: "E9D5FF" } },
              top: { style: "thin", color: { rgb: "E9D5FF" } },
              left: { style: "thin", color: { rgb: "E9D5FF" } },
              right: { style: "thin", color: { rgb: "E9D5FF" } }
            }
          };
        } else {
          let kpiFill = "F1F5F9";
          let kpiColor = "0F172A";
          if (row === 6) { kpiFill = "F8FAFC"; kpiColor = "0F172A"; }
          else if (row === 7) { kpiFill = "D1FAE5"; kpiColor = "047857"; }
          else if (row === 8) { kpiFill = "FEF2F2"; kpiColor = "991B1B"; }
          else if (row === 9) { kpiFill = "FEF3C7"; kpiColor = "92400E"; }
          else if (row === 10) { kpiFill = "E0F2FE"; kpiColor = "0369A1"; }
          else if (row === 11) { kpiFill = "FEE2E2"; kpiColor = "B91C1C"; }
          else if (row === 12) { kpiFill = "F3E8FF"; kpiColor = "6B21A8"; }
          else if (row === 13) { kpiFill = "E0E7FF"; kpiColor = "3730A3"; }

          cell.s = {
            font: { bold: true, name: "Segoe UI", sz: 13, color: { rgb: kpiColor } },
            fill: { fgColor: { rgb: kpiFill } },
            alignment: { vertical: "center", horizontal: "right" },
            border: {
              bottom: { style: "thin", color: { rgb: "CBD5E1" } },
              top: { style: "thin", color: { rgb: "CBD5E1" } },
              left: { style: "thin", color: { rgb: "CBD5E1" } },
              right: { style: "thin", color: { rgb: "CBD5E1" } }
            }
          };
        }
      } else if (row >= 16 && row <= 23 && (col === 0 || col === 1)) {
        const isTotal = (row === 23);
        const bg = isTotal ? "D1FAE5" : ((row % 2 === 0) ? "F8FAFC" : "FFFFFF");
        const fontCol = isTotal ? "047857" : "334155";
        const align = (col === 0) ? "left" : "right";

        cell.s = {
          font: { bold: true, color: { rgb: fontCol }, name: "Segoe UI", sz: isTotal ? 13 : 11.5 },
          fill: { fgColor: { rgb: bg } },
          alignment: { vertical: "center", horizontal: align },
          border: {
            top: { style: "thin", color: { rgb: "CBD5E1" } },
            bottom: { style: isTotal ? "double" : "thin", color: { rgb: isTotal ? "047857" : "E2E8F0" } },
            left: { style: "thin", color: { rgb: "CBD5E1" } },
            right: { style: "thin", color: { rgb: "CBD5E1" } }
          }
        };
      } else if (row >= 26 && row <= 31 && col === 0) {
        cell.s = {
          font: { name: "Segoe UI", sz: 11, italic: true, color: { rgb: "475569" } },
          alignment: { vertical: "center", horizontal: "left" }
        };
      }
    }
  }
};

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

// If --email arg was omitted, targetEmail will be dynamically resolved from system settings or env in runBackup()

async function runBackup() {
  if (!acquireLock()) {
    logError('Backup lock acquisition failed or another backup process is active');
    process.exit(1);
  }

  let db = null;
  try {
    db = await openDatabase();

    log('Fetching database records for master backup generation...');
    const customers = await db.all('SELECT * FROM customers').catch(() => []);
    let sales = await db.all('SELECT * FROM sales').catch(() => []);
    const products = await db.all('SELECT * FROM products').catch(() => []);
    const suppliers = await db.all('SELECT * FROM suppliers').catch(() => []);
    let purchaseOrders = await db.all('SELECT * FROM purchase_orders').catch(() => []);
    let transactions = await db.all('SELECT * FROM transactions').catch(() => []);
    let stockAdjustments = await db.all('SELECT * FROM stock_adjustments').catch(() => []);
    let quotations = await db.all('SELECT * FROM quotations').catch(() => []);
    const profiles = await db.all('SELECT * FROM profiles').catch(() => []);
    const rawSettingsList = await db.all('SELECT * FROM system_settings').catch(() => []);
    const rawEmployees = await db.all('SELECT * FROM employees ORDER BY name ASC').catch(() => []);
    const branches = await db.all('SELECT * FROM branches').catch(() => []);
    const salesReturns = await db.all('SELECT * FROM sales_returns').catch(() => []);
    let creditPayments = await db.all('SELECT * FROM credit_payments').catch(() => []);
    let cheques = await db.all('SELECT * FROM cheque_registry ORDER BY cheque_date DESC, created_at DESC').catch(() => []);
    let purchaseReturns = await db.all('SELECT * FROM purchase_returns ORDER BY return_date DESC, created_at DESC').catch(() => []);
    const purchaseReturnItems = await db.all('SELECT * FROM purchase_return_items').catch(() => []);

    let rawSettings = rawSettingsList.find(s => s.id === 'global') || rawSettingsList[0];
    if (!targetEmail && rawSettings) {
      targetEmail = rawSettings.backup_email || rawSettings.email || process.env.SMTP_USER || process.env.GMAIL_USER;
    }
    if (!rawSettings) {
      rawSettings = {
        shop_name: 'Muthuwadige Hardware',
        address: 'No: 80, Mahahunupitiya, Negombo',
        phone: '077 076 076 7',
        email: 'sanojhardware@gmail.com',
        currency: 'Rs.',
        tax_rate: 0,
        backup_email: targetEmail,
        backup_enabled: 1,
        logo_path: '',
        printer_settings: '',
        branch_settings: '',
        updated_at: new Date().toISOString()
      };
    }
    const settings = [rawSettings];

    const employees = rawEmployees.map(e => ({
      ...e,
      attendance: e.attendance !== undefined ? e.attendance : 100
    }));

    const getSriLankaDateStr = (dateInput) => {
      if (!dateInput && dateInput !== 0) return '';
      if (typeof dateInput === 'string') {
        const trimmed = dateInput.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
        if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
          const d = new Date(trimmed.replace(' ', 'T') + 'Z');
          return isNaN(d.getTime()) ? trimmed.substring(0, 10) : d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' });
        }
      }
      try {
        const d = new Date(dateInput);
        if (isNaN(d.getTime())) return String(dateInput).substring(0, 10);
        return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Colombo' });
      } catch (e) {
        return String(dateInput).substring(0, 10);
      }
    };

    const isWithinDateRange = (dateVal) => {
      if (!fromDate && !toDate) return true;
      if (!dateVal || dateVal === '---') return false;
      const checkStr = getSriLankaDateStr(dateVal);
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
      creditPayments = creditPayments.filter(cp => isWithinDateRange(cp.payment_date || cp.created_at));
      cheques = cheques.filter(c => isWithinDateRange(c.cheque_date || c.created_at));
      purchaseReturns = purchaseReturns.filter(pr => isWithinDateRange(pr.return_date || pr.created_at));
    }

    let minDate = null;
    let maxDate = null;

    const checkDate = (d) => {
      if (!d) return;
      const checkStr = getSriLankaDateStr(d);
      if (checkStr && checkStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        if (!minDate || checkStr < minDate) minDate = checkStr;
        if (!maxDate || checkStr > maxDate) maxDate = checkStr;
      }
    };

    sales.forEach(s => checkDate(s.created_at || s.date));
    transactions.forEach(t => checkDate(t.date || t.created_at));
    purchaseOrders.forEach(po => checkDate(po.created_at));
    cheques.forEach(c => checkDate(c.cheque_date || c.created_at));
    purchaseReturns.forEach(pr => checkDate(pr.return_date || pr.created_at));

    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    const dateStartStr = currentMonthStart.toISOString().split('T')[0];

    const currentMonthEnd = new Date();
    currentMonthEnd.setMonth(currentMonthEnd.getMonth() + 1);
    currentMonthEnd.setDate(0);
    const dateEndStr = currentMonthEnd.toISOString().split('T')[0];

    const finalStart = fromDate || minDate || dateStartStr;
    const finalEnd = toDate || maxDate || dateEndStr;

    // --- RECONCILED FINANCIAL ENGINE ---
    const activeReturns = salesReturns ? salesReturns.filter(r => r.status !== 'voided' && r.status !== 'Voided' && r.status !== 'cancelled') : [];
    const validSales = sales.filter(s => s.status?.toUpperCase() !== 'CANCELLED' && s.status?.toUpperCase() !== 'VOIDED');

    const getItemUnitCost = (product, itemUnit, itemConvRate, itemCostSnapshot) => {
      const baseCost = product
        ? Number(product.cost_price !== undefined ? product.cost_price : (product.costPrice !== undefined ? product.costPrice : 0))
        : Number(itemCostSnapshot || 0);

      let conversionRate = Number(itemConvRate) || 1;

      if ((!itemConvRate || conversionRate === 1) && itemUnit && product && product.unit && itemUnit.toLowerCase() !== product.unit.toLowerCase()) {
        const measureDetailsStr = product.measure_details || product.measureDetails;
        if (measureDetailsStr) {
          try {
            const parsed = typeof measureDetailsStr === 'string' ? JSON.parse(measureDetailsStr) : measureDetailsStr;
            if (parsed && Array.isArray(parsed.conversions)) {
              const matchedConv = parsed.conversions.find(c => (c.unit || '').toLowerCase() === itemUnit.toLowerCase());
              if (matchedConv) {
                const rawVal = Number(matchedConv.kgVal) || 1;
                if ((product.unit || '').toLowerCase() === 'cube' && rawVal > 0 && rawVal < 1) {
                  conversionRate = 1 / rawVal;
                } else {
                  conversionRate = rawVal;
                }
              }
            }
          } catch (e) { }
        }
      }

      const snapshotCost = Number(itemCostSnapshot !== undefined && itemCostSnapshot !== null ? itemCostSnapshot : 0);
      if (snapshotCost > 0) {
        if (conversionRate > 1 && snapshotCost > (baseCost / conversionRate) + 0.01 && baseCost > 0) {
          return baseCost / conversionRate;
        }
        if (conversionRate > 1 && snapshotCost <= (baseCost / conversionRate) + 0.01) {
          return snapshotCost;
        }
        if (conversionRate <= 1) {
          return snapshotCost;
        }
      }

      return conversionRate > 0 ? baseCost / conversionRate : baseCost;
    };

    const getSaleSellingSubtotal = (s) => {
      const tot = Number(s.total_amount !== undefined ? s.total_amount : (s.total || 0));
      return Math.max(0, tot);
    };

    const getReturnSellingSubtotal = (r) => {
      const retAmt = Number(r.return_amount !== undefined && r.return_amount !== null
        ? r.return_amount
        : (r.returnAmount !== undefined && r.returnAmount !== null
          ? r.returnAmount
          : (r.total_refunded !== undefined && r.total_refunded !== null && Number(r.total_refunded) > 0
            ? r.total_refunded
            : (r.totalRefunded !== undefined && r.totalRefunded !== null && Number(r.totalRefunded) > 0
              ? r.totalRefunded
              : (r.amount || 0)))));
      const retTax = 0;
      const retTrans = Number(r.transportation_fee || r.transportationFee || 0);
      if (retAmt > 0) {
        return Math.max(0, retAmt - retTrans);
      }
      let rawItems = r.items || r.returnedItems || r.returned_items || [];
      let items = [];
      try {
        items = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
      } catch (e) { }
      if (Array.isArray(items) && items.length > 0) {
        return items.reduce((sum, it) => {
          const itemQty = Number(it.qty || 0);
          const itemPrice = Number(it.price || it.unitPrice || 0);
          const itemDisc = Number(it.discount || 0);
          const itemDiscType = it.discountType || 'amount';
          const discAmt = (itemDiscType === 'percent' || itemDiscType === 'percentage') ? (itemQty * itemPrice * itemDisc / 100) : (itemDisc * itemQty);
          return sum + Math.max(0, itemQty * itemPrice - discAmt);
        }, 0);
      }
      return 0;
    };

    // 1. Calculate Gross and Net Revenue
    let grossStickerSales = 0;
    let customerDiscounts = 0;
    let transportFees = 0;
    let grossCostVal = 0;

    validSales.forEach(o => {
      let items = [];
      try {
        items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items || [];
      } catch (e) { }

      if (Array.isArray(items)) {
        items.forEach(it => {
          const product = products.find(p => p.id === it.productId || p.id === it.product_id);
          const cost = getItemUnitCost(product, it.unit, it.conversionRate, it.cost_price || it.costPrice);
          const qty = Number(it.qty || 0);
          const price = Number(it.price || it.unitPrice || 0);
          
          grossStickerSales += (qty * price);
          grossCostVal += (qty * cost);
        });
      }
      customerDiscounts += Number(o.discount || 0);
      transportFees += Number(o.transportation_fee || o.transportationFee || 0);
    });

    let returnedSellingRev = 0;
    let returnedCostVal = 0;
    let exchangeSellingRev = 0;
    let exchangeCostVal = 0;

    activeReturns.forEach(r => {
      returnedSellingRev += getReturnSellingSubtotal(r);
      let rawItems = r.items || r.returnedItems || r.returned_items || [];
      let items = [];
      try {
        items = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
      } catch (e) { }

      if (Array.isArray(items)) {
        items.forEach(it => {
          const product = products.find(p => p.id === (it.productId || it.product_id));
          const cost = getItemUnitCost(product, it.unit, it.conversionRate, it.cost_price || it.costPrice);
          const qty = Number(it.qty || 0);
          returnedCostVal += qty * cost;
        });
      }

      const exAmt = Number(r.exchange_amount !== undefined ? r.exchange_amount : (r.exchangeAmount || 0));
      exchangeSellingRev += exAmt;

      let rawExItems = r.exchangeItems || r.exchange_items || [];
      let exItems = [];
      try {
        exItems = typeof rawExItems === 'string' ? JSON.parse(rawExItems) : rawExItems;
      } catch (e) { }

      if (Array.isArray(exItems)) {
        exItems.forEach(it => {
          const product = products.find(p => p.id === (it.productId || it.product_id));
          const cost = getItemUnitCost(product, it.unit, it.conversionRate, it.cost_price || it.costPrice);
          const qty = Number(it.qty || 0);
          exchangeCostVal += qty * cost;
        });
      }
    });

    const netReturns = returnedSellingRev;
    const grossSellingRev = grossStickerSales;
    const netSellingRev = Math.max(0, grossStickerSales - customerDiscounts - netReturns + transportFees);
    const netCostVal = Math.max(0, grossCostVal + exchangeCostVal - returnedCostVal);

    const valB6 = Math.max(0, netSellingRev);
    const valB11 = netSellingRev - netCostVal;
    const totalCostOfSales = netCostVal;

    // 2. Accurate Payment Attribution Calculation
    let directCash = 0;
    let directCard = 0;
    let directBank = 0;

    validSales.forEach(s => {
      const rawMethod = (s.payment_method || s.paymentMethod || '').toString().trim();
      const methodLower = rawMethod.toLowerCase();
      const isCredit = methodLower === 'credit' || s.is_credit === 1 || s.is_credit === true || s.status?.toLowerCase() === 'non paid' || s.status?.toLowerCase() === 'partially settled' || s.status?.toLowerCase() === 'pending';

      const totalAmt = Number(s.total_amount !== undefined ? s.total_amount : (s.total || 0));

      if (isCredit) {
        // Calculate initial POS down payment (not from subsequent settlements)
        const invNo = s.invoice_no || s.invoiceNo;
        const totalSettledOnInvoice = (Array.isArray(creditPayments) ? creditPayments : [])
          .filter(cp => cp.sale_id === s.id || (invNo && cp.invoice_no === invNo))
          .reduce((sum, cp) => sum + Number(cp.amount_paid !== undefined ? cp.amount_paid : (cp.amount || 0)), 0);

        const initialDownPayment = Math.max(0, Number(s.payment_received || 0) - totalSettledOnInvoice);
        if (initialDownPayment > 0) {
          if (methodLower.includes('card')) directCard += initialDownPayment;
          else if (methodLower.includes('bank')) directBank += initialDownPayment;
          else directCash += initialDownPayment;
        }
      } else {
        if (methodLower.includes('card')) directCard += totalAmt;
        else if (methodLower.includes('bank')) directBank += totalAmt;
        else directCash += totalAmt;
      }
    });

    // Process all credit settlements into their respective buckets
    let settledCash = 0;
    let settledCard = 0;
    let settledBank = 0;

    if (Array.isArray(creditPayments)) {
      creditPayments.forEach(cp => {
        const cpAmt = Number(cp.amount_paid !== undefined ? cp.amount_paid : (cp.amount || 0));
        const cpMethod = (cp.payment_method || cp.paymentMethod || 'Cash').toString().toLowerCase().trim();

        if (cpMethod.includes('card')) settledCard += cpAmt;
        else if (cpMethod.includes('bank')) settledBank += cpAmt;
        else settledCash += cpAmt;
      });
    }

    // Exchange Return Adjustments to cash
    const cashRefundsTotal = activeReturns.reduce((sum, r) => {
      const type = (r.return_type || r.returnType || r.returnMethod || r.return_method || r.type || '').toString().toLowerCase().trim();
      if (type === 'cash refund' || type === 'cash') {
        return sum + Number(r.refund_amount || r.total_refunded || r.return_amount || 0);
      }
      return sum;
    }, 0);

    const exchangeCashInflowsTotal = activeReturns.reduce((sum, r) => {
      const type = (r.return_type || r.returnType || r.returnMethod || r.return_method || r.type || '').toString().toLowerCase().trim();
      if (type === 'exchange') {
        const paidAmt = Number(r.customer_paid || 0);
        const changeGiven = Number(r.change_given || 0);
        return sum + Math.max(0, paidAmt - changeGiven);
      }
      return sum;
    }, 0);

    // Outstanding customer credit calculation
    const totalCreditOutstanding = validSales.reduce((sum, s) => {
      const inv = s.invoice_no || s.invoiceNo;
      const invReturns = activeReturns.filter(r => (r.invoice_no === inv || r.invoiceNo === inv));
      const retAmt = invReturns.reduce((acc, r) => acc + Number(r.return_amount || r.returnAmount || 0), 0);
      const exAmt = invReturns.reduce((acc, r) => acc + Number(r.exchange_amount || r.exchangeAmount || 0), 0);
      const exPaid = invReturns.reduce((acc, r) => acc + Number(r.customer_paid || r.customerPaid || 0), 0);

      const method = (s.payment_method || '').toLowerCase();
      const isCredit = method === 'credit' || s.is_credit === 1 || s.is_credit === true || s.status?.toLowerCase() === 'non paid' || s.status?.toLowerCase() === 'partially settled' || s.status?.toLowerCase() === 'pending';

      if (!isCredit && s.status?.toLowerCase() === 'paid') return sum;

      const origTotal = Number(s.total_amount || 0);
      const origPaid = Number(s.payment_received || 0);
      const effTotal = Math.max(0, origTotal - retAmt + exAmt);
      const netOutstanding = Math.max(0, effTotal - origPaid - exPaid);

      return sum + netOutstanding;
    }, 0);

    const clearedInwardCheques = (cheques || []).filter(c => c.direction === 'INWARD' && c.status === 'CLEARED');
    const clearedChequeAmount = clearedInwardCheques.reduce((sum, c) => sum + Number(c.amount || 0), 0);

    const cashChequesInHand = (cheques || []).filter(c => c.direction === 'INWARD' && c.status === 'IN_HAND');
    const cashChequesInHandAmount = cashChequesInHand.reduce((sum, c) => sum + Number(c.amount || 0), 0);

    const pendingInwardCheques = (cheques || []).filter(c => c.direction === 'INWARD' && (c.status === 'PENDING' || c.status === 'DEPOSITED'));
    const pendingChequesAmount = pendingInwardCheques.reduce((sum, c) => sum + Number(c.amount || 0), 0);

    const cashAmount = Math.max(0, directCash + settledCash + exchangeCashInflowsTotal - cashRefundsTotal);
    const cardAmount = directCard + settledCard;
    const bankTransferAmount = directBank + settledBank;
    const creditAmount = totalCreditOutstanding;

    const valB8 = totalCreditOutstanding;
    const valB7 = cashAmount + cardAmount + bankTransferAmount + clearedChequeAmount;
    const valB9 = purchaseOrders.filter(po => po.status?.toUpperCase() !== 'CANCELLED').reduce((sum, po) => sum + (po.total || 0), 0);
    const valB10 = transactions.filter(t => t.type?.toUpperCase() === 'EXPENSE' && t.category !== 'Purchases').reduce((sum, t) => sum + (t.amount || 0), 0);
    const valB12 = products.reduce((sum, p) => sum + ((p.stock || 0) * (p.cost_price || 0)), 0);

    const totalSalesRevenue = valB6;
    const totalSalesProfit = valB11;
    const paymentTotal = cashAmount + cardAmount + creditAmount + bankTransferAmount + clearedChequeAmount;

    // Overview Dashboard Sheet
    const overviewRows = [
      ["MUTHUWADIGE HARDWARE - BUSINESS & ACCOUNTING BACKUP REPORT", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", ""],
      ["Report Start Date", "Report End Date", "", "", "", "", "", "", ""],
      [finalStart, finalEnd, "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", ""],
      ["KEY BUSINESS METRICS (ERP SUMMARY)", "", "", "", "", "", "", "", ""],
      ["Gross Sales", "", "", "", "", "", "", "", ""],
      ["Net Sales Revenue", "", "", "", "", "", "", "", ""],
      ["Cost of Goods Sold (COGS)", "", "", "", "", "", "", "", ""],
      ["Gross Profit", "", "", "", "", "", "", "", ""],
      ["Total Revenue Collected", "", "", "", "", "", "", "", ""],
      ["Customer Credit Outstanding", "", "", "", "", "", "", "", ""],
      ["Total Purchases", "", "", "", "", "", "", "", ""],
      ["Total Stock Value", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", ""],
      ["PAYMENT METHOD BREAKDOWN", "", "", "", "", "", "", "", ""],
      ["Cash Amount", "", "", "", "", "", "", "", ""],
      ["Card Amount", "", "", "", "", "", "", "", ""],
      ["Credit Amount", "", "", "", "", "", "", "", ""],
      ["Bank Transfer Amount", "", "", "", "", "", "", "", ""],
      ["Cleared Cheque Amount", "", "", "", "", "", "", "", ""],
      ["Cash Cheques (In Hand / Drawer)", "", "", "", "", "", "", "", ""],
      ["Pending Cheques (Uncleared / PDC)", "", "", "", "", "", "", "", ""],
      ["Total Payment Methods", "", "", "", "", "", "", "", ""],
      ["", "", "", "", "", "", "", "", ""],
      ["REMARKS & USEFUL NOTES", "", "", "", "", "", "", "", ""],
      ["• Sales sheet contains daily invoices, customer payments, and payment methods.", "", "", "", "", "", "", "", ""],
      ["• Cheque Registry sheet contains complete status, bank details, and clearance tracking.", "", "", "", "", "", "", "", ""],
      ["• Purchase Returns sheet details vendor debit notes and returned stock items.", "", "", "", "", "", "", "", ""],
      ["• Inventory Stock sheet provides real-time stock quantities and market valuations.", "", "", "", "", "", "", "", ""],
      ["• Accounting Ledger contains all business expense and income transaction records.", "", "", "", "", "", "", "", ""],
      ["• Report figures are generated directly from Muthuwadige Hardware ERP.", "", "", "", "", "", "", "", ""]
    ];

    const wsOverview = XLSX.utils.aoa_to_sheet(overviewRows);
    wsOverview['!cols'] = [
      { wch: 38 }, { wch: 24 }, { wch: 5 },
      { wch: 15 }, { wch: 15 }, { wch: 15 },
      { wch: 15 }, { wch: 15 }, { wch: 15 }
    ];

    wsOverview['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 8 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 8 } },
      { s: { r: 15, c: 0 }, e: { r: 15, c: 8 } },
      { s: { r: 25, c: 0 }, e: { r: 25, c: 8 } },
      { s: { r: 26, c: 0 }, e: { r: 26, c: 8 } },
      { s: { r: 27, c: 0 }, e: { r: 27, c: 8 } },
      { s: { r: 28, c: 0 }, e: { r: 28, c: 8 } },
      { s: { r: 29, c: 0 }, e: { r: 29, c: 8 } },
      { s: { r: 30, c: 0 }, e: { r: 30, c: 8 } },
      { s: { r: 31, c: 0 }, e: { r: 31, c: 8 } }
    ];

    wsOverview['A4'] = { t: 'n', v: getExcelDecimalDate(finalStart), z: 'yyyy-mm-dd' };
    wsOverview['B4'] = { t: 'n', v: getExcelDecimalDate(finalEnd), z: 'yyyy-mm-dd' };

    wsOverview['B7'] = { t: 'n', v: grossSellingRev, z: '#,##0.00' };
    wsOverview['B8'] = { t: 'n', v: netSellingRev, z: '#,##0.00' };
    wsOverview['B9'] = { t: 'n', v: netCostVal, z: '#,##0.00' };
    wsOverview['B10'] = { t: 'n', v: netSellingRev - netCostVal, z: '#,##0.00' };
    wsOverview['B11'] = { t: 'n', v: valB7, z: '#,##0.00' };
    wsOverview['B12'] = { t: 'n', v: valB8, z: '#,##0.00' };
    wsOverview['B13'] = { t: 'n', v: valB9, z: '#,##0.00' };
    wsOverview['B14'] = { t: 'n', v: valB12, z: '#,##0.00' };

    wsOverview['B17'] = { t: 'n', v: cashAmount, z: '#,##0.00' };
    wsOverview['B18'] = { t: 'n', v: cardAmount, z: '#,##0.00' };
    wsOverview['B19'] = { t: 'n', v: creditAmount, z: '#,##0.00' };
    wsOverview['B20'] = { t: 'n', v: bankTransferAmount, z: '#,##0.00' };
    wsOverview['B21'] = { t: 'n', v: clearedChequeAmount, z: '#,##0.00' };
    wsOverview['B22'] = { t: 'n', v: cashChequesInHandAmount, z: '#,##0.00' };
    wsOverview['B23'] = { t: 'n', v: pendingChequesAmount, z: '#,##0.00' };
    wsOverview['B24'] = { t: 'n', v: paymentTotal, z: '#,##0.00' };

    // 1. Inventory Stock Sheet
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
    applyTableStyles(wsInventory, "0F172A");

    // 2. Sales Orders Sheet
    const structuredSales = sales.map(s => {
      let itemsList = '---';
      try {
        const items = typeof s.items === 'string' ? JSON.parse(s.items) : s.items;
        if (Array.isArray(items)) {
          itemsList = items.map(it => `${it.productName || it.name || 'Item'} (x${it.qty || 1})`).join(', ');
        }
      } catch (e) { }

      const inv = s.invoice_no || s.invoiceNo;
      const invReturns = activeReturns.filter(r => (r.invoice_no === inv || r.invoiceNo === inv));
      const retAmt = invReturns.reduce((acc, r) => acc + Number(r.return_amount || r.returnAmount || 0), 0);
      const exAmt = invReturns.reduce((acc, r) => acc + Number(r.exchange_amount || r.exchangeAmount || 0), 0);
      const exPaid = invReturns.reduce((acc, r) => acc + Number(r.customer_paid || r.customerPaid || 0), 0);

      const method = (s.payment_method || '').toLowerCase();
      const isCredit = method === 'credit' || s.is_credit === 1 || s.is_credit === true || s.status?.toLowerCase() === 'non paid' || s.status?.toLowerCase() === 'partially settled' || s.status?.toLowerCase() === 'fully settled' || s.status?.toLowerCase() === 'fully returned' || s.status?.toLowerCase() === 'partially returned';

      const origTotal = Number(s.total_amount || 0);
      const origPaid = isCredit ? Number(s.payment_received || 0) : (s.status?.toLowerCase() === 'paid' ? origTotal : Number(s.payment_received || 0));
      const totalPaid = origPaid + exPaid;
      const effTotal = Math.max(0, origTotal - retAmt + exAmt);
      const netOutstanding = Math.max(0, effTotal - totalPaid);

      return {
        "Invoice Number": s.invoice_no,
        "Customer Name": s.customer_name || 'Guest Customer',
        "Products Sold": itemsList,
        "Subtotal (Rs.)": s.subtotal || 0,
        "Discount (Rs.)": s.discount || 0,
        "Tax Amount (Rs.)": 0,
        "Total Amount (Rs.)": effTotal,
        "Payment Received (Rs.)": totalPaid,
        "Outstanding Balance (Rs.)": netOutstanding,
        "Payment Status": netOutstanding <= 0.01 ? 'PAID' : (totalPaid > 0 ? 'PARTIALLY SETTLED' : (s.status ? s.status.toUpperCase() : 'NON PAID')),
        "Payment Method": s.payment_method || 'Cash',
        "Checkout Date & Time": getExcelDecimalDate(s.created_at) || '---',
        "Due Date": getExcelDecimalDate(s.due_date) || '---',
        "Credit Period (Days)": s.credit_period_days || 0,
        "Cost of Goods Sold (Rs.)": 0
      };
    });

    const wsSalesHeaders = [
      "Invoice Number", "Customer Name", "Products Sold", "Subtotal (Rs.)",
      "Discount (Rs.)", "Tax Amount (Rs.)", "Total Amount (Rs.)",
      "Payment Received (Rs.)", "Outstanding Balance (Rs.)", "Payment Status",
      "Payment Method", "Checkout Date & Time", "Due Date",
      "Credit Period (Days)", "Cost of Goods Sold (Rs.)"
    ];
    const wsSales = createWorksheet(structuredSales, wsSalesHeaders);
    setColWidths(wsSales, structuredSales, wsSalesHeaders);
    applyTableStyles(wsSales, "065F46");

    // 3. Transactions Sheet
    const structuredTransactions = transactions.map(t => ({
      "Record Date": getExcelDecimalDate(t.date) || '---',
      "Flow Type": t.type ? t.type.toUpperCase() : 'INCOME',
      "Finance Category": t.category || 'Other',
      "Description Details": t.description,
      "Reference Invoice / PO": t.reference || '---',
      "Transaction Value (Rs.)": t.amount || 0,
      "System Log Date": getExcelDecimalDate(t.created_at) || '---'
    }));
    const wsTransactionsHeaders = [
      "Record Date", "Flow Type", "Finance Category", "Description Details",
      "Reference Invoice / PO", "Transaction Value (Rs.)", "System Log Date"
    ];
    const wsTransactions = createWorksheet(structuredTransactions, wsTransactionsHeaders);
    setColWidths(wsTransactions, structuredTransactions, wsTransactionsHeaders);
    applyTableStyles(wsTransactions, "1E3A8A");

    // 4. Customers Sheet
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
    applyTableStyles(wsCustomers, "0D9488");

    // 5. Employees Sheet
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
    applyTableStyles(wsEmployees, "1E293B");

    // 6. User Profiles Sheet
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
    applyTableStyles(wsProfiles, "1E293B");

    // 7. System Settings Sheet
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
    applyTableStyles(wsSettings, "1E293B");

    // 8. Suppliers Sheet
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
    applyTableStyles(wsSuppliers, "334155");

    // 9. Purchase Orders Sheet
    const structuredPO = purchaseOrders.map(po => {
      let poItems = '---';
      try {
        const parsed = typeof po.items === 'string' ? JSON.parse(po.items) : po.items;
        if (Array.isArray(parsed)) {
          poItems = parsed.map(it => `${it.name || it.productName || 'Item'} (x${it.qty || 1})`).join(', ');
        }
      } catch (e) { }
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
    const wsPOHeaders = [
      "PO Number", "Supplier Name", "PO Items", "Total Amount (Rs.)",
      "PO Status", "Due Date", "Created Date"
    ];
    const wsPO = createWorksheet(structuredPO, wsPOHeaders);
    setColWidths(wsPO, structuredPO, wsPOHeaders);
    applyTableStyles(wsPO, "3730A3");

    // 10. Stock Adjustments Sheet
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

    // 11. Quotations Sheet
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

    // 12. Branches Sheet
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

    // 13. Credit Customers Sheet
    let creditSalesList = validSales.filter(s => {
      const isCredit = s.status === 'Non Paid' || s.status === 'Partially Paid' || s.status === 'Pending' || (s.payment_method && s.payment_method.toLowerCase() === 'credit');
      const rem = Math.max(0, (s.total_amount || 0) - (s.payment_received || 0));
      return isCredit && rem > 0;
    });

    const totOutstandingAll = totalCreditOutstanding;
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
        "Payment Status": outstandingAmt <= 0 ? "Paid" : paidAmt > 0 ? (isOverdue ? "Partially Paid (Overdue)" : "Partially Paid") : (isOverdue ? "Non Paid (Overdue)" : "Non Paid"),
        "Payment History": paidAmt > 0 ? `Paid Rs. ${paidAmt.toLocaleString()}` : "No payments recorded",
        "Total Outstanding": totOutstandingAll,
        "Total Overdue": totOverdueAll
      };
    });
    const wsCCHeaders = ["Customer", "Invoice Number", "Invoice Date", "Invoice Amount", "Amount Paid", "Outstanding Amount", "Due Date", "Payment Status", "Payment History", "Total Outstanding", "Total Overdue"];
    const wsCreditCustomers = createWorksheet(structuredCreditCustomers, wsCCHeaders);
    setColWidths(wsCreditCustomers, structuredCreditCustomers, wsCCHeaders);
    applyTableStyles(wsCreditCustomers, "B8860B");

    // 14. Sales Returns Sheet
    const structuredSalesReturns = activeReturns.map(sr => {
      let returnedProd = '---';
      let returnedQty = 0;
      try {
        const items = typeof sr.returned_items === 'string' ? JSON.parse(sr.returned_items) : sr.returned_items;
        if (Array.isArray(items) && items.length > 0) {
          returnedProd = items.map(i => i.productName || i.name).join(', ');
          returnedQty = items.reduce((sum, i) => sum + (Number(i.qty) || 0), 0);
        }
      } catch (e) { }

      let exchangeProd = 'N/A';
      let exchangeAmt = Number(sr.exchange_amount || 0);
      try {
        const xItems = typeof sr.exchange_items === 'string' ? JSON.parse(sr.exchange_items) : sr.exchange_items;
        if (Array.isArray(xItems) && xItems.length > 0) {
          exchangeProd = xItems.map(i => i.productName || i.name).join(', ');
        }
      } catch (e) { }

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

    // 15. Cheque Registry Sheet
    const structuredCheques = (cheques || []).map(c => ({
      "Date": c.cheque_date || '---',
      "Cheque No": c.cheque_number || '---',
      "Direction": c.direction || 'INWARD',
      "Type": c.cheque_type === 'CROSSED_ACCOUNT_PAYEE' ? 'Account Payee' : 'Cash / Bearer',
      "Bank Name": c.bank_name || '---',
      "Branch": c.branch || '---',
      "Amount (Rs.)": Number(c.amount || 0),
      "Party Name": c.party_name || '---',
      "Status": c.status || 'PENDING',
      "Reference Type": c.reference_type || '---',
      "Reference ID": c.reference_id || '---',
      "Cleared At": c.cleared_at || '---',
      "Notes": c.notes || '---'
    }));
    const wsChequesHeaders = [
      "Date", "Cheque No", "Direction", "Type", "Bank Name", "Branch",
      "Amount (Rs.)", "Party Name", "Status", "Reference Type", "Reference ID",
      "Cleared At", "Notes"
    ];
    const wsCheques = createWorksheet(structuredCheques, wsChequesHeaders);
    setColWidths(wsCheques, structuredCheques, wsChequesHeaders);
    applyTableStyles(wsCheques, "B45309");

    // 16. Purchase Returns Sheet
    const structuredPurchaseReturns = (purchaseReturns || []).map(pr => {
      const prItems = (purchaseReturnItems || []).filter(item => item.purchase_return_id === pr.id);
      const itemsCount = prItems.length > 0 ? prItems.length : (Number(pr.items_count) || 0);

      return {
        "Date": pr.return_date || (pr.created_at ? pr.created_at.slice(0, 10) : '---'),
        "Return No": pr.return_no || pr.id || '---',
        "Supplier Name": pr.supplier_name || '---',
        "Total Returned Cost (Rs.)": Number(pr.total_amount || 0),
        "Settlement Mode": pr.settlement_mode === 'DEDUCT_PAYABLE'
          ? 'Deduct Payable'
          : pr.settlement_mode === 'CASH_REFUND'
          ? 'Cash Refund'
          : pr.settlement_mode === 'BANK_REFUND'
          ? 'Bank Refund'
          : 'Supplier Credit Note',
        "Reason": pr.reason || '---',
        "Items Count": itemsCount,
        "Handled By": pr.created_by || 'Admin',
        "Notes": pr.notes || '---'
      };
    });
    const wsPRHeaders = [
      "Date", "Return No", "Supplier Name", "Total Returned Cost (Rs.)",
      "Settlement Mode", "Reason", "Items Count", "Handled By", "Notes"
    ];
    const wsPurchaseReturns = createWorksheet(structuredPurchaseReturns, wsPRHeaders);
    setColWidths(wsPurchaseReturns, structuredPurchaseReturns, wsPRHeaders);
    applyTableStyles(wsPurchaseReturns, "831843");

    styleOverviewSheet(wsOverview);

    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    let dateStr = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    if (fromDate || toDate) {
      const fromStr = fromDate || 'Start';
      const toStr = toDate || 'End';
      dateStr = `${fromStr}_to_${toStr}`;
    }
    const fileName = `Backup_${dateStr}.xlsx`;
    const filePath = path.join(backupsDir, fileName);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsOverview, "Dashboard");
    XLSX.utils.book_append_sheet(wb, wsInventory, "Inventory Stock");
    XLSX.utils.book_append_sheet(wb, wsSales, "Sales & Invoices");
    XLSX.utils.book_append_sheet(wb, wsCreditCustomers, "Credit Customers");
    XLSX.utils.book_append_sheet(wb, wsSalesReturns, "Sales Returns");
    XLSX.utils.book_append_sheet(wb, wsCheques, "Cheque Registry");
    XLSX.utils.book_append_sheet(wb, wsPurchaseReturns, "Purchase Returns");
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
    log(`Master Excel backup report generated with enhanced executive styling: ${filePath}`);

    let emailSent = false;
    if (targetEmail) {
      try {
        const nowSriLanka = new Date();
        const todayDateStr = nowSriLanka.toISOString().split('T')[0];
        const in48h = new Date(nowSriLanka.getTime() + 48 * 3600 * 1000);
        const in48hStr = in48h.toISOString().split('T')[0];

        const maturingCheques = (cheques || []).filter(c => 
          c.direction === 'INWARD' &&
          (c.status === 'PENDING' || c.status === 'IN_HAND') &&
          c.cheque_date >= todayDateStr &&
          c.cheque_date <= in48hStr
        );
        const maturingChequesTotal = maturingCheques.reduce((sum, c) => sum + Number(c.amount || 0), 0);

        const todayPRs = (purchaseReturns || []).filter(pr => (
          pr.return_date === todayDateStr || 
          (pr.created_at && String(pr.created_at).startsWith(todayDateStr))
        ));
        const todayPRTotal = todayPRs.reduce((sum, pr) => sum + Number(pr.total_amount || 0), 0);

        const htmlBody = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Muthuwadige Hardware Backup</title>
        </head>
        <body style="margin:0; padding:24px 12px; background-color:#ffffff; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <div style="max-width:520px; margin:0 auto; background-color:#ffffff; border-radius:20px; overflow:hidden; border:1px solid #e2e8f0; box-shadow:0 10px 30px -5px rgba(0, 0, 0, 0.08);">
            <div style="background-color:#161c2e; padding:32px 28px; text-align:left;">
              <div style="display:inline-block; background-color:rgba(218, 165, 32, 0.12); border:1px solid rgba(218, 165, 32, 0.35); border-radius:30px; padding:6px 14px; margin-bottom:18px;">
                <span style="color:#DAA520; font-size:10px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase;">🔐 AUTOMATED SYSTEM BACKUP</span>
              </div>
              <h1 style="margin:0 0 6px 0; color:#ffffff; font-size:24px; font-weight:900; letter-spacing:-0.5px;">MUTHUWADIGE HARDWARE</h1>
              <p style="margin:0; color:#94a3b8; font-size:12px; font-weight:500;">No: 80, Mahahunupitiya, Negombo | 077 076 076 7</p>
            </div>
            <div style="padding:28px 24px;">
              <div style="margin-bottom:28px;">
                <h2 style="margin:0 0 16px 0; color:#1e293b; font-size:12px; font-weight:800; letter-spacing:1px; text-transform:uppercase;">📊 FINANCIAL PERFORMANCE SUMMARY</h2>
                <div style="background-color:#f8fafc; border:1px solid #f1f5f9; border-radius:14px; padding:14px 18px; margin-bottom:10px;">
                  <p style="margin:0 0 4px 0; color:#64748b; font-size:11px; font-weight:700;">Gross Sales</p>
                  <p style="margin:0; color:#0f172a; font-size:18px; font-weight:900;">LKR ${grossSellingRev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <div style="background-color:#f0fdf4; border:1px solid #bbf7d0; border-radius:14px; padding:14px 18px; margin-bottom:10px;">
                  <p style="margin:0 0 4px 0; color:#166534; font-size:11px; font-weight:700;">Net Sales Revenue</p>
                  <p style="margin:0; color:#15803d; font-size:18px; font-weight:900;">LKR ${netSellingRev.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <div style="background-color:#fef2f2; border:1px solid #fecaca; border-radius:14px; padding:14px 18px; margin-bottom:10px;">
                  <p style="margin:0 0 4px 0; color:#991b1b; font-size:11px; font-weight:700;">COGS (Historical Snapshot)</p>
                  <p style="margin:0; color:#b91c1c; font-size:18px; font-weight:900;">LKR ${netCostVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <div style="background-color:#fffbeb; border:1px solid #fef3c7; border-radius:14px; padding:14px 18px;">
                  <p style="margin:0 0 4px 0; color:#92400e; font-size:11px; font-weight:700;">Gross Profit</p>
                  <p style="margin:0; color:#b45309; font-size:18px; font-weight:900;">LKR ${(netSellingRev - netCostVal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>
              <div style="height:1px; background-color:#f1f5f9; margin-bottom:28px;"></div>
              <div>
                <h2 style="margin:0 0 16px 0; color:#1e293b; font-size:12px; font-weight:800; letter-spacing:1px; text-transform:uppercase;">💳 PAYMENT METHOD BREAKDOWN</h2>
                <div style="background-color:#f8fafc; border:1px solid #f1f5f9; border-radius:14px; padding:20px;">
                  <table style="width:100%; border-collapse:collapse; font-size:13px;">
                    <tbody>
                      <tr>
                        <td style="padding:7px 0; color:#475569; font-weight:600;">💵 Cash:</td>
                        <td style="padding:7px 0; color:#0f172a; font-weight:800; text-align:right;">LKR ${cashAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0; color:#475569; font-weight:600;">💳 Card:</td>
                        <td style="padding:7px 0; color:#0f172a; font-weight:800; text-align:right;">LKR ${cardAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0; color:#475569; font-weight:600;">📜 Credit:</td>
                        <td style="padding:7px 0; color:#0f172a; font-weight:800; text-align:right;">LKR ${creditAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0; color:#475569; font-weight:600;">🏦 Bank Transfer:</td>
                        <td style="padding:7px 0; color:#0f172a; font-weight:800; text-align:right;">LKR ${bankTransferAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0; color:#475569; font-weight:600;">🏛️ Cleared Cheques (Realized):</td>
                        <td style="padding:7px 0; color:#047857; font-weight:800; text-align:right;">LKR ${clearedChequeAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0; color:#475569; font-weight:600;">🪙 Cash Cheques (In Hand):</td>
                        <td style="padding:7px 0; color:#6b21a8; font-weight:800; text-align:right;">LKR ${cashChequesInHandAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding:10px 0 6px 0;"><div style="border-top:1px dashed #cbd5e1; width:100%;"></div></td>
                      </tr>
                      <tr>
                        <td style="padding:4px 0 0 0; color:#0f172a; font-weight:900; font-size:14px;">Total Collected & Settled:</td>
                        <td style="padding:4px 0 0 0; color:#0f172a; font-weight:900; font-size:15px; text-align:right;">LKR ${paymentTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              ${maturingCheques.length > 0 ? `
              <div style="background-color:#fffbeb; border:1px solid #fef3c7; border-radius:14px; padding:18px; margin-top:24px;">
                <div style="margin-bottom:10px;">
                  <p style="margin:0 0 2px 0; color:#92400e; font-size:11px; font-weight:800; letter-spacing:0.5px; text-transform:uppercase;">⏳ PENDING / MATURING CHEQUES (NEXT 48H)</p>
                  <p style="margin:0; color:#b45309; font-size:11px; font-weight:600;">${maturingCheques.length} Cheque(s) Due • Total: <strong>LKR ${maturingChequesTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></p>
                </div>
                <table style="width:100%; border-collapse:collapse; font-size:11px; color:#78350f;">
                  <thead>
                    <tr style="border-bottom:1px solid #fde68a; text-align:left;">
                      <th style="padding:4px 0;">Date</th>
                      <th style="padding:4px 0;">Cheque #</th>
                      <th style="padding:4px 0;">Bank</th>
                      <th style="padding:4px 0;">Party</th>
                      <th style="padding:4px 0; text-align:right;">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${maturingCheques.map(c => `
                      <tr style="border-bottom:1px dashed #fef3c7;">
                        <td style="padding:5px 0; font-weight:700;">${c.cheque_date}</td>
                        <td style="padding:5px 0; font-family:monospace;">#${c.cheque_number}</td>
                        <td style="padding:5px 0;">${c.bank_name}</td>
                        <td style="padding:5px 0;">${c.party_name || 'N/A'}</td>
                        <td style="padding:5px 0; text-align:right; font-weight:800;">LKR ${Number(c.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
              ` : ''}

              ${todayPRs.length > 0 ? `
              <div style="background-color:#eff6ff; border:1px solid #bfdbfe; border-radius:14px; padding:16px; margin-top:20px;">
                <p style="margin:0 0 4px 0; color:#1e40af; font-size:11px; font-weight:800; letter-spacing:0.5px; text-transform:uppercase;">🔄 PURCHASE RETURNS / DEBIT NOTES TODAY</p>
                <p style="margin:0; color:#1e3a8a; font-size:13px; font-weight:700;">
                  ${todayPRs.length} Debit Note(s) Issued • Total Returned Value: <strong>LKR ${todayPRTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
                </p>
              </div>
              ` : ''}
            </div>
            <div style="background-color:#161c2e; padding:20px 24px; text-align:center;">
              <p style="margin:0 0 4px 0; color:#DAA520; font-size:11px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase;">MUTHUWADIGE HARDWARE</p>
              <p style="margin:0; color:#64748b; font-size:10px; font-weight:600;">Automated Backup ID: ${dateStr}</p>
            </div>
          </div>
        </body>
        </html>
        `;

        log(`Sending backup email to ${targetEmail}...`);
        const result = await sendBackupEmail({
          toEmail: targetEmail,
          subject: `Hardware System Backup - ${dateStr}`,
          text: `Automated backup created on ${new Date().toLocaleString()}.\n\nGross Sales: LKR ${grossSellingRev}\nNet Sales Revenue: LKR ${netSellingRev}\nCOGS: LKR ${netCostVal}\nGross Profit: LKR ${netSellingRev - netCostVal}\nTotal Payment Methods: LKR ${paymentTotal}\n\nPlease find attached the Excel database backup.`,
          html: htmlBody,
          fileName,
          filePath,
          settings: rawSettings
        });

        if (result.success) {
          log(`Email sent successfully to ${targetEmail}`);
          emailSent = true;
        } else {
          logError(`Failed to send email notification: ${result.error || result.reason}`);
        }
      } catch (emailErr) {
        logError(`Failed to send email notification: ${emailErr.message}`);
      }
    }

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
    } catch (dbErr) { }
    releaseLock();
    process.exit(1);
  } finally {
    if (db) await db.close();
  }
}

runBackup();