import { MODULE_CODE_ALLOWLIST } from './permission-module-allowlist.constant.js';

/**
 * Danh sách các field được phép sort khi list permissions.
 */
export const PERMISSION_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'permissionCode',
  'permissionName',
  'moduleCode',
] as const;

export type PermissionSortField = (typeof PERMISSION_SORT_FIELDS)[number];
