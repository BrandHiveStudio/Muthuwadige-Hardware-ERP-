/**
 * Centralized Financial Accounting Engine
 * Muthuwadige Hardware ERP - Single Source of Truth for Ledger Math
 */

export * from './sales/accounting';

/**
 * Calculates Gross Line Total (Qty * Unit Price) before line discounts
 */
export function calculateLineGrossTotal(quantity: number, unitPrice: number): number {
  const q = Number(quantity || 0);
  const p = Number(unitPrice || 0);
  return Math.round(q * p * 100) / 100;
}

export function calculateEffectiveUnitPricePaid(
  unitPrice: number,
  itemDiscountTotalOrUnit: number,
  soldQty: number
): { unitDiscount: number; netUnitPrice: number } {
  const price = Math.max(0, Number(unitPrice) || 0);
  const qty = Math.max(1, Number(soldQty) || 1);
  const rawDiscount = Math.abs(Number(itemDiscountTotalOrUnit) || 0);

  // If discount provided is total line discount (> unitPrice or total), divide by qty once;
  // If discount is already per-unit, do not divide by qty again.
  const unitDiscount = rawDiscount > price ? rawDiscount / qty : rawDiscount;
  const netUnitPrice = Math.max(0, price - unitDiscount);

  return { unitDiscount, netUnitPrice };
}

/**
 * Calculates Total Refund or Credit Adjustment for returned quantity
 */
export function calculateTotalRefund(returnedQty: number, effectiveUnitPricePaid: number): number {
  const q = Number(returnedQty || 0);
  const p = Number(effectiveUnitPricePaid || 0);
  return Math.round(q * p * 100) / 100;
}

/**
 * Calculates Net Sales Revenue (Gross Sales - Discounts - Active Returns + Transport Fees)
 */
export function calculateNetSalesRevenue(grossSales: number, discounts: number, activeReturns: number, transportFees: number): number {
  const g = Number(grossSales || 0);
  const d = Number(discounts || 0);
  const r = Number(activeReturns || 0);
  const t = Number(transportFees || 0);
  return Math.max(0, Math.round((g - d - r + t) * 100) / 100);
}

/**
 * Calculates Net COGS (Gross Cost of Sales + Exchange Item Cost - Restocked Returned Unit Cost)
 */
export function calculateNetCOGS(grossCost: number, exchangeCost: number, returnedCost: number): number {
  const gc = Number(grossCost || 0);
  const ec = Number(exchangeCost || 0);
  const rc = Number(returnedCost || 0);
  return Math.max(0, Math.round((gc + ec - rc) * 100) / 100);
}

/**
 * Calculates Gross Profit (Net Sales Revenue - Net COGS)
 */
export function calculateGrossProfit(netSalesRevenue: number, netCOGS: number): number {
  const rev = Number(netSalesRevenue || 0);
  const cogs = Number(netCOGS || 0);
  return Math.round((rev - cogs) * 100) / 100;
}
