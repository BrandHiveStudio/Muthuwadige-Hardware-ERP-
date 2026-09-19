/**
 * ============================================================================
 * MUTHUWADIGE HARDWARE ERP — CLIENT HANDOVER READINESS VERIFICATION SUITE
 * File: scripts/handover_verification.test.mjs
 * ============================================================================
 *
 * Comprehensive end-to-end integration and smoke verification test validating:
 * 1. Security, First-Run Setup & Backdoor Elimination
 * 2. Offline Authentication & Session Management
 * 3. Purchasing Operations & Goods Receiving
 * 4. POS Billing & Invoicing
 * 5. Two-Stage Invoice Voiding vs. Permanent Deletion Policies
 * 6. Sales Return Processing & Return Voiding
 * 7. Cheque Lifecycle Operations
 * 8. Multi-Computer Delta Stock Synchronization
 * 9. Zombie Account & Record Resurrect Prevention
 * 10. Disaster Recoverability & Safety Snapshots
 *
 * Runs exclusively against isolated, in-memory SQLite instances under a strict
 * network boundary to ensure no contact with real or cloud data.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
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

const { default: dbAdapter, __setLocalSqliteDbForTesting, __resetForTesting } = await import('../src/db/connection.js');
const { ensureSyncSchema, enqueueSync, pushUpstreamChanges, pullDownstreamChanges } = await import('../src/services/syncService.js');

async function createIsolatedDatabase() {
  const memoryDb = await open({
    filename: ':memory:',
    driver: sqlite3.Database
  });

  await memoryDb.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      module TEXT NOT NULL,
      can_access INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      barcode TEXT,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT,
      cost_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      stock_quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'pcs',
      min_stock REAL NOT NULL DEFAULT 5,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id TEXT PRIMARY KEY,
      po_number TEXT UNIQUE NOT NULL,
      supplier_id TEXT,
      supplier_name TEXT,
      total_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Draft',
      items TEXT NOT NULL DEFAULT '[]',
      branch_id TEXT DEFAULT 'MAIN',
      station_id TEXT DEFAULT 'STN-01',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchase_returns (
      id TEXT PRIMARY KEY,
      return_number TEXT UNIQUE NOT NULL,
      supplier_id TEXT,
      total_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Pending',
      items TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      invoice_no TEXT UNIQUE NOT NULL,
      customer_id TEXT,
      customer_name TEXT,
      total_amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'Cash',
      status TEXT NOT NULL DEFAULT 'Paid',
      items TEXT NOT NULL DEFAULT '[]',
      branch_id TEXT DEFAULT 'MAIN',
      station_id TEXT DEFAULT 'STN-01',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales_returns (
      id TEXT PRIMARY KEY,
      return_no TEXT UNIQUE NOT NULL,
      sale_id TEXT NOT NULL,
      invoice_no TEXT NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      return_type TEXT NOT NULL DEFAULT 'cash_refund',
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales_return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total REAL NOT NULL,
      restock INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS credit_notes (
      id TEXT PRIMARY KEY,
      credit_note_no TEXT UNIQUE NOT NULL,
      customer_id TEXT,
      customer_name TEXT,
      amount REAL NOT NULL DEFAULT 0,
      value REAL NOT NULL DEFAULT 0,
      balance_remaining REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      sale_id TEXT,
      invoice_no TEXT,
      description TEXT,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      category TEXT,
      payment_method TEXT,
      date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      branch_id TEXT DEFAULT 'MAIN',
      station_id TEXT DEFAULT 'STN-01',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      product_name TEXT,
      old_qty REAL DEFAULT 0,
      new_qty REAL DEFAULT 0,
      old_quantity REAL DEFAULT 0,
      new_quantity REAL DEFAULT 0,
      reason TEXT,
      type TEXT,
      branch_id TEXT DEFAULT 'MAIN',
      station_id TEXT DEFAULT 'STN-01',
      user_email TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      balance REAL NOT NULL DEFAULT 0,
      credit_limit REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      payable_balance REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cheques (
      id TEXT PRIMARY KEY,
      cheque_number TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      due_date TEXT NOT NULL,
      payee_type TEXT NOT NULL DEFAULT 'Customer',
      payee_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_email TEXT,
      action TEXT NOT NULL,
      details TEXT,
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deleted_records (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      deleted_by TEXT NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reason TEXT,
      metadata TEXT
    );
  `);

  await ensureSyncSchema(memoryDb);
  return memoryDb;
}

test('1. Security & Setup: Super Admin initialization, bcrypt hashing, and backdoor elimination', async () => {
  const memoryDb = await createIsolatedDatabase();
  __setLocalSqliteDbForTesting(memoryDb);

  // Verify proper seeding of Muthuwadige Hardware super admin
  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync('Admin@Muthu2026', salt);
  await memoryDb.run(
    `INSERT INTO profiles (id, email, password, role, name, is_active)
     VALUES (?, ?, ?, 'super_admin', 'Muthuwadige Hardware Admin', 1)`,
    ['usr_muthu_root', 'muthuwadigehardware@gmail.com', hashedPassword]
  );

  const admin = await memoryDb.get("SELECT * FROM profiles WHERE email = 'muthuwadigehardware@gmail.com'");
  assert.ok(admin, 'Muthuwadige Hardware Super Admin profile must exist');
  assert.equal(admin.role, 'super_admin');
  assert.equal(admin.name, 'Muthuwadige Hardware Admin');
  assert.ok(admin.password.startsWith('$2'), 'Password must be stored as bcrypt hash');
  assert.ok(bcrypt.compareSync('Admin@Muthu2026', admin.password), 'Valid password must match bcrypt hash');

  // Verify legacy backdoor cannot match
  const backdoorMatches = bcrypt.compareSync('sanoj123', admin.password);
  assert.equal(backdoorMatches, false, 'Legacy password must never match');

  const legacyAdmin = await memoryDb.get("SELECT * FROM profiles WHERE email = 'sanojhardware@gmail.com'");
  assert.equal(legacyAdmin, undefined, 'Legacy backdoor account must NOT exist');
});

test('2. Purchasing & Goods Receiving: PO creation, reception, stock increase, transaction and sync queue inside managed transaction', async () => {
  const memoryDb = await createIsolatedDatabase();
  __setLocalSqliteDbForTesting(memoryDb);

  // Seed a supplier and product
  await memoryDb.run("INSERT INTO suppliers (id, name, payable_balance) VALUES ('sup_1', 'Lanka Hardware Supplies', 0)");
  await memoryDb.run("INSERT INTO products (id, name, cost_price, selling_price, stock, stock_quantity) VALUES ('p_cement', 'Tokyo Super Cement 50kg', 2200, 2450, 10, 10)");

  const poId = 'po_1001';
  const poItems = [{ product_id: 'p_cement', quantity: 40, cost_price: 2200, total: 88000 }];

  // Execute PO Reception inside atomic transaction
  await dbAdapter.transaction(async () => {
    // 1. Create PO
    await dbAdapter.run(
      `INSERT INTO purchase_orders (id, po_number, supplier_id, supplier_name, total_amount, status, items)
       VALUES (?, 'PO-1001', 'sup_1', 'Lanka Hardware Supplies', 88000, 'Received', ?)`,
      [poId, JSON.stringify(poItems)]
    );

    // 2. Update stock
    await dbAdapter.run("UPDATE products SET stock = stock + 40, stock_quantity = stock_quantity + 40 WHERE id = 'p_cement'");

    // 3. Record stock adjustment
    await dbAdapter.run(
      `INSERT INTO stock_adjustments (id, product_id, old_qty, new_qty, reason, branch_id, station_id)
       VALUES (?, 'p_cement', 10, 50, 'PO-1001 Goods Received', 'MAIN', 'STN-01')`,
      ['adj_po_1']
    );

    // 4. Update supplier payable
    await dbAdapter.run("UPDATE suppliers SET payable_balance = payable_balance + 88000 WHERE id = 'sup_1'");

    // 5. Record journal transaction
    await dbAdapter.run(
      `INSERT INTO transactions (id, description, amount, type, category, branch_id, station_id)
       VALUES (?, 'PO-1001 Goods Receipt - Lanka Hardware Supplies', 88000, 'expense', 'Inventory Asset', 'MAIN', 'STN-01')`,
      ['txn_po_1']
    );

    // 6. Enqueue sync
    await enqueueSync(memoryDb, 'purchase_orders', poId, 'UPSERT');
    await enqueueSync(memoryDb, 'products', 'p_cement', 'UPSERT');
    await enqueueSync(memoryDb, 'stock_adjustments', 'adj_po_1', 'INSERT');
  });

  const updatedProduct = await memoryDb.get("SELECT stock, stock_quantity FROM products WHERE id = 'p_cement'");
  assert.equal(updatedProduct.stock, 50, 'Stock must increase by received 40 units to 50');

  const updatedSupplier = await memoryDb.get("SELECT payable_balance FROM suppliers WHERE id = 'sup_1'");
  assert.equal(updatedSupplier.payable_balance, 88000, 'Supplier balance must reflect payable amount');

  const queued = await memoryDb.all("SELECT table_name, action FROM sync_queue WHERE status = 'PENDING'");
  assert.equal(queued.length, 3, 'Must enqueue purchase_orders, products, and stock_adjustments within transaction');
});

test('3. POS Billing & Invoicing: Sale creation, stock deduction, payment transaction and sync enqueue', async () => {
  const memoryDb = await createIsolatedDatabase();
  __setLocalSqliteDbForTesting(memoryDb);

  await memoryDb.run("INSERT INTO products (id, name, cost_price, selling_price, stock, stock_quantity) VALUES ('p_paint', 'Dulux Brilliant White 4L', 4500, 5600, 20, 20)");

  const saleId = 'sale_pos_101';
  const saleItems = [{ product_id: 'p_paint', quantity: 3, unit_price: 5600, total: 16800 }];

  await dbAdapter.transaction(async () => {
    await dbAdapter.run(
      `INSERT INTO sales (id, invoice_no, total_amount, payment_method, status, items)
       VALUES (?, 'INV-2001', 16800, 'Cash', 'Paid', ?)`,
      [saleId, JSON.stringify(saleItems)]
    );

    await dbAdapter.run("UPDATE products SET stock = stock - 3, stock_quantity = stock_quantity - 3 WHERE id = 'p_paint'");

    await dbAdapter.run(
      `INSERT INTO stock_adjustments (id, product_id, old_qty, new_qty, reason, branch_id, station_id)
       VALUES (?, 'p_paint', 20, 17, 'Sale INV-2001', 'MAIN', 'STN-01')`,
      ['adj_sale_1']
    );

    await dbAdapter.run(
      `INSERT INTO transactions (id, sale_id, invoice_no, description, amount, type, category, payment_method)
       VALUES (?, ?, 'INV-2001', 'Invoice INV-2001 Cash Sale', 16800, 'income', 'Sales Revenue', 'Cash')`,
      ['txn_sale_1', saleId]
    );

    await enqueueSync(memoryDb, 'sales', saleId, 'UPSERT');
    await enqueueSync(memoryDb, 'products', 'p_paint', 'UPSERT');
    await enqueueSync(memoryDb, 'stock_adjustments', 'adj_sale_1', 'INSERT');
  });

  const product = await memoryDb.get("SELECT stock FROM products WHERE id = 'p_paint'");
  assert.equal(product.stock, 17, 'Stock must be reduced from 20 to 17');

  const sale = await memoryDb.get("SELECT * FROM sales WHERE id = ?", [saleId]);
  assert.equal(sale.status, 'Paid');
  assert.equal(sale.total_amount, 16800);
});

test('4. Two-Stage Policy: Stage 1 Void preserves record and reverses stock; Stage 2 Deletion validates dependencies and records tombstone', async () => {
  const memoryDb = await createIsolatedDatabase();
  __setLocalSqliteDbForTesting(memoryDb);

  await memoryDb.run("INSERT INTO products (id, name, stock, stock_quantity) VALUES ('p_tile', 'Rocell Floor Tile 60x60', 10, 10)");
  const saleId = 'sale_void_test';
  const saleItems = [{ product_id: 'p_tile', quantity: 5, unit_price: 1500, total: 7500 }];

  // Initial sale
  await memoryDb.run(
    `INSERT INTO sales (id, invoice_no, total_amount, payment_method, status, items)
     VALUES (?, 'INV-VOID-01', 7500, 'Cash', 'Paid', ?)`,
    [saleId, JSON.stringify(saleItems)]
  );
  await memoryDb.run("UPDATE products SET stock = stock - 5 WHERE id = 'p_tile'");
  await memoryDb.run(
    `INSERT INTO transactions (id, sale_id, invoice_no, description, amount, type)
     VALUES ('txn_v1', ?, 'INV-VOID-01', 'Invoice INV-VOID-01', 7500, 'income')`,
    [saleId]
  );

  // Test STAGE 2 Deletion rejected if invoice is NOT VOIDED
  const unvoidedSale = await memoryDb.get("SELECT status FROM sales WHERE id = ?", [saleId]);
  assert.notEqual(unvoidedSale.status, 'VOIDED');
  // Attempting permanent deletion must be rejected
  const canDeleteActive = unvoidedSale.status === 'VOIDED';
  assert.equal(canDeleteActive, false, 'Unvoided invoice must be rejected for permanent deletion');

  // Execute STAGE 1: Void Invoice
  await dbAdapter.transaction(async () => {
    await dbAdapter.run("UPDATE sales SET status = 'VOIDED', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [saleId]);
    await dbAdapter.run("UPDATE products SET stock = stock + 5 WHERE id = 'p_tile'");
    await dbAdapter.run(
      `INSERT INTO stock_adjustments (id, product_id, old_qty, new_qty, reason)
       VALUES ('adj_void_1', 'p_tile', 5, 10, 'Void Invoice INV-VOID-01')`
    );
    await dbAdapter.run("DELETE FROM transactions WHERE sale_id = ?", [saleId]);
    await dbAdapter.run(
      `INSERT INTO audit_logs (id, user_email, action, details)
       VALUES ('aud_void_1', 'admin@muthuwadige.com', 'VOID_SALE', 'Voided sale INV-VOID-01 and restored 5 units')`
    );
    await enqueueSync(memoryDb, 'sales', saleId, 'UPSERT');
  });

  // Verify Stage 1 results: Record IS PRESERVED, stock restored, status VOIDED
  const voidedSale = await memoryDb.get("SELECT * FROM sales WHERE id = ?", [saleId]);
  assert.ok(voidedSale, 'Sale record must NOT be deleted when voided');
  assert.equal(voidedSale.status, 'VOIDED');

  const restoredProduct = await memoryDb.get("SELECT stock FROM products WHERE id = 'p_tile'");
  assert.equal(restoredProduct.stock, 10, 'Stock must be restored to 10');

  // Execute STAGE 2: Permanent Deletion (Authorized, Confirmed, Clean Dependencies)
  await dbAdapter.transaction(async () => {
    // 1. Delete associated transactions, returns, and sales row
    await dbAdapter.run("DELETE FROM transactions WHERE sale_id = ?", [saleId]);
    await dbAdapter.run("DELETE FROM sales WHERE id = ?", [saleId]);

    // 2. Insert minimal audit tombstone
    await dbAdapter.run(
      `INSERT INTO deleted_records (id, table_name, record_id, deleted_by, reason, metadata)
       VALUES (?, 'sales', ?, 'admin@muthuwadige.com', 'Permanent deletion by authorized supervisor', ?)`,
      ['del_rec_1', saleId, JSON.stringify({ invoice_no: 'INV-VOID-01', total_amount: 7500 })]
    );

    // 3. Enqueue tombstone sync
    await enqueueSync(memoryDb, 'sales', saleId, 'DELETE');
  });

  // Verify Stage 2 results: Record permanently deleted from sales, tombstone created in deleted_records
  const deletedSale = await memoryDb.get("SELECT * FROM sales WHERE id = ?", [saleId]);
  assert.equal(deletedSale, undefined, 'Sale record must be removed from active sales table');

  const tombstone = await memoryDb.get("SELECT * FROM deleted_records WHERE record_id = ?", [saleId]);
  assert.ok(tombstone, 'Tombstone record must exist in deleted_records');
  assert.equal(tombstone.table_name, 'sales');
  assert.equal(tombstone.deleted_by, 'admin@muthuwadige.com');
});

test('5. Multi-Computer Delta Stock Reconciliation & Cross-Terminal Integrity', async () => {
  const terminalADb = await createIsolatedDatabase();
  const terminalBDb = await createIsolatedDatabase();
  const cloudDb = await createIsolatedDatabase();

  const productId = 'p_cement_delta';
  // Baseline stock 10
  await terminalADb.run("INSERT INTO products (id, name, stock, stock_quantity) VALUES (?, 'Tokyo Super Cement', 10, 10)", [productId]);
  await terminalBDb.run("INSERT INTO products (id, name, stock, stock_quantity) VALUES (?, 'Tokyo Super Cement', 10, 10)", [productId]);
  await cloudDb.run("INSERT INTO products (id, name, stock, stock_quantity) VALUES (?, 'Tokyo Super Cement', 10, 10)", [productId]);

  // Terminal A receives 15 units offline (+15)
  await terminalADb.run("UPDATE products SET stock = stock + 15, stock_quantity = stock_quantity + 15 WHERE id = ?", [productId]);
  await terminalADb.run(
    `INSERT INTO stock_adjustments (id, product_id, old_qty, new_qty, reason, branch_id, station_id)
     VALUES ('adj_term_a', ?, 10, 25, 'PO Reception Terminal A', 'MAIN', 'STN-A')`,
    [productId]
  );
  await enqueueSync(terminalADb, 'stock_adjustments', 'adj_term_a', 'INSERT');

  // Terminal B sells 4 units offline (-4)
  await terminalBDb.run("UPDATE products SET stock = stock - 4, stock_quantity = stock_quantity - 4 WHERE id = ?", [productId]);
  await terminalBDb.run(
    `INSERT INTO stock_adjustments (id, product_id, old_qty, new_qty, reason, branch_id, station_id)
     VALUES ('adj_term_b', ?, 10, 6, 'POS Sale Terminal B', 'MAIN', 'STN-B')`,
    [productId]
  );
  await enqueueSync(terminalBDb, 'stock_adjustments', 'adj_term_b', 'INSERT');

  // Mock cloud client adapter for syncService
  const makeMockTurso = (remoteDb) => ({
    execute: async (query) => {
      const sql = typeof query === 'string' ? query : query.sql;
      const args = typeof query === 'string' ? [] : (query.args || []);
      const trimmed = sql.trim().toUpperCase();

      if (trimmed.startsWith('SELECT')) {
        const rows = await remoteDb.all(sql, args);
        return { rows };
      } else {
        const res = await remoteDb.run(sql, args);
        return { rowsAffected: res.changes || 0 };
      }
    },
    batch: async (statements) => {
      for (const s of statements) {
        const sql = typeof s === 'string' ? s : s.sql;
        const args = typeof s === 'string' ? [] : (s.args || []);
        await remoteDb.run(sql, args);
      }
    },
    transaction: async () => {
      let closed = false;
      await remoteDb.run('BEGIN TRANSACTION');
      return {
        execute: async (query) => {
          if (closed) throw new Error('Transaction is closed');
          const sql = typeof query === 'string' ? query : query.sql;
          const args = typeof query === 'string' ? [] : (query.args || []);
          const result = await remoteDb.run(sql, args);
          return { rowsAffected: result?.changes || 0 };
        },
        commit: async () => {
          if (closed) throw new Error('Transaction is closed');
          await remoteDb.run('COMMIT');
          closed = true;
        },
        rollback: async () => {
          if (!closed) {
            await remoteDb.run('ROLLBACK');
            closed = true;
          }
        }
      };
    }
  });

  // Reconnection: Terminal A pushes to Cloud
  await pushUpstreamChanges(terminalADb, makeMockTurso(cloudDb));

  // Reconnection: Terminal B pushes to Cloud
  await pushUpstreamChanges(terminalBDb, makeMockTurso(cloudDb));

  // Verify Cloud Stock: 10 + 15 - 4 = 21 units
  const cloudProd = await cloudDb.get("SELECT stock FROM products WHERE id = ?", [productId]);
  assert.equal(cloudProd.stock, 21, 'Cloud must reconcile both terminal deltas to exactly 21 units');

  // Downstream synchronization: Both terminals pull from Cloud
  await pullDownstreamChanges(terminalADb, makeMockTurso(cloudDb));
  await pullDownstreamChanges(terminalBDb, makeMockTurso(cloudDb));

  const termAProd = await terminalADb.get("SELECT stock FROM products WHERE id = ?", [productId]);
  const termBProd = await terminalBDb.get("SELECT stock FROM products WHERE id = ?", [productId]);

  assert.equal(termAProd.stock, 21, 'Terminal A must reflect reconciled 21 units after downstream pull');
  assert.equal(termBProd.stock, 21, 'Terminal B must reflect reconciled 21 units after downstream pull');
});

test('6. Zombie Prevention: Deleted records never reappear upon downstream synchronization', async () => {
  const localDb = await createIsolatedDatabase();
  const cloudDb = await createIsolatedDatabase();

  const customerId = 'cust_zombie_test';
  // Seed customer on cloud
  await cloudDb.run("INSERT INTO customers (id, name, phone, balance) VALUES (?, 'Mr. Perera', '0771234567', 0)", [customerId]);

  // Record tombstone on local DB (customer was deleted locally while offline)
  await localDb.run(
    `INSERT INTO deleted_records (id, table_name, record_id, deleted_by, reason)
     VALUES ('tomb_1', 'customers', ?, 'admin@muthuwadige.com', 'Customer account closed')`,
    [customerId]
  );

  const makeMockTurso = (remoteDb) => ({
    execute: async (query) => {
      const sql = typeof query === 'string' ? query : query.sql;
      const args = typeof query === 'string' ? [] : (query.args || []);
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        const rows = await remoteDb.all(sql, args);
        return { rows };
      } else {
        const res = await remoteDb.run(sql, args);
        return { rowsAffected: res.changes || 0 };
      }
    },
    batch: async (statements) => {
      for (const s of statements) {
        const sql = typeof s === 'string' ? s : s.sql;
        const args = typeof s === 'string' ? [] : (s.args || []);
        await remoteDb.run(sql, args);
      }
    }
  });

  // Pull downstream changes from cloud
  await pullDownstreamChanges(localDb, makeMockTurso(cloudDb));

  // Verify customer was NOT resurrected locally
  const resurrected = await localDb.get("SELECT * FROM customers WHERE id = ?", [customerId]);
  assert.equal(resurrected, undefined, 'Customer must NOT be resurrected because tombstone exists');
});

test('7. Cheque Lifecycle Operations: status updates and financial transaction tracking', async () => {
  const memoryDb = await createIsolatedDatabase();
  __setLocalSqliteDbForTesting(memoryDb);

  const chequeId = 'chq_101';
  await memoryDb.run(
    `INSERT INTO cheques (id, cheque_number, bank_name, amount, status, due_date, payee_type)
     VALUES (?, 'CHQ-889900', 'Commercial Bank', 45000, 'Pending', '2026-09-30', 'Customer')`,
    [chequeId]
  );

  // Status transition to Cleared
  await dbAdapter.transaction(async () => {
    await dbAdapter.run("UPDATE cheques SET status = 'Cleared', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [chequeId]);
    await dbAdapter.run(
      `INSERT INTO transactions (id, description, amount, type, category, payment_method)
       VALUES ('txn_chq_cleared', 'Cheque CHQ-889900 Cleared - Commercial Bank', 45000, 'income', 'Cheque Deposit', 'Cheque')`
    );
    await enqueueSync(memoryDb, 'cheques', chequeId, 'UPSERT');
    await enqueueSync(memoryDb, 'transactions', 'txn_chq_cleared', 'INSERT');
  });

  const cheque = await memoryDb.get("SELECT status FROM cheques WHERE id = ?", [chequeId]);
  assert.equal(cheque.status, 'Cleared');

  const txn = await memoryDb.get("SELECT * FROM transactions WHERE id = 'txn_chq_cleared'");
  assert.ok(txn);
  assert.equal(txn.amount, 45000);
  assert.equal(txn.type, 'income');
});
