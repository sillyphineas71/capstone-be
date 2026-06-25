# Quickstart: Add External Meeting Participant

- **Feature ID**: MEET-ADD-EXTERNAL-PARTICIPANT-001
- **Target**: `POST /api/v1/meetings/{meetingId}/participants/external`

---

## Test Scenarios

### Happy Path

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Organizer thêm khách mời bên ngoài | 1. Tạo meeting (scheduled)<br>2. POST với `fullName`+`email` hợp lệ, auth Organizer | 201, participant tạo, meeting_event + audit_log created |
| 2 | Host thêm khách mời bên ngoài | Như #1 nhưng auth Host | 201 |
| 3 | Meeting Manager (có permission) thêm vào meeting không phải private | Như #1 nhưng auth Manager có `meeting.participant.add.external`, meeting `visibility_level='internal'` | 201 |
| 4 | Thêm kèm organizationName + phoneNumber | Body đầy đủ 4 field | 201, cả 4 field được lưu đúng |
| 5 | Thêm vào meeting đang `in_progress` | Start meeting trước, sau đó POST | 201 (vẫn cho phép) |
| 6 | Thêm vào meeting `private`, auth Organizer | Set `visibility_level='private'`, auth Organizer | 201 |
| 7 | Thêm vào meeting `private`, auth Admin (admin.all) | Set `visibility_level='private'`, auth Admin không phải Organizer/Host | 201 |

### Authorization Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 8 | Unauthenticated | POST không có JWT | 401 UNAUTHENTICATED |
| 9 | Manager không có permission, meeting thường | Auth Manager không có `meeting.participant.add.external`, không là Organizer/Host | 403 FORBIDDEN |
| 10 | Manager có permission nhưng meeting `private` | Auth Manager có permission, meeting `private`, không là Organizer/Host | 403 FORBIDDEN_ACCESS |

### Validation Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 11 | Thiếu fullName | Body không có `fullName` | 400 VALIDATION_ERROR |
| 12 | fullName chỉ có khoảng trắng | `fullName: "   "` | 400 VALIDATION_ERROR |
| 13 | Email sai định dạng | `email: "not-an-email"` | 400 VALIDATION_ERROR |
| 14 | Thiếu email | Body không có `email` | 400 VALIDATION_ERROR |
| 15 | meetingId không phải UUID | POST tới `/meetings/abc/participants/external` | 400 Bad Request |
| 16 | Meeting không tồn tại | POST với UUID hợp lệ nhưng không có meeting | 404 MEETING_NOT_FOUND |

### State Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 17 | Meeting `draft` | Meeting chưa submit | 400 INVALID_MEETING_STATUS |
| 18 | Meeting `pending_approval` | Meeting đang chờ duyệt | 400 INVALID_MEETING_STATUS |
| 19 | Meeting `completed` | Meeting đã kết thúc | 400 INVALID_MEETING_STATUS |
| 20 | Meeting `cancelled` | Meeting đã hủy | 400 INVALID_MEETING_STATUS |

### Duplicate Email

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 21 | Email trùng chính xác | Thêm 2 lần cùng email | Lần 1: 201, Lần 2: 409 EXTERNAL_PARTICIPANT_ALREADY_EXISTS |
| 22 | Email trùng khác hoa/thường | Thêm `a@x.com` rồi `A@X.com` | Lần 2: 409 |
| 23 | Cùng email, 2 meeting khác nhau | Thêm cùng email vào meeting A và meeting B | Cả 2 đều 201 |

### Capacity Warning Flow

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 24 | Phòng đầy, policy=warning, lần gọi đầu (không token) | Room capacity=10, đã có 10 attendee, POST thêm 1 | 422 WARNING_CONFIRMATION_REQUIRED + warningToken |
| 25 | Phòng đầy, policy=warning, override hợp lệ + có quyền | Gửi lại với `overrideWarnings=true` + `warningToken`, actor có `meeting.participant.override_capacity` | 201 |
| 26 | Phòng đầy, policy=warning, override + KHÔNG có quyền | Như #25 nhưng actor không có quyền override | 422 ROOM_CAPACITY_EXCEEDED |
| 27 | Phòng đầy, policy=block | Set system_configs `meeting.capacity_policy=block` | 422 ROOM_CAPACITY_EXCEEDED ngay từ lần gọi đầu |
| 28 | warningToken không hợp lệ/hết hạn | Gửi token giả hoặc token đã hết hạn (>5 phút) | 400 INVALID_WARNING_TOKEN |
| 29 | warningToken hợp lệ nhưng dùng cho meeting/email khác | Token sinh cho meeting A nhưng gọi với meeting B | 400 INVALID_WARNING_TOKEN |
| 30 | Meeting không có room_id | `meeting.roomId = null`, phòng đầy không áp dụng | 201, không có warning |
| 31 | Tổng số người đúng bằng capacity (không vượt) | attendeeCount + 1 == room.capacity | 201, không có warning |

### Concurrency & Notification

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 32 | Hai request đồng thời cùng email | Gửi 2 POST cùng email, cùng meeting, gần như đồng thời | 1 request 201, request còn lại 409 (không phải 500) |
| 33 | Email enqueue thất bại sau commit | Mock `enqueueEmailNotification` throw error | Participant vẫn được tạo (201), lỗi được log, không rollback |
| 34 | Kiểm tra không có in-app notification | Sau khi add thành công | `notifications` không có record nào với `channel='in_app'` cho external participant này |

## Verification Notes

- [ ] Check `meeting_external_participants` có bản ghi mới với `participant_role='attendee'`, `invitation_status='pending'`
- [ ] Check `meeting_events` có record `event_type='external_participant_added'`
- [ ] Check `audit_logs` có record `action_type='add_external_participant'`
- [ ] Check `notifications` có record `notification_type='meeting_invite'`, `channel='email'`, `to_emails` chứa đúng email
- [ ] Check **không có** notification nào `channel='in_app'` cho external participant
- [ ] Check `getAttendeeCount()` sau khi thêm phản ánh đúng tổng (internal + external)
- [ ] Check response trả đủ `externalParticipantId`, `meetingId`, `fullName`, `email`, `organizationName`, `phoneNumber`, `role`, `status`
- [ ] Check seed permission `meeting.participant.add.external` đã được gán cho role phù hợp trước khi test Manager flow
- [ ] Check `warningToken` hết hạn sau 300 giây (TTL của `WarningTokenUtil`)
- [ ] Verify transaction rollback nếu insert audit_log thất bại (participant không được tạo)
