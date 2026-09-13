import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import XLSX from 'xlsx-js-style';
import {
  SearchIcon,
  PlusIcon,
  PackageIcon,
  AlertTriangleIcon,
  EditIcon,
  Trash2Icon,
  ArrowUpIcon,
  ArrowDownIcon,
  FilterIcon,
  Loader2Icon,
  DownloadIcon,
  CheckCircleIcon,
  XIcon
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { api } from '../lib/api';
import { useCurrency } from '../context/CurrencyContext';
import { getCachedData, setCachedData } from '../services/dataCache';
import type { Product } from '../types';
import { formatStock } from '../utils/formatters';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { OfflineSyncWarningModal } from '../components/OfflineSyncWarningModal';
import { useOfflineSyncWarning } from '../hooks/useOfflineSyncWarning';

const categories = [
  'All',
  'Power Tools',
  'Hand Tools',
  'Plumbing',
  'Electrical',
  'Fasteners',
  'Painting',
  'Measuring',
  'Safety',
  'Abrasives'
];

const categoryTranslations: Record<string, { en: string; si: string }> = {
  'All': { en: 'All', si: 'සියල්ල' },
  'Power Tools': { en: 'Power Tools', si: 'බලශක්ති මෙවලම්' },
  'Hand Tools': { en: 'Hand Tools', si: 'අත් මෙවලම්' },
  'Plumbing': { en: 'Plumbing', si: 'නල කරාම (ප්ලම්බිං)' },
  'Electrical': { en: 'Electrical', si: 'විදුලි උපකරණ' },
  'Fasteners': { en: 'Fasteners', si: 'ඇණ සහ මුරිච්චි' },
  'Painting': { en: 'Painting', si: 'තීන්ත සහ ආලේපන' },
  'Measuring': { en: 'Measuring', si: 'මැනුම් මෙවලම්' },
  'Safety': { en: 'Safety', si: 'ආරක්ෂිත උපකරණ' },
  'Abrasives': { en: 'Abrasives', si: 'වැලි කඩදාසි / මදින ද්‍රව්‍ය' }
};

const unitTranslations: Record<string, string> = {
  pcs: 'කෑලි',
  kg: 'කිලෝග්‍රෑම්',
  g: 'ග්‍රෑම්',
  liters: 'ලීටර්',
  ml: 'මිලිලීටර්',
  meters: 'මීටර්',
  boxes: 'පෙට්ටි',
  packets: 'පැකට්',
  rolls: 'රෝල්ස්',
  bundles: 'මිටි',
  Cube: 'කියුබ්',
  cube: 'කියුබ්'
};

const isDecimalUnit = (unit: string | undefined): boolean => {
  if (!unit) return false;
  const PREDEFINED_UNITS = ['pcs', 'kg', 'g', 'liters', 'ml', 'meters', 'boxes', 'packets', 'rolls', 'bundles'];
  const decimals = ['kg', 'g', 'liters', 'ml', 'meters'];
  const name = unit.toLowerCase().trim();
  return decimals.includes(name) || !PREDEFINED_UNITS.includes(name);
};

const getProductConversions = (product: any) => {
  if (!product || !product.measureDetails) return [];
  try {
    const parsed = typeof product.measureDetails === 'string' ? JSON.parse(product.measureDetails) : product.measureDetails;
    if (parsed && Array.isArray(parsed.conversions)) {
      return parsed.conversions;
    }
  } catch (e) { }
  return [];
};

const emptyProduct: Omit<Product, 'id'> = {
  name: '',
  sku: '',
  category: 'Power Tools',
  price: 0,
  costPrice: 0,
  stock: 0,
  minStock: 0,
  supplier: '',
  unit: 'pcs',
  barcode: '',
  brand: '',
  serialNo: '',
  batchCode: '',
  expiryDate: '',
  supplierPhone: '',
  measureDetails: ''
};

const getProductConversionRate = (product: Product | Omit<Product, 'id'>): number => {
  if (!product.measureDetails) return 1;
  try {
    const parsed = typeof product.measureDetails === 'string' ? JSON.parse(product.measureDetails) : product.measureDetails;
    return Number(parsed.conversionRate) || 1;
  } catch (_) {
    const rate = parseFloat(product.measureDetails);
    return isNaN(rate) ? 1 : rate;
  }
};

export function Inventory() {
  const symbol = 'Rs.';
  const convert = (val: number) => val;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const cachedProducts = getCachedData<Product[]>('products');
  const cachedSuppliers = getCachedData<any[]>('suppliers');

  const [products, setProducts] = useState<Product[]>(cachedProducts || []);
  const [isLoading, setIsLoading] = useState(!cachedProducts);
  const [isSyncing, setIsSyncing] = useState(false);
  const [toastState, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const toast = {
    success: (message: string) => {
      setToast({ type: 'success', message });
      setTimeout(() => setToast(null), 5000);
    },
    error: (message: string) => {
      setToast({ type: 'error', message });
      setTimeout(() => setToast(null), 5000);
    }
  };

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSinhala, setIsSinhala] = useState(false);
  const t = (en: string, si: string) => isSinhala ? si : en;
  const [isSaving, setIsSaving] = useState(false);
  const [showStockModal, setShowStockModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [stockQty, setStockQty] = useState(0);
  const [stockType, setStockType] = useState<'in' | 'out'>('in');
  const [actionType, setActionType] = useState<string>('Adjustment (Increase)');
  const [reasonNotes, setReasonNotes] = useState('');
  const [formData, setFormData] = useState<Omit<Product, 'id'>>(emptyProduct);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [suppliersList, setSuppliersList] = useState<any[]>(cachedSuppliers || []);

  const [customConversionRate, setCustomConversionRate] = useState<number>(1);
  const [customConversionsList, setCustomConversionsList] = useState<{ unit: string; kgVal: number; price?: number }[]>([]);
  const [newConversionUnit, setNewConversionUnit] = useState<string>('');
  const [newConversionKg, setNewConversionKg] = useState<string>('');
  const [newConversionPrice, setNewConversionPrice] = useState<string>('');
  const [isCustomCategory, setIsCustomCategory] = useState<boolean>(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const {
    isOpen: isSyncWarningOpen,
    isSyncing: isWarningSyncing,
    checkSyncAndExecute,
    handleClose: handleWarningClose,
    handleSyncNow: handleWarningSyncNow
  } = useOfflineSyncWarning();

  const fetchSuppliers = async () => {
    try {
      const data = await api.suppliers.getAll();
      if (Array.isArray(data)) {
        setSuppliersList(data);
        setCachedData('suppliers', data);
      }
    } catch (e) {
      console.warn('Failed to fetch suppliers:', e);
    }
  };

  const fetchProducts = async (silent = false) => {
    if (!silent && !getCachedData('products')) {
      setIsLoading(true);
    } else {
      setIsSyncing(true);
    }
    try {
      const data = await api.products.getAll();

      if (Array.isArray(data)) {
        const mappedData: Product[] = data.map((item: any) => ({
          id: String(item.id),
          name: item.name || '',
          sku: item.sku || '',
          category: item.category || 'General',
          price: Number(item.price !== undefined ? item.price : (item.selling_price || 0)),
          costPrice: Number(item.costPrice !== undefined ? item.costPrice : (item.cost_price || 0)),
          stock: Number(item.stock !== undefined ? item.stock : (item.stock_quantity || 0)),
          minStock: Number(item.minStock !== undefined ? item.minStock : (item.min_stock || 5)),
          supplier: item.supplier || '',
          unit: item.unit || 'pcs',
          barcode: item.barcode || '',
          brand: item.brand || '',
          serialNo: item.serialNo || item.serial_no || '',
          batchCode: item.batchCode || item.batch_code || '',
          expiryDate: item.expiryDate || item.expiry_date || '',
          supplierPhone: item.supplierPhone || item.supplier_phone || '',
          measureDetails: item.measureDetails || item.measure_details || ''
        }));

        setProducts(mappedData);
        setCachedData('products', mappedData);
        setCatalogError(null);
      } else {
        throw new Error('Server returned invalid product dataset.');
      }
    } catch (err: any) {
      console.error('Exception fetching inventory:', err?.message || err);
      setCatalogError('Unable to refresh live catalog. Displaying cached inventory.');
    } finally {
      setIsLoading(false);
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchSuppliers();

    const handleRefresh = () => {
      fetchProducts(true);
      fetchSuppliers();
    };

    window.addEventListener('suppliers-updated', handleRefresh);
    window.addEventListener('refresh-inventory', handleRefresh);
    window.addEventListener('refresh-all-data', handleRefresh);
    return () => {
      window.removeEventListener('suppliers-updated', handleRefresh);
      window.removeEventListener('refresh-inventory', handleRefresh);
      window.removeEventListener('refresh-all-data', handleRefresh);
    };
  }, []);

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsLoading(true);
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const rawRows = XLSX.utils.sheet_to_json(ws) as any[];

      if (!rawRows || rawRows.length === 0) {
        toast.error("The uploaded Excel file has no records.");
        setIsLoading(false);
        if (e.target) e.target.value = '';
        return;
      }

      const cleanKey = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      const getValueByKeys = (rowObj: any, possibleKeys: string[]) => {
        if (!rowObj || typeof rowObj !== 'object') return '';
        const keys = Object.keys(rowObj);
        for (const pKey of possibleKeys) {
          const targetClean = cleanKey(pKey);
          const matchedKey = keys.find((k) => cleanKey(k) === targetClean);
          if (matchedKey && rowObj[matchedKey] !== undefined && rowObj[matchedKey] !== null) {
            const val = String(rowObj[matchedKey]).trim();
            if (val !== '' && val !== 'null' && val !== 'undefined' && val !== '—' && val !== '-') {
              return val;
            }
          }
        }
        return '';
      };

      const suppliersMap = new Map<string, any>();
      (suppliersList || []).forEach((sup: any) => {
        if (sup && sup.name) {
          suppliersMap.set(String(sup.name).trim().toLowerCase(), sup);
        }
      });

      const formattedItems: any[] = [];

      for (let idx = 0; idx < rawRows.length; idx++) {
        const row = rawRows[idx];

        let name = getValueByKeys(row, [
          'product', 'product name', 'product_name', 'item', 'item_name', 'item name',
          'description', 'name', 'title'
        ]) || `Product #${idx + 1}`;

        let sku = getValueByKeys(row, [
          'sku', 'item code', 'item_code', 'code', 'barcode', 'product_sku', 'product sku', 'item_number'
        ]) || `SKU-${Date.now().toString().slice(-4)}-${idx + 1}`;

        const category = getValueByKeys(row, ['category', 'product_category', 'product category', 'type']) || 'Power Tools';
        const unit = getValueByKeys(row, ['unit', 'uom', 'unit_of_measure', 'measurement']) || 'pcs';

        const rawPrice = getValueByKeys(row, [
          'price (rs.)', 'price (rs)', 'price', 'selling price', 'selling_price', 'retail price', 'retail_price',
          'unit price', 'unit_price', 'price rs'
        ]);
        const price = parseFloat(rawPrice) || 0;

        const rawCost = getValueByKeys(row, [
          'cost (rs.)', 'cost (rs)', 'cost', 'cost price', 'cost_price', 'buying price', 'buying_price',
          'purchase price', 'purchase_price', 'cost rs'
        ]);
        const costPrice = parseFloat(rawCost) || 0;

        const rawStock = getValueByKeys(row, [
          'stock', 'qty', 'quantity', 'current stock', 'current_stock', 'units_in_stock', 'stock_qty', 'stock_quantity'
        ]);
        const stock = isDecimalUnit(unit) ? parseFloat(rawStock) || 0 : parseInt(rawStock) || 0;

        const rawMin = getValueByKeys(row, [
          'min', 'min stock', 'min_stock', 'min_stock_alert', 'reorder level', 'reorder_level', 'stock alert', 'stock_alert', 'minstock'
        ]);
        const minStock = parseInt(rawMin) || 5;

        const supplierInput = getValueByKeys(row, [
          'supplier', 'supplier_name', 'supplier name', 'vendor', 'vendor_name', 'vendor name'
        ]);
        const excelSupplierPhone = getValueByKeys(row, [
          'supplier number', 'supplier_number', 'supplier phone', 'supplier_phone',
          'supplierphone', 'mobile', 'phone', 'contact'
        ]);

        const barcode = getValueByKeys(row, ['barcode', 'barcode_number', 'upc', 'ean']) || sku;
        const expiryDateVal = getValueByKeys(row, ['expiry date', 'expiry_date', 'expirydate', 'expiry']);

        let finalSupplierName = '';
        let finalSupplierPhone = '';

        if (supplierInput) {
          const existingSup = suppliersMap.get(supplierInput.trim().toLowerCase());
          if (existingSup) {
            finalSupplierName = existingSup.name;
            finalSupplierPhone = existingSup.phone || excelSupplierPhone || '';
          } else {
            finalSupplierName = supplierInput.trim();
            finalSupplierPhone = excelSupplierPhone || '';
          }
        }

        formattedItems.push({
          sku,
          barcode,
          name,
          category,
          price,
          selling_price: price,
          cost_price: costPrice,
          costPrice,
          stock,
          stock_quantity: stock,
          min_stock: minStock,
          minStock,
          supplier: finalSupplierName,
          supplier_name: finalSupplierName,
          supplier_phone: finalSupplierPhone,
          supplierPhone: finalSupplierPhone,
          unit,
          expiry_date: expiryDateVal
        });
      }

      const res = await api.products.bulkImport(formattedItems);
      if (res?.success || (res?.count !== undefined && res.count > 0)) {
        try {
          sessionStorage.removeItem('erp_cached_products');
          localStorage.removeItem('erp_cached_products');
        } catch (_) { }
        await fetchProducts(true);
        toast.success(`Successfully imported ${res.count || formattedItems.length} products`);
        window.dispatchEvent(new CustomEvent('refresh-inventory'));
      } else {
        toast.error(res?.error || 'Failed to import products');
      }
    } catch (err: any) {
      console.error('Excel import error:', err);
      toast.error(`Import failed: ${err.message}`);
    } finally {
      setIsLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleExportExcel = () => {
    try {
      const dataToExport = filtered.map(p => ({
        'SKU': p.sku,
        'PRODUCT': p.name,
        'CATEGORY': p.category,
        'PRICE (RS.)': p.price,
        'COST (RS.)': p.costPrice,
        'STOCK': p.stock,
        'MIN': p.minStock,
        'SUPPLIER': p.supplier || '—',
        'SUPPLIER NUMBER': p.supplierPhone || '—'
      }));

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Inventory");

      ws['!cols'] = [
        { wch: 15 }, { wch: 30 }, { wch: 20 }, { wch: 15 },
        { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 25 }, { wch: 20 }
      ];

      XLSX.writeFile(wb, `Inventory_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err: any) {
      toast.error("Failed to export Excel: " + err.message);
    }
  };

  const handleInventoryScan = useCallback((scannedBarcode: string) => {
    const q = scannedBarcode.trim();
    if (!q) return;
    setSearch(q);
  }, []);

  useBarcodeScanner({
    onScan: handleInventoryScan,
    enabled: !showAddModal && !showStockModal
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q));
      const matchCat = categoryFilter === 'All' || p.category === categoryFilter;
      return matchSearch && matchCat;
    });
  }, [products, search, categoryFilter]);

  const lowStockCount = useMemo(() => products.filter((p) => p.stock < p.minStock).length, [products]);
  const totalValue = useMemo(() => products.reduce((sum, p) => sum + p.stock * convert(p.costPrice), 0), [products]);
  const uniqueCategories = useMemo(() => [...new Set(products.map((p) => p.category))].length, [products]);

  const openAdd = () => {
    checkSyncAndExecute(() => {
      setEditingProduct(null);
      setFormData(emptyProduct);
      setIsCustomCategory(false);
      setShowAddModal(true);
    });
  };

  const openEdit = (product: Product) => {
    setEditingProduct(product);
    const isCustom = !categories.filter(c => c !== 'All').includes(product.category);
    setIsCustomCategory(isCustom);
    setFormData({
      ...product,
      stock: product.stock,
      minStock: product.minStock,
      serialNo: product.serialNo || '',
      batchCode: product.batchCode || '',
      expiryDate: product.expiryDate || '',
      supplierPhone: product.supplierPhone || '',
      measureDetails: product.measureDetails || ''
    });
    setShowAddModal(true);
  };

  const openStock = (product: Product, type: 'in' | 'out') => {
    setStockProduct(product);
    setStockType(type);
    setActionType(type === 'in' ? 'Adjustment (Increase)' : 'Adjustment (Decrease)');
    setStockQty(0);
    setReasonNotes('');
    setShowStockModal(true);
  };

  const handleSave = async () => {
    if (!formData.name || formData.name.trim().length < 2) {
      toast.error(t("Product name must be at least 2 characters.", "භාණ්ඩයේ නම අවම වශයෙන් අකුරු 2ක් විය යුතුය."));
      return;
    }

    const skuClean = formData.sku.trim().toUpperCase();
    if (!skuClean) {
      toast.error(t("SKU is required.", "SKU කේතය අවශ්‍ය වේ."));
      return;
    }

    setIsSaving(true);
    const dbPayload = {
      name: formData.name.trim(),
      sku: skuClean,
      category: formData.category,
      price: formData.price,
      selling_price: formData.price,
      cost_price: formData.costPrice,
      costPrice: formData.costPrice,
      stock: formData.stock,
      stock_quantity: formData.stock,
      min_stock: formData.minStock,
      supplier: formData.supplier.trim(),
      unit: formData.unit,
      barcode: formData.barcode.trim() || skuClean,
      brand: (formData.brand || '').trim(),
      serial_no: (formData.serialNo || '').trim(),
      batch_code: (formData.batchCode || '').trim(),
      expiry_date: formData.expiryDate || '',
      supplier_phone: (formData.supplierPhone || '').trim(),
      measure_details: formData.measureDetails || ''
    };

    try {
      if (editingProduct) {
        // Direct REST update via fetch to eliminate missing api method error
        const res = await fetch(`/api/products/${editingProduct.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token') || sessionStorage.getItem('token') || ''}`
          },
          body: JSON.stringify(dbPayload)
        });
        if (!res.ok) throw new Error('Failed to update product');
        toast.success(t("Product updated successfully!", "නිෂ්පාදනය සාර්ථකව යාවත්කාලීන කරන ලදී!"));
      } else {
        // Use api.products.save which exists in api.ts
        await api.products.save(dbPayload);
        toast.success(t("Product added successfully!", "නිෂ්පාදනය සාර්ථකව එක් කරන ලදී!"));
      }
      setShowAddModal(false);
      await fetchProducts(true);
    } catch (err: any) {
      toast.error(err.message || 'Error saving product');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t('Are you sure you want to delete this item?', 'මෙම භාණ්ඩය මකා දැමීමට ඔබට විශ්වාසද?'))) {
      try {
        await api.products.delete(id);
        toast.success(t("Product deleted successfully!", "නිෂ්පාදනය සාර්ථකව මකා දමන ලදී!"));
        setSelectedProductIds((prev) => prev.filter((selectedId) => selectedId !== id));
        fetchProducts(true);
      } catch (err: any) {
        toast.error(err.message || 'Failed to delete');
      }
    }
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedProductIds.includes(p.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedProductIds((prev) => prev.filter((id) => !filtered.some((p) => p.id === id)));
    } else {
      setSelectedProductIds((prev) => Array.from(new Set([...prev, ...filtered.map((p) => p.id)])));
    }
  };

  const handleToggleSelectProduct = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  };

  const handleBulkDelete = async () => {
    if (selectedProductIds.length === 0) return;
    if (!window.confirm(t(`Delete ${selectedProductIds.length} selected products?`, `තෝරාගත් නිෂ්පාදන ${selectedProductIds.length} මකා දැමීමට අවශ්‍යද?`))) {
      return;
    }

    setIsLoading(true);
    try {
      for (const id of selectedProductIds) {
        await api.products.delete(id);
      }
      toast.success(t('Selected products deleted successfully!', 'තෝරාගත් නිෂ්පාදන සාර්ථකව මකා දමන ලදි!'));
      setSelectedProductIds([]);
      fetchProducts(true);
    } catch (err: any) {
      toast.error('Failed to delete: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAll = async () => {
    if (products.length === 0) return;
    if (!window.confirm(t('WARNING: Delete ALL products?', 'අනතුරු ඇඟවීමයි: සියල්ල මකා දැමීමට අවශ්‍යද?'))) return;

    setIsLoading(true);
    try {
      for (const product of products) {
        await api.products.delete(product.id);
      }
      toast.success(t('All inventory products deleted!', 'සියලුම නිෂ්පාදන මකා දමන ලදි!'));
      setSelectedProductIds([]);
      fetchProducts(true);
    } catch (err: any) {
      toast.error('Failed to delete all: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStockAdjust = async () => {
    if (!stockProduct || stockQty <= 0) return;

    const isIncrement = actionType === 'Adjustment (Increase)' || actionType === 'Sale Return';
    const newQty = isIncrement
      ? stockProduct.stock + stockQty
      : Math.max(0, stockProduct.stock - stockQty);

    setIsSaving(true);
    try {
      const res = await fetch(`/api/products/${stockProduct.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || sessionStorage.getItem('token') || ''}`
        },
        body: JSON.stringify({ stock: newQty, stock_quantity: newQty })
      });
      if (!res.ok) throw new Error('Failed to update stock');

      await api.stockAdjustments.create({
        id: 'sa_' + Date.now(),
        product_id: stockProduct.id,
        product_name: stockProduct.name,
        old_qty: stockProduct.stock,
        new_qty: newQty,
        reason: reasonNotes.trim() || actionType,
        type: actionType,
        user_email: 'sanojhardware@gmail.com',
        created_at: new Date().toISOString()
      });

      toast.success(t('Stock levels adjusted!', 'තොග මට්ටම් යාවත්කාලීන කරන ලදී!'));
      setShowStockModal(false);
      fetchProducts(true);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {catalogError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <span className="text-xs sm:text-sm font-semibold">{catalogError}</span>
          </div>
          <button
            onClick={() => fetchProducts(false)}
            disabled={isLoading || isSyncing}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
          >
            {t('Retry Now', 'දැන් නැවත උත්සාහ කරන්න')}
          </button>
        </div>
      )}

      {/* Stats Section */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{t('Total Products', 'මුළු නිෂ්පාදන සංඛ්‍යාව')}</p>
          <p className="text-2xl font-black text-[#464646] mt-1">{products.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{t('Stock Value', 'තොග වටිනාකම')} ({symbol})</p>
          <p className="text-2xl font-black text-[#DAA520] mt-1">
            {symbol} {totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{t('Low Stock', 'අඩු තොගය')}</p>
          <p className={`text-2xl font-black mt-1 ${lowStockCount > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
            {lowStockCount}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{t('Categories', 'ප්‍රවර්ග')}</p>
          <p className="text-2xl font-black text-[#464646] mt-1">{uniqueCategories}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex items-center gap-3 bg-gray-50/50 border border-gray-200 rounded-xl px-4 py-3 flex-1 min-w-[250px]">
            <SearchIcon className="w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder={t('Search products or barcode...', 'සොයන්න...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent text-sm font-bold text-[#464646] outline-none w-full"
            />
          </div>
          <div className="flex items-center gap-3 bg-gray-50/50 border border-gray-200 rounded-xl px-4 py-2.5">
            <FilterIcon className="w-5 h-5 text-gray-400" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-transparent text-sm font-bold text-[#464646] outline-none cursor-pointer"
            >
              {categories.map((c) => <option key={c} value={c}>{t(c, categoryTranslations[c]?.si || c)}</option>)}
            </select>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportExcel}
            className="hidden"
            accept=".xlsx, .xls"
          />
          <button onClick={() => setIsSinhala(!isSinhala)} className="bg-[#464646]/10 text-[#464646] px-5 py-3 rounded-xl text-xs font-black">
            {isSinhala ? '🇺🇸 English' : '🇱🇰 සිංහල'}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 bg-[#464646] hover:bg-[#333333] text-white px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest shadow-md"
          >
            <PlusIcon className="w-4 h-4" /> {t('Import Excel', 'Excel ආනයනය')}
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest shadow-md"
          >
            <DownloadIcon className="w-4 h-4" /> {t('Export Excel', 'Excel අපනයනය')}
          </button>
          <button onClick={openAdd} className="flex items-center justify-center gap-2 bg-[#DAA520] hover:bg-[#B8860B] text-white px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest shadow-md">
            <PlusIcon className="w-4 h-4" /> {t('Add Product', 'නිෂ්පාදනය එක් කරන්න')}
          </button>
          <button onClick={handleDeleteAll} disabled={products.length === 0} className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest shadow-md disabled:opacity-50">
            <Trash2Icon className="w-4 h-4" /> {t('Delete All', 'සියල්ල මකන්න')}
          </button>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden text-left">
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-white">{t('Inventory Database Catalog', 'තොග දත්ත ගබඩා නාමාවලිය')}</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{t('Manage product stock counts, pricing, cost items, and suppliers', 'තොග කළමනාකරණය')}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 bg-[#DAA520]/20 text-[#DAA520] text-xs font-black rounded-full border border-[#DAA520]/30">
              {filtered.length} {t('Products', 'නිෂ්පාදන')}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          {isLoading && products.length === 0 ? (
            <div className="p-20 text-center text-gray-400">
              <Loader2Icon className="animate-spin w-8 h-8 text-[#DAA520] mx-auto mb-4" />
              <p className="font-bold">{t('Loading inventory catalog from Turso Cloud...', 'දත්ත පූරණය වෙමින් පවතී...')}</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 uppercase text-[10px] font-black tracking-widest">
                <tr>
                  <th className="px-6 py-4 text-center w-[50px]">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={handleToggleSelectAll}
                      className="rounded border-gray-300 text-[#DAA520] focus:ring-[#DAA520] cursor-pointer w-4 h-4"
                    />
                  </th>
                  <th className="px-6 py-4">{t('SKU', 'SKU')}</th>
                  <th className="px-6 py-4">{t('Product', 'නිෂ්පාදනය')}</th>
                  <th className="px-6 py-4">{t('Category', 'ප්‍රවර්ගය')}</th>
                  <th className="px-6 py-4 text-right">{t('Price', 'මිල')} ({symbol})</th>
                  <th className="px-6 py-4 text-right">{t('Cost', 'වියදම')} ({symbol})</th>
                  <th className="px-6 py-4 text-center">{t('Stock', 'තොගය')}</th>
                  <th className="px-6 py-4 text-center">{t('Min', 'අවම')}</th>
                  <th className="px-6 py-4">{t('Supplier', 'සැපයුම්කරු')}</th>
                  <th className="px-6 py-4 text-center">{t('Actions', 'ක්‍රියාකාරකම්')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((product) => {
                  const isLow = product.stock < product.minStock;
                  return (
                    <tr key={product.id} className={`hover:bg-amber-50/30 transition-colors ${isLow ? 'bg-red-50/50' : ''}`}>
                      <td className="px-6 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(product.id)}
                          onChange={() => handleToggleSelectProduct(product.id)}
                          className="rounded border-gray-300 text-[#DAA520] cursor-pointer w-4 h-4"
                        />
                      </td>
                      <td className="px-6 py-4 font-mono text-xs font-bold text-gray-400">{product.sku}</td>
                      <td className="px-6 py-4">
                        <div className="font-black text-slate-800">{product.name}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg text-[9px] font-black uppercase">
                          {product.category}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-black text-[#DAA520]">{symbol} {convert(product.price).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right font-bold text-gray-400">{symbol} {convert(product.costPrice).toLocaleString()}</td>
                      <td className="px-6 py-4 text-center font-black text-base">
                        <span className={isLow ? 'text-red-500' : 'text-slate-800'}>
                          {formatStock(product.stock, product.unit)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-gray-400 font-bold">{product.minStock}</td>
                      <td className="px-6 py-4 text-gray-500 font-bold text-xs">{product.supplier || '—'}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => openStock(product, 'in')} className="p-2 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white" title="Stock In"><ArrowUpIcon className="w-3.5 h-3.5" /></button>
                          <button onClick={() => openStock(product, 'out')} className="p-2 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white" title="Stock Out"><ArrowDownIcon className="w-3.5 h-3.5" /></button>
                          <button onClick={() => openEdit(product)} className="p-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-500 hover:text-white" title="Edit"><EditIcon className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleDelete(product.id)} className="p-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-500 hover:text-white" title="Delete"><Trash2Icon className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add / Edit Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title={editingProduct ? 'Edit Product' : 'Add Product'} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-2">
          <div className="col-span-2">
            <label className="block text-xs font-bold text-gray-500 mb-1">Product Name *</label>
            <input required type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-2 border border-gray-200 rounded-xl" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">SKU *</label>
            <input required type="text" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} className="w-full px-4 py-2 border border-gray-200 rounded-xl" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Category</label>
            <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="w-full px-4 py-2 border border-gray-200 rounded-xl">
              {categories.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Selling Price (Rs.) *</label>
            <input type="number" value={formData.price || ''} onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-2 border border-gray-200 rounded-xl" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Cost Price (Rs.) *</label>
            <input type="number" value={formData.costPrice || ''} onChange={(e) => setFormData({ ...formData, costPrice: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-2 border border-gray-200 rounded-xl" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Current Stock</label>
            <input type="number" value={formData.stock || ''} onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })} className="w-full px-4 py-2 border border-gray-200 rounded-xl" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">Min Stock Alert</label>
            <input type="number" value={formData.minStock || ''} onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })} className="w-full px-4 py-2 border border-gray-200 rounded-xl" />
          </div>
        </div>
        <div className="flex gap-3 mt-6 pt-4 border-t">
          <button onClick={() => setShowAddModal(false)} className="flex-1 py-2.5 bg-gray-100 rounded-xl font-bold">Cancel</button>
          <button onClick={handleSave} disabled={isSaving} className="flex-1 py-2.5 bg-[#DAA520] text-white rounded-xl font-bold">
            {isSaving ? 'Saving...' : 'Save Product'}
          </button>
        </div>
      </Modal>

      {/* Stock Modal */}
      <Modal isOpen={showStockModal} onClose={() => setShowStockModal(false)} title={`Adjust Stock - ${stockProduct?.name}`} size="sm">
        <div className="space-y-4">
          <p className="text-center font-bold">Current Stock: {stockProduct?.stock} {stockProduct?.unit}</p>
          <input
            type="number"
            placeholder="Quantity to adjust"
            value={stockQty || ''}
            onChange={(e) => setStockQty(parseFloat(e.target.value) || 0)}
            className="w-full px-4 py-2 border border-gray-200 rounded-xl font-bold"
          />
          <button onClick={handleStockAdjust} disabled={isSaving} className="w-full py-3 bg-[#DAA520] text-white font-bold rounded-xl">
            {isSaving ? 'Updating...' : 'Commit Stock'}
          </button>
        </div>
      </Modal>

      {/* Toast */}
      {toastState && (
        <div className={`fixed top-5 right-5 z-[9999] p-4 rounded-xl shadow-lg text-white font-bold ${toastState.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toastState.message}
        </div>
      )}
    </div>
  );
}