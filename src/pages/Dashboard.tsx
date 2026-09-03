import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { API_URL } from '../lib/api';
import { formatStock } from '../utils/formatters';
import { openExternalUrl, formatWhatsAppUrl } from '../utils/openExternalUrl';
import {
  toSriLankaDateStr,
  getTodaySriLankaDate,
  computeFinancialSummary,
  computePaymentBreakdown,
  calculateSaleAccounting,
  getItemUnitCost
} from '../utils/accounting';
import {
  ShoppingCartIcon,
  AlertTriangleIcon,
  UsersIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  PackageIcon,
  Loader2Icon,
  CheckCircleIcon,
  XIcon,
  MessageSquareIcon
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';
import { Modal } from '../components/Modal';
import {
  categorySalesData
} from '../data/mockData';

interface DashboardProps {
  onNavigate?: (page: string, tab?: string) => void;
}

// Module-level cache for stale-while-revalidate zero-flicker tab switching
let cachedDashboard: {
  stats: any;
  lowStockItems: any[];
  isAdmin: boolean;
  suppliers: any[];
  recentSales: any[];
  salesTrend: any[];
  growthPercent: number;
  salesByCategory: any[];
  todayProfit: number;
  cashBalance: number;
  pendingPOs: number;
} | null = null;

export function Dashboard({ onNavigate }: DashboardProps) {
  // Hardcode symbol to Rs.
  const symbol = 'Rs.';

  const getInitialSalesTrend = () => {
    const trend: any[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = targetDate.toLocaleString('en-US', { month: 'short' });
      trend.push({
        month: monthLabel,
        revenue: 0,
        expenses: 0
      });
    }
    return trend;
  };

  // --- STATE MANAGEMENT WITH STALE-WHILE-REVALIDATE ---
  const [stats, setStats] = useState(() => cachedDashboard?.stats || {
    revenue: 0,
    grossSales: 0,
    netSales: 0,
    cogs: 0,
    profit: 0,
    orders: 0,
    customers: 0,
    lowStock: 0
  });
  const [lowStockItems, setLowStockItems] = useState<any[]>(() => cachedDashboard?.lowStockItems || []);
  const [isAdmin, setIsAdmin] = useState(() => cachedDashboard?.isAdmin || false);
  const [suppliers, setSuppliers] = useState<any[]>(() => cachedDashboard?.suppliers || []);
  const [recentSales, setRecentSales] = useState<any[]>(() => cachedDashboard?.recentSales || []);
  const [salesTrend, setSalesTrend] = useState<any[]>(() => cachedDashboard?.salesTrend || getInitialSalesTrend());
  const [growthPercent, setGrowthPercent] = useState<number>(() => cachedDashboard?.growthPercent || 0);
  const [salesByCategory, setSalesByCategory] = useState<any[]>(() => cachedDashboard?.salesByCategory || categorySalesData);
  const [loading, setLoading] = useState(() => !cachedDashboard);

  // Responsive Owner/Mobile Dashboard Toggle State
  const [isMobileMode, setIsMobileMode] = useState(false);
  const [todayProfit, setTodayProfit] = useState(() => cachedDashboard?.todayProfit || 0);
  const [cashBalance, setCashBalance] = useState(() => cachedDashboard?.cashBalance || 0);
  const [pendingPOs, setPendingPOs] = useState(() => cachedDashboard?.pendingPOs || 0);
  const [isSinhala, setIsSinhala] = useState(false);
  const t = (en: string, si: string) => isSinhala ? si : en;

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setIsMobileMode(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [showReorderModal, setShowReorderModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [reorderQty, setReorderQty] = useState(10);
  const [isSaving, setIsSaving] = useState(false);
  
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleReorderClick = (product: any) => {
    setSelectedProduct(product);
    const minStk = product.minStock !== undefined ? product.minStock : product.min_stock !== undefined ? product.min_stock : 10;
    const suggestedQty = Math.max(1, minStk - (product.stock || 0));
    setReorderQty(suggestedQty);
    setModalError(null);
    setShowReorderModal(true);
  };

  const handleReorderConfirm = async () => {
    if (!selectedProduct) return;
    setIsSaving(true);
    setModalError(null);
    try {
      const newStock = (selectedProduct.stock || 0) + reorderQty;
      const { error } = await supabase
        .from('products')
        .update({ stock: newStock })
        .eq('id', selectedProduct.id);

      if (error) {
        setModalError(error.message || "Failed to save product in local database");
      } else {
        setToast({
          type: 'success',
          message: `Successfully restocked ${selectedProduct.name} to ${newStock} units!`
        });
        
        // Auto close after 4 seconds
        setTimeout(() => {
          setToast(null);
        }, 4000);

        setShowReorderModal(false);
        fetchDashboardStats();
      }
    } catch (err: any) {
      setModalError(err.message || "Failed to update stock");
    } finally {
      setIsSaving(false);
    }
  };

  const handleWhatsAppAlert = async (item: any) => {
    if (!item) return;

    const supplierName = item.supplier || item.supplier_name || item.supplierName;
    let phone = item.supplierPhone || item.supplier_phone || item.supplierPhoneNo || item.supplier_phone_no;
    
    if (!phone && supplierName) {
      const s = (suppliers || []).find((sup: any) => 
        (sup.name && sup.name.trim().toLowerCase() === String(supplierName).trim().toLowerCase()) ||
        (sup.id && item.supplier_id && sup.id === item.supplier_id)
      );
      if (s && (s.phone || s.phone_no)) {
        phone = s.phone || s.phone_no;
      }
    }
    
    if (!phone || !String(phone).trim()) {
      alert("Supplier WhatsApp number is not available.");
      return;
    }
    
    const currentStockFormatted = `${formatStock(item.stock, item.unit)} ${item.unit || 'PCS'}`;
    const minStockVal = item.minStock !== undefined ? item.minStock : item.min_stock !== undefined ? item.min_stock : 10;
    const minStockFormatted = `${minStockVal} ${item.unit || 'PCS'}`;

    const message = `Hello, we need to reorder ${item.name}. Current stock is ${currentStockFormatted} and the minimum stock level is ${minStockFormatted}. Please let us know the availability and price.`;
    
    const url = formatWhatsAppUrl(String(phone), message);
    await openExternalUrl(url);
  };

  // Custom Theme Colors for the Dashboard (Gold, Dark Charcoal, Ash, Slate)
  const themeColors = ['#DAA520', '#464646', '#B8860B', '#808080', '#EEDC82'];

  const statusColors: Record<string, string> = {
    paid: 'bg-emerald-50 text-emerald-700 border border-emerald-200/50', 
    Paid: 'bg-emerald-50 text-emerald-700 border border-emerald-200/50', 
    pending: 'bg-amber-50 text-amber-700 border border-amber-200/50', 
    'Non Paid': 'bg-red-50 text-red-700 border border-red-200/50', 
    cancelled: 'bg-rose-50 text-rose-700 border border-rose-200/50',
    Cancelled: 'bg-rose-50 text-rose-700 border border-rose-200/50',
    Voided: 'bg-rose-50 text-rose-700 border border-rose-200/50',
    voided: 'bg-rose-50 text-rose-700 border border-rose-200/50'
  };

  // --- DATA FETCHING ---
  useEffect(() => {
    fetchDashboardStats();

    const handleRefresh = () => {
      fetchDashboardStats();
    };
    window.addEventListener('refresh-dashboard', handleRefresh);
    window.addEventListener('refresh-all-data', handleRefresh);
    return () => {
      window.removeEventListener('refresh-dashboard', handleRefresh);
      window.removeEventListener('refresh-all-data', handleRefresh);
    };
  }, []);

  const fetchDashboardStats = async () => {
    if (!cachedDashboard) {
      setLoading(true);
    }
    const today = getTodaySriLankaDate();

    try {
      // Fetch user role
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        setIsAdmin(userData.user.role === 'admin' || userData.user.role === 'super_admin');
      }

      // Fetch suppliers
      const { data: suppliersData } = await supabase.from('suppliers').select('*');
      if (suppliersData) {
        setSuppliers(suppliersData);
      }

      // 1. Fetch all sales for dynamic charts and metrics
      const { data: allSales } = await supabase.from('sales').select('*');
      const { data: allReturns } = await supabase.from('sales_returns').select('*');
      const { data: allCreditPayments } = await supabase.from('credit_payments').select('*');
      const { data: allTransactions } = await supabase.from('transactions').select('*');

      // Today's Sales (calculated with Sri Lanka timezone)
      const salesToday = allSales ? allSales.filter((s: any) => {
        if (!s) return false;
        const saleDateStr = toSriLankaDateStr(s.created_at || s.date);
        return saleDateStr === today && s.status !== 'cancelled' && s.status !== 'Voided' && s.status !== 'voided';
      }) : [];

      const todayOrders = salesToday.length;

      // 2. Fetch Customers & Suppliers
      const { data: custData } = await supabase.from('customers').select('*');
      const customerCount = custData ? custData.length : 0;

      const { data: suppData } = await supabase.from('suppliers').select('*');
      if (suppData) setSuppliers(suppData);

      // 3. Fetch Products & calculate Stock Alerts
      const { data: products } = await supabase.from('products').select('*');
      const lowStock = products?.filter((p) => {
        const minStk = p.minStock !== undefined ? p.minStock : p.min_stock !== undefined ? p.min_stock : 10;
        return p.stock < minStk;
      }) || [];

      // 4. Calculate Recent sales locally from allSales
      const recent = allSales ? [...allSales]
        .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        .slice(0, 5) : [];

      // 5. Dynamic monthly Sales Trend calculation
      const dynamicTrend: any[] = [];
      const now = new Date();
      
      // Build last 6 months dynamically (from 5 months ago to today)
      for (let i = 5; i >= 0; i--) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthLabel = targetDate.toLocaleString('en-US', { month: 'short' });
        dynamicTrend.push({
          month: monthLabel,
          year: targetDate.getFullYear(),
          monthNum: targetDate.getMonth(),
          revenue: 0,
          expenses: 0
        });
      }

      if (allSales && allSales.length > 0) {
        allSales.forEach((sale: any) => {
           if (sale.status === 'cancelled' || sale.status === 'Voided' || sale.status === 'voided') return;
          const saleDate = new Date(sale.created_at || sale.date);
          if (isNaN(saleDate.getTime())) return;
          
          const saleMonth = saleDate.getMonth();
          const saleYear = saleDate.getFullYear();
          const saleAmount = Number(sale.total_amount || sale.total || 0);
          
          const matchingMonth = dynamicTrend.find(
            (m) => m.monthNum === saleMonth && m.year === saleYear
          );
          if (matchingMonth) {
            matchingMonth.revenue += saleAmount;
          }
        });
      }
      
      // Reconcile dynamic trend with returns for Net Sales
      if (allReturns && allReturns.length > 0) {
        allReturns.forEach((ret: any) => {
          if (ret.status === 'voided' || ret.status === 'Voided' || ret.status === 'cancelled') return;
          const retDate = new Date(ret.created_at);
          if (isNaN(retDate.getTime())) return;

          const retMonth = retDate.getMonth();
          const retYear = retDate.getFullYear();
          
          const retVal = Number(ret.return_amount !== undefined && ret.return_amount !== null
            ? ret.return_amount
            : (ret.returnAmount !== undefined && ret.returnAmount !== null
              ? ret.returnAmount
              : (ret.total_refunded !== undefined && ret.total_refunded !== null && Number(ret.total_refunded) > 0
                ? ret.total_refunded
                : (ret.totalRefunded !== undefined && ret.totalRefunded !== null && Number(ret.totalRefunded) > 0
                  ? ret.totalRefunded
                  : (ret.amount || 0)))));
          const exVal = Number(ret.exchange_amount !== undefined && ret.exchange_amount !== null
            ? ret.exchange_amount
            : (ret.exchangeAmount !== undefined && ret.exchangeAmount !== null
              ? ret.exchangeAmount
              : (ret.exchange_total || ret.exchangeTotal || 0)));
          const adjustment = exVal - retVal;

          const matchingMonth = dynamicTrend.find(
            (m) => m.monthNum === retMonth && m.year === retYear
          );
          if (matchingMonth) {
            matchingMonth.revenue += adjustment;
          }
        });
      }
      
      const formattedTrend = dynamicTrend.map(({ month, revenue, expenses }) => ({
        month,
        revenue,
        expenses
      }));
      setSalesTrend(formattedTrend);

      // Calculate dynamic growth percentage comparing current month vs previous month
      let computedGrowth = 0;
      if (dynamicTrend.length >= 2) {
        const currentMonthRev = dynamicTrend[dynamicTrend.length - 1].revenue;
        const prevMonthRev = dynamicTrend[dynamicTrend.length - 2].revenue;
        if (prevMonthRev > 0) {
          computedGrowth = ((currentMonthRev - prevMonthRev) / prevMonthRev) * 100;
        } else if (currentMonthRev > 0) {
          computedGrowth = 100.0;
        }
      }
      setGrowthPercent(computedGrowth);

      // 6. Dynamic Sales by Category calculation
      const productCategoryMap: Record<string, string> = {};
      if (products) {
        products.forEach((p: any) => {
          productCategoryMap[p.id] = p.category || 'Other';
        });
      }

      const categoryTotals: Record<string, number> = {};
      if (allSales && allSales.length > 0) {
        allSales.forEach((sale: any) => {
           if (sale.status === 'cancelled' || sale.status === 'Voided' || sale.status === 'voided') return;
          let items: any[] = [];
          try {
            items = typeof sale.items === 'string' ? JSON.parse(sale.items) : sale.items || [];
          } catch (e) {
            console.warn("Failed to parse items for sale", sale.id, e);
          }
          
          items.forEach((item: any) => {
            const cat = productCategoryMap[item.productId] || 'Other';
            const itemTotal = Number(item.total || (item.price * item.qty) || 0);
            categoryTotals[cat] = (categoryTotals[cat] || 0) + itemTotal;
          });
        });
      }

      const dynamicCategories = Object.keys(categoryTotals).map((catName) => ({
        name: catName,
        value: Math.round(categoryTotals[catName])
      }));

      if (dynamicCategories.length > 0) {
        dynamicCategories.sort((a, b) => b.value - a.value);
        setSalesByCategory(dynamicCategories);
      }

      // 1. Authoritative Financial Performance Summary for Today
      const todayFinancialSummary = computeFinancialSummary({
        sales: allSales || [],
        salesReturns: allReturns || [],
        products: products || [],
        fromDate: today,
        toDate: today
      });

      // 2. Authoritative Payment Method & Cash Collections Breakdown for Today
      const todayPaymentBreakdown = computePaymentBreakdown({
        sales: allSales || [],
        creditPayments: allCreditPayments || [],
        salesReturns: allReturns || [],
        fromDate: today,
        toDate: today
      });

      // Unified Liquid Cash Calculation (incorporates Direct POS Cash, Credit Settlements & Encashed Cheques)
      let dynamicCashInHand = todayPaymentBreakdown.totalCashCollected;
      if (allTransactions && allTransactions.length > 0) {
        const cashIncome = allTransactions
          .filter((t: any) => {
            const tDate = toSriLankaDateStr(t.date || t.created_at);
            const method = (t.payment_method || t.paymentMethod || 'CASH').toString().toUpperCase().trim();
            const type = (t.flow_type || t.type || '').toString().toUpperCase().trim();
            return tDate === today && type === 'INCOME' && (method === 'CASH' || method === 'CASH_BEARER');
          })
          .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);

        const cashExpense = allTransactions
          .filter((t: any) => {
            const tDate = toSriLankaDateStr(t.date || t.created_at);
            const method = (t.payment_method || t.paymentMethod || 'CASH').toString().toUpperCase().trim();
            const type = (t.flow_type || t.type || '').toString().toUpperCase().trim();
            return tDate === today && type === 'EXPENSE' && (method === 'CASH' || method === 'CASH_BEARER');
          })
          .reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);

        if (cashIncome > 0 || cashExpense > 0) {
          dynamicCashInHand = Math.max(0, cashIncome - cashExpense);
        }
      }

      setTodayProfit(todayFinancialSummary.grossProfit);
      setCashBalance(dynamicCashInHand);

      // Fetch pending Purchase Orders for supplier alerts
      const { data: poData } = await supabase.from('purchase_orders').select('*');
      const pendingCount = poData?.filter((po: any) => po.status === 'pending').length || 0;
      setPendingPOs(pendingCount);

      const calculatedStats = {
        revenue: todayFinancialSummary.grossStickerSales,
        grossSales: todayFinancialSummary.grossStickerSales,
        netSales: todayFinancialSummary.netSalesRevenue,
        cogs: todayFinancialSummary.netCOGS,
        profit: todayFinancialSummary.grossProfit,
        orders: todayOrders,
        customers: customerCount,
        lowStock: lowStock.length
      };

      setStats(calculatedStats);
      setLowStockItems(lowStock);
      setRecentSales(recent);

      // Save to module cache for instantaneous tab switching
      cachedDashboard = {
        stats: calculatedStats,
        lowStockItems: lowStock,
        isAdmin,
        suppliers: suppData || [],
        recentSales: recent,
        salesTrend: dynamicTrend,
        growthPercent: computedGrowth,
        salesByCategory: dynamicCategories.length > 0 ? dynamicCategories : categorySalesData,
        todayProfit: todayFinancialSummary.grossProfit,
        cashBalance: dynamicCashInHand,
        pendingPOs: pendingCount
      };
    } catch (error) {
      console.error("Error loading dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      
      {/* Dashboard Toggle Switcher & Language Switcher */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white border border-gray-200 p-2.5 rounded-2xl shadow-sm gap-3">
        <h2 className="text-xs font-black text-slate-800 uppercase tracking-wider pl-2">
          {isMobileMode 
            ? t("Owner Mobile Dashboard", "සරල හිමිකරු දසුන") 
            : t("System Analytics Dashboard", "පද්ධති විශ්ලේෂණ දසුන")}
        </h2>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setIsMobileMode(false)}
              className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                !isMobileMode
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {t("Detailed", "විස්තරාත්මක")}
            </button>
            <button
              onClick={() => setIsMobileMode(true)}
              className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                isMobileMode
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {t("Mobile View", "සරල දසුන")}
            </button>
          </div>
        </div>
      </div>

      {isMobileMode ? (
        <div className="space-y-6">
          {/* Welcome Banner */}
          <div className="bg-gradient-to-r from-[#2c2c2c] to-[#464646] rounded-3xl border border-[#DAA520]/20 shadow-lg p-6 flex flex-col items-center justify-between gap-4 relative overflow-hidden text-center md:text-left md:flex-row">
            <div className="absolute w-[500px] h-[500px] bg-[#DAA520]/5 rounded-full blur-[80px] -top-64 -right-32 pointer-events-none" />
            <div className="flex flex-col md:flex-row items-center gap-4 relative z-10">
              <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center border border-white/10 shadow-lg p-2 shrink-0 animate-pulse">
                <span className="text-[#DAA520] font-black text-2xl">M</span>
              </div>
              <div className="text-left">
                <h1 className="text-xl font-black text-white leading-tight">
                  {t("Owner Mobile Dashboard", "හිමිකරුගේ සරල දසුන")}
                </h1>
                <p className="text-xs font-semibold text-gray-300 mt-1">
                  {t("Muthuwadige Hardware simplified mobile summary.", "මුතුවාඩිගේ හාඩ්වෙයාර් හි සරල දෛනික දත්ත සාරාංශය.")}
                </p>
              </div>
            </div>
            <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-3 px-5 text-center shrink-0">
              <span className="text-[10px] font-black text-[#DAA520] uppercase tracking-widest block">{t("Server Status", "සේවාදායකය")}</span>
              <span className="text-xs font-black text-emerald-400 mt-0.5 flex items-center gap-1.5 justify-center">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                {t("Live Sync", "සජීවීව සම්බන්ධයි")}
              </span>
            </div>
          </div>

          {/* Key Indicators Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Today's Sales */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-md p-5 flex items-center justify-between relative overflow-hidden group">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-[#DAA520] opacity-80" />
              <div className="text-left">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{t("Gross Sales (Today)", "මුළු දෛනික විකුණුම්")}</p>
                <p className="text-2xl font-black text-slate-800 tracking-tight">{symbol} {stats.revenue.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                <span className="text-[9px] font-black text-slate-400">{stats.orders} {t("orders processed", "ඇණවුම් සංඛ්‍යාව")}</span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-[#DAA520]/10 text-[#DAA520] flex items-center justify-center shrink-0">
                <ShoppingCartIcon className="w-6 h-6" />
              </div>
            </div>

            {/* Today's Profit */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-md p-5 flex items-center justify-between relative overflow-hidden group">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-emerald-500 opacity-80" />
              <div className="text-left">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{t("Gross Profit (Net Sales - COGS)", "දෛනික ශුද්ධ ලාභය")}</p>
                <p className="text-2xl font-black text-emerald-600 tracking-tight">{symbol} {todayProfit.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                <span className="text-[9px] font-black text-[#DAA520] bg-[#DAA520]/10 px-1.5 py-0.5 rounded-lg">{t("Est. net profit today", "ඇස්තමේන්තුගත ශුද්ධ ලාභය")}</span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-500 flex items-center justify-center shrink-0">
                <span className="font-black text-sm text-emerald-600">Rs.</span>
              </div>
            </div>

            {/* Low Stock Warns */}
            <div
              onClick={() => onNavigate && onNavigate('inventory')}
              className="bg-white rounded-2xl border border-gray-100 shadow-md p-5 flex items-center justify-between relative overflow-hidden group cursor-pointer hover:shadow-lg transition-all"
            >
              <div className="absolute top-0 left-0 h-1.5 w-full bg-red-500 opacity-80" />
              <div className="text-left">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{t("Low Stock Warning", "අඩු තොග අනතුරු ඇඟවීම්")}</p>
                <p className="text-2xl font-black text-slate-800 tracking-tight">{stats.lowStock} {t("Items", "භාණ්ඩ")}</p>
                <span className="text-[9px] font-black text-red-500 animate-pulse">{t("Needs restocking attention", "නැවත තොග පිරවීම අවශ්‍යයි")}</span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-red-50 text-red-500 flex items-center justify-center shrink-0">
                <PackageIcon className="w-6 h-6" />
              </div>
            </div>

            {/* Cash Balance */}
            <div
              onClick={() => onNavigate && onNavigate('reports')}
              className="bg-white rounded-2xl border border-gray-100 shadow-md p-5 flex items-center justify-between relative overflow-hidden group cursor-pointer hover:shadow-lg transition-all"
            >
              <div className="absolute top-0 left-0 h-1.5 w-full bg-blue-500 opacity-80" />
              <div className="text-left">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{t("Cash Drawable Balance", "ලැබිය හැකි ශුද්ධ මුදල් ශේෂය")}</p>
                <p className="text-2xl font-black text-slate-800 tracking-tight">{symbol} {cashBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}</p>
                <span className="text-[9px] font-black text-slate-400">{t("Total revenue minus non-paid credit orders", "මුළු ආදායමෙන් නොගෙවූ ණය ඇණවුම් අඩු කළ පසු")}</span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
                <span className="font-black text-sm text-blue-600">Rs.</span>
              </div>
            </div>

            {/* Supplier alerts */}
            <div
              onClick={() => onNavigate && onNavigate('purchasing')}
              className="bg-white rounded-2xl border border-gray-100 shadow-md p-5 flex items-center justify-between relative overflow-hidden group col-span-1 sm:col-span-2 cursor-pointer hover:shadow-lg transition-all"
            >
              <div className="absolute top-0 left-0 h-1.5 w-full bg-[#464646] opacity-80" />
              <div className="text-left flex-1">
                <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">{t("Supplier Alerts", "සැපයුම්කරුවන්ගේ අනතුරු ඇඟවීම්")}</p>
                <p className="text-lg font-black text-[#464646]">{pendingPOs} {t("Pending Purchase Orders", "නොවිසඳුනු ගැනුම් ඇණවුම්")}</p>
                <span className="text-[9px] font-black text-slate-400">{t("Active purchase workflow pending check-in", "ක්‍රියාකාරී ගැනුම් පිරික්සුම්")}</span>
              </div>
              <div className="w-12 h-12 rounded-xl bg-[#464646]/10 text-[#464646] flex items-center justify-center shrink-0">
                <AlertTriangleIcon className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Quick Recent Sales Feed */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-md p-5 text-left">
            <h3 className="text-xs font-black uppercase tracking-wider text-[#464646] mb-4">{t("Recent Operations Feed", "මෑතකාලීන ගනුදෙනු ලැයිස්තුව")}</h3>
            <div className="space-y-3">
              {recentSales.slice(0, 3).map(sale => (
                <div key={sale.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100 shadow-inner">
                  <div className="text-left">
                    <p className="text-xs font-black text-slate-800">{sale.invoice_no}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">{sale.customerName || sale.customer_name || 'Guest'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-black text-slate-900">{symbol} {(sale.total_amount || sale.total || 0).toLocaleString()}</p>
                    <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded border mt-1 inline-block ${statusColors[sale.status] || 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                      {sale.status}
                    </span>
                  </div>
                </div>
              ))}
              {recentSales.length === 0 && (
                <p className="text-xs text-center text-slate-400 font-bold py-4">{t("No operations logged.", "ගනුදෙනු කිසිවක් සිදු වී නොමැත.")}</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Premium Dashboard Welcome Banner */}
          <div className="bg-gradient-to-r from-[#2c2c2c] to-[#464646] rounded-3xl border border-[#DAA520]/20 shadow-[0_10px_30px_rgba(0,0,0,0.08)] p-8 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
            <div className="absolute w-[500px] h-[500px] bg-[#DAA520]/5 rounded-full blur-[80px] -top-64 -right-32 pointer-events-none" />
            <div className="flex items-center gap-6 relative z-10">
              <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center border border-white/10 shadow-xl p-2 shrink-0 animate-pulse">
                <img 
                  src="./images/logo.png" 
                  alt="Hardware Logo" 
                  className="w-full h-full object-contain"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>
              <div className="text-left">
                <h1 className="text-3xl font-black text-white leading-tight">
                  Welcome to <span className="text-[#DAA520]">Muthuwadige Hardware</span>
                </h1>
                <p className="text-sm font-bold text-gray-300 mt-2 max-w-xl">
                  System Dashboard is fully online. Explore live sales statistics, loyalty metrics, and stock warnings.
                </p>
              </div>
            </div>
            <div className="relative z-10 shrink-0 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-4 px-6 text-center">
              <span className="text-[10px] font-black text-[#DAA520] uppercase tracking-widest block">Local Server Status</span>
              <span className="text-sm font-black text-emerald-400 mt-1 flex items-center justify-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Connected & Syncing
              </span>
            </div>
          </div>

          {/* Premium Custom Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
            
            {/* Stat Card 1: Gross Sales (Today) */}
            <div className="bg-white rounded-3xl border border-gray-100/80 shadow-md p-6 flex items-center justify-between hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 relative overflow-hidden group">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-[#DAA520] opacity-80" />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t('Gross Sales (Today)', 'මුළු දෛනික විකුණුම්')}</p>
                <p className="text-2xl font-black text-slate-800 tracking-tight">{symbol} {stats.grossSales.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                <span className="inline-flex items-center gap-1 mt-3.5 text-[10px] font-black text-[#DAA520] bg-[#DAA520]/10 px-2 py-1 rounded-xl">
                  <TrendingUpIcon className="w-3.5 h-3.5" /> Sticker / Listed Value
                </span>
              </div>
              <div className="w-14 h-14 rounded-2xl bg-[#DAA520]/10 text-[#DAA520] flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform duration-300">
                <span className="font-black text-sm text-amber-600">Rs.</span>
              </div>
            </div>

            {/* Stat Card 2: Net Sales Revenue (Today) */}
            <div className="bg-white rounded-3xl border border-gray-100/80 shadow-md p-6 flex items-center justify-between hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 relative overflow-hidden group">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-emerald-500 opacity-80" />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t('Net Sales Revenue (Today)', 'ශුද්ධ දෛනික විකුණුම් ආදායම')}</p>
                <p className="text-2xl font-black text-emerald-700 tracking-tight">{symbol} {stats.netSales.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                <span className="inline-flex items-center gap-1 mt-3.5 text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-xl">
                  <TrendingUpIcon className="w-3.5 h-3.5" /> Gross - Deductions + Fees
                </span>
              </div>
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform duration-300">
                <span className="font-black text-sm text-emerald-600">Rs.</span>
              </div>
            </div>

            {/* Stat Card 3: Cost of Goods Sold (COGS) */}
            <div className="bg-white rounded-3xl border border-gray-100/80 shadow-md p-6 flex items-center justify-between hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 relative overflow-hidden group">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-rose-500 opacity-80" />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t('Cost of Goods Sold (COGS)', 'විකිණූ භාණ්ඩවල පිරිවැය')}</p>
                <p className="text-2xl font-black text-slate-800 tracking-tight">{symbol} {stats.cogs.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                <span className="inline-flex items-center gap-1 mt-3.5 text-[10px] font-black text-rose-600 bg-rose-50 px-2 py-1 rounded-xl">
                  <PackageIcon className="w-3.5 h-3.5" /> Historical Cost Snapshot
                </span>
              </div>
              <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform duration-300">
                <PackageIcon className="w-7 h-7" />
              </div>
            </div>

            {/* Stat Card 4: Gross Profit (Net Sales - COGS) */}
            <div className="bg-white rounded-3xl border border-gray-100/80 shadow-md p-6 flex items-center justify-between hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 relative overflow-hidden group">
              <div className={`absolute top-0 left-0 h-1.5 w-full opacity-80 ${stats.profit >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t('Gross Profit (Net Sales - COGS)', 'දෛනික ශුද්ධ ලාභය')}</p>
                <p className={`text-2xl font-black tracking-tight ${stats.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{symbol} {stats.profit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
                <span className={`inline-flex items-center gap-1 mt-3.5 text-[10px] font-black px-2 py-1 rounded-xl ${stats.profit >= 0 ? 'text-emerald-600 bg-emerald-50' : 'text-rose-600 bg-rose-50'}`}>
                  <TrendingUpIcon className="w-3.5 h-3.5" /> Net Sales - COGS
                </span>
              </div>
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform duration-300 ${stats.profit >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500'}`}>
                <TrendingUpIcon className="w-7 h-7" />
              </div>
            </div>

            {/* Stat Card 5: Orders Today */}
            <div className="bg-white rounded-3xl border border-gray-100/80 shadow-md p-6 flex items-center justify-between hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 relative overflow-hidden group">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-[#464646] opacity-80" />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t('Orders Today', 'අද දින ඇණවුම්')}</p>
                <p className="text-2xl font-black text-slate-800 tracking-tight">{stats.orders}</p>
                <span className="inline-flex items-center gap-1 mt-3.5 text-[10px] font-black text-[#464646] bg-[#464646]/10 px-2 py-1 rounded-xl">
                  <ShoppingCartIcon className="w-3.5 h-3.5" /> {t('Processed Invoices', 'සකසන ලද ඉන්වොයිසි')}
                </span>
              </div>
              <div className="w-14 h-14 rounded-2xl bg-[#464646]/10 text-[#464646] flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform duration-300">
                <ShoppingCartIcon className="w-7 h-7" />
              </div>
            </div>

            {/* Stat Card 6: Low Stock Alerts */}
            <div className="bg-white rounded-3xl border border-gray-100/80 shadow-md p-6 flex items-center justify-between hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 relative overflow-hidden group">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-red-500 opacity-80" />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t('Low Stock Items', 'අඩු තොග භාණ්ඩ')}</p>
                <p className="text-2xl font-black text-slate-800 tracking-tight">{stats.lowStock}</p>
                <span className={`inline-flex items-center gap-1 mt-3.5 text-[10px] font-black px-2 py-1 rounded-xl ${stats.lowStock > 0 ? 'text-red-600 bg-red-50 border border-red-100' : 'text-emerald-600 bg-emerald-50 border border-emerald-100'}`}>
                  <AlertTriangleIcon className="w-3.5 h-3.5" /> {stats.lowStock > 0 ? 'Needs Attention' : 'All Stocked'}
                </span>
              </div>
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform duration-300 ${stats.lowStock > 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'}`}>
                <PackageIcon className="w-7 h-7" />
              </div>
            </div>

            {/* Stat Card 7: Customers */}
            <div className="bg-white rounded-3xl border border-gray-100/80 shadow-md p-6 flex items-center justify-between hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 relative overflow-hidden group">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-[#DAA520] opacity-80" />
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">{t('Customers', 'පාරිභෝගිකයින්')}</p>
                <p className="text-2xl font-black text-slate-800 tracking-tight">{stats.customers}</p>
                <span className="inline-flex items-center gap-1 mt-3.5 text-[10px] font-black text-[#DAA520] bg-[#DAA520]/10 px-2 py-1 rounded-xl">
                  <UsersIcon className="w-3.5 h-3.5" /> {t('Registered Entities', 'ලියාපදිංචි පාරිභෝගිකයින්')}
                </span>
              </div>
              <div className="w-14 h-14 rounded-2xl bg-[#DAA520]/10 text-[#DAA520] flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform duration-300">
                <UsersIcon className="w-7 h-7" />
              </div>
            </div>
          </div>

          {/* Graphical Analytics Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            
            {/* Sales Trend Chart */}
            <div className="xl:col-span-2 bg-white rounded-3xl shadow-md border border-gray-100/80 p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="text-left">
                  <h2 className="text-base font-black text-[#464646] uppercase tracking-wider">Sales Trend</h2>
                  <p className="text-xs font-bold text-gray-400 mt-1">Last 6 months business revenue ({symbol})</p>
                </div>
                <div className={`flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-xl ${growthPercent >= 0 ? 'text-[#DAA520] bg-[#DAA520]/10' : 'text-red-500 bg-red-50'}`}>
                  {growthPercent >= 0 ? <TrendingUpIcon className="w-4 h-4" /> : <TrendingDownIcon className="w-4 h-4" />}
                  {growthPercent >= 0 ? '+' : ''}{growthPercent.toFixed(1)}% vs prev month
                </div>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={salesTrend}>
                  <defs>
                    <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#DAA520" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#DAA520" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f8fafc" vertical={false} />
                  <XAxis 
                    dataKey="month" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#9ca3af', fontWeight: 'bold' }} 
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#9ca3af', fontWeight: 'bold' }}
                    tickFormatter={(v) => `${symbol}${(v / 1000).toFixed(0)}k`} 
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: '16px', border: '1px solid #f1f5f9', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)', fontWeight: 'bold', color: '#464646' }}
                    formatter={(value: number) => [`${symbol} ${value.toLocaleString()}`, 'Revenue']}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="#DAA520" 
                    strokeWidth={3} 
                    fill="url(#salesGradient)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Sales by Category Chart */}
            <div className="bg-white rounded-3xl shadow-md border border-gray-100/80 p-6 flex flex-col justify-between">
              <div className="text-left mb-4">
                <h2 className="text-base font-black text-[#464646] uppercase tracking-wider">Sales by Category</h2>
                <p className="text-xs font-bold text-gray-400 mt-1">Current Month Share Breakdown</p>
              </div>
              <div className="relative flex items-center justify-center flex-1 min-h-[220px]">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={salesByCategory}
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={6}
                      dataKey="value"
                    >
                      {salesByCategory.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={themeColors[index % themeColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '16px', border: '1px solid #f1f5f9', fontWeight: 'bold', color: '#464646' }} />
                    <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', color: '#9ca3af' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Grid: Recent Sales & Low Stock Alerts */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            
            {/* Recent Sales */}
            <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden text-left flex flex-col">
              <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-white">Recent Sales</h3>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Live store invoices and transaction states</p>
                </div>
                
                <div className="flex items-center gap-3">
                  <span className="px-2.5 py-1 bg-amber-500/20 text-amber-400 text-[10px] font-black rounded-full border border-amber-500/30 whitespace-nowrap">
                    {recentSales.length} Orders
                  </span>
                  <button 
                    onClick={() => onNavigate && onNavigate('sales', 'history')}
                    className="px-3 py-1.5 border border-slate-700 hover:border-slate-500 rounded-xl text-[10px] font-black text-slate-300 hover:text-white transition-all uppercase tracking-widest bg-slate-800/40 hover:bg-slate-800"
                  >
                    View all
                  </button>
                </div>
              </div>
              
              <div className="overflow-x-auto p-4 flex-1">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="bg-slate-50 text-slate-400 text-[10px] uppercase font-black tracking-widest border-b border-slate-100">
                      <th className="py-3 px-4 rounded-l-lg">Invoice</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-4 text-center rounded-r-lg">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentSales.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-slate-400 font-bold text-sm">No recent sales records found.</td>
                      </tr>
                    ) : (
                      recentSales.map((order) => (
                        <tr key={order.id} className="hover:bg-amber-50/10 transition-colors group">
                          <td className="py-3.5 px-4 font-black text-slate-800 font-mono text-xs">{order.invoice_no}</td>
                          <td className="py-3.5 px-4 font-bold text-slate-700">
                            {order.customerName || order.customer_name || 'Guest'}
                          </td>
                          <td className="py-3.5 px-4 font-bold text-slate-500 text-xs">
                            {new Date(order.created_at || order.date).toLocaleDateString()}
                          </td>
                          <td className="py-3.5 px-4 text-right font-black text-slate-800">
                            {symbol} {(order.total_amount || order.total || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span className={`inline-flex px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider ${statusColors[order.status] || 'bg-slate-50 text-slate-500 border border-slate-200'}`}>
                              {order.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Low Stock Alerts */}
            <div className="bg-white rounded-3xl shadow-md border border-gray-100/80 p-6 text-left">
              <div className="flex items-center gap-2 mb-6">
                <AlertTriangleIcon className="w-5 h-5 text-red-500" />
                <h2 className="text-base font-black text-[#464646] uppercase tracking-wider">Low Stock Alerts</h2>
              </div>
              
              {lowStockItems.length === 0 ? (
                <div className="text-center py-16">
                  <PackageIcon className="w-14 h-14 mx-auto mb-3 text-gray-200" />
                  <p className="text-sm text-gray-400 font-bold">All inventory items well stocked.</p>
                </div>
              ) : (
                <div className="space-y-3.5 overflow-y-auto max-h-[310px] pr-2 custom-scrollbar">
                  {lowStockItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-3.5 bg-red-50/30 rounded-2xl border border-red-100 group hover:border-red-200 hover:bg-red-50/60 transition-all">
                      <div className="min-w-0 flex-1 text-left">
                        <p className="text-sm font-black text-slate-800 truncate">{item.name}</p>
                        <p className="text-[9px] text-red-500 font-black uppercase tracking-widest mt-1">
                          {formatStock(item.stock, item.unit)} {item.unit || 'pcs'} left • Min {item.minStock !== undefined ? item.minStock : item.min_stock !== undefined ? item.min_stock : 10}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleReorderClick(item)}
                          className="bg-white text-[#464646] text-[9px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border border-gray-200 hover:bg-[#DAA520] hover:text-white hover:border-[#DAA520] transition-all shadow-sm hover:shadow"
                        >
                          Reorder
                        </button>
                        <button 
                          onClick={() => handleWhatsAppAlert(item)}
                          className="bg-emerald-50 text-emerald-700 text-[9px] font-black uppercase tracking-widest px-3 py-2 rounded-xl border border-emerald-200 hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all shadow-sm hover:shadow flex items-center gap-1 cursor-pointer"
                          title="Send WhatsApp alert to supplier"
                        >
                          <MessageSquareIcon className="w-3 h-3" /> WhatsApp
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reorder Restock Modal */}
      <Modal isOpen={showReorderModal} onClose={() => setShowReorderModal(false)} title={`Reorder Product - ${selectedProduct?.name}`} size="sm">
        <div className="space-y-6">
          <div className="bg-gray-50 rounded-2xl p-6 text-center border border-gray-100 shadow-inner">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Current Stock level</p>
            <p className="text-4xl font-black text-[#464646]">
              {formatStock(selectedProduct?.stock, selectedProduct?.unit)} <span className="text-sm text-gray-400 uppercase tracking-widest">{selectedProduct?.unit || 'pcs'}</span>
            </p>
            <p className="text-[10px] text-red-500 font-black uppercase tracking-widest mt-2">
              Warning threshold: {selectedProduct?.minStock !== undefined ? selectedProduct.minStock : selectedProduct?.min_stock !== undefined ? selectedProduct.min_stock : 10}
            </p>
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-2 tracking-widest">Reorder Restock Quantity</label>
            <input 
              type="number" 
              min={1} 
              autoFocus 
              value={reorderQty} 
              onChange={(e) => setReorderQty(parseInt(e.target.value) || 1)} 
              className="w-full px-4 py-4 border border-gray-200 rounded-2xl text-xl font-black text-[#464646] text-center outline-none focus:ring-4 focus:ring-[#DAA520]/20" 
            />
          </div>

          {modalError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3.5 rounded-xl text-xs font-bold flex items-center gap-2.5 animate-in fade-in duration-300">
              <AlertTriangleIcon className="w-5 h-5 shrink-0 text-red-500" />
              <span>{modalError}</span>
            </div>
          )}

          <div className="flex flex-col gap-3 pt-2">
            <button 
              onClick={handleReorderConfirm} 
              disabled={isSaving || reorderQty <= 0}
              className="w-full py-4 text-xs font-black text-white bg-emerald-500 hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 disabled:bg-gray-200 disabled:text-gray-300 disabled:shadow-none rounded-2xl transition-all uppercase tracking-widest flex items-center justify-center gap-2"
            >
              {isSaving ? <Loader2Icon className="animate-spin w-4 h-4" /> : null}
              Confirm Reorder restock
            </button>
            <button 
              onClick={() => setShowReorderModal(false)} 
              className="w-full py-3.5 text-[10px] font-black text-gray-400 hover:bg-gray-100 rounded-2xl uppercase tracking-widest transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </Modal>

      {/* Floating Success Toast Card */}
      {toast && (
        <div className={`fixed top-5 right-5 z-[9999] max-w-sm w-full bg-white rounded-2xl border p-4 shadow-xl flex items-start gap-3.5 animate-in slide-in-from-top-5 duration-300 ${
          toast.type === 'success' ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'
        }`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
            toast.type === 'success' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'
          }`}>
            {toast.type === 'success' ? <CheckCircleIcon className="w-4 h-4" /> : <AlertTriangleIcon className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-black ${toast.type === 'success' ? 'text-emerald-800' : 'text-red-800'}`}>
              {toast.type === 'success' ? 'Success' : 'Notification'}
            </p>
            <p className="text-xs text-gray-500 font-bold mt-1 leading-relaxed">{toast.message}</p>
          </div>
          <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-600">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}