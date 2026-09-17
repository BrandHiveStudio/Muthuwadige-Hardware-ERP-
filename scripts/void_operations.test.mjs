// Test suite for Sales Return Void and Credit Note Void operations.
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

const execVoidReturnSource = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'executeVoidSalesReturn').getText(source);
const executeVoidSalesReturn = new Function(
  'db', 'ensureSyncSchema', 'enqueueSync', 'logAudit', 'safeParseJson',
  `${execVoidReturnSource}; return executeVoidSalesReturn;`
)(db, ensureSyncSchema, enqueueSync, logAudit, safeParseJson);

const execVoidCreditNoteSource = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'executeVoidCreditNote').getText(source);
const executeVoidCreditNote = new Function(
  'db', 'ensureSyncSchema', 'enqueueSync', 'logAudit', 'safeParseJson',
  `${execVoidCreditNoteSource}; return executeVoidCreditNote;`
)(db, ensureSyncSchema, enqueueSync, logAudit, safeParseJson);

// Extract route handlers from server.js
function handlerForVoidReturn() {
  const statement = source.statements.find(s =>
    ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) &&
    s.expression.expression.getText(source) === 'app.post' &&
    s.expression.arguments[0]?.text === '/api/sales/returns/:id/void'
  );
  assert.ok(statement, 'Route /api/sales/returns/:id/void must be registered');
  const handlerCode = statement.expression.arguments.at(-1).getText(source);
  return new Function('db', 'executeVoidSalesReturn', `return (${handlerCode});`)(db, executeVoidSalesReturn);
}

function handlerForVoidCreditNote() {
  const statement = source.statements.find(s =>
    ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) &&
    s.expression.expression.getText(source) === 'app.post' &&
    s.expression.arguments[0]?.getText(source).includes('/api/sales/credit-notes/:id/void')
  );
  assert.ok(statement, 'Route /api/sales/credit-notes/:id/void must be registered');
  const handlerCode = statement.expression.arguments.at(-1).getText(source);
  return new Function('db', 'executeVoidCreditNote', `return (${handlerCode});`)(db, executeVoidCreditNote);
}

const voidReturnRoute = handlerForVoidReturn();
const voidCreditNoteRoute = handlerForVoidCreditNote();

let memory;
const tables = [
  'sales',
  'sales_returns',
  'products',
  'credit_notes',
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
      due_date TEXT,
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
      balance_remaining REAL,
      status TEXT DEFAULT 'active',
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

// -------------------------------------------------------------
// SALES RETURN VOID TESTS
// -------------------------------------------------------------

test('Sales Return Void: Successful void of cash refund return reverses stock and ledger', async () => {
  // Setup: Product had stock 15 after return of 5 (initial was 10 before return, 15 after return)
  await memory.run("INSERT INTO products (id, name, sku, stock) VALUES ('p1', 'Hammer', 'HAM01', 15)");
  await memory.run(`
    INSERT INTO sales (id, invoice_no, items, total, payment_received, payment_method, status)
    VALUES ('s1', 'INV-1001', '[{"productId":"p1","qty":5,"unitPrice":100}]', 500, 500, 'cash', 'Partially Returned')
  `);
  await memory.run(`
    INSERT INTO sales_returns (id, return_no, invoice_no, returned_items, return_method, return_amount, status)
    VALUES ('ret1', 'RET-001', 'INV-1001', '[{"productId":"p1","qty":5}]', 'Cash Refund', 500, 'active')
  `);
  await memory.run(`
    INSERT INTO transactions (id, type, category, description, amount, reference)
    VALUES ('t1', 'expense', 'Sales Return Cash Refund', 'Refund for INV-1001', 500, 'INV-1001')
  `);

  const result = await executeVoidSalesReturn('ret1', { reason: 'Customer cancelled return' }, { db });
  assert.equal(result.success, true);
  assert.equal(result.id, 'ret1');

  // Verify return status is voided
  const ret = await memory.get("SELECT * FROM sales_returns WHERE id = 'ret1'");
  assert.equal(ret.status, 'voided');

  // Verify product stock is re-deducted (15 - 5 = 10)
  const prod = await memory.get("SELECT * FROM products WHERE id = 'p1'");
  assert.equal(prod.stock, 10);

  // Verify financial ledger transaction is deleted
  const tx = await memory.get("SELECT * FROM transactions WHERE id = 't1'");
  assert.equal(tx, undefined);

  // Verify sales invoice status is restored to 'Paid'
  const sale = await memory.get("SELECT * FROM sales WHERE id = 's1'");
  assert.equal(sale.status, 'Paid');

  // Verify sync queue has operations
  const syncs = await memory.all("SELECT * FROM sync_queue WHERE record_id = 'ret1'");
  assert.ok(syncs.some(s => s.table_name === 'sales_returns' && s.action === 'UPDATE'));
});

test('Sales Return Void: Successful void of exchange return reverses both return and exchange stocks', async () => {
  // Returned item p1 (returned 2, so stock increased by 2 -> now 12; should be re-deducted to 10)
  // Exchanged item p2 (taken 1, so stock decreased by 1 -> now 4; should be re-stocked to 5)
  await memory.run("INSERT INTO products (id, name, sku, stock) VALUES ('p1', 'Returned Item', 'SKU1', 12)");
  await memory.run("INSERT INTO products (id, name, sku, stock) VALUES ('p2', 'Exchange Item', 'SKU2', 4)");
  await memory.run(`
    INSERT INTO sales (id, invoice_no, items, total, payment_received, payment_method, status)
    VALUES ('s2', 'INV-1002', '[{"productId":"p1","qty":5}]', 500, 500, 'cash', 'Partially Returned')
  `);
  await memory.run(`
    INSERT INTO sales_returns (id, return_no, invoice_no, returned_items, exchange_items, return_method, status)
    VALUES ('ret2', 'RET-002', 'INV-1002', '[{"productId":"p1","qty":2}]', '[{"productId":"p2","qty":1}]', 'Exchange', 'active')
  `);

  const result = await executeVoidSalesReturn('ret2', {}, { db });
  assert.equal(result.success, true);

  const p1 = await memory.get("SELECT stock FROM products WHERE id = 'p1'");
  assert.equal(p1.stock, 10); // 12 - 2

  const p2 = await memory.get("SELECT stock FROM products WHERE id = 'p2'");
  assert.equal(p2.stock, 5); // 4 + 1
});

test('Sales Return Void: Associated credit note is voided and balance set to 0', async () => {
  await memory.run("INSERT INTO products (id, name, sku, stock) VALUES ('p1', 'Item', 'SKU1', 10)");
  await memory.run(`
    INSERT INTO credit_notes (id, credit_note_no, amount, balance_remaining, status)
    VALUES ('cn1', 'CN-001', 300, 300, 'Active')
  `);
  await memory.run(`
    INSERT INTO sales_returns (id, return_no, invoice_no, returned_items, credit_note_no, return_method, status)
    VALUES ('ret3', 'RET-003', 'INV-1003', '[{"productId":"p1","qty":1}]', 'CN-001', 'Credit Note', 'active')
  `);

  const result = await executeVoidSalesReturn('ret3', {}, { db });
  assert.equal(result.success, true);

  const cn = await memory.get("SELECT * FROM credit_notes WHERE id = 'cn1'");
  assert.equal(cn.status, 'voided');
  assert.equal(cn.balance_remaining, 0);

  const sync = await memory.get("SELECT * FROM sync_queue WHERE table_name = 'credit_notes' AND record_id = 'cn1'");
  assert.ok(sync);
});

test('Sales Return Void: Non-existent return ID throws 404', async () => {
  await assert.rejects(
    async () => await executeVoidSalesReturn('non-existent', {}, { db }),
    err => {
      assert.equal(err.status, 404);
      assert.match(err.message, /not found/i);
      return true;
    }
  );
});

test('Sales Return Void: Repeated void request against already voided return throws 400', async () => {
  await memory.run(`
    INSERT INTO sales_returns (id, return_no, invoice_no, returned_items, status)
    VALUES ('ret_voided', 'RET-004', 'INV-1004', '[]', 'voided')
  `);

  await assert.rejects(
    async () => await executeVoidSalesReturn('ret_voided', {}, { db }),
    err => {
      assert.equal(err.status, 400);
      assert.match(err.message, /already voided/i);
      return true;
    }
  );
});

test('Sales Return Void: Mid-operation DB failure rolls back completely', async () => {
  await memory.run("INSERT INTO products (id, name, sku, stock) VALUES ('p1', 'Item', 'SKU1', 20)");
  await memory.run(`
    INSERT INTO sales_returns (id, return_no, invoice_no, returned_items, status)
    VALUES ('ret_fail', 'RET-005', 'INV-1005', '[{"productId":"p1","qty":5}]', 'active')
  `);

  const beforeSnap = await snapshot();

  const origRun = memory.run.bind(memory);
  memory.run = async function (sql, ...args) {
    if (typeof sql === 'string' && sql.includes('UPDATE products SET stock')) {
      throw new Error('Simulated write failure mid-transaction');
    }
    return origRun(sql, ...args);
  };

  await assert.rejects(
    async () => await executeVoidSalesReturn('ret_fail', {}, { db }),
    /Simulated write failure/
  );

  memory.run = origRun;

  const afterSnap = await snapshot();
  // Ensure product stock and sales return status were rolled back completely
  assert.deepEqual(afterSnap.products, beforeSnap.products);
  assert.deepEqual(afterSnap.sales_returns, beforeSnap.sales_returns);
  assert.deepEqual(afterSnap.sync_queue, beforeSnap.sync_queue);
});

test('Sales Return Void: Concurrent void requests safely allow only one to succeed', async () => {
  await memory.run("INSERT INTO products (id, name, sku, stock) VALUES ('p1', 'Item', 'SKU1', 10)");
  await memory.run(`
    INSERT INTO sales_returns (id, return_no, invoice_no, returned_items, status)
    VALUES ('ret_race', 'RET-006', 'INV-1006', '[{"productId":"p1","qty":2}]', 'active')
  `);

  const results = await Promise.allSettled([
    executeVoidSalesReturn('ret_race', {}, { db }),
    executeVoidSalesReturn('ret_race', {}, { db })
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /already voided/i);

  // Stock must be deducted only ONCE (10 - 2 = 8)
  const prod = await memory.get("SELECT stock FROM products WHERE id = 'p1'");
  assert.equal(prod.stock, 8);
});

// -------------------------------------------------------------
// CREDIT NOTE VOID TESTS
// -------------------------------------------------------------

test('Credit Note Void: Successful void of active credit note sets status and balance', async () => {
  await memory.run(`
    INSERT INTO credit_notes (id, credit_note_no, code, amount, balance_remaining, status)
    VALUES ('cn10', 'CN-1010', 'CN-1010', 1500, 1500, 'Active')
  `);

  const result = await executeVoidCreditNote('cn10', { reason: 'Incorrect return value' }, { db });
  assert.equal(result.success, true);
  assert.equal(result.id, 'cn10');
  assert.equal(result.credit_note_no, 'CN-1010');

  const cn = await memory.get("SELECT * FROM credit_notes WHERE id = 'cn10'");
  assert.equal(cn.status, 'voided');
  assert.equal(cn.balance_remaining, 0);

  const sync = await memory.get("SELECT * FROM sync_queue WHERE table_name = 'credit_notes' AND record_id = 'cn10'");
  assert.ok(sync);
  assert.equal(sync.action, 'UPDATE');

  const audit = await memory.get("SELECT * FROM audit_logs WHERE action = 'VOID_CREDIT_NOTE'");
  assert.ok(audit);
  assert.match(audit.details, /CN-1010/);
});

test('Credit Note Void: Non-existent credit note throws 404', async () => {
  await assert.rejects(
    async () => await executeVoidCreditNote('CN-9999', {}, { db }),
    err => {
      assert.equal(err.status, 404);
      assert.match(err.message, /not found/i);
      return true;
    }
  );
});

test('Credit Note Void: Already voided credit note throws 400', async () => {
  await memory.run(`
    INSERT INTO credit_notes (id, credit_note_no, code, amount, balance_remaining, status)
    VALUES ('cn_voided', 'CN-1020', 'CN-1020', 500, 0, 'voided')
  `);

  await assert.rejects(
    async () => await executeVoidCreditNote('cn_voided', {}, { db }),
    err => {
      assert.equal(err.status, 400);
      assert.match(err.message, /already been voided/i);
      return true;
    }
  );
});

test('Credit Note Void: Rejects voiding a credit note that was already used or redeemed', async () => {
  // Case A: status is 'Fully Used'
  await memory.run(`
    INSERT INTO credit_notes (id, credit_note_no, code, amount, balance_remaining, status)
    VALUES ('cn_used', 'CN-1030', 'CN-1030', 500, 0, 'Fully Used')
  `);

  await assert.rejects(
    async () => await executeVoidCreditNote('cn_used', {}, { db }),
    err => {
      assert.equal(err.status, 400);
      assert.match(err.message, /already been used/i);
      return true;
    }
  );

  // Case B: partially used (balance_remaining < amount)
  await memory.run(`
    INSERT INTO credit_notes (id, credit_note_no, code, amount, balance_remaining, status)
    VALUES ('cn_part', 'CN-1031', 'CN-1031', 1000, 400, 'Partially Used')
  `);

  await assert.rejects(
    async () => await executeVoidCreditNote('cn_part', {}, { db }),
    err => {
      assert.equal(err.status, 400);
      assert.match(err.message, /already been used/i);
      return true;
    }
  );
});

test('Credit Note Void: Mid-operation failure rolls back completely', async () => {
  await memory.run(`
    INSERT INTO credit_notes (id, credit_note_no, code, amount, balance_remaining, status)
    VALUES ('cn_fail', 'CN-1040', 'CN-1040', 800, 800, 'Active')
  `);

  const beforeSnap = await snapshot();

  const origRun = memory.run.bind(memory);
  memory.run = async function (sql, ...args) {
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      throw new Error('Simulated audit failure on credit note void');
    }
    return origRun(sql, ...args);
  };

  await assert.rejects(
    async () => await executeVoidCreditNote('cn_fail', {}, { db }),
    /Simulated audit failure/
  );

  memory.run = origRun;

  const afterSnap = await snapshot();
  assert.deepEqual(afterSnap.credit_notes, beforeSnap.credit_notes);
  assert.deepEqual(afterSnap.sync_queue, beforeSnap.sync_queue);
});

test('Credit Note Void: Concurrent void requests safely allow only one to succeed', async () => {
  await memory.run(`
    INSERT INTO credit_notes (id, credit_note_no, code, amount, balance_remaining, status)
    VALUES ('cn_race', 'CN-1050', 'CN-1050', 500, 500, 'Active')
  `);

  const results = await Promise.allSettled([
    executeVoidCreditNote('cn_race', {}, { db }),
    executeVoidCreditNote('cn_race', {}, { db })
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /already been voided/i);
});

// -------------------------------------------------------------
// ROUTE HANDLER TESTS (API Contracts)
// -------------------------------------------------------------

test('Route: POST /api/sales/returns/:id/void returns JSON success', async () => {
  await memory.run("INSERT INTO products (id, name, sku, stock) VALUES ('p1', 'Item', 'SKU1', 10)");
  await memory.run(`
    INSERT INTO sales_returns (id, return_no, invoice_no, returned_items, status)
    VALUES ('ret_route', 'RET-007', 'INV-1007', '[{"productId":"p1","qty":1}]', 'active')
  `);

  const req = { params: { id: 'ret_route' }, body: { reason: 'Test' } };
  const res = mockRes();

  await voidReturnRoute(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.id, 'ret_route');
});

test('Route: POST /api/sales/credit-notes/:id/void returns JSON success', async () => {
  await memory.run(`
    INSERT INTO credit_notes (id, credit_note_no, code, amount, balance_remaining, status)
    VALUES ('cn_route', 'CN-1060', 'CN-1060', 250, 250, 'Active')
  `);

  const req = { params: { id: 'cn_route' }, body: { reason: 'Test void' } };
  const res = mockRes();

  await voidCreditNoteRoute(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.success, true);
  assert.equal(res.data.id, 'cn_route');
});

test('Route: POST /api/sales/credit-notes/:id/void returns error contract on 404', async () => {
  const req = { params: { id: 'does_not_exist' }, body: {} };
  const res = mockRes();

  await voidCreditNoteRoute(req, res);
  assert.equal(res.statusCode, 404);
  assert.ok(res.data.error);
});
