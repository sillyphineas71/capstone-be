# Feature Specification: Xem dashboard tổng quan hệ thống

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo spec lần đầu cho UC-AA-01 / UC-148 Xem dashboard tổng quan hệ thống. Đã reconcile với API_CONTRACT UC-148 (RECON), chốt công thức KPI qua research thực tế (Robin/Envoy/Mapiq/Worklytics) đã thống nhất với người dùng. | Toàn bộ file |

---

- **Feature ID**: AA-DASHBOARD-OVERVIEW-001
- **Feature Name**: Xem dashboard tổng quan hệ thống (View System Overview Dashboard)
- **Use Case**: UC-AA-01 Xem dashboard tổng quan hệ thống (= UC-148 trong API Contract)
- **Module / Domain**: analytics
- **Created Date**: 2026-07-02
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của người dùng — mô tả UC-AA-01 (actor, trigger, precondition, postcondition, normal/alternative flow, exception, business rules)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — mục 16 "Analytics & Administration", UC-148 (endpoint/permission/response mẫu đã có sẵn)
  - `database_v3_2_compact_39_tables.md` — bảng `meetings`, `room_bookings`, `room_booking_usages`, `no_show_cases`, `attendance_records`, `meeting_participants`, `users`, `departments`, `recording_sessions`
  - `CLAUDE.md` mục 5.2 — "dashboard nên tính bằng SQL view/materialized view thay vì thêm bảng mới"
  - `.specify/memory/constitution.md`
  - `spec/features/attendance/feat-view-meeting-attendance-list/` — tham chiếu pattern read-only + field-level scope
  - `src/modules/meetings/services/meetings.service.ts:4670-4685` — precedent code cho phân quyền theo phòng ban (`departments.manager_user_id`)

---

## 0. RECON — Đối chiếu với API_CONTRACT UC-148 (đã đọc tài liệu thật)

Tài liệu `API_CONTRACT_v1.0_with_system_roles.md` mục 16 đã định nghĩa sẵn UC-148 với response mẫu:

```json
{
  "success": true,
  "data": {
    "period": { "from": "2026-06-01", "to": "2026-06-30" },
    "meetingCount": 145,
    "activeRooms": 12,
    "utilizationRate": 68.5,
    "noShowRate": 7.2,
    "onTimeRate": 85.3,
    "recordingCount": 38,
    "trend": [{ "date": "2026-06-01", "meetingCount": 8, "utilizationRate": 70.0 }]
  }
}
```

**Lệch giữa 2 nguồn (đã reconcile):**

- UC-AA-01 (yêu cầu trực tiếp của người dùng, ưu tiên cao nhất theo `CLAUDE.md` mục 1) yêu cầu KPI **"Số lượng người dùng đang hoạt động"** — field này **không có** trong response mẫu UC-148.
- UC-148 có sẵn `activeRooms` và `recordingCount` — 2 field này **không được nêu tên** trong UC-AA-01 nhưng không mâu thuẫn với 5 KPI được liệt kê, và đã là contract chính thức đang tồn tại cho endpoint này.
- **Quyết định**: giữ nguyên toàn bộ field đã có trong UC-148 (không phá vỡ contract đã publish) và **bổ sung thêm** `activeUserCount` để thỏa yêu cầu trực tiếp của người dùng. Đây là bổ sung field, không phải thay đổi breaking. `docs/API_CONTRACT_v1.0_with_system_roles.md` nên được cập nhật đồng bộ ở bước sau (xem mục 8 Out of Scope).

**Field/entity xác nhận tồn tại thật (không suy đoán):**
- `departments.manager_user_id` ([database_v3_2_compact_39_tables.md:120](../../../../database_v3_2_compact_39_tables.md)) — cơ sở cho scope Manager.
- `meetings.organizer_id`, `meetings.start_time/end_time`, `meetings.status` ([meeting.entity.ts](../../../../src/modules/meetings/entities/meeting.entity.ts)) — **không có `department_id` trực tiếp trên `meetings` hay `rooms`**, scope phòng ban phải suy ra qua `organizer_id → users.department_id`.
- `room_bookings.status`, `reserved_start_time/end_time` ([room-booking.entity.ts](../../../../src/modules/rooms/entities/room-booking.entity.ts)).
- `room_booking_usages.actual_start_time/actual_end_time/reserved_start_time/reserved_end_time` ([room-booking-usage.entity.ts](../../../../src/modules/rooms/entities/room-booking-usage.entity.ts)).
- `no_show_cases.detection_status` (`risk|confirmed|warning_sent|released|dismissed|resolved`) ([no-show-case.entity.ts](../../../../src/modules/rooms/entities/no-show-case.entity.ts)).
- `attendance_records.is_present/is_late/attendance_status` ([attendance-record.entity.ts](../../../../src/modules/attendance/entities/attendance-record.entity.ts)).
- `recording_sessions.meeting_id/started_at` ([recording-session.entity.ts](../../../../src/modules/recording/entities/recording-session.entity.ts)).
- Precedent phân quyền theo phòng ban đã tồn tại tại [meetings.service.ts:4670-4685](../../../../src/modules/meetings/services/meetings.service.ts) — dùng `roles.some(r => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN')` qua `AuthzReadRepository.getEffectiveRolesAndPermissions`.
- `AnalyticsModule` hiện là `@Module({})` rỗng nhưng đã được import trong `app.module.ts` — không cần đăng ký module mới, chỉ cần bổ sung nội dung.
- **Không có bảng/cột nào cần thêm.** Toàn bộ dữ liệu tính từ bảng đã tồn tại (đúng nguyên tắc CLAUDE.md mục 5.2).

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `analytics`, nằm ở giai đoạn "sau cuộc họp / vận hành liên tục" trong meeting lifecycle. Đây là màn hình trung tâm điều khiển (Dashboard) tổng hợp các chỉ số vận hành (KPI cards) và biểu đồ xu hướng của toàn bộ hệ thống quản lý phòng họp, phục vụ Manager/Business Admin/System Admin theo dõi hiệu suất sử dụng phòng, tỷ lệ tham dự và no-show.

Tính năng là **read-only tuyệt đối** — không tạo/sửa/xóa bất kỳ bản ghi nghiệp vụ nào (`meetings`, `room_bookings`, `room_booking_usages`, `no_show_cases`, `attendance_records`). Dữ liệu được tổng hợp (aggregate) trực tiếp từ các bảng nguồn tại thời điểm gọi API, không dùng bảng cache/snapshot riêng.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Manager, Business Admin, System Admin xem tổng quan các chỉ số KPI (tổng số cuộc họp, tỷ lệ lấp đầy phòng, tỷ lệ điểm danh đúng giờ, tỷ lệ no-show, số người dùng đang hoạt động) và biểu đồ xu hướng theo thời gian, nhằm hỗ trợ ra quyết định vận hành và giám sát hiệu suất sử dụng phòng họp.

### 1.3 Giá trị mang lại

- Cho Manager: theo dõi hiệu suất vận hành trong phạm vi phòng ban mình phụ trách mà không cần truy vấn thủ công.
- Cho Business Admin/System Admin: giám sát tổng thể hiệu suất toàn doanh nghiệp, phát hiện bất thường (no-show cao, tỷ lệ lấp đầy thấp) để điều chỉnh chính sách.
- Cho vận hành: dữ liệu luôn phản ánh đúng thời điểm gọi API (real-time theo nghĩa on-demand), không có độ trễ cache.
- Cho dữ liệu/báo cáo: là nền tảng để mở rộng sang UC-149 (dashboard phòng), UC-150 (dashboard điểm danh) ở các feature sau.

### 1.4 Giả định

- Dashboard chỉ đọc dữ liệu đã tồn tại; nếu một chỉ số phụ thuộc dữ liệu presence/camera mà hệ thống chưa ghi nhận, chỉ số đó tính theo dữ liệu sẵn có (không suy diễn/nội suy).
- `meetings` và `rooms` không có `department_id` trực tiếp; phạm vi phòng ban của Manager luôn suy ra qua `meetings.organizer_id → users.department_id`.
- Scope Manager **chỉ tính đúng 1 cấp**: phòng ban mà `departments.manager_user_id = currentUser.id`, **không rollup** xuống `parent_department_id`/phòng ban con (quyết định đã chốt cùng người dùng ở phiên trước, theo pattern row-level security phổ biến — mỗi actor chỉ thấy đúng scope được gán, không suy diễn thêm).
- "Real-time" (BR2) được đáp ứng bằng cách tính lại toàn bộ chỉ số từ DB nguồn mỗi lần gọi API (on-demand aggregation), **không** dùng cache/materialized view có độ trễ.
- Việc phát broadcast WebSocket "invalidate" từ các module khác (`live-meeting`, `rooms`, `attendance`, `presence`) để báo FE tự refetch là ý tưởng đã thảo luận nhưng đòi hỏi sửa nhiều module ngoài `analytics` — vi phạm nguyên tắc module boundary nếu làm trong phạm vi feature này. Xem mục 8 Out of Scope.

### 1.5 Clarifications Resolved

Các điểm mơ hồ đã được research (Robin/Envoy/Condeco/Mapiq/Worklytics) và chốt cùng người dùng ở phiên trước:

1. **Room utilization**: tính trên giờ sử dụng thực tế (`room_booking_usages.actual_start_time/actual_end_time`, fallback `first_presence_at/last_presence_at` nếu thiếu actual, fallback tiếp `0` nếu không có dữ liệu presence) ÷ giờ đã đặt (`reserved_start_time/reserved_end_time`) của các booking trong scope. Không dùng khái niệm "giờ hoạt động phòng" vì schema không model field này.
2. **No-show rate**: `(no_show_cases.detection_status IN ('confirmed','released')) ÷ (room_bookings.status IN ('approved','active','completed','released'))` trong scope + kỳ. Ngưỡng phát hiện no-show dùng đúng cấu hình sẵn có ở `utilization`/`rooms` module (`system_configs['no_show.threshold_minutes']`), không định nghĩa lại.
3. **On-time rate**: dùng thẳng `attendance_records.is_late = false AND is_present = true` ÷ `attendance_records.attendance_status IN ('present','late')`. Không áp dụng grace period riêng cho dashboard (đồng nhất với field đã tính sẵn ở tầng attendance).
4. **Active users**: user có tổ chức (`organizer_id`) hoặc tham gia (`meeting_participants`, `invitation_status != 'declined'`) ít nhất 1 meeting trong kỳ + scope. Không dùng `last_login_at`.
5. **Real-time**: on-demand SQL aggregation mỗi lần gọi API. Không materialized view, không cache cứng.
6. **Default range**: 30 ngày gần nhất (rolling window) khi không truyền `from`/`to`.
7. **Giới hạn range lớn (EX2)**: validate tại DTO — `to - from` không vượt quá `analytics.dashboard_max_range_days` (`system_configs` → env `ANALYTICS_DASHBOARD_MAX_RANGE_DAYS` → default 366 ngày), tương tự pattern precedence đã dùng ở `no_show.threshold_minutes`.
8. **Phạm vi phòng ban Manager**: chỉ đúng phòng ban `departments.manager_user_id = currentUser.id`, không rollup, không cộng thêm `direct_manager_id` cá nhân (khác với pattern OR ở `meetings.service.ts:4679` vốn dùng cho luồng approval — Dashboard chỉ theo đúng nghĩa "phòng ban phụ trách" trong UC-AA-01).

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager / Approver | Quản lý cấp phòng ban | Xem KPI/biểu đồ giới hạn trong phòng ban mà mình là `departments.manager_user_id` |
| Business Admin | Quản trị viên doanh nghiệp | Xem KPI/biểu đồ toàn doanh nghiệp, có thể lọc theo `departmentId`/`roomId` bất kỳ |
| System Admin | Quản trị viên hệ thống | Xem KPI/biểu đồ toàn doanh nghiệp, quyền cao nhất, tương đương Business Admin ở tính năng này |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ để truy cập: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (đúng theo `API_CONTRACT` UC-148 và pattern `roles.some(r => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN')` đã có trong code).
- Permission bắt buộc: `analytics.overview.read`.
- `SYSTEM_ADMIN`/`BUSINESS_ADMIN`: không giới hạn scope dữ liệu; `departmentId` (nếu truyền) chỉ đóng vai trò filter thuần túy, không phải kiểm tra quyền sở hữu.
- `MANAGER`: scope dữ liệu giới hạn trong tập phòng ban `{d : departments.manager_user_id = currentUser.id}`.
  - Nếu Manager không quản lý phòng ban nào (`tập rỗng`): trả về dashboard rỗng theo EX1 (không phải lỗi).
  - Nếu Manager truyền `departmentId` nằm ngoài tập phòng ban mình quản lý: từ chối truy cập (`DEPARTMENT_OUT_OF_SCOPE`), không trả dữ liệu phòng ban khác.
- `roomId` là filter thuần túy cho mọi role (rooms không thuộc sở hữu phòng ban nào) — không có kiểm tra quyền sở hữu phòng.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập (JWT hợp lệ) trước khi truy cập Dashboard.
- Người dùng phải có permission `analytics.overview.read` gắn với 1 trong 3 role ở trên.
- Manager scope xác định qua `departments.manager_user_id = currentUser.id` — không dùng `direct_manager_id`.

---

## 3. Functional Requirements

Tất cả Functional Requirements được viết theo EARS. Keyword EARS giữ bằng tiếng Anh, nội dung nghiệp vụ viết bằng tiếng Việt.

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về toàn bộ dữ liệu Dashboard dưới dạng read-only — không tạo, sửa, xóa bất kỳ bản ghi nào trong `meetings`, `room_bookings`, `room_booking_usages`, `no_show_cases`, `attendance_records`, `meeting_participants`, `recording_sessions` khi phục vụ yêu cầu này.

FR-002: THE system SHALL tính toán lại toàn bộ chỉ số KPI và trend trực tiếp từ dữ liệu nguồn (on-demand aggregation) tại mỗi lần gọi API, không đọc từ bảng cache/snapshot/materialized view.

FR-003: THE system SHALL giới hạn phạm vi dữ liệu Manager trong tập phòng ban `{d : departments.manager_user_id = currentUser.id}`, suy ra qua `meetings.organizer_id → users.department_id`.

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu GET /api/v1/analytics/dashboard/overview, THE system SHALL kiểm tra authentication token hợp lệ trước khi xử lý bất kỳ logic nào khác.

FR-005: WHEN authentication thành công, THE system SHALL kiểm tra permission `analytics.overview.read` và role thuộc {MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN} trước khi truy vấn dữ liệu.

FR-006: WHEN người dùng không truyền `from`/`to`, THE system SHALL áp dụng khoảng thời gian mặc định là 30 ngày gần nhất tính đến thời điểm gọi API.

FR-007: WHEN người dùng truyền `from` và `to` hợp lệ, THE system SHALL sử dụng đúng khoảng thời gian đó để tính toán toàn bộ KPI và trend.

FR-008: WHEN currentUser có role MANAGER và không truyền `departmentId`, THE system SHALL tự động giới hạn dữ liệu trong toàn bộ phòng ban mà currentUser quản lý.

FR-009: WHEN currentUser có role MANAGER và truyền `departmentId` thuộc tập phòng ban mình quản lý, THE system SHALL lọc dữ liệu đúng phòng ban đó.

FR-010: WHEN currentUser có role BUSINESS_ADMIN hoặc SYSTEM_ADMIN và truyền `departmentId`, THE system SHALL lọc dữ liệu theo đúng phòng ban đó trong toàn bộ hệ thống (không kiểm tra sở hữu).

FR-011: WHEN người dùng truyền `roomId`, THE system SHALL lọc toàn bộ KPI/trend chỉ tính trên phòng đó (áp dụng cho mọi role, không kiểm tra sở hữu phòng theo phòng ban).

### 3.3 State-driven Requirements

FR-012: WHILE khoảng thời gian truy vấn không phát sinh bất kỳ `meetings` nào trong scope, THE system SHALL trả về tất cả KPI = 0 và `trend = []` kèm `message` mô tả không có dữ liệu hoạt động (EX1).

FR-013: WHILE dữ liệu presence (`first_presence_at`/`last_presence_at`) không tồn tại cho một `room_booking_usage` và `actual_start_time`/`actual_end_time` cũng không có, THE system SHALL loại bản ghi đó khỏi tử số của `utilizationRate` (không suy diễn/nội suy giá trị).

### 3.4 Optional Feature Requirements

FR-014: WHERE `departmentId` được cung cấp trong query, THE system SHALL áp dụng như một filter bổ sung sau khi đã áp dụng scope theo role (FR-008/FR-009/FR-010).

FR-015: WHERE `roomId` được cung cấp trong query, THE system SHALL áp dụng như một filter bổ sung độc lập với scope phòng ban.

### 3.5 Unwanted Behavior Requirements

FR-016: IF người dùng chưa đăng nhập, THEN THE system SHALL từ chối yêu cầu với status 401.

FR-017: IF người dùng đã đăng nhập nhưng không có permission `analytics.overview.read`, THEN THE system SHALL từ chối yêu cầu với status 403 và error code `PERMISSION_DENIED`.

FR-018: IF currentUser có role MANAGER và truyền `departmentId` không thuộc tập phòng ban mình quản lý, THEN THE system SHALL từ chối yêu cầu với status 403 và error code `DEPARTMENT_OUT_OF_SCOPE`.

FR-019: IF `from` hoặc `to` không đúng định dạng ISO date, THEN THE system SHALL từ chối yêu cầu với status 400 và error code `VALIDATION_ERROR`.

FR-020: IF `from` lớn hơn `to`, THEN THE system SHALL từ chối yêu cầu với status 400 và error code `VALIDATION_ERROR`.

FR-021: IF khoảng cách `to - from` vượt quá `analytics.dashboard_max_range_days` hiệu lực (xem FR-DATA-003), THEN THE system SHALL từ chối yêu cầu với status 400, error code `DATE_RANGE_TOO_LARGE`, và message gợi ý thu hẹp khoảng thời gian (đúng nội dung EX2 trong UC-AA-01).

FR-022: IF `departmentId` hoặc `roomId` không phải UUID hợp lệ, THEN THE system SHALL từ chối yêu cầu với status 400 và error code `VALIDATION_ERROR`.

### 3.6 Authorization Requirements

FR-023: WHEN the user performs a protected action (viewing dashboard overview), THE system SHALL verify authentication and authorization before executing any aggregation query.

FR-024: WHILE the user is acting as MANAGER (limited scope), THE system SHALL restrict every aggregation query (meetings, room_bookings, room_booking_usages, no_show_cases, attendance_records, meeting_participants, recording_sessions) to the department scope resolved in FR-003.

### 3.7 Data & State Requirements

FR-025: WHEN Dashboard được truy xuất thành công, THE system SHALL trả về `period`, `meetingCount`, `activeRooms`, `utilizationRate`, `noShowRate`, `onTimeRate`, `recordingCount`, `activeUserCount`, và `trend[]` (chi tiết công thức tại mục 5).

FR-026: WHEN tính `meetingCount`, THE system SHALL đếm số `meetings` trong scope có `start_time` trong khoảng `[from, to]`, `status <> 'draft'`, `deleted_at IS NULL`.

FR-027: WHEN tính `utilizationRate`, THE system SHALL tính `SUM(thời lượng sử dụng thực tế theo FR-013) ÷ SUM(reserved_end_time - reserved_start_time)` của các `room_booking_usages` gắn với `meetings` trong scope, nhân 100. Nếu mẫu số bằng 0, trả về `0`.

FR-028: WHEN tính `noShowRate`, THE system SHALL tính `COUNT(no_show_cases.detection_status IN ('confirmed','released')) ÷ COUNT(room_bookings.status IN ('approved','active','completed','released'))` trong scope, nhân 100. Nếu mẫu số bằng 0, trả về `0`.

FR-029: WHEN tính `onTimeRate`, THE system SHALL tính `COUNT(attendance_records.is_present=true AND is_late=false) ÷ COUNT(attendance_records.attendance_status IN ('present','late'))` trong scope, nhân 100. Nếu mẫu số bằng 0, trả về `0`.

FR-030: WHEN tính `activeUserCount`, THE system SHALL đếm số user duy nhất (DISTINCT) là `organizer_id` HOẶC là `meeting_participants.user_id` (với `invitation_status <> 'declined'`) của các `meetings` trong scope.

FR-031: WHEN tính `activeRooms`, THE system SHALL đếm số `room_id` duy nhất (DISTINCT) xuất hiện trong `room_bookings` gắn với `meetings` trong scope trong kỳ.

FR-032: WHEN tính `recordingCount`, THE system SHALL đếm số `recording_sessions` có `meeting_id` thuộc scope và `started_at` trong khoảng `[from, to]`.

FR-033: WHEN tính `trend`, THE system SHALL nhóm dữ liệu theo từng ngày trong khoảng `[from, to]` và trả về mảng `{date, meetingCount, utilizationRate}` cho mỗi ngày (kể cả ngày có `meetingCount = 0`).

### 3.8 Notification / Audit Requirements

FR-034: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN yêu cầu Dashboard hoàn tất thành công, THE system SHALL ghi audit log non-blocking với `action_type='read_analytics_dashboard_overview'`, `entity_type='analytics_dashboard'`, `metadata_json` chứa tối thiểu `{ viewerUserId, viewerRole, from, to, departmentId, roomId, resolvedScopeDepartmentIds }`. Nếu ghi log lỗi, hệ thống chỉ ghi log nội bộ, không trả lỗi cho người dùng.

### 3.9 Complex / Combined Requirements

FR-035: WHILE currentUser có role MANAGER, WHEN currentUser không quản lý bất kỳ phòng ban nào (`resolvedScopeDepartmentIds = []`), THE system SHALL trả về response giống EX1 (toàn bộ KPI = 0, `trend = []`) thay vì từ chối truy cập.

FR-036: WHERE `to - from` vượt `analytics.dashboard_max_range_days`, IF request vẫn được gửi, THEN THE system SHALL từ chối tại tầng validate DTO trước khi chạm tới bất kỳ truy vấn tổng hợp nào (tránh tải nặng DB không cần thiết).

### 3.10 Requirement Notes

- Không có requirement nào tạo/sửa dữ liệu — toàn bộ FR ở mục 3.7 là truy vấn tổng hợp thuần túy.
- `groupBy` (week/month) như các endpoint UC-149/150/151 khác **không** thuộc scope FR nào ở đây — trend của UC-148 chỉ theo ngày (đúng ví dụ response mẫu trong API_CONTRACT).

### 3.11 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001, FR-002, FR-003 | Ubiquitous | UC-AA-01 POST-2, BR2 | Read-only + real-time on-demand |
| FR-004–FR-011 | Event-driven | UC-AA-01 Normal Flow bước 1-7, UC-148 query params | |
| FR-012, FR-013 | State-driven | UC-AA-01 EX1 | |
| FR-014, FR-015 | Optional Feature | UC-148 query params `departmentId`/`roomId` | |
| FR-016–FR-022 | Unwanted Behavior | UC-AA-01 EX2, BR1 | |
| FR-023, FR-024 | Authorization | UC-AA-01 BR1 | |
| FR-025–FR-033 | Data & State | UC-AA-01 Normal Flow bước 3-4, UC-148 response mẫu | |
| FR-034 | Notification/Audit | Pattern audit đã có ở `attendance` feature | |
| FR-035, FR-036 | Complex | UC-AA-01 BR1 + EX2 | |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về Dashboard overview trong vòng dưới 3 giây cho khoảng thời gian mặc định (30 ngày) trong điều kiện tải bình thường.

NFR-002: THE system SHALL hỗ trợ tối thiểu 20 yêu cầu đồng thời cho endpoint Dashboard overview.

NFR-003: IF khoảng thời gian truy vấn vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL từ chối tại tầng validate (FR-021) trước khi chạy bất kỳ aggregation query nào.

### 4.2 Security

NFR-004: THE system SHALL yêu cầu authentication cho mọi request.

NFR-005: THE system SHALL enforce authorization (permission + role + department scope) ở tầng service, không chỉ dựa vào frontend.

NFR-006: THE system SHALL NOT để lộ dữ liệu của phòng ban ngoài scope cho role MANAGER dưới bất kỳ hình thức nào (kể cả qua `roomId` filter).

### 4.3 Reliability & Consistency

NFR-007: THE system SHALL đảm bảo mọi chỉ số KPI trong cùng 1 response được tính trên cùng 1 khoảng thời gian và cùng 1 scope (không lệch pha giữa các chỉ số).

NFR-008: THE system SHALL sử dụng index sẵn có trên `meetings(start_time, end_time)`, `meetings(organizer_id)`, `room_booking_usages(meeting_id)`, `attendance_records(meeting_id)` cho truy vấn tổng hợp.

### 4.4 Usability

NFR-009: THE system SHALL trả về clear error messages mà client có thể hiển thị trực tiếp.

NFR-010: THE system SHALL trả về field names dạng camelCase theo convention API chung.

### 4.5 Observability

NFR-011: THE system SHALL log lỗi xử lý quan trọng (query timeout, lỗi tổng hợp dữ liệu) cho feature này.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `meetings` | Nguồn chính để xác định scope (qua `organizer_id`) và `meetingCount` | Không có `department_id` trực tiếp |
| `users` | Xác định `department_id` của organizer/participant để resolve scope | |
| `departments` | Xác định tập phòng ban Manager quản lý (`manager_user_id`) | |
| `meeting_participants` | Tính `activeUserCount` | Loại `invitation_status = 'declined'` |
| `room_bookings` | Mẫu số `noShowRate`, nguồn `activeRooms` | |
| `room_booking_usages` | Tử số/mẫu số `utilizationRate` | |
| `no_show_cases` | Tử số `noShowRate` | |
| `attendance_records` | `onTimeRate` | |
| `recording_sessions` | `recordingCount` | |
| `system_configs` | Đọc `analytics.dashboard_max_range_days` | Không tạo bảng mới |

### 5.2 Dữ liệu đầu vào

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| from | date (ISO 8601) | Không | Bắt đầu khoảng thời gian | Nếu thiếu, mặc định = today - 30 ngày |
| to | date (ISO 8601) | Không | Kết thúc khoảng thời gian | Nếu thiếu, mặc định = today. `to >= from`. `to - from <= max_range_days` |
| departmentId | UUID | Không | Lọc theo phòng ban | UUID v4 hợp lệ; MANAGER chỉ được truyền phòng ban mình quản lý |
| roomId | UUID | Không | Lọc theo phòng họp | UUID v4 hợp lệ |

### 5.3 Dữ liệu đầu ra

| Field | Type dự kiến | Mô tả |
|---|---:|---|
| period.from | date | Khoảng thời gian thực tế áp dụng |
| period.to | date | Khoảng thời gian thực tế áp dụng |
| meetingCount | integer | Tổng số cuộc họp trong scope (FR-026) |
| activeRooms | integer | Số phòng có booking trong scope (FR-031) |
| utilizationRate | number (%) | Tỷ lệ lấp đầy phòng (FR-027) |
| noShowRate | number (%) | Tỷ lệ no-show (FR-028) |
| onTimeRate | number (%) | Tỷ lệ điểm danh đúng giờ (FR-029) |
| recordingCount | integer | Số phiên ghi hình trong scope (FR-032) |
| activeUserCount | integer | Số người dùng đang hoạt động (FR-030) — **bổ sung so với UC-148 gốc**, theo yêu cầu trực tiếp UC-AA-01 |
| trend[].date | date | Ngày trong khoảng `[from,to]` |
| trend[].meetingCount | integer | Số cuộc họp trong ngày đó |
| trend[].utilizationRate | number (%) | Tỷ lệ lấp đầy phòng trong ngày đó |

### 5.4 State / Status Model

Không áp dụng — tính năng không có state machine, chỉ đọc dữ liệu trạng thái sẵn có từ các bảng nguồn (`meetings.status`, `room_bookings.status`, `room_booking_usages.usage_status`, `no_show_cases.detection_status`, `attendance_records.attendance_status`).

### 5.5 Data Constraints

- Không được ghi/sửa/xóa bất kỳ bảng nguồn nào (FR-001).
- Không tạo bảng/cột mới — mọi tổng hợp tính trực tiếp qua SQL aggregate (đúng CLAUDE.md mục 5.2).
- `system_configs` dùng đúng 1 key mới: `analytics.dashboard_max_range_days` (xem FR-DATA-003), theo đúng pattern precedence đã dùng ở `no_show.threshold_minutes`.

### 5.6 Data Lifecycle

- Dữ liệu được tính lại (recompute) hoàn toàn ở mỗi request — không có vòng đời lưu trữ riêng cho dashboard.
- `system_configs['analytics.dashboard_max_range_days']` được đọc mỗi request (không cache) — ghi bởi admin qua kênh cấu hình hệ thống chung, **không** thuộc scope feature này (xem Out of Scope).

### 5.7 Data-related EARS Requirements

FR-DATA-001: WHEN resolving scope cho role MANAGER, THE system SHALL truy vấn `departments WHERE manager_user_id = currentUser.id` để lấy `resolvedScopeDepartmentIds`.

FR-DATA-002: WHEN resolving scope, THE system SHALL join `meetings.organizer_id = users.id AND users.department_id IN (resolvedScopeDepartmentIds)` cho mọi truy vấn KPI khi role là MANAGER.

FR-DATA-003: WHEN đọc giới hạn range, THE system SHALL áp dụng thứ tự ưu tiên `system_configs['analytics.dashboard_max_range_days'] → env ANALYTICS_DASHBOARD_MAX_RANGE_DAYS → default 366`.

### 5.8 Cần làm rõ

- **CL-1**: `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-148 hiện chưa có field `activeUserCount`. Đề xuất cập nhật tài liệu đó ở một task riêng ngoài phạm vi code feature này (xem Out of Scope §8.2) để tránh 2 nguồn tài liệu lệch nhau lâu dài.
- **CL-2**: Ngưỡng mặc định `analytics.dashboard_max_range_days = 366` là đề xuất theo NFR-003/EX2, chưa được xác nhận bằng số liệu tải thực tế của hệ thống — có thể điều chỉnh qua `system_configs` mà không cần sửa code.
- **CL-3**: `groupBy` (day/week/month) chưa được đưa vào scope FR-033 (chỉ theo ngày) để bám sát đúng response mẫu UC-148; nếu cần trend theo tuần/tháng sẽ là feature/FR bổ sung sau.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `from`/`to` không đúng ISO date, THEN THE system SHALL reject request với status 400, code `VALIDATION_ERROR`.

ERR-002: IF `from > to`, THEN THE system SHALL reject request với status 400, code `VALIDATION_ERROR`.

ERR-003: IF `departmentId`/`roomId` không phải UUID hợp lệ, THEN THE system SHALL reject request với status 400, code `VALIDATION_ERROR`.

ERR-004: IF `to - from` vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL reject request với status 400, code `DATE_RANGE_TOO_LARGE`.

### 6.2 Authentication / Authorization Errors

ERR-005: IF người dùng chưa đăng nhập, THEN THE system SHALL return 401.

ERR-006: IF người dùng không có permission `analytics.overview.read`, THEN THE system SHALL return 403, code `PERMISSION_DENIED`.

ERR-007: IF role MANAGER truyền `departmentId` ngoài scope quản lý, THEN THE system SHALL return 403, code `DEPARTMENT_OUT_OF_SCOPE`.

### 6.3 System Errors

ERR-008: IF database query bị lỗi hoặc timeout, THEN THE system SHALL return 500, code `INTERNAL_ERROR`, và log lỗi nội bộ.

### 6.4 Error Response Expectations

| Field | Mô tả |
|---|---|
| `success` | `false` |
| `message` | Thông báo lỗi hiển thị được |
| `error.code` | 1 trong: `VALIDATION_ERROR`, `DATE_RANGE_TOO_LARGE`, `PERMISSION_DENIED`, `DEPARTMENT_OUT_OF_SCOPE`, `INTERNAL_ERROR` |
| `error.details` | Chi tiết field lỗi nếu là validation |
| `timestamp` | ISO-8601 |
| `path` | `/api/v1/analytics/dashboard/overview` |

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When Business Admin gọi GET Dashboard overview không truyền `from`/`to`,
Then hệ thống trả về KPI + trend tính trên 30 ngày gần nhất, toàn bộ hệ thống (không giới hạn phòng ban).

AC-002:
Given Manager quản lý phòng ban "Kỹ thuật" (`departments.manager_user_id = manager.id`),
When Manager gọi GET Dashboard overview,
Then hệ thống trả về KPI + trend chỉ tính trên các `meetings` có `organizer` thuộc phòng ban "Kỹ thuật".

### 7.2 Validation Cases

AC-003:
Given `from` sai định dạng,
When gọi API,
Then hệ thống reject với 400 `VALIDATION_ERROR`.

AC-004:
Given khoảng `from`-`to` vượt `analytics.dashboard_max_range_days`,
When gọi API,
Then hệ thống reject với 400 `DATE_RANGE_TOO_LARGE`.

### 7.3 Authorization Cases

AC-005:
Given user không có permission `analytics.overview.read`,
When gọi API,
Then hệ thống reject với 403 `PERMISSION_DENIED`, không trả bất kỳ dữ liệu nào.

AC-006:
Given Manager không quản lý phòng ban "Nhân sự",
When Manager truyền `departmentId` = phòng ban "Nhân sự",
Then hệ thống reject với 403 `DEPARTMENT_OUT_OF_SCOPE`.

### 7.4 Business Rule Cases

AC-007:
Given khoảng thời gian không phát sinh `meetings` nào trong scope,
When gọi API,
Then hệ thống trả về tất cả KPI = 0, `trend = []` (EX1).

AC-008:
Given Manager không quản lý phòng ban nào,
When Manager gọi API không truyền `departmentId`,
Then hệ thống trả về response rỗng như AC-007, không phải lỗi 403.

### 7.5 Real-time Cases

AC-009:
Given một `meeting` mới hoàn tất và có `attendance_records` mới được ghi nhận trong scope,
When người dùng gọi lại Dashboard overview ngay sau đó (cùng khoảng thời gian),
Then `meetingCount`/`onTimeRate` phản ánh đúng dữ liệu mới nhất (không có độ trễ cache).

### 7.6 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-006, FR-025-FR-033 | Business Admin default range |
| AC-002 | FR-003, FR-008, FR-DATA-001, FR-DATA-002 | Manager department scope |
| AC-003 | FR-019, ERR-001 | Invalid date format |
| AC-004 | FR-021, ERR-004 | Range too large |
| AC-005 | FR-017, ERR-006 | No permission |
| AC-006 | FR-018, ERR-007 | Manager out-of-scope departmentId |
| AC-007 | FR-012 | Empty period |
| AC-008 | FR-035 | Manager manages zero departments |
| AC-009 | FR-002 | On-demand real-time recompute |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- UC-149 (Dashboard sử dụng phòng chi tiết), UC-150 (Dashboard điểm danh & hiện diện chi tiết), UC-151+ (thống kê meeting theo period/status/duration/cancel-rate) — đây là các UC/endpoint riêng biệt trong cùng mục 16 API_CONTRACT, không thuộc UC-AA-01.
- `groupBy` (week/month) cho trend — chỉ hỗ trợ trend theo ngày đúng response mẫu UC-148.
- Ghi/sửa/xóa bất kỳ bản ghi nghiệp vụ nào.
- WebSocket push/invalidate signal cho Dashboard — đòi hỏi sửa các module `live-meeting`, `rooms`, `attendance`, `presence` để bắn thêm event, vượt ranh giới module của feature `analytics`. "Real-time" được đáp ứng đủ bằng on-demand aggregation (FR-002); WebSocket invalidate có thể là feature riêng sau nếu cần giảm tải polling từ FE.
- Rollup phòng ban con (`parent_department_id`) cho scope Manager.
- Cộng gộp `direct_manager_id` cá nhân vào scope Manager (khác với pattern OR ở luồng approval).
- API/UI để admin cấu hình `analytics.dashboard_max_range_days` — feature này chỉ **đọc** config đó qua precedence có sẵn, không tạo endpoint ghi cấu hình mới.
- Cập nhật `docs/API_CONTRACT_v1.0_with_system_roles.md` để đồng bộ field `activeUserCount` — cần một task tài liệu riêng.

### 8.2 Có thể xem xét ở feature khác

- WebSocket invalidate signal cross-module cho toàn bộ dashboard family (UC-148/149/150/151).
- `groupBy` tuần/tháng cho trend.
- Đồng bộ lại `API_CONTRACT_v1.0_with_system_roles.md` với field mới.
- Cấu hình `analytics.dashboard_max_range_days` qua UI admin.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement UC-149/UC-150/UC-151 endpoints as part of this feature.
OOS-002: THE system SHALL NOT create new database tables or columns for this feature.
OOS-003: THE system SHALL NOT emit or subscribe to WebSocket invalidate events from other modules as part of this feature.
OOS-004: THE system SHALL NOT roll up Manager scope to parent or child departments.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements đã viết theo EARS.
- [x] Đã có đủ 5 EARS basic patterns: Ubiquitous, Event-driven, State-driven, Optional Feature, Unwanted Behavior.
- [x] Đã có Complex/Combined EARS Requirements (FR-035, FR-036).
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Error handling bao gồm validation, authentication, authorization, business rule, system error.
- [x] Acceptance Criteria dùng Given/When/Then, có traceability về FR/ERR.
- [x] Out of Scope đủ rõ, có EARS guardrails.
- [x] Không tự ý thêm bảng/cột database mới.
- [x] Các điểm thiếu thông tin đã đưa vào mục 5.8 "Cần làm rõ".
