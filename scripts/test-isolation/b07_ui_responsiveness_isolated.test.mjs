// B07 Isolated UI Responsiveness & Freeze Prevention Test Suite
// Verifies:
// 1. T-B07-01: Scanner Hook Ref Isolation (useBarcodeScanner.ts stable dependencies, ref decoupling)
// 2. T-B07-02: Sales POS Scanner Memoization (Sales.tsx handleUsbScan useCallback & stable ref forwarding)
// 3. T-B07-03: Inventory Scanner Memoization (Inventory.tsx handleInventoryScan useCallback & modal-aware enabled)
// 4. T-B07-04: SSE Decoupling (Sales.tsx does NOT instantiate EventSource; ScannerContext owns SSE decoupled from POS cart)
// 5. T-B07-05: Focus Freeze Disarm (Reports.tsx zero window focus fetching listeners)
// 6. T-B07-06: Global Refresh Wiring (Sales, Dashboard, Reports wire refresh-all-data with cleanup)
// 7. T-B07-07: Header Refresh Safety (Header.tsx consolidated sync refresh with unbuffer protection, no 8-event storm)
// 8. T-B07-08: System Invariants (tax_rate frozen at 0, no math/sync/schema regressions, brand normalization preserved)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

test('B07 — UI Responsiveness & Freeze Prevention Suite', async (t) => {

  // -------------------------------------------------------------------------
  // T-B07-01: Scanner Hook Ref Isolation
  // -------------------------------------------------------------------------
  await t.test('T-B07-01: Scanner Hook Ref Isolation (useBarcodeScanner.ts)', async () => {
    const hookPath = path.resolve(projectRoot, 'src', 'hooks', 'useBarcodeScanner.ts');
    assert.ok(fs.existsSync(hookPath), 'src/hooks/useBarcodeScanner.ts must exist');

    const content = fs.readFileSync(hookPath, 'utf-8');

    // 1. callbackRef.current = callback pattern exists
    assert.ok(
      content.includes('callbackRef.current = callback;'),
      'useBarcodeScanner must update callbackRef.current inside an effect'
    );
    assert.ok(
      /useEffect\(\(\)\s*=>\s*\{\s*callbackRef\.current\s*=\s*callback;\s*\}\s*,\s*\[callback\]\);/.test(content),
      'callbackRef synchronization effect must depend on [callback]'
    );

    // 2. onBarcodeScannedRef.current = onBarcodeScanned pattern in useGlobalBarcodeScanner
    assert.ok(
      content.includes('onBarcodeScannedRef.current = onBarcodeScanned;'),
      'useGlobalBarcodeScanner must update onBarcodeScannedRef.current inside an effect'
    );

    // 3. keydown listener effect dependency array must NOT include callback or onScan
    // For useBarcodeScanner: dependencies should be [minLength, timeOut, enabled]
    const hookMatch = content.match(/export\s+function\s+useBarcodeScanner[\s\S]*?\n\}/);
    assert.ok(hookMatch, 'useBarcodeScanner function definition must exist');
    const hookBody = hookMatch[0];

    const keydownEffectMatch = hookBody.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?window\.addEventListener\('keydown'[\s\S]*?return\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[([\s\S]*?)\]\s*\);/);
    assert.ok(keydownEffectMatch, 'useBarcodeScanner must have a keydown listener effect with cleanup');

    const depsString = keydownEffectMatch[1].trim();
    const deps = depsString.split(',').map(d => d.trim()).filter(Boolean);

    assert.ok(!deps.includes('callback'), 'keydown effect must NOT depend on callback');
    assert.ok(!deps.includes('onScan'), 'keydown effect must NOT depend on onScan');
    assert.ok(!deps.includes('options'), 'keydown effect must NOT depend on options');
    assert.ok(deps.includes('enabled'), 'keydown effect should include enabled in dependencies');
    assert.ok(deps.includes('minLength'), 'keydown effect should include minLength in dependencies');
    assert.ok(deps.includes('timeOut'), 'keydown effect should include timeOut in dependencies');

    // 4. removeEventListener cleanup exists
    assert.ok(
      hookBody.includes("window.removeEventListener('keydown', handleGlobalKeyDown)"),
      'useBarcodeScanner must cleanly remove keydown event listener'
    );
  });

  // -------------------------------------------------------------------------
  // T-B07-02: Sales POS Scanner Memoization
  // -------------------------------------------------------------------------
  await t.test('T-B07-02: Sales POS Scanner Memoization (Sales.tsx)', async () => {
    const salesPath = path.resolve(projectRoot, 'src', 'pages', 'Sales.tsx');
    assert.ok(fs.existsSync(salesPath), 'src/pages/Sales.tsx must exist');

    const content = fs.readFileSync(salesPath, 'utf-8');

    // 1. handleUsbScan exists and is wrapped in useCallback
    assert.ok(
      content.includes('handleUsbScan'),
      'Sales.tsx must define handleUsbScan'
    );
    assert.ok(
      /const\s+handleUsbScan\s*=\s*useCallback\s*\(\s*\((barcode:\s*string|barcode)\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[\]\s*\);/.test(content),
      'handleUsbScan must be wrapped in useCallback with an empty dependency array []'
    );

    // 2. handleBarcodeScannedRef forwarding pattern exists
    assert.ok(
      content.includes('const handleBarcodeScannedRef = useRef(handleBarcodeScanned);'),
      'Sales.tsx must initialize handleBarcodeScannedRef with handleBarcodeScanned'
    );
    assert.ok(
      content.includes('handleBarcodeScannedRef.current = handleBarcodeScanned;'),
      'Sales.tsx must synchronize handleBarcodeScannedRef.current'
    );
    assert.ok(
      content.includes("handleBarcodeScannedRef.current(barcode, 'usb');"),
      "handleUsbScan must invoke handleBarcodeScannedRef.current(barcode, 'usb')"
    );

    // 3. useBarcodeScanner call passes handleUsbScan without inline unstable callback
    assert.ok(
      /useBarcodeScanner\(\s*\{[\s\S]*?onScan:\s*handleUsbScan[\s\S]*?\}\s*\);/.test(content),
      'Sales.tsx must pass handleUsbScan to useBarcodeScanner'
    );
  });

  // -------------------------------------------------------------------------
  // T-B07-03: Inventory Scanner Memoization
  // -------------------------------------------------------------------------
  await t.test('T-B07-03: Inventory Scanner Memoization (Inventory.tsx)', async () => {
    const inventoryPath = path.resolve(projectRoot, 'src', 'pages', 'Inventory.tsx');
    assert.ok(fs.existsSync(inventoryPath), 'src/pages/Inventory.tsx must exist');

    const content = fs.readFileSync(inventoryPath, 'utf-8');

    // 1. handleInventoryScan exists and is wrapped in useCallback
    assert.ok(
      content.includes('handleInventoryScan'),
      'Inventory.tsx must define handleInventoryScan'
    );
    assert.ok(
      /const\s+handleInventoryScan\s*=\s*useCallback\s*\(\s*\((scannedBarcode:\s*string|scannedBarcode)\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[\]\s*\);/.test(content),
      'handleInventoryScan must be wrapped in useCallback with an empty dependency array []'
    );

    // 2. useBarcodeScanner connects handleInventoryScan with modal-aware enabled guard
    assert.ok(
      /useBarcodeScanner\(\s*\{[\s\S]*?onScan:\s*handleInventoryScan[\s\S]*?enabled:\s*!showAddModal\s*&&\s*!showStockModal[\s\S]*?\}\s*\);/.test(content),
      'Inventory.tsx must pass handleInventoryScan and modal-aware enabled guard to useBarcodeScanner'
    );
  });

  // -------------------------------------------------------------------------
  // T-B07-04: SSE Decoupling
  // -------------------------------------------------------------------------
  await t.test('T-B07-04: SSE Decoupling (Sales.tsx & ScannerContext.tsx)', async () => {
    const salesPath = path.resolve(projectRoot, 'src', 'pages', 'Sales.tsx');
    const salesContent = fs.readFileSync(salesPath, 'utf-8');

    // 1. Sales.tsx must NOT instantiate EventSource
    assert.ok(
      !salesContent.includes('new EventSource('),
      'Sales.tsx must NOT instantiate raw EventSource'
    );

    // 2. ScannerContext.tsx must own EventSource
    const contextPath = path.resolve(projectRoot, 'src', 'context', 'ScannerContext.tsx');
    assert.ok(fs.existsSync(contextPath), 'src/context/ScannerContext.tsx must exist');
    const contextContent = fs.readFileSync(contextPath, 'utf-8');

    assert.ok(
      contextContent.includes('new EventSource('),
      'ScannerContext.tsx must own the EventSource SSE stream'
    );

    // 3. Scanner stream effect must NOT depend on volatile POS state
    const sseMatch = contextContent.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?new EventSource\([\s\S]*?return\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*,\s*\[([\s\S]*?)\]\s*\);/);
    assert.ok(sseMatch, 'ScannerContext.tsx must have an SSE connection effect with cleanup');

    const sseDeps = sseMatch[1].split(',').map(d => d.trim()).filter(Boolean);
    const volatileStateNames = ['products', 'cart', 'creditNotes', 'tab', 'orders', 'selectedItems', 'categories'];

    for (const v of volatileStateNames) {
      assert.ok(!sseDeps.includes(v), `SSE effect must NOT depend on volatile POS state '${v}'`);
    }

    assert.ok(sseDeps.includes('scannerSessionId'), 'SSE effect must depend on scannerSessionId');

    // 4. SSE close cleanup exists
    assert.ok(
      contextContent.includes('eventSource.close()') || contextContent.includes('eventSource?.close()'),
      'ScannerContext.tsx must close EventSource on effect cleanup'
    );
  });

  // -------------------------------------------------------------------------
  // T-B07-05: Focus Freeze Disarm
  // -------------------------------------------------------------------------
  await t.test('T-B07-05: Focus Freeze Disarm (Reports.tsx)', async () => {
    const reportsPath = path.resolve(projectRoot, 'src', 'pages', 'Reports.tsx');
    assert.ok(fs.existsSync(reportsPath), 'src/pages/Reports.tsx must exist');

    const content = fs.readFileSync(reportsPath, 'utf-8');

    // 1. Ensure zero window focus event listeners
    const focusListenerMatch = content.match(/addEventListener\(\s*['"]focus['"]/);
    assert.equal(
      focusListenerMatch,
      null,
      'Reports.tsx must NOT register window focus event listener'
    );

    // 2. Existing report refresh mechanisms remain intact
    assert.ok(
      content.includes("window.addEventListener('refresh-reports', fetchData);"),
      'Reports.tsx must register refresh-reports listener'
    );
    assert.ok(
      content.includes("window.addEventListener('refresh-all-data', fetchData);"),
      'Reports.tsx must register refresh-all-data listener'
    );
  });

  // -------------------------------------------------------------------------
  // T-B07-06: Global Refresh Wiring
  // -------------------------------------------------------------------------
  await t.test('T-B07-06: Global Refresh Wiring (Sales, Dashboard, Reports)', async () => {
    const salesPath = path.resolve(projectRoot, 'src', 'pages', 'Sales.tsx');
    const dashboardPath = path.resolve(projectRoot, 'src', 'pages', 'Dashboard.tsx');
    const reportsPath = path.resolve(projectRoot, 'src', 'pages', 'Reports.tsx');
    const inventoryPath = path.resolve(projectRoot, 'src', 'pages', 'Inventory.tsx');

    const salesContent = fs.readFileSync(salesPath, 'utf-8');
    const dashboardContent = fs.readFileSync(dashboardPath, 'utf-8');
    const reportsContent = fs.readFileSync(reportsPath, 'utf-8');
    const inventoryContent = fs.readFileSync(inventoryPath, 'utf-8');

    // Sales.tsx
    assert.ok(
      salesContent.includes("window.addEventListener('refresh-all-data', handleRefresh);"),
      'Sales.tsx must register refresh-all-data listener'
    );
    assert.ok(
      salesContent.includes("window.removeEventListener('refresh-all-data', handleRefresh);"),
      'Sales.tsx must remove refresh-all-data listener on cleanup'
    );

    // Dashboard.tsx
    assert.ok(
      dashboardContent.includes("window.addEventListener('refresh-all-data', handleRefresh);"),
      'Dashboard.tsx must register refresh-all-data listener'
    );
    assert.ok(
      dashboardContent.includes("window.removeEventListener('refresh-all-data', handleRefresh);"),
      'Dashboard.tsx must remove refresh-all-data listener on cleanup'
    );

    // Reports.tsx
    assert.ok(
      reportsContent.includes("window.addEventListener('refresh-all-data', fetchData);"),
      'Reports.tsx must register refresh-all-data listener'
    );
    assert.ok(
      reportsContent.includes("window.removeEventListener('refresh-all-data', fetchData);"),
      'Reports.tsx must remove refresh-all-data listener on cleanup'
    );

    // Inventory.tsx
    assert.ok(
      inventoryContent.includes("window.addEventListener('refresh-all-data', handleRefresh);"),
      'Inventory.tsx must register refresh-all-data listener'
    );
    assert.ok(
      inventoryContent.includes("window.removeEventListener('refresh-all-data', handleRefresh);"),
      'Inventory.tsx must remove refresh-all-data listener on cleanup'
    );
  });

  // -------------------------------------------------------------------------
  // T-B07-07: Header Refresh Safety
  // -------------------------------------------------------------------------
  await t.test('T-B07-07: Header Refresh Safety (Header.tsx)', async () => {
    const headerPath = path.resolve(projectRoot, 'src', 'components', 'Header.tsx');
    assert.ok(fs.existsSync(headerPath), 'src/components/Header.tsx must exist');

    const content = fs.readFileSync(headerPath, 'utf-8');

    // 1. handleGlobalRefresh exists with isRefreshing guard
    assert.ok(
      content.includes('const handleGlobalRefresh = async (e: React.MouseEvent) => {'),
      'Header.tsx must define handleGlobalRefresh'
    );
    assert.ok(
      content.includes('if (isRefreshing) return;'),
      'handleGlobalRefresh must include isRefreshing debounce guard'
    );

    // 2. Unbuffering timeout protection exists
    assert.ok(
      content.includes('const unbufferTimer = setTimeout(() => {'),
      'handleGlobalRefresh must initialize unbufferTimer'
    );
    assert.ok(
      content.includes('clearTimeout(unbufferTimer);'),
      'handleGlobalRefresh must clear unbufferTimer before final reload'
    );

    // 3. Disallowed legacy 8-event storm cascade is absent
    const legacyEvents = [
      'refresh-customers',
      'refresh-suppliers',
      'refresh-credit',
      'refresh-orders'
    ];
    for (const evt of legacyEvents) {
      assert.ok(
        !content.includes(`'${evt}'`) && !content.includes(`"${evt}"`),
        `Header.tsx must NOT dispatch legacy event '${evt}'`
      );
    }

    // 4. Consolidated sync pull/trigger mechanism exists
    assert.ok(
      content.includes('await api.sync.pullDownstream().catch(() => {});'),
      'handleGlobalRefresh must trigger downstream pull'
    );
    assert.ok(
      content.includes('await api.sync.triggerSync();'),
      'handleGlobalRefresh must trigger sync'
    );
  });

  // -------------------------------------------------------------------------
  // T-B07-08: System Invariants
  // -------------------------------------------------------------------------
  await t.test('T-B07-08: System Invariants (Tax=0, Schema, Sync, Branding)', async () => {
    // 1. Tax freeze invariant: tax_rate: 0 in SettingsContext.tsx and backup-worker.js
    const settingsPath = path.resolve(projectRoot, 'src', 'context', 'SettingsContext.tsx');
    const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
    assert.ok(/tax_rate:\s*0\b/.test(settingsContent), 'tax_rate must remain frozen at 0 in SettingsContext.tsx');

    const backupPath = path.resolve(projectRoot, 'backup-worker.js');
    const backupContent = fs.readFileSync(backupPath, 'utf-8');
    assert.ok(/rawSettings\.tax_rate\s*=\s*0\b/.test(backupContent), 'tax_rate must remain frozen at 0 in backup-worker.js');

    // 2. Sync architecture preserved
    const syncJsPath = path.resolve(projectRoot, 'src', 'services', 'syncService.js');
    const syncTsPath = path.resolve(projectRoot, 'src', 'services', 'syncService.ts');
    assert.ok(fs.existsSync(syncJsPath), 'syncService.js must exist');
    assert.ok(fs.existsSync(syncTsPath), 'syncService.ts must exist');

    // 3. Database server & Turso endpoint preserved
    const serverPath = path.resolve(projectRoot, 'server.js');
    const serverContent = fs.readFileSync(serverPath, 'utf-8');
    assert.ok(
      serverContent.includes('mwhardware-db-sanoj-hardware.aws-ap-south-1.turso.io'),
      'server.js physical Turso endpoint must remain preserved'
    );

    // 4. B06 brand identity normalization preserved in B07 target files
    const b07TargetFiles = [
      'src/hooks/useBarcodeScanner.ts',
      'src/pages/Sales.tsx',
      'src/pages/Inventory.tsx',
      'src/context/ScannerContext.tsx',
      'src/components/Header.tsx',
      'src/pages/Reports.tsx',
      'src/pages/Dashboard.tsx'
    ];

    for (const relPath of b07TargetFiles) {
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

        // Store name check (except approved historical attribution guards)
        if (lower.includes('sanoj hardware')) {
          const isHistoricalGuard =
            (relPath === 'src/pages/Reports.tsx' && (line.includes('!== \'Sanoj Hardware\'') || line.includes('!== "Sanoj Hardware"'))) ||
            (relPath === 'src/pages/Sales.tsx' && (line.includes('!== \'Sanoj Hardware\'') || line.includes('!== "Sanoj Hardware"')));

          assert.ok(
            isHistoricalGuard,
            `Active legacy brand name found in ${relPath}:${idx + 1}: ${line.trim()}`
          );
        }
      });
    }

    // 5. Approved historical attribution guards exist
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
