import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import {
  ensureSyncSchema,
  enqueueSync,
  pushUpstreamChanges,
  pullDownstreamChanges,
  __resetSyncSchemaForTesting
} from '../syncService.js';

async function createInMemoryDb(withTriggers = false) {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
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
      serial_no TEXT DEFAULT '',
      batch_code TEXT DEFAULT '',
      expiry_date TEXT,
      supplier_phone TEXT DEFAULT '',
      measure_details TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      invoice_no TEXT UNIQUE,
      customer_id TEXT,
      customer_name TEXT,
      items TEXT DEFAULT '[]',
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'Paid',
      payment_method TEXT DEFAULT 'Cash',
      payment_received REAL DEFAULT 0,
      balance_due REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
    INSERT OR IGNORE INTO system_settings (id) VALUES ('global');
  `);

  if (withTriggers) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sync_pull_marker (id INTEGER PRIMARY KEY);
      CREATE TRIGGER IF NOT EXISTS trg_sync_stock_adj_insert AFTER INSERT ON stock_adjustments
      WHEN NOT EXISTS (SELECT 1 FROM sync_pull_marker)
      BEGIN
        INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, action, payload, status, created_at)
        VALUES (
          'sq_stock_adj_' || NEW.id,
          'stock_adjustments',
          NEW.id,
          'INSERT',
          json_object('id', NEW.id, 'product_id', NEW.product_id, 'product_name', NEW.product_name, 'old_qty', NEW.old_qty, 'new_qty', NEW.new_qty, 'type', NEW.type, 'created_at', NEW.created_at),
          'PENDING',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );
      END;
    `);
  }

  await ensureSyncSchema(db);
  return db;
}

async function createMockTurso() {
  const cloudDb = await createInMemoryDb(false);
  const tursoClient: any = {
    async execute(queryOrObj: any) {
      const sql = typeof queryOrObj === 'string' ? queryOrObj : queryOrObj.sql;
      const args = typeof queryOrObj === 'string' ? [] : (queryOrObj.args || []);
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('SELECT') || upper.startsWith('PRAGMA')) {
        return { rows: await cloudDb.all(sql, args) };
      }
      if (args.length > 0) {
        const r = await cloudDb.run(sql, args);
        return { rowsAffected: r?.changes || 0 };
      }
      await cloudDb.exec(sql);
      return { rowsAffected: 1 };
    },
    async batch(statements: any[]) {
      const res: any[] = [];
      for (const s of statements) {
        const sql = typeof s === 'string' ? s : s.sql;
        const args = typeof s === 'string' ? [] : (s.args || []);
        res.push(args.length > 0 ? await cloudDb.run(sql, args) : await cloudDb.exec(sql));
      }
      return res;
    },
    async transaction() {
      let closed = false;
      const queuedOps: Array<{ sql: string; args: any[] }> = [];
      return {
        async execute(q: any) {
          if (closed) throw new Error('Transaction closed');
          const sql = typeof q === 'string' ? q : q.sql;
          const args = typeof q === 'string' ? [] : (q.args || []);
          queuedOps.push({ sql, args });
          return { rowsAffected: 1 };
        },
        async commit() {
          if (closed) return;
          for (const op of queuedOps) {
            if (op.args.length > 0) await cloudDb.run(op.sql, op.args);
            else await cloudDb.exec(op.sql);
          }
          closed = true;
        },
        async rollback() {
          queuedOps.length = 0;
          closed = true;
        }
      };
    }
  };
  return { cloudDb, tursoClient };
}

describe('Two-Way Sync Pipeline (syncService.js)', () => {
  beforeEach(() => {
    __resetSyncSchemaForTesting();
  });

  it('does not double-apply historical stock_adjustments deltas during downstream pull', async () => {
    const localDb = await createInMemoryDb(true);
    const { cloudDb, tursoClient } = await createMockTurso();

    await cloudDb.run(
      `INSERT INTO products (id, sku, name, stock, stock_quantity, price, measure_details, updated_at)
       VALUES ('p_sand', 'SK129', 'Sand', 1.999, 1.999, 10000, '{"conversionRate":1000}', '2026-11-28T10:00:00.000Z'),
              ('p_drill', 'PT-BOS-001', 'Bosch Drill', 2, 2, 250, '', '2026-11-28T10:34:33.709Z')`
    );
    await cloudDb.run(
      `INSERT INTO stock_adjustments (id, product_id, product_name, old_qty, new_qty, type, created_at)
       VALUES ('sa_sand_ex', 'p_sand', 'Sand', 2, 1.999, 'Sale Return Exchange', '2026-11-26T15:53:55.328Z'),
              ('sa_drill_s1', 'p_drill', 'Bosch Drill', 3, 1, 'Sale', '2026-11-28T10:06:09.499Z'),
              ('sa_drill_r1', 'p_drill', 'Bosch Drill', 0, 1, 'Sale Return Restock', '2026-11-28T10:34:33.709Z')`
    );

    await pullDownstreamChanges(localDb, tursoClient);

    const sand = await localDb.get("SELECT stock, stock_quantity, measure_details FROM products WHERE id = 'p_sand'");
    const drill = await localDb.get("SELECT stock, stock_quantity, updated_at FROM products WHERE id = 'p_drill'");
    const localAdjs = await localDb.all('SELECT id FROM stock_adjustments');

    expect(Number(sand.stock)).toBeCloseTo(1.999, 6);
    expect(Number(sand.stock_quantity)).toBeCloseTo(1.999, 6);
    expect(sand.measure_details).toBe('{"conversionRate":1000}');
    expect(Number(drill.stock)).toBe(2);
    expect(drill.updated_at).toBe('2026-11-28T10:34:33.709Z');
    expect(localAdjs).toHaveLength(3);
  });

  it('pulls online sales stock decreases and measure_details updates from cloud to desktop when newer', async () => {
    const localDb = await createInMemoryDb(true);
    const { cloudDb, tursoClient } = await createMockTurso();

    await localDb.run(
      `INSERT INTO products (id, sku, name, stock, stock_quantity, price, measure_details, updated_at)
       VALUES ('p_paint', 'PT-NIP-004', 'Nippon Paint', 10, 10, 100, '', '2026-11-28T09:00:00.000Z')`
    );
    await cloudDb.run(
      `INSERT INTO products (id, sku, name, stock, stock_quantity, price, measure_details, updated_at)
       VALUES ('p_paint', 'PT-NIP-004', 'Nippon Paint', 7, 7, 105, '{"conversionRate":4}', '2026-11-28T10:05:00.000Z')`
    );

    await pullDownstreamChanges(localDb, tursoClient);

    const localPaint = await localDb.get("SELECT stock, stock_quantity, price, measure_details, updated_at FROM products WHERE id = 'p_paint'");
    expect(Number(localPaint.stock)).toBe(7);
    expect(Number(localPaint.stock_quantity)).toBe(7);
    expect(Number(localPaint.price)).toBe(105);
    expect(localPaint.measure_details).toBe('{"conversionRate":4}');
    expect(localPaint.updated_at).toBe('2026-11-28T10:05:00.000Z');
  });

  it('preserves queued local non-master updates (sales) during downstream pull', async () => {
    const localDb = await createInMemoryDb(true);
    const { cloudDb, tursoClient } = await createMockTurso();

    await cloudDb.run(
      `INSERT INTO sales (id, invoice_no, total_amount, status, created_at)
       VALUES ('s_1', 'POS1-INV-00001', 500, 'Paid', '2026-11-28T10:00:00.000Z')`
    );
    await localDb.run(
      `INSERT INTO sales (id, invoice_no, total_amount, status, created_at)
       VALUES ('s_1', 'POS1-INV-00001', 500, 'VOIDED', '2026-11-28T10:00:00.000Z')`
    );
    await enqueueSync(localDb, 'sales', 's_1', 'UPDATE');

    await pullDownstreamChanges(localDb, tursoClient);

    const localSale = await localDb.get("SELECT status FROM sales WHERE id = 's_1'");
    expect(localSale.status).toBe('VOIDED');
  });

  it('does not overwrite concurrent cloud stock deltas when pushing both stock_adjustments and products', async () => {
    const localDb = await createInMemoryDb(true);
    const { cloudDb, tursoClient } = await createMockTurso();

    // Cloud started at 10 and had an online web sale of 2 -> cloud stock = 8
    await cloudDb.run(
      `INSERT INTO products (id, sku, name, stock, stock_quantity, price, updated_at)
       VALUES ('p_drill', 'PT-BOS-001', 'Bosch Drill', 8, 8, 250, '2026-11-28T10:01:00.000Z')`
    );

    // Offline desktop started at 10, sold 3 -> local stock = 7, queued both stock_adjustments (-3) and products UPDATE
    await localDb.run(
      `INSERT INTO products (id, sku, name, stock, stock_quantity, price, updated_at)
       VALUES ('p_drill', 'PT-BOS-001', 'Bosch Drill', 7, 7, 250, '2026-11-28T10:02:00.000Z')`
    );
    await localDb.run(
      `INSERT INTO stock_adjustments (id, product_id, product_name, old_qty, new_qty, type, created_at)
       VALUES ('sa_offline_3', 'p_drill', 'Bosch Drill', 10, 7, 'Sale', '2026-11-28T10:02:00.000Z')`
    );
    await enqueueSync(localDb, 'products', 'p_drill', 'UPDATE');

    await pushUpstreamChanges(localDb, tursoClient);
    const cloudProd = await cloudDb.get("SELECT stock, stock_quantity FROM products WHERE id = 'p_drill'");
    expect(Number(cloudProd.stock)).toBe(5);
    expect(Number(cloudProd.stock_quantity)).toBe(5);

    await pullDownstreamChanges(localDb, tursoClient);
    const localProd = await localDb.get("SELECT stock, stock_quantity FROM products WHERE id = 'p_drill'");
    expect(Number(localProd.stock)).toBe(5);
    expect(Number(localProd.stock_quantity)).toBe(5);
  });
});
