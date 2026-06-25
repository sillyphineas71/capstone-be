# Tasks: Tạo chương trình họp (Agenda)

- **Feature ID**: UC-MM-09
- **Created**: 2026-06-15
- **Based on**: spec.md, plan.md, research.md, data-model.md, quickstart.md

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-15 | Khởi tạo tasks cho tính năng tạo chương trình họp | Toàn bộ file |

---

## Phase 1: Foundation — DTO & Validation

Mục tiêu: Tạo các DTO input/output với class-validator decorators.

### 1.1 DTO Input

- [x] T001 [P] Tạo `AgendaItemDto` tại `src/modules/meetings/dto/agenda-item.dto.ts`
  - Fields:
    - `id?: string` — `@IsOptional()` `@IsUUID('4')`
    - `title: string` — `@IsNotEmpty()` `@IsString()` `@MaxLength(255)`
    - `description?: string` — `@IsOptional()` `@IsString()` `@MaxLength(2000)`
    - `ownerId?: string | null` — `@IsOptional()` `@IsUUID('4')` (cho phép null)
    - `plannedDurationMinutes: number` — `@IsNotEmpty()` `@IsInt()` `@Min(1)`
  - Import từ `class-validator`: `IsOptional`, `IsUUID`, `IsNotEmpty`, `IsString`, `MaxLength`, `IsInt`, `Min`
  - Outcome: DTO input class ready

- [x] T002 [P] Tạo `ReplaceAgendaDto` tại `src/modules/meetings/dto/replace-agenda.dto.ts`
  - Fields:
    - `items: AgendaItemDto[]` — `@IsArray()` `@ValidateNested({ each: true })` `@ArrayMinSize(0)` `@Type(() => AgendaItemDto)`
  - Import: `IsArray`, `ValidateNested`, `ArrayMinSize`, `Type` từ `class-validator` / `class-transformer`
  - Dùng `@ArrayMinSize(0)` thay vì `@IsNotEmpty()` để cho phép mảng rỗng
  - Outcome: DTO input class ready

### 1.2 DTO Output / Response

- [x] T003 [P] Tạo response DTOs tại `src/modules/meetings/dto/agenda-response.dto.ts`
  - `AgendaItemResponseDto`:
    - Fields: `id`, `agendaOrder`, `title`, `description`, `ownerId`, `ownerName`, `plannedDurationMinutes`, `status`
    - Constructor nhận data object + `Object.assign(this, data)`
  - `AgendaListResponseDto`:
    - Fields: `meetingId`, `meetingStatus`, `meetingDurationMinutes`, `totalPlannedDurationMinutes`, `remainingDurationMinutes`, `durationStatus`, `isLockedForEditing`, `lockReason`, `items: AgendaItemResponseDto[]`
  - `ReplaceAgendaResponseDto`:
    - Fields: `meetingId`, `totalPlannedDurationMinutes`, `remainingDurationMinutes`, `items: AgendaItemResponseDto[]`
  - Pattern: giống response DTO hiện có trong `src/modules/meetings/dto/`
  - Outcome: 3 response DTO classes ready

---

## Phase 2: Service Business Logic

Mục tiêu: Implement `getAgendas()` và `replaceAgendas()` trong `MeetingsService`.

### 2.1 Helper / Utils

- [x] T004 Tạo agenda permission check method trong `src/modules/meetings/services/meetings.service.ts`
  - Method `checkAgendaReadPermission(meetingId: string, userId: string): Promise<boolean>`
    - Load meeting (`findOne` hoặc `findOneBy`)
    - Kiểm tra: user là organizer, host, hoặc có trong `meeting_participants`
    - Nếu không có quyền: throw `AGENDA_READ_FORBIDDEN`
  - Method `checkAgendaWritePermission(meeting: MeetingEntity, userId: string): void`
    - Kiểm tra: `userId === meeting.organizerId || userId === meeting.hostId`
    - Nếu không có quyền: throw `AGENDA_WRITE_FORBIDDEN`
    - **Không** dùng `participant_role` — chỉ dùng `meetings.host_id`
  - Outcome: Permission logic tách riêng, reusable

### 2.2 GET Agendas Service

- [x] T005 Implement `getAgendas()` trong `src/modules/meetings/services/meetings.service.ts`
  - Signature: `async getAgendas(meetingId: string, currentUserId: string): Promise<AgendaListResponseDto>`
  - Steps:
    1. Load meeting, check tồn tại (throw `MEETING_NOT_FOUND` nếu deleted/null)
    2. Gọi `checkAgendaReadPermission()`
    3. Query `meeting_agendas` WHERE `meeting_id = :meetingId` ORDER BY `agenda_order ASC`
    4. Resolve `ownerName`: JOIN `users` table hoặc query riêng
    5. Tính toán metadata: `totalPlannedDurationMinutes`, `remainingDurationMinutes`
    6. Tính `durationStatus`: 'valid' nếu tổng <= meeting duration, 'overflow' nếu vượt
    7. Tính `isLockedForEditing`: true nếu meeting status != 'scheduled' (cùng lúc set `lockReason = 'MEETING_NOT_SCHEDULED'`)
    8. Map sang `AgendaListResponseDto` và trả về
  - Imports cần thêm: `MeetingAgendaEntity`, `UserEntity` (JOIN), Response DTOs
  - Outcome: GET endpoint logic hoàn chỉnh

### 2.3 PUT Agendas Service — Validation

- [x] T006 Implement validation chain cho `replaceAgendas()` trong `src/modules/meetings/services/meetings.service.ts`
  - Private method `validateReplaceAgendaRequest(meeting: MeetingEntity, dto: ReplaceAgendaDto, currentUserId: string)`
  - Validation thứ tự ưu tiên (dừng ngay khi lỗi đầu tiên):
    1. Meeting time invalid: `!meeting.startTime || !meeting.endTime || endTime <= startTime` → `MEETING_TIME_INVALID_FOR_AGENDA` (409)
    2. Meeting status blocked: `meeting.status !== 'scheduled'` → `AGENDA_MEETING_STATUS_BLOCKED` (409)
    3. Item limit: `dto.items.length > 50` → `AGENDA_ITEM_LIMIT_EXCEEDED` (422)
    4. Duplicate item id: detect `id` trùng trong request → `AGENDA_DUPLICATE_ITEM_ID` (422)
    5. Item id wrong meeting: load existing item ids, check `id` thuộc meeting này → `AGENDA_ITEM_NOT_IN_MEETING` (422)
    6. Field validation (từng item):
       - `title` rỗng sau trim → `AGENDA_TITLE_REQUIRED` (422)
       - `title.length > 255` → `AGENDA_TITLE_TOO_LONG` (422)
       - `description.length > 2000` → `AGENDA_DESCRIPTION_TOO_LONG` (422)
       - `plannedDurationMinutes <= 0` hoặc không phải integer → `AGENDA_INVALID_DURATION` (422)
    7. Owner invalid: load `meeting_participants`, check `ownerId` thuộc danh sách → `AGENDA_OWNER_NOT_PARTICIPANT` (422)
    8. Duration overflow: tổng `plannedDurationMinutes` > meeting duration → `AGENDA_DURATION_OVERFLOW` (422)
  - Outcome: Validation logic tách riêng, testable

### 2.4 PUT Agendas Service — Atomic Replace

- [x] T007 Implement `replaceAgendas()` — atomic replace transaction trong `src/modules/meetings/services/meetings.service.ts`
  - Signature: `async replaceAgendas(meetingId: string, dto: ReplaceAgendaDto, currentUserId: string): Promise<ReplaceAgendaResponseDto>`
  - Steps:
    1. Load meeting (với `SELECT ... FOR UPDATE` qua `EntityManager` trong transaction)
    2. Gọi `checkAgendaWritePermission()`
    3. Gọi `validateReplaceAgendaRequest()`
    4. **No-op detection**: Load DB items, normalize request, so sánh field-by-field:
       - Nếu không có thay đổi: trả response từ DB (không ghi audit, không update DB)
       - Field so sánh: `id`, `agendaOrder`, `title` (trim), `description`, `ownerId`, `plannedDurationMinutes`, `status = 'planned'`
    5. BEGIN transaction (dùng `DataSource.transaction`)
    6. **Delete**: Xóa items có trong DB nhưng không có trong request
    7. **Update**: Update items có `id` (chỉ update field nghiệp vụ + `updated_by`, giữ `created_by`)
    8. **Insert**: Insert items không có `id` (set `created_by` = `updated_by` = `currentUserId`, `status = 'planned'`)
    9. Normalize `agenda_order` = index + 1 sau cùng (update lại tất cả items)
    10. **Audit log**: Gọi `AuditLogService.log()` với:
        - `action = 'agenda_saved'`, `actorId = currentUserId`, `targetType = 'meeting'`, `targetId = meetingId`
        - `oldValueJson = JSON.stringify(existingItems)`, `newValueJson = JSON.stringify(newItems)`
        - `severity = 'info'`
    11. COMMIT transaction
    12. Trả về `ReplaceAgendaResponseDto`
  - Xử lý exception: nếu có lỗi trong transaction, rollback tự động
  - Imports cần thêm: `DataSource`, `EntityManager`, `In`, `AuditLogService`
  - Outcome: PUT endpoint logic hoàn chỉnh

---

## Phase 3: Controller & Routing

Mục tiêu: Expose 2 endpoint REST, gắn guard kiểm soát quyền.

### 3.1 GET Endpoint

- [x] T008 [P] Thêm GET endpoint trong `src/modules/meetings/controllers/meetings.controller.ts`
  - `@Get(':meetingId/agendas')`
  - `@UseGuards(JwtAuthGuard)`
  - Gọi `meetingsService.getAgendas(meetingId, currentUser.id)`
  - Response 200: `{ success: true, message: '...', data: AgendaListResponseDto }`
  - Exception filter tự động handle `AGENDA_READ_FORBIDDEN` thành 403, `MEETING_NOT_FOUND` thành 404
  - Outcome: GET endpoint hoàn chỉnh

### 3.2 PUT Endpoint

- [x] T009 [P] Thêm PUT endpoint trong `src/modules/meetings/controllers/meetings.controller.ts`
  - `@Put(':meetingId/agendas')`
  - `@UseGuards(JwtAuthGuard)`
  - `@Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))`
  - Gọi `meetingsService.replaceAgendas(meetingId, dto, currentUser.id)`
  - Response 200: `{ success: true, message: '...', data: ReplaceAgendaResponseDto }`
  - Exception filter tự động handle các error code thành HTTP status tương ứng
  - Outcome: PUT endpoint hoàn chỉnh

### 3.3 Guard & Permission

- [x] T010 Đảm bảo permission guard hoạt động đúng
  - Endpoint GET: cho phép internal participant, host, organizer (check trong service)
  - Endpoint PUT: chỉ host/organizer/admin (check trong service qua `meetings.host_id` và `meetings.organizer_id`)
  - Nếu cần: thêm `@RequirePermissions()` decorator nếu permission có sẵn
  - Không thêm seed permission mới (dùng permission `meeting.agenda.write` và `meeting.agenda.read`)
  - Outcome: Endpoint được bảo vệ đúng

---

## Phase 4: Testing

Mục tiêu: Unit test cho DTO validation, service methods, controller. Edge case coverage.

### 4.1 DTO Validation Tests

- [ ] T011 [P] Tạo DTO validation tests tại `src/modules/meetings/tests/meetings.service.spec.ts` (thêm vào file hiện có)
  - Test `AgendaItemDto`:
    - `title` required: undefined/null/empty sau trim trả validation error
    - `title` > 255 trả validation error
    - `plannedDurationMinutes` <= 0 trả validation error
    - `plannedDurationMinutes` không phải integer trả validation error
    - `description` > 2000 trả validation error
    - `ownerId` invalid UUID trả validation error
    - Dto hợp lệ với chỉ title + plannedDurationMinutes (không owner) pass validation
  - Test `ReplaceAgendaDto`:
    - `items = null` trả validation error
    - `items` không phải array trả validation error
    - `items = []` (rỗng) pass validation
    - `items` hợp lệ với 2 item pass validation
  - Outcome: DTO validation coverage

### 4.2 Service Tests

- [ ] T012 [P] Tạo service tests cho `getAgendas()` trong `src/modules/meetings/tests/meetings.service.spec.ts`
  - Mock: `MeetingAgendaEntity`, `MeetingEntity`, `UserEntity`
  - Test cases:
    - TC-01: `getAgendas()` trả danh sách sorted theo `agenda_order ASC`
    - TC-02: `getAgendas()` trả empty [] nếu không có agenda
    - TC-03: `getAgendas()` trả `durationStatus = 'valid'` nếu tổng planned <= meeting duration
    - TC-04: `getAgendas()` trả `durationStatus = 'overflow'` nếu tổng planned > meeting duration
    - TC-05: `getAgendas()` trả `isLockedForEditing = true` nếu meeting không ở `scheduled`
    - TC-06: `getAgendas()` trả `ownerName` đúng từ users table
    - TC-07: `getAgendas()` throw `AGENDA_READ_FORBIDDEN` nếu user không có quyền
  - Outcome: Service GET coverage

- [ ] T013 [P] Tạo service tests cho `replaceAgendas()` trong `src/modules/meetings/tests/meetings.service.spec.ts`
  - Mock: `MeetingAgendaEntity`, `MeetingEntity`, `DataSource.transaction()`, `AuditLogService`
  - Test cases:
    - TC-08: `replaceAgendas()` create 2 items mới thành công
    - TC-09: `replaceAgendas()` atomic replace: xóa 1 cũ, update 1, create 2 mới
    - TC-10: `replaceAgendas()` clear toàn bộ khi items = []
    - TC-11: `replaceAgendas()` 409 `AGENDA_MEETING_STATUS_BLOCKED` khi meeting không ở `scheduled`
    - TC-12: `replaceAgendas()` 409 `MEETING_TIME_INVALID_FOR_AGENDA` khi time invalid
    - TC-13: `replaceAgendas()` 422 `AGENDA_OWNER_NOT_PARTICIPANT` khi owner invalid
    - TC-14: `replaceAgendas()` 422 `AGENDA_DURATION_OVERFLOW` khi overflow
    - TC-15: `replaceAgendas()` 422 `AGENDA_ITEM_LIMIT_EXCEEDED` khi > 50 items
    - TC-16: `replaceAgendas()` 422 `AGENDA_TITLE_REQUIRED` khi title empty
    - TC-17: `replaceAgendas()` 422 `AGENDA_TITLE_TOO_LONG` khi title > 255
    - TC-18: `replaceAgendas()` 422 `AGENDA_DESCRIPTION_TOO_LONG` khi description > 2000
    - TC-19: `replaceAgendas()` 200 no-op khi payload giống DB
    - TC-20: `replaceAgendas()` transaction rollback khi lỗi (không có item nào được ghi)
    - TC-21: `replaceAgendas()` ghi audit log sau khi thành công
    - TC-22: `replaceAgendas()` 422 `AGENDA_DUPLICATE_ITEM_ID` khi duplicate id
    - TC-23: `replaceAgendas()` 422 `AGENDA_ITEM_NOT_IN_MEETING` khi item id không thuộc meeting
  - Outcome: Service PUT coverage (16 test cases)

### 4.3 Controller Tests

- [ ] T014 [P] Tạo controller tests trong `src/modules/meetings/tests/meetings.controller.spec.ts` (thêm vào file hiện có)
  - Mock: `MeetingsService` (jest.mock hoặc provider override)
  - Test cases:
    - TC-24: GET `:meetingId/agendas` trả 200 với data đúng format
    - TC-25: GET `:meetingId/agendas` trả 403 khi user không có quyền
    - TC-26: PUT `:meetingId/agendas` trả 200 khi thành công
    - TC-27: PUT `:meetingId/agendas` trả 403 khi user không có quyền
    - TC-28: PUT `:meetingId/agendas` trả 422 khi validation fail (DTO error)
    - TC-29: PUT `:meetingId/agendas` trả 400 khi `items = null`
  - Outcome: Controller coverage

### 4.4 Edge Case Tests

- [ ] T015 [P] Tạo edge case / integration tests trong `src/modules/meetings/tests/meetings.service.spec.ts`
  - Test cases:
    - TC-30: `replaceAgendas()` với `ownerId = null` được chấp nhận
    - TC-31: `replaceAgendas()` với `ownerId = hostId` (host tự giao cho mình) được chấp nhận
    - TC-32: `replaceAgendas()` tính `agenda_order` đúng index sau replace
    - TC-33: `getAgendas()` trả `lockReason = 'MEETING_NOT_SCHEDULED'` khi meeting in_progress
    - TC-34: `replaceAgendas()` 409 khi `start_time` null
    - TC-35: `replaceAgendas()` 409 khi `end_time` null
  - Outcome: Edge case coverage

---

## Requirements Coverage

| Task ID | FR liên quan | AC liên quan | Mô tả |
|---|---|---|---|
| T001 | FR-022, FR-023, FR-023a, FR-030 | AC-012, AC-013, AC-022, AC-026 | DTO input với validation decorators |
| T002 | FR-021, FR-029 | AC-019, AC-020 | ReplaceAgendaDto với items array validation |
| T003 | FR-001, FR-003 | AC-001, AC-004 | Response DTOs cho GET và PUT |
| T004 | FR-002, FR-003, FR-018 | AC-004, AC-005, AC-006 | Permission check (host_id/organizer_id) |
| T005 | FR-003, FR-011, FR-013 | AC-004, AC-023 | GET agendas service |
| T006 | FR-014, FR-020, FR-023a, FR-024, FR-025, FR-026, FR-027, FR-029, FR-030, FR-031, FR-033 | AC-008-AC-013, AC-017, AC-020-AC-022, AC-025, AC-026 | Validation priority chain |
| T007 | FR-001, FR-004, FR-005, FR-008, FR-010, FR-028, FR-032 | AC-001-AC-003, AC-014-AC-016, AC-018, AC-024 | Atomic replace + no-op + audit |
| T008 | FR-001, FR-003 | AC-004, AC-023 | GET endpoint |
| T009 | FR-001, FR-002 | AC-001, AC-005 | PUT endpoint |
| T010 | FR-002, FR-003, FR-018 | AC-004-AC-007 | Guard & permission enforcement |
| T011 | FR-021, FR-022, FR-023, FR-023a, FR-030 | AC-012, AC-013, AC-019, AC-022, AC-026 | DTO validation tests |
| T012 | FR-003 | AC-004, AC-023 | Service GET tests |
| T013 | FR-001, FR-004-FR-008, FR-010, FR-014, FR-020, FR-023a, FR-024-FR-032 | AC-001-AC-003, AC-008-AC-022, AC-024, AC-025 | Service PUT tests |
| T014 | FR-017, FR-018, FR-019 | AC-005-AC-007 | Controller tests |
| T015 | FR-001, FR-006, FR-011, FR-013, FR-031 | AC-015, AC-023 | Edge case tests |

---

## Task Dependency Graph

```text
Phase 1: T001 ── T002 ── T003 (cả 3 parallel [P])
               |
Phase 2:       T004 (foundation cho T005-T007)
               |
               T005 (GET service, cần T004)
               |
               T006 (validation chain, cần T004)
               |
               T007 (atomic replace, cần T004 + T006)
               |
Phase 3:       T008 [P] (GET controller, cần T005)
               T009 [P] (PUT controller, cần T007)
               |
               T010 (guard, cần T008 + T009)
               |
Phase 4:       T011 [P] (DTO tests, cần T001 + T002)
               T012 [P] (service GET tests, cần T005)
               T013 [P] (service PUT tests, cần T006 + T007)
               T014 [P] (controller tests, cần T008 + T009)
               T015 [P] (edge case tests, cần T007)
```

---

## Parallel Execution Opportunities

- Phase 1: Cả 3 DTO tasks (T001, T002, T003) có thể làm song song vì không phụ thuộc nhau
- Phase 2: T005 (GET) và T006 (validation) có thể làm song song sau T004
- Phase 3: T008 (GET endpoint) và T009 (PUT endpoint) có thể làm song song
- Phase 4: Tất cả 5 test tasks (T011-T015) có thể làm song song sau Phase 3

---

## Implementation Strategy

1. **MVP scope**: T001 → T004 → T005 → T006 → T007 → T008 → T009 → T010 (core logic + 2 endpoint)
2. **Testing additions**: T011 → T012 → T013 → T014 → T015 (thêm sau khi core hoàn thành, có thể parallel)
3. **No seed permission needed**: Dùng permission `meeting.agenda.write` và `meeting.agenda.read` có sẵn
4. **No new tables/entity**: Reuse `MeetingAgendaEntity` hiện có
5. **No notification/queue**: Deferred theo spec
