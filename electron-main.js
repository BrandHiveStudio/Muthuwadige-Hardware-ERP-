import { app, BrowserWindow, shell, ipcMain, utilityProcess, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';
import http from 'http';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Ensure consistent production AppData directory path resolution
let USER_DATA_PATH = '';
try {
  app.setName('Muthuwadige Hardware ERP');
  const prodUserData = path.join(app.getPath('appData'), 'Muthuwadige Hardware ERP');
  app.setPath('userData', prodUserData);
  USER_DATA_PATH = prodUserData;
  if (!fs.existsSync(USER_DATA_PATH)) {
    fs.mkdirSync(USER_DATA_PATH, { recursive: true });
  }
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

  const serverEnv = {
    ...process.env,
    NODE_ENV: isPackaged ? 'production' : (process.env.NODE_ENV || 'development')
  };

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

    if (serverProcess) {
      if (serverProcess.stdout) {
        serverProcess.stdout.on('data', (data) => {
          console.log(`[Backend ${pid}] ${data.toString().trim()}`);
        });
      }

      if (serverProcess.stderr) {
        serverProcess.stderr.on('data', (data) => {
          console.error(`[Backend ${pid} ERROR] ${data.toString().trim()}`);
        });
      }

      serverProcess.on('exit', (code) => {
        console.log(`[Backend ${pid}] Process exited with code ${code}`);
        serverProcess = null;
      });
    }
  } catch (err) {
    console.error('❌ Failed to spawn backend process:', err);
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
      const req = http.get(`http://127.0.0.1:${port}/api/settings`, (res) => {
        clearInterval(interval);
        console.log(`✅ Backend server on port ${port} is ready! (${Date.now() - start}ms)`);
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

  // Open all external links (https://, wa.me, etc.) in the system default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('wa.me')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    const isLocal = parsedUrl.hostname === 'localhost' || parsedUrl.protocol === 'file:';
    if (!isLocal) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

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

