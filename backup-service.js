import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import XLSX from 'xlsx-js-style';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

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

let db;

async function getDb() {
  if (!db) {
    db = await open({
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
  }
  return db;
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
    { hpt: 48 }, { hpt: 48 },
    { hpt: 24 }, { hpt: 28 },
    { hpt: 18 },
    { hpt: 38 },
    { hpt: 30 }, { hpt: 30 }, { hpt: 30 }, { hpt: 30 }, { hpt: 30 }, { hpt: 30 },
    { hpt: 18 },
    { hpt: 38 },
    { hpt: 28 }, { hpt: 28 }, { hpt: 28 }, { hpt: 28 }, { hpt: 32 },
    { hpt: 18 },
    { hpt: 38 },
    { hpt: 26 }, { hpt: 26 }, { hpt: 26 }, { hpt: 26 }
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
      } else if ((row === 5 || row === 13 || row === 20) && col >= 0 && col <= 8) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 13.5 },
          fill: { fgColor: { rgb: "1E293B" } },
          alignment: { vertical: "center", horizontal: "left" },
          border: {
            bottom: { style: "medium", color: { rgb: "0F172A" } },
            top: { style: "medium", color: { rgb: "0F172A" } }
          }
        };
      } else if (row >= 6 && row <= 11 && (col === 0 || col === 1)) {
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
          if (row === 6 || row === 10) { kpiFill = "D1FAE5"; kpiColor = "047857"; }
          else if (row === 7) { kpiFill = "E0F2FE"; kpiColor = "0369A1"; }
          else if (row === 8) { kpiFill = "FEF3C7"; kpiColor = "92400E"; }
          else if (row === 11) { kpiFill = "E0E7FF"; kpiColor = "3730A3"; }

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
      } else if (row >= 14 && row <= 18 && (col === 0 || col === 1)) {
        const isTotal = (row === 18);
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
      } else if (row >= 21 && row <= 24 && col === 0) {
        cell.s = {
          font: { name: "Segoe UI", sz: 11, italic: true, color: { rgb: "475569" } },
          alignment: { vertical: "center", horizontal: "left" }
        };
      }
    }
  }
};

const performBackup = async (fromDate = null, toDate = null) => {
  console.log("[Backup Service] Starting Backup Process...");
  try {
    const database = await getDb();

    const customers = await database.all('SELECT * FROM customers');
    let sales = await database.all('SELECT * FROM sales');
    const products = await database.all('SELECT * FROM products');
    const suppliers = await database.all('SELECT * FROM suppliers');
    let purchaseOrders = await database.all('SELECT * FROM purchase_orders');
    let transactions = await database.all('SELECT * FROM transactions');
    let stockAdjustments = await database.all('SELECT * FROM stock_adjustments');
    let quotations = await database.all('SELECT * FROM quotations');

    const profiles = await database.all('SELECT * FROM profiles');

    let rawSettings = await database.get('SELECT * FROM system_settings WHERE id = ?', ['global']);
    if (!rawSettings) {
      rawSettings = {
        shop_name: 'Muthuwadige Hardware',
        address: 'No: 80, Mahahunupitiya, Negombo',
        phone: '077 076 076 7',
        email: 'sanojhardware@gmail.com',
        currency: 'Rs.',
        tax_rate: 0,
        backup_email: 'sanojhardware@gmail.com',
        backup_enabled: 1,
        logo_path: '',
        printer_settings: '',
        branch_settings: '',
        updated_at: new Date().toISOString()
      };
    }
    const settings = [rawSettings];

    const rawEmployees = await database.all('SELECT * FROM employees ORDER BY name ASC');
    const employees = rawEmployees.map(e => ({
      ...e,
      attendance: e.attendance !== undefined ? e.attendance : 100
    }));

    const branches = await database.all('SELECT * FROM branches');
    const salesReturns = await database.all('SELECT * FROM sales_returns').catch(() => []);
    let creditPayments = await database.all('SELECT * FROM credit_payments').catch(() => []);

    const getSriLankaDateStr = (dateInput) => {
      if (!dateInput || dateInput === '---') return '';
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
    }

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

    // --- RECONCILED FINANCIAL ENGINE ---
    const activeReturns = salesReturns ? salesReturns.filter(r => r.status !== 'voided' && r.status !== 'Voided' && r.status !== 'cancelled') : [];
    const validSales = sales.filter(s => s.status?.toUpperCase() !== 'CANCELLED' && s.status?.toUpperCase() !== 'VOIDED');

    const getItemUnitCost = (product, itemUnit, itemConvRate, itemCostSnapshot) => {
      const snapshotCost = (itemCostSnapshot !== undefined && itemCostSnapshot !== null && !isNaN(Number(itemCostSnapshot)))
        ? Number(itemCostSnapshot)
        : null;
      const baseCost = snapshotCost !== null
        ? snapshotCost
        : (product ? Number(product.cost_price !== undefined ? product.cost_price : (product.costPrice !== undefined ? product.costPrice : 0)) : 0);
      let conversionRate = Number(itemConvRate) || 1;

      if ((!itemConvRate || conversionRate === 1) && itemUnit && (product.unit && itemUnit.toLowerCase() !== product.unit.toLowerCase())) {
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

    const netReturns = returnedSellingRev - exchangeSellingRev;
    const grossSellingRev = grossStickerSales;
    const netSellingRev = Math.max(0, grossStickerSales - customerDiscounts - netReturns + transportFees);
    const netCostVal = Math.max(0, grossCostVal + exchangeCostVal - returnedCostVal);

    const valB6 = Math.max(0, netSellingRev);
    const valB11 = netSellingRev - netCostVal;
    const totalCostOfSales = netCostVal;

    // Payment Attribution
    let directCash = 0;
    let directCard = 0;
    let directBank = 0;

    validSales.forEach(s => {
      const rawMethod = (s.payment_method || s.paymentMethod || '').toString().trim();
      const methodLower = rawMethod.toLowerCase();
      const isCredit = methodLower === 'credit' || s.is_credit === 1 || s.is_credit === true || s.status?.toLowerCase() === 'non paid' || s.status?.toLowerCase() === 'partially settled' || s.status?.toLowerCase() === 'pending';

      const totalAmt = Number(s.total_amount !== undefined ? s.total_amount : (s.total || 0));

      if (isCredit) {
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

    const cashAmount = Math.max(0, directCash + settledCash + exchangeCashInflowsTotal - cashRefundsTotal);
    const cardAmount = directCard + settledCard;
    const bankTransferAmount = directBank + settledBank;
    const creditAmount = totalCreditOutstanding;

    const valB8 = totalCreditOutstanding;
    const valB7 = cashAmount + cardAmount + bankTransferAmount;
    const valB9 = purchaseOrders.filter(po => po.status?.toUpperCase() !== 'CANCELLED').reduce((sum, po) => sum + (po.total || 0), 0);
    const valB10 = transactions.filter(t => t.type?.toUpperCase() === 'EXPENSE' && t.category !== 'Purchases').reduce((sum, t) => sum + (t.amount || 0), 0);
    const valB12 = products.reduce((sum, p) => sum + ((p.stock || 0) * (p.cost_price || 0)), 0);

    const totalSalesRevenue = valB6;
    const totalSalesProfit = valB11;
    const paymentTotal = cashAmount + cardAmount + creditAmount + bankTransferAmount;

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

    wsOverview['B7'] = { t: 'n', v: valB6, z: '#,##0.00' };
    wsOverview['B8'] = { t: 'n', v: valB7, z: '#,##0.00' };
    wsOverview['B9'] = { t: 'n', v: valB8, z: '#,##0.00' };
    wsOverview['B10'] = { t: 'n', v: valB9, z: '#,##0.00' };
    wsOverview['B11'] = { t: 'n', v: valB11, z: '#,##0.00' };
    wsOverview['B12'] = { t: 'n', v: valB12, z: '#,##0.00' };

    wsOverview['B15'] = { t: 'n', v: cashAmount, z: '#,##0.00' };
    wsOverview['B16'] = { t: 'n', v: cardAmount, z: '#,##0.00' };
    wsOverview['B17'] = { t: 'n', v: creditAmount, z: '#,##0.00' };
    wsOverview['B18'] = { t: 'n', v: bankTransferAmount, z: '#,##0.00' };
    wsOverview['B19'] = { t: 'n', v: paymentTotal, z: '#,##0.00' };

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
    const wsInventoryHeaders = [
      "Item Name", "Category", "Base Retail Price (Rs.)", "Base Cost Price (Rs.)",
      "Current Stock Level", "Measurement Unit", "Brand", "Supplier Entity",
      "Total Cost Value (Rs.)", "Total Market Value (Rs.)"
    ];
    const wsInventory = createWorksheet(structuredInventory, wsInventoryHeaders);
    setColWidths(wsInventory, structuredInventory, wsInventoryHeaders);
    applyTableStyles(wsInventory, "1E3A8A");

    const structuredSales = sales.map(s => ({
      "Invoice Number": s.invoice_no,
      "Customer Name": s.customer_name || 'Guest Customer',
      "Subtotal (Rs.)": s.subtotal || 0,
      "Total Amount (Rs.)": s.total_amount || 0,
      "Payment Received (Rs.)": s.payment_received || 0,
      "Payment Method": s.payment_method || 'Cash'
    }));
    const wsSales = createWorksheet(structuredSales, ["Invoice Number", "Customer Name", "Subtotal (Rs.)", "Total Amount (Rs.)", "Payment Received (Rs.)", "Payment Method"]);
    applyTableStyles(wsSales, "065F46");

    styleOverviewSheet(wsOverview);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsOverview, "Dashboard");
    XLSX.utils.book_append_sheet(wb, wsInventory, "Inventory Stock");
    XLSX.utils.book_append_sheet(wb, wsSales, "Sales & Invoices");

    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir);

    let dateStr = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const fileName = `Backup_${dateStr}.xlsx`;
    const filePath = path.join(backupsDir, fileName);

    XLSX.writeFile(wb, filePath);
    console.log("[Backup Service] Excel backup created successfully at:", filePath);

    return { success: true, message: 'Backup generated successfully' };
  } catch (e) {
    console.error("Backup process failed:", e);
    return { success: false, message: e.message };
  }
};

cron.schedule('0 18 * * 0', () => {
  console.log("Running Scheduled Automated Backup...");
  performBackup();
});

app.get('/api/trigger-backup', async (req, res) => {
  const { fromDate, toDate } = req.query || {};
  const result = await performBackup(fromDate, toDate);
  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(500).json(result);
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backup Service running on port ${PORT}`);
});