import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function run() {
  console.log('==================================================');
  console.log('1. EXISTING PURCHASE ORDERS IN hardware.db');
  console.log('==================================================');
  try {
    const db = await open({ filename: './hardware.db', driver: sqlite3.Database });
    const pos = await db.all('SELECT id, po_number, supplier_name, status, received_at, received_by, settlement_mode, payment_method, transportation_fee, net_total, total FROM purchase_orders ORDER BY rowid DESC LIMIT 5');
    console.log(JSON.stringify(pos, null, 2));
    await db.close();
  } catch (err) {
    console.error('DB query error:', err.message);
  }

  console.log('\n==================================================');
  console.log('2. server.js: LINES 9645-9700 (Transaction Commit & Return)');
  console.log('==================================================');
  if (fs.existsSync('server.js')) {
    const lines = fs.readFileSync('server.js', 'utf8').split('\n');
    for (let i = 9645; i < 9700 && i < lines.length; i++) {
      console.log(`[server.js:${i + 1}] ${lines[i]}`);
    }
  }

  console.log('\n==================================================');
  console.log('3. Purchasing.tsx: LINES 1220-1270 (Client Receive Fallback)');
  console.log('==================================================');
  const poFile = 'src/pages/Purchasing.tsx';
  if (fs.existsSync(poFile)) {
    const lines = fs.readFileSync(poFile, 'utf8').split('\n');
    for (let i = 1220; i < 1270 && i < lines.length; i++) {
      console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
    }
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
