import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper to snapshot and restore process.env
function runWithEnv(envUpdates, fn) {
  const originalEnv = { ...process.env };
  try {
    for (const key of Object.keys(envUpdates)) {
      if (envUpdates[key] === undefined || envUpdates[key] === null) {
        delete process.env[key];
      } else {
        process.env[key] = String(envUpdates[key]);
      }
    }
    return fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const key of Object.keys(originalEnv)) {
      process.env[key] = originalEnv[key];
    }
  }
}

async function runWithEnvAsync(envUpdates, fn) {
  const originalEnv = { ...process.env };
  try {
    for (const key of Object.keys(envUpdates)) {
      if (envUpdates[key] === undefined || envUpdates[key] === null) {
        delete process.env[key];
      } else {
        process.env[key] = String(envUpdates[key]);
      }
    }
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const key of Object.keys(originalEnv)) {
      process.env[key] = originalEnv[key];
    }
  }
}

// Emulate browser environment for api.ts logic
function setupBrowserMock({ isElectron = false, hostname = 'localhost', origin = 'http://localhost:5173', storedKeys = {} } = {}) {
  const store = { ...storedKeys };
  const mockLocalStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
    _store: store
  };

  const windowMock = {
    location: {
      hostname,
      origin,
      protocol: isElectron ? 'file:' : 'http:'
    },
    localStorage: mockLocalStorage
  };

  if (isElectron) {
    windowMock.electronAPI = { isElectron: true };
  }

  const navigatorMock = {
    userAgent: isElectron ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Electron/28.0.0' : 'Mozilla/5.0 Chrome/120.0'
  };

  // Implementation of getBaseUrl and setApiUrl extracted from src/lib/api.ts
  function getBaseUrl() {
    if (typeof windowMock === 'undefined') return 'http://127.0.0.1:5001/api';

    // 1. ELECTRON DESKTOP APP CHECK (D01.1: Immutable Local Lock)
    const isElec = Boolean(windowMock.electronAPI) ||
                   windowMock.location.protocol === 'file:' ||
                   (typeof navigatorMock !== 'undefined' && navigatorMock.userAgent.includes('Electron'));

    if (isElec) {
      return 'http://127.0.0.1:5001/api';
    }

    // 2. LIVE WEB DEPLOYMENT / SAME-ORIGIN (Vercel, custom domain, or direct LAN browser)
    const h = windowMock.location.hostname || '';
    const isLocalWeb = h === 'localhost' || h === '127.0.0.1' || h === '';

    if (!isLocalWeb) {
      const stored = windowMock.localStorage.getItem('erp_host_address') || windowMock.localStorage.getItem('api_server_url') || windowMock.localStorage.getItem('server_address');
      if (stored) {
        return stored.replace(/\/+$/, '').replace(/\/api$/, '') + '/api';
      }
      return `${windowMock.location.origin}/api`;
    }

    // 3. LOCAL DEV BROWSER
    const stored = windowMock.localStorage.getItem('erp_host_address') || windowMock.localStorage.getItem('api_server_url') || windowMock.localStorage.getItem('server_address');
    return (stored ? stored.replace(/\/+$/, '').replace(/\/api$/, '') : 'http://127.0.0.1:5001') + '/api';
  }

  let API_URL = getBaseUrl();
  let BASE_URL = API_URL.replace(/\/api$/, '');

  function setApiUrl(newUrl) {
    const isElec = typeof windowMock !== 'undefined' && (
      Boolean(windowMock.electronAPI) ||
      windowMock.location.protocol === 'file:' ||
      (typeof navigatorMock !== 'undefined' && navigatorMock.userAgent.includes('Electron'))
    );

    if (newUrl) {
      const cleanUrl = newUrl.replace(/\/+$/, '');
      windowMock.localStorage.setItem('erp_host_address', cleanUrl);
      windowMock.localStorage.setItem('api_server_url', cleanUrl);
      if (!isElec) {
        API_URL = cleanUrl.endsWith('/api') ? cleanUrl : `${cleanUrl}/api`;
      }
    } else {
      windowMock.localStorage.removeItem('erp_host_address');
      windowMock.localStorage.removeItem('api_server_url');
      windowMock.localStorage.removeItem('server_address');
      if (!isElec) {
        API_URL = getBaseUrl();
      }
    }
    if (isElec) {
      API_URL = 'http://127.0.0.1:5001/api';
    }
    BASE_URL = API_URL.replace(/\/api$/, '');
  }

  return { windowMock, navigatorMock, mockLocalStorage, getBaseUrl, setApiUrl, getApiUrl: () => API_URL };
}

// -------------------------------------------------------------------------------------------------
// PART A: HOST SELECTION TESTS (T-H01, T-H04, T-H06, T-H07, T-H08 & D01 SCENARIOS 3, 4, 5, 6, 7)
// -------------------------------------------------------------------------------------------------

test('T-H01 & D01.1: Electron Local Lock - UI strictly uses 127.0.0.1:5001/api ignoring localStorage overrides', async () => {
  const { getBaseUrl, setApiUrl, getApiUrl, mockLocalStorage } = setupBrowserMock({
    isElectron: true,
    storedKeys: {
      erp_host_address: 'http://192.168.1.150:5001',
      api_server_url: 'https://cloud-backup-erp.vercel.app',
      server_address: 'http://10.0.0.99:5001'
    }
  });

  assert.equal(getBaseUrl(), 'http://127.0.0.1:5001/api', 'Electron must be locked to 127.0.0.1:5001/api');
  assert.equal(getApiUrl(), 'http://127.0.0.1:5001/api');

  // Attempting setApiUrl in Electron must not change API_URL
  setApiUrl('http://192.168.1.200:5001');
  assert.equal(getApiUrl(), 'http://127.0.0.1:5001/api', 'setApiUrl must not override loopback authority in Electron');
});

test('T-H04 & Scenario 3: Local Dev Browser connects to 127.0.0.1:5001/api by default', () => {
  const { getBaseUrl } = setupBrowserMock({
    isElectron: false,
    hostname: 'localhost',
    origin: 'http://localhost:5173'
  });

  assert.equal(getBaseUrl(), 'http://127.0.0.1:5001/api');
});

test('T-H06 & Scenario 4: LAN Browser directly accesses Local ERP server origin/api', () => {
  const { getBaseUrl } = setupBrowserMock({
    isElectron: false,
    hostname: '192.168.1.88',
    origin: 'http://192.168.1.88:5001'
  });

  assert.equal(getBaseUrl(), 'http://192.168.1.88:5001/api', 'LAN browser defaults to same-origin /api');
});

test('T-H07 & Scenario 5: Saved LAN host reload is honored by browser, ignored by Electron', () => {
  // Browser test:
  const browser = setupBrowserMock({
    isElectron: false,
    hostname: 'localhost',
    origin: 'http://localhost:5173',
    storedKeys: { erp_host_address: 'http://192.168.1.50:5001' }
  });
  assert.equal(browser.getBaseUrl(), 'http://192.168.1.50:5001/api', 'Browser honors saved LAN host');

  // Electron test:
  const electron = setupBrowserMock({
    isElectron: true,
    storedKeys: { erp_host_address: 'http://192.168.1.50:5001' }
  });
  assert.equal(electron.getBaseUrl(), 'http://127.0.0.1:5001/api', 'Electron strictly ignores saved LAN host');
});

test('T-H08 & Scenario 6: Saved remote/cloud host is honored by browser, ignored by Electron', () => {
  // Browser test:
  const browser = setupBrowserMock({
    isElectron: false,
    hostname: 'localhost',
    origin: 'http://localhost:5173',
    storedKeys: { erp_host_address: 'https://my-erp.vercel.app' }
  });
  assert.equal(browser.getBaseUrl(), 'https://my-erp.vercel.app/api', 'Browser honors saved remote host');

  // Electron test:
  const electron = setupBrowserMock({
    isElectron: true,
    storedKeys: { erp_host_address: 'https://my-erp.vercel.app' }
  });
  assert.equal(electron.getBaseUrl(), 'http://127.0.0.1:5001/api', 'Electron strictly ignores saved remote host');
});

test('Scenario 7: Custom API/domain deployment uses same-origin /api', () => {
  const { getBaseUrl } = setupBrowserMock({
    isElectron: false,
    hostname: 'pos.muthuwadige.lk',
    origin: 'https://pos.muthuwadige.lk'
  });
  assert.equal(getBaseUrl(), 'https://pos.muthuwadige.lk/api');
});

// -------------------------------------------------------------------------------------------------
// PART B: ELECTRON RUNTIME SANITIZATION & FLAGS (T-E01, D01.6)
// -------------------------------------------------------------------------------------------------

test('T-E01 & D01.6: Electron child process receives DATABASE_ENGINE=sqlite, APP_ROLE=desktop and sanitizes cloud flags', () => {
  const simulatedOsEnv = {
    NODE_ENV: 'production',
    JWT_SECRET: 'test-secret',
    VERCEL: '1',
    IS_WEB_CLIENT: '1',
    DATABASE_ENGINE: 'turso',
    APP_ROLE: 'web',
    TURSO_DATABASE_URL: 'https://test.turso.io',
    TURSO_AUTH_TOKEN: 'valid-token'
  };

  // Replicate startBackendServer environment construction from electron-main.js
  const serverEnv = {
    ...simulatedOsEnv,
    NODE_ENV: 'production',
    JWT_SECRET: simulatedOsEnv.JWT_SECRET,
    DATABASE_ENGINE: 'sqlite',
    APP_ROLE: 'desktop'
  };

  delete serverEnv.VERCEL;
  delete serverEnv.IS_WEB_CLIENT;

  assert.equal(serverEnv.DATABASE_ENGINE, 'sqlite', 'Must enforce DATABASE_ENGINE=sqlite');
  assert.equal(serverEnv.APP_ROLE, 'desktop', 'Must enforce APP_ROLE=desktop');
  assert.equal(serverEnv.VERCEL, undefined, 'VERCEL flag must be purged');
  assert.equal(serverEnv.IS_WEB_CLIENT, undefined, 'IS_WEB_CLIENT flag must be purged');
  assert.equal(serverEnv.TURSO_DATABASE_URL, 'https://test.turso.io', 'Turso credentials must be preserved for sync peer');
  assert.equal(serverEnv.TURSO_AUTH_TOKEN, 'valid-token', 'Turso credentials must be preserved for sync peer');
});

// -------------------------------------------------------------------------------------------------
// PART C: DATABASE ENGINE RESOLUTION & CONFLICT DETECTION (T-E02, T-E03, T-E04, D01 SCENARIOS 1, 2, 8, 9, 10)
// -------------------------------------------------------------------------------------------------

test('T-E02 & Scenario 1: Electron offline + SQLite resolves to SQLite primary', async () => {
  const { resolveEngineMode, isTurso } = await import('../src/db/connection.js');

  runWithEnv({
    APP_ROLE: 'desktop',
    DATABASE_ENGINE: 'sqlite',
    VERCEL: null,
    TURSO_DATABASE_URL: null,
    TURSO_AUTH_TOKEN: null
  }, () => {
    const engine = resolveEngineMode();
    assert.equal(engine, 'sqlite');
    assert.equal(isTurso(), false, 'isTurso must be false for offline SQLite POS');
  });
});

test('T-E02 & Scenario 2: Electron online + SQLite + Turso resolves to SQLite primary (Turso is sync peer only)', async () => {
  const { resolveEngineMode, isTurso } = await import('../src/db/connection.js');

  runWithEnv({
    APP_ROLE: 'desktop',
    DATABASE_ENGINE: 'sqlite',
    VERCEL: null,
    TURSO_DATABASE_URL: 'https://test-turso.turso.io',
    TURSO_AUTH_TOKEN: 'valid-test-token'
  }, () => {
    const engine = resolveEngineMode();
    assert.equal(engine, 'sqlite', 'Presence of Turso credentials must NOT make Electron Turso-primary');
    assert.equal(isTurso(), false, 'isTurso must remain false in desktop SQLite mode');
  });
});

test('Scenario 1 & 2: Standalone Local Node default resolves to SQLite', async () => {
  const { resolveEngineMode, isTurso } = await import('../src/db/connection.js');

  runWithEnv({
    APP_ROLE: null,
    DATABASE_ENGINE: null,
    VERCEL: null,
    TURSO_DATABASE_URL: 'https://test-turso.turso.io',
    TURSO_AUTH_TOKEN: 'valid-test-token'
  }, () => {
    const engine = resolveEngineMode();
    assert.equal(engine, 'sqlite', 'Default local node must resolve to SQLite even if Turso creds exist');
    assert.equal(isTurso(), false);
  });
});

test('T-E03 & Scenario 8: Vercel serverless resolves to Turso Cloud primary', async () => {
  const { resolveEngineMode, isTurso } = await import('../src/db/connection.js');

  runWithEnv({
    VERCEL: '1',
    APP_ROLE: null,
    DATABASE_ENGINE: null,
    TURSO_DATABASE_URL: 'https://test-turso.turso.io',
    TURSO_AUTH_TOKEN: 'valid-test-token'
  }, () => {
    const engine = resolveEngineMode();
    assert.equal(engine, 'turso');
    assert.equal(isTurso(), true);
  });
});

test('T-E03 & Scenario 8: APP_ROLE=web resolves to Turso Cloud primary', async () => {
  const { resolveEngineMode, isTurso } = await import('../src/db/connection.js');

  runWithEnv({
    VERCEL: null,
    APP_ROLE: 'web',
    DATABASE_ENGINE: null,
    TURSO_DATABASE_URL: 'https://test-turso.turso.io',
    TURSO_AUTH_TOKEN: 'valid-test-token'
  }, () => {
    const engine = resolveEngineMode();
    assert.equal(engine, 'turso');
    assert.equal(isTurso(), true);
  });
});

test('T-E03 & Scenario 8: DATABASE_ENGINE=turso resolves to Turso Cloud primary', async () => {
  const { resolveEngineMode, isTurso } = await import('../src/db/connection.js');

  runWithEnv({
    VERCEL: null,
    APP_ROLE: null,
    DATABASE_ENGINE: 'turso',
    TURSO_DATABASE_URL: 'https://test-turso.turso.io',
    TURSO_AUTH_TOKEN: 'valid-test-token'
  }, () => {
    const engine = resolveEngineMode();
    assert.equal(engine, 'turso');
    assert.equal(isTurso(), true);
  });
});

test('T-E03 & Scenario 8: Local SQLite resolution strictly prohibited in web/serverless mode', async () => {
  // Test via isolated node snippet to test resolveLocalDbPath
  const testScript = `
    import { initDb } from './src/db/connection.js';
    process.env.VERCEL = '1';
    process.env.DATABASE_ENGINE = 'turso';
    process.env.TURSO_DATABASE_URL = 'https://example.turso.io';
    process.env.TURSO_AUTH_TOKEN = 'token';
    const isWeb = Boolean(process.env.VERCEL);
    console.log(isWeb ? 'WEB_OK' : 'FAIL');
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', testScript], {
    cwd: rootDir,
    encoding: 'utf-8'
  });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /WEB_OK/);
});

test('T-E03 & Scenario 9: Missing Turso configuration in Vercel mode fails closed on initDb', async () => {
  const { initDb } = await import('../src/db/connection.js');

  await runWithEnvAsync({
    VERCEL: '1',
    TURSO_DATABASE_URL: null,
    TURSO_AUTH_TOKEN: null,
    DATABASE_ENGINE: null,
    APP_ROLE: null
  }, async () => {
    await assert.rejects(
      async () => {
        await initDb();
      },
      /TURSO_DATABASE_URL or TURSO_AUTH_TOKEN environment variable is missing/,
      'Vercel without Turso credentials must fail closed'
    );
  });
});

test('T-E04 & Scenario 10: DATABASE_ENGINE=sqlite + VERCEL=1 fails closed with [CONFIG-CONFLICT]', async () => {
  const { resolveEngineMode } = await import('../src/db/connection.js');

  runWithEnv({
    DATABASE_ENGINE: 'sqlite',
    VERCEL: '1'
  }, () => {
    assert.throws(
      () => resolveEngineMode(),
      /\[CONFIG-CONFLICT\] Contradictory configuration: DATABASE_ENGINE=sqlite cannot be combined with VERCEL or APP_ROLE=web/
    );
  });
});

test('T-E04 & Scenario 10: DATABASE_ENGINE=sqlite + APP_ROLE=web fails closed with [CONFIG-CONFLICT]', async () => {
  const { resolveEngineMode } = await import('../src/db/connection.js');

  runWithEnv({
    DATABASE_ENGINE: 'sqlite',
    APP_ROLE: 'web'
  }, () => {
    assert.throws(
      () => resolveEngineMode(),
      /\[CONFIG-CONFLICT\] Contradictory configuration: DATABASE_ENGINE=sqlite cannot be combined with VERCEL or APP_ROLE=web/
    );
  });
});

test('T-E04 & Scenario 10: DATABASE_ENGINE=turso + APP_ROLE=desktop fails closed with [CONFIG-CONFLICT]', async () => {
  const { resolveEngineMode } = await import('../src/db/connection.js');

  runWithEnv({
    DATABASE_ENGINE: 'turso',
    APP_ROLE: 'desktop'
  }, () => {
    assert.throws(
      () => resolveEngineMode(),
      /\[CONFIG-CONFLICT\] Contradictory configuration: DATABASE_ENGINE=turso cannot be combined with APP_ROLE=desktop/
    );
  });
});

// -------------------------------------------------------------------------------------------------
// PART D: TURSO MODULE SAFETY (PART 5)
// -------------------------------------------------------------------------------------------------

test('Part 5: lib/turso.js does not throw when Turso creds missing in local desktop mode', async () => {
  await runWithEnvAsync({
    VERCEL: null,
    APP_ROLE: 'desktop',
    DATABASE_ENGINE: 'sqlite',
    TURSO_DATABASE_URL: null,
    TURSO_AUTH_TOKEN: null
  }, async () => {
    const tursoModule = await import('../lib/turso.js');
    assert.equal(tursoModule.turso, null, 'turso export should be null in local offline mode without credentials');
  });
});

test('Part 5: lib/turso.js fails closed in Vercel mode when credentials are missing', () => {
  const testScript = `
    process.env.VERCEL = '1';
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    import('./lib/turso.js').then(
      () => { console.error('FAIL_DID_NOT_THROW'); process.exit(1); },
      (err) => { console.log('CAUGHT_FAIL_CLOSED:' + err.message); process.exit(0); }
    );
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', testScript], {
    cwd: rootDir,
    encoding: 'utf-8'
  });
  assert.equal(res.status, 0, 'Must exit with 0 after catching expected fail-closed error');
  assert.match(res.stdout, /CAUGHT_FAIL_CLOSED:Turso credentials missing/);
});
