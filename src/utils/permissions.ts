import type { UserRole, PageName } from '../types';
import { API_URL, fetchWithTimeout } from '../lib/api';

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