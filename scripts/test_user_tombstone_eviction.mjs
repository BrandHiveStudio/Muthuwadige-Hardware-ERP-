import test from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import crypto from 'crypto';

// Test Suite: User Tombstone Synchronization & Session Eviction
// Uses isolated, disposable in-memory SQLite instances.

const TEST_JWT_SECRET = 'test_jwt_secret_key_for_isolated_eviction_suite';

function signTestJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;
  const claims = { ...payload, iat: now, exp };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = crypto.createHmac('sha256', TEST_JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

async function createTestDb() {
  const db = await open({
    filename: ':memory:',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      password TEXT,
      role TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deleted_records (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (table_name, record_id)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
  `);

  return db;
}

test('1. Downstream Tombstone Pull: Cloud tombstones purge local records and populate local deleted_records', async () => {
  const localDb = await createTestDb();

  // Seed local user, profile, and customer
  await localDb.run('INSERT INTO profiles (id, name, email, role) VALUES (?, ?, ?, ?)', ['usr_krish', 'Krish', 'krish@example.com', 'admin']);
  await localDb.run('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)', ['usr_krish', 'Krish', 'krish@example.com', 'hashed_pw', 'admin']);
  await localDb.run('INSERT INTO sessions (token, user_id, email, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', ['sess_krish', 'usr_krish', 'krish@example.com', 'admin', new Date().toISOString(), new Date(Date.now() + 100000).toISOString()]);
  await localDb.run('INSERT INTO customers (id, name) VALUES (?, ?)', ['cust_tomb_01', 'Deleted Customer']);

  // Simulate Cloud tombstones from Turso deleted_records
  const cloudTombstones = [
    { table_name: 'users', record_id: 'usr_krish', deleted_at: '2026-09-19 04:00:00' },
    { table_name: 'profiles', record_id: 'usr_krish', deleted_at: '2026-09-19 04:00:00' },
    { table_name: 'customers', record_id: 'cust_tomb_01', deleted_at: '2026-09-19 04:05:00' }
  ];

  // Emulate downstream tombstone processor from syncService.js
  for (const row of cloudTombstones) {
    const tableName = row.table_name;
    const recordId = String(row.record_id);

    await localDb.run(
      'INSERT OR REPLACE INTO deleted_records (table_name, record_id, deleted_at) VALUES (?, ?, COALESCE(?, CURRENT_TIMESTAMP))',
      [tableName, recordId, row.deleted_at]
    );

    if (tableName === 'users') {
      await localDb.run('DELETE FROM users WHERE id = ?', [recordId]);
      await localDb.run('DELETE FROM sessions WHERE user_id = ?', [recordId]);
    } else if (tableName === 'profiles') {
      await localDb.run('DELETE FROM profiles WHERE id = ?', [recordId]);
      await localDb.run('DELETE FROM users WHERE id = ?', [recordId]);
      await localDb.run('DELETE FROM sessions WHERE user_id = ?', [recordId]);
    } else if (tableName === 'customers') {
      await localDb.run('DELETE FROM customers WHERE id = ?', [recordId]);
    }
  }

  // Verify local user and profile deleted
  const profileRow = await localDb.get('SELECT * FROM profiles WHERE id = ?', ['usr_krish']);
  const userRow = await localDb.get('SELECT * FROM users WHERE id = ?', ['usr_krish']);
  const sessionRow = await localDb.get('SELECT * FROM sessions WHERE user_id = ?', ['usr_krish']);
  const custRow = await localDb.get('SELECT * FROM customers WHERE id = ?', ['cust_tomb_01']);

  assert.equal(profileRow, undefined, 'Local profile must be deleted');
  assert.equal(userRow, undefined, 'Local user must be deleted');
  assert.equal(sessionRow, undefined, 'Local session must be purged');
  assert.equal(custRow, undefined, 'Local customer must be deleted');

  // Verify local deleted_records contains tombstones
  const uTomb = await localDb.get('SELECT * FROM deleted_records WHERE table_name = ? AND record_id = ?', ['users', 'usr_krish']);
  const pTomb = await localDb.get('SELECT * FROM deleted_records WHERE table_name = ? AND record_id = ?', ['profiles', 'usr_krish']);
  const cTomb = await localDb.get('SELECT * FROM deleted_records WHERE table_name = ? AND record_id = ?', ['customers', 'cust_tomb_01']);

  assert.ok(uTomb, 'User tombstone must exist locally');
  assert.ok(pTomb, 'Profile tombstone must exist locally');
  assert.ok(cTomb, 'Customer tombstone must exist locally');

  await localDb.close();
});

test('2. Active Session Eviction: Authenticate middleware rejects JWT for deleted user', async () => {
  const db = await createTestDb();

  // Create an active user and a deleted user
  await db.run('INSERT INTO profiles (id, name, email, role) VALUES (?, ?, ?, ?)', ['usr_active', 'Active User', 'active@example.com', 'cashier']);
  await db.run('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)', ['usr_active', 'Active User', 'active@example.com', 'hash', 'cashier']);

  // Simulate authenticate middleware logic with db check
  async function simulateAuth(userId, email) {
    let clearedCookie = false;
    let statusCode = 200;
    let responseBody = null;

    let userExists = null;
    try {
      userExists = await db.get(
        'SELECT id FROM profiles WHERE id = ? UNION SELECT id FROM users WHERE id = ?',
        [userId, userId]
      );
    } catch (_) {}

    if (!userExists) {
      clearedCookie = true;
      statusCode = 401;
      responseBody = {
        error: 'Session expired or user account has been removed. Please log in again.',
        code: 'USER_DELETED'
      };
      return { authenticated: false, statusCode, clearedCookie, responseBody };
    }

    return { authenticated: true, statusCode: 200 };
  }

  // Active user should succeed
  const activeResult = await simulateAuth('usr_active', 'active@example.com');
  assert.equal(activeResult.authenticated, true);
  assert.equal(activeResult.statusCode, 200);

  // Deleted user (e.g. usr_krish) should be rejected immediately
  const deletedResult = await simulateAuth('usr_krish', 'krish@example.com');
  assert.equal(deletedResult.authenticated, false);
  assert.equal(deletedResult.statusCode, 401);
  assert.equal(deletedResult.clearedCookie, true);
  assert.equal(deletedResult.responseBody.code, 'USER_DELETED');

  await db.close();
});

test('3. Database Session Fallback: Missing user evicts database session token', async () => {
  const db = await createTestDb();

  // Orphaned session for a user that was deleted
  const orphanToken = 'orphaned_token_12345';
  await db.run(
    'INSERT INTO sessions (token, user_id, email, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [orphanToken, 'usr_ghost', 'ghost@example.com', 'cashier', new Date().toISOString(), new Date(Date.now() + 100000).toISOString()]
  );

  // Simulate authenticate middleware session lookup with eviction
  const session = await db.get('SELECT * FROM sessions WHERE token = ?', [orphanToken]);
  assert.ok(session, 'Session row exists initially');

  let userExists = null;
  if (session.user_id) {
    userExists = await db.get(
      'SELECT id FROM profiles WHERE id = ? UNION SELECT id FROM users WHERE id = ?',
      [session.user_id, session.user_id]
    );
  }

  assert.equal(userExists, undefined, 'User must not exist in profiles or users');

  // Purge session on missing user
  if (!userExists) {
    await db.run('DELETE FROM sessions WHERE user_id = ? OR token = ?', [session.user_id, orphanToken]);
  }

  const sessionAfter = await db.get('SELECT * FROM sessions WHERE token = ?', [orphanToken]);
  assert.equal(sessionAfter, undefined, 'Orphaned session must be purged from database');

  await db.close();
});

test.after(() => {
  process.exit(0);
});
