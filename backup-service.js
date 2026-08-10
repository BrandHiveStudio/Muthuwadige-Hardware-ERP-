import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import XLSX from 'xlsx-js-style';
import fs from 'fs';
const isDecimalUnit = (unit) => {
  if (!unit) return false;
  const PREDEFINED_UNITS = ['pcs', 'kg', 'g', 'liters', 'ml', 'meters', 'boxes', 'packets', 'rolls', 'bundles'];
  const decimals = ['kg', 'g', 'liters', 'ml', 'meters'];
  const name = unit.toLowerCase().trim();
  return decimals.includes(name) || !PREDEFINED_UNITS.includes(name);
};
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

let DB_FILE = path.join(__dirname, 'hardware.db');
let backupsDir = path.join(__dirname, 'backups');
let envPath = path.join(__dirname, '.env');

// Dynamically check AppData path
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
    }
  }
} catch (e) {
  // Standalone Node
}

dotenv.config({ path: envPath });

let db;

async function getDb() {
  if (!db) {
    db = await open({
      filename: DB_FILE,
      driver: sqlite3.Database
    });
    await db.exec("PRAGMA busy_timeout = 10000;");
  }
  return db;
}

// Helper to calculate column widths dynamically
const setColWidths = (ws, structuredData, headers) => {
  if (!structuredData || structuredData.length === 0) {
    if (headers) {
      ws['!cols'] = headers.map(h => ({ wch: Math.max(h.toString().length + 4, 12) }));
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
    return { wch: Math.min(Math.max(maxLen + 4, 12), 40) };
  });
};

const getExcelDecimalDate = (dateVal) => {
  if (!dateVal || dateVal === '---') return null;
  const date = new Date(dateVal);
  if (isNaN(date.getTime())) return null;
  // Excel date epoch is 1899-12-30 (due to leap year bug in 1900)
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

// Apply themed styling to headers and rows
const applyTableStyles = (ws, themeColor) => {
  const ref = ws['!ref'];
  if (!ref) return;
  
  const range = XLSX.utils.decode_range(ref);
  const headerRow = range.s.r;

  // Find which column indices correspond to dates
  const dateColIndices = [];
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellRef = XLSX.utils.encode_cell({ r: headerRow, c: col });
    const cell = ws[cellRef];
    if (cell && cell.v) {
      const label = String(cell.v).toLowerCase();
      if (label.includes('date') || label.includes('time') || label.includes('timestamp')) {
        dateColIndices.push(col);
      }
    }
  }
  
  // Header Style
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellRef = XLSX.utils.encode_cell({ r: range.s.r, c: col });
    const cell = ws[cellRef];
    if (cell) {
      cell.s = {
        font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 11 },
        fill: { fgColor: { rgb: themeColor } }, 
        alignment: { vertical: "center", horizontal: "center", wrapText: true },
        border: {
          bottom: { style: "medium", color: { rgb: "333333" } },
          top: { style: "thin", color: { rgb: "E2E8F0" } },
          left: { style: "thin", color: { rgb: "E2E8F0" } },
          right: { style: "thin", color: { rgb: "E2E8F0" } }
        }
      };
    }
  }

  // Data Style
  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    const isEven = (row % 2 === 0);
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = ws[cellRef];
      if (cell) {
        const bgColor = isEven ? "F8FAFC" : "FFFFFF";
        let alignment = "left";
        if (typeof cell.v === 'number') {
          alignment = "right";
        }
        
        // If it's a date column and has a numeric value, format it as date
        if (dateColIndices.includes(col) && typeof cell.v === 'number') {
          cell.z = 'yyyy-mm-dd';
          alignment = "center";
        }

        cell.s = {
          font: { name: "Segoe UI", sz: 10, color: { rgb: "334155" } },
          fill: { fgColor: { rgb: bgColor } },
          alignment: { vertical: "center", horizontal: alignment },
          border: {
            bottom: { style: "thin", color: { rgb: "F1F5F9" } },
            top: { style: "thin", color: { rgb: "F1F5F9" } },
            left: { style: "thin", color: { rgb: "F1F5F9" } },
            right: { style: "thin", color: { rgb: "F1F5F9" } }
          }
        };
      }
    }
  }
};

const styleOverviewSheet = (ws) => {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  
  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = ws[cellRef];
      if (!cell) continue;

      // Default font
      cell.s = {
        font: { name: "Segoe UI", sz: 10, color: { rgb: "334155" } }
      };

      // 1. Banner Title (A1:I2)
      if (row === 0 || row === 1) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 16 },
          fill: { fgColor: { rgb: "581C87" } }, // royal purple
          alignment: { vertical: "center", horizontal: "center" }
        };
      }
      // 2. Month Start & Month End Headers (A3:B3)
      else if (row === 2 && (col === 0 || col === 1)) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 10 },
          fill: { fgColor: { rgb: "581C87" } },
          alignment: { vertical: "center", horizontal: "center" }
        };
      }
      // 3. Month Date Values (A4:B4)
      else if (row === 3 && (col === 0 || col === 1)) {
        cell.s = {
          font: { name: "Segoe UI", sz: 10, bold: true },
          alignment: { vertical: "center", horizontal: "center" },
          border: {
            bottom: { style: "thin", color: { rgb: "E2E8F0" } },
            top: { style: "thin", color: { rgb: "E2E8F0" } },
            left: { style: "thin", color: { rgb: "E2E8F0" } },
            right: { style: "thin", color: { rgb: "E2E8F0" } }
          }
        };
      }
      // 4. KPI Table (Rows 6-11, columns A and B)
      else if (row >= 5 && row <= 10 && (col === 0 || col === 1)) {
        const isLeftColumn = (col === 0);
        
        if (isLeftColumn) {
          // Light purple background with dark purple text
          cell.s = {
            font: { bold: true, color: { rgb: "3B0764" }, name: "Segoe UI", sz: 10 },
            fill: { fgColor: { rgb: "F3E8FF" } },
            alignment: { vertical: "center", horizontal: "center", wrapText: true },
            border: {
              bottom: { style: "thin", color: { rgb: "E9D5FF" } },
              top: { style: "thin", color: { rgb: "E9D5FF" } },
              left: { style: "thin", color: { rgb: "E9D5FF" } },
              right: { style: "thin", color: { rgb: "E9D5FF" } }
            }
          };
        } else {
          // Right value column: styled nicely with borders
          cell.s = {
            font: { bold: true, name: "Segoe UI", sz: 10, color: { rgb: "0F172A" } },
            fill: { fgColor: { rgb: "F1F5F9" } },
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
      // 5. Useful Notes Header (A13)
      else if (row === 12 && col >= 0 && col <= 8) {
        cell.s = {
          font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 11 },
          fill: { fgColor: { rgb: "581C87" } },
          alignment: { vertical: "center", horizontal: "left" }
        };
      }
      // 6. Useful Notes details (Rows 14-17)
      else if (row >= 13 && row <= 16 && col >= 0 && col <= 8) {
        cell.s = {
          font: { name: "Segoe UI", sz: 9.5, italic: true, color: { rgb: "475569" } },
          alignment: { vertical: "center", horizontal: "left" }
        };
      }
    }
  }
};

const performBackup = async (fromDate = null, toDate = null) => {
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
    
    // system settings snapshot inline logic
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

    // employees snapshot inline logic
    const rawEmployees = await database.all('SELECT * FROM employees ORDER BY name ASC');
    const employees = rawEmployees.map(e => ({
      ...e,
      attendance: e.attendance !== undefined ? e.attendance : 100
    }));

    const branches = await database.all('SELECT * FROM branches');

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

    // Stats declarations for email HTML
    const totalSalesRevenue = valB6;
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
        console.warn("Failed to parse items for profit calculation in backup", err);
      }
    });
    const totalExpenses = valB10;
    const netCashFlow = valB7 - valB10;
    const totalInventoryValue = valB12;
    const totalOutstandingCredit = valB8;
    const totalSupplierPayables = suppliers.reduce((sum, s) => sum + (s.payable_balance || 0), 0);
    const todayStr = new Date().toISOString().substring(0, 10);
    const todaySales = sales.filter(s => (s.created_at || s.date || '').substring(0, 10) === todayStr);
    const todaySalesRevenue = todaySales.reduce((sum, s) => sum + (s.total_amount || 0), 0);
    const cancelledSalesCount = sales.filter(s => s.status === 'cancelled' || s.status === 'Cancelled' || s.status === 'CANCELLED').length;
    const lowStockProducts = products.filter(p => {
      const minStock = p.min_stock !== undefined ? p.min_stock : 10;
      return (p.stock || 0) < minStock;
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

    // Set dynamic date cell values as numbers formatted as yyyy-mm-dd
    wsOverview['A4'] = { t: 'n', v: getExcelDecimalDate(finalStart), z: 'yyyy-mm-dd' };
    wsOverview['B4'] = { t: 'n', v: getExcelDecimalDate(finalEnd), z: 'yyyy-mm-dd' };

    // Set dynamic formulas with initial pre-calculated values
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
    applyTableStyles(wsInventory, "1E3A8A");

    // 2. Sales Orders Sheet
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
                let cost = product ? Number(product.cost_price || 0) : 0;
                if (product) {
                  const measureDetailsStr = product.measure_details || product.measureDetails;
                  if (measureDetailsStr) {
                    try {
                      const parsed = JSON.parse(measureDetailsStr);
                      if (parsed && Array.isArray(parsed.conversions)) {
                        const matchedConv = parsed.conversions.find(c => c.unit.toLowerCase() === (it.unit || '').toLowerCase());
                        if (matchedConv) {
                          const rate = Number(matchedConv.kgVal) || 1;
                          if (isDecimalUnit(product.unit)) {
                            cost = cost / rate;
                          } else {
                            cost = cost * rate;
                          }
                        }
                      }
                    } catch (e) {}
                  }
                }
                const qty = Number(it.qty || 1);
                totalCostOfSale += qty * cost;
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
    applyTableStyles(wsCustomers, "1E3A8A");

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
    applyTableStyles(wsEmployees, "1E3A8A");

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
    applyTableStyles(wsProfiles, "1E3A8A");

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
    applyTableStyles(wsSettings, "1E3A8A");

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
    applyTableStyles(wsSuppliers, "1E3A8A");

    // 9. Purchase Orders Sheet
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

    styleOverviewSheet(wsOverview);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsOverview, "Dashboard");
    XLSX.utils.book_append_sheet(wb, wsInventory, "Inventory Stock");
    XLSX.utils.book_append_sheet(wb, wsSales, "Sales & Invoices");
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

    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir);

    let dateStr = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    if (fromDate || toDate) {
      const fromStr = fromDate || 'Start';
      const toStr = toDate || 'End';
      dateStr = `${fromStr}_to_${toStr}`;
    }
    const fileName = `Backup_${dateStr}.xlsx`;
    const filePath = path.join(backupsDir, fileName);

    XLSX.writeFile(wb, filePath);
    console.log("[Backup Service] Excel backup created successfully at:", filePath);



    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_PASS;

    if (!gmailUser || !gmailPass) {
      console.warn("GMAIL_USER or GMAIL_PASS not set in .env! Backup saved locally but email skipped.");
      return { success: true, message: 'Backup created successfully locally. Email skipped due to missing credentials.' };
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass }
    });

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Muthuwadige Hardware - Daily Backup Report</title></head>
    <body style="margin:0;padding:0;background:#f0f4f8;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
      <div style="max-width:680px;margin:0 auto;padding:24px 16px;">

        <!-- Header Banner -->
        <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 60%,#1a1a2e 100%);border-radius:20px 20px 0 0;padding:36px 32px;position:relative;overflow:hidden;">
          <div style="position:absolute;top:-20px;right:-20px;width:120px;height:120px;background:rgba(218,165,32,0.15);border-radius:50%;"></div>
          <div style="position:absolute;bottom:-30px;left:-10px;width:100px;height:100px;background:rgba(255,255,255,0.03);border-radius:50%;"></div>
          <div style="position:relative;">
            <div style="display:inline-block;background:rgba(218,165,32,0.2);border:1px solid rgba(218,165,32,0.4);border-radius:12px;padding:8px 16px;margin-bottom:16px;">
              <span style="color:#DAA520;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;">🔐 Automated Daily Backup</span>
            </div>
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:900;letter-spacing:-0.5px;">Muthuwadige Hardware</h1>
            <p style="margin:6px 0 0 0;color:#94a3b8;font-size:13px;">No: 80, Mahahunupitiya, Negombo | 077 076 076 7</p>
            <div style="margin-top:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
              <span style="background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.3);color:#4ade80;font-size:11px;font-weight:700;padding:4px 12px;border-radius:100px;">✅ Backup Successful</span>
              <span style="color:#64748b;font-size:12px;">📅 ${new Date().toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</span>
              <span style="color:#64748b;font-size:12px;">⏰ ${new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}</span>
            </div>
          </div>
        </div>

        <!-- Key Metrics Summary Bar -->
        <div style="background:#DAA520;padding:16px 32px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <span style="color:#7c5700;font-size:10px;font-weight:900;letter-spacing:2px;text-transform:uppercase;">📊 Business Snapshot</span>
          <span style="color:#7c5700;font-size:11px;font-weight:700;">File: ${fileName}</span>
        </div>

        <!-- Primary Stats Cards -->
        <div style="background:#ffffff;padding:28px 28px 20px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
          <h2 style="margin:0 0 20px 0;color:#0f172a;font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #f1f5f9;padding-bottom:12px;">💰 Financial Performance Summary</h2>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">

            <!-- Total Sales -->
            <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:16px;padding:20px;position:relative;overflow:hidden;">
              <div style="position:absolute;top:-15px;right:-15px;width:70px;height:70px;background:rgba(255,255,255,0.05);border-radius:50%;"></div>
              <p style="margin:0;color:#94a3b8;font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Total Sales Revenue</p>
              <p style="margin:8px 0 0 0;color:#ffffff;font-size:22px;font-weight:900;">Rs. ${totalSalesRevenue.toLocaleString(undefined, {maximumFractionDigits:2, minimumFractionDigits:2})}</p>
              <p style="margin:6px 0 0 0;color:#64748b;font-size:11px;">📦 ${sales.length} total orders</p>
            </div>

            <!-- Total Profit -->
            <div style="background:linear-gradient(135deg,#064e3b,#065f46);border-radius:16px;padding:20px;position:relative;overflow:hidden;">
              <div style="position:absolute;top:-15px;right:-15px;width:70px;height:70px;background:rgba(255,255,255,0.05);border-radius:50%;"></div>
              <p style="margin:0;color:#6ee7b7;font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Net Profit</p>
              <p style="margin:8px 0 0 0;color:${totalSalesProfit >= 0 ? '#34d399' : '#f87171'};font-size:22px;font-weight:900;">${totalSalesProfit >= 0 ? '+' : ''}Rs. ${totalSalesProfit.toLocaleString(undefined, {maximumFractionDigits:2, minimumFractionDigits:2})}</p>
              <p style="margin:6px 0 0 0;color:#6ee7b7;font-size:11px;">📈 Profit on cost of goods sold</p>
            </div>

            <!-- Total Expenses / Loss -->
            <div style="background:linear-gradient(135deg,#7f1d1d,#991b1b);border-radius:16px;padding:20px;position:relative;overflow:hidden;">
              <div style="position:absolute;top:-15px;right:-15px;width:70px;height:70px;background:rgba(255,255,255,0.05);border-radius:50%;"></div>
              <p style="margin:0;color:#fca5a5;font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Total Expenses (Ledger)</p>
              <p style="margin:8px 0 0 0;color:#f87171;font-size:22px;font-weight:900;">Rs. ${totalExpenses.toLocaleString(undefined, {maximumFractionDigits:2, minimumFractionDigits:2})}</p>
              <p style="margin:6px 0 0 0;color:#fca5a5;font-size:11px;">💸 Purchases, rent & utilities</p>
            </div>

            <!-- Net Cash Flow -->
            <div style="background:linear-gradient(135deg,#1e3a5f,#1d4ed8);border-radius:16px;padding:20px;position:relative;overflow:hidden;">
              <div style="position:absolute;top:-15px;right:-15px;width:70px;height:70px;background:rgba(255,255,255,0.05);border-radius:50%;"></div>
              <p style="margin:0;color:#bfdbfe;font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">Net Cash Flow Balance</p>
              <p style="margin:8px 0 0 0;color:${netCashFlow >= 0 ? '#60a5fa' : '#f87171'};font-size:22px;font-weight:900;">${netCashFlow >= 0 ? '+' : ''}Rs. ${netCashFlow.toLocaleString(undefined, {maximumFractionDigits:2, minimumFractionDigits:2})}</p>
              <p style="margin:6px 0 0 0;color:#bfdbfe;font-size:11px;">🏦 Income minus expenses</p>
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
                  <td style="padding:8px 0;font-weight:800;color:#0f172a;text-align:right;">Rs. ${cashAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#334155;font-weight:600;">💳 Card:</td>
                  <td style="padding:8px 0;font-weight:800;color:#0f172a;text-align:right;">Rs. ${cardAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#334155;font-weight:600;">📜 Credit:</td>
                  <td style="padding:8px 0;font-weight:800;color:#0f172a;text-align:right;">Rs. ${creditAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0;color:#334155;font-weight:600;">🏦 Bank Transfer:</td>
                  <td style="padding:8px 0;font-weight:800;color:#0f172a;text-align:right;">Rs. ${bankTransferAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                </tr>
                <tr style="border-top:2px dashed #cbd5e1;">
                  <td style="padding:10px 0 2px 0;color:#0f172a;font-weight:800;font-size:14px;">Total:</td>
                  <td style="padding:10px 0 2px 0;font-weight:900;color:#0f172a;font-size:15px;text-align:right;">Rs. ${paymentTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Secondary Stats: Inventory, Credit, Suppliers -->
        <div style="background:#ffffff;padding:0 28px 28px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
          <h2 style="margin:0 0 16px 0;color:#0f172a;font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #f1f5f9;padding-bottom:12px;">📋 Detailed Business Statistics</h2>

          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tbody>
              <tr style="background:#f8fafc;">
                <td style="padding:12px 14px;color:#475569;font-weight:600;border-bottom:1px solid #f1f5f9;border-radius:8px 0 0 0;">🏪 Inventory Asset Value</td>
                <td style="padding:12px 14px;font-weight:800;color:#0f172a;border-bottom:1px solid #f1f5f9;text-align:right;">Rs. ${totalInventoryValue.toLocaleString(undefined, {maximumFractionDigits:2})}</td>
                <td style="padding:12px 14px;color:#475569;font-weight:600;border-bottom:1px solid #f1f5f9;">📦 Total Products in Stock</td>
                <td style="padding:12px 14px;font-weight:800;color:#0f172a;border-bottom:1px solid #f1f5f9;text-align:right;">${products.length}</td>
              </tr>
              <tr>
                <td style="padding:12px 14px;color:#475569;font-weight:600;border-bottom:1px solid #f1f5f9;">👥 Registered Customers</td>
                <td style="padding:12px 14px;font-weight:800;color:#0f172a;border-bottom:1px solid #f1f5f9;text-align:right;">${customers.length}</td>
                <td style="padding:12px 14px;color:#475569;font-weight:600;border-bottom:1px solid #f1f5f9;">🚛 Total Suppliers</td>
                <td style="padding:12px 14px;font-weight:800;color:#0f172a;border-bottom:1px solid #f1f5f9;text-align:right;">${suppliers.length}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td style="padding:12px 14px;color:#dc2626;font-weight:600;border-bottom:1px solid #f1f5f9;">💳 Outstanding Customer Credit</td>
                <td style="padding:12px 14px;font-weight:800;color:#dc2626;border-bottom:1px solid #f1f5f9;text-align:right;">Rs. ${totalOutstandingCredit.toLocaleString(undefined, {maximumFractionDigits:2})}</td>
                <td style="padding:12px 14px;color:#ea580c;font-weight:600;border-bottom:1px solid #f1f5f9;">💰 Supplier Payables Owed</td>
                <td style="padding:12px 14px;font-weight:800;color:#ea580c;border-bottom:1px solid #f1f5f9;text-align:right;">Rs. ${totalSupplierPayables.toLocaleString(undefined, {maximumFractionDigits:2})}</td>
              </tr>
              <tr>
                <td style="padding:12px 14px;color:#475569;font-weight:600;border-bottom:1px solid #f1f5f9;">📅 Today's Sales</td>
                <td style="padding:12px 14px;font-weight:800;color:#0f172a;border-bottom:1px solid #f1f5f9;text-align:right;">Rs. ${todaySalesRevenue.toLocaleString(undefined, {maximumFractionDigits:2})} (${todaySales.length} orders)</td>
                <td style="padding:12px 14px;color:#475569;font-weight:600;border-bottom:1px solid #f1f5f9;">❌ Cancelled Orders</td>
                <td style="padding:12px 14px;font-weight:800;color:#0f172a;border-bottom:1px solid #f1f5f9;text-align:right;">${cancelledSalesCount}</td>
              </tr>
              <tr style="background:#fff7ed;">
                <td style="padding:12px 14px;color:#c2410c;font-weight:600;border-bottom:1px solid #f1f5f9;">⚠️ Low Stock Products</td>
                <td style="padding:12px 14px;font-weight:800;color:#c2410c;border-bottom:1px solid #f1f5f9;text-align:right;">${lowStockProducts.length} items</td>
                <td style="padding:12px 14px;color:#475569;font-weight:600;border-bottom:1px solid #f1f5f9;">📄 Backup Sheets</td>
                <td style="padding:12px 14px;font-weight:800;color:#0f172a;border-bottom:1px solid #f1f5f9;text-align:right;">14 Sheets</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Alert: Low Stock Warning -->
        ${lowStockProducts.length > 0 ? `
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f97316;padding:16px 24px;margin:0;border-left-width:4px;">
          <p style="margin:0;color:#c2410c;font-weight:800;font-size:13px;">⚠️ Low Stock Alert: ${lowStockProducts.length} product(s) need restocking</p>
          <p style="margin:6px 0 0 0;color:#9a3412;font-size:12px;">${lowStockProducts.slice(0,5).map(p => `${p.name} (${p.stock || 0} left)`).join(' · ')}${lowStockProducts.length > 5 ? ` +${lowStockProducts.length - 5} more` : ''}</p>
        </div>` : ''}

        <!-- Attached File Info -->
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;padding:20px 28px;border-radius:0 0 0 0;">
          <div style="display:flex;align-items:center;gap:16px;background:white;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;">
            <div style="width:44px;height:44px;background:linear-gradient(135deg,#16a34a,#15803d);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">📊</div>
            <div style="flex:1;">
              <p style="margin:0;font-weight:800;color:#0f172a;font-size:13px;">${fileName}</p>
              <p style="margin:4px 0 0 0;color:#64748b;font-size:11px;">Excel Workbook · 14 sheets · Inventory, Sales, Transactions, Customers, Suppliers & more</p>
            </div>
            <span style="background:#dcfce7;color:#166534;font-size:10px;font-weight:700;padding:4px 10px;border-radius:100px;letter-spacing:0.5px;">ATTACHED</span>
          </div>
        </div>

        <!-- Footer -->
        <div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:24px 32px;border-radius:0 0 20px 20px;text-align:center;">
          <p style="margin:0;color:#DAA520;font-size:13px;font-weight:800;letter-spacing:1px;">MUTHUWADIGE HARDWARE</p>
          <p style="margin:4px 0 0 0;color:#475569;font-size:11px;">No: 80, Mahahunupitiya, Negombo | 077 076 076 7</p>
          <div style="margin:16px 0;height:1px;background:rgba(255,255,255,0.06);"></div>
          <p style="margin:0;color:#334155;font-size:11px;">This is an automated backup generated by the Hardwarer ERP system. Please store this file securely.</p>
          <p style="margin:6px 0 0 0;color:#1e3a5f;font-size:10px;font-weight:600;">Generated: ${new Date().toLocaleString('en-GB')} · Backup ID: ${dateStr}</p>
        </div>

      </div>
    </body></html>
    `;

    await transporter.sendMail({
      from: gmailUser,
      to: rawSettings?.backup_email || 'sanojhardware@gmail.com',
      subject: `Hardware System Backup - ${dateStr}`,
      text: `Automated backup created on ${new Date().toLocaleString()}.

Payment Method Breakdown:
----------------------------
Cash: Rs. ${cashAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
Card: Rs. ${cardAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
Credit: Rs. ${creditAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
Bank Transfer: Rs. ${bankTransferAmount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
----------------------------
Total: Rs. ${paymentTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}

Please find attached the Excel database backup.`,
      html,
      attachments: [{ filename: fileName, path: filePath }]
    });

    console.log("Backup sent successfully to " + (rawSettings?.backup_email || "sanojhardware@gmail.com") + "!");
    return { success: true, message: 'Backup emailed successfully!' };
  } catch (e) {
    console.error("Backup process failed:", e);
    return { success: false, message: e.message };
  }
};

// Sunday at 6:00 PM cron schedule ('0 18 * * 0')
cron.schedule('0 18 * * 0', () => {
  console.log("Running Scheduled Automated Backup (Weekly Sunday at 6:00 PM)...");
  performBackup();
});

app.get('/api/trigger-backup', async (req, res) => {
  console.log("Manual backup triggered via backup-service API");
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
  console.log(`Cron scheduled for Weekly Sunday at 6:00 PM`);
});
