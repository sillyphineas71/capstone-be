# Implementation Plan: Xem thống kê tỷ lệ sử dụng phòng tổng hợp (UC-AA-08 / UC-155)

**Branch**: `023-view-room-utilization-rate` | **Date**: 2026-07-02
**Spec**: spec/features/analytics/feat-view-room-utilization-rate/spec.md

## Summary

Tính năng cho phép Manager (giới hạn phạm vi phòng ban phụ trách, scope động theo kỳ hiện tại), Business Admin, System Admin xem 2 chỉ số tổng hợp `reservationUtilizationRate` (bookedHours ÷ availableHours) và `roomOccupancyRate` (actualHours ÷ bookedHours) — tái dùng nguyên định nghĩa đã chốt ở UC-AA-02 — của kỳ hiện tại đối chiếu song song với 1 kỳ đối chiếu (`previous_period`/`same_period_last_year`/`custom`), kèm % thay đổi tương đối trên thẻ KPI và biểu đồ xu hướng đa đường dùng trục X tương đối (không phải ngày lịch thật) để 2 kỳ chồng khít. 1 endpoint mới: `GET /api/v1/analytics/rooms/utilization-rate` (đã có trong `API_CONTRACT` UC-155, mở rộng thêm `comparisonMode/comparisonFrom/comparisonTo/granularity` ở query, thêm `comparisonPeriod/deltaPercent/trend` 2-kỳ ở response, bỏ `byRoom[]`). Read-only, không thêm bảng/config/permission mới — tái dùng toàn bộ hạ tầng từ UC-AA-01 (`getMaxRangeDays`) và UC-AA-02 (`getOperatingHoursPerDay`, permission `analytics.room.read` đã seed, công thức/entity).

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT
**Storage**: PostgreSQL (read-only aggregate query, raw parameterized SQL cho scope theo kỳ + aggregate 2 kỳ song song)
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 3s cho khoảng mặc định (tháng hiện tại + tháng trước, `granularity=day`)
**Constraints**: Read-only tuyệt đối; scope Manager suy ra CHỈ từ kỳ hiện tại; 2 kỳ bắt buộc cùng độ dài khi `comparisonMode=custom`; delta `null` khi mẫu số kỳ đối chiếu = 0 (không chia 0)
**Scale**: Tối đa `analytics.dashboard_max_range_days` ngày cho kỳ hiện tại mỗi request; `trend` tối đa ~31 bucket (granularity=day) hoặc ~53 bucket (granularity=week)

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột/config key nào — tái dùng 100% `analytics.room_operating_hours_per_day` (UC-AA-02) và `analytics.dashboard_max_range_days` (UC-AA-01) |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('analytics.room.read')` (đã seed ở UC-AA-02, KHÔNG seed lại); scope enforce ở service |
| **Scope Gate** | PASS | Chỉ 1 endpoint UC-155 mở rộng; không lặp lại heatmap/danh sách meeting/`byRoom[]` đã thuộc UC-AA-02 (spec §0.13, §0.14) |
| **Module Gate** | PASS | Toàn bộ code trong `src/modules/analytics/`, tái dùng service/config đã có, không import chéo service của UC-AA-02 (duplicate 1 đoạn SQL ngắn để giữ 2 feature độc lập — xem Complexity Tracking) |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint khớp path `API_CONTRACT` UC-155 (field mở rộng đã ghi RECON) |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Test Gate** | PASS | Unit test cho preset kỳ hiện tại, 3 chế độ kỳ đối chiếu, ràng buộc cùng độ dài, công thức delta (kể cả chia 0), scope Manager chỉ theo kỳ hiện tại, trend trục tương đối |

## Project Structure

### Documentation (this feature)

```text
spec/features/analytics/feat-view-room-utilization-rate/
├── spec.md
├── plan.md              # File này
└── tasks.md
```

> Ghi chú: `research.md`/`data-model.md`/`quickstart.md`/`contracts/` chưa được tạo ở vòng này (không nằm trong yêu cầu hiện tại) — nội dung tương đương đã có đủ trong `spec.md` §0 (RECON) và §5 (Data Model). Có thể bổ sung sau nếu cần tách riêng theo đúng chuẩn speckit đầy đủ.

### Source Code (repository root)

```text
src/modules/analytics/
├── analytics.module.ts                             # Update: đăng ký thêm controller/service/repository mới
├── controllers/
│   ├── dashboard-overview.controller.ts             # Đã có (UC-AA-01)
│   ├── room-usage-dashboard.controller.ts           # Đã có (UC-AA-02) — /rooms/dashboard, /rooms/:roomId/detail
│   ├── meeting-count-by-period.controller.ts        # Đã có (UC-AA-04)
│   ├── meeting-status-breakdown.controller.ts       # Đã có (UC-AA-05)
│   ├── meeting-average-duration.controller.ts       # Đã có (UC-AA-06)
│   ├── meeting-cancel-rate.controller.ts            # Đã có (UC-AA-07)
│   └── room-utilization-rate.controller.ts          # NEW: /rooms/utilization-rate
├── services/
│   ├── dashboard-overview-config.service.ts         # Đã có — tái dùng getMaxRangeDays()
│   ├── room-usage-config.service.ts                 # Đã có (UC-AA-02) — tái dùng getOperatingHoursPerDay()
│   └── room-utilization-rate.service.ts             # NEW: orchestrator — preset, kỳ đối chiếu, scope, aggregate 2 kỳ, build response
├── repositories/
│   └── room-utilization-rate.repository.ts          # NEW: aggregate SQL bookedHours/actualHours/roomCount cho 1 kỳ + 1 scope
├── dto/
│   ├── query-room-utilization-rate.dto.ts           # NEW
│   └── room-utilization-rate-response.dto.ts        # NEW
└── tests/
    ├── room-utilization-rate.service.spec.ts
    └── room-utilization-rate.repository.spec.ts
```

**Structure Decision**: Mở rộng module `analytics` đã có. **Không** seed lại permission (`analytics.room.read` đã seed ở UC-AA-02). Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` và `RoomUsageConfigService.getOperatingHoursPerDay()` nguyên vẹn qua Dependency Injection. Scope Manager theo kỳ lọc **tái dùng đúng công thức SQL** đã có ở [feat-view-room-usage-dashboard/spec.md FR-DATA-001](../feat-view-room-usage-dashboard/spec.md) nhưng **viết lại 1 bản ngắn gọn trong repository mới** (không import chéo `RoomUsageDashboardRepository`/`RoomUsageDashboardService` của UC-AA-02) — giữ 2 feature độc lập, tránh coupling không cần thiết cho 1 câu SQL ngắn (xem Complexity Tracking).

## Complexity Tracking

Không vi phạm constitution. 2 điểm phức tạp nhất:

1. **Aggregate 2 kỳ song song + N bucket trend theo trục tương đối**: mỗi request cần tính `{bookedHours, actualHours, availableHours}` cho kỳ hiện tại VÀ kỳ đối chiếu, cả ở mức tổng (`summary`) lẫn từng bucket (`trend`). Cách triển khai: 1 hàm `getPeriodAggregate(scopeRoomIds, roomIdFilter, from, to)` dùng chung, gọi 2 lần cho `summary` (current/comparison) và N×2 lần cho `trend` (N bucket × 2 kỳ) — số lần gọi bị chặn trên bởi `analytics.dashboard_max_range_days` nên không phải lo hiệu năng ngoài tầm kiểm soát.
2. **Không import chéo service của UC-AA-02** để lấy scope Manager — chấp nhận duplicate 1 đoạn SQL ngắn (không phải business logic phức tạp) đổi lấy việc 2 feature không phụ thuộc lẫn nhau (nếu UC-AA-02 đổi implementation nội bộ, UC-AA-08 không bị ảnh hưởng ngoài ý muốn).

Cả 2 điểm đã có kế hoạch xử lý rõ ràng, không cần justify vi phạm constitution.

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/query-room-utilization-rate.dto.ts`, `dto/room-utilization-rate-response.dto.ts`, `services/room-utilization-rate.service.ts`, `repositories/room-utilization-rate.repository.ts`, `controllers/room-utilization-rate.controller.ts`, `tests/*.spec.ts`.

### Phase 2: Foundational

#### T-A: DTO

- `query-room-utilization-rate.dto.ts`: `@IsOptional() @IsEnum(['day','week','month','quarter','custom']) preset?`, `@IsOptional() @IsDateString() from?`, `to?`, `@IsOptional() @IsEnum(['previous_period','same_period_last_year','custom']) comparisonMode?`, `@IsOptional() @IsDateString() comparisonFrom?`, `comparisonTo?`, `@IsOptional() @IsUUID() roomId?`, `@IsOptional() @IsEnum(['day','week']) granularity?`.
- `room-utilization-rate-response.dto.ts`: `MetricPairDto {current, comparison, deltaPercent}` (dùng cho `reservationUtilizationRate`/`roomOccupancyRate`), `HoursPairDto {current, comparison}` (dùng cho `bookedHours`/`actualHours`/`availableHours`), `TrendBucketDto {index, current: {reservationUtilizationRate, roomOccupancyRate}, comparison: {reservationUtilizationRate, roomOccupancyRate}}`, `RoomUtilizationRateResponseDto {currentPeriod, comparisonPeriod, comparisonHasNoData, summary: {reservationUtilizationRate: MetricPairDto, roomOccupancyRate: MetricPairDto, bookedHours: HoursPairDto, actualHours: HoursPairDto, availableHours: HoursPairDto}, trend: TrendBucketDto[], message?}`.

#### T-B: Controller shell

- `room-utilization-rate.controller.ts`: `@Controller('analytics/rooms')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.room.read')` class-level, `@Get('utilization-rate')` → `service.getUtilizationRate(currentUser, query)`.

#### T-C: Service shell

- `room-utilization-rate.service.ts`: inject `AuthzReadRepository`, `RoomUtilizationRateRepository`, `DashboardOverviewConfigService`, `RoomUsageConfigService`. Method `getUtilizationRate(currentUser, query)` — throw `NotImplementedException` tạm.

#### T-D: Module wiring

- Cập nhật `analytics.module.ts`: đăng ký controller/service/repository mới; xác nhận `TypeOrmModule.forFeature` đã có `RoomEntity`, `RoomBookingEntity`, `RoomBookingUsageEntity`, `MeetingEntity`, `UserEntity`, `DepartmentEntity` (đã import từ UC-AA-01/02).

### Phase 3: Business Logic — Preset, Kỳ đối chiếu, Scope

#### T-E: Resolve kỳ hiện tại (mở rộng `resolveDateRange` của UC-AA-02, thêm `quarter`)

- `resolveCurrentPeriod(query)`: `preset` thiếu → mặc định `'month'`. `day/week/month` → tính như UC-AA-02. `quarter` → quý dương lịch hiện tại (Q1=Jan-Mar...), tái dùng công thức đã có ở UC-AA-06. `custom` → dùng `from`/`to` truyền vào, validate `from<=to`.

#### T-F: Check `maxRangeDays`

- Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` (chỉ áp cho kỳ hiện tại) → vượt → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`.

#### T-G: Resolve kỳ đối chiếu (MỚI — chưa từng có ở feature trước)

- `resolveComparisonPeriod(comparisonMode, currentFrom, currentTo, comparisonFrom?, comparisonTo?)`:
  - `previous_period` (mặc định): `comparisonTo = currentFrom - 1 ngày`, `comparisonFrom = comparisonTo - (currentTo - currentFrom)` (cùng số ngày).
  - `same_period_last_year`: `comparisonFrom = currentFrom - 1 năm dương lịch`, `comparisonTo = currentTo - 1 năm dương lịch` (giữ nguyên ngày/tháng).
  - `custom`: dùng `comparisonFrom`/`comparisonTo` truyền vào; validate `comparisonFrom<=comparisonTo` VÀ số ngày bằng đúng số ngày kỳ hiện tại — sai → `BadRequestException({code:'VALIDATION_ERROR'})`.

#### T-H: Resolve scope phòng Manager (chỉ theo kỳ hiện tại)

- `resolveRoomScope(currentUser, currentFrom, currentTo)`: viết lại 1 bản SQL scope resolution độc lập (KHÔNG import `RoomUsageDashboardRepository` của UC-AA-02 — xem Complexity Tracking), cùng công thức: `room_id` DISTINCT trong `room_bookings` gắn `meetings.organizer_id` thuộc phòng ban Manager quản lý, bind đúng `[currentFrom,currentTo]`.

#### T-I: Check `roomId` ownership

- Nếu MANAGER và `roomId NOT IN resolvedScopeRoomIds` (theo kỳ hiện tại) → `ForbiddenException({code:'ROOM_OUT_OF_SCOPE'})`.
- Nếu `roomId` không tồn tại/soft-deleted → `NotFoundException({code:'ROOM_NOT_FOUND'})` (check tồn tại trước ownership, nhất quán UC-AA-02).

#### T-J: Auto-chọn `granularity`

- Thiếu `granularity` → `day` nếu số ngày kỳ hiện tại ≤ 31, ngược lại `week`.

### Phase 4: Business Logic — Aggregation 2 kỳ song song

#### T-K: Repository — `getPeriodAggregate(scopeRoomIds, roomIdFilter, from, to)`

- 1 hàm dùng chung cho cả kỳ hiện tại lẫn kỳ đối chiếu, cả `summary` lẫn từng bucket `trend`:
  - `bookedMinutesSum`: `SUM(reserved_end_time - reserved_start_time)` từ `room_bookings` (status hợp lệ, trong `[from,to]`, lọc `scopeRoomIds`/`roomIdFilter` nếu có)
  - `actualMinutesSum`/`hasActualData`: từ `room_booking_usages`, ưu tiên actual, fallback presence, loại thiếu cả hai
  - `activeRoomCount`: `COUNT(DISTINCT rooms.id) WHERE is_active=true` trong scope (dùng cho `availableHours`)
  - Parameterized, không nối chuỗi

#### T-L: Service — tính `summary` cho 2 kỳ

- Gọi `getPeriodAggregate` 2 lần (current, comparison) với cùng scope + `roomIdFilter`.
- `availableHours = operatingHoursPerDay(RoomUsageConfigService) × số_ngày_trong_kỳ × activeRoomCount`.
- `reservationUtilizationRate = bookedHours / availableHours * 100` (mẫu số 0 → 0) cho mỗi kỳ.
- `roomOccupancyRate = actualHours / bookedHours * 100` (mẫu số 0 → 0, hoặc `null` nếu `!hasActualData`) cho mỗi kỳ.
- `deltaPercent = (current - comparison) / comparison * 100`, làm tròn 1 chữ số thập phân; `comparison=0` hoặc `null` → `deltaPercent=null`.
- `comparisonHasNoData = (comparison.bookedMinutesSum === 0)`.

#### T-M: Service — tính `trend` theo bucket tương đối

- Sinh N bucket theo `granularity` trên độ dài kỳ hiện tại (vd `day`: N = số ngày; `week`: N = số tuần).
- Với mỗi bucket index `i`: tính cửa sổ ngày tương ứng trong kỳ hiện tại (`currentFrom + offset(i)`) VÀ cửa sổ ngày tương ứng trong kỳ đối chiếu (`comparisonFrom + offset(i)`, cùng offset tương đối).
- Gọi `getPeriodAggregate` cho từng cửa sổ (current, comparison) → tính `reservationUtilizationRate`/`roomOccupancyRate` cho bucket đó (không tính `deltaPercent` ở cấp bucket, chỉ ở `summary`).
- Nếu `comparisonHasNoData` → toàn bộ `trend[].comparison.*` ép về `0` (đúng EX1, đường nằm ngang mức 0).

#### T-N: Build response

- Gộp `currentPeriod`, `comparisonPeriod`, `comparisonHasNoData`, `summary` (T-L), `trend` (T-M) thành `RoomUtilizationRateResponseDto`.
- Kỳ hiện tại rỗng (`bookedMinutesSum=0` toàn scope) → thêm `message` mô tả không có dữ liệu kỳ hiện tại.
- `comparisonHasNoData=true` → thêm `message` đúng nguyên văn EX1.

### Phase 5: Controller Wiring & Error Handling

#### T-O: Wire controller

- Thứ tự: `resolveCurrentPeriod` (T-E) → `maxRangeDays` check (T-F) → `resolveComparisonPeriod` (T-G) → `resolveRoomScope` (T-H) → `roomId` ownership (T-I) → `granularity` auto (T-J) → `getPeriodAggregate` × 2 cho summary (T-K, T-L) → `trend` (T-M) → `buildResponse` (T-N).
- Audit log non-blocking `action_type='read_analytics_room_utilization_rate'` (gated `AUDIT_LOG_ENABLED`), `metadata_json` gồm `{viewerUserId, viewerRole, from, to, comparisonMode, comparisonFrom, comparisonTo, roomId?, resolvedScopeRoomIds}`.
- Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

### Phase 6: Testing

#### T-P: Unit test `resolveCurrentPeriod()` (mở rộng `quarter`)

- 4 preset cũ (day/week/month/custom) tính đúng — tái dùng test case UC-AA-02.
- `quarter` đúng biên quý, đặc biệt Q1 (Jan-Mar).

#### T-Q: Unit test `resolveComparisonPeriod()` — **MỚI, quan trọng nhất**

- `previous_period`: kỳ hiện tại = tháng 7 (31 ngày) → kỳ đối chiếu = tháng 6 (30 ngày liền trước, đúng thứ tự ngày, KHÔNG nhất thiết cùng "1 tháng dương lịch" nếu current là custom range — verify đúng "N ngày liền trước", N = độ dài kỳ hiện tại).
- `same_period_last_year`: kỳ hiện tại = Quý 3/2026 (01/07-30/09/2026) → kỳ đối chiếu = 01/07/2025-30/09/2025 (lùi đúng 1 năm, giữ nguyên ngày/tháng).
- `custom` với độ dài khác kỳ hiện tại → `VALIDATION_ERROR` (verify ERR-005).
- Biên năm nhuận (29/2) khi `same_period_last_year` lùi về năm không nhuận → không crash, dịch về 28/2 (CL-2 spec.md).

#### T-R: Unit test `resolveRoomScope()` (tái dùng test case UC-AA-02, chỉ theo kỳ hiện tại)

- Verify scope KHÔNG bị ảnh hưởng bởi dữ liệu của kỳ đối chiếu (1 phòng có booking ở kỳ đối chiếu nhưng không có ở kỳ hiện tại → vẫn bị loại khỏi scope, đúng §0.12 spec.md).

#### T-S: Unit test `getPeriodAggregate()` + công thức `summary`

- `availableHours` tính đúng khi scope nhiều phòng (nhân thêm `activeRoomCount`) và khi lọc `roomId` (activeRoomCount=1, thu về đúng công thức UC-AA-02).
- `roomOccupancyRate=null` khi `!hasActualData`, không ảnh hưởng `reservationUtilizationRate`.

#### T-T: Unit test `deltaPercent` — **quan trọng, dễ sai**

- `current=68, comparison=60` → `deltaPercent = round((68-60)/60*100, 1) = 13.3` (verify KHÔNG PHẢI `8` — không nhầm sang chênh lệch điểm %).
- `comparison=0` → `deltaPercent=null` (verify KHÔNG PHẢI `Infinity`/`NaN`/lỗi).
- `comparisonHasNoData=true` khi `comparison.bookedMinutesSum=0`.

#### T-U: Unit test `trend` — trục tương đối + EX1

- Kỳ hiện tại và kỳ đối chiếu lệch năm lịch thật (`same_period_last_year`) → bucket `index` vẫn là chỉ số tương đối (`"Ngày 1"`...), không phải ngày lịch thật.
- `comparisonHasNoData=true` → toàn bộ `trend[].comparison.*` = `0` (đường nằm ngang mức 0, đúng EX1).

#### T-V: Unit test DTO validation + controller

- `preset`/`comparisonMode`/`granularity`/`roomId` sai format → lỗi.
- `comparisonMode=custom` thiếu `comparisonFrom`/`comparisonTo` → lỗi.
- Request hợp lệ → 200 đúng cấu trúc; audit log gọi khi thành công.

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic |
|---|---|
| AC-001 | T-E, T-G, T-K, T-L, T-M, T-N |
| AC-002 | T-H, T-R |
| AC-003 | T-G (same_period_last_year), T-Q |
| AC-004 | T-G (validate cùng độ dài), T-Q |
| AC-005 | T-I |
| AC-006 | T-G, T-L, T-U (comparisonHasNoData) |
| AC-007 | T-L, T-T (công thức delta) |
| AC-008 | T-H, T-N (scope rỗng) |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Nhầm công thức delta (% tương đối vs điểm phần trăm) | Sai toàn bộ ý nghĩa thẻ KPI, đi ngược quyết định đã duyệt (§0.5 spec.md) | Unit test T-T cụ thể với số liệu ví dụ trong AC-007 |
| Chia cho 0 khi kỳ đối chiếu không có dữ liệu (`comparison=0`) | Trả `Infinity`/`NaN`/crash thay vì `null` | Unit test T-T cụ thể cho case `comparison=0` |
| `trend` vẽ theo ngày lịch thật thay vì trục tương đối khi `same_period_last_year` | 2 đường không chồng khít, sai mục đích so sánh | Unit test T-U cụ thể verify `index` là chỉ số tương đối, không phải ISO date |
| Scope Manager vô tình union cả kỳ đối chiếu (rò rỉ dữ liệu phòng ngoài scope hiện tại) | Vi phạm NFR-004, lộ dữ liệu phòng ban khác | Unit test T-R cụ thể: phòng có dữ liệu kỳ đối chiếu nhưng không có ở kỳ hiện tại phải bị loại |
| `resolveComparisonPeriod` tính sai biên năm/tháng (`previous_period`/`same_period_last_year`) | Sai lệch toàn bộ dữ liệu hiển thị | Unit test T-Q cụ thể cho biên năm, biên tháng, năm nhuận (CL-2) |
| N+1 query cho `trend` (mỗi bucket × 2 kỳ) chậm khi range lớn + granularity=day | Vượt NFR-001 (< 3s) | Bị chặn trên bởi `analytics.dashboard_max_range_days`; nếu cần tối ưu sau này có thể gộp thành 1 query `GROUP BY` theo bucket thay vì loop — ghi nhận là cải tiến tương lai, không block launch hiện tại |

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T-C, T-K |
| FR-004 | T-B |
| FR-005–FR-007 | T-E |
| FR-008–FR-011 | T-G |
| FR-012 | T-H, T-I |
| FR-013, FR-014 | T-J |
| FR-015–FR-017 | T-N, T-L |
| FR-018 | T-I |
| FR-019–FR-030 | T-A, T-F, T-I |
| FR-031, FR-032 | T-H |
| FR-033–FR-039 | T-K, T-L, T-M |
| FR-040 | T-O |
| FR-041, FR-042 | T-H, T-F |
