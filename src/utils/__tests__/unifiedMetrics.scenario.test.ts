import { describe, it, expect } from 'vitest';
import { computeUnifiedMetrics } from '../unifiedMetrics';
import { getItemUnitCost } from '../accounting';

describe('Muthuwadige Hardware - Unified POS & Inventory Scenarios', () => {
  const products = [
    {
      id: 'p-drill',
      sku: 'PT-BOS-001',
      name: 'Bosch GSB 550 Drill Machine',
      category: 'POWER TOOLS',
      unit: 'pcs',
      price: 250,
      cost_price: 150,
      stock: 6,
      min_stock: 2
    },
    {
      id: 'p-paint',
      sku: 'PT-NIP-004',
      name: 'Nippon Weatherbond Exterior Paint 4L',
      category: 'PAINTING',
      unit: 'pcs',
      price: 100,
      cost_price: 80,
      stock: 9,
      min_stock: 5
    },
    {
      id: 'p-pipe',
      sku: 'PL-PVC-003',
      name: 'PVC Water Pipe 1/2"',
      category: 'PLUMBING',
      unit: 'pcs',
      price: 50,
      cost_price: 20,
      stock: 10,
      min_stock: 5
    },
    {
      id: 'p-sand',
      sku: 'SK156',
      name: 'Sand',
      category: 'MEASURING',
      unit: 'CUBE',
      price: 10000,
      cost_price: 5000,
      stock: 1.996,
      min_stock: 1
    },
    {
      id: 'p-hammer',
      sku: 'HT-STA-002',
      name: 'Stanley Claw Hammer 16oz',
      category: 'HAND TOOLS',
      unit: 'pcs',
      price: 150,
      cost_price: 80,
      stock: 9,
      min_stock: 5
    }
  ];

  it('computes exact sub-unit costs for Sand (1 CUBE = 1000kg = 250 Buckets / 1000 Shovels / 250 Thachi)', () => {
    const sand = products.find((p) => p.sku === 'SK156');
    expect(getItemUnitCost(sand, 'Bucket', 1 / 250, 20)).toBeCloseTo(20, 2);
    expect(getItemUnitCost(sand, 'Shovel', 1 / 1000, 5)).toBeCloseTo(5, 2);
    expect(getItemUnitCost(sand, 'Thachi', 1 / 250, 20)).toBeCloseTo(20, 2);
  });

  it('reconciles cash sale + cash refund + credit sale + credit exchange without inflating order counts', () => {
    const sales = [
      {
        id: 's1',
        invoice_no: 'POS1-INV-00001',
        customer_name: 'Kasun Perera',
        payment_method: 'CASH',
        status: 'PAID',
        subtotal: 750,
        discount: 6,
        transportation_fee: 0,
        total_amount: 744,
        payment_received: 744,
        created_at: '2026-11-23T22:50:57+05:30',
        items: [
          {
            productId: 'p-drill',
            productName: 'Bosch GSB 550 Drill Machine',
            qty: 3,
            price: 250,
            costPrice: 150,
            total: 750
          }
        ]
      },
      {
        id: 's2',
        invoice_no: 'POS1-INV-00002',
        customer_name: 'Nimali Fernando',
        payment_method: 'CREDIT',
        status: 'UNPAID',
        subtotal: 750,
        discount: 6,
        transportation_fee: 1,
        total_amount: 745,
        remaining_balance: 807,
        created_at: '2026-11-23T22:58:00+05:30',
        items: [
          {
            productId: 'p-drill',
            productName: 'Bosch GSB 550 Drill Machine',
            qty: 3,
            price: 250,
            costPrice: 150,
            total: 750
          }
        ]
      }
    ];

    const salesReturns = [
      {
        id: 'r1',
        return_no: 'RET-579466',
        invoice_no: 'POS1-INV-00001',
        return_type: 'Cash Refund',
        refund_method: 'Cash Refund',
        return_amount: 248,
        total_refunded: 248,
        created_at: '2026-11-23T22:52:59+05:30',
        items: [
          {
            productId: 'p-drill',
            productName: 'Bosch GSB 550 Drill Machine',
            qty: 1,
            price: 248,
            costPrice: 150,
            total: 248
          }
        ]
      },
      {
        id: 'r2',
        return_no: 'RET-061996',
        invoice_no: 'POS1-INV-00002',
        return_type: 'Exchange',
        settlement_mode: 'Customer Credit Debt',
        return_amount: 248,
        exchange_amount: 310,
        balance_amount: 62,
        created_at: '2026-11-23T23:01:02+05:30',
        items: [
          {
            productId: 'p-drill',
            productName: 'Bosch GSB 550 Drill Machine',
            qty: 1,
            price: 248,
            costPrice: 150,
            total: 248
          }
        ],
        replacementItems: [
          {
            productId: 'p-paint',
            productName: 'Nippon Weatherbond Exterior Paint 4L',
            qty: 1,
            price: 100,
            costPrice: 80,
            total: 100
          },
          {
            productId: 'p-hammer',
            productName: 'Stanley Claw Hammer 16oz',
            qty: 1,
            price: 150,
            costPrice: 80,
            total: 150
          },
          {
            productId: 'p-sand',
            productName: 'Sand (Bucket)',
            unit: 'Bucket',
            conversionRate: 1 / 250,
            qty: 1,
            price: 60,
            costPrice: 20,
            total: 60
          }
        ]
      }
    ];

    const metrics = computeUnifiedMetrics({
      sales,
      salesReturns,
      creditPayments: [],
      transactions: [],
      products,
      fromDate: '2026-11-23',
      toDate: '2026-11-23'
    });

    expect(metrics.grossSalesRevenue).toBeCloseTo(1810, 2);
    expect(metrics.customerDiscounts).toBeCloseTo(12, 2);
    expect(metrics.salesReturnsRefunds).toBeCloseTo(496, 2);
    expect(metrics.transportFees).toBeCloseTo(1, 2);
    expect(metrics.netSalesRevenue).toBeCloseTo(1303, 2);
    expect(metrics.cogs).toBeCloseTo(780, 2);
    expect(metrics.grossProfit).toBeCloseTo(523, 2);
    expect(metrics.totalOrders).toBe(2);
    expect(metrics.paidOrders).toBe(1);
    expect(metrics.cashDrawableBalance).toBeCloseTo(496, 2);
  });
});
