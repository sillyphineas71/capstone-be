# Task List: Cancel Scheduled Meeting (UC-MM-04)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-09 | Tạo tasks lần đầu cho UC-MM-04 | Toàn bộ file |
| 2026-06-09 | Bổ sung pseudo-code query cho T004 (room_bookings, room_booking_usages, meeting_participants, meeting_external_participants kèm lock); cập nhật Guard logic + Swagger decorators cho T005 | T004, T005, Checklist |

---

- **Feature ID**: MEETING-CANCEL-001
- **Based on**: `spec.md` (v2026-06-09, clarified), `plan.md` (v2026-06-09), `contracts/meeting-cancel-api.md`
- **Design Documents**:
  - [plan.md](./plan.md)
  - [research.md](./research.md)
  - [data-model.md](./data-model.md)
  - [contracts/meeting-cancel-api.md](./contracts/meeting-cancel-api.md)
  - [quickstart.md](./quickstart.md)
- **Branch**: `008-cancel-scheduled-meeting`

---

## Checklist

- [x] T001 [P] [US1] Seed `meeting.cancel.own` + `meeting.cancel.any` permissions → `src/database/seeds/20260609000002-SeedMeetingCancelPermissions.ts`
- [x] T002 [P] [US1] Create `CancelMeetingDto` → `src/modules/meetings/dto/cancel-meeting.dto.ts`
- [x] T003 [P] [US1] Create `CancelMeetingResponseDto` → `src/modules/meetings/dto/cancel-meeting-response.dto.ts`
- [x] T004 [US1] Implement `cancelMeeting()` service method → `src/modules/meetings/services/meetings.service.ts`
- [x] T005 [US1] Add `POST /meetings/:meetingId/cancel` controller endpoint → `src/modules/meetings/controllers/meetings.controller.ts`
- [x] T006 [US1] Unit tests for service `cancelMeeting()` → `src/modules/meetings/services/meetings.service.spec.ts`
- [x] T007 [US1] Unit tests for DTO validation → `src/modules/meetings/dto/cancel-meeting.dto.spec.ts`
- [x] T008 [US1] Unit tests for controller endpoint → `src/modules/meetings/controllers/meetings.controller.spec.ts`

---

## Phase 1: Preparation (Seed + DTOs) [P]

### Task T001 [US1] — Seed permissions `meeting.cancel.own` + `meeting.cancel.any`

**File**: `src/database/seeds/20260609000002-SeedMeetingCancelPermissions.ts`

**Action**: Create a new TypeORM utility seed file that:

1. Inserts **2 permissions** into the `permissions` table:

| `permission_code` | `permission_name` | `module_code` | `action_code` | `description` |
|---|---|---|---|---|
| `meeting.cancel.own` | Hủy cuộc họp của mình | `meetings` | `cancel.own` | Cho phép hủy cuộc họp khi user là organizer hoặc host |
| `meeting.cancel.any` | Hủy bất kỳ cuộc họp nào | `meetings` | `cancel.any` | Cho phép hủy bất kỳ cuộc họp nào (admin) |

2. Uses `ON CONFLICT (permission_code) DO NOTHING` to be idempotent.

3. Assigns permissions to roles via `role_permissions`:
   - `meeting.cancel.own` → roles `EMPLOYEE`, `MANAGER`, `ADMIN`
   - `meeting.cancel.any` → role `ADMIN` only

4. Uses `queryRunner` pattern (no entity) with `startTransaction/commitTransaction/rollbackTransaction` matching existing seed pattern.

5. Exports `seedMeetingCancelPermissions(dataSource: DataSource): Promise<void>`.

**Pattern to follow**: `src/database/seeds/20260609000001-SeedMeetingRoomUpdatePermission.ts`

**Outcome**: File created with idempotent seed for cancel permissions.

**Verification**: After running seed, permissions appear in `permissions` table and role assignments in `role_permissions`.

---

### Task T002 [US1] — Create `CancelMeetingDto`

**File**: `src/modules/meetings/dto/cancel-meeting.dto.ts`

**Action**: Create DTO with class-validator decorators:

```typescript
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CancelMeetingDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  cancellationReason?: string;
}
```

**Validation rules**:
- `cancellationReason`: optional, string, max 1000 chars, trimmed

**Outcome**: DTO file created with proper validation.

**Verification**: Referenced in T007 (DTO unit tests).

---

### Task T003 [US1] — Create `CancelMeetingResponseDto`

**File**: `src/modules/meetings/dto/cancel-meeting-response.dto.ts`

**Action**: Create response DTO for the cancel endpoint:

```typescript
export class CancelMeetingResponseDto {
  meetingId: string;
  status: string;
  cancelledAt: Date;
  cancelledBy: string;
  roomReleased: boolean;
  releasedBookingId: string | null;
  notificationStatus: string;
}
```

**Outcome**: Response DTO file created.

---

## Phase 2: Service Logic

### Task T004 [US1] — Implement `cancelMeeting()` in `MeetingsService`

**File**: `src/modules/meetings/services/meetings.service.ts`

**Action**: Add a new public method `cancelMeeting()` with this signature:

```typescript
async cancelMeeting(
  meetingId: string,
  authUser: AuthUser,
  clientContext: ClientContext,
  cancellationReason?: string,
): Promise<CancelMeetingResponseDto>
```

**Step 1 — Authorization check** (before transaction):
- Load meeting by `meetingId` where `deleted_at IS NULL`. Throw `NotFoundException` if not found.
- Check permissions using `AuthUser.userId`:
  - Load user's effective permissions via `authzReadRepository.getEffectiveRolesAndPermissions(authUser.userId)` (same pattern as `PermissionsGuard`)
  - If user has `meeting.cancel.any` permission → bypass ownership check (admin)
  - If user only has `meeting.cancel.own` → verify `currentUser.id === meeting.organizer_id` OR `currentUser.id === meeting.host_id`
  - `meetings.created_by` MUST NOT be used for ownership check
  - If neither satisfied → throw `ForbiddenException`

**Step 2 — Business validation** (before transaction):
- `meeting.status === 'scheduled'` else `ConflictException('INVALID_MEETING_STATUS')`
- `meeting.start_time > now` else `ConflictException('MEETING_ALREADY_STARTED')`

**Step 3 — Transaction with pessimistic locks and explicit queries**:

```
this.dataSource.transaction(async (em: EntityManager) => {
  // ── 3a. Lock meeting row (pessimistic write) ──
  const lockedMeeting = await em.query(
    `SELECT id, status, start_time, end_time, organizer_id, host_id,
            title, cancellation_reason, updated_at
     FROM meetings
     WHERE id = $1 AND deleted_at IS NULL
     FOR UPDATE`,
    [meetingId],
  );
  if (!lockedMeeting?.[0]) throw NotFoundException('MEETING_NOT_FOUND');
  const meeting = lockedMeeting[0];

  // ── 3b. Re-validate after lock (concurrent guard) ──
  if (meeting.status === 'cancelled') {
    throw ConflictException('CONCURRENT_MODIFICATION');
  }
  // (status + time already validated before transaction, but safe-guard here)

  // ── 3c. Query room_bookings with FOR UPDATE ──
  const bookings = await em.query(
    `SELECT id, room_id, status, start_time, end_time
     FROM room_bookings
     WHERE meeting_id = $1 AND status IN ('pending', 'approved')
     FOR UPDATE`,
    [meetingId],
  );
  const booking = bookings?.[0] ?? null;

  let roomReleased = false;
  let releasedBookingId: string | null = null;
  let previousBookingStatus: string | null = null;

  if (booking) {
    previousBookingStatus = booking.status;
    roomReleased = true;
    releasedBookingId = booking.id;

    // ── 3d. Lock & query room_booking_usages (if booking exists) ──
    const usages = await em.query(
      `SELECT id, usage_status
       FROM room_booking_usages
       WHERE booking_id = $1 AND usage_status = 'not_started'
       FOR UPDATE`,
      [booking.id],
    );
    const usage = usages?.[0] ?? null;

    // ── 3e. UPDATE room_bookings ──
    await em.query(
      `UPDATE room_bookings
       SET status = 'cancelled',
           cancellation_reason = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [cancellationReason?.trim() ?? null, booking.id],
    );

    // ── 3f. UPDATE room_booking_usages IF exists and not_started ──
    if (usage) {
      await em.query(
        `UPDATE room_booking_usages
         SET usage_status = 'released',
             released_at = NOW(),
             released_by = $1,
             release_reason = $2
         WHERE id = $3`,
        [authUser.userId, cancellationReason?.trim() ?? null, usage.id],
      );
    }
    // FR-011: NOT create usage if not exists

    // ── 3g. INSERT room_events ──
    await em.query(
      `INSERT INTO room_events (room_id, booking_id, event_type,
        old_status, new_status, description, created_at)
       VALUES ($1, $2, 'room_released', $3, 'cancelled',
        $4, NOW())`,
      [
        booking.room_id,
        booking.id,
        previousBookingStatus,
        `Phòng đã được giải phóng do cuộc họp "${meeting.title}" bị hủy.`,
      ],
    );

    // ── 3h. INSERT audit_log for release room ──
    await em.query(
      `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id,
        old_value_json, new_value_json, metadata_json, severity,
        ip_address, user_agent, created_at)
       VALUES ($1, 'release_room', 'room_booking', $2,
        $3, $4, $5, 'info', $6, $7, NOW())`,
      [
        authUser.userId,
        booking.id,
        JSON.stringify({ status: previousBookingStatus }),
        JSON.stringify({ status: 'cancelled' }),
        JSON.stringify({ reason: cancellationReason ?? null, meetingId }),
        clientContext.ipAddress ?? null,
        clientContext.userAgent ?? null,
      ],
    );
  }

  // ── 3i. UPDATE meetings ──
  await em.query(
    `UPDATE meetings
     SET status = 'cancelled',
         cancellation_reason = $1,
         updated_by = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [cancellationReason?.trim() ?? null, authUser.userId, meetingId],
  );

  // ── 3j. Query updated meeting for cancelledAt ──
  const updatedMeeting = await em.query(
    `SELECT updated_at FROM meetings WHERE id = $1`,
    [meetingId],
  );
  const cancelledAt = updatedMeeting[0]?.updated_at ?? new Date();

  // ── 3k. INSERT meeting_events ──
  await em.query(
    `INSERT INTO meeting_events (meeting_id, event_type, event_time,
      actor_user_id, source_type, description,
      old_value_json, new_value_json, metadata_json, created_at)
     VALUES ($1, 'status_changed', NOW(), $2, 'manual', $3, $4, $5, $6, NOW())`,
    [
      meetingId,
      authUser.userId,
      `Cuộc họp "${meeting.title}" đã bị hủy.` +
        (cancellationReason ? ` Lý do: ${cancellationReason}` : ''),
      JSON.stringify({ status: meeting.status }),
      JSON.stringify({ status: 'cancelled' }),
      JSON.stringify({
        action: 'cancel_meeting',
        reason: cancellationReason ?? null,
      }),
    ],
  );

  // ── 3l. INSERT audit_log for cancel meeting ──
  await em.query(
    `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id,
      old_value_json, new_value_json, metadata_json, severity,
      ip_address, user_agent, created_at)
     VALUES ($1, 'cancel_meeting', 'meeting', $2, $3, $4, $5, 'info', $6, $7, NOW())`,
    [
      authUser.userId,
      meetingId,
      JSON.stringify({ status: meeting.status }),
      JSON.stringify({ status: 'cancelled' }),
      JSON.stringify({ reason: cancellationReason ?? null }),
      clientContext.ipAddress ?? null,
      clientContext.userAgent ?? null,
    ],
  );

  // Return intermediate result from inside transaction
  return { cancelledAt, roomReleased, releasedBookingId };
});
```

**Step 4 — Outside transaction** (after commit success — FR-032):

```typescript
// ── 4a. Query participants for notification ──
const internalParticipants = await meetingParticipantRepo.find({
  where: { meetingId },
  relations: ['user'],
});
const externalParticipants = await meetingExternalParticipantRepo.find({
  where: { meetingId },
});

const recipientUserIds = internalParticipants
  .filter(p => p.user?.id)
  .map(p => p.user.id);
const recipientEmails = [
  ...internalParticipants
    .filter(p => p.user?.email)
    .map(p => p.user.email),
  ...externalParticipants
    .filter(p => p.email)
    .map(p => p.email),
];

// ── 4b. Create notification + background_job (FR-016, FR-017) ──
let notificationStatus: string;
try {
  // Create NotificationEntity
  const notification = await notificationRepo.save({
    notificationType: 'cancellation',
    channel: 'email',
    subject: `[CANCELLED] ${meeting.title}`,
    content: `Cuộc họp "${meeting.title}" đã bị hủy.` +
      (cancellationReason ? ` Lý do: ${cancellationReason}` : ''),
    relatedEntityType: 'meeting',
    relatedEntityId: meetingId,
    recipientScope: 'user_list',
    recipientUserIdsJson: JSON.stringify(recipientUserIds),
    recipientEmailsJson: JSON.stringify(recipientEmails),
    deliveryStatus: 'queued',
    payloadJson: JSON.stringify({
      action: 'cancel_meeting',
      meetingId,
      reason: cancellationReason ?? null,
    }),
  });

  // Create BackgroundJobEntity
  await backgroundJobRepo.save({
    jobType: 'send_email',
    status: 'pending',
    payloadJson: JSON.stringify({
      notificationId: notification.id,
      type: 'cancellation',
    }),
  });

  notificationStatus = 'queued';
} catch (notifError) {
  this.logger.error(
    'Failed to queue cancellation notification',
    (notifError as Error).stack,
  );
  // Ghi audit log về notification failure
  await auditLogRepo.save({
    userId: authUser.userId,
    actionType: 'notification_failure',
    entityType: 'meeting',
    entityId: meetingId,
    metadataJson: JSON.stringify({
      error: 'Failed to queue cancellation notification',
      reason: cancellationReason ?? null,
    }),
    severity: 'warning',
  });

  notificationStatus = 'failed_to_queue';
  // FR-032: Không rollback cancel, chỉ trả về failed_to_queue
}
```

**Step 5 — Return response**:

```typescript
return {
  meetingId,
  status: 'cancelled',
  cancelledAt: result.cancelledAt,
  cancelledBy: authUser.userId,
  roomReleased: result.roomReleased,
  releasedBookingId: result.releasedBookingId,
  notificationStatus,
};
```

**Detailed field mappings** (from `data-model.md`):

| Operation | Entity | Field values |
|---|---|---|
| Update meeting | `meetings` | `status='cancelled'`, `cancellation_reason`, `updated_by`, `updated_at` |
| Update booking | `room_bookings` | `status='cancelled'`, `cancellation_reason`, `updated_at` (only if `pending` or `approved`) |
| Update usage | `room_booking_usages` | `usage_status='released'`, `released_at`, `released_by`, `release_reason` (only if exists AND `not_started`) |
| Meeting event | `meeting_events` | `event_type='status_changed'`, `old_value_json`, `new_value_json`, `metadata_json.action='cancel_meeting'` |
| Room event | `room_events` | `event_type='room_released'`, `old_status`, `new_status='cancelled'` |
| Audit 1 | `audit_logs` | `action_type='cancel_meeting'`, `entity_type='meeting'`, JSON diffs |
| Audit 2 | `audit_logs` | `action_type='release_room'`, `entity_type='room_booking'` (conditional) |
| Notification | `notifications` | `notification_type='cancellation'`, `subject='[CANCELLED] ...'`, `recipient_user_ids_json`, `recipient_emails_json` |
| Background job | `background_jobs` | `job_type='send_email'`, `status='pending'`, `payload_json={notificationId}` |

**Error pattern**:
```typescript
throw new NotFoundException({
  success: false,
  message: 'Cuộc họp không tồn tại hoặc đã bị xóa',
  error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
})
```

**Error code mapping**:

| Exception | Error Code | Condition |
|---|---|---|
| `NotFoundException` | `MEETING_NOT_FOUND` | meeting not found or soft-deleted |
| `ForbiddenException` | `FORBIDDEN` | missing permissions |
| `ConflictException` | `INVALID_MEETING_STATUS` | status !== `scheduled` |
| `ConflictException` | `MEETING_ALREADY_STARTED` | start_time <= now |
| `ConflictException` | `CONCURRENT_MODIFICATION` | already cancelled by concurrent request |

**Pattern to follow**: Existing `updateMeetingTime()` method in `meetings.service.ts` for transaction + pessimistic lock + notification outside transaction approach.

**Outcome**: `cancelMeeting()` method added. All AC-001 through AC-022 covered in service logic.

---

## Phase 3: Controller Endpoint

### Task T005 [US1] — Add cancel endpoint to `MeetingsController`

**File**: `src/modules/meetings/controllers/meetings.controller.ts`

**Action**: Add new endpoint method with Swagger decorators and authorization guards.

**5a. Guard / Authorization Logic**:

Current `PermissionsGuard` (in `src/modules/auth/guards/permissions.guard.ts`) uses `Array.every()` — requires ALL listed permissions (AND logic).

Use `@RequirePermissions('meeting.cancel.own')` at controller level because:
- `meeting.cancel.own` is seeded to `EMPLOYEE`, `MANAGER`, and `ADMIN` roles (per T001)
- `meeting.cancel.any` is seeded to `ADMIN` only (per T001)
- Since ADMIN has **both** `cancel.own` AND `cancel.any` from the seed, all authorized users pass the Guard check for `cancel.own`
- The service layer (T004) handles the **additional** check: if user has `cancel.any` → bypass organizer/host verification

**Important note**: If a future role is assigned ONLY `meeting.cancel.any` WITHOUT `meeting.cancel.own`, the PermissionsGuard will block that user because they lack `meeting.cancel.own`. In that scenario, either:
1. Ensure that role also receives `meeting.cancel.own` in the seed
2. Or update `PermissionsGuard` to support OR-logic for specific cases (e.g., a new `@RequireAnyPermissions` decorator)

**5b. Swagger Decorators**:

The project uses `@nestjs/swagger`. Add the following decorators:

| Decorator | Purpose |
|---|---|
| `@ApiTags('Meetings')` | Group endpoint under 'Meetings' tag in Swagger UI |
| `@ApiBearerAuth()` | Mark endpoint as requiring JWT Bearer token |
| `@ApiOperation({ summary: 'Hủy cuộc họp đã lên lịch', description: '...' })` | Describe endpoint |
| `@ApiParam({ name: 'meetingId', type: 'string', format: 'uuid', description: 'ID cuộc họp' })` | Path parameter |
| `@ApiBody({ type: CancelMeetingDto, required: false })` | Request body schema |
| `@ApiResponse({ status: 200, description: 'Hủy thành công', type: CancelMeetingResponseDto })` | Success response |
| `@ApiResponse({ status: 400, description: 'Validation error' })` | Error response |
| `@ApiResponse({ status: 401, description: 'Unauthorized' })` | Error response |
| `@ApiResponse({ status: 403, description: 'Forbidden' })` | Error response |
| `@ApiResponse({ status: 404, description: 'Meeting not found' })` | Error response |
| `@ApiResponse({ status: 409, description: 'Conflict (status/time/concurrent)' })` | Error response |

**5c. Controller Method**:

```typescript
@Post('meetings/:meetingId/cancel')
@HttpCode(HttpStatus.OK)
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('meeting.cancel.own')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
@ApiTags('Meetings')
@ApiBearerAuth()
@ApiOperation({
  summary: 'Hủy cuộc họp đã lên lịch',
  description:
    'Cho phép Meeting Organizer, Meeting Host hoặc System Admin hủy cuộc họp đang ở trạng thái scheduled và chưa bắt đầu. Khi hủy, phòng họp được giải phóng, events + audit logs được ghi, và notification được queue gửi đến participants.',
})
@ApiParam({
  name: 'meetingId',
  type: 'string',
  format: 'uuid',
  description: 'ID của cuộc họp cần hủy',
})
@ApiBody({ type: CancelMeetingDto, required: false })
@ApiResponse({
  status: 200,
  description: 'Cuộc họp đã được hủy thành công',
  type: CancelMeetingResponseDto,
})
@ApiResponse({ status: 400, description: 'Validation error' })
@ApiResponse({ status: 401, description: 'Unauthorized' })
@ApiResponse({ status: 403, description: 'Forbidden' })
@ApiResponse({ status: 404, description: 'Meeting not found' })
@ApiResponse({ status: 409, description: 'Conflict' })
async cancelMeeting(
  @Param('meetingId', ParseUUIDPipe) meetingId: string,
  @Body() dto: CancelMeetingDto,
  @Req() request: Request,
  @Ip() ipAddress: string,
  @Headers('user-agent') userAgent?: string,
): Promise<{
  success: boolean;
  message: string;
  data: CancelMeetingResponseDto;
}> {
  const authUser = request['user'] as { userId: string } | undefined;

  const result = await this.meetingsService.cancelMeeting(
    meetingId,
    { userId: authUser!.userId },
    { ipAddress, userAgent },
    dto.cancellationReason,
  );

  return {
    success: true,
    message: 'Cuộc họp đã được hủy thành công',
    data: result,
  };
}
```

**Imports to add**:
- `@Post`, `@Param`, `ParseUUIDPipe` from `@nestjs/common`
- `CancelMeetingDto` from `../dto/cancel-meeting.dto.js`
- `CancelMeetingResponseDto` from `../dto/cancel-meeting-response.dto.js`
- `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation`, `@ApiParam`, `@ApiBody`, `@ApiResponse` from `@nestjs/swagger`

**Outcome**: `POST /api/v1/meetings/:meetingId/cancel` endpoint registered with full Swagger documentation.

**Verification**: All contract responses from `contracts/meeting-cancel-api.md` are reachable via the endpoint.

---

## Phase 4: Tests

### Task T006 [US1] — Unit tests for `cancelMeeting()` service method

**File**: `src/modules/meetings/services/meetings.service.spec.ts`

**Action**: Add test cases (22+ cases) for `MeetingService.cancelMeeting()`:

**Happy Path (3 cases)**:
1. Organizer cancels → 200, status updated, events created, notification queued → AC-001
2. Host cancels → 200 → AC-002
3. Admin cancels (not organizer/host) → 200 → AC-003

**Authorization (2 cases)**:
4. Participant (no cancel permission) → 403 → AC-004
5. User has `cancel.own` but not organizer/host → 403 → AC-005

**Business validation (4 cases)**:
6. Meeting `in_progress` → 409 → AC-006
7. Meeting `completed` → 409 → AC-007
8. Meeting already `cancelled` → 409 → AC-008
9. Meeting `start_time <= now` → 409 → AC-009

**Not found (1 case)**:
10. Non-existent meetingId → 404 → AC-010

**Room/booking state (4 cases)**:
11. Room booking `approved` → `cancelled` + reason → AC-013
12. No room booking → `roomReleased=false`, `releasedBookingId=null` → AC-014
13. Usage `not_started` → `released` → AC-015
14. No usage record → no new usage created → AC-016

**Events (2 cases)**:
15. Meeting event: `event_type='status_changed'`, old/new/meta JSON → AC-017
16. Room event: `event_type='room_released'` → AC-018

**Notification (2 cases)**:
17. Subject prefix `[CANCELLED]` → AC-019
18. Notification includes reason → AC-020

**Audit (1 case)**:
19. Audit log recorded for cancel + release → AC-021

**Concurrency (1 case)**:
20. Second concurrent request → 409, single notification → AC-022

**Notification failure (2 cases)**:
21. Background job fails → response still 200, `notificationStatus='failed_to_queue'` → FR-032
22. Queue throws → no rollback, audit log failure recorded

**Pattern to follow**: Existing test structure in `meetings.service.spec.ts` (mock `DataSource.transaction`, mock entities, mock repository methods).

**Outcome**: All business logic paths covered with unit tests.

---

### Task T007 [US1] — Unit tests for DTO validation

**File**: `src/modules/meetings/dto/cancel-meeting.dto.spec.ts`

**Action**: Create unit tests for `CancelMeetingDto` validation:

1. Valid reason (under 1000 chars) → passes → AC-011
2. No reason provided (empty body) → passes (optional)
3. Reason > 1000 chars → fails `@MaxLength(1000)` → AC-012
4. Reason is not a string → fails `@IsString()`
5. Unknown field in body → rejected by `forbidNonWhitelisted` (test via ValidationPipe)

**Pattern to follow**: `src/modules/meetings/dto/update-meeting-room.dto.spec.ts`

**Outcome**: DTO validation coverage complete.

---

### Task T008 [US1] — Unit tests for controller endpoint

**File**: `src/modules/meetings/controllers/meetings.controller.spec.ts`

**Action**: Add test cases for the new `POST /meetings/:meetingId/cancel` endpoint:

1. Valid request → calls service → returns 200 → AC-001
2. Invalid UUID → 400 before service call → AC-011
3. Invalid body (unknown field) → 400 → AC-012 (via forbidNonWhitelisted)
4. Service throws `NotFoundException` → controller returns 404 → AC-010
5. Service throws `ForbiddenException` → controller returns 403 → AC-004/AC-005
6. Service throws `ConflictException` → controller returns 409 → AC-006/AC-007/AC-008/AC-009
7. Guard rejects unauthenticated → 401 → AC from spec ERR-004

**Pattern to follow**: `src/modules/meetings/controllers/meetings.controller.spec.ts`

**Outcome**: Controller endpoint boundary tested for all error codes.

---

## Requirements Coverage

### FR Coverage

| FR ID | Description | Task(s) |
|:---|---|:---|
| FR-001 | Xác thực bắt buộc | T005 (JwtAuthGuard), T008 |
| FR-002 | Permission: organizer_id/host_id (not created_by) | T001 (seed), T004 (service check), T006 |
| FR-003 | Chỉ cho phép hủy khi `scheduled` | T004, T006 |
| FR-004 | Chỉ cho phép hủy khi `start_time > now` | T004, T006 |
| FR-005 | Không hard delete | T004 (UPDATE only) |
| FR-006 | Reason optional, trim, max 1000 | T002 (DTO), T007 |
| FR-007 | Update `meetings.status = 'cancelled'` | T004, T006 |
| FR-008 | Update `updated_by`, `updated_at` | T004, T006 |
| FR-009 | Booking `status='cancelled'` + `cancellation_reason` | T004, T006 |
| FR-010 | Usage `not_started` → `released` | T004, T006 |
| FR-011 | NOT create usage if not exists | T004, T006 |
| FR-012 | Meeting event: `status_changed` | T004, T006 |
| FR-013 | Room event: `room_released` | T004, T006 |
| FR-014 | Audit log: cancel meeting | T004, T006 |
| FR-015 | Audit log: release room | T004, T006 |
| FR-016 | Create notification: cancellation | T004, T006 |
| FR-017 | Create background job: send_email | T004, T006 |
| FR-018 | Organizer/Host/Admin có thể hủy | T004, T006 |
| FR-019 | Không cho hủy khi in_progress/completed/cancelled | T004, T006 |
| FR-020 | Booking cancelled → phòng trống | T004 (booking update), T006 |
| FR-021 | Reason lưu vào DB | T004, T006 |
| FR-022 | Booking optional → `roomReleased=false` | T004, T006 |
| FR-023 | Usage conditional → only not_started | T004, T006 |
| FR-024 | Auth error → 401 | T005, T008 |
| FR-025 | Forbidden → 403 | T004, T006, T008 |
| FR-026 | Not found → 404 | T004, T006, T008 |
| FR-027 | Status conflict → 409 | T004, T006 |
| FR-028 | Time conflict → 409 | T004, T006 |
| FR-029 | UUID invalid → 400 | T005 (ParseUUIDPipe), T007, T008 |
| FR-030 | Reason > 1000 → 422 | T002 (MaxLength), T007 |
| FR-031 | Concurrent cancel → 409 | T004 (pessimistic lock), T006 |
| FR-032 | Queue fail → no rollback + failed_to_queue | T004 (notification error handling), T006 |
| FR-033 | Unknown field → 400 | T002 (forbidNonWhitelisted via pipe), T007 |
| FR-034 | Transaction workflow | T004 (full transaction) |
| FR-035 | Rollback on failure | T004 (transaction rollback) |
| FR-036 | cancelledAt from updated_at | T004, T006 |
| FR-037 | No physical delete | T004 (UPDATE only) |
| FR-038 | Room status không set mù | T004 (no rooms update) |
| FR-039 | Subject `[CANCELLED]` prefix | T004 (notification creation), T006 |
| FR-040 | Reason in notif content | T004, T006 |
| FR-041 | Both internal + external participants | T004 (recipient lists), T006 |
| FR-042 | Complex: scheduled + organizer + cancel | T004 (full flow) |
| FR-043 | Complex: booking pending/approved → cancelled | T004 (booking update) |
| FR-044 | Complex: queue fail → failed_to_queue | T004 (notification error), T006 |

### AC Coverage

| AC ID | Task(s) |
|:---|---|
| AC-001 | T004, T005, T006, T008 |
| AC-002 | T004, T006 |
| AC-003 | T004, T006 |
| AC-004 | T004, T006, T008 |
| AC-005 | T004, T006 |
| AC-006 | T004, T006, T008 |
| AC-007 | T004, T006, T008 |
| AC-008 | T004, T006, T008 |
| AC-009 | T004, T006, T008 |
| AC-010 | T004, T006, T008 |
| AC-011 | T005 (ParseUUIDPipe), T007, T008 |
| AC-012 | T002 (MaxLength), T007 |
| AC-013 | T004, T006 |
| AC-014 | T004, T006 |
| AC-015 | T004, T006 |
| AC-016 | T004, T006 |
| AC-017 | T004, T006 |
| AC-018 | T004, T006 |
| AC-019 | T004, T006 |
| AC-020 | T004, T006 |
| AC-021 | T004, T006 |
| AC-022 | T004, T006 |

### Error Code Coverage

| Error Code | HTTP Status | Task(s) |
|:---|---|:---|
| `VALIDATION_ERROR` | 400 / 422 | T002, T005 (ParseUUIDPipe / forbidNonWhitelisted), T007, T008 |
| `UNAUTHORIZED` | 401 | T005 (JwtAuthGuard), T008 |
| `FORBIDDEN` | 403 | T004, T006, T008 |
| `MEETING_NOT_FOUND` | 404 | T004, T006, T008 |
| `INVALID_MEETING_STATUS` | 409 | T004, T006 |
| `MEETING_ALREADY_STARTED` | 409 | T004, T006 |
| `CONCURRENT_MODIFICATION` | 409 | T004, T006 |

---

## Dependencies Graph

```
T001 (seed) ──────┐
                   ├──> T004 (service) ──> T005 (controller) ──> T008 (controller tests)
T002 (cancel DTO) ─┘                        │
T003 (resp DTO) ────────────────────────────┘
                                              └──> T006 (service tests)
                                              └──> T007 (DTO tests)
```

**Legend**:
- `[P]` = Parallelizable with other `[P]` tasks in same phase
- `-->` = dependent on (must complete before)
- T006 and T007 can run in parallel after their respective dependencies
- T008 must wait for T005

## Implementation Order

| Step | Task(s) | Phase | Description |
|:----:|:--------|:-----:|:------------|
| 1 | T001, T002, T003 | Phase 1 [P] | Seed + DTOs (parallel) |
| 2 | T004 | Phase 2 | Service method |
| 3 | T005 | Phase 3 | Controller endpoint |
| 4 | T006, T007, T008 | Phase 4 [P] | Tests (parallel where possible) |
