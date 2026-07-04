# Quickstart: UC-AA-05 / UC-152 — Thống kê cuộc họp theo trạng thái

## Test Scenarios

### Happy Path
1. Business Admin gọi API không tham số -> `preset=month` mặc định, `items` đủ 4 nhóm, toàn công ty.
2. Manager quản lý phòng ban X gọi API không truyền `departmentIds` -> chỉ đếm meetings do phòng ban X tổ chức.
3. Truyền `preset=week` -> `from/to` tự tính đúng tuần hiện tại.
4. Truyền `preset=custom&from=...&to=...` -> dùng đúng range custom.
5. Truyền `departmentIds=[A,B]` -> chỉ đếm meetings của 2 phòng ban A, B.

### Phân loại (precedence)
6. Meeting `status='cancelled'` -> đếm vào "Cancelled", bất kể có `no_show_cases` hay không.
7. Meeting `status='scheduled'` có `no_show_cases.detection_status='confirmed'` -> đếm vào "No-show", KHÔNG đếm vào "Scheduled".
8. Meeting `status='completed'` có `no_show_cases.detection_status='confirmed'` (trường hợp hiếm/dữ liệu bất thường) -> vẫn đếm vào "No-show" theo đúng precedence (no-show ưu tiên trước completed).
9. Meeting `status='scheduled'`, không có `no_show_cases` nào -> đếm vào "Scheduled".
10. Meeting `status='completed'`, không có `no_show_cases` -> đếm vào "Completed" (không cần kiểm tra attendance — Phương án A).
11. Meeting `status IN ('draft','pending_approval','in_progress')` -> KHÔNG đếm vào bất kỳ nhóm nào, không tính vào `total`.
12. Meeting request bị approver reject (`meetings.status` chuyển `cancelled`) -> đếm vào "Cancelled".

### Validation
13. `preset` không hợp lệ -> 400 `VALIDATION_ERROR`.
14. `preset=custom` thiếu `to` -> 400 `VALIDATION_ERROR`.
15. Phần tử trong `departmentIds` không phải UUID -> 400 `VALIDATION_ERROR`.
16. Range vượt `analytics.dashboard_max_range_days` -> 400 `DATE_RANGE_TOO_LARGE`.

### Authorization
17. Chưa đăng nhập -> 401.
18. Không có permission `analytics.meeting.read` -> 403 `PERMISSION_DENIED`.
19. Manager truyền `departmentIds` có phần tử ngoài phạm vi quản lý -> 403 `DEPARTMENT_OUT_OF_SCOPE`.

### Business Rules
20. Tổ hợp filter không có meeting nào -> `total=0`, `items` đủ 4 nhóm `count=0, percentage=0`, kèm `message` (EX1).
21. `total` luôn bằng `SUM(items[].count)`; tổng `percentage` xấp xỉ 100 khi `total>0`.
22. Manager không quản lý phòng ban nào -> response rỗng như #20, không lỗi.
