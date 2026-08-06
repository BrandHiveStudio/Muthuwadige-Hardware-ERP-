import React, { useState, useEffect } from 'react';
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
import { API_URL } from '../lib/api'; 
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { SaleOrder, SaleItem, Customer, Product, Quotation, DeliveryNote, SalesReturn } from '../types';
import { sinhalaFontBase64 } from '../utils/sinhalaFontBase64';
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

const generateQuotePrintHTML = (quote: any, isSi: boolean, shopSettings?: any) => {
  const printerConfig = shopSettings?.printer_settings 
    ? (typeof shopSettings.printer_settings === 'object' 
        ? shopSettings.printer_settings 
        : (() => { try { return JSON.parse(shopSettings.printer_settings); } catch(e) { return {}; } })())
    : {};
  const paperSize = printerConfig?.paperSize || 'A4';

  if (paperSize === '80mm') {
    const symbolStr = isSi ? 'රු.' : 'Rs.';
    const formatNum = (num: number) => num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const title = isSi ? 'මිල ගණන් පත්‍රය' : 'QUOTATION';
    
    const items = typeof quote.items === 'string' ? JSON.parse(quote.items) : (quote.items || []);
    const itemsRows = items.map((i: any) => {
      let trackingInfo = '';
      if (i.serialNo || i.batchCode) {
        const parts: string[] = [];
        if (i.serialNo) parts.push(`S/N: ${i.serialNo}`);
        if (i.batchCode) parts.push(`Batch: ${i.batchCode}`);
        trackingInfo = `<div style="font-size: 8px; font-weight: normal; color: #6b7280; margin-top: 1px;">${parts.join(' | ')}</div>`;
      }
      return `
        <tr style="border-bottom: 1px dashed #e5e7eb;">
          <td colspan="2" style="padding: 4px 0; font-weight: bold; text-align: left; color: #1f2937; font-size: 11px;">
            ${i.productName}
            ${trackingInfo}
          </td>
        </tr>
        <tr style="border-bottom: 1px dashed #e5e7eb;">
          <td style="padding: 2px 0 6px 0; text-align: left; color: #4b5563; font-size: 10px;">
            ${i.qty} x ${symbolStr} ${formatNum(i.price)}
          </td>
          <td style="padding: 2px 0 6px 0; text-align: right; color: #1f2937; font-weight: bold; font-size: 11px;">
            ${symbolStr} ${formatNum(i.total)}
          </td>
        </tr>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Quotation - ${quote.quote_no}</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans+Sinhala:wght@400;600;700;800&display=swap" rel="stylesheet">
          <style>
            body {
              font-family: 'Inter', 'Noto Sans Sinhala', sans-serif;
              margin: 0;
              padding: 10px;
              background: #ffffff;
              color: #1f2937;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .receipt-container {
              max-width: 80mm;
              margin: 0 auto;
              box-sizing: border-box;
            }
            .header {
              text-align: center;
              border-bottom: 2px dashed #4b5563;
              padding-bottom: 10px;
              margin-bottom: 10px;
            }
            .header h1 {
              font-size: 14px;
              margin: 0 0 4px 0;
              font-weight: 800;
              color: #111827;
              text-transform: uppercase;
            }
            .header p {
              font-size: 9px;
              margin: 2px 0;
              color: #4b5563;
            }
            .title-badge {
              text-align: center;
              font-size: 11px;
              font-weight: 800;
              text-transform: uppercase;
              margin: 8px 0;
              letter-spacing: 1px;
              border: 1px solid #1f2937;
              padding: 3px;
              background: #f9fafb;
            }
            .meta-table {
              width: 100%;
              font-size: 9px;
              margin-bottom: 8px;
              border-collapse: collapse;
            }
            .meta-table td {
              padding: 2px 0;
              color: #4b5563;
            }
            .meta-table td.value {
              text-align: right;
              font-weight: 700;
              color: #1f2937;
            }
            .items-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 10px;
            }
            .items-table th {
              border-bottom: 1px solid #1f2937;
              padding: 4px 0;
              font-size: 9px;
              font-weight: 800;
              text-align: left;
              color: #1f2937;
            }
            .summary-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 5px;
              border-top: 2px dashed #4b5563;
              padding-top: 5px;
            }
            .summary-table td {
              padding: 3px 0;
              font-size: 9px;
              color: #4b5563;
            }
            .summary-table td.value {
              text-align: right;
              font-weight: 700;
              color: #1f2937;
            }
            .summary-table tr.total-row td {
              font-size: 12px;
              font-weight: 800;
              color: #111827;
              border-top: 1px dashed #4b5563;
              padding-top: 6px;
            }
            .footer {
              text-align: center;
              margin-top: 15px;
              border-top: 1px dashed #4b5563;
              padding-top: 10px;
              font-size: 9px;
              color: #6b7280;
            }
            .footer p {
              margin: 2px 0;
            }
            @media print {
              body {
                padding: 0;
                margin: 0;
              }
              .receipt-container {
                width: 100%;
                max-width: 100%;
              }
            }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <div class="header">
              <h1>${shopSettings?.shop_name || 'MUTHUWADIGE HARDWARE'}</h1>
              <p>${shopSettings?.address || 'No: 80, Mahahunupitiya, Negombo'}</p>
              <p>Tel: ${shopSettings?.phone || '077 076 076 7'}</p>
            </div>
            
            <div class="title-badge">${title}</div>
            
            <table class="meta-table">
              <tr>
                <td>${isSi ? 'මිල ගණන් අංකය:' : 'Quotation No:'}</td>
                <td class="value">${quote.quote_no}</td>
              </tr>
              <tr>
                <td>${isSi ? 'දිනය:' : 'Date:'}</td>
                <td class="value">${new Date(quote.created_at).toLocaleDateString()}</td>
              </tr>
              <tr>
                <td>${isSi ? 'පාරිභෝගිකයා:' : 'Customer:'}</td>
                <td class="value">${quote.customer_name}</td>
              </tr>
            </table>
            
            <table class="items-table">
              <thead>
                <tr>
                  <th style="text-align: left;">${isSi ? 'විස්තරය' : 'Item Description'}</th>
                  <th style="text-align: right; width: 80px;">${isSi ? 'එකතුව' : 'Total'}</th>
                </tr>
              </thead>
              <tbody>
                ${itemsRows}
              </tbody>
            </table>
            
            <table class="summary-table">
              <tr class="total-row">
                <td>${isSi ? 'මුළු එකතුව:' : 'Total Amount:'}</td>
                <td class="value">${symbolStr} ${formatNum(quote.total)}</td>
              </tr>
            </table>
            
            <div class="footer">
              <p>${isSi ? 'මෙම මිල ගණන් දින 30ක් සඳහා වලංගු වේ.' : 'This quotation is valid for 30 days.'}</p>
              <p style="font-weight: bold; margin-top: 5px;">${isSi ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි!' : 'Thank you for your business!'}</p>
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            }
          </script>
        </body>
      </html>
    `;
  }

  const symbolStr = isSi ? 'රු.' : 'Rs.';
  const formatNum = (num: number) => num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const title = isSi ? 'මිල ගණන් පත්‍රය' : 'QUOTATION';
  const billTo = isSi ? 'පාරිභෝගිකයා:' : 'CUSTOMER:';
  const quoteNoLabel = isSi ? 'මිල ගණන් අංකය:' : 'Quotation No:';
  const issueDateLabel = isSi ? 'දිනය:' : 'Date:';
  
  const descCol = isSi ? 'විස්තරය' : 'Description';
  const qtyCol = isSi ? 'ප්‍රමාණය' : 'Qty';
  const priceCol = isSi ? 'ඒකක මිල' : 'Unit Price';
  const totalCol = isSi ? 'එකතුව' : 'Total';
  
  const totalDueLabel = isSi ? 'මුළු මුදල:' : 'Total Amount:';
  
  const notesLabel = isSi ? 'සටහන්' : 'NOTES';
  const noteLine1 = isSi ? 'මෙම මිල ගණන් දින 30ක් සඳහා වලංගු වේ.' : 'This quotation is valid for 30 days.';
  const noteLine2 = isSi ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි!' : 'Thank you for your business!';
  const signeeLabel = isSi ? 'බලයලත් අත්සන' : 'Authorized Signee';

  const items = typeof quote.items === 'string' ? JSON.parse(quote.items) : (quote.items || []);
  const itemsRows = items.map((i: any) => {
    let trackingInfo = '';
    if (i.serialNo || i.batchCode) {
      const parts: string[] = [];
      if (i.serialNo) parts.push(`S/N: ${i.serialNo}`);
      if (i.batchCode) parts.push(`Batch: ${i.batchCode}`);
      trackingInfo = `<div style="font-size: 9px; font-weight: normal; color: #9ca3af; margin-top: 2px;">${parts.join(' | ')}</div>`;
    }
    return `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px 15px; font-weight: 700; text-align: left; color: #464646;">
          ${i.productName}
          ${trackingInfo}
        </td>
        <td style="padding: 12px 15px; text-align: center; color: #4b5563;">${i.qty}</td>
        <td style="padding: 12px 15px; text-align: right; color: #4b5563;">${symbolStr} ${formatNum(i.price)}</td>
        <td style="padding: 12px 15px; text-align: right; color: #464646; font-weight: 700;">${symbolStr} ${formatNum(i.total)}</td>
      </tr>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Quotation - ${quote.quote_no}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans+Sinhala:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Inter', 'Noto Sans Sinhala', sans-serif;
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #4b5563;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .invoice-container {
            width: 210mm;
            min-height: 297mm;
            padding: 20px;
            margin: 0 auto;
            position: relative;
            background: #ffffff;
            box-sizing: border-box;
          }
          .header-banner {
            background-color: #464646;
            height: 120px;
            padding: 20px 40px;
            color: #ffffff;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-sizing: border-box;
          }
          .company-info h1 {
            margin: 0;
            font-size: 26px;
            font-weight: 800;
            letter-spacing: 0.5px;
          }
          .company-info p {
            margin: 4px 0 0 0;
            font-size: 11px;
            font-weight: 400;
            opacity: 0.9;
          }
          .logo-container {
            position: absolute;
            right: 50px;
            top: 0;
            width: 240px;
            height: 275px;
            background: #000000;
            border-bottom-left-radius: 14px;
            border-bottom-right-radius: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
            border: 1px solid #e5e7eb;
            border-top: none;
            z-index: 100;
            box-sizing: border-box;
            padding: 6px;
          }
          .logo-container img {
            width: 100%;
            height: 100%;
            max-width: 228px;
            max-height: 263px;
            object-fit: contain;
          }
          .details-section {
            padding: 50px 40px 30px 40px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
          }
          .bill-to h2 {
            font-size: 11px;
            font-weight: 800;
            color: #9ca3af;
            letter-spacing: 1.5px;
            margin: 0 0 8px 0;
            text-transform: uppercase;
          }
          .bill-to p {
            margin: 4px 0;
            font-size: 14px;
            font-weight: 700;
            color: #464646;
          }
          .invoice-meta {
            text-align: right;
          }
          .invoice-meta h2 {
            font-size: 32px;
            font-weight: 800;
            color: #464646;
            margin: 0 0 15px 0;
            letter-spacing: -0.5px;
          }
          .meta-grid {
            display: grid;
            grid-template-columns: auto auto;
            gap: 6px 15px;
            font-size: 12px;
          }
          .meta-label {
            font-weight: 600;
            color: #9ca3af;
            text-align: left;
          }
          .meta-value {
            font-weight: 700;
            color: #464646;
            text-align: right;
          }
          .table-container {
            padding: 0 40px;
            margin-top: 10px;
          }
          .invoice-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
          }
          .invoice-table th {
            background-color: #f9fafb;
            border-bottom: 2px solid #e5e7eb;
            color: #4b5563;
            font-weight: 700;
            padding: 12px 15px;
            text-transform: uppercase;
            font-size: 10px;
            letter-spacing: 0.5px;
          }
          .totals-section {
            padding: 30px 40px;
            display: flex;
            justify-content: flex-end;
          }
          .totals-box {
            width: 300px;
            border-top: 2px solid #e5e7eb;
            padding-top: 15px;
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            font-size: 13px;
          }
          .total-row.grand-total {
            border-top: 1px solid #e5e7eb;
            padding-top: 15px;
            margin-top: 10px;
            font-size: 18px;
            font-weight: 800;
            color: #464646;
          }
          .footer-section {
            position: absolute;
            bottom: 40px;
            left: 40px;
            right: 40px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            border-top: 1px solid #e5e7eb;
            padding-top: 30px;
          }
          .notes-box {
            max-width: 50%;
          }
          .notes-box h3 {
            font-size: 10px;
            font-weight: 800;
            color: #9ca3af;
            letter-spacing: 1.5px;
            margin: 0 0 8px 0;
          }
          .notes-box p {
            font-size: 11px;
            margin: 4px 0;
            line-height: 1.4;
          }
          .signature-box {
            text-align: center;
            width: 200px;
          }
          .sig-line {
            border-top: 1px solid #9ca3af;
            margin-top: 40px;
            padding-top: 8px;
            font-size: 11px;
            font-weight: 600;
            color: #4b5563;
          }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <div class="header-banner">
            <div class="company-info">
              <h1>${shopSettings?.shop_name || 'MUTUWADIGE HARDWARE'}</h1>
              <p>${shopSettings?.address || '123 Main Road, Colombo'}</p>
              <p>Tel: ${shopSettings?.phone || '+94 77 123 4567'} | Email: ${shopSettings?.email || 'info@mutuwadige.lk'}</p>
            </div>
            ${shopSettings?.logo_path ? `<div class="logo-container"><img src="${shopSettings.logo_path}" style="width: 100%; height: 100%; max-width: 228px; max-height: 263px; object-fit: contain;" /></div>` : ''}
          </div>
          
          <div class="details-section">
            <div class="bill-to">
              <h2>${billTo}</h2>
              <p>${quote.customer_name}</p>
            </div>
            <div class="invoice-meta">
              <h2>${title}</h2>
              <div class="meta-grid">
                <div class="meta-label">${quoteNoLabel}</div>
                <div class="meta-value">${quote.quote_no}</div>
                <div class="meta-label">${issueDateLabel}</div>
                <div class="meta-value">${new Date(quote.created_at).toLocaleDateString()}</div>
              </div>
            </div>
          </div>
          
          <div class="table-container">
            <table class="invoice-table">
              <thead>
                <tr>
                  <th style="text-align: left;">${descCol}</th>
                  <th style="width: 80px; text-align: center;">${qtyCol}</th>
                  <th style="width: 120px; text-align: right;">${priceCol}</th>
                  <th style="width: 140px; text-align: right;">${totalCol}</th>
                </tr>
              </thead>
              <tbody>
                ${itemsRows}
              </tbody>
            </table>
          </div>
          
          <div class="totals-section">
            <div class="totals-box">
              <div class="total-row grand-total">
                <span>${totalDueLabel}</span>
                <span>${symbolStr} ${formatNum(quote.total)}</span>
              </div>
            </div>
          </div>
          
          <div class="footer-section">
            <div class="notes-box">
              <h3>${notesLabel}</h3>
              <p>${noteLine1}</p>
              <p>${noteLine2}</p>
            </div>
            <div class="signature-box">
              <div class="sig-line">${signeeLabel}</div>
            </div>
          </div>
        </div>
        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
    </html>
  `;
};

const generateDNPrintHTML = (dn: any, isSi: boolean, shopSettings?: any) => {
  const printerConfig = shopSettings?.printer_settings 
    ? (typeof shopSettings.printer_settings === 'object' 
        ? shopSettings.printer_settings 
        : (() => { try { return JSON.parse(shopSettings.printer_settings); } catch(e) { return {}; } })())
    : {};
  const paperSize = printerConfig?.paperSize || 'A4';

  if (paperSize === '80mm') {
    const title = isSi ? 'බෙදාහැරීම් සටහන' : 'DELIVERY NOTE';
    
    const items = typeof dn.items === 'string' ? JSON.parse(dn.items) : (dn.items || []);
    const itemsRows = items.map((i: any) => {
      let trackingInfo = '';
      if (i.serialNo || i.batchCode) {
        const parts: string[] = [];
        if (i.serialNo) parts.push(`S/N: ${i.serialNo}`);
        if (i.batchCode) parts.push(`Batch: ${i.batchCode}`);
        trackingInfo = `<div style="font-size: 8px; font-weight: normal; color: #6b7280; margin-top: 1px;">${parts.join(' | ')}</div>`;
      }
      return `
        <tr style="border-bottom: 1px dashed #e5e7eb;">
          <td style="padding: 4px 0; font-weight: bold; text-align: left; color: #1f2937; font-size: 11px;">
            ${i.productName}
            ${trackingInfo}
          </td>
          <td style="padding: 4px 0; text-align: right; color: #1f2937; font-weight: bold; font-size: 11px; width: 60px;">
            ${i.qty}
          </td>
        </tr>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Delivery Note - ${dn.dn_no}</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans+Sinhala:wght@400;600;700;800&display=swap" rel="stylesheet">
          <style>
            body {
              font-family: 'Inter', 'Noto Sans Sinhala', sans-serif;
              margin: 0;
              padding: 10px;
              background: #ffffff;
              color: #1f2937;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .receipt-container {
              max-width: 80mm;
              margin: 0 auto;
              box-sizing: border-box;
            }
            .header {
              text-align: center;
              border-bottom: 2px dashed #4b5563;
              padding-bottom: 10px;
              margin-bottom: 10px;
            }
            .header h1 {
              font-size: 14px;
              margin: 0 0 4px 0;
              font-weight: 800;
              color: #111827;
              text-transform: uppercase;
            }
            .header p {
              font-size: 9px;
              margin: 2px 0;
              color: #4b5563;
            }
            .title-badge {
              text-align: center;
              font-size: 11px;
              font-weight: 800;
              text-transform: uppercase;
              margin: 8px 0;
              letter-spacing: 1px;
              border: 1px solid #1f2937;
              padding: 3px;
              background: #f9fafb;
            }
            .meta-table {
              width: 100%;
              font-size: 9px;
              margin-bottom: 8px;
              border-collapse: collapse;
            }
            .meta-table td {
              padding: 2px 0;
              color: #4b5563;
            }
            .meta-table td.value {
              text-align: right;
              font-weight: 700;
              color: #1f2937;
            }
            .items-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 10px;
            }
            .items-table th {
              border-bottom: 1px solid #1f2937;
              padding: 4px 0;
              font-size: 9px;
              font-weight: 800;
              text-align: left;
              color: #1f2937;
            }
            .footer {
              text-align: center;
              margin-top: 25px;
              border-top: 1px dashed #4b5563;
              padding-top: 10px;
              font-size: 9px;
              color: #6b7280;
            }
            .footer p {
              margin: 2px 0;
            }
            .sig-section {
              margin-top: 20px;
              padding-top: 20px;
              border-top: 1px dashed #cccccc;
              text-align: center;
            }
            .sig-line {
              display: inline-block;
              width: 150px;
              border-top: 1px solid #6b7280;
              margin-top: 25px;
              font-size: 9px;
            }
            @media print {
              body {
                padding: 0;
                margin: 0;
              }
              .receipt-container {
                width: 100%;
                max-width: 100%;
              }
            }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <div class="header">
              <h1>${shopSettings?.shop_name || 'MUTHUWADIGE HARDWARE'}</h1>
              <p>${shopSettings?.address || 'No: 80, Mahahunupitiya, Negombo'}</p>
              <p>Tel: ${shopSettings?.phone || '077 076 076 7'}</p>
            </div>
            
            <div class="title-badge">${title}</div>
            
            <table class="meta-table">
              <tr>
                <td>${isSi ? 'බෙදාහැරීම් අංකය:' : 'Delivery Note No:'}</td>
                <td class="value">${dn.dn_no}</td>
              </tr>
              <tr>
                <td>${isSi ? 'දිනය:' : 'Date:'}</td>
                <td class="value">${new Date(dn.created_at).toLocaleDateString()}</td>
              </tr>
              <tr>
                <td>${isSi ? 'යොමු ඉන්වොයිසිය:' : 'Ref Invoice:'}</td>
                <td class="value">${dn.reference_invoice}</td>
              </tr>
              <tr>
                <td>${isSi ? 'පාරිභෝගිකයා:' : 'Customer:'}</td>
                <td class="value">${dn.customer_name}</td>
              </tr>
            </table>
            
            <table class="items-table">
              <thead>
                <tr>
                  <th style="text-align: left;">${isSi ? 'විස්තරය' : 'Item Description'}</th>
                  <th style="text-align: right; width: 60px;">${isSi ? 'ප්‍රමාණය' : 'Qty'}</th>
                </tr>
              </thead>
              <tbody>
                ${itemsRows}
              </tbody>
            </table>
            
            <div class="sig-section">
              <div class="sig-line">${isSi ? 'ලැබූ අයගේ අත්සන' : 'Received By (Signature)'}</div>
            </div>
            
            <div class="footer">
              <p>${isSi ? 'කරුණාකර භාණ්ඩ ලැබුණු පසු පරීක්ෂා කර අත්සන් කරන්න.' : 'Please inspect items upon delivery and sign above.'}</p>
              <p style="font-weight: bold; margin-top: 5px;">${isSi ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි!' : 'Thank you for your business!'}</p>
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            }
          </script>
        </body>
      </html>
    `;
  }

  const title = isSi ? 'බෙදාහැරීම් සටහන' : 'DELIVERY NOTE';
  const billTo = isSi ? 'පාරිභෝගිකයා:' : 'DELIVER TO:';
  const dnNoLabel = isSi ? 'බෙදාහැරීම් අංකය:' : 'Delivery Note No:';
  const issueDateLabel = isSi ? 'නිකුත් කළ දිනය:' : 'Date:';
  const refInvoiceLabel = isSi ? 'යොමු ඉන්වොයිසිය:' : 'Ref Invoice:';
  
  const descCol = isSi ? 'විස්තරය' : 'Description';
  const qtyCol = isSi ? 'ප්‍රමාණය' : 'Qty';
  
  const notesLabel = isSi ? 'සටහන්' : 'NOTES';
  const noteLine1 = isSi ? 'කරුණාකර භාණ්ඩ ලැබුණු පසු පරීක්ෂා කර අත්සන් කරන්න.' : 'Please inspect items upon delivery and sign below.';
  const noteLine2 = isSi ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි!' : 'Thank you for your business!';
  const signeeLabel = isSi ? 'ලැබූ අයගේ අත්සන' : 'Received By (Signature)';

  const items = typeof dn.items === 'string' ? JSON.parse(dn.items) : (dn.items || []);
  const itemsRows = items.map((i: any) => {
    let trackingInfo = '';
    if (i.serialNo || i.batchCode) {
      const parts: string[] = [];
      if (i.serialNo) parts.push(`S/N: ${i.serialNo}`);
      if (i.batchCode) parts.push(`Batch: ${i.batchCode}`);
      trackingInfo = `<div style="font-size: 9px; font-weight: normal; color: #9ca3af; margin-top: 2px;">${parts.join(' | ')}</div>`;
    }
    return `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px 15px; font-weight: 700; text-align: left; color: #464646;">
          ${i.productName}
          ${trackingInfo}
        </td>
        <td style="padding: 12px 15px; text-align: center; color: #4b5563; font-weight: 700;">${i.qty}</td>
      </tr>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Delivery Note - ${dn.dn_no}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans+Sinhala:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Inter', 'Noto Sans Sinhala', sans-serif;
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #4b5563;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .invoice-container {
            width: 210mm;
            min-height: 297mm;
            padding: 20px;
            margin: 0 auto;
            position: relative;
            background: #ffffff;
            box-sizing: border-box;
          }
          .header-banner {
            background-color: #464646;
            height: 120px;
            padding: 20px 40px;
            color: #ffffff;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-sizing: border-box;
          }
          .company-info h1 {
            margin: 0;
            font-size: 26px;
            font-weight: 800;
            letter-spacing: 0.5px;
          }
          .company-info p {
            margin: 4px 0 0 0;
            font-size: 11px;
            font-weight: 400;
            opacity: 0.9;
          }
          .logo-container {
            position: absolute;
            right: 60px;
            top: 0;
            width: 165px;
            height: 210px;
            background: #000000;
            border-bottom-left-radius: 10px;
            border-bottom-right-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
            border: 1px solid #e5e7eb;
            border-top: none;
            z-index: 100;
            box-sizing: border-box;
            padding: 10px;
          }
          .logo-container img {
            max-width: 140px;
            max-height: 185px;
            object-fit: contain;
          }
          .details-section {
            padding: 50px 40px 30px 40px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
          }
          .bill-to h2 {
            font-size: 11px;
            font-weight: 800;
            color: #9ca3af;
            letter-spacing: 1.5px;
            margin: 0 0 8px 0;
            text-transform: uppercase;
          }
          .bill-to p {
            margin: 4px 0;
            font-size: 14px;
            font-weight: 700;
            color: #464646;
          }
          .invoice-meta {
            text-align: right;
          }
          .invoice-meta h2 {
            font-size: 32px;
            font-weight: 800;
            color: #464646;
            margin: 0 0 15px 0;
            letter-spacing: -0.5px;
          }
          .meta-grid {
            display: grid;
            grid-template-columns: auto auto;
            gap: 6px 15px;
            font-size: 12px;
          }
          .meta-label {
            font-weight: 600;
            color: #9ca3af;
            text-align: left;
          }
          .meta-value {
            font-weight: 700;
            color: #464646;
            text-align: right;
          }
          .table-container {
            padding: 0 40px;
            margin-top: 10px;
          }
          .invoice-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
          }
          .invoice-table th {
            background-color: #f9fafb;
            border-bottom: 2px solid #e5e7eb;
            color: #4b5563;
            font-weight: 700;
            padding: 12px 15px;
            text-transform: uppercase;
            font-size: 10px;
            letter-spacing: 0.5px;
          }
          .footer-section {
            position: absolute;
            bottom: 40px;
            left: 40px;
            right: 40px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            border-top: 1px solid #e5e7eb;
            padding-top: 30px;
          }
          .notes-box {
            max-width: 50%;
          }
          .notes-box h3 {
            font-size: 10px;
            font-weight: 800;
            color: #9ca3af;
            letter-spacing: 1.5px;
            margin: 0 0 8px 0;
          }
          .notes-box p {
            font-size: 11px;
            margin: 4px 0;
            line-height: 1.4;
          }
          .signature-box {
            text-align: center;
            width: 200px;
          }
          .sig-line {
            border-top: 1px solid #9ca3af;
            margin-top: 40px;
            padding-top: 8px;
            font-size: 11px;
            font-weight: 600;
            color: #4b5563;
          }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <div class="header-banner">
            <div class="company-info">
              <h1>${shopSettings?.shop_name || 'MUTUWADIGE HARDWARE'}</h1>
              <p>${shopSettings?.address || '123 Main Road, Colombo'}</p>
              <p>Tel: ${shopSettings?.phone || '+94 77 123 4567'} | Email: ${shopSettings?.email || 'info@mutuwadige.lk'}</p>
            </div>
            ${shopSettings?.logo_path ? `<div class="logo-container"><img src="${shopSettings.logo_path}" style="width: 100%; height: 100%; max-width: 228px; max-height: 263px; object-fit: contain;" /></div>` : ''}
          </div>
          
          <div class="details-section">
            <div class="bill-to">
              <h2>${billTo}</h2>
              <p>${dn.customer_name}</p>
            </div>
            <div class="invoice-meta">
              <h2>${title}</h2>
              <div class="meta-grid">
                <div class="meta-label">${dnNoLabel}</div>
                <div class="meta-value">${dn.dn_no}</div>
                <div class="meta-label">${issueDateLabel}</div>
                <div class="meta-value">${new Date(dn.created_at).toLocaleDateString()}</div>
                <div class="meta-label">${refInvoiceLabel}</div>
                <div class="meta-value">${dn.reference_invoice}</div>
              </div>
            </div>
          </div>
          
          <div class="table-container">
            <table class="invoice-table">
              <thead>
                <tr>
                  <th style="text-align: left;">${descCol}</th>
                  <th style="width: 120px; text-align: center;">${qtyCol}</th>
                </tr>
              </thead>
              <tbody>
                ${itemsRows}
              </tbody>
            </table>
          </div>
          
          <div class="footer-section">
            <div class="notes-box">
              <h3>${notesLabel}</h3>
              <p>${noteLine1}</p>
              <p>${noteLine2}</p>
            </div>
            <div class="signature-box">
              <div class="sig-line">${signeeLabel}</div>
            </div>
          </div>
        </div>
        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
    </html>
  `;
};

// HTML template for native printing supporting Unicode Sinhala and Inter
const generatePrintHTML = (order: SaleOrder, isSi: boolean, shopSettings?: any) => {
  const printerConfig = shopSettings?.printer_settings 
    ? (typeof shopSettings.printer_settings === 'object' 
        ? shopSettings.printer_settings 
        : (() => { try { return JSON.parse(shopSettings.printer_settings); } catch(e) { return {}; } })())
    : {};
  const paperSize = printerConfig?.paperSize || 'A4';

  if (paperSize === '80mm') {
    const symbolStr = isSi ? 'රු.' : 'Rs.';
    const formatNum = (num: number) => num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const isCredit = order.payment_method === 'Credit' || order.status === 'Non Paid';
    const title = isCredit 
      ? (isSi ? 'ණය ඉන්වොයිසිය' : 'CREDIT INVOICE')
      : (isSi ? 'ඉන්වොයිසිය' : 'INVOICE');
    
    const itemsRows = (order.items || []).map((i: any) => {
      let trackingInfo = '';
      if (i.serialNo || i.batchCode) {
        const parts: string[] = [];
        if (i.serialNo) parts.push(`S/N: ${i.serialNo}`);
        if (i.batchCode) parts.push(`Batch: ${i.batchCode}`);
        trackingInfo = `<div style="font-size: 8px; font-weight: normal; color: #6b7280; margin-top: 1px;">${parts.join(' | ')}</div>`;
      }
      return `
        <tr style="border-bottom: 1px dashed #e5e7eb;">
          <td colspan="2" style="padding: 4px 0; font-weight: bold; text-align: left; color: #1f2937; font-size: 11px;">
            ${i.productName}
            ${trackingInfo}
          </td>
        </tr>
        <tr style="border-bottom: 1px dashed #e5e7eb;">
          <td style="padding: 2px 0 6px 0; text-align: left; color: #4b5563; font-size: 10px;">
            ${i.qty} ${i.unit || ''} x ${symbolStr} ${formatNum(i.price)}
          </td>
          <td style="padding: 2px 0 6px 0; text-align: right; color: #1f2937; font-weight: bold; font-size: 11px;">
            ${symbolStr} ${formatNum(i.total)}
          </td>
        </tr>
      `;
    }).join('');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Invoice - ${order.invoiceNo}</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans+Sinhala:wght@400;600;700;800&display=swap" rel="stylesheet">
          <style>
            body {
              font-family: 'Inter', 'Noto Sans Sinhala', sans-serif;
              margin: 0;
              padding: 10px;
              background: #ffffff;
              color: #1f2937;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .receipt-container {
              max-width: 80mm;
              margin: 0 auto;
              box-sizing: border-box;
            }
            .header {
              text-align: center;
              border-bottom: 2px dashed #4b5563;
              padding-bottom: 10px;
              margin-bottom: 10px;
            }
            .header h1 {
              font-size: 14px;
              margin: 0 0 4px 0;
              font-weight: 800;
              color: #111827;
              text-transform: uppercase;
            }
            .header p {
              font-size: 9px;
              margin: 2px 0;
              color: #4b5563;
            }
            .title-badge {
              text-align: center;
              font-size: 11px;
              font-weight: 800;
              text-transform: uppercase;
              margin: 8px 0;
              letter-spacing: 1px;
              border: 1px solid #1f2937;
              padding: 3px;
              background: #f9fafb;
            }
            .meta-table {
              width: 100%;
              font-size: 9px;
              margin-bottom: 8px;
              border-collapse: collapse;
            }
            .meta-table td {
              padding: 2px 0;
              color: #4b5563;
            }
            .meta-table td.value {
              text-align: right;
              font-weight: 700;
              color: #1f2937;
            }
            .items-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 10px;
            }
            .items-table th {
              border-bottom: 1px solid #1f2937;
              padding: 4px 0;
              font-size: 9px;
              font-weight: 800;
              text-align: left;
              color: #1f2937;
            }
            .summary-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 5px;
              border-top: 2px dashed #4b5563;
              padding-top: 5px;
            }
            .summary-table td {
              padding: 3px 0;
              font-size: 9px;
              color: #4b5563;
            }
            .summary-table td.value {
              text-align: right;
              font-weight: 700;
              color: #1f2937;
            }
            .summary-table tr.total-row td {
              font-size: 12px;
              font-weight: 800;
              color: #111827;
              border-top: 1px dashed #4b5563;
              padding-top: 6px;
            }
            .footer {
              text-align: center;
              margin-top: 15px;
              border-top: 1px dashed #4b5563;
              padding-top: 10px;
              font-size: 9px;
              color: #6b7280;
            }
            .footer p {
              margin: 2px 0;
            }
            @media print {
              body {
                padding: 0;
                margin: 0;
              }
              .receipt-container {
                width: 100%;
                max-width: 100%;
              }
            }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <div class="header">
              <h1>${shopSettings?.shop_name || 'MUTHUWADIGE HARDWARE'}</h1>
              <p>${shopSettings?.address || 'No: 80, Mahahunupitiya, Negombo'}</p>
              <p>Tel: ${shopSettings?.phone || '077 076 076 7'}</p>
            </div>
            
            <div class="title-badge">${title}</div>
            
            <table class="meta-table">
              <tr>
                <td>${isSi ? 'ඉන්වොයිස් අංකය:' : 'Invoice No:'}</td>
                <td class="value">${order.invoiceNo}</td>
              </tr>
              <tr>
                <td>${isSi ? 'දිනය:' : 'Date:'}</td>
                <td class="value">${formatInvoiceDateTime(order.created_at, order.date)}</td>
              </tr>
              <tr>
                <td>${isSi ? 'පාරිභෝගිකයා:' : 'Customer:'}</td>
                <td class="value">${order.customerName}</td>
              </tr>
              <tr>
                <td>${isSi ? 'ගෙවීම් ක්‍රමය:' : 'Payment Method:'}</td>
                <td class="value">${order.payment_method}</td>
              </tr>
            </table>
            
            <table class="items-table">
              <thead>
                <tr>
                  <th style="text-align: left;">${isSi ? 'විස්තරය' : 'Item Description'}</th>
                  <th style="text-align: right; width: 80px;">${isSi ? 'එකතුව' : 'Total'}</th>
                </tr>
              </thead>
              <tbody>
                ${itemsRows}
              </tbody>
            </table>
            
            <table class="summary-table">
              <tr>
                <td>${isSi ? 'උප එකතුව:' : 'Sub Total:'}</td>
                <td class="value">${symbolStr} ${formatNum(order.subtotal || 0)}</td>
              </tr>
              <tr>
                <td>${isSi ? 'වට්ටම:' : 'Discount:'}</td>
                <td class="value">-${symbolStr} ${formatNum(order.discount || 0)}</td>
              </tr>
              <tr>
                <td>${isSi ? `බද්ද (${order.tax_rate || 0}%):` : `Tax (${order.tax_rate || 0}%):`}</td>
                <td class="value">+${symbolStr} ${formatNum(order.tax || 0)}</td>
              </tr>
              <tr class="total-row">
                <td>${isSi ? 'මුළු එකතුව:' : 'Total Amount:'}</td>
                <td class="value">${symbolStr} ${formatNum(order.total)}</td>
              </tr>
            </table>
            
            <div class="footer">
              <p>${isSi ? 'කිසියම් ප්‍රශ්නයක් ඇත්නම් කරුණාකර අප හා සම්බන්ධ වන්න.' : 'For queries, please contact us.'}</p>
              <p style="font-weight: bold; margin-top: 5px;">${isSi ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි!' : 'Thank you for your business!'}</p>
            </div>
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 300);
            }
          </script>
        </body>
      </html>
    `;
  }

  const symbolStr = isSi ? 'රු.' : 'Rs.';
  const formatNum = (num: number) => num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const isCredit = order.payment_method === 'Credit' || order.status === 'Non Paid';
  const title = isCredit 
    ? (isSi ? 'ණය ඉන්වොයිසිය / CREDIT' : 'CREDIT')
    : (isSi ? 'ඉන්වොයිසිය' : 'INVOICE');
  const billTo = isSi ? 'පාරිභෝගිකයා:' : 'BILL TO:';
  const invoiceNoLabel = isSi ? 'ඉන්වොයිස් අංකය:' : 'Invoice No:';
  const issueDateLabel = isSi ? 'නිකුත් කළ දිනය:' : 'Issue Date:';
  
  const descCol = isSi ? 'විස්තරය' : 'Description';
  const qtyCol = isSi ? 'ප්‍රමාණය' : 'Qty';
  const priceCol = isSi ? 'ඒකක මිල' : 'Unit Price';
  const totalCol = isSi ? 'එකතුව' : 'Total';
  
  const subTotalLabel = isSi ? 'උප එකතුව:' : 'Sub Total:';
  const discountLabel = isSi ? 'වට්ටම:' : 'Discount:';
  const taxLabel = isSi ? `බද්ද (${order.tax_rate || 0}%):` : `Tax (${order.tax_rate || 0}%):`;
  const totalDueLabel = isSi ? 'ගෙවිය යුතු මුළු මුදල:' : 'Total Due:';
  
  const notesLabel = isSi ? 'සටහන්' : 'NOTES';
  const noteLine1 = isSi ? 'කිසියම් ප්‍රශ්නයක් ඇත්නම් කරුණාකර අප හා සම්බන්ධ වන්න.' : 'Please feel free to contact us in case of any questions.';
  const noteLine2 = isSi ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි!' : 'Thank you for your business!';
  const signeeLabel = isSi ? 'බලයලත් අත්සන' : 'Authorized Signee';

  const itemsRows = (order.items || []).map((i: any) => {
    let trackingInfo = '';
    if (i.serialNo || i.batchCode) {
      const parts: string[] = [];
      if (i.serialNo) parts.push(`S/N: ${i.serialNo}`);
      if (i.batchCode) parts.push(`Batch: ${i.batchCode}`);
      trackingInfo = `<div style="font-size: 9px; font-weight: normal; color: #9ca3af; margin-top: 2px;">${parts.join(' | ')}</div>`;
    }
    return `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px 15px; font-weight: 700; text-align: left; color: #464646;">
          ${i.productName}
          ${trackingInfo}
        </td>
        <td style="padding: 12px 15px; text-align: center; color: #4b5563;">${i.qty} ${i.unit || ''}</td>
        <td style="padding: 12px 15px; text-align: right; color: #4b5563;">${symbolStr} ${formatNum(i.price)}</td>
        <td style="padding: 12px 15px; text-align: right; color: #464646; font-weight: 700;">${symbolStr} ${formatNum(i.total)}</td>
      </tr>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Invoice - ${order.invoiceNo}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans+Sinhala:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Inter', 'Noto Sans Sinhala', sans-serif;
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #4b5563;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .invoice-container {
            width: 210mm;
            min-height: 297mm;
            padding: 0;
            margin: 0 auto;
            position: relative;
            background: #ffffff;
            box-sizing: border-box;
          }
          .header-banner {
            background-color: #464646;
            height: 120px;
            padding: 20px 40px;
            color: #ffffff;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-sizing: border-box;
          }
          .company-info h1 {
            margin: 0;
            font-size: 26px;
            font-weight: 800;
            letter-spacing: 0.5px;
          }
          .company-info p {
            margin: 4px 0 0 0;
            font-size: 11px;
            font-weight: 400;
            opacity: 0.9;
          }
          .logo-container {
            position: absolute;
            right: 50px;
            top: 0;
            width: 240px;
            height: 280px;
            background: #000000;
            border-bottom-left-radius: 14px;
            border-bottom-right-radius: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 6px rgba(0,0,0,0.05);
            border: 1px solid #e5e7eb;
            border-top: none;
            z-index: 100;
            box-sizing: border-box;
            padding: 6px;
          }
          .logo-container img {
            width: 100%;
            height: 100%;
            max-width: 228px;
            max-height: 268px;
            object-fit: contain;
          }
          .invoice-title-wrapper {
            margin-top: 100px;
            text-align: center;
          }
          .invoice-title {
            font-size: 20px;
            font-weight: 800;
            color: #595959;
            letter-spacing: 2px;
            text-transform: uppercase;
            margin: 0;
          }
          .credit-title-badge {
            background-color: #0f172a; /* slate-900 */
            border: 2px solid #f59e0b; /* amber-500 */
            color: #fbbf24; /* amber-400 */
            display: inline-block;
            padding: 10px 35px;
            border-radius: 12px;
            box-shadow: 0 4px 10px rgba(15, 23, 42, 0.15);
          }
          .credit-title {
            font-size: 24px;
            font-weight: 900;
            letter-spacing: 6px;
            text-transform: uppercase;
            margin: 0;
          }
          .meta-section {
            display: flex;
            justify-content: space-between;
            margin: 30px 40px 20px 40px;
          }
          .bill-to h2 {
            font-size: 11px;
            font-weight: 800;
            color: #595959;
            margin: 0 0 6px 0;
            letter-spacing: 0.5px;
          }
          .bill-to p {
            font-size: 15px;
            font-weight: 700;
            color: #2c2c2c;
            margin: 0;
          }
          .invoice-details {
            text-align: right;
            font-size: 11px;
            line-height: 1.8;
          }
          .invoice-details table {
            border-collapse: collapse;
            margin-left: auto;
          }
          .invoice-details td {
            padding: 2px 0;
          }
          .invoice-details td.label {
            font-weight: 800;
            color: #595959;
            padding-right: 15px;
            text-align: left;
          }
          .invoice-details td.value {
            font-weight: 400;
            color: #4b5563;
            text-align: right;
          }
          .table-section {
            margin: 20px 40px;
          }
          .invoice-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
          }
          .invoice-table th {
            background-color: #d29d2b;
            color: #ffffff;
            font-weight: 800;
            text-transform: uppercase;
            padding: 10px 12px;
            letter-spacing: 0.5px;
          }
          .invoice-table th.desc { text-align: left; width: 50%; }
          .invoice-table th.qty { text-align: center; width: 10%; }
          .invoice-table th.price { text-align: right; width: 20%; }
          .invoice-table th.total { text-align: right; width: 20%; }
          
          .summary-section {
            display: flex;
            justify-content: space-between;
            margin: 60px 40px 20px 40px; /* Generous top margin to place note section beautifully at bottom */
          }
          .notes-box {
            width: 50%;
          }
          .notes-box h3 {
            font-size: 11px;
            font-weight: 800;
            color: #d29d2b;
            margin: 0 0 6px 0;
            letter-spacing: 0.5px;
          }
          .notes-box p {
            font-size: 11px;
            margin: 0 0 4px 0;
            color: #6b7280;
          }
          .notes-box p.thanks {
            font-weight: 700;
            color: #4b5563;
          }
          .totals-box {
            width: 40%;
            font-size: 12px;
          }
          .totals-box table {
            width: 100%;
            border-collapse: collapse;
          }
          .totals-box td {
            padding: 6px 0;
          }
          .totals-box td.label {
            font-weight: 700;
            color: #595959;
            text-align: left;
          }
          .totals-box td.value {
            font-weight: 700;
            color: #4b5563;
            text-align: right;
          }
          .totals-box tr.total-due-row td {
            padding: 10px;
            background: #f3f4f6; /* Cloned exactly: Light grey background */
          }
          .totals-box tr.total-due-row td.label {
            font-size: 13px;
            font-weight: 800;
            color: #464646; /* Dark text matching invoice body */
          }
          .totals-box tr.total-due-row td.value {
            font-size: 14px;
            font-weight: 800;
            color: #464646; /* Dark text matching invoice body */
          }
          .signature-section {
            margin-top: 80px;
            text-align: right;
            padding-right: 40px;
          }
          .signature-line {
            display: inline-block;
            border-top: 1px solid #9ca3af;
            width: 180px;
            text-align: center;
            padding-top: 6px;
            font-size: 11px;
            font-style: italic;
            color: #6b7280;
          }
          @media print {
            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .invoice-container {
              width: 100%;
              min-height: auto;
              box-shadow: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <div class="header-banner">
            <div class="company-info">
              <h1>${shopSettings?.shop_name || 'MUTHUWADIGE HARDWARE'}</h1>
              <p>${shopSettings?.address || 'No: 80, Mahahunupitiya, Negombo'}</p>
              <p>Contact: ${shopSettings?.phone || '077 076 076 7'}</p>
            </div>
            <div class="logo-container">
              ${shopSettings?.logo_path ? 
                `<img src="${shopSettings.logo_path}" alt="Shop Logo" onerror="this.style.display='none';" />` : 
                `<img src="./images/logo.png" alt="Muthuwadige Logo" onerror="this.style.display='none';" />`
              }
            </div>
          </div>
          
          <div class="invoice-title-wrapper">
            ${isCredit ? `
              <div class="credit-title-badge">
                <h1 class="credit-title">${title}</h1>
              </div>
            ` : `
              <h1 class="invoice-title">${title}</h1>
            `}
          </div>
          
          <div class="meta-section">
            <div class="bill-to">
              <h2>${billTo}</h2>
              <p>${order.customerName}</p>
              ${(order.customerPhone || order.customer_phone) ? `<p style="font-size: 11px; color: #4b5563; margin-top: 3px; font-weight: 600;">Tel: ${order.customerPhone || order.customer_phone}</p>` : ''}
              ${(order.customerAddress || order.customer_address) ? `<p style="font-size: 11px; color: #4b5563; margin-top: 2px;">Address: ${order.customerAddress || order.customer_address}</p>` : ''}
            </div>
            <div class="invoice-details">
              <table>
                <tr>
                  <td class="label">${invoiceNoLabel}</td>
                  <td class="value">${order.invoiceNo}</td>
                </tr>
                <tr>
                  <td class="label">${issueDateLabel}</td>
                  <td class="value">${formatInvoiceDateTime(order.created_at, order.date)}</td>
                </tr>
              </table>
            </div>
          </div>
          
          <div class="table-section">
            <table class="invoice-table">
              <thead>
                <tr>
                  <th class="desc">${descCol}</th>
                  <th class="qty">${qtyCol}</th>
                  <th class="price">${priceCol}</th>
                  <th class="total">${totalCol}</th>
                </tr>
              </thead>
              <tbody>
                ${itemsRows}
              </tbody>
            </table>
          </div>
          
          <div class="summary-section">
            <div class="notes-box">
              <h3>${notesLabel}</h3>
              <p>${noteLine1}</p>
              <p class="thanks">${noteLine2}</p>
            </div>
            
            <div class="totals-box">
              <table>
                <tr>
                  <td class="label">${subTotalLabel}</td>
                  <td class="value">${symbolStr} ${formatNum(order.subtotal || 0)}</td>
                </tr>
                <tr>
                  <td class="label">${discountLabel}</td>
                  <td class="value">-${symbolStr} ${formatNum(order.discount || 0)}</td>
                </tr>
                <tr>
                  <td class="label">${taxLabel}</td>
                  <td class="value">+${symbolStr} ${formatNum(order.tax || 0)}</td>
                </tr>
                <tr class="total-due-row">
                  <td class="label">${totalDueLabel}</td>
                  <td class="value">${symbolStr} ${formatNum(order.total)}</td>
                </tr>
              </table>
            </div>
          </div>
          
          <div class="signature-section">
            <span class="signature-line">${signeeLabel}</span>
          </div>
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          }
        </script>
      </body>
    </html>
  `;
};

const formatInvoiceDateTime = (created_at?: string, fallbackDate?: string) => {
  const dateSource = created_at || fallbackDate;
  if (!dateSource) return '';
  const d = new Date(dateSource);
  if (isNaN(d.getTime())) return dateSource;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
};

// Premium On-Screen Interactive Preview Component
function ReceiptPreview({ order, isSinhala }: { order: SaleOrder; isSinhala: boolean }) {
  const symbol = isSinhala ? 'රු.' : 'Rs.';
  const formatNum = (num: number) => num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  return (
    <div id="receipt-preview" className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-inner text-left max-w-2xl mx-auto my-4 font-sans leading-relaxed">
      {/* Dark Header Banner */}
      <div className="bg-[#464646] p-6 text-white relative flex justify-between items-center h-[110px] overflow-visible">
        <div>
          <h1 className="text-lg font-black tracking-wide m-0 leading-tight">MUTHUWADIGE HARDWARE</h1>
          <p className="text-[10px] opacity-90 m-0 mt-1 font-semibold">No: 80, Mahahunupitiya, Negombo</p>
          <p className="text-[10px] opacity-90 m-0 mt-0.5 font-semibold">Contact: 077 076 076 7</p>
        </div>
        {/* White Protruding Logo Container */}
        <div className="absolute right-8 top-0 bg-black border border-gray-900 border-t-0 rounded-b-lg w-[102px] h-[138px] flex items-center justify-center shadow-md z-10 p-2">
          <img src="./images/logo.png" alt="Logo" className="max-w-full max-h-full object-contain" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
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
          <p className="text-[#2c2c2c] font-black text-sm">{order.customerName}</p>
          {(order.customerPhone || order.customer_phone) && (
            <p className="text-gray-500 font-bold text-xs mt-0.5">Tel: {order.customerPhone || order.customer_phone}</p>
          )}
          {(order.customerAddress || order.customer_address) && (
            <p className="text-gray-500 font-bold text-xs mt-0.5">Address: {order.customerAddress || order.customer_address}</p>
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
            {(order.items || []).map((item: any, idx: number) => (
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
      
      {/* Bottom section matching paper output exactly */}
      <div className="mx-6 mt-12 mb-4 flex justify-between items-start flex-wrap gap-4 text-xs">
        {/* Notes on bottom left */}
        <div className="w-[45%]">
          <h3 className="text-[#d29d2b] text-[9px] font-black uppercase tracking-wider mb-1">{isSinhala ? 'සටහන්' : 'NOTES'}</h3>
          <p className="text-gray-400 font-semibold mb-1 text-[10px]">{isSinhala ? 'කිසියම් ප්‍රශ්නයක් ඇත්නම් කරුණාකර අප හා සම්බන්ධ වන්න.' : 'Please feel free to contact us in case of any questions.'}</p>
          <p className="text-[#4b5563] font-bold text-[10px]">{isSinhala ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි!' : 'Thank you for your business!'}</p>
        </div>
        
        {/* Totals with exact light grey styling */}
        <div className="w-[45%] space-y-2 text-right">
          <div className="flex justify-between font-semibold text-gray-500">
            <span>{isSinhala ? 'උප එකතුව:' : 'Sub Total:'}</span>
            <span className="font-bold text-[#4b5563]">{symbol} {formatNum(order.subtotal || 0)}</span>
          </div>
          <div className="flex justify-between font-semibold text-gray-500">
            <span>{isSinhala ? 'වට්ටම:' : 'Discount:'}</span>
            <span className="font-bold text-[#4b5563]">-{symbol} {formatNum(order.discount || 0)}</span>
          </div>
          <div className="flex justify-between font-semibold text-gray-500">
            <span>{isSinhala ? `බද්ද (${order.tax_rate || 0}%):` : `Tax (${order.tax_rate || 0}%):`}</span>
            <span className="font-bold text-[#4b5563]">+{symbol} {formatNum(order.tax || 0)}</span>
          </div>
          <div className="flex justify-between items-center py-2.5 px-3 bg-[#f3f4f6] rounded-lg text-sm font-black text-[#464646] mt-2 border border-gray-100">
            <span>{isSinhala ? 'ගෙවිය යුතු මුළු මුදල:' : 'Total Due:'}</span>
            <span className="text-base">{symbol} {formatNum(order.total)}</span>
          </div>
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
  const [quoteCustomerName, setQuoteCustomerName] = useState('');
  const [quoteCart, setQuoteCart] = useState<SaleItem[]>([]);
  const [selectedQuoteProduct, setSelectedQuoteProduct] = useState<Product | null>(null);
  const [quoteQty, setQuoteQty] = useState(1);
  const [quoteSearch, setQuoteSearch] = useState('');

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

  // Void Passkey Modal State
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidPasskeyInput, setVoidPasskeyInput] = useState('');
  const [targetVoidInvoiceId, setTargetVoidInvoiceId] = useState<string | null>(null);
  const [targetVoidReturnId, setTargetVoidReturnId] = useState<string | null>(null);

  // Sales Returns State
  const [salesReturnsList, setSalesReturnsList] = useState<SalesReturn[]>([]);
  const [returnSearchQuery, setReturnSearchQuery] = useState('');
  const [targetReturnInvoice, setTargetReturnInvoice] = useState<SaleOrder | null>(null);
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [returnMethod, setReturnMethod] = useState<'Cash Refund' | 'Exchange' | 'Credit Note'>('Cash Refund');
  const [returnReason, setReturnReason] = useState('');

  const fetchSalesReturns = async () => {
    try {
      const res = await fetch(`${API_URL}/sales/returns`);
      if (res.ok) {
        const data = await res.json();
        setSalesReturnsList(data || []);
      }
    } catch (e) {
      console.error('Failed to fetch sales returns', e);
    }
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

  const updateCreditQty = (idx: number, qty: number) => {
    setCreditCartItems(prev => {
      const updated = [...prev];
      if (qty <= 0) {
        updated.splice(idx, 1);
      } else {
        const item = updated[idx];
        const gross = qty * item.price;
        updated[idx] = { ...item, qty, total: gross };
      }
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
      let finalCustomerName = creditCustomerName.trim();

      // If it is a new customer, save them to the customers table first!
      if (!customerId && creditCustomerName.trim()) {
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
          if (newCust) {
            customerId = newCust.id;
            finalCustomerName = newCust.name;
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
        payment_method: 'Credit'
      };

      const { data: saleRecord, error: saleError } = await supabase.from('sales').insert([newOrderData]).select().single();
      if (saleError) throw saleError;

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
        id: saleRecord.id || `so_${Date.now()}`,
        invoiceNo: saleRecord.invoice_no || saleRecord.invoiceNo || newOrderData.invoice_no,
        customer_id: newOrderData.customer_id || '',
        customerName: newOrderData.customer_name,
        cashier: user?.email || 'system',
        date: new Date().toLocaleDateString(),
        items: creditCartItems,
        created_at: saleRecord.created_at,
        subtotal: grossCreditSubtotal,
        discount: creditTotalDiscount,
        tax: creditTaxAmt,
        tax_rate: applyTax ? creditTaxRate : 0,
        total: creditTotal,
        status: 'Non Paid',
        due_date: newOrderData.due_date,
        credit_period_days: newOrderData.credit_period_days,
        payment_method: 'Credit'
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

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { data: prodData } = await supabase.from('products').select('*');
      if (prodData) setProducts(prodData);

      const { data: custData } = await supabase.from('customers').select('*');
      if (custData) setCustomers(custData);

      const { data: salesData } = await supabase
        .from('sales')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (salesData) {
        const mappedOrders = salesData.map((s: any) => ({
          ...s,
          invoiceNo: s.invoice_no,
          customerName: s.customerName || s.customer_name || custData?.find((c: any) => c.id === s.customer_id)?.name || 'Guest',
          customerPhone: s.customerPhone || s.customer_phone || custData?.find((c: any) => c.id === s.customer_id)?.phone || '',
          customerAddress: s.customerAddress || s.customer_address || custData?.find((c: any) => c.id === s.customer_id)?.address || '',
          date: (() => {
            const d = new Date(s.created_at);
            if (isNaN(d.getTime())) return '';
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
          })(),
          total: s.total_amount 
        }));
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

      const { data: quotesData } = await supabase.from('quotations').select('*');
      if (quotesData) setQuotes(quotesData);

      const { data: dnData } = await supabase.from('delivery_notes').select('*');
      if (dnData) setDeliveryNotes(dnData);
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setIsLoading(false);
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

  // Download Receipt via html2canvas as a PNG/PDF depending on selected language
  const downloadReceiptPDF = async (order: SaleOrder) => {
    const element = document.getElementById('receipt-preview');
    if (!element) {
      alert(t("Receipt preview element not found!", "ඉන්වොයිස් පෙරදසුන හමු නොවීය!"));
      return;
    }

    try {
      // Temporarily scroll to top of preview so html2canvas captures entire height without clipping if scrolled
      const parentContainer = element.parentElement;
      const originalScrollTop = parentContainer ? parentContainer.scrollTop : 0;
      if (parentContainer) parentContainer.scrollTop = 0;

      // Render the HTML element to canvas with high resolution scale
      const canvas = await html2canvas(element, {
        scale: 3, // scale up for high definition sharp text
        useCORS: true, // handle logo loading correctly
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false
      });

      // Restore scroll position
      if (parentContainer) parentContainer.scrollTop = originalScrollTop;

      const imgData = canvas.toDataURL('image/png');

      if (!isSinhala) {
        // When English is selected, enable PDF download functionality
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 190; // Page width minus margins
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let position = 10; // Start with a small top margin

        pdf.addImage(imgData, 'PNG', 10, position, imgWidth, imgHeight);
        pdf.save(`Invoice_${order.invoiceNo}.pdf`);
      } else {
        // Fallback to high-quality PNG image for Sinhala to preserve all complex Sinhala glyphs perfectly
        const link = document.createElement('a');
        link.download = `Invoice_${order.invoiceNo}.png`;
        link.href = imgData;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err: any) {
      console.error("Failed to download receipt:", err);
      alert(t("Failed to download receipt: ", "ඉන්වොයිසිය බාගත කිරීමට අපොහොසත් විය: ") + (err?.message || err));
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

  const filteredProducts = products.filter(
    (p) =>
      (p.name.toLowerCase().includes(productSearch.toLowerCase()) || 
       (p.sku && p.sku.toLowerCase().includes(productSearch.toLowerCase())) ||
       (p.barcode && p.barcode.toLowerCase().includes(productSearch.toLowerCase()))) &&
      productSearch.length > 0
  );

  const creditFilteredProducts = products.filter(
    (p) =>
      (p.name.toLowerCase().includes(creditProductSearch.toLowerCase()) || 
       (p.sku && p.sku.toLowerCase().includes(creditProductSearch.toLowerCase())) ||
       (p.barcode && p.barcode.toLowerCase().includes(creditProductSearch.toLowerCase()))) &&
      creditProductSearch.length > 0
  );

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
        conversionRate: initialRate
      }];
    });
    setProductSearch('');
  };

  const updateQty = (productId: string, newQty: number) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const item = cartItems.find(i => i.productId === productId);
    const conversionRate = item?.conversionRate || 1;
    const baseStock = Number(product.stock) || 0;
    const stockAvailableInSelectedUnit = Math.round((baseStock * conversionRate) * 100000) / 100000;
    const targetQty = Math.round(Math.max(0, newQty) * 100000) / 100000;

    if (targetQty > stockAvailableInSelectedUnit) {
      alert(t(
        `Only ${stockAvailableInSelectedUnit.toFixed(2)} ${item?.unit || 'item(s)'} available in stock!`,
        `තොගයේ ඇත්තේ ${stockAvailableInSelectedUnit.toFixed(2)} ${item?.unit || ''} ක් පමණි!`
      ));
      setCartItems((prev) => prev.map((i) => i.productId === productId ? { ...i, qty: stockAvailableInSelectedUnit, total: stockAvailableInSelectedUnit * i.price } : i));
      return;
    }

    setCartItems((prev) => prev.map((i) => i.productId === productId ? { ...i, qty: targetQty, total: targetQty * i.price } : i));
  };

  const subtotal = cartItems.reduce((sum, i) => sum + i.total, 0);
  const discountAmt = subtotal * (discount / 100);
  const taxAmt = applyTax ? (subtotal - discountAmt) * (taxRate / 100) : 0;
  const totalAmountValue = subtotal - discountAmt + taxAmt + (Number(transportationFee) || 0);

  const processSale = async () => {
    if ((!isGuest && !selectedCustomer) || cartItems.length === 0) {
        return alert(t("Please select a customer or use Guest Checkout", "කරුණාකර පාරිභෝගිකයෙකු තෝරන්න හෝ අමුත්තන්ගේ පරීක්ෂාව භාවිතා කරන්න"));
    }

    if (cartItems.some(i => i.qty <= 0)) {
        return alert(t("Please enter a valid quantity greater than 0 for all items.", "කරුණාකර සියලුම භාණ්ඩ සඳහා 0 ට වැඩි වලංගු ප්‍රමාණයක් ඇතුළත් කරන්න."));
    }

    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const finalCustomerName = isGuest 
        ? (guestName.trim() && guestName.trim() !== 'Guest Customer' ? guestName.trim() : 'Guest Customer')
        : (selectedCustomer?.name || 'Guest Customer');
      const finalCustomerPhone = isGuest ? guestPhone.trim() : (selectedCustomer?.phone || '');
      const finalCustomerAddress = isGuest ? guestAddress.trim() : (selectedCustomer?.address || '');

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
        due_date: paymentMethod === 'Credit' ? calculateDueDate(creditPeriodDays) : null,
        credit_period_days: paymentMethod === 'Credit' ? creditPeriodDays : 0,
        transportation_fee: Number(transportationFee) || 0
      };

      const { data: saleRecord, error: saleError } = await supabase.from('sales').insert([newOrderData]).select().single();
      if (saleError) throw saleError;

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
        id: saleRecord.id || `so_${Date.now()}`,
        invoiceNo: saleRecord.invoice_no || saleRecord.invoiceNo || newOrderData.invoice_no,
        customer_id: newOrderData.customer_id || '',
        customerName: finalCustomerName,
        customerPhone: finalCustomerPhone,
        customer_phone: finalCustomerPhone,
        customerAddress: finalCustomerAddress,
        customer_address: finalCustomerAddress,
        cashier: user?.email || 'system',
        date: new Date().toLocaleDateString(),
        items: cartItems,
        created_at: saleRecord.created_at,
        subtotal: subtotal,
        discount: discountAmt,
        tax: taxAmt,
        tax_rate: newOrderData.tax_rate,
        total: totalAmountValue,
        status: (paymentMethod === 'Credit' ? 'Non Paid' : 'paid') as any,
        due_date: newOrderData.due_date || undefined,
        credit_period_days: newOrderData.credit_period_days,
        payment_method: paymentMethod
      };
      setLastOrder(completedOrder);
      setShowReceipt(true);
      setCartItems([]);
      setSelectedCustomer(null);
      setIsGuest(false); 
      setGuestName('Guest Customer');
      setGuestPhone('');
      setGuestAddress('');
      setDiscount(0);
      setPaymentMethod('Cash');
      fetchData(); 
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
      setCartItems([]);
      setSelectedCustomer(null);
      setIsGuest(false);
      setGuestName('Guest Customer');
      setDiscount(0);
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
      
      const res = await fetch(`${API_URL}/sales/${orderId}/void`, {
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
      const res = await fetch(`${API_URL}/sales/returns/${returnId}/void`, {
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

  const normalizeStatus = (status?: string) => (status || '').toLowerCase();
  const filteredOrders = orders.filter((o) => {
    const search = historySearch.toLowerCase();
    const matchSearch = (o.invoiceNo || '').toLowerCase().includes(search) || 
                        (o.customerName || '').toLowerCase().includes(search);
    const matchStatus = statusFilter === 'all' || normalizeStatus(o.status) === statusFilter.toLowerCase();
    
    const sDate = o.created_at 
      ? new Date(o.created_at).toLocaleDateString('sv-SE') 
      : (o.date || '').split('T')[0];
    const matchDate = (!salesHistoryFromDate || sDate >= salesHistoryFromDate) && 
                      (!salesHistoryToDate || sDate <= salesHistoryToDate);

    return matchSearch && matchStatus && matchDate;
  });

  const isCreditOrder = (o: SaleOrder) => 
    o.payment_method === 'Credit' || 
    (o as any).is_credit === true || 
    (o.status === 'Non Paid' && o.payment_method !== 'Cash' && o.payment_method !== 'Card' && o.payment_method !== 'Bank Transfer');

  const creditOrders = orders.filter((o) => isCreditOrder(o));

  const filteredCreditOrders = orders.filter(o => {
    if (!isCreditOrder(o)) return false;
    
    const sDate = o.created_at 
      ? new Date(o.created_at).toLocaleDateString('sv-SE') 
      : (o.date || '').split('T')[0];
    const matchDate = (!creditHistoryFromDate || sDate >= creditHistoryFromDate) && 
                      (!creditHistoryToDate || sDate <= creditHistoryToDate);
    
    const query = creditSearchQuery.toLowerCase().trim();
    const matchSearch = !query || 
      (o.invoiceNo || '').toLowerCase().includes(query) || 
      (o.customerName || '').toLowerCase().includes(query) || 
      (o.items && o.items.some((it: any) => (it.productName || it.name || '').toLowerCase().includes(query)));
    
    return matchDate && matchSearch;
  });

  const creditSubFiltered = filteredCreditOrders.filter(o => {
    const isOverdue = o.status === 'Non Paid' && o.due_date && new Date(o.due_date) < new Date();
    if (creditSubView === 'unpaid') return o.status === 'Non Paid';
    if (creditSubView === 'overdue') return isOverdue;
    if (creditSubView === 'paid') return o.status === 'Paid';
    return true;
  });

  const unpaidCreditOrders = creditOrders.filter(o => o.status === 'Non Paid');
  const paidCreditOrders = creditOrders.filter(o => o.status === 'Paid');
  const totalOutstanding = unpaidCreditOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const overdueCreditOrders = unpaidCreditOrders.filter(o => o.due_date && new Date(o.due_date) < new Date());
  const totalOverdue = overdueCreditOrders.reduce((sum, o) => sum + (o.total || 0), 0);
  const totalCollected = paidCreditOrders.reduce((sum, o) => sum + (o.total || 0), 0);
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
            onClick={() => setTab('new')} 
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
                                {t('Stock', 'තොගය')}: {p.stock} {p.unit}
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
                        {cartItems.map((item) => {
                          const prod = products.find(p => p.id === item.productId);
                          const baseStock = prod?.stock || 0;
                          const conversionRate = item.conversionRate || 1;
                          const maxStockInUnit = Math.round((baseStock * conversionRate) * 100000) / 100000;
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
                                              
                                              const baseQty = item.qty / (item.conversionRate || 1);
                                              const newQty = Math.round((baseQty * newRate) * 100000) / 100000;
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
                                    onClick={() => updateQty(item.productId, Math.max(1, item.qty - 1))}
                                    className="w-7 h-7 bg-white hover:bg-slate-100 active:scale-95 text-slate-600 rounded-lg flex items-center justify-center font-black transition-all border border-slate-200 shadow-sm"
                                  >
                                    -
                                  </button>
                                  <input 
                                    type="number" 
                                    min={0.01} 
                                    step="any"
                                    max={maxStockInUnit} 
                                    value={item.qty === 0 ? '' : item.qty} 
                                    onChange={(e) => updateQty(item.productId, e.target.value === '' ? 0 : Math.min(maxStockInUnit, parseFloat(e.target.value) || 0))} 
                                    className="w-12 text-center bg-transparent border-0 font-bold text-slate-800 outline-none select-none text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateQty(item.productId, Math.min(maxStockInUnit, item.qty + 1))}
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
              </div>

              {/* Price Calculation Details Block */}
              <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-4.5 space-y-3.5 shadow-inner">
                <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest">
                  <span>{t('Subtotal', 'උප එකතුව')}</span>
                  <span className="text-slate-700 font-mono">{symbol} {convert(subtotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-xs font-black text-red-400 uppercase tracking-widest">
                  <span>{t('Savings', 'ඉතිරිකිරීම්')}</span>
                  <span className="text-red-500 font-mono">-{symbol} {convert(discountAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest">
                  <span>{t('Total Tax', 'මුළු බද්ද')} ({applyTax ? taxRate : 0}%)</span>
                  <span className="text-slate-700 font-mono">+{symbol} {convert(taxAmt).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                
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
                                {t('Stock', 'තොගය')}: {p.stock} {p.unit}
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
                                              
                                              const baseQty = item.qty / (item.conversionRate || 1);
                                              const newQty = Math.round((baseQty * newRate) * 100000) / 100000;
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
                                    onClick={() => updateCreditQty(itemIdx, Math.max(1, item.qty - 1))}
                                    className="w-7 h-7 bg-white hover:bg-slate-100 active:scale-95 text-slate-600 rounded-lg flex items-center justify-center font-black transition-all border border-slate-200 shadow-sm"
                                  >
                                    -
                                  </button>
                                  <input 
                                    type="number" 
                                    min={0.01} 
                                    step="any"
                                    max={maxStockInUnit} 
                                    value={item.qty === 0 ? '' : item.qty} 
                                    onChange={(e) => updateCreditQty(itemIdx, e.target.value === '' ? 0 : Math.min(maxStockInUnit, parseFloat(e.target.value) || 0))} 
                                    className="w-12 text-center bg-transparent border-0 font-bold text-slate-800 outline-none select-none text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                                  />
                                  <button
                                    type="button"
                                    onClick={() => updateCreditQty(itemIdx, Math.min(maxStockInUnit, item.qty + 1))}
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
                      <th className="px-4 py-4 text-right">{t('Sub Total', 'උප එකතුව')}</th>
                      <th className="px-4 py-4">{t('Due Date', 'ගෙවිය යුතු දිනය')}</th>
                      <th className="px-4 py-4 text-center">{t('Status', 'තත්ත්වය')}</th>
                      <th className="px-4 py-4 text-center">{t('Actions', 'ක්‍රියාකාරකම්')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {orders.filter(o => {
                        const isCredit = o.status === 'Non Paid' || o.status === 'Paid';
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
                        const isCredit = o.status === 'Non Paid' || o.status === 'Paid';
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
                            <td className="px-4 py-4 text-right font-black text-[#DAA520]">{symbol} {convert(order.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                            <td className="px-4 py-4 font-bold text-[#464646]">
                              <div>{order.due_date ? new Date(order.due_date).toLocaleDateString() : '—'}</div>
                              {isOverdue && (
                                <span className="inline-block mt-1 bg-red-100 text-red-700 text-[8px] px-1.5 py-0.5 rounded-md font-black uppercase tracking-wider">
                                  {t(`Overdue ${daysOverdue}d`, `පසුගිය දින ${daysOverdue}`)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-4 text-center">
                              <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                                order.status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                              }`}>
                                {order.status === 'Paid' || order.status === 'paid' ? t('Paid', 'ගෙවන ලද') : order.status === 'Non Paid' ? t('Non Paid', 'නොගෙවූ') : order.status}
                              </span>
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

      {/* Interactive Receipt Preview Modal */}
      <Modal isOpen={showReceipt} onClose={() => setShowReceipt(false)} title={t('Transaction Verified', 'ගනුදෙනුව තහවුරු කරන ලදී')} size="lg">
        {lastOrder && (
          <div className="space-y-4 p-4 text-center animate-in zoom-in duration-300">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-emerald-50 text-emerald-500 rounded-lg flex items-center justify-center border border-emerald-100 shadow-inner">
                  <CheckCircleIcon className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <h4 className="font-black text-sm text-[#464646]">{t('Success!', 'සාර්ථකයි!')}</h4>
                  <p className="text-[10px] text-gray-400 font-bold">{t('Invoice created successfully', 'ඉන්වොයිසිය සාර්ථකව සාදන ලදී')}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => handlePrintReceipt(lastOrder)} 
                  className="bg-[#DAA520] hover:bg-[#B8860B] text-white px-4 py-2 rounded-xl text-xs font-black shadow-md shadow-[#DAA520]/20 flex items-center gap-2 transition-all uppercase tracking-widest"
                >
                  <PrinterIcon className="w-4 h-4" /> {t('Print', 'මුද්‍රණය කරන්න')}
                </button>
                <button 
                  onClick={() => downloadReceiptPDF(lastOrder)} 
                  className="bg-[#464646] hover:bg-[#333333] text-white px-4 py-2 rounded-xl text-xs font-black shadow-md shadow-[#464646]/20 flex items-center gap-2 transition-all uppercase tracking-widest"
                >
                  <DownloadIcon className="w-4 h-4" /> PDF
                </button>
              </div>
            </div>

            {/* Premium Receipt Preview Rendering */}
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <ReceiptPreview order={lastOrder} isSinhala={isSinhala} />
            </div>

            <div className="pt-2">
              <button 
                onClick={() => setShowReceipt(false)} 
                className="w-full bg-gray-100 text-gray-500 py-3.5 rounded-xl font-black uppercase tracking-widest text-[10px] hover:bg-gray-200 transition-colors"
              >
                {t('Dismiss', 'ඉවත් කරන්න')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {showHoldNameModal && (
        <div className="fixed inset-0 bg-[#464646]/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleHoldBill(holdNameInput);
            }} 
            className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4 animate-in zoom-in-95"
          >
            <div className="flex justify-between items-center text-left">
              <h3 className="font-black text-lg text-[#464646] uppercase tracking-wider">{t('Hold Invoice (Park)', 'බිල්පත රඳවා තබන්න')}</h3>
              <button type="button" onClick={() => setShowHoldNameModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><XIcon className="w-5 h-5" /></button>
            </div>
            <div className="text-left">
              <label className="block text-[10px] font-black text-gray-400 uppercase mb-1.5 tracking-widest">{t('Enter Hold Name / Table #', 'රඳවා ගැනීමේ නම / අංකය')}</label>
              <input 
                type="text" 
                required 
                autoFocus 
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm font-bold text-[#464646] outline-none focus:ring-2 focus:ring-[#DAA520]" 
                value={holdNameInput} 
                onChange={e => setHoldNameInput(e.target.value)} 
                placeholder="e.g. Table 4, Nalaka's order" 
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowHoldNameModal(false)} className="flex-1 py-3 font-black text-gray-500 hover:bg-gray-100 rounded-xl uppercase tracking-widest text-[10px] transition-colors">{t('Cancel', 'අවලංගු කරන්න')}</button>
              <button type="submit" className="flex-[2] py-3 font-black bg-[#DAA520] hover:bg-[#B8860B] text-white rounded-xl shadow-lg shadow-[#DAA520]/20 uppercase tracking-widest text-[10px] transition-all">{t('Park Bill', 'බිල රඳවන්න')}</button>
            </div>
          </form>
        </div>
      )}

      {showHeldBillsModal && (
        <div className="fixed inset-0 bg-[#464646]/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-6 space-y-4 animate-in zoom-in-95 text-left">
            <div className="flex justify-between items-center">
              <h3 className="font-black text-lg text-[#464646] uppercase tracking-wider">{t('Parked Invoices', 'රඳවා ඇති බිල්පත්')}</h3>
              <button type="button" onClick={() => setShowHeldBillsModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><XIcon className="w-5 h-5" /></button>
            </div>
            
            <div className="max-h-80 overflow-y-auto divide-y divide-gray-100 pr-1">
              {heldBills.length === 0 ? (
                <div className="py-12 text-center text-gray-400 font-bold text-sm">
                  {t('No bills currently parked.', 'රඳවා තැබූ බිල්පත් කිසිවක් නැත.')}
                </div>
              ) : (
                heldBills.map(hold => (
                  <div key={hold.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0 hover:bg-gray-50/50 transition-all rounded-lg px-2">
                    <div>
                      <h4 className="font-black text-slate-800 text-sm font-mono">{hold.hold_name}</h4>
                      <p className="text-[10px] text-gray-400 font-bold mt-1">
                        {hold.customer_name} • {JSON.parse(hold.items || '[]').length} items • {new Date(hold.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-black text-[#DAA520]">{symbol} {convert(hold.total_amount).toLocaleString()}</span>
                      <button 
                        onClick={() => handleRetrieveHoldBill(hold)}
                        className="px-4 py-2 bg-[#DAA520] hover:bg-[#B8860B] text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all shadow-sm"
                      >
                        {t('Load', 'ලෝඩ්')}
                      </button>
                    </div>
                  </div>
                ))
              )}
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
                setIsCreatingQuote(!isCreatingQuote);
                setQuoteCart([]);
                setQuoteCustomerName('');
              }}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-amber-400 border border-slate-800 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-slate-900/10 flex items-center gap-2"
            >
              <PlusIcon className="w-4 h-4 text-amber-400" />
              {isCreatingQuote ? t('View Quotations', 'මිල ගණන් බලාගන්න') : t('Create Quotation', 'නව මිල ගණන් පත්‍රයක්')}
            </button>
          </div>

          {isCreatingQuote ? (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {/* Product Selector Left Column */}
              <div className="xl:col-span-1 space-y-4">
                <div className="bg-white rounded-2xl border-l-4 border-l-amber-500 border-y border-r border-slate-100 shadow-xl shadow-slate-100/40 p-6 space-y-4 hover:shadow-2xl hover:shadow-slate-200/40 transition-all duration-300 transform hover:-translate-y-0.5">
                  <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-2 border-b border-slate-100 pb-3">
                    <SearchIcon className="w-4 h-4 text-amber-500" />
                    {t('Select Items', 'භාණ්ඩ තෝරන්න')}
                  </h4>

                  {/* Customer Name input */}
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">{t('Customer Name', 'පාරිභෝගිකයාගේ නම')}</label>
                    <input
                      type="text"
                      className="w-full px-4 py-3.5 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm"
                      placeholder={t('Enter customer name...', 'පාරිභෝගිකයාගේ නම ඇතුළත් කරන්න...')}
                      value={quoteCustomerName}
                      onChange={(e) => setQuoteCustomerName(e.target.value)}
                    />
                  </div>

                  {/* Product Search */}
                  <div>
                    <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">{t('Search Products', 'භාණ්ඩ සොයන්න')}</label>
                    <input
                      type="text"
                      className="w-full px-4 py-3.5 bg-slate-50/50 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all shadow-sm"
                      placeholder={t('Search by Name or SKU...', 'නම හෝ SKU මඟින් සොයන්න...')}
                      value={quoteSearch}
                      onChange={(e) => setQuoteSearch(e.target.value)}
                    />
                  </div>

                  {/* Search results */}
                  <div className="max-h-60 overflow-y-auto divide-y divide-slate-100/60 pr-1">
                    {products
                      .filter(p => p.name.toLowerCase().includes(quoteSearch.toLowerCase()) || p.sku.toLowerCase().includes(quoteSearch.toLowerCase()))
                      .slice(0, 5)
                      .map(p => (
                        <div
                          key={p.id}
                          onClick={() => {
                            setQuoteCart(prev => {
                              const existing = prev.find(i => i.productId === p.id);
                              if (existing) {
                                  return prev.map(i => i.productId === p.id ? { ...i, qty: i.qty + 1, total: (i.qty + 1) * i.price } : i);
                              } else {
                                  return [...prev, {
                                    productId: p.id,
                                    productName: p.name,
                                    qty: 1,
                                    price: p.price,
                                    total: p.price,
                                    taxRate: 0,
                                    serialNo: p.serialNo,
                                    batchCode: p.batchCode
                                  }];
                              }
                            });
                          }}
                          className="py-3 cursor-pointer hover:bg-slate-50 flex justify-between items-center px-3.5 transition-all rounded-xl"
                        >
                          <div className="space-y-0.5">
                            <div className="text-sm font-black text-slate-800">{p.name}</div>
                            <div className="text-[9px] text-slate-400 font-mono">SKU: {p.sku || 'N/A'} • {symbol} {p.price.toLocaleString()}</div>
                          </div>
                          <div className="p-1 bg-amber-50 hover:bg-amber-100 rounded-lg text-amber-500 border border-amber-200/40 shadow-sm transition-colors">
                            <PlusIcon className="w-4 h-4 text-amber-500" />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* Quotation Cart Right Column */}
              <div className="xl:col-span-2 space-y-4">
                <div className="bg-white rounded-2xl border-l-4 border-l-amber-500 border-y border-r border-slate-100 shadow-xl shadow-slate-100/40 p-6 flex flex-col min-h-[400px] hover:shadow-2xl hover:shadow-slate-200/40 transition-all duration-300 transform hover:-translate-y-0.5">
                  <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-3 mb-4">
                    {t('Quotation Items', 'මිල ගණන් අයිතම ලැයිස්තුව')}
                  </h4>

                  <div className="flex-1 overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-[9px] font-black text-slate-400 tracking-widest uppercase">
                          <th className="px-4 py-3">{t('Item', 'භාණ්ඩය')}</th>
                          <th className="px-4 py-3 text-center">{t('Qty', 'ප්‍රමාණය')}</th>
                          <th className="px-4 py-3 text-right">{t('Price', 'මිල')}</th>
                          <th className="px-4 py-3 text-right">{t('Total', 'එකතුව')}</th>
                          <th className="px-4 py-3 text-center"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {quoteCart.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-12 text-center text-slate-400 font-bold text-sm">
                              {t('No items in quotation.', 'මිල ගණන් පත්‍රයේ කිසිදු භාණ්ඩයක් නොමැත.')}
                            </td>
                          </tr>
                        ) : (
                          quoteCart.map((item, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/30 transition-colors">
                              <td className="px-4 py-3.5 font-bold text-slate-800">
                                <div className="font-black text-sm">{item.productName}</div>
                                {(item.serialNo || item.batchCode) && (
                                  <div className="text-[9px] font-mono text-slate-400 mt-1">
                                    {item.serialNo && `S/N: ${item.serialNo}`} {item.batchCode && `Batch: ${item.batchCode}`}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3.5 text-center">
                                <input
                                  type="number"
                                  min={1}
                                  value={item.qty}
                                  onChange={(e) => {
                                    const val = Math.max(1, parseInt(e.target.value) || 1);
                                    setQuoteCart(prev => prev.map((itm, i) => i === idx ? { ...itm, qty: val, total: val * itm.price } : itm));
                                  }}
                                  className="w-16 text-center border border-slate-200 rounded-xl px-2 py-1 text-xs font-bold text-slate-800 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
                                />
                              </td>
                              <td className="px-4 py-3.5 text-right font-bold text-slate-500 text-xs">
                                {symbol} {item.price.toLocaleString()}
                              </td>
                              <td className="px-4 py-3.5 text-right font-black text-slate-800 text-sm">
                                {symbol} {item.total.toLocaleString()}
                              </td>
                              <td className="px-4 py-3.5 text-center">
                                <button
                                  onClick={() => setQuoteCart(prev => prev.filter((_, i) => i !== idx))}
                                  className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all duration-200"
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

                  <div className="border-t border-slate-100 pt-4 mt-4 flex justify-between items-center bg-slate-50/50 p-4 rounded-2xl border border-slate-200/20">
                    <div>
                      <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block mb-0.5 ml-1">{t('Total Estimate', 'ඇස්තමේන්තු එකතුව')}</span>
                      <span className="text-xl font-black text-amber-500 font-mono">
                        {symbol} {quoteCart.reduce((sum, itm) => sum + itm.total, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        if (!quoteCustomerName.trim()) {
                          alert(t('Please enter customer name', 'කරුණාකර පාරිභෝගිකයාගේ නම ඇතුළත් කරන්න'));
                          return;
                        }
                        if (quoteCart.length === 0) {
                          alert(t('Please add items to quotation', 'කරුණාකර මිල ගණන් පත්‍රයට අයිතම එක් කරන්න'));
                          return;
                        }

                        const totalAmount = quoteCart.reduce((sum, item) => sum + item.total, 0);
                        const quoteNo = `QT-${Date.now().toString().slice(-6)}`;
                        const newQuote = {
                          quote_no: quoteNo,
                          customer_name: quoteCustomerName,
                          items: JSON.stringify(quoteCart),
                          total: totalAmount,
                        };

                        try {
                          setIsLoading(true);
                          const { data, error } = await supabase.from('quotations').insert([newQuote]);
                          if (error) throw error;
                          
                          // Print Quote natively using a hidden iframe
                          const htmlContent = generateQuotePrintHTML({ ...newQuote, created_at: new Date().toISOString() }, isSinhala, shopSettings);
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

                          // Reset
                          setQuoteCustomerName('');
                          setQuoteCart([]);
                          setIsCreatingQuote(false);
                          fetchData();
                        } catch (err: any) {
                          alert(t('Failed to save quotation: ', 'මිල ගණන් පත්‍රය සුරැකීමට අපොහොසත් විය: ') + err.message);
                        } finally {
                          setIsLoading(false);
                        }
                      }}
                      className="px-6 py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:brightness-110 active:scale-[0.99] text-slate-950 font-black rounded-xl uppercase tracking-widest text-[10px] transition-all shadow-md shadow-amber-500/10 border border-amber-400/20"
                    >
                      {t('Save & Print Quote', 'සුරකින්න සහ මුද්‍රණය කරන්න')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Quotations History View */
            <div className="bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-100/40 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 tracking-widest uppercase">
                      <th className="px-6 py-4.5">{t('Date', 'දිනය')}</th>
                      <th className="px-6 py-4.5">{t('Quotation No', 'මිල ගණන් අංකය')}</th>
                      <th className="px-6 py-4.5">{t('Customer', 'පාරිභෝගිකයා')}</th>
                      <th className="px-6 py-4.5 text-right">{t('Total', 'මුළු එකතුව')}</th>
                      <th className="px-6 py-4.5 text-center">{t('Actions', 'ක්‍රියාකාරකම්')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {quotes.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-slate-400 font-bold text-sm">
                          {t('No quotations found.', 'මිල ගණන් කැඳවීම් කිසිවක් හමු නොවීය.')}
                        </td>
                      </tr>
                    ) : (
                      quotes.map((quote) => (
                        <tr key={quote.id} className="hover:bg-slate-50/30 transition-all duration-200">
                          <td className="px-6 py-4 font-bold text-slate-500 text-xs">
                            {new Date(quote.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 font-black text-slate-800 font-mono text-sm">
                            {quote.quote_no}
                          </td>
                          <td className="px-6 py-4 font-black text-slate-800 text-sm">
                            {quote.customer_name}
                          </td>
                          <td className="px-6 py-4 text-right font-black text-amber-500 font-mono text-sm">
                            {symbol} {quote.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-6 py-4 text-center flex items-center justify-center gap-2">
                            <button
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
                                    document.body.removeChild(iframe);
                                  }, 1000);
                                }, 300);
                              }}
                              className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl border border-slate-200/50 shadow-sm transition-colors"
                              title={t('Print Quote', 'මිල ගණන් පත්‍රය මුද්‍රණය')}
                            >
                              <PrinterIcon className="w-4 h-4 text-amber-500" />
                            </button>
                            <button
                              onClick={async () => {
                                if (window.confirm(t('Are you sure you want to delete this quotation?', 'මෙම මිල ගණන් පත්‍රය මැකීමට ඔබට විශ්වාසද?'))) {
                                  try {
                                    setIsLoading(true);
                                    const { error } = await supabase.from('quotations').delete().eq('id', quote.id);
                                    if (error) throw error;
                                    fetchData();
                                  } catch (err: any) {
                                    alert(t('Failed to delete quotation: ', 'මිල ගණන් පත්‍රය මැකීමට අපොහොසත් විය: ') + err.message);
                                  } finally {
                                    setIsLoading(false);
                                  }
                                }
                              }}
                              className="p-2 bg-red-50 hover:bg-red-100 text-red-500 rounded-xl border border-red-200/50 shadow-sm transition-colors"
                              title={t('Delete Quote', 'මිල ගණන් පත්‍රය මකන්න')}
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
          )}
        </div>
      )}



      {/* Sales Return Tab View */}
      {tab === 'returns' && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-100/40 p-6">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-6">
              <span className="w-1.5 h-4 bg-amber-500 rounded-full"></span>
              {t('Process Sales Return', 'විකුණුම් ආපසු භාරගැනීම')}
            </h3>

            {/* Search Invoice */}
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-2xl p-2 mb-6">
              <SearchIcon className="w-5 h-5 text-slate-400 ml-2" />
              <input
                type="text"
                placeholder={t('Enter Bill / Invoice Number or Customer Name...', 'ඉන්වොයිස් අංකය හෝ පාරිභෝගික නම ඇතුළත් කරන්න...')}
                value={returnSearchQuery}
                onChange={(e) => setReturnSearchQuery(e.target.value)}
                className="bg-transparent text-sm font-bold text-slate-800 outline-none w-full placeholder-slate-400 py-1"
              />
              <button
                type="button"
                onClick={() => {
                  const q = returnSearchQuery.trim().toLowerCase();
                  if (!q) return alert(t('Please enter an invoice number or customer name.', 'කරුණාකර ඉන්වොයිස් අංකයක් හෝ නමක් ඇතුළත් කරන්න.'));
                  const found = orders.find(o => 
                    o.invoiceNo.toLowerCase().includes(q) || 
                    (o.customerName && o.customerName.toLowerCase().includes(q))
                  );
                  if (!found) return alert(t('Invoice not found!', 'ඉන්වොයිසිය හමු නොවීය!'));
                  setTargetReturnInvoice(found);
                  const initialQtys: Record<string, number> = {};
                  (found.items || []).forEach((item: any) => { initialQtys[item.productId] = 0; });
                  setReturnQtys(initialQtys);
                }}
                className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-amber-400 font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-md"
              >
                {t('Search Invoice', 'සොයන්න')}
              </button>
            </div>

            {/* Selected Invoice Return Details */}
            {targetReturnInvoice && (
              <div className="bg-slate-50/60 rounded-2xl border border-slate-200/80 p-5 space-y-5 animate-in slide-in-from-top-3 duration-300">
                <div className="flex justify-between items-center flex-wrap gap-2 border-b border-slate-200/60 pb-3">
                  <div>
                    <h4 className="text-base font-black text-slate-800">
                      {t('Invoice:', 'ඉන්වොයිසිය:')} <span className="font-mono text-amber-600">{targetReturnInvoice.invoiceNo}</span>
                    </h4>
                    <p className="text-xs font-bold text-slate-500">
                      {t('Customer:', 'පාරිභෝගිකයා:')} {targetReturnInvoice.customerName} | {t('Date:', 'දිනය:')} {targetReturnInvoice.date}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTargetReturnInvoice(null)}
                    className="text-xs font-bold text-slate-400 hover:text-slate-600 underline"
                  >
                    {t('Clear / Change Invoice', 'වෙනත් ඉන්වොයිසියක්')}
                  </button>
                </div>

                {/* Items to Return Table */}
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-sm text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-100/80 border-b border-slate-200 text-[10px] font-black text-slate-500 tracking-widest uppercase">
                        <th className="px-4 py-3">{t('Item', 'භාණ්ඩය')}</th>
                        <th className="px-4 py-3 text-center">{t('Purchased Qty', 'මිලදී ගත් ප්‍රමාණය')}</th>
                        <th className="px-4 py-3 text-right">{t('Unit Price', 'ඒකක මිල')}</th>
                        <th className="px-4 py-3 text-center w-36">{t('Return Qty', 'ආපසු ප්‍රමාණය')}</th>
                        <th className="px-4 py-3 text-right">{t('Refund Amount', 'ආපසු මුදල')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {targetReturnInvoice.items.map((item: any) => {
                        const maxReturn = item.qty;
                        const currReturn = returnQtys[item.productId] || 0;
                        const itemRefund = currReturn * item.price;
                        return (
                          <tr key={item.productId} className="hover:bg-slate-50/50">
                            <td className="px-4 py-3 font-black text-slate-800 text-xs">{item.productName}</td>
                            <td className="px-4 py-3 text-center font-bold text-slate-600 text-xs">{item.qty} {item.unit || ''}</td>
                            <td className="px-4 py-3 text-right font-bold text-slate-600 text-xs">{symbol} {convert(item.price).toLocaleString()}</td>
                            <td className="px-4 py-3 text-center">
                              <input
                                type="number"
                                min={0}
                                max={maxReturn}
                                value={currReturn || ''}
                                onChange={(e) => {
                                  const val = Math.min(maxReturn, Math.max(0, parseFloat(e.target.value) || 0));
                                  setReturnQtys(prev => ({ ...prev, [item.productId]: val }));
                                }}
                                className="w-20 px-2 py-1 text-center bg-white border border-slate-300 rounded-lg font-bold text-slate-800 text-xs outline-none focus:border-amber-500"
                              />
                            </td>
                            <td className="px-4 py-3 text-right font-black text-emerald-600 text-xs">{symbol} {convert(itemRefund).toLocaleString()}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Return Settings & Submit */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
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
                      placeholder={t('Damaged, Wrong item, etc.', 'හානි වී ඇත, වෙනත්...')}
                      value={returnReason}
                      onChange={(e) => setReturnReason(e.target.value)}
                      className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 text-xs outline-none focus:border-amber-500"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={async () => {
                        const itemsToReturn = targetReturnInvoice.items
                          .filter((item: any) => (returnQtys[item.productId] || 0) > 0)
                          .map((item: any) => ({
                            ...item,
                            qty: returnQtys[item.productId]
                          }));

                        if (itemsToReturn.length === 0) {
                          return alert(t('Please select at least 1 item quantity to return.', 'කරුණාකර ආපසු බාරදීමට අවම වශයෙන් එක් භාණ්ඩයකවත් ප්‍රමාණයක් ඇතුළත් කරන්න.'));
                        }

                        const totalRefunded = itemsToReturn.reduce((sum: number, i: any) => sum + (i.qty * i.price), 0);

                        try {
                          setIsLoading(true);
                          const { data: { user } } = await supabase.auth.getUser();
                          const res = await fetch(`${API_URL}/sales/returns`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              invoiceNo: targetReturnInvoice.invoiceNo,
                              returnedItems: itemsToReturn,
                              returnMethod,
                              totalRefunded,
                              userEmail: user?.email || 'system',
                              reason: returnReason
                            })
                          });

                          const result = await res.json();
                          if (!res.ok) throw new Error(result.error || 'Failed to process sales return');

                          alert(t('Sales Return processed successfully!', 'විකුණුම් ආපසු භාරගැනීම සාර්ථකයි!'));
                          setTargetReturnInvoice(null);
                          setReturnQtys({});
                          setReturnReason('');
                          fetchSalesReturns();
                          fetchData();
                        } catch (err: any) {
                          alert(t('Failed to process return: ', 'ආපසු භාරගැනීම අසමත් විය: ') + err.message);
                        } finally {
                          setIsLoading(false);
                        }
                      }}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2"
                    >
                      <CheckCircleIcon className="w-4 h-4" />
                      {t('Confirm & Process Return', 'ආපසු භාරගැනීම තහවුරු කරන්න')}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sales Return History */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-xl shadow-slate-100/40 p-6">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2 mb-6">
              <span className="w-1.5 h-4 bg-amber-500 rounded-full"></span>
              {t('Sales Return History', 'ආපසු භාරගැනීම් ඉතිහාසය')}
            </h3>

            <div className="overflow-x-auto rounded-2xl border border-slate-100">
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 tracking-widest uppercase">
                    <th className="px-6 py-4">{t('Date', 'දිනය')}</th>
                    <th className="px-6 py-4">{t('Invoice No', 'ඉන්වොයිස් අංකය')}</th>
                    <th className="px-6 py-4">{t('Return Method', 'ක්‍රමය')}</th>
                    <th className="px-6 py-4 text-right">{t('Total Refunded', 'මුළු ආපසු මුදල')}</th>
                    <th className="px-6 py-4 text-center">{t('Status', 'තත්ත්වය')}</th>
                    <th className="px-6 py-4 text-center">{t('Actions', 'ක්‍රියාකාරකම්')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {salesReturnsList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 font-bold text-sm">
                        {t('No sales returns recorded yet.', 'තවමත් ආපසු භාරගැනීම් කිසිවක් නොමැත.')}
                      </td>
                    </tr>
                  ) : (
                    salesReturnsList.map((sr) => (
                      <tr key={sr.id} className="hover:bg-slate-50/50">
                        <td className="px-6 py-4 font-bold text-slate-500 text-xs">
                          {new Date(sr.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 font-black text-slate-800 font-mono text-sm">
                          {sr.invoiceNo || sr.invoice_no}
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-600 text-xs">
                          {sr.returnMethod}
                        </td>
                        <td className="px-6 py-4 text-right font-black text-emerald-600 text-sm">
                          {symbol} {convert(sr.totalRefunded).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full ${sr.status === 'voided' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>
                            {sr.status === 'voided' ? 'VOIDED' : 'ACTIVE'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center flex items-center justify-center gap-2">
                          {sr.status !== 'voided' && (
                            <button
                              type="button"
                              onClick={() => {
                                setTargetVoidReturnId(sr.id);
                                setTargetVoidInvoiceId(null);
                                setVoidPasskeyInput('');
                                setShowVoidModal(true);
                              }}
                              className="px-3 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg text-xs font-bold transition-colors"
                            >
                              {t('Void Return', 'අවලංගු කරන්න')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
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

    </div>
  );
}

export default Sales;