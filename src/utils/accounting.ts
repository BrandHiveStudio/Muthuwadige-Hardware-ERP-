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
  itemOrPrice: any,
  invoiceOrDiscount?: any,
  soldQty?: number,
  optionalInvoice?: any
): { effectivePrice: number; unitDiscount: number; netUnitPrice: number } {
  let originalUnitPrice = 0;
  let itemQty = 1;
  let unitDiscount = 0;
  let item: any = null;
  let invoice: any = null;

  if (typeof itemOrPrice === 'object' && itemOrPrice !== null) {
    item = itemOrPrice;
    invoice = invoiceOrDiscount;
    originalUnitPrice = Number(item.originalStickerPrice || item.originalUnitPrice || item.price || item.unit_price || item.unitPrice) || 0;
    itemQty = Number(item.originalQty || item.quantity || item.qty) || 1;
  } else {
    originalUnitPrice = Math.max(0, Number(itemOrPrice) || 0);
    itemQty = Math.max(1, Number(soldQty) || 1);
    unitDiscount = Math.abs(Number(invoiceOrDiscount) || 0);
    invoice = optionalInvoice;
  }

  if (item) {
    if (item.unitDiscount !== undefined && item.unitDiscount !== null && Number(item.unitDiscount) >= 0) {
      unitDiscount = Number(item.unitDiscount);
    } else if (item.discount_amount !== undefined && item.discount_amount !== null) {
      unitDiscount = Number(item.discount_amount) / itemQty;
    } else if (item.discount_percentage !== undefined && item.discount_percentage !== null) {
      unitDiscount = originalUnitPrice * (Number(item.discount_percentage) / 100);
    } else if (item.discountRate !== undefined && item.discountRate !== null) {
      unitDiscount = originalUnitPrice * (Number(item.discountRate) / 100);
    } else if ((item.discountType === '%' || item.discountType === 'percent' || item.discountType === 'percentage') && item.discount !== undefined) {
      unitDiscount = originalUnitPrice * (Number(item.discount) / 100);
    } else if (item.discount !== undefined && item.discount !== null && Number(item.discount) > 0) {
      const discVal = Number(item.discount);
      unitDiscount = discVal > originalUnitPrice ? (discVal / itemQty) : discVal;
    } else if (invoice && (invoice.discount_amount || invoice.discount) && (invoice.subtotal || invoice.grossSubtotal)) {
      // Proportional bill-level discount distribution
      const invDiscount = Number(invoice.discount_amount || invoice.discount || 0);
      const invSubtotal = Number(invoice.subtotal || invoice.grossSubtotal || 0);
      if (invSubtotal > 0 && invDiscount > 0) {
        const invoiceDiscountRatio = invDiscount / invSubtotal;
        unitDiscount = originalUnitPrice * invoiceDiscountRatio;
      }
    }
  } else if (invoice && (invoice.discount_amount || invoice.discount) && (invoice.subtotal || invoice.grossSubtotal)) {
    const invDiscount = Number(invoice.discount_amount || invoice.discount || 0);
    const invSubtotal = Number(invoice.subtotal || invoice.grossSubtotal || 0);
    if (invSubtotal > 0 && invDiscount > 0) {
      const invoiceDiscountRatio = invDiscount / invSubtotal;
      unitDiscount = originalUnitPrice * invoiceDiscountRatio;
    }
  }

  const effectivePrice = Math.max(0, originalUnitPrice - unitDiscount);
  return { effectivePrice, unitDiscount, netUnitPrice: effectivePrice };
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

/**
 * Calculates Unit Cost for a line item based on Base Product Cost and Unit Conversion Rate
 * - Base Unit (e.g. 1 Cube): uses baseCost directly (Rs. 2,000.00)
 * - Sub-Unit (e.g. Bucket where 1 Cube = 506 Buckets): unitCost = baseCost / conversionRate (2000 / 506 = Rs. 3.95)
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

  return conversionRate > 0 ? baseCost / conversionRate : baseCost;
}
