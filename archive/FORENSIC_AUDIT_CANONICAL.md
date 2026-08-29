# MASTER FORENSIC AUDIT REPORT — CANONICAL PROJECT ONLY
**Project Directory**: `D:\Hardware-Store-remediation-final 01`  
**Audit Date**: August 17, 2026  
**Mode**: READ-ONLY Forensic Investigation (No code or database modifications performed)

---

## EXECUTIVE SUMMARY

A comprehensive 10-phase read-only forensic audit was performed on the canonical ERP project at `D:\Hardware-Store-remediation-final 01`. The audit established the true runtime, database, structural, and accounting state of the application. 

### Key Findings & Critical Vulnerabilities

1. **Flawed Credit Balance Formula (`Customers.tsx`)**:
   - In `Customers.tsx` (lines 215 & 258), when a return or exchange record exists for a credit invoice, the customer's outstanding balance is computed as:
     $$\text{netBalance} = \text{totalExchange} - \text{totalReturn} - \text{totalCustomerPaid}$$
   - **Critical Bug**: This formula completely **omits the original invoice total** ($\text{originalTotal}$). For example, on invoice `INV-006` (Original Total: Rs. 18,500), where the customer returned Rs. 18,500 worth of goods and took Rs. 8,750 worth of exchange items, `Customers.tsx` calculated:
     $$\text{netBalance} = 8,750 - 18,500 - 0 = -9,750\text{ LKR}$$
   - The system reported that the store **owes the customer Rs. 9,750**, whereas the customer actually **owes the store Rs. 8,750** ($\text{Original} - \text{Return} + \text{Exchange} = 18,500 - 18,500 + 8,750 = 8,750$).
   - This flaw corrupts credit customer totals across `Customers.tsx` and Settle Credit workflows.

2. **Inconsistent Outstanding Calculations Across Modules**:
   - **Excel Backup Worker (`backup-worker.js` / `backup-service.js`)**: Calculates outstanding balance for invoice line exports as:
     $$\text{Outstanding} = \text{s.status} == \text{'paid'} ? 0 : (\text{total\_amount} - \text{payment\_received})$$
     It completely ignores returns for `Fully Returned` credit sales, exporting `INV-006`, `INV-007`, `INV-008`, `INV-010`, `INV-011`, and `INV-012` as having their full original invoice amount outstanding!
   - **Reports (`Reports.tsx`) vs Dashboard (`Dashboard.tsx`)**: `Reports.tsx` factors in exchange cash inflows, whereas `Dashboard.tsx` iterates over `sales.payment_received` directly, missing cash paid during exchanges (`sales_returns.customer_paid`) and overstating/understating cash balances depending on return types.

3. **Verification of `INV-011`**:
   - `INV-011` **EXISTS** in the real database (`sales` table record `so_1786902411145`, Customer: Dinesh Kumara, Original Total: Rs. 3,600, Status: `Fully Returned`). It was NOT fabricated.

4. **Empty Core Tables**:
   - `credit_payments`: 0 records.
   - `credit_notes`: 0 records.
   - `credit_note_usage`: 0 records.
   - Payments made via `Customers.tsx` Settle Credit directly update `sales.payment_received` and insert into `transactions`, leaving `credit_payments` bypassed in some execution paths.

---

## 1. CANONICAL PROJECT IDENTITY

- **Authoritative Directory Path**: `D:\Hardware-Store-remediation-final 01`
- **Verification Status**: Confirmed. All operations executed strictly within this directory.

### Verified File & Folder Structure

| File / Directory | Status | Size / Detail |
|---|---|---|
| `index.html` | Verified Present | 374 B |
| `package.json` | Verified Present | 2,837 B (Vite, Express 5, SQLite3, Supabase JS mock adapter) |
| `package-lock.json` | Verified Present | 424,390 B |
| `vite.config.ts` | Verified Present | 230 B |
| `tsconfig.json` | Verified Present | 635 B |
| `src/` | Verified Present | Contains components, context, data, lib, pages, types, utils |
| `src/pages/Sales.tsx` | Verified Present | 450,752 B (Main POS & Return/Exchange interface) |
| `src/pages/Customers.tsx` | Verified Present | 114,393 B (Credit customer ledger & settlement) |
| `src/pages/Reports.tsx` | Verified Present | 92,971 B (Financial, sales & inventory reports) |
| `src/pages/Dashboard.tsx` | Verified Present | 55,495 B (Executive KPI & cash tracking) |
| `src/utils/sales/printTemplates.ts` | Verified Present | 86,692 B (Invoice & return print layout generator) |
| `server.js` | Verified Present | 154,148 B (Express backend & SQLite database operations) |
| `backup-worker.js` | Verified Present | 62,178 B (Excel backup sheet generator thread) |
| `backup-service.js` | Verified Present | 67,141 B (Automated backup scheduler & mailer) |
| `hardware.db` | Verified Present | 286,720 B (SQLite3 production database) |
| `public/` | Verified Present | Static web assets |
| `dist/` | Verified Present | Production build output directory |
| `build/` | Verified Present | Electron build icons & configuration |
| `electron-main.js` | Verified Present | 3,941 B (Electron desktop app launcher) |

---

## 2. DATABASE FORENSICS (`hardware.db`)

### Schema & Table Definitions

#### `sales` Table
- **Columns**: `id` (TEXT PK), `invoice_no` (TEXT), `customer_id` (TEXT), `customer_name` (TEXT), `customer_phone` (TEXT), `customer_address` (TEXT), `items` (TEXT JSON), `subtotal` (REAL), `discount` (REAL), `tax` (REAL), `tax_rate` (REAL), `total_amount` (REAL), `status` (TEXT), `user_id` (TEXT), `payment_method` (TEXT), `created_at` (TEXT), `due_date` (TEXT), `credit_period_days` (INTEGER), `payment_received` (REAL), `transportation_fee` (REAL), `credit_note_applied` (REAL), `credit_note_code` (TEXT).
- **Foreign Keys**: None defined at DB engine level.

#### `sales_returns` Table
- **Columns**: `id` (TEXT PK), `return_no` (TEXT), `invoice_no` (TEXT), `customer_name` (TEXT), `customer_phone` (TEXT), `returned_items` (TEXT JSON), `exchange_items` (TEXT JSON), `return_method` (TEXT), `return_amount` (REAL), `exchange_amount` (REAL), `balance_amount` (REAL), `total_refunded` (REAL), `customer_paid` (REAL), `change_given` (REAL), `credit_note_no` (TEXT), `user_id` (TEXT), `status` (TEXT), `reason` (TEXT), `created_at` (TEXT).

#### `customers` Table
- **Columns**: `id` (TEXT PK), `name` (TEXT), `email` (TEXT), `phone` (TEXT), `address` (TEXT), `nic` (TEXT), `loyalty_points` (INTEGER), `total_purchases` (REAL), `join_date` (TEXT), `created_at` (TEXT).

#### `transactions` Table
- **Columns**: `id` (TEXT PK), `type` (TEXT), `category` (TEXT), `description` (TEXT), `amount` (REAL), `date` (TEXT), `reference` (TEXT), `user_id` (TEXT), `created_at` (TEXT).

#### `credit_payments` Table
- **Columns**: `id` (TEXT PK), `sale_id` (TEXT), `invoice_no` (TEXT), `customer_id` (TEXT), `customer_name` (TEXT), `amount_paid` (REAL), `remaining_balance` (REAL), `payment_method` (TEXT), `payment_date` (TEXT), `recorded_by` (TEXT), `notes` (TEXT). (Current Record Count: 0).

#### `credit_notes` Table
- **Columns**: `id` (TEXT PK), `credit_note_no` (TEXT), `code` (TEXT), `invoice_no` (TEXT), `customer_id` (TEXT), `customer_name` (TEXT), `customer_phone` (TEXT), `items` (TEXT JSON), `amount` (REAL), `value` (REAL), `balance_remaining` (REAL), `status` (TEXT), `reason` (TEXT), `user_id` (TEXT), `created_at` (TEXT). (Current Record Count: 0).

---

### Actual Database Records (Full Dump Summary)

#### 1. Invoices (`sales` table — 12 total records)

| Invoice No | Customer Name | Payment Method | Total Amount (Rs.) | Payment Received (Rs.) | Status |
|---|---|---|---|---|---|
| `INV-001` | Dinesh Kumara | Cash | 8,750.00 | 0.00 | `paid` |
| `INV-002` | Kasun Perera | Credit | 3,200.00 | 0.00 | `Non Paid` |
| `INV-003` | Guest Customer | Cash | 18,500.00 | 0.00 | `Fully Returned` |
| `INV-004` | Dinesh Kumara | Credit | 8,750.00 | 0.00 | `Non Paid` |
| `INV-005` | Kasun Perera | Credit | 2,850.00 | 0.00 | `Non Paid` |
| `INV-006` | Kasun Perera | Credit | 18,500.00 | 0.00 | `Fully Returned` |
| `INV-007` | Dinesh Kumara | Credit | 8,750.00 | 0.00 | `Fully Returned` |
| `INV-008` | Ruwan Silva | Credit | 18,500.00 | 0.00 | `Fully Returned` |
| `INV-009` | Piru | Credit | 3,200.00 | 0.00 | `Non Paid` |
| `INV-010` | Krish | Credit | 18,500.00 | 0.00 | `Fully Returned` |
| `INV-011` | Dinesh Kumara | Credit | 3,600.00 | 0.00 | `Fully Returned` |
| `INV-012` | Amashi | Credit | 18,500.00 | 0.00 | `Fully Returned` |

*Verification of `INV-011`*: `INV-011` is present in the database. `customer_name`: Dinesh Kumara, `total_amount`: Rs. 3,600, `payment_method`: Credit, `status`: `Fully Returned`.

---

#### 2. Sales Returns (`sales_returns` table — 7 total records)

| Return No | Invoice No | Customer | Method | Return Amt (Rs.) | Exchange Amt (Rs.) | Balance Amt (Rs.) | Total Refunded (Rs.) | Customer Paid (Rs.) |
|---|---|---|---|---|---|---|---|---|
| `RET-885486` | `INV-003` | Guest Customer | Cash Refund | 18,500.00 | 0.00 | 18,500.00 | 18,500.00 | 0.00 |
| `RET-891228` | `INV-007` | Dinesh Kumara | Exchange | 8,750.00 | 0.00 | -8,750.00 | 0.00 | 0.00 |
| `RET-240801` | `INV-006` | Kasun Perera | Exchange | 18,500.00 | 8,750.00 | -9,750.00 | 0.00 | 0.00 |
| `RET-407545` | `INV-008` | Ruwan Silva | Exchange | 18,500.00 | 0.00 | -18,500.00 | 0.00 | 0.00 |
| `RET-346906` | `INV-010` | Krish | Exchange | 18,500.00 | 26,250.00 | 7,750.00 | 0.00 | 0.00 |
| `RET-685964` | `INV-011` | Dinesh Kumara | Exchange | 3,600.00 | 18,500.00 | 14,900.00 | 0.00 | 0.00 |
| `RET-460284` | `INV-012` | Amashi | Exchange | 18,500.00 | 8,750.00 | -9,750.00 | 0.00 | 0.00 |

---

#### 3. Transactions (`transactions` table — 3 total records)

| Transaction ID | Type | Category | Description | Amount (Rs.) | Date | Reference |
|---|---|---|---|---|---|---|
| `t_1786881278420_mh9fsg` | income | Sales | POS Sale INV-001 | 8,750.00 | 2026-08-16 | INV-001 |
| `t_1786881630179_3fvmw9` | income | Sales | POS Sale INV-003 | 18,500.00 | 2026-08-16 | INV-003 |
| `t_1786885486303` | contra_revenue | Sales Return | Sales Return Refund for INV-003 | 18,500.00 | 2026-08-16 | INV-003 |

---

## 3. RETURN / EXCHANGE DATA FLOW

```
[Sales.tsx (Return Modal Input)]
   │ Reads: invoiceNo, returnedItems, exchangeItems, returnMethod, customerPaid
   ▼
[supabaseClient.ts Mock Adapter]
   │ Maps table 'sales_returns' -> api.sales.returns.process(payload)
   ▼
[POST /api/sales/returns (server.js)]
   ├── 1. Validates returnable quantities against past active returns for invoice line
   ├── 2. Forces returnMethod = 'Exchange', totalRefunded = 0 if credit customer/sale
   ├── 3. INSERT INTO sales_returns (return_no, invoice_no, return_amount, exchange_amount, balance_amount, customer_paid)
   ├── 4. Restocks returned products: UPDATE products SET stock = stock + qty
   ├── 5. Deducts exchange products: UPDATE products SET stock = stock - qty
   ├── 6. Logs cash movement into transactions (ONLY if cash refund or exchange cash paid)
   └── 7. Updates sales status: UPDATE sales SET status = 'Fully Returned' / 'Partially Returned'
   ▼
[UI Rerender & Reporting Views]
   ├── Customers.tsx: Re-computes exchangeBalanceMap -> netBalance = ex - ret - paid
   ├── Reports.tsx: Reads sales_returns -> adjusts gross sales & cash inflows/outflows
   ├── Dashboard.tsx: Reads transactions & sales.payment_received
   └── Backup Worker: Reads sales & sales_returns -> generates Excel sheets
```

---

## 4. ACCOUNTING SEMANTICS ANALYSIS

| Database / Code Field | Technical Definition | Semantic Meaning | Classification |
|---|---|---|---|
| `sales.total_amount` | Sum of item total prices + tax + transport fee | Original gross sales value at invoice checkout | Historical Transaction Value |
| `sales.payment_received` | Cumulative cash payments credited against this specific invoice | Direct cash collected against the invoice | Actual Cash Received |
| `sales.status` | State string (`paid`, `Non Paid`, `Fully Returned`, etc.) | Invoice lifecycle status | State Flag |
| `sales_returns.return_amount` | $\sum (\text{qty} \times \text{unit\_price})$ of returned items | Total gross value of items returned to store inventory | Refund / Inventory Return |
| `sales_returns.exchange_amount` | $\sum (\text{qty} \times \text{unit\_price})$ of new exchange items | Total gross value of new products taken by customer | New Sales / Exchange Output |
| `sales_returns.customer_paid` | Cash tendered by customer during exchange | Additional cash collected at return desk | Actual Cash Received |
| `sales_returns.balance_amount` | `exchange_amount` - `return_amount` | Net difference between exchange value and return value | Exchange Difference |
| `sales_returns.total_refunded` | Net cash paid out to customer from till | Actual cash outflow from store drawer | Cash Outflow / Refund |
| `transactions.amount` | Amount recorded in cash book transaction | General ledger cash entry | Cash Book Flow |
| `credit_payments.amount_paid` | Payment recorded in credit payment log | Cash received for debt settlement | Cash Settlement Entry |

---

## 5. EVERY CREDIT BALANCE CALCULATION IN CODEBASE

| File | Line Range | Calculation Formula | Source Fields | Business Purpose & Flaw Analysis |
|---|---|---|---|---|
| `Customers.tsx` | 215 | `netBalance = totalExchange - totalReturn - totalCustomerPaid` | `sales_returns.exchange_amount`, `return_amount`, `customer_paid` | **CRITICAL BUG**: Calculates net exchange difference instead of updated credit balance. Omits `originalTotal`. |
| `Customers.tsx` | 258, 284 | `outstanding = exchangeBalance.netBalance` | `exchangeBalanceMap` | Assigns flawed `netBalance` as customer's invoice debt whenever a return exists. |
| `Customers.tsx` | 261, 286 | `outstanding = originalTotal - payment_received` | `sales.total_amount`, `payment_received` | Calculates debt for credit sales with no return record. |
| `Customers.tsx` | 361 | `remainingOnSale = exchangeBalance.netBalance` | `exchangeBalanceMap` | Settle Credit modal debt calculation for oldest unpaid invoice. |
| `Customers.tsx` | 393 | `newPaymentReceived = origPaid + paidThisTime` | `sales.payment_received` | Updates total paid on invoice upon credit settlement. |
| `Reports.tsx` | 261 | `rawCashCollected = sum(payment_received)` | `sales.payment_received`, `total_amount` | Total cash collected from sales. |
| `Reports.tsx` | 327 | `totalCashCollected = rawCash + exchangeInflows - cashRefunds` | `sales`, `sales_returns` | Net cash flow from sales & returns. |
| `Reports.tsx` | 348 | `totalSalesRevenue = grossRevenue + exchangeRevenue - returnRevenue` | `sales`, `sales_returns` | Net selling revenue across all transactions. |
| `Dashboard.tsx` | 489 | `totalCashCollectedVal += sale.payment_received` | `sales.payment_received` | Cash KPI on Dashboard. Misses `sales_returns.customer_paid`. |
| `Dashboard.tsx` | 515 | `cashBalance = totalCashCollected - totalRefunds` | `sales`, `sales_returns` | System cash balance display. |
| `backup-worker.js` | 493 | `returnNetMap = retAmt - exAmt` | `sales_returns` | Pre-calculates net returned value per invoice. |
| `backup-worker.js` | 499 | `effTotal = max(0, total_amount - netRet)` | `sales.total_amount`, `returnNetMap` | Effective invoice total after returns for backup summary. |
| `backup-worker.js` | 500 | `valB8 = sum(max(0, effTotal - payment_received))` | `sales`, `sales_returns` | Total credit outstanding reported in Excel summary card. |
| `backup-worker.js` | 716 | `Outstanding = status == 'paid' ? 0 : max(0, total_amount - payment_received)` | `sales.total_amount`, `payment_received`, `status` | **FLAW**: Ignores returns on `Fully Returned` credit invoices in Excel table export! |
| `server.js` | 2352 | `netDiff = calcExchangeAmount - calcReturnAmount` | `sales_returns` | Net return/exchange delta evaluation on return processing. |

---

## 6. RETURN METHOD SEMANTICS

1. **Cash Refund**: Customer returns items and receives cash directly from till. `total_refunded` > 0.
2. **Return Only**: Customer returns items without selecting exchange items. Handled as Cash Refund, Credit Note, or credit debt reduction based on sale type.
3. **Return & Exchange / Exchange**: Customer returns items and takes new products. Stored in DB with `return_method` = `'Exchange'`.
4. **Credit Note**: Customer returns items and receives a store credit voucher (`credit_notes` record created).

*Distinguishability*: "Return Only" vs "Return & Exchange" are **NOT explicitly distinguished** by `return_method` column value in DB (both use `'Exchange'` or `'Cash Refund'`). They can only be inferred by checking if `exchange_amount > 0` or if `exchange_items` JSON array contains elements.

---

## 7. PAYMENT TRACE AUDIT (Exchange with Cash Payment)

When a customer executes an exchange where Exchange Value > Return Value and pays cash for the difference:
1. **Frontend (`Sales.tsx`)**: User enters `customerPaid`.
2. **API (`POST /api/sales/returns`)**: `server.js` receives `customerPaid`.
3. **Database Insertion**:
   - `sales_returns`: `customer_paid` recorded.
   - `transactions`: `server.js` inserts entry `Exchange Payment for INV-xxx` (Amount: `customer_paid - change_given`).
   - `sales`: `payment_received` is **NOT updated**.
4. **Reporting Impact**:
   - `Reports.tsx`: Correctly reads `sales_returns.customer_paid` and adds it to `totalCashCollected`.
   - `Dashboard.tsx`: **MISSED**. `Dashboard.tsx` iterates over `sales.payment_received` and ignores `sales_returns.customer_paid` and `transactions`!
   - `Customers.tsx`: Subtracts `customer_paid` from `netBalance`, which due to the flawed formula, further distorts the customer's balance.

---

## 8. ACCOUNTING RECONCILIATION MATRIX

| Scenario | Original Inv | Returned | Exchange | Orig Paid | Exch Paid | Expected Outstanding | Expected Customer Credit | Current System Result | Audit Status |
|---|---|---|---|---|---|---|---|---|---|
| **A. Normal credit sale** | 10,000 | 0 | 0 | 0 | 0 | 10,000 | 0 | 10,000 | **Correct** |
| **B. Partial credit payment** | 10,000 | 0 | 0 | 4,000 | 0 | 6,000 | 0 | 6,000 | **Correct** |
| **C. Credit Return Only** | 10,000 | 4,000 | 0 | 0 | 0 | 6,000 | 0 | -4,000 | **INCORRECT** (Shows -4,000 store debt) |
| **D. Credit Exch > Ret** | 18,500 | 18,500 | 26,250 | 0 | 0 | 26,250 | 0 | 7,750 | **INCORRECT** (Shows 7,750 instead of 26,250) |
| **E. Exact Return & Exch** | 18,500 | 18,500 | 18,500 | 0 | 0 | 18,500 | 0 | 0 | **INCORRECT** (Shows 0 debt on credit invoice!) |
| **F. Credit Exch < Ret** | 18,500 | 18,500 | 8,750 | 0 | 0 | 8,750 | 0 | -9,750 | **INCORRECT** (Shows -9,750 store debt) |
| **G. Multiple Returns** | 10,000 | 2,000 + 3,000 | 0 | 0 | 0 | 5,000 | 0 | Cumulative netBalance errors | **INCORRECT** |
| **H. Payment after Exch** | 18,500 | 18,500 | 8,750 | 5,000 | 0 | 3,750 | 0 | Incorrect base for settlement | **INCORRECT** |
| **I. Full Settlement** | 18,500 | 18,500 | 8,750 | 8,750 | 0 | 0 | 0 | Settles wrong amount | **INCORRECT** |

---

## 9. UI CONSISTENCY AUDIT

| Module / View | Calculation Basis | Result on `INV-006` (Orig 18.5k, Ret 18.5k, Exch 8.75k) | Mismatch / Discrepancy |
|---|---|---|---|
| **Invoice View** | `sales.total_amount` | Rs. 18,500.00 | Shows original invoice total |
| **Sales History** | `sales.status` | `Fully Returned` | Correct status flag |
| **Credit History** | `exchangeBalanceMap` | Net Balance: -9,750.00 LKR | **MISMATCH**: Shows store owes customer Rs. 9,750 |
| **Credit Customers** | `totalOutstanding` | -9,750.00 LKR | **MISMATCH**: Shows negative debtor balance |
| **Settle Credit** | `exchangeBalance.netBalance` | -9,750.00 LKR | **MISMATCH**: Cannot settle positive debt |
| **Sales Returns** | `sales_returns` record | Ret: 18.5k, Exch: 8.75k, Bal: -9.75k | Raw return record matches DB |
| **Return Receipt** | `printTemplates.ts` | Ret: 18.5k, Exch: 8.75k | Shows line items correctly |
| **Reports** | `totalSalesRevenue` | Net revenue adjusted by 9.75k | Correct overall revenue adjustment |
| **Dashboard** | `sales.payment_received` | 0.00 | Misses exchange cash inflow |
| **Excel Backup** | `backup-worker.js` Line 716 | Outstanding: Rs. 18,500.00 | **MISMATCH**: Reports full 18,500 unpaid! |

---

## 10. ROOT CAUSES & EMPIRICAL EVIDENCE

1. **Root Cause 1: Omission of Original Invoice Total in `exchangeBalanceMap`**
   - *Evidence*: `Customers.tsx` lines 215: `netBalance = totalExchange - totalReturn - totalCustomerPaid`. It calculates the return delta, not the remaining invoice balance ($\text{Original} - \text{Return} + \text{Exchange}$).
2. **Root Cause 2: Hardcoded Status Checks in Excel Export (`backup-worker.js`)**
   - *Evidence*: Line 716: `s.status?.toLowerCase() === 'paid' ? 0 : Math.max(0, (s.total_amount || 0) - (s.payment_received || 0))`. Because `s.status` is `'Fully Returned'`, it evaluates the full `total_amount` as outstanding.
3. **Root Cause 3: Disconnected Cash Inflow Tracking in Dashboard**
   - *Evidence*: `Dashboard.tsx` line 489 sums `sale.payment_received` across `sales`, while exchange cash payments are stored in `sales_returns.customer_paid` and `transactions`.
4. **Root Cause 4: Lack of Unified Ledger / Double-Entry Model**
   - *Evidence*: Database stores individual unlinked tables without triggers or unified customer ledger balance fields.

---

## 11. RECOMMENDED ACCOUNTING MODEL

Adopt a **Unified Customer Credit Ledger Model**:
$$\text{Customer Outstanding Balance} = \sum_{\text{Credit Invoices}} \left( \text{Original Total} - \text{Total Returned} + \text{Total Exchanged} - \text{Payments Received} - \text{Exchange Cash Paid} \right)$$

For each individual credit invoice:
$$\text{Invoice Net Outstanding} = \max\left(0, \text{sales.total\_amount} - \text{Total Return Amount} + \text{Total Exchange Amount} - \text{sales.payment\_received} - \text{Total Customer Paid on Exchange}\right)$$

If $\text{Return Amount} > \text{Original Total} + \text{Exchange Amount}$, the excess is treated as **Customer Credit Balance (Store Credit / Credit Note)** rather than negative invoice debt.

---

## 12. RECOMMENDED IMPLEMENTATION PLAN

1. **Phase 1: Update Accounting Formulas in Frontend (`Customers.tsx`)**:
   - Fix `exchangeBalanceMap` to compute:
     $$\text{netBalance} = \text{originalTotal} - \text{totalReturn} + \text{totalExchange} - \text{payment\_received} - \text{totalCustomerPaid}$$
2. **Phase 2: Fix Excel Export Calculation (`backup-worker.js` & `backup-service.js`)**:
   - Update line 716 to account for returned/exchanged amounts when computing outstanding balance.
3. **Phase 3: Align Dashboard Cash Tracking (`Dashboard.tsx`)**:
   - Include `sales_returns.customer_paid` in `totalCashCollectedVal`.
4. **Phase 4: Database Schema Harmonization**:
   - Ensure credit payments write to `credit_payments` table consistently.

---

## 13. FILE MODIFICATION MATRIX

### Files That Would Need Modification
- `src/pages/Customers.tsx` (Fix `exchangeBalanceMap` and settlement balance calculations)
- `src/pages/Dashboard.tsx` (Include exchange cash payments in cash KPI)
- `backup-worker.js` (Fix outstanding balance formula in Excel exports)
- `backup-service.js` (Fix outstanding balance formula in worker sync)

### Files That MUST Remain Untouched
- `hardware.db` (Database file structure must remain intact; data remediation done via proper API/migration if requested)
- `server.js` (Core API routes & transaction logic are operating safely; only schema query extensions needed if any)
- `src/utils/sales/printTemplates.ts` (Print templates correctly format receipts)
- `src/lib/supabaseClient.ts` (Mock adapter correctly routes table operations)

---

## 14. VERIFICATION / TEST PLAN

1. **Verification Test Case 1 (`INV-006`)**:
   - Invoice Original Total: 18,500. Return: 18,500. Exchange: 8,750.
   - Verify `Customers.tsx` displays Net Outstanding = **Rs. 8,750.00** (not -9,750.00).
2. **Verification Test Case 2 (`INV-010`)**:
   - Invoice Original Total: 18,500. Return: 18,500. Exchange: 26,250.
   - Verify `Customers.tsx` displays Net Outstanding = **Rs. 26,250.00** (not 7,750.00).
3. **Verification Test Case 3 (Excel Export)**:
   - Run backup script and inspect Excel output; verify `Fully Returned` invoices show **0.00** outstanding balance.
