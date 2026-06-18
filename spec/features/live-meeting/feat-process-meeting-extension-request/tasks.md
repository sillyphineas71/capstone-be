# Tasks: Phê duyệt hoặc từ chối yêu cầu gia hạn phiên họp (UC-IMM-03)

**Feature Directory**: spec/features/live-meeting/feat-process-meeting-extension-request
**Date**: 2026-06-16
**Spec**: spec.md
**Plan**: plan.md

---

## CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Tạo tasks lần đầu cho UC-IMM-03 | Toàn bộ file |
| 2026-06-17 | Thêm task TypeORM migration, cập nhật task numbering | Toàn bộ file |

---

## Phase 1: Foundation

### Mục tiêu
Thiết lập các thay đổi nền tảng: enum event type, database migration, error codes, seed permissions, DTO files.

### Tasks

- [x] T001 [P] Thêm EXTENSION_APPROVED = extension_approved và EXTENSION_REJECTED = extension_rejected vào MeetingEventType enum trong src/modules/meetings/entities/meeting-event.entity.ts

- [x] T002 [P] Tạo TypeORM migration cập nhật PostgreSQL enum meeting_event_type:
    - File: src/database/migrations/{timestamp}-UpdateMeetingEventTypeEnum.ts
    - up(): Dùng lệnh `ALTER TYPE meeting_event_type ADD VALUE IF NOT EXISTS 'extension_approved';` và `ALTER TYPE meeting_event_type ADD VALUE IF NOT EXISTS 'extension_rejected';`. Không recreate/drop enum type.
    - down(): Ghi chú (comment) rằng down migration cho PostgreSQL enum cần cẩn trọng vì không thể remove enum value an toàn nếu không recreate type, do đó down() có thể để trống hoặc throw log warning.

- [x] T003 [P] Thêm error codes mới vào MEETING_EXTENSION_ERRORS constant trong src/modules/live-meeting/constants/meeting-extension-error.constant.ts:
    - RESOURCE_NOT_FOUND (404)
    - REQUEST_ALREADY_PROCESSED (409)
    - MEETING_NOT_ACTIVE (409)
    - ROOM_CONFLICT (409)
    - VALIDATION_ERROR (422)

- [x] T004 [P] Tao file seed permissions: src/database/seeds/{timestamp}-SeedMeetingExtensionDecidePermission.ts
    - Seed permission meeting.session.extension.decide cho roles: MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN
    - Seed permission meeting.session.extension.override cho roles: BUSINESS_ADMIN, SYSTEM_ADMIN (Proposed, can dong bo API contract)
    - Tham khảo seed file hiện có của meeting.extension.request.own để giữ pattern

- [x] T005 [P] Tao DTO files:
    - src/modules/live-meeting/dto/decide-extension.dto.ts:
      - decision: string (required, enum: approved | rejected)
      - reason: string (optional, max 500)
      - Validation: @IsIn(['approved', 'rejected']), @IsString, @MaxLength(500), @IsOptional cho reason
    - src/modules/live-meeting/dto/decide-extension-response.dto.ts:
      - requestId: uuid
      - decision: string (approved | rejected)
      - status: string (applied | rejected)
      - oldEndTime: datetime (optional, chỉ có khi approve)
      - newEndTime: datetime (optional, chỉ có khi approve)
      - extensionMinutes: number (optional, chỉ có khi approve)
      - rejectionReason: string (optional, chỉ có khi reject)
      - decisionAt: datetime
      - message: string
    - Cap nhat src/modules/live-meeting/dto/index.ts de export DTO moi

**Checkpoint**: Foundation ready — enum, error codes, permissions, DTO dã sẵn sàng.

---

## Phase 2: Core Logic — Decide Service

### Mục tiêu
Implement toàn bộ business logic cho decideExtension() trong LiveMeetingService.

### Phụ thuộc
- T001, T003, T004, T005 (Phase 1 Foundation)

### Tasks

- [x] T006 [P] Implement validateDecideRequest() trong LiveMeetingService (src/modules/live-meeting/services/live-meeting.service.ts):
    - Method: private validateDecideRequest(requestId: string, meetingId: string, authUser: AuthUser)
    - Query meeting_requests với id=requestId, meeting_id=meetingId, request_type=extend_meeting
    - Throw NotFoundException với MEETING_EXTENSION_ERRORS.RESOURCE_NOT_FOUND nếu request không tồn tại
    - Throw ConflictException với MEETING_EXTENSION_ERRORS.REQUEST_ALREADY_PROCESSED nếu approval_status != pending (kèm details: currentStatus, processedAt, decisionBy)
    - Return MeetingRequestEntity nếu hợp lệ

- [x] T007 [P] Implement checkDecidePermission() trong LiveMeetingService (src/modules/live-meeting/services/live-meeting.service.ts):
    - Method: private checkDecidePermission(request: MeetingRequestEntity, authUser: AuthUser)
    - Doc rule_snapshot_json.approverIds từ request
    - Neu authUser co override permission: cho phép (return true)
    - Neu authUser co decide permission: kiểm tra userId trong approverIds
    - Throw ForbiddenException với PERMISSION_DENIED nếu không thỏa điều kiện nào
    - Lưu ý: không hard-code role name, dùng explicit permission check

- [x] T008 Implement approve path — decideExtension(approve) trong LiveMeetingService (src/modules/live-meeting/services/live-meeting.service.ts):
    - Method: public async decideExtension(meetingId: string, requestId: string, dto: DecideExtensionDto, authUser: AuthUser): Promise<DecideExtensionResponseDto>
    - Goi validateDecideRequest() + checkDecidePermission()
    - Parse decision từ DTO: throw UnprocessableEntityException(VALIDATION_ERROR) nếu không phải approved/rejected
    - Neu decision = approved:
      1. Kiểm tra meeting vẫn in_progress → nếu không → chuyển thành reject path
      2. Re-validation conflict check từ room_bookings (goi helper)
      3. Transaction với SELECT FOR UPDATE trên meeting_requests, meetings, room_bookings:
         a. Re-check approval_status sau lock (idempotency)
         b. Re-check meeting status sau lock
         c. Re-check room conflict sau lock
         d. Neu OK: UPDATE meeting_requests (applied) + meetings.end_time + room_bookings.reserved_end_time + room_booking_usages.reserved_end_time
         e. INSERT meeting_events (extension_approved)
         f. INSERT audit_logs (extend_meeting)
      4. Post-tx: notification + WS (best-effort)
      5. Return DecideExtensionResponseDto (decision=approved, status=applied, newEndTime)
    - Neu decision = rejected:
      1. Transaction: UPDATE meeting_requests (rejected, rejection_reason) + meeting_events (extension_rejected) + audit_logs (extend_meeting_reject)
      2. Post-tx: notification + WS (best-effort)
      3. Return DecideExtensionResponseDto (decision=rejected, status=rejected, rejectionReason)

- [x] T009 Implement re-validation conflict helper trong LiveMeetingService (src/modules/live-meeting/services/live-meeting.service.ts):
    - Method: private async checkRoomConflictForDecide(manager: EntityManager, roomId: string, currentBookingId: string, oldEndTime: Date, requestedNewEndTime: Date): Promise<{ hasConflict: boolean; conflicts: ConflictDetail[] }>
    - Query room_bookings: room_id, status IN (pending, approved, active), NOT current booking, reserved_start_time < requestedNewEndTime AND reserved_end_time > oldEndTime
    - Include booking của meeting khác (exclude chính meeting hiện tại)
    - Trả về danh sách conflict chi tiết (conflictingMeetingId, conflictingBookingId, conflictStart, conflictEnd)
    - Nếu có conflict → approve path tự động chuyển thành reject path (re-validation reject)

- [x] T010 Implement notification + WebSocket push cho decide result trong LiveMeetingService (src/modules/live-meeting/services/live-meeting.service.ts):
    - Method: private async notifyDecideResult(meetingId: string, requestId: string, decision: string, hostUserId: string, details: object)
    - Tạo notification cho Host:
      - Neu approve: notification_type = meeting_extension_approved, payload chứa newEndTime, extensionMinutes
      - Neu reject: notification_type = meeting_extension_rejected, payload chứa rejectionReason
      - channel = in_app, priority = high, recipient_scope = user_list, recipient_user_ids_json = [hostUserId]
    - Push WebSocket event (best-effort, không throw):
      - Approve: eventType = meeting.extension.approved, room = meeting:{meetingId}
      - Reject: eventType = meeting.extension.rejected, room = meeting:{meetingId}
    - Gọi sau transaction (best-effort), log error nếu fail, không rollback

**Checkpoint**: Core decide logic hoàn chỉnh — approve/reject/re-validation conflict dã implement.

---

## Phase 3: Controller

### Mục tiêu
Expose endpoint POST decide cho Manager/Admin.

### Phụ thuộc
Phase 2 (T007-T011) phải hoàn thành.

### Tasks

- [x] T011 Implement decide endpoint trong LiveMeetingController (src/modules/live-meeting/controllers/live-meeting.controller.ts):
    - @Post(live-meetings/:meetingId/extension-requests/:requestId/decide)
    - @HttpCode(HttpStatus.OK)
    - @UseGuards(JwtAuthGuard, PermissionsGuard) với custom OR logic cho 2 permissions: meeting.session.extension.decide HOẶC meeting.session.extension.override
    - @ApiBearerAuth(), @ApiOperation(...), @ApiParam(...), @ApiResponse(...)
    - @Param(meetingId, ParseUUIDPipe) meetingId: string
    - @Param(requestId, ParseUUIDPipe) requestId: string
    - @Body() decideDto: DecideExtensionDto
    - @Req() request: Request
    - Goi this.liveMeetingService.decideExtension(meetingId, requestId, decideDto, authUser)
    - Return { success: true, message, data: DecideExtensionResponseDto }

- [x] T012 Cập nhật LiveMeetingModule providers/imports nếu cần (src/modules/live-meeting/live-meeting.module.ts):
    - Kiểm tra đã import NotificationsModule, AdministrationModule (audit) chưa
    - Nếu thiếu, thêm imports để service có thể inject NotificationsService, AuditLogService
    - Kiểm tra live-meeting module đã export đầy đủ chưa

**Checkpoint**: Decide endpoint có thể gọi được từ bên ngoài.

---

## Phase 4: Testing

### Mục tiêu
Unit test cho service và controller.

### Phụ thuộc
Phase 2, Phase 3 phải hoàn thành.

### Tasks

- [ ] T013 Service unit tests trong src/modules/live-meeting/tests/live-meeting.service.spec.ts:
    - **Approve happy path**: approve không conflict → meeting_requests.approval_status = applied, meetings.end_time updated, room_bookings updated, meeting_events/audit_logs inserted
    - **Reject (Manager decision)**: reject → meeting_requests.approval_status = rejected, rejection_reason, meetings.end_time không đổi, meeting_events/audit_logs inserted
    - **Re-validation conflict**: approve nhưng có room conflict → tự động reject + conflict_summary_json
    - **Re-validation meeting not in_progress**: approve nhưng meeting đã completed → reject path
    - **Authorization**: user không có permission → 403
    - **Approver list**: user có decide nhưng không trong approver list → 403
    - **Override**: user có override permission → bypass approver list thành công
    - **Idempotency**: request dã applied gọi lại → 409
    - **Request not found** → 404
    - **Decision invalid** → 422
    - **Notification**: approve gửi meeting_extension_approved, reject gửi meeting_extension_rejected
    - **Notification/WS failure**: không rollback transaction
    - **Transaction rollback**: khi insert event lỗi → toàn bộ rollback

- [ ] T014 Controller unit tests trong src/modules/live-meeting/tests/live-meeting.controller.spec.ts:
    - POST endpoint gọi service đúng params
    - ParseUUIDPipe invalid meetingId → 400
    - ParseUUIDPipe invalid requestId → 400
    - @UseGuards(JwtAuthGuard, PermissionsGuard) present
    - Response format { success, message, data } đúng chuẩn

**Checkpoint**: Tất cả unit tests pass.

---

## Requirements Coverage

| Task ID | FR | AC | Component |
|---|---|---|---|
| T001 | FR-032 | AC-012 | MeetingEventType enum: extension_approved, extension_rejected |
| T002 | FR-032 | AC-012 | Database migration cho MeetingEventType enum |
| T003 | FR-016, FR-017, FR-019, FR-020, FR-021 | AC-002, AC-005, AC-006, AC-007, AC-008 | Error constants |
| T004 | FR-017, FR-018, FR-027, FR-028 | AC-003, AC-004, AC-004b | Permission seed |
| T005 | FR-001, FR-021 | AC-001, AC-002 | DTO files |
| T006 | FR-002, FR-016, FR-020, FR-031 | AC-005, AC-006 | Validation pre-tx |
| T007 | FR-017, FR-018, FR-027, FR-028 | AC-003, AC-004, AC-004b | Permission check |
| T008 | FR-001, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-011, FR-012, FR-013, FR-019, FR-022, FR-023, FR-024, FR-025, FR-029, FR-030, FR-032, FR-033, FR-034, FR-035, FR-036, FR-036b, FR-037, FR-038, FR-039, FR-040 | AC-001, AC-007, AC-008, AC-009, AC-010, AC-011, AC-012, AC-013, AC-014 | Decide core logic |
| T009 | FR-004, FR-011, FR-012, FR-013, FR-014, FR-015 | AC-001, AC-008 | Re-validation conflict |
| T010 | FR-006, FR-008, FR-023, FR-024, FR-025 | AC-010, AC-011 | Notification + WS |
| T011 | FR-001, FR-026 | AC-001 | Controller endpoint |
| T012 | — | — | Module imports |
| T013 | All FRs | AC-001 — AC-014 | Service tests |
| T014 | FR-001, FR-026 | AC-001 | Controller tests |




