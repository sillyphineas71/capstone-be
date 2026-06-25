/**
 * normalizePlate (VPR-001 / UC1 ANPR) — chuẩn hóa biển số để tra khớp.
 *
 * Phép biến đổi (theo thứ tự): trim → toUpperCase → strip mọi ký tự ngoài [A-Z0-9].
 * Ví dụ: "30A-123.45" → "30A12345".
 *
 * ⚠ KHÔNG map nhầm-lẫn O/0, I/1 — biển VN có vị trí chữ/số xác định, ép O→0/I→1 dễ gộp
 * nhầm 2 biển khác nhau. Xử nhầm lẫn OCR (nếu cần) ở UC4, KHÔNG ở đây.
 *
 * Pure function (KHÔNG phụ thuộc Nest) — UC4 (camera đọc biển) PHẢI gọi đúng hàm này
 * thì plate_number mới khớp DB. Single source of truth cho chuẩn hóa biển.
 */
export function normalizePlate(raw: string): string {
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
