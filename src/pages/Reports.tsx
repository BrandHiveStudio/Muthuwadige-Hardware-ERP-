import React, { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend
} from 'recharts';
import {
  DownloadIcon,
  TrendingUpIcon,
  PackageIcon,
  DollarSignIcon,
  FileTextIcon,
  FileSpreadsheetIcon,
  CalendarIcon,
  CoinsIcon,
  BarChart3Icon,
  UsersIcon,
  WalletIcon,
  CreditCardIcon,
  ArrowUpRightIcon,
  ArrowDownRightIcon,
  ActivityIcon,
  PercentIcon,
  TrendingDownIcon
} from 'lucide-react';
import XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../lib/supabaseClient';
import { useCurrency } from '../context/CurrencyContext';
const isDecimalUnit = (unit: string | undefined): boolean => {
  if (!unit) return false;
  const PREDEFINED_UNITS = ['pcs', 'kg', 'g', 'liters', 'ml', 'meters', 'boxes', 'packets', 'rolls', 'bundles'];
  const decimals = ['kg', 'g', 'liters', 'ml', 'meters'];
  const name = unit.toLowerCase().trim();
  return decimals.includes(name) || !PREDEFINED_UNITS.includes(name);
};

const getLocalDateString = (d: Date = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const safeGetDateString = (dateVal: any): string => {
  if (!dateVal) return '';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) {
      if (typeof dateVal === 'string') {
        const cleaned = dateVal.trim();
        if (cleaned.match(/^\d{4}-\d{2}-\d{2}/)) {
          return cleaned.substring(0, 10);
        }
      }
      return '';
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (e) {
    if (typeof dateVal === 'string') {
      return dateVal.substring(0, 10);
    }
    return '';
  }
};

const getItemUnitCost = (product: any, itemUnit?: string, itemConvRate?: number): number => {
  if (!product) return 0;
  const baseCost = Number(product.cost_price !== undefined ? product.cost_price : product.costPrice !== undefined ? product.costPrice : 0);
  let conversionRate = Number(itemConvRate) || 1;

  if ((!itemConvRate || conversionRate === 1) && itemUnit && (product.unit && itemUnit.toLowerCase() !== product.unit.toLowerCase())) {
    const measureDetailsStr = product.measure_details || product.measureDetails;
    if (measureDetailsStr) {
      try {
        const parsed = typeof measureDetailsStr === 'string' ? JSON.parse(measureDetailsStr) : measureDetailsStr;
        if (parsed && Array.isArray(parsed.conversions)) {
          const matchedConv = parsed.conversions.find((c: any) => (c.unit || '').toLowerCase() === itemUnit.toLowerCase());
          if (matchedConv) {
            const rawVal = Number(matchedConv.kgVal) || 1;
            if ((product.unit || '').toLowerCase() === 'cube' && rawVal > 0 && rawVal < 1) {
              conversionRate = 1 / rawVal;
            } else {
              conversionRate = rawVal;
            }
          }
        }
      } catch (e) {}
    }
  }

  return conversionRate > 0 ? baseCost / conversionRate : baseCost;
};

type Tab = 'sales' | 'inventory' | 'financial';
export function Reports() {
  const { currency } = useCurrency();
  const [isSinhala, setIsSinhala] = useState(false);
  const t = (en: string, si: string) => isSinhala ? si : en;

  const symbol = currency === 'USD' ? '$' : (isSinhala ? 'රු.' : 'Rs.');

  const formatCurrency = (amount: number, forceSign: boolean = false) => {
    const formatted = Math.abs(amount).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    if (amount < 0) {
      return `-${symbol} ${formatted}`;
    }
    return forceSign ? `+${symbol} ${formatted}` : `${symbol} ${formatted}`;
  };

  const [tab, setTab] = useState<Tab>('sales');
  const [sales, setSales] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [shopName, setShopName] = useState('MUTHUWADIGE HARDWARE');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  const fetchData = async () => {
    const { data: sData } = await supabase.from('sales').select('*');
    const { data: pData } = await supabase.from('products').select('*');
    const { data: tData } = await supabase.from('transactions').select('*');
    const { data: cData } = await supabase.from('customers').select('*');
    const { data: supData } = await supabase.from('suppliers').select('*');
    if (sData) setSales(sData);
    if (pData) setProducts(pData);
    if (tData) setTransactions(tData);
    if (cData) setCustomers(cData);
    if (supData) setSuppliers(supData);
  };

  const fetchSettings = async () => {
    try {
      const { data } = await supabase.from('system_settings').select('*').single();
      if (data && data.shop_name) {
        setShopName(data.shop_name);
      }
    } catch (e) {
      console.error('Failed to load shop settings:', e);
    }
  };

  useEffect(() => {
    fetchData();
    fetchSettings();
    window.addEventListener('settings-updated', fetchSettings);
    return () => window.removeEventListener('settings-updated', fetchSettings);
  }, []);

  // --- RANGE PRESETS EVALUATION ---
  const [rangeType, setRangeType] = useState<'custom' | 'day' | 'month'>('custom');
  const [selectedDay, setSelectedDay] = useState(getLocalDateString());
  const [selectedMonth, setSelectedMonth] = useState(getLocalDateString().slice(0, 7));

  const effectiveFromDate = rangeType === 'day' 
    ? selectedDay 
    : rangeType === 'month' 
      ? `${selectedMonth}-01` 
      : fromDate;

  const effectiveToDate = rangeType === 'day' 
    ? selectedDay 
    : rangeType === 'month' 
      ? `${selectedMonth}-31` 
      : toDate;

  // --- FILTERED DATA SETS ---
  const filteredSales = sales.filter(s => {
    const sDate = safeGetDateString(s.created_at || s.date);
    if (effectiveFromDate && sDate < effectiveFromDate) return false;
    if (effectiveToDate && sDate > effectiveToDate) return false;
    return true;
  });

  const filteredTransactions = transactions.filter(t => {
    const tDate = safeGetDateString(t.date);
    if (effectiveFromDate && tDate < effectiveFromDate) return false;
    if (effectiveToDate && tDate > effectiveToDate) return false;
    return true;
  });

  // --- SALES CALCULATIONS ---
  const totalSalesRevenue = filteredSales.filter(o => o.status?.toLowerCase() === 'paid').reduce((sum, o) => sum + Number(o.total_amount || o.total || 0), 0);
  const paidOrders = filteredSales.filter(o => o.status?.toLowerCase() === 'paid').length;

  // Daily Sales logic to ensure data maps to chart
  const dailySalesData = filteredSales.reduce((acc: any[], sale) => {
    const day = new Date(sale.created_at || sale.date).toLocaleDateString('en-US', { weekday: 'short' });
    const dayLabel = isSinhala ? (
      day === 'Sun' ? 'ඉරිදා' :
      day === 'Mon' ? 'සඳුදා' :
      day === 'Tue' ? 'අඟහ' :
      day === 'Wed' ? 'බදාදා' :
      day === 'Thu' ? 'බ්‍රහස්' :
      day === 'Fri' ? 'සිකු' : 'සෙන'
    ) : day;

    const existing = acc.find(d => d.day === dayLabel);
    if (existing) {
      existing.sales += Number(sale.total_amount || sale.total || 0);
    } else {
      acc.push({ day: dayLabel, sales: Number(sale.total_amount || sale.total || 0) });
    }
    return acc;
  }, []).sort((a, b) => {
    const days = isSinhala 
      ? ['ඉරිදා', 'සඳුදා', 'අඟහ', 'බදාදා', 'බ්‍රහස්', 'සිකුරාදා', 'සෙනසුරාදා']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days.indexOf(a.day) - days.indexOf(b.day);
  });

  const topSellingProducts = filteredSales.reduce((acc: any[], sale) => {
    let items: any[] = [];
    try {
      items = typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items || [];
    } catch(e) {}
    
    if (Array.isArray(items)) {
      items.forEach((item: any) => {
        const existing = acc.find(p => p.name === item.productName);
        if (existing) {
          existing.sold += Number(item.qty || 0);
          existing.revenue += Number(item.total || (item.price * item.qty) || 0);
        } else {
          acc.push({ name: item.productName || 'Item', sold: Number(item.qty || 0), revenue: Number(item.total || (item.price * item.qty) || 0) });
        }
      });
    }
    return acc;
  }, []).sort((a, b) => b.sold - a.sold).slice(0, 5);

  // Velocity calculations for all inventory items
  const inventoryVelocity = products.map(prod => {
    let unitsSold = 0;
    filteredSales.forEach(sale => {
      let items: any[] = [];
      try {
        items = typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items || [];
      } catch(e) {}
      if (Array.isArray(items)) {
        items.forEach(it => {
          if (it.productId === prod.id) {
            unitsSold += Number(it.qty || 0);
          }
        });
      }
    });
    return {
      name: prod.name,
      sku: prod.sku,
      category: prod.category,
      stock: prod.stock,
      sold: unitsSold
    };
  });

  const fastMovingProducts = [...inventoryVelocity].sort((a, b) => b.sold - a.sold).slice(0, 5);
  const slowMovingProducts = [...inventoryVelocity].sort((a, b) => a.sold - b.sold).slice(0, 5);

  // --- INVENTORY CALCULATIONS ---
  const lowStockItems = products.filter(p => {
    const minStk = p.minStock !== undefined ? p.minStock : p.min_stock !== undefined ? p.min_stock : 5;
    return p.stock < minStk;
  });
  const totalStockValue = products.reduce((sum, p) => {
    const cost = Number(p.cost_price !== undefined ? p.cost_price : p.costPrice !== undefined ? p.costPrice : 0);
    return sum + (p.stock * cost);
  }, 0);
  const totalCategories = [...new Set(products.map(p => p.category))].length;

  const getCategoryTranslation = (cat: string) => {
    switch (cat?.toLowerCase()) {
      case 'salaries': return t('Salaries', 'වැටුප්');
      case 'purchases': return t('Purchases', 'මිලදී ගැනීම්');
      case 'rent': return t('Rent', 'කුලී');
      case 'utilities': return t('Utilities', 'උපයෝගිතා');
      case 'marketing': return t('Marketing', 'අලෙවිකරණය');
      case 'maintenance': return t('Maintenance', 'නඩත්තු කටයුතු');
      case 'sales': return t('Sales', 'විකුණුම්');
      case 'inventory': return t('Inventory', 'ගබඩාව');
      case 'other': return t('Other', 'වෙනත්');
      default: return cat;
    }
  };

  const categoryBreakdownData = products.reduce((acc: any[], p) => {
    const existing = acc.find(c => c.name === p.category);
    if (existing) existing.count += 1;
    else acc.push({ name: p.category || 'Uncategorized', count: 1 });
    return acc;
  }, []).map((c, i) => ({
    ...c,
    displayName: getCategoryTranslation(c.name),
    value: products.length > 0 ? Math.round((c.count / products.length) * 100) : 0,
    color: ['#DAA520', '#464646', '#B8860B', '#808080', '#EEDC82'][i % 5]
  }));

  // --- FINANCIAL CALCULATIONS ---
  const getLast6MonthsReports = () => {
    const months: any[] = [];
    const today = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      months.push({
        year: d.getFullYear(),
        monthIndex: d.getMonth(),
        month: isSinhala
          ? d.toLocaleString('si-LK', { month: 'short' })
          : d.toLocaleString('en-US', { month: 'short' }),
        revenue: 0,
        expenses: 0
      });
    }
    return months;
  };

  const financialChartData = getLast6MonthsReports();
  filteredTransactions.forEach((trans) => {
    const tDate = new Date(trans.date);
    const tYear = tDate.getFullYear();
    const tMonth = tDate.getMonth();
    const match = financialChartData.find(m => m.year === tYear && m.monthIndex === tMonth);
    if (match) {
      const amount = Number(trans.amount || 0);
      if (trans.type === 'income') {
        match.revenue += amount;
      } else if (trans.type === 'expense') {
        match.expenses += amount;
      }
    }
  });

  const totalIncome = filteredTransactions.filter(t => t.type?.toLowerCase() === 'income').reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const totalExpenses = filteredTransactions.filter(t => t.type?.toLowerCase() === 'expense').reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const totalSalesProfit = (() => {
    let totalRevenue = 0;
    let totalItemCost = 0;
    
    filteredSales.forEach(o => {
      const statusLower = (o.status || '').toLowerCase();
      if (statusLower !== 'cancelled') {
        totalRevenue += Number(o.total_amount || o.total || 0);
        
        let items: any[] = [];
        try {
          items = typeof o.items === 'string' ? JSON.parse(o.items) : o.items || [];
        } catch(e) {}
        
        if (Array.isArray(items)) {
          items.forEach(it => {
            const product = products.find(p => p.id === it.productId);
            const cost = getItemUnitCost(product, it.unit, it.conversionRate);
            const qty = Number(it.qty || 0);
            totalItemCost += qty * cost;
          });
        }
      }
    });
    
    return totalRevenue - totalItemCost;
  })();

  const totalReceivables = filteredSales.filter(s => s.status === 'Non Paid' || s.status === 'pending' || s.status === 'Non-Paid').reduce((sum, s) => sum + Number(s.total_amount || s.total || 0), 0);
  const totalPayables = suppliers.reduce((sum, s) => sum + Number(s.payable_balance || 0), 0);

  // Cashier Closing Shift Report (Daily breakdowns)
  const todaySales = filteredSales.filter(s => {
    if (!fromDate && !toDate && rangeType === 'custom') {
      const todayStr = getLocalDateString();
      const saleDate = safeGetDateString(s.created_at || s.date);
      return saleDate === todayStr && s.status !== 'cancelled';
    }
    return s.status !== 'cancelled';
  });

  const salesByPaymentMethod = todaySales.reduce((acc, s) => {
    const method = s.payment_method || s.paymentMethod || 'Cash';
    const amt = Number(s.total_amount || s.total || 0);
    acc[method] = (acc[method] || 0) + amt;
    return acc;
  }, {} as Record<string, number>);

  const todayCash = salesByPaymentMethod['Cash'] || 0;
  const todayCard = salesByPaymentMethod['Card'] || 0;
  const todayCredit = salesByPaymentMethod['Credit'] || 0;
  const todayBank = salesByPaymentMethod['Bank Transfer'] || 0;

  const cashierSummary = todaySales.reduce((acc, s) => {
    const cashierName = s.cashier || s.user_email || 'System / Cashier';
    const amt = Number(s.total_amount || s.total || 0);
    if (acc[cashierName]) {
      acc[cashierName].amount += amt;
      acc[cashierName].count += 1;
    } else {
      acc[cashierName] = { amount: amt, count: 1 };
    }
    return acc;
  }, {} as Record<string, { amount: number; count: number }>);

  const cashierSummaryArray = Object.keys(cashierSummary).map(name => ({
    name,
    amount: cashierSummary[name].amount,
    count: cashierSummary[name].count
  }));

  const categoryMargins = products.reduce((acc: any[], prod) => {
    const cat = prod.category || 'Other';
    const price = Number(prod.price || 0);
    const cost = Number(prod.cost_price !== undefined ? prod.cost_price : prod.costPrice !== undefined ? prod.costPrice : 0);
    const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
    const existing = acc.find(item => item.name === cat);
    if (existing) { existing.totalMargin += margin; existing.count += 1; }
    else { acc.push({ name: cat, totalMargin: margin, count: 1 }); }
    return acc;
  }, []).map((item, index) => ({
    name: item.name,
    displayName: getCategoryTranslation(item.name),
    margin: Math.round(item.totalMargin / item.count),
    color: ['bg-[#DAA520]', 'bg-[#464646]', 'bg-[#B8860B]', 'bg-[#808080]', 'bg-[#EEDC82]'][index % 5]
  }));

  // --- HANDLERS ---
  const handleExportExcel = () => {
    const rawData = tab === 'sales' ? filteredSales : tab === 'inventory' ? products : filteredTransactions;
    let mappedData: any[] = [];

    if (tab === 'sales') {
      mappedData = rawData.map(s => {
        let items: any[] = [];
        try {
          items = typeof s.items === 'string' ? JSON.parse(s.items) : s.items || [];
        } catch(e) {}
        
        let saleProfit = 0;
        if (Array.isArray(items)) {
          saleProfit = items.reduce((sum, it) => {
            const product = products.find(p => p.id === it.productId);
            const cost = getItemUnitCost(product, it.unit, it.conversionRate);
            const price = Number(it.price || 0);
            const qty = Number(it.qty || 0);
            return sum + (qty * (price - cost));
          }, 0);
        }
        
        return {
          [t("Invoice Number", "ඉන්වොයිස් අංකය")]: s.invoice_no,
          [t("Customer Name", "පාරිභෝගිකයා")]: s.customerName || s.customer_name || 'Guest',
          [t("Amount", "මුදල")]: s.total_amount || s.total,
          [t("Net Profit", "ශුද්ධ ලාභය")]: saleProfit,
          [t("Status", "තත්ත්වය")]: s.status,
          [t("Date", "දිනය")]: safeGetDateString(s.created_at || s.date)
        };
      });
    } else if (tab === 'inventory') {
      mappedData = rawData.map(p => ({
        [t("Item Name", "භාණ්ඩය")]: p.name,
        [t("SKU", "SKU අංකය")]: p.sku,
        [t("Category", "ප්‍රභේදය")]: getCategoryTranslation(p.category),
        [t("Price", "මිල")]: p.price,
        [t("Cost Price", "ගැනුම් මිල")]: p.cost_price || p.costPrice,
        [t("Stock", "තොගය")]: p.stock
      }));
    } else {
      mappedData = rawData.map(tData => ({
        [t("Date", "දිනය")]: tData.date,
        [t("Type", "වර්ගය")]: tData.type === 'income' ? t('Income', 'ආදායම') : t('Expense', 'වියදම'),
        [t("Category", "ප්‍රභේදය")]: getCategoryTranslation(tData.category),
        [t("Description", "විස්තරය")]: tData.description,
        [t("Amount", "මුදල")]: tData.amount
      }));
    }

    const ws = XLSX.utils.json_to_sheet(mappedData);
    
    // Auto-fit column widths
    if (mappedData.length > 0) {
      const keys = Object.keys(mappedData[0]);
      ws['!cols'] = keys.map(key => {
        let maxLen = key.toString().length;
        mappedData.forEach(row => {
          const val = row[key];
          if (val !== null && val !== undefined) {
            const valLen = val.toString().length;
            if (valLen > maxLen) maxLen = valLen;
          }
        });
        return { wch: Math.min(Math.max(maxLen + 4, 12), 40) };
      });

      // Apply gorgeous table formatting (Theme Color Gold: DAA520)
      const ref = ws['!ref'];
      if (ref) {
        const range = XLSX.utils.decode_range(ref);
        const themeColor = "DAA520";
        
        // 1. Style Header Row (Row 0)
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

        // 2. Style Data Rows
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
              } else if (cell.v && (cell.v.toString().startsWith('INV-') || cell.v.toString().startsWith('PO-') || cell.v.toString().startsWith('t_') || cell.v.toString().match(/^\d{4}-\d{2}-\d{2}$/))) {
                alignment = "center";
              }
              
              const isMono = cell.v && (cell.v.toString().startsWith('INV-') || cell.v.toString().startsWith('PO-') || cell.v.toString().startsWith('t_'));
              
              cell.s = {
                font: {
                  name: isMono ? "Courier New" : "Segoe UI",
                  sz: 10,
                  bold: isMono,
                  color: { rgb: "334155" }
                },
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
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t("Report_Data", "වාර්තා_දත්ත"));
    XLSX.writeFile(wb, `${shopName.replace(/\s+/g, '_')}_Report_${tab}_${getLocalDateString()}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.setTextColor(218, 165, 32);
    
    const titleText = `${shopName} - ` + (
      tab === 'sales' ? t("SALES REPORT", "විකුණුම් වාර්තාව") :
      tab === 'inventory' ? t("INVENTORY REPORT", "තොග වාර්තාව") : t("FINANCIAL REPORT", "මූල්‍ය වාර්තාව")
    );
    doc.text(titleText, 14, 20);
    
    doc.setFontSize(8.5);
    doc.setTextColor(100, 100, 100);
    doc.text(t(`Generated on: ${new Date().toLocaleString()}`, `වාර්තාව සාදන ලද්දේ: ${new Date().toLocaleString()}`), 14, 27);

    const body = tab === 'sales' 
      ? filteredSales.map(s => {
          let items: any[] = [];
          try {
            items = typeof s.items === 'string' ? JSON.parse(s.items) : s.items || [];
          } catch(e) {}
          
          let saleProfit = 0;
          if (Array.isArray(items)) {
            doc.setTextColor(80, 80, 80);
            saleProfit = items.reduce((sum, it) => {
              const product = products.find(p => p.id === it.productId);
              const cost = getItemUnitCost(product, it.unit, it.conversionRate);
              const price = Number(it.price || 0);
              const qty = Number(it.qty || 0);
              return sum + (qty * (price - cost));
            }, 0);
          }
          return [
            s.invoice_no || 'N/A', 
            safeGetDateString(s.created_at || s.date), 
            s.customerName || s.customer_name || 'Guest', 
            formatCurrency(Number(s.total_amount || s.total)),
            formatCurrency(saleProfit)
          ];
        })
      : tab === 'inventory'
      ? products.map(p => [
          p.name, 
          getCategoryTranslation(p.category), 
          p.stock, 
          formatCurrency(Number(p.price))
        ])
      : filteredTransactions.map(tData => [
          tData.date || '',
          tData.type === 'income' ? t('Income', 'ආදායම') : t('Expense', 'වියදම'),
          getCategoryTranslation(tData.category),
          tData.description || '',
          formatCurrency(Number(tData.amount || 0))
        ]);

    const head = tab === 'sales' 
      ? [[t('Invoice', 'ඉන්වොයිසිය'), t('Date', 'දිනය'), t('Customer', 'පාරිභෝගිකයා'), t('Total', 'මුළු මුදල'), t('Net Profit', 'ශුද්ධ ලාභය')]] 
      : tab === 'inventory'
      ? [[t('Product', 'භාණ්ඩය'), t('Category', 'ප්‍රභේදය'), t('Stock', 'තොගය'), t('Price', 'මිල')]]
      : [[t('Date', 'දිනය'), t('Type', 'වර්ගය'), t('Category', 'ප්‍රභේදය'), t('Description', 'විස්තරය'), t('Amount', 'මුදල')]];

    autoTable(doc, {
      startY: 32,
      head: head,
      body: body,
      theme: 'grid',
      headStyles: { fillColor: [218, 165, 32] },
      styles: { fontSize: 8 }
    });

    doc.save(`${shopName.replace(/\s+/g, '_')}_Report_${tab}_${getLocalDateString()}.pdf`);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 text-left">
      
      {/* Tab Navigation & Language Switcher Header wrapper */}
      <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center bg-gradient-to-r from-slate-900 via-slate-800 to-slate-950 p-4 rounded-3xl shadow-xl border border-slate-800 gap-4 mb-4">
        <div className="flex gap-2 p-1 bg-slate-950/60 rounded-2xl border border-slate-850 overflow-x-auto max-w-full custom-scrollbar">
          {(['sales', 'inventory', 'financial'] as Tab[]).map((tValue) => {
            const isActive = tab === tValue;
            let IconComponent = BarChart3Icon;
            if (tValue === 'inventory') IconComponent = PackageIcon;
            if (tValue === 'financial') IconComponent = CoinsIcon;
            
            return (
              <button 
                key={tValue} 
                onClick={() => setTab(tValue)} 
                className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 ${
                  isActive 
                    ? 'bg-[#DAA520] text-white shadow-lg shadow-[#DAA520]/20 scale-[1.02]' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <IconComponent className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                {tValue === 'sales' 
                  ? t('Sales Report', 'විකුණුම් වාර්තාව') 
                  : tValue === 'inventory' 
                  ? t('Inventory Report', 'තොග වාර්තාව') 
                  : t('Financial Report', 'මූල්‍ය වාර්තාව')}
              </button>
            );
          })}
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {/* Bilingual Language Switcher */}
          <button 
            onClick={() => setIsSinhala(!isSinhala)} 
            className="flex items-center justify-center gap-2 bg-slate-850 hover:bg-slate-700 text-slate-200 hover:text-white px-5 py-3 rounded-xl text-xs font-black transition-all uppercase tracking-widest border border-slate-700 shadow-md shrink-0"
          >
            {isSinhala ? '🇺🇸 English' : '🇱🇰 සිංහල'}
          </button>
          
          <button onClick={handleExportPDF} className="flex items-center gap-2 text-xs bg-rose-600 hover:bg-rose-700 text-white px-5 py-3 rounded-xl font-black uppercase tracking-widest transition-all duration-300 shadow-lg shadow-rose-600/15">
            <FileTextIcon className="w-4 h-4" /> PDF
          </button>
          
          <button onClick={handleExportExcel} className="flex items-center gap-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-xl font-black uppercase tracking-widest transition-all duration-300 shadow-lg shadow-emerald-600/15">
            <FileSpreadsheetIcon className="w-4 h-4" /> EXCEL
          </button>
        </div>
      </div>

      {/* Date Range & Period Filter Bar */}
      <div className="bg-white border border-slate-100 p-5 rounded-2xl shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 w-full md:w-auto">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-[#DAA520]/10 rounded-lg text-[#DAA520]">
              <CalendarIcon className="w-4 h-4" />
            </div>
            <span className="text-xs font-black uppercase tracking-widest text-slate-400">{t("Report Period:", "වාර්තා කාල සීමාව:")}</span>
          </div>
          
          <select 
            value={rangeType} 
            onChange={(e: any) => setRangeType(e.target.value)} 
            className="px-4 py-2.5 border border-slate-200 bg-white rounded-xl text-xs font-bold text-[#464646] outline-none cursor-pointer focus:border-[#DAA520] transition-colors"
          >
            <option value="custom">{t("Custom Date Range", "අභිරුචි දිනයන්")}</option>
            <option value="day">{t("Specific Day", "විශේෂිත දිනයක්")}</option>
            <option value="month">{t("Specific Month", "විශේෂිත මාසයක්")}</option>
          </select>

          {rangeType === 'custom' && (
            <div className="flex items-center gap-3">
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520] focus:border-transparent transition-all"
                placeholder="From Date"
              />
              <span className="text-slate-400 font-bold text-xs">to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520] focus:border-transparent transition-all"
                placeholder="To Date"
              />
            </div>
          )}

          {rangeType === 'day' && (
            <input
              type="date"
              value={selectedDay}
              onChange={(e) => setSelectedDay(e.target.value)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520] focus:border-transparent transition-all"
            />
          )}

          {rangeType === 'month' && (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520] focus:border-transparent transition-all"
            />
          )}
        </div>

        {/* Clear Filter button if range active */}
        {(fromDate || toDate || rangeType !== 'custom') && (
          <button
            onClick={() => {
              setFromDate('');
              setToDate('');
              setRangeType('custom');
            }}
            className="text-xs text-rose-500 hover:text-rose-700 font-black uppercase tracking-widest transition-colors flex items-center gap-1 shrink-0"
          >
            ✕ {t("Clear Period Filter", "කාල සීමාව ඉවත් කරන්න")}
          </button>
        )}
      </div>

      {tab === 'sales' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5">
            {/* Card 1: Revenue */}
            <div className="bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(16,185,129,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(16,185,129,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-emerald-100 font-extrabold uppercase tracking-widest">{t('Total Cash Collected', 'මුළු එකතු කරන ලද මුදල')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <DollarSignIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{formatCurrency(totalSalesRevenue)}</p>
            </div>

            {/* Card 2: Net Profit */}
            <div className="bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(218,165,32,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(218,165,32,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-amber-100 font-extrabold uppercase tracking-widest">{t('Total Net Profit', 'මුළු ශුද්ධ ලාභය')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <TrendingUpIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{formatCurrency(totalSalesProfit)}</p>
              <p className="text-[10px] text-amber-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('Total revenue minus item costs', 'මුළු ආදායමෙන් භාණ්ඩවල පිරිවැය අඩු කළ පසු')}
              </p>
            </div>

            {/* Card 3: Total Orders */}
            <div className="bg-gradient-to-br from-violet-500 via-violet-600 to-purple-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(139,92,246,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(139,92,246,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-violet-100 font-extrabold uppercase tracking-widest">{t('Total Orders', 'මුළු ඇණවුම්')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <FileTextIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{sales.length}</p>
              <p className="text-[10px] text-violet-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('All recorded invoices', 'සියලුම ඉන්වොයිසි සංඛ්‍යාව')}
              </p>
            </div>

            {/* Card 4: Paid Orders */}
            <div className="bg-gradient-to-br from-teal-500 via-teal-600 to-cyan-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(20,184,166,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(20,184,166,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-teal-100 font-extrabold uppercase tracking-widest">{t('Paid Orders', 'ගෙවන ලද ඇණවුම්')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <CoinsIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{paidOrders}</p>
              <p className="text-[10px] text-teal-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('Completed cash checkouts', 'සම්පූර්ණ කළ ගනුදෙනු')}
              </p>
            </div>

            {/* Card 5: Outstanding Credit */}
            <div className="bg-gradient-to-br from-rose-500 via-rose-600 to-red-650 rounded-3xl p-6 shadow-[0_12px_30px_rgba(239,68,68,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(239,68,68,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-rose-100 font-extrabold uppercase tracking-widest">{t('Outstanding Credit', 'හිඟ ණය එකතුව')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <CreditCardIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{formatCurrency(totalReceivables)}</p>
              <p className="text-[10px] text-rose-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('Outstanding receivables', 'පාරිභෝගිකයින්ගෙන් ලැබීමට ඇති හිඟ මුදල්')}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">{t('Daily Sales (This Week)', 'දෛනික විකුණුම් (මෙම සතිය)')}</h2>
                <p className="text-[10px] text-slate-400 font-bold mt-0.5">{t('Revenue trend across individual days', 'දින අනුව ආදායමේ ප්‍රවණතාවය')}</p>
              </div>
              <div className="p-2 bg-[#DAA520]/10 text-[#DAA520] rounded-xl">
                <ActivityIcon className="w-5 h-5" />
              </div>
            </div>
            
            {dailySalesData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={dailySalesData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#94a3b8', fontWeight: 'bold'}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#94a3b8', fontWeight: 'bold'}} />
                  <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{ borderRadius: '16px', border: '1px solid #f1f5f9', fontWeight: 'bold', color: '#475569', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value: number) => [formatCurrency(value), '']} />
                  <Bar dataKey="sales" name={t("Sales", "විකුණුම්")} fill="#DAA520" radius={[8, 8, 0, 0]} barSize={44} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 px-4 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                <div className="w-16 h-16 bg-[#DAA520]/10 text-[#DAA520] rounded-full flex items-center justify-center mb-4 animate-pulse">
                  <BarChart3Icon className="w-8 h-8" />
                </div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">{t("Awaiting POS Checkouts", "විකුණුම් ගනුදෙනු බලාපොරොත්තුවෙන්")}</h3>
                <p className="text-xs text-slate-400 font-bold text-center max-w-sm mt-1">{t("When customer bills are checked out at the counter, this bar chart will populate with real-time performance insights.", "පාරිභෝගික බිල්පත් ගෙවීම් අවසන් කළ විට, මෙම ප්‍රස්ථාරය දත්ත මඟින් යාවත්කාලීන වනු ඇත.")}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-100 shadow-md overflow-hidden flex flex-col">
              <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUpIcon className="w-4 h-4 text-[#DAA520]" />
                  <h2 className="text-xs font-black text-white uppercase tracking-widest">{t('Top Selling Products', 'වැඩිපුරම අලෙවි වන භාණ්ඩ')}</h2>
                </div>
                <span className="px-2.5 py-1 bg-amber-500/20 text-[#DAA520] text-[10px] font-black rounded-full border border-amber-500/30">
                  {topSellingProducts.length} {t('Items', 'භාණ්ඩ')}
                </span>
              </div>
              <div className="overflow-x-auto p-4 flex-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 uppercase text-[10px] font-black tracking-widest">
                      <th className="text-left px-4 py-3 rounded-l-lg">{t('Rank', 'ශ්‍රේණිය')}</th>
                      <th className="text-left px-4 py-3">{t('Product', 'භාණ්ඩය')}</th>
                      <th className="text-center px-4 py-3">{t('Sold', 'අලෙවි වූ ප්‍රමාණය')}</th>
                      <th className="text-right px-4 py-3 rounded-r-lg">{t('Revenue', 'ආදායම')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {topSellingProducts.map((p, i) => (
                      <tr key={i} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-50 text-[#DAA520] text-xs font-black">
                            {i+1}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-black text-slate-800">{p.name}</td>
                        <td className="px-4 py-3 text-center text-slate-600 font-bold">{p.sold}</td>
                        <td className="px-4 py-3 text-right font-black text-slate-800">{formatCurrency(p.revenue)}</td>
                      </tr>
                    ))}
                    {topSellingProducts.length === 0 && (
                      <tr>
                        <td colSpan={4} className="text-center py-8 text-slate-400 font-bold">
                          {t("No sales recorded.", "විකුණුම් කිසිවක් සටහන් වී නොමැත.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Daily Cashier Shift Summary & Payment Methods */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-md p-6 space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <CreditCardIcon className="w-4 h-4 text-[#DAA520]" />
                  <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">{t("Today's Payment Method Breakdown", "අද දින ගෙවීම් ක්‍රම විග්‍රහය")}</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-150 flex items-center justify-between">
                    <div>
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">{t("Cash", "මුදල්")}</p>
                      <p className="text-sm font-black text-slate-800 mt-0.5">{formatCurrency(todayCash)}</p>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  </div>
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-150 flex items-center justify-between">
                    <div>
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">{t("Credit Card", "ක්‍රෙඩිට් කාඩ්")}</p>
                      <p className="text-sm font-black text-slate-800 mt-0.5">{formatCurrency(todayCard)}</p>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-[#DAA520]"></span>
                  </div>
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-150 flex items-center justify-between">
                    <div>
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">{t("Credit", "ණය")}</p>
                      <p className="text-sm font-black text-slate-800 mt-0.5">{formatCurrency(todayCredit)}</p>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                  </div>
                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-150 flex items-center justify-between">
                    <div>
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">{t("Bank", "බැංකු")}</p>
                      <p className="text-sm font-black text-slate-800 mt-0.5">{formatCurrency(todayBank)}</p>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 shadow-md overflow-hidden flex flex-col">
                <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <UsersIcon className="w-4 h-4 text-[#DAA520]" />
                    <h2 className="text-xs font-black text-white uppercase tracking-widest">{t("Cashier Closing Shifts Report", "කැෂියර් මුර අවසන් කිරීමේ වාර්තාව")}</h2>
                  </div>
                  <span className="px-2.5 py-1 bg-[#DAA520]/20 text-[#DAA520] text-[10px] font-black rounded-full border border-amber-500/30">
                    {cashierSummaryArray.length} {t('Active', 'සක්‍රිය')}
                  </span>
                </div>
                <div className="overflow-x-auto p-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 uppercase text-[10px] font-black tracking-widest">
                        <th className="text-left px-4 py-3 rounded-l-lg">{t("Cashier / User", "කැෂියර් / පරිශීලකයා")}</th>
                        <th className="text-center px-4 py-3">{t("Transactions", "ගනුදෙනු ගණන")}</th>
                        <th className="text-right px-4 py-3 rounded-r-lg">{t("Total Handled", "මුළු එකතුව")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {cashierSummaryArray.map((c, i) => (
                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-3 font-black text-slate-800">{c.name}</td>
                          <td className="px-4 py-3 text-center text-slate-600 font-bold">{c.count}</td>
                          <td className="px-4 py-3 text-right font-black text-slate-800">{formatCurrency(c.amount)}</td>
                        </tr>
                      ))}
                      {cashierSummaryArray.length === 0 && (
                        <tr>
                          <td colSpan={3} className="text-center py-8 text-slate-400 font-bold">
                            {t("No transactions completed today.", "අද දින ගනුදෙනු කිසිවක් සිදු වී නොමැත.")}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'inventory' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="bg-gradient-to-br from-slate-600 via-slate-700 to-zinc-700 rounded-3xl p-6 shadow-[0_12px_30px_rgba(100,116,139,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45_rgba(100,116,139,0.35)] transition-all duration-300 relative overflow-hidden group border border-slate-600">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-slate-100 font-extrabold uppercase tracking-widest mb-1.5">{t('Total Products', 'භාණ්ඩ එකතුව')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <PackageIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{products.length}</p>
              <p className="text-[10px] text-slate-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('Unique SKUs registered', 'ලියාපදිංචි අද්විතීය SKU ගණන')}
              </p>
            </div>

            <div className="bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(218,165,32,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(218,165,32,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-amber-100 font-extrabold uppercase tracking-widest mb-1.5">{t('Stock Value', 'තොගයේ වටිනාකම')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <CoinsIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{formatCurrency(totalStockValue)}</p>
              <p className="text-[10px] text-amber-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('Total cost valuation', 'මුළු පිරිවැය තක්සේරුව')}
              </p>
            </div>

            <div className="bg-gradient-to-br from-rose-500 via-rose-600 to-red-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(239,68,68,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(239,68,68,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-rose-100 font-extrabold uppercase tracking-widest mb-1.5">{t('Low Stock Items', 'අඩු තොග අනතුරු ඇඟවීම්')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <ActivityIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{lowStockItems.length}</p>
              <p className="text-[10px] text-rose-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('Items below threshold', 'නියමිත මට්ටමට වඩා අඩු භාණ්ඩ')}
              </p>
            </div>

            <div className="bg-gradient-to-br from-indigo-500 via-indigo-600 to-blue-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(99,102,241,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(99,102,241,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-indigo-100 font-extrabold uppercase tracking-widest mb-1.5">{t('Categories', 'ප්‍රභේද')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <BarChart3Icon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{totalCategories}</p>
              <p className="text-[10px] text-indigo-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('Product departments', 'භාණ්ඩ වර්ගීකරණයන්')}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm text-left">
            <h2 className="text-xs font-black text-slate-400 mb-4 uppercase tracking-widest flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></span>
              {t('Low Stock Items Alerts', 'අඩු තොග අනතුරු ඇඟවීම්')}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
              {lowStockItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-4 bg-rose-50/20 rounded-xl border border-rose-100 hover:bg-rose-50/45 transition-colors">
                  <div>
                    <p className="text-sm font-black text-slate-850">{item.name}</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase mt-0.5">{item.sku} • {getCategoryTranslation(item.category)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-red-650">{item.stock} left</p>
                    <p className="text-[9px] text-slate-400 font-bold">Min Target: {item.min_stock || item.minStock || 5}</p>
                  </div>
                </div>
              ))}
              {lowStockItems.length === 0 && (
                <div className="col-span-full text-center py-8 text-slate-400 font-bold text-sm">
                  {t("No low stock items currently. All inventory levels are optimal!", "මේ වන විට අඩු තොග භාණ්ඩ නොමැත. සියලුම තොග මට්ටම් ප්‍රශස්තයි!")}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm text-left">
            <div className="flex items-center gap-2 mb-6">
              <BarChart3Icon className="w-4 h-4 text-[#DAA520]" />
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">{t('Category Distribution Breakdown', 'ප්‍රභේද විග්‍රහය')}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {categoryBreakdownData.map((cat, i) => (
                <div key={i} className="flex items-center justify-between gap-4 p-3 hover:bg-slate-50/50 rounded-xl transition-colors">
                  <div className="flex-1">
                    <div className="flex justify-between items-center text-xs font-black text-slate-700 mb-1.5 uppercase">
                      <span>{cat.displayName}</span>
                      <span>{cat.value}%</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                      <div className="h-full transition-all duration-700 rounded-full" style={{ width: `${cat.value}%`, backgroundColor: cat.color }} />
                    </div>
                  </div>
                  <span className="text-xs font-black text-slate-450 bg-slate-100 px-2.5 py-1.5 rounded-lg shrink-0">
                    {cat.count} {t('Items', 'භාණ්ඩ')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Fast-moving & Slow-moving side-by-side velocity tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Fast-Moving Items */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-md overflow-hidden text-left flex flex-col">
              <div className="bg-gradient-to-r from-emerald-800 to-emerald-950 px-5 py-4 flex items-center justify-between border-b border-emerald-900">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <h2 className="text-xs font-black text-white uppercase tracking-widest">
                    {t('Fast-Moving Products (High Velocity)', 'වේගයෙන් අලෙවි වන භාණ්ඩ (ඉහළ ප්‍රවේගය)')}
                  </h2>
                </div>
                <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-300 text-[10px] font-black rounded-full border border-emerald-500/30">
                  {fastMovingProducts.length} {t('Items', 'භාණ්ඩ')}
                </span>
              </div>
              <div className="overflow-x-auto p-4 flex-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 uppercase text-[10px] font-black tracking-widest">
                      <th className="text-left px-4 py-3 rounded-l-lg">{t('Product', 'භාණ්ඩය')}</th>
                      <th className="text-center px-4 py-3">{t('Stock left', 'ඉතිරි තොගය')}</th>
                      <th className="text-right px-4 py-3 rounded-r-lg">{t('Qty Sold', 'විකුණුම් ප්‍රමාණය')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fastMovingProducts.map((p, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 font-black text-slate-800">
                          {p.name}
                          <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">{p.sku} • {getCategoryTranslation(p.category)}</p>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-600 font-bold">{p.stock}</td>
                        <td className="px-4 py-3 text-right font-black text-emerald-600">+{p.sold}</td>
                      </tr>
                    ))}
                    {fastMovingProducts.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center py-8 text-slate-400 font-bold">
                          {t("No products sold yet.", "තවමත් භාණ්ඩ කිසිවක් අලෙවි වී නොමැත.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Slow-Moving Items */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-md overflow-hidden text-left flex flex-col">
              <div className="bg-gradient-to-r from-rose-800 to-rose-950 px-5 py-4 flex items-center justify-between border-b border-rose-900">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-pulse"></span>
                  <h2 className="text-xs font-black text-white uppercase tracking-widest">
                    {t('Slow-Moving Products (Low Velocity)', 'සෙමින් අලෙවි වන භාණ්ඩ (අඩු ප්‍රවේගය)')}
                  </h2>
                </div>
                <span className="px-2.5 py-1 bg-rose-500/20 text-rose-300 text-[10px] font-black rounded-full border border-rose-500/30">
                  {slowMovingProducts.length} {t('Items', 'භාණ්ඩ')}
                </span>
              </div>
              <div className="overflow-x-auto p-4 flex-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 uppercase text-[10px] font-black tracking-widest">
                      <th className="text-left px-4 py-3 rounded-l-lg">{t('Product', 'භාණ්ඩය')}</th>
                      <th className="text-center px-4 py-3">{t('Stock left', 'ඉතිරි තොගය')}</th>
                      <th className="text-right px-4 py-3 rounded-r-lg">{t('Qty Sold', 'විකුණුම් ප්‍රමාණය')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {slowMovingProducts.map((p, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 font-black text-slate-800">
                          {p.name}
                          <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">{p.sku} • {getCategoryTranslation(p.category)}</p>
                        </td>
                        <td className="px-4 py-3 text-center text-slate-600 font-bold">{p.stock}</td>
                        <td className="px-4 py-3 text-right font-black text-slate-500">{p.sold}</td>
                      </tr>
                    ))}
                    {slowMovingProducts.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center py-8 text-slate-400 font-bold">
                          {t("No products found.", "භාණ්ඩ කිසිවක් හමු නොවීය.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'financial' && (
        <div className="space-y-6 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(16,185,129,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(16,185,129,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-emerald-100 font-extrabold uppercase tracking-widest mb-1.5">{t('Total Income', 'මුළු ආදායම')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <ArrowUpRightIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{formatCurrency(totalIncome)}</p>
              <p className="text-[10px] text-emerald-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('All positive transactions', 'සියලුම ලැබීම් එකතුව')}
              </p>
            </div>

            <div className="bg-gradient-to-br from-rose-500 via-rose-600 to-red-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(239,68,68,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(239,68,68,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-rose-100 font-extrabold uppercase tracking-widest mb-1.5">{t('Total Expenses', 'මුළු වියදම්')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <ArrowDownRightIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{formatCurrency(totalExpenses)}</p>
              <p className="text-[10px] text-rose-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('All cash outflows & costs', 'සියලුම ගෙවීම් සහ වියදම්')}
              </p>
            </div>

            <div className="bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(218,165,32,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(218,165,32,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-amber-100 font-extrabold uppercase tracking-widest mb-1.5">{t('Total Net Profit', 'මුළු ශුද්ධ ලාභය')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <TrendingUpIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{formatCurrency(totalSalesProfit)}</p>
              <p className="text-[10px] text-amber-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('Total revenue minus item costs', 'මුළු ආදායමෙන් භාණ්ඩවල පිරිවැය අඩු කළ පසු')}
              </p>
            </div>

            <div className="bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(99,102,241,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(99,102,241,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-indigo-100 font-extrabold uppercase tracking-widest mb-1.5">{t('Net Cash Flow', 'ශුද්ධ මුදල් ප්‍රවාහය')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <ActivityIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{formatCurrency(totalIncome - totalExpenses)}</p>
              <p className="text-[10px] text-indigo-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('Inflow minus outflow position', 'ලැබීම් සහ ගෙවීම් අතර වෙනස')}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm text-left">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">{t('Revenue vs Expenses (6 Months)', 'ආදායම සහ වියදම (මාස 6)')}</h2>
                <p className="text-[10px] text-slate-400 font-bold mt-0.5">{t('Financial breakdown compared monthly', 'මාසිකව සංසන්දනය කළ මූල්‍ය දත්ත')}</p>
              </div>
              <div className="p-2 bg-[#DAA520]/10 text-[#DAA520] rounded-xl">
                <BarChart3Icon className="w-5 h-5" />
              </div>
            </div>
            
            {financialChartData.some(d => d.revenue > 0 || d.expenses > 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={financialChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11, fontWeight: 'bold'}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11, fontWeight: 'bold'}} />
                  <Tooltip contentStyle={{ borderRadius: '16px', border: '1px solid #f1f5f9', fontWeight: 'bold', color: '#475569', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} formatter={(value: number) => [formatCurrency(value), '']} />
                  <Legend verticalAlign="bottom" align="center" wrapperStyle={{ fontWeight: 'bold', fontSize: '11px', paddingTop: '10px' }} />
                  <Line type="monotone" dataKey="revenue" name={t("Revenue", "ආදායම")} stroke="#DAA520" strokeWidth={4} dot={{ r: 4, fill: '#DAA520', strokeWidth: 2 }} activeDot={{ r: 7 }} />
                  <Line type="monotone" dataKey="expenses" name={t("Expenses", "වියදම්")} stroke="#464646" strokeWidth={4} dot={{ r: 4, fill: '#464646', strokeWidth: 2 }} activeDot={{ r: 7 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 px-4 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                <div className="w-16 h-16 bg-[#DAA520]/10 text-[#DAA520] rounded-full flex items-center justify-center mb-4">
                  <ActivityIcon className="w-8 h-8" />
                </div>
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider">{t("No Financial Data Found", "මූල්‍ය දත්ත කිසිවක් හමු නොවීය")}</h3>
                <p className="text-xs text-slate-400 font-bold text-center max-w-sm mt-1">{t("When income and expense transactions are logged in the database, this trend graph will analyze monthly cash flows.", "ආදායම් සහ වියදම් ගනුදෙනු ලියාපදිංචි කළ පසු, මෙම ප්‍රස්ථාරය මාසික මුදල් ප්‍රවාහයන් විශ්ලේෂණය කරනු ඇත.")}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Profit Margin by Category */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm text-left flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <PercentIcon className="w-4 h-4 text-[#DAA520]" />
                  <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">{t('Profit Margin by Category', 'ප්‍රභේද අනුව ලාභ ප්‍රතිශතය')}</h2>
                </div>
                <div className="space-y-5">
                  {categoryMargins.map((item, idx) => (
                    <div key={idx} className="space-y-2">
                      <div className="flex justify-between items-center text-xs font-black uppercase text-slate-600">
                        <span>{item.displayName}</span>
                        <span className="text-emerald-600 font-bold">{item.margin}%</span>
                      </div>
                      <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                        <div className={`h-full transition-all duration-700 rounded-full ${item.color}`} style={{ width: `${item.margin}%` }} />
                      </div>
                    </div>
                  ))}
                  {categoryMargins.length === 0 && (
                    <p className="text-center py-6 text-slate-400 font-bold text-sm">
                      {t("No category data found.", "ප්‍රභේද දත්ත කිසිවක් හමු නොවීය.")}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Receivables vs Payables */}
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm text-left space-y-6">
              <div className="flex items-center gap-2">
                <WalletIcon className="w-4 h-4 text-[#DAA520]" />
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  {t('Outstanding Balance Ledger Position', 'හිඟ ශේෂ ලෙජර පිහිටීම')}
                </h2>
              </div>
              <div className="space-y-4">
                {/* Receivables row */}
                <div className="flex justify-between items-center p-4 bg-emerald-50/40 rounded-xl border border-emerald-100">
                  <div>
                    <p className="text-xs font-black text-emerald-800 uppercase tracking-wider">{t("Total Receivables (From Customers)", "එකතු විය යුතු මුදල් (පාරිභෝගිකයින්ගෙන්)")}</p>
                    <p className="text-[10px] font-bold text-emerald-600 mt-0.5">{t("Outstanding credit invoices to collect", "එකතු කිරීමට ඇති මුළු නොගෙවූ ඉන්වොයිසි")}</p>
                  </div>
                  <p className="text-xl font-black text-emerald-700">{formatCurrency(totalReceivables)}</p>
                </div>

                {/* Payables row */}
                <div className="flex justify-between items-center p-4 bg-rose-50/25 rounded-xl border border-rose-100">
                  <div>
                    <p className="text-xs font-black text-rose-800 uppercase tracking-wider">{t("Total Payables (To Suppliers)", "ගෙවිය යුතු මුදල් (සැපයුම්කරුවන්ට)")}</p>
                    <p className="text-[10px] font-bold text-rose-600 mt-0.5">{t("Outstanding payable balance on supplier credit", "සැපයුම්කරුවන්ට ගෙවීමට ඇති හිඟ මුදල් ප්‍රමාණය")}</p>
                  </div>
                  <p className="text-xl font-black text-rose-700">{formatCurrency(totalPayables)}</p>
                </div>

                {/* Net balance position */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex justify-between items-center">
                  <div>
                    <p className="text-xs font-black text-slate-700 uppercase tracking-wider">{t("Net Ledger Balance Position", "ශුද්ධ ලෙජර ශේෂය")}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-0.5">{t("Receivables minus Payables balance", "ලැබිය යුතු මුදල්වලින් ගෙවිය යුතු මුදල් අඩු කළ පසු")}</p>
                  </div>
                  <p className={`text-xl font-black ${totalReceivables >= totalPayables ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {totalReceivables >= totalPayables ? '+' : ''}{formatCurrency(totalReceivables - totalPayables)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
