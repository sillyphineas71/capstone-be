# Implementation Plan: Xem thống kê cuộc họp theo trạng thái (UC-AA-05 / UC-152)

**Branch**: `020-view-meeting-status-breakdown` | **Date**: 2026-07-02
**Spec**: spec/features/analytics/feat-view-meeting-status-breakdown/spec.md

## Summary

Tính năng cho phép Manager (giới hạn phòng ban phụ trách, scope tĩnh), Business Admin, System Admin xem phân bổ số lượng + % cuộc họp theo 4 nhóm trạng thái (Scheduled/Completed/Cancelled/No-show) trong 1 khoảng thời gian (preset hoặc tùy chỉnh), lọc theo 1 hoặc nhiều phòng ban. Điểm phức tạp nhất: "No-show" không tồn tại trong `meetings.status`, phải JOIN thêm `no_show_cases` và áp thứ tự ưu tiên phân loại để mỗi meeting rơi vào đúng 1 nhóm. 1 endpoint: `GET /api/v1/analytics/meetings/status-breakdown` (đã có trong `API_CONTRACT` UC-152, sửa 2 điểm: `departmentId`→`departmentIds`, `in_progress`→`no_show`). Read-only, không thêm bảng/config/permission mới — tái dùng toàn bộ hạ tầng từ UC-AA-01/02/04.

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT
**Storage**: PostgreSQL (read-only aggregate query, JOIN 3 bảng cho phân loại no-show)
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 2s cho khoảng mặc định (tháng hiện tại)
**Constraints**: Read-only tuyệt đối; mỗi meeting chỉ thuộc đúng 1 nhóm (precedence rõ ràng); range bị chặn bởi config đã có
**Scale**: Tối đa `analytics.dashboard_max_range_days` ngày mỗi request

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột/config key nào — tái dùng 100% từ UC-AA-01/02/04 |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('analytics.meeting.read')` (tái dùng); scope enforce ở service |
| **Scope Gate** | PASS | Chỉ 1 endpoint UC-152; đã quyết định không gộp UC-AA-04 (spec §0.1); không UNION `meeting_requests` |
| **Module Gate** | PASS | Toàn bộ code trong `src/modules/analytics/`, tái dùng service/config đã có, chỉ thêm SELECT tới `no_show_cases`/`room_bookings` (không sửa module `rooms`) |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint khớp `API_CONTRACT` UC-152 (+2 field đổi đã ghi RECON) |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Test Gate** | PASS | Unit test cho precedence phân loại, scope, filter, empty state |

## Project Structure

### Documentation (this feature)

```text
spec/features/analytics/feat-view-meeting-status-breakdown/
├── spec.md
├── plan.md              # File này
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── meeting-status-breakdown-api.md
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/analytics/
├── analytics.module.ts                            # Update: đăng ký thêm controller/service/repository mới
├── controllers/
│   ├── dashboard-overview.controller.ts            # Đã có (UC-AA-01)
│   ├── room-usage-dashboard.controller.ts          # Đã có (UC-AA-02)
│   ├── meeting-count-by-period.controller.ts       # Đã có (UC-AA-04)
│   └── meeting-status-breakdown.controller.ts      # NEW
├── services/
│   ├── dashboard-overview-config.service.ts        # Đã có — tái dùng getMaxRangeDays()
│   └── meeting-status-breakdown.service.ts         # NEW: orchestrator — scope, preset, classify, build response
├── repositories/
│   └── meeting-status-breakdown.repository.ts      # NEW: aggregate SQL với CASE precedence
├── dto/
│   ├── query-meeting-status-breakdown.dto.ts       # NEW: preset/from/to/departmentIds
│   └── meeting-status-breakdown-response.dto.ts    # NEW
└── tests/
    ├── meeting-status-breakdown.service.spec.ts
    └── meeting-status-breakdown.repository.spec.ts
```

**Structure Decision**: Mở rộng module `analytics` đã có. **Không** seed lại permission (`analytics.meeting.read` đã seed ở UC-AA-04, tái dùng nguyên). Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` và pattern `resolveDateRange` với `preset` (copy/tái sử dụng logic đã viết ở UC-AA-02, cùng module nên có thể trích xuất helper dùng chung nếu code cho phép, hoặc implement lại 1-1 nếu coupling không cho phép reuse trực tiếp — quyết định cụ thể ở lúc code, không phải quyết định spec).

## Complexity Tracking

Không vi phạm constitution. Điểm phức tạp nhất là CASE precedence phân loại 4 nhóm (đặc biệt no-show JOIN qua 2 bảng trung gian) — đã có công thức SQL rõ ràng trong `data-model.md`, không phải complexity ngoại lệ cần justification riêng.

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/query-meeting-status-breakdown.dto.ts`, `dto/meeting-status-breakdown-response.dto.ts`, `services/meeting-status-breakdown.service.ts`, `repositories/meeting-status-breakdown.repository.ts`, `controllers/meeting-status-breakdown.controller.ts`, `tests/*.spec.ts`.

### Phase 2: Foundational

#### T-A: DTO

- `query-meeting-status-breakdown.dto.ts`: `preset?: 'day'|'week'|'month'|'custom'`, `from?: string`, `to?: string`, `departmentIds?: string[] (UUID each)`.
- `meeting-status-breakdown-response.dto.ts`: `StatusBreakdownItemDto {status, count, percentage}`, `MeetingStatusBreakdownResponseDto {period, total, items: StatusBreakdownItemDto[]}`.

#### T-B: Controller shell

- `meeting-status-breakdown.controller.ts`: `@Controller('analytics/meetings')` (dùng chung base path với UC-AA-04), `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.meeting.read')` class-level, `@Get('status-breakdown')` → `service.getStatusBreakdown(currentUser, query)`.

#### T-C: Service shell

- `meeting-status-breakdown.service.ts`: inject `AuthzReadRepository`, `MeetingStatusBreakdownRepository`, `DashboardOverviewConfigService`. Method `getStatusBreakdown(currentUser, query)` — throw `NotImplementedException` tạm.

#### T-D: Module wiring

- Cập nhật `analytics.module.ts`: đăng ký controller/service/repository mới; xác nhận `TypeOrmModule.forFeature` có `MeetingEntity`, `RoomBookingEntity`, `NoShowCaseEntity` (thêm `RoomBookingEntity`/`NoShowCaseEntity` nếu chưa import từ UC-AA-02).

### Phase 3: Business Logic — Date Range & Scope

#### T-E: Resolve date range (tái dùng pattern preset UC-AA-02)

- `resolveDateRange(query)`: `preset` thiếu → mặc định `month`. `preset IN (day,week,month)` → tự tính `from/to` theo timezone `Asia/Ho_Chi_Minh`. `preset='custom'` → bắt buộc `from`/`to` hợp lệ.

#### T-F: Check maxRangeDays

- Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` → vượt → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`.

#### T-G: Resolve scope Manager (tĩnh, tái dùng UC-AA-01/04)

- `resolveScope(currentUser)`: admin → null; MANAGER → `SELECT id FROM departments WHERE manager_user_id = $1`.

#### T-H: Check departmentIds ownership (multi-select)

- Nếu MANAGER và bất kỳ phần tử nào trong `query.departmentIds` không thuộc `scopeDepartmentIds` → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`.

### Phase 4: Business Logic — Classification & Aggregation

#### T-I: Repository — classify + count

- `getStatusCounts(params)` trong `meeting-status-breakdown.repository.ts`: 1 query dùng `CASE` precedence (data-model.md), `LEFT JOIN room_bookings` + `LEFT JOIN no_show_cases` (điều kiện `detection_status IN ('confirmed','released')`), `GROUP BY classified_status`, WHERE `deleted_at IS NULL`, `start_time BETWEEN $from AND $to`, scope + `departmentIds` filter. Trả `Map<status, count>` (chỉ 4 key hợp lệ, loại `NULL`).

#### T-J: Build response

- `buildResponse(countMap, from, to)`: đảm bảo đủ 4 phần tử `scheduled, completed, cancelled, no_show` theo đúng thứ tự (map count=0 nếu thiếu key), `total = SUM(counts)`, `percentage = count/total*100` làm tròn 1 chữ số thập phân (0 nếu `total=0`), thêm `message` nếu `total=0`.

### Phase 5: Controller Wiring & Error Handling

#### T-K: Wire controller

- Thứ tự: `resolveDateRange` → `maxRangeDays` check → `resolveScope` → `departmentIds` ownership check → `getStatusCounts` → `buildResponse`.
- Audit log non-blocking `action_type='read_analytics_meeting_status_breakdown'` (gated `AUDIT_LOG_ENABLED`).
- Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

### Phase 6: Testing

#### T-L: Unit test resolveDateRange + resolveScope + departmentIds ownership

- Test 4 preset, default month.
- Test scope admin/manager (tĩnh).
- Test `departmentIds` multi-select: tất cả trong scope → pass; có 1 phần tử ngoài scope → lỗi.

#### T-M: Unit test precedence phân loại (quan trọng nhất)

- `status='cancelled'` (dù có no_show_cases hay không) → nhóm "Cancelled".
- `status='scheduled'` + `no_show_cases confirmed` → nhóm "No-show", KHÔNG vào "Scheduled".
- `status='completed'` + `no_show_cases confirmed` (dữ liệu bất thường) → vẫn "No-show" (ưu tiên trước completed).
- `status='completed'`, không có no_show_cases → "Completed".
- `status='scheduled'`, không có no_show_cases → "Scheduled".
- `status IN ('draft','pending_approval','in_progress')` → không thuộc nhóm nào, không tính vào `total`.

#### T-N: Unit test buildResponse

- `total` luôn bằng `SUM(items[].count)`.
- `percentage` làm tròn 1 chữ số thập phân, tổng ≈ 100 khi `total>0`.
- `total=0` → mọi `percentage=0`, có `message`.
- `items` luôn đủ 4 phần tử đúng thứ tự cố định.

#### T-O: Unit test DTO validation + controller

- `preset`/`departmentIds` sai format → lỗi.
- Request hợp lệ → 200 đúng cấu trúc; audit log gọi khi thành công.

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic |
|---|---|
| AC-001 | T-E, T-I, T-J |
| AC-002 | T-G |
| AC-003 | T-I (precedence no-show trước scheduled) |
| AC-004 | T-H |
| AC-005 | T-A (DTO) |
| AC-006 | T-J (empty state) |
| AC-007 | T-I (loại transient status) |
| AC-008 | T-I (cancelled thuần status) |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Precedence CASE implement sai thứ tự (vd check completed trước no-show) | Đếm sai nhóm, số liệu sai lệch nghiêm trọng | Unit test T-M cụ thể cho từng nhánh precedence, đặc biệt case "completed + no_show_cases confirmed" |
| JOIN 3 bảng chậm nếu range lớn | Timeout | Index sẵn có `no_show_cases(booking_id)`, `room_bookings(meeting_id)`, `meetings(start_time,status)` đủ dùng |
| Đổi `departmentId`→`departmentIds` và `in_progress`→`no_show` lệch với `API_CONTRACT` gốc | FE có thể code sai theo tài liệu cũ | Ghi rõ trong `contracts/meeting-status-breakdown-api.md`, đề xuất đồng bộ tài liệu ở task riêng |

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001, FR-002 | T-C, T-I |
| FR-003, FR-012 | T-I (precedence + no-show JOIN) |
| FR-004, FR-014, FR-015 | T-B (guard có sẵn) |
| FR-005–FR-007 | T-E |
| FR-008–FR-010, FR-013 | T-G, T-H |
| FR-011, FR-027 | T-J |
| FR-016 | T-H |
| FR-017–FR-019 | T-A |
| FR-020, FR-028, NFR-002 | T-F |
| FR-021, FR-022 | T-G, T-H |
| FR-023–FR-025 | T-I, T-J |
| FR-026 | T-K |
