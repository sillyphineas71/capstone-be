# Feature Specification: Xem thống kê cuộc họp theo trạng thái

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo spec lần đầu cho UC-AA-05 / UC-152 Xem thống kê cuộc họp theo trạng thái. Đã phân tích, liệt kê điểm mơ hồ, đề xuất phương án và được người dùng duyệt toàn bộ trước khi viết spec (xem §0 RECON). Đã cân nhắc gộp vào UC-AA-04 nhưng quyết định giữ tách riêng do khác hình dạng dữ liệu (category-breakdown vs time-series) và business rule phức tạp hơn. | Toàn bộ file |

---

- **Feature ID**: AA-MEETING-STATUS-BREAKDOWN-001
- **Feature Name**: Xem thống kê cuộc họp theo trạng thái (View Meeting Status Breakdown)
- **Use Case**: UC-AA-05 Xem thống kê cuộc họp theo trạng thái (= UC-152 trong API Contract)
- **Module / Domain**: analytics
- **Created Date**: 2026-07-02
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của người dùng — mô tả UC-AA-05 (actor, trigger, precondition, postcondition, normal/alternative flow, exception, business rules)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — mục 16 UC-152
  - `database_v3_2_compact_39_tables.md` — `meetings`, `no_show_cases`, `room_bookings`
  - `spec/features/meeting/feat-review-meeting-request/spec.md` — xác nhận luồng reject mutate `meetings.status='cancelled'`
  - `spec/features/room-utilization/feat-no-show-lifecycle/spec.md` — xác nhận no-show KHÔNG mutate `meetings.status`
  - `spec/features/analytics/feat-view-dashboard-overview/` (UC-AA-01) — tái dùng định nghĩa no-show, config `max_range_days`
  - `spec/features/analytics/feat-view-room-usage-dashboard/` (UC-AA-02) — tái dùng pattern `preset` (day/week/month/custom)
  - `spec/features/analytics/feat-view-meeting-count-by-period/` (UC-AA-04) — tái dùng pattern scope Manager tĩnh, config `max_range_days`
  - `.specify/memory/constitution.md`, `CLAUDE.md`

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. Quyết định KHÔNG gộp vào UC-AA-04

Đã cân nhắc gộp UC-AA-05 vào UC-AA-04 (cùng module `analytics`, cùng bảng `meetings`) nhưng quyết định **giữ tách riêng** vì: (1) `API_CONTRACT` đã thiết kế 2 endpoint khác hình dạng dữ liệu hoàn toàn (time-series `series[]` vs category-breakdown `items[]`); (2) business rule phân loại (BR1) phức tạp hơn nhiều, đòi hỏi JOIN chéo `no_show_cases` mà UC-AA-04 không cần. Tầng implementation vẫn tái dùng tối đa hạ tầng đã có (xem §0.7).

### 0.2. "No-show" không tồn tại trong `meetings.status` — đã xác nhận bằng code

`MeetingStatus` enum: `draft|pending_approval|scheduled|in_progress|completed|cancelled` — **không có `no_show`**. Đã xác nhận qua [feat-no-show-lifecycle/spec.md:19](../../../../spec/features/room-utilization/feat-no-show-lifecycle/spec.md): khi 1 booking bị phát hiện no-show và giải phóng phòng, hệ thống **KHÔNG mutate `meetings.status`** — meeting vẫn giữ nguyên `status='scheduled'` (hoặc giá trị trước đó) vĩnh viễn. **Quyết định đã duyệt**: 1 meeting được xếp vào nhóm "No-show" nếu có `no_show_cases.detection_status IN ('confirmed','released')` gắn với `room_bookings` của meeting đó — tái dùng đúng định nghĩa đã chốt ở UC-AA-01 (`noShowRate`), không định nghĩa lại.

### 0.3. Thứ tự ưu tiên phân loại (precedence) — đã duyệt

Vì No-show "ẩn" trong `status='scheduled'`, cần thứ tự phân loại rõ ràng để mỗi meeting rơi vào đúng 1 trong 4 nhóm, không đếm trùng/sót:

```
1. status = 'cancelled'                              -> Cancelled
2. (còn lại) có no_show_cases confirmed/released      -> No-show
3. (còn lại) status = 'completed'                     -> Completed
4. (còn lại) status = 'scheduled'                     -> Scheduled
5. status IN ('draft','pending_approval','in_progress') -> LOẠI KHỎI biểu đồ (không tính vào mẫu số %)
```

### 0.4. "Cancelled" chỉ cần lọc `status='cancelled'` — đã xác nhận bằng code, KHÔNG cần UNION

BR1 mô tả Cancelled gồm cả "chủ động hủy" và "bị từ chối phê duyệt". Đã xác nhận qua [feat-review-meeting-request/spec.md:144](../../../../spec/features/meeting/feat-review-meeting-request/spec.md) (FR-018): khi approver reject, `meetings.status` chuyển thẳng sang `cancelled` — cả 2 trường hợp đã **hội tụ về cùng 1 giá trị**. Quyết định: chỉ cần lọc `status='cancelled'`, không cần UNION với `meeting_requests`.

### 0.5. "Completed" — Phương án A đã chọn (không yêu cầu bằng chứng điểm danh)

**Quyết định đã duyệt (Phương án A)**: chỉ lọc `status='completed'`, coi phần "có ghi nhận điểm danh thực tế" trong BR1 là mô tả diễn giải, không phải điều kiện lọc cứng. Nhất quán với cách đã xử lý BR1 ở UC-AA-04 (tránh cross-entity check không cần thiết).

### 0.6. Lệch với `API_CONTRACT` UC-152 — đã quyết định ưu tiên yêu cầu trực tiếp

Response mẫu UC-152 gốc có 4 mục `completed/cancelled/scheduled/in_progress` — thiếu `no_show`, thừa `in_progress` (trạng thái transient). **Quyết định đã duyệt**: dùng đúng 4 nhóm theo UC-AA-05 (Scheduled/Completed/Cancelled/No-show), bỏ `in_progress` khỏi response. Đề xuất đồng bộ lại `API_CONTRACT` ở task riêng (§8.2).

### 0.7. Tái dùng hạ tầng đã có (không viết lại)

- Scope Manager tĩnh: tái dùng đúng pattern đã có ở UC-AA-01/UC-AA-04 (`departments.manager_user_id = currentUser.id`).
- Giới hạn range: tái dùng nguyên `analytics.dashboard_max_range_days` (`DashboardOverviewConfigService.getMaxRangeDays()`).
- Bộ lọc thời gian: tái dùng nguyên cơ chế `preset=day|week|month|custom` đã có ở UC-AA-02 (vì đây là biểu đồ 1 lát cắt thời gian, không phải time-series — không cần `granularity` như UC-AA-04).

### 0.8. Multi-select phòng ban — đã duyệt

Normal Flow bước 3 yêu cầu "chọn một hoặc nhiều Phòng ban". **Quyết định đã duyệt**: đổi `departmentId` (UC-152 gốc) thành `departmentIds` (mảng UUID). Manager: mọi phần tử phải thuộc tập phòng ban mình quản lý; có bất kỳ id nào ngoài phạm vi → 403 `DEPARTMENT_OUT_OF_SCOPE`. Không truyền → mặc định toàn bộ phòng ban Manager quản lý.

### 0.9. Mẫu số %, làm tròn, EX1 — đã duyệt

- Mẫu số % = tổng đúng 4 nhóm hợp lệ (loại `draft/pending_approval/in_progress`), đảm bảo tổng % luôn = 100% (trừ trường hợp tổng = 0).
- Làm tròn `percentage` 1 chữ số thập phân (khớp mẫu contract `67.6`).
- EX1: trả đủ 4 category với `count=0, percentage=0`, kèm `message` — không trả `items=[]` (nhất quán cách đã chọn ở UC-AA-04 cho `series`).

### 0.10. Field/entity xác nhận tồn tại thật

- `MeetingEntity`: `id, organizerId, roomId, status, startTime, deletedAt`.
- `RoomBookingEntity`: `id, meetingId, roomId, status`.
- `NoShowCaseEntity`: `id, bookingId, meetingId, roomId, detectionStatus` (`risk|confirmed|warning_sent|released|dismissed|resolved`).
- `DepartmentEntity.managerUserId`, `UserEntity.departmentId` — scope Manager.
- `SystemConfigEntity` — tái dùng key `analytics.dashboard_max_range_days`, không tạo key mới.
- **Không có bảng/cột nào cần thêm.**

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `analytics`, cung cấp biểu đồ tròn (pie/donut chart) phân bổ số lượng và tỷ lệ % cuộc họp theo 4 trạng thái vận hành (Scheduled/Completed/Cancelled/No-show), phục vụ Manager/Business Admin nhận diện tỷ lệ hủy/no-show bất thường theo phòng ban/khoảng thời gian. Tính năng **read-only tuyệt đối**.

### 1.2 Mục tiêu

Cho phép Manager (giới hạn phòng ban phụ trách), Business Admin xem phân bổ số lượng + % cuộc họp theo 4 trạng thái, lọc theo khoảng thời gian (preset hoặc tùy chỉnh) và 1 hoặc nhiều phòng ban.

### 1.3 Giá trị mang lại

- Cho Manager: phát hiện tỷ lệ hủy/no-show cao bất thường trong phòng ban mình để chấn chỉnh quy trình đặt phòng.
- Cho Business Admin: giám sát sức khỏe vận hành tổng thể (tỷ lệ hoàn tất vs hủy vs no-show) theo từng phòng ban.

### 1.4 Giả định

- Phân loại theo thứ tự ưu tiên §0.3 — mỗi meeting rơi vào đúng 1 nhóm, không đếm trùng.
- "Cancelled" = `status='cancelled'` thuần túy (đã hội tụ 2 nguồn — §0.4).
- "Completed" = `status='completed'` thuần túy, không yêu cầu bằng chứng điểm danh (§0.5).
- "No-show" xác định qua `no_show_cases`, không qua `meetings.status`.
- `draft`, `pending_approval`, `in_progress` bị loại hoàn toàn khỏi thống kê (không tính vào mẫu số %).
- Bộ lọc thời gian dùng `preset` (day/week/month/custom), tái dùng nguyên UC-AA-02.

### 1.5 Clarifications Resolved

Toàn bộ điểm mơ hồ đã liệt kê và người dùng duyệt (bao gồm quyết định không gộp vào UC-AA-04) — tổng hợp tại §0.1–§0.9.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager / Approver | Quản lý cấp phòng ban | Xem phân bổ giới hạn trong (các) phòng ban mình phụ trách |
| Business Admin | Quản trị viên doanh nghiệp | Xem phân bổ toàn công ty, lọc theo `departmentIds` bất kỳ |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin (nhất quán UC-AA-04 §0.9 — UC-AA-05 gốc không liệt kê nhưng API_CONTRACT UC-152 có, giữ nguyên theo contract) |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Permission bắt buộc: `analytics.meeting.read` (dùng chung với UC-AA-04, đúng theo `API_CONTRACT`).
- `SYSTEM_ADMIN`/`BUSINESS_ADMIN`: không giới hạn scope; `departmentIds` là filter thuần túy.
- `MANAGER`: scope = phòng ban `departments.manager_user_id = currentUser.id` (tĩnh). Mọi phần tử trong `departmentIds` phải thuộc scope, nếu không → 403 `DEPARTMENT_OUT_OF_SCOPE`.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `analytics.meeting.read`.
- Scope Manager dùng `departments.manager_user_id`, không rollup phòng ban con.

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về toàn bộ dữ liệu dưới dạng read-only — không tạo/sửa/xóa bất kỳ bản ghi nào trong `meetings`, `no_show_cases`, `room_bookings`.

FR-002: THE system SHALL tính toán lại toàn bộ `items`/`total` trực tiếp từ dữ liệu nguồn (on-demand aggregation) tại mỗi lần gọi API.

FR-003: THE system SHALL phân loại mỗi meeting vào đúng 1 trong 4 nhóm (Scheduled/Completed/Cancelled/No-show) theo thứ tự ưu tiên tại §0.3, hoặc loại khỏi thống kê nếu không thuộc nhóm nào.

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu GET /api/v1/analytics/meetings/status-breakdown, THE system SHALL kiểm tra authentication và permission `analytics.meeting.read` trước khi xử lý logic khác.

FR-005: WHEN người dùng không truyền `preset`/`from`/`to`, THE system SHALL áp dụng mặc định `preset='month'` (Tháng hiện tại, timezone `Asia/Ho_Chi_Minh`).

FR-006: WHEN người dùng truyền `preset IN ('day','week','month')`, THE system SHALL tự tính `from`/`to` tương ứng, bỏ qua `from`/`to` nếu có truyền kèm (tái dùng đúng logic UC-AA-02).

FR-007: WHEN người dùng truyền `preset='custom'` kèm `from`/`to` hợp lệ, THE system SHALL dùng đúng khoảng đó.

FR-008: WHEN currentUser có role MANAGER và không truyền `departmentIds`, THE system SHALL tự động giới hạn dữ liệu trong toàn bộ phòng ban mình quản lý.

FR-009: WHEN currentUser có role MANAGER và truyền `departmentIds` mà mọi phần tử thuộc phòng ban mình quản lý, THE system SHALL lọc đúng các phòng ban đó.

FR-010: WHEN currentUser có role BUSINESS_ADMIN hoặc SYSTEM_ADMIN và truyền `departmentIds`, THE system SHALL lọc theo đúng các phòng ban đó trong toàn hệ thống (không kiểm tra sở hữu).

### 3.3 State-driven Requirements

FR-011: WHILE tổ hợp filter không có meeting nào thuộc 4 nhóm hợp lệ trong `[from,to]`, THE system SHALL trả `total=0`, `items` đủ 4 category với `count=0, percentage=0`, kèm `message` mô tả không tìm thấy dữ liệu (EX1).

FR-012: WHILE 1 meeting có `status='scheduled'` (hoặc bất kỳ status nào khác `cancelled`) VÀ có `no_show_cases.detection_status IN ('confirmed','released')` gắn với booking của nó, THE system SHALL xếp meeting đó vào nhóm "No-show", KHÔNG xếp vào "Scheduled"/"Completed".

### 3.4 Optional Feature Requirements

FR-013: WHERE `departmentIds` được cung cấp, THE system SHALL áp dụng như filter bổ sung sau khi đã áp scope theo role.

### 3.5 Unwanted Behavior Requirements

FR-014: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-015: IF người dùng không có permission `analytics.meeting.read`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-016: IF currentUser có role MANAGER và bất kỳ phần tử nào trong `departmentIds` nằm ngoài phòng ban mình quản lý, THEN THE system SHALL trả về 403, error code `DEPARTMENT_OUT_OF_SCOPE`.

FR-017: IF `preset` không thuộc {day, week, month, custom}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-018: IF `preset='custom'` nhưng thiếu `from`/`to`, hoặc `from > to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-019: IF bất kỳ phần tử nào trong `departmentIds` không phải UUID hợp lệ, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-020: IF khoảng `to - from` vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL trả về 400, error code `DATE_RANGE_TOO_LARGE`.

### 3.6 Authorization Requirements

FR-021: WHEN the user performs a protected action (xem thống kê trạng thái), THE system SHALL verify authentication và authorization trước khi thực thi aggregation query.

FR-022: WHILE currentUser đang ở scope MANAGER, THE system SHALL áp scope phòng ban cho mọi truy vấn `meetings`/`no_show_cases`.

### 3.7 Data & State Requirements

FR-023: WHEN tính `items`, THE system SHALL đếm số meeting thuộc mỗi nhóm (theo FR-003/FR-012) trong scope + filter + `[from,to]` (theo `start_time`), loại trừ `draft`/`pending_approval`/`in_progress`.

FR-024: WHEN tính `percentage` cho mỗi nhóm, THE system SHALL tính `count ÷ total4Groups × 100` (chỉ trên tổng 4 nhóm hợp lệ), làm tròn 1 chữ số thập phân. Nếu `total4Groups = 0`, trả `percentage = 0`.

FR-025: WHEN tính `total`, THE system SHALL trả `total = SUM(items[].count)`.

### 3.8 Notification / Audit Requirements

FR-026: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN yêu cầu hoàn tất thành công, THE system SHALL ghi audit log non-blocking `action_type='read_analytics_meeting_status_breakdown'`, `entity_type='meetings'`, `metadata_json` chứa tối thiểu `{viewerUserId, viewerRole, from, to, departmentIds, resolvedScopeDepartmentIds}`.

### 3.9 Complex / Combined Requirements

FR-027: WHILE currentUser có role MANAGER, WHEN currentUser không quản lý phòng ban nào, THE system SHALL trả về response rỗng như FR-011 thay vì lỗi.

FR-028: WHERE `to - from` vượt `analytics.dashboard_max_range_days`, IF request vẫn được gửi, THEN THE system SHALL từ chối tại tầng validate DTO trước khi chạm tới bất kỳ truy vấn tổng hợp nào.

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-AA-05 POST-2, BR1 |
| FR-004–FR-010 | Event-driven | UC-AA-05 Normal Flow bước 1-4, BR2 |
| FR-011, FR-012 | State-driven | UC-AA-05 EX1, BR1 (no-show) |
| FR-013 | Optional Feature | UC-AA-05 multi-select phòng ban |
| FR-014–FR-020 | Unwanted Behavior | UC-AA-05 BR2, validation |
| FR-021, FR-022 | Authorization | UC-AA-05 BR2 |
| FR-023–FR-025 | Data & State | UC-AA-05 Normal Flow bước 4-5, BR1 |
| FR-026 | Notification/Audit | Pattern audit đã dùng ở feature trước |
| FR-027, FR-028 | Complex | BR2 + range guard §0.7 |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về kết quả trong vòng dưới 2 giây cho khoảng thời gian mặc định (tháng hiện tại) trong điều kiện tải bình thường.

NFR-002: IF khoảng thời gian truy vấn vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL từ chối tại tầng validate (FR-020) trước khi chạy aggregation.

### 4.2 Security

NFR-003: THE system SHALL yêu cầu authentication cho mọi request.

NFR-004: THE system SHALL enforce scope phòng ban Manager ở tầng service, không chỉ dựa vào FE.

### 4.3 Reliability & Consistency

NFR-005: THE system SHALL đảm bảo `total` luôn bằng tổng `items[].count`, và tổng `items[].percentage` luôn xấp xỉ 100 (trừ khi `total=0`).

NFR-006: THE system SHALL sử dụng index sẵn có trên `meetings(start_time, status)`, `no_show_cases(booking_id)`, `room_bookings(meeting_id)`.

### 4.4 Usability

NFR-007: THE system SHALL trả về clear error messages và field names dạng camelCase.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `meetings` | Nguồn chính, phân loại theo `status` | Kết hợp `no_show_cases` để tách nhóm No-show |
| `room_bookings` | Cầu nối `meetings` ↔ `no_show_cases` | Qua `meeting_id`/`booking_id` |
| `no_show_cases` | Xác định nhóm "No-show" | `detection_status IN ('confirmed','released')` |
| `users`, `departments` | Resolve scope Manager | Tái dùng pattern UC-AA-01/04 |
| `system_configs` | Tái dùng `analytics.dashboard_max_range_days` | Không tạo key mới |

### 5.2 Dữ liệu đầu vào

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| preset | string | Không | `day`/`week`/`month`/`custom`, mặc định `month` | Enum hợp lệ |
| from | date | Chỉ khi `preset=custom` | Bắt đầu khoảng | ISO date |
| to | date | Chỉ khi `preset=custom` | Kết thúc khoảng | ISO date, `to>=from`, range ≤ max |
| departmentIds | UUID[] | Không | Lọc 1 hoặc nhiều phòng ban | Mỗi phần tử UUID hợp lệ; MANAGER chỉ được truyền phòng ban mình quản lý |

### 5.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| period.from/to | date | Khoảng thời gian áp dụng |
| total | integer | Tổng 4 nhóm hợp lệ |
| items[].status | string | `scheduled`/`completed`/`cancelled`/`no_show` |
| items[].count | integer | Số lượng meeting thuộc nhóm |
| items[].percentage | number | % trên tổng 4 nhóm, làm tròn 1 chữ số thập phân |
| message | string (optional) | Chỉ có khi `total=0` — EX1 |

### 5.4 Data Constraints

- Không ghi/sửa/xóa bảng nguồn.
- Không thêm bảng/cột/config key mới.
- `items` luôn có đúng 4 phần tử theo thứ tự cố định `scheduled, completed, cancelled, no_show`.

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN phân loại "No-show", THE system SHALL LEFT JOIN `meetings` → `room_bookings` (`room_bookings.meeting_id = meetings.id`) → `no_show_cases` (`no_show_cases.booking_id = room_bookings.id`), điều kiện `no_show_cases.detection_status IN ('confirmed','released')`.

FR-DATA-002: WHEN resolving scope cho MANAGER, THE system SHALL tái dùng đúng query `SELECT id FROM departments WHERE manager_user_id = currentUser.id` đã có ở UC-AA-01/UC-AA-04.

### 5.6 Cần làm rõ

- **CL-1**: `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-152 hiện có 4 mục `completed/cancelled/scheduled/in_progress` (thiếu `no_show`, thừa `in_progress`) — cần task đồng bộ tài liệu riêng.
- **CL-2**: Phương án A ở "Completed" (§0.5) không yêu cầu bằng chứng điểm danh — chấp nhận rủi ro số liệu hơi lệch so với BR1 gốc theo quyết định đã chọn.
- **CL-3**: 1 meeting có `room_bookings` bị hủy giữa chừng (booking status='cancelled') nhưng `meetings.status` vẫn khác `cancelled` — trường hợp hiếm, không có FR riêng xử lý, sẽ rơi vào nhóm dựa theo `meetings.status` hiện tại (nhất quán với nguyên tắc "chỉ dựa vào meetings.status + no_show_cases", không mở rộng sang `room_bookings.status`).

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `preset` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `preset=custom` thiếu `from`/`to` hoặc `from>to`, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF phần tử trong `departmentIds` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.
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
Then hệ thống trả về `items` đủ 4 nhóm với count/percentage tính trên tháng hiện tại, toàn công ty.

AC-002:
Given Manager quản lý phòng ban "Kỹ thuật",
When Manager gọi API không truyền `departmentIds`,
Then hệ thống chỉ đếm meetings do phòng ban "Kỹ thuật" tổ chức.

AC-003:
Given 1 meeting `status='scheduled'` có `no_show_cases.detection_status='confirmed'`,
When gọi API,
Then meeting đó được tính vào nhóm "No-show", KHÔNG tính vào "Scheduled".

### 7.2 Validation & Authorization Cases

AC-004:
Given Manager truyền `departmentIds=[deptA, deptB]` với `deptB` ngoài phạm vi quản lý,
When gọi API,
Then hệ thống reject 403 `DEPARTMENT_OUT_OF_SCOPE`.

AC-005:
Given `preset=custom` nhưng thiếu `to`,
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR`.

### 7.3 Business Rule Cases

AC-006:
Given tổ hợp filter không có meeting nào trong `[from,to]`,
When gọi API,
Then `total=0`, `items` đủ 4 nhóm với `count=0, percentage=0`, kèm `message` (EX1).

AC-007:
Given tồn tại meeting `status IN ('draft','pending_approval','in_progress')`,
When gọi API,
Then các meeting đó KHÔNG được tính vào `total`/`items` nào (bị loại hoàn toàn).

AC-008:
Given 1 meeting request bị approver reject (`meetings.status` chuyển thành `cancelled`),
When gọi API,
Then meeting đó được tính vào nhóm "Cancelled".

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-023-FR-025 |
| AC-002 | FR-008, FR-DATA-002 |
| AC-003 | FR-012, FR-DATA-001 |
| AC-004 | FR-016, ERR-007 |
| AC-005 | FR-018, ERR-002 |
| AC-006 | FR-011, FR-027 |
| AC-007 | FR-003, FR-023 |
| AC-008 | FR-003 (Cancelled thuần status) |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Gộp chung với UC-AA-04 (đã quyết định giữ tách riêng — §0.1).
- Phương án B của "Completed" (yêu cầu bằng chứng điểm danh) — đã chọn Phương án A.
- UNION với `meeting_requests` cho nhóm "Cancelled" — đã xác nhận không cần thiết (§0.4).
- Hiển thị `in_progress` như 1 nhóm riêng — đã loại theo quyết định §0.6.
- Tooltip hover trên biểu đồ — thuần FE, không cần API riêng.
- WebSocket push/invalidate — cùng lý do đã loại ở các feature trước.
- Rollup phòng ban con cho scope Manager.

### 8.2 Có thể xem xét ở feature khác

- Đồng bộ `API_CONTRACT_v1.0_with_system_roles.md` với 4 nhóm đúng (`no_show` thay vì `in_progress`).
- Nâng cấp "Completed" lên Phương án B nếu phát sinh yêu cầu chặt hơn về bằng chứng điểm danh.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT merge this feature's endpoint/logic with UC-AA-04 (count-by-period).
OOS-002: THE system SHALL NOT create new database tables, columns, or system_configs keys for this feature.
OOS-003: THE system SHALL NOT require attendance_records evidence for the "Completed" classification (Option A chosen).
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
