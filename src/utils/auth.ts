import { ROLE_PERMISSIONS, getDefaultRolePermissions } from './permissions';

/**
 * Checks whether a user has a specific permission capability key or access to a navigation module.
 *
 * Evaluation order:
 * 1. Root Admin / Super Admin role override (always returns true).
 * 2. Explicit user.permissions array or JSON string.
 * 3. Base role default preset (getDefaultRolePermissions).
 * 4. Fallback to dynamic Permissions Matrix (ROLE_PERMISSIONS).
 *
 * @param user User profile object
 * @param permissionKey Capability key or page name
 * @returns boolean
 */
export const hasUserPermission = (user: any, permissionKey: string): boolean => {
  if (!user) return false;

  const roleStr = (user.role || '').toLowerCase().trim();
  // Super Admin / Admin role always has root override
  if (roleStr === 'admin' || roleStr === 'super admin' || roleStr === 'super_admin' || user.email === 'admin@hardware.com') {
    return true;
  }

  // Dashboard is accessible to all logged-in staff members
  if (permissionKey === 'dashboard') {
    return true;
  }

  // Parse permissions if present directly on user object
  let permissions: string[] = [];
  if (Array.isArray(user.permissions)) {
    permissions = user.permissions;
  } else if (typeof user.permissions === 'string' && user.permissions.trim().length > 0) {
    try {
      permissions = JSON.parse(user.permissions);
    } catch {
      permissions = user.permissions.split(',').map((p: string) => p.trim());
    }
  } else {
    // If user has no custom overrides, use their default role preset
    permissions = getDefaultRolePermissions(user.role);
  }

  if (permissions.length > 0) {
    if (permissions.includes(permissionKey) || permissions.includes('*') || permissions.includes('all')) {
      return true;
    }
  }

  // Granular capability mappings for navigation pages & modules:
  if (permissionKey === 'sales' || permissionKey === 'sales_create') {
    return permissions.includes('pos_create_sales') || permissions.includes('pos_view_all_history') || permissions.includes('pos_process_returns');
  }

  if (permissionKey === 'sales_returns') {
    return permissions.includes('pos_process_returns');
  }

  if (permissionKey === 'sales_history' || permissionKey === 'sales_all_history') {
    return permissions.includes('pos_view_all_history');
  }

  if (permissionKey === 'sales_own_history' || permissionKey === 'sales_today') {
    return permissions.includes('pos_create_sales') || permissions.includes('pos_view_all_history');
  }

  if (permissionKey === 'inventory') {
    // Inventory search/lookup is accessible to all staff, detailed costs/adjustments are checked individually
    return true;
  }

  if (permissionKey === 'barcode-print' || permissionKey === 'barcode_print' || permissionKey === 'barcodes') {
    return true;
  }

  if (permissionKey === 'customers') {
    return permissions.includes('credit_record_settlement') || permissions.includes('credit_edit_customer') || permissions.includes('credit_issue_invoices') || permissions.includes('pos_create_sales');
  }

  if (permissionKey === 'credit_create_sale') {
    return permissions.includes('credit_issue_invoices');
  }

  if (permissionKey === 'credit_record_payment') {
    return permissions.includes('credit_record_settlement');
  }

  if (permissionKey === 'credit_edit') {
    return permissions.includes('credit_edit_customer');
  }

  if (permissionKey === 'credit_delete_void') {
    return permissions.includes('credit_void_records');
  }

  if (permissionKey === 'purchasing' || permissionKey === 'suppliers') {
    return permissions.includes('po_create_and_receive');
  }

  if (permissionKey === 'reports' || permissionKey === 'finance') {
    return permissions.includes('reports_view_financials');
  }

  if (permissionKey === 'database' || permissionKey === 'settings') {
    return permissions.includes('system_backup_manage');
  }

  if (permissionKey === 'users' || permissionKey === 'audit_logs') {
    return roleStr === 'admin' || roleStr === 'super admin' || roleStr === 'super_admin';
  }

  // Fallback to active Permissions Matrix for the user's role
  const rolePerms = ROLE_PERMISSIONS[user.role] || [];
  if (rolePerms.includes(permissionKey as any)) {
    return true;
  }

  return false;
};

export default {
  hasUserPermission
};
