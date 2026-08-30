# Muthuwadige Hardware ERP — Client Release Documentation

**Golden Master Release: Version 0.0.2**

**Production Ready • Offline-First • Full Financial & Accounting Parity**

---

## 1. System Overview & Hardware Compatibility

**Muthuwadige Hardware ERP** is an enterprise-grade, offline-first Point of Sale (POS) and inventory management platform designed specifically for hardware and building materials retail operations. It combines high-speed POS billing, automated double-entry accounting, customer credit management, multi-unit stock tracking, and automated scheduled cloud backups.

### Supported Hardware & Peripherals

| Device Type | Compatibility & Specifications | Connection Interface |
| --- | --- | --- |
| **POS Thermal Printers** | 80mm & 58mm ESC/POS Thermal Receipt Printers | USB, Network / Ethernet, Virtual COM |
| **Barcode Scanners** | 1D & 2D Handheld, Wireless, Hands-Free Scanners (HID Keyboard Emulation) | USB Plug-and-Play, Bluetooth, 2.4G Wireless Dongle |
| **Thermal Label Printers** | 203 DPI Thermal Sticker Printers (Presets: 38×25mm, 50×25mm, 100×25mm 3-Up) | USB Direct, Windows Printer Driver |
| **Cash Drawers** | Standard 24V / 12V Heavy-Duty Metal Cash Drawers | RJ11 / RJ12 connected through POS Printer |
| **Displays & Monitors** | Full HD (1920×1080), Touchscreen POS Displays, Tablet Views | HDMI, DisplayPort, VGA |

---

## 2. Step-by-Step Installation Guide

Follow these steps to install the ERP on your primary POS counter terminal or back-office server machine:

### Step 1: Run the Installer

1. Double-click **`Muthuwadige Hardware ERP Setup 0.0.2.exe`** located in this release directory.
2. If Windows Defender SmartScreen appears, click **More info** $\rightarrow$ **Run anyway**.
3. Follow the on-screen installation wizard. The installer will deploy the application and configure all necessary local SQLite database engines and background services automatically.

### Step 2: Launch the ERP

1. A shortcut named **`Muthuwadige Hardware ERP`** will appear on your Windows Desktop and Start Menu.
2. Double-click the shortcut to start the system.
3. The embedded offline database engine and background services will initialize automatically in the background.

---

## 3. Default Access & User Credentials

The system comes pre-configured with Root Super Admin access. Use these credentials to sign in for the first time:

### Primary Super Administrator Login

* **Login Email:** `sanojhardware@gmail.com`
* **Login Password:** `sanoj123`
* **Access Level:** **Super Admin** *(Full unrestricted access to all modules, financial ledgers, staff configuration, system settings, and tax policies)*

---

### Staff Accounts & Role-Based Access Control (RBAC)

The system includes a dedicated **Users & Roles** module with preset role definitions and a built-in quota of **3 Additional Staff Members**:

| Role Preset | Primary Responsibilities & Capabilities | Permissions Included |
| --- | --- | --- |
| **Admin** | System administration, catalog management, pricing, financial oversight, tax settings. | Full catalog edit, cost visibility, financial reports, discounts, refunds. |
| **Manager** | Store operations, purchase orders (PO), goods receiving (GRN), inventory stock counts, shift closing. | PO creation, stock intake, shift reports, customer approvals, returns processing. |
| **Cashier** | Front-desk sales billing, fast checkout, credit invoice settlements, barcode lookup. | POS checkout, customer search, receipt printing, cash settlement. *(Cost prices & ledger hidden)* |

> **Staff Limit Policy:** You can create up to **3 dedicated secondary staff accounts** (e.g., Cashier Counter 1, Cashier Counter 2, Store Manager). All sales and credit settlement transactions automatically record real staff attribution when staff members log in and process transactions.

---

## 4. Automated Backup & Data Security

Your business data is protected by multiple layers of redundancy and enterprise SQLite Write-Ahead Logging (WAL):

### Automated Daily Cloud & Local Backup

* **Automatic Execution:** Every night at **23:00 (11:00 PM)**, the dedicated `backup-worker` executes an isolated snapshot of your database.
* **15-Worksheet Excel Ledger:** Generates a comprehensive `.xlsx` financial workbook encompassing Products, Sales, Invoices, Customers, Suppliers, Transactions, Cash Register, and Tax Summaries.
* **Secure Email Transmission:** Automatically emails the backup package directly to the owner's Gmail inbox.

### Backup Configuration Credentials

* **Destination Email:** `sanojhardware@gmail.com`
* **Google 16-Digit App Password:** `lwym phpa clay oyzq`

### Manual Instant Backup Trigger

1. Navigate to **Settings** $\rightarrow$ **Database & Backup Management**.
2. Click **"Trigger Instant Backup Now"** to generate an immediate snapshot and email delivery.

---

## 5. Password Recovery & SMTP Setup

If you or a staff member ever forget your password:

1. On the Login Screen, click **"Forgot Password?"**.
2. Enter your registered email address.
3. Click **"Send Reset Code"**.
4. The system securely dispatches a **6-digit verification code** via live SMTP to your email inbox.
5. Enter the 6-digit code and set your new password.

### SMTP Mailer Configuration

The system uses secure TLS Gmail SMTP (`smtp.gmail.com`, Port `587`). If you wish to update the backup/alert email address in the future:

1. Navigate to **Settings** $\rightarrow$ **Email & Alerts**.
2. Update the Sender Email and Google 16-digit App Password.
3. Click **"Test Connection & Save"**.

---

## 6. Daily Best Practices for Staff

* **Opening Shift:** Log in with your assigned staff account. Check the dashboard for low stock alerts.
* **Fast Checkout:** Use the POS barcode scanner for instant line-item addition. Press `F2` or click **Checkout** to process Cash, Card, Credit, or Cheque payments.
* **Closing Shift:** At the end of the business day, open **Reports** $\rightarrow$ **Shift Closing Report** to reconcile cash in drawer against the recorded POS inflow.
* **Offline Resilience:** The ERP operates 100% offline without requiring internet. Internet is only utilized for nightly email backup transmissions.

---

*© 2026 Muthuwadige Hardware. All Rights Reserved. Golden Master Release v0.0.2.*