# PHASE 3A — TRANSACTION RECONCILIATION REPORT
**Project Directory**: `D:\Hardware-Store-remediation-final 01`  
**Database File**: `hardware.db`  
**Mode**: READ-ONLY Audit & Reconciliation

---

## 1. RECONCILIATION TABLE FOR ALL INVOICES

Formula:
$$\text{Expected Outstanding} = \max\left(0, \text{Original Total} - \text{Total Returned} + \text{Total Exchange} - \text{Original Payment} - \text{Exchange Payment}\right)$$

| Invoice | Customer | Payment Method | Status | Original (Rs.) | Orig Paid (Rs.) | Returned (Rs.) | Exchange (Rs.) | Exch Paid (Rs.) | Expected Outstanding (Rs.) | Actual Current DB `balance_amount` | Reconciled Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `INV-001` | Dinesh Kumara | Cash | `paid` | 8,750.00 | 8,750.00 | 0.00 | 0.00 | 0.00 | **0.00** | N/A | Fully Paid |
| `INV-002` | Kasun Perera | Credit | `Non Paid` | 3,200.00 | 0.00 | 0.00 | 0.00 | 0.00 | **3,200.00** | N/A | Active Credit |
| `INV-003` | Guest Customer | Cash | `Fully Returned` | 18,500.00 | 18,500.00 | 18,500.00 | 0.00 | 0.00 | **0.00** | 18,500.00 | Cash Refunded |
| `INV-004` | Dinesh Kumara | Credit | `Non Paid` | 8,750.00 | 0.00 | 0.00 | 0.00 | 0.00 | **8,750.00** | N/A | Active Credit |
| `INV-005` | Kasun Perera | Credit | `Non Paid` | 2,850.00 | 0.00 | 0.00 | 0.00 | 0.00 | **2,850.00** | N/A | Active Credit |
| `INV-006` | Kasun Perera | Credit | `Fully Returned` | 18,500.00 | 0.00 | 18,500.00 | 8,750.00 | 0.00 | **8,750.00** | -9,750.00 | Active Exchange Debt |
| `INV-007` | Dinesh Kumara | Credit | `Fully Returned` | 8,750.00 | 0.00 | 8,750.00 | 0.00 | 0.00 | **0.00** | -8,750.00 | Credit Returned (Cleared) |
| `INV-008` | Ruwan Silva | Credit | `Fully Returned` | 18,500.00 | 0.00 | 18,500.00 | 0.00 | 0.00 | **0.00** | -18,500.00 | Credit Returned (Cleared) |
| `INV-009` | Piru | Credit | `Non Paid` | 3,200.00 | 0.00 | 0.00 | 0.00 | 0.00 | **3,200.00** | N/A | Active Credit |
| `INV-010` | Krish | Credit | `Fully Returned` | 18,500.00 | 0.00 | 18,500.00 | 26,250.00 | 0.00 | **26,250.00** | 7,750.00 | Active Exchange Debt |
| `INV-011` | Dinesh Kumara | Credit | `Fully Returned` | 3,600.00 | 0.00 | 3,600.00 | 18,500.00 | 0.00 | **18,500.00** | 14,900.00 | Active Exchange Debt |
| `INV-012` | Amashi | Credit | `Fully Returned` | 18,500.00 | 0.00 | 18,500.00 | 8,750.00 | 0.00 | **8,750.00** | -9,750.00 | Active Exchange Debt |

---

## 2. RECONCILED CUSTOMER CREDIT BALANCES

| Customer Name | Associated Invoices | Net Outstanding (Rs.) |
|---|---|---|
| **Dinesh Kumara** | `INV-001` (0), `INV-004` (8,750), `INV-007` (0), `INV-011` (18,500) | **27,250.00 LKR** |
| **Kasun Perera** | `INV-002` (3,200), `INV-005` (2,850), `INV-006` (8,750) | **14,800.00 LKR** |
| **Ruwan Silva** | `INV-008` (0) | **0.00 LKR** |
| **Piru** | `INV-009` (3,200) | **3,200.00 LKR** |
| **Krish** | `INV-010` (26,250) | **26,250.00 LKR** |
| **Amashi** | `INV-012` (8,750) | **8,750.00 LKR** |
| **TOTAL STORE CREDIT OUTSTANDING** | **All Customers** | **80,250.00 LKR** |
