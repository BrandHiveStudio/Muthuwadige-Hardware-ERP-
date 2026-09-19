import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Test harness for verifying first-login HTTPS fallback provisioning

test('First-Login HTTPS Fallback & Offline Cache Verification Suite', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'first-login-test-'));
  const testDbPath = path.join(tmpDir, 'test_hardware.db');

  let mockOnlineServer = null;
  let mockOnlinePort = 0;
  let onlineUsers = new Map();

  // Setup Mock Online ERP server
  await new Promise((resolve) => {
    const mockApp = express();
    mockApp.use(express.json());
    mockApp.post('/api/auth/login', (req, res) => {
      const { email, password } = req.body;
      const user = onlineUsers.get((email || '').toLowerCase().trim());
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      const match = bcrypt.compareSync(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      return res.json({
        success: true,
        token: 'online_mock_jwt_session_' + Date.now(),
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          full_name: user.name,
          role: user.role,
          avatar: user.avatar || 'U',
          custom_permissions: user.custom_permissions || ['all'],
          permissions: user.custom_permissions || ['all']
        }
      });
    });

    mockOnlineServer = mockApp.listen(0, '127.0.0.1', () => {
      mockOnlinePort = mockOnlineServer.address().port;
      resolve();
    });
  });

  // Seed Mock Online accounts
  const superAdminHash = await bcrypt.hash('SuperAdminSecret2026', 10);
  onlineUsers.set('muthuwadigehardware@gmail.com', {
    id: 'u_super_admin_01',
    email: 'muthuwadigehardware@gmail.com',
    name: 'Muthuwadige Hardware Super Admin',
    role: 'super_admin',
    password_hash: superAdminHash,
    avatar: 'M',
    custom_permissions: ['dashboard', 'sales', 'inventory', 'reports', 'settings', 'users']
  });

  const staffHash = await bcrypt.hash('CashierPass2026', 10);
  onlineUsers.set('cashier01@mhardware.lk', {
    id: 'u_staff_cashier_01',
    email: 'cashier01@mhardware.lk',
    name: 'Counter Cashier 01',
    role: 'cashier',
    password_hash: staffHash,
    avatar: 'C',
    custom_permissions: ['sales', 'inventory']
  });

  // Initialize clean local SQLite test database
  const db = await open({
    filename: testDbPath,
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      avatar TEXT,
      password TEXT,
      password_hash TEXT,
      permissions TEXT,
      custom_permissions TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password TEXT,
      password_hash TEXT,
      role TEXT,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS custom_permissions (
      role TEXT PRIMARY KEY,
      pages TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Local helper functions mimicking server.js session creation & password migration
  async function verifyAndMigratePassword(profile, plainPassword) {
    const pwd = profile.password_hash || profile.password;
    if (!pwd || typeof pwd !== 'string') return false;
    if (typeof pwd === 'string' && /^\$2[aby]\$/.test(pwd)) {
      return bcrypt.compare(plainPassword, pwd);
    }
    return pwd === plainPassword;
  }

  async function createSession(profile) {
    const token = 'local_test_token_' + Math.random().toString(36).substring(2);
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    await db.run(
      'INSERT INTO sessions (token, user_id, email, role, expires_at) VALUES (?, ?, ?, ?, ?)',
      [token, profile.id, profile.email, profile.role, expiresAt]
    );
    return { token, expiresAt };
  }

  // Local login handler function under test (exact logic from server.js)
  async function handleLogin(cleanEmail, password, mockOnlineUrl) {
    const [localProfile, localUser] = await Promise.all([
      db.get('SELECT * FROM profiles WHERE LOWER(email) = LOWER(?)', [cleanEmail]).catch(() => null),
      db.get('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [cleanEmail]).catch(() => null)
    ]);

    const localAccount = localProfile || (localUser ? {
      id: localUser.id,
      email: localUser.email,
      name: localUser.name,
      role: localUser.role,
      password: localUser.password || localUser.password_hash,
      password_hash: localUser.password_hash || localUser.password,
      created_at: localUser.created_at
    } : null);

    if (localAccount) {
      const passwordOk = await verifyAndMigratePassword(localAccount, password);
      if (!passwordOk) {
        return { status: 401, body: { error: 'Invalid email or password' } };
      }
      const session = await createSession(localAccount);
      return {
        status: 200,
        body: {
          success: true,
          token: session.token,
          expiresAt: session.expiresAt,
          user: {
            id: localAccount.id,
            email: localAccount.email,
            name: localAccount.name,
            role: localAccount.role
          }
        }
      };
    }

    // Step B1: Secure HTTPS fallback to Online ERP
    const remoteApiUrl = (mockOnlineUrl || `http://127.0.0.1:${mockOnlinePort}`).replace(/\/+$/, '');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    let onlineRes = null;
    let onlineData = null;
    let onlineFetchError = null;

    try {
      onlineRes = await fetch(`${remoteApiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password }),
        signal: controller.signal
      });
      onlineData = await onlineRes.json().catch(() => ({}));
    } catch (fetchErr) {
      onlineFetchError = fetchErr;
    } finally {
      clearTimeout(timeoutId);
    }

    if (onlineFetchError || !onlineRes) {
      return {
        status: 401,
        body: {
          error: 'Account not cached on this device. Please connect to the internet for the first login setup.'
        }
      };
    }

    if (!onlineRes.ok || !onlineData || !onlineData.user) {
      return {
        status: 401,
        body: {
          error: onlineData?.error || 'Invalid email or password.'
        }
      };
    }

    // Remote authentication verified successfully!
    const remoteUser = onlineData.user;
    const passwordHashToStore = await bcrypt.hash(password, 10);
    const resolvedId = remoteUser.id || ('u_' + Date.now());
    const resolvedEmail = (remoteUser.email || cleanEmail).toLowerCase().trim();
    const resolvedName = remoteUser.name || remoteUser.full_name || 'Admin';
    const resolvedRole = remoteUser.role || 'Super Admin';
    const resolvedAvatar = remoteUser.avatar || null;
    const resolvedPerms = remoteUser.custom_permissions || remoteUser.permissions || null;
    const permsString = (resolvedPerms && typeof resolvedPerms === 'object')
      ? JSON.stringify(resolvedPerms)
      : (typeof resolvedPerms === 'string' ? resolvedPerms : null);

    // Insert into local users table
    await db.run(
      'INSERT OR REPLACE INTO users (id, email, password, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [resolvedId, resolvedEmail, passwordHashToStore, passwordHashToStore, resolvedRole, resolvedName]
    );

    // Insert into local profiles table
    await db.run(
      'INSERT OR REPLACE INTO profiles (id, email, role, name, password, password_hash, avatar, permissions, custom_permissions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [
        resolvedId,
        resolvedEmail,
        resolvedRole,
        resolvedName,
        passwordHashToStore,
        passwordHashToStore,
        resolvedAvatar,
        permsString,
        permsString
      ]
    );

    if (resolvedPerms) {
      await db.run(
        'INSERT OR REPLACE INTO custom_permissions (role, pages) VALUES (?, ?)',
        [resolvedRole, permsString]
      );
    }

    const cachedLocalAccount = (await db.get('SELECT * FROM profiles WHERE id = ?', [resolvedId])) || {
      id: resolvedId,
      email: resolvedEmail,
      name: resolvedName,
      role: resolvedRole
    };

    const session = await createSession(cachedLocalAccount);

    return {
      status: 200,
      body: {
        success: true,
        token: session.token,
        expiresAt: session.expiresAt,
        user: {
          id: cachedLocalAccount.id,
          email: cachedLocalAccount.email,
          name: cachedLocalAccount.name,
          role: cachedLocalAccount.role
        }
      }
    };
  }

  // --- SCENARIO 1: Valid Online Super Admin first login on clean local database ---
  await t.test('Scenario 1: Valid Online Super Admin first login', async () => {
    const res = await handleLogin('muthuwadigehardware@gmail.com', 'SuperAdminSecret2026');
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.email, 'muthuwadigehardware@gmail.com');
    assert.equal(res.body.user.role, 'super_admin');
    assert.ok(res.body.token.startsWith('local_test_token_'), 'Must issue a local session token');
  });

  // --- SCENARIO 2: Successful local account caching in both tables ---
  await t.test('Scenario 2: Account cached in local SQLite tables', async () => {
    const cachedProfile = await db.get('SELECT * FROM profiles WHERE email = ?', ['muthuwadigehardware@gmail.com']);
    const cachedUser = await db.get('SELECT * FROM users WHERE email = ?', ['muthuwadigehardware@gmail.com']);

    assert.ok(cachedProfile, 'Profile must be cached in SQLite profiles');
    assert.ok(cachedUser, 'User must be cached in SQLite users');
    assert.equal(cachedProfile.id, 'u_super_admin_01');
    assert.equal(cachedUser.id, 'u_super_admin_01');
    assert.ok(/^\$2[aby]\$/.test(cachedProfile.password_hash), 'Cached password must be bcrypt hashed');
    assert.ok(/^\$2[aby]\$/.test(cachedUser.password_hash), 'Cached password in users must be bcrypt hashed');
  });

  // --- SCENARIO 3: Subsequent offline login using cached account ---
  await t.test('Scenario 3: Subsequent offline login with cached credentials', async () => {
    // Pass invalid online URL to simulate 100% disconnected / unreachable network
    const res = await handleLogin('muthuwadigehardware@gmail.com', 'SuperAdminSecret2026', 'http://127.0.0.1:1');
    assert.equal(res.status, 200, 'Subsequent login must succeed completely offline');
    assert.equal(res.body.success, true);
    assert.equal(res.body.user.email, 'muthuwadigehardware@gmail.com');
  });

  // --- SCENARIO 4: Incorrect password on first login ---
  await t.test('Scenario 4: Incorrect password rejected on first login', async () => {
    const res = await handleLogin('cashier01@mhardware.lk', 'WrongPassword123');
    assert.equal(res.status, 401);
    assert.match(res.body.error, /Invalid email or password/i);

    // Verify unauthenticated account was NOT cached
    const notCached = await db.get('SELECT * FROM profiles WHERE email = ?', ['cashier01@mhardware.lk']);
    assert.equal(notCached, undefined);
  });

  // --- SCENARIO 5: Network unavailable on first login for uncached user ---
  await t.test('Scenario 5: Network unavailable on first login returns setup notice', async () => {
    const res = await handleLogin('uncached_user@mhardware.lk', 'AnyPass123', 'http://127.0.0.1:1');
    assert.equal(res.status, 401);
    assert.match(res.body.error, /Account not cached on this device/i);
  });

  // --- SCENARIO 6: Existing local account login remains untouched ---
  await t.test('Scenario 6: Pre-existing local account unaffected by remote API', async () => {
    const localHash = await bcrypt.hash('LocalOnlySecret', 10);
    await db.run(
      'INSERT INTO profiles (id, name, email, role, password, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
      ['u_local_01', 'Offline Manager', 'local_manager@store.lk', 'manager', localHash, localHash]
    );

    const res = await handleLogin('local_manager@store.lk', 'LocalOnlySecret', 'http://127.0.0.1:1');
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'Offline Manager');
  });

  // --- SCENARIO 7: Staff account provisioning and role/permission preservation ---
  await t.test('Scenario 7: Staff account provisioning and custom permissions', async () => {
    const res = await handleLogin('cashier01@mhardware.lk', 'CashierPass2026');
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'cashier');

    const perms = await db.get('SELECT * FROM custom_permissions WHERE role = ?', ['cashier']);
    assert.ok(perms, 'Custom permissions must be cached for cashier role');
    assert.ok(perms.pages.includes('sales'));
  });

  // --- SCENARIO 8: No remote token or server secrets stored in local database ---
  await t.test('Scenario 8: No remote JWT or server secrets leaked into local database', async () => {
    const allSessions = await db.all('SELECT * FROM sessions');
    for (const s of allSessions) {
      assert.equal(s.token.includes('online_mock_jwt_session_'), false, 'Remote online session token must never be saved locally');
    }
  });

  // --- SCENARIO 9: No unintended sync_queue entries generated ---
  await t.test('Scenario 9: Inbound auth caching must not generate outbound sync_queue entries', async () => {
    const syncItems = await db.all('SELECT * FROM sync_queue');
    assert.equal(syncItems.length, 0, 'Zero sync_queue entries generated during auth caching');
  });

  // Teardown
  await db.close();
  mockOnlineServer.close();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});
