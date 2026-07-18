/**
 * Danh sách các field được phép sort khi list roles.
 */
export const ROLE_SORT_FIELDS = ['createdAt', 'roleCode', 'roleName'] as const;

export type RoleSortField = (typeof ROLE_SORT_FIELDS)[number];
