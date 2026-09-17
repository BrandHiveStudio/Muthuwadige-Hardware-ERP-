import { app, BrowserWindow, shell, ipcMain, utilityProcess, dialog, powerMonitor } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';
import http from 'http';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enforce single-instance lock to prevent secondary processes from corrupting or locking hardware.db
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.warn('[Electron] Another instance of Muthuwadige Hardware ERP is already running. Quitting.');
  app.quit();
}

// Top-level startup crash guard & logging
process.on('uncaughtException', (error) => {
  console.error('CRITICAL UNCAUGHT EXCEPTION:', error);
  try {
    const userDataPath = app.getPath('userData') || path.join(process.env.APPDATA || '', 'Muthuwadige Hardware ERP');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    const logPath = path.join(userDataPath, 'crash-startup.log');
    fs.writeFileSync(logPath, `[${new Date().toISOString()}] Startup crash (uncaughtException): ${error.stack || error.message}\n`, { flag: 'a' });
  } catch (e) {
    console.error('Failed writing crash log:', e);
  }
  dialog.showErrorBox('Application Startup Error', error.stack || error.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('CRITICAL UNHANDLED REJECTION:', reason);
  try {
    const userDataPath = app.getPath('userData') || path.join(process.env.APPDATA || '', 'Muthuwadige Hardware ERP');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    const logPath = path.join(userDataPath, 'crash-startup.log');
    fs.writeFileSync(logPath, `[${new Date().toISOString()}] Startup rejection: ${reason?.stack || reason}\n`, { flag: 'a' });
  } catch (e) {
    console.error('Failed writing crash log:', e);
  }
});

/**
 * Resolves or safely generates a persistent machine-specific JWT secret.
 * Priority order:
 * 1. process.env.JWT_SECRET (if already set in environment)
 * 2. jwt.secret file in userData directory
 * 3. JWT_SECRET key in AppData .env file
 * 4. Generates a secure random 256-bit hex secret and persists it to jwt.secret and .env
 *
 * Invariants:
 * - Does NOT regenerate on restart (persistent).
 * - Does NOT overwrite an existing configured secret.
 * - Does NOT invalidate existing sessions.
 * - Unique per installation machine.
 */
function getOrCreateMachineJwtSecret(userDataPath) {
  try {
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length > 0) {
      return process.env.JWT_SECRET.trim();
    }
    const secretFile = path.join(userDataPath, 'jwt.secret');
    if (fs.existsSync(secretFile)) {
      const existing = fs.readFileSync(secretFile, 'utf-8').trim();
      if (existing.length > 0) {
        return existing;
      }
    }
    const envFile = path.join(userDataPath, '.env');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf-8');
      const match = content.match(/^JWT_SECRET=(.+)$/m);
      if (match && match[1].trim().length > 0) {
        const secret = match[1].trim();
        try { fs.writeFileSync(secretFile, secret, { encoding: 'utf-8' }); } catch (_) {}
        return secret;
      }
    }
    const newSecret = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(secretFile, newSecret, { encoding: 'utf-8' });
    } catch (_) {}
    return newSecret;
  } catch (err) {
    console.warn('[Electron] Notice resolving machine JWT secret:', err.message);
    return crypto.randomBytes(32).toString('hex');
  }
}

/**
 * Ensures an AppData .env configuration file exists with a persistent machine-specific JWT secret
 * and documented placeholders for optional cloud synchronization.
 * SECURITY: Never injects hardcoded Turso credentials or copies the developer's root .env.
 */
function seedDefaultEnv(userDataPath) {
  try {
    if (!userDataPath) return;
    const envFile = path.join(userDataPath, '.env');
    const machineSecret = getOrCreateMachineJwtSecret(userDataPath);

    // 1. External provisioning candidate discovery:
    // Look for installer / technician provisioned .env in executable directory or resources
    const candidatePaths = [
      process.resourcesPath ? path.join(process.resourcesPath, '.env') : null,
      process.resourcesPath ? path.join(process.resourcesPath, '..', '.env') : null,
      path.join(path.dirname(process.execPath || process.argv0 || ''), '.env'),
      path.join(process.cwd(), '.env'),
      path.join(__dirname, '..', '.env'),
      path.join(__dirname, '.env')
    ].filter(Boolean);

    let externalTursoUrl = '';
    let externalTursoToken = '';

    for (const cand of candidatePaths) {
      try {
        if (cand !== envFile && fs.existsSync(cand)) {
          const candContent = fs.readFileSync(cand, 'utf-8');
          const lines = candContent.split('\n');
          let u = '';
          let t = '';
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (line.startsWith('#')) continue;
            if (line.startsWith('TURSO_DATABASE_URL=')) {
              u = line.substring('TURSO_DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
            } else if (line.startsWith('TURSO_AUTH_TOKEN=')) {
              t = line.substring('TURSO_AUTH_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
            }
          }
          if (u && t && u.startsWith('libsql://') && !u.includes('your-database.turso.io')) {
            externalTursoUrl = u;
            externalTursoToken = t;
            console.log('✅ Discovered valid external Turso provisioning configuration from:', cand);
            break;
          }
        }
      } catch (_) {}
    }

    if (!fs.existsSync(envFile)) {
      const templateEnv = [
        '# Muthuwadige Hardware ERP - Local Environment Configuration',
        '# Local offline operations function without cloud or SMTP credentials.',
        '#',
        '# Optional: To enable cloud sync with Turso Cloud, specify your credentials below:',
        externalTursoUrl ? `TURSO_DATABASE_URL=${externalTursoUrl}` : '# TURSO_DATABASE_URL=libsql://your-database.turso.io',
        externalTursoToken ? `TURSO_AUTH_TOKEN=${externalTursoToken}` : '# TURSO_AUTH_TOKEN=your_turso_auth_token',
        '',
        '# Persistent Machine Secret for Local Session Authentication (Auto-generated)',
        `JWT_SECRET=${machineSecret}`,
        ''
      ].join('\n');
      fs.writeFileSync(envFile, templateEnv, 'utf-8');
      console.log('✅ Initialized AppData .env configuration with persistent machine JWT secret.');
    } else {
      let content = fs.readFileSync(envFile, 'utf-8');
      let updated = false;

      // If AppData .env only has placeholder or lacks active credentials, but external provisioning exists, adopt it
      const hasActiveTursoUrl = /^\s*TURSO_DATABASE_URL=libsql:\/\/(?!your-database\.turso\.io)/m.test(content);
      if (!hasActiveTursoUrl && externalTursoUrl && externalTursoToken) {
        if (/^\s*TURSO_DATABASE_URL=/m.test(content)) {
          content = content.replace(/^\s*TURSO_DATABASE_URL=.*$/m, `TURSO_DATABASE_URL=${externalTursoUrl}`);
        } else {
          content += `\nTURSO_DATABASE_URL=${externalTursoUrl}\n`;
        }
        if (/^\s*TURSO_AUTH_TOKEN=/m.test(content)) {
          content = content.replace(/^\s*TURSO_AUTH_TOKEN=.*$/m, `TURSO_AUTH_TOKEN=${externalTursoToken}`);
        } else {
          content += `\nTURSO_AUTH_TOKEN=${externalTursoToken}\n`;
        }
        updated = true;
        console.log('✅ Adopted externally provisioned Turso credentials into existing AppData .env');
      }

      if (!content.includes('JWT_SECRET=')) {
        content += `\nJWT_SECRET=${machineSecret}\n`;
        updated = true;
        console.log('✅ Added persistent machine JWT secret to existing AppData .env');
      }

      if (updated) {
        fs.writeFileSync(envFile, content, 'utf-8');
      }
    }

    // Also resolve credentials into process.env so startBackendServer inherits them immediately
    if (fs.existsSync(envFile)) {
      try {
        const activeContent = fs.readFileSync(envFile, 'utf-8');
        for (const rawLine of activeContent.split('\n')) {
          const line = rawLine.trim();
          if (line.startsWith('#')) continue;
          if (line.startsWith('TURSO_DATABASE_URL=')) {
            const val = line.substring('TURSO_DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
            if (val && !process.env.TURSO_DATABASE_URL) process.env.TURSO_DATABASE_URL = val;
          } else if (line.startsWith('TURSO_AUTH_TOKEN=')) {
            const val = line.substring('TURSO_AUTH_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
            if (val && !process.env.TURSO_AUTH_TOKEN) process.env.TURSO_AUTH_TOKEN = val;
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    console.error('❌ Failed to configure AppData .env:', err);
  }
}

// Ensure consistent production AppData directory path resolution
let USER_DATA_PATH = process.env.USER_DATA_PATH || '';
try {
  app.setName('Muthuwadige Hardware ERP');
  if (!USER_DATA_PATH) {
    const prodUserData = path.join(app.getPath('appData'), 'Muthuwadige Hardware ERP');
    app.setPath('userData', prodUserData);
    USER_DATA_PATH = prodUserData;
  } else {
    app.setPath('userData', USER_DATA_PATH);
  }
  if (!fs.existsSync(USER_DATA_PATH)) {
    fs.mkdirSync(USER_DATA_PATH, { recursive: true });
  }
  seedDefaultEnv(USER_DATA_PATH);
} catch (e) {
  console.error('Error configuring userData path:', e);
}

let mainWindow = null;
let serverProcess = null;

// Start backend Express SQLite server as an isolated child Node process
function startBackendServer() {
  const isPackaged = app.isPackaged;
  const serverPath = isPackaged
    ? path.join(app.getAppPath(), 'server.js')
    : path.join(__dirname, 'server.js');

  const machineSecret = getOrCreateMachineJwtSecret(USER_DATA_PATH || __dirname);

  const serverEnv = {
    ...process.env,
    NODE_ENV: isPackaged ? 'production' : (process.env.NODE_ENV || 'development'),
    JWT_SECRET: process.env.JWT_SECRET || machineSecret,
    DATABASE_ENGINE: 'sqlite',
    APP_ROLE: 'desktop'
  };

  // Sanitization: explicitly prevent inherited OS-level flags from converting the desktop process to cloud/serverless
  delete serverEnv.VERCEL;
  delete serverEnv.IS_WEB_CLIENT;

  if (process.env.TURSO_DATABASE_URL) {
    serverEnv.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
  }
  if (process.env.TURSO_AUTH_TOKEN) {
    serverEnv.TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;
  }

  if (USER_DATA_PATH) {
    serverEnv.USER_DATA_PATH = USER_DATA_PATH;
  }

  console.log('🚀 Spawning backend Express server child process...');
  console.log('   Server script:', serverPath);

  try {
    if (utilityProcess && typeof utilityProcess.fork === 'function') {
      serverProcess = utilityProcess.fork(serverPath, [], {
        env: serverEnv,
        stdio: 'pipe'
      });
    } else {
      serverProcess = fork(serverPath, [], {
        cwd: isPackaged ? app.getAppPath() : __dirname,
        env: { ...serverEnv, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      });
    }

    const pid = serverProcess ? serverProcess.pid : 'unknown';
    console.log(`✅ Backend server child process spawned with PID: ${pid}`);

    const logBackendMsg = (type, msg) => {
      if (USER_DATA_PATH) {
        try {
          fs.appendFileSync(path.join(USER_DATA_PATH, 'backend-process.log'), `[${new Date().toISOString()}] [Backend ${pid} ${type}] ${msg}\n`);
        } catch (_) {}
      }
    };

    if (serverProcess) {
      if (serverProcess.stdout) {
        serverProcess.stdout.on('data', (data) => {
          const msg = data.toString().trim();
          console.log(`[Backend ${pid}] ${msg}`);
          logBackendMsg('INFO', msg);
        });
      }

      if (serverProcess.stderr) {
        serverProcess.stderr.on('data', (data) => {
          const msg = data.toString().trim();
          console.error(`[Backend ${pid} ERROR] ${msg}`);
          logBackendMsg('ERROR', msg);
        });
      }

      serverProcess.on('exit', (code) => {
        const msg = `Process exited with code ${code}`;
        console.log(`[Backend ${pid}] ${msg}`);
        logBackendMsg('EXIT', msg);
        serverProcess = null;
      });
    }
  } catch (err) {
    console.error('❌ Failed to spawn backend process:', err);
    if (USER_DATA_PATH) {
      try {
        fs.appendFileSync(path.join(USER_DATA_PATH, 'backend-process.log'), `[${new Date().toISOString()}] [SPAWN ERROR] ${err.stack || err.message}\n`);
      } catch (_) {}
    }
  }
}

// Graceful backend process termination helper
function stopBackendServer() {
  if (serverProcess) {
    const pid = serverProcess.pid;
    console.log(`🛑 Terminating backend server child process (PID: ${pid})...`);
    try {
      if (typeof serverProcess.kill === 'function') {
        serverProcess.kill();
      }
    } catch (err) {
      console.error('Failed to kill backend server child process:', err);
    }
    serverProcess = null;
  }
}

// Wait until backend HTTP server is listening and ready on port 5001
function waitForServerReady(port = 5001, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      // Fail fast if backend process already exited
      if (!serverProcess && Date.now() - start > 500) {
        clearInterval(interval);
        console.error(`❌ Backend server process terminated prematurely before port ${port} became ready.`);
        if (USER_DATA_PATH) {
          try {
            fs.appendFileSync(path.join(USER_DATA_PATH, 'backend-process.log'), `[${new Date().toISOString()}] [CRITICAL] Backend process terminated before port ${port} was ready.\n`);
          } catch (_) {}
        }
        resolve(false);
        return;
      }

      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        clearInterval(interval);
        console.log(`✅ Backend server on port ${port} is ready! (${Date.now() - start}ms, status: ${res.statusCode})`);
        resolve(true);
      });

      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          clearInterval(interval);
          console.warn(`⚠️ Timeout waiting for backend server on port ${port}. Proceeding to launch UI.`);
          resolve(false);
        }
      });
      req.end();
    }, 250);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'Muthuwadige Hardware ERP',
    icon: path.join(__dirname, process.platform === 'win32' ? 'build/icon.ico' : 'public/images/logo.png')
  });

  // Enable Ctrl+Shift+I shortcut to toggle Developer Tools in all environments
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Determine if we are running in development or production
  const isDev = !app.isPackaged && process.env.NODE_ENV === 'development';

  if (isDev) {
    // Load local Vite Dev Server
    console.log('🌐 Development mode: loading http://localhost:5173');
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // Load compiled production build directly from app.getAppPath()
    const distPath = path.join(app.getAppPath(), 'dist', 'index.html');
    console.log('📦 Production mode: loading compiled file:', distPath);
    mainWindow.loadFile(distPath).catch(err => {
      console.error('❌ Failed to load dist/index.html via app.getAppPath(), trying __dirname fallback:', err);
      const fallbackPath = path.join(__dirname, 'dist', 'index.html');
      mainWindow.loadFile(fallbackPath);
    });
  }

  // Handle new window requests: allow printing and report popups, open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && (url.startsWith('https://') || (url.startsWith('http://') && !url.includes('localhost') && !url.includes('127.0.0.1')) || url.startsWith('wa.me'))) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        }
      }
    };
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const isLocal = parsedUrl.hostname === 'localhost' || parsedUrl.protocol === 'file:';
    if (!isLocal) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });

  mainWindow.on('close', (e) => {
    if (app.isQuitting) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Cancel', 'Exit Application'],
      defaultId: 0,
      cancelId: 0,
      title: 'Exit Confirmation',
      message: 'Are you sure you want to close Muthuwadige Hardware ERP?',
      detail: 'Make sure all active counter shifts are closed and pending transactions are saved before exiting.'
    });
    if (choice === 0) {
      e.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Restore & focus primary window if a second instance attempts to launch
app.on('second-instance', (event, commandLine, workingDirectory) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

// Re-verify backend database health and sync when PC wakes from sleep/hibernation
powerMonitor.on('resume', () => {
  console.log('[Electron] System resumed from sleep. Triggering database health check and sync reconnect.');
  http.get('http://localhost:5001/api/health', (res) => {
    console.log(`[Electron] Health check after sleep: status ${res.statusCode}`);
  }).on('error', (err) => {
    console.warn('[Electron] Health check warning on resume:', err.message);
  });
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('system:resume');
  }
});

app.whenReady().then(async () => {
  try {
    startBackendServer();
    await waitForServerReady(5001, 15000);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (err) {
    console.error('❌ Error during app.whenReady initialization:', err);
    try {
      const userDataPath = app.getPath('userData');
      const logPath = path.join(userDataPath, 'crash-startup.log');
      fs.writeFileSync(logPath, `[${new Date().toISOString()}] whenReady error: ${err.stack || err.message}\n`, { flag: 'a' });
    } catch (e) {}
    dialog.showErrorBox('Application Startup Error', err.stack || err.message);
  }
});

ipcMain.handle('open-external-url', async (event, url) => {
  console.log('[WhatsApp] IPC open-external-url received in main process:', url);
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL provided');
  }
  if (!url.startsWith('https://') && !url.startsWith('http://') && !url.startsWith('wa.me')) {
    throw new Error('Unsupported URL protocol');
  }
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    console.error('[WhatsApp] Error executing shell.openExternal:', err);
    throw err;
  }
});

let isRestartingBackend = false;

ipcMain.handle('restart-backend', async () => {
  if (isRestartingBackend) {
    console.log('[Recovery] Backend restart already in progress. Skipping duplicate restart request.');
    return { success: true, message: 'Backend restart already in progress' };
  }
  isRestartingBackend = true;
  console.log('[Recovery] 🔄 Tier 2 Backend Restart requested by renderer...');
  try {
    stopBackendServer();
    await new Promise(r => setTimeout(r, 200));
    startBackendServer();
    const ready = await waitForServerReady(5001, 15000);
    console.log(`[Recovery] Backend restart completed. Ready status: ${ready}`);
    return { success: ready, ready };
  } catch (err) {
    console.error('[Recovery] Error restarting backend process:', err);
    return { success: false, error: err.message };
  } finally {
    isRestartingBackend = false;
  }
});

ipcMain.handle('check-backend-health', async () => {
  return await waitForServerReady(5001, 1500);
});

ipcMain.handle('clear-renderer-cache', async () => {
  try {
    if (mainWindow && mainWindow.webContents) {
      await mainWindow.webContents.session.clearCache();
    }
    return { success: true };
  } catch (err) {
    console.error('Error clearing renderer cache:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('reload-window', async () => {
  try {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.reload();
    }
    return { success: true };
  } catch (err) {
    console.error('Error reloading window:', err);
    return { success: false, error: err.message };
  }
});

app.on('before-quit', () => {
  stopBackendServer();
});

app.on('will-quit', () => {
  stopBackendServer();
});

app.on('window-all-closed', () => {
  stopBackendServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

