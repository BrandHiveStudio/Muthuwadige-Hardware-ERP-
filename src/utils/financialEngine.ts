/**
 * Centralized Financial Engine
 * Muthuwadige Hardware ERP - Single Source of Truth for Ledger Math & Analytics
 */

import { toSriLankaDateStr, isWithinDateRange } from './dateTime';
import { calculateSaleAccounting, isCreditSaleRecord } from './sales/accounting';

export interface FinancialSummaryResult {
  grossStickerSales: number;
  customerDiscounts: number;
  transportFees: number;
  returnsSellingRevenue: number;
  exchangeSellingRevenue: number;
  netSalesRevenue: number;
  grossCOGS: number;
  returnsCostVal: number;
  exchangeCostVal: number;
  netCOGS: number;
  grossProfit: number;
  grossMarginPct: number;
  validSalesCount: number;
  activeReturnsCount: number;
}

export interface PaymentBreakdownResult {
  directCash: number;
  directCard: number;
  directBank: number;
  settledCash: number;
  settledCard: number;
  settledBank: number;
  totalCashCollected: number;
  totalCardCollected: number;
  totalBankCollected: number;
  clearedChequesAmount: number;
  cashChequesInHandAmount: number;
  pendingChequesAmount: number;
  customerCreditOutstanding: number;
  totalRevenueCollected: number;
  totalPaymentMethods: number;
}

/**
 * Calculates Unit Cost for a line item based on Base Product Cost and Unit Conversion Rate
 */
export function getItemUnitCost(
  product: any,
  itemUnit?: string,
  itemConvRate?: number,
  itemCostSnapshot?: number
): number {
  const baseCost = product
    ? Number(product.cost_price !== undefined ? product.cost_price : (product.costPrice !== undefined ? product.costPrice : 0))
    : Number(itemCostSnapshot || 0);

  let conversionRate = Number(itemConvRate) || 1;

  if ((!itemConvRate || conversionRate === 1) && itemUnit && product && product.unit && itemUnit.toLowerCase() !== product.unit.toLowerCase()) {
    const measureDetailsStr = product.measure_details || product.measureDetails;
    if (measureDetailsStr) {
      try {
        const parsed = typeof measureDetailsStr === 'string' ? JSON.parse(measureDetailsStr) : measureDetailsStr;
        if (parsed && Array.isArray(parsed.conversions)) {
          const matchedConv = parsed.conversions.find((c: any) => (c.unit || '').toLowerCase() === itemUnit.toLowerCase());
          if (matchedConv) {
            const rawVal = Number(matchedConv.kgVal) || 1;
            if ((product.unit || '').toLowerCase() === 'cube' && rawVal > 0 && rawVal < 1) {
              conversionRate = 1 / rawVal;
            } else {
              conversionRate = rawVal;
            }
          }
        }
      } catch (_e) {}
    }
  }

  const snapshotCost = Number(itemCostSnapshot !== undefined && itemCostSnapshot !== null ? itemCostSnapshot : 0);
  if (snapshotCost > 0) {
    if (conversionRate > 1 && snapshotCost > (baseCost / conversionRate) + 0.01 && baseCost > 0) {
      return baseCost / conversionRate;
    }
    if (conversionRate > 1 && snapshotCost <= (baseCost / conversionRate) + 0.01) {
      return snapshotCost;
    }
    if (conversionRate <= 1) {
      return snapshotCost;
    }
  }

  return conversionRate > 0 ? (baseCost / conversionRate) : baseCost;
}

/**
 * Safely parses item arrays from sale/return records
 */
function parseItemsArray(rawItems: any): any[] {
  if (!rawItems) return [];
  if (Array.isArray(rawItems)) return rawItems;
  if (typeof rawItems === 'string') {
    try {
      const parsed = JSON.parse(rawItems);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
      return [];
    }
  }
  return [];
}

/**
 * Calculates net selling value of a sales return record
 */
export function getReturnSellingSubtotal(r: any): number {
  if (!r) return 0;
  const retAmt = Number(
    r.return_amount !== undefined && r.return_amount !== null
      ? r.return_amount
      : (r.returnAmount !== undefined && r.returnAmount !== null
        ? r.returnAmount
        : (r.total_refunded !== undefined && r.total_refunded !== null && Number(r.total_refunded) > 0
          ? r.total_refunded
          : (r.totalRefunded !== undefined && r.totalRefunded !== null && Number(r.totalRefunded) > 0
            ? r.totalRefunded
            : (r.amount || 0))))
  );

  const retTrans = Number(r.transportation_fee || r.transportationFee || 0);
  if (retAmt > 0) {
    return Math.max(0, retAmt - retTrans);
  }

  const items = parseItemsArray(r.items || r.returnedItems || r.returned_items);
  if (items.length > 0) {
    return items.reduce((sum: number, it: any) => {
      const itemQty = Number(it.qty || it.quantity || 0);
      const itemPrice = Number(it.price || it.unitPrice || it.unit_price || 0);
      const itemDisc = Number(it.discount || 0);
      const itemDiscType = it.discountType || 'amount';
      const discAmt = (itemDiscType === 'percent' || itemDiscType === 'percentage')
        ? (itemQty * itemPrice * itemDisc / 100)
        : (itemDisc * itemQty);
      return sum + Math.max(0, itemQty * itemPrice - discAmt);
    }, 0);
  }

  return 0;
}

/**
 * Computes authoritative Financial Performance Summary (Revenue, COGS, Profit, Margins)
 */
export function computeFinancialSummary(params: {
  sales: any[];
  salesReturns: any[];
  products: any[];
  fromDate?: string;
  toDate?: string;
}): FinancialSummaryResult {
  const { sales = [], salesReturns = [], products = [], fromDate, toDate } = params;

  // Filter valid active records within date range
  const validSales = sales.filter((s: any) => {
    if (!s) return false;
    const status = (s.status || '').toString().toLowerCase().trim();
    if (status === 'cancelled' || status === 'voided') return false;
    return isWithinDateRange(s.created_at || s.date, fromDate, toDate);
  });

  const activeReturns = salesReturns.filter((r: any) => {
    if (!r) return false;
    const status = (r.status || '').toString().toLowerCase().trim();
    if (status === 'cancelled' || status === 'voided') return false;
    return isWithinDateRange(r.created_at || r.return_date || r.date, fromDate, toDate);
  });

  let grossStickerSales = 0;
  let customerDiscounts = 0;
  let transportFees = 0;
  let grossCOGS = 0;

  validSales.forEach((s: any) => {
    const items = parseItemsArray(s.items);
    if (items.length > 0) {
      items.forEach((it: any) => {
        const qty = Number(it.qty || it.quantity || 0);
        const price = Number(it.price || it.unitPrice || it.unit_price || 0);
        const product = products.find((p: any) => p.id === it.productId || p.id === it.product_id || p.id === it.id);
        const cost = getItemUnitCost(product, it.unit, it.conversionRate, it.cost_price || it.costPrice);

        grossStickerSales += (qty * price);
        grossCOGS += (qty * cost);
      });
    } else {
      const subtotal = Number(s.subtotal !== undefined ? s.subtotal : (s.total_amount || s.total || 0));
      grossStickerSales += subtotal;
    }

    customerDiscounts += Number(s.discount_amount || s.discount || 0);
    transportFees += Number(s.transportation_fee || s.transportationFee || s.delivery_fee || 0);
  });

  let returnsSellingRevenue = 0;
  let returnsCostVal = 0;
  let exchangeSellingRevenue = 0;
  let exchangeCostVal = 0;

  activeReturns.forEach((r: any) => {
    returnsSellingRevenue += getReturnSellingSubtotal(r);

    const retItems = parseItemsArray(r.items || r.returnedItems || r.returned_items);
    retItems.forEach((it: any) => {
      const qty = Number(it.qty || it.quantity || 0);
      const product = products.find((p: any) => p.id === it.productId || p.id === it.product_id || p.id === it.id);
      const cost = getItemUnitCost(product, it.unit, it.conversionRate, it.cost_price || it.costPrice);
      returnsCostVal += (qty * cost);
    });

    const exAmt = Number(r.exchange_amount !== undefined ? r.exchange_amount : (r.exchangeAmount || 0));
    exchangeSellingRevenue += exAmt;

    const exItems = parseItemsArray(r.exchangeItems || r.exchange_items);
    exItems.forEach((it: any) => {
      const qty = Number(it.qty || it.quantity || 0);
      const product = products.find((p: any) => p.id === it.productId || p.id === it.product_id || p.id === it.id);
      const cost = getItemUnitCost(product, it.unit, it.conversionRate, it.cost_price || it.costPrice);
      exchangeCostVal += (qty * cost);
    });
  });

  const netSalesRevenue = Math.max(0, Math.round((grossStickerSales - customerDiscounts - returnsSellingRevenue + transportFees) * 100) / 100);
  const netCOGS = Math.max(0, Math.round((grossCOGS + exchangeCostVal - returnsCostVal) * 100) / 100);
  const grossProfit = Math.round((netSalesRevenue - netCOGS) * 100) / 100;
  const grossMarginPct = netSalesRevenue > 0 ? Math.round(((grossProfit / netSalesRevenue) * 100) * 100) / 100 : 0;

  return {
    grossStickerSales: Math.round(grossStickerSales * 100) / 100,
    customerDiscounts: Math.round(customerDiscounts * 100) / 100,
    transportFees: Math.round(transportFees * 100) / 100,
    returnsSellingRevenue: Math.round(returnsSellingRevenue * 100) / 100,
    exchangeSellingRevenue: Math.round(exchangeSellingRevenue * 100) / 100,
    netSalesRevenue,
    grossCOGS: Math.round(grossCOGS * 100) / 100,
    returnsCostVal: Math.round(returnsCostVal * 100) / 100,
    exchangeCostVal: Math.round(exchangeCostVal * 100) / 100,
    netCOGS,
    grossProfit,
    grossMarginPct,
    validSalesCount: validSales.length,
    activeReturnsCount: activeReturns.length
  };
}

/**
 * Computes authoritative Payment Method Breakdown & Realized Collection Totals
 */
export function computePaymentBreakdown(params: {
  sales: any[];
  creditPayments?: any[];
  salesReturns?: any[];
  cheques?: any[];
  fromDate?: string;
  toDate?: string;
}): PaymentBreakdownResult {
  const { sales = [], creditPayments = [], salesReturns = [], cheques = [], fromDate, toDate } = params;

  const validSales = sales.filter((s: any) => {
    if (!s) return false;
    const status = (s.status || '').toString().toLowerCase().trim();
    if (status === 'cancelled' || status === 'voided') return false;
    return isWithinDateRange(s.created_at || s.date, fromDate, toDate);
  });

  const validPayments = creditPayments.filter((cp: any) => {
    if (!cp) return false;
    return isWithinDateRange(cp.payment_date || cp.created_at || cp.date, fromDate, toDate);
  });

  const activeReturns = salesReturns.filter((r: any) => {
    if (!r) return false;
    const status = (r.status || '').toString().toLowerCase().trim();
    if (status === 'cancelled' || status === 'voided') return false;
    return isWithinDateRange(r.created_at || r.return_date || r.date, fromDate, toDate);
  });

  const validCheques = cheques.filter((c: any) => {
    if (!c) return false;
    return isWithinDateRange(c.cheque_date || c.created_at, fromDate, toDate);
  });

  let directCash = 0;
  let directCard = 0;
  let directBank = 0;

  validSales.forEach((s: any) => {
    const rawMethod = (s.payment_method || s.paymentMethod || '').toString().trim().toLowerCase();
    const isCredit = isCreditSaleRecord(s);
    const totalAmt = Number(s.total_amount !== undefined ? s.total_amount : (s.total || 0));

    if (isCredit) {
      const invNo = s.invoice_no || s.invoiceNo;
      const totalSettledOnInvoice = validPayments
        .filter((cp: any) => cp.sale_id === s.id || (invNo && cp.invoice_no === invNo))
        .reduce((sum: number, cp: any) => sum + Number(cp.amount_paid !== undefined ? cp.amount_paid : (cp.amount || 0)), 0);

      const initialDownPayment = Math.max(0, Number(s.payment_received || 0) - totalSettledOnInvoice);
      if (initialDownPayment > 0) {
        if (rawMethod.includes('card')) directCard += initialDownPayment;
        else if (rawMethod.includes('bank')) directBank += initialDownPayment;
        else directCash += initialDownPayment;
      }
    } else {
      if (rawMethod.includes('card')) directCard += totalAmt;
      else if (rawMethod.includes('bank')) directBank += totalAmt;
      else if (rawMethod.includes('cheque')) {
        // Direct cheque payments flow into Cheque Registry
      } else {
        directCash += totalAmt;
      }
    }
  });

  let settledCash = 0;
  let settledCard = 0;
  let settledBank = 0;

  validPayments.forEach((cp: any) => {
    const cpAmt = Number(cp.amount_paid !== undefined ? cp.amount_paid : (cp.amount || 0));
    const cpMethod = (cp.payment_method || cp.paymentMethod || 'Cash').toString().toLowerCase().trim();

    if (cpMethod.includes('card')) settledCard += cpAmt;
    else if (cpMethod.includes('bank') && !cpMethod.includes('cheque')) settledBank += cpAmt;
    else if (cpMethod.includes('cheque')) {
      // Handled distinctly in clearedChequesAmount / cashChequesInHandAmount
    } else {
      settledCash += cpAmt;
    }
  });

  // Exchange Return Adjustments to cash
  const cashRefundsTotal = activeReturns.reduce((sum: number, r: any) => {
    const type = (r.return_type || r.returnType || r.returnMethod || r.return_method || r.type || '').toString().toLowerCase().trim();
    if (type === 'cash refund' || type === 'cash' || type === 'cash_refund') {
      return sum + Number(r.refund_amount || r.total_refunded || r.return_amount || 0);
    }
    return sum;
  }, 0);

  const exchangeCashInflowsTotal = activeReturns.reduce((sum: number, r: any) => {
    const type = (r.return_type || r.returnType || r.returnMethod || r.return_method || r.type || '').toString().toLowerCase().trim();
    if (type === 'exchange') {
      const paidAmt = Number(r.customer_paid || 0);
      const changeGiven = Number(r.change_given || 0);
      return sum + Math.max(0, paidAmt - changeGiven);
    }
    return sum;
  }, 0);

  const totalCashCollected = Math.max(0, directCash + settledCash + exchangeCashInflowsTotal - cashRefundsTotal);
  const totalCardCollected = directCard + settledCard;
  const totalBankCollected = directBank + settledBank;

  // Cheque Registry Buckets
  const clearedCheques = validCheques.filter((c: any) => c.direction === 'INWARD' && c.status === 'CLEARED');
  const clearedChequesAmount = clearedCheques.reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);

  const cashChequesInHand = validCheques.filter((c: any) => c.direction === 'INWARD' && c.status === 'IN_HAND');
  const cashChequesInHandAmount = cashChequesInHand.reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);

  const pendingCheques = validCheques.filter((c: any) => c.direction === 'INWARD' && (c.status === 'PENDING' || c.status === 'DEPOSITED'));
  const pendingChequesAmount = pendingCheques.reduce((sum: number, c: any) => sum + Number(c.amount || 0), 0);

  // Customer Credit Outstanding
  const customerCreditOutstanding = validSales.reduce((sum: number, s: any) => {
    if (!isCreditSaleRecord(s)) return sum;
    const acct = calculateSaleAccounting(s, salesReturns);
    return sum + acct.netOutstanding;
  }, 0);

  const totalRevenueCollected = Math.round((totalCashCollected + totalCardCollected + totalBankCollected + clearedChequesAmount) * 100) / 100;
  const totalPaymentMethods = Math.round((totalRevenueCollected + customerCreditOutstanding) * 100) / 100;

  return {
    directCash: Math.round(directCash * 100) / 100,
    directCard: Math.round(directCard * 100) / 100,
    directBank: Math.round(directBank * 100) / 100,
    settledCash: Math.round(settledCash * 100) / 100,
    settledCard: Math.round(settledCard * 100) / 100,
    settledBank: Math.round(settledBank * 100) / 100,
    totalCashCollected: Math.round(totalCashCollected * 100) / 100,
    totalCardCollected: Math.round(totalCardCollected * 100) / 100,
    totalBankCollected: Math.round(totalBankCollected * 100) / 100,
    clearedChequesAmount: Math.round(clearedChequesAmount * 100) / 100,
    cashChequesInHandAmount: Math.round(cashChequesInHandAmount * 100) / 100,
    pendingChequesAmount: Math.round(pendingChequesAmount * 100) / 100,
    customerCreditOutstanding: Math.round(customerCreditOutstanding * 100) / 100,
    totalRevenueCollected,
    totalPaymentMethods
  };
}
