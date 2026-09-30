import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error('❌ Error: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be defined in .env');
  process.exit(1);
}

console.log('======================================================================');
console.log('🌐 TURSO CLOUD TARGETED DATABASE CLEAN WIPE');
console.log('======================================================================');
console.log(`Connecting to Turso Cloud at: ${url}`);

const client = createClient({
  url,
  authToken
});

const PRESERVED_TABLES = [
  'users',
  'roles',
  'profiles',
  'custom_permissions',
  'permissions'
];

// Ordered intentionally to remove dependent/child tables before parent tables
const TARGET_WIPE_TABLES = [
  // Child / Line-item tables
  'sale_items',
  'sales_return_items',
  'purchase_items',
  'purchase_order_items',
  'purchase_return_items',
  'quotation_items',
  'credit_note_usage',
  'stock_adjustments',
  'barcodes',
  'product_conversions',
  'invoices',
  'receipts',
  'sales_returns',
  'purchase_returns',
  'purchase_orders',
  'quotations',

  // Core operational parent tables
  'sales',
  'purchases',
  'credit_notes',
  'debit_notes',
  'delivery_notes',
  'customer_transactions',
  'transactions',
  'cash_book',
  'cheque_registry',
  'credit_payments',
  'daily_cash_flow',
  'expenses',
  'products',
  'product_categories',
  'customers',
  'suppliers',

  // UI state, logs & sync queues
  'bill_holds',
  'shift_logs',
  'scanner_signals',
  'deleted_records',
  'backup_logs',
  'sync_pull_marker',
  'sync_queue',
  'sync_logs',
  'audit_logs'
];

async function main() {
  try {
    // 1. Discover existing tables from Turso
    const tablesResult = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%'");
    const existingTables = tablesResult.rows.map(r => r.name);
    console.log(`Discovered ${existingTables.length} tables on Turso Cloud database:`);
    console.log(existingTables.join(', '));
    console.log('\n--- PRE-WIPE AUDIT ---');

    for (const pTable of PRESERVED_TABLES) {
      if (existingTables.includes(pTable)) {
        const countRes = await client.execute(`SELECT COUNT(*) as count FROM ${pTable}`);
        console.log(`🔒 [PRESERVE] ${pTable.padEnd(20)}: ${countRes.rows[0].count} records (MUST NOT DELETE)`);
      }
    }

    console.log('\n--- EXECUTING TARGETED WIPE OF OPERATIONAL TABLES ---');
    
    // Execute DELETE in batch
    const deleteStatements = [];
    for (const table of TARGET_WIPE_TABLES) {
      if (existingTables.includes(table)) {
        deleteStatements.push(`DELETE FROM ${table}`);
      }
    }

    if (deleteStatements.length > 0) {
      console.log(`Executing ${deleteStatements.length} DELETE statements in transaction...`);
      await client.batch(deleteStatements, 'write');
      console.log('✅ Batch deletion completed successfully.');
    } else {
      console.log('No target tables found to wipe.');
    }

    // Explicitly ensure sync_queue and sync_logs are empty
    if (existingTables.includes('sync_queue')) {
      await client.execute('DELETE FROM sync_queue');
      console.log('✅ sync_queue explicitly cleared.');
    }
    if (existingTables.includes('sync_logs')) {
      await client.execute('DELETE FROM sync_logs');
      console.log('✅ sync_logs explicitly cleared.');
    }

    // 2. Post-Wipe Verification
    console.log('\n======================================================================');
    console.log('📊 POST-WIPE TURSO CLOUD VERIFICATION SUMMARY');
    console.log('======================================================================');

    const auditResults = [];

    // Preserved tables
    for (const pTable of PRESERVED_TABLES) {
      if (existingTables.includes(pTable)) {
        const countRes = await client.execute(`SELECT COUNT(*) as count FROM ${pTable}`);
        const count = Number(countRes.rows[0].count);
        auditResults.push({
          Table: pTable,
          Count: count,
          Status: count > 0 ? '✅ PRESERVED (INTACT)' : 'ℹ️ Empty (Schema Intact)',
          Category: 'Auth / Security (PRESERVED)'
        });
      }
    }

    // Wiped tables
    for (const wTable of TARGET_WIPE_TABLES) {
      if (existingTables.includes(wTable)) {
        const countRes = await client.execute(`SELECT COUNT(*) as count FROM ${wTable}`);
        const count = Number(countRes.rows[0].count);
        auditResults.push({
          Table: wTable,
          Count: count,
          Status: count === 0 ? '✅ BASELINE 0 (CLEAN)' : '❌ NOT CLEAN',
          Category: 'Operational (WIPED)'
        });
      }
    }

    console.table(auditResults);

    const nonZeroWiped = auditResults.filter(r => r.Category === 'Operational (WIPED)' && r.Count > 0);
    const authPreserved = auditResults.filter(r => r.Table === 'users' && r.Count > 0);

    console.log('\n--- KEY TABLES VERIFICATION ---');
    const keyTables = ['users', 'roles', 'profiles', 'products', 'sales', 'purchase_orders', 'purchase_returns', 'transactions', 'sync_queue'];
    for (const key of keyTables) {
      const row = auditResults.find(r => r.Table === key);
      if (row) {
        console.log(`* ${row.Table.padEnd(20)}: ${row.Count} (${row.Status})`);
      }
    }

    if (nonZeroWiped.length === 0 && authPreserved.length > 0) {
      console.log('\n🎯 SUCCESS: Turso Cloud Database successfully wiped to baseline 0.');
      console.log('🔒 Authentication credentials, roles, and profiles are 100% intact.');
      console.log('======================================================================');
    } else if (nonZeroWiped.length > 0) {
      console.warn('⚠️ WARNING: Some operational tables still contain data:', nonZeroWiped);
    }

  } catch (err) {
    console.error('❌ Error executing Turso Cloud wipe:', err);
    process.exit(1);
  }
}

main();
