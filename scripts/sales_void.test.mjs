// Focused test suite for Sale Void operation (POST /api/sales/:id/void)
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

// Parse server.js AST to extract functions and route handlers
const serverSourceText = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const source = ts.createSourceFile('server.js', serverSourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

const auditSource = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'logAudit').getText(source);
const logAudit = new Function('db', 'enqueueSync', `${auditSource}; return logAudit;`)(db, enqueueSync);

const safeParseJsonSource = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'safeParseJson')?.getText(source) || 'function safeParseJson(str, def) { try { return JSON.parse(str); } catch { return def; } }';
const safeParseJson = new Function(`${safeParseJsonSource}; return safeParseJson;`)();

const execVoidSaleSource = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'executeVoidSale').getText(source);
const executeVoidSale = new Function(
  'db', 'ensureSyncSchema', 'enqueueSync', 'logAudit', 'safeParseJson',
  `${execVoidSaleSource}; return executeVoidSale;`
)(db, ensureSyncSchema, enqueueSync, logAudit, safeParseJson);

// Extract route handler for /api/sales/:id/void
function handlerForVoidSale() {
  const statement = source.statements.find(s =>
    ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) &&
    s.expression.expression.getText(source) === 'app.post' &&
    s.expression.arguments[0]?.text === '/api/sales/:id/void'
  );
  assert.ok(statement, 'Route /api/sales/:id/void must be registered');
  const handlerCode = statement.expression.arguments.at(-1).getText(source);
  return new Function('db', 'executeVoidSale', `return (${handlerCode});`)(db, executeVoidSale);
}

const voidSaleRoute = handlerForVoidSale();

let memory;
const tables = [
  'sales',
  'products',
  'stock_adjustments',
  'transactions',
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
      total REAL,
      total_amount REAL,
      payment_received REAL DEFAULT 0,
      payment_method TEXT,
      status TEXT,
      is_credit INTEGER DEFAULT 0,
      voided_at TEXT,
      voided_by TEXT,
      void_reason TEXT,
      created_at TEXT
    );

    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT,
      sku TEXT UNIQUE,
      stock REAL,
      min_stock REAL,
      price REAL,
      cost_price REAL,
      category TEXT
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

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      user_email TEXT,
      action TEXT,
      details TEXT,
      timestamp TEXT,
      user_name TEXT,
      user_role TEXT
    );

    CREATE VIEW IF NOT EXISTS cash_book AS SELECT * FROM transactions;
  `);

  await ensureSyncSchema(db);
});

test.afterEach(async () => {
  if (memory) {
    await memory.close();
  }
});

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.data = obj;
      return this;
    }
  };
}

// ---------------------------------------------------------------------------
// TEST SCENARIOS
// ---------------------------------------------------------------------------

test('executeVoidSale: successfully voids sale, restores stock, creates stock adjustment, removes transactions, and records sync queue', async () => {
  await memory.run('INSERT INTO products (id, name, sku, stock) VALUES (?, ?, ?, ?)', [
    'prod-1', 'Hammer', 'SKU-H1', 10
  ]);

  const items = JSON.stringify([
    { productId: 'prod-1', name: 'Hammer', qty: 3, conversionRate: 1 }
  ]);

  await memory.run(
    'INSERT INTO sales (id, invoice_no, items, total_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['sale-100', 'INV-100', items, 1500, 'Paid', '2026-09-01T10:00:00Z']
  );

  await memory.run(
    'INSERT INTO transactions (id, type, category, description, amount, reference) VALUES (?, ?, ?, ?, ?, ?)',
    ['tx-1', 'income', 'Sales', 'Payment for INV-100', 1500, 'INV-100']
  );

  const result = await executeVoidSale('sale-100', {
    user_email: 'supervisor@example.com',
    supervisor_name: 'Supervisor Jane',
    void_reason: 'Customer cancelled transaction'
  }, { db });

  assert.equal(result.success, true);
  assert.equal(result.status, 'VOIDED');
  assert.equal(result.id, 'sale-100');
  assert.equal(result.invoice_no, 'INV-100');

  // Verify sales record status and metadata
  const sale = await memory.get('SELECT * FROM sales WHERE id = ?', ['sale-100']);
  assert.equal(sale.status, 'VOIDED');
  assert.equal(sale.voided_by, 'Supervisor Jane');
  assert.equal(sale.void_reason, 'Customer cancelled transaction');
  assert.ok(sale.voided_at);

  // Verify stock restored (10 + 3 = 13)
  const product = await memory.get('SELECT * FROM products WHERE id = ?', ['prod-1']);
  assert.equal(product.stock, 13);

  // Verify stock adjustments record
  const sa = await memory.get('SELECT * FROM stock_adjustments WHERE product_id = ?', ['prod-1']);
  assert.ok(sa);
  assert.equal(sa.type, 'Sale Void Restock');
  assert.equal(sa.new_qty, 3);
  assert.equal(sa.user_email, 'supervisor@example.com');

  // Verify ledger transactions removed
  const txs = await memory.all('SELECT * FROM transactions WHERE reference = ?', ['INV-100']);
  assert.equal(txs.length, 0);

  // Verify audit log
  const audit = await memory.get('SELECT * FROM audit_logs WHERE action = ?', ['VOID_INVOICE']);
  assert.ok(audit);
  assert.match(audit.details, /Voided invoice INV-100/);

  // Verify sync queue entries
  const syncQueue = await memory.all('SELECT * FROM sync_queue ORDER BY id');
  const syncSales = syncQueue.filter(q => q.table_name === 'sales' && q.record_id === 'sale-100');
  assert.ok(syncSales.length >= 1);
  assert.equal(syncSales[0].action, 'UPDATE');

  const syncProducts = syncQueue.filter(q => q.table_name === 'products' && q.record_id === 'prod-1');
  assert.ok(syncProducts.length >= 1);
  assert.equal(syncProducts[0].action, 'UPDATE');

  const syncTx = syncQueue.filter(q => q.table_name === 'transactions' && q.record_id === 'tx-1');
  assert.ok(syncTx.length >= 1);
  assert.equal(syncTx[0].action, 'DELETE');
});

test('executeVoidSale: handles unit conversion rate correctly when restocking', async () => {
  await memory.run('INSERT INTO products (id, name, sku, stock) VALUES (?, ?, ?, ?)', [
    'prod-box', 'Box of Screws', 'SKU-SCR', 5
  ]);

  // Sold 20 individual screws from box of 10 -> 2 boxes
  const items = JSON.stringify([
    { productId: 'prod-box', name: 'Box of Screws', qty: 20, conversionRate: 10 }
  ]);

  await memory.run(
    'INSERT INTO sales (id, invoice_no, items, total_amount, status) VALUES (?, ?, ?, ?, ?)',
    ['sale-200', 'INV-200', items, 800, 'Paid']
  );

  await executeVoidSale('sale-200', { void_reason: 'Incorrect quantity billed' }, { db });

  // 5 + (20 / 10) = 7
  const product = await memory.get('SELECT * FROM products WHERE id = ?', ['prod-box']);
  assert.equal(product.stock, 7);
});

test('executeVoidSale: allows lookup by invoice_no', async () => {
  await memory.run(
    'INSERT INTO sales (id, invoice_no, items, total_amount, status) VALUES (?, ?, ?, ?, ?)',
    ['sale-300', 'INV-300', '[]', 500, 'Paid']
  );

  const result = await executeVoidSale('INV-300', {}, { db });
  assert.equal(result.success, true);
  assert.equal(result.id, 'sale-300');

  const sale = await memory.get('SELECT * FROM sales WHERE id = ?', ['sale-300']);
  assert.equal(sale.status, 'VOIDED');
});

test('executeVoidSale: rejects already voided sale with 400 and prevents duplicate restocking', async () => {
  await memory.run('INSERT INTO products (id, name, sku, stock) VALUES (?, ?, ?, ?)', [
    'prod-x', 'Drill Bit', 'SKU-DB', 20
  ]);

  const items = JSON.stringify([{ productId: 'prod-x', qty: 5, conversionRate: 1 }]);

  await memory.run(
    'INSERT INTO sales (id, invoice_no, items, total_amount, status) VALUES (?, ?, ?, ?, ?)',
    ['sale-400', 'INV-400', items, 2500, 'VOIDED']
  );

  await assert.rejects(
    async () => executeVoidSale('sale-400', {}, { db }),
    err => {
      assert.equal(err.status, 400);
      assert.match(err.message, /already voided/i);
      return true;
    }
  );

  // Stock must not change
  const product = await memory.get('SELECT * FROM products WHERE id = ?', ['prod-x']);
  assert.equal(product.stock, 20);
});

test('executeVoidSale: rejects non-existent sale with 404', async () => {
  await assert.rejects(
    async () => executeVoidSale('non-existent-id', {}, { db }),
    err => {
      assert.equal(err.status, 404);
      assert.match(err.message, /not found/i);
      return true;
    }
  );
});

test('executeVoidSale: rolls back completely if mid-operation failure occurs', async () => {
  await memory.run('INSERT INTO products (id, name, sku, stock) VALUES (?, ?, ?, ?)', [
    'prod-fail', 'Paint', 'SKU-PNT', 10
  ]);

  const items = JSON.stringify([{ productId: 'prod-fail', qty: 2, conversionRate: 1 }]);

  await memory.run(
    'INSERT INTO sales (id, invoice_no, items, total_amount, status) VALUES (?, ?, ?, ?, ?)',
    ['sale-500', 'INV-500', items, 3000, 'Paid']
  );

  await memory.run(
    'INSERT INTO transactions (id, type, category, description, amount, reference) VALUES (?, ?, ?, ?, ?, ?)',
    ['tx-500', 'income', 'Sales', 'Payment INV-500', 3000, 'INV-500']
  );

  const initialSnap = await snapshot();

  // Sabotage products table to trigger an error mid-transaction
  await memory.exec('DROP TABLE products');

  await assert.rejects(
    async () => executeVoidSale('sale-500', {}, { db })
  );

  // Re-create products table to inspect clean rollback state
  await memory.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      name TEXT,
      sku TEXT UNIQUE,
      stock REAL,
      min_stock REAL,
      price REAL,
      cost_price REAL,
      category TEXT
    );
    INSERT INTO products (id, name, sku, stock) VALUES ('prod-fail', 'Paint', 'SKU-PNT', 10);
  `);

  const afterSnap = await snapshot();

  // Verify sales status, transactions and sync_queue are uncorrupted
  assert.equal(afterSnap.sales[0].status, 'Paid');
  assert.equal(afterSnap.products[0].stock, 10);
  assert.equal(afterSnap.transactions.length, 1);
  assert.equal(afterSnap.sync_queue.length, initialSnap.sync_queue.length);
});

test('executeVoidSale: handles concurrent void requests cleanly with only one succeeding', async () => {
  await memory.run('INSERT INTO products (id, name, sku, stock) VALUES (?, ?, ?, ?)', [
    'prod-conc', 'Plywood', 'SKU-PLY', 50
  ]);

  const items = JSON.stringify([{ productId: 'prod-conc', qty: 10, conversionRate: 1 }]);

  await memory.run(
    'INSERT INTO sales (id, invoice_no, items, total_amount, status) VALUES (?, ?, ?, ?, ?)',
    ['sale-600', 'INV-600', items, 10000, 'Paid']
  );

  const results = await Promise.allSettled([
    executeVoidSale('sale-600', { void_reason: 'Concurrent Req 1' }, { db }),
    executeVoidSale('sale-600', { void_reason: 'Concurrent Req 2' }, { db })
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one concurrent request should fulfill');
  assert.equal(rejected.length, 1, 'Exactly one concurrent request should be rejected');
  assert.equal(rejected[0].reason.status, 400);

  // Stock must only be incremented once (50 + 10 = 60)
  const prod = await memory.get('SELECT * FROM products WHERE id = ?', ['prod-conc']);
  assert.equal(prod.stock, 60);
});

test('voidSaleRoute: HTTP route handler delegates to executeVoidSale and returns json', async () => {
  await memory.run(
    'INSERT INTO sales (id, invoice_no, items, total_amount, status) VALUES (?, ?, ?, ?, ?)',
    ['sale-700', 'INV-700', '[]', 1200, 'Paid']
  );

  const req = {
    params: { id: 'sale-700' },
    body: { void_reason: 'Testing route delegate' }
  };
  const res = mockRes();

  await voidSaleRoute(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.status, 'VOIDED');
  assert.equal(res.data.id, 'sale-700');
});

test('voidSaleRoute: HTTP route handler translates error status codes properly', async () => {
  const req = {
    params: { id: 'missing-sale' },
    body: {}
  };
  const res = mockRes();

  await voidSaleRoute(req, res);

  assert.equal(res.statusCode, 404);
  assert.match(res.data.error, /not found/i);
});

test('executeVoidSale: rolls back completely when sync queue operation fails', async () => {
  await memory.run('INSERT INTO products (id, name, sku, stock) VALUES (?, ?, ?, ?)', [
    'prod-sq', 'Nails', 'SKU-NL', 15
  ]);

  const items = JSON.stringify([{ productId: 'prod-sq', qty: 5, conversionRate: 1 }]);

  await memory.run(
    'INSERT INTO sales (id, invoice_no, items, total_amount, status) VALUES (?, ?, ?, ?, ?)',
    ['sale-sq', 'INV-SQ', items, 500, 'Paid']
  );

  // Sabotage sync_queue table so enqueueSync fails
  await memory.exec('DROP TABLE sync_queue');

  await assert.rejects(
    async () => executeVoidSale('sale-sq', {}, { db })
  );

  // Restore sync_queue table
  await ensureSyncSchema(db);

  // Verify transaction rolled back cleanly
  const sale = await memory.get('SELECT * FROM sales WHERE id = ?', ['sale-sq']);
  assert.equal(sale.status, 'Paid');

  const prod = await memory.get('SELECT * FROM products WHERE id = ?', ['prod-sq']);
  assert.equal(prod.stock, 15);
});

test('executeVoidSale: cleans up transactions referencing sale by id, invoice_no, and description', async () => {
  await memory.run(
    'INSERT INTO sales (id, invoice_no, items, total_amount, status) VALUES (?, ?, ?, ?, ?)',
    ['sale-multi', 'INV-MULTI', '[]', 2000, 'Paid']
  );

  await memory.run('INSERT INTO transactions (id, type, reference, description, amount) VALUES (?, ?, ?, ?, ?)', [
    'tx-by-inv', 'income', 'INV-MULTI', 'Direct invoice reference', 1000
  ]);
  await memory.run('INSERT INTO transactions (id, type, reference, description, amount) VALUES (?, ?, ?, ?, ?)', [
    'tx-by-id', 'income', 'sale-multi', 'Sale ID reference', 500
  ]);
  await memory.run('INSERT INTO transactions (id, type, reference, description, amount) VALUES (?, ?, ?, ?, ?)', [
    'tx-by-desc', 'income', 'OTHER-REF', 'Payment for INV-MULTI recorded by cashier', 500
  ]);
  await memory.run('INSERT INTO transactions (id, type, reference, description, amount) VALUES (?, ?, ?, ?, ?)', [
    'tx-unrelated', 'income', 'INV-UNRELATED', 'Payment for different invoice', 999
  ]);

  const result = await executeVoidSale('sale-multi', {}, { db });
  assert.equal(result.success, true);

  const remainingTxs = await memory.all('SELECT id FROM transactions');
  assert.equal(remainingTxs.length, 1);
  assert.equal(remainingTxs[0].id, 'tx-unrelated');

  const syncQueue = await memory.all('SELECT * FROM sync_queue WHERE table_name = ?', ['transactions']);
  const deletedTxIds = syncQueue.map(q => q.record_id);
  assert.ok(deletedTxIds.includes('tx-by-inv'));
  assert.ok(deletedTxIds.includes('tx-by-id'));
  assert.ok(deletedTxIds.includes('tx-by-desc'));
  assert.ok(!deletedTxIds.includes('tx-unrelated'));
});
