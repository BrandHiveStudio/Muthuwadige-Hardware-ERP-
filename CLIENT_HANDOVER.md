# Muthuwadige Hardware ERP
## Client Handover & User Guide

---

## 1. System Overview

**Muthuwadige Hardware ERP** is an integrated management solution custom-designed to streamline and centralize the daily commercial operations of Muthuwadige Hardware. 

Managing a hardware enterprise involves handling hundreds of product lines, stock variations, cash and credit customer accounts, supplier deliveries, cashier shifts, and financial ledgers. This ERP system replaces fragmented manual books and standalone registers with a single, secure desktop platform.

### Primary Business Benefits:
- **Centralized Control**: Manages stock, sales, receivables, payables, and staff permissions from one application.
- **Accurate Inventory Tracking**: Automatically updates stock levels in real time as sales and purchases occur.
- **Customer Credit Management**: Tracks customer outstanding balances, credit terms, partial payments, and settlement receipts accurately.
- **Daily Cashier Shift Reconciliation**: Provides clear breakdowns of Cash, Credit Card, Bank Transfers, and Credit sales for shift closing.
- **Financial Transparency**: Generates real-time profit and loss insights, sales summaries, and complete audit history logs.

---

## 2. How the ERP Works

The system connects all operational departments through a continuous workflow:

```text
Products & Inventory ➔ Purchasing & Stock Intake ➔ Sales & Counter Billing ➔ Customer Credit Management ➔ Payment Settlements ➔ Cash Book & Finance ➔ Reports & Analytics
```

1. **Inventory**: Products are registered with cost prices, selling prices, minimum stock alerts, and unit metrics (pieces, kg, meters, liters, boxes).
2. **Purchasing**: New stock received from suppliers is recorded, instantly updating stock quantities and supplier payable balances.
3. **Sales & Billing**: Cashiers process counter bills using Cash, Card, Bank Transfer, or Credit payment methods. Inventory quantities automatically deduct upon checkout.
4. **Credit Management**: Credit sales automatically update the customer’s ledger. Credit settlements collected at the counter update physical cash balances and clear customer debts.
5. **Finance & Reports**: Every completed transaction feeds into the real-time financial dashboards and daily cashier shift reports.

---

## 3. Main System Modules

The ERP is organized into clear operational modules accessible through the main navigation menu:

| Module Name | Purpose | Key Staff Capabilities |
| :--- | :--- | :--- |
| **Dashboard** | Executive summary & real-time store metrics | View daily revenue, total sales count, active customers, stock valuation, and quick navigation shortcuts. |
| **Inventory** | Stock control & product catalogue | Add products, edit prices, monitor low-stock alerts, adjust stock quantities, and generate barcode/SKU details. |
| **Sales & Billing** | Point of Sale (POS) checkout & invoices | Create new counter sales, issue printed invoices, apply line discounts, select payment options, and manage quotations. |
| **Purchasing** | Supplier orders & inventory intake | Create purchase orders, record incoming supplier deliveries, and track stock receiving logs. |
| **Customers** | Customer ledger & credit tracking | Register customers, view credit limits, track purchase histories, and process partial/full credit bill settlements. |
| **Suppliers** | Vendor directory & balance management | Maintain supplier contacts, track supplier credit terms, and monitor payable outstanding accounts. |
| **Reports & Analytics** | Business performance & shift summaries | View daily sales summaries, cashier closing reports, payment method breakdowns, item profitability, and export PDF/Excel reports. |
| **Finance & Accounts** | Cash book & expense tracking | Log operational income and store expenses (rent, utilities, salaries) to calculate true net business profit. |
| **Users & Roles** | Staff access management | Create staff user accounts, assign roles (Super Admin, Admin, Cashier/Staff), and configure granular access rights. |
| **Database** | Local data maintenance & backups | Perform one-click database backups, restore system data, and monitor database storage status. |
| **Audit Logs** | System security & activity history | Review detailed logs of all staff logins, sales creations, credit updates, and system changes for total accountability. |
| **Settings** | Company branding & system options | Configure business name, store address, phone numbers, receipt header settings, and default currency symbols. |

---

## 4. Sales & Billing (POS Counter)

The **Sales & Billing** module is designed for fast, accurate counter checkouts.

### Processing a Standard Sale:
1. Open **Sales & Billing** from the navigation menu.
2. Search for items by name, SKU, or category, or select from the product list.
3. Adjust quantities, unit measures (e.g., pcs, kg, meters), and line discounts if needed.
4. Select or assign a customer (optional for standard cash sales; mandatory for credit sales).
5. Choose the **Payment Method**:
   - **Cash**: Direct counter cash payment.
   - **Card**: Credit or Debit card terminal payment.
   - **Bank Transfer**: Direct bank transfer or online deposit.
   - **Credit**: Customer buys on credit terms.
6. Click **Complete Sale & Print Invoice** to issue the customer invoice (`INV-001`).

### Credit Sales & Customer Bill Settlement:
- When a sale is processed with the **Credit** payment method, the invoice balance is automatically posted to the customer's personal account.
- Stock is immediately deducted from inventory.
- The invoice status remains **Non-Paid** or **Partially Settled** until payments are recorded in the **Customers** module.

---

## 5. Inventory & Stock Control

The **Inventory** module ensures your store never unexpectedly runs out of fast-selling hardware products.

### Key Capabilities:
- **Product Registration**: Store product names, SKUs, categories, buying cost prices, selling retail prices, and measurement units.
- **Real-Time Stock Updates**: Stock levels automatically decrease when sales occur and increase when purchase orders are completed.
- **Low Stock Threshold Alerts**: Items falling below their configured minimum stock quantity are highlighted in orange for re-ordering.
- **Stock Adjustments**: Staff can adjust inventory quantities due to breakage, damage, or audit discrepancies with recorded reason logs.
- **Stock Valuation**: Displays the total monetary cost value of all inventory currently stored on premises.

---

## 6. Customer & Credit Management

Credit management is critical for hardware operations. The **Customers** module provides complete control over credit terms and debt collection.

### Managing Customer Accounts:
- **Customer Directory**: Maintain detailed customer profiles including full name, phone number, national identity details (NIC), and physical address.
- **Purchase History**: View every invoice associated with a specific customer.
- **Outstanding Credit Balance**: Instantly view the total unpaid balance owed by each customer.

### Processing Credit Payments:
1. Navigate to **Customers** and locate the customer account.
2. View the outstanding unpaid invoices list.
3. Click **Settle Bill / Pay Credit**.
4. Enter the settlement amount paid by the customer (supports full payments or partial payments).
5. Select the payment method used for settlement (Cash, Card, Bank).
6. Click **Save Payment**. The customer's debt is automatically reduced, a payment receipt is logged, and the physical cash collected is reflected in the daily shift report.

---

## 7. Purchasing & Supplier Management

The **Purchasing** and **Suppliers** modules streamline supplier relationships and inventory restocking.

### Purchasing Workflow:
1. Maintain vendor profiles in **Suppliers** with phone numbers, addresses, and credit terms (e.g., Net 30).
2. Create a **Purchase Order (PO)** in **Purchasing** specifying the required items, quantities, and agreed purchase cost rates.
3. Upon receiving the goods at the warehouse, mark the order as **Received**.
4. The system automatically updates the inventory stock counts and registers the purchase costs.

---

## 8. Finance & Reports

The **Reports & Analytics** and **Finance & Accounts** modules turn raw daily transactions into actionable business management intelligence.

### Daily Shift Closing & Cashier Reconciliation:
At the end of every business shift, cashiers and managers can review **Today's Payment Method Breakdown**:
- **Cash**: Total physical cash collected at the counter today (Cash sales + Credit settlements received in cash).
- **Credit Card**: Card terminal payments received today.
- **Bank Transfer**: Direct bank transfer payments received today.
- **Credit**: Unsettled new credit extended to customers today.

### Business Reports Available:
- **Sales Performance**: Daily, weekly, and monthly sales trends.
- **Item Profitability**: Gross profit generated per product line.
- **Top Selling Products**: Identifies fast-moving and slow-moving SKUs.
- **Outstanding Receivables**: Real-time summary of all money owed to the hardware store by customers.
- **Cashier Shift Reports**: Individual cashier checkout transaction counts and total funds handled.
- **Exporting Options**: All reports can be exported instantly into professional **PDF** invoices or **Excel** spreadsheets.

---

## 9. Users & Roles Management

Security and accountability are enforced through role-based access control in **Users & Roles**.

### Pre-configured Access Roles:
1. **Super Admin / Owner**: Full access to all business modules, financial settings, inventory edits, user creation, and database tools.
2. **Admin / Manager**: Access to operations, stock control, billing, customer settlements, and daily reports.
3. **Retail Cashier / Staff**: Restricted access focused primarily on Sales & Billing counter checkouts and customer lookups.

> **Security Rule**: Staff members should only operate under their assigned personal login credentials. Never share passwords.

---

## 10. Audit Logs & System Security

- **Audit Trail**: The **Audit Logs** module records key user actions (logins, price edits, invoice cancellations, stock adjustments, and credit settlements) along with exact timestamps and user details.
- **Local Data Safety**: All store data is safely stored locally on your desktop system.
- **Database Backup Tool**: Navigate to **Database** to create on-demand database backups before performing major stock audits or system updates.

---

## 11. Recommended Daily Staff Workflow

To maintain smooth operations, staff should follow this standard daily routine:

```text
Morning Opening ➔ Review Dashboard & Stock Alerts ➔ Receive Supplier Deliveries ➔ Counter POS Billing & Credit Sales ➔ Process Credit Settlements ➔ Evening Shift Closing ➔ Review Reports & Reconcile Register
```

1. **Morning Opening**:
   - Log into the system using your individual staff account.
   - Check the **Dashboard** for low-stock alerts and daily targets.
2. **Stock Operations**:
   - Record any incoming goods in **Purchasing** to update stock before counter sales begin.
3. **Daily Billing**:
   - Process sales in **Sales & Billing**. Ensure correct items, quantities, and customer names are selected.
4. **Credit Payments**:
   - As customers visit to pay off outstanding accounts, process settlements in **Customers**.
5. **Evening Shift Closing**:
   - Open **Reports & Analytics** → **Today's Payment Method Breakdown**.
   - Count the physical cash in the drawer and match it with **Today's Cash**.
   - Match credit card receipts with **Today's Credit Card**.
   - Logout of the application.

---

## 12. Important Operating Notes

1. **Credential Privacy**: Keep your login email and password confidential. Do not share Super Admin credentials with unauthorized personnel.
2. **Accurate Item Quantities**: Always verify units of measure (e.g., verifying whether an item is priced per piece, per kg, or per meter) during billing.
3. **Customer Credit Assignment**: Always attach the correct customer profile when making a credit sale to ensure debt is posted to the right account.
4. **Regular Backups**: Use the **Database** menu to save periodic backup files to a secure secondary drive or USB storage.
5. **System Support**: In the event of hardware failure or technical assistance requirements, contact your designated system administrator or technical service provider.

---

## 13. Quick Start Guide for New Staff

1. **Sign In**: Enter your assigned email and password on the login screen.
2. **Explore the Dashboard**: Get familiar with the main menu on the left sidebar.
3. **Check Products**: Go to **Inventory** to search for product items, SKUs, and prices.
4. **Practice POS Billing**: Go to **Sales & Billing**, add items to the bill, select a payment method, and complete a test transaction.
5. **Learn Credit Payments**: Go to **Customers**, locate a customer, and review how credit settlements are recorded.
6. **View Reports**: Go to **Reports** to understand how daily shift cash summaries are displayed.

---

## 14. Handover Summary

The **Muthuwadige Hardware ERP System** is delivered fully configured and operational, providing complete centralized management of sales, stock, credit, cash flow, and performance reporting. By adhering to the operational workflows outlined in this guide, Muthuwadige Hardware can ensure maximum stock accuracy, financial security, and customer service excellence.
