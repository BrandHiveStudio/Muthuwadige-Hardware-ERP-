import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  SearchIcon,
  PlusIcon,
  TruckIcon,
  DollarSignIcon,
  EditIcon,
  EyeIcon,
  Trash2Icon,
  Loader2Icon,
  CalendarIcon,
  CheckCircleIcon,
  CreditCardIcon,
  Building2Icon,
  FileCheckIcon,
  WalletIcon,
  ArrowDownRightIcon,
  ShieldCheckIcon,
  ReceiptIcon
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { supabase } from '../lib/supabaseClient';
import { api } from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';
import { getTodaySriLankaDate } from '../utils/accounting';

interface Supplier {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  creditTerms: string;
  payableBalance: number;
  createdAt: string;
  nic?: string;
}

const emptySupplier: Omit<Supplier, 'id' | 'createdAt'> = {
  name: '',
  email: '',
  phone: '',
  address: '',
  creditTerms: 'Net 30',
  payableBalance: 0,
  nic: ''
};

const SRI_LANKA_BANKS = [
  'Bank of Ceylon (BOC)',
  'Commercial Bank of Ceylon',
  'Sampath Bank',
  'Hatton National Bank (HNB)',
  'People\'s Bank',
  'Nations Trust Bank (NTB)',
  'Seylan Bank',
  'National Development Bank (NDB)',
  'DFCC Bank',
  'Pan Asia Bank',
  'Union Bank',
  'Standard Chartered Bank',
  'Amana Bank',
  'Other / Direct'
];

export function Suppliers() {
  const { currency } = useCurrency();
  const symbol = 'Rs.';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [viewSupplier, setViewSupplier] = useState<Supplier | null>(null);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
  const [formData, setFormData] = useState<Omit<Supplier, 'id' | 'createdAt'>>(emptySupplier);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);

  // Settle / Payment Modal State
  const [settlingSupplier, setSettlingSupplier] = useState<Supplier | null>(null);
  const [settleAmount, setSettleAmount] = useState<number>(0);
  const [settlePaymentMode, setSettlePaymentMode] = useState<'CASH' | 'BANK' | 'CHEQUE'>('CASH');
  const [settleDate, setSettleDate] = useState<string>(getTodaySriLankaDate());
  const [settleRef, setSettleRef] = useState<string>('');
  const [settleChequeNo, setSettleChequeNo] = useState<string>('');
  const [settleBankName, setSettleBankName] = useState<string>(SRI_LANKA_BANKS[0]);
  const [settleChequeDate, setSettleChequeDate] = useState<string>(getTodaySriLankaDate());
  const [settleNotes, setSettleNotes] = useState<string>('');
  const [isSubmittingSettle, setIsSubmittingSettle] = useState(false);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // 1. Load Suppliers
      const { data: supplierData } = await supabase
        .from('suppliers')
        .select('*');
      
      if (supplierData) {
        const mapped = supplierData.map((s: any) => ({
          id: s.id,
          name: s.name,
          email: s.email || '',
          phone: s.phone || '',
          address: s.address || '',
          creditTerms: s.creditTerms || s.credit_terms || 'Net 30',
          payableBalance: Number(s.payableBalance !== undefined ? s.payableBalance : s.payable_balance || 0),
          nic: s.nic || '',
          createdAt: s.createdAt || s.created_at || ''
        }));
        setSuppliers(mapped);
      }

      // 2. Load Purchase Orders to calculate total purchased
      const { data: poData } = await supabase
        .from('purchase_orders')
        .select('*');
      
      if (poData) {
        setPurchaseOrders(poData);
      }
    } catch (error) {
      console.error("Error loading suppliers or POs:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const handleRefresh = () => fetchData();
    window.addEventListener('refresh-all-data', handleRefresh);
    window.addEventListener('refresh-suppliers', handleRefresh);
    return () => {
      window.removeEventListener('refresh-all-data', handleRefresh);
      window.removeEventListener('refresh-suppliers', handleRefresh);
    };
  }, []);

  // Map total purchases by supplier name (case insensitive)
  const purchasesBySupplier = useMemo(() => {
    const map: Record<string, number> = {};
    purchaseOrders.forEach((po: any) => {
      const nameKey = (po.supplier_name || po.supplierName || '').trim().toLowerCase();
      if (nameKey) {
        map[nameKey] = (map[nameKey] || 0) + Number(po.total || 0);
      }
    });
    return map;
  }, [purchaseOrders]);

  const getTotalPurchased = (supplierName: string) => {
    const key = (supplierName || '').trim().toLowerCase();
    return purchasesBySupplier[key] || 0;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.nic && s.nic.toLowerCase().includes(q)) ||
        s.phone.includes(q) ||
        (s.address && s.address.toLowerCase().includes(q))
    );
  }, [suppliers, search]);

  const totalOutstandingPayables = useMemo(() => {
    return suppliers.reduce((sum, s) => sum + (s.payableBalance > 0 ? s.payableBalance : 0), 0);
  }, [suppliers]);

  const totalLifetimePurchases = useMemo(() => {
    return purchaseOrders.reduce((sum, po) => sum + Number(po.total || 0), 0);
  }, [purchaseOrders]);

  const openAdd = () => {
    setEditingSupplier(null);
    setFormData(emptySupplier);
    setShowAddModal(true);
  };

  const openEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      creditTerms: supplier.creditTerms,
      payableBalance: supplier.payableBalance,
      nic: supplier.nic || ''
    });
    setShowAddModal(true);
  };

  const openSettleModal = (supplier: Supplier) => {
    setSettlingSupplier(supplier);
    setSettleAmount(supplier.payableBalance > 0 ? supplier.payableBalance : 0);
    setSettlePaymentMode('CASH');
    setSettleDate(getTodaySriLankaDate());
    setSettleRef(`PV-${Date.now().toString().slice(-6)}`);
    setSettleChequeNo('');
    setSettleBankName(SRI_LANKA_BANKS[0]);
    setSettleChequeDate(getTodaySriLankaDate());
    setSettleNotes('');
  };

  const handleSave = async () => {
    if (!formData.name || formData.name.trim().length < 2) {
      setToast({ message: "Supplier name must be at least 2 characters.", type: 'error' });
      return;
    }

    try {
      const dbPayload = {
        name: formData.name.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        address: formData.address.trim(),
        credit_terms: formData.creditTerms,
        payable_balance: Number(formData.payableBalance) || 0,
        nic: formData.nic?.trim() || ''
      };

      if (editingSupplier) {
        const { error } = await supabase.from('suppliers').update(dbPayload).eq('id', editingSupplier.id);
        if (error) throw error;
        setToast({ message: "Supplier updated successfully", type: 'success' });
      } else {
        const { error } = await supabase.from('suppliers').insert([dbPayload]);
        if (error) throw error;
        setToast({ message: "Supplier registered successfully", type: 'success' });
      }

      fetchData();
      window.dispatchEvent(new CustomEvent('suppliers-updated'));
      window.dispatchEvent(new CustomEvent('refresh-inventory'));
      window.dispatchEvent(new CustomEvent('refresh-dashboard'));
      setShowAddModal(false);
    } catch (error: any) {
      setToast({ message: "Error saving supplier: " + error.message, type: 'error' });
    }
  };

  const handleExecuteSettlement = async () => {
    if (!settlingSupplier) return;
    if (settleAmount <= 0) {
      setToast({ message: "Settlement amount must be greater than 0.", type: 'error' });
      return;
    }

    if (settlePaymentMode === 'CHEQUE') {
      if (!settleChequeNo.trim()) {
        setToast({ message: "Please enter a valid Cheque Number.", type: 'error' });
        return;
      }
      if (!settleBankName.trim()) {
        setToast({ message: "Please specify the Bank Name.", type: 'error' });
        return;
      }
      if (!settleChequeDate) {
        setToast({ message: "Please specify the Cheque Date.", type: 'error' });
        return;
      }
    }

    setIsSubmittingSettle(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const currentBalance = Number(settlingSupplier.payableBalance || 0);
      const newPayableBalance = Math.max(0, Math.round((currentBalance - settleAmount) * 100) / 100);

      // 1. Reduce Supplier Payable Balance
      const { error: suppError } = await supabase
        .from('suppliers')
        .update({ payable_balance: newPayableBalance })
        .eq('id', settlingSupplier.id);
      
      if (suppError) throw suppError;

      // 2. Handle Cash / Bank / Cheque logging
      if (settlePaymentMode === 'CASH' || settlePaymentMode === 'BANK') {
        const desc = `Supplier Settlement: ${settlingSupplier.name} (${settlePaymentMode === 'CASH' ? 'Cash' : 'Bank Transfer'})`;
        const transPayload = {
          type: 'expense',
          category: 'Supplier Payment',
          description: desc,
          amount: settleAmount,
          date: settleDate || getTodaySriLankaDate(),
          reference: settleRef || `PV-${Date.now().toString().slice(-6)}`,
          user_id: user?.id || null
        };
        const { error: txError } = await supabase.from('transactions').insert([transPayload]);
        if (txError) throw txError;
      } else if (settlePaymentMode === 'CHEQUE') {
        await api.cheques.create({
          direction: 'OUTWARD',
          cheque_type: 'CROSSED_ACCOUNT_PAYEE',
          cheque_number: settleChequeNo.trim(),
          bank_name: settleBankName.trim(),
          cheque_date: settleChequeDate,
          amount: settleAmount,
          party_id: settlingSupplier.id,
          party_name: settlingSupplier.name,
          reference_type: 'EXPENSE',
          reference_id: settlingSupplier.id,
          status: 'PENDING',
          notes: settleNotes.trim() || `Supplier Settlement Voucher ${settleRef} for ${settlingSupplier.name}`
        });
      }

      setToast({
        message: `Settled ${symbol} ${settleAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} for ${settlingSupplier.name} successfully!`,
        type: 'success'
      });

      setSettlingSupplier(null);
      await fetchData();
      window.dispatchEvent(new CustomEvent('suppliers-updated'));
      window.dispatchEvent(new CustomEvent('refresh-finance'));
      window.dispatchEvent(new CustomEvent('refresh-dashboard'));
    } catch (err: any) {
      setToast({ message: "Settlement failed: " + err.message, type: 'error' });
    } finally {
      setIsSubmittingSettle(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) {
      setToast({ message: error.message, type: 'error' });
    } else {
      setToast({ message: "Supplier permanently deleted", type: 'success' });
      setSelectedSupplierIds((prev) => prev.filter((sId) => sId !== id));
      fetchData();
    }
    setSupplierToDelete(null);
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsLoading(true);
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', raw: false });
      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        setToast({ message: "Invalid or corrupt file: No sheets found.", type: 'error' });
        setIsLoading(false);
        if (e.target) e.target.value = '';
        return;
      }

      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }) as any[];

      if (!rawRows || rawRows.length === 0) {
        setToast({ message: "The selected file contains no records.", type: 'error' });
        return;
      }

      let imported = 0;
      let failed = 0;

      const cleanKey = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      const getValueByKeys = (rowObj: any, possibleKeys: string[]) => {
        if (!rowObj || typeof rowObj !== 'object') return '';
        const keys = Object.keys(rowObj);
        for (const pKey of possibleKeys) {
          const targetClean = cleanKey(pKey);
          const matchedKey = keys.find(k => cleanKey(k) === targetClean);
          if (matchedKey && rowObj[matchedKey] !== undefined && rowObj[matchedKey] !== null) {
            const val = String(rowObj[matchedKey]).trim();
            if (val !== '' && val !== 'null' && val !== 'undefined' && val !== '—' && val !== '-') {
              return val;
            }
          }
        }
        return '';
      };

      for (let idx = 0; idx < rawRows.length; idx++) {
        const row = rawRows[idx];

        let name = getValueByKeys(row, [
          'supplier name', 'supplier_name', 'supplier', 'company', 'name', 'vendor',
          'vendor_name', 'vendor name', 'suppliername'
        ]);
        if (!name) {
          name = `Supplier #${idx + 1}`;
        }

        let phone = getValueByKeys(row, [
          'phone', 'phone number', 'phone_number', 'contact', 'contact_no', 'mobile',
          'tel', 'telephone', 'supplierphone', 'phonenumber'
        ]);
        if (/^\d{9}$/.test(phone)) {
          phone = '0' + phone;
        }

        const email = getValueByKeys(row, ['email', 'email_address', 'mail', 'supplieremail', 'supplier_email']);
        const address = getValueByKeys(row, ['address', 'supplier_address', 'supplieraddress', 'location', 'city', 'street']);
        const nic = getValueByKeys(row, ['nic', 'brn', 'reg no', 'reg_no', 'registration', 'registration_no', 'nic_number', 'nicnumber', 'nationalid']);
        const creditTerms = getValueByKeys(row, ['credit terms', 'credit_terms', 'terms', 'payment terms', 'payment_terms']) || 'Net 30';
        
        const rawPayable = getValueByKeys(row, ['payable balance', 'payable_balance', 'balance', 'owed', 'amount_owed']);
        const payableBalance = parseFloat(rawPayable) || 0;

        const dbPayload = {
          name,
          email,
          phone,
          address,
          credit_terms: creditTerms,
          payable_balance: payableBalance,
          nic
        };

        const { error } = await supabase.from('suppliers').insert([dbPayload]);
        if (error) {
          const { error: updateError } = await supabase.from('suppliers').update(dbPayload).eq('name', name);
          if (updateError) {
            failed++;
          } else {
            imported++;
          }
        } else {
          imported++;
        }
      }

      setToast({ 
        message: `Successfully imported/updated ${imported} suppliers! (Failed: ${failed})`, 
        type: imported > 0 ? 'success' : 'error' 
      });

      await fetchData();
      window.dispatchEvent(new CustomEvent('suppliers-updated'));
      window.dispatchEvent(new CustomEvent('refresh-inventory'));
      window.dispatchEvent(new CustomEvent('refresh-dashboard'));
    } catch (err: any) {
      setToast({ message: "Excel import error: " + err.message, type: 'error' });
    } finally {
      setIsLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selectedSupplierIds.includes(s.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedSupplierIds((prev) => prev.filter((id) => !filtered.some((s) => s.id === id)));
    } else {
      setSelectedSupplierIds((prev) => Array.from(new Set([...prev, ...filtered.map((s) => s.id)])));
    }
  };

  const handleToggleSelectSupplier = (supplierId: string) => {
    setSelectedSupplierIds((prev) =>
      prev.includes(supplierId)
        ? prev.filter((id) => id !== supplierId)
        : [...prev, supplierId]
    );
  };

  const handleBulkDelete = async () => {
    if (selectedSupplierIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete the ${selectedSupplierIds.length} selected suppliers?`)) return;
    
    setIsLoading(true);
    try {
      for (const supplierId of selectedSupplierIds) {
        await supabase.from('suppliers').delete().eq('id', supplierId);
      }
      setToast({ message: "Selected suppliers deleted successfully", type: 'success' });
      setSelectedSupplierIds([]);
      fetchData();
    } catch (err: any) {
      setToast({ message: "Failed to delete: " + err.message, type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-500 text-left">
      {/* 3 Executive Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Total Registered Suppliers */}
        <div className="bg-[#464646] rounded-2xl shadow-xl p-5 border border-slate-700/10 hover:translate-y-[-2px] transition-all duration-300 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-xl group-hover:scale-110 transition-transform duration-500"></div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Registered Suppliers</p>
              <p className="text-3xl font-black text-white mt-1.5">{suppliers.length}</p>
            </div>
            <div className="w-12 h-12 bg-white/10 text-white rounded-xl flex items-center justify-center shadow-lg">
              <TruckIcon className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-[#DAA520] animate-ping"></span>
            <span>Active vendor network</span>
          </div>
        </div>

        {/* Total Outstanding Payables */}
        <div className="bg-gradient-to-br from-rose-950/90 to-rose-900 rounded-2xl shadow-xl p-5 border border-rose-700/30 hover:translate-y-[-2px] transition-all duration-300 relative overflow-hidden group text-white">
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full -mr-16 -mt-16 blur-xl group-hover:scale-110 transition-transform duration-500"></div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-rose-200 uppercase tracking-widest">Total Outstanding Payables</p>
              <p className="text-3xl font-black text-rose-100 mt-1.5">
                {symbol} {totalOutstandingPayables.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="w-12 h-12 bg-rose-500/20 text-rose-300 rounded-xl flex items-center justify-center shadow-lg border border-rose-500/30">
              <ArrowDownRightIcon className="w-6 h-6 text-rose-300" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
            <span>Vendor credit liabilities</span>
          </div>
        </div>

        {/* Total Purchases */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl shadow-xl p-5 border border-slate-700/20 hover:translate-y-[-2px] transition-all duration-300 relative overflow-hidden group text-white">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#DAA520]/10 rounded-full -mr-16 -mt-16 blur-xl group-hover:scale-110 transition-transform duration-500"></div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-amber-200/70 uppercase tracking-widest">Lifetime Purchases</p>
              <p className="text-3xl font-black text-[#DAA520] mt-1.5">
                {symbol} {totalLifetimePurchases.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="w-12 h-12 bg-amber-500/20 text-[#DAA520] rounded-xl flex items-center justify-center shadow-lg border border-amber-500/30">
              <ReceiptIcon className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-[#DAA520]"></span>
            <span>{purchaseOrders.length} Purchase orders executed</span>
          </div>
        </div>
      </div>

      {/* Control Actions Panel */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex flex-col xl:flex-row gap-3">
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 flex-1 group focus-within:ring-2 focus-within:ring-[#DAA520]/20 transition-all">
          <SearchIcon className="w-4 h-4 text-slate-400 group-focus-within:text-[#DAA520]" />
          <input 
            type="text" 
            placeholder="Find suppliers by company name, NIC, phone or address..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            className="bg-transparent text-sm text-slate-700 outline-none w-full font-medium" 
          />
        </div>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImportExcel}
          className="hidden"
          accept=".xlsx, .xls, .csv"
        />
        <button 
          onClick={() => fileInputRef.current?.click()} 
          className="flex items-center justify-center gap-2 bg-[#464646] hover:bg-[#363636] text-white px-6 py-2 rounded-xl text-sm font-black uppercase tracking-widest transition-all shadow-lg"
        >
          <PlusIcon className="w-4 h-4" /> Import Excel
        </button>
        <button 
          onClick={openAdd} 
          className="flex items-center justify-center gap-2 bg-[#DAA520] hover:bg-[#B8860B] text-slate-900 px-6 py-2 rounded-xl text-sm font-black uppercase tracking-widest transition-all shadow-lg shadow-[#DAA520]/20"
        >
          <PlusIcon className="w-4 h-4 text-slate-900" /> Add Supplier
        </button>
        {selectedSupplierIds.length > 0 && (
          <button 
            onClick={handleBulkDelete} 
            className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-xl text-sm font-black uppercase tracking-widest transition-all shadow-lg shadow-red-600/20 shrink-0"
          >
            <Trash2Icon className="w-4 h-4" /> Delete Selected ({selectedSupplierIds.length})
          </button>
        )}
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden text-left">
        {/* Table Header with gradient */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-white">Suppliers Registry & Payables Ledger</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Manage partner suppliers, contact files, credit terms, and payable balances</p>
          </div>
          <span className="px-3 py-1.5 bg-[#DAA520]/20 text-[#DAA520] text-xs font-black rounded-full border border-[#DAA520]/30">
            {filtered.length} Suppliers Listed
          </span>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-20 text-center text-slate-500">
              <Loader2Icon className="animate-spin w-8 h-8 text-[#DAA520] mx-auto mb-4" />
              <p className="font-bold">Syncing Suppliers Directory...</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <tr>
                  <th className="px-6 py-4 text-center w-[50px]">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={handleToggleSelectAll}
                      className="rounded border-gray-300 text-[#DAA520] focus:ring-[#DAA520] cursor-pointer w-4 h-4"
                    />
                  </th>
                  <th className="px-6 py-4">Supplier Entity</th>
                  <th className="px-6 py-4">Phone</th>
                  <th className="px-6 py-4">NIC / Reg</th>
                  <th className="px-6 py-4 text-right">Current Payable Balance</th>
                  <th className="px-6 py-4 text-right">Total Purchased</th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((supplier) => {
                  const purchasedVal = getTotalPurchased(supplier.name);
                  const isOwing = supplier.payableBalance > 0;

                  return (
                    <tr key={supplier.id} className="hover:bg-amber-50/30 transition-colors group">
                      <td className="px-6 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedSupplierIds.includes(supplier.id)}
                          onChange={() => handleToggleSelectSupplier(supplier.id)}
                          className="rounded border-gray-300 text-[#DAA520] focus:ring-[#DAA520] cursor-pointer w-4 h-4"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-[#DAA520] to-[#8B6914] text-slate-900 rounded-xl flex items-center justify-center font-black text-sm uppercase shadow-md shadow-amber-100">
                            {supplier.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-black text-slate-900">{supplier.name}</p>
                            <p className="text-[10px] text-gray-400 font-semibold">{supplier.address || 'No address'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-600 font-bold">{supplier.phone || '—'}</td>
                      <td className="px-6 py-4 text-slate-600 font-medium">{supplier.nic || '—'}</td>
                      <td className="px-6 py-4 text-right">
                        {isOwing ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 bg-rose-50 text-rose-700 font-black rounded-lg border border-rose-200 text-xs shadow-sm">
                            {symbol} {supplier.payableBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-50 text-emerald-700 font-bold rounded-lg border border-emerald-200 text-xs">
                            <CheckCircleIcon className="w-3 h-3 text-emerald-600" />
                            {symbol} 0.00
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right font-black text-slate-800">
                        {symbol} {purchasedVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Pay / Settle Button */}
                          <button
                            onClick={() => openSettleModal(supplier)}
                            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-[#DAA520] hover:bg-[#B8860B] text-slate-900 text-xs font-black shadow-sm shadow-amber-500/20 transition-all uppercase tracking-wider"
                            title="Pay / Settle Outstanding Balance"
                          >
                            <WalletIcon className="w-3.5 h-3.5 text-slate-900" />
                            <span>Pay / Settle</span>
                          </button>

                          <button 
                            onClick={() => setViewSupplier(supplier)} 
                            className="p-2 rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-200 border border-slate-100 transition-all shadow-sm" 
                            title="View Profile"
                          >
                            <EyeIcon className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => openEdit(supplier)} 
                            className="p-2 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-200 border border-blue-100 transition-all shadow-sm" 
                            title="Edit Profile"
                          >
                            <EditIcon className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => setSupplierToDelete(supplier)} 
                            className="p-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-500 hover:text-white border border-red-100 transition-all shadow-sm shadow-red-500/10" 
                            title="Delete Profile"
                          >
                            <Trash2Icon className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-400 font-bold">
                      No suppliers registered in this directory.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Settle / Pay Supplier Modal */}
      <Modal 
        isOpen={!!settlingSupplier} 
        onClose={() => setSettlingSupplier(null)} 
        title={`Supplier Payment & Settlement — ${settlingSupplier?.name || ''}`} 
        size="lg"
      >
        {settlingSupplier && (
          <div className="p-2 space-y-5 text-left">
            {/* Header info banner */}
            <div className="bg-slate-900 rounded-2xl p-5 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border border-slate-800">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Supplier Account</p>
                <h3 className="text-lg font-black text-white mt-0.5">{settlingSupplier.name}</h3>
                <p className="text-xs text-slate-400 font-medium">{settlingSupplier.phone || 'No phone'} | {settlingSupplier.address || 'No address'}</p>
              </div>
              <div className="text-right sm:text-right bg-white/10 p-3.5 rounded-xl border border-white/10 w-full sm:w-auto">
                <p className="text-[10px] font-black uppercase tracking-widest text-rose-300">Current Payable Balance</p>
                <p className="text-2xl font-black text-rose-400 mt-0.5">
                  {symbol} {settlingSupplier.payableBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Settlement Amount & Quick Full Settlement */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                  Settlement Amount ({symbol}) *
                </label>
                {settlingSupplier.payableBalance > 0 && (
                  <button
                    type="button"
                    onClick={() => setSettleAmount(settlingSupplier.payableBalance)}
                    className="text-xs font-black text-[#DAA520] hover:text-[#B8860B] underline uppercase tracking-wider"
                  >
                    Full Settlement ({symbol} {settlingSupplier.payableBalance.toLocaleString()})
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-4 top-3 text-sm font-black text-slate-400">{symbol}</span>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  value={settleAmount || ''}
                  onChange={(e) => setSettleAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                  placeholder="0.00"
                  className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-base font-black text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
                />
              </div>
            </div>

            {/* Payment Method Selector */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">
                Settlement Payment Method *
              </label>
              <div className="grid grid-cols-3 gap-3">
                {/* Cash */}
                <button
                  type="button"
                  onClick={() => setSettlePaymentMode('CASH')}
                  className={`p-3.5 rounded-xl border flex flex-col items-center gap-2 transition-all ${
                    settlePaymentMode === 'CASH'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-500/20'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <WalletIcon className="w-5 h-5 text-emerald-600" />
                  <span className="text-xs font-black uppercase">Direct Cash</span>
                </button>

                {/* Bank Transfer */}
                <button
                  type="button"
                  onClick={() => setSettlePaymentMode('BANK')}
                  className={`p-3.5 rounded-xl border flex flex-col items-center gap-2 transition-all ${
                    settlePaymentMode === 'BANK'
                      ? 'bg-blue-50 border-blue-500 text-blue-800 ring-2 ring-blue-500/20'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Building2Icon className="w-5 h-5 text-blue-600" />
                  <span className="text-xs font-black uppercase">Bank Transfer</span>
                </button>

                {/* Outward Cheque */}
                <button
                  type="button"
                  onClick={() => setSettlePaymentMode('CHEQUE')}
                  className={`p-3.5 rounded-xl border flex flex-col items-center gap-2 transition-all ${
                    settlePaymentMode === 'CHEQUE'
                      ? 'bg-amber-50 border-[#DAA520] text-amber-900 ring-2 ring-[#DAA520]/20'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <FileCheckIcon className="w-5 h-5 text-[#DAA520]" />
                  <span className="text-xs font-black uppercase">Outward Cheque</span>
                </button>
              </div>
            </div>

            {/* Conditional Cheque Fields */}
            {settlePaymentMode === 'CHEQUE' && (
              <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200/60 space-y-3 animate-in fade-in duration-300">
                <div className="flex items-center gap-2 text-xs font-black text-amber-800 uppercase tracking-wider">
                  <ShieldCheckIcon className="w-4 h-4 text-[#DAA520]" />
                  <span>Outward Account Payee Cheque Details</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                      Cheque Number *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 000458"
                      value={settleChequeNo}
                      onChange={(e) => setSettleChequeNo(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                      Bank Name *
                    </label>
                    <select
                      value={settleBankName}
                      onChange={(e) => setSettleBankName(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
                    >
                      {SRI_LANKA_BANKS.map((b, i) => (
                        <option key={i} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                      Cheque Date (PDC) *
                    </label>
                    <input
                      type="date"
                      value={settleChequeDate}
                      onChange={(e) => setSettleChequeDate(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Date & Reference Note */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Payment Date
                </label>
                <input
                  type="date"
                  value={settleDate}
                  onChange={(e) => setSettleDate(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Payment Voucher / Ref #
                </label>
                <input
                  type="text"
                  placeholder="PV-001234"
                  value={settleRef}
                  onChange={(e) => setSettleRef(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Settlement Notes (Optional)
              </label>
              <textarea
                rows={2}
                placeholder="Details of the invoices or purchase orders covered..."
                value={settleNotes}
                onChange={(e) => setSettleNotes(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSettlingSupplier(null)}
                className="px-6 py-2.5 text-xs font-black text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingSettle || settleAmount <= 0}
                onClick={handleExecuteSettlement}
                className="flex items-center gap-2 px-8 py-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black shadow-lg shadow-emerald-600/20 transition-all uppercase tracking-widest disabled:opacity-50"
              >
                {isSubmittingSettle ? (
                  <>
                    <Loader2Icon className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="w-4 h-4" />
                    <span>Confirm & Pay {symbol} {settleAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Add/Edit Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title={editingSupplier ? 'Update Supplier Profile' : 'Register New Supplier'} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-1 text-left">
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Company / Supplier Name *</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DAA520] outline-none transition-all font-bold" required />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Phone Number</label>
            <input type="text" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#DAA520] transition-all font-bold" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">NIC / Business Reg No</label>
            <input type="text" value={formData.nic || ''} onChange={(e) => setFormData({ ...formData, nic: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#DAA520] transition-all font-bold" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Email Address</label>
            <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#DAA520] transition-all" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Credit Terms</label>
            <input type="text" value={formData.creditTerms} onChange={(e) => setFormData({ ...formData, creditTerms: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#DAA520] transition-all" placeholder="Net 30, COD, etc." />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Physical Address</label>
            <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#DAA520] transition-all" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-slate-100">
          <button onClick={() => setShowAddModal(false)} className="px-6 py-2.5 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-widest">Cancel</button>
          <button onClick={handleSave} className="px-8 py-2.5 text-sm bg-[#DAA520] hover:bg-[#B8860B] text-slate-900 rounded-xl font-black shadow-lg shadow-amber-100 transition-all uppercase tracking-widest">
            {editingSupplier ? 'Save Changes' : 'Register Supplier'}
          </button>
        </div>
      </Modal>

      {/* View Details Modal */}
      <Modal isOpen={!!viewSupplier} onClose={() => setViewSupplier(null)} title="Supplier Insights" size="md">
        {viewSupplier && (
          <div className="space-y-6 text-left p-1">
            <div className="flex items-center gap-4 bg-slate-50 p-5 rounded-2xl border border-slate-100 shadow-inner">
              <div className="w-14 h-14 bg-[#DAA520] text-slate-900 rounded-xl flex items-center justify-center font-black text-xl uppercase shadow-md shadow-amber-200">
                {viewSupplier.name.charAt(0)}
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">{viewSupplier.name}</h3>
                <p className="text-xs font-bold text-[#DAA520] uppercase mt-1">Supplier Profile & Accounts</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Phone Number</p>
                <p className="font-bold text-slate-700">{viewSupplier.phone || '—'}</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">NIC / Reg</p>
                <p className="font-bold text-slate-700">{viewSupplier.nic || '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Current Payable Balance</p>
                <p className={`font-black ${viewSupplier.payableBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {symbol} {viewSupplier.payableBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Lifetime Purchases</p>
                <p className="font-black text-slate-800">
                  {symbol} {getTotalPurchased(viewSupplier.name).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="col-span-2 space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Physical Address</p>
                <p className="font-bold text-slate-700">{viewSupplier.address || '—'}</p>
              </div>
            </div>
            <button onClick={() => setViewSupplier(null)} className="w-full py-3 bg-gray-100 text-gray-500 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-gray-200 transition-all">Close</button>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!supplierToDelete} onClose={() => setSupplierToDelete(null)} title="Delete Supplier" size="sm">
        {supplierToDelete && (
          <div className="text-center p-2 space-y-4">
            <div className="w-15 h-15 bg-red-50 text-red-500 rounded-xl flex items-center justify-center mx-auto border border-red-100 shadow-inner">
              <Trash2Icon className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-black text-slate-800 text-sm">Delete Supplier Profile?</h4>
              <p className="text-xs text-gray-500 font-bold mt-1.5 leading-relaxed">
                Are you sure you want to permanently delete <span className="text-[#DAA520]">{supplierToDelete.name}</span>? This action is permanent and cannot be undone.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setSupplierToDelete(null)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-xl font-black uppercase tracking-widest text-xs transition-all border border-gray-200">Cancel</button>
              <button onClick={() => handleDelete(supplierToDelete.id)} className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-red-500/20">Delete</button>
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
