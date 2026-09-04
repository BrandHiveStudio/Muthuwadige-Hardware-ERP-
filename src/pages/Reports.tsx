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
import {
  toSriLankaDateStr,
  getTodaySriLankaDate,
  getCurrentSriLankaMonth,
  isWithinDateRange,
  computeFinancialSummary,
  computePaymentBreakdown,
  calculateSaleAccounting,
  isCreditSaleRecord,
  getItemUnitCost,
  getReturnSellingSubtotal
} from '../utils/accounting';
import { useCurrency } from '../context/CurrencyContext';
import { formatStock } from '../utils/formatters';
import { getCachedData, setCachedData } from '../services/dataCache';

const isDecimalUnit = (unit: string | undefined): boolean => {
  if (!unit) return false;
  const PREDEFINED_UNITS = ['pcs', 'kg', 'g', 'liters', 'ml', 'meters', 'boxes', 'packets', 'rolls', 'bundles'];
  const decimals = ['kg', 'g', 'liters', 'ml', 'meters'];
  const name = unit.toLowerCase().trim();
  return decimals.includes(name) || !PREDEFINED_UNITS.includes(name);
};

const getLocalDateString = (d: Date = new Date()) => toSriLankaDateStr(d) || getTodaySriLankaDate();

const safeGetDateString = (dateVal: any): string => toSriLankaDateStr(dateVal);

type Tab = 'sales' | 'inventory' | 'financial';

interface ReportsProps {
  currentUser?: any;
}

// Module-level cache for stale-while-revalidate zero-flicker tab switching
let cachedReportsData: {
  sales?: any[];
  products?: any[];
  transactions?: any[];
  customers?: any[];
  suppliers?: any[];
  salesReturns?: any[];
  creditPayments?: any[];
  profiles?: any[];
  shopName?: string;
} | null = null;

export function Reports({ currentUser }: ReportsProps = {}) {
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
  const [sales, setSales] = useState<any[]>(() => getCachedData<any[]>('sales') || cachedReportsData?.sales || []);
  const [products, setProducts] = useState<any[]>(() => getCachedData<any[]>('products') || cachedReportsData?.products || []);
  const [transactions, setTransactions] = useState<any[]>(() => getCachedData<any[]>('transactions') || cachedReportsData?.transactions || []);
  const [customers, setCustomers] = useState<any[]>(() => getCachedData<any[]>('customers') || cachedReportsData?.customers || []);
  const [suppliers, setSuppliers] = useState<any[]>(() => getCachedData<any[]>('suppliers') || cachedReportsData?.suppliers || []);
  const [salesReturns, setSalesReturns] = useState<any[]>(() => getCachedData<any[]>('returns') || cachedReportsData?.salesReturns || []);
  const [creditPayments, setCreditPayments] = useState<any[]>(() => cachedReportsData?.creditPayments || []);
  const [profiles, setProfiles] = useState<any[]>(() => cachedReportsData?.profiles || []);
  const [shopName, setShopName] = useState(() => cachedReportsData?.shopName || 'Sanoj Hardware');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const fetchData = async () => {
    try {
      const { data: sData } = await supabase.from('sales').select('*');
      const { data: pData } = await supabase.from('products').select('*');
      const { data: tData } = await supabase.from('transactions').select('*');
      const { data: cData } = await supabase.from('customers').select('*');
      const { data: supData } = await supabase.from('suppliers').select('*');
      const { data: srData } = await supabase.from('sales_returns').select('*');
      const { data: cpData } = await supabase.from('credit_payments').select('*');
      const { data: prData } = await supabase.from('profiles').select('*');

      if (!cachedReportsData) cachedReportsData = {};

      if (sData) { setSales(sData); cachedReportsData.sales = sData; setCachedData('sales', sData); }
      if (pData) { setProducts(pData); cachedReportsData.products = pData; setCachedData('products', pData); }
      if (tData) { setTransactions(tData); cachedReportsData.transactions = tData; setCachedData('transactions', tData); }
      if (cData) { setCustomers(cData); cachedReportsData.customers = cData; setCachedData('customers', cData); }
      if (supData) { setSuppliers(supData); cachedReportsData.suppliers = supData; setCachedData('suppliers', supData); }
      if (srData) { setSalesReturns(srData); cachedReportsData.salesReturns = srData; setCachedData('returns', srData); }
      if (cpData) { setCreditPayments(cpData); cachedReportsData.creditPayments = cpData; }
      if (prData) { setProfiles(prData); cachedReportsData.profiles = prData; }
    } catch (e) {
      console.error('Failed to load reports data:', e);
    }
  };

  const fetchSettings = async () => {
    try {
      const { data } = await supabase.from('system_settings').select('*').single();
      if (data && data.shop_name) {
        setShopName(data.shop_name);
        if (!cachedReportsData) cachedReportsData = {};
        cachedReportsData.shopName = data.shop_name;
      }
    } catch (e) {
      console.error('Failed to load shop settings:', e);
    }
  };

  useEffect(() => {
    fetchData();
    fetchSettings();
    window.addEventListener('settings-updated', fetchSettings);
    window.addEventListener('refresh-reports', fetchData);
    window.addEventListener('refresh-all-data', fetchData);
    return () => {
      window.removeEventListener('settings-updated', fetchSettings);
      window.removeEventListener('refresh-reports', fetchData);
      window.removeEventListener('refresh-all-data', fetchData);
    };
  }, []);

  useEffect(() => {
    fetchData();
  }, [tab]);

  // --- RANGE PRESETS EVALUATION ---
  const [rangeType, setRangeType] = useState<'custom' | 'day' | 'month'>('day');
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
    const tDate = safeGetDateString(t.date || t.created_at);
    if (effectiveFromDate && tDate < effectiveFromDate) return false;
    if (effectiveToDate && tDate > effectiveToDate) return false;
    return true;
  });

  const filteredSalesReturns = salesReturns.filter(r => {
    if (r.status === 'voided' || r.status === 'cancelled') return false;
    const rDate = safeGetDateString(r.created_at || r.return_date || r.date);
    if (effectiveFromDate && rDate < effectiveFromDate) return false;
    if (effectiveToDate && rDate > effectiveToDate) return false;
    return true;
  });

  const getSaleSellingSubtotal = (s: any) => {
    const tot = Number(s.total_amount !== undefined ? s.total_amount : (s.total || 0));
    const tax = Number(s.tax || 0);
    const trans = Number(s.transportation_fee || s.transportationFee || 0);
    return Math.max(0, tot - tax - trans);
  };

  const getReturnSellingSubtotal = (r: any) => {
    const retAmt = Number(r.return_amount !== undefined && r.return_amount !== null
      ? r.return_amount
      : (r.returnAmount !== undefined && r.returnAmount !== null
        ? r.returnAmount
        : (r.total_refunded !== undefined && r.total_refunded !== null && Number(r.total_refunded) > 0
          ? r.total_refunded
          : (r.totalRefunded !== undefined && r.totalRefunded !== null && Number(r.totalRefunded) > 0
            ? r.totalRefunded
            : (r.amount || 0)))));
    const retTax = Number(r.tax || 0);
    const retTrans = Number(r.transportation_fee || r.transportationFee || 0);
    if (retAmt > 0) {
      return Math.max(0, retAmt - retTax - retTrans);
    }
    let rawItems = r.items || r.returnedItems || r.returned_items || [];
    let items: any[] = [];
    try {
      items = typeof rawItems === 'string' ? JSON.parse(rawItems) : rawItems;
    } catch(e) {}
    if (Array.isArray(items) && items.length > 0) {
      return items.reduce((sum: number, it: any) => {
        const itemQty = Number(it.qty || 0);
        const itemPrice = Number(it.price || it.unitPrice || 0);
        const itemDisc = Number(it.discount || 0);
        return sum + (itemQty * itemPrice - itemDisc);
      }, 0);
    }
    return 0;
  };

  // --- SALES CALCULATIONS ---
  const rawCashCollected = filteredSales.reduce((sum, s) => {
    const statusLower = (s.status || '').toString().toLowerCase().trim();
    if (statusLower === 'cancelled' || statusLower === 'voided') return sum;

    const method = (s.payment_method || s.paymentMethod || '').toString().toLowerCase().trim();
    const isCredit = method === 'credit' || method === 'credit sale' || (s as any).is_credit === true;

    if (isCredit) {
      return sum + Number(s.payment_received || 0);
    } else {
      const paid = s.payment_received !== undefined && s.payment_received !== null && Number(s.payment_received) > 0
        ? Number(s.payment_received)
        : Number(s.total_amount !== undefined ? s.total_amount : (s.total || 0));
      return sum + paid;
    }
  }, 0);

  const getExchangeRefundAmount = (r: any) => {
    const totRef = Number(r.total_refunded !== undefined && r.total_refunded !== null ? r.total_refunded : (r.totalRefunded || 0));
    if (totRef > 0) return totRef;

    const balAmt = Number(r.balance_amount !== undefined && r.balance_amount !== null ? r.balance_amount : (r.balanceAmount || 0));
    if (balAmt < 0) return Math.abs(balAmt);

    const refAmt = Number(r.refund_amount !== undefined && r.refund_amount !== null ? r.refund_amount : (r.refundAmount || 0));
    if (refAmt > 0) return refAmt;

    const retAmt = Number(r.return_amount !== undefined ? r.return_amount : (r.returnAmount || 0));
    const exAmt = Number(r.exchange_amount !== undefined ? r.exchange_amount : (r.exchangeAmount || 0));
    if (retAmt > exAmt && exAmt > 0) {
      return retAmt - exAmt;
    }

    return 0;
  };

  const cashRefundsTotal = filteredSalesReturns.reduce((sum, r) => {
    const statusLower = (r.status || '').toString().toLowerCase().trim();
    if (statusLower === 'voided' || statusLower === 'cancelled') return sum;
    const isCredit = r.isCredit === true || (r as any).is_credit === 1 || (r as any).is_credit === true;
    if (isCredit) return sum;

    const type = (r.return_type || r.returnType || r.returnMethod || r.return_method || r.type || '').toString().toLowerCase().trim();
    if (type === 'return' && Number(r.total_refunded || r.totalRefunded || 0) === 0) return sum;

    if (type === 'cash refund' || type === 'cash' || type === 'cash_refund') {
      const refundAmt = Number(r.refund_amount !== undefined && r.refund_amount !== null && Number(r.refund_amount) > 0
        ? r.refund_amount
        : (r.total_refunded !== undefined && r.total_refunded !== null && Number(r.total_refunded) > 0
          ? r.total_refunded
          : (r.return_amount !== undefined ? r.return_amount : (r.returnAmount || 0))));
      return sum + refundAmt;
    }

    if (type === 'exchange') {
      return sum + getExchangeRefundAmount(r);
    }

    return sum;
  }, 0);

  const exchangeCashInflowsTotal = filteredSalesReturns.reduce((sum, r) => {
    const statusLower = (r.status || '').toString().toLowerCase().trim();
    if (statusLower === 'voided' || statusLower === 'cancelled') return sum;
    const type = (r.return_type || r.returnType || r.returnMethod || r.return_method || r.type || '').toString().toLowerCase().trim();

    if (type === 'exchange') {
      const paidAmt = Number(r.customer_paid !== undefined ? r.customer_paid : (r.customerPaid !== undefined ? r.customerPaid : 0));
      const changeGiven = Number(r.change_given !== undefined ? r.change_given : (r.changeGiven !== undefined ? r.changeGiven : 0));
      const netPaid = Math.max(0, paidAmt - changeGiven);
      return sum + netPaid;
    }
    return sum;
  }, 0);

  const totalCashCollected = Math.max(0, rawCashCollected + exchangeCashInflowsTotal - cashRefundsTotal);

  const grossSalesSellingRevenue = filteredSales.reduce((sum, s) => {
    const statusLower = (s.status || '').toString().toLowerCase().trim();
    if (statusLower === 'cancelled' || statusLower === 'voided') return sum;
    return sum + getSaleSellingSubtotal(s);
  }, 0);

  const returnsSellingRevenue = filteredSalesReturns.reduce((sum, r) => {
    if (r.status === 'voided' || r.status === 'Voided' || r.status === 'cancelled') return sum;
    return sum + getReturnSellingSubtotal(r);
  }, 0);

  const exchangeSellingRevenue = filteredSalesReturns.reduce((sum, r) => {
    if (r.status === 'voided' || r.status === 'Voided' || r.status === 'cancelled') return sum;
    const exAmt = Number(r.exchange_amount !== undefined ? r.exchange_amount : (r.exchangeAmount || 0));
    return sum + exAmt;
  }, 0);

  const totalSalesRevenue = Math.max(0, grossSalesSellingRevenue - returnsSellingRevenue);
  const paidOrders = filteredSales.filter(o => {
    if (o.status === 'cancelled' || o.status === 'Cancelled') return false;
    const rem = Math.max(0, Number(o.total_amount !== undefined ? o.total_amount : (o.total || 0)) - Number(o.payment_received || 0));
    const statusLower = (o.status || '').toLowerCase();
    return statusLower === 'paid' || statusLower === 'fully settled' || rem <= 0.01;
  }).length;

  const dailySalesData = (() => {
    const map: Record<string, number> = {};
    filteredSales.forEach(sale => {
      const statusLower = (sale.status || '').toString().toLowerCase().trim();
      if (statusLower === 'cancelled' || statusLower === 'voided') return;
      const day = new Date(sale.created_at || sale.date).toLocaleDateString('en-US', { weekday: 'short' });
      const dayLabel = isSinhala ? (
        day === 'Sun' ? 'ඉරිදා' :
        day === 'Mon' ? 'සඳුදා' :
        day === 'Tue' ? 'අඟහ' :
        day === 'Wed' ? 'බදාදා' :
        day === 'Thu' ? 'බ්‍රහස්' :
        day === 'Fri' ? 'සිකු' : 'සෙන'
      ) : day;
      map[dayLabel] = (map[dayLabel] || 0) + Number(sale.total_amount || sale.total || 0);
    });

    filteredSalesReturns.forEach(ret => {
      const statusLower = (ret.status || '').toString().toLowerCase().trim();
      if (statusLower === 'voided' || statusLower === 'cancelled') return;
      const day = new Date(ret.created_at || ret.date).toLocaleDateString('en-US', { weekday: 'short' });
      const dayLabel = isSinhala ? (
        day === 'Sun' ? 'ඉරිදා' :
        day === 'Mon' ? 'සඳුදා' :
        day === 'Tue' ? 'අඟහ' :
        day === 'Wed' ? 'බදාදා' :
        day === 'Thu' ? 'බ්‍රහස්' :
        day === 'Fri' ? 'සිකු' : 'සෙන'
      ) : day;
      const retVal = getReturnSellingSubtotal(ret);
      map[dayLabel] = (map[dayLabel] || 0) - retVal;
    });

    const daysOrder = isSinhala 
      ? ['ඉරිදා', 'සඳුදා', 'අඟහ', 'බදාදා', 'බ්‍රහස්', 'සිකුරාදා', 'සෙනසුරාදා']
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return Object.keys(map).map(dayLabel => ({
      day: dayLabel,
      sales: Math.max(0, map[dayLabel])
    })).sort((a, b) => daysOrder.indexOf(a.day) - daysOrder.indexOf(b.day));
  })();

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

  const isSalesReturnTrans = (t: any) => {
    if (!t) return false;
    const type = (t.type || '').toLowerCase();
    const cat = (t.category || '').toLowerCase();
    return type === 'contra_revenue' || type === 'sales_return' || cat.startsWith('sales return') || cat === 'exchange refund';
  };

  const financialChartData = getLast6MonthsReports();
  filteredTransactions.forEach((trans) => {
    const tDate = new Date(trans.date || trans.created_at);
    const tYear = tDate.getFullYear();
    const tMonth = tDate.getMonth();
    const match = financialChartData.find(m => m.year === tYear && m.monthIndex === tMonth);
    if (match) {
      const amount = Number(trans.amount || 0);
      if (trans.type === 'income' || trans.flow_type === 'INCOME') {
        match.revenue += amount;
      } else if (isSalesReturnTrans(trans)) {
        match.revenue -= amount;
      } else if (trans.type === 'expense' || trans.flow_type === 'EXPENSE') {
        match.expenses += amount;
      }
    }
  });

  const totalIncome = filteredTransactions.filter(t => (t.type?.toLowerCase() === 'income' || t.flow_type?.toLowerCase() === 'income')).reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const totalSalesReturns = filteredTransactions.filter(t => isSalesReturnTrans(t)).reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const netRevenue = Math.max(0, totalIncome - totalSalesReturns);
  const totalExpenses = filteredTransactions.filter(t => (t.type?.toLowerCase() === 'expense' || t.flow_type?.toLowerCase() === 'expense') && !isSalesReturnTrans(t)).reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const financialSummaryMetrics = (() => {
    const summary = computeFinancialSummary({
      sales: filteredSales,
      salesReturns: filteredSalesReturns,
      products
    });

    return {
      grossStickerSales: summary.grossStickerSales,
      customerDiscounts: summary.customerDiscounts,
      salesReturnsRefunds: summary.returnsSellingRevenue,
      transportFees: summary.transportFees,
      grossSalesRevenue: summary.grossStickerSales,
      netSalesRevenue: summary.netSalesRevenue,
      cogs: summary.netCOGS,
      grossProfit: summary.grossProfit,
      grossMarginPct: summary.grossMarginPct
    };
  })();

  const totalSalesProfit = financialSummaryMetrics.grossProfit;

  const totalReceivables = filteredSales.reduce((sum, s) => {
    if (s.status === 'cancelled' || s.status === 'Cancelled' || s.status === 'voided' || s.status === 'Voided') return sum;
    if (!isCreditSaleRecord(s)) return sum;
    const acct = calculateSaleAccounting(s, salesReturns);
    return sum + acct.netOutstanding;
  }, 0);
  const totalPayables = suppliers.reduce((sum, s) => sum + Number(s.payable_balance || 0), 0);

  // Cashier Closing Shift Report (Daily breakdowns & Payment Method Realization)
  const todaySales = filteredSales.filter(s => {
    if (!fromDate && !toDate && rangeType === 'custom') {
      const todayStr = getLocalDateString();
      const saleDate = safeGetDateString(s.created_at || s.date);
      return saleDate === todayStr && s.status !== 'cancelled' && s.status !== 'voided';
    }
    return s.status !== 'cancelled' && s.status !== 'voided';
  });

  const periodCreditPayments = creditPayments.filter(cp => {
    const cpDate = safeGetDateString(cp.payment_date || cp.created_at || cp.date);
    if (!fromDate && !toDate && rangeType === 'custom') {
      const todayStr = getLocalDateString();
      return cpDate === todayStr;
    }
    if (effectiveFromDate && cpDate < effectiveFromDate) return false;
    if (effectiveToDate && cpDate > effectiveToDate) return false;
    return true;
  });

  let calcCash = 0;
  let calcCard = 0;
  let calcCredit = 0;
  let calcBank = 0;

  todaySales.forEach(s => {
    const method = (s.payment_method || s.paymentMethod || 'Cash').toString().toLowerCase().trim();
    const totalAmt = Number(s.total_amount !== undefined ? s.total_amount : (s.total || 0));

    const isCreditSale = isCreditSaleRecord(s);

    if (isCreditSale) {
      const acct = calculateSaleAccounting(s, salesReturns);
      calcCredit += acct.netOutstanding;
    } else {
      if (method === 'card' || method === 'credit card') {
        calcCard += totalAmt;
      } else if (method === 'bank' || method === 'bank transfer' || method === 'online') {
        calcBank += totalAmt;
      } else {
        calcCash += totalAmt;
      }
    }
  });

  periodCreditPayments.forEach(cp => {
    const payAmt = Number(cp.amount_paid !== undefined ? cp.amount_paid : (cp.amount || 0));
    const payMethod = (cp.payment_method || cp.paymentMethod || 'Cash').toString().toLowerCase().trim();

    if (payMethod === 'card' || payMethod === 'credit card') {
      calcCard += payAmt;
    } else if (payMethod === 'bank' || payMethod === 'bank transfer' || payMethod === 'online') {
      calcBank += payAmt;
    } else {
      calcCash += payAmt;
    }
  });

  // Calculate Cash Expenses paid out of the drawer for the period (Purchases, Supplier settlements, etc.)
  const periodCashExpenses = filteredTransactions
    .filter(t => {
      const type = (t.flow_type || t.type || '').toString().toUpperCase().trim();
      const method = (t.payment_method || t.paymentMethod || 'CASH').toString().toUpperCase().trim();
      return type === 'EXPENSE' && (method === 'CASH' || method === 'CASH_BEARER');
    })
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  // Net Cash in Drawer for Today's Payment Breakdown (Inflows - Expenses)
  const todayCash = Math.max(0, calcCash - periodCashExpenses);
  const todayCard = calcCard;
  const todayCredit = calcCredit;
  const todayBank = calcBank;

  const resolveCashierDisplayName = (rawName?: string, email?: string, userId?: string): string => {
    const rawVal = (rawName || '').trim();
    const emVal = (email || '').trim().toLowerCase();
    const idVal = (userId || '').trim();

    // 1. If explicit valid cashier name is provided and not a generic business fallback
    if (
      rawVal &&
      rawVal !== 'Sanoj Hardware' &&
      rawVal !== 'Muthuwadige Hardware' &&
      rawVal.toLowerCase() !== 'system' &&
      rawVal !== 'u1' &&
      rawVal !== 'u2'
    ) {
      return rawVal;
    }

    // 2. Check profiles list for matching ID, email, or name
    if (profiles && profiles.length > 0) {
      const matchedStaff = profiles.find(p => {
        const pEmail = (p.email || '').toLowerCase().trim();
        const pName = (p.name || p.fullName || '').toLowerCase().trim();
        const pUsername = (p.username || '').toLowerCase().trim();

        if (idVal && (p.id === idVal || p.id === idVal.replace(/^u_/, '') || `u_${p.id}` === idVal)) return true;
        if (emVal && pEmail === emVal) return true;
        if (rawVal) {
          const lowerRaw = rawVal.toLowerCase();
          if (pName && lowerRaw === pName) return true;
          if (pUsername && lowerRaw === pUsername) return true;
          if (pEmail && lowerRaw === pEmail) return true;
        }
        return false;
      });

      if (matchedStaff) {
        const staffName = matchedStaff.name || matchedStaff.fullName || matchedStaff.username;
        if (staffName && staffName.trim()) return staffName.trim();
        if (matchedStaff.email) {
          const prefix = matchedStaff.email.split('@')[0];
          return prefix.charAt(0).toUpperCase() + prefix.slice(1);
        }
      }
    }

    // 3. Check active currentUser session
    if (currentUser) {
      const curEmail = (currentUser.email || '').toLowerCase().trim();
      const curName = (currentUser.name || currentUser.fullName || currentUser.username || '').trim();
      if ((emVal && curEmail === emVal) || (idVal && (currentUser.id === idVal || `u_${currentUser.id}` === idVal))) {
        if (curName && curName !== 'Sanoj Hardware' && curName !== 'Muthuwadige Hardware') {
          return curName;
        }
        if (currentUser.email) {
          const prefix = currentUser.email.split('@')[0];
          return prefix.charAt(0).toUpperCase() + prefix.slice(1);
        }
      }
      if (curName && curName !== 'Sanoj Hardware' && curName !== 'Muthuwadige Hardware') {
        return curName;
      }
    }

    // 4. If email is provided, format prefix into a display name
    if (emVal && emVal.includes('@')) {
      const prefix = emVal.split('@')[0];
      if (prefix && prefix !== 'admin' && prefix !== 'system') {
        return prefix.charAt(0).toUpperCase() + prefix.slice(1);
      }
    }

    return rawVal && rawVal !== 'Sanoj Hardware' && rawVal !== 'Muthuwadige Hardware' ? rawVal : 'Krish';
  };

  const periodSalesReturns = filteredSalesReturns.filter(r => {
    if (!fromDate && !toDate && rangeType === 'custom') {
      const todayStr = getLocalDateString();
      const retDate = safeGetDateString(r.created_at || r.return_date || r.date);
      return retDate === todayStr && r.status !== 'voided' && r.status !== 'cancelled';
    }
    return r.status !== 'voided' && r.status !== 'cancelled';
  });

  const cashierSummaryMap: Record<string, { amount: number; txIds: Set<string> }> = {};

  const getCashierEntry = (name: string) => {
    if (!cashierSummaryMap[name]) {
      cashierSummaryMap[name] = { amount: 0, txIds: new Set<string>() };
    }
    return cashierSummaryMap[name];
  };

  // 1. Process direct non-credit sales handled at POS counter (Cash, Card, Bank)
  todaySales.forEach(s => {
    const cashierName = resolveCashierDisplayName(s.cashier || s.user_name || s.user_id, s.user_email, s.user_id);
    const isCredit = isCreditSaleRecord(s);
    
    if (!isCredit) {
      const realizedAmt = Number(s.payment_received !== undefined && s.payment_received !== null && Number(s.payment_received) > 0
        ? s.payment_received
        : (s.total_amount !== undefined ? s.total_amount : (s.total || 0)));

      if (realizedAmt > 0) {
        const entry = getCashierEntry(cashierName);
        entry.amount += realizedAmt;
        entry.txIds.add(s.id || s.invoice_no || `sale_${s.created_at}`);
      }
    }
  });

  // 2. Debt settlements / Credit repayments collected during shift (Cash, Card, Bank, Cheque Encashed)
  periodCreditPayments.forEach(cp => {
    const cashierName = resolveCashierDisplayName(cp.recorded_by || cp.created_by || cp.cashier, cp.user_email, cp.user_id);
    const payAmt = Number(cp.amount_paid !== undefined ? cp.amount_paid : (cp.amount || 0));
    if (payAmt > 0) {
      const entry = getCashierEntry(cashierName);
      entry.amount += payAmt;
      entry.txIds.add(cp.id || `cp_${cp.invoice_no || cp.sale_id}_${cp.payment_date || cp.created_at}`);
    }
  });

  // 3. Deduct cash expenses (PO cash payments, supplier cash settlements) handled by the cashier shift
  filteredTransactions.forEach(t => {
    const type = (t.flow_type || t.type || '').toString().toUpperCase().trim();
    const method = (t.payment_method || t.paymentMethod || 'CASH').toString().toUpperCase().trim();
    if (type === 'EXPENSE' && (method === 'CASH' || method === 'CASH_BEARER')) {
      const cashierName = resolveCashierDisplayName(t.created_by || t.user_name || t.cashier, t.user_email, t.user_id);
      const expAmt = Number(t.amount || 0);
      if (expAmt > 0) {
        const entry = getCashierEntry(cashierName);
        entry.amount = Math.max(0, entry.amount - expAmt);
      }
    }
  });

  // 4. Exchange payments collected & cash refunds paid out by cashier
  periodSalesReturns.forEach(r => {
    const cashierName = resolveCashierDisplayName(r.cashier || r.user_name || r.user_id, r.user_email, r.user_id);
    const type = (r.return_type || r.returnType || r.returnMethod || r.return_method || r.type || '').toString().toLowerCase().trim();
    const isCredit = r.isCredit === true || (r as any).is_credit === 1 || (r as any).is_credit === true;

    if (type === 'exchange') {
      const paidAmt = Number(r.customer_paid !== undefined ? r.customer_paid : (r.customerPaid !== undefined ? r.customerPaid : 0));
      const changeGiven = Number(r.change_given !== undefined ? r.change_given : (r.changeGiven !== undefined ? r.changeGiven : 0));
      const netPaid = Math.max(0, paidAmt - changeGiven);
      if (netPaid > 0) {
        const entry = getCashierEntry(cashierName);
        entry.amount += netPaid;
        entry.txIds.add(r.id || `ex_${r.return_no || r.invoice_no}`);
      }
      const exRefund = getExchangeRefundAmount(r);
      if (exRefund > 0 && !isCredit) {
        const entry = getCashierEntry(cashierName);
        entry.amount = Math.max(0, entry.amount - exRefund);
        entry.txIds.add(r.id || `ref_${r.return_no || r.invoice_no}`);
      }
    } else if (!isCredit && (type === 'cash refund' || type === 'cash' || type === 'cash_refund')) {
      const refundAmt = Number(r.refund_amount !== undefined && r.refund_amount !== null && Number(r.refund_amount) > 0
        ? r.refund_amount
        : (r.total_refunded !== undefined && r.total_refunded !== null && Number(r.total_refunded) > 0
          ? r.total_refunded
          : (r.return_amount !== undefined ? r.return_amount : (r.returnAmount || 0))));
      if (refundAmt > 0) {
        const entry = getCashierEntry(cashierName);
        entry.amount = Math.max(0, entry.amount - refundAmt);
        entry.txIds.add(r.id || `ref_${r.return_no || r.invoice_no}`);
      }
    }
  });

  const cashierSummaryArray = Object.keys(cashierSummaryMap).map(name => ({
    name,
    amount: Math.round(cashierSummaryMap[name].amount * 100) / 100,
    count: cashierSummaryMap[name].txIds.size
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
            const product = products.find(p => p.id === it.productId || p.id === it.product_id);
            const cost = getItemUnitCost(product, it.unit, it.conversionRate, it.costPrice || it.cost_price);
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
        [t("Date", "දිනය")]: tData.date || tData.created_at,
        [t("Type", "වර්ගය")]: (tData.type === 'income' || tData.flow_type === 'INCOME') ? t('Income', 'ආදායම') : t('Expense', 'වියදම'),
        [t("Category", "ප්‍රභේදය")]: getCategoryTranslation(tData.category),
        [t("Description", "විස්තරය")]: tData.description,
        [t("Amount", "මුදල")]: tData.amount
      }));
    }

    const ws = XLSX.utils.json_to_sheet(mappedData);
    
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

      const ref = ws['!ref'];
      if (ref) {
        const range = XLSX.utils.decode_range(ref);
        const themeColor = "DAA520";
        
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
              const product = products.find(p => p.id === it.productId || p.id === it.product_id);
              const cost = getItemUnitCost(product, it.unit, it.conversionRate, it.costPrice || it.cost_price);
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
          tData.date || tData.created_at || '',
          (tData.type === 'income' || tData.flow_type === 'INCOME') ? t('Income', 'ආදායම') : t('Expense', 'වියදම'),
          getCategoryTranslation(tData.category),
          tData.description || '',
          formatCurrency(Number(tData.amount || 0))
        ]);

    const head = tab === 'sales' 
      ? [[t('Invoice', 'ඉන්වොයිසිය'), t('Date', 'දිනය'), t('Customer', 'පාරිභෝගිකයා'), t('Total', 'මුළු මුදල'), t('Net Profit', 'ශුද්ධ ලාභය')]] 
      : tab === 'inventory'
      ? [[t('Product', 'භාණ්ඩය'), t('Category', 'ප්‍රභේදය'), t('Stock', 'තොගය'), t('Price', 'මිල')]]
      : [[t('Date', 'දිනය'), t('Type', 'වර්ගය'), t('Category', 'ප්‍රභේදය'), t('Description', 'විස්තරය'), t('Amount', 'මුදල')]];

    const columnStyles: Record<string | number, any> = tab === 'sales' 
      ? {
          0: { cellWidth: 35 },
          1: { cellWidth: 28 },
          2: { cellWidth: 55, overflow: 'linebreak' as const },
          3: { cellWidth: 32, halign: 'right' as const },
          4: { cellWidth: 30, halign: 'right' as const }
        }
      : tab === 'inventory'
      ? {
          0: { cellWidth: 65, overflow: 'linebreak' as const },
          1: { cellWidth: 45, overflow: 'linebreak' as const },
          2: { cellWidth: 35, halign: 'center' as const },
          3: { cellWidth: 35, halign: 'right' as const }
        }
      : {
          0: { cellWidth: 26 },
          1: { cellWidth: 22 },
          2: { cellWidth: 50, overflow: 'linebreak' as const },
          3: { cellWidth: 50, overflow: 'linebreak' as const },
          4: { cellWidth: 32, halign: 'right' as const }
        };

    autoTable(doc, {
      startY: 32,
      head: head,
      body: body,
      theme: 'grid',
      headStyles: { fillColor: [218, 165, 32] },
      styles: { fontSize: 8, overflow: 'linebreak', cellPadding: 2 },
      columnStyles
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
        <div className="space-y-6">
          <div className="bg-white rounded-3xl border border-slate-100 p-6 shadow-md">
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <BarChart3Icon className="w-4 h-4 text-[#DAA520]" />
              {t("Financial Summary Statement", "මූල්‍ය සාරාංශ වාර්තාව")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
              <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-150 text-left">
                <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest block mb-1">1. {t("Gross Sales Revenue (Sticker Value)", "එකතුව")}</span>
                <span className="text-base font-black text-slate-800">{formatCurrency(financialSummaryMetrics.grossStickerSales)}</span>
              </div>
              <div className="bg-amber-50/40 p-3.5 rounded-2xl border border-amber-100 text-left">
                <span className="text-[9px] font-extrabold text-amber-600 uppercase tracking-widest block mb-1">2. {t("Less: Customer Discounts", "වට්ටම්")}</span>
                <span className="text-base font-black text-amber-700">{formatCurrency(financialSummaryMetrics.customerDiscounts)}</span>
              </div>
              <div className="bg-rose-50/50 p-3.5 rounded-2xl border border-rose-100 text-left">
                <span className="text-[9px] font-extrabold text-rose-500 uppercase tracking-widest block mb-1">3. {t("Less: Sales Returns & Refunds", "ආපසු යැවීම්")}</span>
                <span className="text-base font-black text-rose-700">{formatCurrency(financialSummaryMetrics.salesReturnsRefunds)}</span>
              </div>
              <div className="bg-blue-50/50 p-3.5 rounded-2xl border border-blue-100 text-left">
                <span className="text-[9px] font-extrabold text-blue-600 uppercase tracking-widest block mb-1">4. {t("Add: Delivery Fees", "ප්‍රවාහන ගාස්තු")}</span>
                <span className="text-base font-black text-blue-800">{formatCurrency(financialSummaryMetrics.transportFees)}</span>
              </div>
              <div className="bg-emerald-50/50 p-3.5 rounded-2xl border border-emerald-100 text-left">
                <span className="text-[9px] font-extrabold text-emerald-600 uppercase tracking-widest block mb-1">5. {t("Net Sales Revenue", "ශුද්ධ ආදායම")}</span>
                <span className="text-base font-black text-emerald-800">{formatCurrency(financialSummaryMetrics.netSalesRevenue)}</span>
              </div>
              <div className="bg-amber-50/50 p-3.5 rounded-2xl border border-amber-100 text-left">
                <span className="text-[9px] font-extrabold text-amber-600 uppercase tracking-widest block mb-1">6. {t("Cost of Goods Sold (COGS)", "පිරිවැය")}</span>
                <span className="text-base font-black text-amber-800">{formatCurrency(financialSummaryMetrics.cogs)}</span>
              </div>
              <div className="bg-gradient-to-br from-[#2c2c2c] to-[#464646] p-3.5 rounded-2xl border border-slate-700 text-left shadow-sm">
                <span className="text-[9px] font-extrabold text-[#DAA520] uppercase tracking-widest block mb-1">7. {t("Gross Profit", "ශුද්ධ ලාභය")}</span>
                <div className="flex flex-col">
                  <span className="text-base font-black text-white">{formatCurrency(financialSummaryMetrics.grossProfit)}</span>
                  <span className="text-[9px] font-bold text-amber-300 mt-0.5">{financialSummaryMetrics.grossMarginPct.toFixed(1)}% Margin</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5">
            <div className="bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(16,185,129,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(16,185,129,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-emerald-100 font-extrabold uppercase tracking-widest">{t('Total Revenue Collected', 'එකතු කළ මුළු ආදායම')}</p>
                <div className="px-2.5 py-1 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300 flex items-center justify-center">
                  <span className="font-black text-sm text-white">Rs.</span>
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{formatCurrency(totalCashCollected)}</p>
            </div>

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

            <div className="bg-gradient-to-br from-rose-500 via-rose-600 to-red-700 rounded-3xl p-6 shadow-md shadow-rose-500/10 hover:-translate-y-1.5 hover:shadow-lg hover:shadow-rose-500/20 transition-all duration-300 relative overflow-hidden group isolate">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/5 rounded-full blur-lg group-hover:scale-125 transition-transform duration-500 pointer-events-none" />
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
                      <p className="text-[9px] font-black uppercase text-slate-400 tracking-wider">{t("Card", "කාඩ්")}</p>
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
        <div className="space-y-6">
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
                    <p className="text-sm font-black text-red-650">{formatStock(item.stock, item.unit)} left</p>
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                        <td className="px-4 py-3 text-center text-slate-600 font-bold">{formatStock(p.stock, (p as any).unit)}</td>
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
                        <td className="px-4 py-3 text-center text-slate-600 font-bold">{formatStock(p.stock, (p as any).unit)}</td>
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
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 rounded-3xl p-6 shadow-[0_12px_30px_rgba(16,185,129,0.2)] hover:-translate-y-1.5 hover:shadow-[0_20px_45px_rgba(16,185,129,0.35)] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] text-emerald-100 font-extrabold uppercase tracking-widest mb-1.5">{t('Net Income', 'ශුද්ධ ආදායම')}</p>
                <div className="p-2.5 bg-white/15 text-white rounded-2xl ring-4 ring-white/10 group-hover:scale-110 transition-all duration-300">
                  <ArrowUpRightIcon className="w-4 h-4" />
                </div>
              </div>
              <p className="text-3xl font-black text-white tracking-tight">{formatCurrency(netRevenue)}</p>
              <p className="text-[10px] text-emerald-100/90 font-medium mt-3.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                {t('Net cash inflows after returns', 'ආපසු ගෙවීම් বাদ කළ පසු ශුද්ධ ආදායම')}
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
              <p className="text-3xl font-black text-white tracking-tight">{formatCurrency(netRevenue - totalExpenses)}</p>
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

            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm text-left space-y-6">
              <div className="flex items-center gap-2">
                <WalletIcon className="w-4 h-4 text-[#DAA520]" />
                <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                  {t('Outstanding Balance Ledger Position', 'හිඟ ශේෂ ලෙජර පිහිටීම')}
                </h2>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center p-4 bg-emerald-50/40 rounded-xl border border-emerald-100">
                  <div>
                    <p className="text-xs font-black text-emerald-800 uppercase tracking-wider">{t("Total Receivables (From Customers)", "එකතු විය යුතු මුදල් (පාරිභෝගිකයින්ගෙන්)")}</p>
                    <p className="text-[10px] font-bold text-emerald-600 mt-0.5">{t("Outstanding credit invoices to collect", "එකතු කිරීමට ඇති මුළු නොගෙවූ ඉන්වොයිසි")}</p>
                  </div>
                  <p className="text-xl font-black text-emerald-700">{formatCurrency(totalReceivables)}</p>
                </div>

                <div className="flex justify-between items-center p-4 bg-rose-50/25 rounded-xl border border-rose-100">
                  <div>
                    <p className="text-xs font-black text-rose-800 uppercase tracking-wider">{t("Total Payables (To Suppliers)", "ගෙවිය යුතු මුදල් (සැපයුම්කරුවන්ට)")}</p>
                    <p className="text-[10px] font-bold text-rose-600 mt-0.5">{t("Outstanding payable balance on supplier credit", "සැපයුම්කරුවන්ට ගෙවීමට ඇති හිඟ මුදල් ප්‍රමාණය")}</p>
                  </div>
                  <p className="text-xl font-black text-rose-700">{formatCurrency(totalPayables)}</p>
                </div>

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