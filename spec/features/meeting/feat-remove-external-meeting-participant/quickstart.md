# Quickstart: Remove External Meeting Participant

- **Feature ID**: MEET-REMOVE-EXTERNAL-PARTICIPANT-001
- **Target**: `DELETE /api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}`

---

## Test Scenarios

### Happy Path

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Organizer gỡ khách mời bên ngoài (có email) | 1. Tạo meeting (scheduled)<br>2. Thêm external participant với email<br>3. DELETE với auth Organizer | 200 OK, row deleted, event/audit/notification/job created |
| 2 | Host gỡ khách mời bên ngoài | Như #1 nhưng auth Host | 200 OK |
| 3 | Manager (có permission `meeting.participant.remove.external`) gỡ | Như #1 nhưng auth Manager | 200 OK |
| 4 | Gỡ khách mời không có email | Thêm external participant với `email=null` (nếu DTO add cho phép, hoặc seed trực tiếp), sau đó DELETE | 200 OK, `notificationQueued=false`, `notificationId=null`, `backgroundJobId=null` |
| 5 | Gỡ kèm optional reason | Body `{ "reason": "Khách hàng báo bận" }` | 200 OK, reason lưu trong event metadata + audit_log |

### Authorization Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 6 | Unauthenticated | DELETE không có JWT | 401 UNAUTHENTICATED |
| 7 | Không có quyền, không phải Host/Organizer | Auth user khác | 403 FORBIDDEN |

### Validation Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 8 | meetingId không phải UUID | DELETE với `meetingId="not-a-uuid"` | 400 INVALID_UUID |
| 9 | externalParticipantId không phải UUID | DELETE với `externalParticipantId="not-a-uuid"` | 400 INVALID_UUID |
| 10 | reason > 1000 ký tự | Body có reason quá dài | 400 VALIDATION_ERROR |
| 11 | Meeting không tồn tại | DELETE với meetingId UUID hợp lệ nhưng không tồn tại | 404 MEETING_NOT_FOUND |
| 12 | externalParticipantId không thuộc meeting này | DELETE với id hợp lệ nhưng thuộc meeting khác | 404 EXTERNAL_PARTICIPANT_NOT_IN_MEETING |
| 13 | externalParticipantId không tồn tại | DELETE với UUID ngẫu nhiên | 404 EXTERNAL_PARTICIPANT_NOT_IN_MEETING |

### State Errors

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 14 | Meeting `in_progress` | Start meeting trước, sau đó DELETE | 409 MEETING_NOT_REMOVABLE |
| 15 | Meeting `completed` | Complete meeting, sau đó DELETE | 409 MEETING_NOT_REMOVABLE |
| 16 | Meeting `cancelled` | Cancel meeting, sau đó DELETE | 409 MEETING_NOT_REMOVABLE |

### Recurring Scope

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 17 | Gỡ khỏi một occurrence | Meeting là 1 instance trong recurring series, DELETE bình thường (scope omitted hoặc `instance`) | 200 OK, chỉ occurrence đó bị ảnh hưởng |
| 18 | Yêu cầu gỡ toàn bộ series | Body `{ "scope": "series" }` | 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED |

### Concurrency & Idempotency

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 19 | Gỡ lặp lại | DELETE 2 lần cùng `externalParticipantId` | Lần 1: 200, Lần 2: 404 EXTERNAL_PARTICIPANT_NOT_IN_MEETING |
| 20 | Gỡ đồng thời (concurrent) | Gửi 2 DELETE request cùng lúc cho cùng `externalParticipantId` | 1 request 200, request còn lại 404 (không phải 500) |

### Notification Edge Cases

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 21 | Email enqueue thất bại sau commit | Mock `enqueueEmailNotification` throw error | Row vẫn bị xóa (200), lỗi được log, không rollback |
| 22 | Email null, không gọi notification service | Kiểm tra notification service không được gọi khi `target.email === null` | Không có lời gọi `enqueueEmailNotification`, không có exception |

## Verification Notes

- [ ] Check `meeting_external_participants` không còn row với `id = externalParticipantId` (hard delete, không phải soft delete)
- [ ] Check `meeting_events` có record `event_type='external_participant_removed'` với `metadata_json` chứa `removedExternalParticipantId`
- [ ] Check `audit_logs` có record `action_type='remove_external_participant'`
- [ ] Check `notifications`/`background_jobs` có record nếu target có email; **không có** record nào nếu email null
- [ ] Check response `notificationQueued` đúng giá trị (`true` khi có email, `false` khi không)
- [ ] Check meeting khác/occurrence khác trong recurring series không bị ảnh hưởng
- [ ] Verify **không** có bước kiểm tra Host/Organizer protection nào chạy (vì target không thể là Host/Organizer)
- [ ] Verify **không** có query nào tới `meeting_agendas` trong flow này
- [ ] Verify transaction rollback nếu insert audit_log thất bại (row vẫn còn trong DB)
- [ ] Check route mới `/api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}` không trùng/nhầm với route remove internal participant hiện tại (`/api/v1/{meetingId}/participants/{participantUserId}`, không có prefix `/meetings/`)
