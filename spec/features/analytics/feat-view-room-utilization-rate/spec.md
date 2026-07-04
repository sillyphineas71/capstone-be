# Feature Specification: Xem thống kê tỷ lệ sử dụng phòng tổng hợp

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo spec lần đầu cho UC-AA-08 / UC-155 Xem thống kê tỷ lệ sử dụng phòng tổng hợp. Đã phân tích, liệt kê điểm mơ hồ, đề xuất phương án và được người dùng duyệt 4 quyết định chính (tái dùng tên/công thức chỉ số của UC-AA-02, `roomOccupancyRate` = actual÷booked, mô hình kỳ đối chiếu 3 chế độ, delta theo % thay đổi tương đối) trước khi viết spec (xem §0 RECON). Các điểm mơ hồ nhỏ còn lại chốt theo phương án khuyến nghị (người dùng không phản đối). | Toàn bộ file |

---

- **Feature ID**: AA-ROOM-UTILIZATION-RATE-001
- **Feature Name**: Xem thống kê tỷ lệ sử dụng phòng tổng hợp (View Aggregate Room Utilization Rate)
- **Use Case**: UC-AA-08 Xem thống kê tỷ lệ sử dụng phòng tổng hợp (= UC-155 trong API Contract)
- **Module / Domain**: analytics
- **Created Date**: 2026-07-02
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của người dùng — mô tả UC-AA-08 (actor, trigger, precondition, postcondition, normal/alternative flow, exception, business rules)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — mục 16 UC-155 (endpoint/response mẫu, **thiếu hoàn toàn khái niệm kỳ đối chiếu/delta**)
  - `database_v3_2_compact_39_tables.md` — `rooms`, `room_bookings`, `room_booking_usages`, `meetings`, `users`, `departments`
  - `spec/features/analytics/feat-view-room-usage-dashboard/spec.md` (UC-AA-02 / UC-149) — tái dùng nguyên định nghĩa `reservationUtilizationRate`/`roomOccupancyRate`, `analytics.room_operating_hours_per_day`, scope Manager động theo kỳ lọc
  - `spec/features/analytics/feat-view-meeting-average-duration/spec.md` (UC-AA-06) — tham chiếu pattern `granularity` mở rộng `quarter`
  - `spec/features/analytics/feat-view-dashboard-overview/spec.md` (UC-AA-01) — tái dùng config `analytics.dashboard_max_range_days`, response envelope
  - `.specify/memory/constitution.md`, `CLAUDE.md`

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. Khoảng trống lớn nhất: `API_CONTRACT` UC-155 không có khái niệm "kỳ đối chiếu"

Response mẫu UC-155 gốc chỉ có 1 kỳ (`utilizationRate/bookedHours/actualUsedHours/availableHours/byRoom[]`), không có kỳ đối chiếu, không có % delta, không có trend đa đường. Toàn bộ Normal Flow của UC-AA-08 (bước 2-6, ưu tiên cao nhất theo `CLAUDE.md` mục 1) xoay quanh so sánh song song 2 kỳ. **Quyết định đã duyệt**: mở rộng thẳng response UC-155 hiện có thêm cấu trúc kỳ đối chiếu + delta + trend đa đường, không tách endpoint mới (nhất quán cách xử lý các khoảng trống tương tự ở UC-AA-01/05/07).

### 0.2. Quan hệ với UC-AA-02 — giữ 2 endpoint riêng, tái dùng nguyên định nghĩa chỉ số — đã duyệt

UC-AA-02 (UC-149, `GET /api/v1/analytics/rooms/dashboard`) là bảng so sánh **giữa các phòng** trong 1 kỳ (không có delta/kỳ đối chiếu). UC-AA-08 (UC-155, `GET /api/v1/analytics/rooms/utilization-rate`) là KPI tổng hợp **theo thời gian**, so sánh 2 kỳ, không có bảng xếp hạng phòng. API_CONTRACT đã tách sẵn 2 endpoint khác nhau nên không cần quyết định gộp/tách như các UC trước. **Quyết định đã duyệt**: tái dùng nguyên 2 tên chỉ số + công thức đã chốt ở [feat-view-room-usage-dashboard/spec.md §0.3](../feat-view-room-usage-dashboard/spec.md):
- `reservationUtilizationRate` = `bookedHours ÷ availableHours` ("Tỷ lệ khai thác đặt phòng tổng hợp").
- `roomOccupancyRate` = `actualHours ÷ bookedHours` ("Tỷ lệ lấp đầy phòng thực tế tổng hợp").

Không định nghĩa chỉ số thứ 3 kiểu `actualHours ÷ availableHours` — tránh thêm 1 khái niệm "utilization" nữa gây nhầm lẫn (đã có 3 tên khác nhau cho 3 công thức khác nhau xuyên suốt UC-AA-01/02/08: `utilizationRate` (UC-AA-01, actual÷booked, KHÔNG đổi), `reservationUtilizationRate` + `roomOccupancyRate` (UC-AA-02/08, tái dùng)).

### 0.3. Mô hình "kỳ đối chiếu" — 3 chế độ — đã duyệt

**Quyết định đã duyệt**: `comparisonMode IN ('previous_period', 'same_period_last_year', 'custom')`.
- `previous_period` (mặc định): kỳ liền trước, cùng độ dài với kỳ hiện tại (vd kỳ hiện tại = tháng hiện tại → kỳ đối chiếu = tháng trước; kỳ hiện tại = 10 ngày bất kỳ → kỳ đối chiếu = 10 ngày liền trước đó).
- `same_period_last_year`: cùng khoảng ngày/tháng nhưng lùi đúng 1 năm (khớp ví dụ Normal Flow "Quý này" vs "Quý này năm ngoái").
- `custom`: người dùng tự truyền `comparisonFrom`/`comparisonTo` độc lập.

### 0.4. Bắt buộc 2 kỳ cùng độ dài khi `comparisonMode=custom` — đã duyệt

Để biểu đồ đa đường so sánh có ý nghĩa (trục X là chỉ số tương đối, không phải ngày lịch thật — xem §0.7), **quyết định**: nếu `comparisonMode=custom`, số ngày của `[comparisonFrom, comparisonTo]` phải bằng đúng số ngày của `[from, to]` (kỳ hiện tại), nếu không → `400 VALIDATION_ERROR`.

### 0.5. Công thức % delta trên thẻ KPI — % thay đổi tương đối — đã duyệt

**Quyết định đã duyệt**: `deltaPercent = (current - comparison) / comparison × 100`, làm tròn 1 chữ số thập phân. Đây là % thay đổi tương đối (vd current=68%, comparison=60% → `deltaPercent=+13.3`), không phải chênh lệch điểm phần trăm (`+8`).

### 0.6. Delta khi kỳ đối chiếu không có dữ liệu (mẫu số = 0) — đã duyệt

Khi `comparison = 0` (hoặc kỳ đối chiếu không phát sinh `room_bookings` nào trong scope — đúng EX1), **quyết định**: `deltaPercent = null` (không phải `Infinity`/lỗi chia 0), kèm cờ `comparisonHasNoData = true` ở cấp `summary`. FE dựa vào cờ này để hiển thị đúng thông báo EX1 ("Không tìm thấy dữ liệu vận hành hợp lệ của chu kỳ đối chiếu được chọn.") thay vì số delta vô nghĩa.

### 0.7. Trục X biểu đồ đa đường — chỉ số tương đối, không phải ngày lịch thật — đã duyệt

Khi kỳ hiện tại và kỳ đối chiếu là 2 khoảng ngày lịch khác nhau (đặc biệt `same_period_last_year`, lệch nguyên 1 năm), vẽ theo ngày lịch thật sẽ khiến 2 đường không chồng khít để so sánh. **Quyết định đã duyệt**: `trend[]` dùng chỉ số tương đối làm nhãn bucket (`"Ngày 1"`, `"Ngày 2"`... hoặc `"Tuần 1"`, `"Tuần 2"`...), mỗi bucket chứa cả 2 giá trị KPI của **cả 2 kỳ** (kỳ hiện tại + kỳ đối chiếu) để FE vẽ tối đa 4 đường chồng lên nhau (2 chỉ số × 2 kỳ) trên cùng 1 trục X tương đối.

### 0.8. EX1 — kỳ đối chiếu không có dữ liệu — đã duyệt

Khi kỳ đối chiếu không phát sinh `room_bookings` nào trong scope: mọi bucket `trend[].comparison.*` = `0` (đường nằm ngang mức 0 đúng theo mô tả EX1), `summary.*.comparison = 0`, `summary.*.deltaPercent = null`, `comparisonHasNoData = true`, kèm `message` đúng nguyên văn cảnh báo trong EX1.

### 0.9. `granularity` trend — tách biệt khỏi `preset`, mặc định tự chọn theo độ dài kỳ

**Quyết định đã duyệt**: `granularity IN ('day', 'week')`. Nếu không truyền: tự chọn `day` khi kỳ hiện tại ≤ 31 ngày, `week` khi dài hơn. Người dùng có thể ép buộc giá trị khác qua query param.

### 0.10. `preset` kỳ hiện tại — mở rộng thêm `quarter`

Normal Flow ví dụ "Quý này" cho kỳ hiện tại. **Quyết định**: `preset IN ('day', 'week', 'month', 'quarter', 'custom')`, mặc định `month` (đúng "Tháng hiện tại" — Normal Flow bước 2). Đây là preset của **kỳ hiện tại**, độc lập hoàn toàn với `comparisonMode` của kỳ đối chiếu (§0.3).

### 0.11. Phạm vi "Toàn bộ hệ thống" với role MANAGER — đã duyệt

BR1: Manager chỉ mặc định xem phạm vi phòng ban mình quản lý. **Quyết định**: với MANAGER, lựa chọn "Toàn bộ hệ thống" ở FE thực chất luôn bị giới hạn trong phạm vi phòng Manager quản lý (tái dùng nguyên scope động theo kỳ lọc đã chốt ở [feat-view-room-usage-dashboard/spec.md §0.1](../feat-view-room-usage-dashboard/spec.md)) — Manager không có cách nào (kể cả qua tham số) để xem dữ liệu ngoài phạm vi của mình. Chỉ `BUSINESS_ADMIN`/`SYSTEM_ADMIN` mới thấy đúng nghĩa "toàn công ty".

### 0.12. Scope Manager dựa trên kỳ nào khi có 2 kỳ song song — đã duyệt

**Quyết định**: scope phòng của Manager chỉ suy ra từ **kỳ hiện tại** (không union với kỳ đối chiếu). Nếu 1 phòng nằm ngoài scope hiện tại nhưng có dữ liệu ở kỳ đối chiếu, dữ liệu phòng đó vẫn bị loại khỏi cả 2 kỳ (nhất quán, tránh rò rỉ dữ liệu phòng ban khác qua "cửa sau" kỳ đối chiếu).

### 0.13. Không lặp lại heatmap/danh sách meeting của UC-AA-02 — đã duyệt

Normal Flow bước 5 cho phép chọn "Phòng họp cụ thể" nhưng đây chỉ là **filter thu hẹp KPI+trend về 1 phòng**, không phải drill-down. **Quyết định**: không trả `heatmap`/`meetings[]` ở feature này — người dùng cần xem chi tiết khung giờ/danh sách cuộc họp của 1 phòng thì dùng endpoint `{roomId}/detail` đã có sẵn ở UC-AA-02.

### 0.14. Bỏ `byRoom[]` khỏi response — đã duyệt

Response mẫu UC-155 gốc có `byRoom[]` (bảng nhỏ theo từng phòng) — không khớp Normal Flow UC-AA-08 (chỉ "Toàn hệ thống" HOẶC "1 phòng cụ thể", không phải bảng nhiều phòng). **Quyết định**: bỏ hẳn `byRoom[]`, việc so sánh giữa các phòng đã có UC-AA-02 đảm nhiệm.

### 0.15. `availableHours` khi scope nhiều phòng — công thức mở rộng từ UC-AA-02

**Quyết định**: `availableHours = operatingHoursPerDay × số_ngày_trong_kỳ × số_phòng_active_trong_scope` — tái dùng nguyên key `analytics.room_operating_hours_per_day` đã tạo ở UC-AA-02, chỉ nhân thêm số phòng khi scope > 1 phòng (khi lọc `roomId` cụ thể, số phòng = 1, công thức thu về đúng như UC-AA-02).

### 0.16. Field/entity xác nhận tồn tại thật (không suy đoán)

- `RoomEntity`: `id, roomCode, roomName, siteName, areaName, capacity, roomType, isActive`.
- `RoomBookingEntity`: `meetingId, roomId, reservedStartTime, reservedEndTime, status` (lọc `IN ('approved','active','completed','released')`, đúng UC-AA-02).
- `RoomBookingUsageEntity`: `bookingId, meetingId, roomId, actualStartTime, actualEndTime, firstPresenceAt, lastPresenceAt`.
- `MeetingEntity`: `id, organizerId, roomId, deletedAt`.
- `DepartmentEntity.managerUserId`, `UserEntity.departmentId` — scope Manager động, tái dùng UC-AA-02.
- `SystemConfigEntity` — tái dùng `analytics.room_operating_hours_per_day` (UC-AA-02) và `analytics.dashboard_max_range_days` (UC-AA-01), không tạo key mới.
- **Không có bảng/cột nào cần thêm.**

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `analytics`, cung cấp báo cáo tổng hợp toàn hệ thống (hoặc 1 phòng cụ thể) về hiệu quả khai thác không gian, dưới dạng thẻ KPI (kèm % thay đổi so với kỳ đối chiếu) và biểu đồ xu hướng đa đường so sánh song song 2 kỳ. Tính năng **read-only tuyệt đối**.

### 1.2 Mục tiêu

Cho phép Manager (giới hạn phòng ban phụ trách, scope động theo kỳ lọc), Business Admin, System Admin xem 2 chỉ số tổng hợp (`reservationUtilizationRate`, `roomOccupancyRate`) của kỳ hiện tại đối chiếu với 1 kỳ khác (kỳ trước, cùng kỳ năm ngoái, hoặc tự chọn), theo phạm vi toàn hệ thống hoặc 1 phòng cụ thể.

### 1.3 Giá trị mang lại

- Cho Manager: theo dõi xu hướng khai thác phòng ban mình đang cải thiện hay xấu đi qua từng kỳ.
- Cho Business Admin/System Admin: đánh giá hiệu quả sử dụng không gian toàn công ty theo thời gian, hỗ trợ quyết định đầu tư/thu hẹp phòng họp.

### 1.4 Giả định

- Tái dùng nguyên định nghĩa `reservationUtilizationRate`/`roomOccupancyRate` đã chốt ở UC-AA-02, không định nghĩa chỉ số thứ 3 — §0.2.
- Kỳ đối chiếu hỗ trợ 3 chế độ, mặc định `previous_period` — §0.3.
- Delta tính theo % thay đổi tương đối, `null` khi mẫu số kỳ đối chiếu = 0 — §0.5, §0.6.
- `trend[]` dùng trục X tương đối, không phải ngày lịch thật — §0.7.
- Scope Manager suy ra từ kỳ hiện tại, không union kỳ đối chiếu — §0.12.
- Không có heatmap/danh sách meeting/bảng theo từng phòng ở feature này — §0.13, §0.14.

### 1.5 Clarifications Resolved

Toàn bộ điểm mơ hồ đã liệt kê và người dùng duyệt (4 quyết định chính về tái dùng định nghĩa UC-AA-02, công thức `roomOccupancyRate`, mô hình kỳ đối chiếu, công thức delta), cùng các phương án khuyến nghị còn lại không bị phản đối — tổng hợp tại §0.1–§0.15.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager / Approver | Quản lý cấp phòng ban | Xem KPI + trend giới hạn trong phạm vi phòng Manager quản lý (scope động theo kỳ hiện tại) |
| Business Admin | Quản trị viên doanh nghiệp | Xem KPI + trend toàn công ty hoặc lọc theo `roomId` bất kỳ |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin (nhất quán UC-AA-02, API_CONTRACT UC-155 có `SYSTEM_ADMIN`) |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Permission bắt buộc: `analytics.room.read` (dùng chung với UC-AA-02, đã seed).
- `SYSTEM_ADMIN`/`BUSINESS_ADMIN`: không giới hạn scope phòng.
- `MANAGER`: scope phòng = tập `room_id` xuất hiện trong `room_bookings` của `meetings` do phòng ban mình quản lý tổ chức, trong đúng **kỳ hiện tại** đang truy vấn (§0.12, tái dùng UC-AA-02 §0.1). "Toàn bộ hệ thống" với Manager luôn hiểu là phạm vi này (§0.11).
  - Truyền `roomId` ngoài scope → 403 `ROOM_OUT_OF_SCOPE`.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `analytics.room.read`.
- Scope Manager xác định qua `departments.manager_user_id = currentUser.id`, không rollup phòng ban con (nhất quán UC-AA-01/02).

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về toàn bộ dữ liệu dưới dạng read-only — không tạo/sửa/xóa bất kỳ bản ghi nào trong `rooms`, `room_bookings`, `room_booking_usages`, `meetings`.

FR-002: THE system SHALL tính toán lại toàn bộ chỉ số của cả kỳ hiện tại lẫn kỳ đối chiếu trực tiếp từ dữ liệu nguồn (on-demand aggregation) tại mỗi lần gọi API.

FR-003: THE system SHALL dùng đúng 2 chỉ số `reservationUtilizationRate` (`bookedHours ÷ availableHours`) và `roomOccupancyRate` (`actualHours ÷ bookedHours`) theo định nghĩa đã chốt ở UC-AA-02, không định nghĩa chỉ số mới.

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu GET /api/v1/analytics/rooms/utilization-rate, THE system SHALL kiểm tra authentication và permission `analytics.room.read` trước khi xử lý logic khác.

FR-005: WHEN người dùng không truyền `preset`/`from`/`to`, THE system SHALL áp dụng mặc định `preset='month'` (Tháng hiện tại, timezone `Asia/Ho_Chi_Minh`) cho kỳ hiện tại.

FR-006: WHEN người dùng truyền `preset IN ('day','week','month','quarter')`, THE system SHALL tự tính `from`/`to` của kỳ hiện tại tương ứng, bỏ qua `from`/`to` nếu có truyền kèm.

FR-007: WHEN người dùng truyền `preset='custom'` kèm `from`/`to` hợp lệ, THE system SHALL dùng đúng khoảng đó làm kỳ hiện tại.

FR-008: WHEN người dùng không truyền `comparisonMode`, THE system SHALL áp dụng mặc định `comparisonMode='previous_period'`.

FR-009: WHEN `comparisonMode='previous_period'`, THE system SHALL tự tính kỳ đối chiếu là khoảng liền trước kỳ hiện tại, cùng độ dài (số ngày).

FR-010: WHEN `comparisonMode='same_period_last_year'`, THE system SHALL tự tính kỳ đối chiếu là đúng khoảng `[from,to]` của kỳ hiện tại nhưng lùi 1 năm.

FR-011: WHEN `comparisonMode='custom'` kèm `comparisonFrom`/`comparisonTo` hợp lệ và cùng số ngày với kỳ hiện tại, THE system SHALL dùng đúng khoảng đó làm kỳ đối chiếu.

FR-012: WHEN người dùng truyền `roomId`, THE system SHALL lọc cả kỳ hiện tại lẫn kỳ đối chiếu chỉ còn đúng 1 phòng đó (vẫn áp scope Manager nếu có).

FR-013: WHEN người dùng không truyền `granularity`, THE system SHALL tự chọn `day` nếu kỳ hiện tại ≤ 31 ngày, ngược lại `week`.

FR-014: WHEN người dùng truyền `granularity IN ('day','week')`, THE system SHALL nhóm `trend` theo đúng đơn vị đó cho cả 2 kỳ.

### 3.3 State-driven Requirements

FR-015: WHILE kỳ đối chiếu không phát sinh bất kỳ `room_bookings` nào trong scope, THE system SHALL trả `comparisonHasNoData=true`, mọi giá trị `comparison.*`/`trend[].comparison.*` = `0`, `deltaPercent=null` cho cả 2 chỉ số, kèm `message` đúng EX1 ("Không tìm thấy dữ liệu vận hành hợp lệ của chu kỳ đối chiếu được chọn.").

FR-016: WHILE kỳ hiện tại không phát sinh bất kỳ `room_bookings` nào trong scope, THE system SHALL trả toàn bộ `current.*`/`trend[].current.*` = `0`, kèm `message` mô tả không có dữ liệu.

FR-017: WHILE 1 phòng (hoặc toàn scope) không có bất kỳ `room_booking_usages` nào có dữ liệu thực tế trong 1 kỳ, THE system SHALL trả `actualHours=null`, `roomOccupancyRate=null` cho kỳ đó (đúng nguyên tắc EX1 của UC-AA-02), không ảnh hưởng `reservationUtilizationRate`.

### 3.4 Optional Feature Requirements

FR-018: WHERE `roomId` được cung cấp, THE system SHALL áp dụng như filter bổ sung sau khi đã áp scope theo role, cho cả 2 kỳ.

### 3.5 Unwanted Behavior Requirements

FR-019: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-020: IF người dùng không có permission `analytics.room.read`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-021: IF currentUser có role MANAGER và `roomId` không thuộc scope phòng của Manager trong kỳ hiện tại, THEN THE system SHALL trả về 403, error code `ROOM_OUT_OF_SCOPE`.

FR-022: IF `preset` không thuộc {day, week, month, quarter, custom}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-023: IF `preset='custom'` nhưng thiếu `from`/`to`, hoặc `from > to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-024: IF `comparisonMode` không thuộc {previous_period, same_period_last_year, custom}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-025: IF `comparisonMode='custom'` nhưng thiếu `comparisonFrom`/`comparisonTo`, hoặc `comparisonFrom > comparisonTo`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-026: IF `comparisonMode='custom'` và số ngày của `[comparisonFrom,comparisonTo]` khác số ngày của `[from,to]`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-027: IF `granularity` không thuộc {day, week}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-028: IF `roomId` không phải UUID hợp lệ, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-029: IF khoảng `to - from` (kỳ hiện tại) vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL trả về 400, error code `DATE_RANGE_TOO_LARGE`.

FR-030: IF `roomId` được truyền nhưng không tồn tại hoặc `deleted_at IS NOT NULL`, THEN THE system SHALL trả về 404, error code `ROOM_NOT_FOUND`.

### 3.6 Authorization Requirements

FR-031: WHEN the user performs a protected action (xem thống kê tỷ lệ sử dụng phòng tổng hợp), THE system SHALL verify authentication và authorization trước khi thực thi aggregation query.

FR-032: WHILE currentUser đang ở scope MANAGER, THE system SHALL áp scope phòng (suy ra từ kỳ hiện tại, §0.12) cho MỌI truy vấn (`room_bookings`, `room_booking_usages`, `meetings`) ở cả 2 kỳ.

### 3.7 Data & State Requirements

FR-033: WHEN tính `bookedHours` cho 1 kỳ, THE system SHALL tính `SUM(reserved_end_time - reserved_start_time)` của `room_bookings` trong scope + kỳ đó có `status IN ('approved','active','completed','released')`.

FR-034: WHEN tính `actualHours` cho 1 kỳ, THE system SHALL tính `SUM(thời lượng thực tế)` của `room_booking_usages`, ưu tiên `actual_end_time - actual_start_time`, fallback `last_presence_at - first_presence_at`, loại bản ghi thiếu cả hai — đúng nguyên tắc UC-AA-01/02.

FR-035: WHEN tính `availableHours` cho 1 kỳ, THE system SHALL tính `operatingHoursPerDay × số_ngày_trong_kỳ × số_phòng_active_trong_scope` (§0.15).

FR-036: WHEN tính `reservationUtilizationRate` cho 1 kỳ, THE system SHALL tính `bookedHours ÷ availableHours × 100`, làm tròn 1 chữ số thập phân. Mẫu số 0 → trả `0`.

FR-037: WHEN tính `roomOccupancyRate` cho 1 kỳ (nếu có dữ liệu thực tế), THE system SHALL tính `actualHours ÷ bookedHours × 100`, làm tròn 1 chữ số thập phân. Mẫu số 0 → trả `0`.

FR-038: WHEN tính `deltaPercent` cho mỗi chỉ số, THE system SHALL tính `(current - comparison) ÷ comparison × 100`, làm tròn 1 chữ số thập phân. Nếu `comparison=0` hoặc `null` → trả `deltaPercent=null` (FR-015).

FR-039: WHEN tính `trend`, THE system SHALL nhóm dữ liệu của cả 2 kỳ theo `granularity` thành các bucket có cùng chỉ số tương đối (Ngày 1/Ngày 2.../Tuần 1/Tuần 2...), mỗi bucket trả về `{index, current: {reservationUtilizationRate, roomOccupancyRate}, comparison: {reservationUtilizationRate, roomOccupancyRate}}`.

### 3.8 Notification / Audit Requirements

FR-040: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN yêu cầu hoàn tất thành công, THE system SHALL ghi audit log non-blocking `action_type='read_analytics_room_utilization_rate'`, `entity_type='rooms'`, `metadata_json` chứa tối thiểu `{viewerUserId, viewerRole, from, to, comparisonMode, comparisonFrom, comparisonTo, roomId?, resolvedScopeRoomIds}`.

### 3.9 Complex / Combined Requirements

FR-041: WHILE currentUser có role MANAGER, WHEN scope phòng trong kỳ hiện tại rỗng, THE system SHALL trả về response rỗng như FR-016 thay vì lỗi.

FR-042: WHERE `to - from` (kỳ hiện tại) vượt `analytics.dashboard_max_range_days`, IF request vẫn được gửi, THEN THE system SHALL từ chối tại tầng validate DTO trước khi chạm tới bất kỳ truy vấn tổng hợp nào.

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-AA-08 POST-2, BR1, §0.2 |
| FR-004–FR-014 | Event-driven | UC-AA-08 Normal Flow bước 1-5 |
| FR-015–FR-017 | State-driven | UC-AA-08 EX1, §0.6, §0.8 |
| FR-018 | Optional Feature | UC-AA-08 Normal Flow bước 5 |
| FR-019–FR-030 | Unwanted Behavior | UC-AA-08 BR1, validation |
| FR-031, FR-032 | Authorization | UC-AA-08 BR1 |
| FR-033–FR-039 | Data & State | UC-AA-08 Normal Flow bước 3-4, 6 |
| FR-040 | Notification/Audit | Pattern audit đã dùng ở UC-AA-01/02/07 |
| FR-041, FR-042 | Complex | BR1 + range guard |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về kết quả trong vòng dưới 3 giây cho khoảng thời gian mặc định (tháng hiện tại + tháng trước) trong điều kiện tải bình thường.

NFR-002: IF khoảng thời gian truy vấn (kỳ hiện tại) vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL từ chối tại tầng validate (FR-029) trước khi chạy aggregation.

### 4.2 Security

NFR-003: THE system SHALL yêu cầu authentication cho mọi request.

NFR-004: THE system SHALL enforce scope phòng Manager ở tầng service cho cả 2 kỳ, không chỉ dựa vào FE.

### 4.3 Reliability & Consistency

NFR-005: THE system SHALL đảm bảo `summary.*.current` luôn bằng `SUM(trend[].current.*)` theo đúng công thức trọng số (không phải trung bình cộng đơn giản của các bucket).

NFR-006: THE system SHALL sử dụng index sẵn có trên `room_bookings(room_id)`, `room_bookings(reserved_start_time, reserved_end_time)`, `room_booking_usages(room_id)`.

### 4.4 Usability

NFR-007: THE system SHALL trả về clear error messages và field names dạng camelCase.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `rooms` | Xác định số phòng active trong scope (`availableHours`) | Không có `department_id` |
| `room_bookings` | `bookedHours` cho cả 2 kỳ | Loại status pending/cancelled |
| `room_booking_usages` | `actualHours` cho cả 2 kỳ | Fallback presence nếu thiếu actual |
| `meetings` | Xác định scope Manager (`organizer_id`) | |
| `users`, `departments` | Resolve scope Manager | Tái dùng UC-AA-01/02 |
| `system_configs` | `analytics.room_operating_hours_per_day` (UC-AA-02), `analytics.dashboard_max_range_days` (UC-AA-01) | Không tạo key mới |

### 5.2 Dữ liệu đầu vào

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| preset | string | Không | `day`/`week`/`month`/`quarter`/`custom` cho kỳ hiện tại, mặc định `month` | Enum hợp lệ |
| from | date | Chỉ khi `preset=custom` | Bắt đầu kỳ hiện tại | ISO date |
| to | date | Chỉ khi `preset=custom` | Kết thúc kỳ hiện tại | ISO date, `to>=from`, range ≤ max |
| comparisonMode | string | Không | `previous_period`/`same_period_last_year`/`custom`, mặc định `previous_period` | Enum hợp lệ |
| comparisonFrom | date | Chỉ khi `comparisonMode=custom` | Bắt đầu kỳ đối chiếu | ISO date, cùng số ngày với kỳ hiện tại |
| comparisonTo | date | Chỉ khi `comparisonMode=custom` | Kết thúc kỳ đối chiếu | ISO date, `comparisonTo>=comparisonFrom` |
| roomId | UUID | Không | Lọc 1 phòng cụ thể | UUID hợp lệ, tồn tại |
| granularity | string | Không | `day`/`week` cho `trend`, mặc định tự chọn theo độ dài kỳ | Enum hợp lệ |

### 5.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| currentPeriod.from/to | date | Khoảng thời gian kỳ hiện tại |
| comparisonPeriod.from/to | date | Khoảng thời gian kỳ đối chiếu |
| comparisonHasNoData | boolean | `true` nếu kỳ đối chiếu không có `room_bookings` nào (EX1) |
| summary.reservationUtilizationRate.current/comparison/deltaPercent | number/number/number\|null | FR-036, FR-038 |
| summary.roomOccupancyRate.current/comparison/deltaPercent | number\|null/number\|null/number\|null | FR-037, FR-038 |
| summary.bookedHours.current/comparison | number | FR-033 |
| summary.actualHours.current/comparison | number\|null | FR-034 |
| summary.availableHours.current/comparison | number | FR-035 |
| trend[].index | string | Nhãn bucket tương đối (`"Ngày 1"`, `"Tuần 1"`...) |
| trend[].current.reservationUtilizationRate/roomOccupancyRate | number | FR-039 |
| trend[].comparison.reservationUtilizationRate/roomOccupancyRate | number | FR-039, `0` nếu `comparisonHasNoData` |
| message | string (optional) | Khi kỳ hiện tại hoặc kỳ đối chiếu rỗng (FR-015/FR-016) |

### 5.4 Data Constraints

- Không ghi/sửa/xóa bảng nguồn.
- Không thêm bảng/cột/config key mới.
- Không trả `heatmap`/`meetings[]`/`byRoom[]` — ngoài phạm vi feature này (§0.13, §0.14).
- Mẫu số = 0 → trả `0` cho rate, `null` cho `deltaPercent`.

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN resolving scope phòng cho MANAGER, THE system SHALL tái dùng đúng query đã có ở [feat-view-room-usage-dashboard/spec.md FR-DATA-001](../feat-view-room-usage-dashboard/spec.md), áp dụng cho khoảng `[from,to]` của **kỳ hiện tại**.

FR-DATA-002: WHEN đọc `operatingHoursPerDay`, THE system SHALL áp dụng đúng precedence đã có `system_configs['analytics.room_operating_hours_per_day'] → env → default 8` (tái dùng UC-AA-02, không tạo key mới).

FR-DATA-003: WHEN tính `comparisonPeriod` cho `same_period_last_year`, THE system SHALL lùi cả `from` và `to` đúng 1 năm dương lịch (giữ nguyên ngày/tháng).

### 5.6 Cần làm rõ

- **CL-1**: `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-155 hiện chưa có `comparisonMode`/`comparisonPeriod`/`deltaPercent`/`trend[]` dạng 2-kỳ, và có `byRoom[]` đã bị loại bỏ — cần task đồng bộ tài liệu riêng.
- **CL-2**: `same_period_last_year` khi ngày biên là 29/2 (năm nhuận) lùi về năm không nhuận — dùng quy tắc chuẩn thư viện ngày tháng (thường dịch về 28/2), chấp nhận rủi ro biên hiếm gặp này, không xử lý đặc biệt.
- **CL-3**: `availableHours` nhân theo "số phòng active trong scope" (§0.15) giả định số phòng không đổi trong suốt kỳ lọc — nếu phòng bị vô hiệu hóa (`is_active=false`) giữa kỳ, tính đơn giản theo trạng thái `is_active` tại thời điểm gọi API, không truy hồi lịch sử trạng thái phòng.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `preset` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `preset=custom` thiếu `from`/`to` hoặc `from>to`, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `comparisonMode` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF `comparisonMode=custom` thiếu `comparisonFrom`/`comparisonTo` hoặc `comparisonFrom>comparisonTo`, THEN 400 `VALIDATION_ERROR`.
ERR-005: IF độ dài kỳ đối chiếu khác độ dài kỳ hiện tại (khi `comparisonMode=custom`), THEN 400 `VALIDATION_ERROR`.
ERR-006: IF `granularity` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-007: IF `roomId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-008: IF range kỳ hiện tại vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.

### 6.2 Authentication / Authorization Errors

ERR-009: IF chưa đăng nhập, THEN 401.
ERR-010: IF không có permission `analytics.room.read`, THEN 403 `PERMISSION_DENIED`.
ERR-011: IF MANAGER truyền `roomId` ngoài scope kỳ hiện tại, THEN 403 `ROOM_OUT_OF_SCOPE`.

### 6.3 Business Rule Errors

ERR-012: IF `roomId` không tồn tại/soft-deleted, THEN 404 `ROOM_NOT_FOUND`.

### 6.4 System Errors

ERR-013: IF lỗi truy vấn hệ thống, THEN 500 `INTERNAL_ERROR`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When gọi API không tham số,
Then hệ thống trả về KPI + trend của "Tháng hiện tại" đối chiếu "Tháng trước" (previous_period), toàn công ty.

AC-002:
Given Manager quản lý phòng ban "Kỹ thuật",
When Manager gọi API không truyền `roomId`,
Then hệ thống chỉ tính trên các phòng thuộc scope phòng ban "Kỹ thuật" trong kỳ hiện tại, cho cả kỳ hiện tại lẫn kỳ đối chiếu.

AC-003:
Given `comparisonMode=same_period_last_year`, kỳ hiện tại = "Quý 3/2026",
When gọi API,
Then `comparisonPeriod` = "Quý 3/2025" (đúng khoảng ngày/tháng, lùi 1 năm).

### 7.2 Validation & Authorization Cases

AC-004:
Given `comparisonMode=custom`, kỳ hiện tại 30 ngày nhưng `comparisonFrom`/`comparisonTo` chỉ 20 ngày,
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR` (ERR-005).

AC-005:
Given Manager truyền `roomId` chưa từng được phòng ban mình đặt trong kỳ hiện tại,
When gọi API,
Then hệ thống reject 403 `ROOM_OUT_OF_SCOPE`.

### 7.3 Business Rule Cases

AC-006:
Given kỳ đối chiếu không phát sinh `room_bookings` nào trong scope,
When gọi API,
Then `comparisonHasNoData=true`, `trend[].comparison.*` toàn bộ = `0`, `deltaPercent=null` cho cả 2 chỉ số, kèm `message` đúng EX1.

AC-007:
Given kỳ hiện tại `reservationUtilizationRate=68%`, kỳ đối chiếu `reservationUtilizationRate=60%`,
When gọi API,
Then `deltaPercent = round((68-60)/60*100, 1) = 13.3` (không phải `8`).

AC-008:
Given Manager không có phòng nào trong scope kỳ hiện tại,
When gọi API,
Then trả về response rỗng như FR-016, không lỗi.

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-008, FR-009, FR-033-FR-039 |
| AC-002 | FR-032, FR-DATA-001 |
| AC-003 | FR-010, FR-DATA-003 |
| AC-004 | FR-026, ERR-005 |
| AC-005 | FR-021, ERR-011 |
| AC-006 | FR-015, FR-038 |
| AC-007 | FR-038 |
| AC-008 | FR-016, FR-041 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Bảng so sánh giữa các phòng (`byRoom[]`) — đã có sẵn ở UC-AA-02, không lặp lại (§0.14).
- Heatmap/danh sách meeting chi tiết 1 phòng — đã có sẵn ở endpoint `{roomId}/detail` của UC-AA-02 (§0.13).
- Định nghĩa chỉ số "utilization" thứ 3 (`actualHours ÷ availableHours`) — đã chọn tái dùng đúng 2 chỉ số hiện có (§0.2).
- Lịch làm việc/ngày lễ riêng cho `availableHours` — kế thừa giới hạn đã ghi nhận ở UC-AA-02 CL-1.
- Rollup phòng ban con cho scope Manager.
- WebSocket push/invalidate.
- Xuất báo cáo (.xlsx) — nếu cần, tái dùng UC-49 như đã quyết định ở UC-AA-02, không viết lại ở đây.

### 8.2 Có thể xem xét ở feature khác

- Đồng bộ `API_CONTRACT_v1.0_with_system_roles.md` với `comparisonMode`/`comparisonPeriod`/`deltaPercent`/`trend[]` mới, loại bỏ `byRoom[]` khỏi tài liệu (CL-1).
- Hỗ trợ nhiều kỳ đối chiếu cùng lúc (hiện chỉ 1 kỳ đối chiếu) nếu phát sinh yêu cầu.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT return a byRoom[] breakdown array as part of this feature's response.
OOS-002: THE system SHALL NOT return heatmap or meetings[] detail as part of this feature's response.
OOS-003: THE system SHALL NOT define a third utilization metric beyond reservationUtilizationRate and roomOccupancyRate.
OOS-004: THE system SHALL NOT roll up Manager room scope to parent or child departments.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS, đủ 5 pattern cơ bản + Complex.
- [x] Mỗi requirement có mã ID rõ ràng, có traceability.
- [x] Error handling bao gồm validation, authentication, authorization, business rule, system error.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Out of Scope có EARS guardrails.
- [x] Không tự ý thêm bảng/cột/config key database mới.
- [x] Các điểm thiếu thông tin đưa vào mục 5.6 "Cần làm rõ".
