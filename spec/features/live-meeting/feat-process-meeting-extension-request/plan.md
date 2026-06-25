# Implementation Plan: Phê duyệt hoặc từ chối yêu cầu gia hạn phiên họp (UC-IMM-03)

**Feature Directory**: spec/features/live-meeting/feat-process-meeting-extension-request
**Date**: 2026-06-16
**Spec**: spec.md
**Research**: research.md
**Data Model**: data-model.md
**API Contract**: contracts/extension-decide-api.md
**Quickstart**: quickstart.md

---

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Tạo plan lần đầu cho UC-IMM-03 | Toàn bộ file |

---

## 1. Feature Summary

Cho phép Manager/Approver phê duyệt hoặc từ chối yêu cầu gia hạn phiên họp đang pending (được tạo bởi UC-IMM-02). Hỗ trợ 3 path:

- **Approve (no conflict)**: Re-check room conflict tại thời điểm decide. Nếu không conflict, UPDATE meeting_requests (applied) + meetings.end_time + room_bookings/room_booking_usages.reserved_end_time + INSERT meeting_events + audit_logs + notification cho Host.
- **Reject (Manager decision)**: UPDATE meeting_requests (rejected) + INSERT meeting_events + audit_logs + notification cho Host. Không thay đổi meeting/booking/usage.
- **Reject (Re-validation conflict)**: Khi Manager approve nhưng phát hiện room conflict lúc re-validation → tự động reject với conflict_summary_json + rejection_reason.

Idempotency: request đã `applied` hoặc `rejected` không thể xử lý lại.

## 2. Technical Context

| Aspect | Detail |
|---|---|
| **Framework** | NestJS (TypeScript) |
| **ORM** | TypeORM, DataSource pattern với transaction + pessimistic lock |
| **Database** | PostgreSQL, 39 tables v3.2 Compact |
| **Realtime** | Socket.IO qua WebsocketService (best-effort) |
| **Auth** | JWT Bearer + @UseGuards(JwtAuthGuard, PermissionsGuard) |
| **Permissions** | `meeting.session.extension.decide` (normal) + `meeting.session.extension.override` (override — Proposed) |
| **Target Module** | live-meeting (đã có service/controller từ UC-IMM-01, UC-IMM-02) |
| **Module phụ thuộc** | meetings, rooms, accounts (users), websocket, auth, administration (audit), notifications |

## 3. Scope Confirmation

### IN SCOPE
- API: POST /api/v1/live-meetings/{meetingId}/extension-requests/{requestId}/decide
- Permission `meeting.session.extension.decide` + seed
- Permission `meeting.session.extension.override` (Proposed) + seed
- Approver list check từ `meeting_requests.rule_snapshot_json.approverIds`
- Admin override qua explicit permission `meeting.session.extension.override`
- Re-validation room conflict check tại thời điểm approve (dynamic query từ room_bookings)
- Approve path: UPDATE meeting_requests (applied) + meetings.end_time + room_bookings/room_booking_usages + INSERT meeting_events + audit_logs + notifications
- Reject path (Manager decision): UPDATE meeting_requests (rejected, rejection_reason) + INSERT meeting_events + audit_logs + notifications
- Reject path (re-validation conflict): tự động reject với conflict_summary_json + rejection_reason + meeting_events + audit_logs
- Idempotency guard: request đã xử lý không thể xử lý lại
- Concurrency: SELECT FOR UPDATE trên meeting_requests, meetings, room_bookings + re-check state sau lock
- Thêm `extension_approved` và `extension_rejected` vào MeetingEventType enum
- Thêm error codes mới vào MEETING_EXTENSION_ERRORS constant
- Thêm DTO cho decide endpoint

### OUT OF SCOPE
- Tạo mới extension request (UC-IMM-02)
- Tìm kiếm Manager/Approver (UC-IMM-02)
- Gửi notification cho Manager về pending request (UC-IMM-02)
- Auto-reject pending request hết hạn (background job future)
- Dời/hủy meeting sau để giải phóng phòng
- Tạo overlap booking
- Thêm bảng/cột mới vào database
- Cập nhật meetings.start_time hoặc actual_end_time
- Email notification (disabled default v1)
- Xóa/archive request đã xử lý

## 4. Data Model Impact

**UPDATE (approve path)**:
- meeting_requests: approval_status = applied, decision_by, decision_at, notes
- meetings: end_time = requestedNewEndTime, updated_by, updated_at
- room_bookings: reserved_end_time = requestedNewEndTime (WHERE status IN active/approved)
- room_booking_usages: reserved_end_time = requestedNewEndTime (WHERE usage_status IN in_use/not_started)

**UPDATE (reject path — Manager hoặc re-validation)**:
- meeting_requests: approval_status = rejected, rejection_reason, decision_by, decision_at, notes
- meeting_requests: conflict_summary_json (chỉ khi re-validation conflict)

**INSERT (approve path + reject path)**:
- meeting_events: event_type = extension_approved hoặc extension_rejected
- audit_logs: action_type = extend_meeting hoặc extend_meeting_reject
- notifications: type = meeting_extension_approved hoặc meeting_extension_rejected (cho Host)

**READ-only**:
- meeting_requests: rule_snapshot_json.approverIds (kiểm tra quyền)
- room_bookings: re-validation conflict check

**Entity changes**: Thêm EXTENSION_APPROVED, EXTENSION_REJECTED vào MeetingEventType enum

Chi tiết xem data-model.md

## 5. API / Contract Plan

| Method | Path | Permission |
|---|---|---|
| POST | /api/v1/live-meetings/{meetingId}/extension-requests/{requestId}/decide | meeting.session.extension.decide hoặc meeting.session.extension.override |

Chi tiết request/response/error codes xem contracts/extension-decide-api.md

## 6. Authorization Plan

- @UseGuards(JwtAuthGuard, PermissionsGuard) với OR logic cho 2 permissions:
  - `meeting.session.extension.decide` (normal)
  - `meeting.session.extension.override` (override — Proposed)
- Nếu user dùng `meeting.session.extension.decide`:
  - Kiểm tra userId có trong `meeting_requests.rule_snapshot_json.approverIds` không
  - Nếu không → 403 PERMISSION_DENIED
- Nếu user dùng `meeting.session.extension.override`:
  - Cho phép xử lý request bất kỳ (không cần trong approver list)
- Người quyết định không được là Host của meeting (trừ khi Host giữ role Manager phòng ban)
- Seed permissions:
  - `meeting.session.extension.decide`: MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN
  - `meeting.session.extension.override` (Proposed): BUSINESS_ADMIN, SYSTEM_ADMIN

## 7. Business Logic Plan

### Service method: decideExtension(meetingId, requestId, decideDto, authUser)

**Flow:**

1. **Validate permissions** (Guard layer):
   - JWT auth
   - Permission check (decide hoặc override)
   - Guard pass → vào service

2. **Service validation** (trước transaction):
   - Tìm meeting_requests với id = requestId, meeting_id = meetingId
   - Kiểm tra request tồn tại → 404 RESOURCE_NOT_FOUND
   - Kiểm tra `approval_status = pending` → nếu không → 409 REQUEST_ALREADY_PROCESSED
   - Kiểm tra `request_type = extend_meeting` → nếu không → 400 VALIDATION_ERROR
   - Kiểm tra decision value: `approved` hoặc `rejected` → nếu không → 422 VALIDATION_ERROR
   - Kiểm tra quyền truy cập request:
     - User có override permission? → skip approver check
     - User có decide permission? → check userId trong `rule_snapshot_json.approverIds`
     - Không thỏa điều kiện nào → 403 PERMISSION_DENIED

3. **Authorize quyết định**:
   - Nếu `decision = approved`:
     - Kiểm tra meeting vẫn `in_progress` → nếu không → reject (không approve)
     - Re-validation conflict check trong `[oldEndTime, requestedNewEndTime)`
       - Query room_bookings exclude current booking
       - Status blocking: pending, approved, active
       - Nếu có conflict → tự động chuyển sang reject path (re-validation)
   - Nếu `decision = rejected`:
     - Skip conflict check

4. **Transaction với pessimistic lock**:
   ```
   dataSource.transaction(async (manager) => {
     // 4a. Lock meeting_requests row
     const request = await manager.findOne(MeetingRequestEntity, {
       where: { id: requestId },
       lock: { mode: 'pessimistic_write' }
     });
     // 4b. Re-check validation sau lock (idempotency)
     if (request.approval_status !== 'pending') {
       throw new ConflictException(REQUEST_ALREADY_PROCESSED);
     }
     
     // 4c. Nếu approve: lock meetings + room_bookings
     if (decision === 'approved') {
       const meeting = await manager.findOne(MeetingEntity, {
         where: { id: meetingId },
         lock: { mode: 'pessimistic_write' }
       });
       // Re-check meeting status sau lock
       if (meeting.status !== 'in_progress') {
         // Chuyển thành reject path
         decision = 'rejected';
         rejectionReason = 'Meeting no longer in_progress';
       }
       
       if (decision === 'approved') {
         const booking = await manager.findOne(RoomBookingEntity, {
           where: { meeting_id: meetingId, status: In(['active', 'approved']) },
           lock: { mode: 'pessimistic_write' }
         });
         
         // 4d. Re-validation conflict sau lock
         const conflictExists = await checkRoomConflict(manager, roomId, currentBookingId, oldEndTime, requestedNewEndTime);
         if (conflictExists) {
           decision = 'rejected';
           rejectionReason = 'Room conflict detected';
         }
       }
     }
     
     // 4e. UPDATE meeting_requests
     if (decision === 'approved') {
       await manager.update(MeetingRequestEntity, requestId, {
         approval_status: 'applied',
         decision_by: authUser.userId,
         decision_at: new Date(),
         notes: `Approved by ${authUser.userId}`
       });
       // 4f. UPDATE meetings.end_time
       await manager.update(MeetingEntity, meetingId, {
         end_time: requestedNewEndTime,
         updated_by: authUser.userId,
         updated_at: new Date()
       });
       // 4g. UPDATE room_bookings.reserved_end_time
       await manager.update(RoomBookingEntity, bookingId, {
         reserved_end_time: requestedNewEndTime
       });
       // 4h. UPDATE room_booking_usages.reserved_end_time
       await manager.update(RoomBookingUsageEntity, usageId, {
         reserved_end_time: requestedNewEndTime
       });
       // 4i. INSERT meeting_events (extension_approved)
       await manager.insert(MeetingEventEntity, { ... });
       // 4j. INSERT audit_logs (extend_meeting)
       await manager.insert(AuditLogEntity, { ... });
     } else {
       // reject path (Manager decision hoặc re-validation)
       await manager.update(MeetingRequestEntity, requestId, {
         approval_status: 'rejected',
         rejection_reason: rejectionReason,
         decision_by: authUser.userId,
         decision_at: new Date(),
         conflict_summary_json: conflictDetails || null,
         notes: `Rejected by ${authUser.userId}`
       });
       // INSERT meeting_events (extension_rejected)
       await manager.insert(MeetingEventEntity, { ... });
       // INSERT audit_logs (extend_meeting hoặc extend_meeting_reject)
       await manager.insert(AuditLogEntity, { ... });
       // KHÔNG thay đổi meetings/room_bookings/room_booking_usages
     }
   })
   ```

5. **Post-tx** (best-effort, ngoài transaction):
   - Gửi notification cho Host (in_app)
   - Push WebSocket event đến room `meeting:{meetingId}`
   - Nếu notification/WS fail → log error, không rollback

### WebSocket Events
- Approve: eventType = `meeting.extension.approved`, payload = { meetingId, oldEndTime, newEndTime, extensionMinutes }
- Reject: eventType = `meeting.extension.rejected`, payload = { meetingId, rejectionReason }

## 8. Validation Plan

| Validation | Layer | Error Code | HTTP |
|---|---|---|---|
| meetingId UUID format | Controller (ParseUUIDPipe) | — | 400 |
| requestId UUID format | Controller (ParseUUIDPipe) | — | 400 |
| JWT auth | Guard | UNAUTHORIZED | 401 |
| Permission decide OR override | Guard | PERMISSION_DENIED | 403 |
| Request tồn tại | Service | RESOURCE_NOT_FOUND | 404 |
| request_type = extend_meeting | Service | VALIDATION_ERROR | 422 |
| approval_status = pending | Service | REQUEST_ALREADY_PROCESSED | 409 |
| decision = approved hoặc rejected | Service | VALIDATION_ERROR | 422 |
| Approver list check (decide permission) | Service | PERMISSION_DENIED | 403 |
| Meeting vẫn in_progress (approve path) | Service (re-validation) | MEETING_NOT_ACTIVE | 409 |
| Room conflict re-validation (approve path) | Service (re-validation) | ROOM_CONFLICT | 409 |
| Idempotency sau lock | Service (tx) | REQUEST_ALREADY_PROCESSED | 409 |
| Transaction rollback | Service (tx) | INTERNAL_ERROR | 500 |

## 9. Error Handling Plan

- NotFoundException → 404 RESOURCE_NOT_FOUND
- ForbiddenException → 403 PERMISSION_DENIED
- ConflictException → 409 (REQUEST_ALREADY_PROCESSED / MEETING_NOT_ACTIVE / ROOM_CONFLICT)
- BadRequestException → 400
- UnprocessableEntityException → 422 VALIDATION_ERROR
- Transaction rollback tự động khi exception trong transaction
- Notification failure: best-effort, log error, không rollback transaction
- WS push failure: best-effort, log error

### Error code mapping từ spec

| Error Code (Spec) | HTTP | Exception type |
|---|---|---|
| VALIDATION_ERROR | 422 | UnprocessableEntityException |
| UNAUTHORIZED | 401 | UnauthorizedException |
| PERMISSION_DENIED | 403 | ForbiddenException |
| RESOURCE_NOT_FOUND | 404 | NotFoundException |
| REQUEST_ALREADY_PROCESSED | 409 | ConflictException |
| MEETING_NOT_ACTIVE | 409 | ConflictException |
| ROOM_CONFLICT | 409 | ConflictException |
| INTERNAL_ERROR | 500 | InternalServerErrorException |

## 10. Testing Strategy

### Service Unit Tests

**Approve path:**
- Approve happy path: tất cả tables cập nhật đúng
- Approve WS event pushed
- Re-validation conflict check đúng logic (pending/approved/active blocking)
- Re-validation conflict check exclude current booking
- Re-validation conflict → tự động reject + conflict_summary_json

**Reject path (Manager):**
- Reject happy path: meeting_requests updated, meetings không đổi
- Reject với reason
- Reject không reason

**Authorization:**
- User không có permission → 403
- User có decide nhưng không trong approver list → 403
- User có override permission → bypass approver check thành công
- User self-approve (Host) → 403

**Validation:**
- Request không tồn tại → 404
- approval_status != pending → 409
- decision invalid value → 422
- request_type != extend_meeting → 422

**Concurrency/Idempotency:**
- Request đã xử lý gọi lại → 409
- Concurrent decide → chỉ 1 thành công
- Meeting end_time không thay đổi khi reject

**State re-validation sau lock:**
- Meeting chuyển sang completed trong lúc đang duyệt → reject path
- Room conflict xuất hiện sau lock → reject path

**Notification:**
- Approve → notification cho Host (meeting_extension_approved)
- Reject → notification cho Host (meeting_extension_rejected)
- Notification failure → không rollback

### Controller Unit Tests
- POST gọi service đúng params
- ParseUUIDPipe invalid meetingId / requestId
- RequirePermissions decorator hoạt động (decide + override)

## 11. Implementation Phases

### Phase 1: Foundation
- T001: Thêm EXTENSION_APPROVED, EXTENSION_REJECTED vào MeetingEventType enum
- T002: Tạo TypeORM migration cập nhật PostgreSQL enum meeting_event_type
- T003: Thêm error codes mới vào MEETING_EXTENSION_ERRORS constant
- T004: Tao seed permissions: meeting.session.extension.decide, meeting.session.extension.override
- T005: Tạo DecideExtensionDto (request body) và DecideExtensionResponseDto

### Phase 2: Core Logic — Decide Service
- T006: Implement validateDecideRequest() trong LiveMeetingService
- T007: Implement checkDecidePermission() trong LiveMeetingService
- T008: Implement decideExtension() method (Approve/Reject path + lock + transaction)
- T009: Implement checkRoomConflictForDecide() re-validation helper
- T010: Implement notification + WebSocket push (best-effort)

### Phase 3: Controller
- T011: Implement controller endpoint POST extension-requests/:requestId/decide
- T012: Cập nhật LiveMeetingModule providers/imports

### Phase 4: Testing
- T013: Service unit tests (approve, reject, re-validation, authorization, concurrency)
- T014: Controller unit tests (params, guards, response)

## 12. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Inject pattern NotificationsService/AuditLogService chưa rõ | Med | Med | Codebase inspection trước implement |
| Transaction locking conflict với End Meeting | High | Low | Lock cả 3 bảng + re-check state sau lock |
| Quên seed permission | High | Low | Seed task trong Phase 1 Foundation |
| Re-validation conflict query sai exclude logic | High | Med | Unit test + edge case coverage |
| MeetingEventType enum chưa có extension_approved/rejected | Med | Low | Thêm enum trong Phase 1 |
| OR logic cho 2 permissions trên cùng endpoint | Med | Low | Dùng OR combiner trong PermissionsGuard (hoặc custom guard) |
| Notification/WS service injection chưa có | Med | Med | Contribute to existing (chưa rõ pattern) |

## 13. Acceptance Criteria Traceability

| AC ID | Verification | Path | Phase |
|---|---|---|---|
| AC-001 | Approve không conflict: data updated + events/audit/notification | Approve | Phase 2 |
| AC-002 | Decision invalid value → 422 | Validation | Phase 2 |
| AC-003 | Permission denied → 403 | Auth | Phase 1 |
| AC-004 | User not in approver list + no override → 403 | Auth | Phase 2 |
| AC-004b | Admin override thành công với override permission | Auth (override) | Phase 2 |
| AC-005 | Request not found → 404 | Validation | Phase 2 |
| AC-006 | Request đã xử lý → 409, không đổi data | Idempotency | Phase 2 |
| AC-007 | Meeting không in_progress → 409 | Re-validation | Phase 2 |
| AC-008 | Re-validation conflict → auto reject + conflict_summary_json | Re-validation | Phase 2 |
| AC-009 | Audit log cho approve | Audit | Phase 2 |
| AC-010 | Notification approve cho Host | Notification | Phase 2 |
| AC-011 | Notification reject cho Host | Notification | Phase 2 |
| AC-012 | Meeting events extension_approved/extension_rejected | Event | Phase 2 |
| AC-013 | Race condition → lock + re-check | Concurrency | Phase 2 |
| AC-014 | Transaction rollback khi lỗi | Transaction | Phase 2 |
