# Comprehensive System Audit & Diagnostic Report

**System**: Muthuwadige Hardware ERP (Golden Master Production Version)  
**Audit Timestamp**: 2026-08-29  
**Audit Mode**: STRICT READ-ONLY FORENSIC SCAN  
**Status**: Root causes identified, zero code modified.

---

## Executive Summary

A comprehensive, root-cause diagnostic scan of the entire Muthuwadige Hardware ERP codebase was performed across the frontend (React 18 / Vite / TypeScript), backend signaling & REST layer (Express / Node.js), SQLite local database engine (`hardware.db`), and backup subsystems. 

The investigation revealed **four critical root causes** responsible for:
1. **100% Failure Rate in Excel/XLSX Bulk Imports** (`0 imported, Failed: X`).
2. **UI Input Lag, Text Box Freezing & Unresponsive Inputs**.
3. **Database State Inconsistencies & Failure of the "Reset Data" Button**.
4. **Dead Code, Legacy Standalone Duplicate Servers, and Redundant Dependencies**.

---

## Section A: Root Causes Found

### 1. Excel/XLSX Bulk Import Failure Analysis

#### Root Cause 1.1: SQLite Column Name Mismatches on Backend `INSERT` Endpoints
When Excel records are parsed by the frontend, they are sent to the local Express backend via `POST /api/products`, `POST /api/customers`, `POST /api/suppliers`, `POST /api/employees`, and `POST /api/settings/restore`. 

The SQLite tables in `hardware.db` have schema definitions that conflict directly with the hardcoded SQL `INSERT` statements in `server.js`:

| Module / Endpoint | Column Name in `server.js` INSERT | Actual Column in `hardware.db` SQLite Schema | SQLite Error Thrown | Impact |
| :--- | :--- | :--- | :--- | :--- |
| **`POST /api/products`** | `min_stock` | `min_stock_level` | `SQLITE_ERROR: table products has no column named min_stock` | Every product row in Excel fails with 500 error |
| **`POST /api/customers`** | `total_purchases`, `join_date` | Columns do NOT exist in `customers` | `SQLITE_ERROR: table customers has no column named total_purchases` | Every customer row in Excel fails with 500 error |
| **`POST /api/suppliers`** | `credit_terms`, `payable_balance` | `credit_period` (and missing `payable_balance`) | `SQLITE_ERROR: table suppliers has no column named credit_terms` | Every supplier row in Excel fails with 500 error |
| **`POST /api/employees`** | `department`, `attendance`, `join_date`, `user_id` | Columns do NOT exist in `employees` | `SQLITE_ERROR: table employees has no column named department` | Every employee row in Excel fails with 500 error |
| **`POST /api/stock_adjustments`** | `old_qty`, `new_qty`, `user_email` | `old_stock`, `new_stock` | `SQLITE_ERROR: table stock_adjustments has no column named old_qty` | Stock adjustments fail |
| **`POST /api/settings/restore`** | `products.min_stock`, `sales.user_id` | `min_stock_level`, (missing `sales.user_id`) | `SQLITE_ERROR: table products has no column named min_stock` | Full database Excel restore rolls back with 500 error |

#### Root Cause 1.2: Mock Supabase Adapter Fallback Loop Failure
In `src/pages/Inventory.tsx` (lines 302–312) and `src/pages/Customers.tsx` (lines 145–160):
```typescript
const { error } = await supabase.from('products').insert([dbPayload]);
if (error) {
  const { error: updateError } = await supabase.from('products').update(dbPayload).eq('sku', sku);
  ...
}
```
1. `insertTable('products', dbPayload)` receives the `500` error from `server.js`.
2. The frontend attempts a fallback `updateTable('products', dbPayload, sku)`.
3. `updateTable` invokes `api.products.save(dbPayload, sku)` which sends `PUT /api/products/:id` with `:id = sku`.
4. In `server.js`, `PUT /api/products/:id` searches `WHERE id = ? OR sku = ?`. Because the product was never inserted in the first place, `existing` is null and returns `404 Product not found`.
5. The fallback update fails, increments `errors++`, and displays: `Successfully imported 0 products! (Skipped/failed: X)`.

#### Root Cause 1.3: Deprecated `FileReader.readAsBinaryString()` vs `readAsArrayBuffer()`
`Inventory.tsx`, `Customers.tsx`, `Employees.tsx`, and `Settings.tsx` use `FileReader.readAsBinaryString(file)` and `XLSX.read(bstr, { type: 'binary' })`. 
- `readAsBinaryString` is a deprecated web standard. On non-ASCII characters, UTF-8 strings (e.g. Sinhala font text in item descriptions or Unicode currency characters), binary string encoding mangles multi-byte sequences, causing corrupted cell data or XLSX parse aborts.
- `Suppliers.tsx` correctly uses `reader.readAsArrayBuffer(file)` and `XLSX.read(data, { type: 'array' })`.

#### Expected Column Mappings vs Common Spreadsheet Variations:
The header normalization in `Inventory.tsx` handles common variations well, but the backend rejects the mapped payload due to the schema column discrepancies noted above.
- **Product Name**: `product name`, `product_name`, `product`, `item`, `item_name`, `item name`, `description`, `name`, `title`
- **SKU / Barcode**: `sku`, `item code`, `item_code`, `code`, `barcode`, `product_sku`, `product sku`, `item_number`
- **Price**: `price`, `selling price`, `selling_price`, `retail price`, `retail_price`, `unit price`, `unit_price`, `price (rs.)`
- **Cost**: `cost`, `cost price`, `cost_price`, `buying price`, `buying_price`, `purchase price`, `purchase_price`, `cost (rs.)`
- **Stock**: `stock`, `qty`, `quantity`, `current stock`, `current_stock`, `units_in_stock`, `stock_qty`
- **Min Stock**: `min stock`, `min_stock`, `reorder level`, `reorder_level`, `min`, `stock alert`, `stock_alert`, `minstock`

---

### 2. UI Lag, Text Box Freezing & Unresponsive Inputs

#### Root Cause 2.1: `useBarcodeScanner` Event Listener Churn
In `src/pages/Sales.tsx` (lines 2473–2477) and `src/pages/Inventory.tsx` (lines 504–511):
```typescript
useBarcodeScanner({
  onScan: (barcode) => handleBarcodeScanned(barcode, 'usb'),
  minLength: 2,
  enabled: true
});
```
- The `onScan` callback is passed as an unmemoized inline arrow function.
- In `useBarcodeScanner.ts`: `useEffect(..., [onScan, minLength, timeOut, enabled])`.
- On every single keystroke in any search input or form field, the component re-renders, producing a new `onScan` function reference.
- This causes `window.removeEventListener('keydown')` and `window.addEventListener('keydown')` to tear down and rebind on every keystroke, choking the event loop on the main thread and causing noticeable input lag and cursor freezing.

#### Root Cause 2.2: SSE EventSource Listener Reconnection Storm in `Sales.tsx`
In `src/pages/Sales.tsx`:
```typescript
useEffect(() => {
  let eventSource: EventSource | null = null;
  ...
}, [mobileScannerSessionId, products, creditNotesList, tab, allCatalogSelectables]);
```
- The Server-Sent Events (SSE) `EventSource` connection hook includes `products`, `creditNotesList`, `tab`, and `allCatalogSelectables` in its dependency array.
- Every time a product is added to cart, a tab is switched, or catalog state updates, the active SSE stream is torn down and a new `GET /api/scanner/stream` HTTP connection is established with the backend.
- This produces socket churn and triggers backend request logging cycles on the UI thread.

#### Root Cause 2.3: Global Refresh Event Storm in `Header.tsx`
In `src/components/Header.tsx` (lines 78–85):
When the user clicks the "Refresh" button in the header, `handleGlobalRefresh` dispatches 8 separate CustomEvents simultaneously:
1. `refresh-all-data`
2. `refresh-dashboard`
3. `refresh-sales`
4. `refresh-inventory`
5. `refresh-reports`
6. `refresh-customers`
7. `refresh-suppliers`
8. `settings-updated`

Components like `Inventory.tsx` listen to `suppliers-updated`, `refresh-inventory`, and `refresh-all-data`, causing up to 3 redundant parallel fetch requests. In `Reports.tsx`, `window.addEventListener('focus', fetchData)` causes full report recalculation whenever the application window regains OS focus.

---

### 3. Database State & Residual / Corrupt Data

#### Root Cause 3.1: "Reset Data" Endpoint Failure (`credit_balance` Column Error)
In `server.js` (`POST /api/system/reset-data`):
```sql
await db.run('UPDATE customers SET current_credit = 0, credit_balance = 0');
```
- The SQLite table `customers` has column `current_credit REAL DEFAULT 0`, but does NOT have a column named `credit_balance`.
- When the user triggers "Reset Transactions / Sales Data" from Settings or Developer tools, SQLite throws:
  `SQLITE_ERROR: no such column: credit_balance`
- Because the operation is wrapped inside `BEGIN TRANSACTION`, the entire reset transaction fails and rolls back. The user sees a failure alert and stale/sample data persists.

#### Root Cause 3.2: Orphaned Seed Data in `transactions` Table
In `hardware.db`:
- `sales` table has 0 rows.
- `transactions` table contains 6 active sample records (`INV-003`, `INV-004`, `INV-005`, `UTIL-AUG26`, `PAY-AUG26`, `RENT-AUG26`).
- These 6 records are residual sample data from `seed-sample-data.js`. Because `sales` has 0 rows, the financial reports display income from non-existent invoices, creating accounting balance discrepancies.

---

## Section B: Dead Code, Unused Files & Stale Artifacts Inventory

### 1. Obsolete & Conflicting Backend Server Scripts

| File Path | Size | Status / Description | Safe to Delete? |
| :--- | :--- | :--- | :--- |
| [`backup-service.js`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/backup-service.js) | 37,612 B | Legacy standalone Express server script on port 5001. Superseded by `server.js` and `backup-worker.js`. | ✅ **YES (Redundant)** |
| [`backup-template-generator.py`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/backup-template-generator.py) | 3,583 B | Standalone Python openpyxl script for generating templates. Not used in runtime production pipeline. | ✅ **YES (Tooling artifact)** |
| [`convert_logo.py`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/convert_logo.py) | 746 B | One-off PIL Python script used to create `build/icon.ico`. | ✅ **YES (One-off script)** |
| [`update_logo_revert.py`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/update_logo_revert.py) | 1,755 B | One-off Python regex replacement script for Sales.tsx edits. | ✅ **YES (One-off script)** |
| [`add_customer.js`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/add_customer.js) | 1,897 B | One-off test script for manual customer insertion. | ✅ **YES (Scratch script)** |
| [`db_query.js`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/db_query.js) | 813 B | One-off script pointing to hardcoded `ERP-Template` path. | ✅ **YES (Scratch script)** |
| [`reset_customer_delivery.js`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/reset_customer_delivery.js) | 2,544 B | One-off script for resetting customer delivery state. | ✅ **YES (Scratch script)** |
| [`seed_history.js`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/seed_history.js) | 6,855 B | One-off script for seeding mock history data. | ✅ **YES (Scratch script)** |
| [`update_db_admin.js`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/update_db_admin.js) | 1,417 B | One-off script for resetting admin password in DB. | ✅ **YES (Scratch script)** |
| [`view_all_tables.js`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/view_all_tables.js) | 1,850 B | One-off table dumper script. | ✅ **YES (Scratch script)** |
| [`view_database.js`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/view_database.js) | 2,162 B | One-off database dumper script. | ✅ **YES (Scratch script)** |
| [`db_version.txt`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/db_version.txt) | 29 B | Static text string `2026-08-12-clean-handover-v1`. | ℹ️ Keep or delete |

### 2. Stale Documentation & Historical Forensic Reports

| File Path | Size | Status / Description | Safe to Archive / Delete? |
| :--- | :--- | :--- | :--- |
| [`FORENSIC_AUDIT_CANONICAL.md`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/FORENSIC_AUDIT_CANONICAL.md) | 23,987 B | Historical forensic audit report from prior development phase. | ✅ **YES (Archive / Stale)** |
| [`INV-011_ACCOUNTING_RECONCILIATION.md`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/INV-011_ACCOUNTING_RECONCILIATION.md) | 14,559 B | Historical invoice INV-011 reconciliation report. | ✅ **YES (Archive / Stale)** |
| [`INV-011_PAYMENT_RECONCILIATION.md`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/INV-011_PAYMENT_RECONCILIATION.md) | 7,341 B | Historical invoice INV-011 payment report. | ✅ **YES (Archive / Stale)** |
| [`PHASE3_TRANSACTION_RECONCILIATION.md`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/PHASE3_TRANSACTION_RECONCILIATION.md) | 3,015 B | Historical Phase 3 transaction audit report. | ✅ **YES (Archive / Stale)** |
| [`PHASE3_UNIFIED_ACCOUNTING_REMEDIATION.md`](file:///e:/HARDWARE-ERP-GOLDEN-MASTER-2026-08-27/🔒 Golden Master/PHASE3_UNIFIED_ACCOUNTING_REMEDIATION.md) | 6,769 B | Historical Phase 3 accounting remediation document. | ✅ **YES (Archive / Stale)** |

### 3. Redundant / Misplaced Dependencies in `package.json`

| Package Name | Current Location | Issue | Recommended Action |
| :--- | :--- | :--- | :--- |
| `@emotion/react` | `dependencies` | Unused in the entire codebase (app uses TailwindCSS). | Remove from `package.json` |
| `@supabase/supabase-js` | `dependencies` | Unused (app uses local SQLite mock adapter in `supabaseClient.ts`). | Remove from `package.json` |
| `@types/cors`, `@types/express`, `@types/jsbarcode`, `@types/node-cron`, `@types/nodemailer` | `dependencies` | TypeScript type definitions located under production `dependencies`. | Move to `devDependencies` |

---

## Section C: Proposed Safe Remediation Plan

Below is the step-by-step remediation plan structured for user review prior to execution.

### Phase 1: SQLite Schema Alignment & Migration in `server.js`
1. Add automatic non-destructive column migrations (`ALTER TABLE [table] ADD COLUMN [col]`) on startup in `server.js`:
   - `products`: Add column `min_stock` (or alias `min_stock_level`).
   - `customers`: Add columns `total_purchases REAL DEFAULT 0`, `join_date TEXT`.
   - `suppliers`: Add columns `credit_terms TEXT DEFAULT 'Net 30'`, `payable_balance REAL DEFAULT 0`.
   - `employees`: Add columns `department TEXT DEFAULT 'Store'`, `attendance TEXT DEFAULT '[]'`, `join_date TEXT`, `user_id TEXT`.
   - `stock_adjustments`: Add columns `old_qty REAL DEFAULT 0`, `new_qty REAL DEFAULT 0`, `user_email TEXT`.
2. In `server.js`, normalize column names in all `INSERT INTO` statements to ensure dual-compatibility with both legacy and new column names.

### Phase 2: Excel Import Upgrades (Zero-Regression & Unicode Safe)
1. Upgrade `Inventory.tsx`, `Customers.tsx`, `Employees.tsx`, and `Settings.tsx` to use `FileReader.readAsArrayBuffer(file)` and `XLSX.read(data, { type: 'array' })` to guarantee binary safety for UTF-8 / Sinhala text.
2. In `src/lib/supabaseClient.ts`, improve `updateTable` error resilience so that fallback updates correctly handle SKU / Name lookups without throwing 404s.

### Phase 3: UI Performance & Input Responsiveness Optimization
1. **Memoize Scanner Callbacks**: In `Sales.tsx` and `Inventory.tsx`, wrap `handleBarcodeScanned` and search callbacks with `useCallback` to prevent listener tear-down on every keystroke.
2. **Isolate SSE Connection**: In `Sales.tsx`, remove transient state variables (`products`, `creditNotesList`, `tab`, `allCatalogSelectables`) from the SSE stream `useEffect` dependency array, using a stable ref for barcode dispatching.
3. **De-duplicate Global Refresh**: Consolidate `Header.tsx` refresh broadcasting into a single debounced sync event (`refresh-all-data`) to prevent parallel duplicate HTTP fetches.
4. **Remove Unnecessary Window Focus Listeners**: In `Reports.tsx`, remove `window.addEventListener('focus', fetchData)` to prevent main thread freeze when switching windows.

### Phase 4: Database Clean & Reset Remediation
1. In `server.js` (`POST /api/system/reset-data`), fix the SQL query from `UPDATE customers SET current_credit = 0, credit_balance = 0` to `UPDATE customers SET current_credit = 0`.
2. Clear the 6 residual sample transactions from `transactions` table using a clean script to eliminate orphaned invoice references.

### Phase 5: Repository Cleanup (Dead Code & Artifact Pruning)
1. Safely remove obsolete root test scripts (`add_customer.js`, `backup-service.js`, `update_logo_revert.py`, `db_query.js`, `view_all_tables.js`, etc.) after archiving.
2. Clean `package.json` by removing `@emotion/react` and `@supabase/supabase-js` and relocating `@types/*` to `devDependencies`.

---

*Report generated and validated by Antigravity Agentic Diagnostic System.*
