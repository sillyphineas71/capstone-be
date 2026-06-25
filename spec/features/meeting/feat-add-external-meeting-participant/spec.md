| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-25 | Khởi tạo spec cho tính năng thêm khách mời bên ngoài (external participant) sau khi cuộc họp đã được tạo | Toàn bộ file |

# Feature Specification: Thêm khách mời bên ngoài vào cuộc họp đã tạo

- **Feature ID**: MEET-ADD-EXTERNAL-PARTICIPANT-001
- **Feature Name**: Add External Meeting Participant (Post-creation)
- **Module / Domain**: Meeting Management (meetings)
- **Created Date**: 2026-06-25
- **Status**: Draft
- **Source Documents**:
  - Không có Use Case chính thức tương ứng trong `UseCase_List_SMRMPTS.xlsx` (đã rà soát: chỉ có UC-23 "Thêm thành viên nội bộ thủ công" và UC-25 "Gỡ bỏ thành viên nội bộ"; không có UC riêng cho external participant sau khi tạo meeting).
  - Đây là tính năng mở rộng theo **yêu cầu trực tiếp của team/người dùng ngày 2026-06-25**, dựa trên gap được phát hiện khi review module `meetings` hiện tại: `externalParticipants` hiện chỉ có thể khai báo tại thời điểm tạo cuộc họp (`CreateMeetingDto`), chưa có endpoint thêm sau khi cuộc họp đã tồn tại.
  - Tham chiếu thiết kế tương đương: `spec/features/meeting/feat-add-internal-meeting-participant` (UC-MM-06) — dùng làm baseline cho luồng quyền, cảnh báo sức chứa phòng, transaction, notification.
  - Database v3.2 Compact (39 Tables) — bảng `meeting_external_participants`.

---

## 1. Feature Overview

### 1.1 Bối cảnh

Hiện tại, khách mời bên ngoài (external participant — người không có tài khoản trong hệ thống, ví dụ khách hàng, đối tác) chỉ có thể được khai báo tại **thời điểm tạo cuộc họp** thông qua trường `externalParticipants` trong `CreateMeetingDto`. Sau khi cuộc họp đã được tạo và đang ở trạng thái `scheduled`/`in_progress`, hệ thống **chưa có endpoint** cho phép Organizer/Host bổ sung thêm khách mời bên ngoài.

Trong vận hành thực tế, danh sách khách mời bên ngoài thường thay đổi sau khi cuộc họp đã được lên lịch (ví dụ: đối tác xác nhận thêm người tham dự, bổ sung khách hàng vào phút cuối). Việc thiếu endpoint này buộc người dùng phải hủy và tạo lại cuộc họp, gây mất dữ liệu (booking, agenda, participant nội bộ đã có).

Tính năng này thuộc module **Meeting Management**, tác động lên bảng `meeting_external_participants`, và là tính năng song hành (companion feature) với `feat-remove-external-meeting-participant`.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép Organizer, Host, hoặc Meeting Manager có quyền quản lý cuộc họp thực hiện thêm một khách mời bên ngoài vào danh sách `meeting_external_participants` của một cuộc họp cụ thể đã tồn tại, mà không cần hủy hoặc tạo lại cuộc họp.

### 1.3 Giá trị mang lại

- **Sự linh hoạt**: Cho phép cập nhật danh sách khách mời bên ngoài trong suốt vòng đời `scheduled`/`in_progress` của cuộc họp, không chỉ tại thời điểm tạo.
- **Tính nhất quán nghiệp vụ**: Khách mời bên ngoài mới được thêm vẫn được tính vào tổng số người tham dự để kiểm tra sức chứa phòng, đúng như cách `getAttendeeCount` hiện tại đã cộng cả `meeting_participants` và `meeting_external_participants`.
- **Theo dõi & audit**: Mọi lần thêm khách mời bên ngoài được ghi nhận qua `meeting_events` và `audit_logs`.
- **Thông báo tự động**: Khách mời bên ngoài mới được thêm nhận được email mời họp qua `notifications` + `background_jobs`, theo đúng pattern email invite đã dùng cho luồng phê duyệt meeting request hiện tại.

### 1.4 Giả định

- Email là bắt buộc đối với khách mời bên ngoài (giống ràng buộc `ExternalParticipantDto` hiện tại dùng ở `CreateMeetingDto`), vì email là kênh thông báo duy nhất có thể dùng cho người không có tài khoản trong hệ thống.
- Mỗi lần gọi API chỉ thêm **một** khách mời bên ngoài (tương tự cách `POST /meetings/:meetingId/participants/internal` chỉ thêm một người dùng nội bộ mỗi lần). Việc thêm nhiều khách mời cùng lúc sau khi tạo cuộc họp không thuộc phạm vi tính năng này.
- Khách mời bên ngoài không có tài khoản, không có lịch cá nhân trong hệ thống, nên không áp dụng kiểm tra xung đột lịch (schedule conflict) như với participant nội bộ.
- Khách mời bên ngoài vẫn được tính vào tổng số người tham dự khi kiểm tra sức chứa phòng (room capacity), vì họ chiếm chỗ vật lý trong phòng họp.
- Permission code mới `meeting.participant.add.external` cần được seed vào bảng `permissions`/`role_permissions`; việc tạo seed cụ thể thuộc phạm vi `/speckit.plan`, không thuộc phạm vi spec này.
- Giá trị enum mới `external_participant_added` cho cột `meeting_events.event_type` là một giá trị string mới ở tầng ứng dụng; cột này là `varchar(60)` không có constraint enum ở DB nên không cần migration.

### 1.5 Cần làm rõ

- Có cần thêm unique constraint ở tầng database cho `(meeting_id, email)` trên bảng `meeting_external_participants` để chống trùng lặp tuyệt đối không, hay chỉ kiểm tra ở tầng application như spec này đề xuất? (Spec này chọn phương án application-level check; xem mục 11 Out of Scope.)
- Có cần một endpoint riêng để cập nhật thông tin khách mời bên ngoài đã thêm (sửa tên/email/SĐT) không? (Ngoài phạm vi spec này.)

---

## 2. Actors & Permissions

### 2.1 Danh sách actor

| Actor | Vai trò | Quyền trong tính năng |
|---|---|---|
| Organizer | Người tạo cuộc họp | Luôn được phép thêm khách mời bên ngoài vào meeting mình tạo, kể cả meeting `private` |
| Internal Employee (Host) | Người chủ trì cuộc họp | Luôn được phép thêm khách mời bên ngoài vào meeting mình chủ trì, kể cả meeting `private` |
| Meeting Manager | Người có quyền `meeting.participant.add.external` | Được phép thêm khách mời bên ngoài cho meeting thông thường (`internal`/`department`/`public`); **không** được thêm vào meeting `private` trừ khi là Organizer/Host |
| System Admin | Quản trị hệ thống | Có quyền `admin.all`; được phép thêm khách mời bên ngoài vào cả meeting `private` |
| External Participant | Khách mời bên ngoài | Không phải actor của API này; không có tài khoản, không thể tự thực hiện hành động |

### 2.2 Permission rule

- Permission đề xuất: `meeting.participant.add.external` (mới, mirror cách đặt tên của `meeting.participant.add.internal` đã có).
- Organizer/Host của meeting luôn được thêm khách mời bên ngoài vào meeting mình quản lý, không cần permission riêng.
- Meeting Manager cần có permission `meeting.participant.add.external` để thêm vào meeting thông thường.
- **Private Meeting**: Với `meetings.visibility_level='private'`, chỉ `organizer_id`, `host_id`, hoặc Admin (`admin.all`) mới được thêm khách mời bên ngoài. Meeting Manager thông thường bị từ chối dù có permission `meeting.participant.add.external`.
- **Capacity Override**: Chỉ actor có permission `meeting.participant.override_capacity` (đã có, dùng chung với luồng add internal participant) mới được override cảnh báo vượt sức chứa phòng.

### 2.3 Actor Constraints

- Phải được xác thực (JWT hợp lệ).
- Phải có quyền `meeting.participant.add.external` HOẶC là Organizer/Host của meeting đó.
- Chỉ thao tác được trên meeting có status là `scheduled` hoặc `in_progress`.

---

## 3. User Stories

- **US-01**: Với vai trò Organizer/Host, tôi muốn thêm một khách mời bên ngoài vào cuộc họp đã lên lịch để bổ sung đối tác/khách hàng cần tham dự mà không phải tạo lại cuộc họp.
- **US-02**: Với vai trò Meeting Manager, tôi muốn thêm khách mời bên ngoài cho cuộc họp thông thường thuộc phạm vi quản lý của mình, nhưng hệ thống phải ngăn tôi làm điều này với cuộc họp `private` mà tôi không phải Organizer/Host.
- **US-03**: Với vai trò khách mời bên ngoài, tôi muốn nhận được email mời họp ngay khi được thêm vào danh sách tham dự, để biết thời gian/nội dung cuộc họp.
- **US-04**: Với vai trò Admin/Room Manager có quyền override sức chứa, tôi muốn vẫn thêm được khách mời bên ngoài khi phòng đã đạt giới hạn cảnh báo (không phải hard block), sau khi xác nhận cảnh báo.

---

## 4. Functional Requirements

> Viết theo chuẩn EARS. Keyword EARS giữ bằng tiếng Anh, nội dung nghiệp vụ viết bằng tiếng Việt.

### 4.1 Authentication & Authorization

**FR-001**: THE system SHALL yêu cầu xác thực người dùng (JWT hợp lệ) trước khi cho phép thêm khách mời bên ngoài vào cuộc họp.

**FR-002**: IF người dùng chưa được xác thực, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 401 Unauthorized.

**FR-003**: THE system SHALL kiểm tra quyền `meeting.participant.add.external` HOẶC quyền sở hữu (Organizer/Host của meeting đó) trước khi cho phép thực hiện thao tác thêm khách mời bên ngoài.

**FR-004**: IF người dùng đã xác thực nhưng không có quyền `meeting.participant.add.external` và không phải Organizer/Host của meeting đó, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 403 Forbidden.

**FR-005**: IF meeting có `visibility_level='private'` và actor không phải Organizer, Host, hoặc Admin (`admin.all`), THEN THE system SHALL từ chối yêu cầu và trả về lỗi 403 `FORBIDDEN_ACCESS`.

### 4.2 Validation

**FR-006**: IF giá trị `meetingId` trong path không đúng định dạng UUID, THEN THE system SHALL trả về lỗi 400 Bad Request.

**FR-007**: IF `fullName` bị thiếu, rỗng, hoặc chỉ chứa khoảng trắng, THEN THE system SHALL từ chối yêu cầu và trả về lỗi validation 400.

**FR-008**: IF `email` bị thiếu hoặc không đúng định dạng email, THEN THE system SHALL từ chối yêu cầu và trả về lỗi validation 400.

**FR-009**: IF meeting với `meetingId` không tồn tại hoặc đã bị soft-delete, THEN THE system SHALL trả về lỗi 404 `MEETING_NOT_FOUND`.

### 4.3 State Validation

**FR-010**: WHILE meeting đang ở trạng thái `scheduled` hoặc `in_progress`, THE system SHALL cho phép thực hiện thao tác thêm khách mời bên ngoài.

**FR-011**: IF meeting không ở trạng thái `scheduled` hoặc `in_progress` (ví dụ `draft`, `pending_approval`, `completed`, `cancelled`), THEN THE system SHALL từ chối yêu cầu và trả về lỗi 400 `INVALID_MEETING_STATUS`.

### 4.4 Duplicate Prevention

**FR-012**: IF email (so sánh không phân biệt hoa/thường) đã tồn tại trong danh sách `meeting_external_participants` của cùng `meetingId`, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 409 `EXTERNAL_PARTICIPANT_ALREADY_EXISTS`.

### 4.5 Room Capacity & Warning Flow

**FR-013**: WHEN nhận request thêm khách mời bên ngoài VÀ meeting có gán `room_id`, THE system SHALL tính tổng số người tham dự hiện tại (`meeting_participants` + `meeting_external_participants`) cộng thêm 1 để kiểm tra so với `rooms.capacity`.

**FR-014**: IF tổng số người tham dự sau khi thêm vượt quá `rooms.capacity` VÀ chính sách `meeting.capacity_policy` (đọc từ `system_configs`) là `warning`, THEN THE system SHALL chặn luồng ở lần gọi đầu tiên (khi chưa có `warningToken` hợp lệ) và trả về lỗi 422 `WARNING_CONFIRMATION_REQUIRED` kèm `warningToken` và danh sách warning.

**FR-015**: IF tổng số người tham dự sau khi thêm vượt quá `rooms.capacity` VÀ chính sách `meeting.capacity_policy` là `block`, THEN THE system SHALL từ chối yêu cầu ngay lập tức và trả về lỗi 422 `ROOM_CAPACITY_EXCEEDED`, không cho phép override.

**FR-016**: WHEN client gửi lại request kèm `overrideWarnings=true` và `warningToken` hợp lệ tương ứng với cảnh báo sức chứa, THE system SHALL kiểm tra quyền `meeting.participant.override_capacity` của actor trước khi cho phép bỏ qua cảnh báo.

**FR-017**: IF actor không có quyền `meeting.participant.override_capacity` khi cố gắng override cảnh báo sức chứa (chính sách `warning`), THEN THE system SHALL từ chối yêu cầu và trả về lỗi 422 `ROOM_CAPACITY_EXCEEDED`.

**FR-018**: IF `warningToken` không hợp lệ, đã hết hạn, hoặc không khớp với `meetingId`/dữ liệu request, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 400 `INVALID_WARNING_TOKEN`.

**FR-019**: THE system SHALL NOT thực hiện kiểm tra xung đột lịch cá nhân (schedule conflict) đối với khách mời bên ngoài, vì khách mời bên ngoài không có tài khoản hoặc lịch nội bộ trong hệ thống.

### 4.6 Business Logic & Persistence

**FR-020**: WHEN tất cả điều kiện hợp lệ, THE system SHALL tạo một bản ghi mới trong `meeting_external_participants` với `participant_role='attendee'` và `invitation_status='pending'`.

**FR-021**: THE system SHALL lưu `full_name`, `email`, và (nếu được cung cấp) `organization_name`, `phone_number` từ request vào bản ghi mới.

**FR-022**: WHEN khách mời bên ngoài được thêm thành công, THE system SHALL ghi một record vào `meeting_events` với `event_type='external_participant_added'`, `actor_user_id` là người thực hiện, và `metadata_json` chứa `email`, `fullName` của khách mời mới.

**FR-023**: WHEN khách mời bên ngoài được thêm thành công, THE system SHALL ghi một record vào `audit_logs` với action `add_external_participant`, actor là người thực hiện, target là bản ghi `meeting_external_participants` mới.

**FR-024**: WHEN thực hiện thao tác thêm khách mời bên ngoài, THE system SHALL đảm bảo các bước ghi dữ liệu cốt lõi (tạo participant, tạo `meeting_event`, tạo `audit_log`) nằm trong cùng một database transaction.

**FR-025**: IF bất kỳ bước nào trong transaction ở FR-024 thất bại, THEN THE system SHALL rollback toàn bộ transaction và trả về lỗi 500 Internal Server Error, đảm bảo không tồn tại bản ghi participant nếu chưa ghi đủ event/audit log.

### 4.7 Notification

**FR-026**: WHEN khách mời bên ngoài được thêm thành công, THE system SHALL enqueue một thông báo email (qua `notifications` + `background_jobs`) gửi tới `email` của khách mời với `notification_type='meeting_invite'`.

**FR-027**: THE system SHALL NOT tạo thông báo in-app (`channel='in_app'`) cho khách mời bên ngoài, vì khách mời bên ngoài không có user account trong hệ thống để nhận thông báo in-app.

**FR-028**: IF việc enqueue thông báo email ở FR-026 thất bại sau khi transaction chính đã commit thành công, THEN THE system SHALL ghi log lỗi và KHÔNG rollback thao tác thêm khách mời đã thành công.

**FR-029**: IF meeting đang ở trạng thái `in_progress` khi khách mời bên ngoài được thêm, THEN THE system SHALL phát một event ứng dụng best-effort (để các module khác như presence/device-sync có thể đồng bộ), và việc phát event này thất bại KHÔNG được làm rollback thao tác thêm khách mời.

### 4.8 Concurrency

**FR-030**: IF hai request thêm khách mời bên ngoài với cùng `email` vào cùng `meetingId` được gửi đồng thời, THEN THE system SHALL đảm bảo tối đa một request thành công; request còn lại nhận lỗi 409 `EXTERNAL_PARTICIPANT_ALREADY_EXISTS` thay vì lỗi hệ thống 500.

### 4.9 Response Contract

**FR-031**: WHEN thao tác thêm khách mời bên ngoài thành công, THE system SHALL trả về HTTP 201 với response chứa `externalParticipantId`, `meetingId`, `fullName`, `email`, `organizationName`, `phoneNumber`, `role`, `status`.

**FR-032**: THE system SHALL trả về response theo format chuẩn của dự án: `{ success: true, message: "...", data: { ... } }`.

### 4.10 Traceability

| Requirement ID | EARS Pattern | Ghi chú |
|---|---|---|
| FR-001 | Ubiquitous | Luôn cần auth |
| FR-002 | Unwanted Behavior | Auth failure |
| FR-003 | Ubiquitous | Authorization check |
| FR-004 | Unwanted Behavior | Permission denied |
| FR-005 | Unwanted Behavior | Private meeting restriction |
| FR-006 | Unwanted Behavior | Invalid meetingId UUID |
| FR-007 | Unwanted Behavior | fullName required |
| FR-008 | Unwanted Behavior | email format |
| FR-009 | Unwanted Behavior | Meeting not found |
| FR-010 | State-driven | Allowed state |
| FR-011 | Unwanted Behavior | Wrong state |
| FR-012 | Unwanted Behavior | Duplicate email |
| FR-013 | Event-driven | Capacity calculation |
| FR-014 | Unwanted Behavior | Warning policy first call |
| FR-015 | Unwanted Behavior | Block policy |
| FR-016 | Event-driven | Override verification |
| FR-017 | Unwanted Behavior | No override permission |
| FR-018 | Unwanted Behavior | Invalid warning token |
| FR-019 | Ubiquitous | No schedule-conflict check |
| FR-020 | Event-driven | Create participant record |
| FR-021 | Event-driven | Persist optional fields |
| FR-022 | Event-driven | Meeting event record |
| FR-023 | Event-driven | Audit log record |
| FR-024 | Ubiquitous | Transactional guarantee |
| FR-025 | Unwanted Behavior | Rollback on failure |
| FR-026 | Event-driven | Email notification |
| FR-027 | Ubiquitous | No in-app notification |
| FR-028 | Unwanted Behavior | Notification failure isolation |
| FR-029 | Event-driven | Best-effort device sync |
| FR-030 | Unwanted Behavior | Concurrent duplicate add |
| FR-031 | Event-driven | Success response |
| FR-032 | Ubiquitous | Response format |

---

## 5. Non-Functional Requirements

### 5.1 Security

**NFR-001**: THE system SHALL enforce authentication cho mọi request đến endpoint này.

**NFR-002**: THE system SHALL enforce authorization dựa trên permission `meeting.participant.add.external` hoặc quyền sở hữu (Organizer/Host).

**NFR-003**: THE system SHALL NOT trả về thông tin nhạy cảm (token, password hash, internal error stack) trong response.

### 5.2 Consistency

**NFR-004**: THE system SHALL đảm bảo tính nhất quán (atomic transaction) giữa `meeting_external_participants`, `meeting_events`, và `audit_logs` trong cùng một business transaction.

### 5.3 Auditability

**NFR-005**: THE system SHALL ghi audit log cho mọi thao tác thêm khách mời bên ngoài thành công.

**NFR-006**: THE system SHALL lưu đầy đủ thông tin trong audit log: actor, action, target type, target id, dữ liệu mới, IP/user agent nếu có, timestamp.

### 5.4 Concurrency

**NFR-007**: THE system SHALL xử lý an toàn khi nhận nhiều yêu cầu thêm cùng email vào cùng meeting đồng thời: chỉ một request thành công, các request còn lại nhận lỗi 409 (không phải lỗi 500).

### 5.5 Notification Reliability

**NFR-008**: THE system SHALL enqueue notification email sau khi transaction chính đã commit thành công (best-effort); nếu việc enqueue thất bại, THE system SHALL ghi nhận lỗi nhưng KHÔNG rollback thao tác thêm khách mời.

### 5.6 Performance

**NFR-009**: THE system SHALL hoàn thành thao tác thêm khách mời bên ngoài (không tính bước notification async) trong vòng dưới 2 giây dưới tải bình thường.

**NFR-010**: THE system SHALL xử lý tối thiểu 30 request thêm khách mời bên ngoài đồng thời mà không ảnh hưởng đến các thao tác meeting khác.

---

## 6. API Contract đề xuất

### 6.1 Endpoint

```
POST /api/v1/meetings/{meetingId}/participants/external
```

### 6.2 Headers

| Header | Value | Bắt buộc |
|---|---|---:|
| Authorization | Bearer \<JWT token\> | Có |
| Content-Type | application/json | Có |

### 6.3 Path Parameters

| Parameter | Type | Bắt buộc | Mô tả |
|---|---:|---:|---|
| meetingId | UUID | Có | ID của cuộc họp cần thêm khách mời bên ngoài |

### 6.4 Request Body

```json
{
  "fullName": "Nguyễn Văn Khách",
  "email": "khach@partner.com",
  "organizationName": "Công ty Đối tác ABC",
  "phoneNumber": "0901234567",
  "overrideWarnings": false,
  "warningToken": null
}
```

| Field | Type | Bắt buộc | Mô tả |
|---|---:|---:|---|
| fullName | string (max 255) | Có | Họ tên khách mời bên ngoài |
| email | string (email, max 255) | Có | Email khách mời, dùng để gửi thư mời và chống trùng lặp |
| organizationName | string (max 255) | Không | Tên tổ chức/công ty của khách mời |
| phoneNumber | string (max 30) | Không | Số điện thoại liên hệ |
| overrideWarnings | boolean | Không | Xác nhận bỏ qua cảnh báo sức chứa phòng ở lần gọi thứ hai |
| warningToken | string | Không | Token nhận được từ response 422 ở lần gọi đầu, dùng khi override |

### 6.5 Success Response (201 Created)

```json
{
  "success": true,
  "message": "Đã thêm khách mời bên ngoài vào cuộc họp thành công",
  "data": {
    "externalParticipantId": "uuid",
    "meetingId": "uuid",
    "fullName": "Nguyễn Văn Khách",
    "email": "khach@partner.com",
    "organizationName": "Công ty Đối tác ABC",
    "phoneNumber": "0901234567",
    "role": "attendee",
    "status": "pending"
  }
}
```

### 6.6 Warning Response (422 — lần gọi đầu khi vượt sức chứa, policy = warning)

```json
{
  "success": false,
  "error": {
    "code": "WARNING_CONFIRMATION_REQUIRED",
    "message": "Phát hiện cảnh báo sức chứa phòng. Vui lòng xác nhận.",
    "details": {
      "warningToken": "jwt-or-opaque-token-valid-for-5-mins",
      "warnings": [
        { "type": "ROOM_CAPACITY_WARNING", "message": "Sức chứa phòng (10 người) không đủ cho tổng số người tham dự (11 người)." }
      ]
    }
  }
}
```

### 6.7 Error Responses

| Status | Mã lỗi | Điều kiện |
|---|---:|---|
| 400 | VALIDATION_ERROR | `fullName`/`email` thiếu hoặc sai định dạng; `meetingId` không đúng UUID |
| 400 | INVALID_MEETING_STATUS | Meeting không ở trạng thái `scheduled`/`in_progress` |
| 400 | INVALID_WARNING_TOKEN | `warningToken` không hợp lệ, hết hạn, hoặc không khớp |
| 401 | UNAUTHENTICATED | Thiếu hoặc token hết hạn |
| 403 | FORBIDDEN | Không có quyền `meeting.participant.add.external` và không phải Organizer/Host |
| 403 | FORBIDDEN_ACCESS | Meeting là `private` và actor không phải Organizer/Host/Admin |
| 404 | MEETING_NOT_FOUND | Meeting không tồn tại hoặc đã bị soft-delete |
| 409 | EXTERNAL_PARTICIPANT_ALREADY_EXISTS | Email đã có trong danh sách khách mời bên ngoài của meeting |
| 422 | WARNING_CONFIRMATION_REQUIRED | Vượt sức chứa, policy `warning`, chưa có `warningToken` hợp lệ |
| 422 | ROOM_CAPACITY_EXCEEDED | Vượt sức chứa với policy `block`, hoặc `warning` nhưng không có quyền override |
| 500 | INTERNAL_ERROR | Lỗi server không xác định |

---

## 7. Data Model Impact

### 7.1 Entity liên quan

| Entity / Table | Vai trò | Thao tác |
|---|---|---|
| `meetings` | Đọc trạng thái, `organizer_id`, `host_id`, `visibility_level`, `room_id` | READ ONLY |
| `meeting_participants` | Đếm số người tham dự nội bộ để tính sức chứa | READ ONLY |
| `meeting_external_participants` | Lưu khách mời bên ngoài | INSERT |
| `rooms` | Đọc `capacity` để kiểm tra sức chứa | READ ONLY |
| `system_configs` | Đọc `meeting.capacity_policy` | READ ONLY |
| `meeting_events` | Ghi event `external_participant_added` | INSERT |
| `audit_logs` | Ghi nhật ký thao tác | INSERT |
| `notifications` | Tạo thông báo email mời họp | INSERT |
| `background_jobs` | Enqueue job gửi email | INSERT |

### 7.2 Dữ liệu đầu vào

| Field | Type | Bắt buộc | Mô tả |
|---|---:|---:|---|
| meetingId | UUID | Có | ID cuộc họp (path param) |
| fullName | string | Có | Họ tên khách mời |
| email | string (email) | Có | Email khách mời |
| organizationName | string (nullable) | Không | Tên tổ chức |
| phoneNumber | string (nullable) | Không | Số điện thoại |
| overrideWarnings | boolean | Không | Cờ xác nhận bỏ qua cảnh báo |
| warningToken | string (nullable) | Không | Token xác nhận cảnh báo |

### 7.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| externalParticipantId | UUID | ID bản ghi `meeting_external_participants` mới |
| meetingId | UUID | ID cuộc họp |
| fullName | string | Họ tên khách mời |
| email | string | Email khách mời |
| organizationName | string \| null | Tên tổ chức |
| phoneNumber | string \| null | Số điện thoại |
| role | string | Luôn là `attendee` |
| status | string | Luôn là `pending` |

### 7.4 Data Constraints

- Không thêm bảng mới, không thêm cột mới vào `meeting_external_participants`.
- Permission mới `meeting.participant.add.external` cần một seed migration (thuộc phạm vi `/speckit.plan`).
- Giá trị `meeting_events.event_type = 'external_participant_added'` là giá trị mới ở tầng ứng dụng; cột là `varchar(60)` nên không cần migration schema.
- Kiểm tra trùng email (`(meeting_id, email)`) chỉ thực hiện ở tầng application (pre-check + re-check trong transaction); bảng `meeting_external_participants` hiện **không có unique constraint** trên `(meeting_id, email)` ở tầng database. Đây là giới hạn đã biết, xem mục 11 Out of Scope.

### 7.5 Data Lifecycle

- `meeting_external_participants`: bản ghi được tạo khi thao tác thành công; không có cơ chế cập nhật/xóa trong phạm vi tính năng này.
- `meeting_events`: insert ngay khi thêm thành công, dùng để trace lịch sử.
- `audit_logs`: insert ngay khi thêm thành công.
- `notifications` + `background_jobs`: insert sau khi transaction chính commit, để gửi email mời họp bất đồng bộ.

---

## 8. Business Rules

**BR-01 (Ownership)**: Organizer, Host của meeting, hoặc Admin có quyền `admin.all` luôn được thêm khách mời bên ngoài. Meeting Manager cần permission `meeting.participant.add.external` và bị chặn với meeting `private`.

**BR-02 (Allowed states)**: Chỉ áp dụng cho meeting ở trạng thái `scheduled` hoặc `in_progress`.

**BR-03 (Capacity policy)**: Sức chứa phòng được kiểm tra dựa trên tổng người tham dự nội bộ + bên ngoài, theo policy global `meeting.capacity_policy` (giống luồng add internal participant).

**BR-04 (No schedule conflict)**: Không kiểm tra xung đột lịch cá nhân cho khách mời bên ngoài vì họ không có lịch trong hệ thống.

**BR-05 (Transactional integrity)**: Tạo participant, meeting_event, audit_log phải nằm trong cùng một transaction.

**BR-06 (Notification async)**: Email mời họp được enqueue sau khi transaction chính thành công; thất bại gửi email không rollback thao tác thêm.

**BR-07 (Duplicate prevention — application level)**: Không cho phép hai bản ghi có cùng email (không phân biệt hoa/thường) trong cùng một meeting; kiểm tra ở tầng application, không có unique constraint database trong phạm vi tính năng này.

**BR-08 (Default role)**: Khách mời bên ngoài mới luôn nhận `participant_role='attendee'`; không hỗ trợ chọn role khác trong tính năng này.

**BR-09 (Private meeting restriction)**: Meeting `private` chỉ cho phép Organizer/Host/Admin thêm khách mời bên ngoài, không áp dụng cho Meeting Manager thông thường.

---

## 9. Acceptance Criteria

> Format Given / When / Then.

### 9.1 Happy Path

**AC-01 - Thêm thành công**:
Given Organizer/Host đã đăng nhập và meeting đang `scheduled`,
When gửi request hợp lệ với `fullName` và `email` mới,
Then hệ thống trả về HTTP 201,
And bản ghi mới xuất hiện trong `meeting_external_participants`,
And `meeting_events` có record `external_participant_added`,
And `audit_logs` có record `add_external_participant`.

**AC-02 - Notification email được enqueue**:
Given AC-01 đã thành công,
When kiểm tra database,
Then `notifications` có record với `notification_type='meeting_invite'`, `channel='email'`,
And `background_jobs` có record email job tương ứng,
And không có notification nào với `channel='in_app'` cho khách mời này.

### 9.2 Duplicate & Validation

**AC-03 - Email trùng bị từ chối**:
Given meeting đã có khách mời bên ngoài với email `a@x.com`,
When actor gửi request thêm khách mời mới với email `A@X.com` (khác hoa/thường),
Then hệ thống trả về HTTP 409 `EXTERNAL_PARTICIPANT_ALREADY_EXISTS`,
And không có bản ghi mới được tạo.

**AC-04 - Email không hợp lệ**:
Given request có `email` sai định dạng,
When gửi request,
Then hệ thống trả về HTTP 400 validation error.

### 9.3 Authorization Cases

**AC-05 - Meeting private, Meeting Manager bị chặn**:
Given meeting có `visibility_level='private'`,
When một Meeting Manager (không phải Organizer/Host) gửi request thêm khách mời,
Then hệ thống trả về HTTP 403 `FORBIDDEN_ACCESS`.

**AC-06 - Meeting private, Organizer thành công**:
Given meeting `private`,
When Organizer gửi request hợp lệ,
Then bản ghi được tạo thành công (HTTP 201).

### 9.4 Capacity Warning Flow

**AC-07 - Cảnh báo sức chứa, policy warning, có quyền override**:
Given phòng đã đầy, `meeting.capacity_policy='warning'`, actor có quyền `meeting.participant.override_capacity`,
When actor gửi request lần đầu (không có `warningToken`),
Then hệ thống trả về 422 `WARNING_CONFIRMATION_REQUIRED` kèm `warningToken`,
When actor gửi lại request với `overrideWarnings=true` và `warningToken` hợp lệ,
Then bản ghi được tạo thành công (HTTP 201).

**AC-08 - Cảnh báo sức chứa, policy warning, không có quyền override**:
Given phòng đã đầy, policy `warning`, actor không có quyền override,
When actor gửi lại request với `overrideWarnings=true` và `warningToken` hợp lệ,
Then hệ thống trả về 422 `ROOM_CAPACITY_EXCEEDED`.

**AC-09 - Policy block**:
Given phòng đã đầy, `meeting.capacity_policy='block'`,
When actor gửi request (kể cả có quyền override),
Then hệ thống trả về 422 `ROOM_CAPACITY_EXCEEDED` ngay từ lần gọi đầu.

### 9.5 State Validation

**AC-10 - Meeting sai trạng thái**:
Given meeting đang ở trạng thái `completed` hoặc `cancelled`,
When actor gửi request thêm khách mời,
Then hệ thống trả về HTTP 400 `INVALID_MEETING_STATUS`.

### 9.6 Concurrency

**AC-11 - Hai request đồng thời cùng email**:
Given hai request thêm cùng email vào cùng meeting được gửi gần như đồng thời,
When hệ thống xử lý,
Then chỉ một request nhận HTTP 201,
And request còn lại nhận HTTP 409 `EXTERNAL_PARTICIPANT_ALREADY_EXISTS` (không phải lỗi 500).

### 9.7 Audit Trail

**AC-12 - Audit log đầy đủ**:
Given thêm khách mời thành công,
When kiểm tra `audit_logs`,
Then có record với action=`add_external_participant`, actor=người thực hiện, target=bản ghi participant mới.

**AC-13 - Meeting đang in_progress vẫn cho phép thêm**:
Given meeting đang ở trạng thái `in_progress`,
When Organizer/Host gửi request hợp lệ,
Then hệ thống trả về HTTP 201 và bản ghi được tạo thành công.

### 9.8 Traceability

| AC ID | Requirement ID liên quan | Kịch bản test |
|---|---|---|
| AC-01 | FR-001, FR-003, FR-010, FR-020, FR-022, FR-023, FR-024, FR-031 | Thêm thành công |
| AC-02 | FR-026, FR-027 | Notification email, không in-app |
| AC-03 | FR-012 | Duplicate email |
| AC-04 | FR-008 | Email không hợp lệ |
| AC-05 | FR-005 | Private meeting bị chặn |
| AC-06 | FR-005 | Private meeting Organizer thành công |
| AC-07 | FR-014, FR-016 | Warning 2-step thành công |
| AC-08 | FR-017 | Warning nhưng không có quyền override |
| AC-09 | FR-015 | Policy block |
| AC-10 | FR-011 | Sai trạng thái meeting |
| AC-11 | FR-030 | Concurrency |
| AC-12 | FR-023 | Audit log |
| AC-13 | FR-010 | In_progress vẫn cho phép |

---

## 10. Edge Cases

| # | Edge Case | Expected Behavior |
|---|---|---|
| EC-01 | Email chỉ khác chữ hoa/thường so với khách mời đã có | Coi là trùng lặp, trả về 409 |
| EC-02 | Meeting không gán `room_id` (`roomId=null`) | Bỏ qua hoàn toàn bước kiểm tra sức chứa, không có warning |
| EC-03 | `organizationName`/`phoneNumber` không được cung cấp | Lưu là `null`, không phát sinh lỗi |
| EC-04 | Meeting đang `in_progress` | Vẫn cho phép thêm (giống luồng add internal participant) |
| EC-05 | Admin (`admin.all`) thêm khách mời vào meeting `private` mà Admin không phải Organizer/Host | Cho phép (giống rule Admin của luồng add internal participant) |
| EC-06 | `warningToken` hợp lệ về định dạng nhưng dùng cho `meetingId` hoặc nội dung warning khác | Từ chối với 400 `INVALID_WARNING_TOKEN` |
| EC-07 | Background job gửi email thất bại sau khi transaction đã commit | Bản ghi participant vẫn tồn tại; lỗi được log, không rollback |
| EC-08 | `fullName` chỉ gồm khoảng trắng | Coi như rỗng, trả về lỗi validation 400 |
| EC-09 | Cùng email được thêm vào hai meeting khác nhau | Cho phép, vì kiểm tra trùng lặp chỉ scope theo từng `meetingId` |
| EC-10 | Tổng số người tham dự sau khi thêm bằng đúng `rooms.capacity` (không vượt) | Không phát sinh warning, thêm thành công bình thường |

---

## 11. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

### 11.1 Không triển khai trong feature này

- **Thêm nhiều khách mời bên ngoài cùng lúc** sau khi cuộc họp đã tạo (bulk add). Chỉ hỗ trợ thêm một khách mời mỗi lần gọi API. Việc thêm nhiều khách mời cùng lúc chỉ khả dụng tại thời điểm tạo meeting qua `externalParticipants[]`.
- **Import khách mời bên ngoài bằng Excel**.
- **Cập nhật thông tin khách mời bên ngoài đã thêm** (sửa `fullName`/`email`/`organizationName`/`phoneNumber`) — cần một feature riêng nếu được yêu cầu.
- **Gỡ bỏ khách mời bên ngoài** — thuộc feature riêng `feat-remove-external-meeting-participant`.
- **Thêm/Gỡ thành viên nội bộ** — đã có feature riêng (`feat-add-internal-meeting-participant`, `feat-remove-internal-meeting-participant`).
- **Thay đổi `participant_role`** của bất kỳ participant nào (nội bộ hoặc bên ngoài) — không thuộc phạm vi tính năng này.
- **Theo dõi RSVP / phản hồi lời mời** của khách mời bên ngoài (chuyển `invitation_status` từ `pending` sang `accepted`/`declined`) — không có endpoint công khai cho khách mời tự phản hồi trong tính năng này.
- **Thêm unique constraint database** cho `(meeting_id, email)` — kiểm tra trùng lặp trong tính năng này chỉ ở tầng application.
- **Kiểm tra xung đột lịch cá nhân** cho khách mời bên ngoài.
- **Thêm khách mời vào toàn bộ recurring series** — chỉ áp dụng cho một meeting instance cụ thể được xác định bởi `meetingId`.
- **Tạo file `.ics`** đính kèm thư mời.
- **Liên kết khách mời bên ngoài với tài khoản hệ thống hoặc device_user_mappings**.

### 11.2 Có thể xem xét ở feature khác

- Feature "Update External Participant" để sửa thông tin khách mời đã thêm.
- Feature cho phép khách mời bên ngoài tự xác nhận tham dự qua link công khai (RSVP).
- Bulk import khách mời bên ngoài qua Excel, tương tự `UC-24 Import thành viên bằng Excel` của internal participant.

### 11.3 Out-of-scope EARS Guardrails

**OOS-001**: THE system SHALL NOT cho phép thêm nhiều khách mời bên ngoài trong một lần gọi API như một phần của feature này.

**OOS-002**: THE system SHALL NOT tạo bảng mới hoặc thêm cột mới vào schema database hiện tại.

**OOS-003**: THE system SHALL NOT thêm unique constraint database mới cho `meeting_external_participants` như một phần của feature này.

**OOS-004**: THE system SHALL NOT thực hiện kiểm tra xung đột lịch cá nhân cho khách mời bên ngoài.

**OOS-005**: THE system SHALL NOT cho phép cập nhật hoặc gỡ bỏ khách mời bên ngoài như một phần của feature này.

**OOS-006**: THE system SHALL NOT cho phép khách mời bên ngoài tự phản hồi lời mời (RSVP) như một phần của feature này.

---

## 12. Assumptions / Clarifications Resolved

### Assumptions

| # | Assumption | Ghi chú |
|---|---|---|
| A-01 | Email là bắt buộc đối với khách mời bên ngoài. | Mirror ràng buộc hiện có ở `ExternalParticipantDto` dùng trong `CreateMeetingDto`. |
| A-02 | Mỗi lần gọi API chỉ thêm một khách mời. | Mirror cách `add internal participant` hoạt động (một user mỗi lần). |
| A-03 | Khách mời bên ngoài tính vào tổng số người tham dự khi kiểm tra sức chứa phòng. | Đã được code hiện tại (`getAttendeeCount`) cộng cả `meeting_participants` và `meeting_external_participants`. |
| A-04 | Notification chỉ gửi qua email, không có in-app. | Khách mời bên ngoài không có user account. |
| A-05 | Notification được enqueue sau khi transaction chính commit (best-effort), không nằm trong transaction đó. | Mirror pattern thực tế đã implement ở `addInternalParticipant` trong code hiện tại. |
| A-06 | Không thêm unique constraint database cho `(meeting_id, email)` trong phạm vi tính năng này. | Giảm rủi ro thay đổi schema ngoài yêu cầu; kiểm tra trùng lặp xử lý ở tầng application. |
| A-07 | Permission `meeting.participant.add.external` là permission mới, cần seed migration riêng. | Thuộc phạm vi `/speckit.plan`, không thuộc phạm vi spec này. |

### Clarifications Resolved

| # | Vấn đề cần làm rõ | Quyết định |
|---|---|---|
| C-01 | Có cần endpoint thêm nhiều khách mời cùng lúc không? | Không trong phạm vi feature này; chỉ hỗ trợ thêm một khách mời mỗi lần gọi. |
| C-02 | Có cần kiểm tra xung đột lịch cho khách mời bên ngoài không? | Không. Khách mời bên ngoài không có lịch trong hệ thống. |
| C-03 | Khách mời bên ngoài có tính vào sức chứa phòng không? | Có. Dùng chung logic `getAttendeeCount` đã cộng cả nội bộ và bên ngoài. |
| C-04 | Có gửi notification in-app cho khách mời bên ngoài không? | Không. Chỉ gửi email vì không có user account. |
| C-05 | Permission code dùng tên gì? | `meeting.participant.add.external`, mirror naming của `meeting.participant.add.internal` đã có. |

---

## 13. Readiness Checklist

- [x] Spec đã có đầy đủ các phần chính (Feature Overview, Actors, User Stories, Functional Requirements, Non-Functional Requirements, API Contract, Data Model, Business Rules, Acceptance Criteria, Edge Cases, Out of Scope, Assumptions).
- [x] Functional Requirements viết theo EARS với keyword tiếng Anh, nội dung tiếng Việt.
- [x] Đã có đủ 5 EARS basic patterns: Ubiquitous, Event-driven, State-driven, Optional Feature (ngầm qua override), Unwanted Behavior.
- [x] Mỗi requirement có mã ID rõ ràng (32 FR).
- [x] Requirement có thể kiểm thử được (testable).
- [x] Không mô tả quá sâu implementation.
- [x] Không tự ý thêm feature ngoài phạm vi đã nêu (xem mục 11 Out of Scope).
- [x] Không tự ý thêm database table/field mới.
- [x] Error handling đã bao gồm validation, authentication, authorization, business rule, conflict, capacity warning.
- [x] Acceptance Criteria dùng Given / When / Then (13 AC).
- [x] Traceability đã liên kết AC với FR liên quan.
- [x] Out of Scope đủ rõ ràng để tránh agent tự mở rộng.
- [x] Đã có phần Assumptions ghi rõ các giả định, bao gồm việc thiếu UC chính thức trong nguồn tài liệu.
- [x] Đã bao phủ 10 edge case.
- [x] API Contract đã đề xuất rõ ràng kèm error table.
- [x] Permission mới `meeting.participant.add.external` đã được xác định, cần seed ở `/speckit.plan`.
- [x] Sẵn sàng cho bước `/speckit.plan`.
