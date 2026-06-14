# Implementation Plan: Gỡ bỏ thành viên nội bộ khỏi cuộc họp

- **Feature ID**: UC-MM-08
- **Feature Name**: Remove Internal Meeting Participant
- **Module / Domain**: Meeting Management (meetings)
- **Created Date**: 2026-06-11
- **Status**: Draft
- **Source Documents**: spec.md

---

## 1. Feature Summary

Cho phép Host/Organizer/Admin gỡ bỏ một internal participant khỏi meeting ở trạng thái `scheduled`. Thao tác này:

- Xóa record khỏi `meeting_participants` (hard delete)
- Ghi `meeting_events` với event_type `participant_removed`
- Ghi `audit_logs`
- Tạo `notifications` và enqueue `background_jobs` để gửi email async
- Chỉ áp dụng cho một meeting instance cụ thể, không cascade recurring series
- Không tạo .ics cancellation, không sync external calendar
- Không cho phép gỡ Host/Organizer (kể cả Admin)
- Không cho phép gỡ participant đang là owner của agenda items

## 2. Technical Context

- **Module**: meetings (`src/modules/meetings/`)
- **Pattern**: Controller → Service → Repository/TypeORM
- **Transaction**: Database transaction bao gồm: DELETE meeting_participants + INSERT meeting_events + INSERT audit_logs + INSERT notifications + INSERT background_jobs
- **Hard delete**: Bảng `meeting_participants` không có deleted_at, xóa vĩnh viễn
- **Lịch sử**: Ghi lại qua `meeting_events` và `audit_logs`, không dùng soft delete
- **Async notification**: `notifications` + `background_jobs` được tạo đồng bộ trong transaction, email gửi async sau

### Tech stack

| Layer | Technology |
|---|---|
| Framework | NestJS |
| ORM | TypeORM |
| Database | PostgreSQL |
| Auth | JWT + RBAC (JwtAuthGuard, PermissionsGuard) |
| Validation | class-validator, class-transformer |
| Logging | Nest Logger |
| Testing | Jest |

## 3. Scope Confirmation

### In scope

- Gỡ internal participant (bảng `meeting_participants`)
- Kiểm tra quyền: Host/Organizer của meeting, hoặc Admin có permission `meeting.participant.remove`
- Kiểm tra trạng thái: chỉ cho phép khi meeting `scheduled`
- Kiểm tra target: không phải Host/Organizer
- Kiểm tra agenda ownership: không phải owner của agenda items
- Kiểm tra recurring scope: chỉ áp dụng cho instance cụ thể
- Hard delete row + ghi lịch sử (meeting_events) + audit + notification + background_job
- Response trả về notificationId và backgroundJobId
- Transaction rollback nếu bất kỳ bước nào thất bại
- Optional reason trong request body
- Idempotent: nếu participant không còn trong meeting → 404

### Out of scope

- Transfer Host (feature riêng)
- Cancel Meeting
- Add Internal Participant
- Remove External Participant (`meeting_external_participants`)
- Update Meeting Time
- Recalculate Participant Conflict
- Direct IoT/Camera Sync Command
- Editing Attendance Records
- Notification Template Management
- Series-wide participant removal (recurring)
- .ics cancellation generation
- External calendar sync (Google Calendar, Outlook)
- Agenda owner reassignment / agenda deletion

## 4. Data Model Impact

### Tables affected

```
meeting_participants  → DELETE (hard delete)
meetings              → READ ONLY (status, organizer_id, host_id)
meeting_agendas       → READ ONLY (owner_id validation)
meeting_events        → INSERT (event_type = participant_removed)
audit_logs            → INSERT (action = remove_participant)
notifications         → INSERT (notification_type = meeting_participant_removed)
background_jobs       → INSERT (email job)
```

### No schema changes

Không thêm bảng mới, không thêm cột mới.

## 5. API / Contract Plan

### Endpoint

```
DELETE /api/v1/meetings/{meetingId}/participants/{participantUserId}
```

### Request

- **Path params**: `meetingId` (UUID), `participantUserId` (UUID)
- **Optional body**: `{ "reason": "string" }`

### Success response (200)

```json
{
  "success": true,
  "message": "Đã gỡ bỏ thành viên khỏi cuộc họp thành công",
  "data": {
    "meetingId": "uuid",
    "removedParticipantUserId": "uuid",
    "removed": true,
    "removedAt": "2026-06-11T10:00:00.000Z",
    "notificationQueued": true,
    "notificationId": "uuid",
    "backgroundJobId": "uuid"
  }
}
```

### Error mapping

| HTTP Status | Error Code | Condition |
|---|---|---|
| 400 | INVALID_UUID | meetingId hoặc participantUserId không phải UUID |
| 400 | VALIDATION_ERROR | reason > 1000 ký tự |
| 401 | UNAUTHENTICATED | Thiếu hoặc token hết hạn |
| 403 | FORBIDDEN | Không có quyền và không phải Host/Organizer |
| 404 | MEETING_NOT_FOUND | Meeting không tồn tại |
| 404 | PARTICIPANT_NOT_IN_MEETING | Participant không có trong meeting |
| 409 | MEETING_NOT_REMOVABLE | Meeting không ở trạng thái scheduled |
| 409 | CANNOT_REMOVE_HOST_OR_ORGANIZER | Target là Host hoặc Organizer |
| 409 | PARTICIPANT_OWNS_AGENDA_ITEMS | Target đang là owner của agenda items (kèm agendaItemIds) |
| 422 | RECURRING_SERIES_SCOPE_NOT_SUPPORTED | Cố gắng remove toàn bộ series |
| 500 | INTERNAL_ERROR | Lỗi server không xác định |

## 6. Authorization Plan

### Permission check flow

1. **Xác thực**: JwtAuthGuard — yêu cầu JWT token hợp lệ
2. **Phân quyền** (một trong các điều kiện sau):
   - Requester là Host của meeting (req.user.id === meetings.host_id)
   - Requester là Organizer của meeting (req.user.id === meetings.organizer_id)
   - Requester có permission `meeting.participant.remove`
3. **Từ chối nếu**: không thỏa mãn điều kiện nào → 403 Forbidden

### Additional rules

- **Host/Organizer protection**: Dù có permission, Admin vẫn KHÔNG được gỡ Host/Organizer
- **Self-removal**: Không được phép tự gỡ nếu là Host/Organizer
- **Participant thường**: Không được gỡ người khác, cũng không được tự gỡ

## 7. Business Logic Plan

### Core flow

```
1. Validate request (UUID format, body)
2. Find meeting by meetingId → 404 MEETING_NOT_FOUND
3. Check meeting.status === 'scheduled' → 409 MEETING_NOT_REMOVABLE
4. Authorization check (Host/Organizer/permission) → 403 FORBIDDEN
5. Find participant in meeting_participants → 404 PARTICIPANT_NOT_IN_MEETING
6. Check target is not Host/Organizer → 409 CANNOT_REMOVE_HOST_OR_ORGANIZER
7. Check target is not agenda owner → 409 PARTICIPANT_OWNS_AGENDA_ITEMS (+ agendaItemIds)
8. Check recurring scope (series-wide) → 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED
9. BEGIN TRANSACTION
   9a. DELETE FROM meeting_participants WHERE meeting_id = :mid AND user_id = :uid
   9b. INSERT INTO meeting_events (event_type = 'participant_removed', metadata)
   9c. INSERT INTO audit_logs (action = 'remove_participant', actor_id, target_id, details)
   9d. INSERT INTO notifications (notification_type = 'meeting_participant_removed', recipient_id)
   9e. INSERT INTO background_jobs (job_type = 'send_email')
10. COMMIT TRANSACTION
11. Return 200 with response data
```

### Edge cases

- Participant đã bị gỡ trước đó: step 5 → 404
- Concurrent remove: transaction lock → first success, second → 404
- meeting.host_id null: chỉ check organizer_id và permission
- reason > 1000 ký tự: validation pipe → 400
- Audit log best-effort: không rollback nếu audit fail

## 8. Validation Plan

### Input validation (class-validator DTO)

| Field | Rule |
|---|---|
| meetingId (path) | IsUUID('4') |
| participantUserId (path) | IsUUID('4') |
| reason (body, optional) | IsOptional(), IsString(), MaxLength(1000) |

### Business validation

| Step | Validation | Error |
|---|---|---|
| 1 | Meeting exists | 404 MEETING_NOT_FOUND |
| 2 | Meeting status = scheduled | 409 MEETING_NOT_REMOVABLE |
| 3 | Requester has permission or is Host/Organizer | 403 FORBIDDEN |
| 4 | Target participant exists in meeting | 404 PARTICIPANT_NOT_IN_MEETING |
| 5 | Target is not Host/Organizer | 409 CANNOT_REMOVE_HOST_OR_ORGANIZER |
| 6 | Target is not agenda owner | 409 PARTICIPANT_OWNS_AGENDA_ITEMS |
| 7 | Request is not series-wide removal | 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED |

## 9. Error Handling Plan

- **Transaction fail**: Rollback toàn bộ → 500 INTERNAL_ERROR
- **Notification fail (transaction OK)**: Không rollback, ghi log, retry job (NFR-009)
- **Audit fail**: Best-effort, không rollback (BR-07)

## 10. Testing Strategy

### Unit tests (Service)

| Test | Expected |
|---|---|
| remove participant happy path | Transaction success, all entities affected |
| meeting not found | 404 MEETING_NOT_FOUND |
| meeting not scheduled | 409 MEETING_NOT_REMOVABLE |
| no permission (participant) | 403 FORBIDDEN |
| no permission (not Host/Organizer) | 403 FORBIDDEN |
| participant not in meeting | 404 PARTICIPANT_NOT_IN_MEETING |
| target is Host | 409 CANNOT_REMOVE_HOST_OR_ORGANIZER |
| target is Organizer | 409 CANNOT_REMOVE_HOST_OR_ORGANIZER |
| Admin targets Host | 409 CANNOT_REMOVE_HOST_OR_ORGANIZER |
| Admin targets Organizer | 409 CANNOT_REMOVE_HOST_OR_ORGANIZER |
| target owns agenda items | 409 PARTICIPANT_OWNS_AGENDA_ITEMS (kèm agendaItemIds) |
| recurring series-wide request | 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED |
| transaction rollback | Giả lập fail → rollback, participant not removed |
| duplicate remove | 404 on second request |
| concurrent remove | First success, second → 404 |
| with reason | Reason in metadata |
| without reason | No reason in metadata |

### DTO validation tests

- invalid meetingId UUID → 400
- invalid participantUserId UUID → 400
- reason > 1000 chars → 400

### AC mapping

| AC ID | Test |
|---|---|
| AC-01 | Service: happy path |
| AC-02 | Verify participant removed from list |
| AC-03 | Verify schedule không còn meeting |
| AC-04 | Service: target Host/Organizer → 409 |
| AC-05 | Service: participant thường không quyền → 403 |
| AC-06 | Service: meeting not scheduled → 409 |
| AC-07 | Service: participant not in meeting → 404 |
| AC-08 | DTO: invalid UUID → 400 |
| AC-09 | Verify notifications + background_jobs created |
| AC-10 | Verify audit_logs created |
| AC-11 | Service: duplicate remove → 404 |
| AC-12 | Verify job fail không rollback remove |
| AC-REC-001 | Service: recurring instance-only |
| AC-REC-002 | Service: series-wide → 422 |
| AC-ICS-001 | Assert no .ics file generation |
| AC-PERM-ADMIN-001 | Service: Admin + target Host/Organizer → 409 |
| AC-AGENDA-001 | Service: agenda owner → 409 kèm agendaItemIds |

## 11. Implementation Phases

### Phase 1: DTO & Validation
- RemoveParticipantParamsDto (meetingId, participantUserId UUID)
- RemoveParticipantBodyDto (reason optional, MaxLength 1000)
- RemoveParticipantResponseDto

### Phase 2: Service Layer
- Method `removeParticipant()` trong MeetingsService
- Full validation chain + transaction + error handling

### Phase 3: Controller & Routing
- DELETE /api/v1/meetings/:meetingId/participants/:participantUserId
- JwtAuthGuard + permission check

### Phase 4: Unit Tests
- Service tests (18+ cases)
- DTO validation tests
- Controller response format tests

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Concurrent remove | Hai request success | Transaction + row lock |
| Transaction timeout | 500 error | Optimize transaction scope |
| Email fail after success | User không nhận notification | Job retry (NFR-009) |
| Audit fail (best-effort) | Mất audit record | Ghi warning log |
| meeting.host_id = null | Logic sai | Chỉ check organizer_id + permission |

## 13. Acceptance Criteria Traceability

| AC ID | Phase | Test Strategy |
|---|---|---|
| AC-01 | Phase 2 | Unit test: happy path |
| AC-02 | Phase 2 | Assert participant list after remove |
| AC-03 | Phase 2 | Assert schedule query |
| AC-04 | Phase 2 | Unit test: 409 Host/Organizer |
| AC-05 | Phase 2 | Unit test: 403 no permission |
| AC-06 | Phase 2 | Unit test: 409 wrong state |
| AC-07 | Phase 2 | Unit test: 404 not found |
| AC-08 | Phase 1 | DTO test: 400 invalid UUID |
| AC-09 | Phase 2 | Assert notification + job created |
| AC-10 | Phase 2 | Assert audit_log created |
| AC-11 | Phase 2 | Unit test: duplicate → 404 |
| AC-12 | Phase 2 | Unit test: job fail, remove preserved |
| AC-REC-001 | Phase 2 | Unit test: instance-only scope |
| AC-REC-002 | Phase 2 | Unit test: series-wide → 422 |
| AC-ICS-001 | Phase 2 | Assert no .ics generated |
| AC-PERM-ADMIN-001 | Phase 2 | Unit test: Admin + Host/Organizer → 409 |
| AC-AGENDA-001 | Phase 2 | Unit test: agenda owner → 409 + agendaItemIds |