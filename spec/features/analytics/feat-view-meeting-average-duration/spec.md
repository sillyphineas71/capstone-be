# Feature Specification: Xem thống kê thời lượng trung bình cuộc họp

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo spec lần đầu cho UC-AA-06 / UC-153 Xem thống kê thời lượng trung bình cuộc họp. Đã phân tích, liệt kê điểm mơ hồ, đề xuất phương án, người dùng chọn Phương án A cho population (điểm 3) và duyệt toàn bộ đề xuất còn lại trước khi viết spec (xem §0 RECON). Đã cân nhắc gộp vào UC-AA-04 nhưng quyết định giữ tách riêng. | Toàn bộ file |

---

- **Feature ID**: AA-MEETING-AVERAGE-DURATION-001
- **Feature Name**: Xem thống kê thời lượng trung bình cuộc họp (View Meeting Average Duration)
- **Use Case**: UC-AA-06 Xem thống kê thời lượng trung bình cuộc họp (= UC-153 trong API Contract)
- **Module / Domain**: analytics
- **Created Date**: 2026-07-02
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của người dùng — mô tả UC-AA-06 (actor, trigger, precondition, postcondition, normal/alternative flow, exception, business rules)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — mục 16 UC-153
  - `database_v3_2_compact_39_tables.md` — `room_bookings`, `room_booking_usages`, `meetings`
  - `spec/features/analytics/feat-view-dashboard-overview/` (UC-AA-01) — tái dùng fallback presence, config `max_range_days`
  - `spec/features/analytics/feat-view-room-usage-dashboard/` (UC-AA-02) — tái dùng nguồn `room_bookings`/`room_booking_usages` cho dự kiến/thực tế
  - `spec/features/analytics/feat-view-meeting-count-by-period/` (UC-AA-04) — tái dùng pattern `granularity`, bucket generation, scope Manager tĩnh
  - `spec/features/analytics/feat-view-meeting-status-breakdown/` (UC-AA-05) — tái dùng pattern `departmentIds` multi-select
  - `.specify/memory/constitution.md`, `CLAUDE.md`

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. Quyết định KHÔNG gộp vào UC-AA-04

Dù cùng hình dạng time-series theo bucket, UC-AA-06 tính **2 giá trị song song mỗi bucket** (dự kiến vs thực tế, biểu đồ cột kép) từ nguồn dữ liệu khác hẳn (`room_bookings` + `room_booking_usages`, giống cách tính ở UC-AA-02) thay vì chỉ đếm `meetings.status` như UC-AA-04. `API_CONTRACT` cũng thiết kế UC-153 là endpoint riêng. **Quyết định**: giữ tách riêng, tái dùng hạ tầng ở tầng implementation.

### 0.2. Bỏ param `mode`, trả cả 2 giá trị song song — đã duyệt

UC-153 gốc dùng `mode=actual` (chọn 1 trong 2 chế độ), không khớp yêu cầu "đối chiếu song song" của Normal Flow bước 2. **Quyết định đã duyệt**: bỏ hẳn `mode`, mỗi bucket trả luôn cả `plannedAverageMinutes` và `actualAverageMinutes`.

### 0.3. Nguồn dữ liệu cho "Dự kiến"/"Thực tế" — đã duyệt

- **Dự kiến** = `room_bookings.reserved_start_time`/`reserved_end_time` (đúng nghĩa "quỹ thời gian đăng ký giữ phòng ban đầu"), không dùng `meetings.start_time/end_time`.
- **Thực tế** = `room_booking_usages.actual_start_time`/`actual_end_time`, fallback `first_presence_at`/`last_presence_at` nếu thiếu actual (tái dùng đúng pattern fallback đã dùng ở UC-AA-01 FR-013/UC-AA-02 FR-028).

### 0.4. Population — Phương án A đã chọn (chỉ tính `status='completed'`)

**Quyết định đã duyệt (Phương án A)**: chỉ tính trên `meetings.status='completed'` cho **cả 2** cột "Dự kiến" và "Thực tế" — đảm bảo cùng 1 tập N, so sánh táo với táo. Loại hoàn toàn `scheduled`/`cancelled`/`draft`/`pending_approval`/`in_progress` khỏi thống kê này. Đây là suy luận hợp lý từ mô tả nghiệp vụ (UC-AA-06 không có BR tường minh về việc này, chỉ có đúng 1 BR về scope role) — đã được người dùng xác nhận.

### 0.5. Bucket rỗng trả `null`, không trả `0` — đã duyệt

Trung bình cộng của tập rỗng không xác định (chia 0/0). **Quyết định đã duyệt**: bucket không có meeting `completed` nào → `plannedAverageMinutes=null`, `actualAverageMinutes=null`, `completedMeetingCount=0` — khác với cách UC-AA-04/05 dùng `count=0` hợp lệ (ở đó 0 là số đếm, còn đây là trung bình không xác định).

### 0.6. `granularity` mở rộng thêm `quarter`, tách biệt với `preset` range — đã duyệt

Câu "Khoảng thời gian (Ngày, Tuần, Tháng, Quý)" ở Normal Flow bước 3 được hiểu là **đơn vị nhóm bucket trục hoành** (`granularity`), giống UC-AA-04, vì bước 2 mô tả "hai cột đối chiếu cạnh nhau cho mỗi đơn vị thời gian (Tuần/Tháng)". **Quyết định đã duyệt**: `granularity IN ('day','week','month','quarter')`, mặc định `week`. `from`/`to` là khoảng lọc tổng thể riêng biệt, mặc định "Tháng hiện tại", có bổ sung `custom` (không được UC nhắc tới tường minh nhưng thêm để nhất quán các feature khác — ghi rõ là bổ sung).

### 0.7. Label bucket cho `quarter` — đã duyệt

`"YYYY-Q#"` (vd `"2026-Q3"`), nhất quán style `"YYYY-'W'WW"`/`"YYYY-MM"` đã dùng ở UC-AA-04.

### 0.8. Bỏ `medianMinutes` — đã duyệt

UC-AA-06 chỉ yêu cầu trung bình cộng. **Quyết định đã duyệt**: không trả `medianMinutes`, giữ tối giản, tránh thêm SQL percentile không cần thiết.

### 0.9. Multi-select phòng ban + phòng họp đơn — đã duyệt

`departmentIds` (mảng UUID, tái dùng pattern UC-AA-05), `roomId` (UUID đơn, tái dùng pattern UC-AA-04) — filter thuần túy, `roomId` không kiểm tra sở hữu.

### 0.10. Field/entity xác nhận tồn tại thật

- `MeetingEntity`: `id, organizerId, roomId, status, startTime, deletedAt`.
- `RoomBookingEntity`: `id, meetingId, roomId, reservedStartTime, reservedEndTime, status`.
- `RoomBookingUsageEntity`: `bookingId, meetingId, roomId, actualStartTime, actualEndTime, firstPresenceAt, lastPresenceAt`.
- `DepartmentEntity.managerUserId`, `UserEntity.departmentId` — scope Manager.
- `SystemConfigEntity` — tái dùng key `analytics.dashboard_max_range_days`, không tạo key mới.
- **Không có bảng/cột nào cần thêm.**

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `analytics`, cung cấp biểu đồ cột kép đối chiếu thời lượng dự kiến (giờ đặt phòng) và thời lượng thực tế (giờ sử dụng thực tế) của các cuộc họp đã hoàn tất, phục vụ Manager/Business Admin đánh giá mức độ chênh lệch giữa kế hoạch và thực tế sử dụng phòng. Tính năng **read-only tuyệt đối**.

### 1.2 Mục tiêu

Cho phép Manager (giới hạn phòng ban phụ trách), Business Admin xem thời lượng trung bình dự kiến và thực tế của cuộc họp theo thời gian, nhóm theo ngày/tuần/tháng/quý, lọc theo phòng ban (nhiều)/phòng họp.

### 1.3 Giá trị mang lại

- Cho Manager: phát hiện xu hướng cuộc họp kết thúc sớm/muộn hơn kế hoạch trong phòng ban mình.
- Cho Business Admin: đánh giá độ chính xác lập lịch toàn công ty, hỗ trợ điều chỉnh chính sách đặt phòng (vd rút ngắn slot mặc định nếu thực tế luôn ngắn hơn).

### 1.4 Giả định

- Chỉ tính `meetings.status='completed'` cho cả 2 cột (Phương án A, §0.4).
- Bucket không có meeting `completed` nào → `null` cho cả 2 giá trị trung bình, không phải `0`.
- `granularity` mặc định `week`, `from/to` mặc định "Tháng hiện tại".
- Không trả `medianMinutes`.

### 1.5 Clarifications Resolved

Toàn bộ điểm mơ hồ đã liệt kê và người dùng duyệt (chọn Phương án A ở điểm population, đồng ý các đề xuất còn lại) — tổng hợp tại §0.1–§0.9.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager / Approver | Quản lý cấp phòng ban | Xem đối chiếu giới hạn trong (các) phòng ban mình phụ trách |
| Business Admin | Quản trị viên doanh nghiệp | Xem đối chiếu toàn công ty, lọc theo `departmentIds` bất kỳ |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin (nhất quán các feature trước — `API_CONTRACT` UC-153 có `SYSTEM_ADMIN`) |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Permission bắt buộc: `analytics.meeting.read` (dùng chung với UC-AA-04/UC-AA-05, đã seed).
- `SYSTEM_ADMIN`/`BUSINESS_ADMIN`: không giới hạn scope; `departmentIds` là filter thuần túy.
- `MANAGER`: scope = phòng ban `departments.manager_user_id = currentUser.id` (tĩnh). Mọi phần tử trong `departmentIds` phải thuộc scope, nếu không → 403 `DEPARTMENT_OUT_OF_SCOPE`.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `analytics.meeting.read`.
- Scope Manager dùng `departments.manager_user_id`, không rollup phòng ban con.

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về toàn bộ dữ liệu dưới dạng read-only — không tạo/sửa/xóa bất kỳ bản ghi nào trong `meetings`, `room_bookings`, `room_booking_usages`.

FR-002: THE system SHALL tính toán lại toàn bộ `series`/`summary` trực tiếp từ dữ liệu nguồn (on-demand aggregation) tại mỗi lần gọi API.

FR-003: THE system SHALL chỉ tính các `meetings` có `status='completed'` vào thống kê (Phương án A — §0.4), cho cả 2 giá trị dự kiến và thực tế.

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu GET /api/v1/analytics/meetings/average-duration, THE system SHALL kiểm tra authentication và permission `analytics.meeting.read` trước khi xử lý logic khác.

FR-005: WHEN người dùng không truyền `from`/`to`, THE system SHALL áp dụng mặc định "Tháng hiện tại" (timezone `Asia/Ho_Chi_Minh`).

FR-006: WHEN người dùng không truyền `granularity`, THE system SHALL mặc định `granularity='week'`.

FR-007: WHEN người dùng truyền `granularity IN ('day','week','month','quarter')`, THE system SHALL nhóm `series` theo đúng đơn vị đó.

FR-008: WHEN currentUser có role MANAGER và không truyền `departmentIds`, THE system SHALL tự động giới hạn dữ liệu trong toàn bộ phòng ban mình quản lý.

FR-009: WHEN currentUser có role MANAGER và truyền `departmentIds` mà mọi phần tử thuộc phòng ban mình quản lý, THE system SHALL lọc đúng các phòng ban đó.

FR-010: WHEN currentUser có role BUSINESS_ADMIN hoặc SYSTEM_ADMIN và truyền `departmentIds`, THE system SHALL lọc theo đúng các phòng ban đó trong toàn hệ thống.

FR-011: WHEN người dùng truyền `roomId`, THE system SHALL lọc chỉ còn các `meetings` có `room_id` tương ứng.

### 3.3 State-driven Requirements

FR-012: WHILE 1 bucket không có bất kỳ `meetings.status='completed'` nào trong scope + filter, THE system SHALL trả `plannedAverageMinutes=null`, `actualAverageMinutes=null`, `completedMeetingCount=0` cho bucket đó (§0.5).

FR-013: WHILE toàn bộ `[from,to]` không có `meetings.status='completed'` nào thỏa filter, THE system SHALL trả `summary` với cả 2 giá trị `null`, `series` đủ bucket theo FR-012, kèm `message` mô tả không có dữ liệu (EX1/EX2 trong UC gốc).

### 3.4 Optional Feature Requirements

FR-014: WHERE `departmentIds` được cung cấp, THE system SHALL áp dụng như filter bổ sung sau khi đã áp scope theo role.

FR-015: WHERE `roomId` được cung cấp, THE system SHALL áp dụng như filter bổ sung độc lập với scope phòng ban.

### 3.5 Unwanted Behavior Requirements

FR-016: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-017: IF người dùng không có permission `analytics.meeting.read`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-018: IF currentUser có role MANAGER và bất kỳ phần tử nào trong `departmentIds` nằm ngoài phòng ban mình quản lý, THEN THE system SHALL trả về 403, error code `DEPARTMENT_OUT_OF_SCOPE`.

FR-019: IF `granularity` không thuộc {day, week, month, quarter}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-020: IF `from`/`to` sai định dạng ISO date hoặc `from > to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-021: IF bất kỳ phần tử nào trong `departmentIds` hoặc `roomId` không phải UUID hợp lệ, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-022: IF khoảng `to - from` vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL trả về 400, error code `DATE_RANGE_TOO_LARGE`.

### 3.6 Authorization Requirements

FR-023: WHEN the user performs a protected action (xem đối chiếu thời lượng), THE system SHALL verify authentication và authorization trước khi thực thi aggregation query.

FR-024: WHILE currentUser đang ở scope MANAGER, THE system SHALL áp scope phòng ban cho mọi truy vấn `meetings`/`room_bookings`/`room_booking_usages`.

### 3.7 Data & State Requirements

FR-025: WHEN tính `plannedAverageMinutes` cho 1 bucket, THE system SHALL tính trung bình cộng `(reserved_end_time - reserved_start_time)` (phút) của `room_bookings` gắn với `meetings.status='completed'` có `start_time` rơi vào bucket đó, trong scope + filter.

FR-026: WHEN tính `actualAverageMinutes` cho 1 bucket, THE system SHALL tính trung bình cộng thời lượng thực tế (ưu tiên `actual_end_time - actual_start_time`, fallback `last_presence_at - first_presence_at`, loại record thiếu cả hai) của `room_booking_usages` gắn với cùng tập `meetings.status='completed'` ở FR-025.

FR-027: WHEN tính `completedMeetingCount` cho 1 bucket, THE system SHALL đếm số `meetings.status='completed'` trong bucket đó theo scope + filter.

FR-028: WHEN tính `summary`, THE system SHALL tính `plannedAverageMinutes`/`actualAverageMinutes`/`completedMeetingCount` trên toàn bộ `[from,to]` (không chia bucket), dùng đúng công thức FR-025/FR-026/FR-027.

FR-029: WHEN tạo label `period` cho mỗi bucket, THE system SHALL dùng định dạng `"YYYY-MM-DD"` (day), `"YYYY-'W'WW"` (week), `"YYYY-MM"` (month), `"YYYY-'Q'Q"` (quarter) (§0.6, §0.7).

### 3.8 Notification / Audit Requirements

FR-030: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN yêu cầu hoàn tất thành công, THE system SHALL ghi audit log non-blocking `action_type='read_analytics_meeting_average_duration'`, `entity_type='meetings'`, `metadata_json` chứa tối thiểu `{viewerUserId, viewerRole, from, to, granularity, departmentIds, roomId, resolvedScopeDepartmentIds}`.

### 3.9 Complex / Combined Requirements

FR-031: WHILE currentUser có role MANAGER, WHEN currentUser không quản lý phòng ban nào, THE system SHALL trả về response rỗng như FR-013 thay vì lỗi.

FR-032: WHERE `to - from` vượt `analytics.dashboard_max_range_days`, IF request vẫn được gửi, THEN THE system SHALL từ chối tại tầng validate DTO trước khi chạm tới bất kỳ truy vấn tổng hợp nào.

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-AA-06 POST-2, Phương án A §0.4 |
| FR-004–FR-011 | Event-driven | UC-AA-06 Normal Flow bước 1-4 |
| FR-012, FR-013 | State-driven | UC-AA-06 EX2 (empty), §0.5 |
| FR-014, FR-015 | Optional Feature | UC-153 query params + bổ sung §0.9 |
| FR-016–FR-022 | Unwanted Behavior | UC-AA-06 BR1, validation |
| FR-023, FR-024 | Authorization | UC-AA-06 BR1 |
| FR-025–FR-029 | Data & State | UC-AA-06 Normal Flow bước 2, 4-5 |
| FR-030 | Notification/Audit | Pattern audit đã dùng ở feature trước |
| FR-031, FR-032 | Complex | UC-AA-06 BR1 + range guard |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về kết quả trong vòng dưới 2 giây cho khoảng thời gian mặc định (tháng hiện tại, granularity=week) trong điều kiện tải bình thường.

NFR-002: IF khoảng thời gian truy vấn vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL từ chối tại tầng validate (FR-022) trước khi chạy aggregation.

### 4.2 Security

NFR-003: THE system SHALL yêu cầu authentication cho mọi request.

NFR-004: THE system SHALL enforce scope phòng ban Manager ở tầng service, không chỉ dựa vào FE.

### 4.3 Reliability & Consistency

NFR-005: THE system SHALL đảm bảo `summary` và tổng hợp từ `series` (loại bucket `null`) phản ánh cùng 1 tập dữ liệu nguồn trong cùng 1 response.

NFR-006: THE system SHALL sử dụng index sẵn có trên `meetings(start_time, status)`, `room_bookings(meeting_id)`, `room_booking_usages(meeting_id)`.

### 4.4 Usability

NFR-007: THE system SHALL trả về clear error messages và field names dạng camelCase.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `meetings` | Xác định tập `completed` + scope (`organizer_id`) | Chỉ `status='completed'` |
| `room_bookings` | Nguồn "Dự kiến" (`reserved_start/end_time`) | 1-1 với `meetings` qua `meeting_id` |
| `room_booking_usages` | Nguồn "Thực tế" (`actual_*`, fallback `presence_*`) | 1-1 với `meetings` qua `meeting_id` |
| `users`, `departments` | Resolve scope Manager | Tái dùng pattern UC-AA-01/04/05 |
| `system_configs` | Tái dùng `analytics.dashboard_max_range_days` | Không tạo key mới |

### 5.2 Dữ liệu đầu vào

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| from | date | Không | Bắt đầu khoảng | Mặc định đầu tháng hiện tại |
| to | date | Không | Kết thúc khoảng | Mặc định cuối tháng hiện tại; `to>=from`; range ≤ max |
| granularity | string | Không | `day`/`week`/`month`/`quarter`, mặc định `week` | Enum hợp lệ |
| departmentIds | UUID[] | Không | Lọc 1 hoặc nhiều phòng ban | MANAGER chỉ được truyền phòng ban mình quản lý |
| roomId | UUID | Không | Lọc phòng họp | UUID hợp lệ |

### 5.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| period.from/to | date | Khoảng thời gian áp dụng |
| summary.plannedAverageMinutes | number \| null | Trung bình dự kiến toàn kỳ |
| summary.actualAverageMinutes | number \| null | Trung bình thực tế toàn kỳ |
| summary.completedMeetingCount | integer | Số meeting `completed` toàn kỳ |
| series[].period | string | Label bucket theo `granularity` |
| series[].plannedAverageMinutes | number \| null | FR-025 |
| series[].actualAverageMinutes | number \| null | FR-026 |
| series[].completedMeetingCount | integer | FR-027 |
| message | string (optional) | Chỉ có khi `summary.completedMeetingCount=0` — EX1/EX2 |

### 5.4 Data Constraints

- Không ghi/sửa/xóa bảng nguồn.
- Không thêm bảng/cột/config key mới.
- Cả 2 giá trị trung bình luôn tính trên cùng 1 tập N (`completedMeetingCount`) — không lệch population giữa 2 cột (Phương án A).

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN tính thời lượng thực tế, THE system SHALL loại `room_booking_usages` không có cả `actual_*` lẫn `first/last_presence_at` khỏi tập tính trung bình (không suy diễn — đúng nguyên tắc đã dùng ở UC-AA-01/02).

FR-DATA-002: WHEN resolving scope cho MANAGER, THE system SHALL tái dùng đúng query `SELECT id FROM departments WHERE manager_user_id = currentUser.id` đã có ở UC-AA-01/UC-AA-04/UC-AA-05.

### 5.6 Cần làm rõ

- **CL-1**: `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-153 hiện dùng `mode` (single-select) và có `medianMinutes` — đã bỏ cả 2, đổi thành trả song song `planned`/`actual`. Cần task đồng bộ tài liệu riêng.
- **CL-2**: FR-DATA-001 có thể khiến 1 meeting `completed` có `room_bookings` nhưng thiếu hoàn toàn dữ liệu `room_booking_usages` bị loại khỏi cả `plannedAverageMinutes` lẫn `actualAverageMinutes` (dù về logic "Dự kiến" đáng lẽ vẫn tính được từ `room_bookings` một mình) — quyết định: loại đồng thời cả 2 để giữ population nhất quán tuyệt đối giữa 2 cột (đúng tinh thần Phương án A "so sánh táo với táo"), chấp nhận đánh đổi giảm N một chút.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `from`/`to` sai định dạng hoặc `from > to`, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `granularity` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF phần tử trong `departmentIds`/`roomId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF range vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.

### 6.2 Authentication / Authorization Errors

ERR-005: IF chưa đăng nhập, THEN 401.
ERR-006: IF không có permission `analytics.meeting.read`, THEN 403 `PERMISSION_DENIED`.
ERR-007: IF MANAGER truyền `departmentIds` có phần tử ngoài scope, THEN 403 `DEPARTMENT_OUT_OF_SCOPE`.

### 6.3 System Errors

ERR-008: IF lỗi truy vấn hệ thống, THEN 500 `INTERNAL_ERROR`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When gọi API không tham số,
Then hệ thống trả về `summary`/`series` (granularity=week) tính trên tháng hiện tại, chỉ trên meeting `completed`, toàn công ty.

AC-002:
Given Manager quản lý phòng ban "Kỹ thuật",
When Manager gọi API không truyền `departmentIds`,
Then hệ thống chỉ tính trên meetings `completed` do phòng ban "Kỹ thuật" tổ chức.

AC-003:
Given 1 meeting `completed` có booking 60 phút (dự kiến) và actual 52 phút (thực tế),
When gọi API,
Then bucket tương ứng có `plannedAverageMinutes` và `actualAverageMinutes` phản ánh đúng cả 2 giá trị.

### 7.2 Validation & Authorization Cases

AC-004:
Given `granularity=quarter`,
When gọi API,
Then `series` nhóm theo quý, label `"YYYY-'Q'Q"`.

AC-005:
Given Manager truyền `departmentIds` có phần tử ngoài phạm vi quản lý,
When gọi API,
Then hệ thống reject 403 `DEPARTMENT_OUT_OF_SCOPE`.

### 7.3 Business Rule Cases

AC-006:
Given 1 bucket không có meeting `completed` nào,
When gọi API,
Then bucket đó có `plannedAverageMinutes=null`, `actualAverageMinutes=null`, `completedMeetingCount=0` — KHÔNG phải `0`.

AC-007:
Given toàn bộ `[from,to]` không có meeting `completed` nào thỏa filter,
When gọi API,
Then `summary` toàn `null`, `series` đủ bucket theo AC-006, kèm `message` (EX1/EX2).

AC-008:
Given tồn tại meeting `status='scheduled'` trong khoảng lọc,
When gọi API,
Then meeting đó KHÔNG được tính vào bất kỳ giá trị trung bình nào (Phương án A).

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-006, FR-025-FR-028 |
| AC-002 | FR-008, FR-DATA-002 |
| AC-003 | FR-025, FR-026 |
| AC-004 | FR-007, FR-029 |
| AC-005 | FR-018, ERR-007 |
| AC-006 | FR-012 |
| AC-007 | FR-013, FR-031 |
| AC-008 | FR-003 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Gộp chung với UC-AA-04 (đã quyết định giữ tách riêng — §0.1).
- `mode` single-select (chỉ trả 1 trong 2 giá trị) — đã chọn trả song song.
- `medianMinutes` — đã bỏ.
- Phương án B của population (tập N khác nhau cho 2 cột) — đã chọn Phương án A.
- Tính trung bình trên meetings `scheduled` (chưa hoàn tất) — không có dữ liệu thực tế để đối chiếu.
- WebSocket push/invalidate — cùng lý do đã loại ở các feature trước.
- Rollup phòng ban con cho scope Manager.

### 8.2 Có thể xem xét ở feature khác

- Đồng bộ `API_CONTRACT_v1.0_with_system_roles.md` (bỏ `mode`/`medianMinutes`, thêm `plannedAverageMinutes`/`actualAverageMinutes`).
- Hiển thị xu hướng cho meetings `scheduled` (dự báo dựa trên dữ liệu lịch sử) nếu có yêu cầu rõ ràng sau này.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT merge this feature's endpoint/logic with UC-AA-04 (count-by-period).
OOS-002: THE system SHALL NOT create new database tables, columns, or system_configs keys for this feature.
OOS-003: THE system SHALL NOT include meetings with status other than 'completed' in the average calculations.
OOS-004: THE system SHALL NOT roll up Manager department scope to parent or child departments.
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
