# INV-011 PAYMENT RECONCILIATION REPORT
**Project Directory**: `D:\Hardware-Store-remediation-final 01`  
**Investigation Date**: August 17, 2026  
**Mode**: READ-ONLY Forensic Investigation (Zero code or database modifications executed)

---

## EXECUTIVE SUMMARY & DEFINITIVE FINAL NUMBER

A complete forensic audit of the actual `hardware.db` database and `server.js` payment code paths was conducted to resolve all payment field ambiguities for invoice `INV-011`.

### Authoritative Payment Determination
- **Original Invoice Payment (`sales.payment_received`)**: **0 LKR**
- **Exchange Cash Payment (`sales_returns.customer_paid`)**: **0 LKR**
- **Cash Book Inflow (`transactions` table for `INV-011`)**: **0 LKR**
- **Credit Payment Entry (`credit_payments` table for `INV-011`)**: **0 LKR**

**Proof**: In the real production database `hardware.db`, the Rs. 1,000 payment **does NOT exist**. It is **Classification D: Missing from the current database / A hypothetical example scenario**. The actual recorded cash payment for `INV-011` across all database tables is **0 LKR**.

---

### Authoritative Outstanding Balance Calculation

$$\text{Original Invoice Total} = 3,600\text{ LKR}$$
$$\text{Returned Goods Value} = 3,600\text{ LKR}$$
$$\text{Exchange Goods Value} = 18,500\text{ LKR}$$
$$\text{Original Payment Received} = 0\text{ LKR}$$
$$\text{Exchange Payment Received} = 0\text{ LKR}$$

$$\text{FINAL OUTSTANDING} = 3,600 - 3,600 + 18,500 - 0 - 0 = \mathbf{18,500\text{ LKR}}$$

---

### DEFINITIVE FINAL NUMBER

$$\mathbf{18,500\text{ LKR}}$$

*(If a hypothetical Rs. 1,000 cash payment had been tendered during exchange, the remaining debt would be Rs. 17,500 LKR. However, based strictly on the authoritative database records, zero cash was tendered, so the true outstanding balance is **Rs. 18,500 LKR**).*

---

## 1. EXACT RAW DATABASE EVIDENCE FOR `INV-011`

### `sales` Table Row
```json
{
  "id": "so_1786902411145",
  "invoice_no": "INV-011",
  "customer_id": "c_1786818426349",
  "customer_name": "Dinesh Kumara",
  "customer_phone": "0785678901",
  "customer_address": "No. 67, Beach Road, Negombo",
  "items": "[{\"productId\":\"p_1786818415315\",\"productName\":\"PVC Water Pipe 1/2\\\"\",\"qty\":20,\"price\":180,\"taxRate\":0,\"total\":3600}]",
  "subtotal": 3600,
  "discount": 0,
  "tax": 0,
  "tax_rate": 0,
  "total_amount": 3600,
  "status": "Fully Returned",
  "user_id": "u1",
  "payment_method": "Credit",
  "created_at": "2026-08-16T17:46:51.145Z",
  "due_date": "2026-09-15T17:46:50.837Z",
  "credit_period_days": 30,
  "payment_received": 0,
  "transportation_fee": 0,
  "credit_note_applied": 0,
  "credit_note_code": ""
}
```

### `sales_returns` Table Row (`RET-685964`)
```json
{
  "id": "sr_1786902685964",
  "return_no": "RET-685964",
  "invoice_no": "INV-011",
  "customer_name": "Dinesh Kumara",
  "customer_phone": "0785678901",
  "returned_items": "[{\"productId\":\"p_1786818415315\",\"productName\":\"PVC Water Pipe 1/2\\\"\",\"qty\":20,\"price\":180,\"taxRate\":0,\"total\":3600,\"lineId\":\"INV-011_line_0\",\"lineIndex\":0}]",
  "exchange_items": "[{\"productId\":\"p_1786818415290\",\"productName\":\"Bosch GSB 550 Drill Machine\",\"qty\":1,\"price\":18500,\"total\":18500,\"unit\":\"pcs\",\"conversionRate\":1,\"discount\":0,\"discountType\":\"amount\",\"taxRate\":0}]",
  "return_method": "Exchange",
  "return_amount": 3600,
  "exchange_amount": 18500,
  "balance_amount": 14900,
  "total_refunded": 0,
  "customer_paid": 0,
  "change_given": 0,
  "credit_note_no": "",
  "user_id": "sanojhardware@gmail.com",
  "status": "active",
  "reason": "",
  "created_at": "2026-08-16T17:51:25.964Z"
}
```

### Other Tables Query Results for `INV-011`
- `transactions`: **`[]` (0 records)**
- `credit_payments`: **`[]` (0 records)**
- `credit_notes`: **`[]` (0 records)**
- `credit_note_usage`: **`[]` (0 records)**

---

## 2. SERVER.JS PAYMENT LOGIC INSPECTION

### `POST /api/sales` (Invoice Creation)
- Inserts `sales.payment_received = s.payment_received || 0`.
- For credit sales (`payment_method: 'Credit'`), `s.payment_received` is passed as `0`.
- **Result on `INV-011`**: `sales.payment_received` was written as `0`.

### `POST /api/sales/returns` (Return / Exchange Processing)
- Reads `customerPaid` from request body (line 2241).
- Forces `finalCustomerPaid = 0` if `isCreditCustomer` AND `netDiff <= 0` (line 2353).
- If `customerPaid > 0` on exchange, inserts into `transactions` table with category `'Exchange Payment'` (line 2435).
- Does **NOT** update `sales.payment_received`.
- **Result on `INV-011`**: `customerPaid` in payload was `0`, so `sales_returns.customer_paid` was written as `0`, and no transaction was created.

### `POST /api/credit_payments` (Credit Settlement)
- Inserts record into `credit_payments` table.
- Does **NOT** automatically update `sales.payment_received`.
- **Result on `INV-011`**: No record exists in `credit_payments`.

---

## 3. UI PAYMENT FLOW TRACE (`Sales.tsx` → `server.js` → DB)

```
[Sales.tsx Return Modal]
   │ User selects return items (20 PVC Pipes = Rs. 3,600)
   │ User selects exchange items (1 Bosch Drill = Rs. 18,500)
   │ Net Difference = Rs. 14,900
   │ Input 'Customer Paid' field left empty / 0
   ▼
[API Request Payload]
   {
     "invoiceNo": "INV-011",
     "returnedItems": [...],
     "exchangeItems": [...],
     "returnMethod": "Exchange",
     "returnAmount": 3600,
     "exchangeAmount": 18500,
     "customerPaid": 0,
     "balanceAmount": 14900
   }
   ▼
[POST /api/sales/returns (server.js)]
   ├── Writes sales_returns (customer_paid = 0, balance_amount = 14900)
   ├── Restocks PVC Pipes (+20)
   ├── Deducts Bosch Drill (-1)
   └── Updates sales.status = 'Fully Returned'
   ▼
[hardware.db State]
   ├── sales.payment_received = 0
   └── sales_returns.customer_paid = 0
```

---

## 4. PROOF OF PAYMENT CLASSIFICATION

**Classification**: **D. Missing from the current database (or a hypothetical scenario)**.

### Proof
- `sales.payment_received` = `0`
- `sales_returns.customer_paid` = `0`
- `transactions` count for `INV-011` = `0`
- `credit_payments` count for `INV-011` = `0`

No Rs. 1,000 cash payment was ever submitted or stored in `hardware.db` for `INV-011`. The actual payment recorded is **0 LKR**.

---

## 5. DATABASE ROW RELATIONSHIPS

1. `sales` (`so_1786902411145`) anchors the original transaction (`INV-011`, Rs. 3,600).
2. `sales_returns` (`sr_1786902685964`) links via `invoice_no = 'INV-011'`, recording the return of 3,600 worth of PVC Pipes and the exchange for an 18,500 Bosch Drill.
3. No foreign key constraints exist between `sales` and `sales_returns`. The link is maintained strictly via string matching on `invoice_no`.

---

## 6. AUTHORITATIVE PAYMENT AMOUNT FOR `INV-011`

$$\text{Authoritative Payment} = \mathbf{0\text{ LKR}}$$

---

## 7. RECALCULATION OF FINAL OUTSTANDING BALANCE

$$\text{Original Invoice Total} = 3,600\text{ LKR}$$
$$\text{Returned Value} = 3,600\text{ LKR}$$
$$\text{Exchange Value} = 18,500\text{ LKR}$$
$$\text{Original Payment Received} = 0\text{ LKR}$$
$$\text{Exchange Payment Received} = 0\text{ LKR}$$

$$\text{FINAL OUTSTANDING} = 3,600 - 3,600 + 18,500 - 0 - 0 = \mathbf{18,500\text{ LKR}}$$

---

## 8. DEFINITIVE SINGLE NUMBER CONCLUSION

$$\huge\mathbf{18,500\text{ LKR}}$$
