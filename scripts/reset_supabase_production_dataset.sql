-- ==============================================================================
-- MUTHUWADIGE HARDWARE ERP - PRODUCTION RESET MIGRATION (SUPABASE / POSTGRESQL)
-- ==============================================================================
-- Purpose: Purges all transactional test records and resets all opening balances 
--          and inventory quantities to zero while strictly preserving master settings,
--          staff profiles, permissions, and catalog definitions.
-- ==============================================================================

BEGIN;

-- 1. PURGE SALES & REVENUE TRANSACTIONS
TRUNCATE TABLE sales_returns CASCADE;
TRUNCATE TABLE credit_note_usage CASCADE;
TRUNCATE TABLE credit_notes CASCADE;
TRUNCATE TABLE credit_payments CASCADE;
TRUNCATE TABLE sales CASCADE;
TRUNCATE TABLE quotations CASCADE;
TRUNCATE TABLE delivery_notes CASCADE;
TRUNCATE TABLE bill_holds CASCADE;

-- 2. PURGE PURCHASING & DEBIT NOTE TRANSACTIONS
TRUNCATE TABLE purchase_return_items CASCADE;
TRUNCATE TABLE purchase_returns CASCADE;
TRUNCATE TABLE purchase_orders CASCADE;

-- 3. PURGE FINANCIAL & AUDIT LEDGERS
TRUNCATE TABLE cheque_registry CASCADE;
TRUNCATE TABLE transactions CASCADE;
TRUNCATE TABLE stock_adjustments CASCADE;
TRUNCATE TABLE audit_logs CASCADE;
TRUNCATE TABLE backup_logs CASCADE;

-- 4. RESET OPENING BALANCES & INVENTORY LEVELS TO ZERO
UPDATE products SET stock = 0;
UPDATE customers SET credit_balance = 0, current_credit = 0, total_purchases = 0;
UPDATE suppliers SET payable_balance = 0;

-- 5. VERIFICATION NOTICE
-- Master configurations in 'profiles', 'custom_permissions', and 'system_settings'
-- remain 100% intact with zero initial liabilities, zero debtor balances, and 
-- a clean Rs. 0.00 Cash Book ledger.

COMMIT;
