# Tasks: UC-SM-01 â€” Xem danh sÃ¡ch phÃ²ng há»p Ä‘á» xuáº¥t (Room Suggestion)

**Feature ID**: UC-SM-01 (UC-50)
**Module**: `scheduling`
**Endpoint**: `GET /api/v1/scheduling/room-suggestions`
**Branch**: `011-room-suggestion`
**Spec**: `spec/features/scheduler/feat-scheduling-room-suggestions/spec.md`
**Plan**: `spec/features/scheduler/feat-scheduling-room-suggestions/plan.md`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/room-suggestion-api.md, quickstart.md

> Format: `- [ ] TXXX [P] Description with file path`
> - `[P]` = cÃ³ thá»ƒ cháº¡y song song (khÃ¡c files, khÃ´ng dependency)
> - UC-SM-01 lÃ  má»™t feature thá»‘ng nháº¥t, khÃ´ng chia user story riÃªng

---

## Phase 1: Setup â€” Scheduling Module Foundation

**Purpose**: Khá»Ÿi táº¡o vÃ  cáº­p nháº­t Scheduling module, cáº¥u hÃ¬nh TypeORM entities liÃªn quan.

**Dependency**: KhÃ´ng phá»¥ thuá»™c phase nÃ o khÃ¡c.

- [x] T001 Cáº­p nháº­t `SchedulingModule` â€” import `TypeOrmModule.forFeature([RoomEntity, RoomBookingEntity, EquipmentEntity])`, register `SchedulingController` vÃ  `SchedulingService` trong `src/modules/scheduling/scheduling.module.ts`
- [x] T002 [P] Táº¡o folder structure cho scheduling module: services/, dto/, tests/ trong `src/modules/scheduling/`
- [x] T003 [P] Kiá»ƒm tra index tá»“n táº¡i: Ä‘áº£m báº£o `room_bookings` cÃ³ index trÃªn (`room_id`, `reserved_start_time`, `reserved_end_time`, `status`) vÃ  `equipments` cÃ³ index trÃªn (`current_room_id`, `equipment_type`, `asset_status`, `health_status`) â€” táº¡o migration náº¿u thiáº¿u

---

## Phase 2: DTO & Validation Layer

**Purpose**: Táº¡o DTO classes vá»›i decorators `class-validator` vÃ  custom validation logic.

**Dependency**: Cáº§n Phase 1 hoÃ n thÃ nh (folder structure sáºµn sÃ ng).

- [x] T004 [P] Táº¡o `RoomSuggestionQueryDto` trong `src/modules/scheduling/dto/room-suggestion-query.dto.ts` vá»›i cÃ¡c fields: `startTime` (@IsNotEmpty, @IsISO8601 strict), `endTime` (@IsNotEmpty, @IsISO8601 strict), `attendeeCount` (@IsNotEmpty, @IsInt, @Min(1), @Type), `roomType` (@IsOptional, @IsEnum), `siteName` (@IsOptional, @IsString), `areaName` (@IsOptional, @IsString), `allowRecording` (@IsOptional, @IsBoolean, @Transform), `hasCamera` (@IsOptional, @IsBoolean, @Transform), `hasMicrophone` (@IsOptional, @IsBoolean, @Transform), `hasDisplay` (@IsOptional, @IsBoolean, @Transform)
- [x] T005 [P] Táº¡o `RoomSuggestionItemDto` trong `src/modules/scheduling/dto/room-suggestion-item.dto.ts` vá»›i fields: roomId (string), roomCode (string), roomName (string), capacity (number), score (number), available (boolean), matchedFeatures (string[]), warnings (string[])
- [x] T006 [P] Táº¡o `RoomSuggestionResponseDto` (hoáº·c dÃ¹ng `ApiResponseWrapper` type generic) trong `src/modules/scheduling/dto/room-suggestion-response.dto.ts` vá»›i `data: RoomSuggestionItemDto[]` vÃ  `meta: { resultLimit: number }`
- [x] T007 Táº¡o custom validation logic: táº¡o Custom Validator Decorators trong class-validator Ä‘á»ƒ kiá»ƒm tra `endTime > startTime`, `duration <= 24h` (throw `SCHEDULING_DURATION_TOO_LONG`), vÃ  `startTime >= now()` (throw `VALIDATION_ERROR`). TÃ­ch há»£p tháº³ng vÃ o `RoomSuggestionQueryDto` Ä‘á»ƒ ValidationPipe xá»­ lÃ½.

---

## Phase 3: Service Business Logic

**Purpose**: Implement core `SchedulingService.getRoomSuggestions()` vá»›i QueryBuilder, filter Ä‘á»™ng, EXISTS subquery, sort, limit, score.

**Dependency**: Phase 2 (DTOs ready).

- [x] T008 Táº¡o `SchedulingService` trong `src/modules/scheduling/services/scheduling.service.ts` â€” inject EntityManager hoáº·c Repository
- [x] T009 Implement base query: `SELECT room FROM rooms WHERE is_active = true AND deleted_at IS NULL AND capacity >= :attendeeCount AND current_status NOT IN ('maintenance', 'inactive')`
- [x] T010 [P] Implement optional filters: `roomType`, `siteName`, `areaName`, `allowRecording` â€” thÃªm `.andWhere` Ä‘á»™ng náº¿u param cÃ³ giÃ¡ trá»‹ (chá»‰ filter khi value = true cho boolean, khÃ´ng filter khi false/null)
- [x] T011 Implement booking overlap exclusion: `NOT EXISTS (SELECT 1 FROM room_bookings WHERE room_id = room.id AND reserved_start_time < :endTime AND reserved_end_time > :startTime AND status IN ('pending', 'approved', 'active'))` â€” dÃ¹ng QueryBuilder subquery
- [x] T012 [P] Implement `hasCamera` equipment EXISTS filter: `EXISTS (SELECT 1 FROM equipments WHERE current_room_id = room.id AND equipment_type = 'camera' AND asset_status = 'assigned' AND health_status = 'healthy' AND deleted_at IS NULL)` â€” dÃ¹ng QueryBuilder subquery
- [x] T013 [P] Implement `hasMicrophone` equipment EXISTS filter (tÆ°Æ¡ng tá»± T012 vá»›i `equipment_type = 'microphone'`)
- [x] T014 [P] Implement `hasDisplay` equipment EXISTS filter (tÆ°Æ¡ng tá»± T012 vá»›i `equipment_type = 'display'`)
- [x] T015 Implement sort: `.orderBy('room.capacity - :attendeeCount', 'ASC').addOrderBy('room.room_name', 'ASC').addOrderBy('room.room_code', 'ASC')` vÃ  dÃ¹ng `.take(20)` Ä‘á»ƒ limit káº¿t quáº£ táº¡i DB.
- [x] T016 Implement `calculateScore(capacity, attendeeCount): number` â€” heuristic: `Math.max(0, 100 - ((capacity - attendeeCount) / capacity) * 100)`; náº¿u capacity === attendeeCount â†’ score = 100
- [x] T017 Implement `buildMatchedFeatures(rooms, queryParams): Promise<Record<string, string[]>>` â€” sá»­ dá»¥ng batch query (`WHERE room_id IN (...)`) hoáº·c `LEFT JOIN` tá»« main query Ä‘á»ƒ láº¥y danh sÃ¡ch `equipment_type` cho toÃ n bá»™ phÃ²ng nháº±m trÃ¡nh lá»—i N+1 query.
- [x] T018 Implement `buildWarnings(matchedFeatures, requestedFeatures): string[]` â€” so sÃ¡nh thiáº¿t bá»‹ user yÃªu cáº§u vs thiáº¿t bá»‹ thá»±c táº¿ cÃ³, táº¡o warning message náº¿u thiáº¿u (e.g., "Room does not have camera")

---

## Phase 4: Controller & API Layer

**Purpose**: Táº¡o SchedulingController vá»›i endpoint `GET /scheduling/room-suggestions`, gáº¯n guards, response format.

**Dependency**: Phase 2 + Phase 3 (DTOs + Service ready).

- [x] T019 Táº¡o `SchedulingController` trong `src/modules/scheduling/scheduling.controller.ts` â€” inject `SchedulingService`, route path lÃ  `scheduling`
- [x] T020 Implement `getRoomSuggestions(@Query() dto: RoomSuggestionQueryDto, @Req() request)` method:
  - `@Get('room-suggestions')`
  - `@HttpCode(HttpStatus.OK)`
  - `@UseGuards(JwtAuthGuard, PermissionsGuard)`
  - `@RequirePermissions('scheduling.suggest.rooms')`
  - `@UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))`
  - Láº¥y `userId` tá»« `request['user']`
  - Gá»i `this.schedulingService.getRoomSuggestions(dto)` 
  - Tráº£ vá» `{ success: true, message: 'Danh sÃ¡ch phÃ²ng há»p Ä‘á» xuáº¥t', data, meta: { resultLimit: 20 } }`
- [x] T021 [P] Xá»­ lÃ½ empty result: náº¿u `data.length === 0`, tráº£ `message: "KhÃ´ng tÃ¬m tháº¥y phÃ²ng há»p nÃ o Ä‘Ã¡p á»©ng Ä‘á»§ cÃ¡c tiÃªu chÃ­ cá»§a báº¡n trong khung giá» nÃ y."` (HTTP 200, khÃ´ng 404)
- [x] T024 Kiá»ƒm tra guards hoáº¡t Ä‘á»™ng Ä‘Ãºng: `JwtAuthGuard` (401 náº¿u khÃ´ng token), `PermissionsGuard` (403 náº¿u thiáº¿u `scheduling.suggest.rooms`)

---

## Phase 5: Unit Tests

**Purpose**: Unit test cho DTO validation, service logic, controller.

**Dependency**: Phase 2, 3, 4 hoÃ n thÃ nh.

- [x] T030 [P] Táº¡o `room-suggestion-query.dto.spec.ts` trong `src/modules/scheduling/tests/room-suggestion-query.dto.spec.ts` â€” test: valid input, missing startTime, missing endTime, missing attendeeCount, attendeeCount = 0, attendeeCount = -1, invalid ISO format, invalid enum roomType
- [x] T025 [P] Táº¡o `scheduling.service.spec.ts` trong `src/modules/scheduling/tests/scheduling.service.spec.ts` â€” test:
  - Happy path: tráº£ vá» danh sÃ¡ch phÃ²ng Ä‘Ã£ sort Ä‘Ãºng
  - Filter roomType, siteName, areaName, allowRecording hoáº¡t Ä‘á»™ng
  - Booking overlap exclusion (pending/approved/active status)
  - Back-to-back booking khÃ´ng bá»‹ loáº¡i (completed/cancelled/released khÃ´ng tÃ­nh)
  - Equipment EXISTS filter (hasCamera, hasMicrophone, hasDisplay)
  - Equipment EXISTS: 1 healthy + 1 faulty â†’ váº«n Ä‘á» xuáº¥t (EXISTS logic)
  - Capacity < attendeeCount â†’ room bá»‹ loáº¡i
  - Room maintenance/inactive â†’ bá»‹ loáº¡i
  - Empty result â†’ tráº£ data: []
  - Sort order: diff ASC â†’ room_name ASC â†’ room_code ASC
  - Limit 20 rooms
  - Score calculation Ä‘Ãºng
  - matchedFeatures chá»‰ gá»“m equipment type Ä‘Æ°á»£c yÃªu cáº§u vÃ  thá»±c sá»± cÃ³
  - warnings chá»‰ xuáº¥t hiá»‡n náº¿u thiáº¿t bá»‹ yÃªu cáº§u nhÆ°ng khÃ´ng cÃ³
  - Duration > 24h â†’ throw SCHEDULING_DURATION_TOO_LONG
  - startTime trong quÃ¡ khá»© â†’ throw VALIDATION_ERROR
- [x] T026 [P] Táº¡o `scheduling.controller.spec.ts` trong `src/modules/scheduling/tests/scheduling.controller.spec.ts` â€” test:
  - Response structure Ä‘Ãºng (`success`, `message`, `data`, `meta`)
  - Guards applied: test mock guards nÃ©m lá»—i 401 (Missing Token) vÃ  403 (Permission Denied) theo AC-006, AC-007
  - Gá»i service Ä‘Ãºng params
  - Empty result tráº£ message Ä‘Ãºng

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: Documentation, clean code, verify acceptance criteria tá»« quickstart.

**Dependency**: Táº¥t cáº£ phase trÃªn hoÃ n thÃ nh.

- [x] T027 [P] Verify permutation test tá»« `quickstart.md` â€” cháº¡y/táº¡o S1 Ä‘áº¿n S18, Ä‘áº£m báº£o táº¥t cáº£ test cases pass (ghi nháº­n káº¿t quáº£ vÃ o file notes náº¿u cáº§n)
- [x] T028 [P] Clean code review: kiá»ƒm tra unused imports, variable naming, error message consistency, response format
- [x] T029 [P] Cáº­p nháº­t CHANGELOG cho `spec.md` vÃ  `plan.md` â€” ghi nháº­n tiáº¿n Ä‘á»™ hoÃ n thÃ nh (náº¿u cÃ³ thay Ä‘á»•i trong quÃ¡ trÃ¬nh implement)

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)            â†’ khÃ´ng phá»¥ thuá»™c
  â””â”€â”€ Phase 2 (DTO)        â†’ phá»¥ thuá»™c Phase 1
        â””â”€â”€ Phase 3 (Service) â†’ phá»¥ thuá»™c Phase 2 (DTO types)
              â””â”€â”€ Phase 4 (Controller) â†’ phá»¥ thuá»™c Phase 2 + 3
                    â””â”€â”€ Phase 5 (Tests) â†’ phá»¥ thuá»™c Phase 2+3+4
                          â””â”€â”€ Phase 6 (Polish) â†’ phá»¥ thuá»™c táº¥t cáº£
```

### Parallel Opportunities

| Phase | Tasks cháº¡y song song |
|---|---|
| Phase 1 (Setup) | T002 vÃ  T003 song song (khÃ¡c files) |
| Phase 2 (DTO) | T004, T005, T006 song song (3 files khÃ¡c nhau) |
| Phase 3 (Service) | T010, T012, T013, T014 song song (optional filters, equipment EXISTS) |
| Phase 4 (Controller) | T021 xá»­ lÃ½ error handling |
| Phase 5 (Tests) | T025, T026 song song (service + controller tests) |
| Phase 6 (Polish) | T027, T028, T029 song song |

### Implementation Strategy

**MVP Scope**: Implement toÃ n bá»™ feature end-to-end (khÃ´ng chia nhá» theo user story vÃ¬ Ä‘Ã¢y lÃ  má»™t API feature thá»‘ng nháº¥t).

1. HoÃ n thÃ nh Phase 1 â†’ Structure ready
2. HoÃ n thÃ nh Phase 2 â†’ DTO + validation ready
3. HoÃ n thÃ nh Phase 3 â†’ Core business logic ready
4. HoÃ n thÃ nh Phase 4 â†’ API endpoint ready
5. HoÃ n thÃ nh Phase 5 â†’ Tests cover all ACs
6. HoÃ n thÃ nh Phase 6 â†’ Polish + verify quickstart

**Commit Strategy**: Commit sau má»—i phase hoÃ n thÃ nh, hoáº·c sau logical group.

---

## Requirements Coverage

### Functional Requirements â†’ Tasks

| FR ID | EARS Pattern | Task(s) liÃªn quan |
|---|---|---|
| FR-001 | Ubiquitous â€” chá»‰ rooms active | T009 |
| FR-002 | Ubiquitous â€” capacity >= attendeeCount | T009 |
| FR-003 | Ubiquitous â€” sort priority | T015, T016 |
| FR-004 | Ubiquitous â€” snapshot | T009 (khÃ´ng lock) |
| FR-005 | Event-driven â€” validate input | T004, T007 |
| FR-006 | Event-driven â€” bá» qua filter thiáº¿t bá»‹ | T010 (conditional andWhere) |
| FR-007 | Event-driven â€” tráº£ danh sÃ¡ch + score | T015, T016, T017, T018, T020 |
| FR-008 | State-driven â€” maintenance/inactive | T009 |
| FR-009 | State-driven â€” booking overlap | T011 |
| FR-010 | Optional Feature â€” roomType | T010 |
| FR-011 | Optional Feature â€” siteName | T010 |
| FR-012 | Optional Feature â€” allowRecording | T010 |
| FR-013 | Optional Feature â€” thiáº¿t bá»‹ EXISTS | T012, T013, T014 |
| FR-014 | Unwanted â€” invalid time | T007 |
| FR-015 | Unwanted â€” duration > 24h | T007 |
| FR-016 | Unwanted â€” past startTime | T007 |
| FR-017 | Unwanted â€” invalid attendeeCount | T004, T005-extra |
| FR-018 | Unwanted â€” 401 | T024 |
| FR-019 | Unwanted â€” 403 | T024 |
| FR-020 | Unwanted â€” empty result | T021 |
| FR-021 | Authorization â€” 401 | T020 (JwtAuthGuard) |
| FR-022 | Authorization â€” 403 | T020 (PermissionsGuard) |
| FR-023 | Data & State â€” overlap logic | T011 |
| FR-024 | Data & State â€” sort | T015 |
| FR-025 | Data & State â€” limit 20 | T015 |

### Acceptance Criteria â†’ Tasks

| AC ID | Ká»‹ch báº£n | Task(s) liÃªn quan | Test task |
|---|---|---|---|
| AC-001 | Happy path â€” cÃ³ phÃ²ng phÃ¹ há»£p | T009, T010, T015, T016, T020 | T025 |
| AC-002 | Validation â€” thiáº¿u startTime | T004 | T005-extra |
| AC-003 | Validation â€” duration > 24h | T007 | T025 |
| AC-004 | Validation â€” past startTime | T007 | T025 |
| AC-005 | Validation â€” attendeeCount invalid | T004 | T005-extra |
| AC-006 | Auth â€” 401 | T020, T024 | T026 |
| AC-007 | Auth â€” 403 | T020, T024 | T026 |
| AC-008 | Business â€” inactive/maintenance | T009 | T025 |
| AC-009 | Business â€” booking overlap | T011 | T025 |
| AC-010 | Business â€” capacity khÃ´ng Ä‘á»§ | T009 | T025 |
| AC-011 | Business â€” sort priority | T015 | T025 |
| AC-012 | Business â€” equipment EXISTS | T012, T013, T014 | T025 |
| AC-013 | Business â€” khÃ´ng yÃªu cáº§u thiáº¿t bá»‹ | T010 | T025 |
| AC-014 | Empty result | T021 | T025 |
| AC-015 | Concurrency â€” snapshot | T009 | (manual test) |
| AC-016 | Business â€” back-to-back booking | T011 | T025 |
| AC-017 | Business â€” ignore filter on false | T010 | T025 |
| AC-018 | Business â€” limit 20 | T015 | T025 |


