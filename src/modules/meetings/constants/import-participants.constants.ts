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
 * [2026-08-23] Template CHUẨN DUY NHẤT của hệ thống — 5 cột, KHÔNG có cột "Loại".
 * Trùng khít với file mẫu sinh ở màn Đặt lịch họp (BookMeeting.jsx -> downloadSampleExcel)
 * để người dùng chỉ học 1 định dạng: file tải ở booking upload thẳng vào Meeting Detail
 * được và ngược lại.
 *
 * Loại người tham dự được SUY RA tự động (giống booking): tra Email/Mã nhân viên trong
 * bảng users -> tìm thấy = nội bộ; không thấy = khách ngoài (khi đó "Họ và tên" là bắt buộc).
 *
 * `key`: field nội bộ dùng khi đọc/ghi dữ liệu.
 * `header`: tiêu đề hiển thị (tiếng Việt) trong file Excel.
 */
export const IMPORT_PARTICIPANTS_COLUMNS = [
  { key: 'email', header: 'Email' },
  { key: 'employee_code', header: 'Mã nhân viên' },
  { key: 'full_name', header: 'Họ và tên' },
  { key: 'organization_name', header: 'Tổ chức/Công ty' },
  { key: 'phone_number', header: 'Số điện thoại' },
] as const;

/**
 * Header chuẩn của template (đúng thứ tự cột trong sheet đầu tiên).
 */
export const IMPORT_PARTICIPANTS_HEADERS = IMPORT_PARTICIPANTS_COLUMNS.map(
  (c) => c.header,
);

/** Tên field nội bộ của 1 cột nhận diện được (gồm cả 2 cột legacy STT/Loại). */
export type ImportColumnKey =
  | 'stt'
  | 'type'
  | 'email'
  | 'employee_code'
  | 'full_name'
  | 'organization_name'
  | 'phone_number';

/**
 * Bản đồ tiêu đề cột -> field, dùng để đọc file theo TÊN cột thay vì theo vị trí.
 * Nhờ vậy BE đọc được cả:
 *   - template mới 5 cột (booking + Meeting Detail dùng chung),
 *   - template legacy 7 cột (STT, Loại, ...) đã phát cho người dùng trước 2026-08-23,
 *   - file bị đổi thứ tự cột.
 * Bất kỳ tiêu đề nào KHÔNG nằm trong bản đồ này đều bị coi là sai nguyên mẫu.
 */
export const IMPORT_PARTICIPANTS_HEADER_ALIASES: Record<
  string,
  ImportColumnKey
> = {
  // 5 cột chuẩn
  email: 'email',
  'mã nhân viên': 'employee_code',
  'họ và tên': 'full_name',
  'tổ chức/công ty': 'organization_name',
  'số điện thoại': 'phone_number',
  // Alias legacy / snake_case
  stt: 'stt',
  loại: 'type',
  type: 'type',
  employee_code: 'employee_code',
  full_name: 'full_name',
  'tổ chức': 'organization_name',
  'phòng ban/tổ chức': 'organization_name',
  organization_name: 'organization_name',
  phone_number: 'phone_number',
};

/**
 * Alias tiếng Việt cho giá trị cột "Loại" (chỉ còn dùng cho file legacy), bên cạnh
 * giá trị cũ (internal/external). Template mới không có cột này.
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
