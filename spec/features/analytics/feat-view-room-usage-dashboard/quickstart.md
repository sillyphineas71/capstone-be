# Quickstart: UC-AA-02 / UC-149 — Dashboard sử dụng phòng họp

## Test Scenarios

### Happy Path
1. Business Admin gọi endpoint so sánh tổng quan không tham số -> mặc định `preset=month`, toàn bộ phòng active.
2. Manager quản lý phòng ban X, phòng ban X đã đặt phòng A/B trong kỳ -> chỉ trả A/B.
3. Bất kỳ role nào truyền `preset=day|week` -> range tự tính đúng theo timezone Asia/Ho_Chi_Minh.
4. Truyền `preset=custom&from=...&to=...` -> dùng đúng range custom.
5. Truyền `roomId` -> chỉ trả đúng 1 phòng (vẫn áp scope).
6. Truyền `siteName` -> lọc đúng theo tòa nhà.
7. Gọi endpoint chi tiết phòng với `roomId` hợp lệ trong scope -> trả `room`, 4 chỉ số, `heatmap` 24 phần tử, danh sách `meetings`.

### Validation
8. `preset` không hợp lệ -> 400 `VALIDATION_ERROR`.
9. `preset=custom` thiếu `to` -> 400 `VALIDATION_ERROR`.
10. `from > to` -> 400 `VALIDATION_ERROR`.
11. Range vượt `analytics.dashboard_max_range_days` -> 400 `DATE_RANGE_TOO_LARGE`.
12. `roomId` không tồn tại/soft-deleted (endpoint chi tiết) -> 404 `ROOM_NOT_FOUND`.

### Authorization
13. Chưa đăng nhập -> 401.
14. Không có permission `analytics.room.read` -> 403 `PERMISSION_DENIED`.
15. Manager gọi chi tiết phòng ngoài scope (phòng ban mình không đặt phòng đó trong kỳ) -> 403 `ROOM_OUT_OF_SCOPE`.

### Business Rules
16. Phòng chưa có dữ liệu actual/presence trong kỳ -> `actualHours=null`, `roomOccupancyRate=null`, `hasActualData=false`; `bookedHours`/`reservationUtilizationRate` vẫn có giá trị (EX1).
17. Manager không có phòng nào trong scope kỳ hiện tại -> `rooms=[]`, không lỗi.
18. `bookedHours`/`actualHours`/rate khi mẫu số=0 -> trả `0`, không `NaN`, không 500.
19. Booking kéo dài qua nhiều khung giờ (vd 9:30-11:15) -> heatmap cộng đúng phút chồng lấn vào từng bucket 9/10/11, không dồn hết vào 1 bucket.
20. Phòng trong scope tháng 6 nhưng không có booking nào tháng 7 (phòng ban không đặt) -> tháng 7 Manager không thấy phòng đó trong danh sách, đúng theo định nghĩa scope phụ thuộc kỳ lọc.

### Export (tái dùng UC-49, không code trong feature này)
21. FE lấy `roomIds` đang hiển thị + `from/to` đang lọc để gọi `POST /api/v1/rooms/usage-report/exports` (UC-49 có sẵn) khi người dùng bấm "Xuất dữ liệu" — không cần test lại logic export ở đây.
