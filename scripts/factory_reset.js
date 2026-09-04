import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import os from 'os';
import { createClient } from '@libsql/client';
import { FALLBACK_TURSO_DATABASE_URL, FALLBACK_TURSO_AUTH_TOKEN } from '../src/db/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment variables
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
if (process.env.APPDATA) {
  const appDataEnv = path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', '.env');
  if (fs.existsSync(appDataEnv)) {
    dotenv.config({ path: appDataEnv });
  }
}

// Operational & Transactional tables to wipe completely (0 records)
const OPERATIONAL_TABLES_TO_WIPE = [
  // 1. Sales & POS
  'sale_items',
  'sales',
  'sales_return_items',
  'sales_returns',
  'bill_holds',
  'quotations',
  'delivery_notes',

  // 2. Purchasing & POs
  'purchase_order_items',
  'purchase_orders',
  'supplier_transactions',
  'purchase_return_items',
  'purchase_returns',

  // 3. Customer Ledger & Credit
  'customer_transactions',
  'credit_payments',
  'credit_notes',
  'credit_note_usage',

  // 4. Finance, Banking & Inventory Audits
  'transactions',
  'cash_book',
  'cheques',
  'cheque_registry',
  'stock_adjustments',

  // 5. Queues & System Logs
  'sync_queue',
  'audit_logs',
  'backup_logs'
];

// Tables to reset auto-increment sequences
const SEQUENCES_TO_RESET = [
  'sales',
  'sale_items',
  'purchase_orders',
  'purchase_order_items',
  'customer_transactions',
  'credit_payments',
  'credit_notes',
  'credit_note_usage',
  'transactions',
  'cash_book',
  'cheques',
  'cheque_registry',
  'sync_queue',
  'audit_logs',
  'backup_logs',
  'stock_adjustments',
  'sales_returns',
  'sales_return_items',
  'purchase_returns',
  'purchase_return_items',
  'quotations',
  'delivery_notes',
  'bill_holds'
];

async function resetSqliteDatabase(dbPath, label) {
  if (!fs.existsSync(dbPath)) {
    console.log(`\n⏭️  [${label}] Database file not found at ${dbPath}, skipping.`);
    return;
  }

  console.log(`\n======================================================`);
  console.log(`🔄 [${label}] Performing Factory Reset on: ${dbPath}`);
  console.log(`======================================================`);

  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  try {
    // 1. Transactional batch wipe of operational tables
    await db.run('BEGIN TRANSACTION');

    for (const table of OPERATIONAL_TABLES_TO_WIPE) {
      try {
        const res = await db.run(`DELETE FROM "${table}"`);
        console.log(`  ✓ Cleared table [${table}] (${res.changes || 0} rows deleted)`);
      } catch (err) {
        if (!err.message.includes('no such table')) {
          console.warn(`  ! Notice on table ${table}:`, err.message);
        }
      }
    }

    // 2. Reset customer credit balances & purchase history
    try {
      // Check customer columns
      const custCols = await db.all('PRAGMA table_info(customers)');
      const colNames = new Set(custCols.map(c => c.name));
      const setClauses = [];
      if (colNames.has('credit_balance')) setClauses.push('credit_balance = 0.00');
      if (colNames.has('current_credit')) setClauses.push('current_credit = 0.00');
      if (colNames.has('total_purchases')) setClauses.push('total_purchases = 0.00');
      if (colNames.has('loyalty_points')) setClauses.push('loyalty_points = 0');
      if (colNames.has('total_spent')) setClauses.push('total_spent = 0.00');
      if (colNames.has('balance')) setClauses.push('balance = 0.00');

      if (setClauses.length > 0) {
        await db.run(`UPDATE customers SET ${setClauses.join(', ')}`);
        console.log(`  ✓ Reset customer balances to 0.00 (${setClauses.join(', ')})`);
      }
    } catch (err) {
      console.warn('  ! Customer balance reset notice:', err.message);
    }

    // 3. Reset supplier payable/outstanding balances
    try {
      const suppCols = await db.all('PRAGMA table_info(suppliers)');
      const colNames = new Set(suppCols.map(c => c.name));
      const setClauses = [];
      if (colNames.has('payable_balance')) setClauses.push('payable_balance = 0.00');
      if (colNames.has('outstanding_balance')) setClauses.push('outstanding_balance = 0.00');

      if (setClauses.length > 0) {
        await db.run(`UPDATE suppliers SET ${setClauses.join(', ')}`);
        console.log(`  ✓ Reset supplier balances to 0.00 (${setClauses.join(', ')})`);
      }
    } catch (err) {
      console.warn('  ! Supplier balance reset notice:', err.message);
    }

    // 4. Reset sequence auto-increment counters
    try {
      const seqPlaceholders = SEQUENCES_TO_RESET.map(() => '?').join(', ');
      await db.run(
        `DELETE FROM sqlite_sequence WHERE name IN (${seqPlaceholders})`,
        SEQUENCES_TO_RESET
      );
      console.log(`  ✓ Reset sqlite_sequence auto-increment counters to 0`);
    } catch (err) {
      // sqlite_sequence might not exist yet if no autoincrement rows were inserted
    }

    // 5. Reset system settings sync status & invoice sequence
    try {
      await db.run(
        `UPDATE system_settings SET 
          next_invoice_number = 'INV001', 
          counter_pending_count = 0, 
          last_counter_sync_timestamp = NULL, 
          last_sync_timestamp = NULL 
        WHERE id = 'global' OR 1=1`
      );
      console.log(`  ✓ Reset system_settings invoice counter to INV001 and sync status to clean`);
    } catch (err) {
      console.warn('  ! system_settings reset notice:', err.message);
    }

    // 6. Final sweep: Clear any audit logs or sync queue entries generated by update triggers
    await db.run('DELETE FROM "audit_logs"').catch(() => {});
    await db.run('DELETE FROM "sync_queue"').catch(() => {});
    await db.run('DELETE FROM "backup_logs"').catch(() => {});
    console.log(`  ✓ Final sweep: audit_logs, sync_queue, and backup_logs cleared to 0`);

    await db.run('COMMIT');
    console.log(`  ✨ Transaction committed successfully for [${label}].`);

    // 6. Maintenance: WAL checkpoint & VACUUM
    try {
      await db.run('PRAGMA wal_checkpoint(TRUNCATE)');
      await db.run('VACUUM');
      console.log(`  ✓ SQLite WAL journal truncated and database VACUUM complete.`);
    } catch (err) {
      console.warn('  ! SQLite maintenance notice:', err.message);
    }

    // 7. Verify counts
    await printVerificationSummary(db, label, false);
  } catch (err) {
    await db.run('ROLLBACK').catch(() => {});
    console.error(`❌ Factory reset failed on [${label}]:`, err.message);
    throw err;
  } finally {
    await db.close();
  }
}

async function resetTursoCloudDatabase() {
  console.log(`\n======================================================`);
  console.log(`🌐 [Turso Cloud] Performing Factory Reset on Cloud DB`);
  console.log(`======================================================`);

  const tursoUrl = process.env.TURSO_DATABASE_URL || FALLBACK_TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN || FALLBACK_TURSO_AUTH_TOKEN;

  if (!tursoUrl || !tursoToken) {
    console.warn('⚠️ Turso credentials not provided. Skipping cloud reset.');
    return;
  }

  const client = createClient({
    url: tursoUrl,
    authToken: tursoToken
  });

  try {
    const txn = await client.transaction('write');

    for (const table of OPERATIONAL_TABLES_TO_WIPE) {
      try {
        const res = await txn.execute(`DELETE FROM "${table}"`);
        console.log(`  ✓ Cleared remote table [${table}] (${res.rowsAffected || 0} rows deleted)`);
      } catch (err) {
        if (!err.message.includes('no such table')) {
          console.warn(`  ! Remote notice on table ${table}:`, err.message);
        }
      }
    }

    // Reset customer credit balances
    try {
      await txn.execute(
        `UPDATE customers SET 
          credit_balance = 0.00, 
          current_credit = 0.00, 
          total_purchases = 0.00, 
          loyalty_points = 0 
        WHERE 1=1`
      );
      console.log(`  ✓ Reset remote customer balances to 0.00`);
    } catch (err) {
      console.warn('  ! Remote customer balance reset notice:', err.message);
    }

    // Reset supplier payable balances
    try {
      await txn.execute(`UPDATE suppliers SET payable_balance = 0.00 WHERE 1=1`);
      console.log(`  ✓ Reset remote supplier payable balances to 0.00`);
    } catch (err) {
      console.warn('  ! Remote supplier balance reset notice:', err.message);
    }

    // Reset sequence counters
    try {
      const quotedNames = SEQUENCES_TO_RESET.map(s => `'${s}'`).join(', ');
      await txn.execute(`DELETE FROM sqlite_sequence WHERE name IN (${quotedNames})`);
      console.log(`  ✓ Reset remote sqlite_sequence auto-increment counters`);
    } catch (err) {
      // Ignored if sqlite_sequence not present
    }

    // Reset system settings
    try {
      await txn.execute(
        `UPDATE system_settings SET 
          next_invoice_number = 'INV001', 
          counter_pending_count = 0, 
          last_counter_sync_timestamp = NULL, 
          last_sync_timestamp = NULL 
        WHERE id = 'global' OR 1=1`
      );
      console.log(`  ✓ Reset remote system_settings invoice counter and sync status`);
    } catch (err) {
      console.warn('  ! Remote system_settings reset notice:', err.message);
    }

    // Final sweep on Turso: Clear any audit logs or sync queue entries generated by update triggers
    await txn.execute('DELETE FROM "audit_logs"').catch(() => {});
    await txn.execute('DELETE FROM "sync_queue"').catch(() => {});
    await txn.execute('DELETE FROM "backup_logs"').catch(() => {});
    console.log(`  ✓ Final sweep on Turso: audit_logs, sync_queue, and backup_logs cleared to 0`);

    await txn.commit();
    console.log(`  ✨ Cloud transaction committed successfully.`);

    // Verify counts
    await printVerificationSummary(client, 'Turso Cloud', true);
  } catch (err) {
    console.error(`❌ Factory reset failed on Turso Cloud:`, err.message);
    throw err;
  } finally {
    client.close();
  }
}

async function printVerificationSummary(dbOrClient, label, isTurso = false) {
  const queryCount = async (sql) => {
    try {
      if (isTurso) {
        const res = await dbOrClient.execute(sql);
        return res.rows?.[0]?.[Object.keys(res.rows[0])[0]] ?? 0;
      } else {
        const row = await dbOrClient.get(sql);
        return row ? Object.values(row)[0] : 0;
      }
    } catch {
      return 0;
    }
  };

  const salesCount = await queryCount('SELECT COUNT(*) as c FROM sales');
  const custTxCount = await queryCount('SELECT COUNT(*) as c FROM customer_transactions');
  const creditPayCount = await queryCount('SELECT COUNT(*) as c FROM credit_payments');
  const poCount = await queryCount('SELECT COUNT(*) as c FROM purchase_orders');
  const txCount = await queryCount('SELECT COUNT(*) as c FROM transactions');
  const chqCount = await queryCount('SELECT COUNT(*) as c FROM cheque_registry');
  const syncQueueCount = await queryCount('SELECT COUNT(*) as c FROM sync_queue');
  const auditCount = await queryCount('SELECT COUNT(*) as c FROM audit_logs');
  
  const custDebtSum = await queryCount('SELECT COALESCE(SUM(credit_balance), 0) as s FROM customers');
  const suppPaySum = await queryCount('SELECT COALESCE(SUM(payable_balance), 0) as s FROM suppliers');

  // Preserved master data
  const prodCount = await queryCount('SELECT COUNT(*) as c FROM products');
  const custCount = await queryCount('SELECT COUNT(*) as c FROM customers');
  const suppCount = await queryCount('SELECT COUNT(*) as c FROM suppliers');
  const profCount = await queryCount('SELECT COUNT(*) as c FROM profiles');

  console.log(`\n  📊 [${label}] Post-Reset Verification:`);
  console.log(`     - Sales / Orders:             ${salesCount} (Expected: 0)`);
  console.log(`     - Customer Ledger & Credits:  ${custTxCount + creditPayCount} (Expected: 0)`);
  console.log(`     - Customer Total Debt:        Rs. ${Number(custDebtSum).toFixed(2)} (Expected: Rs. 0.00)`);
  console.log(`     - Purchase Orders:            ${poCount} (Expected: 0)`);
  console.log(`     - Supplier Total Payable:     Rs. ${Number(suppPaySum).toFixed(2)} (Expected: Rs. 0.00)`);
  console.log(`     - Financial Transactions:     ${txCount} (Expected: 0)`);
  console.log(`     - Cheques in Registry:        ${chqCount} (Expected: 0)`);
  console.log(`     - Sync Queue Pending:         ${syncQueueCount} (Expected: 0)`);
  console.log(`     - Audit Logs:                 ${auditCount} (Expected: 0)`);
  console.log(`     --------------------------------------------------`);
  console.log(`     🛡️ PRESERVED MASTER DATA:`);
  console.log(`     - Products in Catalog:        ${prodCount} preserved`);
  console.log(`     - Customer Directory:         ${custCount} preserved`);
  console.log(`     - Supplier Directory:         ${suppCount} preserved`);
  console.log(`     - User / Profile Accounts:    ${profCount} preserved`);
}

function cleanOldExcelBackups() {
  const backupDirs = [
    path.join(rootDir, 'backups'),
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Muthuwadige Hardware ERP', 'backups') : null
  ].filter(Boolean);

  console.log(`\n======================================================`);
  console.log(`🧹 Cleaning Test Excel Backups & Exports`);
  console.log(`======================================================`);

  for (const bDir of backupDirs) {
    if (fs.existsSync(bDir)) {
      try {
        const files = fs.readdirSync(bDir);
        for (const f of files) {
          if (f.endsWith('.xlsx') && !f.includes('Template')) {
            try {
              fs.unlinkSync(path.join(bDir, f));
              console.log(`  ✓ Removed test backup: ${f}`);
            } catch (err) {
              console.warn(`  ! Could not remove ${f}:`, err.message);
            }
          }
        }
      } catch (err) {
        console.warn(`  ! Error reading ${bDir}:`, err.message);
      }
    }
  }
}

async function main() {
  console.log('🚀 Initiating Full Factory Reset to Zero (Local SQLite & Turso Cloud)...');

  // 1. Workspace SQLite DB
  const workspaceDb = path.join(rootDir, 'hardware.db');
  await resetSqliteDatabase(workspaceDb, 'Workspace SQLite (hardware.db)');

  // 2. AppData SQLite DB (Desktop Counter instance)
  const appDataRoot = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const appDataDb = path.join(appDataRoot, 'Muthuwadige Hardware ERP', 'hardware.db');
  await resetSqliteDatabase(appDataDb, 'AppData SQLite (Counter DB)');

  // 3. Turso Cloud libSQL DB
  await resetTursoCloudDatabase();

  // 4. Clean test Excel backups
  cleanOldExcelBackups();

  console.log('\n🎉 ======================================================');
  console.log('✅ FACTORY RESET COMPLETE: All operational data is at 0!');
  console.log('======================================================\n');
}

main().catch(err => {
  console.error('\n❌ Fatal error during factory reset:', err);
  process.exit(1);
});
