# Feature Specification: Xem thống kê tỷ lệ tham dự đúng giờ

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Tạo spec lần đầu cho UC-AA-10 / UC-157 Xem thống kê tỷ lệ tham dự đúng giờ. Đã phân tích, liệt kê điểm mơ hồ, đề xuất phương án và được người dùng duyệt 4 quyết định chính (mẫu số `onTimeRate` gồm cả absent, giữ `graceMinutes` mặc định 0, scope theo phòng ban người tham dự, thêm endpoint AF1 trong cùng feature) trước khi viết spec (xem §0 RECON). Các điểm mơ hồ nhỏ còn lại chốt theo phương án khuyến nghị (người dùng không phản đối). | Toàn bộ file |

---

- **Feature ID**: AA-ON-TIME-RATE-001
- **Feature Name**: Xem thống kê tỷ lệ tham dự đúng giờ (View On-time Attendance Rate)
- **Use Case**: UC-AA-10 Xem thống kê tỷ lệ tham dự đúng giờ (= UC-157 trong API Contract)
- **Module / Domain**: analytics
- **Created Date**: 2026-07-02
- **Status**: Draft
- **Source Documents**:
  - Yêu cầu trực tiếp của người dùng — mô tả UC-AA-10 (actor, trigger, precondition, postcondition, normal/alternative flow, exception, business rules)
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — mục 16 UC-157 (endpoint/response mẫu, **mẫu số ngầm định gồm cả absent, mâu thuẫn với UC-AA-01**)
  - `database_v3_2_compact_39_tables.md` — `attendance_records`, `meeting_participants`, `meetings`, `users`, `departments`
  - `src/modules/attendance/entities/attendance-record.entity.ts` — xác nhận field thật (`isPresent, isLate, lateMinutes, attendanceStatus`)
  - `spec/features/attendance/feat-view-meeting-attendance-list/spec.md` (UC-APM-02) — xác nhận quy ước "không grace period" ở tầng ghi nhận, quy tắc fallback `absent` khi meeting completed mà chưa có `attendance_records`, pattern filter `search` (name/email/employee_code)
  - `spec/features/analytics/feat-view-dashboard-overview/spec.md` (UC-AA-01) — đối chiếu và **KHÔNG tái dùng** công thức `onTimeRate` cũ (khác mẫu số — xem §0.1)
  - `spec/features/analytics/feat-view-room-usage-dashboard/spec.md` (UC-AA-02) — tái dùng tiền lệ bổ sung endpoint drill-down ngoài contract gốc (áp dụng cho AF1)
  - `.specify/memory/constitution.md`, `CLAUDE.md`

---

## 0. RECON — Đối chiếu nguồn + các quyết định đã duyệt cùng người dùng

### 0.1. Mẫu số `onTimeRate` — gồm cả absent, KHÔNG tái dùng công thức UC-AA-01 — đã duyệt

Số liệu mẫu trong `API_CONTRACT` UC-157: `onTimeCount=385, totalRequiredParticipants=467, onTimeRate=82.4` → `385÷467=82.4%`, tức mẫu số là **toàn bộ người được mời** (present+late+absent). Điều này khác hẳn công thức `onTimeRate` đã chốt ở [feat-view-dashboard-overview/spec.md điểm 3](../feat-view-dashboard-overview/spec.md) (`(is_present AND !is_late) ÷ (status IN present,late)`, loại hẳn absent). **Quyết định đã duyệt**: UC-AA-10 dùng đúng công thức literal của chính UC-157 (`onTimeCount ÷ totalRequiredParticipants`, coi vắng mặt là vi phạm nặng nhất) — chấp nhận đây là 1 định nghĩa "onTimeRate" riêng, khác với KPI card tổng quan ở UC-AA-01 (2 màn hình phục vụ 2 mục đích khác nhau, không bắt buộc thống nhất 1 công thức toàn hệ thống).

### 0.2. `graceMinutes` — giữ lại, mặc định 0, không sửa dữ liệu gốc — đã duyệt

[feat-view-meeting-attendance-list/spec.md điểm 1.4](../../attendance/feat-view-meeting-attendance-list/spec.md) đã chốt "không áp dụng grace period" ở tầng ghi nhận (`is_late`/`late_minutes` tính từ phút đầu tiên). **Quyết định đã duyệt**: giữ `graceMinutes` là query param tùy chọn của riêng tầng phân tích này, **mặc định `0`** (khớp đúng quy ước đã chốt). Khi `graceMinutes > 0`: tính lại "đúng giờ" dựa trên `late_minutes` đã lưu sẵn (`late_minutes <= graceMinutes` → coi là đúng giờ), **không sửa** `attendance_records.is_late`/`late_minutes` gốc — đây là ngưỡng báo cáo tại thời điểm truy vấn, không phải thay đổi dữ liệu nguồn.

### 0.3. Cơ sở scope Manager — theo phòng ban NGƯỜI THAM DỰ, không theo người tổ chức — đã duyệt

Khác toàn bộ UC-AA-04–09 (scope theo `meetings.organizer_id → department`), UC-AA-10 thống kê về **nhân sự** (ai đúng giờ/đi muộn), nên **quyết định đã duyệt**: scope Manager suy ra từ `attendance_records.user_id → users.department_id` (phòng ban của chính người tham dự), không liên quan gì đến ai tổ chức cuộc họp mà họ tham gia.

### 0.4. AF1 (drill-down lịch sử cá nhân) — endpoint mới trong cùng feature — đã duyệt

`API_CONTRACT` UC-157 không có endpoint nào cho AF1. **Quyết định đã duyệt**: bổ sung `GET /api/v1/analytics/attendance/on-time-rate/users/{userId}/late-history` trong cùng feature này (tiền lệ giống UC-AA-02 đã bổ sung `{roomId}/detail` ngoài contract gốc), dùng chung permission `analytics.attendance.read`. Endpoint chỉ liệt kê các cuộc họp **đi muộn** (đúng nguyên văn AF1 "đã tham gia muộn"), không phải toàn bộ lịch sử điểm danh.

### 0.5. Phân loại 6 giá trị `attendance_status` vào 3 nhóm — đã duyệt

`AttendanceRecordStatus = present|absent|late|left_early|invalidated|pending_review`. **Quyết định**:
- `present` → nhóm **onTime**.
- `late` → nhóm **late**.
- `absent` → nhóm **absent**.
- `left_early` → phân theo cờ `is_late` (đã có mặt, chỉ về sớm — thời điểm rời đi không liên quan đến "đến đúng giờ"): `is_late=false` → onTime, `is_late=true` → late.
- `invalidated`, `pending_review` → **loại hoàn toàn** khỏi `totalRequiredParticipants` (dữ liệu chưa xác thực/lỗi kỹ thuật, không tính vào cả tử số lẫn mẫu số).
- Participant nội bộ (`meeting_participants`, `invitation_status <> 'declined'`) của 1 meeting `status='completed'` mà KHÔNG có bất kỳ `attendance_records` nào → mặc định **absent** (tái dùng đúng fallback đã chốt ở [feat-view-meeting-attendance-list FR-012](../../attendance/feat-view-meeting-attendance-list/spec.md)).

### 0.6. Chỉ tính trên `meetings.status='completed'` — đã duyệt

Dữ liệu điểm danh chỉ có ý nghĩa lịch sử ổn định sau khi cuộc họp đã kết thúc (meeting đang `scheduled`/`in_progress` có thể chưa đủ người check-in). **Quyết định**: `totalRequiredParticipants`/`onTimeCount`/`lateCount`/`absentCount` chỉ tính trên `meetings.status='completed'` trong `[from,to]` (theo `meetings.start_time`).

### 0.7. Bộ lọc — `departmentId` đơn (không multi-select), `meetingId`, `search` — đã duyệt

Normal Flow bước 5 dùng chữ số ít "**một** phòng ban mục tiêu", "**một** cuộc họp cụ thể" — khác UC-AA-05/06/07 (multi-select `departmentIds[]`). **Quyết định**: `departmentId` (UUID đơn), `meetingId` (UUID đơn, filter dimension mới), `search` (string, tái dùng đúng pattern fuzzy search trên `full_name`/`email`/`employee_code` đã có ở `feat-view-meeting-attendance-list`, KHÁC pattern exact-email-match `organizerEmail` đã dùng ở UC-AA-07/09). Không có filter `roomId` (Normal Flow không nhắc).

### 0.8. `trend` theo tuần — giữ lại, không cần `granularity` param

Normal Flow bước 3 mô tả rõ "biểu đồ xu hướng... theo các tuần" — đây là yêu cầu trực tiếp (khác UC-AA-09 nơi Normal Flow không hề nhắc trend nên đã bỏ). **Quyết định**: `trend[]` luôn nhóm theo tuần ISO, không cần tham số `granularity`.

### 0.9. "Phân bổ theo khung giờ" — bucket cố định theo giờ đồng hồ dựa trên `meetings.start_time`

Ví dụ trong UC ("08:00-09:00", "13:30-14:30") chỉ là minh họa, không phải yêu cầu bucket lệch giờ. **Quyết định**: dùng 24 bucket cố định theo giờ đồng hồ (0-23h, tái dùng pattern heatmap đã có ở UC-AA-02/08), nhóm theo giờ bắt đầu **lịch gốc** (`meetings.start_time`), KHÔNG theo giờ check-in thực tế.

### 0.10. Permission mới `analytics.attendance.read` — cần seed

Khác `analytics.meeting.read`/`analytics.room.read` (đã seed ở UC-AA-04/UC-AA-02), permission này **chưa tồn tại** trong hệ thống — cần task seed mới, gán cho `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (đúng `API_CONTRACT` UC-157).

### 0.11. EX1 — trigger khi không có dữ liệu, kiểu trung tính

Khác EX1 "tích cực" của UC-AA-09 (trigger khi 0 vi phạm dù vẫn có dữ liệu), EX1 của UC-AA-10 trigger khi **không có bất kỳ lượt tham gia nào khớp filter** (`totalRequiredParticipants=0`). **Quyết định**: dùng nguyên văn "Không tìm thấy dữ liệu điểm danh hợp lệ cho các điều kiện lọc được chọn.".

### 0.12. Field/entity xác nhận tồn tại thật (không suy đoán)

- `AttendanceRecordEntity`: `id, meetingId, userId, checkInTime, isPresent, isLate, leftEarly, lateMinutes, attendanceStatus`.
- `MeetingParticipantEntity`: dùng để xác định tập "được mời" (internal, `invitation_status <> 'declined'`).
- `MeetingEntity`: `id, startTime, status, deletedAt`.
- `UserEntity`: `id, email, fullName, departmentId`.
- `DepartmentEntity`: `id, departmentName, managerUserId`.
- **Không có bảng/cột nào cần thêm.**

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `analytics`, cung cấp thẻ KPI, biểu đồ xu hướng theo tuần, và 2 khu vực phân tích mô hình vi phạm (theo khung giờ, theo phòng ban) về tỷ lệ tham dự đúng giờ của nhân sự, kèm drill-down lịch sử cá nhân. Tính năng **read-only tuyệt đối**.

### 1.2 Mục tiêu

Cho phép Manager (giới hạn phạm vi phòng ban phụ trách, scope theo người tham dự), Business Admin, System Admin xem tỷ lệ đúng giờ trung bình, xu hướng theo tuần, phân bổ vi phạm theo khung giờ/phòng ban, và truy xuất lịch sử đi muộn của 1 cá nhân cụ thể.

### 1.3 Giá trị mang lại

- Cho Manager: xác định nhân sự/khung giờ trong phòng ban mình có xu hướng đi muộn để chấn chỉnh.
- Cho Business Admin/System Admin: giám sát văn hóa tuân thủ thời gian toàn công ty, phát hiện phòng ban/khung giờ cần chính sách điều chỉnh.

### 1.4 Giả định

- `onTimeRate = onTimeCount ÷ totalRequiredParticipants` (gồm cả absent) — §0.1.
- `graceMinutes` mặc định `0`, tùy chỉnh được ở tầng phân tích, không sửa dữ liệu gốc — §0.2.
- Scope Manager theo phòng ban người tham dự — §0.3.
- Chỉ tính trên `meetings.status='completed'` — §0.6.
- `departmentId`/`meetingId` là filter đơn, `search` là fuzzy text — §0.7.
- `trend` luôn theo tuần, không cần `granularity` — §0.8.

### 1.5 Clarifications Resolved

Toàn bộ điểm mơ hồ đã liệt kê và người dùng duyệt (4 quyết định chính: mẫu số onTimeRate, xử lý graceMinutes, cơ sở scope, bổ sung endpoint AF1), cùng các phương án khuyến nghị còn lại không bị phản đối — tổng hợp tại §0.1–§0.11.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền / Trách nhiệm chính |
|---|---|---|
| Manager / Approver | Quản lý cấp phòng ban | Xem KPI/trend/pattern giới hạn trong nhân sự thuộc phòng ban mình quản lý |
| Business Admin | Quản trị viên doanh nghiệp | Xem toàn công ty, lọc theo `departmentId` bất kỳ |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin (đúng `API_CONTRACT` UC-157) |

### 2.2 Role & Permission Rules

- `role_code` hợp lệ: `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Permission bắt buộc: `analytics.attendance.read` (permission mới — §0.10).
- `SYSTEM_ADMIN`/`BUSINESS_ADMIN`: không giới hạn scope; `departmentId` là filter thuần túy.
- `MANAGER`: scope = nhân sự thuộc phòng ban `departments.manager_user_id = currentUser.id`. Truyền `departmentId` ngoài scope → 403 `DEPARTMENT_OUT_OF_SCOPE`. Endpoint drill-down (`userId`) ngoài scope → 403 `USER_OUT_OF_SCOPE`.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `analytics.attendance.read`.
- Scope Manager không rollup phòng ban con, không dùng `direct_manager_id` (nhất quán các UC-AA khác).

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về toàn bộ dữ liệu dưới dạng read-only — không tạo/sửa/xóa bất kỳ bản ghi nào trong `attendance_records`, `meeting_participants`, `meetings`, `users`, `departments`.

FR-002: THE system SHALL tính toán lại toàn bộ chỉ số trực tiếp từ dữ liệu nguồn (on-demand aggregation) tại mỗi lần gọi API.

FR-003: THE system SHALL chỉ tính trên `meetings.status='completed'` (§0.6), loại `draft`/`pending_approval`/`scheduled`/`in_progress`/`cancelled`.

### 3.2 Event-driven Requirements — Endpoint tổng quan

FR-004: WHEN người dùng gửi yêu cầu GET /api/v1/analytics/attendance/on-time-rate, THE system SHALL kiểm tra authentication và permission `analytics.attendance.read` trước khi xử lý logic khác.

FR-005: WHEN người dùng không truyền `preset`/`from`/`to`, THE system SHALL áp dụng mặc định `preset='month'` (Tháng hiện tại, timezone `Asia/Ho_Chi_Minh`).

FR-006: WHEN người dùng truyền `preset IN ('day','week','month','quarter')`, THE system SHALL tự tính `from`/`to` tương ứng, bỏ qua `from`/`to` nếu có truyền kèm.

FR-007: WHEN người dùng truyền `preset='custom'` kèm `from`/`to` hợp lệ, THE system SHALL dùng đúng khoảng đó.

FR-008: WHEN currentUser có role MANAGER và không truyền `departmentId`, THE system SHALL tự động giới hạn dữ liệu trong nhân sự thuộc phòng ban mình quản lý.

FR-009: WHEN currentUser có role MANAGER và truyền `departmentId` thuộc phòng ban mình quản lý, THE system SHALL lọc đúng phòng ban đó.

FR-010: WHEN currentUser có role BUSINESS_ADMIN hoặc SYSTEM_ADMIN và truyền `departmentId`, THE system SHALL lọc theo đúng phòng ban đó trong toàn hệ thống.

FR-011: WHEN người dùng truyền `meetingId`, THE system SHALL lọc chỉ còn đúng 1 cuộc họp đó (vẫn áp scope nếu có).

FR-012: WHEN người dùng truyền `search`, THE system SHALL lọc participant theo fuzzy match không phân biệt hoa/thường trên `full_name`/`email`/`employee_code` (tái dùng pattern `feat-view-meeting-attendance-list`).

FR-013: WHEN người dùng không truyền `graceMinutes`, THE system SHALL mặc định `graceMinutes=0`.

FR-014: WHEN người dùng truyền `graceMinutes > 0`, THE system SHALL tính lại nhóm onTime/late dựa trên `late_minutes <= graceMinutes` thay vì cờ `is_late` gốc (§0.2), chỉ áp dụng cho record có `is_present=true`.

### 3.3 Event-driven Requirements — Endpoint drill-down (AF1)

FR-015: WHEN người dùng gửi yêu cầu GET /api/v1/analytics/attendance/on-time-rate/users/{userId}/late-history, THE system SHALL kiểm tra authentication và permission `analytics.attendance.read` trước khi xử lý logic khác.

FR-016: WHEN currentUser có role MANAGER và `userId` không thuộc phòng ban mình quản lý, THE system SHALL từ chối yêu cầu với error code `USER_OUT_OF_SCOPE`.

FR-017: WHEN yêu cầu hợp lệ, THE system SHALL trả về danh sách các `meetings` mà `userId` đã tham gia MUỘN (theo cùng định nghĩa late ở `graceMinutes` truyền vào, mặc định `0`) trong `[from,to]`, gồm `meetingId, meetingTitle, scheduledStartTime, checkInTime, lateMinutes`.

### 3.4 State-driven Requirements

FR-018: WHILE `totalRequiredParticipants = 0` trong toàn bộ scope + filter + `[from,to]`, THE system SHALL trả `onTimeCount=0, lateCount=0, absentCount=0, onTimeRate=0`, `trend`/`lateByHourOfDay`/`lateByDepartment` rỗng (mảng rỗng hoặc đủ bucket giá trị 0 tùy loại), kèm `message` đúng nguyên văn EX1: "Không tìm thấy dữ liệu điểm danh hợp lệ cho các điều kiện lọc được chọn." (§0.11).

FR-019: WHILE 1 participant nội bộ của meeting `completed` không có bất kỳ `attendance_records` nào, THE system SHALL mặc định phân loại participant đó vào nhóm `absent` (§0.5).

FR-020: WHILE 1 `attendance_records` có `attendance_status IN ('invalidated','pending_review')`, THE system SHALL loại bản ghi đó khỏi `totalRequiredParticipants` (§0.5).

### 3.5 Optional Feature Requirements

FR-021: WHERE `departmentId`/`meetingId`/`search` được cung cấp, THE system SHALL áp dụng như filter bổ sung sau khi đã áp scope theo role.

### 3.6 Unwanted Behavior Requirements

FR-022: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-023: IF người dùng không có permission `analytics.attendance.read`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-024: IF currentUser có role MANAGER và `departmentId` không thuộc phòng ban mình quản lý, THEN THE system SHALL trả về 403, error code `DEPARTMENT_OUT_OF_SCOPE`.

FR-025: IF currentUser có role MANAGER và `userId` (endpoint drill-down) không thuộc phòng ban mình quản lý, THEN THE system SHALL trả về 403, error code `USER_OUT_OF_SCOPE`.

FR-026: IF `preset` không thuộc {day, week, month, quarter, custom}, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-027: IF `preset='custom'` nhưng thiếu `from`/`to`, hoặc `from > to`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-028: IF `departmentId`/`meetingId`/`userId` không phải UUID hợp lệ, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-029: IF `graceMinutes` là số âm hoặc không phải số nguyên, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-030: IF khoảng `to - from` vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL trả về 400, error code `DATE_RANGE_TOO_LARGE`.

FR-031: IF `userId` (endpoint drill-down) không tồn tại, THEN THE system SHALL trả về 404, error code `USER_NOT_FOUND`.

### 3.7 Authorization Requirements

FR-032: WHEN the user performs a protected action (xem thống kê tỷ lệ đúng giờ), THE system SHALL verify authentication và authorization trước khi thực thi aggregation query.

FR-033: WHILE currentUser đang ở scope MANAGER, THE system SHALL áp scope phòng ban người tham dự cho MỌI truy vấn (`attendance_records`, `meeting_participants`).

### 3.8 Data & State Requirements

FR-034: WHEN tính `totalRequiredParticipants`, THE system SHALL đếm participant nội bộ (`meeting_participants.invitation_status <> 'declined'`) của các `meetings.status='completed'` trong scope + filter + `[from,to]` (theo `meetings.start_time`), loại `attendance_records.attendance_status IN ('invalidated','pending_review')` nếu có.

FR-035: WHEN tính `onTimeCount`, THE system SHALL đếm participant thỏa FR-034 được phân vào nhóm `onTime` theo quy tắc phân loại §0.5 (áp dụng `graceMinutes` nếu >0 theo FR-014).

FR-036: WHEN tính `lateCount`, THE system SHALL đếm participant thỏa FR-034 được phân vào nhóm `late`.

FR-037: WHEN tính `absentCount`, THE system SHALL đếm participant thỏa FR-034 được phân vào nhóm `absent`.

FR-038: WHEN tính `onTimeRate`, THE system SHALL tính `onTimeCount ÷ totalRequiredParticipants × 100` (§0.1), làm tròn 1 chữ số thập phân. Mẫu số 0 → trả `0`.

FR-039: WHEN tính `trend`, THE system SHALL nhóm participant thỏa FR-034 theo tuần ISO của `meetings.start_time`, trả đủ mọi bucket tuần trong `[from,to]` (kể cả `totalRequiredParticipants=0`), mỗi bucket gồm `{period, onTimeCount, lateCount, absentCount, totalRequiredParticipants, onTimeRate}`.

FR-040: WHEN tính `lateByHourOfDay`, THE system SHALL nhóm participant thỏa FR-034 theo giờ đồng hồ (0-23) của `meetings.start_time` (§0.9), trả đủ 24 bucket `{hourOfDay, lateCount, totalRequiredParticipants, lateRate}`.

FR-041: WHEN tính `lateByDepartment`, THE system SHALL nhóm participant thỏa FR-034 theo `users.department_id` (phòng ban người tham dự), trả `{departmentId, departmentName, lateCount, totalRequiredParticipants, lateRate}` cho mỗi phòng ban trong scope, sort giảm dần theo `lateRate`.

### 3.9 Notification / Audit Requirements

FR-042: WHERE `AUDIT_LOG_ENABLED` được bật, WHEN 1 trong 2 endpoint hoàn tất thành công, THE system SHALL ghi audit log non-blocking `action_type` tương ứng (`read_analytics_on_time_rate` hoặc `read_analytics_on_time_rate_late_history`), `entity_type='attendance_records'`, `metadata_json` chứa tối thiểu `{viewerUserId, viewerRole, from, to, departmentId, meetingId, search, graceMinutes, userId?, resolvedScopeDepartmentIds}`.

### 3.10 Complex / Combined Requirements

FR-043: WHILE currentUser có role MANAGER, WHEN currentUser không quản lý phòng ban nào, THE system SHALL trả về response rỗng như FR-018 thay vì lỗi.

FR-044: WHERE `to - from` vượt `analytics.dashboard_max_range_days`, IF request vẫn được gửi, THEN THE system SHALL từ chối tại tầng validate DTO trước khi chạm tới bất kỳ truy vấn tổng hợp nào.

### 3.11 Traceability

| Requirement ID | EARS Pattern | Nguồn |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-AA-10 POST-2, BR1, §0.6 |
| FR-004–FR-014 | Event-driven (tổng quan) | UC-AA-10 Normal Flow bước 1-6 |
| FR-015–FR-017 | Event-driven (drill-down) | UC-AA-10 AF1 |
| FR-018–FR-020 | State-driven | UC-AA-10 EX1, §0.5 |
| FR-021 | Optional Feature | UC-AA-10 Normal Flow bước 5 |
| FR-022–FR-031 | Unwanted Behavior | UC-AA-10 BR1, validation |
| FR-032, FR-033 | Authorization | UC-AA-10 BR1 |
| FR-034–FR-041 | Data & State | UC-AA-10 Normal Flow bước 3-4 |
| FR-042 | Notification/Audit | Pattern audit đã dùng ở UC-AA-01/02/07/08/09 |
| FR-043, FR-044 | Complex | BR1 + range guard |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về kết quả trong vòng dưới 2 giây cho khoảng thời gian mặc định (tháng hiện tại) trong điều kiện tải bình thường.

NFR-002: IF khoảng thời gian truy vấn vượt `analytics.dashboard_max_range_days`, THEN THE system SHALL từ chối tại tầng validate (FR-030) trước khi chạy aggregation.

### 4.2 Security

NFR-003: THE system SHALL yêu cầu authentication cho mọi request.

NFR-004: THE system SHALL enforce scope phòng ban Manager ở tầng service, không chỉ dựa vào FE.

### 4.3 Reliability & Consistency

NFR-005: THE system SHALL đảm bảo `totalRequiredParticipants = onTimeCount + lateCount + absentCount` luôn đúng trong mọi response (KPI tổng, mỗi bucket `trend`, mỗi bucket `lateByHourOfDay`, mỗi phần tử `lateByDepartment`).

NFR-006: THE system SHALL sử dụng index sẵn có trên `attendance_records(meeting_id)`, `attendance_records(user_id)`, `meetings(start_time, status)`.

### 4.4 Usability

NFR-007: THE system SHALL trả về clear error messages và field names dạng camelCase.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `attendance_records` | Nguồn chính phân loại onTime/late/absent | Loại `invalidated`/`pending_review` |
| `meeting_participants` | Xác định tập "được mời" (internal) | `invitation_status <> 'declined'` |
| `meetings` | Chỉ tính `status='completed'`, mốc thời gian `start_time` | |
| `users`, `departments` | Resolve scope Manager theo NGƯỜI THAM DỰ | Khác pattern organizer ở UC-AA khác |
| `system_configs` | Tái dùng `analytics.dashboard_max_range_days` | Không tạo key mới |

### 5.2 Dữ liệu đầu vào

**Endpoint tổng quan** (`GET /api/v1/analytics/attendance/on-time-rate`)

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| preset | string | Không | `day`/`week`/`month`/`quarter`/`custom`, mặc định `month` | Enum hợp lệ |
| from | date | Chỉ khi `preset=custom` | Bắt đầu khoảng | ISO date |
| to | date | Chỉ khi `preset=custom` | Kết thúc khoảng | ISO date, `to>=from`, range ≤ max |
| departmentId | UUID | Không | Lọc 1 phòng ban | MANAGER chỉ được truyền phòng ban mình quản lý |
| meetingId | UUID | Không | Lọc 1 cuộc họp cụ thể | UUID hợp lệ |
| search | string | Không | Fuzzy search tên/email/mã nhân viên | max 150 ký tự |
| graceMinutes | integer | Không | Ngưỡng phút châm chước, mặc định `0` | Số nguyên >= 0 |

**Endpoint drill-down** (`GET /api/v1/analytics/attendance/on-time-rate/users/{userId}/late-history`)

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| userId (path param) | UUID | Có | Nhân sự cần xem lịch sử | UUID hợp lệ, tồn tại |
| preset/from/to/graceMinutes | như trên | Không | Cùng logic khoảng thời gian + ngưỡng | Cùng validation |

### 5.3 Dữ liệu đầu ra

**Tổng quan:**

| Field | Type | Mô tả |
|---|---:|---|
| period.from/to | date | Khoảng thời gian áp dụng |
| graceMinutes | integer | Ngưỡng đã áp dụng |
| onTimeCount/lateCount/absentCount | integer | FR-035/036/037 |
| totalRequiredParticipants | integer | FR-034 |
| onTimeRate | number (%) | FR-038 |
| trend[].period | string | Nhãn tuần ISO (`"YYYY-'W'WW"`) |
| trend[].onTimeCount/lateCount/absentCount/totalRequiredParticipants/onTimeRate | | FR-039 |
| lateByHourOfDay[].hourOfDay | integer (0-23) | FR-040 |
| lateByHourOfDay[].lateCount/totalRequiredParticipants/lateRate | | FR-040 |
| lateByDepartment[].departmentId/departmentName | | FR-041 |
| lateByDepartment[].lateCount/totalRequiredParticipants/lateRate | | FR-041 |
| message | string (optional) | Khi `totalRequiredParticipants=0` — EX1 |

**Drill-down:**

| Field | Type | Mô tả |
|---|---:|---|
| user.userId/fullName/email | | Thông tin nhân sự |
| period.from/to | date | |
| lateMeetings[].meetingId/meetingTitle | | |
| lateMeetings[].scheduledStartTime | timestamptz | `meetings.start_time` |
| lateMeetings[].checkInTime | timestamptz | `attendance_records.check_in_time` |
| lateMeetings[].lateMinutes | integer | `attendance_records.late_minutes` |

### 5.4 Data Constraints

- Không ghi/sửa/xóa bảng nguồn.
- Không thêm bảng/cột — chỉ thêm 1 permission mới `analytics.attendance.read` (đã có trong `API_CONTRACT`, chỉ cần seed).
- Mẫu số = 0 → trả `0` cho mọi rate.
- `totalRequiredParticipants = onTimeCount + lateCount + absentCount` luôn đúng (NFR-005).

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN resolving scope cho MANAGER, THE system SHALL truy vấn `SELECT id FROM departments WHERE manager_user_id = currentUser.id`, sau đó lọc `attendance_records` qua `users.department_id IN (...)` (KHÔNG qua `meetings.organizer_id`).

FR-DATA-002: WHEN áp dụng `graceMinutes > 0`, THE system SHALL tính lại onTime/late bằng biểu thức `CASE WHEN is_present AND (late_minutes IS NULL OR late_minutes <= :graceMinutes) THEN 'on_time' WHEN is_present THEN 'late' ELSE 'absent' END`, không sửa cột gốc.

### 5.6 Cần làm rõ

- **CL-1**: `docs/API_CONTRACT_v1.0_with_system_roles.md` UC-157 hiện chưa có `lateByHourOfDay`/`lateByDepartment`/`meetingId`/`search`/endpoint drill-down — cần task đồng bộ tài liệu riêng.
- **CL-2**: Công thức `onTimeRate` của UC-AA-10 (gồm absent ở mẫu số) khác công thức `onTimeRate` đã dùng ở UC-AA-01 (loại absent) — chấp nhận tồn tại song song 2 định nghĩa cho 2 mục đích khác nhau, không hợp nhất trong phạm vi feature này.
- **CL-3**: Permission `analytics.attendance.read` cần seed mới — task seed nằm trong `tasks.md` của feature này (không nằm trong scope 1 UC-AA khác).

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `preset` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `preset=custom` thiếu `from`/`to` hoặc `from>to`, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `departmentId`/`meetingId`/`userId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF `graceMinutes` âm hoặc không phải số nguyên, THEN 400 `VALIDATION_ERROR`.
ERR-005: IF range vượt `analytics.dashboard_max_range_days`, THEN 400 `DATE_RANGE_TOO_LARGE`.

### 6.2 Authentication / Authorization Errors

ERR-006: IF chưa đăng nhập, THEN 401.
ERR-007: IF không có permission `analytics.attendance.read`, THEN 403 `PERMISSION_DENIED`.
ERR-008: IF MANAGER truyền `departmentId` ngoài scope, THEN 403 `DEPARTMENT_OUT_OF_SCOPE`.
ERR-009: IF MANAGER truy cập `userId` (drill-down) ngoài scope, THEN 403 `USER_OUT_OF_SCOPE`.

### 6.3 Business Rule Errors

ERR-010: IF `userId` (drill-down) không tồn tại, THEN 404 `USER_NOT_FOUND`.

### 6.4 System Errors

ERR-011: IF lỗi truy vấn hệ thống, THEN 500 `INTERNAL_ERROR`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập,
When gọi API tổng quan không tham số,
Then hệ thống trả về `onTimeRate` tính trên `onTimeCount ÷ totalRequiredParticipants` (gồm absent) của tháng hiện tại, toàn công ty, kèm `trend` theo tuần, `lateByHourOfDay` đủ 24 bucket, `lateByDepartment` sort theo `lateRate`.

AC-002:
Given Manager quản lý phòng ban "Kỹ thuật",
When Manager gọi API không truyền `departmentId`,
Then hệ thống chỉ tính trên nhân sự thuộc phòng ban "Kỹ thuật" (dựa vào `users.department_id` của người tham dự, không phải người tổ chức).

AC-003:
Given nhân viên A tham gia muộn 3 cuộc họp trong kỳ,
When gọi endpoint drill-down `userId=A`,
Then `lateMeetings` liệt kê đúng 3 cuộc họp kèm `scheduledStartTime`, `checkInTime`, `lateMinutes`.

### 7.2 Validation & Authorization Cases

AC-004:
Given Manager truyền `departmentId` không thuộc phòng ban mình quản lý,
When gọi API,
Then hệ thống reject 403 `DEPARTMENT_OUT_OF_SCOPE`.

AC-005:
Given Manager gọi drill-down cho `userId` thuộc phòng ban khác,
When gọi API,
Then hệ thống reject 403 `USER_OUT_OF_SCOPE`.

### 7.3 Business Rule Cases

AC-006:
Given 1 participant nội bộ của meeting `completed` không có `attendance_records` nào,
When gọi API,
Then participant đó được tính vào `absentCount` (không bị loại khỏi mẫu số).

AC-007:
Given `graceMinutes=5`, 1 record có `is_present=true, late_minutes=3`,
When gọi API,
Then record đó được tính vào `onTimeCount` (không phải `lateCount`, dù `is_late` gốc = `true`).

AC-008:
Given tổ hợp filter không có meeting `completed` nào trong `[from,to]`,
When gọi API,
Then `totalRequiredParticipants=0`, mọi rate = `0`, kèm `message` đúng nguyên văn EX1.

### 7.4 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-005, FR-034-FR-041 |
| AC-002 | FR-008, FR-DATA-001 |
| AC-003 | FR-017 |
| AC-004 | FR-024, ERR-008 |
| AC-005 | FR-016, ERR-009 |
| AC-006 | FR-019, FR-037 |
| AC-007 | FR-014, FR-DATA-002 |
| AC-008 | FR-018 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Tái sử dụng/hợp nhất công thức `onTimeRate` với UC-AA-01 — đã chọn giữ 2 định nghĩa riêng biệt (§0.1, CL-2).
- Sửa `attendance_records.is_late`/`late_minutes` gốc theo `graceMinutes` — chỉ tính lại tại tầng phân tích (§0.2).
- Scope theo người tổ chức cuộc họp — đã chọn scope theo người tham dự (§0.3).
- Bucket "khung giờ" theo slot họp thực tế lệch giờ (vd 13:30-14:30) — dùng bucket cố định theo giờ đồng hồ (§0.9).
- Tính trên `meetings.status` khác `completed` (scheduled/in_progress) — dữ liệu chưa ổn định (§0.6).
- WebSocket push/invalidate.
- Rollup phòng ban con cho scope Manager.

### 8.2 Có thể xem xét ở feature khác

- Đồng bộ `API_CONTRACT_v1.0_with_system_roles.md` với `lateByHourOfDay`/`lateByDepartment`/`meetingId`/`search`/endpoint drill-down (CL-1).
- Hợp nhất 2 định nghĩa `onTimeRate` (UC-AA-01 vs UC-AA-10) nếu phát sinh yêu cầu nhất quán toàn hệ thống (CL-2).

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT reuse UC-AA-01's onTimeRate denominator (present+late only) for this feature.
OOS-002: THE system SHALL NOT mutate attendance_records.is_late/late_minutes based on the graceMinutes query parameter.
OOS-003: THE system SHALL NOT resolve Manager scope via meetings.organizer_id for this feature — attendee's own department only.
OOS-004: THE system SHALL NOT include meetings with status other than 'completed' in any aggregate of this feature.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS, đủ 5 pattern cơ bản + Complex.
- [x] Mỗi requirement có mã ID rõ ràng, có traceability.
- [x] Error handling bao gồm validation, authentication, authorization, business rule, system error.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Out of Scope có EARS guardrails.
- [x] Không tự ý thêm bảng/cột database mới (chỉ 1 permission mới, đã có sẵn trong API_CONTRACT).
- [x] Các điểm thiếu thông tin đưa vào mục 5.6 "Cần làm rõ".
