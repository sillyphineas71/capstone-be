# Tasks: Xem thống kê thời lượng trung bình cuộc họp (UC-AA-06 / UC-153)

**Feature**: AA-MEETING-AVERAGE-DURATION-001 — View Meeting Average Duration
**Module**: analytics
**Branch**: `021-view-meeting-average-duration`
**Date**: 2026-07-02

**Input documents**:
- spec.md, plan.md, research.md, data-model.md, quickstart.md
- contracts/meeting-average-duration-api.md

## Path Conventions

- Source files: `src/modules/analytics/` (thư mục con đã tồn tại từ UC-AA-01/02/04/05 — chỉ thêm file mới)
- Tái dùng: `DashboardOverviewConfigService.getMaxRangeDays()`, `AuthzReadRepository`, `AuditLogsService`, permission `analytics.meeting.read` (đã seed ở UC-AA-04 — **KHÔNG** seed lại), `MeetingEntity`/`RoomBookingEntity`/`RoomBookingUsageEntity` (đã import từ UC-AA-01/02)

---

## Phase 1: Setup

- [ ] T001 [P] Tạo `src/modules/analytics/dto/query-meeting-average-duration.dto.ts`
- [ ] T002 [P] Tạo `src/modules/analytics/dto/meeting-average-duration-response.dto.ts`
- [ ] T003 [P] Tạo `src/modules/analytics/repositories/meeting-average-duration.repository.ts`
- [ ] T004 [P] Tạo `src/modules/analytics/controllers/meeting-average-duration.controller.ts`
- [ ] T005 [P] Tạo `src/modules/analytics/services/meeting-average-duration.service.ts`
- [ ] T006 [P] Tạo `src/modules/analytics/tests/meeting-average-duration.service.spec.ts` và `meeting-average-duration.repository.spec.ts`

---

## Phase 2: Foundational

- [ ] T007 [FR-019-FR-021] [P] Implement `QueryMeetingAverageDurationDto` trong `query-meeting-average-duration.dto.ts`
  - `@IsOptional() @IsDateString() from?: string`
  - `@IsOptional() @IsDateString() to?: string`
  - `@IsOptional() @IsEnum(['day','week','month','quarter']) granularity?: string`
  - `@IsOptional() @IsArray() @IsUUID('4', {each:true}) departmentIds?: string[]`
  - `@IsOptional() @IsUUID() roomId?: string`

- [ ] T008 [FR-025-FR-028] [P] Implement DTO response trong `meeting-average-duration-response.dto.ts`
  - `AverageDurationPointDto { period: string; plannedAverageMinutes: number|null; actualAverageMinutes: number|null; completedMeetingCount: number }`
  - `AverageDurationSummaryDto { plannedAverageMinutes: number|null; actualAverageMinutes: number|null; completedMeetingCount: number }`
  - `MeetingAverageDurationResponseDto { period: {from,to}; summary: AverageDurationSummaryDto; series: AverageDurationPointDto[] }`

- [ ] T009 [FR-004] Tạo `MeetingAverageDurationController` (shell) trong `meeting-average-duration.controller.ts`
  - `@Controller('analytics/meetings')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.meeting.read')` class-level
  - `@Get('average-duration') getAverageDuration(@Query() query: QueryMeetingAverageDurationDto, @CurrentUser() currentUser)`

- [ ] T010 [FR-001] Tạo `MeetingAverageDurationService` (shell) trong `meeting-average-duration.service.ts`
  - Inject: `AuthzReadRepository`, `MeetingAverageDurationRepository`, `DashboardOverviewConfigService`
  - `getAverageDuration(currentUser, query)` — throw `NotImplementedException` tạm

- [ ] T011 [Module] Cập nhật `src/modules/analytics/analytics.module.ts`
  - Đăng ký `MeetingAverageDurationController` vào `controllers`
  - Đăng ký `MeetingAverageDurationService`, `MeetingAverageDurationRepository` vào `providers`
  - Xác nhận `TypeOrmModule.forFeature` đã có `MeetingEntity`, `RoomBookingEntity`, `RoomBookingUsageEntity`

---

## Phase 3: Business Logic — Date Range, Bucket, Scope

- [ ] T012 [FR-005, FR-006] Implement `resolveDateRange(query)` trong `MeetingAverageDurationService`
  - Tái dùng logic đã viết ở UC-AA-04 (đầu-cuối tháng hiện tại nếu thiếu `from`/`to`)

- [ ] T013 [FR-022, FR-032, NFR-002] Implement check `maxRangeDays` trong `MeetingAverageDurationService`
  - Gọi `DashboardOverviewConfigService.getMaxRangeDays()` (tái dùng, KHÔNG tạo config mới)
  - Vượt ngưỡng → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`

- [ ] T014 [FR-007, FR-029] Implement `generateBuckets(from, to, granularity)` trong `MeetingAverageDurationService`
  - Tái dùng logic `day/week/month` đã có ở UC-AA-04, **thêm nhánh `quarter`**: mỗi bucket 1 quý dương lịch (Q1 Jan-Mar, Q2 Apr-Jun, Q3 Jul-Sep, Q4 Oct-Dec), label `"YYYY-'Q'Q"`
  - `granularity` thiếu → mặc định `'week'`

- [ ] T015 [FR-008, FR-DATA-002] Implement `resolveScope(currentUser)` trong `MeetingAverageDurationService`
  - Tái dùng đúng pattern tĩnh đã có ở UC-AA-01/04/05

- [ ] T016 [FR-009, FR-018, AC-005] Implement check `departmentIds` ownership (multi-select) trong `MeetingAverageDurationService`
  - Tái dùng logic đã viết ở UC-AA-05

---

## Phase 4: Business Logic — Aggregation

- [ ] T017 [FR-003, FR-011, FR-025, FR-026, FR-027, FR-DATA-001] Implement `getAverageDurationByBucket(params)` trong `meeting-average-duration.repository.ts`
  - 1 query `GROUP BY date_trunc(granularity, m.start_time)`
  - `INNER JOIN room_bookings rb ON rb.meeting_id = m.id`
  - `LEFT JOIN room_booking_usages rbu ON rbu.meeting_id = m.id`
  - WHERE `m.status = 'completed'`, `m.deleted_at IS NULL`, `m.start_time BETWEEN $from AND $to`, scope + `departmentIds`/`roomId` filter
  - Tính `plannedMinutes = EXTRACT(EPOCH FROM (rb.reserved_end_time - rb.reserved_start_time))/60`
  - Tính `actualMinutes = COALESCE(EXTRACT(EPOCH FROM (rbu.actual_end_time - rbu.actual_start_time))/60, EXTRACT(EPOCH FROM (rbu.last_presence_at - rbu.first_presence_at))/60)`
  - **CHỈ tính vào AVG nếu `actualMinutes IS NOT NULL`** (loại đồng bộ cả plannedMinutes của record đó — đảm bảo cùng population, xem data-model.md)
  - `AVG(plannedMinutes)`, `AVG(actualMinutes)`, `COUNT(*)` mỗi bucket
  - Parameterized, không nối chuỗi
  - Trả `Map<bucketKey, {plannedAvg: number, actualAvg: number, count: number}>`

- [ ] T018 [FR-028] Implement `getAverageDurationSummary(params)` trong repository
  - Cùng logic T017 nhưng không `GROUP BY` — trả 1 dòng cho toàn `[from,to]`

- [ ] T019 [FR-012, FR-013, FR-027, FR-031] Implement `buildResponse(buckets, bucketResults, summaryResult)` trong `MeetingAverageDurationService`
  - Map kết quả vào từng bucket từ T014; bucket không có trong `bucketResults` (hoặc `count=0`) → `plannedAverageMinutes=null, actualAverageMinutes=null, completedMeetingCount=0`
  - `summary`: tương tự từ `summaryResult`; `count=0` → cả 2 giá trị `null`
  - `summary.completedMeetingCount=0` → thêm `message: 'Không có dữ liệu thời lượng cuộc họp nào cho bộ lọc hiện tại'`

---

## Phase 5: Controller Wiring & Error Handling

- [ ] T020 [FR-004, FR-030] Hoàn thiện `MeetingAverageDurationController.getAverageDuration()`
  - Thứ tự: `resolveDateRange` (T012) → `maxRangeDays` check (T013) → `resolveScope` (T015) → `departmentIds` ownership (T016) → `generateBuckets` (T014) → `getAverageDurationByBucket` + `getAverageDurationSummary` (T017, T018) → `buildResponse` (T019)
  - Audit log non-blocking `action_type='read_analytics_meeting_average_duration'` (gated `AUDIT_LOG_ENABLED`)
  - Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 6: Testing

- [ ] T021 [Test, AC-001, AC-004] [P] Unit test `resolveDateRange()` + `generateBuckets()` (đặc biệt `quarter`)
  - Default tháng hiện tại
  - `granularity=quarter` sinh đúng 4 quý/năm, label `"YYYY-Q#"`, đúng biên Q1 (Jan-Mar)

- [ ] T022 [Test, AC-002, AC-005] [P] Unit test `resolveScope()` + `departmentIds` ownership (tái dùng test case UC-AA-05)

- [ ] T023 [Test, AC-003, AC-006, AC-008] [P] Unit test `getAverageDurationByBucket()` — **quan trọng nhất, cần cover đủ nhánh**
  - Meeting `completed` đủ `room_bookings` + `actual_*` → tính đúng cả 2 giá trị
  - Meeting `completed` chỉ có `presence_*` (không `actual_*`) → dùng fallback đúng
  - Meeting `completed` thiếu cả `actual_*` lẫn `presence_*` → bị loại khỏi CẢ `plannedAverageMinutes` LẪN `actualAverageMinutes` (verify population đồng bộ — test quan trọng nhất)
  - Meeting `status IN ('scheduled','cancelled','draft','pending_approval','in_progress')` → không xuất hiện trong kết quả (Phương án A)
  - Bucket có 0 meeting hợp lệ → không có trong `Map` kết quả (service tự map thành null ở T019)

- [ ] T024 [Test, AC-006, AC-007] [P] Unit test `buildResponse()`
  - Bucket 0 dữ liệu → `null` cho 2 field trung bình, `completedMeetingCount=0` — verify KHÔNG PHẢI `0.0`/`NaN`
  - Toàn kỳ 0 dữ liệu → `summary` toàn `null`, có `message`
  - `series` luôn đủ bucket theo `generateBuckets()`, đúng thứ tự thời gian

- [ ] T025 [Test] [P] Unit test `QueryMeetingAverageDurationDto` validation
  - `granularity`/`departmentIds`/`roomId` sai format → lỗi

- [ ] T026 [Test] [P] Unit test `MeetingAverageDurationController`
  - Request hợp lệ → 200 đúng cấu trúc `{period, summary, series}`
  - Audit log gọi khi thành công, KHÔNG gọi khi lỗi 403/400
  - Lỗi không lường trước → 500 `INTERNAL_ERROR`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T027 [Polish] Verify response format `{success, message, data, meta}`
- [ ] T028 [Polish, FR-001] Verify read-only: không có write operation nào trong service/repository
- [ ] T029 [Polish] Verify raw SQL dùng parameter binding, không nối chuỗi
- [ ] T030 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `DATE_RANGE_TOO_LARGE`, `PERMISSION_DENIED`, `DEPARTMENT_OUT_OF_SCOPE`, `INTERNAL_ERROR`
- [ ] T031 [Polish] Verify KHÔNG seed lại permission `analytics.meeting.read` (đã tồn tại từ UC-AA-04)
- [ ] T032 [Polish] Verify KHÔNG trả `medianMinutes` hoặc hỗ trợ `mode` param (đã bỏ theo quyết định — OOS check)
- [ ] T033 [Test] Chạy toàn bộ kịch bản `quickstart.md` để verify end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Date range/Bucket/Scope)**: Phụ thuộc Phase 2
- **Phase 4 (Aggregation)**: Phụ thuộc Phase 2; phụ thuộc Phase 3 để có bucket list/scope trước khi build response
- **Phase 5 (Wiring)**: Phụ thuộc Phase 3 + Phase 4
- **Phase 6 (Testing)**: Phụ thuộc Phase 5
- **Phase 7 (Polish)**: Phụ thuộc Phase 6

### Parallel Opportunities

- Phase 1: T001-T006 song song (khác file)
- Phase 6: T021-T026 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 + Phase 4 — Business logic đầy đủ (date range, bucket kể cả quarter, scope, population đồng bộ, aggregate, null handling)
3. Phase 5 — Controller hoàn chỉnh, audit log
4. Phase 6 — Unit test toàn bộ nhánh (đặc biệt T023 — population đồng bộ là điểm rủi ro cao nhất của feature này)
5. Phase 7 — Polish, verify quickstart, verify không seed trùng permission, verify không còn sót `mode`/`medianMinutes`

MVP = Phase 1 → Phase 5.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001, FR-002 | T010, T017, T018 |
| FR-003 | T017 (Phương án A) |
| FR-004, FR-016, FR-017 | T009 (guard có sẵn) |
| FR-005–FR-007 | T012, T014 |
| FR-008–FR-011, FR-014, FR-015 | T015, T016, T017 |
| FR-012, FR-013, FR-031 | T019 |
| FR-018 | T016 |
| FR-019–FR-021 | T007 |
| FR-022, FR-032 | T013 |
| FR-023, FR-024 | T015, T016 |
| FR-025–FR-029 | T014, T017, T018, T019 |
| FR-030 | T020 |
