/**
 * Constants cho tính năng Tạo tài khoản nhân viên bằng import Excel.
 * Feature: ACCT-IMPORT-ACCOUNT-001 (UC-AM-02)
 */

export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2MB

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const ROLE_CODES_SEPARATOR = ';';

/**
 * Header chuẩn của template (đúng thứ tự cột trong sheet đầu tiên).
 */
export const IMPORT_ACCOUNTS_HEADERS = [
  'full_name',
  'email',
  'department_code',
  'role_codes',
  'employee_code',
  'phone_number',
  'position_title',
  'direct_manager_email',
] as const;

export enum ImportAccountMode {
  PREVIEW = 'preview',
  COMMIT = 'commit',
}

export enum ImportAccountRowStatus {
  VALID = 'valid',
  INVALID = 'invalid',
  SUCCESS = 'success',
  FAILED = 'failed',
}

/**
 * Mã lỗi cấp dòng.
 */
export enum ImportAccountRowReason {
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_EMAIL = 'INVALID_EMAIL',
  DUPLICATE_IN_FILE = 'DUPLICATE_IN_FILE',
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  EMPLOYEE_CODE_ALREADY_EXISTS = 'EMPLOYEE_CODE_ALREADY_EXISTS',
  DEPARTMENT_NOT_FOUND = 'DEPARTMENT_NOT_FOUND',
  ROLE_NOT_FOUND = 'ROLE_NOT_FOUND',
  MANAGER_NOT_FOUND = 'MANAGER_NOT_FOUND',
}

/**
 * Mã lỗi cấp request (toàn file).
 */
export enum ImportAccountRequestError {
  INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_TEMPLATE = 'INVALID_TEMPLATE',
  IMPORT_ROW_LIMIT_EXCEEDED = 'IMPORT_ROW_LIMIT_EXCEEDED',
}
