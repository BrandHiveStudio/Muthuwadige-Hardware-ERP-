import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function run() {
  console.log('==================================================');
  console.log('1. LOCATING DATABASE & RECORD 660409');
  console.log('==================================================');
  const candidatePaths = [
    './hardware.db',
    path.join(process.env.APPDATA || '', 'Muthuwadige Hardware ERP', 'hardware.db'),
    path.join(process.env.LOCALAPPDATA || '', 'Muthuwadige Hardware ERP', 'hardware.db')
  ];

  for (const dbPath of candidatePaths) {
    if (fs.existsSync(dbPath)) {
      console.log(`Checking database at: ${dbPath}`);
      try {
        const db = await open({ filename: dbPath, driver: sqlite3.Database });
        const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
        for (const t of tables) {
          try {
            const rows = await db.all(`SELECT * FROM "${t.name}" WHERE id LIKE '%660409%' OR rowid IN (SELECT rowid FROM "${t.name}" WHERE CAST(rowid AS TEXT) LIKE '%660409%')`);
            if (rows && rows.length > 0) {
              console.log(`  🎯 FOUND in table "${t.name}" (${dbPath}):`);
              console.log(JSON.stringify(rows, null, 2));
            }
          } catch (_) {
            try {
              const cols = await db.all(`PRAGMA table_info("${t.name}")`);
              const textCols = cols.filter(c => c.type.includes('CHAR') || c.type.includes('TEXT') || c.type === '').map(c => `"${c.name}" LIKE '%660409%'`);
              if (textCols.length > 0) {
                const r = await db.all(`SELECT * FROM "${t.name}" WHERE ${textCols.join(' OR ')}`);
                if (r && r.length > 0) {
                  console.log(`  🎯 FOUND in table "${t.name}" via text search (${dbPath}):`);
                  console.log(JSON.stringify(r, null, 2));
                }
              }
            } catch (_) {}
          }
        }
        await db.close();
      } catch (err) {
        console.warn(`  Could not read ${dbPath}:`, err.message);
      }
    }
  }

  console.log('\n==================================================');
  console.log('2. server.js: LINES 9550-9650 (/api/purchasing/receive-po)');
  console.log('==================================================');
  if (fs.existsSync('server.js')) {
    const lines = fs.readFileSync('server.js', 'utf8').split('\n');
    for (let i = 9550; i < 9650 && i < lines.length; i++) {
      console.log(`[server.js:${i + 1}] ${lines[i]}`);
    }
  }

  console.log('\n==================================================');
  console.log('3. Purchasing.tsx: LINES 705-745 (PDF RECEIPT METADATA)');
  console.log('==================================================');
  const poFile = 'src/pages/Purchasing.tsx';
  if (fs.existsSync(poFile)) {
    const lines = fs.readFileSync(poFile, 'utf8').split('\n');
    for (let i = 705; i < 745 && i < lines.length; i++) {
      console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
    }
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
