/**
 * normalizeZoneCode (ZNC-001 / UC-90) — chuẩn hóa mã khu vực để tra khớp.
 *
 * Phép biến đổi (theo thứ tự): trim → toUpperCase. HẾT.
 *
 * ⚠ KHÔNG strip ký tự như `normalizePlate` bên ANPR: `zone_code` do quản trị viên đặt và
 * thường mang dấu phân tách có nghĩa (`GATE-01`, `B1_LOBBY`). Strip `[^A-Z0-9]` sẽ gộp nhầm
 * `GATE-01` với `GATE01` — hai khu vực khác nhau. Cũng KHÔNG bỏ dấu tiếng Việt.
 *
 * Pure function (KHÔNG phụ thuộc Nest) — single source of truth cho chuẩn hóa `zone_code`.
 * UC-91 (đổi mã) và UC-93 (tra cứu) PHẢI gọi đúng hàm này, nếu không giá trị sẽ không khớp
 * bản ghi đã lưu và partial unique `UQ_zones_code_active` sẽ chặn/lọt sai.
 */
export function normalizeZoneCode(raw: string): string {
  return String(raw).trim().toUpperCase();
}
