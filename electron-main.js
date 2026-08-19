import { app, BrowserWindow, shell, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// Ensure consistent production AppData directory path resolution
try {
  app.setName('Muthuwadige Hardware ERP');
  const prodUserData = path.join(app.getPath('appData'), 'Muthuwadige Hardware ERP');
  app.setPath('userData', prodUserData);
} catch (e) {}

// 1. Automatically start our local Express SQLite server!
import './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js') // Preload script for extra security if needed
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
  // We can check environment variable or command line arguments
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    // Load local Vite Dev Server
    mainWindow.loadURL('http://localhost:5173');
    // Open Developer Tools in development
    mainWindow.webContents.openDevTools();
  } else {
    // Load compiled production build
    // Use app.getAppPath() to get the correct path in packaged app
    const distPath = path.join(app.getAppPath(), 'dist/index.html');
    mainWindow.loadFile(distPath);
  }

  // Open all external links (https://, wa.me, etc.) in the system default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('wa.me')) {
      shell.openExternal(url);
    }
    return { action: 'deny' }; // Prevent Electron from opening a new window
  });

  // Also handle will-navigate to intercept anchor clicks and navigation attempts
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    // Allow local dev server and file:// paths, redirect everything else
    const isLocal = parsedUrl.hostname === 'localhost' || parsedUrl.protocol === 'file:';
    if (!isLocal) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

ipcMain.handle('open-external-url', async (event, url) => {
  console.log('[WhatsApp] 4. IPC open-external-url received in main process:', url);
  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL provided');
  }
  if (!url.startsWith('https://') && !url.startsWith('http://') && !url.startsWith('wa.me')) {
    throw new Error('Unsupported URL protocol');
  }
  try {
    console.log('[WhatsApp] 5. Executing shell.openExternal(url)');
    await shell.openExternal(url);
    console.log('[WhatsApp] 6. shell.openExternal completed successfully');
    return { success: true };
  } catch (err) {
    console.error('[WhatsApp] 6. Error executing shell.openExternal:', err);
    throw err;
  }
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
