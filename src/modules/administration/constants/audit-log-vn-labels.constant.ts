/**
 * Bảng ánh xạ tiếng Việt cho file xuất Excel nhật ký hệ thống
 * (Docs/Nam_Sent/be-audit-log-export-requirement.md, mục 2).
 *
 * CHỈ dùng cho renderer XLSX export — KHÔNG áp dụng cho response JSON của
 * GET /audit-logs (AuditLogItemDto vẫn trả raw actionType/entityType/severity).
 */

/** §2.A — Chuẩn hóa Hành động (Action Type). Key so khớp không phân biệt hoa/thường. */
export const ACTION_TYPE_VN_MAP: Record<string, string> = {
  LOGIN: 'Đăng nhập',
  LOGIN_FAILED: 'Đăng nhập thất bại',
  LOGOUT: 'Đăng xuất',
  CREATE_USER: 'Thêm tài khoản',
  UPDATE_USER: 'Cập nhật tài khoản',
  LOCK_USER: 'Khóa tài khoản',
  UNLOCK_USER: 'Mở khóa tài khoản',
  DELETE_USER: 'Xóa tài khoản',
  REGISTER_DEVICE: 'Đăng ký thiết bị',
  UPDATE_DEVICE: 'Cập nhật thiết bị',
  REMOVE_DEVICE: 'Vô hiệu hóa thiết bị',
  DEVICE_OFFLINE: 'Thiết bị mất kết nối',
  EXPORT_USERS: 'Xuất tệp nhân viên',
  UPDATE_CONFIG: 'Cập nhật cấu hình hệ thống',
};

/** §2.A fallback — từ khóa phổ biến dịch khi actionType không nằm trong bảng trên. */
const ACTION_TYPE_KEYWORD_FALLBACK: Array<[RegExp, string]> = [
  [/\bview detail\b/g, 'Xem chi tiết'],
  [/\bread analytics\b/g, 'Xem thống kê'],
  [/\bcreate\b/g, 'Tạo mới'],
  [/\bupdate\b/g, 'Cập nhật'],
  [/\bdelete\b/g, 'Xóa'],
];

/** §2.B — Chuẩn hóa Loại đối tượng (Entity Type). */
export const ENTITY_TYPE_VN_MAP: Record<string, string> = {
  auth: 'Hệ thống xác thực',
  users: 'Quản lý tài khoản',
  'iot-devices': 'Giám sát thiết bị IoT',
  rooms: 'Quản lý phòng họp',
  'system-configurations': 'Cấu hình hệ thống',
};

/** §2.C — Chuẩn hóa Mức độ nghiêm trọng (Severity). */
export const SEVERITY_VN_MAP: Record<string, string> = {
  info: 'Thành công',
  warning: 'Cảnh báo',
  error: 'Thất bại',
  critical: 'Nghiêm trọng',
};

/**
 * translateActionTypeToVn — tra bảng ACTION_TYPE_VN_MAP (không phân biệt hoa/thường);
 * nếu không khớp, áp dụng fallback §2.A: thường hóa, thay `_`/`-` bằng khoảng trắng,
 * dịch từ khóa phổ biến, viết hoa chữ cái đầu.
 */
export function translateActionTypeToVn(raw: string): string {
  const mapped = ACTION_TYPE_VN_MAP[raw.toUpperCase()];
  if (mapped) return mapped;

  let normalized = raw
    .toLowerCase()
    .replace(/[_.-]+/g, ' ')
    .trim();
  for (const [pattern, replacement] of ACTION_TYPE_KEYWORD_FALLBACK) {
    normalized = normalized.replace(pattern, replacement);
  }
  if (!normalized) return raw;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/** translateEntityTypeToVn — tra bảng ENTITY_TYPE_VN_MAP; giữ nguyên raw nếu không khớp. */
export function translateEntityTypeToVn(raw: string): string {
  return ENTITY_TYPE_VN_MAP[raw.toLowerCase()] ?? raw;
}

/** translateSeverityToVn — tra bảng SEVERITY_VN_MAP; giữ nguyên raw nếu không khớp. */
export function translateSeverityToVn(raw: string): string {
  return SEVERITY_VN_MAP[raw.toLowerCase()] ?? raw;
}
