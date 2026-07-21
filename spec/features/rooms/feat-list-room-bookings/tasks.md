# Tasks: Xem danh sach toan bo booking phong hien tai

**Feature ID**: ROOM-BOOKING-LIST-001
**Input**: Design documents from spec/features/rooms/feat-list-room-bookings/
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/feat-list-room-bookings-api.md, quickstart.md

---

## CHANGELOG & REVISION HISTORY
| Ngay cap nhat | Tom tat thay doi | Cac dong thay doi |
| :--- | :--- | :--- |
| 2026-07-20 | Tao moi tasks cho feature feat-list-room-bookings | Toan bo file |
| 2026-07-21 | Dong bo voi spec.md da resolve: fix service file path (room-bookings.service.ts), cap nhat manager scope resolved, them AC-013 vao coverage, them Manager scope test cases, cap nhat T008/T009 inject RoomBookingsService | T007, T008, T009, T011, Coverage table |

---

## Phase 1: DTOs & Foundation

**Purpose**: Tao query DTO, response DTOs, va FromToConstraint validator.

**Outcome**: Hoan thanh Phase 1 thi co du DTOs + validator de implement service + controller.

- [x] T001 Tao RoomBookingQueryDto tai src/modules/rooms/dto/room-booking-query.dto.ts:
  - page?: number - @IsOptional() @Type(() => Number) @Min(1)
  - limit?: number - @IsOptional() @Type(() => Number) @Min(1) @Max(100)
  - roomId?: string - @IsOptional() @IsUUID('4')
  - status?: string - @IsOptional() @IsIn(['pending','approved','active','completed','cancelled','released'])
  - bookingType?: string - @IsOptional() @IsIn(['scheduled','ad_hoc','extension','relocated'])
  - from?: string - @IsOptional() (ISO 8601 string)
  - to?: string - @IsOptional() (ISO 8601 string)
  - q?: string - @IsOptional() @IsString()
  - sortBy?: string - @IsOptional() @IsIn(['reserved_start_time','created_at','status'])
  - sortOrder?: string - @IsOptional() @IsIn(['asc','desc'])
  - Class-level decorator @Validate(FromToConstraint) - kiem tra from <= to
- [x] T002 [P] Tao RoomBookingListItemDto tai src/modules/rooms/dto/room-booking-list-item.dto.ts:
  - Fields: id, bookingCode, bookingType, status, roomId, meetingId, bookedBy, reservedStartTime, reservedEndTime, approvedBy, approvedAt, cancellationReason, createdAt, updatedAt, room, meeting, bookedByUser, approvedByUser
  - room shape: { id: string, roomName: string }
  - meeting shape: { id: string, title: string } | null
  - bookedByUser shape: { id: string, fullName: string, email: string }
  - approvedByUser shape: { id: string, fullName: string, email: string } | null
- [x] T003 [P] Tao UserSummaryDto tai src/modules/rooms/dto/user-summary.dto.ts - fields id, fullName, email.
- [x] T004 [P] Tao RoomSummaryDto tai src/modules/rooms/dto/room-summary.dto.ts - fields id, roomName.
- [x] T005 [P] Tao MeetingSummaryDto tai src/modules/rooms/dto/meeting-summary.dto.ts - fields id, title.
- [x] T006 [P] Tao FromToConstraint validator tai src/modules/rooms/validators/from-to.constraint.ts.

**Checkpoint**: DTOs san sang, FromToConstraint ready.
---

## Phase 2: Service Layer - Query Logic

**Purpose**: Implement method findRoomBookings() trong RoomBookingsService (file moi).

**Outcome**: Hoan thanh Phase 2 thi co method service co the goi tu controller.

**Dependency**: Phase 1 (DTOs)

- [x] T007 [US1] Tao file moi src/modules/rooms/services/room-bookings.service.ts (RoomBookingsService) va implement method findRoomBookings(queryDto: RoomBookingQueryDto, authUser: any):
  - Inject DataSource + AuthzReadRepository vao constructor
  - Tao QueryBuilder: this.dataSource.getRepository(RoomBookingEntity).createQueryBuilder('rb')
  - LEFT JOIN + select limited fields:
    .leftJoin('rb.room', 'room')
     .leftJoin('rb.meeting', 'meeting')
     .leftJoin('rb.bookedByUser', 'bookedBy')
     .leftJoin('rb.approvedByUser', 'approvedBy')
     .select([...])
  - **roomId filter**: .andWhere('rb.roomId = :roomId') neu co
  - **status filter**: .andWhere('rb.status = :status') neu co
  - **bookingType filter**: .andWhere('rb.bookingType = :type') neu co
  - **Date range filter**: .andWhere('rb.reservedStartTime BETWEEN :from AND :to') neu co from va to
  - **q search**: .andWhere('rb.bookingCode ILIKE :q', { q: '%' + q + '%' }) neu co
  - **Data scope filter**: admin (SYSTEM_ADMIN/BUSINESS_ADMIN) thay toan bo khong filter. MANAGER chi thay booking co bookedBy.directManagerId = currentUser.id HOAC bookedBy thuoc department co managerUserId = currentUser.id (da giai quyet — spec.md muc 1.5, FR-012, FR-029, AC-013)
  - **Sort**: allowlist ['reserved_start_time','created_at','status'], default sortBy='reserved_start_time', sortOrder='DESC'
  - **Pagination**: const skip = (page - 1) * limit;, .skip(skip).take(limit)
  - Execute: const [items, total] = await qb.getManyAndCount();
  - Map items -> RoomBookingListItemDto[]: null check cho meeting, approvedByUser
  - Return { items, total, page, limit }

**Checkpoint**: Service method findRoomBookings() hoan chinh.

## Phase 3: Controller Layer - API Endpoint

**Purpose**: Expose GET /api/v1/room-bookings voi guard/permission.

**Outcome**: Hoan thanh Phase 3 thi co API endpoint co the goi duoc.

**Dependency**: Phase 2 (service method)

- [x] T008 [US1] Tao RoomBookingsController tai src/modules/rooms/controllers/room-bookings.controller.ts:
  - @Controller('room-bookings')
  - Inject RoomBookingsService
  - Endpoint GET /:
    @Get()
     @UseGuards(JwtAuthGuard, PermissionsGuard)
     @RequirePermissions('room.booking.read')
     async findAll(
       @Query(new ValidationPipe({ transform: true, whitelist: true })) query: RoomBookingQueryDto,
       @Req() req: any,
     ) {
       const result = await this.roomBookingsService.findRoomBookings(query, req.user);
       return {
         success: true,
         message: 'Danh sach dat phong',
         data: result.items,
         meta: {
           page: result.page,
           limit: result.limit,
           total: result.total,
           totalPages: Math.ceil(result.total / result.limit) || 0,
         },
       };
     }
- [x] T009 [US1] Cap nhat src/modules/rooms/rooms.module.ts: them RoomBookingsController vao controllers array va RoomBookingsService vao providers array.

**Checkpoint**: API GET /api/v1/room-bookings hoat dong, guard + permission check OK.

## Phase 4: Permission Seed

**Purpose**: Seed permission room.booking.read vao database.

**Dependency**: Phase 3

- [x] T010 Tao migration seed cho permission room.booking.read:
  - Them vao file migration trong src/database/migrations/
  - Kiem tra permission da ton tai chua, neu chua thi them moi
  - Gan permission cho role SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER (theo quyet dinh scope)

## Phase 5: Unit Tests

**Purpose**: Dam bao coverage cho tat ca acceptance criteria.

**Dependency**: Phase 2 + Phase 3

- [x] T011 [P] [US1] Viet unit test cho findRoomBookings() tai src/modules/rooms/tests/room-bookings.service.spec.ts:
  - Test list success flow (AC-001)
  - Test filter by roomId (AC-002)
  - Test filter by status (AC-003)
  - Test filter by bookingType (AC-004)
  - Test filter by from/to
  - Test search q
  - Test default sort (AC-010)
  - Test custom sort
  - Test pagination (AC-009)
  - Test SYSTEM_ADMIN scope (AC-006)
  - Test meetingId = null (AC-007)
  - Test approvedBy = null (AC-008)
  - Test MANAGER scope - chi thay booking co bookedBy trong pham vi quan ly (AC-013)
  - Test MANAGER scope empty - khong co booking trong scope tra data = []
  - Test DB error -> 500
- [x] T012 [P] [US1] Viet unit test cho controller endpoint tai src/modules/rooms/tests/room-bookings.controller.spec.ts:
  - Test GET /room-bookings goi dung service method
  - Test guard/permission 403 khi khong co room.booking.read (AC-005)
  - Test response format dung contract
  - Test pagination meta format
  - Test validation pipe cho query params
  - Test status invalid -> 422 (AC-011)
  - Test limit > 100 -> 400 (AC-012)

## Phase 6: Verification & Documentation

**Purpose**: Kiem tra chat luong code, verify API responses.

**Dependency**: Phase 5

- [x] T013 Chay lint + build - 
pm run lint va 
pm run build - fix loi neu co.
- [x] T014 Verify API responses match contract trong contracts/feat-list-room-bookings-api.md.
- [x] T015 Cap nhat CHANGELOG trong spec.md - them dong log cho phase tasks creation.

---

## Requirements Coverage

### Task -> AC Mapping

| Task | ACs covered | FRs covered |
|------|-------------|-------------|
| T001 | - | (DTO validation) |
| T002 | - | (DTO response) |
| T003 | - | (DTO user summary) |
| T004 | - | (DTO room summary) |
| T005 | - | (DTO meeting summary) |
| T006 | - | FR-026, ERR-006 |
| T007 | AC-001, AC-002, AC-003, AC-004, AC-006, AC-007, AC-008, AC-009, AC-010, AC-013 | FR-001 -> FR-020, FR-029 -> FR-032 |
| T008 | AC-001, AC-005 | FR-001, FR-002, FR-028, ERR-008, ERR-009 |
| T009 | - | (module config) |
| T010 | - | (seed permission) |
| T011 | AC-001, AC-002, AC-003, AC-004, AC-006, AC-007, AC-008, AC-009, AC-010, AC-013 | NFR-013 |
| T012 | AC-005, AC-011, AC-012 | NFR-013 |
| T013 | - | (quality) |
| T014 | - | (contract verification) |
| T015 | - | (documentation) |

### Coverage Summary

| AC | Status | Covered by |
|----|--------|-----------|
| AC-001 | - | T007 + T008 + T011 |
| AC-002 | - | T007 + T011 |
| AC-003 | - | T007 + T011 |
| AC-004 | - | T007 + T011 |
| AC-005 | - | T008 + T012 |
| AC-006 | - | T007 + T011 |
| AC-007 | - | T007 + T011 |
| AC-008 | - | T007 + T011 |
| AC-009 | - | T007 + T011 |
| AC-010 | - | T007 + T011 |
| AC-011 | - | T012 |
| AC-012 | - | T012 |
| AC-013 | - | T007 + T011 |

## Dependency Graph

Phase 1 (DTOs) -> Phase 2 (Service) -> Phase 3 (Controller) -> Phase 4 (Seed) -> Phase 5 (Tests) -> Phase 6 (Verify)

## Implementation Strategy

### MVP Scope (Phase 1 + Phase 2 + Phase 3)

Tap trung hoan thanh list endpoint (khong test) truoc. MVP co the demo duoc:
1. T001-T006 -> DTOs + validator ready
2. T007 -> Service logic ready
3. T008-T009 -> API endpoint ready, co the test qua curl/Postman
4. T010 -> Permission seed

### Full Delivery (All Phases)

Sau MVP, them tests va verification de dam bao quality.

### Total Tasks: 15
- Phase 1: 6 tasks (5 [P])
- Phase 2: 1 task
- Phase 3: 2 tasks
- Phase 4: 1 task
- Phase 5: 2 tasks (all [P])
- Phase 6: 3 tasks

