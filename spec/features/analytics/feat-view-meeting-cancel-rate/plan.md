# Implementation Plan: Xem thống kê tỷ lệ cuộc họp bị hủy (UC-AA-07 / UC-154)

**Branch**: `022-view-meeting-cancel-rate` | **Date**: 2026-07-02
**Spec**: spec/features/analytics/feat-view-meeting-cancel-rate/spec.md

## Summary

Tính năng cho phép Manager (giới hạn phòng ban phụ trách, scope tĩnh), Business Admin, System Admin xem biểu đồ xu hướng tỷ lệ hủy cuộc họp theo tuần/tháng, kèm 2 bảng xếp hạng cảnh báo độc lập: Top 10 nhân sự (organizer, định danh bằng email) và Top 10 phòng ban có số lượng/tỷ lệ hủy cao nhất. Mẫu số là toàn bộ meeting `status <> 'draft'`, "hủy" = `status = 'cancelled'` thuần túy (đã hội tụ chủ động hủy + reject phê duyệt). Ranking tính theo **organizer** (không theo actor thực hiện hủy), có ngưỡng tối thiểu `organizedCount >= 3` chống nhiễu, và `topDepartments` luôn `[]` khi role là MANAGER. 1 endpoint: `GET /api/v1/analytics/meetings/cancel-rate` (đã có trong `API_CONTRACT` UC-154, mở rộng thêm `preset/granularity/organizerEmail` ở query và `topOrganizers/topDepartments` ở response). Read-only, không thêm bảng/config/permission mới — tái dùng toàn bộ hạ tầng từ UC-AA-01/04/05/06.

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT
**Storage**: PostgreSQL (read-only aggregate query, JOIN `meetings + users` [+ `departments` cho topDepartments])
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 2s cho khoảng mặc định (tháng hiện tại, granularity=week)
**Constraints**: Read-only tuyệt đối; mẫu số loại `draft`; ranking theo organizer có ngưỡng tối thiểu 3; `topDepartments` rỗng cho MANAGER
**Scale**: Tối đa `analytics.dashboard_max_range_days` ngày mỗi request

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột/config key nào — tái dùng 100% từ UC-AA-01/04/05/06 |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('analytics.meeting.read')` (tái dùng); scope enforce ở service; `topDepartments` ẩn ở tầng service cho MANAGER (không dựa vào FE) |
| **Scope Gate** | PASS | Chỉ 1 endpoint UC-154 mở rộng; không tách endpoint mới cho Top-10 (spec §0.1) |
| **Module Gate** | PASS | Toàn bộ code trong `src/modules/analytics/`, tái dùng service/config đã có |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint khớp path `API_CONTRACT` UC-154 (field mở rộng đã ghi RECON) |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Test Gate** | PASS | Unit test cho ranking theo organizer (không theo actor), ngưỡng tối thiểu, `topDepartments` rỗng cho MANAGER, EX1, `organizerEmail` không khớp |

## Project Structure

### Documentation (this feature)

```text
spec/features/analytics/feat-view-meeting-cancel-rate/
├── spec.md
├── plan.md              # File này
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── meeting-cancel-rate-api.md
├── checklists/
│   └── requirements.md
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
│   ├── meeting-average-duration.controller.ts       # Đã có (UC-AA-06)
│   └── meeting-cancel-rate.controller.ts            # NEW
├── services/
│   ├── dashboard-overview-config.service.ts         # Đã có — tái dùng getMaxRangeDays()
│   └── meeting-cancel-rate.service.ts               # NEW: orchestrator — preset, scope, bucket, ranking, build response
├── repositories/
│   └── meeting-cancel-rate.repository.ts            # NEW: aggregate SQL population/series/topOrganizers/topDepartments
├── dto/
│   ├── query-meeting-cancel-rate.dto.ts             # NEW
│   └── meeting-cancel-rate-response.dto.ts          # NEW
└── tests/
    ├── meeting-cancel-rate.service.spec.ts
    └── meeting-cancel-rate.repository.spec.ts
```

**Structure Decision**: Mở rộng module `analytics` đã có. **Không** seed lại permission (`analytics.meeting.read` đã seed ở UC-AA-04). Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` và `generateBuckets()` (`week`/`month`) đã có từ UC-AA-04. Thêm mới hoàn toàn logic `resolvePresetRange()` (preset `month_current/month_previous/quarter/custom` — khác preset `day/week/month/custom` đã dùng ở UC-AA-02/05) vì UC-AA-07 có yêu cầu preset riêng.

## Complexity Tracking

Không vi phạm constitution. Điểm phức tạp nhất là đảm bảo:
1. Ranking dùng đúng `organizer_id`, không vô tình lẫn logic actor hủy (`updated_by`) — 2 khái niệm tồn tại song song trong cùng bảng `meetings`, dễ nhầm khi viết SQL.
2. `topDepartments` bị chặn tuyệt đối ở tầng service cho MANAGER, không chỉ dựa vào FE ẩn UI.

Cả 2 điểm đã có unit test riêng ở Phase 6, không phải complexity ngoại lệ cần justify thêm.

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/query-meeting-cancel-rate.dto.ts`, `dto/meeting-cancel-rate-response.dto.ts`, `services/meeting-cancel-rate.service.ts`, `repositories/meeting-cancel-rate.repository.ts`, `controllers/meeting-cancel-rate.controller.ts`, `tests/*.spec.ts`.

### Phase 2: Foundational

#### T-A: DTO

- `query-meeting-cancel-rate.dto.ts`: `@IsOptional() @IsEnum(['month_current','month_previous','quarter','custom']) preset?`, `@IsOptional() @IsDateString() from?`, `to?`, `@IsOptional() @IsEnum(['week','month']) granularity?`, `@IsOptional() @IsArray() @IsUUID('4',{each:true}) departmentIds?`, `@IsOptional() @IsUUID() roomId?`, `@IsOptional() @IsEmail() organizerEmail?`.
- `meeting-cancel-rate-response.dto.ts`: `CancelRatePointDto {period, totalCount, cancelledCount, cancelRate}`, `TopOrganizerDto {userId, email, fullName, organizedCount, cancelledCount, cancelRate}`, `TopDepartmentDto {departmentId, departmentName, organizedCount, cancelledCount, cancelRate}`, `MeetingCancelRateResponseDto {period, totalMeetingCount, cancelledCount, cancelRate, series, topOrganizers, topDepartments, message?}`.

#### T-B: Controller shell

- `meeting-cancel-rate.controller.ts`: `@Controller('analytics/meetings')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.meeting.read')` class-level, `@Get('cancel-rate')` → `service.getCancelRate(currentUser, query)`.

#### T-C: Service shell

- `meeting-cancel-rate.service.ts`: inject `AuthzReadRepository`, `MeetingCancelRateRepository`, `DashboardOverviewConfigService`. Method `getCancelRate(currentUser, query)` — throw `NotImplementedException` tạm.

#### T-D: Module wiring

- Cập nhật `analytics.module.ts`: đăng ký controller/service/repository mới; xác nhận `TypeOrmModule.forFeature` đã có `MeetingEntity`, `UserEntity`, `DepartmentEntity`.

### Phase 3: Business Logic — Preset, Bucket, Scope

#### T-E: Resolve `preset` → `from`/`to` (MỚI, không tái dùng trực tiếp UC-AA-02/05)

- `resolvePresetRange(preset, from, to)`: `month_current` (mặc định) → đầu/cuối tháng hiện tại; `month_previous` → đầu/cuối tháng trước; `quarter` → đầu/cuối quý dương lịch hiện tại; `custom` → dùng `from`/`to` truyền vào (validate bắt buộc).

#### T-F: Check `maxRangeDays`

- Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` → vượt → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`.

#### T-G: Generate bucket list (tái dùng nguyên UC-AA-04, KHÔNG thêm `quarter`)

- `generateBuckets(from, to, granularity)`: tái dùng nguyên hàm đã có (`week`/`month` — `quarter` KHÔNG áp dụng ở đây vì đó là khái niệm `preset`, không phải `granularity`).

#### T-H: Resolve scope Manager (tĩnh, tái dùng)

- `resolveScope(currentUser)`: tái dùng đúng pattern đã có ở UC-AA-01/04/05/06.

#### T-I: Check `departmentIds` ownership (multi-select, tái dùng UC-AA-05)

- Nếu MANAGER và bất kỳ phần tử nào trong `query.departmentIds` ngoài `scopeDepartmentIds` → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`.

#### T-J: Resolve `organizerEmail` → `organizerId`

- `resolveOrganizerId(organizerEmail)`: query `users` theo `LOWER(email) = LOWER(:organizerEmail)`; không tìm thấy → đánh dấu filter "không match" (service trả thẳng response rỗng theo FR-015/FR-018, không query tiếp).

### Phase 4: Business Logic — Aggregation

#### T-K: Repository — population tổng/series theo bucket

- `getCancelRateSummary(params)` và `getCancelRateSeries(params)` trong `meeting-cancel-rate.repository.ts`:
  - JOIN `meetings` INNER JOIN `users` (scope + `departmentIds`/`roomId`/`organizerId` filter, `status <> 'draft'`, `deleted_at IS NULL`, `start_time BETWEEN :from AND :to`)
  - `series`: `GROUP BY date_trunc(granularity, start_time)` → `totalCount`, `cancelledCount`
  - `summary`: cùng điều kiện không `GROUP BY` → `totalMeetingCount`, `cancelledCount`
  - Parameterized, không nối chuỗi

#### T-L: Repository — Top Organizers

- `getTopOrganizers(params)`: `GROUP BY m.organizer_id, u.email, u.full_name`, `HAVING COUNT(*) >= 3`, `ORDER BY cancelledCount DESC, cancelRate DESC`, `LIMIT 10`.

#### T-M: Repository — Top Departments (chỉ gọi khi role ≠ MANAGER)

- `getTopDepartments(params)`: `JOIN departments d ON d.id = u.department_id`, `GROUP BY u.department_id, d.department_name`, `HAVING COUNT(*) >= 3`, `ORDER BY cancelledCount DESC, cancelRate DESC`, `LIMIT 10`.
- **Service tuyệt đối không gọi hàm này nếu `currentUser.role = MANAGER`** — trả `[]` ngay ở tầng service, không dựa vào repository lọc hộ.

#### T-N: Build response

- `buildResponse(summary, series, topOrganizers, topDepartments)`: tính `cancelRate` làm tròn 1 chữ số thập phân cho summary/mỗi bucket/mỗi phần tử ranking; `totalMeetingCount=0` → thêm `message` (EX1).

### Phase 5: Controller Wiring & Error Handling

#### T-O: Wire controller

- Thứ tự: `resolvePresetRange` (T-E) → `maxRangeDays` check (T-F) → `resolveScope` (T-H) → `departmentIds` ownership (T-I) → `resolveOrganizerId` (T-J, nếu có) → nếu organizerEmail không khớp → trả EX1 ngay → `generateBuckets` (T-G) → `getCancelRateSummary`/`getCancelRateSeries` (T-K) → `getTopOrganizers` (T-L) → `getTopDepartments` (T-M, chỉ khi role ≠ MANAGER) → `buildResponse` (T-N).
- Audit log non-blocking `action_type='read_analytics_meeting_cancel_rate'` (gated `AUDIT_LOG_ENABLED`).
- Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

### Phase 6: Testing

#### T-P: Unit test `resolvePresetRange` (MỚI, quan trọng — preset chưa từng có ở feature trước)

- `month_current` mặc định đúng đầu/cuối tháng hiện tại.
- `month_previous` đúng đầu/cuối tháng trước (kể cả biên năm, vd tháng 1 → tháng 12 năm trước).
- `quarter` đúng biên quý (đặc biệt Q1 Jan-Mar).
- `custom` thiếu `from`/`to` hoặc `from>to` → lỗi.

#### T-Q: Unit test `resolveScope` + `departmentIds` ownership (tái dùng test case UC-AA-05)

#### T-R: Unit test `getCancelRateSummary`/`getCancelRateSeries`

- Meeting `status='cancelled'` (chủ động hủy) → tính vào `cancelledCount`.
- Meeting `status='cancelled'` do approver reject → **vẫn** tính vào `cancelledCount` của organizer gốc (verify không UNION `meeting_requests`, không lệch nguồn).
- Meeting `status='draft'` → loại khỏi `totalMeetingCount` (không phải mẫu số).
- `totalMeetingCount = SUM(series[].totalCount)` khớp nhau.

#### T-S: Unit test `getTopOrganizers` — **quan trọng nhất, rủi ro cao nhất**

- Organizer tổ chức 5 meeting, 3 cancelled → `organizedCount=5, cancelledCount=3, cancelRate=60`.
- Organizer tổ chức 1 meeting, 1 cancelled (`cancelRate=100%`) → **KHÔNG** xuất hiện (verify ngưỡng `>= 3`).
- Meeting bị approver (không phải organizer) reject → tính vào `cancelledCount` của **organizer**, KHÔNG phải actor reject (verify ranking theo organizer, không theo actor).
- Sort đúng: `cancelledCount` giảm dần trước, `cancelRate` sau.

#### T-T: Unit test `getTopDepartments` + guard MANAGER

- Role BUSINESS_ADMIN/SYSTEM_ADMIN → `topDepartments` có dữ liệu đúng ngưỡng/sort như T-S.
- Role MANAGER → `topDepartments` LUÔN `[]`, và **service không gọi** `getTopDepartments()` (spy/mock verify not called) — đảm bảo không rò rỉ dữ liệu phòng ban khác dù repository có bug.

#### T-U: Unit test `resolveOrganizerId` + EX1

- `organizerEmail` khớp đúng 1 user → filter đúng.
- `organizerEmail` không khớp user nào → trả response rỗng (EX1), không phải lỗi.
- Toàn bộ `[from,to]` không có meeting nào → `series` đủ bucket giá trị 0, `topOrganizers=[]`, `topDepartments=[]`, có `message`.

#### T-V: Unit test DTO validation + controller

- `preset`/`granularity`/`departmentIds`/`roomId`/`organizerEmail` sai format → lỗi.
- Request hợp lệ → 200 đúng cấu trúc; audit log gọi khi thành công.

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic |
|---|---|
| AC-001 | T-E, T-G, T-K, T-L, T-M, T-N |
| AC-002 | T-H, T-T |
| AC-003 | T-S (ngưỡng >= 3) |
| AC-004 | T-I |
| AC-005 | T-P |
| AC-006 | T-V |
| AC-007 | T-U |
| AC-008 | T-S (ranking theo organizer, không theo actor) |
| AC-009 | T-J, T-U |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Nhầm ranking theo `updated_by` (actor hủy) thay vì `organizer_id` | Bảng xếp hạng sai đối tượng, đi ngược quyết định đã duyệt (§0.2 spec.md) | Unit test T-S cụ thể dùng dữ liệu meeting bị reject bởi actor khác organizer, verify tính đúng vào organizer |
| `topDepartments` rò rỉ cho MANAGER do bug ở tầng repository (quên check role) | Lộ dữ liệu phòng ban ngoài scope — vi phạm NFR-005 | Chặn ở tầng SERVICE (không gọi repository khi role=MANAGER) thay vì chỉ lọc kết quả — T-T verify bằng spy "not called" |
| Ngưỡng `organizedCount >= 3` hardcode có thể cần điều chỉnh runtime sau này | Phải sửa code + deploy lại nếu business đổi ý | Ghi rõ CL-2 trong spec.md, dễ nâng cấp `system_configs` sau, không block launch hiện tại |
| `preset=quarter`/`month_previous` tính sai biên (năm/tháng) | Sai toàn bộ dữ liệu hiển thị | Unit test T-P cụ thể cho biên năm (tháng 1 → tháng 12 năm trước, Q1) |
| Lệch với `API_CONTRACT` UC-154 gốc (thiếu field mới) | FE code sai theo tài liệu cũ | Ghi rõ trong `contracts/meeting-cancel-rate-api.md`, đề xuất đồng bộ tài liệu ở task riêng |

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T-C, T-K |
| FR-004 | T-B |
| FR-005–FR-007 | T-E |
| FR-008, FR-009 | T-G |
| FR-010–FR-012 | T-H, T-I |
| FR-013 | T-K (roomId filter) |
| FR-014 | T-J |
| FR-015 | T-N, T-U |
| FR-016 | T-L, T-M |
| FR-017 | T-M (guard MANAGER) |
| FR-018 | T-J, T-U |
| FR-019, FR-020 | T-I, T-K |
| FR-021–FR-029 | T-A, T-F, T-P, T-V |
| FR-030, FR-031 | T-H |
| FR-032–FR-034 | T-K |
| FR-035 | T-G, T-K |
| FR-036 | T-L |
| FR-037 | T-M |
| FR-038 | T-O |
| FR-039, FR-040 | T-H, T-F |
