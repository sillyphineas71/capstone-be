# Quickstart: UC-AA-04 / UC-151 — Thống kê số lượng cuộc họp theo khoảng thời gian

## Test Scenarios

### Happy Path
1. Business Admin gọi API không tham số -> `granularity=week` mặc định, khoảng "Tháng hiện tại", toàn công ty.
2. Manager quản lý phòng ban X gọi API không truyền `departmentId` -> chỉ đếm meetings do phòng ban X tổ chức.
3. Truyền `granularity=month` -> `series` nhóm theo tháng, label `"YYYY-MM"`.
4. Truyền `from`/`to` là 6 tháng -> `series` đủ bucket theo granularity trong 6 tháng đó.
5. Truyền `roomId` -> chỉ đếm meetings tại đúng phòng đó.
6. Truyền `meetingType=training` -> chỉ đếm đúng loại cuộc họp đó.
7. (AF1) Truyền `from`/`to` là tháng kế tiếp (tương lai) -> `series` chỉ phản ánh các `meetings.status='scheduled'` đã đặt lịch, không có giá trị suy đoán/dự báo nào ngoài dữ liệu thật.

### Validation
8. `granularity` không hợp lệ -> 400 `VALIDATION_ERROR`.
9. `meetingType` không hợp lệ -> 400 `VALIDATION_ERROR`.
10. `departmentId`/`roomId` không phải UUID -> 400 `VALIDATION_ERROR`.
11. `from > to` -> 400 `VALIDATION_ERROR`.
12. Range vượt `analytics.dashboard_max_range_days` -> 400 `DATE_RANGE_TOO_LARGE`.

### Authorization
13. Chưa đăng nhập -> 401.
14. Không có permission `analytics.meeting.read` -> 403 `PERMISSION_DENIED`.
15. Manager truyền `departmentId` ngoài phạm vi quản lý -> 403 `DEPARTMENT_OUT_OF_SCOPE`.

### Business Rules
16. Tổ hợp filter không có dữ liệu nào trong `[from,to]` -> `total=0`, `series` đủ bucket với `count=0` mỗi bucket, kèm `message` (EX1) — KHÔNG trả `series=[]`.
17. Tồn tại meeting `status='cancelled'` hoặc `'in_progress'` trong khoảng lọc -> KHÔNG được tính vào `total`/`series` (Phương án A, BR1).
18. Tồn tại meeting `status='draft'`/`'pending_approval'` -> KHÔNG được tính (BR1).
19. `total` luôn bằng tổng `series[].count` trong mọi kịch bản.
20. Manager không quản lý phòng ban nào -> response rỗng như #16, không lỗi.
