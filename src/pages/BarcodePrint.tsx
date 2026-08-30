import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Printer,
  Trash2,
  Plus,
  Minus,
  Tag,
  RefreshCw,
  Layers,
  Maximize2
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { supabase } from '../lib/supabaseClient';
import type { Product } from '../types';

export type PresetType = '38x25' | '50x25' | '100x25_3up';

export interface QueueItem {
  product: Product;
  quantity: number;
}

export interface BarcodeSvgProps {
  value: string;
  format?: string;
  width?: number;
  height?: number;
  fontSize?: number;
  displayValue?: boolean;
}

/**
 * Safe Barcode String Resolver:
 * Ensures every product always returns a non-empty, valid barcode string.
 */
export const getSafeBarcode = (product?: Product | null): string => {
  if (!product) return 'HW10001';
  if (product.barcode && typeof product.barcode === 'string' && product.barcode.trim() !== '') {
    return product.barcode.trim();
  }
  if (product.sku && typeof product.sku === 'string' && product.sku.trim() !== '') {
    return product.sku.trim();
  }
  const numericPart = String(product.id || '').replace(/\D/g, '');
  const seq = numericPart ? numericPart.slice(-5) : '10001';
  return `HW${seq.padStart(5, '0')}`;
};

/**
 * Generates an ultra-crisp 1-bit raster Data URL using an offscreen canvas.
 * This guarantees optical readability on 203 DPI thermal printers without sub-pixel blurring.
 */
const generateCrispBarcodeDataUrl = (value: string, is3Up: boolean): string => {
  try {
    const canvas = document.createElement('canvas');
    const safeVal = value && value.trim() ? value.trim() : 'HW10001';

    JsBarcode(canvas, safeVal, {
      format: 'CODE128',
      width: is3Up ? 1 : 2,
      height: is3Up ? 36 : 45,
      displayValue: false,
      margin: 0,
      background: '#ffffff',
      lineColor: '#000000'
    });

    return canvas.toDataURL('image/png');
  } catch (e) {
    console.error('Failed to generate crisp barcode canvas:', e);
    return '';
  }
};

/**
 * Standalone Barcode SVG Component for Screen Preview.
 */
export const BarcodeSvg: React.FC<BarcodeSvgProps> = ({
  value,
  format = 'CODE128',
  width = 1.2,
  height = 30,
  fontSize = 11,
  displayValue = false
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      const codeValue = value && value.trim() ? value.trim() : 'HW10001';
      svgRef.current.innerHTML = '';
      JsBarcode(svgRef.current, codeValue, {
        format,
        width,
        height,
        displayValue,
        fontSize,
        fontOptions: 'bold',
        font: 'monospace',
        margin: 2,
        background: '#ffffff',
        lineColor: '#000000'
      });
    } catch (err) {
      console.warn('Barcode SVG generation warning:', err);
    }
  }, [value, format, width, height, fontSize, displayValue]);

  return <svg ref={svgRef} className="mx-auto block max-w-full" />;
};

/**
 * Visual Preview Card Component
 */
export const StickerPreviewCard: React.FC<{ product: Product; preset: PresetType }> = ({ product, preset }) => {
  const barcodeValue = getSafeBarcode(product);
  const isCompact = preset === '38x25';
  const is3Up = preset === '100x25_3up';

  if (is3Up) {
    return (
      <div className="flex gap-2 bg-white p-2 border-2 border-black rounded shadow-md w-[380px]">
        {[0, 1, 2].map((idx) => (
          <div key={idx} className="flex-1 bg-white border border-gray-400 p-1 flex flex-col justify-between text-center font-sans overflow-hidden">
            <div className="font-black text-[8px] tracking-tighter uppercase text-black leading-tight border-b border-black pb-0.5 truncate">
              MUTHUWADIGE HW
            </div>
            <div className="font-bold text-[9px] text-black leading-none truncate my-0.5">
              {product.name}
            </div>
            <div className="my-0.5 flex justify-center px-1">
              <BarcodeSvg value={barcodeValue} width={1.0} height={24} displayValue={false} />
            </div>
            <div className="font-mono text-[7px] font-bold text-black leading-none">{barcodeValue}</div>
            <div className="font-black text-[9px] text-black border-t border-black pt-0.5 mt-0.5">
              Rs. {Number(product.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`bg-white border-2 border-black p-2 rounded shadow-md flex flex-col justify-between text-center font-sans overflow-hidden ${isCompact ? 'w-[220px] h-[145px]' : 'w-[280px] h-[155px]'
        }`}
    >
      <div className="font-black text-[10px] tracking-tighter uppercase text-black leading-tight border-b border-black pb-1 truncate">
        MUTHUWADIGE HARDWARE
      </div>
      <div className="font-bold text-[11px] text-black leading-tight truncate my-1">
        {product.name}
      </div>
      <div className="my-1 flex justify-center max-w-[200px] mx-auto overflow-hidden">
        <BarcodeSvg
          value={barcodeValue}
          width={isCompact ? 1.0 : 1.3}
          height={isCompact ? 28 : 34}
          displayValue={false}
        />
      </div>
      <div className="font-mono text-[9px] font-bold text-black leading-none">{barcodeValue}</div>
      <div className="font-black text-[11px] text-black border-t border-black pt-1 mt-1">
        Rs. {Number(product.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
      </div>
    </div>
  );
};

/**
 * Isolated Thermal Printing Dispatcher:
 * Generates direct high-contrast pixel data for the printer.
 */
const printThermalLabelsIsolated = (queue: QueueItem[], preset: PresetType) => {
  const allLabels: Product[] = [];
  queue.forEach((item) => {
    const q = Math.max(1, item.quantity || 1);
    for (let i = 0; i < q; i++) {
      allLabels.push(item.product);
    }
  });

  if (allLabels.length === 0) return;

  const pageSizeStyle = preset === '38x25'
    ? 'size: 38mm 25mm;'
    : preset === '50x25'
      ? 'size: 50mm 25mm;'
      : 'size: 100mm 25mm;';

  let labelsHtml = '';

  if (preset === '100x25_3up') {
    const rows: Product[][] = [];
    for (let i = 0; i < allLabels.length; i += 3) {
      rows.push(allLabels.slice(i, i + 3));
    }

    labelsHtml = rows.map(row => `
      <div class="page-row">
        ${row.map(prod => {
      const code = getSafeBarcode(prod);
      const barcodeImg = generateCrispBarcodeDataUrl(code, true);
      return `
            <div class="cell-3up">
              <div class="shop-title">MUTHUWADIGE HW</div>
              <div class="item-title">${prod.name || 'Product'}</div>
              <div class="barcode-container">
                <img src="${barcodeImg}" alt="barcode" class="barcode-img" />
              </div>
              <div class="code-text">${code}</div>
              <div class="price-tag">Rs. ${Number(prod.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            </div>
          `;
    }).join('')}
      </div>
    `).join('');
  } else {
    const is38 = preset === '38x25';
    labelsHtml = allLabels.map(prod => {
      const code = getSafeBarcode(prod);
      const barcodeImg = generateCrispBarcodeDataUrl(code, false);
      return `
        <div class="page-single ${is38 ? 'p-38' : 'p-50'}">
          <div class="shop-title">${is38 ? 'MUTHUWADIGE HW' : 'MUTHUWADIGE HARDWARE'}</div>
          <div class="item-title">${prod.name || 'Product'}</div>
          <div class="barcode-container">
            <img src="${barcodeImg}" alt="barcode" class="barcode-img" />
          </div>
          <div class="code-text">${code}</div>
          <div class="price-tag">Rs. ${Number(prod.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
        </div>
      `;
    }).join('');
  }

  const fullDocumentHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Barcode Print</title>
        <style>
          @page {
            ${pageSizeStyle}
            margin: 0 !important;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            font-family: Arial, Helvetica, sans-serif;
          }
          .page-row {
            width: 100mm;
            height: 25mm;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.5mm 1mm;
            page-break-after: always;
            break-after: page;
            overflow: hidden;
          }
          .cell-3up {
            width: 31.5mm;
            height: 24mm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
            text-align: center;
            overflow: hidden;
            border: 1px solid #000000;
            padding: 1mm 1.5mm;
          }
          .page-single {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
            text-align: center;
            overflow: hidden;
            page-break-after: always;
            break-after: page;
            padding: 1.5mm 1mm;
          }
          .p-38 {
            width: 38mm;
            height: 25mm;
          }
          .p-50 {
            width: 50mm;
            height: 25mm;
          }
          .shop-title {
            font-size: 7.5px;
            font-weight: 900;
            text-transform: uppercase;
            letter-spacing: -0.2px;
            width: 100%;
            border-bottom: 1px solid #000000;
            padding-bottom: 0.5px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1;
          }
          .item-title {
            font-size: 7.5px;
            font-weight: 700;
            width: 100%;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1;
            margin: 0.5px 0;
          }
          .barcode-container {
            display: flex;
            justify-content: center;
            align-items: center;
            width: 100%;
            padding: 0 1.5mm;
            overflow: hidden;
          }
          .barcode-img {
            display: block;
            image-rendering: pixelated;
            image-rendering: -moz-crisp-edges;
            image-rendering: crisp-edges;
            max-width: 100%;
            height: 9mm;
          }
          .code-text {
            font-family: monospace;
            font-size: 6.5px;
            font-weight: 800;
            line-height: 1;
            letter-spacing: 0.5px;
            margin: 0.5px 0;
          }
          .price-tag {
            font-size: 8.5px;
            font-weight: 900;
            width: 100%;
            border-top: 1px solid #000000;
            padding-top: 0.5px;
            line-height: 1;
          }
        </style>
      </head>
      <body>
        ${labelsHtml}
      </body>
    </html>
  `;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(fullDocumentHtml);
  doc.close();

  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error('Thermal print failed:', err);
      } finally {
        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 2000);
      }
    }, 250);
  };
};

export function BarcodePrint() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [preset, setPreset] = useState<PresetType>('50x25');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number>(0);
  const [isSinhala, setIsSinhala] = useState<boolean>(false);

  const t = (en: string, si: string) => (isSinhala ? si : en);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching products:', error.message);
      } else if (data) {
        const mapped: Product[] = data.map((item: any) => ({
          ...item,
          costPrice: item.costPrice ?? item.cost_price ?? 0,
          minStock: item.minStock ?? item.min_stock ?? 5,
          barcode: item.barcode || ''
        }));
        setProducts(mapped);
      }
    } catch (e) {
      console.error('Failed to load products for barcode print:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    const handleRefresh = () => {
      fetchProducts();
    };
    window.addEventListener('refresh-all-data', handleRefresh);
    window.addEventListener('refresh-inventory', handleRefresh);
    return () => {
      window.removeEventListener('refresh-all-data', handleRefresh);
      window.removeEventListener('refresh-inventory', handleRefresh);
    };
  }, []);

  const categories = useMemo(() => {
    const cats = new Set(products.map((p) => p.category).filter(Boolean));
    return ['All', ...Array.from(cats)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return products.filter((p) => {
      const matchesCat = selectedCategory === 'All' || p.category === selectedCategory;
      const safeCode = getSafeBarcode(p).toLowerCase();
      const matchesSearch =
        !q ||
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q)) ||
        safeCode.includes(q);
      return matchesCat && matchesSearch;
    });
  }, [products, searchQuery, selectedCategory]);

  const addToQueue = (product: Product) => {
    if (!product || !product.id) return;
    setQueue((prev) => {
      const existingIdx = prev.findIndex((item) => item.product.id === product.id);
      if (existingIdx >= 0) {
        setPreviewIndex(existingIdx);
        return prev.map((item, idx) =>
          idx === existingIdx ? { ...item, quantity: item.quantity + 10 } : item
        );
      }
      const newQueue = [...prev, { product, quantity: 10 }];
      setPreviewIndex(newQueue.length - 1);
      return newQueue;
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setQueue((prev) =>
      prev.map((item) => {
        if (item.product.id === productId) {
          const nextQty = Math.max(1, (item.quantity || 1) + delta);
          return { ...item, quantity: nextQty };
        }
        return item;
      })
    );
  };

  const setExactQuantity = (productId: string, qty: number) => {
    const safeQty = Math.max(1, isNaN(qty) ? 1 : qty);
    setQueue((prev) =>
      prev.map((item) => (item.product.id === productId ? { ...item, quantity: safeQty } : item))
    );
  };

  const removeFromQueue = (productId: string) => {
    setQueue((prev) => {
      const next = prev.filter((item) => item.product.id !== productId);
      if (previewIndex >= next.length) {
        setPreviewIndex(Math.max(0, next.length - 1));
      }
      return next;
    });
  };

  const clearQueue = () => {
    setQueue([]);
    setPreviewIndex(0);
  };

  const totalLabelsCount = useMemo(() => {
    return queue.reduce((sum, item) => sum + (item.quantity || 0), 0);
  }, [queue]);

  const previewItem = queue[previewIndex] || queue[0] || null;

  const handlePrint = () => {
    if (queue.length === 0) {
      alert(t('Please add items to the print queue first.', 'කරුණාකර මුලින්ම මුද්‍රණ ලැයිස්තුවට භාණ්ඩ එකතු කරන්න.'));
      return;
    }
    printThermalLabelsIsolated(queue, preset);
  };

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-6 text-[#464646]">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-amber-500/10 text-[#DAA520] rounded-xl flex items-center justify-center font-black">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-800 tracking-tight">
                {t('Barcode Label Printing', 'තීරු කේත ස්ටිකර් මුද්‍රණය')}
              </h1>
              <p className="text-xs text-gray-500 font-semibold">
                {t('Offline high-contrast thermal barcode sticker generator & queue manager', 'නොබැඳි තාපජ ස්ටිකර් මුද්‍රණ පද්ධතිය')}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsSinhala(!isSinhala)}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-wider transition-all"
          >
            {isSinhala ? 'English' : 'සිංහල'}
          </button>

          <button
            onClick={handlePrint}
            disabled={queue.length === 0}
            className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 shadow-lg transition-all ${queue.length > 0
              ? 'bg-[#DAA520] hover:bg-[#B8860B] text-white shadow-amber-500/20 active:scale-95 cursor-pointer'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
          >
            <Printer className="w-4 h-4" />
            {t(`Print ${totalLabelsCount} Labels`, `ලේබල් ${totalLabelsCount}ක් මුද්‍රණය කරන්න`)}
          </button>
        </div>
      </div>

      {/* Preset Selector */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-black text-slate-700 uppercase tracking-wider">
          <Layers className="w-4 h-4 text-[#DAA520]" />
          <span>{t('Sticker Size Preset:', 'ස්ටිකර් ප්‍රමාණ තේරීම:')}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full md:w-auto flex-1 max-w-3xl">
          <button
            onClick={() => setPreset('38x25')}
            className={`p-3 rounded-xl border text-left transition-all ${preset === '38x25'
              ? 'border-[#DAA520] bg-amber-50/50 ring-2 ring-[#DAA520]/20'
              : 'border-gray-200 hover:bg-gray-50'
              }`}
          >
            <div className="font-black text-xs text-slate-800">Compact Single Sticker</div>
            <div className="text-[10px] text-gray-500 font-bold mt-0.5">38mm × 25mm (Single Roll)</div>
          </button>

          <button
            onClick={() => setPreset('50x25')}
            className={`p-3 rounded-xl border text-left transition-all ${preset === '50x25'
              ? 'border-[#DAA520] bg-amber-50/50 ring-2 ring-[#DAA520]/20'
              : 'border-gray-200 hover:bg-gray-50'
              }`}
          >
            <div className="font-black text-xs text-slate-800">Standard Single Sticker</div>
            <div className="text-[10px] text-gray-500 font-bold mt-0.5">50mm × 25mm (Recommended)</div>
          </button>

          <button
            onClick={() => setPreset('100x25_3up')}
            className={`p-3 rounded-xl border text-left transition-all ${preset === '100x25_3up'
              ? 'border-[#DAA520] bg-amber-50/50 ring-2 ring-[#DAA520]/20'
              : 'border-gray-200 hover:bg-gray-50'
              }`}
          >
            <div className="font-black text-xs text-slate-800">4-Inch Multi-Sticker</div>
            <div className="text-[10px] text-gray-500 font-bold mt-0.5">3-Up on 100mm Roll</div>
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col h-[750px]">
          <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider mb-3 flex items-center justify-between">
            <span>{t('Inventory Catalog', 'භාණ්ඩ ගබඩාව')}</span>
            <span className="text-[10px] text-gray-400 font-bold">{filteredProducts.length} {t('Items Found', 'භාණ්ඩ')}</span>
          </h2>

          <div className="space-y-2 mb-4">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                placeholder={t('Search by Name, SKU, Category, Barcode...', 'නම, SKU, ප්‍රවර්ගය හෝ බාර්කෝඩ් මඟින් සොයන්න...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-xs font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]"
              />
            </div>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold text-[#464646] bg-white outline-none focus:ring-2 focus:ring-[#DAA520]"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'All' ? t('All Categories', 'සියලු ප්‍රවර්ග') : cat}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto pr-1 space-y-2">
            {loading ? (
              <div className="text-center py-12 text-gray-400 font-bold text-xs">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#DAA520]" />
                {t('Loading catalog items...', 'තොරතුරු ලබා ගනිමින්...')}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-12 text-gray-400 font-bold text-xs">
                {t('No products match your search.', 'කිසිදු භාණ්ඩයක් හමු නොවීය.')}
              </div>
            ) : (
              filteredProducts.map((p) => {
                const inQueue = queue.find((q) => q.product.id === p.id);
                const displayCode = getSafeBarcode(p);
                return (
                  <div
                    key={p.id}
                    className="p-3 border border-gray-100 rounded-xl hover:border-amber-300 hover:bg-amber-50/20 transition-all flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xs text-slate-800 truncate">{p.name}</div>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400 font-mono mt-0.5">
                        <span>SKU: {p.sku || 'N/A'}</span>
                        <span className="text-amber-600 font-bold">BC: {displayCode}</span>
                      </div>
                      <div className="text-xs font-black text-slate-700 mt-1">
                        Rs. {Number(p.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    <button
                      onClick={() => addToQueue(p)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-all shadow-sm ${inQueue
                        ? 'bg-amber-500 text-white hover:bg-amber-600'
                        : 'bg-slate-100 hover:bg-[#DAA520] hover:text-white text-slate-700'
                        }`}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {inQueue ? `+10 (${inQueue.quantity})` : t('Add', 'එක් කරන්න')}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="lg:col-span-7 space-y-6">
          <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-col max-h-[420px]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-black text-slate-800 uppercase tracking-wider">
                  {t('Print Queue Table', 'මුද්‍රණ පෝලිම')}
                </h2>
                <p className="text-[10px] text-gray-400 font-bold">
                  {queue.length} {t('unique items queued', 'තෝරාගත් භාණ්ඩ')} • Total {totalLabelsCount} {t('labels', 'ස්ටිකර්')}
                </p>
              </div>

              {queue.length > 0 && (
                <button
                  onClick={clearQueue}
                  className="text-xs font-bold text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('Clear Queue', 'සියල්ල ඉවත් කරන්න')}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-2">
              {queue.length === 0 ? (
                <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
                  <Tag className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <div className="text-xs font-bold text-gray-400">
                    {t('No items in print queue.', 'මුද්‍රණ පෝලිමේ කිසිවක් නොමැත.')}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">
                    {t('Select products from the catalog on the left to add labels.', 'වම්පස ලැයිස්තුවෙන් භාණ්ඩ එකතු කරන්න.')}
                  </div>
                </div>
              ) : (
                queue.map((item, index) => {
                  const code = getSafeBarcode(item.product);
                  return (
                    <div
                      key={item.product.id}
                      onClick={() => setPreviewIndex(index)}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-4 cursor-pointer ${previewIndex === index
                        ? 'border-[#DAA520] bg-amber-50/40 shadow-sm'
                        : 'border-gray-200 hover:bg-gray-50'
                        }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-xs text-slate-800 truncate">
                          {item.product.name}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-gray-500 font-mono mt-0.5">
                          <span>Barcode: {code}</span>
                          <span className="font-bold text-slate-700">
                            Rs. {Number(item.product.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => updateQuantity(item.product.id, -1)}
                          className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center font-black transition-colors"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>

                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => setExactQuantity(item.product.id, parseInt(e.target.value))}
                          className="w-12 py-1 text-center font-black text-xs border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-[#DAA520]"
                        />

                        <button
                          onClick={() => updateQuantity(item.product.id, 1)}
                          className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center font-black transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => updateQuantity(item.product.id, 10)}
                          className="px-2 py-1 bg-amber-100 hover:bg-amber-200 text-[#DAA520] font-black text-[10px] rounded-lg transition-colors"
                        >
                          +10
                        </button>

                        <button
                          onClick={() => removeFromQueue(item.product.id)}
                          className="w-7 h-7 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 flex items-center justify-center transition-colors ml-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Maximize2 className="w-4 h-4 text-[#DAA520]" />
                {t('Live Thermal Sticker Visual Preview', 'සජීවී ස්ටිකර් පූර්ව දර්ශනය')}
              </h3>
              <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full uppercase">
                Preset: {preset}
              </span>
            </div>

            {previewItem ? (
              <div className="bg-gray-100/70 p-6 rounded-2xl border border-gray-200 flex justify-center items-center overflow-x-auto min-h-[220px]">
                <StickerPreviewCard
                  product={previewItem.product}
                  preset={preset}
                />
              </div>
            ) : (
              <div className="bg-gray-50 p-8 rounded-2xl border border-dashed border-gray-200 text-center text-gray-400 font-bold text-xs">
                {t('Add items to queue to view thermal label preview.', 'පූර්ව දර්ශනය සඳහා භාණ්ඩයක් පෝලිමට එක් කරන්න.')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}