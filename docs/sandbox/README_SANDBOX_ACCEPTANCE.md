# Muthuwadige Hardware ERP — Phase 4 Isolated Sandbox Acceptance Guide

## Overview
This directory contains the pre-configured Windows Sandbox (`.wsb`) file and the Windows 11 Home package enablement script for safe, air-gapped runtime acceptance testing of `Muthuwadige Hardware ERP Setup 1.0.0.exe`.

---

## 1. System Compatibility & Verification

| Parameter | Current System Value | Compatibility Status |
| :--- | :--- | :--- |
| **OS Edition** | Windows 11 Home (Build 26200, 64-bit) | **Home Edition (Servicing packages present)** |
| **CPU Virtualization** | AMD Ryzen 5 5500U with Radeon Graphics | **Enabled in BIOS/UEFI (`VirtualizationFirmwareEnabled: True`)** |
| **Sandbox Servicing Packages** | 24 `Containers-DisposableClientVM` packages in `C:\Windows\servicing\Packages` | **Verified Present** |
| **Administrator Elevation** | Required to enable optional feature | **Must be run elevated (UAC prompt)** |

---

## 2. Sandbox Configuration Details (`muthuwadige_erp_isolated.wsb`)

```xml
<Configuration>
  <VGpu>Disable</VGpu>
  <Networking>Disable</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>E:\HARDWARE-ERP-GOLDEN-MASTER-2026-08-27\GOLDEN~1\release-dist</HostFolder>
      <SandboxFolder>C:\Users\WDAGUtilityAccount\Desktop\ReleaseDist</SandboxFolder>
      <ReadOnly>true</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>explorer.exe C:\Users\WDAGUtilityAccount\Desktop\ReleaseDist</Command>
  </LogonCommand>
</Configuration>
```

### Safety Guarantees:
1. **`<Networking>Disable</Networking>`:** The sandbox starts completely disconnected from all networks. Zero outbound/inbound network traffic is permitted.
2. **`<ReadOnly>true</ReadOnly>`:** `release-dist` is mapped strictly read-only. The test environment cannot overwrite, delete, or modify any files on the host machine.
3. **Pristine Environment:** The sandbox always spins up a completely blank Windows instance with no prior database, registry entries, or AppData.
4. **Disposable:** Closing the sandbox window immediately destroys all temporary files, test databases, and registry changes without leaving traces on the host.

---

## 3. How to Enable & Run Windows Sandbox

### Step 1: Enable Sandbox (One-Time Setup)
Right-click `enable_windows_sandbox_home.bat` in this folder and choose **Run as administrator**.
The script will register the 24 local `Containers-DisposableClientVM` packages and enable the feature.

### Step 2: System Restart
Reboot the computer when prompted.

### Step 3: Launch Sandbox
Double-click `muthuwadige_erp_isolated.wsb`.
Windows Sandbox will boot into a pristine desktop with `ReleaseDist` open.

### Step 4: Execute Acceptance Checklist
1. Double-click `Muthuwadige Hardware ERP Setup 1.0.0.exe`.
2. Verify NSIS installation wizard, custom directory selection, and shortcut creation.
3. Launch the application.
4. Verify first-run database creation (`%APPDATA%\Muthuwadige Hardware ERP\hardware.db`).
5. Configure the Super Administrator account and confirm rejection of legacy/default accounts.
6. Verify POS invoice creation and local receipt printing in 100% offline mode.
