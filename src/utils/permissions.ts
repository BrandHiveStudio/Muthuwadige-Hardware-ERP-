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

export const ROLE_PRESETS: Record<string, string[]> = {
  Admin: CAPABILITIES.map(c => c.key),
  Manager: [
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
  ],
  Cashier: [
    'pos_create_sales',
    'pos_apply_discount',
    'credit_record_settlement'
  ]
};

export const getDefaultRolePermissions = (role: string): string[] => {
  const norm = (role || '').toLowerCase().trim();
  if (norm === 'admin' || norm === 'super_admin' || norm === 'super admin') {
    return ROLE_PRESETS.Admin;
  }
  if (norm === 'manager') {
    return ROLE_PRESETS.Manager;
  }
  return ROLE_PRESETS.Cashier;
};

export const arePermissionsCustomized = (role: string, currentPerms?: string[] | string): boolean => {
  if (!currentPerms) return false;
  let perms: string[] = [];
  if (Array.isArray(currentPerms)) {
    perms = currentPerms;
  } else if (typeof currentPerms === 'string' && currentPerms.trim().length > 0) {
    try {
      perms = JSON.parse(currentPerms);
    } catch {
      perms = currentPerms.split(',').map((p: string) => p.trim());
    }
  } else {
    return false;
  }
  const defaultPerms = getDefaultRolePermissions(role);
  if (perms.length !== defaultPerms.length) return true;
  const set = new Set(defaultPerms);
  return perms.some(k => !set.has(k));
};

export const getCustomOverrideCount = (role: string, currentPerms?: string[] | string): number => {
  if (!currentPerms) return 0;
  let perms: string[] = [];
  if (Array.isArray(currentPerms)) {
    perms = currentPerms;
  } else if (typeof currentPerms === 'string' && currentPerms.trim().length > 0) {
    try {
      perms = JSON.parse(currentPerms);
    } catch {
      perms = currentPerms.split(',').map((p: string) => p.trim());
    }
  } else {
    return 0;
  }
  return perms.length;
};

export const normalizeCapabilityKey = (key: string): string => {
  const k = (key || '').toLowerCase().trim();
  switch (k) {
    case 'purchasing':
    case 'purchasing_access':
    case 'suppliers':
    case 'po_create_and_receive':
      return 'po_create_and_receive';
    
    case 'reports':
    case 'view_financial_reports':
    case 'reports_view_financials':
    case 'finance':
      return 'reports_view_financials';
    
    case 'sales':
    case 'sales_create':
    case 'pos_create_sales':
      return 'pos_create_sales';

    case 'sales_returns':
    case 'returns':
    case 'pos_process_returns':
      return 'pos_process_returns';

    case 'sales_history':
    case 'sales_all_history':
    case 'history':
    case 'pos_view_all_history':
      return 'pos_view_all_history';

    case 'pos_apply_discount':
    case 'discount':
    case 'discounts':
      return 'pos_apply_discount';

    case 'credit':
    case 'credit_create_sale':
    case 'credit_issue_invoices':
      return 'credit_issue_invoices';

    case 'credit_history':
    case 'credit_record_payment':
    case 'credit_record_settlement':
    case 'settlements':
      return 'credit_record_settlement';

    case 'credit_edit':
    case 'credit_edit_customer':
      return 'credit_edit_customer';

    case 'credit_delete_void':
    case 'credit_void_records':
      return 'credit_void_records';

    case 'inv_view_cost_price':
    case 'view_cost_price':
      return 'inv_view_cost_price';

    case 'inv_adjust_stock':
    case 'adjust_stock':
      return 'inv_adjust_stock';

    case 'database':
    case 'settings':
    case 'system_backup_manage':
      return 'system_backup_manage';

    default:
      return k;
  }
};

/**
 * Global permission check helper.
 * Evaluation order:
 * 1. Root Super Admin -> always returns true.
 * 2. Core pages (dashboard, barcode-print, inventory lookup) -> returns true for all logged-in users.
 * 3. User custom overrides (user.custom_permissions or user.permissions) -> evaluated first.
 * 4. Fallback to base role presets (ROLE_PRESETS[user.role]).
 */
export const hasPermission = (user: any, capabilityKey: string): boolean => {
  if (!user) return false;

  const roleStr = (user.role || '').toLowerCase().trim();
  const isSuperAdmin = 
    roleStr === 'admin' || 
    roleStr === 'super_admin' || 
    roleStr === 'super admin' || 
    user.email === 'admin@hardware.com' ||
    user.id === 'u1' ||
    user.id === 'u2' ||
    user.id === 'admin_super';

  if (isSuperAdmin) {
    return true;
  }

  // Dashboard & Barcode Print are available to all authenticated staff
  if (capabilityKey === 'dashboard') {
    return true;
  }
  if (['barcode-print', 'barcode_print', 'barcodes'].includes(capabilityKey)) {
    return true;
  }
  if (capabilityKey === 'inventory') {
    return true;
  }

  // User & Audit log administration is restricted to Root Admins
  if (capabilityKey === 'users' || capabilityKey === 'audit_logs') {
    return roleStr === 'admin' || roleStr === 'super_admin' || roleStr === 'super admin';
  }

  const normalizedKey = normalizeCapabilityKey(capabilityKey);

  // Check custom permissions on user object or sessionStorage
  const rawPerms = user.custom_permissions !== undefined 
    ? user.custom_permissions 
    : (user.permissions !== undefined ? user.permissions : (() => {
        try {
          if (typeof window !== 'undefined') {
            const cached = sessionStorage.getItem('custom_permissions');
            if (cached) return JSON.parse(cached);
          }
        } catch (_) {}
        return undefined;
      })());

  let customPerms: string[] | Record<string, boolean> | null = null;
  if (rawPerms) {
    if (Array.isArray(rawPerms)) {
      customPerms = rawPerms;
    } else if (typeof rawPerms === 'object') {
      customPerms = rawPerms;
    } else if (typeof rawPerms === 'string' && rawPerms.trim().length > 0) {
      try {
        customPerms = JSON.parse(rawPerms);
      } catch {
        customPerms = rawPerms.split(',').map((p: string) => p.trim());
      }
    }
  }

  if (customPerms) {
    if (Array.isArray(customPerms)) {
      if (customPerms.includes('*') || customPerms.includes('all')) {
        return true;
      }
      if (customPerms.includes(capabilityKey) || customPerms.includes(normalizedKey)) {
        return true;
      }

      // Composite permission mappings
      if (capabilityKey === 'customers') {
        return customPerms.includes('credit_record_settlement') ||
               customPerms.includes('credit_edit_customer') ||
               customPerms.includes('credit_issue_invoices') ||
               customPerms.includes('pos_create_sales');
      }

      if (capabilityKey === 'sales') {
        return customPerms.includes('pos_create_sales') ||
               customPerms.includes('pos_view_all_history') ||
               customPerms.includes('pos_process_returns');
      }

      if (capabilityKey === 'quotes' || capabilityKey === 'quotations') {
        return customPerms.includes('pos_create_sales') || 
               customPerms.includes('quotes') || 
               customPerms.includes('quotations');
      }

      if (capabilityKey === 'credit_history') {
        return customPerms.includes('credit_record_settlement') || 
               customPerms.includes('credit_issue_invoices') || 
               customPerms.includes('credit_view_history');
      }

      // If custom permissions are explicitly configured for this user and not matched, deny
      return false;
    } else if (typeof customPerms === 'object') {
      if (customPerms[capabilityKey] !== undefined) return Boolean(customPerms[capabilityKey]);
      if (customPerms[normalizedKey] !== undefined) return Boolean(customPerms[normalizedKey]);
    }
  }

  // Fallback to role presets
  const defaultPerms = getDefaultRolePermissions(user.role);
  if (defaultPerms.includes(capabilityKey) || defaultPerms.includes(normalizedKey)) {
    return true;
  }

  if (capabilityKey === 'customers') {
    return defaultPerms.includes('credit_record_settlement') ||
           defaultPerms.includes('credit_edit_customer') ||
           defaultPerms.includes('credit_issue_invoices') ||
           defaultPerms.includes('pos_create_sales');
  }

  if (capabilityKey === 'sales') {
    return defaultPerms.includes('pos_create_sales') ||
           defaultPerms.includes('pos_view_all_history') ||
           defaultPerms.includes('pos_process_returns');
  }

  if (capabilityKey === 'quotes' || capabilityKey === 'quotations') {
    return defaultPerms.includes('pos_create_sales');
  }

  if (capabilityKey === 'credit_history') {
    return defaultPerms.includes('credit_record_settlement') || defaultPerms.includes('credit_issue_invoices');
  }

  // Fallback to active dynamic Permissions Matrix for user's role
  const rolePerms = (ROLE_PERMISSIONS as any)[user.role] || [];
  if (Array.isArray(rolePerms) && rolePerms.includes(capabilityKey as any)) {
    return true;
  }

  return false;
};

// Aliased helper for backwards compatibility
export const hasUserPermission = hasPermission;

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