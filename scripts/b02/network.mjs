// Trusted harness only; not a security sandbox for arbitrary application code.
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dns from 'node:dns';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';

let installed = false;
const leases = new Map();
export const audit = { connected: [], denied: 0 };
const deny = () => { audit.denied++; throw new Error('B02 network denied'); };
export function installNetworkBoundary() {
  if (installed) return;
  installed = true;
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const a = Array.isArray(args[0]) ? args[0] : args;
    const options = typeof a[0] === 'object' ? a[0] : { port: a[0], host: a[1] };
    const key = `http://${options.host}:${options.port}`;
    if (options.path || options.host !== '127.0.0.1' || !leases.has(key)) return deny();
    audit.connected.push(key);
    return connect.apply(this, args);
  };
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    const options = args[0];
    if (!options || typeof options !== 'object' || options.host !== '127.0.0.1' || options.port !== 0) return deny();
    return listen.apply(this, args);
  };
  https.request = https.get = tls.connect = dgram.createSocket = deny;
  dns.lookup = (host, options, callback) => {
    if (host !== '127.0.0.1') return deny();
    const done = typeof options === 'function' ? options : callback;
    queueMicrotask(() => options?.all ? done(null, [{ address: host, family: 4 }]) : done(null, host, 4));
  };
  dns.resolve = dns.resolve4 = dns.resolve6 = deny;
  dns.promises.lookup = dns.promises.resolve = dns.promises.resolve4 = dns.promises.resolve6 = deny;
  globalThis.fetch = deny;
  globalThis.WebSocket = class { constructor() { deny(); } };
  syncBuiltinESMExports();
}
export function lease(server) {
  if (!installed || !server.listening || server.address().address !== '127.0.0.1') return deny();
  const origin = `http://127.0.0.1:${server.address().port}`;
  leases.set(origin, server);
  server.once('close', () => leases.delete(origin));
  return origin;
}
export function request(config, url) {
  const u = new URL(url);
  if (!installed || u.username || u.password || u.hash || !config.allowedOrigins.includes(u.origin) || !leases.has(u.origin)) return Promise.reject(new Error('B02 network denied'));
  return new Promise((resolve, reject) => {
    const req = http.get(u, { agent: false, timeout: 3000 }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        // Redirects are never followed, even to an allowlisted host.
        if (res.statusCode !== 200) return reject(new Error('B02 response rejected'));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    req.on('timeout', () => req.destroy(new Error('B02 request timeout')));
    req.on('error', reject);
  });
}
