import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateTargets } from '../b01/targets.mjs';

const ownedRoots = new Set();
export function reject() { throw new Error('B02 harness target rejected'); }
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};
export function canonical(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) reject();
  for (let p = file; ; p = path.dirname(p)) {
    const stat = fs.lstatSync(p);
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) reject();
    if (p === path.dirname(p)) break;
  }
  return fs.realpathSync(file);
}
export function createRoot() {
  const root = canonical(fs.mkdtempSync(path.join(os.tmpdir(), 'erp-b01-b02-')));
  ownedRoots.add(root);
  return root;
}
export function assertOwned(root) {
  if (!ownedRoots.has(canonical(root))) reject();
}
export function validate(config) {
  try {
    if (!config || config.mode !== 'local-test' || config.cloud || config.token) reject();
    assertOwned(config.root);
    canonical(config.local);
    const target = validateTargets({ disposable: true, root: config.root, local: config.local });
    const userData = canonical(config.userData);
    const appData = canonical(config.appData);
    if (!fs.statSync(userData).isDirectory() || !fs.statSync(appData).isDirectory()) reject();
    if (!inside(target.root, userData) || !inside(target.root, appData) || userData === appData) reject();
    const url = new URL(config.apiBase);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || Number(url.port) < 1024 || url.pathname !== '/api' || url.username || url.password || url.search || url.hash) reject();
    if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.length !== 1 || config.allowedOrigins[0] !== url.origin) reject();
    return Object.freeze({ mode: 'local-test', root: target.root, local: target.local, userData, appData, apiBase: url.href, allowedOrigins: Object.freeze([url.origin]) });
  } catch { reject(); }
}
export function cleanEnvironment(config) {
  const c = validate(config);
  // No spread of the parent environment: no cloud credentials, mode flags,
  // proxies, NODE_OPTIONS, NODE_PATH, or Electron startup overrides inherited.
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec']) if (process.env[key]) env[key] = process.env[key];
  return { ...env, APPDATA: c.appData, LOCALAPPDATA: c.appData, USERPROFILE: c.root, HOME: c.root, TEMP: c.root, TMP: c.root, B02_CONFIG: JSON.stringify(c) };
}
export function cleanup(root, target = root) {
  assertOwned(root);
  const resolved = canonical(target);
  if (resolved !== root && !inside(root, resolved)) reject();
  // Validate the entire tree before deleting anything. No recursive shell command.
  const files = [], dirs = [];
  function visit(file) {
    const checked = canonical(file);
    if (checked !== root && !inside(root, checked)) reject();
    if (fs.lstatSync(file).isDirectory()) {
      for (const name of fs.readdirSync(file)) visit(path.join(file, name));
      dirs.push(file);
    } else files.push(file);
  }
  visit(resolved);
  for (const file of files) fs.unlinkSync(file);
  for (const dir of dirs) fs.rmdirSync(dir);
  if (resolved === root) ownedRoots.delete(root);
}
