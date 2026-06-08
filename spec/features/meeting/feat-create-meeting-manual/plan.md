# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-08 | Tạo plan lần đầu | Toàn bộ file |
| 2026-06-08 | Consistency fixes: thêm section 4 (Consistency Fixes & Key Decisions), renumber sections 5→14, fix audit/notification field names (actionType, metadataJson, notificationType), fix room active check (isActive), add cross-artifact decision log | Section 4, 5-14, Business Logic, Approver Resolution |

# 📝 Implementation Plan: Tạo cuộc họp mới thủ công

**Feature ID**: MEETING-CREATE-MANUAL-001
**Date**: 2026-06-08
**Source Spec**: `spec/features/meeting/feat-create-meeting-manual/spec.md`

---

## 1. Feature Summary

Cho phép Internal Employee/Manager tạo yêu cầu cuộc họp mới thủ công thông qua API. Yêu cầu được tạo ở trạng thái **pending_approval** (chờ duyệt), kèm theo room booking **pending**, và notification gửi đến Manager/Approver.

### Key behaviors:
- Validate input → kiểm tra conflict → tạo meeting + meeting_requests + room_bookings + participants + notification + audit log trong 1 transaction
- Host mặc định = authenticated user nếu không cung cấp; host auto-add vào participants
- Capacity check: hard reject nếu vượt quá capacity, trừ khi `capacity_override_confirmed = true`
- Không gửi email/in-app thực tế — chỉ tạo notification record

---

## 2. Technical Context

### Stack
| Component | Technology | Source |
|-----------|------------|--------|
| Framework | NestJS 11 | Existing |
| ORM | TypeORM | Existing |
| Database | PostgreSQL (UUID PK, timestamptz) | Existing |
| Auth | JWT + JwtAuthGuard + PermissionsGuard | Existing in auth module |
| Validation | class-validator DTOs + ValidationPipe | Existing pattern |
| Transaction | `DataSource.transaction()` | Pattern from accounts module |
| Response | Manual `{ success, message, data }` | Existing pattern |

### Module Dependencies
| Module | Import For | Current Status |
|--------|------------|----------------|
| `MeetingsModule` | Own entities (8 entities exist) | **No controller/service** — must create |
| `RoomsModule` | RoomBookingEntity, RoomEntity | Entities exist |
| `NotificationsModule` | NotificationEntity | Entity exists; may need `TypeOrmModule.forFeature` export |
| `AdministrationModule` | AuditLogEntity | Entity exists; may need `TypeOrmModule.forFeature` export |
| `AccountsModule` | UserEntity validation | Already imported in meetings.module |
| `AuthModule` | Guards & decorators | Ready |

### Reusable Components
- `JwtAuthGuard` — ready
- `PermissionsGuard` — ready
- `@RequirePermissions('meeting.create')` — ready
- `DataSource` (for transactions) — available from `@nestjs/typeorm`

### Existing Entities (no schema changes needed)
- `MeetingEntity` — `meetings/entities/meeting.entity.ts`
- `MeetingRequestEntity` — `meetings/entities/meeting-request.entity.ts`
- `MeetingParticipantEntity` — `meetings/entities/meeting-participant.entity.ts`
- `MeetingExternalParticipantEntity` — `meetings/entities/meeting-external-participant.entity.ts`
- `MeetingEventEntity` — `meetings/entities/meeting-event.entity.ts`
- `RoomBookingEntity` — `rooms/entities/room-booking.entity.ts`
- `RoomEntity` — `rooms/entities/room.entity.ts`
- `NotificationEntity` — `notifications/entities/notification.entity.ts`
- `AuditLogEntity` — `administration/entities/audit-log.entity.ts`

---

## 3. Scope Confirmation

### In Scope
- POST /api/v1/meetings — create meeting request with pending_approval
- Room conflict check (pending/approved/active bookings)
- Participant conflict warning (soft warning, not blocking)
- Capacity check with override support
- Host auto-default + auto-add to participants
- Auto-generation of meeting_code and booking_code
- Notification record creation (queued, no actual delivery)
- Audit logging

### Out of Scope (confirmed in spec Section 8)
- ❌ Approve/reject meeting requests
- ❌ Email/SMTP delivery (only notification record)
- ❌ WebSocket push for creation event
- ❌ Recurring meetings
- ❌ Integration with camera/IoT
- ❌ External calendar sync
- ❌ Import participants from file
- ❌ Edit/cancel after creation

### Constitution Gate Check (PASS)

| Gate | Status | Notes |
|------|--------|-------|
| **DB Gate** | ✅ PASS | No new tables/columns; uses existing 39-table schema |
| **Security Gate** | ✅ PASS | JWT auth, permission guard, no sensitive data in responses |
| **Scope Gate** | ✅ PASS | Only what spec defines; OOS sections respected |
| **Module Gate** | ✅ PASS | Logic stays in meetings module; imports other modules via TypeOrm |
| **API Gate** | ✅ PASS | Response format matches existing `{ success, message, data }` |
| **Auth Gate** | ✅ PASS | JwtAuthGuard + PermissionsGuard for the POST endpoint |
| **Test Gate** | ⏳ Planned | Unit + integration tests in implementation phase |

---

## 4. Consistency Fixes & Key Decisions

Cross-artifact consistency analysis (spec ↔ plan ↔ data-model ↔ contracts) identified the following fixes applied:

| ID | Finding | Severity | Fix |
|----|---------|----------|-----|
| C1 | FR-011 says "xem/sửa/hủy" but edit/cancel is OOS | HIGH | FR-011 changed to view-only rule |
| C2 | FR-021 & FR-039 both describe participant conflict | MEDIUM | Removed FR-039, merged to FR-021 |
| C3 | GET /api/v1/rooms/available missing from tasks | MEDIUM | Added T017b (service) + T017c (controller) + T017d (test) |
| M1 | AC-001 says "1 participant" — unrealistic | LOW | Changed to "4 participants" |
| M2 | `capacity_override` vs `capacity_override_confirmed` | MEDIUM | Standardized to `capacity_override_confirmed` |
| M3 | Approver resolution ambiguous | MEDIUM | Clarified: system_configs → rooms.approver_id → permission |
| M4 | T014/T015 missing [P] (prerequisite) marker | LOW | Added [P] to both code-gen tasks |
| M5 | Room active check used `status='active'` not `isActive` | MEDIUM | Updated to `isActive = true AND currentStatus != 'inactive'` |
| M6 | Notification field `type` vs `notificationType` | LOW | Aligned to `notificationType` |
| M7 | Audit log field `action` vs `actionType`, `metadata` vs `metadataJson` | LOW | Aligned to `actionType`, `metadataJson` |
| C2b | Participant conflict tasks missing from tasks.md | MEDIUM | Added T015b (service) + T015c (test) |

## 5. Data Model Impact

**No schema changes needed.** All tables and columns required by this feature already exist in Database v3.2 Compact.

See full detailed model: `data-model.md`

### Key fields used:
- `meetings`: id, meeting_code, title, description, organizer_id, host_id, room_id, start_time, end_time, meeting_type, meeting_mode, status, created_by, created_at
- `meeting_requests`: id, meeting_id, request_type='create_meeting', requested_by, target_room_id, requested_start_time, requested_end_time, approval_mode='manual', approval_status='pending', conflict_summary_json, request_payload_json
- `room_bookings`: id, booking_code, meeting_id, room_id, reserved_start_time, reserved_end_time, status='pending', booking_type='scheduled'
- `meeting_participants`: meeting_id, user_id, participant_role, invitation_status='pending', attendance_status='not_checked_in'
- `meeting_external_participants`: meeting_id, full_name, email, organization
- `meeting_events`: meeting_id, event_type='meeting_request_created'
- `notifications`: notificationType='MEETING_REQUEST_CREATED', recipientUserIdsJson, deliveryStatus='queued'
- `audit_logs`: actionType='create', entityType='meeting_request', entityId=request.id, metadataJson={meeting_id, booking_id}

---

## 6. API / Contract Plan

### Single endpoint: POST /api/v1/meetings

Full contract: `contracts/create-meeting-api.md`

| Aspect | Detail |
|--------|--------|
| Method | POST |
| Path | `/api/v1/meetings` |
| Auth | JWT required |
| Permission | `meeting.create` |
| Request body | CreateMeetingDto |
| Success | 201 + meeting detail |
| Error (validation) | 400 |
| Error (auth) | 401 |
| Error (permission) | 403 |
| Error (room not found) | 404 |
| Error (room conflict) | 409 |
| Error (capacity) | 422 |
| Error (system) | 500 |

### Request Flow:
```
HTTP POST → JwtAuthGuard → PermissionsGuard → Controller
  → DTO Validation (class-validator)
  → Service.create(dto, authUser)
    → Validate room exists & active
    → Validate host exists (if provided)
    → Validate participants exist
    → Check room conflict (overlap query)
    → Check capacity (if enabled)
    → Generate meeting_code, booking_code
    → DB Transaction:
        INSERT meetings
        INSERT meeting_requests
        INSERT room_bookings
        INSERT meeting_participants (host + participants)
        INSERT meeting_external_participants
        INSERT meeting_events
        INSERT notifications
        INSERT audit_logs
    → After commit: (enqueue delivery — optional)
    → Return 201
```

---

## 7. Authorization Plan

| Role | Permission | Action |
|------|------------|--------|
| Internal Employee | `meeting.create` | Can create meeting request |
| Manager/Approver | `meeting_request.approve` | Can approve request (future feature) |
| Unauthenticated | None | Rejected with 401 |
| No permission | None | Rejected with 403 |

### Implementation:
- Controller-level guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)`
- Method-level: `@RequirePermissions('meeting.create')`
- User ID extracted from `request['user'].userId` (set by JwtAuthGuard)
- host_id defaults to authenticated user if not provided
- host_id validated: if provided, must be an active user in the system

---

## 8. Business Logic Plan

### 8.1 Core Service: `MeetingsService.create(dto, authUser, ipAddress, userAgent)`

**Pre-checks (outside transaction):**
1. Validate DTO via class-validator (auto)
2. Resolve host_id: default to authUser.id if not provided
3. Verify room exists: `rooms.isActive = true` AND `rooms.currentStatus != 'inactive'` → else throw 404
4. Verify host user exists and active (if host_id != authUser.id)
5. Verify all participant_user_ids exist as active users
6. Check room booking overlap: query room_bookings for conflicting time range with status IN ('pending','approved','active')
7. If conflict → throw 409
8. Check capacity (if enabled in system_configs or user provided capacity_override_confirmed):
   - Total participants = len(participant_user_ids) + 1 (host) + len(external_participants)
   - If total > room.capacity AND capacity_override_confirmed != true → throw 422
   - If capacity_override_confirmed = true → note for audit log
9. Generate meeting_code: query daily count from meetings, format MT-YYYYMMDD-NNN
10. Generate booking_code: query daily count from room_bookings, format BK-YYYYMMDD-NNN

**Transaction body:**
```
await this.dataSource.transaction(async (em) => {
  // 1. Create meeting
  const meeting = em.create(MeetingEntity, { ... });
  await em.save(meeting);

  // 2. Create meeting_request
  const request = em.create(MeetingRequestEntity, {
    meetingId: meeting.id,
    requestType: MeetingRequestType.CREATE_MEETING,
    requestedBy: authUser.id,
    targetRoomId: dto.room_id,
    requestedStartTime: dto.start_time,
    requestedEndTime: dto.end_time,
    approvalMode: ApprovalMode.MANUAL,
    approvalStatus: ApprovalStatus.PENDING,
    conflictSummaryJson: conflictResult,
    requestPayloadJson: { ...dto },
  });
  await em.save(request);

  // 3. Create room_booking
  const booking = em.create(RoomBookingEntity, {
    meetingId: meeting.id,
    roomId: dto.room_id,
    reservedStartTime: dto.start_time,
    reservedEndTime: dto.end_time,
    status: RoomBookingStatus.PENDING,
    bookingType: BookingType.SCHEDULED,
    bookingCode,
  });
  await em.save(booking);

  // 4. Create meeting_participants (host + internal)
  const participants = [];
  // Auto-add host
  participants.push({ meetingId: meeting.id, userId: hostId, participantRole: ParticipantRole.HOST, ... });
  // Add user-provided participants
  for (const uid of dto.participant_user_ids) {
    if (uid !== hostId) {
      participants.push({ meetingId: meeting.id, userId: uid, participantRole: ParticipantRole.ATTENDEE, ... });
    }
  }
  await em.save(MeetingParticipantEntity, participants);

  // 5. Create meeting_external_participants (if any)
  if (dto.external_participants?.length) {
    const external = dto.external_participants.map(ep => ({ ... }));
    await em.save(MeetingExternalParticipantEntity, external);
  }

  // 6. Create meeting_event
  await em.save(MeetingEventEntity, {
    meetingId: meeting.id,
    eventType: 'meeting_request_created',
    actorId: authUser.id,
  });

  // 7. Create notification record
  await em.save(NotificationEntity, {
    notificationType: NotificationType.MEETING_REQUEST_CREATED,  // Cần thêm MEETING_REQUEST_CREATED vào NotificationType enum
    channel: NotificationChannel.IN_APP,  // or EMAIL based on config
    title: `Yêu cầu họp mới: ${dto.title}`,
    body: `...`,
    senderId: authUser.id,
    recipientUserIdsJson: [approverUserId],
    referenceType: 'meeting_request',
    referenceId: request.id,
    deliveryStatus: NotificationDeliveryStatus.QUEUED,
  });

  // 8. Create audit log
  await em.save(AuditLogEntity, {
    actorId: authUser.id,
    actionType: 'create',
    entityType: 'meeting_request',
    entityId: request.id,
    metadataJson: { meetingId: meeting.id, bookingId: booking.id },
    ipAddress,
    userAgent,
    severity: AuditLogSeverity.INFO,
  });
});
```

**After transaction commit:**
- Optionally enqueue notification delivery background job
- Return success response with meeting detail

### 8.2 Approver Resolution
- Approver được xác định theo thứ tự ưu tiên sau:
  1. **system_configs key `meeting.approver_role_id`**: tìm user có role được chỉ định (ưu tiên cao nhất).
  2. **rooms.approver_id**: nếu rooms entity có field approver_id.
  3. **Fallback**: user có permission `meeting_request.approve` (dùng trong v1 khi chưa có config rõ).
- Approver ID được lưu vào `notifications.recipientUserIdsJson` khi tạo notification record.

---

## 9. Validation Plan

### DTO: `CreateMeetingDto`

| Field | Validator | Notes |
|-------|-----------|-------|
| `title` | `@IsString()`, `@Length(1,255)`, `@IsNotEmpty()` | |
| `description` | `@IsString()`, `@MaxLength(2000)`, `@IsOptional()` | |
| `host_id` | `@IsUUID()`, `@IsOptional()` | If absent, defaults to auth user |
| `start_time` | `@IsDateString()`, custom `@IsFutureDate()` | Custom validator |
| `end_time` | `@IsDateString()`, custom `@IsAfterStartTime(start_time)` | Custom validator |
| `room_id` | `@IsUUID()`, `@IsNotEmpty()` | |
| `meeting_type` | `@IsEnum(MeetingType)`, `@IsOptional()` | Default `normal` |
| `meeting_mode` | `@IsEnum(MeetingMode)`, `@IsOptional()` | Default `offline` |
| `expected_attendee_count` | `@IsInt()`, `@Min(1)`, `@IsOptional()` | |
| `capacity_override_confirmed` | `@IsBoolean()`, `@IsOptional()` | Default `false` |
| `participant_user_ids` | `@IsArray()`, `@IsUUID('4', { each: true })`, `@IsOptional()` | |
| `external_participants` | `@ValidateNested({ each: true })`, `@Type(() => ExternalParticipantDto)`, `@IsOptional()` | |

### ExternalParticipantDto

| Field | Validator |
|-------|-----------|
| `full_name` | `@IsString()`, `@IsNotEmpty()` |
| `email` | `@IsEmail()` |
| `organization` | `@IsString()`, `@IsOptional()` |

### Custom Validators Needed
- `@IsFutureDate()` — ensures start_time > current timestamp
- `@IsAfterStartTime(start_time)` — ensures end_time > start_time (class-level validator)

---

## 10. Error Handling Plan

| Error Code | HTTP | Trigger | Response |
|-----------|------|---------|----------|
| `VALIDATION_ERROR` | 400 | DTO validation fails | List of field errors |
| `UNAUTHENTICATED` | 401 | No/invalid JWT | Auth error |
| `FORBIDDEN` | 403 | Missing `meeting.create` | Permission error |
| `ROOM_NOT_FOUND` | 404 | Room doesn't exist/inactive | Room lookup failed |
| `ROOM_CONFLICT` | 409 | Room has overlapping booking | Conflict error with details |
| `CAPACITY_EXCEEDED` | 422 | Participants > capacity (no override) | Capacity error with room capacity |
| `INTERNAL_ERROR` | 500 | Unexpected system error | Generic server error |

### Transaction Error Handling
- Any failure within the transaction → automatic rollback (TypeORM)
- Service wraps transaction in try/catch
- Catch `QueryFailedError` → map to appropriate error code
- Log error details via Logger (not to user response)

---

## 11. Testing Strategy

### Unit Tests (Jest)

| Test Suite | Scenarios |
|-----------|-----------|
| `MeetingsService.create()` | • Success: creates all records in transaction<br>• Room conflict: throws 409<br>• Capacity exceeded: throws 422<br>• Capacity override: allows creation, logs audit<br>• Room not found: throws 404<br>• Host not found: throws 404<br>• Host defaults to auth user when omitted<br>• Host auto-added to participants<br>• meeting_code generated correctly<br>• booking_code generated correctly<br>• Notification record created with queued status<br>• Audit log contains meeting_id + booking_id in metadata<br>• Transaction rollback on DB failure |
| `MeetingsController.create()` | • Calls service with correct params<br>• Returns 201 with formatted response<br>• Guards applied |

### Integration Tests

| Scenario | Description |
|----------|-------------|
| Full success flow | Create meeting → verify all records in DB |
| Room conflict | Attempt double-booking → verify 409 |
| Capacity exceeded | Create with > capacity → verify 422 |
| Unauthenticated | No JWT → verify 401 |
| Missing permission | No `meeting.create` → verify 403 |

### Test Approach
- Unit tests: Mock `DataSource.transaction()`, repository methods, and `getRepository()`
- Integration tests: Use test DB or transaction rollback
- Follow existing patterns from `accounts/services/departments.service.spec.ts`

---

## 12. Implementation Phases

### Phase 1: DTO & Validation
1. Create `CreateMeetingDto` with all class-validator decorators
2. Create `ExternalParticipantDto`
3. Create custom validators: `@IsFutureDate()`, `@IsAfterStartTime()`
4. Create response DTOs

### Phase 2: Service Logic
1. Implement `MeetingsService.create()` with full transaction
2. Implement room conflict query
3. Implement capacity check logic
4. Implement code generation (meeting_code, booking_code)
5. Implement notification + audit log creation

### Phase 3: Controller & Routing
1. Update `meetings.module.ts` to register controller, service, and necessary module imports
2. Create `MeetingsController` with POST endpoint
3. Apply `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('meeting.create')`
4. Add response formatting

### Phase 4: Tests
1. Unit tests for MeetingsService
2. Unit tests for MeetingsController
3. Integration/E2E tests for main flows
4. Run `npm run test` and `npm run lint`

---

## 13. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `meetings.module.ts` doesn't export TypeOrm for MeetingEntity | Importing modules can't use repositories | Medium | Add `exports: [TypeOrmModule]` to meetings module (already does) |
| `NotificationsModule` doesn't export NotificationEntity | Meetings module can't inject Notification repository | Medium | Add NotificationEntity to meetings module's TypeOrm.forFeature directly |
| `AdministrationModule` doesn't export AuditLogEntity | Same issue | Medium | Same mitigation |
| Overlap query misses edge cases (time boundaries) | Double-booking not caught | Low | Use `start < end AND end > start` with inclusive/exclusive analysis |
| meeting_code uniqueness race condition | Duplicate codes | Low | Use DB unique constraint or sequence; retry on conflict |
| Approver resolution not defined | Can't create notification | Medium | Use system_config fallback; flag as clarification needed |
| No standard response interceptor | Inconsistent error format | Low | Follow manual pattern from accounts controller |

### Complexity Tracking

**No constitution principles are violated by this plan.** All operations stay within:
- Existing database schema (v3.2 Compact)
- Existing module boundaries
- Existing auth/guard patterns
- No new framework or external service integration

---

## 14. Acceptance Criteria Traceability

| AC ID | Test Strategy | Key Validation |
|-------|--------------|----------------|
| AC-001 | Integration | All records created: meeting (pending_approval), request (pending), booking (pending), 3 participants + 1 external, notification queued |
| AC-002 | Unit + Integration | Empty title → 400 |
| AC-003 | Unit + Integration | end_time < start_time → 400 |
| AC-004 | Unit + Integration | Past start_time → 400 |
| AC-005 | Integration | No JWT → 401 |
| AC-006 | Integration | No permission → 403 |
| AC-007 | Integration | Double-booking → 409 |
| AC-008 | Unit + Integration | Capacity exceeded w/o override → 422 |
| AC-008b | Unit + Integration | Capacity exceeded with override → 201 + audit log note |
| AC-009 | Unit | Meeting status = pending_approval, request status = pending |
| AC-010 | Unit | Booking status = pending, times match |
| AC-011 | Unit | Audit log: actionType='create', entityType='meeting_request', entityId=request.id, metadataJson={meetingId, bookingId} |
| AC-012 | Unit | Notification: type=meeting_request_created, recipient=approver, status=queued |

---

## Reference Artifacts

| Artifact | Path |
|----------|------|
| Feature Spec | `spec/features/meeting/feat-create-meeting-manual/spec.md` |
| Codebase Research | `spec/features/meeting/feat-create-meeting-manual/research.md` |
| Data Model | `spec/features/meeting/feat-create-meeting-manual/data-model.md` |
| API Contract | `spec/features/meeting/feat-create-meeting-manual/contracts/create-meeting-api.md` |
| Quickstart / Test Scenarios | `spec/features/meeting/feat-create-meeting-manual/quickstart.md` |
| Checklist | `spec/features/meeting/feat-create-meeting-manual/checklists/requirements.md` |
