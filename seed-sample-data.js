import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbs = [
  path.join(__dirname, 'hardware.db'),
  process.env.APPDATA ? path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', 'hardware.db') : null
].filter(Boolean);

async function seedDatabase(dbPath) {
  if (!fs.existsSync(dbPath)) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  console.log(`\n🌱 Seeding database: ${dbPath}`);
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  // 1. Create Schema Tables if not exist
  await db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      notes TEXT,
      credit_period INTEGER DEFAULT 30,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      nic TEXT,
      loyalty_points INTEGER DEFAULT 0,
      notes TEXT,
      credit_limit REAL DEFAULT 0,
      current_credit REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
      barcode TEXT,
      category TEXT,
      price REAL NOT NULL,
      cost_price REAL NOT NULL,
      stock REAL NOT NULL,
      unit TEXT DEFAULT 'pcs',
      min_stock_level REAL DEFAULT 10,
      supplier TEXT,
      brand TEXT,
      notes TEXT,
      measure_details TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      invoice_no TEXT UNIQUE,
      customer_id TEXT,
      customer_name TEXT,
      items TEXT NOT NULL,
      subtotal REAL NOT NULL,
      tax REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      payment_received REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'Cash',
      status TEXT DEFAULT 'Paid',
      is_credit INTEGER DEFAULT 0,
      due_date TEXT,
      credit_period_days INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales_returns (
      id TEXT PRIMARY KEY,
      invoice_no TEXT NOT NULL,
      customer_name TEXT,
      returned_items TEXT,
      exchange_items TEXT,
      return_amount REAL DEFAULT 0,
      exchange_amount REAL DEFAULT 0,
      customer_paid REAL DEFAULT 0,
      refund_given REAL DEFAULT 0,
      credit_note_issued REAL DEFAULT 0,
      reason TEXT,
      status TEXT DEFAULT 'approved',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      po_number TEXT UNIQUE,
      supplier_id TEXT,
      supplier_name TEXT,
      items TEXT,
      total REAL NOT NULL,
      status TEXT DEFAULT 'Pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      reference TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      old_stock REAL NOT NULL,
      new_stock REAL NOT NULL,
      type TEXT NOT NULL,
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quotations (
      id TEXT PRIMARY KEY,
      quote_no TEXT UNIQUE,
      customer_name TEXT,
      customer_phone TEXT,
      items TEXT,
      subtotal REAL,
      tax REAL,
      discount REAL,
      total REAL,
      status TEXT DEFAULT 'Sent',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS delivery_notes (
      id TEXT PRIMARY KEY,
      dn_no TEXT UNIQUE,
      customer_name TEXT,
      items TEXT,
      reference_invoice TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bill_holds (
      id TEXT PRIMARY KEY,
      hold_name TEXT,
      customer_id TEXT,
      customer_name TEXT,
      items TEXT,
      subtotal REAL,
      discount REAL,
      tax REAL DEFAULT 0,
      total_amount REAL,
      transportation_fee REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      salary REAL DEFAULT 0,
      status TEXT DEFAULT 'Active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY,
      shop_name TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      currency TEXT DEFAULT 'Rs.',
      tax_rate REAL DEFAULT 0,
      backup_email TEXT,
      backup_enabled INTEGER DEFAULT 0,
      logo_path TEXT,
      printer_settings TEXT,
      branch_settings TEXT,
      next_invoice_number TEXT DEFAULT 'INV-007',
      return_passkey TEXT DEFAULT '1234',
      void_passkey TEXT DEFAULT '1234',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_email TEXT,
      action TEXT,
      details TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS backup_logs (
      id TEXT PRIMARY KEY,
      file_name TEXT,
      file_path TEXT,
      status TEXT,
      type TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Clear previous test records
  const tables = ['suppliers', 'customers', 'products', 'sales', 'sales_returns', 'purchase_orders', 'transactions', 'stock_adjustments', 'quotations', 'delivery_notes', 'employees', 'audit_logs'];
  for (const t of tables) {
    await db.run(`DELETE FROM ${t}`);
  }

  // 2. Seed Suppliers
  console.log('  -> Inserting 4 Suppliers...');
  const suppliers = [
    ['sup-1', 'Lanka Tools Suppliers', 'info@lankatools.lk', '0771234567', '12 Colombo Rd, Negombo', 'Primary power tool vendor', 30],
    ['sup-2', 'Siam City Cement PLC', 'sales@siamcement.lk', '0112445566', 'Baseline Rd, Colombo', 'INSEE Sanwa cement distributor', 15],
    ['sup-3', 'Nippon Paint Lanka', 'orders@nipponpaint.lk', '0117889900', 'Nawala, Rajagiriya', 'Paints & protective coatings', 30],
    ['sup-4', 'S-Lon Lanka PVC', 'support@slon.lk', '0114556677', 'Peliyagoda, Kelaniya', 'Pipes & plumbing fittings', 30]
  ];
  for (const s of suppliers) {
    await db.run('INSERT INTO suppliers (id, name, email, phone, address, notes, credit_period) VALUES (?, ?, ?, ?, ?, ?, ?)', s);
  }

  // 3. Seed Customers
  console.log('  -> Inserting 4 Customers with Credit Balances...');
  const customers = [
    ['cust-1', 'Perera Construction Ltd', 'contact@pereraconstruction.com', '0775551122', 'Main St, Negombo', '200025603768', 120, 'Commercial contractor', 150000, 45000],
    ['cust-2', 'Fernando Builders', 'info@fernandobuilders.lk', '0768883344', 'Station Rd, Katunayake', '198514209988', 85, 'Residential builder', 100000, 22500],
    ['cust-3', 'Sunethra Hardware & Contractors', 'sunethra@gmail.com', '0712224455', 'Beach Rd, Kochchikade', '197945001122', 250, 'Regular wholesale customer', 200000, 0],
    ['cust-4', 'Amila Silva', 'amila.silva@gmail.com', '0759998877', 'Negombo Town', '199230104455', 40, 'Walk-in retail buyer', 0, 0]
  ];
  for (const c of customers) {
    await db.run('INSERT INTO customers (id, name, email, phone, address, nic, loyalty_points, notes, credit_limit, current_credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', c);
  }

  // 4. Seed Products
  console.log('  -> Inserting 8 Hardware Products...');
  const products = [
    ['prod-1', 'Bosch GSB 550 Impact Drill 13mm', 'SKU-DRILL-550', '8839201920', 'Power Tools', 18500, 12500, 15, 'pcs', 5, 'Lanka Tools Suppliers', 'Bosch', 'Heavy duty dual mode drill'],
    ['prod-2', 'Tokyu Angle Grinder 4 Inch', 'SKU-GRIND-40', '8839201921', 'Power Tools', 9500, 6200, 25, 'pcs', 8, 'Lanka Tools Suppliers', 'Tokyu', 'Compact 710W angle grinder'],
    ['prod-3', 'Sanwa Portland Cement 50kg Bag', 'SKU-CEM-50KG', '8839201922', 'Building Materials', 2450, 2150, 150, 'bags', 40, 'Siam City Cement PLC', 'INSEE', 'High strength premium cement'],
    ['prod-4', 'Fine River Sand (Cube)', 'SKU-SAND-CUBE', '8839201923', 'Raw Materials', 12000, 8500, 12, 'cube', 3, 'Local Pit Mines', 'Local', 'Washed fine river sand'],
    ['prod-5', 'S-Lon PVC Water Pipe 1/2" 4m', 'SKU-PVC-05', '8839201924', 'Plumbing', 650, 420, 120, 'length', 30, 'S-Lon Lanka PVC', 'S-Lon', 'Pressure rated PVC pipe'],
    ['prod-6', 'Nippon Weatherbond Exterior Paint 4L', 'SKU-PNT-4L', '8839201925', 'Paints', 7200, 5100, 18, 'cans', 5, 'Nippon Paint Lanka', 'Nippon', 'Weatherproof exterior emulsion'],
    ['prod-7', 'Brass Gate Valve 3/4" High Pressure', 'SKU-VALVE-075', '8839201926', 'Plumbing', 1350, 850, 40, 'pcs', 10, 'S-Lon Lanka PVC', 'Pegler', 'Heavy brass gate valve'],
    ['prod-8', 'Galvanized Steel Wire Mesh 1/2" (Roll)', 'SKU-MESH-ROLL', '8839201927', 'Hardware', 5200, 3400, 8, 'rolls', 4, 'Lanka Tools Suppliers', 'LankaMesh', '1/2 inch 30m wire mesh roll']
  ];
  for (const p of products) {
    await db.run('INSERT INTO products (id, name, sku, barcode, category, price, cost_price, stock, unit, min_stock_level, supplier, brand, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', p);
  }

  // 5. Seed Sales & Invoices
  console.log('  -> Inserting 6 Sales Invoices (Credit, Cash, Card, Bank Transfer)...');
  const sales = [
    [
      'sale-1', 'INV-001', 'cust-1', 'Perera Construction Ltd',
      JSON.stringify([{ productId: 'prod-3', name: 'Sanwa Portland Cement 50kg Bag', qty: 15, unitPrice: 2450, unit: 'bags' }, { productId: 'prod-5', name: 'S-Lon PVC Water Pipe 1/2" 4m', qty: 12, unitPrice: 650, unit: 'length' }]),
      44550, 0, 0, 45000, 0, 'Credit', 'Non Paid', 1, '2026-08-25', 15, '2026-08-10 10:30:00'
    ],
    [
      'sale-2', 'INV-002', 'cust-2', 'Fernando Builders',
      JSON.stringify([{ productId: 'prod-1', name: 'Bosch GSB 550 Impact Drill 13mm', qty: 1, unitPrice: 18500, unit: 'pcs' }, { productId: 'prod-7', name: 'Brass Gate Valve 3/4" High Pressure', qty: 10, unitPrice: 1350, unit: 'pcs' }]),
      32000, 0, 0, 32500, 10000, 'Credit', 'Partially Settled', 1, '2026-08-27', 15, '2026-08-12 14:15:00'
    ],
    [
      'sale-3', 'INV-003', 'cust-4', 'Amila Silva',
      JSON.stringify([{ productId: 'prod-1', name: 'Bosch GSB 550 Impact Drill 13mm', qty: 1, unitPrice: 18500, unit: 'pcs' }]),
      18500, 0, 0, 18500, 18500, 'Cash', 'Paid', 0, null, 0, '2026-08-15 09:45:00'
    ],
    [
      'sale-4', 'INV-004', 'cust-3', 'Sunethra Hardware & Contractors',
      JSON.stringify([{ productId: 'prod-6', name: 'Nippon Weatherbond Exterior Paint 4L', qty: 3, unitPrice: 7200, unit: 'cans' }, { productId: 'prod-8', name: 'Galvanized Steel Wire Mesh 1/2" (Roll)', qty: 1, unitPrice: 5200, unit: 'rolls' }, { productId: 'prod-5', name: 'S-Lon PVC Water Pipe 1/2" 4m', qty: 3, unitPrice: 650, unit: 'length' }]),
      28700, 0, 0, 28700, 28700, 'Card', 'Paid', 0, null, 0, '2026-08-16 11:20:00'
    ],
    [
      'sale-5', 'INV-005', 'cust-4', 'Amila Silva',
      JSON.stringify([{ productId: 'prod-4', name: 'Fine River Sand (Cube)', qty: 1, unitPrice: 12000, unit: 'cube' }, { productId: 'prod-3', name: 'Sanwa Portland Cement 50kg Bag', qty: 1, unitPrice: 2450, unit: 'bags' }]),
      14450, 0, 50, 14400, 14400, 'Bank Transfer', 'Paid', 0, null, 0, '2026-08-16 16:05:00'
    ],
    [
      'sale-6', 'INV-006', 'cust-2', 'Fernando Builders',
      JSON.stringify([{ productId: 'prod-2', name: 'Tokyu Angle Grinder 4 Inch', qty: 1, unitPrice: 9500, unit: 'pcs' }]),
      9500, 0, 0, 9500, 9500, 'Cash', 'Paid', 0, null, 0, '2026-08-17 08:50:00'
    ]
  ];
  for (const s of sales) {
    await db.run('INSERT INTO sales (id, invoice_no, customer_id, customer_name, items, subtotal, tax, discount, total_amount, payment_received, payment_method, status, is_credit, due_date, credit_period_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', s);
  }

  // 6. Seed Sales Return
  console.log('  -> Inserting Sales Returns...');
  await db.run(
    'INSERT INTO sales_returns (id, invoice_no, customer_name, returned_items, exchange_items, return_amount, exchange_amount, customer_paid, refund_given, credit_note_issued, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      'ret-1', 'INV-003', 'Amila Silva',
      JSON.stringify([{ productId: 'prod-2', productName: 'Tokyu Angle Grinder 4 Inch', qty: 1, unitPrice: 9500 }]),
      JSON.stringify([]),
      9500, 0, 0, 9500, 0, 'Customer requested exchange for cordless model', 'approved', '2026-08-16 14:00:00'
    ]
  );

  // 7. Seed Purchase Orders
  console.log('  -> Inserting Purchase Orders...');
  await db.run(
    'INSERT INTO purchase_orders (id, po_number, supplier_id, supplier_name, items, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['po-1', 'PO-001', 'sup-2', 'Siam City Cement PLC', JSON.stringify([{ productId: 'prod-3', productName: 'Sanwa Portland Cement 50kg Bag', qty: 100, unitCost: 2150 }]), 215000, 'Received', '2026-08-05 09:00:00']
  );
  await db.run(
    'INSERT INTO purchase_orders (id, po_number, supplier_id, supplier_name, items, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['po-2', 'PO-002', 'sup-3', 'Nippon Paint Lanka', JSON.stringify([{ productId: 'prod-6', productName: 'Nippon Weatherbond Exterior Paint 4L', qty: 20, unitCost: 5100 }]), 102000, 'Approved', '2026-08-14 11:30:00']
  );

  // 8. Seed Accounting Transactions
  console.log('  -> Inserting Accounting Ledger Transactions...');
  const transactions = [
    ['t-1', '2026-08-15', 'INCOME', 'Sales', 18500, 'POS Cash Sale INV-003', 'INV-003'],
    ['t-2', '2026-08-16', 'INCOME', 'Sales', 28700, 'POS Card Payment INV-004', 'INV-004'],
    ['t-3', '2026-08-16', 'INCOME', 'Sales', 14400, 'Bank Transfer Payment INV-005', 'INV-005'],
    ['t-4', '2026-08-11', 'EXPENSE', 'Utilities', 14200, 'CEB Electricity & Water Bill August 2026', 'UTIL-AUG26'],
    ['t-5', '2026-08-12', 'EXPENSE', 'Salaries', 65000, 'Staff Salary Advance & Payments', 'PAY-AUG26'],
    ['t-6', '2026-08-01', 'EXPENSE', 'Rent', 40000, 'Shop Building Monthly Rental', 'RENT-AUG26']
  ];
  for (const t of transactions) {
    await db.run('INSERT INTO transactions (id, date, type, category, amount, description, reference) VALUES (?, ?, ?, ?, ?, ?, ?)', t);
  }

  // 9. Seed Stock Adjustments & Quotations & Delivery Notes
  console.log('  -> Inserting Stock Adjustments, Quotations & Delivery Notes...');
  await db.run(
    'INSERT INTO stock_adjustments (id, product_id, product_name, old_stock, new_stock, type, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['sa-1', 'prod-1', 'Bosch GSB 550 Impact Drill 13mm', 16, 15, 'Damage/Breakage', 'Damaged outer casing during freight', '2026-08-14 15:00:00']
  );

  await db.run(
    'INSERT INTO quotations (id, quote_no, customer_name, customer_phone, items, subtotal, tax, discount, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ['q-1', 'QUO-001', 'Perera Construction Ltd', '0775551122', JSON.stringify([{ productId: 'prod-3', productName: 'Sanwa Portland Cement 50kg Bag', qty: 50, unitPrice: 2450 }, { productId: 'prod-4', productName: 'Fine River Sand (Cube)', qty: 2, unitPrice: 12000 }]), 146500, 0, 1500, 145000, 'Sent', '2026-08-16 10:00:00']
  );

  await db.run(
    'INSERT INTO delivery_notes (id, dn_no, customer_name, items, reference_invoice, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['dn-1', 'DN-001', 'Perera Construction Ltd', JSON.stringify([{ name: 'Sanwa Portland Cement 50kg Bag', qty: 15, unit: 'bags' }, { name: 'S-Lon PVC Water Pipe 1/2" 4m', qty: 12, unit: 'length' }]), 'INV-001', '2026-08-10 11:00:00']
  );

  // 10. Seed Employees
  console.log('  -> Inserting Employees...');
  await db.run(
    'INSERT INTO employees (id, name, role, phone, email, salary, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['emp-1', 'Sunimal Jayasinghe', 'Senior Cashier', '0773334455', 'sunimal@hardware.com', 45000, 'Active', '2026-08-01 09:00:00']
  );
  await db.run(
    'INSERT INTO employees (id, name, role, phone, email, salary, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ['emp-2', 'Kasun Perera', 'Inventory Manager', '0716667788', 'kasun@hardware.com', 55000, 'Active', '2026-08-01 09:00:00']
  );

  // 11. Seed Audit Logs
  console.log('  -> Inserting Audit Logs...');
  await db.run(
    'INSERT INTO audit_logs (id, user_email, action, details, timestamp) VALUES (?, ?, ?, ?, ?)',
    ['al-1', 'admin@hardware.com', 'SYSTEM_INITIALIZATION', 'Sample test dataset seeded into system database', '2026-08-17 10:00:00']
  );

  // 12. Update System Settings
  await db.run("UPDATE system_settings SET next_invoice_number = 'INV-007', shop_name = 'MUTHUWADIGE HARDWARE', return_passkey = '1234', void_passkey = '1234'");

  await db.close();
  console.log(`✅ Seeding complete for: ${dbPath}`);
}

async function run() {
  for (const dbPath of dbs) {
    try {
      await seedDatabase(dbPath);
    } catch (e) {
      console.error(`Failed to seed ${dbPath}:`, e);
    }
  }
  console.log('\n🎉 ALL SAMPLE DATA SEEDED SUCCESSFULLY FOR SYSTEM TESTING!\n');
}

run();
