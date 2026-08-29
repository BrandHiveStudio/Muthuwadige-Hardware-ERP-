/**
 * Print Template Generators for Hardware ERP Sales Module
 * Extracted from Sales.tsx to reduce component size
 * 
 * These functions generate HTML content for printing various sale documents:
 * - Quotations
 * - Delivery Notes
 * - Invoices
 * - Sales Returns
 * - Credit Notes
 */

import type { SaleOrder, SalesReturn, CreditNote } from '../../types';
import { calculateSaleAccounting, calculateLineGrossTotal, calculateEffectiveUnitPricePaid, calculateTotalRefund } from '../accounting';

/**
 * Utility helper for safe JSON parsing
 */
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

/**
 * Helper to retrieve active system branding & shop settings dynamically
 */
export const getSystemBranding = (shopSettings?: any) => {
  let settings = shopSettings;
  if (!settings || (typeof settings === 'object' && Object.keys(settings).length === 0)) {
    try {
      const stored = localStorage.getItem('system_settings') || localStorage.getItem('hardware_erp_settings') || localStorage.getItem('erp_settings');
      settings = stored ? JSON.parse(stored) : {};
    } catch {
      settings = {};
    }
  }
  return {
    shopName: settings?.shop_name || settings?.storeName || settings?.shopName || 'MUTHUWADIGE HARDWARE',
    address: settings?.address || 'No: 80, Mahahunupitiya, Negombo',
    phone: settings?.phone || settings?.telephone || '077 076 076 7',
    email: settings?.email || 'sanojhardware@gmail.com',
    footer: settings?.invoice_footer || settings?.receiptFooter || settings?.footer_text || 'Thank you for your business! Come again.',
    logoPath: settings?.logoUrl || settings?.logo_path || settings?.logoPath || './images/logo.png',
    currency: settings?.currency || settings?.currency_symbol || 'Rs.',
    currencySymbol: settings?.currency || settings?.currency_symbol || 'Rs.',
    printerSettings: settings?.printer_settings 
      ? (typeof settings.printer_settings === 'object' 
          ? settings.printer_settings 
          : (() => { try { return JSON.parse(settings.printer_settings); } catch(e) { return {}; } })())
      : {}
  };
};

const generateQuotePrintHTML = (quote: any, isSi: boolean, shopSettings?: any) => {
  const branding = getSystemBranding(shopSettings);
  const printerConfig = branding.printerSettings;
  const paperSize = printerConfig?.paperSize || '80mm';

  const rawValidity = quote.validityDays || quote.validity_period || quote.validity || 30;
  const validityMatch = String(rawValidity).match(/\d+/);
  const validityDays = validityMatch ? validityMatch[0] : (typeof rawValidity === 'number' ? rawValidity : 30);

  if (paperSize === '80mm') {
    const symbolStr = isSi ? 'රු.' : 'Rs.';
    const formatNum = (num: number) => num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const title = isSi ? 'මිල ගණන් පත්‍රය' : 'QUOTATION';
    
    const items = typeof quote.items === 'string' ? JSON.parse(quote.items) : (quote.items || []);
    const productDiscounts = items.reduce((sum: number, i: any) => {
      const gross = (i.qty || 0) * (i.price || 0);
      const discVal = Number(i.discount || 0);
      const discType = i.discountType || 'amount';
      const discAmt = (discType === 'percent' || discType === 'percentage') ? (gross * discVal / 100) : discVal;
      return sum + discAmt;
    }, 0);
    const grossSubtotal = items.reduce((sum: number, i: any) => sum + ((i.qty || 0) * (i.price || 0)), 0);

    const itemsRows = items.map((i: any) => {
      let trackingInfo = '';
      if (i.serialNo || i.batchCode) {
        const parts: string[] = [];
        if (i.serialNo) parts.push(`S/N: ${i.serialNo}`);
        if (i.batchCode) parts.push(`Batch: ${i.batchCode}`);
        trackingInfo = `<div style="font-size: 10px; font-weight: normal; color: #6b7280; margin-top: 1px;">${parts.join(' | ')}</div>`;
      }
      const gross = (i.qty || 0) * (i.price || 0);
      const discVal = Number(i.discount || 0);
      const discType = i.discountType || 'amount';
      const discAmt = (discType === 'percent' || discType === 'percentage') ? (gross * discVal / 100) : discVal;
      const lineTotal = i.total !== undefined ? i.total : Math.max(0, gross - discAmt);
      const discInfo = discAmt > 0 ? `<div style="font-size: 10px; font-weight: normal; color: #16a34a; margin-top: 1px;">Disc: -${discType === 'percent' || discType === 'percentage' ? discVal + '%' : symbolStr + ' ' + formatNum(discVal)} (-${symbolStr} ${formatNum(discAmt)})</div>` : '';

      return `
        <tr style="border-bottom: 1px dashed #e5e7eb;">
          <td colspan="2" style="padding: 5px 0 2px 0; font-weight: bold; text-align: left; color: #1f2937; font-size: 13px;">
            ${i.productName}
            ${trackingInfo}
            ${discInfo}
          </td>
        </tr>
        <tr style="border-bottom: 1px dashed #e5e7eb;">
          <td style="padding: 2px 0 6px 0; text-align: left; color: #374151; font-size: 12px;">
            ${i.qty} x ${symbolStr} ${formatNum(i.price)}
          </td>
          <td style="padding: 2px 0 6px 0; text-align: right; color: #1f2937; font-weight: bold; font-size: 13px;">
            ${symbolStr} ${formatNum(lineTotal)}
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
            @page {
              margin: 0;
              size: 80mm auto;
            }
            html, body {
              font-family: 'Inter', 'Noto Sans Sinhala', sans-serif;
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff;
              color: #1f2937;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .receipt-container {
              max-width: 80mm;
              width: 100%;
              margin: 0 auto;
              padding: 0 4mm;
              box-sizing: border-box;
            }
            .header {
              text-align: center;
              border-bottom: 2px dashed #4b5563;
              padding-bottom: 8px;
              margin-bottom: 8px;
            }
            .shop-logo-img {
              width: 2in;
              height: 2in;
              object-fit: contain;
              display: block;
              margin: 0 auto 6px auto;
              image-rendering: -webkit-optimize-contrast;
            }
            .shop-address {
              font-size: 14px;
              font-weight: 800;
              color: #111827;
              margin: 2px 0;
              text-align: center;
              line-height: 1.3;
            }
            .shop-phone {
              font-size: 14px;
              font-weight: 800;
              color: #111827;
              margin: 2px 0 4px 0;
              text-align: center;
              line-height: 1.3;
            }
            .title-badge {
              text-align: center;
              font-size: 13px;
              font-weight: 800;
              text-transform: uppercase;
              margin: 8px 0;
              letter-spacing: 1px;
              border: 1px solid #1f2937;
              padding: 4px;
              background: #f9fafb;
            }
            .meta-table {
              width: 100%;
              font-size: 12px;
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
              font-size: 13px;
            }
            .items-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 10px;
            }
            .items-table th {
              border-bottom: 1.5px solid #1f2937;
              padding: 5px 0;
              font-size: 13px;
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
              padding: 4px 0;
              font-size: 13px;
              color: #4b5563;
            }
            .summary-table td.value {
              text-align: right;
              font-weight: 700;
              color: #1f2937;
            }
            .summary-table tr.total-row td {
              font-size: 16px;
              font-weight: 800;
              color: #111827;
              border-top: 1px dashed #4b5563;
              padding-top: 6px;
            }
            .seal-divider {
              border-bottom: 2px dashed #4b5563;
              margin-top: 6px;
            }
            .seal-space {
              height: 4cm;
              min-height: 4cm;
            }
            .footer {
              text-align: center;
              margin-top: 5px;
              border-top: 1px dashed #4b5563;
              padding-top: 8px;
              font-size: 12px;
              color: #4b5563;
            }
            .footer p {
              margin: 2px 0;
            }
            @media print {
              @page {
                margin: 0;
              }
              html, body {
                padding: 0 !important;
                margin: 0 !important;
              }
              .receipt-container {
                width: 100%;
                max-width: 100%;
                padding: 0 4mm !important;
                box-sizing: border-box;
              }
            }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <div class="header">
              <img class="shop-logo-img" src="${branding.logoPath}" alt="Shop Logo" onerror="this.style.display='none';" />
              <div style="font-size: 16px; font-weight: 800; text-align: center; text-transform: uppercase; color: #111827; margin-bottom: 2px;">${branding.shopName}</div>
              <div class="shop-address">${branding.address}</div>
              <div class="shop-phone">Tel: ${branding.phone}</div>
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
                <td class="value">${quote.customer_name || quote.customerName || (isSi ? 'පාරිභෝගිකයා' : 'Guest Customer')}</td>
              </tr>
              ${(quote.customer_phone || quote.customerPhone || quote.phone) ? `
              <tr>
                <td>${isSi ? 'දුරකථන අංකය:' : 'Tel:'}</td>
                <td class="value">${quote.customer_phone || quote.customerPhone || quote.phone}</td>
              </tr>
              ` : ''}
              ${(quote.customer_address || quote.customerAddress || quote.address) ? `
              <tr>
                <td>${isSi ? 'ලිපිනය:' : 'Address:'}</td>
                <td class="value">${quote.customer_address || quote.customerAddress || quote.address}</td>
              </tr>
              ` : ''}
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
              ${grossSubtotal !== quote.total ? `
              <tr>
                <td>${isSi ? 'උප එකතුව:' : 'Subtotal:'}</td>
                <td class="value">${symbolStr} ${formatNum(grossSubtotal)}</td>
              </tr>
              ` : ''}
              ${productDiscounts > 0 ? `
              <tr style="color: #16a34a;">
                <td>${isSi ? 'භාණ්ඩ වට්ටම්:' : 'Product Savings:'}</td>
                <td class="value" style="color: #16a34a;">-${symbolStr} ${formatNum(productDiscounts)}</td>
              </tr>
              ` : ''}
              ${quote.discount_amount && quote.discount_amount > 0 ? `
              <tr style="color: #dc2626;">
                <td>${isSi ? 'අමතර වට්ටම්:' : 'Additional Discount:'}</td>
                <td class="value" style="color: #dc2626;">-${symbolStr} ${formatNum(quote.discount_amount)}</td>
              </tr>
              ` : ''}
              ${(productDiscounts + (quote.discount_amount || 0)) > 0 ? `
              <tr style="font-weight: bold; color: #16a34a;">
                <td>${isSi ? 'මුළු ඉතිරිය / වට්ටම:' : 'Total Savings / Discount:'}</td>
                <td class="value" style="color: #16a34a;">-${symbolStr} ${formatNum(productDiscounts + (quote.discount_amount || 0))}</td>
              </tr>
              ` : ''}
              ${quote.transportation_fee && quote.transportation_fee > 0 ? `
              <tr>
                <td>${isSi ? 'ප්‍රවාහන ගාස්තු:' : 'Transportation:'}</td>
                <td class="value">+${symbolStr} ${formatNum(quote.transportation_fee)}</td>
              </tr>
              ` : ''}
              <tr class="total-row">
                <td>${isSi ? 'මුළු එකතුව:' : 'Total Amount:'}</td>
                <td class="value">${symbolStr} ${formatNum(quote.total)}</td>
              </tr>
            </table>
            
            <div class="seal-divider"></div>
            <div class="seal-space"></div>
            
            <div class="footer">
              <p>${isSi ? `මෙම මිල ගණන් දින ${validityDays}ක් සඳහා වලංගු වේ.` : `This quotation is valid for ${validityDays} days.`}</p>
              <p style="font-weight: bold; margin-top: 5px;">${isSi ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි!' : 'Thank you for your business!'}</p>
            </div>
          </div>
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
  const noteLine1 = isSi ? `මෙම මිල ගණන් දින ${validityDays}ක් සඳහා වලංගු වේ.` : `This quotation is valid for ${validityDays} days.`;
  const noteLine2 = isSi ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි!' : 'Thank you for your business!';
  const signeeLabel = isSi ? 'බලයලත් අත්සන' : 'Authorized Signee';

  const items = typeof quote.items === 'string' ? JSON.parse(quote.items) : (quote.items || []);
  const productDiscounts = items.reduce((sum: number, i: any) => {
    const gross = (i.qty || 0) * (i.price || 0);
    const discVal = Number(i.discount || 0);
    const discType = i.discountType || 'amount';
    const discAmt = (discType === 'percent' || discType === 'percentage') ? (gross * discVal / 100) : discVal;
    return sum + discAmt;
  }, 0);
  const grossSubtotal = items.reduce((sum: number, i: any) => sum + ((i.qty || 0) * (i.price || 0)), 0);

  const discColLabel = isSi ? 'වට්ටම' : 'Discount';
  const itemsRows = items.map((i: any) => {
    let trackingInfo = '';
    if (i.serialNo || i.batchCode) {
      const parts: string[] = [];
      if (i.serialNo) parts.push(`S/N: ${i.serialNo}`);
      if (i.batchCode) parts.push(`Batch: ${i.batchCode}`);
      trackingInfo = `<div style="font-size: 9px; font-weight: normal; color: #9ca3af; margin-top: 2px;">${parts.join(' | ')}</div>`;
    }
    const gross = (i.qty || 0) * (i.price || 0);
    const discVal = Number(i.discount || 0);
    const discType = i.discountType || 'amount';
    const discAmt = (discType === 'percent' || discType === 'percentage') ? (gross * discVal / 100) : discVal;
    const lineTotal = i.total !== undefined ? i.total : Math.max(0, gross - discAmt);
    const discStr = discAmt > 0 ? (discType === 'percent' || discType === 'percentage' ? `-${discVal}%` : `-${symbolStr} ${formatNum(discVal)}`) : '-';

    return `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px 15px; font-weight: 700; text-align: left; color: #464646;">
          ${i.productName}
          ${trackingInfo}
        </td>
        <td style="padding: 12px 15px; text-align: center; color: #4b5563;">${i.qty}</td>
        <td style="padding: 12px 15px; text-align: right; color: #4b5563;">${symbolStr} ${formatNum(i.price)}</td>
        <td style="padding: 12px 15px; text-align: right; color: #16a34a; font-weight: 600;">${discStr}</td>
        <td style="padding: 12px 15px; text-align: right; color: #464646; font-weight: 700;">${symbolStr} ${formatNum(lineTotal)}</td>
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
            width: 320px;
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
            padding: 2px;
          }
          .logo-container img {
            width: 100%;
            height: 100%;
            max-width: 316px;
            max-height: 271px;
            object-fit: contain;
            transform: scale(1.15);
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
              <h1>${branding.shopName}</h1>
              <p>${branding.address}</p>
              <p>Tel: ${branding.phone} | Email: ${branding.email}</p>
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
                  <th style="width: 70px; text-align: center;">${qtyCol}</th>
                  <th style="width: 110px; text-align: right;">${priceCol}</th>
                  <th style="width: 100px; text-align: right;">${discColLabel}</th>
                  <th style="width: 130px; text-align: right;">${totalCol}</th>
                </tr>
              </thead>
              <tbody>
                ${itemsRows}
              </tbody>
            </table>
          </div>
          
          <div class="totals-section">
            <div class="totals-box">
              ${grossSubtotal !== quote.total ? `
              <div class="total-row" style="color: #6b7280;">
                <span>${isSi ? 'උප එකතුව:' : 'Subtotal:'}</span>
                <span>${symbolStr} ${formatNum(grossSubtotal)}</span>
              </div>
              ` : ''}
              ${productDiscounts > 0 ? `
              <div class="total-row" style="color: #16a34a;">
                <span>${isSi ? 'භාණ්ඩ වට්ටම්:' : 'Product Savings:'}</span>
                <span>-${symbolStr} ${formatNum(productDiscounts)}</span>
              </div>
              ` : ''}
              ${quote.discount_amount && quote.discount_amount > 0 ? `
              <div class="total-row" style="color: #dc2626;">
                <span>${isSi ? 'අමතර වට්ටම්:' : 'Additional Discount:'}</span>
                <span>-${symbolStr} ${formatNum(quote.discount_amount)}</span>
              </div>
              ` : ''}
              ${(productDiscounts + (quote.discount_amount || 0)) > 0 ? `
              <div class="total-row" style="font-weight: 700; color: #16a34a; border-top: 1px dashed #e5e7eb; margin-top: 4px; padding-top: 6px;">
                <span>${isSi ? 'මුළු ඉතිරිය / වට්ටම:' : 'Total Savings / Discount:'}</span>
                <span>-${symbolStr} ${formatNum(productDiscounts + (quote.discount_amount || 0))}</span>
              </div>
              ` : ''}
              ${quote.transportation_fee && quote.transportation_fee > 0 ? `
              <div class="total-row" style="color: #2563eb;">
                <span>${isSi ? 'ප්‍රවාහන ගාස්තු:' : 'Transportation:'}</span>
                <span>+${symbolStr} ${formatNum(quote.transportation_fee)}</span>
              </div>
              ` : ''}
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
      </body>
    </html>
  `;
};


// ============================================
// generateDNPrintHTML
// ============================================

const generateDNPrintHTML = (dn: any, isSi: boolean, shopSettings?: any) => {
  const printerConfig = shopSettings?.printer_settings 
    ? (typeof shopSettings.printer_settings === 'object' 
        ? shopSettings.printer_settings 
        : (() => { try { return JSON.parse(shopSettings.printer_settings); } catch(e) { return {}; } })())
    : {};
  const paperSize = printerConfig?.paperSize || '80mm';

  if (paperSize === '80mm') {
    const title = isSi ? 'බෙදාහැරීම් සටහන' : 'DELIVERY NOTE';
    
    const items = typeof dn.items === 'string' ? JSON.parse(dn.items) : (dn.items || []);
    const itemsRows = items.map((i: any) => {
      let trackingInfo = '';
      if (i.serialNo || i.batchCode) {
        const parts: string[] = [];
        if (i.serialNo) parts.push(`S/N: ${i.serialNo}`);
        if (i.batchCode) parts.push(`Batch: ${i.batchCode}`);
        trackingInfo = `<div style="font-size: 10px; font-weight: normal; color: #6b7280; margin-top: 1px;">${parts.join(' | ')}</div>`;
      }
      return `
        <tr style="border-bottom: 1px dashed #e5e7eb;">
          <td style="padding: 5px 0 2px 0; font-weight: bold; text-align: left; color: #1f2937; font-size: 13px;">
            ${i.productName}
            ${trackingInfo}
          </td>
          <td style="padding: 5px 0 2px 0; text-align: right; color: #1f2937; font-weight: bold; font-size: 13px; width: 60px;">
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
            @page {
              margin: 0;
              size: 80mm auto;
            }
            html, body {
              font-family: 'Inter', 'Noto Sans Sinhala', sans-serif;
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff;
              color: #1f2937;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .receipt-container {
              max-width: 80mm;
              width: 100%;
              margin: 0 auto;
              padding: 0 4mm;
              box-sizing: border-box;
            }
            .header {
              text-align: center;
              border-bottom: 2px dashed #4b5563;
              padding-bottom: 8px;
              margin-bottom: 8px;
            }
            .shop-logo-img {
              width: 2in;
              height: 2in;
              object-fit: contain;
              display: block;
              margin: 0 auto 6px auto;
              image-rendering: -webkit-optimize-contrast;
            }
            .shop-address {
              font-size: 14px;
              font-weight: 800;
              color: #111827;
              margin: 2px 0;
              text-align: center;
              line-height: 1.3;
            }
            .shop-phone {
              font-size: 14px;
              font-weight: 800;
              color: #111827;
              margin: 2px 0 4px 0;
              text-align: center;
              line-height: 1.3;
            }
            .title-badge {
              text-align: center;
              font-size: 13px;
              font-weight: 800;
              text-transform: uppercase;
              margin: 8px 0;
              letter-spacing: 1px;
              border: 1px solid #1f2937;
              padding: 4px;
              background: #f9fafb;
            }
            .meta-table {
              width: 100%;
              font-size: 12px;
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
              font-size: 13px;
            }
            .items-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 10px;
            }
            .items-table th {
              border-bottom: 1.5px solid #1f2937;
              padding: 5px 0;
              font-size: 13px;
              font-weight: 800;
              text-align: left;
              color: #1f2937;
            }
            .seal-divider {
              border-bottom: 2px dashed #4b5563;
              margin-top: 6px;
            }
            .seal-space {
              height: 4cm;
              min-height: 4cm;
            }
            .footer {
              text-align: center;
              margin-top: 5px;
              border-top: 1px dashed #4b5563;
              padding-top: 8px;
              font-size: 12px;
              color: #4b5563;
            }
            .footer p {
              margin: 2px 0;
            }
            .sig-section {
              margin-top: 15px;
              padding-top: 15px;
              border-top: 1px dashed #cccccc;
              text-align: center;
            }
            .sig-line {
              display: inline-block;
              width: 150px;
              border-top: 1px solid #6b7280;
              margin-top: 20px;
              font-size: 11px;
            }
            @media print {
              @page {
                margin: 0;
              }
              html, body {
                padding: 0 !important;
                margin: 0 !important;
              }
              .receipt-container {
                width: 100%;
                max-width: 100%;
                padding: 0 4mm !important;
                box-sizing: border-box;
              }
            }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <div class="header">
              <img class="shop-logo-img" src="${shopSettings?.logo_path || './images/logo.png'}" alt="Shop Logo" onerror="this.style.display='none';" />
              <div class="shop-address">${shopSettings?.address || 'No: 80, Mahahunupitiya, Negombo'}</div>
              <div class="shop-phone">Tel: ${shopSettings?.phone || '077 076 076 7'}</div>
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
                <td class="value">${dn.customer_name || dn.customerName || (isSi ? 'පාරිභෝගිකයා' : 'Guest Customer')}</td>
              </tr>
              ${(dn.customer_phone || dn.customerPhone || dn.phone) ? `
              <tr>
                <td>${isSi ? 'දුරකථන අංකය:' : 'Tel:'}</td>
                <td class="value">${dn.customer_phone || dn.customerPhone || dn.phone}</td>
              </tr>
              ` : ''}
              ${(dn.customer_address || dn.customerAddress || dn.address) ? `
              <tr>
                <td>${isSi ? 'ලිපිනය:' : 'Address:'}</td>
                <td class="value">${dn.customer_address || dn.customerAddress || dn.address}</td>
              </tr>
              ` : ''}
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
            
            <div class="seal-divider"></div>
            <div class="seal-space"></div>
            
            <div class="footer">
              <p>${isSi ? 'කරුණාකර භාණ්ඩ ලැබුණු පසු පරීක්ෂා කර අත්සන් කරන්න.' : 'Please inspect items upon delivery and sign above.'}</p>
              <p style="font-weight: bold; margin-top: 5px;">${isSi ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි!' : 'Thank you for your business!'}</p>
            </div>
          </div>
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
            width: 250px;
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
            padding: 2px;
          }
          .logo-container img {
            width: 100%;
            height: 100%;
            max-width: 246px;
            max-height: 206px;
            object-fit: contain;
            transform: scale(1.15);
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
      </body>
    </html>
  `;
};


// ============================================
// generatePrintHTML
// ============================================

const generatePrintHTML = (order: SaleOrder, isSi: boolean, shopSettings?: any) => {
  const branding = getSystemBranding(shopSettings);
  const printerConfig = branding.printerSettings;
  const paperSize = printerConfig?.paperSize || '80mm';

  const matchedCust = (shopSettings?.customers || []).find((c: any) => 
    (order.customer_id && c.id === order.customer_id) || 
    (order.customerName && c.name && c.name.toLowerCase() === order.customerName.toLowerCase()) ||
    (order.customer_name && c.name && c.name.toLowerCase() === order.customer_name.toLowerCase())
  );

  const validOrderCustName = (order.customerName && order.customerName.trim() && order.customerName !== 'Guest Customer' && order.customerName !== 'Guest')
    ? order.customerName.trim()
    : ((order.customer_name && order.customer_name.trim() && order.customer_name !== 'Guest Customer' && order.customer_name !== 'Guest')
        ? order.customer_name.trim()
        : null);

  const customerName = validOrderCustName || matchedCust?.name || (isSi ? 'පාරිභෝගිකයා (Guest)' : 'Guest Customer');
  const custPhone = order.customerPhone || order.customer_phone || matchedCust?.phone || '';
  const custAddress = order.customerAddress || order.customer_address || matchedCust?.address || '';

  if (paperSize === '80mm') {
    const symbolStr = isSi ? 'රු.' : 'Rs.';
    const formatNum = (num: number) => num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const isCredit = order.payment_method === 'Credit' || order.status === 'Non Paid';
    const title = isCredit 
      ? (isSi ? 'ණය ඉන්වොයිසිය' : 'CREDIT INVOICE')
      : (isSi ? 'ඉන්වොයිසිය' : 'INVOICE');
    
    const orderItemsList = Array.isArray(order.items) 
      ? order.items 
      : (typeof order.items === 'string' 
          ? (() => { try { return JSON.parse(order.items); } catch(e) { return []; } })() 
          : []);
    const itemsRows = orderItemsList.map((i: any) => {
      let trackingInfo = '';
      if (i.serialNo || i.batchCode) {
        const parts: string[] = [];
        if (i.serialNo) parts.push(`S/N: ${i.serialNo}`);
        if (i.batchCode) parts.push(`Batch: ${i.batchCode}`);
        trackingInfo = `<div style="font-size: 10px; font-weight: normal; color: #6b7280; margin-top: 1px;">${parts.join(' | ')}</div>`;
      }
      const qty = Number(i.quantity || i.qty || 1);
      const unitPrice = Number(i.unit_price || i.price || 0);
      const grossLineTotal = qty * unitPrice;
      return `
        <tr style="border-bottom: 1px dashed #e5e7eb;">
          <td colspan="2" style="padding: 5px 0 2px 0; font-weight: bold; text-align: left; color: #1f2937; font-size: 13px;">
            ${i.productName || i.name || i.description}
            ${trackingInfo}
          </td>
        </tr>
        <tr style="border-bottom: 1px dashed #e5e7eb;">
          <td style="padding: 2px 0 6px 0; text-align: left; color: #374151; font-size: 12px;">
            ${qty} ${i.unit || ''} x ${symbolStr} ${formatNum(unitPrice)}
          </td>
          <td style="padding: 2px 0 6px 0; text-align: right; color: #1f2937; font-weight: bold; font-size: 13px;">
            ${symbolStr} ${formatNum(grossLineTotal)}
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
            @page {
              margin: 0;
              size: 80mm auto;
            }
            html, body {
              font-family: 'Inter', 'Noto Sans Sinhala', sans-serif;
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff;
              color: #1f2937;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .receipt-container {
              max-width: 80mm;
              width: 100%;
              margin: 0 auto;
              padding: 0 6mm;
              box-sizing: border-box;
            }
            .header {
              text-align: center;
              border-bottom: 2px dashed #4b5563;
              padding-bottom: 8px;
              margin-bottom: 8px;
            }
            .shop-logo-img {
              width: 2in;
              height: 2in;
              object-fit: contain;
              display: block;
              margin: 0 auto 6px auto;
              image-rendering: -webkit-optimize-contrast;
            }
            .shop-address {
              font-size: 14px;
              font-weight: 800;
              color: #111827;
              margin: 2px 0;
              text-align: center;
              line-height: 1.3;
            }
            .shop-phone {
              font-size: 14px;
              font-weight: 800;
              color: #111827;
              margin: 2px 0 4px 0;
              text-align: center;
              line-height: 1.3;
            }
            .title-badge {
              text-align: center;
              font-size: 13px;
              font-weight: 800;
              text-transform: uppercase;
              margin: 8px 0;
              letter-spacing: 1px;
              border: 1px solid #1f2937;
              padding: 4px;
              background: #f9fafb;
            }
            .meta-table {
              width: 100%;
              font-size: 12px;
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
              font-size: 13px;
            }
            .items-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 10px;
            }
            .items-table th {
              border-bottom: 1.5px solid #1f2937;
              padding: 5px 0;
              font-size: 13px;
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
              padding: 4px 0;
              font-size: 13px;
              color: #4b5563;
            }
            .summary-table td.value {
              text-align: right;
              font-weight: 700;
              color: #1f2937;
            }
            .summary-table tr.total-row td {
              font-size: 16px;
              font-weight: 800;
              color: #111827;
              border-top: 1px dashed #4b5563;
              padding-top: 6px;
            }
            .seal-divider {
              border-bottom: 2px dashed #4b5563;
              margin-top: 6px;
            }
            .seal-space {
              height: 4cm;
              min-height: 4cm;
            }
            .footer {
              text-align: center;
              margin-top: 5px;
              border-top: 1px dashed #4b5563;
              padding-top: 8px;
              font-size: 12px;
              color: #4b5563;
            }
            .footer p {
              margin: 2px 0;
            }
            @media print {
              @page {
                margin: 0;
              }
              html, body {
                padding: 0 !important;
                margin: 0 !important;
              }
              .receipt-container {
                width: 100%;
                max-width: 100%;
                padding: 0 6mm !important;
                box-sizing: border-box;
              }
            }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <div class="header">
              <img class="shop-logo-img" src="${branding.logoPath}" alt="Shop Logo" onerror="this.style.display='none';" />
              <div style="font-size: 16px; font-weight: 800; text-align: center; text-transform: uppercase; color: #111827; margin-bottom: 2px;">${branding.shopName}</div>
              <div class="shop-address">${branding.address}</div>
              <div class="shop-phone">Tel: ${branding.phone}</div>
            </div>
            
            <div class="title-badge">${title}</div>
            
            <table class="meta-table">
              <tr>
                <td>${isSi ? 'ඉන්වොයිස් අංකය:' : 'INVOICE NO:'}</td>
                <td class="value">${order.invoiceNo || order.invoice_no}</td>
              </tr>
              <tr>
                <td>${isSi ? 'නිකුත් කළ දිනය:' : 'ISSUE DATE:'}</td>
                <td class="value">${formatInvoiceDateTime(order.created_at, order.date)}</td>
              </tr>
              <tr>
                <td>${isSi ? 'ගෙවීම් ක්‍රමය:' : 'PAYMENT METHOD:'}</td>
                <td class="value"><span style="display: inline-block; padding: 2px 8px; background-color: #f59e0b; color: #000000; font-weight: 800; text-transform: uppercase; font-size: 11px; border: 1px solid #d97706; border-radius: 4px;">${(order.payment_method || (order as any).paymentMethod || (order.status === 'Non Paid' ? 'CREDIT' : 'CASH')).toUpperCase()}</span></td>
              </tr>
              <tr>
                <td>${isSi ? 'අයකැමි:' : 'CASHIER:'}</td>
                <td class="value" style="font-weight: 700;">${order.cashier || (order as any).cashier_name || (order as any).user_name || shopSettings?.shop_name || 'Sanoj Hardware'}</td>
              </tr>
              ${((order.payment_method || (order as any).paymentMethod || '').toLowerCase() === 'credit' || order.status === 'Non Paid') ? `
              <tr>
                <td>${isSi ? 'තත්ත්වය:' : 'STATUS:'}</td>
                <td class="value"><span style="display: inline-block; padding: 2px 6px; background-color: #ffe4e6; color: #9f1239; font-weight: 800; text-transform: uppercase; font-size: 10px; border: 1px solid #f43f5e; border-radius: 4px;">${isSi ? `නොගෙවූ / හිඟ (ණය කාලය: ${(order as any).credit_period || (order as any).payment_terms || order.credit_period_days || 30} දින)` : `UNPAID / OUTSTANDING (Credit Period: ${(order as any).credit_period || (order as any).payment_terms || order.credit_period_days || 30} Days)`}</span></td>
              </tr>
              ` : ''}
              <tr>
                <td>${isSi ? 'පාරිභෝගිකයා:' : 'CUSTOMER:'}</td>
                <td class="value">${customerName}</td>
              </tr>
              ${custPhone ? `
              <tr>
                <td>${isSi ? 'දුරකථන අංකය:' : 'Tel:'}</td>
                <td class="value">${custPhone}</td>
              </tr>
              ` : ''}
              ${custAddress ? `
              <tr>
                <td>${isSi ? 'ලිපිනය:' : 'Address:'}</td>
                <td class="value">${custAddress}</td>
              </tr>
              ` : ''}
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
              ${Number(order.discount || 0) > 0 ? `
              <tr style="color: #dc2626;">
                <td>${isSi ? 'පාරිභෝගික වට්ටම:' : 'Customer Discount:'}</td>
                <td class="value" style="color: #dc2626;">-${symbolStr} ${formatNum(order.discount || 0)}</td>
              </tr>
              ` : ''}
              ${Number(order.transportation_fee || order.transportationFee || 0) > 0 ? `
              <tr>
                <td>${isSi ? 'ප්‍රවාහන ගාස්තුව:' : 'Transportation Fee:'}</td>
                <td class="value">+${symbolStr} ${formatNum(order.transportation_fee || order.transportationFee || 0)}</td>
              </tr>
              ` : ''}
              ${Number(order.credit_note_applied || order.creditNoteApplied || 0) > 0 ? `
              <tr style="color: #059669;">
                <td>${isSi ? 'ණය සටහන:' : 'Credit Note Applied:'}</td>
                <td class="value" style="color: #059669;">-${symbolStr} ${formatNum(order.credit_note_applied || order.creditNoteApplied || 0)}</td>
              </tr>
              ` : ''}
              <tr class="total-row">
                <td>${isSi ? 'ගෙවිය යුතු මුළු මුදල:' : 'Total Amount:'}</td>
                <td class="value">${symbolStr} ${formatNum(order.total_amount !== undefined ? order.total_amount : order.total)}</td>
              </tr>
            </table>
            
            <div class="seal-divider"></div>
            <div class="seal-space"></div>
            
            <div class="footer">
              <p>${isSi ? 'කිසියම් ප්‍රශ්නයක් ඇත්නම් කරුණාකර අප හා සම්බන්ධ වන්න.' : 'For queries, please contact us.'}</p>
              <p style="font-weight: bold; margin-top: 5px;">${branding.footer}</p>
            </div>
          </div>
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
  const invoiceNoLabel = isSi ? 'ඉන්වොයිස් අංකය:' : 'INVOICE NO:';
  const issueDateLabel = isSi ? 'නිකුත් කළ දිනය:' : 'ISSUE DATE:';
  
  const descCol = isSi ? 'විස්තරය' : 'Description';
  const qtyCol = isSi ? 'ප්‍රමාණය' : 'Qty';
  const priceCol = isSi ? 'ඒකක මිල' : 'Unit Price';
  const totalCol = isSi ? 'එකතුව' : 'Total';
  
  const subTotalLabel = isSi ? 'උප එකතුව:' : 'Sub Total:';
  const discountLabel = isSi ? 'වට්ටම:' : 'Discount:';
  const totalDueLabel = isSi ? 'ගෙවිය යුතු මුළු මුදල:' : 'Total Due:';
  
  const notesLabel = isSi ? 'සටහන්' : 'NOTES';
  const noteLine1 = isSi ? 'කිසියම් ප්‍රශ්නයක් ඇත්නම් කරුණාකර අප හා සම්බන්ධ වන්න.' : 'Please feel free to contact us in case of any questions.';
  const noteLine2 = isSi ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි!' : 'Thank you for your business!';
  const signeeLabel = isSi ? 'බලයලත් අත්සන' : 'Authorized Signee';

  const orderItemsList = Array.isArray(order.items) 
    ? order.items 
    : (typeof order.items === 'string' 
        ? (() => { try { return JSON.parse(order.items); } catch(e) { return []; } })() 
        : []);
  const itemsRows = orderItemsList.map((i: any) => {
    let trackingInfo = '';
    if (i.serialNo || i.batchCode) {
      const parts: string[] = [];
      if (i.serialNo) parts.push(`S/N: ${i.serialNo}`);
      if (i.batchCode) parts.push(`Batch: ${i.batchCode}`);
      trackingInfo = `<div style="font-size: 9px; font-weight: normal; color: #9ca3af; margin-top: 2px;">${parts.join(' | ')}</div>`;
    }
    const qty = Number(i.quantity || i.qty || 1);
    const unitPrice = Number(i.unit_price || i.price || 0);
    const grossLineTotal = qty * unitPrice;
    return `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px 15px; font-weight: 700; text-align: left; color: #464646;">
          ${i.productName || i.name || i.description}
          ${trackingInfo}
        </td>
        <td style="padding: 12px 15px; text-align: center; color: #4b5563;">${qty} ${i.unit || ''}</td>
        <td style="padding: 12px 15px; text-align: right; color: #4b5563;">${symbolStr} ${formatNum(unitPrice)}</td>
        <td style="padding: 12px 15px; text-align: right; color: #464646; font-weight: 700;">${symbolStr} ${formatNum(grossLineTotal)}</td>
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
            width: 320px;
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
            padding: 2px;
          }
          .logo-container img {
            width: 100%;
            height: 100%;
            max-width: 316px;
            max-height: 276px;
            object-fit: contain;
            transform: scale(1.15);
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
            margin: 30px 50px 20px 40px;
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
            padding-right: 8px;
          }
          .table-section {
            margin: 20px 50px 20px 40px;
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
          .invoice-table th.total { text-align: right; width: 20%; padding-right: 8px; }
          
          .summary-section {
            display: flex;
            justify-content: space-between;
            margin: 60px 50px 20px 40px; /* Generous top margin to place note section beautifully at bottom */
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
            width: 42%;
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
            padding-right: 8px;
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
            padding-right: 8px;
          }
          .signature-section {
            margin-top: 80px;
            text-align: right;
            padding-right: 50px;
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
              padding-right: 10px;
            }
          }
        </style>
      </head>
      <body>
        <div class="invoice-container">
          <div class="header-banner">
            <div class="company-info">
              <h1>${branding.shopName}</h1>
              <p>${branding.address}</p>
              <p>Contact: ${branding.phone}</p>
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
              <p>${customerName}</p>
              ${(order.customerPhone || order.customer_phone || (shopSettings?.customers || []).find((c: any) => (order.customer_id && c.id === order.customer_id) || (order.customerName && c.name && c.name.toLowerCase() === order.customerName.toLowerCase()))?.phone) ? `<p style="font-size: 11px; color: #4b5563; margin-top: 3px; font-weight: 600;">Tel: ${order.customerPhone || order.customer_phone || (shopSettings?.customers || []).find((c: any) => (order.customer_id && c.id === order.customer_id) || (order.customerName && c.name && c.name.toLowerCase() === order.customerName.toLowerCase()))?.phone}</p>` : ''}
              ${(order.customerAddress || order.customer_address || (shopSettings?.customers || []).find((c: any) => (order.customer_id && c.id === order.customer_id) || (order.customerName && c.name && c.name.toLowerCase() === order.customerName.toLowerCase()))?.address) ? `<p style="font-size: 11px; color: #4b5563; margin-top: 2px;">Address: ${order.customerAddress || order.customer_address || (shopSettings?.customers || []).find((c: any) => (order.customer_id && c.id === order.customer_id) || (order.customerName && c.name && c.name.toLowerCase() === order.customerName.toLowerCase()))?.address}</p>` : ''}
            </div>
            <div class="invoice-details">
              <table>
                <tr>
                  <td class="label">${invoiceNoLabel}</td>
                  <td class="value">${order.invoiceNo || order.invoice_no}</td>
                </tr>
                <tr>
                  <td class="label">${issueDateLabel}</td>
                  <td class="value">${formatInvoiceDateTime(order.created_at, order.date)}</td>
                </tr>
                <tr>
                  <td class="label">${isSi ? 'ගෙවීම් ක්‍රමය:' : 'PAYMENT METHOD:'}</td>
                  <td class="value"><span style="display: inline-block; padding: 2px 8px; background-color: #f59e0b; color: #000000; font-weight: 800; text-transform: uppercase; font-size: 10px; border: 1px solid #d97706; border-radius: 4px;">${(order.payment_method || (order as any).paymentMethod || (order.status === 'Non Paid' ? 'CREDIT' : 'CASH')).toUpperCase()}</span></td>
                </tr>
                <tr>
                  <td class="label">${isSi ? 'අයකැමි:' : 'CASHIER:'}</td>
                  <td class="value" style="font-weight: 700; color: #1f2937;">${order.cashier || (order as any).cashier_name || (order as any).user_name || shopSettings?.shop_name || 'Sanoj Hardware'}</td>
                </tr>
                ${((order.payment_method || (order as any).paymentMethod || '').toLowerCase() === 'credit' || order.status === 'Non Paid') ? `
                <tr>
                  <td class="label">${isSi ? 'තත්ත්වය:' : 'STATUS:'}</td>
                  <td class="value"><span style="display: inline-block; padding: 2px 8px; background-color: #ffe4e6; color: #9f1239; font-weight: 800; text-transform: uppercase; font-size: 9px; border: 1px solid #f43f5e; border-radius: 4px;">${isSi ? `නොගෙවූ / හිඟ (ණය කාලය: ${(order as any).credit_period || (order as any).payment_terms || order.credit_period_days || 30} දින)` : `UNPAID / OUTSTANDING (Credit Period: ${(order as any).credit_period || (order as any).payment_terms || order.credit_period_days || 30} Days)`}</span></td>
                </tr>
                ` : ''}
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
                ${Number(order.discount || 0) > 0 ? `
                <tr>
                  <td class="label" style="color: #dc2626;">${isSi ? 'පාරිභෝගික වට්ටම:' : 'Customer Discount:'}</td>
                  <td class="value" style="color: #dc2626;">-${symbolStr} ${formatNum(order.discount || 0)}</td>
                </tr>
                ` : ''}
                ${Number(order.transportation_fee || order.transportationFee || 0) > 0 ? `
                <tr>
                  <td class="label">${isSi ? 'ප්‍රවාහන ගාස්තුව:' : 'Transportation Fee:'}</td>
                  <td class="value">+${symbolStr} ${formatNum(order.transportation_fee || order.transportationFee || 0)}</td>
                </tr>
                ` : ''}
                ${Number(order.credit_note_applied || order.creditNoteApplied || 0) > 0 ? `
                <tr>
                  <td class="label" style="color: #059669;">${isSi ? 'ණය සටහන:' : 'Credit Note Applied:'}</td>
                  <td class="value" style="color: #059669;">-${symbolStr} ${formatNum(order.credit_note_applied || order.creditNoteApplied || 0)}</td>
                </tr>
                ` : ''}
                <tr class="total-due-row">
                  <td class="label">${isSi ? 'ගෙවිය යුතු මුළු මුදල:' : 'Total Amount:'}</td>
                  <td class="value">${symbolStr} ${formatNum(order.total_amount !== undefined ? order.total_amount : order.total)}</td>
                </tr>
              </table>
            </div>
          </div>
          
          <div class="signature-section">
            <span class="signature-line">${signeeLabel}</span>
          </div>
        </div>
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

// ============================================
// generateReturnPrintHTML (Outer/Primary definition)
// ============================================

const generateReturnPrintHTML = (
  sr: SalesReturn, 
  isSiOrSettings?: boolean | any, 
  settingsOrIsSi?: any | boolean
) => {
  const isSi = typeof isSiOrSettings === 'boolean' 
    ? isSiOrSettings 
    : (typeof settingsOrIsSi === 'boolean' ? settingsOrIsSi : false);
  const shopSettings = (typeof isSiOrSettings === 'object' && isSiOrSettings !== null) 
    ? isSiOrSettings 
    : ((typeof settingsOrIsSi === 'object' && settingsOrIsSi !== null) ? settingsOrIsSi : {});

  const symbolStr = isSi ? 'රු.' : (shopSettings?.currency || shopSettings?.currency_symbol || 'Rs.');
  const formatNum = (num: number) => (num || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const returnedItems = Array.isArray(sr.returnedItems) ? sr.returnedItems : safeParseJson(sr.returnedItems, []);
  const exchangeItems = Array.isArray(sr.exchangeItems) ? sr.exchangeItems : safeParseJson(sr.exchangeItems, []);
  const isCreditBill = sr.isCredit === true || (sr as any).is_credit === 1 || (sr as any).is_credit === true;
  const displayMethod = isCreditBill 
    ? (exchangeItems.length > 0 ? 'Exchange' : 'Return')
    : (sr.returnMethod || 'Return');

  const title = displayMethod === 'Exchange' 
    ? (isSi ? 'භාණ්ඩ හුවමාරු රසීදුව' : 'EXCHANGE RECEIPT')
    : (displayMethod === 'Credit Note' ? (isSi ? 'ණය සටහන් රසීදුව' : 'CREDIT NOTE RECEIPT') : (isSi ? 'ආපසු භාරගැනීමේ රසීදුව' : 'RETURN RECEIPT'));

  const grossReturnVal = returnedItems.reduce((sum: number, i: any) => sum + ((i.qty || 1) * Number(i.originalStickerPrice || i.originalUnitPrice || i.price || 0)), 0);
  const discountReturnVal = returnedItems.reduce((sum: number, i: any) => sum + ((i.qty || 1) * Number(i.unitDiscount || 0)), 0);
  const returnCreditValue = Number(sr.returnAmount !== undefined ? sr.returnAmount : (sr.totalRefunded || (grossReturnVal - discountReturnVal) || 0));
  const exchangeTotal = Number(sr.exchangeAmount !== undefined ? sr.exchangeAmount : exchangeItems.reduce((sum: number, i: any) => sum + ((i.qty || 1) * Number(i.price || i.unitPrice || 0)), 0));
  const priceDifference = exchangeTotal - returnCreditValue;
  const settlementMode = sr.differencePaymentMethod || (sr as any).difference_payment_method || (sr as any).paymentMethod || (isCreditBill ? 'Customer Credit Debt' : 'Cash');

  const retRows = returnedItems.map((i: any) => {
    const origPrice = Number(i.originalStickerPrice || i.originalUnitPrice || i.price || 0);
    const { effectivePrice, unitDiscount } = calculateEffectiveUnitPricePaid(i, sr);
    const effectiveUnitPrice = i.netUnitPrice !== undefined ? Number(i.netUnitPrice) : effectivePrice;
    const unitDisc = i.unitDiscount !== undefined ? Number(i.unitDiscount) : unitDiscount;
    const lineTotal = Number(i.qty || 1) * effectiveUnitPrice;
    return `
      <tr style="border-bottom: 1px dashed #e5e7eb;">
        <td style="padding: 5px 0 3px 0; text-align: left; color: #1f2937; font-weight: bold; font-size: 11px;">
          ${i.productName || i.name}
          ${unitDisc > 0 ? `<div style="font-size: 9px; color: #dc2626; font-weight: normal;">${symbolStr} ${formatNum(origPrice)} - ${symbolStr} ${formatNum(unitDisc)} disc = ${symbolStr} ${formatNum(effectiveUnitPrice)}/pc</div>` : ''}
        </td>
        <td style="padding: 5px 0 3px 0; text-align: center; font-size: 11px;">${i.qty} ${i.unit || ''}</td>
        <td style="padding: 5px 0 3px 0; text-align: right; font-weight: bold; font-size: 11px;">${symbolStr} ${formatNum(effectiveUnitPrice)}</td>
        <td style="padding: 5px 0 3px 0; text-align: right; font-weight: bold; color: #dc2626; font-size: 11px;">${symbolStr} ${formatNum(lineTotal)}</td>
      </tr>
    `;
  }).join('');

  const exRows = exchangeItems.map((i: any) => {
    const unitPrice = Number(i.price || i.unitPrice || 0);
    const lineTotal = Number(i.total !== undefined ? i.total : (Number(i.qty || 1) * unitPrice));
    return `
      <tr style="border-bottom: 1px dashed #e5e7eb;">
        <td style="padding: 5px 0 3px 0; text-align: left; color: #1f2937; font-weight: bold; font-size: 11px;">⇄ ${i.productName || i.name}</td>
        <td style="padding: 5px 0 3px 0; text-align: center; font-size: 11px;">${i.qty} ${i.unit || ''}</td>
        <td style="padding: 5px 0 3px 0; text-align: right; font-size: 11px;">${symbolStr} ${formatNum(unitPrice)}</td>
        <td style="padding: 5px 0 3px 0; text-align: right; font-weight: bold; color: #059669; font-size: 11px;">${symbolStr} ${formatNum(lineTotal)}</td>
      </tr>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title} - ${sr.returnNo || sr.return_no || sr.id}</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Noto+Sans+Sinhala:wght@400;600;700;800&family=Roboto+Mono:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          @page { margin: 0; size: 80mm auto; }
          body { font-family: 'Inter', 'Noto Sans Sinhala', sans-serif; margin: 0; padding: 12px; font-size: 12px; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .receipt-container { width: 100%; max-width: 78mm; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px dashed #9ca3af; padding-bottom: 6px; margin-bottom: 6px; }
          .title { font-weight: 900; font-size: 13px; text-align: center; margin: 6px 0; text-transform: uppercase; border: 1px solid #374151; padding: 3px; background: #f9fafb; border-radius: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 4px; }
          th { text-align: left; border-bottom: 1px solid #374151; padding: 3px 0; font-size: 10px; font-weight: 800; text-transform: uppercase; }
          .font-mono { font-family: 'Roboto Mono', monospace; }
        </style>
      </head>
      <body>
        <div class="receipt-container">
          <div class="header">
            <div style="font-weight: 900; font-size: 15px; letter-spacing: 0.5px;">${shopSettings?.storeName || shopSettings?.shop_name || 'MUTHUWADIGE HARDWARE'}</div>
            <div style="font-size: 10px; color: #4b5563; margin-top: 2px;">${shopSettings?.address || 'No: 80, Mahahunupitiya, Negombo'}</div>
            <div style="font-size: 10px; color: #4b5563;">Tel: ${shopSettings?.phone || shopSettings?.telephone || '077 076 076 7'}</div>
          </div>
          
          <div class="title">${title}</div>
          
          <div style="font-size: 11px; margin-bottom: 8px; line-height: 1.4;">
            <div style="display: flex; justify-content: space-between;"><strong>${isSi ? 'ආපසු අංකය:' : 'Return No:'}</strong> <span class="font-mono" style="font-weight: bold;">${sr.returnNo || sr.return_no || sr.id}</span></div>
            <div style="display: flex; justify-content: space-between;"><strong>${isSi ? 'මුල් ඉන්වොයිසිය:' : 'Original Inv:'}</strong> <span class="font-mono">${sr.invoiceNo || sr.invoice_no}</span></div>
            <div style="display: flex; justify-content: space-between;"><strong>${isSi ? 'පාරිභෝගිකයා:' : 'Customer:'}</strong> <span>${sr.customerName || sr.customer_name || (isSi ? 'පාරිභෝගිකයා' : 'Guest Customer')}</span></div>
            <div style="display: flex; justify-content: space-between;"><strong>${isSi ? 'අයකැමි:' : 'Cashier:'}</strong> <span>${sr.cashier || (sr as any).cashier_name || (sr as any).user_name || shopSettings?.shop_name || 'Sanoj Hardware'}</span></div>
            <div style="display: flex; justify-content: space-between;"><strong>${isSi ? 'දිනය:' : 'Date:'}</strong> <span>${new Date(sr.created_at || new Date()).toLocaleString()}</span></div>
            <div style="display: flex; justify-content: space-between;"><strong>${isSi ? 'ක්‍රමය:' : 'Method:'}</strong> <span style="font-weight: bold;">${displayMethod}</span></div>
          </div>
          
          <div style="font-weight: 800; margin-top: 8px; font-size: 11px; color: #dc2626; text-transform: uppercase;">${isSi ? 'ආපසු භාරගත් භාණ්ඩ:' : 'Returned Item(s):'}</div>
          <table>
            <thead>
              <tr>
                <th>${isSi ? 'විස්තරය' : 'Item Description'}</th>
                <th style="text-align:center;">${isSi ? 'ප්‍රමාණය' : 'Qty'}</th>
                <th style="text-align:right;">${isSi ? 'ශුද්ධ මිල' : 'Net Price'}</th>
                <th style="text-align:right;">${isSi ? 'එකතුව' : 'Total'}</th>
              </tr>
            </thead>
            <tbody>${retRows}</tbody>
          </table>

          ${exchangeItems.length > 0 ? `
            <div style="font-weight: 800; margin-top: 10px; font-size: 11px; color: #059669; text-transform: uppercase;">${isSi ? 'හුවමාරු ලැබුණු නව භාණ්ඩ:' : 'Exchange Replacement Item(s):'}</div>
            <table>
              <thead>
                <tr>
                  <th>${isSi ? 'විස්තරය' : 'Item Description'}</th>
                  <th style="text-align:center;">${isSi ? 'ප්‍රමාණය' : 'Qty'}</th>
                  <th style="text-align:right;">${isSi ? 'මිල' : 'Price'}</th>
                  <th style="text-align:right;">${isSi ? 'එකතුව' : 'Total'}</th>
                </tr>
              </thead>
              <tbody>${exRows}</tbody>
            </table>
          ` : ''}

          {/* Calculation & Balance Breakdown */}
          <div class="font-mono" style="margin-top: 10px; border-top: 2px dashed #374151; padding-top: 6px; font-size: 11px; line-height: 1.5;">
            <div style="display: flex; justify-content: space-between;">
              <span>${isSi ? 'ආපසු වටිනාකම (ශුද්ධ):' : 'Return Credit (Net):'}</span>
              <span style="font-weight: bold;">${symbolStr} ${formatNum(returnCreditValue)}</span>
            </div>

            ${exchangeItems.length > 0 ? `
              <div style="display: flex; justify-content: space-between;">
                <span>${isSi ? 'නව හුවමාරු මුළු එකතුව:' : 'Exchange New Total:'}</span>
                <span style="font-weight: bold; color: #059669;">${symbolStr} ${formatNum(exchangeTotal)}</span>
              </div>
              
              <div style="border-top: 1px solid #9ca3af; margin: 4px 0;"></div>

              ${priceDifference > 0 ? `
                <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 12px; background: #f3f4f6; padding: 4px 6px; border-radius: 4px; color: #111827; border: 1px solid #e5e7eb;">
                  <span>${isSi ? 'පාරිභෝගිකයා අමතරව ගෙවිය යුතු මුදල:' : 'CUSTOMER EXTRA PAYABLE:'}</span>
                  <span style="color: #b45309;">${symbolStr} ${formatNum(priceDifference)}</span>
                </div>
              ` : priceDifference < 0 ? `
                <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 12px; background: #f3f4f6; padding: 4px 6px; border-radius: 4px; color: #111827; border: 1px solid #e5e7eb;">
                  <span>${isCreditBill ? (isSi ? 'ණය ගිණුමෙන් අඩුකළ මුදල:' : 'CREDIT REDUCTION:') : (isSi ? 'පාරිභෝගිකයාට ආපසු ගෙවිය යුතු මුදල:' : 'STORE REFUND TO CUSTOMER:')}</span>
                  <span style="color: #059669;">${symbolStr} ${formatNum(Math.abs(priceDifference))}</span>
                </div>
              ` : `
                <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 12px; background: #f3f4f6; padding: 4px 6px; border-radius: 4px; color: #111827; border: 1px solid #e5e7eb;">
                  <span>${isSi ? 'ශුද්ධ ශේෂය:' : 'NET BALANCE:'}</span>
                  <span>${symbolStr} 0.00 (${isSi ? 'සම ශේෂ හුවමාරුව' : 'Even Exchange'})</span>
                </div>
              `}

              <div style="display: flex; justify-content: space-between; font-size: 10px; color: #4b5563; font-style: italic; margin-top: 4px;">
                <span>${isSi ? 'පියවීමේ ක්‍රමය:' : 'Settlement Mode:'}</span>
                <span style="font-weight: bold; color: #111827;">${settlementMode}</span>
              </div>

              ${Number(sr.customerPaid || 0) > 0 ? `
                <div style="display: flex; justify-content: space-between; font-size: 11px; margin-top: 2px;">
                  <span>${isSi ? 'පාරිභෝගිකයා ගෙවූ මුදල:' : 'Customer Paid:'}</span>
                  <span style="font-weight: bold;">${symbolStr} ${formatNum(Number(sr.customerPaid))}</span>
                </div>
              ` : ''}
              ${Number(sr.changeGiven || 0) > 0 ? `
                <div style="display: flex; justify-content: space-between; font-size: 11px; margin-top: 2px;">
                  <span>${isSi ? 'ඉතිරි මුදල:' : 'Change Given:'}</span>
                  <span style="font-weight: bold;">${symbolStr} ${formatNum(Number(sr.changeGiven))}</span>
                </div>
              ` : ''}
            ` : `
              ${sr.returnMethod === 'Credit Note' ? `
                <div style="display: flex; justify-content: space-between; margin-top: 4px; color: #d97706; font-weight: bold;">
                  <span>${isSi ? 'නිකුත් කළ ණය සටහන:' : 'Credit Note Issued:'}</span>
                  <span>${sr.creditNoteNo || 'CN-ISSUED'}</span>
                </div>
              ` : sr.returnMethod === 'Cash Refund' && !isCreditBill ? `
                <div style="display: flex; justify-content: space-between; margin-top: 4px; color: #dc2626; font-weight: bold;">
                  <span>${isSi ? 'ආපසු ගෙවූ මුදල:' : 'Cash Refunded:'}</span>
                  <span>${symbolStr} ${formatNum(sr.totalRefunded || returnCreditValue)}</span>
                </div>
              ` : isCreditBill ? `
                <div style="display: flex; justify-content: space-between; margin-top: 4px; color: #0284c7; font-weight: bold;">
                  <span>${isSi ? 'ණය සැකසුම:' : 'Credit Adjustment:'}</span>
                  <span>${symbolStr} ${formatNum(sr.totalRefunded || returnCreditValue)}</span>
                </div>
              ` : ''}
            `}
          </div>

          <div style="text-align: center; margin-top: 14px; font-size: 10px; color: #6b7280; border-top: 1px dashed #d1d5db; padding-top: 6px;">
            <div>${shopSettings?.invoice_footer || shopSettings?.receiptFooter || shopSettings?.footer_text || (isSi ? 'ඔබගේ ව්‍යාපාරයට ස්තූතියි! නැවත එන්න.' : 'Thank you for your business! Come again.')}</div>
            <div style="font-size: 8px; color: #9ca3af; margin-top: 2px;">Software by Muthuwadige Hardware ERP</div>
          </div>
        </div>
      </body>
    </html>
  `;
};


// ============================================
// generateCreditNotePrintHTML (Outer/Primary definition)
// ============================================

const generateCreditNotePrintHTML = (cn: CreditNote, isSi: boolean, shopSettings?: any) => {
  const symbolStr = isSi ? 'රු.' : 'Rs.';
  const formatNum = (num: number) => (num || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const items = Array.isArray(cn.items) ? cn.items : safeParseJson(cn.items, []);

  const itemsRows = items.map((i: any) => `
    <tr style="border-bottom: 1px dashed #e5e7eb;">
      <td style="padding: 4px 0; text-align: left;">${i.productName}</td>
      <td style="padding: 4px 0; text-align: center;">${i.qty} ${i.unit || ''}</td>
      <td style="padding: 4px 0; text-align: right; font-weight: bold;">${symbolStr} ${formatNum(i.qty * i.price)}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Credit Note - ${cn.creditNoteNo || cn.credit_note_no || cn.id}</title>
        <style>
          @page { margin: 0; size: 80mm auto; }
          body { font-family: 'Inter', sans-serif; margin: 0; padding: 10px; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; }
          th { text-align: left; border-bottom: 1px solid #000; padding: 3px 0; font-size: 10px; }
        </style>
      </head>
      <body>
        <div style="text-align: center; font-weight: 900; font-size: 15px;">MUTHUWADIGE HARDWARE</div>
        <div style="text-align: center; font-size: 10px; color: #4b5563;">Negombo | Tel: 077 076 076 7</div>
        <div style="text-align: center; font-weight: 900; font-size: 14px; margin: 8px 0; text-transform: uppercase;">CREDIT NOTE</div>
        <div style="font-size: 11px; margin-bottom: 8px;">
          <div><strong>CN No:</strong> ${cn.creditNoteNo || cn.credit_note_no || cn.id}</div>
          <div><strong>Ref Inv:</strong> ${cn.invoiceNo || cn.invoice_no || 'N/A'}</div>
          <div><strong>Customer:</strong> ${cn.customerName || cn.customer_name || 'Guest'}</div>
          <div><strong>Date:</strong> ${new Date(cn.created_at).toLocaleString()}</div>
        </div>

        ${items.length > 0 ? `
          <table>
            <thead><tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Total</th></tr></thead>
            <tbody>${itemsRows}</tbody>
          </table>
        ` : ''}

        <div style="margin-top: 10px; border-top: 1px solid #000; padding-top: 6px; text-align: right; font-weight: 900; font-size: 14px;">
          Credit Value: ${symbolStr} ${formatNum(cn.amount || cn.value || 0)}
        </div>
      </body>
    </html>
  `;
};

// Premium On-Screen Interactive Preview Component

// Standardized single-execution print dispatcher:
export const safePrintIframe = (htmlContent: string, focusElementAfter?: HTMLElement | null) => {
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

  let hasPrinted = false;
  const triggerPrint = () => {
    if (hasPrinted) return;
    hasPrinted = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.error('Print trigger failed:', err);
    } finally {
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
        focusElementAfter?.focus();
      }, 1000);
    }
  };

  doc.open();
  doc.write(htmlContent);
  doc.close();

  // Single reliable execution hook
  iframe.onload = () => setTimeout(triggerPrint, 150);
  setTimeout(triggerPrint, 600); // Fallback only if onload fails to fire
};

// Export all print template generators and helpers
export {
  generateQuotePrintHTML,
  generateDNPrintHTML,
  generatePrintHTML,
  generateReturnPrintHTML,
  generateCreditNotePrintHTML,
  formatInvoiceDateTime
};
