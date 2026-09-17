// Execute actual route callbacks and executeSalesReturn without starting full ERP server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { installNetworkBoundary } from './b02/network.mjs';

installNetworkBoundary();
process.env.NODE_ENV = 'test';
process.env.APP_ROLE = 'test';
process.env.DATABASE_ENGINE = 'sqlite';
for (const key of ['VERCEL', 'IS_WEB_CLIENT', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'APPDATA', 'USER_DATA_PATH', 'ELECTRON_RUN_AS_NODE']) {
  delete process.env[key];
}

const { default: db, __setLocalSqliteDbForTesting, __resetForTesting } = await import('../src/db/connection.js');
const { ensureSyncSchema, enqueueSync } = await import('../src/services/syncService.js');

// Extract helper definitions and executeSalesReturn / route handler from server.js
const serverSourceText = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const source = ts.createSourceFile('server.js', serverSourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

const auditSource = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'logAudit').getText(source);
const logAudit = new Function('db', 'enqueueSync', `${auditSource}; return logAudit;`)(db, enqueueSync);

const safeParseJsonSource = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'safeParseJson')?.getText(source) || 'function safeParseJson(str, def) { try { return JSON.parse(str); } catch { return def; } }';
const safeParseJson = new Function(`${safeParseJsonSource}; return safeParseJson;`)();

const execReturnSource = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'executeSalesReturn').getText(source);
const executeSalesReturn = new Function('db', 'ensureSyncSchema', 'enqueueSync', 'logAudit', 'safeParseJson', `${execReturnSource}; return executeSalesReturn;`)(db, ensureSyncSchema, enqueueSync, logAudit, safeParseJson);

function handlerFor(route) {
  const statement = source.statements.find(s => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression)
    && s.expression.expression.getText(source) === 'app.post' && s.expression.arguments[0]?.text === route);
  assert.ok(statement, `Actual registered route ${route} must exist`);
  const handler = statement.expression.arguments.at(-1).getText(source);
  return new Function('db', 'executeSalesReturn', `return (${handler});`)(db, executeSalesReturn);
}

const salesReturnRoute = handlerFor('/api/sales/returns');

let memory;
let schema;
const tables = [
  'sales',
  'sales_returns',
  'sales_return_items',
  'products',
  'stock_adjustments',
  'credit_notes',
  'transactions',
  'customers',
  'profiles',
  'audit_logs',
  'sync_queue'
];

const snapshot = async () => Object.fromEntries(
  await Promise.all(tables.map(async name => [name, await memory.all(`SELECT * FROM ${name} ORDER BY id`)]))
);

test.beforeEach(async () => {
  __resetForTesting();
  memory = await open({ filename: ':memory:', driver: sqlite3.Database });
  __setLocalSqliteDbForTesting(memory);

  await memory.exec(`
    CREATE TABLE sales (
      id TEXT PRIMARY KEY,
      invoice_no TEXT UNIQUE,
      customer_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      items TEXT,
      payment_method TEXT,
      status TEXT,
      is_credit INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE sales_returns (
      id TEXT PRIMARY KEY,
      return_no TEXT UNIQUE,
      invoice_no TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      returned_items TEXT,
      exchange_items TEXT,
      return_method TEXT,
      return_amount REAL,
      exchange_amount REAL,
      balance_amount REAL,
      total_refunded REAL,
      customer_paid REAL,
      change_given REAL,
      credit_note_no TEXT,
      user_id TEXT,
      status TEXT,
      reason TEXT,
      created_at TEXT,
      is_credit INTEGER DEFAULT 0,
      difference_payment_method TEXT
    );

    CREATE TABLE sales_return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT,
      product_id TEXT,
      product_name TEXT,
      quantity REAL,
      unit_price REAL,
      cost_price REAL,
      total REAL,
      created_at TEXT
    );

    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT,
      sku TEXT,
      stock REAL DEFAULT 0,
      cost_price REAL DEFAULT 0,
      selling_price REAL DEFAULT 0
    );

    CREATE TABLE stock_adjustments (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      product_name TEXT,
      old_qty REAL,
      new_qty REAL,
      reason TEXT,
      type TEXT,
      user_email TEXT,
      created_at TEXT
    );

    CREATE TABLE credit_notes (
      id TEXT PRIMARY KEY,
      credit_note_no TEXT UNIQUE,
      code TEXT,
      invoice_no TEXT,
      customer_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      items TEXT,
      amount REAL,
      value REAL,
      balance_remaining REAL,
      status TEXT,
      reason TEXT,
      user_id TEXT,
      created_at TEXT
    );

    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      type TEXT,
      category TEXT,
      description TEXT,
      amount REAL,
      date TEXT,
      reference TEXT,
      user_id TEXT
    );

    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      name TEXT,
      phone TEXT,
      email TEXT,
      current_debt REAL DEFAULT 0,
      credit_limit REAL DEFAULT 0,
      type TEXT,
      is_credit INTEGER DEFAULT 0
    );

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      user_email TEXT,
      action TEXT,
      details TEXT,
      timestamp TEXT,
      user_name TEXT,
      user_role TEXT
    );

    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      email TEXT,
      username TEXT,
      name TEXT,
      full_name TEXT,
      role TEXT
    );

    CREATE VIEW IF NOT EXISTS cash_book AS SELECT * FROM transactions;

    -- Base seed data
    INSERT INTO profiles (id, email, username, name, role) VALUES ('prof-1', 'cashier@muthuwadige.com', 'cashier1', 'Cashier User', 'cashier');
    INSERT INTO products (id, name, sku, stock, cost_price, selling_price) VALUES
      ('prod-1', 'Brass Padlock 40mm', 'PAD-40', 10, 500, 800),
      ('prod-2', 'Steel Wire 5mm', 'WIRE-5', 20, 200, 350),
      ('prod-3', 'Heavy Duty Hinge', 'HINGE-HD', 5, 300, 450);

    INSERT INTO customers (id, name, phone, email, type, is_credit) VALUES
      ('cust-cash', 'Kamal Perera', '0771112222', 'kamal@gmail.com', 'retail', 0),
      ('cust-credit', 'Bandara Enterprises', '0773334444', 'bandara@gmail.com', 'credit', 1);

    INSERT INTO sales (id, invoice_no, customer_id, customer_name, customer_phone, items, payment_method, status, is_credit, created_at) VALUES
      ('sale-1', 'INV-1001', 'cust-cash', 'Kamal Perera', '0771112222',
       '[{"productId":"prod-1","name":"Brass Padlock 40mm","qty":4,"price":800,"costPrice":500,"unit":"pcs"},{"productId":"prod-2","name":"Steel Wire 5mm","qty":10,"price":350,"costPrice":200,"unit":"m"}]',
       'Cash', 'Paid', 0, '2026-09-15T10:00:00.000Z'),
      ('sale-2', 'INV-1002', 'cust-credit', 'Bandara Enterprises', '0773334444',
       '[{"productId":"prod-1","name":"Brass Padlock 40mm","qty":2,"price":800,"costPrice":500,"unit":"pcs"}]',
       'Credit', 'Non Paid', 1, '2026-09-15T11:00:00.000Z');
  `);

  await ensureSyncSchema(db);
  schema = await memory.all('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name');
  assert.equal(db.isTurso(), false);
});

test.afterEach(async () => {
  assert.deepEqual(await memory.all('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name'), schema);
  await memory.close();
  __resetForTesting();
});

async function invoke(handler, body, authUser = { email: 'cashier@muthuwadige.com', role: 'cashier' }) {
  let status = 200;
  let responseData;
  const req = {
    body,
    headers: {},
    authUser,
    user: authUser
  };
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(data) {
      responseData = data;
      return this;
    }
  };
  await handler(req, res);
  return { status, body: responseData };
}

// ---------------------------------------------------------------------------
// TEST SUITE: SALES RETURNS & EXCHANGES MANAGED TRANSACTIONS
// ---------------------------------------------------------------------------

test('Requirement 1 & 12: Successful full return with cash refund commits all records and responds with 200 OK', async () => {
  const payload = {
    invoiceNo: 'INV-1001',
    returnMethod: 'Cash Refund',
    returnedItems: [
      { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 4, price: 800, cost_price: 500, unit: 'pcs' },
      { productId: 'prod-2', productName: 'Steel Wire 5mm', qty: 10, price: 350, cost_price: 200, unit: 'm' }
    ],
    returnAmount: 6700,
    totalRefunded: 6700,
    reason: 'Customer cancelled project'
  };

  const res = await invoke(salesReturnRoute, payload);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.returnNo.startsWith('RET-'));
  assert.equal(res.body.invoice_no, 'INV-1001');
  assert.equal(res.body.totalRefunded, 6700);

  // 1. Check sales_returns record
  const sr = await memory.get('SELECT * FROM sales_returns WHERE invoice_no = ?', ['INV-1001']);
  assert.ok(sr);
  assert.equal(sr.return_amount, 6700);
  assert.equal(sr.total_refunded, 6700);
  assert.equal(sr.status, 'active');

  // 2. Check normalized sales_return_items
  const items = await memory.all('SELECT * FROM sales_return_items WHERE return_id = ? ORDER BY product_id', [sr.id]);
  assert.equal(items.length, 2);
  assert.equal(items[0].product_id, 'prod-1');
  assert.equal(items[0].quantity, 4);
  assert.equal(items[1].product_id, 'prod-2');
  assert.equal(items[1].quantity, 10);

  // 3. Check stock restocked in products
  const p1 = await memory.get('SELECT stock FROM products WHERE id = ?', ['prod-1']);
  const p2 = await memory.get('SELECT stock FROM products WHERE id = ?', ['prod-2']);
  assert.equal(p1.stock, 14); // 10 + 4
  assert.equal(p2.stock, 30); // 20 + 10

  // 4. Check stock_adjustments created
  const sa = await memory.all('SELECT * FROM stock_adjustments WHERE reason LIKE ?', ['%INV-1001%']);
  assert.equal(sa.length, 2);
  assert.equal(sa[0].type, 'Sale Return Restock');

  // 5. Check ledger contra_revenue transaction
  const tx = await memory.get('SELECT * FROM transactions WHERE reference = ?', ['INV-1001']);
  assert.ok(tx);
  assert.equal(tx.type, 'contra_revenue');
  assert.equal(tx.category, 'Sales Return');
  assert.equal(tx.amount, 6700);

  // 6. Check sales status updated to Fully Returned
  const updatedSale = await memory.get('SELECT status FROM sales WHERE invoice_no = ?', ['INV-1001']);
  assert.equal(updatedSale.status, 'Fully Returned');

  // 7. Check audit log
  const audit = await memory.get('SELECT * FROM audit_logs WHERE action = ?', ['SALES_RETURN']);
  assert.ok(audit);
  assert.ok(audit.details.includes('INV-1001'));

  // 8. Check sync queue entries awaited and populated
  const queue = await memory.all('SELECT table_name, action FROM sync_queue ORDER BY id');
  const tableNames = queue.map(q => q.table_name);
  assert.ok(tableNames.includes('sales_returns'));
  assert.ok(tableNames.includes('sales_return_items'));
  assert.ok(tableNames.includes('products'));
  assert.ok(tableNames.includes('transactions'));
  assert.ok(tableNames.includes('cash_book'));
  assert.ok(tableNames.includes('sales'));
});

test('Requirement 2: Successful partial return preserves remainder for future return', async () => {
  const payload1 = {
    invoiceNo: 'INV-1001',
    returnMethod: 'Cash Refund',
    returnedItems: [
      { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 2, price: 800, unit: 'pcs' }
    ],
    returnAmount: 1600,
    totalRefunded: 1600
  };

  const res1 = await invoke(salesReturnRoute, payload1);
  assert.equal(res1.status, 200);

  // Sale status should now be Partially Returned
  const saleAfter1 = await memory.get('SELECT status FROM sales WHERE invoice_no = ?', ['INV-1001']);
  assert.equal(saleAfter1.status, 'Partially Returned');

  // Second partial return: return 2 more padlocks (completes the 4 purchased)
  const payload2 = {
    invoiceNo: 'INV-1001',
    returnMethod: 'Cash Refund',
    returnedItems: [
      { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 2, price: 800, unit: 'pcs' }
    ],
    returnAmount: 1600,
    totalRefunded: 1600
  };

  const res2 = await invoke(salesReturnRoute, payload2);
  assert.equal(res2.status, 200);

  // Padlock stock should be 10 + 2 + 2 = 14
  const p1 = await memory.get('SELECT stock FROM products WHERE id = ?', ['prod-1']);
  assert.equal(p1.stock, 14);

  // Third attempt to return 1 more padlock should be rejected (4 purchased, 4 already returned)
  const payload3 = {
    invoiceNo: 'INV-1001',
    returnMethod: 'Cash Refund',
    returnedItems: [
      { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 1, price: 800, unit: 'pcs' }
    ],
    returnAmount: 800
  };

  const res3 = await invoke(salesReturnRoute, payload3);
  assert.equal(res3.status, 400);
  assert.ok(res3.body.error.includes('Maximum remaining returnable quantity for this invoice line is 0'));
});

test('Requirement 3: Successful exchange restocks returned item and deducts replacement item', async () => {
  // Return 1 Padlock (800) and exchange for 1 Heavy Duty Hinge (450), refund difference 350
  const payload = {
    invoiceNo: 'INV-1001',
    returnMethod: 'Exchange',
    returnedItems: [
      { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 1, price: 800, unit: 'pcs' }
    ],
    exchangeItems: [
      { productId: 'prod-3', productName: 'Heavy Duty Hinge', qty: 1, price: 450, unit: 'pcs' }
    ],
    returnAmount: 800,
    exchangeAmount: 450,
    totalRefunded: 350,
    changeGiven: 350
  };

  const res = await invoke(salesReturnRoute, payload);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);

  // Padlock stock was 10 -> 11
  const p1 = await memory.get('SELECT stock FROM products WHERE id = ?', ['prod-1']);
  assert.equal(p1.stock, 11);

  // Hinge stock was 5 -> 4
  const p3 = await memory.get('SELECT stock FROM products WHERE id = ?', ['prod-3']);
  assert.equal(p3.stock, 4);

  // Check stock adjustments: 1 restock + 1 exchange outflow
  const sa = await memory.all('SELECT * FROM stock_adjustments ORDER BY created_at');
  const restock = sa.find(s => s.type === 'Sale Return Restock');
  const exch = sa.find(s => s.type === 'Sale Return Exchange');
  assert.ok(restock);
  assert.equal(restock.product_id, 'prod-1');
  assert.ok(exch);
  assert.equal(exch.product_id, 'prod-3');
});

test('Requirement 4: Insufficient stock for exchange triggers complete rollback', async () => {
  const before = await snapshot();

  // Prod-3 has stock 5. Customer attempts to exchange for 10
  const payload = {
    invoiceNo: 'INV-1001',
    returnMethod: 'Exchange',
    returnedItems: [
      { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 1, price: 800, unit: 'pcs' }
    ],
    exchangeItems: [
      { productId: 'prod-3', productName: 'Heavy Duty Hinge', qty: 10, price: 450, unit: 'pcs' }
    ],
    returnAmount: 800,
    exchangeAmount: 4500
  };

  const res = await invoke(salesReturnRoute, payload);
  assert.equal(res.status, 400);
  assert.ok(res.body.error.includes('Insufficient inventory'));
  assert.ok(res.body.error.includes('Heavy Duty Hinge'));

  const after = await snapshot();
  assert.deepEqual(after, before, 'Database must be entirely unchanged after insufficient exchange stock rejection');
});

test('Requirement 5: Credit-note refund creates active credit note and enqueues sync', async () => {
  const payload = {
    invoiceNo: 'INV-1001',
    returnMethod: 'Credit Note',
    returnedItems: [
      { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 2, price: 800, unit: 'pcs' }
    ],
    returnAmount: 1600
  };

  const res = await invoke(salesReturnRoute, payload);
  assert.equal(res.status, 200);
  assert.ok(res.body.creditNoteNo.startsWith('CN-'));

  // Verify credit note record
  const cn = await memory.get('SELECT * FROM credit_notes WHERE invoice_no = ?', ['INV-1001']);
  assert.ok(cn);
  assert.equal(cn.credit_note_no, res.body.creditNoteNo);
  assert.equal(cn.amount, 1600);
  assert.equal(cn.value, 1600);
  assert.equal(cn.balance_remaining, 1600);
  assert.equal(cn.status, 'Active');

  // Verify sync queue contains credit_notes
  const q = await memory.get('SELECT * FROM sync_queue WHERE table_name = ? AND record_id = ?', ['credit_notes', cn.id]);
  assert.ok(q);
  assert.equal(q.action, 'INSERT');
});

test('Requirement 6: Credit customer return rules force contra_revenue and zero cash refund', async () => {
  // INV-1002 is for credit customer Bandara Enterprises
  const payload = {
    invoiceNo: 'INV-1002',
    returnMethod: 'Cash Refund', // Client requested Cash Refund, but must be forced to Return with 0 cash refund
    returnedItems: [
      { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 2, price: 800, unit: 'pcs' }
    ],
    returnAmount: 1600,
    totalRefunded: 1600 // Payload tried to refund cash
  };

  const res = await invoke(salesReturnRoute, payload);
  assert.equal(res.status, 200);
  assert.equal(res.body.totalRefunded, 0, 'totalRefunded must be forced to 0 for credit customer');

  // Check sales_returns record
  const sr = await memory.get('SELECT * FROM sales_returns WHERE invoice_no = ?', ['INV-1002']);
  assert.equal(sr.total_refunded, 0);
  assert.equal(sr.change_given, 0);
  assert.equal(sr.return_method, 'Return');
  assert.equal(sr.is_credit, 1);

  // Check ledger entry category
  const tx = await memory.get('SELECT * FROM transactions WHERE reference = ?', ['INV-1002']);
  assert.ok(tx);
  assert.equal(tx.category, 'Sales Return (Credit Adjustment)');
  assert.equal(tx.amount, 1600);
});

test('Requirement 7: Over-return prevention blocks return exceeding invoice line quantity', async () => {
  const before = await snapshot();

  // Purchased 4 padlocks, attempts to return 5
  const payload = {
    invoiceNo: 'INV-1001',
    returnMethod: 'Cash Refund',
    returnedItems: [
      { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 5, price: 800, unit: 'pcs' }
    ],
    returnAmount: 4000
  };

  const res = await invoke(salesReturnRoute, payload);
  assert.equal(res.status, 400);
  assert.ok(res.body.error.includes('Maximum remaining returnable quantity'));

  const after = await snapshot();
  assert.deepEqual(after, before, 'Database must be completely unchanged after over-return rejection');
});

test('Requirement 8: Idempotent replay for duplicate return request with identical candidate ID', async () => {
  const payload = {
    id: 'sr_idemp_test_777',
    invoiceNo: 'INV-1001',
    returnMethod: 'Cash Refund',
    returnedItems: [
      { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 1, price: 800, unit: 'pcs' }
    ],
    returnAmount: 800,
    totalRefunded: 800
  };

  const res1 = await invoke(salesReturnRoute, payload);
  assert.equal(res1.status, 200);
  assert.equal(res1.body.id, 'sr_idemp_test_777');
  assert.equal(res1.body.totalRefunded, 800);

  // Replay request with same ID
  const res2 = await invoke(salesReturnRoute, payload);
  assert.equal(res2.status, 200);
  assert.equal(res2.body.id, 'sr_idemp_test_777');
  assert.equal(res2.body.idempotent_replay, true);

  // Exactly 1 record should exist, and stock should be restocked exactly once (10 -> 11, not 12)
  const count = (await memory.get('SELECT COUNT(*) as c FROM sales_returns WHERE id = ?', ['sr_idemp_test_777'])).c;
  assert.equal(count, 1);
  const p1 = await memory.get('SELECT stock FROM products WHERE id = ?', ['prod-1']);
  assert.equal(p1.stock, 11);
});

test('Requirement 9: Concurrent returns against same invoice serialize safely without double return', async () => {
  // INV-1002 has 2 padlocks.
  // 3 simultaneous requests to return 1 padlock each: only 2 can succeed, 1 must fail with 400.
  const reqs = [1, 2, 3].map(i =>
    invoke(salesReturnRoute, {
      invoiceNo: 'INV-1002',
      returnMethod: 'Cash Refund',
      returnedItems: [
        { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 1, price: 800, unit: 'pcs' }
      ],
      returnAmount: 800
    })
  );

  const results = await Promise.all(reqs);
  const successCount = results.filter(r => r.status === 200).length;
  const failCount = results.filter(r => r.status === 400).length;

  assert.equal(successCount, 2, 'Exactly 2 requests can succeed');
  assert.equal(failCount, 1, 'Third request must fail due to exhausted returnable quantity');

  // Final stock of prod-1 should be 10 + 2 = 12
  const p1 = await memory.get('SELECT stock FROM products WHERE id = ?', ['prod-1']);
  assert.equal(p1.stock, 12);

  // Sale status should be Fully Returned
  const sale = await memory.get('SELECT status FROM sales WHERE invoice_no = ?', ['INV-1002']);
  assert.equal(sale.status, 'Fully Returned');
});

test('Requirement 10: Mid-operation failure during sales_return_items rolls back all writes', async () => {
  const before = await snapshot();

  const origRun = memory.run.bind(memory);
  memory.run = async function(sql, ...args) {
    if (typeof sql === 'string' && sql.includes('INSERT OR REPLACE INTO sales_return_items')) {
      throw new Error('Simulated sales_return_items disk failure');
    }
    return origRun(sql, ...args);
  };

  const payload = {
    invoiceNo: 'INV-1001',
    returnMethod: 'Cash Refund',
    returnedItems: [
      { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 1, price: 800, unit: 'pcs' }
    ],
    returnAmount: 800,
    totalRefunded: 800
  };

  const res = await invoke(salesReturnRoute, payload);
  memory.run = origRun;

  assert.equal(res.status, 500);
  assert.ok(res.body.error.includes('Simulated sales_return_items disk failure'));

  const after = await snapshot();
  assert.deepEqual(after, before, 'Database must be entirely rolled back with no partial writes');
});

test('Requirement 11: Mid-operation failure during sync_queue insertion rolls back all writes', async () => {
  const before = await snapshot();

  const origRun = memory.run.bind(memory);
  memory.run = async function(sql, ...args) {
    if (typeof sql === 'string' && sql.includes('sync_queue')) {
      throw new Error('Simulated sync_queue failure');
    }
    return origRun(sql, ...args);
  };

  const payload = {
    invoiceNo: 'INV-1001',
    returnMethod: 'Cash Refund',
    returnedItems: [
      { productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 1, price: 800, unit: 'pcs' }
    ],
    returnAmount: 800,
    totalRefunded: 800
  };

  const res = await invoke(salesReturnRoute, payload);
  memory.run = origRun;

  assert.equal(res.status, 500);
  assert.ok(res.body.error.includes('Simulated sync_queue failure'));

  const after = await snapshot();
  assert.deepEqual(after, before, 'Database must be entirely rolled back when sync queue insertion fails');
});

test('Requirement 12: API contracts validate missing parameters and missing resources with proper HTTP status codes', async () => {
  const before = await snapshot();

  // Missing invoiceNo -> 400
  const res1 = await invoke(salesReturnRoute, {});
  assert.equal(res1.status, 400);
  assert.equal(res1.body.error, 'Invoice number is required.');

  // Non-existent invoiceNo -> 404
  const res2 = await invoke(salesReturnRoute, { invoiceNo: 'INV-9999' });
  assert.equal(res2.status, 404);
  assert.equal(res2.body.error, 'Invoice INV-9999 not found.');

  // Item not found in invoice -> 400
  const res3 = await invoke(salesReturnRoute, {
    invoiceNo: 'INV-1001',
    returnedItems: [{ productId: 'prod-3', productName: 'Non-existent in invoice', qty: 1, price: 450 }]
  });
  assert.equal(res3.status, 400);
  assert.ok(res3.body.error.includes('was not found in original invoice'));

  // Replacement product not found in inventory -> 400
  const res4 = await invoke(salesReturnRoute, {
    invoiceNo: 'INV-1001',
    returnMethod: 'Exchange',
    returnedItems: [{ productId: 'prod-1', productName: 'Brass Padlock 40mm', qty: 1, price: 800 }],
    exchangeItems: [{ productId: 'prod-ghost', productName: 'Ghost Product', qty: 1, price: 1000 }]
  });
  assert.equal(res4.status, 400);
  assert.ok(res4.body.error.includes('not found in inventory'));

  const after = await snapshot();
  assert.deepEqual(after, before, 'No database modifications occur on contract validation errors');
});
