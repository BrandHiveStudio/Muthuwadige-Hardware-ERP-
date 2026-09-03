import dbAdapter, { initDb, getTursoClient } from '../src/db/connection.js';
import { enqueueSync, pushUpstreamChanges, pullDownstreamChanges } from '../src/services/syncService.js';

async function main() {
  console.log('🧪 Starting Verification Test: Elimination of Zombie Deletion Loop...\n');
  const db = await initDb();
  const turso = getTursoClient();

  if (!turso) {
    throw new Error('Turso client is unavailable!');
  }

  // --- SCENARIO 1: Cloud Deletion -> Prunes Locally -> No Resurrection Upstream ---
  console.log('================================================================');
  console.log('SCENARIO 1: Delete on Cloud -> Replicates Downstream -> Zero Resurrection');
  console.log('================================================================');

  const testCustId1 = 'c_cloud_del_' + Date.now();
  const testName1 = 'Test Deletion User 1';
  const testPhone1 = '0779998881';

  // 1. Insert test customer into BOTH Local SQLite and Turso Cloud
  await db.run(
    'INSERT INTO customers (id, name, phone, address, nic) VALUES (?, ?, ?, ?, ?)',
    [testCustId1, testName1, testPhone1, 'Colombo', '999888777V']
  );
  await turso.execute({
    sql: 'INSERT OR REPLACE INTO customers (id, name, phone, address, nic) VALUES (?, ?, ?, ?, ?)',
    args: [testCustId1, testName1, testPhone1, 'Colombo', '999888777V']
  });
  console.log('  ✓ Inserted test customer into both Local SQLite and Turso Cloud.');

  let localCheck1 = await db.get('SELECT COUNT(*) as count FROM customers WHERE id = ?', [testCustId1]);
  let cloudCheck1 = await turso.execute({ sql: 'SELECT COUNT(*) as count FROM customers WHERE id = ?', args: [testCustId1] });
  console.log(`    Before delete -> Local: ${localCheck1.count}, Cloud: ${cloudCheck1.rows[0].count}`);

  // 2. Delete customer on Turso Cloud (simulating cloud-side delete)
  await turso.execute({ sql: 'DELETE FROM customers WHERE id = ?', args: [testCustId1] });
  console.log('  ✓ Deleted customer directly on Turso Cloud.');

  // 3. Execute pullDownstreamChanges() -> Local customer MUST be pruned!
  console.log('  ⏳ Running pullDownstreamChanges()...');
  await pullDownstreamChanges(db, turso);

  localCheck1 = await db.get('SELECT COUNT(*) as count FROM customers WHERE id = ?', [testCustId1]);
  console.log(`    After downstream sync -> Local customer count for ${testCustId1}: ${localCheck1.count}`);
  if (Number(localCheck1.count) !== 0) {
    throw new Error(`FAIL: Local customer was NOT pruned after cloud deletion! Count: ${localCheck1.count}`);
  }
  console.log('  ✅ PASSED: Local SQLite customer was successfully pruned!');

  // 4. Execute pushUpstreamChanges() -> Must NOT resurrect on Turso Cloud!
  console.log('  ⏳ Running pushUpstreamChanges()...');
  await pushUpstreamChanges(db, turso);

  cloudCheck1 = await turso.execute({ sql: 'SELECT COUNT(*) as count FROM customers WHERE id = ?', args: [testCustId1] });
  console.log(`    After upstream push -> Cloud customer count for ${testCustId1}: ${cloudCheck1.rows[0].count}`);
  if (Number(cloudCheck1.rows[0].count) !== 0) {
    throw new Error(`FAIL: Zombie resurrected! Cloud customer was re-inserted: ${cloudCheck1.rows[0].count}`);
  }
  console.log('  ✅ PASSED: No zombie resurrection on Turso Cloud!\n');

  // --- SCENARIO 2: Local Deletion Enqueued -> Pushes Upstream -> Deletes in Turso ---
  console.log('================================================================');
  console.log('SCENARIO 2: Delete Locally -> Pushes Upstream -> Deletes in Turso');
  console.log('================================================================');

  const testCustId2 = 'c_local_del_' + Date.now();
  const testName2 = 'Test Deletion User 2';
  const testPhone2 = '0779998882';

  // 1. Insert test customer into BOTH Local SQLite and Turso Cloud
  await db.run(
    'INSERT INTO customers (id, name, phone, address, nic) VALUES (?, ?, ?, ?, ?)',
    [testCustId2, testName2, testPhone2, 'Kandy', '888777666V']
  );
  await turso.execute({
    sql: 'INSERT OR REPLACE INTO customers (id, name, phone, address, nic) VALUES (?, ?, ?, ?, ?)',
    args: [testCustId2, testName2, testPhone2, 'Kandy', '888777666V']
  });
  console.log('  ✓ Inserted test customer into both Local SQLite and Turso Cloud.');

  // 2. Delete locally and enqueue deletion mutation
  await db.run('DELETE FROM customers WHERE id = ?', [testCustId2]);
  await enqueueSync(db, 'customers', testCustId2, 'DELETE');
  console.log('  ✓ Deleted locally and queued DELETE mutation.');

  // 3. Execute pushUpstreamChanges() -> Must delete on Turso Cloud!
  console.log('  ⏳ Running pushUpstreamChanges()...');
  await pushUpstreamChanges(db, turso);

  const cloudCheck2 = await turso.execute({ sql: 'SELECT COUNT(*) as count FROM customers WHERE id = ?', args: [testCustId2] });
  console.log(`    After upstream push -> Cloud customer count for ${testCustId2}: ${cloudCheck2.rows[0].count}`);
  if (Number(cloudCheck2.rows[0].count) !== 0) {
    throw new Error(`FAIL: Local deletion did not propagate to Turso Cloud! Count: ${cloudCheck2.rows[0].count}`);
  }
  console.log('  ✅ PASSED: Local deletion successfully propagated to Turso Cloud!\n');

  // --- FINAL CHECK: Zero Baseline Preserved ---
  const finalLocalCust = await db.get('SELECT COUNT(*) as count FROM customers');
  const finalCloudCust = await turso.execute('SELECT COUNT(*) as count FROM customers');
  console.log(`Final Customer Count -> Local: ${finalLocalCust.count}, Cloud: ${finalCloudCust.rows[0].count}`);

  if (Number(finalLocalCust.count) === 0 && Number(finalCloudCust.rows[0].count) === 0) {
    console.log('✨ 100% SUCCESS: Clean baseline zero confirmed, Zombie Deletion Loop eliminated.');
  } else {
    throw new Error('Final counts are not zero!');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
