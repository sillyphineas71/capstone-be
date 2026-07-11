# Implementation Plan: Xem lịch sử sử dụng phòng họp theo khoảng thời gian (UC-RUM-04)

**Branch**: `028-view-room-usage-history` | **Date**: 2026-07-09
**Spec**: spec/features/analytics/feat-view-room-usage-history/spec.md

## Summary

Bổ sung 1 endpoint mới `GET /api/v1/analytics/rooms/usage-history` trong module `analytics`, cung cấp danh sách phẳng, đa phòng, mỗi dòng = 1 phiên sử dụng phòng (`sessionStatus`: completed/no_show/cancelled_late/cancelled/early_empty/released/not_started/in_progress/pending_evaluation), có phân trang + sort, kèm Summary 5 chỉ số (`totalReservedHours`, `totalActualHours`, `noShowCount`, `reservationUtilizationRate`, `roomOccupancyRate`). Tái dùng toàn bộ logic resolve preset/from/to, `DATE_RANGE_TOO_LARGE` guard, và scope Manager-theo-kỳ-lọc đã có ở `RoomUsageDashboardService` (UC-AA-02) — không viết lại. Read-only, không thêm bảng, chỉ thêm 1 config key `analytics.late_cancellation_threshold_minutes`. AF1 (export) ngoài phạm vi — đề xuất feature riêng `feat-export-room-usage-report` (implement UC-49).

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT
**Storage**: PostgreSQL (raw parameterized SQL cho danh sách phân trang + aggregate summary độc lập)
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 3s cho `limit ≤ 100`, khoảng thời gian mặc định (tháng hiện tại)
**Constraints**: Read-only tuyệt đối; scope Manager tính lại theo đúng `from/to` mỗi request (tái dùng, không cache); range bị chặn nếu vượt `analytics.dashboard_max_range_days`; `summary` KHÔNG bị giới hạn bởi `page/limit` (tính trên toàn bộ tập kết quả)
**Scale**: Tối đa `analytics.dashboard_max_range_days` ngày mỗi request; `limit` tối đa 100/trang

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột; 1 key `system_configs` mới (`analytics.late_cancellation_threshold_minutes`) |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('analytics.room.read')` (permission đã seed sẵn từ UC-AA-02, không seed lại); scope Manager enforce ở service |
| **Scope Gate** | PASS | Chỉ 1 endpoint đọc của UC-RUM-04; UC-49 (export) ngoài phạm vi, đề xuất feature riêng; không đụng module `reports`/`rooms` |
| **Module Gate** | PASS | Toàn bộ code trong `src/modules/analytics/`; tái dùng `RoomUsageDashboardService` bằng dependency injection, không copy code |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint mới hoàn toàn (không có trong `API_CONTRACT` gốc) — cần task đồng bộ tài liệu |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Test Gate** | PASS | Unit test cho derive `sessionStatus`, summary tách biệt phân trang, sort, validation |

## Project Structure

### Documentation (this feature)

```text
spec/features/analytics/feat-view-room-usage-history/
├── spec.md
├── plan.md              # File này
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/analytics/
├── analytics.module.ts                         # Update: đăng ký controller/service/repository mới
├── controllers/
│   └── room-usage-history.controller.ts        # NEW: GET /analytics/rooms/usage-history
├── services/
│   ├── room-usage-dashboard.service.ts          # Đã có — tái dùng resolveScope()/resolveDateRange() qua injection
│   ├── room-usage-history.service.ts             # NEW: orchestrator — derive sessionStatus, build summary + danh sách
│   └── room-usage-history-config.service.ts      # NEW: đọc analytics.late_cancellation_threshold_minutes
├── repositories/
│   └── room-usage-history.repository.ts          # NEW: query danh sách phân trang + query summary aggregate (2 query riêng)
├── dto/
│   ├── query-room-usage-history.dto.ts            # NEW: preset/from/to/roomId/siteName/areaName/sortBy/sortOrder/page/limit
│   └── room-usage-history-response.dto.ts         # NEW: response shape
└── tests/
    ├── room-usage-history.service.spec.ts
    └── room-usage-history.repository.spec.ts

src/database/seeds/
└── (không cần seed mới — tái dùng permission `analytics.room.read` đã seed ở UC-AA-02)
```

**Structure Decision**: Mở rộng module `analytics` đã có, tái dùng `RoomUsageDashboardService.resolveScope()` và `DashboardOverviewConfigService.getMaxRangeDays()` qua dependency injection (không copy-paste logic sang service mới). Tách `RoomUsageHistoryRepository` riêng khỏi `RoomUsageDashboardRepository` vì hình dạng query khác hẳn (danh sách phân trang + derive trạng thái theo dòng, thay vì aggregate theo phòng).

## Complexity Tracking

Điểm phức tạp nhất là derive `sessionStatus` (§0.2, FR-DATA-002 trong spec.md) — kết hợp 3 nguồn (`room_bookings.status`, `room_booking_usages.usageStatus`, ngưỡng thời gian hủy sát giờ) theo đúng thứ tự ưu tiên đã chốt. Điểm phức tạp thứ hai là tách `summary` (tính trên toàn bộ tập kết quả) khỏi `sessions[]` (đã phân trang) — cần 2 query độc lập, không được tính summary chỉ trên trang hiện tại (NFR-005). Không vi phạm constitution, không cần complexity exception.

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/query-room-usage-history.dto.ts`, `dto/room-usage-history-response.dto.ts`, `services/room-usage-history-config.service.ts`, `services/room-usage-history.service.ts`, `repositories/room-usage-history.repository.ts`, `controllers/room-usage-history.controller.ts`, `tests/room-usage-history.*.spec.ts` trong `src/modules/analytics/` (thư mục đã tồn tại từ UC-AA-01/UC-AA-02).

### Phase 2: Foundational

#### T-A: DTO

- `query-room-usage-history.dto.ts`: `preset?, from?, to?, roomId?, siteName?, areaName? (max 150), sortBy? ('reservedStartTime'|'sessionStatus'), sortOrder? ('asc'|'desc'), page? (min 1), limit? (min 1, max 100)`.
- `room-usage-history-response.dto.ts`: `RoomUsageHistorySummaryDto`, `RoomUsageSessionDto`, `RoomUsageHistoryResponseDto` (gồm `period`, `summary`, `sessions[]`), pagination `meta`.

#### T-B: Config service

- `room-usage-history-config.service.ts`: `getLateCancellationThresholdMinutes(): Promise<number>` — precedence `system_configs['analytics.late_cancellation_threshold_minutes'] → env ANALYTICS_LATE_CANCELLATION_THRESHOLD_MINUTES → default 60`. Mirror `RoomUsageConfigService` (UC-AA-02).

#### T-C: Controller shell

- `room-usage-history.controller.ts`: `@Controller('analytics/rooms')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.room.read')`.
  - `@Get('usage-history') getHistory(@Query() query: QueryRoomUsageHistoryDto, @CurrentUser() currentUser)`.

#### T-D: Service shell

- `room-usage-history.service.ts`: inject `RoomUsageDashboardService` (tái dùng `resolveScope`), `DashboardOverviewConfigService` (tái dùng `getMaxRangeDays`), `RoomUsageHistoryConfigService`, `RoomUsageHistoryRepository`. Method `getUsageHistory(currentUser, query)` — throw `NotImplementedException` tạm.

#### T-E: Module wiring

- Cập nhật `analytics.module.ts`: thêm controller/service/repository/config service mới; đảm bảo `RoomUsageDashboardService` được export từ module (hoặc cùng module nên không cần export riêng) để service mới inject được.

### Phase 3: Business Logic — Date Range, Scope, Validation

#### T-F: Resolve date range + scope (tái dùng)

- Gọi `RoomUsageDashboardService.resolveDateRange(query)` (nếu chưa public, đổi visibility từ private/implicit sang `public` — không đổi logic) và `RoomUsageDashboardService.resolveScope(userId, from, to)` — không viết lại.
- Gọi `DashboardOverviewConfigService.getMaxRangeDays()` → nếu vượt, `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})` với message động theo giá trị config thật.

#### T-G: Validate sortBy/sortOrder/page/limit

- `sortBy` ngoài enum → `VALIDATION_ERROR`. `page<1`/`limit<1`/`limit>100` → `VALIDATION_ERROR`.

### Phase 4: Business Logic — Query & Derive Status

#### T-H: Repository — query danh sách phân trang

- `listSessions(params)`: JOIN `room_bookings` + `meetings` + `users` (host/organizer) + `rooms` + LEFT JOIN `room_booking_usages` (theo `booking_id`), áp scope + filter (`roomId`/`siteName`/`areaName`), sort theo `sortBy`/`sortOrder`, `LIMIT/OFFSET` theo `page`/`limit`. Trả raw rows đủ field để service derive `sessionStatus`.
- **Không loại `status=cancelled`** khỏi query (khác `RoomUsageDashboardRepository` của UC-AA-02).

#### T-I: Repository — query summary (độc lập, không phân trang)

- `getSummaryAggregate(params)`: cùng scope + filter (không `LIMIT/OFFSET`), trả `{totalReservedMinutes, totalActualMinutes, hasActualData, statusCounts: Record<string, number>}` — đủ để service tính `noShowCount` và 2 rate.

#### T-J: Service — derive `sessionStatus` theo từng dòng

- `deriveSessionStatus(row, lateCancellationThresholdMinutes, now)`: implement đúng bảng quyết định §0.2/FR-DATA-002 của spec.md (thứ tự: cancelled → usageStatus map → pending_evaluation → not_started).
- Dùng `room_bookings.updated_at` làm proxy `cancelledAt` (CL-1 đã ghi trong spec).

#### T-K: Service — build response

- `sessions[]` = map raw rows qua T-J.
- `summary` = build từ T-I (`reservationUtilizationRate`/`roomOccupancyRate` theo đúng công thức UC-AA-02, `noShowCount` từ `statusCounts['no_show']`).
- Nếu `resolvedScopeRoomIds = []` (MANAGER không có phòng) hoặc không có `room_bookings` nào khớp → `sessions=[]`, `summary` toàn 0/null, `message` theo E1 (build động với `from`/`to`).

### Phase 5: Controller Wiring & Error Handling

#### T-L: Wire handler

- Thứ tự: `resolveDateRange` → check `maxRangeDays` → `resolveScope` → validate sort/pagination → query song song (T-H, T-I) → derive (T-J) → build response (T-K).
- Audit log non-blocking sau khi thành công (gated `AUDIT_LOG_ENABLED`), `action_type='read_analytics_room_usage_history'`.
- Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

### Phase 6: Testing

#### T-M: Unit test derive `sessionStatus`

- Test đủ 9 nhánh: `completed`, `no_show`, `early_empty`, `released`, `cancelled_late` (trong ngưỡng), `cancelled` (ngoài ngưỡng), `cancelled_late` (hủy sau giờ bắt đầu), `pending_evaluation`, `not_started`/`in_progress`.

#### T-N: Unit test summary tách biệt phân trang

- Test `summary.noShowCount`/`totalReservedHours` tính trên TOÀN BỘ tập kết quả dù `limit=1`/`page=5`.

#### T-O: Unit test sort + pagination

- Test `sortBy=sessionStatus`, `sortOrder=asc`, `page=2&limit=10` trả đúng offset.

#### T-P: Unit test empty state (E1) + scope rỗng (BR1)

- Test không có `room_bookings` nào → `sessions=[]` + message đúng E1.
- Test MANAGER scope rỗng → `sessions=[]`, không lỗi.

#### T-Q: Unit test validation/authorization

- 401/403 `PERMISSION_DENIED`/400 `VALIDATION_ERROR` (preset, sortBy, page, limit)/400 `DATE_RANGE_TOO_LARGE`.

#### T-R: Unit test config service

- Precedence `system_configs → env → default 60`.

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic | Verification |
|---|---|---|
| AC-001 | T-F, T-H, T-K | Unit: Business Admin default month, page 1 |
| AC-002 | T-F (resolveScope tái dùng), T-H | Unit: Manager scope theo kỳ |
| AC-003 | T-J, T-B | Unit: cancelled_late trong ngưỡng |
| AC-004 | T-J, T-I | Unit: no_show + noShowCount |
| AC-005 | T-A (DTO validation) | Unit: custom thiếu to |
| AC-006 | T-F | Unit: DATE_RANGE_TOO_LARGE |
| AC-007 | T-G | Unit: sortBy invalid |
| AC-008 | T-F, T-K | Unit: scope rỗng |
| AC-009 | T-K | Unit: empty state E1 |
| AC-010 | T-H | Unit: sort theo sessionStatus |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `room_bookings.updated_at` không phải timestamp hủy chính danh (CL-1) | `cancelled_late` có thể sai lệch nếu booking bị update vì lý do khác sau khi hủy | Ghi rõ giả định trong spec; unit test dùng dữ liệu giả lập rõ ràng; không claim độ chính xác tuyệt đối |
| `summary` và `sessions[]` tính lệch nhau nếu code vô tình dùng chung query đã `LIMIT` | Số liệu tổng quan sai, gây hiểu nhầm nghiêm trọng cho Manager | 2 query độc lập (T-H, T-I) — test riêng T-N để chốt hành vi |
| Derive `sessionStatus` ở tầng service (không SQL) có thể chậm nếu `limit` lớn | Tăng latency | `limit` tối đa 100/trang — khối lượng derive nhỏ, không cần tối ưu SQL-side |
| UC-49 export (A1) chưa tồn tại — người dùng có thể mong đợi nút Export hoạt động ngay | Kỳ vọng sai từ FE | Ghi rõ OOS-001; đề xuất `feat-export-room-usage-report` riêng trong §0.5/§8 của spec.md |

## Requirements Coverage

| Requirement ID | Task(s) | Description |
|---|---|---|
| FR-001–FR-003 | T-D, T-F | Read-only, tái dùng logic UC-AA-02 |
| FR-004, FR-017, FR-018 | T-C (guard có sẵn) | AuthN/AuthZ |
| FR-005–FR-007 | T-F | preset/from/to (tái dùng) |
| FR-008, FR-009, FR-015, FR-016 | T-H | roomId/siteName/areaName filter |
| FR-010–FR-012 | T-A, T-H | sort + pagination |
| FR-013, FR-014, FR-035 | T-K | E1, scope rỗng |
| FR-019–FR-024 | T-A, T-F, T-G | Validation + max range |
| FR-025, FR-026 | T-F | Enforce scope |
| FR-027, FR-033 | T-H, T-K | Cột danh sách, hostName fallback |
| FR-028, FR-DATA-002 | T-J | Derive sessionStatus |
| FR-029–FR-032 | T-I, T-K | Summary 5 chỉ số |
| FR-034 | T-L | Audit log |
| FR-DATA-003 | T-B | Config precedence |
| NFR-001, NFR-006 | T-H, T-I (index sẵn có) | Performance |
| NFR-005 | T-I, T-K | Summary tách biệt phân trang |
