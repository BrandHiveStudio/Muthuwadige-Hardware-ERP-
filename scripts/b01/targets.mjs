// Verification-only: never import runtime connections, dotenv, or application modules.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fail = () => { throw new Error('B01 target rejected: explicit disposable Local target and, for cloud checks, approved test-host configuration required.'); };
const inside = (root, target) => { const r = path.relative(root, target); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };

function canonical(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return fail();
  const result = fs.realpathSync(value);
  // Reject junctions/symlinks in every path component, not just the leaf.
  for (let p = path.resolve(value); ; p = path.dirname(p)) {
    if (fs.lstatSync(p).isSymbolicLink()) return fail();
    if (p === path.dirname(p)) break;
  }
  return result;
}

export function productionHosts() {
  const files = ['src/db/connection.js', 'src/services/syncService.js', 'electron-main.js', '.env']
    .map(p => path.join(projectRoot, p));
  files.push(path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'Muthuwadige Hardware ERP/.env'));
  const hosts = new Set();
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:libsql|https?):\/\/([a-z0-9.-]+)/gi)) hosts.add(match[1].toLowerCase());
  }
  return hosts;
}

export function validateTargets(config, { cloud = false } = {}) {
  try {
    if (!config || config.disposable !== true) return fail();
    const root = canonical(config.root);
    const local = canonical(config.local);
    const temp = fs.realpathSync(os.tmpdir());
    if (!inside(temp, root) || !path.basename(root).startsWith('erp-b01-') || inside(projectRoot, root)) return fail();
    if (!inside(root, local) || !fs.statSync(local).isFile() || fs.statSync(local).nlink !== 1) return fail();
    const fd = fs.openSync(local, 'r');
    const header = Buffer.alloc(16);
    try { fs.readSync(fd, header, 0, 16, 0); } finally { fs.closeSync(fd); }
    if (header.toString('binary') !== 'SQLite format 3\u0000') return fail();
    const appData = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData/Roaming'), 'Muthuwadige Hardware ERP');
    if (inside(appData, local) || /^(hardware|hardware_erp)\.db$/i.test(path.basename(local))) return fail();
    // No API target is supported in B01: localhost is not evidence of isolation.
    if (config.apiUrl || config.endpoint) return fail();
    let host;
    if (cloud) {
      if (config.cloud?.dedicatedTestDatabase !== true || !process.env.ERP_TEST_TURSO_AUTH_TOKEN?.trim()) return fail();
      const url = new URL(config.cloud.url);
      host = url.hostname.toLowerCase();
      if (!['libsql:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash || !['', '/'].includes(url.pathname)) return fail();
      if (!host.endsWith('.turso.io') || !/(^|[.-])test([.-]|$)/.test(host)) return fail();
      if (!Array.isArray(config.cloud.allowedHosts) || config.cloud.allowedHosts.length !== 1 || config.cloud.allowedHosts[0] !== host) return fail();
      for (const production of productionHosts()) {
        if (host === production || host.split('.')[0] === production.split('.')[0]) return fail();
      }
    } else if (config.cloud) return fail();
    return Object.freeze({ local, root, ...(host ? { cloudHost: host } : {}) });
  } catch {
    return fail(); // Never echo supplied URLs, paths, tokens, or underlying exceptions.
  }
}

export function loadTargets(file, options) {
  try {
    if (!file) return fail();
    return validateTargets(JSON.parse(fs.readFileSync(file, 'utf8')), options);
  } catch { return fail(); }
}
