import type { UserRole, PageName } from '../types';
import { API_URL, fetchWithTimeout } from '../lib/api';

export const defaultPermissions: Record<UserRole, PageName[]> = {
  super_admin: [
    'dashboard', 'inventory', 'sales', 'purchasing',
    'customers', 'suppliers', 'reports', 'users', 'database', 'settings', 'finance', 'audit_logs'
  ],
  admin: [
    'dashboard', 'inventory', 'sales', 'purchasing', 'customers', 'suppliers', 'reports', 'settings', 'finance'
  ],
  manager: [
    'dashboard', 'inventory', 'sales', 'purchasing', 'customers', 'suppliers', 'reports', 'finance'
  ],
  cashier: [
    'dashboard', 'sales', 'customers'
  ],
  retail_user: [
    'dashboard', 'sales', 'customers'
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
export const ROLE_PERMISSIONS = new Proxy({} as Record<UserRole, PageName[]>, {
  get(target, prop: string) {
    const perms = getPermissions();
    const role = prop as UserRole;
    if (role === 'retail_user') {
      return perms['cashier'] || perms['retail_user'] || defaultPermissions.retail_user;
    }
    return perms[role] || defaultPermissions[role] || [];
  }
});