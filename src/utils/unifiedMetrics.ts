import {
  toSriLankaDateStr,
  computeFinancialSummary,
  computePaymentBreakdown,
  calculateSaleAccounting,
  isCreditSaleRecord
} from './accounting';
import { splitReturnSettlements } from '../services/returnService';

export interface UnifiedMetricsInput {
  sales: any[];
  salesReturns: any[];
  creditPayments: any[];
  transactions: any[];
  products: any[];
  cheques?: any[];
  fromDate?: string;
  toDate?: string;
}

export interface UnifiedMetricsOutput {
  grossStickerSales: number;
  exchangeSellingRevenue: number;
  grossSalesRevenue: number;
  customerDiscounts: number;
  salesReturnsRefunds: number;
  transportFees: number;
  netSalesRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  totalOrders: number;
  paidOrders: number;
  cashBookBalance: number;
  cashDrawableBalance: number;
  totalRevenueCollected: number;
  cashCollected: number;
  cardCollected: number;
  bankCollected: number;
  creditOutstanding: number;
  pendingChequesAmount: number;
}

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

const isActiveSale = (s: any): boolean => {
  if (!s) return false;
  const st = String(s.status || '').toLowerCase().trim();
  return st !== 'cancelled' && st !== 'voided';
};

const isActiveReturn = (r: any): boolean => {
  if (!r) return false;
  const st = String(r.status || '').toLowerCase().trim();
  return st !== 'cancelled' && st !== 'voided';
};

const isActiveCreditPayment = (cp: any): boolean => {
  if (!cp) return false;
  const st = String(cp.status || '').toLowerCase().trim();
  return st !== 'cancelled' && st !== 'voided';
};

const isActiveTransaction = (t: any): boolean => {
  if (!t) return false;
  const st = String(t.status || '').toUpperCase().trim();
  return st !== 'VOIDED' && st !== 'CANCELLED';
};

const getReturnType = (r: any): string =>
  String(r?.return_type || r?.returnType || r?.returnMethod || r?.return_method || r?.type || '')
    .toLowerCase()
    .trim();

export function computeUnifiedMetrics(input: UnifiedMetricsInput): UnifiedMetricsOutput {
  const {
    sales = [],
    salesReturns = [],
    creditPayments = [],
    transactions = [],
    products = [],
    cheques = [],
    fromDate,
    toDate
  } = input;

  const inRange = (rawDate: any): boolean => {
    if (!fromDate && !toDate) return true;
    const d = toSriLankaDateStr(rawDate);
    if (!d) return false;
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  };

  const periodSales = sales.filter((s) => isActiveSale(s) && inRange(s.created_at || s.date));
  const periodReturns = salesReturns.filter((r) => isActiveReturn(r) && inRange(r.created_at || r.return_date || r.date));
  const periodCreditPayments = creditPayments.filter(
    (cp) => isActiveCreditPayment(cp) && inRange(cp.payment_date || cp.created_at || cp.date)
  );
  const periodTransactions = transactions.filter((t) => isActiveTransaction(t) && inRange(t.date || t.created_at));

  const summary = computeFinancialSummary({
    sales: periodSales,
    salesReturns: periodReturns,
    products,
    fromDate,
    toDate
  });

  const deliveryFees = periodSales.reduce(
    (sum, s) =>
      sum +
      Number(
        s.transportation_fee ?? s.delivery_fee ?? s.delivery_charges ?? s.transportationFee ?? 0
      ),
    0
  );

  const exchangeSellingRevenue = round2(summary.exchangeSellingRevenue || 0);
  const grossStickerSales = round2(summary.grossStickerSales || 0);
  const grossSalesRevenue = round2(grossStickerSales + exchangeSellingRevenue);
  const customerDiscounts = round2(summary.customerDiscounts || 0);
  const salesReturnsRefunds = round2(summary.returnsSellingRevenue || 0);
  const transportFees = round2(deliveryFees > 0 ? deliveryFees : summary.transportFees || 0);
  const netSalesRevenue = round2(
    Math.max(0, grossSalesRevenue - customerDiscounts - salesReturnsRefunds + transportFees)
  );
  const cogs = round2(summary.netCOGS || 0);
  const grossProfit = round2(netSalesRevenue - cogs);
  const grossMarginPct = netSalesRevenue > 0 ? round2((grossProfit / netSalesRevenue) * 100) : 0;

  // Count strictly sales invoices—never exchange or return receipts
  const totalOrders = periodSales.length;

  const paidOrders = periodSales.filter((o) => {
    const status = String(o.status || o.paymentStatus || o.payment_status || '').toUpperCase().trim();
    const isCredit = isCreditSaleRecord(o);
    const acct = calculateSaleAccounting(o, periodReturns, periodCreditPayments);

    const explicitBalance =
      o.remainingBalance ??
      o.remaining_balance ??
      o.balanceDue ??
      o.balance_due ??
      o.balanceAmount ??
      o.balance_amount ??
      o.balance;

    const balanceDue =
      explicitBalance !== undefined && explicitBalance !== null
        ? Math.min(Number(explicitBalance), Number(acct?.netOutstanding ?? 0))
        : Number(acct?.netOutstanding ?? (isCredit ? 1 : 0));

    const isFullyReturned =
      status === 'RETURNED' || status === 'FULLY RETURNED' || status === 'CANCELLED' || status === 'VOIDED';
    if (isFullyReturned) return false;

    if (isCredit) {
      return balanceDue <= 0.01 || Boolean(acct?.isFullySettled);
    }

    return (
      status === 'PAID' ||
      status === 'COMPLETED' ||
      status === 'SETTLED' ||
      status === 'FULLY SETTLED' ||
      status === 'PARTIALLY RETURNED' ||
      status === 'PARTIAL' ||
      status === 'PARTIALLY_RETURNED' ||
      status === 'PARTIALLY_REFUNDED' ||
      status === 'PARTIALLY REFUNDED' ||
      status === 'PARTIAL REFUND' ||
      balanceDue <= 0.01
    );
  }).length;

  const paymentBreakdown = computePaymentBreakdown({
    sales: periodSales,
    creditPayments: periodCreditPayments,
    salesReturns: periodReturns,
    cheques,
    fromDate,
    toDate
  });

  const cashRefundsOutflow = periodReturns.reduce((sum, r) => {
    const isCredit = r.isCredit === true || r.is_credit === true || r.is_credit === 1;
    if (isCredit) return sum;
    const type = getReturnType(r);
    if (type === 'cash refund' || type === 'cash' || type === 'cash_refund') {
      const amt = Number(
        r.refund_amount ?? r.refundAmount ?? r.total_refunded ?? r.totalRefunded ?? r.return_amount ?? r.returnAmount ?? 0
      );
      return sum + Math.max(0, amt);
    }
    if (type === 'exchange') {
      const { cashBankRefundOutflow } = splitReturnSettlements([r]);
      return sum + Math.max(0, Number(cashBankRefundOutflow || 0));
    }
    return sum;
  }, 0);

  const cashExpensesOutflow = periodTransactions.reduce((sum, t) => {
    const flow = String(t.flow_type || t.type || '').toUpperCase().trim();
    const method = String(t.payment_method || t.paymentMethod || t.method || 'CASH').toUpperCase().trim();
    const isCash = method === 'CASH' || method === 'CASH_BEARER';
    if (flow === 'EXPENSE' && isCash) {
      return sum + Math.abs(Number(t.amount || 0));
    }
    return sum;
  }, 0);

  const cashBookBalance = round2(
    (paymentBreakdown.directCash || 0) + (paymentBreakdown.settledCash || 0)
  );
  const cashDrawableBalance = round2(
    Math.max(0, cashBookBalance - cashRefundsOutflow - cashExpensesOutflow)
  );
  const cardCollected = round2(paymentBreakdown.totalCardCollected || 0);
  const bankCollected = round2(paymentBreakdown.totalBankCollected || 0);
  const creditOutstanding = round2(paymentBreakdown.customerCreditOutstanding || 0);
  const pendingChequesAmount = round2(paymentBreakdown.pendingChequesAmount || 0);
  const totalRevenueCollected = round2(
    Math.max(0, cashDrawableBalance + cardCollected + bankCollected + (paymentBreakdown.clearedChequesAmount || 0) + (paymentBreakdown.cashChequesInHandAmount || 0))
  );

  return {
    grossStickerSales,
    exchangeSellingRevenue,
    grossSalesRevenue,
    customerDiscounts,
    salesReturnsRefunds,
    transportFees,
    netSalesRevenue,
    cogs,
    grossProfit,
    grossMarginPct,
    totalOrders,
    paidOrders,
    cashBookBalance,
    cashDrawableBalance,
    totalRevenueCollected,
    cashCollected: cashDrawableBalance,
    cardCollected,
    bankCollected,
    creditOutstanding,
    pendingChequesAmount
  };
}
