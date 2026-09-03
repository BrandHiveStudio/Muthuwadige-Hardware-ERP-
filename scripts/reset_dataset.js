import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'hardware.db');

async function resetDatabase() {
  console.log('======================================================================');
  console.log('🧹 EXECUTING PRODUCTION DATASET RESET & INITIAL BALANCE VERIFICATION');
  console.log('======================================================================\n');

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  try {
    await db.exec('BEGIN TRANSACTION;');

    // 1. Purge Transactional Tables
    const tablesToPurge = [
      'sales',
      'sales_returns',
      'credit_notes',
      'credit_note_usage',
      'credit_payments',
      'purchase_orders',
      'purchase_returns',
      'purchase_return_items',
      'cheque_registry',
      'transactions',
      'audit_logs',
      'stock_adjustments',
      'bill_holds',
      'quotations',
      'delivery_notes',
      'backup_logs'
    ];

    for (const table of tablesToPurge) {
      try {
        await db.exec(`DELETE FROM "${table}";`);
        console.log(`- Purged table: ${table}`);
      } catch (err) {
        console.warn(`- Notice on table ${table}: ${err.message}`);
      }
    }

    // 2. Reset Quantities and Opening Balances
    await db.exec("UPDATE products SET stock = 0;");
    await db.exec("UPDATE customers SET credit_balance = 0, current_credit = 0, total_purchases = 0;");
    await db.exec("UPDATE suppliers SET payable_balance = 0;");

    await db.exec('COMMIT;');
    console.log('\n✅ All transactional tables purged successfully and balances reset to zero.');

    // 3. Verify Clean Zero Balances
    console.log('\n--- VERIFYING INITIAL ZERO BALANCES & MASTER INTEGRITY ---');

    const totalTransactions = (await db.get("SELECT COUNT(*) as count FROM transactions")).count;
    const totalSales = (await db.get("SELECT COUNT(*) as count FROM sales")).count;
    const totalReturns = (await db.get("SELECT COUNT(*) as count FROM sales_returns")).count;
    const totalPOs = (await db.get("SELECT COUNT(*) as count FROM purchase_orders")).count;
    const totalPRs = (await db.get("SELECT COUNT(*) as count FROM purchase_returns")).count;
    const totalCheques = (await db.get("SELECT COUNT(*) as count FROM cheque_registry")).count;

    const totalStock = (await db.get("SELECT COALESCE(SUM(stock), 0) as total FROM products")).total;
    const totalCustomerCredit = (await db.get("SELECT COALESCE(SUM(current_credit), 0) + COALESCE(SUM(credit_balance), 0) as total FROM customers")).total;
    const totalSupplierPayables = (await db.get("SELECT COALESCE(SUM(payable_balance), 0) as total FROM suppliers")).total;

    // Cash Ledger Sum
    const cashIncome = (await db.get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type='income'")).total;
    const cashExpense = (await db.get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type='expense'")).total;
    const netCashBalance = cashIncome - cashExpense;

    // Master Config Integrity Check
    const profileCount = (await db.get("SELECT COUNT(*) as count FROM profiles")).count;
    const permCount = (await db.get("SELECT COUNT(*) as count FROM custom_permissions")).count;
    const settingsRow = await db.get("SELECT shop_name, address, phone FROM system_settings WHERE id = 'global'");

    console.log(`- Transaction Count: ${totalTransactions} (Expected: 0)`);
    console.log(`- Sales Invoices Count: ${totalSales} (Expected: 0)`);
    console.log(`- Sales Returns Count: ${totalReturns} (Expected: 0)`);
    console.log(`- Purchase Orders Count: ${totalPOs} (Expected: 0)`);
    console.log(`- Purchase Returns Count: ${totalPRs} (Expected: 0)`);
    console.log(`- Cheques in Registry: ${totalCheques} (Expected: 0)`);
    console.log(`- Inventory Total Stock: ${totalStock} units (Expected: 0)`);
    console.log(`- Customer Debt Total: Rs. ${totalCustomerCredit.toFixed(2)} (Expected: Rs. 0.00)`);
    console.log(`- Supplier Payables Total: Rs. ${totalSupplierPayables.toFixed(2)} (Expected: Rs. 0.00)`);
    console.log(`- Cash Book Ledger Balance: Rs. ${netCashBalance.toFixed(2)} (Expected: Rs. 0.00)`);
    console.log(`- Profiles Preserved: ${profileCount} profile(s)`);
    console.log(`- Permissions Preserved: ${permCount} role definition(s)`);
    console.log(`- Store Branding Preserved: "${settingsRow?.shop_name || 'MUTHUWADIGE HARDWARE'}" at "${settingsRow?.address || 'No: 80, Mahahunupitiya, Negombo'}"`);

    const isCleanZero = (
      totalTransactions === 0 &&
      totalSales === 0 &&
      totalReturns === 0 &&
      totalPOs === 0 &&
      totalPRs === 0 &&
      totalCheques === 0 &&
      totalStock === 0 &&
      totalCustomerCredit === 0 &&
      totalSupplierPayables === 0 &&
      netCashBalance === 0 &&
      profileCount > 0 &&
      permCount > 0
    );

    if (isCleanZero) {
      console.log('\n🎉 ALL CHECKS PASSED: Database is in a pristine, zero-balance production initial state!');
    } else {
      console.error('\n❌ WARNING: Some balances or rows did not evaluate to zero!');
      process.exit(1);
    }
  } catch (err) {
    await db.exec('ROLLBACK;');
    console.error('Database reset error:', err);
    process.exit(1);
  } finally {
    await db.close();
  }
}

resetDatabase();
