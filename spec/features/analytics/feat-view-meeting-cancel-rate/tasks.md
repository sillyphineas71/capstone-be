# Tasks: Xem thống kê tỷ lệ cuộc họp bị hủy (UC-AA-07 / UC-154)

**Feature**: AA-MEETING-CANCEL-RATE-001 — View Meeting Cancel Rate
**Module**: analytics
**Branch**: `022-view-meeting-cancel-rate`
**Date**: 2026-07-02

**Input documents**:
- spec.md, plan.md, research.md, data-model.md, quickstart.md
- contracts/meeting-cancel-rate-api.md

## Path Conventions

- Source files: `src/modules/analytics/` (thư mục con đã tồn tại từ UC-AA-01/02/04/05/06 — chỉ thêm file mới)
- Tái dùng: `DashboardOverviewConfigService.getMaxRangeDays()`, `generateBuckets()` (`week`/`month`, từ UC-AA-04), `AuthzReadRepository`, `AuditLogsService`, permission `analytics.meeting.read` (đã seed ở UC-AA-04 — **KHÔNG** seed lại), `MeetingEntity`/`UserEntity`/`DepartmentEntity` (đã import từ UC-AA-01/04/05)

---

## Phase 1: Setup

- [ ] T001 [P] Tạo `src/modules/analytics/dto/query-meeting-cancel-rate.dto.ts`
- [ ] T002 [P] Tạo `src/modules/analytics/dto/meeting-cancel-rate-response.dto.ts`
- [ ] T003 [P] Tạo `src/modules/analytics/repositories/meeting-cancel-rate.repository.ts`
- [ ] T004 [P] Tạo `src/modules/analytics/controllers/meeting-cancel-rate.controller.ts`
- [ ] T005 [P] Tạo `src/modules/analytics/services/meeting-cancel-rate.service.ts`
- [ ] T006 [P] Tạo `src/modules/analytics/tests/meeting-cancel-rate.service.spec.ts` và `meeting-cancel-rate.repository.spec.ts`

---

## Phase 2: Foundational

- [ ] T007 [FR-021-FR-028] [P] Implement `QueryMeetingCancelRateDto` trong `query-meeting-cancel-rate.dto.ts`
  - `@IsOptional() @IsEnum(['month_current','month_previous','quarter','custom']) preset?: string`
  - `@IsOptional() @IsDateString() from?: string`
  - `@IsOptional() @IsDateString() to?: string`
  - `@IsOptional() @IsEnum(['week','month']) granularity?: string`
  - `@IsOptional() @IsArray() @IsUUID('4', {each:true}) departmentIds?: string[]`
  - `@IsOptional() @IsUUID() roomId?: string`
  - `@IsOptional() @IsEmail() organizerEmail?: string`

- [ ] T008 [FR-032-FR-037] [P] Implement DTO response trong `meeting-cancel-rate-response.dto.ts`
  - `CancelRatePointDto { period: string; totalCount: number; cancelledCount: number; cancelRate: number }`
  - `TopOrganizerDto { userId: string; email: string; fullName: string; organizedCount: number; cancelledCount: number; cancelRate: number }`
  - `TopDepartmentDto { departmentId: string; departmentName: string; organizedCount: number; cancelledCount: number; cancelRate: number }`
  - `MeetingCancelRateResponseDto { period: {from,to}; totalMeetingCount: number; cancelledCount: number; cancelRate: number; series: CancelRatePointDto[]; topOrganizers: TopOrganizerDto[]; topDepartments: TopDepartmentDto[]; message?: string }`

- [ ] T009 [FR-004] Tạo `MeetingCancelRateController` (shell) trong `meeting-cancel-rate.controller.ts`
  - `@Controller('analytics/meetings')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.meeting.read')` class-level
  - `@Get('cancel-rate') getCancelRate(@Query() query: QueryMeetingCancelRateDto, @CurrentUser() currentUser)`

- [ ] T010 [FR-001, FR-002] Tạo `MeetingCancelRateService` (shell) trong `meeting-cancel-rate.service.ts`
  - Inject: `AuthzReadRepository`, `MeetingCancelRateRepository`, `DashboardOverviewConfigService`
  - `getCancelRate(currentUser, query)` — throw `NotImplementedException` tạm

- [ ] T011 [Module] Cập nhật `src/modules/analytics/analytics.module.ts`
  - Đăng ký `MeetingCancelRateController` vào `controllers`
  - Đăng ký `MeetingCancelRateService`, `MeetingCancelRateRepository` vào `providers`
  - Xác nhận `TypeOrmModule.forFeature` đã có `MeetingEntity`, `UserEntity`, `DepartmentEntity`

---

## Phase 3: Business Logic — Preset, Bucket, Scope

- [ ] T012 [FR-005-FR-007] Implement `resolvePresetRange(preset, from, to)` trong `MeetingCancelRateService`
  - `month_current` (mặc định nếu thiếu `preset`) → đầu/cuối tháng hiện tại (timezone `Asia/Ho_Chi_Minh`)
  - `month_previous` → đầu/cuối tháng trước (xử lý đúng biên năm: tháng 1 → tháng 12 năm trước)
  - `quarter` → đầu/cuối quý dương lịch hiện tại (Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec)
  - `custom` → dùng `from`/`to` truyền vào; thiếu hoặc `from > to` → `BadRequestException({code:'VALIDATION_ERROR'})`
  - `preset` khác `custom` mà vẫn có `from`/`to` kèm theo → bỏ qua `from`/`to`

- [ ] T013 [FR-029, NFR-002] Implement check `maxRangeDays` trong `MeetingCancelRateService`
  - Gọi `DashboardOverviewConfigService.getMaxRangeDays()` (tái dùng, KHÔNG tạo config mới)
  - Vượt ngưỡng → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`

- [ ] T014 [FR-008, FR-009, FR-035] Tái dùng `generateBuckets(from, to, granularity)` đã có ở UC-AA-04 trong `MeetingCancelRateService`
  - Chỉ hỗ trợ `week`/`month` — **KHÔNG** thêm nhánh `quarter` (khác UC-AA-06; `quarter` ở đây là khái niệm `preset`, không phải `granularity`)
  - `granularity` thiếu → mặc định `'week'`

- [ ] T015 [FR-010-FR-012, FR-DATA-001] Implement `resolveScope(currentUser)` trong `MeetingCancelRateService`
  - Tái dùng đúng pattern tĩnh đã có ở UC-AA-01/04/05/06

- [ ] T016 [FR-019, FR-023, AC-004] Implement check `departmentIds` ownership (multi-select) trong `MeetingCancelRateService`
  - Tái dùng logic đã viết ở UC-AA-05/06

- [ ] T017 [FR-014, FR-018, FR-DATA-002] Implement `resolveOrganizerId(organizerEmail)` trong `MeetingCancelRateService`
  - Query `users` theo `LOWER(email) = LOWER(:organizerEmail)`
  - Không tìm thấy → set flag "no-match", service sẽ trả response rỗng theo FR-015 mà KHÔNG query aggregation tiếp (tối ưu, tránh query thừa)

---

## Phase 4: Business Logic — Aggregation

- [ ] T018 [FR-003, FR-032, FR-033, FR-DATA] Implement `getCancelRateSummary(params)` trong `meeting-cancel-rate.repository.ts`
  - JOIN `meetings m` INNER JOIN `users u ON u.id = m.organizer_id`
  - WHERE `m.status <> 'draft'`, `m.deleted_at IS NULL`, `m.start_time BETWEEN $from AND $to`, scope + `departmentIds`/`roomId`/`organizerId` filter
  - Trả `{ totalMeetingCount: COUNT(*), cancelledCount: COUNT(*) FILTER (WHERE m.status='cancelled') }`
  - Parameterized, không nối chuỗi

- [ ] T019 [FR-035] Implement `getCancelRateSeries(params)` trong repository
  - Cùng điều kiện WHERE ở T018, `GROUP BY date_trunc(:granularity, m.start_time)`
  - Trả `Map<bucketKey, {totalCount, cancelledCount}>`

- [ ] T020 [FR-036] Implement `getTopOrganizers(params)` trong repository
  - Cùng điều kiện WHERE ở T018, `GROUP BY m.organizer_id, u.email, u.full_name`
  - `HAVING COUNT(*) >= 3`
  - `ORDER BY cancelledCount DESC, cancelRate DESC`, `LIMIT 10`
  - Trả `{userId, email, fullName, organizedCount, cancelledCount}[]`

- [ ] T021 [FR-037] Implement `getTopDepartments(params)` trong repository
  - Cùng điều kiện WHERE ở T018, thêm `JOIN departments d ON d.id = u.department_id`
  - `GROUP BY u.department_id, d.department_name`, `HAVING COUNT(*) >= 3`
  - `ORDER BY cancelledCount DESC, cancelRate DESC`, `LIMIT 10`
  - **Chỉ được gọi hàm này từ service khi `currentUser.role <> MANAGER`** (T023) — không tự filter theo role bên trong repository

- [ ] T022 [FR-034, FR-012, FR-013] Implement `buildResponse(summary, series, topOrganizers, topDepartments, buckets)` trong `MeetingCancelRateService`
  - Map `series` kết quả vào từng bucket từ T014; bucket không có dữ liệu → `totalCount=0, cancelledCount=0, cancelRate=0`
  - Tính `cancelRate` cho summary/mỗi bucket/mỗi phần tử ranking: `cancelledCount/totalCount*100` (hoặc `/organizedCount` cho ranking), làm tròn 1 chữ số thập phân; mẫu số 0 → `0`
  - `summary.totalMeetingCount=0` → thêm `message: 'Không có dữ liệu thiết lập cuộc họp nào cho bộ lọc hiện tại'`

- [ ] T023 [FR-017] Implement guard MANAGER cho `topDepartments` trong `MeetingCancelRateService`
  - `IF currentUser.role === 'MANAGER' THEN topDepartments = []` (gán cứng, **KHÔNG gọi** `repository.getTopDepartments()`)
  - `ELSE topDepartments = await repository.getTopDepartments(params)`

---

## Phase 5: Controller Wiring & Error Handling

- [ ] T024 [FR-004, FR-030, FR-038] Hoàn thiện `MeetingCancelRateController.getCancelRate()` / `MeetingCancelRateService.getCancelRate()`
  - Thứ tự: `resolvePresetRange` (T012) → `maxRangeDays` check (T013) → `resolveScope` (T015) → `departmentIds` ownership (T016) → `resolveOrganizerId` (T017, nếu `organizerEmail` có truyền) → nếu no-match → trả response rỗng ngay (FR-015/FR-018) → `generateBuckets` (T014) → `getCancelRateSummary`/`getCancelRateSeries` (T018, T019) → `getTopOrganizers` (T020) → guard + `getTopDepartments` (T021, T023) → `buildResponse` (T022)
  - Audit log non-blocking `action_type='read_analytics_meeting_cancel_rate'` (gated `AUDIT_LOG_ENABLED`), `metadata_json` gồm `{viewerUserId, viewerRole, from, to, granularity, departmentIds, roomId, organizerEmail, resolvedScopeDepartmentIds}`
  - Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 6: Testing

- [ ] T025 [Test, AC-005] [P] Unit test `resolvePresetRange()`
  - `month_current` mặc định đúng đầu/cuối tháng hiện tại
  - `month_previous` đúng đầu/cuối tháng trước, kể cả biên năm (tháng 1 → tháng 12 năm trước)
  - `quarter` đúng biên quý, đặc biệt Q1 (Jan-Mar)
  - `custom` thiếu `from`/`to` hoặc `from>to` → lỗi `VALIDATION_ERROR`

- [ ] T026 [Test, AC-004] [P] Unit test `resolveScope()` + `departmentIds` ownership (tái dùng test case UC-AA-05/06)

- [ ] T027 [Test, AC-001, AC-007] [P] Unit test `getCancelRateSummary()` + `getCancelRateSeries()`
  - Meeting `status='cancelled'` (chủ động hủy) → tính vào `cancelledCount`
  - Meeting `status='cancelled'` do approver reject (actor ≠ organizer) → **vẫn** tính vào `cancelledCount` của organizer gốc — verify không cần UNION `meeting_requests`
  - Meeting `status='draft'` → loại khỏi `totalMeetingCount`
  - `totalMeetingCount = SUM(series[].totalCount)`, `cancelledCount = SUM(series[].cancelledCount)` khớp nhau
  - Toàn `[from,to]` không có meeting nào → `series` đủ bucket giá trị 0

- [ ] T028 [Test, AC-003, AC-008] [P] Unit test `getTopOrganizers()` — **quan trọng nhất, cần cover đủ nhánh**
  - Organizer tổ chức 5 meeting, 3 cancelled → `organizedCount=5, cancelledCount=3, cancelRate=60`
  - Organizer tổ chức 1 meeting, 1 cancelled (`cancelRate=100%`) → **KHÔNG** xuất hiện trong kết quả (verify ngưỡng `organizedCount >= 3`, FR-016)
  - Meeting bị approver (không phải organizer) reject → tính vào `cancelledCount` của **organizer**, KHÔNG phải actor thực hiện reject (verify ranking theo organizer, không theo `updated_by`/actor)
  - Sort đúng thứ tự: `cancelledCount` giảm dần trước, `cancelRate` là tie-breaker

- [ ] T029 [Test, AC-002] [P] Unit test `getTopDepartments()` + guard MANAGER trong service
  - Role BUSINESS_ADMIN/SYSTEM_ADMIN → `topDepartments` có dữ liệu đúng ngưỡng/sort như T028
  - Role MANAGER → `topDepartments` LUÔN `[]`, và spy verify `repository.getTopDepartments()` **KHÔNG được gọi** (đảm bảo không rò rỉ dữ liệu phòng ban khác dù repository có bug)

- [ ] T030 [Test, AC-009, AC-007] [P] Unit test `resolveOrganizerId()` + EX1
  - `organizerEmail` khớp đúng 1 user (không phân biệt hoa/thường) → filter đúng `organizer_id`
  - `organizerEmail` không khớp user nào → trả response rỗng theo FR-015, KHÔNG phải lỗi 400/404
  - Manager không quản lý phòng ban nào → response rỗng tương tự, không lỗi

- [ ] T031 [Test] [P] Unit test `QueryMeetingCancelRateDto` validation
  - `preset`/`granularity`/`departmentIds`/`roomId`/`organizerEmail` sai format → lỗi `VALIDATION_ERROR`

- [ ] T032 [Test] [P] Unit test `MeetingCancelRateController`
  - Request hợp lệ → 200 đúng cấu trúc `{period, totalMeetingCount, cancelledCount, cancelRate, series, topOrganizers, topDepartments}`
  - Audit log gọi khi thành công, KHÔNG gọi khi lỗi 403/400
  - Lỗi không lường trước → 500 `INTERNAL_ERROR`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T033 [Polish] Verify response format `{success, message, data, meta}`
- [ ] T034 [Polish, FR-001] Verify read-only: không có write operation nào trong service/repository
- [ ] T035 [Polish] Verify raw SQL dùng parameter binding, không nối chuỗi
- [ ] T036 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `DATE_RANGE_TOO_LARGE`, `PERMISSION_DENIED`, `DEPARTMENT_OUT_OF_SCOPE`, `INTERNAL_ERROR`
- [ ] T037 [Polish] Verify KHÔNG seed lại permission `analytics.meeting.read` (đã tồn tại từ UC-AA-04)
- [ ] T038 [Polish] Verify KHÔNG ranking theo actor hủy (`updated_by`/`meeting_events.actor_user_id`) ở bất kỳ đâu trong code — chỉ dùng `organizer_id` (OOS-003 spec.md)
- [ ] T039 [Polish] Verify KHÔNG tạo `system_configs` key mới cho ngưỡng `organizedCount >= 3` (giữ hardcode theo quyết định CL-2)
- [ ] T040 [Test] Chạy toàn bộ kịch bản `quickstart.md` để verify end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Preset/Bucket/Scope)**: Phụ thuộc Phase 2
- **Phase 4 (Aggregation)**: Phụ thuộc Phase 2; phụ thuộc Phase 3 để có bucket list/scope/organizerId trước khi build response
- **Phase 5 (Wiring)**: Phụ thuộc Phase 3 + Phase 4
- **Phase 6 (Testing)**: Phụ thuộc Phase 5
- **Phase 7 (Polish)**: Phụ thuộc Phase 6

### Parallel Opportunities

- Phase 1: T001-T006 song song (khác file)
- Phase 6: T025-T032 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 + Phase 4 — Business logic đầy đủ (preset mới, scope, ranking organizer-based, guard MANAGER cho topDepartments, ngưỡng chống nhiễu)
3. Phase 5 — Controller hoàn chỉnh, audit log
4. Phase 6 — Unit test toàn bộ nhánh (đặc biệt T028 ranking-theo-organizer và T029 guard-MANAGER là 2 điểm rủi ro cao nhất của feature này)
5. Phase 7 — Polish, verify quickstart, verify không seed trùng permission, verify không lẫn actor-hủy vào ranking

MVP = Phase 1 → Phase 5.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001, FR-002 | T010, T018, T019 |
| FR-003 | T018 |
| FR-004 | T009 |
| FR-005–FR-007 | T012 |
| FR-008, FR-009 | T014 |
| FR-010–FR-012 | T015, T016 |
| FR-013 | T018 |
| FR-014 | T017 |
| FR-015 | T022, T024 |
| FR-016 | T020, T021 |
| FR-017 | T023 |
| FR-018 | T017, T024 |
| FR-019, FR-020 | T016, T018 |
| FR-021–FR-028 | T007 |
| FR-029 | T013 |
| FR-030, FR-031 | T015 |
| FR-032–FR-034 | T018, T022 |
| FR-035 | T014, T019 |
| FR-036 | T020 |
| FR-037 | T021, T023 |
| FR-038 | T024 |
| FR-039, FR-040 | T015, T013 |
