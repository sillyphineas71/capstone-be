# Feature Specification: Xem danh sách điểm danh của cuộc họp

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Tạo spec lần đầu cho UC-APM-02 Xem danh sách điểm danh của cuộc họp | Toàn bộ file |
| 2026-06-16 | Cập nhật spec xử lý các vấn đề clarify: không dùng grace period, chốt giá trị not_checked_in/absent, quyền truy cập scheduled meeting, manager 1 cấp, mapping attendance_records trực tiếp, xử lý left_early, loại bỏ external participants. | Toàn bộ file |
| 2026-06-16 | Xử lý H1, H2, M1: Chi tiết hóa FR-030 (Audit Log), gỡ bỏ FR-010/014/031 (WebSocket out-of-scope), bổ sung defensive fallback rule. | Mục 3.2, 3.4, 3.8, 5.5, 8.1 |

---

- **Feature ID**: APM-ATTENDANCE-LIST-001
- **Feature Name**: Xem danh sách điểm danh của cuộc họp (View Meeting Attendance List)
- **Use Case**: UC-APM-02 Xem danh sách điểm danh của cuộc họp
- **Module / Domain**: attendance / attendance-management
- **Created Date**: 2026-06-16
- **Status**: Draft
- **Source Documents**:
  - AGENTS.md - Backend Agent Guide v1.1
  - Database v3.2 Compact (39 tables)
  - docs/API_CONTRACT_v1.0_with_system_roles.md
  - spec/global/constitution.md
  - .specify/templates/spec-template.md

---

## 1. Context & Goal

### 1.1 Bối cảnh

Trong quy trình meeting lifecycle, việc theo dõi sự hiện diện thực tế của người tham dự là một nhu cầu quan trọng trong và sau cuộc họp. Chủ trì (Host) cần biết ai đã có mặt, ai đến muộn, ai vắng mặt để quyết định bắt đầu cuộc họp đúng thời điểm. Người tổ chức (Organizer) và quản lý cần dữ liệu minh bạch để đối soát nhân sự và đánh giá mức độ tham gia.

Tính năng này thuộc module attendance, nằm trong giai đoạn trong cuộc họp (in-meeting) và sau cuộc họp (post-meeting) của meeting lifecycle. Đây là tính năng read-only, hiển thị dữ liệu điểm danh đã được hệ thống ghi nhận qua camera AI, cảm biến cửa (Door Face Attendance Terminal), host xác nhận thủ công, hoặc các nguồn điểm danh khác.

Tính năng này liên quan đến use case điểm danh hiện tại trong API contract, sử dụng dữ liệu từ các bảng attendance_records, attendance_events, meeting_participants, users, departments và meetings.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Host, Organizer, Participant nội bộ, Business Admin, Manager và các actor có quyền phù hợp xem danh sách điểm danh của một cuộc họp cụ thể nhằm theo dõi tình hình hiện diện thực tế, phục vụ quyết định vận hành cuộc họp và đối soát nhân sự.

### 1.3 Giá trị mang lại

- Cho Host/Organizer: kiểm soát số lượng người tham gia thực tế, quyết định bắt đầu cuộc họp dựa trên dữ liệu điểm danh.
- Cho Participant: xem trạng thái điểm danh của bản thân và danh sách chung (tôn trọng quyền riêng tư về nguồn điểm danh).
- Cho Business Admin/Manager: đối soát nhân sự tham gia, phát hiện bất thường về attendance, hỗ trợ đánh giá tuân thủ.
- Cho dữ liệu và báo cáo: cung cấp nguồn dữ liệu sạch cho dashboard attendance analytics.

### 1.4 Giả định

- Attendance list chỉ áp dụng cho internal participants (có user_id trong attendance_records). External participants bị loại trừ hoàn toàn khỏi danh sách và summary.
- Meeting có thể xem attendance list nếu status là `in_progress`, `completed`, hoặc `scheduled` nhưng `now >= start_time`.
- Dữ liệu `attendance_records` là nguồn chính cho trạng thái điểm danh tổng hợp (join trực tiếp `meeting_id` và `user_id`); `attendance_events` và `presence_snapshots` không dùng cho API list này.
- Manager scope chỉ tính 1 cấp trực tiếp (`users.direct_manager_id = currentUser.id`), không dùng recursive tree.
- Quyền `attendance.read` là quyền tối thiểu để truy cập tính năng này theo API contract.
- Không áp dụng "grace period" (thời gian châm chước) cho việc tính trạng thái `late`. Tính `late` ngay từ phút đầu tiên sau `start_time`.

### 1.5 Clarifications Resolved

1. **Grace period**: Không áp dụng. Tính `isLate = true` nếu `check_in_time > start_time` (so sánh đến giây). `lateMinutes = CEIL((check_in_time - start_time) / 60)`, tối thiểu là 1.
2. **Giá trị cho người chưa check-in**: Dùng `not_checked_in` nếu meeting đang diễn ra (`in_progress` hoặc `scheduled` && `now >= start_time`). Dùng `absent` nếu meeting đã kết thúc (`completed`).
3. **Mở attendance cho meeting scheduled**: Cho phép nếu `now >= start_time`, tránh chặn Host vì quên bấm Start.
4. **Manager Scope**: Chỉ hỗ trợ 1 cấp quản lý trực tiếp.
5. **Co-host**: Không thêm role mới `co-host`. Co-host được xác định nếu `meeting_participants.participant_role = 'host'`.
6. **Data Source**: Join trực tiếp vào `attendance_records`. Fallback lấy record mới nhất (`updated_at DESC`, `created_at DESC`) nếu có duplicate do legacy data. Xử lý `left_early` là đã check-in nhưng trạng thái `left_early`.
7. **External Participants**: Loại hoàn toàn khỏi list và summary. Có thể thêm `summary.scope = "internal_participants_only"` để FE nắm.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Organizer | Người tạo cuộc họp | Xem toàn bộ danh sách điểm danh, bao gồm nguồn điểm danh chi tiết |
| Host | Người chủ trì thực tế | Xem toàn bộ danh sách điểm danh, bao gồm nguồn điểm danh chi tiết (kể cả những participant có `participant_role = 'host'`) |
| Internal Participant | Người tham dự nội bộ | Xem danh sách điểm danh và trạng thái cơ bản, không xem nguồn điểm danh của người khác |
| Business Admin | Quản trị viên doanh nghiệp | Xem toàn bộ danh sách điểm danh trong phạm vi được cấp quyền, bao gồm nguồn điểm danh chi tiết |
| Manager (direct) | Quản lý trực tiếp 1 cấp | Xem danh sách điểm danh của cấp dưới trực tiếp, bao gồm nguồn điểm danh chi tiết |
| System Admin | Quản trị viên hệ thống | Xem toàn bộ danh sách điểm danh, bao gồm nguồn điểm danh chi tiết |

### 2.2 Role & Permission Rules

- Organizer, Host (`meetings.host_id` hoặc `meeting_participants.participant_role = 'host'`) luôn có quyền xem đầy đủ attendance list bao gồm cả attendanceSource và checkInMethod.
- Internal Participant chỉ xem được trạng thái cơ bản (`present`/`late`/`absent`/`not_checked_in`/`left_early`/`pending_review`) và check-in time của tất cả participants, nhưng không xem được attendanceSource, checkInMethod, confidenceScore của người khác.
- Internal Participant có thể xem attendanceSource và checkInMethod của chính mình.
- Business Admin và System Admin có quyền xem đầy đủ trong toàn bộ phạm vi hệ thống.
- Manager (direct manager của participant, 1 cấp) có quyền xem đầy đủ attendance list cho các cuộc họp có cấp dưới trực tiếp tham gia.
- Backend enforce field-level authorization -- không chỉ dựa vào frontend để ẩn field nhạy cảm.
- Nếu user không có bất kỳ quyền nào trong các quyền trên, hệ thống từ chối truy cập với mã lỗi `PERMISSION_DENIED`.

### 2.3 Actor Constraints

- Người dùng phải đăng nhập (authenticated) trước khi truy cập attendance list.
- Người dùng phải có ít nhất một trong các quyền: `attendance.read`, `meeting.presence.read`, hoặc `meeting.read` kèm quyền truy cập meeting cụ thể.
- Participant được xác định qua `meeting_participants.user_id` với `meeting_participants.invitation_status` không phải `declined`.
- Manager scope dựa trên `users.direct_manager_id = currentUser.id`.

---

## 3. Functional Requirements

Tất cả Functional Requirements được viết theo EARS. Keyword EARS giữ bằng tiếng Anh, nội dung nghiệp vụ viết bằng tiếng Việt.

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về danh sách điểm danh dưới dạng read-only — không tạo, sửa, xóa bất kỳ bản ghi nào trong attendance_records, attendance_events, presence_snapshots, meeting_participants hay meetings khi phục vụ yêu cầu này.

FR-002: THE system SHALL sử dụng attendance_records làm nguồn dữ liệu tổng hợp chính cho trạng thái điểm danh của từng participant, kết hợp với meeting_participants để xác định danh sách người tham gia đầy đủ (chỉ xét internal participants).

FR-003: THE system SHALL NOT tính External Participants vào danh sách điểm danh cũng như vào các thông số summary tổng hợp (checkedInCount, presentCount, lateCount, v.v.).

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi yêu cầu GET /api/v1/meetings/{meetingId}/attendance, THE system SHALL kiểm tra authentication token hợp lệ trước khi xử lý bất kỳ logic nào khác.

FR-005: WHEN authentication thành công, THE system SHALL kiểm tra quyền truy cập meeting của người dùng: người dùng phải là organizer, host, participant, business admin hoặc manager (direct manager 1 cấp) có scope phù hợp.

FR-006: WHEN người dùng có quyền truy cập meeting nhưng meeting ở trạng thái tương lai (now < start_time), THE system SHALL từ chối yêu cầu với mã lỗi ATTENDANCE_NOT_OPEN_YET. (Cho phép truy cập nếu meeting có status `scheduled` nhưng `now >= start_time`).

FR-007: WHEN người dùng có quyền truy cập và meeting ở trạng thái phù hợp, THE system SHALL truy xuất danh sách participant nội bộ từ meeting_participants kết hợp users và departments, đồng thời truy xuất dữ liệu attendance_records cho từng participant.

FR-008: WHEN người dùng gửi query param status=present|late|absent|not_checked_in|left_early, THE system SHALL lọc danh sách trả về theo trạng thái điểm danh tương ứng.

FR-009: WHEN người dùng gửi query param search, THE system SHALL tìm kiếm không phân biệt hoa thường trên full_name, email hoặc employee_code của participant.

### 3.3 State-driven Requirements

FR-011: WHILE meeting đang ở trạng thái in_progress (hoặc scheduled mà now >= start_time), THE system SHALL cho phép truy cập attendance list và hiển thị dữ liệu điểm danh hiện tại. Nguời chưa có check-in time sẽ hiển thị `attendanceStatus = "not_checked_in"`.

FR-012: WHILE meeting đang ở trạng thái completed, THE system SHALL cho phép truy cập attendance list nhưng dữ liệu là snapshot cuối cùng. Người chưa có check-in time sẽ hiển thị `attendanceStatus = "absent"`.

FR-013: WHILE người dùng là Internal Participant không có quyền đặc biệt, THE system SHALL che giấu trường attendanceSource, checkInMethod và confidenceScore của tất cả participants khác trong response.

### 3.4 Optional Feature Requirements

FR-015: WHERE face/device check-in source được ghi nhận trong attendance_records.attendance_source, THE system SHALL hiển thị nguồn điểm danh tương ứng cho user có quyền.

### 3.5 Unwanted Behavior Requirements

FR-016: IF người dùng chưa đăng nhập, THEN THE system SHALL từ chối yêu cầu với status 401.

FR-017: IF người dùng đã đăng nhập nhưng không có quyền, THEN THE system SHALL từ chối yêu cầu với status 403 và error code PERMISSION_DENIED.

FR-018: IF meetingId không tồn tại hoặc meeting đã bị soft-delete, THEN THE system SHALL từ chối yêu cầu với status 404 và error code MEETING_NOT_FOUND.

FR-019: IF meeting ở trạng thái tương lai (now < start_time), THEN THE system SHALL từ chối yêu cầu với status 409 (hoặc 422 tùy convention) và error code ATTENDANCE_NOT_OPEN_YET.

FR-020: IF query param status có giá trị không hợp lệ, THEN THE system SHALL từ chối yêu cầu với status 400.

FR-021: IF search query vượt quá 100 ký tự, THEN THE system SHALL từ chối yêu cầu với status 400.

### 3.6 Authorization Requirements

FR-022: WHEN the user performs a protected action (viewing attendance list), THE system SHALL verify authorization before processing business logic.

FR-023: WHILE the user is acting with limited scope (participant), THE system SHALL hide attendanceSource, checkInMethod and confidenceScore fields in the API response for other participants.

### 3.7 Data & State Requirements

FR-024: WHEN attendance list is retrieved successfully, THE system SHALL trả về summary gồm totalParticipants, checkedInCount, presentCount, lateCount, absentCount, attendanceRate (chỉ tính internal participants) và `scope = "internal_participants_only"`. Tổng số `checkedInCount` = `presentCount` + `lateCount` + `leftEarlyCount` (nếu có).

FR-025: WHEN tính attendanceStatus cho mỗi participant, THE system SHALL áp dụng thứ tự ưu tiên sau: 
1) Không có record/check-in time: `not_checked_in` (in_progress) hoặc `absent` (completed).
2) `left_early = true` hoặc `attendance_status = 'left_early'`: `left_early`.
3) `check_in_time > meetings.start_time`: `late`.
4) `check_in_time <= meetings.start_time`: `present`.
5) Record `pending_review`: `pending_review`.

FR-026: IF participant có check_in_time <= meetings.start_time, THEN THE system SHALL hiển thị attendanceStatus = `present` và isLate = false. Không có grace period.

FR-027: IF participant có check_in_time > meetings.start_time, THEN THE system SHALL hiển thị attendanceStatus = `late`, isLate = true và lateMinutes = CEIL((check_in_time - start_time) / 60) (tối thiểu là 1).

FR-028: IF participant có trạng thái `left_early` (checkout sớm), THEN THE system SHALL hiển thị attendanceStatus = `left_early`. Người này vẫn tính vào `checkedInCount` nhưng không tính là `absent`.

FR-029: IF participant không có check_in_time, THEN THE system SHALL hiển thị attendanceStatus = `not_checked_in` (nếu meeting đang diễn ra) hoặc `absent` (nếu meeting đã kết thúc).

### 3.8 Notification / Audit Requirements

FR-030: WHERE policy yêu cầu tracking truy cập dữ liệu nhạy cảm, THE system SHALL ghi audit log dạng non-blocking khi yêu cầu lấy danh sách thành công.
- `action_type = ''read_attendance_list''`
- `entity_type = ''attendance_records''`
- `metadata_json` chứa tối thiểu: `meetingId`, `viewerUserId`, `viewerRole`, `canViewAttendanceSource`, `filters`, `resultCount`, `requestId`.
- Nếu ghi log lỗi, hệ thống chỉ ghi log internal (console/file) và không trả lỗi cho user. Không ghi toàn bộ attendance list vào audit log để tránh lộ dữ liệu nhạy cảm.


---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL tra ve attendance list cho meeting co 20-200 participants trong vong duoi 3 giay trong dieu kien tai binh thuong.

NFR-002: THE system SHALL ho tro toi thieu 50 yeu cau dong thoi cho endpoint attendance list.

NFR-003: WHEN so luong participants vuot qua 200 cho mot meeting, THE system SHALL ho tro phan trang voi page va pageSize.

### 4.2 Security

NFR-004: THE system SHALL yeu cau authentication.

NFR-005: THE system SHALL enforce authorization cho moi request.

### 4.3 Reliability & Consistency

NFR-006: THE system SHALL dam bao response attendance list nhat quan.

NFR-007: THE system SHALL su dung index tren meeting_id va user_id.

### 4.4 Usability

NFR-008: THE system SHALL tra ve clear error messages.

NFR-009: THE system SHALL tra ve field names dang camelCase theo convention API chung.

---

## 5. Data Model

### 5.1 Entity lien quan

| Entity / Table | Vai tro trong tinh nang | Ghi chu |
|---|---|---|
| meetings | Kiem tra quyen truy cap, trang thai, thoi gian bat dau | Dung de xac dinh meeting ton tai, trang thai phu hop, va start_time de tinh late |
| meeting_participants | Danh sach nguoi tham gia noi bo | Chi lay internal participants. Kiem tra participant_role='host' |
| users | Thong tin ca nhan participant | direct_manager_id cho manager 1 cap |
| departments | Thong tin phong ban participant | department_name |
| attendance_records | Du lieu diem danh tong hop | Join truc tiep bang meeting_id va user_id. Nguon chinh cho attendanceStatus |

### 5.2 Dau vao

| Field | Type du kien | Bat buoc | Mo ta | Validation |
|---|---:|---:|---|---|
| meetingId | UUID | Co | ID cua cuoc hop | UUID v4 hop le, meeting ton tai, deleted_at IS NULL |
| status | string | Khong | Filter theo trang thai diem danh | all, present, late, absent, not_checked_in, left_early |
| search | string | Khong | Tim kiem theo ten/email | Trim, max 100 ky tu |
| page | integer | Khong | So trang | >= 1, default 1 |
| pageSize | integer | Khong | So ban ghi moi trang | 1-100, default 20 |

### 5.3 Dau ra

| Field | Type du kien | Mo ta |
|---|---:|---|
| summary.scope | string | Luôn trả về "internal_participants_only" |
| summary.totalParticipants | integer | Tong so internal participant |
| summary.checkedInCount | integer | So nguoi da check-in (present + late + left_early) |
| summary.presentCount | integer | So nguoi co mat dung gio |
| summary.lateCount | integer | So nguoi den muon |
| summary.absentCount | integer | So nguoi vang mat (khi meeting end) |
| summary.notCheckedInCount | integer | So nguoi chua check-in (khi meeting in-progress) |
| items[].participantId | UUID | ID ban ghi meeting_participants |
| items[].userId | UUID | ID nguoi dung |
| items[].fullName | string | Ho ten participant |
| items[].participantRole | string | host, attendee, approver, note_taker |
| items[].attendanceStatus | string | present, late, absent, left_early, not_checked_in, pending_review |
| items[].checkInTime | ISO-8601/null | Thoi gian check-in |
| items[].attendanceSource | string/null | Nguon diem danh -- chi tra neu co quyen |
| items[].isLate | boolean | Co den muon khong |
| items[].lateMinutes | integer | So phut den muon (0 neu dung gio) |

### 5.4 Data Constraints

- Khong tra attendance record cho external participants.
- Meeting status phai thuoc: in_progress hoac completed hoac (scheduled AND now >= start_time).

### 5.5 Data Lifecycle

- Dữ liệu attendance_records được join trực tiếp (1 meeting_id, 1 user_id). Đây là quan hệ 1-1 theo design.
- Defensive fallback: Trong trường hợp ngoại lệ có duplicate record do legacy/dirty data, backend bắt buộc chọn bản ghi mới nhất theo `updated_at DESC, created_at DESC` để đảm bảo response trả về hợp lệ và không bị duplicate participant.

### 5.6 Data-related EARS Requirements

FR-DATA-001: WHEN attendance list duoc truy xuat, THE system SHALL join meeting_participants voi users va departments.

FR-DATA-002: WHEN attendance list duoc truy xuat, THE system SHALL left join truc tiep bang `attendance_records.meeting_id = meetings.id AND attendance_records.user_id = meeting_participants.user_id`.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF meetingId khong phai UUID hop le, THEN THE system SHALL reject request voi status 400.

### 6.2 Authentication / Authorization Errors

ERR-005: IF nguoi dung chua dang nhap, THEN THE system SHALL return 401.

ERR-006: IF nguoi dung da dang nhap nhung khong co quyen truy cap, THEN THE system SHALL return 403.

### 6.3 Business Rule Errors

ERR-007: IF meeting khong ton tai hoac da bi soft-delete, THEN THE system SHALL return 404.

ERR-008: IF meeting o trang thai tuong lai (chua bat dau, now < start_time), THEN THE system SHALL return 409 (hoac 422) voi error code ATTENDANCE_NOT_OPEN_YET.

### 6.4 System Errors

ERR-009: IF database query bi loi, THEN THE system SHALL return 500.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Host da dang nhap va dang xem meeting in_progress,
When Host mo tab Attendance List,
Then he thong tra ve danh sach day du internal participants kem trang thai diem danh, summary, va attendanceSource.

AC-002:
Given Participant thuong mo tab Attendance List,
Then he thong tra ve danh sach kem trang thai co ban, che giấu attendanceSource.

AC-003:
Given Manager (direct 1 cap) cua participant X xem danh sach,
Then Manager thay chi tiet attendanceSource cua X va cac participant khac thuoc pham vi.

### 7.2 Business Rule Cases

AC-008:
Given meeting scheduled nhung now >= start_time,
When Host mo Attendance List,
Then he thong tra ve danh sach, voi cac participant chua check-in co trang thai `not_checked_in`.

AC-011:
Given participant check-in truoc start_time (hoac dung gio) toi cap giay,
When truy xuat list,
Then attendanceStatus = present, isLate = false.

AC-012:
Given participant check-in tre hon start_time 1 giay,
When truy xuat list,
Then attendanceStatus = late, isLate = true, lateMinutes = 1. (Khong ap dung grace period).

AC-013:
Given participant chua check-in va meeting da completed,
Then attendanceStatus = absent.

---

## 8. Out of Scope

### 8.1 Khong trien khai trong feature nay

- Tao, sua, xoa attendance record.
- Phát sinh WebSocket event `attendance.updated`. UC-APM-02 là API read-only, không phát sinh event. Nếu hệ thống đã có pipeline attendance update từ camera/IoT/manual check-in, UI có thể tự subscribe event từ pipeline đó. Việc phát event hoàn toàn không thuộc scope của UC này.
- Host xac nhan thu cong diem danh.
- Xem timeline chi tiet attendance events.
- Dong bo du lieu tu camera/IoT device.
- Tinh toan manager scope nhieu cap (recursive tree) - chi ho tro 1 cap quan ly truc tiep.
- Grace period cho viec check-in muon. Neu muon 1 giay cung tinh la late.
- External participants - loai hoan toan khoi attendance list va summary.
- Khong them role `co-host` moi, dung `participant_role = 'host'`.

### 8.2 Khong implement API/logic nao cho

- POST/PATCH/DELETE attendance records.
- Cac module khong lien quan: scheduling, approvals.

### 8.3 Co the xem xet o feature khac

- Recursive manager scope.
- Configurable Grace Period.
- Hien thi attendance cua External participants.
