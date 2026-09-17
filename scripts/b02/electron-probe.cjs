'use strict';
/* eslint-disable @typescript-eslint/no-var-requires */
// Electron's standalone CJS bootstrap uses require before asynchronous ESM helpers.
// Standalone trusted test shell. NEVER imports electron-main.js, server.js, or ERP UI.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');
let stage = 'imports';
const observed = [];
let diagnosticSequence = 0;
function record(event, fields = {}) {
  // Only call with explicitly selected fields; never log Error objects or URLs verbatim.
  try {
    console.log('B02_EVENT ' + JSON.stringify({ source: 'electron', sequence: ++diagnosticSequence, timestamp: Date.now(), event, ...fields }));
  } catch { /* Diagnostics must not change navigation or permission decisions. */ }
}
const diagnosticCode = value => typeof value === 'string' && /^ERR_[A-Z0-9_]{1,64}$/.test(value) ? value : 'REDACTED';

async function main() {
  const { canonical } = await import('./safety.mjs');
  const { installNetworkBoundary } = await import('./network.mjs');
  installNetworkBoundary(); // Node sockets default-denied; no leases in this process.
  stage = 'configuration';
  const c = JSON.parse(process.env.B02_CONFIG || 'null');
  if (!c || c.mode !== 'local-test') throw new Error('Invalid probe configuration');
  const root = canonical(c.root);
  if (!path.basename(root).startsWith('erp-b01-b02-') || canonical(process.env.TEMP) !== root) throw new Error('Invalid probe root');
  for (const [key, name] of [['local', 'disposable.sqlite'], ['userData', 'electron-user-data'], ['appData', 'app-data']]) {
    if (canonical(c[key]) !== path.join(root, name)) throw new Error('Invalid probe path');
  }
  if (process.env.APPDATA !== c.appData || process.env.LOCALAPPDATA !== c.appData) throw new Error('Invalid AppData redirect');
  const u = new URL(c.apiBase);
  if (u.protocol !== 'http:' || u.hostname !== '127.0.0.1' || !u.port || u.pathname !== '/api' || u.username || u.password || u.search || u.hash || c.allowedOrigins?.length !== 1 || c.allowedOrigins[0] !== u.origin) throw new Error('Invalid probe host');
  if (fs.readFileSync(c.local).subarray(0, 16).toString('binary') !== 'SQLite format 3\u0000') throw new Error('Invalid SQLite fixture');
  app.setName('ERP B02 Isolated Probe');
  app.setPath('appData', c.appData);
  app.setPath('userData', c.userData);
  app.setPath('sessionData', c.userData);
  app.setPath('crashDumps', c.userData);
  stage = 'ready';
  await app.whenReady();
  const isolated = session.fromPartition('b02-memory-only');
  await isolated.setProxy({ mode: 'direct' });
  const allowedUrl = c.apiBase + '/probe';
  isolated.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url === allowedUrl;
    observed.push({ allowed, target: allowed ? allowedUrl : 'DENIED' });
    record('before-request', { allowed, target: allowed ? 'owned-loopback-probe' : 'REDACTED' });
    callback({ cancel: !allowed });
  });
  isolated.setPermissionRequestHandler((_webContents, permission, callback) => {
    record('permission-request', { permission: typeof permission === 'string' && /^[a-z-]{1,64}$/.test(permission) ? permission : 'REDACTED', granted: false });
    callback(false);
  });
  const window = new BrowserWindow({ show: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== allowedUrl) event.preventDefault(); });
  for (const event of ['did-start-loading', 'did-finish-load', 'dom-ready']) {
    window.webContents.on(event, () => record(event));
  }
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    record('did-fail-load', {
      errorCode: Number.isInteger(errorCode) ? errorCode : null,
      errorDescription: diagnosticCode(errorDescription),
      validatedURL: validatedURL === allowedUrl ? 'owned-loopback-probe' : 'REDACTED',
      isMainFrame: Boolean(isMainFrame)
    });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    const reasons = ['clean-exit', 'abnormal-exit', 'killed', 'crashed', 'oom', 'launch-failed', 'integrity-failure', 'memory-eviction'];
    record('render-process-gone', { reason: reasons.includes(details.reason) ? details.reason : 'REDACTED', exitCode: Number.isInteger(details.exitCode) ? details.exitCode : null });
  });
  stage = 'load';
  record('load-url-called', { target: 'owned-loopback-probe' });
  await window.loadURL(allowedUrl);
  record('load-url-resolved');
  stage = 'response';
  const result = JSON.parse(await window.webContents.executeJavaScript('document.body.innerText'));
  if (result.database !== c.local || result.apiBase !== c.apiBase || result.userData !== c.userData || app.getPath('userData') !== c.userData || app.getPath('appData') !== c.appData) throw new Error('Probe target mismatch');
  console.log('B02_RESULT ' + JSON.stringify({ ...result, appData: app.getPath('appData'), observed }));
  window.destroy();
  app.exit(0);
}
const timer = setTimeout(() => app.exit(2), 15000);
timer.unref();
main().catch(error => {
  const code = /^ERR_[A-Z_]+$/.test(error?.code || '') ? error.code : 'UNKNOWN';
  record('probe-failed', { stage, errorCode: diagnosticCode(error?.code) });
  console.log('B02_FAILURE ' + stage + ' ' + code);
  console.log('B02_OBSERVATIONS ' + JSON.stringify(observed));
  app.exit(1);
});
