import React from 'react';
import { useSettings } from '@/context/SettingsContext';
import { calculateEffectiveUnitPricePaid } from '@/utils/accounting';

export interface ReceiptTemplateProps {
  invoice: any;
  isSinhala?: boolean;
}

export const ReceiptTemplate: React.FC<ReceiptTemplateProps> = ({ invoice, isSinhala = false }) => {
  const { settings } = useSettings();

  if (!invoice) return null;

  const rawItems = invoice.items || [];
  const items: any[] = typeof rawItems === 'string' 
    ? (() => { try { return JSON.parse(rawItems); } catch (_) { return []; } })()
    : (Array.isArray(rawItems) ? rawItems : []);

  const totalAmount = Number(
    invoice.totalAmount !== undefined 
      ? invoice.totalAmount 
      : (invoice.total_amount !== undefined 
          ? invoice.total_amount 
          : (invoice.total || 0))
  );

  const subtotal = Number(invoice.subtotal || items.reduce((sum, it) => sum + (Number(it.qty || 1) * Number(it.price || 0)), 0));
  const discount = Number(invoice.discount || 0);
  const tax = Number(invoice.tax || 0);
  const transportFee = Number(invoice.transportation_fee || invoice.transportationFee || 0);
  const customerName = invoice.customerName || invoice.customer_name || 'Guest Customer';
  const invoiceNo = invoice.invoiceNo || invoice.invoice_no || `INV-${Date.now()}`;
  const cashier = invoice.cashier || invoice.cashier_name || invoice.user_name || invoice.created_by || 'Sanoj Hardware';
  const paymentMethod = invoice.payment_method || invoice.paymentMethod || 'Cash';
  const invoiceDate = invoice.created_at || invoice.date || new Date().toISOString();

  const currencySymbol = settings.currency || settings.currency_symbol || 'Rs.';

  return (
    <div className="thermal-receipt font-mono text-slate-900 bg-white p-4 max-w-sm mx-auto text-xs leading-relaxed border border-slate-200 rounded-lg shadow-sm">
      <div className="header text-center space-y-0.5">
        {(settings.logoUrl || settings.logo_path) && (
          <img 
            src={settings.logoUrl || settings.logo_path} 
            alt="Store Logo" 
            className="w-16 h-auto mx-auto mb-1.5 object-contain" 
            onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
          />
        )}
        <h2 className="font-black text-base tracking-wide uppercase text-slate-950">
          {settings.storeName || settings.shop_name || 'Muthuwadige Hardware'}
        </h2>
        <p className="text-[11px] text-slate-600 font-medium leading-tight">
          {settings.address || 'No. 80, Mahahunupitiya, Negombo'}
        </p>
        <p className="text-[11px] text-slate-600 font-medium">
          Tel: {settings.phone || settings.telephone || '077 076 076 7'}
        </p>
        {settings.email && (
          <p className="text-[10px] text-slate-500">{settings.email}</p>
        )}
      </div>

      <div className="divider my-2.5 border-dashed border-b border-slate-300" />

      <div className="text-[11px] space-y-0.5 text-slate-700">
        <div className="flex justify-between">
          <span className="font-bold">Invoice #:</span>
          <span className="font-black">{invoiceNo}</span>
        </div>
        <div className="flex justify-between">
          <span>Date & Time:</span>
          <span>{new Date(invoiceDate).toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span>Customer:</span>
          <span className="font-semibold truncate max-w-[150px]">{customerName}</span>
        </div>
        <div className="flex justify-between">
          <span>Cashier:</span>
          <span>{cashier}</span>
        </div>
        <div className="flex justify-between">
          <span>Payment:</span>
          <span className="font-bold">{paymentMethod}</span>
        </div>
      </div>

      <div className="divider my-2 border-dashed border-b border-slate-300" />

      <table className="w-full text-left text-[11px] mb-2">
        <thead>
          <tr className="border-b border-slate-300 text-slate-500 font-bold uppercase text-[9px]">
            <th className="py-1">Item</th>
            <th className="text-center py-1">Qty</th>
            <th className="text-right py-1">Price</th>
            <th className="text-right py-1">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-dashed divide-slate-200">
          {items.map((it, idx) => {
            const qty = Number(it.qty || 1);
            const price = Number(it.price || 0);
            const lineTotal = Number(it.total !== undefined ? it.total : qty * price);
            const name = it.name || it.productName || it.product_name || `Item ${idx + 1}`;
            return (
              <tr key={idx} className="align-top">
                <td className="py-1 pr-1">
                  <div className="font-semibold text-slate-900">{name}</div>
                  {it.unit && <div className="text-[9px] text-slate-400">Unit: {it.unit}</div>}
                </td>
                <td className="text-center py-1 font-bold">{qty}</td>
                <td className="text-right py-1 font-mono">{price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="text-right py-1 font-bold font-mono">{lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="divider my-2 border-dashed border-b border-slate-300" />

      <div className="text-[11px] space-y-1 text-slate-700">
        <div className="flex justify-between">
          <span>Subtotal:</span>
          <span className="font-mono">{currencySymbol} {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between text-emerald-700 font-semibold">
            <span>Discount:</span>
            <span className="font-mono">-{currencySymbol} {discount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
        )}
        {transportFee > 0 && (
          <div className="flex justify-between">
            <span>Transport:</span>
            <span className="font-mono">{currencySymbol} {transportFee.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
        )}
        {tax > 0 && (
          <div className="flex justify-between">
            <span>Tax:</span>
            <span className="font-mono">{currencySymbol} {tax.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
        )}

        <div className="divider my-1.5 border-dashed border-b border-slate-400" />

        <div className="currency-prefix text-right font-mono flex justify-between items-center text-sm font-black text-slate-950 pt-0.5">
          <span>Total:</span>
          <span>{currencySymbol} {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </div>
      </div>

      <div className="divider my-2.5 border-dashed border-b border-slate-300" />

      <div className="footer text-center text-[10px] text-slate-500 font-medium space-y-0.5">
        <p>{settings.invoice_footer || settings.receiptFooter || settings.footer_text || 'Thank you for your business! Come again.'}</p>
        <p className="text-[9px] text-slate-400">Software by Muthuwadige Hardware ERP</p>
      </div>
    </div>
  );
};

export interface ReturnReceiptTemplateProps {
  returnData: any;
  isSinhala?: boolean;
}

export const ReturnReceiptTemplate: React.FC<ReturnReceiptTemplateProps> = ({ returnData, isSinhala = false }) => {
  const { settings } = useSettings();

  if (!returnData) return null;

  const rawRetItems = returnData.returnedItems || returnData.returned_items || [];
  const returnedItems: any[] = typeof rawRetItems === 'string'
    ? (() => { try { return JSON.parse(rawRetItems); } catch (_) { return []; } })()
    : (Array.isArray(rawRetItems) ? rawRetItems : []);

  const rawExItems = returnData.exchangeItems || returnData.exchange_items || [];
  const exchangeItems: any[] = typeof rawExItems === 'string'
    ? (() => { try { return JSON.parse(rawExItems); } catch (_) { return []; } })()
    : (Array.isArray(rawExItems) ? rawExItems : []);

  const currencySymbol = settings.currency || settings.currency_symbol || 'Rs.';

  const isCreditBill = Boolean(returnData.isCredit || returnData.is_credit);
  const displayMethod = isCreditBill
    ? (exchangeItems.length > 0 ? 'Exchange' : 'Return')
    : (returnData.returnMethod || 'Return');

  const title = displayMethod === 'Exchange'
    ? (isSinhala ? 'භාණ්ඩ හුවමාරු රසීදුව' : 'EXCHANGE RECEIPT')
    : (displayMethod === 'Credit Note' ? (isSinhala ? 'ණය සටහන් රසීදුව' : 'CREDIT NOTE RECEIPT') : (isSinhala ? 'ආපසු භාරගැනීමේ රසීදුව' : 'RETURN RECEIPT'));

  // Calculate return items net totals
  const computedReturnedItems = returnedItems.map((item: any) => {
    const origPrice = Number(item.originalStickerPrice || item.originalUnitPrice || item.price || 0);
    const itemQty = Number(item.qty || item.quantity || 1);
    const { effectivePrice, unitDiscount } = calculateEffectiveUnitPricePaid(item, returnData);
    const netUnitPrice = item.netUnitPrice !== undefined ? Number(item.netUnitPrice) : effectivePrice;
    const unitDisc = item.unitDiscount !== undefined ? Number(item.unitDiscount) : unitDiscount;
    const lineTotal = itemQty * netUnitPrice;
    return {
      ...item,
      name: item.productName || item.name || 'Item',
      sku: item.sku || item.productId || '',
      qty: itemQty,
      origPrice,
      unitDiscount: unitDisc,
      netUnitPrice,
      lineTotal
    };
  });

  const grossReturnTotal = computedReturnedItems.reduce((sum, it) => sum + (it.qty * it.origPrice), 0);
  const totalReturnDiscount = computedReturnedItems.reduce((sum, it) => sum + (it.qty * it.unitDiscount), 0);
  const returnCreditValue = Number(
    returnData.netReturnTotal !== undefined
      ? returnData.netReturnTotal
      : (returnData.returnAmount !== undefined 
          ? returnData.returnAmount 
          : (returnData.totalRefunded || (grossReturnTotal - totalReturnDiscount) || 0))
  );

  const exchangeTotal = Number(
    returnData.exchangeItemsTotal !== undefined
      ? returnData.exchangeItemsTotal
      : (returnData.exchangeAmount !== undefined
          ? returnData.exchangeAmount
          : exchangeItems.reduce((sum, it) => sum + (Number(it.qty || 1) * Number(it.price || it.unitPrice || 0)), 0))
  );

  const priceDifference = exchangeTotal - returnCreditValue;
  const settlementMode = returnData.differencePaymentMethod || returnData.difference_payment_method || returnData.paymentMethod || (isCreditBill ? 'Customer Credit Debt' : 'Cash');

  return (
    <div className="receipt-container thermal-receipt font-mono text-slate-900 bg-white p-4 max-w-sm mx-auto text-xs leading-relaxed border border-slate-200 rounded-lg shadow-sm">
      <div className="header text-center space-y-0.5">
        {(settings.logoUrl || settings.logo_path) && (
          <img 
            src={settings.logoUrl || settings.logo_path} 
            alt="Store Logo" 
            className="w-16 h-auto mx-auto mb-1.5 object-contain" 
            onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
          />
        )}
        <h2 className="font-black text-base tracking-wide uppercase text-slate-950">
          {settings.storeName || settings.shop_name || 'Muthuwadige Hardware'}
        </h2>
        <p className="text-[11px] text-slate-600 font-medium leading-tight">
          {settings.address || 'No. 80, Mahahunupitiya, Negombo'}
        </p>
        <p className="text-[11px] text-slate-600 font-medium">
          Tel: {settings.phone || settings.telephone || '077 076 076 7'}
        </p>
      </div>

      <div className="divider my-2.5 border-dashed border-b border-slate-300" />

      <div className="text-center font-black text-sm uppercase my-1 text-slate-900 border border-slate-300 py-1 bg-slate-50 rounded">
        {title}
      </div>
      <div className="text-[11px] space-y-0.5 text-slate-700 mt-2">
        <div className="flex justify-between">
          <span className="font-bold">Return #:</span>
          <span className="font-black">{returnData.returnNo || returnData.return_no || returnData.id}</span>
        </div>
        <div className="flex justify-between">
          <span>Orig Invoice #:</span>
          <span className="font-semibold">{returnData.invoiceNo || returnData.invoice_no}</span>
        </div>
        <div className="flex justify-between">
          <span>Date & Time:</span>
          <span>{new Date(returnData.created_at || new Date()).toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span>Customer:</span>
          <span className="font-semibold truncate max-w-[150px]">{returnData.customerName || returnData.customer_name || 'Guest Customer'}</span>
        </div>
        <div className="flex justify-between">
          <span>{isSinhala ? 'අයකැමි:' : 'Cashier:'}</span>
          <span className="font-bold">{returnData.cashier || returnData.cashier_name || returnData.user_name || returnData.handled_by || 'Sanoj Hardware'}</span>
        </div>
        <div className="flex justify-between">
          <span>Method:</span>
          <span className="font-bold">{displayMethod}</span>
        </div>
      </div>

      <div className="divider my-2 border-dashed border-b border-slate-300" />

      <div className="section-title font-bold text-rose-700 mb-1">
        {isSinhala ? 'ආපසු භාරගත් භාණ්ඩ:' : 'Returned Item(s)'}
      </div>
      <div className="space-y-1">
        {computedReturnedItems.map((item: any, idx: number) => (
          <div key={item.sku || idx} className="text-xs">
            <div className="flex justify-between font-semibold">
              <span>{item.name} (x{item.qty}{item.unit ? ` ${item.unit}` : ''})</span>
              <span>{currencySymbol} {item.lineTotal.toFixed(2)}</span>
            </div>
            {item.unitDiscount > 0 && (
              <div className="text-[10px] text-rose-600 pl-2">
                {currencySymbol} {item.origPrice.toFixed(2)} - {currencySymbol} {item.unitDiscount.toFixed(2)} disc = {currencySymbol} {item.netUnitPrice.toFixed(2)}/unit
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="divider border-dashed border-b my-2 border-slate-300" />

      {exchangeItems.length > 0 && (
        <>
          <div className="section-title font-bold text-green-700 mb-1">
            {isSinhala ? 'හුවමාරු ලබාදුන් භාණ්ඩ:' : 'Exchange Item(s)'}
          </div>
          <div className="space-y-1">
            {exchangeItems.map((item: any, idx: number) => {
              const qty = Number(item.qty || 1);
              const unitPrice = Number(item.price || item.unitPrice || 0);
              const total = Number(item.total !== undefined ? item.total : qty * unitPrice);
              const name = item.productName || item.name || 'Exchange Item';
              return (
                <div key={item.sku || idx} className="flex justify-between text-xs font-semibold text-emerald-800">
                  <span>⇄ {name} (x{qty}{item.unit ? ` ${item.unit}` : ''})</span>
                  <span>{currencySymbol} {total.toFixed(2)}</span>
                </div>
              );
            })}
          </div>

          <div className="divider border-dashed border-b my-2 border-slate-300" />
        </>
      )}

      <div className="text-xs space-y-1 pt-1 font-mono">
        <div className="flex justify-between">
          <span>{isSinhala ? 'ආපසු වටිනාකම (ශුද්ධ):' : 'Return Credit (Net):'}</span>
          <span className="font-bold">{currencySymbol} {returnCreditValue.toFixed(2)}</span>
        </div>

        {exchangeItems.length > 0 && (
          <>
            <div className="flex justify-between">
              <span>{isSinhala ? 'නව හුවමාරු එකතුව:' : 'Exchange New Total:'}</span>
              <span className="font-bold text-emerald-700">{currencySymbol} {exchangeTotal.toFixed(2)}</span>
            </div>
            
            <div className="divider border-t my-1 border-slate-400" />

            {priceDifference > 0 ? (
              <div className="flex justify-between font-bold text-sm bg-amber-50 border border-amber-200 p-1.5 rounded text-amber-900">
                <span>{isSinhala ? 'පාරිභෝගිකයා අමතරව ගෙවිය යුතු මුදල:' : 'CUSTOMER EXTRA PAYABLE:'}</span>
                <span className="text-amber-700">{currencySymbol} {priceDifference.toFixed(2)}</span>
              </div>
            ) : priceDifference < 0 ? (
              <div className="flex justify-between font-bold text-sm bg-emerald-50 border border-emerald-200 p-1.5 rounded text-emerald-900">
                <span>{isCreditBill ? (isSinhala ? 'ණය සැකසුම:' : 'CREDIT REDUCTION:') : (isSinhala ? 'ආපසු ගෙවිය යුතු මුදල:' : 'STORE REFUND TO CUSTOMER:')}</span>
                <span className="text-emerald-700">{currencySymbol} {Math.abs(priceDifference).toFixed(2)}</span>
              </div>
            ) : (
              <div className="flex justify-between font-bold text-sm bg-slate-100 p-1.5 rounded text-slate-900">
                <span>{isSinhala ? 'ශුද්ධ ශේෂය:' : 'NET BALANCE:'}</span>
                <span>{currencySymbol} 0.00 ({isSinhala ? 'සම ශේෂ හුවමාරුව' : 'Even Exchange'})</span>
              </div>
            )}

            <div className="flex justify-between text-[11px] text-slate-600 italic pt-0.5">
              <span>{isSinhala ? 'පියවීමේ ක්‍රමය:' : 'Settlement Mode:'}</span>
              <span className="font-bold text-slate-800">{settlementMode}</span>
            </div>

            {Number(returnData.customerPaid || 0) > 0 && (
              <div className="flex justify-between text-[11px] pt-0.5">
                <span>{isSinhala ? 'පාරිභෝගිකයා ගෙවූ මුදල:' : 'Customer Paid:'}</span>
                <span className="font-bold">{currencySymbol} {Number(returnData.customerPaid).toFixed(2)}</span>
              </div>
            )}
            {Number(returnData.changeGiven || 0) > 0 && (
              <div className="flex justify-between text-[11px]">
                <span>{isSinhala ? 'ඉතිරි මුදල:' : 'Change Given:'}</span>
                <span className="font-bold">{currencySymbol} {Number(returnData.changeGiven).toFixed(2)}</span>
              </div>
            )}
          </>
        )}

        {exchangeItems.length === 0 && (
          <>
            {returnData.returnMethod === 'Credit Note' ? (
              <div className="flex justify-between font-bold text-amber-700 bg-amber-50 p-1 rounded">
                <span>{isSinhala ? 'ණය සටහන:' : 'Credit Note Issued:'}</span>
                <span>{returnData.creditNoteNo || 'CN-ISSUED'}</span>
              </div>
            ) : returnData.returnMethod === 'Cash Refund' && !isCreditBill ? (
              <div className="flex justify-between font-bold text-rose-700 bg-rose-50 p-1 rounded">
                <span>{isSinhala ? 'ආපසු ගෙවූ මුදල:' : 'Cash Refunded:'}</span>
                <span>{currencySymbol} {returnCreditValue.toFixed(2)}</span>
              </div>
            ) : isCreditBill ? (
              <div className="flex justify-between font-bold text-sky-700 bg-sky-50 p-1 rounded">
                <span>{isSinhala ? 'ණය සැකසුම:' : 'Credit Adjustment:'}</span>
                <span>{currencySymbol} {returnCreditValue.toFixed(2)}</span>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="divider my-2.5 border-dashed border-b border-slate-300" />

      <div className="footer text-center text-[10px] text-slate-500 font-medium space-y-0.5">
        <p>{settings.invoice_footer || settings.receiptFooter || settings.footer_text || 'Thank you for your business! Come again.'}</p>
        <p className="text-[9px] text-slate-400">Software by Muthuwadige Hardware ERP</p>
      </div>
    </div>
  );
};

export default ReceiptTemplate;
