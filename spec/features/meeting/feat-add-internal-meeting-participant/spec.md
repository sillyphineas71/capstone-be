# Feature Specification: Thêm thành viên nội bộ cuộc họp thủ công

- **Feature ID**: MEET-ADD-PARTICIPANT-001
- **Feature Name**: Thêm thành viên nội bộ cuộc họp thủ công (Manual Add Internal Participant)
- **Module / Domain**: meetings
- **Created Date**: 2026-06-09
- **Status**: Draft
- **Source Documents**:
  - UC-MM-06 Thêm thành viên nội bộ cuộc họp thủ công
  - Database v3.2 Compact (39 Tables)

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Khởi tạo spec cho tính năng thêm thành viên nội bộ | Toàn bộ file |
| 2026-06-09 | Cập nhật luồng override 2 bước, giới hạn quyền họp Private, xử lý race condition, giới hạn sức chứa | Toàn bộ file |

---

## 1. Context & Goal

### 1.1 Bối cảnh
Trong quá trình vận hành cuộc họp, người tổ chức (Organizer) hoặc người chủ trì (Host) có thể cần bổ sung nhân sự nội bộ vào danh sách tham gia sau khi cuộc họp đã được lên lịch hoặc thậm chí khi đang diễn ra. Việc này giúp đảm bảo tính linh hoạt khi phát sinh nhu cầu chuyên môn đột xuất hoặc thay đổi nhân sự.

### 1.2 Mục tiêu
Mục tiêu của tính năng này là cho phép Internal Employee giữ vai trò Organizer/Host hoặc Manager có quyền quản lý cuộc họp thực hiện tìm kiếm và thêm nhân viên nội bộ vào danh sách `meeting_participants` của một cuộc họp cụ thể. 

### 1.3 Giá trị mang lại
- **Sự linh hoạt**: Cho phép cập nhật danh sách người tham gia bất cứ lúc nào trong vòng đời "scheduled" hoặc "in_progress" của cuộc họp.
- **Tính chính xác**: Đảm bảo dữ liệu điểm danh và thông báo được gửi đúng tới các nhân sự mới được bổ sung.
- **Kiểm soát**: Quản lý được ai là người đã mời thêm thành viên thông qua trường `invited_by` và nhật ký kiểm toán.

### 1.4 Giả định
- Hệ thống đã có danh sách nhân viên nội bộ trong bảng `users`.
- Người thao tác đã được xác thực và có quyền quản lý cuộc họp liên quan.
- Dịch vụ gửi thông báo qua email/in-app hoạt động thông qua bảng `notifications` và `background_jobs`.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Organizer / Host | Người tạo/chủ trì cuộc họp | Có quyền thêm thành viên vào cuộc họp mình quản lý (kể cả Private). Không được phép override giới hạn sức chứa phòng vật lý. |
| Meeting Manager | Quản lý có quyền `meetings.manage` | Có quyền quản lý thành viên cho các cuộc họp thông thường thuộc phạm vi quản lý. **Không** được thêm người vào cuộc họp Private/Confidential trừ khi là Organizer/Host. |
| Admin / Room Manager | Quản trị viên hệ thống hoặc Quản lý cơ sở vật chất | Có quyền `meeting.participant.override_capacity` để ghi đè sức chứa phòng nếu policy cho phép. Có quyền thêm thành viên vào cả họp Private. |

### 2.2 Role & Permission Rules
- Phải có quyền `meetings.update` hoặc là `organizer_id`/`host_id` của cuộc họp.
- Phải là `Internal Employee` (dựa trên `user_type` hoặc role liên quan).
- **Private Meeting**: Với meeting có `visibility_level='private'`, chỉ `organizer_id`, `host_id`, hoặc actor có quyền đặc biệt cấp hệ thống (Admin) mới được thêm internal participant. Meeting Manager thông thường không được thêm.
- **Capacity Override**: Chỉ Admin/Facility/Room Manager có permission `meeting.participant.override_capacity` mới được override sức chứa vật lý.

### 2.3 Actor Constraints
- Actor phải đang ở trạng thái `active`.
- Actor phải được xác thực (Authenticated).

---

## 2.4 User Scenarios & Workflow

### 2.4.1 Preconditions (Tiền điều kiện)
- Cuộc họp tồn tại trong hệ thống.
- Cuộc họp đang ở trạng thái `scheduled` hoặc `in_progress`.
- User được mời phải tồn tại trong bảng `users` và có trạng thái `active`.

### 2.4.2 Postconditions (Hậu điều kiện)
- Bản ghi mới được tạo trong `meeting_participants`.
- Một bản ghi thông báo được tạo trong `notifications` và job tương ứng trong `background_jobs`.
- Một bản ghi nhật ký được tạo trong `audit_logs`.
- Nếu cuộc họp đang diễn ra (`in_progress`), hệ thống emit event bất đồng bộ để thiết bị IoT (nếu có) tự đồng bộ.

### 2.4.3 Normal Flow (Luồng chuẩn và luồng 2 bước override)
1. Actor chọn một cuộc họp cụ thể và tìm kiếm nhân viên nội bộ cần thêm.
2. Hệ thống kiểm tra: quyền truy cập, trạng thái meeting, trạng thái user và sự tồn tại trong danh sách.
3. Hệ thống thực hiện pre-check validations (Sức chứa phòng và Xung đột lịch):
   - **Trường hợp có Warning**: Hệ thống trả về lỗi `422 WARNING_CONFIRMATION_REQUIRED` kèm `warningToken` và danh sách các cảnh báo (ví dụ: conflict lịch). Không cho phép bypass ở lần gọi này.
   - Actor xác nhận cảnh báo trên giao diện và gọi lại API với `overrideWarnings=true` kèm `warningToken`.
4. Hệ thống kiểm tra xác thực của `warningToken` và kiểm tra quyền override (ví dụ: nếu có warning về Room Capacity, kiểm tra xem Actor có quyền `meeting.participant.override_capacity` hay không, và global policy `meeting.capacity_policy` có phải là `warning` hay không. Nếu `block`, trả lỗi hard block).
5. Nếu hợp lệ, hệ thống:
   - Lưu bản ghi vào `meeting_participants` với `participant_role='attendee'`, `invitation_status='pending'`, `attendance_required=true`, `is_required=true`, `invited_by=[Actor.id]`.
   - Tạo bản ghi trong `notifications` và `background_jobs` để gửi email mời họp (Bất đồng bộ). Trạng thái email sẽ track qua `notifications`, không sửa lại `invitation_status` thành fail nếu gửi mail fail.
   - Nếu họp đang `in_progress`, hệ thống emit event (realtime/WebSocket/job) để thông báo cập nhật thiết bị (Best-effort, nếu thiết bị lỗi cũng không rollback bản ghi DB).
   - Ghi audit log.
6. Hệ thống thông báo thành công.

---

## 3. Functional Requirements

### 3.1 Core Requirements
- **FR-001**: THE system SHALL cho phép tìm kiếm nhân sự nội bộ dựa trên các trường thông tin hợp lệ từ bảng `users`.
- **FR-002**: THE system SHALL lưu lại `invited_by` là ID của người thực hiện thao tác khi thêm thành viên mới vào `meeting_participants`.
- **FR-003**: THE system SHALL gán giá trị mặc định cho thành viên mới: `participant_role='attendee'`, `invitation_status='pending'`, `attendance_required=true`, `is_required=true`.

### 3.2 Authorization & Privacy Requirements
- **FR-004**: IF meeting có `visibility_level='private'`, THE system SHALL chỉ cho phép `organizer_id`, `host_id`, hoặc Admin hệ thống thêm người; từ chối các Meeting Manager thông thường.

### 3.3 Event-driven & Async Requirements
- **FR-005**: WHEN thành viên được thêm thành công, THE system SHALL tạo tác vụ gửi thông báo qua bảng `notifications` và `background_jobs` một cách bất đồng bộ. Việc gửi mail thất bại không làm thay đổi trạng thái `invitation_status` trong `meeting_participants`.
- **FR-006**: WHEN thao tác thêm thành viên hoàn tất, THE system SHALL ghi `audit_logs` bao gồm Actor, hành động "ADD_PARTICIPANT", và ID của thành viên được mời.
- **FR-007**: IF meeting đang ở trạng thái `in_progress`, THE system SHALL phát ra event (realtime application event/WebSocket) và enqueue background job (best-effort) để đồng bộ quyền mở cửa (Access Control/Face Terminal), và THE system SHALL NOT rollback thao tác thêm thành viên nếu đồng bộ thiết bị thất bại.

### 3.4 State-driven & Validation Requirements
- **FR-008**: WHILE cuộc họp đang ở trạng thái `scheduled` hoặc `in_progress`, THE system SHALL cho phép thực hiện tính năng thêm thành viên.
- **FR-009**: WHEN nhận request thêm thành viên LẦN ĐẦU mà có xung đột lịch hoặc quá sức chứa (dạng warning), THE system SHALL chặn luồng và trả về mã lỗi đặc biệt kèm `warningToken`. Client không được phép tự động bypass cảnh báo nếu không có `warningToken` hợp lệ.
- **FR-010**: WHEN client gửi lại request kèm `warningToken` hợp lệ và cờ `overrideWarnings=true`, THE system SHALL chấp nhận bỏ qua các soft warning đã được xác nhận.
- **FR-011**: WHEN kiểm tra sức chứa phòng, THE system SHALL đọc cấu hình global `meeting.capacity_policy` từ bảng `system_configs`.

### 3.5 Unwanted Behavior Requirements (Errors & Concurrency)
- **FR-012**: IF policy sức chứa là 'block', OR (policy là 'warning' nhưng Actor không có quyền `meeting.participant.override_capacity`), THEN THE system SHALL từ chối thao tác vượt sức chứa phòng và trả về lỗi hard block.
- **FR-013**: IF xảy ra Race condition (hai request cùng lúc thêm một user), THE system SHALL kết hợp pre-check ở tầng service và unique constraint `(meeting_id, user_id)` ở tầng database để ngăn chặn duplicate, và THE system SHALL trả về HTTP 409 thay vì lỗi hệ thống 500.

---

## 4. Non-functional Requirements

- **NFR-001**: THE system SHALL hoàn tất việc tạo bản ghi và phản hồi cho Actor trong vòng dưới 2 giây.
- **NFR-002**: THE system SHALL đảm bảo tính nhất quán dữ liệu (Atomic transaction) khi lưu `meeting_participants`, `notifications`, `background_jobs` và `audit_logs`.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `meetings` | Chứa thông tin cuộc họp, trạng thái, và mức độ bảo mật. | Kiểm tra status, room_id, visibility_level. |
| `users` | Chứa thông tin nhân viên nội bộ để thêm. | Cần kiểm tra account_status. |
| `meeting_participants` | Lưu thông tin thành viên tham gia cuộc họp. | Thêm bản ghi mới (mặc định pending, attendee). Unique constraint `(meeting_id, user_id)`. |
| `rooms` | Chứa thông tin sức chứa (capacity). | Dùng để kiểm tra giới hạn phòng. KHÔNG thêm cột mới. |
| `notifications` | Lưu nội dung và trạng thái gửi thông báo. | Quản lý delivery status, failure reason. |
| `background_jobs` | Quản lý tác vụ gửi email và đồng bộ thiết bị. | Bất đồng bộ. |
| `audit_logs` | Lưu nhật ký thao tác. | Ghi nhận hành động thêm thành viên. |
| `system_configs` | Lưu cấu hình chính sách hệ thống global. | Key `meeting.capacity_policy`. |

### 5.2 Business Rules Impact
- **Không tự động chuyển trạng thái fail trong participant**: Track email qua `notifications`.
- **Database Constraint**: `meeting_participants` phải có unique index trên `(meeting_id, user_id)`.

---

## 6. Error Handling & Validation Rules

### 6.1 Validation Rules & HTTP Status Codes
| Rule / Error Case | HTTP Status | Mã lỗi | Ghi chú |
|---|---|---|---|
| Xung đột lịch hoặc warning sức chứa ở lần gọi đầu | 422 | `WARNING_CONFIRMATION_REQUIRED` | Phải trả về `warningToken` và danh sách warning. |
| Không cung cấp hoặc sai `warningToken` khi gửi override | 400 | `INVALID_WARNING_TOKEN` | Yêu cầu làm đúng luồng 2 bước. |
| Người dùng không có quyền quản lý, hoặc cố thêm vào họp Private | 403 | `FORBIDDEN_ACCESS` | Chặn truy cập không được phép. |
| Vượt sức chứa (Block policy) hoặc không có quyền override | 422 | `ROOM_CAPACITY_EXCEEDED` | Hard block. |
| Race condition hoặc add lại user đã có | 409 | `PARTICIPANT_ALREADY_EXISTS` | Bắt từ pre-check hoặc DB unique constraint. |
| Cuộc họp không ở trạng thái `scheduled` hoặc `in_progress` | 400 | `INVALID_MEETING_STATUS` | |

---

## 7. API Contract (Proposed)

### Endpoint: POST `/api/v1/meetings/:meetingId/participants/internal`

**Request Body (Lần gọi đầu hoặc đã có token)**:
```json
{
  "userId": "uuid-of-invited-user",
  "overrideWarnings": true,
  "warningToken": "token-received-from-previous-422-response" // Tuỳ chọn ở lần gọi đầu
}
```

**Response (422 Warning Required - Khi phát hiện soft warning lần đầu)**:
```json
{
  "success": false,
  "error": {
    "code": "WARNING_CONFIRMATION_REQUIRED",
    "message": "Phát hiện xung đột lịch hoặc cảnh báo. Vui lòng xác nhận.",
    "details": {
      "warningToken": "jwt-or-opaque-token-valid-for-5-mins",
      "warnings": [
        { "type": "SCHEDULE_CONFLICT", "message": "User A đang có họp trùng giờ." }
      ]
    }
  }
}
```

**Response (Success 201 - Mặc định thành công)**:
```json
{
  "success": true,
  "data": {
    "participantId": "uuid-of-new-participant",
    "meetingId": "uuid-of-meeting",
    "userId": "uuid-of-user",
    "role": "attendee",
    "status": "pending"
  }
}
```

---

## 8. Acceptance Criteria

### 8.1 Luồng Warning 2 Bước (2-step confirmation)
- **AC-001**: Given Organizer thêm một user có xung đột lịch. Khi gửi request lần đầu, hệ thống trả về 422 kèm `warningToken`. Khi Organizer gửi lại request có `overrideWarnings=true` kèm `warningToken` hợp lệ, bản ghi mới được thêm thành công.
- **AC-002**: Given Organizer thêm một user có xung đột lịch. Khi gửi request lần đầu có sẵn `overrideWarnings=true` nhưng KHÔNG CÓ `warningToken`, hệ thống vẫn trả về 422 và từ chối bypass cảnh báo.

### 8.2 Họp Private & Phân quyền
- **AC-003**: Given cuộc họp là `private`, khi một Meeting Manager (không phải Organizer/Host) cố gắng thêm người, hệ thống trả lỗi 403 `FORBIDDEN_ACCESS`.
- **AC-004**: Given cuộc họp là `private`, khi Organizer thực hiện thêm người hợp lệ, bản ghi được tạo thành công.

### 8.3 Sức chứa phòng
- **AC-005**: Given phòng họp đã đầy, policy `meeting.capacity_policy` là `warning`, và người dùng là Admin có quyền override. Khi xác nhận override 2 bước, bản ghi được tạo thành công.
- **AC-006**: Given phòng họp đã đầy, policy là `warning` nhưng người dùng là Organizer thông thường không có quyền override. Hệ thống sẽ trả lỗi `ROOM_CAPACITY_EXCEEDED` (hoạt động như block).
- **AC-007**: Given policy `meeting.capacity_policy` là `block`. Dù Admin có quyền override hay không, hệ thống trả lỗi `ROOM_CAPACITY_EXCEEDED` ngay lập tức.

### 8.4 Race Condition
- **AC-008**: Given 2 request cùng lúc thêm cùng 1 `userId` vào cùng `meetingId`. Hệ thống đảm bảo chỉ 1 request thành công (201), request còn lại bị bắt bởi Unique Constraint hoặc Pre-check và trả lời 409 `PARTICIPANT_ALREADY_EXISTS`, không bị lỗi server 500.

---

## 9. Out of Scope

- Không cấu hình Room-specific capacity policy. Chỉ dùng Global Config.
- Với meeting `in_progress`, hệ thống chỉ emit event application (best-effort) để đồng bộ. Việc gọi đồng bộ trực tiếp xuống thiết bị cứng Door Face Attendance Terminal hoặc Access Control để chờ phản hồi mở cửa vật lý là ngoài phạm vi của backend core flow (thuộc về service tích hợp IoT xử lý riêng rẽ).
- Thêm thành viên bên ngoài (External Participants).
- Tự động thay đổi vai trò (Role) của thành viên sau khi thêm (luôn mặc định là `attendee`).
- Gửi thông báo SMS hoặc các kênh khác ngoài Email/In-app được định nghĩa trong background jobs hiện tại.

---

## 10. Assumptions
- Giao diện Client sẽ lưu tạm `warningToken` từ response lỗi 422 để gửi lại trong request tiếp theo. Token này có thể là JWT ký ngắn hạn chứa thông tin `meetingId` và `userId` để chống giả mạo.
