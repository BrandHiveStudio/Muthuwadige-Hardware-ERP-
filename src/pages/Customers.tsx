import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  SearchIcon,
  PlusIcon,
  UsersIcon,
  StarIcon,
  EditIcon,
  EyeIcon,
  Trash2Icon,
  Loader2Icon,
  MessageCircle,
  Check,
  DollarSign,
  Printer
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { supabase } from '../lib/supabaseClient';
import { useCurrency } from '../context/CurrencyContext'; // Global currency sync
import type { Customer, SaleOrder } from '../types';

const emptyCustomer: Omit<Customer, 'id'> = {
  name: '',
  phone: '',
  address: '',
  nic: '',
  loyaltyPoints: 0,
  totalPurchases: 0,
  joinDate: new Date().toISOString().split('T')[0]
};

export function Customers() {
  const { currency, exchangeRate = 300 } = useCurrency(); 
  const symbol = 'Rs.';
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawRows = XLSX.utils.sheet_to_json(ws) as any[];

        if (rawRows.length === 0) {
          setToast({ message: "The Excel file contains no records.", type: 'error' });
          return;
        }

        // Strict sheet validation to prevent wrong imports
        const firstRow = rawRows[0];
        const keys = Object.keys(firstRow || {});
        const isWrongSheet = keys.some(key => {
          const lower = key.toLowerCase();
          return lower.includes('sku') || 
                 lower.includes('product') || 
                 lower.includes('cost_price') || 
                 lower.includes('costprice') || 
                 lower.includes('barcode') || 
                 lower.includes('invoice') || 
                 lower.includes('po_number') || 
                 lower.includes('salary') ||
                 lower.includes('staff id');
        });

        if (isWrongSheet) {
          setToast({ 
            message: "Wrong Excel Sheet detected: This spreadsheet contains Product, Staff, or Invoice data. Please upload a valid Customer Loyalty spreadsheet.", 
            type: 'error' 
          });
          return;
        }

        setIsLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setToast({ message: "Session expired.", type: 'error' });
          setIsLoading(false);
          return;
        }

        let imported = 0;
        let errors = 0;

        // Helper to grab values by case-insensitive and punctuation-agnostic key names
        const getValueByKeys = (rowObj: any, possibleKeys: string[]) => {
          const keys = Object.keys(rowObj);
          for (const key of possibleKeys) {
            const matchedKey = keys.find(
              k => k.toLowerCase().replace(/[\s_.-]/g, '') === key.toLowerCase().replace(/[\s_.-]/g, '')
            );
            if (matchedKey && rowObj[matchedKey] !== undefined && rowObj[matchedKey] !== null) {
              return rowObj[matchedKey];
            }
          }
          return '';
        };

        for (const row of rawRows) {
          const name = getValueByKeys(row, ['name', 'customername', 'fullname', 'username', 'customer', 'contactname']).toString().trim();
          const phone = getValueByKeys(row, ['phone', 'phonenumber', 'contactnumber', 'contact', 'mobile', 'mobilenumber']).toString().trim();
          const address = getValueByKeys(row, ['address', 'customeraddress', 'homeaddress', 'location', 'residence', 'addressline1']).toString().trim();
          const nic = getValueByKeys(row, ['nic', 'nicnumber', 'nicno', 'idnumber', 'identitycard', 'nationalid']).toString().trim();
          
          const rawLoyalty = getValueByKeys(row, ['loyaltypoints', 'points', 'loyalty']);
          const loyaltyPoints = parseInt(rawLoyalty) || 0;
          
          const rawPurchases = getValueByKeys(row, ['totalpurchases', 'spend', 'totalspend', 'purchases']);
          const totalPurchases = parseFloat(rawPurchases) || 0;
          
          const rawDate = getValueByKeys(row, ['joindate', 'registereddate', 'date', 'createdat']);
          const joinDate = rawDate ? rawDate.toString().trim() : new Date().toISOString().split('T')[0];

          if (!name) {
            errors++;
            continue;
          }

          const dbPayload = {
            name,
            phone,
            address,
            nic,
            loyalty_points: loyaltyPoints,
            total_purchases: totalPurchases,
            join_date: joinDate,
            user_id: user.id
          };

          const { error } = await supabase.from('customers').insert([dbPayload]);
          if (error) {
            // If email or phone already exists, try updating it by name
            const { error: updateError } = await supabase.from('customers').update(dbPayload).eq('name', name);
            if (updateError) errors++;
            else imported++;
          } else {
            imported++;
          }
        }

        setToast({ message: `Successfully imported ${imported} customer profiles!`, type: 'success' });
        fetchData();
      } catch (err: any) {
        setToast({ message: "Excel parse failed: " + err.message, type: 'error' });
      } finally {
        setIsLoading(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };
  
  // Helper to convert base prices for display
  const convert = (val: number) => val;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [allSales, setAllSales] = useState<SaleOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewCustomer, setViewCustomer] = useState<Customer | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<Omit<Customer, 'id'>>(emptyCustomer);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [shopSettings, setShopSettings] = useState<any>(null);

  // New Credit Ledger State Variables
  const [activeTab, setActiveTab] = useState<'registry' | 'ledger'>('registry');
  const [isSinhala, setIsSinhala] = useState(false);
  const [creditFilter, setCreditFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const t = (en: string, si: string) => isSinhala ? si : en;
  const [settleCustomer, setSettleCustomer] = useState<any | null>(null);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [settleAmount, setSettleAmount] = useState('');
  const [isSettling, setIsSettling] = useState(false);
  const [paymentReceipt, setPaymentReceipt] = useState<{
    customerName: string;
    amountPaid: number;
    invoicesFullySettled: number;
    remainingBalance: number;
    totalWas: number;
    settledInvoices: { invoiceNo: string; amount: number }[];
  } | null>(null);

  const customerBalances = customers.map(customer => {
    const unpaidSales = allSales.filter(s => {
      const statusLower = s.status?.toLowerCase();
      const isUnpaid = s.customer_id === customer.id && 
        (statusLower === 'non paid' || statusLower === 'non-paid' || statusLower === 'pending' || statusLower === 'partially returned' || statusLower === 'fully returned' || !s.status);
      if (!isUnpaid) return false;

      // Filter by selected date range
      const saleDate = s.created_at || s.date || '';
      const dateOnly = saleDate.substring(0, 10); // get YYYY-MM-DD
      
      if (fromDate && dateOnly < fromDate) return false;
      if (toDate && dateOnly > toDate) return false;

      return true;
    });
    const totalOutstanding = unpaidSales.reduce((sum, s) => {
      const invoiceTotal = s.total_amount || s.total || 0;
      const alreadyPaid = s.payment_received || 0;
      return sum + Math.max(0, invoiceTotal - alreadyPaid);
    }, 0);
    return {
      ...customer,
      unpaidSales,
      totalOutstanding
    };
  });

  const creditCustomers = customerBalances.filter(c => c.totalOutstanding > 0);
  
  const totalOutstandingCredit = creditCustomers.reduce((sum, c) => sum + c.totalOutstanding, 0);

  const largestDebtor = creditCustomers.length > 0 
    ? creditCustomers.reduce((max, c) => c.totalOutstanding > max.totalOutstanding ? c : max, creditCustomers[0])
    : null;

  const filteredCreditCustomers = creditCustomers.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search) ||
      c.nic?.toLowerCase().includes(search.toLowerCase());
    
    if (!matchesSearch) return false;
    
    if (creditFilter === 'high') return c.totalOutstanding >= 100000;
    if (creditFilter === 'medium') return c.totalOutstanding >= 10000 && c.totalOutstanding < 100000;
    if (creditFilter === 'low') return c.totalOutstanding < 10000;
    
    return true;
  });

  const getWhatsAppLink = (customer: any) => {
    let cleanPhone = customer.phone ? customer.phone.replace(/[\s_.-]/g, '') : '';
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '94' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('7')) {
      cleanPhone = '94' + cleanPhone;
    } else if (cleanPhone.startsWith('+')) {
      cleanPhone = cleanPhone.substring(1);
    }
    const message = t(
      `Dear ${customer.name}, this is a friendly reminder that you have an outstanding balance of Rs. ${convert(customer.totalOutstanding).toLocaleString()} at Muthuwadige Hardware. Please settle it at your earliest convenience. Thank you!`,
      `හිතවත් ${customer.name}, මුතුවාඩිගේ හාඩ්වෙයාර් හි ඔබගේ නොගෙවූ හිඟ මුදල රු. ${convert(customer.totalOutstanding).toLocaleString()} ක් පියවන මෙන් කාරුණිකව මතක් කර සිටිමු. ස්තූතියි!`
    );
    return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  };

  const handleLumpSumSettle = async () => {
    const enteredAmt = parseFloat(settleAmount);
    if (isNaN(enteredAmt) || enteredAmt <= 0) {
      setToast({ message: t("Please enter a valid amount", "කරුණාකර වලංගු මුදලක් ඇතුළත් කරන්න"), type: 'error' });
      return;
    }

    setIsSettling(true);
    try {
      const sortedUnpaid = [...settleCustomer.unpaidSales].sort((a, b) => {
        return new Date(a.created_at || a.date).getTime() - new Date(b.created_at || b.date).getTime();
      });

      const totalOwed = sortedUnpaid.reduce((s, x) => s + (x.total_amount || x.total || 0) - (x.payment_received || 0), 0);
      
      const amt = enteredAmt;
      
      let remainingToPay = amt;
      const invoicesFullySettled: string[] = [];
      const settledInvoicesInfo: { invoiceNo: string; amount: number }[] = [];

      // Fully settle as many invoices as possible oldest-first
      for (const sale of sortedUnpaid) {
        const saleTotal = sale.total_amount || sale.total || 0;
        const alreadyPaid = sale.payment_received || 0;
        const remainingOnSale = Math.max(0, saleTotal - alreadyPaid);

        if (remainingToPay >= remainingOnSale) {
          invoicesFullySettled.push(sale.id);
          settledInvoicesInfo.push({ invoiceNo: sale.invoice_no || sale.invoiceNo || sale.id, amount: remainingOnSale });
          remainingToPay -= remainingOnSale;
        } else {
          break;
        }
      }

      // Mark fully-settled invoices as Paid
      for (const id of invoicesFullySettled) {
        const sale = sortedUnpaid.find(s => s.id === id);
        const saleTotal = sale ? (sale.total_amount || sale.total || 0) : 0;
        const alreadyPaid = sale ? (sale.payment_received || 0) : 0;
        const paidThisTime = Math.max(0, saleTotal - alreadyPaid);

        await supabase.from('sales').update({ status: 'Paid', payment_received: saleTotal }).eq('id', id);

        // Record income transaction for Cash Book / Finance / Dashboard
        await supabase.from('transactions').insert([{
          id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          type: 'income',
          category: 'Sales Income (Credit Settlement)',
          description: `Credit Settlement for Invoice ${sale?.invoice_no || sale?.invoiceNo || id} (${settleCustomer.name})`,
          amount: paidThisTime,
          date: new Date().toLocaleDateString('sv-SE'),
          reference: sale?.invoice_no || sale?.invoiceNo || id
        }]);

        // Record Credit Payment History log
        await supabase.from('credit_payments').insert([{
          id: 'cp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          sale_id: id,
          invoice_no: sale?.invoice_no || sale?.invoiceNo || id,
          customer_id: settleCustomer.id,
          customer_name: settleCustomer.name,
          amount_paid: paidThisTime,
          remaining_balance: 0,
          payment_method: 'Cash',
          payment_date: new Date().toISOString(),
          recorded_by: 'system'
        }]);
      }

      // If there's remaining money and still unpaid invoices, record partial payment on the next invoice
      const remainingUnpaidAfterFull = sortedUnpaid.filter(s => !invoicesFullySettled.includes(s.id));
      if (remainingToPay > 0 && remainingUnpaidAfterFull.length > 0) {
        const nextInvoice = remainingUnpaidAfterFull[0];
        const nextTotal = nextInvoice.total_amount || nextInvoice.total || 0;
        const alreadyPaid = nextInvoice.payment_received || 0;
        const remainingOnNext = Math.max(0, nextTotal - alreadyPaid);
        const newPaid = alreadyPaid + remainingToPay;

        if (remainingToPay >= remainingOnNext) {
          // Fully covers it
          await supabase.from('sales').update({ status: 'Paid', payment_received: nextTotal }).eq('id', nextInvoice.id);
          settledInvoicesInfo.push({ invoiceNo: nextInvoice.invoice_no || nextInvoice.invoiceNo || nextInvoice.id, amount: remainingOnNext });
          invoicesFullySettled.push(nextInvoice.id);

          await supabase.from('transactions').insert([{
            id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            type: 'income',
            category: 'Sales Income (Credit Settlement)',
            description: `Credit Settlement for Invoice ${nextInvoice.invoice_no || nextInvoice.invoiceNo} (${settleCustomer.name})`,
            amount: remainingOnNext,
            date: new Date().toLocaleDateString('sv-SE'),
            reference: nextInvoice.invoice_no || nextInvoice.invoiceNo
          }]);

          await supabase.from('credit_payments').insert([{
            id: 'cp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            sale_id: nextInvoice.id,
            invoice_no: nextInvoice.invoice_no || nextInvoice.invoiceNo,
            customer_id: settleCustomer.id,
            customer_name: settleCustomer.name,
            amount_paid: remainingOnNext,
            remaining_balance: 0,
            payment_method: 'Cash',
            payment_date: new Date().toISOString(),
            recorded_by: 'system'
          }]);

          remainingToPay = remainingToPay - remainingOnNext;
        } else {
          // Partial payment on this invoice — store partial amount, status remains Non Paid
          await supabase.from('sales').update({ status: 'Non Paid', payment_received: newPaid }).eq('id', nextInvoice.id);
          settledInvoicesInfo.push({ invoiceNo: nextInvoice.invoice_no || nextInvoice.invoiceNo || nextInvoice.id, amount: remainingToPay });

          const remainingBal = Math.max(0, nextTotal - newPaid);

          await supabase.from('transactions').insert([{
            id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            type: 'income',
            category: 'Sales Income (Partial Credit Settlement)',
            description: `Partial Credit Payment for Invoice ${nextInvoice.invoice_no || nextInvoice.invoiceNo} (${settleCustomer.name})`,
            amount: remainingToPay,
            date: new Date().toLocaleDateString('sv-SE'),
            reference: nextInvoice.invoice_no || nextInvoice.invoiceNo
          }]);

          await supabase.from('credit_payments').insert([{
            id: 'cp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            sale_id: nextInvoice.id,
            invoice_no: nextInvoice.invoice_no || nextInvoice.invoiceNo,
            customer_id: settleCustomer.id,
            customer_name: settleCustomer.name,
            amount_paid: remainingToPay,
            remaining_balance: remainingBal,
            payment_method: 'Cash',
            payment_date: new Date().toISOString(),
            recorded_by: 'system'
          }]);

          remainingToPay = 0;
        }
      }

      // Remaining balance after payment
      const newOutstandingBalance = Math.max(0, totalOwed - amt);

      // Show payment receipt (values stored in base currency, UI converts for display)
      setPaymentReceipt({
        customerName: settleCustomer.name,
        amountPaid: amt,
        invoicesFullySettled: invoicesFullySettled.length,
        remainingBalance: newOutstandingBalance,
        totalWas: totalOwed,
        settledInvoices: settledInvoicesInfo,
      });

      setSettleAmount('');
      setSettleCustomer(null);
      fetchData();
    } catch (err: any) {
      setToast({ message: t("Settle failed: ", "පියවීම අසාර්ථක විය: ") + err.message, type: 'error' });
    } finally {
      setIsSettling(false);
    }
  };

  const handlePrintSettleReceipt = (receipt: any) => {
    
    const shopName = shopSettings?.shop_name || 'MUTHUWADIGE HARDWARE';
    const shopAddress = shopSettings?.address || 'No: 80, Mahahunupitiya, Negombo';
    const shopPhone = shopSettings?.phone || '077 076 076 7';
    
    const settledRows = receipt.settledInvoices.map((inv: any) => `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 10px; font-weight: bold; color: #464646; text-align: left;">${inv.invoiceNo}</td>
        <td style="padding: 10px; text-align: right; color: #464646; font-weight: bold;">${symbol} ${convert(inv.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    `).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Credit Settle Receipt - ${receipt.customerName}</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Noto+Sans+Sinhala:wght@400;600;700;800&display=swap" rel="stylesheet">
          <style>
            body {
              font-family: 'Inter', 'Noto Sans Sinhala', sans-serif;
              margin: 0;
              padding: 20px;
              color: #4b5563;
              background: #ffffff;
            }
            .receipt-container {
              max-width: 80mm;
              margin: 0 auto;
              border: 1px solid #e5e7eb;
              padding: 15px;
              border-radius: 8px;
              box-sizing: border-box;
            }
            .header {
              text-align: center;
              border-bottom: 2px dashed #e5e7eb;
              padding-bottom: 15px;
              margin-bottom: 15px;
            }
            .header h1 {
              font-size: 16px;
              margin: 0;
              color: #2c2c2c;
              font-weight: 800;
            }
            .header p {
              font-size: 10px;
              margin: 4px 0 0 0;
              color: #6b7280;
            }
            .title {
              text-align: center;
              font-size: 12px;
              font-weight: 800;
              text-transform: uppercase;
              margin: 10px 0;
              letter-spacing: 1px;
              color: #059669;
            }
            .details-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 11px;
              margin-bottom: 15px;
            }
            .details-table td {
              padding: 4px 0;
            }
            .invoice-table {
              width: 100%;
              border-collapse: collapse;
              font-size: 11px;
              margin-bottom: 15px;
            }
            .invoice-table th {
              border-bottom: 1px solid #4b5563;
              padding: 8px;
              text-align: left;
              font-weight: 800;
              color: #374151;
            }
            .summary-box {
              background: #f9fafb;
              border: 1px solid #f3f4f6;
              border-radius: 6px;
              padding: 8px;
              font-size: 11px;
              margin-bottom: 15px;
            }
            .summary-row {
              display: flex;
              justify-content: space-between;
              padding: 4px 0;
            }
            .summary-row.total {
              font-weight: 800;
              border-top: 1px solid #e5e7eb;
              padding-top: 6px;
              margin-top: 4px;
              font-size: 12px;
              color: #111827;
            }
            .footer {
              text-align: center;
              font-size: 9px;
              color: #9ca3af;
              margin-top: 20px;
              border-top: 1px dashed #e5e7eb;
              padding-top: 10px;
            }
          </style>
        </head>
        <body>
          <div class="receipt-container">
            <div class="header">
              ${shopSettings?.logo_path ? 
                `<img src="${shopSettings.logo_path}" alt="Shop Logo" style="max-width: 50px; max-height: 50px; object-fit: contain; display: block; margin: 0 auto 8px auto;" onerror="this.style.display='none';" />` : 
                `<img src="./images/logo.png" alt="Shop Logo" style="max-width: 50px; max-height: 50px; object-fit: contain; display: block; margin: 0 auto 8px auto;" onerror="this.style.display='none';" />`
              }
              <h1>${shopName}</h1>
              <p>${shopAddress}</p>
              <p>Contact: ${shopPhone}</p>
            </div>
            
            <div class="title">${t('PAYMENT RECEIPT', 'ගෙවීම් රිසිට්පත')}</div>
            
            <table class="details-table">
              <tr>
                <td style="font-weight: bold; color: #6b7280; text-align: left;">${t('Customer:', 'පාරිභෝගිකයා:')}</td>
                <td style="text-align: right; font-weight: bold; color: #111827;">${receipt.customerName}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; color: #6b7280; text-align: left;">${t('Date:', 'දිනය:')}</td>
                <td style="text-align: right; color: #111827;">${new Date().toLocaleDateString()}</td>
              </tr>
            </table>

            <div style="font-size: 10px; font-weight: bold; margin-bottom: 6px; color: #374151; text-align: left;">${t('Settled Invoices', 'පියවූ ඉන්වොයිසි')}</div>
            <table class="invoice-table">
              <thead>
                <tr style="background: #f3f4f6;">
                  <th style="padding: 8px; text-align: left;">${t('Invoice No', 'ඉන්වොයිස් අංකය')}</th>
                  <th style="padding: 8px; text-align: right;">${t('Amount Settle', 'පියවූ මුදල')}</th>
                </tr>
              </thead>
              <tbody>
                ${settledRows}
              </tbody>
            </table>

            <div class="summary-box">
              <div class="summary-row">
                <span>${t('Previous Outstanding:', 'පෙර හිඟය:')}</span>
                <span>${symbol} ${convert(receipt.totalWas).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div class="summary-row" style="font-weight: bold; color: #059669;">
                <span>${t('Amount Paid:', 'ගෙවූ මුදල:')}</span>
                <span>${symbol} ${convert(receipt.amountPaid).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div class="summary-row total" style="color: ${receipt.remainingBalance > 0 ? '#dc2626' : '#059669'}">
                <span>${t('Remaining Balance:', 'ඉතිරි ශේෂය:')}</span>
                <span>${receipt.remainingBalance > 0 ? `${symbol} ${convert(receipt.remainingBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : t('Fully Settled', 'සම්පූර්ණයෙන් පියවා ඇත')}</span>
              </div>
            </div>

            <div class="footer">
              <p>${t('Thank you for your business!', 'ඔබගේ ගනුදෙනුවට ස්තූතියි!')}</p>
              <p>Muthuwadige Hardware</p>
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

  const handleSelectedSettle = async () => {
    if (selectedInvoiceIds.length === 0) {
      setToast({ message: t("Please select at least one invoice", "කරුණාකර අවම වශයෙන් එක් ඉන්වොයිසියක්වත් තෝරන්න"), type: 'error' });
      return;
    }

    setIsSettling(true);
    try {
      const selectedSales = settleCustomer.unpaidSales.filter((s: any) => selectedInvoiceIds.includes(s.id));
      
      const totalPaid = selectedSales.reduce((sum: number, s: any) => {
        const remaining = (s.total_amount || s.total || 0) - (s.payment_received || 0);
        return sum + Math.max(0, remaining);
      }, 0);
      
      const invoicesInfo = selectedSales.map((s: any) => {
        const remaining = (s.total_amount || s.total || 0) - (s.payment_received || 0);
        return {
          invoiceNo: s.invoice_no || s.invoiceNo || s.id,
          amount: Math.max(0, remaining)
        };
      });

      for (const id of selectedInvoiceIds) {
        const sale = selectedSales.find((s: any) => s.id === id);
        const saleTotal = sale ? (sale.total_amount || sale.total || 0) : 0;
        const alreadyPaid = sale ? (sale.payment_received || 0) : 0;
        const paidThisTime = Math.max(0, saleTotal - alreadyPaid);

        await supabase.from('sales').update({ status: 'Paid', payment_received: saleTotal }).eq('id', id);

        // Record income transaction for Cash Book / Finance / Dashboard
        await supabase.from('transactions').insert([{
          id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          type: 'income',
          category: 'Sales Income (Credit Settlement)',
          description: `Credit Settlement for Invoice ${sale?.invoice_no || sale?.invoiceNo || id} (${settleCustomer.name})`,
          amount: paidThisTime,
          date: new Date().toLocaleDateString('sv-SE'),
          reference: sale?.invoice_no || sale?.invoiceNo || id
        }]);

        // Record Credit Payment History log
        await supabase.from('credit_payments').insert([{
          id: 'cp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          sale_id: id,
          invoice_no: sale?.invoice_no || sale?.invoiceNo || id,
          customer_id: settleCustomer.id,
          customer_name: settleCustomer.name,
          amount_paid: paidThisTime,
          remaining_balance: 0,
          payment_method: 'Cash',
          payment_date: new Date().toISOString(),
          recorded_by: 'system'
        }]);
      }

      const allUnpaidTotal = settleCustomer.unpaidSales.reduce((sum: number, s: any) => {
        const remaining = (s.total_amount || s.total || 0) - (s.payment_received || 0);
        return sum + Math.max(0, remaining);
      }, 0);
      
      const remainingBalance = Math.max(0, allUnpaidTotal - totalPaid);

      setPaymentReceipt({
        customerName: settleCustomer.name,
        amountPaid: totalPaid,
        invoicesFullySettled: selectedInvoiceIds.length,
        remainingBalance,
        totalWas: allUnpaidTotal,
        settledInvoices: invoicesInfo,
      });

      setSelectedInvoiceIds([]);
      setSettleCustomer(null);
      fetchData();
    } catch (err: any) {
      setToast({ message: t("Settle failed: ", "පියවීම අසාර්ථක විය: ") + err.message, type: 'error' });
    } finally {
      setIsSettling(false);
    }
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { data: custData } = await supabase
        .from('customers')
        .select('*')
        .order('name', { ascending: true });
      
      const { data: salesData } = await supabase.from('sales').select('*');

      const { data: settingsData } = await supabase.from('system_settings').select('*').single();
      if (settingsData) setShopSettings(settingsData);

      if (custData) {
        const mappedCustomers = custData.map(c => ({
          ...c,
          loyaltyPoints: c.loyalty_points || 0,
          totalPurchases: c.total_purchases || 0,
          joinDate: c.join_date || c.created_at?.split('T')[0]
        }));
        setCustomers(mappedCustomers);
      }
      if (salesData) setAllSales(salesData);
    } catch (error) {
      console.error("Error loading customers:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSettingsOnly = async () => {
    try {
      const { data: settingsData } = await supabase.from('system_settings').select('*').single();
      if (settingsData) setShopSettings(settingsData);
    } catch (e) {}
  };

  useEffect(() => {
    fetchData();
    window.addEventListener('settings-updated', fetchSettingsOnly);
    return () => window.removeEventListener('settings-updated', fetchSettingsOnly);
  }, []);

  const normalCustomers = customers.filter((c) => {
    const balanceInfo = customerBalances.find(cb => cb.id === c.id);
    return balanceInfo ? balanceInfo.totalOutstanding === 0 : true;
  });

  const filtered = normalCustomers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.nic?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search)
  );

  const totalRevenue = customers.reduce((sum, c) => sum + (c.totalPurchases || 0), 0);
  const avgPurchase = customers.length > 0 ? totalRevenue / customers.length : 0;
  const loyaltyMemberCount = customers.filter((customer) => customer.loyaltyPoints > 0).length;
  const topLoyaltyCustomer = customers.reduce((max, c) =>
    (c.loyaltyPoints || 0) > (max?.loyaltyPoints || 0) ? c : max
  , null as Customer | null);

  const relatedCustomerCount = (() => {
    const relatedIds = new Set<string>();
    customers.forEach((customer, index) => {
      const hasMatch = customers.some((other, otherIndex) =>
        otherIndex !== index && (
          (customer.phone && other.phone && customer.phone === other.phone) ||
          (customer.address && other.address && customer.address === other.address) ||
          (customer.nic && other.nic && customer.nic === other.nic)
        )
      );
      if (hasMatch) {
        relatedIds.add(customer.id);
      }
    });
    return relatedIds.size;
  })();

  const openAdd = () => {
    setEditingCustomer(null);
    setFormData(emptyCustomer);
    setShowAddModal(true);
  };

  const openEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({ ...customer });
    setShowAddModal(true);
  };

  const handleSave = async () => {
    // Validations
    if (!formData.name || formData.name.trim().length < 2) {
      setToast({ message: "Customer name must be at least 2 characters.", type: 'error' });
      return;
    }
    
    if (formData.phone && formData.phone.trim() !== '') {
      const phoneClean = formData.phone.trim();
      const slPhoneRegex = /^(?:0|94|\+94)?7[0-9]{8}$/;
      const landlineRegex = /^(?:0|94|\+94)?(?:11|21|23|24|25|26|27|31|32|33|34|35|36|37|38|41|45|47|51|52|54|55|57|63|65|66|67|81|91)[0-9]{7}$/;
      if (!slPhoneRegex.test(phoneClean) && !landlineRegex.test(phoneClean)) {
        setToast({ message: "Invalid contact number format. Use Sri Lankan mobile (e.g. 0771234567) or landline format.", type: 'error' });
        return;
      }
    }

    if (formData.nic && formData.nic.trim() !== '') {
      const nicClean = formData.nic.trim();
      const oldNicRegex = /^[0-9]{9}[vVxX]$/;
      const newNicRegex = /^[0-9]{12}$/;
      if (!oldNicRegex.test(nicClean) && !newNicRegex.test(nicClean)) {
        setToast({ message: "Invalid NIC number. Use 9 digits with V/X (e.g., 991234567V) or 12-digit format.", type: 'error' });
        return;
      }
    }

    if (formData.address && formData.address.trim() !== '' && formData.address.trim().length < 5) {
      setToast({ message: "Street address must be at least 5 characters.", type: 'error' });
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setToast({ message: "Session expired", type: 'error' });
        return;
      }

      const dbPayload = {
        name: formData.name,
        phone: formData.phone,
        address: formData.address,
        nic: formData.nic,
        loyalty_points: formData.loyaltyPoints,
        total_purchases: formData.totalPurchases,
        join_date: formData.joinDate,
        user_id: user.id
      };

      if (editingCustomer) {
        const { error } = await supabase.from('customers').update(dbPayload).eq('id', editingCustomer.id);
        if (error) throw error;
        setToast({ message: "Customer profile updated successfully", type: 'success' });
      } else {
        const { error } = await supabase.from('customers').insert([dbPayload]);
        if (error) throw error;
        setToast({ message: "New customer registered successfully", type: 'success' });
      }

      fetchData();
      setShowAddModal(false);
    } catch (error: any) {
      setToast({ message: "Error saving customer: " + error.message, type: 'error' });
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('customers').delete().eq('id', id);
    if (error) setToast({ message: error.message, type: 'error' });
    else {
      setToast({ message: "Profile permanently deleted", type: 'success' });
      setSelectedCustomerIds((prev) => prev.filter((selectedId) => selectedId !== id));
      fetchData();
    }
    setCustomerToDelete(null);
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selectedCustomerIds.includes(c.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedCustomerIds((prev) => prev.filter((id) => !filtered.some((c) => c.id === id)));
    } else {
      setSelectedCustomerIds((prev) => Array.from(new Set([...prev, ...filtered.map((c) => c.id)])));
    }
  };

  const handleToggleSelectCustomer = (customerId: string) => {
    setSelectedCustomerIds((prev) =>
      prev.includes(customerId)
        ? prev.filter((id) => id !== customerId)
        : [...prev, customerId]
    );
  };

  const handleBulkDelete = async () => {
    if (selectedCustomerIds.length === 0) return;
    (window as any).showConfirm(
      `Are you sure you want to delete the ${selectedCustomerIds.length} selected customer profiles?`,
      async () => {
        setIsLoading(true);
        try {
          const results: any[] = [];
          for (const customerId of selectedCustomerIds) {
            const res = await supabase.from('customers').delete().eq('id', customerId);
            results.push(res);
          }
          const firstError = results.find((r: any) => r?.error);
          if (firstError) throw firstError.error;
          setToast({ message: "Selected profiles permanently deleted", type: 'success' });
          setSelectedCustomerIds([]);
          fetchData();
        } catch (err: any) {
          setToast({ message: "Failed to delete selected profiles: " + err.message, type: 'error' });
        } finally {
          setIsLoading(false);
        }
      },
      "Delete Selected Profiles"
    );
  };

  const handleDeleteAll = async () => {
    if (customers.length === 0) return;
    (window as any).showConfirm(
      "WARNING: Are you sure you want to delete ALL customer profiles? This action is permanent, cannot be undone, and will clear the entire customer database.",
      async () => {
        setIsLoading(true);
        try {
          const results: any[] = [];
          for (const customer of customers) {
            const res = await supabase.from('customers').delete().eq('id', customer.id);
            results.push(res);
          }
          const firstError = results.find((r: any) => r?.error);
          if (firstError) throw firstError.error;
          setToast({ message: "All customer profiles permanently deleted", type: 'success' });
          setSelectedCustomerIds([]);
          fetchData();
        } catch (err: any) {
          setToast({ message: "Failed to delete all profiles: " + err.message, type: 'error' });
        } finally {
          setIsLoading(false);
        }
      },
      "Delete All Profiles"
    );
  };

  const getLoyaltyTier = (points: number) => {
    if (points >= 1000) return { label: 'Gold', color: 'text-yellow-600 bg-yellow-50' };
    if (points >= 500) return { label: 'Silver', color: 'text-slate-600 bg-slate-100' };
    return { label: 'Bronze', color: 'text-amber-700 bg-amber-50' };
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-500">
      {/* Tab Header & Language Toggle */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-100">
        <div className="flex gap-2 p-1 bg-slate-100/80 rounded-xl">
          <button
            onClick={() => setActiveTab('registry')}
            className={`px-5 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
              activeTab === 'registry'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {t("Normal Registered Customers", "පාරිභෝගික ලේඛනය")}
          </button>
          <button
            onClick={() => setActiveTab('ledger')}
            className={`px-5 py-2.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 ${
              activeTab === 'ledger'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {t("Credit Customers", "ණය ලෙජරය")}
            {creditCustomers.length > 0 && (
              <span className="bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full animate-pulse">
                {creditCustomers.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          {/* Bilingual Toggle */}
          <button
            onClick={() => setIsSinhala(!isSinhala)}
            className="flex items-center justify-center gap-2 bg-[#464646]/10 hover:bg-[#464646]/20 text-[#464646] px-4 py-2.5 rounded-xl text-xs font-black transition-all uppercase tracking-widest border border-gray-200 shadow-sm shrink-0"
          >
            {isSinhala ? '🇺🇸 English' : '🇱🇰 සිංහල'}
          </button>
        </div>
      </div>

      {activeTab === 'registry' ? (
        <>
          {/* Registry Stats Cards */}
          <div className="flex flex-col sm:flex-row gap-5">
            {/* Total Customers */}
            <div className="bg-[#464646] rounded-2xl shadow-xl p-5 border border-slate-700/10 hover:translate-y-[-2px] transition-all duration-300 relative overflow-hidden group min-w-[280px]">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-xl group-hover:scale-110 transition-transform duration-500"></div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{t("Total Customers", "මුළු පාරිභෝගිකයින්")}</p>
                  <p className="text-3xl font-black text-white mt-1.5">{normalCustomers.length}</p>
                </div>
                <div className="w-12 h-12 bg-white/10 text-white rounded-xl flex items-center justify-center shadow-lg">
                  <UsersIcon className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
                <span className="w-1.5 h-1.5 rounded-full bg-[#DAA520] animate-ping"></span>
                <span>{t("Active database profiles", "ක්‍රියාකාරී දත්ත සමුදාය")}</span>
              </div>
            </div>
          </div>

          {/* Search & Actions */}
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl border border-slate-700 shadow-xl p-5 flex flex-col md:flex-row gap-4 items-center">
            <div className="flex items-center gap-3 bg-white/10 border border-white/20 rounded-xl px-4 py-3 flex-1 group focus-within:ring-2 focus-within:ring-[#DAA520]/50 transition-all w-full">
              <SearchIcon className="w-4 h-4 text-slate-400 group-focus-within:text-[#DAA520] shrink-0" />
              <input
                type="text"
                placeholder={t("Find customers by name, NIC or phone...", "නම, NIC හෝ දුරකථනය මගින් පාරිභෝගිකයින් සොයන්න...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-sm text-white placeholder:text-slate-400 outline-none w-full font-medium"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end shrink-0">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportExcel}
                className="hidden"
                accept=".xlsx, .xls"
              />
              <button 
                onClick={() => fileInputRef.current?.click()} 
                className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/10 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shrink-0"
              >
                <PlusIcon className="w-4 h-4" /> {t("Import Excel", "Excel ගොනුවක් ඇතුළත් කරන්න")}
              </button>
              <button 
                onClick={openAdd} 
                className="flex items-center justify-center gap-2 bg-[#DAA520] hover:bg-[#B8860B] text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-[#DAA520]/20 shrink-0"
              >
                <PlusIcon className="w-4 h-4" /> {t("Add Member", "සාමාජිකයෙකු එක් කරන්න")}
              </button>
              <button 
                onClick={handleDeleteAll} 
                disabled={customers.length === 0} 
                className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-800 disabled:text-slate-600 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-red-600/20 shrink-0"
              >
                <Trash2Icon className="w-4 h-4" /> {t("Delete All", "සියල්ල මකන්න")}
              </button>
            </div>
          </div>

          {/* Bulk Actions Banner */}
          {selectedCustomerIds.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-center gap-4 animate-in slide-in-from-top-5 duration-300">
              <div className="flex items-center gap-2.5 text-red-800 font-bold text-sm">
                <svg className="w-5 h-5 text-red-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{selectedCustomerIds.length} {t("profile(s) selected for bulk actions", "ගිණුම් ප්‍රමාණයක් තෝරාගෙන ඇත")}</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBulkDelete}
                  className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-xs font-black shadow-lg shadow-red-600/20 transition-all uppercase tracking-widest"
                >
                  <Trash2Icon className="w-4 h-4" /> {t("Delete Selected", "තෝරාගත් ඒවා මකන්න")}
                </button>
              </div>
            </div>
          )}

          {/* Table Section */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden">
            {/* Table Header with gradient */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white">{t('Customer Directory', 'පාරිභෝගික ලැයිස්තුව')}</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{t('Registered database profiles', 'ලියාපදිංචි පාරිභෝගික ගිණුම්')}</p>
              </div>
              <span className="px-3 py-1.5 bg-[#DAA520]/20 text-[#DAA520] text-xs font-black rounded-full border border-[#DAA520]/30">
                {filtered.length} {t('Records', 'වාර්තා')}
              </span>
            </div>
            <div className="overflow-x-auto">
              {isLoading ? (
                <div className="p-20 text-center text-slate-500">
                  <Loader2Icon className="animate-spin w-8 h-8 text-[#DAA520] mx-auto mb-4" />
                  <p className="font-bold">{t("Syncing Customer Profiles...", "පාරිභෝගික ගිණුම් සමමුහුර්ත කරමින්...")}</p>
                </div>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <tr>
                      <th className="px-6 py-4 text-center w-[50px] border-b border-slate-100">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={handleToggleSelectAll}
                          className="rounded border-gray-300 text-[#DAA520] focus:ring-[#DAA520] cursor-pointer w-4 h-4"
                        />
                      </th>
                      <th className="px-6 py-4">{t("Customer", "පාරිභෝගිකයා")}</th>
                      <th className="px-6 py-4">{t("Phone", "දුරකථන අංකය")}</th>
                      <th className="px-6 py-4">{t("NIC", "ජාතික හැඳුනුම්පත් අංකය")}</th>
                      <th className="px-6 py-4">{t("Address", "ලිපිනය")}</th>
                      <th className="px-6 py-4 text-right">{t("Remaining Balance", "හිඟ ණය ශේෂය")}</th>
                      <th className="px-6 py-4 text-center">{t("Actions", "ක්‍රියාකාරකම්")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filtered.map((customer) => {
                      const tier = getLoyaltyTier(customer.loyaltyPoints || 0);
                      const balanceInfo = customerBalances.find(cb => cb.id === customer.id);
                      const balance = balanceInfo ? balanceInfo.totalOutstanding : 0;
                      return (
                        <tr key={customer.id} className="hover:bg-amber-50/30 transition-colors group">
                          <td className="px-6 py-4 text-center">
                            <input
                              type="checkbox"
                              checked={selectedCustomerIds.includes(customer.id)}
                              onChange={() => handleToggleSelectCustomer(customer.id)}
                              className="rounded border-gray-300 text-[#DAA520] focus:ring-[#DAA520] cursor-pointer w-4 h-4"
                            />
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-gradient-to-br from-[#DAA520] to-[#8B6914] rounded-xl flex items-center justify-center text-white font-black text-sm uppercase shadow-md shadow-amber-200">
                                {customer.name.charAt(0)}
                              </div>
                              <div>
                                <p className="font-black text-slate-900">{customer.name}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium text-sm">
                              📞 {customer.phone || '—'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="px-2.5 py-1 bg-slate-100 text-slate-500 text-xs font-bold rounded-lg">
                              {customer.nic || '—'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-slate-500 text-xs font-semibold max-w-[200px] truncate block" title={customer.address}>
                              📍 {customer.address || '—'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right font-black">
                            {balance > 0 ? (
                              <span className="text-red-600">
                                {symbol} {convert(balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            ) : (
                              <span className="text-slate-400 font-bold">—</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => setViewCustomer(customer)}
                                className="p-2.5 rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-200 border border-slate-100 transition-all shadow-sm"
                                title={t("View Profile", "ගිණුම බලන්න")}
                              >
                                <EyeIcon className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => openEdit(customer)}
                                className="p-2.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-200 border border-blue-100 transition-all shadow-sm"
                                title={t("Edit Profile", "ගිණුම සංස්කරණය කරන්න")}
                              >
                                <EditIcon className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setCustomerToDelete(customer)}
                                className="p-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-500 hover:text-white border border-red-100 transition-all shadow-sm shadow-red-500/10"
                                title={t("Delete Profile", "ගිණුම මකන්න")}
                              >
                                <Trash2Icon className="w-4 h-4" />
                              </button>
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
        </>
      ) : (
        <>
          {/* Outstanding Balance Ledger Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {/* Total Receivables */}
            <div className="bg-[#464646] rounded-2xl shadow-xl p-5 border border-slate-700/10 hover:translate-y-[-2px] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-xl group-hover:scale-110 transition-transform duration-500"></div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{t("Total Outstanding Credit", "මුළු හිඟ ණය මුදල")}</p>
                  <p className="text-3xl font-black text-red-500 mt-1.5">{symbol}{convert(totalOutstandingCredit).toLocaleString()}</p>
                </div>
                <div className="w-12 h-12 bg-red-500/10 text-red-500 rounded-xl flex items-center justify-center shadow-lg">
                  <DollarSign className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></span>
                <span>{t("Total receivables pending collection", "එකතු කිරීමට ඇති මුළු හිඟ මුදල් ප්‍රමාණය")}</span>
              </div>
            </div>

            {/* Credit Customers count */}
            <div className="bg-gradient-to-br from-[#DAA520] to-[#B8860B] rounded-2xl shadow-xl p-5 hover:translate-y-[-2px] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-xl group-hover:scale-110 transition-transform duration-500"></div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-white/80 uppercase tracking-widest">{t("Active Debtors", "ක්‍රියාකාරී ණයගැතියන්")}</p>
                  <p className="text-3xl font-black text-white mt-1.5">{creditCustomers.length}</p>
                </div>
                <div className="w-12 h-12 bg-white/20 text-white rounded-xl flex items-center justify-center shadow-lg">
                  <UsersIcon className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-white/90">
                <span>{t("Customers with unpaid credit orders", "නොගෙවූ ණය ඇණවුම් ඇති පාරිභෝගිකයින්")}</span>
              </div>
            </div>

            {/* Largest Debtor */}
            <div className="bg-white rounded-2xl shadow-xl p-5 border border-slate-100 hover:translate-y-[-2px] transition-all duration-300 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#DAA520]/5 rounded-full -mr-16 -mt-16 blur-xl group-hover:scale-110 transition-transform duration-500"></div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("Highest Outstanding", "වැඩිම හිඟ මුදලක් ඇති පාරිභෝගිකයා")}</p>
                  <p className="text-lg font-black text-slate-900 mt-1.5 truncate max-w-[200px]">{largestDebtor ? largestDebtor.name : '—'}</p>
                  <p className="text-sm font-bold text-red-600 mt-0.5">{largestDebtor ? `${symbol}${convert(largestDebtor.totalOutstanding).toLocaleString()}` : ''}</p>
                </div>
                <div className="w-12 h-12 bg-[#DAA520]/10 text-[#DAA520] rounded-xl flex items-center justify-center shadow-lg shadow-[#DAA520]/10">
                  <StarIcon className="w-6 h-6" />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
                <span>{t("Largest debtor profile balance", "විශාලතම ණය ශේෂය")}</span>
              </div>
            </div>
          </div>

          {/* Search Credit Ledger */}
          <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl border border-slate-700 shadow-xl p-5">
            <div className="flex flex-col lg:flex-row gap-3 items-center">
              <div className="flex items-center gap-3 bg-white/10 border border-white/20 rounded-xl px-4 py-3 flex-1 group focus-within:ring-2 focus-within:ring-[#DAA520]/50 transition-all w-full">
                <SearchIcon className="w-4 h-4 text-slate-400 group-focus-within:text-[#DAA520] shrink-0" />
                <input
                  type="text"
                  placeholder={t("Search outstanding ledger by name, NIC or phone...", "නොගෙවූ ණය ලෙජරය සොයන්න...")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="bg-transparent text-sm text-white placeholder:text-slate-400 outline-none w-full font-medium"
                />
              </div>
              <div className="flex flex-col lg:flex-row gap-3 w-full lg:w-auto shrink-0 justify-end items-center">
                {/* Outstanding Credit Amount Filter */}
                <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-xl px-4 py-3 w-full lg:w-auto">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-widest whitespace-nowrap">{t("Filter Amount", "පෙරහන් ප්‍රමාණය")}:</span>
                  <select
                    value={creditFilter}
                    onChange={(e) => setCreditFilter(e.target.value as any)}
                    className="bg-transparent text-sm text-white font-medium outline-none cursor-pointer w-full"
                  >
                    <option value="all" className="text-slate-800">{t("All Outstanding", "සියලුම හිඟ මුදල්")}</option>
                    <option value="high" className="text-slate-800">{t("High (>= Rs. 100,000)", "වැඩි (>= රු. 100,000)")}</option>
                    <option value="medium" className="text-slate-800">{t("Medium (Rs. 10,000 - 100,000)", "මධ්‍යම (රු. 10,000 - 100,000)")}</option>
                    <option value="low" className="text-slate-800">{t("Low (< Rs. 10,000)", "අඩු (< රු. 10,000)")}</option>
                  </select>
                </div>

                {/* Date Filters */}
                <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-xl px-4 py-3 w-full lg:w-auto">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-widest whitespace-nowrap">{t("From", "සිට")}:</span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="bg-transparent text-sm text-white font-medium outline-none cursor-pointer [color-scheme:dark] w-full"
                  />
                </div>
                <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-xl px-4 py-3 w-full lg:w-auto">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-widest whitespace-nowrap">{t("To", "දක්වා")}:</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="bg-transparent text-sm text-white font-medium outline-none cursor-pointer [color-scheme:dark] w-full"
                  />
                </div>
                {(fromDate || toDate) && (
                  <button
                    onClick={() => { setFromDate(''); setToDate(''); }}
                    className="px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded-xl text-xs font-bold transition-all uppercase tracking-wider shrink-0 w-full lg:w-auto"
                  >
                    {t("Clear", "පැහැදිලි කරන්න")}
                  </button>
                )}

                <div className="flex items-center gap-2 text-xs text-slate-400 font-bold uppercase tracking-wider shrink-0 bg-white/5 border border-white/10 rounded-xl px-4 py-3.5 w-full lg:w-auto justify-center">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                  <span>{filteredCreditCustomers.length} {t('Active Debtors', 'ක්‍රියාකාරී ණයගැතියන්')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Credit Table Section - Premium Redesign */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden">
            {/* Table Header with gradient */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white">{t('Credit Outstanding Ledger', 'ණය හිඟ ලෙජරය')}</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{t('Customers with unpaid balances', 'නොගෙවූ ශේෂ ඇති පාරිභෝගිකයින්')}</p>
              </div>
              <span className="px-3 py-1.5 bg-red-500/20 text-red-400 text-xs font-black rounded-full border border-red-500/30">
                {filteredCreditCustomers.length} {t('Records', 'වාර්තා')}
              </span>
            </div>
            <div className="overflow-x-auto">
              {isLoading ? (
                <div className="p-20 text-center text-slate-500">
                  <Loader2Icon className="animate-spin w-8 h-8 text-[#DAA520] mx-auto mb-4" />
                  <p className="font-bold">{t("Syncing Credit Ledger...", "ණය ලෙජරය සමමුහුර්ත කරමින්...")}</p>
                </div>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <tr>
                      <th className="px-6 py-4">{t("Customer", "පාරිභෝගිකයා")}</th>
                      <th className="px-6 py-4">{t("Phone", "දුරකථන අංකය")}</th>
                      <th className="px-6 py-4">{t("NIC", "ජාතික හැඳුනුම්පත් අංකය")}</th>
                      <th className="px-6 py-4 text-center">{t("Unpaid Invoices", "නොගෙවූ ඉන්වොයිසි")}</th>
                      <th className="px-6 py-4 text-right">{t("Balance Due", "ගෙවීමට ඇති ශේෂය")}</th>
                      <th className="px-6 py-4 text-center">{t("Actions", "ක්‍රියාකාරකම්")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredCreditCustomers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-16 font-bold text-slate-400 text-sm">
                          <div className="flex flex-col items-center gap-3">
                            <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center">
                              <Check className="w-8 h-8 text-emerald-400" />
                            </div>
                            <p className="font-black text-slate-500">{t("All Clear! No outstanding credit balances.", "සියල්ල හොඳයි! ගෙවීමට ඇති හිඟ ණය ශේෂයන් කිසිවක් නැත.")}</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredCreditCustomers.map((customer) => {
                        return (
                          <tr key={customer.id} className="hover:bg-amber-50/30 transition-colors group">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-gradient-to-br from-red-400 to-red-600 rounded-xl flex items-center justify-center text-white font-black text-sm uppercase shadow-md shadow-red-200">
                                  {customer.name.charAt(0)}
                                </div>
                                <div>
                                  <p className="font-black text-slate-900">{customer.name}</p>
                                  <p className="text-[10px] text-slate-400 font-semibold">{customer.unpaidSales.length} {t('unpaid orders', 'නොගෙවූ ඇණවුම්')}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium text-sm">
                                📞 {customer.phone || '—'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="px-2.5 py-1 bg-slate-100 text-slate-500 text-xs font-bold rounded-lg">
                                {customer.nic || '—'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <span className="inline-flex items-center justify-center w-8 h-8 bg-red-500 text-white text-sm font-black rounded-full shadow-md shadow-red-200">
                                {customer.unpaidSales.length}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div>
                                <p className="font-black text-red-600 text-base">{symbol}{convert(customer.totalOutstanding).toLocaleString()}</p>
                                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{t('Remaining Balance', 'ඉතිරි ශේෂය')}</p>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => {
                                    setSettleCustomer(customer);
                                    setSelectedInvoiceIds([]);
                                    setSettleAmount('');
                                  }}
                                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#DAA520] hover:bg-[#B8860B] text-white transition-all shadow-md shadow-[#DAA520]/10"
                                >
                                  <DollarSign className="w-3.5 h-3.5" />
                                  <span className="text-xs font-black uppercase tracking-wider">{t("Settle Credit", "ණය පියවන්න")}</span>
                                </button>
                                <button
                                  onClick={() => window.open(getWhatsAppLink(customer), '_blank')}
                                  className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white transition-all border border-emerald-100 shadow-sm"
                                  title={t("Send WhatsApp Reminder", "WhatsApp මතක් කිරීමක් යවන්න")}
                                >
                                  <MessageCircle className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {/* Add/Edit Modal - Premium Redesign */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="" size="lg">
        <div className="-mt-2">
          {/* Gradient Modal Header */}
          <div className={`rounded-2xl p-6 mb-5 relative overflow-hidden ${editingCustomer ? 'bg-gradient-to-br from-blue-600 to-blue-800' : 'bg-gradient-to-br from-[#DAA520] to-[#8B6914]'}`}>
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10 blur-xl" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-black/10 rounded-full -ml-8 -mb-8 blur-xl" />
            <div className="relative flex items-center gap-4">
              <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center shadow-lg">
                <UsersIcon className="w-7 h-7 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-black text-white">
                  {editingCustomer ? t('Update Member Profile', 'සාමාජික ගිණුම යාවත්කාලීන කරන්න') : t('Register New Member', 'නව සාමාජිකයෙකු ලියාපදිංචි කරන්න')}
                </h2>
                <p className="text-white/70 text-xs font-semibold mt-0.5">
                  {editingCustomer ? t('Edit customer details below', 'පාරිභෝගික තොරතුරු සංස්කරණය කරන්න') : t('Fill in the details to register a new customer', 'නව සාමාජිකයෙකු ලියාපදිංචි කිරීමට විස්තර ඇතුළත් කරන්න')}
                </p>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4 px-1">
            {/* Name - Full width with highlight */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 hover:border-[#DAA520]/40 transition-all">
              <label className="block text-[10px] font-black text-[#DAA520] uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#DAA520]"></span>
                {t("Customer Name", "පාරිභෝගික නම")} *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t("e.g. Sunil Perera", "e.g. සුනිල් පෙරේරා")}
                className="w-full bg-white px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-[#DAA520]/30 focus:border-[#DAA520] outline-none transition-all placeholder:text-slate-300"
                required
              />
            </div>

            {/* Phone + NIC side by side */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 hover:border-emerald-300/60 transition-all">
                <label className="block text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  {t("Contact Number", "දුරකථන අංකය")}
                </label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="077 123 4567"
                  className="w-full bg-white px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-300/30 focus:border-emerald-400 transition-all placeholder:text-slate-300"
                />
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 hover:border-blue-300/60 transition-all">
                <label className="block text-[10px] font-black text-blue-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                  {t("NIC Number", "ජාතික හැඳුනුම්පත් අංකය")}
                </label>
                <input
                  type="text"
                  value={formData.nic || ''}
                  onChange={(e) => setFormData({ ...formData, nic: e.target.value })}
                  placeholder="991234567V or 199912345678"
                  className="w-full bg-white px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-300/30 focus:border-blue-400 transition-all placeholder:text-slate-300"
                />
              </div>
            </div>

            {/* Address */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 hover:border-purple-300/60 transition-all">
              <label className="block text-[10px] font-black text-purple-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                {t("Street Address", "ලිපිනය")}
              </label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder={t("No. 80, Mahahunupitiya, Negombo", "අංක 80, මහහුනුපිටිය, මීගමුව")}
                className="w-full bg-white px-4 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-purple-300/30 focus:border-purple-400 transition-all placeholder:text-slate-300"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-500 font-black uppercase tracking-widest text-xs rounded-xl transition-all border border-slate-200"
              >
                {t("Cancel", "අවලංගු කරන්න")}
              </button>
              <button
                onClick={handleSave}
                className={`flex-1 py-3.5 font-black uppercase tracking-widest text-xs rounded-xl text-white transition-all shadow-lg ${editingCustomer ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-200' : 'bg-gradient-to-r from-[#DAA520] to-[#B8860B] hover:from-[#B8860B] hover:to-[#8B6914] shadow-amber-200'}`}
              >
                {editingCustomer ? t('💾 Save Changes', '💾 වෙනස්කම් සුරකින්න') : t('✅ Confirm Registration', '✅ ලියාපදිංචිය තහවුරු කරන්න')}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* View Customer Details Modal */}
      <Modal isOpen={!!viewCustomer} onClose={() => setViewCustomer(null)} title={t("Member Insights", "සාමාජික විස්තර")} size="lg">
        {viewCustomer && (
          <div className="space-y-8 p-1">
            <div className="flex items-center gap-5 bg-slate-50 p-6 rounded-[32px] border border-slate-100 shadow-inner">
              <div className="w-20 h-20 bg-orange-500 rounded-[24px] flex items-center justify-center text-white font-black text-3xl uppercase shadow-xl shadow-orange-200">
                {viewCustomer.name.charAt(0)}
              </div>
              <div>
                <h3 className="text-2xl font-black text-slate-900">{viewCustomer.name}</h3>
                <p className="text-xs font-bold text-slate-400 mt-2">{t("Customer Profile", "පාරිභෝගික ගිණුම")}</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-8 text-sm">
              <div className="space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("Contact Info", "දුරකථන අංකය")}</p>
                <p className="font-bold text-slate-700">{viewCustomer.phone || 'N/A'}</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("NIC Number", "ජාතික හැඳුනුම්පත් අංකය")}</p>
                <p className="font-bold text-slate-700">{viewCustomer.nic || 'N/A'}</p>
              </div>
              <div className="col-span-2 space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("Delivery Address", "ලිපිනය")}</p>
                <p className="font-bold text-slate-700">{viewCustomer.address || t('Not provided', 'සපයා නැත')}</p>
              </div>
              <div className="bg-slate-900 p-8 rounded-[40px] col-span-2 flex justify-between items-center shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-full -mr-16 -mt-16 blur-2xl"></div>
                <span className="text-slate-400 font-black uppercase tracking-widest text-xs">{t("Total Lifetime Commitment", "මුළු ජීවිත කාලය පුරාම මිලදී ගැනීම්")}</span>
                <span className="text-4xl font-black text-orange-500 drop-shadow-lg">{symbol}{convert(viewCustomer.totalPurchases).toLocaleString()}</span>
              </div>
            </div>

            <div>
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 border-b pb-2">{t("Archival Sales History", "පසුගිය විකුණුම් ඉතිහාසය")}</h4>
              <div className="space-y-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                {allSales.filter(o => o.customer_id === viewCustomer.id).map((order) => (
                  <div key={order.id} className="flex items-center justify-between p-5 border border-slate-100 rounded-3xl text-sm bg-slate-50/30 hover:bg-white hover:shadow-md transition-all">
                    <div>
                      <p className="font-black text-slate-900">{order.invoice_no}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">{order.created_at ? new Date(order.created_at).toLocaleDateString() : 'N/A'}</p>
                    </div>
                    <p className="text-lg font-black text-slate-900">{symbol}{convert(order.total_amount || 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => setViewCustomer(null)} className="w-full py-4 bg-slate-100 text-slate-500 rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-slate-200 transition-all">{t("Close Profile View", "වසා දමන්න")}</button>
          </div>
        )}
      </Modal>

      {/* Premium Deletion Confirmation Modal */}
      <Modal isOpen={!!customerToDelete} onClose={() => setCustomerToDelete(null)} title={t("Delete Profile", "ගිණුම මකන්න")} size="sm">
        {customerToDelete && (
          <div className="text-center p-2 space-y-4">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto border border-red-100 shadow-inner">
              <Trash2Icon className="w-8 h-8" />
            </div>
            <div>
              <h4 className="font-black text-slate-800 text-lg">{t("Remove Profile?", "ගිණුම ඉවත් කරන්නද?")}</h4>
              <p className="text-xs text-gray-500 font-bold mt-1.5 leading-relaxed">
                {t(`Are you sure you want to permanently delete `, `ඔබ ස්ථිරවම මකා දැමීමට කැමතිද `)}<span className="text-[#DAA520]">{customerToDelete.name}</span>? {t(`This action is irreversible and all associated data will be removed.`, `මෙම ක්‍රියාව ආපසු හැරවිය නොහැකි අතර සියලුම අදාළ දත්ත ඉවත් කරනු ඇත.`)}
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button 
                onClick={() => setCustomerToDelete(null)} 
                className="flex-1 py-3 bg-[#464646] hover:bg-[#363636] text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-md"
              >
                {t("Cancel", "අවලංගු කරන්න")}
              </button>
              <button 
                onClick={() => handleDelete(customerToDelete.id)} 
                className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-red-500/20"
              >
                {t("Delete", "මකන්න")}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Settle Credit Modal */}
      <Modal isOpen={!!settleCustomer} onClose={() => { setSettleCustomer(null); setSelectedInvoiceIds([]); setSettleAmount(''); }} title={settleCustomer ? t(`Settle Credit - ${settleCustomer.name}`, `ණය පියවීම - ${settleCustomer.name}`) : ''} size="lg">
        {settleCustomer && (
          <div className="space-y-6 p-1">
            {/* Header info */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("Total Outstanding Due", "මුළු ගෙවීමට ඇති හිඟ මුදල")}</p>
                <p className="text-3xl font-black text-red-600 mt-1">{symbol}{convert(settleCustomer.totalOutstanding).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("Unpaid Invoices", "නොගෙවූ ඉන්වොයිසි ප්‍රමාණය")}</p>
                <p className="text-lg font-black text-slate-800 mt-1">{settleCustomer.unpaidSales.length} {t("Invoices", "ඉන්වොයිසි")}</p>
              </div>
            </div>

            {/* Split methods: Lump Sum vs Select Invoices */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Option A: Lump Sum payment */}
              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b pb-2 flex items-center gap-2">
                  <span className="w-5 h-5 bg-[#DAA520]/10 text-[#DAA520] rounded-full flex items-center justify-center text-[10px]">1</span>
                  {t("Lump Sum Payment", "එකවර ගෙවීම")}
                </h4>
                <p className="text-xs text-slate-500 font-bold leading-relaxed">
                  {t("Enter amount to pay off the oldest outstanding invoices sequentially.", "පැරණිතම නොගෙවූ ඉන්වොයිසි අනුපිළිවෙලින් පියවීම සඳහා මුදල ඇතුළත් කරන්න.")}
                </p>
                <div className="space-y-3">
                  <div className="relative flex items-center bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus-within:ring-2 focus-within:ring-[#DAA520]/20 transition-all">
                    <span className="text-slate-400 font-bold text-sm mr-1">{symbol}</span>
                    <input
                      type="number"
                      placeholder={t("Enter payment amount...", "ගෙවන මුදල...")}
                      value={settleAmount}
                      onChange={(e) => setSettleAmount(e.target.value)}
                      className="bg-transparent text-sm font-bold text-slate-700 outline-none w-full"
                    />
                  </div>
                  <button
                    onClick={handleLumpSumSettle}
                    disabled={isSettling}
                    className="w-full flex items-center justify-center gap-2 bg-[#DAA520] hover:bg-[#B8860B] disabled:bg-slate-200 text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-[#DAA520]/20"
                  >
                    {isSettling ? (
                      <Loader2Icon className="animate-spin w-4 h-4" />
                    ) : (
                      <>
                        <DollarSign className="w-4 h-4" />
                        {t("Apply Lump Sum", "ගෙවීම ඇතුළත් කරන්න")}
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Option B: Specific Invoices */}
              <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-900 border-b pb-2 flex items-center gap-2">
                  <span className="w-5 h-5 bg-[#464646]/10 text-[#464646] rounded-full flex items-center justify-center text-[10px]">2</span>
                  {t("Settle Specific Invoices", "විශේෂිත ඉන්වොයිසි තෝරා පියවීම")}
                </h4>
                <p className="text-xs text-slate-500 font-bold leading-relaxed">
                  {t("Select individual invoices below to settle them in full.", "සම්පූර්ණයෙන්ම පියවීම සඳහා පහත ලැයිස්තුවෙන් ඉන්වොයිසි තෝරන්න.")}
                </p>
                <div className="space-y-3">
                  <div className="p-2 border border-slate-100 bg-slate-50/50 rounded-xl text-xs space-y-1">
                    <div className="flex justify-between font-bold text-slate-500">
                      <span>{t("Selected Count:", "තෝරාගත් ප්‍රමාණය:")}</span>
                      <span>{selectedInvoiceIds.length}</span>
                    </div>
                    <div className="flex justify-between font-black text-slate-800 text-sm">
                      <span>{t("Total Selected:", "තෝරාගත් මුළු එකතුව:")}</span>
                      <span>{symbol}{convert(
                        settleCustomer.unpaidSales
                          .filter((s: any) => selectedInvoiceIds.includes(s.id))
                          .reduce((sum: number, s: any) => sum + (s.total_amount || s.total || 0), 0)
                      ).toLocaleString()}</span>
                    </div>
                  </div>
                  <button
                    onClick={handleSelectedSettle}
                    disabled={isSettling || selectedInvoiceIds.length === 0}
                    className="w-full flex items-center justify-center gap-2 bg-[#464646] hover:bg-[#363636] disabled:bg-slate-200 text-white py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg"
                  >
                    {isSettling ? (
                      <Loader2Icon className="animate-spin w-4 h-4" />
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        {t("Settle Selected", "තෝරාගත් ඒවා පියවන්න")}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* List of Unpaid Invoices */}
            <div>
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 border-b pb-2">
                {t("Unpaid Invoices List", "නොගෙවූ ඉන්වොයිසි ලැයිස්තුව")}
              </h4>
              <div className="space-y-2.5 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                {settleCustomer.unpaidSales.map((sale: any) => {
                  const isChecked = selectedInvoiceIds.includes(sale.id);
                  // Robust date parsing with multiple fallbacks
                  const rawDate = sale.created_at || sale.date || sale.createdAt || sale.order_date || '';
                  let displayDate = '—';
                  if (rawDate) {
                    try {
                      const d = new Date(rawDate);
                      if (!isNaN(d.getTime())) {
                        displayDate = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                      } else {
                        displayDate = rawDate.toString().split('T')[0];
                      }
                    } catch { displayDate = rawDate.toString().split('T')[0]; }
                  }
                  return (
                    <div
                      key={sale.id}
                      onClick={() => {
                        setSelectedInvoiceIds(prev =>
                          prev.includes(sale.id) ? prev.filter(i => i !== sale.id) : [...prev, sale.id]
                        );
                      }}
                      className={`flex items-center justify-between p-4 border rounded-xl text-sm cursor-pointer hover:bg-slate-50 transition-all ${
                        isChecked ? 'border-[#DAA520] bg-[#DAA520]/5 shadow-sm' : 'border-slate-100 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // Controlled by wrapper div onClick
                          className="rounded border-gray-300 text-[#DAA520] focus:ring-[#DAA520] cursor-pointer w-4 h-4"
                        />
                        <div>
                          <p className="font-black text-slate-900">{sale.invoiceNo || sale.invoice_no}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">
                            📅 {displayDate}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-slate-900">
                          {sale.payment_received && sale.payment_received > 0 ? (
                            <div>
                              <span className="text-[10px] text-slate-400 line-through mr-1.5">{symbol}{convert(sale.total_amount || sale.total || 0).toLocaleString()}</span>
                              <span>{symbol}{convert((sale.total_amount || sale.total || 0) - sale.payment_received).toLocaleString()}</span>
                            </div>
                          ) : (
                            <span>{symbol}{convert(sale.total_amount || sale.total || 0).toLocaleString()}</span>
                          )}
                        </div>
                        <span className="inline-block text-[9px] font-black uppercase text-red-500 bg-red-50 px-2 py-0.5 rounded mt-1">
                          {t("Unpaid", "නොගෙවූ")}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => { setSettleCustomer(null); setSelectedInvoiceIds([]); setSettleAmount(''); }}
              className="w-full py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl font-black uppercase tracking-widest text-xs transition-all"
            >
              {t("Close Window", "වසා දමන්න")}
            </button>
          </div>
        )}
      </Modal>

      {/* Payment Receipt Modal */}
      {paymentReceipt && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200] p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-300">
            {/* Header */}
            <div className="bg-gradient-to-br from-emerald-500 to-emerald-700 p-6 text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10 blur-xl" />
              <div className="relative flex items-center gap-4">
                <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center border border-white/30 shadow-lg">
                  <Check className="w-7 h-7 text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-100">{t('Payment Confirmed', 'ගෙවීම තහවුරු කරන ලදී')}</p>
                  <h2 className="text-xl font-black text-white leading-tight">{paymentReceipt.customerName}</h2>
                </div>
              </div>
            </div>

            {/* Receipt Body */}
            <div className="p-6 space-y-4">
              {/* Amount Paid */}
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 flex justify-between items-center">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600">{t('Amount Paid', 'ගෙවූ මුදල')}</p>
                  <p className="text-2xl font-black text-emerald-700 mt-0.5">{symbol} {convert(paymentReceipt.amountPaid).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-md shadow-emerald-300">
                  <DollarSign className="w-6 h-6 text-white" />
                </div>
              </div>

              {/* Invoices Settled */}
              {paymentReceipt.settledInvoices.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-1">{t('Invoices Settled', 'පියවූ ඉන්වොයිසි')}</p>
                  {paymentReceipt.settledInvoices.map((inv, i) => (
                    <div key={i} className="flex justify-between items-center px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-100">
                      <span className="text-xs font-black text-slate-600">{inv.invoiceNo}</span>
                      <span className="text-xs font-black text-slate-800">{symbol} {convert(inv.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Remaining Balance */}
              <div className={`rounded-2xl p-4 flex justify-between items-center border ${paymentReceipt.remainingBalance > 0 ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-100'}`}>
                <div>
                  <p className={`text-[9px] font-black uppercase tracking-widest ${paymentReceipt.remainingBalance > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                    {t('Remaining Balance', 'ඉතිරි ශේෂය')}
                  </p>
                  <p className={`text-xl font-black mt-0.5 ${paymentReceipt.remainingBalance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {paymentReceipt.remainingBalance > 0
                      ? `${symbol} ${convert(paymentReceipt.remainingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : t('✓ Fully Settled', '✓ සම්පූර්ණයෙන් පියවා ඇත')}
                  </p>
                </div>
                {paymentReceipt.remainingBalance > 0 && (
                  <span className="text-[9px] font-black uppercase bg-red-500 text-white px-3 py-1.5 rounded-xl shadow-sm shadow-red-200">
                    {t('Still Owes', 'තවමත් හිඟයි')}
                  </span>
                )}
              </div>

              {/* Summary line */}
              <div className="flex justify-between text-xs text-slate-400 font-bold px-1 pt-1 border-t border-slate-100">
                <span>{t('Total outstanding was', 'මුළු හිඟ මුදල')}</span>
                <span>{symbol} {convert(paymentReceipt.totalWas).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>

              {/* Receipt Action Buttons */}
              <div className="flex gap-3 mt-2">
                <button
                  onClick={() => handlePrintSettleReceipt(paymentReceipt)}
                  className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  <Printer className="w-4.5 h-4.5" />
                  {t('Print', 'මුද්‍රණය')}
                </button>
                <button
                  onClick={() => setPaymentReceipt(null)}
                  className="flex-1 py-3.5 bg-gradient-to-r from-[#DAA520] to-[#B8860B] hover:brightness-110 text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-[#DAA520]/20"
                >
                  {t('Done', 'හරි')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Premium Toast Notification */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className={`flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl border backdrop-blur-md ${
            toast.type === 'success' 
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' 
              : 'bg-red-500/10 border-red-500/20 text-red-600'
          }`}>
            {toast.type === 'success' ? (
              <div className="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/30">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            ) : (
              <div className="w-8 h-8 rounded-xl bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-500/30">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            )}
            <div>
              <p className="text-xs font-black uppercase tracking-wider opacity-60">
                {toast.type === 'success' ? t('Operation Success', 'සාර්ථකයි') : t('System Notice', 'පද්ධති දැනුම්දීම')}
              </p>
              <p className="text-sm font-bold text-slate-800 mt-0.5">{toast.message}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}