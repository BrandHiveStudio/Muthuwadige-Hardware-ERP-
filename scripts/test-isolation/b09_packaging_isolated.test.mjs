// B09 Isolated Packaging Hardening & Release Gate Wiring Test Suite
// Verifies:
// 1. T-B09-01: Package Script Gating (verify:release-gate strictly required before dist, build:electron, package-win)
// 2. T-B09-02: Release Gate Execution & Integrity (verify_no_legacy_transactions.js AST auditor execution and pass)
// 3. T-B09-03: ASAR / Environment File Exclusion (build.files strictly excludes !**/.env* and !*.env, no .env inclusion)
// 4. T-B09-04: build-dist.js Secret & Environment Hardening (Zero hardcoded credentials, zero .env synthesis, inline gate check)
// 5. T-B09-05: preload.js CommonJS Compatibility (require('electron') normalized, contextBridge exposed, no ESM import)
// 6. T-B09-06: System Invariants (Version 1.0.0, B02 seedDefaultEnv, B03 127.0.0.1:5001 lock, Tax=0 freeze)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

test('B09 — Packaging Hardening & Release Gate Wiring Suite', async (t) => {

  // -------------------------------------------------------------------------
  // T-B09-01: Package Script Gating
  // -------------------------------------------------------------------------
  await t.test('T-B09-01: Package Script Gating (package.json pre-build wiring)', async () => {
    const pkgPath = path.resolve(projectRoot, 'package.json');
    assert.ok(fs.existsSync(pkgPath), 'package.json must exist');

    const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);

    assert.ok(pkg.scripts, 'package.json must define scripts');

    // 1. verify:release-gate script definition
    assert.equal(
      pkg.scripts['verify:release-gate'],
      'node scripts/verify_no_legacy_transactions.js',
      'verify:release-gate script must invoke node scripts/verify_no_legacy_transactions.js'
    );

    // 2. dist script pre-build gating and ordering
    const distScript = pkg.scripts['dist'];
    assert.ok(distScript, 'package.json must define dist script');
    const distCmds = distScript.split('&&').map((s) => s.trim());
    assert.equal(
      distCmds[0],
      'npm run verify:release-gate',
      'dist script must begin with npm run verify:release-gate as first command'
    );
    const distGateIdx = distCmds.indexOf('npm run verify:release-gate');
    const distBuildIdx = distCmds.indexOf('npm run build');
    const distPackagingIdx = distCmds.indexOf('node build-dist.js');
    assert.ok(distGateIdx !== -1, 'dist script must contain verify:release-gate');
    assert.ok(distBuildIdx !== -1, 'dist script must contain npm run build');
    assert.ok(distPackagingIdx !== -1, 'dist script must contain node build-dist.js');
    assert.ok(
      distGateIdx < distBuildIdx && distBuildIdx < distPackagingIdx,
      'dist script command order must be verify:release-gate -> build -> packaging'
    );

    // 3. build:electron script pre-build gating and ordering
    const buildElectronScript = pkg.scripts['build:electron'];
    assert.ok(buildElectronScript, 'package.json must define build:electron script');
    const buildElectronCmds = buildElectronScript.split('&&').map((s) => s.trim());
    assert.equal(
      buildElectronCmds[0],
      'npm run verify:release-gate',
      'build:electron script must begin with npm run verify:release-gate'
    );
    assert.ok(
      buildElectronCmds.indexOf('npm run verify:release-gate') < buildElectronCmds.indexOf('node build-dist.js'),
      'build:electron must execute verify:release-gate before node build-dist.js'
    );

    // 4. package-win script pre-build gating and ordering
    const packageWinScript = pkg.scripts['package-win'];
    assert.ok(packageWinScript, 'package.json must define package-win script');
    const packageWinCmds = packageWinScript.split('&&').map((s) => s.trim());
    assert.equal(
      packageWinCmds[0],
      'npm run verify:release-gate',
      'package-win script must begin with npm run verify:release-gate'
    );
    assert.ok(
      packageWinCmds.indexOf('npm run verify:release-gate') < packageWinCmds.indexOf('npm run build'),
      'package-win must execute verify:release-gate before npm run build'
    );
  });

  // -------------------------------------------------------------------------
  // T-B09-02: Release Gate Execution & Integrity
  // -------------------------------------------------------------------------
  await t.test('T-B09-02: Release Gate Execution & Integrity (verify_no_legacy_transactions.js)', async () => {
    const gateScriptPath = path.resolve(projectRoot, 'scripts', 'verify_no_legacy_transactions.js');
    assert.ok(fs.existsSync(gateScriptPath), 'scripts/verify_no_legacy_transactions.js must exist');

    // Execute the release gate scanner locally against repository source
    let output = '';
    let exitCode = 0;
    try {
      output = execSync('node scripts/verify_no_legacy_transactions.js', {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (err) {
      exitCode = err.status || 1;
      output = (err.stdout || '') + (err.stderr || '');
    }

    assert.equal(exitCode, 0, 'verify_no_legacy_transactions.js must exit with code 0');
    assert.ok(
      output.includes('RELEASE SAFETY GATE PASSED'),
      'verify_no_legacy_transactions.js output must declare RELEASE SAFETY GATE PASSED'
    );
    assert.ok(
      output.includes('0 unmanaged raw transaction strings or legacy helpers detected') ||
      output.includes('Zero unmanaged raw transaction strings or legacy helpers detected'),
      'verify_no_legacy_transactions.js must confirm 0 unmanaged raw transaction strings'
    );
  });

  // -------------------------------------------------------------------------
  // T-B09-03: ASAR / Environment File Exclusion
  // -------------------------------------------------------------------------
  await t.test('T-B09-03: ASAR / Environment File Exclusion (package.json build.files)', async () => {
    const pkgPath = path.resolve(projectRoot, 'package.json');
    const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);

    assert.ok(pkg.build, 'package.json must contain build configuration');
    assert.ok(Array.isArray(pkg.build.files), 'build.files must be an array of globs');

    const files = pkg.build.files;

    // 1. Must NOT include positive .env glob
    assert.ok(
      !files.includes('.env'),
      'build.files must NOT explicitly include .env'
    );
    assert.ok(
      !files.some((f) => f === '.env' || f === '**/.env' || f === './.env'),
      'build.files must not include un-negated .env paths'
    );

    // 2. Must explicitly exclude all environment file variants
    assert.ok(
      files.includes('!**/.env*'),
      'build.files must contain negative glob !**/.env* to exclude environment files in all subdirectories'
    );
    assert.ok(
      files.includes('!*.env'),
      'build.files must contain negative glob !*.env to exclude root environment files'
    );

    // 3. Must exclude raw database and journal files
    assert.ok(
      files.includes('!hardware.db*'),
      'build.files must contain negative glob !hardware.db*'
    );
    assert.ok(
      files.includes('!*.db'),
      'build.files must contain negative glob !*.db'
    );
    assert.ok(
      files.includes('!*.db-wal'),
      'build.files must contain negative glob !*.db-wal'
    );
    assert.ok(
      files.includes('!*.db-shm'),
      'build.files must contain negative glob !*.db-shm'
    );

    // 4. Must specify ASAR packaging
    assert.equal(pkg.build.asar, true, 'build.asar must be enabled');
  });

  // -------------------------------------------------------------------------
  // T-B09-04: build-dist.js Secret & Environment Hardening
  // -------------------------------------------------------------------------
  await t.test('T-B09-04: build-dist.js Secret & Environment Hardening (build-dist.js)', async () => {
    const buildDistPath = path.resolve(projectRoot, 'build-dist.js');
    assert.ok(fs.existsSync(buildDistPath), 'build-dist.js must exist');

    const content = fs.readFileSync(buildDistPath, 'utf-8');

    // 1. Mandatory release gate invocation within build-dist.js
    assert.ok(
      content.includes('scripts/verify_no_legacy_transactions.js'),
      'build-dist.js must invoke scripts/verify_no_legacy_transactions.js'
    );
    const gateIndex = content.indexOf('scripts/verify_no_legacy_transactions.js');
    const builderIndex = content.indexOf('electron-builder');
    assert.ok(
      gateIndex !== -1 && builderIndex !== -1 && gateIndex < builderIndex,
      'build-dist.js must execute verify_no_legacy_transactions.js BEFORE electron-builder'
    );

    // 2. Strict absence of hardcoded credentials and tokens
    assert.ok(
      !content.includes('eyJhbGciOiJFZERTQSIsIn'),
      'build-dist.js must NOT contain hardcoded JWT/Turso authentication tokens'
    );
    assert.ok(
      !content.includes('libsql://mwhardware-db-sanoj-hardware'),
      'build-dist.js must NOT contain hardcoded Turso database URLs'
    );
    assert.ok(
      !content.includes('muthuwadige_static_production_secret_key'),
      'build-dist.js must NOT contain static production JWT secrets'
    );
    assert.ok(
      !/TURSO_AUTH_TOKEN\s*=/.test(content),
      'build-dist.js must NOT contain TURSO_AUTH_TOKEN assignments'
    );
    assert.ok(
      !/TURSO_DATABASE_URL\s*=/.test(content),
      'build-dist.js must NOT contain TURSO_DATABASE_URL assignments'
    );
    assert.ok(
      !/JWT_SECRET\s*=/.test(content),
      'build-dist.js must NOT contain JWT_SECRET assignments'
    );

    // 3. Strict absence of .env copying or default .env synthesis
    assert.ok(
      !content.includes('fs.copyFileSync(sourceEnv, targetEnv)'),
      'build-dist.js must NOT copy local .env into package resources'
    );
    assert.ok(
      !content.includes('Seeding default .env into package resources'),
      'build-dist.js must NOT seed default .env into package resources'
    );
    assert.ok(
      !content.includes('Bundling .env into package resources'),
      'build-dist.js must NOT bundle .env into package resources'
    );
    assert.ok(
      !content.includes('fs.writeFileSync(targetEnv'),
      'build-dist.js must NOT write any environment file into package resources'
    );
  });

  // -------------------------------------------------------------------------
  // T-B09-05: preload.js CommonJS Compatibility
  // -------------------------------------------------------------------------
  await t.test('T-B09-05: preload.js CommonJS Compatibility (preload.js)', async () => {
    const preloadPath = path.resolve(projectRoot, 'preload.js');
    assert.ok(fs.existsSync(preloadPath), 'preload.js must exist');

    const content = fs.readFileSync(preloadPath, 'utf-8');

    // 1. CommonJS require usage
    assert.ok(
      /const\s*\{[^}]*contextBridge[^}]*\}\s*=\s*require\(['"]electron['"]\)/.test(content),
      'preload.js must use const { ... } = require("electron")'
    );

    // 2. Strict absence of ESM import syntax
    assert.ok(
      !/import\s*\{[^}]*\}\s*from\s*['"]electron['"]/.test(content),
      'preload.js must NOT use ESM import from "electron"'
    );

    // 3. Verification of exposed electronAPI contract
    assert.ok(
      content.includes("contextBridge.exposeInMainWorld('electronAPI',"),
      'preload.js must expose electronAPI via contextBridge'
    );
    const expectedApiMethods = [
      'openExternalUrl',
      'openExternal',
      'restartBackend',
      'checkBackendHealth',
      'clearRendererCache',
      'reload'
    ];
    for (const method of expectedApiMethods) {
      assert.ok(
        content.includes(`${method}:`),
        `preload.js electronAPI bridge must expose ${method}`
      );
    }
  });

  // -------------------------------------------------------------------------
  // T-B09-06: System Invariants
  // -------------------------------------------------------------------------
  await t.test('T-B09-06: System Invariants (Version 1.0.0, B02/B03/Tax Invariants)', async () => {
    // 1. package.json version is Golden Master 1.0.0
    const pkgPath = path.resolve(projectRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    assert.equal(pkg.version, '1.0.0', 'package.json version must be exactly 1.0.0');

    // 2. B02 external credential provisioning remains intact in electron-main.js
    const electronMainPath = path.resolve(projectRoot, 'electron-main.js');
    const electronMainContent = fs.readFileSync(electronMainPath, 'utf-8');
    assert.ok(
      electronMainContent.includes('function seedDefaultEnv('),
      'electron-main.js must preserve B02 seedDefaultEnv external credential discovery'
    );
    assert.ok(
      electronMainContent.includes('function getOrCreateMachineJwtSecret('),
      'electron-main.js must preserve B02 getOrCreateMachineJwtSecret'
    );

    // 3. B03 local authority lock remains intact in src/lib/api.ts
    const apiTsPath = path.resolve(projectRoot, 'src', 'lib', 'api.ts');
    const apiTsContent = fs.readFileSync(apiTsPath, 'utf-8');
    assert.ok(
      apiTsContent.includes('http://127.0.0.1:5001/api') || apiTsContent.includes("'http://127.0.0.1:5001/api'"),
      'src/lib/api.ts must preserve B03 Electron local authority lock on http://127.0.0.1:5001/api'
    );

    // 4. Tax remains frozen at 0 in settings and restore paths
    const settingsContextPath = path.resolve(projectRoot, 'src', 'context', 'SettingsContext.tsx');
    const settingsContextContent = fs.readFileSync(settingsContextPath, 'utf-8');
    assert.ok(
      /tax_rate:\s*0\b/.test(settingsContextContent),
      'src/context/SettingsContext.tsx must preserve frozen tax_rate: 0'
    );

    const backupWorkerPath = path.resolve(projectRoot, 'backup-worker.js');
    const backupWorkerContent = fs.readFileSync(backupWorkerPath, 'utf-8');
    assert.ok(
      /rawSettings\.tax_rate\s*=\s*0\b/.test(backupWorkerContent),
      'backup-worker.js must preserve frozen tax_rate: 0'
    );

    // 5. Accounting and financial calculation engines remain untouched
    const accountingPath = path.resolve(projectRoot, 'src', 'utils', 'sales', 'accounting.ts');
    assert.ok(fs.existsSync(accountingPath), 'src/utils/sales/accounting.ts must exist and remain untouched');

    const finEnginePath = path.resolve(projectRoot, 'src', 'utils', 'financialEngine.ts');
    assert.ok(fs.existsSync(finEnginePath), 'src/utils/financialEngine.ts must exist and remain untouched');

    // 6. Delta stock sync architecture remains intact
    const syncJsPath = path.resolve(projectRoot, 'src', 'services', 'syncService.js');
    const syncJsContent = fs.readFileSync(syncJsPath, 'utf-8');
    assert.ok(
      syncJsContent.includes('stock_adjustments') && syncJsContent.includes('delta'),
      'src/services/syncService.js must preserve delta stock sync architecture'
    );
  });
});
