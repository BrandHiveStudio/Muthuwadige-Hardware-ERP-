import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabaseClient';
import { useCurrency } from '../context/CurrencyContext';
import { useScanner } from '../context/ScannerContext';
import { QRCodeSVG } from 'qrcode.react';
import { API_URL, BASE_URL, setApiUrl } from '../lib/api';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  PlusIcon, ShieldIcon, CheckIcon, DownloadIcon,
  DatabaseIcon, RefreshCcwIcon, XIcon, LockIcon,
  Trash2Icon, Edit2Icon, Loader2Icon, FileTextIcon,
  PackageIcon, ShoppingCartIcon, DollarSignIcon, TruckIcon, UsersIcon,
  PrinterIcon, MapPinIcon, SearchIcon, MailIcon, EyeIcon, EyeOffIcon, TagIcon,
  SmartphoneIcon, CopyIcon, ExternalLinkIcon, ZapIcon, ChevronDownIcon, ChevronUpIcon
} from 'lucide-react';

type Tab = 'system' | 'backup' | 'network' | 'scanner' | 'database';

export function Settings() {
  const { currency, setCurrency } = useCurrency();
  const {
    scannerSessionId,
    setScannerSessionId,
    isMobileScannerConnected,
    connectedDevicesCount,
    connectedClients,
    fetchConnectedClients,
    isRefreshingClients,
    recentScans,
    clearRecentScans,
    localScannerInfo,
    fetchScannerInfo,
    sendTestBarcode
  } = useScanner();

  const [tab, setTab] = useState<Tab>('system');
  const [selectedScannerIp, setSelectedScannerIp] = useState<string>('');
  const [copiedScannerUrl, setCopiedScannerUrl] = useState(false);
  const [testBarcodeInput, setTestBarcodeInput] = useState('');
  const [showSimulatorAccordion, setShowSimulatorAccordion] = useState(false);

  useEffect(() => {
    if (localScannerInfo?.ip && !selectedScannerIp) {
      setSelectedScannerIp(localScannerInfo.ip);
    }
  }, [localScannerInfo, selectedScannerIp]);

  const activeScannerUrl = useMemo(() => {
    const ip = selectedScannerIp || localScannerInfo?.ip || '127.0.0.1';
    const httpsPort = localScannerInfo?.httpsPort || 5443;
    return `https://${ip}:${httpsPort}/mobile-scanner?session=${encodeURIComponent(scannerSessionId)}`;
  }, [selectedScannerIp, localScannerInfo, scannerSessionId]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal & Saving States
  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [deleteTargetUser, setDeleteTargetUser] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

  // System Configuration States
  const [shopName, setShopName] = useState('MUTHUWADIGE HARDWARE');
  const [shopAddress, setShopAddress] = useState('');
  const [shopPhone, setShopPhone] = useState('');
  const [shopEmail, setShopEmail] = useState('');
  const [backupEmail, setBackupEmail] = useState('');
  const [backupFromDate, setBackupFromDate] = useState('');
  const [backupToDate, setBackupToDate] = useState('');
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupIntervalHours, setBackupIntervalHours] = useState<number | string>(6);
  const [backupIntervalError, setBackupIntervalError] = useState<string | null>(null);
  const [taxRate, setTaxRate] = useState(0);
  const [threshold, setThreshold] = useState(10);
  const [settingsId, setSettingsId] = useState<string>('global');
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState('INV001');
  const [returnPasskey, setReturnPasskey] = useState('1234');
  const [saved, setSaved] = useState(false);

  // User Forms State
  const [formData, setFormData] = useState({ name: '', email: '', role: 'cashier', password: '' });
  const [editingUser, setEditingUser] = useState<any>(null);

  // Password Change State
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  // Backup History State with Download URLs
  const [recentBackups, setRecentBackups] = useState<any[]>([]);
  const [selectedBackups, setSelectedBackups] = useState<string[]>([]);
  const [isEmailingBackup, setIsEmailingBackup] = useState(false);
  const [logoPath, setLogoPath] = useState('');
  const [printerSettings, setPrinterSettings] = useState({ ip: '', port: '9100', type: 'Network', paperSize: '80mm' });
  const [labelPrinterSettings, setLabelPrinterSettings] = useState({ defaultPreset: '50x25', printerName: 'Xprinter XP-T451B' });
  const [branchSettings, setBranchSettings] = useState({ name: '', code: '', address: '' });
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // SMTP Configuration State
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpPassConfigured, setSmtpPassConfigured] = useState(false);
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [isSavingSmtp, setIsSavingSmtp] = useState(false);
  const [isTestingSmtp, setIsTestingSmtp] = useState(false);

  // Database Tables Viewer State
  const [dbTab, setDbTab] = useState<'products' | 'customers' | 'employees' | 'profiles' | 'purchase_orders' | 'sales' | 'system_settings' | 'transactions'>('products');
  const [dbData, setDbData] = useState<any[]>([]);
  const [dbSearch, setDbSearch] = useState('');
  const [dbLoading, setDbLoading] = useState(false);

  // Network & Connection States
  const [appRole, setAppRole] = useState<'host' | 'client'>(
    localStorage.getItem('erp_host_address') ? 'client' : 'host'
  );
  const [hostAddress, setHostAddress] = useState(
    localStorage.getItem('erp_host_address') || 'http://localhost:5001'
  );
  const [networkAddresses, setNetworkAddresses] = useState<any[]>([]);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleEmailBackup = async () => {
    setIsEmailingBackup(true);
    try {
      const response = await fetch(`${API_URL}/settings/trigger-backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromDate: backupFromDate || null,
          toDate: backupToDate || null
        })
      });
      const result = await response.json();
      if (response.ok && result.success) {
        alert("Full database Excel backup generated successfully!");
      } else {
        alert("Backup status: " + (result.message || result.error || "Backup operation failed."));
      }
    } catch (e) {
      alert("Failed to connect to local SQLite backup service. Please verify that the Express SQLite server is running.");
    } finally {
      setIsEmailingBackup(false);
      fetchInitialData();
    }
  };

  const handleDeleteBackup = async (id: string, name: string) => {
    if (!id) {
      setRecentBackups(prev => prev.filter(b => b.name !== name));
      return;
    }
    if (window.confirm(`Are you sure you want to delete the backup "${name}"?`)) {
      try {
        const res = await fetch(`${API_URL}/backup-logs/${id}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          alert("Backup deleted successfully!");
          fetchInitialData();
        } else {
          const err = await res.json();
          alert("Failed to delete backup: " + (err.error || err.message));
        }
      } catch (e: any) {
        alert("Error connecting to server: " + e.message);
      }
    }
  };

  const handleDeleteSelectedBackups = async () => {
    if (selectedBackups.length === 0) return;
    if (window.confirm(`Are you sure you want to delete the ${selectedBackups.length} selected backup(s)?`)) {
      try {
        const res = await fetch(`${API_URL}/backup-logs/bulk-delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: selectedBackups })
        });
        if (res.ok) {
          alert("Selected backup(s) deleted successfully!");
          setSelectedBackups([]);
          fetchInitialData();
        } else {
          const err = await res.json();
          alert("Failed to delete selected backup(s): " + (err.error || err.message));
        }
      } catch (e: any) {
        alert("Error connecting to server: " + e.message);
      }
    }
  };

  const handleTestHostConnection = async () => {
    if (!hostAddress) {
      setConnectionTestResult({ success: false, message: 'Please enter a host address.' });
      return;
    }

    let cleanAddress = hostAddress.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(cleanAddress)) {
      cleanAddress = `http://${cleanAddress}`;
    }

    setIsTestingConnection(true);
    setConnectionTestResult(null);

    try {
      const res = await fetch(`${cleanAddress}/api/settings`);
      if (res.ok) {
        setConnectionTestResult({
          success: true,
          message: 'Connection successful! Host is online and responsive.'
        });
      } else {
        setConnectionTestResult({
          success: false,
          message: `Failed to connect (Status: ${res.status}). Verify this is a Muthuwadige ERP host.`
        });
      }
    } catch (err: any) {
      setConnectionTestResult({
        success: false,
        message: `Connection failed: ${err.message || 'Host is unreachable. Verify host address and firewall rules.'}`
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSaveConnectionSettings = () => {
    if (appRole === 'host') {
      setApiUrl(null);
      alert("Switched to Standalone Host mode. The application will reload.");
      window.location.reload();
    } else {
      let cleanAddress = hostAddress.trim().replace(/\/$/, '');
      if (!cleanAddress) {
        alert("Please enter a valid host address.");
        return;
      }
      if (!/^https?:\/\//i.test(cleanAddress)) {
        cleanAddress = `http://${cleanAddress}`;
      }

      if (cleanAddress.includes('localhost') || cleanAddress.includes('127.0.0.1')) {
        if (!confirm("Connecting to localhost in Client Mode behaves like Host Mode. Do you want to proceed?")) {
          return;
        }
      }

      setApiUrl(cleanAddress);
      alert(`Connected successfully to remote Host: ${cleanAddress}. Reloading app...`);
      window.location.reload();
    }
  };

  useEffect(() => {
    fetchInitialData();
    const handleRefresh = () => {
      fetchInitialData();
    };
    window.addEventListener('settings-updated', handleRefresh);
    return () => {
      window.removeEventListener('settings-updated', handleRefresh);
    };
  }, []);

  const fetchInitialData = async () => {
    setLoading(true);
    setSelectedBackups([]);
    const { data: userData } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (userData) setUsers(userData);

    const { data: settingData } = await supabase.from('system_settings').select('*').single();
    if (settingData) {
      setSettingsId(settingData.id || 'global');
      setShopName(settingData.shop_name || '');
      setShopAddress(settingData.address || '');
      setShopPhone(settingData.phone || '');
      setShopEmail(settingData.email || '');
      setBackupEmail(settingData.backup_email || '');
      setBackupEnabled(settingData.backup_enabled === true || settingData.backup_enabled === 1 || false);
      setBackupIntervalHours(settingData.backup_interval_hours || 6);
      setLogoPath(settingData.logo_path || '');
      setReturnPasskey(settingData.return_passkey || settingData.void_passkey || '1234');

      if (settingData.printer_settings) {
        try {
          const parsed = typeof settingData.printer_settings === 'object' ? settingData.printer_settings : JSON.parse(settingData.printer_settings);
          setPrinterSettings({
            ip: parsed.ip || '',
            port: parsed.port || '9100',
            type: parsed.type || 'Network',
            paperSize: parsed.paperSize || '80mm'
          });
        } catch (e) { }
      }
      if (settingData.label_printer_settings) {
        try {
          const parsed = typeof settingData.label_printer_settings === 'object' ? settingData.label_printer_settings : JSON.parse(settingData.label_printer_settings);
          setLabelPrinterSettings({
            defaultPreset: parsed.defaultPreset || '50x25',
            printerName: parsed.printerName || 'Xprinter XP-T451B'
          });
        } catch (e) { }
      }
      if (settingData.branch_settings) {
        try {
          setBranchSettings(typeof settingData.branch_settings === 'object' ? settingData.branch_settings : JSON.parse(settingData.branch_settings));
        } catch (e) { }
      }

      setTaxRate(0);
      if (settingData.currency) {
        const cur = settingData.currency === 'Rs.' ? 'LKR' : settingData.currency;
        setCurrency(cur);
      }
      if (settingData.next_invoice_number) {
        setNextInvoiceNumber(settingData.next_invoice_number);
      } else {
        setNextInvoiceNumber('INV001');
      }
    }

    try {
      const resLogs = await fetch(`${API_URL}/backup-logs`);
      if (resLogs.ok) {
        const logsData = await resLogs.json();
        const mappedLogs = logsData.map((l: any) => ({
          id: l.id,
          name: l.file_name,
          date: new Date(l.timestamp).toLocaleString(),
          size: l.status === 'Success' ? 'Success • ' + l.type : 'Failed • ' + l.type,
          url: `${BASE_URL}/backups/${l.file_name}`,
          status: l.status
        }));
        setRecentBackups(mappedLogs);
      }
    } catch (err) {
      console.warn("Failed to load backup logs", err);
    }

    try {
      const resNet = await fetch(`${API_URL}/system/network-info`);
      if (resNet.ok) {
        const netData = await resNet.json();
        if (netData && netData.addresses) {
          setNetworkAddresses(netData.addresses);
        }
      }
    } catch (err) {
      console.warn("Failed to load network interfaces", err);
    }

    try {
      const resSmtp = await fetch(`${API_URL}/settings/smtp-config`);
      if (resSmtp.ok) {
        const smtpData = await resSmtp.json();
        if (smtpData) {
          setSmtpUser(smtpData.gmail_user || '');
          setSmtpPassConfigured(smtpData.gmail_pass_configured || false);
        }
      }
    } catch (err) {
      console.warn("Failed to load SMTP status", err);
    }

    setLoading(false);
  };

  const handleSaveSmtp = async () => {
    setIsSavingSmtp(true);
    try {
      const res = await fetch(`${API_URL}/settings/smtp-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gmail_user: smtpUser,
          gmail_pass: smtpPass
        })
      });
      const result = await res.json();
      if (res.ok && result.success) {
        alert(result.message || "SMTP configuration saved successfully!");
        setSmtpPass('');
        setSmtpPassConfigured(true);
      } else {
        alert("Failed to save SMTP settings: " + (result.error || result.message || "Unknown error"));
      }
    } catch (e: any) {
      alert("Error saving SMTP settings: " + e.message);
    } finally {
      setIsSavingSmtp(false);
    }
  };

  const handleTestSmtpConnection = async () => {
    setIsTestingSmtp(true);
    try {
      const res = await fetch(`${API_URL}/settings/test-smtp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();
      if (res.ok && result.success) {
        alert(result.message || "SMTP Connection Successful!");
      } else {
        alert("SMTP Test Failed: " + (result.message || result.error || "Authentication failure."));
      }
    } catch (e: any) {
      alert("Error testing SMTP connection: " + e.message);
    } finally {
      setIsTestingSmtp(false);
    }
  };

  const fetchDbTable = async () => {
    setDbLoading(true);
    try {
      const { data } = await supabase.from(dbTab).select('*');
      setDbData(data || []);
    } catch (e) {
      console.error("Failed to fetch database table for Settings:", e);
    } finally {
      setDbLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'database') {
      fetchDbTable();
    }
  }, [tab, dbTab]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || formData.name.trim().length < 2) {
      alert("Name must be at least 2 characters.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email.trim())) {
      alert("Please enter a valid email address.");
      return;
    }

    if (formData.password.length < 6) {
      alert("Password must be at least 6 characters for security.");
      return;
    }

    setIsSaving(true);
    const { error } = await supabase.auth.signUp({
      email: formData.email.trim(),
      password: formData.password,
      options: {
        data: {
          full_name: formData.name.trim(),
          role: formData.role
        }
      }
    });

    setIsSaving(false);
    if (!error) {
      alert(`Account created successfully for ${formData.name}!`);
      setShowAddUser(false);
      setFormData({ name: '', email: '', role: 'cashier', password: '' });
      fetchInitialData();
    } else {
      alert("Failed to create user account: " + (error.message || error));
    }
  };

  const handleUpdateSettings = async () => {
    if (!shopName || shopName.trim().length < 2) {
      alert("Shop Name must be at least 2 characters.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!shopEmail || !emailRegex.test(shopEmail.trim())) {
      alert("Please enter a valid shop email address.");
      return;
    }

    if (!shopPhone || shopPhone.trim().length < 9) {
      alert("Please enter a valid shop contact number.");
      return;
    }

    if (backupEnabled) {
      if (!backupEmail || !emailRegex.test(backupEmail.trim())) {
        alert("Please enter a valid backup destination email address.");
        return;
      }
      const intervalNum = Number(backupIntervalHours);
      if (!backupIntervalHours || isNaN(intervalNum) || !Number.isInteger(intervalNum) || intervalNum < 1 || intervalNum > 168) {
        alert("Please enter a valid backup interval between 1 and 168 whole hours.");
        return;
      }
    }

    setIsSaving(true);
    const payload = {
      id: settingsId || 'global',
      shop_name: shopName.trim(),
      address: shopAddress.trim(),
      phone: shopPhone.trim(),
      email: shopEmail.trim(),
      currency,
      tax_rate: 0,
      backup_email: backupEmail.trim(),
      backup_enabled: backupEnabled ? 1 : 0,
      backup_interval_hours: Number(backupIntervalHours) || 6,
      logo_path: logoPath,
      printer_settings: printerSettings,
      label_printer_settings: labelPrinterSettings,
      branch_settings: branchSettings,
      next_invoice_number: nextInvoiceNumber.trim(),
      return_passkey: returnPasskey.trim(),
      void_passkey: returnPasskey.trim()
    };

    const { error } = await supabase.from('system_settings').upsert([payload], {
      onConflict: 'id',
      returning: 'representation'
    });

    setIsSaving(false);
    if (!error) {
      setSaved(true);
      window.dispatchEvent(new Event('settings-updated'));
      fetchInitialData();
      setTimeout(() => setSaved(false), 2000);
    } else {
      console.error('Settings update failed', error);
      alert("Failed to save settings: " + (error.message || error));
    }
  };

  const handleTestEmail = async () => {
    setIsSendingTest(true);
    try {
      const res = await fetch(`${API_URL}/settings/test-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const result = await res.json();
      if (res.ok) {
        alert(result.message || "Test email notification successfully sent!");
      } else {
        alert("SMTP configuration alert: " + (result.error || result.message || "Failed to send email. Ensure you have set GMAIL_PASS."));
      }
    } catch (err) {
      alert("Failed to connect to local server for test notification.");
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleRestoreExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm("CRITICAL WARNING: Restoring the database will completely wipe and overwrite all existing system records. Are you sure you want to proceed?")) {
      e.target.value = '';
      return;
    }

    try {
      setIsRestoring(true);
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });

      const payload: any = {};

      wb.SheetNames.forEach(sheetName => {
        const cleanName = sheetName.replace(/[^\w\s]/g, '').trim().toLowerCase();
        const ws = wb.Sheets[sheetName];
        const rawRows = XLSX.utils.sheet_to_json(ws);

        if (cleanName.includes('inventory') || cleanName.includes('product')) {
          payload.products = rawRows;
        } else if (cleanName.includes('sales') || cleanName.includes('invoice')) {
          payload.sales = rawRows;
        } else if (cleanName.includes('ledger') || cleanName.includes('transaction') || cleanName.includes('accounting')) {
          payload.transactions = rawRows;
        } else if (cleanName.includes('customer')) {
          payload.customers = rawRows;
        } else if (cleanName.includes('employee') || cleanName.includes('staff')) {
          payload.employees = rawRows;
        } else if (cleanName.includes('profile') || cleanName.includes('user') || cleanName.includes('login')) {
          payload.profiles = rawRows;
        } else if (cleanName.includes('settings') || cleanName.includes('configuration')) {
          payload.system_settings = rawRows;
        } else if (cleanName.includes('supplier')) {
          payload.suppliers = rawRows;
        } else if (cleanName.includes('purchase')) {
          payload.purchase_orders = rawRows;
        } else if (cleanName.includes('adjustment')) {
          payload.stock_adjustments = rawRows;
        } else if (cleanName.includes('quote') || cleanName.includes('quotation')) {
          payload.quotations = rawRows;
        } else if (cleanName.includes('delivery')) {
          payload.delivery_notes = rawRows;
        } else if (cleanName.includes('branch')) {
          payload.branches = rawRows;
        }
      });

      const res = await fetch(`${API_URL}/settings/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await res.json();
      if (res.ok) {
        window.dispatchEvent(new Event('settings-updated'));
        alert("Database successfully restored! Reloading system settings...");
        fetchInitialData();
      } else {
        alert("Restore failed: " + (result.error || "Invalid file format"));
      }
    } catch (err: any) {
      console.error("Excel parse error", err);
      alert("Failed to parse Excel file: " + err.message);
    } finally {
      setIsRestoring(false);
      e.target.value = '';
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      alert("Passwords do not match!");
      return;
    }
    if (newPassword.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }
    setIsUpdatingPassword(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const res = await fetch(`${API_URL}/profiles/${user.id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword })
      });
      if (res.ok) {
        alert("Password updated successfully!");
        setShowChangePasswordModal(false);
        setNewPassword('');
        setConfirmPassword('');
      } else {
        alert("Failed to update password.");
      }
    } else {
      alert("No active session found.");
    }
    setIsUpdatingPassword(false);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-500">
      {/* Tab Navigation */}
      <div className="flex gap-1 bg-white p-1 rounded-xl w-fit border border-gray-200 shadow-sm overflow-x-auto max-w-full">
        {(['system', 'backup', 'network', 'scanner'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap flex items-center gap-2 ${tab === t ? 'bg-[#464646] text-white shadow-md' : 'text-gray-500 hover:text-[#464646] hover:bg-gray-50'}`}>
            {t === 'system' ? 'System Settings' : t === 'backup' ? 'Backup & Restore' : t === 'network' ? 'Connection & Network' : (
              <>
                <SmartphoneIcon className="w-4 h-4" />
                <span>Mobile Camera Scanner</span>
                {isMobileScannerConnected && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>}
              </>
            )}
          </button>
        ))}
      </div>

      {/* SYSTEM TAB */}
      {tab === 'system' && (
        <div className="bg-white rounded-3xl border border-gray-100 p-4 sm:p-6 md:p-10 max-w-3xl shadow-md animate-in slide-in-from-left-4 relative overflow-hidden group">
          <div className="absolute top-0 left-0 h-1.5 w-full bg-[#DAA520]" />

          <div className="flex items-center gap-5 mb-8 border-b border-gray-100/80 pb-6 text-left">
            <div className="w-14 h-14 bg-[#DAA520]/10 rounded-2xl flex items-center justify-center shadow-inner shrink-0">
              <DatabaseIcon className="w-7 h-7 text-[#DAA520]" />
            </div>
            <div>
              <h2 className="font-black text-xl text-[#464646] uppercase tracking-wider">General Configuration</h2>
              <p className="text-xs font-bold text-gray-400 mt-1">Manage shop branding, location, phone records, and printer settings.</p>
            </div>
          </div>

          <div className="space-y-6">
            {/* Logo Upload Section */}
            <div className="flex flex-col sm:flex-row items-center gap-6 p-6 bg-slate-50 rounded-2xl border border-slate-100 text-left">
              <div className="relative w-24 h-24 bg-white border border-gray-200 rounded-2xl overflow-hidden flex items-center justify-center shadow-inner group shrink-0">
                {logoPath ? (
                  <img src={logoPath} alt="Shop Logo" className="w-full h-full object-contain p-2" />
                ) : (
                  <div className="text-gray-300 font-black text-[10px] uppercase tracking-widest text-center px-2">No Logo Uploaded</div>
                )}
              </div>
              <div className="space-y-2 flex-1">
                <h4 className="text-xs font-black text-[#464646] uppercase tracking-wider">Business Branding Logo</h4>
                <p className="text-[10px] text-gray-400 font-bold leading-relaxed">
                  Upload a high-resolution PNG or JPG image of your business logo. This logo will automatically display at the top of the navigation sidebar and on all printed POS invoices.
                </p>
                <div className="flex gap-3">
                  <label className="px-4 py-2 bg-[#DAA520] hover:bg-[#B8860B] text-white text-[9px] font-black rounded-lg uppercase tracking-wider cursor-pointer shadow transition-all">
                    Upload Image File
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setLogoPath(reader.result as string);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                  {logoPath && (
                    <button
                      type="button"
                      onClick={() => setLogoPath('')}
                      className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-[9px] font-black rounded-lg uppercase tracking-wider shadow transition-all"
                    >
                      Remove Logo
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="text-left">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2.5 block">Shop Name</label>
                <input
                  type="text"
                  value={shopName}
                  onChange={e => setShopName(e.target.value)}
                  className="w-full px-5 py-3.5 border border-gray-200 rounded-2xl outline-none focus:ring-4 focus:ring-[#DAA520]/15 focus:border-[#DAA520] font-bold text-[#464646] transition-all duration-300 shadow-sm"
                />
              </div>
              <div className="text-left">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2.5 block">Shop Email</label>
                <input
                  type="email"
                  value={shopEmail}
                  onChange={e => setShopEmail(e.target.value)}
                  className="w-full px-5 py-3.5 border border-gray-200 rounded-2xl outline-none focus:ring-4 focus:ring-[#DAA520]/15 focus:border-[#DAA520] font-bold text-[#464646] transition-all duration-300 shadow-sm"
                />
              </div>
            </div>

            <div className="text-left">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2.5 block">Shop Address</label>
              <textarea
                value={shopAddress}
                onChange={e => setShopAddress(e.target.value)}
                rows={2}
                className="w-full px-5 py-3.5 border border-gray-200 rounded-2xl outline-none focus:ring-4 focus:ring-[#DAA520]/15 focus:border-[#DAA520] font-bold text-[#464646] resize-none transition-all duration-300 shadow-sm leading-relaxed"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="text-left">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2.5 block">Shop Phone</label>
                <input
                  type="text"
                  value={shopPhone}
                  onChange={e => setShopPhone(e.target.value)}
                  className="w-full px-5 py-3.5 border border-gray-200 rounded-2xl outline-none focus:ring-4 focus:ring-[#DAA520]/15 focus:border-[#DAA520] font-bold text-[#464646] transition-all duration-300 shadow-sm"
                />
              </div>
              <div className="text-left">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2.5 block">Currency</label>
                <select
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className="w-full px-5 py-3.5 border border-gray-200 rounded-2xl outline-none focus:ring-4 focus:ring-[#DAA520]/15 focus:border-[#DAA520] font-bold text-[#464646] cursor-pointer bg-white transition-all duration-300 shadow-sm"
                >
                  <option value="LKR">LKR (Rs.)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              <div className="text-left">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2.5 block">Next Auto-Generated Invoice Number</label>
                <input
                  type="text"
                  value={nextInvoiceNumber}
                  onChange={e => setNextInvoiceNumber(e.target.value)}
                  className="w-full px-5 py-3.5 border border-gray-200 rounded-2xl outline-none focus:ring-4 focus:ring-[#DAA520]/15 focus:border-[#DAA520] font-bold text-[#464646] transition-all duration-300 shadow-sm"
                  placeholder="e.g. INV001"
                />
                <p className="text-[10px] text-gray-400 mt-1.5 font-bold">This is the starting invoice number. Subsequent numbers will increment automatically (e.g. INV001 ➜ INV002 ➜ INV003).</p>
              </div>
              <div className="text-left">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2.5 block">Centralized Void Security Passkey</label>
                <input
                  type="password"
                  value={returnPasskey}
                  onChange={e => setReturnPasskey(e.target.value)}
                  className="w-full px-5 py-3.5 border border-gray-200 rounded-2xl outline-none focus:ring-4 focus:ring-[#DAA520]/15 focus:border-[#DAA520] font-bold text-[#464646] transition-all duration-300 shadow-sm"
                  placeholder="e.g. 1234"
                />
                <p className="text-[10px] text-gray-400 mt-1.5 font-bold">This single centralized passkey is required to authorize both Sales Void and Sales Return Void operations.</p>
              </div>
            </div>

            {/* Printer & Branch Configuration */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-gray-100 pt-6">
              {/* Printer Settings */}
              <div className="space-y-4 text-left">
                <h3 className="text-xs font-black text-[#464646] uppercase tracking-widest flex items-center gap-2">
                  <PrinterIcon className="w-4 h-4 text-[#DAA520]" /> Network Printer Configuration
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Printer IP Address</label>
                    <input
                      type="text"
                      placeholder="e.g. 192.168.1.100"
                      value={printerSettings.ip}
                      onChange={e => setPrinterSettings({ ...printerSettings, ip: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646]"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Printer Port</label>
                    <input
                      type="text"
                      placeholder="9100"
                      value={printerSettings.port}
                      onChange={e => setPrinterSettings({ ...printerSettings, port: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Connection Interface</label>
                  <select
                    value={printerSettings.type}
                    onChange={e => setPrinterSettings({ ...printerSettings, type: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646] bg-white cursor-pointer"
                  >
                    <option value="Network">TCP/IP Network Printer</option>
                    <option value="USB">Local USB Printer</option>
                    <option value="Bluetooth">Bluetooth Printer</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Receipt Paper Size</label>
                  <select
                    value={printerSettings.paperSize || '80mm'}
                    onChange={e => setPrinterSettings({ ...printerSettings, paperSize: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646] bg-white cursor-pointer"
                  >
                    <option value="A4">Standard A4 Page</option>
                    <option value="80mm">80mm Thermal POS Receipt</option>
                  </select>
                </div>
              </div>

              {/* Branch Settings */}
              <div className="space-y-4 text-left">
                <h3 className="text-xs font-black text-[#464646] uppercase tracking-widest flex items-center gap-2">
                  <MapPinIcon className="w-4 h-4 text-[#DAA520]" /> Outlet Branch Registry
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Branch Code</label>
                    <input
                      type="text"
                      placeholder="e.g. NEG-01"
                      value={branchSettings.code}
                      onChange={e => setBranchSettings({ ...branchSettings, code: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646]"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Branch Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Negombo Town"
                      value={branchSettings.name}
                      onChange={e => setBranchSettings({ ...branchSettings, name: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646]"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Branch Address</label>
                  <input
                    type="text"
                    placeholder="Branch Street Location"
                    value={branchSettings.address}
                    onChange={e => setBranchSettings({ ...branchSettings, address: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646]"
                  />
                </div>
              </div>
            </div>

            {/* Barcode Label Printer Configuration */}
            <div className="border-t border-gray-100 pt-6 mt-6 text-left">
              <h3 className="text-xs font-black text-[#464646] uppercase tracking-widest flex items-center gap-2">
                <TagIcon className="w-4 h-4 text-[#DAA520]" /> 🏷️ Barcode Label Printer Configuration
              </h3>
              <p className="text-[10px] text-gray-400 font-bold mb-3 mt-1">
                Configure dedicated thermal sticker printer defaults (e.g. Xprinter XP-T451B) isolated from POS receipt printers.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Default Label Sticker Size</label>
                  <select
                    value={labelPrinterSettings.defaultPreset || '50x25'}
                    onChange={e => setLabelPrinterSettings({ ...labelPrinterSettings, defaultPreset: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646] bg-[#FAFAFA] hover:bg-white cursor-pointer"
                  >
                    <option value="50x25">50mm × 25mm (Standard Single Sticker)</option>
                    <option value="38x25">38mm × 25mm (Compact Single Sticker)</option>
                    <option value="100x25_3up">100mm × 25mm (4-Inch Multi-Sticker 3-Up)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Default Label Printer Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Xprinter XP-T451B / Label Printer"
                    value={labelPrinterSettings.printerName}
                    onChange={e => setLabelPrinterSettings({ ...labelPrinterSettings, printerName: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646]"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleUpdateSettings}
              disabled={isSaving}
              className="w-full bg-[#DAA520] hover:bg-[#B8860B] disabled:bg-gray-300 disabled:shadow-none text-white py-4.5 rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all duration-300 shadow-lg shadow-[#DAA520]/20 hover:shadow-xl hover:shadow-[#DAA520]/30 mt-6 flex items-center justify-center gap-2"
            >
              {isSaving ? <Loader2Icon className="w-4.5 h-4.5 animate-spin" /> : null}
              {saved ? 'Settings Synced Successfully!' : 'Save System Settings'}
            </button>

            <div className="border-t border-gray-100 pt-6 mt-6 text-left">
              <h3 className="text-sm font-black text-[#464646] uppercase tracking-wider mb-2">Security</h3>
              <p className="text-xs text-gray-400 font-bold mb-4">Protect your account by regularly updating your system password.</p>
              <button
                type="button"
                onClick={() => setShowChangePasswordModal(true)}
                className="px-6 py-3 bg-[#464646] hover:bg-[#333333] text-white rounded-2xl font-black uppercase tracking-widest text-[10px] transition-all duration-300 shadow-lg flex items-center gap-2"
              >
                <LockIcon className="w-4 h-4" /> Change Profile Password
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BACKUP TAB */}
      {tab === 'backup' && (
        <div className="space-y-8 w-full max-w-[1600px] animate-in slide-in-from-right-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            {/* Instant Backup */}
            <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-100 shadow-md flex flex-col justify-between space-y-6 relative overflow-hidden group hover:shadow-lg transition-all duration-300 h-full">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-[#DAA520]" />
              <div className="space-y-4 text-left">
                <div className="w-14 h-14 bg-[#DAA520]/10 rounded-2xl flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform duration-300">
                  <DatabaseIcon className="w-7 h-7 text-[#DAA520]" />
                </div>
                <div>
                  <h3 className="font-black text-[#464646] text-xl">Instant Backup</h3>
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">Manual Excel Export</p>
                </div>
                <p className="text-xs text-gray-400 font-bold leading-relaxed">
                  Trigger an immediate export of your database. The system will compile all products, transactions, customers, suppliers, and logs into a multi-sheet Excel workbook and email a copy.
                </p>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 border border-slate-100 bg-slate-50/50 p-3.5 rounded-2xl">
                  <div>
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Start Date</label>
                    <input
                      type="date"
                      value={backupFromDate}
                      onChange={e => setBackupFromDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-[#DAA520] font-bold text-xs text-[#464646]"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">End Date</label>
                    <input
                      type="date"
                      value={backupToDate}
                      onChange={e => setBackupToDate(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-1 focus:ring-[#DAA520] font-bold text-xs text-[#464646]"
                    />
                  </div>
                </div>

                <div className="text-[10px] font-black text-slate-500 bg-[#DAA520]/5 border border-[#DAA520]/10 p-3.5 rounded-2xl text-center">
                  Destination Email: <span className="text-[#DAA520] font-black">{backupEmail || shopEmail || 'sanojhardware@gmail.com'}</span>
                </div>

                <button
                  onClick={handleEmailBackup}
                  disabled={isEmailingBackup}
                  className="w-full px-6 py-4 bg-[#DAA520] hover:bg-[#B8860B] disabled:bg-gray-200 disabled:text-gray-300 disabled:shadow-none text-white rounded-2xl font-black flex items-center justify-center gap-3 transition-all shadow-lg shadow-[#DAA520]/20 uppercase tracking-widest text-[10px]"
                >
                  {isEmailingBackup ? <Loader2Icon className="w-4.5 h-4.5 animate-spin" /> : <RefreshCcwIcon className="w-4.5 h-4.5" />}
                  Compile & Email Now
                </button>
              </div>
            </div>

            {/* SMTP Settings */}
            <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-100 shadow-md flex flex-col justify-between space-y-6 relative overflow-hidden group hover:shadow-lg transition-all duration-300 h-full">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-[#DAA520]" />
              <div className="space-y-4 text-left">
                <div className="w-14 h-14 bg-[#DAA520]/10 rounded-2xl flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform duration-300">
                  <MailIcon className="w-7 h-7 text-[#DAA520]" />
                </div>
                <div>
                  <h3 className="font-black text-[#464646] text-xl">SMTP Email Configuration</h3>
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">Gmail Sender Account & Credentials</p>
                </div>
                <p className="text-xs text-gray-400 font-bold leading-relaxed">
                  Configure your Gmail sender account and 16-character App Password to enable automated backup email dispatch.
                </p>

                <div className="space-y-4 pt-2">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">SMTP Sender Email (GMAIL_USER)</label>
                    <input
                      type="email"
                      value={smtpUser}
                      onChange={e => setSmtpUser(e.target.value)}
                      placeholder="e.g. sanojhardware@gmail.com"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646]"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Gmail App Password (GMAIL_PASS)</label>
                      {smtpPassConfigured && (
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700">
                          Configured
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={showSmtpPass ? "text" : "password"}
                        value={smtpPass}
                        onChange={e => setSmtpPass(e.target.value)}
                        placeholder={smtpPassConfigured ? "•••••••• (Configured. Enter new to change)" : "Enter 16-character Gmail App Password"}
                        className="w-full px-4 py-3 pr-12 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSmtpPass(!showSmtpPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                      >
                        {showSmtpPass ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 mt-4">
                <button
                  type="button"
                  onClick={handleSaveSmtp}
                  disabled={isSavingSmtp}
                  className="flex-1 bg-[#464646] hover:bg-[#333333] disabled:bg-gray-300 disabled:shadow-none text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[9px] transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/10"
                >
                  {isSavingSmtp ? <Loader2Icon className="w-4 h-4 animate-spin" /> : null}
                  SAVE SMTP SETTINGS
                </button>
                <button
                  type="button"
                  onClick={handleTestSmtpConnection}
                  disabled={isTestingSmtp}
                  className="flex-1 bg-[#DAA520] hover:bg-[#B8860B] disabled:bg-gray-300 disabled:shadow-none text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[9px] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#DAA520]/15"
                >
                  {isTestingSmtp ? <Loader2Icon className="w-4 h-4 animate-spin" /> : <RefreshCcwIcon className="w-4 h-4" />}
                  TEST SMTP
                </button>
              </div>
            </div>

            {/* Scheduled Auto Backups */}
            <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-100 shadow-md flex flex-col justify-between space-y-6 relative overflow-hidden group hover:shadow-lg transition-all duration-300 h-full">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-[#464646]" />
              <div className="space-y-4 text-left">
                <div className="w-14 h-14 bg-[#464646]/10 rounded-2xl flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform duration-300">
                  <DatabaseIcon className="w-7 h-7 text-[#464646]" />
                </div>
                <div>
                  <h3 className="font-black text-[#464646] text-xl">Automated Backups</h3>
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">Scheduled Server Backups</p>
                </div>
                <p className="text-xs text-gray-400 font-bold leading-relaxed">
                  Automatically export and email structured database workbooks at your chosen hourly interval.
                </p>

                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-3 bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                    <input
                      type="checkbox"
                      id="backupEnabled"
                      checked={backupEnabled}
                      onChange={e => setBackupEnabled(e.target.checked)}
                      className="w-5 h-5 accent-[#DAA520] cursor-pointer rounded-lg border-gray-300"
                    />
                    <label htmlFor="backupEnabled" className="text-xs font-black text-[#464646] cursor-pointer select-none">
                      Enable Automated Backup
                    </label>
                  </div>

                  <div className="bg-slate-50/50 p-4 rounded-2xl border border-slate-100 space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Backup Schedule Interval</label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[#464646]">Backup every</span>
                      <input
                        type="number"
                        min={1}
                        max={168}
                        step={1}
                        value={backupIntervalHours}
                        onChange={e => {
                          const val = e.target.value;
                          setBackupIntervalHours(val);
                          const num = Number(val);
                          if (!val || isNaN(num) || !Number.isInteger(num) || num < 1 || num > 168) {
                            setBackupIntervalError("Interval must be a whole number between 1 and 168 hours.");
                          } else {
                            setBackupIntervalError(null);
                          }
                        }}
                        placeholder="12"
                        className={`w-24 px-3 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646] text-center ${backupIntervalError ? 'border-red-500 bg-red-50/30' : 'border-gray-200'
                          }`}
                      />
                      <span className="text-xs font-bold text-[#464646]">hours</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Backup Destination Email</label>
                    <input
                      type="email"
                      value={backupEmail}
                      onChange={e => setBackupEmail(e.target.value)}
                      placeholder="e.g. sanojhardware@gmail.com"
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-xs text-[#464646]"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 mt-4">
                <button
                  onClick={handleUpdateSettings}
                  disabled={isSaving}
                  className="flex-1 bg-[#464646] hover:bg-[#333333] disabled:bg-gray-300 disabled:shadow-none text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[9px] transition-all flex items-center justify-center gap-2 shadow-lg shadow-black/10"
                >
                  {isSaving ? <Loader2Icon className="w-4 h-4 animate-spin" /> : null}
                  {saved ? 'Configs Synced!' : 'Save Settings'}
                </button>
                <button
                  type="button"
                  onClick={handleTestEmail}
                  disabled={isSendingTest}
                  className="flex-1 bg-[#DAA520] hover:bg-[#B8860B] disabled:bg-gray-300 disabled:shadow-none text-white py-4 rounded-2xl font-black uppercase tracking-widest text-[9px] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#DAA520]/15"
                >
                  {isSendingTest ? <Loader2Icon className="w-4 h-4 animate-spin" /> : <RefreshCcwIcon className="w-4 h-4" />}
                  Test SMTP Connection
                </button>
              </div>
            </div>

            {/* Restore Database */}
            <div className="bg-white p-5 sm:p-6 rounded-3xl border border-gray-100 shadow-md flex flex-col justify-between space-y-6 relative overflow-hidden group hover:shadow-lg transition-all duration-300 h-full">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-[#DAA520]" />
              <div className="space-y-4 text-left">
                <div className="w-14 h-14 bg-[#DAA520]/10 rounded-2xl flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform duration-300">
                  <RefreshCcwIcon className="w-7 h-7 text-[#DAA520]" />
                </div>
                <div>
                  <h3 className="font-black text-[#464646] text-xl">Restore Database</h3>
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">Excel Spreadsheet Import</p>
                </div>
                <p className="text-xs text-gray-400 font-bold leading-relaxed">
                  Upload an exported backup Excel spreadsheet (.xlsx) to restore all database records transactionally.
                </p>

                <div className="rounded-2xl border-2 border-dashed border-gray-200 hover:border-[#DAA520] p-6 text-center transition-all bg-slate-50/50 hover:bg-white cursor-pointer relative group/dropzone">
                  <input
                    type="file"
                    accept=".xlsx"
                    onChange={handleRestoreExcel}
                    disabled={isRestoring}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                  <div className="space-y-2">
                    <DatabaseIcon className="w-8 h-8 text-gray-400 group-hover/dropzone:text-[#DAA520] mx-auto transition-colors" />
                    <p className="text-xs font-bold text-gray-500">
                      {isRestoring ? 'Processing Restore...' : 'Drag & drop Excel or click to browse'}
                    </p>
                    <p className="text-[9px] text-gray-400">Supported: Muthuwadige Excel Backups (.xlsx)</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Backup History */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-md overflow-hidden text-left">
            <div className="px-6 py-5 bg-gray-50/50 border-b border-gray-100/80 font-black text-[#464646] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCcwIcon className="w-4 h-4 text-[#DAA520]" />
                <span className="uppercase tracking-wider text-xs">Recent Database Backups</span>
              </div>
              {selectedBackups.length > 0 && (
                <button
                  onClick={handleDeleteSelectedBackups}
                  className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm hover:shadow"
                >
                  Delete Selected ({selectedBackups.length})
                </button>
              )}
            </div>
            <div className="divide-y divide-gray-50">
              {recentBackups.length > 0 && (
                <div className="flex items-center px-6 py-3 bg-gray-50/20 border-b border-gray-100">
                  <input
                    type="checkbox"
                    checked={recentBackups.length > 0 && selectedBackups.length === recentBackups.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedBackups(recentBackups.map(b => b.id).filter(Boolean));
                      } else {
                        setSelectedBackups([]);
                      }
                    }}
                    className="w-4 h-4 text-[#DAA520] border-gray-300 rounded focus:ring-[#DAA520] cursor-pointer"
                  />
                  <span className="ml-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Select All</span>
                </div>
              )}
              {recentBackups.map((file, i) => {
                const isSelected = selectedBackups.includes(file.id);
                return (
                  <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 sm:px-6 py-5 hover:bg-gray-50/30 transition-colors">
                    <div className="flex items-center gap-4">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          if (isSelected) {
                            setSelectedBackups(prev => prev.filter(id => id !== file.id));
                          } else {
                            setSelectedBackups(prev => [...prev, file.id]);
                          }
                        }}
                        className="w-4 h-4 text-[#DAA520] border-gray-300 rounded focus:ring-[#DAA520] cursor-pointer"
                      />
                      <div className="p-3 bg-gray-100/85 text-gray-500 rounded-2xl shadow-inner">
                        <FileTextIcon className="w-5 h-5 text-gray-500" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-black text-[#464646] font-mono text-xs">{file.name}</p>
                        <p className="text-[9px] text-gray-400 uppercase font-black tracking-widest mt-1">{file.date} • {file.size}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-7 sm:ml-0">
                      <a
                        href={file.url}
                        download={file.name}
                        className="px-5 py-2.5 bg-[#DAA520]/10 text-[#DAA520] rounded-xl text-[10px] font-black hover:bg-[#DAA520] hover:text-white transition-all uppercase tracking-widest shadow-sm hover:shadow"
                      >
                        Download
                      </a>
                      <button
                        onClick={() => handleDeleteBackup(file.id, file.name)}
                        className="px-5 py-2.5 bg-red-50 text-red-600 border border-red-100 rounded-xl text-[10px] font-black hover:bg-red-600 hover:text-white hover:border-red-600 transition-all uppercase tracking-widest shadow-sm hover:shadow"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
              {recentBackups.length === 0 && (
                <div className="p-16 text-center text-gray-400 font-bold">
                  <FileTextIcon className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                  No backups generated during this session.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CONNECTION & NETWORK TAB */}
      {tab === 'network' && (
        <div className="space-y-8 max-w-5xl animate-in slide-in-from-right-4 text-left">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Status */}
            <div className="bg-white p-4 sm:p-6 md:p-8 rounded-3xl border border-gray-100 shadow-md flex flex-col justify-between space-y-6 relative overflow-hidden group hover:shadow-lg transition-all duration-300 lg:col-span-1">
              <div className={`absolute top-0 left-0 h-1.5 w-full ${appRole === 'host' ? 'bg-[#DAA520]' : 'bg-blue-500'}`} />

              <div className="space-y-4">
                <div className={`w-14 h-14 ${appRole === 'host' ? 'bg-[#DAA520]/10 text-[#DAA520]' : 'bg-blue-500/10 text-blue-500'} rounded-2xl flex items-center justify-center shadow-inner`}>
                  <DatabaseIcon className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="font-black text-[#464646] text-xl">System Status</h3>
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">Role in Local Network</p>
                </div>

                <div className="pt-2 space-y-3">
                  <div>
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Active Role</span>
                    <span className={`inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider ${appRole === 'host' ? 'bg-[#DAA520]/10 text-[#DAA520] border border-[#DAA520]/20' : 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
                      }`}>
                      {appRole === 'host' ? 'Standalone Host (Server)' : 'Network Client'}
                    </span>
                  </div>

                  <div>
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Database Location</span>
                    <span className="text-xs font-mono font-bold text-gray-600 break-all bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 block">
                      {appRole === 'host' ? 'Local hardware.db (Writable)' : hostAddress}
                    </span>
                  </div>

                  <div>
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">API Connection Endpoint</span>
                    <span className="text-xs font-mono font-bold text-gray-500 block break-all">
                      {API_URL}
                    </span>
                  </div>
                </div>
              </div>

              {appRole === 'host' && (
                <div className="bg-emerald-50/50 border border-emerald-100 p-4 rounded-2xl space-y-2">
                  <div className="flex items-center gap-2 text-emerald-800 text-xs font-black uppercase tracking-wide">
                    <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping" />
                    Local Server is Running
                  </div>
                  <p className="text-[10px] text-emerald-700 font-bold leading-normal">
                    This computer hosts the primary database. Other laptops and mobile devices will sync files and records with this machine.
                  </p>
                </div>
              )}
            </div>

            {/* Manager */}
            <div className="bg-white p-4 sm:p-6 md:p-8 rounded-3xl border border-gray-100 shadow-md flex flex-col justify-between space-y-6 relative overflow-hidden group hover:shadow-lg transition-all duration-300 lg:col-span-2">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-[#464646]" />

              <div className="space-y-4">
                <div className="w-14 h-14 bg-[#464646]/10 text-[#464646] rounded-2xl flex items-center justify-center shadow-inner">
                  <RefreshCcwIcon className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="font-black text-[#464646] text-xl">Connection Settings</h3>
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">Configure Network Role</p>
                </div>

                <div className="pt-2 space-y-5">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Choose Network Mode</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <button
                        type="button"
                        onClick={() => setAppRole('host')}
                        className={`p-4 rounded-2xl border text-left transition-all ${appRole === 'host'
                          ? 'border-[#DAA520] bg-[#DAA520]/5 shadow-sm'
                          : 'border-gray-200 hover:bg-gray-50'
                          }`}
                      >
                        <p className="text-xs font-black text-slate-800 uppercase tracking-wider">Standalone Host</p>
                        <p className="text-[9px] font-bold text-gray-400 mt-1 leading-normal">Runs local database. Choose for primary shop laptop.</p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAppRole('client')}
                        className={`p-4 rounded-2xl border text-left transition-all ${appRole === 'client'
                          ? 'border-blue-500 bg-blue-50/50 shadow-sm'
                          : 'border-gray-200 hover:bg-gray-50'
                          }`}
                      >
                        <p className="text-xs font-black text-slate-800 uppercase tracking-wider">Network Client</p>
                        <p className="text-[9px] font-bold text-gray-400 mt-1 leading-normal">Connects to a Host. Choose for cashier laptops.</p>
                      </button>
                    </div>
                  </div>

                  {appRole === 'client' && (
                    <div className="space-y-3 p-5 bg-blue-50/30 border border-blue-100 rounded-2xl animate-in slide-in-from-top-3">
                      <div>
                        <label className="text-[10px] font-black text-[#464646] uppercase tracking-widest mb-1.5 block">Host Server Address / URL</label>
                        <input
                          type="text"
                          value={hostAddress}
                          onChange={e => setHostAddress(e.target.value)}
                          placeholder="e.g. http://192.168.1.50:5001"
                          className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold text-xs text-slate-700 bg-white"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleTestHostConnection}
                          disabled={isTestingConnection || !hostAddress}
                          className="px-5 py-3 bg-[#464646] hover:bg-[#333333] disabled:bg-gray-200 disabled:text-gray-400 text-white text-[10px] font-black rounded-xl uppercase tracking-widest transition-all shadow-md flex items-center gap-1.5"
                        >
                          {isTestingConnection && <Loader2Icon className="w-3 h-3 animate-spin" />}
                          Test Connection
                        </button>
                      </div>

                      {connectionTestResult && (
                        <div className={`p-3.5 rounded-xl border text-xs font-bold ${connectionTestResult.success
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : 'bg-red-50 border-red-200 text-red-800'
                          }`}>
                          {connectionTestResult.message}
                        </div>
                      )}
                    </div>
                  )}

                  {appRole === 'host' && (
                    <div className="space-y-3 p-5 bg-amber-50/20 border border-amber-100 rounded-2xl animate-in slide-in-from-top-3">
                      <label className="text-[10px] font-black text-[#464646] uppercase tracking-widest block">Access Links for other Devices</label>
                      <p className="text-[10px] text-gray-400 font-bold leading-normal">
                        Use the following addresses to connect client laptops and mobile phones on the shop network:
                      </p>

                      <div className="space-y-2 mt-2">
                        {networkAddresses.length > 0 ? (
                          networkAddresses.map((net, i) => (
                            <div key={i} className="flex items-center justify-between gap-3 p-3 bg-white border border-slate-100 rounded-xl shadow-sm">
                              <div>
                                <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider block">{net.interface}</span>
                                <span className="text-xs font-mono font-bold text-[#DAA520]">http://{net.address}:5001</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(`http://${net.address}:5001`);
                                  alert(`Copied URL: http://${net.address}:5001`);
                                }}
                                className="px-3 py-1.5 bg-gray-100 hover:bg-[#DAA520] hover:text-white rounded-lg text-[9px] font-black uppercase tracking-wider text-gray-500 transition-all"
                              >
                                Copy Link
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="text-xs text-gray-500 font-bold py-2">
                            Searching local network interfaces... (Ensure server is listening)
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100 mt-6">
                <button
                  type="button"
                  onClick={handleSaveConnectionSettings}
                  disabled={isConnecting}
                  className="w-full bg-[#DAA520] hover:bg-[#B8860B] disabled:bg-gray-300 text-white py-4.5 rounded-2xl font-black uppercase tracking-widest text-[11px] transition-all duration-300 shadow-lg shadow-[#DAA520]/20 flex items-center justify-center gap-2"
                >
                  {isConnecting && <Loader2Icon className="w-4.5 h-4.5 animate-spin" />}
                  Save and Sync Role Configurations
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 📱 MOBILE CAMERA BARCODE SCANNER TAB */}
      {tab === 'scanner' && (
        <div className="space-y-6 animate-in slide-in-from-left-4 duration-500">
          {/* Header Banner */}
          <div className="bg-white rounded-3xl border border-gray-100 p-6 sm:p-8 shadow-md relative overflow-hidden">
            <div className="absolute top-0 left-0 h-1.5 w-full bg-[#DAA520]" />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100/80 pb-6 text-left">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-gradient-to-br from-amber-500 to-amber-600 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/20 text-slate-950 shrink-0">
                  <SmartphoneIcon className="w-7 h-7" />
                </div>
                <div>
                  <h2 className="font-black text-xl text-[#464646] uppercase tracking-wider flex items-center gap-2 flex-wrap">
                    Mobile Camera Barcode Scanner
                    <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 font-bold uppercase tracking-widest">
                      Wi-Fi Virtual Input
                    </span>
                  </h2>
                  <p className="text-xs font-bold text-gray-400 mt-1">
                    Turn any iPhone or Android camera into an instant wireless barcode scanner streaming directly into active input fields & POS.
                  </p>
                </div>
              </div>

              {/* Dynamic Connection Status Badge */}
              <div className="flex items-center gap-3">
                <div className={`px-4 py-2 rounded-2xl border text-xs font-black uppercase tracking-wider flex items-center gap-2.5 shadow-sm transition-all duration-300 ${
                  connectedDevicesCount > 0
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 shadow-emerald-500/10'
                    : 'bg-amber-50/90 text-amber-800 border-amber-200'
                }`}>
                  <span className="relative flex h-3 w-3">
                    {connectedDevicesCount > 0 && (
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    )}
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${
                      connectedDevicesCount > 0 ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}></span>
                  </span>
                  <span>
                    {connectedDevicesCount > 0
                      ? `● ${connectedDevicesCount} DEVICE${connectedDevicesCount > 1 ? 'S' : ''} CONNECTED`
                      : '○ WAITING FOR CONNECTION'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await Promise.all([fetchConnectedClients(), fetchScannerInfo()]);
                  }}
                  disabled={isRefreshingClients}
                  className="p-2.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-600 rounded-xl transition-all shadow-sm flex items-center justify-center cursor-pointer disabled:opacity-70"
                  title="Refresh Connected Devices & Signaling"
                >
                  <RefreshCcwIcon className={`w-4 h-4 transition-transform ${isRefreshingClients ? 'animate-spin text-amber-600' : ''}`} />
                </button>
              </div>
            </div>

            {/* Main Two-Column Pairing Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 pt-6">
              {/* Left Column: High-Contrast QR Code Card & Connected Devices List */}
              <div className="lg:col-span-5 flex flex-col items-center justify-center p-6 bg-slate-900 text-white rounded-3xl border border-slate-800 shadow-xl text-center space-y-4">
                <div className="bg-white p-4 rounded-2xl shadow-2xl border-4 border-amber-500">
                  <QRCodeSVG
                    value={activeScannerUrl}
                    size={210}
                    level="H"
                    includeMargin={false}
                  />
                </div>

                <div className="space-y-1.5 w-full">
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pairing Session:</span>
                    <span className="font-mono font-black text-amber-400 bg-slate-800/80 px-2.5 py-0.5 rounded-lg border border-slate-700 text-xs">
                      {scannerSessionId}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextId = prompt('Enter POS Session ID to pair with:', scannerSessionId);
                        if (nextId && nextId.trim()) setScannerSessionId(nextId.trim());
                      }}
                      className="text-[10px] text-slate-400 hover:text-amber-400 underline font-bold cursor-pointer"
                    >
                      Change
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium">
                    Point phone camera at this QR code to launch mobile scanner app
                  </p>
                </div>

                {/* Connected Devices Card */}
                <div className="w-full pt-4 border-t border-slate-800 text-left space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                      <SmartphoneIcon className="w-3.5 h-3.5 text-amber-400" />
                      Connected Devices ({connectedDevicesCount})
                    </span>
                    {connectedDevicesCount > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        Live
                      </span>
                    )}
                  </div>

                  {connectedClients.length === 0 ? (
                    <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-3.5 text-center">
                      <p className="text-xs text-slate-400 font-medium italic">
                        No mobile devices paired yet.
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Scan QR code above with your phone camera to pair.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {connectedClients.map((client) => (
                        <div
                          key={client.id}
                          className="flex items-center justify-between bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 p-3 rounded-2xl text-xs transition-colors shadow-sm"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-base shrink-0">📱</span>
                            <div className="truncate">
                              <p className="font-bold text-slate-200 text-xs truncate">
                                {client.deviceName}
                              </p>
                              <p className="text-[10px] font-mono text-slate-400">
                                {client.ip}
                              </p>
                            </div>
                          </div>
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-black uppercase tracking-wider shrink-0 ml-2">
                            Active
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Connection Settings & Step-by-Step Guidance */}
              <div className="lg:col-span-7 space-y-5 text-left">
                {/* Wi-Fi Adapter Selector */}
                <div className="bg-slate-50 border border-slate-200/80 p-5 rounded-2xl space-y-3">
                  <label className="text-[10px] font-black text-[#464646] uppercase tracking-widest block">
                    1. Select Host Wi-Fi Network Interface
                  </label>
                  {localScannerInfo?.ips && localScannerInfo.ips.length > 0 ? (
                    <select
                      value={selectedScannerIp}
                      onChange={(e) => setSelectedScannerIp(e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 shadow-sm cursor-pointer"
                    >
                      {localScannerInfo.ips.map((net, i) => (
                        <option key={i} value={net.address}>
                          {net.isWifi ? '📶 Wi-Fi' : '🌐 LAN'}: {net.address} ({net.name})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-xs text-gray-500 font-bold bg-white p-3 rounded-xl border border-slate-200">
                      Primary IP: {localScannerInfo?.ip || '127.0.0.1'}
                    </div>
                  )}

                  {/* Direct HTTPS Link with One-Click Copy */}
                  <div className="space-y-1.5 pt-1">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest block">
                      Direct Mobile Scanner Link (Secure HTTPS)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={activeScannerUrl}
                        className="flex-1 px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-700 select-all outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(activeScannerUrl);
                          setCopiedScannerUrl(true);
                          setTimeout(() => setCopiedScannerUrl(false), 2000);
                        }}
                        className="px-4 py-2.5 bg-[#464646] hover:bg-[#333333] active:scale-95 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm shrink-0"
                      >
                        {copiedScannerUrl ? <CheckIcon className="w-3.5 h-3.5 text-emerald-400" /> : <CopyIcon className="w-3.5 h-3.5" />}
                        {copiedScannerUrl ? 'Copied!' : 'Copy'}
                      </button>
                      <a
                        href={activeScannerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl shrink-0 transition-colors flex items-center justify-center shadow-sm"
                        title="Open in new browser tab"
                      >
                        <ExternalLinkIcon className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                </div>

                {/* 3-Step Setup Card */}
                <div className="bg-amber-50/40 border border-amber-200/60 p-5 rounded-2xl space-y-3">
                  <h4 className="text-xs font-black text-amber-900 uppercase tracking-wider">
                    Quick 3-Step Phone Setup
                  </h4>
                  <div className="space-y-2.5 text-xs text-slate-700 font-medium">
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500 text-slate-950 font-black text-[10px] flex items-center justify-center shrink-0">1</span>
                      <p className="leading-tight">
                        <b>Connect to Same Wi-Fi:</b> Ensure your smartphone is connected to the same Wi-Fi router as this computer.
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500 text-slate-950 font-black text-[10px] flex items-center justify-center shrink-0">2</span>
                      <p className="leading-tight">
                        <b>Scan the QR Code:</b> Open the built-in Camera on your iPhone or Android and tap the scanned link.
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-amber-500 text-slate-950 font-black text-[10px] flex items-center justify-center shrink-0">3</span>
                      <p className="leading-tight">
                        <b>Accept Local SSL Certificate:</b> If Safari or Chrome warns about the self-signed HTTPS certificate, tap <b>Advanced</b> &rarr; <b>Proceed to site</b> to allow camera access.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Scans Activity Feed */}
          <div className="bg-white rounded-3xl border border-gray-100 p-6 sm:p-8 shadow-md text-left space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-4">
              <div>
                <h3 className="font-black text-base text-[#464646] uppercase tracking-wider flex items-center gap-2">
                  <span>⚡ Recent Scans Activity Feed</span>
                  <span className="text-xs font-mono font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-lg">
                    {recentScans.length}
                  </span>
                </h3>
                <p className="text-xs font-bold text-gray-400 mt-0.5">
                  Live log of all barcodes received from connected wireless camera scanners
                </p>
              </div>

              {recentScans.length > 0 && (
                <button
                  type="button"
                  onClick={clearRecentScans}
                  className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center gap-1"
                >
                  <Trash2Icon className="w-3.5 h-3.5" />
                  Clear History
                </button>
              )}
            </div>

            {recentScans.length === 0 ? (
              <div className="py-12 text-center text-gray-400 font-bold space-y-2">
                <div className="w-12 h-12 bg-gray-100 rounded-2xl mx-auto flex items-center justify-center text-gray-400">
                  <SmartphoneIcon className="w-6 h-6" />
                </div>
                <p className="text-sm text-gray-500 font-bold">No scans received yet</p>
                <p className="text-xs text-gray-400">Scan any barcode with your paired mobile camera to see it appear here in real time.</p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto divide-y divide-gray-100 rounded-2xl border border-gray-100">
                {recentScans.map((scan) => (
                  <div key={scan.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-[10px] font-mono font-bold">
                        {scan.format || 'BARCODE'}
                      </span>
                      <div>
                        <span className="font-mono font-black text-slate-800 text-sm">{scan.barcode}</span>
                        <div className="text-[10px] text-gray-400 font-semibold">{scan.scannerName}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-mono font-bold text-gray-500">
                        {new Date(scan.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Collapsible Accordion: Advanced / Manual Test Simulator */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-md overflow-hidden text-left">
            <button
              type="button"
              onClick={() => setShowSimulatorAccordion(!showSimulatorAccordion)}
              className="w-full p-6 flex justify-between items-center hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center">
                  <ZapIcon className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-black text-sm text-[#464646] uppercase tracking-wider">
                    ▶ Advanced / Manual Test Simulator
                  </h4>
                  <p className="text-[10px] font-bold text-gray-400">
                    Test the global virtual keyboard bridge from this desktop without needing a physical phone
                  </p>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-slate-100 text-slate-500">
                {showSimulatorAccordion ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
              </div>
            </button>

            {showSimulatorAccordion && (
              <div className="p-6 pt-0 border-t border-gray-100 space-y-4 animate-in slide-in-from-top-2">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 space-y-3 mt-4">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">
                    Simulate Inbound Scanned String
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={testBarcodeInput}
                      onChange={(e) => setTestBarcodeInput(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter' && testBarcodeInput.trim()) {
                          await sendTestBarcode(testBarcodeInput.trim());
                          setTestBarcodeInput('');
                        }
                      }}
                      placeholder="e.g. 8901234567890 or SKU-PAINT-001"
                      className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (testBarcodeInput.trim()) {
                          await sendTestBarcode(testBarcodeInput.trim());
                          setTestBarcodeInput('');
                        }
                      }}
                      className="px-6 py-3 bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md shrink-0"
                    >
                      Simulate Scan 🚀
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 font-bold">
                    Tip: If an input field or text box on screen is focused, the barcode will inject directly into that field. Otherwise, it will route to POS / active screen handler.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODALS */}
      {showAddUser && (
        <div className="fixed inset-0 bg-[#464646]/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <form onSubmit={handleAddUser} className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-5 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-black text-xl text-[#464646]">Add New Staff Account</h3>
              <button type="button" onClick={() => setShowAddUser(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><XIcon className="w-5 h-5" /></button>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Staff Full Name</label>
              <input required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646]" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Nalaka Bandara" />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Email Address</label>
              <input type="email" required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646]" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="e.g. nalaka@hardware.com" />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Temporary Password</label>
              <input type="password" required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646]" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} placeholder="••••••••" />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">System Role</label>
              <select className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646] bg-white cursor-pointer" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value as any })}>
                <option value="cashier">Retail User (Cashier)</option>
                <option value="manager">Admin (Manager)</option>
                <option value="super_admin">Super Admin (Owner)</option>
              </select>
            </div>
            <div className="flex gap-3 pt-4 border-t border-gray-100">
              <button type="button" onClick={() => setShowAddUser(false)} className="flex-1 py-3.5 font-black text-gray-500 hover:bg-gray-100 rounded-xl uppercase tracking-widest text-xs transition-colors">Cancel</button>
              <button type="submit" disabled={isSaving} className="flex-1 py-3.5 font-black bg-[#DAA520] hover:bg-[#B8860B] text-white rounded-xl shadow-lg shadow-[#DAA520]/20 uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-2">
                {isSaving ? <Loader2Icon className="w-4 h-4 animate-spin" /> : null}
                Create Account
              </button>
            </div>
          </form>
        </div>
      )}

      {showChangePasswordModal && (
        <div className="fixed inset-0 bg-[#464646]/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <form onSubmit={handleChangePassword} className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-5 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-black text-xl text-[#464646]">Change Profile Password</h3>
              <button type="button" onClick={() => setShowChangePasswordModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><XIcon className="w-5 h-5" /></button>
            </div>
            <div className="text-left">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">New Password</label>
              <input type="password" required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646]" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Minimum 6 characters" />
            </div>
            <div className="text-left">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Confirm New Password</label>
              <input type="password" required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646]" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Retype password" />
            </div>
            <div className="flex gap-3 pt-4 border-t border-gray-100">
              <button type="button" onClick={() => setShowChangePasswordModal(false)} className="flex-1 py-3.5 font-black text-gray-500 hover:bg-gray-100 rounded-xl uppercase tracking-widest text-xs transition-colors">Cancel</button>
              <button type="submit" disabled={isUpdatingPassword} className="flex-1 py-3.5 font-black bg-[#DAA520] hover:bg-[#B8860B] text-white rounded-xl shadow-lg shadow-[#DAA520]/20 uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-2">
                {isUpdatingPassword ? <Loader2Icon className="w-4 h-4 animate-spin" /> : null}
                Update Password
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}