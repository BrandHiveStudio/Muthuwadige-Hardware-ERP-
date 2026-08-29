/**
 * Authoritative Accounting Ledger Utility
 * Muthuwadige Hardware ERP - Unified Remediation Engine
 */

export { calculateEffectiveUnitPricePaid } from '../accounting';

export interface SaleAccountingSummary {
  originalTotal: number;
  originalPaid: number;
  totalReturn: number;
  totalExchange: number;
  exchangePaid: number;
  effectiveTotal: number;
  totalPaid: number;
  netOutstanding: number;
  customerCreditEntitlement: number;
  isFullySettled: boolean;
  isCreditSale: boolean;
}

/**
 * Determine if a sale record is a credit sale
 */
export function isCreditSaleRecord(sale: any): boolean {
  if (!sale) return false;
  const method = (sale.payment_method || sale.paymentMethod || '').toString().toLowerCase().trim();
  const status = (sale.status || '').toString().toLowerCase().trim();

  if (method === 'cash' || method === 'card' || method === 'bank transfer' || method === 'online' || method === 'pos') {
    return false;
  }

  if (method === 'credit' || method === 'credit sale' || sale.is_credit === true || sale.is_credit === 1) {
    return true;
  }

  if ((status === 'non paid' || status === 'non-paid' || status === 'pending' || status === 'partially paid' || status === 'partially settled' || status === 'fully settled') &&
      method !== 'cash' && method !== 'card' && method !== 'bank transfer') {
    return true;
  }

  return false;
}

/**
 * Calculates authoritative accounting metrics for a sale order and its associated sales returns.
 * 
 * Formula:
 *   effectiveTotal = max(0, originalTotal - totalReturn + totalExchange)
 *   totalPaid = originalPaid + exchangePaid
 *   netOutstanding = max(0, effectiveTotal - totalPaid)
 */
export function calculateSaleAccounting(sale: any, salesReturnsList: any[] = []): SaleAccountingSummary {
  if (!sale) {
    return {
      originalTotal: 0,
      originalPaid: 0,
      totalReturn: 0,
      totalExchange: 0,
      exchangePaid: 0,
      effectiveTotal: 0,
      totalPaid: 0,
      netOutstanding: 0,
      customerCreditEntitlement: 0,
      isFullySettled: true,
      isCreditSale: false
    };
  }

  const invNo = sale.invoice_no || sale.invoiceNo || sale.id;
  const isCredit = isCreditSaleRecord(sale);
  const originalTotal = Number(sale.total_amount !== undefined ? sale.total_amount : (sale.total || 0));

  let originalPaid = 0;
  if (isCredit) {
    originalPaid = Number(sale.payment_received || 0);
  } else {
    // For cash / paid sales, original payment equals original total unless payment_received is explicitly recorded
    originalPaid = sale.payment_received !== undefined && sale.payment_received !== null && Number(sale.payment_received) > 0
      ? Number(sale.payment_received)
      : (sale.status?.toLowerCase() === 'paid' ? originalTotal : Number(sale.payment_received || 0));
  }

  // Filter active returns for this invoice
  const activeReturns = (salesReturnsList || []).filter(r => {
    if (!r) return false;
    const rStatus = (r.status || '').toString().toLowerCase().trim();
    if (rStatus === 'voided' || rStatus === 'cancelled') return false;
    const rInv = r.invoice_no || r.invoiceNo;
    return rInv === invNo;
  });

  const totalReturn = activeReturns.reduce((sum, r) => sum + Number(r.return_amount !== undefined ? r.return_amount : (r.returnAmount || 0)), 0);
  const totalExchange = activeReturns.reduce((sum, r) => sum + Number(r.exchange_amount !== undefined ? r.exchange_amount : (r.exchangeAmount || 0)), 0);
  const exchangePaid = activeReturns.reduce((sum, r) => sum + Number(r.customer_paid !== undefined ? r.customer_paid : (r.customerPaid || 0)), 0);

  const effectiveTotal = Math.max(0, originalTotal - totalReturn + totalExchange);
  const totalPaid = originalPaid + exchangePaid;
  const netOutstanding = Math.max(0, effectiveTotal - totalPaid);

  // Calculate genuine store credit entitlement (if returns exceed total goods taken on cash sales)
  let customerCreditEntitlement = 0;
  if (!isCredit && totalReturn > originalTotal + totalExchange) {
    customerCreditEntitlement = totalReturn - (originalTotal + totalExchange);
  }

  const isFullySettled = totalPaid >= effectiveTotal - 0.01 || netOutstanding <= 0.01;

  return {
    originalTotal,
    originalPaid,
    totalReturn,
    totalExchange,
    exchangePaid,
    effectiveTotal,
    totalPaid,
    netOutstanding: Math.round(netOutstanding * 100) / 100,
    customerCreditEntitlement: Math.round(customerCreditEntitlement * 100) / 100,
    isFullySettled,
    isCreditSale: isCredit
  };
}
