import type {
  Product,
  Customer,
  Supplier,
  SaleOrder,
  PurchaseOrder,
  Employee,
  Transaction,
  User } from
'../types';

export const mockProducts: Product[] = [
{
  id: 'p1',
  name: 'Power Drill 18V',
  sku: 'PD-001',
  category: 'Power Tools',
  price: 89.99,
  costPrice: 55,
  stock: 45,
  minStock: 10,
  supplier: 'ToolMaster Inc.',
  unit: 'pcs',
  barcode: '8901234567890'
},
{
  id: 'p2',
  name: 'Hammer 16oz',
  sku: 'HM-001',
  category: 'Hand Tools',
  price: 12.99,
  costPrice: 7,
  stock: 8,
  minStock: 15,
  supplier: 'ToolMaster Inc.',
  unit: 'pcs',
  barcode: '8901234567891'
},
{
  id: 'p3',
  name: 'PVC Pipe 1/2"',
  sku: 'PP-001',
  category: 'Plumbing',
  price: 3.49,
  costPrice: 1.5,
  stock: 200,
  minStock: 50,
  supplier: 'PlumbPro Wholesale',
  unit: 'ft',
  barcode: '8901234567892'
},
{
  id: 'p4',
  name: 'Circuit Breaker 20A',
  sku: 'CB-001',
  category: 'Electrical',
  price: 24.99,
  costPrice: 14,
  stock: 30,
  minStock: 10,
  supplier: 'ElectroParts Co.',
  unit: 'pcs',
  barcode: '8901234567893'
},
{
  id: 'p5',
  name: 'Wood Screws 2"',
  sku: 'WS-001',
  category: 'Fasteners',
  price: 8.99,
  costPrice: 4,
  stock: 500,
  minStock: 100,
  supplier: 'BuildRight Supply',
  unit: 'box',
  barcode: '8901234567894'
},
{
  id: 'p6',
  name: 'Paint Brush Set',
  sku: 'PB-001',
  category: 'Painting',
  price: 15.99,
  costPrice: 8,
  stock: 3,
  minStock: 10,
  supplier: 'BuildRight Supply',
  unit: 'set',
  barcode: '8901234567895'
},
{
  id: 'p7',
  name: 'Measuring Tape 25ft',
  sku: 'MT-001',
  category: 'Measuring',
  price: 18.99,
  costPrice: 10,
  stock: 25,
  minStock: 10,
  supplier: 'ToolMaster Inc.',
  unit: 'pcs',
  barcode: '8901234567896'
},
{
  id: 'p8',
  name: 'Safety Helmet',
  sku: 'SH-001',
  category: 'Safety',
  price: 22.99,
  costPrice: 12,
  stock: 40,
  minStock: 15,
  supplier: 'SafetyFirst Ltd.',
  unit: 'pcs',
  barcode: '8901234567897'
},
{
  id: 'p9',
  name: 'Angle Grinder 4.5"',
  sku: 'AG-001',
  category: 'Power Tools',
  price: 65.99,
  costPrice: 40,
  stock: 12,
  minStock: 5,
  supplier: 'ToolMaster Inc.',
  unit: 'pcs',
  barcode: '8901234567898'
},
{
  id: 'p10',
  name: 'PVC Elbow 90°',
  sku: 'PE-001',
  category: 'Plumbing',
  price: 1.99,
  costPrice: 0.8,
  stock: 150,
  minStock: 30,
  supplier: 'PlumbPro Wholesale',
  unit: 'pcs',
  barcode: '8901234567899'
},
{
  id: 'p11',
  name: 'Wire 12AWG',
  sku: 'WR-001',
  category: 'Electrical',
  price: 45.99,
  costPrice: 28,
  stock: 60,
  minStock: 20,
  supplier: 'ElectroParts Co.',
  unit: 'roll',
  barcode: '8901234567900'
},
{
  id: 'p12',
  name: 'Sandpaper 120 Grit',
  sku: 'SP-001',
  category: 'Abrasives',
  price: 5.99,
  costPrice: 2.5,
  stock: 80,
  minStock: 25,
  supplier: 'BuildRight Supply',
  unit: 'pack',
  barcode: '8901234567901'
},
{
  id: 'p13',
  name: 'Level 24"',
  sku: 'LV-001',
  category: 'Measuring',
  price: 29.99,
  costPrice: 16,
  stock: 18,
  minStock: 8,
  supplier: 'ToolMaster Inc.',
  unit: 'pcs',
  barcode: '8901234567902'
},
{
  id: 'p14',
  name: 'Work Gloves',
  sku: 'WG-001',
  category: 'Safety',
  price: 9.99,
  costPrice: 5,
  stock: 55,
  minStock: 20,
  supplier: 'SafetyFirst Ltd.',
  unit: 'pair',
  barcode: '8901234567903'
},
{
  id: 'p15',
  name: 'Caulk Gun',
  sku: 'CG-001',
  category: 'Hand Tools',
  price: 14.99,
  costPrice: 7.5,
  stock: 22,
  minStock: 8,
  supplier: 'BuildRight Supply',
  unit: 'pcs',
  barcode: '8901234567904'
}];


export const mockCustomers: Customer[] = [
{
  id: 'c1',
  name: 'John Smith',
  email: 'john@email.com',
  phone: '555-0101',
  address: '123 Main St, Springfield',
  loyaltyPoints: 450,
  totalPurchases: 1250.0,
  joinDate: '2023-03-15'
},
{
  id: 'c2',
  name: 'Maria Garcia',
  email: 'maria@email.com',
  phone: '555-0102',
  address: '456 Oak Ave, Riverside',
  loyaltyPoints: 1200,
  totalPurchases: 3800.0,
  joinDate: '2022-11-08'
},
{
  id: 'c3',
  name: 'Bob Johnson',
  email: 'bob@email.com',
  phone: '555-0103',
  address: '789 Pine Rd, Lakewood',
  loyaltyPoints: 80,
  totalPurchases: 320.0,
  joinDate: '2024-01-22'
},
{
  id: 'c4',
  name: 'Sarah Williams',
  email: 'sarah@email.com',
  phone: '555-0104',
  address: '321 Elm St, Hillside',
  loyaltyPoints: 650,
  totalPurchases: 2100.0,
  joinDate: '2023-06-30'
},
{
  id: 'c5',
  name: 'Mike Davis',
  email: 'mike@email.com',
  phone: '555-0105',
  address: '654 Maple Dr, Greenfield',
  loyaltyPoints: 200,
  totalPurchases: 780.0,
  joinDate: '2023-09-14'
},
{
  id: 'c6',
  name: 'Lisa Chen',
  email: 'lisa@email.com',
  phone: '555-0106',
  address: '987 Cedar Ln, Westbrook',
  loyaltyPoints: 900,
  totalPurchases: 2950.0,
  joinDate: '2022-08-05'
},
{
  id: 'c7',
  name: 'Tom Wilson',
  email: 'tom@email.com',
  phone: '555-0107',
  address: '147 Birch Blvd, Eastview',
  loyaltyPoints: 150,
  totalPurchases: 540.0,
  joinDate: '2023-12-01'
},
{
  id: 'c8',
  name: 'Emma Brown',
  email: 'emma@email.com',
  phone: '555-0108',
  address: '258 Walnut Way, Northgate',
  loyaltyPoints: 320,
  totalPurchases: 1100.0,
  joinDate: '2023-07-19'
}];


export const mockSuppliers: Supplier[] = [
{
  id: 's1',
  name: 'ToolMaster Inc.',
  contact: 'James Lee',
  email: 'james@toolmaster.com',
  phone: '555-1001',
  address: '100 Industrial Blvd, Metro City',
  totalOrders: 48,
  balance: 2400
},
{
  id: 's2',
  name: 'BuildRight Supply',
  contact: 'Carol White',
  email: 'carol@buildright.com',
  phone: '555-1002',
  address: '200 Commerce St, Trade Park',
  totalOrders: 32,
  balance: 0
},
{
  id: 's3',
  name: 'ElectroParts Co.',
  contact: 'David Kim',
  email: 'david@electroparts.com',
  phone: '555-1003',
  address: '300 Tech Ave, Silicon Valley',
  totalOrders: 27,
  balance: 1800
},
{
  id: 's4',
  name: 'SafetyFirst Ltd.',
  contact: 'Anna Jones',
  email: 'anna@safetyfirst.com',
  phone: '555-1004',
  address: '400 Safety Rd, Protectville',
  totalOrders: 15,
  balance: 500
},
{
  id: 's5',
  name: 'PlumbPro Wholesale',
  contact: 'Mark Taylor',
  email: 'mark@plumbpro.com',
  phone: '555-1005',
  address: '500 Pipe Lane, Watertown',
  totalOrders: 22,
  balance: 0
}];


export const mockSaleOrders: SaleOrder[] = [
{
  id: 'so1',
  invoiceNo: 'INV-2024-001',
  customer_id: 'c1',
  customerName: 'John Smith',
  items: [
  {
    productId: 'p1',
    productName: 'Power Drill 18V',
    qty: 1,
    price: 89.99,
    total: 89.99,
    taxRate: 0
  },
  {
    productId: 'p7',
    productName: 'Measuring Tape 25ft',
    qty: 2,
    price: 18.99,
    total: 37.98,
    taxRate: 0
  }],

  subtotal: 127.97,
  discount: 5,
  tax: 9.86,
  total: 132.83,
  status: 'paid',
  date: '2024-06-28',
  cashier: 'Jennifer Lee'
},
{
  id: 'so2',
  invoiceNo: 'INV-2024-002',
  customer_id: 'c2',
  customerName: 'Maria Garcia',
  items: [
  {
    productId: 'p4',
    productName: 'Circuit Breaker 20A',
    qty: 3,
    price: 24.99,
    total: 74.97,
    taxRate: 0
  },
  {
    productId: 'p11',
    productName: 'Wire 12AWG',
    qty: 2,
    price: 45.99,
    total: 91.98,
    taxRate: 0
  }],

  subtotal: 166.95,
  discount: 10,
  tax: 14.33,
  total: 171.28,
  status: 'paid',
  date: '2024-06-27',
  cashier: 'Jennifer Lee'
},
{
  id: 'so3',
  invoiceNo: 'INV-2024-003',
  customer_id: 'c3',
  customerName: 'Bob Johnson',
  items: [
  {
    productId: 'p5',
    productName: 'Wood Screws 2"',
    qty: 5,
    price: 8.99,
    total: 44.95,
    taxRate: 0
  },
  {
    productId: 'p12',
    productName: 'Sandpaper 120 Grit',
    qty: 3,
    price: 5.99,
    total: 17.97,
    taxRate: 0
  }],

  subtotal: 62.92,
  discount: 0,
  tax: 5.03,
  total: 67.95,
  status: 'pending',
  date: '2024-06-27',
  cashier: 'Steven Clark'
},
{
  id: 'so4',
  invoiceNo: 'INV-2024-004',
  customer_id: 'c4',
  customerName: 'Sarah Williams',
  items: [
  {
    productId: 'p9',
    productName: 'Angle Grinder 4.5"',
    qty: 1,
    price: 65.99,
    total: 65.99,
    taxRate: 0
  },
  {
    productId: 'p8',
    productName: 'Safety Helmet',
    qty: 2,
    price: 22.99,
    total: 45.98,
    taxRate: 0
  },
  {
    productId: 'p14',
    productName: 'Work Gloves',
    qty: 3,
    price: 9.99,
    total: 29.97,
    taxRate: 0
  }],

  subtotal: 141.94,
  discount: 8,
  tax: 10.87,
  total: 144.17,
  status: 'paid',
  date: '2024-06-26',
  cashier: 'Jennifer Lee'
},
{
  id: 'so5',
  invoiceNo: 'INV-2024-005',
  customer_id: 'c5',
  customerName: 'Mike Davis',
  items: [
  {
    productId: 'p3',
    productName: 'PVC Pipe 1/2"',
    qty: 20,
    price: 3.49,
    total: 69.8,
    taxRate: 0
  },
  {
    productId: 'p10',
    productName: 'PVC Elbow 90°',
    qty: 10,
    price: 1.99,
    total: 19.9,
    taxRate: 0
  }],

  subtotal: 89.7,
  discount: 0,
  tax: 7.18,
  total: 96.88,
  status: 'paid',
  date: '2024-06-25',
  cashier: 'Steven Clark'
},
{
  id: 'so6',
  invoiceNo: 'INV-2024-006',
  customer_id: 'c6',
  customerName: 'Lisa Chen',
  items: [
  {
    productId: 'p1',
    productName: 'Power Drill 18V',
    qty: 2,
    price: 89.99,
    total: 179.98,
    taxRate: 0
  },
  {
    productId: 'p13',
    productName: 'Level 24"',
    qty: 1,
    price: 29.99,
    total: 29.99,
    taxRate: 0
  }],

  subtotal: 209.97,
  discount: 15,
  tax: 16.65,
  total: 211.12,
  status: 'paid',
  date: '2024-06-24',
  cashier: 'Jennifer Lee'
},
{
  id: 'so7',
  invoiceNo: 'INV-2024-007',
  customer_id: 'c7',
  customerName: 'Tom Wilson',
  items: [
  {
    productId: 'p2',
    productName: 'Hammer 16oz',
    qty: 2,
    price: 12.99,
    total: 25.98,
    taxRate: 0
  },
  {
    productId: 'p15',
    productName: 'Caulk Gun',
    qty: 1,
    price: 14.99,
    total: 14.99,
    taxRate: 0
  }],

  subtotal: 40.97,
  discount: 0,
  tax: 3.28,
  total: 44.25,
  status: 'cancelled',
  date: '2024-06-23',
  cashier: 'Steven Clark'
},
{
  id: 'so8',
  invoiceNo: 'INV-2024-008',
  customer_id: 'c8',
  customerName: 'Emma Brown',
  items: [
  {
    productId: 'p6',
    productName: 'Paint Brush Set',
    qty: 2,
    price: 15.99,
    total: 31.98,
    taxRate: 0
  },
  {
    productId: 'p12',
    productName: 'Sandpaper 120 Grit',
    qty: 4,
    price: 5.99,
    total: 23.96,
    taxRate: 0
  }],

  subtotal: 55.94,
  discount: 5,
  tax: 4.29,
  total: 55.23,
  status: 'paid',
  date: '2024-06-22',
  cashier: 'Jennifer Lee'
},
{
  id: 'so9',
  invoiceNo: 'INV-2024-009',
  customer_id: 'c1',
  customerName: 'John Smith',
  items: [
  {
    productId: 'p4',
    productName: 'Circuit Breaker 20A',
    qty: 2,
    price: 24.99,
    total: 49.98,
    taxRate: 0
  }],

  subtotal: 49.98,
  discount: 0,
  tax: 4.0,
  total: 53.98,
  status: 'pending',
  date: '2024-06-21',
  cashier: 'Steven Clark'
},
{
  id: 'so10',
  invoiceNo: 'INV-2024-010',
  customer_id: 'c2',
  customerName: 'Maria Garcia',
  items: [
  {
    productId: 'p8',
    productName: 'Safety Helmet',
    qty: 5,
    price: 22.99,
    total: 114.95,
    taxRate: 0
  },
  {
    productId: 'p14',
    productName: 'Work Gloves',
    qty: 5,
    price: 9.99,
    total: 49.95,
    taxRate: 0
  }],

  subtotal: 164.9,
  discount: 10,
  tax: 13.59,
  total: 168.49,
  status: 'paid',
  date: '2024-06-20',
  cashier: 'Jennifer Lee'
}];


export const mockPurchaseOrders: PurchaseOrder[] = [
{
  id: 'po1',
  poNumber: 'PO-2024-001',
  supplierId: 's1',
  supplierName: 'ToolMaster Inc.',
  items: [
  {
    productId: 'p1',
    productName: 'Power Drill 18V',
    qty: 20,
    costPrice: 55,
    total: 1100
  },
  {
    productId: 'p9',
    productName: 'Angle Grinder 4.5"',
    qty: 10,
    costPrice: 40,
    total: 400
  }],

  total: 1500,
  status: 'received',
  date: '2024-06-15',
  dueDate: '2024-07-15'
},
{
  id: 'po2',
  poNumber: 'PO-2024-002',
  supplierId: 's3',
  supplierName: 'ElectroParts Co.',
  items: [
  {
    productId: 'p4',
    productName: 'Circuit Breaker 20A',
    qty: 30,
    costPrice: 14,
    total: 420
  },
  {
    productId: 'p11',
    productName: 'Wire 12AWG',
    qty: 20,
    costPrice: 28,
    total: 560
  }],

  total: 980,
  status: 'pending',
  date: '2024-06-20',
  dueDate: '2024-07-20'
},
{
  id: 'po3',
  poNumber: 'PO-2024-003',
  supplierId: 's5',
  supplierName: 'PlumbPro Wholesale',
  items: [
  {
    productId: 'p3',
    productName: 'PVC Pipe 1/2"',
    qty: 100,
    costPrice: 1.5,
    total: 150
  },
  {
    productId: 'p10',
    productName: 'PVC Elbow 90°',
    qty: 200,
    costPrice: 0.8,
    total: 160
  }],

  total: 310,
  status: 'received',
  date: '2024-06-10',
  dueDate: '2024-07-10'
},
{
  id: 'po4',
  poNumber: 'PO-2024-004',
  supplierId: 's2',
  supplierName: 'BuildRight Supply',
  items: [
  {
    productId: 'p5',
    productName: 'Wood Screws 2"',
    qty: 50,
    costPrice: 4,
    total: 200
  },
  {
    productId: 'p6',
    productName: 'Paint Brush Set',
    qty: 20,
    costPrice: 8,
    total: 160
  }],

  total: 360,
  status: 'pending',
  date: '2024-06-25',
  dueDate: '2024-07-25'
},
{
  id: 'po5',
  poNumber: 'PO-2024-005',
  supplierId: 's4',
  supplierName: 'SafetyFirst Ltd.',
  items: [
  {
    productId: 'p8',
    productName: 'Safety Helmet',
    qty: 25,
    costPrice: 12,
    total: 300
  },
  {
    productId: 'p14',
    productName: 'Work Gloves',
    qty: 30,
    costPrice: 5,
    total: 150
  }],

  total: 450,
  status: 'received',
  date: '2024-06-05',
  dueDate: '2024-07-05'
},
{
  id: 'po6',
  poNumber: 'PO-2024-006',
  supplierId: 's1',
  supplierName: 'ToolMaster Inc.',
  items: [
  {
    productId: 'p2',
    productName: 'Hammer 16oz',
    qty: 30,
    costPrice: 7,
    total: 210
  },
  {
    productId: 'p7',
    productName: 'Measuring Tape 25ft',
    qty: 20,
    costPrice: 10,
    total: 200
  }],

  total: 410,
  status: 'pending',
  date: '2024-06-28',
  dueDate: '2024-07-28'
}];


export const mockEmployees: Employee[] = [
{
  id: 'e1',
  name: 'Carlos Mendez',
  role: 'Manager',
  department: 'Management',
  email: 'carlos@shop.com',
  phone: '555-2001',
  salary: 4500,
  joinDate: '2021-03-10',
  status: 'active',
  attendance: 96
},
{
  id: 'e2',
  name: 'Jennifer Lee',
  role: 'Cashier',
  department: 'Sales',
  email: 'jennifer@shop.com',
  phone: '555-2002',
  salary: 2800,
  joinDate: '2022-06-15',
  status: 'active',
  attendance: 98
},
{
  id: 'e3',
  name: 'Robert Kim',
  role: 'Inventory Clerk',
  department: 'Warehouse',
  email: 'robert@shop.com',
  phone: '555-2003',
  salary: 2600,
  joinDate: '2022-09-01',
  status: 'active',
  attendance: 94
},
{
  id: 'e4',
  name: 'Patricia Moore',
  role: 'Accountant',
  department: 'Finance',
  email: 'patricia@shop.com',
  phone: '555-2004',
  salary: 3200,
  joinDate: '2021-11-20',
  status: 'active',
  attendance: 97
},
{
  id: 'e5',
  name: 'Steven Clark',
  role: 'Sales Associate',
  department: 'Sales',
  email: 'steven@shop.com',
  phone: '555-2005',
  salary: 2900,
  joinDate: '2023-02-14',
  status: 'active',
  attendance: 91
},
{
  id: 'e6',
  name: 'Amanda White',
  role: 'HR Manager',
  department: 'Human Resources',
  email: 'amanda@shop.com',
  phone: '555-2006',
  salary: 3800,
  joinDate: '2021-07-05',
  status: 'active',
  attendance: 99
}];


export const mockTransactions: Transaction[] = [
{
  id: 't1',
  type: 'income',
  category: 'Sales',
  description: 'Daily sales revenue',
  amount: 2847.5,
  date: '2024-06-28',
  reference: 'SALES-0628'
},
{
  id: 't2',
  type: 'expense',
  category: 'Rent',
  description: 'Monthly shop rent',
  amount: 3500.0,
  date: '2024-06-01',
  reference: 'RENT-JUN'
},
{
  id: 't3',
  type: 'income',
  category: 'Sales',
  description: 'Daily sales revenue',
  amount: 3120.0,
  date: '2024-06-27',
  reference: 'SALES-0627'
},
{
  id: 't4',
  type: 'expense',
  category: 'Utilities',
  description: 'Electricity bill',
  amount: 420.0,
  date: '2024-06-05',
  reference: 'UTIL-0605'
},
{
  id: 't5',
  type: 'expense',
  category: 'Salaries',
  description: 'Staff salaries - June',
  amount: 19800.0,
  date: '2024-06-30',
  reference: 'SAL-JUN'
},
{
  id: 't6',
  type: 'income',
  category: 'Sales',
  description: 'Daily sales revenue',
  amount: 2650.0,
  date: '2024-06-26',
  reference: 'SALES-0626'
},
{
  id: 't7',
  type: 'expense',
  category: 'Purchases',
  description: 'Inventory purchase - ToolMaster',
  amount: 1500.0,
  date: '2024-06-15',
  reference: 'PO-2024-001'
},
{
  id: 't8',
  type: 'income',
  category: 'Sales',
  description: 'Daily sales revenue',
  amount: 1980.0,
  date: '2024-06-25',
  reference: 'SALES-0625'
},
{
  id: 't9',
  type: 'expense',
  category: 'Purchases',
  description: 'Inventory purchase - PlumbPro',
  amount: 310.0,
  date: '2024-06-10',
  reference: 'PO-2024-003'
},
{
  id: 't10',
  type: 'expense',
  category: 'Marketing',
  description: 'Social media ads',
  amount: 250.0,
  date: '2024-06-12',
  reference: 'MKT-0612'
},
{
  id: 't11',
  type: 'income',
  category: 'Sales',
  description: 'Daily sales revenue',
  amount: 3450.0,
  date: '2024-06-24',
  reference: 'SALES-0624'
},
{
  id: 't12',
  type: 'expense',
  category: 'Maintenance',
  description: 'Shop equipment repair',
  amount: 180.0,
  date: '2024-06-18',
  reference: 'MAINT-0618'
},
{
  id: 't13',
  type: 'income',
  category: 'Sales',
  description: 'Daily sales revenue',
  amount: 2200.0,
  date: '2024-06-23',
  reference: 'SALES-0623'
},
{
  id: 't14',
  type: 'expense',
  category: 'Purchases',
  description: 'Inventory purchase - SafetyFirst',
  amount: 450.0,
  date: '2024-06-05',
  reference: 'PO-2024-005'
},
{
  id: 't15',
  type: 'income',
  category: 'Sales',
  description: 'Daily sales revenue',
  amount: 1875.0,
  date: '2024-06-22',
  reference: 'SALES-0622'
}];


export const mockUsers: User[] = [
{
  id: 'u1',
  name: 'Admin User',
  email: 'admin@shop.com',
  role: 'Admin',
  avatar: 'AU'
},
{
  id: 'u2',
  name: 'Carlos Mendez',
  email: 'manager@shop.com',
  role: 'Manager',
  avatar: 'CM'
},
{
  id: 'u3',
  name: 'Jennifer Lee',
  email: 'cashier@shop.com',
  role: 'Cashier',
  avatar: 'JL'
}];


export const mockCredentials: Record<string, string> = {
  'admin@shop.com': 'admin123',
  'manager@shop.com': 'mgr123',
  'cashier@shop.com': 'cash123'
};

export const monthlySalesData = [
{ month: 'Jan', revenue: 18500, expenses: 14200 },
{ month: 'Feb', revenue: 22300, expenses: 15800 },
{ month: 'Mar', revenue: 19800, expenses: 14900 },
{ month: 'Apr', revenue: 25600, expenses: 17200 },
{ month: 'May', revenue: 28900, expenses: 18500 },
{ month: 'Jun', revenue: 31200, expenses: 19800 }];


export const categorySalesData = [
{ name: 'Power Tools', value: 35, color: '#f97316' },
{ name: 'Hand Tools', value: 20, color: '#3b82f6' },
{ name: 'Plumbing', value: 15, color: '#22c55e' },
{ name: 'Electrical', value: 18, color: '#a855f7' },
{ name: 'Safety', value: 12, color: '#f59e0b' }];


export const dailySalesData = [
{ day: 'Mon', sales: 3200 },
{ day: 'Tue', sales: 2800 },
{ day: 'Wed', sales: 3600 },
{ day: 'Thu', sales: 2400 },
{ day: 'Fri', sales: 4100 },
{ day: 'Sat', sales: 5200 },
{ day: 'Sun', sales: 1800 }];