# Implementation Plan: Yeu cau gia han phien hop (UC-IMM-02)

**Feature Directory**: spec/features/live-meeting/feat-request-meeting-extension
**Date**: 2026-06-16
**Spec**: spec.md
**Research**: research.md
**Data Model**: data-model.md
**API Contract**: contracts/extension-request-api.md
**Quickstart**: quickstart.md

---

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Áp dụng speckit-analyze report: thêm transaction và audit_log vào luồng pending, sửa WebSocket target | Mục 4, 7, 10 |

---

## 1. Feature Summary

Cho phep Host chu dong gui yeu cau gia han phien hop dang dien ra (in_progress). Ho tro 2 path:
- **Auto-apply (no room conflict)**: Tu dong approve, cap nhat meetings/booking/usage, ghi event/audit, push WebSocket.
- **Pending (room conflict)**: Tao meeting_requests pending, tim Manager, gui notification voi CTA view_extension_request. Khong thay doi meeting/booking.

## 2. Technical Context

| Aspect | Detail |
|---|---|
| **Framework** | NestJS (TypeScript) |
| **ORM** | TypeORM, DataSource pattern voi transaction + pessimistic lock |
| **Database** | PostgreSQL, 39 tables v3.2 Compact |
| **Realtime** | Socket.IO qua WebsocketService |
| **Auth** | JWT Bearer + @UseGuards(JwtAuthGuard, PermissionsGuard) |
| **Permission** | meeting.extension.request.own (can tao seed moi) |
| **Target Module** | live-meeting (da co service/controller tu UC-IMM-01) |
| **Module phu thuoc** | meetings, rooms, accounts (users/departments), websocket, auth, administration (audit), notifications |

## 3. Scope Confirmation

### IN SCOPE
- API: POST /api/v1/meetings/{meetingId}/extension-requests
- Permission meeting.extension.request.own + seed
- Host ownership check
- Doc extension policy tu system_configs (key: meeting.extension.policy)
- Validate extensionMinutes theo allowed set tu policy
- Kiem tra gioi han: max 2 applied extensions, max 60 total minutes
- Room conflict check trong [oldEndTime, requestedNewEndTime)
- Auto-apply path: update meetings/room_bookings/room_booking_usages, insert meeting_requests/meeting_events/audit_logs, push WS
- Conflict path: insert meeting_requests (pending), resolve Manager/Approver, insert notification, response
- DB row lock (SELECT FOR UPDATE) chong race condition
- Them EXTENSION_REQUESTED vao MeetingEventType enum
- Them seed permission meeting.extension.request.own

### OUT OF SCOPE
- Manager approve/reject pending extension request (UC-96)
- Direct approve/reject action in notification
- Doi meeting sau, huy meeting sau
- Override booking de tao overlap
- Background job xu ly pending request het han
- Email notification (disabled default v1)
- Thay doi start_time hoac actual_start_time
- Thuc hien thay doi meeting/booking khi co conflict (chi tao pending)
- Them bang/cot moi vao database

## 4. Data Model Impact

**UPDATE (auto-apply path)**:
- meetings: end_time = requestedNewEndTime, updated_by, updated_at
- room_bookings: reserved_end_time = requestedNewEndTime (WHERE status IN active/approved)
- room_booking_usages: reserved_end_time = requestedNewEndTime (WHERE usage_status IN in_use/not_started)

**INSERT (auto-apply path)**:
- meeting_requests: request_type=extend_meeting, approval_mode=auto, approval_status=applied, conflict_check_status=clear
- meeting_events: event_type=extension_requested (can them enum)
- audit_logs: action_type=extend_meeting

**INSERT (conflict/pending path)**:
- meeting_requests: request_type=extend_meeting, approval_mode=manual, approval_status=pending, conflict_check_status=blocked
- notifications: notification_type=meeting_extension_request, channel=in_app, recipient_user_ids_json=[approverIds], payload_json with CTA
- audit_logs: action_type=extend_meeting_pending

**READ-only**:
- system_configs: config_key=meeting.extension.policy
- users: direct_manager_id de resolve approver
- departments: manager_user_id de fallback approver

**Entity changes**: Them EXTENSION_REQUESTED vao MeetingEventType enum

Chi tiet xem data-model.md

## 5. API / Contract Plan

| Method | Path | Permission |
|---|---|---|
| POST | /api/v1/meetings/{meetingId}/extension-requests | meeting.extension.request.own |

Chi tiet request/response/error codes xem contracts/extension-request-api.md

## 6. Authorization Plan

- @UseGuards(JwtAuthGuard, PermissionsGuard) + @RequirePermissions('meeting.extension.request.own')
- Ownership check: currentUserId === meetings.hostId else 403 MEETING_EXTENSION_NOT_HOST
- Tao seed: meeting.extension.request.own cho INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN

## 7. Business Logic Plan

### Service method: requestExtension(meetingId, extensionMinutes, reason, authUser)

Flow:
1. Load policy from system_configs (key=meeting.extension.policy, group=scheduling)
   Fallback defaults: allowed=[15,30,60], maxExtensions=2, maxTotal=60
2. Find+validate meeting: exists, !deleted, status=in_progress, hostId=authUser, roomId!=null, active booking
3. Validate extensionMinutes in allowed set (from policy)
4. Count applied requests: check maxExtensions(2) and maxTotalMinutes(60)
5. Calculate requestedNewEndTime = meeting.end_time + extensionMinutes
6. Check room conflict in [oldEndTime, requestedNewEndTime)
   Query room_bookings: room_id, status IN (pending,approved,active), NOT current booking, overlap

PATH A - No conflict (auto-apply):
7. Transaction with SELECT FOR UPDATE on meetings:
   a. Re-check validation
   b. INSERT meeting_requests (applied)
   c. UPDATE meetings.end_time
   d. UPDATE room_bookings.reserved_end_time
   e. UPDATE room_booking_usages.reserved_end_time
   f. INSERT meeting_events (extension_requested)
   g. INSERT audit_logs (extend_meeting)
   h. COMMIT
8. Post-tx: Push WS event to meeting:{meetingId} (best-effort)
9. Return response 200: approvalMode=auto, status=applied, newEndTime

PATH B - Conflict exists (pending):
7. Resolve approver: users.direct_manager_id -> departments.manager_user_id -> 409 if none
8. Transaction:
   a. INSERT meeting_requests (pending, conflict_summary_json, rule_snapshot_json with approverIds)
   b. INSERT notification for approver (meeting_extension_request, in_app, high priority, CTA=view_extension_request)
   c. INSERT audit_logs (extend_meeting_pending)
   (Nếu lỗi -> rollback transaction, throw 500 MEETING_EXTENSION_MANAGER_NOTIFICATION_FAILED)
9. Post-tx: Push WS event to room `meeting:{meetingId}` and user `user:{managerId}` (best-effort)
10. Return response 200: approvalMode=manual, status=pending, managerNotificationSent=true

### WebSocket Events
- Auto-apply: eventType=meeting.extension.applied, payload={meetingId, oldEndTime, newEndTime, extensionMinutes}
- Pending: eventType=meeting.extension.pending, payload={meetingId, oldEndTime, requestedNewEndTime, extensionMinutes} (gửi cho cả room và manager)

## 8. Validation Plan

| Validation | Layer | Code | HTTP |
|---|---|---|---|
| meetingId UUID format | Controller | - | 400 |
| Meeting ton tai, !deleted | Service | MEETING_NOT_FOUND | 404 |
| User la Host | Service | MEETING_EXTENSION_NOT_HOST | 403 |
| Permission check | Guard | FORBIDDEN | 403 |
| JWT auth | Guard | UNAUTHORIZED | 401 |
| Status=in_progress | Service | MEETING_EXTENSION_NOT_IN_PROGRESS | 409 |
| Co room_id | Service | MEETING_HAS_NO_ROOM | 409 |
| Co active booking | Service | MEETING_EXTENSION_NO_ACTIVE_BOOKING | 409 |
| extensionMinutes in allowed set | Service | MEETING_EXTENSION_INVALID_DURATION | 400 |
| Max extension count | Service | MEETING_EXTENSION_LIMIT_EXCEEDED | 409 |
| Max total minutes | Service | MEETING_EXTENSION_LIMIT_EXCEEDED | 409 |
| Approver exists (conflict) | Service | MEETING_EXTENSION_NO_APPROVER | 409 |

## 9. Error Handling Plan

- NotFoundException -> 404 MEETING_NOT_FOUND
- ForbiddenException -> 403 (FORBIDDEN / MEETING_EXTENSION_NOT_HOST)
- ConflictException -> 409 (MEETING_EXTENSION_* codes)
- BadRequestException -> 400 (MEETING_EXTENSION_INVALID_DURATION)
- InternalServerErrorException -> 500 (MEETING_EXTENSION_MANAGER_NOTIFICATION_FAILED)
- Transaction rollback tu dong khi exception trong transaction
- Notification failure (auto-apply path): best-effort, log error, khong rollback
- Notification failure (conflict path): throw 500, khong tao pending request

## 10. Testing Strategy

### Service Unit Tests
- Auto-apply happy path: tat ca tables cap nhat dung
- Auto-apply WS event pushed
- Conflict pending path: meeting_requests pending, no data changes, notification created, audit_logs created (transaction rollback tested)
- No approver -> 409 MEETING_EXTENSION_NO_APPROVER
- Notification failure -> 500 MEETING_EXTENSION_MANAGER_NOTIFICATION_FAILED
- Meeting not found -> 404
- Not Host -> 403
- Not in_progress -> 409
- No room -> 409 MEETING_HAS_NO_ROOM
- No active booking -> 409
- Invalid duration -> 400
- Limit exceeded (count/minutes) -> 409
- Policy from system_configs -> dung config values
- Fallback defaults khi khong co config
- Approver: direct_manager_id -> department.manager_user_id

### Controller Unit Tests
- POST goi service dung params
- ParseUUIDPipe invalid meetingId
- RequirePermissions decorator

## 11. Implementation Phases

### Phase 1: Foundation
- T001: Them EXTENSION_REQUESTED vao MeetingEventType enum
- T002: Tao seed permission meeting.extension.request.own

### Phase 2: Foundational
- T003: Tao extension error constants file
- T004: Tao ExtensionRequestDto (body) va ExtensionRequestResponseDto
- T005: Tao ExtensionPolicy interface + policy loader tu system_configs

### Phase 3: Core Logic - Auto-apply Path
- T006: Implement requestExtension() auto-apply path trong LiveMeetingService
- T007: Implement room conflict check query
- T008: Implement transaction: meetings/booking/usage/events/audit
- T009: Implement controller endpoint POST
- T010: Implement WebSocket push helper cho auto-apply path

### Phase 4: Core Logic - Conflict/Pending Path
- T011: Implement approver resolution logic
- T012: Implement pending request creation + notification cho Manager

### Phase 5: Testing
- T013: Service unit tests
- T014: Controller unit tests

## 12. Risks & Mitigations

| Risk | Medium | High | Mitigation |
|---|---|---|---|
| system_configs missing/invalid | Med | Med | Fallback defaults |
| Approver not found | Low | Med | Return 409 |
| Race condition concurrent extension | Med | High | SELECT FOR UPDATE |
| Realtime push failure | Low | Low | Best-effort + log |
| Quen seed permission | Low | High | Seed in Phase 1 |
| Notification failure (conflict) | Low | Med | Throw 500 |

## 13. Acceptance Criteria Traceability

| AC ID | Verification | Phase |
|---|---|---|
| AC-001 | Auto-apply: data updated + requests/events/audit | Phase 3 |
| AC-002 | Auto-apply: meetings/booking/usage updated | Phase 3 |
| AC-003 | meeting_requests approval_mode=auto, status=applied | Phase 3 |
| AC-004 | Conflict: no meeting/booking changes | Phase 4 |
| AC-005 | Conflict: meeting_requests manual+pending | Phase 4 |
| AC-006 | Conflict: Host message in response | Phase 4 |
| AC-007 | Conflict: Manager notification with CTA | Phase 4 |
| AC-008 | No approver -> 409 | Phase 4 |
| AC-009 | Non-host -> 403 | Phase 3 |
| AC-010 | Not in_progress -> 409 | Phase 3 |
| AC-011 | No approve/reject endpoint | Phase 1 |
| AC-012 | No overlap booking created | Phase 3 |
| AC-013 | Only applied requests count toward limits | Phase 3 |
| AC-014 | Notification failure -> 500 | Phase 4 |
| AC-015 | Policy from system_configs used | Phase 3 |
| AC-016 | Fallback defaults when no config | Phase 3 |
| AC-017 | Manager notification type = meeting_extension_request | Phase 4 |
| AC-018 | Notification CTA = view_extension_request | Phase 4 |
| AC-019 | No approve/reject action in notification | Phase 4 |
| AC-020 | Email notification disabled default | Phase 4 |