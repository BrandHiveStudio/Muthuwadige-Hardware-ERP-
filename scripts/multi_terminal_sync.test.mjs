// Multi-Computer and Multi-Branch Synchronization Integration Test Suite
// Verifies offline operation, delta stock preservation (10 + 15 - 4 = 21),
// real POS checkout delta, PO receipt delta, lost ACK idempotency,
// outbox protection, no query-absent pruning, zombie protection, and soft-wipe immunity.

process.env.NODE_ENV = 'test';
process.env.APP_ROLE = 'test';
process.env.DATABASE_ENGINE = 'sqlite';
for (const key of ['VERCEL', 'IS_WEB_CLIENT', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'APPDATA', 'USER_DATA_PATH', 'ELECTRON_RUN_AS_NODE']) {
  delete process.env[key];
}

import test from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
const {
  ensureSyncSchema,
  enqueueSync,
  pushUpstreamChanges,
  pullDownstreamChanges
} = await import('../src/services/syncService.js');

const {
  executeCreateSale,
  setDb,
  app
} = await import('../server.js');

// Strictly wipe any Turso cloud env vars or singletons injected by server imports
for (const key of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'DEFAULT_TURSO_DATABASE_URL', 'DEFAULT_TURSO_AUTH_TOKEN']) {
  delete process.env[key];
}
if (typeof global !== 'undefined') {
  global.__tursoClient = null;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__tursoClient = null;
  globalThis.__tursoClientSingleton = null;
}

/**
 * Creates an in-memory SQLite database representing a local POS terminal
 */
async function createTerminalDb(stationId = 'POS1', branchId = 'MAIN') {
  const mem = await open({
    filename: ':memory:',
    driver: sqlite3.Database
  });

  // Attach transaction helper to emulate ERP dbAdapter
  mem.transaction = async function(fn) {
    await mem.run('BEGIN TRANSACTION');
    try {
      const res = await fn();
      await mem.run('COMMIT');
      return res;
    } catch (err) {
      await mem.run('ROLLBACK');
      throw err;
    }
  };

  // Base ERP schema
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
      net_total REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT,
      product_id TEXT,
      quantity REAL DEFAULT 0,
      cost_price REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS supplier_transactions (
      id TEXT PRIMARY KEY,
      supplier_id TEXT,
      amount REAL DEFAULT 0,
      type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quotations (
      id TEXT PRIMARY KEY,
      quotation_no TEXT,
      customer_id TEXT,
      total_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quotation_items (
      id TEXT PRIMARY KEY,
      quotation_id TEXT,
      product_id TEXT,
      quantity REAL DEFAULT 0,
      price REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sales_returns (
      id TEXT PRIMARY KEY,
      return_no TEXT,
      sale_id TEXT,
      total_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales_return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT,
      product_id TEXT,
      quantity REAL DEFAULT 0
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
      status TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE IF NOT EXISTS deleted_records (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (table_name, record_id)
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      role TEXT,
      avatar TEXT,
      password TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      payable_balance REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      email TEXT,
      role TEXT,
      token TEXT UNIQUE,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT,
      name TEXT,
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
      system_wipe_timestamp TEXT,
      last_counter_sync_timestamp TEXT,
      last_sync_timestamp TEXT,
      counter_sync_status TEXT DEFAULT 'IDLE',
      counter_pending_count INTEGER DEFAULT 0,
      next_invoice_number TEXT
    );

    INSERT INTO system_settings (id, key, value, next_invoice_number)
    VALUES ('global', 'STATION_ID', '${stationId}', '${stationId}-INV-00001');
    INSERT INTO system_settings (id, key, value) VALUES ('branch', 'BRANCH_ID', '${branchId}');

    CREATE TRIGGER IF NOT EXISTS trg_sync_stock_adj_insert AFTER INSERT ON stock_adjustments
    WHEN NOT EXISTS (SELECT 1 FROM sync_pull_marker)
    BEGIN
      INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, action, payload, status, created_at)
      VALUES (
        'sq_stock_adj_' || NEW.id,
        'stock_adjustments',
        NEW.id,
        'INSERT',
        json_object(
          'id', NEW.id,
          'product_id', NEW.product_id,
          'product_name', NEW.product_name,
          'old_qty', NEW.old_qty,
          'new_qty', NEW.new_qty,
          'reason', NEW.reason,
          'type', NEW.type,
          'user_email', NEW.user_email,
          'branch_id', NEW.branch_id,
          'station_id', NEW.station_id,
          'created_at', NEW.created_at
        ),
        'PENDING',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_sync_sales_insert AFTER INSERT ON sales
    WHEN NOT EXISTS (SELECT 1 FROM sync_pull_marker)
    BEGIN
      INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, action, payload, status, created_at)
      VALUES (
        'sq_sales_' || NEW.id,
        'sales',
        NEW.id,
        'INSERT',
        json_object(
          'id', NEW.id,
          'invoice_no', NEW.invoice_no,
          'customer_id', NEW.customer_id,
          'customer_name', NEW.customer_name,
          'total_amount', NEW.total_amount,
          'paid_amount', NEW.paid_amount,
          'status', NEW.status,
          'branch_id', NEW.branch_id,
          'station_id', NEW.station_id,
          'created_at', NEW.created_at
        ),
        'PENDING',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;
  `);

  await ensureSyncSchema(mem);
  return mem;
}

/**
 * Creates a simulated Turso libSQL Cloud database and client
 */
async function createSimulatedCloud(options = {}) {
  const cloudDb = await open({
    filename: ':memory:',
    driver: sqlite3.Database
  });

  await cloudDb.exec(`
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
      net_total REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT,
      product_id TEXT,
      quantity REAL DEFAULT 0,
      cost_price REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS supplier_transactions (
      id TEXT PRIMARY KEY,
      supplier_id TEXT,
      amount REAL DEFAULT 0,
      type TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quotations (
      id TEXT PRIMARY KEY,
      quotation_no TEXT,
      customer_id TEXT,
      total_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quotation_items (
      id TEXT PRIMARY KEY,
      quotation_id TEXT,
      product_id TEXT,
      quantity REAL DEFAULT 0,
      price REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sales_returns (
      id TEXT PRIMARY KEY,
      return_no TEXT,
      sale_id TEXT,
      total_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales_return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT,
      product_id TEXT,
      quantity REAL DEFAULT 0
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
      status TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE IF NOT EXISTS deleted_records (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (table_name, record_id)
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      role TEXT,
      avatar TEXT,
      password TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      payable_balance REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      email TEXT,
      role TEXT,
      token TEXT UNIQUE,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password TEXT,
      role TEXT,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY,
      key TEXT,
      value TEXT,
      system_wipe_timestamp TEXT,
      last_counter_sync_timestamp TEXT,
      last_sync_timestamp TEXT,
      counter_sync_status TEXT DEFAULT 'IDLE',
      counter_pending_count INTEGER DEFAULT 0
    );

    INSERT OR IGNORE INTO system_settings (id, key, value, system_wipe_timestamp) VALUES ('global', 'system', 'turso_cloud', '0');
  `);

  // Turso client mock adapter conforming to libSQL client interface
  const tursoClient = {
    async execute(queryOrObj) {
      const sql = typeof queryOrObj === 'string' ? queryOrObj : queryOrObj.sql;
      const args = typeof queryOrObj === 'string' ? [] : (queryOrObj.args || []);
      const trimmed = sql.trim().toUpperCase();

      if (trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA')) {
        const rows = await cloudDb.all(sql, args);
        return { rows };
      } else {
        if (args && args.length > 0) {
          const result = await cloudDb.run(sql, args);
          return { rowsAffected: result?.changes || 0 };
        } else {
          await cloudDb.exec(sql);
          return { rowsAffected: 1 };
        }
      }
    },

    async batch(statements, mode = 'write') {
      const results = [];
      await cloudDb.run('BEGIN TRANSACTION');
      try {
        for (const stmt of statements) {
          const sql = typeof stmt === 'string' ? stmt : stmt.sql;
          const args = typeof stmt === 'string' ? [] : (stmt.args || []);
          if (args && args.length > 0) {
            const res = await cloudDb.run(sql, args);
            results.push(res);
          } else {
            await cloudDb.exec(sql);
            results.push({ changes: 1 });
          }
        }
        await cloudDb.run('COMMIT');
        return results;
      } catch (err) {
        await cloudDb.run('ROLLBACK');
        throw err;
      }
    },

    async transaction(mode = 'write') {
      let closed = false;
      await cloudDb.run('BEGIN TRANSACTION');
      return {
        async execute(queryOrObj) {
          if (closed) throw new Error('Transaction is closed');
          const sql = typeof queryOrObj === 'string' ? queryOrObj : queryOrObj.sql;
          const args = typeof queryOrObj === 'string' ? [] : (queryOrObj.args || []);
          if (options.failStockAdjustmentInsert && /INSERT OR IGNORE INTO\s+"stock_adjustments"/i.test(sql)) {
            throw new Error('Simulated stock-adjustment insert failure');
          }
          const result = args.length > 0 ? await cloudDb.run(sql, args) : await cloudDb.exec(sql);
          return { rowsAffected: result?.changes || 0 };
        },
        async commit() {
          if (closed) throw new Error('Transaction is closed');
          await cloudDb.run('COMMIT');
          closed = true;
          if (options.loseAckAfterCommit) {
            options.loseAckAfterCommit = false;
            throw new Error('Simulated lost acknowledgement after commit');
          }
        },
        async rollback() {
          if (!closed) {
            await cloudDb.run('ROLLBACK');
            closed = true;
          }
        }
      };
    }
  };

  return { cloudDb, tursoClient };
}

test('MULTI-COMPUTER & DELTA STOCK SYNCHRONIZATION SUITE (B04)', async (t) => {

  await t.test('TEST 1 — Real POS Checkout Delta', async () => {
    const termDb = await createTerminalDb('POS1', 'BRANCH_COLOMBO');
    setDb(termDb);

    await termDb.run(
      `INSERT INTO products (id, sku, name, category, price, selling_price, cost_price, stock, stock_quantity, min_stock, supplier, unit)
       VALUES ('prod_checkout_1', 'SKU-CHK-1', 'Screws Pack', 'Fasteners', 150, 150, 100, 10, 10, 5, 'SupplierA', 'pack')`
    );

    // Perform the REAL sale execution path
    const saleResult = await executeCreateSale({
      invoice_no: 'POS1-INV-10001',
      customer_id: null,
      items: [
        {
          productId: 'prod_checkout_1',
          name: 'Screws Pack',
          qty: 4,
          price: 150,
          unit_price: 150,
          unit: 'pack'
        }
      ],
      payment_method: 'Cash',
      total_amount: 600
    });

    assert.ok(saleResult.success, 'Real sale execution succeeded');

    const updatedProd = await termDb.get('SELECT stock, stock_quantity FROM products WHERE id = ?', ['prod_checkout_1']);
    assert.equal(Number(updatedProd.stock), 6, 'Product stock is 6 after selling 4 from 10');

    const adjustments = await termDb.all('SELECT * FROM stock_adjustments WHERE product_id = ?', ['prod_checkout_1']);
    assert.equal(adjustments.length, 1, 'Exactly one stock_adjustment recorded by executeCreateSale');

    const adj = adjustments[0];
    assert.equal(Number(adj.old_qty), 10, 'Adjustment old_qty is 10');
    assert.equal(Number(adj.new_qty), 6, 'Adjustment new_qty is 6');
    const delta = Number(adj.new_qty) - Number(adj.old_qty);
    assert.equal(delta, -4, 'Adjustment delta is -4');
    assert.equal(adj.type, 'Sale', 'Adjustment type is Sale');
    assert.ok(adj.reason.includes('POS1-INV-10001'), 'Adjustment references invoice number');

    // Verify automatic sync_queue enqueue
    const queueItem = await termDb.get("SELECT * FROM sync_queue WHERE table_name = 'stock_adjustments' AND record_id = ?", [adj.id]);
    assert.ok(queueItem, 'Adjustment was automatically enqueued to sync_queue via trigger');
  });

  await t.test('TEST 2 — PO Receipt Delta', async () => {
    const termDb = await createTerminalDb('POS1', 'BRANCH_COLOMBO');
    setDb(termDb);

    await termDb.run(
      `INSERT INTO products (id, sku, name, category, price, selling_price, cost_price, stock, stock_quantity, min_stock, supplier, unit)
       VALUES ('prod_po_2', 'SKU-PO-2', 'Copper Wire 10m', 'Electrical', 800, 800, 600, 10, 10, 5, 'WireCo', 'coil')`
    );

    await termDb.run(
      `INSERT INTO suppliers (id, name, payable_balance) VALUES ('sup_wire', 'WireCo', 0)`
    );

    await termDb.run(
      `INSERT INTO purchase_orders (id, po_number, po_no, supplier_id, supplier_name, items, status, subtotal, net_total, total_amount)
       VALUES ('po_test_2', 'PO-90002', 'PO-90002', 'sup_wire', 'WireCo', ?, 'Ordered', 9000, 9000, 9000)`,
      [JSON.stringify([{ productId: 'prod_po_2', productName: 'Copper Wire 10m', qty: 15, costPrice: 600 }])]
    );

    // Perform the REAL PO receive path via HTTP endpoint
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/purchasing/receive-po`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin_token_test'
        },
        body: JSON.stringify({ po_id: 'po_test_2', received_by: 'TestStorekeeper' })
      });
      if (res.status !== 200) {
        console.error('PO receive error in TEST 2:', await res.text());
      }
      assert.equal(res.status, 200, 'PO receive endpoint responded 200 OK');
    } finally {
      server.close();
    }

    const updatedProd = await termDb.get('SELECT stock FROM products WHERE id = ?', ['prod_po_2']);
    assert.equal(Number(updatedProd.stock), 25, 'Stock becomes 25 locally after receiving 15 into initial 10');

    const adjustments = await termDb.all("SELECT * FROM stock_adjustments WHERE product_id = ? AND type = 'PO_RECEIPT'", ['prod_po_2']);
    assert.equal(adjustments.length, 1, 'PO Receipt stock_adjustments record exists');
    assert.equal(Number(adjustments[0].old_qty), 10, 'old_qty is 10');
    assert.equal(Number(adjustments[0].new_qty), 25, 'new_qty is 25');
  });

  await t.test('TEST 3 — Multi-Terminal Reconciliation (10 + 15 - 4 = 21)', async () => {
    const { cloudDb, tursoClient } = await createSimulatedCloud();
    const terminalA = await createTerminalDb('POS1', 'BRANCH_COLOMBO');
    const terminalB = await createTerminalDb('POS2', 'BRANCH_KANDY');

    const cementProd = {
      id: 'prod_cement_21',
      sku: 'SKU-CEM-21',
      name: 'Portland Cement 50kg',
      category: 'Cement',
      price: 2400,
      selling_price: 2400,
      cost_price: 2000,
      stock: 10,
      stock_quantity: 10,
      min_stock: 5,
      supplier: 'Tokyo Super',
      unit: 'bag'
    };

    // Seed on cloud
    await cloudDb.run(
      `INSERT INTO products (id, sku, name, category, price, selling_price, cost_price, stock, stock_quantity, min_stock, supplier, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [cementProd.id, cementProd.sku, cementProd.name, cementProd.category, cementProd.price, cementProd.selling_price, cementProd.cost_price, cementProd.stock, cementProd.stock_quantity, cementProd.min_stock, cementProd.supplier, cementProd.unit]
    );

    // Seed initial baseline to Terminal A and Terminal B
    await pullDownstreamChanges(terminalA, tursoClient);
    await pullDownstreamChanges(terminalB, tursoClient);

    // Terminal A: Sale of 4 -> 6
    setDb(terminalA);
    await executeCreateSale({
      invoice_no: 'POS1-INV-20001',
      items: [{ productId: cementProd.id, name: cementProd.name, qty: 4, unit_price: 2400 }],
      payment_method: 'Cash',
      total_amount: 9600
    });

    const stockAOffline = (await terminalA.get('SELECT stock FROM products WHERE id = ?', [cementProd.id])).stock;
    assert.equal(Number(stockAOffline), 6, 'Terminal A offline stock is 6');

    // Terminal B: PO Receive of 15 -> 25
    setDb(terminalB);
    await terminalB.run(
      `INSERT INTO suppliers (id, name, payable_balance) VALUES ('sup_tokyo', 'Tokyo Super', 0)`
    );
    await terminalB.run(
      `INSERT INTO purchase_orders (id, po_number, po_no, supplier_id, supplier_name, items, status, subtotal, net_total, total_amount)
       VALUES ('po_b_cement', 'PO-B-20001', 'PO-B-20001', 'sup_tokyo', 'Tokyo Super', ?, 'Ordered', 30000, 30000, 30000)`,
      [JSON.stringify([{ productId: cementProd.id, productName: cementProd.name, qty: 15, costPrice: 2000 }])]
    );

    const srvB = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => srvB.once('listening', resolve));
    const portB = srvB.address().port;
    try {
      const resB = await fetch(`http://127.0.0.1:${portB}/api/purchasing/receive-po`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin_token_test'
        },
        body: JSON.stringify({ po_id: 'po_b_cement', received_by: 'BAdmin' })
      });
      if (resB.status !== 200) {
        console.error('PO receive error in TEST 3:', await resB.text());
      }
      assert.equal(resB.status, 200, 'Terminal B PO receive responded 200 OK');
    } finally {
      srvB.close();
    }

    const stockBOffline = (await terminalB.get('SELECT stock FROM products WHERE id = ?', [cementProd.id])).stock;
    assert.equal(Number(stockBOffline), 25, 'Terminal B offline stock is 25');

    // Synchronize both terminals to Cloud
    await pushUpstreamChanges(terminalA, tursoClient);
    await pushUpstreamChanges(terminalB, tursoClient);

    // Final Cloud stock MUST be: 10 + 15 - 4 = 21
    const cloudFinal = (await cloudDb.get('SELECT stock FROM products WHERE id = ?', [cementProd.id])).stock;
    assert.equal(Number(cloudFinal), 21, 'Cloud stock reconciled to 10 + 15 - 4 = 21');

    // Downstream synchronization to both terminals
    await pullDownstreamChanges(terminalA, tursoClient);
    await pullDownstreamChanges(terminalB, tursoClient);

    const stockAFinal = (await terminalA.get('SELECT stock FROM products WHERE id = ?', [cementProd.id])).stock;
    const stockBFinal = (await terminalB.get('SELECT stock FROM products WHERE id = ?', [cementProd.id])).stock;

    assert.equal(Number(stockAFinal), 21, 'Terminal A synchronized stock is exactly 21');
    assert.equal(Number(stockBFinal), 21, 'Terminal B synchronized stock is exactly 21');
  });

  await t.test('TEST 4 — Lost ACK Retry (+15 adjustment)', async () => {
    const { cloudDb, tursoClient } = await createSimulatedCloud({ loseAckAfterCommit: true });
    const term = await createTerminalDb('POS1', 'BRANCH_COLOMBO');

    await cloudDb.run("INSERT INTO products (id, sku, name, stock) VALUES ('prod_ack_p', 'SKU-ACK-P', 'ACK Test Item', 10)");
    await term.run("INSERT INTO products (id, sku, name, stock) VALUES ('prod_ack_p', 'SKU-ACK-P', 'ACK Test Item', 25)");

    await term.run(
      `INSERT INTO stock_adjustments (id, product_id, old_qty, new_qty, reason, type)
       VALUES ('sa_ack_retry_p', 'prod_ack_p', 10, 25, 'PO Receipt +15', 'PO_RECEIPT')`
    );

    // The cloud commit succeeds, but the caller receives no acknowledgement.
    await pushUpstreamChanges(term, tursoClient);
    let cloudStock = (await cloudDb.get('SELECT stock FROM products WHERE id = ?', ['prod_ack_p'])).stock;
    assert.equal(Number(cloudStock), 25, 'Cloud stock is committed despite the lost acknowledgement');
    assert.equal((await cloudDb.all("SELECT id FROM stock_adjustments WHERE id = 'sa_ack_retry_p'")).length, 1, 'Commit includes exactly one adjustment marker');

    for (let retry = 1; retry <= 3; retry++) {
      if (retry > 1) await enqueueSync(term, 'stock_adjustments', 'sa_ack_retry_p', 'INSERT');
      await pushUpstreamChanges(term, tursoClient);
      cloudStock = (await cloudDb.get('SELECT stock FROM products WHERE id = ?', ['prod_ack_p'])).stock;
      assert.equal(Number(cloudStock), 25, `Cloud stock after retry #${retry} remains 25`);
      assert.equal((await cloudDb.all("SELECT id FROM stock_adjustments WHERE id = 'sa_ack_retry_p'")).length, 1, `Retry #${retry} creates no duplicate marker`);
    }
  });

  await t.test('TEST 5 — Negative Delta Retry (-4 adjustment)', async () => {
    const { cloudDb, tursoClient } = await createSimulatedCloud();
    const term = await createTerminalDb('POS1', 'BRANCH_COLOMBO');

    await cloudDb.run("INSERT INTO products (id, sku, name, stock) VALUES ('prod_neg_p', 'SKU-NEG-P', 'Neg Test Item', 25)");
    await term.run("INSERT INTO products (id, sku, name, stock) VALUES ('prod_neg_p', 'SKU-NEG-P', 'Neg Test Item', 21)");

    await term.run(
      `INSERT INTO stock_adjustments (id, product_id, old_qty, new_qty, reason, type)
       VALUES ('sa_neg_retry_p', 'prod_neg_p', 25, 21, 'Sale -4', 'Sale')`
    );

    // Push #1
    await pushUpstreamChanges(term, tursoClient);
    let cloudStock = (await cloudDb.get('SELECT stock FROM products WHERE id = ?', ['prod_neg_p'])).stock;
    assert.equal(Number(cloudStock), 21, 'Cloud stock after first push is 21');

    for (let retry = 1; retry <= 3; retry++) {
      await enqueueSync(term, 'stock_adjustments', 'sa_neg_retry_p', 'INSERT');
      await pushUpstreamChanges(term, tursoClient);
      cloudStock = (await cloudDb.get('SELECT stock FROM products WHERE id = ?', ['prod_neg_p'])).stock;
      assert.equal(Number(cloudStock), 21, `Cloud stock after negative retry #${retry} remains 21`);
      assert.equal((await cloudDb.all("SELECT id FROM stock_adjustments WHERE id = 'sa_neg_retry_p'")).length, 1, `Negative retry #${retry} creates no duplicate marker`);
    }
  });

  await t.test('TEST 6 — Atomic Failure Leaves Neither Delta Nor Marker', async () => {
    const { cloudDb, tursoClient } = await createSimulatedCloud({ failStockAdjustmentInsert: true });
    const term = await createTerminalDb('POS1', 'BRANCH_COLOMBO');

    await cloudDb.run("INSERT INTO products (id, sku, name, stock) VALUES ('prod_atomic_fail', 'SKU-ATOMIC-FAIL', 'Atomic Failure Item', 10)");
    await term.run("INSERT INTO products (id, sku, name, stock) VALUES ('prod_atomic_fail', 'SKU-ATOMIC-FAIL', 'Atomic Failure Item', 25)");
    await term.run(
      `INSERT INTO stock_adjustments (id, product_id, old_qty, new_qty, reason, type)
       VALUES ('sa_atomic_fail', 'prod_atomic_fail', 10, 25, 'Simulated +15', 'PO_RECEIPT')`
    );

    await pushUpstreamChanges(term, tursoClient);
    assert.equal(Number((await cloudDb.get("SELECT stock FROM products WHERE id = 'prod_atomic_fail'")).stock), 10, 'Failed transaction rolls back the delta');
    assert.equal((await cloudDb.all("SELECT id FROM stock_adjustments WHERE id = 'sa_atomic_fail'")).length, 0, 'Failed transaction does not leave an adjustment marker');
  });

  await t.test('TEST 7 — Outbox Protection', async () => {
    for (const st of ['PENDING', 'FAILED', 'ERROR']) {
      const { cloudDb, tursoClient } = await createSimulatedCloud();
      const term = await createTerminalDb('POS1', 'BRANCH_COLOMBO');

      // Cloud snapshot with future timestamp
      await cloudDb.run(
        "INSERT INTO products (id, sku, name, price, stock, updated_at) VALUES ('p_outbox', 'SKU-OUT', 'Cloud Product', 100, 10, '2099-01-01T00:00:00.000Z')"
      );

      // Local terminal with unacknowledged mutation
      await term.run(
        "INSERT INTO products (id, sku, name, price, stock, updated_at) VALUES ('p_outbox', 'SKU-OUT', 'Local Unacknowledged', 999, 50, '2025-01-01T00:00:00.000Z')"
      );
      await term.run(
        "INSERT INTO sync_queue (id, table_name, record_id, action, payload, status) VALUES (?, 'products', 'p_outbox', 'UPDATE', '{}', ?)",
        ['sq_test_' + st, st]
      );

      await pullDownstreamChanges(term, tursoClient);

      const localProd = await term.get('SELECT name, price, stock FROM products WHERE id = ?', ['p_outbox']);
      assert.equal(localProd.name, 'Local Unacknowledged', `Local name protected when outbox is ${st}`);
      assert.equal(Number(localProd.price), 999, `Local price protected when outbox is ${st}`);
      assert.equal(Number(localProd.stock), 50, `Local stock protected when outbox is ${st}`);
    }
  });

  await t.test('TEST 8 — No Query-Absent Deletion', async () => {
    const { cloudDb, tursoClient } = await createSimulatedCloud();
    const term = await createTerminalDb('POS1', 'BRANCH_COLOMBO');

    // Local items absent from cloud
    await term.run("INSERT INTO customers (id, name, phone) VALUES ('cust_local_prune', 'Local Customer', '0770000000')");
    await term.run("INSERT INTO products (id, sku, name) VALUES ('prod_local_prune', 'LOCAL-SKU', 'Local Product')");

    // Downstream pull with empty/partial cloud
    await pullDownstreamChanges(term, tursoClient);

    const c = await term.get('SELECT id FROM customers WHERE id = ?', ['cust_local_prune']);
    const p = await term.get('SELECT id FROM products WHERE id = ?', ['prod_local_prune']);
    assert.ok(c, 'Local customer record must NOT be deleted due to cloud query absence');
    assert.ok(p, 'Local product record must NOT be deleted due to cloud query absence');
  });

  await t.test('TEST 9 — Zombie Protection', async () => {
    const { cloudDb, tursoClient } = await createSimulatedCloud();
    const term = await createTerminalDb('POS1', 'BRANCH_COLOMBO');

    // Cloud has the record
    await cloudDb.run("INSERT INTO customers (id, name) VALUES ('cust_zombie_target', 'Zombie Customer')");

    // Local has tombstone in deleted_records
    await term.run("INSERT INTO deleted_records (table_name, record_id) VALUES ('customers', 'cust_zombie_target')");

    await pullDownstreamChanges(term, tursoClient);

    const resurrected = await term.get('SELECT id FROM customers WHERE id = ?', ['cust_zombie_target']);
    assert.equal(resurrected, undefined, 'Locally tombstoned record must NOT be resurrected by downstream pull');
  });

  await t.test('TEST 10 — Soft-Wipe Immunity', async () => {
    const { cloudDb, tursoClient } = await createSimulatedCloud();
    const term = await createTerminalDb('POS1', 'BRANCH_COLOMBO');

    // Newer cloud wipe timestamp
    await cloudDb.run("UPDATE system_settings SET value = '9999999999999', system_wipe_timestamp = '9999999999999' WHERE id = 'global'");

    // Local operational records
    await term.run("INSERT INTO sales (id, invoice_no, total_amount) VALUES ('sale_wipe_1', 'INV-WIPE-01', 5000)");
    await term.run("INSERT INTO products (id, sku, name) VALUES ('prod_wipe_1', 'SKU-WIPE', 'Wipe Protected')");
    await term.run("INSERT INTO customers (id, name) VALUES ('cust_wipe_1', 'Wipe Customer')");
    await term.run("INSERT INTO users (id, email, name) VALUES ('user_wipe_1', 'wipe@muthu.lk', 'Wipe User')");

    await pullDownstreamChanges(term, tursoClient);

    const s = await term.get('SELECT COUNT(*) as cnt FROM sales');
    const p = await term.get('SELECT COUNT(*) as cnt FROM products');
    const c = await term.get('SELECT COUNT(*) as cnt FROM customers');
    const u = await term.get('SELECT COUNT(*) as cnt FROM users');
    const q = await term.get('SELECT COUNT(*) as cnt FROM sync_queue');

    assert.equal(s.cnt, 1, 'Local sales must NOT be erased by cloud wipe timestamp');
    assert.equal(p.cnt, 1, 'Local products must NOT be erased by cloud wipe timestamp');
    assert.equal(c.cnt, 1, 'Local customers must NOT be erased by cloud wipe timestamp');
    assert.equal(u.cnt, 1, 'Local users must NOT be erased by cloud wipe timestamp');
    assert.equal(q.cnt, 1, 'Local sync_queue must NOT be erased by cloud wipe timestamp');
  });

});
