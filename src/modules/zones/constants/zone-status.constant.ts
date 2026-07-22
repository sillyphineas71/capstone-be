/**
 * ZONE_STATUSES (ZNU-001 / UC-91) — trạng thái hợp lệ của khu vực.
 *
 * - `active`   — khu vực đang sử dụng (giá trị mặc định khi tạo, xem DB DEFAULT).
 * - `inactive` — khu vực NGỪNG sử dụng. **FT-20 (điểm danh cổng) / FT-21 (hiện diện khu vực)
 *   sau này PHẢI tôn trọng**: không nhận event mới cho zone `inactive`. **UC-91 KHÔNG
 *   implement việc chặn đó** — mới chỉ ghi nhận trạng thái.
 *
 * Cột `zones.status` là `varchar(30)` **KHÔNG CHECK, KHÔNG enum** (migration 20260721000001)
 * ⇒ mở rộng thêm giá trị sau **không cần migration**, chỉ sửa hằng số này (và cập nhật nơi
 * validate). Đây cũng là lý do đây là chốt chặn DUY NHẤT cho giá trị hợp lệ.
 *
 * Mirror style `zone-type.constant.ts`: `as const` + `@IsIn`, KHÔNG dùng TS `enum`.
 */
export const ZONE_STATUSES = ['active', 'inactive'] as const;

export type ZoneStatus = (typeof ZONE_STATUSES)[number];
