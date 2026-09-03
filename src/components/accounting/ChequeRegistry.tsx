import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  SearchIcon,
  FilterIcon,
  PlusIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  AlertTriangleIcon,
  FileTextIcon,
  PrinterIcon,
  DownloadIcon,
  RefreshCwIcon,
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  DollarSignIcon,
  Building2Icon,
  CalendarIcon,
  UserIcon,
  CreditCardIcon,
  Loader2Icon,
  ExternalLinkIcon,
  CheckIcon,
  XIcon,
  ChevronDownIcon,
  RotateCcwIcon,
  Undo2Icon
} from 'lucide-react';
import { Modal } from '../Modal';
import { api } from '../../lib/api';
import { supabase } from '../../lib/supabaseClient';
import { useCurrency } from '../../context/CurrencyContext';
import type { Cheque, ChequeDirection, ChequeType, ChequeStatus, ChequeReferenceType, Customer, Supplier, User } from '../../types';
import { SRI_LANKAN_BANKS } from '../../pages/Sales';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import XLSX from 'xlsx-js-style';

interface ChequeRegistryProps {
  currentUser?: User | null;
  shopSettings?: any;
}

export function ChequeRegistry({ currentUser, shopSettings }: ChequeRegistryProps) {
  const { currency, exchangeRate = 300 } = useCurrency();
  const symbol = 'Rs.';

  const [cheques, setCheques] = useState<Cheque[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Filters
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'INWARD' | 'OUTWARD'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ChequeStatus>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | ChequeType>('ALL');
  const [maturityFilter, setMaturityFilter] = useState<'ALL' | 'POST_DATED' | 'DUE_TODAY' | 'PAST_DUE'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCheque, setSelectedCheque] = useState<Cheque | null>(null);
  const [viewVoucherCheque, setViewVoucherCheque] = useState<Cheque | null>(null);
  const [statusActionCheque, setStatusActionCheque] = useState<{ cheque: Cheque; action: 'CLEAR_BANK' | 'CLEAR_CASH' | 'BOUNCE' | 'CANCEL' } | null>(null);

  // Status Action Form State
  const [actionNotes, setActionNotes] = useState('');
  const [bounceReason, setBounceReason] = useState('Insufficient Funds / ගිණුමේ මුදල් ප්‍රමාණවත් නොවීම');
  const [customBounceReason, setCustomBounceReason] = useState('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Manual Cheque Form State
  const [formData, setFormData] = useState<{
    direction: ChequeDirection;
    cheque_type: ChequeType;
    cheque_number: string;
    bank_name: string;
    custom_bank_name: string;
    branch: string;
    cheque_date: string;
    amount: number | '';
    party_type: 'CUSTOMER' | 'SUPPLIER' | 'OTHER';
    party_id: string;
    party_name: string;
    inward_purpose: 'CREDIT_SETTLEMENT' | 'ADVANCE_DEPOSIT' | 'SUPPLIER_REFUND' | 'GENERAL_INCOME';
    reference_type: ChequeReferenceType;
    reference_id: string;
    notes: string;
  }>({
    direction: 'OUTWARD',
    cheque_type: 'CROSSED_ACCOUNT_PAYEE',
    cheque_number: '',
    bank_name: 'Bank of Ceylon',
    custom_bank_name: '',
    branch: '',
    cheque_date: new Date().toISOString().split('T')[0],
    amount: '',
    party_type: 'SUPPLIER',
    party_id: '',
    party_name: '',
    inward_purpose: 'CREDIT_SETTLEMENT',
    reference_type: 'PURCHASE_ORDER',
    reference_id: '',
    notes: ''
  });

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch Cheques
      const chequesData = await api.cheques.getAll();
      setCheques(chequesData || []);

      // 2. Fetch Customers & Suppliers for party dropdowns
      const { data: custData } = await supabase.from('customers').select('*');
      if (custData) setCustomers(custData);

      const { data: suppData } = await supabase.from('suppliers').select('*');
      if (suppData) setSuppliers(suppData);

      // 3. Fetch Sales to map unpaid/credit invoices
      const { data: salesData } = await supabase.from('sales').select('*');
      if (salesData) setSales(salesData);
    } catch (err: any) {
      console.error("Error loading cheques data:", err);
      setToast({ message: "Failed to load cheque records: " + err.message, type: 'error' });
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

  // Maturity classification helper
  const todayStr = new Date().toISOString().split('T')[0];
  const getMaturityStatus = (chequeDate: string, status: ChequeStatus) => {
    if (status === 'CLEARED') return { label: 'Cleared', color: 'emerald' };
    if (status === 'BOUNCED') return { label: 'Bounced', color: 'rose' };
    if (status === 'CANCELLED') return { label: 'Cancelled', color: 'slate' };
    
    if (chequeDate > todayStr) {
      return { label: 'Post-Dated (Future)', color: 'amber' };
    } else if (chequeDate === todayStr) {
      return { label: 'Due Today', color: 'blue' };
    } else {
      return { label: 'Past Due / Mature', color: 'purple' };
    }
  };

  // Filtered Cheques
  const filteredCheques = useMemo(() => {
    return cheques.filter((c) => {
      // Direction
      if (directionFilter !== 'ALL' && c.direction !== directionFilter) return false;
      // Status
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      // Type
      if (typeFilter !== 'ALL' && c.cheque_type !== typeFilter) return false;

      // Maturity
      if (maturityFilter !== 'ALL') {
        if (maturityFilter === 'POST_DATED' && c.cheque_date <= todayStr) return false;
        if (maturityFilter === 'DUE_TODAY' && c.cheque_date !== todayStr) return false;
        if (maturityFilter === 'PAST_DUE' && c.cheque_date >= todayStr) return false;
      }

      // Date Range
      if (startDate && c.cheque_date < startDate) return false;
      if (endDate && c.cheque_date > endDate) return false;

      // Search
      if (search.trim()) {
        const q = search.toLowerCase();
        const num = (c.cheque_number || '').toLowerCase();
        const bank = (c.bank_name || '').toLowerCase();
        const branch = (c.branch || '').toLowerCase();
        const party = (c.party_name || '').toLowerCase();
        const ref = (c.reference_id || '').toLowerCase();
        const notes = (c.notes || '').toLowerCase();
        const match = num.includes(q) || bank.includes(q) || branch.includes(q) || party.includes(q) || ref.includes(q) || notes.includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [cheques, directionFilter, statusFilter, typeFilter, maturityFilter, startDate, endDate, search, todayStr]);

  // KPI Metrics Calculations
  const metrics = useMemo(() => {
    const pendingInward = cheques.filter(c => c.direction === 'INWARD' && (c.status === 'PENDING' || c.status === 'DEPOSITED'));
    const cashInHand = cheques.filter(c => c.direction === 'INWARD' && c.status === 'IN_HAND');
    const clearedCheques = cheques.filter(c => c.status === 'CLEARED');
    const outwardCheques = cheques.filter(c => c.direction === 'OUTWARD');

    const totalPendingInwardValue = pendingInward.reduce((sum, c) => sum + (c.amount || 0), 0);
    const totalCashInHandValue = cashInHand.reduce((sum, c) => sum + (c.amount || 0), 0);
    const totalClearedValue = clearedCheques.reduce((sum, c) => sum + (c.amount || 0), 0);
    const totalOutwardValue = outwardCheques.reduce((sum, c) => sum + (c.amount || 0), 0);

    return {
      pendingInwardCount: pendingInward.length,
      pendingInwardValue: totalPendingInwardValue,
      cashInHandCount: cashInHand.length,
      cashInHandValue: totalCashInHandValue,
      clearedCount: clearedCheques.length,
      clearedValue: totalClearedValue,
      outwardCount: outwardCheques.length,
      outwardValue: totalOutwardValue
    };
  }, [cheques]);

  // Customer Credit Map for Inward Cheque Linkage
  const customerCreditMap = useMemo(() => {
    const map = new Map<string, { totalCredit: number; creditInvoices: { id: string; invoiceNo: string; total: number; received: number; balance: number; date: string }[] }>();

    customers.forEach(c => {
      const custSales = sales.filter((s: any) => {
        if (!s) return false;
        const isCust = (s.customer_id && s.customer_id === c.id) || 
                       (s.customer_name && s.customer_name.toLowerCase().trim() === (c.name || '').toLowerCase().trim());
        if (!isCust) return false;
        const status = (s.status || '').toLowerCase().trim();
        if (status === 'cancelled' || status === 'voided') return false;
        const total = Number(s.total_amount !== undefined ? s.total_amount : (s.total || 0));
        const received = Number(s.payment_received || 0);
        return total > received || s.is_credit === 1 || status === 'pending';
      });

      const creditInvoices = custSales.map((s: any) => {
        const total = Number(s.total_amount !== undefined ? s.total_amount : (s.total || 0));
        const received = Number(s.payment_received || 0);
        const balance = Math.max(0, total - received);
        return {
          id: s.id,
          invoiceNo: s.invoice_no || s.invoiceNo || s.id,
          total,
          received,
          balance,
          date: s.created_at || s.date || ''
        };
      }).filter(inv => inv.balance > 0);

      const salesBalanceSum = creditInvoices.reduce((sum, inv) => sum + inv.balance, 0);
      const recordedCreditBal = Number(c.credit_balance || (c as any).current_credit || (c as any).creditBalance || 0);
      const totalCredit = Math.max(recordedCreditBal, salesBalanceSum);

      map.set(c.id, { totalCredit, creditInvoices });
    });

    return map;
  }, [customers, sales]);

  // Customers filtered/sorted by active credit
  const creditCustomers = useMemo(() => {
    return customers.map(c => {
      const info = customerCreditMap.get(c.id) || { totalCredit: 0, creditInvoices: [] };
      return {
        ...c,
        activeCredit: info.totalCredit,
        invoices: info.creditInvoices
      };
    });
  }, [customers, customerCreditMap]);

  const selectedCustObj = useMemo(() => {
    if (!formData.party_id) return null;
    return creditCustomers.find(c => c.id === formData.party_id) || null;
  }, [creditCustomers, formData.party_id]);

  const availableInvoices = useMemo(() => {
    if (!selectedCustObj) return [];
    return selectedCustObj.invoices || [];
  }, [selectedCustObj]);

  const maxAllowedInwardAmount = useMemo(() => {
    if (formData.direction !== 'INWARD') return Infinity;
    if (!selectedCustObj) return 0;
    if (formData.reference_type === 'SALE_INVOICE' && formData.reference_id && formData.reference_id !== 'ALL') {
      const matchedInv = availableInvoices.find(inv => inv.invoiceNo === formData.reference_id || inv.id === formData.reference_id);
      if (matchedInv) return matchedInv.balance;
    }
    return selectedCustObj.activeCredit;
  }, [formData.direction, formData.reference_type, formData.reference_id, selectedCustObj, availableInvoices]);

  // Status transition handler
  const handleStatusTransitionSubmit = async () => {
    if (!statusActionCheque) return;
    const { cheque, action } = statusActionCheque;

    setIsSubmittingAction(true);
    try {
      let targetStatus: ChequeStatus = 'CLEARED';
      let payloadNotes = actionNotes.trim();

      if (action === 'CLEAR_BANK') {
        targetStatus = 'CLEARED';
        payloadNotes = payloadNotes || 'Realized & Deposited to Bank Account';
      } else if (action === 'CLEAR_CASH') {
        targetStatus = 'CLEARED';
        payloadNotes = payloadNotes || 'Encashed to Cash Register / Drawer';
      } else if (action === 'BOUNCE') {
        targetStatus = 'BOUNCED';
        const finalReason = bounceReason === 'Other' ? (customBounceReason.trim() || 'Unspecified reason') : bounceReason;
        payloadNotes = `Cheque Bounced: ${finalReason}. ${payloadNotes}`;
      } else if (action === 'CANCEL') {
        targetStatus = 'CANCELLED';
        payloadNotes = `Cheque Cancelled / Voided. ${payloadNotes}`;
      }

      await api.cheques.updateStatus(cheque.id, {
        status: targetStatus,
        notes: payloadNotes,
        user_email: currentUser?.email || 'admin@hardware.erp'
      });

      setToast({
        message: `Cheque #${cheque.cheque_number} status updated to ${targetStatus} successfully!`,
        type: 'success'
      });

      setStatusActionCheque(null);
      setActionNotes('');
      setBounceReason('Insufficient Funds / ගිණුමේ මුදල් ප්‍රමාණවත් නොවීම');
      setCustomBounceReason('');
      fetchData();
    } catch (err: any) {
      console.error("Status update error:", err);
      setToast({ message: "Failed to update cheque status: " + err.message, type: 'error' });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Undo Cheque Status (Clearance / Bounce Reversal)
  const handleUndoCheque = async (cheque: Cheque, targetStatus: 'IN_HAND' | 'PENDING' = 'IN_HAND') => {
    const actionLabel = cheque.status === 'CLEARED' ? 'Clearance' : (cheque.status === 'BOUNCED' ? 'Bounce' : 'Status');
    if (!window.confirm(`Are you sure you want to Undo ${actionLabel} for Cheque #${cheque.cheque_number} and revert it back to ${targetStatus}? This will restore associated ledger transactions and account balances.`)) {
      return;
    }

    try {
      const { data, error } = await supabase.rpc('undo_cheque_status', {
        p_cheque_id: cheque.cheque_number || cheque.id,
        p_revert_to: targetStatus
      });

      if (error || !data?.success) {
        setToast({
          message: error?.message || data?.message || 'Failed to revert cheque status.',
          type: 'error'
        });
      } else {
        setToast({
          message: data?.message || `Cheque #${cheque.cheque_number} reverted to ${targetStatus} successfully!`,
          type: 'success'
        });
        fetchData();
        window.dispatchEvent(new CustomEvent('refresh-finance'));
        window.dispatchEvent(new CustomEvent('refresh-all-data'));
      }
    } catch (err: any) {
      setToast({ message: 'Error reverting cheque: ' + err.message, type: 'error' });
    }
  };

  // Manual Cheque Save
  const handleSaveManualCheque = async () => {
    if (!formData.cheque_number.trim()) {
      return setToast({ message: "Cheque number is required.", type: 'error' });
    }
    const enteredAmt = Number(formData.amount);
    if (!enteredAmt || enteredAmt <= 0) {
      return setToast({ message: "Please enter a valid amount greater than 0.", type: 'error' });
    }
    if (formData.bank_name === 'Other' && !formData.custom_bank_name.trim()) {
      return setToast({ message: "Please specify the bank name.", type: 'error' });
    }
    if (!formData.party_name.trim()) {
      return setToast({ message: "Please select or specify the party/payee name.", type: 'error' });
    }

    if (formData.direction === 'INWARD') {
      const purpose = formData.inward_purpose || 'CREDIT_SETTLEMENT';
      if (purpose === 'CREDIT_SETTLEMENT') {
        if (!formData.party_id) {
          return setToast({ message: "Please select a registered customer with an active credit balance.", type: 'error' });
        }
        if (selectedCustObj && selectedCustObj.activeCredit <= 0) {
          return setToast({ message: `Customer ${selectedCustObj.name} has no outstanding credit balance.`, type: 'error' });
        }
        if (enteredAmt > maxAllowedInwardAmount + 0.01) {
          return setToast({
            message: `Cheque amount (${symbol} ${enteredAmt.toLocaleString()}) exceeds the maximum allowed credit balance (${symbol} ${maxAllowedInwardAmount.toLocaleString()}).`,
            type: 'error'
          });
        }
      } else if (purpose === 'ADVANCE_DEPOSIT') {
        if (!formData.party_name.trim()) {
          return setToast({ message: "Please select or enter the customer name for the advance deposit.", type: 'error' });
        }
      } else if (purpose === 'SUPPLIER_REFUND') {
        if (!formData.party_name.trim()) {
          return setToast({ message: "Please select the supplier issuing the refund.", type: 'error' });
        }
      } else if (purpose === 'GENERAL_INCOME') {
        if (!formData.party_name.trim()) {
          return setToast({ message: "Please enter the payer or organization name.", type: 'error' });
        }
      }
    }

    try {
      const bankNameToUse = formData.bank_name === 'Other' ? formData.custom_bank_name.trim() : formData.bank_name;
      const initialStatus: ChequeStatus = formData.direction === 'INWARD'
        ? (formData.cheque_type === 'CASH_BEARER' ? 'IN_HAND' : 'PENDING')
        : 'PENDING';

      let finalRefType = formData.reference_type;
      let finalRefId = formData.reference_id.trim() || undefined;
      let finalNotes = formData.notes.trim() || undefined;

      if (formData.direction === 'INWARD') {
        const purpose = formData.inward_purpose || 'CREDIT_SETTLEMENT';
        if (purpose === 'ADVANCE_DEPOSIT') {
          finalRefType = 'MANUAL_DEPOSIT';
          finalNotes = formData.notes.trim() ? `[Customer Advance] ${formData.notes.trim()}` : `Advance / Order Deposit from ${formData.party_name}`;
        } else if (purpose === 'SUPPLIER_REFUND') {
          finalRefType = 'EXPENSE';
          finalNotes = formData.notes.trim() ? `[Supplier Refund] ${formData.notes.trim()}` : `Supplier Refund / Rebate from ${formData.party_name}`;
        } else if (purpose === 'GENERAL_INCOME') {
          finalRefType = 'MANUAL_DEPOSIT';
          finalNotes = formData.notes.trim() ? `[Other Income] ${formData.notes.trim()}` : `General Income from ${formData.party_name}`;
        }
      }

      await api.cheques.create({
        direction: formData.direction,
        cheque_type: formData.cheque_type,
        cheque_number: formData.cheque_number.trim(),
        bank_name: bankNameToUse,
        branch: formData.branch.trim() || undefined,
        cheque_date: formData.cheque_date,
        amount: enteredAmt,
        party_id: formData.party_id || undefined,
        party_name: formData.party_name.trim(),
        reference_type: finalRefType,
        reference_id: finalRefId,
        status: initialStatus,
        notes: finalNotes,
        created_by: currentUser?.name || currentUser?.full_name || currentUser?.username || 'Sanoj Hardware',
        processed_by: currentUser?.name || currentUser?.full_name || currentUser?.username || 'Sanoj Hardware'
      });

      setToast({ message: `Cheque #${formData.cheque_number} registered successfully!`, type: 'success' });
      setShowAddModal(false);
      // Reset form
      setFormData({
        direction: 'OUTWARD',
        cheque_type: 'CROSSED_ACCOUNT_PAYEE',
        cheque_number: '',
        bank_name: 'Bank of Ceylon',
        custom_bank_name: '',
        branch: '',
        cheque_date: new Date().toISOString().split('T')[0],
        amount: '',
        party_type: 'SUPPLIER',
        party_id: '',
        party_name: '',
        inward_purpose: 'CREDIT_SETTLEMENT',
        reference_type: 'PURCHASE_ORDER',
        reference_id: '',
        notes: ''
      });
      fetchData();
    } catch (err: any) {
      console.error("Save Cheque Error:", err);
      setToast({ message: "Failed to save cheque: " + err.message, type: 'error' });
    }
  };

  // PDF Voucher Download
  const downloadChequeVoucherPDF = (cheque: Cheque) => {
    const doc = new jsPDF({ format: 'a5', orientation: 'landscape' });
    const pageWidth = doc.internal.pageSize.getWidth();

    // Dark Silver Header
    doc.setFillColor(70, 70, 70);
    doc.rect(0, 0, pageWidth, 26, 'F');

    // Title
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(cheque.direction === 'INWARD' ? 'INWARD CHEQUE RECEIPT VOUCHER' : 'OUTWARD CHEQUE PAYMENT VOUCHER', 12, 17);

    // Business details
    doc.setTextColor(80, 80, 80);
    doc.setFontSize(11);
    doc.text(shopSettings?.shop_name || "MUTHUWADIGE HARDWARE", 12, 36);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(shopSettings?.address || "No: 80, Mahahunupitiya, Negombo | Tel: 077 076 076 7", 12, 41);

    // Boxed Content
    doc.setDrawColor(220, 220, 220);
    doc.rect(12, 48, pageWidth - 24, 52);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text("Cheque Number:", 16, 56);
    doc.text("Bank & Branch:", 16, 64);
    doc.text("Cheque Date:", 16, 72);
    doc.text("Cheque Type:", 16, 80);
    doc.text("Party / Payee:", 16, 88);
    doc.text("Status:", 16, 96);

    doc.setFont('helvetica', 'normal');
    doc.text(`#${cheque.cheque_number}`, 55, 56);
    doc.text(`${cheque.bank_name} ${cheque.branch ? `(${cheque.branch})` : ''}`, 55, 64);
    doc.text(cheque.cheque_date, 55, 72);
    doc.text(cheque.cheque_type === 'CROSSED_ACCOUNT_PAYEE' ? 'Crossed / Account Payee (ගිණුමට පමණි)' : 'Cash / Bearer Cheque (මුදල්)', 55, 80);
    doc.text(cheque.party_name || 'N/A', 55, 88);
    doc.text(cheque.status, 55, 96);

    // Amount Box
    doc.setFillColor(245, 245, 245);
    doc.rect(12, 103, pageWidth - 24, 12, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text("Cheque Amount:", 16, 111);
    doc.setTextColor(218, 165, 32); // Gold
    doc.setFontSize(12);
    doc.text(`${symbol} ${Number(cheque.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, pageWidth - 20, 111, { align: 'right' });

    // Signatures
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.line(16, 136, 65, 136);
    const preparedByStaff = cheque.processed_by || (cheque as any).processedBy || (cheque as any).created_by || currentUser?.name || currentUser?.full_name || 'Sanoj Hardware';
    doc.text(`Prepared By: ${preparedByStaff}`, 40, 140, { align: 'center' });

    doc.line(pageWidth - 65, 136, pageWidth - 16, 136);
    doc.text("Authorized Signature / Payee", pageWidth - 40, 140, { align: 'center' });

    doc.save(`Cheque_${cheque.direction}_${cheque.cheque_number}.pdf`);
  };

  // Excel Export
  const handleExportExcel = () => {
    try {
      const dataToExport = filteredCheques.map(c => ({
        'Cheque No': c.cheque_number,
        'Direction': c.direction,
        'Type': c.cheque_type === 'CROSSED_ACCOUNT_PAYEE' ? 'Account Payee' : 'Cash Bearer',
        'Bank Name': c.bank_name,
        'Branch': c.branch || '',
        'Cheque Date': c.cheque_date,
        'Amount (Rs.)': Number(c.amount || 0),
        'Party / Payee': c.party_name || '',
        'Reference Type': c.reference_type || '',
        'Reference ID': c.reference_id || '',
        'Status': c.status,
        'Cleared At': c.cleared_at || '',
        'Notes': c.notes || '',
        'Recorded Date': c.created_at || ''
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(dataToExport);

      ws['!cols'] = [
        { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 18 },
        { wch: 14 }, { wch: 16 }, { wch: 25 }, { wch: 18 }, { wch: 20 },
        { wch: 14 }, { wch: 20 }, { wch: 30 }, { wch: 20 }
      ];

      XLSX.utils.book_append_sheet(wb, ws, "Cheque Registry");
      XLSX.writeFile(wb, `Cheque_Registry_${new Date().toISOString().split('T')[0]}.xlsx`);
      setToast({ message: "Cheque registry exported to Excel successfully!", type: 'success' });
    } catch (err: any) {
      setToast({ message: "Failed to export Excel: " + err.message, type: 'error' });
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Top Header & Actions Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-amber-100 text-amber-900 rounded-xl">
              <CreditCardIcon className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-black text-slate-900 uppercase tracking-wider">
                Cheque Registry & Transition Hub
              </h2>
              <p className="text-xs text-slate-500 font-semibold mt-0.5">
                චෙක්පත් ලියාපදිංචිය සහ නිෂ්කාශන මෙහෙයුම් පුවරුව (Inward & Outward Realizations)
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={fetchData}
            className="p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl border border-slate-200 transition-all"
            title="Refresh Registry"
          >
            <RefreshCwIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            className="px-3.5 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs rounded-xl border border-emerald-200 flex items-center gap-1.5 transition-all shadow-sm"
          >
            <DownloadIcon className="w-4 h-4" />
            <span>Excel</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black text-xs uppercase tracking-wider rounded-xl flex items-center gap-2 transition-all shadow-md hover:shadow-lg shadow-slate-900/10"
          >
            <PlusIcon className="w-4 h-4 text-amber-400" />
            <span>Issue / Record Cheque</span>
          </button>
        </div>
      </div>

      {/* Top KPI Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Pending Inward Cheques */}
        <div className="bg-gradient-to-br from-amber-500 to-amber-600 text-white p-5 rounded-2xl shadow-lg relative overflow-hidden group hover:translate-y-[-2px] transition-all duration-300">
          <div className="absolute top-0 right-0 w-28 h-28 bg-white/10 rounded-full -mr-12 -mt-12 blur-xl group-hover:scale-110 transition-all"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-100">⏳ Pending Inward Cheques</p>
              <p className="text-2xl font-black mt-1.5">{symbol} {metrics.pendingInwardValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            </div>
            <span className="px-2.5 py-1 bg-white/20 rounded-full text-xs font-black">
              {metrics.pendingInwardCount} Pending
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-amber-100">
            <span>Awaiting Bank Deposit & Clearing</span>
          </div>
        </div>

        {/* Cash Cheques in Hand / Drawer */}
        <div className="bg-gradient-to-br from-purple-600 to-indigo-700 text-white p-5 rounded-2xl shadow-lg relative overflow-hidden group hover:translate-y-[-2px] transition-all duration-300">
          <div className="absolute top-0 right-0 w-28 h-28 bg-white/10 rounded-full -mr-12 -mt-12 blur-xl group-hover:scale-110 transition-all"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-purple-200">💵 Cash Cheques In Hand</p>
              <p className="text-2xl font-black mt-1.5">{symbol} {metrics.cashInHandValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            </div>
            <span className="px-2.5 py-1 bg-white/20 rounded-full text-xs font-black">
              {metrics.cashInHandCount} In Hand
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-purple-200">
            <span>Bearer Cheques in Cash Drawer</span>
          </div>
        </div>

        {/* Realized / Cleared Cheques */}
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white p-5 rounded-2xl shadow-lg relative overflow-hidden group hover:translate-y-[-2px] transition-all duration-300">
          <div className="absolute top-0 right-0 w-28 h-28 bg-white/10 rounded-full -mr-12 -mt-12 blur-xl group-hover:scale-110 transition-all"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-100">🏦 Realized / Cleared</p>
              <p className="text-2xl font-black mt-1.5">{symbol} {metrics.clearedValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            </div>
            <span className="px-2.5 py-1 bg-white/20 rounded-full text-xs font-black">
              {metrics.clearedCount} Cleared
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-100">
            <span>Successfully Encashed & Realized</span>
          </div>
        </div>

        {/* Outward Supplier Cheques */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white p-5 rounded-2xl shadow-lg relative overflow-hidden group hover:translate-y-[-2px] transition-all duration-300">
          <div className="absolute top-0 right-0 w-28 h-28 bg-white/5 rounded-full -mr-12 -mt-12 blur-xl group-hover:scale-110 transition-all"></div>
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">📤 Outward Supplier Cheques</p>
              <p className="text-2xl font-black mt-1.5 text-amber-400">{symbol} {metrics.outwardValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
            </div>
            <span className="px-2.5 py-1 bg-white/10 rounded-full text-xs font-black text-amber-400">
              {metrics.outwardCount} Issued
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
            <span>Issued to Suppliers & Vendors</span>
          </div>
        </div>
      </div>

      {/* Advanced Filter Control Bar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-amber-500/20 transition-all">
            <SearchIcon className="w-4 h-4 text-slate-400 mr-2" />
            <input
              type="text"
              placeholder="Search Cheque #, Bank, Party..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 outline-none w-full"
            />
          </div>

          {/* Direction Filter */}
          <div>
            <select
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value as any)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none cursor-pointer"
            >
              <option value="ALL">All Directions (Inward & Outward)</option>
              <option value="INWARD">⬇ Inward Only (Customer Payments)</option>
              <option value="OUTWARD">⬆ Outward Only (Supplier Payments)</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">⏳ PENDING (A/C Payee)</option>
              <option value="IN_HAND">💵 IN_HAND (Cash Cheque)</option>
              <option value="CLEARED">✅ CLEARED / REALIZED</option>
              <option value="BOUNCED">❌ BOUNCED / RETURNED</option>
              <option value="CANCELLED">🚫 CANCELLED / VOID</option>
            </select>
          </div>

          {/* Maturity Filter */}
          <div>
            <select
              value={maturityFilter}
              onChange={(e) => setMaturityFilter(e.target.value as any)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none cursor-pointer"
            >
              <option value="ALL">All Maturities</option>
              <option value="POST_DATED">📅 Post-Dated (Future Cheques)</option>
              <option value="DUE_TODAY">🔔 Due Today</option>
              <option value="PAST_DUE">⚠️ Past Due / Mature</option>
            </select>
          </div>
        </div>

        {/* Date Range Picker Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-black uppercase tracking-wider text-slate-400 text-[10px]">Cheque Date Range:</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none cursor-pointer"
              />
              <span className="text-slate-400 font-bold">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none cursor-pointer"
              />
              {(startDate || endDate) && (
                <button
                  type="button"
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="text-xs font-bold text-rose-600 hover:underline ml-1"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="text-[11px] font-bold text-slate-500">
            Showing <span className="font-black text-slate-900">{filteredCheques.length}</span> of {cheques.length} Cheques
          </div>
        </div>
      </div>

      {/* Cheque Registry Data Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-16 text-center text-slate-500">
              <Loader2Icon className="animate-spin w-8 h-8 text-amber-500 mx-auto mb-3" />
              <p className="font-bold text-sm">Loading Cheque Registry...</p>
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-3.5 px-4">Date & Maturity</th>
                  <th className="py-3.5 px-4">Cheque No & Bank</th>
                  <th className="py-3.5 px-4">Flow / Type</th>
                  <th className="py-3.5 px-4">Party (Customer / Vendor)</th>
                  <th className="py-3.5 px-4">Linked Ref</th>
                  <th className="py-3.5 px-4 text-right">Amount</th>
                  <th className="py-3.5 px-4 text-center">Status</th>
                  <th className="py-3.5 px-4 text-center">Quick Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCheques.map((c) => {
                  const maturity = getMaturityStatus(c.cheque_date, c.status);
                  const isPostDated = c.cheque_date > todayStr && c.status === 'PENDING';

                  return (
                    <tr
                      key={c.id}
                      className={`hover:bg-amber-50/20 transition-colors ${
                        isPostDated ? 'bg-amber-50/10' : ''
                      }`}
                    >
                      {/* Date & Maturity */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-black text-slate-900">{c.cheque_date}</div>
                        <span
                          className={`inline-block mt-0.5 px-2 py-0.5 text-[9px] font-black rounded-full uppercase ${
                            maturity.color === 'emerald'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : maturity.color === 'amber'
                              ? 'bg-amber-100 text-amber-800 border border-amber-300'
                              : maturity.color === 'blue'
                              ? 'bg-blue-100 text-blue-800 border border-blue-300'
                              : maturity.color === 'rose'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {maturity.label}
                        </span>
                      </td>

                      {/* Cheque No & Bank */}
                      <td className="py-3.5 px-4">
                        <div className="font-black text-slate-900 font-mono text-sm">
                          #{c.cheque_number}
                        </div>
                        <div className="text-[11px] font-bold text-slate-600 mt-0.5">
                          {c.bank_name} {c.branch ? <span className="text-slate-400">({c.branch})</span> : ''}
                        </div>
                      </td>

                      {/* Flow / Type */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-start">
                          <span
                            className={`px-2.5 py-0.5 text-[9px] font-black rounded-md uppercase tracking-wider flex items-center gap-1 ${
                              c.direction === 'INWARD'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                : 'bg-blue-100 text-blue-800 border border-blue-300'
                            }`}
                          >
                            {c.direction === 'INWARD' ? <ArrowDownLeftIcon className="w-3 h-3" /> : <ArrowUpRightIcon className="w-3 h-3" />}
                            <span>{c.direction}</span>
                          </span>

                          <span className="text-[10px] font-bold text-slate-500">
                            {c.cheque_type === 'CROSSED_ACCOUNT_PAYEE' ? 'A/C Payee' : 'Cash Bearer'}
                          </span>
                        </div>
                      </td>

                      {/* Party Name */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{c.party_name || 'Walk-in Customer'}</div>
                        {c.notes && (
                          <div className="text-[10px] text-slate-400 truncate max-w-xs" title={c.notes}>
                            {c.notes}
                          </div>
                        )}
                      </td>

                      {/* Linked Reference */}
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-600">
                        {c.reference_id ? (
                          <div>
                            <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-sans font-black">
                              {c.reference_type || 'REF'}
                            </span>
                            <span>{c.reference_id}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <span className="text-sm font-black text-slate-900">
                          {symbol} {Number(c.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <span
                          className={`px-3 py-1 text-[10px] font-black rounded-xl uppercase tracking-wider inline-block ${
                            c.status === 'CLEARED'
                              ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/20'
                              : c.status === 'IN_HAND'
                              ? 'bg-purple-600 text-white shadow-sm shadow-purple-500/20'
                              : c.status === 'PENDING'
                              ? 'bg-amber-400 text-slate-950 font-black shadow-sm shadow-amber-400/20'
                              : c.status === 'BOUNCED'
                              ? 'bg-rose-600 text-white shadow-sm shadow-rose-500/20'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* If Pending / In Hand: Action Buttons */}
                          {(c.status === 'PENDING' || c.status === 'IN_HAND' || c.status === 'DEPOSITED') && (
                            <>
                              {/* Clear / Realize Button */}
                              <button
                                type="button"
                                onClick={() => setStatusActionCheque({ cheque: c, action: c.cheque_type === 'CASH_BEARER' ? 'CLEAR_CASH' : 'CLEAR_BANK' })}
                                className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-all shadow-sm"
                                title={c.cheque_type === 'CASH_BEARER' ? 'Encash to Drawer' : 'Clear & Realize to Bank'}
                              >
                                <CheckIcon className="w-3 h-3" />
                                <span>{c.cheque_type === 'CASH_BEARER' ? 'Encash' : 'Clear'}</span>
                              </button>

                              {/* Bounce Button */}
                              <button
                                type="button"
                                onClick={() => setStatusActionCheque({ cheque: c, action: 'BOUNCE' })}
                                className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-all"
                                title="Mark Cheque as Bounced / Returned"
                              >
                                <AlertTriangleIcon className="w-3 h-3" />
                                <span>Bounce</span>
                              </button>
                            </>
                          )}

                          {/* If Cleared or Bounced: Undo Reversal Action Button */}
                          {(c.status === 'CLEARED' || c.status === 'BOUNCED') && (
                            <button
                              type="button"
                              onClick={() => handleUndoCheque(c, c.direction === 'INWARD' && c.cheque_type === 'CASH_BEARER' ? 'IN_HAND' : 'PENDING')}
                              className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-all shadow-sm"
                              title={`Undo ${c.status === 'CLEARED' ? 'Clearance' : 'Bounce'} & Rollback Balances`}
                            >
                              <RotateCcwIcon className="w-3 h-3 text-amber-700" />
                              <span>Undo</span>
                            </button>
                          )}

                          {/* Print Voucher Button */}
                          <button
                            type="button"
                            onClick={() => setViewVoucherCheque(c)}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-all"
                            title="View / Print Cheque Voucher"
                          >
                            <PrinterIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredCheques.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-16 text-slate-400 font-bold">
                      <CreditCardIcon className="w-10 h-10 text-slate-300 mx-auto mb-2 opacity-50" />
                      <p>No matching cheque records found.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Manual Cheque Issuance / Registration Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Issue / Record Cheque (චෙක්පත් ලියාපදිංචිය)"
        size="lg"
      >
        <div className="space-y-4 p-1">
          {/* Direction Toggle */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
              Cheque Direction (චෙක්පත් දිශාව) *
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, direction: 'OUTWARD', party_type: 'SUPPLIER', reference_type: 'PURCHASE_ORDER' })}
                className={`py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all border flex items-center justify-center gap-2 ${
                  formData.direction === 'OUTWARD'
                    ? 'bg-slate-900 text-amber-400 border-slate-900 shadow-md'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <ArrowUpRightIcon className="w-4 h-4" />
                <span>Outward (Issued to Supplier)</span>
              </button>

              <button
                type="button"
                onClick={() => setFormData({ ...formData, direction: 'INWARD', party_type: 'CUSTOMER', reference_type: 'SALE_INVOICE' })}
                className={`py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all border flex items-center justify-center gap-2 ${
                  formData.direction === 'INWARD'
                    ? 'bg-slate-900 text-amber-400 border-slate-900 shadow-md'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <ArrowDownLeftIcon className="w-4 h-4" />
                <span>Inward (Received from Customer)</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Cheque Number */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Cheque Number (චෙක්පත් අංකය) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. CHQ-990011"
                value={formData.cheque_number}
                onChange={(e) => setFormData({ ...formData, cheque_number: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-sm"
              />
            </div>

            {/* Cheque Date */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Cheque Date (චෙක්පත් දිනය) <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={formData.cheque_date}
                onChange={(e) => setFormData({ ...formData, cheque_date: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 shadow-sm cursor-pointer"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Bank Name */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Bank Name (බැංකුව) <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.bank_name}
                onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm cursor-pointer"
              >
                {SRI_LANKAN_BANKS.map((b, idx) => (
                  <option key={idx} value={b}>{b}</option>
                ))}
              </select>
            </div>

            {/* Branch */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Branch (ශාඛාව - විකල්ප)
              </label>
              <input
                type="text"
                placeholder="e.g. Negombo Branch"
                value={formData.branch}
                onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm"
              />
            </div>
          </div>

          {formData.bank_name === 'Other' && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Specify Custom Bank Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Enter bank name..."
                value={formData.custom_bank_name}
                onChange={(e) => setFormData({ ...formData, custom_bank_name: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Amount */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Amount (මුදල - රු.) <span className="text-red-500">*</span>
                </label>
                {formData.direction === 'INWARD' && selectedCustObj && (
                  <span className={`text-[9px] font-bold ${Number(formData.amount || 0) > maxAllowedInwardAmount ? 'text-red-600 font-black' : 'text-slate-500'}`}>
                    Max: {symbol} {maxAllowedInwardAmount.toLocaleString()}
                  </span>
                )}
              </div>
              <input
                type="number"
                min={1}
                max={formData.direction === 'INWARD' && maxAllowedInwardAmount > 0 ? maxAllowedInwardAmount : undefined}
                placeholder="0.00"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || '' })}
                className={`w-full px-3.5 py-2.5 bg-white border rounded-xl text-xs font-bold text-slate-800 outline-none shadow-sm ${
                  formData.direction === 'INWARD' && Number(formData.amount || 0) > maxAllowedInwardAmount
                    ? 'border-red-500 focus:ring-1 focus:ring-red-500 text-red-700 bg-red-50/20'
                    : 'border-slate-200 focus:border-amber-500'
                }`}
              />
              {formData.direction === 'INWARD' && Number(formData.amount || 0) > maxAllowedInwardAmount && (
                <p className="text-[10px] text-red-600 font-bold mt-1">
                  ⚠️ Amount exceeds maximum allowed credit liability ({symbol} {maxAllowedInwardAmount.toLocaleString()})
                </p>
              )}
            </div>

            {/* Cheque Type */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Cheque Type (වර්ගය)
              </label>
              <select
                value={formData.cheque_type}
                onChange={(e) => setFormData({ ...formData, cheque_type: e.target.value as any })}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm cursor-pointer"
              >
                <option value="CROSSED_ACCOUNT_PAYEE">Crossed / Account Payee (ගිණුමට පමණි)</option>
                <option value="CASH_BEARER">Cash / Bearer Cheque (මුදල්)</option>
              </select>
            </div>
          </div>

          {/* Party Selection (Supplier / Customer) */}
          {formData.direction === 'INWARD' ? (
            <div className="space-y-4">
              <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-200/80 space-y-3">
                {/* Inward Purpose Selector */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">
                    Purpose / Receipt Reason (රිසිට්පතෙහි අරමුණ) <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.inward_purpose || 'CREDIT_SETTLEMENT'}
                    onChange={(e) => {
                      const newPurpose = e.target.value as any;
                      setFormData({
                        ...formData,
                        inward_purpose: newPurpose,
                        party_id: '',
                        party_name: '',
                        reference_type: newPurpose === 'CREDIT_SETTLEMENT' ? 'CREDIT_SETTLEMENT' : (newPurpose === 'SUPPLIER_REFUND' ? 'EXPENSE' : 'MANUAL_DEPOSIT'),
                        reference_id: '',
                        amount: ''
                      });
                    }}
                    className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl text-xs font-black text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] shadow-sm cursor-pointer"
                  >
                    <option value="CREDIT_SETTLEMENT">Customer Credit Settlement (පාරිභෝගික ණය පියවීම)</option>
                    <option value="ADVANCE_DEPOSIT">Advance / Order Deposit (අත්තිකාරම් මුදල්)</option>
                    <option value="SUPPLIER_REFUND">Supplier Refund / Rebate (සැපයුම්කරුගේ මුදල් ආපසු ගෙවීම)</option>
                    <option value="GENERAL_INCOME">General / Other Income (වෙනත් ආදායම්)</option>
                  </select>
                </div>

                {/* Purpose A: Customer Credit Settlement */}
                {formData.inward_purpose === 'CREDIT_SETTLEMENT' && (
                  <div className="space-y-3 pt-2 border-t border-amber-200/60">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                        <UserIcon className="w-3.5 h-3.5 text-[#DAA520]" />
                        <span>Customer Credit Settlement (පාරිභෝගික ණය පියවීම)</span>
                      </span>
                      {selectedCustObj && (
                        <span className="text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-700 px-2.5 py-0.5 rounded-full border border-rose-200">
                          Total Credit: {symbol} {selectedCustObj.activeCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Select Customer */}
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">
                          Select Customer (පාරිභෝගිකයා) <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={formData.party_id}
                          onChange={(e) => {
                            const custId = e.target.value;
                            const cust = creditCustomers.find(c => c.id === custId);
                            if (cust) {
                              const info = customerCreditMap.get(cust.id);
                              const firstInv = info && info.creditInvoices.length > 0 ? info.creditInvoices[0] : null;
                              setFormData({
                                ...formData,
                                party_id: cust.id,
                                party_name: cust.name,
                                reference_type: firstInv ? 'SALE_INVOICE' : 'CREDIT_SETTLEMENT',
                                reference_id: firstInv ? firstInv.invoiceNo : cust.id,
                                amount: firstInv ? firstInv.balance : (cust.activeCredit || '')
                              });
                            } else {
                              setFormData({
                                ...formData,
                                party_id: '',
                                party_name: '',
                                reference_type: 'CREDIT_SETTLEMENT',
                                reference_id: '',
                                amount: ''
                              });
                            }
                          }}
                          className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] shadow-sm cursor-pointer"
                        >
                          <option value="">-- Select Customer with Credit Balance --</option>
                          {creditCustomers
                            .filter(c => c.activeCredit > 0 || c.invoices.length > 0)
                            .map(c => (
                              <option key={c.id} value={c.id}>
                                {c.name} — Outstanding: {symbol} {c.activeCredit.toLocaleString()} ({c.invoices.length} Unpaid Invoices)
                              </option>
                            ))}
                          {creditCustomers.filter(c => c.activeCredit <= 0 && c.invoices.length === 0).length > 0 && (
                            <optgroup label="Other Customers (No Active Credit)">
                              {creditCustomers
                                .filter(c => c.activeCredit <= 0 && c.invoices.length === 0)
                                .map(c => (
                                  <option key={c.id} value={c.id}>
                                    {c.name} (Credit: {symbol} 0.00)
                                  </option>
                                ))}
                            </optgroup>
                          )}
                        </select>
                      </div>

                      {/* Select Linked Invoice */}
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">
                          Select Linked Invoice (ණය ඉන්වොයිසිය) <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={formData.reference_id}
                          disabled={!selectedCustObj}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'ALL' || !val) {
                              setFormData({
                                ...formData,
                                reference_type: 'CREDIT_SETTLEMENT',
                                reference_id: selectedCustObj ? selectedCustObj.id : '',
                                amount: selectedCustObj ? selectedCustObj.activeCredit : ''
                              });
                            } else {
                              const matchedInv = availableInvoices.find(inv => inv.invoiceNo === val || inv.id === val);
                              setFormData({
                                ...formData,
                                reference_type: 'SALE_INVOICE',
                                reference_id: val,
                                amount: matchedInv ? matchedInv.balance : formData.amount
                              });
                            }
                          }}
                          className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] shadow-sm cursor-pointer disabled:bg-slate-100 disabled:opacity-60"
                        >
                          {selectedCustObj ? (
                            <>
                              <option value="ALL">
                                All Unpaid Invoices / General Credit Balance ({symbol} {selectedCustObj.activeCredit.toLocaleString()})
                              </option>
                              {availableInvoices.map(inv => (
                                <option key={inv.id} value={inv.invoiceNo}>
                                  {inv.invoiceNo} (Remaining: {symbol} {inv.balance.toLocaleString()} | Total: {symbol} {inv.total.toLocaleString()})
                                </option>
                              ))}
                            </>
                          ) : (
                            <option value="">-- First Select a Customer Above --</option>
                          )}
                        </select>
                      </div>
                    </div>

                    {selectedCustObj && (
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-amber-200/50 text-[11px]">
                        <span className="font-bold text-slate-600">
                          Settlement Target: <span className="font-black text-slate-900">{formData.reference_type === 'SALE_INVOICE' ? `Invoice #${formData.reference_id}` : 'General Customer Credit Ledger'}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, amount: maxAllowedInwardAmount })}
                          className="px-2.5 py-1 bg-[#DAA520] hover:bg-[#b8860b] text-slate-950 font-black uppercase text-[10px] rounded-lg transition-colors shadow-sm"
                        >
                          Autofill Full Balance ({symbol} {maxAllowedInwardAmount.toLocaleString()})
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Purpose B: Advance / Order Deposit */}
                {formData.inward_purpose === 'ADVANCE_DEPOSIT' && (
                  <div className="space-y-3 pt-2 border-t border-amber-200/60">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">
                          Customer / Account Name <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={formData.party_id}
                          onChange={(e) => {
                            const cust = customers.find(c => c.id === e.target.value);
                            setFormData({
                              ...formData,
                              party_id: e.target.value,
                              party_name: cust ? cust.name : formData.party_name
                            });
                          }}
                          className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] shadow-sm cursor-pointer mb-1.5"
                        >
                          <option value="">-- Select from Registered Customers --</option>
                          {customers.map(c => (
                            <option key={c.id} value={c.id}>{c.name} ({c.phone || 'No phone'})</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          placeholder="Or type custom customer name..."
                          value={formData.party_name}
                          onChange={(e) => setFormData({ ...formData, party_name: e.target.value })}
                          className="w-full px-3.5 py-2 bg-white border border-amber-200 rounded-lg text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">
                          Order / Quotation Reference (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. QUOTE-2026-081 or Project Woodwork"
                          value={formData.reference_id}
                          onChange={(e) => setFormData({ ...formData, reference_id: e.target.value })}
                          className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] shadow-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Purpose C: Supplier Refund / Rebate */}
                {formData.inward_purpose === 'SUPPLIER_REFUND' && (
                  <div className="space-y-3 pt-2 border-t border-amber-200/60">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">
                          Supplier / Vendor Name <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={formData.party_id}
                          onChange={(e) => {
                            const sup = suppliers.find(s => s.id === e.target.value);
                            setFormData({
                              ...formData,
                              party_id: e.target.value,
                              party_name: sup ? sup.name : formData.party_name
                            });
                          }}
                          className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] shadow-sm cursor-pointer mb-1.5"
                        >
                          <option value="">-- Select from Registered Suppliers --</option>
                          {suppliers.map(s => (
                            <option key={s.id} value={s.id}>{s.name} ({s.phone || 'Supplier'})</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          placeholder="Or type supplier name..."
                          value={formData.party_name}
                          onChange={(e) => setFormData({ ...formData, party_name: e.target.value })}
                          className="w-full px-3.5 py-2 bg-white border border-amber-200 rounded-lg text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">
                          Debit Note / PO Reference
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. DN-2026-004 or PO-9910"
                          value={formData.reference_id}
                          onChange={(e) => setFormData({ ...formData, reference_id: e.target.value })}
                          className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] shadow-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Purpose D: General / Other Income */}
                {formData.inward_purpose === 'GENERAL_INCOME' && (
                  <div className="space-y-3 pt-2 border-t border-amber-200/60">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">
                          Payer / Organization Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Insurance Claim, Scrap Buyer, Rent"
                          value={formData.party_name}
                          onChange={(e) => setFormData({ ...formData, party_name: e.target.value })}
                          className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] shadow-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-600 mb-1">
                          Income Classification / Ref
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. Scrap Sale Voucher #44"
                          value={formData.reference_id}
                          onChange={(e) => setFormData({ ...formData, reference_id: e.target.value })}
                          className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] shadow-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Select Supplier (සැපයුම්කරු)
                  </label>
                  <select
                    value={formData.party_id}
                    onChange={(e) => {
                      const sup = suppliers.find(s => s.id === e.target.value);
                      setFormData({
                        ...formData,
                        party_id: e.target.value,
                        party_name: sup ? sup.name : formData.party_name
                      });
                    }}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm cursor-pointer"
                  >
                    <option value="">-- Select from Registered Suppliers --</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} (Payable: {symbol} {Number(s.payable_balance || (s as any).payableBalance || 0).toLocaleString()})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Party / Payee Name (නම) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Party or payee name..."
                    value={formData.party_name}
                    onChange={(e) => setFormData({ ...formData, party_name: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Reference Type */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Linked Reference Type
                  </label>
                  <select
                    value={formData.reference_type}
                    onChange={(e) => setFormData({ ...formData, reference_type: e.target.value as any })}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm cursor-pointer"
                  >
                    <option value="PURCHASE_ORDER">Purchase Order / GRN</option>
                    <option value="SALE_INVOICE">Sale Invoice</option>
                    <option value="CREDIT_SETTLEMENT">Customer Credit Settlement</option>
                    <option value="EXPENSE">Expense / Operational Bill</option>
                    <option value="MANUAL_DEPOSIT">Manual Bank Deposit</option>
                  </select>
                </div>

                {/* Reference ID */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Reference ID / Invoice # (විකල්ප)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. PO-1725000000, INV-9900"
                    value={formData.reference_id}
                    onChange={(e) => setFormData({ ...formData, reference_id: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm"
                  />
                </div>
              </div>
            </>
          )}

          {/* Notes */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
              Notes / Particulars (විස්තර)
            </label>
            <input
              type="text"
              placeholder="e.g. Settlement for cement supply batch #4"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm"
            />
          </div>

          {/* Modal Footer Buttons */}
          <div className="flex gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black uppercase tracking-wider text-xs rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveManualCheque}
              className="flex-2 py-3 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black uppercase tracking-wider text-xs rounded-xl transition-all shadow-lg"
            >
              Save Cheque Record
            </button>
          </div>
        </div>
      </Modal>

      {/* Status Transition Action Modal */}
      <Modal
        isOpen={!!statusActionCheque}
        onClose={() => setStatusActionCheque(null)}
        title={
          statusActionCheque?.action === 'CLEAR_BANK'
            ? `Deposit & Clear Cheque #${statusActionCheque?.cheque.cheque_number}`
            : statusActionCheque?.action === 'CLEAR_CASH'
            ? `Encash Cheque #${statusActionCheque?.cheque.cheque_number} to Cash Drawer`
            : statusActionCheque?.action === 'BOUNCE'
            ? `Mark Cheque #${statusActionCheque?.cheque.cheque_number} as BOUNCED`
            : `Cancel / Void Cheque #${statusActionCheque?.cheque.cheque_number}`
        }
        size="md"
      >
        {statusActionCheque && (
          <div className="space-y-4 p-1 text-left">
            {/* Cheque Summary Card */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Cheque #{statusActionCheque.cheque.cheque_number}
                </span>
                <span className="text-xs font-black text-amber-900 bg-amber-100 px-2.5 py-0.5 rounded-full">
                  {statusActionCheque.cheque.direction}
                </span>
              </div>
              <p className="text-xl font-black text-slate-900">
                {symbol} {Number(statusActionCheque.cheque.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              <p className="text-xs font-bold text-slate-600">
                {statusActionCheque.cheque.bank_name} | {statusActionCheque.cheque.party_name}
              </p>
            </div>

            {/* Bounce Reason Selector */}
            {statusActionCheque.action === 'BOUNCE' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                    Bounce / Return Reason (ප්‍රතික්ෂේප වීමට හේතුව) *
                  </label>
                  <select
                    value={bounceReason}
                    onChange={(e) => setBounceReason(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-rose-500 shadow-sm cursor-pointer"
                  >
                    <option value="Insufficient Funds / ගිණුමේ මුදල් ප්‍රමාණවත් නොවීම">Insufficient Funds / ගිණුමේ මුදල් ප්‍රමාණවත් නොවීම</option>
                    <option value="Signature Differs / අත්සන නොගැළපීම">Signature Differs / අත්සන නොගැළපීම</option>
                    <option value="Payment Stopped by Drawer / ගෙවීම නවතා ඇත">Payment Stopped by Drawer / ගෙවීම නවතා ඇත</option>
                    <option value="Post-Dated / Post-dated Cheque presented early">Post-Dated Presented Early</option>
                    <option value="Account Closed / ගිණුම වසා දමා ඇත">Account Closed / ගිණුම වසා දමා ඇත</option>
                    <option value="Other">Other Reason (Specify below)</option>
                  </select>
                </div>

                {bounceReason === 'Other' && (
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                      Specify Bounce Reason *
                    </label>
                    <input
                      type="text"
                      placeholder="Enter reason..."
                      value={customBounceReason}
                      onChange={(e) => setCustomBounceReason(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-rose-500 shadow-sm"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Notes Input */}
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Transaction Memo / Notes (සටහන්)
              </label>
              <input
                type="text"
                placeholder={
                  statusActionCheque.action === 'CLEAR_BANK'
                    ? "Deposited into BOC Account..."
                    : statusActionCheque.action === 'CLEAR_CASH'
                    ? "Encashed into counter drawer..."
                    : "Notes on return / cancellation..."
                }
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm"
              />
            </div>

            {/* Action Dialog Buttons */}
            <div className="flex gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setStatusActionCheque(null)}
                disabled={isSubmittingAction}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black uppercase tracking-wider text-xs rounded-xl transition-all"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleStatusTransitionSubmit}
                disabled={isSubmittingAction}
                className={`flex-2 py-3 text-white font-black uppercase tracking-wider text-xs rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 ${
                  statusActionCheque.action === 'BOUNCE'
                    ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                    : statusActionCheque.action === 'CANCEL'
                    ? 'bg-slate-700 hover:bg-slate-800 shadow-slate-700/20'
                    : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                }`}
              >
                {isSubmittingAction ? (
                  <Loader2Icon className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <CheckIcon className="w-4 h-4" />
                    <span>Confirm Action</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Printable Cheque Voucher Modal */}
      <Modal
        isOpen={!!viewVoucherCheque}
        onClose={() => setViewVoucherCheque(null)}
        title="Cheque Voucher Explorer"
        size="md"
      >
        {viewVoucherCheque && (
          <div className="space-y-5 p-1 text-left">
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 relative">
              <span
                className={`absolute top-4 right-4 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                  viewVoucherCheque.status === 'CLEARED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : viewVoucherCheque.status === 'BOUNCED'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-amber-100 text-amber-900'
                }`}
              >
                {viewVoucherCheque.status}
              </span>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {shopSettings?.shop_name || "MUTHUWADIGE HARDWARE"}
              </p>
              <h3 className="text-xl font-black text-slate-900 mt-1">
                {viewVoucherCheque.direction === 'INWARD' ? 'Inward Cheque Receipt' : 'Outward Cheque Payment'}
              </h3>
              <p className="text-xs text-slate-500 font-bold mt-0.5">
                Cheque #{viewVoucherCheque.cheque_number} — {viewVoucherCheque.bank_name}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Party / Payee</p>
                <p className="font-bold text-slate-800 mt-0.5">{viewVoucherCheque.party_name || 'N/A'}</p>
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cheque Date</p>
                <p className="font-bold text-slate-800 mt-0.5">{viewVoucherCheque.cheque_date}</p>
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cheque Type</p>
                <p className="font-bold text-slate-800 mt-0.5">
                  {viewVoucherCheque.cheque_type === 'CROSSED_ACCOUNT_PAYEE' ? 'Crossed (A/C Payee)' : 'Cash / Bearer'}
                </p>
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Linked Reference</p>
                <p className="font-bold font-mono text-slate-800 mt-0.5">{viewVoucherCheque.reference_id || '—'}</p>
              </div>

              <div className="col-span-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Particulars / Notes</p>
                <p className="font-bold text-slate-700 mt-0.5">{viewVoucherCheque.notes || 'No memo notes attached.'}</p>
              </div>

              <div className="col-span-2 bg-amber-50 p-4 rounded-xl border border-amber-200/80 flex justify-between items-center">
                <span className="text-xs font-black uppercase text-amber-900 tracking-wider">Cheque Total</span>
                <span className="text-xl font-black text-amber-900">
                  {symbol} {Number(viewVoucherCheque.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => downloadChequeVoucherPDF(viewVoucherCheque)}
                className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 text-amber-400 rounded-xl font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 shadow-lg"
              >
                <PrinterIcon className="w-4 h-4" />
                <span>Download PDF Voucher</span>
              </button>
              <button
                type="button"
                onClick={() => setViewVoucherCheque(null)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black uppercase tracking-wider text-xs transition-all"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={`flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl border backdrop-blur-md ${
              toast.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'
                : 'bg-red-500/10 border-red-500/20 text-red-600'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-lg ${
                toast.type === 'success'
                  ? 'bg-emerald-500 text-white shadow-emerald-500/30'
                  : 'bg-red-500 text-white shadow-red-500/30'
              }`}
            >
              <CheckCircleIcon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wider opacity-60">Cheque Registry</p>
              <p className="text-sm font-bold text-slate-800 mt-0.5">{toast.message}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
