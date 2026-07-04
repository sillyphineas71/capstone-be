# Feature Specification: Xem thống kê tỷ lệ no-show

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo spec lần đầu cho UC-AA-09 / UC-156 Xem thống kê tỷ lệ no-show. Đã phân tích, liệt kê điểm mơ hồ, đề xuất phương án và được người dùng duyệt 4 quyết định chính (bỏ trend/groupBy, API ranking dùng param `rankBy` trả 1 danh sách phân trang, sort mặc định khác nhau theo từng tab, mốc thời gian dùng `room_bookings.reserved_start_time`) trước khi viết spec (xem §0 RECON). Các điểm mơ hồ nhỏ còn lại chốt theo phương án khuyến nghị (người dùng không phản đối). | Toàn bộ file |

---

- **Feature ID**: AA-NO-SHOW-RATE-001
- **Feature Name**: Xem thống kê tỷ lệ no-show (View No-show Rate Analytics)
- **Use Case**: UC-AA-09 Xem thống kê tỷ lệ no-show (= UC-156 trong API Contract)
- **Module / Domain**: analytics
- **Created Date**: 2026-07-02
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của người dùng — mô tả UC-AA-09 (actor, trigger, precondition, postcondition, normal/alternative flow, exception, business rules)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — mục 16 UC-156 (endpoint/response mẫu, **có `groupBy`/`trend[]` không khớp Normal Flow**)
  - `database_v3_2_compact_39_tables.md` — `no_show_cases`, `room_bookings`, `rooms`, `meetings`, `users`, `departments`
  - `src/modules/rooms/entities/no-show-case.entity.ts` — xác nhận field thật (`bookingId, meetingId, roomId, detectionStatus, resolvedBy, resolutionStatus`)
  - `spec/features/room-utilization/feat-no-show-lifecycle/spec.md` (NSL-001) — xác nhận state machine `detection_status` thật (`risk→warning_sent→released/resolved`, `confirmed`/`dismissed` là hành động thủ công), ngưỡng `no_show.threshold_minutes`
  - `spec/features/analytics/feat-view-dashboard-overview/spec.md` (UC-AA-01) — tái dùng định nghĩa `noShowRate` (`detection_status IN ('confirmed','released')` ÷ `room_bookings.status IN ('approved','active','completed','released')`)
  - `spec/features/analytics/feat-view-meeting-cancel-rate/spec.md` (UC-AA-07) — tái dùng pattern ranking theo organizer (định danh email), bộ lọc `departmentIds/roomId/organizerEmail`
  - `spec/features/analytics/feat-view-room-usage-dashboard/spec.md` (UC-AA-02), `feat-view-room-utilization-rate/spec.md` (UC-AA-08) — tái dùng scope phòng động theo kỳ lọc cho Manager
  - `.specify/memory/constitution.md`, `CLAUDE.md`

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. Định nghĩa "no-show" — tái dùng nguyên, không định nghĩa lại

Đã xác nhận qua [feat-no-show-lifecycle/spec.md §0.4](../../room-utilization/feat-no-show-lifecycle/spec.md) và [no-show-case.entity.ts](../../../../src/modules/rooms/entities/no-show-case.entity.ts): `NoShowDetectionStatus = risk|confirmed|warning_sent|released|dismissed|resolved`. `risk`/`warning_sent` còn đang trong quy trình xử lý (chưa chốt), `dismissed`/`resolved` là false-positive (occupant tới muộn, không phải no-show thật). **Quyết định**: tái dùng đúng định nghĩa đã chốt ở UC-AA-01/UC-AA-05 — 1 case được tính là no-show khi và chỉ khi `detection_status IN ('confirmed','released')`.

### 0.2. Mốc thời gian lọc kỳ — `room_bookings.reserved_start_time` — đã duyệt

**Quyết định đã duyệt**: dùng `room_bookings.reserved_start_time` (không phải `no_show_cases.detected_at` hay `meetings.start_time`) làm mốc lọc `[from,to]` cho cả tử số (`no_show_cases` qua `booking_id`) lẫn mẫu số (`room_bookings` trực tiếp) — đảm bảo 2 phía dùng chung 1 nguồn thời gian, không lệch pha do `detected_at` luôn trễ hơn `reserved_start_time` đúng bằng ngưỡng phút cấu hình (`no_show.threshold_minutes`).

### 0.3. Mẫu số `totalBookings` — tái dùng định nghĩa UC-AA-01

**Quyết định**: `totalBookings` = đếm `room_bookings` có `status IN ('approved','active','completed','released')` trong scope + kỳ lọc (theo `reserved_start_time`) — tái dùng đúng mẫu số `noShowRate` đã chốt ở [feat-view-dashboard-overview/spec.md FR-028](../feat-view-dashboard-overview/spec.md).

### 0.4. Bỏ `trend[]`/`groupBy` khỏi response — đã duyệt

`API_CONTRACT` UC-156 gốc có `trend: []` và query `groupBy`, nhưng Normal Flow của UC-AA-09 (ưu tiên cao nhất theo CLAUDE.md mục 1) chỉ mô tả 2 thẻ KPI + bảng xếp hạng 3 tab, không có biểu đồ xu hướng nào. **Quyết định đã duyệt**: bỏ hẳn `trend`/`groupBy`, giữ đúng phạm vi Normal Flow, không tự thêm tính năng ngoài yêu cầu.

### 0.5. API bảng xếp hạng — tham số `rankBy`, trả 1 danh sách phân trang mỗi lần gọi — đã duyệt

**Quyết định đã duyệt**: dùng 1 tham số `rankBy IN ('room','department','organizer')` (mặc định `room`), mỗi lần gọi chỉ tính và trả về đúng 1 danh sách tương ứng, có phân trang `page`/`limit` chuẩn (không phải Top 10 cố định như UC-AA-07 — đây là bảng đầy đủ, người dùng cần xem hết chứ không chỉ cảnh báo nổi bật). Khớp đúng hành vi UI "click tab nào tải bảng đó", tránh tính toán thừa cả 3 bảng khi người dùng chỉ xem 1 tab.

### 0.6. Sort mặc định khác nhau theo từng tab — đã duyệt

**Quyết định đã duyệt** (đúng nguyên văn Normal Flow bước 4):
- `rankBy=room`: sort theo `noShowCount` giảm dần ("phòng họp nào thường xuyên bị bỏ trống nhất").
- `rankBy=department`: sort theo `noShowRate` giảm dần ("bộ phận nào có tỷ lệ... cao nhất").
- `rankBy=organizer`: sort theo `noShowCount` giảm dần ("cá nhân vi phạm nhiều nhất").

Mỗi item trong cả 3 danh sách đều trả đủ cả `noShowCount` lẫn `noShowRate` (không chỉ trường đang sort) để FE có thể hiển thị cột phụ.

### 0.7. Không loại trừ mẫu nhỏ, dùng cờ `lowSampleSize` thay vì ngưỡng cứng — đã duyệt

Khác với Top-10 "cảnh báo" ở UC-AA-07 (có ngưỡng `organizedCount>=3` để loại nhiễu), bảng ở đây là danh sách đầy đủ có phân trang. **Quyết định**: không loại bất kỳ phòng/phòng ban/organizer nào khỏi danh sách; thêm cờ `lowSampleSize = true` khi `totalBookings < 3` để FE tự quyết định hiển thị cảnh báo mẫu nhỏ, không ẩn dữ liệu.

### 0.8. Tab "Theo phòng ban" với role MANAGER — không cần logic ẩn đặc biệt

Khác UC-AA-07/08 (nơi `topDepartments`/`topOrganizers` quét toàn công ty nên phải chặn thủ công cho Manager), ở đây MỌI truy vấn (`room_bookings`, `no_show_cases`) đã bị giới hạn theo scope Manager ngay từ WHERE clause — tab `rankBy=department` với Manager tự nhiên chỉ trả về đúng 1 dòng (phòng ban của họ), không phải rò rỉ dữ liệu. **Quyết định**: không cần thêm guard riêng, hành vi tự nhiên từ scope filter là đủ.

### 0.9. Scope phòng Manager cho tab "Theo phòng" — tái dùng scope động theo kỳ lọc

**Quyết định**: tái dùng đúng scope động đã chốt ở [feat-view-room-usage-dashboard/spec.md §0.1](../feat-view-room-usage-dashboard/spec.md) — phòng nào có `room_bookings` gắn với `meetings` do phòng ban Manager quản lý tổ chức, trong đúng `[from,to]` đang lọc.

### 0.10. Bộ lọc chuyên sâu — tái dùng bộ lọc đã có ở UC-AA-07

Normal Flow bước 5 không liệt kê cụ thể tiêu chí lọc. **Quyết định**: tái dùng nguyên bộ lọc đã chốt ở UC-AA-07: `preset` (khoảng thời gian), `departmentIds[]` (multi-select), `roomId` (đơn), `organizerEmail` (resolve server-side).

### 0.11. EX1 — trigger khi `noShowCount=0`, không phải khi "không có dữ liệu"

Đọc kỹ EX1: điều kiện trigger là "không ghi nhận bất kỳ ca No-show nào" — khác các EX1 khác (thường trigger khi không có booking/meeting nào). **Quyết định**: EX1 trigger đúng khi `noShowCount=0` (dù `totalBookings` có thể > 0 — nghĩa là kỳ đó có nhiều booking nhưng KHÔNG có ca no-show nào, đây là kết quả TỐT). Thông báo dùng nguyên văn tích cực: "Tuyệt vời! Không ghi nhận trường hợp lãng phí phòng họp nào trong khoảng thời gian này." — khác tông với các EX1 trung tính/cảnh báo ở feature khác.

### 0.12. Field/entity xác nhận tồn tại thật (không suy đoán)

- `NoShowCaseEntity`: `id, bookingId, meetingId, roomId, detectionStatus`. **Có sẵn `meetingId` trực tiếp** — không cần suy diễn qua `room_bookings` để resolve organizer.
- `RoomBookingEntity`: `id, meetingId, roomId, reservedStartTime, reservedEndTime, status`.
- `MeetingEntity`: `id, organizerId, deletedAt`.
- `UserEntity`: `id, email, fullName, departmentId`.
- `DepartmentEntity`: `id, departmentName, managerUserId`.
- `RoomEntity`: `id, roomName, isActive`.
- `SystemConfigEntity` — tái dùng `analytics.dashboard_max_range_days` (UC-AA-01), không tạo key mới. `no_show.threshold_minutes` (dùng cho vòng đời phát hiện no-show) KHÔNG liên quan đến feature đọc thống kê này.
- **Không có bảng/cột nào cần thêm.**

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `analytics`, cung cấp màn hình giám sát tỷ lệ "đặt phòng ảo" (no-show) gồm 2 thẻ KPI tổng hợp và 1 bảng xếp hạng 3 tab (phòng/phòng ban/người tổ chức) để xác định nguồn gốc vi phạm. Tính năng **read-only tuyệt đối**.

### 1.2 Mục tiêu

Cho phép Manager (giới hạn phạm vi phòng ban phụ trách), Business Admin, System Admin xem tổng số ca no-show, tỷ lệ no-show, và bảng xếp hạng chi tiết theo phòng/phòng ban/người tổ chức, lọc theo khoảng thời gian/phòng ban/phòng họp/email người tổ chức.

### 1.3 Giá trị mang lại

- Cho Manager: xác định nhân sự/phòng trong phòng ban mình đang lãng phí tài nguyên phòng họp để chấn chỉnh.
- Cho Business Admin/System Admin: giám sát vấn nạn no-show toàn công ty, khoanh vùng phòng ban/cá nhân cần can thiệp chính sách.

### 1.4 Giả định

- "No-show" = `detection_status IN ('confirmed','released')` — §0.1.
- Mốc thời gian lọc = `room_bookings.reserved_start_time` — §0.2.
- Không có biểu đồ xu hướng (`trend`/`groupBy`) — §0.4.
- Bảng xếp hạng dùng `rankBy`, trả 1 danh sách phân trang mỗi lần gọi — §0.5.
- Sort mặc định khác nhau theo tab: `room`/`organizer`=count, `department`=rate — §0.6.
- Không loại trừ mẫu nhỏ, chỉ gắn cờ `lowSampleSize` — §0.7.

### 1.5 Clarifications Resolved

Toàn bộ điểm mơ hồ đã liệt kê và người dùng duyệt (4 quyết định chính: bỏ trend, API `rankBy` phân trang, sort khác nhau theo tab, mốc thời gian `reserved_start_time`), cùng các phương án khuyến nghị còn lại không bị phản đối — tổng hợp tại §0.1–§0.11.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager / Approver | Quản lý cấp phòng ban | Xem KPI + bảng xếp hạng giới hạn trong phạm vi phòng ban mình phụ trách (scope động theo kỳ lọc) |
| Business Admin | Quản trị viên doanh nghiệp | Xem KPI + bảng xếp hạng toàn công ty, lọc theo `departmentIds`/`roomId`/`organizerEmail` bất kỳ |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin (nhất quán API_CONTRACT UC-156) |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Permission bắt buộc: `analytics.room.read` (dùng chung với UC-AA-02/08, đã seed).
- `SYSTEM_ADMIN`/`BUSINESS_ADMIN`: không giới hạn scope.
- `MANAGER`: scope phòng động theo kỳ lọc (tái dùng UC-AA-02/08 §0.9); scope phòng ban tĩnh (`departments.manager_user_id`) cho việc lọc/xếp hạng theo tổ chức/người tổ chức.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `analytics.room.read`.
- Scope Manager không rollup phòng ban con, không dùng `direct_manager_id` (nhất quán các UC-AA trước).

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về toàn bộ dữ liệu dưới dạng read-only — không tạo/sửa/xóa bất kỳ bản ghi nào trong `no_show_cases`, `room_bookings`, `meetings`, `users`, `departments`, `rooms`.

FR-002: THE system SHALL tính toán lại toàn bộ `noShowCount`/`totalBookings`/`noShowRate`/`ranking` trực tiếp từ dữ liệu nguồn (on-demand aggregation) tại mỗi lần gọi API.

FR-003: THE system SHALL xác định 1 `no_show_cases` là no-show hợp lệ khi và chỉ khi `detection_status IN ('confirmed','released')` (§0.1).

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu GET /api/v1/analytics/rooms/no-show-rate, THE system SHALL kiểm tra authentication và permission `analytics.room.read` trước khi xử lý logic khác.

FR-005: WHEN người dùng không truyền `preset`/`from`/`to`, THE system SHALL áp dụng mặc định `preset='month'` (Tháng hiện tại, timezone `Asia/Ho_Chi_Minh`).

FR-006: WHEN người dùng truyền `preset IN ('day','week','month','quarter')`, THE system SHALL tự tính `from`/`to` tương ứng, bỏ qua `from`/`to` nếu có truyền kèm.

FR-007: WHEN người dùng truyền `preset='custom'` kèm `from`/`to` hợp lệ, THE system SHALL dùng đúng khoảng đó.

FR-008: WHEN currentUser có role MANAGER và không truyền `departmentIds`, THE system SHALL tự động giới hạn dữ liệu trong toàn bộ phòng ban mình quản lý.

FR-009: WHEN currentUser có role MANAGER và truyền `departmentIds` mà mọi phần tử thuộc phòng ban mình quản lý, THE system SHALL lọc đúng các phòng ban đó.

FR-010: WHEN currentUser có role BUSINESS_ADMIN hoặc SYSTEM_ADMIN và truyền `departmentIds`, THE system SHALL lọc theo đúng các phòng ban đó trong toàn hệ thống.

FR-011: WHEN người dùng truyền `roomId`, THE system SHALL lọc chỉ còn đúng 1 phòng đó (vẫn áp scope Manager nếu có).

FR-012: WHEN người dùng truyền `organizerEmail`, THE system SHALL resolve ra `users.id` bằng so khớp chính xác không phân biệt hoa/thường, sau đó lọc theo `meetings.organizer_id` tương ứng.

FR-013: WHEN người dùng không truyền `rankBy`, THE system SHALL mặc định `rankBy='room'`.

FR-014: WHEN người dùng truyền `rankBy IN ('room','department','organizer')`, THE system SHALL tính và trả về đúng 1 danh sách xếp hạng tương ứng, sort mặc định theo §0.6.

FR-015: WHEN người dùng không truyền `page`/`limit`, THE system SHALL mặc định `page=1`, `limit=20`.

FR-016: WHEN người dùng truyền `page`/`limit` hợp lệ, THE system SHALL phân trang danh sách xếp hạng theo đúng giá trị đó (`limit` tối đa 100).

### 3.3 State-driven Requirements

FR-017: WHILE `noShowCount = 0` trong toàn bộ scope + filter + `[from,to]` (bất kể `totalBookings` bằng hay khác 0), THE system SHALL trả `noShowCount=0`, `noShowRate=0`, `ranking.items=[]`, kèm `message` đúng nguyên văn EX1: "Tuyệt vời! Không ghi nhận trường hợp lãng phí phòng họp nào trong khoảng thời gian này." (§0.11).

FR-018: WHILE 1 item (phòng/phòng ban/organizer) trong `ranking.items` có `totalBookings < 3`, THE system SHALL gắn cờ `lowSampleSize=true` cho item đó, KHÔNG loại khỏi danh sách (§0.7).

FR-019: WHILE `organizerEmail` được truyền nhưng không khớp bất kỳ `users.email` nào, THE system SHALL coi như filter không match meeting nào và trả response theo FR-017.

### 3.4 Optional Feature Requirements

FR-020: WHERE `departmentIds`/`roomId`/`organizerEmail` được cung cấp, THE system SHALL áp dụng như filter bổ sung sau khi đã áp scope theo role.

### 3.5 Unwanted Behavior Requirements

FR-021: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-022: IF người dùng không có permission `analytics.room.read`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-023: IF currentUser có role MANAGER và bất kỳ phần tử nào trong `departmentIds` nằm ngoài phòng ban mình quản lý, THEN THE system SHALL trả về 403, error code `DEPARTMENT_OUT_OF_SCOPE`.

FR-024: IF currentUser có role MANAGER và `roomId` không thuộc scope phòng trong kỳ lọc, THEN THE system SHALL trả về 403, error code `ROOM_OUT_OF_SCOPE`.

FR-025: IF `preset` không thuộc {day, week, month, quarter, custom}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-026: IF `preset='custom'` nhưng thiếu `from`/`to`, hoặc `from > to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-027: IF `rankBy` không thuộc {room, department, organizer}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-028: IF `departmentIds`/`roomId` không phải UUID hợp lệ, hoặc `organizerEmail` sai định dạng email, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-029: IF `page`/`limit` không hợp lệ (không phải số nguyên dương, `limit` vượt 100), THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-030: IF khoảng `to - from` vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL trả về 400, error code `DATE_RANGE_TOO_LARGE`.

### 3.6 Authorization Requirements

FR-031: WHEN the user performs a protected action (xem thống kê no-show), THE system SHALL verify authentication và authorization trước khi thực thi aggregation query.

FR-032: WHILE currentUser đang ở scope MANAGER, THE system SHALL áp scope phòng ban/phòng cho MỌI truy vấn (`no_show_cases`, `room_bookings`, `meetings`).

### 3.7 Data & State Requirements

FR-033: WHEN tính `totalBookings`, THE system SHALL đếm `room_bookings` có `status IN ('approved','active','completed','released')` trong scope + filter + `[from,to]` (theo `reserved_start_time`).

FR-034: WHEN tính `noShowCount`, THE system SHALL đếm `no_show_cases` thỏa FR-003, gắn với `room_bookings` thỏa FR-033 (qua `booking_id`).

FR-035: WHEN tính `noShowRate`, THE system SHALL tính `noShowCount ÷ totalBookings × 100`, làm tròn 1 chữ số thập phân. Nếu `totalBookings=0` → trả `0`.

FR-036: WHEN `rankBy='room'`, THE system SHALL nhóm theo `rooms.id`, tính `noShowCount`/`totalBookings`/`noShowRate` mỗi phòng trong scope + filter + kỳ, sort giảm dần theo `noShowCount` (tie-break `noShowRate`).

FR-037: WHEN `rankBy='department'`, THE system SHALL nhóm theo `users.department_id` (qua `meetings.organizer_id`), tính 3 chỉ số mỗi phòng ban, sort giảm dần theo `noShowRate` (tie-break `noShowCount`).

FR-038: WHEN `rankBy='organizer'`, THE system SHALL nhóm theo `meetings.organizer_id`, tính 3 chỉ số mỗi organizer, resolve `email`/`fullName`, sort giảm dần theo `noShowCount` (tie-break `noShowRate`).

FR-039: WHEN trả `ranking`, THE system SHALL kèm `page`, `limit`, `total` (tổng số phần tử trước phân trang), `totalPages`.

### 3.8 Notification / Audit Requirements

FR-040: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN yêu cầu hoàn tất thành công, THE system SHALL ghi audit log non-blocking `action_type='read_analytics_no_show_rate'`, `entity_type='no_show_cases'`, `metadata_json` chứa tối thiểu `{viewerUserId, viewerRole, from, to, rankBy, page, limit, departmentIds, roomId, organizerEmail, resolvedScopeDepartmentIds}`.

### 3.9 Complex / Combined Requirements

FR-041: WHILE currentUser có role MANAGER, WHEN currentUser không quản lý phòng ban nào, THE system SHALL trả về response rỗng như FR-017 thay vì lỗi.

FR-042: WHERE `to - from` vượt `analytics.dashboard_max_range_days`, IF request vẫn được gửi, THEN THE system SHALL từ chối tại tầng validate DTO trước khi chạm tới bất kỳ truy vấn tổng hợp nào.

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-AA-09 POST-2, BR1, §0.1 |
| FR-004–FR-016 | Event-driven | UC-AA-09 Normal Flow bước 1-5 |
| FR-017–FR-019 | State-driven | UC-AA-09 EX1, §0.7 |
| FR-020 | Optional Feature | UC-AA-09 Normal Flow bước 5 |
| FR-021–FR-030 | Unwanted Behavior | UC-AA-09 BR1, validation |
| FR-031, FR-032 | Authorization | UC-AA-09 BR1 |
| FR-033–FR-039 | Data & State | UC-AA-09 Normal Flow bước 3-4, 6 |
| FR-040 | Notification/Audit | Pattern audit đã dùng ở UC-AA-01/02/07/08 |
| FR-041, FR-042 | Complex | BR1 + range guard |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về kết quả trong vòng dưới 2 giây cho khoảng thời gian mặc định (tháng hiện tại) trong điều kiện tải bình thường.

NFR-002: IF khoảng thời gian truy vấn vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL từ chối tại tầng validate (FR-030) trước khi chạy aggregation.

### 4.2 Security

NFR-003: THE system SHALL yêu cầu authentication cho mọi request.

NFR-004: THE system SHALL enforce scope phòng ban/phòng Manager ở tầng service, không chỉ dựa vào FE.

### 4.3 Reliability & Consistency

NFR-005: THE system SHALL đảm bảo `noShowCount`/`totalBookings`/`noShowRate` ở cấp tổng (KPI card) độc lập với `rankBy` đang chọn — không đổi khi người dùng chuyển tab.

NFR-006: THE system SHALL sử dụng index sẵn có trên `no_show_cases(booking_id)`, `no_show_cases(room_id)`, `no_show_cases(detection_status)`, `room_bookings(room_id, reserved_start_time)`.

### 4.4 Usability

NFR-007: THE system SHALL trả về clear error messages và field names dạng camelCase.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `no_show_cases` | Tử số `noShowCount` | `detection_status IN ('confirmed','released')`, có sẵn `meeting_id` |
| `room_bookings` | Mẫu số `totalBookings`, mốc thời gian lọc | `status IN ('approved','active','completed','released')`, theo `reserved_start_time` |
| `meetings` | Resolve organizer (`organizer_id`) | Qua `no_show_cases.meeting_id` |
| `rooms` | `rankBy=room` — tên phòng | |
| `users`, `departments` | Resolve scope Manager, `rankBy=organizer/department` | |
| `system_configs` | Tái dùng `analytics.dashboard_max_range_days` | Không tạo key mới |

### 5.2 Dữ liệu đầu vào

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| preset | string | Không | `day`/`week`/`month`/`quarter`/`custom`, mặc định `month` | Enum hợp lệ |
| from | date | Chỉ khi `preset=custom` | Bắt đầu khoảng | ISO date |
| to | date | Chỉ khi `preset=custom` | Kết thúc khoảng | ISO date, `to>=from`, range ≤ max |
| departmentIds | UUID[] | Không | Lọc 1 hoặc nhiều phòng ban | MANAGER chỉ được truyền phòng ban mình quản lý |
| roomId | UUID | Không | Lọc phòng họp | UUID hợp lệ |
| organizerEmail | string | Không | Lọc theo email người tổ chức | Định dạng email hợp lệ |
| rankBy | string | Không | `room`/`department`/`organizer`, mặc định `room` | Enum hợp lệ |
| page | integer | Không | Mặc định `1` | Số nguyên dương |
| limit | integer | Không | Mặc định `20` | Số nguyên dương, tối đa `100` |

### 5.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| period.from/to | date | Khoảng thời gian áp dụng |
| noShowCount | integer | Tổng số ca no-show hợp lệ (FR-034) |
| totalBookings | integer | Tổng số booking hợp lệ (FR-033) |
| noShowRate | number | `noShowCount ÷ totalBookings × 100`, làm tròn 1 chữ số thập phân |
| ranking.rankBy | string | `room`/`department`/`organizer` đang xem |
| ranking.items[].id | UUID | `roomId`/`departmentId`/`userId` tùy `rankBy` |
| ranking.items[].name | string | `roomName`/`departmentName`/`fullName` tùy `rankBy` |
| ranking.items[].email | string (chỉ `rankBy=organizer`) | Email người tổ chức |
| ranking.items[].noShowCount | integer | FR-036/037/038 |
| ranking.items[].totalBookings | integer | FR-036/037/038 |
| ranking.items[].noShowRate | number | FR-036/037/038 |
| ranking.items[].lowSampleSize | boolean | `true` nếu `totalBookings < 3` (FR-018) |
| ranking.page/limit/total/totalPages | integer | FR-039 |
| message | string (optional) | Khi `noShowCount=0` — EX1 (§0.11) |

### 5.4 Data Constraints

- Không ghi/sửa/xóa bảng nguồn.
- Không thêm bảng/cột/config key mới.
- Không trả `trend`/`groupBy` (§0.4).
- Không loại trừ item nào khỏi `ranking.items` do mẫu nhỏ — chỉ gắn cờ `lowSampleSize` (§0.7).

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN resolving scope cho MANAGER, THE system SHALL tái dùng đúng query `SELECT id FROM departments WHERE manager_user_id = currentUser.id` đã có ở UC-AA-01/04/05/06/07.

FR-DATA-002: WHEN resolving scope phòng cho `rankBy=room` với MANAGER, THE system SHALL tái dùng đúng công thức scope động theo kỳ lọc đã có ở UC-AA-02/08.

FR-DATA-003: WHEN resolving `organizerEmail`, THE system SHALL truy vấn `SELECT id FROM users WHERE LOWER(email) = LOWER(:organizerEmail)`.

### 5.6 Cần làm rõ

- **CL-1**: `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-156 hiện có `groupBy`/`trend[]`/`byRoom[]` không khớp thiết kế mới (`rankBy` phân trang, không có trend) — cần task đồng bộ tài liệu riêng.
- **CL-2**: Ngưỡng `lowSampleSize = totalBookings < 3` (§0.7) là giả định hợp lý, không có trong BR gốc — nhất quán ngưỡng `>=3` đã dùng ở UC-AA-07 nhưng dùng làm CỜ thay vì ĐIỀU KIỆN LOẠI TRỪ.
- **CL-3**: `rankBy=department` với MANAGER trả về danh sách chỉ 1 phần tử (phòng ban của họ) — hành vi tự nhiên từ scope, không phải bug, đã ghi rõ ở §0.8.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `preset` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `preset=custom` thiếu `from`/`to` hoặc `from>to`, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `rankBy` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF `departmentIds`/`roomId`/`organizerEmail` sai định dạng, THEN 400 `VALIDATION_ERROR`.
ERR-005: IF `page`/`limit` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-006: IF range vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.

### 6.2 Authentication / Authorization Errors

ERR-007: IF chưa đăng nhập, THEN 401.
ERR-008: IF không có permission `analytics.room.read`, THEN 403 `PERMISSION_DENIED`.
ERR-009: IF MANAGER truyền `departmentIds` có phần tử ngoài scope, THEN 403 `DEPARTMENT_OUT_OF_SCOPE`.
ERR-010: IF MANAGER truyền `roomId` ngoài scope kỳ lọc, THEN 403 `ROOM_OUT_OF_SCOPE`.

### 6.3 System Errors

ERR-011: IF lỗi truy vấn hệ thống, THEN 500 `INTERNAL_ERROR`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When gọi API không tham số,
Then hệ thống trả về `noShowCount`/`totalBookings`/`noShowRate` toàn công ty tháng hiện tại, kèm `ranking` (`rankBy=room`, sort theo `noShowCount`).

AC-002:
Given Manager quản lý phòng ban "Kỹ thuật",
When Manager gọi API `rankBy=department`,
Then `ranking.items` chỉ có đúng 1 phần tử ("Kỹ thuật"), không lỗi.

AC-003:
Given `rankBy=organizer`,
When gọi API,
Then `ranking.items` sort giảm dần theo `noShowCount`, mỗi item có `email`, `fullName`, `noShowRate`.

### 7.2 Validation & Authorization Cases

AC-004:
Given Manager truyền `roomId` chưa từng được phòng ban mình đặt trong kỳ lọc,
When gọi API `rankBy=room`,
Then hệ thống reject 403 `ROOM_OUT_OF_SCOPE`.

AC-005:
Given `rankBy` không hợp lệ,
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR`.

### 7.3 Business Rule Cases

AC-006:
Given kỳ lọc có 50 booking nhưng không booking nào có `no_show_cases` với `detection_status IN ('confirmed','released')`,
When gọi API,
Then `noShowCount=0`, `noShowRate=0`, `ranking.items=[]`, kèm `message` đúng nguyên văn EX1 (dù `totalBookings=50 > 0`).

AC-007:
Given 1 phòng chỉ có 2 booking trong kỳ, cả 2 đều no-show,
When gọi API `rankBy=room`,
Then phòng đó xuất hiện với `noShowCount=2, totalBookings=2, noShowRate=100, lowSampleSize=true` (KHÔNG bị loại khỏi danh sách).

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-013, FR-033-FR-036 |
| AC-002 | FR-037, §0.8 |
| AC-003 | FR-038 |
| AC-004 | FR-024, ERR-010 |
| AC-005 | FR-027, ERR-003 |
| AC-006 | FR-017 |
| AC-007 | FR-018, FR-036 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Biểu đồ xu hướng (`trend`/`groupBy`) — đã quyết định bỏ (§0.4).
- Trả cả 3 danh sách `byRoom/byDepartment/byOrganizer` cùng lúc trong 1 response — đã chọn `rankBy` phân trang từng tab (§0.5).
- Loại trừ item mẫu nhỏ khỏi `ranking.items` — chỉ gắn cờ `lowSampleSize` (§0.7).
- Guard đặc biệt cho `rankBy=department` với MANAGER — hành vi tự nhiên từ scope là đủ (§0.8).
- Cấu hình `no_show.threshold_minutes` — thuộc feature vòng đời no-show (NSL-001), không thuộc phạm vi đọc thống kê này.
- Rollup phòng ban con cho scope Manager.
- WebSocket push/invalidate.

### 8.2 Có thể xem xét ở feature khác

- Đồng bộ `API_CONTRACT_v1.0_with_system_roles.md` với thiết kế `rankBy`/bỏ `trend` (CL-1).
- Nâng `lowSampleSize` thành ngưỡng cấu hình được qua `system_configs` nếu cần (CL-2).

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT return a trend[] time-series array as part of this feature's response.
OOS-002: THE system SHALL NOT return all 3 ranking lists (room/department/organizer) in a single response — only the list selected by rankBy.
OOS-003: THE system SHALL NOT exclude low-sample-size items from ranking.items — flag with lowSampleSize instead.
OOS-004: THE system SHALL NOT roll up Manager department/room scope to parent or child departments.
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
