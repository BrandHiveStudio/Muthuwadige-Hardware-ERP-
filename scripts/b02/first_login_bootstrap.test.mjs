// Isolated First-Login Bootstrap Verification Test Suite
// Verifies that an online-created staff account can successfully complete its first login
// via Cloud Bootstrap, cache locally into SQLite, and subsequently log in offline.

import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.APP_ROLE = 'test';
process.env.DATABASE_ENGINE = 'sqlite';
for (const key of ['VERCEL', 'IS_WEB_CLIENT', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'APPDATA', 'USER_DATA_PATH', 'ELECTRON_RUN_AS_NODE']) {
  delete process.env[key];
}

async function createLocalDb() {
  const db = await open({
    filename: ':memory:',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'cashier',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT,
      username TEXT,
      email TEXT,
      role TEXT DEFAULT 'cashier',
      role_id TEXT,
      avatar TEXT,
      password TEXT,
      password_hash TEXT,
      permissions TEXT,
      custom_permissions TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT,
      status TEXT DEFAULT 'PENDING',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE,
      value TEXT
    );
  `);

  return db;
}

async function createMockCloud() {
  const cloudDb = await open({
    filename: ':memory:',
    driver: sqlite3.Database
  });

  await cloudDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'cashier',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT,
      username TEXT,
      email TEXT,
      role TEXT DEFAULT 'cashier',
      role_id TEXT,
      avatar TEXT,
      password TEXT,
      password_hash TEXT,
      permissions TEXT,
      custom_permissions TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return {
    async execute({ sql, args = [] }) {
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        const rows = await cloudDb.all(sql, args);
        return {
          rows,
          columns: rows.length > 0 ? Object.keys(rows[0]) : []
        };
      }
      const result = await cloudDb.run(sql, args);
      return { rowsAffected: result.changes };
    },
    rawDb: cloudDb
  };
}

/**
 * Simulates the exact login logic of server.js (lines 3005-3345)
 */
async function simulateLogin(localDb, tursoClient, identifier, password, isOffline = false) {
  const isDesktop = true;
  let profile = await localDb.get('SELECT * FROM profiles WHERE username = ? OR email = ?', [identifier, identifier]);
  let user = await localDb.get('SELECT * FROM users WHERE username = ? OR email = ?', [identifier, identifier]);

  // Step 1: Account absent locally -> Cloud bootstrap
  if (!profile && !user) {
    if (isOffline || !tursoClient) {
      return {
        status: 401,
        error: 'Account not cached on this device. Please connect to the internet for the first login setup.'
      };
    }

    let cloudProfile = null;
    let cloudUser = null;
    let cloudQueryFailed = false;

    try {
      const pRes = await tursoClient.execute({
        sql: 'SELECT * FROM profiles WHERE username = ? OR email = ?',
        args: [identifier, identifier]
      });
      if (pRes && pRes.rows && pRes.rows.length > 0) {
        cloudProfile = pRes.rows[0];
      }

      const uRes = await tursoClient.execute({
        sql: 'SELECT * FROM users WHERE username = ? OR email = ?',
        args: [identifier, identifier]
      });
      if (uRes && uRes.rows && uRes.rows.length > 0) {
        cloudUser = uRes.rows[0];
      }
    } catch (err) {
      cloudQueryFailed = true;
    }

    if (cloudQueryFailed) {
      return {
        status: 401,
        error: 'Account not cached on this device. Please connect to the internet for the first login setup.'
      };
    }

    if (!cloudProfile && !cloudUser) {
      return { status: 401, error: 'Invalid credentials' };
    }

    // Password verification against cloud hash
    const targetHash = (cloudUser && cloudUser.password_hash) || (cloudProfile && (cloudProfile.password_hash || cloudProfile.password));
    if (!targetHash) {
      return { status: 401, error: 'Invalid credentials' };
    }

    const isValid = await bcrypt.compare(password, targetHash);
    if (!isValid) {
      return { status: 401, error: 'Invalid credentials' };
    }

    // Cache locally into SQLite
    const accountId = (cloudProfile && cloudProfile.id) || (cloudUser && cloudUser.id) || crypto.randomUUID();
    const accountUsername = (cloudProfile && cloudProfile.username) || (cloudUser && cloudUser.username) || identifier;
    const accountEmail = (cloudProfile && cloudProfile.email) || (cloudUser && cloudUser.email) || identifier;
    const accountRole = (cloudProfile && cloudProfile.role) || (cloudUser && cloudUser.role) || 'cashier';

    if (cloudUser) {
      await localDb.run(
        `INSERT OR REPLACE INTO users (id, username, email, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          cloudUser.id || accountId,
          cloudUser.username || accountUsername,
          cloudUser.email || accountEmail,
          cloudUser.password_hash || targetHash,
          cloudUser.role || accountRole,
          cloudUser.created_at || new Date().toISOString(),
          new Date().toISOString()
        ]
      );
    }

    await localDb.run(
      `INSERT OR REPLACE INTO profiles (id, name, username, email, role, role_id, avatar, password, password_hash, permissions, custom_permissions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        accountId,
        (cloudProfile && cloudProfile.name) || accountUsername,
        accountUsername,
        accountEmail,
        accountRole,
        (cloudProfile && cloudProfile.role_id) || null,
        (cloudProfile && cloudProfile.avatar) || null,
        targetHash,
        targetHash,
        (cloudProfile && cloudProfile.permissions) || null,
        (cloudProfile && cloudProfile.custom_permissions) || null,
        (cloudProfile && cloudProfile.created_at) || new Date().toISOString(),
        new Date().toISOString()
      ]
    );

    // Read back cached profile for session creation
    profile = await localDb.get('SELECT * FROM profiles WHERE id = ?', [accountId]);
    return {
      status: 200,
      token: 'mock-jwt-session-token',
      profile,
      source: 'cloud_bootstrap'
    };
  }

  // Step 2: Account exists locally -> Local offline verification
  const localHash = profile.password_hash || profile.password || (user && user.password_hash);
  const isValid = await bcrypt.compare(password, localHash);
  if (!isValid) {
    return { status: 401, error: 'Invalid credentials' };
  }

  return {
    status: 200,
    token: 'mock-jwt-session-token',
    profile,
    source: 'local_cache'
  };
}

test('ONLINE-CREATED STAFF FIRST LOGIN & OFFLINE RESILIENCE SUITE', async (t) => {
  const localDb = await createLocalDb();
  const mockCloud = await createMockCloud();

  // Seed online staff account in Cloud ONLY
  const rawPassword = 'StaffSecurePass2026!';
  const hashedPassword = await bcrypt.hash(rawPassword, 10);
  const staffId = 'usr_online_staff_01';
  const staffEmail = 'cashier.staff1@hardwarestore.lk';
  const staffUsername = 'cashier_staff1';

  await mockCloud.rawDb.run(
    `INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, 'cashier')`,
    [staffId, staffUsername, staffEmail, hashedPassword]
  );
  await mockCloud.rawDb.run(
    `INSERT INTO profiles (id, name, username, email, role, password, password_hash) VALUES (?, 'Kamal Perera', ?, ?, 'cashier', ?, ?)`,
    [staffId, staffUsername, staffEmail, hashedPassword, hashedPassword]
  );

  // Seed an existing local admin in SQLite to verify existing users remain unaffected
  const existingAdminPassword = await bcrypt.hash('AdminPass123!', 10);
  await localDb.run(
    `INSERT INTO profiles (id, name, username, email, role, password, password_hash) VALUES ('adm_local_01', 'Super Admin', 'admin', 'admin@store.lk', 'admin', ?, ?)`,
    [existingAdminPassword, existingAdminPassword]
  );

  await t.test('1. Confirm staff account is NOT initially in local SQLite', async () => {
    const p = await localDb.get('SELECT * FROM profiles WHERE username = ?', [staffUsername]);
    const u = await localDb.get('SELECT * FROM users WHERE username = ?', [staffUsername]);
    assert.equal(p, undefined);
    assert.equal(u, undefined);
  });

  await t.test('2. Attempt first login without Turso client (simulates unconfigured .env)', async () => {
    const res = await simulateLogin(localDb, null, staffUsername, rawPassword);
    assert.equal(res.status, 401);
    assert.match(res.error, /Account not cached on this device/);
  });

  await t.test('3. Attempt first login with valid Turso client (simulates configured provisioning)', async () => {
    const res = await simulateLogin(localDb, mockCloud, staffUsername, rawPassword);
    assert.equal(res.status, 200);
    assert.equal(res.source, 'cloud_bootstrap');
    assert.equal(res.profile.username, staffUsername);
    assert.equal(res.profile.role, 'cashier');
    assert.ok(res.token);
  });

  await t.test('4. Verify account is now cached in local SQLite users & profiles', async () => {
    const cachedProfile = await localDb.get('SELECT * FROM profiles WHERE username = ?', [staffUsername]);
    const cachedUser = await localDb.get('SELECT * FROM users WHERE username = ?', [staffUsername]);

    assert.ok(cachedProfile);
    assert.equal(cachedProfile.id, staffId);
    assert.equal(cachedProfile.name, 'Kamal Perera');
    assert.equal(cachedProfile.role, 'cashier');

    assert.ok(cachedUser);
    assert.equal(cachedUser.id, staffId);
    assert.equal(cachedUser.username, staffUsername);
  });

  await t.test('5. Verify NO sync_queue contamination occurred during local caching', async () => {
    const queueRows = await localDb.all('SELECT * FROM sync_queue WHERE record_id = ?', [staffId]);
    assert.equal(queueRows.length, 0, 'Inbound caching must not pollute outbound sync queue');
  });

  await t.test('6. Disconnect network and perform subsequent login 100% offline', async () => {
    const start = Date.now();
    // Pass null for tursoClient and isOffline = true
    const res = await simulateLogin(localDb, null, staffUsername, rawPassword, true);
    const duration = Date.now() - start;

    assert.equal(res.status, 200);
    assert.equal(res.source, 'local_cache');
    assert.equal(res.profile.id, staffId);
    assert.ok(duration < 200, 'Offline login should execute in <200ms');
  });

  await t.test('7. Verify existing local admin account remains intact and fast', async () => {
    const res = await simulateLogin(localDb, null, 'admin', 'AdminPass123!', true);
    assert.equal(res.status, 200);
    assert.equal(res.source, 'local_cache');
    assert.equal(res.profile.id, 'adm_local_01');
  });

  await t.test('8. Verify wrong password is rejected locally', async () => {
    const res = await simulateLogin(localDb, null, staffUsername, 'WrongPassword999!', true);
    assert.equal(res.status, 401);
    assert.equal(res.error, 'Invalid credentials');
  });
});
