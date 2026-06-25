| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-25 | Khởi tạo plan cho tính năng gỡ bỏ khách mời bên ngoài khỏi cuộc họp | Toàn bộ file |

# Implementation Plan: Gỡ bỏ khách mời bên ngoài khỏi cuộc họp

- **Feature ID**: MEET-REMOVE-EXTERNAL-PARTICIPANT-001
- **Feature Name**: Remove External Meeting Participant
- **Module / Domain**: Meeting Management (meetings)
- **Created Date**: 2026-06-25
- **Status**: Draft
- **Source Documents**: spec.md

---

## 1. Feature Summary

Cho phép Organizer/Host (luôn được phép) hoặc actor có quyền `meeting.participant.remove.external` gỡ một khách mời bên ngoài khỏi meeting ở trạng thái `scheduled`. Thao tác này:

- Xóa (hard delete) record khỏi `meeting_external_participants`
- Ghi `meeting_events` (event_type mới `external_participant_removed`) và `audit_logs` trong cùng transaction
- **Không cần** logic bảo vệ Host/Organizer (khách mời ngoài không thể giữ vai trò đó) và **không cần** kiểm tra agenda-owner (khách mời ngoài không thể sở hữu agenda item) — đơn giản hơn đáng kể so với luồng remove internal participant
- Gửi email thông báo (best-effort, post-transaction) nếu bản ghi có email; bỏ qua an toàn nếu `email IS NULL`
- Chỉ áp dụng cho một meeting instance cụ thể, không cascade recurring series

## 2. Technical Context

- **Module**: meetings (`src/modules/meetings/`)
- **Pattern**: Controller → Service → TypeORM Repository/EntityManager, mirror đúng layering của `removeParticipant()` (internal) hiện có ([meetings.service.ts:3064](../../../../src/modules/meetings/services/meetings.service.ts:3064))
- **Transaction**: DB transaction bao gồm: DELETE meeting_external_participants + INSERT meeting_events + INSERT audit_logs. Notification chạy **sau** transaction, best-effort — mirror đúng pattern thực tế của `removeParticipant()` (internal) đã implement trong code (KHÔNG phải pattern lý thuyết ghi trong `feat-remove-internal-meeting-participant/spec.md` cũ là "notification trong cùng transaction" — code thực tế làm post-transaction).
- **Hard delete**: `meeting_external_participants` không có `deleted_at`, xóa vĩnh viễn
- **Lịch sử**: Ghi qua `meeting_events`/`audit_logs`, không dùng soft delete
- **Permission mới**: `meeting.participant.remove.external` — cần seed migration mới (mirror `20260611000001-SeedRemoveParticipantPermissions.ts`)
- **Enum mới (app-level, không migration)**: `MeetingEventType.EXTERNAL_PARTICIPANT_REMOVED = 'external_participant_removed'`

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

- Gỡ một khách mời bên ngoài (bảng `meeting_external_participants`)
- Kiểm tra quyền: Organizer/Host của meeting, hoặc actor có permission `meeting.participant.remove.external`
- Kiểm tra trạng thái: chỉ cho phép khi meeting `scheduled`
- Kiểm tra target: `externalParticipantId` phải thuộc đúng `meetingId`
- **Không** kiểm tra Host/Organizer protection (không applicable cho external)
- **Không** kiểm tra agenda ownership (không applicable cho external)
- Kiểm tra recurring scope: chỉ áp dụng cho instance cụ thể, từ chối `scope='series'`
- Hard delete row + ghi lịch sử (meeting_events) + audit_log
- Gửi email thông báo (best-effort) nếu có email; bỏ qua an toàn nếu không có
- Response trả về `notificationQueued`, `notificationId`/`backgroundJobId` (null nếu không có email)
- Transaction rollback nếu bất kỳ bước core nào thất bại
- Optional `reason` trong request body
- Idempotent: nếu participant không còn trong meeting → 404

### Out of scope

- Gỡ thành viên nội bộ (đã có feature riêng)
- Thêm khách mời bên ngoài (`feat-add-external-meeting-participant`)
- Cập nhật thông tin khách mời bên ngoài trước khi gỡ
- Thay đổi `participant_role`
- Gỡ khỏi toàn bộ recurring series
- .ics cancellation generation
- External calendar sync
- Khôi phục (undo/restore) khách mời đã gỡ

## 4. Data Model Impact

### Tables affected

```
meeting_external_participants → DELETE (hard delete)
meetings                      → READ ONLY (status, organizer_id, host_id)
meeting_events                → INSERT (event_type = external_participant_removed)
audit_logs                    → INSERT (action = remove_external_participant)
notifications                 → INSERT, có điều kiện (chỉ khi email không null)
background_jobs               → INSERT, có điều kiện (chỉ khi email không null)
```

### No schema changes

Không thêm bảng mới, không thêm cột mới. Chỉ cần:
- 1 permission mới: `meeting.participant.remove.external` (seed)
- 1 giá trị enum ứng dụng mới: `MeetingEventType.EXTERNAL_PARTICIPANT_REMOVED` (cột `varchar(60)`, không cần migration)
- Tái sử dụng `NotificationType.MEETING_PARTICIPANT_REMOVED` đã có sẵn (dùng chung với luồng remove internal)

## 5. API / Contract Plan

### Endpoint

```
DELETE /api/v1/meetings/{meetingId}/participants/external/{externalParticipantId}
```

### Request

- **Path params**: `meetingId` (UUID), `externalParticipantId` (UUID)
- **Optional body**: `{ "reason"?: string, "scope"?: "instance" }`

### Success response (200)

```json
{
  "success": true,
  "message": "Đã gỡ bỏ khách mời bên ngoài khỏi cuộc họp thành công",
  "data": {
    "meetingId": "uuid",
    "removedExternalParticipantId": "uuid",
    "removed": true,
    "removedAt": "2026-06-25T10:00:00.000Z",
    "notificationQueued": true,
    "notificationId": "uuid",
    "backgroundJobId": "uuid"
  }
}
```

### Error mapping

| HTTP Status | Error Code | Condition |
|---|---|---|
| 400 | INVALID_UUID | `meetingId` hoặc `externalParticipantId` không phải UUID |
| 400 | VALIDATION_ERROR | `reason` > 1000 ký tự |
| 401 | UNAUTHENTICATED | Thiếu hoặc token hết hạn |
| 403 | FORBIDDEN | Không có quyền và không phải Organizer/Host |
| 404 | MEETING_NOT_FOUND | Meeting không tồn tại |
| 404 | EXTERNAL_PARTICIPANT_NOT_IN_MEETING | Participant không có trong meeting đó |
| 409 | MEETING_NOT_REMOVABLE | Meeting không ở trạng thái `scheduled` |
| 422 | RECURRING_SERIES_SCOPE_NOT_SUPPORTED | Cố gắng gỡ toàn bộ series |
| 500 | INTERNAL_ERROR | Lỗi server không xác định |

## 6. Authorization Plan

### Permission check flow

1. **Xác thực**: `JwtAuthGuard` — yêu cầu JWT token hợp lệ
2. **Phân quyền** (một trong các điều kiện sau):
   - Requester là Host của meeting (`meeting.hostId === userId`)
   - Requester là Organizer của meeting (`meeting.organizerId === userId`)
   - Requester có permission `meeting.participant.remove.external`
3. **Từ chối nếu**: không thỏa mãn điều kiện nào → 403 Forbidden

### Additional rules — khác biệt rõ ràng so với remove internal participant

- **Không** áp dụng rule "Host/Organizer protection" — vì target (`meeting_external_participants` row) không thể là Host/Organizer; bỏ hẳn bước check này khỏi flow (xem mục 7).
- **Không** áp dụng rule giới hạn theo `visibility_level='private'` — mirror đúng hành vi hiện có của `removeParticipant()` (internal), nơi cũng không kiểm tra visibility.

## 7. Business Logic Plan

### Core flow

```
1. Validate request (UUID format meetingId + externalParticipantId, body)
2. Find meeting by meetingId → 404 MEETING_NOT_FOUND (kể cả khi deleted_at != null)
3. Check meeting.status === 'scheduled' → 409 MEETING_NOT_REMOVABLE
4. Authorization check (Host/Organizer/permission) → 403 FORBIDDEN
5. Find target trong meeting_external_participants WHERE meeting_id = :mid AND id = :externalParticipantId
   → 404 EXTERNAL_PARTICIPANT_NOT_IN_MEETING nếu không tồn tại (kể cả khi id tồn tại nhưng thuộc meeting khác — không tiết lộ)
6. [SKIP] Không check Host/Organizer protection — not applicable cho external
7. [SKIP] Không check agenda ownership — not applicable cho external
8. Check recurring scope (series-wide) → 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED nếu body.scope === 'series'
9. BEGIN TRANSACTION
   9a. Lock meeting row (pessimistic_write)
   9b. Re-check target vẫn tồn tại trong transaction → 404 nếu đã bị gỡ bởi request khác
   9c. DELETE FROM meeting_external_participants WHERE id = :externalParticipantId AND meeting_id = :mid
   9d. INSERT INTO meeting_events (event_type = 'external_participant_removed', metadata)
   9e. INSERT INTO audit_logs (action = 'remove_external_participant', actor_id, target_id, details)
10. COMMIT TRANSACTION
11. POST-TRANSACTION (best-effort, try/catch riêng):
    11a. IF target.email IS NOT NULL: enqueueEmailNotification({ notificationType: MEETING_PARTICIPANT_REMOVED, channel: EMAIL, toEmails: [target.email] })
    11b. ELSE: notificationQueued = false, notificationId/backgroundJobId = null, log info "no email on file, skipped"
12. Return 200 với response data
```

### Edge cases

- `externalParticipantId` tồn tại nhưng thuộc meeting khác: bước 5 trả 404 (không leak thông tin)
- Participant đã bị gỡ trước đó: bước 5 hoặc bước 9b → 404
- Concurrent remove: pessimistic lock trên `meetings` row + re-check trong transaction → request đầu thành công, request sau → 404
- `meeting.host_id` null: không liên quan vì feature này không check Host/Organizer của target
- `reason` > 1000 ký tự: validation pipe → 400
- Target không có email (`email IS NULL`): vẫn xóa thành công, chỉ bỏ qua bước notification

## 8. Validation Plan

### Input validation (class-validator DTO)

| Field | Rule |
|---|---|
| meetingId (path) | `@IsUUID('4')` qua `ParseUUIDPipe` |
| externalParticipantId (path) | `@IsUUID('4')` qua `ParseUUIDPipe` |
| reason (body, optional) | `@IsOptional()`, `@IsString()`, `@MaxLength(1000)` |
| scope (body, optional) | `@IsOptional()`, `@IsIn(['instance', 'series'])`, default `'instance'` |

### Business validation

| Step | Validation | Error |
|---|---|---|
| 1 | Meeting exists & không soft-delete | 404 MEETING_NOT_FOUND |
| 2 | Meeting status = scheduled | 409 MEETING_NOT_REMOVABLE |
| 3 | Requester có permission hoặc là Host/Organizer | 403 FORBIDDEN |
| 4 | Target external participant tồn tại trong đúng meeting | 404 EXTERNAL_PARTICIPANT_NOT_IN_MEETING |
| 5 | Request không phải series-wide removal | 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED |

## 9. Error Handling Plan

- **Transaction fail**: Rollback toàn bộ → 500 INTERNAL_ERROR
- **Notification fail (transaction OK)**: Không rollback, ghi log, cho phép retry job
- **Email null**: Không phải lỗi — bỏ qua bước notification một cách an toàn, response vẫn 200 với `notificationQueued=false`

## 10. Testing Strategy

### Unit tests (Service)

| Test | Expected |
|---|---|
| Remove external participant happy path (có email) | 200, row deleted, event/audit_log/notification/job created |
| Remove external participant happy path (email null) | 200, row deleted, event/audit_log created, notificationQueued=false, notificationId/backgroundJobId=null |
| Meeting not found | 404 MEETING_NOT_FOUND |
| Meeting not scheduled (in_progress/completed/cancelled) | 409 MEETING_NOT_REMOVABLE |
| No permission, not Host/Organizer | 403 FORBIDDEN |
| Host removes | 200 |
| Organizer removes | 200 |
| Manager với permission removes | 200 |
| externalParticipantId not in meeting | 404 EXTERNAL_PARTICIPANT_NOT_IN_MEETING |
| externalParticipantId thuộc meeting khác | 404 EXTERNAL_PARTICIPANT_NOT_IN_MEETING (không leak) |
| Recurring series-wide request (`scope='series'`) | 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED |
| Recurring instance-only (`scope='instance'` hoặc omitted) | 200, chỉ ảnh hưởng occurrence đó |
| Transaction rollback (giả lập fail) | Rollback, row vẫn tồn tại |
| Duplicate remove (gỡ lần 2) | 404 trên request thứ 2 |
| Concurrent remove | First 200, second 404 |
| With reason | reason lưu trong meeting_events.metadata_json và audit_logs |
| Without reason | Không có reason trong metadata |
| Email enqueue fails after commit | Row vẫn bị xóa, lỗi được log, không rollback |

### DTO validation tests

- Invalid meetingId UUID → 400
- Invalid externalParticipantId UUID → 400
- reason > 1000 chars → 400
- scope giá trị khác `instance`/`series` → 400

### AC mapping

| AC ID | Test |
|---|---|
| AC-01 | Service: happy path, có email |
| AC-02 | Service: happy path, email null |
| AC-03 | Verify participant removed from detail view |
| AC-04 | Service: no permission → 403 |
| AC-05 | Service: wrong meeting status → 409 |
| AC-06 | Service: participant not in meeting → 404 |
| AC-07 | DTO: invalid UUID → 400 |
| AC-08 | Service: participant thuộc meeting khác → 404 |
| AC-09 | Service: duplicate remove → 404 |
| AC-10 | Service: concurrent remove → 404 trên request 2 |
| AC-11 | Service: recurring instance-only |
| AC-12 | Service: series-wide → 422 |

## 11. Implementation Phases

### Phase 1: DTO & Validation
- `RemoveExternalParticipantParamsDto` (meetingId, externalParticipantId UUID)
- `RemoveExternalParticipantBodyDto` (reason optional MaxLength 1000, scope optional enum)
- `RemoveExternalParticipantResponseDto`

### Phase 2: Permission Seed
- Migration/seed mới: `meeting.participant.remove.external` (mirror `20260611000001-SeedRemoveParticipantPermissions.ts`)

### Phase 3: Enum Addition
- Thêm `EXTERNAL_PARTICIPANT_REMOVED = 'external_participant_removed'` vào `MeetingEventType`

### Phase 4: Service Layer
- Method `removeExternalParticipant()` trong `MeetingsService`
- Tái sử dụng `checkUserPermission()` đã có; **không** tái sử dụng các bước Host/Organizer-protection hoặc agenda-owner-check của `removeParticipant()` (internal) vì không applicable

### Phase 5: Controller & Routing
- `DELETE /meetings/:meetingId/participants/external/:externalParticipantId` trong `MeetingsController`
- `JwtAuthGuard` + ownership/permission check trong service (giống pattern của `removeParticipant()` hiện tại, không dùng `PermissionsGuard` decorator riêng)

### Phase 6: Unit Tests
- Service tests (17+ cases theo mục 10)
- DTO validation tests
- Controller response format tests

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Nhầm route với remove internal participant (`DELETE /:meetingId/participants/:participantUserId` hiện tại KHÔNG có prefix `/meetings/`) | Conflict route hoặc nhầm lẫn khi review code | Route mới đặt rõ dưới `/meetings/:meetingId/participants/external/:externalParticipantId`, có prefix đầy đủ, khác biệt rõ với route cũ; ghi chú rõ trong PR description |
| Concurrent remove khi không có transaction lock đúng cách | Hai request cùng xóa, request thứ 2 lỗi 500 thay vì 404 | Bắt buộc lock `meetings` row (pessimistic_write) trước khi re-check + delete trong transaction |
| Permission mới chưa seed | Manager không gỡ được, chỉ Organizer/Host hoạt động | Seed migration phải chạy trước khi release; Organizer/Host vẫn hoạt động độc lập với permission |
| Email null nhưng code quên handle, gây lỗi khi gọi `enqueueEmailNotification([null])` | 500 lỗi không mong muốn dù xóa đã thành công | Bắt buộc kiểm tra `if (target.email)` trước khi gọi notification, đặt trong try/catch riêng best-effort |

## 13. Acceptance Criteria Traceability

| AC ID | Phase | Test Strategy |
|---|---|---|
| AC-01 | Phase 4 | Unit test: happy path, có email |
| AC-02 | Phase 4 | Unit test: happy path, email null |
| AC-03 | Phase 4 | Assert participant list sau khi xóa |
| AC-04 | Phase 4 | Unit test: 403 no permission |
| AC-05 | Phase 4 | Unit test: 409 wrong state |
| AC-06 | Phase 4 | Unit test: 404 not found |
| AC-07 | Phase 1 | DTO test: 400 invalid UUID |
| AC-08 | Phase 4 | Unit test: 404 participant ở meeting khác |
| AC-09 | Phase 4 | Unit test: duplicate remove → 404 |
| AC-10 | Phase 4 | Unit test: concurrent remove |
| AC-11 | Phase 4 | Unit test: recurring instance-only |
| AC-12 | Phase 4 | Unit test: series-wide → 422 |
