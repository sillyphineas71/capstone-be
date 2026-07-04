# Tasks: Xem thống kê tỷ lệ sử dụng phòng tổng hợp (UC-AA-08 / UC-155)

**Feature**: AA-ROOM-UTILIZATION-RATE-001 — View Aggregate Room Utilization Rate
**Module**: analytics
**Branch**: `023-view-room-utilization-rate`
**Date**: 2026-07-02

**Input documents**:
- spec.md, plan.md

## Path Conventions

- Source files: `src/modules/analytics/` (thư mục con đã tồn tại từ UC-AA-01/02/04/05/06/07 — chỉ thêm file mới)
- Tái dùng: `DashboardOverviewConfigService.getMaxRangeDays()` (UC-AA-01), `RoomUsageConfigService.getOperatingHoursPerDay()` (UC-AA-02), `AuthzReadRepository`, `AuditLogsService`, permission `analytics.room.read` (đã seed ở UC-AA-02 — **KHÔNG** seed lại), `RoomEntity`/`RoomBookingEntity`/`RoomBookingUsageEntity`/`MeetingEntity`/`UserEntity`/`DepartmentEntity` (đã import từ UC-AA-01/02)
- **KHÔNG** import `RoomUsageDashboardRepository`/`RoomUsageDashboardService` của UC-AA-02 — viết lại 1 bản SQL scope resolution độc lập trong repository mới (xem plan.md Complexity Tracking)

---

## Phase 1: Setup

- [ ] T001 [P] Tạo `src/modules/analytics/dto/query-room-utilization-rate.dto.ts`
- [ ] T002 [P] Tạo `src/modules/analytics/dto/room-utilization-rate-response.dto.ts`
- [ ] T003 [P] Tạo `src/modules/analytics/repositories/room-utilization-rate.repository.ts`
- [ ] T004 [P] Tạo `src/modules/analytics/controllers/room-utilization-rate.controller.ts`
- [ ] T005 [P] Tạo `src/modules/analytics/services/room-utilization-rate.service.ts`
- [ ] T006 [P] Tạo `src/modules/analytics/tests/room-utilization-rate.service.spec.ts` và `room-utilization-rate.repository.spec.ts`

---

## Phase 2: Foundational

- [ ] T007 [FR-022-FR-028] [P] Implement `QueryRoomUtilizationRateDto` trong `query-room-utilization-rate.dto.ts`
  - `@IsOptional() @IsEnum(['day','week','month','quarter','custom']) preset?: string`
  - `@IsOptional() @IsDateString() from?: string`
  - `@IsOptional() @IsDateString() to?: string`
  - `@IsOptional() @IsEnum(['previous_period','same_period_last_year','custom']) comparisonMode?: string`
  - `@IsOptional() @IsDateString() comparisonFrom?: string`
  - `@IsOptional() @IsDateString() comparisonTo?: string`
  - `@IsOptional() @IsUUID() roomId?: string`
  - `@IsOptional() @IsEnum(['day','week']) granularity?: string`

- [ ] T008 [FR-033-FR-039] [P] Implement DTO response trong `room-utilization-rate-response.dto.ts`
  - `MetricPairDto { current: number|null; comparison: number|null; deltaPercent: number|null }`
  - `HoursPairDto { current: number; comparison: number }`
  - `TrendBucketDto { index: string; current: {reservationUtilizationRate: number; roomOccupancyRate: number}; comparison: {reservationUtilizationRate: number; roomOccupancyRate: number} }`
  - `RoomUtilizationRateResponseDto { currentPeriod: {from,to}; comparisonPeriod: {from,to}; comparisonHasNoData: boolean; summary: { reservationUtilizationRate: MetricPairDto; roomOccupancyRate: MetricPairDto; bookedHours: HoursPairDto; actualHours: HoursPairDto; availableHours: HoursPairDto }; trend: TrendBucketDto[]; message?: string }`

- [ ] T009 [FR-004] Tạo `RoomUtilizationRateController` (shell) trong `room-utilization-rate.controller.ts`
  - `@Controller('analytics/rooms')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.room.read')` class-level
  - `@Get('utilization-rate') getUtilizationRate(@Query() query: QueryRoomUtilizationRateDto, @CurrentUser() currentUser)`

- [ ] T010 [FR-001, FR-002] Tạo `RoomUtilizationRateService` (shell) trong `room-utilization-rate.service.ts`
  - Inject: `AuthzReadRepository`, `RoomUtilizationRateRepository`, `DashboardOverviewConfigService`, `RoomUsageConfigService`
  - `getUtilizationRate(currentUser, query)` — throw `NotImplementedException` tạm

- [ ] T011 [Module] Cập nhật `src/modules/analytics/analytics.module.ts`
  - Đăng ký `RoomUtilizationRateController` vào `controllers`
  - Đăng ký `RoomUtilizationRateService`, `RoomUtilizationRateRepository` vào `providers`
  - Xác nhận `TypeOrmModule.forFeature` đã có `RoomEntity`, `RoomBookingEntity`, `RoomBookingUsageEntity`, `MeetingEntity`, `UserEntity`, `DepartmentEntity`

---

## Phase 3: Business Logic — Preset, Kỳ đối chiếu, Scope

- [ ] T012 [FR-005-FR-007] Implement `resolveCurrentPeriod(query)` trong `RoomUtilizationRateService`
  - `preset` thiếu → mặc định `'month'`
  - `day/week/month` → tái dùng logic đã có ở UC-AA-02 (timezone `Asia/Ho_Chi_Minh`)
  - `quarter` → quý dương lịch hiện tại (Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec), tái dùng công thức đã có ở UC-AA-06
  - `custom` → dùng `from`/`to` truyền vào; thiếu hoặc `from>to` → `BadRequestException({code:'VALIDATION_ERROR'})`

- [ ] T013 [FR-029, NFR-002] Implement check `maxRangeDays` (chỉ áp cho kỳ hiện tại) trong `RoomUtilizationRateService`
  - Gọi `DashboardOverviewConfigService.getMaxRangeDays()` (tái dùng, KHÔNG tạo config mới)
  - Vượt ngưỡng → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`

- [ ] T014 [FR-008-FR-011, FR-DATA-003] Implement `resolveComparisonPeriod(comparisonMode, currentFrom, currentTo, comparisonFrom?, comparisonTo?)` trong `RoomUtilizationRateService` — **MỚI, chưa từng có ở feature trước**
  - `comparisonMode` thiếu → mặc định `'previous_period'`
  - `previous_period`: `comparisonTo = currentFrom - 1 ngày`; `comparisonFrom = comparisonTo - (currentTo - currentFrom)` (cùng số ngày với kỳ hiện tại)
  - `same_period_last_year`: `comparisonFrom = currentFrom` lùi đúng 1 năm dương lịch, `comparisonTo = currentTo` lùi đúng 1 năm (xử lý biên 29/2 → dịch về 28/2 nếu năm đích không nhuận)
  - `custom`: dùng `comparisonFrom`/`comparisonTo`; thiếu hoặc `comparisonFrom>comparisonTo` → `VALIDATION_ERROR`; số ngày khác kỳ hiện tại → `VALIDATION_ERROR` (FR-026)

- [ ] T015 [FR-012, FR-DATA-001, FR-032] Implement `resolveRoomScope(currentUser, currentFrom, currentTo)` trong `RoomUtilizationRateService`
  - Viết lại 1 bản SQL độc lập (KHÔNG gọi sang `RoomUsageDashboardRepository` của UC-AA-02): `room_id` DISTINCT trong `room_bookings` gắn `meetings.organizer_id` thuộc phòng ban `departments.manager_user_id = currentUser.id`, bind `[currentFrom, currentTo]`
  - `SYSTEM_ADMIN`/`BUSINESS_ADMIN` → `{ isAdmin: true, scopeRoomIds: null }`

- [ ] T016 [FR-021, FR-030, AC-005] Implement check `roomId` tồn tại + `ROOM_OUT_OF_SCOPE` trong `RoomUtilizationRateService`
  - `roomId` không tồn tại/soft-deleted → `NotFoundException({code:'ROOM_NOT_FOUND'})` (check trước)
  - MANAGER và `roomId NOT IN scopeRoomIds` (theo kỳ hiện tại) → `ForbiddenException({code:'ROOM_OUT_OF_SCOPE'})`

- [ ] T017 [FR-013, FR-014] Implement auto-chọn `granularity` trong `RoomUtilizationRateService`
  - Thiếu `granularity` → `'day'` nếu số ngày kỳ hiện tại ≤ 31, ngược lại `'week'`

---

## Phase 4: Business Logic — Aggregation 2 kỳ song song

- [ ] T018 [FR-033, FR-034, FR-035] Implement `getPeriodAggregate(scopeRoomIds, roomIdFilter, from, to)` trong `room-utilization-rate.repository.ts`
  - `bookedMinutesSum`: `SUM(reserved_end_time - reserved_start_time)` từ `room_bookings` (`status IN ('approved','active','completed','released')`, `reserved_start_time`/`reserved_end_time` overlap `[from,to]`), filter `scopeRoomIds`/`roomIdFilter` nếu có
  - `actualMinutesSum`/`hasActualData`: từ `room_booking_usages`, ưu tiên `actual_end_time - actual_start_time`, fallback `last_presence_at - first_presence_at`, loại record thiếu cả hai
  - `activeRoomCount`: `COUNT(DISTINCT rooms.id) WHERE is_active=true` trong scope tương ứng
  - Parameterized, không nối chuỗi; trả `{ bookedMinutesSum, actualMinutesSum, hasActualData, activeRoomCount }`

- [ ] T019 [FR-036, FR-037, FR-038] Implement tính `summary` trong `RoomUtilizationRateService`
  - Gọi `getPeriodAggregate` 2 lần: current `[currentFrom,currentTo]`, comparison `[comparisonFrom,comparisonTo]` (cùng `scopeRoomIds`/`roomIdFilter`)
  - `availableHours = operatingHoursPerDay (RoomUsageConfigService.getOperatingHoursPerDay()) × số_ngày_trong_kỳ × activeRoomCount` — tính riêng cho mỗi kỳ
  - `reservationUtilizationRate.{current,comparison} = bookedHours / availableHours * 100` (mẫu số 0 → `0`)
  - `roomOccupancyRate.{current,comparison} = actualHours / bookedHours * 100` nếu `hasActualData`, ngược lại `null` (mẫu số 0 → `0`)
  - `deltaPercent = round((current - comparison) / comparison * 100, 1)`; `comparison=0` hoặc `null` → `deltaPercent=null`
  - `comparisonHasNoData = (comparison.bookedMinutesSum === 0)`

- [ ] T020 [FR-039] Implement tính `trend` trong `RoomUtilizationRateService`
  - Sinh N bucket theo `granularity` trên độ dài kỳ hiện tại (`day`: N=số ngày; `week`: N=số tuần ISO)
  - Với mỗi bucket index `i` (0-based): tính cửa sổ ngày trong kỳ hiện tại (`currentFrom + offset(i)`) và cửa sổ tương ứng trong kỳ đối chiếu (`comparisonFrom + offset(i)`, cùng offset tương đối)
  - Gọi `getPeriodAggregate` (T018) cho từng cửa sổ × 2 kỳ, tính `reservationUtilizationRate`/`roomOccupancyRate` cho bucket đó (không tính `deltaPercent` ở cấp bucket)
  - `index` label = chỉ số tương đối (`"Ngày 1"`, `"Ngày 2"`... hoặc `"Tuần 1"`, `"Tuần 2"`...), KHÔNG dùng ngày lịch thật
  - Nếu `comparisonHasNoData=true` (T019) → ép toàn bộ `trend[].comparison.*` = `0`

- [ ] T021 [FR-015-FR-017] Implement `buildResponse(currentPeriod, comparisonPeriod, comparisonHasNoData, summary, trend)` trong `RoomUtilizationRateService`
  - Kỳ hiện tại rỗng (`current.bookedMinutesSum=0` toàn scope) → thêm `message` mô tả không có dữ liệu kỳ hiện tại
  - `comparisonHasNoData=true` → thêm `message` đúng nguyên văn EX1: "Không tìm thấy dữ liệu vận hành hợp lệ của chu kỳ đối chiếu được chọn."
  - Scope Manager rỗng (`resolvedScopeRoomIds=[]`) → trả response rỗng tương tự, không lỗi

---

## Phase 5: Controller Wiring & Error Handling

- [ ] T022 [FR-004, FR-031, FR-040] Hoàn thiện `RoomUtilizationRateController.getUtilizationRate()` / `RoomUtilizationRateService.getUtilizationRate()`
  - Thứ tự: `resolveCurrentPeriod` (T012) → `maxRangeDays` check (T013) → `resolveComparisonPeriod` (T014) → `resolveRoomScope` (T015) → `roomId` check (T016) → `granularity` auto (T017) → `getPeriodAggregate`×2 cho summary (T018, T019) → `trend` (T020) → `buildResponse` (T021)
  - Audit log non-blocking `action_type='read_analytics_room_utilization_rate'` (gated `AUDIT_LOG_ENABLED`), `metadata_json` gồm `{viewerUserId, viewerRole, from, to, comparisonMode, comparisonFrom, comparisonTo, roomId?, resolvedScopeRoomIds}`
  - Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 6: Testing

- [ ] T023 [Test, AC-001] [P] Unit test `resolveCurrentPeriod()`
  - 4 preset cũ (day/week/month/custom) tái dùng test case UC-AA-02
  - `quarter` đúng biên quý, đặc biệt Q1 (Jan-Mar)

- [ ] T024 [Test, AC-003, AC-004] [P] Unit test `resolveComparisonPeriod()` — **quan trọng nhất, MỚI hoàn toàn**
  - `previous_period`: kỳ hiện tại N ngày → kỳ đối chiếu đúng N ngày liền trước
  - `same_period_last_year`: lùi đúng 1 năm dương lịch, giữ nguyên ngày/tháng
  - `custom` độ dài khác kỳ hiện tại → `VALIDATION_ERROR` (ERR-005)
  - Biên năm nhuận 29/2 khi lùi về năm không nhuận → không crash

- [ ] T025 [Test, AC-002] [P] Unit test `resolveRoomScope()` (tái dùng test case UC-AA-02) — verify CHỈ theo kỳ hiện tại
  - Phòng có booking ở kỳ đối chiếu nhưng KHÔNG có ở kỳ hiện tại → vẫn bị loại khỏi scope (không rò rỉ qua "cửa sau")

- [ ] T026 [Test, AC-005] [P] Unit test `roomId` tồn tại + `ROOM_OUT_OF_SCOPE` (T016)

- [ ] T027 [Test] [P] Unit test `getPeriodAggregate()` + `summary`
  - `availableHours` đúng khi scope nhiều phòng (nhân `activeRoomCount`) và khi lọc `roomId` (activeRoomCount=1)
  - `roomOccupancyRate=null` khi `!hasActualData`, không ảnh hưởng `reservationUtilizationRate`

- [ ] T028 [Test, AC-006, AC-007] [P] Unit test `deltaPercent` — **quan trọng, dễ sai**
  - `current=68, comparison=60` → `deltaPercent=13.3` (verify KHÔNG PHẢI `8`)
  - `comparison=0` → `deltaPercent=null` (verify KHÔNG PHẢI `Infinity`/`NaN`)
  - `comparisonHasNoData=true` khi `comparison.bookedMinutesSum=0`

- [ ] T029 [Test, AC-006] [P] Unit test `trend` — trục tương đối + EX1
  - `index` là chỉ số tương đối, không phải ngày lịch thật (verify đặc biệt với `same_period_last_year`)
  - `comparisonHasNoData=true` → toàn bộ `trend[].comparison.*` = `0`

- [ ] T030 [Test, AC-008] [P] Unit test empty state / Manager 0 phòng (T021)

- [ ] T031 [Test] [P] Unit test `QueryRoomUtilizationRateDto` validation + controller
  - `preset`/`comparisonMode`/`granularity`/`roomId` sai format → lỗi
  - `comparisonMode=custom` thiếu `comparisonFrom`/`comparisonTo` → lỗi
  - Request hợp lệ → 200 đúng cấu trúc; audit log gọi khi thành công

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T032 [Polish] Verify response format `{success, message, data, meta}`
- [ ] T033 [Polish, FR-001] Verify read-only: không có write operation nào trong service/repository
- [ ] T034 [Polish] Verify raw SQL dùng parameter binding, không nối chuỗi
- [ ] T035 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `DATE_RANGE_TOO_LARGE`, `PERMISSION_DENIED`, `ROOM_OUT_OF_SCOPE`, `ROOM_NOT_FOUND`, `INTERNAL_ERROR`
- [ ] T036 [Polish] Verify KHÔNG seed lại permission `analytics.room.read` (đã tồn tại từ UC-AA-02)
- [ ] T037 [Polish] Verify KHÔNG import `RoomUsageDashboardRepository`/`RoomUsageDashboardService` của UC-AA-02 vào feature này (giữ 2 feature độc lập, theo Structure Decision plan.md)
- [ ] T038 [Polish] Verify response KHÔNG có `byRoom[]`/`heatmap`/`meetings[]` (đã loại theo OOS-001, OOS-002 spec.md)
- [ ] T039 [Test] Chạy lại toàn bộ Acceptance Criteria trong spec.md §7 để verify end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Preset/Kỳ đối chiếu/Scope)**: Phụ thuộc Phase 2
- **Phase 4 (Aggregation)**: Phụ thuộc Phase 2; phụ thuộc Phase 3 để có 2 kỳ + scope + granularity trước khi aggregate
- **Phase 5 (Wiring)**: Phụ thuộc Phase 3 + Phase 4
- **Phase 6 (Testing)**: Phụ thuộc Phase 5
- **Phase 7 (Polish)**: Phụ thuộc Phase 6

### Parallel Opportunities

- Phase 1: T001-T006 song song (khác file)
- Phase 6: T023-T031 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 + Phase 4 — Business logic đầy đủ (preset mới, kỳ đối chiếu 3 chế độ, scope chỉ theo kỳ hiện tại, aggregate 2 kỳ song song, delta, trend trục tương đối)
3. Phase 5 — Controller hoàn chỉnh, audit log
4. Phase 6 — Unit test toàn bộ nhánh (đặc biệt T024 kỳ-đối-chiếu và T028 công-thức-delta là 2 điểm rủi ro cao nhất của feature này)
5. Phase 7 — Polish, verify không seed trùng permission, verify không import chéo UC-AA-02, verify không lặp lại byRoom/heatmap/meetings

MVP = Phase 1 → Phase 5.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001, FR-002 | T010, T018 |
| FR-003 | T019 |
| FR-004 | T009 |
| FR-005–FR-007 | T012 |
| FR-008–FR-011 | T014 |
| FR-012 | T015, T016 |
| FR-013, FR-014 | T017 |
| FR-015–FR-017 | T021 |
| FR-018 | T016 |
| FR-019–FR-028 | T007 |
| FR-029 | T013 |
| FR-030 | T016 |
| FR-031, FR-032 | T015 |
| FR-033–FR-039 | T018, T019, T020 |
| FR-040 | T022 |
| FR-041, FR-042 | T015, T013 |
