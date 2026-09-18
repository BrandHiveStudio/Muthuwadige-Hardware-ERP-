// B04 Isolated Regression Test Suite
// Verifies executeCreateSale() atomicity and delta preservation
// against a disposable in-memory SQLite database.

import test from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

import { executeCreateSale, setDb } from '../../server.js';
import { ensureSyncSchema } from '../../src/services/syncService.js';

function normalizeParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0];
  }
  return params;
}

/**
 * Creates a disposable in-memory SQLite database with ERP schema
 */
export async function createIsolatedInMemoryDb() {
  const mem = await open({
    filename: ':memory:',
    driver: sqlite3.Database
  });

  const origRun = mem.run.bind(mem);
  const origGet = mem.get.bind(mem);
  const origAll = mem.all.bind(mem);

  // Instrumentation for tracking queries
  const executedStatements = [];
  const adjustmentStatements = [];

  mem.getExecutedStatements = () => executedStatements;
  mem.getAdjustmentStatements = () => adjustmentStatements;
  mem.clearStatementLogs = () => {
    executedStatements.length = 0;
    adjustmentStatements.length = 0;
  };

  mem.run = (sql, ...params) => {
    const norm = normalizeParams(params);
    executedStatements.push({ sql, params: norm });
    if (typeof sql === 'string' && sql.includes('stock_adjustments')) {
      adjustmentStatements.push({ sql, params: norm });
    }
    return origRun(sql, norm);
  };

  mem.get = (sql, ...params) => origGet(sql, normalizeParams(params));
  mem.all = (sql, ...params) => origAll(sql, normalizeParams(params));

  let inTxn = false;
  mem.isInTransaction = () => inTxn;

  mem.transaction = async function (fn) {
    inTxn = true;
    await mem.run('BEGIN TRANSACTION');
    try {
      const res = await fn();
      await mem.run('COMMIT');
      return res;
    } catch (err) {
      try {
        await mem.run('ROLLBACK');
      } catch (_) {}
      throw err;
    } finally {
      inTxn = false;
    }
  };

  // Base ERP schema required for executeCreateSale, ledger accounting, and sync queue
  await mem.exec(`
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
      parent_product_id TEXT,
      is_batch INTEGER DEFAULT 0,
      batch_number INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      balance REAL DEFAULT 0,
      credit_limit REAL DEFAULT 0,
      credit_period INTEGER DEFAULT 0,
      type TEXT DEFAULT 'registered',
      total_purchases REAL DEFAULT 0,
      loyalty_points INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      invoice_no TEXT UNIQUE,
      customer_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      customer_address TEXT,
      items TEXT,
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      transportation_fee REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      status TEXT DEFAULT 'completed',
      user_id TEXT,
      user_email TEXT,
      cashier TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      due_date TEXT,
      credit_period_days INTEGER DEFAULT 0,
      payment_received REAL DEFAULT 0,
      credit_note_applied REAL DEFAULT 0,
      credit_note_code TEXT,
      client_tx_id TEXT,
      branch_id TEXT,
      station_id TEXT
    );

    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      product_name TEXT,
      old_qty REAL DEFAULT 0,
      new_qty REAL DEFAULT 0,
      reason TEXT,
      type TEXT,
      user_email TEXT,
      branch_id TEXT,
      station_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      sale_id TEXT,
      invoice_no TEXT,
      type TEXT NOT NULL,
      category TEXT,
      description TEXT,
      amount REAL NOT NULL,
      date TEXT,
      reference TEXT,
      user_id TEXT,
      payment_method TEXT,
      branch_id TEXT DEFAULT 'MAIN',
      station_id TEXT DEFAULT 'POS1',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_email TEXT,
      action TEXT NOT NULL,
      details TEXT,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_name TEXT,
      user_role TEXT
    );

    CREATE TABLE IF NOT EXISTS credit_notes (
      id TEXT PRIMARY KEY,
      credit_note_no TEXT UNIQUE,
      code TEXT,
      customer_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      amount REAL DEFAULT 0,
      value REAL DEFAULT 0,
      balance_remaining REAL DEFAULT 0,
      status TEXT DEFAULT 'Active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS credit_note_usage (
      id TEXT PRIMARY KEY,
      credit_note_no TEXT,
      invoice_no TEXT,
      customer_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      amount_applied REAL DEFAULT 0,
      previous_balance REAL DEFAULT 0,
      remaining_balance REAL DEFAULT 0,
      action TEXT,
      user_email TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

  // Initialize sync schema extensions & indexes
  await ensureSyncSchema(mem);

  return mem;
}

async function getDbSnapshot(db, productId = 'prod_b04_01') {
  const stockRow = await db.get('SELECT stock FROM products WHERE id = ?', [productId]);
  const salesCount = await db.get('SELECT COUNT(*) as cnt FROM sales');
  const ledgerCount = await db.get('SELECT COUNT(*) as cnt FROM transactions');
  const syncQueueCount = await db.get('SELECT COUNT(*) as cnt FROM sync_queue');
  const saTableExists = (await db.get("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='stock_adjustments'")).cnt > 0;
  const saCount = saTableExists ? (await db.get('SELECT COUNT(*) as cnt FROM stock_adjustments')).cnt : 0;
  return {
    stock: stockRow ? Number(stockRow.stock) : null,
    salesCount: Number(salesCount.cnt),
    ledgerCount: Number(ledgerCount.cnt),
    syncQueueCount: Number(syncQueueCount.cnt),
    stockAdjustmentsCount: Number(saCount)
  };
}

test('B04 — Isolated Local Atomicity Regression Suite', async (t) => {
  // Database instance shared across Test B (failure & rollback) and Test C (post-rollback recovery)
  let sharedDbB = null;

  await t.test('TEST A — SUCCESSFUL SALE (Stock decrement, single adjustment, queue behavior, financial invariance)', async () => {
    const db = await createIsolatedInMemoryDb();
    setDb(db);

    await db.run(
      `INSERT INTO products (id, sku, name, price, selling_price, cost_price, stock, stock_quantity, min_stock, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['prod_b04_01', 'SKU-HAMMER-01', 'Steel Hammer 16oz', 1500, 1500, 1000, 10, 10, 2, 'pcs']
    );

    await db.run(
      `INSERT INTO customers (id, name, phone, balance, credit_limit, total_purchases, loyalty_points)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['cust_b04_01', 'Test Customer', '0771234567', 0, 10000, 0, 0]
    );

    const beforeA = await getDbSnapshot(db);
    console.log('\n--- TEST A: BEFORE STATE ---');
    console.log(JSON.stringify(beforeA, null, 2));

    assert.equal(beforeA.stock, 10, 'Initial stock must be 10');
    assert.equal(beforeA.salesCount, 0, 'Initial sales count must be 0');
    assert.equal(beforeA.ledgerCount, 0, 'Initial ledger count must be 0');
    assert.equal(beforeA.syncQueueCount, 0, 'Initial sync_queue count must be 0');
    assert.equal(beforeA.stockAdjustmentsCount, 0, 'Initial stock_adjustments count must be 0');

    const salePayload = {
      id: 'sale_b04_test_01',
      invoice_no: 'POS1-INV-10001',
      customer_id: 'cust_b04_01',
      customer_name: 'Test Customer',
      customer_phone: '0771234567',
      items: [{
        productId: 'prod_b04_01',
        name: 'Steel Hammer 16oz',
        qty: 4,
        unit_price: 1500,
        total: 6000,
        conversionRate: 1,
        unit: 'pcs'
      }],
      subtotal: 6000,
      total_amount: 6000,
      payment_method: 'Cash',
      status: 'Paid',
      user_email: 'cashier@hardware.erp',
      station_id: 'POS1',
      branch_id: 'MAIN'
    };

    const res = await executeCreateSale(salePayload);
    assert.equal(res.success, true, 'Sale invoice POS1-INV-10001 must succeed');

    const afterA = await getDbSnapshot(db);
    console.log('\n--- TEST A: AFTER STATE ---');
    console.log(JSON.stringify(afterA, null, 2));

    // Verify stock decremented: 10 -> 6
    assert.equal(afterA.stock, 6, 'Product stock must decrement from 10 to 6');

    // Verify exactly one stock_adjustments row recorded
    assert.equal(afterA.stockAdjustmentsCount, 1, 'Exactly one stock_adjustments row must exist');
    const adjustments = await db.all('SELECT * FROM stock_adjustments WHERE product_id = ?', ['prod_b04_01']);
    assert.equal(adjustments.length, 1);
    assert.equal(Number(adjustments[0].old_qty), 10, 'old_qty must be 10');
    assert.equal(Number(adjustments[0].new_qty), 6, 'new_qty must be 6');
    assert.equal(adjustments[0].type, 'Sale', 'Adjustment type must be Sale');
    assert.equal(adjustments[0].user_email, 'cashier@hardware.erp', 'Attribution user_email must be preserved');
    assert.equal(adjustments[0].station_id, 'POS1', 'Attribution station_id must be preserved');
    assert.equal(adjustments[0].branch_id, 'MAIN', 'Attribution branch_id must be preserved');

    // Verify sale order inserted with financial invariance
    const saleRow = await db.get('SELECT * FROM sales WHERE invoice_no = ?', ['POS1-INV-10001']);
    assert.ok(saleRow, 'Sale record must be present in sales table');
    assert.equal(Number(saleRow.subtotal), 6000, 'Subtotal calculation must be preserved');
    assert.equal(Number(saleRow.total_amount), 6000, 'Total calculation must be preserved');
    assert.equal(Number(saleRow.discount), 0, 'Discount must be 0');
    assert.equal(Number(saleRow.tax), 0, 'Tax must remain zero according to current implementation');
    assert.equal(Number(saleRow.tax_rate), 0, 'Tax rate must remain zero');

    // Verify ledger transaction created
    const txnRow = await db.get('SELECT * FROM transactions WHERE reference = ?', ['POS1-INV-10001']);
    assert.ok(txnRow, 'Ledger transaction record must be created');
    assert.equal(Number(txnRow.amount), 6000);
    assert.equal(txnRow.type, 'income');

    // Verify sync_queue mutations enqueued
    assert.ok(afterA.syncQueueCount >= 2, 'Sync queue must contain mutations for sale and products');

    await db.close();
    console.log('✔ TEST A passed cleanly: sale succeeded, stock 10 -> 6, 1 adjustment, tax=0, sync queued.');
  });

  await t.test('TEST B — FORCED ADJUSTMENT FAILURE (Both INSERT paths attempted, transaction rolled back)', async () => {
    // Fresh disposable database for Test B & Test C
    sharedDbB = await createIsolatedInMemoryDb();
    setDb(sharedDbB);

    await sharedDbB.run(
      `INSERT INTO products (id, sku, name, price, selling_price, cost_price, stock, stock_quantity, min_stock, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['prod_b04_01', 'SKU-HAMMER-01', 'Steel Hammer 16oz', 1500, 1500, 1000, 10, 10, 2, 'pcs']
    );

    await sharedDbB.run(
      `INSERT INTO customers (id, name, phone, balance, credit_limit, total_purchases, loyalty_points)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['cust_b04_01', 'Test Customer', '0771234567', 0, 10000, 0, 0]
    );

    const beforeB = await getDbSnapshot(sharedDbB);
    console.log('\n--- TEST B: BEFORE STATE ---');
    console.log(JSON.stringify(beforeB, null, 2));

    assert.equal(beforeB.stock, 10);
    assert.equal(beforeB.salesCount, 0);
    assert.equal(beforeB.ledgerCount, 0);
    assert.equal(beforeB.syncQueueCount, 0);
    assert.equal(beforeB.stockAdjustmentsCount, 0);

    // Force stock_adjustments INSERT failure by dropping the table
    await sharedDbB.run('DROP TABLE stock_adjustments');
    sharedDbB.clearStatementLogs();

    const failingSalePayload = {
      id: 'sale_b04_test_fail',
      invoice_no: 'POS1-INV-10002',
      customer_id: 'cust_b04_01',
      customer_name: 'Test Customer',
      customer_phone: '0771234567',
      items: [{
        productId: 'prod_b04_01',
        name: 'Steel Hammer 16oz',
        qty: 4,
        unit_price: 1500,
        total: 6000,
        conversionRate: 1,
        unit: 'pcs'
      }],
      subtotal: 6000,
      total_amount: 6000,
      payment_method: 'Cash',
      status: 'Paid',
      user_email: 'cashier@hardware.erp',
      station_id: 'POS1',
      branch_id: 'MAIN'
    };

    let thrownError = null;
    await assert.rejects(
      async () => {
        try {
          await executeCreateSale(failingSalePayload);
        } catch (err) {
          thrownError = err;
          throw err;
        }
      },
      (err) => {
        assert.ok(
          err.message.includes('Sale stock adjustment could not be recorded') ||
          err.message.includes('stock_adjustments'),
          `Error must originate from stock_adjustments failure: ${err.message}`
        );
        return true;
      },
      'executeCreateSale must reject when stock_adjustments cannot be recorded'
    );

    console.log('\n✔ Caught expected rejection from executeCreateSale():', thrownError?.message);

    // PROOF: Verify that BOTH primary and fallback adjustment INSERT paths were attempted
    const adjustmentAttempts = sharedDbB.getAdjustmentStatements();
    console.log(`\n--- ADJUSTMENT INSERT ATTEMPTS DETECTED (${adjustmentAttempts.length}) ---`);
    adjustmentAttempts.forEach((att, idx) => {
      console.log(`  [Attempt ${idx + 1}] SQL: ${att.sql.replace(/\s+/g, ' ').trim()}`);
    });

    assert.equal(adjustmentAttempts.length, 2, 'Server must have attempted BOTH primary and fallback adjustment INSERTs');
    assert.ok(
      adjustmentAttempts[0].sql.includes('branch_id') && adjustmentAttempts[0].sql.includes('station_id'),
      'First attempt must be primary INSERT containing branch_id and station_id'
    );
    assert.ok(
      !adjustmentAttempts[1].sql.includes('branch_id') && !adjustmentAttempts[1].sql.includes('station_id'),
      'Second attempt must be compatibility fallback INSERT omitting branch_id and station_id'
    );

    const afterB = await getDbSnapshot(sharedDbB);
    console.log('\n--- TEST B: AFTER ROLLBACK STATE ---');
    console.log(JSON.stringify(afterB, null, 2));

    // Atomicity Rollback Verifications
    assert.equal(afterB.stock, 10, 'Product stock MUST roll back to pre-sale value 10 (NOT remain decremented at 6)');
    assert.equal(afterB.salesCount, 0, 'No sale row must remain in sales table');
    assert.equal(afterB.ledgerCount, 0, 'No ledger row must remain in transactions table');
    assert.equal(afterB.syncQueueCount, 0, 'No sync_queue mutation must remain');
    assert.equal(afterB.stockAdjustmentsCount, 0, 'No stock_adjustments row must remain');
    assert.equal(sharedDbB.isInTransaction(), false, 'Transaction must NOT be left open');

    console.log('✔ TEST B passed cleanly: both paths attempted, rejected, full atomic rollback verified.');
  });

  await t.test('TEST C — POST-ROLLBACK RECOVERY (Restore schema, valid sale succeeds on same connection)', async () => {
    assert.ok(sharedDbB, 'sharedDbB from Test B must be present');
    setDb(sharedDbB);

    // Restore the stock_adjustments table schema
    await sharedDbB.exec(`
      CREATE TABLE IF NOT EXISTS stock_adjustments (
        id TEXT PRIMARY KEY,
        product_id TEXT,
        product_name TEXT,
        old_qty REAL DEFAULT 0,
        new_qty REAL DEFAULT 0,
        reason TEXT,
        type TEXT,
        user_email TEXT,
        branch_id TEXT,
        station_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const beforeC = await getDbSnapshot(sharedDbB);
    console.log('\n--- TEST C: BEFORE STATE ---');
    console.log(JSON.stringify(beforeC, null, 2));

    assert.equal(beforeC.stock, 10, 'Pre-sale stock in restored DB must still be 10');
    assert.equal(beforeC.salesCount, 0, 'Sales count in restored DB must be 0');

    const recoverySalePayload = {
      id: 'sale_b04_test_03',
      invoice_no: 'POS1-INV-10003',
      customer_id: 'cust_b04_01',
      customer_name: 'Test Customer',
      customer_phone: '0771234567',
      items: [{
        productId: 'prod_b04_01',
        name: 'Steel Hammer 16oz',
        qty: 4,
        unit_price: 1500,
        total: 6000,
        conversionRate: 1,
        unit: 'pcs'
      }],
      subtotal: 6000,
      total_amount: 6000,
      payment_method: 'Cash',
      status: 'Paid',
      user_email: 'cashier@hardware.erp',
      station_id: 'POS1',
      branch_id: 'MAIN'
    };

    const recoveryRes = await executeCreateSale(recoverySalePayload);
    assert.equal(recoveryRes.success, true, 'Subsequent sale POS1-INV-10003 must succeed on restored connection');

    const afterC = await getDbSnapshot(sharedDbB);
    console.log('\n--- TEST C: AFTER STATE ---');
    console.log(JSON.stringify(afterC, null, 2));

    // Verify stock decremented cleanly from 10 to 6
    assert.equal(afterC.stock, 6, 'Product stock must decrement to 6');
    assert.equal(afterC.salesCount, 1, 'Exactly 1 sale row must exist');
    assert.equal(afterC.ledgerCount, 1, 'Exactly 1 ledger transaction must exist');
    assert.equal(afterC.stockAdjustmentsCount, 1, 'Exactly 1 stock_adjustments row must exist');

    const adj = await sharedDbB.get('SELECT * FROM stock_adjustments WHERE product_id = ?', ['prod_b04_01']);
    assert.ok(adj, 'Adjustment record must exist');
    assert.equal(Number(adj.old_qty), 10, 'old_qty must be 10');
    assert.equal(Number(adj.new_qty), 6, 'new_qty must be 6');
    assert.equal(adj.type, 'Sale');

    await sharedDbB.close();
    console.log('✔ TEST C passed cleanly: database remains fully usable post-rollback.');
  });
});
