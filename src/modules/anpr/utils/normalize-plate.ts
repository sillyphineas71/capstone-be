/**
 * normalizePlate (VPR-001 / UC1 ANPR) — chuẩn hóa biển số để tra khớp.
 *
 * Phép biến đổi (theo thứ tự): trim → toUpperCase → strip mọi ký tự ngoài [A-Z0-9].
 * Ví dụ: "30A-123.45" → "30A12345".
 *
 * ⚠ KHÔNG map nhầm-lẫn O/0, I/1 — biển VN có vị trí chữ/số xác định, ép O→0/I→1 dễ gộp
 * nhầm 2 biển khác nhau. Xử nhầm lẫn OCR (nếu cần) ở UC4, KHÔNG ở đây.
 *
 * `null`/`undefined` → `''` (KHÔNG `String(undefined)` = "undefined" → "UNDEFINED" sau
 * uppercase — chuỗi trông như 1 biển số hợp lệ, dễ gây nhiễu log/biển-lạ nếu caller thiếu
 * field mà không có validation chặn trước). Hầu hết caller đã có `@IsNotEmpty()` ở DTO
 * (vd VehicleEventDto) nên nhánh này chỉ là phòng thủ — nhưng đây là single source of
 * truth dùng ở 12 chỗ trong module, không giả định mọi caller đều qua ValidationPipe.
 *
 * Pure function (KHÔNG phụ thuộc Nest) — UC4 (camera đọc biển) PHẢI gọi đúng hàm này
 * thì plate_number mới khớp DB. Single source of truth cho chuẩn hóa biển.
 */
export function normalizePlate(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
