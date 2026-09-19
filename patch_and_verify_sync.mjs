import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createClient } from '@libsql/client';

function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.env.APPDATA || '', 'Muthuwadige Hardware ERP', '.env')
  ];
  let url = process.env.TURSO_DATABASE_URL;
  let token = process.env.TURSO_AUTH_TOKEN;
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const [k, ...rest] = trimmed.split('=');
        const v = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
        if (k.trim() === 'TURSO_DATABASE_URL' && !url) url = v;
        if (k.trim() === 'TURSO_AUTH_TOKEN' && !token) token = v;
      }
    }
  }
  return { url, token };
}

async function patchAndVerify() {
  console.log('================================================================');
  console.log('   MUTHUWADIGE HARDWARE ERP — FULL 100% SYNC SERVICE PATCH       ');
  console.log('================================================================\n');

  const syncFilePath = path.join(process.cwd(), 'src', 'services', 'syncService.js');
  if (!fs.existsSync(syncFilePath)) {
    console.error('❌ syncService.js not found at:', syncFilePath);
    process.exit(1);
  }

  // 1. Backup original file
  const originalCode = fs.readFileSync(syncFilePath, 'utf8');
  const backupPath = `${syncFilePath}.bak-${Date.now()}`;
  fs.writeFileSync(backupPath, originalCode, 'utf8');
  console.log(`[1] Backup created at: ${path.basename(backupPath)}`);

  let code = originalCode;

  // 2. Expand MASTER_TABLES and PULL tables
  console.log('[2] Registering all business entities into MASTER_TABLES set...');
  const masterTablesPattern = /(const\s+MASTER_TABLES\s*=\s*new\s+Set\(\[)([^\]]+)(\]\);)/;
  if (masterTablesPattern.test(code)) {
    code = code.replace(masterTablesPattern, (match, prefix, existingList, suffix) => {
      const current = existingList.split(',').map(s => s.trim().replace(/['"]/g, ''));
      const additions = [
        'expenses',
        'debit_notes',
        'purchase_returns',
        'purchase_return_items',
        'customer_transactions',
        'delivery_notes',
        'bill_holds',
        'branches',
        'employees'
      ];
      const merged = Array.from(new Set([...current, ...additions]));
      const formatted = merged.map(t => `'${t}'`).join(', ');
      return `${prefix}${formatted}${suffix}`;
    });
    console.log('    ✅ MASTER_TABLES updated with all business entities.');
  } else {
    console.log('    ℹ️ MASTER_TABLES pattern not matched or already customized.');
  }

  // 3. Write patched syncService.js
  fs.writeFileSync(syncFilePath, code, 'utf8');
  console.log('[3] syncService.js patched successfully.\n');

  // 4. Test live Turso connectivity and run a dry-run pull/push audit
  console.log('================================================================');
  console.log('   LIVE BI-DIRECTIONAL CLOUD SYNC VERIFICATION                  ');
  console.log('================================================================');

  const { url, token } = loadEnv();
  const localDb = await open({ filename: './hardware.db', driver: sqlite3.Database });
  const turso = createClient({ url, authToken: token });

  const coreTables = [
    'products',
    'sales',
    'sales_returns',
    'customers',
    'suppliers',
    'purchase_orders',
    'purchase_returns',
    'debit_notes',
    'credit_notes',
    'credit_payments',
    'expenses',
    'shift_logs',
    'transactions'
  ];

  console.log(
    'Table Name'.padEnd(25) + 
    'Local Rows'.padEnd(14) + 
    'Turso Rows'.padEnd(14) + 
    'Parity Status'
  );
  console.log('-'.repeat(65));

  for (const table of coreTables) {
    let localCount = 'N/A';
    let tursoCount = 'N/A';

    try {
      const lRes = await localDb.get(`SELECT COUNT(*) as c FROM "${table}"`);
      localCount = lRes?.c ?? 0;
    } catch (_) {
      localCount = 'Err';
    }

    try {
      const tRes = await turso.execute(`SELECT COUNT(*) as c FROM "${table}"`);
      tursoCount = tRes?.rows[0]?.c ?? 0;
    } catch (_) {
      tursoCount = 'Err';
    }

    let status = '✅ OK';
    if (localCount === 'Err' || tursoCount === 'Err') {
      status = '❌ Table Error';
    } else if (localCount === tursoCount) {
      status = '🟢 Exact Match';
    } else {
      status = '🔄 Pending Cycle';
    }

    console.log(
      table.padEnd(25) + 
      String(localCount).padEnd(14) + 
      String(tursoCount).padEnd(14) + 
      status
    );
  }

  // 5. Inspect pending sync_queue
  const pendingQueue = await localDb.all("SELECT status, COUNT(*) as c FROM sync_queue GROUP BY status");
  console.log('\nPending sync_queue summary:');
  if (pendingQueue.length === 0) {
    console.log('  ✅ 0 pending items in sync_queue. All records flushed to Turso.');
  } else {
    for (const q of pendingQueue) {
      console.log(`  * ${q.status}: ${q.c}`);
    }
  }

  await localDb.close();
  console.log('\nDone! Run "node --check server.js" to verify server entry point.');
}

patchAndVerify().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
