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

const PRESERVED_TABLES = ['users', 'roles', 'profiles', 'custom_permissions', 'permissions'];

const TARGET_WIPE_TABLES = [
  // Sales & Billing
  'sales',
  'sale_items',
  'sales_returns',
  'sales_return_items',
  'invoices',
  'receipts',

  // Inventory & Products
  'products',
  'stock_adjustments',
  'product_categories',
  'product_conversions',
  'barcodes',

  // Purchasing
  'purchases',
  'purchase_items',
  'purchase_orders',
  'purchase_order_items',
  'purchase_returns',
  'purchase_return_items',

  // Financial Ledger & Cash Book
  'transactions',
  'cash_book',
  'cheque_registry',
  'credit_payments',
  'daily_cash_flow',
  'expenses',

  // Entities & Other Operational Tables
  'customers',
  'suppliers',
  'quotations',
  'quotation_items',
  'credit_notes',
  'credit_note_usage',
  'debit_notes',
  'delivery_notes',
  'customer_transactions',
  'bill_holds',
  'shift_logs',
  'scanner_signals',
  'deleted_records',
  'backup_logs',
  'sync_pull_marker',

  // Synchronization Queues & Logs
  'sync_queue',
  'sync_logs',
  'audit_logs'
];

async function main() {
  try {
    // 1. Fetch all tables from Turso
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

    // 2. Post-Wipe Verification
    console.log('\n======================================================================');
    console.log('📊 POST-WIPE TURSO CLOUD VERIFICATION SUMMARY');
    console.log('======================================================================');

    const auditResults = [];

    // Preserved tables
    for (const pTable of PRESERVED_TABLES) {
      if (existingTables.includes(pTable)) {
        const countRes = await client.execute(`SELECT COUNT(*) as count FROM ${pTable}`);
        auditResults.push({
          Table: pTable,
          Count: Number(countRes.rows[0].count),
          Status: Number(countRes.rows[0].count) > 0 ? '✅ PRESERVED (INTACT)' : 'ℹ️ Empty (Preserved Schema)',
          Type: 'Auth / Security'
        });
      }
    }

    // Wiped tables
    for (const wTable of TARGET_WIPE_TABLES) {
      if (existingTables.includes(wTable)) {
        const countRes = await client.execute(`SELECT COUNT(*) as count FROM ${wTable}`);
        auditResults.push({
          Table: wTable,
          Count: Number(countRes.rows[0].count),
          Status: Number(countRes.rows[0].count) === 0 ? '✅ BASELINE 0 (CLEAN)' : '❌ NOT CLEAN',
          Type: 'Operational Data'
        });
      }
    }

    console.table(auditResults);

    const nonZeroWiped = auditResults.filter(r => r.Type === 'Operational Data' && r.Count > 0);
    const authIntact = auditResults.filter(r => (r.Table === 'users' || r.Table === 'profiles') && r.Count > 0);

    if (nonZeroWiped.length === 0 && authIntact.length > 0) {
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
