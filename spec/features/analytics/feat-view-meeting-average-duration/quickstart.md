# Quickstart: UC-AA-06 / UC-153 — Thống kê thời lượng trung bình cuộc họp

## Test Scenarios

### Happy Path
1. Business Admin gọi API không tham số -> `granularity=week`, "Tháng hiện tại", toàn công ty, chỉ tính meeting `completed`.
2. Manager quản lý phòng ban X gọi API không truyền `departmentIds` -> chỉ tính meetings `completed` do phòng ban X tổ chức.
3. Truyền `granularity=quarter` -> `series` nhóm theo quý, label `"YYYY-Q#"`.
4. Truyền `departmentIds=[A,B]` -> chỉ tính meetings của 2 phòng ban A, B.
5. Truyền `roomId` -> chỉ tính meetings tại đúng phòng đó.
6. Meeting `completed` có booking 60 phút, actual 52 phút -> bucket tương ứng phản ánh đúng cả 2 giá trị.

### Validation
7. `granularity` không hợp lệ -> 400 `VALIDATION_ERROR`.
8. `departmentIds`/`roomId` không phải UUID -> 400 `VALIDATION_ERROR`.
9. `from > to` -> 400 `VALIDATION_ERROR`.
10. Range vượt `analytics.dashboard_max_range_days` -> 400 `DATE_RANGE_TOO_LARGE`.

### Authorization
11. Chưa đăng nhập -> 401.
12. Không có permission `analytics.meeting.read` -> 403 `PERMISSION_DENIED`.
13. Manager truyền `departmentIds` có phần tử ngoài phạm vi -> 403 `DEPARTMENT_OUT_OF_SCOPE`.

### Business Rules
14. Bucket không có meeting `completed` nào -> `plannedAverageMinutes=null`, `actualAverageMinutes=null`, `completedMeetingCount=0` — KHÔNG phải `0`.
15. Toàn bộ `[from,to]` không có dữ liệu -> `summary` toàn `null`, `series` đủ bucket theo #14, kèm `message` (EX1/EX2).
16. Meeting `status='scheduled'`/`cancelled`/`draft`/`pending_approval`/`in_progress` trong khoảng lọc -> KHÔNG được tính vào bất kỳ giá trị nào (Phương án A).
17. Meeting `completed` nhưng thiếu cả `actual_*` lẫn `presence_*` -> bị loại khỏi cả `plannedAverageMinutes` lẫn `actualAverageMinutes` của bucket đó (đồng bộ population).
18. Manager không quản lý phòng ban nào -> response rỗng như #15, không lỗi.
19. `summary.completedMeetingCount` luôn bằng `SUM(series[].completedMeetingCount)` khi có dữ liệu.
