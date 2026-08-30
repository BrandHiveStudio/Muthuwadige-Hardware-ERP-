import React, { useState, useEffect } from 'react';
import {
  DollarSignIcon,
  PlusIcon,
  SearchIcon,
  ArrowUpRightIcon,
  ArrowDownRightIcon,
  FileTextIcon,
  PrinterIcon,
  Loader2Icon,
  CheckCircleIcon
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { supabase } from '../lib/supabaseClient';
import { useCurrency } from '../context/CurrencyContext';
import { jsPDF } from 'jspdf';
import XLSX from 'xlsx-js-style';
import { calculateNetSalesRevenue } from '../utils/accounting';

interface Transaction {
  id: string;
  type: 'income' | 'expense';
  category: string;
  description: string;
  amount: number;
  date: string;
  reference: string;
  createdAt?: string;
}

const emptyTransaction: Omit<Transaction, 'id'> = {
  type: 'expense',
  category: 'Utilities',
  description: '',
  amount: 0,
  date: new Date().toLocaleDateString('sv-SE'),
  reference: ''
};

export function Finance() {
  const { currency, exchangeRate = 300 } = useCurrency();
  const symbol = 'Rs.';

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense' | 'contra_revenue' | 'sales_return'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewVoucher, setViewVoucher] = useState<Transaction | null>(null);
  const [formData, setFormData] = useState<Omit<Transaction, 'id'>>(emptyTransaction);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [filterPeriodType, setFilterPeriodType] = useState<'all' | 'day' | 'month'>('all');
  const [filterDate, setFilterDate] = useState(new Date().toLocaleDateString('sv-SE'));
  const [filterMonth, setFilterMonth] = useState(new Date().toLocaleDateString('sv-SE').slice(0, 7));

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('transactions')
        .select('*');
      
      if (data) {
        setTransactions(data);
      }
    } catch (error) {
      console.error("Error loading transactions:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const handleRefresh = () => fetchData();
    window.addEventListener('refresh-all-data', handleRefresh);
    window.addEventListener('refresh-finance', handleRefresh);
    return () => {
      window.removeEventListener('refresh-all-data', handleRefresh);
      window.removeEventListener('refresh-finance', handleRefresh);
    };
  }, []);

  const convert = (val: number) => val;

  const isSalesReturnTrans = (t: any) => {
    if (!t) return false;
    const type = (t.type || '').toLowerCase();
    const cat = (t.category || '').toLowerCase();
    return type === 'contra_revenue' || type === 'sales_return' || cat.startsWith('sales return') || cat === 'exchange refund';
  };

  const filtered = transactions.filter((t) => {
    const matchesSearch = t.description.toLowerCase().includes(search.toLowerCase()) || 
                          t.reference.toLowerCase().includes(search.toLowerCase()) ||
                          t.category.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === 'all' || 
                        t.type === typeFilter ||
                        (typeFilter === 'contra_revenue' && isSalesReturnTrans(t)) ||
                        (typeFilter === 'expense' && t.type === 'expense' && !isSalesReturnTrans(t));
    const matchesCategory = categoryFilter === 'all' || 
                            t.category === categoryFilter ||
                            (categoryFilter === 'Purchase' && t.category === 'Purchases');
    
    let matchesPeriod = true;
    if (filterPeriodType === 'day') {
      matchesPeriod = t.date === filterDate;
    } else if (filterPeriodType === 'month') {
      matchesPeriod = t.date.startsWith(filterMonth);
    }
    
    return matchesSearch && matchesType && matchesCategory && matchesPeriod;
  });

  const isCreditAdjustmentTrans = (t: any) => {
    const cat = (t.category || '').toLowerCase();
    const desc = (t.description || '').toLowerCase();
    return cat.includes('credit adjustment') || desc.includes('credit return') || desc.includes('credit adjustment');
  };

  const totalIncome = filtered.filter(t => t.type === 'income').reduce((sum, t) => sum + (t.amount || 0), 0);
  const totalSalesReturns = filtered.filter(t => isSalesReturnTrans(t)).reduce((sum, t) => sum + (t.amount || 0), 0);
  const netSalesIncome = calculateNetSalesRevenue(totalIncome, 0, totalSalesReturns, 0);
  const totalExpense = filtered.filter(t => t.type === 'expense' && !isSalesReturnTrans(t)).reduce((sum, t) => sum + (t.amount || 0), 0);
  const cashSalesReturns = filtered.filter(t => isSalesReturnTrans(t) && !isCreditAdjustmentTrans(t)).reduce((sum, t) => sum + (t.amount || 0), 0);
  const cashBalance = totalIncome - cashSalesReturns - totalExpense;

  const openAdd = () => {
    setFormData(emptyTransaction);
    setShowAddModal(true);
  };

  const handleSave = async () => {
    if (!formData.description.trim()) {
      setToast({ message: "Description details are required.", type: 'error' });
      return;
    }
    if (formData.amount <= 0) {
      setToast({ message: "Transaction amount must be greater than zero.", type: 'error' });
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const payload = {
        type: formData.type,
        category: formData.category,
        description: formData.description,
        amount: formData.amount,
        date: formData.date,
        reference: formData.reference || `TX-${Date.now().toString().slice(-5)}`,
        user_id: user?.id || null
      };

      const { error } = await supabase.from('transactions').insert([payload]);
      if (error) throw error;

      setToast({ message: "Transaction logged successfully", type: 'success' });
      setShowAddModal(false);
      fetchData();
    } catch (error: any) {
      setToast({ message: "Error saving transaction: " + error.message, type: 'error' });
    }
  };

  const categories = [
    'Sales', 'Purchase'
  ];

  // PDF Voucher generator
  const downloadVoucherPDF = (t: Transaction) => {
    const doc = new jsPDF({ format: 'a5', orientation: 'landscape' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const gold = [218, 165, 32] as [number, number, number];
    const darkSilver = [70, 70, 70] as [number, number, number];

    // Banner header
    doc.setFillColor(darkSilver[0], darkSilver[1], darkSilver[2]);
    doc.rect(0, 0, pageWidth, 25, 'F');

    // Title
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(t.type === 'income' ? 'RECEIPT VOUCHER' : 'PAYMENT VOUCHER', 10, 16);

    // Date/No
    doc.setFontSize(9);
    doc.text(`Date: ${t.date}`, pageWidth - 50, 12);
    doc.text(`Voucher No: V-${t.id.slice(-6).toUpperCase()}`, pageWidth - 50, 18);

    // Business Name
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(11);
    doc.text("MUTHUWADIGE HARDWARE", 10, 35);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text("No: 80, Mahahunupitiya, Negombo", 10, 40);

    // Boxed Content
    doc.setDrawColor(220, 220, 220);
    doc.rect(10, 46, pageWidth - 20, 48);

    doc.setFont('helvetica', 'bold');
    doc.text("Category:", 15, 54);
    doc.text("Reference / Job:", 15, 62);
    doc.text("Description Detail:", 15, 70);

    doc.setFont('helvetica', 'normal');
    doc.text(t.category, 45, 54);
    doc.text(t.reference || 'None', 45, 62);
    doc.text(t.description, 45, 70, { maxWidth: pageWidth - 65 });

    // Amount box
    doc.setFillColor(245, 245, 245);
    doc.rect(15, 80, pageWidth - 30, 10, 'F');
    doc.setFont('helvetica', 'bold');
    doc.text("Total Settled:", 20, 86.5);
    doc.setTextColor(gold[0], gold[1], gold[2]);
    doc.text(`${symbol} ${t.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, pageWidth - 45, 86.5);

    // Signatures
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(7.5);
    doc.line(15, 120, 60, 120);
    doc.text("Prepared By", 30, 124, { align: 'center' });

    doc.line(pageWidth - 60, 120, pageWidth - 15, 120);
    doc.text("Received / Approved By", pageWidth - 37.5, 124, { align: 'center' });

    doc.save(`Voucher_${t.type === 'income' ? 'Receipt' : 'Payment'}_${t.id.slice(-6).toUpperCase()}.pdf`);
  };

  const downloadReportPDF = () => {
    const doc = new jsPDF({ format: 'a4', orientation: 'portrait' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const gold = [218, 165, 32] as [number, number, number];
    const darkSilver = [70, 70, 70] as [number, number, number];

    // Header Banner
    doc.setFillColor(darkSilver[0], darkSilver[1], darkSilver[2]);
    doc.rect(0, 0, pageWidth, 40, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text("FINANCIAL SUMMARY REPORT", 15, 25);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    let periodText = "All Time";
    if (filterPeriodType === 'day') periodText = `Day: ${filterDate}`;
    else if (filterPeriodType === 'month') periodText = `Month: ${filterMonth}`;
    doc.text(`Report Period: ${periodText}`, pageWidth - 70, 25);

    // Business details
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text("MUTHUWADIGE HARDWARE", 15, 55);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text("No: 80, Mahahunupitiya, Negombo | Phone: 077 076 076 7", 15, 60);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 15, 65);

    // Summary Cards block in PDF
    doc.setDrawColor(230, 230, 230);
    doc.setFillColor(248, 249, 250);
    doc.rect(15, 72, pageWidth - 30, 30, 'FD');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text("Total Income:", 20, 82);
    doc.text("Total Expenses:", 20, 90);
    doc.text("Net Cash Flow Balance:", 20, 98);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(16, 185, 129); // green
    doc.text(`${symbol} ${convert(totalIncome).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 70, 82);
    doc.setTextColor(239, 68, 68); // red
    doc.text(`${symbol} ${convert(totalExpense).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 70, 90);

    doc.setFont('helvetica', 'bold');
    if (cashBalance >= 0) {
      doc.setTextColor(16, 185, 129);
    } else {
      doc.setTextColor(239, 68, 68);
    }
    doc.text(`${symbol} ${convert(cashBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 70, 98);

    // Table Headers
    let y = 115;
    doc.setFillColor(70, 70, 70);
    doc.rect(15, y, pageWidth - 30, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text("Date", 18, y + 5.5);
    doc.text("Type", 42, y + 5.5);
    doc.text("Category", 65, y + 5.5);
    doc.text("Reference", 95, y + 5.5);
    doc.text("Amount", pageWidth - 18, y + 5.5, { align: 'right' });

    y += 8;

    // Table rows
    doc.setTextColor(80, 80, 80);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    filtered.forEach((t, index) => {
      if (y > pageHeight - 20) {
        doc.addPage();
        y = 20;
        // repeat header on next page
        doc.setFillColor(70, 70, 70);
        doc.rect(15, y, pageWidth - 30, 8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text("Date", 18, y + 5.5);
        doc.text("Type", 42, y + 5.5);
        doc.text("Category", 65, y + 5.5);
        doc.text("Reference", 95, y + 5.5);
        doc.text("Amount", pageWidth - 18, y + 5.5, { align: 'right' });
        y += 8;
        doc.setTextColor(80, 80, 80);
        doc.setFont('helvetica', 'normal');
      }

      // Zebra striping
      if (index % 2 === 0) {
        doc.setFillColor(250, 250, 250);
        doc.rect(15, y, pageWidth - 30, 7, 'F');
      }

      doc.text(t.date, 18, y + 5);
      doc.text(t.type.toUpperCase(), 42, y + 5);
      doc.text(t.category, 65, y + 5);
      doc.text(t.reference || '—', 95, y + 5);

      if (t.type === 'income') {
        doc.setTextColor(16, 185, 129);
        doc.text(`+${symbol} ${convert(t.amount).toLocaleString()}`, pageWidth - 18, y + 5, { align: 'right' });
      } else {
        doc.setTextColor(239, 68, 68);
        doc.text(`-${symbol} ${convert(t.amount).toLocaleString()}`, pageWidth - 18, y + 5, { align: 'right' });
      }
      doc.setTextColor(80, 80, 80);
      y += 7;
    });

    doc.save(`Finance_Report_${periodText.replace(/[\s:]/g, '_')}.pdf`);
  };

  const handleExportExcel = () => {
    try {
      const dataToExport = filtered.map(t => ({
        Date: t.date,
        Type: t.type ? t.type.toUpperCase() : 'EXPENSE',
        Category: t.category,
        Description: t.description,
        Reference: t.reference || '—',
        Amount: t.amount
      }));

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Finance');

      // Auto-fit column widths
      const keys = Object.keys(dataToExport[0] || {});
      ws['!cols'] = keys.map(key => {
        let maxLen = key.toString().length;
        dataToExport.forEach(row => {
          const val = (row as any)[key];
          if (val !== null && val !== undefined) {
            const valLen = val.toString().length;
            if (valLen > maxLen) maxLen = valLen;
          }
        });
        return { wch: Math.min(Math.max(maxLen + 4, 12), 40) };
      });

      // Apply gorgeous table formatting (Theme Color Slate: 464646)
      const ref = ws['!ref'];
      if (ref) {
        const range = XLSX.utils.decode_range(ref);
        const themeColor = "464646";
        
        // 1. Style Header Row (Row 0)
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cellRef = XLSX.utils.encode_cell({ r: range.s.r, c: col });
          const cell = ws[cellRef];
          if (cell) {
            cell.s = {
              font: { bold: true, color: { rgb: "FFFFFF" }, name: "Segoe UI", sz: 12.5 },
              fill: { fgColor: { rgb: themeColor } },
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

        // 2. Style Data Rows (alternate backgrounds for zebra-striping, bold values, clear borders)
        for (let row = range.s.r + 1; row <= range.e.r; row++) {
          const isEven = (row % 2 === 0);
          for (let col = range.s.c; col <= range.e.c; col++) {
            const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
            const cell = ws[cellRef];
            if (cell) {
              const bgColor = isEven ? "F8FAFC" : "FFFFFF";
              
              let alignment = "left";
              let isBold = (col === 0);
              let fontColor = "0F172A";

              if (typeof cell.v === 'number') {
                alignment = "right";
                isBold = true;
                cell.z = '#,##0.00';
              }
              
              cell.s = {
                font: { name: "Segoe UI", sz: 11.5, bold: isBold, color: { rgb: fontColor } },
                fill: { fgColor: { rgb: bgColor } },
                alignment: { vertical: "center", horizontal: alignment },
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
      }

      const period = filterPeriodType === 'day' ? filterDate : filterPeriodType === 'month' ? filterMonth : 'AllTime';
      XLSX.writeFile(wb, `Finance_Report_${period}.xlsx`);
    } catch (err: any) {
      setToast({ message: 'Failed to export Excel file: ' + (err?.message || err), type: 'error' });
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 text-left">
      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {/* Net Cash Balance */}
        <div className="bg-[#464646] rounded-2xl shadow-xl p-5 border border-slate-700/10 hover:translate-y-[-2px] transition-all duration-300 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-xl group-hover:scale-110 transition-transform duration-500"></div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Cash Book Balance</p>
              <p className="text-3xl font-black text-white mt-1.5">{symbol} {convert(cashBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="w-12 h-12 bg-white/10 text-white rounded-xl flex items-center justify-center shadow-lg">
              <DollarSignIcon className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-[#DAA520] animate-ping"></span>
            <span>Net cash currently in register</span>
          </div>
        </div>

        {/* Total Cash In */}
        <div className="bg-emerald-600 rounded-2xl shadow-xl p-5 hover:translate-y-[-2px] transition-all duration-300 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-xl group-hover:scale-110 transition-transform duration-500"></div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-white/80 uppercase tracking-widest">Net Cash In (Income)</p>
              <p className="text-3xl font-black text-white mt-1.5">{symbol} {convert(netSalesIncome).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="w-12 h-12 bg-white/20 text-white rounded-xl flex items-center justify-center shadow-lg">
              <ArrowUpRightIcon className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-white/95">
            <span>Gross Inflow: {symbol} {convert(totalIncome).toLocaleString(undefined, { minimumFractionDigits: 2 })} | Refunds: -{symbol} {convert(totalSalesReturns).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Total Cash Out */}
        <div className="bg-red-500 rounded-2xl shadow-xl p-5 hover:translate-y-[-2px] transition-all duration-300 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-xl group-hover:scale-110 transition-transform duration-500"></div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-white/80 uppercase tracking-widest">Total Cash Out (Expenses)</p>
              <p className="text-3xl font-black text-white mt-1.5">{symbol} {convert(totalExpense).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="w-12 h-12 bg-white/20 text-white rounded-xl flex items-center justify-center shadow-lg">
              <ArrowDownRightIcon className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-white/95">
            <span>Purchases</span>
          </div>
        </div>
      </div>

      {/* Filtering Control Bar */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 flex-1 group focus-within:ring-2 focus-within:ring-[#DAA520]/20 transition-all">
            <SearchIcon className="w-4 h-4 text-slate-400 group-focus-within:text-[#DAA520]" />
            <input type="text" placeholder="Find transactions by description or reference..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-transparent text-sm text-slate-700 outline-none w-full" />
          </div>
          
          <select value={typeFilter} onChange={(e: any) => setTypeFilter(e.target.value)} className="px-4 py-2.5 border border-slate-200 bg-white rounded-xl text-sm font-bold text-[#464646] outline-none cursor-pointer">
            <option value="all">All Flow Types</option>
            <option value="income">Income (+)</option>
            <option value="expense">Expense (-)</option>
            <option value="contra_revenue">Contra-Revenue / Return (-)</option>
          </select>

          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-4 py-2.5 border border-slate-200 bg-white rounded-xl text-sm font-bold text-[#464646] outline-none cursor-pointer">
            <option value="all">All Categories</option>
            {categories.map((c, idx) => <option key={idx} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-center justify-between pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <span className="text-xs font-black uppercase tracking-wider text-slate-400">Filter Period:</span>
            <select value={filterPeriodType} onChange={(e: any) => setFilterPeriodType(e.target.value)} className="px-4 py-2 border border-slate-200 bg-white rounded-xl text-xs font-bold text-[#464646] outline-none cursor-pointer">
              <option value="all">All Time</option>
              <option value="day">Specific Day</option>
              <option value="month">Specific Month</option>
            </select>

            {filterPeriodType === 'day' && (
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]"
              />
            )}

            {filterPeriodType === 'month' && (
              <input
                type="month"
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]"
              />
            )}
          </div>

          <div className="flex gap-2 w-full sm:w-auto shrink-0 justify-end">
            <button onClick={downloadReportPDF} className="flex items-center justify-center gap-2 bg-[#464646] hover:bg-[#333333] text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-md">
              <FileTextIcon className="w-4 h-4" /> PDF
            </button>
            <button onClick={handleExportExcel} className="flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-emerald-100 transition-all">
              <FileTextIcon className="w-4 h-4" /> Excel
            </button>
          </div>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden text-left">
        {/* Table Header with gradient */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-white">Cash Book Ledger</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">General financial transaction statements</p>
          </div>
          <span className="px-3 py-1.5 bg-emerald-500/20 text-emerald-400 text-xs font-black rounded-full border border-emerald-500/30">
            {filtered.length} Records
          </span>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-20 text-center text-slate-500">
              <Loader2Icon className="animate-spin w-8 h-8 text-[#DAA520] mx-auto mb-4" />
              <p className="font-bold">Syncing Cash Ledger...</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <tr>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Flow Type</th>
                  <th className="px-6 py-4">Category</th>
                  <th className="px-6 py-4">Description</th>
                  <th className="px-6 py-4">Reference</th>
                  <th className="px-6 py-4 text-right">Amount</th>
                  <th className="px-6 py-4 text-center">Voucher</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-emerald-50/20 transition-colors group">
                    <td className="px-6 py-4 text-slate-600 font-bold">{t.date}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-[9px] font-black rounded-lg uppercase tracking-wider ${
                        t.type === 'income' 
                          ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                          : isSalesReturnTrans(t)
                          ? 'bg-amber-50 text-amber-600 border border-amber-100'
                          : 'bg-red-50 text-red-500 border border-red-100'
                      }`}>
                        {isSalesReturnTrans(t) ? 'Contra-Revenue' : t.type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 text-[9px] font-black bg-blue-50 text-blue-600 rounded-lg uppercase tracking-wider">
                        {t.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-black text-slate-800">{t.description}</td>
                    <td className="px-6 py-4 font-mono font-bold text-slate-500">{t.reference}</td>
                    <td className="px-6 py-4 text-right font-black">
                      <span className={t.type === 'income' ? 'text-emerald-600' : isSalesReturnTrans(t) ? 'text-amber-600' : 'text-red-500'}>
                        {t.type === 'income' ? '+' : '-'} {symbol} {convert(t.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button onClick={() => setViewVoucher(t)} className="p-2.5 rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-200 border border-slate-100 transition-all shadow-sm" title="View / Print Voucher">
                        <FileTextIcon className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-400 font-bold">
                      No matching records found in Cash Book ledger.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Log Transaction Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Log Income or Expense" size="md">
        <div className="space-y-4 text-left p-1">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Transaction Type</label>
            <div className="flex gap-4">
              <button type="button" onClick={() => setFormData({ ...formData, type: 'expense' })} className={`flex-1 py-3 font-bold rounded-xl text-sm border uppercase transition-all ${
                formData.type === 'expense' ? 'bg-red-50 text-red-500 border-red-200 shadow-sm' : 'bg-white border-gray-200 text-gray-400'
              }`}>
                Expense (-)
              </button>
              <button type="button" onClick={() => setFormData({ ...formData, type: 'income' })} className={`flex-1 py-3 font-bold rounded-xl text-sm border uppercase transition-all ${
                formData.type === 'income' ? 'bg-emerald-50 text-emerald-600 border-emerald-200 shadow-sm' : 'bg-white border-gray-200 text-gray-400'
              }`}>
                Income (+)
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Category *</label>
            <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="w-full px-4 py-3 border border-slate-200 bg-white rounded-xl text-sm font-bold text-[#464646] outline-none cursor-pointer">
              {categories.map((c, idx) => <option key={idx} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Amount (Rs.) *</label>
            <input type="number" min={1} value={formData.amount === 0 ? '' : formData.amount} onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-3 border border-gray-200 rounded-xl font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" required />
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Reference / Voucher No</label>
            <input type="text" placeholder="e.g., INV-00923, Bill No 12" value={formData.reference} onChange={(e) => setFormData({ ...formData, reference: e.target.value })} className="w-full px-4 py-3 border border-gray-200 rounded-xl font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Transaction Date</label>
            <input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className="w-full px-4 py-3 border border-gray-200 rounded-xl font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Description details *</label>
            <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Log particulars..." className="w-full px-4 py-3 border border-gray-200 rounded-xl font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520] h-20 resize-none" required />
          </div>

          <div className="flex gap-3 pt-4 border-t border-slate-100">
            <button onClick={() => setShowAddModal(false)} className="flex-1 py-3 bg-gray-100 text-gray-400 font-black uppercase tracking-widest text-xs rounded-xl hover:bg-gray-200 transition-all">Cancel</button>
            <button onClick={handleSave} className="flex-2 py-3 bg-[#DAA520] hover:bg-[#B8860B] text-white font-black uppercase tracking-widest text-xs rounded-xl transition-all shadow-lg">Commit Transaction</button>
          </div>
        </div>
      </Modal>

      {/* View Voucher / Receipt Details Modal */}
      <Modal isOpen={!!viewVoucher} onClose={() => setViewVoucher(null)} title="Voucher Explorer" size="md">
        {viewVoucher && (
          <div className="space-y-6 text-left p-1">
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 relative">
              <span className={`absolute top-4 right-4 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                viewVoucher.type === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
              }`}>
                {viewVoucher.type === 'income' ? 'Receipt Voucher' : 'Payment Voucher'}
              </span>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">MUTHUWADIGE HARDWARE</p>
              <h3 className="text-xl font-black text-slate-800 mt-2">{viewVoucher.category} — V-{viewVoucher.id.slice(-6).toUpperCase()}</h3>
              <p className="text-xs text-gray-500 font-bold mt-1">Logged on {viewVoucher.date}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="col-span-2 space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Description</p>
                <p className="font-bold text-slate-700">{viewVoucher.description}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Reference No</p>
                <p className="font-bold text-slate-700">{viewVoucher.reference || '—'}</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Settled</p>
                <p className="text-lg font-black text-[#DAA520]">{symbol} {convert(viewVoucher.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => downloadVoucherPDF(viewVoucher)} className="flex-1 py-3 bg-[#464646] hover:bg-[#363636] text-white rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 shadow-lg"><PrinterIcon className="w-4 h-4" /> Print PDF</button>
              <button onClick={() => setViewVoucher(null)} className="flex-1 py-3 bg-gray-100 text-gray-500 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-gray-200 transition-all">Dismiss</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className={`flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl border backdrop-blur-md ${
            toast.type === 'success' 
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' 
              : 'bg-red-500/10 border-red-500/20 text-red-600'
          }`}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-lg ${
              toast.type === 'success' ? 'bg-emerald-500 text-white shadow-emerald-500/30' : 'bg-red-500 text-white shadow-red-500/30'
            }`}>
              <CheckCircleIcon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wider opacity-60">System Notification</p>
              <p className="text-sm font-bold text-slate-800 mt-0.5">{toast.message}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
