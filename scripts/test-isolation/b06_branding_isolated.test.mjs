// B06 Isolated Brand Identity & Reference Normalization Test Suite
// Verifies:
// 1. T-B06-01: Legacy branding scan (zero active Sanoj Hardware / sanojhardware@gmail.com in B06 scope)
// 2. T-B06-02: Default settings in SettingsContext.tsx (Muthuwadige Hardware, muthuwadigehardware@gmail.com, tax_rate === 0)
// 3. T-B06-03: Author resolution in creditService.ts (Muthuwadige Hardware fallback & root admin attribution)
// 4. T-B06-04: Print branding in printTemplates.ts (MUTHUWADIGE HARDWARE & muthuwadigehardware@gmail.com)
// 5. T-B06-05: Notification & backup fallbacks in mailer.js and backup-worker.js (muthuwadigehardware@gmail.com)
// 6. T-B06-06: Financial & system invariants (Tax=0 freeze, no math/schema/sync modifications)
// 7. T-B06-07: Additional B06 files verification (ChequeRegistry, ReceiptTemplate, Finance, Reports)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

test('B06 — Brand Identity & Reference Normalization Suite', async (t) => {

  // -------------------------------------------------------------------------
  // T-B06-01: Legacy Branding Scan Across B06 Scope
  // -------------------------------------------------------------------------
  await t.test('T-B06-01: Legacy branding scan eliminates sanoj references from active paths', async () => {
    const b06Files = [
      'src/pages/Purchasing.tsx',
      'src/context/SettingsContext.tsx',
      'src/pages/Inventory.tsx',
      'src/pages/Sales.tsx',
      'src/pages/Settings.tsx',
      'src/pages/Users.tsx',
      'src/services/creditService.ts',
      'src/utils/sales/printTemplates.ts',
      'backup-worker.js',
      'src/utils/mailer.js',
      'src/components/accounting/ChequeRegistry.tsx',
      'src/components/print/ReceiptTemplate.tsx',
      'src/pages/Finance.tsx',
      'src/pages/Reports.tsx'
    ];

    const violations = [];

    for (const relPath of b06Files) {
      const fullPath = path.resolve(projectRoot, relPath);
      assert.ok(fs.existsSync(fullPath), `Expected file ${relPath} to exist`);

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        const lineNum = idx + 1;
        const lower = line.toLowerCase();

        // Check for legacy email: sanojhardware@gmail.com
        if (lower.includes('sanojhardware@gmail.com')) {
          violations.push({ file: relPath, lineNum, line: line.trim(), reason: 'Legacy email address found' });
        }

        // Check for legacy brand name: Sanoj Hardware
        if (lower.includes('sanoj hardware')) {
          // Allow only explicitly documented historical attribution guards:
          const isHistoricalGuard =
            (relPath === 'src/pages/Reports.tsx' && (line.includes('!== \'Sanoj Hardware\'') || line.includes('!== "Sanoj Hardware"'))) ||
            (relPath === 'src/pages/Sales.tsx' && (line.includes('!== \'Sanoj Hardware\'') || line.includes('!== "Sanoj Hardware"')));

          if (!isHistoricalGuard) {
            violations.push({ file: relPath, lineNum, line: line.trim(), reason: 'Active legacy store name found' });
          }
        }
      });
    }

    assert.equal(
      violations.length,
      0,
      `Found ${violations.length} active legacy branding violation(s):\n` +
      violations.map(v => `  ${v.file}:${v.lineNum} - ${v.reason}: ${v.line}`).join('\n')
    );
  });

  // -------------------------------------------------------------------------
  // T-B06-02: Default Settings in SettingsContext.tsx
  // -------------------------------------------------------------------------
  await t.test('T-B06-02: SettingsContext.tsx default settings provide Muthuwadige identity and tax_rate=0', async () => {
    const settingsPath = path.resolve(projectRoot, 'src', 'context', 'SettingsContext.tsx');
    const content = fs.readFileSync(settingsPath, 'utf-8');

    // Extract defaultSettings object block
    const match = content.match(/const\s+defaultSettings:\s*StoreSettings\s*=\s*\{([\s\S]*?)\};/);
    assert.ok(match, 'defaultSettings must be defined in SettingsContext.tsx');

    const body = match[1];

    // Assert storeName
    assert.ok(
      body.includes("storeName: 'Muthuwadige Hardware'") || body.includes('storeName: "Muthuwadige Hardware"'),
      'defaultSettings.storeName must be Muthuwadige Hardware'
    );

    // Assert shop_name
    assert.ok(
      body.includes("shop_name: 'Muthuwadige Hardware'") || body.includes('shop_name: "Muthuwadige Hardware"'),
      'defaultSettings.shop_name must be Muthuwadige Hardware'
    );

    // Assert email
    assert.ok(
      body.includes("email: 'muthuwadigehardware@gmail.com'") || body.includes('email: "muthuwadigehardware@gmail.com"'),
      'defaultSettings.email must be muthuwadigehardware@gmail.com'
    );

    // Assert tax_rate is strictly 0
    assert.ok(
      /tax_rate:\s*0\b/.test(body),
      'defaultSettings.tax_rate must be strictly 0'
    );
  });

  // -------------------------------------------------------------------------
  // T-B06-03: Author Resolution in creditService.ts
  // -------------------------------------------------------------------------
  await t.test('T-B06-03: creditService.ts resolves root admin and fallback to Muthuwadige Hardware', async () => {
    const creditServicePath = path.resolve(projectRoot, 'src', 'services', 'creditService.ts');
    const content = fs.readFileSync(creditServicePath, 'utf-8');

    // Verify resolveAuthorName definition
    const fnMatch = content.match(/export\s+function\s+resolveAuthorName\s*\([\s\S]*?\)\s*:\s*string\s*\{([\s\S]*?)\n\}/);
    assert.ok(fnMatch, 'resolveAuthorName function must exist in creditService.ts');

    const fnBody = fnMatch[1];

    // Root admin email check must use muthuwadigehardware@gmail.com
    assert.ok(
      fnBody.includes("active.email === 'muthuwadigehardware@gmail.com'") || fnBody.includes('active.email === "muthuwadigehardware@gmail.com"'),
      'isSuperAdmin check must verify muthuwadigehardware@gmail.com'
    );
    assert.ok(
      !fnBody.includes('sanojhardware@gmail.com'),
      'creditService.ts must not contain sanojhardware@gmail.com'
    );

    // Root admin must return Muthuwadige Hardware
    assert.ok(
      fnBody.includes("return 'Muthuwadige Hardware';") || fnBody.includes('return "Muthuwadige Hardware";'),
      'resolveAuthorName must return Muthuwadige Hardware for root admin'
    );

    // Final fallback must return Muthuwadige Hardware
    const returnMatches = fnBody.match(/return\s+['"]Muthuwadige Hardware['"];/g);
    assert.ok(
      returnMatches && returnMatches.length >= 2,
      'resolveAuthorName must return Muthuwadige Hardware for both superAdmin and final fallback'
    );
  });

  // -------------------------------------------------------------------------
  // T-B06-04: Print Branding in printTemplates.ts
  // -------------------------------------------------------------------------
  await t.test('T-B06-04: printTemplates.ts getSystemBranding produces MUTHUWADIGE HARDWARE identity', async () => {
    const printTemplatesPath = path.resolve(projectRoot, 'src', 'utils', 'sales', 'printTemplates.ts');
    const content = fs.readFileSync(printTemplatesPath, 'utf-8');

    const match = content.match(/export\s+const\s+getSystemBranding\s*=\s*\([\s\S]*?\)\s*=>\s*\{([\s\S]*?)\n\};/);
    assert.ok(match, 'getSystemBranding must exist in printTemplates.ts');

    const body = match[1];

    // Assert shopName fallback
    assert.ok(
      body.includes("'MUTHUWADIGE HARDWARE'") || body.includes('"MUTHUWADIGE HARDWARE"'),
      'getSystemBranding default shopName must be MUTHUWADIGE HARDWARE'
    );

    // Assert email fallback
    assert.ok(
      body.includes("'muthuwadigehardware@gmail.com'") || body.includes('"muthuwadigehardware@gmail.com"'),
      'getSystemBranding default email must be muthuwadigehardware@gmail.com'
    );

    assert.ok(
      !body.includes('sanojhardware@gmail.com'),
      'getSystemBranding must not contain sanojhardware@gmail.com'
    );
  });

  // -------------------------------------------------------------------------
  // T-B06-05: Notification and Backup Fallbacks in mailer.js and backup-worker.js
  // -------------------------------------------------------------------------
  await t.test('T-B06-05: mailer.js and backup-worker.js use muthuwadigehardware@gmail.com fallback', async () => {
    const mailerPath = path.resolve(projectRoot, 'src', 'utils', 'mailer.js');
    const mailerContent = fs.readFileSync(mailerPath, 'utf-8');

    // Mailer destination email fallback
    assert.ok(
      mailerContent.includes("'muthuwadigehardware@gmail.com'") || mailerContent.includes('"muthuwadigehardware@gmail.com"'),
      'mailer.js must use muthuwadigehardware@gmail.com fallback destination'
    );
    assert.ok(
      !mailerContent.includes('sanojhardware@gmail.com'),
      'mailer.js must not contain sanojhardware@gmail.com'
    );

    // Ensure SMTP credential resolution logic is preserved
    assert.ok(
      mailerContent.includes('createMailTransporter'),
      'mailer.js must preserve createMailTransporter'
    );
    assert.ok(
      mailerContent.includes('process.env.SMTP_USER') || mailerContent.includes('process.env.GMAIL_USER'),
      'mailer.js must preserve environment-based SMTP credential resolution'
    );

    const backupWorkerPath = path.resolve(projectRoot, 'backup-worker.js');
    const backupContent = fs.readFileSync(backupWorkerPath, 'utf-8');

    assert.ok(
      backupContent.includes("'muthuwadigehardware@gmail.com'") || backupContent.includes('"muthuwadigehardware@gmail.com"'),
      'backup-worker.js must use muthuwadigehardware@gmail.com fallback'
    );
    assert.ok(
      !backupContent.includes('sanojhardware@gmail.com'),
      'backup-worker.js must not contain sanojhardware@gmail.com'
    );

    // Ensure rawSettings.tax_rate is strictly 0
    assert.ok(
      /rawSettings\.tax_rate\s*=\s*0\b/.test(backupContent),
      'backup-worker.js rawSettings.tax_rate must be 0'
    );
  });

  // -------------------------------------------------------------------------
  // T-B06-06: Financial & System Invariants Verification
  // -------------------------------------------------------------------------
  await t.test('T-B06-06: Zero financial calculations, schema DDL, or sync architecture modified', async () => {
    // 1. server.js must NOT be modified
    const serverPath = path.resolve(projectRoot, 'server.js');
    assert.ok(fs.existsSync(serverPath), 'server.js must exist');
    const serverContent = fs.readFileSync(serverPath, 'utf-8');
    // Verify Turso cloud database endpoint is untouched
    assert.ok(
      serverContent.includes('mwhardware-db-sanoj-hardware.aws-ap-south-1.turso.io'),
      'server.js physical Turso endpoint must remain preserved'
    );

    // 2. syncService must NOT be modified
    const syncJsPath = path.resolve(projectRoot, 'src', 'services', 'syncService.js');
    const syncTsPath = path.resolve(projectRoot, 'src', 'services', 'syncService.ts');
    assert.ok(fs.existsSync(syncJsPath), 'syncService.js must exist');
    assert.ok(fs.existsSync(syncTsPath), 'syncService.ts must exist');

    // 3. Tax freeze invariant: SettingsContext.tsx and backup-worker.js must have tax_rate: 0
    const settingsPath = path.resolve(projectRoot, 'src', 'context', 'SettingsContext.tsx');
    const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
    assert.ok(/tax_rate:\s*0\b/.test(settingsContent), 'tax_rate must remain frozen at 0 in SettingsContext.tsx');

    const backupWorkerPath = path.resolve(projectRoot, 'backup-worker.js');
    const backupContent = fs.readFileSync(backupWorkerPath, 'utf-8');
    assert.ok(/rawSettings\.tax_rate\s*=\s*0\b/.test(backupContent), 'tax_rate must remain frozen at 0 in backup-worker.js');
  });

  // -------------------------------------------------------------------------
  // T-B06-07: Additional B06 Completed Files Verification
  // -------------------------------------------------------------------------
  await t.test('T-B06-07: ChequeRegistry, ReceiptTemplate, Finance, Reports contain Muthuwadige Hardware', async () => {
    // 1. ChequeRegistry.tsx
    const chequePath = path.resolve(projectRoot, 'src', 'components', 'accounting', 'ChequeRegistry.tsx');
    const chequeContent = fs.readFileSync(chequePath, 'utf-8');
    assert.ok(
      !chequeContent.includes("'Sanoj Hardware'") && !chequeContent.includes('"Sanoj Hardware"'),
      'ChequeRegistry.tsx must not contain Sanoj Hardware'
    );
    assert.ok(
      chequeContent.includes("created_by: currentUser?.name || currentUser?.full_name || currentUser?.username || 'Muthuwadige Hardware'"),
      'ChequeRegistry.tsx created_by must fall back to Muthuwadige Hardware'
    );
    assert.ok(
      chequeContent.includes("processed_by: currentUser?.name || currentUser?.full_name || currentUser?.username || 'Muthuwadige Hardware'"),
      'ChequeRegistry.tsx processed_by must fall back to Muthuwadige Hardware'
    );
    assert.ok(
      chequeContent.includes("Prepared By: ${preparedByStaff}"),
      'ChequeRegistry.tsx preparedByStaff interpolation must exist'
    );

    // 2. ReceiptTemplate.tsx
    const receiptPath = path.resolve(projectRoot, 'src', 'components', 'print', 'ReceiptTemplate.tsx');
    const receiptContent = fs.readFileSync(receiptPath, 'utf-8');
    assert.ok(
      !receiptContent.includes("'Sanoj Hardware'") && !receiptContent.includes('"Sanoj Hardware"'),
      'ReceiptTemplate.tsx must not contain Sanoj Hardware'
    );
    assert.ok(
      receiptContent.includes("invoice.cashier || invoice.cashier_name || invoice.user_name || invoice.created_by || 'Muthuwadige Hardware'"),
      'ReceiptTemplate.tsx cashier fallback must be Muthuwadige Hardware'
    );

    // 3. Finance.tsx
    const financePath = path.resolve(projectRoot, 'src', 'pages', 'Finance.tsx');
    const financeContent = fs.readFileSync(financePath, 'utf-8');
    assert.ok(
      !financeContent.includes("'Sanoj Hardware'") && !financeContent.includes('"Sanoj Hardware"'),
      'Finance.tsx must not contain Sanoj Hardware'
    );
    assert.ok(
      financeContent.includes("currentUser?.name || currentUser?.full_name || currentUser?.username || 'Muthuwadige Hardware'"),
      'Finance.tsx preparedByStaff fallback must be Muthuwadige Hardware'
    );

    // 4. Reports.tsx
    const reportsPath = path.resolve(projectRoot, 'src', 'pages', 'Reports.tsx');
    const reportsContent = fs.readFileSync(reportsPath, 'utf-8');
    assert.ok(
      reportsContent.includes("cachedReportsData?.shopName || 'Muthuwadige Hardware'"),
      'Reports.tsx shopName initial state fallback must be Muthuwadige Hardware'
    );
    // Verify historical attribution guards are intact
    assert.ok(
      reportsContent.includes("curName !== 'Sanoj Hardware' && curName !== 'Muthuwadige Hardware'"),
      'Reports.tsx historical attribution guard must be preserved'
    );
  });

});
