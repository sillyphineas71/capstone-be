# Feature Specification: Xem trạng thái điểm danh của người tham dự (View Participant Attendance Status)

- **Feature ID**: UC-IMM-08
- **Feature Name**: Xem trạng thái điểm danh của người tham dự
- **Module / Domain**: live-meeting
- **Use Case**: UC-101 (API Contract), UC-IMM-08
- **Created Date**: 2026-06-17
- **Status**: Draft
- **Source Documents**:
  - Database v3.2 Compact (39 tables)
  - AGENTS.md - Backend Agent Guide v1.1
  - API_CONTRACT_v1.0_with_system_roles.md (UC-81, UC-101)
  - SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md
  - spec/features/live-meeting/feat-view-live-meeting-participants/spec.md (UC-IMM-07)
  - spec/features/live-meeting/feat-request-meeting-extension/spec.md (UC-IMM-02)
  - spec/features/live-meeting/feat-end-meeting-session/spec.md (UC-IMM-05)

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-17 | Tạo spec lần đầu cho UC-IMM-08 Xem trạng thái điểm danh của người tham dự | Toàn bộ file |
| 2026-06-17 | Cập nhật theo kết quả clarify (logic late, Permission, Pagination pageSize, Edge case Removed Invite, loại bỏ presence_snapshots) | Các mục 1.5, 2.2, 3, 5, 8, 9 |

---

## Hướng dẫn viết EARS Requirements

Functional Requirements trong spec này viết theo EARS.
Keyword EARS giữ nguyên bằng tiếng Anh. Nội dung nghiệp vụ viết bằng tiếng Việt.

| Keyword | Vai trò |
|---|---|
| THE system SHALL | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error |
| WHEN | Trigger/event xảy ra tại một thời điểm |
| WHILE | Hành vi đúng trong suốt một trạng thái |
| WHERE | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại |
| IF ... THEN | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn |

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng UC-IMM-08 thuộc nhóm In-Meeting Management, module live-meeting.

Trong quy trình meeting lifecycle, Host và Business Admin cần khả năng xem báo cáo trạng thái điểm danh tổng hợp của tất cả người tham dự được mời vào cuộc họp, đặc biệt sau khi cuộc họp đã diễn ra (completed) hoặc đang diễn ra (in_progress). Việc này phục vụ:

- Xác nhận ai đã check-in, ai đến muộn, ai vắng mặt sau khi cuộc họp kết thúc.
- Theo dõi tiến độ điểm danh realtime trong khi cuộc họp đang diễn ra.
- Hỗ trợ quyết định chấm công, báo cáo attendance, đánh giá tuân thủ.

Hiện tại hệ thống đã có cơ chế ghi nhận điểm danh qua ttendance_records (từ camera, face server, check-in thủ công) và cơ chế hiển thị danh sách người đang có mặt realtime (UC-IMM-07). Tuy nhiên chưa có giao diện tổng hợp trạng thái điểm danh cho toàn bộ danh sách khách mời, bao gồm cả người chưa điểm danh và người được xác nhận đến muộn.

Tính năng này là read-only. Trạng thái hệ thống không thay đổi khi sử dụng. Dữ liệu được tổng hợp từ meetings, meeting_participants, users, ttendance_records, và fallback từ presence_snapshots / ttendance_events nếu cần.

Tính năng này liên quan tới: actor (Host, Business Admin), meeting entity, meeting participants, attendance records, system_configs (late threshold), và audit logs.


### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép **Host** của meeting hoặc **Business Admin** xem trạng thái điểm danh chi tiết của toàn bộ người tham dự nội bộ trong cuộc họp, bao gồm:

- Trang thai diem danh cua tung participant: checked_in / present, late, absent.
- Thoi gian check-in thuc te (check_in_time) cho nguoi da diem danh (checked_in/late).
- Thoi gian bat dau cuoc hop thuc te (actual_start_time) dung lam moc so sanh phat hien di muon.
- Late rule dua tren late_threshold_minutes tu system_configs (mac dinh 10 phut), so sanh check_in_time voi actual_start_time (fallback start_time).
- Voi meeting in_progress, trang thai absent la tam thoi (provisional), can co ghi chu ro rang.
- Filter theo trang thai diem danh, search theo ten/email.
- Ho tro phan trang va sap xep.

### 1.3 Gia tri mang lai

- Host: Biet chinh xac ai da diem danh, ai den muon, ai vang mat trong cuoc hop cua minh de co hanh dong phu hop (vd: nhac nho, dieu chinh lich).
- Business Admin: Co bao cao attendance tap trung xuyen suot cac cuoc hop trong to chuc, phuc vu danh gia tuan thu va hieu suat.
- Du lieu va bao cao: Attendance status la du lieu quan trong cho analytics dashboard (UC-150, UC-157) va bao cao tong hop.

### 1.4 Gia dinh

- Meeting phai o trang thai in_progress hoac completed de duoc xem attendance status.
- Danh sach bao gom internal participants tu meeting_participants (co user_id), khong bao gom external participants (khong co user_id).
- Host duoc xac dinh qua meetings.host_id hoac meeting_participants.participant_role = host.
- Server time la nguon thoi gian chinh thong cho moi so sanh.
- late_threshold_minutes duoc lay tu system_configs.config_key = attendance.late_threshold neu co, mac dinh 10 phut.
- actual_start_time la bat bien sau khi da ghi nhan.
- Viec gia han cuoc hop (UC-IMM-02, UC-IMM-03) khong anh huong den moc tinh late (van dung actual_start_time ban dau).
- Audit log duoc ghi non-blocking, khong anh huong den response.

### 1.5 Can lam ro

- Đã giải quyết các điểm clarify (2026-06-17):
  - Tính late dùng earliest valid check-in time thay vì latest.
  - Loại Department Admin khỏi scope hiện tại.
  - Chuẩn hóa phân trang dùng `pageSize`, default 20.
  - Không query `presence_snapshots` trong core API.
  - Hiển thị participant bị remove khỏi danh sách mời (nếu đã điểm danh) với trạng thái `removed`.

---

## 2. Actor & Roles

### 2.1 Danh sach actor

| Actor | Vai tro trong tinh nang | Quyen / Trach nhiem chinh |
|---|---|---|
| Internal Employee (Host) | Nguoi chu tri cuoc hop, co quyen xem attendance status cua meeting minh la host | Xem danh sach diem danh, filter/search, xem chi tiet check-in time |
| Business Admin | Nguoi quan tri co quyen xem attendance status cua moi meeting trong he thong | Xem danh sach diem danh bat ky meeting nao |
| Participants | Nguoi tham gia cuoc hop, du lieu cua ho xuat hien trong danh sach | Du lieu attendance duoc hien thi, khong tu xem duoc neu khong phai Host/Admin |

### 2.2 Role & Permission Rules

- Quyen xem attendance: attendance.read (theo API Contract UC-81).
- Host duoc phep xem attendance status neu ho la host_id cua meeting do hoac participant_role = host trong meeting_participants.
- Business Admin (co permission attendance.read o cap he thong) duoc xem bat ky meeting nao.
- Backend kiem tra ca permission lan ownership (Host) truoc khi cho phep.
- Participant thong thuong khong duoc phep xem attendance status cua meeting (tru khi ho la Host).
- Role Department Admin la Out-of-Scope trong use case nay (viec xem bao cao theo phong ban se thuoc nhom tinh nang Analytics/Admin rieng).

### 2.3 Actor Constraints

- Host hoac Business Admin phai duoc xac thuc (JWT hop le).
- Meeting phai dang o trang thai in_progress hoac completed.

---

## 3. Functional Requirements

### 3.1 Core Requirements

FR-001: THE system SHALL cho phep Host (co permission attendance.read) xem trang thai diem danh cua tat ca internal participants trong meeting ma ho la host.
FR-002: THE system SHALL chi cho phep xem trang thai diem danh khi meeting dang o trang thai in_progress hoac completed.
FR-003: THE system SHALL tong hop trang thai diem danh tu attendance_records cho moi participant, ket hop voi danh sach moi tu meeting_participants.
FR-004: THE system SHALL tra ve ba trang thai diem danh chinh: checked_in, late, absent.
FR-005: THE system SHALL tra ve check_in_time cho cac participant co attendance_status la checked_in hoac late.

### 3.2 Event-driven Requirements

FR-006: WHEN Host hoac Business Admin gui yeu cau xem danh sach diem danh, THE system SHALL kiem tra quyen va trang thai meeting truoc khi truy van du lieu.
FR-007: WHEN yeu cau xem danh sach diem danh duoc chap nhan, THE system SHALL truy van tat ca internal participants cua meeting co invitation_status != declined, ket hop voi attendance_records de xac dinh trang thai.
FR-008: WHEN nguoi dung gui filter status, THE system SHALL loc danh sach chi bao gom participant co trang thai diem danh tuong ung.
FR-009: WHEN nguoi dung gui search query q, THE system SHALL loc danh sach theo full_name hoac email (case-insensitive, partial match).
FR-010: WHEN meeting dang in_progress va participant chua co check-in record, THE system SHALL hien thi trang thai absent nhung kem ghi chu ro rang rang day la trang thai tam thoi (provisional) va co the thay doi khi participant check-in.

### 3.3 State-driven Requirements

FR-011: WHILE meeting dang o trang thai in_progress, THE system SHALL cho phep Host va Business Admin xem danh sach diem danh voi trang thai absent la provisional.
FR-012: WHILE meeting dang o trang thai completed, THE system SHALL cho phep Host va Business Admin xem danh sach diem danh cuoi cung, absent la trang thai ket luan cuoi cung.
FR-013: WHILE meeting o trang thai scheduled hoac cancelled, THE system SHALL khong cho phep xem danh sach diem danh.

### 3.4 Late Detection Rules

FR-014: THE system SHALL determine participant is late when attendance_records.check_in_time > late_threshold_time.
FR-015: THE system SHALL calculate late_threshold_time = actual_start_time + late_threshold_minutes.
FR-016: IF meetings.actual_start_time is null, THEN THE system SHALL fallback use meetings.start_time.
FR-017: THE system SHALL read late_threshold_minutes from system_configs key 'attendance.late_threshold' (default 10 minutes).
FR-018: WHERE config value exists but cannot be parsed as positive integer, THE system SHALL fallback to 10 and log warning.
FR-019: THE system SHALL ensure meeting extension does NOT change actual_start_time and does NOT affect late detection.

### 3.5 State Mapping Rules

FR-020: THE system SHALL map attendance_status = 'present' to display status 'checked_in'.
FR-021: THE system SHALL map attendance_status = 'late' to display status 'late'.
FR-022: THE system SHALL mark participant as 'absent' when no attendance_record exists for that meeting+user, or status is 'absent'.
FR-023: IF participant has attendance_status = 'present' but check_in_time > late_threshold_time, THEN THE system SHALL override to 'late'.
FR-024: THE system SHALL NOT query presence_snapshots for this core report (moved to Future Enhancements / Realtime dashboard).

### 3.6 Unwanted Behavior Requirements

FR-025: IF meeting not found (including soft-deleted), THEN THE system SHALL reject with MEETING_NOT_FOUND.
FR-026: IF user lacks attendance.read permission, THEN THE system SHALL reject with PERMISSION_DENIED.
FR-027: IF user is not Host or Business Admin, THEN THE system SHALL reject with FORBIDDEN_ATTENDANCE_ACCESS.
FR-028: IF meeting not in_progress or completed, THEN THE system SHALL reject with MEETING_NOT_ACTIVE_OR_COMPLETED.
FR-029: IF page < 1 or pageSize < 1 or pageSize > 100, THEN THE system SHALL reject with VALIDATION_ERROR.
FR-029b: IF pagination params are missing, THE system SHALL default to page = 1 and pageSize = 20.
FR-030: IF status filter value not in [checked_in, late, absent], THEN THE system SHALL ignore filter.

### 3.7 Authorization Requirements

FR-031: IF the user is not authenticated, THEN THE system SHALL reject access.
FR-032: IF the user lacks attendance.read, THEN THE system SHALL reject without returning data.
FR-033: WHEN user requests attendance, THE system SHALL verify Host ownership or Business Admin scope.
FR-034: WHILE user acts within Host scope, THE system SHALL restrict to meetings where user is host_id.

### 3.8 Data & State Requirements

FR-035: THE system SHALL return: userId, fullName, email, avatarUrl, departmentId, departmentName, participantRole, attendanceStatus, checkInTime (if any), isProvisional, participantState ("active" | "removed").
FR-036: WHEN calculating attendance, THE system SHALL prioritize attendance_records as authoritative source.
FR-037: IF multiple records exist for same meeting+user, THE system SHALL use the earliest valid check-in time to determine late status. IF attendance_records is missing, THE system SHALL fallback to MIN(event_time) from attendance_events for valid enter-room/check-in events.
FR-038: THE system SHALL return meta: currentInvitedCount, checkedInCount, lateCount, absentCount, removedCount, meetingStatus, actualStartTime, lateThresholdMinutes.
FR-038b: IF a user has valid attendance_records but was later removed from meeting_participants, THE system SHALL still include them in the detailed response with participantState = 'removed', to preserve attendance history. Users removed without any attendance records SHALL NOT be returned.

### 3.9 Audit Requirements

FR-039: WHEN Host/Admin views attendance successfully, THE system SHALL record audit log (non-blocking) with action_type = read_meeting_attendance.
FR-040: IF audit log write fails, THE system SHALL only log internally, not affecting the response.

### 3.10 Complex / Combined Requirements

FR-041: WHILE meeting is in_progress, WHEN Host views attendance, THE system SHALL show all participants with isProvisional = true for those without attendance_record.
FR-042: WHILE meeting is completed, WHEN Business Admin views attendance, THE system SHALL show final status with isProvisional = false for all.

### 3.11 Requirement Notes

- Reuses UC-81 endpoint GET /api/v1/meetings/{meetingId}/attendance per UC-101.
- attendanceStatus uses display values: checked_in, late, absent.
- isProvisional helps UI render provisional absent status for in-progress meetings.
- Extension does not change actual_start_time, so late detection is unaffected.
- late_threshold_minutes stored in system_configs (config_group = attendance, config_key = late_threshold).

### 3.12 Traceability

| Requirement ID | EARS Pattern | Source / Use Case | Note |
|---|---|---|---|
| FR-001 | Ubiquitous | UC-81, UC-101 | Core: Host view attendance |
| FR-002 | Ubiquitous | UC-IMM-08 | Only in_progress / completed |
| FR-003 | Ubiquitous | UC-81 | Aggregate attendance_records |
| FR-004 | Ubiquitous | UC-IMM-08 | Three main statuses |
| FR-005 | Ubiquitous | UC-81 | Check-in time display |
| FR-006-FR-010 | Event-driven | UC-81, UC-IMM-08 | Trigger-based rules |
| FR-011-FR-013 | State-driven | UC-IMM-08 | Status-based access |
| FR-014-FR-019 | Ubiquitous/IF | UC-IMM-08 | Late detection rules |
| FR-020-FR-024 | Ubiquitous/IF | UC-IMM-08 | Status mapping |
| FR-025-FR-030 | Unwanted Behavior | UC-81 | Error handling |
| FR-031-FR-034 | Authorization | UC-81 | Auth/permission |
| FR-035-FR-038 | Data & State | UC-81 | Response structure |
| FR-039-FR-040 | Audit | UC-IMM-08 | Audit logging |
| FR-041-FR-042 | Complex | UC-IMM-08 | State+event combined |


---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL respond within 3 seconds for up to 100 participants.
NFR-002: THE system SHALL support at least 50 concurrent requests.

### 4.2 Security

NFR-003: THE system SHALL require authentication.
NFR-004: THE system SHALL enforce authorization.

### 4.3 Reliability

NFR-006: THE system SHALL use proper indexes.
NFR-007: THE system SHALL ensure consistency within one request.

### 4.4 Usability

NFR-008: THE system SHALL return clear error messages.
NFR-009: THE system SHALL use consistent naming.
NFR-010: THE system SHALL support pagination and sorting.

### 4.5 Observability

NFR-011: THE system SHALL log important events.
NFR-012: WHEN data inconsistency occurs, THE system SHALL log without failing.

---

## 5. Data Model

> No new tables. Uses DB v3.2 Compact baseline.

### 5.1 Related Entities

| Entity | Role |
|---|---|
| meetings | Core table |
| meeting_participants | Participant list |
| users | User info |
| departments | Dept info |
| attendance_records | Primary attendance |
| presence_snapshots | Supplementary hints |
| attendance_events | Supplementary |
| system_configs | Late threshold config |
| audit_logs | Audit trail |

### 5.2 Input

| Field | Type | Required |
|---|---|---|
| meetingId | UUID(path) | Yes |
| status | string | No |
| q | string | No |
| page | int | No (default 1) |
| pageSize | int | No (default 20, max 100) |
| sortBy | string | No |

### 5.3 Output Fields

userId, fullName, email, avatarUrl, departmentId, departmentName,
participantRole, attendanceStatus, checkInTime, isProvisional,
participantState, meetingStatus, actualStartTime, lateThresholdMinutes

Meta: currentInvitedCount, checkedInCount, lateCount, absentCount, removedCount

### 5.4 Status Model

| Status | Meaning |
|---|---|
| checked_in | present AND check-in <= threshold |
| late | late OR (present AND check-in > threshold) |
| absent | No record OR status=absent |

### 5.5 Constraints

- meetings.status in (in_progress, completed).
- Only internal participants with invitation_status != declined.
- late_threshold = COALESCE(actual_start_time, start_time) + threshold.
- No record -> absent. isProvisional=true when in_progress+no record.

### 5.6 Data Lifecycle

- attendance_records created by attendance module.
- May be invalidated/manually edited by attendance module.
- Used for reporting, analytics, audit.
- system_configs updated by Business/System Admin.

### 5.7 Data EARS

FR-DATA-001: WHEN queried, left join attendance_records.
FR-DATA-002: WHEN multiple records, take earliest valid check-in time.
FR-DATA-003: IF no record, return absent.
FR-DATA-004: Prefer actual_start_time for late calc.
FR-DATA-005: Read late_threshold from system_configs; default 10.

---

## 6. Error Handling

ERR-001: IF meetingId invalid THEN VALIDATION_ERROR (422).
ERR-002: IF q > 100 chars THEN VALIDATION_ERROR (422).
ERR-003: IF page/pageSize invalid THEN VALIDATION_ERROR (422).
ERR-004: IF not authenticated THEN UNAUTHORIZED (401).
ERR-005: IF lacks attendance.read THEN PERMISSION_DENIED (403).
ERR-006: IF not Host nor Admin THEN FORBIDDEN_ATTENDANCE_ACCESS (403).
ERR-007: IF meeting not found THEN MEETING_NOT_FOUND (404).
ERR-008: IF wrong status THEN MEETING_NOT_ACTIVE_OR_COMPLETED (409).
ERR-009: IF DB fails THEN INTERNAL_ERROR (500).

| Code | HTTP | Desc |
|---|---|---|
| VALIDATION_ERROR | 422 | Invalid input |
| UNAUTHORIZED | 401 | Not authenticated |
| PERMISSION_DENIED | 403 | Lacks attendance.read |
| FORBIDDEN_ATTENDANCE_ACCESS | 403 | Not Host nor Admin |
| MEETING_NOT_FOUND | 404 | Not found/deleted |
| MEETING_NOT_ACTIVE_OR_COMPLETED | 409 | Wrong status |
| INTERNAL_ERROR | 500 | Server error |

---

## 7. Acceptance Criteria

AC-001: Completed meeting, Host views -> success, isProvisional=false.

AC-002: In_progress meeting, Host views -> unchecked-in have isProvisional=true.

AC-003: Check-in 09:12, threshold 09:10 -> late.

AC-004: Check-in 09:08, threshold 09:10 -> checked_in.

AC-005: No actual_start_time, falls back to start_time=09:00 -> threshold=09:10.

AC-006: Filter ?status=late returns only late.

AC-007: Search ?q=Nguyen returns matching participants.

AC-008: No auth -> 401.

AC-009: Regular participant -> 403.

AC-010: Business Admin -> success.

AC-011: Scheduled -> 409.

AC-012: Cancelled -> 409.

AC-013: Extension does not affect late threshold.

AC-014: Attendance data independent of extension.

AC-015: Successful view -> audit logged.


---

## 8. Out of Scope

- Create/update/delete attendance_records.
- Check-in/check-out.
- Start/end/extend meeting.
- No-show detection.
- Recording/transcription.
- Notifications/emails.
- Presence duration (UC-89).
- Export .xlsx (giữ ở Future Enhancement thông qua background_jobs / media_files).
- WebSocket push / Realtime update từ presence_snapshots.
- External participants.
- Phân quyền cho Department Admin.

OOS-001: THE system SHALL NOT mutate attendance records.
OOS-002: THE system SHALL NOT implement Excel export.
OOS-003: THE system SHALL NOT add new DB tables.
OOS-004: THE system SHALL NOT implement WebSocket push.

Future: .xlsx export via background_jobs, WebSocket push.

---

## 9. API Contract

Uses existing endpoint UC-81/UC-101.

GET /api/v1/meetings/{meetingId}/attendance

Permission: attendance.read

Query: ?status=late&q=Nguyen&page=1&pageSize=20

Response 200 (completed):

JSON with meetingId, meetingStatus=completed, participants array
with userId, fullName, attendanceStatus, checkInTime, isProvisional=false

Response 200 (in_progress):

JSON with meetingId, meetingStatus=in_progress, participants array
with isProvisional=true for unchecked-in participants

Error Codes: 422, 401, 403, 404, 409, 500
