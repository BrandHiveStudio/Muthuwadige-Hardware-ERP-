import { hasPermission, hasUserPermission } from './permissions';

export {
  hasPermission,
  hasUserPermission,
  ROLE_PRESETS,
  getDefaultRolePermissions,
  arePermissionsCustomized,
  getCustomOverrideCount,
  normalizeCapabilityKey,
  ROLE_PERMISSIONS
} from './permissions';

export default {
  hasPermission,
  hasUserPermission
};

