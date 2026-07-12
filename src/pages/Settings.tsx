import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabaseClient';
import { useCurrency } from '../context/CurrencyContext';
import { API_URL, BASE_URL, setApiUrl } from '../lib/api';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  PlusIcon, ShieldIcon, CheckIcon, DownloadIcon,
  DatabaseIcon, RefreshCcwIcon, XIcon, LockIcon,
  Trash2Icon, Edit2Icon, Loader2Icon, FileTextIcon,
  PackageIcon, ShoppingCartIcon, DollarSignIcon, TruckIcon, UsersIcon,
  PrinterIcon, MapPinIcon, SearchIcon
} from 'lucide-react';

type Tab = 'system' | 'backup' | 'network' | 'database';

export function Settings() {
  const { currency, setCurrency } = useCurrency();
  const [tab, setTab] = useState<Tab>('system');
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
  const [taxRate, setTaxRate] = useState(0);
  const [threshold, setThreshold] = useState(10);
  const [settingsId, setSettingsId] = useState<string>('global');
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState('INV001');
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
  const [printerSettings, setPrinterSettings] = useState({ ip: '', port: '9100', type: 'Network', paperSize: 'A4' });
  const [branchSettings, setBranchSettings] = useState({ name: '', code: '', address: '' });
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

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
      if (response.ok) {
        alert(result.message || "Full backup generated and emailed successfully!");
        fetchInitialData(); // Reload backup logs from SQLite
      } else {
        alert("Backup status: " + result.message);
      }
    } catch (e) {
      alert("Failed to connect to local SQLite backup service. Please verify that the Express SQLite server is running.");
    } finally {
      setIsEmailingBackup(false);
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
      } catch(e: any) {
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
      } catch(e: any) {
        alert("Error connecting to server: " + e.message);
      }
    }
  };

  // Permissions Matrix State
  const [matrix, setMatrix] = useState([
    { feature: 'Dashboard', admin: true, manager: true, cashier: true },
    { feature: 'Inventory (Edit)', admin: true, manager: true, cashier: false },
    { feature: 'Accounting', admin: true, manager: true, cashier: false },
    { feature: 'Settings', admin: true, manager: false, cashier: false },
  ]);

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

  useEffect(() => { fetchInitialData(); }, []);

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
      setLogoPath(settingData.logo_path || '');
      
      if (settingData.printer_settings) {
        try {
          const parsed = typeof settingData.printer_settings === 'object' ? settingData.printer_settings : JSON.parse(settingData.printer_settings);
          setPrinterSettings({
            ip: parsed.ip || '',
            port: parsed.port || '9100',
            type: parsed.type || 'Network',
            paperSize: parsed.paperSize || 'A4'
          });
        } catch(e) {}
      }
      if (settingData.branch_settings) {
        try {
          setBranchSettings(typeof settingData.branch_settings === 'object' ? settingData.branch_settings : JSON.parse(settingData.branch_settings));
        } catch(e) {}
      }
      
      if (settingData.tax_rate !== undefined) setTaxRate(settingData.tax_rate);
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
    } catch(err) {
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
    } catch(err) {
      console.warn("Failed to load network interfaces", err);
    }

    setLoading(false);
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

  // --- PDF BACKUP ACTION ---
  const handleFullPDFBackup = async () => {
    const doc = new jsPDF();
    const date = new Date().toLocaleDateString();
    const timestamp = new Date().getTime();

    const addTableSection = (title: string, rows: any[]) => {
      if (!rows || rows.length === 0) return;
      const columns = Object.keys(rows[0]);
      let startY = 40;
      if ((doc as any).lastAutoTable) {
        doc.addPage();
        startY = 20;
      }

      doc.setFontSize(14);
      doc.setTextColor(70, 70, 70);
      doc.text(title, 14, startY);

      autoTable(doc, {
        startY: startY + 8,
        head: [columns.map(col => col.replace(/_/g, ' ').toUpperCase())],
        body: rows.map(row => columns.map(col => {
          const value = row[col];
          if (value === null || value === undefined) return '';
          if (typeof value === 'object') return JSON.stringify(value);
          return String(value);
        })),
        theme: 'striped',
        headStyles: { fillColor: [218, 165, 32], textColor: [255, 255, 255] },
        styles: { fontSize: 7, cellPadding: 2, overflow: 'linebreak' },
        margin: { left: 14, right: 14 }
      });
    };

    doc.setFontSize(20);
    doc.setTextColor(218, 165, 32);
    doc.text(`${shopName} - Full System Backup`, 14, 22);

    const queries = await Promise.all([
      supabase.from('system_settings').select('*').single(),
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('*'),
      supabase.from('products').select('*'),
      supabase.from('sales').select('*'),
      supabase.from('purchase_orders').select('*'),
      supabase.from('transactions').select('*'),
      supabase.from('employees').select('*')
    ]);

    const [settingsResult, profilesResult, customersResult, productsResult, salesResult, purchaseOrdersResult, transactionsResult, employeesResult] = queries;
    const settings = settingsResult.data ? [settingsResult.data] : [];
    const profiles = profilesResult.data || [];
    const customers = customersResult.data || [];
    const products = productsResult.data || [];
    const sales = salesResult.data || [];
    const purchaseOrders = purchaseOrdersResult.data || [];
    const transactions = transactionsResult.data || [];
    const employees = employeesResult.data || [];

    addTableSection('System Settings', settings);
    addTableSection('Staff Profiles', profiles);
    addTableSection('Employees', employees);
    addTableSection('Customers', customers);
    addTableSection('Inventory Products', products);
    addTableSection('Sales Orders', sales);
    addTableSection('Purchase Orders', purchaseOrders);
    addTableSection('Accounting Transactions', transactions);

    const pdfBlob = doc.output('blob');
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const fileName = `Full_Backup_${date.replace(/\//g, '-')}_${timestamp}.pdf`;

    doc.save(fileName);
    setRecentBackups([{
      name: fileName,
      date,
      size: `${Math.max(1, Math.round(pdfBlob.size / 1024))} KB`,
      url: pdfUrl
    }, ...recentBackups]);
  };

  // --- USER ACTIONS ---

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validations
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
    const { data, error } = await supabase.auth.signUp({
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

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validations
    if (!editingUser.name || editingUser.name.trim().length < 2) {
      alert("Name must be at least 2 characters.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(editingUser.email.trim())) {
      alert("Please enter a valid email address.");
      return;
    }

    const { error } = await supabase.from('profiles').update({
      name: editingUser.name.trim(), email: editingUser.email.trim(), role: editingUser.role
    }).eq('id', editingUser.id);

    if (!error) {
      setUsers(users.map(u => u.id === editingUser.id ? editingUser : u));
      setShowEditUser(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    const user = users.find(u => u.id === id);
    if (user && user.role === 'super_admin') {
      alert("Super Admin user cannot be deleted.");
      return;
    }
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (!error) {
      setUsers(users.filter(u => u.id !== id));
      setDeleteTargetUser(null);
    } else {
      alert("Failed to delete user: " + (error.message || error));
    }
  };

  const handleUpdateSettings = async () => {
    // Validations
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

    if (taxRate < 0 || taxRate > 100) {
      alert("Tax rate must be between 0% and 100%.");
      return;
    }

    if (backupEnabled) {
      if (!backupEmail || !emailRegex.test(backupEmail.trim())) {
        alert("Please enter a valid backup destination email address.");
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
      tax_rate: taxRate,
      backup_email: backupEmail.trim(),
      backup_enabled: backupEnabled ? 1 : 0,
      logo_path: logoPath,
      printer_settings: printerSettings,
      branch_settings: branchSettings,
      next_invoice_number: nextInvoiceNumber.trim()
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
    } catch(err) {
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

    setIsRestoring(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        
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
    reader.readAsBinaryString(file);
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
        {(['system', 'backup', 'network'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap ${tab === t ? 'bg-[#464646] text-white shadow-md' : 'text-gray-500 hover:text-[#464646] hover:bg-gray-50'}`}>
            {t === 'system' ? 'System Settings' : t === 'backup' ? 'Backup & Restore' : 'Connection & Network'}
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
              <p className="text-xs font-bold text-gray-400 mt-1">Manage shop branding, location, phone records, and tax settings.</p>
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
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
              <div className="text-left">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2.5 block">Tax Rate (%)</label>
                <input 
                  type="number" 
                  value={taxRate} 
                  onChange={e => setTaxRate(Number(e.target.value))} 
                  className="w-full px-5 py-3.5 border border-gray-200 rounded-2xl outline-none focus:ring-4 focus:ring-[#DAA520]/15 focus:border-[#DAA520] font-bold text-[#464646] transition-all duration-300 shadow-sm" 
                />
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
                    value={printerSettings.paperSize || 'A4'} 
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

      {/* DATABASE TAB */}
      {tab === 'database' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-in slide-in-from-bottom-4">
          {/* Sub Navigation Sidebar */}
          <div className="lg:col-span-1 space-y-2">
            <h3 className="text-[10px] text-gray-400 font-black uppercase tracking-widest px-3 mb-3">System Tables</h3>
            {[
              { id: 'products', label: 'products', icon: <PackageIcon className="w-4 h-4" /> },
              { id: 'customers', label: 'customers', icon: <UsersIcon className="w-4 h-4" /> },
              { id: 'employees', label: 'employees', icon: <UsersIcon className="w-4 h-4" /> },
              { id: 'profiles', label: 'profiles', icon: <ShieldIcon className="w-4 h-4" /> },
              { id: 'purchase_orders', label: 'purchase_orders', icon: <TruckIcon className="w-4 h-4" /> },
              { id: 'sales', label: 'sales', icon: <ShoppingCartIcon className="w-4 h-4" /> },
              { id: 'system_settings', label: 'system_settings', icon: <DatabaseIcon className="w-4 h-4" /> },
              { id: 'transactions', label: 'transactions', icon: <DollarSignIcon className="w-4 h-4" /> }
            ].map(item => (
              <button
                key={item.id}
                onClick={() => { setDbTab(item.id as any); setDbSearch(''); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-mono font-bold transition-all text-left ${
                  dbTab === item.id 
                    ? 'bg-[#DAA520] text-white shadow-lg shadow-[#DAA520]/20' 
                    : 'bg-white hover:bg-gray-50 text-[#464646] border border-gray-100'
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>          {/* Table Container Grid */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden text-left flex flex-col">
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h3 className="font-mono font-black text-white text-lg flex items-center gap-2">
                  <DatabaseIcon className="w-5 h-5 text-indigo-400 animate-pulse" />
                  <span className="capitalize">{dbTab}</span>
                </h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                  Live SQLite Database Table Viewer & Search Explorer
                </p>
              </div>
              
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <span className="px-3 py-1.5 bg-slate-700/50 text-slate-300 text-xs font-black rounded-full border border-slate-600/30 whitespace-nowrap">
                  {dbData.length} Records
                </span>
                {/* Search Bar inside Database Tab */}
                <div className="relative w-full sm:w-64">
                  <input 
                    type="text" 
                    value={dbSearch} 
                    onChange={e => setDbSearch(e.target.value)} 
                    placeholder="Search table columns..." 
                    className="w-full pl-4 pr-10 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs font-bold text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" 
                  />
                  <SearchIcon className="absolute right-3.5 top-2.5 w-4 h-4 text-slate-500" />
                </div>
              </div>
            </div>

            <div className="p-6">
              {dbLoading ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <Loader2Icon className="w-8 h-8 text-indigo-500 animate-spin" />
                  <p className="text-xs font-black uppercase tracking-widest text-indigo-500 mt-3 animate-pulse">Loading live records...</p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-100 rounded-xl">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 tracking-widest border-b border-slate-100">
                    {dbTab === 'products' && (
                      <tr>
                        <th className="px-5 py-4">id</th>
                        <th className="px-5 py-4">sku</th>
                        <th className="px-5 py-4">name</th>
                        <th className="px-5 py-4">category</th>
                        <th className="px-5 py-4 text-right">price</th>
                        <th className="px-5 py-4 text-right">cost_price</th>
                        <th className="px-5 py-4 text-center">stock</th>
                        <th className="px-5 py-4 text-center">min_stock</th>
                        <th className="px-5 py-4">supplier</th>
                        <th className="px-5 py-4 text-center">unit</th>
                        <th className="px-5 py-4">barcode</th>
                      </tr>
                    )}
                    {dbTab === 'customers' && (
                      <tr>
                        <th className="px-5 py-4">id</th>
                        <th className="px-5 py-4">name</th>
                        <th className="px-5 py-4">phone</th>
                        <th className="px-5 py-4">address</th>
                        <th className="px-5 py-4">nic</th>
                        <th className="px-5 py-4 text-center">loyalty_points</th>
                        <th className="px-5 py-4 text-right">total_purchases</th>
                        <th className="px-5 py-4 text-center">join_date</th>
                      </tr>
                    )}
                    {dbTab === 'employees' && (
                      <tr>
                        <th className="px-5 py-4">id</th>
                        <th className="px-5 py-4">name</th>
                        <th className="px-5 py-4">role</th>
                        <th className="px-5 py-4">department</th>
                        <th className="px-5 py-4">email</th>
                        <th className="px-5 py-4">phone</th>
                        <th className="px-5 py-4 text-right">salary</th>
                        <th className="px-5 py-4 text-center">status</th>
                        <th className="px-5 py-4 text-center">attendance</th>
                        <th className="px-5 py-4 text-center">join_date</th>
                      </tr>
                    )}
                    {dbTab === 'profiles' && (
                      <tr>
                        <th className="px-5 py-4">id</th>
                        <th className="px-5 py-4">name</th>
                        <th className="px-5 py-4">email</th>
                        <th className="px-5 py-4">role</th>
                        <th className="px-5 py-4 text-center">avatar</th>
                        <th className="px-5 py-4">password</th>
                      </tr>
                    )}
                    {dbTab === 'purchase_orders' && (
                      <tr>
                        <th className="px-5 py-4">id</th>
                        <th className="px-5 py-4">po_number</th>
                        <th className="px-5 py-4">supplier_id</th>
                        <th className="px-5 py-4">supplier_name</th>
                        <th className="px-5 py-4 text-right">total</th>
                        <th className="px-5 py-4 text-center">status</th>
                        <th className="px-5 py-4 text-center">date</th>
                        <th className="px-5 py-4 text-center">due_date</th>
                      </tr>
                    )}
                    {dbTab === 'sales' && (
                      <tr>
                        <th className="px-5 py-4">id</th>
                        <th className="px-5 py-4">invoice_no</th>
                        <th className="px-5 py-4">customer_id</th>
                        <th className="px-5 py-4">customer_name</th>
                        <th className="px-5 py-4 text-right">subtotal</th>
                        <th className="px-5 py-4 text-right">discount</th>
                        <th className="px-5 py-4 text-right">tax</th>
                        <th className="px-5 py-4 text-center">tax_rate</th>
                        <th className="px-5 py-4 text-right">total_amount</th>
                        <th className="px-5 py-4 text-center">status</th>
                        <th className="px-5 py-4 text-center">created_at</th>
                      </tr>
                    )}
                    {dbTab === 'system_settings' && (
                      <tr>
                        <th className="px-5 py-4">id</th>
                        <th className="px-5 py-4">shop_name</th>
                        <th className="px-5 py-4">address</th>
                        <th className="px-5 py-4">phone</th>
                        <th className="px-5 py-4">email</th>
                        <th className="px-5 py-4">currency</th>
                        <th className="px-5 py-4 text-center">tax_rate</th>
                        <th className="px-5 py-4">backup_email</th>
                        <th className="px-5 py-4 text-center">backup_enabled</th>
                      </tr>
                    )}
                    {dbTab === 'transactions' && (
                      <tr>
                        <th className="px-5 py-4">id</th>
                        <th className="px-5 py-4 text-center">type</th>
                        <th className="px-5 py-4">category</th>
                        <th className="px-5 py-4">description</th>
                        <th className="px-5 py-4 text-right">amount</th>
                        <th className="px-5 py-4 text-center">date</th>
                        <th className="px-5 py-4">reference</th>
                        <th className="px-5 py-4">user_id</th>
                      </tr>
                    )}
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {dbData
                      .filter((row: any) => {
                        const searchStr = dbSearch.toLowerCase();
                        return Object.values(row).some(
                          (val) => String(val || '').toLowerCase().includes(searchStr)
                        );
                      })
                      .map((row: any, idx: number) => (
                        <tr key={row.id || idx} className="hover:bg-indigo-50/20 transition-colors group font-medium text-slate-700">
                          {dbTab === 'products' && (
                            <>
                              <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                              <td className="px-5 py-3 font-bold text-[#DAA520]">{row.sku}</td>
                              <td className="px-5 py-3 font-black text-slate-800">{row.name}</td>
                              <td className="px-5 py-3 font-bold text-gray-500">{row.category}</td>
                              <td className="px-5 py-3 text-right font-black text-slate-800">Rs. {Number(row.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3 text-right font-bold text-gray-400">Rs. {Number(row.cost_price || row.costPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3 text-center font-black text-emerald-600 bg-emerald-50/20">{row.stock}</td>
                              <td className="px-5 py-3 text-center font-bold text-red-600 bg-red-50/20">{row.min_stock || row.minStock || 0}</td>
                              <td className="px-5 py-3 text-gray-600">{row.supplier}</td>
                              <td className="px-5 py-3 text-center font-bold text-slate-500">{row.unit}</td>
                              <td className="px-5 py-3 font-mono font-semibold text-gray-500">{row.barcode || '—'}</td>
                            </>
                          )}
                          {dbTab === 'customers' && (
                            <>
                              <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                              <td className="px-5 py-3 font-black text-slate-800">{row.name}</td>
                              <td className="px-5 py-3 font-bold text-slate-600">{row.phone}</td>
                              <td className="px-5 py-3 font-semibold text-gray-500">{row.address}</td>
                              <td className="px-5 py-3 font-mono font-semibold text-gray-500">{row.nic || '—'}</td>
                              <td className="px-5 py-3 text-center font-black text-[#DAA520] bg-amber-50/20">{row.loyalty_points || row.loyaltyPoints || 0}</td>
                              <td className="px-5 py-3 text-right font-black text-slate-800">Rs. {Number(row.total_purchases || row.totalPurchases || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3 text-center text-gray-500 font-bold">{row.join_date || row.joinDate}</td>
                            </>
                          )}
                          {dbTab === 'employees' && (
                            <>
                              <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                              <td className="px-5 py-3 font-black text-slate-800">{row.name}</td>
                              <td className="px-5 py-3 font-bold text-[#DAA520]">{row.role}</td>
                              <td className="px-5 py-3 font-bold text-gray-500">{row.department}</td>
                              <td className="px-5 py-3 text-gray-600">{row.email}</td>
                              <td className="px-5 py-3 text-gray-600">{row.phone}</td>
                              <td className="px-5 py-3 text-right font-black text-slate-800">Rs. {Number(row.salary || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3 text-center">
                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${row.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{row.status}</span>
                              </td>
                              <td className="px-5 py-3 text-center font-black text-slate-700">{row.attendance}%</td>
                              <td className="px-5 py-3 text-center text-gray-500 font-bold">{row.join_date || row.joinDate}</td>
                            </>
                          )}
                          {dbTab === 'profiles' && (
                            <>
                              <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                              <td className="px-5 py-3 font-black text-slate-800">{row.name}</td>
                              <td className="px-5 py-3 font-semibold text-gray-500">{row.email}</td>
                              <td className="px-5 py-3 font-bold text-[#DAA520]">{row.role}</td>
                              <td className="px-5 py-3 text-center">
                                <div className="w-7 h-7 bg-[#DAA520]/10 text-[#DAA520] rounded-md flex items-center justify-center font-black mx-auto">{row.avatar}</div>
                              </td>
                              <td className="px-5 py-3 font-mono font-bold text-gray-400 select-all">{row.password || '••••••••'}</td>
                            </>
                          )}
                          {dbTab === 'purchase_orders' && (
                            <>
                              <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                              <td className="px-5 py-3 font-black text-slate-800">{row.po_number || row.poNumber}</td>
                              <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.supplier_id || row.supplierId}</td>
                              <td className="px-5 py-3 font-bold text-slate-700">{row.supplier_name || row.supplierName}</td>
                              <td className="px-5 py-3 text-right font-black text-slate-800">Rs. {Number(row.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3 text-center">
                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${row.status === 'received' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{row.status}</span>
                              </td>
                              <td className="px-5 py-3 text-center text-gray-500 font-bold">{row.date}</td>
                              <td className="px-5 py-3 text-center text-gray-500 font-bold">{row.due_date || row.dueDate}</td>
                            </>
                          )}
                          {dbTab === 'sales' && (
                            <>
                              <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                              <td className="px-5 py-3 font-black text-slate-800">{row.invoice_no || row.invoiceNo}</td>
                              <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.customer_id || 'guest'}</td>
                              <td className="px-5 py-3 font-bold text-slate-700">{row.customer_name || row.customerName || 'Guest Customer'}</td>
                              <td className="px-5 py-3 text-right font-semibold text-gray-500">Rs. {Number(row.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3 text-right text-gray-400">Rs. {Number(row.discount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3 text-right text-gray-400">Rs. {Number(row.tax || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3 text-center font-bold text-slate-500">{row.tax_rate || row.taxRate || 0}%</td>
                              <td className="px-5 py-3 text-right font-black text-slate-800">Rs. {Number(row.total_amount || row.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3 text-center">
                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${row.status === 'paid' || row.status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{row.status}</span>
                              </td>
                              <td className="px-5 py-3 text-center text-gray-500 font-bold">{(row.created_at || '').split('T')[0] || row.date}</td>
                            </>
                          )}
                          {dbTab === 'system_settings' && (
                            <>
                              <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                              <td className="px-5 py-3 font-black text-slate-800">{row.shop_name || row.shopName}</td>
                              <td className="px-5 py-3 font-bold text-gray-600">{row.address}</td>
                              <td className="px-5 py-3 text-gray-600">{row.phone}</td>
                              <td className="px-5 py-3 text-gray-500">{row.email}</td>
                              <td className="px-5 py-3 font-bold text-[#DAA520]">{row.currency}</td>
                              <td className="px-5 py-3 text-center font-bold text-slate-500">{row.tax_rate || row.taxRate}%</td>
                              <td className="px-5 py-3 text-gray-600">{row.backup_email || row.backupEmail}</td>
                              <td className="px-5 py-3 text-center">
                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${row.backup_enabled === 1 || row.backup_enabled === true ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{row.backup_enabled === 1 || row.backup_enabled === true ? 'Enabled' : 'Disabled'}</span>
                              </td>
                            </>
                          )}
                          {dbTab === 'transactions' && (
                            <>
                              <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                              <td className="px-5 py-3 text-center">
                                <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${row.type === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{row.type}</span>
                              </td>
                              <td className="px-5 py-3 font-bold text-[#DAA520]">{row.category}</td>
                              <td className="px-5 py-3 font-semibold text-slate-800">{row.description}</td>
                              <td className="px-5 py-3 text-right font-black text-slate-800">Rs. {Number(row.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3 text-center text-gray-500 font-bold">{row.date}</td>
                              <td className="px-5 py-3 font-mono font-semibold text-gray-500">{row.reference || '—'}</td>
                              <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.user_id || '—'}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    {dbData.length === 0 && (
                      <tr>
                        <td colSpan={15} className="p-12 text-center text-gray-400 font-bold text-sm">
                          No database records found in this table.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* BACKUP TAB */}
      {tab === 'backup' && (
        <div className="space-y-8 max-w-5xl animate-in slide-in-from-right-4">
          
          {/* Main Grid for Backup Operations */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Card 1: Instant Backup Actions */}
            <div className="bg-white p-4 sm:p-6 md:p-8 rounded-3xl border border-gray-100 shadow-md flex flex-col justify-between space-y-6 relative overflow-hidden group hover:shadow-lg transition-all duration-300">
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
                  Trigger an immediate export of your database. The system will compile all products, transactions, customers, suppliers, and logs into a beautifully styled multi-sheet Excel workbook and email a copy.
                </p>
              </div>
              
              <div className="space-y-3">
                {/* Date Filters for Backup Export */}
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
                  {(backupFromDate || backupToDate) && (
                    <button
                      onClick={() => { setBackupFromDate(''); setBackupToDate(''); }}
                      className="text-[9px] font-black text-red-500 hover:text-red-700 transition-all uppercase tracking-widest block ml-auto col-span-2 mt-1"
                    >
                      Clear Range
                    </button>
                  )}
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
 
            {/* Card 2: Weekly Automated Backup Settings */}
            <div className="bg-white p-4 sm:p-6 md:p-8 rounded-3xl border border-gray-100 shadow-md flex flex-col justify-between space-y-6 relative overflow-hidden group hover:shadow-lg transition-all duration-300">
              <div className="absolute top-0 left-0 h-1.5 w-full bg-[#464646]" />
              <div className="space-y-4 text-left">
                <div className="w-14 h-14 bg-[#464646]/10 rounded-2xl flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform duration-300">
                  <DatabaseIcon className="w-7 h-7 text-[#464646]" />
                </div>
                <div>
                  <h3 className="font-black text-[#464646] text-xl">6-Hour Auto-Backups</h3>
                  <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">Scheduled Server Backups</p>
                </div>
                <p className="text-xs text-gray-400 font-bold leading-relaxed">
                  Keep your business operations secure with automated database backups. When enabled, our scheduler will email structured database workbooks every 6 hours.
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
                      Enable Automated Backup (Every 6 Hours)
                    </label>
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

            {/* Card 3: Restore Database from Excel Backup */}
            <div className="bg-white p-4 sm:p-6 md:p-8 rounded-3xl border border-gray-100 shadow-md flex flex-col justify-between space-y-6 relative overflow-hidden group hover:shadow-lg transition-all duration-300">
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
                  Upload a previously exported Muthuwadige Hardware ERP backup Excel spreadsheet (.xlsx) to restore all database rows. All tables will be synchronized inside a transaction.
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
            
            {/* Left Card: Connection Status */}
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
                    <span className={`inline-flex items-center px-3.5 py-1.5 rounded-full text-xs font-black uppercase tracking-wider ${
                      appRole === 'host' ? 'bg-[#DAA520]/10 text-[#DAA520] border border-[#DAA520]/20' : 'bg-blue-500/10 text-blue-600 border border-blue-500/20'
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

            {/* Right Card: Connection Manager */}
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
                        className={`p-4 rounded-2xl border text-left transition-all ${
                          appRole === 'host' 
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
                        className={`p-4 rounded-2xl border text-left transition-all ${
                          appRole === 'client' 
                            ? 'border-blue-500 bg-blue-50/50 shadow-sm' 
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <p className="text-xs font-black text-slate-800 uppercase tracking-wider">Network Client</p>
                        <p className="text-[9px] font-bold text-gray-400 mt-1 leading-normal">Connects to a Host. Choose for other 4 cashier laptops.</p>
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
                        <div className={`p-3.5 rounded-xl border text-xs font-bold ${
                          connectionTestResult.success 
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
                        <div className="flex items-center justify-between gap-3 p-3 bg-white border border-slate-100 rounded-xl shadow-sm">
                          <div>
                            <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider block">Local Host (Standalone)</span>
                            <span className="text-xs font-mono font-bold text-gray-500">http://localhost:5001</span>
                          </div>
                          <button 
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText('http://localhost:5001');
                              alert('Copied URL: http://localhost:5001');
                            }}
                            className="px-3 py-1.5 bg-gray-100 hover:bg-[#DAA520] hover:text-white rounded-lg text-[9px] font-black uppercase tracking-wider text-gray-500 transition-all"
                          >
                            Copy Link
                          </button>
                        </div>
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

          {/* Setup & Installation Guide */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-md p-4 sm:p-6 md:p-10 space-y-6">
            <div className="flex items-center gap-5 border-b border-gray-100 pb-5">
              <div className="w-12 h-12 bg-[#DAA520]/10 rounded-2xl flex items-center justify-center shrink-0">
                <FileTextIcon className="w-6 h-6 text-[#DAA520]" />
              </div>
              <div>
                <h3 className="font-black text-lg text-[#464646] uppercase tracking-wider">Multi-Device & Phone Deployment Guide</h3>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mt-0.5">Step-by-step instructions to configure shop laptops and mobile phone dashboard</p>
              </div>
            </div>

            <div className="space-y-6">
              
              {/* Step 1 */}
              <div className="flex gap-4 items-start">
                <div className="w-8 h-8 rounded-full bg-slate-800 text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5">1</div>
                <div className="space-y-2 flex-1 flex flex-col items-start text-left">
                  <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">Configure Host Server (Primary Laptop)</h4>
                  <p className="text-xs text-gray-500 leading-relaxed font-bold">
                    Choose one laptop in the shop as the **Host Server** (Standalone Host mode). This laptop will run the primary database. 
                  </p>
                  <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100 text-xs text-amber-900 leading-relaxed space-y-1.5 font-bold">
                    <p className="font-black flex items-center gap-1.5 uppercase tracking-wide text-[10px] text-[#DAA520]">
                      <ShieldIcon className="w-3.5 h-3.5" /> Windows Defender Firewall Rule
                    </p>
                    <p>
                      Other devices cannot connect if the Host laptop's firewall blocks incoming traffic on port **5001**.
                    </p>
                    <ol className="list-decimal pl-4 mt-1 space-y-1 font-bold">
                      <li>Open **Windows Defender Firewall** in Control Panel.</li>
                      <li>Go to **Advanced Settings** &gt; **Inbound Rules** &gt; **New Rule**.</li>
                      <li>Select **Port**, click Next. Select **TCP** and Specific local ports: **5001**.</li>
                      <li>Select **Allow the connection**, choose **Private &amp; Public** profiles, name it "Muthuwadige ERP Server", and save.</li>
                    </ol>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4 items-start border-t border-gray-100 pt-6">
                <div className="w-8 h-8 rounded-full bg-slate-800 text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5">2</div>
                <div className="space-y-2 flex-1 flex flex-col items-start text-left">
                  <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">Connect other 4 Cashier Laptops</h4>
                  <p className="text-xs text-gray-500 leading-relaxed font-bold">
                    For the remaining cashier laptops in the shop, you have two deployment options:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                    <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-1.5 text-left">
                      <p className="font-black text-xs text-slate-700 uppercase tracking-wider">Option A: Web Browser Access (Simplest)</p>
                      <p className="text-[10px] text-gray-500 font-bold leading-normal">
                        Ensure the client laptop is on the same Wi-Fi network. Open Google Chrome or Microsoft Edge and navigate directly to:
                      </p>
                      <p className="text-[11px] font-mono font-bold text-[#DAA520] bg-white p-2 rounded border border-slate-100 break-all select-all">
                        {networkAddresses.length > 0 ? `http://${networkAddresses[0].address}:5001` : 'http://<host-laptop-ip>:5001'}
                      </p>
                      <p className="text-[9px] text-gray-400 font-bold leading-normal mt-1">
                        Create a desktop shortcut pointing to this URL for one-click access. No local app installations are required!
                      </p>
                    </div>

                    <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl space-y-1.5 text-left">
                      <p className="font-black text-xs text-slate-700 uppercase tracking-wider">Option B: Electron App (Client Mode)</p>
                      <p className="text-[10px] text-gray-500 font-bold leading-normal">
                        Install the packaged desktop application on the client laptop. Start the app, navigate to **Settings &gt; Connection &amp; Network**, toggle to **Network Client**, paste the Host's IP address, and click **Save**.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4 items-start border-t border-gray-100 pt-6">
                <div className="w-8 h-8 rounded-full bg-slate-800 text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5">3</div>
                <div className="space-y-2 flex-1 flex flex-col items-start text-left">
                  <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">View ERP from Mobile Phone (Local Wi-Fi)</h4>
                  <p className="text-xs text-gray-500 leading-relaxed font-bold">
                    Ensure the owner's mobile phone is connected to the same Wi-Fi network as the Host Laptop. Open Safari or Chrome on the mobile phone and browse to:
                  </p>
                  <p className="text-[11px] font-mono font-bold text-[#DAA520] bg-slate-50 p-2.5 rounded-xl border border-slate-100 break-all w-fit select-all">
                    {networkAddresses.length > 0 ? `http://${networkAddresses[0].address}:5001` : 'http://<host-laptop-ip>:5001'}
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex gap-4 items-start border-t border-gray-100 pt-6">
                <div className="w-8 h-8 rounded-full bg-[#DAA520] text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5">4</div>
                <div className="space-y-2 flex-1 text-left flex flex-col items-start">
                  <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider text-[#DAA520]">View ERP from Mobile Phone (Remote/Away from Shop)</h4>
                  <p className="text-xs text-gray-500 leading-relaxed font-bold">
                    If the owner wants to monitor the shop database while travelling or from home, we recommend setting up a secure tunnel. This bypasses complex router configuration and static IP fees:
                  </p>
                  
                  <div className="space-y-3 mt-2 text-xs w-full">
                    <div className="p-4 bg-gray-50 border border-gray-100 rounded-xl font-bold leading-relaxed text-gray-600">
                      <p className="font-black text-xs text-slate-800 uppercase tracking-wider mb-2">Recommended: Cloudflare Tunnels (Free &amp; Secure)</p>
                      <ol className="list-decimal pl-4 space-y-1">
                        <li>Create a free account on [Cloudflare](https://www.cloudflare.com).</li>
                        <li>Install `cloudflared` on the Host Laptop.</li>
                        <li>Run the command to authenticate and create a tunnel:
                          <code className="block mt-1 p-2 bg-white rounded border border-slate-100 font-mono text-[10px] break-all select-all">cloudflared tunnel create muthuwadige-erp</code>
                        </li>
                        <li>Route traffic to the local server by mapping port 5001:
                          <code className="block mt-1 p-2 bg-white rounded border border-slate-100 font-mono text-[10px] break-all select-all font-bold">cloudflared tunnel route dns muthuwadige-erp erp.yourdomain.com</code>
                        </li>
                        <li>Run the tunnel. The owner can now securely view the ERP from their mobile phone anywhere in the world by going to `https://erp.yourdomain.com`!</li>
                      </ol>
                    </div>

                    <div className="p-4 bg-gray-50 border border-gray-100 rounded-xl font-bold leading-relaxed text-gray-600">
                      <p className="font-black text-xs text-slate-800 uppercase tracking-wider mb-2">Alternative: Ngrok (Fast Setup)</p>
                      <ol className="list-decimal pl-4 space-y-1">
                        <li>Download and sign up for [Ngrok](https://ngrok.com).</li>
                        <li>On the Host Laptop, run:
                          <code className="block mt-1 p-2 bg-white rounded border border-slate-100 font-mono text-[10px] break-all select-all font-bold">ngrok http 5001</code>
                        </li>
                        <li>Copy the forwarding URL generated (e.g. `https://random-subdomain.ngrok-free.app`).</li>
                        <li>Open that URL on the phone browser to view the ERP remotely.</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>

            </div>
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

      {/* MODALS */}
      {deleteTargetUser && (
        <div className="fixed inset-0 bg-[#464646]/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500">Danger Zone</p>
                <h3 className="text-2xl font-black text-[#464646]">Confirm Delete</h3>
              </div>
              <button type="button" onClick={() => setDeleteTargetUser(null)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><XIcon className="w-5 h-5" /></button>
            </div>
            <div className="rounded-3xl bg-red-50 border border-red-100 p-5 text-center">
              <div className="mx-auto w-16 h-16 bg-red-500/10 rounded-3xl flex items-center justify-center mb-4">
                <Trash2Icon className="w-8 h-8 text-red-600" />
              </div>
              <p className="text-sm text-gray-500 mb-3">You are about to remove the user</p>
              <p className="font-black text-lg text-[#464646]">{deleteTargetUser.name}</p>
              <p className="text-xs uppercase tracking-[0.2em] text-red-500 mt-3">This action cannot be undone</p>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteTargetUser(null)} className="flex-1 py-3 rounded-2xl border border-gray-200 text-gray-600 font-black uppercase tracking-[0.15em] hover:bg-gray-50 transition-all">Cancel</button>
              <button type="button" onClick={() => handleDeleteUser(deleteTargetUser.id)} className="flex-1 py-3 rounded-2xl bg-red-600 text-white font-black uppercase tracking-[0.15em] hover:bg-red-700 transition-all">Delete User</button>
            </div>
          </div>
        </div>
      )}
      {showEditUser && editingUser && (
        <div className="fixed inset-0 bg-[#464646]/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <form onSubmit={handleUpdateUser} className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-5 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-black text-xl text-[#464646]">Edit Profile</h3>
              <button type="button" onClick={() => setShowEditUser(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><XIcon className="w-5 h-5" /></button>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Full Name</label>
              <input required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646]" value={editingUser.name} onChange={e => setEditingUser({ ...editingUser, name: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Email Address</label>
              <input required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646]" value={editingUser.email} onChange={e => setEditingUser({ ...editingUser, email: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">System Role</label>
              <select className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646] bg-white cursor-pointer" value={editingUser.role} onChange={e => setEditingUser({ ...editingUser, role: e.target.value as any })}>
                <option value="retail_user">Retail User (Cashier)</option>
                <option value="admin">Admin (Manager)</option>
                <option value="super_admin">Super Admin (Owner)</option>
              </select>
            </div>
            <div className="flex gap-3 pt-4 border-t border-gray-100">
              <button type="button" onClick={() => setShowEditUser(false)} className="flex-1 py-3.5 font-black text-gray-500 hover:bg-gray-100 rounded-xl uppercase tracking-widest text-xs transition-colors">Cancel</button>
              <button type="submit" className="flex-1 py-3.5 font-black bg-[#464646] hover:bg-[#333333] text-white rounded-xl shadow-lg shadow-[#464646]/20 uppercase tracking-widest text-xs transition-all">Update Details</button>
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