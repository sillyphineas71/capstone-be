| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-25 | Khởi tạo plan cho tính năng thêm khách mời bên ngoài sau khi cuộc họp đã tạo | Toàn bộ file |

# Implementation Plan: Thêm khách mời bên ngoài vào cuộc họp đã tạo

- **Feature ID**: MEET-ADD-EXTERNAL-PARTICIPANT-001
- **Feature Name**: Add External Meeting Participant (Post-creation)
- **Module / Domain**: Meeting Management (meetings)
- **Created Date**: 2026-06-25
- **Status**: Draft
- **Source Documents**: spec.md

---

## 1. Feature Summary

Cho phép Organizer/Host (luôn được phép) hoặc Meeting Manager có quyền `meeting.participant.add.external` thêm một khách mời bên ngoài vào meeting đang ở trạng thái `scheduled`/`in_progress`. Thao tác này:

- Tạo record mới trong `meeting_external_participants` với `participant_role='attendee'`, `invitation_status='pending'`
- Tái sử dụng đúng cơ chế cảnh báo sức chứa phòng 2-bước (`warningToken`) đã có cho luồng add internal participant
- Không kiểm tra xung đột lịch cá nhân (khách mời bên ngoài không có lịch trong hệ thống)
- Ghi `meeting_events` (event_type mới `external_participant_added`) và `audit_logs` trong cùng transaction với việc tạo participant
- Gửi email mời họp (best-effort, post-transaction) — KHÔNG gửi in-app vì không có user account
- Meeting `private` chỉ Organizer/Host/Admin mới được thêm
- Chống trùng email trong cùng meeting ở tầng application (chưa có unique constraint DB)

## 2. Technical Context

- **Module**: meetings (`src/modules/meetings/`)
- **Pattern**: Controller → Service → TypeORM Repository/EntityManager, đúng layering hiện có của `MeetingsController`/`MeetingsService`
- **Transaction**: DB transaction bao gồm: INSERT meeting_external_participants + INSERT meeting_events + INSERT audit_logs. Notification (INSERT notifications + INSERT background_jobs) chạy **sau** transaction, best-effort — mirror đúng pattern thực tế của `addInternalParticipant()` (không phải pattern lý thuyết "tất cả trong 1 transaction" đã ghi sai ở spec cũ của remove-internal).
- **Capacity check reuse**: Dùng lại `getAttendeeCount()`, `WarningTokenUtil`, và đọc `system_configs.meeting.capacity_policy` — các hàm/utility này đã tồn tại trong `MeetingsService`, không viết lại từ đầu.
- **Permission mới**: `meeting.participant.add.external` — cần seed migration mới (mirror `20260610000001-SeedAddParticipantPermissions.ts`).
- **Enum mới (app-level, không migration)**: `MeetingEventType.EXTERNAL_PARTICIPANT_ADDED = 'external_participant_added'`.

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

- Thêm một khách mời bên ngoài mỗi lần gọi API (bảng `meeting_external_participants`)
- Kiểm tra quyền: Organizer/Host của meeting, hoặc actor có permission `meeting.participant.add.external`
- Kiểm tra `visibility_level='private'`: chỉ Organizer/Host/Admin (`admin.all`)
- Kiểm tra trạng thái: chỉ cho phép khi meeting `scheduled` hoặc `in_progress`
- Validate `fullName` (required), `email` (required, format email)
- Lưu optional `organizationName`, `phoneNumber`
- Chống trùng email (case-insensitive) trong cùng meeting — application-level pre-check + re-check trong transaction
- Tính lại sức chứa phòng (internal + external + 1) nếu meeting có `room_id`; áp dụng policy `meeting.capacity_policy` (`block` | `warning`) qua `system_configs`
- Luồng warning 2 bước: lần đầu trả `warningToken`, lần 2 với `overrideWarnings=true` + `warningToken` hợp lệ + quyền `meeting.participant.override_capacity` nếu policy là `warning`
- Insert participant + meeting_event + audit_log trong transaction
- Enqueue email invite (best-effort, sau transaction); không tạo in-app notification
- Response 201 trả về `externalParticipantId`, `meetingId`, `fullName`, `email`, `organizationName`, `phoneNumber`, `role`, `status`
- Transaction rollback nếu bước core (participant/event/audit) thất bại

### Out of scope

- Thêm nhiều khách mời cùng lúc sau khi tạo meeting (bulk add) — chỉ dùng `externalParticipants[]` tại thời điểm tạo meeting
- Import khách mời bên ngoài qua Excel
- Cập nhật thông tin khách mời bên ngoài đã thêm
- Gỡ khách mời bên ngoài (`feat-remove-external-meeting-participant`)
- Thêm/Gỡ thành viên nội bộ (đã có feature riêng)
- Thay đổi `participant_role`
- RSVP / theo dõi phản hồi lời mời của khách mời bên ngoài
- Thêm unique constraint database cho `(meeting_id, email)`
- Kiểm tra xung đột lịch cá nhân cho khách mời bên ngoài
- Thêm vào toàn bộ recurring series
- Tạo file `.ics`
- Liên kết với `device_user_mappings`/tài khoản hệ thống

## 4. Data Model Impact

### Tables affected

```
meeting_external_participants → INSERT
meetings                      → READ ONLY (status, organizer_id, host_id, visibility_level, room_id)
meeting_participants          → READ ONLY (count for capacity check)
rooms                         → READ ONLY (capacity)
system_configs                → READ ONLY (meeting.capacity_policy)
meeting_events                → INSERT (event_type = external_participant_added)
audit_logs                    → INSERT (action = add_external_participant)
notifications                 → INSERT (notification_type = meeting_invite, channel = email)
background_jobs               → INSERT (email job)
```

### No schema changes

Không thêm bảng mới, không thêm cột mới. Chỉ cần:
- 1 permission mới: `meeting.participant.add.external` (seed)
- 1 giá trị enum ứng dụng mới: `MeetingEventType.EXTERNAL_PARTICIPANT_ADDED` (cột `varchar(60)`, không cần migration)

## 5. API / Contract Plan

### Endpoint

```
POST /api/v1/meetings/{meetingId}/participants/external
```

### Request

- **Path params**: `meetingId` (UUID)
- **Body**: `{ fullName, email, organizationName?, phoneNumber?, overrideWarnings?, warningToken? }`

### Success response (201)

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

### Error mapping

| HTTP Status | Error Code | Condition |
|---|---|---|
| 400 | VALIDATION_ERROR | `fullName`/`email` thiếu hoặc sai định dạng |
| 400 | INVALID_MEETING_STATUS | Meeting không ở trạng thái `scheduled`/`in_progress` |
| 400 | INVALID_WARNING_TOKEN | `warningToken` không hợp lệ/hết hạn/không khớp |
| 401 | UNAUTHENTICATED | Thiếu hoặc token hết hạn |
| 403 | FORBIDDEN | Không có quyền `meeting.participant.add.external` và không phải Organizer/Host |
| 403 | FORBIDDEN_ACCESS | Meeting `private` và actor không phải Organizer/Host/Admin |
| 404 | MEETING_NOT_FOUND | Meeting không tồn tại hoặc đã soft-delete |
| 409 | EXTERNAL_PARTICIPANT_ALREADY_EXISTS | Email đã có trong danh sách khách mời bên ngoài của meeting |
| 422 | WARNING_CONFIRMATION_REQUIRED | Vượt sức chứa, policy `warning`, chưa có `warningToken` hợp lệ |
| 422 | ROOM_CAPACITY_EXCEEDED | Policy `block`, hoặc `warning` nhưng không có quyền override |
| 500 | INTERNAL_ERROR | Lỗi server không xác định |

## 6. Authorization Plan

### Permission check flow

1. **Xác thực**: `JwtAuthGuard` — yêu cầu JWT token hợp lệ
2. **Phân quyền** (một trong các điều kiện sau):
   - Requester là Organizer của meeting (`meeting.organizerId === userId`)
   - Requester là Host của meeting (`meeting.hostId === userId`)
   - Requester có permission `meeting.participant.add.external`
3. **Private meeting**: nếu `meeting.visibilityLevel === 'private'` và requester không phải Organizer/Host, kiểm tra thêm permission `admin.all`; nếu không có → 403 `FORBIDDEN_ACCESS`
4. **Capacity override**: nếu cần override cảnh báo sức chứa, kiểm tra thêm permission `meeting.participant.override_capacity`

### Additional rules

- Không kiểm tra `visibility_level` đối với meeting không phải `private` — mọi actor có permission `meeting.participant.add.external` đều được thêm.
- Logic phân quyền giống chính xác `addInternalParticipant()` hiện có ([meetings.service.ts:2316-2341](../../../../src/modules/meetings/services/meetings.service.ts)), chỉ đổi permission code.

## 7. Business Logic Plan

### Core flow

```
1. Validate DTO (fullName, email format) — ValidationPipe
2. Find meeting by meetingId → 404 MEETING_NOT_FOUND nếu không tồn tại/đã soft-delete
3. Check meeting.status IN ('scheduled', 'in_progress') → 400 INVALID_MEETING_STATUS
4. Authorization check (Organizer/Host/permission) → 403 FORBIDDEN
5. Private meeting check (nếu áp dụng) → 403 FORBIDDEN_ACCESS
6. Pre-check duplicate email (case-insensitive) trong meeting_external_participants → 409 EXTERNAL_PARTICIPANT_ALREADY_EXISTS
7. Nếu meeting.roomId tồn tại:
   7a. Tính attendeeCount = countInternal + countExternal
   7b. Nếu attendeeCount + 1 > room.capacity:
       - Đọc system_configs['meeting.capacity_policy'] (default 'warning')
       - Nếu 'block' → 422 ROOM_CAPACITY_EXCEEDED ngay
       - Nếu 'warning' và chưa có (overrideWarnings=true + warningToken hợp lệ) → 422 WARNING_CONFIRMATION_REQUIRED (kèm warningToken mới)
8. Nếu có overrideWarnings=true + warningToken:
   8a. Verify token (khớp meetingId/email/warnings) → nếu invalid → 400 INVALID_WARNING_TOKEN
   8b. Nếu warning có ROOM_CAPACITY_WARNING: check permission meeting.participant.override_capacity → nếu thiếu → 422 ROOM_CAPACITY_EXCEEDED
9. BEGIN TRANSACTION
   9a. Lock meeting row (pessimistic_write) — tránh race condition tính sức chứa
   9b. Re-check duplicate email trong transaction → nếu tồn tại → 409 EXTERNAL_PARTICIPANT_ALREADY_EXISTS
   9c. INSERT INTO meeting_external_participants (full_name, email, organization_name, phone_number, participant_role='attendee', invitation_status='pending')
   9d. INSERT INTO meeting_events (event_type='external_participant_added', actor_user_id, metadata_json={email, fullName})
   9e. INSERT INTO audit_logs (action='add_external_participant', actor_id, target_id, new_value_json)
10. COMMIT TRANSACTION
11. POST-TRANSACTION (best-effort, try/catch riêng, không rollback nếu lỗi):
    11a. enqueueEmailNotification({ notificationType: MEETING_INVITE, channel: EMAIL, toEmails: [email] })
    11b. Nếu meeting.status === 'in_progress': log best-effort device-sync event
12. Return 201 với response data
```

### Edge cases

- Meeting không có `roomId`: bỏ qua toàn bộ bước 7-8, không có warning
- Email trùng khác hoa/thường: so sánh `LOWER(email)` ở cả pre-check và re-check trong transaction
- Hai request đồng thời cùng email: transaction + re-check trong bước 9b đảm bảo chỉ 1 thành công, request còn lại nhận 409 (không phải 500)
- `warningToken` hợp lệ nhưng không khớp `meetingId`/payload: 400 `INVALID_WARNING_TOKEN`
- Email enqueue thất bại sau commit: log lỗi, không rollback (đã có participant trong DB)

## 8. Validation Plan

### Input validation (class-validator DTO)

| Field | Rule |
|---|---|
| meetingId (path) | `@IsUUID('4')` qua `ParseUUIDPipe` |
| fullName (body) | `@IsString()`, `@IsNotEmpty()`, `@MaxLength(255)` |
| email (body) | `@IsEmail()` |
| organizationName (body, optional) | `@IsOptional()`, `@IsString()`, `@MaxLength(255)` |
| phoneNumber (body, optional) | `@IsOptional()`, `@IsString()`, `@MaxLength(30)` |
| overrideWarnings (body, optional) | `@IsOptional()`, `@IsBoolean()` |
| warningToken (body, optional) | `@IsOptional()`, `@IsString()` |

DTO dùng `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })` — mirror đúng convention của `AddInternalParticipantDto`/`CreateMeetingDto`.

### Business validation

| Step | Validation | Error |
|---|---|---|
| 1 | Meeting exists & không soft-delete | 404 MEETING_NOT_FOUND |
| 2 | Meeting status thuộc {scheduled, in_progress} | 400 INVALID_MEETING_STATUS |
| 3 | Requester có quyền hoặc là Organizer/Host | 403 FORBIDDEN |
| 4 | Meeting private → chỉ Organizer/Host/Admin | 403 FORBIDDEN_ACCESS |
| 5 | Email chưa tồn tại trong meeting (case-insensitive) | 409 EXTERNAL_PARTICIPANT_ALREADY_EXISTS |
| 6 | Sức chứa phòng (nếu có room) theo policy | 422 WARNING_CONFIRMATION_REQUIRED / ROOM_CAPACITY_EXCEEDED |
| 7 | warningToken hợp lệ khi override | 400 INVALID_WARNING_TOKEN |

## 9. Error Handling Plan

- **Transaction fail** (bước 9): Rollback toàn bộ → 500 INTERNAL_ERROR
- **Notification fail (transaction đã OK)**: Không rollback, ghi log lỗi (NFR-008)
- **Capacity policy `block`**: Hard reject, không cho override dù có quyền `override_capacity` (mirror `addInternalParticipant`)

## 10. Testing Strategy

### Unit tests (Service)

| Test | Expected |
|---|---|
| Add external participant happy path | 201, participant + event + audit_log created |
| Meeting not found | 404 MEETING_NOT_FOUND |
| Meeting status = draft/pending_approval/completed/cancelled | 400 INVALID_MEETING_STATUS |
| Meeting status = in_progress | 201 (vẫn cho phép) |
| No permission, not Organizer/Host | 403 FORBIDDEN |
| Private meeting, Meeting Manager (not owner) | 403 FORBIDDEN_ACCESS |
| Private meeting, Organizer | 201 |
| Private meeting, Admin (admin.all) | 201 |
| Duplicate email (exact case) | 409 EXTERNAL_PARTICIPANT_ALREADY_EXISTS |
| Duplicate email (different case) | 409 EXTERNAL_PARTICIPANT_ALREADY_EXISTS |
| Same email, different meeting | 201 (allowed) |
| Room capacity exceeded, policy=warning, first call (no token) | 422 WARNING_CONFIRMATION_REQUIRED + warningToken |
| Room capacity exceeded, policy=warning, override + valid token + has override permission | 201 |
| Room capacity exceeded, policy=warning, override + valid token + no override permission | 422 ROOM_CAPACITY_EXCEEDED |
| Room capacity exceeded, policy=block | 422 ROOM_CAPACITY_EXCEEDED (no override possible) |
| Invalid/expired/mismatched warningToken | 400 INVALID_WARNING_TOKEN |
| Meeting without roomId | 201, no capacity check performed |
| Concurrent duplicate add (same email) | First 201, second 409 (not 500) |
| Transaction failure (simulated) | Rollback, 500, no participant created |
| Notification enqueue fails after commit | Participant still created, error logged, no rollback |
| No in-app notification created | Assert `createNotification` (IN_APP) NOT called |

### DTO validation tests

- Missing/empty fullName → 400
- Invalid email format → 400
- organizationName/phoneNumber omitted → no error, stored as null
- fullName whitespace-only → 400

### AC mapping

| AC ID | Test |
|---|---|
| AC-01 | Service: happy path |
| AC-02 | Verify notifications/background_jobs created with channel=email, no in_app |
| AC-03 | Service: duplicate email → 409 |
| AC-04 | DTO: invalid email → 400 |
| AC-05 | Service: private meeting, Manager → 403 |
| AC-06 | Service: private meeting, Organizer → 201 |
| AC-07 | Service: warning 2-step success |
| AC-08 | Service: warning, no override permission → 422 |
| AC-09 | Service: policy block → 422 |
| AC-10 | Service: wrong meeting status → 400 |
| AC-11 | Service: concurrent duplicate → 409 |
| AC-12 | Verify audit_logs record |
| AC-13 | Service: meeting in_progress → 201 |

## 11. Implementation Phases

### Phase 1: DTO & Validation
- `AddExternalParticipantDto` (fullName, email, organizationName?, phoneNumber?, overrideWarnings?, warningToken?)
- `AddExternalParticipantResponseDto` / interface `IAddExternalParticipantResponse`

### Phase 2: Permission Seed
- Migration/seed mới: `meeting.participant.add.external` (mirror `20260610000001-SeedAddParticipantPermissions.ts`), gán cho role ADMIN/MANAGER/EMPLOYEE (đối chiếu lại với team trước khi seed role nào)

### Phase 3: Enum Addition
- Thêm `EXTERNAL_PARTICIPANT_ADDED = 'external_participant_added'` vào `MeetingEventType` (meeting-event.entity.ts)

### Phase 4: Service Layer
- Method `addExternalParticipant()` trong `MeetingsService`, tái sử dụng `getAttendeeCount()`, `warningTokenUtil`, `checkUserPermission()` đã có
- Tái sử dụng `notificationsService.enqueueEmailNotification()` theo đúng pattern ở `addInternalParticipant()`

### Phase 5: Controller & Routing
- `POST /meetings/:meetingId/participants/external` trong `MeetingsController`
- `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('meeting.participant.add.external')` — lưu ý: giống `addInternalParticipant`, decorator permission không tự loại trừ owner-bypass; owner-bypass được xử lý trong service

### Phase 6: Unit Tests
- Service tests (20+ cases theo mục 10)
- DTO validation tests
- Controller response format tests

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Concurrent duplicate add (race condition) | Có thể tạo 2 bản ghi trùng email | Pre-check + re-check trong transaction với pessimistic lock trên meeting row; chấp nhận rủi ro residual rất nhỏ vì chưa có DB unique constraint (đã ghi rõ trong Out of Scope) |
| Permission mới chưa có default role assignment | Không ai dùng được tính năng sau khi merge | Seed migration phải gán permission cho role phù hợp (ADMIN/MANAGER tối thiểu), xác nhận với team trước khi chốt role list |
| `WarningTokenUtil` có signature cố định `generateToken(meetingId, userId, warnings)`/`verifyToken(token, meetingId, userId)` (đã xác nhận trong code), không có khái niệm `userId` cho khách mời bên ngoài | Cần xử lý đúng khi tái sử dụng cho external | Truyền `email` vào đúng vị trí tham số `userId` khi gọi `generateToken`/`verifyToken` — util không validate kiểu giá trị của field này nên dùng được ngay, không cần sửa util. Ghi chú rõ trong code để tránh nhầm lẫn tên biến. |
| Notification fail sau commit | Khách mời không nhận được email mời | Log lỗi rõ ràng; xem xét retry qua `background_jobs` (đã có pattern) |
| Meeting capacity tính sai nếu external count stale do race | Warning không chính xác trong trường hợp hiếm | Đã dùng pessimistic lock trên `meetings` row trong transaction để giảm race window |

## 13. Acceptance Criteria Traceability

| AC ID | Phase | Test Strategy |
|---|---|---|
| AC-01 | Phase 4 | Unit test: happy path |
| AC-02 | Phase 4 | Assert email notification + no in-app |
| AC-03 | Phase 4 | Unit test: duplicate email → 409 |
| AC-04 | Phase 1 | DTO test: invalid email → 400 |
| AC-05 | Phase 4 | Unit test: private meeting, Manager → 403 |
| AC-06 | Phase 4 | Unit test: private meeting, Organizer → 201 |
| AC-07 | Phase 4 | Unit test: warning 2-step success |
| AC-08 | Phase 4 | Unit test: warning, no override permission → 422 |
| AC-09 | Phase 4 | Unit test: policy block → 422 |
| AC-10 | Phase 4 | Unit test: wrong status → 400 |
| AC-11 | Phase 4 | Unit test: concurrent duplicate → 409 |
| AC-12 | Phase 4 | Assert audit_logs record |
| AC-13 | Phase 4 | Unit test: in_progress → 201 |
