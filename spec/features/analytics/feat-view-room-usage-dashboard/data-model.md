# Data Model: UC-AA-02 / UC-149 — Dashboard sử dụng phòng họp

## Entities (Read-only, không có entity mới)

- **rooms**: `id`, `roomCode`, `roomName`, `siteName`, `areaName`, `capacity`, `isActive`, `deletedAt`
- **room_bookings**: `id`, `meetingId`, `roomId`, `reservedStartTime`, `reservedEndTime`, `status`
- **room_booking_usages**: `bookingId`, `meetingId`, `roomId`, `actualStartTime`, `actualEndTime`, `firstPresenceAt`, `lastPresenceAt`
- **meetings**: `id`, `title`, `organizerId`, `roomId`, `status`
- **users**: `id`, `departmentId`
- **departments**: `id`, `managerUserId`
- **system_configs**: `analytics.room_operating_hours_per_day` (mới), `analytics.dashboard_max_range_days` (tái dùng từ UC-AA-01)

## Scope resolution (Manager) — phụ thuộc kỳ lọc

```
resolvedScopeRoomIds =
  IF role IN (SYSTEM_ADMIN, BUSINESS_ADMIN) -> NULL (không giới hạn)
  IF role = MANAGER ->
    SELECT DISTINCT rb.room_id
    FROM room_bookings rb
    JOIN meetings m ON m.id = rb.meeting_id
    JOIN users u ON u.id = m.organizer_id
    WHERE u.department_id IN (
      SELECT id FROM departments WHERE manager_user_id = :currentUserId
    )
    AND rb.reserved_start_time <= :to AND rb.reserved_end_time >= :from
    -- (khác UC-AA-01: scope phòng phụ thuộc từ/to đang truy vấn, không tĩnh)
```

Endpoint chi tiết phòng: nếu role MANAGER và `roomId` NOT IN `resolvedScopeRoomIds` (tính với đúng `from/to` của request đó) → 403 `ROOM_OUT_OF_SCOPE`.

## Công thức KPI

| KPI | Công thức | Ghi chú |
|---|---|---|
| `bookedHours` | `SUM(reserved_end_time - reserved_start_time)` của `room_bookings` trong scope + kỳ, `status IN ('approved','active','completed','released')` | Theo phòng, tính bằng giờ (phút/60) |
| `actualHours` | `SUM(actual_end_time - actual_start_time)`, fallback `SUM(last_presence_at - first_presence_at)` nếu thiếu actual, loại record thiếu cả hai | `null` nếu `hasActualData=false` |
| `hasActualData` | `true` nếu tồn tại ít nhất 1 `room_booking_usages` có actual/presence khác NULL trong kỳ, ngược lại `false` | Quyết định EX1 |
| `reservationUtilizationRate` | `bookedHours ÷ (operatingHoursPerDay × soNgay(from,to))  × 100` | Mẫu số 0 → 0. `operatingHoursPerDay` từ `system_configs` |
| `roomOccupancyRate` | `actualHours ÷ bookedHours × 100` (chỉ khi `hasActualData=true`) | Mẫu số 0 → 0; `null` nếu `hasActualData=false` |
| `heatmap[hourOfDay].actualMinutes` | Với mỗi `room_booking_usages` có actual/presence hợp lệ, tính khoảng `[usageStart, usageEnd]`; với mỗi giờ đồng hồ `h` (0-23) mà khoảng này chồng lấn (lặp qua từng ngày trong kỳ), cộng `overlapMinutes(usageStart, usageEnd, hourStart_h, hourEnd_h)` vào `heatmap[h]` | Ví dụ: phiên 9:30-11:15 cộng 30 phút vào bucket 9, 60 phút vào bucket 10, 15 phút vào bucket 11 |
| `trend[].meetingCount` | `COUNT(meetings)` group theo ngày trong scope tổng (không theo từng phòng) | Kế thừa tối giản từ UC-149 gốc |

## Data Constraints

- Không ghi/sửa/xóa bảng nguồn.
- Không thêm bảng/cột — chỉ 1 key `system_configs` mới (`analytics.room_operating_hours_per_day`).
- Mọi mẫu số = 0 → trả `0`, không `null`/`NaN` (trừ trường hợp `hasActualData=false` thì `actualHours`/`roomOccupancyRate` là `null` theo thiết kế, không phải do chia 0).

## Data Lifecycle

- Không có lifecycle riêng — tính lại toàn bộ mỗi request.
- `analytics.room_operating_hours_per_day` đọc theo precedence `system_configs → env → default 8`, không cache trong process.
