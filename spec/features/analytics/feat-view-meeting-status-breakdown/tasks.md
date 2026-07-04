# Tasks: Xem thống kê cuộc họp theo trạng thái (UC-AA-05 / UC-152)

**Feature**: AA-MEETING-STATUS-BREAKDOWN-001 — View Meeting Status Breakdown
**Module**: analytics
**Branch**: `020-view-meeting-status-breakdown`
**Date**: 2026-07-02

**Input documents**:
- spec.md, plan.md, research.md, data-model.md, quickstart.md
- contracts/meeting-status-breakdown-api.md

## Path Conventions

- Source files: `src/modules/analytics/` (thư mục con đã tồn tại từ UC-AA-01/02/04 — chỉ thêm file mới)
- Tái dùng: `DashboardOverviewConfigService.getMaxRangeDays()`, `AuthzReadRepository`, `AuditLogsService`, permission `analytics.meeting.read` (đã seed ở UC-AA-04 — **KHÔNG** seed lại), `MeetingEntity` (đã import)
- Cần import thêm: `RoomBookingEntity`, `NoShowCaseEntity` nếu chưa có trong `TypeOrmModule.forFeature` của `analytics.module.ts`

---

## Phase 1: Setup

- [ ] T001 [P] Tạo `src/modules/analytics/dto/query-meeting-status-breakdown.dto.ts`
- [ ] T002 [P] Tạo `src/modules/analytics/dto/meeting-status-breakdown-response.dto.ts`
- [ ] T003 [P] Tạo `src/modules/analytics/repositories/meeting-status-breakdown.repository.ts`
- [ ] T004 [P] Tạo `src/modules/analytics/controllers/meeting-status-breakdown.controller.ts`
- [ ] T005 [P] Tạo `src/modules/analytics/services/meeting-status-breakdown.service.ts`
- [ ] T006 [P] Tạo `src/modules/analytics/tests/meeting-status-breakdown.service.spec.ts` và `meeting-status-breakdown.repository.spec.ts`

---

## Phase 2: Foundational

- [ ] T007 [FR-017, FR-018, FR-019] [P] Implement `QueryMeetingStatusBreakdownDto` trong `query-meeting-status-breakdown.dto.ts`
  - `@IsOptional() @IsEnum(['day','week','month','custom']) preset?: string`
  - `@IsOptional() @IsDateString() from?: string`
  - `@IsOptional() @IsDateString() to?: string`
  - `@IsOptional() @IsArray() @IsUUID('4', {each:true}) departmentIds?: string[]`

- [ ] T008 [FR-023-FR-025] [P] Implement DTO response trong `meeting-status-breakdown-response.dto.ts`
  - `StatusBreakdownItemDto { status: 'scheduled'|'completed'|'cancelled'|'no_show'; count: number; percentage: number }`
  - `MeetingStatusBreakdownResponseDto { period: {from,to}; total: number; items: StatusBreakdownItemDto[] }`

- [ ] T009 [FR-004] Tạo `MeetingStatusBreakdownController` (shell) trong `meeting-status-breakdown.controller.ts`
  - `@Controller('analytics/meetings')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.meeting.read')` class-level
  - `@Get('status-breakdown') getStatusBreakdown(@Query() query: QueryMeetingStatusBreakdownDto, @CurrentUser() currentUser)`

- [ ] T010 [FR-001] Tạo `MeetingStatusBreakdownService` (shell) trong `meeting-status-breakdown.service.ts`
  - Inject: `AuthzReadRepository`, `MeetingStatusBreakdownRepository`, `DashboardOverviewConfigService`
  - `getStatusBreakdown(currentUser, query)` — throw `NotImplementedException` tạm

- [ ] T011 [Module] Cập nhật `src/modules/analytics/analytics.module.ts`
  - Đăng ký `MeetingStatusBreakdownController` vào `controllers`
  - Đăng ký `MeetingStatusBreakdownService`, `MeetingStatusBreakdownRepository` vào `providers`
  - Thêm `RoomBookingEntity`, `NoShowCaseEntity` vào `TypeOrmModule.forFeature` nếu chưa có

---

## Phase 3: Business Logic — Date Range & Scope

- [ ] T012 [FR-005-FR-007] Implement `resolveDateRange(query)` trong `MeetingStatusBreakdownService`
  - Tái dùng logic `preset` đã viết ở UC-AA-02 (`day/week/month/custom`, timezone `Asia/Ho_Chi_Minh`)
  - Thiếu `preset` → mặc định `'month'`

- [ ] T013 [FR-020, FR-028, NFR-002] Implement check `maxRangeDays` trong `MeetingStatusBreakdownService`
  - Gọi `DashboardOverviewConfigService.getMaxRangeDays()` (tái dùng, KHÔNG tạo config mới)
  - Vượt ngưỡng → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`

- [ ] T014 [FR-008, FR-DATA-002] Implement `resolveScope(currentUser)` trong `MeetingStatusBreakdownService`
  - Tái dùng đúng pattern tĩnh đã có ở UC-AA-01/UC-AA-04: admin → null; MANAGER → `SELECT id FROM departments WHERE manager_user_id = $1`
  - Không có role hợp lệ → `ForbiddenException({code:'PERMISSION_DENIED'})`

- [ ] T015 [FR-009, FR-016, AC-004] Implement check `departmentIds` ownership (multi-select) trong `MeetingStatusBreakdownService`
  - `!isAdmin` và tồn tại phần tử trong `query.departmentIds` không thuộc `scopeDepartmentIds` → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`

---

## Phase 4: Business Logic — Classification & Aggregation

- [ ] T016 [FR-003, FR-012, FR-023, FR-DATA-001] Implement `getStatusCounts(params)` trong `meeting-status-breakdown.repository.ts`
  - Raw SQL 1 query với `CASE` precedence (đúng thứ tự data-model.md: cancelled → no_show → completed → scheduled → NULL)
  - `LEFT JOIN room_bookings ON room_bookings.meeting_id = meetings.id`
  - `LEFT JOIN no_show_cases ON no_show_cases.booking_id = room_bookings.id AND no_show_cases.detection_status IN ('confirmed','released')`
  - WHERE `deleted_at IS NULL`, `start_time BETWEEN $from AND $to`, scope + `departmentIds` filter (`organizer_id IN (SELECT id FROM users WHERE department_id = ANY($ids))`)
  - `GROUP BY classified_status` (loại `NULL`)
  - Parameterized, không nối chuỗi
  - Trả `Map<'scheduled'|'completed'|'cancelled'|'no_show', number>`

- [ ] T017 [FR-011, FR-023, FR-024, FR-025, FR-027, NFR-005] Implement `buildResponse(countMap, from, to)` trong `MeetingStatusBreakdownService`
  - Đảm bảo đủ 4 key theo đúng thứ tự `scheduled, completed, cancelled, no_show` (map `count=0` nếu thiếu)
  - `total = SUM(counts)`
  - `percentage = round(count/total*100, 1)` mỗi item; `total=0` → mọi `percentage=0`
  - `total=0` → thêm `message: 'Không có dữ liệu cuộc họp nào thỏa mãn bộ lọc hiện tại'` (EX1)

---

## Phase 5: Controller Wiring & Error Handling

- [ ] T018 [FR-004, FR-026] Hoàn thiện `MeetingStatusBreakdownController.getStatusBreakdown()`
  - Thứ tự: `resolveDateRange` (T012) → `maxRangeDays` check (T013) → `resolveScope` (T014) → `departmentIds` ownership (T015) → `getStatusCounts` (T016) → `buildResponse` (T017)
  - Audit log non-blocking `action_type='read_analytics_meeting_status_breakdown'` (gated `AUDIT_LOG_ENABLED`)
  - Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 6: Testing

- [ ] T019 [Test, AC-001] [P] Unit test `resolveDateRange()` (tái dùng test case tương tự UC-AA-02)
  - 4 preset, default month

- [ ] T020 [Test, AC-002, AC-004] [P] Unit test `resolveScope()` + `departmentIds` ownership
  - Admin → null
  - MANAGER → đúng danh sách phòng ban (tĩnh)
  - MANAGER 0 phòng ban → `[]`
  - `departmentIds` tất cả trong scope → pass; có 1 phần tử ngoài scope → `DEPARTMENT_OUT_OF_SCOPE`

- [ ] T021 [Test, AC-003, AC-007, AC-008] [P] Unit test precedence phân loại trong `getStatusCounts()` — **quan trọng nhất, cần cover đủ nhánh**
  - `status='cancelled'` (có/không có no_show_cases) → luôn "Cancelled"
  - `status='scheduled'` + no_show confirmed → "No-show", KHÔNG vào "Scheduled"
  - `status='completed'` + no_show confirmed (dữ liệu bất thường) → vẫn "No-show" (test đúng precedence)
  - `status='completed'`, không no_show → "Completed"
  - `status='scheduled'`, không no_show → "Scheduled"
  - `status IN ('draft','pending_approval','in_progress')` → không thuộc nhóm nào, không có trong `Map` kết quả
  - `no_show_cases.detection_status IN ('risk','warning_sent','dismissed')` (chưa confirmed) → KHÔNG tính là no-show

- [ ] T022 [Test, AC-006] [P] Unit test `buildResponse()`
  - `total` luôn bằng `SUM(items[].count)`
  - `percentage` làm tròn 1 chữ số, tổng ≈100 khi có dữ liệu
  - `total=0` → mọi `percentage=0`, có `message`, `items` vẫn đủ 4 phần tử đúng thứ tự

- [ ] T023 [Test, AC-005] [P] Unit test `QueryMeetingStatusBreakdownDto` validation
  - `preset` sai enum, `departmentIds` chứa giá trị không phải UUID → lỗi

- [ ] T024 [Test] [P] Unit test `MeetingStatusBreakdownController`
  - Request hợp lệ → 200 đúng cấu trúc `{period, total, items}`
  - Audit log gọi khi thành công, KHÔNG gọi khi lỗi 403/400
  - Lỗi không lường trước → 500 `INTERNAL_ERROR`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T025 [Polish] Verify response format `{success, message, data, meta}`
- [ ] T026 [Polish, FR-001] Verify read-only: không có write operation nào trong service/repository (ngoại trừ audit log dùng chung)
- [ ] T027 [Polish] Verify raw SQL dùng parameter binding, không nối chuỗi
- [ ] T028 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `DATE_RANGE_TOO_LARGE`, `PERMISSION_DENIED`, `DEPARTMENT_OUT_OF_SCOPE`, `INTERNAL_ERROR`
- [ ] T029 [Polish] Verify KHÔNG seed lại permission `analytics.meeting.read` (đã tồn tại từ UC-AA-04) — chỉ gán thêm nếu migration UC-AA-04 chưa chạy trong môi trường hiện tại (kiểm tra idempotent trước khi thêm seed mới)
- [ ] T030 [Test] Chạy toàn bộ kịch bản `quickstart.md` để verify end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Date range/Scope)**: Phụ thuộc Phase 2
- **Phase 4 (Classification/Aggregation)**: Phụ thuộc Phase 2; phụ thuộc Phase 3 để có `from/to`/scope trước khi build response
- **Phase 5 (Wiring)**: Phụ thuộc Phase 3 + Phase 4
- **Phase 6 (Testing)**: Phụ thuộc Phase 5
- **Phase 7 (Polish)**: Phụ thuộc Phase 6

### Parallel Opportunities

- Phase 1: T001-T006 song song (khác file)
- Phase 6: T019-T024 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 + Phase 4 — Business logic đầy đủ (date range, scope, precedence phân loại, aggregate, empty state)
3. Phase 5 — Controller hoàn chỉnh, audit log
4. Phase 6 — Unit test toàn bộ nhánh (đặc biệt T021 — precedence phân loại là điểm rủi ro cao nhất của feature này)
5. Phase 7 — Polish, verify quickstart, verify KHÔNG seed trùng permission

MVP = Phase 1 → Phase 5.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001, FR-002 | T010, T016 |
| FR-003, FR-012 | T016 (precedence) |
| FR-004, FR-014, FR-015 | T009 (guard có sẵn) |
| FR-005–FR-007 | T012 |
| FR-008–FR-010, FR-013 | T014, T015 |
| FR-011, FR-027 | T017 |
| FR-016 | T015 |
| FR-017–FR-019 | T007 |
| FR-020, FR-028 | T013 |
| FR-021, FR-022 | T014, T015 |
| FR-023–FR-025 | T016, T017 |
| FR-026 | T018 |
