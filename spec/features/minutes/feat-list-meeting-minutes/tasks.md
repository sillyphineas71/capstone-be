# Tasks: Xem danh sách biên bản họp

**Feature ID**: MINUTES-LIST-001
**Input**: Design documents from `spec/features/minutes/feat-list-meeting-minutes/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/feat-list-meeting-minutes-api.md, quickstart.md

---

## Phase 1: Migration & DTOs & Foundation

**Purpose**: Seed permission mới, tạo query DTO và response DTOs.

**Outcome**: Hoàn thành Phase 1 thì có đủ permission + DTOs để implement service + controller.

- [x] T001 Tạo migration `src/database/migrations/20260702010000-SeedMeetingMinutesReadPermission.ts`:
  - Class `SeedMeetingMinutesReadPermission20260702010000 implements MigrationInterface`
  - Permission `meeting.minutes.read`, module_code=`minutes`, action_code=`minutes.read`
  - Gán cho roles: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`
  - Theo đúng pattern `SeedTranscriptionPermissions20260629020000` (INSERT ... ON CONFLICT DO NOTHING, có `up()`/`down()`)
- [x] T002 [P] Tạo `MinutesQueryDto` tại `src/modules/minutes/dto/minutes-query.dto.ts`:
  - `page?: number` — `@IsOptional() @Type(() => Number) @Min(1)`
  - `limit?: number` — `@IsOptional() @Type(() => Number) @Min(1) @Max(20)` (BR2)
  - `status?: string` — `@IsOptional() @IsIn(['draft','published','archived','all'])`
  - `roomId?: string` — `@IsOptional() @IsUUID('4')`
  - `from?: string` — `@IsOptional()` (ISO 8601 string)
  - `to?: string` — `@IsOptional()` (ISO 8601 string)
  - `q?: string` — `@IsOptional() @IsString()`
  - `sortBy?: string` — `@IsOptional() @IsIn(['actual_start_time','created_at'])`
  - `sortOrder?: string` — `@IsOptional() @IsIn(['asc','desc'])`
  - Class-level decorator `@Validate(FromToConstraint)` (tái sử dụng từ `src/modules/meetings/validators/from-to.constraint.ts`)
- [x] T003 [P] Tạo `MinutesMeetingSummaryDto` tại `src/modules/minutes/dto/minutes-meeting-summary.dto.ts`:
  - Fields: `id`, `title`, `actualStartTime`, `actualEndTime`, `meetingMode`, `room: RoomSummaryDto | null`
- [x] T004 [P] Tạo `MinutesListItemDto` tại `src/modules/minutes/dto/minutes-list-item.dto.ts`:
  - Fields: `id`, `title`, `status`, `versionNo`, `createdAt`, `meeting: MinutesMeetingSummaryDto`, `host: UserSummaryDto | null`

**Checkpoint**: Permission `meeting.minutes.read` migration sẵn sàng, DTOs sẵn sàng.

---

## Phase 2: Service Layer — Query Logic

**Purpose**: Implement method `findMinutesList()` trong `MinutesService`.

**Outcome**: Hoàn thành Phase 2 thì có method service có thể gọi từ controller.

**Dependency**: Phase 1 (DTOs)

- [x] T005 [US1] Thêm method `findMinutesList(queryDto: MinutesQueryDto, authUser: { userId: string })` vào `src/modules/minutes/services/minutes.service.ts`:
  - Tạo QueryBuilder: `this.dataSource.getRepository(MeetingMinutesEntity).createQueryBuilder('minutes')`
  - LEFT JOIN + select limited fields:
    ```
    .leftJoin('minutes.meeting', 'meeting')
    .leftJoin(RoomEntity, 'room', 'room.id = meeting.roomId')
    .leftJoin(UserEntity, 'host', 'host.id = meeting.hostId')
    .select([...])
    ```
  - **Loại trừ deleted**: `.andWhere('minutes.deletedAt IS NULL')`
  - **Scope theo role**: lấy `roles` qua `this.authzRepo.getEffectiveRolesAndPermissions(authUser.userId)`, xác định `isAdmin`; nếu không phải admin, áp dụng `Brackets` theo đúng logic mô tả ở plan.md mục 6 / data-model.md mục 5 (draft chỉ prepared_by=self HOẶC published/archived chỉ host/participant qua EXISTS subquery trên `meeting_participants`)
  - **status filter (client)**: nếu có và khác `all`, `.andWhere('minutes.status = :status')`
  - **roomId filter**: `.andWhere('meeting.roomId = :roomId')` nếu có
  - **Date range filter**: `.andWhere('meeting.actualStartTime BETWEEN :from AND :to')` nếu có `from` và `to`
  - **q search**: `.andWhere('(minutes.title ILIKE :q OR meeting.title ILIKE :q OR host.fullName ILIKE :q)', { q: '%'+q+'%' })` nếu có
  - **Sort**: allowlist `['actual_start_time','created_at']`, map `actual_start_time` → `meeting.actualStartTime`, `created_at` → `minutes.createdAt`; default `meeting.actualStartTime DESC`
  - **Pagination**: `limit = Math.min(20, Math.max(1, queryDto.limit ?? 20))`; `.skip(skip).take(limit)`
  - Execute: `const [items, total] = await qb.getManyAndCount();`
  - Map items → `MinutesListItemDto[]`: null-safe cho `host` (null nếu `meeting.hostId` null), `room` (null nếu `meeting.roomId` null)
  - Return `{ items, total, page, limit }`
  - Xử lý exception: catch + log → throw `InternalServerErrorException`

**Checkpoint**: Service method `findMinutesList()` hoàn chỉnh với đầy đủ scope, filter, sort, pagination.

---

## Phase 3: Controller Layer — API Endpoint

**Purpose**: Expose `GET /api/v1/meeting-minutes` với guard/permission.

**Outcome**: Hoàn thành Phase 3 thì có API endpoint có thể gọi được.

**Dependency**: Phase 2 (service method)

- [x] T006 [US1] Tạo `MeetingMinutesListController` tại `src/modules/minutes/controllers/minutes-list.controller.ts`:
  - `@Controller('meeting-minutes')`
  - Inject `MinutesService`
  - Endpoint `GET /`:
    ```typescript
    @Get()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermissions('meeting.minutes.read')
    async findAll(
      @Query(new ValidationPipe({ transform: true, whitelist: true })) query: MinutesQueryDto,
      @CurrentUser() user: { userId: string },
    ) {
      const result = await this.minutesService.findMinutesList(query, user);
      return {
        success: true,
        message: 'Danh sách biên bản họp',
        data: result.items,
        meta: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit) || 0,
        },
      };
    }
    ```

- [x] T007 [US1] Cập nhật `src/modules/minutes/minutes.module.ts`: thêm `MeetingMinutesListController` vào mảng `controllers`.

**Checkpoint**: API `GET /api/v1/meeting-minutes` hoạt động, guard + permission check OK.

---

## Phase 4: Unit Tests

**Purpose**: Đảm bảo coverage cho tất cả acceptance criteria.

**Outcome**: Hoàn thành Phase 4 thì có test coverage cho service và controller.

**Dependency**: Phase 2 + Phase 3

- [x] T008 [P] [US1] Viết unit test cho `findMinutesList()` tại `src/modules/minutes/services/minutes-list.service.spec.ts` (co-located theo convention hiện có của module minutes, không dùng thư mục `tests/`):
  - Test Host thấy draft của chính mình (AC-001)
  - Test Participant KHÔNG thấy draft của Host (AC-002)
  - Test Participant thấy published của meeting mình tham dự (AC-003)
  - Test non-host/non-participant KHÔNG thấy published/archived
  - Test Business Admin thấy toàn bộ kể cả draft người khác (AC-004)
  - Test System Admin ngang Business Admin (AC-005)
  - Test loại trừ status=deleted kể cả admin
  - Test filter theo status (AC-007)
  - Test filter theo roomId
  - Test filter theo from/to
  - Test search q khớp minutes.title / meeting.title / host.fullName (AC-008)
  - Test meeting online (room=null) không lỗi (AC-009)
  - Test host null không lỗi
  - Test sort mặc định actualStartTime DESC (AC-012)
  - Test pagination tối đa 20 (AC-010)
  - Test scope rỗng → 200 data=[] (AC-013)
  - Test DB error → 500

- [x] T009 [P] [US1] Viết unit test cho controller endpoint tại `src/modules/minutes/controllers/minutes-list.controller.spec.ts` (co-located, không dùng thư mục `tests/`):
  - Test `GET /meeting-minutes` gọi đúng service method
  - Test guard/permission 403 khi không có `meeting.minutes.read` (AC-006)
  - Test response format đúng contract
  - Test pagination meta format
  - Test `limit > 20` → 400 (AC-011)
  - Test `status` invalid → 400 (AC-014)

**Checkpoint**: Tất cả 14 AC được cover bởi test.

---

## Phase 5: Verification & Documentation

**Purpose**: Kiểm tra chất lượng code, verify API responses.

**Outcome**: Feature sẵn sàng cho review/deploy.

**Dependency**: Phase 4

- [x] T010 Chạy lint + build — `npm run lint` và `npm run build` — fix lỗi nếu có.
- [x] T011 Verify API responses match contract trong `contracts/feat-list-meeting-minutes-api.md`.
- [x] T012 Cập nhật CHANGELOG trong spec.md/plan.md/research.md/data-model.md nếu có sửa đổi trong quá trình implement.

---

## Requirements Coverage

### Task → AC Mapping

| Task | ACs covered | FRs covered |
|------|-------------|-------------|
| T001 | — | (seed permission) |
| T002 | AC-011, AC-014 | FR-025 → FR-030 |
| T003, T004 | AC-009 | FR-020 → FR-024 |
| T005 | AC-001 → AC-005, AC-007 → AC-010, AC-012, AC-013 | FR-003 → FR-024, FR-032 → FR-035 |
| T006 | AC-006 | FR-001, FR-002, FR-031 |
| T007 | — | (module config) |
| T008 | AC-001 → AC-005, AC-007 → AC-013 | NFR-012 |
| T009 | AC-006, AC-011, AC-014 | NFR-012 |
| T010 | — | (quality) |
| T011 | — | (contract verification) |
| T012 | — | (documentation) |

### Coverage Summary

| AC | Status | Covered by |
|----|--------|-----------|
| AC-001 | ✅ | T005 + T008 |
| AC-002 | ✅ | T005 + T008 |
| AC-003 | ✅ | T005 + T008 |
| AC-004 | ✅ | T005 + T008 |
| AC-005 | ✅ | T005 + T008 |
| AC-006 | ✅ | T006 + T009 |
| AC-007 | ✅ | T005 + T008 |
| AC-008 | ✅ | T005 + T008 |
| AC-009 | ✅ | T003, T004, T005 + T008 |
| AC-010 | ✅ | T005 + T008 |
| AC-011 | ✅ | T002 + T009 |
| AC-012 | ✅ | T005 + T008 |
| AC-013 | ✅ | T005 + T008 |
| AC-014 | ✅ | T002 + T009 |

## Dependency Graph

```
T001 (migration) ──┐
T002 (dto)        ──┤ [P]
T003 (dto)        ──┤
T004 (dto)        ──┘
       │
       ▼
T005 (service)
       │
       ▼
T006 (ctrl)  ──┐
T007 (module)──┤
       │
       ▼
T008 (svc-test) ──┐ [P]
T009 (ctrl-test)──┤
       │
       ▼
T010 (lint)   ──┐
T011 (verify) ──┤ [P]
T012 (docs)   ──┘
```

## Implementation Strategy

### MVP Scope (Phase 1 + Phase 2 + Phase 3)

1. T001 → Permission ready
2. T002–T004 → DTOs ready
3. T005 → Service logic ready
4. T006–T007 → API endpoint ready, có thể test qua curl/Postman

### Full Delivery (All Phases)

Sau MVP, thêm tests và verification.

### Total Tasks: 12
- Phase 1: 4 tasks (3 [P])
- Phase 2: 1 task
- Phase 3: 2 tasks
- Phase 4: 2 tasks (all [P])
- Phase 5: 3 tasks
