import { ROLE_PERMISSIONS } from './permissions';

/**
 * Checks whether a user has a specific permission capability key.
 *
 * Evaluation order:
 * 1. Root Admin / Super Admin role override (always returns true).
 * 2. Explicit user.permissions array or string (if attached to user profile).
 * 3. Dynamic Permissions Matrix (ROLE_PERMISSIONS) loaded from DB / LocalStorage.
 *
 * @param user User profile object
 * @param permissionKey Capability key (e.g. 'sales_history', 'sales_returns', 'reports')
 * @returns boolean
 */
export const hasUserPermission = (user: any, permissionKey: string): boolean => {
  if (!user) return false;

  const roleStr = (user.role || '').toLowerCase();
  // Super Admin / Admin role always has root override
  if (roleStr === 'admin' || roleStr === 'super admin' || roleStr === 'super_admin') {
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
  }

  if (permissions.length > 0) {
    if (permissions.includes(permissionKey) || permissions.includes('*') || permissions.includes('all')) {
      return true;
    }
  }

  // Fallback to active Permissions Matrix for the user's role
  const rolePerms = ROLE_PERMISSIONS[user.role] || [];
  if (rolePerms.includes(permissionKey as any)) {
    return true;
  }

  // Capability key aliases for sub-tabs and actions
  if (permissionKey === 'sales_history' || permissionKey === 'sales_all_history' || permissionKey === 'sales_own_history') {
    return rolePerms.includes('sales' as any) ||
           rolePerms.includes('sales_history' as any) ||
           rolePerms.includes('sales_all_history' as any) ||
           rolePerms.includes('sales_own_history' as any);
  }

  if (permissionKey === 'sales_returns') {
    return rolePerms.includes('sales_returns' as any) || rolePerms.includes('sales' as any);
  }

  if (permissionKey === 'credit_delete_void') {
    return rolePerms.includes('credit_delete_void' as any) || rolePerms.includes('settings' as any);
  }

  return false;
};

export default {
  hasUserPermission
};
