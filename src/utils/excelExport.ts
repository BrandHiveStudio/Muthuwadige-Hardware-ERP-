import XLSX from 'xlsx-js-style';
import { supabase } from '../lib/supabaseClient';
import { api } from '../lib/api';
import {
  toSriLankaDateStr,
  isWithinDateRange,
  computeFinancialSummary,
  computePaymentBreakdown
} from './accounting';

export interface ExcelExportOptions {
  fromDate?: string;
  toDate?: string;
  fileNamePrefix?: string;
}

const getExcelDecimalDate = (dateVal: any): string => {
  return toSriLankaDateStr(dateVal);
};

const setColWidths = (ws: any, structuredData: any[], headers?: string[]) => {
  if (!structuredData || structuredData.length === 0) {
    if (headers) {
      ws['!cols'] = headers.map(h => ({ wch: Math.max(h.toString().length + 8, 20) }));
    }
    return;
  }
  const keys = headers || Object.keys(structuredData[0]);
  ws['!cols'] = keys.map(key => {
    let maxLen = key.toString().length;
    structuredData.forEach(row => {
      const val = row[key];
      if (val !== null && val !== undefined) {
        maxLen = Math.max(maxLen, val.toString().length);
      }
    });
    return { wch: Math.max(maxLen + 4, 14) };
  });
};

const applyTableStyles = (ws: any, headerBgColorHex: string = "0F172A") => {
  const ref = ws['!ref'];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);

  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
    if (ws[cellRef]) {
      ws[cellRef].s = {
        font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11, name: "Segoe UI" },
        fill: { fgColor: { rgb: headerBgColorHex } },
        alignment: { vertical: "center", horizontal: "left" }
      };
    }
  }

  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    const isEven = row % 2 === 0;
    const bg = isEven ? "F8FAFC" : "FFFFFF";
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
      if (ws[cellRef]) {
        ws[cellRef].s = {
          font: { name: "Segoe UI", sz: 10, color: { rgb: "334155" } },
          fill: { fgColor: { rgb: bg } },
          alignment: { vertical: "center" },
          border: {
            bottom: { style: "thin", color: { rgb: "F1F5F9" } },
            top: { style: "thin", color: { rgb: "F1F5F9" } }
          }
        };
      }
    }
  }
};

/**
 * Generates and downloads the full 17-sheet master database backup workbook directly in the client browser.
 */
export async function exportFullDatabaseExcelBackup(options: ExcelExportOptions = {}): Promise<void> {
  const { fromDate, toDate, fileNamePrefix = 'Muthuwadige_Hardware_Backup' } = options;

  // 1. Fetch all datasets
  const [
    productsRes,
    salesRes,
    customersRes,
    suppliersRes,
    poRes,
    transRes,
    adjustmentsRes,
    quotesRes,
    employeesRes,
    profilesRes,
    settingsRes,
    branchesRes,
    salesReturnsRes,
    creditPaymentsRes,
    chequesData,
    purchaseReturnsData,
    prItemsRes
  ] = await Promise.all([
    supabase.from('products').select('*'),
    supabase.from('sales').select('*'),
    supabase.from('customers').select('*'),
    supabase.from('suppliers').select('*'),
    supabase.from('purchase_orders').select('*'),
    supabase.from('transactions').select('*'),
    supabase.from('stock_adjustments').select('*'),
    supabase.from('quotations').select('*'),
    supabase.from('employees').select('*'),
    supabase.from('profiles').select('*'),
    supabase.from('system_settings').select('*'),
    supabase.from('branches').select('*'),
    supabase.from('sales_returns').select('*'),
    supabase.from('credit_payments').select('*'),
    api.cheques.getAll().catch(() => []),
    api.purchaseReturns.getAll().catch(() => []),
    supabase.from('purchase_return_items').select('*')
  ]);

  const products = productsRes.data || [];
  let sales = salesRes.data || [];
  const customers = customersRes.data || [];
  const suppliers = suppliersRes.data || [];
  let purchaseOrders = poRes.data || [];
  let transactions = transRes.data || [];
  let stockAdjustments = adjustmentsRes.data || [];
  let quotations = quotesRes.data || [];
  const employees = employeesRes.data || [];
  const profiles = profilesRes.data || [];
  const settings = settingsRes.data || [];
  const branches = branchesRes.data || [];
  const salesReturns = salesReturnsRes.data || [];
  const creditPayments = creditPaymentsRes.data || [];
  let cheques = chequesData || [];
  let purchaseReturns = purchaseReturnsData || [];
  const purchaseReturnItems = prItemsRes.data || [];

  if (fromDate || toDate) {
    sales = sales.filter((s: any) => isWithinDateRange(s.created_at || s.date, fromDate, toDate));
    transactions = transactions.filter((t: any) => isWithinDateRange(t.date || t.created_at, fromDate, toDate));
    purchaseOrders = purchaseOrders.filter((po: any) => isWithinDateRange(po.created_at, fromDate, toDate));
    stockAdjustments = stockAdjustments.filter((sa: any) => isWithinDateRange(sa.created_at, fromDate, toDate));
    quotations = quotations.filter((q: any) => isWithinDateRange(q.created_at, fromDate, toDate));
    cheques = cheques.filter((c: any) => isWithinDateRange(c.cheque_date || c.created_at, fromDate, toDate));
    purchaseReturns = purchaseReturns.filter((pr: any) => isWithinDateRange(pr.return_date || pr.created_at, fromDate, toDate));
  }

  const wb = XLSX.utils.book_new();

  // --- Authoritative Financial Engine Calculations ---
  const finSummary = computeFinancialSummary({
    sales,
    salesReturns,
    products,
    fromDate,
    toDate
  });

  const payBreakdown = computePaymentBreakdown({
    sales,
    creditPayments,
    salesReturns,
    cheques,
    fromDate,
    toDate
  });

  const grossSellingRev = finSummary.grossStickerSales;
  const netSellingRev = finSummary.netSalesRevenue;
  const netCostVal = finSummary.netCOGS;
  const grossProfitVal = finSummary.grossProfit;

  const cashAmount = payBreakdown.totalCashCollected;
  const cardAmount = payBreakdown.totalCardCollected;
  const bankTransferAmount = payBreakdown.totalBankCollected;
  const creditAmount = payBreakdown.customerCreditOutstanding;
  const clearedChequeAmount = payBreakdown.clearedChequesAmount;
  const cashChequesInHandAmount = payBreakdown.cashChequesInHandAmount;
  const pendingChequesAmount = payBreakdown.pendingChequesAmount;
  const totalRevenueCollected = payBreakdown.totalRevenueCollected;
  const paymentTotal = payBreakdown.totalPaymentMethods;

  const totalPurchases = purchaseOrders.filter((po: any) => po.status?.toUpperCase() !== 'CANCELLED').reduce((sum: number, po: any) => sum + Number(po.total || 0), 0);
  const totalStockValue = products.reduce((sum: number, p: any) => sum + (Number(p.stock || 0) * Number(p.cost_price || 0)), 0);

  const finalStart = fromDate || 'Start';
  const finalEnd = toDate || 'Present';

  // 1. Dashboard Sheet
  const overviewRows = [
    ["MUTHUWADIGE HARDWARE - BUSINESS & ACCOUNTING BACKUP REPORT", "", "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["Report Start Date", "Report End Date", "", "", "", "", "", "", ""],
    [finalStart, finalEnd, "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["KEY BUSINESS METRICS (ERP SUMMARY)", "", "", "", "", "", "", "", ""],
    ["Gross Sales", grossSellingRev, "", "", "", "", "", "", ""],
    ["Net Sales Revenue", netSellingRev, "", "", "", "", "", "", ""],
    ["Cost of Goods Sold (COGS)", netCostVal, "", "", "", "", "", "", ""],
    ["Gross Profit", grossProfitVal, "", "", "", "", "", "", ""],
    ["Total Revenue Collected", totalRevenueCollected, "", "", "", "", "", "", ""],
    ["Customer Credit Outstanding", creditAmount, "", "", "", "", "", "", ""],
    ["Total Purchases", totalPurchases, "", "", "", "", "", "", ""],
    ["Total Stock Value", totalStockValue, "", "", "", "", "", "", ""],
    ["", "", "", "", "", "", "", "", ""],
    ["PAYMENT METHOD BREAKDOWN", "", "", "", "", "", "", "", ""],
    ["Cash Amount", cashAmount, "", "", "", "", "", "", ""],
    ["Card Amount", cardAmount, "", "", "", "", "", "", ""],
    ["Credit Amount", creditAmount, "", "", "", "", "", "", ""],
    ["Bank Transfer Amount", bankTransferAmount, "", "", "", "", "", "", ""],
    ["Cleared Cheque Amount", clearedChequeAmount, "", "", "", "", "", "", ""],
    ["Cash Cheques (In Hand / Drawer)", cashChequesInHandAmount, "", "", "", "", "", "", ""],
    ["Pending Cheques (Uncleared / PDC)", pendingChequesAmount, "", "", "", "", "", "", ""],
    ["Total Payment Methods", paymentTotal, "", "", "", "", "", "", ""],
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
  wsOverview['!cols'] = [{ wch: 38 }, { wch: 24 }, { wch: 6 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
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

  // 2. Inventory Stock Sheet
  const structuredInventory = products.map((p: any) => ({
    "Item Name": p.name,
    "Category": p.category || 'Other',
    "Base Retail Price (Rs.)": Number(p.price || 0),
    "Base Cost Price (Rs.)": Number(p.cost_price || 0),
    "Current Stock Level": Number(p.stock || 0),
    "Measurement Unit": p.unit || 'pcs',
    "Brand": p.brand || '',
    "Supplier Entity": p.supplier || '',
    "Total Cost Value (Rs.)": Number(p.stock || 0) * Number(p.cost_price || 0),
    "Total Market Value (Rs.)": Number(p.stock || 0) * Number(p.price || 0)
  }));
  const wsInventory = XLSX.utils.json_to_sheet(structuredInventory);
  setColWidths(wsInventory, structuredInventory);
  applyTableStyles(wsInventory, "0F172A");

  // 3. Sales & Invoices Sheet
  const structuredSales = sales.filter((s: any) => s.status?.toUpperCase() !== 'CANCELLED' && s.status?.toUpperCase() !== 'VOIDED').map((s: any) => ({
    "Invoice Number": s.invoice_no,
    "Customer Name": s.customer_name || 'Guest Customer',
    "Total Amount (Rs.)": Number(s.total_amount || 0),
    "Payment Received (Rs.)": Number(s.payment_received || 0),
    "Outstanding Balance (Rs.)": Math.max(0, Number(s.total_amount || 0) - Number(s.payment_received || 0)),
    "Payment Status": s.status ? s.status.toUpperCase() : 'PAID',
    "Payment Method": s.payment_method || 'Cash',
    "Checkout Date": getExcelDecimalDate(s.created_at || s.date)
  }));
  const wsSales = XLSX.utils.json_to_sheet(structuredSales);
  setColWidths(wsSales, structuredSales);
  applyTableStyles(wsSales, "065F46");

  // 4. Cheque Registry Sheet
  const structuredCheques = cheques.map((c: any) => ({
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
  const wsCheques = XLSX.utils.json_to_sheet(structuredCheques);
  setColWidths(wsCheques, structuredCheques);
  applyTableStyles(wsCheques, "B45309");

  // 5. Purchase Returns Sheet
  const structuredPurchaseReturns = purchaseReturns.map((pr: any) => {
    const prItems = purchaseReturnItems.filter((item: any) => item.purchase_return_id === pr.id);
    const itemsCount = prItems.length > 0 ? prItems.length : (Number(pr.items_count) || 0);

    return {
      "Date": pr.return_date || (pr.created_at ? String(pr.created_at).slice(0, 10) : '---'),
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
  const wsPurchaseReturns = XLSX.utils.json_to_sheet(structuredPurchaseReturns);
  setColWidths(wsPurchaseReturns, structuredPurchaseReturns);
  applyTableStyles(wsPurchaseReturns, "831843");

  // 6. Transactions (Accounting Ledger)
  const structuredTransactions = transactions.map((t: any) => ({
    "Date": getExcelDecimalDate(t.date || t.created_at),
    "Flow Type": t.type ? t.type.toUpperCase() : 'INCOME',
    "Category": t.category || 'Other',
    "Description": t.description || '',
    "Reference": t.reference || '---',
    "Amount (Rs.)": Number(t.amount || 0)
  }));
  const wsTransactions = XLSX.utils.json_to_sheet(structuredTransactions);
  setColWidths(wsTransactions, structuredTransactions);
  applyTableStyles(wsTransactions, "1E3A8A");

  // 7. Customers
  const structuredCustomers = customers.map((c: any) => ({
    "Customer Name": c.name,
    "Email": c.email || '',
    "Phone Number": c.phone || '—',
    "Address": c.address || '—',
    "NIC Number": c.nic || '—',
    "Loyalty Points": Number(c.loyalty_points || 0),
    "Total Purchases (Rs.)": Number(c.total_purchases || 0)
  }));
  const wsCustomers = XLSX.utils.json_to_sheet(structuredCustomers);
  setColWidths(wsCustomers, structuredCustomers);
  applyTableStyles(wsCustomers, "0D9488");

  // 8. Suppliers
  const structuredSuppliers = suppliers.map((sup: any) => ({
    "Supplier Name": sup.name,
    "Contact Person": sup.contact_person || '',
    "Email": sup.email || '',
    "Phone Number": sup.phone || '',
    "Payable Balance (Rs.)": Number(sup.payable_balance || (sup as any).payableBalance || 0)
  }));
  const wsSuppliers = XLSX.utils.json_to_sheet(structuredSuppliers);
  setColWidths(wsSuppliers, structuredSuppliers);
  applyTableStyles(wsSuppliers, "4C1D95");

  // 9. Purchase Orders
  const structuredPO = purchaseOrders.map((po: any) => ({
    "PO Number": po.po_number || po.id,
    "Supplier Name": po.supplier_name || 'N/A',
    "Total Amount (Rs.)": Number(po.total || po.total_amount || 0),
    "Status": po.status ? po.status.toUpperCase() : 'COMPLETED',
    "Order Date": getExcelDecimalDate(po.created_at)
  }));
  const wsPO = XLSX.utils.json_to_sheet(structuredPO);
  setColWidths(wsPO, structuredPO);
  applyTableStyles(wsPO, "4338CA");

  // Append all sheets to workbook
  XLSX.utils.book_append_sheet(wb, wsOverview, "Dashboard");
  XLSX.utils.book_append_sheet(wb, wsInventory, "Inventory Stock");
  XLSX.utils.book_append_sheet(wb, wsSales, "Sales & Invoices");
  XLSX.utils.book_append_sheet(wb, wsCheques, "Cheque Registry");
  XLSX.utils.book_append_sheet(wb, wsPurchaseReturns, "Purchase Returns");
  XLSX.utils.book_append_sheet(wb, wsTransactions, "Accounting Ledger");
  XLSX.utils.book_append_sheet(wb, wsCustomers, "Customers");
  XLSX.utils.book_append_sheet(wb, wsSuppliers, "Suppliers Directory");
  XLSX.utils.book_append_sheet(wb, wsPO, "Purchase Orders");

  const dateTag = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `${fileNamePrefix}_${dateTag}.xlsx`);
}
