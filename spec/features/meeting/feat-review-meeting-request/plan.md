# Implementation Plan — Duyệt hoặc từ chối yêu cầu cuộc họp

- **Feature ID**: MEETING-REQUEST-REVIEW-001
- **Feature Name**: Duyệt hoặc từ chối yêu cầu cuộc họp
- **Module**: meetings
- **Status**: Draft Plan
- **Created Date**: 2026-06-08

---

## 1. Feature Summary

Feature này cho phép Manager/Approver phê duyệt (approve) hoặc từ chối (reject) một meeting request đang ở trạng thái `pending`. Đây là bước tiếp theo sau feature MEETING-CREATE-MANUAL-001 (tạo yêu cầu cuộc họp).

Khi approve: chuyển `meeting_requests → approved`, `meetings → scheduled`, `room_bookings → approved`, tạo notification meeting_invite cho participants, ghi audit log.

Khi reject: chuyển `meeting_requests → rejected`, `meetings → cancelled`, `room_bookings → cancelled`, tạo notification cho creator/host, ghi audit log.

---

## 2. Technical Context

### Framework & ORM

- **NestJS** với TypeORM
- Transaction pattern: `DataSource.transaction(async (em: EntityManager) => { ... })`
- Pessimistic Lock: `findOne({ where: { id }, lock: { mode: 'pessimistic_write' } })`

### Module hiện tại

| Module | Trạng thái | Vai trò |
|--------|-----------|---------|
| `meetings/` | ✅ Có controller, service, 8 entities | Đặt approve/reject business logic tại đây |
| `approvals/` | ❌ Module rỗng | Không dùng — logic đặt trong meetings |
| `scheduling/` | ❌ Module rỗng | Conflict checking gộp trong meetings service |
| `notifications/` | ⚠️ Chỉ có entity | Tạo notification entity trực tiếp trong transaction |
| `administration/` | ✅ AuditLogEntity sẵn sàng | Ghi audit trong transaction |

### Entities đã tồn tại (dùng trực tiếp)

- `MeetingRequestEntity` — đầy đủ fields (approvalStatus, decisionBy, decisionAt, rejectionReason, conflictCheckStatus, conflictSummaryJson, appliedAt, requestType, notes)
- `MeetingEntity` — status, cancellationReason, updatedBy
- `RoomBookingEntity` — status, approvedBy, approvedAt, cancellationReason
- `MeetingEventEntity` — eventType (dùng `meeting_request_approved`, `meeting_request_rejected`)
- `NotificationEntity` — notificationType, recipientUserIdsJson, channel, deliveryStatus
- `AuditLogEntity` — actionType, entityType, entityId, oldValueJson, newValueJson, metadataJson

### Guard / Auth pattern

- `JwtAuthGuard` — kiểm tra JWT + Redis blacklist
- `PermissionsGuard` + `@RequirePermissions('meeting_request.approve')` — RBAC
- `@Req() request` + `request['user'].userId` — lấy user

---

## 3. Scope Confirmation

### ✅ Trong scope

1. Approve meeting request (POST /meeting-requests/:id/approve)
2. Reject meeting request (POST /meeting-requests/:id/reject)
3. Re-check room conflict trước khi approve
4. Chuyển trạng thái meetings, meeting_requests, room_bookings
5. Tạo notification records (meeting_invite, meeting_request_approved, meeting_request_rejected)
6. Tạo meeting_events
7. Ghi audit_logs
8. Transaction atomic (Pessimistic Lock)
9. Self-approval check
10. Validation (rejectionReason required, length limits, UUID)

### ❌ Ngoài scope

- Tạo meeting request mới
- Hủy request bởi creator
- Edit nội dung request
- Start meeting
- Attendance / Presence / Camera / IoT
- No-show / auto-release
- Recurring meeting
- Google Calendar / Outlook
- SMTP delivery thực tế
- WebSocket realtime push
- Thêm bảng database mới

---

## 4. Data Model Impact

### Không thay đổi schema

Feature này **không thêm bảng mới, không thêm cột mới**. Tất cả fields cần thiết đã có sẵn trong entities hiện tại.

### Fields được UPDATE

#### meeting_requests
| Field | Giá trị cũ → Mới (Approve) | Giá trị cũ → Mới (Reject) |
|-------|---------------------------|--------------------------|
| `approval_status` | `pending` → `approved` | `pending` → `rejected` |
| `conflict_check_status` | → `clear` hoặc `blocked` | (không đổi) |
| `conflict_checked_at` | → now() | (không đổi) |
| `conflict_summary_json` | → conflict detail (nếu có) | (không đổi) |
| `decision_by` | → approverId | → approverId |
| `decision_at` | → now() | → now() |
| `rejection_reason` | (không đổi) | → rejectionReason |
| `applied_at` | → now() | (không đổi, giữ null) |
| `notes` | → decisionNote (nếu có) | (không đổi) |

#### meetings
| Field | Giá trị cũ → Mới (Approve) | Giá trị cũ → Mới (Reject) |
|-------|---------------------------|--------------------------|
| `status` | `pending_approval` → `scheduled` | `pending_approval` → `cancelled` |
| `cancellation_reason` | (không đổi) | → rejectionReason |
| `updated_by` | → approverId | → approverId |
| `updated_at` | → now() | → now() |

#### room_bookings
| Field | Giá trị cũ → Mới (Approve) | Giá trị cũ → Mới (Reject) |
|-------|---------------------------|--------------------------|
| `status` | `pending` → `approved` | `pending` → `cancelled` |
| `approved_by` | → approverId | (không đổi) |
| `approved_at` | → now() | (không đổi) |
| `cancellation_reason` | (không đổi) | → rejectionReason |

### Chi tiết xem thêm
- [data-model.md](./data-model.md) — entity fields, relationships, state transitions
- [research.md](./research.md) — codebase analysis, technology decisions

---

## 5. API / Contract Plan

### 5.1 Endpoints

#### POST /api/v1/meeting-requests/{requestId}/approve

| Item | Value |
|------|-------|
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `meeting_request.approve` |
| Body | `{ decisionNote?: string (max 500) }` |
| Success | 200 — `{ requestId, approvalStatus: "approved", meetingId, bookingId, appliedAt }` |
| Errors | 401, 403, 404, 409, 422, 500 |

#### POST /api/v1/meeting-requests/{requestId}/reject

| Item | Value |
|------|-------|
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `meeting_request.reject` |
| Body | `{ rejectionReason: string (required, max 1000) }` |
| Success | 200 — `{ requestId, approvalStatus: "rejected", decisionAt }` |
| Errors | 401, 403, 404, 409, 500 |

### 5.2 DTOs

| DTO | Fields |
|-----|--------|
| `ApproveMeetingRequestDto` | `decisionNote?: string` — `@IsOptional()`, `@MaxLength(500)` |
| `RejectMeetingRequestDto` | `rejectionReason: string` — `@IsNotEmpty()`, `@MaxLength(1000)` |
| `ApproveResponseDto` | `requestId: uuid`, `approvalStatus: string`, `meetingId: uuid`, `bookingId: uuid`, `appliedAt: Date` |
| `RejectResponseDto` | `requestId: uuid`, `approvalStatus: string`, `decisionAt: Date` |

### 5.3 Route Registration

Thêm vào `MeetingsController` hoặc tạo `MeetingRequestsController` riêng:
```typescript
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('meeting_request.approve')
@Post(':requestId/approve')
async approve(@Param('requestId') id: string, @Body() dto: ApproveDto, @Req() req) { ... }

@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('meeting_request.reject')
@Post(':requestId/reject')
async reject(@Param('requestId') id: string, @Body() dto: RejectDto, @Req() req) { ... }
```

> Chi tiết response codes và error formats xem [contracts/meeting-request-review-api.md](./contracts/meeting-request-review-api.md)

---

## 6. Authorization Plan

### 6.1 Guard Stack

```
@UseGuards(JwtAuthGuard, PermissionsGuard)
```

### 6.2 Permission check

- `@RequirePermissions('meeting_request.approve')` trên approve endpoint
- `@RequirePermissions('meeting_request.reject')` trên reject endpoint
- PermissionsGuard tự động check qua `AuthzReadRepository.getEffectiveRolesAndPermissions(userId)`

### 6.3 Self-approval check (service layer)

```typescript
if (request.requested_by === authUser.userId || meeting.organizer_id === authUser.userId) {
  throw new ForbiddenException({
    success: false,
    message: 'Bạn không thể tự duyệt yêu cầu cuộc họp do chính mình tạo',
    error: { code: 'SELF_APPROVAL_NOT_ALLOWED' },
  });
}
```

> Self-approval check được implement ở service layer, sau guard. Điều này cho phép user có permission nhưng vẫn bị chặn nếu là request của chính mình.

---

## 7. Business Logic Plan

### 7.1 Approve Flow

```
1. Validate requestId (UUID)
2. Find meeting_request with pessimistic lock (SELECT FOR UPDATE)
3. Validate meeting_request tồn tại → 404 nếu không
4. Check request_type === 'create_meeting' → 422 nếu không
5. Check approval_status === 'pending' → 409 nếu không
6. Find meeting → 404 nếu không
7. Check meeting.status === 'pending_approval' → 409 nếu không
8. Find room_booking → 404 nếu không
9. Check room_booking.status === 'pending' → 409 nếu không
10. Self-approval check → 403 nếu self-approval
11. Re-check room conflict:
    - Query room_bookings cùng room, overlap thời gian
    - Status IN ('pending', 'approved', 'active')
    - Loại trừ booking hiện tại
    - Nếu conflict → update conflict_check_status = 'blocked', return 409
12. Update states:
    - meeting_requests: approval_status='approved', decision_by, decision_at, applied_at, conflict_check_status='clear', notes=decisionNote (nếu có)
    - meetings: status='scheduled', updated_by, updated_at
    - room_bookings: status='approved', approved_by, approved_at
13. Create meeting_events: event_type='meeting_request_approved'
14. Create notifications:
    - MEETING_INVITE cho internal participants
    - MEETING_INVITE cho external participants (email)
    - MEETING_REQUEST_APPROVED cho creator/host
15. Create audit_log: action_type='approve', metadata_json chứa decision_note (nếu có)
16. Return success response
```

### 7.2 Reject Flow

```
1. Validate requestId (UUID)
2. Validate rejectionReason (not empty, not whitespace)
3. Find meeting_request with pessimistic lock (SELECT FOR UPDATE)
4. Validate meeting_request tồn tại → 404 nếu không
5. Check request_type === 'create_meeting' → 422 nếu không
6. Check approval_status === 'pending' → 409 nếu không
7. Find meeting → 404 nếu không
8. Check meeting.status === 'pending_approval' → 409 nếu không
9. Find room_booking → 404 nếu không
10. Check room_booking.status === 'pending' → 409 nếu không
11. Self-approval check → 403 nếu self-approval
12. Update states:
    - meeting_requests: approval_status='rejected', rejection_reason, decision_by, decision_at
    - meetings: status='cancelled', cancellation_reason, updated_by, updated_at
    - room_bookings: status='cancelled', cancellation_reason
13. Create meeting_events: event_type='meeting_request_rejected'
14. Create notifications:
    - MEETING_REQUEST_REJECTED cho creator
    - MEETING_REQUEST_REJECTED cho host (nếu host !== creator)
    - KHÔNG tạo MEETING_INVITE
15. Create audit_log: action_type='reject'
16. Return success response
```

### 7.3 Conflict Checking Logic

```typescript
const overlapCondition = `
  room_id = :roomId
  AND id != :currentBookingId
  AND status IN ('pending', 'approved', 'active')
  AND reserved_start_time < :endTime
  AND reserved_end_time > :startTime
`;
const conflicts = await em.getRepository(RoomBookingEntity)
  .createQueryBuilder('rb')
  .where(overlapCondition, {
    roomId: room.id,
    currentBookingId: booking.id,
    startTime: meeting.start_time,
    endTime: meeting.end_time,
  })
  .getMany();
```

---

## 8. Validation Plan

### Input Validation (DTO)

| Field | DTO | Validator | Message |
|-------|-----|-----------|---------|
| `requestId` (path) | — | `@IsUUID('4')` trên controller param hoặc ParseUUIDPipe | `requestId không đúng định dạng UUID` |
| `decisionNote` | ApproveDto | `@IsOptional()`, `@MaxLength(500)` | `decisionNote không được vượt quá 500 ký tự` |
| `rejectionReason` | RejectDto | `@IsNotEmpty()`, `@MaxLength(1000)` | `rejectionReason không được để trống` |

### Business Validation (Service)

| Validation | Error | Status |
|-----------|-------|:------:|
| request tồn tại | RESOURCE_NOT_FOUND | 404 |
| request_type = create_meeting | UNSUPPORTED_REQUEST_TYPE | 422 |
| approval_status = pending | INVALID_STATE | 409 |
| meeting tồn tại | RESOURCE_NOT_FOUND | 404 |
| meeting.status = pending_approval | INVALID_STATE | 409 |
| booking tồn tại | RESOURCE_NOT_FOUND | 404 |
| booking.status = pending | INVALID_STATE | 409 |
| Không self-approval | SELF_APPROVAL_NOT_ALLOWED | 403 |
| Không room conflict | ROOM_CONFLICT | 409 |
| Không double process (pessimistic lock) | REQUEST_ALREADY_PROCESSED | 409 |

---

## 9. Error Handling Plan

### Error Code Table

| Code | HTTP | Điều kiện |
|------|:----:|-----------|
| `VALIDATION_ERROR` | 400 | Input không hợp lệ |
| `UNAUTHORIZED` | 401 | Không có JWT hoặc JWT hết hạn |
| `FORBIDDEN` | 403 | Thiếu permission |
| `SELF_APPROVAL_NOT_ALLOWED` | 403 | User tự duyệt request của mình |
| `RESOURCE_NOT_FOUND` | 404 | request/meeting/booking không tồn tại |
| `INVALID_STATE` | 409 | Status không còn pending |
| `ROOM_CONFLICT` | 409 | Room booking overlap |
| `REQUEST_ALREADY_PROCESSED` | 409 | Pessimistic lock phát hiện conflict transaction |
| `UNSUPPORTED_REQUEST_TYPE` | 422 | request_type không phải create_meeting |
| `INTERNAL_ERROR` | 500 | Transaction/lỗi hệ thống |

### Error Handling Strategy

1. **Validation errors**: Xử lý bởi NestJS ValidationPipe — tự động trả 400
2. **Auth/Authorization errors**: Xử lý bởi JwtAuthGuard và PermissionsGuard — tự động trả 401/403
3. **Business errors**: Throw NestJS exception (NotFoundException, ConflictException, ForbiddenException, UnprocessableEntityException) với object format `{ success, message, error: { code, details } }`
4. **System errors**: Catch trong transaction → rollback → log → throw InternalServerErrorException

### Transaction Error Recovery

- Pessimistic Lock failure (deadlock, timeout) → TypeORM throw exception → rollback → 500
- Audit log failure trong transaction → toàn bộ transaction rollback → 500
- Notification creation failure → toàn bộ transaction rollback → 500

---

## 10. Testing Strategy

### Unit Tests

| Test | Scope |
|------|-------|
| Approve success flow | Service layer — mock transaction |
| Reject success flow | Service layer — mock transaction |
| Self-approval check | Service — verify 403 |
| Room conflict detection | Service — mock conflict data |
| Invalid state (already approved) | Service — verify 409 |
| request_type validation | Service — verify 422 |
| Notification không tạo khi reject | Service — verify no MEETING_INVITE |
| Audit log tạo đúng action_type | Service — verify audit log structure |
| Transaction rollback | Service — mock lỗi update booking |

### Integration Tests

| Test | Scope |
|------|-------|
| Approve endpoint (full flow) | Controller → Service → DB |
| Reject endpoint (full flow) | Controller → Service → DB |
| Request không tồn tại | 404 response |
| Conflict 409 response | Conflict state |
| Permission 403 response | Guard level |
| DTO validation 400 | Pipe level |

### E2E Tests

- Full approve flow từ guard → service → DB verification
- Full reject flow từ guard → service → DB verification
- Race condition test (2 concurrent requests cùng requestId)

---

## 11. Implementation Phases

### Phase 1: DTOs & Service (Core Logic)

**Files cần tạo/sửa:**
- `src/modules/meetings/dto/approve-meeting-request.dto.ts` — NEW
- `src/modules/meetings/dto/reject-meeting-request.dto.ts` — NEW
- `src/modules/meetings/dto/approve-response.dto.ts` — NEW
- `src/modules/meetings/dto/reject-response.dto.ts` — NEW
- `src/modules/meetings/services/meeting-request-review.service.ts` — NEW (hoặc thêm vào meetings.service.ts)

**Nội dung:**
- `approve(requestId, dto, authUser, clientContext)` method
- `reject(requestId, dto, authUser, clientContext)` method
- `checkRoomConflict(em, booking, startTime, endTime)` private method
- `checkSelfApproval(request, meeting, authUser)` private method
- `createNotifications(em, request, meeting, action, participants)` private method
- `createAuditLog(em, ...)` private method

**Transaction scope:** Toàn bộ approve/reject trong một `dataSource.transaction()` duy nhất

### Phase 2: Controller Registration

**Files cần sửa:**
- `src/modules/meetings/meetings.module.ts` — cập nhật providers/controllers nếu cần
- `src/modules/meetings/controllers/meetings.controller.ts` — thêm 2 endpoints mới

**Nội dung:**
- `POST /meeting-requests/:requestId/approve` với guard/permission
- `POST /meeting-requests/:requestId/reject` với guard/permission

### Phase 3: Tests

**Files cần tạo:**
- `src/modules/meetings/tests/meeting-request-review.service.spec.ts`
- `src/modules/meetings/tests/meeting-request-review.controller.spec.ts`

**Nội dung:**
- Unit test cho service methods
- Unit test cho controller endpoints
- Integration test cho full flow (nếu có DB test)

### Phase 4: Verification & Documentation

- Chạy lint + build
- Verify API responses match contract
- Cập nhật AGENTS.md nếu cần
- Cập nhật traceability matrix

---

## 12. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|:-----------:|------------|
| Race condition double approval | High | Medium | Pessimistic Lock (SELECT FOR UPDATE) |
| Transaction timeout do nhiều DB writes | Medium | Low | Giữ transaction ngắn — không gọi external API |
| Notification delivery fail | Low | Medium | Chỉ tạo records, delivery async sau |
| Conflict check inconsistent với create flow | Medium | Low | Re-check conflict tại thời điểm approve, dùng cùng overlap logic |
| Audit log failure rollback | High | Low | Spec yêu cầu rollback — cần confirm với team |
| Missing permission `meeting_request.approve` | High | Low | Seed permission mới; kiểm tra tồn tại trong DB |

### Complexity Tracking

Không có vi phạm constitution. Feature này:
- Không thêm bảng mới ✅
- Không implement out-of-scope features ✅
- Giữ nguyên module boundary (meetings module) ✅
- Dùng JwtAuthGuard + PermissionsGuard pattern có sẵn ✅
- Dùng DataSource.transaction() pattern có sẵn ✅

---

## 13. Acceptance Criteria Traceability

| AC ID | Kịch bản | Service Method | Test Coverage |
|-------|----------|---------------|:-------------:|
| AC-001 | Approve thành công | `approve()` | Unit + Integration |
| AC-002 | Reject thành công | `reject()` | Unit + Integration |
| AC-003 | Approve request không tồn tại | `approve()` → 404 | Unit |
| AC-004 | Reject request không tồn tại | `reject()` → 404 | Unit |
| AC-005 | Approve request đã approved | `approve()` → 409 | Unit |
| AC-006 | Reject request đã approved | `reject()` → 409 | Unit |
| AC-007 | Approve bị room conflict | `approve()` → 409 | Unit |
| AC-008 | Không permission approve | Guard → 403 | Unit (Guard) |
| AC-009 | Không permission reject | Guard → 403 | Unit (Guard) |
| AC-009b | Self-approval | `checkSelfApproval()` → 403 | Unit |
| AC-010 | Reject thiếu rejectionReason | DTO → 400 | Unit (DTO) |
| AC-011 | Approve tạo meeting_invite | `createNotifications()` | Unit |
| AC-012 | Reject không tạo meeting_invite | `reject()` verify no MEETING_INVITE | Unit |
| AC-013 | Approve ghi audit log | `createAuditLog()` action=approve | Unit |
| AC-014 | Reject ghi audit log | `createAuditLog()` action=reject | Unit |
| AC-015 | Transaction rollback | Mock update fail → verify no changes | Unit |

### AC → Requirement Mapping

| AC | FR | ERR |
|----|----|-----|
| AC-001 | FR-001, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-026, FR-028, FR-034, FR-035 | — |
| AC-002 | FR-001, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-027, FR-028, FR-036 | — |
| AC-003 | — | ERR-007 |
| AC-004 | — | ERR-007 |
| AC-005 | FR-020, FR-021, FR-022 | ERR-010 |
| AC-006 | FR-020 | ERR-010 |
| AC-007 | FR-023, FR-024, FR-032, FR-033 | ERR-013 |
| AC-008 | FR-002 | ERR-005 |
| AC-009 | FR-002 | ERR-006 |
| AC-009b | FR-004b | ERR-006b |
| AC-010 | — | ERR-002 |
| AC-011 | FR-007, FR-035 | — |
| AC-012 | FR-014 | — |
| AC-013 | FR-010, FR-037 | — |
| AC-014 | FR-016, FR-037 | — |
| AC-015 | FR-029, FR-031 | ERR-014, ERR-015 |

---

## Artifacts

| Artifact | Path |
|----------|------|
| Plan | `spec/features/meeting/feat-review-meeting-request/plan.md` |
| Research | `spec/features/meeting/feat-review-meeting-request/research.md` |
| Data Model | `spec/features/meeting/feat-review-meeting-request/data-model.md` |
| API Contract | `spec/features/meeting/feat-review-meeting-request/contracts/meeting-request-review-api.md` |
| Quickstart | `spec/features/meeting/feat-review-meeting-request/quickstart.md` |
