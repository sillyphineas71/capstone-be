/**
 * ZONE_TYPES (ZNC-001 / UC-90) — danh sách loại khu vực hợp lệ.
 *
 * Bảng `zones` lưu `zone_type` dạng varchar(30), KHÔNG có CHECK constraint và KHÔNG có
 * PG enum (migration 20260721000001) ⇒ đây là chốt chặn DUY NHẤT cho giá trị hợp lệ.
 *
 * Chốt OQ-4: dùng `as const` + `@IsIn` (KHÔNG dùng TS `enum`) để giá trị trong code khớp
 * đúng chuỗi lowercase lưu ở DB. UC-91 (sửa zone) và UC-93 (tra cứu) PHẢI tái dùng đúng
 * hằng số này, không khai lại danh sách rời rạc.
 */
export const ZONE_TYPES = [
  'room',
  'gate',
  'corridor',
  'lobby',
  'parking',
] as const;

export type ZoneType = (typeof ZONE_TYPES)[number];
