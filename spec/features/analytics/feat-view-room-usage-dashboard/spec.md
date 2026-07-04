# Feature Specification: Xem dashboard sử dụng phòng họp

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo spec lần đầu cho UC-AA-02 / UC-149 Xem dashboard sử dụng phòng họp. Đã liệt kê điểm mơ hồ, đề xuất phương án và được người dùng duyệt trước khi viết spec (xem §0 RECON). | Toàn bộ file |
| 2026-07-02 | Sửa FR-031: heatmap phải phân bổ phút theo tỷ lệ chồng lấn thực tế giữa phiên sử dụng và từng khung giờ đồng hồ (không gán toàn bộ vào giờ bắt đầu) — phát hiện khi viết research.md | Mục 3.8 FR-031 |

---

- **Feature ID**: AA-ROOM-USAGE-DASHBOARD-001
- **Feature Name**: Xem dashboard sử dụng phòng họp (View Room Usage Dashboard)
- **Use Case**: UC-AA-02 Xem dashboard sử dụng phòng họp (= UC-149 trong API Contract cho phần so sánh tổng quan; phần drill-down chi tiết phòng là bổ sung mới — xem §0)
- **Module / Domain**: analytics
- **Created Date**: 2026-07-02
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của người dùng — mô tả UC-AA-02 (actor, trigger, precondition, postcondition, normal/alternative flow, exception, business rules)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — mục 16 UC-149 (so sánh tổng quan), UC-49 (xuất báo cáo, module `reports`)
  - `database_v3_2_compact_39_tables.md` — `rooms`, `room_bookings`, `room_booking_usages`, `meetings`, `users`, `departments`
  - `spec/features/analytics/feat-view-dashboard-overview/` (UC-AA-01) — tái dùng pattern scope theo phòng ban, on-demand aggregation, response envelope
  - `.specify/memory/constitution.md`, `CLAUDE.md`

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. BR3 mâu thuẫn với schema — đã quyết định

`rooms` **không có cột sở hữu phòng ban** ([database_v3_2_compact_39_tables.md:514-547](../../../../database_v3_2_compact_39_tables.md)) — phòng là tài nguyên dùng chung toàn công ty (đã xác nhận khi làm UC-AA-01). BR3 yêu cầu "Manager chỉ xem phòng thuộc phòng ban do mình quản lý" — **quyết định đã duyệt**: phạm vi phòng của Manager được suy diễn động = tập hợp `room_id` xuất hiện trong `room_bookings` gắn với `meetings` mà `organizer_id` thuộc phòng ban `departments.manager_user_id = currentUser.id`, **trong đúng khoảng thời gian đang truy vấn**. Một phòng có thể nằm trong scope của nhiều Manager khác nhau (phòng dùng chung), và phạm vi này **thay đổi theo kỳ lọc** (phòng có thể "trong scope" ở tháng này nhưng "ngoài scope" ở tháng khác nếu phòng ban không đặt phòng đó trong tháng đó) — đây là hệ quả tất yếu của việc không có sở hữu tĩnh, đã ghi rõ để tránh hiểu nhầm.

### 0.2. "Reservation Utilization Rate" — mẫu số "giờ mở cửa tiêu chuẩn" — đã quyết định

`rooms` không có cột giờ hoạt động. Quyết định đã duyệt: dùng 1 cấu hình chung toàn hệ thống `analytics.room_operating_hours_per_day` (mặc định 8 giờ/ngày, `system_configs` → env → default), áp dụng cho **mọi ngày trong khoảng lọc** (không loại trừ cuối tuần — giữ đơn giản, không cần mô hình lịch làm việc phức tạp mà schema chưa hỗ trợ). `availableHours = operatingHoursPerDay × số ngày trong khoảng [from, to]`.

### 0.3. Tránh trùng tên "Utilization Rate" giữa 2 feature — đã quyết định

- UC-148/UC-AA-01 giữ nguyên field `utilizationRate` đã spec (không phá vỡ spec/tasks đã duyệt trước đó) = thực tế ÷ đã đặt.
- UC-149/UC-AA-02 dùng 2 field **tên riêng biệt, không tái dùng `utilizationRate`**:
  - `reservationUtilizationRate` = giờ đã đặt ÷ giờ mở cửa tiêu chuẩn (điểm 0.2).
  - `roomOccupancyRate` = giờ sử dụng thực tế ÷ giờ đã đặt (cùng công thức ý nghĩa với `utilizationRate` ở UC-148, nhưng đặt tên đúng theo thuật ngữ UC-AA-02 để không nhầm lẫn).

### 0.4. Phát hiện phòng "chưa có dữ liệu thực tế" (EX1) — đã quyết định

Data-driven: nếu trong kỳ lọc, phòng đó **không có bất kỳ `room_booking_usages`** nào có `actual_start_time`/`actual_end_time`/`first_presence_at`/`last_presence_at` khác NULL → `hasActualData = false`, trả `actualHours = null`, `roomOccupancyRate = null`. Không dùng field tĩnh `rooms.has_camera` (phòng có thể có camera nhưng lỗi/chưa đồng bộ dữ liệu thực tế trong kỳ đó).

### 0.5. Endpoint chi tiết phòng (Heatmap + danh sách meeting, Normal Flow bước 6-7) — bổ sung mới

`API_CONTRACT` UC-149 chỉ định nghĩa endpoint so sánh tổng quan (`GET /api/v1/analytics/rooms/dashboard`), **không có** endpoint drill-down chi tiết 1 phòng. Quyết định đã duyệt: bổ sung endpoint mới `GET /api/v1/analytics/rooms/{roomId}/detail` trong cùng feature này (cùng UC gốc UC-AA-02, không tách feature riêng), dùng chung permission `analytics.room.read`.

### 0.6. AF1 (Xuất .xlsx) — đã có sẵn, KHÔNG implement lại

`API_CONTRACT` đã có **UC-49 — Xuất báo cáo sử dụng phòng** (`POST /api/v1/rooms/usage-report/exports`, module `reports`, permission `report.room_usage.export`, role `MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN`, async qua `background_jobs` — [API_CONTRACT_v1.0_with_system_roles.md:1961-1993](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md)). Quyết định: AF1 của UC-AA-02 **tái sử dụng UC-49 nguyên trạng**, không viết lại logic export trong module `analytics`. Feature này chỉ đảm bảo dữ liệu hiển thị (roomIds đang xem, from/to đang lọc) đủ để FE gọi UC-49.

### 0.7. Field/entity xác nhận tồn tại thật

- `RoomEntity`: `id, roomCode, roomName, siteName, areaName, capacity, roomType, currentStatus, hasCamera, hasMicrophone, isActive` ([room.entity.ts](../../../../src/modules/rooms/entities/room.entity.ts)).
- `RoomBookingEntity`: `meetingId, roomId, reservedStartTime, reservedEndTime, status` (enum: pending/approved/active/completed/cancelled/released) ([room-booking.entity.ts](../../../../src/modules/rooms/entities/room-booking.entity.ts)).
- `RoomBookingUsageEntity`: `bookingId, meetingId, roomId, reservedStartTime/EndTime, actualStartTime/EndTime, firstPresenceAt/lastPresenceAt, usageStatus` ([room-booking-usage.entity.ts](../../../../src/modules/rooms/entities/room-booking-usage.entity.ts)).
- `MeetingEntity`: `id, title, organizerId, hostId, roomId, status, startTime, endTime, deletedAt` ([meeting.entity.ts](../../../../src/modules/meetings/entities/meeting.entity.ts)).
- `DepartmentEntity.managerUserId` — cơ sở scope Manager, đúng pattern đã dùng ở UC-AA-01 và precedent [meetings.service.ts:4670-4685](../../../../src/modules/meetings/services/meetings.service.ts).
- `SystemConfigEntity` — dùng thêm 1 key mới `analytics.room_operating_hours_per_day`, không tạo bảng/cột mới.
- **Không có bảng/cột nào cần thêm.**

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `analytics`, là báo cáo chuyên sâu hơn UC-AA-01 — tập trung so sánh hiệu suất khai thác **giữa các phòng họp** (không phải KPI toàn hệ thống) và cho phép drill-down xem chi tiết 1 phòng cụ thể (heatmap khung giờ cao điểm + danh sách cuộc họp). Tính năng **read-only tuyệt đối**, không tạo/sửa/xóa bất kỳ bản ghi nghiệp vụ nào.

### 1.2 Mục tiêu

Cho phép Manager (giới hạn theo phạm vi phòng ban phụ trách), Business Admin, System Admin so sánh 4 chỉ số cốt lõi (giờ đã đặt, giờ sử dụng thực tế, Reservation Utilization Rate, Room Occupancy Rate) giữa các phòng họp theo khoảng thời gian tùy chọn, và xem chi tiết heatmap + lịch sử cuộc họp của từng phòng.

### 1.3 Giá trị mang lại

- Cho Manager: phát hiện phòng phòng ban mình đang khai thác kém hiệu quả hoặc quá tải.
- Cho Business Admin/System Admin: so sánh chéo toàn bộ phòng họp công ty để tối ưu quy hoạch không gian.
- Cho vận hành: heatmap giúp phát hiện khung giờ cao điểm để điều chỉnh chính sách đặt phòng.

### 1.4 Giả định

- Phạm vi phòng của Manager phụ thuộc vào kỳ lọc đang xem (xem §0.1) — không phải sở hữu cố định.
- `availableHours` cho `reservationUtilizationRate` tính đơn giản trên số ngày lịch trong khoảng lọc (không loại trừ cuối tuần) — xem §0.2.
- Danh sách meeting trong màn hình chi tiết phòng chỉ hiển thị thông tin cơ bản (title, organizer, thời gian, trạng thái), không hiển thị chi tiết attendance từng người (đã có feature riêng `feat-view-meeting-attendance-list`).
- Bảng so sánh tổng quan hiển thị **toàn bộ phòng `is_active = true`** trong scope, kể cả phòng có 0 giờ đặt trong kỳ.
- "Tổng số giờ được đặt" chỉ tính `room_bookings.status IN ('approved','active','completed','released')`, loại `pending`/`cancelled`.
- AF1 (xuất .xlsx) tái dùng UC-49 có sẵn, không thuộc phạm vi code của feature này.

### 1.5 Clarifications Resolved

Đã liệt kê và người dùng duyệt toàn bộ phương án ở phiên trước — tổng hợp tại §0.1–§0.6.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager / Approver | Quản lý cấp phòng ban | Xem so sánh + chi tiết phòng chỉ trong phạm vi phòng ban mình phụ trách (đúng kỳ lọc đang xem) |
| Business Admin | Quản trị viên doanh nghiệp | Xem so sánh + chi tiết toàn bộ phòng công ty |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin ở tính năng này |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (đúng `API_CONTRACT` UC-149).
- Permission bắt buộc: `analytics.room.read` cho cả 2 endpoint (so sánh tổng quan + chi tiết phòng).
- `SYSTEM_ADMIN`/`BUSINESS_ADMIN`: không giới hạn scope phòng.
- `MANAGER`: scope phòng = tập `room_id` xuất hiện trong `room_bookings` của `meetings` do phòng ban mình quản lý tổ chức, **trong đúng kỳ lọc đang truy vấn** (§0.1).
  - Endpoint so sánh tổng quan: chỉ trả các phòng trong scope; không có lỗi nếu scope rỗng (trả danh sách rỗng).
  - Endpoint chi tiết phòng: nếu `roomId` không thuộc scope trong kỳ đang truy vấn → từ chối `ROOM_OUT_OF_SCOPE`.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `analytics.room.read`.
- Scope Manager xác định qua `departments.manager_user_id = currentUser.id`, không dùng `direct_manager_id`, không rollup phòng ban con (nhất quán UC-AA-01).

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về toàn bộ dữ liệu của cả 2 endpoint (so sánh tổng quan, chi tiết phòng) dưới dạng read-only — không tạo/sửa/xóa bất kỳ bản ghi nào trong `rooms`, `room_bookings`, `room_booking_usages`, `meetings`.

FR-002: THE system SHALL tính toán lại toàn bộ chỉ số trực tiếp từ dữ liệu nguồn (on-demand aggregation) tại mỗi lần gọi API, không đọc từ bảng cache/snapshot.

FR-003: THE system SHALL giới hạn phạm vi phòng của Manager theo đúng định nghĩa tại spec §0.1 (suy diễn theo kỳ lọc, không sở hữu tĩnh).

### 3.2 Event-driven Requirements — Endpoint so sánh tổng quan

FR-004: WHEN người dùng gửi yêu cầu GET /api/v1/analytics/rooms/dashboard, THE system SHALL kiểm tra authentication và permission `analytics.room.read` trước khi xử lý logic khác.

FR-005: WHEN người dùng không truyền `from`/`to` và không truyền `preset`, THE system SHALL áp dụng mặc định `preset=month` (Tháng hiện tại theo timezone `Asia/Ho_Chi_Minh`).

FR-006: WHEN người dùng truyền `preset IN ('day','week','month')`, THE system SHALL tự tính `from`/`to` tương ứng (ngày hiện tại; tuần hiện tại Thứ 2-Chủ nhật; tháng hiện tại) theo timezone `Asia/Ho_Chi_Minh`, bỏ qua `from`/`to` nếu có truyền kèm.

FR-007: WHEN người dùng truyền `preset='custom'` kèm `from`/`to` hợp lệ, THE system SHALL dùng đúng khoảng đó.

FR-008: WHEN người dùng truyền `roomId`, THE system SHALL lọc bảng so sánh chỉ còn đúng 1 phòng đó (vẫn áp scope Manager nếu có).

FR-009: WHEN người dùng truyền `siteName`, THE system SHALL lọc theo đúng `rooms.site_name`.

### 3.3 Event-driven Requirements — Endpoint chi tiết phòng

FR-010: WHEN người dùng gửi yêu cầu GET /api/v1/analytics/rooms/{roomId}/detail, THE system SHALL kiểm tra authentication và permission `analytics.room.read` trước khi xử lý logic khác.

FR-011: WHEN currentUser có role MANAGER và `roomId` không thuộc scope phòng của Manager trong kỳ lọc đang truy vấn, THE system SHALL từ chối yêu cầu với error code `ROOM_OUT_OF_SCOPE`.

FR-012: WHEN yêu cầu hợp lệ, THE system SHALL trả về thông tin cơ bản của phòng, 4 chỉ số cốt lõi, heatmap theo khung giờ, và danh sách các `meetings` cấu thành chỉ số trong kỳ lọc.

### 3.4 State-driven Requirements

FR-013: WHILE một phòng không có bất kỳ `room_booking_usages` nào có dữ liệu thực tế (`actual_*`/`presence_*`) trong kỳ lọc, THE system SHALL trả `actualHours = null`, `roomOccupancyRate = null`, `hasActualData = false` cho phòng đó (EX1) — vẫn trả `bookedHours`/`reservationUtilizationRate` bình thường.

FR-014: WHILE khoảng thời gian lọc không phát sinh bất kỳ `room_bookings` nào trong scope, THE system SHALL trả về danh sách phòng rỗng (không lỗi) kèm message mô tả không có dữ liệu.

### 3.5 Optional Feature Requirements

FR-015: WHERE `roomId` được cung cấp ở endpoint so sánh tổng quan, THE system SHALL áp dụng như filter bổ sung sau khi đã áp scope theo role.

FR-016: WHERE `siteName` được cung cấp, THE system SHALL áp dụng như filter bổ sung độc lập với scope phòng ban.

### 3.6 Unwanted Behavior Requirements

FR-017: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-018: IF người dùng không có permission `analytics.room.read`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-019: IF `preset` không thuộc {day, week, month, custom}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-020: IF `preset='custom'` nhưng thiếu `from` hoặc `to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-021: IF `from > to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-022: IF khoảng `to - from` vượt `analytics.dashboard_max_range_days` (tái dùng đúng config key đã tạo ở UC-AA-01), THEN THE system SHALL trả về 400, error code `DATE_RANGE_TOO_LARGE`.

FR-023: IF `roomId` truyền ở endpoint chi tiết phòng không tồn tại hoặc `deleted_at IS NOT NULL`, THEN THE system SHALL trả về 404, error code `ROOM_NOT_FOUND`.

FR-024: IF currentUser có role MANAGER và `roomId` (endpoint chi tiết) không thuộc scope trong kỳ lọc, THEN THE system SHALL trả về 403, error code `ROOM_OUT_OF_SCOPE`.

### 3.7 Authorization Requirements

FR-025: WHEN the user performs a protected action (xem dashboard/chi tiết phòng), THE system SHALL verify authentication và authorization trước khi thực thi aggregation query.

FR-026: WHILE currentUser đang ở scope MANAGER, THE system SHALL áp scope phòng ban (§0.1) cho MỌI truy vấn (`room_bookings`, `room_booking_usages`, `meetings`) ở cả 2 endpoint.

### 3.8 Data & State Requirements

FR-027: WHEN tính `bookedHours` cho 1 phòng, THE system SHALL tính `SUM(reserved_end_time - reserved_start_time)` của `room_bookings` trong scope + kỳ có `status IN ('approved','active','completed','released')`.

FR-028: WHEN tính `actualHours` cho 1 phòng (nếu `hasActualData=true`), THE system SHALL tính `SUM(thời lượng thực tế)` của `room_booking_usages`, ưu tiên `actual_end_time - actual_start_time`, fallback `last_presence_at - first_presence_at` nếu thiếu actual, loại bản ghi không có cả hai (đúng nguyên tắc FR-013 UC-AA-01, không suy diễn).

FR-029: WHEN tính `reservationUtilizationRate` cho 1 phòng, THE system SHALL tính `bookedHours ÷ (operatingHoursPerDay × số_ngày_trong[from,to])`, nhân 100. Mẫu số 0 → trả `0`.

FR-030: WHEN tính `roomOccupancyRate` cho 1 phòng có `hasActualData=true`, THE system SHALL tính `actualHours ÷ bookedHours`, nhân 100. Mẫu số 0 → trả `0`.

FR-031: WHEN tính `heatmap` ở endpoint chi tiết phòng, THE system SHALL phân bổ thời lượng sử dụng thực tế (FR-028) của mỗi `room_booking_usage` vào từng khung giờ đồng hồ (0-23h) mà nó chồng lấn — số phút quy cho mỗi khung giờ bằng đúng số phút chồng lấn thực tế giữa khoảng sử dụng và khung giờ đó (một phiên sử dụng kéo dài qua nhiều giờ sẽ được chia vào nhiều khung giờ tương ứng, không gán toàn bộ vào giờ bắt đầu), cộng dồn qua tất cả các ngày trong kỳ lọc, trả về mảng 24 phần tử `{hourOfDay, actualMinutes}`.

FR-032: WHEN tính danh sách `meetings` ở endpoint chi tiết phòng, THE system SHALL trả về các `meetings` gắn với `room_bookings` của phòng đó trong scope + kỳ, gồm `meetingId, title, organizerName, reservedStartTime, reservedEndTime, actualStartTime, actualEndTime, status`.

FR-033: WHEN currentUser có role SYSTEM_ADMIN hoặc BUSINESS_ADMIN, THE system SHALL trả về `summary` tổng hợp trên toàn bộ phòng trong kết quả (không giới hạn phòng ban).

### 3.9 Notification / Audit Requirements

FR-034: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN endpoint so sánh tổng quan hoặc chi tiết phòng hoàn tất thành công, THE system SHALL ghi audit log non-blocking với `action_type` tương ứng (`read_analytics_room_dashboard` hoặc `read_analytics_room_detail`), `entity_type='rooms'`, `metadata_json` chứa tối thiểu `{viewerUserId, viewerRole, from, to, roomId?, resolvedScopeRoomIds}`.

### 3.10 Complex / Combined Requirements

FR-035: WHILE currentUser có role MANAGER, WHEN scope phòng trong kỳ lọc rỗng, THE system SHALL trả về danh sách phòng rỗng ở endpoint so sánh tổng quan thay vì lỗi.

FR-036: WHERE `to - from` vượt `analytics.dashboard_max_range_days`, IF request vẫn được gửi, THEN THE system SHALL từ chối tại tầng validate DTO trước khi chạm tới bất kỳ truy vấn tổng hợp nào.

### 3.11 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-AA-02 POST-2, BR3 |
| FR-004–FR-012 | Event-driven | UC-AA-02 Normal Flow bước 1-7, UC-149 query params |
| FR-013, FR-014 | State-driven | UC-AA-02 EX1 |
| FR-015, FR-016 | Optional Feature | UC-149 query params |
| FR-017–FR-024 | Unwanted Behavior | UC-AA-02 BR3, EX1 |
| FR-025, FR-026 | Authorization | UC-AA-02 BR3 |
| FR-027–FR-033 | Data & State | UC-AA-02 Normal Flow bước 3, 7 |
| FR-034 | Notification/Audit | Pattern audit UC-AA-01 |
| FR-035, FR-036 | Complex | UC-AA-02 BR3 + range guard |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về endpoint so sánh tổng quan trong vòng dưới 3 giây cho khoảng thời gian mặc định (tháng hiện tại) và tối đa 50 phòng, trong điều kiện tải bình thường.

NFR-002: THE system SHALL trả về endpoint chi tiết phòng (bao gồm heatmap) trong vòng dưới 2 giây trong điều kiện tải bình thường.

NFR-003: IF khoảng thời gian truy vấn vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL từ chối tại tầng validate (FR-022) trước khi chạy aggregation.

### 4.2 Security

NFR-004: THE system SHALL yêu cầu authentication cho mọi request.

NFR-005: THE system SHALL enforce scope phòng ban Manager ở tầng service cho cả 2 endpoint, không chỉ dựa vào FE.

### 4.3 Reliability & Consistency

NFR-006: THE system SHALL đảm bảo `bookedHours`, `actualHours`, `reservationUtilizationRate`, `roomOccupancyRate` trong cùng 1 response được tính trên cùng 1 khoảng thời gian và cùng 1 scope.

NFR-007: THE system SHALL sử dụng index sẵn có trên `room_bookings(room_id)`, `room_bookings(reserved_start_time, reserved_end_time)`, `room_booking_usages(room_id)`, `room_booking_usages(meeting_id)`.

### 4.4 Usability

NFR-008: THE system SHALL trả về clear error messages và field names dạng camelCase.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `rooms` | Danh sách phòng, thông tin cơ bản | Không có `department_id` |
| `room_bookings` | `bookedHours`, nguồn danh sách phòng trong scope | Loại status pending/cancelled |
| `room_booking_usages` | `actualHours`, `heatmap` | Fallback presence nếu thiếu actual |
| `meetings` | Xác định scope Manager (`organizer_id`), danh sách meeting chi tiết phòng | |
| `users`, `departments` | Resolve scope Manager | Giống UC-AA-01 |
| `system_configs` | `analytics.room_operating_hours_per_day`, tái dùng `analytics.dashboard_max_range_days` | Không tạo bảng mới |

### 5.2 Dữ liệu đầu vào

**Endpoint so sánh tổng quan** (`GET /api/v1/analytics/rooms/dashboard`)

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| preset | string | Không | `day`/`week`/`month`/`custom`, mặc định `month` | Enum hợp lệ |
| from | date | Chỉ khi `preset=custom` | Bắt đầu khoảng | ISO date |
| to | date | Chỉ khi `preset=custom` | Kết thúc khoảng | ISO date, `to >= from`, range ≤ max |
| roomId | UUID | Không | Lọc 1 phòng | UUID hợp lệ |
| siteName | string | Không | Lọc theo tòa nhà | max 150 ký tự |

**Endpoint chi tiết phòng** (`GET /api/v1/analytics/rooms/{roomId}/detail`)

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| roomId (path param) | UUID | Có | Phòng cần xem chi tiết | UUID hợp lệ, tồn tại |
| preset/from/to | như trên | Không | Cùng logic khoảng thời gian | Cùng validation |

### 5.3 Dữ liệu đầu ra

**So sánh tổng quan:**

| Field | Type | Mô tả |
|---|---:|---|
| period.from/to | date | Khoảng thời gian áp dụng |
| summary.reservationUtilizationRate | number (%) | Trung bình toàn bộ phòng trong kết quả |
| summary.roomOccupancyRate | number (%) | Trung bình toàn bộ phòng có `hasActualData=true` |
| summary.totalBookedHours | number | Tổng giờ đặt toàn bộ phòng |
| summary.actualUsedHours | number | Tổng giờ sử dụng thực tế (chỉ phòng có data) |
| rooms[].roomId/roomName | uuid/string | |
| rooms[].bookedHours | number | FR-027 |
| rooms[].actualHours | number \| null | FR-028, null nếu `hasActualData=false` |
| rooms[].reservationUtilizationRate | number (%) | FR-029 |
| rooms[].roomOccupancyRate | number \| null (%) | FR-030, null nếu `hasActualData=false` |
| rooms[].hasActualData | boolean | FR-013 |
| trend[] | array | Kế thừa field đã có ở UC-149 gốc — daily `{date, meetingCount}` toàn scope, không phải trọng tâm feature này |

**Chi tiết phòng:**

| Field | Type | Mô tả |
|---|---:|---|
| room.roomId/roomName/siteName/areaName/capacity | | Thông tin cơ bản |
| period.from/to | date | |
| bookedHours, actualHours, reservationUtilizationRate, roomOccupancyRate, hasActualData | | Như trên, riêng phòng này |
| heatmap[].hourOfDay | integer (0-23) | FR-031 |
| heatmap[].actualMinutes | number | FR-031 |
| meetings[].meetingId/title/organizerName/reservedStartTime/reservedEndTime/actualStartTime/actualEndTime/status | | FR-032 |

### 5.4 Data Constraints

- Không ghi/sửa/xóa bảng nguồn.
- Không thêm bảng/cột — chỉ thêm 1 key `system_configs` mới (`analytics.room_operating_hours_per_day`).
- Mẫu số = 0 → trả `0`, không chia cho 0.

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN resolving scope phòng cho MANAGER, THE system SHALL query `room_bookings.room_id` DISTINCT gắn với `meetings.organizer_id IN (SELECT id FROM users WHERE department_id IN (SELECT id FROM departments WHERE manager_user_id = :userId))` trong đúng kỳ `[from,to]` đang truy vấn.

FR-DATA-002: WHEN đọc `operatingHoursPerDay`, THE system SHALL áp dụng precedence `system_configs['analytics.room_operating_hours_per_day'] → env ANALYTICS_ROOM_OPERATING_HOURS_PER_DAY → default 8`.

### 5.6 Cần làm rõ

- **CL-1**: `analytics.room_operating_hours_per_day = 8` (áp dụng mọi ngày kể cả cuối tuần) là giả định đơn giản hóa đã duyệt — nếu sau này cần loại trừ cuối tuần/ngày lễ, cần bảng lịch làm việc riêng (ngoài scope hiện tại).
- **CL-2**: `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-149 hiện chưa có endpoint chi tiết phòng (`{roomId}/detail`) — cần task đồng bộ tài liệu riêng (giống CL-1 của UC-AA-01).
- **CL-3**: `trend[]` ở endpoint so sánh tổng quan kế thừa nguyên trạng từ UC-149 gốc nhưng không phải trọng tâm Normal Flow của UC-AA-02 (vốn là so sánh giữa các phòng, không phải xu hướng theo thời gian) — giữ tối giản (`date, meetingCount`), không đầu tư sâu.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `preset` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `preset=custom` thiếu `from`/`to`, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `from > to`, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF range vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.
ERR-005: IF `roomId`/`siteName` không hợp lệ định dạng, THEN 400 `VALIDATION_ERROR`.

### 6.2 Authentication / Authorization Errors

ERR-006: IF chưa đăng nhập, THEN 401.
ERR-007: IF không có permission `analytics.room.read`, THEN 403 `PERMISSION_DENIED`.
ERR-008: IF MANAGER truy cập chi tiết phòng ngoài scope, THEN 403 `ROOM_OUT_OF_SCOPE`.

### 6.3 Business Rule Errors

ERR-009: IF `roomId` (endpoint chi tiết) không tồn tại/soft-deleted, THEN 404 `ROOM_NOT_FOUND`.

### 6.4 System Errors

ERR-010: IF lỗi truy vấn hệ thống, THEN 500 `INTERNAL_ERROR`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When gọi endpoint so sánh tổng quan không truyền tham số,
Then hệ thống trả về danh sách toàn bộ phòng active với 4 chỉ số, tính trên tháng hiện tại.

AC-002:
Given Manager quản lý phòng ban "Kỹ thuật" đã đặt phòng "P101" và "P102" trong tháng này,
When Manager gọi endpoint so sánh tổng quan,
Then hệ thống chỉ trả về "P101" và "P102" (không trả các phòng khác).

AC-003:
Given Manager xem chi tiết phòng "P101" (thuộc scope tháng này),
When gọi endpoint chi tiết phòng,
Then hệ thống trả về heatmap 24 khung giờ + danh sách meeting đã tổ chức tại phòng đó trong tháng.

### 7.2 Validation & Authorization Cases

AC-004:
Given Manager gọi endpoint chi tiết cho phòng "P999" chưa từng được phòng ban mình đặt trong kỳ lọc,
When gọi API,
Then hệ thống reject 403 `ROOM_OUT_OF_SCOPE`.

AC-005:
Given `preset=custom` nhưng thiếu `to`,
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR`.

### 7.3 Business Rule Cases

AC-006:
Given phòng "P103" chưa có bất kỳ dữ liệu presence/actual nào trong kỳ,
When gọi endpoint so sánh tổng quan,
Then `actualHours=null`, `roomOccupancyRate=null`, `hasActualData=false` cho "P103", nhưng `bookedHours`/`reservationUtilizationRate` vẫn hiển thị bình thường (EX1).

AC-007:
Given Manager không có phòng nào trong scope kỳ lọc hiện tại,
When gọi endpoint so sánh tổng quan,
Then trả về `rooms=[]`, không lỗi.

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-027-FR-030, FR-033 |
| AC-002 | FR-003, FR-DATA-001 |
| AC-003 | FR-010, FR-012, FR-031, FR-032 |
| AC-004 | FR-011, FR-024, ERR-008 |
| AC-005 | FR-020, ERR-002 |
| AC-006 | FR-013, FR-028, FR-030 |
| AC-007 | FR-014, FR-035 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- UC-49 (xuất báo cáo .xlsx) — đã có sẵn ở module `reports`, feature này chỉ đảm bảo dữ liệu đủ để FE gọi, không viết lại logic export.
- UC-148 (UC-AA-01), UC-150, UC-151+ — các UC/endpoint riêng biệt khác.
- Lịch làm việc/ngày lễ riêng cho từng phòng (loại trừ cuối tuần khỏi `operatingHoursPerDay`) — xem CL-1.
- Cấu hình `analytics.room_operating_hours_per_day` qua UI admin — chỉ đọc qua precedence có sẵn.
- WebSocket push/invalidate cho dashboard — cùng lý do đã loại ở UC-AA-01 (vượt module boundary).
- Trend theo thời gian chuyên sâu (`groupBy=week/month` cho biểu đồ xu hướng) — giữ tối giản theo CL-3.
- Rollup phòng ban con cho scope Manager.

### 8.2 Có thể xem xét ở feature khác

- Đồng bộ `API_CONTRACT_v1.0_with_system_roles.md` với endpoint `{roomId}/detail` mới.
- Lịch làm việc/ngày lễ riêng cho `reservationUtilizationRate`.
- `groupBy` đầy đủ cho `trend[]`.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement export logic (UC-49) as part of this feature — reuse the existing endpoint.
OOS-002: THE system SHALL NOT create new database tables or columns for this feature.
OOS-003: THE system SHALL NOT exclude weekends/holidays from operatingHoursPerDay calculation.
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
- [x] Không tự ý thêm bảng/cột database mới.
- [x] Các điểm thiếu thông tin đưa vào mục 5.6 "Cần làm rõ".
