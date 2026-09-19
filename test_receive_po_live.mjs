import fs from 'fs';
import { getDb } from './src/db/connection.js';

async function testReceivePoFlow() {
  console.log('==================================================');
  console.log('1. INSPECTING LOCAL SQLITE TABLES & COLUMNS');
  console.log('==================================================');
  const db = await getDb();
  
  const tables = ['purchase_orders', 'cheque_registry', 'transactions', 'stock_adjustments', 'audit_logs', 'products'];
  for (const t of tables) {
    try {
      const cols = await db.all(`PRAGMA table_info(${t})`);
      console.log(`Table [${t}] columns:`, cols.map(c => c.name).join(', '));
    } catch (e) {
      console.log(`Table [${t}] PRAGMA error:`, e.message);
    }
  }

  console.log('\n==================================================');
  console.log('2. TESTING db.transaction BEHAVIOR ON LOCAL SQLITE');
  console.log('==================================================');
  try {
    let innerRan = false;
    const res = await db.transaction(async () => {
      innerRan = true;
      const testGet = await db.get('SELECT 1 as test');
      return { success: true, testGet };
    });
    console.log('db.transaction result:', res, 'innerRan:', innerRan);
  } catch (txErr) {
    console.error('❌ db.transaction FAILED on local SQLite:', txErr.message);
  }

  console.log('\n==================================================');
  console.log('3. TESTING resolveOrCreateBatchProduct CALL');
  console.log('==================================================');
  // Check how resolveOrCreateBatchProduct is defined in server.js
  const serverContent = fs.readFileSync('server.js', 'utf8');
  const lines = serverContent.split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('function resolveOrCreateBatchProduct') || l.includes('const resolveOrCreateBatchProduct =')) {
      for (let j = idx; j < idx + 40 && j < lines.length; j++) {
        console.log(`[server.js:${j + 1}] ${lines[j]}`);
      }
    }
  });

  console.log('\n==================================================');
  console.log('4. TESTING INSERT INTO cheque_registry WITH TEST DATA');
  console.log('==================================================');
  try {
    // Check if cheque_registry exists and allows insert
    const testChqId = 'TEST_CHQ_' + Date.now();
    await db.run(
      `INSERT INTO cheque_registry (
        id, direction, cheque_type, cheque_number, bank_name, branch,
        cheque_date, amount, party_id, party_name, reference_type,
        reference_id, status, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        testChqId, 'OUTWARD', 'CROSSED_ACCOUNT_PAYEE', 'CHQ-999999', 'Commercial Bank', '',
        '2026-09-19', 1000, 'supp_test', 'Test Supplier', 'PURCHASE_ORDER',
        'PO-TEST', 'PENDING', 'Test Notes', 'Admin', new Date().toISOString()
      ]
    );
    console.log('✅ cheque_registry insert succeeded!');
    await db.run('DELETE FROM cheque_registry WHERE id = ?', [testChqId]);
  } catch (chqErr) {
    console.error('❌ cheque_registry insert FAILED:', chqErr.message);
  }

  process.exit(0);
}

testReceivePoFlow().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
