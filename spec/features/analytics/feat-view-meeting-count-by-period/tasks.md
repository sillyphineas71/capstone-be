# Tasks: Xem thống kê số lượng cuộc họp theo khoảng thời gian (UC-AA-04 / UC-151)

**Feature**: AA-MEETING-COUNT-BY-PERIOD-001 — View Meeting Count By Period
**Module**: analytics
**Branch**: `019-view-meeting-count-by-period`
**Date**: 2026-07-02

**Input documents**:
- spec.md, plan.md, research.md, data-model.md, quickstart.md
- contracts/meeting-count-by-period-api.md

## Path Conventions

- Source files: `src/modules/analytics/` (thư mục con đã tồn tại từ UC-AA-01/02 — chỉ thêm file mới)
- Seed file: `src/database/seeds/`
- Tái dùng: `DashboardOverviewConfigService.getMaxRangeDays()`, `AuthzReadRepository`, `AuditLogsService`, `MeetingEntity` (đã import từ UC-AA-01)

---

## Phase 1: Setup

- [ ] T001 [P] Tạo `src/modules/analytics/dto/query-meeting-count-by-period.dto.ts`
- [ ] T002 [P] Tạo `src/modules/analytics/dto/meeting-count-by-period-response.dto.ts`
- [ ] T003 [P] Tạo `src/modules/analytics/repositories/meeting-count-by-period.repository.ts`
- [ ] T004 [P] Tạo `src/modules/analytics/controllers/meeting-count-by-period.controller.ts`
- [ ] T005 [P] Tạo `src/modules/analytics/services/meeting-count-by-period.service.ts`
- [ ] T006 [P] Tạo `src/modules/analytics/tests/meeting-count-by-period.service.spec.ts` và `meeting-count-by-period.repository.spec.ts`

---

## Phase 2: Foundational

- [ ] T007 [FR-020–FR-023] [P] Implement `QueryMeetingCountByPeriodDto` trong `query-meeting-count-by-period.dto.ts`
  - `@IsOptional() @IsDateString() from?: string`
  - `@IsOptional() @IsDateString() to?: string`
  - `@IsOptional() @IsEnum(['week','month']) granularity?: string`
  - `@IsOptional() @IsUUID() departmentId?: string`
  - `@IsOptional() @IsUUID() roomId?: string`
  - `@IsOptional() @IsEnum(MeetingType) meetingType?: MeetingType`

- [ ] T008 [FR-027-FR-029] [P] Implement DTO response trong `meeting-count-by-period-response.dto.ts`
  - `SeriesPointDto { period: string; count: number }`
  - `MeetingCountByPeriodResponseDto { total: number; series: SeriesPointDto[] }`

- [ ] T009 [FR-004] Tạo `MeetingCountByPeriodController` (shell) trong `meeting-count-by-period.controller.ts`
  - `@Controller('analytics/meetings')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.meeting.read')` class-level
  - `@Get('count-by-period') getCountByPeriod(@Query() query: QueryMeetingCountByPeriodDto, @CurrentUser() currentUser)`

- [ ] T010 [FR-001] Tạo `MeetingCountByPeriodService` (shell) trong `meeting-count-by-period.service.ts`
  - Inject: `AuthzReadRepository`, `MeetingCountByPeriodRepository`, `DashboardOverviewConfigService` (tái dùng `getMaxRangeDays()`)
  - `getCountByPeriod(currentUser, query)` — throw `NotImplementedException` tạm

- [ ] T011 [Module] Cập nhật `src/modules/analytics/analytics.module.ts`
  - Đăng ký `MeetingCountByPeriodController` vào `controllers`
  - Đăng ký `MeetingCountByPeriodService`, `MeetingCountByPeriodRepository` vào `providers`
  - Xác nhận `TypeOrmModule.forFeature` đã có `MeetingEntity`, `UserEntity`, `DepartmentEntity` (đã import từ UC-AA-01, không cần thêm)

---

## Phase 3: Business Logic — Date Range, Bucket, Scope

- [ ] T012 [FR-005, FR-006] Implement `resolveDateRange(query)` trong `MeetingCountByPeriodService`
  - Thiếu `from`/`to` → mặc định đầu-cuối tháng hiện tại (timezone `Asia/Ho_Chi_Minh`)
  - Có → validate ISO date, `from<=to` — sai → `BadRequestException({code:'VALIDATION_ERROR'})`

- [ ] T013 [FR-024, FR-032, NFR-002] Implement check `maxRangeDays` trong `MeetingCountByPeriodService`
  - Gọi `DashboardOverviewConfigService.getMaxRangeDays()` (tái dùng, KHÔNG tạo config mới)
  - Vượt ngưỡng → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})` trước khi query

- [ ] T014 [FR-007, FR-008, FR-029] Implement `generateBuckets(from, to, granularity)` trong `MeetingCountByPeriodService`
  - `granularity` thiếu → mặc định `'week'`
  - `week`: sinh bucket theo tuần ISO (Thứ 2 → Chủ nhật) phủ kín `[from,to]`, label `"YYYY-'W'WW"`
  - `month`: sinh bucket theo tháng dương lịch phủ kín `[from,to]`, label `"YYYY-MM"`
  - Trả `{periodLabel, bucketStart, bucketEnd}[]` theo thứ tự thời gian tăng dần

- [ ] T015 [FR-009, FR-DATA-001] Implement `resolveScope(currentUser)` trong `MeetingCountByPeriodService`
  - Gọi `AuthzReadRepository.getEffectiveRolesAndPermissions`
  - `SYSTEM_ADMIN`/`BUSINESS_ADMIN` → `{isAdmin:true, scopeDepartmentIds:null}`
  - `MANAGER` → `SELECT id FROM departments WHERE manager_user_id = $1` (scope tĩnh, KHÔNG phụ thuộc from/to)
  - Không có role hợp lệ → `ForbiddenException({code:'PERMISSION_DENIED'})`

- [ ] T016 [FR-010, FR-019, AC-005] Implement check `departmentId` ownership trong `MeetingCountByPeriodService`
  - `!isAdmin` và `query.departmentId` không thuộc `scopeDepartmentIds` → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`

---

## Phase 4: Business Logic — Aggregation

- [ ] T017 [FR-003, FR-012, FR-013, FR-027, FR-028] Implement `countMeetingsByBucket(params)` trong `meeting-count-by-period.repository.ts`
  - 1 query `GROUP BY date_trunc('week'|'month', start_time)` (tránh N+1 — xem plan.md Risk)
  - WHERE `status IN ('completed','scheduled')`, `deleted_at IS NULL`, `start_time BETWEEN $from AND $to`
  - AND scope (nếu MANAGER): `organizer_id IN (SELECT id FROM users WHERE department_id = ANY($scopeDepartmentIds))`
  - AND (nếu có) `departmentId`/`roomId`/`meetingType` filter
  - Raw SQL parameterized, không nối chuỗi
  - Trả `Map<bucketKey, count>`

- [ ] T018 [FR-014, FR-027, FR-031, NFR-005] Implement `buildResponse(buckets, countMap)` trong `MeetingCountByPeriodService`
  - Map `countMap` vào từng bucket từ T014, bucket không có dữ liệu → `count=0`
  - `total = SUM(series[].count)`
  - `total === 0` → thêm `message: 'Không tìm thấy dữ liệu cuộc họp nào thỏa mãn các tiêu chí lọc hiện tại'` (EX1)

---

## Phase 5: Controller Wiring & Error Handling

- [ ] T019 [FR-004, FR-030] Hoàn thiện `MeetingCountByPeriodController.getCountByPeriod()`
  - Thứ tự: `resolveDateRange` (T012) → `maxRangeDays` check (T013) → `resolveScope` (T015) → `departmentId` ownership (T016) → `generateBuckets` (T014) → `countMeetingsByBucket` (T017) → `buildResponse` (T018)
  - Audit log non-blocking `action_type='read_analytics_meeting_count_by_period'` (gated `AUDIT_LOG_ENABLED`)
  - Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 6: Testing

- [ ] T020 [Test, AC-001] [P] Unit test `resolveDateRange()`
  - Default tháng hiện tại khi thiếu `from`/`to`
  - `from > to` → lỗi

- [ ] T021 [Test, AC-001] [P] Unit test `generateBuckets()`
  - `granularity=week`: đúng số tuần ISO, label đúng định dạng, xử lý đúng biên năm mới
  - `granularity=month`: đúng số tháng, label đúng định dạng
  - Bucket đầu/cuối cắt đúng theo `from`/`to`

- [ ] T022 [Test, AC-002] [P] Unit test `resolveScope()`
  - Admin → `null`
  - MANAGER → đúng danh sách phòng ban, KHÔNG đổi khi truyền `from`/`to` khác nhau (scope tĩnh)
  - MANAGER 0 phòng ban → `[]`

- [ ] T023 [Test, AC-005] [P] Unit test `departmentId` ownership check
  - MANAGER truyền đúng phòng ban mình quản lý → pass
  - MANAGER truyền phòng ban khác → `DEPARTMENT_OUT_OF_SCOPE`

- [ ] T024 [Test, AC-007] [P] Unit test BR1 filter (Phương án A) trong `countMeetingsByBucket()`
  - `status='completed'` (mọi `start_time`) → tính
  - `status='scheduled'` (mọi `start_time`, kể cả quá khứ) → tính
  - `status IN ('draft','pending_approval','in_progress','cancelled')` → KHÔNG tính

- [ ] T025 [Test] [P] Unit test filter `roomId`/`meetingType`/`departmentId` kết hợp (AND)

- [ ] T026 [Test, AC-006] [P] Unit test `buildResponse()` empty state
  - Không có dữ liệu → `total=0`, mọi bucket `count=0`, có `message`
  - `total` luôn bằng `SUM(series[].count)` ở mọi kịch bản (kể cả có dữ liệu)

- [ ] T027 [Test, AC-003] [P] Unit test kịch bản AF1 (khoảng tương lai)
  - `from`/`to` là tháng kế tiếp, chỉ có `meetings.status='scheduled'` → `series` phản ánh đúng, không có giá trị nào ngoài dữ liệu thật (verify KHÔNG có logic forecast nào được gọi)

- [ ] T028 [Test, AC-004] [P] Unit test `QueryMeetingCountByPeriodDto` validation
  - `granularity`/`meetingType`/`departmentId`/`roomId` sai format → lỗi validation

- [ ] T029 [Test] [P] Unit test `MeetingCountByPeriodController`
  - Request hợp lệ → 200 đúng cấu trúc `{total, series}`
  - Audit log gọi khi thành công, KHÔNG gọi khi lỗi 403/400
  - Lỗi không lường trước → 500 `INTERNAL_ERROR`

- [ ] T030 [Test] [P] Unit test seed permission (`SeedAnalyticsMeetingReadPermission`)
  - Tạo đúng `analytics.meeting.read`, module_code=`analytics`
  - Gán đúng 3 role `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T031 [Polish] Tạo `src/database/seeds/<timestamp>-SeedAnalyticsMeetingReadPermission.ts` theo đúng pattern seed permission hiện có
- [ ] T032 [Polish] Verify response format `{success, message, data, meta}`
- [ ] T033 [Polish, FR-001] Verify read-only: không có write operation nào trong service/repository (ngoại trừ audit log dùng chung)
- [ ] T034 [Polish] Verify raw SQL dùng parameter binding, không nối chuỗi
- [ ] T035 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `DATE_RANGE_TOO_LARGE`, `PERMISSION_DENIED`, `DEPARTMENT_OUT_OF_SCOPE`, `INTERNAL_ERROR`
- [ ] T036 [Polish] Verify KHÔNG có bất kỳ logic forecast/ML/thống kê dự đoán nào bị viết nhầm cho AF1 (OOS-001)
- [ ] T037 [Test] Chạy toàn bộ kịch bản `quickstart.md` để verify end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Date range/Bucket/Scope)**: Phụ thuộc Phase 2
- **Phase 4 (Aggregation)**: Phụ thuộc Phase 2 (repository shell); phụ thuộc Phase 3 để có bucket list trước khi build response
- **Phase 5 (Wiring)**: Phụ thuộc Phase 3 + Phase 4
- **Phase 6 (Testing)**: Phụ thuộc Phase 5
- **Phase 7 (Polish)**: Phụ thuộc Phase 6

### Parallel Opportunities

- Phase 1: T001-T006 song song (khác file)
- Phase 6: T020-T030 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 + Phase 4 — Business logic đầy đủ (date range, bucket, scope, BR1 filter, aggregate, empty state)
3. Phase 5 — Controller hoàn chỉnh, audit log
4. Phase 6 — Unit test toàn bộ nhánh (đặc biệt T021 bucket generation và T024 BR1 filter — 2 điểm dễ sai nhất)
5. Phase 7 — Seed permission, polish, verify quickstart

MVP = Phase 1 → Phase 5.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001, FR-002 | T010, T017 |
| FR-003 | T017 (BR1 Phương án A) |
| FR-004, FR-017, FR-018 | T009 (guard có sẵn) |
| FR-005–FR-008 | T012, T014 |
| FR-009–FR-011, FR-015 | T015, T016 |
| FR-012, FR-013, FR-016 | T017 |
| FR-014, FR-031 | T018 |
| FR-019 | T016 |
| FR-020–FR-023 | T007 |
| FR-024, FR-032 | T013 |
| FR-025, FR-026 | T015, T016 |
| FR-027–FR-029 | T014, T017, T018 |
| FR-030 | T019 |
