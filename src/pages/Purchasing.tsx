import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  SearchIcon,
  PlusIcon,
  TruckIcon,
  CheckCircleIcon,
  XIcon,
  DownloadIcon,
  Loader2Icon,
  Trash2Icon,
  AlertTriangleIcon,
  RotateCcwIcon,
  PrinterIcon,
  EyeIcon,
  DollarSignIcon,
  Building2Icon,
  CalendarIcon,
  FileTextIcon,
  ShieldCheckIcon,
  FilterIcon,
  ArrowDownRightIcon,
  LayersIcon,
  WalletIcon,
  FileCheckIcon,
  ReceiptIcon,
  CreditCardIcon,
  BanIcon
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { supabase } from '../lib/supabaseClient';
import { api } from '../lib/api';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getCachedData, setCachedData } from '../services/dataCache';
import type { PurchaseOrder, PurchaseItem, Product, Supplier, PurchaseReturn, PurchaseReturnItem, PurchaseReturnSettlementMode } from '../types';
import { getTodaySriLankaDate } from '../utils/accounting';

type Tab = 'new' | 'history' | 'returns';

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

const statusColors: Record<string, string> = {
  received: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-[#464646]/10 text-[#464646]',
  cancelled: 'bg-red-100 text-red-700'
};

const settlementModeBadges: Record<string, { label: string; bg: string; text: string }> = {
  SUPPLIER_DEBIT_NOTE: { label: 'Supplier Debit Note', bg: 'bg-indigo-50 border-indigo-200', text: 'text-indigo-700' },
  CASH_REFUND: { label: 'Cash Refund', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
  BANK_REFUND: { label: 'Bank Refund', bg: 'bg-blue-50 border-blue-200', text: 'text-blue-700' }
};

interface ReturnLineItemDraft {
  productId: string;
  productName: string;
  sku: string;
  currentStock: number;
  quantity: number;
  unitCostPrice: number;
  subtotal: number;
}

interface PurchasingProps {
  currentUser?: any;
}

export function Purchasing({ currentUser }: PurchasingProps = {}) {
  const symbol = 'Rs.';
  const convert = (val: number) => val;

  const cachedOrders = getCachedData<PurchaseOrder[]>('purchaseOrders');
  const cachedProducts = getCachedData<Product[]>('products');
  const cachedSuppliers = getCachedData<Supplier[]>('suppliers');

  const [tab, setTab] = useState<Tab>('history');
  const [orders, setOrders] = useState<PurchaseOrder[]>(cachedOrders || []);
  const [suppliers, setSuppliers] = useState<string[]>(() => cachedSuppliers?.map(s => s.name) || []);
  const [supplierList, setSupplierList] = useState<Supplier[]>(cachedSuppliers || []);
  const [products, setProducts] = useState<Product[]>(cachedProducts || []);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>([]);

  // New PO State
  const [selectedSupplier, setSelectedSupplier] = useState<string>('');
  const [poItems, setPoItems] = useState<PurchaseItem[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [isLoading, setIsLoading] = useState(!cachedOrders);
  const [isSyncing, setIsSyncing] = useState(false);
  const [viewOrder, setViewOrder] = useState<PurchaseOrder | null>(null);
  const [selectedPoIds, setSelectedPoIds] = useState<string[]>([]);
  const [selectedDebitNoteCode, setSelectedDebitNoteCode] = useState<string>('');
  const [debitNoteApplied, setDebitNoteApplied] = useState<number>(0);

  // Purchase Returns State
  const [returnSearch, setReturnSearch] = useState<string>('');
  const [returnFilterMode, setReturnFilterMode] = useState<string>('ALL');
  const [isCreateReturnOpen, setIsCreateReturnOpen] = useState<boolean>(false);
  const [viewDebitNote, setViewDebitNote] = useState<PurchaseReturn | null>(null);

  // Create Return Form State
  const [returnSupplierId, setReturnSupplierId] = useState<string>('');
  const [returnSupplierName, setReturnSupplierName] = useState<string>('');
  const [returnPoId, setReturnPoId] = useState<string>('');
  const [returnItems, setReturnItems] = useState<ReturnLineItemDraft[]>([]);
  const [returnProductSearch, setReturnProductSearch] = useState<string>('');
  const [returnSettlementMode, setReturnSettlementMode] = useState<PurchaseReturnSettlementMode>('SUPPLIER_DEBIT_NOTE');
  const [returnReason, setReturnReason] = useState<string>('Damaged Stock');
  const [returnCustomReason, setReturnCustomReason] = useState<string>('');
  const [returnNotes, setReturnNotes] = useState<string>('');
  const [isSubmittingReturn, setIsSubmittingReturn] = useState<boolean>(false);
  const [itemStockError, setItemStockError] = useState<string>('');

  // Receive & Settle PO State
  const [receivingOrder, setReceivingOrder] = useState<PurchaseOrder | null>(null);
  const [receiveSettlementMode, setReceiveSettlementMode] = useState<'CREDIT' | 'CASH' | 'BANK' | 'CHEQUE'>('CREDIT');
  const [receivePaymentDate, setReceivePaymentDate] = useState<string>(getTodaySriLankaDate());
  const [receiveRef, setReceiveRef] = useState<string>('');
  const [receiveChequeNo, setReceiveChequeNo] = useState<string>('');
  const [receiveBankName, setReceiveBankName] = useState<string>(SRI_LANKA_BANKS[0]);
  const [receiveChequeDate, setReceiveChequeDate] = useState<string>(getTodaySriLankaDate());
  const [receiveNotes, setReceiveNotes] = useState<string>('');
  const [isSubmittingReceive, setIsSubmittingReceive] = useState<boolean>(false);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent && !getCachedData('purchaseOrders')) {
      setIsLoading(true);
    } else {
      setIsSyncing(true);
    }
    try {
      // 1. Fetch Products
      const { data: prodData } = await supabase.from('products').select('*');
      if (prodData) {
        setProducts(prodData);
        setCachedData('products', prodData);
      }

      // 2. Fetch Suppliers
      const { data: supplierData } = await supabase.from('suppliers').select('*');
      if (supplierData && supplierData.length > 0) {
        setSupplierList(supplierData);
        setSuppliers(supplierData.map((s: any) => s.name));
        setCachedData('suppliers', supplierData);
      } else if (prodData) {
        const uniqueSuppliers = Array.from(new Set(prodData.map((p) => p.supplier).filter(Boolean))) as string[];
        setSuppliers(uniqueSuppliers);
      }

      // 3. Fetch Purchase Orders
      const { data: poData } = await supabase
        .from('purchase_orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (poData) {
        const mappedOrders = poData.map((po: any) => ({
          ...po,
          poNumber: po.po_number !== undefined ? po.po_number : po.poNumber,
          supplierName: po.supplier_name !== undefined ? po.supplier_name : po.supplierName,
          dueDate: po.due_date !== undefined ? po.due_date : po.dueDate,
          date: po.created_at ? new Date(po.created_at).toLocaleDateString() : (po.date || new Date().toLocaleDateString())
        }));
        setOrders(mappedOrders);
        setCachedData('purchaseOrders', mappedOrders);
      }

      // 4. Fetch Purchase Returns
      try {
        const returnsData = await api.purchaseReturns.getAll();
        if (Array.isArray(returnsData)) {
          setPurchaseReturns(returnsData);
        }
      } catch (err) {
        console.warn('Failed to load purchase returns:', err);
      }
    } catch (err) {
      console.error('Error fetching purchasing data:', err);
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  }, []);

  useEffect(() => {
    setSelectedPoIds([]);
    fetchData();
    const handleRefresh = () => fetchData();
    window.addEventListener('refresh-all-data', handleRefresh);
    window.addEventListener('refresh-purchasing', handleRefresh);
    return () => {
      window.removeEventListener('refresh-all-data', handleRefresh);
      window.removeEventListener('refresh-purchasing', handleRefresh);
    };
  }, [tab]);

  // Selected supplier details helper
  const activeSupplierObj = useMemo(() => {
    return supplierList.find(s => s.id === returnSupplierId || s.name === returnSupplierName);
  }, [supplierList, returnSupplierId, returnSupplierName]);

  const poTotal = useMemo(() => poItems.reduce((sum, i) => sum + (i.total || 0), 0), [poItems]);

  // Active Debit Notes for Selected Supplier in New PO
  const availableSupplierDebitNotes = useMemo(() => {
    if (!selectedSupplier) return [];
    const supp = selectedSupplier.trim().toLowerCase();
    return purchaseReturns.filter(pr => {
      const prSuppName = (pr.supplier_name || pr.supplierName || '').trim().toLowerCase();
      const prSuppId = (pr.supplier_id || pr.supplierId || '').trim().toLowerCase();
      const mode = (pr.settlement_mode || pr.settlementMode || '').toUpperCase();
      const status = (pr.status || 'ACTIVE').toUpperCase();
      const bal = Number(pr.balance_remaining !== undefined && pr.balance_remaining !== null ? pr.balance_remaining : (pr.total_returned_cost || pr.totalReturnedCost || pr.total || 0));
      return (prSuppName === supp || prSuppId === supp) &&
        mode === 'SUPPLIER_DEBIT_NOTE' &&
        status !== 'VOIDED' && status !== 'REDEEMED' &&
        bal > 0;
    });
  }, [selectedSupplier, purchaseReturns]);

  const activeDebitBalance = useMemo(() => {
    return availableSupplierDebitNotes.reduce((sum, pr) => {
      const bal = Number(pr.balance_remaining !== undefined && pr.balance_remaining !== null ? pr.balance_remaining : (pr.total_returned_cost || pr.totalReturnedCost || pr.total || 0));
      return sum + bal;
    }, 0);
  }, [availableSupplierDebitNotes]);

  const matchedDebitNote = useMemo(() => {
    if (!selectedDebitNoteCode.trim()) return null;
    const q = selectedDebitNoteCode.trim().toUpperCase();
    return purchaseReturns.find(pr =>
      ((pr.return_number || pr.returnNumber || pr.id || '').toUpperCase() === q)
    ) || null;
  }, [selectedDebitNoteCode, purchaseReturns]);

  useEffect(() => {
    setSelectedDebitNoteCode('');
    setDebitNoteApplied(0);
  }, [selectedSupplier]);

  useEffect(() => {
    if (!selectedDebitNoteCode.trim()) {
      setDebitNoteApplied(0);
      return;
    }
    const q = selectedDebitNoteCode.trim().toUpperCase();
    const found = purchaseReturns.find(pr =>
      ((pr.return_number || pr.returnNumber || pr.id || '').toUpperCase() === q) &&
      (pr.status || 'ACTIVE').toUpperCase() !== 'VOIDED' &&
      (pr.status || 'ACTIVE').toUpperCase() !== 'REDEEMED'
    );
    if (found) {
      const bal = Number(found.balance_remaining !== undefined && found.balance_remaining !== null ? found.balance_remaining : (found.total_returned_cost || found.totalReturnedCost || found.total || 0));
      setDebitNoteApplied(Math.min(bal, poTotal));
    }
  }, [selectedDebitNoteCode, purchaseReturns, poTotal]);

  // Filtered Returns List
  const filteredPurchaseReturns = useMemo(() => {
    return purchaseReturns.filter(pr => {
      const matchSearch = returnSearch.trim() === '' ||
        (pr.return_number || pr.returnNumber || '').toLowerCase().includes(returnSearch.toLowerCase()) ||
        (pr.supplier_name || pr.supplierName || '').toLowerCase().includes(returnSearch.toLowerCase()) ||
        (pr.reason || '').toLowerCase().includes(returnSearch.toLowerCase()) ||
        (pr.items && pr.items.some(it => (it.product_name || (it as any).productName || '').toLowerCase().includes(returnSearch.toLowerCase())));

      const currentMode = (pr.settlement_mode || pr.settlementMode || '').toUpperCase();
      const matchMode = returnFilterMode === 'ALL' || currentMode === returnFilterMode;

      return matchSearch && matchMode;
    });
  }, [purchaseReturns, returnSearch, returnFilterMode]);

  // Purchase Returns Summary Math
  const totalReturnsValue = useMemo(() => {
    return purchaseReturns.reduce((sum, r) => sum + Number(r.total_returned_cost || r.totalReturnedCost || r.total || 0), 0);
  }, [purchaseReturns]);

  const totalDebitNotesValue = useMemo(() => {
    return purchaseReturns
      .filter(r => (r.settlement_mode || r.settlementMode) === 'SUPPLIER_DEBIT_NOTE')
      .reduce((sum, r) => sum + Number(r.total_returned_cost || r.totalReturnedCost || r.total || 0), 0);
  }, [purchaseReturns]);

  // --- PDF PURCHASE ORDER GENERATOR ---
  const downloadPO_PDF = (order: PurchaseOrder) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const gold = [218, 165, 32] as [number, number, number];
    const darkSilver = [70, 70, 70] as [number, number, number];

    doc.setFillColor(darkSilver[0], darkSilver[1], darkSilver[2]);
    doc.rect(0, 0, pageWidth, 45, 'F');

    doc.setFillColor(255, 255, 255);
    doc.rect(pageWidth - 65, 0, 45, 55, 'F');

    try {
      doc.addImage('./images/logo.png', 'PNG', pageWidth - 63.5, 2.5, 42, 42);
    } catch(e) {
      console.warn("Logo not found at ./images/logo.png");
    }

    doc.setTextColor(89, 89, 89); 
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text("PURCHASE ORDER", pageWidth / 2, 56, { align: 'center' }); 

    doc.setTextColor(255, 255, 255); 
    doc.setFontSize(18);
    doc.text("MUTHUWADIGE HARDWARE", 15, 20);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text("No: 80, Mahahunupitiya, Negombo", 15, 27);
    doc.text("Contact: 077 076 076 7 | sanojhardware@gmail.com", 15, 32);

    doc.setTextColor(50, 50, 50);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text("SUPPLIER:", 15, 65);
    doc.setFont('helvetica', 'normal');
    doc.text(order.supplierName, 15, 72);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(`PO Number:`, pageWidth - 80, 65);
    doc.text(`Order Date:`, pageWidth - 80, 72);
    doc.text(`Expected Date:`, pageWidth - 80, 79);
    
    doc.setFont('helvetica', 'normal');
    doc.text(order.poNumber, pageWidth - 15, 65, { align: 'right' });
    doc.text(order.date, pageWidth - 15, 72, { align: 'right' });
    doc.text(order.dueDate, pageWidth - 15, 79, { align: 'right' });

    doc.setDrawColor(220, 220, 220);
    doc.line(15, 85, pageWidth - 15, 85);

    autoTable(doc, {
      startY: 90,
      head: [['Item Name', 'Quantity', 'Unit Cost', 'Total']],
      body: order.items.map((i: any) => [
        i.productName, 
        i.qty, 
        `${symbol} ${convert(i.costPrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        `${symbol} ${convert(i.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
      ]),
      theme: 'plain',
      headStyles: { 
        fillColor: gold,
        textColor: 255, 
        fontStyle: 'bold',
        halign: 'center'
      },
      bodyStyles: { textColor: 50 },
      columnStyles: {
        0: { halign: 'left' },
        1: { halign: 'center' },
        2: { halign: 'right' },
        3: { halign: 'right' }
      },
      alternateRowStyles: { fillColor: [250, 250, 250] }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;
    const summaryXText = pageWidth - 65; 
    const summaryXValue = pageWidth - 15;

    doc.setFont('helvetica', 'bold');
    doc.setFillColor(245, 245, 245);
    doc.rect(summaryXText - 3, finalY, 56, 12, 'F');
    doc.setFontSize(11);
    doc.setTextColor(50, 50, 50);
    doc.text("Grand Total:", summaryXText, finalY + 8);
    doc.text(`${symbol} ${convert(order.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, summaryXValue, finalY + 8, { align: 'right' });

    doc.setFontSize(9);
    doc.setTextColor(218, 165, 32); 
    doc.text("NOTES", 15, finalY + 5);
    
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'normal');
    doc.text("Please deliver all items on or before the expected delivery date.", 15, finalY + 12);
    doc.setFont('helvetica', 'bold');
    doc.text("Thank you for your partnership!", 15, finalY + 19);

    doc.setDrawColor(150, 150, 150);
    doc.line(pageWidth - 60, finalY + 45, pageWidth - 15, finalY + 45);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    const createdByStaff = (order as any).created_by || (order as any).createdBy || currentUser?.name || currentUser?.full_name || 'Sanoj Hardware';
    doc.text(`Prepared By: ${createdByStaff}`, pageWidth - 37.5, finalY + 50, { align: 'center' });

    doc.setFillColor(darkSilver[0], darkSilver[1], darkSilver[2]);
    doc.rect(0, pageHeight - 15, pageWidth, 15, 'F');

    doc.save(`PurchaseOrder_${order.poNumber}.pdf`);
  };

  // --- PDF DEBIT NOTE / PURCHASE RETURN GENERATOR ---
  const downloadDebitNote_PDF = (ret: PurchaseReturn) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const gold = [218, 165, 32] as [number, number, number];
    const darkSilver = [70, 70, 70] as [number, number, number];

    // Dark header bar
    doc.setFillColor(darkSilver[0], darkSilver[1], darkSilver[2]);
    doc.rect(0, 0, pageWidth, 45, 'F');

    // Logo box
    doc.setFillColor(255, 255, 255);
    doc.rect(pageWidth - 65, 0, 45, 55, 'F');

    try {
      doc.addImage('./images/logo.png', 'PNG', pageWidth - 63.5, 2.5, 42, 42);
    } catch(e) {}

    // Title text
    doc.setTextColor(89, 89, 89);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text("DEBIT NOTE / PURCHASE RETURN", pageWidth / 2, 56, { align: 'center' });

    // Company Info in header
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.text("MUTHUWADIGE HARDWARE", 15, 20);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text("No: 80, Mahahunupitiya, Negombo", 15, 27);
    doc.text("Contact: 077 076 076 7 | sanojhardware@gmail.com", 15, 32);

    // Supplier Info
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text("SUPPLIER / VENDOR:", 15, 65);
    doc.setFont('helvetica', 'normal');
    doc.text(ret.supplier_name || ret.supplierName || 'Supplier', 15, 72);

    // Return Details
    const returnNumberStr = ret.return_number || ret.returnNumber || ret.id;
    const dateStr = ret.created_at ? new Date(ret.created_at).toLocaleDateString() : (ret.date || new Date().toLocaleDateString());
    const modeStr = (ret.settlement_mode || ret.settlementMode || '').replace(/_/g, ' ');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(`Debit Note No:`, pageWidth - 85, 65);
    doc.text(`Date:`, pageWidth - 85, 72);
    doc.text(`Settlement Mode:`, pageWidth - 85, 79);

    doc.setFont('helvetica', 'normal');
    doc.text(returnNumberStr, pageWidth - 15, 65, { align: 'right' });
    doc.text(dateStr, pageWidth - 15, 72, { align: 'right' });
    doc.text(modeStr, pageWidth - 15, 79, { align: 'right' });

    doc.setDrawColor(220, 220, 220);
    doc.line(15, 85, pageWidth - 15, 85);

    // Table of returned items
    const items = ret.items || [];
    autoTable(doc, {
      startY: 90,
      head: [['Item Description', 'Qty Returned', 'Unit Cost (Rs.)', 'Total Returned (Rs.)']],
      body: items.map((i: any) => [
        i.product_name || i.productName || 'Hardware Item',
        i.quantity !== undefined ? i.quantity : (i.qty || 0),
        `${(Number(i.unit_cost_price !== undefined ? i.unit_cost_price : (i.unitCostPrice || i.costPrice || 0))).toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
        `${(Number(i.subtotal !== undefined ? i.subtotal : (Number(i.quantity || i.qty || 0) * Number(i.unit_cost_price || i.unitCostPrice || 0)))).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
      ]),
      theme: 'plain',
      headStyles: {
        fillColor: gold,
        textColor: 255,
        fontStyle: 'bold',
        halign: 'center'
      },
      bodyStyles: { textColor: 50 },
      columnStyles: {
        0: { halign: 'left' },
        1: { halign: 'center' },
        2: { halign: 'right' },
        3: { halign: 'right' }
      },
      alternateRowStyles: { fillColor: [250, 250, 250] }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 10;
    const summaryXText = pageWidth - 72;
    const summaryXValue = pageWidth - 15;

    // Totals Box
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(245, 245, 245);
    doc.rect(summaryXText - 3, finalY, 63, 12, 'F');
    doc.setFontSize(11);
    doc.setTextColor(50, 50, 50);
    doc.text("Total Debit Value:", summaryXText, finalY + 8);
    const totalVal = Number(ret.total_returned_cost !== undefined ? ret.total_returned_cost : (ret.totalReturnedCost || ret.total || 0));
    doc.text(`${symbol} ${totalVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, summaryXValue, finalY + 8, { align: 'right' });

    // Reason & Note Section
    doc.setFontSize(9);
    doc.setTextColor(218, 165, 32);
    doc.text("RETURN REASON & ACCOUNTING ADJUSTMENT", 15, finalY + 5);

    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'normal');
    doc.text(`Reason: ${ret.reason || 'Damaged / Defective Stock Returned'}`, 15, finalY + 12);
    if (ret.notes) {
      doc.text(`Remarks: ${ret.notes}`, 15, finalY + 18);
    }
    const currentModeKey = ret.settlement_mode || ret.settlementMode;
    const noteText = currentModeKey === 'SUPPLIER_DEBIT_NOTE'
      ? 'Amount debited directly against Supplier Accounts Payable balance.'
      : (currentModeKey === 'CASH_REFUND' ? 'Supplier settled return value via direct Cash Refund.' : 'Supplier settled return value via Bank Transfer.');
    doc.setFont('helvetica', 'bold');
    doc.text(`Settlement: ${noteText}`, 15, finalY + (ret.notes ? 24 : 18));

    // Dual Signatures
    doc.setDrawColor(150, 150, 150);
    doc.line(15, finalY + 45, 75, finalY + 45);
    doc.line(pageWidth - 75, finalY + 45, pageWidth - 15, finalY + 45);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    const handledByStaff = ret.handled_by || (ret as any).handledBy || (ret as any).created_by_name || currentUser?.name || currentUser?.full_name || 'Sanoj Hardware';
    doc.text(`Handled By: ${handledByStaff}`, 45, finalY + 50, { align: 'center' });
    doc.text("Supplier / Driver Representative", pageWidth - 45, finalY + 50, { align: 'center' });

    // Bottom dark bar
    doc.setFillColor(darkSilver[0], darkSilver[1], darkSilver[2]);
    doc.rect(0, pageHeight - 15, pageWidth, 15, 'F');

    doc.save(`DebitNote_${returnNumberStr}.pdf`);
  };

  // Browser Direct Print for Debit Note
  const triggerPrintDebitNote = () => {
    window.print();
  };

  // PO Line Items Handling
  const addItem = (product: any) => {
    setPoItems((prev) => {
      if (prev.find((i) => i.productId === product.id)) return prev;
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          supplier: product.supplier || '',
          qty: 1,
          costPrice: product.costPrice || product.cost_price || 0,
          total: product.costPrice || product.cost_price || 0
        } as any
      ];
    });
    setProductSearch('');
  };

  const updateItem = (productId: string, field: 'qty' | 'costPrice', value: number) => {
    setPoItems((prev) =>
      prev.map((i) => {
        if (i.productId !== productId) return i;
        const updated = { ...i, [field]: value };
        return { ...updated, total: updated.qty * updated.costPrice };
      })
    );
  };

  const createPO = async () => {
    if (!selectedSupplier) {
      alert("Please select a registered supplier.");
      return;
    }
    if (poItems.length === 0) {
      alert("Please add at least one item to generate a Purchase Order.");
      return;
    }

    if (!dueDate) {
      alert("Please select an expected delivery date.");
      return;
    }
    
    const selectedDate = new Date(dueDate);
    const today = new Date();
    selectedDate.setHours(0,0,0,0);
    today.setHours(0,0,0,0);
    if (selectedDate < today) {
      alert("Expected delivery date cannot be in the past.");
      return;
    }

    for (const item of poItems) {
      if (item.qty < 1) {
        alert(`Quantity for ${item.productName} must be at least 1.`);
        return;
      }
      if (item.costPrice <= 0) {
        alert(`Unit cost for ${item.productName} must be greater than 0.`);
        return;
      }
    }

    const finalDebitNoteApplied = Math.min(debitNoteApplied, poTotal);
    const finalPayable = Math.max(0, poTotal - finalDebitNoteApplied);

    if (finalDebitNoteApplied > 0 && selectedDebitNoteCode.trim()) {
      const q = selectedDebitNoteCode.trim().toUpperCase();
      const found = purchaseReturns.find(pr =>
        ((pr.return_number || pr.returnNumber || pr.id || '').toUpperCase() === q)
      );
      if (!found) {
        alert(`Debit Note code "${selectedDebitNoteCode}" not found in system.`);
        return;
      }
      const avail = Number(found.balance_remaining !== undefined && found.balance_remaining !== null ? found.balance_remaining : (found.total_returned_cost || found.totalReturnedCost || found.total || 0));
      if (avail <= 0 || (found.status || '').toUpperCase() === 'VOIDED' || (found.status || '').toUpperCase() === 'REDEEMED') {
        alert(`Debit Note "${selectedDebitNoteCode}" is fully used or voided.`);
        return;
      }
    }

    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const staffName = currentUser?.name || currentUser?.full_name || currentUser?.username || 'Sanoj Hardware';
      const { error } = await supabase.from('purchase_orders').insert([{
        po_number: `PO-${Date.now().toString().slice(-6)}`,
        supplier_name: selectedSupplier,
        items: poItems,
        total: finalPayable,
        original_total: poTotal,
        debit_note_code: finalDebitNoteApplied > 0 ? selectedDebitNoteCode.trim().toUpperCase() : null,
        debit_note_applied: finalDebitNoteApplied,
        status: 'pending',
        due_date: dueDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        user_id: user?.id,
        created_by: staffName
      }]);
      if (error) throw error;
      setPoItems([]);
      setSelectedDebitNoteCode('');
      setDebitNoteApplied(0);
      setTab('history');
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const openReceiveModal = (order: PurchaseOrder) => {
    setReceivingOrder(order);
    setReceiveSettlementMode('CREDIT');
    setReceivePaymentDate(getTodaySriLankaDate());
    setReceiveRef(`PO-REC-${order.poNumber || Date.now().toString().slice(-6)}`);
    setReceiveChequeNo('');
    setReceiveBankName(SRI_LANKA_BANKS[0]);
    setReceiveChequeDate(getTodaySriLankaDate());
    setReceiveNotes('');
  };

  const handleConfirmReceiveAndSettle = async () => {
    if (!receivingOrder) return;
    if (receiveSettlementMode === 'CHEQUE') {
      if (!receiveChequeNo.trim()) {
        alert("Please enter a valid Cheque Number.");
        return;
      }
      if (!receiveBankName.trim()) {
        alert("Please select a Bank.");
        return;
      }
      if (!receiveChequeDate) {
        alert("Please specify the Cheque Date.");
        return;
      }
    }

    setIsSubmittingReceive(true);
    try {
      const staffEmail = currentUser?.email || currentUser?.name || 'admin@hardware.com';

      // 1. Attempt Atomic Backend Settlement
      try {
        const result = await api.purchasing.receivePo({
          po_id: receivingOrder.id,
          po_number: receivingOrder.poNumber,
          settlement_mode: receiveSettlementMode,
          payment_date: receivePaymentDate,
          reference: receiveRef,
          notes: receiveNotes,
          cheque_number: receiveChequeNo,
          bank_name: receiveBankName,
          cheque_date: receiveChequeDate,
          user_email: staffEmail
        });

        if (result && result.success) {
          alert(`✅ Purchase Order #${receivingOrder.poNumber} received & restocked successfully (${receiveSettlementMode})!`);
          setReceivingOrder(null);
          await fetchData();
          window.dispatchEvent(new CustomEvent('refresh-all-data'));
          window.dispatchEvent(new CustomEvent('refresh-purchasing'));
          window.dispatchEvent(new CustomEvent('refresh-inventory'));
          window.dispatchEvent(new CustomEvent('refresh-finance'));
          window.dispatchEvent(new CustomEvent('refresh-dashboard'));
          window.dispatchEvent(new CustomEvent('suppliers-updated'));
          return;
        }
      } catch (apiErr: any) {
        console.warn("Backend atomic receive-po notice, applying fallback:", apiErr);
      }

      // Fallback Direct Operations
      const { data: { user } } = await supabase.auth.getUser();

      // 1. Update PO Status
      const { error: poError } = await supabase
        .from('purchase_orders')
        .update({ status: 'received' })
        .eq('id', receivingOrder.id);
      if (poError) throw poError;

      // 2. Increase Stock Levels & Log Adjustments using Batch Versioning (preserve original cost, fork batch SKU if costs diverge)
      const updatedOrderItems: any[] = [];
      for (const item of receivingOrder.items) {
        const product = products.find(p => p.id === item.productId);
        if (product) {
          const currentStock = Number(product.stock || 0);
          const currentCost = Number(product.cost_price !== undefined && product.cost_price !== null ? product.cost_price : (product.costPrice || 0));
          const itemCost = Number(item.costPrice || (item as any).cost_price || 0);
          const qty = Number(item.qty || 0);

          if (itemCost > 0 && Math.abs(itemCost - currentCost) >= 0.01) {
            // Divergent cost: check for existing batch with matching cost or create new batch
            const baseSku = (product.sku || 'SKU').replace(/-B\d+$/i, '').trim();
            const baseName = (product.name || 'Product').replace(/\s*\(Batch\s*\d+\)$/i, '').trim();
            const rootParentId = product.parent_product_id || product.id;

            const existingBatch = products.find(p => {
              const pBase = (p.sku || '').replace(/-B\d+$/i, '').trim();
              const pCost = Number(p.cost_price !== undefined && p.cost_price !== null ? p.cost_price : (p.costPrice || 0));
              return (pBase === baseSku || p.parent_product_id === rootParentId) && Math.abs(pCost - itemCost) < 0.01;
            });

            if (existingBatch) {
              const newStock = Number(existingBatch.stock || 0) + qty;
              await supabase.from('products').update({ stock: newStock }).eq('id', existingBatch.id);
              updatedOrderItems.push({
                ...item,
                receivedProductId: existingBatch.id,
                receivedSku: existingBatch.sku,
                isNewBatch: false
              });
            } else {
              // Calculate next batch number
              const familyBatches = products.filter(p => (p.sku || '').startsWith(baseSku) || p.parent_product_id === rootParentId);
              let maxBatch = 1;
              familyBatches.forEach(p => {
                const m = (p.sku || '').match(/-B(\d+)$/i);
                if (m) {
                  const n = parseInt(m[1], 10);
                  if (n > maxBatch) maxBatch = n;
                }
              });
              const nextBatch = maxBatch + 1;
              const newSku = `${baseSku}-B${nextBatch}`;
              const newName = `${baseName} (Batch ${nextBatch})`;
              const catalogPrice = Number(product.price || 0);
              const markupRatio = currentCost > 0 ? (catalogPrice / currentCost) : 1.25;
              const newSellingPrice = Math.round(itemCost * Math.max(1.0, markupRatio) * 100) / 100;
              const baseBarcode = (product.barcode || 'HW' + Date.now().toString().slice(-6)).trim();
              const newBarcode = `${baseBarcode}-B${nextBatch}`;
              const newBatchId = 'p_batch_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

              await supabase.from('products').insert([{
                id: newBatchId,
                name: newName,
                sku: newSku,
                category: product.category || 'General',
                price: newSellingPrice,
                cost_price: itemCost,
                stock: qty,
                min_stock: product.minStock !== undefined ? product.minStock : (product.min_stock !== undefined ? product.min_stock : 5),
                supplier: receivingOrder.supplierName || product.supplier,
                unit: product.unit || 'PCS',
                barcode: newBarcode,
                brand: product.brand || '',
                measure_details: product.measureDetails || (product as any).measure_details,
                parent_product_id: rootParentId,
                is_batch: true,
                batch_number: nextBatch
              }]);

              updatedOrderItems.push({
                ...item,
                receivedProductId: newBatchId,
                receivedSku: newSku,
                isNewBatch: true,
                batchNumber: nextBatch
              });
            }
          } else {
            // Cost matches: standard stock increment, cost unchanged
            const newStock = currentStock + qty;
            await supabase.from('products').update({ stock: newStock }).eq('id', item.productId);
            updatedOrderItems.push({
              ...item,
              receivedProductId: item.productId,
              receivedSku: product.sku,
              isNewBatch: false
            });
          }

          try {
            await api.stockAdjustments.create({
              product_id: item.productId,
              product_name: item.productName || product.name,
              previous_stock: currentStock,
              new_stock: currentStock + qty,
              adjustment: Number(item.qty || 0),
              adjustment_type: 'INCREASE',
              reason: `PO Received #${receivingOrder.poNumber}`,
              user_name: currentUser?.name || currentUser?.full_name || currentUser?.username || 'Sanoj Hardware'
            });
          } catch (_saErr) {
            console.warn("Stock adjustment log notice:", _saErr);
          }
        } else {
          updatedOrderItems.push(item);
        }
      }

      try {
        await supabase.from('purchase_orders').update({ items: updatedOrderItems }).eq('id', receivingOrder.id);
      } catch (_e) {}

      // 3. Process Settlement Action
      const poAmount = Number(receivingOrder.total || 0);
      const supplierObj = supplierList.find(s => 
        s.name.toLowerCase().trim() === (receivingOrder.supplierName || '').toLowerCase().trim()
      );

      if (receiveSettlementMode === 'CREDIT') {
        if (supplierObj) {
          const currentBal = Number(supplierObj.payableBalance || 0);
          await supabase.from('suppliers').update({
            payable_balance: Math.round((currentBal + poAmount) * 100) / 100
          }).eq('id', supplierObj.id);
        } else {
          const { data: supps } = await supabase.from('suppliers').select('*').eq('name', receivingOrder.supplierName);
          if (supps && supps.length > 0) {
            const currentBal = Number(supps[0].payable_balance || 0);
            await supabase.from('suppliers').update({
              payable_balance: Math.round((currentBal + poAmount) * 100) / 100
            }).eq('id', supps[0].id);
          }
        }
      } else if (receiveSettlementMode === 'CASH' || receiveSettlementMode === 'BANK') {
        await supabase.from('transactions').insert([{
          type: 'expense',
          category: 'Supplier Payment',
          description: `PO #${receivingOrder.poNumber} Received & Settled (${receiveSettlementMode === 'CASH' ? 'Cash' : 'Bank Transfer'}) - ${receivingOrder.supplierName}`,
          amount: poAmount,
          date: receivePaymentDate || getTodaySriLankaDate(),
          reference: receiveRef || receivingOrder.poNumber,
          user_id: user?.id || null
        }]);
      } else if (receiveSettlementMode === 'CHEQUE') {
        await api.cheques.create({
          direction: 'OUTWARD',
          cheque_type: 'CROSSED_ACCOUNT_PAYEE',
          cheque_number: receiveChequeNo.trim(),
          bank_name: receiveBankName.trim(),
          cheque_date: receiveChequeDate,
          amount: poAmount,
          party_id: supplierObj?.id || null,
          party_name: receivingOrder.supplierName,
          reference_type: 'PURCHASE_ORDER',
          reference_id: receivingOrder.id || receivingOrder.poNumber,
          status: 'PENDING',
          notes: receiveNotes.trim() || `Issued for Purchase Order #${receivingOrder.poNumber}`
        });
      }

      alert(`✅ Purchase Order #${receivingOrder.poNumber} received & restocked successfully (${receiveSettlementMode})!`);
      setReceivingOrder(null);
      await fetchData();
      window.dispatchEvent(new CustomEvent('refresh-all-data'));
      window.dispatchEvent(new CustomEvent('refresh-purchasing'));
      window.dispatchEvent(new CustomEvent('refresh-inventory'));
      window.dispatchEvent(new CustomEvent('refresh-finance'));
      window.dispatchEvent(new CustomEvent('refresh-dashboard'));
      window.dispatchEvent(new CustomEvent('suppliers-updated'));
    } catch (err: any) {
      alert("Error receiving purchase order: " + err.message);
    } finally {
      setIsSubmittingReceive(false);
    }
  };

  // Purchase Return Line Item Helpers
  const addReturnItem = (product: Product) => {
    setItemStockError('');
    const stockVal = Number(product.stock || 0);
    if (stockVal <= 0) {
      setItemStockError(`Cannot return "${product.name}". Current available inventory stock is 0.`);
      return;
    }

    setReturnItems(prev => {
      const existing = prev.find(i => i.productId === product.id);
      if (existing) {
        if (existing.quantity >= stockVal) {
          setItemStockError(`Cannot add more "${product.name}". Max on-hand stock is ${stockVal}.`);
          return prev;
        }
        return prev.map(i => {
          if (i.productId === product.id) {
            const nextQty = i.quantity + 1;
            return { ...i, quantity: nextQty, subtotal: nextQty * i.unitCostPrice };
          }
          return i;
        });
      }

      const costPriceVal = Number(product.costPrice !== undefined ? product.costPrice : (product.cost_price || 0));
      return [
        ...prev,
        {
          productId: product.id,
          productName: product.name,
          sku: product.sku || '',
          currentStock: stockVal,
          quantity: 1,
          unitCostPrice: costPriceVal,
          subtotal: costPriceVal
        }
      ];
    });
    setReturnProductSearch('');
  };

  const updateReturnItemQty = (productId: string, rawQty: number) => {
    setItemStockError('');
    setReturnItems(prev => prev.map(i => {
      if (i.productId !== productId) return i;
      if (rawQty > i.currentStock) {
        setItemStockError(`Quantity for "${i.productName}" cannot exceed on-hand stock (${i.currentStock}).`);
        rawQty = i.currentStock;
      }
      const safeQty = Math.max(1, rawQty);
      return {
        ...i,
        quantity: safeQty,
        subtotal: safeQty * i.unitCostPrice
      };
    }));
  };

  const updateReturnItemPrice = (productId: string, rawPrice: number) => {
    setReturnItems(prev => prev.map(i => {
      if (i.productId !== productId) return i;
      const safePrice = Math.max(0, rawPrice);
      return {
        ...i,
        unitCostPrice: safePrice,
        subtotal: i.quantity * safePrice
      };
    }));
  };

  const removeReturnItem = (productId: string) => {
    setReturnItems(prev => prev.filter(i => i.productId !== productId));
  };

  const returnGrandTotal = useMemo(() => {
    return returnItems.reduce((sum, item) => sum + item.subtotal, 0);
  }, [returnItems]);

  const resetReturnForm = () => {
    setReturnSupplierId('');
    setReturnSupplierName('');
    setReturnPoId('');
    setReturnItems([]);
    setReturnProductSearch('');
    setReturnSettlementMode('SUPPLIER_DEBIT_NOTE');
    setReturnReason('Damaged Stock');
    setReturnCustomReason('');
    setReturnNotes('');
    setItemStockError('');
  };

  // Submit Purchase Return Form
  const handleSubmitPurchaseReturn = async () => {
    if (!returnSupplierName) {
      alert("Please select a vendor / supplier.");
      return;
    }

    if (returnItems.length === 0) {
      alert("Please add at least one line item to return.");
      return;
    }

    for (const item of returnItems) {
      if (item.quantity <= 0) {
        alert(`Return quantity for ${item.productName} must be at least 1.`);
        return;
      }
      if (item.quantity > item.currentStock) {
        alert(`Cannot return ${item.quantity} of "${item.productName}". Available on-hand stock is only ${item.currentStock}.`);
        return;
      }
      if (item.unitCostPrice < 0) {
        alert(`Unit cost price for ${item.productName} cannot be negative.`);
        return;
      }
    }

    setIsSubmittingReturn(true);
    try {
      const staffName = currentUser?.name || currentUser?.full_name || currentUser?.username || 'Sanoj Hardware';
      const effectiveReason = returnReason === 'Other' ? (returnCustomReason || 'Other Return') : returnReason;

      const payload = {
        supplier_id: returnSupplierId || (activeSupplierObj ? activeSupplierObj.id : ''),
        supplier_name: returnSupplierName,
        purchase_order_id: returnPoId || null,
        settlement_mode: returnSettlementMode,
        reason: effectiveReason,
        notes: returnNotes,
        handled_by: staffName,
        items: returnItems.map(it => ({
          product_id: it.productId,
          product_name: it.productName,
          quantity: it.quantity,
          unit_cost_price: it.unitCostPrice,
          subtotal: it.subtotal
        }))
      };

      const result = await api.purchaseReturns.create(payload);

      if (result && result.success) {
        // Refresh all local datasets
        await fetchData();
        resetReturnForm();
        setIsCreateReturnOpen(false);

        // Open Debit Note modal immediately for review/print
        setViewDebitNote(result);
        alert(`✅ Purchase Return ${result.returnNumber || result.return_number} generated successfully!`);
      } else {
        throw new Error(result?.error || 'Failed to create purchase return');
      }
    } catch (err: any) {
      alert("Error creating purchase return: " + err.message);
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  // Void Purchase Return Action
  const handleVoidPurchaseReturn = async (returnNo: string) => {
    const reason = window.prompt(
      'Enter reason for voiding this return voucher (ආපසු යැවීම අවලංගු කිරීමට හේතුව):',
      'Accidental duplicate entry'
    );
    if (!reason || !reason.trim()) return;

    try {
      const { data, error } = await supabase.rpc('void_purchase_return', {
        p_return_no: returnNo,
        p_void_reason: reason.trim()
      });

      if (error || !data?.success) {
        alert(error?.message || data?.message || 'Failed to void purchase return.');
      } else {
        alert('Return voucher voided and stock/cash corrected.');
        await fetchData();
        window.dispatchEvent(new CustomEvent('refresh-inventory'));
        window.dispatchEvent(new CustomEvent('refresh-all-data'));
      }
    } catch (err: any) {
      alert('Error voiding purchase return: ' + err.message);
    }
  };

  // Revert Received PO Action
  const handleRevertPurchaseOrderReceipt = async (poRef: string) => {
    if (!window.confirm(`Are you sure you want to revert received Purchase Order #${poRef} back to PENDING?\n\nThis will:\n- Deduct received stock from inventory\n- Deduct supplier payable liability balance\n- Reset status to PENDING`)) {
      return;
    }

    try {
      const { data, error } = await supabase.rpc('revert_purchase_order_receipt', {
        p_po_ref: poRef
      });

      if (error || !data?.success) {
        alert(error?.message || data?.message || 'Failed to revert purchase order receipt.');
      } else {
        alert('PO receipt reverted to PENDING and stock/payables restored.');
        await fetchData();
        window.dispatchEvent(new CustomEvent('refresh-inventory'));
        window.dispatchEvent(new CustomEvent('refresh-all-data'));
      }
    } catch (err: any) {
      alert('Error reverting purchase order receipt: ' + err.message);
    }
  };

  const allFilteredSelected = orders.length > 0 && orders.every((order) => selectedPoIds.includes(order.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedPoIds((prev) => prev.filter((id) => !orders.some((order) => order.id === id)));
    } else {
      setSelectedPoIds((prev) => Array.from(new Set([...prev, ...orders.map((order) => order.id)])));
    }
  };

  const handleToggleSelectPo = (orderId: string) => {
    setSelectedPoIds((prev) =>
      prev.includes(orderId)
        ? prev.filter((id) => id !== orderId)
        : [...prev, orderId]
    );
  };

  const handleDeleteOrder = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this purchase order?")) {
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.from('purchase_orders').delete().eq('id', id);
      if (error) throw error;
      setSelectedPoIds((prev) => prev.filter((selectedId) => selectedId !== id));
      fetchData();
    } catch (err: any) {
      alert("Failed to delete purchase order: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkDeleteOrders = async () => {
    if (selectedPoIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete the ${selectedPoIds.length} selected purchase orders?`)) {
      return;
    }

    setIsLoading(true);
    try {
      const results: any[] = [];
      for (const orderId of selectedPoIds) {
        const res = await supabase.from('purchase_orders').delete().eq('id', orderId);
        results.push(res);
      }
      const firstError = results.find((r: any) => r?.error);
      if (firstError) throw firstError.error;
      setSelectedPoIds([]);
      fetchData();
    } catch (err: any) {
      alert("Failed to delete selected purchase orders: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAllOrders = async () => {
    if (orders.length === 0) return;
    if (!window.confirm("WARNING: Are you sure you want to delete ALL purchase orders? This action is permanent and cannot be undone.")) {
      return;
    }
    
    if (!window.confirm("Confirm once more: Do you really want to clear the entire purchase order history?")) {
      return;
    }

    setIsLoading(true);
    try {
      const results: any[] = [];
      for (const order of orders) {
        const res = await supabase.from('purchase_orders').delete().eq('id', order.id);
        results.push(res);
      }
      const firstError = results.find((r: any) => r?.error);
      if (firstError) throw firstError.error;
      setSelectedPoIds([]);
      fetchData();
    } catch (err: any) {
      alert("Failed to delete all purchase orders: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 animate-in fade-in duration-500">
      {/* Top Navigation Tabs Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-white p-1 rounded-xl w-fit border border-gray-200 shadow-sm">
          <button 
            onClick={() => setTab('history')} 
            className={`px-5 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${tab === 'history' ? 'bg-[#464646] text-white shadow-md' : 'text-gray-500 hover:text-[#464646] hover:bg-gray-50'}`}
          >
            <TruckIcon className="w-4 h-4" /> Order History
          </button>
          <button 
            onClick={() => setTab('new')} 
            className={`px-5 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${tab === 'new' ? 'bg-[#464646] text-white shadow-md' : 'text-gray-500 hover:text-[#464646] hover:bg-gray-50'}`}
          >
            <PlusIcon className="w-4 h-4" /> New PO
          </button>
          <button 
            onClick={() => setTab('returns')} 
            className={`px-5 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${tab === 'returns' ? 'bg-[#DAA520] text-slate-900 shadow-md font-extrabold' : 'text-gray-500 hover:text-[#DAA520] hover:bg-amber-50/50'}`}
          >
            <RotateCcwIcon className="w-4 h-4" /> Purchase Returns / Debit Notes
          </button>
        </div>

        {tab === 'returns' && (
          <button
            onClick={() => setIsCreateReturnOpen(true)}
            className="flex items-center gap-2 bg-[#DAA520] hover:bg-[#B8860B] text-slate-900 px-5 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-[#DAA520]/20 transition-all uppercase tracking-wider"
          >
            <PlusIcon className="w-4 h-4 text-slate-900" /> New Purchase Return / ආපසු යැවීම
          </button>
        )}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: NEW PURCHASE ORDER                                                  */}
      {/* ========================================================================= */}
      {tab === 'new' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4">
          <div className="xl:col-span-2 space-y-4">
            <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
              <h3 className="text-sm font-black text-[#464646] mb-3 uppercase tracking-widest">Vendor Selection</h3>
              <select 
                value={selectedSupplier} 
                onChange={(e) => setSelectedSupplier(e.target.value)} 
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520] bg-white cursor-pointer transition-all"
              >
                <option value="">Select a registered supplier...</option>
                {suppliers.map((s, idx) => <option key={idx} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
              <h3 className="text-sm font-black text-[#464646] mb-3 uppercase tracking-widest">Item Catalog Search</h3>
              <div className="relative mb-4">
                <div className="flex items-center gap-3 bg-gray-50/50 border border-gray-200 rounded-xl px-4 py-3 focus-within:ring-2 focus-within:ring-[#DAA520]/20 transition-all">
                  <SearchIcon className="w-5 h-5 text-gray-400 focus-within:text-[#DAA520]" />
                  <input 
                    type="text" 
                    placeholder="Search by product name..." 
                    value={productSearch} 
                    onChange={(e) => setProductSearch(e.target.value)} 
                    className="bg-transparent text-sm font-bold text-[#464646] outline-none w-full" 
                  />
                </div>
                {products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()) && productSearch.length > 0).length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-100 rounded-xl shadow-xl z-[100] max-h-60 overflow-y-auto custom-scrollbar">
                    {products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase()) && productSearch.length > 0).map((p) => (
                      <button key={p.id} onClick={() => addItem(p)} className="w-full flex justify-between items-center px-5 py-4 hover:bg-gray-50 text-sm transition-colors border-b border-gray-50 last:border-0 text-left">
                        <span className="font-black text-[#464646]">{p.name}</span>
                        <span className="font-black text-[#DAA520]">{symbol} {convert(p.costPrice || p.cost_price || 0).toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {poItems.length > 0 ? (
                <div className="overflow-x-auto mt-6 border border-slate-100 rounded-2xl">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-black text-slate-400 tracking-widest">
                            <tr>
                              <th className="py-4 px-6">Item Name</th>
                              <th className="py-4 text-center">Qty</th>
                              <th className="py-4 text-right">Cost Price ({symbol})</th>
                              <th className="py-4 text-right px-6">Total</th>
                              <th className="py-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {poItems.map((item) => {
                              const prodObj = products.find(p => p.id === item.productId);
                              const itemSupplier = ((item as any).supplier || prodObj?.supplier || '').trim();
                              const hasMismatch = Boolean(selectedSupplier.trim() && itemSupplier && itemSupplier.toLowerCase() !== selectedSupplier.trim().toLowerCase());

                              return (
                                <tr key={item.productId} className="group hover:bg-teal-50/20 transition-colors">
                                    <td className="py-4 px-6">
                                      <div className="font-black text-slate-800">{item.productName}</div>
                                      {hasMismatch && (
                                        <div className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-md bg-amber-50 border border-amber-300 text-amber-900 text-[10px] font-black tracking-tight">
                                          <span className="text-amber-600">⚠️</span>
                                          <span>Default: {itemSupplier}</span>
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-4 text-center">
                                      <input 
                                        type="number" 
                                        min={0} 
                                        step="any"
                                        value={item.qty === 0 ? '' : item.qty} 
                                        onFocus={(e) => e.target.select()}
                                        onChange={(e) => {
                                          const valStr = e.target.value;
                                          const val = valStr === '' ? 0 : Math.max(0, parseFloat(valStr) || 0);
                                          updateItem(item.productId, 'qty', val);
                                        }}
                                        onBlur={() => {
                                          if (!item.qty || item.qty <= 0) {
                                            updateItem(item.productId, 'qty', 1);
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            (e.target as HTMLElement).blur();
                                          }
                                        }}
                                        className="w-16 text-center border border-slate-200 bg-white rounded-lg py-1.5 font-bold text-slate-800 focus:ring-2 focus:ring-[#DAA520] outline-none" 
                                      />
                                    </td>
                                    <td className="py-4 text-right"><input type="number" step="0.01" value={item.costPrice === 0 ? '' : item.costPrice} onChange={(e) => updateItem(item.productId, 'costPrice', parseFloat(e.target.value) || 0)} className="w-24 text-right border border-slate-200 bg-white rounded-lg py-1.5 px-3 font-bold text-slate-800 focus:ring-2 focus:ring-[#DAA520] outline-none" /></td>
                                    <td className="py-4 text-right font-black text-[#DAA520] px-6">{symbol} {convert(item.total).toLocaleString()}</td>
                                    <td className="py-4 text-center px-4">
                                      <button onClick={() => setPoItems(poItems.filter(i => i.productId !== item.productId))} className="p-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-500 hover:text-white border border-red-100 transition-all shadow-sm shadow-red-500/10">
                                        <XIcon className="w-4 h-4" />
                                      </button>
                                    </td>
                                </tr>
                              );
                            })}
                        </tbody>
                    </table>
                </div>
              ) : (
                <div className="py-12 text-center text-gray-400">
                    <TruckIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-bold">Add hardware items to generate an official PO.</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-xl p-6 h-fit sticky top-20">
            <h3 className="text-sm font-black uppercase tracking-widest mb-6 border-b border-gray-100 pb-4 text-[#464646]">PO Summary</h3>
            <div className="space-y-6">
                <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Expected Delivery</label>
                    <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full px-4 py-3 border border-gray-200 rounded-xl font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520] transition-all" />
                </div>

                {/* Debit Note / Supplier Credit Input Card (Matching Sales Credit Note Design) */}
                <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[9px] font-black text-indigo-950 uppercase tracking-wider flex items-center gap-1.5">
                      <span>💳</span> Debit Note / Supplier Credit
                    </label>
                    {activeDebitBalance > 0 && (
                      <span className="text-[9px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                        Avail: {symbol} {convert(activeDebitBalance).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {/* Dropdown / Code Input Combo */}
                  <div className="space-y-1.5">
                    {availableSupplierDebitNotes.length > 0 && (
                      <select
                        value={selectedDebitNoteCode}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedDebitNoteCode(val);
                          if (val) {
                            const found = purchaseReturns.find((pr: any) => (pr.return_number || pr.returnNumber || pr.id) === val);
                            if (found) {
                              const bal = Number(found.balance_remaining !== undefined && found.balance_remaining !== null ? found.balance_remaining : (found.total_returned_cost || found.totalReturnedCost || found.total || 0));
                              setDebitNoteApplied(Math.min(bal, poTotal));
                            }
                          } else {
                            setDebitNoteApplied(0);
                          }
                        }}
                        className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-indigo-500 shadow-sm"
                      >
                        <option value="">-- Select Active Supplier Debit Note --</option>
                        {availableSupplierDebitNotes.map((pr: any) => {
                          const code = pr.return_number || pr.returnNumber || pr.id;
                          const bal = Number(pr.balance_remaining !== undefined && pr.balance_remaining !== null ? pr.balance_remaining : (pr.total_returned_cost || pr.totalReturnedCost || pr.total || 0));
                          return (
                            <option key={pr.id} value={code}>
                              {code} - {symbol} {convert(bal).toLocaleString()}
                            </option>
                          );
                        })}
                      </select>
                    )}

                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Enter/Scan Debit Note Code (e.g. PR-...)"
                        value={selectedDebitNoteCode}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          setSelectedDebitNoteCode(val);
                          const found = purchaseReturns.find((pr: any) => (pr.return_number || pr.returnNumber || pr.id || '').toUpperCase() === val.trim() && (pr.status || 'ACTIVE').toUpperCase() !== 'VOIDED' && (pr.status || 'ACTIVE').toUpperCase() !== 'REDEEMED');
                          if (found) {
                            const bal = Number(found.balance_remaining !== undefined && found.balance_remaining !== null ? found.balance_remaining : (found.total_returned_cost || found.totalReturnedCost || found.total || 0));
                            setDebitNoteApplied(Math.min(bal, poTotal));
                          } else {
                            setDebitNoteApplied(0);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = selectedDebitNoteCode.trim().toUpperCase();
                            const found = purchaseReturns.find((pr: any) => (pr.return_number || pr.returnNumber || pr.id || '').toUpperCase() === val && (pr.status || 'ACTIVE').toUpperCase() !== 'VOIDED' && (pr.status || 'ACTIVE').toUpperCase() !== 'REDEEMED');
                            if (found) {
                              const bal = Number(found.balance_remaining !== undefined && found.balance_remaining !== null ? found.balance_remaining : (found.total_returned_cost || found.totalReturnedCost || found.total || 0));
                              setDebitNoteApplied(Math.min(bal, poTotal));
                            } else if (val) {
                              alert("Debit Note code not found or already redeemed.");
                            }
                          }
                        }}
                        className="w-full px-3 py-2 bg-white border border-indigo-200 rounded-xl text-xs font-mono font-bold text-indigo-900 outline-none placeholder-slate-400 focus:border-indigo-500 shadow-sm"
                      />
                    </div>
                  </div>

                  {/* Auto-Detected Debit Note Banner */}
                  {matchedDebitNote && (() => {
                    const origVal = Number(matchedDebitNote.total_returned_cost || matchedDebitNote.totalReturnedCost || matchedDebitNote.total || 0);
                    const availBal = Number(matchedDebitNote.balance_remaining !== undefined && matchedDebitNote.balance_remaining !== null ? matchedDebitNote.balance_remaining : origVal);
                    const usedVal = Math.max(0, origVal - availBal);
                    const st = (matchedDebitNote.status || 'ACTIVE').toUpperCase();
                    const isFullyUsed = st === 'REDEEMED' || st === 'VOIDED' || availBal <= 0;
                    const isPartiallyUsed = !isFullyUsed && (st === 'PARTIALLY_REDEEMED' || usedVal > 0);

                    return (
                      <div className={`border rounded-xl p-3 space-y-2 animate-in fade-in duration-200 ${
                        isFullyUsed ? 'bg-rose-50 border-rose-200' : isPartiallyUsed ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'
                      }`}>
                        <div className="flex justify-between items-center text-xs font-black">
                          <span className="font-mono text-slate-800">
                            {matchedDebitNote.return_number || matchedDebitNote.returnNumber || matchedDebitNote.id}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                            isFullyUsed ? 'bg-rose-200 text-rose-800' : isPartiallyUsed ? 'bg-amber-200 text-amber-800' : 'bg-emerald-200 text-emerald-800'
                          }`}>
                            {isFullyUsed ? 'Redeemed' : isPartiallyUsed ? 'Partially Used' : 'Available'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-[10px] font-bold text-slate-600">
                          <span>Available Balance:</span>
                          <span className="font-black text-slate-800">{symbol} {convert(availBal).toLocaleString()}</span>
                        </div>
                        {!isFullyUsed && poTotal > 0 && (
                          <div className="flex justify-between items-center text-[10px] font-bold text-indigo-700 bg-indigo-50/80 px-2 py-1 rounded-lg">
                            <span>Applied to this PO:</span>
                            <span className="font-black">-{symbol} {convert(debitNoteApplied).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="pt-5 border-t border-gray-100 space-y-4">
                    <div className="flex justify-between text-sm font-black text-gray-400 uppercase tracking-widest">
                      <span>SKU Count</span>
                      <span className="font-black text-[#464646]">{poItems.reduce((sum, item) => sum + (item.qty || 0), 0)}</span>
                    </div>

                    {debitNoteApplied > 0 && (
                      <>
                        <div className="flex justify-between text-xs font-bold text-slate-500">
                          <span>Gross Subtotal</span>
                          <span className="font-bold text-slate-700">{symbol} {convert(poTotal).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-xs font-black text-indigo-600">
                          <span>Debit Note Applied ({selectedDebitNoteCode})</span>
                          <span>-{symbol} {convert(debitNoteApplied).toLocaleString()}</span>
                        </div>
                      </>
                    )}

                    <div className="flex justify-between font-black text-2xl text-[#464646] pt-5 border-t-2 border-dashed border-gray-200">
                        <span className="uppercase tracking-widest text-lg flex items-center">Total Pay</span>
                        <span className="text-[#DAA520]">{symbol} {convert(Math.max(0, poTotal - debitNoteApplied)).toLocaleString()}</span>
                    </div>
                </div>
                <button onClick={createPO} disabled={!selectedSupplier || poItems.length === 0 || isLoading} className="w-full bg-[#DAA520] text-white font-black py-4 rounded-xl shadow-lg shadow-[#DAA520]/20 hover:bg-[#B8860B] disabled:bg-gray-100 disabled:text-gray-300 transition-all flex items-center justify-center gap-3 uppercase tracking-widest text-xs">
                    {isLoading ? <Loader2Icon className="animate-spin" /> : <PlusIcon className="w-4 h-4" />}
                    Generate Purchase Order
                </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: ORDER HISTORY                                                       */}
      {/* ========================================================================= */}
      {tab === 'history' && (
        <div className="space-y-4 animate-in slide-in-from-right-4 duration-500">
          <div className="flex justify-between items-center bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
            <h3 className="text-sm font-black text-[#464646] uppercase tracking-widest">Order History List</h3>
            <button 
              onClick={handleDeleteAllOrders} 
              disabled={orders.length === 0}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-100 disabled:text-gray-300 text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-red-600/20 transition-all uppercase tracking-widest shrink-0"
            >
              <Trash2Icon className="w-4 h-4" /> Delete All Orders
            </button>
          </div>

          {selectedPoIds.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-center gap-4 animate-in slide-in-from-top-5 duration-300">
              <div className="flex items-center gap-2.5 text-red-800 font-bold text-sm">
                <AlertTriangleIcon className="w-5 h-5 text-red-600 animate-pulse" />
                <span>{selectedPoIds.length} purchase order(s) selected for bulk actions</span>
              </div>
              <button
                onClick={handleBulkDeleteOrders}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-red-600/20 transition-all uppercase tracking-widest shrink-0"
              >
                <Trash2Icon className="w-4 h-4" /> Delete Selected
              </button>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden text-left">
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white">Purchase Orders Ledger</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Track purchase orders, delivery statuses, totals, and receipts</p>
              </div>
              <span className="px-3 py-1.5 bg-teal-500/20 text-teal-400 text-xs font-black rounded-full border border-teal-500/30">
                {orders.length} Purchase Orders
              </span>
            </div>
            <div className="overflow-x-auto">
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
                      <th className="px-6 py-4">PO Reference</th>
                      <th className="px-6 py-4">Created On</th>
                      <th className="px-6 py-4">Supplier Name</th>
                      <th className="px-6 py-4 text-center">SKUs</th>
                      <th className="px-6 py-4">Arrival Date</th>
                      <th className="px-6 py-4 text-right">Grand Total ({symbol})</th>
                      <th className="px-6 py-4 text-center">Status</th>
                      <th className="px-6 py-4 text-center">Actions</th>
                  </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                  {orders.map((order) => (
                      <tr key={order.id} className="hover:bg-teal-50/20 transition-colors group">
                      <td className="px-6 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedPoIds.includes(order.id)}
                          onChange={() => handleToggleSelectPo(order.id)}
                          className="rounded border-gray-300 text-[#DAA520] focus:ring-[#DAA520] cursor-pointer w-4 h-4"
                        />
                      </td>
                      <td className="px-6 py-4 font-black text-slate-800">{order.poNumber}</td>
                      <td className="px-6 py-4 text-slate-500 font-bold">{order.date}</td>
                      <td className="px-6 py-4 font-black text-slate-800">{order.supplierName}</td>
                      <td className="px-6 py-4 text-center"><span className="bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider">{order.items?.length || 0} ITEMS</span></td>
                      <td className="px-6 py-4 text-slate-500 font-bold">{order.dueDate}</td>
                      <td className="px-6 py-4 text-right font-black text-[#DAA520]">{symbol} {convert(order.total).toLocaleString()}</td>
                      <td className="px-6 py-4 text-center">
                          <span className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest ${statusColors[order.status]}`}>{order.status}</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                          <div className="flex gap-2 justify-center items-center">
                            <button onClick={() => setViewOrder(order)} className="text-[10px] font-black uppercase tracking-widest bg-slate-50 border border-slate-200 hover:bg-slate-200 px-4 py-2.5 rounded-xl text-slate-600 transition-all shadow-sm">Details</button>
                            <button onClick={() => downloadPO_PDF(order)} className="p-2.5 rounded-xl bg-slate-50 text-slate-500 hover:bg-[#DAA520] hover:text-white border border-slate-100 transition-all shadow-sm" title="Download PDF"><DownloadIcon className="w-5 h-5" /></button>
                            {order.status === 'pending' && (
                                <button onClick={() => openReceiveModal(order)} className="text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white border border-emerald-100 px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5 shadow-sm shadow-emerald-500/10"><CheckCircleIcon className="w-3.5 h-3.5" /> Receive & Settle</button>
                            )}
                            {order.status === 'received' && (
                                <button onClick={() => handleRevertPurchaseOrderReceipt(order.poNumber || order.id)} className="text-[10px] font-black uppercase tracking-widest bg-amber-50 text-amber-800 hover:bg-amber-600 hover:text-white border border-amber-200 px-4 py-2.5 rounded-xl transition-all flex items-center gap-1.5 shadow-sm shadow-amber-500/10" title="Revert PO Receipt & Restock Deduct"><RotateCcwIcon className="w-3.5 h-3.5" /> Revert Receipt</button>
                            )}
                            <button onClick={() => handleDeleteOrder(order.id)} className="p-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-500 hover:text-white border border-red-100 transition-all shadow-sm shadow-red-500/10" title="Delete Order"><Trash2Icon className="w-5 h-5" /></button>
                          </div>
                      </td>
                      </tr>
                  ))}
                  </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: PURCHASE RETURNS & DEBIT NOTES                                       */}
      {/* ========================================================================= */}
      {tab === 'returns' && (
        <div className="space-y-4 animate-in slide-in-from-left-4 duration-500">
          {/* Summary Cards Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Returns Value</p>
                <p className="text-2xl font-black text-[#DAA520] mt-1">{symbol} {totalReturnsValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                <p className="text-[10px] text-slate-400 font-bold mt-0.5">Cumulative returned inventory cost</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center text-[#DAA520] shadow-sm">
                <RotateCcwIcon className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Return Vouchers Count</p>
                <p className="text-2xl font-black text-slate-800 mt-1">{purchaseReturns.length} <span className="text-sm font-bold text-slate-400">Batches</span></p>
                <p className="text-[10px] text-slate-400 font-bold mt-0.5">Supplier return operations logged</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 shadow-sm">
                <FileTextIcon className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Settled via Debit Notes</p>
                <p className="text-2xl font-black text-indigo-600 mt-1">{symbol} {totalDebitNotesValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                <p className="text-[10px] text-slate-400 font-bold mt-0.5">Debited against supplier payable balances</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm">
                <Building2Icon className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-3">
            <div className="flex flex-1 items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 w-full sm:max-w-md focus-within:ring-2 focus-within:ring-[#DAA520]/20">
              <SearchIcon className="w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by Return #, Supplier, Reason, or Item..."
                value={returnSearch}
                onChange={(e) => setReturnSearch(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-800 outline-none w-full"
              />
              {returnSearch && (
                <button onClick={() => setReturnSearch('')} className="text-gray-400 hover:text-gray-600">
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest shrink-0">Filter:</span>
              <select
                value={returnFilterMode}
                onChange={(e) => setReturnFilterMode(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-slate-700 outline-none bg-white cursor-pointer"
              >
                <option value="ALL">All Settlement Modes</option>
                <option value="SUPPLIER_DEBIT_NOTE">Supplier Debit Note</option>
                <option value="CASH_REFUND">Cash Refund</option>
                <option value="BANK_REFUND">Bank Refund</option>
              </select>
            </div>
          </div>

          {/* Purchase Returns Ledger Table */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden text-left">
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white">Purchase Returns & Supplier Debit Notes</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Complete ledger of returned stock items, supplier debit adjustments, and cash refunds</p>
              </div>
              <span className="px-3 py-1.5 bg-amber-500/20 text-[#DAA520] text-xs font-black rounded-full border border-amber-500/30">
                {filteredPurchaseReturns.length} Return Records
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <tr>
                    <th className="px-6 py-4">Return Voucher #</th>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Supplier Name</th>
                    <th className="px-6 py-4 text-center">Items Returned</th>
                    <th className="px-6 py-4 text-right">Returned Cost ({symbol})</th>
                    <th className="px-6 py-4 text-center">Settlement Mode</th>
                    <th className="px-6 py-4">Reason</th>
                    <th className="px-6 py-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredPurchaseReturns.length > 0 ? (
                    filteredPurchaseReturns.map((ret) => {
                      const modeKey = ret.settlement_mode || ret.settlementMode || 'SUPPLIER_DEBIT_NOTE';
                      const isVoided = (ret.status || '').toUpperCase() === 'VOIDED';
                      const badgeInfo = settlementModeBadges[modeKey] || { label: modeKey, bg: 'bg-gray-100', text: 'text-gray-700' };
                      const itemsCount = (ret.items && ret.items.length) || 0;
                      const returnNumberVal = ret.return_number || ret.returnNumber || ret.id;
                      const dateVal = ret.created_at ? new Date(ret.created_at).toLocaleDateString() : (ret.date || '-');
                      const totalVal = Number(ret.total_returned_cost !== undefined ? ret.total_returned_cost : (ret.totalReturnedCost || ret.total || 0));

                      return (
                        <tr key={ret.id} className={`hover:bg-amber-50/20 transition-colors group ${isVoided ? 'bg-rose-50/20 opacity-75' : ''}`}>
                          <td className="px-6 py-4 font-black text-slate-900 flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${isVoided ? 'bg-rose-500' : 'bg-[#DAA520]'}`}></span>
                            <span className={isVoided ? 'line-through text-slate-400 font-bold' : ''}>{returnNumberVal}</span>
                            {isVoided && (
                              <span className="ml-1 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-200" title={`Void Reason: ${ret.void_reason || ret.voidReason || 'Accidental entry'}`}>
                                VOIDED
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-slate-500 font-bold text-xs">{dateVal}</td>
                          <td className="px-6 py-4 font-black text-slate-800">{ret.supplier_name || ret.supplierName}</td>
                          <td className="px-6 py-4 text-center">
                            <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider">
                              {itemsCount} {itemsCount === 1 ? 'Item' : 'Items'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right font-black text-[#DAA520]">
                            {symbol} {totalVal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`inline-block px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${badgeInfo.bg} ${badgeInfo.text}`}>
                              {badgeInfo.label}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-xs font-bold text-slate-600 max-w-[200px] truncate" title={ret.void_reason ? `Void Reason: ${ret.void_reason}` : (ret.reason || '')}>
                            {isVoided ? (
                              <span className="text-rose-600 italic">Voided: {ret.void_reason || ret.voidReason || ret.reason || 'User Mistake'}</span>
                            ) : (
                              ret.reason || 'Damaged Stock'
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex gap-2 justify-center items-center">
                              <button
                                onClick={() => setViewDebitNote(ret)}
                                className="text-[10px] font-black uppercase tracking-widest bg-slate-50 border border-slate-200 hover:bg-slate-200 px-3.5 py-2 rounded-xl text-slate-700 transition-all shadow-sm flex items-center gap-1.5"
                                title="View Debit Note Voucher"
                              >
                                <EyeIcon className="w-3.5 h-3.5 text-slate-500" /> Voucher
                              </button>
                              <button
                                onClick={() => downloadDebitNote_PDF(ret)}
                                className="p-2 rounded-xl bg-amber-50 text-[#DAA520] hover:bg-[#DAA520] hover:text-slate-900 border border-amber-200 transition-all shadow-sm"
                                title="Download PDF Voucher"
                              >
                                <DownloadIcon className="w-4 h-4" />
                              </button>
                              {!isVoided && (
                                <button
                                  onClick={() => handleVoidPurchaseReturn(returnNumberVal)}
                                  className="text-[10px] font-black uppercase tracking-widest bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white border border-rose-200 px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 shadow-sm shadow-rose-500/10"
                                  title="Void Return Voucher & Restore Stock"
                                >
                                  <BanIcon className="w-3.5 h-3.5" /> Void
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-gray-400">
                        <RotateCcwIcon className="w-12 h-12 mx-auto mb-3 opacity-20 text-[#DAA520]" />
                        <p className="text-sm font-bold text-slate-600">No Purchase Return records found.</p>
                        <p className="text-xs text-slate-400 mt-1">Click "+ New Purchase Return" to return defective or excess stock to a supplier.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CREATE NEW PURCHASE RETURN FORM                                   */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isCreateReturnOpen}
        onClose={() => {
          if (!isSubmittingReturn) {
            setIsCreateReturnOpen(false);
            resetReturnForm();
          }
        }}
        title="Create Purchase Return / ආපසු යැවීම"
        size="xl"
      >
        <div className="space-y-6 p-2 text-left">
          {/* Supplier & Order Selection */}
          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">
                  Select Supplier / Vendor <span className="text-red-500">*</span>
                </label>
                <select
                  value={returnSupplierName}
                  onChange={(e) => {
                    const name = e.target.value;
                    setReturnSupplierName(name);
                    const match = supplierList.find(s => s.name === name);
                    setReturnSupplierId(match ? match.id : '');
                  }}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] bg-white cursor-pointer"
                >
                  <option value="">-- Choose Vendor --</option>
                  {suppliers.map((s, idx) => (
                    <option key={idx} value={s}>{s}</option>
                  ))}
                </select>
                {activeSupplierObj && (
                  <p className="text-xs font-bold text-slate-500 mt-1.5 flex items-center gap-1.5">
                    <Building2Icon className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Current Payable Balance: </span>
                    <span className="font-black text-indigo-600">
                      {symbol} {Number(activeSupplierObj.payableBalance !== undefined ? activeSupplierObj.payableBalance : (activeSupplierObj.payable_balance || activeSupplierObj.balance || 0)).toLocaleString()}
                    </span>
                  </p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">
                  Optional Linked Purchase Order
                </label>
                <select
                  value={returnPoId}
                  onChange={(e) => setReturnPoId(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] bg-white cursor-pointer"
                >
                  <option value="">-- Direct Inventory Return (No Linked PO) --</option>
                  {orders
                    .filter(po => !returnSupplierName || po.supplierName === returnSupplierName)
                    .map(po => (
                      <option key={po.id} value={po.poNumber || po.id}>
                        {po.poNumber} — {po.supplierName} ({symbol} {Number(po.total || 0).toLocaleString()})
                      </option>
                    ))}
                </select>
                <p className="text-[10px] text-slate-400 font-semibold mt-1.5">
                  Link to a past PO or leave blank for a general inventory return.
                </p>
              </div>
            </div>
          </div>

          {/* Dynamic Item Catalog Search & Selection */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200">
            <h4 className="text-xs font-black uppercase tracking-widest text-slate-800 mb-3 flex items-center justify-between">
              <span>Return Line Items</span>
              <span className="text-[10px] font-bold text-slate-400">Add products from current on-hand stock</span>
            </h4>

            <div className="relative mb-4">
              <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus-within:ring-2 focus-within:ring-[#DAA520]/20">
                <SearchIcon className="w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search product by name, barcode or SKU to add to return list..."
                  value={returnProductSearch}
                  onChange={(e) => setReturnProductSearch(e.target.value)}
                  className="bg-transparent text-sm font-bold text-slate-800 outline-none w-full"
                />
              </div>

              {returnProductSearch.trim().length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-56 overflow-y-auto">
                  {products
                    .filter(p => p.name.toLowerCase().includes(returnProductSearch.toLowerCase()) || (p.sku && p.sku.toLowerCase().includes(returnProductSearch.toLowerCase())))
                    .map(p => {
                      const onHand = Number(p.stock || 0);
                      return (
                        <button
                          key={p.id}
                          onClick={() => addReturnItem(p)}
                          className="w-full flex justify-between items-center px-4 py-3 hover:bg-amber-50/50 text-left border-b border-slate-100 last:border-0 transition-colors"
                        >
                          <div>
                            <p className="font-black text-slate-800 text-sm">{p.name}</p>
                            <p className="text-[10px] text-slate-400 font-bold">SKU: {p.sku || 'N/A'} | Unit: {p.unit || 'pcs'}</p>
                          </div>
                          <div className="text-right">
                            <span className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-black ${onHand > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                              Stock: {onHand}
                            </span>
                            <p className="text-xs font-black text-[#DAA520] mt-0.5">Cost: {symbol} {Number(p.costPrice || p.cost_price || 0).toLocaleString()}</p>
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>

            {itemStockError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-bold flex items-center gap-2 mb-3">
                <AlertTriangleIcon className="w-4 h-4 shrink-0" />
                <span>{itemStockError}</span>
              </div>
            )}

            {/* Line Items Table */}
            {returnItems.length > 0 ? (
              <div className="overflow-x-auto border border-slate-100 rounded-xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-black uppercase tracking-wider text-[10px] border-b border-slate-100">
                    <tr>
                      <th className="py-3 px-4">Item Name</th>
                      <th className="py-3 text-center">On-Hand Stock</th>
                      <th className="py-3 text-center w-28">Return Qty</th>
                      <th className="py-3 text-right w-36">Unit Cost ({symbol})</th>
                      <th className="py-3 text-right px-4">Subtotal</th>
                      <th className="py-3 text-center w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {returnItems.map(item => (
                      <tr key={item.productId} className="hover:bg-slate-50/50">
                        <td className="py-3 px-4 font-black text-slate-800">
                          {item.productName}
                          <span className="block text-[9px] text-slate-400 font-semibold">{item.sku}</span>
                        </td>
                        <td className="py-3 text-center">
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded font-bold text-[10px]">
                            {item.currentStock}
                          </span>
                        </td>
                        <td className="py-3 text-center">
                          <input
                            type="number"
                            min="1"
                            max={item.currentStock}
                            value={item.quantity}
                            onChange={(e) => updateReturnItemQty(item.productId, parseInt(e.target.value) || 1)}
                            className="w-20 px-2 py-1 text-center font-bold text-slate-800 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#DAA520]"
                          />
                        </td>
                        <td className="py-3 text-right">
                          <input
                            type="number"
                            step="any"
                            value={item.unitCostPrice}
                            onChange={(e) => updateReturnItemPrice(item.productId, parseFloat(e.target.value) || 0)}
                            className="w-28 px-2 py-1 text-right font-bold text-slate-800 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-[#DAA520]"
                          />
                        </td>
                        <td className="py-3 text-right px-4 font-black text-[#DAA520]">
                          {symbol} {item.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-3 text-center">
                          <button
                            onClick={() => removeReturnItem(item.productId)}
                            className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-500 hover:text-white transition-colors"
                          >
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-8 text-center text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                <RotateCcwIcon className="w-8 h-8 mx-auto mb-2 opacity-30 text-[#DAA520]" />
                <p className="text-xs font-bold text-slate-500">No items added to this return yet.</p>
                <p className="text-[10px] text-slate-400">Search and select items from above catalog.</p>
              </div>
            )}
          </div>

          {/* Settlement Mode Selection */}
          <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-4">
            <h4 className="text-xs font-black uppercase tracking-widest text-slate-800">
              Settlement Mode & Accounting <span className="text-red-500">*</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label
                onClick={() => setReturnSettlementMode('SUPPLIER_DEBIT_NOTE')}
                className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                  returnSettlementMode === 'SUPPLIER_DEBIT_NOTE'
                    ? 'border-indigo-600 bg-indigo-50/50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-black text-slate-900">Supplier Debit Note</span>
                    <Building2Icon className={`w-4 h-4 ${returnSettlementMode === 'SUPPLIER_DEBIT_NOTE' ? 'text-indigo-600' : 'text-slate-400'}`} />
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed font-semibold">
                    Deducts return value from Supplier Payable Balance.
                  </p>
                </div>
                <span className="mt-2 text-[9px] font-black uppercase tracking-wider text-indigo-700 bg-indigo-100/70 px-2 py-0.5 rounded w-fit">
                  Recommended
                </span>
              </label>

              <label
                onClick={() => setReturnSettlementMode('CASH_REFUND')}
                className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                  returnSettlementMode === 'CASH_REFUND'
                    ? 'border-emerald-600 bg-emerald-50/50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-black text-slate-900">Cash Refund</span>
                    <DollarSignIcon className={`w-4 h-4 ${returnSettlementMode === 'CASH_REFUND' ? 'text-emerald-600' : 'text-slate-400'}`} />
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed font-semibold">
                    Records direct cash income returned by supplier.
                  </p>
                </div>
                <span className="mt-2 text-[9px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded w-fit">
                  Cash In Hand
                </span>
              </label>

              <label
                onClick={() => setReturnSettlementMode('BANK_REFUND')}
                className={`p-4 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between ${
                  returnSettlementMode === 'BANK_REFUND'
                    ? 'border-blue-600 bg-blue-50/50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-black text-slate-900">Bank Transfer</span>
                    <ShieldCheckIcon className={`w-4 h-4 ${returnSettlementMode === 'BANK_REFUND' ? 'text-blue-600' : 'text-slate-400'}`} />
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed font-semibold">
                    Direct bank ledger realization from vendor account.
                  </p>
                </div>
                <span className="mt-2 text-[9px] font-black uppercase tracking-wider text-blue-700 bg-blue-100/70 px-2 py-0.5 rounded w-fit">
                  Bank Settlement
                </span>
              </label>
            </div>
          </div>

          {/* Reason and Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">
                Reason for Return
              </label>
              <select
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520] bg-white cursor-pointer"
              >
                <option value="Damaged Stock">Damaged Stock (අලාභහානි)</option>
                <option value="Defective / Expired">Defective / Expired (දෝෂ සහිත / කල් ඉකුත් වූ)</option>
                <option value="Wrong Item Received">Wrong Item Received (වැරදි භාණ්ඩ)</option>
                <option value="Excess Stock">Excess Stock / Over-ordered (අතිරික්ත තොග)</option>
                <option value="Other">Other / Custom Reason</option>
              </select>

              {returnReason === 'Other' && (
                <input
                  type="text"
                  placeholder="Specify reason..."
                  value={returnCustomReason}
                  onChange={(e) => setReturnCustomReason(e.target.value)}
                  className="w-full mt-2 px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none"
                />
              )}
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">
                Notes & Driver / Voucher Remarks
              </label>
              <textarea
                rows={2}
                placeholder="Optional remarks (e.g. Returned via Delivery Van #WP-GA-1234)..."
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
              />
            </div>
          </div>

          {/* Grand Total & Action Buttons */}
          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Returned Value</p>
              <p className="text-3xl font-black text-[#DAA520]">
                {symbol} {returnGrandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] text-slate-400 font-bold">{returnItems.length} line item(s) selected</p>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => {
                  setIsCreateReturnOpen(false);
                  resetReturnForm();
                }}
                disabled={isSubmittingReturn}
                className="flex-1 sm:flex-none px-6 py-3.5 rounded-xl border border-slate-200 text-xs font-black uppercase tracking-wider text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleSubmitPurchaseReturn}
                disabled={isSubmittingReturn || returnItems.length === 0 || !returnSupplierName}
                className="flex-1 sm:flex-none px-8 py-3.5 rounded-xl bg-[#DAA520] hover:bg-[#B8860B] disabled:bg-slate-200 disabled:text-slate-400 text-slate-900 text-xs font-black uppercase tracking-wider shadow-lg shadow-[#DAA520]/20 transition-all flex items-center justify-center gap-2"
              >
                {isSubmittingReturn ? (
                  <Loader2Icon className="w-4 h-4 animate-spin text-slate-900" />
                ) : (
                  <CheckCircleIcon className="w-4 h-4 text-slate-900" />
                )}
                Submit Return & Issue Debit Note
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL 2: PRINTABLE DEBIT NOTE VOUCHER MODAL                                */}
      {/* ========================================================================= */}
      <Modal
        isOpen={!!viewDebitNote}
        onClose={() => setViewDebitNote(null)}
        title={`Debit Note Voucher — ${viewDebitNote?.return_number || viewDebitNote?.returnNumber || viewDebitNote?.id || ''}`}
        size="lg"
      >
        {viewDebitNote && (
          <div className="space-y-6 p-1 text-left">
            {/* Printable Voucher Card Container */}
            <div id="debit-note-voucher" className="bg-white border-2 border-slate-200 p-6 sm:p-8 rounded-2xl shadow-sm text-slate-900 relative">
              {/* Top Business Header */}
              <div className="flex justify-between items-start border-b-2 border-slate-900 pb-4">
                <div>
                  <h2 className="text-xl font-black text-slate-900 tracking-tight">MUTHUWADIGE HARDWARE</h2>
                  <p className="text-xs text-slate-600 font-bold mt-0.5">No: 80, Mahahunupitiya, Negombo</p>
                  <p className="text-xs text-slate-600 font-bold">Contact: 077 076 076 7 | sanojhardware@gmail.com</p>
                </div>
                <div className="text-right">
                  <span className="inline-block px-3 py-1 bg-amber-100 text-amber-900 text-xs font-black uppercase tracking-wider rounded border border-amber-300">
                    DEBIT NOTE / හර පත
                  </span>
                  <p className="text-sm font-black text-slate-900 mt-2 font-mono">
                    {viewDebitNote.return_number || viewDebitNote.returnNumber || viewDebitNote.id}
                  </p>
                  <p className="text-[10px] text-slate-500 font-bold">
                    {viewDebitNote.created_at ? new Date(viewDebitNote.created_at).toLocaleString() : new Date().toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Vendor & Return Metadata Grid */}
              <div className="grid grid-cols-2 gap-4 py-4 border-b border-slate-200 text-xs">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Vendor / Supplier</p>
                  <p className="text-sm font-black text-slate-900 mt-0.5">{viewDebitNote.supplier_name || viewDebitNote.supplierName}</p>
                  {viewDebitNote.purchase_order_id && (
                    <p className="text-[11px] text-slate-500 font-semibold mt-1">
                      Ref PO: <span className="font-bold text-slate-800">{viewDebitNote.purchase_order_id}</span>
                    </p>
                  )}
                </div>

                <div className="text-right">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Settlement Mode</p>
                  <span className="inline-block font-black text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded mt-0.5">
                    {(viewDebitNote.settlement_mode || viewDebitNote.settlementMode || '').replace(/_/g, ' ')}
                  </span>
                  <p className="text-[11px] text-slate-500 font-semibold mt-1">
                    Handled By: <span className="font-bold text-slate-800">{viewDebitNote.handled_by || viewDebitNote.handledBy || viewDebitNote.created_by_name || currentUser?.name || currentUser?.full_name || 'Sanoj Hardware'}</span>
                  </p>
                </div>
              </div>

              {/* Items Breakdown Table */}
              <div className="py-4">
                <table className="w-full text-xs text-left border border-slate-200">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-black text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3 border-r border-slate-200">Item Description</th>
                      <th className="py-2.5 px-3 text-center border-r border-slate-200">Qty</th>
                      <th className="py-2.5 px-3 text-right border-r border-slate-200">Unit Cost</th>
                      <th className="py-2.5 px-3 text-right">Total Returned</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(viewDebitNote.items && viewDebitNote.items.length > 0) ? (
                      viewDebitNote.items.map((item: any, idx: number) => {
                        const q = Number(item.quantity !== undefined ? item.quantity : (item.qty || 0));
                        const u = Number(item.unit_cost_price !== undefined ? item.unit_cost_price : (item.unitCostPrice || item.costPrice || 0));
                        const tot = Number(item.subtotal !== undefined ? item.subtotal : (q * u));
                        return (
                          <tr key={idx}>
                            <td className="py-2.5 px-3 font-bold text-slate-900 border-r border-slate-200">
                              {item.product_name || item.productName || 'Hardware Product'}
                            </td>
                            <td className="py-2.5 px-3 text-center font-bold text-slate-800 border-r border-slate-200">{q}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-slate-600 border-r border-slate-200">
                              {symbol} {u.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="py-2.5 px-3 text-right font-black text-slate-900">
                              {symbol} {tot.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="py-3 text-center text-slate-400 italic">No line items attached</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Total & Reason Box */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex justify-between items-center">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Return Reason</p>
                  <p className="text-xs font-black text-slate-800 mt-0.5">{viewDebitNote.reason || 'Damaged / Defective Stock Returned'}</p>
                  {viewDebitNote.notes && (
                    <p className="text-[11px] text-slate-500 font-semibold mt-0.5">Note: {viewDebitNote.notes}</p>
                  )}
                </div>

                <div className="text-right">
                  <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Total Debit Value</p>
                  <p className="text-2xl font-black text-[#DAA520]">
                    {symbol} {Number(viewDebitNote.total_returned_cost !== undefined ? viewDebitNote.total_returned_cost : (viewDebitNote.totalReturnedCost || viewDebitNote.total || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* Dual Signatures */}
              <div className="grid grid-cols-2 gap-8 pt-12 text-center text-xs">
                <div>
                  <div className="border-b border-dashed border-slate-400 pb-1 mb-1"></div>
                  <p className="font-black text-slate-800">{viewDebitNote.handled_by || viewDebitNote.handledBy || viewDebitNote.created_by_name || currentUser?.name || currentUser?.full_name || 'Sanoj Hardware'}</p>
                  <p className="text-[10px] text-slate-400">Authorized Staff</p>
                </div>

                <div>
                  <div className="border-b border-dashed border-slate-400 pb-1 mb-1"></div>
                  <p className="font-black text-slate-800">Supplier / Driver Receiver</p>
                  <p className="text-[10px] text-slate-400">Signature & Date</p>
                </div>
              </div>
            </div>

            {/* Modal Action Controls */}
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={triggerPrintDebitNote}
                className="flex-1 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 shadow-lg transition-all"
              >
                <PrinterIcon className="w-4 h-4 text-amber-400" /> Print Voucher (A4 / Thermal)
              </button>

              <button
                onClick={() => downloadDebitNote_PDF(viewDebitNote)}
                className="flex-1 py-3.5 bg-[#DAA520] hover:bg-[#B8860B] text-slate-900 rounded-xl font-black uppercase tracking-wider text-xs flex items-center justify-center gap-2 shadow-lg shadow-[#DAA520]/20 transition-all"
              >
                <DownloadIcon className="w-4 h-4 text-slate-900" /> Export PDF
              </button>

              <button
                onClick={() => setViewDebitNote(null)}
                className="px-6 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-black uppercase tracking-wider text-xs transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Details Modal (PO Explorer) */}
      <Modal isOpen={!!viewOrder} onClose={() => setViewOrder(null)} title={`PO Explorer - ${viewOrder?.poNumber}`} size="lg">
        {viewOrder && (
          <div className="space-y-8 p-1">
            <div className="flex justify-between bg-gray-50 p-6 rounded-[24px] border border-gray-100 shadow-inner">
              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Vendor Account</p>
                <p className="font-black text-[#464646] text-2xl">{viewOrder.supplierName}</p>
                <p className="text-xs text-gray-400 font-bold mt-1">Initiated on {viewOrder.date}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5">Order Status</p>
                <span className={`inline-block px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${statusColors[viewOrder.status]} shadow-sm`}>{viewOrder.status}</span>
                <p className="text-[10px] font-bold text-gray-500 mt-3 uppercase tracking-widest">ETA: {viewOrder.dueDate}</p>
              </div>
            </div>
            
            <div className="border border-slate-100 rounded-2xl overflow-hidden text-left">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  <tr>
                      <th className="py-4 px-6">Item Catalog Desc.</th>
                      <th className="py-4 text-center">Qty</th>
                      <th className="py-4 text-right">Unit Rate</th>
                      <th className="py-4 text-right px-6">Total Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {viewOrder.items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-teal-50/20 transition-all">
                      <td className="py-4 px-6 font-black text-slate-800">{item.productName}</td>
                      <td className="py-4 text-center font-black text-slate-500">{item.qty}</td>
                      <td className="py-4 text-right font-bold text-slate-500">{symbol} {convert(item.costPrice).toLocaleString()}</td>
                      <td className="py-4 text-right px-6 font-black text-[#DAA520]">{symbol} {convert(item.total).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="bg-[#464646] text-white p-8 rounded-[32px] shadow-2xl relative overflow-hidden flex justify-between items-center">
              <div className="absolute top-0 right-0 w-48 h-48 bg-[#DAA520]/20 rounded-full -mr-16 -mt-16 blur-3xl"></div>
              <span className="font-black text-gray-300 uppercase tracking-widest text-xs relative z-10">Total Purchase Commitment</span>
              <span className="text-4xl font-black text-[#DAA520] drop-shadow-lg relative z-10">{symbol} {convert(viewOrder.total).toLocaleString()}</span>
            </div>
            
            <div className="flex gap-3">
              <button onClick={() => downloadPO_PDF(viewOrder)} className="flex-1 py-4 bg-[#464646] text-white rounded-xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 hover:bg-[#333333] shadow-xl transition-all shadow-[#464646]/20"><DownloadIcon className="w-5 h-5" /> Export PDF</button>
              <button onClick={() => setViewOrder(null)} className="flex-1 py-4 bg-gray-100 text-gray-500 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-gray-200 transition-colors">Dismiss View</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Receive & Settle PO Modal */}
      <Modal 
        isOpen={!!receivingOrder} 
        onClose={() => setReceivingOrder(null)} 
        title={`Receive & Settle Purchase Order — ${receivingOrder?.poNumber || ''}`} 
        size="lg"
      >
        {receivingOrder && (
          <div className="p-2 space-y-5 text-left">
            {/* Top Summary Banner */}
            <div className="bg-slate-900 rounded-2xl p-5 text-white flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border border-slate-800">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Receiving PO Details</p>
                <h3 className="text-lg font-black text-white mt-0.5">{receivingOrder.supplierName}</h3>
                <p className="text-xs text-slate-400 font-medium">Ref: {receivingOrder.poNumber} | Ordered On: {receivingOrder.date}</p>
              </div>
              <div className="text-right sm:text-right bg-white/10 p-3.5 rounded-xl border border-white/10 w-full sm:w-auto">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">Total Purchase Commitment</p>
                <p className="text-2xl font-black text-[#DAA520] mt-0.5">
                  {symbol} {Number(receivingOrder.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Restock Items Preview Table */}
            <div className="border border-slate-200 rounded-xl overflow-hidden text-left bg-white">
              <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex justify-between items-center">
                <span className="text-[11px] font-black uppercase tracking-wider text-slate-600">
                  Restocked Line Items ({receivingOrder.items?.length || 0})
                </span>
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Inventory Stock will increase
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100/50 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-4">Item Name</th>
                      <th className="py-2.5 px-2 text-center">Receiving Qty</th>
                      <th className="py-2.5 px-2 text-right">Unit Cost</th>
                      <th className="py-2.5 px-4 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {receivingOrder.items?.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-4 font-bold text-slate-800">{item.productName}</td>
                        <td className="py-2.5 px-2 text-center font-black text-emerald-600">+{item.qty}</td>
                        <td className="py-2.5 px-2 text-right font-medium text-slate-600">{symbol} {convert(item.costPrice).toLocaleString()}</td>
                        <td className="py-2.5 px-4 text-right font-black text-slate-800">{symbol} {convert(item.total).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Settlement Method Selector */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">
                Select PO Settlement Method *
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Credit */}
                <button
                  type="button"
                  onClick={() => setReceiveSettlementMode('CREDIT')}
                  className={`p-3.5 rounded-xl border flex items-start gap-3 transition-all text-left ${
                    receiveSettlementMode === 'CREDIT'
                      ? 'bg-indigo-50/70 border-indigo-500 text-indigo-950 ring-2 ring-indigo-500/20'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className={`p-2 rounded-lg ${receiveSettlementMode === 'CREDIT' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    <LayersIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase tracking-wider block">Add to Supplier Credit</span>
                    <span className="text-[10px] text-slate-500 font-medium block mt-0.5 leading-tight">
                      Increases {receivingOrder.supplierName}'s payable balance. Settled later in Supplier Ledger.
                    </span>
                  </div>
                </button>

                {/* Cash */}
                <button
                  type="button"
                  onClick={() => setReceiveSettlementMode('CASH')}
                  className={`p-3.5 rounded-xl border flex items-start gap-3 transition-all text-left ${
                    receiveSettlementMode === 'CASH'
                      ? 'bg-emerald-50/70 border-emerald-500 text-emerald-950 ring-2 ring-emerald-500/20'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className={`p-2 rounded-lg ${receiveSettlementMode === 'CASH' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    <WalletIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase tracking-wider block">Pay Now - Cash Drawer</span>
                    <span className="text-[10px] text-slate-500 font-medium block mt-0.5 leading-tight">
                      Deducts {symbol} {Number(receivingOrder.total || 0).toLocaleString()} immediately from Cash Drawer as Purchase Expense.
                    </span>
                  </div>
                </button>

                {/* Bank Transfer */}
                <button
                  type="button"
                  onClick={() => setReceiveSettlementMode('BANK')}
                  className={`p-3.5 rounded-xl border flex items-start gap-3 transition-all text-left ${
                    receiveSettlementMode === 'BANK'
                      ? 'bg-blue-50/70 border-blue-500 text-blue-950 ring-2 ring-blue-500/20'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className={`p-2 rounded-lg ${receiveSettlementMode === 'BANK' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    <Building2Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase tracking-wider block">Pay Now - Bank Transfer</span>
                    <span className="text-[10px] text-slate-500 font-medium block mt-0.5 leading-tight">
                      Logs a bank withdrawal expense of {symbol} {Number(receivingOrder.total || 0).toLocaleString()} in Accounting Cash Book.
                    </span>
                  </div>
                </button>

                {/* Outward Cheque */}
                <button
                  type="button"
                  onClick={() => setReceiveSettlementMode('CHEQUE')}
                  className={`p-3.5 rounded-xl border flex items-start gap-3 transition-all text-left ${
                    receiveSettlementMode === 'CHEQUE'
                      ? 'bg-amber-50/70 border-[#DAA520] text-amber-950 ring-2 ring-[#DAA520]/20'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className={`p-2 rounded-lg ${receiveSettlementMode === 'CHEQUE' ? 'bg-[#DAA520] text-slate-900' : 'bg-slate-100 text-slate-600'}`}>
                    <FileCheckIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase tracking-wider block">Issue Cheque (PDC)</span>
                    <span className="text-[10px] text-slate-500 font-medium block mt-0.5 leading-tight">
                      Records an Outward Pending Cheque in Cheque Registry linked to this PO.
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Cheque Specific Input Fields */}
            {receiveSettlementMode === 'CHEQUE' && (
              <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200/60 space-y-3 animate-in fade-in duration-300">
                <div className="flex items-center gap-2 text-xs font-black text-amber-800 uppercase tracking-wider">
                  <ShieldCheckIcon className="w-4 h-4 text-[#DAA520]" />
                  <span>Outward Account Payee Cheque Parameters</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                      Cheque Number *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 004821"
                      value={receiveChequeNo}
                      onChange={(e) => setReceiveChequeNo(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                      Bank Name *
                    </label>
                    <select
                      value={receiveBankName}
                      onChange={(e) => setReceiveBankName(e.target.value)}
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
                      value={receiveChequeDate}
                      onChange={(e) => setReceiveChequeDate(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-amber-200 rounded-lg text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
                      required
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Date & Voucher Ref */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Receipt & Payment Date
                </label>
                <input
                  type="date"
                  value={receivePaymentDate}
                  onChange={(e) => setReceivePaymentDate(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Voucher / Ref #
                </label>
                <input
                  type="text"
                  placeholder="PO-REC-..."
                  value={receiveRef}
                  onChange={(e) => setReceiveRef(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                Receipt Notes (Optional)
              </label>
              <textarea
                rows={2}
                placeholder="Goods receipt notes, delivery truck number, driver notes..."
                value={receiveNotes}
                onChange={(e) => setReceiveNotes(e.target.value)}
                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-[#DAA520]"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setReceivingOrder(null)}
                className="px-6 py-2.5 text-xs font-black text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-widest"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingReceive}
                onClick={handleConfirmReceiveAndSettle}
                className="flex items-center gap-2 px-8 py-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black shadow-lg shadow-emerald-600/20 transition-all uppercase tracking-widest disabled:opacity-50"
              >
                {isSubmittingReceive ? (
                  <>
                    <Loader2Icon className="w-4 h-4 animate-spin" />
                    <span>Receiving & Restocking...</span>
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="w-4 h-4" />
                    <span>Confirm Receipt & Settle ({symbol} {Number(receivingOrder.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}