import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function run() {
  console.log('==================================================');
  console.log('1. SEARCHING ALL TABLES FOR "660409" IN hardware.db');
  console.log('==================================================');
  try {
    const db = await open({ filename: './hardware.db', driver: sqlite3.Database });
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    
    for (const t of tables) {
      try {
        const rows = await db.all(`SELECT * FROM "${t.name}" WHERE id LIKE '%660409%' OR rowid IN (SELECT rowid FROM "${t.name}" WHERE CAST(rowid AS TEXT) LIKE '%660409%')`);
        if (rows && rows.length > 0) {
          console.log(`Found in table "${t.name}":`, JSON.stringify(rows, null, 2));
        }
      } catch (_) {
        // Search text columns
        try {
          const cols = await db.all(`PRAGMA table_info("${t.name}")`);
          const textCols = cols.filter(c => c.type.includes('CHAR') || c.type.includes('TEXT') || c.type === '').map(c => `"${c.name}" LIKE '%660409%'`);
          if (textCols.length > 0) {
            const r = await db.all(`SELECT * FROM "${t.name}" WHERE ${textCols.join(' OR ')}`);
            if (r && r.length > 0) {
              console.log(`Found in table "${t.name}":`, JSON.stringify(r, null, 2));
            }
          }
        } catch (_) {}
      }
    }
    await db.close();
  } catch (err) {
    console.error('DB search error:', err.message);
  }

  console.log('\n==================================================');
  console.log('2. server.js: Rest of /api/purchasing/receive-po (Lines 9460-9550)');
  console.log('==================================================');
  if (fs.existsSync('server.js')) {
    const lines = fs.readFileSync('server.js', 'utf8').split('\n');
    for (let i = 9460; i < 9550 && i < lines.length; i++) {
      console.log(`[server.js:${i + 1}] ${lines[i]}`);
    }
  }

  console.log('\n==================================================');
  console.log('3. Purchasing.tsx: Lines 635-675 (downloadPO_PDF setup & shippingFee definition)');
  console.log('==================================================');
  const poFile = 'src/pages/Purchasing.tsx';
  if (fs.existsSync(poFile)) {
    const lines = fs.readFileSync(poFile, 'utf8').split('\n');
    for (let i = 635; i < 675 && i < lines.length; i++) {
      console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
    }
  }

  console.log('\n==================================================');
  console.log('4. Purchasing.tsx: How PO creation saves transport fees (handleCreatePO / handleSavePO)');
  console.log('==================================================');
  if (fs.existsSync(poFile)) {
    const content = fs.readFileSync(poFile, 'utf8');
    const lines = content.split('\n');
    lines.forEach((l, idx) => {
      if (l.includes('shipping_cost') || l.includes('shippingCost') || l.includes('transportation_fee')) {
        for (let j = Math.max(0, idx - 1); j < idx + 4 && j < lines.length; j++) {
          console.log(`  [Purchasing.tsx:${j + 1}] ${lines[j].trim()}`);
        }
      }
    });
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
