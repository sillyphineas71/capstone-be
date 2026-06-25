/**
 * Danh sách moduleCode được phép sử dụng khi tạo permission.
 * Validate input CreatePermissionDto.moduleCode theo allowlist này.
 * Cập nhật khi có module mới.
 */
export const MODULE_CODE_ALLOWLIST = [
  'auth',
  'accounts',
  'meetings',
  'meeting_requests',
  'approvals',
  'scheduling',
  'rooms',
  'equipment',
  'iot',
  'attendance',
  'presence',
  'utilization',
  'live_meeting',
  'recording',
  'transcription',
  'minutes',
  'notifications',
  'reports',
  'analytics',
  'administration',
  'admin',
  'internal',
  'system',
] as const;

export type ModuleCode = (typeof MODULE_CODE_ALLOWLIST)[number];
