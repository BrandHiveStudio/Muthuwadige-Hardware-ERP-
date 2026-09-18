// B05 Isolated Purchasing Frontend Alignment Test Suite
// Verifies:
// 1. T-B05-01: Atomic PO receipt with CREDIT settlement (stock increment, supplier balance, transport expense)
// 2. T-B05-02: Atomic PO receipt with CASH/BANK settlement (expense transaction, no supplier balance increment)
// 3. T-B05-03: Atomic PO receipt with CHEQUE settlement (outward cheque registry record, pending status)
// 4. T-B05-04: Already-received / Idempotency protection (HTTP 400, no stock or balance duplicates)
// 5. T-B05-05: Frontend duplicate-mutation invariant (static AST/grep analysis of Purchasing.tsx)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import app, { setDb } from '../../server.js';
import { ensureSyncSchema } from '../../src/services/syncService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

function normalizeParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0];
  }
  return params;
}

/**
 * Creates a disposable in-memory SQLite database with required ERP tables
 */
async function createDisposableDb() {
  const db = await open({
    filename: ':memory:',
    driver: sqlite3.Database
  });

  const origRun = db.run.bind(db);
  const origGet = db.get.bind(db);
  const origAll = db.all.bind(db);

  db.run = (sql, ...params) => origRun(sql, normalizeParams(params));
  db.get = (sql, ...params) => origGet(sql, normalizeParams(params));
  db.all = (sql, ...params) => origAll(sql, normalizeParams(params));

  db.transaction = async function (fn) {
    await db.run('BEGIN TRANSACTION');
    try {
      const res = await fn();
      await db.run('COMMIT');
      return res;
    } catch (err) {
      try {
        await db.run('ROLLBACK');
      } catch (_) {}
      throw err;
    }
  };

  // Minimal schema needed for PO receiving and settlement
  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT UNIQUE,
      name TEXT,
      category TEXT,
      price REAL DEFAULT 0,
      selling_price REAL DEFAULT 0,
      cost_price REAL DEFAULT 0,
      stock REAL DEFAULT 0,
      stock_quantity REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      supplier TEXT,
      unit TEXT DEFAULT 'pcs',
      barcode TEXT,
      brand TEXT,
      measure_details TEXT,
      serial_no TEXT DEFAULT '',
      batch_code TEXT DEFAULT '',
      expiry_date TEXT,
      supplier_phone TEXT DEFAULT '',
      parent_product_id TEXT,
      is_batch INTEGER DEFAULT 0,
      batch_number INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      po_number TEXT,
      po_no TEXT,
      supplier_id TEXT,
      supplier_name TEXT,
      total_amount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      net_total REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
      original_total REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      transportation_fee REAL DEFAULT 0,
      status TEXT DEFAULT 'Draft',
      items TEXT NOT NULL DEFAULT '[]',
      payment_method TEXT DEFAULT 'CREDIT',
      settlement_mode TEXT DEFAULT 'CREDIT',
      branch_id TEXT DEFAULT 'MAIN',
      station_id TEXT DEFAULT 'POS1',
      received_at TEXT,
      received_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      payable_balance REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      product_name TEXT,
      old_qty REAL DEFAULT 0,
      new_qty REAL DEFAULT 0,
      delta_qty REAL DEFAULT 0,
      previous_stock REAL DEFAULT 0,
      new_stock REAL DEFAULT 0,
      adjustment REAL DEFAULT 0,
      adjustment_type TEXT,
      type TEXT,
      reason TEXT,
      user_name TEXT,
      user_email TEXT,
      branch_id TEXT DEFAULT 'MAIN',
      station_id TEXT DEFAULT 'POS1',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      type TEXT,
      category TEXT,
      description TEXT,
      amount REAL DEFAULT 0,
      date TEXT,
      reference TEXT,
      user_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cheque_registry (
      id TEXT PRIMARY KEY,
      direction TEXT,
      cheque_type TEXT,
      cheque_number TEXT,
      bank_name TEXT,
      branch TEXT,
      cheque_date TEXT,
      amount REAL DEFAULT 0,
      party_id TEXT,
      party_name TEXT,
      reference_type TEXT,
      reference_id TEXT,
      status TEXT DEFAULT 'PENDING',
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_name TEXT,
      user_email TEXT,
      user_role TEXT,
      action TEXT,
      details TEXT,
      timestamp TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      email TEXT,
      username TEXT,
      name TEXT,
      full_name TEXT,
      role TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT,
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload JSON NOT NULL,
      status TEXT DEFAULT 'PENDING',
      retry_count INTEGER DEFAULT 0,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);

    CREATE TABLE IF NOT EXISTS sync_pull_marker (
      id INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY,
      key TEXT,
      value TEXT,
      next_invoice_number TEXT,
      system_wipe_timestamp TEXT,
      last_counter_sync_timestamp TEXT,
      last_sync_timestamp TEXT,
      counter_sync_status TEXT DEFAULT 'IDLE',
      counter_pending_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS deleted_records (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (table_name, record_id)
    );
  `);

  // Initialize and verify sync schema extensions & indexes via syncService
  await ensureSyncSchema(db);

  return db;
}

test('B05 Purchasing Alignment Suite', async (t) => {
  const db = await createDisposableDb();
  setDb(db);

  // Spin up real Express app on ephemeral loopback port
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
  });

  // Seed authenticated test session satisfying real server.js authenticate middleware
  const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db.run(
    `INSERT INTO sessions (id, token, user_id, email, role, expires_at)
     VALUES ('sess_b05_test', 'test_token', 'user_storekeeper', 'storekeeper@hardware.com', 'admin', ?)`,
    [futureExpiry]
  );

  await db.run(
    `INSERT INTO profiles (id, email, username, name, full_name, role)
     VALUES ('user_storekeeper', 'storekeeper@hardware.com', 'storekeeper', 'Storekeeper', 'Storekeeper', 'admin')`
  );

  // Setup baseline inventory and supplier data
  await db.run(
    `INSERT INTO suppliers (id, name, payable_balance)
     VALUES ('sup_steel', 'Lanka Steel Mills', 5000.0)`
  );

  await db.run(
    `INSERT INTO products (id, sku, name, category, price, selling_price, cost_price, stock, stock_quantity, min_stock, supplier, unit)
     VALUES ('prod_rebar', 'SKU-REBAR-12', '12mm TMT Steel Rebar', 'Steel', 3200, 3200, 2600, 20, 20, 10, 'Lanka Steel Mills', 'bar')`
  );

  // -------------------------------------------------------------------------
  // T-B05-01: Atomic PO Receipt with CREDIT settlement
  // -------------------------------------------------------------------------
  await t.test('T-B05-01: Atomic PO receipt with CREDIT settlement', async () => {
    const poItems = [
      { productId: 'prod_rebar', productName: '12mm TMT Steel Rebar', qty: 10, costPrice: 2600 }
    ];

    await db.run(
      `INSERT INTO purchase_orders (
        id, po_number, po_no, supplier_id, supplier_name,
        total_amount, total, net_total, subtotal, original_total,
        transportation_fee, status, items, settlement_mode, payment_method
      ) VALUES (
        'po_b05_01', 'PO-B05-001', 'PO-B05-001', 'sup_steel', 'Lanka Steel Mills',
        26000, 26000, 26000, 26000, 26000,
        1500, 'Ordered', ?, 'CREDIT', 'CREDIT'
      )`,
      [JSON.stringify(poItems)]
    );

    const res = await fetch(`${baseUrl}/api/purchasing/receive-po`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token'
      },
      body: JSON.stringify({
        po_id: 'po_b05_01',
        po_number: 'PO-B05-001',
        settlement_mode: 'CREDIT',
        received_by: 'Storekeeper'
      })
    });

    const body = await res.json();
    assert.equal(res.status, 200, `Expected HTTP 200, got ${res.status}: ${JSON.stringify(body)}`);
    assert.ok(body.success, 'Expected response body success: true');

    // 1. Verify PO status
    const po = await db.get('SELECT status, received_by FROM purchase_orders WHERE id = ?', ['po_b05_01']);
    assert.equal(po.status, 'Received', 'PO status must be Received');
    assert.equal(po.received_by, 'Storekeeper', 'PO received_by must match request');

    // 2. Verify Product stock incremented exactly once (20 + 10 = 30)
    const product = await db.get('SELECT stock, stock_quantity FROM products WHERE id = ?', ['prod_rebar']);
    assert.equal(Number(product.stock), 30, 'Product stock must increment by 10 (20 -> 30)');

    // 3. Verify stock_adjustments recorded
    const adjustments = await db.all("SELECT * FROM stock_adjustments WHERE product_id = ?", ['prod_rebar']);
    assert.equal(adjustments.length, 1, 'Exactly one stock_adjustment must be created');
    assert.equal(Number(adjustments[0].old_qty), 20, 'Adjustment old_qty must be 20');
    assert.equal(Number(adjustments[0].new_qty), 30, 'Adjustment new_qty must be 30');

    // 4. Verify Supplier payable_balance incremented by net total (5000 + 26000 = 31000)
    const supplier = await db.get('SELECT payable_balance FROM suppliers WHERE id = ?', ['sup_steel']);
    assert.equal(Number(supplier.payable_balance), 31000, 'Supplier payable_balance must increase by PO total (5000 -> 31000)');

    // 5. Verify Transportation fee transaction created (1500)
    const transportTx = await db.get(
      "SELECT * FROM transactions WHERE category = 'Transportation' AND reference = 'PO-B05-001'"
    );
    assert.ok(transportTx, 'Transportation expense transaction must exist');
    assert.equal(Number(transportTx.amount), 1500, 'Transportation fee amount must be 1500');
  });

  // -------------------------------------------------------------------------
  // T-B05-02: Atomic PO Receipt with CASH settlement
  // -------------------------------------------------------------------------
  await t.test('T-B05-02: Atomic PO receipt with CASH settlement', async () => {
    await db.run(
      `INSERT INTO products (id, sku, name, cost_price, stock, stock_quantity, supplier)
       VALUES ('prod_paint', 'SKU-PAINT-01', 'Brilliant White Paint 10L', 4500, 5, 5, 'ColorCo')`
    );

    await db.run(
      `INSERT INTO suppliers (id, name, payable_balance)
       VALUES ('sup_color', 'ColorCo', 12000.0)`
    );

    const poItems = [
      { productId: 'prod_paint', productName: 'Brilliant White Paint 10L', qty: 4, costPrice: 4500 }
    ];

    await db.run(
      `INSERT INTO purchase_orders (
        id, po_number, po_no, supplier_id, supplier_name,
        total_amount, total, net_total, subtotal, original_total,
        status, items, settlement_mode, payment_method
      ) VALUES (
        'po_b05_02', 'PO-B05-002', 'PO-B05-002', 'sup_color', 'ColorCo',
        18000, 18000, 18000, 18000, 18000,
        'Ordered', ?, 'CASH', 'CASH'
      )`,
      [JSON.stringify(poItems)]
    );

    const res = await fetch(`${baseUrl}/api/purchasing/receive-po`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token'
      },
      body: JSON.stringify({
        po_id: 'po_b05_02',
        settlement_mode: 'CASH',
        received_by: 'Cashier1'
      })
    });

    const body = await res.json();
    assert.equal(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    assert.ok(body.success, 'Expected success: true');

    // 1. Verify stock incremented (5 + 4 = 9)
    const product = await db.get('SELECT stock FROM products WHERE id = ?', ['prod_paint']);
    assert.equal(Number(product.stock), 9, 'Stock must increment by 4 (5 -> 9)');

    // 2. Verify supplier payable_balance NOT incremented
    const supplier = await db.get('SELECT payable_balance FROM suppliers WHERE id = ?', ['sup_color']);
    assert.equal(Number(supplier.payable_balance), 12000, 'Supplier payable_balance must NOT change for cash settlement');

    // 3. Verify Supplier Payment transaction logged in transactions
    const paymentTx = await db.get(
      "SELECT * FROM transactions WHERE category = 'Supplier Payment' AND description LIKE '%PO-B05-002%'"
    );
    assert.ok(paymentTx, 'Supplier Payment expense transaction must exist');
    assert.equal(Number(paymentTx.amount), 18000, 'Expense amount must equal PO grand total 18000');
    assert.equal(paymentTx.type, 'expense', 'Transaction type must be expense');
  });

  // -------------------------------------------------------------------------
  // T-B05-03: Atomic PO Receipt with CHEQUE settlement
  // -------------------------------------------------------------------------
  await t.test('T-B05-03: Atomic PO receipt with CHEQUE settlement', async () => {
    await db.run(
      `INSERT INTO products (id, sku, name, cost_price, stock, stock_quantity, supplier)
       VALUES ('prod_pvc', 'SKU-PVC-4', '4 inch PVC Pipe 4m', 1200, 30, 30, 'PipeCo')`
    );

    await db.run(
      `INSERT INTO suppliers (id, name, payable_balance)
       VALUES ('sup_pipe', 'PipeCo', 2000.0)`
    );

    const poItems = [
      { productId: 'prod_pvc', productName: '4 inch PVC Pipe 4m', qty: 10, costPrice: 1200 }
    ];

    await db.run(
      `INSERT INTO purchase_orders (
        id, po_number, po_no, supplier_id, supplier_name,
        total_amount, total, net_total, subtotal, original_total,
        status, items, settlement_mode, payment_method
      ) VALUES (
        'po_b05_03', 'PO-B05-003', 'PO-B05-003', 'sup_pipe', 'PipeCo',
        12000, 12000, 12000, 12000, 12000,
        'Ordered', ?, 'CHEQUE', 'CHEQUE'
      )`,
      [JSON.stringify(poItems)]
    );

    const res = await fetch(`${baseUrl}/api/purchasing/receive-po`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token'
      },
      body: JSON.stringify({
        po_id: 'po_b05_03',
        settlement_mode: 'CHEQUE',
        cheque_number: 'CHQ-889900',
        bank_name: 'Commercial Bank of Ceylon',
        cheque_date: '2026-10-01',
        notes: '30-day post-dated cheque'
      })
    });

    const body = await res.json();
    assert.equal(res.status, 200, `Expected HTTP 200, got ${res.status}`);
    assert.ok(body.success, 'Expected success: true');

    // 1. Verify stock incremented (30 + 10 = 40)
    const product = await db.get('SELECT stock FROM products WHERE id = ?', ['prod_pvc']);
    assert.equal(Number(product.stock), 40, 'Stock must increment by 10 (30 -> 40)');

    // 2. Verify supplier payable_balance unchanged
    const supplier = await db.get('SELECT payable_balance FROM suppliers WHERE id = ?', ['sup_pipe']);
    assert.equal(Number(supplier.payable_balance), 2000, 'Supplier payable_balance must NOT change for cheque settlement');

    // 3. Verify outward cheque registered in cheque_registry
    const cheque = await db.get('SELECT * FROM cheque_registry WHERE cheque_number = ?', ['CHQ-889900']);
    assert.ok(cheque, 'Outward cheque must exist in cheque_registry');
    assert.equal(cheque.direction, 'OUTWARD', 'Cheque direction must be OUTWARD');
    assert.equal(cheque.bank_name, 'Commercial Bank of Ceylon', 'Bank name must match');
    assert.equal(Number(cheque.amount), 12000, 'Cheque amount must match PO grand total 12000');
    assert.equal(cheque.status, 'PENDING', 'Cheque initial status must be PENDING');
    assert.equal(cheque.cheque_date, '2026-10-01', 'Cheque date must match');
  });

  // -------------------------------------------------------------------------
  // T-B05-04: Already-Received / Idempotency Protection
  // -------------------------------------------------------------------------
  await t.test('T-B05-04: Already-received / idempotency protection', async () => {
    // Attempting to receive PO-B05-001 again (which was already received in T-B05-01)
    const preProduct = await db.get('SELECT stock FROM products WHERE id = ?', ['prod_rebar']);
    const preSupplier = await db.get('SELECT payable_balance FROM suppliers WHERE id = ?', ['sup_steel']);
    const preAdjustments = await db.all('SELECT * FROM stock_adjustments WHERE product_id = ?', ['prod_rebar']);

    const res = await fetch(`${baseUrl}/api/purchasing/receive-po`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test_token'
      },
      body: JSON.stringify({
        po_id: 'po_b05_01',
        settlement_mode: 'CREDIT'
      })
    });

    const body = await res.json();
    assert.equal(res.status, 400, 'Must return HTTP 400 for already received PO');
    assert.ok(
      body.error && body.error.toLowerCase().includes('already received'),
      `Expected 'already received' error message, got: ${body.error}`
    );

    // Assert zero changes to stock
    const postProduct = await db.get('SELECT stock FROM products WHERE id = ?', ['prod_rebar']);
    assert.equal(Number(postProduct.stock), Number(preProduct.stock), 'Stock must NOT change on duplicate receive call');

    // Assert zero changes to supplier balance
    const postSupplier = await db.get('SELECT payable_balance FROM suppliers WHERE id = ?', ['sup_steel']);
    assert.equal(Number(postSupplier.payable_balance), Number(preSupplier.payable_balance), 'Supplier balance must NOT change on duplicate call');

    // Assert zero additional stock adjustments
    const postAdjustments = await db.all('SELECT * FROM stock_adjustments WHERE product_id = ?', ['prod_rebar']);
    assert.equal(postAdjustments.length, preAdjustments.length, 'No duplicate stock_adjustments should be inserted');
  });

  // -------------------------------------------------------------------------
  // T-B05-05: Frontend Duplicate-Mutation Invariant Check
  // -------------------------------------------------------------------------
  await t.test('T-B05-05: Frontend duplicate-mutation invariant in Purchasing.tsx', async () => {
    const purchasingFilePath = path.resolve(projectRoot, 'src', 'pages', 'Purchasing.tsx');
    assert.ok(fs.existsSync(purchasingFilePath), 'src/pages/Purchasing.tsx must exist');

    const source = fs.readFileSync(purchasingFilePath, 'utf-8');

    // Extract the handleConfirmReceiveAndSettle function block
    const fnStartMatch = source.match(/const\s+handleConfirmReceiveAndSettle\s*=\s*async\s*\(\)\s*=>\s*\{/);
    assert.ok(fnStartMatch, 'handleConfirmReceiveAndSettle must be defined in Purchasing.tsx');

    const fnStartIndex = fnStartMatch.index;
    // Find matching closing brace or next function boundary
    const subsequentSlice = source.slice(fnStartIndex, fnStartIndex + 4000);
    const fnEndMatch = subsequentSlice.match(/\n\s*const\s+addReturnItem/);
    const fnBody = fnEndMatch ? subsequentSlice.slice(0, fnEndMatch.index) : subsequentSlice.slice(0, 2500);

    // Invariant assertions: The frontend PO receiving handler must NOT contain direct client-side DB updates
    assert.ok(
      !fnBody.includes("supabase.from('products').update"),
      "handleConfirmReceiveAndSettle must NOT call supabase.from('products').update"
    );
    assert.ok(
      !fnBody.includes("supabase.from('products').insert"),
      "handleConfirmReceiveAndSettle must NOT call supabase.from('products').insert"
    );
    assert.ok(
      !fnBody.includes("supabase.from('suppliers').update"),
      "handleConfirmReceiveAndSettle must NOT call supabase.from('suppliers').update"
    );
    assert.ok(
      !fnBody.includes("api.stockAdjustments.create"),
      "handleConfirmReceiveAndSettle must NOT call api.stockAdjustments.create"
    );
    assert.ok(
      !fnBody.includes("api.cheques.create"),
      "handleConfirmReceiveAndSettle must NOT call api.cheques.create"
    );

    // Positive assertion: It must invoke api.purchasing.receivePo
    assert.ok(
      fnBody.includes("api.purchasing.receivePo"),
      "handleConfirmReceiveAndSettle must delegate to api.purchasing.receivePo"
    );

    // Positive assertion: It must dispatch global UI refresh events
    assert.ok(
      fnBody.includes("refresh-purchasing"),
      "handleConfirmReceiveAndSettle must dispatch refresh-purchasing"
    );
    assert.ok(
      fnBody.includes("refresh-inventory"),
      "handleConfirmReceiveAndSettle must dispatch refresh-inventory"
    );
  });
});
