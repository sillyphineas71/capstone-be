# Tasks: Xem dashboard sử dụng phòng họp (UC-AA-02 / UC-149)

**Feature**: AA-ROOM-USAGE-DASHBOARD-001 — View Room Usage Dashboard
**Module**: analytics
**Branch**: `018-view-room-usage-dashboard`
**Date**: 2026-07-02

**Input documents**:
- spec.md, plan.md, research.md, data-model.md, quickstart.md
- contracts/room-usage-dashboard-api.md

## Path Conventions

- Source files: `src/modules/analytics/` (module + `dto/services/repositories/controllers/tests` đã tồn tại từ UC-AA-01 — chỉ thêm file mới)
- Seed file: `src/database/seeds/`
- Tái dùng: `DashboardOverviewConfigService.getMaxRangeDays()`, `AuthzReadRepository`, `AuditLogsService` (đã có từ UC-AA-01/hạ tầng chung)

---

## Phase 1: Setup

- [ ] T001 [P] Tạo `src/modules/analytics/dto/query-room-usage-dashboard.dto.ts`
- [ ] T002 [P] Tạo `src/modules/analytics/dto/query-room-detail.dto.ts`
- [ ] T003 [P] Tạo `src/modules/analytics/dto/room-usage-response.dto.ts`
- [ ] T004 [P] Tạo `src/modules/analytics/services/room-usage-config.service.ts`
- [ ] T005 [P] Tạo `src/modules/analytics/repositories/room-usage-dashboard.repository.ts`
- [ ] T006 [P] Tạo `src/modules/analytics/controllers/room-usage-dashboard.controller.ts`
- [ ] T007 [P] Tạo `src/modules/analytics/services/room-usage-dashboard.service.ts`
- [ ] T008 [P] Tạo `src/modules/analytics/tests/room-usage-dashboard.service.spec.ts` và `room-usage-dashboard.repository.spec.ts`

---

## Phase 2: Foundational

- [ ] T009 [FR-019, FR-020, FR-021] [P] Implement `QueryRoomUsageDashboardDto` trong `query-room-usage-dashboard.dto.ts`
  - `@IsOptional() @IsEnum(['day','week','month','custom']) preset?: string`
  - `@IsOptional() @IsDateString() from?: string`
  - `@IsOptional() @IsDateString() to?: string`
  - `@IsOptional() @IsUUID() roomId?: string`
  - `@IsOptional() @IsString() @MaxLength(150) siteName?: string`

- [ ] T010 [FR-019, FR-020, FR-021] [P] Implement `QueryRoomDetailDto` trong `query-room-detail.dto.ts`
  - Giống T009 nhưng KHÔNG có `roomId`/`siteName`

- [ ] T011 [FR-012, FR-025-FR-033] [P] Implement DTO response trong `room-usage-response.dto.ts`
  - `RoomComparisonItemDto`: `roomId, roomName, bookedHours, actualHours (number|null), reservationUtilizationRate, roomOccupancyRate (number|null), hasActualData`
  - `RoomUsageSummaryDto`: `reservationUtilizationRate, roomOccupancyRate, totalBookedHours, actualUsedHours`
  - `RoomUsageDashboardResponseDto`: `period, summary, rooms: RoomComparisonItemDto[], trend: {date, meetingCount}[]`
  - `HeatmapBucketDto`: `hourOfDay (0-23), actualMinutes`
  - `RoomDetailMeetingDto`: `meetingId, title, organizerName, reservedStartTime, reservedEndTime, actualStartTime, actualEndTime, status`
  - `RoomDetailResponseDto`: `room, period, bookedHours, actualHours, reservationUtilizationRate, roomOccupancyRate, hasActualData, heatmap: HeatmapBucketDto[], meetings: RoomDetailMeetingDto[]`

- [ ] T012 [FR-DATA-002] Implement `RoomUsageConfigService.getOperatingHoursPerDay()` trong `room-usage-config.service.ts`
  - Precedence: `system_configs['analytics.room_operating_hours_per_day']` → env `ANALYTICS_ROOM_OPERATING_HOURS_PER_DAY` → default `8`
  - Mirror `DashboardOverviewConfigService.getMaxRangeDays()` đã có

- [ ] T013 [FR-004, FR-010] Tạo `RoomUsageDashboardController` (shell) trong `room-usage-dashboard.controller.ts`
  - `@Controller('analytics/rooms')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.room.read')` class-level
  - `@Get('dashboard') getComparison(@Query() query: QueryRoomUsageDashboardDto, @CurrentUser() currentUser)`
  - `@Get(':roomId/detail') getDetail(@Param('roomId', ParseUUIDPipe) roomId: string, @Query() query: QueryRoomDetailDto, @CurrentUser() currentUser)`

- [ ] T014 [FR-001] Tạo `RoomUsageDashboardService` (shell) trong `room-usage-dashboard.service.ts`
  - Inject: `AuthzReadRepository`, `RoomUsageDashboardRepository`, `RoomUsageConfigService`, `DashboardOverviewConfigService` (tái dùng `getMaxRangeDays`)
  - `getComparisonDashboard(currentUser, query)` và `getRoomDetail(currentUser, roomId, query)` — throw `NotImplementedException` tạm

- [ ] T015 [Module] Cập nhật `src/modules/analytics/analytics.module.ts`
  - Đăng ký `RoomUsageDashboardController` vào `controllers`
  - Đăng ký `RoomUsageDashboardService`, `RoomUsageDashboardRepository`, `RoomUsageConfigService` vào `providers`
  - Đảm bảo `TypeOrmModule.forFeature([...])` có `RoomEntity`, `RoomBookingEntity`, `RoomBookingUsageEntity` (thêm nếu chưa có từ UC-AA-01)

---

## Phase 3: Business Logic — Date Range & Scope

- [ ] T016 [FR-005, FR-006, FR-007] Implement `resolveDateRange(query)` trong `RoomUsageDashboardService`
  - `preset` thiếu → mặc định `'month'`
  - `preset IN (day,week,month)` → tự tính `from/to` theo timezone `Asia/Ho_Chi_Minh` (day=hôm nay; week=Thứ 2→Chủ nhật tuần hiện tại; month=ngày 1→cuối tháng hiện tại)
  - `preset='custom'` → bắt buộc `from`/`to`, validate `from<=to` — thiếu hoặc sai → `BadRequestException({code:'VALIDATION_ERROR'})`

- [ ] T017 [FR-022, FR-036, NFR-003] Implement check `maxRangeDays` trong `RoomUsageDashboardService`
  - Gọi `DashboardOverviewConfigService.getMaxRangeDays()` (tái dùng nguyên từ UC-AA-01, KHÔNG tạo config mới)
  - Vượt ngưỡng → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})` trước khi query

- [ ] T018 [FR-003, FR-DATA-001] Implement `resolveRoomScope(currentUser, from, to)` trong `RoomUsageDashboardService`
  - Gọi `AuthzReadRepository.getEffectiveRolesAndPermissions`
  - `SYSTEM_ADMIN`/`BUSINESS_ADMIN` → `{ isAdmin: true, scopeRoomIds: null }`
  - `MANAGER` → raw SQL (data-model.md §Scope resolution, bind `from/to`) → `{ isAdmin: false, scopeRoomIds: string[] }`
  - Không có role hợp lệ → `ForbiddenException({code:'PERMISSION_DENIED'})`

- [ ] T019 [FR-023, ERR-009] Implement check tồn tại phòng (endpoint chi tiết) trong `RoomUsageDashboardService`
  - Query `RoomEntity` theo `roomId`, `deletedAt IS NULL` → không có → `NotFoundException({code:'ROOM_NOT_FOUND'})`

- [ ] T020 [FR-011, FR-024, AC-004] Implement check `ROOM_OUT_OF_SCOPE` (endpoint chi tiết) trong `RoomUsageDashboardService`
  - Sau T019 (đã xác nhận phòng tồn tại): nếu `!isAdmin` và `roomId NOT IN scopeRoomIds` → `ForbiddenException({code:'ROOM_OUT_OF_SCOPE'})`

---

## Phase 4: Business Logic — Aggregation

- [ ] T021 [FR-027] [P] Implement `getBookedAggregate(params)` trong `room-usage-dashboard.repository.ts`
  - Trả `Map<roomId, bookedMinutesSum>` từ `room_bookings` (scope + kỳ overlap, `status IN ('approved','active','completed','released')`)

- [ ] T022 [FR-028, FR-013] [P] Implement `getActualAggregate(params)` trong repository
  - Trả `Map<roomId, { actualMinutesSum, hasActualData }>` từ `room_booking_usages`, ưu tiên `actual_*`, fallback `presence_*`, loại record thiếu cả hai

- [ ] T023 [FR-008, FR-009] [P] Implement `listRoomsForComparison(params)` trong repository
  - `rooms WHERE is_active=true` (+ filter `roomId`/`siteName` nếu có) LEFT JOIN kết quả T021/T022 theo scope
  - Nếu `scopeRoomIds != null` (MANAGER) → thêm `AND rooms.id = ANY(scopeRoomIds)`

- [ ] T024 [FR-032] [P] Implement `getRoomMeetingsList(roomId, from, to)` trong repository
  - JOIN `room_bookings` + `meetings` + `users` (organizer) + `room_booking_usages`, trả đủ field theo `RoomDetailMeetingDto`

- [ ] T025 [FR-031] Implement `computeHeatmap(usageRows, from, to)` trong `RoomUsageDashboardService` (tính ở service, không SQL)
  - Input: danh sách `room_booking_usages` thô (actual/presence hợp lệ) của 1 phòng trong kỳ
  - Với mỗi record, với mỗi ngày nó chạm tới, với mỗi giờ đồng hồ 0-23: `overlapMinutes = max(0, min(usageEnd, hourEnd) - max(usageStart, hourStart))` tính bằng phút, cộng vào `heatmap[hour]`
  - Trả mảng 24 phần tử `{hourOfDay, actualMinutes}` (kể cả `actualMinutes=0`)

- [ ] T026 [FR-013, FR-014, FR-035] Implement empty/EX1 handling trong `RoomUsageDashboardService`
  - `scopeRoomIds = []` (MANAGER không có phòng nào trong kỳ) → `getComparisonDashboard` trả `rooms=[]`, `summary` toàn 0, không lỗi
  - Từng phòng: nếu không có aggregate actual (T022) → `hasActualData=false`, `actualHours=null`, `roomOccupancyRate=null`; `bookedHours`/`reservationUtilizationRate` vẫn tính bình thường

- [ ] T027 [FR-029, FR-030, FR-033] Implement `buildComparisonResponse(rooms, from, to, operatingHoursPerDay)` trong `RoomUsageDashboardService`
  - Mỗi phòng: `reservationUtilizationRate = bookedHours / (operatingHoursPerDay * soNgay) * 100` (mẫu số 0 → 0)
  - Mỗi phòng có `hasActualData=true`: `roomOccupancyRate = actualHours / bookedHours * 100` (mẫu số 0 → 0)
  - `summary` = tổng hợp trên toàn bộ `rooms` trả về (không phân biệt admin/manager — đã lọc đúng scope trước đó)

- [ ] T028 [FR-012] Implement `buildDetailResponse(room, aggregates, heatmap, meetings)` trong `RoomUsageDashboardService`
  - Gộp thành `RoomDetailResponseDto`

---

## Phase 5: Controller Wiring & Error Handling

- [ ] T029 [FR-004, FR-034] Hoàn thiện `RoomUsageDashboardController.getComparison()`
  - Thứ tự: `resolveDateRange` → `maxRangeDays` check → `resolveRoomScope` → aggregate (T021-T023) → `buildComparisonResponse`
  - Audit log non-blocking `action_type='read_analytics_room_dashboard'` (gated `AUDIT_LOG_ENABLED`)
  - Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

- [ ] T030 [FR-010, FR-034] Hoàn thiện `RoomUsageDashboardController.getDetail()`
  - Thứ tự: `resolveDateRange` → `maxRangeDays` check → `resolveRoomScope` → check tồn tại (T019) → check ownership (T020) → aggregate (T021/T022 scoped 1 phòng, T024, T025) → `buildDetailResponse`
  - Audit log non-blocking `action_type='read_analytics_room_detail'`

---

## Phase 6: Testing

- [ ] T031 [Test, AC-005] [P] Unit test `resolveDateRange()`
  - Test 4 preset tính đúng range theo `Asia/Ho_Chi_Minh`
  - Test thiếu preset → mặc định `month`
  - Test `custom` thiếu `from`/`to` → lỗi
  - Test `from > to` → lỗi

- [ ] T032 [Test, AC-002, AC-007] [P] Unit test `resolveRoomScope()`
  - Test admin → `null`
  - Test MANAGER: phòng nằm trong scope tháng 6 (có booking) nhưng KHÔNG nằm trong scope tháng 7 (không có booking) — verify scope đổi theo `from/to`
  - Test MANAGER 0 phòng → `[]`

- [ ] T033 [Test, AC-004] [P] Unit test check tồn tại + ownership (T019, T020)
  - `roomId` không tồn tại → `ROOM_NOT_FOUND`
  - `roomId` tồn tại nhưng ngoài scope MANAGER → `ROOM_OUT_OF_SCOPE`
  - `roomId` trong scope → pass

- [ ] T034 [Test, AC-006] [P] Unit test aggregate + `hasActualData`
  - Phòng không có `room_booking_usages` actual/presence nào → `hasActualData=false`, `actualHours=null`, `roomOccupancyRate=null`
  - Phòng có dữ liệu → tính đúng `bookedHours`/`actualHours`

- [ ] T035 [Test] [P] Unit test `reservationUtilizationRate`/`roomOccupancyRate`
  - Mẫu số 0 (không có booking, hoặc `operatingHoursPerDay*days=0`) → trả `0`, không `NaN`
  - Giá trị > 100% không bị chặn (đúng phản ánh dữ liệu thật)

- [ ] T036 [Test, AC-003] [P] Unit test `computeHeatmap()`
  - Record 1 phiên 9:30-11:15 (1 ngày) → bucket 9=30, bucket 10=60, bucket 11=15, các bucket khác=0
  - 2 record cùng bucket giờ, khác ngày trong kỳ → cộng dồn đúng
  - Record kéo dài qua nửa đêm (nếu có) → xử lý đúng theo từng ngày riêng biệt

- [ ] T037 [Test] [P] Unit test `RoomComparisonItemDto`/`QueryRoomUsageDashboardDto` validation
  - `preset` sai enum, `roomId`/`siteName` sai format → lỗi validation

- [ ] T038 [Test] [P] Unit test controller (cả 2 endpoint)
  - Request hợp lệ → 200 đúng cấu trúc
  - Audit log gọi khi thành công, KHÔNG gọi khi lỗi 403/404/400
  - Lỗi không lường trước → 500 `INTERNAL_ERROR`

- [ ] T039 [Test] [P] Unit test seed permission `analytics.room.read`
  - Tạo đúng permission, gán đúng 3 role `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T040 [Polish] Tạo `src/database/seeds/<timestamp>-SeedAnalyticsRoomReadPermission.ts` theo đúng pattern seed permission hiện có
- [ ] T041 [Polish] Verify response format `{success, message, data, meta}` cho cả 2 endpoint
- [ ] T042 [Polish, FR-001] Verify read-only: không có write operation nào trong service/repository (ngoại trừ audit log dùng chung)
- [ ] T043 [Polish] Verify mọi raw SQL dùng parameter binding, không nối chuỗi
- [ ] T044 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `DATE_RANGE_TOO_LARGE`, `PERMISSION_DENIED`, `ROOM_OUT_OF_SCOPE`, `ROOM_NOT_FOUND`, `INTERNAL_ERROR`
- [ ] T045 [Polish] Verify KHÔNG có logic export (.xlsx) nào bị viết nhầm vào module `analytics` — AF1 chỉ tái dùng UC-49 ở `reports` (FE-side wiring, ngoài phạm vi BE feature này)
- [ ] T046 [Test] Chạy toàn bộ kịch bản `quickstart.md` để verify end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Date range & Scope)**: Phụ thuộc Phase 2
- **Phase 4 (Aggregation)**: Phụ thuộc Phase 2; các repository method (T021-T024) độc lập, chạy song song
- **Phase 5 (Wiring)**: Phụ thuộc Phase 3 + Phase 4
- **Phase 6 (Testing)**: Phụ thuộc Phase 5
- **Phase 7 (Polish)**: Phụ thuộc Phase 6

### Parallel Opportunities

- Phase 1: T001-T008 song song (khác file)
- Phase 4: T021-T024 song song (method độc lập trong cùng repository file, không phụ thuộc lẫn nhau); T025-T028 sau khi có raw data từ T021-T024
- Phase 6: T031-T039 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 + Phase 4 — Business logic đầy đủ (date range, scope theo kỳ, aggregate, heatmap, empty state)
3. Phase 5 — Controller hoàn chỉnh, audit log
4. Phase 6 — Unit test toàn bộ nhánh (đặc biệt T032 scope-theo-kỳ và T036 heatmap — 2 điểm phức tạp nhất)
5. Phase 7 — Seed permission, polish, verify quickstart

MVP = Phase 1 → Phase 5.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001, FR-002 | T014, T021-T028 |
| FR-003, FR-DATA-001 | T018 |
| FR-004, FR-010, FR-017 | T013 (guard) |
| FR-005–FR-007 | T016 |
| FR-008, FR-009, FR-015, FR-016 | T023 |
| FR-011, FR-024 | T020 |
| FR-012 | T028 |
| FR-013, FR-014, FR-035 | T022, T026 |
| FR-018–FR-021 | T009, T010 |
| FR-022, FR-036, NFR-003 | T012, T017 |
| FR-023 | T019 |
| FR-025, FR-026 | T018, T020 |
| FR-027–FR-030 | T021, T022, T027 |
| FR-031 | T025 |
| FR-032 | T024 |
| FR-033 | T027 |
| FR-034 | T029, T030 |
