# INV-011 ACCOUNTING SEMANTICS RECONCILIATION REPORT
**Project Directory**: `D:\Hardware-Store-remediation-final 01`  
**Investigation Date**: August 17, 2026  
**Mode**: READ-ONLY Forensic Investigation (Zero code or database modifications executed)

---

## EXECUTIVE SUMMARY & DEFINITIVE RESOLUTION

This forensic investigation resolves the conflict between the proposed accounting formulas for `INV-011` and establishes the true accounting semantics of return and exchange transactions for credit sales.

### The Conflict & Core Question
- **Original Sale (`INV-011`)**: Customer Dinesh Kumara purchased Rs. 3,600 worth of PVC Pipes on **CREDIT** (`payment_received` = 0).
- **Return / Exchange Transaction (`RET-685964`)**: Customer returned the Rs. 3,600 PVC Pipes and selected a Bosch Drill Machine worth Rs. 18,500.
- **Hypothetical Payment**: Customer tendered Rs. 1,000 cash during the exchange (`customer_paid` = 1,000).
- **The Conflict**:
  - **Model B (`Customers.tsx` formula)**: $\text{Exchange (18,500)} - \text{Return (3,600)} - \text{CustomerPaid (1,000)} = \mathbf{13,900\text{ LKR}}$
  - **Model A (`Sales.tsx` & `backup-worker.js` formula)**: $\text{Original (3,600)} - \text{Return (3,600)} + \text{Exchange (18,500)} - \text{CustomerPaid (1,000)} = \mathbf{17,500\text{ LKR}}$

---

### Empirical Forensic Resolution

1. **Why Model B Produces Rs. 13,900**:
   - Model B subtracts the returned goods value (Rs. 3,600) directly from the exchange item price (Rs. 18,500), treating the return as a cash-equivalent credit voucher.
   - **Double-Counting Fallacy on Unpaid Credit Sales**: Because `INV-011` was an **unpaid credit sale** (`payment_received` = 0), the customer never paid cash for the original Rs. 3,600 PVC Pipes. Returning the PVC Pipes **clears their original Rs. 3,600 debt**. If the system ALSO subtracts Rs. 3,600 from the new Rs. 18,500 item price without adding back the unpaid original invoice balance, it gives the customer **Rs. 3,600 credit for money they never paid**.
   - Result: The customer would walk away with an Rs. 18,500 drill machine, having paid only Rs. 1,000 cash, owing only Rs. 13,900, representing a total store value received of Rs. 14,900 for an 18,500 item!

2. **Why Model A Produces Rs. 17,500**:
   - Model A evaluates the net customer ledger balance:
     $$\text{Net Debt} = \text{Original Unpaid Debt (3,600)} - \text{Returned Goods Value (3,600)} + \text{New Exchange Goods Value (18,500)} - \text{Cash Tendered (1,000)} = \mathbf{17,500\text{ LKR}}$$
   - Here, returning the PVC Pipes reduces the original debt from Rs. 3,600 to Rs. 0. Taking the Bosch Drill adds Rs. 18,500 in new debt. Paying Rs. 1,000 cash reduces debt to **Rs. 17,500**.

3. **When Does Rs. 13,900 Apply?**:
   - If `INV-011` had been a **PAID CASH SALE** (customer previously paid Rs. 3,600 cash), then:
     $$\text{Model A} = 3,600 - 3,600 + 18,500 - (3,600\text{ original paid} + 1,000\text{ exchange paid}) = \mathbf{13,900\text{ LKR}}$$
   - **Conclusion**: Rs. 13,900 is the correct outstanding balance **if and only if the original invoice was paid in full**. For an **unpaid credit invoice**, the correct remaining customer debt is **Rs. 17,500**.

---

## 1. RAW DATABASE EVIDENCE FOR `INV-011`

### `sales` Table Record
- `id`: `so_1786902411145`
- `invoice_no`: `INV-011`
- `customer_id`: `c_1786818426349`
- `customer_name`: `Dinesh Kumara`
- `customer_phone`: `0785678901`
- `items`: `[{"productId":"p_1786818415315","productName":"PVC Water Pipe 1/2\"","qty":20,"price":180,"total":3600}]`
- `subtotal`: `3600.00`
- `discount`: `0.00`
- `tax`: `0.00`
- `total_amount`: `3600.00`
- `payment_received`: `0.00`
- `payment_method`: `Credit`
- `status`: `Fully Returned`
- `created_at`: `2026-08-16T17:46:51.145Z`

### `sales_returns` Table Record (`RET-685964`)
- `id`: `sr_1786902685964`
- `return_no`: `RET-685964`
- `invoice_no`: `INV-011`
- `customer_name`: `Dinesh Kumara`
- `returned_items`: `[{"productId":"p_1786818415315","productName":"PVC Water Pipe 1/2\"","qty":20,"price":180,"total":3600}]`
- `exchange_items`: `[{"productId":"p_1786818415290","productName":"Bosch GSB 550 Drill Machine","qty":1,"price":18500,"total":18500}]`
- `return_method`: `Exchange`
- `return_amount`: `3600.00`
- `exchange_amount`: `18500.00`
- `balance_amount`: `14900.00` (`18500 - 3600`)
- `total_refunded`: `0.00`
- `customer_paid`: `0.00`
- `change_given`: `0.00`
- `status`: `active`
- `created_at`: `2026-08-16T17:51:25.964Z`

### Related Tables Status
- `transactions`: 0 records for `INV-011`
- `credit_payments`: 0 records for `INV-011`
- `credit_notes`: 0 records for `INV-011`

---

## 2. TRACE OF THE ORIGINAL CREDIT SALE

1. **Creation Event**: On 2026-08-16 at 17:46:51, invoice `INV-011` was saved via `POST /api/sales`.
2. **Recorded Parameters**:
   - `total_amount`: Rs. 3,600.00
   - `payment_received`: Rs. 0.00
   - `payment_method`: `Credit`
   - `status`: `Non Paid` (later updated to `Fully Returned` upon return)
3. **Obligation Created**: Dinesh Kumara incurred a legal debt obligation of **Rs. 3,600.00** to Muthuwadige Hardware.

---

## 3. TRACE OF THE RETURN / EXCHANGE TRANSACTION

1. **Execution Event**: On 2026-08-16 at 17:51:25, a return/exchange was submitted via `POST /api/sales/returns`.
2. **Backend Processing (`server.js` lines 2231–2486)**:
   - Verifies original invoice `INV-011`.
   - Restocks returned 20 pcs PVC Pipes (`stock = stock + 20`).
   - Deducts exchange 1 pc Bosch Drill Machine (`stock = stock - 1`).
   - Forces `finalReturnMethod = 'Exchange'` because `sale.payment_method` === `'Credit'`.
   - Inserts `sales_returns` record with `return_amount = 3600`, `exchange_amount = 18500`, `balance_amount = 14900`.
   - Updates `sales.status` to `'Fully Returned'`.
   - Does **NOT** update `sales.payment_received` or `sales.total_amount`.

---

## 4. CRITICAL QUESTION — IS THE ORIGINAL Rs. 3,600 DEBT CLOSED?

**Answer**: **YES**, Option B applies: The original Rs. 3,600 obligation for the PVC Pipes is completely closed by returning the physical PVC Pipes back to inventory. 

### Empirical Proof
- Returning the PVC Pipes returns Rs. 3,600 worth of merchandise to the store, canceling the customer's obligation to pay for the PVC Pipes.
- However, taking the Bosch Drill Machine creates a **NEW obligation of Rs. 18,500**.
- Therefore, the customer's gross obligation becomes Rs. 18,500.
- If the customer pays Rs. 1,000 cash at the counter, the remaining net debt owed is **Rs. 17,500**.

---

## 5. TRACE OF THE Rs. 1,000 PAYMENT

If the customer pays Rs. 1,000 cash during the exchange:
1. **Frontend (`Sales.tsx`)**: Passed as `customerPaid: 1000` in `POST /api/sales/returns` payload.
2. **Backend (`server.js` line 2368)**: Stored in `sales_returns.customer_paid = 1000`.
3. **Transactions Table**: `server.js` line 2435 inserts a cash income record:
   - `type`: `'income'`, `category`: `'Exchange Payment'`, `amount`: `1000`, `reference`: `'INV-011'`.
4. **Classification**: The Rs. 1,000 represents a **partial cash payment toward the net exchange difference** between the new Bosch Drill (18,500) and the returned PVC Pipes (3,600).

---

## 6. FORMULA EVALUATION MATRIX

| Candidate Model | Formula | Evaluated Result for `INV-011` | Economic Meaning | Double-Counting Error? | Valid for Credit Sales? |
|---|---|---|---|---|---|
| **MODEL A** | $\text{Original} - \text{Return} + \text{Exchange} - \text{TotalPaid}$ | $3,600 - 3,600 + 18,500 - 1,000 = \mathbf{17,500}$ | Net ledger debt across all items & payments | **No**. Correctly tracks net obligation. | **YES** (Authoritative) |
| **MODEL B** | $\text{Exchange} - \text{Return} - \text{CustomerPaid}$ | $18,500 - 3,600 - 1,000 = \mathbf{13,900}$ | Exchange delta minus cash paid | **YES**. Subtracts return from exchange without adding back unpaid original invoice. | **NO** (Only valid for fully paid cash sales) |
| **MODEL C** | $\text{Exchange} - \text{CustomerPaid}$ | $18,500 - 1,000 = \mathbf{17,500}$ | Replacement item price minus cash paid | **No**. Equivalent to Model A when return cancels original total. | **YES** (If $\text{Return} = \text{Original}$) |

---

## 7. CROSS-CHECK WITH OTHER REAL DATABASE EXCHANGE RECORDS

The real SQLite database contains 6 other sales returns records. Here is the comparative evaluation:

| Invoice No | Payment Method | Original Total (Rs.) | Return (Rs.) | Exchange (Rs.) | Customer Paid (Rs.) | DB `balance_amount` | Model A (`Sales.tsx`) | Model B (`Customers.tsx`) | Authoritative Outstanding (Rs.) |
|---|---|---|---|---|---|---|---|---|---|
| `INV-003` | Cash | 18,500 | 18,500 | 0 | 0 | 18,500 | 0 | -18,500 | **0.00** (Cash Refunded) |
| `INV-006` | Credit | 18,500 | 18,500 | 8,750 | 0 | -9,750 | 8,750 | -9,750 | **8,750.00** |
| `INV-007` | Credit | 8,750 | 8,750 | 0 | 0 | -8,750 | 0 | -8,750 | **0.00** (Full Return) |
| `INV-008` | Credit | 18,500 | 18,500 | 0 | 0 | -18,500 | 0 | -18,500 | **0.00** (Full Return) |
| `INV-010` | Credit | 18,500 | 18,500 | 26,250 | 0 | 7,750 | 26,250 | 7,750 | **26,250.00** |
| `INV-011` | Credit | 3,600 | 3,600 | 18,500 | 0 (or 1,000) | 14,900 | 18,500 (or 17,500) | 14,900 (or 13,900) | **18,500.00** (or **17,500.00**) |
| `INV-012` | Credit | 18,500 | 18,500 | 8,750 | 0 | -9,750 | 8,750 | -9,750 | **8,750.00** |

*Key Finding*: Model B produces **negative debt** for `INV-006`, `INV-007`, `INV-008`, `INV-012`, falsely indicating that the store owes money to credit customers who returned unpaid goods! Model A correctly resolves all 7 invoices to their true business balances.

---

## 8. MULTIPLE TRANSACTIONS PER INVOICE

Can an invoice have multiple `sales_returns` records? **YES**.
When multiple return/exchange transactions occur against a single invoice:
- Cumulative Return Amount: $\text{totalReturn} = \sum \text{return\_amount}$
- Cumulative Exchange Amount: $\text{totalExchange} = \sum \text{exchange\_amount}$
- Cumulative Exchange Payments: $\text{totalExchangePaid} = \sum \text{customer\_paid}$

The net invoice debt formula aggregates these linearly:
$$\text{Net Outstanding} = \max\left(0, \text{originalTotal} - \text{totalReturn} + \text{totalExchange} - (\text{sales.payment\_received} + \text{totalExchangePaid})\right)$$

---

## 9. MEANING OF `balance_amount` IN `sales_returns`

`sales_returns.balance_amount` in SQLite represents strictly the **transaction-level delta**:
$$\text{balance\_amount} = \text{exchange\_amount} - \text{return\_amount}$$
- It is a historical transaction snapshot of the return desk difference.
- It is **NOT** the customer's remaining credit debt on the invoice because it omits `originalTotal` and prior payments.
- `Customers.tsx` erred by treating `balance_amount` as the total invoice balance due.

---

## 10. AUTHORITATIVE ACCOUNTING MODEL

$$\text{Customer Outstanding Debt} = \sum_{\text{Invoices}} \max\left(0, \text{sales.total\_amount} - \text{totalReturn} + \text{totalExchange} - \text{sales.payment\_received} - \text{totalExchangePaid}\right)$$

### Exact Formulas by Business Scenario

1. **Normal Credit Sale**: $\text{Outstanding} = \text{sales.total\_amount}$
2. **Partial Credit Payment**: $\text{Outstanding} = \text{sales.total\_amount} - \text{sales.payment\_received}$
3. **Credit Return Only ($\text{Return} = \text{Original}$)**: $\text{Outstanding} = 0$
4. **Credit Return Only ($\text{Return} < \text{Original}$)**: $\text{Outstanding} = \text{sales.total\_amount} - \text{Return}$
5. **Return & Exchange ($\text{Exchange} > \text{Return}$)**: $\text{Outstanding} = \text{sales.total\_amount} - \text{Return} + \text{Exchange} - \text{ExchangePaid}$
6. **Return & Exchange ($\text{Exchange} = \text{Return}$)**: $\text{Outstanding} = \text{sales.total\_amount} - \text{ExchangePaid}$
7. **Return & Exchange ($\text{Exchange} < \text{Return}$)**: $\text{Outstanding} = \max(0, \text{sales.total\_amount} - \text{Return} + \text{Exchange})$
8. **Multiple Returns**: Aggregates cumulative returns, exchanges, and exchange payments.

---

## 11. SCREEN-BY-SCREEN EXPECTED RESULT FOR `INV-011`

Assuming `customer_paid` = 1,000:

| Screen / View | Field / Display | Formula | Expected Result |
|---|---|---|---|
| **Invoice View** | Total Amount | `sales.total_amount` | **Rs. 3,600.00** |
| **Sales History** | Status Badge | `sales.status` | **Fully Returned** |
| **Sales History Card** | Effective Total | $3,600 - 3,600 + 18,500$ | **Rs. 18,500.00** |
| **Sales History Card** | Total Paid | $0 + 1,000$ | **Rs. 1,000.00** |
| **Sales History Card** | Remaining Balance | $18,500 - 1,000$ | **Rs. 17,500.00** |
| **Credit Customers** | Total Outstanding | $\text{Model A}$ | **Rs. 17,500.00** |
| **Customer Detail** | Unpaid Sales Balance | $\text{Model A}$ | **Rs. 17,500.00** |
| **Settle Credit** | Remaining to Pay | $\text{Model A}$ | **Rs. 17,500.00** |
| **Sales Returns** | Return Desk Summary | Ret: 3,600, Exch: 18,500, Bal: 14,900 | Ret: 3,600, Exch: 18,500, Bal: 14,900 |
| **Reports** | Sales Revenue | Net revenue adjusted by +14.9k | Net revenue +14,900.00 |
| **Dashboard** | Cash Balance | Inflow +1,000 | Includes +1,000 exchange payment |
| **Excel Backup** | Outstanding Balance | $\text{Model A}$ | **Rs. 17,500.00** |

---

## 12. FILES REQUIRING MODIFICATION vs UNTOUCHED

### Files Requiring Modification (During Remediation Phase Only)
- `src/pages/Customers.tsx`: Fix `exchangeBalanceMap` formula to include `originalTotal`.
- `backup-worker.js`: Update line 716 to calculate net outstanding balance considering returns and exchanges.
- `backup-service.js`: Align backup service calculations with `backup-worker.js`.
- `src/pages/Dashboard.tsx`: Add `sales_returns.customer_paid` into `totalCashCollectedVal`.

### Files Remaining Untouched
- `hardware.db`
- `server.js`
- `src/utils/sales/printTemplates.ts`
- `src/lib/supabaseClient.ts`

---

## 13. FINAL VERIFICATION TEST MATRIX

| Test Case | Scenario | Input Data | Expected Output | Pass Criteria |
|---|---|---|---|---|
| **TC-01** | `INV-011` Credit Exchange | Orig: 3,600, Ret: 3,600, Exch: 18,500, Paid: 1,000 | Net Debt = **Rs. 17,500.00** | `Customers.tsx` shows 17,500 |
| **TC-02** | `INV-006` Credit Exchange | Orig: 18,500, Ret: 18,500, Exch: 8,750, Paid: 0 | Net Debt = **Rs. 8,750.00** | `Customers.tsx` shows 8,750 (no negative) |
| **TC-03** | `INV-007` Credit Return | Orig: 8,750, Ret: 8,750, Exch: 0, Paid: 0 | Net Debt = **Rs. 0.00** | `Customers.tsx` shows 0.00 |
| **TC-04** | Excel Export | All credit returned sales | `INV-007` & `INV-008` = 0.00 | Excel sheet matches UI balances |
