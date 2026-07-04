# Implementation Plan: Xem dashboard sử dụng phòng họp (UC-AA-02 / UC-149)

**Branch**: `018-view-room-usage-dashboard` | **Date**: 2026-07-02
**Spec**: spec/features/analytics/feat-view-room-usage-dashboard/spec.md

## Summary

Tính năng cho phép Manager (giới hạn theo phòng ban phụ trách, scope phụ thuộc kỳ lọc), Business Admin, System Admin so sánh 4 chỉ số (`bookedHours`, `actualHours`, `reservationUtilizationRate`, `roomOccupancyRate`) giữa các phòng họp, và xem chi tiết 1 phòng (heatmap khung giờ cao điểm + danh sách meeting). 2 endpoint mới: `GET /api/v1/analytics/rooms/dashboard` (so sánh tổng quan, đã có trong `API_CONTRACT` UC-149) và `GET /api/v1/analytics/rooms/{roomId}/detail` (drill-down, bổ sung mới). Read-only, không thêm bảng, chỉ thêm 1 config key `analytics.room_operating_hours_per_day`. AF1 (export .xlsx) tái dùng UC-49 có sẵn ở module `reports`, không code trong feature này.

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT
**Storage**: PostgreSQL (read-only aggregate queries, raw parameterized SQL cho scope theo kỳ lọc + heatmap)
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 3s cho so sánh tổng quan (≤ 50 phòng, tháng hiện tại), < 2s cho chi tiết 1 phòng
**Constraints**: Read-only tuyệt đối; scope phòng Manager tính lại theo đúng `from/to` mỗi request (không cache); range bị chặn nếu vượt `analytics.dashboard_max_range_days`
**Scale**: Tối đa `analytics.dashboard_max_range_days` ngày mỗi request; heatmap giới hạn 24 bucket cố định

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột; 1 key `system_configs` mới (`analytics.room_operating_hours_per_day`) |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('analytics.room.read')`; scope Manager enforce ở service |
| **Scope Gate** | PASS | Chỉ 2 endpoint của UC-AA-02; UC-49 (export) tái dùng nguyên trạng, không viết lại; UC-148/150/151 ngoài scope |
| **Module Gate** | PASS | Toàn bộ code trong `src/modules/analytics/`; không sửa module `reports`/`rooms` |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint so sánh khớp `API_CONTRACT` UC-149 (+ field đổi tên đã ghi RECON); endpoint chi tiết là bổ sung mới đã ghi rõ |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Test Gate** | PASS | Unit test cho scope theo kỳ lọc, từng công thức KPI, heatmap phân bổ phút, validation |

## Project Structure

### Documentation (this feature)

```text
spec/features/analytics/feat-view-room-usage-dashboard/
├── spec.md
├── plan.md              # File này
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── room-usage-dashboard-api.md
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/analytics/
├── analytics.module.ts                        # Update: đăng ký thêm controller/service/repository mới
├── controllers/
│   ├── dashboard-overview.controller.ts        # Đã có (UC-AA-01)
│   └── room-usage-dashboard.controller.ts      # NEW: 2 endpoint GET rooms/dashboard + rooms/:roomId/detail
├── services/
│   ├── dashboard-overview.service.ts           # Đã có
│   ├── dashboard-overview-config.service.ts    # Đã có — tái dùng getMaxRangeDays()
│   ├── room-usage-dashboard.service.ts         # NEW: orchestrator — scope theo kỳ lọc, validate, build response
│   └── room-usage-config.service.ts            # NEW: đọc analytics.room_operating_hours_per_day
├── repositories/
│   ├── dashboard-overview.repository.ts        # Đã có
│   └── room-usage-dashboard.repository.ts      # NEW: aggregate SQL cho bookedHours/actualHours/heatmap/meetings list
├── dto/
│   ├── query-room-usage-dashboard.dto.ts       # NEW: preset/from/to/roomId/siteName
│   ├── query-room-detail.dto.ts                # NEW: preset/from/to (path roomId riêng)
│   └── room-usage-response.dto.ts              # NEW: response shape cả 2 endpoint
└── tests/
    ├── room-usage-dashboard.service.spec.ts
    └── room-usage-dashboard.repository.spec.ts

src/database/seeds/
└── <timestamp>-SeedAnalyticsRoomReadPermission.ts  # NEW: seed permission analytics.room.read + gán MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN
```

**Structure Decision**: Mở rộng module `analytics` đã có từ UC-AA-01, tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` (không tạo lại config `max_range_days`), thêm 1 config service riêng cho `operating_hours_per_day` (không gộp chung để giữ single-responsibility per key, đúng pattern `no_show.*` đã tách nhiều key riêng ở feature khác).

## Complexity Tracking

Không vi phạm constitution. Điểm phức tạp nhất là scope Manager phụ thuộc kỳ lọc (khác UC-AA-01) và phân bổ phút heatmap theo chồng lấn giờ — cả hai đã có công thức rõ ràng trong `data-model.md`, không phải "complexity" cần justification ngoại lệ.

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/query-room-usage-dashboard.dto.ts`, `dto/query-room-detail.dto.ts`, `dto/room-usage-response.dto.ts`, `services/room-usage-config.service.ts`, `services/room-usage-dashboard.service.ts`, `repositories/room-usage-dashboard.repository.ts`, `controllers/room-usage-dashboard.controller.ts`, `tests/room-usage-dashboard.*.spec.ts` trong `src/modules/analytics/` (các thư mục `dto/services/repositories/controllers/tests` đã tồn tại từ UC-AA-01, chỉ thêm file mới).

### Phase 2: Foundational

#### T-A: DTO

- `query-room-usage-dashboard.dto.ts`: `preset?: 'day'|'week'|'month'|'custom'`, `from?: string`, `to?: string`, `roomId?: string (UUID)`, `siteName?: string (max 150)`.
- `query-room-detail.dto.ts`: `preset?`, `from?`, `to?` (không có `roomId`/`siteName` — `roomId` là path param).
- `room-usage-response.dto.ts`: `RoomUsageSummaryDto`, `RoomComparisonItemDto` (gồm `hasActualData: boolean`, `actualHours: number|null`, `roomOccupancyRate: number|null`), `RoomUsageDashboardResponseDto`, `HeatmapBucketDto`, `RoomDetailMeetingDto`, `RoomDetailResponseDto`.

#### T-B: Config service

- `room-usage-config.service.ts`: `getOperatingHoursPerDay(): Promise<number>` — precedence `system_configs['analytics.room_operating_hours_per_day'] → env ANALYTICS_ROOM_OPERATING_HOURS_PER_DAY → default 8`. Mirror `dashboard-overview-config.service.ts` đã có.

#### T-C: Controller shell

- `room-usage-dashboard.controller.ts`: `@Controller('analytics/rooms')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.room.read')` class-level.
  - `@Get('dashboard')` → `service.getComparisonDashboard(currentUser, query)`
  - `@Get(':roomId/detail')` → `service.getRoomDetail(currentUser, roomId, query)` (`roomId` qua `ParseUUIDPipe`)

#### T-D: Service shell

- `room-usage-dashboard.service.ts`: 2 method signature, throw `NotImplementedException` tạm.

#### T-E: Module wiring

- Cập nhật `analytics.module.ts`: thêm controller/service/repository/config service mới vào `controllers`/`providers`; đảm bảo đã import `TypeOrmModule.forFeature` cho `RoomEntity`, `RoomBookingEntity`, `RoomBookingUsageEntity` (thêm nếu UC-AA-01 chưa import).

### Phase 3: Business Logic — Scope theo kỳ lọc & Validation

#### T-F: Resolve date range (tái dùng resolveDateRange pattern, thêm preset)

- `resolveDateRange(query)`: nếu `preset` không phải `custom` → tự tính `from/to` theo `preset` (`day`=hôm nay, `week`=Thứ 2-Chủ nhật tuần hiện tại, `month`=đầu-cuối tháng hiện tại), timezone `Asia/Ho_Chi_Minh`. Nếu `preset='custom'` → bắt buộc có `from`/`to` hợp lệ, `from<=to`. Nếu thiếu `preset` → mặc định `month`.

#### T-G: Check maxRangeDays

- Gọi `DashboardOverviewConfigService.getMaxRangeDays()` (tái dùng nguyên service từ UC-AA-01) → nếu vượt, `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`.

#### T-H: Resolve scope phòng theo kỳ lọc

- `resolveRoomScope(currentUser, from, to)`: nếu admin → `null`. Nếu MANAGER → raw SQL (data-model.md §Scope resolution) trả `resolvedScopeRoomIds: string[]`.

#### T-I: Check roomId ownership (endpoint chi tiết)

- Nếu MANAGER và `roomId NOT IN resolvedScopeRoomIds` → `ForbiddenException({code:'ROOM_OUT_OF_SCOPE'})`.
- Nếu `roomId` không tồn tại/soft-deleted → `NotFoundException({code:'ROOM_NOT_FOUND'})` (check trước ownership hay sau? — check tồn tại trước, ownership sau, để không lộ thông tin phòng có tồn tại hay không qua sự khác biệt 403/404 một cách nhất quán với pattern 404-trước đã dùng ở `attendance` feature).

### Phase 4: Business Logic — Aggregation

#### T-J: Repository — so sánh tổng quan

- `getRoomsComparison(params)`: JOIN `rooms` (is_active=true) LEFT JOIN `room_bookings` (trong scope+kỳ, status hợp lệ) LEFT JOIN `room_booking_usages` → trả về mảng thô mỗi phòng `{roomId, roomName, bookedMinutesSum, actualMinutesSum, hasActualData}`.
- Áp filter `roomId`/`siteName` nếu có (T-A).

#### T-K: Repository — heatmap + meetings list (chi tiết phòng)

- `getRoomBookedMinutes(roomId, from, to)`, `getRoomActualAggregate(roomId, from, to)` (tái dùng logic T-J nhưng scope 1 phòng).
- `getRoomHeatmap(roomId, from, to)`: lấy toàn bộ `room_booking_usages` có actual/presence hợp lệ của phòng trong kỳ, với mỗi record tính overlap phút với từng giờ đồng hồ 0-23 (lặp qua từng ngày record đó chạm tới), cộng dồn vào mảng 24 phần tử. Có thể tính ở tầng SQL (`generate_series` + `LEAST/GREATEST` overlap) hoặc tính ở tầng service sau khi lấy raw rows — chọn tính ở **service** (dễ test, dễ đọc, khối lượng dữ liệu 1 phòng/1 kỳ không lớn) thay vì SQL phức tạp.
- `getRoomMeetingsList(roomId, from, to)`: JOIN `room_bookings` + `meetings` + `users` (organizer name) + `room_booking_usages` (actual times), trả `meetingId, title, organizerName, reservedStartTime, reservedEndTime, actualStartTime, actualEndTime, status`.

#### T-L: Build response — so sánh tổng quan

- Tính `reservationUtilizationRate`/`roomOccupancyRate` mỗi phòng theo `data-model.md`; tính `summary` = trung bình/tổng trên tập phòng trả về.
- Nếu `resolvedScopeRoomIds = []` (MANAGER không có phòng) → trả `rooms=[]`, `summary` toàn 0, không lỗi.

#### T-M: Build response — chi tiết phòng

- Gộp `room` info (`RoomEntity` cơ bản), 4 chỉ số, `heatmap`, `meetings` thành `RoomDetailResponseDto`.

### Phase 5: Controller Wiring & Error Handling

#### T-N: Wire cả 2 handler

- Thứ tự: `resolveDateRange` → check `maxRangeDays` → `resolveRoomScope` → (endpoint chi tiết: check tồn tại phòng → check ownership) → aggregate → build response.
- Audit log non-blocking sau khi thành công (gated `AUDIT_LOG_ENABLED`), `action_type` khác nhau cho 2 endpoint (`read_analytics_room_dashboard` / `read_analytics_room_detail`).
- Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

### Phase 6: Testing

#### T-O: Unit test resolveDateRange + preset

- Test 4 preset (day/week/month/custom) tính đúng range theo timezone.
- Test thiếu preset → mặc định month.
- Test custom thiếu from/to → lỗi.

#### T-P: Unit test resolveRoomScope

- Test admin → null.
- Test MANAGER có phòng trong kỳ này nhưng không có ở kỳ khác (scope thay đổi theo `from/to`).
- Test MANAGER 0 phòng → `[]`.

#### T-Q: Unit test công thức KPI + heatmap

- Test `bookedHours`/`actualHours`/`reservationUtilizationRate`/`roomOccupancyRate` đúng công thức, mẫu số 0 → 0.
- Test `hasActualData=false` khi không có actual/presence → `actualHours=null`, `roomOccupancyRate=null`.
- Test heatmap: 1 record 9:30-11:15 → bucket 9=30, bucket 10=60, bucket 11=15 (đúng ví dụ trong data-model.md).
- Test heatmap: nhiều ngày trong kỳ cộng dồn đúng vào cùng bucket giờ.

#### T-R: Unit test authorization/error

- 401/403 PERMISSION_DENIED/403 ROOM_OUT_OF_SCOPE/404 ROOM_NOT_FOUND đúng thứ tự check (T-I).

#### T-S: Unit test seed permission

- Test seed tạo đúng `analytics.room.read`, gán đúng 3 role.

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic | Verification |
|---|---|---|
| AC-001 | T-F, T-J, T-L | Unit: Business Admin default month |
| AC-002 | T-H, T-J | Unit: Manager scope theo kỳ |
| AC-003 | T-K, T-M | Unit: chi tiết phòng đầy đủ heatmap+meetings |
| AC-004 | T-I | Unit: ROOM_OUT_OF_SCOPE |
| AC-005 | T-F (DTO) | Unit: custom thiếu to |
| AC-006 | T-J, T-L | Unit: hasActualData=false |
| AC-007 | T-H, T-L | Unit: scope rỗng |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Scope theo kỳ lọc làm tăng độ phức tạp query (không cache scope như UC-AA-01) | Query chậm hơn nếu nhiều booking | Index sẵn có trên `room_bookings(room_id, reserved_start_time, reserved_end_time)` đủ dùng; không cần thêm index mới |
| Tính heatmap sai nếu không xử lý overlap qua nhiều ngày đúng cách | Sai lệch dữ liệu hiển thị | Unit test T-Q cụ thể với record chồng lấn nhiều giờ + nhiều ngày |
| `reservationUtilizationRate` có thể vượt 100% (nhiều booking chồng lấn hơn giờ hành chính giả định) | Gây khó hiểu cho người xem | Không chặn giá trị — đúng phản ánh dữ liệu thật; ghi chú trong tooltip là việc của FE, không phải BE |
| Endpoint `{roomId}/detail` không có trong `API_CONTRACT` gốc | FE có thể chưa biết field/API mới | Ghi rõ trong `contracts/room-usage-dashboard-api.md`; đề xuất đồng bộ tài liệu ở task riêng |

## Requirements Coverage

| Requirement ID | Task(s) | Description |
|---|---|---|
| FR-001, FR-002 | T-D, T-J, T-K | Read-only, on-demand |
| FR-003, FR-DATA-001 | T-H | Scope theo kỳ lọc |
| FR-004, FR-010, FR-017 | T-C (guard có sẵn) | AuthN |
| FR-005–FR-007 | T-F | preset/from/to |
| FR-008, FR-009, FR-015, FR-016 | T-J | roomId/siteName filter |
| FR-011, FR-024, ERR-008 | T-I | ROOM_OUT_OF_SCOPE |
| FR-012 | T-M | Response chi tiết đầy đủ |
| FR-013, FR-014, FR-035 | T-L | EX1, scope rỗng |
| FR-018–FR-023 | T-A, T-G, T-I | Validation + max range + not found |
| FR-025, FR-026 | T-H, T-I | Enforce scope ở service |
| FR-027–FR-030 | T-J, T-L, T-M, T-DATA-002 | Công thức KPI |
| FR-031 | T-K | Heatmap phân bổ phút |
| FR-032 | T-K | Danh sách meeting |
| FR-033 | T-L | Summary admin |
| FR-034 | T-N | Audit log |
| NFR-001, NFR-002 | T-J, T-K (index + giới hạn scope) | Performance |
