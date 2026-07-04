# Implementation Plan: Xem thống kê thời lượng trung bình cuộc họp (UC-AA-06 / UC-153)

**Branch**: `021-view-meeting-average-duration` | **Date**: 2026-07-02
**Spec**: spec/features/analytics/feat-view-meeting-average-duration/spec.md

## Summary

Tính năng cho phép Manager (giới hạn phòng ban phụ trách, scope tĩnh), Business Admin, System Admin xem biểu đồ cột kép đối chiếu thời lượng dự kiến (`room_bookings`) và thời lượng thực tế (`room_booking_usages`) trung bình của các cuộc họp `completed`, nhóm theo ngày/tuần/tháng/quý, lọc theo phòng ban (nhiều)/phòng họp. Chỉ tính trên `meetings.status='completed'` để đảm bảo 2 giá trị luôn cùng 1 tập N (Phương án A). 1 endpoint: `GET /api/v1/analytics/meetings/average-duration` (đã có trong `API_CONTRACT` UC-153, sửa: bỏ `mode`/`medianMinutes`, trả song song 2 giá trị). Read-only, không thêm bảng/config/permission mới — tái dùng toàn bộ hạ tầng từ UC-AA-01/02/04/05.

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT
**Storage**: PostgreSQL (read-only aggregate query, JOIN `meetings + room_bookings + room_booking_usages`)
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 2s cho khoảng mặc định (tháng hiện tại, granularity=week)
**Constraints**: Read-only tuyệt đối; chỉ tính `status='completed'`; population đồng bộ giữa 2 giá trị; bucket rỗng trả `null` không phải `0`
**Scale**: Tối đa `analytics.dashboard_max_range_days` ngày mỗi request

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột/config key nào — tái dùng 100% từ UC-AA-01/02/04/05 |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('analytics.meeting.read')` (tái dùng); scope enforce ở service |
| **Scope Gate** | PASS | Chỉ 1 endpoint UC-153; đã quyết định không gộp UC-AA-04 (spec §0.1) |
| **Module Gate** | PASS | Toàn bộ code trong `src/modules/analytics/`, tái dùng service/config đã có |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint khớp path `API_CONTRACT` UC-153 (+ field đổi đã ghi RECON) |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Test Gate** | PASS | Unit test cho population đồng bộ, null-vs-0, bucket quarter, scope, filter |

## Project Structure

### Documentation (this feature)

```text
spec/features/analytics/feat-view-meeting-average-duration/
├── spec.md
├── plan.md              # File này
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── meeting-average-duration-api.md
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/analytics/
├── analytics.module.ts                             # Update: đăng ký thêm controller/service/repository mới
├── controllers/
│   ├── dashboard-overview.controller.ts             # Đã có (UC-AA-01)
│   ├── room-usage-dashboard.controller.ts           # Đã có (UC-AA-02)
│   ├── meeting-count-by-period.controller.ts        # Đã có (UC-AA-04)
│   ├── meeting-status-breakdown.controller.ts       # Đã có (UC-AA-05)
│   └── meeting-average-duration.controller.ts       # NEW
├── services/
│   ├── dashboard-overview-config.service.ts         # Đã có — tái dùng getMaxRangeDays()
│   └── meeting-average-duration.service.ts          # NEW: orchestrator — scope, date range, bucket, build response
├── repositories/
│   └── meeting-average-duration.repository.ts       # NEW: aggregate SQL planned/actual/count theo bucket
├── dto/
│   ├── query-meeting-average-duration.dto.ts        # NEW
│   └── meeting-average-duration-response.dto.ts     # NEW
└── tests/
    ├── meeting-average-duration.service.spec.ts
    └── meeting-average-duration.repository.spec.ts
```

**Structure Decision**: Mở rộng module `analytics` đã có. **Không** seed lại permission (`analytics.meeting.read` đã seed ở UC-AA-04). Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` và mở rộng logic bucket generation của UC-AA-04 thêm nhánh `quarter`.

## Complexity Tracking

Không vi phạm constitution. Điểm phức tạp nhất là đảm bảo population đồng bộ giữa `plannedAverageMinutes`/`actualAverageMinutes` (cùng loại bỏ record thiếu dữ liệu thực tế ở cả 2 phía) và phân biệt `null` vs `0` — đã có công thức rõ ràng trong `data-model.md`, không phải complexity ngoại lệ.

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/query-meeting-average-duration.dto.ts`, `dto/meeting-average-duration-response.dto.ts`, `services/meeting-average-duration.service.ts`, `repositories/meeting-average-duration.repository.ts`, `controllers/meeting-average-duration.controller.ts`, `tests/*.spec.ts`.

### Phase 2: Foundational

#### T-A: DTO

- `query-meeting-average-duration.dto.ts`: `@IsOptional() @IsDateString() from?`, `to?`, `@IsOptional() @IsEnum(['day','week','month','quarter']) granularity?`, `@IsOptional() @IsArray() @IsUUID('4',{each:true}) departmentIds?`, `@IsOptional() @IsUUID() roomId?`.
- `meeting-average-duration-response.dto.ts`: `AverageDurationPointDto {period, plannedAverageMinutes: number|null, actualAverageMinutes: number|null, completedMeetingCount}`, `AverageDurationSummaryDto {plannedAverageMinutes, actualAverageMinutes, completedMeetingCount}`, `MeetingAverageDurationResponseDto {period, summary, series}`.

#### T-B: Controller shell

- `meeting-average-duration.controller.ts`: `@Controller('analytics/meetings')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.meeting.read')` class-level, `@Get('average-duration')` → `service.getAverageDuration(currentUser, query)`.

#### T-C: Service shell

- `meeting-average-duration.service.ts`: inject `AuthzReadRepository`, `MeetingAverageDurationRepository`, `DashboardOverviewConfigService`. Method `getAverageDuration(currentUser, query)` — throw `NotImplementedException` tạm.

#### T-D: Module wiring

- Cập nhật `analytics.module.ts`: đăng ký controller/service/repository mới; xác nhận `TypeOrmModule.forFeature` có `MeetingEntity`, `RoomBookingEntity`, `RoomBookingUsageEntity` (đã import từ UC-AA-02).

### Phase 3: Business Logic — Date Range, Bucket, Scope

#### T-E: Resolve date range + default "Tháng hiện tại"

- Tái dùng/mở rộng `resolveDateRange` đã viết ở UC-AA-04: thiếu `from`/`to` → mặc định đầu-cuối tháng hiện tại.

#### T-F: Check maxRangeDays

- Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` → vượt → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`.

#### T-G: Generate bucket list (mở rộng thêm `quarter`)

- `generateBuckets(from, to, granularity)`: thêm nhánh `quarter` vào logic đã có ở UC-AA-04 (`day/week/month`); label `"YYYY-'Q'Q"` cho quarter.

#### T-H: Resolve scope Manager (tĩnh, tái dùng)

- `resolveScope(currentUser)`: tái dùng đúng pattern đã có ở UC-AA-01/04/05.

#### T-I: Check departmentIds ownership (multi-select, tái dùng UC-AA-05)

- Nếu MANAGER và bất kỳ phần tử nào trong `query.departmentIds` ngoài `scopeDepartmentIds` → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`.

### Phase 4: Business Logic — Aggregation

#### T-J: Repository — planned/actual/count theo bucket

- `getAverageDurationByBucket(params)` trong `meeting-average-duration.repository.ts`:
  - JOIN `meetings` (status='completed', scope + filter) INNER JOIN `room_bookings` LEFT JOIN `room_booking_usages`
  - Với mỗi record, tính `plannedMinutes` (luôn có, từ `room_bookings`) và `actualMinutes` (ưu tiên actual, fallback presence, `NULL` nếu thiếu cả 2)
  - **Loại record nếu `actualMinutes IS NULL`** khỏi TOÀN BỘ tập tính (cả planned lẫn actual) — đảm bảo population đồng bộ (data-model.md, CL-2 spec.md)
  - `GROUP BY date_trunc(granularity, start_time)`: `AVG(plannedMinutes)`, `AVG(actualMinutes)`, `COUNT(*)`
  - Raw SQL parameterized, 1 query (tránh N+1)
  - Trả `Map<bucketKey, {plannedAvg, actualAvg, count}>`

#### T-K: Repository — summary toàn kỳ

- `getAverageDurationSummary(params)`: cùng logic T-J nhưng không `GROUP BY` — trả 1 dòng tổng cho toàn `[from,to]`.

#### T-L: Build response

- `buildResponse(buckets, bucketResults, summaryResult)`: map kết quả vào từng bucket từ T-G, bucket không có dữ liệu → `plannedAverageMinutes=null, actualAverageMinutes=null, completedMeetingCount=0` (KHÔNG phải 0.0).
- `summary` tương tự — `null` nếu `completedMeetingCount=0` toàn kỳ.
- `completedMeetingCount=0` toàn kỳ → thêm `message` (EX1/EX2).

### Phase 5: Controller Wiring & Error Handling

#### T-M: Wire controller

- Thứ tự: `resolveDateRange` → `maxRangeDays` check → `resolveScope` → `departmentIds` ownership check → `generateBuckets` → `getAverageDurationByBucket` + `getAverageDurationSummary` → `buildResponse`.
- Audit log non-blocking `action_type='read_analytics_meeting_average_duration'` (gated `AUDIT_LOG_ENABLED`).
- Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

### Phase 6: Testing

#### T-N: Unit test resolveDateRange + generateBuckets (mở rộng quarter)

- Test default tháng hiện tại.
- Test `granularity=quarter` sinh đúng 4 quý/năm, label đúng định dạng, xử lý đúng biên Q1 (Jan-Mar).

#### T-O: Unit test resolveScope + departmentIds ownership (tái dùng test case UC-AA-05)

#### T-P: Unit test population & công thức (quan trọng nhất)

- Meeting `completed` có đủ `room_bookings` + `room_booking_usages` (actual) → tính đúng cả 2 giá trị.
- Meeting `completed` có `room_booking_usages` chỉ có `presence_*` (không có `actual_*`) → dùng fallback đúng.
- Meeting `completed` thiếu cả `actual_*` lẫn `presence_*` → bị loại khỏi CẢ 2 giá trị (verify population đồng bộ).
- Meeting `status IN ('scheduled','cancelled','draft','pending_approval','in_progress')` → không được tính (Phương án A).
- Bucket có 0 meeting hợp lệ → `plannedAverageMinutes=null`, `actualAverageMinutes=null`, `completedMeetingCount=0` (verify KHÔNG phải `0`).

#### T-Q: Unit test buildResponse empty state

- Toàn `[from,to]` không có dữ liệu → `summary` toàn `null`, `series` đủ bucket null, có `message`.

#### T-R: Unit test DTO validation + controller

- `granularity`/`departmentIds`/`roomId` sai format → lỗi.
- Request hợp lệ → 200 đúng cấu trúc; audit log gọi khi thành công.

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic |
|---|---|
| AC-001 | T-E, T-G, T-J, T-K, T-L |
| AC-002 | T-H |
| AC-003 | T-J (công thức planned/actual) |
| AC-004 | T-G (quarter) |
| AC-005 | T-I |
| AC-006 | T-L (null vs 0) |
| AC-007 | T-L (empty state) |
| AC-008 | T-J (chỉ status='completed') |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Population không đồng bộ giữa 2 cột nếu implement sai (chỉ loại record thiếu actual khỏi `actualAverageMinutes` mà quên loại khỏi `plannedAverageMinutes`) | So sánh sai lệch, N khác nhau giữa 2 cột — vi phạm chính mục tiêu của feature | Unit test T-P cụ thể verify cùng `completedMeetingCount` cho cả 2 giá trị trong mọi bucket |
| Nhầm `null` thành `0` (lỗi lập trình phổ biến khi `AVG()` trên tập rỗng trả `NULL` trong SQL nhưng dev có thể code default `?? 0`) | Sai ngữ nghĩa, gây hiểu lầm "trung bình 0 phút" | Unit test T-P/T-Q cụ thể assert `null` không phải `0` |
| `quarter` bucket tính sai biên | Label/nhóm sai | Unit test T-N cụ thể cho Q1 (biên năm) |
| Lệch với `API_CONTRACT` UC-153 gốc | FE code sai theo tài liệu cũ | Ghi rõ trong `contracts/meeting-average-duration-api.md`, đề xuất đồng bộ tài liệu ở task riêng |

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001, FR-002 | T-C, T-J, T-K |
| FR-003 | T-J (Phương án A) |
| FR-004, FR-016, FR-017 | T-B (guard có sẵn) |
| FR-005–FR-007 | T-E, T-G |
| FR-008–FR-011, FR-014, FR-015 | T-H, T-I, T-J |
| FR-012, FR-013, FR-031 | T-L |
| FR-018 | T-I |
| FR-019–FR-022 | T-A, T-F |
| FR-023, FR-024 | T-H, T-I |
| FR-025–FR-029 | T-G, T-J, T-K, T-L |
| FR-030 | T-M |
