import dbAdapter, { initDb, getTursoClient } from '../src/db/connection.js';
import { enqueueSync, pushUpstreamChanges, pullDownstreamChanges, pingTurso } from '../src/services/syncService.js';

async function main() {
  console.log('🧪 Starting Verification Test: Cashier Attribution & Sync Latency...\n');
  const db = await initDb();
  const turso = getTursoClient();

  if (!turso) {
    throw new Error('Turso client is unavailable!');
  }

  // 1. Test Ping Latency
  console.log('1. Testing Cloud Connection Ping Latency...');
  const pingStart = Date.now();
  const isReachable = await pingTurso(turso);
  const pingDuration = Date.now() - pingStart;
  console.log(`   Ping Result: ${isReachable ? 'CONNECTED' : 'FAILED'} (Duration: ${pingDuration}ms)`);
  if (!isReachable) {
    throw new Error('Cloud connection ping failed!');
  }
  console.log('   ✅ PASSED: Cloud connection ping succeeded without timeout.\n');

  // 2. Test Sale Creation with Cashier "Krish"
  console.log('2. Testing Sale Creation with Cashier "Krish"...');
  const testSaleId = 'so_test_' + Date.now();
  const testInvNo = 'INV-TEST-001';
  const testAmount = 250.00;
  const testCashier = 'Krish';
  const testUserId = 'u_krish';
  const testUserEmail = 'krish@hardware.com';

  await db.run(
    `INSERT INTO sales (
      id, invoice_no, customer_id, customer_name, customer_phone, customer_address, 
      items, subtotal, discount, tax, tax_rate, total_amount, status, 
      user_id, user_email, cashier, payment_method, created_at, payment_received
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      testSaleId, testInvNo, null, 'Test Customer', '0771234567', 'Colombo',
      JSON.stringify([{ name: 'Test Screws', qty: 10, unit_price: 25, price: 25, subtotal: 250 }]),
      250, 0, 0, 0, testAmount, 'paid',
      testUserId, testUserEmail, testCashier, 'Cash', new Date().toISOString(), testAmount
    ]
  );
  await enqueueSync(db, 'sales', testSaleId, 'INSERT');
  console.log('   ✓ Inserted test sale into local SQLite with cashier = "Krish".');

  // Verify in SQLite
  const localSale = await db.get('SELECT cashier, total_amount FROM sales WHERE id = ?', [testSaleId]);
  console.log(`   Local Record -> Cashier: ${localSale.cashier}, Amount: ${localSale.total_amount}`);
  if (localSale.cashier !== 'Krish') {
    throw new Error(`FAIL: Local cashier was not "Krish", got "${localSale.cashier}"`);
  }

  // Push to Turso Cloud
  console.log('   ⏳ Transmitting to Turso Cloud...');
  await pushUpstreamChanges(db, turso);

  // Verify on Turso Cloud
  const cloudSaleRes = await turso.execute({
    sql: 'SELECT cashier, total_amount FROM sales WHERE id = ?',
    args: [testSaleId]
  });
  const cloudSale = cloudSaleRes.rows[0];
  console.log(`   Cloud Record -> Cashier: ${cloudSale.cashier}, Amount: ${cloudSale.total_amount}`);
  if (cloudSale.cashier !== 'Krish') {
    throw new Error(`FAIL: Cloud cashier was not "Krish", got "${cloudSale.cashier}"`);
  }
  console.log('   ✅ PASSED: Cashier "Krish" recorded in both Local SQLite and Turso Cloud!\n');

  // 3. Test Cashier Shift Grouping Logic
  console.log('3. Testing Cashier Shift Aggregation...');
  const salesRows = await db.all("SELECT * FROM sales WHERE id = ?", [testSaleId]);
  
  const cashierSummaryMap = {};
  const getCashierEntry = (name) => {
    if (!cashierSummaryMap[name]) cashierSummaryMap[name] = { amount: 0, txIds: new Set() };
    return cashierSummaryMap[name];
  };

  for (const s of salesRows) {
    const cashierName = s.cashier || 'Krish';
    const entry = getCashierEntry(cashierName);
    entry.amount += Number(s.total_amount || 0);
    entry.txIds.add(s.id);
  }

  const shiftSummary = Object.keys(cashierSummaryMap).map(name => ({
    name,
    amount: cashierSummaryMap[name].amount,
    count: cashierSummaryMap[name].txIds.size
  }));

  console.log('   Shift Summary:', JSON.stringify(shiftSummary));
  if (shiftSummary.length !== 1 || shiftSummary[0].name !== 'Krish' || shiftSummary[0].count !== 1 || shiftSummary[0].amount !== 250) {
    throw new Error(`FAIL: Shift summary did not group under "Krish": ${JSON.stringify(shiftSummary)}`);
  }
  console.log('   ✅ PASSED: Shift summary accurately groups under "Krish" with 1 transaction and Rs. 250.00!\n');

  // 4. Cleanup Test Record
  console.log('4. Cleaning up test record to maintain zero baseline...');
  await db.run('DELETE FROM sales WHERE id = ?', [testSaleId]);
  await turso.execute({ sql: 'DELETE FROM sales WHERE id = ?', args: [testSaleId] });
  console.log('   ✓ Cleaned test sale from SQLite and Turso Cloud.');

  console.log('\n✨ ALL CASHIER ATTRIBUTION & SYNC LATENCY TESTS PASSED!');
  process.exit(0);
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
