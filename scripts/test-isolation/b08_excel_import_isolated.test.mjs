// B08 Isolated Excel Bulk Import & Unicode / Schema Resilience Test Suite
// Verifies:
// 1. T-B08-01: Binary Safety & Unicode Resilience (arrayBuffer + XLSX array mode, zero readAsBinaryString)
// 2. T-B08-02: Inventory Bulk Import Architecture (api.products.bulkImport, header mapping, cache invalidation, no mock adapter fallback)
// 3. T-B08-03: Customer Bulk Import Architecture (api.customers.bulkImport, field normalization, no mock adapter fallback)
// 4. T-B08-04: Supplier Bulk Import Architecture (api.suppliers.bulkImport, credit/payable mapping, no mock adapter fallback)
// 5. T-B08-05: Backend Bulk Route Resilience (server.js ensureBulkImportColumns, alias normalization, transaction + enqueueSync, turso.batch)
// 6. T-B08-06: Database Restore Resilience (Settings.tsx & server.js /api/settings/restore, pre-restore snapshot, transaction, bcrypt hashing)
// 7. T-B08-07: Tax Freeze Invariant in Import & Restore (tax: 0, tax_rate: 0 in restore handler & SettingsContext)
// 8. T-B08-08: System Invariants (syncService, Turso endpoint, brand normalization in B08 files)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

/**
 * Robust AST-grade helper to extract complete function body between balanced { and },
 * properly handling nested helper functions, arrow callbacks, comments, and strings.
 */
function extractFunctionBody(content, fnName) {
  const marker = new RegExp(`const\\s+${fnName}\\s*=\\s*async\\s*\\([^)]*\\)\\s*=>\\s*\\{`);
  const match = content.match(marker);
  if (!match) return null;
  const startIndex = match.index + match[0].length - 1;
  let depth = 0;
  let inString = null;
  let inComment = false;
  for (let i = startIndex; i < content.length; i++) {
    const ch = content[i];
    const prev = content[i - 1];
    const next = content[i + 1];

    if (!inString && !inComment) {
      if (ch === '/' && next === '/') {
        inComment = 'line';
        i++;
        continue;
      } else if (ch === '/' && next === '*') {
        inComment = 'block';
        i++;
        continue;
      } else if (ch === "'" || ch === '"' || ch === '`') {
        inString = ch;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return content.slice(startIndex + 1, i);
        }
      }
    } else if (inString) {
      if (ch === inString && prev !== '\\') {
        inString = null;
      }
    } else if (inComment === 'line') {
      if (ch === '\n') {
        inComment = false;
      }
    } else if (inComment === 'block') {
      if (ch === '*' && next === '/') {
        inComment = false;
        i++;
      }
    }
  }
  return null;
}

test('B08 — Excel Bulk Import & Unicode / Schema Resilience Suite', async (t) => {

  // -------------------------------------------------------------------------
  // T-B08-01: Binary Safety & Unicode Resilience
  // -------------------------------------------------------------------------
  await t.test('T-B08-01: Binary Safety & Unicode Resilience (Inventory, Customers, Suppliers, Settings)', async () => {
    const targetFiles = [
      'src/pages/Inventory.tsx',
      'src/pages/Customers.tsx',
      'src/pages/Suppliers.tsx',
      'src/pages/Settings.tsx'
    ];

    for (const relPath of targetFiles) {
      const fullPath = path.resolve(projectRoot, relPath);
      assert.ok(fs.existsSync(fullPath), `${relPath} must exist`);

      const content = fs.readFileSync(fullPath, 'utf-8');

      // 1. Must use file.arrayBuffer() for binary safety
      assert.ok(
        content.includes('file.arrayBuffer()'),
        `${relPath} must use file.arrayBuffer() for binary-safe workbook reading`
      );

      // 2. XLSX.read must use type: 'array'
      assert.ok(
        /XLSX\.read\([\s\S]*?type:\s*['"]array['"][\s\S]*?\)/.test(content),
        `${relPath} must call XLSX.read with type: 'array'`
      );

      // 3. Deprecated readAsBinaryString must be strictly absent
      assert.ok(
        !content.includes('readAsBinaryString'),
        `${relPath} must NOT contain deprecated readAsBinaryString`
      );

      // 4. XLSX.read with type: 'binary' must be strictly absent
      assert.ok(
        !content.includes("type: 'binary'") && !content.includes('type: "binary"'),
        `${relPath} must NOT call XLSX.read with type: 'binary'`
      );
    }
  });

  // -------------------------------------------------------------------------
  // T-B08-02: Inventory Bulk Import Architecture
  // -------------------------------------------------------------------------
  await t.test('T-B08-02: Inventory Bulk Import Architecture (Inventory.tsx)', async () => {
    const inventoryPath = path.resolve(projectRoot, 'src', 'pages', 'Inventory.tsx');
    assert.ok(fs.existsSync(inventoryPath), 'src/pages/Inventory.tsx must exist');

    const content = fs.readFileSync(inventoryPath, 'utf-8');

    // Extract complete handleImportExcel function body using robust brace balancing
    const fnBody = extractFunctionBody(content, 'handleImportExcel');
    assert.ok(fnBody, 'handleImportExcel function body must be extracted from Inventory.tsx');

    // 1. Must call api.products.bulkImport
    assert.ok(
      fnBody.includes('api.products.bulkImport'),
      'Inventory.tsx handleImportExcel must call api.products.bulkImport'
    );

    // 2. Header and field normalization helper exists
    assert.ok(
      fnBody.includes('getValueByKeys') || fnBody.includes('cleanKey'),
      'Inventory.tsx must implement field normalization helper for spreadsheet headers'
    );

    // 3. Product fields mapped: sku, name, price/selling_price, cost, stock, minStock
    assert.ok(fnBody.includes('sku'), 'handleImportExcel must map SKU field');
    assert.ok(fnBody.includes('name'), 'handleImportExcel must map name field');
    assert.ok(fnBody.includes('price'), 'handleImportExcel must map price field');
    assert.ok(fnBody.includes('costPrice') || fnBody.includes('cost_price'), 'handleImportExcel must map cost price field');
    assert.ok(fnBody.includes('stock'), 'handleImportExcel must map stock field');
    assert.ok(fnBody.includes('minStock') || fnBody.includes('min_stock'), 'handleImportExcel must map minStock field');

    // 4. Cache invalidation on successful import
    assert.ok(
      fnBody.includes("sessionStorage.removeItem('erp_cached_products')") ||
      fnBody.includes('sessionStorage.removeItem("erp_cached_products")'),
      'Inventory.tsx must invalidate stale sessionStorage product cache on import'
    );
    assert.ok(
      fnBody.includes("refresh-inventory"),
      'Inventory.tsx must dispatch refresh-inventory event upon successful import'
    );

    // 5. Must NOT use legacy mock Supabase insert -> update fallback loop
    assert.ok(
      !fnBody.includes("supabase.from('products').insert") && !fnBody.includes('supabase.from("products").insert'),
      'Inventory.tsx handleImportExcel must NOT use legacy supabase.from("products").insert'
    );
    assert.ok(
      !fnBody.includes("supabase.from('products').update") && !fnBody.includes('supabase.from("products").update'),
      'Inventory.tsx handleImportExcel must NOT use legacy supabase.from("products").update fallback'
    );
  });

  // -------------------------------------------------------------------------
  // T-B08-03: Customer Bulk Import Architecture
  // -------------------------------------------------------------------------
  await t.test('T-B08-03: Customer Bulk Import Architecture (Customers.tsx)', async () => {
    const customersPath = path.resolve(projectRoot, 'src', 'pages', 'Customers.tsx');
    assert.ok(fs.existsSync(customersPath), 'src/pages/Customers.tsx must exist');

    const content = fs.readFileSync(customersPath, 'utf-8');

    // Extract complete handleImportExcel function body using robust brace balancing
    const fnBody = extractFunctionBody(content, 'handleImportExcel');
    assert.ok(fnBody, 'handleImportExcel function body must be extracted from Customers.tsx');

    // 1. Must call api.customers.bulkImport
    assert.ok(
      fnBody.includes('api.customers.bulkImport'),
      'Customers.tsx handleImportExcel must call api.customers.bulkImport'
    );

    // 2. Header and field normalization helper exists
    assert.ok(
      fnBody.includes('getValueByKeys') || fnBody.includes('cleanKey'),
      'Customers.tsx must implement field normalization helper for customer headers'
    );

    // 3. Supported customer fields are mapped
    assert.ok(fnBody.includes('name'), 'handleImportExcel must map customer name');
    assert.ok(fnBody.includes('phone'), 'handleImportExcel must map customer phone');
    assert.ok(fnBody.includes('nic'), 'handleImportExcel must map customer NIC/identity');
    assert.ok(fnBody.includes('creditLimit') || fnBody.includes('credit_limit'), 'handleImportExcel must map credit limit');
    assert.ok(fnBody.includes('creditPeriod') || fnBody.includes('credit_period'), 'handleImportExcel must map credit period');
    assert.ok(fnBody.includes('totalPurchases') || fnBody.includes('total_purchases'), 'handleImportExcel must map total purchases');
    assert.ok(fnBody.includes('joinDate') || fnBody.includes('join_date'), 'handleImportExcel must map join date');

    // 4. Must NOT use legacy mock Supabase insert -> update fallback loop
    assert.ok(
      !fnBody.includes("supabase.from('customers').insert") && !fnBody.includes('supabase.from("customers").insert'),
      'Customers.tsx handleImportExcel must NOT use legacy supabase.from("customers").insert'
    );
    assert.ok(
      !fnBody.includes("supabase.from('customers').update") && !fnBody.includes('supabase.from("customers").update'),
      'Customers.tsx handleImportExcel must NOT use legacy supabase.from("customers").update fallback'
    );
  });

  // -------------------------------------------------------------------------
  // T-B08-04: Supplier Bulk Import Architecture
  // -------------------------------------------------------------------------
  await t.test('T-B08-04: Supplier Bulk Import Architecture (Suppliers.tsx)', async () => {
    const suppliersPath = path.resolve(projectRoot, 'src', 'pages', 'Suppliers.tsx');
    assert.ok(fs.existsSync(suppliersPath), 'src/pages/Suppliers.tsx must exist');

    const content = fs.readFileSync(suppliersPath, 'utf-8');

    // Extract complete handleImportExcel function body using robust brace balancing
    const fnBody = extractFunctionBody(content, 'handleImportExcel');
    assert.ok(fnBody, 'handleImportExcel function body must be extracted from Suppliers.tsx');

    // 1. Must call api.suppliers.bulkImport
    assert.ok(
      fnBody.includes('api.suppliers.bulkImport'),
      'Suppliers.tsx handleImportExcel must call api.suppliers.bulkImport'
    );

    // 2. Header and field normalization helper exists
    assert.ok(
      fnBody.includes('getValueByKeys') || fnBody.includes('cleanKey'),
      'Suppliers.tsx must implement field normalization helper for supplier headers'
    );

    // 3. Supported supplier fields are mapped
    assert.ok(fnBody.includes('name'), 'handleImportExcel must map supplier name');
    assert.ok(fnBody.includes('phone'), 'handleImportExcel must map supplier phone');
    assert.ok(fnBody.includes('creditTerms') || fnBody.includes('credit_terms'), 'handleImportExcel must map credit terms');
    assert.ok(fnBody.includes('payableBalance') || fnBody.includes('payable_balance'), 'handleImportExcel must map payable balance');

    // 4. Must NOT use legacy mock Supabase insert -> update fallback loop
    assert.ok(
      !fnBody.includes("supabase.from('suppliers').insert") && !fnBody.includes('supabase.from("suppliers").insert'),
      'Suppliers.tsx handleImportExcel must NOT use legacy supabase.from("suppliers").insert'
    );
    assert.ok(
      !fnBody.includes("supabase.from('suppliers').update") && !fnBody.includes('supabase.from("suppliers").update'),
      'Suppliers.tsx handleImportExcel must NOT use legacy supabase.from("suppliers").update fallback'
    );
  });

  // -------------------------------------------------------------------------
  // T-B08-05: Backend Bulk Route Resilience
  // -------------------------------------------------------------------------
  await t.test('T-B08-05: Backend Bulk Route Resilience (server.js)', async () => {
    const serverPath = path.resolve(projectRoot, 'server.js');
    assert.ok(fs.existsSync(serverPath), 'server.js must exist');

    const content = fs.readFileSync(serverPath, 'utf-8');

    // 1. ensureBulkImportColumns helper exists
    assert.ok(
      content.includes('async function ensureBulkImportColumns('),
      'server.js must define ensureBulkImportColumns helper'
    );
    assert.ok(
      content.includes('ALTER TABLE products ADD COLUMN updated_at TEXT;'),
      'ensureBulkImportColumns must ensure products.updated_at column'
    );
    assert.ok(
      content.includes('ALTER TABLE customers ADD COLUMN credit_limit REAL DEFAULT 0;'),
      'ensureBulkImportColumns must ensure customers.credit_limit column'
    );

    // 2. Products bulk-import endpoint exists
    assert.ok(
      content.includes("'/api/products/bulk-import'") || content.includes('"/api/products/bulk-import"'),
      'server.js must define /api/products/bulk-import endpoint'
    );

    // 3. Customers bulk-import endpoint exists
    assert.ok(
      content.includes("'/api/customers/bulk-import'") || content.includes('"/api/customers/bulk-import"'),
      'server.js must define /api/customers/bulk-import endpoint'
    );

    // 4. Suppliers bulk-import endpoint exists
    assert.ok(
      content.includes("'/api/suppliers/bulk-import'") || content.includes('"/api/suppliers/bulk-import"'),
      'server.js must define /api/suppliers/bulk-import endpoint'
    );

    // 5. Transaction wrapping and enqueueSync outbox registration
    assert.ok(
      content.includes('activeDb.transaction(async () => {'),
      'server.js bulk import routes must wrap local SQLite inserts in a transaction'
    );
    assert.ok(
      content.includes("await enqueueSync(activeDb, 'products', s.id, 'UPSERT')"),
      'server.js product bulk import must enqueue sync outbox records'
    );
    assert.ok(
      content.includes("await enqueueSync(activeDb, 'customers', cp.id, 'UPSERT', cp.payload)"),
      'server.js customer bulk import must enqueue sync outbox records'
    );

    // 6. Cloud Turso batch pipeline path exists
    assert.ok(
      content.includes('turso.batch('),
      'server.js must implement turso.batch() pipelining for cloud execution'
    );
  });

  // -------------------------------------------------------------------------
  // T-B08-06: Database Restore Resilience
  // -------------------------------------------------------------------------
  await t.test('T-B08-06: Database Restore Resilience (Settings.tsx & server.js)', async () => {
    // 1. Settings.tsx frontend restore
    const settingsPath = path.resolve(projectRoot, 'src', 'pages', 'Settings.tsx');
    const settingsContent = fs.readFileSync(settingsPath, 'utf-8');

    assert.ok(
      settingsContent.includes('const handleRestoreExcel = async ('),
      'Settings.tsx must define handleRestoreExcel'
    );
    assert.ok(
      settingsContent.includes("fetch(`${API_URL}/settings/restore`"),
      'handleRestoreExcel must POST to /settings/restore'
    );

    // 2. server.js backend restore
    const serverPath = path.resolve(projectRoot, 'server.js');
    const serverContent = fs.readFileSync(serverPath, 'utf-8');

    assert.ok(
      serverContent.includes("app.post('/api/settings/restore', requireAdmin,"),
      'server.js must define POST /api/settings/restore protected by requireAdmin'
    );

    // 3. Pre-restore safety snapshot
    assert.ok(
      serverContent.includes("VACUUM INTO ?") || serverContent.includes('PRAGMA wal_checkpoint'),
      'POST /api/settings/restore must create pre-restore safety snapshot'
    );

    // 4. Atomic transaction wrapping
    assert.ok(
      serverContent.includes('await db.transaction(async () => {'),
      'POST /api/settings/restore must execute within an atomic db.transaction'
    );

    // 5. Restored password protection using bcrypt
    assert.ok(
      serverContent.includes('isBcryptHash(restoredPassword) ? restoredPassword : await bcrypt.hash(restoredPassword, 10)'),
      'POST /api/settings/restore must protect restored plaintext passwords using bcrypt'
    );

    // 6. Schema-compatible table restore mapping
    const expectedRestoreTables = [
      'products',
      'sales',
      'transactions',
      'customers',
      'employees',
      'profiles',
      'system_settings',
      'suppliers',
      'purchase_orders',
      'stock_adjustments',
      'quotations',
      'delivery_notes',
      'branches'
    ];
    for (const table of expectedRestoreTables) {
      assert.ok(
        serverContent.includes(`INSERT INTO ${table}`),
        `POST /api/settings/restore must support INSERT INTO ${table}`
      );
    }
  });

  // -------------------------------------------------------------------------
  // T-B08-07: Tax Freeze During Import/Restore
  // -------------------------------------------------------------------------
  await t.test('T-B08-07: Tax Freeze During Import/Restore (Tax=0 Invariant)', async () => {
    const serverPath = path.resolve(projectRoot, 'server.js');
    const serverContent = fs.readFileSync(serverPath, 'utf-8');

    // Extract the sales restore insert block inside /api/settings/restore
    const restoreMatch = serverContent.match(/app\.post\('\/api\/settings\/restore'[\s\S]*?res\.json\(\{ success: true/);
    assert.ok(restoreMatch, '/api/settings/restore route definition must exist in server.js');
    const restoreBody = restoreMatch[0];

    // Verify tax and tax_rate are strictly forced to 0 for restored sales
    assert.ok(
      restoreBody.includes('// TAX REMOVED: this was the one genuinely functional tax pathway in the whole app'),
      'server.js restore handler must document explicit tax removal invariant'
    );

    // Line-ending agnostic and indentation-tolerant check: tax=0, tax_rate=0 immediately before total_amount
    assert.ok(
      /0,\s*0,\s*Number\(s\.total_amount/.test(restoreBody),
      'server.js restore handler must insert 0 for tax and 0 for tax_rate immediately before total_amount in restored sales'
    );

    // Verify system_settings tax_rate is forced to 0 during restore
    assert.ok(
      restoreBody.includes('0, // TAX REMOVED: tax_rate is not a supported feature'),
      'server.js restore handler must insert 0 for tax_rate in restored system_settings'
    );

    // SettingsContext.tsx default tax_rate must remain frozen at 0
    const settingsContextPath = path.resolve(projectRoot, 'src', 'context', 'SettingsContext.tsx');
    const settingsContextContent = fs.readFileSync(settingsContextPath, 'utf-8');
    assert.ok(
      /tax_rate:\s*0\b/.test(settingsContextContent),
      'SettingsContext.tsx default tax_rate must remain strictly frozen at 0'
    );

    // backup-worker.js tax_rate must remain frozen at 0
    const backupWorkerPath = path.resolve(projectRoot, 'backup-worker.js');
    const backupWorkerContent = fs.readFileSync(backupWorkerPath, 'utf-8');
    assert.ok(
      /rawSettings\.tax_rate\s*=\s*0\b/.test(backupWorkerContent),
      'backup-worker.js tax_rate must remain strictly frozen at 0'
    );
  });

  // -------------------------------------------------------------------------
  // T-B08-08: System Invariants
  // -------------------------------------------------------------------------
  await t.test('T-B08-08: System Invariants (Sync, Turso, Brand Normalization)', async () => {
    // 1. syncService.js and syncService.ts exist and are preserved
    const syncJsPath = path.resolve(projectRoot, 'src', 'services', 'syncService.js');
    const syncTsPath = path.resolve(projectRoot, 'src', 'services', 'syncService.ts');
    assert.ok(fs.existsSync(syncJsPath), 'syncService.js must exist');
    assert.ok(fs.existsSync(syncTsPath), 'syncService.ts must exist');

    // 2. Physical Turso database endpoint intact in server.js
    const serverPath = path.resolve(projectRoot, 'server.js');
    const serverContent = fs.readFileSync(serverPath, 'utf-8');
    assert.ok(
      serverContent.includes('mwhardware-db-sanoj-hardware.aws-ap-south-1.turso.io'),
      'server.js physical Turso endpoint must remain preserved'
    );

    // 3. Brand identity normalization preserved across B08 UI files
    const b08TargetFiles = [
      'src/pages/Inventory.tsx',
      'src/pages/Customers.tsx',
      'src/pages/Suppliers.tsx',
      'src/pages/Settings.tsx'
    ];

    for (const relPath of b08TargetFiles) {
      const fullPath = path.resolve(projectRoot, relPath);
      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      const lines = fileContent.split('\n');

      lines.forEach((line, idx) => {
        const lower = line.toLowerCase();
        // Email check
        assert.ok(
          !lower.includes('sanojhardware@gmail.com'),
          `Legacy email found in ${relPath}:${idx + 1}: ${line.trim()}`
        );

        // Store name check
        assert.ok(
          !lower.includes('sanoj hardware'),
          `Legacy store name found in ${relPath}:${idx + 1}: ${line.trim()}`
        );
      });
    }

    // 4. Approved historical attribution guards in Reports and Sales remain intact
    const reportsContent = fs.readFileSync(path.resolve(projectRoot, 'src', 'pages', 'Reports.tsx'), 'utf-8');
    assert.ok(
      reportsContent.includes("curName !== 'Sanoj Hardware' && curName !== 'Muthuwadige Hardware'"),
      'Reports.tsx historical attribution guard must be preserved'
    );

    const salesContent = fs.readFileSync(path.resolve(projectRoot, 'src', 'pages', 'Sales.tsx'), 'utf-8');
    assert.ok(
      salesContent.includes("active.name.trim() !== 'Sanoj Hardware' && active.name.trim() !== 'Muthuwadige Hardware'"),
      'Sales.tsx historical attribution guard must be preserved'
    );
  });

});
