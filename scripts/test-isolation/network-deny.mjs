// Test-only network denial preload for B04 isolation.
// Strictly limits networking to local loopback (127.0.0.1, localhost, ::1)
// required for in-process test servers (e.g. Express app.listen for PO receipt tests).
// Fails closed unconditionally if any non-loopback network, DNS, TLS, or external fetch is attempted.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';

// Helper to determine if a host string is strictly local loopback
function isStrictLoopbackHost(host) {
  if (typeof host !== 'string') return false;
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

const deny = (op) => () => {
  throw new Error(`B04 test isolation: network operation blocked (${op})`);
};

// Preserve original methods for loopback delegating
const origHttpRequest = http.request;
const origHttpGet = http.get;
const origNetConnect = net.connect;
const origNetCreateConnection = net.createConnection;
const origSocketConnect = net.Socket.prototype.connect;
const origFetch = globalThis.fetch;
const origDnsLookup = dns.lookup;

function parseSocketTarget(args) {
  let first = args[0];
  if (Array.isArray(first)) {
    first = first[0];
  }
  if (typeof first === 'object' && first !== null) {
    return first.host || first.hostname || (first.path ? '127.0.0.1' : null);
  }
  if (typeof first === 'number' || (typeof first === 'string' && !isNaN(Number(first)))) {
    if (typeof args[1] === 'string') {
      return args[1];
    }
    return '127.0.0.1';
  }
  return null;
}

// 1. TCP Sockets: permit strictly 127.0.0.1 / localhost / ::1
net.Socket.prototype.connect = function(...args) {
  const host = parseSocketTarget(args);
  if (!isStrictLoopbackHost(host)) {
    throw new Error(`B04 test isolation: outbound TCP blocked to non-loopback host "${host}"`);
  }
  return Reflect.apply(origSocketConnect, this, args);
};

net.connect = function(...args) {
  const host = parseSocketTarget(args);
  if (!isStrictLoopbackHost(host)) {
    throw new Error(`B04 test isolation: net.connect blocked to non-loopback host "${host}"`);
  }
  return Reflect.apply(origNetConnect, this, args);
};

net.createConnection = function(...args) {
  const host = parseSocketTarget(args);
  if (!isStrictLoopbackHost(host)) {
    throw new Error(`B04 test isolation: net.createConnection blocked to non-loopback host "${host}"`);
  }
  return Reflect.apply(origNetCreateConnection, this, args);
};

// 2. HTTP: permit strictly 127.0.0.1 / localhost / ::1
function parseHttpTarget(args) {
  if (typeof args[0] === 'string') {
    try {
      const parsed = new URL(args[0]);
      return { host: parsed.hostname, protocol: parsed.protocol };
    } catch {
      return { host: null, protocol: null };
    }
  }
  if (args[0] instanceof URL) {
    return { host: args[0].hostname, protocol: args[0].protocol };
  }
  if (typeof args[0] === 'object' && args[0] !== null) {
    const host = args[0].hostname || args[0].host;
    const protocol = args[0].protocol || 'http:';
    return { host, protocol };
  }
  return { host: null, protocol: null };
}

http.request = function(...args) {
  const { host, protocol } = parseHttpTarget(args);
  if (protocol && protocol !== 'http:') {
    throw new Error(`B04 test isolation: http.request blocked non-http protocol "${protocol}"`);
  }
  if (!isStrictLoopbackHost(host)) {
    throw new Error(`B04 test isolation: http.request blocked to non-loopback host "${host}"`);
  }
  return Reflect.apply(origHttpRequest, this, args);
};

http.get = function(...args) {
  const { host, protocol } = parseHttpTarget(args);
  if (protocol && protocol !== 'http:') {
    throw new Error(`B04 test isolation: http.get blocked non-http protocol "${protocol}"`);
  }
  if (!isStrictLoopbackHost(host)) {
    throw new Error(`B04 test isolation: http.get blocked to non-loopback host "${host}"`);
  }
  return Reflect.apply(origHttpGet, this, args);
};

// 3. HTTPS / TLS: UNCONDITIONALLY BLOCKED (all remote cloud/Turso/Vercel connections use HTTPS/TLS)
https.request = deny('https.request');
https.get = deny('https.get');
tls.connect = deny('tls.connect');
if (tls.TLSSocket && tls.TLSSocket.prototype) {
  tls.TLSSocket.prototype.connect = deny('tls.TLSSocket.prototype.connect');
}

// 4. UDP sockets: UNCONDITIONALLY BLOCKED
dgram.createSocket = deny('dgram.createSocket');

// 5. DNS: Strictly permit loopback resolution needed by net.Server.listen; block all external queries
dns.lookup = function(hostname, ...args) {
  if (!isStrictLoopbackHost(hostname)) {
    throw new Error(`B04 test isolation: DNS lookup blocked for host "${hostname}"`);
  }
  return Reflect.apply(origDnsLookup, dns, [hostname, ...args]);
};
dns.resolve = deny('dns.resolve');
dns.resolve4 = deny('dns.resolve4');
dns.resolve6 = deny('dns.resolve6');
if (dns.promises) {
  const origPromisesLookup = dns.promises.lookup;
  dns.promises.lookup = async function(hostname, ...args) {
    if (!isStrictLoopbackHost(hostname)) {
      throw new Error(`B04 test isolation: DNS lookup blocked for host "${hostname}"`);
    }
    return Reflect.apply(origPromisesLookup, dns.promises, [hostname, ...args]);
  };
  dns.promises.resolve = async () => { throw new Error('B04 test isolation: network operation blocked (dns.promises.resolve)'); };
  dns.promises.resolve4 = async () => { throw new Error('B04 test isolation: network operation blocked (dns.promises.resolve4)'); };
  dns.promises.resolve6 = async () => { throw new Error('B04 test isolation: network operation blocked (dns.promises.resolve6)'); };
}

// 6. Fetch API: permit strictly http://127.0.0.1:* / http://localhost:*
if (typeof origFetch === 'function') {
  globalThis.fetch = async function(input, init) {
    let urlString = '';
    if (typeof input === 'string') {
      urlString = input;
    } else if (input instanceof URL) {
      urlString = input.href;
    } else if (input && typeof input === 'object' && 'url' in input) {
      urlString = input.url;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      throw new Error(`B04 test isolation: fetch blocked invalid URL "${urlString}"`);
    }

    if (parsedUrl.protocol !== 'http:') {
      throw new Error(`B04 test isolation: fetch blocked non-http protocol "${parsedUrl.protocol}"`);
    }

    if (!isStrictLoopbackHost(parsedUrl.hostname)) {
      throw new Error(`B04 test isolation: fetch blocked to non-loopback host "${parsedUrl.hostname}"`);
    }

    return Reflect.apply(origFetch, globalThis, [input, init]);
  };
}

// 7. WebSockets: UNCONDITIONALLY BLOCKED
if (typeof globalThis.WebSocket !== 'undefined') {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error('B04 test isolation: network operation blocked (WebSocket)');
    }
  };
}

syncBuiltinESMExports();
