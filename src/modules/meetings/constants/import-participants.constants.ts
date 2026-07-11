/**
 * Constants cho tính năng Import thành viên cuộc họp bằng Excel.
 * Feature: MEET-IMPORT-PARTICIPANT-001
 */

export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2MB

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Header chuẩn của template (đúng thứ tự cột trong sheet đầu tiên).
 */
export const IMPORT_PARTICIPANTS_HEADERS = [
  'type',
  'email',
  'employee_code',
  'full_name',
  'organization_name',
  'phone_number',
] as const;

export enum ImportParticipantType {
  INTERNAL = 'internal',
  EXTERNAL = 'external',
}

/**
 * Trạng thái của một dòng trong báo cáo import.
 */
export enum ImportRowStatus {
  VALID = 'valid',
  WARNING = 'warning',
  ERROR = 'error',
  SUCCESS = 'success',
  FAILED = 'failed',
}

/**
 * Mã lỗi/cảnh báo cấp dòng.
 */
export enum ImportRowReason {
  INVALID_ROW_TYPE = 'INVALID_ROW_TYPE',
  MISSING_IDENTIFIER = 'MISSING_IDENTIFIER',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  INVALID_EXTERNAL_ROW = 'INVALID_EXTERNAL_ROW',
  INVALID_EMAIL = 'INVALID_EMAIL',
  DUPLICATE_IN_FILE = 'DUPLICATE_IN_FILE',
  PARTICIPANT_ALREADY_EXISTS = 'PARTICIPANT_ALREADY_EXISTS',
  SCHEDULE_CONFLICT = 'SCHEDULE_CONFLICT',
  ROOM_CAPACITY_WARNING = 'ROOM_CAPACITY_WARNING',
  ROOM_CAPACITY_EXCEEDED = 'ROOM_CAPACITY_EXCEEDED',
}

/**
 * Mã lỗi cấp request (toàn file).
 */
export enum ImportRequestError {
  INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_TEMPLATE = 'INVALID_TEMPLATE',
  IMPORT_ROW_LIMIT_EXCEEDED = 'IMPORT_ROW_LIMIT_EXCEEDED',
  WARNING_CONFIRMATION_REQUIRED = 'WARNING_CONFIRMATION_REQUIRED',
}
