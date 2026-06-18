# Tasks: Yeu cau gia han phien hop (UC-IMM-02)

**Feature Directory**: spec/features/live-meeting/feat-request-meeting-extension
**Date**: 2026-06-16
**Spec**: spec.md
**Plan**: plan.md

---

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Bỏ [P] ở T008 và T012, thêm transaction/audit_logs/WebSocket target cho pending path theo báo cáo analyze | T008, T012 |

---

## Phase 1: Foundation

### Mục tiêu
Thiết lập các thay đổi nền tảng: kiểm tra enum, tạo seed permission mới.

### Tasks

- [x] T001 Kiem tra MeetingEventType.EXTENSION_REQUESTED da ton tai trong src/modules/meetings/entities/meeting-event.entity.ts. Neu chua, them gia tri: EXTENSION_REQUESTED = extension_requested
- [x] T002 Tao seed permission meeting.extension.request.own trong file src/database/seeds/{timestamp}-SeedMeetingExtensionRequestPermission.ts, gan cho roles INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN (theo mau seed SessionStart)

---

## Phase 2: Foundational (Blocking Prerequisites)

### Mục tiêu
Tao error constants, DTO, ExtensionPolicy interface + loader. Tat ca song song.

### Tasks

- [x] T003 [P] Tao file src/modules/live-meeting/constants/meeting-extension-error.constant.ts voi error codes: MEETING_NOT_FOUND, MEETING_EXTENSION_NOT_HOST, MEETING_EXTENSION_NOT_IN_PROGRESS, MEETING_EXTENSION_NO_ACTIVE_BOOKING, MEETING_EXTENSION_INVALID_DURATION, MEETING_EXTENSION_LIMIT_EXCEEDED, MEETING_EXTENSION_NO_APPROVER, MEETING_EXTENSION_MANAGER_NOTIFICATION_FAILED
- [x] T004 [P] Tao DTO files:
    - src/modules/live-meeting/dto/extension-request.dto.ts: extensionMinutes (int, required), reason (string, optional, max 500)
    - src/modules/live-meeting/dto/extension-request-response.dto.ts: requestId, meetingId, oldEndTime, newEndTime/requestedNewEndTime, extensionMinutes, approvalMode, status, conflictCheckStatus, managerNotificationSent (optional)
- [x] T005 [P] Tao ExtensionPolicy interface + loader:
    - File: src/modules/live-meeting/types/extension-policy.type.ts
    - Interface: ExtensionPolicy { allowedExtensionMinutes: number[]; maxExtensionCountPerMeeting: number; maxTotalExtensionMinutesPerMeeting: number }
    - Method loadExtensionPolicy() trong LiveMeetingService: doc system_configs (key=meeting.extension.policy, group=scheduling), fallback defaults [15,30,60], maxExtensions=2, maxTotal=60

---

## Phase 3: Core Logic - Auto-apply Path (No Conflict)

### Mục tiêu
Implement luong auto-apply: Host gui request -> kiem tra -> auto-approve -> cap nhat data -> WS push.

### Tasks

- [x] T006 [P] [US1] Implement validateExtensionRequest() trong LiveMeetingService:
    - Kiem tra meeting: exists, !deleted, status=in_progress, hostId=authUser, roomId!=null
    - Kiem tra active room booking (status=active/approved)
    - Kiem tra extensionMinutes trong allowed set tu policy
    - Kiem tra maxExtensionCountPerMeeting (count applied requests)
    - Kiem tra maxTotalExtensionMinutesPerMeeting (sum applied extension minutes)
    - Throw loi tuong ung (MEETING_NOT_FOUND, MEETING_EXTENSION_*)
- [x] T007 [P] [US1] Implement checkRoomConflict() trong LiveMeetingService:
    - Input: roomId, currentBookingId, currentEndTime, requestedNewEndTime
    - Query room_bookings: room_id, status IN (pending,approved,active), NOT current booking, reserved_start_time < new AND reserved_end_time > old
    - Return: { hasConflict: boolean, conflicts: ConflictDetail[] }
- [x] T008 [US1] Implement requestExtension() auto-apply path:
    - Transaction (SELECT FOR UPDATE on meetings):
      1. Re-check validation
      2. INSERT meeting_requests (extend_meeting, auto, applied, clear)
      3. UPDATE meetings.end_time = requestedNewEndTime
      4. UPDATE room_bookings.reserved_end_time = requestedNewEndTime
      5. UPDATE room_booking_usages.reserved_end_time = requestedNewEndTime
      6. INSERT meeting_events (extension_requested, manual, old/new value)
      7. INSERT audit_logs (extend_meeting)
    - Post-tx: push WS event (best-effort)
    - Return ExtensionRequestResponseDto (approvalMode=auto, status=applied)
- [x] T009 [P] [US1] Implement POST /api/v1/meetings/{meetingId}/extension-requests trong LiveMeetingController:
    - @UseGuards(JwtAuthGuard, PermissionsGuard) + @RequirePermissions(meeting.extension.request.own)
    - @Post(extension-requests), @Param(ParseUUIDPipe), @Body() ExtensionRequestDto
    - Goi LiveMeetingService.requestExtension(), return ExtensionRequestResponseDto
- [x] T010 [P] [US1] Implement WebSocket push cho auto-apply path:
    - Event: meeting.extension.applied
    - Payload: { meetingId, oldEndTime, newEndTime, extensionMinutes, requestedBy, occurredAt }
    - Room: meeting:{meetingId}, emitToRoom() post-transaction (best-effort)

---

## Phase 4: Core Logic - Conflict/Pending Path

### Mục tiêu
Implement luong pending: conflict -> tim Manager -> meeting_requests pending -> notification.

### Tasks

- [x] T011 [P] [US2] Implement approver resolution logic:
    - Method: resolveApprover(hostId: string): Promise<string[]>
    - Buoc 1: Query users.direct_manager_id (user active)
    - Buoc 2: Neu null, query departments.manager_user_id (user department)
    - Buoc 3: Neu null, tim user voi permission review/approve extension (future)
    - Buoc 4: Neu empty, throw ConflictException(MEETING_EXTENSION_NO_APPROVER)
    - Return mang approver user IDs
- [x] T012 [US2] Implement pending path trong requestExtension():
    - Goi resolveApprover() -> throw 409 neu khong tim duoc
    - Transaction:
      1. INSERT meeting_requests (extend_meeting, manual, pending, blocked, conflict_summary_json, request_payload_json, rule_snapshot_json)
      2. INSERT notification (meeting_extension_request, in_app, high priority, CTA=view_extension_request)
      3. INSERT audit_logs (extend_meeting_pending)
      (Neu co bat ky loi insert -> transaction rollback -> throw 500)
    - Post-tx: Push WS event (best-effort): event meeting.extension.pending, emitToRoom meeting:{meetingId} va user:{managerId}
    - Return ExtensionRequestResponseDto (approvalMode=manual, status=pending, managerNotificationSent=true)

---

## Phase 5: Testing

### Mục tiêu
Unit test cho service, controller.

### Tasks

- [ ] T013 Service unit tests trong src/modules/live-meeting/tests/live-meeting.service.spec.ts:
    - Auto-apply happy path: 15/30/60 phut, verify meetings/booking/usage updated, requests/events/audit created, WS event
    - Policy: config tu system_configs duoc dung, fallback khi khong co
    - Invalid duration (10) -> MEETING_EXTENSION_INVALID_DURATION
    - Limit exceeded (count=2, total=60) -> MEETING_EXTENSION_LIMIT_EXCEEDED
    - Conflict detected -> pending path, meetings/booking khong thay doi, meeting_requests pending
    - Approver: direct_manager_id -> notification, department fallback -> notification
    - No approver -> 409 MEETING_EXTENSION_NO_APPROVER
    - Notif failure -> 500, pending request khong tao
    - Meeting not found/soft-deleted -> 404
    - Not Host -> 403
    - Not in_progress -> 409
    - No room -> 409
    - No active booking -> 409
    - NOT covered: approve/reject endpoint (OOS)
- [ ] T014 Controller unit tests trong src/modules/live-meeting/tests/live-meeting.controller.spec.ts:
    - POST endpoint goi service dung params
    - ParseUUIDPipe reject invalid meetingId -> 400
    - @RequirePermissions(meeting.extension.request.own) present

---

## Requirements Coverage

| Task ID | FR | AC | Component |
|---|---|---|---|
| T001 | - | - | MeetingEventType enum |
| T002 | - | - | Permission seed |
| T003 | - | - | Error constants |
| T004 | - | - | DTO files |
| T005 | FR-004, FR-005 | AC-015, AC-016 | Policy loader |
| T006 | FR-001,FR-002,FR-003,FR-005 | AC-009, AC-010 | Validation |
| T007 | FR-007, FR-019 | AC-012 | Conflict check |
| T008 | FR-006,FR-008,FR-009,FR-010,FR-011,FR-020 | AC-001,002,003,013 | Auto-apply tx |
| T009 | FR-001 | AC-001 | Controller |
| T010 | - | - | WebSocket |
| T011 | FR-012,FR-013,FR-014,FR-015 | AC-004,005,006,008 | Approver |
| T012 | FR-012,FR-013,FR-014,FR-015,FR-016,FR-017,FR-018,FR-021 | AC-004,005,006,007,011,014,017,018,019,020 | Pending+notif |
| T013 | All FR | AC-001-020 | Service tests |
| T014 | FR-001 | - | Controller tests |