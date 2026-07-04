# Quickstart: UC-AA-07 / UC-154 — Thống kê tỷ lệ cuộc họp bị hủy

## Test Scenarios

### Happy Path

1. Business Admin gọi API không tham số -> `preset=month_current`, `granularity=week`, toàn công ty, trả `totalMeetingCount`/`cancelledCount`/`cancelRate`/`series`/`topOrganizers`/`topDepartments`.
2. Manager quản lý phòng ban X gọi API không truyền `departmentIds` -> chỉ tính meetings do phòng ban X tổ chức; `topDepartments=[]` luôn luôn.
3. Truyền `preset=month_previous` -> `from`/`to` tự tính đúng tháng trước.
4. Truyền `preset=quarter` -> `from`/`to` tự tính đúng quý dương lịch hiện tại.
5. Truyền `departmentIds=[A,B]` -> chỉ tính meetings của 2 phòng ban A, B.
6. Truyền `roomId` -> chỉ tính meetings tại đúng phòng đó.
7. Truyền `organizerEmail` hợp lệ và có tồn tại -> chỉ tính meetings do đúng organizer đó tổ chức.
8. Organizer A tổ chức 5 meeting, 3 bị hủy -> xuất hiện trong `topOrganizers` với `cancelledCount=3, organizedCount=5, cancelRate=60`.

### Validation

9. `preset` không hợp lệ -> 400 `VALIDATION_ERROR`.
10. `preset=custom` thiếu `from`/`to` hoặc `from > to` -> 400 `VALIDATION_ERROR`.
11. `granularity` không hợp lệ -> 400 `VALIDATION_ERROR`.
12. `departmentIds`/`roomId` không phải UUID -> 400 `VALIDATION_ERROR`.
13. `organizerEmail` sai định dạng email -> 400 `VALIDATION_ERROR`.
14. Range vượt `analytics.dashboard_max_range_days` -> 400 `DATE_RANGE_TOO_LARGE`.

### Authorization

15. Chưa đăng nhập -> 401.
16. Không có permission `analytics.meeting.read` -> 403 `PERMISSION_DENIED`.
17. Manager truyền `departmentIds` có phần tử ngoài phạm vi quản lý -> 403 `DEPARTMENT_OUT_OF_SCOPE`.

### Business Rules

18. Organizer B chỉ tổ chức 1 meeting và bị hủy (`cancelRate=100%`) -> **KHÔNG** xuất hiện trong `topOrganizers` do `organizedCount=1 < 3` (ngưỡng chống nhiễu).
19. Meeting bị approver reject (`status` chuyển `cancelled`, actor thực hiện ≠ organizer) -> vẫn tính vào `cancelledCount` của **organizer gốc**, không phải của approver.
20. `organizerEmail` không khớp bất kỳ user nào -> trả response rỗng như #21 (EX1), không phải lỗi 400/404.
21. Tổ hợp filter không có meeting nào (`status <> 'draft'`) trong `[from,to]` -> `totalMeetingCount=0`, `series` đủ bucket giá trị 0, `topOrganizers=[]`, `topDepartments=[]`, kèm `message`.
22. Manager không quản lý phòng ban nào -> response rỗng như #21, không lỗi.
23. `totalMeetingCount = SUM(series[].totalCount)` và `cancelledCount = SUM(series[].cancelledCount)` luôn khớp trong cùng 1 response.
24. Currently role = MANAGER -> `topDepartments` luôn `[]` dù có đủ dữ liệu (verify không rò rỉ dữ liệu phòng ban khác).
