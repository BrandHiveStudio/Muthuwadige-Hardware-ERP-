import { supabase } from '../lib/supabaseClient';
import { API_URL, fetchWithTimeout } from '../lib/api';
import { toSriLankaDateStr } from '../utils/dateTime';

export interface SalesReturnPayload {
  invoice_id?: string;
  invoiceId?: string;
  invoice_no?: string;
  invoiceNo?: string;
  invoiceNumber?: string;
  customer_id?: string;
  customerId?: string;
  customer_name?: string;
  customerName?: string;
  sku?: string;
  productId?: string;
  quantity?: number;
  refund_amount?: number;
  refundAmount?: number;
  return_amount?: number;
  returnAmount?: number;
  returnCreditAmount?: number;
  refund_method?: string;
  returnMethod?: string;
  return_method?: string;
  items?: any[];
  returned_items?: any[];
  returnedItems?: any[];
  selectedReturnItems?: any[];
  exchange_items?: any[];
  exchangeItems?: any[];
  reason?: string;
  userEmail?: string;
  user_email?: string;
  return_no?: string;
  returnNo?: string;
  differencePaymentMethod?: string;
  difference_payment_method?: string;
  settlementMode?: string;
  settlement_mode?: string;
  previousInvoiceBalance?: number;
  previous_invoice_balance?: number;
  originalInvoiceTotal?: number;
  original_invoice_total?: number;
  isCredit?: boolean;
  is_credit?: boolean | number;
}

export interface ExchangeTransactionPayload {
  returnInvoiceId: string;
  returnedSku: string;
  returnedQty: number;
  exchangeSku: string;
  exchangeQty: number;
  customerId: string;
  priceDifference: number;
  userEmail?: string;
}

export interface ReturnSettlementBreakdown {
  cashBankRefundOutflow: number;
  creditDebtAdjustment: number;
}

export function isCreditDebtSettlementMode(mode?: string): boolean {
  const normalized = (mode || '').trim().toLowerCase();
  return (
    normalized === 'customer credit debt' ||
    normalized === 'credit debt' ||
    normalized === 'credit' ||
    normalized === 'credit adjustment' ||
    normalized === 'credit note'
  );
}

export function splitReturnSettlements(
  returns: Array<{
    amount?: number;
    returnAmount?: number;
    return_amount?: number;
    refundAmount?: number;
    refund_amount?: number;
    creditAmount?: number;
    credit_amount?: number;
    total_refunded?: number;
    totalRefunded?: number;
    settlementMode?: string;
    settlement_mode?: string;
    returnMethod?: string;
    return_method?: string;
    refundMethod?: string;
    refund_method?: string;
    differencePaymentMethod?: string;
    difference_payment_method?: string;
    flow_type?: string;
    type?: string;
    payment_method?: string;
    is_credit?: boolean | number;
    isCredit?: boolean | number;
  }>
): ReturnSettlementBreakdown {
  let cashBankRefundOutflow = 0;
  let creditDebtAdjustment = 0;

  for (const ret of returns || []) {
    const rawAmt = Number(
      ret.creditAmount ??
        ret.credit_amount ??
        ret.refundAmount ??
        ret.refund_amount ??
        ret.returnAmount ??
        ret.return_amount ??
        ret.totalRefunded ??
        ret.total_refunded ??
        ret.amount ??
        0
    );
    const amt = Math.max(0, Number.isFinite(rawAmt) ? Math.abs(rawAmt) : 0);
    if (amt === 0) continue;

    const isCreditFlag =
      ret.is_credit === 1 || ret.is_credit === true || ret.isCredit === 1 || ret.isCredit === true;
    const diffMode = (
      ret.differencePaymentMethod ??
      ret.difference_payment_method ??
      ret.settlementMode ??
      ret.settlement_mode ??
      ''
    ).trim();
    const retMethod = (ret.returnMethod ?? ret.return_method ?? ret.refundMethod ?? ret.refund_method ?? '').trim();
    const payMethod = (ret.payment_method ?? '').trim();
    const flowType = (ret.flow_type ?? '').trim();

    const isCreditAdj =
      isCreditFlag ||
      isCreditDebtSettlementMode(diffMode) ||
      isCreditDebtSettlementMode(payMethod) ||
      isCreditDebtSettlementMode(retMethod) ||
      flowType.toUpperCase() === 'CREDIT_ADJUSTMENT';

    if (isCreditAdj) {
      creditDebtAdjustment = Number((creditDebtAdjustment + amt).toFixed(2));
    } else {
      cashBankRefundOutflow = Number((cashBankRefundOutflow + amt).toFixed(2));
    }
  }

  return {
    cashBankRefundOutflow,
    creditDebtAdjustment
  };
}

export async function processSalesReturn(returnPayload: SalesReturnPayload) {
  const invoiceId =
    returnPayload.invoice_id ||
    returnPayload.invoiceId ||
    returnPayload.invoiceNumber ||
    returnPayload.invoiceNo ||
    '';
  const invoiceNo =
    returnPayload.invoice_no ||
    returnPayload.invoiceNo ||
    returnPayload.invoiceNumber ||
    invoiceId;
  const customerId = returnPayload.customer_id || returnPayload.customerId || null;
  const customerName = returnPayload.customer_name || returnPayload.customerName || 'Guest Customer';
  const returnMethod =
    returnPayload.refund_method || returnPayload.returnMethod || returnPayload.return_method || 'Cash Refund';
  const settlementMode =
    returnPayload.differencePaymentMethod ||
    returnPayload.difference_payment_method ||
    returnPayload.settlementMode ||
    returnPayload.settlement_mode ||
    'Cash';
  const returnNo = returnPayload.return_no || returnPayload.returnNo || `RET-${Date.now().toString().slice(-6)}`;
  const timestamp = new Date().toISOString();
  const slDate = toSriLankaDateStr(timestamp);

  const itemsList =
    returnPayload.items ||
    returnPayload.returned_items ||
    returnPayload.returnedItems ||
    returnPayload.selectedReturnItems ||
    (returnPayload.productId
      ? [
          {
            productId: returnPayload.productId,
            sku: returnPayload.sku,
            qty: returnPayload.quantity || 1,
            price: returnPayload.refund_amount || returnPayload.returnAmount || 0
          }
        ]
      : []);

  const retAmount = Number(
    returnPayload.refund_amount !== undefined && returnPayload.refund_amount !== null
      ? returnPayload.refund_amount
      : returnPayload.returnAmount !== undefined
      ? returnPayload.returnAmount
      : returnPayload.returnCreditAmount !== undefined
      ? returnPayload.returnCreditAmount
      : returnPayload.return_amount || 0
  );

  const prevInvoiceBal = Number(returnPayload.previousInvoiceBalance || returnPayload.previous_invoice_balance || 0);

  try {
    try {
      const response = await fetchWithTimeout(
        `${API_URL}/sales/returns`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: `sr_${Date.now()}`,
            returnNo,
            return_no: returnNo,
            invoiceNo,
            invoice_no: invoiceNo,
            invoiceId,
            invoice_id: invoiceId,
            customerId,
            customer_id: customerId,
            customerName,
            customer_name: customerName,
            returnedItems: itemsList,
            items: itemsList,
            exchangeItems: returnPayload.exchange_items || returnPayload.exchangeItems || [],
            returnMethod,
            return_method: returnMethod,
            returnAmount: retAmount,
            return_amount: retAmount,
            returnCreditAmount: retAmount,
            totalRefunded: isCreditDebtSettlementMode(settlementMode) || returnMethod === 'Return' ? 0 : retAmount,
            differencePaymentMethod: settlementMode,
            difference_payment_method: settlementMode,
            settlementMode,
            settlement_mode: settlementMode,
            previousInvoiceBalance: prevInvoiceBal,
            previous_invoice_balance: prevInvoiceBal,
            reason: returnPayload.reason || 'Sales Return',
            userEmail: returnPayload.userEmail || returnPayload.user_email || 'system',
            date: slDate,
            created_at: timestamp
          })
        },
        10000
      );

      if (response.ok) {
        return await response.json();
      }
    } catch (_) {
      // Fallback to direct supabase adapter when backend endpoint is unavailable
    }

    const returnRecord = {
      id: `sr_${Date.now()}`,
      return_no: returnNo,
      invoice_id: invoiceId,
      invoice_no: invoiceNo,
      customer_id: customerId,
      customer_name: customerName,
      sku: returnPayload.sku || '',
      qty_returned:
        returnPayload.quantity ||
        (itemsList.length > 0 ? itemsList.reduce((s: number, i: any) => s + Number(i.qty || 1), 0) : 1),
      returned_items: JSON.stringify(itemsList),
      exchange_items: JSON.stringify(returnPayload.exchange_items || returnPayload.exchangeItems || []),
      return_amount: retAmount,
      refund_amount: retAmount,
      total_refunded: isCreditDebtSettlementMode(settlementMode) || returnMethod === 'Return' ? 0 : retAmount,
      refund_method: returnMethod,
      difference_payment_method: settlementMode,
      previous_invoice_balance: prevInvoiceBal,
      status: 'active',
      reason: returnPayload.reason || 'Sales Return',
      created_at: timestamp
    };

    await supabase.from('sales_returns').insert([returnRecord]);

    const exItems = returnPayload.exchange_items || returnPayload.exchangeItems || [];
    const isExchange = returnMethod === 'Exchange' || exItems.length > 0;
    const refundDiff = Number(returnPayload.refund_amount || 0);
    const isCashSettlement = settlementMode.toLowerCase() === 'cash';

    if (isExchange && refundDiff > 0 && isCashSettlement) {
      const txId = `t_${Date.now()}_ex_ref`;
      const refundDesc = `Exchange Cash Refund for Return #${returnNo} (Invoice #${invoiceNo})`;
      await supabase.from('transactions').insert([
        {
          id: txId,
          type: 'contra_revenue',
          flow_type: 'CONTRA-REVENUE',
          category: 'EXCHANGE REFUND',
          description: refundDesc,
          reference: returnNo || invoiceId,
          amount: -Math.abs(refundDiff),
          date: slDate,
          payment_method: 'CASH',
          status: 'ACTIVE',
          user_id: returnPayload.userEmail || returnPayload.user_email || 'system',
          created_at: timestamp
        }
      ]);
    }

    if (returnPayload.sku) {
      const { data: pList } = await supabase.from('products').select('*').eq('sku', returnPayload.sku);
      if (pList && pList[0]) {
        const prod = pList[0];
        const newStock = Number(prod.stock || 0) + Number(returnPayload.quantity || 1);
        await supabase.from('products').update({ stock: newStock }).eq('id', prod.id);
      }
    } else if (Array.isArray(itemsList)) {
      for (const it of itemsList) {
        const pId = it.productId || it.product_id;
        if (pId) {
          const { data: pList } = await supabase.from('products').select('*').eq('id', pId);
          if (pList && pList[0]) {
            const prod = pList[0];
            const convRate = Number(it.conversionRate) || 1;
            const inc = convRate > 0 ? Number(it.qty || 1) / convRate : Number(it.qty || 1);
            await supabase.from('products').update({ stock: Number(prod.stock || 0) + inc }).eq('id', pId);
          }
        }
      }
    }

    return {
      success: true,
      return_no: returnNo,
      invoice_id: invoiceId
    };
  } catch (e: any) {
    console.error('Failed to process sales return:', e);
    throw e;
  }
}

export async function processReturnAndExchange(payload: ExchangeTransactionPayload) {
  const { data: products } = await supabase.from('products').select('*').eq('sku', payload.exchangeSku);
  const replacementItem = products && products[0];

  if (!replacementItem) {
    throw new Error(`Replacement SKU "${payload.exchangeSku}" not found.`);
  }

  const availableStock = Number(replacementItem.stock || 0);
  if (availableStock < payload.exchangeQty) {
    throw new Error(
      `Insufficient inventory: "${replacementItem.name}" only has ${availableStock} pcs available. Cannot fulfill exchange of ${payload.exchangeQty} pcs.`
    );
  }

  const { data: returnedProdList } = await supabase.from('products').select('*').eq('sku', payload.returnedSku);
  if (returnedProdList && returnedProdList[0]) {
    const retProd = returnedProdList[0];
    await supabase
      .from('products')
      .update({ stock: Number(retProd.stock || 0) + payload.returnedQty })
      .eq('id', retProd.id);
  }

  await supabase
    .from('products')
    .update({ stock: Math.max(0, availableStock - payload.exchangeQty) })
    .eq('id', replacementItem.id);

  const returnRecordId = `RET-${Date.now().toString().slice(-6)}`;
  const nowIso = new Date().toISOString();
  const slDate = toSriLankaDateStr(nowIso);

  await supabase.from('sales_returns').insert([
    {
      id: `sr_${Date.now()}`,
      return_no: returnRecordId,
      invoice_id: payload.returnInvoiceId,
      invoice_no: payload.returnInvoiceId,
      customer_id: payload.customerId,
      returned_sku: payload.returnedSku,
      returned_qty: payload.returnedQty,
      exchange_sku: payload.exchangeSku,
      exchange_qty: payload.exchangeQty,
      price_difference: payload.priceDifference,
      return_method: 'Exchange',
      status: 'active',
      created_at: nowIso
    }
  ]);

  if (payload.priceDifference < 0) {
    const refundAmt = -Math.abs(payload.priceDifference);
    const txId = `t_${Date.now()}_ex_ref`;
    await supabase.from('transactions').insert([
      {
        id: txId,
        type: 'contra_revenue',
        flow_type: 'CONTRA-REVENUE',
        category: 'EXCHANGE REFUND',
        description: `Exchange Cash Refund for Return #${returnRecordId} (Invoice #${payload.returnInvoiceId})`,
        reference: returnRecordId,
        amount: refundAmt,
        date: slDate,
        payment_method: 'CASH',
        status: 'ACTIVE',
        user_id: payload.userEmail || 'system',
        created_at: nowIso
      }
    ]);
  }

  return { success: true, returnNo: returnRecordId };
}

export default {
  processSalesReturn,
  processReturnAndExchange,
  splitReturnSettlements,
  isCreditDebtSettlementMode
};
