# Feature Specification: Xem lịch sử sử dụng phòng họp theo khoảng thời gian

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Xác nhận với người dùng và chốt 2 điểm mơ hồ còn treo: CL-4 (giữ `preset=month` mặc định) và CL-2 (giữ `pending_evaluation` hiển thị với nhãn trung tính, không ẩn khỏi danh sách). Bổ sung `research.md`, `data-model.md`, `contracts/`, `quickstart.md` cho đồng bộ với các feature khác cùng đợt. | §5.6, thêm file mới |
| 2026-07-09 | Tạo spec lần đầu cho UC-RUM-04. Đối chiếu với `feat-view-room-usage-dashboard` (UC-AA-02) đã có để tránh trùng lặp, xác định phần mở rộng thật sự cần code mới. | Toàn bộ file |

---

- **Feature ID**: RUM-ROOM-USAGE-HISTORY-001
- **Feature Name**: Xem lịch sử sử dụng phòng họp theo khoảng thời gian (View Room Usage History)
- **Use Case**: UC-RUM-04
- **Module / Domain**: analytics
- **Created Date**: 2026-07-09
- **Status**: Draft
- **Source Documents**:
  - Đặc tả UC-RUM-04 do người dùng cung cấp (actor, trigger, precondition, postcondition, normal/alternative flow, exception, business rules).
  - `spec/features/analytics/feat-view-room-usage-dashboard/` (UC-AA-02) — tái dùng nguyên vẹn pattern scope Manager theo kỳ lọc, preset ngày/tuần/tháng/tùy chỉnh, guard `DATE_RANGE_TOO_LARGE`.
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` mục UC-49 (`POST /api/v1/rooms/usage-report/exports`) — endpoint export đã có trong contract nhưng **chưa có code**.
  - `database_v3_2_compact_39_tables.md`, entity thật: `rooms`, `room_bookings`, `room_booking_usages`, `no_show_cases`, `meetings`, `users`, `departments`.
  - `CLAUDE.md` (root backend).

---

## 0. RECON — Đối chiếu nguồn + các quyết định cần chốt

### 0.1. Đây là phần mở rộng của UC-AA-02, không phải tính năng độc lập từ đầu

`feat-view-room-usage-dashboard` (UC-AA-02, đã implement) cung cấp 2 endpoint:
- `GET /api/v1/analytics/rooms/dashboard` — **so sánh** các phòng (1 dòng/phòng, không phải 1 dòng/phiên).
- `GET /api/v1/analytics/rooms/{roomId}/detail` — chi tiết **1 phòng** (heatmap + danh sách meeting của riêng phòng đó).

UC-RUM-04 (Normal Flow bước 6, Phần 2 "Danh sách chi tiết") cần một hình dạng dữ liệu khác: **danh sách phẳng, đa phòng, mỗi dòng = 1 phiên sử dụng phòng**, sortable theo cột (bước 7), có Host/trạng thái phiên (Hoàn tất/No-show/Hủy sát giờ) — dữ liệu này **chưa tồn tại** ở 2 endpoint trên. Quyết định: bổ sung 1 endpoint mới `GET /api/v1/analytics/rooms/usage-history` trong module `analytics`, **tái dùng toàn bộ** logic resolve preset/from/to, `DATE_RANGE_TOO_LARGE` guard, và scope Manager-theo-kỳ-lọc đã có ở `RoomUsageDashboardService` (không viết lại).

### 0.2. Nguồn "trạng thái phiên" (Hoàn tất / No-show / Hủy sát giờ) — đã xác nhận field tồn tại

- `RoomBookingUsageEntity.usageStatus` ([room-booking-usage.entity.ts](../../../../src/modules/rooms/entities/room-booking-usage.entity.ts)) đã có enum `RoomUsageStatus`: `NOT_STARTED | IN_USE | COMPLETED | NO_SHOW | EARLY_EMPTY | RELEASED`. Đây là nguồn trực tiếp cho "Hoàn tất" (`COMPLETED`) và "No-show" (`NO_SHOW`) — **không cần derive lại từ `no_show_cases`** (bảng đó là workflow xử lý no-show — cảnh báo/giải phóng, không phải nhãn trạng thái cuối cùng để hiển thị lịch sử).
- `RoomBookingEntity.status = CANCELLED` ([room-booking.entity.ts](../../../../src/modules/rooms/entities/room-booking.entity.ts)) là nguồn cho "Đã hủy" / "Hủy sát giờ" — **nhưng không có cột `cancelled_at` riêng**. Quyết định: dùng `room_bookings.updated_at` làm proxy thời điểm hủy (booking chỉ được update lần cuối khi chuyển sang `CANCELLED`, theo đúng convention `@UpdateDateColumn` của TypeORM trong dự án). Ghi rõ đây là xấp xỉ, không phải timestamp hủy chính danh — xem CL-1 (§5.6).
- "Sát giờ" cần 1 ngưỡng thời gian. Quyết định: thêm 1 key `system_configs` mới `analytics.late_cancellation_threshold_minutes` (mặc định 60 phút — booking bị hủy trong vòng 60 phút trước giờ bắt đầu dự kiến, hoặc hủy sau khi giờ bắt đầu dự kiến đã qua, được tính là "Hủy sát giờ"), theo đúng precedence `system_configs → env → default` như `analytics.room_operating_hours_per_day` đã làm ở UC-AA-02.
- Bảng derive đầy đủ (session status) — xem FR-DATA-002 (§5.5) và bảng quyết định dưới đây:

| Điều kiện nguồn dữ liệu | `sessionStatus` trả về |
|---|---|
| `room_bookings.status = CANCELLED` và `(reservedStartTime − updatedAt) <= late_cancellation_threshold_minutes` (kể cả nếu `updatedAt` đã qua `reservedStartTime`) | `cancelled_late` (Hủy sát giờ) |
| `room_bookings.status = CANCELLED` và ngưỡng trên không thỏa | `cancelled` (Đã hủy) |
| Có `room_booking_usages` với `usageStatus = COMPLETED` | `completed` (Hoàn tất) |
| Có `room_booking_usages` với `usageStatus = NO_SHOW` | `no_show` (No-show) |
| Có `room_booking_usages` với `usageStatus = EARLY_EMPTY` | `early_empty` (Rời sớm / trống sớm) |
| Có `room_booking_usages` với `usageStatus = RELEASED` | `released` (Đã tự động giải phóng) |
| Có `room_booking_usages` với `usageStatus IN (NOT_STARTED, IN_USE)` | `not_started` / `in_progress` tương ứng (phiên chưa/đang diễn ra tại thời điểm truy vấn) |
| `room_bookings.status IN (pending, approved, active, completed)` và **không có** `room_booking_usages` nào, và `reservedEndTime` đã qua thời điểm hiện tại | `pending_evaluation` (chưa có dữ liệu no-show/actual — cron chưa xử lý) — xem CL-2 |

### 0.3. Không tạo trường "utilizationRate" mới trùng tên — tái dùng đúng 2 field đã đặt tên ở UC-AA-02

Theo đúng quyết định §0.3 của `feat-view-room-usage-dashboard`: dùng `reservationUtilizationRate` (đặt ÷ mở cửa tiêu chuẩn) và `roomOccupancyRate` (thực tế ÷ đã đặt) cho Phần 1 (Summary Metrics). Bổ sung thêm `noShowCount` (đếm số phiên có `sessionStatus='no_show'` trong tập kết quả) — field UC-RUM-04 yêu cầu rõ mà UC-AA-02 chưa có.

### 0.4. Danh sách chi tiết cần phân trang + sort — khác với dashboard (mảng nhỏ, không phân trang)

`GET /analytics/rooms/dashboard` trả toàn bộ phòng trong 1 mảng (thường ≤ 50 phần tử). Danh sách phiên theo UC-RUM-04 (Normal Flow bước 6-7) có thể lên tới hàng nghìn dòng nếu lọc theo Tháng/toàn tổ chức → **bắt buộc phân trang** (`page`/`limit`, theo đúng convention `CLAUDE.md` §8.4: default `page=1`, `limit=20`, max `limit=100`) và **sort** (`sortBy IN ('reservedStartTime','sessionStatus')`, `sortOrder`, theo đúng Normal Flow bước 7 — "tương tác với tiêu đề cột Trạng thái/Thời gian để sắp xếp").

### 0.5. Alternative Flow A1 (Export) — ngoài phạm vi code của feature này

`API_CONTRACT` đã định nghĩa **UC-49 — Xuất báo cáo sử dụng phòng** (`POST /api/v1/rooms/usage-report/exports`, permission `report.room_usage.export`, role `MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN`, async qua `background_jobs`, `sections: ["utilization","no_show","history"]` — [API_CONTRACT_v1.0_with_system_roles.md:1961-1993](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md)). Endpoint này **chưa có code** (khác với UC-49 export meeting-activity đã có sẵn ở `feat-export-meeting-activity-report`). Quyết định: giữ nguyên tinh thần §0.6 của `feat-view-room-usage-dashboard` — **A1 không thuộc phạm vi feature này**. Đề xuất một feature riêng `feat-export-room-usage-report` (implement UC-49 thật sự, mirror kiến trúc `reports/meeting-activity` — worker/processor/renderer/`background_jobs`/`media_files`), dùng `GET /analytics/rooms/usage-history` (feature này) làm nguồn dữ liệu tính lại phía server cho job export (không export trực tiếp từ response FE đang xem, tránh giới hạn phân trang). Việc này giữ feature hiện tại tập trung đúng 1 concern (đọc dữ liệu), tránh phá "Scope Gate".

### 0.6. Field/entity xác nhận tồn tại thật

- `RoomEntity`: `id, roomCode, roomName, siteName, areaName, capacity, isActive` — đã dùng ở UC-AA-02.
- `RoomBookingEntity`: `id, bookingCode, meetingId, roomId, reservedStartTime, reservedEndTime, status (pending/approved/active/completed/cancelled/released), bookedBy, cancellationReason, updatedAt` ([room-booking.entity.ts](../../../../src/modules/rooms/entities/room-booking.entity.ts)).
- `RoomBookingUsageEntity`: `bookingId, meetingId, roomId, reservedStartTime/EndTime, actualStartTime/EndTime, firstPresenceAt/lastPresenceAt, usageStatus` ([room-booking-usage.entity.ts](../../../../src/modules/rooms/entities/room-booking-usage.entity.ts)).
- `MeetingEntity`: `id, meetingCode, title, organizerId, hostId, roomId, status, startTime, endTime, deletedAt`.
- `UserEntity`: dùng để resolve `hostName` (ưu tiên `hostId`, fallback `organizerId` nếu `hostId` null — xem CL-3).
- `DepartmentEntity.managerUserId` — cơ sở scope Manager, tái dùng nguyên `RoomUsageDashboardService.resolveScope()`.
- `SystemConfigEntity` — thêm 1 key mới `analytics.late_cancellation_threshold_minutes`. Không tạo bảng/cột mới.
- **Không có bảng/cột nào cần thêm.**

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `analytics`, mở rộng trực tiếp từ UC-AA-02 (đã có). Trong khi UC-AA-02 trả lời câu hỏi "phòng nào đang được khai thác tốt/kém", UC-RUM-04 trả lời câu hỏi chi tiết hơn: "**từng phiên sử dụng phòng cụ thể** diễn ra thế nào, ai đặt, có đến hay không". Tính năng **read-only tuyệt đối**.

### 1.2 Mục tiêu

Cho phép Manager (giới hạn phòng ban phụ trách, scope theo kỳ lọc — BR1), Business Admin truy xuất danh sách chi tiết từng phiên sử dụng phòng theo khoảng thời gian tùy chọn (Ngày/Tuần/Tháng/Tùy chỉnh), lọc theo phòng/khu vực, sort theo thời gian hoặc trạng thái, kèm 4 chỉ số tổng quan (giờ đã đặt, giờ sử dụng thực tế, số lần no-show, tỷ lệ sử dụng).

### 1.3 Giá trị mang lại

- Phát hiện nhanh các phiên No-show hoặc hủy sát giờ để chấn chỉnh thói quen đặt phòng không sử dụng.
- Cung cấp bằng chứng chi tiết (không chỉ số tổng hợp) phục vụ báo cáo giao ban cuối tháng/quý.

### 1.4 Giả định

- Danh sách hiển thị **toàn bộ phiên có `room_bookings` phát sinh trong kỳ lọc** (không giới hạn theo `status`), kể cả `CANCELLED` — vì UC yêu cầu nhìn thấy cả "Hủy sát giờ" như 1 dạng lãng phí (không giống UC-AA-02 vốn loại `pending`/`cancelled` khỏi `bookedHours`).
- `noShowCount`/`totalReservedHours`/`totalActualHours`/`reservationUtilizationRate`/`roomOccupancyRate` ở Phần 1 (Summary) được tính trên **toàn bộ tập kết quả khớp filter** (không phải chỉ trang hiện tại) — tính riêng 1 query aggregate độc lập với query phân trang danh sách.
- `hostName` ưu tiên `meetings.hostId`; nếu null, fallback `meetings.organizerId` (người tạo cuộc họp) — xem CL-3.
- AF1 (Export) ngoài phạm vi — xem §0.5.
- BR1 tái dùng nguyên định nghĩa scope Manager đã duyệt ở UC-AA-02 (§0.1 file đó): tập `room_id` gắn với `meetings.organizer_id` thuộc phòng ban do Manager quản lý, **suy diễn theo đúng kỳ lọc đang truy vấn**, không phải sở hữu tĩnh.

### 1.5 Clarifications Resolved

Tổng hợp tại §0.1–§0.6.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager / Approver | Quản lý cấp phòng ban | Xem lịch sử chỉ trong phạm vi phòng do phòng ban mình đặt (đúng kỳ lọc đang xem) |
| Business Admin | Quản trị viên doanh nghiệp | Xem lịch sử toàn bộ phòng công ty |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin ở tính năng này (nhất quán với UC-AA-02, dù UC-RUM-04 gốc chỉ liệt kê Manager/Business Admin) |

### 2.2 Role & Permission Rules

- Permission bắt buộc: `analytics.room.read` — **tái dùng permission đã seed sẵn** cho `MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN` ở UC-AA-02, không tạo permission mới, không cần migration seed mới.
- `SYSTEM_ADMIN`/`BUSINESS_ADMIN`: không giới hạn scope phòng.
- `MANAGER`: scope phòng = tái dùng nguyên `RoomUsageDashboardService.resolveScope()` (đã implement ở UC-AA-02) — không viết lại.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `analytics.room.read`.
- Nếu MANAGER không có phòng nào trong scope tại kỳ lọc, trả `sessions=[]`, không lỗi (nhất quán FR-035 của UC-AA-02).

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về dữ liệu của endpoint lịch sử sử dụng phòng dưới dạng read-only — không tạo/sửa/xóa bất kỳ bản ghi nào trong `rooms`, `room_bookings`, `room_booking_usages`, `meetings`, `no_show_cases`.

FR-002: THE system SHALL tính toán lại toàn bộ danh sách và chỉ số tổng quan trực tiếp từ dữ liệu nguồn (on-demand aggregation) tại mỗi lần gọi API, không đọc từ bảng cache/snapshot.

FR-003: THE system SHALL tái dùng nguyên vẹn logic resolve `preset/from/to` và scope Manager-theo-kỳ-lọc đã implement ở `RoomUsageDashboardService` (UC-AA-02) — không định nghĩa lại.

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu GET /api/v1/analytics/rooms/usage-history, THE system SHALL kiểm tra authentication và permission `analytics.room.read` trước khi xử lý logic khác.

FR-005: WHEN người dùng không truyền `from`/`to` và không truyền `preset`, THE system SHALL áp dụng mặc định `preset=month` (tháng hiện tại, timezone `Asia/Ho_Chi_Minh`) — đúng hành vi Normal Flow bước 2 ("mặc định hiển thị 7 ngày hoặc 30 ngày gần nhất" được cụ thể hóa thành "tháng hiện tại", nhất quán với UC-AA-02 để tránh 2 quy ước mặc định khác nhau trong cùng module — xem CL-4).

FR-006: WHEN người dùng truyền `preset IN ('day','week','month')`, THE system SHALL tự tính `from`/`to` tương ứng theo đúng quy tắc đã có ở UC-AA-02 (ngày hiện tại; tuần Thứ 2–Chủ nhật hiện tại; tháng hiện tại).

FR-007: WHEN người dùng truyền `preset='custom'` kèm `from`/`to` hợp lệ, THE system SHALL dùng đúng khoảng đó.

FR-008: WHEN người dùng truyền `roomId`, THE system SHALL lọc danh sách chỉ còn các phiên của đúng phòng đó (vẫn áp scope Manager nếu có).

FR-009: WHEN người dùng truyền `siteName` và/hoặc `areaName`, THE system SHALL lọc theo đúng `rooms.site_name`/`rooms.area_name` (dùng `areaName` cho nhu cầu lọc theo khu vực/tầng nêu ở Normal Flow bước 4).

FR-010: WHEN người dùng truyền `sortBy` (`reservedStartTime` hoặc `sessionStatus`) và `sortOrder` (`asc`/`desc`), THE system SHALL sắp xếp danh sách phiên theo đúng cột và chiều đó (Normal Flow bước 7).

FR-011: WHEN người dùng không truyền `sortBy`/`sortOrder`, THE system SHALL mặc định sort theo `reservedStartTime DESC` (phiên gần nhất trước).

FR-012: WHEN người dùng truyền `page`/`limit`, THE system SHALL phân trang danh sách phiên theo đúng tham số đó (mặc định `page=1`, `limit=20`, tối đa `limit=100`).

### 3.3 State-driven Requirements

FR-013: WHILE khoảng thời gian lọc (kết hợp scope + filter) không phát sinh bất kỳ `room_bookings` nào, THE system SHALL trả về `sessions=[]`, `summary` toàn 0/null phù hợp, và `message` theo đúng nội dung E1 ("Không có dữ liệu sử dụng phòng họp nào được ghi nhận trong khoảng thời gian từ [from] đến [to].") — không phải lỗi HTTP.

FR-014: WHILE currentUser có role MANAGER và scope phòng trong kỳ lọc rỗng, THE system SHALL trả về `sessions=[]` (cùng hành vi FR-013), không lỗi — nhất quán FR-035 của UC-AA-02.

### 3.4 Optional Feature Requirements

FR-015: WHERE `roomId` được cung cấp, THE system SHALL áp dụng như filter bổ sung sau khi đã áp scope theo role.

FR-016: WHERE `siteName`/`areaName` được cung cấp, THE system SHALL áp dụng như filter bổ sung độc lập với scope phòng ban.

### 3.5 Unwanted Behavior Requirements

FR-017: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-018: IF người dùng không có permission `analytics.room.read`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-019: IF `preset` không thuộc {day, week, month, custom}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-020: IF `preset='custom'` nhưng thiếu `from` hoặc `to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-021: IF `from > to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-022: IF khoảng `to - from` vượt `analytics.dashboard_max_range_days` (tái dùng đúng config key đã tạo ở UC-AA-01/UC-AA-02, không tạo config mới), THEN THE system SHALL trả về 400, error code `DATE_RANGE_TOO_LARGE`, kèm message đúng nội dung E2 ("Khoảng thời gian tra cứu tối đa cho mỗi lần là 6 tháng. Vui lòng thu hẹp lại phạm vi." — nếu giá trị config hiện tại là 180 ngày; message build động theo giá trị config thật, không hard-code "6 tháng").

FR-023: IF `sortBy` không thuộc {reservedStartTime, sessionStatus}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-024: IF `page < 1` hoặc `limit < 1` hoặc `limit > 100`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

### 3.6 Authorization Requirements

FR-025: WHEN người dùng gọi endpoint lịch sử sử dụng phòng, THE system SHALL verify authentication và authorization trước khi thực thi bất kỳ truy vấn tổng hợp/danh sách nào.

FR-026: WHILE currentUser đang ở scope MANAGER, THE system SHALL áp scope phòng ban (tái dùng §0.1 UC-AA-02) cho MỌI truy vấn (`room_bookings`, `room_booking_usages`, `meetings`) của endpoint này.

### 3.7 Data & State Requirements

FR-027: WHEN liệt kê danh sách phiên, THE system SHALL trả về mỗi dòng gồm tối thiểu: `roomId, roomName, meetingId, meetingTitle, hostName, reservedStartTime, reservedEndTime, actualStartTime, actualEndTime, sessionStatus` — đúng các cột nêu ở Normal Flow bước 6 Phần 2.

FR-028: WHEN xác định `sessionStatus` cho 1 phiên, THE system SHALL áp dụng đúng bảng quyết định tại §0.2.

FR-029: WHEN tính `totalReservedHours` (Summary), THE system SHALL tính `SUM(reservedEndTime - reservedStartTime)` của toàn bộ `room_bookings` khớp scope + filter trong kỳ, **không loại trừ** `status=cancelled` (khác UC-AA-02 — xem §1.4).

FR-030: WHEN tính `totalActualHours` (Summary), THE system SHALL tính `SUM(actualEndTime - actualStartTime)` (fallback presence nếu thiếu actual, đúng nguyên tắc đã dùng ở UC-AA-02 FR-028) của các `room_booking_usages` khớp scope + filter; nếu không có phiên nào có dữ liệu thực tế, trả `null`.

FR-031: WHEN tính `noShowCount` (Summary), THE system SHALL đếm số phiên có `sessionStatus = 'no_show'` trong toàn bộ tập kết quả khớp scope + filter (không giới hạn trang hiện tại).

FR-032: WHEN tính `reservationUtilizationRate`/`roomOccupancyRate` (Summary), THE system SHALL áp dụng đúng công thức đã có ở UC-AA-02 (§0.2, §3.8 FR-029/FR-030 của `feat-view-room-usage-dashboard`), tính trên tổng hợp toàn bộ phòng trong kết quả (không phải trung bình từng phòng riêng lẻ).

FR-033: WHEN resolve `hostName` cho 1 phiên, THE system SHALL ưu tiên `meetings.hostId`; nếu `hostId IS NULL`, fallback `meetings.organizerId`.

### 3.8 Notification / Audit Requirements

FR-034: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN endpoint lịch sử sử dụng phòng hoàn tất thành công, THE system SHALL ghi audit log non-blocking với `action_type='read_analytics_room_usage_history'`, `entity_type='room_bookings'`, `metadata_json` chứa tối thiểu `{viewerUserId, viewerRole, from, to, roomId?, page, limit, resolvedScopeRoomIds}`.

### 3.9 Complex / Combined Requirements

FR-035: WHILE currentUser có role MANAGER, WHEN scope phòng trong kỳ lọc rỗng, THE system SHALL trả `sessions=[]` ở cả danh sách lẫn Summary (không lỗi) — đồng thời với FR-014.

FR-036: WHERE `to - from` vượt `analytics.dashboard_max_range_days`, IF request vẫn được gửi, THEN THE system SHALL từ chối tại tầng validate DTO trước khi chạm tới bất kỳ truy vấn danh sách/tổng hợp nào (cùng nguyên tắc FR-036 của UC-AA-02).

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-RUM-04 POST-2, tái dùng UC-AA-02 |
| FR-004–FR-012 | Event-driven | UC-RUM-04 Normal Flow bước 1-7 |
| FR-013, FR-014 | State-driven | UC-RUM-04 E1, BR1 |
| FR-015, FR-016 | Optional Feature | UC-RUM-04 Normal Flow bước 4 |
| FR-017–FR-024 | Unwanted Behavior | UC-RUM-04 E2, validation |
| FR-025, FR-026 | Authorization | UC-RUM-04 BR1 |
| FR-027–FR-033 | Data & State | UC-RUM-04 Normal Flow bước 6 (Phần 1 + Phần 2) |
| FR-034 | Notification/Audit | Pattern audit UC-AA-02 |
| FR-035, FR-036 | Complex | UC-RUM-04 BR1 + E2 |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về endpoint trong vòng dưới 3 giây cho `limit ≤ 100` và khoảng thời gian mặc định (tháng hiện tại), trong điều kiện tải bình thường.

NFR-002: IF khoảng thời gian truy vấn vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL từ chối tại tầng validate (FR-022) trước khi chạy truy vấn danh sách/tổng hợp.

### 4.2 Security

NFR-003: THE system SHALL yêu cầu authentication cho mọi request.

NFR-004: THE system SHALL enforce scope phòng ban Manager ở tầng service, không chỉ dựa vào FE.

### 4.3 Reliability & Consistency

NFR-005: THE system SHALL đảm bảo `summary` và `sessions[]` trong cùng 1 response được tính trên cùng 1 khoảng thời gian, cùng 1 scope, và cùng 1 tập filter (`roomId`/`siteName`/`areaName`) — `summary` không bị giới hạn bởi `page`/`limit`.

NFR-006: THE system SHALL sử dụng index sẵn có trên `room_bookings(room_id)`, `room_bookings(reserved_start_time, reserved_end_time)`, `room_booking_usages(room_id)`, `room_booking_usages(meeting_id)`.

### 4.4 Usability

NFR-007: THE system SHALL trả về clear error messages và field names dạng camelCase, nhất quán với UC-AA-02.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `rooms` | Thông tin phòng, filter `siteName`/`areaName` | Không có `department_id` |
| `room_bookings` | Nguồn danh sách phiên, `totalReservedHours`, trạng thái hủy | Không loại `status` nào (khác UC-AA-02) |
| `room_booking_usages` | `sessionStatus` (completed/no_show/early_empty/released), `totalActualHours` | Nguồn chính xác định No-show |
| `meetings` | `meetingTitle`, `hostName` (qua `hostId`/`organizerId`), scope Manager | |
| `users`, `departments` | Resolve `hostName`, resolve scope Manager | Tái dùng UC-AA-02 |
| `system_configs` | `analytics.late_cancellation_threshold_minutes` (mới), tái dùng `analytics.dashboard_max_range_days`, `analytics.room_operating_hours_per_day` | Không tạo bảng mới |

### 5.2 Dữ liệu đầu vào

`GET /api/v1/analytics/rooms/usage-history`

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| preset | string | Không | `day`/`week`/`month`/`custom`, mặc định `month` | Enum hợp lệ |
| from | date | Chỉ khi `preset=custom` | Bắt đầu khoảng | ISO date |
| to | date | Chỉ khi `preset=custom` | Kết thúc khoảng | ISO date, `to >= from`, range ≤ max |
| roomId | UUID | Không | Lọc 1 phòng | UUID hợp lệ |
| siteName | string | Không | Lọc theo tòa nhà | max 150 ký tự |
| areaName | string | Không | Lọc theo khu vực/tầng | max 150 ký tự |
| sortBy | string | Không | `reservedStartTime`/`sessionStatus`, mặc định `reservedStartTime` | Enum hợp lệ |
| sortOrder | string | Không | `asc`/`desc`, mặc định `desc` | Enum hợp lệ |
| page | number | Không | Mặc định 1 | min 1 |
| limit | number | Không | Mặc định 20 | min 1, max 100 |

### 5.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| period.from/to | date | Khoảng thời gian áp dụng |
| summary.totalReservedHours | number | FR-029 |
| summary.totalActualHours | number \| null | FR-030 |
| summary.noShowCount | number | FR-031 |
| summary.reservationUtilizationRate | number (%) | FR-032 |
| summary.roomOccupancyRate | number \| null (%) | FR-032 |
| sessions[].roomId/roomName | uuid/string | |
| sessions[].meetingId/meetingTitle | uuid/string | |
| sessions[].hostName | string | FR-033 |
| sessions[].reservedStartTime/reservedEndTime | datetime | Kế hoạch |
| sessions[].actualStartTime/actualEndTime | datetime \| null | Thực tế |
| sessions[].sessionStatus | enum | FR-028, §0.2 |
| meta.page/limit/total/totalPages | number | Phân trang FR-012 |

### 5.4 Data Constraints

- Không ghi/sửa/xóa bảng nguồn.
- Không thêm bảng/cột — chỉ thêm 1 key `system_configs` mới (`analytics.late_cancellation_threshold_minutes`).
- Mẫu số = 0 → trả `0`, không chia cho 0 (đúng nguyên tắc UC-AA-02).

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN resolving scope phòng cho MANAGER, THE system SHALL tái dùng đúng query đã có ở UC-AA-02 (§0.1/§FR-DATA-001 file đó), không viết lại.

FR-DATA-002: WHEN xác định `sessionStatus` cho 1 `room_booking`, THE system SHALL áp dụng đúng thứ tự kiểm tra: (1) nếu `status=CANCELLED` → áp `late_cancellation_threshold_minutes` để phân biệt `cancelled_late`/`cancelled`; (2) ngược lại, nếu tồn tại `room_booking_usages` cho booking đó → dùng `usageStatus` (map 1-1 theo bảng §0.2); (3) ngược lại, nếu `reservedEndTime` đã qua thời điểm hiện tại → `pending_evaluation`; (4) ngược lại → `not_started`.

FR-DATA-003: WHEN đọc `lateCancellationThresholdMinutes`, THE system SHALL áp dụng precedence `system_configs['analytics.late_cancellation_threshold_minutes'] → env ANALYTICS_LATE_CANCELLATION_THRESHOLD_MINUTES → default 60`.

### 5.6 Cần làm rõ

- **CL-1**: Dùng `room_bookings.updated_at` làm proxy cho thời điểm hủy — nếu sau này có nghiệp vụ update khác trên booking đã `CANCELLED` (hiện tại chưa thấy trong code), proxy này sẽ sai. Nếu cần chính xác tuyệt đối, cần thêm cột `cancelled_at` — **ngoài phạm vi feature này** (không tự ý thêm cột theo `CLAUDE.md`).
- **CL-2 — ĐÃ CHỐT (2026-07-10)**: `pending_evaluation` là trạng thái kỹ thuật phát sinh khi cron no-show/actual-usage chưa kịp xử lý một booking đã qua giờ kết thúc dự kiến. UC gốc không liệt kê trạng thái này trong danh sách ví dụ ("Hoàn tất, No-show, Hủy sát giờ"). **Quyết định đã duyệt**: vẫn trả về để không che giấu dữ liệu, FE hiển thị nhãn trung tính ("Đang xử lý"/"Chưa có dữ liệu") — KHÔNG ẩn khỏi danh sách.
- **CL-3**: `hostName` fallback sang `organizerId` khi `hostId` null — giả định hợp lý nhưng chưa được UC gốc xác nhận rõ ràng.
- **CL-4 — ĐÃ CHỐT (2026-07-10)**: UC-RUM-04 gốc mô tả mặc định "7 ngày hoặc 30 ngày gần nhất", nhưng để nhất quán với UC-AA-02 (đã áp `preset=month` mặc định) và tránh 2 quy ước mặc định khác nhau trong cùng module `analytics`. **Quyết định đã duyệt**: giữ nguyên `preset=month` làm mặc định, không đổi thành rolling 30-day.
- **CL-5**: UC gốc BR1 chỉ liệt kê Manager/Business Admin; spec này giữ `SYSTEM_ADMIN` trong danh sách actor được phép (đồng quyền Business Admin) để nhất quán với permission `analytics.room.read` đã seed sẵn ở UC-AA-02 — không phát sinh rủi ro vì System Admin vốn có quyền cao nhất.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `preset` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `preset=custom` thiếu `from`/`to`, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `from > to`, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF range vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.
ERR-005: IF `roomId`/`siteName`/`areaName` không hợp lệ định dạng, THEN 400 `VALIDATION_ERROR`.
ERR-006: IF `sortBy`/`sortOrder` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-007: IF `page`/`limit` không hợp lệ, THEN 400 `VALIDATION_ERROR`.

### 6.2 Authentication / Authorization Errors

ERR-008: IF chưa đăng nhập, THEN 401.
ERR-009: IF không có permission `analytics.room.read`, THEN 403 `PERMISSION_DENIED`.

### 6.3 System Errors

ERR-010: IF lỗi truy vấn hệ thống, THEN 500 `INTERNAL_ERROR`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When gọi endpoint lịch sử không truyền tham số,
Then hệ thống trả về danh sách phiên toàn bộ phòng active trong tháng hiện tại, trang 1, tối đa 20 dòng, sort theo `reservedStartTime DESC`.

AC-002:
Given Manager quản lý phòng ban "Kỹ thuật" đã đặt phòng "P101" trong tháng này,
When Manager gọi endpoint lịch sử,
Then hệ thống chỉ trả về các phiên của "P101" (không trả phòng khác).

AC-003:
Given có 1 booking bị hủy 20 phút trước giờ bắt đầu dự kiến (ngưỡng cấu hình 60 phút),
When gọi endpoint lịch sử cho khoảng thời gian chứa booking đó,
Then dòng tương ứng có `sessionStatus='cancelled_late'`.

AC-004:
Given có 1 `room_booking_usages` với `usageStatus='no_show'`,
When gọi endpoint lịch sử,
Then dòng tương ứng có `sessionStatus='no_show'` và `summary.noShowCount` tăng thêm 1.

### 7.2 Validation & Authorization Cases

AC-005:
Given `preset=custom` nhưng thiếu `to`,
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR`.

AC-006:
Given khoảng `to - from` vượt `analytics.dashboard_max_range_days`,
When gọi API,
Then hệ thống reject 400 `DATE_RANGE_TOO_LARGE`.

AC-007:
Given `sortBy='invalidField'`,
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR`.

### 7.3 Business Rule Cases

AC-008:
Given Manager không có phòng nào trong scope kỳ lọc hiện tại,
When gọi endpoint lịch sử,
Then trả về `sessions=[]`, `summary` toàn 0/null, không lỗi (E1 + BR1).

AC-009:
Given khoảng thời gian lọc không có bất kỳ `room_bookings` nào,
When gọi endpoint lịch sử,
Then trả về `sessions=[]` kèm `message` đúng nội dung E1.

AC-010:
Given người dùng truyền `sortBy=sessionStatus&sortOrder=asc`,
When gọi API,
Then danh sách được sắp xếp theo `sessionStatus` tăng dần.

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-011, FR-012, FR-027 |
| AC-002 | FR-003, FR-026, FR-DATA-001 |
| AC-003 | FR-028, FR-DATA-002, FR-DATA-003 |
| AC-004 | FR-028, FR-031 |
| AC-005 | FR-020, ERR-002 |
| AC-006 | FR-022, ERR-004 |
| AC-007 | FR-023, ERR-006 |
| AC-008 | FR-014, FR-035 |
| AC-009 | FR-013 |
| AC-010 | FR-010 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- UC-49 (xuất báo cáo .xlsx/.csv, Alternative Flow A1) — chưa có code, đề xuất feature riêng `feat-export-room-usage-report` — xem §0.5.
- Filter theo `sessionStatus` trong query (chỉ có sort, không có filter trạng thái) — có thể bổ sung sau nếu nghiệp vụ cần.
- Thêm cột `cancelled_at` chính danh cho `room_bookings` — xem CL-1.
- Ẩn hoàn toàn trạng thái `pending_evaluation` khỏi danh sách — xem CL-2.
- WebSocket push/invalidate cho danh sách lịch sử — vượt module boundary, cùng lý do đã loại ở UC-AA-01/UC-AA-02.
- Rollup phòng ban con cho scope Manager.

### 8.2 Có thể xem xét ở feature khác

- `feat-export-room-usage-report` (UC-49 thật sự).
- Filter theo `sessionStatus`.
- Cột `cancelled_at` chính danh nếu nghiệp vụ cần độ chính xác cao hơn cho "Hủy sát giờ".

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement export logic (UC-49) as part of this feature.
OOS-002: THE system SHALL NOT create new database tables or columns for this feature (only 1 new system_configs key).
OOS-003: THE system SHALL NOT add a sessionStatus filter query param in this feature.
OOS-004: THE system SHALL NOT roll up Manager room scope to parent or child departments.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS, đủ 5 pattern cơ bản + Complex.
- [x] Mỗi requirement có mã ID rõ ràng, có traceability.
- [x] Error handling bao gồm validation, authentication, authorization, system error.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Out of Scope có EARS guardrails.
- [x] Không tự ý thêm bảng/cột database mới (chỉ 1 config key).
- [x] Các điểm thiếu thông tin đưa vào mục 5.6 "Cần làm rõ".
- [x] Đối chiếu và tái dùng tối đa logic đã có ở UC-AA-02, không viết lại.
