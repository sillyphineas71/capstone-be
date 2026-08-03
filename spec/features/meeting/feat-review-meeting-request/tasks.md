# Tasks: Duyệt hoặc từ chối yêu cầu cuộc họp

**Feature ID**: MEETING-REQUEST-REVIEW-001
**Input**: Design documents from `spec/features/meeting/feat-review-meeting-request/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/meeting-request-review-api.md, quickstart.md

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-03 | Cập nhật T007: reject chỉ thông báo host (bỏ "creator/host"). | T007 |
| 2026-08-03 | Đính chính T006: MEETING_INVITE khi approve chỉ gửi IN_APP cho internal participant (KHÔNG gửi email, để giảm tải dịch vụ email); external participant vẫn nhận email. | T006 |

---

## Phase 1: Setup & Foundation

**Purpose**: Khởi tạo các thành phần cơ bản — DTOs, permission seed, cấu trúc service.

**Outcome**: Hoàn thành Phase 1 thì có đủ DTOs, permission trong DB, và service skeleton để implement business logic.

- [x] T001 Seed permissions `meeting_request.approve` và `meeting_request.reject` vào database (thêm vào seed script) — kiểm tra permissions đã tồn tại chưa, nếu chưa thì thêm mới.
- [x] T002 [P] Tạo `ApproveMeetingRequestDto` tại `src/modules/meetings/dto/approve-meeting-request.dto.ts` — field `decisionNote?: string` với `@IsOptional()`, `@MaxLength(500)`, `@IsString()`.
- [x] T003 [P] Tạo `RejectMeetingRequestDto` tại `src/modules/meetings/dto/reject-meeting-request.dto.ts` — field `rejectionReason: string` với `@IsNotEmpty()`, `@MaxLength(1000)`, `@IsString()`.
- [x] T004 [P] Tạo `ApproveResponseDto` tại `src/modules/meetings/dto/approve-response.dto.ts` — fields `requestId: string`, `approvalStatus: string`, `meetingId: string`, `bookingId: string`, `appliedAt: Date`.
- [x] T005 [P] Tạo `RejectResponseDto` tại `src/modules/meetings/dto/reject-response.dto.ts` — fields `requestId: string`, `approvalStatus: string`, `decisionAt: Date`.

**Checkpoint**: DTOs sẵn sàng, permissions đã có trong DB.

---

## Phase 2: Service Layer — Business Logic

**Purpose**: Implement toàn bộ business logic cho approve và reject flows trong một service duy nhất.

**Outcome**: Hoàn thành Phase 2 thì toàn bộ logic nghiệp vụ approve/reject có thể gọi được từ controller.

**Dependency**: Phase 1 (DTOs, permission seed)

- [x] T006 Tạo `MeetingRequestReviewService` tại `src/modules/meetings/services/meeting-request-review.service.ts` với method `approve(requestId, dto, authUser, clientContext)`. Logic bao gồm:
  - Validate UUID requestId (ParseUUIDPipe hoặc manual check)
  - `dataSource.transaction()` với pessimistic lock (`findOne` + `lock: { mode: 'pessimistic_write' }`) trên `MeetingRequestEntity`
  - Kiểm tra request tồn tại → 404 nếu không
  - Kiểm tra `request_type === 'create_meeting'` → 422 nếu không
  - Kiểm tra `approval_status === 'pending'` → 409 nếu không
  - `findOne` `MeetingEntity` → 404 nếu không; check `status === 'pending_approval'` → 409
  - `findOne` `RoomBookingEntity` → 404 nếu không; check `status === 'pending'` → 409
  - Check self-approval: so sánh `requested_by`/`organizer_id` với `authUser.userId` → 403 Forbidden (`SELF_APPROVAL_NOT_ALLOWED`)
  - Re-check room conflict: query `RoomBookingEntity` cùng room_id, status IN ('pending','approved','active'), overlap time, loại trừ booking hiện tại → conflict = 409 + update `conflict_check_status='blocked'`
  - Update `meeting_requests`: `approval_status='approved'`, `decision_by`, `decision_at`, `applied_at`, `conflict_check_status='clear'`; lưu `decisionNote` vào `notes` nếu có
  - Update `meetings`: `status='scheduled'`, `updated_by`, `updated_at`
  - Update `room_bookings`: `status='approved'`, `approved_by`, `approved_at`
  - `em.create` + `em.save` `MeetingEventEntity` với `event_type='meeting_request_approved'`
  - `em.create` + `em.save` notification records: `MEETING_INVITE` (IN_APP only) cho từng internal participant, `MEETING_INVITE` (EMAIL) cho external participant, `MEETING_REQUEST_APPROVED` cho creator/host
  - `em.create` + `em.save` `AuditLogEntity` với `action_type='approve'`; lưu `decisionNote` vào `metadata_json.decision_note`
  - Return `ApproveResponseDto`

- [x] T007 Implement method `reject(requestId, dto, authUser, clientContext)` trong cùng service `MeetingRequestReviewService`. Logic bao gồm:
  - Validate UUID requestId + `rejectionReason` không rỗng
  - `dataSource.transaction()` với pessimistic lock trên `MeetingRequestEntity`
  - Kiểm tra request tồn tại → 404
  - Kiểm tra `request_type === 'create_meeting'` → 422
  - Kiểm tra `approval_status === 'pending'` → 409
  - Kiểm tra meeting + booking tồn tại và status đúng → 404/409
  - Check self-approval → 403
  - Update `meeting_requests`: `approval_status='rejected'`, `rejection_reason`, `decision_by`, `decision_at`
  - Update `meetings`: `status='cancelled'`, `cancellation_reason`, `updated_by`, `updated_at`
  - Update `room_bookings`: `status='cancelled'`, `cancellation_reason`
  - Tạo `MeetingEventEntity` với `event_type='meeting_request_rejected'`
  - Tạo notification `MEETING_REQUEST_REJECTED` (IN_APP) chỉ cho host (không gửi cho creator/requester nếu khác host) — **KHÔNG** tạo `MEETING_INVITE`
  - Tạo `AuditLogEntity` với `action_type='reject'`
  - Return `RejectResponseDto`

**Checkpoint**: Service hoàn chỉnh với approve + reject, full transaction + pessimistic lock + validation.

---

## Phase 3: Controller Layer — API Endpoints

**Purpose**: Expose approve/reject endpoints qua REST API với guard/permission.

**Outcome**: Hoàn thành Phase 3 thì API endpoints có thể gọi được từ bên ngoài.

**Dependency**: Phase 2 (service layer)

- [x] T008 Thêm endpoint `POST /api/v1/meeting-requests/:requestId/approve` vào `src/modules/meetings/controllers/meetings.controller.ts`:
  - `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting_request.approve')`
  - `@Post(':requestId/approve')` + `@Param('requestId', ParseUUIDPipe)`
  - Inject `MeetingRequestReviewService`
  - Gọi `service.approve(requestId, dto, request['user'], { ip, userAgent })`
  - Return `{ success: true, message, data }` với status 200

- [x] T009 Thêm endpoint `POST /api/v1/meeting-requests/:requestId/reject` vào `src/modules/meetings/controllers/meetings.controller.ts`:
  - `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting_request.reject')`
  - `@Post(':requestId/reject')` + `@Param('requestId', ParseUUIDPipe)`
  - Gọi `service.reject(requestId, dto, request['user'], { ip, userAgent })`
  - Return `{ success: true, message, data }` với status 200

- [x] T010 Cập nhật `src/modules/meetings/meetings.module.ts`: thêm `MeetingRequestReviewService` vào `providers` nếu chưa có.

**Checkpoint**: API endpoints approve + reject hoạt động, guard + permission check OK.

---

## Phase 4: Unit Tests

**Purpose**: Đảm bảo coverage cho tất cả acceptance criteria — success flows, error flows, transaction, audit, notification.

**Outcome**: Hoàn thành Phase 4 thì có test coverage cho service và controller.

**Dependency**: Phase 2 + Phase 3

- [x] T011 [P] Viết unit test cho `approve()` method tại `src/modules/meetings/tests/meeting-request-review.service.spec.ts`:
  - Test approve thành công (AC-001, AC-011, AC-013) — verify state transitions, notifications, audit log
  - Test request không tồn tại (AC-003) → 404
  - Test request đã approved (AC-005) → 409
  - Test request_type không phải create_meeting → 422
  - Test room conflict (AC-007) → 409 ROOM_CONFLICT
  - Test self-approval (AC-009b) → 403 SELF_APPROVAL_NOT_ALLOWED
  - Test transaction rollback (AC-015) — mock lỗi update booking, verify rollback
  - Test Pessimistic Lock — verify lock mode được gọi

- [x] T012 Viết unit test cho `reject()` method tại cùng file:
  - Test reject thành công (AC-002, AC-012, AC-014) — verify states, no MEETING_INVITE
  - Test request không tồn tại (AC-004) → 404
  - Test request đã approved (AC-006) → 409
  - Test rejectionReason rỗng → 400
  - Test self-approval → 403

- [x] T013 [P] Viết unit test cho controller endpoints tại `src/modules/meetings/tests/meeting-request-review.controller.spec.ts`:
  - Test approve endpoint gọi đúng service method
  - Test reject endpoint gọi đúng service method
  - Test guard/permission 403 (AC-008, AC-009)
  - Test DTO validation 400 (AC-010)
  - Test response format đúng contract

**Checkpoint**: Tất cả 15 AC được cover bởi test.

---

## Phase 5: Verification & Documentation

**Purpose**: Kiểm tra chất lượng code, verify API responses, cập nhật tài liệu.

**Outcome**: Feature sẵn sàng cho review/deploy.

**Dependency**: Phase 4

- [x] T014 Chạy lint + build — `npm run lint` và `npm run build` — fix lỗi nếu có.
- [x] T015 Verify API responses match contract trong `contracts/meeting-request-review-api.md` (response format, error codes, HTTP status).
- [x] T016 Cập nhật documentation nếu cần — traceability matrix, AGENTS.md, hoặc spec.md changelog.

---

## Requirements Coverage

### Task → AC Mapping

| Task | ACs covered | FRs covered |
|------|-------------|-------------|
| T001 | (seed) | — |
| T002 | — | (DTO) |
| T003 | AC-010 | ERR-002, ERR-003 |
| T004 | — | (DTO) |
| T005 | — | (DTO) |
| T006 | AC-001, AC-003, AC-005, AC-007, AC-009b, AC-011, AC-013, AC-015 | FR-001, FR-002, FR-003, FR-004, FR-004b, FR-004c, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-026, FR-028, FR-028b, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-037 |
| T007 | AC-002, AC-004, AC-006, AC-009b, AC-012, AC-014 | FR-001, FR-002, FR-003, FR-004, FR-004b, FR-004c, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-027, FR-028, FR-029, FR-030, FR-031, FR-036, FR-037 |
| T008 | AC-008 | FR-002, ERR-005 |
| T009 | AC-009 | FR-002, ERR-006 |
| T010 | — | (module config) |
| T011 | AC-001, AC-003, AC-005, AC-007, AC-009b, AC-011, AC-013, AC-015 | NFR-017 |
| T012 | AC-002, AC-004, AC-006, AC-009b, AC-012, AC-014 | NFR-017 |
| T013 | AC-008, AC-009, AC-010 | NFR-017 |
| T014 | — | (quality) |
| T015 | — | (contract verification) |
| T016 | — | (documentation) |

### Coverage Summary

| AC | Status | Covered by |
|----|--------|-----------|
| AC-001 | ✅ | T006 + T011 |
| AC-002 | ✅ | T007 + T012 |
| AC-003 | ✅ | T006 + T011 |
| AC-004 | ✅ | T007 + T012 |
| AC-005 | ✅ | T006 + T011 |
| AC-006 | ✅ | T007 + T012 |
| AC-007 | ✅ | T006 + T011 |
| AC-008 | ✅ | T008 + T013 |
| AC-009 | ✅ | T009 + T013 |
| AC-009b | ✅ | T006 + T007 + T011 + T012 |
| AC-010 | ✅ | T003 + T013 |
| AC-011 | ✅ | T006 + T011 |
| AC-012 | ✅ | T007 + T012 |
| AC-013 | ✅ | T006 + T011 |
| AC-014 | ✅ | T007 + T012 |
| AC-015 | ✅ | T006 + T011 |

---

## Parallel Execution Opportunities

```bash
# Phase 1 — Parallel DTOs
Task: T002 ApproveMeetingRequestDto
Task: T003 RejectMeetingRequestDto
Task: T004 ApproveResponseDto
Task: T005 RejectResponseDto

# Phase 4 — Parallel Tests
Task: T011 Approve service tests
Task: T012 Reject service tests
Task: T013 Controller tests
```

## Dependency Graph

```
T001 (seed) ─┐
T002 (dto)  ─┤
T003 (dto)  ─┤
T004 (dto)  ─┤
T005 (dto)  ─┘
       │
       ▼
T006 (approve service) ─┐
T007 (reject service)   ─┤
       │                 │
       ▼                 ▼
T008 (approve controller) ─┐
T009 (reject controller)   ─┤
T010 (module config)       ─┘
       │
       ▼
T011 (approve tests)  ─┐
T012 (reject tests)    ─┤  [P]
T013 (controller tests)─┘
       │
       ▼
T014 (lint+build) ─┐
T015 (verify API)  ─┤  [P]
T016 (docs)        ─┘
```

## Implementation Strategy

### MVP Scope (Phase 1 + Phase 2 + Phase 3)

Tập trung hoàn thành approve + reject flows (không test) trước. Đây là MVP có thể demo được:
1. T001 → Permissions ready
2. T002–T005 → DTOs ready
3. T006–T007 → Business logic ready
4. T008–T010 → API endpoints ready, có thể test qua Postman/curl

### Full Delivery (All Phases)

Sau MVP, thêm tests và verification để đảm bảo quality.

### Total Tasks: 16
- Phase 1: 5 tasks (4 [P])
- Phase 2: 2 tasks
- Phase 3: 3 tasks
- Phase 4: 3 tasks (all [P])
- Phase 5: 3 tasks
