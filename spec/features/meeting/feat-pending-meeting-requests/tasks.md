# Tasks: Lấy danh sách yêu cầu cuộc họp đang chờ duyệt

**Feature ID**: MEETING-PENDING-REQUESTS-001
**Input**: Design documents from `spec/features/meeting/feat-pending-meeting-requests/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/feat-pending-meeting-requests-api.md, quickstart.md

---

## Phase 1: DTOs & Foundation

**Purpose**: Tạo query DTO, response DTOs, permission seed, và FromToConstraint validator.

**Outcome**: Hoàn thành Phase 1 thì có đủ DTOs + validator để implement service + controller.

- [x] T001 Seed permission `meeting_request.read` vào database (thêm vào seed script) — kiểm tra permission đã tồn tại chưa, nếu chưa thì thêm mới.
- [x] T002 [P] Tạo `MeetingRequestQueryDto` tại `src/modules/meetings/dto/meeting-request-query.dto.ts`:
  - `page?: number` — `@IsOptional() @Type(() => Number) @Min(1)`
  - `limit?: number` — `@IsOptional() @Type(() => Number) @Min(1) @Max(100)`
  - `approvalStatus?: string` — `@IsOptional() @IsIn(['pending','approved','rejected','applied','cancelled','all'])`
  - `requestType?: string` — `@IsOptional() @IsIn(['create_meeting','update_time','update_room','cancel_meeting','extend_meeting','book_room'])`
  - `targetRoomId?: string` — `@IsOptional() @IsUUID('4')`
  - `requestedById?: string` — `@IsOptional() @IsUUID('4')`
  - `from?: string` — `@IsOptional()` (ISO 8601 string)
  - `to?: string` — `@IsOptional()` (ISO 8601 string)
  - `q?: string` — `@IsOptional() @IsString()`
  - `sortBy?: string` — `@IsOptional() @IsIn(['requested_at','created_at','approval_status','request_type'])`
  - `sortOrder?: string` — `@IsOptional() @IsIn(['asc','desc'])`
  - Class-level decorator `@Validate(FromToConstraint)` — kiểm tra `from <= to`
- [x] T003 [P] Tạo `MeetingRequestListItemDto` tại `src/modules/meetings/dto/meeting-request-list-item.dto.ts`:
  - Fields: `id`, `requestCode`, `requestType`, `approvalStatus`, `requestedAt`, `requestedStartTime`, `requestedEndTime`, `conflictCheckStatus`, `conflictSummary`, `decisionBy`, `decisionAt`, `rejectionReason`, `requestedBy`, `targetRoom`, `meeting`
  - `requestedBy` shape: `{ id: string, fullName: string, email: string }`
  - `targetRoom` shape: `{ id: string, roomName: string } | null`
  - `meeting` shape: `{ id: string, title: string } | null`
  - `conflictSummary` type: `Record<string, unknown> | null`
  - `decisionBy` shape: `{ id: string, fullName: string, email: string } | null`
- [x] T004 [P] Tạo `UserSummaryDto` tại `src/modules/meetings/dto/user-summary.dto.ts` — fields `id`, `fullName`, `email`.
- [x] T005 [P] Tạo `RoomSummaryDto` tại `src/modules/meetings/dto/room-summary.dto.ts` — fields `id`, `roomName`.
- [x] T006 [P] Tạo `FromToConstraint` validator tại `src/modules/meetings/validators/from-to.constraint.ts`:
  - Implement `ValidatorConstraintInterface` từ `class-validator`
  - `validate(from, args)` — parse `args.object` lấy field `to`, kiểm tra `new Date(from) <= new Date(to)`
  - `defaultMessage()` trả về `'from phải <= to'`
  - Export class `FromToConstraint`

**Checkpoint**: DTOs sẵn sàng, permission `meeting_request.read` đã seed, FromToConstraint ready.

---

## Phase 2: Service Layer — Query Logic

**Purpose**: Implement method `findMeetingRequests()` trong MeetingsService.

**Outcome**: Hoàn thành Phase 2 thì có method service có thể gọi từ controller.

**Dependency**: Phase 1 (DTOs)

- [x] T007 [US1] Thêm method `findMeetingRequests(queryDto: MeetingRequestQueryDto, authUser: any)` vào `src/modules/meetings/services/meetings.service.ts`:
  - Inject `DataSource` + `AuthzReadRepository` vào constructor (DataSource đã có)
  - Tạo QueryBuilder: `this.dataSource.getRepository(MeetingRequestEntity).createQueryBuilder('mr')`
  - LEFT JOIN + select limited fields:
    ```
    .leftJoin('mr.requestedByUser', 'requester')
    .leftJoin('mr.meeting', 'meeting')
    .leftJoin('mr.decisionByUser', 'decider')
    .leftJoin(RoomEntity, 'room', 'room.id = mr.targetRoomId')
    .select([...])
    ```
  - **ApprovalStatus filter**: nếu `!approvalStatus` hoặc `== 'pending'`: `.andWhere('mr.approvalStatus = :status', { status: ApprovalStatus.PENDING })`; nếu `!= 'all'`: `.andWhere('mr.approvalStatus = :status', { status })`; nếu `=='all'`: bỏ qua
  - **requestType filter**: `.andWhere('mr.requestType = :type')` nếu có
  - **targetRoomId filter**: `.andWhere('mr.targetRoomId = :roomId')` nếu có
  - **requestedById filter**: `.andWhere('mr.requestedBy = :userId')` nếu có
  - **Date range filter**: `.andWhere('mr.requestedAt BETWEEN :from AND :to')` nếu có `from` và `to`
  - **q search**: `.andWhere('mr.requestCode ILIKE :q', { q: '%' + q + '%' })` nếu có
  - **Data scope filter**:
    ```
    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(authUser.userId);
    const isAdmin = roles.some(r => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN');
    if (!isAdmin) {
      qb.andWhere(
        `(requester.direct_manager_id = :userId
          OR requester.department_id IN (
            SELECT d.id FROM departments d WHERE d.manager_user_id = :userId
          ))`,
        { userId: authUser.userId }
      );
    }
    ```
  - **Sort**: allowlist `['requested_at','created_at','approval_status','request_type']`, default `sortBy='requested_at'`, `sortOrder='DESC'`, `.orderBy('mr.' + sortField, sortOrder)`
  - **Pagination**: `const skip = (page - 1) * limit;`, `.skip(skip).take(limit)`
  - Execute: `const [items, total] = await qb.getManyAndCount();`
  - Map items → `MeetingRequestListItemDto[]`: null check cho `meeting`, `targetRoom`, `conflictSummary`, `decisionBy`
  - Return `{ items, total, page, limit }`
  - Xử lý exception: catch + log → throw `InternalServerErrorException`

**Checkpoint**: Service method `findMeetingRequests()` hoàn chỉnh với đầy đủ filter, scope, sort, pagination.

---

## Phase 3: Controller Layer — API Endpoint

**Purpose**: Expose `GET /api/v1/meeting-requests` với guard/permission.

**Outcome**: Hoàn thành Phase 3 thì có API endpoint có thể gọi được.

**Dependency**: Phase 2 (service method)

- [x] T008 [US1] Tạo `MeetingRequestsController` tại `src/modules/meetings/controllers/meeting-requests.controller.ts`:
  - `@Controller('meeting-requests')`
  - Inject `MeetingsService`
  - Endpoint `GET /`:
    ```typescript
    @Get()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermissions('meeting_request.read')
    async findAll(
      @Query(new ValidationPipe({ transform: true, whitelist: true })) query: MeetingRequestQueryDto,
      @Req() req: any,
    ) {
      const result = await this.meetingsService.findMeetingRequests(query, req.user);
      return {
        success: true,
        message: 'Danh sách yêu cầu cuộc họp',
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
  - `ValidationPipe` với `transform: true` + `whitelist: true`

- [x] T009 [US1] Cập nhật `src/modules/meetings/meetings.module.ts`: thêm `MeetingRequestsController` vào `controllers` array.

**Checkpoint**: API `GET /api/v1/meeting-requests` hoạt động, guard + permission check OK.

---

## Phase 4: Unit Tests

**Purpose**: Đảm bảo coverage cho tất cả acceptance criteria.

**Outcome**: Hoàn thành Phase 4 thì có test coverage cho service và controller.

**Dependency**: Phase 2 + Phase 3

- [ ] T010 [P] [US1] Viết unit test cho `findMeetingRequests()` tại `src/modules/meetings/tests/meeting-requests.service.spec.ts`:
  - Mock `DataSource.getRepository().createQueryBuilder()` + `AuthzReadRepository`
  - Test list success flow — verify 200 + data + meta (AC-001)
  - Test default filter pending — verify WHERE approvalStatus = pending (AC-002)
  - Test filter by `approvalStatus=approved` — verify WHERE clause (AC-003)
  - Test filter by `requestType` — verify WHERE (AC-004)
  - Test filter by `targetRoomId` — verify WHERE
  - Test filter by `requestedById` — verify WHERE
  - Test filter by `from` + `to` — verify BETWEEN
  - Test search `q` — verify ILIKE on requestCode
  - Test `approvalStatus=all` — verify KHÔNG có WHERE approvalStatus
  - Test default sort `requested_at DESC` (AC-010)
  - Test custom sort — verify ORDER BY field
  - Test pagination — verify skip/take (AC-009)
  - Test SYSTEM_ADMIN scope — verify không có scope WHERE (có role SYSTEM_ADMIN)
  - Test Manager scope — verify WHERE directManagerId + department manager_userId (roles.some không có admin)
  - Test scope empty — verify 200 + data=[] (AC-006)
  - Test `meetingId = null` — verify `meeting = null` (AC-007)
  - Test `targetRoomId = null` — verify `targetRoom = null` (AC-008)
  - Test `conflictSummaryJson = null` — verify `conflictSummary = null`
  - Test DB error — verify 500

- [ ] T011 [P] [US1] Viết unit test cho controller endpoint tại `src/modules/meetings/tests/meeting-requests.controller.spec.ts`:
  - Test `GET /meeting-requests` gọi đúng service method
  - Test guard/permission 403 khi không có `meeting_request.read` (AC-005)
    - Verify 403 response body có `error.details.requiredPermission = 'meeting_request.read'` đúng contract (M2)
  - Test response format đúng contract
  - Test pagination meta format
  - Test validation pipe cho query params
  - Test `approvalStatus` invalid → 422 (AC-011)
  - Test `limit > 100` → 400 (AC-012)

**Checkpoint**: Tất cả 12 AC được cover bởi test.

---

## Phase 5: Verification & Documentation

**Purpose**: Kiểm tra chất lượng code, verify API responses.

**Outcome**: Feature sẵn sàng cho review/deploy.

**Dependency**: Phase 4

- [ ] T012 Chạy lint + build — `npm run lint` và `npm run build` — fix lỗi nếu có.
- [ ] T013 Verify API responses match contract trong `contracts/feat-pending-meeting-requests-api.md`:
  - Response format `{ success, message, data, meta }`
  - Error codes: VALIDATION_ERROR (400/422), UNAUTHORIZED (401), FORBIDDEN (403), INTERNAL_ERROR (500)
    - Verify 403 response body có `error.details.requiredPermission = 'meeting_request.read'` đúng contract (M2)
  - Null relations: `meeting`, `targetRoom`, `conflictSummary`, `decisionBy` trả null hợp lệ
- [ ] T014 Cập nhật CHANGELOG trong `spec.md` — thêm dòng log cho phase tasks creation.

---

## Requirements Coverage

### Task → AC Mapping

| Task | ACs covered | FRs covered |
|------|-------------|-------------|
| T001 | — | (seed permission) |
| T002 | — | (DTO validation) |
| T003 | — | (DTO response) |
| T004 | — | (DTO user summary) |
| T005 | — | (DTO room summary) |
| T006 | — | FR-029, ERR-006 (from/to validator) |
| T007 | AC-001, AC-002, AC-003, AC-004, AC-006, AC-007, AC-008, AC-009, AC-010 | FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-032, FR-033, FR-034, FR-035 |
| T008 | AC-001, AC-005 | FR-001, FR-002, FR-031, ERR-008, ERR-009 |
| T009 | — | (module config) |
| T010 | AC-001, AC-002, AC-003, AC-004, AC-006, AC-007, AC-008, AC-009, AC-010 | NFR-013 |
| T011 | AC-005, AC-011, AC-012 | NFR-013 |
| T012 | — | (quality) |
| T013 | — | (contract verification) |
| T014 | — | (documentation) |

### Coverage Summary

| AC | Status | Covered by |
|----|--------|-----------|
| AC-001 | ✅ | T007 + T008 + T010 |
| AC-002 | ✅ | T007 + T010 |
| AC-003 | ✅ | T007 + T010 |
| AC-004 | ✅ | T007 + T010 |
| AC-005 | ✅ | T008 + T011 |
| AC-006 | ✅ | T007 + T010 |
| AC-007 | ✅ | T007 + T010 |
| AC-008 | ✅ | T007 + T010 |
| AC-009 | ✅ | T007 + T010 |
| AC-010 | ✅ | T007 + T010 |
| AC-011 | ✅ | T011 |
| AC-012 | ✅ | T011 |

## Parallel Execution Opportunities

```bash
# Phase 1 — Parallel DTOs + Validator
Task: T002 MeetingRequestQueryDto
Task: T003 MeetingRequestListItemDto
Task: T004 UserSummaryDto
Task: T005 RoomSummaryDto
Task: T006 FromToConstraint validator

# Phase 4 — Parallel Tests
Task: T010 Service unit tests
Task: T011 Controller unit tests
```

## Dependency Graph

```
T001 (seed) ──┐
T002 (dto)   ──┤
T003 (dto)   ──┤ [P]
T004 (dto)   ──┤
T005 (dto)   ──┤
T006 (val)   ──┘
       │
       ▼
T007 (service)
       │
       ▼
T008 (ctrl)  ──┐
T009 (module)──┤
       │
       ▼
T010 (svc-test) ──┐ [P]
T011 (ctrl-test)──┤
       │
       ▼
T012 (lint)   ──┐
T013 (verify) ──┤ [P]
T014 (docs)   ──┘
```

## Implementation Strategy

### MVP Scope (Phase 1 + Phase 2 + Phase 3)

Tập trung hoàn thành list endpoint (không test) trước. MVP có thể demo được:
1. T001 → Permission ready
2. T002–T006 → DTOs + validator ready
3. T007 → Service logic ready
4. T008–T009 → API endpoint ready, có thể test qua curl/Postman

### Full Delivery (All Phases)

Sau MVP, thêm tests và verification để đảm bảo quality.

### Total Tasks: 14
- Phase 1: 6 tasks (5 [P])
- Phase 2: 1 task
- Phase 3: 2 tasks
- Phase 4: 2 tasks (all [P])
- Phase 5: 3 tasks
