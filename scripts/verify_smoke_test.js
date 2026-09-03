import dbAdapter, { initDb, getTursoClient } from '../src/db/connection.js';
import { enqueueSync, pushUpstreamChanges, pullDownstreamChanges } from '../src/services/syncService.js';

async function main() {
  console.log('🧪 Starting Part 4 Smoke & Verification Test...\n');
  const db = await initDb();
  const turso = getTursoClient();

  if (!turso) {
    throw new Error('Turso client is unavailable!');
  }

  // --- 1. Baseline Zero Verification ---
  console.log('--- STEP 1: Verify Baseline Zero Counts ---');
  const localProdCount = await db.get("SELECT COUNT(*) as count FROM products");
  const localSalesCount = await db.get("SELECT COUNT(*) as count FROM sales");
  const localProfCount = await db.get("SELECT COUNT(*) as count FROM profiles");

  const remoteProdRes = await turso.execute("SELECT COUNT(*) as count FROM products");
  const remoteSalesRes = await turso.execute("SELECT COUNT(*) as count FROM sales");
  const remoteProfRes = await turso.execute("SELECT COUNT(*) as count FROM profiles");

  const rProd = Number(remoteProdRes?.rows?.[0]?.count ?? 0);
  const rSales = Number(remoteSalesRes?.rows?.[0]?.count ?? 0);
  const rProf = Number(remoteProfRes?.rows?.[0]?.count ?? 0);

  console.log(`Local SQLite -> Products: ${localProdCount.count}, Sales: ${localSalesCount.count}, Profiles: ${localProfCount.count}`);
  console.log(`Turso Cloud  -> Products: ${rProd}, Sales: ${rSales}, Profiles: ${rProf}`);

  if (localProdCount.count !== 0 || rProd !== 0) throw new Error('Products count is not 0!');
  if (localSalesCount.count !== 0 || rSales !== 0) throw new Error('Sales count is not 0!');
  if (localProfCount.count !== 1 || rProf !== 1) throw new Error('Profiles count is not 1!');
  console.log('✅ STEP 1 PASSED: Baseline zero confirmed on both local and cloud!\n');

  // --- 2. Offline Sale Simulation ---
  console.log('--- STEP 2: Simulating Offline Counter Sale ---');
  const testSaleId = 'so_smoke_' + Date.now();
  const testInvoice = 'INV_SMOKE_001';
  const saleAmount = 3500;
  const nowIso = new Date().toISOString();

  await db.run(
    `INSERT INTO sales (id, invoice_no, total_amount, payment_method, status, items, created_at)
     VALUES (?, ?, ?, 'Cash', 'Paid', '[]', ?)`,
    [testSaleId, testInvoice, saleAmount, nowIso]
  );

  await enqueueSync(db, 'sales', testSaleId, 'UPSERT');

  const pendingCount = await db.get("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'");
  console.log(`Queued local mutations: ${pendingCount.count}`);
  if (Number(pendingCount.count) !== 1) {
    throw new Error(`Expected 1 pending mutation, got ${pendingCount.count}`);
  }
  console.log('✅ STEP 2 PASSED: Offline sale successfully queued locally with pending count = 1.\n');

  // --- 3. Connection Restore & Upstream Flush ---
  console.log('--- STEP 3: Connection Restored -> Flushing Upstream Queue ---');
  await pushUpstreamChanges(db, turso);

  const pendingAfter = await db.get("SELECT COUNT(*) as count FROM sync_queue WHERE status = 'PENDING'");
  console.log(`Remaining pending mutations locally: ${pendingAfter.count}`);
  if (Number(pendingAfter.count) !== 0) {
    throw new Error(`Expected 0 pending mutations, got ${pendingAfter.count}`);
  }

  const cloudSale = await turso.execute({
    sql: "SELECT id, invoice_no, total_amount FROM sales WHERE id = ?",
    args: [testSaleId]
  });

  if (!cloudSale?.rows || cloudSale.rows.length === 0) {
    throw new Error('Sale record was not received by Turso Cloud!');
  }
  console.log(`Turso Cloud verified record: Invoice ${cloudSale.rows[0].invoice_no}, Rs. ${cloudSale.rows[0].total_amount}`);
  console.log('✅ STEP 3 PASSED: Flushed to Turso Cloud, local queue returned to 0.\n');

  // Clean up smoke test sale to restore clean zero baseline
  console.log('--- STEP 4: Restoring Clean Zero Baseline ---');
  await turso.execute({ sql: "DELETE FROM sales WHERE id = ?", args: [testSaleId] });
  await db.run("DELETE FROM sales WHERE id = ?", [testSaleId]);
  await db.run("DELETE FROM sync_queue WHERE record_id = ?", [testSaleId]);

  console.log('✅ STEP 4 PASSED: Clean zero baseline restored.');
  console.log('\n🎉 ALL SMOKE TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Smoke Test Failed:', err);
  process.exit(1);
});
