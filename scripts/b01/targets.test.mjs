import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import { validateTargets, productionHosts, projectRoot } from './targets.mjs';
import { fingerprint, sha256 } from './schema.mjs';

// Empty SQLite fixture only: no tables, records, application initialization, or sockets.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-b01-'));
const local = path.join(root, 'disposable.sqlite');
const memory = new DatabaseSync(':memory:');
await backup(memory, local);
memory.close();
const config = { disposable: true, root, local };
const reject = candidate => assert.throws(() => validateTargets(candidate), /B01 target rejected/);

test('missing and ambiguous configurations fail closed', () => {
  for (const candidate of [undefined, {}, { ...config, disposable: false }, { ...config, local: undefined }, { ...config, local: './test.db' }, { ...config, root: os.tmpdir() }]) reject(candidate);
});
test('production Local and AppData paths are rejected', () => {
  reject({ ...config, local: path.join(projectRoot, 'hardware.db') });
  reject({ ...config, root: projectRoot, local: path.join(projectRoot, 'hardware.db') });
  reject({ ...config, local: path.join(process.env.APPDATA || os.homedir(), 'Muthuwadige Hardware ERP/hardware.db') });
  const reserved = path.join(root, 'hardware.db');
  fs.writeFileSync(reserved, 'reserved');
  reject({ ...config, local: reserved });
});
test('explicit disposable Local target is accepted without opening it', () => {
  assert.equal(validateTargets(config).local, fs.realpathSync(local));
});
test('disposable schema inspection preserves structure and bytes', () => {
  const before = fingerprint(local);
  const after = fingerprint(local);
  assert.deepEqual(after, before);
  assert.equal(after.filesUnchanged, true);
});
test('non-SQLite files and junction escapes are rejected', () => {
  const invalid = path.join(root, 'invalid.sqlite');
  fs.writeFileSync(invalid, 'not SQLite');
  reject({ ...config, local: invalid });
  fs.unlinkSync(invalid);
  const junction = path.join(root, 'project-link');
  fs.symlinkSync(projectRoot, junction, process.platform === 'win32' ? 'junction' : 'dir');
  try { reject({ ...config, local: path.join(junction, 'hardware.db') }); }
  finally { fs.unlinkSync(junction); }
});
test('HTTP targets including localhost are rejected', () => {
  for (const apiUrl of ['http://localhost:5001', 'http://127.0.0.1:5000', 'https://erp.mhardware.lk']) reject({ ...config, apiUrl });
});
test('hard-linked targets are rejected', () => {
  const linked = path.join(root, 'linked.sqlite');
  fs.linkSync(local, linked);
  try { reject(config); reject({ ...config, local: linked }); }
  finally { fs.unlinkSync(linked); }
});
test('cloud validation requires explicit test identity, allowlist, and separate token', () => {
  const prior = process.env.ERP_TEST_TURSO_AUTH_TOKEN;
  const host = 'b01-test-fixture.turso.io'; // configuration fixture only; never contacted
  const candidate = { ...config, cloud: { url: 'libsql://' + host, dedicatedTestDatabase: true, allowedHosts: [host] } };
  try {
    delete process.env.ERP_TEST_TURSO_AUTH_TOKEN;
    assert.throws(() => validateTargets(candidate, { cloud: true }), /rejected/);
    process.env.ERP_TEST_TURSO_AUTH_TOKEN = 'offline-validation-placeholder';
    assert.equal(validateTargets(candidate, { cloud: true }).cloudHost, host);
    reject(candidate); // cloud config cannot silently enter a Local-only check
    for (const cloud of [undefined, { ...candidate.cloud, dedicatedTestDatabase: false }, { ...candidate.cloud, allowedHosts: [] }, { ...candidate.cloud, url: 'http://localhost:5001' }, { ...candidate.cloud, url: 'libsql://default.turso.io' }]) {
      assert.throws(() => validateTargets({ ...config, cloud }, { cloud: true }), /rejected/);
    }
    for (const production of productionHosts()) {
      assert.throws(() => validateTargets({ ...config, cloud: { ...candidate.cloud, url: 'libsql://' + production, allowedHosts: [production] } }, { cloud: true }), /rejected/);
    }
  } finally {
    if (prior === undefined) delete process.env.ERP_TEST_TURSO_AUTH_TOKEN;
    else process.env.ERP_TEST_TURSO_AUTH_TOKEN = prior;
  }
});
test('legacy guards precede imports and cannot be bypassed by target environment', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'docs/b01/legacy-entrypoints.json'), 'utf8'));
  for (const entry of manifest) {
    const file = path.join(projectRoot, entry.file);
    if (!fs.existsSync(file) && entry.ignored) continue;
    assert.match(fs.readFileSync(file, 'utf8').split('\n')[0], /^(import|require\().*legacy-block\.cjs/);
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(sha256(content.slice(content.indexOf('\n') + 1)), entry.before);
  }
  // Execute only the four guarded tracked entry points. OS-process permission
  // restrictions additionally deny network, writes, addons, and child processes.
  for (const entry of manifest.filter(e => !e.ignored)) {
    const result = spawnSync(process.execPath, ['--permission', '--allow-fs-read=' + projectRoot, entry.file], {
      cwd: projectRoot, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', ERP_TEST_TARGETS: 'explicit-but-not-an-unlock' }
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /B01 BLOCKED/);
  }
});
test('runtime, package, and lockfile match the pre-implementation baseline', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(projectRoot, 'docs/b01/baseline-before.json'), 'utf8'));
  for (const [file, hash] of Object.entries(baseline.hashes)) {
    if (file !== 'src/types/index.ts') assert.equal(sha256(fs.readFileSync(path.join(projectRoot, file))), hash, file);
  }
});
test('missing CLI configuration fails closed', () => {
  const result = spawnSync(process.execPath, ['scripts/b01/check.mjs', 'targets'], { cwd: projectRoot, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /B01 target rejected/);
});
test.after(() => {
  // Delete only known fixture files, never recursively remove a computed directory.
  for (const name of ['disposable.sqlite', 'hardware.db']) fs.unlinkSync(path.join(root, name));
  fs.rmdirSync(root);
});
