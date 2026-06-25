| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-25 | Khởi tạo tasks cho tính năng gỡ bỏ khách mời bên ngoài khỏi cuộc họp | Toàn bộ file |

# Tasks: Gỡ bỏ khách mời bên ngoài khỏi cuộc họp

- **Feature ID**: MEET-REMOVE-EXTERNAL-PARTICIPANT-001
- **Feature Name**: Remove External Meeting Participant
- **Module / Domain**: Meeting Management (meetings)
- **Created Date**: 2026-06-25
- **Total Tasks**: 45

---

## Phase 1: Setup & Foundation

Các task setup, khởi tạo DTO, enum, permission seed. Không thuộc user story cụ thể.

- [x] T001 [P] Thêm `EXTERNAL_PARTICIPANT_REMOVED = 'external_participant_removed'` vào `MeetingEventType` enum trong `src/modules/meetings/entities/meeting-event.entity.ts`
- [x] T002 [P] Tạo `RemoveExternalParticipantParamsDto` trong `src/modules/meetings/dto/remove-external-participant-params.dto.ts` với `meetingId` (IsUUID) và `externalParticipantId` (IsUUID)
- [x] T003 [P] Tạo `RemoveExternalParticipantBodyDto` trong `src/modules/meetings/dto/remove-external-participant-body.dto.ts` với `reason` (IsOptional, IsString, MaxLength(1000)) và `scope` (IsOptional, dùng lại `RemoveScope` enum đã có ở `src/modules/meetings/types/remove-scope.type.ts`, default `instance`)
- [x] T004 [P] Tạo `RemoveExternalParticipantResponseDto` trong `src/modules/meetings/dto/remove-external-participant-response.dto.ts` gồm `meetingId`, `removedExternalParticipantId`, `removed`, `removedAt`, `notificationQueued`, `notificationId` (nullable), `backgroundJobId` (nullable)
- [x] T005 [P] Tạo seed migration mới `meeting.participant.remove.external` trong `src/database/seeds/` (mirror cấu trúc `20260611000001-SeedRemoveParticipantPermissions.ts`)
- [x] T006 [P] Đăng ký seed mới ở nơi các seed khác được chạy

## Phase 2: Service Layer — Core Business Logic (US-01 + US-02)

Xây dựng method `removeExternalParticipant()` trong `MeetingsService`. Khác biệt cốt lõi so với `removeParticipant()` (internal): **bỏ hẳn** bước Host/Organizer-protection và agenda-owner-check vì không applicable cho external participant.

### Step 1: Meeting existence check (gate cho mọi check sau)

- [x] T007 [US1] Viết validation check đầu tiên: tìm meeting theo `meetingId` (bao gồm check `deletedAt`). Nếu không tồn tại → throw `NotFoundException` với code `MEETING_NOT_FOUND`. Các check T008→T011 chỉ chạy sau khi T007 pass.

### Step 2: State, authorization, target lookup (chạy sau T007)

- [x] T008 [US1] Viết validation check: `meeting.status === 'scheduled'`, nếu không → throw `ConflictException` với code `MEETING_NOT_REMOVABLE`. (Chạy sau T007)
- [x] T009 [US1] [US2] Viết authorization check hợp nhất:
  - Requester là Host (`meeting.hostId`) hoặc Organizer (`meeting.organizerId`) → allowed
  - Requester có permission `meeting.participant.remove.external` → allowed
  - Ngược lại → throw `ForbiddenException` với code `FORBIDDEN`
  (Chạy sau T007; **không** thêm rule giới hạn theo `visibility_level`, mirror đúng `removeParticipant()` internal hiện có)
- [x] T010 [P] [US1] Viết validation check: tìm target trong `meeting_external_participants` `WHERE id = :externalParticipantId AND meeting_id = :meetingId`, nếu không tồn tại → throw `NotFoundException` với code `EXTERNAL_PARTICIPANT_NOT_IN_MEETING` (áp dụng cả khi `id` tồn tại nhưng thuộc meeting khác — không tiết lộ). (Có thể chạy song song với T008/T009)
- [x] T011 [US1] Viết recurring scope check: nếu `body.scope === 'series'` → throw `UnprocessableEntityException` với code `RECURRING_SERIES_SCOPE_NOT_SUPPORTED`. Nếu `scope === 'instance'` hoặc không gửi → tiếp tục bình thường. (Chạy sau T007)

**Lưu ý quan trọng — KHÔNG implement các bước sau (khác với `removeParticipant()` internal)**:
- ~~Host/Organizer protection check~~ — không applicable, `meeting_external_participants.id` không bao giờ khớp `meetings.organizer_id`/`host_id`
- ~~Agenda owner check~~ — không applicable, `meeting_agendas.owner_id` chỉ tham chiếu `users.id`

### Step 3: Transaction

- [x] T012 [US1] Implement database transaction block (dùng `DataSource.transaction()`) bao gồm:
  - Lock `meetings` row (`pessimistic_write`)
  - Re-check target vẫn tồn tại trong transaction (lặp lại query T010) → nếu không → throw `NotFoundException` `EXTERNAL_PARTICIPANT_NOT_IN_MEETING`
  - DELETE `meeting_external_participants` `WHERE id = :externalParticipantId AND meeting_id = :meetingId`
  - INSERT `meeting_events` (event_type=`'external_participant_removed'`, actor_user_id, metadata_json={removedExternalParticipantId, removedByUserId, reason?})
  - INSERT `audit_logs` (action_type=`'remove_external_participant'`, actor, target_id, old_value_json, new_value_json)
- [x] T013 [US1] Implement transaction error handling: nếu bất kỳ bước nào trong T012 thất bại → rollback toàn bộ → 500 `INTERNAL_ERROR`
- [x] T014 [US1] Implement idempotency: nếu target không còn tồn tại khi re-check trong transaction (đã bị gỡ bởi request khác) → throw `NotFoundException` `EXTERNAL_PARTICIPANT_NOT_IN_MEETING`
- [x] T015 [US1] Implement success response: build `RemoveExternalParticipantResponseDto` với `removed=true`, `removedAt` (current timestamp)
- [x] T016 [US1] Implement optional reason handling: nếu `reason` được cung cấp, lưu vào `metadata_json` của `meeting_events` và `audit_logs`

### Step 4: Post-transaction notification (best-effort, có điều kiện theo email — US-03)

- [x] T017 [US3] Implement post-transaction try/catch riêng (KHÔNG nằm trong transaction T012): `IF target.email IS NOT NULL` → gọi `notificationsService.enqueueEmailNotification()` với `notificationType: MEETING_PARTICIPANT_REMOVED`, `channel: EMAIL`, `toEmails: [target.email]`; set `notificationQueued=true`, `notificationId`, `backgroundJobId` từ kết quả
- [x] T018 [US3] Implement nhánh `ELSE` (khi `target.email IS NULL`): set `notificationQueued=false`, `notificationId=null`, `backgroundJobId=null`, log info "skipped — no email on file", KHÔNG throw lỗi
- [x] T019 [P] [US3] Implement error handling riêng cho bước notification: nếu `enqueueEmailNotification` throw error → log error, KHÔNG rethrow, KHÔNG rollback (response vẫn trả 200 thành công)

## Phase 3: Controller & Routing (US-01 + US-02)

- [x] T020 [P] [US1] Thêm endpoint `DELETE /api/v1/meetings/:meetingId/participants/external/:externalParticipantId` vào `src/modules/meetings/controllers/meetings.controller.ts`. Decorators:
  - `@Delete('meetings/:meetingId/participants/external/:externalParticipantId')` — **lưu ý**: dùng tiền tố `meetings/` đầy đủ, khác với route remove internal participant hiện tại (`@Delete(':meetingId/participants/:participantUserId')`, không có tiền tố) để tránh nhầm lẫn route convention
  - `@UseGuards(JwtAuthGuard)`
  - `@HttpCode(HttpStatus.OK)` (200)
  - `@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))`
- [x] T021 [US1] Lấy `authUser` từ `request['user']`, gọi `meetingsService.removeExternalParticipant(meetingId, externalParticipantId, { userId }, { ipAddress, userAgent }, body)`, trả response theo format `{ success, message, data }`

## Phase 4: Unit Tests (US-01 + US-02 + US-03)

### Service tests

- [x] T022 [P] [US1] Viết test: `removeExternalParticipant` happy path, target có email — 200, verify DELETE `meeting_external_participants` + INSERT `meeting_events`/`audit_logs`/`notifications`/`background_jobs`
- [x] T023 [P] [US3] Viết test: `removeExternalParticipant` happy path, target có `email=null` — 200, `notificationQueued=false`, `notificationId=null`, `backgroundJobId=null`, KHÔNG có record nào trong `notifications`/`background_jobs`
- [x] T024 [P] [US1] Viết test: `removeExternalParticipant` meeting not found → 404 MEETING_NOT_FOUND
- [x] T025 [P] [US1] Viết test: `removeExternalParticipant` meeting không `scheduled` (test cả `in_progress`, `completed`, `cancelled`) → 409 MEETING_NOT_REMOVABLE
- [x] T026 [P] [US1] Viết test: `removeExternalParticipant` không có quyền, không phải Host/Organizer → 403 FORBIDDEN
- [x] T027 [P] [US1] Viết test: `removeExternalParticipant` Host gỡ thành công → 200
- [x] T028 [P] [US1] Viết test: `removeExternalParticipant` Organizer gỡ thành công → 200
- [x] T029 [P] [US2] Viết test: `removeExternalParticipant` Meeting Manager có permission `meeting.participant.remove.external` gỡ thành công → 200
- [x] T030 [P] [US1] Viết test: `removeExternalParticipant` `externalParticipantId` không tồn tại → 404 EXTERNAL_PARTICIPANT_NOT_IN_MEETING
- [x] T031 [P] [US1] Viết test: `removeExternalParticipant` `externalParticipantId` tồn tại nhưng thuộc meeting khác → 404 EXTERNAL_PARTICIPANT_NOT_IN_MEETING (verify không leak thông tin meeting khác trong response)
- [x] T032 [P] [US1] Viết test: `removeExternalParticipant` body `scope='series'` → 422 RECURRING_SERIES_SCOPE_NOT_SUPPORTED
- [x] T033 [P] [US1] Viết test: `removeExternalParticipant` body `scope='instance'` hoặc omitted — hợp lệ, không reject
- [x] T034 [P] [US1] Viết test: `removeExternalParticipant` transaction rollback (giả lập fail ở bước insert audit_log) → 500, row vẫn tồn tại trong DB
- [x] T035 [P] [US1] Viết test: `removeExternalParticipant` duplicate remove → request 1 thành công (200), request 2 → 404 EXTERNAL_PARTICIPANT_NOT_IN_MEETING
- [x] T036 [P] [US1] Viết test: `removeExternalParticipant` concurrent remove (2 request đồng thời) → request đầu 200, request sau 404 (không phải 500)
- [x] T037 [P] [US1] Viết test: `removeExternalParticipant` with reason → reason có trong `meeting_events.metadata_json` và `audit_logs`
- [x] T038 [P] [US1] Viết test: `removeExternalParticipant` without reason → metadata không có field `reason`
- [x] T039 [P] [US3] Viết test: `removeExternalParticipant` email enqueue thất bại sau commit → row vẫn bị xóa (200), lỗi được log, không rollback
- [x] T040 [P] [US1] Viết test: `removeExternalParticipant` verify KHÔNG có bước kiểm tra Host/Organizer protection nào chạy (assert không query/so sánh `organizer_id`/`host_id` với target)
- [x] T041 [P] [US1] Viết test: `removeExternalParticipant` verify KHÔNG có query nào tới `meeting_agendas` trong toàn bộ flow

### DTO validation tests

- [x] T042 [P] Viết test: `RemoveExternalParticipantParamsDto` `meetingId` không phải UUID → 400
- [x] T043 [P] Viết test: `RemoveExternalParticipantParamsDto` `externalParticipantId` không phải UUID → 400
- [x] T044 [P] Viết test: `RemoveExternalParticipantBodyDto` `reason` > 1000 ký tự → 400

### Controller test

- [x] T045 [P] [US1] Viết test: controller response format — check `success`/`message`/`data` đúng convention dự án cho cả response 200 (có email và không có email) và lỗi

## Phase 5: Integration & Documentation

- [x] T046 [P] Kiểm tra `MeetingsModule` đã import đủ dependency (`NotificationsModule`) để `removeExternalParticipant()` hoạt động
- [x] T047 [P] Cập nhật API documentation / Postman collection nếu có

---

## Dependencies

```
Phase 1 (T001-T006) ──┬──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
                       │
                       └──→ T007 (gate) ──┬──→ T008 (status check)
                                          ├──→ T009 (auth check)
                                          ├──→ T011 (recurring scope)
                                          │
                                          └──→ T010 (parallel — target lookup)

T012 (transaction) phụ thuộc T008, T009, T010, T011 đã pass
T017, T018, T019 (post-transaction) phụ thuộc T012/T015 đã commit thành công
```

Trong Phase 1: T001→T006 chạy song song [P]
Trong Phase 2 Step 2: T008, T009, T011 phụ thuộc T007 (sequential). T010 có thể chạy song song.
Trong Phase 4: tất cả test chạy song song [P]

## Requirements Coverage

### Functional Requirements

| Task | FR |
|---|---|
| T007 | FR-007 (meeting not found) |
| T008 | FR-009, FR-010 (state validation) |
| T009 | FR-003, FR-004 (authorization) |
| T010 | FR-006, FR-008 (UUID validation + target lookup) |
| T011 | FR-017, FR-018 (recurring scope) |
| T012 | FR-013, FR-014, FR-015, FR-019 (delete + event + audit + transaction) |
| T013 | FR-020 (rollback on failure) |
| T014 | FR-021, FR-022 (idempotent remove + concurrency) |
| T015, T020-T021 | FR-026, FR-027 (response contract, routing) |
| T016 | FR-016 (optional reason) |
| T017 | FR-023 (email notification) |
| T018 | FR-024 (skip notification when no email) |
| T019 | FR-025 (notification failure isolation) |
| T005 | FR-003 (permission setup) |
| T001 | FR-014 (event type setup) |
| — (không implement) | FR-011, FR-012 (Ubiquitous: không cần Host/Organizer check, không cần agenda-owner check) |

### Acceptance Criteria

| Task | AC |
|---|---|
| T022 | AC-01 (happy path, có email) |
| T023 | AC-02 (happy path, email null) |
| T024 | — (cover FR-007, meeting not found) |
| T025 | AC-05 (wrong state) |
| T026 | AC-04 (no permission) |
| T027-T028 | AC-01 variant (Host/Organizer) |
| T029 | AC-01 variant (Manager) |
| T030 | AC-06 (participant not in meeting) |
| T031 | AC-08 (participant ở meeting khác) |
| T032 | AC-12 (series-wide rejected) |
| T033 | AC-11 (instance-only) |
| T034 | — (cover transaction rollback) |
| T035 | AC-09 (duplicate remove) |
| T036 | AC-10 (concurrency) |
| T037-T038 | AC-01 variant (with/without reason) |
| T039 | — (cover NFR-008, notification failure isolation) |
| T040-T041 | — (cover BR-05, BR-06 — simplification vs internal) |
| T042-T044 | AC-07 (validation) |
| T045 | — (response format, cross-cutting) |
