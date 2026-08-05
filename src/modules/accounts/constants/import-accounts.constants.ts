/**
 * Constants cho tính năng Tạo tài khoản nhân viên bằng import Excel.
 * Feature: ACCT-IMPORT-ACCOUNT-001 (UC-AM-02)
 */

export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2MB

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Sinh trắc học kèm import hàng loạt (tùy chọn) — mỗi ảnh khớp theo tên file =
 * employee_code (không phân biệt hoa/thường, bỏ phần đuôi mở rộng).
 * Giới hạn kích thước giống luồng tự nộp (`biometric-submission.service.ts`).
 */
export const MAX_BIOMETRIC_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

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
  BIOMETRIC_CONSENT_REQUIRED = 'BIOMETRIC_CONSENT_REQUIRED',
}

/**
 * Kết quả xử lý ảnh sinh trắc học kèm theo cho từng dòng import (chỉ có ý nghĩa
 * khi request có gửi kèm ảnh — nếu không dùng tính năng này thì field bỏ trống).
 */
export enum ImportAccountBiometricStatus {
  /** Có gửi ảnh nhưng không tìm thấy file khớp employee_code của dòng này. */
  NOT_PROVIDED = 'not_provided',
  /** Preview mode: đã khớp được ảnh, sẽ upload thật khi commit=true. */
  PENDING_COMMIT = 'pending_commit',
  /** Đã upload + tạo face_profiles (status=pending_review), chờ duyệt như luồng tự nộp. */
  ATTACHED = 'attached',
  /** Role của tài khoản không cần sinh trắc học (BUSINESS_ADMIN/SYSTEM_ADMIN) — bỏ qua. */
  ROLE_EXEMPT = 'role_exempt',
  /** File khớp tên nhưng không phải ảnh JPEG/PNG/WEBP hợp lệ (magic bytes). */
  INVALID_IMAGE = 'invalid_image',
  /** File khớp tên nhưng vượt quá MAX_BIOMETRIC_PHOTO_BYTES. */
  FILE_TOO_LARGE = 'file_too_large',
  /** Lỗi upload Cloudinary hoặc ghi DB — tài khoản vẫn được tạo thành công. */
  UPLOAD_FAILED = 'upload_failed',
}
