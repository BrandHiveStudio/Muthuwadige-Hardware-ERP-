import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { errorMonitor } from 'node:events';
import { DatabaseSync, backup } from 'node:sqlite';
import { createRoot, validate, cleanup } from './safety.mjs';
import { installNetworkBoundary, lease } from './network.mjs';
import { fingerprint } from '../b01/schema.mjs';

export async function createHarness() {
  installNetworkBoundary();
  const root = createRoot();
  const local = path.join(root, 'disposable.sqlite');
  const userData = path.join(root, 'electron-user-data');
  const appData = path.join(root, 'app-data');
  fs.mkdirSync(userData); fs.mkdirSync(appData);
  // Empty SQLite fixture: no application schema, records, seed, or migration.
  const memory = new DatabaseSync(':memory:');
  try { await backup(memory, local); } finally { memory.close(); }
  let config;
  const requests = [];
  const diagnostics = [];
  function record(event, requestId, fields = {}) {
    try {
      const entry = { source: 'http', sequence: diagnostics.length + 1, timestamp: Date.now(), event, requestId, ...fields };
      diagnostics.push(entry);
      console.log('B02_HTTP ' + JSON.stringify(entry));
    } catch { /* Diagnostic failures must not change the probe response. */ }
  }
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, probe: req.url === '/api/probe' });
    const requestId = requests.length;
    if (req.url === '/api/probe') {
      record('request-received', requestId, { method: req.method === 'GET' ? 'GET' : 'OTHER' });
      res.once('finish', () => record('response-finished', requestId, { statusCode: res.statusCode, writableFinished: res.writableFinished }));
      res.once('close', () => record('response-close', requestId, { premature: !res.writableFinished }));
      req.once('aborted', () => record('request-aborted', requestId));
      req.socket.once('close', hadError => record('socket-close', requestId, { hadError }));
      for (const [source, emitter] of [['request', req], ['response', res], ['socket', req.socket]]) {
        // errorMonitor observes errors without consuming/changing existing error handling.
        emitter.once(errorMonitor, error => record(source + '-error', requestId, {
          code: typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : 'REDACTED'
        }));
      }
    }
    if (req.method !== 'GET' || req.headers.host !== new URL(config.apiBase).host) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Security-Policy', "default-src 'none'; connect-src 'self'");
    if (req.url === '/api/probe') {
      // Plain text avoids Chromium's JSON-viewer/extension machinery in the probe.
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      const body = JSON.stringify({ mode: config.mode, database: config.local, apiBase: config.apiBase, userData: config.userData, schema: fingerprint(config.local).fingerprint });
      record('response-start-requested', requestId, { statusCode: res.statusCode });
      res.end(body);
      record('response-end-returned', requestId, { headersSent: res.headersSent, writableEnded: res.writableEnded });
    } else if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'https://blocked.invalid/' }).end();
    } else res.writeHead(404).end();
  });
  server.on('connect', (_req, socket) => socket.destroy());
  server.on('upgrade', (_req, socket) => socket.destroy());
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: 0 }, resolve); });
    const origin = lease(server);
    config = validate({ mode: 'local-test', root, local, userData, appData, apiBase: origin + '/api', allowedOrigins: [origin] });
    return { config, server, requests, diagnostics, async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      cleanup(root);
    } };
  } catch (error) {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    cleanup(root);
    throw error;
  }
}
