# MUTHUWADIGE HARDWARE ERP
## CLIENT HANDOVER, INSTALLATION & ACCEPTANCE GUIDE
**Golden Master Release 1.0.0**  
*Release Date: August 2026 / Verification: September 2026*  
*Authoritative Source: `🔒 Golden Master`*

---

### 1. RELEASE PACKAGE SUMMARY

| Attribute | Specification |
| :--- | :--- |
| **Product Name** | Muthuwadige Hardware ERP |
| **Release Version** | `1.0.0` (Golden Master) |
| **Installer Executable** | `release-dist/Muthuwadige Hardware ERP Setup 1.0.0.exe` |
| **Installer Size** | ~122.7 MB |
| **Package Format** | Nullsoft Scriptable Install System (NSIS) for Windows x64 |
| **Release Gate Status** | **PASSED** (0 legacy transaction violations across 75 source files) |
| **Target OS** | Microsoft Windows 10 / Windows 11 (64-bit) |
| **Database Engine** | Local SQLite Engine + Turso Cloud Sync Integration |

> [!IMPORTANT]
> **Old 0.0.2 Installer Obsoleted**: Do NOT distribute or install any previous `0.0.2` installer. Only `Muthuwadige Hardware ERP Setup 1.0.0.exe` contains all completed financial transaction managers, delta stock reconciliation, and two-stage void/deletion protections.

---

### 2. SYSTEM REQUIREMENTS

- **Operating System**: Windows 10 (64-bit) Version 1809 or higher / Windows 11.
- **Processor**: Intel Core i3 / AMD Ryzen 3 or higher.
- **Memory (RAM)**: 4 GB minimum (8 GB recommended for high-volume POS counter).
- **Storage**: 1 GB available disk space (SSD recommended for fast SQLite write throughput).
- **Peripherals**:
  - USB Thermal Receipt Printer (80mm / 58mm ESC/POS compatible) or standard A4/A5 laser/inkjet printer.
  - USB/Bluetooth 1D/2D Barcode Scanner.
  - Cash Drawer (connected via printer RJ11 port).
- **Network**: Local LAN connection for local networked counters. Active Internet connection required only for cloud synchronization (offline operation fully supported).

---

### 3. INSTALLATION PROCEDURE

#### Step 1 — Run Installer
1. Copy `Muthuwadige Hardware ERP Setup 1.0.0.exe` to the target computer.
2. Double-click the installer. If Windows SmartScreen displays a prompt, select **More info** -> **Run anyway**.
3. Choose the target installation directory (default: `C:\Program Files\Muthuwadige Hardware ERP`).
4. Select shortcut preferences (Desktop shortcut and Start Menu shortcut).
5. Click **Install**. The setup installs all application dependencies, local runtime engines, and reporting templates.
6. Click **Finish** to launch Muthuwadige Hardware ERP.

#### Step 2 — First-Time Administrator Login
1. Launch the application from the desktop shortcut.
2. On initial startup, the system automatically initializes the local database and provisions the root Super Administrator account.
3. Login using the default credentials:
   - **Email**: `muthuwadigehardware@gmail.com`
   - **Password**: *(Configured securely via client onboarding passkey / password reset)*
4. Navigate immediately to **Settings -> User Management** to update the Super Administrator password and configure cashier accounts.

#### Step 3 — Branch & Counter Terminal Setup
For multi-computer setups (e.g. Counter 1, Counter 2, Warehouse):
1. Navigate to **Settings -> System Settings**.
2. Assign a unique **Station ID** (e.g., `STN-01` for POS 1, `STN-02` for POS 2, `STN-WH` for Warehouse).
3. Confirm the **Branch ID** (e.g., `MAIN` or `BRANCH-02`).
4. If cloud synchronization is enabled, verify the Turso Cloud sync connection credentials.

---

### 4. CORE OPERATIONAL FEATURES & POLICIES

#### A. Multi-Computer Delta Stock Synchronization
- **Independent Offline Counters**: Terminals continue processing sales, stock receipts, and customer payments even when internet connectivity drops.
- **Delta-Based Reconciliation**: When reconnected, changes merge using mathematical deltas (`delta = new_qty - old_qty`). Simultaneous counter sales (e.g., -4 units on Counter 1) and warehouse receipts (e.g., +15 units on Warehouse terminal) are preserved without overwriting each other.
- **Zombie Account / Record Prevention**: Deleting a customer, supplier, or user while offline leaves a persistent tombstone in `deleted_records`. Subsequent cloud pulls will never resurrect deleted records.

#### B. Approved Invoice Voiding & Deletion Policy
1. **Stage 1 — Voiding (Safe Reversal)**:
   - Triggered via **Sales -> View Invoice -> Void Invoice**.
   - Requires supervisor authorization passkey.
   - Status changes to `VOIDED`.
   - Restores item stock quantities automatically.
   - Cleans up / reverses associated ledger entries.
   - **The invoice record is preserved in the database for auditing.**
2. **Stage 2 — Permanent Deletion (Strict Decontamination)**:
   - Triggered via **Sales -> View Invoice -> Delete Permanently**.
   - Restricted strictly to authorized Super Administrators.
   - Requires authorization passkey and explicit secondary confirmation.
   - **Strict Dependency Validation**: Rejected with an explanation if the invoice has unresolved customer credit debt or linked unredeemed credit notes.
   - When validated, safely deletes linked records inside an atomic database transaction and leaves an immutable audit entry in `deleted_records`.

#### C. Purchasing & Goods Receiving
- Full purchase order workflow: Draft -> Approved -> Received -> Completed.
- Receiving goods updates item stocks, creates double-entry journal transactions (`Inventory Asset` / `Accounts Payable`), and enqueues sync records within an atomic database transaction.

#### D. Sales Returns & Credit Notes
- Full support for Cash Refunds, Item Exchanges, and Store Credit Notes.
- Returns validate invoice line item quantities to prevent over-returns.
- Voiding a sales return reverses both returned inventory and financial transactions cleanly.

#### E. Cheque Operations
- Cheque lifecycle management across `Pending`, `Cleared`, `Bounced`, and `Returned`.
- Status updates automatically book accounting ledger transactions and synchronize across all terminals.

#### F. Automated Disaster Recoverability
- System data resets and backup restorations automatically generate a safety SQLite snapshot in `backups/` (`pre_reset_*.sqlite` and `pre_restore_*.sqlite`) prior to modifying data.

---

### 5. CLIENT ACCEPTANCE TESTING CHECKLIST

Please perform the following verification steps with the client during system handover:

- [ ] **1. Clean Installation**: Verify that `Muthuwadige Hardware ERP Setup 1.0.0.exe` installs without errors and creates desktop/start menu shortcuts.
- [ ] **2. Secure First-Run Setup**: Log in using the configured Super Administrator account. Confirm that the retired legacy administrator account and default development credentials are completely rejected by the authentication system.
- [ ] **3. Product Management**: Add a new product (e.g., "Tokyo Super Cement 50kg", cost Rs. 2,200, selling Rs. 2,450, stock: 50).
- [ ] **4. POS Invoicing**: Issue a cash sale for 5 bags of cement (Total Rs. 12,250). Verify receipt generation, invoice numbering, and that stock decreases from 50 to 45.
- [ ] **5. Invoice Voiding (Stage 1)**: Void the invoice using the supervisor passkey. Verify that stock is restored to 50, status is `VOIDED`, and the invoice record remains visible in the system.
- [ ] **6. Permanent Deletion Protection (Stage 2)**: Attempt to permanently delete an active invoice without voiding; confirm the system blocks the deletion. Permanently delete a voided invoice with explicit confirmation and verify it leaves an audit tombstone.
- [ ] **7. Purchase Order Receiving**: Create and receive a PO for 20 units of an item. Confirm that stock increases by 20 and supplier payable balance updates correctly.
- [ ] **8. Sales Return**: Issue a return for an invoice item with cash refund. Verify restock and ledger entries.
- [ ] **9. Cheque Lifecycle**: Record a post-dated customer cheque for Rs. 50,000. Transition status to `Cleared` and verify double-entry journal transaction creation.
- [ ] **10. Offline & Multi-Terminal Sync**: Disconnect internet on Counter 1. Complete a sale offline. Reconnect internet and verify that the sale and delta stock changes synchronize accurately with the cloud and other counters.
- [ ] **11. Safety Backup Snapshot**: Execute a test backup. Verify that backup `.sqlite` and `.xlsx` files are generated in the `backups/` directory.

---

### 6. CLIENT HANDOVER SIGN-OFF

**System Delivered By:**  
Engineering Team — Antigravity Advanced Agentic Coding  
Date: ____________________  
Signature: ____________________  

**System Accepted By:**  
Authorized Representative — Muthuwadige Hardware  
Date: ____________________  
Signature: ____________________  
