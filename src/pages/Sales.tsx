import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
  SearchIcon,
  PlusIcon,
  Trash2Icon,
  ShoppingCartIcon,
  ReceiptIcon,
  XIcon,
  DownloadIcon,
  Loader2Icon,
  CheckCircleIcon,
  UserIcon,
  PrinterIcon,
  PauseIcon,
  DollarSignIcon,
  AlertTriangleIcon,
  TrendingUpIcon,
  CheckSquareIcon,
  ArrowRightIcon,
  HistoryIcon
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { notify } from '../components/Notifications';
import { supabase } from '../lib/supabaseClient';
import { useCurrency } from '../context/CurrencyContext';
import { api, API_URL, fetchWithTimeout } from '../lib/api'; 
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { SaleOrder, SaleItem, Customer, Product, Quotation, DeliveryNote, SalesReturn, CreditNote, CreditNoteUsage } from '../types';
import { formatStock } from '../utils/formatters';
import { sinhalaFontBase64 } from '../utils/sinhalaFontBase64';
import {
  generateQuotePrintHTML,
  generateDNPrintHTML,
  generatePrintHTML,
  generateReturnPrintHTML as generateReturnPrintHTML_Outer,
  generateCreditNotePrintHTML as generateCreditNotePrintHTML_Outer,
  formatInvoiceDateTime
} from '../utils/sales/printTemplates';

const safeParseJson = (data: any, fallback: any = []) => {
  if (data === null || data === undefined) return fallback;
  if (typeof data === 'object') return data;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch (e) {
      return fallback;
    }
  }
  return fallback;
};
import html2canvas from 'html2canvas';

type Tab = 'new' | 'history' | 'credit' | 'credit_history' | 'quotes' | 'returns';

const statusColors: Record<string, string> = {
  paid: 'bg-emerald-100 text-emerald-700',
  Paid: 'bg-emerald-100 text-emerald-700',
  'Non Paid': 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-100 text-gray-500',
  Cancelled: 'bg-gray-100 text-gray-500'
};

function ReceiptPreview({ order, isSinhala, customers = [], salesReturns = [] }: { order: SaleOrder; isSinhala: boolean; customers?: Customer[]; salesReturns?: SalesReturn[] }) {
  const symbol = isSinhala ? 'රු.' : 'Rs.';
  const formatNum = (num: number) => (num || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const matchedCust = customers.find(c => 
    (order.customer_id && c.id === order.customer_id) || 
    (order.customerName && c.name && c.name.toLowerCase() === order.customerName.toLowerCase()) ||
    (order.customer_name && c.name && c.name.toLowerCase() === order.customer_name.toLowerCase())
  );

  const validOrderCustName = (order.customerName && order.customerName.trim() && order.customerName !== 'Guest Customer' && order.customerName !== 'Guest')
    ? order.customerName.trim()
    : ((order.customer_name && order.customer_name.trim() && order.customer_name !== 'Guest Customer' && order.customer_name !== 'Guest')
        ? order.customer_name.trim()
        : null);

  const customerName = validOrderCustName || matchedCust?.name || (isSinhala ? 'පාරිභෝගිකයා (Guest)' : 'Guest Customer');
  const custPhone = order.customerPhone || order.customer_phone || matchedCust?.phone || '';
  const custAddress = order.customerAddress || order.customer_address || matchedCust?.address || '';

  const activeOrderReturns = (salesReturns || []).filter(sr => sr.status !== 'voided' && (sr.invoiceNo === order.invoiceNo || sr.invoice_no === order.invoiceNo));

  return (
    <div id="receipt-preview" className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-inner text-left max-w-2xl mx-auto my-4 font-sans leading-relaxed">
      {/* Dark Header Banner */}
      <div className="bg-[#464646] p-6 text-white relative flex justify-between items-center h-[110px] overflow-visible">
        <div>
          <h1 className="text-lg font-black tracking-wide m-0 leading-tight">MUTHUWADIGE HARDWARE</h1>
          <p className="text-[10px] opacity-90 m-0 mt-1 font-semibold">No: 80, Mahahunupitiya, Negombo</p>
          <p className="text-[10px] opacity-90 m-0 mt-0.5 font-semibold">Contact: 077 076 076 7</p>
        </div>
        {/* Wider Black Protruding Logo Container */}
        <div className="absolute right-8 top-0 bg-black border border-gray-900 border-t-0 rounded-b-lg w-[170px] h-[138px] flex items-center justify-center shadow-md z-10 p-0 overflow-hidden">
          <img src="./images/logo.png" alt="Logo" className="w-full h-full object-contain scale-115 transition-transform" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
      </div>
      
      {/* Title */}
      <div className="mt-8 text-center flex flex-col items-center justify-center">
        {(order.payment_method === 'Credit' || order.status === 'Non Paid') ? (
          <div className="bg-slate-900 border-2 border-amber-500 px-8 py-2.5 rounded-2xl shadow-lg shadow-slate-900/15 inline-block">
            <h2 className="text-amber-400 text-lg font-black tracking-widest uppercase m-0">
              {isSinhala ? 'ණය ඉන්වොයිසිය / CREDIT' : 'CREDIT'}
            </h2>
          </div>
        ) : (
          <h2 className="text-[#595959] text-base font-black tracking-widest uppercase m-0">
            {isSinhala ? 'ඉන්වොයිසිය' : 'INVOICE'}
          </h2>
        )}
      </div>
      
      {/* Meta details */}
      <div className="mx-6 my-4 flex justify-between items-start text-xs gap-4">
        <div>
          <h3 className="text-[#595959] text-[9px] font-black uppercase tracking-wider mb-1">{isSinhala ? 'පාරිභෝගිකයා:' : 'BILL TO:'}</h3>
          <p className="text-[#2c2c2c] font-black text-sm">{customerName}</p>
          {custPhone && (
            <p className="text-gray-500 font-bold text-xs mt-0.5">Tel: {custPhone}</p>
          )}
          {custAddress && (
            <p className="text-gray-500 font-bold text-xs mt-0.5">Address: {custAddress}</p>
          )}
        </div>
        <div className="text-right text-gray-500 font-semibold space-y-1">
          <p><span className="text-[#595959] font-black uppercase tracking-wider text-[9px] mr-2">{isSinhala ? 'ඉන්වොයිස් අංකය:' : 'Invoice No:'}</span> {order.invoiceNo}</p>
          <p><span className="text-[#595959] font-black uppercase tracking-wider text-[9px] mr-2">{isSinhala ? 'නිකුත් කළ දිනය:' : 'Issue Date:'}</span> {formatInvoiceDateTime(order.created_at, order.date)}</p>
        </div>
      </div>
      
      {/* Table with precise geometry */}
      <div className="mx-6 my-4 overflow-hidden border border-gray-100 rounded-lg">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[#d29d2b] text-white font-black uppercase text-[10px] tracking-wider">
              <th className="py-2.5 px-3 text-left w-[50%]">{isSinhala ? 'විස්තරය' : 'Description'}</th>
              <th className="py-2.5 px-3 text-center w-[10%]">{isSinhala ? 'ප්‍රමාණය' : 'Qty'}</th>
              <th className="py-2.5 px-3 text-right w-[20%]">{isSinhala ? 'ඒකක මිල' : 'Unit Price'}</th>
              <th className="py-2.5 px-3 text-right w-[20%]">{isSinhala ? 'එකතුව' : 'Total'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(Array.isArray(order.items) ? order.items : (typeof order.items === 'string' ? (() => { try { return JSON.parse(order.items); } catch(e) { return []; } })() : [])).map((item: any, idx: number) => (
              <tr key={idx} className="hover:bg-gray-50/50">
                <td className="py-2.5 px-3 font-bold text-[#464646]">{item.productName}</td>
                <td className="py-2.5 px-3 text-center text-gray-500 font-semibold">{item.qty} {item.unit || ''}</td>
                <td className="py-2.5 px-3 text-right text-gray-500 font-semibold">{symbol} {formatNum(item.price)}</td>
                <td className="py-2.5 px-3 text-right font-bold text-[#464646]">{symbol} {formatNum(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Associated Sales Returns & Exchange Activity Card */}
      {activeOrderReturns.length > 0 && (
        <div className="mx-6 my-4 bg-amber-50/50 border border-amber-200 rounded-xl p-4 space-y-3">
          <h4 className="text-xs font-black text-amber-900 uppercase tracking-widest flex items-center gap-1.5 border-b border-amber-200/60 pb-2">
            <span>⇄</span> {isSinhala ? 'මෙම ඉන්වොයිසියට අදාළ ආපසු භාරගැනීම් / හුවමාරු:' : 'Return & Exchange Activity for this Invoice:'}
          </h4>

          {activeOrderReturns.map((retRecord, rIdx) => {
            const retItems = Array.isArray(retRecord.returnedItems) ? retRecord.returnedItems : safeParseJson(retRecord.returnedItems, []);
            const exItems = Array.isArray(retRecord.exchangeItems) ? retRecord.exchangeItems : safeParseJson(retRecord.exchangeItems, []);

            return (
              <div key={rIdx} className="bg-white rounded-lg border border-amber-200 p-3 space-y-2 text-xs">
                <div className="flex justify-between items-center font-bold text-slate-800 border-b border-slate-100 pb-1.5">
                  <div>
                    <span className="font-mono text-amber-600">{retRecord.returnNo || retRecord.return_no || retRecord.id}</span>
                    <span className="ml-2 px-2 py-0.5 bg-slate-100 rounded text-[10px] uppercase font-black">{retRecord.returnMethod}</span>
                  </div>
                  <span className="text-gray-400 text-[10px]">{formatInvoiceDateTime(retRecord.created_at)}</span>
                </div>

                {/* Returned Sub-Items */}
                {retItems.length > 0 && (
                  <div>
                    <span className="text-[10px] font-black text-rose-700 uppercase block mb-1">↩ {isSinhala ? 'ආපසු භාරගත් භාණ්ඩ:' : 'Returned Sub-Items:'}</span>
                    <ul className="space-y-1 pl-2 border-l-2 border-rose-400">
                      {retItems.map((ri: any, iIdx: number) => (
                        <li key={iIdx} className="flex justify-between font-medium text-slate-700 text-[11px]">
                          <span>{ri.productName} (x{ri.qty} {ri.unit || ''})</span>
                          <span className="font-bold text-rose-600">{symbol} {formatNum(ri.qty * ri.price)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Exchange Replacement Sub-Items */}
                {exItems.length > 0 && (
                  <div className="pt-1">
                    <span className="text-[10px] font-black text-emerald-700 uppercase block mb-1">⇄ {isSinhala ? 'හුවමාරු ලබාදුන් නව භාණ්ඩ:' : 'Exchange Replacement Sub-Items:'}</span>
                    <ul className="space-y-1 pl-2 border-l-2 border-emerald-400">
                      {exItems.map((ei: any, eIdx: number) => (
                        <li key={eIdx} className="flex justify-between font-medium text-slate-700 text-[11px]">
                          <span>{ei.productName} (x{ei.qty} {ei.unit || ''})</span>
                          <span className="font-bold text-emerald-600">{symbol} {formatNum(ei.qty * ei.price)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      
      {/* Bottom section matching paper output exactly */}
      <div className="mx-6 mt-12 mb-4 flex justify-between items-start flex-wrap gap-4 text-xs">
        {/* Notes on bottom left */}
        <div className="w-[45%]">
          <h3 className="text-[#d29d2b] text-[9px] font-black uppercase tracking-wider mb-1">{isSinhala ? 'සටහන්' : 'NOTES'}</h3>
          <p className="text-gray-400 font-semibold mb-1 text-[10px]">{isSinhala ? 'කිසියම් ප්‍රශ්නයක් ඇත්නම් කරුණාකර අප හා සම්බන්ධ වන්න.' : 'Please feel free to contact us in case of any questions.'}</p>
          <p className="text-[#4b5563] font-bold text-[10px]">{isSinhala ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි!' : 'Thank you for your business!'}</p>
        </div>
        
        {/* Totals with exact light grey styling & right margin safety */}
        <div className="w-[48%] space-y-2 text-right pr-3">
          <div className="flex justify-between font-semibold text-gray-500">
            <span>{isSinhala ? 'උප එකතුව:' : 'Sub Total:'}</span>
            <span className="font-bold text-[#4b5563]">{symbol} {formatNum(order.subtotal || 0)}</span>
          </div>
          {Number(order.discount || 0) > 0 && (
            <div className="flex justify-between font-semibold text-gray-500">
              <span>{isSinhala ? 'වට්ටම:' : 'Discount:'}</span>
              <span className="font-bold text-red-600">-{symbol} {formatNum(order.discount || 0)}</span>
            </div>
          )}
          {Number(order.transportation_fee || order.transportationFee || 0) > 0 && (
            <div className="flex justify-between font-semibold text-gray-500">
              <span>{isSinhala ? 'ප්‍රවාහන ගාස්තුව:' : 'Transportation Fee:'}</span>
              <span className="font-bold text-[#4b5563]">+{symbol} {formatNum(order.transportation_fee || order.transportationFee || 0)}</span>
            </div>
          )}
          {Number(order.tax || 0) > 0 && (
            <div className="flex justify-between font-semibold text-gray-500">
              <span>{isSinhala ? `බද්ද (${order.tax_rate || 0}%):` : `Tax (${order.tax_rate || 0}%):`}</span>
              <span className="font-bold text-[#4b5563]">+{symbol} {formatNum(order.tax || 0)}</span>
            </div>
          )}
          {Number(order.credit_note_applied || order.creditNoteApplied || 0) > 0 && (
            <div className="flex justify-between font-semibold text-emerald-600">
              <span>{isSinhala ? 'ණය සටහන:' : 'Credit Note Applied:'}</span>
              <span className="font-bold text-emerald-600">-{symbol} {formatNum(order.credit_note_applied || order.creditNoteApplied || 0)}</span>
            </div>
          )}
          <div className="flex justify-between items-center py-2.5 px-3 bg-[#f3f4f6] rounded-lg text-sm font-black text-[#464646] mt-2 border border-gray-100">
            <span>{isSinhala ? 'ගෙවිය යුතු මුළු මුදල:' : 'Total Amount:'}</span>
            <span className="text-base font-black">{symbol} {formatNum(order.total_amount !== undefined ? order.total_amount : order.total)}</span>
          </div>
          {(() => {
            const method = (order.payment_method || (order as any).paymentMethod || '').toString().toLowerCase().trim();
            const status = (order.status || '').toString().toLowerCase().trim();
            const isCredit = method === 'credit' || method === 'credit sale' || (order as any).is_credit === true || status === 'non paid' || status === 'non-paid' || status === 'partially paid' || status === 'partially settled' || status === 'fully settled';
            
            if (!isCredit) return null;

            const totalAmt = Number(order.total_amount !== undefined ? order.total_amount : order.total);
            const paidAmt = Number(order.payment_received || 0);
            const remBal = Math.max(0, totalAmt - paidAmt);
            const isSettled = remBal <= 0.01;
            return (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-1.5 mt-2 text-xs text-left">
                <div className="flex justify-between font-bold text-emerald-700">
                  <span>{isSinhala ? 'දැනට ගෙවා ඇති මුදල:' : 'Amount Paid So Far:'}</span>
                  <span className="font-black">{symbol} {formatNum(paidAmt)}</span>
                </div>
                <div className="flex justify-between font-bold text-rose-700">
                  <span>{isSinhala ? 'ගෙවීමට ඇති ඉතිරි ශේෂය:' : 'Remaining Balance Owed:'}</span>
                  <span className="font-black">{symbol} {formatNum(remBal)}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase pt-1 border-t border-slate-200">
                  <span className="text-slate-500">{isSinhala ? 'ණය ගෙවීමේ තත්ත්වය:' : 'Payment Status:'}</span>
                  <span className={`px-2 py-0.5 rounded ${isSettled ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {isSettled ? (isSinhala ? 'සම්පූර්ණයෙන්ම පියවා ඇත' : 'Fully Settled') : (isSinhala ? 'කොටසක් පියවා ඇත' : 'Partially Settled')}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
      
      {/* Signature */}
      <div className="mx-6 mt-16 mb-6 text-right">
        <div className="inline-block border-t border-gray-300 pt-1.5 w-40 text-center text-[10px] italic text-gray-400 font-semibold">
          {isSinhala ? 'බලයලත් අත්සන' : 'Authorized Signee'}
        </div>
      </div>
    </div>
  );
}

// Return Receipt Preview Component
function ReturnReceiptPreview({ returnRecord, isSinhala }: { returnRecord: SalesReturn; isSinhala: boolean }) {
  const symbol = isSinhala ? 'රු.' : 'Rs.';
  const formatNum = (num: number) => (num || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const returnedItemsList = Array.isArray(returnRecord.returnedItems)
    ? returnRecord.returnedItems
    : safeParseJson(returnRecord.returnedItems, []);

  const exchangeItemsList = Array.isArray(returnRecord.exchangeItems)
    ? returnRecord.exchangeItems
    : safeParseJson(returnRecord.exchangeItems, []);

  const title = returnRecord.returnMethod === 'Exchange'
    ? (isSinhala ? 'භාණ්ඩ හුවමාරු රසීදුව' : 'EXCHANGE RECEIPT')
    : returnRecord.returnMethod === 'Credit Note'
      ? (isSinhala ? 'ණය සටහන් රසීදුව' : 'CREDIT NOTE RECEIPT')
      : (isSinhala ? 'ආපසු භාරගැනීමේ රසීදුව' : 'RETURN RECEIPT');

  return (
    <div id="return-receipt-preview" className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-inner text-left max-w-2xl mx-auto my-4 font-sans leading-relaxed">
      {/* Header Banner */}
      <div className="bg-[#464646] p-6 text-white relative flex justify-between items-center h-[110px] overflow-visible">
        <div>
          <h1 className="text-lg font-black tracking-wide m-0 leading-tight">MUTHUWADIGE HARDWARE</h1>
          <p className="text-[10px] opacity-90 m-0 mt-1 font-semibold">No: 80, Mahahunupitiya, Negombo</p>
          <p className="text-[10px] opacity-90 m-0 mt-0.5 font-semibold">Contact: 077 076 076 7</p>
        </div>
        <div className="absolute right-8 top-0 bg-black border border-gray-900 border-t-0 rounded-b-lg w-[170px] h-[138px] flex items-center justify-center shadow-md z-10 p-0 overflow-hidden">
          <img src="./images/logo.png" alt="Logo" className="w-full h-full object-contain scale-115 transition-transform" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
      </div>

      {/* Title */}
      <div className="mt-8 text-center flex flex-col items-center justify-center">
        <div className="bg-amber-500 border-2 border-amber-600 px-6 py-2 rounded-2xl shadow-md inline-block">
          <h2 className="text-slate-950 text-base font-black tracking-widest uppercase m-0">
            {title}
          </h2>
        </div>
      </div>

      {/* Meta details */}
      <div className="mx-6 my-4 flex justify-between items-start text-xs gap-4 border-b border-gray-100 pb-3">
        <div>
          <h3 className="text-[#595959] text-[9px] font-black uppercase tracking-wider mb-1">{isSinhala ? 'පාරිභෝගිකයා:' : 'CUSTOMER:'}</h3>
          <p className="text-[#2c2c2c] font-black text-sm">{returnRecord.customerName || returnRecord.customer_name || (isSinhala ? 'පාරිභෝගිකයා' : 'Guest Customer')}</p>
          {(returnRecord.customerPhone || returnRecord.customer_phone) && (
            <p className="text-gray-500 font-bold text-xs mt-0.5">Tel: {returnRecord.customerPhone || returnRecord.customer_phone}</p>
          )}
        </div>
        <div className="text-right text-gray-500 font-semibold space-y-1">
          <p><span className="text-[#595959] font-black uppercase tracking-wider text-[9px] mr-2">{isSinhala ? 'ආපසු අංකය:' : 'Return No:'}</span> <span className="font-mono text-slate-800 font-bold">{returnRecord.returnNo || returnRecord.return_no || returnRecord.id}</span></p>
          <p><span className="text-[#595959] font-black uppercase tracking-wider text-[9px] mr-2">{isSinhala ? 'මුල් ඉන්වොයිසිය:' : 'Original Inv:'}</span> <span className="font-mono text-amber-600 font-bold">{returnRecord.invoiceNo || returnRecord.invoice_no}</span></p>
          <p><span className="text-[#595959] font-black uppercase tracking-wider text-[9px] mr-2">{isSinhala ? 'දිනය:' : 'Date:'}</span> {formatInvoiceDateTime(returnRecord.created_at)}</p>
        </div>
      </div>

      {/* Returned Items Table */}
      <div className="mx-6 my-3">
        <h4 className="text-xs font-black text-rose-700 uppercase tracking-wider mb-2 flex items-center gap-1">
          <span>↩</span> {isSinhala ? 'ආපසු භාරගත් භාණ්ඩ' : 'Returned Products'}
        </h4>
        <div className="overflow-hidden border border-rose-100 rounded-lg">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-rose-50 text-rose-800 font-black uppercase text-[10px] tracking-wider">
                <th className="py-2 px-3 text-left">{isSinhala ? 'විස්තරය' : 'Description'}</th>
                <th className="py-2 px-3 text-center">{isSinhala ? 'ප්‍රමාණය' : 'Qty'}</th>
                <th className="py-2 px-3 text-right">{isSinhala ? 'ඒකක මිල' : 'Unit Price'}</th>
                <th className="py-2 px-3 text-right">{isSinhala ? 'එකතුව' : 'Total'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rose-50">
              {returnedItemsList.map((item: any, idx: number) => (
                <tr key={idx} className="hover:bg-rose-50/30">
                  <td className="py-2 px-3 font-bold text-slate-800">{item.productName}</td>
                  <td className="py-2 px-3 text-center text-slate-600 font-semibold">{item.qty} {item.unit || ''}</td>
                  <td className="py-2 px-3 text-right text-slate-600 font-semibold">{symbol} {formatNum(item.price)}</td>
                  <td className="py-2 px-3 text-right font-bold text-rose-700">{symbol} {formatNum(item.qty * item.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Exchange Items Table (if any) */}
      {exchangeItemsList.length > 0 && (
        <div className="mx-6 my-3">
          <h4 className="text-xs font-black text-emerald-700 uppercase tracking-wider mb-2 flex items-center gap-1">
            <span>⇄</span> {isSinhala ? 'හුවමාරු ලැබුණු භාණ්ඩ' : 'Exchange Replacement Products'}
          </h4>
          <div className="overflow-hidden border border-emerald-100 rounded-lg">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-emerald-50 text-emerald-800 font-black uppercase text-[10px] tracking-wider">
                  <th className="py-2 px-3 text-left">{isSinhala ? 'විස්තරය' : 'Description'}</th>
                  <th className="py-2 px-3 text-center">{isSinhala ? 'ප්‍රමාණය' : 'Qty'}</th>
                  <th className="py-2 px-3 text-right">{isSinhala ? 'ඒකක මිල' : 'Unit Price'}</th>
                  <th className="py-2 px-3 text-right">{isSinhala ? 'එකතුව' : 'Total'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-emerald-50">
                {exchangeItemsList.map((item: any, idx: number) => (
                  <tr key={idx} className="hover:bg-emerald-50/30">
                    <td className="py-2 px-3 font-bold text-slate-800">{item.productName}</td>
                    <td className="py-2 px-3 text-center text-slate-600 font-semibold">{item.qty} {item.unit || ''}</td>
                    <td className="py-2 px-3 text-right text-slate-600 font-semibold">{symbol} {formatNum(item.price)}</td>
                    <td className="py-2 px-3 text-right font-bold text-emerald-700">{symbol} {formatNum(item.qty * item.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Financial Summary */}
      <div className="mx-6 mt-4 mb-4 flex justify-between items-start flex-wrap gap-4 text-xs">
        <div className="w-[45%]">
          <h3 className="text-[#d29d2b] text-[9px] font-black uppercase tracking-wider mb-1">{isSinhala ? 'ආපසු ගෙවීමේ ක්‍රමය' : 'RETURN METHOD'}</h3>
          <p className="text-slate-800 font-black text-xs">{returnRecord.returnMethod}</p>
          {returnRecord.creditNoteNo && (
            <p className="text-amber-600 font-bold text-xs mt-1">Credit Note: {returnRecord.creditNoteNo}</p>
          )}
          {returnRecord.reason && (
            <p className="text-gray-500 font-semibold text-[10px] mt-1">{isSinhala ? 'හේතුව:' : 'Reason:'} {returnRecord.reason}</p>
          )}
        </div>

        <div className="w-[45%] space-y-1.5 text-right">
          <div className="flex justify-between font-semibold text-gray-500">
            <span>{isSinhala ? 'ආපසු භාරගත් අගය:' : 'Return Total:'}</span>
            <span className="font-bold text-rose-600">{symbol} {formatNum(returnRecord.returnAmount || returnRecord.totalRefunded || 0)}</span>
          </div>
          {returnRecord.exchangeAmount ? (
            <div className="flex justify-between font-semibold text-gray-500">
              <span>{isSinhala ? 'හුවමාරු භාණ්ඩ අගය:' : 'Exchange Total:'}</span>
              <span className="font-bold text-emerald-600">{symbol} {formatNum(returnRecord.exchangeAmount)}</span>
            </div>
          ) : null}
          {returnRecord.customerPaid ? (
            <div className="flex justify-between font-semibold text-gray-500">
              <span>{isSinhala ? 'පාරිභෝගිකයා ගෙවූ මුදල:' : 'Customer Paid:'}</span>
              <span className="font-bold text-slate-800">+{symbol} {formatNum(returnRecord.customerPaid)}</span>
            </div>
          ) : null}
          {returnRecord.changeGiven ? (
            <div className="flex justify-between font-semibold text-gray-500">
              <span>{isSinhala ? 'ඉතිරි මුදල:' : 'Change Given:'}</span>
              <span className="font-bold text-slate-800">-{symbol} {formatNum(returnRecord.changeGiven)}</span>
            </div>
          ) : null}
          <div className="flex justify-between items-center py-2 px-3 bg-slate-100 rounded-lg text-xs font-black text-slate-800 mt-2 border border-slate-200">
            <span>{isSinhala ? 'මුළු ආපසු/ගෙවූ මුදල:' : 'Net Refund/Paid:'}</span>
            <span className="text-sm font-black text-emerald-700">{symbol} {formatNum(returnRecord.totalRefunded || returnRecord.returnAmount || 0)}</span>
          </div>
        </div>
      </div>

      {/* Signature */}
      <div className="mx-6 mt-10 mb-6 text-right">
        <div className="inline-block border-t border-gray-300 pt-1.5 w-40 text-center text-[10px] italic text-gray-400 font-semibold">
          {isSinhala ? 'බලයලත් අත්සන' : 'Authorized Signee'}
        </div>
      </div>
    </div>
  );
}

// Credit Note Receipt Preview Component
function CreditNoteReceiptPreview({ creditNoteRecord, isSinhala }: { creditNoteRecord: CreditNote; isSinhala: boolean }) {
  const symbol = isSinhala ? 'රු.' : 'Rs.';
  const formatNum = (num: number) => (num || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const itemsList = Array.isArray(creditNoteRecord.items)
    ? creditNoteRecord.items
    : safeParseJson(creditNoteRecord.items, []);

  return (
    <div id="credit-note-preview" className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-inner text-left max-w-2xl mx-auto my-4 font-sans leading-relaxed">
      {/* Header Banner */}
      <div className="bg-[#464646] p-6 text-white relative flex justify-between items-center h-[110px] overflow-visible">
        <div>
          <h1 className="text-lg font-black tracking-wide m-0 leading-tight">MUTHUWADIGE HARDWARE</h1>
          <p className="text-[10px] opacity-90 m-0 mt-1 font-semibold">No: 80, Mahahunupitiya, Negombo</p>
          <p className="text-[10px] opacity-90 m-0 mt-0.5 font-semibold">Contact: 077 076 076 7</p>
        </div>
        <div className="absolute right-8 top-0 bg-black border border-gray-900 border-t-0 rounded-b-lg w-[170px] h-[138px] flex items-center justify-center shadow-md z-10 p-0 overflow-hidden">
          <img src="./images/logo.png" alt="Logo" className="w-full h-full object-contain scale-115 transition-transform" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </div>
      </div>

      {/* Title */}
      <div className="mt-8 text-center flex flex-col items-center justify-center">
        <div className="bg-slate-900 border-2 border-amber-500 px-8 py-2 rounded-2xl shadow-md inline-block">
          <h2 className="text-amber-400 text-base font-black tracking-widest uppercase m-0">
            {isSinhala ? 'ණය සටහන / CREDIT NOTE' : 'CREDIT NOTE'}
          </h2>
        </div>
      </div>

      {/* Meta details */}
      <div className="mx-6 my-4 flex justify-between items-start text-xs gap-4 border-b border-gray-100 pb-3">
        <div>
          <h3 className="text-[#595959] text-[9px] font-black uppercase tracking-wider mb-1">{isSinhala ? 'පාරිභෝගිකයා:' : 'CUSTOMER:'}</h3>
          <p className="text-[#2c2c2c] font-black text-sm">{creditNoteRecord.customerName || creditNoteRecord.customer_name || (isSinhala ? 'පාරිභෝගිකයා' : 'Guest Customer')}</p>
          {(creditNoteRecord.customerPhone || creditNoteRecord.customer_phone) && (
            <p className="text-gray-500 font-bold text-xs mt-0.5">Tel: {creditNoteRecord.customerPhone || creditNoteRecord.customer_phone}</p>
          )}
        </div>
        <div className="text-right text-gray-500 font-semibold space-y-1">
          <p><span className="text-[#595959] font-black uppercase tracking-wider text-[9px] mr-2">{isSinhala ? 'ණය සටහන් අංකය:' : 'Credit Note No:'}</span> <span className="font-mono text-amber-600 font-black">{creditNoteRecord.creditNoteNo || creditNoteRecord.credit_note_no || creditNoteRecord.id}</span></p>
          {creditNoteRecord.invoiceNo && (
            <p><span className="text-[#595959] font-black uppercase tracking-wider text-[9px] mr-2">{isSinhala ? 'ඉන්වොයිසිය:' : 'Ref Invoice:'}</span> <span className="font-mono text-slate-700 font-bold">{creditNoteRecord.invoiceNo || creditNoteRecord.invoice_no}</span></p>
          )}
          <p><span className="text-[#595959] font-black uppercase tracking-wider text-[9px] mr-2">{isSinhala ? 'දිනය:' : 'Date:'}</span> {formatInvoiceDateTime(creditNoteRecord.created_at)}</p>
          <p><span className="text-[#595959] font-black uppercase tracking-wider text-[9px] mr-2">{isSinhala ? 'තත්ත්වය:' : 'Status:'}</span> <span className="font-bold text-emerald-600 uppercase">{creditNoteRecord.status}</span></p>
        </div>
      </div>

      {/* Items Table */}
      {itemsList.length > 0 && (
        <div className="mx-6 my-3">
          <div className="overflow-hidden border border-gray-200 rounded-lg">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-amber-500 text-slate-950 font-black uppercase text-[10px] tracking-wider">
                  <th className="py-2 px-3 text-left">{isSinhala ? 'විස්තරය' : 'Description'}</th>
                  <th className="py-2 px-3 text-center">{isSinhala ? 'ප්‍රමාණය' : 'Qty'}</th>
                  <th className="py-2 px-3 text-right">{isSinhala ? 'ඒකක මිල' : 'Unit Price'}</th>
                  <th className="py-2 px-3 text-right">{isSinhala ? 'එකතුව' : 'Total'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {itemsList.map((item: any, idx: number) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="py-2 px-3 font-bold text-slate-800">{item.productName}</td>
                    <td className="py-2 px-3 text-center text-slate-600 font-semibold">{item.qty} {item.unit || ''}</td>
                    <td className="py-2 px-3 text-right text-slate-600 font-semibold">{symbol} {formatNum(item.price)}</td>
                    <td className="py-2 px-3 text-right font-bold text-slate-800">{symbol} {formatNum(item.qty * item.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Total Amount */}
      <div className="mx-6 mt-4 mb-4 flex justify-between items-start flex-wrap gap-4 text-xs">
        <div className="w-[45%]">
          <h3 className="text-[#d29d2b] text-[9px] font-black uppercase tracking-wider mb-1">{isSinhala ? 'විස්තර' : 'NOTES'}</h3>
          <p className="text-gray-400 font-semibold text-[10px]">{isSinhala ? 'මෙම ණය සටහන ඉදිරි මිලදී ගැනීම් සඳහා භාවිතා කළ හැක.' : 'This credit note can be redeemed against future purchases.'}</p>
        </div>
        <div className="w-[45%] space-y-1.5 text-right">
          <div className="flex justify-between items-center py-2 px-3 bg-amber-50 rounded-lg text-xs font-black text-slate-800 border border-amber-200">
            <span>{isSinhala ? 'මුළු ණය මුදල:' : 'Total Credit Value:'}</span>
            <span className="text-base font-black text-amber-700">{symbol} {formatNum(creditNoteRecord.amount || creditNoteRecord.value || 0)}</span>
          </div>
        </div>
      </div>

      {/* Signature */}
      <div className="mx-6 mt-10 mb-6 text-right">
        <div className="inline-block border-t border-gray-300 pt-1.5 w-40 text-center text-[10px] italic text-gray-400 font-semibold">
          {isSinhala ? 'බලයලත් අත්සන' : 'Authorized Signee'}
        </div>
      </div>
    </div>
  );
}

// Quotation Preview Component
function QuotationPreview({ quote, isSinhala, shopSettings }: { quote: any; isSinhala: boolean; shopSettings: any }) {
  const symbol = isSinhala ? 'රු.' : 'Rs.';
  const convert = (num: number) => num || 0;

  const rawItems = typeof quote.items === 'string'
    ? safeParseJson(quote.items, [])
    : (Array.isArray(quote.items) ? quote.items : []);

  return (
    <div id="quotation-preview-container" className="p-6 space-y-6 max-w-3xl mx-auto bg-white rounded-3xl text-left border border-slate-200 shadow-sm font-sans">
      {/* Business Header */}
      <div className="flex justify-between items-start border-b border-slate-200 pb-5 flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <img
            src={shopSettings?.logo_path || './images/logo.png'}
            alt="Shop Logo"
            className="w-16 h-16 object-contain"
            onError={(e: any) => { e.target.style.display = 'none'; }}
          />
          <div>
            <h3 className="text-base font-black text-slate-900 uppercase tracking-wide">{shopSettings?.shop_name || 'Hardware & ERP Store'}</h3>
            <p className="text-xs font-semibold text-slate-500">{shopSettings?.address || 'No: 80, Mahahunupitiya, Negombo'}</p>
            <p className="text-xs font-bold text-slate-600">Tel: {shopSettings?.phone || '077 076 076 7'}</p>
          </div>
        </div>

        <div className="text-right">
          <span className="px-3 py-1 bg-amber-100 text-amber-900 font-black text-xs rounded-full uppercase tracking-wider block mb-1">
            {isSinhala ? 'මිල ගණන් පූර්ව දර්ශනය' : 'Quotation Preview'}
          </span>
          <div className="text-sm font-black font-mono text-amber-600">{quote.quote_no || quote.quoteNo}</div>
          <div className="text-xs font-bold text-slate-400">Date: {new Date(quote.created_at || Date.now()).toLocaleDateString()}</div>
          <div className="text-xs font-black text-emerald-600 mt-1">Validity: {quote.validity_period || '30 Days'}</div>
        </div>
      </div>

      {/* Customer Details Card */}
      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{isSinhala ? 'පාරිභෝගිකයා' : 'Customer Name'}</span>
          <span className="text-xs font-black text-slate-800">{quote.customer_name || quote.customerName || 'Guest Customer'}</span>
        </div>
        <div>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{isSinhala ? 'දුරකථන අංකය' : 'Phone Number'}</span>
          <span className="text-xs font-bold text-slate-700">{quote.customer_phone || quote.customerPhone || 'N/A'}</span>
        </div>
        <div>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">{isSinhala ? 'ලිපිනය' : 'Address'}</span>
          <span className="text-xs font-bold text-slate-700">{quote.customer_address || quote.customerAddress || 'N/A'}</span>
        </div>
      </div>

      {/* Product Items Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200">
        <table className="w-full text-xs text-left border-collapse">
          <thead>
            <tr className="bg-slate-100 border-b border-slate-200 font-black text-slate-700 uppercase tracking-wider text-[10px]">
              <th className="p-3">#</th>
              <th className="p-3">{isSinhala ? 'භාණ්ඩ විස්තරය' : 'Product Description'}</th>
              <th className="p-3 text-center">{isSinhala ? 'ප්‍රමාණය' : 'Qty'}</th>
              <th className="p-3 text-right">{isSinhala ? 'ඒකක මිල' : 'Unit Price'}</th>
              <th className="p-3 text-right">{isSinhala ? 'වට්ටම' : 'Discount'}</th>
              <th className="p-3 text-right">{isSinhala ? 'එකතුව' : 'Line Total'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rawItems.map((item: any, idx: number) => {
              const gross = (item.qty || 0) * (item.price || 0);
              const discVal = Number(item.discount || 0);
              const discType = item.discountType || 'amount';
              const discAmt = (discType === 'percent' || discType === 'percentage') ? (gross * discVal / 100) : discVal;
              const lineTotal = item.total !== undefined ? item.total : Math.max(0, gross - discAmt);
              const discDisplay = discAmt > 0 
                ? ((discType === 'percent' || discType === 'percentage') ? `-${discVal}%` : `-${symbol} ${convert(discVal).toLocaleString()}`)
                : '-';

              return (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="p-3 font-mono font-bold text-slate-400">{idx + 1}</td>
                  <td className="p-3 font-bold text-slate-800">
                    {item.productName || item.name}
                    {item.unit && <span className="ml-1.5 px-1.5 py-0.5 bg-amber-50 text-amber-800 text-[9px] font-bold rounded">{item.unit}</span>}
                    {(item.barcode || item.sku) && <div className="text-[9px] font-mono text-slate-400">Code: {item.barcode || item.sku}</div>}
                  </td>
                  <td className="p-3 text-center font-black text-slate-700">{item.qty}</td>
                  <td className="p-3 text-right font-semibold text-slate-600">{symbol} {convert(item.price).toLocaleString()}</td>
                  <td className="p-3 text-right font-bold text-emerald-600">{discDisplay}</td>
                  <td className="p-3 text-right font-black text-slate-900">{symbol} {convert(lineTotal).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Financial Summary */}
      {(() => {
        const productDiscounts = rawItems.reduce((sum: number, item: any) => {
          const gross = (item.qty || 0) * (item.price || 0);
          const discVal = Number(item.discount || 0);
          const discType = item.discountType || 'amount';
          const discAmt = (discType === 'percent' || discType === 'percentage') ? (gross * discVal / 100) : discVal;
          return sum + discAmt;
        }, 0);
        const grossSubtotal = rawItems.reduce((sum: number, item: any) => sum + ((item.qty || 0) * (item.price || 0)), 0);
        const totalSavings = productDiscounts + Number(quote.discount_amount || 0);

        return (
          <div className="flex justify-end">
            <div className="w-full md:w-80 bg-amber-50/70 p-4 rounded-2xl border border-amber-200/80 space-y-1.5 text-xs font-bold">
              {grossSubtotal > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>{isSinhala ? 'උප එකතුව:' : 'Subtotal:'}</span>
                  <span>{symbol} {convert(grossSubtotal).toLocaleString()}</span>
                </div>
              )}
              {productDiscounts > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>{isSinhala ? 'භාණ්ඩ වට්ටම්:' : 'Product Savings:'}</span>
                  <span>-{symbol} {convert(productDiscounts).toLocaleString()}</span>
                </div>
              )}
              {quote.discount_amount && quote.discount_amount > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>{isSinhala ? 'අමතර වට්ටම්:' : 'Additional Discount:'}</span>
                  <span>-{symbol} {convert(quote.discount_amount).toLocaleString()}</span>
                </div>
              )}
              {totalSavings > 0 && (
                <div className="flex justify-between text-emerald-700 font-black border-t border-dashed border-amber-200 pt-1.5 pb-0.5">
                  <span>{isSinhala ? 'මුළු ඉතිරිය / වට්ටම:' : 'Total Savings / Discount:'}</span>
                  <span>-{symbol} {convert(totalSavings).toLocaleString()}</span>
                </div>
              )}
              {quote.transportation_fee && quote.transportation_fee > 0 && (
                <div className="flex justify-between text-blue-600">
                  <span>{isSinhala ? 'ප්‍රවාහන ගාස්තු:' : 'Transportation:'}</span>
                  <span>+{symbol} {convert(quote.transportation_fee).toLocaleString()}</span>
                </div>
              )}
              {quote.tax_amount && quote.tax_amount > 0 && (
                <div className="flex justify-between text-amber-800">
                  <span>{isSinhala ? 'බදු:' : 'Tax:'}</span>
                  <span>+{symbol} {convert(quote.tax_amount).toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-black text-amber-950 border-t border-amber-300 pt-2 mt-1">
                <span>{isSinhala ? 'මුළු එකතුව:' : 'Grand Total:'}</span>
                <span className="text-amber-600">{symbol} {convert(quote.total).toLocaleString()}</span>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

interface SalesProps {
  userRole?: string;
  initialTab?: Tab;
}

interface UnitOption {
  unit: string;
  conversionRate: number;
  price?: number;
}

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
  bundles: 'මිටි'
};

const getUnitOptions = (product: Product | undefined): UnitOption[] => {
  if (!product) return [];
  const options: UnitOption[] = [];

  // Always add Base Purchase Unit first
  options.push({
    unit: product.unit,
    conversionRate: 1,
    price: product.price
  });

  const detailsStr = product.measureDetails || (product as any).measure_details;
  if (detailsStr) {
    try {
      const parsed = typeof detailsStr === 'string' ? JSON.parse(detailsStr) : detailsStr;
      const extraConversions: { unit: string; kgVal: number; price?: number }[] = parsed?.conversions || [];

      extraConversions.forEach((c) => {
        if (!c.unit || c.unit.toLowerCase() === product.unit.toLowerCase()) return;
        const rawVal = Number(c.kgVal) || 1;
        
        let convRate = rawVal;
        if (product.unit.toLowerCase() === 'cube' && rawVal > 0 && rawVal < 1) {
          convRate = 1 / rawVal;
        }

        const childPrice = (c.price !== undefined && c.price !== null && Number(c.price) > 0)
          ? Number(c.price)
          : (product.price / convRate);

        if (!options.some(o => o.unit.toLowerCase() === c.unit.toLowerCase())) {
          options.push({
            unit: c.unit,
            conversionRate: convRate,
            price: childPrice
          });
        }
      });
    } catch (e) {}
  }

  return options;
};


export function Sales({ userRole: initialUserRole = 'admin', initialTab = 'new' }: SalesProps) {
  const [userRole, setUserRole] = useState(initialUserRole);
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (data?.user?.role) {
          setUserRole(data.user.role);
        }
      } catch (err) {
        console.error("Error fetching user role:", err);
      }
    };
    checkUser();
  }, []);

  useEffect(() => {
    if (userRole === 'cashier' && tab === 'history') {
      setTab('new');
    }
  }, [tab, userRole]);

  const [shopSettings, setShopSettings] = useState<any>(null);

  useEffect(() => {
    if (initialTab) {
      if (userRole === 'cashier' && initialTab === 'history') {
        setTab('new');
      } else {
        setTab(initialTab);
      }
    }
    const fetchSettings = async () => {
      const { data } = await supabase.from('system_settings').select('*').single();
      if (data) {
        setShopSettings(data);
        if (data.tax_rate !== undefined) {
          setTaxRate(data.tax_rate);
          setApplyTax(data.tax_rate > 0);
          setCreditTaxRate(data.tax_rate);
        }
      }
    };
    fetchSettings();
    window.addEventListener('settings-updated', fetchSettings);
    return () => window.removeEventListener('settings-updated', fetchSettings);
  }, [initialTab]);
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  
  const [isGuest, setIsGuest] = useState(false);
  const [guestName, setGuestName] = useState('Guest Customer');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestAddress, setGuestAddress] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  
  const [cartItems, setCartItems] = useState<SaleItem[]>([]);
  const updateDiscount = (idOrIndex: string | number, val: number | string, type: 'percent' | 'amount' | 'fixed') => {
    const numVal = typeof val === 'number' ? val : parseFloat(val) || 0;
    const normType: 'percent' | 'amount' = type === 'fixed' ? 'amount' : type;
    const updated = [...cartItems];
    const index = typeof idOrIndex === 'number' ? idOrIndex : updated.findIndex(i => i.productId === idOrIndex);
    if (index === -1) return;
    updated[index].discount = numVal;
    updated[index].discountType = normType;
    const price = updated[index].price || 0;
    const qty = updated[index].qty || 1;
    const baseSubtotal = price * qty;
    const discountAmt = normType === 'percent' ? (baseSubtotal * numVal) / 100 : numVal;
    updated[index].total = Math.max(0, baseSubtotal - discountAmt);
    setCartItems(updated);
  };
  const [productSearch, setProductSearch] = useState('');
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0); 
  const [applyTax, setApplyTax] = useState(false);
  const [isSinhala, setIsSinhala] = useState(false);
  
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastOrder, setLastOrder] = useState<SaleOrder | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [historySubTab, setHistorySubTab] = useState<'normal' | 'credit' | 'paid'>('paid');
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [selectedCreditIds, setSelectedCreditIds] = useState<string[]>([]);
  const [salesHistoryFromDate, setSalesHistoryFromDate] = useState('');
  const [salesHistoryToDate, setSalesHistoryToDate] = useState('');
  const [creditHistoryFromDate, setCreditHistoryFromDate] = useState('');
  const [creditHistoryToDate, setCreditHistoryToDate] = useState('');
  const [creditSearchQuery, setCreditSearchQuery] = useState('');
  const [creditSubView, setCreditSubView] = useState<'unpaid' | 'overdue' | 'paid' | 'all'>('unpaid');
  const [isLoading, setIsLoading] = useState(false);
  
  // Held and Payment Methods States
  const [paymentMethod, setPaymentMethod] = useState<'Cash' | 'Card' | 'Bank Transfer' | 'Credit'>('Cash');
  const [showHeldBillsModal, setShowHeldBillsModal] = useState(false);
  const [heldBills, setHeldBills] = useState<any[]>([]);
  const [holdNameInput, setHoldNameInput] = useState('');
  const [showHoldNameModal, setShowHoldNameModal] = useState(false);

  const t = (en: string, si: string) => isSinhala ? si : en;
  const symbol = isSinhala ? 'රු.' : 'Rs.';
  const convert = (val: number) => val; 

  const [creditCustomerType, setCreditCustomerType] = useState<'registered' | 'guest'>('registered');
  const [selectedCreditCustomer, setSelectedCreditCustomer] = useState<Customer | null>(null);
  const [creditGuestName, setCreditGuestName] = useState('Guest Customer');
  const [selectedCreditProduct, setSelectedCreditProduct] = useState<Product | null>(null);
  const [creditSelectedUnit, setCreditSelectedUnit] = useState<string>('');
  const [creditConversionRate, setCreditConversionRate] = useState<number>(1);
  const [creditQty, setCreditQty] = useState(1);
  const [isCreditLoading, setIsCreditLoading] = useState(false);
    const [creditCartItems, setCreditCartItems] = useState<SaleItem[]>([]);
  const [creditTransportationFee, setCreditTransportationFee] = useState<number>(0);
  const [creditProductSearch, setCreditProductSearch] = useState('');

  useEffect(() => {
    if (selectedCreditProduct) {
      const opts = getUnitOptions(selectedCreditProduct);
      const primaryOpt = opts[0] || { unit: selectedCreditProduct.unit, conversionRate: 1 };
      setCreditSelectedUnit(primaryOpt.unit);
      setCreditConversionRate(primaryOpt.conversionRate);
    } else {
      setCreditSelectedUnit('');
      setCreditConversionRate(1);
    }
  }, [selectedCreditProduct]);

  // Quotations State
  const [quotes, setQuotes] = useState<Quotation[]>([]);
  const [isCreatingQuote, setIsCreatingQuote] = useState(false);
  const [quoteNo, setQuoteNo] = useState('Q-0001');
  const [quoteCustomerName, setQuoteCustomerName] = useState('');
  const [quoteCustomerPhone, setQuoteCustomerPhone] = useState('');
  const [quoteCustomerAddress, setQuoteCustomerAddress] = useState('');
  const [quoteValidityPeriod, setQuoteValidityPeriod] = useState('30 Days');
  const [quoteCart, setQuoteCart] = useState<SaleItem[]>([]);
  const [quoteSearch, setQuoteSearch] = useState('');
  const quoteSearchInputRef = useRef<HTMLInputElement>(null);

  // Quotation Additional Charges State
  const [quoteDiscountType, setQuoteDiscountType] = useState<'amount' | 'percentage'>('amount');
  const [quoteDiscountValue, setQuoteDiscountValue] = useState<number | ''>('');
  const [quoteTransportationFee, setQuoteTransportationFee] = useState<number | ''>('');
  const [quoteTaxType, setQuoteTaxType] = useState<'percentage' | 'amount'>('percentage');
  const [quoteTaxValue, setQuoteTaxValue] = useState<number | ''>('');

  // Quotation Preview Modal State
  const [showQuotePreviewModal, setShowQuotePreviewModal] = useState(false);
  const [selectedQuotePreview, setSelectedQuotePreview] = useState<Quotation | null>(null);

  // Delivery Notes State
  const [deliveryNotes, setDeliveryNotes] = useState<DeliveryNote[]>([]);
  const [isCreatingDN, setIsCreatingDN] = useState(false);
  const [selectedInvoiceForDN, setSelectedInvoiceForDN] = useState<SaleOrder | null>(null);
  const [dnSearch, setDnSearch] = useState('');

  // Credit period due days
  const [creditPeriodDays, setCreditPeriodDays] = useState(30);
  const [creditTabPeriodDays, setCreditTabPeriodDays] = useState(30);
  const [creditDiscount, setCreditDiscount] = useState(0);
  const [creditDiscountType, setCreditDiscountType] = useState<'percent' | 'amount'>('amount');
  const [creditTaxRate, setCreditTaxRate] = useState(0);

  // Transportation Fee & Product Selection States
  const [transportationFee, setTransportationFee] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const resetNewSale = () => {
    setCartItems([]);
    setSelectedCustomer(null);
    setIsGuest(false);
    setGuestName('Guest Customer');
    setGuestPhone('');
    setGuestAddress('');
    setTransportationFee(0);
    setDiscount(0);
    setPaymentMethod('Cash');
    setCreditNoteApplied('');
    setSelectedCreditNoteCode('');
    setProductSearch('');
    setSelectedIndex(0);
    if (shopSettings && shopSettings.tax_rate !== undefined) {
      setTaxRate(shopSettings.tax_rate);
      setApplyTax(shopSettings.tax_rate > 0);
    } else {
      setTaxRate(0);
      setApplyTax(false);
    }
  };

  useEffect(() => {
    const handleReset = () => {
      resetNewSale();
    };
    window.addEventListener('reset-new-sale', handleReset);
    return () => window.removeEventListener('reset-new-sale', handleReset);
  }, []);

  // Credit Note Applied in POS Checkout State
  const [creditNoteApplied, setCreditNoteApplied] = useState<number | ''>('');
  const [selectedCreditNoteCode, setSelectedCreditNoteCode] = useState<string>('');

  // Void Passkey Modal State
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidPasskeyInput, setVoidPasskeyInput] = useState('');
  const [targetVoidInvoiceId, setTargetVoidInvoiceId] = useState<string | null>(null);
  const [targetVoidReturnId, setTargetVoidReturnId] = useState<string | null>(null);

  // Sales Returns & Exchange & Credit Notes State
  const returnSearchInputRef = useRef<HTMLInputElement>(null);
  const [salesReturnsList, setSalesReturnsList] = useState<SalesReturn[]>([]);
  const [creditNotesList, setCreditNotesList] = useState<CreditNote[]>([]);
  const [returnSearchQuery, setReturnSearchQuery] = useState('');
  const [showBillSearchResults, setShowBillSearchResults] = useState(true);
  const [returnProductSearch, setReturnProductSearch] = useState('');
  const [targetReturnInvoice, setTargetReturnInvoice] = useState<SaleOrder | null>(null);
  const [includeReturnDiscount, setIncludeReturnDiscount] = useState<boolean>(true);
  const [includeReturnTax, setIncludeReturnTax] = useState<boolean>(true);
  const [includeReturnTransport, setIncludeReturnTransport] = useState<boolean>(true);
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [returnMethod, setReturnMethod] = useState<'Cash Refund' | 'Exchange' | 'Credit Note'>('Cash Refund');
  const [returnReason, setReturnReason] = useState('');

  useEffect(() => {
    if (tab === 'returns') {
      setTimeout(() => returnSearchInputRef.current?.focus(), 150);
    }
  }, [tab]);

  // Exchange State
  const [exchangeCartItems, setExchangeCartItems] = useState<SaleItem[]>([]);
  const [exchangeProductSearch, setExchangeProductSearch] = useState('');
  const [exchangeCategoryFilter, setExchangeCategoryFilter] = useState<string>('All');
  const [exchangeCustomerPaid, setExchangeCustomerPaid] = useState<number>(0);
  const [exchangeRefundGiven, setExchangeRefundGiven] = useState<number>(0);

  // Return & Credit Note History Preview Modals
  const [showReturnPreviewModal, setShowReturnPreviewModal] = useState(false);
  const [selectedReturnPreview, setSelectedReturnPreview] = useState<SalesReturn | null>(null);
  const [showCreditNotePreviewModal, setShowCreditNotePreviewModal] = useState(false);
  const [selectedCreditNotePreview, setSelectedCreditNotePreview] = useState<CreditNote | null>(null);
  const [returnSubTab, setReturnSubTab] = useState<'history' | 'credit_notes'>('history');

  // Credit Note Usage History State
  const [showCreditNoteUsageModal, setShowCreditNoteUsageModal] = useState(false);
  const [creditNoteUsageLogs, setCreditNoteUsageLogs] = useState<CreditNoteUsage[]>([]);
  const [loadingCNUsage, setLoadingCNUsage] = useState(false);



  const fetchCreditNoteUsage = async (code?: string) => {
    setLoadingCNUsage(true);
    try {
      const logs = await api.creditNotes.getUsageHistory(code);
      setCreditNoteUsageLogs(logs || []);
    } catch (e) {
      console.error('Failed to fetch credit note usage history', e);
    } finally {
      setLoadingCNUsage(false);
    }
  };
  const [expandedReturnId, setExpandedReturnId] = useState<string | null>(null);

  const fetchSalesReturns = async () => {
    try {
      const res = await fetchWithTimeout(`${API_URL}/sales/returns`, {}, 8000);
      if (res.ok) {
        const data = await res.json();
        setSalesReturnsList(data || []);
      }
    } catch (e) {
      console.error('Failed to fetch sales returns', e);
    }
  };

  const fetchCreditNotes = async () => {
    try {
      const res = await fetchWithTimeout(`${API_URL}/credit-notes`, {}, 8000);
      if (res.ok) {
        const data = await res.json();
        setCreditNotesList(data || []);
        return;
      }
    } catch (e) {}
    try {
      const res = await fetchWithTimeout(`${API_URL}/sales/credit-notes`, {}, 8000);
      if (res.ok) {
        const data = await res.json();
        setCreditNotesList(data || []);
      }
    } catch (e) {
      console.error('Failed to fetch credit notes', e);
    }
  };

  const handleCreditNoteCashRefund = async (cn: CreditNote) => {
    const cnCode = cn.creditNoteNo || cn.credit_note_no || cn.code || cn.id;
    const remBal = Number(cn.balance_remaining !== undefined ? cn.balance_remaining : (cn.balanceRemaining || cn.amount || 0));
    if (remBal <= 0) {
      return alert(t("Credit note balance is 0 or already fully used.", "ණය සටහන් ශේෂය 0 වේ හෝ දැනටමත් සම්පූර්ණයෙන්ම භාවිතා කර ඇත."));
    }
    const confirmRefund = window.confirm(t(
      `Are you sure you want to cash refund ${symbol} ${convert(remBal).toLocaleString()} for Credit Note ${cnCode}? This is a separate authorized action that will log an expense transaction in accounting ledger.`,
      `ණය සටහන් ${cnCode} සඳහා ${symbol} ${convert(remBal).toLocaleString()} ක මුදල් ආපසු ගෙවීමට ඔබට විශ්වාසද? මෙය ගිණුම්කරණ ලේඛනයේ වෙනම බලයලත් වියදම් ගනුදෙනුවක් ලෙස සටහන් වේ.`
    ));
    if (!confirmRefund) return;

    try {
      setIsLoading(true);
      const userMail = isGuest ? 'system' : (selectedCustomer?.email || 'system');
      const res = await api.creditNotes.refundCash(cnCode, 'Authorized Cash Refund of Credit Note', userMail);
      alert(t(res.message || 'Cash refund processed successfully!', 'මුදල් ආපසු ගෙවීම සාර්ථකයි!'));
      fetchCreditNotes();
    } catch (e: any) {
      alert("Cash refund failed: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const generateReturnPrintHTML = (sr: SalesReturn, shopSettings: any, isSi: boolean) => {
    const symbolStr = isSi ? 'රු.' : 'Rs.';
    const formatNum = (num: number) => num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const title = isSi ? 'විකුණුම් ආපසු ලදුපත' : 'SALES RETURN RECEIPT';

    const retItems = Array.isArray(sr.returnedItems) ? sr.returnedItems : safeParseJson(sr.returnedItems, []);
    const exItems = Array.isArray(sr.exchangeItems) ? sr.exchangeItems : safeParseJson(sr.exchangeItems, []);

    const retRows = retItems.map((i: any) => `
      <tr style="border-bottom: 1px dashed #e5e7eb;">
        <td style="padding: 5px 0 2px 0; font-weight: bold; text-align: left; color: #1f2937; font-size: 13px;">${i.productName || i.name}</td>
        <td style="padding: 5px 0 2px 0; text-align: center; color: #374151; font-size: 12px;">${i.qty} ${i.unit || ''}</td>
        <td style="padding: 5px 0 2px 0; text-align: right; color: #1f2937; font-weight: bold; font-size: 13px;">${symbolStr} ${formatNum(i.qty * i.price)}</td>
      </tr>
    `).join('');

    const exRows = exItems.map((i: any) => `
      <tr style="border-bottom: 1px dashed #e5e7eb;">
        <td style="padding: 5px 0 2px 0; font-weight: bold; text-align: left; color: #047857; font-size: 13px;">⇄ ${i.productName || i.name}</td>
        <td style="padding: 5px 0 2px 0; text-align: center; color: #374151; font-size: 12px;">${i.qty} ${i.unit || ''}</td>
        <td style="padding: 5px 0 2px 0; text-align: right; color: #047857; font-weight: bold; font-size: 13px;">${symbolStr} ${formatNum(i.qty * i.price)}</td>
      </tr>
    `).join('');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Sales Return - ${sr.returnNo || sr.id}</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans+Sinhala:wght@400;600;700;800&display=swap" rel="stylesheet">
          <style>
            @page { margin: 0; size: 80mm auto; }
            body { font-family: 'Inter', 'Noto Sans Sinhala', sans-serif; margin: 0; padding: 10px; font-size: 12px; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .receipt-container { width: 100%; max-width: 80mm; margin: 0 auto; box-sizing: border-box; }
            .header { text-align: center; border-bottom: 2px dashed #374151; padding-bottom: 8px; margin-bottom: 8px; }
            .title { text-align: center; font-weight: 800; font-size: 14px; margin: 8px 0; text-transform: uppercase; border: 1px solid #1f2937; padding: 4px; background: #f9fafb; }
            .table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            .table th { border-bottom: 1px solid #374151; text-align: left; padding: 4px 0; font-size: 11px; }
            .summary { border-top: 2px dashed #374151; margin-top: 10px; padding-top: 6px; }
            .summary-row { display: flex; justify-content: space-between; padding: 2px 0; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <div class="header">
              <h2 style="margin:0; font-size: 16px;">${shopSettings?.shop_name || 'MUTUWADIGE HARDWARE'}</h2>
              <p style="margin:2px 0;">${shopSettings?.address || 'No: 80, Mahahunupitiya, Negombo'}</p>
              <p style="margin:2px 0;">Tel: ${shopSettings?.phone || '077 076 076 7'}</p>
            </div>
            <div class="title">${title}</div>
            <div>
              <div><b>${isSi ? 'ආපසු අංකය:' : 'Return No:'}</b> ${sr.returnNo || sr.return_no || sr.id}</div>
              <div><b>${isSi ? 'ඉන්වොයිස් අංකය:' : 'Orig Invoice:'}</b> ${sr.invoiceNo || sr.invoice_no}</div>
              <div><b>${isSi ? 'පාරිභෝගිකයා:' : 'Customer:'}</b> ${sr.customerName || sr.customer_name || 'Guest'}</div>
              <div><b>${isSi ? 'දිනය:' : 'Date:'}</b> ${new Date(sr.created_at).toLocaleString()}</div>
              <div><b>${isSi ? 'ක්‍රමය:' : 'Method:'}</b> ${sr.returnMethod}</div>
            </div>

            <table class="table">
              <thead>
                <tr>
                  <th>${isSi ? 'ආපසු භාණ්ඩ' : 'Returned Item'}</th>
                  <th style="text-align:center;">${isSi ? 'ප්‍රමාණය' : 'Qty'}</th>
                  <th style="text-align:right;">${isSi ? 'එකතුව' : 'Total'}</th>
                </tr>
              </thead>
              <tbody>${retRows}</tbody>
            </table>

            ${exItems.length > 0 ? `
              <table class="table" style="margin-top: 10px;">
                <thead>
                  <tr>
                    <th style="color:#047857;">${isSi ? 'හුවමාරු භාණ්ඩ' : 'Exchange Item'}</th>
                    <th style="text-align:center;">${isSi ? 'ප්‍රමාණය' : 'Qty'}</th>
                    <th style="text-align:right;">${isSi ? 'එකතුව' : 'Total'}</th>
                  </tr>
                </thead>
                <tbody>${exRows}</tbody>
              </table>
            ` : ''}

            <div class="summary">
              <div class="summary-row">
                <span>${isSi ? 'ආපසු ලැබුණු වටිනාකම:' : 'Return Total Value:'}</span>
                <span>${symbolStr} ${formatNum(sr.returnAmount || sr.totalRefunded || 0)}</span>
              </div>
              ${sr.returnMethod === 'Credit Note' ? `
                <div class="summary-row" style="color: #d97706;">
                  <span>${isSi ? 'නිකුත් කළ ණය සටහන් අංකය:' : 'Credit Note Issued:'}</span>
                  <span>${sr.creditNoteNo || 'CN-ISSUED'}</span>
                </div>
              ` : ''}
              ${sr.returnMethod === 'Cash Refund' ? `
                <div class="summary-row" style="color: #dc2626;">
                  <span>${isSi ? 'ආපසු ගෙවූ මුදල:' : 'Cash Refunded:'}</span>
                  <span>${symbolStr} ${formatNum(sr.totalRefunded || 0)}</span>
                </div>
              ` : ''}
            </div>
            <div style="text-align:center; margin-top: 15px; font-size: 11px; color: #6b7280;">
              ${isSi ? 'ස්තූතියි!' : 'Thank you!'}
            </div>
          </div>
        </body>
      </html>
    `;
  };

  const generateCreditNotePrintHTML = (cn: CreditNote, shopSettings: any, isSi: boolean) => {
    const symbolStr = isSi ? 'රු.' : 'Rs.';
    const formatNum = (num: number) => num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const title = isSi ? 'ණය සටහන (CREDIT NOTE)' : 'CREDIT NOTE';

    const cnNo = cn.creditNoteNo || cn.credit_note_no || cn.code || cn.id;
    const originalVal = Number(cn.amount || cn.value || 0);
    const balRem = Number(cn.balanceRemaining !== undefined ? cn.balanceRemaining : (cn.balance_remaining !== undefined ? cn.balance_remaining : originalVal));

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Credit Note - ${cnNo}</title>
          <style>
            @page { margin: 0; size: 80mm auto; }
            body { font-family: sans-serif; margin: 0; padding: 10px; font-size: 12px; color: #111827; }
            .header { text-align: center; border-bottom: 2px dashed #374151; padding-bottom: 8px; margin-bottom: 8px; }
            .title { text-align: center; font-weight: 800; font-size: 14px; margin: 8px 0; text-transform: uppercase; border: 1px solid #d97706; background: #fef3c7; color: #92400e; padding: 6px; }
            .summary-box { border: 1.5px solid #f59e0b; background: #fffbe8; padding: 10px; border-radius: 8px; margin: 10px 0; }
            .row { display: flex; justify-content: space-between; padding: 3px 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2 style="margin:0; font-size: 16px;">${shopSettings?.shop_name || 'MUTUWADIGE HARDWARE'}</h2>
            <p style="margin:2px 0;">${shopSettings?.address || 'No: 80, Mahahunupitiya, Negombo'}</p>
            <p style="margin:2px 0;">Tel: ${shopSettings?.phone || '077 076 076 7'}</p>
          </div>
          <div class="title">${title}</div>
          <div>
            <div><b>${isSi ? 'ණය සටහන් අංකය:' : 'Credit Note No:'}</b> <span style="font-family: monospace; font-weight: 900;">${cnNo}</span></div>
            <div><b>${isSi ? 'යොමු ඉන්වොයිසිය:' : 'Ref Invoice:'}</b> ${cn.invoiceNo || cn.invoice_no || 'N/A'}</div>
            <div><b>${isSi ? 'පාරිභෝගිකයා:' : 'Customer:'}</b> ${cn.customerName || cn.customer_name || 'Guest'}</div>
            ${(cn.customerPhone || cn.customer_phone) ? `<div><b>${isSi ? 'දුරකථනය:' : 'Phone:'}</b> ${cn.customerPhone || cn.customer_phone}</div>` : ''}
            <div><b>${isSi ? 'දිනය:' : 'Date:'}</b> ${new Date(cn.created_at).toLocaleString()}</div>
            <div><b>${isSi ? 'තත්ත්වය:' : 'Status:'}</b> <span style="text-transform: uppercase; font-weight: bold;">${cn.status}</span></div>
          </div>

          <div class="summary-box">
            <div class="row">
              <span>${isSi ? 'මුළු ණය මුදල:' : 'Original Credit Amount:'}</span>
              <span style="font-weight: bold;">${symbolStr} ${formatNum(originalVal)}</span>
            </div>
            <div class="row" style="font-size: 14px; font-weight: 900; color: #b45309; border-top: 1px dashed #f59e0b; padding-top: 5px; margin-top: 4px;">
              <span>${isSi ? 'ඉතිරි ශේෂය:' : 'Remaining Balance:'}</span>
              <span>${symbolStr} ${formatNum(balRem)}</span>
            </div>
          </div>

          <div style="text-align:center; margin-top: 15px; font-size: 10px; color: #4b5563;">
            ${isSi ? 'මෙම ණය සටහන ඊළඟ භාණ්ඩ මිලදී ගැනීමේදී භාවිතා කළ හැක.' : 'This credit note can be redeemed on future purchases.'}
          </div>
        </body>
      </html>
    `;
  };

  const handlePrintReturnReceipt = (returnRecord: SalesReturn) => {
    const htmlContent = generateReturnPrintHTML(returnRecord, shopSettings, isSinhala);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(htmlContent);
      doc.close();
    }

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 1000);
    }, 300);
  };

  const handleDownloadReturnPDF = async (returnRecord: SalesReturn) => {
    if (!returnRecord) return;
    try {
      setIsLoading(true);

      let targetElement = document.getElementById('return-receipt-preview');
      let tempContainer: HTMLElement | null = null;
      let root: any = null;

      if (!targetElement) {
        tempContainer = document.createElement('div');
        tempContainer.style.position = 'fixed';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '0';
        tempContainer.style.width = '672px';
        tempContainer.style.background = '#ffffff';
        tempContainer.style.zIndex = '-9999';
        document.body.appendChild(tempContainer);

        root = createRoot(tempContainer);
        root.render(<ReturnReceiptPreview returnRecord={returnRecord} isSinhala={isSinhala} />);
        
        await new Promise((r) => setTimeout(r, 250));
        targetElement = tempContainer.querySelector('#return-receipt-preview') || tempContainer;
      }

      if (!targetElement) throw new Error('Failed to render return receipt preview');

      const canvas = await html2canvas(targetElement as HTMLElement, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false
      });

      if (root && tempContainer) {
        root.unmount();
        if (document.body.contains(tempContainer)) {
          document.body.removeChild(tempContainer);
        }
      }

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = 190;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const xPos = (pdfWidth - imgWidth) / 2;

      if (imgHeight <= pdfHeight - 20) {
        pdf.addImage(imgData, 'PNG', xPos, 10, imgWidth, imgHeight);
      } else {
        let heightLeft = imgHeight;
        let position = 10;
        pdf.addImage(imgData, 'PNG', xPos, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;

        while (heightLeft > 0) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', xPos, position, imgWidth, imgHeight);
          heightLeft -= pdfHeight;
        }
      }

      const retNo = returnRecord.returnNo || returnRecord.return_no || returnRecord.id;
      pdf.save(`SalesReturn_${retNo}.pdf`);
    } catch (err: any) {
      console.error('Failed to download Sales Return PDF:', err);
      alert(t('Failed to download PDF: ', 'ආපසු භාරගැනීමේ PDF පත්‍රය බාගත කිරීමට අපොහොසත් විය: ') + (err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrintCreditNote = (creditNoteRecord: CreditNote) => {
    const htmlContent = generateCreditNotePrintHTML(creditNoteRecord, shopSettings, isSinhala);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(htmlContent);
      doc.close();
    }

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe);
      }, 1000);
    }, 300);
  };

  const calculateDueDate = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  };

  const addCreditCartItemDirect = (p: any) => {
    const itemPrice = p.price !== undefined ? p.price : (p.sellingPrice || 0);
    const existingIndex = creditCartItems.findIndex(i => i.productId === p.id);
    if (existingIndex >= 0) {
      updateCreditQty(existingIndex, creditCartItems[existingIndex].qty + 1);
    } else {
      setCreditCartItems([...creditCartItems, {
        productId: p.id,
        productName: p.name,
        qty: 1,
        price: itemPrice,
        taxRate: creditTaxRate,
        total: itemPrice,
        serialNo: p.serialNo || '',
        batchCode: p.batchCode || '',
        unit: p.unit || 'pcs',
        conversionRate: 1,
        discount: 0,
        discountType: 'amount'
      }]);
    }
  };

  const updateCreditQty = (idx: number, newQty: number, forceValidate: boolean = false) => {
    setCreditCartItems(prev => {
      const updated = [...prev];
      const item = updated[idx];
      if (!item) return prev;
      const product = products.find(p => p.id === item.productId);
      const baseStock = Number(product?.stock) || 0;
      const convRate = item.conversionRate || 1;
      const stockAvailableInSelectedUnit = Math.round((baseStock * convRate) * 100000) / 100000;

      let targetQty = newQty;

      if (forceValidate) {
        if (isNaN(targetQty) || targetQty < 1) {
          targetQty = 1;
        } else if (targetQty > stockAvailableInSelectedUnit) {
          alert(t(
            `Only ${stockAvailableInSelectedUnit} ${item.unit || 'unit(s)'} available in stock!`,
            `තොගයේ ඇත්තේ ${stockAvailableInSelectedUnit} ${item.unit || ''} ක් පමණි!`
          ));
          targetQty = stockAvailableInSelectedUnit;
        }
      } else {
        if (!isNaN(targetQty) && targetQty > stockAvailableInSelectedUnit) {
          alert(t(
            `Only ${stockAvailableInSelectedUnit} ${item.unit || 'unit(s)'} available in stock!`,
            `තොගයේ ඇත්තේ ${stockAvailableInSelectedUnit} ${item.unit || ''} ක් පමණි!`
          ));
          targetQty = stockAvailableInSelectedUnit;
        }
      }

      const safeQtyForTotal = Math.max(0, targetQty);
      const gross = safeQtyForTotal * item.price;
      const disc = item.discount || 0;
      const discType = item.discountType || 'amount';
      const discAmt = discType === 'percent' ? gross * (disc / 100) : disc;
      updated[idx] = { ...item, qty: targetQty, total: Math.max(0, gross - discAmt) };
      return updated;
    });
  };

  const updateCreditDiscount = (idx: number, discount: number, discountType: 'percent' | 'amount') => {
    setCreditCartItems(prev => {
      const updated = [...prev];
      const item = updated[idx];
      const gross = item.qty * item.price;
      const discAmt = discountType === 'percent' ? gross * (discount / 100) : discount;
      updated[idx] = { ...item, discount, discountType, total: Math.max(0, gross - discAmt) };
      return updated;
    });
  };

  const addCreditCartItem = () => {
    if (!selectedCreditProduct) return;
    if (creditQty <= 0) {
      alert(t("Quantity must be greater than 0.", "ප්‍රමාණය 0 ට වඩා වැඩි විය යුතුය."));
      return;
    }
    const stockAvailable = Number(selectedCreditProduct.stock) || 0;
    
    // Check if item already in creditCartItems
    const existing = creditCartItems.find(item => item.productId === selectedCreditProduct.id);
    const existingBaseQty = existing ? existing.qty / (existing.conversionRate || 1) : 0;
    const addedBaseQty = creditQty / creditConversionRate;

    if (existingBaseQty + addedBaseQty > stockAvailable) {
      const baseStockRemaining = Math.max(0, stockAvailable - existingBaseQty);
      const stockAvailableInSelectedUnit = baseStockRemaining * creditConversionRate;
      alert(t(
        `Only ${stockAvailableInSelectedUnit.toFixed(2)} ${creditSelectedUnit || selectedCreditProduct.unit}(s) available in stock!`,
        `තොගයේ ඇත්තේ ${stockAvailableInSelectedUnit.toFixed(2)} ${creditSelectedUnit || selectedCreditProduct.unit} ක් පමණි!`
      ));
      return;
    }
    
    const catalogOptions = getUnitOptions(selectedCreditProduct);
    const selectedOpt = catalogOptions.find(o => o.unit === (creditSelectedUnit || selectedCreditProduct.unit));
    const adjustedPrice = (selectedOpt && selectedOpt.price !== undefined)
      ? selectedOpt.price
      : (selectedCreditProduct.price / creditConversionRate);

    if (existing) {
      setCreditCartItems(creditCartItems.map(item => 
        item.productId === selectedCreditProduct.id 
          ? { 
              ...item, 
              qty: item.qty + creditQty, 
              price: adjustedPrice, 
              total: (item.qty + creditQty) * adjustedPrice,
              unit: creditSelectedUnit || selectedCreditProduct.unit,
              conversionRate: creditConversionRate
            }
          : item
      ));
    } else {
      setCreditCartItems([...creditCartItems, {
        productId: selectedCreditProduct.id,
        productName: selectedCreditProduct.name,
        qty: creditQty,
        price: adjustedPrice,
        taxRate: 0,
        total: adjustedPrice * creditQty,
        unit: creditSelectedUnit || selectedCreditProduct.unit,
        conversionRate: creditConversionRate
      }]);
    }
    
    setSelectedCreditProduct(null);
    setCreditSelectedUnit('');
    setCreditConversionRate(1);
    setCreditQty(1);
  };

  // Customer Details Form Step States
  const [creditStep, setCreditStep] = useState<'customer' | 'purchase'>('customer');
  const [creditCustomerName, setCreditCustomerName] = useState('');
  const [creditCustomerPhone, setCreditCustomerPhone] = useState('');
  const [creditCustomerAddress, setCreditCustomerAddress] = useState('');
  const [creditCustomerNIC, setCreditCustomerNIC] = useState('');

  const processCreditSale = async () => {
    if (isCreditLoading || isLoading) return;
    if (!creditCustomerName.trim()) {
      return alert(t("Please enter a customer name.", "කරුණාකර පාරිභෝගිකයාගේ නම ඇතුළත් කරන්න."));
    }
    if (creditCustomerName.trim().length < 2) {
      return alert(t("Customer name must be at least 2 characters.", "පාරිභෝගිකයාගේ නම අවම වශයෙන් අකුරු 2ක් විය යුතුය."));
    }

    if (creditCustomerPhone && creditCustomerPhone.trim() !== '') {
      const phoneClean = creditCustomerPhone.trim();
      const slPhoneRegex = /^(?:0|94|\+94)?7[0-9]{8}$/;
      const landlineRegex = /^(?:0|94|\+94)?(?:11|21|23|24|25|26|27|31|32|33|34|35|36|37|38|41|45|47|51|52|54|55|57|63|65|66|67|81|91)[0-9]{7}$/;
      if (!slPhoneRegex.test(phoneClean) && !landlineRegex.test(phoneClean)) {
        return alert(t("Invalid contact number format. Use Sri Lankan mobile or landline format.", "වලංගු නොවන දුරකථන අංක ආකෘතියකි. ශ්‍රී ලංකා ජංගම හෝ ස්ථාවර අංකයක් භාවිතා කරන්න."));
      }
    }

    if (creditCustomerNIC && creditCustomerNIC.trim() !== '') {
      const nicClean = creditCustomerNIC.trim();
      const oldNicRegex = /^[0-9]{9}[vVxX]$/;
      const newNicRegex = /^[0-9]{12}$/;
      if (!oldNicRegex.test(nicClean) && !newNicRegex.test(nicClean)) {
        return alert(t("Invalid NIC number. Use 9 digits with V/X or 12-digit format.", "වලංගු නොවන ජාතික හැඳුනුම්පත් අංකයකි. 9 සහ V/X හෝ 12-අංක ආකෘතිය භාවිතා කරන්න."));
      }
    }

    if (creditCustomerAddress && creditCustomerAddress.trim() !== '' && creditCustomerAddress.trim().length < 5) {
      return alert(t("Street address must be at least 5 characters.", "ලිපිනය අවම වශයෙන් අකුරු 5ක් විය යුතුය."));
    }

    if (creditCartItems.length === 0) {
      return alert(t("Please add at least one product.", "කරුණාකර අවම වශයෙන් එක් භාණ්ඩයක්වත් එකතු කරන්න."));
    }

    setIsCreditLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      let customerId = selectedCreditCustomer?.id || null;
      let finalCustomerName = creditCustomerType === 'registered' 
        ? (selectedCreditCustomer?.name || creditCustomerName.trim() || 'Guest Customer')
        : (creditCustomerName.trim() || 'Guest Customer');
      const finalCustomerPhone = creditCustomerPhone.trim() || selectedCreditCustomer?.phone || '';
      const finalCustomerAddress = creditCustomerAddress.trim() || selectedCreditCustomer?.address || '';

      // If it is a new customer, save them to the customers table first!
      if (!customerId && creditCustomerName.trim() && creditCustomerName.trim() !== 'Guest Customer') {
        try {
          const newCustPayload = {
            name: creditCustomerName.trim(),
            phone: creditCustomerPhone.trim(),
            address: creditCustomerAddress.trim(),
            nic: creditCustomerNIC.trim(),
            loyalty_points: 0,
            total_purchases: 0
          };
          const { data: newCust } = await supabase.from('customers').insert([newCustPayload]).select().single();
          if (newCust && newCust.id) {
            customerId = newCust.id;
            finalCustomerName = newCust.name || newCustPayload.name || finalCustomerName;
          }
        } catch (e) {
          console.warn("Failed to auto-register customer, proceeding with manual details:", e);
        }
      }

      const grossCreditSubtotal = creditCartItems.reduce((sum, item) => sum + (item.qty * item.price), 0);
      const creditTotalDiscount = creditCartItems.reduce((sum, item) => {
        const gross = item.qty * item.price;
        const disc = item.discount || 0;
        const discType = item.discountType || 'amount';
        const discAmt = discType === 'percent' ? gross * (disc / 100) : disc;
        return sum + discAmt;
      }, 0);
      const creditNetSubtotal = Math.max(0, grossCreditSubtotal - creditTotalDiscount);
      const creditTaxAmt = applyTax ? creditNetSubtotal * (creditTaxRate / 100) : 0;
      const creditTotal = creditNetSubtotal + creditTaxAmt + (Number(creditTransportationFee) || 0);

      const newOrderData = {
        invoice_no: `INV-${Date.now()}`,
        customer_id: customerId,
        customer_name: finalCustomerName,
        customer_phone: finalCustomerPhone,
        customer_address: finalCustomerAddress,
        items: creditCartItems,
        subtotal: grossCreditSubtotal,
        discount: creditTotalDiscount,
        tax: creditTaxAmt,
        tax_rate: applyTax ? creditTaxRate : 0,
        total_amount: creditTotal,
        status: 'Non Paid',
        user_id: user?.id,
        due_date: calculateDueDate(creditTabPeriodDays),
        credit_period_days: creditTabPeriodDays,
        payment_method: 'Credit',
        transportation_fee: Number(creditTransportationFee) || 0
      };

      const { data: saleRecord, error: saleError } = await supabase.from('sales').insert([newOrderData]).select().single();
      if (saleError && !saleRecord) {
        console.warn("Supabase credit sale insert notice:", saleError);
      }

      // Update product stock levels
      for (const item of creditCartItems) {
        const product = products.find(p => p.id === item.productId);
        if (product) {
          const convRate = item.conversionRate || 1;
          const decr = convRate > 0 ? (item.qty / convRate) : item.qty;
          await supabase.from('products').update({ stock: Math.max(0, product.stock - decr) }).eq('id', item.productId);
        }
      }

      const completedOrder: SaleOrder = {
        id: saleRecord?.id || `so_${Date.now()}`,
        invoiceNo: saleRecord?.invoice_no || saleRecord?.invoiceNo || newOrderData.invoice_no,
        customer_id: newOrderData.customer_id || '',
        customerName: finalCustomerName,
        customer_name: finalCustomerName,
        customerPhone: finalCustomerPhone,
        customer_phone: finalCustomerPhone,
        customerAddress: finalCustomerAddress,
        customer_address: finalCustomerAddress,
        cashier: user?.email || 'system',
        date: new Date().toLocaleDateString(),
        items: creditCartItems,
        created_at: saleRecord?.created_at || new Date().toISOString(),
        subtotal: grossCreditSubtotal,
        discount: creditTotalDiscount,
        tax: creditTaxAmt,
        tax_rate: applyTax ? creditTaxRate : 0,
        total: creditTotal,
        total_amount: creditTotal,
        status: 'Non Paid',
        due_date: newOrderData.due_date,
        credit_period_days: newOrderData.credit_period_days,
        payment_method: 'Credit',
        transportation_fee: Number(creditTransportationFee) || 0,
        transportationFee: Number(creditTransportationFee) || 0
      };

      setLastOrder(completedOrder);
      setShowReceipt(true);
      
      setCreditCartItems([]);
      setSelectedCreditProduct(null);
      setCreditQty(1);
      setSelectedCreditCustomer(null);
      setCreditCustomerName('');
      setCreditCustomerPhone('');
      setCreditCustomerAddress('');
      setCreditCustomerNIC('');
      setCreditTransportationFee(0);
      setCreditStep('customer');
      setCreditDiscount(0);
      setCreditTaxRate(shopSettings?.tax_rate || 0);
      fetchData();
    } catch (error: any) {
      alert("Credit order failed: " + error.message);
    } finally {
      setIsCreditLoading(false);
    }
  };

  const completeCreditPayment = async (orderId: string) => {
    try {
      setIsLoading(true);
      const { error } = await supabase.from('sales').update({ status: 'Paid' }).eq('id', orderId);
      if (error) throw error;
      fetchData();
    } catch (err: any) {
      alert("Failed to complete payment: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchNextQuoteNumber = async () => {
    try {
      const res = await fetchWithTimeout(`${API_URL}/quotations/next-number`);
      if (res.ok) {
        const data = await res.json();
        if (data.nextNumber) setQuoteNo(data.nextNumber);
      }
    } catch (e) {
      console.error('Error fetching next quote number:', e);
    }
  };

  const fetchData = async () => {
    const fetchStart = Date.now();
    console.log('[START] Sales Data Fetch & Sync');
    setIsLoading(true);
    try {
      const { data: prodData } = await supabase.from('products').select('*');
      if (prodData) setProducts(prodData);

      const { data: custData } = await supabase.from('customers').select('*');
      const custIdMap = new Map<string, any>();
      const custNameMap = new Map<string, any>();
      if (custData) {
        setCustomers(custData);
        custData.forEach((c: any) => {
          if (c.id) custIdMap.set(c.id, c);
          if (c.name) custNameMap.set(c.name.toLowerCase().trim(), c);
        });
      }

      const { data: salesData } = await supabase
        .from('sales')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (salesData) {
        const mappedOrders = salesData.map((s: any) => {
          const matchedCust = (s.customer_id ? custIdMap.get(s.customer_id) : null) || 
            (s.customer_name ? custNameMap.get(s.customer_name.toLowerCase().trim()) : null);

          const validName = (s.customerName && s.customerName.trim() && s.customerName !== 'Guest Customer' && s.customerName !== 'Guest')
            ? s.customerName.trim()
            : ((s.customer_name && s.customer_name.trim() && s.customer_name !== 'Guest Customer' && s.customer_name !== 'Guest')
                ? s.customer_name.trim()
                : null);

          const finalName = validName || matchedCust?.name || s.customerName || s.customer_name || 'Guest Customer';

          return {
            ...s,
            invoiceNo: s.invoice_no,
            customerName: finalName,
            customer_name: finalName,
            customerPhone: s.customerPhone || s.customer_phone || matchedCust?.phone || '',
            customerAddress: s.customerAddress || s.customer_address || matchedCust?.address || '',
            date: (() => {
              const d = new Date(s.created_at);
              if (isNaN(d.getTime())) return '';
              const yyyy = d.getFullYear();
              const mm = String(d.getMonth() + 1).padStart(2, '0');
              const dd = String(d.getDate()).padStart(2, '0');
              return `${yyyy}-${mm}-${dd}`;
            })(),
            total: s.total_amount 
          };
        });
        setOrders(mappedOrders);

        // Scan for overdue credits
        const overdue = mappedOrders.filter(
          (o: any) => o.status === 'Non Paid' && o.due_date && new Date(o.due_date) < new Date()
        );
        if (overdue.length > 0) {
          notify(
            t(
              `You have ${overdue.length} overdue credit orders! Please check the Credit tab to send WhatsApp reminders.`,
              `කල් ඉකුත් වූ ණය ඇණවුම් ${overdue.length} ක් ඇත! WhatsApp මතක් කිරීම් යැවීමට 'ණය' (Credit) ටැබ් එක පරීක්ෂා කරන්න.`
            ),
            t("Overdue Credits", "හිඟ ණය ඇඟවීම්"),
            "warning"
          );
        }
      }

      try {
        const qRes = await fetchWithTimeout(`${API_URL}/quotations`);
        if (qRes.ok) {
          const qJson = await qRes.json();
          setQuotes(qJson || []);
        } else {
          const { data: quotesData } = await supabase.from('quotations').select('*');
          if (quotesData) setQuotes(quotesData);
        }
      } catch (e) {
        const { data: quotesData } = await supabase.from('quotations').select('*');
        if (quotesData) setQuotes(quotesData);
      }

      try {
        const nRes = await fetchWithTimeout(`${API_URL}/quotations/next-number`);
        if (nRes.ok) {
          const nJson = await nRes.json();
          if (nJson.nextNumber) setQuoteNo(nJson.nextNumber);
        }
      } catch (e) {}

      const { data: dnData } = await supabase.from('delivery_notes').select('*');
      if (dnData) setDeliveryNotes(dnData);

      await fetchSalesReturns();
      await fetchCreditNotes();
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
      console.log(`[END] Sales Data Fetch & Sync - ${Date.now() - fetchStart}ms`);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    if (!window.confirm(t('Delete this sales record?', 'මෙම විකිණීම් වාර්තාව මකන්නද?'))) {
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.from('sales').delete().eq('id', orderId);
      if (error) throw error;
      setOrders((prev) => prev.filter((order) => order.id !== orderId));
      alert(t('Sales record deleted successfully.', 'විකිණීම් වාර්තාව සාර්ථකව මකා දමන ලදි.'));
    } catch (err: any) {
      alert(t('Failed to delete sales record: ', 'විකිණීම් වාර්තාව මකා ගැනීමට අසමත් විය: ') + (err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [tab]);

  // Download Sales Receipt PDF using the exact Preview design
  const downloadReceiptPDF = async (order: SaleOrder) => {
    if (!order) return;
    try {
      setIsLoading(true);

      let targetElement = document.getElementById('credit-preview-modal-content') || document.getElementById('receipt-preview');
      let tempContainer: HTMLElement | null = null;
      let root: any = null;

      if (!targetElement) {
        tempContainer = document.createElement('div');
        tempContainer.style.position = 'fixed';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '0';
        tempContainer.style.width = '672px';
        tempContainer.style.background = '#ffffff';
        tempContainer.style.zIndex = '-9999';
        document.body.appendChild(tempContainer);

        root = createRoot(tempContainer);
        root.render(<ReceiptPreview order={order} isSinhala={isSinhala} customers={customers} salesReturns={salesReturnsList} />);
        
        await new Promise((r) => setTimeout(r, 250));
        targetElement = tempContainer.querySelector('#receipt-preview') || tempContainer;
      }

      if (!targetElement) throw new Error('Failed to render receipt preview');

      const canvas = await html2canvas(targetElement as HTMLElement, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false
      });

      if (root && tempContainer) {
        root.unmount();
        if (document.body.contains(tempContainer)) {
          document.body.removeChild(tempContainer);
        }
      }

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = 190;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const xPos = (pdfWidth - imgWidth) / 2;

      if (imgHeight <= pdfHeight - 20) {
        pdf.addImage(imgData, 'PNG', xPos, 10, imgWidth, imgHeight);
      } else {
        let heightLeft = imgHeight;
        let position = 10;
        pdf.addImage(imgData, 'PNG', xPos, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;

        while (heightLeft > 0) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', xPos, position, imgWidth, imgHeight);
          heightLeft -= pdfHeight;
        }
      }

      const invNo = order.invoiceNo || order.invoice_no || 'Bill';
      const isCreditOrder = ((order.payment_method || '').toLowerCase() === 'credit' || order.status === 'Non Paid' || order.status === 'Partially Settled' || order.status === 'Fully Settled' || (order as any).is_credit);
      const pdfFileName = isCreditOrder ? `Credit_Statement_${invNo}.pdf` : `Invoice_${invNo}.pdf`;
      pdf.save(pdfFileName);
    } catch (err: any) {
      console.error("Failed to download receipt PDF:", err);
      alert(t("Failed to download receipt: ", "ඉන්වොයිසිය බාගත කිරීමට අපොහොසත් විය: ") + (err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  // Natively print beautiful receipts in selected language
  const handlePrintReceipt = (order: SaleOrder) => {
    const htmlContent = generatePrintHTML(order, isSinhala, shopSettings);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document || iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(htmlContent);
      doc.close();
    }

    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    }, 300);
  };

  // Download Quotation PDF using exact Preview layout and styling
  const handleDownloadQuotePDF = async (quote: any) => {
    if (!quote) return;
    try {
      setIsLoading(true);

      let targetElement = document.getElementById('quotation-preview-container');
      let tempContainer: HTMLElement | null = null;
      let root: any = null;

      if (!targetElement) {
        tempContainer = document.createElement('div');
        tempContainer.style.position = 'fixed';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '0';
        tempContainer.style.width = '750px';
        tempContainer.style.background = '#ffffff';
        tempContainer.style.zIndex = '-9999';
        document.body.appendChild(tempContainer);

        root = createRoot(tempContainer);
        root.render(<QuotationPreview quote={quote} isSinhala={isSinhala} shopSettings={shopSettings} />);
        
        await new Promise((r) => setTimeout(r, 250));
        targetElement = tempContainer.querySelector('#quotation-preview-container') || tempContainer;
      }

      if (!targetElement) throw new Error('Failed to render quotation preview');

      const canvas = await html2canvas(targetElement as HTMLElement, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false
      });

      if (root && tempContainer) {
        root.unmount();
        if (document.body.contains(tempContainer)) {
          document.body.removeChild(tempContainer);
        }
      }

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = 190;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const xPos = (pdfWidth - imgWidth) / 2;

      if (imgHeight <= pdfHeight - 20) {
        pdf.addImage(imgData, 'PNG', xPos, 10, imgWidth, imgHeight);
      } else {
        let heightLeft = imgHeight;
        let position = 10;
        pdf.addImage(imgData, 'PNG', xPos, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;

        while (heightLeft > 0) {
          position = heightLeft - imgHeight;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', xPos, position, imgWidth, imgHeight);
          heightLeft -= pdfHeight;
        }
      }

      pdf.save(`Quotation_${quote.quote_no || 'Draft'}.pdf`);
    } catch (err: any) {
      console.error('Failed to download quotation PDF:', err);
      alert(t('Failed to download quotation PDF: ', 'මිල ගණන් පත්‍රය PDF ලෙස බාගත කිරීමට අපොහොසත් විය: ') + (err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return [];
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || 
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
    );
  }, [products, productSearch]);

  const creditFilteredProducts = useMemo(() => {
    const q = creditProductSearch.trim().toLowerCase();
    if (!q) return [];
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || 
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
    );
  }, [products, creditProductSearch]);

  const allCatalogSelectables = useMemo(() => {
    const selectables: Array<{
      key: string;
      productId: string;
      displayName: string;
      mainProductName: string;
      subItemName?: string;
      category: string;
      price: number;
      unit: string;
      conversionRate: number;
      barcode?: string;
      sku?: string;
      isSubItem: boolean;
      stock: number;
    }> = [];

    (products || []).forEach((p: any) => {
      const mainPrice = Number(p.sellingPrice || p.price || 0);
      const mainUnit = p.unit || 'pcs';
      const mainCategory = p.category || 'General';

      selectables.push({
        key: `main_${p.id}`,
        productId: p.id,
        displayName: p.name,
        mainProductName: p.name,
        category: mainCategory,
        price: mainPrice,
        unit: mainUnit,
        conversionRate: 1,
        barcode: p.barcode || '',
        sku: p.sku || '',
        isSubItem: false,
        stock: Number(p.stock || 0)
      });

      const unitOpts = getUnitOptions(p);
      unitOpts.forEach((opt) => {
        if (opt.unit.toLowerCase() !== mainUnit.toLowerCase()) {
          selectables.push({
            key: `sub_${p.id}_${opt.unit}`,
            productId: p.id,
            displayName: `${p.name} (${opt.unit})`,
            mainProductName: p.name,
            subItemName: opt.unit,
            category: mainCategory,
            price: Number(opt.price) || (mainPrice / (opt.conversionRate || 1)),
            unit: opt.unit,
            conversionRate: Number(opt.conversionRate) || 1,
            barcode: p.barcode || '',
            sku: p.sku || '',
            isSubItem: true,
            stock: Number(p.stock || 0)
          });
        }
      });

      const explicitSubItems = Array.isArray(p.subItems) ? p.subItems : (Array.isArray(p.sub_items) ? p.sub_items : (Array.isArray(p.variants) ? p.variants : []));
      explicitSubItems.forEach((sub: any, sIdx: number) => {
        selectables.push({
          key: `explicit_sub_${p.id}_${sIdx}`,
          productId: p.id,
          displayName: `${p.name} - ${sub.name || sub.title || sub.unit || 'Sub-Item'}`,
          mainProductName: p.name,
          subItemName: sub.name || sub.title || sub.unit,
          category: mainCategory,
          price: Number(sub.price || sub.sellingPrice || mainPrice),
          unit: sub.unit || mainUnit,
          conversionRate: Number(sub.conversionRate || 1),
          barcode: sub.barcode || p.barcode || '',
          sku: sub.sku || p.sku || '',
          isSubItem: true,
          stock: Number(sub.stock || p.stock || 0)
        });
      });
    });

    return selectables;
  }, [products]);

  const matchingQuoteSelectables = useMemo(() => {
    const qStr = quoteSearch.trim().toLowerCase();
    if (!qStr) return allCatalogSelectables;
    return allCatalogSelectables.filter(item => 
      (item.barcode && item.barcode.trim().toLowerCase().includes(qStr)) ||
      item.mainProductName.toLowerCase().includes(qStr) ||
      item.displayName.toLowerCase().includes(qStr) ||
      (item.subItemName && item.subItemName.toLowerCase().includes(qStr)) ||
      (item.sku && item.sku.toLowerCase().includes(qStr))
    );
  }, [allCatalogSelectables, quoteSearch]);

  const matchingExchangeSelectables = useMemo(() => {
    const exQuery = exchangeProductSearch.trim().toLowerCase();
    return allCatalogSelectables.filter(item => {
      if (exchangeCategoryFilter !== 'All' && item.category.toLowerCase() !== exchangeCategoryFilter.toLowerCase()) {
        return false;
      }
      if (!exQuery) return true;
      return (
        (item.barcode && item.barcode.trim().toLowerCase().includes(exQuery)) ||
        item.mainProductName.toLowerCase().includes(exQuery) ||
        item.displayName.toLowerCase().includes(exQuery) ||
        (item.subItemName && item.subItemName.toLowerCase().includes(exQuery)) ||
        (item.sku && item.sku.toLowerCase().includes(exQuery))
      );
    });
  }, [allCatalogSelectables, exchangeProductSearch, exchangeCategoryFilter]);

  const addToCart = (product: Product) => {
    const stockAvailable = Number(product.stock) || 0;

    if (stockAvailable <= 0) {
      return alert(t("This item is currently out of stock!", "මෙම භාණ්ඩය දැනට තොගයේ නොමැත!"));
    }

    const options = getUnitOptions(product);
    const primaryOption = options[0] || { unit: product.unit, conversionRate: 1 };
    const initialRate = primaryOption.conversionRate;
    const initialUnit = primaryOption.unit;

    setCartItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      const currentCartQty = existing ? existing.qty : 0;
      const currentCartRate = existing ? (existing.conversionRate || 1) : initialRate;

      if (existing) {
        const existingBaseQty = currentCartQty / currentCartRate;
        const addedBaseQty = 1 / currentCartRate;

        if (existingBaseQty + addedBaseQty > stockAvailable) {
          const baseStockRemaining = Math.max(0, stockAvailable - existingBaseQty);
          const stockAvailableInSelectedUnit = baseStockRemaining * currentCartRate;
          alert(t(
            `Cannot add more. Only ${stockAvailableInSelectedUnit.toFixed(2)} ${existing.unit || product.unit}(s) available in stock!`,
            `වැඩිපුර එකතු කළ නොහැක. තොගයේ ඇත්තේ ${stockAvailableInSelectedUnit.toFixed(2)} ${existing.unit || product.unit} ක් පමණි!`
          ));
          return prev; 
        }

        return prev.map((i) =>
          i.productId === product.id ? { ...i, qty: i.qty + 1, total: (i.qty + 1) * i.price } : i
        );
      }
      
      const initialQty = 1;

      return [...prev, {
        productId: product.id, 
        productName: product.name, 
        qty: initialQty, 
        price: product.price, 
        taxRate: applyTax ? taxRate : 0, 
        total: initialQty * product.price,
        serialNo: product.serialNo || '',
        batchCode: product.batchCode || '',
        unit: initialUnit,
        conversionRate: initialRate,
        discount: 0,
        discountType: 'amount'
      }];
    });
    setProductSearch('');
  };

  const updateQty = (productId: string, newQty: number, forceValidate: boolean = false) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const item = cartItems.find(i => i.productId === productId);
    const conversionRate = item?.conversionRate || 1;
    const baseStock = Number(product.stock) || 0;
    const stockAvailableInSelectedUnit = Math.round((baseStock * conversionRate) * 100000) / 100000;
    
    let targetQty = newQty;

    if (forceValidate) {
      if (isNaN(targetQty) || targetQty < 1) {
        targetQty = 1;
      } else if (targetQty > stockAvailableInSelectedUnit) {
        alert(t(
          `Only ${stockAvailableInSelectedUnit} ${item?.unit || 'unit(s)'} available in stock!`,
          `තොගයේ ඇත්තේ ${stockAvailableInSelectedUnit} ${item?.unit || ''} ක් පමණි!`
        ));
        targetQty = stockAvailableInSelectedUnit;
      }
    } else {
      if (!isNaN(targetQty) && targetQty > stockAvailableInSelectedUnit) {
        alert(t(
          `Only ${stockAvailableInSelectedUnit} ${item?.unit || 'unit(s)'} available in stock!`,
          `තොගයේ ඇත්තේ ${stockAvailableInSelectedUnit} ${item?.unit || ''} ක් පමණි!`
        ));
        targetQty = stockAvailableInSelectedUnit;
      }
    }

    setCartItems((prev) => prev.map((i) => {
      if (i.productId === productId) {
        const price = i.price || 0;
        const disc = i.discount || 0;
        const discType = i.discountType || 'amount';
        const safeQtyForTotal = Math.max(0, targetQty);
        const gross = safeQtyForTotal * price;
        const discAmt = discType === 'percent' ? gross * (disc / 100) : disc;
        return { ...i, qty: targetQty, total: Math.max(0, gross - discAmt) };
      }
      return i;
    }));
  };

  const availableCustomerCreditNotes = React.useMemo(() => {
    if (!creditNotesList || creditNotesList.length === 0) return [];
    const custId = selectedCustomer?.id || '';
    const custName = (isGuest ? guestName : (selectedCustomer?.name || '')).trim().toLowerCase();
    const custPhone = (isGuest ? guestPhone : (selectedCustomer?.phone || '')).trim();

    return creditNotesList.filter((cn: any) => {
      const st = (cn.status || '').toLowerCase();
      if (st === 'fully used' || st === 'used' || st === 'voided') return false;
      const bal = Number(cn.balance_remaining !== undefined ? cn.balance_remaining : (cn.balanceRemaining !== undefined ? cn.balanceRemaining : cn.amount || 0));
      if (bal <= 0) return false;

      const cnId = (cn.customer_id || cn.customerId || '').toLowerCase();
      const cnName = (cn.customer_name || cn.customerName || '').toLowerCase();
      const cnPhone = (cn.customer_phone || cn.customerPhone || '').trim();

      if (custId && cnId === custId.toLowerCase()) return true;
      if (custName && custName !== 'guest customer' && cnName === custName) return true;
      if (custPhone && cnPhone && cnPhone === custPhone) return true;
      return false;
    });
  }, [creditNotesList, selectedCustomer, isGuest, guestName, guestPhone]);

  const totalAvailableCreditNoteBalance = React.useMemo(() => {
    return availableCustomerCreditNotes.reduce((sum, cn: any) => {
      const bal = Number(cn.balance_remaining !== undefined ? cn.balance_remaining : (cn.balanceRemaining !== undefined ? cn.balanceRemaining : cn.amount || 0));
      return sum + bal;
    }, 0);
  }, [availableCustomerCreditNotes]);

  const matchedCreditNote = React.useMemo(() => {
    if (!selectedCreditNoteCode.trim()) return null;
    const q = selectedCreditNoteCode.trim().toLowerCase();
    return creditNotesList.find((cn: any) => {
      const code = (cn.credit_note_no || cn.code || cn.id || '').toLowerCase();
      const cnNo = (cn.creditNoteNo || '').toLowerCase();
      return (code === q || cnNo === q);
    }) || null;
  }, [selectedCreditNoteCode, creditNotesList]);

  const activeCreditBalance = React.useMemo(() => {
    if (matchedCreditNote) {
      const origVal = Number(matchedCreditNote.amount !== undefined ? matchedCreditNote.amount : (matchedCreditNote.value || 0));
      return Number(matchedCreditNote.balance_remaining !== undefined ? matchedCreditNote.balance_remaining : (matchedCreditNote.balanceRemaining !== undefined ? matchedCreditNote.balanceRemaining : origVal));
    }
    return totalAvailableCreditNoteBalance;
  }, [matchedCreditNote, totalAvailableCreditNoteBalance]);

  const grossSubtotal = cartItems.reduce((sum, i) => sum + ((Number(i.price) || 0) * (Number(i.qty) || 0)), 0);
  const totalProductDiscounts = cartItems.reduce((sum, i) => {
    const discType = i.discountType || 'percent';
    const gross = (Number(i.price) || 0) * (Number(i.qty) || 0);
    const discVal = Number(i.discount) || 0;
    const discAmt = discType === 'percent' ? gross * (discVal / 100) : discVal;
    return sum + discAmt;
  }, 0);
  const subtotal = grossSubtotal;
  const discountAmt = totalProductDiscounts;
  const taxAmt = applyTax ? Math.max(0, subtotal - discountAmt) * (taxRate / 100) : 0;
  const netTotalBeforeCreditNote = Math.max(0, subtotal - discountAmt + taxAmt + (Number(transportationFee) || 0));
  const numCreditNoteApplied = Math.min(
    Math.max(0, activeCreditBalance),
    Math.min(Number(creditNoteApplied || 0), netTotalBeforeCreditNote)
  );
  const totalAmountValue = Math.max(0, netTotalBeforeCreditNote - numCreditNoteApplied);
  const remainingCNBalanceAfterSale = Math.max(0, activeCreditBalance - numCreditNoteApplied);

  // Automatically populate credit note price/amount when credit note code is entered/scanned
  useEffect(() => {
    if (!selectedCreditNoteCode.trim()) return;
    const q = selectedCreditNoteCode.trim().toUpperCase();
    const found = creditNotesList.find((c: any) => {
      const code = (c.credit_note_no || c.code || c.id || '').toUpperCase();
      const st = (c.status || '').toLowerCase();
      const isNotFullyUsed = st !== 'fully used' && st !== 'used' && st !== 'voided';
      return code === q && isNotFullyUsed;
    });
    if (found) {
      const origVal = Number(found.amount !== undefined ? found.amount : (found.value || 0));
      const bal = Number(found.balance_remaining !== undefined ? found.balance_remaining : (found.balanceRemaining !== undefined ? found.balanceRemaining : origVal));
      if (bal > 0) {
        const autoAmount = netTotalBeforeCreditNote > 0 ? Math.min(bal, netTotalBeforeCreditNote) : bal;
        setCreditNoteApplied(autoAmount);
      }
    }
  }, [selectedCreditNoteCode, creditNotesList, netTotalBeforeCreditNote]);

  const processSale = async () => {
    if (isLoading) return;

    if ((!isGuest && !selectedCustomer) || cartItems.length === 0) {
        return alert(t("Please select a customer or use Guest Checkout", "කරුණාකර පාරිභෝගිකයෙකු තෝරන්න හෝ අමුත්තන්ගේ පරීක්ෂාව භාවිතා කරන්න"));
    }

    if (cartItems.some(i => i.qty <= 0)) {
        return alert(t("Please enter a valid quantity greater than 0 for all items.", "කරුණාකර සියලුම භාණ්ඩ සඳහා 0 ට වැඩි වලංගු ප්‍රමාණයක් ඇතුළත් කරන්න."));
    }

    // Strict Credit Note Validation
    if (numCreditNoteApplied > 0 && selectedCreditNoteCode.trim()) {
      const q = selectedCreditNoteCode.trim().toUpperCase();
      const targetCN = creditNotesList.find((c: any) => (c.credit_note_no || c.code || c.id || '').toUpperCase() === q);

      if (!targetCN) {
        return alert(t(`Credit Note code ${selectedCreditNoteCode} not found in system.`, `ණය සටහන් අංකය ${selectedCreditNoteCode} පද්ධතියේ හමු නොවීය.`));
      }

      const origVal = Number(targetCN.amount !== undefined ? targetCN.amount : (targetCN.value || 0));
      const availBal = Number(targetCN.balance_remaining !== undefined ? targetCN.balance_remaining : (targetCN.balanceRemaining !== undefined ? targetCN.balanceRemaining : origVal));
      const st = (targetCN.status || '').toLowerCase();

      if (st === 'fully used' || st === 'used' || st === 'voided' || availBal <= 0) {
        return alert(t(`Credit Note ${selectedCreditNoteCode} is fully used or voided (Available Balance: Rs. 0.00).`, `ණය සටහන් අංකය ${selectedCreditNoteCode} සම්පූර්ණයෙන්ම භාවිතා කර ඇත.`));
      }

      if (numCreditNoteApplied > availBal + 0.001) {
        return alert(t(`Credit Note balance is only Rs. ${availBal.toLocaleString()}. You cannot apply Rs. ${numCreditNoteApplied.toLocaleString()}.`, `ණය සටහනේ ඉතිරි ශේෂය රු. ${availBal.toLocaleString()} කි. ඔබට රු. ${numCreditNoteApplied.toLocaleString()} භාවිතා කළ නොහැක.`));
      }
    }

    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const finalCustomerName = isGuest 
        ? (guestName.trim() && guestName.trim() !== 'Guest Customer' ? guestName.trim() : 'Guest Customer')
        : (selectedCustomer?.name || (guestName.trim() && guestName.trim() !== 'Guest Customer' ? guestName.trim() : 'Guest Customer'));
      const finalCustomerPhone = isGuest ? guestPhone.trim() : (selectedCustomer?.phone || '');
      const finalCustomerAddress = isGuest ? guestAddress.trim() : (selectedCustomer?.address || '');

      const activeCNCode = selectedCreditNoteCode || (availableCustomerCreditNotes[0]?.credit_note_no || availableCustomerCreditNotes[0]?.code || '');

      const newOrderData = {
        invoice_no: `INV-${Date.now()}`,
        customer_id: isGuest ? null : selectedCustomer?.id, 
        customer_name: finalCustomerName,
        customer_phone: finalCustomerPhone,
        customer_address: finalCustomerAddress,
        items: cartItems,
        subtotal,
        discount: discountAmt,
        tax: taxAmt,
        tax_rate: applyTax ? taxRate : 0, 
        total_amount: totalAmountValue,
        status: paymentMethod === 'Credit' ? 'Non Paid' : 'paid',
        payment_method: paymentMethod,
        user_id: user?.id,
        user_email: user?.email || 'system',
        due_date: paymentMethod === 'Credit' ? calculateDueDate(creditPeriodDays) : null,
        credit_period_days: paymentMethod === 'Credit' ? creditPeriodDays : 0,
        transportation_fee: Number(transportationFee) || 0,
        credit_note_applied: numCreditNoteApplied,
        credit_note_code: activeCNCode
      };

      const { data: saleRecord, error: saleError } = await supabase.from('sales').insert([newOrderData]).select().single();
      if (saleError && !saleRecord) {
        console.warn("Supabase sale insert notice:", saleError);
      }

      // Note: SQLite backend handles product stock levels automatically, 
      // but let's notify supabaseClient of sync so local caching updates.
      for (const item of cartItems) {
        const product = products.find(p => p.id === item.productId);
        if (product) {
          const convRate = item.conversionRate || 1;
          const decr = convRate > 0 ? (item.qty / convRate) : item.qty;
          await supabase.from('products').update({ stock: Math.max(0, product.stock - decr) }).eq('id', item.productId);
        }
      }

      const completedOrder: SaleOrder = {
        id: saleRecord?.id || `so_${Date.now()}`,
        invoiceNo: saleRecord?.invoice_no || saleRecord?.invoiceNo || newOrderData.invoice_no,
        customer_id: newOrderData.customer_id || '',
        customerName: finalCustomerName,
        customer_name: finalCustomerName,
        customerPhone: finalCustomerPhone,
        customer_phone: finalCustomerPhone,
        customerAddress: finalCustomerAddress,
        customer_address: finalCustomerAddress,
        cashier: user?.email || 'system',
        date: new Date().toLocaleDateString(),
        items: cartItems,
        created_at: saleRecord?.created_at || new Date().toISOString(),
        subtotal: subtotal,
        discount: discountAmt,
        tax: taxAmt,
        tax_rate: newOrderData.tax_rate,
        total: totalAmountValue,
        total_amount: totalAmountValue,
        status: (paymentMethod === 'Credit' ? 'Non Paid' : 'paid') as any,
        due_date: newOrderData.due_date || undefined,
        credit_period_days: newOrderData.credit_period_days,
        payment_method: paymentMethod,
        transportation_fee: Number(transportationFee) || 0,
        transportationFee: Number(transportationFee) || 0,
        credit_note_applied: numCreditNoteApplied,
        creditNoteApplied: numCreditNoteApplied,
        credit_note_code: activeCNCode,
        creditNoteCode: activeCNCode
      };
      setLastOrder(completedOrder);
      setShowReceipt(true);
      resetNewSale();
      fetchData(); 
      fetchCreditNotes();
    } catch (error: any) {
      alert("Sale failed: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleHoldBill = async (holdName: string) => {
    if (cartItems.length === 0) return;
    if (cartItems.some(i => i.qty <= 0)) {
        return alert(t("Please enter a valid quantity greater than 0 for all items.", "කරුණාකර සියලුම භාණ්ඩ සඳහා 0 ට වැඩි වලංගු ප්‍රමාණයක් ඇතුළත් කරන්න."));
    }
    try {
      setIsLoading(true);
      const holdId = 'hb_' + Date.now();
      const payload = {
        id: holdId,
        hold_name: holdName || `Hold #${Date.now().toString().slice(-4)}`,
        customer_id: isGuest ? null : selectedCustomer?.id,
        customer_name: isGuest ? guestName : selectedCustomer?.name || 'Guest Customer',
        items: JSON.stringify(cartItems),
        subtotal: subtotal,
        discount: discountAmt,
        tax: taxAmt,
        total_amount: totalAmountValue
      };
      
      const { error } = await supabase.from('bill_holds').insert([payload]);
      if (error) throw error;
      
      alert(t("Bill put on hold successfully!", "බිල්පත තාවකාලිකව රඳවා ගන්නා ලදී!"));
      resetNewSale();
      setHoldNameInput('');
      setShowHoldNameModal(false);
      fetchHeldBills();
    } catch (e: any) {
      alert("Failed to hold bill: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchHeldBills = async () => {
    try {
      const { data } = await supabase.from('bill_holds').select('*');
      if (data) setHeldBills(data);
    } catch (e) {
      console.error("Failed to fetch held bills:", e);
    }
  };

  const handleRetrieveHoldBill = async (hold: any) => {
    try {
      setIsLoading(true);
      const items = JSON.parse(hold.items);
      setCartItems(items);
      
      if (hold.customer_id) {
        const cust = customers.find(c => c.id === hold.customer_id);
        if (cust) {
          setSelectedCustomer(cust);
          setIsGuest(false);
        }
      } else if (hold.customer_name && hold.customer_name !== 'Guest Customer') {
        setIsGuest(true);
        setGuestName(hold.customer_name);
      } else {
        setIsGuest(false);
        setSelectedCustomer(null);
      }
      
      const discPercent = hold.subtotal > 0 ? (hold.discount / hold.subtotal) * 100 : 0;
      setDiscount(Math.round(discPercent));
      
      await supabase.from('bill_holds').delete().eq('id', hold.id);
      setShowHeldBillsModal(false);
    } catch (e: any) {
      alert("Failed to retrieve hold bill: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoidOrder = async (orderId: string) => {
    if (!window.confirm(t("Are you sure you want to void this invoice? This will restore product stock levels and cancel the sale transaction.", "මෙම ඉන්වොයිසිය අවලංගු කිරීමට ඔබට විශ්වාසද? මෙමඟින් නිෂ්පාදන තොග මට්ටම් නැවත යථා තත්ත්වයට පත් කර විකුණුම් ගනුදෙනුව අවලංගු කරනු ඇත."))) {
      return;
    }
    try {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      const userEmail = user?.email || 'sanojhardware@gmail.com';
      
      const res = await fetchWithTimeout(`${API_URL}/sales/${orderId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: userEmail })
      });
      
      if (res.ok) {
        alert(t("Invoice voided successfully!", "ඉන්වොයිසිය සාර්ථකව අවලංගු කරන ලදී!"));
        fetchData();
      } else {
        const err = await res.json();
        alert("Failed to void invoice: " + err.error);
      }
    } catch (e: any) {
      alert("Void invoice error: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoidSalesReturn = async (returnId: string) => {
    try {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      const res = await fetchWithTimeout(`${API_URL}/sales/returns/${returnId}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: user?.email || 'system' })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to void sales return');
      }
      alert(t('Sales Return voided successfully!', 'ආපසු භාරගැනීම සාර්ථකව අවලංගු කරන ලදී!'));
      fetchSalesReturns();
      fetchData();
    } catch (err: any) {
      alert(t('Failed to void return: ', 'අවලංගු කිරීමට නොහැකි විය: ') + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSalesReturn = async (returnId: string) => {
    if (!window.confirm(t('Are you sure you want to delete this sales return bill? This action cannot be undone.', 'මෙම ආපසු භාරගැනීමේ රසීදුව මකා දැමීමට ඔබට විශ්වාසද? මෙම ක්‍රියාව ආපසු හැරවිය නොහැක.'))) {
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetchWithTimeout(`${API_URL}/sales/returns/${returnId}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to delete sales return bill');
      }

      try {
        await supabase.from('sales_returns').delete().eq('id', returnId);
      } catch (e) {}

      setSalesReturnsList((prev) => prev.filter((sr) => sr.id !== returnId));
      if (selectedReturnPreview && selectedReturnPreview.id === returnId) {
        setShowReturnPreviewModal(false);
        setSelectedReturnPreview(null);
      }
      alert(t('Sales Return bill deleted successfully!', 'ආපසු භාරගැනීමේ රසීදුව සාර්ථකව මකා දමන ලදී!'));
      fetchSalesReturns();
      fetchData();
    } catch (err: any) {
      alert(t('Failed to delete sales return: ', 'ආපසු භාරගැනීම මකා දැමීමට නොහැකි විය: ') + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const normalizeStatus = (status?: string) => (status || '').toLowerCase();
  
  const filteredOrders = useMemo(() => {
    const search = historySearch.toLowerCase().trim();
    const targetStatus = statusFilter.toLowerCase();
    return orders.filter((o) => {
      const matchSearch = !search || 
                          (o.invoiceNo || '').toLowerCase().includes(search) || 
                          (o.customerName || '').toLowerCase().includes(search);
      const matchStatus = statusFilter === 'all' || normalizeStatus(o.status) === targetStatus;
      
      const sDate = o.created_at ? o.created_at.slice(0, 10) : (o.date || '').slice(0, 10);
      const matchDate = (!salesHistoryFromDate || sDate >= salesHistoryFromDate) && 
                        (!salesHistoryToDate || sDate <= salesHistoryToDate);

      return matchSearch && matchStatus && matchDate;
    });
  }, [orders, historySearch, statusFilter, salesHistoryFromDate, salesHistoryToDate]);

  const isCreditOrder = (o: SaleOrder) => 
    o.payment_method === 'Credit' || 
    (o as any).is_credit === true || 
    (o.status === 'Non Paid' && o.payment_method !== 'Cash' && o.payment_method !== 'Card' && o.payment_method !== 'Bank Transfer');

  const creditOrders = useMemo(() => orders.filter((o) => isCreditOrder(o)), [orders]);

  



  const filteredCreditOrders = useMemo(() => {
    const query = creditSearchQuery.toLowerCase().trim();
    return orders.filter(o => {
      if (!isCreditOrder(o)) return false;
      
      const sDate = o.created_at ? o.created_at.slice(0, 10) : (o.date || '').slice(0, 10);
      const matchDate = (!creditHistoryFromDate || sDate >= creditHistoryFromDate) && 
                        (!creditHistoryToDate || sDate <= creditHistoryToDate);
      
      const matchSearch = !query || 
        (o.invoiceNo || '').toLowerCase().includes(query) || 
        (o.customerName || '').toLowerCase().includes(query) || 
        (o.items && o.items.some((it: any) => (it.productName || it.name || '').toLowerCase().includes(query)));
      
      return matchDate && matchSearch;
    });
  }, [orders, creditHistoryFromDate, creditHistoryToDate, creditSearchQuery]);

  const creditSubFiltered = useMemo(() => {
    const now = new Date();
    return filteredCreditOrders.filter(o => {
      const isOverdue = o.status === 'Non Paid' && o.due_date && new Date(o.due_date) < now;
      if (creditSubView === 'unpaid') return o.status === 'Non Paid';
      if (creditSubView === 'overdue') return isOverdue;
      if (creditSubView === 'paid') return o.status === 'Paid';
      return true;
    });
  }, [filteredCreditOrders, creditSubView]);

  const unpaidCreditOrders = useMemo(() => creditOrders.filter(o => o.status === 'Non Paid'), [creditOrders]);
  const paidCreditOrders = useMemo(() => creditOrders.filter(o => o.status === 'Paid'), [creditOrders]);
  const totalOutstanding = useMemo(() => unpaidCreditOrders.reduce((sum, o) => sum + (o.total || 0), 0), [unpaidCreditOrders]);
  const overdueCreditOrders = useMemo(() => {
    const now = new Date();
    return unpaidCreditOrders.filter(o => o.due_date && new Date(o.due_date) < now);
  }, [unpaidCreditOrders]);
  const totalOverdue = useMemo(() => overdueCreditOrders.reduce((sum, o) => sum + (o.total || 0), 0), [overdueCreditOrders]);
  const totalCollected = useMemo(() => paidCreditOrders.reduce((sum, o) => sum + (o.total || 0), 0), [paidCreditOrders]);
  const totalCreditVolume = totalOutstanding + totalCollected;
  const collectionRate = totalCreditVolume > 0 ? (totalCollected / totalCreditVolume) * 100 : 0;

  const grossCreditSubtotal = creditCartItems.reduce((sum, item) => sum + (item.qty * item.price), 0);
  const creditTotalDiscount = creditCartItems.reduce((sum, item) => {
    const gross = item.qty * item.price;
    const disc = item.discount || 0;
    const discType = item.discountType || 'amount';
    const discAmt = discType === 'percent' ? gross * (disc / 100) : disc;
    return sum + discAmt;
  }, 0);
  const creditSubtotal = Math.max(0, grossCreditSubtotal - creditTotalDiscount);
  const creditTaxAmt = applyTax ? creditSubtotal * (creditTaxRate / 100) : 0;
  const creditTotal = creditSubtotal + creditTaxAmt + (Number(creditTransportationFee) || 0);

  const allFilteredSelected = filteredOrders.length > 0 && filteredOrders.every((order) => selectedHistoryIds.includes(order.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedHistoryIds((prev) => prev.filter((id) => !filteredOrders.some((order) => order.id === id)));
    } else {
      setSelectedHistoryIds((prev) => Array.from(new Set([...prev, ...filteredOrders.map((order) => order.id)])));
    }
  };

  const handleToggleSelectOrder = (orderId: string) => {
    setSelectedHistoryIds((prev) => prev.includes(orderId)
      ? prev.filter((id) => id !== orderId)
      : [...prev, orderId]
    );
  };

  const handleBulkDeleteOrders = async () => {
    if (selectedHistoryIds.length === 0) return;

    if (!window.confirm(t('Delete selected sales records?', 'තෝරාගත් විකිණීම් වාර්තා මකා දමන්නද?'))) {
      return;
    }

    setIsLoading(true);
    try {
      const results = await Promise.all(
        selectedHistoryIds.map((orderId) => supabase.from('sales').delete().eq('id', orderId))
      );
      const firstError = results.find((result: any) => result?.error);
      if (firstError) throw firstError.error;
      setOrders((prev) => prev.filter((order) => !selectedHistoryIds.includes(order.id)));
      setSelectedHistoryIds([]);
      alert(t('Selected sales records deleted successfully.', 'තෝරාගත් විකිණීම් වාර්තා සාර්ථකව මකා දමන ලදි.'));
    } catch (err: any) {
      alert(t('Failed to delete selected sales records: ', 'තෝරාගත් විකිණීම් වාර්තා මකා ගැනීමට අසමත් විය: ') + (err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  const allCreditSelected = creditSubFiltered.length > 0 && creditSubFiltered.every((order) => selectedCreditIds.includes(order.id));

  const handleToggleSelectAllCredit = () => {
    if (allCreditSelected) {
      setSelectedCreditIds((prev) => prev.filter((id) => !creditSubFiltered.some((order) => order.id === id)));
    } else {
      setSelectedCreditIds((prev) => Array.from(new Set([...prev, ...creditSubFiltered.map((order) => order.id)])));
    }
  };

  const handleToggleSelectCreditOrder = (orderId: string) => {
    setSelectedCreditIds((prev) => prev.includes(orderId)
      ? prev.filter((id) => id !== orderId)
      : [...prev, orderId]
    );
  };

  const handleBulkDeleteCreditOrders = async () => {
    if (selectedCreditIds.length === 0) return;

    if (!window.confirm(t('Delete selected credit orders?', 'තෝරාගත් ණය ඇණවුම් මකා දමන්නද?'))) {
      return;
    }

    setIsLoading(true);
    try {
      const results = await Promise.all(
        selectedCreditIds.map((orderId) => supabase.from('sales').delete().eq('id', orderId))
      );
      const firstError = results.find((result: any) => result?.error);
      if (firstError) throw firstError.error;
      setOrders((prev) => prev.filter((order) => !selectedCreditIds.includes(order.id)));
      setSelectedCreditIds([]);
      alert(t('Selected credit orders deleted successfully.', 'තෝරාගත් ණය ඇණවුම් සාර්ථකව මකා දමන ලදි.'));
    } catch (err: any) {
      alert(t('Failed to delete selected credit orders: ', 'තෝරාගත් ණය ඇණවුම් මකා ගැනීමට අසමත් විය: ') + (err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAllCreditOrders = async () => {
    if (creditOrders.length === 0) return;

    if (!window.confirm(t('Delete all credit orders?', 'සියලුම ණය ඇණවුම් මකා දමන්නද?'))) {
      return;
    }

    setIsLoading(true);
    try {
      const results = await Promise.all(
        creditOrders.map((order) => supabase.from('sales').delete().eq('id', order.id))
      );
      const firstError = results.find((result: any) => result?.error);
      if (firstError) throw firstError.error;
      setOrders((prev) => prev.filter((order) => order.status !== 'Non Paid' && order.status !== 'Paid'));
      setSelectedCreditIds([]);
      alert(t('All credit orders deleted successfully.', 'සියලුම ණය ඇණවුම් සාර්ථකව මකා දමන ලදි.'));
    } catch (err: any) {
      alert(t('Failed to delete all credit orders: ', 'සියලුම ණය ඇණවුම් මකා ගැනීමට අසමත් විය: ') + (err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 animate-in fade-in duration-500">
      {/* Header Tabs & Bilingual Switcher */}
      <div className="flex justify-between items-center flex-wrap gap-4 bg-white/95 backdrop-blur-sm p-4 rounded-3xl border border-slate-200/80 shadow-xl shadow-slate-100/30 animate-in fade-in duration-500">
        <div className="flex gap-1.5 bg-slate-100/60 p-1.5 rounded-2xl w-fit border border-slate-200/40 overflow-x-auto max-w-full custom-scrollbar">
          <button 
            onClick={() => {
              resetNewSale();
              setTab('new');
            }} 
            className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${tab === 'new' ? 'bg-slate-900 text-amber-400 shadow-lg shadow-slate-900/25 border border-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/40'}`}
          >
            <ShoppingCartIcon className="w-4 h-4" />
            {t('New Sale', 'නව විකිණීම')}
          </button>
          {userRole !== 'cashier' && (
            <button 
              onClick={() => setTab('history')} 
              className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
                tab === 'history' 
                  ? 'bg-slate-900 text-amber-400 shadow-lg shadow-slate-900/25 border border-slate-800' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/40'
              }`}
            >
              <ReceiptIcon className="w-4 h-4" />
              {t('Sales History', 'විකිණුම් ඉතිහාසය')}
            </button>
          )}
          <button 
            onClick={() => setTab('credit')} 
            className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${tab === 'credit' ? 'bg-slate-900 text-amber-400 shadow-lg shadow-slate-900/25 border border-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/40'}`}
          >
            <DollarSignIcon className="w-4 h-4" />
            {t('Credit', 'ණය')}
          </button>
          <button 
            onClick={() => setTab('credit_history')} 
            className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${tab === 'credit_history' ? 'bg-slate-900 text-amber-400 shadow-lg shadow-slate-900/25 border border-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/40'}`}
          >
            <HistoryIcon className="w-4 h-4" />
            {t('Credit History', 'ණය ඉතිහාසය')}
          </button>
          <button 
            onClick={() => setTab('quotes')} 
            className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${tab === 'quotes' ? 'bg-slate-900 text-amber-400 shadow-lg shadow-slate-900/25 border border-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/40'}`}
          >
            <CheckSquareIcon className="w-4 h-4" />
            {t('Quotations', 'මිල ගණන්')}
          </button>
          <button 
            onClick={() => { setTab('returns'); fetchSalesReturns(); }} 
            className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${tab === 'returns' ? 'bg-slate-900 text-amber-400 shadow-lg shadow-slate-900/25 border border-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/40'}`}
          >
            <ArrowRightIcon className="w-4 h-4 rotate-180 text-amber-500" />
            {t('Sales Returns', 'ආපසු භාරගැනීම්')}
          </button>
        </div>

        <div className="flex gap-1 bg-slate-100/60 p-1.5 rounded-2xl w-fit border border-slate-200/40">
          <button 
            onClick={() => setIsSinhala(false)} 
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${!isSinhala ? 'bg-slate-900 text-amber-400 shadow-md border border-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/40'}`}
          >
            🇺🇸 English
          </button>
          <button 
            onClick={() => setIsSinhala(true)} 
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1.5 ${isSinhala ? 'bg-slate-900 text-amber-400 shadow-md border border-slate-800' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/40'}`}
          >
            🇱🇰 සිංහල
          </button>
        </div>
      </div>

      {tab === 'new' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-in fade-in duration-300">
          <div className="xl:col-span-2 space-y-5">
            
            {/* Customer Details Block */}
            <div className="bg-white rounded-2xl border-l-4 border-l-amber-500 border-y border-r border-slate-100 shadow-xl shadow-slate-100/40 p-6 text-left hover:shadow-2xl hover:shadow-slate-200/40 transition-all duration-300 transform hover:-translate-y-0.5">
              <div className="flex justify-between items-center mb-5 flex-wrap gap-3">
                <h3 className="text-sm font-black text-slate-800 flex items-center gap-2.5 uppercase tracking-wider">
                  <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center border border-amber-100/60 shadow-sm">
                    <UserIcon className="w-4 h-4 text-amber-500" />
                  </div>
                  {t('Customer Details', 'පාරිභෝගික විස්තර')}
                </h3>
                
                {/* Modern Segmented pill toggle control */}
                <div className="flex bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/30 shadow-inner">
                  <button
                    type="button"
                    onClick={() => {
                      setIsGuest(false);
                      setSelectedCustomer(null);
                    }}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 flex items-center gap-1 ${!isGuest ? 'bg-slate-900 text-amber-400 shadow-md border border-slate-800' : 'text-slate-400 hover:text-slate-700'}`}
                  >
                    {t('Registered', 'ලියාපදිංචි')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsGuest(true);
                      setSelectedCustomer(null);
                    }}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 flex items-center gap-1 ${isGuest ? 'bg-slate-900 text-amber-400 shadow-md border border-slate-800' : 'text-slate-400 hover:text-slate-700'}`}
                  >
                    {t('Guest', 'අමුත්තා')}
                  </button>
                </div>
              </div>

              {!isGuest ? (
                <div className="relative">
                  <select 
                    value={selectedCustomer?.id || ''} 
                    onChange={(e) => setSelectedCustomer(customers.find((c) => c.id === e.target.value) || null)} 
                    className="w-full px-4 py-3.5 bg-slate-50/50 hover:bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 cursor-pointer transition-all duration-200 appearance-none shadow-sm"
                  >
                    <option value="">{t('Select a registered customer...', 'ලියාපදිංචි පාරිභෝගිකයෙකු තෝරන්න...')}</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.phone}
                      </option>
                    ))}
                  </select>
                  <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-400">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 animate-in slide-in-from-top-2 duration-300">
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1 block">{t('Guest Name (Optional)', 'අමුත්තාගේ නම (විකල්ප)')}</label>
                    <input 
                      type="text" 
                      value={guestName === 'Guest Customer' ? '' : guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      placeholder={t('Enter Guest Name...', 'අමුත්තාගේ නම ඇතුළත් කරන්න...')}
                      className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all duration-200 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1 block">{t('Phone Number (Optional)', 'දුරකථන අංකය (විකල්ප)')}</label>
                    <input 
                      type="text" 
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      placeholder={t('Enter Phone Number...', 'දුරකථන අංකය ඇතුළත් කරන්න...')}
                      className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all duration-200 shadow-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1 block">{t('Address (Optional)', 'ලිපිනය (විකල්ප)')}</label>
                    <input 
                      type="text" 
                      value={guestAddress}
                      onChange={(e) => setGuestAddress(e.target.value)}
                      placeholder={t('Enter Address...', 'ලිපිනය ඇතුළත් කරන්න...')}
                      className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all duration-200 shadow-sm"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Inventory Search & Cart */}
            <div className="bg-white rounded-2xl border-l-4 border-l-amber-500 border-y border-r border-slate-100 shadow-xl shadow-slate-100/40 p-6 text-left hover:shadow-2xl hover:shadow-slate-200/40 transition-all duration-300 transform hover:-translate-y-0.5">
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-sm font-black text-slate-800 flex items-center gap-2.5 uppercase tracking-wider">
                  <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center border border-amber-100/60 shadow-sm">
                    <ShoppingCartIcon className="w-4 h-4 text-amber-500" />
                  </div>
                  {t('Inventory Search & Items', 'තොග සෙවීම සහ භාණ්ඩ')}
                </h3>
                {cartItems.length > 0 && (
                  <button
                    type="button"
                    onClick={resetNewSale}
                    className="text-[10px] font-black uppercase tracking-wider text-rose-600 bg-rose-50 hover:bg-rose-100 px-3.5 py-2 rounded-xl transition-all border border-rose-200/60 shadow-sm flex items-center gap-1.5 active:scale-95"
                  >
                    <Trash2Icon className="w-3.5 h-3.5" />
                    {t('Clear Cart / New Order', 'කාට් එක හිස් කරන්න / අලුත් ඇණවුමක්')}
                  </button>
                )}
              </div>
              
              <div className="relative">
                <div className="flex items-center gap-3 bg-slate-50/50 hover:bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500 transition-all duration-200 shadow-inner">
                  <SearchIcon className="w-5 h-5 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder={t('Search hardware by name, SKU or barcode...', 'නම, SKU හෝ බාර්කෝඩ් මඟින් සොයන්න...')} 
                    value={productSearch} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setProductSearch(val);
                      setSelectedIndex(0);
                      // Auto-add if exact barcode match
                      if (val.trim()) {
                        const exactBarcode = products.find(p => p.barcode && p.barcode.trim().toLowerCase() === val.trim().toLowerCase());
                        if (exactBarcode) {
                          addToCart(exactBarcode);
                          setProductSearch('');
                        }
                      }
                    }} 
                    onKeyDown={(e) => {
                      if (filteredProducts.length === 0) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSelectedIndex((prev) => (prev + 1) % filteredProducts.length);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSelectedIndex((prev) => (prev - 1 + filteredProducts.length) % filteredProducts.length);
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        const selected = filteredProducts[selectedIndex] || filteredProducts[0];
                        if (selected) {
                          addToCart(selected);
                          setProductSearch('');
                          setSelectedIndex(0);
                        }
                      }
                    }}
                    className="bg-transparent text-sm font-bold text-slate-800 outline-none w-full placeholder-slate-400" 
                  />
                  {productSearch && (
                    <button type="button" onClick={() => setProductSearch('')} className="p-1 hover:bg-slate-200 rounded-full text-slate-400 transition-colors">
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                
                {/* Search Results Dropdown */}
                {filteredProducts.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-2xl shadow-2xl z-[100] max-h-64 overflow-y-auto divide-y divide-slate-100/60 animate-in slide-in-from-top-3 duration-300">
                    {filteredProducts.map((p, index) => {
                      const stockLevel = p.stock;
                      let stockBadge = "bg-emerald-50 text-emerald-600 border border-emerald-100/80";
                      if (stockLevel <= 0) {
                        stockBadge = "bg-rose-50 text-rose-600 border border-rose-100/80";
                      } else if (stockLevel <= 10) {
                        stockBadge = "bg-amber-50 text-amber-600 border border-amber-100/80";
                      }

                      return (
                        <button 
                          key={p.id} 
                          onClick={() => { addToCart(p); setProductSearch(''); setSelectedIndex(0); }} 
                          className={`w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors text-left ${index === selectedIndex ? 'bg-amber-50/80 border-l-4 border-amber-500' : ''}`}
                        >
                          <div className="space-y-1">
                            <p className="text-sm font-black text-slate-800">{p.name}</p>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">SKU: {p.sku || 'N/A'}</span>
                              <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg ${stockBadge}`}>
                                {t('Stock', 'තොගය')}: {formatStock(p.stock, p.unit)} {p.unit}
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-black text-amber-500">{symbol} {convert(p.price).toLocaleString()}</span>
                            <span className="block text-[8px] text-slate-400 font-bold mt-0.5">{t('Click to add', 'එකතු කිරීමට ක්ලික් කරන්න')}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              
              {/* Cart Items Table */}
              {cartItems.length > 0 && (
                <div className="mt-6 overflow-hidden rounded-2xl border border-slate-100 shadow-md">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="px-5 py-3.5 text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Product', 'භාණ්ඩය')}</th>
                          <th className="px-4 py-3.5 text-center text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Quantity', 'ප්‍රමාණය')}</th>
                          <th className="px-4 py-3.5 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Price', 'මිල')}</th>
                          <th className="px-3 py-3.5 text-center text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Discount', 'වට්ටම්')}</th>
                          <th className="px-4 py-3.5 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Total', 'එකතුව')}</th>
                          <th className="w-14 px-4 py-3.5"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {cartItems.map((item, itemIdx) => {
                          const prod = products.find(p => p.id === item.productId);
                          const baseStock = prod?.stock || 0;
                          const conversionRate = item.conversionRate || 1;
                          const maxStockInUnit = Math.round((baseStock * conversionRate) * 100000) / 100000;
                          return (
                            <tr key={itemIdx} className="hover:bg-slate-50/30 transition-colors">
                              <td className="px-5 py-4">
                                <p className="font-black text-slate-800 text-sm">{item.productName}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[9px] font-mono text-slate-400">ID: {item.productId.slice(-6).toUpperCase()}</span>
                                  {(() => {
                                    const opts = getUnitOptions(prod);
                                    if (opts.length > 1) {
                                      return (
                                        <select
                                          value={item.unit || prod?.unit || ''}
                                          onChange={(e) => {
                                            const newUnit = e.target.value;
                                            const selectedOpt = opts.find(o => o.unit === newUnit);
                                            if (selectedOpt && prod) {
                                              const newRate = selectedOpt.conversionRate;
                                              const newPrice = selectedOpt.price !== undefined 
                                                ? selectedOpt.price 
                                                : (prod.price / newRate);
                                              
                                              const baseStock = Number(prod.stock) || 0;
                                              const maxStockInNewUnit = Math.round((baseStock * newRate) * 100000) / 100000;
                                              
                                              let newQty = item.qty || 1;
                                              if (newQty > maxStockInNewUnit) {
                                                alert(t(`Only ${maxStockInNewUnit} ${newUnit} available in stock!`, `තොගයේ ඇත්තේ ${maxStockInNewUnit} ${newUnit} ක් පමණි!`));
                                                newQty = Math.max(1, maxStockInNewUnit);
                                              }
                                              
                                              setCartItems(prev => prev.map(i => 
                                                i.productId === item.productId 
                                                  ? { 
                                                      ...i, 
                                                      unit: newUnit, 
                                                      conversionRate: newRate, 
                                                      qty: newQty,
                                                      price: newPrice, 
                                                      total: newQty * newPrice 
                                                    } 
                                                  : i
                                              ));
                                            }
                                          }}
                                          className="text-[9px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 font-bold text-slate-600 focus:outline-none focus:border-amber-500 cursor-pointer"
                                        >
                                          {opts.map(o => {
                                             const primaryOption = opts[0] || { conversionRate: 1 };
                                             const primaryRate = primaryOption.conversionRate;
                                             const calculatedPrice = o.price !== undefined 
                                               ? o.price 
                                               : prod 
                                                 ? (prod.price / primaryRate) * o.conversionRate 
                                                 : 0;
                                             return (
                                               <option key={o.unit} value={o.unit}>
                                                 {o.unit} – {symbol} {calculatedPrice.toLocaleString()}
                                               </option>
                                             );
                                           })}
                                        </select>
                                      );
                                    } else {
                                      return (
                                        <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                                          {t(item.unit || prod?.unit || 'pcs', unitTranslations[item.unit || prod?.unit || 'pcs'] || item.unit || prod?.unit || 'pcs')}
                                        </span>
                                      );
                                    }
                                  })()}
                                </div>
                              </td>
                              <td className="px-4 py-4 text-center">
                                {/* Premium Counter Buttons */}
                                <div className="inline-flex items-center bg-slate-50 border border-slate-200 rounded-xl p-1 shadow-inner">
                                  <button
                                    type="button"
                                    onClick={() => updateQty(item.productId, Math.max(0.5, Math.round((item.qty - 0.5) * 100) / 100))}
                                    className="w-7 h-7 bg-white hover:bg-slate-100 active:scale-95 text-slate-600 rounded-lg flex items-center justify-center font-black transition-all border border-slate-200 shadow-sm"
                                  >
                                    -
                                  </button>
                                  <input 
                                    type="number" 
                                    min={0} 
                                    step="any"
                                    max={maxStockInUnit} 
                                    value={item.qty === 0 ? '' : item.qty} 
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => {
                                      const valStr = e.target.value;
                                      if (valStr === '') {
                                        updateQty(item.productId, 0);
                                      } else {
                                        const val = parseFloat(valStr);
                                        if (!isNaN(val) && val >= 0) {
                                          updateQty(item.productId, Math.min(maxStockInUnit, val));
                                        }
                                      }
                                    }}
                                    onBlur={() => {
                                      if (!item.qty || item.qty <= 0) {
                                        updateQty(item.productId, 1, true);
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        (e.target as HTMLElement).blur();
                                      }
                                    }}
                                    className="w-16 text-center bg-transparent border-0 font-bold text-slate-800 outline-none text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateQty(item.productId, Math.min(maxStockInUnit, Math.round((item.qty + 0.5) * 100) / 100))}
                                    className="w-7 h-7 bg-white hover:bg-slate-100 active:scale-95 text-slate-600 rounded-lg flex items-center justify-center font-black transition-all border border-slate-200 shadow-sm"
                                  >
                                    +
                                  </button>
                                </div>
                              </td>
                              <td className="px-4 py-4 text-right font-bold text-slate-500 text-xs">{symbol} {convert(item.price).toLocaleString()}</td>
                              <td className="px-3 py-4 text-center">
                                <div className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1 shadow-inner">
                                  <input 
                                    type="number" 
                                    min={0} 
                                    step="any"
                                    placeholder="0" 
                                    value={item.discount || ''} 
                                    onChange={(e) => updateDiscount(item.productId, parseFloat(e.target.value) || 0, item.discountType || 'percent')} 
                                    className="w-12 text-center bg-transparent border-0 font-bold text-slate-800 outline-none text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                  />
                                  <button 
                                    type="button" 
                                    onClick={() => updateDiscount(item.productId, item.discount || 0, (item.discountType || 'percent') === 'percent' ? 'amount' : 'percent')} 
                                    className="px-1.5 py-0.5 bg-white border border-slate-200 rounded-lg text-[10px] font-black text-amber-600 hover:bg-slate-100 transition-colors shadow-sm"
                                  >
                                    {(item.discountType || 'percent') === 'percent' ? '%' : symbol}
                                  </button>
                                </div>
                              </td>
                              <td className="px-4 py-4 text-right font-black text-slate-800 text-sm">{symbol} {convert(item.total).toLocaleString()}</td>
                              <td className="px-4 py-4 text-center">
                                <button 
                                  onClick={() => setCartItems((prev) => prev.filter((i) => i.productId !== item.productId))} 
                                  className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all duration-200"
                                  title={t('Remove item', 'භාණ්ඩය ඉවත් කරන්න')}
                                >
                                  <Trash2Icon className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Checkout Order Summary Sidebar */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-200/50 p-6 h-fit sticky top-6 text-left hover:shadow-2xl hover:shadow-slate-200/60 transition-all duration-300">
            <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-4 bg-amber-500 rounded-full"></span>
                {t('Order Summary', 'ඇණවුම් සාරාංශය')}
              </h3>
              <button 
                type="button" 
                onClick={() => { fetchHeldBills(); setShowHeldBillsModal(true); }}
                className="text-[9px] font-black uppercase tracking-widest px-3 py-2 bg-amber-500/10 hover:bg-amber-500 hover:text-slate-900 text-amber-600 rounded-xl transition-all border border-amber-500/10 shadow-sm flex items-center gap-1"
              >
                <PauseIcon className="w-3 h-3" />
                {t('Parked Invoices', 'රඳවා ඇති බිල්')}
              </button>
            </div>
            
            <div className="space-y-4 mb-6">
              
              {/* Optional Tax Toggle */}
              <div className="flex items-center gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/40 shadow-inner">
                <input 
                  type="checkbox" 
                  id="applyTaxToggle"
                  checked={applyTax} 
                  onChange={(e) => setApplyTax(e.target.checked)} 
                  className="w-4 h-4 text-amber-500 border-slate-300 rounded focus:ring-amber-500 cursor-pointer transition-colors"
                />
                <label htmlFor="applyTaxToggle" className="text-xs font-black text-slate-500 cursor-pointer select-none">
                  {t(`Apply Tax (${taxRate}%)`, `බදු එකතු කරන්න (${taxRate}%)`)}
                </label>
              </div>

              <div className="grid grid-cols-1 gap-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-100 shadow-sm">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1 block">{t('Transportation Fee (Rs.)', 'ප්‍රවාහන ගාස්තුව (රු.)')}</label>
                  <input 
                    type="number" 
                    min={0} 
                    value={transportationFee || ''} 
                    onChange={(e) => setTransportationFee(parseFloat(e.target.value) || 0)} 
                    placeholder="0.00"
                    className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm" 
                  />
                </div>

                {applyTax && (
                  <div className="animate-in slide-in-from-top-3 duration-350">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1 block">{t('Tax Rate (%)', 'බදු අනුපාතය (%)')}</label>
                    <input 
                      type="number" 
                      min={0} 
                      value={taxRate} 
                      onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)} 
                      className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm" 
                    />
                  </div>
                )}

                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1 block">{t('Payment Method', 'ගෙවීම් ක්‍රමය')}</label>
                  <div className="relative">
                    <select 
                      value={paymentMethod} 
                      onChange={(e) => setPaymentMethod(e.target.value as any)} 
                      className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 cursor-pointer appearance-none transition-all shadow-sm"
                    >
                      <option value="Cash">Cash / මුදල්</option>
                      <option value="Card">Card / කාඩ්පත්</option>
                      <option value="Bank Transfer">Bank Transfer / බැංකු හුවමාරු</option>
                    </select>
                    <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Credit Note Code & Application Field */}
                <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex justify-between items-center">
                    <label className="text-[9px] font-black text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span>💳</span> {t('Credit Note Code', 'ණය සටහන් අංකය')}
                    </label>
                    {activeCreditBalance > 0 && (
                      <span className="text-[9px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                        {t('Avail Balance: ', 'ශේෂය: ')}{symbol} {convert(activeCreditBalance).toLocaleString()}
                      </span>
                    )}
                  </div>

                  {/* Code Input / Dropdown Combo */}
                  <div className="space-y-1.5">
                    {availableCustomerCreditNotes.length > 0 && (
                      <select
                        value={selectedCreditNoteCode}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectedCreditNoteCode(val);
                          if (val) {
                            const found = creditNotesList.find((c: any) => (c.credit_note_no || c.code || c.id) === val);
                            if (found) {
                              const bal = Number(found.balance_remaining !== undefined ? found.balance_remaining : (found.balanceRemaining || found.amount || 0));
                              setCreditNoteApplied(Math.min(bal, netTotalBeforeCreditNote));
                            }
                          }
                        }}
                        className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500 shadow-sm"
                      >
                        <option value="">-- {t('Select Active Customer Credit Note', 'සක්‍රිය ණය සටහන තෝරන්න')} --</option>
                        {availableCustomerCreditNotes.map((cn: any) => {
                          const cnCode = cn.credit_note_no || cn.code || cn.id;
                          const bal = Number(cn.balance_remaining !== undefined ? cn.balance_remaining : (cn.balanceRemaining || cn.amount || 0));
                          return (
                            <option key={cn.id} value={cnCode}>
                              {cnCode} - {symbol} {convert(bal).toLocaleString()}
                            </option>
                          );
                        })}
                      </select>
                    )}

                    <div className="relative">
                      <input
                        type="text"
                        placeholder={t('Enter/Scan CN Code (e.g. CN-055468)', 'ණය සටහන් අංකය ඇතුළත්/ස්කෑන් කරන්න...')}
                        value={selectedCreditNoteCode}
                        onChange={(e) => {
                          const val = e.target.value.toUpperCase();
                          setSelectedCreditNoteCode(val);
                          const found = creditNotesList.find((c: any) => (c.credit_note_no || c.code || c.id || '').toUpperCase() === val.trim() && c.status === 'active');
                          if (found) {
                            const bal = Number(found.balance_remaining !== undefined ? found.balance_remaining : (found.balanceRemaining || found.amount || 0));
                            setCreditNoteApplied(Math.min(bal, netTotalBeforeCreditNote));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = selectedCreditNoteCode.trim().toUpperCase();
                            const found = creditNotesList.find((c: any) => (c.credit_note_no || c.code || c.id || '').toUpperCase() === val && c.status === 'active');
                            if (found) {
                              const bal = Number(found.balance_remaining !== undefined ? found.balance_remaining : (found.balanceRemaining || found.amount || 0));
                              setCreditNoteApplied(Math.min(bal, netTotalBeforeCreditNote));
                            } else if (val) {
                              alert(t("Credit Note code not found or already used.", "ණය සටහන් අංකය හමු නොවීය හෝ දැනටමත් භාවිතා කර ඇත."));
                            }
                          }
                        }}
                        className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl text-xs font-mono font-bold text-amber-900 outline-none placeholder-slate-400 focus:border-amber-500 shadow-sm"
                      />
                    </div>
                  </div>

                  {/* Auto-Detected Credit Note Price Banner */}
                  {matchedCreditNote && (() => {
                    const origVal = Number(matchedCreditNote.amount !== undefined ? matchedCreditNote.amount : (matchedCreditNote.value || 0));
                    const availBal = Number(matchedCreditNote.balance_remaining !== undefined ? matchedCreditNote.balance_remaining : (matchedCreditNote.balanceRemaining !== undefined ? matchedCreditNote.balanceRemaining : origVal));
                    const usedVal = Math.max(0, origVal - availBal);
                    const st = (matchedCreditNote.status || '').toLowerCase();
                    const isFullyUsed = st === 'fully used' || st === 'used' || availBal <= 0;
                    const isPartiallyUsed = !isFullyUsed && (st === 'partially used' || st === 'partially_used' || usedVal > 0);

                    return (
                      <div className={`border rounded-xl p-3 space-y-2 animate-in fade-in duration-200 ${
                        isFullyUsed ? 'bg-rose-50 border-rose-200' : isPartiallyUsed ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'
                      }`}>
                        <div className="flex justify-between items-center text-xs font-black">
                          <span className="flex items-center gap-1 font-mono text-slate-800">
                            💳 {matchedCreditNote.credit_note_no || matchedCreditNote.code || matchedCreditNote.id}
                          </span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                            isFullyUsed
                              ? 'bg-rose-200 text-rose-900'
                              : isPartiallyUsed
                              ? 'bg-amber-200 text-amber-900'
                              : 'bg-emerald-200 text-emerald-900'
                          }`}>
                            {isFullyUsed
                              ? t('Fully Used', 'සම්පූර්ණයෙන්ම භාවිතා කර ඇත')
                              : isPartiallyUsed
                              ? t('Partially Used', 'කොටසක් භාවිතා කර ඇත')
                              : t('Active', 'සක්‍රියයි')}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[11px] pt-1.5 border-t border-slate-200/80">
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase block">{t('Original', 'මුල් වටිනාකම')}</span>
                            <span className="font-mono font-bold text-slate-700">{symbol} {convert(origVal).toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-black text-slate-400 uppercase block">{t('Used', 'භාවිත කල')}</span>
                            <span className="font-mono font-bold text-amber-700">{symbol} {convert(usedVal).toLocaleString()}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[9px] font-black text-emerald-600 uppercase block">{t('Available Bal', 'ඉතිරි ශේෂය')}</span>
                            <span className="font-mono font-black text-emerald-700 text-xs">{symbol} {convert(availBal).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Amount Applied Input & Max Button */}
                  <div className="space-y-1 pt-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">
                      {t('Amount to Apply (Rs.)', 'භාවිතා කරන මුදල (රු.)')}
                    </label>
                    <div className="flex gap-2">
                      <input 
                        type="number" 
                        min={0} 
                        max={Math.min(activeCreditBalance > 0 ? activeCreditBalance : 999999, netTotalBeforeCreditNote)}
                        value={creditNoteApplied === '' ? '' : creditNoteApplied} 
                        onChange={(e) => {
                          const val = e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value) || 0);
                          if (typeof val === 'number') {
                            const maxAllow = activeCreditBalance > 0 
                              ? Math.min(activeCreditBalance, netTotalBeforeCreditNote)
                              : netTotalBeforeCreditNote;
                            setCreditNoteApplied(Math.min(val, maxAllow));
                          } else {
                            setCreditNoteApplied('');
                          }
                        }} 
                        placeholder="0.00"
                        className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl font-bold text-slate-800 text-xs outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm" 
                      />
                      {activeCreditBalance > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const maxAllow = Math.min(activeCreditBalance, netTotalBeforeCreditNote);
                            setCreditNoteApplied(maxAllow);
                          }}
                          className="px-3 py-2 bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-black text-[10px] uppercase tracking-wider rounded-xl transition-all shadow-sm shrink-0"
                        >
                          {t('Max', 'උපරිම')}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Remaining Balance After Sale Live Badge */}
                  {numCreditNoteApplied > 0 && (
                    <div className="bg-emerald-50 border border-emerald-200/80 rounded-lg p-2 flex justify-between items-center text-[10px] font-black text-emerald-900 animate-in fade-in duration-200">
                      <span>{t('Remaining CN Balance after Sale:', 'මෙම ගනුදෙනුවෙන් පසු ඉතිරි ශේෂය:')}</span>
                      <span className="font-mono text-xs text-emerald-700 font-bold">{symbol} {convert(remainingCNBalanceAfterSale).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Price Calculation Details Block */}
              <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-4.5 space-y-3.5 shadow-inner">
                <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest">
                  <span>{t('Subtotal', 'උප එකතුව')}</span>
                  <span className="text-slate-700 font-mono">{symbol} {convert(subtotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                {discountAmt > 0 && (
                  <div className="flex justify-between text-xs font-black text-red-400 uppercase tracking-widest">
                    <span>{t('Discount', 'වට්ටම')}</span>
                    <span className="text-red-500 font-mono">-{symbol} {convert(discountAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                {Number(transportationFee || 0) > 0 && (
                  <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest">
                    <span>{t('Transportation Fee', 'ප්‍රවාහන ගාස්තුව')}</span>
                    <span className="text-slate-700 font-mono">+{symbol} {convert(transportationFee).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest">
                  <span>{t('Total Tax', 'මුළු බද්ද')} ({applyTax ? taxRate : 0}%)</span>
                  <span className="text-slate-700 font-mono">+{symbol} {convert(taxAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                {numCreditNoteApplied > 0 && (
                  <>
                    <div className="flex justify-between text-xs font-black text-emerald-600 uppercase tracking-widest bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                      <span>{t('Credit Note Applied', 'ණය සටහන භාවිතා කරන ලදී')} {selectedCreditNoteCode ? `(${selectedCreditNoteCode})` : ''}</span>
                      <span className="font-mono">-{symbol} {convert(numCreditNoteApplied).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between text-[11px] font-black text-amber-700 uppercase tracking-wider px-2">
                      <span>{t('Remaining Credit Note Balance', 'ණය සටහනේ ඉතිරි ශේෂය')}</span>
                      <span className="font-mono">{symbol} {convert(remainingCNBalanceAfterSale).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  </>
                )}
                
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex justify-between items-center mt-2 shadow-md">
                  <span className="uppercase tracking-widest text-xs font-black text-slate-400">{t('Payable', 'ගෙවිය යුතු මුදල')}</span>
                  <span className="text-xl font-black text-amber-400 font-mono">{symbol} {convert(totalAmountValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-3">
              <button 
                onClick={processSale} 
                disabled={(!isGuest && !selectedCustomer) || cartItems.length === 0 || isLoading} 
                className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:brightness-110 active:scale-[0.99] disabled:from-slate-100 disabled:to-slate-100 disabled:text-slate-300 disabled:shadow-none text-slate-950 font-black py-4 rounded-2xl shadow-lg shadow-amber-500/15 transition-all flex items-center justify-center gap-2.5 uppercase tracking-widest text-xs border border-amber-400/20"
              >
                {isLoading ? <Loader2Icon className="animate-spin" /> : <ReceiptIcon className="w-5 h-5 text-slate-950" />}
                {t('Complete Checkout', 'ගනුදෙනුව සම්පූර්ණ කරන්න')}
              </button>

              {cartItems.length > 0 && (
                <button 
                  type="button"
                  onClick={() => setShowHoldNameModal(true)} 
                  className="w-full bg-white hover:bg-slate-50 active:scale-[0.99] text-slate-500 hover:text-slate-700 font-black py-3 rounded-2xl transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[9px] border border-slate-200 shadow-sm"
                >
                  <PauseIcon className="w-3.5 h-3.5 text-slate-400" /> {t('Hold Bill (Park)', 'බිල්පත රඳවා තබන්න')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-4 animate-in slide-in-from-bottom duration-500">
            {/* Sales History Header with Filters */}
            <div className="flex flex-col gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-xl shadow-slate-100/40 text-left">
              <div className="flex justify-between items-center flex-wrap gap-4 border-b border-slate-100 pb-4">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-1.5 h-4 bg-amber-500 rounded-full"></span>
                  {t('Invoice Logs', 'ඉන්වොයිසි ලේඛනය')}
                  <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-lg text-[10px] font-mono border border-slate-200">
                    {filteredOrders.length} {t('records', 'වාර්තා')}
                  </span>
                </h3>
                
                {(historySearch || statusFilter !== 'all' || salesHistoryFromDate || salesHistoryToDate) && (
                  <button 
                    onClick={() => {
                      setHistorySearch('');
                      setStatusFilter('all');
                      setSalesHistoryFromDate('');
                      setSalesHistoryToDate('');
                    }}
                    className="text-[10px] font-black uppercase tracking-wider text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3.5 py-2 rounded-xl transition-all border border-red-200/50 shadow-sm"
                  >
                    {t('Clear Filters', 'පෙරහන් ඉවත් කරන්න')}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Search query */}
                <div className="relative bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 flex items-center gap-3 focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500 transition-all duration-200 shadow-inner">
                  <SearchIcon className="w-4 h-4 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder={t('Search invoice ID or Customer...', 'ඉන්වොයිස් අංකය හෝ පාරිභෝගිකයා...')} 
                    value={historySearch} 
                    onChange={(e) => setHistorySearch(e.target.value)} 
                    className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none placeholder-slate-400" 
                  />
                </div>

                {/* Status Dropdown */}
                <div className="relative bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 flex items-center gap-3 focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500 transition-all duration-200 shadow-inner">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full bg-transparent text-xs font-black text-slate-700 outline-none cursor-pointer appearance-none"
                  >
                    <option value="all">{t('All Statuses', 'සියලුම තත්ත්වයන්')}</option>
                    <option value="paid">{t('Paid', 'ගෙවන ලද')}</option>
                    <option value="non paid">{t('Unpaid / Credit', 'නොගෙවූ / ණය')}</option>
                    <option value="cancelled">{t('Voided', 'අවලංගු කරන ලද')}</option>
                  </select>
                  <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-400">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* From Date */}
                <div className="relative bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 flex items-center gap-3 focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500 transition-all duration-200 shadow-inner">
                  <div className="flex flex-col w-full text-left">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider">{t('From Date', 'සිට දිනය')}</span>
                    <input 
                      type="date" 
                      value={salesHistoryFromDate} 
                      onChange={(e) => setSalesHistoryFromDate(e.target.value)} 
                      className="bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
                    />
                  </div>
                </div>

                {/* To Date */}
                <div className="relative bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 flex items-center gap-3 focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500 transition-all duration-200 shadow-inner">
                  <div className="flex flex-col w-full text-left">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider">{t('To Date', 'දක්වා දිනය')}</span>
                    <input 
                      type="date" 
                      value={salesHistoryToDate} 
                      onChange={(e) => setSalesHistoryToDate(e.target.value)} 
                      className="bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>

            {selectedHistoryIds.length > 0 && (
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 p-4 border border-slate-100 bg-slate-50 rounded-2xl animate-in slide-in-from-top-3 duration-300">
                <p className="text-xs font-black text-slate-700">
                  {selectedHistoryIds.length} {t('invoices selected for action', 'ඉන්වොයිසි ප්‍රමාණයක් තෝරාගෙන ඇත')}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleBulkDeleteOrders}
                    className="text-[9px] font-black uppercase tracking-widest bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl transition-all shadow-md shadow-red-500/10 flex items-center gap-1.5"
                  >
                    <Trash2Icon className="w-3.5 h-3.5" /> {t('Delete Selected', 'තෝරාගත් මකන්න')}
                  </button>
                </div>
              </div>
            )}
            
            <div className="bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-100/40 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 tracking-widest uppercase">
                      <th className="px-6 py-4.5">
                        <label className="inline-flex items-center">
                          <input
                            type="checkbox"
                            checked={allFilteredSelected}
                            onChange={handleToggleSelectAll}
                            className="form-checkbox text-amber-500 rounded border-slate-300 focus:ring-amber-500 transition-colors"
                          />
                        </label>
                      </th>
                      <th className="px-6 py-4.5">{t('Invoice', 'ඉන්වොයිසිය')}</th>
                      <th className="px-6 py-4.5">{t('Date', 'දිනය')}</th>
                      <th className="px-6 py-4.5">{t('Customer', 'පාරිභෝගිකයා')}</th>
                      <th className="px-6 py-4.5 text-center">{t('Sale Type', 'වර්ගය')}</th>
                      <th className="px-6 py-4.5 text-center">{t('Items', 'භාණ්ඩ')}</th>
                      <th className="px-6 py-4.5 text-right">{t('Total', 'එකතුව')}</th>
                      <th className="px-6 py-4.5 text-center">{t('Status', 'තත්ත්වය')}</th>
                      <th className="px-6 py-4.5 text-center">{t('Actions', 'ක්‍රියාකාරකම්')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredOrders.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="text-center py-12 text-slate-400 font-bold text-sm">
                          {t('No sales records found.', 'විකිණීම් වාර්තා කිසිවක් හමු නොවීය.')}
                        </td>
                      </tr>
                    ) : (
                      filteredOrders.map(order => {
                        const isCredit = isCreditOrder(order);
                        return (
                          <tr key={order.id} className={`transition-all duration-200 ${isCredit ? 'bg-amber-50/50 hover:bg-amber-50/90 border-l-4 border-l-amber-500' : 'hover:bg-slate-50/30'}`}>
                            <td className="px-6 py-4">
                              <label className="inline-flex items-center">
                                <input
                                  type="checkbox"
                                  checked={selectedHistoryIds.includes(order.id)}
                                  onChange={() => handleToggleSelectOrder(order.id)}
                                  className="form-checkbox text-amber-500 rounded border-slate-300 focus:ring-amber-500 transition-colors"
                                />
                              </label>
                            </td>
                            <td className="px-6 py-4 font-black text-slate-800 font-mono text-sm">{order.invoiceNo}</td>
                            <td className="px-6 py-4 text-slate-500 font-bold text-xs">{order.date}</td>
                            <td className="px-6 py-4 text-left">
                              <div className="font-black text-slate-800 text-sm">{order.customerName}</div>
                              {(order.customerPhone || order.customer_phone) && (
                                <div className="text-[10px] text-slate-400 font-bold mt-0.5 font-mono">
                                  📞 {order.customerPhone || order.customer_phone}
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-4 text-center">
                              {isCredit ? (
                                <span className="bg-amber-100 text-amber-900 border border-amber-300 font-black px-2.5 py-1 rounded-xl text-[9px] uppercase tracking-wider shadow-xs inline-flex items-center gap-1">
                                  {t('Credit', 'ණය')}
                                </span>
                              ) : (
                                <span className="bg-slate-100 text-slate-700 font-bold px-2.5 py-1 rounded-xl text-[9px] uppercase tracking-wider border border-slate-200">
                                  {t('Normal', 'සාමාන්‍ය')}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border border-slate-200/50">
                                {order.items?.length || 0} SKU
                              </span>
                            </td>
                          <td className="px-6 py-4 text-right font-black text-amber-500 font-mono text-sm">{symbol} {convert(order.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-6 py-4 text-center">
                            <span className={`px-2.5 py-1 rounded-xl text-[9px] font-black uppercase tracking-wider ${
                              (order.status as string) === 'cancelled' || (order.status as string) === 'Cancelled' || (order.status as string) === 'voided' || (order.status as string) === 'Voided'
                                ? 'bg-red-100 text-red-700 border border-red-200 shadow-xs'
                                : statusColors[order.status] || 'bg-slate-100 text-slate-500'
                            }`}>
                              {(order.status as string) === 'Paid' || (order.status as string) === 'paid' 
                                ? t('Paid', 'ගෙවන ලද') 
                                : (order.status as string) === 'Non Paid' 
                                ? t('Non Paid', 'නොගෙවූ') 
                                : (order.status as string) === 'cancelled' || (order.status as string) === 'Cancelled' || (order.status as string) === 'voided' || (order.status as string) === 'Voided'
                                ? 'VOIDED'
                                : order.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center flex items-center justify-center gap-2">
                            {(order.status as string) === 'Non Paid' && (
                              <button 
                                type="button"
                                disabled={true}
                                className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-400 px-3 py-2 rounded-xl border border-slate-200 cursor-not-allowed"
                                title={t('Please settle through Customer Credit Settlement under Customers', 'කරුණාකර පාරිභෝගික ගිණුමෙන් පියවන්න')}
                              >
                                {t('Pay (Disabled)', 'ගෙවන්න (අක්‍රියයි)')}
                              </button>
                            )}
                            <button 
                              type="button"
                              onClick={() => {
                                setLastOrder(order);
                                setShowReceipt(true);
                              }} 
                              className="text-[9px] font-black uppercase tracking-widest bg-amber-50 hover:bg-amber-500 text-amber-600 hover:text-slate-950 px-3 py-2 rounded-xl transition-all border border-amber-200/40 shadow-sm flex items-center gap-1"
                              title={t('Preview', 'පෙරදසුන')}
                            >
                              <ReceiptIcon className="w-3.5 h-3.5" />
                              {t('Preview', 'පෙරදසුන')}
                            </button>
                            <button 
                              type="button"
                              onClick={() => handlePrintReceipt(order)} 
                              className="text-[9px] font-black uppercase tracking-widest bg-slate-900 hover:bg-slate-800 text-white px-3 py-2 rounded-xl transition-all shadow-md shadow-slate-900/10 flex items-center gap-1"
                              title={t('Print', 'මුද්‍රණය')}
                            >
                              <PrinterIcon className="w-3.5 h-3.5 text-amber-400" />
                              {t('Print', 'මුද්‍රණය')}
                            </button>
                            {(order.status as string) !== 'cancelled' && (order.status as string) !== 'Cancelled' && (order.status as string) !== 'voided' && (order.status as string) !== 'Voided' ? (
                              <button
                                type="button"
                                onClick={() => { setTargetVoidInvoiceId(order.id); setVoidPasskeyInput(''); setShowVoidModal(true); }}
                                className="text-[9px] font-black uppercase tracking-widest bg-red-50 hover:bg-red-600 text-red-500 hover:text-white px-3 py-2 rounded-xl transition-all border border-red-200/40 shadow-sm flex items-center gap-1"
                                title={t('Void', 'අවලංගු')}
                              >
                                <XIcon className="w-3.5 h-3.5" />
                                {t('Void', 'අවලංගු')}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleDeleteOrder(order.id)}
                                className="text-[9px] font-black uppercase tracking-widest bg-rose-600 hover:bg-rose-700 text-white px-3 py-2 rounded-xl transition-all shadow-md flex items-center gap-1"
                                title={t('Delete', 'මකන්න')}
                              >
                                <Trash2Icon className="w-3.5 h-3.5" />
                                {t('Delete', 'මකන්න')}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                  </tbody>
                </table>
              </div>
            </div>
        </div>
      )}

      {tab === 'credit' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-in fade-in duration-300">
          <div className="xl:col-span-2 space-y-5">
            
            {/* Customer Details Block */}
            <div className="bg-white rounded-2xl border-l-4 border-l-amber-500 border-y border-r border-slate-100 shadow-xl shadow-slate-100/40 p-6 text-left hover:shadow-2xl hover:shadow-slate-200/40 transition-all duration-300 transform hover:-translate-y-0.5">
              <div className="flex justify-between items-center mb-5 flex-wrap gap-3">
                <h3 className="text-sm font-black text-slate-800 flex items-center gap-2.5 uppercase tracking-wider">
                  <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center border border-amber-100/60 shadow-sm">
                    <UserIcon className="w-4 h-4 text-amber-500" />
                  </div>
                  {t('Credit Customer Details', 'ණයගැති පාරිභෝගික විස්තර')}
                </h3>
                
                {/* Modern Segmented Pill Toggle */}
                <div className="flex bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/30 shadow-inner">
                  <button
                    type="button"
                    onClick={() => {
                      setCreditCustomerType('registered');
                      setSelectedCreditCustomer(null);
                      setCreditCustomerName('');
                      setCreditCustomerPhone('');
                      setCreditCustomerAddress('');
                      setCreditCustomerNIC('');
                    }}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 flex items-center gap-1 ${creditCustomerType === 'registered' ? 'bg-slate-900 text-amber-400 shadow-md border border-slate-800' : 'text-slate-400 hover:text-slate-700'}`}
                  >
                    {t('Registered', 'ලියාපදිංචි')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreditCustomerType('guest');
                      setSelectedCreditCustomer(null);
                      setCreditCustomerName('');
                      setCreditCustomerPhone('');
                      setCreditCustomerAddress('');
                      setCreditCustomerNIC('');
                    }}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 flex items-center gap-1 ${creditCustomerType === 'guest' ? 'bg-slate-900 text-amber-400 shadow-md border border-slate-800' : 'text-slate-400 hover:text-slate-700'}`}
                  >
                    {t('Guest / New', 'නව පාරිභෝගිකයා')}
                  </button>
                </div>
              </div>

              {creditCustomerType === 'registered' ? (
                <div className="space-y-4">
                  <div className="relative">
                    <select 
                      value={selectedCreditCustomer?.id || ''} 
                      onChange={(e) => {
                        const c = customers.find((c) => c.id === e.target.value) || null;
                        setSelectedCreditCustomer(c);
                        if (c) {
                          setCreditCustomerName(c.name);
                          setCreditCustomerPhone(c.phone || '');
                          setCreditCustomerAddress(c.address || '');
                          setCreditCustomerNIC(c.nic || '');
                        } else {
                          setCreditCustomerName('');
                          setCreditCustomerPhone('');
                          setCreditCustomerAddress('');
                          setCreditCustomerNIC('');
                        }
                      }}
                      className="w-full px-4 py-3.5 bg-slate-50/50 hover:bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 cursor-pointer transition-all duration-200 appearance-none shadow-sm"
                    >
                      <option value="">{t('Select a registered customer...', 'ලියාපදිංචි පාරිභෝගිකයෙකු තෝරන්න...')}</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} — {c.phone}
                        </option>
                      ))}
                    </select>
                    <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {selectedCreditCustomer && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-amber-50/50 border border-amber-200/60 rounded-xl p-3.5 text-xs font-bold text-slate-700">
                      <div><span className="text-slate-400 block text-[9px] uppercase tracking-wider">{t('Phone', 'දුරකථනය')}</span>{selectedCreditCustomer.phone || 'N/A'}</div>
                      <div><span className="text-slate-400 block text-[9px] uppercase tracking-wider">{t('NIC', 'ජා.හැ. අංකය')}</span>{selectedCreditCustomer.nic || 'N/A'}</div>
                      <div><span className="text-slate-400 block text-[9px] uppercase tracking-wider">{t('Address', 'ලිපිනය')}</span>{selectedCreditCustomer.address || 'N/A'}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-in slide-in-from-top-2 duration-300">
                  <input 
                    type="text" 
                    value={creditCustomerName} 
                    onChange={(e) => setCreditCustomerName(e.target.value)} 
                    placeholder={t('Customer Name *', 'පාරිභෝගිකයාගේ නම *')} 
                    className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm"
                  />
                  <input 
                    type="text" 
                    value={creditCustomerPhone} 
                    onChange={(e) => setCreditCustomerPhone(e.target.value)} 
                    placeholder={t('Phone Number', 'දුරකථන අංකය')} 
                    className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm"
                  />
                  <input 
                    type="text" 
                    value={creditCustomerNIC} 
                    onChange={(e) => setCreditCustomerNIC(e.target.value)} 
                    placeholder={t('NIC Number', 'ජා.හැ. අංකය')} 
                    className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm"
                  />
                  <input 
                    type="text" 
                    value={creditCustomerAddress} 
                    onChange={(e) => setCreditCustomerAddress(e.target.value)} 
                    placeholder={t('Address', 'ලිපිනය')} 
                    className="w-full px-4 py-3 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm"
                  />
                </div>
              )}
            </div>

            {/* Inventory Search & Items */}
            <div className="bg-white rounded-2xl border-l-4 border-l-amber-500 border-y border-r border-slate-100 shadow-xl shadow-slate-100/40 p-6 text-left hover:shadow-2xl hover:shadow-slate-200/40 transition-all duration-300 transform hover:-translate-y-0.5">
              <h3 className="text-sm font-black text-slate-800 mb-5 flex items-center gap-2.5 uppercase tracking-wider">
                <div className="w-8 h-8 bg-amber-50 rounded-xl flex items-center justify-center border border-amber-100/60 shadow-sm">
                  <ShoppingCartIcon className="w-4 h-4 text-amber-500" />
                </div>
                {t('Inventory Search & Items', 'තොග සෙවීම සහ භාණ්ඩ')}
              </h3>
              
              <div className="relative">
                <div className="flex items-center gap-3 bg-slate-50/50 hover:bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-500 transition-all duration-200 shadow-inner">
                  <SearchIcon className="w-5 h-5 text-slate-400" />
                  <input 
                    type="text" 
                    placeholder={t('Search hardware by name, SKU or barcode...', 'නම, SKU හෝ බාර්කෝඩ් මඟින් සොයන්න...')} 
                    value={creditProductSearch} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setCreditProductSearch(val);
                      setSelectedIndex(0);
                      if (val.trim()) {
                        const exactBarcode = products.find(p => p.barcode && p.barcode.trim().toLowerCase() === val.trim().toLowerCase());
                        if (exactBarcode) {
                          addCreditCartItemDirect(exactBarcode);
                          setCreditProductSearch('');
                        }
                      }
                    }} 
                    onKeyDown={(e) => {
                      if (creditFilteredProducts.length === 0) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setSelectedIndex((prev) => (prev + 1) % creditFilteredProducts.length);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setSelectedIndex((prev) => (prev - 1 + creditFilteredProducts.length) % creditFilteredProducts.length);
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        const selected = creditFilteredProducts[selectedIndex] || creditFilteredProducts[0];
                        if (selected) {
                          addCreditCartItemDirect(selected);
                          setCreditProductSearch('');
                          setSelectedIndex(0);
                        }
                      }
                    }}
                    className="bg-transparent text-sm font-bold text-slate-800 outline-none w-full placeholder-slate-400" 
                  />
                  {creditProductSearch && (
                    <button type="button" onClick={() => setCreditProductSearch('')} className="p-1 hover:bg-slate-200 rounded-full text-slate-400 transition-colors">
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                
                {/* Search Results Dropdown */}
                {creditProductSearch && creditFilteredProducts.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-2xl shadow-2xl z-[100] max-h-64 overflow-y-auto divide-y divide-slate-100/60 animate-in slide-in-from-top-3 duration-300">
                    {creditFilteredProducts.map((p, index) => {
                      const stockLevel = p.stock;
                      let stockBadge = "bg-emerald-50 text-emerald-600 border border-emerald-100/80";
                      if (stockLevel <= 0) {
                        stockBadge = "bg-rose-50 text-rose-600 border border-rose-100/80";
                      } else if (stockLevel <= 10) {
                        stockBadge = "bg-amber-50 text-amber-600 border border-amber-100/80";
                      }

                      return (
                        <button 
                          key={p.id} 
                          onClick={() => { addCreditCartItemDirect(p); setCreditProductSearch(''); setSelectedIndex(0); }} 
                          className={`w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors text-left ${index === selectedIndex ? 'bg-amber-50/80 border-l-4 border-amber-500' : ''}`}
                        >
                          <div className="space-y-1">
                            <p className="text-sm font-black text-slate-800">{p.name}</p>
                            <div className="flex items-center gap-2">
                              <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">SKU: {p.sku || 'N/A'}</span>
                              <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg ${stockBadge}`}>
                                {t('Stock', 'තොගය')}: {formatStock(p.stock, p.unit)} {p.unit}
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-black text-amber-500">{symbol} {convert(p.price).toLocaleString()}</span>
                            <span className="block text-[8px] text-slate-400 font-bold mt-0.5">{t('Click to add', 'එකතු කිරීමට ක්ලික් කරන්න')}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              
              {/* Cart Items Table */}
              {creditCartItems.length > 0 && (
                <div className="mt-6 overflow-hidden rounded-2xl border border-slate-100 shadow-md">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="px-5 py-3.5 text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Product', 'භාණ්ඩය')}</th>
                          <th className="px-4 py-3.5 text-center text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Quantity', 'ප්‍රමාණය')}</th>
                          <th className="px-4 py-3.5 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Price', 'මිල')}</th>
                          <th className="px-3 py-3.5 text-center text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Discount', 'වට්ටම්')}</th>
                          <th className="px-4 py-3.5 text-right text-[9px] font-black text-slate-400 uppercase tracking-widest">{t('Total', 'එකතුව')}</th>
                          <th className="w-14 px-4 py-3.5"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {creditCartItems.map((item, itemIdx) => {
                          const prod = products.find(p => p.id === item.productId);
                          const baseStock = prod?.stock || 0;
                          const conversionRate = item.conversionRate || 1;
                          const maxStockInUnit = Math.round((baseStock * conversionRate) * 100000) / 100000;
                          const rowTotal = item.total !== undefined ? item.total : (item.qty * item.price);
                          return (
                            <tr key={item.productId} className="hover:bg-slate-50/30 transition-colors">
                              <td className="px-5 py-4">
                                <p className="font-black text-slate-800 text-sm">{item.productName}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[9px] font-mono text-slate-400">ID: {item.productId.slice(-6).toUpperCase()}</span>
                                  {(() => {
                                    const opts = getUnitOptions(prod);
                                    if (opts.length > 1) {
                                      return (
                                        <select
                                          value={item.unit || prod?.unit || ''}
                                          onChange={(e) => {
                                            const newUnit = e.target.value;
                                            const selectedOpt = opts.find(o => o.unit === newUnit);
                                            if (selectedOpt && prod) {
                                              const newRate = selectedOpt.conversionRate;
                                              const newPrice = selectedOpt.price !== undefined 
                                                ? selectedOpt.price 
                                                : (prod.price / newRate);
                                              
                                              const baseStock = Number(prod.stock) || 0;
                                              const maxStockInNewUnit = Math.round((baseStock * newRate) * 100000) / 100000;
                                              
                                              let newQty = item.qty || 1;
                                              if (newQty > maxStockInNewUnit) {
                                                alert(t(`Only ${maxStockInNewUnit} ${newUnit} available in stock!`, `තොගයේ ඇත්තේ ${maxStockInNewUnit} ${newUnit} ක් පමණි!`));
                                                newQty = Math.max(1, maxStockInNewUnit);
                                              }

                                              setCreditCartItems(prev => prev.map(i => 
                                                i.productId === item.productId 
                                                  ? { 
                                                      ...i, 
                                                      unit: newUnit, 
                                                      conversionRate: newRate, 
                                                      qty: newQty,
                                                      price: newPrice, 
                                                      total: newQty * newPrice 
                                                    } 
                                                  : i
                                              ));
                                            }
                                          }}
                                          className="text-[9px] bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 font-bold text-slate-600 focus:outline-none focus:border-amber-500 cursor-pointer"
                                        >
                                          {opts.map(o => {
                                             const primaryOption = opts[0] || { conversionRate: 1 };
                                             const primaryRate = primaryOption.conversionRate;
                                             const calculatedPrice = o.price !== undefined 
                                               ? o.price 
                                               : prod 
                                                 ? (prod.price / primaryRate) * o.conversionRate 
                                                 : 0;
                                             return (
                                               <option key={o.unit} value={o.unit}>
                                                 {o.unit} – {symbol} {calculatedPrice.toLocaleString()}
                                               </option>
                                             );
                                           })}
                                        </select>
                                      );
                                    } else {
                                      return (
                                        <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                                          {t(item.unit || prod?.unit || 'pcs', unitTranslations[item.unit || prod?.unit || 'pcs'] || item.unit || prod?.unit || 'pcs')}
                                        </span>
                                      );
                                    }
                                  })()}
                                </div>
                              </td>
                              <td className="px-4 py-4 text-center">
                                {/* Counter Buttons */}
                                <div className="inline-flex items-center bg-slate-50 border border-slate-200 rounded-xl p-1 shadow-inner">
                                  <button
                                    type="button"
                                    onClick={() => updateCreditQty(itemIdx, Math.max(0.5, Math.round((item.qty - 0.5) * 100) / 100))}
                                    className="w-7 h-7 bg-white hover:bg-slate-100 active:scale-95 text-slate-600 rounded-lg flex items-center justify-center font-black transition-all border border-slate-200 shadow-sm"
                                  >
                                    -
                                  </button>
                                  <input 
                                    type="number" 
                                    min={0} 
                                    step="any"
                                    max={maxStockInUnit} 
                                    value={item.qty === 0 ? '' : item.qty} 
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => {
                                      const valStr = e.target.value;
                                      if (valStr === '') {
                                        updateCreditQty(itemIdx, 0);
                                      } else {
                                        const val = parseFloat(valStr);
                                        if (!isNaN(val) && val >= 0) {
                                          updateCreditQty(itemIdx, Math.min(maxStockInUnit, val));
                                        }
                                      }
                                    }}
                                    onBlur={() => {
                                      if (!item.qty || item.qty <= 0) {
                                        updateCreditQty(itemIdx, 1, true);
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        (e.target as HTMLElement).blur();
                                      }
                                    }}
                                    className="w-16 text-center bg-transparent border-0 font-bold text-slate-800 outline-none text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateCreditQty(itemIdx, Math.min(maxStockInUnit, Math.round((item.qty + 0.5) * 100) / 100))}
                                    className="w-7 h-7 bg-white hover:bg-slate-100 active:scale-95 text-slate-600 rounded-lg flex items-center justify-center font-black transition-all border border-slate-200 shadow-sm"
                                  >
                                    +
                                  </button>
                                </div>
                              </td>
                              <td className="px-4 py-4 text-right font-bold text-slate-500 text-xs">{symbol} {convert(item.price).toLocaleString()}</td>
                              <td className="px-3 py-4 text-center">
                                <div className="inline-flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1 shadow-inner">
                                  <input 
                                    type="number" 
                                    min={0} 
                                    step="any"
                                    placeholder="" 
                                    value={item.discount || ''} 
                                    onChange={(e) => updateCreditDiscount(itemIdx, parseFloat(e.target.value) || 0, item.discountType || 'amount')} 
                                    className="w-12 text-center bg-transparent border-0 font-bold text-slate-800 outline-none text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                  />
                                  <button 
                                    type="button" 
                                    onClick={() => updateCreditDiscount(itemIdx, item.discount || 0, (item.discountType || 'amount') === 'percent' ? 'amount' : 'percent')} 
                                    className="px-1.5 py-0.5 bg-white border border-slate-200 rounded-lg text-[10px] font-black text-amber-600 hover:bg-slate-100 transition-colors shadow-sm"
                                  >
                                    {(item.discountType || 'amount') === 'percent' ? '%' : symbol}
                                  </button>
                                </div>
                              </td>
                              <td className="px-4 py-4 text-right font-black text-slate-800 text-sm">{symbol} {convert(rowTotal).toLocaleString()}</td>
                              <td className="px-4 py-4 text-center">
                                <button 
                                  onClick={() => setCreditCartItems((prev) => prev.filter((i) => i.productId !== item.productId))} 
                                  className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all duration-200"
                                  title={t('Remove item', 'භාණ්ඩය ඉවත් කරන්න')}
                                >
                                  <Trash2Icon className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Credit Order Summary Sidebar */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-200/50 p-6 h-fit sticky top-6 text-left hover:shadow-2xl hover:shadow-slate-200/60 transition-all duration-300">
            <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-4 bg-amber-500 rounded-full"></span>
                {t('Credit Order Summary', 'ණය ඇණවුම් සාරාංශය')}
              </h3>
            </div>
            
            <div className="space-y-4 mb-6">
              
              {/* Optional Tax Toggle */}
              <div className="flex items-center gap-3 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/40 shadow-inner">
                <input 
                  type="checkbox" 
                  id="applyCreditTaxToggle"
                  checked={applyTax} 
                  onChange={(e) => setApplyTax(e.target.checked)} 
                  className="w-4 h-4 text-amber-500 border-slate-300 rounded focus:ring-amber-500 cursor-pointer transition-colors"
                />
                <label htmlFor="applyCreditTaxToggle" className="text-xs font-black text-slate-500 cursor-pointer select-none">
                  {t(`Apply Tax (${creditTaxRate}%)`, `බදු එකතු කරන්න (${creditTaxRate}%)`)}
                </label>
              </div>

              <div className="grid grid-cols-1 gap-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-100 shadow-sm">
                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1 block">{t('Payment Term (Days)', 'ණය වාර ගෙවීම් කාලය (දින)')}</label>
                  <input 
                    type="number" 
                    min={1} 
                    value={creditTabPeriodDays} 
                    onChange={(e) => setCreditTabPeriodDays(parseInt(e.target.value) || 30)} 
                    className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm" 
                  />
                </div>

                <div>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1 block">{t('Transportation Fee (Rs.)', 'ප්‍රවාහන ගාස්තුව (රු.)')}</label>
                  <input 
                    type="number" 
                    min={0} 
                    value={creditTransportationFee || ''} 
                    onChange={(e) => setCreditTransportationFee(parseFloat(e.target.value) || 0)} 
                    placeholder="0.00"
                    className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm" 
                  />
                </div>

                {applyTax && (
                  <div className="animate-in slide-in-from-top-3 duration-350">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1 block">{t('Tax Rate (%)', 'බදු අනුපාතය (%)')}</label>
                    <input 
                      type="number" 
                      min={0} 
                      value={creditTaxRate} 
                      onChange={(e) => setCreditTaxRate(parseFloat(e.target.value) || 0)} 
                      className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm" 
                    />
                  </div>
                )}
              </div>

              {/* Price Calculation Details Block */}
              <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-4.5 space-y-3.5 shadow-inner">
                <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest">
                  <span>{t('Gross Subtotal', 'මුළු උප එකතුව')}</span>
                  <span className="text-slate-700 font-mono">{symbol} {convert(grossCreditSubtotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                {creditTotalDiscount > 0 && (
                  <div className="flex justify-between text-xs font-black text-emerald-600 uppercase tracking-widest">
                    <span>{t('Total Discount', 'මුළු වට්ටම')}</span>
                    <span className="font-mono">-{symbol} {convert(creditTotalDiscount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest pt-1 border-t border-slate-200/60">
                  <span>{t('Net Subtotal', 'ශුද්ධ උප එකතුව')}</span>
                  <span className="text-slate-700 font-mono">{symbol} {convert(creditSubtotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                {applyTax && (
                  <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest">
                    <span>{t('Total Tax', 'මුළු බද්ද')} ({creditTaxRate}%)</span>
                    <span className="text-slate-700 font-mono">+{symbol} {convert(creditTaxAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                {creditTransportationFee > 0 && (
                  <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest">
                    <span>{t('Transport Fee', 'ප්‍රවාහන ගාස්තුව')}</span>
                    <span className="text-slate-700 font-mono">+{symbol} {convert(creditTransportationFee).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex justify-between items-center mt-2 shadow-md">
                  <span className="uppercase tracking-widest text-xs font-black text-slate-400">{t('Total Owed', 'මුළු ණය එකතුව')}</span>
                  <span className="text-xl font-black text-amber-400 font-mono">{symbol} {convert(creditTotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
            
            <div className="space-y-3">
              <button 
                onClick={processCreditSale} 
                disabled={!creditCustomerName.trim() || creditCartItems.length === 0 || isCreditLoading} 
                className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:brightness-110 active:scale-[0.99] disabled:from-slate-100 disabled:to-slate-100 disabled:text-slate-300 disabled:shadow-none text-slate-950 font-black py-4 rounded-2xl shadow-lg shadow-amber-500/15 transition-all flex items-center justify-center gap-2.5 uppercase tracking-widest text-xs border border-amber-400/20 cursor-pointer"
              >
                {isCreditLoading ? <Loader2Icon className="animate-spin" /> : <DollarSignIcon className="w-5 h-5 text-slate-950" />}
                {t('Create Credit Order', 'ණය ඇණවුම සාදන්න')}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'credit_history' && (
        <div className="animate-in fade-in duration-300">
          {/* Right Panel: Credit Orders Table */}
            <div className="xl:col-span-3 space-y-4">
              <div className="bg-white rounded-3xl border border-gray-100 p-4 shadow-sm flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[150px]">
                  <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">{t('From Date', 'සිට දිනය')}</label>
                  <input
                    type="date"
                    value={creditHistoryFromDate}
                    onChange={(e) => setCreditHistoryFromDate(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-[#DAA520] focus:ring-1 focus:ring-[#DAA520] transition-colors"
                  />
                </div>
                <div className="flex-1 min-w-[150px]">
                  <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">{t('To Date', 'දක්වා දිනය')}</label>
                  <input
                    type="date"
                    value={creditHistoryToDate}
                    onChange={(e) => setCreditHistoryToDate(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-700 outline-none focus:border-[#DAA520] focus:ring-1 focus:ring-[#DAA520] transition-colors"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCreditHistoryFromDate('');
                    setCreditHistoryToDate('');
                  }}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                >
                  {t('Clear Filters', 'පෙරහන් ඉවත් කරන්න')}
                </button>
              </div>
              {selectedCreditIds.length > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-center gap-4 animate-in slide-in-from-top-5 duration-300">
                  <div className="flex items-center gap-2.5 text-red-800 font-bold text-sm">
                    <svg className="w-5 h-5 text-red-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>{selectedCreditIds.length} {t("credit order(s) selected for bulk actions", "ණය ඇණවුම් ප්‍රමාණයක් තෝරාගෙන ඇත")}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleBulkDeleteCreditOrders}
                      className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-red-600/20 transition-all uppercase tracking-widest"
                    >
                      <Trash2Icon className="w-4 h-4" /> {t("Delete Selected", "තෝරාගත් මකන්න")}
                    </button>
                  </div>
                </div>
              )}
              <div className="bg-white rounded-3xl border border-gray-100 shadow-lg overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-gray-50 border-b border-gray-100 uppercase text-[10px] font-black text-gray-400 tracking-widest">
                    <tr>
                      <th className="px-4 py-4">
                        <label className="inline-flex items-center">
                          <input
                            type="checkbox"
                            checked={allCreditSelected}
                            onChange={handleToggleSelectAllCredit}
                            className="form-checkbox text-[#DAA520] rounded border-gray-300"
                          />
                        </label>
                      </th>
                      <th className="px-4 py-4">{t('Invoice', 'ඉන්වොයිසිය')}</th>
                      <th className="px-4 py-4">{t('Customer', 'පාරිභෝගිකයා')}</th>
                      <th className="px-4 py-4">{t('Description', 'විස්තරය')}</th>
                      <th className="px-4 py-4 text-right">{t('Total Amount', 'මුළු මුදල')}</th>
                      <th className="px-4 py-4 text-right">{t('Paid Amount', 'ගෙවූ මුදල')}</th>
                      <th className="px-4 py-4 text-right">{t('Remaining Bal', 'ඉතිරි ශේෂය')}</th>
                      <th className="px-4 py-4">{t('Due Date', 'ගෙවිය යුතු දිනය')}</th>
                      <th className="px-4 py-4 text-center">{t('Status', 'තත්ත්වය')}</th>
                      <th className="px-4 py-4 text-center">{t('Actions', 'ක්‍රියාකාරකම්')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {orders.filter(o => {
                        const method = (o.payment_method || (o as any).paymentMethod || '').toString().toLowerCase().trim();
                        const status = (o.status || '').toString().toLowerCase().trim();
                        const isCredit = method === 'credit' || method === 'credit sale' || (o as any).is_credit === true || status === 'non paid' || status === 'non-paid' || status === 'partially paid' || status === 'partially settled' || status === 'pending';
                        if (!isCredit) return false;
                        if (creditHistoryFromDate && new Date(o.date) < new Date(creditHistoryFromDate)) return false;
                        if (creditHistoryToDate && new Date(o.date) > new Date(creditHistoryToDate + 'T23:59:59')) return false;
                        return true;
                      }).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-gray-400 font-bold">
                          {t('No credit orders found.', 'ණය ඇණවුම් කිසිවක් හමු නොවීය.')}
                        </td>
                      </tr>
                    ) : (
                      orders.filter(o => {
                        const method = (o.payment_method || (o as any).paymentMethod || '').toString().toLowerCase().trim();
                        const status = (o.status || '').toString().toLowerCase().trim();
                        const isCredit = method === 'credit' || method === 'credit sale' || (o as any).is_credit === true || status === 'non paid' || status === 'non-paid' || status === 'partially paid' || status === 'partially settled' || status === 'pending';
                        if (!isCredit) return false;
                        if (creditHistoryFromDate && new Date(o.date) < new Date(creditHistoryFromDate)) return false;
                        if (creditHistoryToDate && new Date(o.date) > new Date(creditHistoryToDate + 'T23:59:59')) return false;
                        return true;
                      }).map(order => {
                        const productDesc = order.items && order.items.length > 0
                          ? order.items.map((it: any) => `${it.productName || it.name} (x${it.qty})`).join(', ')
                          : '—';
                        
                        const isOverdue = order.status === 'Non Paid' && order.due_date && new Date(order.due_date) < new Date();
                        const daysOverdue = order.due_date ? Math.ceil((new Date().getTime() - new Date(order.due_date).getTime()) / (1000 * 3600 * 24)) : 0;

                        return (
                          <tr key={order.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-4 py-4">
                              <label className="inline-flex items-center">
                                <input
                                  type="checkbox"
                                  checked={selectedCreditIds.includes(order.id)}
                                  onChange={() => handleToggleSelectCreditOrder(order.id)}
                                  className="form-checkbox text-[#DAA520] rounded border-gray-300"
                                />
                              </label>
                            </td>
                            <td className="px-4 py-4 font-black text-[#464646]">{order.invoiceNo}</td>
                            <td className="px-4 py-4 font-bold text-[#464646]">{order.customerName}</td>
                            <td className="px-4 py-4 text-gray-500 font-semibold">{productDesc}</td>
                            {(() => {
                              const invTotal = Number(order.total_amount !== undefined ? order.total_amount : order.total);
                              const paidAmt = Number(order.payment_received || 0);
                              const remBal = Math.max(0, invTotal - paidAmt);
                              return (
                                <>
                                  <td className="px-4 py-4 text-right font-black text-slate-800">{symbol} {convert(invTotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td className="px-4 py-4 text-right font-black text-emerald-600">{symbol} {convert(paidAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                  <td className="px-4 py-4 text-right font-black text-rose-600">{symbol} {convert(remBal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                </>
                              );
                            })()}
                            <td className="px-4 py-4 font-bold text-[#464646]">
                              <div>{order.due_date ? new Date(order.due_date).toLocaleDateString() : '—'}</div>
                              {isOverdue && (
                                <span className="inline-block mt-1 bg-red-100 text-red-700 text-[8px] px-1.5 py-0.5 rounded-md font-black uppercase tracking-wider">
                                  {t(`Overdue ${daysOverdue}d`, `පසුගිය දින ${daysOverdue}`)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-4 text-center">
                              {(() => {
                                const invTotal = Number(order.total_amount !== undefined ? order.total_amount : order.total);
                                const paidAmt = Number(order.payment_received || 0);
                                const remBal = Math.max(0, invTotal - paidAmt);
                                const isSettled = remBal <= 0.01;
                                return (
                                  <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                                    isSettled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                                  }`}>
                                    {isSettled ? t('Fully Settled', 'සම්පූර්ණයෙන්ම පියවා ඇත') : t('Partially Settled', 'කොටසක් පියවා ඇත')}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-4">
                              <div className="flex items-center justify-center gap-1.5">
                                {order.status === 'Non Paid' && (
                                  <>
                                    <button 
                                      disabled={true}
                                      className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-400 px-3 py-1.5 rounded-lg cursor-not-allowed font-bold"
                                      title={t('Please settle through Customer Credit Settlement under Customers', 'කරුණාකර පාරිභෝගික ගිණුමෙන් පියවන්න')}
                                    >
                                      {t('Pay (Disabled)', 'ගෙවන්න (අක්‍රියයි)')}
                                    </button>
                                    <button 
                                      onClick={() => {
                                        const customerPhone = customers.find(c => c.id === order.customer_id)?.phone || '';
                                        let cleanPhone = customerPhone.replace(/[\s_.-]/g, '');
                                        if (cleanPhone.startsWith('0')) {
                                          cleanPhone = '94' + cleanPhone.substring(1);
                                        } else if (cleanPhone.startsWith('7')) {
                                          cleanPhone = '94' + cleanPhone;
                                        } else if (cleanPhone.startsWith('+')) {
                                          cleanPhone = cleanPhone.substring(1);
                                        }
                                        const message = t(
                                          `Dear ${order.customerName}, this is a reminder that your invoice ${order.invoiceNo} of Rs. ${order.total.toLocaleString()} is overdue since ${order.due_date ? new Date(order.due_date).toLocaleDateString() : ''}. Please settle it as soon as possible. Thank you!`,
                                          `හිතවත් ${order.customerName}, ඔබගේ ${order.invoiceNo} අංක දරන රු. ${order.total.toLocaleString()} ක බිල්පත ${order.due_date ? new Date(order.due_date).toLocaleDateString() : ''} දින සිට කල් ඉකුත් වී ඇති බැවින් එය හැකි ඉක්මනින් පියවන මෙන් කාරුණිකව මතක් කර සිටිමු. ස්තූතියි!`
                                        );
                                        window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
                                      }}
                                      className="p-1.5 text-green-500 hover:text-green-700 hover:bg-green-50 rounded-lg transition-all"
                                      title={t('Send WhatsApp Reminder', 'WhatsApp මතක් කිරීම යවන්න')}
                                    >
                                      <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                                        <path d="M12.004 2c-5.517 0-9.996 4.478-9.996 9.995 0 1.761.459 3.473 1.332 4.985l-1.419 5.179 5.305-1.391c1.467.8 3.1 1.222 4.778 1.222 5.517 0 9.996-4.478 9.996-9.995 0-5.517-4.479-9.995-9.996-9.995zm.004 18.232c-1.564 0-3.098-.419-4.439-1.213l-.319-.189-3.298.865.88-3.212-.208-.331c-.872-1.389-1.332-3.003-1.332-4.664 0-4.524 3.679-8.203 8.204-8.203 2.228 0 4.322.868 5.895 2.443 1.574 1.575 2.442 3.669 2.442 5.896 0 4.525-3.68 8.213-8.234 8.213zm4.516-6.151c-.247-.123-1.464-.722-1.692-.805-.227-.083-.393-.123-.559.123-.166.246-.64.805-.785.97-.145.166-.29.186-.537.063-.247-.123-1.042-.383-1.986-1.225-.733-.653-1.229-1.461-1.373-1.708-.145-.246-.016-.379.108-.501.112-.11.247-.29.37-.435.123-.145.166-.246.247-.411.083-.166.042-.31-.021-.435-.063-.123-.559-1.348-.765-1.847-.2-.486-.403-.42-.559-.427-.145-.008-.31-.01-.475-.01s-.435.063-.663.31c-.227.247-.868.848-.868 2.068 0 1.221.889 2.401 1.013 2.566.124.166 1.748 2.67 4.235 3.74.592.255 1.053.407 1.413.522.595.189 1.137.162 1.565.099.477-.071 1.464-.598 1.67-.1.206-.496.206-.921.144-.997-.062-.077-.227-.123-.474-.247z"/>
                                      </svg>
                                    </button>
                                  </>
                                )}
                                <button 
                                  onClick={() => {
                                    setLastOrder(order);
                                    setShowReceipt(true);
                                  }} 
                                  className="p-1.5 text-gray-400 hover:text-[#DAA520] hover:bg-gray-50 rounded-lg transition-all"
                                  title={t('Preview', 'පෙරදසුන')}
                                >
                                  <ReceiptIcon className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => handlePrintReceipt(order)} 
                                  className="p-1.5 text-gray-400 hover:text-[#464646] hover:bg-gray-50 rounded-lg transition-all"
                                  title={t('Print', 'මුද්‍රණය')}
                                >
                                  <PrinterIcon className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'quotes' && (
        <div className="space-y-4 animate-in slide-in-from-bottom duration-500 text-left">
          {/* Header Actions */}
          <div className="flex justify-between items-center bg-white p-5 rounded-2xl border border-slate-100 shadow-xl shadow-slate-100/40 flex-wrap gap-4 animate-in fade-in duration-300">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
              <span className="w-1.5 h-4 bg-amber-500 rounded-full"></span>
              {t('Quotations / Estimates', 'මිල ගණන් කැඳවීම්')}
            </h3>
            <button
              onClick={() => {
                if (!isCreatingQuote) {
                  fetchNextQuoteNumber();
                }
                setIsCreatingQuote(!isCreatingQuote);
              }}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-800 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-slate-900/10 flex items-center gap-2"
            >
              <PlusIcon className="w-4 h-4 text-amber-400" />
              {isCreatingQuote ? t('View Quotation History', 'මිල ගණන් ලැයිස්තුව') : t('Create New Quotation', 'නව මිල ගණන් පත්‍රයක්')}
            </button>
          </div>

          {/* Quotation Container (Unified Sub-Items & Barcode Search Engine) */}
          {(() => {
            const handleAddSelectableToQuoteCart = (item: typeof matchingQuoteSelectables[0]) => {
              setQuoteCart(prev => {
                const existingIdx = prev.findIndex(i => i.productId === item.productId && (i.unit || '').toLowerCase() === item.unit.toLowerCase());
                if (existingIdx >= 0) {
                  const updated = [...prev];
                  updated[existingIdx].qty += 1;
                  updated[existingIdx].total = updated[existingIdx].qty * updated[existingIdx].price;
                  return updated;
                }

                const newItem: SaleItem = {
                  productId: item.productId,
                  productName: item.displayName,
                  qty: 1,
                  price: item.price,
                  total: item.price,
                  unit: item.unit,
                  conversionRate: item.conversionRate,
                  discount: 0,
                  discountType: 'amount',
                  taxRate: 0
                };
                return [...prev, newItem];
              });
            };

            // Financial Calculations
            const numDiscountValue = Number(quoteDiscountValue || 0);
            const numTransportationFee = Number(quoteTransportationFee || 0);
            const numTaxValue = Number(quoteTaxValue || 0);

            const quoteGrossSubtotal = quoteCart.reduce((sum, item) => sum + (item.qty * item.price), 0);
            const quoteProductDiscounts = quoteCart.reduce((sum, item) => {
              const gross = item.qty * item.price;
              const discVal = Number(item.discount || 0);
              const discType = item.discountType || 'amount';
              const discAmt = (discType === 'percent') ? (gross * discVal / 100) : discVal;
              return sum + discAmt;
            }, 0);
            const quoteNetItemSubtotal = Math.max(0, quoteGrossSubtotal - quoteProductDiscounts);

            const quoteOverallDiscountAmount = quoteDiscountType === 'percentage' 
              ? (quoteNetItemSubtotal * numDiscountValue / 100) 
              : numDiscountValue;
            const netAfterOverallDiscount = Math.max(0, quoteNetItemSubtotal - quoteOverallDiscountAmount);
            const quoteTaxAmount = quoteTaxType === 'percentage' 
              ? (netAfterOverallDiscount * numTaxValue / 100) 
              : numTaxValue;
            const quoteGrandTotal = Math.max(0, netAfterOverallDiscount + numTransportationFee + quoteTaxAmount);
            const quoteTotalSavings = quoteProductDiscounts + quoteOverallDiscountAmount;

            const handleSaveQuotation = async (action: 'save' | 'print' | 'pdf' = 'save') => {
              if (!quoteCustomerName.trim()) {
                return alert(t('Please enter or select customer name.', 'කරුණාකර පාරිභෝගිකයාගේ නම ඇතුළත් කරන්න.'));
              }
              if (quoteCart.length === 0) {
                return alert(t('Please add items to quotation.', 'කරුණාකර මිල ගණන් පත්‍රයට භාණ්ඩ එක් කරන්න.'));
              }

              const payload = {
                quote_no: quoteNo,
                customer_name: quoteCustomerName,
                customer_phone: quoteCustomerPhone,
                customer_address: quoteCustomerAddress,
                validity_period: quoteValidityPeriod || '30 Days',
                items: quoteCart,
                subtotal: quoteGrossSubtotal,
                discount_type: quoteDiscountType,
                discount_value: numDiscountValue,
                discount_amount: quoteOverallDiscountAmount,
                transportation_fee: numTransportationFee,
                tax_amount: quoteTaxAmount,
                total: quoteGrandTotal,
                status: 'Active'
              };

              try {
                setIsLoading(true);
                const res = await fetchWithTimeout(`${API_URL}/quotations`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                });
                
                let result = null;
                if (res.ok) {
                  result = await res.json();
                } else {
                  // Fallback to Supabase
                  const { error } = await supabase.from('quotations').insert([payload]);
                  if (error) throw error;
                }

                const savedQuote = { ...payload, created_at: new Date().toISOString() };

                if (action === 'print') {
                  const htmlContent = generateQuotePrintHTML(savedQuote, isSinhala, shopSettings);
                  const iframe = document.createElement('iframe');
                  iframe.style.position = 'fixed';
                  iframe.style.right = '0';
                  iframe.style.bottom = '0';
                  iframe.style.width = '0';
                  iframe.style.height = '0';
                  iframe.style.border = '0';
                  document.body.appendChild(iframe);
                  const doc = iframe.contentWindow?.document || iframe.contentDocument;
                  if (doc) {
                    doc.open();
                    doc.write(htmlContent);
                    doc.close();
                  }
                  setTimeout(() => {
                    iframe.contentWindow?.focus();
                    iframe.contentWindow?.print();
                    setTimeout(() => {
                      if (document.body.contains(iframe)) document.body.removeChild(iframe);
                    }, 1000);
                  }, 300);
                } else if (action === 'pdf') {
                  await handleDownloadQuotePDF(savedQuote);
                }

                alert(t(`Quotation ${payload.quote_no} saved successfully!`, `මිල ගණන් පත්‍රය ${payload.quote_no} සාර්ථකව සුරකින ලදී!`));

                // Reset
                setQuoteCart([]);
                setQuoteCustomerName('');
                setQuoteCustomerPhone('');
                setQuoteCustomerAddress('');
                setQuoteDiscountValue('');
                setQuoteTransportationFee('');
                setQuoteTaxValue('');
                setIsCreatingQuote(false);
                await fetchData();
              } catch (err: any) {
                alert(t('Failed to save quotation: ', 'මිල ගණන් පත්‍රය සුරැකීමට අපොහොසත් විය: ') + err.message);
              } finally {
                setIsLoading(false);
              }
            };

            if (isCreatingQuote) {
              return (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                  {/* Left Column: Customer Details & Product Selection */}
                  <div className="xl:col-span-1 space-y-4">
                    {/* Customer Information Card */}
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3.5 shadow-sm">
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2.5">
                        <UserIcon className="w-4 h-4 text-amber-500" />
                        {t('Quotation & Customer Details', 'මිල ගණන් පත්‍රයේ සහ පාරිභෝගික තොරතුරු')}
                      </h4>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('Quotation No', 'මිල ගණන් අංකය')}</label>
                          <input
                            type="text"
                            value={quoteNo}
                            onChange={(e) => setQuoteNo(e.target.value)}
                            className="w-full px-3 py-2 bg-amber-50/70 border border-amber-200 rounded-xl text-xs font-black font-mono text-amber-900 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('Validity Period', 'වලංගු කාලය')}</label>
                          <select
                            value={quoteValidityPeriod}
                            onChange={(e) => setQuoteValidityPeriod(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500"
                          >
                            <option value="7 Days">7 Days</option>
                            <option value="14 Days">14 Days</option>
                            <option value="30 Days">30 Days</option>
                            <option value="60 Days">60 Days</option>
                            <option value="90 Days">90 Days</option>
                          </select>
                        </div>
                      </div>

                      {/* Select Existing Customer Dropdown */}
                      <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('Select Existing Customer', 'පවතින පාරිභෝගිකයෙකු තෝරන්න')}</label>
                        <select
                          onChange={(e) => {
                            const foundCust = customers.find(c => c.id === e.target.value);
                            if (foundCust) {
                              setQuoteCustomerName(foundCust.name);
                              setQuoteCustomerPhone(foundCust.phone || '');
                              setQuoteCustomerAddress(foundCust.address || '');
                            }
                          }}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500"
                        >
                          <option value="">-- {t('Manual Entry / Select Customer', 'පාරිභෝගිකයා තෝරන්න')} --</option>
                          {customers.map(c => (
                            <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ''}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('Customer Name *', 'පාරිභෝගිකයාගේ නම *')}</label>
                        <input
                          type="text"
                          placeholder={t('Customer name...', 'පාරිභෝගිකයාගේ නම...')}
                          value={quoteCustomerName}
                          onChange={(e) => setQuoteCustomerName(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('Phone Number', 'දුරකථන අංකය')}</label>
                          <input
                            type="text"
                            placeholder="077 123 4567"
                            value={quoteCustomerPhone}
                            onChange={(e) => setQuoteCustomerPhone(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{t('Address', 'ලිපිනය')}</label>
                          <input
                            type="text"
                            placeholder="Street, City..."
                            value={quoteCustomerAddress}
                            onChange={(e) => setQuoteCustomerAddress(e.target.value)}
                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Product & Sub-Items Search Card */}
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3.5 shadow-sm">
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-2.5">
                        <SearchIcon className="w-4 h-4 text-amber-500" />
                        {t('Search Products & Sub-Items', 'භාණ්ඩ සහ උප-භාණ්ඩ සොයන්න')}
                      </h4>

                      <div className="relative">
                        <input
                          type="text"
                          ref={quoteSearchInputRef}
                          placeholder={t('Scan barcode or type name, sub-item, SKU & press Enter...', 'බාර්කෝඩ් ස්කෑන් කරන්න හෝ නම ගහලා Enter ඔබන්න...')}
                          value={quoteSearch}
                          onChange={(e) => {
                            const val = e.target.value;
                            setQuoteSearch(val);
                            if (val.trim()) {
                              const q = val.trim().toLowerCase();
                              const exactMatch = matchingQuoteSelectables.find(i => i.barcode && i.barcode.trim().toLowerCase() === q);
                              if (exactMatch) {
                                handleAddSelectableToQuoteCart(exactMatch);
                                setQuoteSearch('');
                              }
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (!quoteSearch.trim()) return;
                              if (matchingQuoteSelectables.length > 0) {
                                handleAddSelectableToQuoteCart(matchingQuoteSelectables[0]);
                                setQuoteSearch('');
                              } else {
                                alert(t(`No product matching "${quoteSearch}" found!`, `"${quoteSearch}" නමින් භාණ්ඩයක් හමු නොවීය!`));
                              }
                            }
                          }}
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-amber-500"
                        />
                        {quoteSearch && (
                          <button type="button" onClick={() => setQuoteSearch('')} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 text-xs font-bold">✕</button>
                        )}
                      </div>

                      {/* Matching Selectables List (Sand, Bucket, Shovel, Sub-items) */}
                      <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 pr-1">
                        {matchingQuoteSelectables.length === 0 ? (
                          <div className="py-4 text-center text-slate-400 font-bold text-xs italic">
                            {t('No products or sub-items found.', 'කිසිදු භාණ්ඩයක් හමු නොවීය.')}
                          </div>
                        ) : (
                          matchingQuoteSelectables.slice(0, 15).map(item => (
                            <div
                              key={item.key}
                              onClick={() => {
                                handleAddSelectableToQuoteCart(item);
                                setQuoteSearch('');
                              }}
                              className="py-2.5 px-3 cursor-pointer hover:bg-amber-50/70 flex justify-between items-center transition-all rounded-xl group border border-transparent hover:border-amber-200"
                            >
                              <div className="space-y-0.5">
                                <div className="text-xs font-bold text-slate-800 group-hover:text-amber-900 flex items-center gap-1.5">
                                  <span>{item.displayName}</span>
                                  {item.isSubItem && (
                                    <span className="px-1 py-0.2 bg-amber-100 text-amber-800 text-[8px] font-black rounded uppercase">Sub</span>
                                  )}
                                </div>
                                <div className="text-[9px] text-slate-400 font-mono">
                                  Cat: {item.category} • SKU: {item.sku || 'N/A'} • Barcode: {item.barcode || 'N/A'}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs font-black text-amber-600">{symbol} {convert(item.price).toLocaleString()}</div>
                                <span className="text-[9px] font-black text-amber-700 uppercase bg-amber-100 px-2 py-0.5 rounded group-hover:bg-amber-500 group-hover:text-white transition-all">+ Add</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Quotation Cart, Charges & Summary */}
                  <div className="xl:col-span-2 space-y-4">
                    <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col min-h-[450px] shadow-sm">
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-3 mb-4 flex justify-between items-center">
                        <span>{t('Quotation Product Items', 'මිල ගණන් භාණ්ඩ ලැයිස්තුව')}</span>
                        <span className="text-slate-400 font-bold text-xs">{quoteCart.length} items</span>
                      </h4>

                      {/* Product Cart Table */}
                      <div className="flex-1 overflow-x-auto">
                        <table className="w-full text-xs text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-black text-slate-400 tracking-widest uppercase">
                              <th className="px-3 py-2.5">{t('Item Description', 'භාණ්ඩය')}</th>
                              <th className="px-3 py-2.5 text-center w-24">{t('Qty', 'ප්‍රමාණය')}</th>
                              <th className="px-3 py-2.5 text-right w-28">{t('Unit Price', 'ඒකක මිල')}</th>
                              <th className="px-3 py-2.5 text-right w-36">{t('Discount', 'වට්ටම්')}</th>
                              <th className="px-3 py-2.5 text-right w-28">{t('Line Total', 'එකතුව')}</th>
                              <th className="px-3 py-2.5 text-center w-12"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {quoteCart.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-12 text-center text-slate-400 font-bold italic">
                                  {t('No items added yet. Search or scan barcode on the left to add products.', 'තවමත් භාණ්ඩ එකතු කර නොමැත.')}
                                </td>
                              </tr>
                            ) : (
                              quoteCart.map((item, idx) => {
                                const gross = item.qty * item.price;
                                const discVal = item.discount || 0;
                                const normType = item.discountType || 'amount';
                                const discAmt = normType === 'percent' ? (gross * discVal / 100) : discVal;
                                const rowTotal = item.total !== undefined ? item.total : Math.max(0, gross - discAmt);

                                return (
                                  <tr key={`${item.productId}_${item.unit}_${idx}`} className="hover:bg-slate-50/60 transition-colors">
                                    <td className="px-3 py-2.5 font-bold text-slate-800">
                                      {item.productName}
                                      {item.unit && <span className="ml-1.5 px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded text-[9px] font-bold">{item.unit}</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                      <input
                                        type="number"
                                        min={0}
                                        step="any"
                                        value={item.qty === 0 ? '' : item.qty}
                                        onFocus={(e) => e.target.select()}
                                        onChange={(e) => {
                                          const valStr = e.target.value;
                                          const newQty = valStr === '' ? 0 : Math.max(0, parseFloat(valStr) || 0);
                                          const updated = [...quoteCart];
                                          updated[idx].qty = newQty;
                                          const itemGross = newQty * updated[idx].price;
                                          const itemDiscVal = updated[idx].discount || 0;
                                          const itemNormType = updated[idx].discountType || 'amount';
                                          const itemDiscAmt = itemNormType === 'percent' ? (itemGross * itemDiscVal / 100) : itemDiscVal;
                                          updated[idx].total = Math.max(0, itemGross - itemDiscAmt);
                                          setQuoteCart(updated);
                                        }}
                                        onBlur={() => {
                                          if (!item.qty || item.qty <= 0) {
                                            const updated = [...quoteCart];
                                            updated[idx].qty = 1;
                                            const itemGross = 1 * updated[idx].price;
                                            const itemDiscVal = updated[idx].discount || 0;
                                            const itemNormType = updated[idx].discountType || 'amount';
                                            const itemDiscAmt = itemNormType === 'percent' ? (itemGross * itemDiscVal / 100) : itemDiscVal;
                                            updated[idx].total = Math.max(0, itemGross - itemDiscAmt);
                                            setQuoteCart(updated);
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            (e.target as HTMLElement).blur();
                                          }
                                        }}
                                        className="w-16 text-center border border-slate-300 rounded-lg px-2 py-1 font-bold text-slate-800 text-xs outline-none focus:border-amber-500"
                                      />
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold text-slate-700">
                                      <input
                                        type="number"
                                        min={0}
                                        value={item.price}
                                        onChange={(e) => {
                                          const newPrice = Math.max(0, parseFloat(e.target.value) || 0);
                                          const updated = [...quoteCart];
                                          updated[idx].price = newPrice;
                                          const itemGross = updated[idx].qty * newPrice;
                                          const itemDiscVal = updated[idx].discount || 0;
                                          const itemNormType = updated[idx].discountType || 'amount';
                                          const itemDiscAmt = itemNormType === 'percent' ? (itemGross * itemDiscVal / 100) : itemDiscVal;
                                          updated[idx].total = Math.max(0, itemGross - itemDiscAmt);
                                          setQuoteCart(updated);
                                        }}
                                        className="w-24 text-right border border-slate-300 rounded-lg px-2 py-1 font-bold text-slate-800 text-xs outline-none focus:border-amber-500"
                                      />
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold text-slate-700">
                                      <div className="flex gap-1 items-center justify-end">
                                        <select
                                          value={item.discountType || 'amount'}
                                          onChange={(e) => {
                                            const newDiscType = e.target.value as 'percent' | 'amount';
                                            const updated = [...quoteCart];
                                            updated[idx].discountType = newDiscType;
                                            const itemGross = updated[idx].qty * updated[idx].price;
                                            const itemDiscVal = updated[idx].discount || 0;
                                            const itemDiscAmt = newDiscType === 'percent' ? (itemGross * itemDiscVal / 100) : itemDiscVal;
                                            updated[idx].total = Math.max(0, itemGross - itemDiscAmt);
                                            setQuoteCart(updated);
                                          }}
                                          className="bg-slate-100 text-[10px] font-bold text-slate-700 px-1 py-1 rounded border border-slate-200 outline-none"
                                        >
                                          <option value="amount">Rs.</option>
                                          <option value="percent">%</option>
                                        </select>
                                        <input
                                          type="number"
                                          min={0}
                                          value={item.discount !== undefined && item.discount !== null ? item.discount : ''}
                                          placeholder="0"
                                          onChange={(e) => {
                                            const newDiscVal = Math.max(0, parseFloat(e.target.value) || 0);
                                            const updated = [...quoteCart];
                                            updated[idx].discount = newDiscVal;
                                            const itemGross = updated[idx].qty * updated[idx].price;
                                            const itemNormType = updated[idx].discountType || 'amount';
                                            const itemDiscAmt = itemNormType === 'percent' ? (itemGross * newDiscVal / 100) : newDiscVal;
                                            updated[idx].total = Math.max(0, itemGross - itemDiscAmt);
                                            setQuoteCart(updated);
                                          }}
                                          className="w-16 text-right border border-slate-300 rounded-lg px-1.5 py-1 font-bold text-slate-800 text-xs outline-none focus:border-amber-500"
                                        />
                                      </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-black text-amber-700">
                                      {symbol} {convert(rowTotal).toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                      <button
                                        type="button"
                                        onClick={() => setQuoteCart(prev => prev.filter((_, i) => i !== idx))}
                                        className="text-rose-500 hover:text-rose-700 font-bold text-xs"
                                      >
                                        ✕
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Additional Charges Section (Transportation, Tax) */}
                      <div className="mt-4 pt-4 border-t border-slate-200/80 bg-slate-50/70 p-4 rounded-xl space-y-3">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('Optional Charges & Adjustments:', 'අමතර ගාස්තු:')}</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Transportation Fee */}
                          <div className="bg-white p-2.5 rounded-xl border border-slate-200 space-y-1">
                            <label className="text-[10px] font-bold text-slate-600 block">{t('Transportation Fee (Rs.)', 'ප්‍රවාහන ගාස්තු')}</label>
                            <input
                              type="number"
                              min={0}
                              placeholder="0"
                              value={quoteTransportationFee}
                              onChange={(e) => {
                                const val = e.target.value;
                                setQuoteTransportationFee(val === '' ? '' : Math.max(0, parseFloat(val) || 0));
                              }}
                              className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-bold text-slate-800 outline-none focus:border-amber-500"
                            />
                          </div>

                          {/* Tax */}
                          <div className="bg-white p-2.5 rounded-xl border border-slate-200 space-y-1">
                            <label className="text-[10px] font-bold text-slate-600 block">{t('Tax', 'බදු')}</label>
                            <div className="flex gap-1">
                              <select
                                value={quoteTaxType}
                                onChange={(e) => setQuoteTaxType(e.target.value as any)}
                                className="bg-slate-100 text-xs font-bold text-slate-700 px-1.5 py-1 rounded border border-slate-200 outline-none"
                              >
                                <option value="percentage">%</option>
                                <option value="amount">Rs.</option>
                              </select>
                              <input
                                type="number"
                                min={0}
                                placeholder="0"
                                value={quoteTaxValue}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setQuoteTaxValue(val === '' ? '' : Math.max(0, parseFloat(val) || 0));
                                }}
                                className="w-full px-2 py-1 border border-slate-200 rounded text-xs font-bold text-slate-800 outline-none focus:border-amber-500"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Financial Summary & Actions */}
                      <div className="border-t border-slate-200 pt-4 mt-4 flex justify-between items-center flex-wrap gap-4 bg-amber-50/50 p-4 rounded-xl border border-amber-200/60">
                        <div className="space-y-1 text-xs font-bold">
                          <div className="text-slate-500">{t('Subtotal (Gross):', 'උප එකතුව:')} <span className="text-slate-800">{symbol} {convert(quoteGrossSubtotal).toLocaleString()}</span></div>
                          {quoteProductDiscounts > 0 && (
                            <div className="text-emerald-700 font-black border-t border-dashed border-amber-300/80 pt-1">
                              {t('Total Savings / Discount:', 'මුළු ඉතිරිය / වට්ටම:')} <span className="text-emerald-700">-{symbol} {convert(quoteProductDiscounts).toLocaleString()}</span>
                            </div>
                          )}
                          {numTransportationFee > 0 && <div className="text-blue-600">{t('Transportation:', 'ප්‍රවාහන ගාස්තු:')} +{symbol} {convert(numTransportationFee).toLocaleString()}</div>}
                          {quoteTaxAmount > 0 && <div className="text-amber-700">{t('Tax:', 'බදු:')} +{symbol} {convert(quoteTaxAmount).toLocaleString()}</div>}
                          <div className="text-sm font-black text-amber-900 border-t border-amber-200 pt-1">
                            {t('Grand Total:', 'මුළු එකතුව:')} <span className="text-amber-600">{symbol} {convert(quoteGrandTotal).toLocaleString()}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedQuotePreview({
                                id: 'preview',
                                quote_no: quoteNo,
                                customer_name: quoteCustomerName || 'Guest Customer',
                                customer_phone: quoteCustomerPhone,
                                customer_address: quoteCustomerAddress,
                                validity_period: quoteValidityPeriod,
                                items: quoteCart,
                                subtotal: quoteGrossSubtotal,
                                discount_type: quoteDiscountType,
                                discount_value: numDiscountValue,
                                discount_amount: quoteOverallDiscountAmount,
                                transportation_fee: numTransportationFee,
                                tax_amount: quoteTaxAmount,
                                total: quoteGrandTotal,
                                status: 'Draft',
                                created_at: new Date().toISOString()
                              });
                              setShowQuotePreviewModal(true);
                            }}
                            className="px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 font-bold rounded-xl text-xs uppercase tracking-wider shadow-sm transition-all"
                          >
                            {t('Preview', 'පූර්ව දර්ශනය')}
                          </button>

                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => handleSaveQuotation('print')}
                            className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:brightness-110 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-md flex items-center gap-1.5"
                          >
                            <PrinterIcon className="w-4 h-4" />
                            {t('Save & Print', 'සුරකින්න සහ මුද්‍රණය කරන්න')}
                          </button>

                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => handleSaveQuotation('pdf')}
                            className="px-5 py-2.5 bg-gradient-to-r from-red-600 to-red-700 hover:brightness-110 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-md flex items-center gap-1.5"
                          >
                            <DownloadIcon className="w-4 h-4" />
                            {t('Save & PDF', 'සුරකින්න සහ PDF')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            {/* Quotations History View */}
            return (
              <div className="bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-100/40 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 tracking-widest uppercase">
                        <th className="px-6 py-4.5">{t('Date', 'දිනය')}</th>
                        <th className="px-6 py-4.5">{t('Quotation No', 'මිල ගණන් අංකය')}</th>
                        <th className="px-6 py-4.5">{t('Customer', 'පාරිභෝගිකයා')}</th>
                        <th className="px-6 py-4.5">{t('Validity', 'වලංගු කාලය')}</th>
                        <th className="px-6 py-4.5 text-right">{t('Total', 'මුළු එකතුව')}</th>
                        <th className="px-6 py-4.5 text-center">{t('Actions', 'ක්‍රියාකාරකම්')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {quotes.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-slate-400 font-bold text-sm">
                            {t('No quotations found.', 'මිල ගණන් කැඳවීම් කිසිවක් හමු නොවීය.')}
                          </td>
                        </tr>
                      ) : (
                        quotes.map((quote) => (
                          <tr key={quote.id} className="hover:bg-slate-50/60 transition-all duration-200">
                            <td className="px-6 py-4 font-bold text-slate-500 text-xs">
                              {new Date(quote.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4 font-black text-slate-800 font-mono text-sm">
                              {quote.quote_no}
                            </td>
                            <td className="px-6 py-4 font-bold text-slate-800 text-sm">
                              <div>{quote.customer_name}</div>
                              {quote.customer_phone && <div className="text-[10px] text-slate-400 font-mono">{quote.customer_phone}</div>}
                            </td>
                            <td className="px-6 py-4 font-semibold text-slate-600 text-xs">
                              {quote.validity_period || '30 Days'}
                            </td>
                            <td className="px-6 py-4 text-right font-black text-amber-600 font-mono text-sm">
                              {symbol} {convert(quote.total).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 py-4 text-center flex items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedQuotePreview(quote);
                                  setShowQuotePreviewModal(true);
                                }}
                                className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs rounded-xl border border-amber-200 transition-colors"
                              >
                                {t('Preview', 'බලන්න')}
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  const htmlContent = generateQuotePrintHTML(quote, isSinhala, shopSettings);
                                  const iframe = document.createElement('iframe');
                                  iframe.style.position = 'fixed';
                                  iframe.style.right = '0';
                                  iframe.style.bottom = '0';
                                  iframe.style.width = '0';
                                  iframe.style.height = '0';
                                  iframe.style.border = '0';
                                  document.body.appendChild(iframe);
                                  const doc = iframe.contentWindow?.document || iframe.contentDocument;
                                  if (doc) {
                                    doc.open();
                                    doc.write(htmlContent);
                                    doc.close();
                                  }
                                  setTimeout(() => {
                                    iframe.contentWindow?.focus();
                                    iframe.contentWindow?.print();
                                    setTimeout(() => {
                                      if (document.body.contains(iframe)) document.body.removeChild(iframe);
                                    }, 1000);
                                  }, 300);
                                }}
                                className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl border border-slate-200/50 transition-colors"
                                title={t('Print Quote', 'මුද්‍රණය කරන්න')}
                              >
                                <PrinterIcon className="w-4 h-4 text-amber-500" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDownloadQuotePDF(quote)}
                                className="p-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl border border-red-200/50 transition-colors"
                                title={t('Download PDF', 'PDF බාගත කරන්න')}
                              >
                                <DownloadIcon className="w-4 h-4 text-red-600" />
                              </button>

                              <button
                                type="button"
                                onClick={async () => {
                                  if (window.confirm(t('Are you sure you want to delete this quotation?', 'මෙම මිල ගණන් පත්‍රය මැකීමට ඔබට විශ්වාසද?'))) {
                                    try {
                                      setIsLoading(true);
                                      await fetch(`${API_URL}/quotations/${quote.id}`, { method: 'DELETE' });
                                      await supabase.from('quotations').delete().eq('id', quote.id);
                                      await fetchData();
                                    } catch (err: any) {
                                      alert(t('Failed to delete quotation: ', 'මිල ගණන් පත්‍රය මැකීමට අපොහොසත් විය: ') + err.message);
                                    } finally {
                                      setIsLoading(false);
                                    }
                                  }
                                }}
                                className="p-2 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl border border-red-200/50 transition-colors"
                                title={t('Delete Quote', 'මකන්න')}
                              >
                                <Trash2Icon className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}



      {/* Sales Return Tab View */}
      {tab === 'returns' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-100/40 p-6">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-6">
              <span className="w-1.5 h-4 bg-amber-500 rounded-full"></span>
              {t('Process Sales Return & Exchange', 'විකුණුම් ආපසු භාරගැනීම සහ හුවමාරු')}
            </h3>

            {/* Search Invoice (Displays All Associated Bills for Barcode, Product Name, SKU, Invoice No) */}
            <div className="relative mb-6">
              <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl p-2 shadow-sm focus-within:ring-2 focus-within:ring-amber-500/20 focus-within:border-amber-500 transition-all">
                <SearchIcon className="w-5 h-5 text-slate-400 ml-2 shrink-0" />
                <input
                  type="text"
                  ref={returnSearchInputRef}
                  placeholder={t('Scan Barcode or Search by Product Name, Invoice #, Customer Name...', 'බාර්කෝඩ් ස්කෑන් කරන්න හෝ භාණ්ඩයේ නම, ඉන්වොයිස් අංකය, නම සෙවුම් කරන්න...')}
                  value={returnSearchQuery}
                  onChange={(e) => {
                    setReturnSearchQuery(e.target.value);
                    setShowBillSearchResults(true);
                  }}
                  onFocus={() => {
                    if (returnSearchQuery.trim().length >= 1) {
                      setShowBillSearchResults(true);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const q = returnSearchQuery.trim().toLowerCase();
                      if (!q) return;

                      // Find all matching products & invoices
                      const matchedProdIds = new Set(
                        products
                          .filter(p => 
                            (p.barcode && p.barcode.trim().toLowerCase().includes(q)) ||
                            (p.sku && p.sku.toLowerCase().includes(q)) ||
                            (p.name && p.name.toLowerCase().includes(q))
                          )
                          .map(p => p.id)
                      );

                      const matchedProdNames = new Set(
                        products
                          .filter(p => p.name && p.name.toLowerCase().includes(q))
                          .map(p => p.name.toLowerCase())
                      );

                      const matches = orders.filter(o => {
                        if (o.invoiceNo.toLowerCase().includes(q)) return true;
                        if (o.customerName && o.customerName.toLowerCase().includes(q)) return true;
                        const items = Array.isArray(o.items) ? o.items : safeParseJson(o.items, []);
                        return items.some((i: any) => 
                          (i.barcode && i.barcode.trim().toLowerCase().includes(q)) ||
                          (i.productName && i.productName.toLowerCase().includes(q)) ||
                          (i.name && i.name.toLowerCase().includes(q)) ||
                          (i.productId && matchedProdIds.has(i.productId)) ||
                          (i.productName && matchedProdNames.has(i.productName.toLowerCase()))
                        );
                      });

                      if (matches.length === 0) {
                        return alert(t(`No bills found containing barcode or details matching "${returnSearchQuery}"!`, `"${returnSearchQuery}" සඳහා ගැලපෙන පත් නැත!`));
                      }

                      // If exactly 1 associated bill, auto-select it directly
                      if (matches.length === 1) {
                        const selected = matches[0];
                        setTargetReturnInvoice(selected);
                        const initialQtys: Record<string, number> = {};
                        const items = Array.isArray(selected.items) ? selected.items : safeParseJson(selected.items, []);
                        items.forEach((item: any) => { 
                          const isMatch = q && (
                            (item.barcode && item.barcode.trim().toLowerCase().includes(q)) ||
                            (item.productName && item.productName.toLowerCase().includes(q)) ||
                            (item.productId && matchedProdIds.has(item.productId))
                          );
                          initialQtys[item.productId] = isMatch ? 1 : 0; 
                        });
                        setReturnQtys(initialQtys);
                        setShowBillSearchResults(false);
                      }
                    }
                  }}
                  className="bg-transparent text-sm font-bold text-slate-800 outline-none w-full placeholder-slate-400 py-1"
                />
                {returnSearchQuery && (
                  <button type="button" onClick={() => { setReturnSearchQuery(''); setShowBillSearchResults(true); }} className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1">✕</button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const q = returnSearchQuery.trim().toLowerCase();
                    if (!q) return alert(t('Please enter a product name, barcode, invoice number, or customer name.', 'කරුණාකර භාණ්ඩ නමක්, බාර්කෝඩ් හෝ ඉන්වොයිස් අංකයක් ඇතුළත් කරන්න.'));

                    const matchedProdIds = new Set(
                      products
                        .filter(p => 
                          (p.barcode && p.barcode.trim().toLowerCase().includes(q)) ||
                          (p.sku && p.sku.toLowerCase().includes(q)) ||
                          (p.name && p.name.toLowerCase().includes(q))
                        )
                        .map(p => p.id)
                    );

                    const matchedProdNames = new Set(
                      products
                        .filter(p => p.name && p.name.toLowerCase().includes(q))
                        .map(p => p.name.toLowerCase())
                    );

                    const matches = orders.filter(o => {
                      if (o.invoiceNo.toLowerCase().includes(q)) return true;
                      if (o.customerName && o.customerName.toLowerCase().includes(q)) return true;
                      const items = Array.isArray(o.items) ? o.items : safeParseJson(o.items, []);
                      return items.some((i: any) => 
                        (i.barcode && i.barcode.trim().toLowerCase().includes(q)) ||
                        (i.productName && i.productName.toLowerCase().includes(q)) ||
                        (i.name && i.name.toLowerCase().includes(q)) ||
                        (i.productId && matchedProdIds.has(i.productId)) ||
                        (i.productName && matchedProdNames.has(i.productName.toLowerCase()))
                      );
                    });

                    if (matches.length === 0) return alert(t(`No bills found containing barcode or details matching "${returnSearchQuery}"!`, `"${returnSearchQuery}" සඳහා ගැලපෙන පත් නැත!`));
                    
                    if (matches.length === 1) {
                      const selected = matches[0];
                      setTargetReturnInvoice(selected);
                      const initialQtys: Record<string, number> = {};
                      const items = Array.isArray(selected.items) ? selected.items : safeParseJson(selected.items, []);
                      items.forEach((item: any) => { 
                        const isMatch = q && (
                          (item.barcode && item.barcode.trim().toLowerCase().includes(q)) ||
                          (item.productName && item.productName.toLowerCase().includes(q)) ||
                          (item.productId && matchedProdIds.has(item.productId))
                        );
                        initialQtys[item.productId] = isMatch ? 1 : 0; 
                      });
                      setReturnQtys(initialQtys);
                      setShowBillSearchResults(false);
                    }
                  }}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-md flex items-center gap-1 shrink-0"
                >
                  <SearchIcon className="w-3.5 h-3.5" />
                  {t('Search Bills', 'පත් සොයන්න')}
                </button>
              </div>

              {/* Display ALL Bills Associated with Barcode / Product Search Query */}
              {showBillSearchResults && returnSearchQuery.trim().length >= 1 && (() => {
                const q = returnSearchQuery.trim().toLowerCase();

                const matchedProdIds = new Set(
                  products
                    .filter(p => 
                      (p.barcode && p.barcode.trim().toLowerCase().includes(q)) ||
                      (p.sku && p.sku.toLowerCase().includes(q)) ||
                      (p.name && p.name.toLowerCase().includes(q))
                    )
                    .map(p => p.id)
                );

                const matchedProdNames = new Set(
                  products
                    .filter(p => p.name && p.name.toLowerCase().includes(q))
                    .map(p => p.name.toLowerCase())
                );

                const matchedInvoices = orders.filter(o => {
                  if (o.invoiceNo.toLowerCase().includes(q)) return true;
                  if (o.customerName && o.customerName.toLowerCase().includes(q)) return true;
                  const items = Array.isArray(o.items) ? o.items : safeParseJson(o.items, []);
                  return items.some((i: any) => 
                    (i.barcode && i.barcode.trim().toLowerCase().includes(q)) ||
                    (i.productName && i.productName.toLowerCase().includes(q)) ||
                    (i.name && i.name.toLowerCase().includes(q)) ||
                    (i.productId && matchedProdIds.has(i.productId)) ||
                    (i.productName && matchedProdNames.has(i.productName.toLowerCase()))
                  );
                });

                if (matchedInvoices.length === 0) {
                  return (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl border border-rose-200 shadow-2xl z-50 p-4 text-center">
                      <p className="text-xs font-bold text-rose-600">
                        {t(`No bills found containing barcode or product matching "${returnSearchQuery}".`, `"${returnSearchQuery}" සඳහා කිසිදු පතක් හමු නොවීය.`)}
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl border border-slate-200 shadow-2xl z-50 max-h-96 overflow-y-auto divide-y divide-slate-100 p-3 space-y-2">
                    <div className="flex justify-between items-center px-1 pb-1">
                      <span className="text-[11px] font-black text-amber-700 uppercase tracking-wider flex items-center gap-1.5">
                        <ReceiptIcon className="w-4 h-4 text-amber-500" />
                        {t('Associated Bills Found:', 'අදාළ සියලුම ඉන්වොයිස් පත්:')} ({matchedInvoices.length} {t('Bills', 'පත්')})
                      </span>
                      <span className="text-[10px] text-slate-400 font-semibold">
                        {t('Click a bill below to select it for return', 'පහතින් පතක් තෝරන්න')}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-2 pt-1">
                      {matchedInvoices.map((inv) => {
                        const items = Array.isArray(inv.items) ? inv.items : safeParseJson(inv.items, []);
                        const matchedProds = items.filter((i: any) => 
                          (i.barcode && i.barcode.trim().toLowerCase().includes(q)) ||
                          (i.productName && i.productName.toLowerCase().includes(q)) ||
                          (i.name && i.name.toLowerCase().includes(q)) ||
                          (i.productId && matchedProdIds.has(i.productId)) ||
                          (i.productName && matchedProdNames.has(i.productName.toLowerCase()))
                        );

                        const isCurrentlySelected = targetReturnInvoice?.id === inv.id;

                        return (
                          <div
                            key={inv.id}
                            onClick={() => {
                              setTargetReturnInvoice(inv);
                              const initialQtys: Record<string, number> = {};
                              items.forEach((item: any) => { 
                                const isMatch = (item.barcode && item.barcode.trim().toLowerCase().includes(q)) ||
                                                (item.productName && item.productName.toLowerCase().includes(q)) ||
                                                (item.productId && matchedProdIds.has(item.productId));
                                initialQtys[item.productId] = isMatch ? 1 : 0; 
                              });
                              setReturnQtys(initialQtys);
                              setShowBillSearchResults(false);
                            }}
                            className={`p-3 rounded-xl transition-all cursor-pointer border flex justify-between items-center group ${isCurrentlySelected ? 'bg-amber-100/90 border-amber-400 shadow-sm' : 'bg-slate-50/70 hover:bg-amber-50/70 border-slate-200 hover:border-amber-300'}`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-black text-xs text-slate-900 group-hover:text-amber-700 bg-white px-2 py-0.5 rounded border border-slate-200">{inv.invoiceNo}</span>
                                <span className="font-bold text-xs text-slate-800">{inv.customerName || 'Guest Customer'}</span>
                                {inv.customerPhone && <span className="text-[10px] text-slate-400 font-semibold">({inv.customerPhone})</span>}
                                <span className="text-[10px] text-slate-400 font-semibold ml-1">{formatInvoiceDateTime(inv.created_at, inv.date)}</span>
                              </div>
                              {matchedProds.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {matchedProds.map((mp: any, mpIdx: number) => (
                                    <span key={mpIdx} className="px-2 py-0.5 bg-amber-200/80 text-amber-900 text-[10px] font-black rounded-md flex items-center gap-1">
                                      <span>Matched:</span>
                                      <span>{mp.productName}</span>
                                      <span className="text-amber-700">({mp.qty || 1} {mp.unit || 'pcs'} @ {symbol} {convert(mp.price).toLocaleString()})</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="text-right shrink-0 ml-3">
                              <span className="font-black text-xs text-slate-900 block">{symbol} {convert(inv.total).toLocaleString()}</span>
                              <span className={`inline-block mt-1 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${isCurrentlySelected ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-900 text-amber-400 group-hover:bg-amber-500 group-hover:text-slate-950'}`}>
                                {isCurrentlySelected ? '✓ Selected' : t('Select Bill →', 'පත තෝරන්න →')}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Selected Invoice Return Details */}
            {targetReturnInvoice && (() => {
              // Helper to generate a unique invoice line item key (using lineId or invoiceNo + lineIndex)
              const getItemLineKey = (item: any, idx?: number) => {
                if (item.lineId || item.line_id) return `${targetReturnInvoice.invoiceNo}_${item.lineId || item.line_id}`;
                const pId = item.productId || item.product_id || '';
                const uKey = (item.unit || '').toLowerCase().trim();
                const lineIdx = item.lineIndex !== undefined ? item.lineIndex : idx;
                return lineIdx !== undefined ? `${targetReturnInvoice.invoiceNo}_line_${lineIdx}` : `${targetReturnInvoice.invoiceNo}_${pId}_${uKey}`;
              };

              // Calculate already returned quantities map per line item for this invoice across active returns
              const alreadyReturnedMap: Record<string, number> = {};
              salesReturnsList
                .filter(sr => sr.status !== 'voided' && (sr.invoiceNo === targetReturnInvoice.invoiceNo || sr.invoice_no === targetReturnInvoice.invoiceNo))
                .forEach(sr => {
                  const items = Array.isArray(sr.returnedItems) ? sr.returnedItems : safeParseJson(sr.returnedItems, []);
                  items.forEach((ri: any, riIdx: number) => {
                    const lKey = getItemLineKey(ri, ri.lineIndex !== undefined ? ri.lineIndex : riIdx);
                    alreadyReturnedMap[lKey] = (alreadyReturnedMap[lKey] || 0) + Number(ri.qty || 0);
                  });
                });

              const targetItems = Array.isArray(targetReturnInvoice.items) ? targetReturnInvoice.items : safeParseJson(targetReturnInvoice.items, []);

              const itemsToReturn = targetItems
                .filter((item: any, idx: number) => {
                  const lKey = getItemLineKey(item, idx);
                  const qtyVal = returnQtys[lKey] !== undefined ? returnQtys[lKey] : 0;
                  return qtyVal > 0;
                })
                .map((item: any, idx: number) => {
                  const lKey = getItemLineKey(item, idx);
                  const qtyVal = returnQtys[lKey] !== undefined ? returnQtys[lKey] : 0;
                  return {
                    ...item,
                    lineId: lKey,
                    lineIndex: idx,
                    qty: qtyVal
                  };
                });

              const origSubtotal = Number(targetReturnInvoice.subtotal !== undefined ? targetReturnInvoice.subtotal : ((targetReturnInvoice as any).subTotal || 0)) || 1;
              const origDiscount = Number(targetReturnInvoice.discount || 0);
              const origTax = Number(targetReturnInvoice.tax || 0);
              const origTransportFee = Number(targetReturnInvoice.transportation_fee !== undefined ? targetReturnInvoice.transportation_fee : ((targetReturnInvoice as any).transportationFee || 0));

              const returnedProductsSubtotal = itemsToReturn.reduce((sum: number, i: any) => sum + (i.qty * (i.price || 0)), 0);
              const returnRatio = Math.min(1, Math.max(0, returnedProductsSubtotal / origSubtotal));

              const applicableDiscount = includeReturnDiscount ? (origDiscount * returnRatio) : 0;
              const applicableTax = includeReturnTax ? (origTax * returnRatio) : 0;
              const applicableTransport = includeReturnTransport ? (origTransportFee * (returnedProductsSubtotal > 0 ? 1 : 0)) : 0;

              const returnTotalValue = Math.max(0, returnedProductsSubtotal - applicableDiscount + applicableTax + applicableTransport);
              const exchangeTotalValue = exchangeCartItems.reduce((sum: number, i: any) => sum + (i.qty * i.price), 0);
              const netExchangeBalance = exchangeTotalValue - returnTotalValue;

              const handleConfirmProcessReturn = async () => {
                if (itemsToReturn.length === 0) {
                  return alert(t('Please select at least 1 product quantity to return.', 'කරුණාකර ආපසු බාරදීමට අවම වශයෙන් එක් භාණ්ඩයකවත් ප්‍රමාණයක් ඇතුළත් කරන්න.'));
                }

                if (returnMethod === 'Exchange') {
                  if (exchangeCartItems.length === 0) {
                    return alert(t('Please add at least 1 replacement product for exchange.', 'කරුණාකර හුවමාරුව සඳහා අවම වශයෙන් එක් නව භාණ්ඩයක්වත් ඇතුළත් කරන්න.'));
                  }
                  if (netExchangeBalance > 0 && exchangeCustomerPaid < netExchangeBalance) {
                    return alert(t(`Customer Payment (Rs. ${exchangeCustomerPaid}) is less than Balance Due (Rs. ${netExchangeBalance}).`, `පාරිභෝගිකයා ගෙවූ මුදල හිඟ මුදලට වඩා අඩුය.`));
                  }
                }

                const calculatedRefund = returnMethod === 'Cash Refund' 
                  ? returnTotalValue 
                  : (returnMethod === 'Exchange' && netExchangeBalance < 0 ? (exchangeRefundGiven || Math.abs(netExchangeBalance)) : 0);

                const calculatedPaid = returnMethod === 'Exchange' && netExchangeBalance > 0 ? exchangeCustomerPaid : 0;
                const calculatedChange = returnMethod === 'Exchange' && netExchangeBalance > 0 ? Math.max(0, exchangeCustomerPaid - netExchangeBalance) : 0;

                try {
                  setIsLoading(true);
                  const { data: { user } } = await supabase.auth.getUser();
                  const res = await fetchWithTimeout(`${API_URL}/sales/returns`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      invoiceNo: targetReturnInvoice.invoiceNo,
                      returnedItems: itemsToReturn,
                      exchangeItems: exchangeCartItems,
                      returnMethod,
                      returnAmount: returnTotalValue,
                      exchangeAmount: exchangeTotalValue,
                      balanceAmount: netExchangeBalance,
                      totalRefunded: calculatedRefund,
                      customerPaid: calculatedPaid,
                      changeGiven: calculatedChange,
                      customerName: targetReturnInvoice.customerName,
                      customerPhone: targetReturnInvoice.customerPhone,
                      userEmail: user?.email || 'system',
                      reason: returnReason
                    })
                  });

                  const result = await res.json();
                  if (!res.ok) throw new Error(result.error || 'Failed to process sales return');

                  alert(t('Sales Return processed successfully!', 'විකුණුම් ආපසු භාරගැනීම සාර්ථකයි!'));
                  
                  const newReturnRecord: SalesReturn = {
                    id: result.id,
                    returnNo: result.returnNo || result.return_no,
                    invoiceNo: targetReturnInvoice.invoiceNo,
                    customerName: targetReturnInvoice.customerName,
                    customerPhone: targetReturnInvoice.customerPhone,
                    returnedItems: itemsToReturn,
                    exchangeItems: exchangeCartItems,
                    returnMethod,
                    returnAmount: returnTotalValue,
                    exchangeAmount: exchangeTotalValue,
                    balanceAmount: netExchangeBalance,
                    totalRefunded: calculatedRefund,
                    customerPaid: calculatedPaid,
                    changeGiven: calculatedChange,
                    creditNoteNo: result.creditNoteNo,
                    status: 'active',
                    reason: returnReason,
                    created_at: new Date().toISOString()
                  };

                  setSelectedReturnPreview(newReturnRecord);
                  setShowReturnPreviewModal(true);

                  setTargetReturnInvoice(null);
                  setReturnQtys({});
                  setExchangeCartItems([]);
                  setReturnReason('');
                  setExchangeCustomerPaid(0);
                  setExchangeRefundGiven(0);
                  fetchSalesReturns();
                  fetchCreditNotes();
                  fetchData();
                } catch (err: any) {
                  alert(t('Failed to process return: ', 'ආපසු භාරගැනීම අසමත් විය: ') + err.message);
                } finally {
                  setIsLoading(false);
                }
              };

              return (
                <div className="bg-slate-50/60 rounded-2xl border border-slate-200/80 p-5 space-y-5 animate-in slide-in-from-top-3 duration-300">
                  <div className="flex justify-between items-center flex-wrap gap-2 border-b border-slate-200/60 pb-3">
                    <div>
                      <h4 className="text-base font-black text-slate-800 flex items-center gap-2">
                        {t('Invoice:', 'ඉන්වොයිසිය:')} <span className="font-mono text-amber-600">{targetReturnInvoice.invoiceNo}</span>
                        <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-black uppercase ${targetReturnInvoice.status === 'Fully Returned' ? 'bg-rose-100 text-rose-700' : targetReturnInvoice.status === 'Partially Returned' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                          {targetReturnInvoice.status}
                        </span>
                      </h4>
                      <p className="text-xs font-bold text-slate-500 mt-0.5">
                        {t('Customer:', 'පාරිභෝගිකයා:')} {targetReturnInvoice.customerName} | {t('Date:', 'දිනය:')} {targetReturnInvoice.date}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setTargetReturnInvoice(null);
                        setReturnQtys({});
                        setExchangeCartItems([]);
                        setShowBillSearchResults(true);
                        if (returnSearchInputRef.current) returnSearchInputRef.current.focus();
                      }}
                      className="text-xs font-bold text-slate-400 hover:text-slate-600 underline"
                    >
                      {t('Clear / Change Invoice', 'වෙනත් ඉන්වොයිසියක්')}
                    </button>
                  </div>

                  {/* Complete Original Bill Pricing Details Card */}
                  {(() => {
                    const method = (targetReturnInvoice.payment_method || (targetReturnInvoice as any).paymentMethod || '').toString().toLowerCase().trim();
                    const status = (targetReturnInvoice.status || '').toString().toLowerCase().trim();
                    const isCreditBill = method === 'credit' || method === 'credit sale' || (targetReturnInvoice as any).is_credit === true || status === 'non paid' || status === 'non-paid' || status === 'partially paid' || status === 'partially settled';

                    const origSubtotal = Number(targetReturnInvoice.subtotal !== undefined ? targetReturnInvoice.subtotal : ((targetReturnInvoice as any).subTotal || 0));
                    const origDiscount = Number(targetReturnInvoice.discount || 0);
                    const origTax = Number(targetReturnInvoice.tax || 0);
                    const origTransportFee = Number(targetReturnInvoice.transportation_fee !== undefined ? targetReturnInvoice.transportation_fee : (targetReturnInvoice.transportationFee || 0));
                    const origBillTotal = Number(targetReturnInvoice.total_amount !== undefined ? targetReturnInvoice.total_amount : (targetReturnInvoice.total || 0));
                    
                    let origPaidAmount = 0;
                    if (isCreditBill) {
                      origPaidAmount = Number(targetReturnInvoice.payment_received || 0);
                    } else {
                      origPaidAmount = targetReturnInvoice.payment_received !== undefined && targetReturnInvoice.payment_received !== null && Number(targetReturnInvoice.payment_received) > 0
                        ? Number(targetReturnInvoice.payment_received)
                        : origBillTotal;
                    }
                    const origOutstanding = Math.max(0, origBillTotal - origPaidAmount);

                    return (
                      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
                        <h5 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 border-b border-slate-100 pb-2">
                          <span>📊</span> {t('Original Bill Pricing & Payment Details', 'මුල් ඉන්වොයිසියේ මිල ගණන් සහ ගෙවීම් විස්තර')}
                        </h5>
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 text-xs">
                          {/* 1. Subtotal */}
                          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex flex-col justify-between">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">{t('Subtotal', 'උප එකතුව')}</span>
                            <span className="font-black text-slate-700 text-sm mt-1">{symbol} {convert(origSubtotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>

                          {/* 2. Selectable Discount */}
                          <label className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between select-none ${includeReturnDiscount ? 'bg-amber-50/90 border-amber-300 ring-2 ring-amber-500/20' : 'bg-slate-50/60 border-slate-200 opacity-50'}`}>
                            <div className="flex justify-between items-center">
                              <span className="text-[9px] font-black text-amber-800 uppercase tracking-widest block">{t('Discount', 'වට්ටම')}</span>
                              <input
                                type="checkbox"
                                checked={includeReturnDiscount}
                                onChange={(e) => setIncludeReturnDiscount(e.target.checked)}
                                className="w-3.5 h-3.5 text-amber-600 rounded border-gray-300 focus:ring-amber-500 cursor-pointer"
                              />
                            </div>
                            <div className="mt-1 flex items-baseline justify-between">
                              <span className={`font-black text-sm ${includeReturnDiscount ? 'text-amber-600' : 'text-slate-400 line-through'}`}>
                                -{symbol} {convert(origDiscount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                            <span className="text-[8px] font-bold text-amber-800/70 mt-0.5">
                              {includeReturnDiscount ? t('✓ Included', '✓ ඇතුළත්') : t('✗ Excluded', '✗ ඉවත් කර ඇත')}
                            </span>
                          </label>

                          {/* 3. Selectable Tax */}
                          <label className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between select-none ${includeReturnTax ? 'bg-emerald-50/90 border-emerald-300 ring-2 ring-emerald-500/20' : 'bg-slate-50/60 border-slate-200 opacity-50'}`}>
                            <div className="flex justify-between items-center">
                              <span className="text-[9px] font-black text-emerald-800 uppercase tracking-widest block">{t('Tax', 'බදු')}</span>
                              <input
                                type="checkbox"
                                checked={includeReturnTax}
                                onChange={(e) => setIncludeReturnTax(e.target.checked)}
                                className="w-3.5 h-3.5 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500 cursor-pointer"
                              />
                            </div>
                            <div className="mt-1 flex items-baseline justify-between">
                              <span className={`font-black text-sm ${includeReturnTax ? 'text-emerald-700' : 'text-slate-400 line-through'}`}>
                                +{symbol} {convert(origTax).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                            <span className="text-[8px] font-bold text-emerald-800/70 mt-0.5">
                              {includeReturnTax ? t('✓ Included', '✓ ඇතුළත්') : t('✗ Excluded', '✗ ඉවත් කර ඇත')}
                            </span>
                          </label>

                          {/* 4. Selectable Transport Fee */}
                          <label className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between select-none ${includeReturnTransport ? 'bg-blue-50/90 border-blue-300 ring-2 ring-blue-500/20' : 'bg-slate-50/60 border-slate-200 opacity-50'}`}>
                            <div className="flex justify-between items-center">
                              <span className="text-[9px] font-black text-blue-800 uppercase tracking-widest block">{t('Transport Fee', 'ප්‍රවාහන ගාස්තු')}</span>
                              <input
                                type="checkbox"
                                checked={includeReturnTransport}
                                onChange={(e) => setIncludeReturnTransport(e.target.checked)}
                                className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer"
                              />
                            </div>
                            <div className="mt-1 flex items-baseline justify-between">
                              <span className={`font-black text-sm ${includeReturnTransport ? 'text-blue-700' : 'text-slate-400 line-through'}`}>
                                +{symbol} {convert(origTransportFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                            <span className="text-[8px] font-bold text-blue-800/70 mt-0.5">
                              {includeReturnTransport ? t('✓ Included', '✓ ඇතුළත්') : t('✗ Excluded', '✗ ඉවත් කර ඇත')}
                            </span>
                          </label>

                          {/* 5. Final Bill Total */}
                          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex flex-col justify-between">
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">{t('Final Bill Total', 'අවසාන මුළු එකතුව')}</span>
                            <span className="font-black text-slate-900 text-sm mt-1">{symbol} {convert(origBillTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>

                          {/* 6. Paid Amount */}
                          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex flex-col justify-between">
                            <span className="text-[9px] font-black text-emerald-600 uppercase tracking-widest block">{t('Paid Amount', 'ගෙවූ මුදල')}</span>
                            <span className="font-black text-emerald-600 text-sm mt-1">{symbol} {convert(origPaidAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>

                          {/* 7. Outstanding / Credit */}
                          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex flex-col justify-between">
                            <span className="text-[9px] font-black text-rose-500 uppercase tracking-widest block">{t('Outstanding / Credit', 'හිඟ / ණය මුදල')}</span>
                            <span className={`font-black text-sm mt-1 ${isCreditBill ? 'text-rose-600' : 'text-slate-400'}`}>
                              {symbol} {convert(origOutstanding).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          </div>

                          {/* 8. Applicable Refund */}
                          <div className="bg-amber-50 p-2.5 rounded-xl border border-amber-200 shadow-sm flex flex-col justify-between">
                            <span className="text-[9px] font-black text-amber-800 uppercase tracking-widest block">{t('Applicable Refund', 'අදාළ ආපසු ගෙවීම')}</span>
                            <span className="font-black text-amber-700 text-sm mt-1">{symbol} {convert(returnTotalValue).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Return Product Search Input within Loaded Invoice (Barcode / Name Scanner Support) */}
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 space-y-2">
                    <label className="text-[10px] font-black text-amber-800 uppercase tracking-widest flex items-center gap-1.5">
                      <span>⚡</span> {t('Scan Product Barcode or Search Item Name to Select Return Quantity:', 'බාර්කෝඩ් ස්කෑන් කරන්න හෝ භාණ්ඩයේ නමෙන් සොයන්න:')}
                    </label>
                    <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3 py-1.5 shadow-inner">
                      <SearchIcon className="w-4 h-4 text-amber-500" />
                      <input
                        type="text"
                        placeholder={t('Scan barcode or type product name & press Enter...', 'බාර්කෝඩ් ස්කෑන් කරන්න හෝ නම ගහලා Enter ඔබන්න...')}
                        value={returnProductSearch}
                        onChange={(e) => {
                          const val = e.target.value;
                          setReturnProductSearch(val);
                          if (val.trim()) {
                            const exactMatch = targetItems.find((i: any) => i.barcode && i.barcode.trim().toLowerCase() === val.trim().toLowerCase());
                            if (exactMatch) {
                              const alreadyReturned = alreadyReturnedMap[exactMatch.productId] || 0;
                              const maxReturn = Math.max(0, Number(exactMatch.qty || 0) - alreadyReturned);
                              const curr = returnQtys[exactMatch.productId] || 0;
                              if (curr < maxReturn) {
                                setReturnQtys(prev => ({ ...prev, [exactMatch.productId]: curr + 1 }));
                                setReturnProductSearch('');
                              }
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (!returnProductSearch.trim()) return;
                            const q = returnProductSearch.trim().toLowerCase();
                            const matched = targetItems.find((i: any) => 
                              (i.barcode && i.barcode.trim().toLowerCase() === q) ||
                              (i.productName && i.productName.toLowerCase().includes(q))
                            );
                            if (!matched) {
                              alert(t(`Product "${returnProductSearch}" not found in this invoice!`, `මෙම ඉන්වොයිසියේ "${returnProductSearch}" භාණ්ඩය නොමැත!`));
                              return;
                            }
                            const alreadyReturned = alreadyReturnedMap[matched.productId] || 0;
                            const maxReturn = Math.max(0, Number(matched.qty || 0) - alreadyReturned);
                            const curr = returnQtys[matched.productId] || 0;
                            if (curr + 1 > maxReturn) {
                              alert(t(`Cannot exceed remaining returnable quantity (${maxReturn} remaining).`, `ඉතිරි ආපසු භාරගත හැකි ප්‍රමාණය ${maxReturn} කි.`));
                              return;
                            }
                            setReturnQtys(prev => ({ ...prev, [matched.productId]: curr + 1 }));
                            setReturnProductSearch('');
                          }
                        }}
                        className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none placeholder-slate-400"
                      />
                    </div>
                  </div>

                  {/* Items to Return Table with Remaining Qty Tracking */}
                  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100/80 border-b border-slate-200 text-[10px] font-black text-slate-500 tracking-widest uppercase">
                          <th className="px-4 py-3">{t('Item', 'භාණ්ඩය')}</th>
                          <th className="px-4 py-3 text-center">{t('Sold Qty', 'වික්ක ප්‍රමාණය')}</th>
                          <th className="px-4 py-3 text-center">{t('Prev Returned', 'කලින් ආපසු')}</th>
                          <th className="px-4 py-3 text-center">{t('Remaining Returnable', 'ඉතිරි ආපසු ප්‍රමාණය')}</th>
                          <th className="px-4 py-3 text-right">{t('Unit Price', 'ඒකක මිල')}</th>
                          <th className="px-4 py-3 text-center w-36">{t('Return Qty', 'ආපසු ප්‍රමාණය')}</th>
                          <th className="px-4 py-3 text-right">{t('Refund/Return Amount', 'ආපසු මුදල')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {targetItems.map((item: any, idx: number) => {
                          const lKey = getItemLineKey(item, idx);
                          const origQty = Number(item.qty || 0);
                          const prevReturned = alreadyReturnedMap[lKey] || 0;
                          const maxReturn = Math.max(0, origQty - prevReturned);
                          const currReturn = returnQtys[lKey] || 0;
                          const itemRefund = currReturn * item.price;
                          return (
                            <tr key={lKey} className={`hover:bg-slate-50/50 ${maxReturn === 0 ? 'bg-slate-50/60 opacity-60' : ''}`}>
                              <td className="px-4 py-3 font-black text-slate-800 text-xs">
                                {item.productName}
                                {item.barcode && <span className="block text-[10px] font-mono font-normal text-slate-400">Barcode: {item.barcode}</span>}
                              </td>
                              <td className="px-4 py-3 text-center font-bold text-slate-600 text-xs">{origQty} {item.unit || ''}</td>
                              <td className="px-4 py-3 text-center font-bold text-amber-700 text-xs">{prevReturned} {item.unit || ''}</td>
                              <td className="px-4 py-3 text-center font-black text-emerald-700 text-xs">
                                {maxReturn > 0 ? `${maxReturn} ${item.unit || ''}` : <span className="text-rose-600 font-bold uppercase">{t('Fully Returned', 'සම්පූර්ණයෙන්ම ආපසු')}</span>}
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-slate-600 text-xs">{symbol} {convert(item.price).toLocaleString()}</td>
                              <td className="px-4 py-3 text-center">
                                <input
                                  type="number"
                                  min={0}
                                  max={maxReturn}
                                  disabled={maxReturn === 0}
                                  value={currReturn || ''}
                                  onChange={(e) => {
                                    const val = Math.min(maxReturn, Math.max(0, parseFloat(e.target.value) || 0));
                                    setReturnQtys(prev => ({ ...prev, [lKey]: val }));
                                  }}
                                  className="w-20 px-2 py-1 text-center bg-white border border-slate-300 rounded-lg font-bold text-slate-800 text-xs outline-none focus:border-amber-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
                                />
                              </td>
                              <td className="px-4 py-3 text-right font-black text-emerald-600 text-xs">{symbol} {convert(itemRefund).toLocaleString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Return Method Selection & Settings */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">{t('Return Method', 'ආපසු ගෙවීමේ ක්‍රමය')}</label>
                      <select
                        value={returnMethod}
                        onChange={(e) => setReturnMethod(e.target.value as any)}
                        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 text-xs outline-none focus:border-amber-500"
                      >
                        <option value="Cash Refund">Cash Refund / මුදල් ආපසු</option>
                        <option value="Exchange">Exchange / භාණ්ඩ හුවමාරුව</option>
                        <option value="Credit Note">Credit Note / ණය සටහන</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">{t('Reason (Optional)', 'හේතුව')}</label>
                      <input
                        type="text"
                        placeholder={t('Damaged, Wrong item, Quality issue, etc.', 'හානි වී ඇත, වෙනත්...')}
                        value={returnReason}
                        onChange={(e) => setReturnReason(e.target.value)}
                        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 text-xs outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>

                  {/* EXCHANGE SECTION (When returnMethod === 'Exchange') */}
                  {returnMethod === 'Exchange' && (() => {
                    const categoriesList = ['All', ...Array.from(new Set(allCatalogSelectables.map(i => i.category).filter(Boolean)))];

                    const handleAddSelectableToCart = (item: typeof matchingExchangeSelectables[0]) => {
                      setExchangeCartItems(prev => {
                        const existingIdx = prev.findIndex(i => i.productId === item.productId && (i.unit || '').toLowerCase() === item.unit.toLowerCase());
                        if (existingIdx >= 0) {
                          const updated = [...prev];
                          updated[existingIdx].qty += 1;
                          updated[existingIdx].total = updated[existingIdx].qty * updated[existingIdx].price;
                          return updated;
                        }

                        const newItem: SaleItem = {
                          productId: item.productId,
                          productName: item.displayName,
                          qty: 1,
                          price: item.price,
                          total: item.price,
                          unit: item.unit,
                          conversionRate: item.conversionRate,
                          discount: 0,
                          discountType: 'amount',
                          taxRate: 0
                        };
                        return [...prev, newItem];
                      });
                    };

                    const matchingSelectables = matchingExchangeSelectables;

                    return (
                      <div className="bg-emerald-50/50 border border-emerald-200 rounded-2xl p-4 space-y-4 animate-in fade-in duration-300">
                        <h4 className="text-xs font-black text-emerald-800 uppercase tracking-widest flex items-center gap-2">
                          <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                          {t('Select Replacement Exchange Products & Sub-Items:', 'හුවමාරු ලබාගන්නා නව භාණ්ඩ සහ උප-භාණ්ඩ තෝරන්න:')}
                        </h4>

                        {/* Category & Subcategory Filter Tabs */}
                        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                          {categoriesList.map((cat) => (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setExchangeCategoryFilter(cat)}
                              className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase transition-all whitespace-nowrap ${exchangeCategoryFilter.toLowerCase() === cat.toLowerCase() ? 'bg-emerald-700 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
                            >
                              {cat}
                            </button>
                          ))}
                        </div>

                        {/* Search Input for Barcode, Product Name, Sub-Item Name, SKU */}
                        <div className="relative">
                          <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 px-3 py-2 shadow-inner focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-500">
                            <SearchIcon className="w-4 h-4 text-emerald-600 shrink-0" />
                            <input
                              type="text"
                              placeholder={t('Scan barcode or search by Main Product, Sub-Item, Variant, Category...', 'බාර්කෝඩ් ස්කෑන් කරන්න හෝ ප්‍රධාන භාණ්ඩය, උප-භාණ්ඩය, ප්‍රභේදය සෙවුම් කරන්න...')}
                              value={exchangeProductSearch}
                              onChange={(e) => {
                                const val = e.target.value;
                                setExchangeProductSearch(val);

                                // Immediate Barcode scan auto-add
                                if (val.trim()) {
                                  const qStr = val.trim().toLowerCase();
                                  const exactMatch = allCatalogSelectables.find(i => i.barcode && i.barcode.trim().toLowerCase() === qStr);
                                  if (exactMatch) {
                                    handleAddSelectableToCart(exactMatch);
                                    setExchangeProductSearch('');
                                  }
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (!exchangeProductSearch.trim()) return;

                                  if (matchingSelectables.length > 0) {
                                    handleAddSelectableToCart(matchingSelectables[0]);
                                    setExchangeProductSearch('');
                                  } else {
                                    alert(t(`No product or sub-item matching "${exchangeProductSearch}" found!`, `"${exchangeProductSearch}" නමින් ගැලපෙන භාණ්ඩයක් හෝ උප-භාණ්ඩයක් හමු නොවීය!`));
                                  }
                                }
                              }}
                              className="w-full bg-transparent text-xs font-bold text-slate-800 outline-none placeholder-slate-400"
                            />
                            {exchangeProductSearch && (
                              <button type="button" onClick={() => setExchangeProductSearch('')} className="text-slate-400 hover:text-slate-600 text-xs font-bold px-1">✕</button>
                            )}
                          </div>

                          {/* Live Search Results Dropdown Panel */}
                          {exchangeProductSearch.trim().length >= 1 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-slate-200 shadow-2xl z-50 max-h-72 overflow-y-auto divide-y divide-slate-100 p-1.5">
                              <div className="px-2 py-1 text-[9px] font-black text-slate-400 uppercase tracking-wider">
                                {t('Matching Exchange Products & Sub-Items:', 'සෙවුමට ගැලපෙන භාණ්ඩ සහ උප-භාණ්ඩ:')} ({matchingSelectables.length})
                              </div>
                              {matchingSelectables.length === 0 ? (
                                <div className="p-3 text-center text-slate-400 font-bold text-xs italic">
                                  {t('No matching product or sub-item found.', 'ගැලපෙන කිසිවක් හමු නොවීය.')}
                                </div>
                              ) : (
                                matchingSelectables.map((item) => (
                                  <button
                                    key={item.key}
                                    type="button"
                                    onClick={() => {
                                      handleAddSelectableToCart(item);
                                      setExchangeProductSearch('');
                                    }}
                                    className="w-full text-left p-2 hover:bg-emerald-50/70 rounded-lg transition-colors flex justify-between items-center group"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-xs text-slate-800 group-hover:text-emerald-700">{item.displayName}</span>
                                      {item.isSubItem && (
                                        <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 font-black text-[9px] rounded uppercase">
                                          Sub-Item ({item.unit})
                                        </span>
                                      )}
                                      <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{item.category}</span>
                                    </div>
                                    <div className="text-right flex items-center gap-3">
                                      <div>
                                        <span className="font-black text-xs text-emerald-700">{symbol} {convert(item.price).toLocaleString()}</span>
                                        <span className="text-[10px] text-slate-400 block font-semibold">Stock: {item.stock}</span>
                                      </div>
                                      <span className="px-2 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase shadow-sm group-hover:bg-emerald-700">
                                        + Add
                                      </span>
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>

                        {/* Quick Selection Grid for Main Products & Sub-Items */}
                        {allCatalogSelectables.length > 0 && !exchangeProductSearch.trim() && (
                          <div className="space-y-2">
                            <div className="text-[10px] font-black text-emerald-800 uppercase tracking-wider flex justify-between items-center">
                              <span>{t('Quick Pick Products & Sub-Items:', 'ඉක්මනින් තෝරාගැනීමට භාණ්ඩ:')}</span>
                              <span className="text-slate-400 font-semibold">{matchingSelectables.length} available</span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1 bg-white/70 rounded-xl border border-slate-200/80">
                              {matchingSelectables.slice(0, 16).map((item) => (
                                <button
                                  key={item.key}
                                  type="button"
                                  onClick={() => handleAddSelectableToCart(item)}
                                  className="p-2 bg-white hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 rounded-xl text-left transition-all shadow-sm flex flex-col justify-between group"
                                >
                                  <div>
                                    <div className="font-bold text-xs text-slate-800 line-clamp-1 group-hover:text-emerald-700">{item.displayName}</div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <span className="text-[9px] font-semibold text-slate-400">{item.category}</span>
                                      {item.isSubItem && (
                                        <span className="px-1 py-0.2 bg-amber-100 text-amber-800 text-[8px] font-black rounded">
                                          Sub
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="mt-1.5 flex justify-between items-center border-t border-slate-100 pt-1">
                                    <span className="font-black text-xs text-emerald-700">{symbol} {convert(item.price).toLocaleString()}</span>
                                    <span className="text-[9px] font-black text-emerald-600 uppercase">+ Add</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Exchange Products Cart Table */}
                        <div className="overflow-x-auto rounded-xl border border-emerald-100 bg-white shadow-sm">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead>
                              <tr className="bg-emerald-100/60 border-b border-emerald-200 text-[10px] font-black text-emerald-900 tracking-widest uppercase">
                                <th className="px-3 py-2">{t('Replacement Item / Sub-Item', 'නව භාණ්ඩය / උප-භාණ්ඩය')}</th>
                                <th className="px-3 py-2 text-center w-24">{t('Qty', 'ප්‍රමාණය')}</th>
                                <th className="px-3 py-2 text-right">{t('Unit Price', 'ඒකක මිල')}</th>
                                <th className="px-3 py-2 text-right">{t('Total', 'එකතුව')}</th>
                                <th className="px-3 py-2 text-center w-12">{t('Action', 'ක්‍රියා')}</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {exchangeCartItems.length === 0 ? (
                                <tr>
                                  <td colSpan={5} className="py-4 text-center text-slate-400 font-bold italic">
                                    {t('No exchange items added yet. Search or select main products & sub-items above.', 'තවමත් හුවමාරු භාණ්ඩ එකතු කර නොමැත.')}
                                  </td>
                                </tr>
                              ) : (
                                exchangeCartItems.map((item, idx) => (
                                  <tr key={`${item.productId}_${item.unit}_${idx}`} className="hover:bg-slate-50">
                                    <td className="px-3 py-2 font-bold text-slate-800">
                                      {item.productName}
                                      {item.unit && <span className="ml-1.5 px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[9px] font-semibold">{item.unit}</span>}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      <input
                                        type="number"
                                        min={1}
                                        value={item.qty}
                                        onChange={(e) => {
                                          const newQty = Math.max(1, parseFloat(e.target.value) || 1);
                                          const updated = [...exchangeCartItems];
                                          updated[idx].qty = newQty;
                                          updated[idx].total = newQty * updated[idx].price;
                                          setExchangeCartItems(updated);
                                        }}
                                        className="w-16 px-1.5 py-0.5 text-center bg-white border border-slate-300 rounded font-bold text-slate-800 text-xs"
                                      />
                                    </td>
                                    <td className="px-3 py-2 text-right font-semibold text-slate-600">{symbol} {convert(item.price).toLocaleString()}</td>
                                    <td className="px-3 py-2 text-right font-black text-emerald-700">{symbol} {convert(item.total).toLocaleString()}</td>
                                    <td className="px-3 py-2 text-center">
                                      <button
                                        type="button"
                                        onClick={() => setExchangeCartItems(prev => prev.filter((_, i) => i !== idx))}
                                        className="text-rose-500 hover:text-rose-700 font-bold text-xs"
                                      >
                                        ✕
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>

                      {/* Exchange Balance Calculation Summary */}
                      <div className="bg-white rounded-xl border border-emerald-200 p-4 space-y-3 shadow-sm">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs font-bold border-b border-slate-100 pb-3">
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-black">{t('Returned Total Value:', 'ආපසු භාරගත් මුළු අගය:')}</span>
                            <span className="text-rose-600 font-black text-sm">{symbol} {convert(returnTotalValue).toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-black">{t('Exchange Products Value:', 'නව හුවමාරු භාණ්ඩ අගය:')}</span>
                            <span className="text-emerald-600 font-black text-sm">{symbol} {convert(exchangeTotalValue).toLocaleString()}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[10px] uppercase font-black">{t('Net Difference:', 'ශේෂ වෙනස:')}</span>
                            <span className={`font-black text-sm ${netExchangeBalance > 0 ? 'text-amber-600' : netExchangeBalance < 0 ? 'text-blue-600' : 'text-slate-700'}`}>
                              {netExchangeBalance > 0 
                                ? `${symbol} ${convert(netExchangeBalance).toLocaleString()} (Customer Owes)` 
                                : netExchangeBalance < 0 
                                  ? `${symbol} ${convert(Math.abs(netExchangeBalance)).toLocaleString()} (Refund Due)` 
                                  : 'Rs. 0 (Even Exchange)'}
                            </span>
                          </div>
                        </div>

                        {/* Customer Pays Balance Due Scenario */}
                        {netExchangeBalance > 0 && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-amber-50/60 p-3 rounded-xl border border-amber-200">
                            <div>
                              <label className="text-[10px] font-black text-amber-900 uppercase tracking-wider block mb-1">
                                {t('Balance Due from Customer:', 'පාරිභෝගිකයාගෙන් අයවිය යුතු ශේෂය:')}
                              </label>
                              <div className="text-base font-black text-amber-700">{symbol} {convert(netExchangeBalance).toLocaleString()}</div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-black text-slate-600 uppercase tracking-wider block">
                                {t('Customer Payment / Amount Paid:', 'පාරිභෝගිකයා ලබාදුන් මුදල:')}
                              </label>
                              <input
                                type="number"
                                min={netExchangeBalance}
                                value={exchangeCustomerPaid || ''}
                                onChange={(e) => setExchangeCustomerPaid(parseFloat(e.target.value) || 0)}
                                placeholder={`Min ${netExchangeBalance}`}
                                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-black text-slate-800 text-sm outline-none focus:border-amber-500"
                              />
                              {exchangeCustomerPaid > netExchangeBalance && (
                                <p className="text-xs font-black text-emerald-700">
                                  {t('Change to Customer:', 'පාරිභෝගිකයාට ඉතිරි ලබාදිය යුතු මුදල:')} {symbol} {convert(exchangeCustomerPaid - netExchangeBalance).toLocaleString()}
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Customer Gets Refund Due Scenario */}
                        {netExchangeBalance < 0 && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-blue-50/60 p-3 rounded-xl border border-blue-200">
                            <div>
                              <label className="text-[10px] font-black text-blue-900 uppercase tracking-wider block mb-1">
                                {t('Refund Due to Customer:', 'පාරිභෝගිකයාට ආපසු ගෙවිය යුතු මුදල:')}
                              </label>
                              <div className="text-base font-black text-blue-700">{symbol} {convert(Math.abs(netExchangeBalance)).toLocaleString()}</div>
                            </div>
                            <div>
                              <label className="text-[10px] font-black text-slate-600 uppercase tracking-wider block mb-1">
                                {t('Confirm Refund Amount:', 'ආපසු ගෙවන මුදල තහවුරු කරන්න:')}
                              </label>
                              <input
                                type="number"
                                value={exchangeRefundGiven || Math.abs(netExchangeBalance)}
                                onChange={(e) => setExchangeRefundGiven(parseFloat(e.target.value) || 0)}
                                className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-black text-slate-800 text-sm outline-none focus:border-amber-500"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                  {/* SUBMIT BUTTON */}
                  <div className="pt-2">
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={handleConfirmProcessReturn}
                      className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <CheckCircleIcon className="w-4 h-4" />
                      {returnMethod === 'Exchange' 
                        ? t('Confirm & Process Exchange', 'භාණ්ඩ හුවමාරුව තහවුරු කරන්න') 
                        : returnMethod === 'Credit Note' 
                          ? t('Confirm & Issue Credit Note', 'ණය සටහන නිකුත් කිරීම තහවුරු කරන්න') 
                          : t('Confirm & Process Return', 'ආපසු භාරගැනීම තහවුරු කරන්න')}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Sales Return History & Credit Notes Section */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-100/40 p-6">
            <div className="flex justify-between items-center flex-wrap gap-3 mb-6 border-b border-slate-100 pb-4">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-4 bg-amber-500 rounded-full"></span>
                {returnSubTab === 'history' ? t('Sales Return History', 'ආපසු භාරගැනීම් ඉතිහාසය') : t('Credit Notes History', 'ණය සටහන් ඉතිහාසය')}
              </h3>

              <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setReturnSubTab('history')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase transition-all ${returnSubTab === 'history' ? 'bg-slate-900 text-amber-400 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  {t('Return History', 'ආපසු ඉතිහාසය')}
                </button>
                <button
                  type="button"
                  onClick={() => setReturnSubTab('credit_notes')}
                  className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase transition-all ${returnSubTab === 'credit_notes' ? 'bg-slate-900 text-amber-400 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  {t('Credit Notes', 'ණය සටහන්')} ({creditNotesList.length})
                </button>
              </div>
            </div>

            {returnSubTab === 'history' ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 tracking-widest uppercase">
                      <th className="px-6 py-4">{t('Date & Time', 'දිනය හා වේලාව')}</th>
                      <th className="px-6 py-4">{t('Return No', 'ආපසු අංකය')}</th>
                      <th className="px-6 py-4">{t('Original Invoice', 'ඉන්වොයිස් අංකය')}</th>
                      <th className="px-6 py-4">{t('Customer', 'පාරිභෝගිකයා')}</th>
                      <th className="px-6 py-4">{t('Return Method', 'ක්‍රමය')}</th>
                      <th className="px-6 py-4 text-right">{t('Total Refunded / Paid', 'මුළු මුදල')}</th>
                      <th className="px-6 py-4 text-center">{t('Status', 'තත්ත්වය')}</th>
                      <th className="px-6 py-4 text-center">{t('Actions', 'ක්‍රියාකාරකම්')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {salesReturnsList.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400 font-bold text-sm">
                          {t('No sales returns recorded yet.', 'තවමත් ආපසු භාරගැනීම් කිසිවක් නොමැත.')}
                        </td>
                      </tr>
                    ) : (
                      salesReturnsList.map((sr) => {
                        const retItemsList = Array.isArray(sr.returnedItems) ? sr.returnedItems : safeParseJson(sr.returnedItems, []);
                        const exItemsList = Array.isArray(sr.exchangeItems) ? sr.exchangeItems : safeParseJson(sr.exchangeItems, []);
                        const isExpanded = expandedReturnId === sr.id;

                        return (
                          <React.Fragment key={sr.id}>
                            <tr className="hover:bg-slate-50/50">
                              <td className="px-6 py-4 font-bold text-slate-500 text-xs">
                                {formatInvoiceDateTime(sr.created_at)}
                              </td>
                              <td className="px-6 py-4 font-black text-slate-800 font-mono text-xs">
                                {sr.returnNo || sr.return_no || sr.id}
                              </td>
                              <td className="px-6 py-4 font-black text-amber-600 font-mono text-xs">
                                {sr.invoiceNo || sr.invoice_no}
                              </td>
                              <td className="px-6 py-4 font-bold text-slate-700 text-xs">
                                {sr.customerName || sr.customer_name || 'Guest Customer'}
                              </td>
                              <td className="px-6 py-4 font-bold text-slate-600 text-xs space-y-1">
                                <span className={`px-2.5 py-1 rounded-full font-black text-[10px] uppercase block w-max ${sr.returnMethod === 'Exchange' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>
                                  {sr.returnMethod}
                                </span>
                                {retItemsList.length > 0 && (
                                  <span className="text-[10px] font-bold text-rose-600 block">
                                    ↩ {retItemsList.length} returned
                                  </span>
                                )}
                                {exItemsList.length > 0 && (
                                  <span className="text-[10px] font-bold text-emerald-600 block">
                                    ⇄ {exItemsList.length} exchanged
                                  </span>
                                )}
                              </td>
                              <td className="px-6 py-4 text-right font-black text-emerald-600 text-sm">
                                {symbol} {convert(sr.totalRefunded || sr.returnAmount || 0).toLocaleString()}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${sr.status === 'voided' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>
                                  {sr.status === 'voided' ? 'VOIDED' : 'ACTIVE'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-center flex items-center justify-center gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => setExpandedReturnId(isExpanded ? null : sr.id)}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 ${isExpanded ? 'bg-amber-500 text-slate-950 font-black' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`}
                                >
                                  {isExpanded ? '▲ Hide' : '▼ Sub-Items'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedReturnPreview(sr);
                                    setShowReturnPreviewModal(true);
                                  }}
                                  className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                                >
                                  <ReceiptIcon className="w-3.5 h-3.5" />
                                  {t('Preview', 'පෙරදසුන')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePrintReturnReceipt(sr)}
                                  className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg border border-slate-200/50 transition-colors"
                                  title={t('Print Sales Return', 'ආපසු මුද්‍රණය')}
                                >
                                  <PrinterIcon className="w-3.5 h-3.5 text-amber-500" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadReturnPDF(sr)}
                                  className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg border border-red-200/50 transition-colors"
                                  title={t('Download Sales Return PDF', 'ආපසු PDF බාගත කරන්න')}
                                >
                                  <DownloadIcon className="w-3.5 h-3.5 text-red-600" />
                                </button>
                                {sr.status !== 'voided' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTargetVoidReturnId(sr.id);
                                      setTargetVoidInvoiceId(null);
                                      setVoidPasskeyInput('');
                                      setShowVoidModal(true);
                                    }}
                                    className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs font-bold transition-colors"
                                  >
                                    {t('Void', 'අවලංගු')}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSalesReturn(sr.id)}
                                  className="p-1.5 bg-rose-50 hover:bg-rose-600 text-rose-600 hover:text-white rounded-lg border border-rose-200/50 transition-colors"
                                  title={t('Delete Sales Return Bill', 'ආපසු රසීදුව මකන්න')}
                                >
                                  <Trash2Icon className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>

                            {/* Sub-Items Expandable Drawer */}
                            {isExpanded && (
                              <tr className="bg-slate-50/80">
                                <td colSpan={8} className="p-4 border-b border-slate-200">
                                  <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 shadow-sm">
                                    <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                                      <h5 className="font-black text-xs text-slate-800 uppercase tracking-widest flex items-center gap-2">
                                        <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                                        {t('Sub-Items Breakdown for Return:', 'මෙම ආපසු භාරගැනීමේ සියලුම භාණ්ඩ විස්තරය:')} <span className="font-mono text-amber-600">{sr.returnNo || sr.return_no || sr.id}</span>
                                      </h5>
                                      <span className="text-[10px] font-bold text-slate-400">{formatInvoiceDateTime(sr.created_at)}</span>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      {/* Returned Items Sub-Table */}
                                      <div>
                                        <h6 className="text-[11px] font-black text-rose-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                                          <span>↩</span> {t('Returned Products', 'ආපසු භාරගත් භාණ්ඩ')} ({retItemsList.length})
                                        </h6>
                                        <div className="overflow-hidden border border-rose-100 rounded-lg bg-rose-50/30">
                                          <table className="w-full text-xs text-left border-collapse">
                                            <thead>
                                              <tr className="bg-rose-100/60 text-rose-900 font-black uppercase text-[9px] tracking-wider">
                                                <th className="py-1.5 px-2.5">Item Name</th>
                                                <th className="py-1.5 px-2.5 text-center">Qty</th>
                                                <th className="py-1.5 px-2.5 text-right">Price</th>
                                                <th className="py-1.5 px-2.5 text-right">Total</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-rose-100/60">
                                              {retItemsList.map((ri: any, idx: number) => (
                                                <tr key={idx}>
                                                  <td className="py-1.5 px-2.5 font-bold text-slate-800">{ri.productName}</td>
                                                  <td className="py-1.5 px-2.5 text-center font-semibold text-slate-600">{ri.qty} {ri.unit || ''}</td>
                                                  <td className="py-1.5 px-2.5 text-right text-slate-600">{symbol} {convert(ri.price).toLocaleString()}</td>
                                                  <td className="py-1.5 px-2.5 text-right font-black text-rose-700">{symbol} {convert(ri.qty * ri.price).toLocaleString()}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>

                                      {/* Exchange Replacement Sub-Items Table */}
                                      <div>
                                        <h6 className="text-[11px] font-black text-emerald-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                                          <span>⇄</span> {t('Exchange Replacement Sub-Items', 'හුවමාරු ලබාදුන් නව භාණ්ඩ')} ({exItemsList.length})
                                        </h6>
                                        {exItemsList.length === 0 ? (
                                          <div className="p-3 text-center text-slate-400 font-bold text-xs italic bg-slate-50 rounded-lg border border-slate-100">
                                            {t('No exchange replacement items in this transaction.', 'මෙම ගනුදෙනුවේ හුවමාරු භාණ්ඩ නොමැත.')}
                                          </div>
                                        ) : (
                                          <div className="overflow-hidden border border-emerald-100 rounded-lg bg-emerald-50/30">
                                            <table className="w-full text-xs text-left border-collapse">
                                              <thead>
                                                <tr className="bg-emerald-100/60 text-emerald-900 font-black uppercase text-[9px] tracking-wider">
                                                  <th className="py-1.5 px-2.5">Item Name</th>
                                                  <th className="py-1.5 px-2.5 text-center">Qty</th>
                                                  <th className="py-1.5 px-2.5 text-right">Price</th>
                                                  <th className="py-1.5 px-2.5 text-right">Total</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y divide-emerald-100/60">
                                                {exItemsList.map((ei: any, idx: number) => (
                                                  <tr key={idx}>
                                                    <td className="py-1.5 px-2.5 font-bold text-slate-800">{ei.productName}</td>
                                                    <td className="py-1.5 px-2.5 text-center font-semibold text-slate-600">{ei.qty} {ei.unit || ''}</td>
                                                    <td className="py-1.5 px-2.5 text-right text-slate-600">{symbol} {convert(ei.price).toLocaleString()}</td>
                                                    <td className="py-1.5 px-2.5 text-right font-black text-emerald-700">{symbol} {convert(ei.qty * ei.price).toLocaleString()}</td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Credit Notes History Table */
              <div className="overflow-x-auto rounded-2xl border border-slate-100">
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 tracking-widest uppercase">
                      <th className="px-4 py-3.5">{t('Date', 'දිනය')}</th>
                      <th className="px-4 py-3.5">{t('Credit Note No', 'ණය සටහන් අංකය')}</th>
                      <th className="px-4 py-3.5">{t('Ref Invoice', 'මුල් ඉන්වොයිසිය')}</th>
                      <th className="px-4 py-3.5">{t('Customer', 'පාරිභෝගිකයා')}</th>
                      <th className="px-4 py-3.5 text-right">{t('Original Amount', 'මුළු ණය මුදල')}</th>
                      <th className="px-4 py-3.5 text-right">{t('Used Amount', 'භාවිත කල මුදල')}</th>
                      <th className="px-4 py-3.5 text-right">{t('Remaining Bal', 'ඉතිරි ශේෂය')}</th>
                      <th className="px-4 py-3.5 text-center">{t('Status', 'තත්ත්වය')}</th>
                      <th className="px-4 py-3.5 text-center">{t('Actions', 'ක්‍රියාකාරකම්')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {creditNotesList.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-slate-400 font-bold text-sm">
                          {t('No credit notes recorded yet.', 'තවමත් ණය සටහන් කිසිවක් නොමැත.')}
                        </td>
                      </tr>
                    ) : (
                      creditNotesList.map((cn) => {
                        const cnCode = cn.creditNoteNo || cn.credit_note_no || cn.code || cn.id;
                        const origVal = Number(cn.amount || cn.value || 0);
                        const remBal = Number(cn.balance_remaining !== undefined ? cn.balance_remaining : (cn.balanceRemaining !== undefined ? cn.balanceRemaining : origVal));
                        const usedVal = Math.max(0, origVal - remBal);
                        const stLower = (cn.status || '').toLowerCase();
                        const isFullyUsed = stLower === 'fully used' || stLower === 'used' || remBal <= 0.001;
                        const isPartiallyUsed = !isFullyUsed && remBal < origVal;

                        return (
                          <tr key={cn.id} className="hover:bg-slate-50/50">
                            <td className="px-4 py-3.5 font-bold text-slate-500 text-xs">
                              {new Date(cn.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3.5 font-black text-amber-600 font-mono text-sm">
                              {cnCode}
                            </td>
                            <td className="px-4 py-3.5 font-mono font-bold text-slate-700 text-xs">
                              {cn.invoiceNo || cn.invoice_no || 'N/A'}
                            </td>
                            <td className="px-4 py-3.5 font-bold text-slate-700 text-xs">
                              {cn.customerName || cn.customer_name || 'Guest Customer'}
                            </td>
                            <td className="px-4 py-3.5 text-right font-black text-slate-700 text-xs font-mono">
                              {symbol} {convert(origVal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3.5 text-right font-bold text-amber-700 text-xs font-mono">
                              {symbol} {convert(usedVal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3.5 text-right font-black text-emerald-600 text-sm font-mono">
                              {symbol} {convert(remBal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${
                                isFullyUsed ? 'bg-slate-100 text-slate-500' : isPartiallyUsed ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'
                              }`}>
                                {isFullyUsed ? t('Fully Used', 'සම්පූර්ණයෙන්ම භාවිතා කර ඇත') : isPartiallyUsed ? t('Partially Used', 'කොටසක් භාවිතා කර ඇත') : t('Active', 'සක්‍රියයි')}
                              </span>
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedCreditNotePreview(cn);
                                    setShowCreditNotePreviewModal(true);
                                  }}
                                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1"
                                >
                                  <ReceiptIcon className="w-3 h-3" />
                                  {t('Receipt', 'ලදුපත')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedCreditNotePreview(cn);
                                    fetchCreditNoteUsage(cnCode);
                                    setShowCreditNoteUsageModal(true);
                                  }}
                                  className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1"
                                >
                                  <span>📜</span>
                                  {t('History', 'ඉතිහාසය')}
                                </button>
                                {!isFullyUsed && (
                                  <button
                                    type="button"
                                    onClick={() => handleCreditNoteCashRefund(cn)}
                                    className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[11px] font-bold transition-colors flex items-center gap-1"
                                  >
                                    <span>💵</span>
                                    {t('Refund Cash', 'මුදල් ලබාදෙන්න')}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Return Receipt Preview Modal */}
      {showReturnPreviewModal && selectedReturnPreview && (
        <Modal 
          isOpen={showReturnPreviewModal} 
          onClose={() => setShowReturnPreviewModal(false)} 
          title={t('Return Receipt Preview', 'ආපසු භාරගැනීමේ රසීදු පෙරදසුන')} 
          size="lg"
        >
          <div id="credit-preview-modal-content" className="space-y-4 p-4 text-center bg-white animate-in zoom-in duration-300">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center border border-amber-200">
                  <ReceiptIcon className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h4 className="font-black text-sm text-[#464646]">{t('Sales Return Receipt', 'ආපසු භාරගැනීමේ රසීදුව')}</h4>
                  <p className="text-[10px] text-gray-400 font-bold">{selectedReturnPreview.returnNo || selectedReturnPreview.return_no || selectedReturnPreview.id}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => handlePrintReturnReceipt(selectedReturnPreview)} 
                  className="bg-[#DAA520] hover:bg-[#B8860B] text-white px-4 py-2 rounded-xl text-xs font-black shadow-md flex items-center gap-2 transition-all uppercase tracking-widest"
                >
                  <PrinterIcon className="w-4 h-4" /> {t('Print', 'මුද්‍රණය කරන්න')}
                </button>
                <button 
                  onClick={() => handleDownloadReturnPDF(selectedReturnPreview)} 
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-xs font-black shadow-md flex items-center gap-2 transition-all uppercase tracking-widest"
                >
                  <DownloadIcon className="w-4 h-4" /> {t('PDF', 'PDF')}
                </button>
                <button 
                  onClick={() => handleDeleteSalesReturn(selectedReturnPreview.id)} 
                  className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl text-xs font-black shadow-md flex items-center gap-2 transition-all uppercase tracking-widest"
                >
                  <Trash2Icon className="w-4 h-4" /> {t('Delete', 'මකන්න')}
                </button>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <ReturnReceiptPreview returnRecord={selectedReturnPreview} isSinhala={isSinhala} />
            </div>

            <div className="pt-2">
              <button 
                onClick={() => setShowReturnPreviewModal(false)} 
                className="w-full bg-gray-100 text-gray-500 py-3.5 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-gray-200 transition-colors"
              >
                {t('Dismiss', 'ඉවත් කරන්න')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Credit Note Preview Modal */}
      {showCreditNotePreviewModal && selectedCreditNotePreview && (
        <Modal 
          isOpen={showCreditNotePreviewModal} 
          onClose={() => setShowCreditNotePreviewModal(false)} 
          title={t('Credit Note Preview', 'ණය සටහන් පෙරදසුන')} 
          size="lg"
        >
          <div id="credit-preview-modal-content" className="space-y-4 p-4 text-center bg-white animate-in zoom-in duration-300">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center border border-amber-200">
                  <ReceiptIcon className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h4 className="font-black text-sm text-[#464646]">{t('Credit Note Document', 'ණය සටහන')}</h4>
                  <p className="text-[10px] text-gray-400 font-bold">{selectedCreditNotePreview.creditNoteNo || selectedCreditNotePreview.credit_note_no || selectedCreditNotePreview.id}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => handlePrintCreditNote(selectedCreditNotePreview)} 
                  className="bg-[#DAA520] hover:bg-[#B8860B] text-white px-4 py-2 rounded-xl text-xs font-black shadow-md flex items-center gap-2 transition-all uppercase tracking-widest"
                >
                  <PrinterIcon className="w-4 h-4" /> {t('Print', 'මුද්‍රණය කරන්න')}
                </button>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <CreditNoteReceiptPreview creditNoteRecord={selectedCreditNotePreview} isSinhala={isSinhala} />
            </div>

            <div className="pt-2">
              <button 
                onClick={() => setShowCreditNotePreviewModal(false)} 
                className="w-full bg-gray-100 text-gray-500 py-3.5 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-gray-200 transition-colors"
              >
                {t('Dismiss', 'ඉවත් කරන්න')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Centralized Void Passkey Confirmation Modal */}
      {showVoidModal && (
        <Modal 
          isOpen={showVoidModal} 
          onClose={() => {
            setShowVoidModal(false);
            setTargetVoidInvoiceId(null);
            setTargetVoidReturnId(null);
          }} 
          title={targetVoidReturnId ? t('Confirm Void Sales Return', 'ආපසු භාරගැනීම අවලංගු කිරීම') : t('Confirm Void Invoice', 'ඉන්වොයිසිය අවලංගු කිරීම')}
        >
          <div className="space-y-4 p-2">
            <p className="text-xs font-bold text-slate-600">
              {targetVoidReturnId 
                ? t('Enter Security Passkey to void sales return and reverse inventory & financials:', 'ආපසු භාරගැනීම අවලංගු කිරීමට මුරපදය ඇතුළත් කරන්න:')
                : t('Enter Security Passkey to void invoice and reverse inventory & financials:', 'ඉන්වොයිසිය අවලංගු කිරීමට මුරපදය ඇතුළත් කරන්න:')}
            </p>
            <input
              type="password"
              placeholder={t('Enter Passkey...', 'මුරපදය ඇතුළත් කරන්න...')}
              value={voidPasskeyInput}
              onChange={(e) => setVoidPasskeyInput(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-800 text-sm outline-none focus:border-amber-500"
            />
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowVoidModal(false);
                  setTargetVoidInvoiceId(null);
                  setTargetVoidReturnId(null);
                }}
                className="px-4 py-2 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs uppercase"
              >
                {t('Cancel', 'අවලංගු කරන්න')}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const configuredPasskey = shopSettings?.void_passkey || shopSettings?.return_passkey || '1234';
                  if (voidPasskeyInput.trim() !== configuredPasskey) {
                    return alert(t('Invalid Passkey! Access Denied.', 'වලංගු නොවන මුරපදයකි! අවලංගු කිරීමට නොහැක.'));
                  }
                  setShowVoidModal(false);
                  if (targetVoidInvoiceId) {
                    await handleVoidOrder(targetVoidInvoiceId);
                    setTargetVoidInvoiceId(null);
                  } else if (targetVoidReturnId) {
                    await handleVoidSalesReturn(targetVoidReturnId);
                    setTargetVoidReturnId(null);
                  }
                }}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl text-xs uppercase shadow-md"
              >
                {t('Confirm Void', 'අවලංගු කිරීම තහවුරු කරන්න')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Quotation Preview Modal */}
      {showQuotePreviewModal && selectedQuotePreview && (
        <Modal isOpen={showQuotePreviewModal} onClose={() => setShowQuotePreviewModal(false)} title={t('Quotation Preview', 'මිල ගණන් පූර්ව දර්ශනය')}>
          <div className="p-2 bg-white rounded-3xl text-left">
            <QuotationPreview quote={selectedQuotePreview} isSinhala={isSinhala} shopSettings={shopSettings} />

            {/* Modal Footer Actions */}
            <div className="flex justify-end gap-3 border-t border-slate-100 pt-4 mt-4 px-4">
              <button
                type="button"
                onClick={() => setShowQuotePreviewModal(false)}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs uppercase"
              >
                {t('Close', 'වහන්න')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const htmlContent = generateQuotePrintHTML(selectedQuotePreview, isSinhala, shopSettings);
                  const iframe = document.createElement('iframe');
                  iframe.style.position = 'fixed';
                  iframe.style.right = '0';
                  iframe.style.bottom = '0';
                  iframe.style.width = '0';
                  iframe.style.height = '0';
                  iframe.style.border = '0';
                  document.body.appendChild(iframe);
                  const doc = iframe.contentWindow?.document || iframe.contentDocument;
                  if (doc) {
                    doc.open();
                    doc.write(htmlContent);
                    doc.close();
                  }
                  setTimeout(() => {
                    iframe.contentWindow?.focus();
                    iframe.contentWindow?.print();
                    setTimeout(() => {
                      if (document.body.contains(iframe)) document.body.removeChild(iframe);
                    }, 1000);
                  }, 300);
                }}
                className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider shadow-md flex items-center gap-1.5"
              >
                <PrinterIcon className="w-4 h-4" />
                {t('Print Quotation', 'මුද්‍රණය කරන්න')}
              </button>

              <button
                type="button"
                onClick={() => handleDownloadQuotePDF(selectedQuotePreview)}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl text-xs uppercase tracking-wider shadow-md flex items-center gap-1.5"
              >
                <DownloadIcon className="w-4 h-4" />
                {t('Download PDF', 'PDF බාගත කරන්න')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Credit Note Usage History Modal */}
      {showCreditNoteUsageModal && (
        <Modal
          isOpen={showCreditNoteUsageModal}
          onClose={() => setShowCreditNoteUsageModal(false)}
          title={t('Credit Note Usage History & Audit Trail', 'ණය සටහන් භාවිත ඉතිහාසය සහ විගණන ලොගය')}
          size="xl"
        >
          <div className="space-y-4">
            {selectedCreditNotePreview && (
              <div className="bg-amber-50/70 border border-amber-200 p-4 rounded-2xl flex flex-wrap justify-between items-center gap-4">
                <div>
                  <span className="text-[10px] font-black text-amber-800 uppercase tracking-widest block">{t('Credit Note Code', 'ණය සටහන් අංකය')}</span>
                  <span className="text-lg font-black font-mono text-amber-900">
                    💳 {selectedCreditNotePreview.creditNoteNo || selectedCreditNotePreview.credit_note_no || selectedCreditNotePreview.code || selectedCreditNotePreview.id}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">{t('Customer', 'පාරිභෝගිකයා')}</span>
                  <span className="text-sm font-bold text-slate-800">{selectedCreditNotePreview.customerName || selectedCreditNotePreview.customer_name || 'Guest Customer'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">{t('Original Credit', 'මුළු ණය මුදල')}</span>
                  <span className="text-sm font-black text-slate-900 font-mono">
                    {symbol} {convert(selectedCreditNotePreview.amount || selectedCreditNotePreview.value || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-amber-700 uppercase tracking-widest block">{t('Total Used', 'භාවිත කළ මුදල')}</span>
                  <span className="text-sm font-black text-amber-800 font-mono">
                    {symbol} {convert(Math.max(0, Number(selectedCreditNotePreview.amount || selectedCreditNotePreview.value || 0) - Number(selectedCreditNotePreview.balance_remaining !== undefined ? selectedCreditNotePreview.balance_remaining : (selectedCreditNotePreview.balanceRemaining || 0)))).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest block">{t('Current Available Balance', 'ඉතිරි ශේෂය')}</span>
                  <span className="text-base font-black text-emerald-700 font-mono">
                    {symbol} {convert(selectedCreditNotePreview.balance_remaining !== undefined ? selectedCreditNotePreview.balance_remaining : (selectedCreditNotePreview.balanceRemaining || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 font-black text-slate-600 uppercase tracking-wider text-[9px]">
                    <th className="p-3">{t('Date / Time', 'දිනය / වේලාව')}</th>
                    <th className="p-3">{t('Invoice / Ref', 'ඉන්වොයිසි අංකය')}</th>
                    <th className="p-3">{t('Action', 'ක්‍රියාව')}</th>
                    <th className="p-3 text-right">{t('Prev Balance', 'පෙර ශේෂය')}</th>
                    <th className="p-3 text-right">{t('Amount Applied', 'භාවිතා කල මුදල')}</th>
                    <th className="p-3 text-right">{t('Remaining Balance', 'ඉතිරි ශේෂය')}</th>
                    <th className="p-3 text-center">{t('User / Cashier', 'පරිශීලක')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loadingCNUsage ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400 font-bold">
                        <Loader2Icon className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
                        {t('Loading usage history...', 'භාවිත ඉතිහාසය පූරණය වෙමින් පවතී...')}
                      </td>
                    </tr>
                  ) : creditNoteUsageLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400 font-bold">
                        {t('No usage transactions recorded for this credit note yet.', 'මෙම ණය සටහන සඳහා තවමත් ගනුදෙනු කිසිවක් නොමැත.')}
                      </td>
                    </tr>
                  ) : (
                    creditNoteUsageLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50 font-medium">
                        <td className="p-3 text-slate-600 font-bold whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="p-3 font-mono font-bold text-indigo-700">
                          {log.invoice_no || 'N/A'}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                            log.action === 'cash_refund' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                          }`}>
                            {log.action === 'cash_refund' ? t('Cash Refund', 'මුදල් ආපසු ගෙවීම') : t('Applied to Sale', 'විකුණුමට භාවිතා කරන ලදී')}
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono text-slate-600 font-bold">
                          {symbol} {convert(log.previous_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-right font-mono font-black text-amber-600">
                          {symbol} {convert(log.amount_applied).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-right font-mono font-black text-emerald-700">
                          {symbol} {convert(log.remaining_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="p-3 text-center text-slate-500 font-bold text-[10px]">
                          {log.user_email || 'system'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowCreditNoteUsageModal(false)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs"
              >
                {t('Close', 'වසා දමන්න')}
              </button>
            </div>
          </div>
        </Modal>
      )}



      {/* Interactive Order & Credit Receipt Preview Modal */}
      {showReceipt && lastOrder && (
        <Modal 
          isOpen={showReceipt} 
          onClose={() => setShowReceipt(false)} 
          title={t('Credit & Transaction Preview', 'ගනුදෙනු සහ ණය තොරතුරු පෙරදසුන')} 
          size="lg"
        >
          <div id="credit-preview-modal-content" className="space-y-4 p-4 text-center bg-white animate-in zoom-in duration-300">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-amber-50 text-[#DAA520] rounded-lg flex items-center justify-center border border-amber-200 shadow-inner">
                  <ReceiptIcon className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h4 className="font-black text-sm text-[#464646]">
                    {((lastOrder.payment_method || '').toLowerCase() === 'credit' || lastOrder.status === 'Non Paid' || lastOrder.status === 'Partially Settled' || lastOrder.status === 'Fully Settled' || (lastOrder as any).is_credit)
                      ? t('Credit Transaction & History Details', 'ණය ගනුදෙනු සහ පියවීම් විස්තර')
                      : t('Sales Receipt Preview', 'විකුණුම් රසීදු පෙරදසුන')}
                  </h4>
                  <p className="text-[10px] text-gray-400 font-bold">Invoice: {lastOrder.invoiceNo}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => handlePrintReceipt(lastOrder)} 
                  className="bg-[#DAA520] hover:bg-[#B8860B] text-white px-4 py-2 rounded-xl text-xs font-black shadow-md flex items-center gap-2 transition-all uppercase tracking-widest"
                >
                  <PrinterIcon className="w-4 h-4" /> {t('Print', 'මුද්‍රණය කරන්න')}
                </button>
                <button 
                  onClick={() => downloadReceiptPDF(lastOrder)} 
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-xs font-black shadow-md flex items-center gap-2 transition-all uppercase tracking-widest"
                >
                  <DownloadIcon className="w-4 h-4" /> {t('Download PDF', 'PDF බාගත කරන්න')}
                </button>
              </div>
            </div>

            {/* Credit Accounts Overview Card */}
            {((lastOrder.payment_method || '').toLowerCase() === 'credit' || lastOrder.status === 'Non Paid' || lastOrder.status === 'Partially Settled' || lastOrder.status === 'Fully Settled' || (lastOrder as any).is_credit) && (() => {
              const totalAmt = Number(lastOrder.total_amount !== undefined ? lastOrder.total_amount : lastOrder.total);
              const paidAmt = Number(lastOrder.payment_received || 0);
              const remBal = Math.max(0, totalAmt - paidAmt);
              const isSettled = remBal <= 0.01;
              const statusText = isSettled ? 'Fully Settled' : 'Partially Settled';

              const orderReturns = salesReturnsList.filter(sr => sr.status !== 'voided' && (sr.invoiceNo === lastOrder.invoiceNo || sr.invoice_no === lastOrder.invoiceNo));

              return (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left space-y-3 my-2">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                    <span className="text-xs font-black text-slate-700 uppercase tracking-wider">💳 Credit Account Summary</span>
                    <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${isSettled ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                      {isSettled ? t('Fully Settled', 'සම්පූර්ණයෙන්ම පියවා ඇත') : t('Partially Settled', 'කොටසක් පියවා ඇත')}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Invoice Amount</span>
                      <span className="font-black text-slate-800">{symbol} {convert(totalAmt).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Amount Paid</span>
                      <span className="font-black text-emerald-600">{symbol} {convert(paidAmt).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Outstanding Amount</span>
                      <span className="font-black text-rose-600">{symbol} {convert(remBal).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="bg-white p-2.5 rounded-xl border border-slate-200">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">Remaining Balance</span>
                      <span className="font-black text-slate-900">{symbol} {convert(remBal).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>

                  {orderReturns.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <span className="text-[10px] font-black text-amber-800 uppercase tracking-wider block mb-1">Associated Returns / Credit Notes:</span>
                      {orderReturns.map((r, rIdx) => (
                        <div key={rIdx} className="text-[11px] font-bold text-slate-700 bg-white p-2 rounded-lg border border-slate-200 flex justify-between">
                          <span>Return #{r.returnNo || r.id} ({r.returnMethod})</span>
                          <span className="text-rose-600">-{symbol} {convert(r.returnAmount || 0).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <ReceiptPreview order={lastOrder} isSinhala={isSinhala} customers={customers} salesReturns={salesReturnsList} />
            </div>

            <div className="pt-2">
              <button 
                onClick={() => setShowReceipt(false)} 
                className="w-full bg-gray-100 text-gray-500 py-3 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-gray-200 transition-colors"
              >
                {t('Close Preview', 'වසා දමන්න')}
              </button>
            </div>
          </div>
        </Modal>
      )}

    </div>

  );
}