import { describe, it, expect } from 'vitest';
import { computeUnifiedMetrics } from '../unifiedMetrics';
import { getItemUnitCost } from '../accounting';
import { formatStock } from '../formatters';

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

  it('includes cash exchange top-ups without double-deducting return credit on cashDrawableBalance and totalRevenueCollected', () => {
    const sandSk129 = {
      id: 'p_1795707526939',
      sku: 'SK129',
      name: 'Sand',
      category: 'MEASURING',
      unit: 'Cube',
      price: 10000,
      cost_price: 5000,
      stock: 1.999,
      measure_details: JSON.stringify({
        conversionRate: 1000,
        conversions: [
          { unit: 'Bucket', kgVal: 250, price: 60 },
          { unit: 'Shovel', kgVal: 1000, price: 15 },
          { unit: 'Thachi', kgVal: 250, price: 60 }
        ]
      })
    };

    const metrics = computeUnifiedMetrics({
      sales: [
        {
          id: 's_1',
          invoice_no: 'POS1-INV-00001',
          payment_method: 'Cash',
          status: 'Partially Returned',
          subtotal: 750,
          discount: 0,
          total_amount: 750,
          payment_received: 0,
          created_at: '2026-11-26T15:47:23.359Z',
          items: [{ productId: 'p-drill', qty: 3, price: 250, costPrice: 150, total: 750 }]
        },
        {
          id: 's_2',
          invoice_no: 'POS1-INV-00002',
          payment_method: 'Cash',
          status: 'Partially Returned',
          subtotal: 300,
          discount: 0,
          total_amount: 300,
          payment_received: 0,
          created_at: '2026-11-26T15:50:32.035Z',
          items: [{ productId: 'p-paint', qty: 3, price: 100, costPrice: 80, total: 300 }]
        }
      ],
      salesReturns: [
        {
          id: 'sr_1',
          return_no: 'RET-173486',
          invoice_no: 'POS1-INV-00001',
          return_method: 'Cash Refund',
          return_amount: 250,
          exchange_amount: 0,
          balance_amount: -250,
          total_refunded: 250,
          customer_paid: 0,
          change_given: 0,
          difference_payment_method: 'Cash',
          is_credit: 0,
          created_at: '2026-11-26T15:49:33Z',
          returned_items: [{ productId: 'p-drill', qty: 1, price: 250, costPrice: 150, total: 250 }],
          exchange_items: []
        },
        {
          id: 'sr_2',
          return_no: 'RET-435324',
          invoice_no: 'POS1-INV-00002',
          return_method: 'Exchange',
          return_amount: 100,
          exchange_amount: 215,
          balance_amount: 115,
          total_refunded: 0,
          customer_paid: 115,
          change_given: 0,
          difference_payment_method: 'Cash',
          is_credit: 0,
          created_at: '2026-11-26T15:53:55Z',
          returned_items: [{ productId: 'p-paint', qty: 1, price: 100, costPrice: 80, total: 100 }],
          exchange_items: [
            { productId: 'p-pipe', qty: 1, price: 50, costPrice: 20, total: 50 },
            { productId: sandSk129.id, unit: 'Shovel', conversionRate: 1000, qty: 1, price: 15, total: 15 },
            { productId: 'p-hammer', qty: 1, price: 150, costPrice: 80, total: 150 }
          ]
        }
      ],
      creditPayments: [],
      transactions: [],
      products: [...products, sandSk129],
      fromDate: '2026-11-26',
      toDate: '2026-11-26'
    });

    // Cash collected: 750 + 300 + 115 (exchange top-up) - 250 (RET-173486 refund) = 915.00
    expect(metrics.cashBookBalance).toBeCloseTo(1165, 2);
    expect(metrics.cashDrawableBalance).toBeCloseTo(915, 2);
    expect(metrics.totalRevenueCollected).toBeCloseTo(915, 2);
    expect(metrics.grossSalesRevenue).toBeCloseTo(1265, 2);
    expect(metrics.netSalesRevenue).toBeCloseTo(915, 2);

    // Also verify Exchange where returned value exceeds replacement value only deducts net refund
    const refundExchangeMetrics = computeUnifiedMetrics({
      sales: [
        {
          id: 's_cash',
          invoice_no: 'POS1-INV-00010',
          payment_method: 'Cash',
          status: 'PAID',
          subtotal: 300,
          discount: 0,
          total_amount: 300,
          created_at: '2026-11-26T10:00:00Z',
          items: [{ productId: 'p-paint', qty: 3, price: 100, total: 300 }]
        }
      ],
      salesReturns: [
        {
          id: 'sr_down_exch',
          return_no: 'RET-999001',
          invoice_no: 'POS1-INV-00010',
          return_method: 'Exchange',
          return_amount: 200,
          exchange_amount: 50,
          balance_amount: -150,
          total_refunded: 150,
          customer_paid: 0,
          change_given: 0,
          difference_payment_method: 'Cash',
          is_credit: 0,
          created_at: '2026-11-26T11:00:00Z',
          returned_items: [{ productId: 'p-paint', qty: 2, price: 100, total: 200 }],
          exchange_items: [{ productId: 'p-pipe', qty: 1, price: 50, total: 50 }]
        }
      ],
      creditPayments: [],
      transactions: [],
      products,
      fromDate: '2026-11-26',
      toDate: '2026-11-26'
    });
    expect(refundExchangeMetrics.cashDrawableBalance).toBeCloseTo(150, 2);
    expect(refundExchangeMetrics.totalRevenueCollected).toBeCloseTo(150, 2);
  });

  it('preserves sub-cube fractional stock precision (e.g. 1.999 Cube after 1 Shovel deduction)', () => {
    expect(formatStock(1.999, 'Cube')).toBe('1.999');
    expect(formatStock(2 - 0.001, 'Cube')).toBe('1.999');
    expect(formatStock(1.996, 'CUBE')).toBe('1.996');
    expect(formatStock(2, 'Cube')).toBe('2.00');
    expect(formatStock(1.999, 'kg')).toBe('1.999');
    expect(formatStock(5, 'pcs')).toBe('5');
  });
});
