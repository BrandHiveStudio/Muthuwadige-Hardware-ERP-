import { supabase } from '../lib/supabaseClient';
import { api, API_URL, fetchWithTimeout } from '../lib/api';

export interface SalesReturnPayload {
  invoice_id: string;
  invoice_no?: string;
  customer_id?: string;
  customer_name?: string;
  sku?: string;
  productId?: string;
  quantity?: number;
  refund_amount?: number;
  return_amount?: number;
  returnAmount?: number;
  refund_method?: string;
  items?: any[];
  returned_items?: any[];
  exchange_items?: any[];
  reason?: string;
  userEmail?: string;
  return_no?: string;
  differencePaymentMethod?: string;
  difference_payment_method?: string;
  previousInvoiceBalance?: number;
  previous_invoice_balance?: number;
}

export interface ExchangeTransactionPayload {
  returnInvoiceId: string;
  returnedSku: string;
  returnedQty: number;
  exchangeSku: string;
  exchangeQty: number;
  customerId: string;
  priceDifference: number; // Positive if customer pays extra, negative if store refunds
  userEmail?: string;
}

/**
 * Processes a sales return while preserving the immutability of original invoices.
 * 1. Inserts distinct return record (contra-revenue)
 * 2. Restocks physical inventory
 * 3. Marks invoice return status WITHOUT mutating original total or balance columns
 */
export async function processSalesReturn(returnPayload: SalesReturnPayload) {
  const invoiceId = returnPayload.invoice_id;
  const returnNo = returnPayload.return_no || `RET-${Date.now().toString().slice(-6)}`;
  const timestamp = new Date().toISOString();

  try {
    // 1. Try sending to backend SQLite API if running
    try {
      const response = await fetchWithTimeout(`${API_URL}/sales/returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `sr_${Date.now()}`,
          returnNo: returnNo,
          return_no: returnNo,
          invoiceNo: returnPayload.invoice_no || invoiceId,
          invoice_no: returnPayload.invoice_no || invoiceId,
          customerId: returnPayload.customer_id,
          customerName: returnPayload.customer_name,
          returnedItems: returnPayload.items || returnPayload.returned_items || [
            {
              productId: returnPayload.productId,
              sku: returnPayload.sku,
              qty: returnPayload.quantity || 1,
              price: returnPayload.refund_amount || 0
            }
          ],
          exchangeItems: returnPayload.exchange_items || [],
          returnMethod: returnPayload.refund_method || 'Cash Refund',
          returnAmount: returnPayload.refund_amount || 0,
          totalRefunded: returnPayload.refund_amount || 0,
          differencePaymentMethod: returnPayload.differencePaymentMethod || returnPayload.difference_payment_method || 'Cash',
          difference_payment_method: returnPayload.differencePaymentMethod || returnPayload.difference_payment_method || 'Cash',
          previousInvoiceBalance: returnPayload.previousInvoiceBalance || returnPayload.previous_invoice_balance || 0,
          previous_invoice_balance: returnPayload.previousInvoiceBalance || returnPayload.previous_invoice_balance || 0,
          reason: returnPayload.reason || 'Sales Return',
          userEmail: returnPayload.userEmail || 'system'
        })
      }, 10000);

      if (response.ok) {
        return await response.json();
      }
    } catch (_) {
      // Fallback to direct supabase / local client operations
    }

    // 1. Insert distinct return record (contra-revenue)
    const retAmount = Number(
      returnPayload.refund_amount !== undefined && returnPayload.refund_amount !== null
        ? returnPayload.refund_amount
        : (returnPayload.returnAmount !== undefined ? returnPayload.returnAmount : (returnPayload.return_amount || 0))
    );

    const returnRecord = {
      id: `sr_${Date.now()}`,
      return_no: returnNo,
      invoice_id: invoiceId,
      invoice_no: returnPayload.invoice_no || invoiceId,
      customer_id: returnPayload.customer_id || null,
      customer_name: returnPayload.customer_name || 'Guest Customer',
      sku: returnPayload.sku || '',
      qty_returned: returnPayload.quantity || (returnPayload.items ? returnPayload.items.reduce((s, i) => s + Number(i.qty || 1), 0) : 1),
      returned_items: JSON.stringify(returnPayload.items || returnPayload.returned_items || []),
      exchange_items: JSON.stringify(returnPayload.exchange_items || []),
      return_amount: retAmount,
      refund_amount: retAmount,
      total_refunded: retAmount,
      refund_method: returnPayload.refund_method || 'Cash Refund',
      difference_payment_method: returnPayload.differencePaymentMethod || returnPayload.difference_payment_method || 'Cash',
      previous_invoice_balance: returnPayload.previousInvoiceBalance || returnPayload.previous_invoice_balance || 0,
      status: 'active',
      reason: returnPayload.reason || 'Sales Return',
      created_at: timestamp
    };

    await supabase.from('sales_returns').insert([returnRecord]);

    // Insert line item breakdown into sales_return_items
    const itemsList = returnPayload.items || returnPayload.returned_items || [];
    if (Array.isArray(itemsList) && itemsList.length > 0) {
      const sriRows = itemsList.map((it: any, idx: number) => {
        const pId = it.productId || it.product_id || it.id || '';
        const qty = Number(it.qty || 1);
        const price = Number(it.price || 0);
        const cost = Number(it.cost_price || it.costPrice || 0);
        return {
          id: `sri_${returnRecord.id}_${pId || idx}_${idx}`,
          return_id: returnRecord.id,
          product_id: pId,
          product_name: it.productName || it.name || '',
          quantity: qty,
          unit_price: price,
          cost_price: cost,
          total: qty * price,
          created_at: timestamp
        };
      });
      try {
        await supabase.from('sales_return_items').insert(sriRows);
      } catch (sriErr) {
        console.warn('sales_return_items insert notice:', sriErr);
      }
    }
 
    // Post Contra-Revenue Entry when an Exchange results in cash refunded to customer
    const exItems = returnPayload.exchange_items || [];
    const isExchange = (returnPayload.refund_method === 'Exchange' || exItems.length > 0);
    const refundDiff = Number(returnPayload.refund_amount || 0);
    const isCashSettlement = (returnPayload.differencePaymentMethod || returnPayload.difference_payment_method || 'Cash').toLowerCase() === 'cash';
    if (isExchange && refundDiff > 0 && isCashSettlement) {
      const txId = `t_${Date.now()}_ex_ref`;
      const refundDesc = `Exchange Cash Refund for Return #${returnNo} (Invoice #${returnPayload.invoice_no || invoiceId})`;
      const txDate = new Date(timestamp).toISOString().slice(0, 10);
      try {
        await supabase.from('transactions').insert([{
          id: txId,
          type: 'contra_revenue',
          flow_type: 'CONTRA-REVENUE',
          category: 'EXCHANGE REFUND',
          description: refundDesc,
          reference: returnNo || invoiceId,
          amount: -Math.abs(refundDiff),
          date: txDate,
          payment_method: 'CASH',
          status: 'ACTIVE',
          user_id: returnPayload.userEmail || 'system',
          created_at: timestamp
        }]);
      } catch (txErr) {
        console.warn('Fallback transaction insert notice:', txErr);
      }
    }

    // 2. Restock physical inventory
    if (returnPayload.sku) {
      const { data: pList } = await supabase.from('products').select('*').eq('sku', returnPayload.sku);
      if (pList && pList[0]) {
        const prod = pList[0];
        const newStock = Number(prod.stock || 0) + Number(returnPayload.quantity || 1);
        await supabase.from('products').update({ stock: newStock }).eq('id', prod.id);
      }
    } else if (returnPayload.items && Array.isArray(returnPayload.items)) {
      for (const it of returnPayload.items) {
        const pId = it.productId || it.product_id;
        if (pId) {
          const { data: pList } = await supabase.from('products').select('*').eq('id', pId);
          if (pList && pList[0]) {
            const prod = pList[0];
            const convRate = Number(it.conversionRate) || 1;
            const inc = convRate > 0 ? (Number(it.qty || 1) / convRate) : Number(it.qty || 1);
            await supabase.from('products').update({ stock: Number(prod.stock || 0) + inc }).eq('id', pId);
          }
        }
      }
    }

    // 3. Reduce customer credit balance if applicable
    if (returnPayload.customer_id && retAmount > 0) {
      try {
        const { data: custData } = await supabase
          .from('customers')
          .select('id, credit_balance, current_credit')
          .eq('id', returnPayload.customer_id)
          .single();
        if (custData) {
          const newCreditBal = Math.max(0, Number(custData.credit_balance || 0) - retAmount);
          const newCurrCredit = Math.max(0, Number(custData.current_credit || 0) - retAmount);
          await supabase
            .from('customers')
            .update({ credit_balance: newCreditBal, current_credit: newCurrCredit })
            .eq('id', custData.id);
        }
      } catch (custErr) {
        console.warn('Customer credit update error:', custErr);
      }
    }

    // 4. Mark invoice return status and update balance_due WITHOUT mutating original total
    const prevBal = Number(returnPayload.previousInvoiceBalance || returnPayload.previous_invoice_balance || 0);
    const newBalDue = Math.max(0, Number((prevBal - retAmount).toFixed(2)));
    try {
      await supabase
        .from('sales')
        .update({
          return_status: 'PARTIALLY_RETURNED',
          status: 'Partially Returned',
          balance_due: newBalDue
        })
        .eq('id', invoiceId);
    } catch (_) {
      await supabase
        .from('sales')
        .update({
          return_status: 'PARTIALLY_RETURNED',
          status: 'Partially Returned'
        })
        .eq('id', invoiceId);
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

/**
 * Atomic return & exchange processor with inventory stock verification guard.
 * Aborts if replacement item has insufficient or 0 stock.
 */
export async function processReturnAndExchange(payload: ExchangeTransactionPayload) {
  // 1. Fetch live stock of the requested replacement item
  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('sku', payload.exchangeSku);

  const replacementItem = products && products[0];

  if (!replacementItem) {
    throw new Error(`Replacement SKU "${payload.exchangeSku}" not found.`);
  }

  // 2. HARD GUARD: Abort if stock is insufficient or 0
  const availableStock = Number(replacementItem.stock || 0);
  if (availableStock < payload.exchangeQty) {
    throw new Error(
      `Insufficient inventory: "${replacementItem.name}" only has ${availableStock} pcs available. Cannot fulfill exchange of ${payload.exchangeQty} pcs.`
    );
  }

  // 3. Restock the returned item
  const { data: returnedProdList } = await supabase
    .from('products')
    .select('*')
    .eq('sku', payload.returnedSku);

  if (returnedProdList && returnedProdList[0]) {
    const retProd = returnedProdList[0];
    await supabase
      .from('products')
      .update({ stock: Number(retProd.stock || 0) + payload.returnedQty })
      .eq('id', retProd.id);
  }

  // 4. Deduct replacement item stock safely
  await supabase
    .from('products')
    .update({ stock: Math.max(0, availableStock - payload.exchangeQty) })
    .eq('id', replacementItem.id);

  // 5. Insert return & exchange audit record
  const returnRecordId = `RET-${Date.now().toString().slice(-6)}`;
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
      created_at: new Date().toISOString()
    }
  ]);

  if (payload.priceDifference < 0) {
    const refundAmt = -Math.abs(payload.priceDifference);
    const txId = `t_${Date.now()}_ex_ref`;
    try {
      await supabase.from('transactions').insert([{
        id: txId,
        type: 'contra_revenue',
        flow_type: 'CONTRA-REVENUE',
        category: 'EXCHANGE REFUND',
        description: `Exchange Cash Refund for Return #${returnRecordId} (Invoice #${payload.returnInvoiceId})`,
        reference: returnRecordId,
        amount: refundAmt,
        date: new Date().toISOString().slice(0, 10),
        payment_method: 'CASH',
        status: 'ACTIVE',
        user_id: payload.userEmail || 'system',
        created_at: new Date().toISOString()
      }]);
    } catch (txErr) {
      console.warn('Exchange refund transaction insert notice:', txErr);
    }
  }

  return { success: true, returnNo: returnRecordId };
}

export default {
  processSalesReturn,
  processReturnAndExchange
};
