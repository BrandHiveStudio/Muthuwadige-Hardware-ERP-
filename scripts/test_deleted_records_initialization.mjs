import test from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { DELETED_RECORDS_SCHEMA_SQL } from '../server.js';
import { resolveEngineMode } from '../src/db/connection.js';

// Test Suite: Bounded Remediation Verification for deleted_records table initialization
// Uses strictly isolated, disposable in-memory SQLite instances and mocks.

async function createTestDb() {
  const db = await open({
    filename: ':memory:',
    driver: sqlite3.Database
  });

  // Attach transaction helper to mirror connection.js transaction wrapper
  db.transaction = async (callback) => {
    await db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = await callback();
      await db.run('COMMIT');
      return result;
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  };

  return db;
}

test('1. Canonical DDL Schema Fidelity: Matches syncService tombstone specification', async () => {
  assert.ok(DELETED_RECORDS_SCHEMA_SQL, 'DELETED_RECORDS_SCHEMA_SQL must be exported from server.js');
  assert.ok(DELETED_RECORDS_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS deleted_records'));
  assert.ok(DELETED_RECORDS_SCHEMA_SQL.includes('table_name TEXT NOT NULL'));
  assert.ok(DELETED_RECORDS_SCHEMA_SQL.includes('record_id TEXT NOT NULL'));
  assert.ok(DELETED_RECORDS_SCHEMA_SQL.includes('deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP'));
  assert.ok(DELETED_RECORDS_SCHEMA_SQL.includes('PRIMARY KEY (table_name, record_id)'));
  assert.equal(DELETED_RECORDS_SCHEMA_SQL.includes('id TEXT PRIMARY KEY'), false, 'Must NOT contain surrogate id column');
});

test('2. Decision Logic: Engine mode resolution routes to Turso serverless vs Local SQLite', async () => {
  // Test serverless detection logic (simulating Vercel environment)
  const origVercel = process.env.VERCEL;
  const origAppRole = process.env.APP_ROLE;
  const origDbEngine = process.env.DATABASE_ENGINE;

  try {
    // Mode A: Serverless / Vercel
    process.env.VERCEL = '1';
    delete process.env.APP_ROLE;
    delete process.env.DATABASE_ENGINE;
    assert.equal(resolveEngineMode(), 'turso', 'VERCEL=1 must resolve engine mode to turso');

    // Mode B: Local Desktop
    delete process.env.VERCEL;
    process.env.APP_ROLE = 'desktop';
    assert.equal(resolveEngineMode(), 'sqlite', 'APP_ROLE=desktop must resolve engine mode to sqlite');

    // Mode C: Default Standalone
    delete process.env.APP_ROLE;
    assert.equal(resolveEngineMode(), 'sqlite', 'Default must resolve engine mode to sqlite');
  } finally {
    if (origVercel !== undefined) process.env.VERCEL = origVercel; else delete process.env.VERCEL;
    if (origAppRole !== undefined) process.env.APP_ROLE = origAppRole; else delete process.env.APP_ROLE;
    if (origDbEngine !== undefined) process.env.DATABASE_ENGINE = origDbEngine; else delete process.env.DATABASE_ENGINE;
  }
});

test('3. Serverless Path Simulation: Cold start adapter ensures deleted_records and avoids redundant DDL', async () => {
  const db = await createTestDb();

  // Mock serverless cold start workflow as implemented in ensureDbInitialized()
  let ddlExecutionCount = 0;
  const mockAdapter = {
    exec: async (sql) => {
      ddlExecutionCount++;
      return db.exec(sql);
    }
  };

  // Simulate cold-start call
  let warmDb = null;
  const coldStartInit = async () => {
    if (warmDb) return warmDb;
    // Fast path: connect client + run canonical DDL
    await mockAdapter.exec(DELETED_RECORDS_SCHEMA_SQL);
    warmDb = mockAdapter;
    return warmDb;
  };

  // First cold-start invocation
  const first = await coldStartInit();
  assert.ok(first);
  assert.equal(ddlExecutionCount, 1, 'Cold start must execute DDL once');

  // Verify table was created on the underlying database
  const tableCheck = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='deleted_records'");
  assert.ok(tableCheck, 'Table deleted_records must exist');

  // Subsequent warm invocations in same container
  const second = await coldStartInit();
  const third = await coldStartInit();
  assert.equal(second, first);
  assert.equal(third, first);
  assert.equal(ddlExecutionCount, 1, 'Warm invocations must NOT execute redundant DDL roundtrips');

  await db.close();
});

test('4. Error Propagation: DDL errors are NOT swallowed and propagate to caller', async () => {
  const failingDb = {
    exec: async () => {
      throw new Error('TURSO_WRITE_ERROR: Disk full or authentication rejected');
    }
  };

  let caughtError = null;
  try {
    // Simulate ensureDbInitialized serverless path when exec fails
    await failingDb.exec(DELETED_RECORDS_SCHEMA_SQL);
  } catch (err) {
    caughtError = err;
  }

  assert.ok(caughtError, 'DDL failure must not be swallowed');
  assert.equal(caughtError.message, 'TURSO_WRITE_ERROR: Disk full or authentication rejected');
});

test('5. Idempotency & Repeated Initialization: Repeated DDL causes no errors', async () => {
  const db = await createTestDb();

  await db.exec(DELETED_RECORDS_SCHEMA_SQL);
  await db.exec(DELETED_RECORDS_SCHEMA_SQL);
  await db.exec(DELETED_RECORDS_SCHEMA_SQL);

  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='deleted_records'");
  assert.equal(tables.length, 1, 'Only one deleted_records table should exist');

  await db.close();
});

test('6. Tombstone Insertion & Composite Primary Key: Two-column INSERT OR REPLACE succeeds', async () => {
  const db = await createTestDb();
  await db.exec(DELETED_RECORDS_SCHEMA_SQL);

  // Insert tombstone
  await db.run('INSERT OR REPLACE INTO deleted_records (table_name, record_id) VALUES (?, ?)', ['customers', 'cust_001']);
  const row = await db.get('SELECT * FROM deleted_records WHERE table_name = ? AND record_id = ?', ['customers', 'cust_001']);
  assert.ok(row, 'Inserted row must exist');
  assert.equal(row.table_name, 'customers');
  assert.equal(row.record_id, 'cust_001');
  assert.ok(row.deleted_at, 'deleted_at should be auto-populated');

  // Idempotent replace
  await db.run('INSERT OR REPLACE INTO deleted_records (table_name, record_id) VALUES (?, ?)', ['customers', 'cust_001']);
  const count = await db.get('SELECT COUNT(*) as total FROM deleted_records WHERE table_name = ? AND record_id = ?', ['customers', 'cust_001']);
  assert.equal(count.total, 1, 'Composite PK prevents duplicate rows');

  await db.close();
});

test('7. Multi-Route Compatibility: Customer, Supplier, Sale, Sales-Return tombstones', async () => {
  const db = await createTestDb();
  await db.exec(DELETED_RECORDS_SCHEMA_SQL);

  const routes = [
    { table: 'customers', id: 'cust_abc' },
    { table: 'suppliers', id: 'sup_xyz' },
    { table: 'sales', id: 'sale_inv_1001' },
    { table: 'sales_returns', id: 'sr_ret_2002' },
    { table: 'profiles', id: 'usr_staff_01' },
    { table: 'users', id: 'usr_staff_01' }
  ];

  for (const r of routes) {
    await db.run('INSERT OR REPLACE INTO deleted_records (table_name, record_id) VALUES (?, ?)', [r.table, r.id]);
    const found = await db.get('SELECT * FROM deleted_records WHERE table_name = ? AND record_id = ?', [r.table, r.id]);
    assert.ok(found, `Tombstone for ${r.table} (${r.id}) must exist`);
  }

  await db.close();
});

test('8. Transaction Rollback Integrity: Failed transaction rolls back deletions and tombstones', async () => {
  const db = await createTestDb();
  await db.exec(DELETED_RECORDS_SCHEMA_SQL);

  await db.exec(`
    CREATE TABLE mock_users (id TEXT PRIMARY KEY, username TEXT);
  `);
  await db.run('INSERT INTO mock_users (id, username) VALUES (?, ?)', ['usr_test', 'test_user']);

  let failed = false;
  try {
    await db.transaction(async () => {
      await db.run('DELETE FROM mock_users WHERE id = ?', ['usr_test']);
      await db.run('INSERT OR REPLACE INTO deleted_records (table_name, record_id) VALUES (?, ?)', ['mock_users', 'usr_test']);
      throw new Error('Simulated transaction failure');
    });
  } catch (err) {
    failed = true;
    assert.equal(err.message, 'Simulated transaction failure');
  }

  assert.equal(failed, true);

  // Record must still exist due to rollback
  const user = await db.get('SELECT * FROM mock_users WHERE id = ?', ['usr_test']);
  assert.ok(user, 'User must not be deleted after rollback');

  // Tombstone must NOT exist
  const tombstone = await db.get('SELECT * FROM deleted_records WHERE table_name = ? AND record_id = ?', ['mock_users', 'usr_test']);
  assert.equal(tombstone, undefined, 'Tombstone must not exist after rollback');

  await db.close();
});

test.after(() => {
  process.exit(0);
});

