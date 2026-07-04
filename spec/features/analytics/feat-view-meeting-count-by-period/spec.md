# Feature Specification: Xem thống kê số lượng cuộc họp theo khoảng thời gian

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo spec lần đầu cho UC-AA-04 / UC-151 Xem thống kê số lượng cuộc họp theo khoảng thời gian. Đã liệt kê điểm mơ hồ, đề xuất phương án, người dùng chọn Phương án A cho BR1 và duyệt toàn bộ đề xuất còn lại trước khi viết spec (xem §0 RECON). | Toàn bộ file |

---

- **Feature ID**: AA-MEETING-COUNT-BY-PERIOD-001
- **Feature Name**: Xem thống kê số lượng cuộc họp theo khoảng thời gian (View Meeting Count By Period)
- **Use Case**: UC-AA-04 Xem thống kê số lượng cuộc họp theo khoảng thời gian (= UC-151 trong API Contract)
- **Module / Domain**: analytics
- **Created Date**: 2026-07-02
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của người dùng — mô tả UC-AA-04 (actor, trigger, precondition, postcondition, normal/alternative flow, exception, business rules)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — mục 16 UC-151 (đã có endpoint/response mẫu)
  - `database_v3_2_compact_39_tables.md` — bảng `meetings`
  - `spec/features/analytics/feat-view-dashboard-overview/` (UC-AA-01) — tái dùng pattern scope theo phòng ban tĩnh + config `analytics.dashboard_max_range_days`
  - `.specify/memory/constitution.md`, `CLAUDE.md`

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. BR1 — Phương án A đã chọn (không cross-check thời gian)

BR1: "chỉ đưa vào thống kê những cuộc họp có trạng thái 'Đã hoàn tất' hoặc 'Đã lên lịch'". **Quyết định đã chọn (Phương án A)**: lọc thuần túy `meetings.status IN ('completed', 'scheduled')`, **không** cross-check thêm `start_time` so với thời điểm hiện tại. Loại hoàn toàn `draft`, `pending_approval`, `in_progress`, `cancelled` khỏi thống kê. Không xử lý edge case dữ liệu lệch (vd `scheduled` nhưng `start_time` đã qua) — nếu phát sinh vấn đề thực tế sẽ nâng cấp ở feature sau.

### 0.2. AF1 "dự báo tương lai" — KHÔNG phải thuật toán forecast/ML

AF1 mô tả "vẽ biểu đồ xu hướng dự báo dựa trên số lượng cuộc họp đã được đặt lịch (Scheduled) thành công" — đây là đếm dữ liệu **đã tồn tại** trong tương lai (`meetings.status='scheduled'`, `start_time` tương lai), **không phải** mô hình dự đoán thống kê/AI. AF1 dùng chung 1 API, 1 công thức với Normal Flow — chỉ khác `from/to` rơi vào tương lai. Đúng nguyên tắc CLAUDE.md mục 3 "không tự ý thêm AI/ML pipeline".

### 0.3. Bổ sung filter `roomId` và `meetingType` — chưa có trong UC-151 gốc

Query mẫu UC-151 (`docs/API_CONTRACT_v1.0_with_system_roles.md:4927`) chỉ có `from/to/granularity/departmentId`, thiếu 2 filter mà Normal Flow bước 4 yêu cầu ("Không gian phòng họp cụ thể", "Loại cuộc họp"). **Quyết định đã duyệt**: bổ sung `roomId` (UUID, lọc `meetings.room_id`) và `meetingType` (enum `normal|training|interview|emergency`, lọc `meetings.meeting_type`).

### 0.4. EX1 — series đủ bucket với count=0, không trả mảng rỗng

**Quyết định đã duyệt**: `series` luôn trả đủ toàn bộ bucket trong `[from,to]` theo `granularity` (kể cả bucket `count=0`) — khớp đúng nghĩa "đưa giá trị đường xu hướng về mốc số 0" (đường vẫn hiển thị, đi ngang ở mức 0), khác với cách UC-AA-01 dùng `trend=[]`. Chỉ thêm `message` mô tả khi `total === 0` toàn dải, để FE hiển thị toast.

### 0.5. `granularity` chỉ hỗ trợ `week`/`month` — không thêm `day`

**Quyết định đã duyệt**: `granularity IN ('week', 'month')`, mặc định `week`. Không tự thêm `day` vì UC-AA-04 không đề cập.

### 0.6. Định dạng label `period`

**Quyết định đã duyệt**: `week` → `"YYYY-'W'WW"` (ISO week, đúng mẫu contract `"2026-W18"`), `month` → `"YYYY-MM"`.

### 0.7. Giới hạn range — tái dùng config đã có

**Quyết định đã duyệt**: tái dùng nguyên `analytics.dashboard_max_range_days` (đã tạo ở UC-AA-01, đọc qua `system_configs → env → default 366`), không tạo config mới, dù UC-AA-04 không có EX2 tường minh — áp dụng như safety net chủ động.

### 0.8. BR2 — tái dùng nguyên pattern scope UC-AA-01

**Quyết định đã duyệt**: Manager không truyền `departmentId` → tự động giới hạn phòng ban mình quản lý (`departments.manager_user_id = currentUser.id`, suy ra qua `meetings.organizer_id → users.department_id`, **tĩnh, không phụ thuộc kỳ lọc** — khác UC-AA-02). Manager truyền `departmentId` ngoài phạm vi → 403 `DEPARTMENT_OUT_OF_SCOPE`. Admin (Business/System) truyền `departmentId` bất kỳ hoặc bỏ trống (toàn công ty).

### 0.9. Vai trò truy cập — bổ sung SYSTEM_ADMIN dù UC-AA-04 không liệt kê tường minh

Primary Actor của UC-AA-04 chỉ ghi "Manager / Approver, Business Admin", nhưng `API_CONTRACT` UC-151 ghi rõ System Role gồm cả `SYSTEM_ADMIN` ([API_CONTRACT_v1.0_with_system_roles.md:4924](../../../../docs/API_CONTRACT_v1.0_with_system_roles.md)), và BR2 dùng từ "Admin" chung chung (không tách Business/System). Quyết định: giữ `SYSTEM_ADMIN` trong danh sách role hợp lệ (nhất quán với đặc quyền cao nhất đã áp dụng ở UC-AA-01/02, không có căn cứ nào loại trừ System Admin khỏi 1 tính năng chỉ đọc).

### 0.10. Tooltip hover — Out of Scope (thuần FE)

`series[].period` + `series[].count` đã đủ dữ liệu cho FE tự dựng tooltip — không cần API/logic BE riêng.

### 0.11. Field/entity xác nhận tồn tại thật

- `MeetingEntity`: `id, organizerId, roomId, meetingType (enum), status (enum), startTime, endTime, deletedAt` ([meeting.entity.ts](../../../../src/modules/meetings/entities/meeting.entity.ts)).
- `MeetingStatus`: `draft|pending_approval|scheduled|in_progress|completed|cancelled`.
- `MeetingType`: `normal|training|interview|emergency`.
- `DepartmentEntity.managerUserId`, `UserEntity.departmentId` — scope Manager, đúng pattern [meetings.service.ts:4670-4685](../../../../src/modules/meetings/services/meetings.service.ts) và đã dùng ở UC-AA-01.
- `SystemConfigEntity` — tái dùng key `analytics.dashboard_max_range_days` đã tạo ở UC-AA-01, không tạo bảng/cột/key mới.
- **Không có bảng/cột nào cần thêm.**

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `analytics`, cung cấp biểu đồ xu hướng số lượng cuộc họp theo thời gian (line/bar chart), phục vụ Manager/Business Admin/System Admin nhận định các đỉnh cao điểm hoặc vùng trũng hoạt động tổ chức họp, kể cả nhìn trước mật độ sử dụng phòng trong tương lai gần (dựa trên các cuộc họp đã đặt lịch). Tính năng **read-only tuyệt đối**.

### 1.2 Mục tiêu

Cho phép Manager (giới hạn phòng ban phụ trách), Business Admin, System Admin xem số lượng cuộc họp theo thời gian, nhóm theo tuần/tháng, lọc theo phòng ban/phòng họp/loại cuộc họp, trên một khoảng thời gian tùy chỉnh (bao gồm cả tương lai).

### 1.3 Giá trị mang lại

- Cho Manager: nhận diện xu hướng tổ chức họp của phòng ban mình, chủ động dự trù phòng cho các mốc cao điểm sắp tới.
- Cho Business Admin/System Admin: giám sát xu hướng toàn công ty, phát hiện bất thường theo mùa vụ/kỳ nghỉ lễ.
- Cho vận hành: hỗ trợ ra quyết định điều phối phòng dựa trên mật độ đã đặt lịch trong tương lai gần.

### 1.4 Giả định

- Chỉ tính `meetings.status IN ('completed','scheduled')` (§0.1 Phương án A), không cross-check thời gian.
- `series` luôn đủ bucket theo `granularity` trong `[from,to]`, không rút gọn khi rỗng (§0.4).
- Scope Manager tĩnh, dùng đúng logic đã có ở UC-AA-01 (không phụ thuộc kỳ lọc, khác UC-AA-02).
- `roomId`/`meetingType` là filter thuần túy, áp dụng cho mọi role, không có kiểm tra sở hữu.
- AF1 không cần logic riêng — chỉ là cùng 1 API gọi với `from/to` tương lai.

### 1.5 Clarifications Resolved

Toàn bộ điểm mơ hồ đã liệt kê và người dùng duyệt (chọn Phương án A cho BR1, đồng ý các đề xuất còn lại) — tổng hợp tại §0.1–§0.10.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager / Approver | Quản lý cấp phòng ban | Xem thống kê giới hạn trong phòng ban mình phụ trách |
| Business Admin | Quản trị viên doanh nghiệp | Xem thống kê toàn công ty, có thể lọc theo `departmentId` bất kỳ |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin ở tính năng này (§0.9) |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Permission bắt buộc: `analytics.meeting.read`.
- `SYSTEM_ADMIN`/`BUSINESS_ADMIN`: không giới hạn scope; `departmentId` là filter thuần túy.
- `MANAGER`: scope = phòng ban `departments.manager_user_id = currentUser.id` (tĩnh). Truyền `departmentId` ngoài scope → 403 `DEPARTMENT_OUT_OF_SCOPE`.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `analytics.meeting.read`.
- Scope Manager dùng `departments.manager_user_id`, không dùng `direct_manager_id`, không rollup phòng ban con (nhất quán UC-AA-01).

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về toàn bộ dữ liệu dưới dạng read-only — không tạo/sửa/xóa bất kỳ bản ghi nào trong `meetings`.

FR-002: THE system SHALL tính toán lại toàn bộ `total`/`series` trực tiếp từ dữ liệu nguồn (on-demand aggregation) tại mỗi lần gọi API.

FR-003: THE system SHALL chỉ tính các `meetings` có `status IN ('completed', 'scheduled')` vào thống kê (BR1, Phương án A — §0.1), bất kể `start_time` quá khứ hay tương lai.

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu GET /api/v1/analytics/meetings/count-by-period, THE system SHALL kiểm tra authentication và permission `analytics.meeting.read` trước khi xử lý logic khác.

FR-005: WHEN người dùng không truyền `from`/`to`, THE system SHALL áp dụng mặc định là khoảng "Tháng hiện tại" (đầu tháng đến cuối tháng, theo timezone `Asia/Ho_Chi_Minh`).

FR-006: WHEN người dùng truyền `from`/`to` hợp lệ (kể cả khoảng rơi vào tương lai — AF1), THE system SHALL dùng đúng khoảng đó để tính `total`/`series`.

FR-007: WHEN người dùng không truyền `granularity`, THE system SHALL mặc định `granularity='week'`.

FR-008: WHEN người dùng truyền `granularity IN ('week','month')`, THE system SHALL nhóm `series` theo đúng đơn vị đó.

FR-009: WHEN currentUser có role MANAGER và không truyền `departmentId`, THE system SHALL tự động giới hạn dữ liệu trong phòng ban mình quản lý.

FR-010: WHEN currentUser có role MANAGER và truyền `departmentId` thuộc phòng ban mình quản lý, THE system SHALL lọc đúng phòng ban đó.

FR-011: WHEN currentUser có role BUSINESS_ADMIN hoặc SYSTEM_ADMIN và truyền `departmentId`, THE system SHALL lọc theo đúng phòng ban đó trong toàn hệ thống (không kiểm tra sở hữu).

FR-012: WHEN người dùng truyền `roomId`, THE system SHALL lọc chỉ còn các `meetings` có `room_id` tương ứng.

FR-013: WHEN người dùng truyền `meetingType`, THE system SHALL lọc chỉ còn các `meetings` có `meeting_type` tương ứng.

### 3.3 State-driven Requirements

FR-014: WHILE tổ hợp filter không có `meetings` nào thỏa mãn trong toàn bộ `[from,to]`, THE system SHALL trả `total=0`, `series` đủ bucket với `count=0` mỗi bucket, kèm `message` mô tả không tìm thấy dữ liệu (EX1).

### 3.4 Optional Feature Requirements

FR-015: WHERE `departmentId` được cung cấp, THE system SHALL áp dụng như filter bổ sung sau khi đã áp scope theo role.

FR-016: WHERE `roomId`/`meetingType` được cung cấp, THE system SHALL áp dụng như filter bổ sung độc lập với scope phòng ban.

### 3.5 Unwanted Behavior Requirements

FR-017: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-018: IF người dùng không có permission `analytics.meeting.read`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-019: IF currentUser có role MANAGER và truyền `departmentId` ngoài phòng ban mình quản lý, THEN THE system SHALL trả về 403, error code `DEPARTMENT_OUT_OF_SCOPE`.

FR-020: IF `from`/`to` không đúng ISO date hoặc `from > to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-021: IF `granularity` không thuộc {week, month}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-022: IF `meetingType` không thuộc enum hợp lệ, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-023: IF `departmentId`/`roomId` không phải UUID hợp lệ, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-024: IF khoảng `to - from` vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL trả về 400, error code `DATE_RANGE_TOO_LARGE`.

### 3.6 Authorization Requirements

FR-025: WHEN the user performs a protected action (xem thống kê), THE system SHALL verify authentication và authorization trước khi thực thi aggregation query.

FR-026: WHILE currentUser đang ở scope MANAGER, THE system SHALL áp scope phòng ban cho mọi truy vấn `meetings`.

### 3.7 Data & State Requirements

FR-027: WHEN tính `total`, THE system SHALL đếm tổng số `meetings` thỏa FR-003 trong scope + filter + `[from,to]`.

FR-028: WHEN tính `series`, THE system SHALL nhóm `meetings` thỏa FR-003 theo `start_time` vào từng bucket `granularity` (tuần ISO hoặc tháng dương lịch), trả về đủ mọi bucket trong `[from,to]` theo thứ tự thời gian tăng dần, kể cả bucket `count=0`.

FR-029: WHEN tạo label `period` cho mỗi bucket, THE system SHALL dùng định dạng `"YYYY-'W'WW"` cho `granularity=week` và `"YYYY-MM"` cho `granularity=month` (§0.6).

### 3.8 Notification / Audit Requirements

FR-030: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN yêu cầu hoàn tất thành công, THE system SHALL ghi audit log non-blocking `action_type='read_analytics_meeting_count_by_period'`, `entity_type='meetings'`, `metadata_json` chứa tối thiểu `{viewerUserId, viewerRole, from, to, granularity, departmentId, roomId, meetingType, resolvedScopeDepartmentIds}`.

### 3.9 Complex / Combined Requirements

FR-031: WHILE currentUser có role MANAGER, WHEN currentUser không quản lý phòng ban nào, THE system SHALL trả về response rỗng như FR-014 thay vì lỗi.

FR-032: WHERE `to - from` vượt `analytics.dashboard_max_range_days`, IF request vẫn được gửi, THEN THE system SHALL từ chối tại tầng validate DTO trước khi chạm tới bất kỳ truy vấn tổng hợp nào.

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-AA-04 POST-2, BR1 |
| FR-004–FR-013 | Event-driven | UC-AA-04 Normal Flow bước 1-5, AF1, UC-151 query params |
| FR-014 | State-driven | UC-AA-04 EX1 |
| FR-015, FR-016 | Optional Feature | UC-151 query params + bổ sung §0.3 |
| FR-017–FR-024 | Unwanted Behavior | UC-AA-04 BR2, validation |
| FR-025, FR-026 | Authorization | UC-AA-04 BR2 |
| FR-027–FR-029 | Data & State | UC-AA-04 Normal Flow bước 2-3, UC-151 response mẫu |
| FR-030 | Notification/Audit | Pattern audit đã dùng ở UC-AA-01/02 |
| FR-031, FR-032 | Complex | UC-AA-04 BR2 + range guard §0.7 |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về kết quả trong vòng dưới 2 giây cho khoảng thời gian mặc định (tháng hiện tại, granularity=week) trong điều kiện tải bình thường.

NFR-002: IF khoảng thời gian truy vấn vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL từ chối tại tầng validate (FR-024) trước khi chạy aggregation.

### 4.2 Security

NFR-003: THE system SHALL yêu cầu authentication cho mọi request.

NFR-004: THE system SHALL enforce scope phòng ban Manager ở tầng service, không chỉ dựa vào FE.

### 4.3 Reliability & Consistency

NFR-005: THE system SHALL đảm bảo `total` và tổng `series[].count` luôn khớp nhau trong cùng 1 response.

NFR-006: THE system SHALL sử dụng index sẵn có trên `meetings(start_time, end_time)`, `meetings(organizer_id)`, `meetings(room_id)`, `meetings(status)`.

### 4.4 Usability

NFR-007: THE system SHALL trả về clear error messages và field names dạng camelCase.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `meetings` | Nguồn duy nhất cho `total`/`series` | Lọc `status IN ('completed','scheduled')` |
| `users` | Resolve scope Manager (`department_id`) | |
| `departments` | Resolve scope Manager (`manager_user_id`) | |
| `system_configs` | Tái dùng `analytics.dashboard_max_range_days` | Không tạo key mới |

### 5.2 Dữ liệu đầu vào

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| from | date (ISO 8601) | Không | Bắt đầu khoảng | Mặc định đầu tháng hiện tại nếu thiếu |
| to | date (ISO 8601) | Không | Kết thúc khoảng | Mặc định cuối tháng hiện tại nếu thiếu; `to >= from`; range ≤ `analytics.dashboard_max_range_days` |
| granularity | string | Không | `week`/`month`, mặc định `week` | Enum hợp lệ |
| departmentId | UUID | Không | Lọc phòng ban | UUID hợp lệ; MANAGER chỉ được truyền phòng ban mình quản lý |
| roomId | UUID | Không | Lọc phòng họp | UUID hợp lệ |
| meetingType | string | Không | `normal`/`training`/`interview`/`emergency` | Enum hợp lệ |

### 5.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| total | integer | Tổng số meetings thỏa điều kiện trong toàn bộ `[from,to]` |
| series[].period | string | Label bucket theo `granularity` (§0.6) |
| series[].count | integer | Số meetings trong bucket đó |
| message | string (optional) | Chỉ có khi `total=0` — mô tả EX1 |

### 5.4 Data Constraints

- Không ghi/sửa/xóa `meetings`.
- Không thêm bảng/cột/config key mới — tái dùng nguyên `analytics.dashboard_max_range_days`.
- `series` luôn đủ bucket theo `granularity` trong `[from,to]`, kể cả `count=0` (§0.4).

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN resolving scope cho role MANAGER, THE system SHALL truy vấn `departments WHERE manager_user_id = currentUser.id` để lấy `resolvedScopeDepartmentIds`, dùng nguyên hàm/logic đã có từ UC-AA-01 (không viết lại).

FR-DATA-002: WHEN đọc giới hạn range, THE system SHALL áp dụng đúng precedence đã có `system_configs['analytics.dashboard_max_range_days'] → env → default 366` (tái dùng `DashboardOverviewConfigService`).

### 5.6 Cần làm rõ

- **CL-1**: `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-151 hiện chưa có `roomId`/`meetingType` — cần task đồng bộ tài liệu riêng (giống các CL trước).
- **CL-2**: Phương án A ở BR1 (không cross-check thời gian) có thể tạo số liệu hơi lệch nếu tồn tại nhiều `scheduled` quá hạn chưa được cron xử lý — chấp nhận rủi ro này theo quyết định đã chọn, có thể nâng cấp sau nếu phát sinh vấn đề thực tế.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `from`/`to` sai định dạng hoặc `from > to`, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `granularity` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `meetingType` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF `departmentId`/`roomId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-005: IF range vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.

### 6.2 Authentication / Authorization Errors

ERR-006: IF chưa đăng nhập, THEN 401.
ERR-007: IF không có permission `analytics.meeting.read`, THEN 403 `PERMISSION_DENIED`.
ERR-008: IF MANAGER truyền `departmentId` ngoài scope, THEN 403 `DEPARTMENT_OUT_OF_SCOPE`.

### 6.3 System Errors

ERR-009: IF lỗi truy vấn hệ thống, THEN 500 `INTERNAL_ERROR`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When gọi API không truyền tham số,
Then hệ thống trả về `total`/`series` tính trên tháng hiện tại, nhóm theo tuần, toàn công ty.

AC-002:
Given Manager quản lý phòng ban "Kỹ thuật",
When Manager gọi API không truyền `departmentId`,
Then hệ thống chỉ đếm các `meetings` do phòng ban "Kỹ thuật" tổ chức.

AC-003 (AF1):
Given người dùng truyền `from`/`to` là tháng kế tiếp (tương lai),
When gọi API,
Then hệ thống trả về `series` chỉ gồm các `meetings.status='scheduled'` đã đặt lịch trong tháng đó (không có thuật toán dự đoán).

### 7.2 Validation & Authorization Cases

AC-004:
Given `granularity` không hợp lệ,
When gọi API,
Then hệ thống reject 400 `VALIDATION_ERROR`.

AC-005:
Given Manager truyền `departmentId` không thuộc phòng ban mình quản lý,
When gọi API,
Then hệ thống reject 403 `DEPARTMENT_OUT_OF_SCOPE`.

### 7.3 Business Rule Cases

AC-006:
Given tổ hợp filter không có `meetings` nào thỏa mãn trong `[from,to]`,
When gọi API,
Then `total=0`, `series` đủ bucket với `count=0` mỗi bucket, kèm `message` (EX1).

AC-007:
Given tồn tại `meetings.status='cancelled'` hoặc `'in_progress'` trong khoảng lọc,
When gọi API,
Then các meeting đó KHÔNG được tính vào `total`/`series` (Phương án A, BR1).

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-007, FR-027-FR-029 |
| AC-002 | FR-009, FR-DATA-001 |
| AC-003 | FR-006, FR-003 |
| AC-004 | FR-021, ERR-002 |
| AC-005 | FR-019, ERR-008 |
| AC-006 | FR-014, FR-031 |
| AC-007 | FR-003 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Bất kỳ thuật toán dự báo/forecast/ML nào cho AF1 (§0.2) — chỉ đếm dữ liệu `scheduled` đã có sẵn.
- Tooltip hover trên biểu đồ — thuần FE (§0.10).
- `granularity=day` — không có căn cứ từ UC-AA-04.
- UC-152 (status-breakdown), UC-153 (average-duration), UC-154 (cancel-rate) — các UC/endpoint riêng biệt khác dù cùng nằm trong mục 16 API_CONTRACT.
- Cross-check `status` với `start_time` (Phương án B của BR1) — đã chọn Phương án A.
- WebSocket push/invalidate — cùng lý do đã loại ở các feature trước (vượt module boundary).
- Rollup phòng ban con cho scope Manager.

### 8.2 Có thể xem xét ở feature khác

- Đồng bộ `API_CONTRACT_v1.0_with_system_roles.md` với `roomId`/`meetingType`.
- Nâng cấp BR1 lên Phương án B nếu phát sinh vấn đề dữ liệu lệch thực tế.
- `granularity=day` nếu có yêu cầu rõ ràng sau này.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement any forecasting/ML algorithm for AF1 — count existing scheduled data only.
OOS-002: THE system SHALL NOT create new database tables, columns, or system_configs keys for this feature.
OOS-003: THE system SHALL NOT cross-check meeting status against start_time when filtering (BR1 Option A).
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
