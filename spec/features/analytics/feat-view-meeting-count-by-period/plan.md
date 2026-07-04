# Implementation Plan: Xem thống kê số lượng cuộc họp theo khoảng thời gian (UC-AA-04 / UC-151)

**Branch**: `019-view-meeting-count-by-period` | **Date**: 2026-07-02
**Spec**: spec/features/analytics/feat-view-meeting-count-by-period/spec.md

## Summary

Tính năng cho phép Manager (giới hạn theo phòng ban phụ trách, scope tĩnh), Business Admin, System Admin xem thống kê số lượng cuộc họp (`total`, `series` theo tuần/tháng) trong 1 khoảng thời gian tùy chọn (kể cả tương lai — AF1), lọc theo phòng ban/phòng họp/loại cuộc họp. Chỉ tính `meetings.status IN ('completed','scheduled')` (BR1 Phương án A, đã chọn). 1 endpoint duy nhất: `GET /api/v1/analytics/meetings/count-by-period` (đã có trong `API_CONTRACT` UC-151, bổ sung 2 filter `roomId`/`meetingType`). Read-only, không thêm bảng/config mới — tái dùng toàn bộ hạ tầng từ UC-AA-01 (`DashboardOverviewConfigService.getMaxRangeDays()`, pattern scope Manager tĩnh).

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT
**Storage**: PostgreSQL (read-only aggregate queries)
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 2s cho khoảng mặc định (tháng hiện tại, granularity=week)
**Constraints**: Read-only tuyệt đối; không cross-check status với start_time (BR1 Phương án A); range bị chặn bởi config đã có
**Scale**: Tối đa `analytics.dashboard_max_range_days` ngày mỗi request; bucket giới hạn tự nhiên theo range đó

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột/config key nào — tái dùng 100% từ UC-AA-01 |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('analytics.meeting.read')`; scope enforce ở service |
| **Scope Gate** | PASS | Chỉ 1 endpoint UC-151; UC-152/153/154 ngoài scope; không forecast/ML cho AF1 |
| **Module Gate** | PASS | Toàn bộ code trong `src/modules/analytics/`, tái dùng service/config đã có |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint khớp `API_CONTRACT` UC-151 (+2 field bổ sung đã ghi RECON) |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Test Gate** | PASS | Unit test cho bucket generation, filter, scope, BR1 Phương án A |

## Project Structure

### Documentation (this feature)

```text
spec/features/analytics/feat-view-meeting-count-by-period/
├── spec.md
├── plan.md              # File này
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── meeting-count-by-period-api.md
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/analytics/
├── analytics.module.ts                          # Update: đăng ký thêm controller/service/repository mới
├── controllers/
│   ├── dashboard-overview.controller.ts          # Đã có (UC-AA-01)
│   ├── room-usage-dashboard.controller.ts        # Đã có (UC-AA-02)
│   └── meeting-count-by-period.controller.ts     # NEW
├── services/
│   ├── dashboard-overview-config.service.ts      # Đã có — tái dùng getMaxRangeDays()
│   └── meeting-count-by-period.service.ts        # NEW: orchestrator — scope, validate, bucket, build response
├── repositories/
│   └── meeting-count-by-period.repository.ts     # NEW: aggregate SQL count theo bucket
├── dto/
│   ├── query-meeting-count-by-period.dto.ts      # NEW
│   └── meeting-count-by-period-response.dto.ts   # NEW
└── tests/
    ├── meeting-count-by-period.service.spec.ts
    └── meeting-count-by-period.repository.spec.ts

src/database/seeds/
└── <timestamp>-SeedAnalyticsMeetingReadPermission.ts  # NEW: seed analytics.meeting.read + gán MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN
```

**Structure Decision**: Mở rộng module `analytics` đã có, tái dùng `DashboardOverviewConfigService` nguyên trạng (không tạo config service mới vì feature này không cần config riêng nào khác ngoài `max_range_days` đã có).

## Complexity Tracking

Không vi phạm constitution. Điểm cần chú ý nhất là bucket generation (sinh đủ tuần/tháng trong `[from,to]` kể cả rỗng) — đã có công thức rõ ràng trong `data-model.md`, không phải complexity ngoại lệ.

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/query-meeting-count-by-period.dto.ts`, `dto/meeting-count-by-period-response.dto.ts`, `services/meeting-count-by-period.service.ts`, `repositories/meeting-count-by-period.repository.ts`, `controllers/meeting-count-by-period.controller.ts`, `tests/*.spec.ts` trong `src/modules/analytics/` (thư mục đã tồn tại từ UC-AA-01/02).

### Phase 2: Foundational

#### T-A: DTO

- `query-meeting-count-by-period.dto.ts`: `@IsOptional() @IsDateString() from?`, `@IsOptional() @IsDateString() to?`, `@IsOptional() @IsEnum(['week','month']) granularity?`, `@IsOptional() @IsUUID() departmentId?`, `@IsOptional() @IsUUID() roomId?`, `@IsOptional() @IsEnum(MeetingType) meetingType?`.
- `meeting-count-by-period-response.dto.ts`: `SeriesPointDto {period, count}`, `MeetingCountByPeriodResponseDto {total, series: SeriesPointDto[]}`.

#### T-B: Controller shell

- `meeting-count-by-period.controller.ts`: `@Controller('analytics/meetings')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.meeting.read')` class-level, `@Get('count-by-period')` → `service.getCountByPeriod(currentUser, query)`.

#### T-C: Service shell

- `meeting-count-by-period.service.ts`: inject `AuthzReadRepository`, `MeetingCountByPeriodRepository`, `DashboardOverviewConfigService` (tái dùng `getMaxRangeDays()`). Method `getCountByPeriod(currentUser, query)` — throw `NotImplementedException` tạm.

#### T-D: Module wiring

- Cập nhật `analytics.module.ts`: đăng ký controller/service/repository mới; đảm bảo `TypeOrmModule.forFeature` có `MeetingEntity` (đã có sẵn từ UC-AA-01, không cần thêm).

### Phase 3: Business Logic — Date Range, Bucket, Scope

#### T-E: Resolve date range + default "Tháng hiện tại"

- `resolveDateRange(query)`: thiếu `from`/`to` → mặc định đầu-cuối tháng hiện tại (timezone `Asia/Ho_Chi_Minh`). Có → validate ISO date + `from<=to`.

#### T-F: Check maxRangeDays

- Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` → vượt → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`.

#### T-G: Generate bucket list

- `generateBuckets(from, to, granularity)`: sinh mảng bucket `{periodLabel, bucketStart, bucketEnd}` theo `granularity` (tuần ISO Thứ2-CN hoặc tháng dương lịch), phủ kín `[from,to]`, label theo §0.6 (`"YYYY-'W'WW"` / `"YYYY-MM"`).

#### T-H: Resolve scope Manager (tĩnh, tái dùng UC-AA-01)

- `resolveScope(currentUser)`: tái dùng đúng logic đã có ở `DashboardOverviewService.resolveScope()` (copy/tái sử dụng qua service dùng chung nếu tách được, hoặc implement lại 1-1 nếu coupling module không cho phép reuse trực tiếp).

#### T-I: Check departmentId ownership

- Nếu MANAGER và `query.departmentId` ngoài `scopeDepartmentIds` → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`.

### Phase 4: Business Logic — Aggregation

#### T-J: Repository — count theo bucket

- `countMeetingsByBucket(params)`: với mỗi bucket từ T-G, `COUNT(meetings)` WHERE `status IN ('completed','scheduled')`, `deleted_at IS NULL`, `start_time BETWEEN bucketStart AND bucketEnd`, scope + `departmentId`/`roomId`/`meetingType` filter (đúng data-model.md).
- Có thể tối ưu bằng 1 query `GROUP BY` thay vì N query theo bucket (khuyến nghị: 1 query SELECT date_trunc theo granularity, rồi map kết quả vào bucket list ở service — tránh N+1).

#### T-K: Build response

- `buildResponse(buckets, countMap)`: map count vào từng bucket (0 nếu không có), `total = SUM(counts)`.
- Nếu `total === 0` toàn dải → thêm `message` (EX1).

### Phase 5: Controller Wiring & Error Handling

#### T-L: Wire controller

- Thứ tự: `resolveDateRange` → `maxRangeDays` check → `resolveScope` → `departmentId` ownership check → `generateBuckets` → `countMeetingsByBucket` → `buildResponse`.
- Audit log non-blocking `action_type='read_analytics_meeting_count_by_period'` (gated `AUDIT_LOG_ENABLED`).
- Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

### Phase 6: Testing

#### T-M: Unit test resolveDateRange + generateBuckets

- Test default tháng hiện tại.
- Test `granularity=week` sinh đúng số tuần ISO cho 1 khoảng cho trước.
- Test `granularity=month` sinh đúng số tháng.
- Test bucket đầu/cuối cắt đúng theo `from`/`to` (không thừa/thiếu).

#### T-N: Unit test resolveScope + departmentId ownership

- Test admin → null scope.
- Test MANAGER → đúng danh sách phòng ban (tĩnh, không đổi theo from/to — khác UC-AA-02).
- Test MANAGER 0 phòng ban → scope rỗng → response rỗng (không lỗi).
- Test `departmentId` ngoài scope → lỗi.

#### T-O: Unit test BR1 filter (Phương án A)

- Test meeting `status='completed'` (start_time bất kỳ) → được tính.
- Test meeting `status='scheduled'` (start_time bất kỳ, kể cả quá khứ) → được tính (đúng Phương án A, không cross-check).
- Test meeting `status IN ('draft','pending_approval','in_progress','cancelled')` → KHÔNG được tính.

#### T-P: Unit test filter roomId/meetingType

- Test lọc đúng theo `roomId`.
- Test lọc đúng theo `meetingType`.
- Test kết hợp cả 2 + `departmentId` cùng lúc (AND).

#### T-Q: Unit test empty state (EX1)

- Tổ hợp filter không có dữ liệu → `total=0`, `series` đủ bucket `count=0`, có `message`.
- Verify `total` luôn bằng tổng `series[].count` (NFR-005).

#### T-R: Unit test DTO validation

- `granularity`/`meetingType`/`departmentId`/`roomId` sai format → lỗi.

#### T-S: Unit test controller + seed permission

- Request hợp lệ → 200 đúng cấu trúc.
- Audit log gọi khi thành công, không gọi khi lỗi.
- Seed tạo đúng `analytics.meeting.read`, gán đúng 3 role.

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic |
|---|---|
| AC-001 | T-E, T-G, T-J, T-K |
| AC-002 | T-H |
| AC-003 | T-E (chấp nhận from/to tương lai), T-J (filter status) |
| AC-004 | T-A (DTO enum) |
| AC-005 | T-I |
| AC-006 | T-K (empty state) |
| AC-007 | T-J (BR1 filter) |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| N+1 query nếu count từng bucket riêng lẻ | Chậm với range dài + granularity=week | T-J dùng 1 query `GROUP BY date_trunc` thay vì N query |
| Sai lệch tuần ISO nếu không xử lý đúng biên năm (tuần cuối/đầu năm) | Label period sai | Unit test T-M cụ thể với range chạm qua năm mới |
| BR1 Phương án A đếm nhầm `scheduled` quá hạn | Số liệu lệch nhẹ so với kỳ vọng thực tế | Đã chấp nhận theo quyết định người dùng; ghi CL-2 trong spec |

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001, FR-002 | T-C, T-J |
| FR-003 | T-J (BR1 Phương án A) |
| FR-004, FR-017 | T-B (guard có sẵn) |
| FR-005–FR-008 | T-E, T-G |
| FR-009–FR-011, FR-015 | T-H, T-I |
| FR-012, FR-013, FR-016 | T-J |
| FR-014, FR-031 | T-K |
| FR-018 | Guard có sẵn |
| FR-019 | T-I |
| FR-020–FR-023 | T-A |
| FR-024, FR-032, NFR-002 | T-F |
| FR-025, FR-026 | T-H |
| FR-027–FR-029 | T-G, T-J, T-K |
| FR-030 | T-L |
