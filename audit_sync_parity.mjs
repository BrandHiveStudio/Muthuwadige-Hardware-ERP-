import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createClient } from '@libsql/client';

// 1. Resolve Environment Credentials
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

async function runAudit() {
  console.log('================================================================');
  console.log('   MUTHUWADIGE HARDWARE ERP — 100% SYNC & SCHEMA PARITY AUDIT   ');
  console.log('================================================================\n');

  const { url, token } = loadEnv();
  console.log(`[1] Turso Endpoint : ${url ? url.replace(/(libsql:\/\/[^.]+).*/, '$1...') : 'MISSING'}`);
  console.log(`[2] Turso Token    : ${token ? 'Configured (Active)' : 'MISSING'}\n`);

  if (!url || !token) {
    console.error('❌ Cannot run Cloud Parity check: TURSO credentials missing in .env or AppData.');
    process.exit(1);
  }

  // Connect to Local SQLite
  const localDb = await open({ filename: './hardware.db', driver: sqlite3.Database });

  // Connect to Turso Cloud
  const turso = createClient({ url, authToken: token });

  // 1. Fetch Local SQLite Tables
  const localTableRows = await localDb.all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'android_%' ORDER BY name"
  );
  const localTables = new Set(localTableRows.map(r => r.name));

  // 2. Fetch Turso Cloud Tables
  let tursoTables = new Set();
  try {
    const tursoRes = await turso.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%' AND name NOT LIKE 'libsql_%' ORDER BY name"
    );
    tursoTables = new Set(tursoRes.rows.map(r => String(r.name)));
  } catch (err) {
    console.error('❌ Failed to query Turso Cloud tables:', err.message);
  }

  // 3. Inspect syncService.js Code Coverage
  const syncFile = fs.existsSync('src/services/syncService.js') 
    ? fs.readFileSync('src/services/syncService.js', 'utf8') 
    : '';

  console.log('----------------------------------------------------------------');
  console.log(' TABLE PARITY & SYNC COVERAGE MATRIX');
  console.log('----------------------------------------------------------------');
  console.log(
    'Table Name'.padEnd(26) + 
    'Local DB'.padEnd(12) + 
    'Turso Cloud'.padEnd(14) + 
    'Sync Engine Handler'
  );
  console.log('-'.repeat(66));

  const allTables = Array.from(new Set([...localTables, ...tursoTables])).sort();

  let missingInTurso = [];
  let missingInLocal = [];
  let unhandledInSync = [];

  for (const tbl of allTables) {
    const inLocal = localTables.has(tbl);
    const inTurso = tursoTables.has(tbl);

    // Skip internal sync tables from requiring bidirectional business sync handlers
    const isInternal = ['sync_queue', 'deleted_records', 'sync_status', 'sync_meta', 'schema_migrations'].includes(tbl);
    
    // Check if table is handled in syncService.js
    const handledInSync = isInternal || syncFile.includes(`'${tbl}'`) || syncFile.includes(`"${tbl}"`) || syncFile.includes(`\`${tbl}\``);

    const localStr = inLocal ? '✅ YES' : '❌ NO';
    const tursoStr = inTurso ? '✅ YES' : '❌ NO';
    let syncStr = '✅ ACTIVE';

    if (isInternal) {
      syncStr = '⚙️ INFRA';
    } else if (!handledInSync) {
      syncStr = '⚠️ NOT FOUND';
      unhandledInSync.push(tbl);
    }

    if (!inTurso) missingInTurso.push(tbl);
    if (!inLocal) missingInLocal.push(tbl);

    console.log(
      tbl.padEnd(26) + 
      localStr.padEnd(12) + 
      tursoStr.padEnd(14) + 
      syncStr
    );
  }

  // 4. Inspect Local sync_queue Health
  console.log('\n----------------------------------------------------------------');
  console.log(' LOCAL SYNC QUEUE HEALTH (hardware.db)');
  console.log('----------------------------------------------------------------');
  try {
    const queueCounts = await localDb.all(
      "SELECT status, COUNT(*) as count FROM sync_queue GROUP BY status"
    );
    if (queueCounts.length === 0) {
      console.log('✅ Sync Queue is completely empty (All local transactions committed & flushed).');
    } else {
      for (const q of queueCounts) {
        console.log(`  * Status [${q.status.padEnd(10)}]: ${q.count} record(s)`);
      }
    }
  } catch (err) {
    console.log('⚠️ Could not inspect sync_queue:', err.message);
  }

  // 5. Inspect Cloud deleted_records Tombstones
  console.log('\n----------------------------------------------------------------');
  console.log(' TOMBSTONE REPLICATION AUDIT (deleted_records)');
  console.log('----------------------------------------------------------------');
  try {
    const localTombstones = await localDb.get("SELECT COUNT(*) as count FROM deleted_records");
    console.log(`Local Tombstones (SQLite) : ${localTombstones ? localTombstones.count : 0}`);
  } catch (_) {
    console.log('Local Tombstones (SQLite) : None / table missing');
  }

  try {
    const cloudTombstones = await turso.execute("SELECT COUNT(*) as count FROM deleted_records");
    console.log(`Cloud Tombstones (Turso)  : ${cloudTombstones.rows[0]?.count ?? 0}`);
  } catch (_) {
    console.log('Cloud Tombstones (Turso)  : Table not yet created or inaccessible');
  }

  // 6. Summary Verdict
  console.log('\n================================================================');
  console.log(' VERDICT & ACTION ITEMS');
  console.log('================================================================');

  if (missingInTurso.length === 0 && missingInLocal.length === 0 && unhandledInSync.length === 0) {
    console.log('🎉 100% PARITY CONFIRMED! Every table exists locally & in Turso with sync active.');
  } else {
    if (missingInTurso.length > 0) {
      console.log(`⚠️ Missing in Turso Cloud (${missingInTurso.length}): ${missingInTurso.join(', ')}`);
    }
    if (missingInLocal.length > 0) {
      console.log(`⚠️ Missing in Local SQLite (${missingInLocal.length}): ${missingInLocal.join(', ')}`);
    }
    if (unhandledInSync.length > 0) {
      console.log(`⚠️ Tables without explicit syncService coverage (${unhandledInSync.length}): ${unhandledInSync.join(', ')}`);
    }
  }

  await localDb.close();
}

runAudit().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
