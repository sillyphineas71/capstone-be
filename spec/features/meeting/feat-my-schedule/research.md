# Research: UC-MM-05 Tra cứu lịch trình cá nhân

> Codebase analysis and technology decisions for the My Schedule feature.

## 1. Codebase Analysis

### 1.1 Project Structure (NestJS + TypeORM)

| Layer | Pattern hiện tại | Ghi chú |
|---|---|---|
| Framework | NestJS, strict TypeScript | Global prefix `/api/v1` |
| ORM | TypeORM with `DataSource` injection | `autoLoadEntities: true`, `synchronize: false` |
| Module registration | `@Module({ imports, controllers, providers, exports })` | Mỗi module import `TypeOrmModule.forFeature([...])` |
| Guards | `JwtAuthGuard` + `PermissionsGuard` | Applied per-endpoint via `@UseGuards()` |
| Permissions | `@RequirePermissions('resource.action')` | Custom decorator using `SetMetadata` |
| Current user | `request['user']` or `@CurrentUser()` decorator | Extracted from JWT in guard |
| Transactions | `this.dataSource.transaction(async (em) => { ... })` | Raw SQL or TypeORM `EntityManager` |
| Exception format | `{ success, message, error: { code, details } }` | Consistent structured errors |

### 1.2 Meetings Module Analysis

| File | Vai trò |
|---|---|
| `meetings.controller.ts` | REST endpoints, uses guards/validation |
| `meetings.service.ts` | Core logic (2189 lines), uses `DataSource` directly |
| `meeting.entity.ts` | Entity for `meetings` table |
| `meeting-participant.entity.ts` | Entity for `meeting_participants` |
| `meeting-agenda.entity.ts` | Entity for `meeting_agendas` |
| Các DTO files | Input validation + response shapes |

### 1.3 Reusable Patterns

| Pattern | Reuse trong feature này |
|---|---|
| `JwtAuthGuard` | ✅ Both endpoints need it |
| `PermissionsGuard` + `@RequirePermissions('schedule.read.self')` | ✅ New permission needed |
| `@CurrentUser()` decorator | ✅ Get userId from token |
| `DataSource` injection in service | ✅ Standard pattern |
| `ValidationPipe` with `whitelist`, `transform`, `forbidNonWhitelisted` | ✅ For query params DTO |
| Structured exception objects | ✅ Consistent error codes |
| `@Query()` param parsing | ✅ For schedule query params |
| `@Param('meetingId', ParseUUIDPipe)` | ✅ For detail endpoint |
| `findAndCount` for pagination | ❌ Not needed (no pagination, just range) |

### 1.4 Existing Entities to Import

| Entity | Module | Already in `TypeOrmModule.forFeature`? |
|---|---|---|
| `MeetingEntity` | `meetings` | ✅ |
| `MeetingParticipantEntity` | `meetings` | ✅ |
| `MeetingAgendaEntity` | `meetings` | ✅ |
| `MeetingExternalParticipantEntity` | `meetings` | ✅ |
| `RoomEntity` | `rooms` | ✅ (imported in MeetingsModule) |
| `RoomBookingEntity` | `rooms` | ✅ (imported in MeetingsModule) |
| `MediaFileEntity` | ? | Need to check — might need import |
| `RecordingConfigEntity` | ? | Need to check — might need import |
| `UserEntity` | `accounts` | Need to check |

### 1.5 Key Decisions

#### Decision 1: Query method — QueryBuilder vs Raw SQL

- **Chosen**: TypeORM QueryBuilder with `where`, `andWhere`, `leftJoinAndSelect`
- **Rationale**: Feature is read-only, no complex writes. QueryBuilder gives type safety and composability for dynamic filters (status, role, roomId, q). Matches existing patterns in the codebase.
- **Alternatives considered**: Raw SQL — not needed since queries are not write-heavy; Repository pattern — not used in current codebase.

#### Decision 2: New module vs extend meetings module

- **Chosen**: Extend `meetings` module (add new controller + service file)
- **Rationale**: Feature reads from meetings entities; adding a `me/schedule` resource does not warrant a new module per the constitution's "no module boundary violation" rule. The `/me` prefix represents "current user", not a new domain.
- **Alternatives considered**: New `schedule` module — over-engineering; New `user-schedule` module — scope creep.

#### Decision 3: DTO for query params

- **Chosen**: Class-based DTO with `@IsEnum`, `@IsDateString`, `@IsOptional`, `@IsUUID`, `@MaxLength` decorators
- **Rationale**: Matches existing DTO pattern in the meetings module. `class-validator` + `ValidationPipe` handles everything.
- **Alternatives considered**: Raw `@Query()` with individual params — mix of patterns, harder to maintain.

#### Decision 4: Transaction boundary

- **Chosen**: No transaction needed. Feature is read-only (SELECT queries only).
- **Rationale**: No writes = no need for transaction. Use `read-committed` isolation which is PostgreSQL default.
- **Alternatives considered**: Read transaction — over-engineering for a simple SELECT with JOINs.

#### Decision 5: Permission name

- **Chosen**: `schedule.read.self` (new permission)
- **Rationale**: Matches existing convention (`resource.action.scope`). Currently no user has this permission by default — need to add via seed migration.
- **Alternatives considered**: `meeting.schedule.read.self` — too verbose; no guard at all — violates Auth Gate.

#### Decision 6: Popup detail response — join vs separate queries

- **Chosen**: Single service method with multiple `findOne`/`find` calls, each with required relations
- **Rationale**: Clean separation; avoid deep nested joins that hurt readability. Six separate queries (meeting, room, organizer, host, participants, agendas, attachments, recordingConfig) all with the same `meetingId` — database handles this efficiently.
- **Alternatives considered**: One massive query with all JOINs — hard to maintain, no performance benefit at this scale.

## 2. Dependencies & Integrations

| Dependency | Type | Impact |
|---|---|---|
| `meetings` module entities | Internal | Must import `TypeOrmModule.forFeature` with required entities |
| `accounts` module (UserEntity) | Internal | For organizer/host details in popup |
| `rooms` module (RoomEntity, RoomBookingEntity) | Internal | Already imported in MeetingsModule |
| New permission seed | Migration | Add `schedule.read.self` to seed + assign to default roles |

## 3. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Spec chưa định nghĩa `meeting_code` field trong entity | Medium | Use meeting.id nếu meeting_code null; spec đã mention meetingCode trong response |
| `MediaFileEntity` chưa được import trong MeetingsModule | Medium | Thêm import nếu cần; hoặc dùng raw query để join |
| Overlap query `[from, to)` có thể chậm nếu `meetings` table lớn và thiếu index trên `start_time`, `end_time` | Low | Index trên `start_time`, `end_time` đã có từ DB baseline |
| `schedule.read.self` permission chưa có trong seed hiện tại | High | Phải tạo migration seed mới |

## 4. Unknowns Resolved

| Unknown | Resolution |
|---|---|
| `schedule.read.self` — permission name | Dùng `schedule.read.self` theo convention `resource.action.scope` |
| `schedule.read.self` — gán cho role nào? | Gán cho tất cả role mặc định (admin, manager, employee) vì mọi user đều cần xem lịch cá nhân |
| `MediaFileEntity` location | Cần kiểm tra module `media` hoặc `recording` — nếu chưa có thì tạo entity reference trong `meetings` module |
| `RecordingConfigEntity` location | Cần kiểm tra module `recording` |
