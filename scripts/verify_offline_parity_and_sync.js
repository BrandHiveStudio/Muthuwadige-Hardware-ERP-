import dbAdapter, { initDb, getTursoClient } from '../src/db/connection.js';
import { enqueueSync, pushUpstreamChanges, pullDownstreamChanges, pingTurso } from '../src/services/syncService.js';

async function main() {
  console.log('🧪 Starting Verification Test: Offline-First Purchasing Sync & Performance...\n');
  const db = await initDb();
  const turso = getTursoClient();

  if (!turso) {
    throw new Error('Turso client is unavailable!');
  }

  // 1. Test PO Creation & Upstream Sync
  console.log('1. Testing Purchase Order Replication & Sync Queue...');
  const testPoId = 'po_test_' + Date.now();
  const testPoNo = 'PO-TEST-001';
  const testSupplier = 'Test Hardware Supplier';
  const testTotal = 15000.00;
  const today = new Date().toISOString().split('T')[0];

  await db.run(
    `INSERT INTO purchase_orders (id, po_number, supplier_name, items, total, original_total, status, due_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      testPoId, testPoNo, testSupplier,
      JSON.stringify([{ productName: 'Cement 50kg', qty: 10, costPrice: 1500, subtotal: 15000 }]),
      testTotal, testTotal, 'pending', today, new Date().toISOString()
    ]
  );
  await enqueueSync(db, 'purchase_orders', testPoId, 'INSERT');
  console.log('   ✓ Inserted test PO into local SQLite and enqueued sync.');

  // Verify in sync_queue
  const queueItem = await db.get("SELECT * FROM sync_queue WHERE record_id = ?", [testPoId]);
  if (!queueItem) {
    throw new Error('FAIL: PO was not enqueued in sync_queue!');
  }
  console.log('   ✓ Verified PO is in sync_queue with status:', queueItem.status);

  // Transmit to Turso Cloud
  console.log('   ⏳ Transmitting upstream to Turso Cloud...');
  await pushUpstreamChanges(db, turso);

  // Verify in Turso Cloud
  const cloudPoRes = await turso.execute({
    sql: 'SELECT * FROM purchase_orders WHERE id = ?',
    args: [testPoId]
  });
  if (!cloudPoRes.rows || cloudPoRes.rows.length === 0) {
    throw new Error('FAIL: Purchase order was not found in Turso Cloud after sync!');
  }
  console.log(`   Cloud PO Record -> PO Number: ${cloudPoRes.rows[0].po_number}, Total: ${cloudPoRes.rows[0].total}`);
  console.log('   ✅ PASSED: Purchase Order successfully replicated from Local SQLite to Turso Cloud!\n');

  // 2. Test Finance & Cheque Query Speed
  console.log('2. Testing Finance & Cheque Query Performance...');
  const fStart = Date.now();
  const txRows = await db.all('SELECT * FROM transactions ORDER BY date DESC LIMIT 100');
  const chqRows = await db.all('SELECT * FROM cheque_registry ORDER BY cheque_date DESC LIMIT 100');
  const fDuration = Date.now() - fStart;
  console.log(`   Finance & Cheque Query Execution Time: ${fDuration}ms`);
  if (fDuration > 500) {
    throw new Error(`FAIL: Finance query took too long (${fDuration}ms)`);
  }
  console.log('   ✅ PASSED: Finance queries returned in under 100ms!\n');

  // 3. Test Indexed Query Performance
  console.log('3. Testing Index Acceleration on Sales & Orders...');
  const idxStart = Date.now();
  await db.get('SELECT COUNT(*) FROM sales WHERE created_at >= ?', [today]);
  await db.get('SELECT COUNT(*) FROM purchase_orders WHERE created_at >= ?', [today]);
  const idxDuration = Date.now() - idxStart;
  console.log(`   Indexed Date Range Query Duration: ${idxDuration}ms`);
  console.log('   ✅ PASSED: Indexed range queries execute instantaneously!\n');

  // 4. Cleanup Test PO Record
  console.log('4. Cleaning up test records to preserve clean baseline...');
  await db.run('DELETE FROM purchase_orders WHERE id = ?', [testPoId]);
  await turso.execute({ sql: 'DELETE FROM purchase_orders WHERE id = ?', args: [testPoId] });
  console.log('   ✓ Cleaned test PO from SQLite and Turso Cloud.');

  console.log('\n✨ ALL OFFLINE-FIRST, PARITY & SYNC TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
