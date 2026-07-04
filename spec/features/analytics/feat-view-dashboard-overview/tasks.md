# Tasks: Xem dashboard tổng quan hệ thống (UC-AA-01 / UC-148)

**Feature**: AA-DASHBOARD-OVERVIEW-001 — View System Overview Dashboard
**Module**: analytics
**Branch**: `017-view-dashboard-overview`
**Date**: 2026-07-02
| 2026-07-02 | Khắc phục lỗi hiển thị tiếng Việt (mojibake) trong tệp tasks.md | Toàn bộ tệp |

**Input documents**:
- spec.md, plan.md, research.md, data-model.md, quickstart.md
- contracts/dashboard-overview-api.md

## Path Conventions

- Source files: `src/modules/analytics/`
- Test files: `src/modules/analytics/tests/`
- Seed file: `src/database/seeds/`
- Module hiện tại `analytics.module.ts` là `@Module({})` rỗng — cần tạo mới toàn bộ thư mục con.

---

## Phase 1: Setup

**Purpose**: Tạo cấu trúc thư mục cơ bản cho feature (module đã tồn tại nhưng rỗng)

- [X] T001 [P] Tạo `controllers/` trong `src/modules/analytics/`
- [X] T002 [P] Tạo `services/` trong `src/modules/analytics/`
- [X] T003 [P] Tạo `repositories/` trong `src/modules/analytics/`
- [X] T004 [P] Tạo `dto/` trong `src/modules/analytics/`
- [X] T005 [P] Tạo `tests/` trong `src/modules/analytics/`

---

## Phase 2: Foundational

**Purpose**: Blocking prerequisites — DTO, Controller shell, Service shell, Module wiring

- [X] T006 [FR-019, FR-020, FR-022] [P] Tạo `QueryDashboardOverviewDto` trong `src/modules/analytics/dto/query-dashboard-overview.dto.ts`
  - `@IsOptional() @IsDateString() from?: string`
  - `@IsOptional() @IsDateString() to?: string`
  - `@IsOptional() @IsUUID() departmentId?: string`
  - `@IsOptional() @IsUUID() roomId?: string`

- [X] T007 [FR-025] [P] Tạo `TrendPointDto` + `DashboardOverviewResponseDto` trong `src/modules/analytics/dto/dashboard-overview-response.dto.ts`
  - `period: { from: string; to: string }`
  - `meetingCount, activeRooms, recordingCount, activeUserCount: number`
  - `utilizationRate, noShowRate, onTimeRate: number`
  - `trend: TrendPointDto[]` với `TrendPointDto = { date: string; meetingCount: number; utilizationRate: number }`

- [X] T008 [FR-DATA-003] [P] Tạo `DashboardOverviewConfigService` trong `src/modules/analytics/services/dashboard-overview-config.service.ts`
  - Method `getMaxRangeDays(): Promise<number>` — đá»c `system_configs['analytics.dashboard_max_range_days']` → env `ANALYTICS_DASHBOARD_MAX_RANGE_DAYS` → default `366`
  - Mirror pattern `readThreshold()` ở `src/modules/rooms/services/no-show-detection.service.ts`

- [X] T009 [FR-004, FR-005] Tạo `DashboardOverviewController` (shell) trong `src/modules/analytics/controllers/dashboard-overview.controller.ts`
  - `@Controller('analytics/dashboard')`
  - `@UseGuards(JwtAuthGuard, PermissionsGuard)` class-level
  - `@RequirePermissions('analytics.overview.read')` class-level
  - `@Get('overview')` handler: `getOverview(@Query() query: QueryDashboardOverviewDto, @CurrentUser() currentUser: { userId: string })`
  - Body: gá»i `service.getOverview(currentUser, query)`

- [X] T010 [FR-001] Tạo `DashboardOverviewService` (shell) trong `src/modules/analytics/services/dashboard-overview.service.ts`
  - Inject: `AuthzReadRepository`, `DashboardOverviewRepository`, `DashboardOverviewConfigService`
  - Method signature: `async getOverview(currentUser, query: QueryDashboardOverviewDto): Promise<DashboardOverviewResponseDto>`
  - Body tạm: throw `NotImplementedException` (sẽ implement ở Phase 3)

- [X] T011 [Module] Cập nhật `src/modules/analytics/analytics.module.ts`
  - Äăng ký `DashboardOverviewController` vào `controllers: []`
  - Äăng ký `DashboardOverviewService`, `DashboardOverviewRepository`, `DashboardOverviewConfigService` vào `providers: []`
  - Import `TypeOrmModule.forFeature([...])` cho các entity: `MeetingEntity`, `UserEntity`, `DepartmentEntity`, `MeetingParticipantEntity`, `RoomBookingEntity`, `RoomBookingUsageEntity`, `NoShowCaseEntity`, `AttendanceRecordEntity`, `RecordingSessionEntity`, `SystemConfigEntity`
  - Import module chứa `AuthzReadRepository` (module `auth`) nếu chưa export sẵn

---

## Phase 3: Business Logic — Scope & Validation

- [X] T012 [FR-003, FR-008, FR-009, FR-010, FR-DATA-001] Implement `resolveScope(currentUser)` trong `DashboardOverviewService`
  - Gá»i `AuthzReadRepository.getEffectiveRolesAndPermissions(currentUser.userId)`
  - Nếu `roles` chứa `SYSTEM_ADMIN` hoặc `BUSINESS_ADMIN` → `{ isAdmin: true, scopeDepartmentIds: null }`
  - Nếu `roles` chứa `MANAGER` → query `SELECT id FROM departments WHERE manager_user_id = $1` → `{ isAdmin: false, scopeDepartmentIds: string[] }`
  - Nếu không match role hợp lệ nào → throw `ForbiddenException({ code: 'PERMISSION_DENIED' })`

- [X] T013 [FR-006, FR-007, FR-019, FR-020] Implement `resolveDateRange(query)` trong `DashboardOverviewService`
  - Nếu thiếu `from`/`to` → default `from = today - 30 days`, `to = today`
  - Validate `from <= to` → nếu sai, throw `BadRequestException({ code: 'VALIDATION_ERROR' })`

- [X] T014 [FR-021, FR-036, NFR-003] Implement kiểm tra `maxRangeDays` trong `DashboardOverviewService`
  - Gá»i `DashboardOverviewConfigService.getMaxRangeDays()`
  - Nếu `(to - from) > maxRangeDays` → throw `BadRequestException({ code: 'DATE_RANGE_TOO_LARGE' })` **trước khi** gá»i bất kỳ aggregate query nào

- [X] T015 [FR-018, AC-006] Implement kiểm tra `departmentId` ownership trong `DashboardOverviewService`
  - Nếu `!isAdmin` (role MANAGER) và `query.departmentId` được truyá»n và không thuộc `scopeDepartmentIds` → throw `ForbiddenException({ code: 'DEPARTMENT_OUT_OF_SCOPE' })`

---

## Phase 4: Business Logic — Aggregation

- [X] T016 [FR-026] [P] Implement `countMeetings(params)` trong `src/modules/analytics/repositories/dashboard-overview.repository.ts`
  - `COUNT(meetings)` WHERE `start_time BETWEEN $from AND $to`, `status <> 'draft'`, `deleted_at IS NULL`, và (nếu có scope) `organizer_id IN (SELECT id FROM users WHERE department_id = ANY($scopeDepartmentIds))`, và (nếu có `departmentId`/`roomId`) thêm điá»u kiện tương ứng
  - Raw SQL parameterized, không nối chuỗi (đúng SEC-03 convention đã dùng ở các spec khác)

- [X] T017 [FR-031] [P] Implement `countActiveRooms(params)` trong repository
  - `COUNT(DISTINCT room_bookings.room_id)` join `meetings` theo scope + kỳ + filter `roomId` nếu có

- [X] T018 [FR-027, FR-013] [P] Implement `getUtilizationAggregate(params)` trong repository
  - Trả `{ actualMinutesSum, reservedMinutesSum }` từ `room_booking_usages` join `meetings` (scope + kỳ)
  - `actualMinutes` per row = `EXTRACT(EPOCH FROM (actual_end_time - actual_start_time))/60` nếu có, else `EXTRACT(EPOCH FROM (last_presence_at - first_presence_at))/60` nếu có, else `0`
  - `reservedMinutes` per row = `EXTRACT(EPOCH FROM (reserved_end_time - reserved_start_time))/60`

- [X] T019 [FR-028] [P] Implement `getNoShowAggregate(params)` trong repository
  - Trả `{ noShowCount, bookingCount }`: `noShowCount` = `COUNT(no_show_cases WHERE detection_status IN ('confirmed','released'))`, `bookingCount` = `COUNT(room_bookings WHERE status IN ('approved','active','completed','released'))`, cùng scope + kỳ

- [X] T020 [FR-029] [P] Implement `getAttendanceAggregate(params)` trong repository
  - Trả `{ onTimeCount, totalCount }`: `onTimeCount` = `COUNT(attendance_records WHERE is_present=true AND is_late=false)`, `totalCount` = `COUNT(attendance_records WHERE attendance_status IN ('present','late'))`, join `meetings` theo scope + kỳ

- [X] T021 [FR-030] [P] Implement `countActiveUsers(params)` trong repository
  - `COUNT(DISTINCT userId)` từ union `meetings.organizer_id` và `meeting_participants.user_id WHERE invitation_status <> 'declined'`, scope + kỳ

- [X] T022 [FR-032] [P] Implement `countRecordingSessions(params)` trong repository
  - `COUNT(recording_sessions)` join `meetings` theo scope, `started_at BETWEEN $from AND $to`

- [X] T023 [FR-033] Implement `getDailyTrend(params)` trong repository
  - `GROUP BY date_trunc('day', start_time)` trả `{ date, meetingCount, actualMinutesSum, reservedMinutesSum }` mỗi ngày trong `[from, to]` (kể cả ngày 0 — dùng `generate_series` để không thiếu ngày trống)

- [X] T024 [FR-012, FR-035, AC-007, AC-008] Implement empty-state short-circuit trong `DashboardOverviewService`
  - Sau `countMeetings() === 0` (hoặc `scopeDepartmentIds = []` khi role MANAGER) → trả thẳng response toàn 0 + `trend = []` + `message = 'Không có dữ liệu hoạt động trong khoảng thá»i gian này'`, KHÔNG gá»i các aggregate còn lại

- [X] T025 [FR-025] Implement `buildResponse(aggregates)` trong `DashboardOverviewService`
  - Tính % = `tử số / mẫu số * 100`, làm tròn 1 chữ số thập phân; mẫu số 0 → 0
  - Gộp thành `DashboardOverviewResponseDto`

---

## Phase 5: Controller Wiring & Error Handling

- [X] T026 [FR-004, FR-005, FR-034] Hoàn thiện `DashboardOverviewController.getOverview()`
  - Gá»i tuần tự: `resolveScope` → `resolveDateRange` → check `maxRangeDays` → check `departmentId` ownership → (nếu empty) trả empty response → aggregate → `buildResponse`
  - Sau khi trả response thành công: gá»i `AuditLogService.logAction({ actionType: 'read_analytics_dashboard_overview', entityType: 'analytics_dashboard', metadataJson: { viewerUserId, viewerRole, from, to, departmentId, roomId, resolvedScopeDepartmentIds } })` non-blocking, gated `AUDIT_LOG_ENABLED` (mirror pattern `no-show.service.ts`)
  - Catch lỗi không lưá»ng trước → `InternalServerErrorException({ code: 'INTERNAL_ERROR' })`

- [X] T027 [ERR-003] Ãp `@IsUUID()` cho `departmentId`/`roomId` ở DTO (đã có ở T006) — verify trả 400 `VALIDATION_ERROR` đúng envelope

---

## Phase 6: Testing

- [X] T028 [Test, AC-002] [P] Unit test `resolveScope()`
  - Test: role SYSTEM_ADMIN/BUSINESS_ADMIN → `scopeDepartmentIds = null`
  - Test: role MANAGER quản lý N phòng ban → đúng danh sách id
  - Test: role MANAGER quản lý 0 phòng ban → `scopeDepartmentIds = []`
  - Test: không có role hợp lệ → `ForbiddenException`

- [X] T029 [Test, AC-003, AC-004, AC-006] [P] Unit test `resolveDateRange()` + `maxRangeDays` + `departmentId` ownership
  - Test: thiếu `from`/`to` → default 30 ngày gần nhất
  - Test: `from > to` → `BadRequestException VALIDATION_ERROR`
  - Test: range vượt `maxRangeDays` → `BadRequestException DATE_RANGE_TOO_LARGE`
  - Test: MANAGER truyá»n `departmentId` ngoài scope → `ForbiddenException DEPARTMENT_OUT_OF_SCOPE`
  - Test: MANAGER truyá»n `departmentId` đúng scope → pass

- [X] T030 [Test] [P] Unit test từng công thức aggregate trong repository (mock `dataSource.query`)
  - `getUtilizationAggregate`: đúng fallback `actual_* → presence_* → 0`
  - `getNoShowAggregate`, `getAttendanceAggregate`: đúng tử số/mẫu số theo data-model.md
  - `countActiveUsers`: không đếm trùng user vừa là organizer vừa là participant; loại `invitation_status='declined'`
  - Mẫu số = 0 cho má»i tỷ lệ → trả `0`, không `NaN`/lỗi

- [X] T031 [Test, AC-007, AC-008] [P] Unit test empty state
  - `countMeetings() === 0` → response toàn 0, `trend=[]`, message đúng EX1
  - MANAGER 0 phòng ban → response giống trên, KHÔNG throw lỗi

- [X] T032 [Test] [P] Unit test `QueryDashboardOverviewDto`
  - Test: valid params pass
  - Test: `from`/`to` sai format → lỗi validation
  - Test: `departmentId`/`roomId` không phải UUID → lỗi validation

- [X] T033 [Test] [P] Unit test `DashboardOverviewController`
  - Test: request hợp lệ → 200 với đúng cấu trúc response
  - Test: audit log được gá»i khi thành công, KHÔNG được gá»i khi lỗi 403/400
  - Test: lỗi không lưá»ng trước → 500 `INTERNAL_ERROR`

- [X] T034 [Test] [P] Unit test seed permission (`SeedAnalyticsOverviewPermission`)
  - Test: tạo đúng permission `analytics.overview.read`, module_code=`analytics`
  - Test: gán đúng cho 3 role `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T035 [Polish] Tạo migration/seed `src/database/seeds/<timestamp>-SeedAnalyticsOverviewPermission.ts` — theo đúng pattern các seed permission hiện có (vd. `20260624000001-SeedUserListPermission.ts`)
- [X] T036 [Polish] Verify response format đúng convention API: `{ success, message, data, meta }`
- [X] T037 [Polish, FR-001] Verify read-only: không có `save`/`update`/`delete`/`insert` nào trong `dashboard-overview.service.ts` hoặc `dashboard-overview.repository.ts` (ngoại trừ audit log qua `AuditLogsService`, là service dùng chung, không phải side-effect của feature này)
- [X] T038 [Polish] Verify má»i raw SQL trong repository dùng parameter binding (`$1, $2...`), không nối chuỗi
- [X] T039 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `DATE_RANGE_TOO_LARGE`, `PERMISSION_DENIED`, `DEPARTMENT_OUT_OF_SCOPE`, `INTERNAL_ERROR`
- [X] T040 [Test] Chạy toàn bộ kịch bản `quickstart.md` để verify end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Không phụ thuộc
- **Phase 2 (Foundational)**: Phụ thuộc Phase 1
- **Phase 3 (Scope & Validation)**: Phụ thuộc Phase 2 (cần DTO + service shell)
- **Phase 4 (Aggregation)**: Phụ thuộc Phase 2 (repository shell); có thể chạy song song với Phase 3 vì là các method độc lập, nhưng `DashboardOverviewService.getOverview()` cần cả hai để hoàn chỉnh
- **Phase 5 (Controller Wiring)**: Phụ thuộc Phase 3 + Phase 4
- **Phase 6 (Testing)**: Phụ thuộc Phase 5
- **Phase 7 (Polish)**: Phụ thuộc Phase 6

### Parallel Opportunities

- Phase 1: T001-T005 chạy song song (khác thư mục)
- Phase 2: T006-T008 chạy song song (khác file), T009-T011 tuần tự sau đó
- Phase 4: T016-T022 chạy song song (mỗi method aggregate độc lập trong cùng file repository, không phụ thuộc lẫn nhau); T023-T025 sau khi các aggregate method đã có signature
- Phase 6: T028-T034 chạy song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm (`NotImplementedException`)
2. Phase 3 + Phase 4 — Business logic đầy đủ (scope, validate, aggregate, empty state)
3. Phase 5 — Controller hoàn chỉnh, error handling, audit log
4. Phase 6 — Unit test toàn bộ nhánh
5. Phase 7 — Seed permission, polish, verify quickstart

MVP = Phase 1 → Phase 5. Testing (Phase 6) nên làm ngay sau vì công thức KPI có nhiá»u nhánh (fallback presence, mẫu số 0, scope MANAGER) dễ sai nếu không có test bảo vệ.

## Requirements Coverage

| Requirement ID | Task(s) | Description |
|---|---|---|
| FR-001 (Read-only) | T010, T037 | Không có write operation |
| FR-002 (On-demand) | T016-T025 | Không cache, tính lại mỗi request |
| FR-003, FR-DATA-001, FR-DATA-002 (Scope) | T012 | resolveScope() |
| FR-004, FR-016 (AuthN) | T009 (guard có sẵn) | JwtAuthGuard |
| FR-005, FR-017 (AuthZ) | T009, T012 | PermissionsGuard + role check |
| FR-006, FR-007 (Date range) | T013 | resolveDateRange() |
| FR-008–FR-011, FR-014, FR-015 (Filter) | T015, T016-T022 | departmentId/roomId |
| FR-012, FR-035 (Empty state) | T024 | Short-circuit |
| FR-013 (Fallback presence) | T018 | getUtilizationAggregate() |
| FR-018, ERR-007 (Out of scope dept) | T015 | DEPARTMENT_OUT_OF_SCOPE |
| FR-019, FR-020, FR-022 (Validation) | T006 | class-validator |
| FR-021, FR-036, NFR-003 (Max range) | T008, T014 | DATE_RANGE_TOO_LARGE |
| FR-025–FR-033 (KPI formulas) | T016-T025 | Từng method aggregate |
| FR-034 (Audit) | T026 | Non-blocking audit log |
| AC-001–AC-009 | T012-T026 | Xem plan.md Acceptance Criteria Traceability |
| NFR-001, NFR-002 (Performance) | T014, T023 (index + giới hạn range) | |
| NFR-005, NFR-006 (Security) | T012, T015, T016-T022 | Scope enforce ở service/repository |
