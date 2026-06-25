| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-25 | Khởi tạo tasks cho tính năng thêm khách mời bên ngoài sau khi cuộc họp đã tạo | Toàn bộ file |

# Tasks: Thêm khách mời bên ngoài vào cuộc họp đã tạo

- **Feature ID**: MEET-ADD-EXTERNAL-PARTICIPANT-001
- **Feature Name**: Add External Meeting Participant (Post-creation)
- **Module / Domain**: Meeting Management (meetings)
- **Created Date**: 2026-06-25
- **Total Tasks**: 48

---

## Phase 1: Setup & Foundation

Các task setup, khởi tạo DTO, enum, permission seed. Không thuộc user story cụ thể.

- [x] T001 [P] Thêm `EXTERNAL_PARTICIPANT_ADDED = 'external_participant_added'` vào `MeetingEventType` enum trong `src/modules/meetings/entities/meeting-event.entity.ts`
- [x] T002 [P] Tạo `AddExternalParticipantDto` trong `src/modules/meetings/dto/add-external-participant.dto.ts` với `fullName` (IsString, IsNotEmpty, MaxLength(255)), `email` (IsEmail), `organizationName` (IsOptional, IsString, MaxLength(255)), `phoneNumber` (IsOptional, IsString, MaxLength(30)), `overrideWarnings` (IsOptional, IsBoolean), `warningToken` (IsOptional, IsString)
- [x] T003 [P] Tạo `AddExternalParticipantResponseDto`/interface `IAddExternalParticipantResponse` trong `src/modules/meetings/dto/add-external-participant-response.dto.ts` gồm `externalParticipantId`, `meetingId`, `fullName`, `email`, `organizationName`, `phoneNumber`, `role`, `status`
- [x] T004 [P] Tạo seed migration mới `meeting.participant.add.external` trong `src/database/seeds/` (mirror cấu trúc `20260610000001-SeedAddParticipantPermissions.ts`), xác nhận với team role nào được gán (tối thiểu ADMIN/MANAGER) trước khi merge
- [x] T005 [P] Đăng ký seed mới ở nơi các seed khác được chạy (kiểm tra entrypoint chạy seed trong `src/database/seeds/` hoặc script seed runner của dự án)

## Phase 2: Service Layer — Core Business Logic (US-01 + US-02 + US-04)

Xây dựng method `addExternalParticipant()` trong `MeetingsService`. Organizer/Host/Meeting Manager thêm khách mời bên ngoài, có luồng cảnh báo sức chứa phòng 2 bước.

### Step 1: Meeting existence check (gate cho mọi check sau)

- [x] T006 [US1] Viết validation check đầu tiên: tìm meeting theo `meetingId` (bao gồm check `deletedAt`). Nếu không tồn tại → throw `NotFoundException` với code `MEETING_NOT_FOUND`. Các check T007→T013 chỉ chạy sau khi T006 pass.

### Step 2: State, authorization, duplicate checks (chạy sau T006)

- [x] T007 [US1] Viết validation check: `meeting.status` phải thuộc `{scheduled, in_progress}`, nếu không → throw `BadRequestException` với code `INVALID_MEETING_STATUS`. (Chạy sau T006)
- [x] T008 [US1] [US2] Viết authorization check hợp nhất:
  - Requester là Organizer (`meeting.organizerId`) hoặc Host (`meeting.hostId`) → allowed
  - Requester có permission `meeting.participant.add.external` → allowed
  - Ngược lại → throw `ForbiddenException` với code `FORBIDDEN`
  (Chạy sau T006)
- [x] T009 [US2] Viết private meeting check: nếu `meeting.visibilityLevel === 'private'` và requester không phải Organizer/Host, kiểm tra thêm permission `admin.all`; nếu không có → throw `ForbiddenException` với code `FORBIDDEN_ACCESS`. (Chạy sau T008)
- [x] T010 [P] [US1] Viết pre-check trùng email: query `meeting_external_participants` `WHERE meeting_id = :meetingId AND LOWER(email) = LOWER(:email)`; nếu có kết quả → throw `ConflictException` với code `EXTERNAL_PARTICIPANT_ALREADY_EXISTS`. (Có thể chạy song song với T007/T008/T009, độc lập về dữ liệu)

### Step 3: Room capacity & warning flow (chạy sau T006, cần `meeting.roomId`)

- [x] T011 [US4] Viết hàm tính sức chứa: nếu `meeting.roomId` tồn tại, gọi `getAttendeeCount(meetingId)` (đã có sẵn, cộng cả internal + external) + 1, so sánh với `room.capacity`. Nếu không có `roomId` → bỏ qua toàn bộ Step 3.
- [x] T012 [US4] Viết policy branch: đọc `system_configs['meeting.capacity_policy']` (default `'warning'`). Nếu vượt sức chứa và policy là `'block'` → throw `UnprocessableEntityException` với code `ROOM_CAPACITY_EXCEEDED` ngay. Nếu policy là `'warning'` và chưa có override hợp lệ → sinh `warningToken` qua `WarningTokenUtil.generateToken(meetingId, email, warnings)` (lưu ý: dùng `email` thay cho `userId` ở vị trí tham số thứ 2) và throw `UnprocessableEntityException` với code `WARNING_CONFIRMATION_REQUIRED` kèm `warningToken` + `warnings`.
- [x] T013 [US4] Viết override verification: nếu `overrideWarnings=true` và có `warningToken`, gọi `WarningTokenUtil.verifyToken(token, meetingId, email)`. Nếu invalid → throw `BadRequestException` với code `INVALID_WARNING_TOKEN`. Nếu warnings chứa `ROOM_CAPACITY_WARNING`, kiểm tra permission `meeting.participant.override_capacity`; nếu thiếu → throw `UnprocessableEntityException` với code `ROOM_CAPACITY_EXCEEDED`. (Chạy sau T012, chỉ khi có override request)

### Step 4: Transaction

- [x] T014 [US1] Implement database transaction block (dùng `DataSource.transaction()`) bao gồm:
  - Lock `meetings` row (`pessimistic_write`)
  - Re-check trùng email trong transaction (lặp lại query T010) → nếu tồn tại → throw `ConflictException` `EXTERNAL_PARTICIPANT_ALREADY_EXISTS`
  - INSERT `meeting_external_participants` (full_name, email, organization_name, phone_number, participant_role=`'attendee'`, invitation_status=`'pending'`)
  - INSERT `meeting_events` (event_type=`'external_participant_added'`, actor_user_id, metadata_json={email, fullName})
  - INSERT `audit_logs` (action_type=`'add_external_participant'`, actor, target_id, new_value_json)
- [x] T015 [US1] Implement transaction error handling: nếu bất kỳ bước nào trong T014 thất bại → rollback toàn bộ, throw lỗi gốc nếu là exception nghiệp vụ đã biết, ngược lại log + throw 500 `INTERNAL_ERROR`
- [x] T016 [US1] Implement success response: build `AddExternalParticipantResponseDto`/`IAddExternalParticipantResponse` với `externalParticipantId`, `meetingId`, `fullName`, `email`, `organizationName`, `phoneNumber`, `role='attendee'`, `status='pending'`

### Step 5: Post-transaction notification (best-effort, US-03)

- [x] T017 [US3] Implement post-transaction try/catch riêng (KHÔNG nằm trong transaction T014): gọi `notificationsService.enqueueEmailNotification()` với `notificationType: MEETING_INVITE`, `channel: EMAIL`, `toEmails: [email]`, `relatedEntityType: 'meeting'`, `relatedEntityId: meetingId`. Nếu lỗi → log error, KHÔNG rethrow, KHÔNG rollback.
- [x] T018 [US3] Implement explicit guard: KHÔNG gọi `notificationsService.createNotification()` (in-app) cho khách mời bên ngoài trong toàn bộ flow này
- [x] T019 [P] [US1] Implement best-effort log nếu `meeting.status === 'in_progress'` khi thêm thành công (placeholder cho device-sync event tương lai, không cần implement thực tế ở feature này)

## Phase 3: Controller & Routing (US-01 + US-02 + US-04)

- [x] T020 [P] [US1] Thêm endpoint `POST /api/v1/meetings/:meetingId/participants/external` vào `src/modules/meetings/controllers/meetings.controller.ts`. Decorators:
  - `@Post('meetings/:meetingId/participants/external')`
  - `@HttpCode(HttpStatus.CREATED)`
  - `@UseGuards(JwtAuthGuard, PermissionsGuard)`
  - `@RequirePermissions('meeting.participant.add.external')`
  - `@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))`
- [x] T021 [US1] Lấy `authUser` từ `request['user']`, gọi `meetingsService.addExternalParticipant(meetingId, dto, { userId }, { ipAddress, userAgent })`, trả response theo format `{ success, message, data }`

## Phase 4: Unit Tests (US-01 + US-02 + US-03 + US-04)

### Service tests

- [x] T022 [P] [US1] Viết test: `addExternalParticipant` happy path — Organizer thêm khách mời mới → 201, verify INSERT vào `meeting_external_participants` + `meeting_events` + `audit_logs`
- [x] T023 [P] [US1] Viết test: `addExternalParticipant` meeting not found → 404 MEETING_NOT_FOUND
- [x] T024 [P] [US1] Viết test: `addExternalParticipant` meeting status sai (`draft`/`pending_approval`/`completed`/`cancelled`) → 400 INVALID_MEETING_STATUS
- [x] T025 [P] [US1] Viết test: `addExternalParticipant` meeting `in_progress` → 201 (vẫn cho phép)
- [x] T026 [P] [US1] Viết test: `addExternalParticipant` không có quyền, không phải Organizer/Host → 403 FORBIDDEN
- [x] T027 [P] [US2] Viết test: `addExternalParticipant` meeting `private`, Meeting Manager (không phải owner) → 403 FORBIDDEN_ACCESS
- [x] T028 [P] [US2] Viết test: `addExternalParticipant` meeting `private`, Organizer → 201
- [x] T029 [P] [US2] Viết test: `addExternalParticipant` meeting `private`, Admin (`admin.all`, không phải Organizer/Host) → 201
- [x] T030 [P] [US1] Viết test: `addExternalParticipant` email trùng chính xác → 409 EXTERNAL_PARTICIPANT_ALREADY_EXISTS
- [x] T031 [P] [US1] Viết test: `addExternalParticipant` email trùng khác hoa/thường (`A@X.com` vs `a@x.com`) → 409
- [x] T032 [P] [US1] Viết test: `addExternalParticipant` cùng email, 2 meeting khác nhau → cả 2 đều 201
- [x] T033 [P] [US4] Viết test: `addExternalParticipant` vượt sức chứa, policy=`warning`, lần gọi đầu (không token) → 422 WARNING_CONFIRMATION_REQUIRED kèm `warningToken`
- [x] T034 [P] [US4] Viết test: `addExternalParticipant` vượt sức chứa, policy=`warning`, override hợp lệ + có quyền `override_capacity` → 201
- [x] T035 [P] [US4] Viết test: `addExternalParticipant` vượt sức chứa, policy=`warning`, override + KHÔNG có quyền `override_capacity` → 422 ROOM_CAPACITY_EXCEEDED
- [x] T036 [P] [US4] Viết test: `addExternalParticipant` vượt sức chứa, policy=`block` → 422 ROOM_CAPACITY_EXCEEDED ngay từ lần gọi đầu, dù có quyền override
- [x] T037 [P] [US4] Viết test: `addExternalParticipant` `warningToken` invalid/expired/mismatched meetingId/email → 400 INVALID_WARNING_TOKEN
- [x] T038 [P] [US1] Viết test: `addExternalParticipant` meeting không có `roomId` → 201, không có warning nào được kiểm tra
- [x] T039 [P] [US1] Viết test: `addExternalParticipant` hai request đồng thời cùng email → request đầu 201, request sau 409 (không phải 500)
- [x] T040 [P] [US1] Viết test: `addExternalParticipant` transaction rollback (giả lập fail ở bước insert audit_log) → 500, không có participant nào được tạo
- [x] T041 [P] [US3] Viết test: `addExternalParticipant` notification email enqueue thất bại sau commit → participant vẫn được tạo (201), lỗi được log, không rollback
- [x] T042 [P] [US3] Viết test: `addExternalParticipant` verify KHÔNG có lời gọi `createNotification` (in-app) nào được thực hiện cho khách mời bên ngoài
- [x] T043 [P] [US3] Viết test: `addExternalParticipant` verify `enqueueEmailNotification` được gọi với `notificationType=MEETING_INVITE`, `channel=EMAIL`, `toEmails=[email]`

### DTO validation tests

- [x] T044 [P] Viết test: `AddExternalParticipantDto` thiếu/rỗng `fullName` → 400
- [x] T045 [P] Viết test: `AddExternalParticipantDto` `fullName` chỉ có khoảng trắng → 400
- [x] T046 [P] Viết test: `AddExternalParticipantDto` `email` sai định dạng hoặc thiếu → 400
- [x] T047 [P] Viết test: `AddExternalParticipantDto` không có `organizationName`/`phoneNumber` → không lỗi, lưu `null`

### Controller test

- [x] T048 [P] [US1] Viết test: controller response format — check `success`/`message`/`data` đúng convention dự án cho cả response 201 và lỗi 422

## Phase 5: Integration & Documentation

- [x] T049 [P] Kiểm tra `MeetingsModule` đã import đủ dependency (`NotificationsModule`, `WarningTokenUtil` provider) để `addExternalParticipant()` hoạt động
- [x] T050 [P] Cập nhật API documentation / Postman collection nếu có

---

## Dependencies

```
Phase 1 (T001-T005) ──┬──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
                       │
                       └──→ T006 (gate) ──┬──→ T007 (status check)
                                          ├──→ T008 (auth check) ──→ T009 (private check)
                                          ├──→ T011 (capacity calc) ──→ T012 (warning policy) ──→ T013 (override verify)
                                          │
                                          └──→ T010 (parallel — duplicate email pre-check)

T014 (transaction) phụ thuộc T007, T008, T009, T010, T012/T013 đã pass
T017, T018, T019 (post-transaction) phụ thuộc T014/T016 đã commit thành công
```

Trong Phase 1: T001→T005 chạy song song [P]
Trong Phase 2 Step 2-3: T007, T008, T011 phụ thuộc T006 (sequential). T009 phụ thuộc T008. T010 có thể chạy song song với T007-T009. T012 phụ thuộc T011. T013 phụ thuộc T012.
Trong Phase 4: tất cả test chạy song song [P]

## Requirements Coverage

### Functional Requirements

| Task | FR |
|---|---|
| T006 | FR-009 (meeting not found) |
| T007 | FR-010, FR-011 (state validation) |
| T008 | FR-003, FR-004 (authorization) |
| T009 | FR-005 (private meeting restriction) |
| T010, T014 (re-check) | FR-012, FR-030 (duplicate prevention + concurrency) |
| T011 | FR-013 (capacity calculation) |
| T012 | FR-014, FR-015 (warning/block policy) |
| T013 | FR-016, FR-017, FR-018 (override verification) |
| T014 | FR-020, FR-021, FR-022, FR-023, FR-024 (persistence + transaction) |
| T015 | FR-025 (rollback on failure) |
| T016, T020-T021 | FR-031, FR-032 (response contract, routing) |
| T017 | FR-026, FR-028 (email notification, failure isolation) |
| T018 | FR-027 (no in-app notification) |
| T019 | FR-029 (best-effort device sync note) |
| T004 | FR-003 (permission setup) |
| T001 | FR-022 (event type setup) |

### Acceptance Criteria

| Task | AC |
|---|---|
| T022 | AC-01 (happy path) |
| T023 | AC-10 variant (meeting not found) |
| T024 | AC-10 (wrong status) |
| T025 | AC-13 (in_progress vẫn cho phép) |
| T026 | — (403, không có AC riêng nhưng cover FR-004) |
| T027 | AC-05 (private, Manager bị chặn) |
| T028 | AC-06 (private, Organizer) |
| T029 | AC-06 variant (private, Admin) |
| T030-T032 | AC-03 (duplicate email) |
| T033 | AC-07 (warning 2-step, bước 1) |
| T034 | AC-07 (warning 2-step, bước 2 thành công) |
| T035 | AC-08 (warning, không có quyền override) |
| T036 | AC-09 (policy block) |
| T037 | — (cover FR-018, INVALID_WARNING_TOKEN) |
| T038-T039 | AC-11 (concurrency) |
| T040 | — (cover FR-025, transaction rollback) |
| T041-T043 | AC-02 (notification email, no in-app) |
| T044-T047 | AC-04 (validation) |
| T048 | — (response format, cross-cutting) |
