/**
 * Constants cho tính năng Import Excel tài khoản Đối tác/Khách hàng tạm thời.
 * Feature: PTA-IMPORT-001
 */

export const MAX_PARTNER_IMPORT_ROWS = 50;
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2MB

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Ảnh sinh trắc học bắt buộc cho tài khoản đối tác — mỗi ảnh khớp theo tên file =
 * email (không phân biệt hoa/thường, bỏ phần đuôi mở rộng).
 * Giới hạn kích thước 5MB.
 */
export const MAX_BIOMETRIC_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Ảnh sinh trắc học gộp trong 1 file .zip — giới hạn kích thước zip 100MB,
 * tổng giải nén 250MB (chặn zip-bomb).
 */
export const MAX_PHOTOS_ZIP_BYTES = 100 * 1024 * 1024; // 100MB (nén)
export const MAX_PHOTOS_ZIP_TOTAL_UNCOMPRESSED_BYTES = 250 * 1024 * 1024; // 250MB (chặn zip bomb)

/**
 * Header chuẩn của template Excel tài khoản đối tác (đúng thứ tự cột trong sheet đầu tiên).
 */
export const IMPORT_PARTNER_HEADERS = [
  'full_name',
  'email',
  'account_expires_at',
  'phone_number',
  'license_plate',
] as const;

export enum ImportPartnerAccountMode {
  PREVIEW = 'preview',
  COMMIT = 'commit',
}

export enum ImportPartnerAccountRowStatus {
  VALID = 'valid',
  INVALID = 'invalid',
  SUCCESS = 'success',
  FAILED = 'failed',
}

/**
 * Mã lỗi cấp dòng trong báo cáo import tài khoản đối tác.
 */
export enum ImportPartnerAccountRowReason {
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_EMAIL = 'INVALID_EMAIL',
  DUPLICATE_IN_FILE = 'DUPLICATE_IN_FILE',
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  INVALID_ACCOUNT_EXPIRES_AT = 'INVALID_ACCOUNT_EXPIRES_AT',
  MISSING_ACCOUNT_EXPIRES_AT = 'MISSING_ACCOUNT_EXPIRES_AT',
  ACCOUNT_EXPIRES_AT_MUST_BE_FUTURE = 'ACCOUNT_EXPIRES_AT_MUST_BE_FUTURE',
  PARTNER_PHOTO_REQUIRED = 'PARTNER_PHOTO_REQUIRED',
  PARTNER_PHOTO_INVALID_IMAGE = 'PARTNER_PHOTO_INVALID_IMAGE',
  PARTNER_PHOTO_TOO_LARGE = 'PARTNER_PHOTO_TOO_LARGE',
}

/**
 * Mã lỗi cấp request (toàn file) cho API import đối tác.
 */
export enum ImportPartnerAccountRequestError {
  INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_TEMPLATE = 'INVALID_TEMPLATE',
  IMPORT_ROW_LIMIT_EXCEEDED = 'IMPORT_ROW_LIMIT_EXCEEDED',
  INVALID_PHOTOS_ZIP = 'INVALID_PHOTOS_ZIP',
  INVALID_DEFAULT_EXPIRES_IN_DAYS = 'INVALID_DEFAULT_EXPIRES_IN_DAYS',
}
