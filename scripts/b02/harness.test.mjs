import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { projectRoot } from '../b01/targets.mjs';
import { fingerprint } from '../b01/schema.mjs';
import { validate, cleanup, cleanEnvironment } from './safety.mjs';
import { createHarness } from './harness.mjs';
import { request, audit } from './network.mjs';
import { probeElectron } from './electron.mjs';

const harness = await createHarness();
const c = harness.config;
const reject = value => assert.throws(() => validate(value), /rejected/);
test('T-H01 missing/invalid explicit configuration fails closed', () => {
  for (const value of [null, {}, { ...c, mode: undefined }, { ...c, mode: 'online' }, { ...c, apiBase: undefined }]) reject(value);
});
test('T-H02 project/default database rejected', () => {
  reject({ ...c, local: path.join(projectRoot, 'hardware.db') });
  reject({ ...c, local: path.join(projectRoot, 'hardware_erp.db') });
});
test('T-H03 real Electron AppData database rejected without opening', () => {
  reject({ ...c, local: path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP/hardware.db') });
});
test('T-H04 all production/cloud hosts rejected', () => {
  for (const apiBase of ['https://erp.mhardware.lk/api', 'libsql://default.turso.io', 'https://test.turso.io/api']) reject({ ...c, apiBase });
});
test('T-H05 disposable SQLite accepted; read-only probe preserves bytes/schema', async () => {
  assert.equal(validate(c).local, c.local);
  const before = fingerprint(c.local);
  const result = JSON.parse(await request(c, c.apiBase + '/probe'));
  assert.equal(result.database, c.local);
  assert.deepEqual(fingerprint(c.local), before);
});
test('T-H06 disposable Electron paths accepted; inherited environment excluded', () => {
  const env = cleanEnvironment(c);
  assert.equal(env.APPDATA, c.appData);
  assert.equal(env.LOCALAPPDATA, c.appData);
  assert.equal(validate(c).userData, c.userData);
  for (const key of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'VERCEL', 'APP_ROLE', 'DATABASE_ENGINE', 'NODE_OPTIONS', 'HTTP_PROXY']) assert.equal(env[key], undefined);
});
test('T-H07 owned loopback server accepted; unleased localhost and redirects rejected', async () => {
  assert.equal(JSON.parse(await request(c, c.apiBase + '/probe')).mode, 'local-test');
  await assert.rejects(request(c, 'http://127.0.0.1:5001/api'), /denied/);
  await assert.rejects(request(c, c.allowedOrigins[0] + '/redirect'), /rejected/);
});
test('T-H08 LAN targets rejected, even if explicitly listed', () => {
  reject({ ...c, apiBase: 'http://192.168.1.10:5001/api', allowedOrigins: ['http://192.168.1.10:5001'] });
});
test('T-H09 junction, hard-link and parent escapes rejected', () => {
  reject({ ...c, local: c.root + '/child/../disposable.sqlite' });
  const linked = path.join(c.root, 'linked.sqlite');
  fs.linkSync(c.local, linked);
  try { reject({ ...c, local: linked }); reject(c); } finally { fs.unlinkSync(linked); }
  const junction = path.join(c.root, 'escape');
  fs.symlinkSync(projectRoot, junction, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    reject({ ...c, local: path.join(junction, 'hardware.db') });
    assert.throws(() => cleanup(c.root), /rejected/);
    assert.equal(fs.existsSync(c.local), true);
  } finally { fs.unlinkSync(junction); }
});
test('T-H10 cleanup outside owned root rejected', () => {
  assert.throws(() => cleanup(c.root, projectRoot), /rejected/);
  assert.throws(() => cleanup(projectRoot), /rejected/);
});
test('T-E01–04 standalone Electron shell uses disposable profile/backend and records targets', async () => {
  let result;
  try { result = await probeElectron(c); }
  catch (error) { throw new Error(error.message + '; server requests=' + harness.requests.length); }
  assert.equal(result.userData, c.userData);
  assert.equal(result.appData, c.appData);
  assert.equal(result.database, c.local);
  assert.equal(result.apiBase, c.apiBase);
  assert.equal(result.mode, 'local-test');
  assert.ok(result.observed.some(entry => entry.allowed));
  assert.ok(result.observed.every(entry => !entry.allowed || entry.target === c.apiBase + '/probe'));
});
test('T-H11 network boundary denies raw sockets/fetch before connection', async () => {
  assert.throws(() => net.connect({ host: '203.0.113.1', port: 443 }), /denied/);
  assert.throws(() => fetch('https://blocked.invalid'), /denied/);
  await assert.rejects(request(c, 'https://erp.mhardware.lk/api'), /denied/);
  assert.ok(audit.connected.length > 0);
  assert.ok(audit.connected.every(origin => origin === c.allowedOrigins[0]));
});
test.after(async () => { await harness.close(); });
