import type { UserRole, PageName } from '../types';
import { API_URL, fetchWithTimeout } from '../lib/api';

export interface CapabilityDef {
  key: string;
  name: string;
  description: string;
  category: 'pos' | 'credit' | 'inv' | 'admin';
}

export interface CapabilityCategory {
  id: 'pos' | 'credit' | 'inv' | 'admin';
  name: string;
  description: string;
  icon: string;
}

export const CAPABILITY_CATEGORIES: CapabilityCategory[] = [
  { id: 'pos', name: 'POS & Invoicing', description: 'Counter checkout, discounts, refunds, and order history', icon: '🛒' },
  { id: 'credit', name: 'Customer & Credit Management', description: 'Credit debt limits, settlement collection, and records', icon: '💳' },
  { id: 'inv', name: 'Inventory & Purchasing', description: 'Cost prices, stock corrections, and purchase order GRNs', icon: '📦' },
  { id: 'admin', name: 'Reporting & Administration', description: 'Financial P&L statements and system database backups', icon: '📊' }
];

export const CAPABILITIES: CapabilityDef[] = [
  // 1. POS & Invoicing
  {
    key: 'pos_create_sales',
    name: 'Create & Complete Sales',
    description: 'Create new orders, scan barcodes, and complete sales checkout',
    category: 'pos'
  },
  {
    key: 'pos_apply_discount',
    name: 'Apply Custom Discounts',
    description: 'Apply custom line-item or bill-level discounts during checkout',
    category: 'pos'
  },
  {
    key: 'pos_process_returns',
    name: 'Process Returns & Exchanges',
    description: 'Accept returned products and issue refunds, exchanges, or credit notes',
    category: 'pos'
  },
  {
    key: 'pos_view_all_history',
    name: "View All Staff Sales History",
    description: "View sales invoices and receipt history created by all cashiers",
    category: 'pos'
  },

  // 2. Customer & Credit Management
  {
    key: 'credit_issue_invoices',
    name: 'Create Unpaid Credit Bills',
    description: 'Issue orders on credit terms and assign repayment due dates',
    category: 'credit'
  },
  {
    key: 'credit_record_settlement',
    name: 'Record Debt Settlements',
    description: 'Accept customer debt payments and issue FIFO settlement receipts',
    category: 'credit'
  },
  {
    key: 'credit_edit_customer',
    name: 'Edit Customer Terms & Credit Limits',
    description: 'Modify customer profiles, credit limits, and payment periods',
    category: 'credit'
  },
  {
    key: 'credit_void_records',
    name: 'Void & Delete Credit Records',
    description: 'Permanently void credit invoices or delete settlement records (Super Admin only by default)',
    category: 'credit'
  },

  // 3. Inventory & Purchasing
  {
    key: 'inv_view_cost_price',
    name: 'View Product Buying Cost & Margin',
    description: 'View product unit buying costs, supplier purchasing rates, and profit margins',
    category: 'inv'
  },
  {
    key: 'inv_adjust_stock',
    name: 'Manual Stock Count Adjustments',
    description: 'Perform manual stock count corrections and log inventory adjustments',
    category: 'inv'
  },
  {
    key: 'po_create_and_receive',
    name: 'Purchasing & Receive GRN Stock',
    description: 'Access Purchasing module, create purchase orders, and receive supplier GRNs',
    category: 'inv'
  },

  // 4. Reporting & Administration
  {
    key: 'reports_view_financials',
    name: 'View Financial P&L & Margins',
    description: 'View full business P&L, COGS, gross margins, and executive reports',
    category: 'admin'
  },
  {
    key: 'system_backup_manage',
    name: 'Database Backup & Restore',
    description: 'Export system database backups and perform database restores',
    category: 'admin'
  }
];

export const getDefaultRolePermissions = (role: string): string[] => {
  const norm = (role || '').toLowerCase().trim();
  if (norm === 'admin' || norm === 'super_admin' || norm === 'super admin') {
    return CAPABILITIES.map(c => c.key);
  }
  if (norm === 'manager') {
    return [
      'pos_create_sales',
      'pos_apply_discount',
      'pos_process_returns',
      'pos_view_all_history',
      'credit_issue_invoices',
      'credit_record_settlement',
      'credit_edit_customer',
      'inv_view_cost_price',
      'inv_adjust_stock',
      'po_create_and_receive',
      'reports_view_financials'
    ];
  }
  // Cashier
  return [
    'pos_create_sales',
    'pos_apply_discount',
    'credit_record_settlement'
  ];
};

export const arePermissionsCustomized = (role: string, currentPerms?: string[]): boolean => {
  if (!currentPerms || !Array.isArray(currentPerms)) return false;
  const defaultPerms = getDefaultRolePermissions(role);
  if (currentPerms.length !== defaultPerms.length) return true;
  const set = new Set(defaultPerms);
  return currentPerms.some(k => !set.has(k));
};

export const defaultPermissions: Record<UserRole, PageName[]> = {
  Admin: [
    'dashboard', 'inventory', 'sales', 'purchasing', 'barcode-print', 'barcode_print', 'barcodes',
    'customers', 'suppliers', 'reports', 'users', 'database', 'settings', 'finance', 'audit_logs'
  ],
  Manager: [
    'dashboard', 'inventory', 'sales', 'purchasing', 'barcode-print', 'barcode_print', 'barcodes',
    'customers', 'suppliers', 'reports', 'finance'
  ],
  Cashier: [
    'dashboard', 'sales', 'inventory', 'barcode-print', 'barcode_print', 'barcodes', 'customers'
  ]
};

export const getPermissions = (): Record<UserRole, PageName[]> => {
  const stored = localStorage.getItem('custom_permissions');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.error("Failed to parse custom permissions from localStorage:", e);
    }
  }
  return defaultPermissions;
};

export const savePermissions = (perms: Record<UserRole, PageName[]>) => {
  localStorage.setItem('custom_permissions', JSON.stringify(perms));
  window.dispatchEvent(new Event('permissions-updated'));

  // Persist to local SQLite server
  fetchWithTimeout(`${API_URL}/permissions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(perms)
  }, 8000).catch(err => console.error("Failed to persist custom permissions to SQLite database:", err));
};

// Use Proxy so ROLE_PERMISSIONS can be imported and accessed as an object dynamically
export const ROLE_PERMISSIONS = new Proxy({} as Record<string, PageName[]>, {
  get(target, prop: string) {
    const perms = getPermissions() as Record<string, PageName[]>;
    const normalizedProp = prop ? (prop.charAt(0).toUpperCase() + prop.slice(1).toLowerCase()) : 'Cashier';
    
    return perms[normalizedProp] || perms[prop] || (defaultPermissions as Record<string, PageName[]>)[normalizedProp] || (defaultPermissions as Record<string, PageName[]>)[prop] || defaultPermissions.Cashier || [];
  }
});

export { hasUserPermission } from './auth';