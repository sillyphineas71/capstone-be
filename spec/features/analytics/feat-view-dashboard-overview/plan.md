# Implementation Plan: Xem dashboard tổng quan hệ thống (UC-AA-01 / UC-148)

**Branch**: `017-view-dashboard-overview` | **Date**: 2026-07-02
**Spec**: spec/features/analytics/feat-view-dashboard-overview/spec.md

## Summary

Tính năng cho phép Manager (giới hạn theo phòng ban phụ trách), Business Admin, System Admin xem dashboard tổng quan read-only gồm 8 KPI (`meetingCount`, `activeRooms`, `utilizationRate`, `noShowRate`, `onTimeRate`, `recordingCount`, `activeUserCount`) và trend theo ngày. Toàn bộ số liệu được tính lại (on-demand aggregation) từ các bảng nguồn đã tồn tại (`meetings`, `room_bookings`, `room_booking_usages`, `no_show_cases`, `attendance_records`, `meeting_participants`, `recording_sessions`) — không thêm bảng, không cache/materialized view. API mới: `GET /api/v1/analytics/dashboard/overview`.

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT
**Storage**: PostgreSQL (read-only aggregate queries, parameterized raw SQL cho phần group-by phức tạp)
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 3s cho range mặc định 30 ngày, hỗ trợ tối thiểu 20 request đồng thời
**Constraints**: Read-only tuyệt đối, không mutation, department scope enforce ở service layer (không chỉ ở FE), range bị chặn nếu vượt `analytics.dashboard_max_range_days`
**Scale**: Tối đa `analytics.dashboard_max_range_days` (mặc định 366) ngày dữ liệu mỗi request

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột; chỉ dùng 1 key `system_configs` mới (`analytics.dashboard_max_range_days`), đúng bảng đã có |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('analytics.overview.read')`; department scope enforce ở service, không chỉ FE |
| **Scope Gate** | PASS | Chỉ implement UC-148 (dashboard overview); UC-149/150/151 và WebSocket invalidate để ngoài scope (xem spec §8) |
| **Module Gate** | PASS | Toàn bộ code nằm trong `src/modules/analytics/`; không sửa module khác (không thêm WebSocket emit ở `live-meeting`/`rooms`/`attendance`) |
| **API Gate** | PASS | Response format `{success,message,data,meta}`; endpoint đúng path/permission trong `API_CONTRACT` UC-148 (+ field bổ sung đã ghi rõ RECON) |
| **Auth Gate** | PASS | `JwtAuthGuard` bắt buộc; `userId` lấy từ `CurrentUser()` (JWT payload), không nhận từ query/body |
| **Test Gate** | PASS | Unit test cho từng công thức KPI + scope resolution + validation DTO |

## Project Structure

### Documentation (this feature)

```text
spec/features/analytics/feat-view-dashboard-overview/
├── spec.md              # Feature spec (có sẵn)
├── plan.md              # File này
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── dashboard-overview-api.md
└── tasks.md              # Phase 2 output
```

### Source Code (repository root)

```text
src/modules/analytics/
├── analytics.module.ts               # Update: đăng ký controller + service + import module phụ thuộc
├── controllers/
│   └── dashboard-overview.controller.ts   # NEW: GET /analytics/dashboard/overview
├── services/
│   ├── dashboard-overview.service.ts      # NEW: orchestrator — scope, validate, gọi repository, build response
│   └── dashboard-overview-config.service.ts # NEW: đọc analytics.dashboard_max_range_days (precedence system_configs -> env -> default)
├── repositories/
│   └── dashboard-overview.repository.ts   # NEW: raw parameterized SQL aggregate cho từng KPI + trend
├── dto/
│   ├── query-dashboard-overview.dto.ts    # NEW: from/to/departmentId/roomId + validation
│   └── dashboard-overview-response.dto.ts # NEW: response shape
└── tests/
    ├── dashboard-overview.service.spec.ts
    └── dashboard-overview.repository.spec.ts

src/database/seeds/
└── <timestamp>-SeedAnalyticsOverviewPermission.ts  # NEW: seed permission analytics.overview.read + gán cho role MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN

src/modules/administration/entities/
└── system-config.entity.ts            # Không đổi — chỉ thêm 1 row config_key mới qua seed, không sửa entity
```

**Structure Decision**: Modular monolith hiện có — toàn bộ nằm trong `src/modules/analytics/` (module đã tồn tại, hiện rỗng). Không tạo module mới, không import chéo vào `live-meeting`/`rooms`/`attendance` để tránh vi phạm module boundary (chỉ SELECT qua TypeORM `DataSource`/repository injected theo entity, giống pattern `meetings.service.ts` đã dùng cross-module SELECT).

## Complexity Tracking

Không vi phạm constitution. Feature read-only, không cần migration schema, chỉ thêm 1 config key vào bảng `system_configs` đã tồn tại (dữ liệu, không phải schema change).

## Implementation Phases

### Phase 1: Setup

- Tạo `controllers/`, `services/`, `repositories/`, `dto/`, `tests/` trong `src/modules/analytics/` (module đã tồn tại nhưng rỗng, chưa có các thư mục con).

### Phase 2: Foundational

#### T-A: DTO

- `query-dashboard-overview.dto.ts`:
  - `@IsOptional() @IsDateString() from`
  - `@IsOptional() @IsDateString() to`
  - `@IsOptional() @IsUUID() departmentId`
  - `@IsOptional() @IsUUID() roomId`
- `dashboard-overview-response.dto.ts`: `period`, `meetingCount`, `activeRooms`, `utilizationRate`, `noShowRate`, `onTimeRate`, `recordingCount`, `activeUserCount`, `trend: TrendPointDto[]`.

#### T-B: Config service

- `dashboard-overview-config.service.ts`: `getMaxRangeDays()` — đọc `system_configs['analytics.dashboard_max_range_days']` → env `ANALYTICS_DASHBOARD_MAX_RANGE_DAYS` → default `366`. Mirror `no-show-detection.service.ts:readThreshold()`.

#### T-C: Controller shell

- `dashboard-overview.controller.ts`: `@Controller('analytics/dashboard')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.overview.read')` ở class-level, `@Get('overview')` handler gọi service.

#### T-D: Service shell

- `dashboard-overview.service.ts`: method `getOverview(currentUser, query)` — orchestrator, throw `NotImplementedException` tạm ở Phase 2, implement đầy đủ ở Phase 3.

#### T-E: Module wiring

- Cập nhật `analytics.module.ts`: đăng ký controller/service/repository/config service vào `controllers`/`providers`; import `TypeOrmModule.forFeature([...])` cho các entity cần SELECT (MeetingEntity, UserEntity, DepartmentEntity, MeetingParticipantEntity, RoomBookingEntity, RoomBookingUsageEntity, NoShowCaseEntity, AttendanceRecordEntity, RecordingSessionEntity, SystemConfigEntity).

### Phase 3: Business Logic

#### T-F: Scope resolution

- `resolveScope(currentUser)`: gọi `AuthzReadRepository.getEffectiveRolesAndPermissions(currentUser.userId)`.
  - Nếu role có `SYSTEM_ADMIN`/`BUSINESS_ADMIN` → `resolvedScopeDepartmentIds = null` (không giới hạn).
  - Nếu role có `MANAGER` → query `SELECT id FROM departments WHERE manager_user_id = $1` → `resolvedScopeDepartmentIds`.
  - Nếu không có role hợp lệ nào → throw `ForbiddenException({code:'PERMISSION_DENIED'})` (dù đã qua `PermissionsGuard`, đây là double-check role hợp lệ theo UC-148, phòng trường hợp permission bị gán sai role).

#### T-G: Validate query + departmentId ownership

- Validate `from <= to`; nếu thiếu, set default `from = today-30d, to = today`.
- Validate `to - from <= maxRangeDays` (từ T-B) → nếu vượt, throw `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`.
- Nếu role MANAGER và `query.departmentId` được truyền: kiểm tra `query.departmentId ∈ resolvedScopeDepartmentIds` → nếu không, throw `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`.

#### T-H: Aggregate repository

- `dashboard-overview.repository.ts` — mỗi method nhận `{ from, to, scopeDepartmentIds, departmentId?, roomId? }`, trả về số liệu thô, dùng parameterized raw SQL (bind `$1, $2...`, không nối chuỗi):
  - `countMeetings()`
  - `countActiveRooms()`
  - `getUtilizationAggregate()` — trả `{ actualMinutesSum, reservedMinutesSum }`
  - `getNoShowAggregate()` — trả `{ noShowCount, bookingCount }`
  - `getAttendanceAggregate()` — trả `{ onTimeCount, totalCount }`
  - `countActiveUsers()`
  - `countRecordingSessions()`
  - `getDailyTrend()` — trả mảng `{date, meetingCount, actualMinutesSum, reservedMinutesSum}` group theo ngày, service tính `utilizationRate` từ đó.

#### T-I: Build response

- `buildResponse()`: tính tỷ lệ % từ các aggregate (chia 0 → 0), làm tròn theo 1 chữ số thập phân (đúng ví dụ response mẫu UC-148: `68.5`), gộp thành `DashboardOverviewResponseDto`.

#### T-J: Empty state

- Nếu `countMeetings() === 0` trong scope + kỳ → trả thẳng response với toàn bộ KPI = 0, `trend = []`, `message = 'Không có dữ liệu hoạt động trong khoảng thời gian này'` (EX1) — không cần chạy các aggregate khác.

### Phase 4: Controller Wiring & Error Handling

#### T-K: Wire controller

- Try/catch, để NestJS exception filter chuẩn xử lý `BadRequestException`/`ForbiddenException`; catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.
- Audit log non-blocking (best-effort, gated `AUDIT_LOG_ENABLED`) sau khi trả response thành công — mirror `AuditLogsService.logAction()` pattern đã dùng ở `no-show.service.ts`/attendance feature.

### Phase 5: Testing

#### T-L: Unit test service

- Test scope resolution: SYSTEM_ADMIN/BUSINESS_ADMIN → null scope; MANAGER → đúng tập phòng ban; MANAGER quản lý 0 phòng ban → empty scope.
- Test validate: default range 30 ngày; `from > to` → lỗi; range vượt `maxRangeDays` → lỗi; `departmentId` ngoài scope MANAGER → lỗi.
- Test build response: mẫu số 0 → KPI = 0; công thức `utilizationRate`/`noShowRate`/`onTimeRate` đúng theo data-model.md.
- Test empty state (EX1).

#### T-M: Unit test DTO

- Test valid/invalid `from`/`to`/`departmentId`/`roomId`.

#### T-N: Unit test permission seed

- Test migration/seed tạo đúng permission `analytics.overview.read` và gán đúng 3 role.

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic | Verification |
|---|---|---|
| AC-001 | T-D + T-F + T-G + T-H + T-I | Unit: Business Admin default range, scope null |
| AC-002 | T-F + T-H | Unit: Manager scope đúng phòng ban |
| AC-003 | T-A (class-validator) | Unit: DTO invalid date |
| AC-004 | T-B + T-G | Unit: range vượt max |
| AC-005 | PermissionsGuard (có sẵn) + T-F | Unit: forbidden khi thiếu permission |
| AC-006 | T-G | Unit: departmentId ngoài scope |
| AC-007 | T-J | Unit: empty state |
| AC-008 | T-F + T-J | Unit: manager 0 phòng ban |
| AC-009 | T-H (không cache) | Integration/manual: gọi lại API sau khi có dữ liệu mới |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Aggregate 6+ bảng cùng lúc chậm khi range lớn | Timeout, trải nghiệm xấu (EX2) | Chặn range tại DTO trước khi query (T-G); tận dụng index sẵn có (NFR-008) |
| `activeUserCount` là field bổ sung ngoài `API_CONTRACT` gốc | FE có thể chưa biết field mới | Ghi rõ trong `contracts/dashboard-overview-api.md`; đề xuất đồng bộ tài liệu gốc ở task riêng (Out of Scope) |
| Scope leak qua `roomId` filter (rooms không thuộc phòng ban) | Manager có thể dò dữ liệu phòng ban khác qua roomId | `roomId` luôn là điều kiện `AND` sau khi đã áp `resolvedScopeDepartmentIds` ở tầng SQL — không có nhánh nào bỏ qua scope |
| Raw SQL parameterized dễ sai bind nếu nhiều điều kiện optional | Lỗi runtime hoặc SQL injection nếu làm sai | Dùng named parameters nhất quán, viết unit test cho từng nhánh optional (`departmentId`/`roomId` có/không) |

## Requirements Coverage

| Requirement ID | Task(s) | Description |
|---|---|---|
| FR-001, FR-002 | T-D, T-H | Read-only, on-demand aggregation |
| FR-003, FR-DATA-001, FR-DATA-002 | T-F | Scope resolution qua `departments.manager_user_id` |
| FR-004, FR-016 | T-C (guards có sẵn) | AuthN trước mọi logic |
| FR-005, FR-017 | T-C, T-F | Permission + role check |
| FR-006, FR-007 | T-G | Default range / range tùy chỉnh |
| FR-008, FR-009, FR-010, FR-014 | T-G | departmentId theo role |
| FR-011, FR-015 | T-H | roomId filter |
| FR-012, FR-035, T-J | T-J | Empty state |
| FR-013 | T-H (getUtilizationAggregate) | Fallback presence, không suy diễn |
| FR-018, ERR-007 | T-G | DEPARTMENT_OUT_OF_SCOPE |
| FR-019, FR-020, FR-022 | T-A | Validation DTO |
| FR-021, FR-036, NFR-003 | T-B, T-G | DATE_RANGE_TOO_LARGE |
| FR-025–FR-033 | T-H, T-I | Công thức từng KPI |
| FR-034 | T-K | Audit log |
| NFR-001, NFR-002 | T-H (index, giới hạn range) | Performance |
| NFR-005, NFR-006 | T-F, T-G, T-H | Scope enforce ở service, không leak |

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 (DTO + Controller/Service shell + Module wiring) — API chạy được, trả lỗi `NotImplementedException` tạm thời.
2. Phase 3 (Scope resolution + validate + aggregate repository + build response + empty state) — endpoint hoạt động đầy đủ.
3. Phase 4 (Controller wiring + audit log) — hoàn thiện error handling.
4. Phase 5 (Testing) — unit test toàn bộ nhánh.

MVP = Phase 1 + Phase 2 + Phase 3 + Phase 4. Testing nên làm ngay sau, không defer lâu vì công thức KPI có nhiều nhánh dễ sai.
