# Quickstart: UC-AA-01 / UC-148 — Dashboard tổng quan hệ thống

## Test Scenarios

### Happy Path
1. Business Admin gọi API không truyền `from`/`to` -> KPI + trend tính trên 30 ngày gần nhất, toàn hệ thống.
2. System Admin gọi API với `from`/`to` tùy ý -> KPI + trend đúng khoảng đó, toàn hệ thống.
3. Manager quản lý 1 phòng ban gọi API không truyền `departmentId` -> KPI + trend chỉ tính trên phòng ban đó.
4. Manager truyền `departmentId` đúng phòng ban mình quản lý -> KPI + trend đúng phòng ban đó.
5. Bất kỳ role nào truyền thêm `roomId` -> KPI + trend chỉ tính trên phòng đó (trong scope đã áp).

### Validation
6. `from` sai định dạng ISO date -> 400 `VALIDATION_ERROR`.
7. `from > to` -> 400 `VALIDATION_ERROR`.
8. `departmentId`/`roomId` không phải UUID -> 400 `VALIDATION_ERROR`.
9. `to - from` vượt `analytics.dashboard_max_range_days` -> 400 `DATE_RANGE_TOO_LARGE`.

### Authorization
10. Chưa đăng nhập -> 401.
11. Đã đăng nhập nhưng không có permission `analytics.overview.read` -> 403 `PERMISSION_DENIED`.
12. Manager truyền `departmentId` ngoài phòng ban mình quản lý -> 403 `DEPARTMENT_OUT_OF_SCOPE`.

### Business Rules
13. Khoảng thời gian không có `meetings` nào trong scope -> tất cả KPI = 0, `trend = []` (EX1).
14. Manager không quản lý phòng ban nào, không truyền `departmentId` -> response rỗng như #13, KHÔNG phải lỗi.
15. `utilizationRate` khi có `room_booking_usages` thiếu cả `actual_*` lẫn `first/last_presence_at` -> bản ghi đó không được tính vào tử số (không suy diễn).
16. `noShowRate`/`onTimeRate`/`utilizationRate` khi mẫu số = 0 -> trả về `0`, không lỗi 500, không `NaN`.
17. Gọi lại API ngay sau khi có `attendance_records` mới phát sinh trong scope (cùng khoảng thời gian) -> số liệu phản ánh dữ liệu mới nhất (real-time on-demand, không cache).

### Response Shape
18. Response luôn có đủ 9 field cấp 1: `period`, `meetingCount`, `activeRooms`, `utilizationRate`, `noShowRate`, `onTimeRate`, `recordingCount`, `activeUserCount`, `trend`.
19. `trend` chứa đủ mỗi ngày trong `[from,to]`, kể cả ngày `meetingCount = 0`.
