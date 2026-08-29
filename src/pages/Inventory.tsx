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
import { supabase } from '../lib/supabaseClient';
import { api, API_URL } from '../lib/api';
import type { Product } from '../types';
import { formatStock } from '../utils/formatters';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';

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
    const parsed = JSON.parse(product.measureDetails);
    if (parsed && Array.isArray(parsed.conversions)) {
      return parsed.conversions;
    }
  } catch (e) {}
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
    const parsed = JSON.parse(product.measureDetails);
    return Number(parsed.conversionRate) || 1;
  } catch (_) {
    const rate = parseFloat(product.measureDetails);
    return isNaN(rate) ? 1 : rate;
  }
};

export function Inventory() {
  // PERMANENT FIX: Hardcode the symbol to Rs.
  const symbol = 'Rs.';
  const convert = (val: number) => val; 
  
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        setToast({ type: 'error', message: "The uploaded Excel file has no records." });
        setTimeout(() => setToast(null), 5000);
        setIsLoading(false);
        if (e.target) e.target.value = '';
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();

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

        const { data: currentSuppliers } = await supabase.from('suppliers').select('*');
        const suppliersMap = new Map<string, any>();
        (currentSuppliers || []).forEach((sup: any) => {
          if (sup && sup.name) {
            suppliersMap.set(String(sup.name).trim().toLowerCase(), sup);
          }
        });

        let imported = 0;
        let errors = 0;

        for (let idx = 0; idx < rawRows.length; idx++) {
          const row = rawRows[idx];

          let name = getValueByKeys(row, [
            'product name', 'product_name', 'product', 'item', 'item_name', 'item name',
            'description', 'name', 'title'
          ]);
          if (!name) {
            name = `Product #${idx + 1}`;
          }

          let sku = getValueByKeys(row, [
            'sku', 'item code', 'item_code', 'code', 'barcode', 'product_sku', 'product sku', 'item_number'
          ]);
          if (!sku) {
            sku = `SKU-${Date.now().toString().slice(-4)}-${idx + 1}`;
          }

          const category = getValueByKeys(row, ['category', 'product_category', 'product category', 'type']) || 'Power Tools';
          const unit = getValueByKeys(row, ['unit', 'uom', 'unit_of_measure', 'measurement']) || 'pcs';

          const rawPrice = getValueByKeys(row, [
            'price', 'selling price', 'selling_price', 'retail price', 'retail_price',
            'unit price', 'unit_price', 'price (rs.)'
          ]);
          const price = parseFloat(rawPrice) || 0;

          const rawCost = getValueByKeys(row, [
            'cost', 'cost price', 'cost_price', 'buying price', 'buying_price',
            'purchase price', 'purchase_price', 'cost (rs.)'
          ]);
          const costPrice = parseFloat(rawCost) || 0;

          const rawStock = getValueByKeys(row, [
            'stock', 'qty', 'quantity', 'current stock', 'current_stock', 'units_in_stock', 'stock_qty'
          ]);
          const stock = isDecimalUnit(unit) ? parseFloat(rawStock) || 0 : parseInt(rawStock) || 0;

          const rawMin = getValueByKeys(row, [
            'min stock', 'min_stock', 'reorder level', 'reorder_level', 'min', 'stock alert', 'stock_alert', 'minstock'
          ]);
          const minStock = parseInt(rawMin) || 5;

          const supplierInput = getValueByKeys(row, [
            'supplier', 'supplier_name', 'supplier name', 'vendor', 'vendor_name', 'vendor name'
          ]);
          const excelSupplierPhone = getValueByKeys(row, [
            'supplier number', 'supplier number', 'supplier phone', 'supplier_phone',
            'supplierphone', 'mobile', 'phone', 'contact'
          ]);
          const excelSupplierEmail = getValueByKeys(row, ['supplier email', 'supplier_email', 'email']);
          const excelSupplierAddress = getValueByKeys(row, ['supplier address', 'supplier_address', 'address', 'location']);

          const barcode = getValueByKeys(row, ['barcode', 'barcode_number', 'upc', 'ean']) || sku;
          const expiryDateVal = getValueByKeys(row, ['expiry date', 'expiry_date', 'expirydate', 'expiry']);

          let finalSupplierName = '';
          let finalSupplierPhone = '';
          let finalSupplierId = '';

          if (supplierInput) {
            const existingSup = suppliersMap.get(supplierInput.trim().toLowerCase());

            if (existingSup) {
              finalSupplierName = existingSup.name;
              finalSupplierPhone = existingSup.phone || excelSupplierPhone || '';
              finalSupplierId = existingSup.id;

              const updatePayload: any = {};
              if (!existingSup.phone && excelSupplierPhone) updatePayload.phone = excelSupplierPhone;
              if (!existingSup.email && excelSupplierEmail) updatePayload.email = excelSupplierEmail;
              if (!existingSup.address && excelSupplierAddress) updatePayload.address = excelSupplierAddress;

              if (Object.keys(updatePayload).length > 0) {
                try {
                  await supabase.from('suppliers').update(updatePayload).eq('id', existingSup.id);
                } catch (e) {}
              }
            } else {
              const newSupPayload = {
                name: supplierInput.trim(),
                email: excelSupplierEmail || '',
                phone: excelSupplierPhone || '',
                address: excelSupplierAddress || '',
                credit_terms: 'Net 30',
                payable_balance: 0,
                nic: ''
              };
              const { data: newSupData, error: supErr } = await supabase.from('suppliers').insert([newSupPayload]);
              if (!supErr) {
                const createdSup = {
                  id: newSupData?.[0]?.id || 'sup_' + Date.now(),
                  name: supplierInput.trim(),
                  phone: excelSupplierPhone || ''
                };
                suppliersMap.set(supplierInput.trim().toLowerCase(), createdSup);
                finalSupplierName = createdSup.name;
                finalSupplierPhone = createdSup.phone;
                finalSupplierId = createdSup.id;
              } else {
                finalSupplierName = supplierInput.trim();
                finalSupplierPhone = excelSupplierPhone || '';
              }
            }
          }

          const dbPayload: any = {
            name,
            sku,
            category,
            price,
            cost_price: costPrice,
            stock,
            min_stock: minStock,
            supplier: finalSupplierName,
            supplier_phone: finalSupplierPhone,
            supplierPhone: finalSupplierPhone,
            unit,
            barcode,
            expiry_date: expiryDateVal
          };
          if (user?.id) {
            dbPayload.user_id = user.id;
          }

          if (finalSupplierId) {
            dbPayload.supplier_id = finalSupplierId;
          }

          const { error } = await supabase.from('products').insert([dbPayload]);
          if (error) {
            const { error: updateError } = await supabase.from('products').update(dbPayload).eq('sku', sku);
            if (updateError) {
              const { error: nameError } = await supabase.from('products').update(dbPayload).eq('name', name);
              if (nameError) errors++;
              else imported++;
            } else {
              imported++;
            }
          } else {
            imported++;
          }
        }

        setToast({
          type: imported > 0 ? 'success' : 'error',
          message: `Successfully imported/updated ${imported} products! (Skipped/failed: ${errors})`
        });
        setTimeout(() => setToast(null), 5000);

        fetchProducts();
        window.dispatchEvent(new CustomEvent('refresh-inventory'));
      } catch (err: any) {
        setToast({ type: 'error', message: "Excel import error: " + err.message });
        setTimeout(() => setToast(null), 5000);
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

      // Auto-fit column widths
      ws['!cols'] = [
        { wch: 15 }, // SKU
        { wch: 30 }, // PRODUCT
        { wch: 20 }, // CATEGORY
        { wch: 15 }, // PRICE (RS.)
        { wch: 15 }, // COST (RS.)
        { wch: 10 }, // STOCK
        { wch: 10 }, // MIN
        { wch: 25 }, // SUPPLIER
        { wch: 20 }  // SUPPLIER NUMBER
      ];

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

        // 2. Style Data Rows (alternate backgrounds for zebra-striping)
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
              }
              
              cell.s = {
                font: { name: "Segoe UI", sz: 10, color: { rgb: "334155" } },
                fill: { fgColor: { rgb: bgColor } },
                alignment: { vertical: "center", horizontal: alignment },
                border: {
                  bottom: { style: "thin", color: { rgb: "F1F5F9" } },
                  top: { style: "thin", color: { rgb: "F1F5F9" } },
                  left: { style: "thin", color: { rgb: "F1F5F9" } },
                  right: { style: "thin", color: { rgb: "F1F5F9" } }
                }
              };
            }
          }
        }
      }

      XLSX.writeFile(wb, `Inventory_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err: any) {
      setToast({ type: 'error', message: "Failed to export Excel file: " + err.message });
      setTimeout(() => setToast(null), 5000);
    }
  };

  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
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
  const [suppliersList, setSuppliersList] = useState<any[]>([]);

  const [customConversionRate, setCustomConversionRate] = useState<number>(1);
  const [customConversionsList, setCustomConversionsList] = useState<{ unit: string; kgVal: number; price?: number }[]>([]);
  const [newConversionUnit, setNewConversionUnit] = useState<string>('');
  const [newConversionKg, setNewConversionKg] = useState<string>('');
  const [newConversionPrice, setNewConversionPrice] = useState<string>('');
  const [isCustomCategory, setIsCustomCategory] = useState<boolean>(false);

  const fetchSuppliers = async () => {
    try {
      const { data } = await supabase.from('suppliers').select('*');
      if (data) setSuppliersList(data);
    } catch (e) {}
  };

  const fetchProducts = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching inventory:', error.message);
    } else {
      const mappedData = data?.map(item => ({
        ...item,
        costPrice: item.costPrice !== undefined ? item.costPrice : item.cost_price !== undefined ? item.cost_price : 0,
        measureDetails: item.measureDetails !== undefined ? item.measureDetails : item.measure_details !== undefined ? item.measure_details : '',
        supplierPhone: item.supplierPhone !== undefined ? item.supplierPhone : item.supplier_phone !== undefined ? item.supplier_phone : ''
      }));
      setProducts(mappedData || []);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchProducts();
    fetchSuppliers();

    const handleRefresh = () => {
      fetchProducts();
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

  const handleInventoryScan = useCallback((scannedBarcode: string) => {
    const q = scannedBarcode.trim();
    if (!q) return;
    setSearch(q);
  }, []);

  // Global Barcode Scanner Listener for Inventory Page
  useBarcodeScanner({
    onScan: handleInventoryScan,
    enabled: !showAddModal && !showStockModal
  });

  useEffect(() => {
    if (showAddModal) {
      if (editingProduct && formData.measureDetails) {
        try {
          const parsed = JSON.parse(formData.measureDetails);
          setCustomConversionRate(Number(parsed.conversionRate) || 1);
          setCustomConversionsList(parsed.conversions || []);
        } catch (e) {
          const rate = parseFloat(formData.measureDetails) || 1;
          setCustomConversionRate(rate);
          setCustomConversionsList([]);
        }
      } else {
        setCustomConversionRate(1);
        setCustomConversionsList([]);
      }
      setNewConversionUnit('');
      setNewConversionKg('');
      setNewConversionPrice('');
    }
  }, [showAddModal, editingProduct]);

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
    setEditingProduct(null);
    setFormData(emptyProduct);
    setIsCustomCategory(false);
    setShowAddModal(true);
  };

  const openEdit = (product: Product) => {
    setEditingProduct(product);
    const rate = getProductConversionRate(product);
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
    // Validations
    if (!formData.name || formData.name.trim().length < 2) {
      setToast({ type: 'error', message: t("Product name must be at least 2 characters.", "භාණ්ඩයේ නම අවම වශයෙන් අකුරු 2ක් විය යුතුය.") });
      setTimeout(() => setToast(null), 5000);
      return;
    }

    const skuClean = formData.sku.trim().toUpperCase();
    const skuRegex = /^[A-Z0-9\-\s]{3,30}$/;
    if (!skuClean || !skuRegex.test(skuClean)) {
      setToast({ type: 'error', message: t("Invalid SKU. Use 3-30 uppercase letters, numbers, spaces, or dashes (e.g. SKU-100-A).", "වලංගු නොවන SKU කේතයකි. කැපිටල් අකුරු, ඉලක්කම් හෝ ඉරි පමණක් භාවිත කරන්න.") });
      setTimeout(() => setToast(null), 5000);
      return;
    }

    if (formData.stock < 0) {
      setToast({ type: 'error', message: t("Stock quantity cannot be negative.", "තොග ප්‍රමාණය සෘණ විය නොහැක.") });
      setTimeout(() => setToast(null), 5000);
      return;
    }

    if (formData.price <= 0) {
      setToast({ type: 'error', message: t("Selling price must be a positive number greater than 0.", "විකුණුම් මිල 0 ට වඩා වැඩි ධන අගයක් විය යුතුය.") });
      setTimeout(() => setToast(null), 5000);
      return;
    }

    if (formData.costPrice <= 0) {
      setToast({ type: 'error', message: t("Cost price must be a positive number greater than 0.", "ගැනුම් මිල 0 ට වඩා වැඩි ධන අගයක් විය යුතුය.") });
      setTimeout(() => setToast(null), 5000);
      return;
    }

    if (formData.costPrice > formData.price) {
      setToast({ type: 'error', message: t("Cost price cannot exceed Selling price.", "ගැනුම් මිල විකුණුම් මිලට වඩා වැඩි විය නොහැක.") });
      setTimeout(() => setToast(null), 5000);
      return;
    }

    if (formData.minStock < 0) {
      setToast({ type: 'error', message: t("Min stock threshold cannot be negative.", "අවම තොග සීමාව සෘණ විය නොහැක.") });
      setTimeout(() => setToast(null), 5000);
      return;
    }

    if (!formData.supplierPhone || !formData.supplierPhone.trim()) {
      setToast({ type: 'error', message: t("Supplier phone number is required.", "සැපයුම්කරුගේ දුරකථන අංකය අවශ්‍ය වේ.") });
      setTimeout(() => setToast(null), 5000);
      return;
    }

    const PREDEFINED_UNITS = ['pcs', 'kg', 'g', 'liters', 'ml', 'meters', 'boxes', 'packets', 'rolls', 'bundles'];
    if ((!PREDEFINED_UNITS.includes(formData.unit) || formData.unit === 'Other') && (!formData.unit || formData.unit.trim() === '' || formData.unit === 'Other')) {
      setToast({ type: 'error', message: t("Measurement Type is required when unit of measure is 'Other'.", "භාණ්ඩ ඒකකය 'වෙනත්' ලෙස තෝරාගත් විට මිනුම් වර්ගය අවශ්‍ය වේ.") });
      setTimeout(() => setToast(null), 5000);
      return;
    }

    if (!PREDEFINED_UNITS.includes(formData.unit) && (customConversionRate <= 0)) {
      setToast({ type: 'error', message: t("Measurement Conversion rate must be greater than 0.", "මිනුම් පරිවර්තන අනුපාතය 0 ට වඩා වැඩි විය යුතුය.") });
      setTimeout(() => setToast(null), 5000);
      return;
    }

    let serializedDetails = '';
    if (customConversionsList.length > 0 || customConversionRate > 0 || !PREDEFINED_UNITS.includes(formData.unit)) {
      serializedDetails = JSON.stringify({
        conversionRate: customConversionRate || 1,
        conversions: customConversionsList
      });
    }

    const { data } = await supabase.auth.getUser();
    const user = data?.user || { id: 'u2', role: 'super_admin' };

    setIsSaving(true);
    const dbPayload = {
      name: formData.name.trim(),
      sku: skuClean,
      category: formData.category,
      price: formData.price,
      cost_price: formData.costPrice,
      stock: formData.stock,
      min_stock: formData.minStock,
      supplier: formData.supplier.trim(),
      unit: formData.unit,
      barcode: formData.barcode.trim(),
      brand: (formData.brand || '').trim(),
      serial_no: (formData.serialNo || '').trim(),
      batch_code: (formData.batchCode || '').trim(),
      expiry_date: formData.expiryDate || '',
      supplier_phone: (formData.supplierPhone || '').trim(),
      measure_details: serializedDetails,
      user_id: user.id
    };

    try {
      if (editingProduct) {
        const { error } = await supabase
          .from('products')
          .update(dbPayload)
          .eq('id', editingProduct.id);
        if (error) {
          let errorMsg = error.message;
          if (errorMsg.includes('UNIQUE constraint failed: products.sku')) {
            errorMsg = t('Product SKU already exists. Please use a unique SKU.', 'භාණ්ඩ SKU කේතය දැනටමත් පවතී. කරුණාකර වෙනත් කේතයක් භාවිතා කරන්න.');
          }
          setToast({ type: 'error', message: errorMsg });
          setTimeout(() => setToast(null), 5000);
        } else {
          setToast({ type: 'success', message: t("Product updated successfully!", "නිෂ්පාදනය සාර්ථකව යාවත්කාලීන කරන ලදී!") });
          setTimeout(() => setToast(null), 5000);
          setShowAddModal(false);
          fetchProducts();
        }
      } else {
        const { error } = await supabase
          .from('products')
          .insert([dbPayload]);
        if (error) {
          let errorMsg = error.message;
          if (errorMsg.includes('UNIQUE constraint failed: products.sku')) {
            errorMsg = t('Product SKU already exists. Please use a unique SKU.', 'භාණ්ඩ SKU කේතය දැනටමත් පවතී. කරුණාකර වෙනත් කේතයක් භාවිතා කරන්න.');
          }
          setToast({ type: 'error', message: errorMsg });
          setTimeout(() => setToast(null), 5000);
        } else {
          setToast({ type: 'success', message: t("Product added successfully!", "නිෂ්පාදනය සාර්ථකව එක් කරන ලදී!") });
          setTimeout(() => setToast(null), 5000);
          setShowAddModal(false);
          fetchProducts();
        }
      }
    } catch (err: any) {
      let errorMsg = err.message || '';
      if (errorMsg.includes('UNIQUE constraint failed: products.sku')) {
        errorMsg = t('Product SKU already exists. Please use a unique SKU.', 'භාණ්ඩ SKU කේතය දැනටමත් පවතී. කරුණාකර වෙනත් කේතයක් භාවිතා කරන්න.');
      }
      setToast({ type: 'error', message: errorMsg });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm(t('Are you sure you want to delete this item?', 'මෙම භාණ්ඩය මකා දැමීමට ඔබට විශ්වාසද?'))) {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) {
        setToast({ type: 'error', message: error.message });
        setTimeout(() => setToast(null), 5000);
      } else {
        setToast({ type: 'success', message: t("Product deleted successfully!", "නිෂ්පාදනය සාර්ථකව මකා දමන ලදී!") });
        setTimeout(() => setToast(null), 5000);
        setSelectedProductIds((prev) => prev.filter((selectedId) => selectedId !== id));
        fetchProducts();
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
    if (!window.confirm(t(
      `Are you sure you want to delete the ${selectedProductIds.length} selected products?`,
      `තෝරාගත් නිෂ්පාදන ${selectedProductIds.length} මකා දැමීමට ඔබට විශ්වාසද?`
    ))) {
      return;
    }

    setIsLoading(true);
    try {
      const results: any[] = [];
      for (const productId of selectedProductIds) {
        const res = await supabase.from('products').delete().eq('id', productId);
        results.push(res);
      }
      const firstError = results.find((r: any) => r?.error);
      if (firstError) throw firstError.error;
      setToast({ type: 'success', message: t('Selected products deleted successfully!', 'තෝරාගත් නිෂ්පාදන සාර්ථකව මකා දමන ලදි!') });
      setTimeout(() => setToast(null), 5000);
      setSelectedProductIds([]);
      fetchProducts();
    } catch (err: any) {
      setToast({ type: 'error', message: t('Failed to delete selected products: ', 'තෝරාගත් නිෂ්පාදන මකා ගැනීමට අපොහොසත් විය: ') + err.message });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAll = async () => {
    if (products.length === 0) return;
    if (!window.confirm(t(
      'WARNING: Are you sure you want to delete ALL products in the inventory? This action is permanent and cannot be undone.',
      'අනතුරු ඇඟවීමයි: තොගයේ ඇති සියලුම නිෂ්පාදන මකා දැමීමට ඔබට විශ්වාසද? මෙම ක්‍රියාව ස්ථිර වන අතර ආපසු හැරවිය නොහැක.'
    ))) {
      return;
    }
    
    if (!window.confirm(t(
      'Please confirm once more: Do you really want to clear the entire inventory database?',
      'කරුණාකර තවත් වරක් තහවුරු කරන්න: ඔබට ඇත්තටම මුළු තොග දත්ත ගබඩාවම මකා දැමීමට අවශ්‍යද?'
    ))) {
      return;
    }

    setIsLoading(true);
    try {
      const results: any[] = [];
      for (const product of products) {
        const res = await supabase.from('products').delete().eq('id', product.id);
        results.push(res);
      }
      const firstError = results.find((r: any) => r?.error);
      if (firstError) throw firstError.error;
      setToast({ type: 'success', message: t('All inventory products deleted successfully!', 'සියලුම තොග නිෂ්පාදන සාර්ථකව මකා දමන ලදි!') });
      setTimeout(() => setToast(null), 5000);
      setSelectedProductIds([]);
      fetchProducts();
    } catch (err: any) {
      setToast({ type: 'error', message: t('Failed to delete all products: ', 'සියලුම නිෂ්පාදන මකා ගැනීමට අපොහොසත් විය: ') + err.message });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStockAdjust = async () => {
    if (!stockProduct) return;
    if (stockQty <= 0) {
      alert(t("Please enter a valid quantity.", "කරුණාකර වලංගු ප්‍රමාණයක් ඇතුළත් කරන්න."));
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email || 'sanojhardware@gmail.com';

    const isIncrement = actionType === 'Adjustment (Increase)' || actionType === 'Sale Return';
    const newQty = isIncrement 
      ? stockProduct.stock + stockQty 
      : Math.max(0, stockProduct.stock - stockQty);

    setIsSaving(true);

    try {
      // 1. Update stock
      const { error: stockError } = await supabase
        .from('products')
        .update({ stock: newQty })
        .eq('id', stockProduct.id);

      if (stockError) throw stockError;

      // 2. Log in stock_adjustments (SQLite REST API + Supabase)
      const adjustmentRecord = {
        id: 'sa_' + Date.now(),
        product_id: stockProduct.id,
        product_name: stockProduct.name,
        old_qty: stockProduct.stock,
        new_qty: newQty,
        reason: reasonNotes.trim() || actionType,
        type: actionType,
        user_email: userEmail,
        created_at: new Date().toISOString()
      };

      try {
        await api.stockAdjustments.create(adjustmentRecord);
      } catch (e) {
        console.warn("Local SQLite stock adjustment log notice:", e);
      }

      const { error: adjustError } = await supabase
        .from('stock_adjustments')
        .insert([adjustmentRecord]);

      if (adjustError) throw adjustError;

      // 3. Log expense in transactions if Damage
      if (actionType === 'Damage') {
        const damageCost = stockQty * (stockProduct.costPrice || 0);
        await supabase
          .from('transactions')
          .insert([{
            type: 'expense',
            category: 'Damage',
            description: `Damaged Stock Written Off: ${stockProduct.name} (x${stockQty})`,
            amount: damageCost,
            reference: stockProduct.sku,
            date: new Date().toISOString().split('T')[0]
          }]);
      }

      setToast({ type: 'success', message: t('Stock action logged and stock levels adjusted!', 'තොග ක්‍රියාව සටහන් කර ඇති අතර තොග මට්ටම් යාවත්කාලීන කරන ලදී!') });
      setTimeout(() => setToast(null), 5000);
      fetchProducts();
      setShowStockModal(false);
    } catch (err: any) {
      setToast({ type: 'error', message: err.message });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-500">
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
          <div className="flex items-center gap-3 bg-gray-50/50 border border-gray-200 rounded-xl px-4 py-3 flex-1 min-w-[250px] group focus-within:ring-2 focus-within:ring-[#DAA520]/20 transition-all">
            <SearchIcon className="w-5 h-5 text-gray-400 group-focus-within:text-[#DAA520] transition-colors" />
            <input
              type="text"
              placeholder={t('Search', 'සොයන්න')}
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
          <button onClick={() => setIsSinhala(!isSinhala)} className="flex items-center justify-center gap-2 bg-[#464646]/10 hover:bg-[#464646]/20 text-[#464646] px-5 py-3 rounded-xl text-xs font-black transition-all uppercase tracking-widest border border-gray-200 shadow-sm shrink-0">
            {isSinhala ? '🇺🇸 English' : '🇱🇰 සිංහල'}
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()} 
            className="flex items-center justify-center gap-2 bg-[#464646] hover:bg-[#333333] text-white px-6 py-3 rounded-xl text-sm font-black shadow-lg shadow-[#464646]/20 transition-all uppercase tracking-widest"
          >
            <PlusIcon className="w-4 h-4" /> {t('Import Excel', 'Excel ආනයනය කරන්න')}
          </button>
          <button 
            onClick={handleExportExcel} 
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl text-sm font-black shadow-lg shadow-emerald-600/20 transition-all uppercase tracking-widest"
          >
            <DownloadIcon className="w-4 h-4" /> {t('Export Excel', 'Excel අපනයනය කරන්න')}
          </button>
          <button onClick={openAdd} className="flex items-center justify-center gap-2 bg-[#DAA520] hover:bg-[#B8860B] text-white px-6 py-3 rounded-xl text-sm font-black shadow-lg shadow-[#DAA520]/20 transition-all uppercase tracking-widest">
            <PlusIcon className="w-4 h-4" /> {t('Add Product', 'නිෂ්පාදනය එක් කරන්න')}
          </button>
          <button onClick={handleDeleteAll} disabled={products.length === 0} className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-100 disabled:text-gray-300 text-white px-6 py-3 rounded-xl text-sm font-black shadow-lg shadow-red-600/20 transition-all uppercase tracking-widest shrink-0">
            <Trash2Icon className="w-4 h-4" /> {t('Delete All', 'සියල්ල මකන්න')}
          </button>
        </div>
      </div>

      {/* Bulk Actions Banner */}
      {selectedProductIds.length > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-center gap-4 animate-in slide-in-from-top-5 duration-300">
          <div className="flex items-center gap-2.5 text-red-800 font-bold text-sm">
            <AlertTriangleIcon className="w-5 h-5 text-red-600 animate-pulse" />
            <span>
              {t(
                `${selectedProductIds.length} item(s) selected for bulk actions`,
                `තොග ක්‍රියාකාරකම් සඳහා අයිතම ${selectedProductIds.length} ක් තෝරාගෙන ඇත`
              )}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleBulkDelete}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-red-600/20 transition-all uppercase tracking-widest"
            >
              <Trash2Icon className="w-4 h-4" /> {t('Delete Selected', 'තෝරාගත් මකන්න')}
            </button>
          </div>
        </div>
      )}

      {/* Table Section */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden text-left">
        {/* Table Header with gradient */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-white">{t('Inventory Database Catalog', 'තොග දත්ත ගබඩා නාමාවලිය')}</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{t('Manage product stock counts, pricing, cost items, and suppliers', 'නිෂ්පාදන තොග ගණන්, මිල නියම කිරීම්, පිරිවැය සහ සැපයුම්කරුවන් කළමනාකරණය කරන්න')}</p>
          </div>
          <span className="px-3 py-1.5 bg-[#DAA520]/20 text-[#DAA520] text-xs font-black rounded-full border border-[#DAA520]/30">
            {filtered.length} {t('Products', 'නිෂ්පාදන')}
          </span>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-20 text-center text-gray-400">
              <Loader2Icon className="animate-spin w-8 h-8 text-[#DAA520] mx-auto mb-4" />
              <p className="font-bold">{t('Syncing inventory database...', 'තොග දත්ත ගබඩාව සමකාලීන වෙමින්...')}</p>
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
                  <th className="px-6 py-4">{t('SKU', 'SKU / කේතය')}</th>
                  <th className="px-6 py-4">{t('Product', 'නිෂ්පාදනය')}</th>
                  <th className="px-6 py-4">{t('Category', 'ප්‍රවර්ගය')}</th>
                  <th className="px-6 py-4 text-right">{t('Price', 'මිල')} ({symbol})</th>
                  <th className="px-6 py-4 text-right">{t('Cost', 'වියදම')} ({symbol})</th>
                  <th className="px-6 py-4 text-center">{t('Stock', 'තොගය')}</th>
                  <th className="px-6 py-4 text-center">{t('Min', 'අවම')}</th>
                  <th className="px-6 py-4">{t('Supplier', 'සැපයුම්කරු')}</th>
                  <th className="px-6 py-4">{t('Supplier Number', 'සැපයුම්කරුගේ අංකය')}</th>
                  <th className="px-6 py-4 text-center">{t('Actions', 'ක්‍රියාකාරකම්')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((product) => {
                  const isLow = product.stock < product.minStock;
                  return (
                    <tr key={product.id} className={`hover:bg-amber-50/30 transition-colors group ${isLow ? 'bg-red-50/50' : ''}`}>
                      <td className="px-6 py-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(product.id)}
                          onChange={() => handleToggleSelectProduct(product.id)}
                          className="rounded border-gray-300 text-[#DAA520] focus:ring-[#DAA520] cursor-pointer w-4 h-4"
                        />
                      </td>
                      <td className="px-6 py-4 font-mono text-xs font-bold text-gray-400">{product.sku}</td>
                      <td className="px-6 py-4">
                        <div className="font-black text-slate-800">{product.name}</div>
                        {product.brand && (
                          <div className="text-[10px] text-[#DAA520] font-black uppercase tracking-wider mt-0.5">{product.brand}</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg text-[9px] font-black uppercase tracking-wider">
                          {t(product.category, categoryTranslations[product.category]?.si || product.category)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-black text-[#DAA520]">{symbol} {convert(product.price).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right font-bold text-gray-400">{symbol} {convert(product.costPrice).toLocaleString()}</td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex flex-col items-center">
                          <span className={`font-black text-base ${isLow ? 'text-red-500' : 'text-slate-800'}`}>{formatStock(product.stock, product.unit)}</span>
                          <span className="text-gray-400 text-[9px] uppercase font-black tracking-widest">
                            {t(product.unit, unitTranslations[product.unit] || product.unit)}
                          </span>
                          {(() => {
                            const conversions = getProductConversions(product);
                            if (conversions.length > 0) {
                              return (
                                <div className="text-[8px] text-[#DAA520] font-black mt-1 text-center leading-tight max-w-[125px]">
                                  {conversions.map((c: any, i: number) => (
                                    <div key={i} className="whitespace-nowrap">
                                      = {(product.stock * c.kgVal).toLocaleString(undefined, { maximumFractionDigits: 2 })} {c.unit}
                                    </div>
                                  ))}
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center text-gray-400 font-bold italic">{product.minStock}</td>
                      <td className="px-6 py-4 text-gray-500 font-bold text-xs truncate max-w-[150px]">{product.supplier || '—'}</td>
                      <td className="px-6 py-4 text-gray-500 font-bold text-xs truncate max-w-[150px]">{product.supplierPhone || '—'}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => openStock(product, 'in')} className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white border border-emerald-100 transition-all shadow-sm" title="Stock In"><ArrowUpIcon className="w-4 h-4" /></button>
                          <button onClick={() => openStock(product, 'out')} className="p-2.5 rounded-xl bg-amber-50 text-amber-600 hover:bg-amber-500 hover:text-white border border-amber-100 transition-all shadow-sm" title="Stock Out"><ArrowDownIcon className="w-4 h-4" /></button>
                          <button onClick={() => openEdit(product)} className="p-2.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-200 border border-blue-100 transition-all shadow-sm" title="Edit Product"><EditIcon className="w-4 h-4" /></button>
                          <button onClick={() => handleDelete(product.id)} className="p-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-500 hover:text-white border border-red-100 transition-all shadow-sm shadow-red-500/10" title="Delete Product"><Trash2Icon className="w-4 h-4" /></button>
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

      {/* Add/Edit Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title={t(editingProduct ? 'Edit Inventory' : 'New Hardware Product', editingProduct ? 'තොග සංස්කරණය කරන්න' : 'නව නිෂ්පාදනයක් එක් කරන්න')} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-2">
          <div className="col-span-2">
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Product Name *', 'භාණ්ඩයේ නම *')}</label>
            <input required type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('SKU / ID *', 'SKU / කේතය *')}</label>
            <input required type="text" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Category', 'ප්‍රවර්ගය')}</label>
            <select 
              value={categories.filter(c => c !== 'All').includes(formData.category) ? formData.category : 'Other'} 
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'Other') {
                  setFormData({ ...formData, category: '' });
                  setIsCustomCategory(true);
                } else {
                  setFormData({ ...formData, category: val });
                  setIsCustomCategory(false);
                }
              }} 
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520] bg-white cursor-pointer"
            >
              {categories.filter(c => c !== 'All').map(c => <option key={c} value={c}>{t(c, categoryTranslations[c]?.si || c)}</option>)}
              <option value="Other">{t('Other', 'වෙනත්')}</option>
            </select>
          </div>
          {isCustomCategory && (
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Custom Category *', 'අභිරුචි ප්‍රවර්ගය *')}</label>
              <input 
                required 
                type="text" 
                value={formData.category} 
                onChange={(e) => setFormData({ ...formData, category: e.target.value })} 
                placeholder={t('Enter custom category name', 'අභිරුචි ප්‍රවර්ගය ඇතුළත් කරන්න')} 
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" 
              />
            </div>
          )}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Brand / Manufacturer', 'වෙළඳ නාමය / නිෂ්පාදකයා')}</label>
            <input type="text" value={formData.brand || ''} onChange={(e) => setFormData({ ...formData, brand: e.target.value })} placeholder="e.g. Stanley, Bosch" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>
          
          {/* Initial Stock Field */}
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Current Stock Quantity', 'ආරම්භක තොග ප්‍රමාණය')}</label>
            <input 
              type="number" 
              step={isDecimalUnit(formData.unit) ? 'any' : '1'} 
              value={formData.stock === 0 ? '' : formData.stock} 
              onChange={(e) => setFormData({ ...formData, stock: isDecimalUnit(formData.unit) ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0 })} 
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" 
            />
            {customConversionsList.length > 0 && (
              <p className="text-[10px] text-[#DAA520] font-black mt-1.5">
                {t('Equivalent Stock:', 'සමාන තොගය:')} {customConversionsList.map(c => `${((formData.stock || 0) * c.kgVal).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c.unit}`).join(' / ')}
              </p>
            )}
          </div>
          
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Unit of Measure', 'භාණ්ඩ ඒකකය')}</label>
            <select 
              value={['pcs', 'kg', 'g', 'liters', 'ml', 'meters', 'boxes', 'packets', 'rolls', 'bundles', 'Cube'].includes(formData.unit) ? formData.unit : 'Other'} 
              onChange={(e) => setFormData({ ...formData, unit: e.target.value === 'Other' ? 'Other' : e.target.value })} 
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520] bg-white cursor-pointer"
            >
              <option value="pcs">{t('pcs (Pieces)', 'pcs (කෑලි)')}</option>
              <option value="kg">{t('kg (Kilograms)', 'kg (කිලෝග්‍රෑම්)')}</option>
              <option value="Cube">{t('Cube (කියුබ්)', 'කියුබ් (Cube)')}</option>
              <option value="g">{t('g (Grams)', 'g (ග්‍රෑම්)')}</option>
              <option value="liters">{t('liters (Liters)', 'liters (ලීටර්)')}</option>
              <option value="ml">{t('ml (Milliliters)', 'ml (මිලිලීටර්)')}</option>
              <option value="meters">{t('meters (Meters)', 'meters (මීටර්)')}</option>
              <option value="boxes">{t('boxes (Boxes)', 'boxes (පෙට්ටි)')}</option>
              <option value="packets">{t('packets (Packets)', 'packets (පැකට්)')}</option>
              <option value="rolls">{t('rolls (Rolls)', 'rolls (රෝල්ස්)')}</option>
              <option value="bundles">{t('bundles (Bundles)', 'bundles (මිටි)')}</option>
              <option value="Other">{t('Other', 'වෙනත්')}</option>
            </select>
          </div>

          {(!['pcs', 'kg', 'g', 'liters', 'ml', 'meters', 'boxes', 'packets', 'rolls', 'bundles'].includes(formData.unit) || formData.unit === 'Other') && (
            <>
              {formData.unit !== 'Cube' && (
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Measurement Type * (e.g. Cube)', 'මිනුම් වර්ගය * (උදා. කියුබ්)')}</label>
                  <input 
                    required
                    type="text" 
                    value={formData.unit === 'Other' ? '' : formData.unit} 
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })} 
                    placeholder={t('e.g. Cube, Bucket, Shovel', 'උදා: කියුබ්, බාල්දි, අලවංගු')} 
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" 
                  />
                </div>
              )}
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">
                  {t(`Conversion to kg * (1 ${formData.unit === 'Other' ? 'Unit' : formData.unit} = X kg)`, `කිලෝග්‍රෑම් වලට පරිවර්තනය * (1 ${formData.unit === 'Other' ? 'ඒකකයක්' : formData.unit} = කිලෝග්‍රෑම් X)`)}
                </label>
                <input 
                  required
                  type="number" 
                  min={0.01}
                  step="any"
                  value={customConversionRate || ''} 
                  onChange={(e) => setCustomConversionRate(parseFloat(e.target.value) || 0)} 
                  placeholder="e.g. 1000" 
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" 
                />
              </div>
              <div className="col-span-2 bg-slate-50 border border-slate-200 p-4.5 rounded-2xl space-y-3">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <span className="w-1.5 h-3 bg-amber-500 rounded-full"></span>
                  {t('Additional Conversions for this Product (e.g. Bucket, Shovel)', 'මෙම භාණ්ඩය සඳහා වෙනත් මිනුම් ඒකක (උදා. බාල්දි, හැඳි)')}
                </h4>
                <div className="text-[10px] text-amber-800 bg-amber-50/50 border border-amber-200/50 rounded-xl p-3.5 leading-relaxed font-bold">
                  💡 <strong>{t(`${formData.unit || 'Base Unit'} Conversion Guide & Examples:`, `${formData.unit || 'ඒකකය'} පරිවර්තන මාර්ගෝපදේශය සහ උදාහරණ:`)}</strong>
                  <div className="mt-1 font-semibold text-slate-600 space-y-1">
                    <div className="text-amber-900 bg-amber-100/40 px-2.5 py-1.5 rounded-xl border border-amber-200/25">
                      <strong>{t('Conversion Examples:', 'පරිවර්තන උදාහරණ:')}</strong>
                      <div className="mt-0.5 ml-1 font-bold text-amber-950">• 1 {formData.unit || 'Box'} = 24 Bottles</div>
                      <div className="ml-1 font-bold text-amber-950">• 1 {formData.unit || 'Cube'} = 250 Buckets</div>
                    </div>
                    <div className="mt-1.5">• 1 {formData.unit || 'Base Unit'} = {t('how many sub-units', 'උප ඒකක කීයද')} (e.g. {t(`enter "Bucket" as Unit Name and "250" as Units per ${formData.unit || 'Base Unit'}`, `ඒකකයේ නම "Bucket" සහ අගය "250" ලෙස ඇතුළත් කරන්න`)} )</div>
                  </div>
                </div>
                {customConversionsList.length > 0 && (
                  <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                    {customConversionsList.map((conv, idx) => (
                      <div key={idx} className="flex justify-between items-center bg-white border border-slate-200 p-2.5 rounded-xl text-xs font-bold text-[#464646]">
                        <span>
                          1 {formData.unit || 'Base Unit'} = {conv.kgVal} {conv.unit}(s)
                          {conv.price !== undefined ? ` (${symbol} ${conv.price.toLocaleString()})` : ''}
                        </span>
                        <button 
                          type="button" 
                          onClick={() => setCustomConversionsList(customConversionsList.filter((_, i) => i !== idx))} 
                          className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-lg transition-colors font-black"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="block text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">{t('Unit Name', 'ඒකකයේ නම')}</label>
                    <input 
                      type="text" 
                      value={newConversionUnit} 
                      onChange={(e) => setNewConversionUnit(e.target.value)} 
                      placeholder="e.g. Bottle, Bucket, Shovel" 
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-[#464646] outline-none focus:ring-1 focus:ring-[#DAA520]" 
                    />
                  </div>
                  <div className="w-28">
                    <label className="block text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">
                      {t(`Units per 1 ${formData.unit || 'Base'}`, `1 ${formData.unit || 'ඒකකය'} කට ඇති ගණන`)}
                    </label>
                    <input 
                      type="number" 
                      min={0.01}
                      step="any"
                      value={newConversionKg} 
                      onChange={(e) => setNewConversionKg(e.target.value)} 
                      placeholder="e.g. 250" 
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-[#464646] outline-none focus:ring-1 focus:ring-[#DAA520]" 
                    />
                  </div>
                  <div className="w-28">
                    <label className="block text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">{t('Price (Optional)', 'මිල (විකල්ප)')}</label>
                    <input 
                      type="number" 
                      min={0.01}
                      step="any"
                      value={newConversionPrice} 
                      onChange={(e) => setNewConversionPrice(e.target.value)} 
                      placeholder="e.g. 300" 
                      className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-[#464646] outline-none focus:ring-1 focus:ring-[#DAA520]" 
                    />
                  </div>
                  <button 
                    type="button" 
                    onClick={() => {
                      if (newConversionUnit.trim() && parseFloat(newConversionKg) > 0) {
                        const parsedPrice = parseFloat(newConversionPrice);
                        setCustomConversionsList([
                          ...customConversionsList, 
                          { 
                            unit: newConversionUnit.trim(), 
                            kgVal: parseFloat(newConversionKg),
                            price: isNaN(parsedPrice) ? undefined : parsedPrice
                          }
                        ]);
                        setNewConversionUnit('');
                        setNewConversionKg('');
                        setNewConversionPrice('');
                      } else {
                        alert(t('Please enter both unit name and weight.', 'කරුණාකර ඒකකයේ නම සහ බර ඇතුළත් කරන්න.'));
                      }
                    }}
                    className="px-4 py-2 bg-[#DAA520] hover:bg-[#B8860B] text-white rounded-lg text-xs font-black uppercase tracking-wider transition-colors shadow-sm cursor-pointer whitespace-nowrap"
                  >
                    + {t('Add Unit', 'ඒකකය එක් කරන්න')}
                  </button>
                </div>
              </div>
            </>
          )}
          
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Base Selling Price *', 'සිල්ලර විකුණුම් මිල *')} ({symbol})</label>
            <input type="number" value={formData.price === 0 ? '' : formData.price} onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Base Cost Price *', 'ගැනුම් මිල (වියදම) *')} ({symbol})</label>
            <input type="number" value={formData.costPrice === 0 ? '' : formData.costPrice} onChange={(e) => setFormData({ ...formData, costPrice: parseFloat(e.target.value) || 0 })} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>
          
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Stock Alert Threshold', 'අවම තොග අනතුරු ඇඟවීම')}</label>
            <input type="number" value={formData.minStock === 0 ? '' : formData.minStock} onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Supplier', 'සැපයුම්කරු')}</label>
            <select 
              value={formData.supplier} 
              onChange={(e) => {
                const sName = e.target.value;
                const selectedSup = suppliersList.find(s => s.name === sName);
                setFormData({ 
                  ...formData, 
                  supplier: sName,
                  supplierPhone: selectedSup ? selectedSup.phone : formData.supplierPhone 
                });
              }} 
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520] bg-white cursor-pointer"
            >
              <option value="">Select a registered supplier...</option>
              {suppliersList.map((s) => (
                <option key={s.id} value={s.name}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Supplier Phone Number *', 'සැපයුම්කරුගේ දුරකථන අංකය *')}</label>
            <input required type="text" value={formData.supplierPhone || ''} onChange={(e) => setFormData({ ...formData, supplierPhone: e.target.value })} placeholder={t('Supplier Phone Number', 'සැපයුම්කරුගේ දුරකථන අංකය')} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Barcode', 'තීරු කේතය')}</label>
            <input type="text" value={formData.barcode} onChange={(e) => setFormData({ ...formData, barcode: e.target.value })} placeholder="EAN / UPC Code" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Serial Number', 'අනුක්‍රමික අංකය')}</label>
            <input type="text" value={formData.serialNo || ''} onChange={(e) => setFormData({ ...formData, serialNo: e.target.value })} placeholder="e.g. SN-849302" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Batch Code', 'කාණ්ඩ කේතය')}</label>
            <input type="text" value={formData.batchCode || ''} onChange={(e) => setFormData({ ...formData, batchCode: e.target.value })} placeholder="e.g. BATCH-2026-A" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Expiry Date (Optional)', 'කල් ඉකුත් වීමේ දිනය (විකල්ප)')}</label>
            <input type="date" value={formData.expiryDate || ''} onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })} className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>
        </div>
        <div className="flex gap-3 mt-6 pt-5 border-t border-gray-100">
          <button onClick={() => setShowAddModal(false)} className="flex-1 py-3.5 bg-gray-100 text-gray-500 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-gray-200 transition-all">{t('Cancel', 'අවලංගු කරන්න')}</button>
          <button onClick={handleSave} disabled={isSaving} className="flex-[2] py-3.5 bg-[#DAA520] hover:bg-[#B8860B] disabled:bg-gray-200 disabled:text-gray-300 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-[#DAA520]/20 flex items-center justify-center gap-2">
            {isSaving ? <Loader2Icon className="animate-spin w-4 h-4" /> : null}
            {t(editingProduct ? 'Update Product' : 'Add Product', editingProduct ? 'තොගය යාවත්කාලීන කරන්න' : 'නිෂ්පාදනය සුරකින්න')}
          </button>
        </div>
      </Modal>

      {/* Stock Adjust Modal */}
      <Modal isOpen={showStockModal} onClose={() => setShowStockModal(false)} title={`${t('Log Stock Action', 'තොග ක්‍රියාකාරකම සටහන් කරන්න')} - ${stockProduct?.name}`} size="sm">
        <div className="space-y-5">
          <div className="bg-gray-50 rounded-2xl p-5 text-center border border-gray-100 shadow-inner">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{t('Available Now', 'දැන් ලබාගත හැක')}</p>
            <p className="text-3xl font-black text-[#464646]">{formatStock(stockProduct?.stock, stockProduct?.unit)} <span className="text-sm text-gray-400 uppercase tracking-widest">{t(stockProduct?.unit || '', unitTranslations[stockProduct?.unit || ''] || stockProduct?.unit || '')}</span></p>
            {(() => {
              if (!stockProduct) return null;
              const conversions = getProductConversions(stockProduct);
              if (conversions.length > 0) {
                return (
                  <p className="text-[10px] text-amber-600 font-bold mt-1.5">
                    (= {conversions.map((c: any) => `${(stockProduct.stock * c.kgVal).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c.unit}`).join(' / ')})
                  </p>
                );
              }
              return null;
            })()}
          </div>
          
          <div className="text-left">
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Stock Action Type', 'තොග ක්‍රියාකාරකම් වර්ගය')}</label>
            <select 
              value={actionType} 
              onChange={(e) => setActionType(e.target.value)} 
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520] bg-white cursor-pointer"
            >
              {stockType === 'in' ? (
                <>
                  <option value="Adjustment (Increase)">Adjustment (Increase) / තොග වැඩි කිරීම</option>
                  <option value="Sale Return">Sale Return (Restock) / විකුණුම් ආපසු පැමිණීම</option>
                </>
              ) : (
                <>
                  <option value="Adjustment (Decrease)">Adjustment (Decrease) / තොග අඩු කිරීම</option>
                  <option value="Damage">Damage (Expense Write-off) / හානි වූ දෑ ඉවත් කිරීම</option>
                  <option value="Purchase Return">Purchase Return / සැපයුම්කරුට ආපසු යැවීම</option>
                </>
              )}
            </select>
          </div>

          <div className="text-left">
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Quantity', 'ප්‍රමාණය')}</label>
            <input 
              type="number" 
              min={isDecimalUnit(stockProduct?.unit) ? 0.01 : 1} 
              step={isDecimalUnit(stockProduct?.unit) ? 'any' : '1'} 
              autoFocus 
              value={stockQty} 
              onChange={(e) => setStockQty(isDecimalUnit(stockProduct?.unit) ? parseFloat(e.target.value) || 0 : parseInt(e.target.value) || 0)} 
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" 
            />
            {(() => {
              if (!stockProduct) return null;
              const conversions = getProductConversions(stockProduct);
              if (conversions.length > 0 && stockQty > 0) {
                return (
                  <p className="text-[10px] text-amber-600 font-bold mt-1.5">
                    {t('Equivalent adjust quantity:', 'පරිවර්තනය වන ප්‍රමාණය:')} {conversions.map((c: any) => `${(stockQty * c.kgVal).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${c.unit}`).join(' / ')}
                  </p>
                );
              }
              return null;
            })()}
          </div>

          <div className="text-left">
            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Reason / Notes', 'හේතුව / සටහන්')}</label>
            <input type="text" value={reasonNotes} onChange={(e) => setReasonNotes(e.target.value)} placeholder="e.g. Broken packaging, customer change of mind" className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" />
          </div>

          <div className="flex flex-col gap-3 pt-2">
            <button onClick={handleStockAdjust} disabled={isSaving} className={`w-full py-4 text-xs font-black text-white rounded-2xl transition-all shadow-lg uppercase tracking-widest ${stockType === 'in' ? 'bg-[#DAA520] hover:bg-[#B8860B] shadow-[#DAA520]/20' : 'bg-[#464646] hover:bg-[#333333] shadow-[#464646]/20'}`}>
              {isSaving ? <Loader2Icon className="animate-spin w-4.5 h-4.5 mx-auto" /> : t('Commit Action', 'ක්‍රියාව සටහන් කරන්න')}
            </button>
            <button onClick={() => setShowStockModal(false)} className="w-full py-3.5 text-[10px] font-black text-gray-400 hover:bg-gray-100 rounded-2xl uppercase tracking-widest transition-colors">{t('Dismiss', 'අවලංගු කරන්න')}</button>
          </div>
        </div>
      </Modal>

      {/* Floating Toast Notification Card */}
      {toast && (
        <div className={`fixed top-5 right-5 z-[9999] max-w-sm w-full bg-white/95 backdrop-blur-md rounded-2xl border p-4 shadow-2xl flex items-start gap-3.5 transition-all duration-300 animate-in slide-in-from-top-5 ${
          toast.type === 'success' ? 'border-[#DAA520]/30 shadow-[#DAA520]/5' : 'border-red-200 shadow-red-200/5'
        }`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            toast.type === 'success' ? 'bg-[#DAA520]/10 text-[#DAA520]' : 'bg-red-50 text-red-500'
          }`}>
            {toast.type === 'success' ? <CheckCircleIcon className="w-5 h-5" /> : <AlertTriangleIcon className="w-5 h-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-black uppercase tracking-widest ${toast.type === 'success' ? 'text-[#DAA520]' : 'text-red-500'}`}>
              {toast.type === 'success' ? t('Success', 'සාර්ථකයි') : t('Notification', 'විදහා දැක්වීම')}
            </p>
            <p className="text-sm text-[#464646] font-bold mt-1 leading-relaxed">{toast.message}</p>
          </div>
          <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-600 transition-colors p-1 hover:bg-gray-50 rounded-lg">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}