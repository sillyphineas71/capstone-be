# Implementation Plan: UC-MM-05 Tra cứu lịch trình cá nhân (My Schedule)

**Branch**: `009-my-schedule` | **Date**: 2026-06-09 | **Spec**: `spec/features/meeting/feat-my-schedule/spec.md`

## 1. Feature Summary

Feature này cung cấp 2 endpoint READ-ONLY cho phép user đã đăng nhập tra cứu lịch trình cuộc họp cá nhân:

- **`GET /api/v1/me/schedule`**: Danh sách sự kiện theo ngày/tuần/tháng với các bộ lọc (status, role, roomId, q). Overlap query `[from, to)`.
- **`GET /api/v1/me/schedule/{meetingId}`**: Popup chi tiết cuộc họp.

Technical approach: extend `meetings` module với controller + service mới. Dùng TypeORM QueryBuilder cho read queries. Không transaction (read-only).

## 2. Technical Context

| Aspect | Value |
|---|---|
| **Language/Version** | TypeScript (NestJS) |
| **Framework** | NestJS 10.x |
| **ORM** | TypeORM with DataSource injection |
| **Storage** | PostgreSQL (v3.2 Compact, 39 tables) |
| **Auth** | JWT (stateless) + JwtAuthGuard + PermissionsGuard |
| **Validation** | class-validator + ValidationPipe |
| **Testing** | Jest |
| **Target Platform** | Linux server (Node.js) |
| **Project Type** | Web API service (backend monolith) |
| **Performance Goals** | Response < 3s for 1-month range (< 1000 events), 50 concurrent requests |
| **Constraints** | Read-only, no DB schema changes, no new tables |
| **Scale/Scope** | 1000 meetings per user range max, ~50 concurrent users |

## 3. Scope Confirmation

### In Scope
- `GET /api/v1/me/schedule` — list schedule events with filters
- `GET /api/v1/me/schedule/{meetingId}` — popup detail (read-only)
- Query params: `view` (day|week|month), `from`, `to`, `timezone`, `status`, `role`, `roomId`, `q`
- Overlap query: `meetings.start_time < :to AND meetings.end_time > :from`
- effectiveUserRole: organizer > host > attendee
- Permission: `schedule.read.self` (seed migration needed)
- Response format: `{ success, message, data, meta }`

### Out of Scope (per spec)
- No create/update/cancel meeting
- No approval flow
- No export (PDF/CSV/iCal)
- No Google Calendar / Outlook sync
- No WebSocket (frontend manages polling)
- No new DB tables or columns
- No audit logging for read operations

## 4. Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | ✅ PASS | No new tables/columns. Existing entities only. |
| **Security Gate** | ✅ PASS | JWT + permissions enforced. No plain text credentials. |
| **Scope Gate** | ✅ PASS | READ-ONLY. No scope creep. |
| **Module Gate** | ✅ PASS | Extends existing `meetings` module. |
| **API Gate** | ✅ PASS | Response format `{ success, message, data, meta }`. HTTP codes per spec. |
| **Auth Gate** | ✅ PASS | `JwtAuthGuard` + `PermissionsGuard` on both endpoints. User ID from JWT. |
| **Test Gate** | ✅ PASS | Unit tests for service methods + controller. DTO validation tests. |

**Complexity Justification**: No violations. Feature is straightforward read-only with standard patterns.

## 5. Data Model Impact

### Tables Used (READ-ONLY)

| Table | Usage | Join Key |
|---|---|---|
| `meetings` | Core schedule data | — |
| `meeting_participants` | User relationship + participant list | `meeting_participants.meeting_id` |
| `rooms` | Room info in event summary + detail | `meetings.room_id` |
| `room_bookings` | Booking info in popup detail | `room_bookings.meeting_id` |
| `meeting_agendas` | Agenda list in popup | `meeting_agendas.meeting_id` |
| `meeting_external_participants` | External guests in popup | `meeting_external_participants.meeting_id` |
| `media_files` | Attachments in popup | `media_files.reference_id` |
| `recording_configs` | Recording config in popup | `recording_configs.meeting_id` |
| `users` | Organizer/host/participant details | `users.id` |

### No Schema Changes

No new tables, no new columns, no new indices needed. Existing indices on FK columns and `start_time`/`end_time` are sufficient.

### Seed Data Impact

Add `schedule.read.self` permission to seed migration. Assign to default roles (`admin`, `manager`, `employee`).

## 6. API / Contract Plan

### 6.1 GET /api/v1/me/schedule

| Aspect | Detail |
|---|---|
| **Controller method** | `getMySchedule(@CurrentUser() user, @Query() dto: MyScheduleQueryDto)` |
| **Service method** | `getMySchedule(userId: string, query: MyScheduleQueryDto)` |
| **Query logic** | TypeORM QueryBuilder with LEFT JOIN meetings → meeting_participants, rooms. Overlap: `WHERE meetings.start_time < :to AND meetings.end_time > :from` |
| **Relevance filter** | `WHERE (meetings.organizer_id = :userId OR meetings.host_id = :userId OR mp.user_id = :userId)` |
| **effectiveUserRole** | Priority subquery: CASE WHEN organizer_id = :userId THEN 'organizer' WHEN host_id = :userId THEN 'host' ELSE 'attendee' END |
| **Deduplication** | GROUP BY meetings.id, chọn effectiveUserRole cao nhất |
| **Sort** | `ORDER BY meetings.start_time ASC` |
| **Filters** | status (IN), role (WHERE effectiveUserRole = :role), roomId (=), q (ILIKE on title OR meeting_code) |

### 6.2 GET /api/v1/me/schedule/{meetingId}

| Aspect | Detail |
|---|---|
| **Controller method** | `getMyScheduleDetail(@CurrentUser() user, @Param('meetingId', ParseUUIDPipe) meetingId: string)` |
| **Service method** | `getMyScheduleDetail(userId: string, meetingId: string)` |
| **Access check** | Verify user is organizer/host/participant of the meeting |
| **Data loading** | 6 separate queries: meeting + relations, room, organizer, host, participants, externalParticipants, agendas, attachments, recordingConfig |
| **No writes** | READ-ONLY throughout |

Full contract details in `contracts/my-schedule-api.md`.

## 7. Authorization Plan

| Endpoint | Guard | Permission | Notes |
|---|---|---|---|
| `GET /me/schedule` | `JwtAuthGuard` + `PermissionsGuard` | `schedule.read.self` | Mọi user đã login và có permission đều có thể dùng |
| `GET /me/schedule/:meetingId` | `JwtAuthGuard` + `PermissionsGuard` | `schedule.read.self` | Thêm access check: user phải là organizer/host/participant |

### Access Check (detail endpoint)
```
1. Load meeting (id = meetingId)
2. If meeting not found → 404
3. If meeting.organizer_id == userId → allow
4. If meeting.host_id == userId → allow
5. If meeting_participants.user_id == userId → allow
6. Else → 403
```

### Data Isolation (list endpoint)
Query tự động cách ly: WHERE clause bao gồm `organizer_id = userId OR host_id = userId OR meeting_participants.user_id = userId`. Không có tham số `userId` nào từ client.

## 8. Business Logic Plan

### 8.1 Core Logic: getMySchedule

```
Input: userId, query { view, from, to, timezone?, status?, role?, roomId?, q? }

1. Validate query params (ValidationPipe)
2. Validate date range (from < to, range ≤ view limit)
3. Build QueryBuilder:
   SELECT m.id, m.meeting_code, m.title, m.start_time, m.end_time, m.timezone, m.status,
          CASE WHEN m.organizer_id = :userId THEN 'organizer'
               WHEN m.host_id = :userId THEN 'host'
               ELSE 'attendee' END AS effectiveUserRole,
          r.id AS room_id, r.room_name, r.room_code, r.location_description
   FROM meetings m
   LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id
   LEFT JOIN rooms r ON r.id = m.room_id
   WHERE (m.organizer_id = :userId OR m.host_id = :userId OR mp.user_id = :userId)
     AND m.status NOT IN ('draft', 'pending_approval')  -- default filter
     AND m.start_time < :to AND m.end_time > :from       -- overlap
   [AND m.status IN (:...status)]                        -- optional filter
   [AND effectiveUserRole = :role]                       -- optional filter
   [AND m.room_id = :roomId]                             -- optional filter
   [AND (m.title ILIKE :q OR m.meeting_code ILIKE :q)]   -- optional search
   GROUP BY m.id, r.id
   ORDER BY m.start_time ASC
4. Map results to ScheduleEventDto[]
5. Compute isCurrent, isPast for each event
6. Return { items, range, empty }
```

### 8.2 Core Logic: getMyScheduleDetail

```
Input: userId, meetingId

1. Load meeting with organizer + host relations
2. If not found → 404
3. Access check: is user organizer/host/participant?
4. If not authorized → 403
5. Load related data in parallel:
   - Room info (from meetings.room_id)
   - Participants list (meeting_participants JOIN users)
   - External participants
   - Agendas (sorted by sort_order)
   - Attachments (media_files WHERE reference_type='meeting' AND reference_id = meetingId)
   - Recording config (recording_configs WHERE meeting_id = meetingId)
6. Compute effectiveUserRole (same priority logic)
7. Return combined response
```

### 8.3 effectiveUserRole Resolution

```
Priority: organizer (3) > host (2) > attendee (1)

If meetings.organizer_id == userId         → effectiveUserRole = 'organizer'
Else if meetings.host_id == userId         → effectiveUserRole = 'host'
Else if meeting_participants.user_id match → effectiveUserRole = 'attendee'
```

Role filter: `WHERE effectiveUserRole = :role` (dùng subquery hoặc HAVING với CASE).

## 9. Validation Plan

### Query DTO: MyScheduleQueryDto

| Field | Validator | Rule |
|---|---|---|
| `view` | `@IsEnum(['day', 'week', 'month'])` | Required |
| `from` | `@IsDateString()` with strict = true | Required, must have offset |
| `to` | `@IsDateString()` with strict = true | Required, must have offset |
| `timezone` | `@IsOptional()` + custom IANA validator | Optional, default 'Asia/Ho_Chi_Minh' |
| `status` | `@IsOptional()` + `@IsEnum()` | Comma-separated or single value |
| `role` | `@IsOptional()` + `@IsEnum(['organizer', 'host', 'attendee'])` | Optional |
| `roomId` | `@IsOptional()` + `@IsUUID('4')` | Optional |
| `q` | `@IsOptional()` + `@MaxLength(200)` | Trim whitespace; if empty → ignored |

### Custom Validators Needed

- **`IsIanaTimezone`**: Check against IANA timezone list (use `Intl.supportedValuesOf('timeZone')` or a library like `moment-timezone`).

### Business Validation (in service)

| Condition | HTTP | Error Code |
|---|---|---|
| `from >= to` | 422 | `INVALID_DATE_RANGE` |
| `view=month` & range > 31 days | 422 | `DATE_RANGE_TOO_WIDE` |
| `view=week` & range > 7 days | 422 | `DATE_RANGE_TOO_WIDE` |
| `view=day` & range > 1 day | 422 | `DATE_RANGE_TOO_WIDE` |
| `from` or `to` missing offset | 400 | `INVALID_DATETIME_FORMAT` |

## 10. Error Handling Plan

### Error Codes

| Code | HTTP | When |
|---|---|---|
| `MISSING_REQUIRED_PARAM` | 400 | from/to missing |
| `INVALID_DATETIME_FORMAT` | 400 | from/to missing offset or unparseable |
| `INVALID_TIMEZONE` | 400 | timezone not valid IANA |
| `INVALID_VIEW_PARAM` | 400 | view not day/week/month |
| `INVALID_UUID` | 400 | meetingId or roomId not valid UUID |
| `INVALID_DATE_RANGE` | 422 | from >= to |
| `DATE_RANGE_TOO_WIDE` | 422 | range exceeds view limit |
| `UNAUTHENTICATED` | 401 | No JWT or expired token |
| `INVALID_TOKEN` | 401 | Token blacklisted or invalid |
| `FORBIDDEN_NOT_PARTICIPANT` | 403 | User not participant of meeting |
| `MEETING_NOT_FOUND` | 404 | Meeting does not exist |

### Error Response Format

```json
{
  "success": false,
  "message": "...",
  "error": { "code": "ERROR_CODE", "details": {} },
  "timestamp": "2026-06-09T10:00:00.000Z",
  "path": "/api/v1/me/schedule"
}
```

## 11. Testing Strategy

### 11.1 Unit Tests — MeetingsService (methods mới)

| Test | Type | Coverage |
|---|---|---|
| `getMySchedule()` — returns events for valid range | Happy path | FR-001, FR-005, FR-027 |
| `getMySchedule()` — overlap meeting crossing boundary | Edge case | FR-027, AC-013 |
| `getMySchedule()` — empty range returns empty items | Edge case | FR-021, AC-003 |
| `getMySchedule()` — effectiveUserRole resolution | Business rule | FR-002, FR-030, AC-010, AC-014 |
| `getMySchedule()` — role filter works on effectiveUserRole | Business rule | FR-030 |
| `getMySchedule()` — q search on title and meeting_code | Business rule | FR-029, AC-016 |
| `getMySchedule()` — q with whitespace only ignores filter | Edge case | FR-029 |
| `getMySchedule()` — invalid date range throws 422 | Validation | FR-014, AC-005 |
| `getMySchedule()` — range too wide throws 422 | Validation | FR-015, AC-006 |
| `getMySchedule()` — sort by start_time asc | Business rule | FR-004 |
| `getMyScheduleDetail()` — returns full detail for participant | Happy path | FR-006, AC-002 |
| `getMyScheduleDetail()` — non-participant throws 403 | Authorization | FR-024, AC-008 |
| `getMyScheduleDetail()` — meeting not found throws 404 | Error | FR-018, AC-009 |

### 11.2 Unit Tests — Controller

| Test | Type |
|---|---|
| `getMySchedule()` — returns 200 with correct response format | Happy path |
| `getMySchedule()` — 400 on missing required param | Validation |
| `getMySchedule()` — 422 on invalid date range | Validation |
| `getMyScheduleDetail()` — 403 for non-participant | Authorization |
| `getMyScheduleDetail()` — 404 for non-existent meeting | Error |

### 11.3 DTO Validation Tests

| Test |
|---|
| `MyScheduleQueryDto` — valid params pass validation |
| `MyScheduleQueryDto` — missing `from` fails |
| `MyScheduleQueryDto` — `view` not in enum fails |
| `MyScheduleQueryDto` — `roomId` not UUID fails |
| `MyScheduleQueryDto` — `q` > 200 chars fails |
| `MyScheduleQueryDto` — `timezone` invalid IANA fails |

### 11.4 Acceptance Criteria Coverage

| AC | Test Type | File |
|---|---|---|
| AC-001 (3 events, week view) | Unit: service | service spec |
| AC-002 (popup detail) | Unit: service | service spec |
| AC-003 (empty state) | Unit: service | service spec |
| AC-004 (missing from → 400) | Unit: controller | controller spec |
| AC-005 (date range reversed → 422) | Unit: service | service spec |
| AC-006 (range too wide → 422) | Unit: service | service spec |
| AC-007 (no token → 401) | Guard test | auth spec |
| AC-008 (non-participant → 403) | Unit: service | service spec |
| AC-009 (meeting not found → 404) | Unit: service | service spec |
| AC-010 (role priority, no duplicate) | Unit: service | service spec |
| AC-011 (cancelled still shown) | Unit: service | service spec |
| AC-012 (filter by status) | Unit: service | service spec |
| AC-013 (overlap boundary) | Unit: service | service spec |
| AC-014 (effectiveUserRole filter) | Unit: service | service spec |
| AC-015 (missing offset → 400) | Unit: DTO | DTO spec |
| AC-016 (q search meeting_code) | Unit: service | service spec |

## 12. Implementation Phases

### Phase 1: Permission Seed + Entity Registration

| Task | Details |
|---|---|
| Create seed migration `20260609000002-seed-schedule-read-self.ts` | Add `schedule.read.self` to permissions, assign to admin/manager/employee roles |
| Update `MeetingsModule` imports | Ensure required entities (MediaFileEntity, RecordingConfigEntity, UserEntity) are registered in `TypeOrmModule.forFeature` |

### Phase 2: DTOs

| Task | Details |
|---|---|
| `MyScheduleQueryDto` | Query params with class-validator |
| `ScheduleEventDto` | Response item shape |
| `ScheduleDetailDto` | Popup detail response shape |
| `ScheduleRangeDto` | Range metadata in response |

### Phase 3: Service Layer

| Task | Details |
|---|---|
| `MeetingsService.getMySchedule()` | Core schedule query with QueryBuilder |
| `MeetingsService.getMyScheduleDetail()` | Detail query with access check |
| Helper: `resolveEffectiveUserRole()` | Priority resolution |
| Helper: `validateDateRange()` | Range vs view limits |

### Phase 4: Controller Layer

| Task | Details |
|---|---|
| `MeetingsController.getMySchedule()` | Endpoint with guard + validation |
| `MeetingsController.getMyScheduleDetail()` | Endpoint with guard + validation |

### Phase 5: Unit Tests

| Task | Details |
|---|---|
| `meetings.service.spec.ts` — new describe blocks | Service tests (15+ cases) |
| `meetings.controller.spec.ts` — new describe blocks | Controller tests (5+ cases) |
| `my-schedule-query.dto.spec.ts` | DTO validation tests |

### Phase 6: Smoke Test + Final Review

| Task | Details |
|---|---|
| Build: `npm run build` | Ensure compilation passes |
| Lint: `npm run lint` | Ensure code style compliance |
| Test: `npm run test -- --testPathPattern=meetings` | Ensure all tests pass |

## 13. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `MediaFileEntity` hoặc `RecordingConfigEntity` không import được trong MeetingsModule | Compile error | Kiểm tra module nào owns 2 entity này; import module đó hoặc dùng raw query |
| Overlap query `[from, to)` không đúng index → full table scan | Slow query | Verify index on `start_time` and `end_time`; add composite index if missing |
| `schedule.read.self` permission chưa seed → 403 cho mọi user | Feature unusable | Seed migration bắt buộc phase 1, không thể thiếu |
| QueryBuilder với GROUP BY và CASE WHEN phức tạp | SQL bug | Test query manually first; use `getRawMany()` with proper mapping |

## 14. Acceptance Criteria Traceability

| AC | FR/ERR | Test |
|---|---|---|
| AC-001: 3 events, week view | FR-001, FR-004, FR-005, FR-027 | `getMySchedule()` — returns events |
| AC-002: popup detail | FR-006 | `getMyScheduleDetail()` — returns detail |
| AC-003: empty state | FR-021 | `getMySchedule()` — empty items |
| AC-004: missing from → 400 | FR-013, ERR-001 | Controller — missing param |
| AC-005: date range reversed → 422 | FR-014, ERR-002 | `getMySchedule()` — from >= to |
| AC-006: range too wide → 422 | FR-015, ERR-003 | `getMySchedule()` — 60 days month |
| AC-007: no token → 401 | FR-022, ERR-007 | Guard — no auth header |
| AC-008: non-participant → 403 | FR-024, ERR-009 | `getMyScheduleDetail()` — forbidden |
| AC-009: meeting not found → 404 | FR-018, ERR-010 | `getMyScheduleDetail()` — not found |
| AC-010: role priority, no duplicate | FR-002, FR-025, FR-030 | `getMySchedule()` — organizer+participant |
| AC-011: cancelled still shown | FR-003, BR5 | `getMySchedule()` — cancelled in results |
| AC-012: filter by status | FR-007 | `getMySchedule()` — status filter |
| AC-013: overlap boundary | FR-027, BR8 | `getMySchedule()` — crossing boundary |
| AC-014: effectiveUserRole filter | FR-030 | `getMySchedule()` — role=attendee excludes organizer |
| AC-015: missing offset → 400 | FR-013, ERR-012 | DTO — no offset in datetime |
| AC-016: q search meeting_code | FR-029, BR10 | `getMySchedule()` — q=001 matches code |
