/**
 * Constants cho tính năng Import thành viên cuộc họp bằng Excel.
 * Feature: MEET-IMPORT-PARTICIPANT-001
 */

export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2MB

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export enum ImportParticipantType {
  INTERNAL = 'internal',
  EXTERNAL = 'external',
}

/**
 * Cột chuẩn của template (đúng thứ tự cột trong sheet đầu tiên).
 * `key`: field nội bộ dùng khi đọc/ghi dữ liệu.
 * `header`: tiêu đề hiển thị (tiếng Việt) trong file Excel.
 */
export const IMPORT_PARTICIPANTS_COLUMNS = [
  { key: 'stt', header: 'STT' },
  { key: 'type', header: 'Loại' },
  { key: 'email', header: 'Email' },
  { key: 'employee_code', header: 'Mã nhân viên' },
  { key: 'full_name', header: 'Họ và tên' },
  { key: 'organization_name', header: 'Tổ chức' },
  { key: 'phone_number', header: 'Số điện thoại' },
] as const;

/**
 * Header chuẩn của template (đúng thứ tự cột trong sheet đầu tiên).
 */
export const IMPORT_PARTICIPANTS_HEADERS = IMPORT_PARTICIPANTS_COLUMNS.map(
  (c) => c.header,
);

/**
 * Alias tiếng Việt cho giá trị cột "Loại", bên cạnh giá trị cũ (internal/external).
 */
export const IMPORT_PARTICIPANT_TYPE_ALIASES: Record<
  string,
  ImportParticipantType
> = {
  internal: ImportParticipantType.INTERNAL,
  external: ImportParticipantType.EXTERNAL,
  'nội bộ': ImportParticipantType.INTERNAL,
  'khách ngoài': ImportParticipantType.EXTERNAL,
};

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
  ROLE_NOT_ALLOWED = 'ROLE_NOT_ALLOWED',
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
