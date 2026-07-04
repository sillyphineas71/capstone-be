# Data Model: UC-AA-01 / UC-148 — Dashboard tổng quan hệ thống

## Entities (Read-only, không có entity mới)

- **meetings**: `id`, `organizerId`, `hostId`, `roomId`, `status`, `startTime`, `endTime`, `deletedAt`
- **users**: `id`, `departmentId`
- **departments**: `id`, `managerUserId`
- **meeting_participants**: `meetingId`, `userId`, `invitationStatus`
- **room_bookings**: `id`, `meetingId`, `roomId`, `status`, `reservedStartTime`, `reservedEndTime`
- **room_booking_usages**: `bookingId`, `meetingId`, `roomId`, `reservedStartTime`, `reservedEndTime`, `actualStartTime`, `actualEndTime`, `firstPresenceAt`, `lastPresenceAt`, `usageStatus`
- **no_show_cases**: `bookingId`, `meetingId`, `roomId`, `detectionStatus`
- **attendance_records**: `meetingId`, `userId`, `isPresent`, `isLate`, `attendanceStatus`
- **recording_sessions**: `meetingId`, `startedAt`
- **system_configs**: `configKey='analytics.dashboard_max_range_days'`, `configValue`, `configGroup='analytics'`

## Scope resolution (Manager)

```
resolvedScopeDepartmentIds =
  IF role IN (SYSTEM_ADMIN, BUSINESS_ADMIN) -> NULL (không giới hạn)
  IF role = MANAGER ->
    SELECT id FROM departments WHERE manager_user_id = :currentUserId
    -- nếu departmentId query param được truyền: phải thuộc tập trên, nếu không -> 403 DEPARTMENT_OUT_OF_SCOPE
    -- nếu không truyền: dùng toàn bộ tập trên; nếu tập rỗng -> trả dashboard rỗng (không lỗi)
```

Mọi truy vấn KPI join `meetings.organizer_id = users.id AND users.department_id IN (resolvedScopeDepartmentIds)` khi `resolvedScopeDepartmentIds` khác NULL. `roomId` (nếu có) là điều kiện `AND` bổ sung, áp dụng sau scope.

## Công thức KPI

| KPI | Tử số | Mẫu số | Ghi chú |
|---|---|---|---|
| `meetingCount` | — | — | `COUNT(meetings)` trong scope, `start_time BETWEEN from,to`, `status <> 'draft'`, `deleted_at IS NULL` |
| `activeRooms` | — | — | `COUNT(DISTINCT room_bookings.room_id)` gắn với `meetings` trong scope trong kỳ |
| `utilizationRate` | `SUM(actual_minutes)` | `SUM(reserved_end_time - reserved_start_time)` | `actual_minutes` ưu tiên `actual_end_time - actual_start_time`, fallback `last_presence_at - first_presence_at`, fallback `0` nếu cả hai đều NULL. Nhân 100, mẫu số 0 → 0 |
| `noShowRate` | `COUNT(no_show_cases.detection_status IN ('confirmed','released'))` | `COUNT(room_bookings.status IN ('approved','active','completed','released'))` | Nhân 100, mẫu số 0 → 0 |
| `onTimeRate` | `COUNT(attendance_records WHERE is_present=true AND is_late=false)` | `COUNT(attendance_records WHERE attendance_status IN ('present','late'))` | Nhân 100, mẫu số 0 → 0 |
| `activeUserCount` | — | — | `COUNT(DISTINCT userId)` là `organizer_id` HOẶC `meeting_participants.user_id` (`invitation_status <> 'declined'`) của meetings trong scope |
| `recordingCount` | — | — | `COUNT(recording_sessions)` có `meeting_id` trong scope, `started_at BETWEEN from,to` |
| `trend[].meetingCount` | — | — | Như `meetingCount` nhưng group theo từng ngày trong `[from,to]` |
| `trend[].utilizationRate` | — | — | Như `utilizationRate` nhưng group theo từng ngày |

## Data Constraints

- Không ghi/sửa/xóa bất kỳ bảng nào ở trên.
- Không thêm bảng/cột — chỉ đọc `system_configs` cho 1 key cấu hình mới (`analytics.dashboard_max_range_days`), không phải bảng mới.
- Mọi mẫu số = 0 phải trả về `0` cho KPI tương ứng, không chia cho 0 / không trả `null`/`NaN`.

## Data Lifecycle

- Không có lifecycle riêng — dữ liệu luôn tính lại (recompute) từ trạng thái hiện tại của các bảng nguồn tại thời điểm request.
- `system_configs['analytics.dashboard_max_range_days']` đọc mỗi request theo precedence `system_configs → env → default 366`, không cache trong process.
