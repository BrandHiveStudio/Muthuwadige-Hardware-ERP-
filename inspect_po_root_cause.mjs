import fs from 'fs';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function run() {
  console.log('==================================================');
  console.log('1. LIVE RECORD: PO-660409 in hardware.db');
  console.log('==================================================');
  try {
    const db = await open({ filename: './hardware.db', driver: sqlite3.Database });
    const po = await db.get('SELECT * FROM purchase_orders WHERE po_number LIKE "%660409%" OR id LIKE "%660409%"');
    console.log('purchase_orders row:', JSON.stringify(po, null, 2));

    const chq = await db.all('SELECT * FROM cheque_registry WHERE reference_id LIKE "%660409%" OR id LIKE "%660409%"');
    console.log('cheque_registry rows:', JSON.stringify(chq, null, 2));
    await db.close();
  } catch (err) {
    console.error('DB query error:', err.message);
  }

  console.log('\n==================================================');
  console.log('2. Purchasing.tsx: PDF Calculation & Fees (Lines 660-705)');
  console.log('==================================================');
  const poFile = 'src/pages/Purchasing.tsx';
  if (fs.existsSync(poFile)) {
    const lines = fs.readFileSync(poFile, 'utf8').split('\n');
    for (let i = 660; i < 705 && i < lines.length; i++) {
      console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
    }
  }

  console.log('\n==================================================');
  console.log('3. Purchasing.tsx: handleReceivePurchaseOrder Payload (Lines 1130-1175)');
  console.log('==================================================');
  if (fs.existsSync(poFile)) {
    const lines = fs.readFileSync(poFile, 'utf8').split('\n');
    for (let i = 1130; i < 1175 && i < lines.length; i++) {
      console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
    }
  }

  console.log('\n==================================================');
  console.log('4. server.js: Backend Receive PO Endpoint (/api/purchasing/receive-po)');
  console.log('==================================================');
  if (fs.existsSync('server.js')) {
    const lines = fs.readFileSync('server.js', 'utf8').split('\n');
    lines.forEach((l, idx) => {
      if (l.includes("receive-po") || l.includes("'/api/purchase-orders/:id/receive'")) {
        console.log(`Found receive-po route at line ${idx + 1}: ${l.trim()}`);
        for (let j = idx; j < idx + 45 && j < lines.length; j++) {
          console.log(`  [server.js:${j + 1}] ${lines[j]}`);
        }
      }
    });
  }
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
