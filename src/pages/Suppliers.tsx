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
  ReceiptIcon,
  FilterIcon,
  XIcon,
  ClockIcon,
  ArrowUpRightIcon,
  FileTextIcon
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { supabase } from '../lib/supabaseClient';
import { api } from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';
import { getTodaySriLankaDate, getCurrentSriLankaMonth } from '../utils/accounting';
import { getCachedData, setCachedData } from '../services/dataCache';
import { OfflineSyncWarningModal } from '../components/OfflineSyncWarningModal';
import { useOfflineSyncWarning } from '../hooks/useOfflineSyncWarning';

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

  const cachedSuppliers = getCachedData<Supplier[]>('suppliers');
  const cachedPos = getCachedData<any[]>('sales');

  const [suppliers, setSuppliers] = useState<Supplier[]>(cachedSuppliers || []);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>(cachedPos || []);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [cheques, setCheques] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(!cachedSuppliers);
  const [isSyncing, setIsSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'WITH_PAYABLES' | 'ADVANCES' | 'SETTLED'>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [viewSupplier, setViewSupplier] = useState<Supplier | null>(null);
  const [viewModalTab, setViewModalTab] = useState<'overview' | 'pos' | 'payments'>('overview');
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

  const {
    isOpen: isSyncWarningOpen,
    isSyncing: isWarningSyncing,
    checkSyncAndExecute,
    handleClose: handleWarningClose,
    handleSyncNow: handleWarningSyncNow
  } = useOfflineSyncWarning();

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchData = async (silent = false) => {
    if (!silent && !getCachedData('suppliers')) {
      setIsLoading(true);
    } else {
      setIsSyncing(true);
    }

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
        setCachedData('suppliers', mapped);
      }

      // 2. Load Purchase Orders to calculate total purchased
      const { data: poData } = await supabase
        .from('purchase_orders')
        .select('*');
      
      if (poData) {
        setPurchaseOrders(poData);
      }

      // 3. Load Transactions for settlement history audit trail
      const { data: transData } = await supabase
        .from('transactions')
        .select('*');
      if (transData) {
        setTransactions(transData);
      }

      // 4. Load Cheques for outward cheques
      const { data: chequeData } = await supabase
        .from('cheques')
        .select('*');
      if (chequeData) {
        setCheques(chequeData);
      }
    } catch (error) {
      console.error("Error loading suppliers or POs:", error);
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
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

  // Filter purchase orders by date range if specified
  const filteredPOs = useMemo(() => {
    return purchaseOrders.filter((po: any) => {
      const rawDate = po.created_at || po.date || po.received_at || '';
      const dateStr = rawDate.slice(0, 10);
      if (startDate && dateStr && dateStr < startDate) return false;
      if (endDate && dateStr && dateStr > endDate) return false;
      return true;
    });
  }, [purchaseOrders, startDate, endDate]);

  // Map total purchases by supplier name (case insensitive) within date scope
  const purchasesBySupplier = useMemo(() => {
    const map: Record<string, number> = {};
    filteredPOs.forEach((po: any) => {
      const nameKey = (po.supplier_name || po.supplierName || '').trim().toLowerCase();
      if (nameKey) {
        map[nameKey] = (map[nameKey] || 0) + Number(po.total || 0);
      }
    });
    return map;
  }, [filteredPOs]);

  // Map lifetime purchases across all time
  const lifetimePurchasesBySupplier = useMemo(() => {
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

  const getLifetimePurchased = (supplierName: string) => {
    const key = (supplierName || '').trim().toLowerCase();
    return lifetimePurchasesBySupplier[key] || 0;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (statusFilter === 'WITH_PAYABLES' && s.payableBalance <= 0) return false;
      if (statusFilter === 'ADVANCES' && s.payableBalance >= 0) return false;
      if (statusFilter === 'SETTLED' && s.payableBalance !== 0) return false;

      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        (s.nic && s.nic.toLowerCase().includes(q)) ||
        s.phone.includes(q) ||
        (s.address && s.address.toLowerCase().includes(q))
      );
    });
  }, [suppliers, search, statusFilter]);

  // Sum only positive balances for liabilities
  const totalOutstandingPayables = useMemo(() => {
    return suppliers.reduce((sum, s) => sum + (s.payableBalance > 0 ? s.payableBalance : 0), 0);
  }, [suppliers]);

  // Sum supplier advance credits
  const totalSupplierAdvances = useMemo(() => {
    return suppliers.reduce((sum, s) => sum + (s.payableBalance < 0 ? Math.abs(s.payableBalance) : 0), 0);
  }, [suppliers]);

  const totalPeriodPurchases = useMemo(() => {
    return filteredPOs.reduce((sum, po) => sum + Number(po.total || 0), 0);
  }, [filteredPOs]);

  const totalLifetimePurchases = useMemo(() => {
    return purchaseOrders.reduce((sum, po) => sum + Number(po.total || 0), 0);
  }, [purchaseOrders]);

  // Quick Date Filter Presets
  const setQuickDateRange = (preset: 'today' | 'this_month' | 'last_30' | 'all') => {
    const today = getTodaySriLankaDate();
    if (preset === 'today') {
      setStartDate(today);
      setEndDate(today);
    } else if (preset === 'this_month') {
      const monthPrefix = getCurrentSriLankaMonth();
      setStartDate(`${monthPrefix}-01`);
      setEndDate(today);
    } else if (preset === 'last_30') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setStartDate(d.toISOString().slice(0, 10));
      setEndDate(today);
    } else if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    }
  };

  const openAdd = () => {
    checkSyncAndExecute(() => {
      setEditingSupplier(null);
      setFormData(emptySupplier);
      setShowAddModal(true);
    });
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
    // Suggest payable balance if > 0, otherwise 0 for advance
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
      // Support exact negative balance / supplier advance without 0 clamp
      const newPayableBalance = Math.round((currentBalance - settleAmount) * 100) / 100;

      // 1. Update Supplier Payable Balance (can be negative for advance credit)
      const { error: suppError } = await supabase
        .from('suppliers')
        .update({ payable_balance: newPayableBalance })
        .eq('id', settlingSupplier.id);
      
      if (suppError) throw suppError;

      // Format rich audit description distinguishing settlement vs overpayment / advance
      let desc = '';
      const modeLabel = settlePaymentMode === 'CASH' ? 'Cash' : (settlePaymentMode === 'BANK' ? 'Bank Transfer' : 'Cheque');
      if (currentBalance > 0 && settleAmount > currentBalance) {
        const overpayment = Math.round((settleAmount - currentBalance) * 100) / 100;
        desc = `Supplier Payment - ${settlingSupplier.name} (Rs. ${currentBalance.toFixed(2)} settled, Rs. ${overpayment.toFixed(2)} Advance / Overpayment) via ${modeLabel}`;
      } else if (currentBalance <= 0) {
        desc = `Supplier Advance Payment - ${settlingSupplier.name} (Rs. ${settleAmount.toFixed(2)} Advance) via ${modeLabel}`;
      } else {
        desc = `Supplier Settlement: ${settlingSupplier.name} (Rs. ${settleAmount.toFixed(2)}) via ${modeLabel}`;
      }

      // 2. Handle Cash / Bank / Cheque logging
      if (settlePaymentMode === 'CASH' || settlePaymentMode === 'BANK') {
        const transPayload = {
          type: 'expense',
          flow_type: 'EXPENSE',
          category: 'Supplier Payment',
          description: desc,
          amount: settleAmount,
          date: settleDate || getTodaySriLankaDate(),
          reference: settleRef || `PV-${Date.now().toString().slice(-6)}`,
          user_id: user?.id || null,
          payment_method: settlePaymentMode
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
          notes: settleNotes.trim() || `${desc} [Voucher: ${settleRef}]`
        });
      }

      const balanceMessage = newPayableBalance < 0
        ? ` (Recorded Advance: ${symbol} ${Math.abs(newPayableBalance).toFixed(2)})`
        : '';

      setToast({
        message: `Settled ${symbol} ${settleAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} for ${settlingSupplier.name}${balanceMessage}!`,
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

      const batchPayload: any[] = [];
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

        batchPayload.push(dbPayload);
      }

      if (batchPayload.length > 0) {
        const res = await api.suppliers.bulkImport(batchPayload);
        const imported = res?.count || res?.imported || batchPayload.length;
        setToast({ 
          message: `Successfully imported/updated ${imported} suppliers!`, 
          type: 'success' 
        });
      } else {
        setToast({ message: "No valid supplier records found to import.", type: 'error' });
      }

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

  // Get specific supplier history for view modal
  const viewSupplierPOs = useMemo(() => {
    if (!viewSupplier) return [];
    const nameKey = viewSupplier.name.trim().toLowerCase();
    return purchaseOrders.filter((po: any) => {
      const matchName = (po.supplier_name || po.supplierName || '').trim().toLowerCase() === nameKey;
      const matchId = po.supplier_id && po.supplier_id === viewSupplier.id;
      return matchName || matchId;
    });
  }, [purchaseOrders, viewSupplier]);

  const viewSupplierPayments = useMemo(() => {
    if (!viewSupplier) return [];
    const nameKey = viewSupplier.name.trim().toLowerCase();
    return transactions.filter((t: any) => {
      const desc = (t.description || '').toLowerCase();
      const cat = (t.category || '').toLowerCase();
      return desc.includes(nameKey) || (cat.includes('supplier') && desc.includes(viewSupplier.id));
    });
  }, [transactions, viewSupplier]);

  const viewSupplierCheques = useMemo(() => {
    if (!viewSupplier) return [];
    const nameKey = viewSupplier.name.trim().toLowerCase();
    return cheques.filter((c: any) => {
      const pName = (c.party_name || '').toLowerCase();
      const pId = c.party_id;
      return pName.includes(nameKey) || pId === viewSupplier.id;
    });
  }, [cheques, viewSupplier]);

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
          <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-slate-300">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#DAA520] animate-ping"></span>
              <span>{suppliers.filter(s => s.payableBalance > 0).length} with payables</span>
            </div>
            {totalSupplierAdvances > 0 && (
              <span className="text-indigo-300 font-black">
                {suppliers.filter(s => s.payableBalance < 0).length} with advance
              </span>
            )}
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
          <div className="mt-3 flex items-center justify-between text-[11px] font-bold text-rose-200">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
              <span>Liabilities to vendors</span>
            </div>
            {totalSupplierAdvances > 0 && (
              <span className="text-amber-200 bg-black/20 px-2 py-0.5 rounded-md font-black text-[10px]">
                Advance Credit: {symbol} {totalSupplierAdvances.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>

        {/* Total Purchases (Period / Lifetime) */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl shadow-xl p-5 border border-slate-700/20 hover:translate-y-[-2px] transition-all duration-300 relative overflow-hidden group text-white">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#DAA520]/10 rounded-full -mr-16 -mt-16 blur-xl group-hover:scale-110 transition-transform duration-500"></div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-amber-200/70 uppercase tracking-widest">
                {startDate || endDate ? 'Period Purchases' : 'Lifetime Purchases'}
              </p>
              <p className="text-3xl font-black text-[#DAA520] mt-1.5">
                {symbol} {(startDate || endDate ? totalPeriodPurchases : totalLifetimePurchases).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="w-12 h-12 bg-amber-500/20 text-[#DAA520] rounded-xl flex items-center justify-center shadow-lg border border-amber-500/30">
              <ReceiptIcon className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-[#DAA520]"></span>
            <span>{startDate || endDate ? `${filteredPOs.length} POs in selected date range` : `${purchaseOrders.length} Total Purchase orders executed`}</span>
          </div>
        </div>
      </div>

      {/* Control Actions & Date Filter Panel */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
        {/* Top row: Search, Import, Add, Delete */}
        <div className="flex flex-col xl:flex-row gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 flex-1 group focus-within:ring-2 focus-within:ring-[#DAA520]/20 transition-all">
            <SearchIcon className="w-4 h-4 text-slate-400 group-focus-within:text-[#DAA520]" />
            <input 
              type="text" 
              placeholder="Find suppliers by company name, NIC, phone or address..." 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              className="bg-transparent text-sm text-slate-700 outline-none w-full font-medium" 
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-slate-400 hover:text-slate-600">
                <XIcon className="w-4 h-4" />
              </button>
            )}
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
            className="flex items-center justify-center gap-2 bg-[#464646] hover:bg-[#363636] text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg"
          >
            <PlusIcon className="w-4 h-4" /> Import Excel
          </button>
          <button 
            onClick={openAdd} 
            className="flex items-center justify-center gap-2 bg-[#DAA520] hover:bg-[#B8860B] text-slate-900 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-[#DAA520]/20"
          >
            <PlusIcon className="w-4 h-4 text-slate-900" /> Add Supplier
          </button>
          {selectedSupplierIds.length > 0 && (
            <button 
              onClick={handleBulkDelete} 
              className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-red-600/20 shrink-0"
            >
              <Trash2Icon className="w-4 h-4" /> Delete Selected ({selectedSupplierIds.length})
            </button>
          )}
        </div>

        {/* Bottom row: Date Breakdown & Status Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
          {/* Status filter pill buttons */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg font-black uppercase tracking-wider transition-all ${
                statusFilter === 'ALL'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              All ({suppliers.length})
            </button>
            <button
              onClick={() => setStatusFilter('WITH_PAYABLES')}
              className={`px-3 py-1.5 rounded-lg font-black uppercase tracking-wider transition-all ${
                statusFilter === 'WITH_PAYABLES'
                  ? 'bg-rose-500 text-white shadow-sm shadow-rose-500/20'
                  : 'text-rose-600 hover:text-rose-700'
              }`}
            >
              With Payables ({suppliers.filter(s => s.payableBalance > 0).length})
            </button>
            <button
              onClick={() => setStatusFilter('ADVANCES')}
              className={`px-3 py-1.5 rounded-lg font-black uppercase tracking-wider transition-all ${
                statusFilter === 'ADVANCES'
                  ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20'
                  : 'text-indigo-600 hover:text-indigo-700'
              }`}
            >
              With Advance ({suppliers.filter(s => s.payableBalance < 0).length})
            </button>
            <button
              onClick={() => setStatusFilter('SETTLED')}
              className={`px-3 py-1.5 rounded-lg font-black uppercase tracking-wider transition-all ${
                statusFilter === 'SETTLED'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-emerald-600 hover:text-emerald-700'
              }`}
            >
              Settled / Zero ({suppliers.filter(s => s.payableBalance === 0).length})
            </button>
          </div>

          {/* Date Range Picker & Presets */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
              <CalendarIcon className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[10px] font-bold text-slate-400 uppercase">From</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-700 outline-none"
              />
              <span className="text-[10px] font-bold text-slate-400 uppercase">To</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-700 outline-none"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="text-slate-400 hover:text-slate-600 p-0.5"
                  title="Clear Date Filter"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Quick Presets */}
            <div className="hidden sm:flex items-center gap-1">
              <button
                onClick={() => setQuickDateRange('today')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-wider"
              >
                Today
              </button>
              <button
                onClick={() => setQuickDateRange('this_month')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-wider"
              >
                This Month
              </button>
              <button
                onClick={() => setQuickDateRange('last_30')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-wider"
              >
                30 Days
              </button>
              <button
                onClick={() => setQuickDateRange('all')}
                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-bold uppercase tracking-wider"
              >
                All Time
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden text-left">
        {/* Table Header with gradient */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-white">Suppliers Registry & Payables Ledger</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
              Manage partner suppliers, direct credit settlements, advance payments, and purchase history
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSyncing && (
              <span className="flex items-center gap-1.5 text-[10px] text-amber-400 font-semibold bg-amber-400/10 px-2.5 py-1 rounded-full border border-amber-400/20">
                <Loader2Icon className="w-3 h-3 animate-spin text-amber-400" />
                <span>Syncing...</span>
              </span>
            )}
            <span className="px-3 py-1.5 bg-[#DAA520]/20 text-[#DAA520] text-xs font-black rounded-full border border-[#DAA520]/30">
              {filtered.length} Suppliers Listed
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          {isLoading && suppliers.length === 0 ? (
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
                  <th className="px-6 py-4 text-right">
                    {startDate || endDate ? 'Period Purchased' : 'Total Purchased'}
                  </th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((supplier) => {
                  const purchasedVal = getTotalPurchased(supplier.name);
                  const isOwing = supplier.payableBalance > 0;
                  const isAdvance = supplier.payableBalance < 0;

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
                        ) : isAdvance ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-50 text-indigo-700 font-black rounded-lg border border-indigo-200 text-xs shadow-sm" title="Supplier Advance / Overpayment">
                            <ArrowUpRightIcon className="w-3.5 h-3.5 text-indigo-600" />
                            Advance: {symbol} {Math.abs(supplier.payableBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all uppercase tracking-wider shadow-sm ${
                              isOwing
                                ? 'bg-[#DAA520] hover:bg-[#B8860B] text-slate-900 shadow-amber-500/20'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                            }`}
                            title={isOwing ? "Pay / Settle Outstanding Balance" : "Make Payment / Advance Deposit"}
                          >
                            <WalletIcon className="w-3.5 h-3.5" />
                            <span>{isOwing ? 'Pay / Settle' : 'Pay / Advance'}</span>
                          </button>

                          <button 
                            onClick={() => { setViewSupplier(supplier); setViewModalTab('overview'); }} 
                            className="p-2 rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-200 border border-slate-100 transition-all shadow-sm" 
                            title="View Profile & History"
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
                      No suppliers registered matching your filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Settle / Payment Settlement Modal */}
      <Modal
        isOpen={!!settlingSupplier}
        onClose={() => setSettlingSupplier(null)}
        title={settlingSupplier?.payableBalance && settlingSupplier.payableBalance > 0 ? "Supplier Credit Settlement" : "Supplier Payment / Advance"}
        size="lg"
      >
        {settlingSupplier && (
          <div className="space-y-5 text-left p-1">
            {/* Supplier Info Header Banner */}
            <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800 p-4 rounded-2xl text-white border border-slate-700 shadow-md">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-[#DAA520] text-slate-900 rounded-xl flex items-center justify-center font-black text-lg uppercase shadow-inner">
                  {settlingSupplier.name.charAt(0)}
                </div>
                <div>
                  <h4 className="font-black text-base text-white">{settlingSupplier.name}</h4>
                  <p className="text-[11px] text-amber-300/80 font-medium">{settlingSupplier.phone || 'No phone'} • {settlingSupplier.nic || 'No Reg'}</p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-300">
                  {settlingSupplier.payableBalance > 0 ? 'Outstanding Payable' : (settlingSupplier.payableBalance < 0 ? 'Current Advance Credit' : 'Account Status')}
                </span>
                <p className={`text-xl font-black ${
                  settlingSupplier.payableBalance > 0 ? 'text-rose-400' : (settlingSupplier.payableBalance < 0 ? 'text-indigo-300' : 'text-emerald-400')
                }`}>
                  {settlingSupplier.payableBalance < 0 ? `Advance: ${symbol} ${Math.abs(settlingSupplier.payableBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : `${symbol} ${settlingSupplier.payableBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                </p>
              </div>
            </div>

            {/* Amount Field with Quick Selection helpers */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Payment Amount ({symbol}) *
                </label>
                {settlingSupplier.payableBalance > 0 && (
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setSettleAmount(settlingSupplier.payableBalance)}
                      className="text-[#DAA520] hover:underline font-bold"
                    >
                      Pay Full ({symbol} {settlingSupplier.payableBalance.toLocaleString()})
                    </button>
                    <span className="text-slate-300">•</span>
                    <button
                      type="button"
                      onClick={() => setSettleAmount(Math.round((settlingSupplier.payableBalance / 2) * 100) / 100)}
                      className="text-slate-500 hover:text-slate-700 font-medium"
                    >
                      50%
                    </button>
                  </div>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-sm">
                  {symbol}
                </span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={settleAmount || ''}
                  onChange={(e) => setSettleAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] focus:bg-white transition-all"
                  required
                />
              </div>
              {settleAmount > 0 && (
                <div className="mt-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-bold">Projected Balance After Payment:</span>
                  {(() => {
                    const resulting = Math.round((settlingSupplier.payableBalance - settleAmount) * 100) / 100;
                    if (resulting > 0) {
                      return (
                        <span className="text-rose-600 font-black">
                          Remaining Payable: {symbol} {resulting.toFixed(2)}
                        </span>
                      );
                    } else if (resulting === 0) {
                      return (
                        <span className="text-emerald-600 font-black flex items-center gap-1">
                          <CheckCircleIcon className="w-3.5 h-3.5" />
                          Fully Settled ({symbol} 0.00)
                        </span>
                      );
                    } else {
                      return (
                        <span className="text-indigo-600 font-black flex items-center gap-1">
                          <ArrowUpRightIcon className="w-3.5 h-3.5" />
                          Supplier Advance / Store Credit: {symbol} {Math.abs(resulting).toFixed(2)}
                        </span>
                      );
                    }
                  })()}
                </div>
              )}
            </div>

            {/* Payment Method Selector */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                Settlement Payment Method *
              </label>
              <div className="grid grid-cols-3 gap-3">
                {/* Direct Cash */}
                <button
                  type="button"
                  onClick={() => setSettlePaymentMode('CASH')}
                  className={`p-3.5 rounded-xl border flex flex-col items-center gap-2 transition-all ${
                    settlePaymentMode === 'CASH'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-500/20 shadow-sm'
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
                      ? 'bg-blue-50 border-blue-500 text-blue-800 ring-2 ring-blue-500/20 shadow-sm'
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
                      ? 'bg-amber-50 border-[#DAA520] text-amber-900 ring-2 ring-[#DAA520]/20 shadow-sm'
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
                placeholder="Details of the purchase invoices or POs settled..."
                value={settleNotes}
                onChange={(e) => setSettleNotes(e.target.value)}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
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

      {/* View Details / History Ledger Modal */}
      <Modal isOpen={!!viewSupplier} onClose={() => setViewSupplier(null)} title="Supplier Insights & Accounts Ledger" size="lg">
        {viewSupplier && (
          <div className="space-y-5 text-left p-1">
            {/* Header banner */}
            <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100 shadow-inner">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-[#DAA520] text-slate-900 rounded-xl flex items-center justify-center font-black text-lg uppercase shadow-md shadow-amber-200">
                  {viewSupplier.name.charAt(0)}
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">{viewSupplier.name}</h3>
                  <p className="text-xs font-bold text-slate-400">{viewSupplier.phone || 'No Phone'} • {viewSupplier.nic || 'No Reg #'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const supp = viewSupplier;
                    setViewSupplier(null);
                    openSettleModal(supp);
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#DAA520] hover:bg-[#B8860B] text-slate-900 text-xs font-black uppercase tracking-wider shadow-md shadow-amber-500/20 transition-all"
                >
                  <WalletIcon className="w-3.5 h-3.5" />
                  <span>{viewSupplier.payableBalance > 0 ? 'Pay Balance' : 'Pay Advance'}</span>
                </button>
              </div>
            </div>

            {/* Modal Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2 text-xs">
              <button
                onClick={() => setViewModalTab('overview')}
                className={`px-3 py-1.5 rounded-lg font-black uppercase tracking-wider transition-all ${
                  viewModalTab === 'overview'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setViewModalTab('pos')}
                className={`px-3 py-1.5 rounded-lg font-black uppercase tracking-wider transition-all ${
                  viewModalTab === 'pos'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Purchase Orders ({viewSupplierPOs.length})
              </button>
              <button
                onClick={() => setViewModalTab('payments')}
                className={`px-3 py-1.5 rounded-lg font-black uppercase tracking-wider transition-all ${
                  viewModalTab === 'payments'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Settlements ({viewSupplierPayments.length + viewSupplierCheques.length})
              </button>
            </div>
            
            {/* Tab: Overview */}
            {viewModalTab === 'overview' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      {viewSupplier.payableBalance > 0 ? 'Payable Balance' : (viewSupplier.payableBalance < 0 ? 'Advance Credit' : 'Balance')}
                    </p>
                    <p className={`text-base font-black mt-1 ${
                      viewSupplier.payableBalance > 0 ? 'text-rose-600' : (viewSupplier.payableBalance < 0 ? 'text-indigo-600' : 'text-emerald-600')
                    }`}>
                      {viewSupplier.payableBalance < 0
                        ? `Advance: ${symbol} ${Math.abs(viewSupplier.payableBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                        : `${symbol} ${viewSupplier.payableBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                    </p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Lifetime Purchased</p>
                    <p className="text-base font-black text-slate-800 mt-1">
                      {symbol} {getLifetimePurchased(viewSupplier.name).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Credit Terms</p>
                    <p className="text-base font-black text-slate-800 mt-1">{viewSupplier.creditTerms || 'Net 30'}</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Orders</p>
                    <p className="text-base font-black text-slate-800 mt-1">{viewSupplierPOs.length} Orders</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Phone</p>
                    <p className="font-bold text-slate-700">{viewSupplier.phone || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Email</p>
                    <p className="font-bold text-slate-700">{viewSupplier.email || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">NIC / Reg</p>
                    <p className="font-bold text-slate-700">{viewSupplier.nic || '—'}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Address</p>
                    <p className="font-bold text-slate-700">{viewSupplier.address || '—'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Purchase Orders */}
            {viewModalTab === 'pos' && (
              <div className="max-h-72 overflow-y-auto space-y-2 text-xs">
                {viewSupplierPOs.length === 0 ? (
                  <p className="py-8 text-center text-slate-400 font-bold">No purchase orders found for this supplier.</p>
                ) : (
                  viewSupplierPOs.map((po: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 hover:bg-amber-50/40 rounded-xl border border-slate-100 transition-colors">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-slate-900">{po.po_number || po.po_no || `PO-${idx + 1}`}</span>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${
                            (po.status || '').toLowerCase() === 'received'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {po.status || 'Pending'}
                          </span>
                          <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded-md font-bold">
                            {po.payment_method || 'CREDIT'}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium">
                          Date: {(po.created_at || po.date || '').slice(0, 10)} {po.received_at ? `• Received: ${po.received_at.slice(0, 10)}` : ''}
                        </p>
                      </div>
                      <div className="text-right font-black text-slate-800">
                        {symbol} {Number(po.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Tab: Settlements & Cheques */}
            {viewModalTab === 'payments' && (
              <div className="max-h-72 overflow-y-auto space-y-2 text-xs">
                {viewSupplierPayments.length === 0 && viewSupplierCheques.length === 0 ? (
                  <p className="py-8 text-center text-slate-400 font-bold">No recorded settlement transactions or cheques found.</p>
                ) : (
                  <>
                    {viewSupplierPayments.map((t: any, idx: number) => (
                      <div key={`t-${idx}`} className="flex items-center justify-between p-3 bg-slate-50 hover:bg-emerald-50/40 rounded-xl border border-slate-100 transition-colors">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-emerald-700">{t.reference || 'PV-Payment'}</span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-emerald-100 text-emerald-800">
                              {t.payment_method || 'Direct Payment'}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 font-medium">{t.description || 'Supplier Settlement'}</p>
                          <p className="text-[10px] text-slate-400 font-semibold">{t.date}</p>
                        </div>
                        <div className="text-right font-black text-emerald-700">
                          - {symbol} {Number(t.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    ))}

                    {viewSupplierCheques.map((c: any, idx: number) => (
                      <div key={`c-${idx}`} className="flex items-center justify-between p-3 bg-slate-50 hover:bg-amber-50/40 rounded-xl border border-slate-100 transition-colors">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-amber-800">Cheque #{c.cheque_number}</span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-amber-100 text-amber-800">
                              {c.status || 'PENDING'}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 font-medium">{c.bank_name} • PDC: {c.cheque_date}</p>
                        </div>
                        <div className="text-right font-black text-amber-800">
                          {symbol} {Number(c.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            <button onClick={() => setViewSupplier(null)} className="w-full py-3 bg-gray-100 text-gray-500 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-gray-200 transition-all">
              Close
            </button>
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

      {/* Master Data Offline Sync Warning Modal */}
      <OfflineSyncWarningModal
        isOpen={isSyncWarningOpen}
        onClose={handleWarningClose}
        onSyncNow={handleWarningSyncNow}
        isSyncing={isWarningSyncing}
      />
    </div>
  );
}
