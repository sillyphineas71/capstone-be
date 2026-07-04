# Tasks: Xem thống kê tỷ lệ no-show (UC-AA-09 / UC-156)

**Feature**: AA-NO-SHOW-RATE-001 — View No-show Rate Analytics
**Module**: analytics
**Branch**: `024-view-no-show-rate`
**Date**: 2026-07-02

**Input documents**:
- spec.md, plan.md

## Path Conventions

- Source files: `src/modules/analytics/` (thư mục con đã tồn tại từ UC-AA-01/02/04/05/06/07/08 — chỉ thêm file mới)
- Tái dùng: `DashboardOverviewConfigService.getMaxRangeDays()` (UC-AA-01), `AuthzReadRepository`, `AuditLogsService`, permission `analytics.room.read` (đã seed ở UC-AA-02 — **KHÔNG** seed lại), `NoShowCaseEntity`/`RoomBookingEntity`/`RoomEntity`/`MeetingEntity`/`UserEntity`/`DepartmentEntity` (đã import từ UC-AA-01/02)
- **KHÔNG** import repository/service của UC-AA-01/02/07/08 — viết lại các đoạn SQL scope resolution ngắn độc lập trong repository mới (xem plan.md Structure Decision)

---

## Phase 1: Setup

- [ ] T001 [P] Tạo `src/modules/analytics/dto/query-no-show-rate.dto.ts`
- [ ] T002 [P] Tạo `src/modules/analytics/dto/no-show-rate-response.dto.ts`
- [ ] T003 [P] Tạo `src/modules/analytics/repositories/no-show-rate.repository.ts`
- [ ] T004 [P] Tạo `src/modules/analytics/controllers/no-show-rate.controller.ts`
- [ ] T005 [P] Tạo `src/modules/analytics/services/no-show-rate.service.ts`
- [ ] T006 [P] Tạo `src/modules/analytics/tests/no-show-rate.service.spec.ts` và `no-show-rate.repository.spec.ts`

---

## Phase 2: Foundational

- [ ] T007 [FR-025-FR-029] [P] Implement `QueryNoShowRateDto` trong `query-no-show-rate.dto.ts`
  - `@IsOptional() @IsEnum(['day','week','month','quarter','custom']) preset?: string`
  - `@IsOptional() @IsDateString() from?: string`
  - `@IsOptional() @IsDateString() to?: string`
  - `@IsOptional() @IsArray() @IsUUID('4', {each:true}) departmentIds?: string[]`
  - `@IsOptional() @IsUUID() roomId?: string`
  - `@IsOptional() @IsEmail() organizerEmail?: string`
  - `@IsOptional() @IsEnum(['room','department','organizer']) rankBy?: string`
  - `@IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number`
  - `@IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number`

- [ ] T008 [FR-036-FR-039] [P] Implement DTO response trong `no-show-rate-response.dto.ts`
  - `RankingItemDto { id: string; name: string; email?: string; noShowCount: number; totalBookings: number; noShowRate: number; lowSampleSize: boolean }`
  - `RankingDto { rankBy: string; items: RankingItemDto[]; page: number; limit: number; total: number; totalPages: number }`
  - `NoShowRateResponseDto { period: {from,to}; noShowCount: number; totalBookings: number; noShowRate: number; ranking: RankingDto; message?: string }`

- [ ] T009 [FR-004] Tạo `NoShowRateController` (shell) trong `no-show-rate.controller.ts`
  - `@Controller('analytics/rooms')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.room.read')` class-level
  - `@Get('no-show-rate') getNoShowRate(@Query() query: QueryNoShowRateDto, @CurrentUser() currentUser)`

- [ ] T010 [FR-001, FR-002] Tạo `NoShowRateService` (shell) trong `no-show-rate.service.ts`
  - Inject: `AuthzReadRepository`, `NoShowRateRepository`, `DashboardOverviewConfigService`
  - `getNoShowRate(currentUser, query)` — throw `NotImplementedException` tạm

- [ ] T011 [Module] Cập nhật `src/modules/analytics/analytics.module.ts`
  - Đăng ký `NoShowRateController` vào `controllers`
  - Đăng ký `NoShowRateService`, `NoShowRateRepository` vào `providers`
  - Xác nhận `TypeOrmModule.forFeature` đã có `NoShowCaseEntity`, `RoomBookingEntity`, `RoomEntity`, `MeetingEntity`, `UserEntity`, `DepartmentEntity`

---

## Phase 3: Business Logic — Preset, Scope, Validation

- [ ] T012 [FR-005-FR-007] Implement `resolveDateRange(query)` trong `NoShowRateService`
  - `preset` thiếu → mặc định `'month'`
  - `day/week/month` → tính theo timezone `Asia/Ho_Chi_Minh` (tái dùng logic UC-AA-02)
  - `quarter` → quý dương lịch hiện tại (tái dùng công thức UC-AA-06/08)
  - `custom` → dùng `from`/`to`; thiếu hoặc `from>to` → `BadRequestException({code:'VALIDATION_ERROR'})`

- [ ] T013 [FR-030, NFR-002] Implement check `maxRangeDays` trong `NoShowRateService`
  - Gọi `DashboardOverviewConfigService.getMaxRangeDays()` (tái dùng, KHÔNG tạo config mới)
  - Vượt ngưỡng → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`

- [ ] T014 [FR-008-FR-010, FR-DATA-001] Implement `resolveDepartmentScope(currentUser)` trong `NoShowRateService`
  - Viết lại SQL độc lập `SELECT id FROM departments WHERE manager_user_id = :userId` (không import UC-AA-01)
  - `SYSTEM_ADMIN`/`BUSINESS_ADMIN` → `null` (không giới hạn)

- [ ] T015 [FR-023, ERR-009] Implement check `departmentIds` ownership trong `NoShowRateService`
  - MANAGER truyền `departmentIds` có phần tử ngoài scope → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`

- [ ] T016 [FR-011, FR-DATA-002] Implement `resolveRoomScope(currentUser, from, to)` trong `NoShowRateService`
  - Chỉ gọi khi `rankBy='room'` hoặc có truyền `roomId`
  - Viết lại SQL độc lập theo đúng công thức scope động UC-AA-02/08 (không import repository UC-AA-08)

- [ ] T017 [FR-024, ERR-010] Implement check `roomId` ownership trong `NoShowRateService`
  - MANAGER truyền `roomId` ngoài scope kỳ lọc → `ForbiddenException({code:'ROOM_OUT_OF_SCOPE'})`

- [ ] T018 [FR-012, FR-019, FR-DATA-003] Implement `resolveOrganizerId(organizerEmail)` trong `NoShowRateService`
  - Query `users` theo `LOWER(email) = LOWER(:organizerEmail)`
  - Không tìm thấy → set flag "no-match", service trả response rỗng theo FR-017 mà KHÔNG query aggregation tiếp

---

## Phase 4: Business Logic — Aggregation

- [ ] T019 [FR-003, FR-033-FR-035] Implement `getKpiAggregate(params)` trong `no-show-rate.repository.ts`
  - `room_bookings` WHERE `status IN ('approved','active','completed','released')`, `reserved_start_time BETWEEN $from AND $to`, scope + `departmentIds`/`roomId`/`organizerId` filter (JOIN `meetings.organizer_id = users.id`)
  - `totalBookings = COUNT(DISTINCT room_bookings.id)`
  - LEFT JOIN `no_show_cases ON no_show_cases.booking_id = room_bookings.id`
  - `noShowCount = COUNT(DISTINCT no_show_cases.id) FILTER (WHERE no_show_cases.detection_status IN ('confirmed','released'))`
  - Parameterized, không nối chuỗi

- [ ] T020 [FR-036] Implement `getRoomRanking(params, page, limit)` trong repository
  - Cùng WHERE clause builder ở T019, `INNER JOIN rooms ON rooms.id = room_bookings.room_id`
  - `GROUP BY rooms.id, rooms.room_name`
  - `ORDER BY noShowCount DESC, noShowRate DESC`, `LIMIT :limit OFFSET (:page-1)*:limit`
  - Trả kèm `total` (query đếm riêng số nhóm, hoặc `COUNT(*) OVER()`)

- [ ] T021 [FR-037] Implement `getDepartmentRanking(params, page, limit)` trong repository
  - Cùng WHERE clause builder, `INNER JOIN departments ON departments.id = users.department_id`
  - `GROUP BY users.department_id, departments.department_name`
  - `ORDER BY noShowRate DESC, noShowCount DESC`

- [ ] T022 [FR-038] Implement `getOrganizerRanking(params, page, limit)` trong repository
  - Cùng WHERE clause builder, `GROUP BY meetings.organizer_id, users.email, users.full_name`
  - `ORDER BY noShowCount DESC, noShowRate DESC`

- [ ] T023 [FR-018, FR-039] Implement build `RankingDto` trong `NoShowRateService`
  - Gọi đúng 1 trong T020/T021/T022 theo `rankBy` (mặc định `'room'`)
  - Mỗi item: `noShowRate = round(noShowCount/totalBookings*100, 1)` (mẫu số 0 → `0`), `lowSampleSize = totalBookings < 3`
  - Gộp `{rankBy, items, page, limit, total, totalPages}`

- [ ] T024 [FR-002, FR-013, FR-014, FR-017] Implement `buildResponse(kpi, ranking)` trong `NoShowRateService`
  - `noShowRate` tổng = `round(kpi.noShowCount/kpi.totalBookings*100, 1)` (mẫu số 0 → `0`)
  - `kpi.noShowCount === 0` (bất kể `totalBookings`) → `ranking.items=[]`, thêm `message`: "Tuyệt vời! Không ghi nhận trường hợp lãng phí phòng họp nào trong khoảng thời gian này."

---

## Phase 5: Controller Wiring & Error Handling

- [ ] T025 [FR-004, FR-031, FR-040] Hoàn thiện `NoShowRateController.getNoShowRate()` / `NoShowRateService.getNoShowRate()`
  - Thứ tự: `resolveDateRange` (T012) → `maxRangeDays` check (T013) → `resolveDepartmentScope` (T014) → `departmentIds` ownership (T015) → `resolveRoomScope` nếu cần (T016) → `roomId` ownership (T017) → `resolveOrganizerId` nếu có (T018) → nếu no-match → trả response rỗng ngay (FR-017/FR-019) → `getKpiAggregate` (T019) → ranking theo `rankBy` (T020/T021/T022, T023) → `buildResponse` (T024)
  - Audit log non-blocking `action_type='read_analytics_no_show_rate'` (gated `AUDIT_LOG_ENABLED`), `metadata_json` gồm `{viewerUserId, viewerRole, from, to, rankBy, page, limit, departmentIds, roomId, organizerEmail, resolvedScopeDepartmentIds}`
  - Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 6: Testing

- [ ] T026 [Test, AC-001] [P] Unit test `resolveDateRange()`
  - 4 preset cũ (day/week/month/custom) + `quarter` đúng biên (Q1 Jan-Mar)

- [ ] T027 [Test, AC-002] [P] Unit test `resolveDepartmentScope()`/`resolveRoomScope()` + ownership checks (tái dùng test case UC-AA-01/02/08)

- [ ] T028 [Test, AC-004] [P] Unit test `ROOM_OUT_OF_SCOPE`/`DEPARTMENT_OUT_OF_SCOPE` (T015, T017)

- [ ] T029 [Test] [P] Unit test `getKpiAggregate()` — **quan trọng nhất, định nghĩa cốt lõi**
  - `detection_status IN ('confirmed','released')` → tính vào `noShowCount`
  - `detection_status IN ('risk','warning_sent','dismissed','resolved')` → KHÔNG tính (verify đủ cả 4 trạng thái loại trừ)
  - Lọc theo `room_bookings.reserved_start_time` — booking đúng biên đầu/cuối kỳ lọc đúng, KHÔNG dùng `no_show_cases.detected_at`/`meetings.start_time`
  - `totalBookings` chỉ đếm `status IN ('approved','active','completed','released')`, loại `pending`/`cancelled`

- [ ] T030 [Test, AC-003, AC-007] [P] Unit test `getRoomRanking()`/`getDepartmentRanking()`/`getOrganizerRanking()` — **quan trọng nhất, rủi ro cao nhất**
  - `room`: sort đúng theo `noShowCount` DESC (không phải `noShowRate`)
  - `department`: sort đúng theo `noShowRate` DESC (không phải `noShowCount`) — verify KHÔNG lẫn tiêu chí với 2 nhánh còn lại
  - `organizer`: sort đúng theo `noShowCount` DESC
  - Phân trang đúng `page`/`limit`/`total`/`totalPages`
  - Item có `totalBookings<3` → `lowSampleSize=true` NHƯNG vẫn xuất hiện trong `items` (verify KHÔNG bị loại — khác pattern ngưỡng loại trừ của UC-AA-07)

- [ ] T031 [Test, AC-002] [P] Unit test `rankBy=department` với role MANAGER
  - Trả đúng 1 phần tử (phòng ban của Manager), không lỗi, không cần guard đặc biệt (hành vi tự nhiên từ scope)

- [ ] T032 [Test, AC-006] [P] Unit test EX1 (`noShowCount=0`)
  - Kỳ có `totalBookings>0` nhưng `noShowCount=0` → vẫn trigger EX1 với message tích cực nguyên văn
  - `organizerEmail` không khớp user nào → trả response rỗng như EX1, không lỗi

- [ ] T033 [Test] [P] Unit test `QueryNoShowRateDto` validation + controller
  - `preset`/`rankBy`/`page`/`limit`/`departmentIds`/`roomId`/`organizerEmail` sai format → lỗi `VALIDATION_ERROR`
  - Request hợp lệ → 200 đúng cấu trúc `{period, noShowCount, totalBookings, noShowRate, ranking}`
  - Audit log gọi khi thành công, KHÔNG gọi khi lỗi 403/400
  - Lỗi không lường trước → 500 `INTERNAL_ERROR`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T034 [Polish] Verify response format `{success, message, data, meta}`
- [ ] T035 [Polish, FR-001] Verify read-only: không có write operation nào trong service/repository
- [ ] T036 [Polish] Verify raw SQL dùng parameter binding, không nối chuỗi
- [ ] T037 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `DATE_RANGE_TOO_LARGE`, `PERMISSION_DENIED`, `DEPARTMENT_OUT_OF_SCOPE`, `ROOM_OUT_OF_SCOPE`, `INTERNAL_ERROR`
- [ ] T038 [Polish] Verify KHÔNG seed lại permission `analytics.room.read` (đã tồn tại từ UC-AA-02)
- [ ] T039 [Polish] Verify KHÔNG có `trend`/`groupBy` nào trong response (đã loại theo OOS-001 spec.md)
- [ ] T040 [Polish] Verify KHÔNG có logic loại trừ mẫu nhỏ khỏi `ranking.items` ở bất kỳ đâu (chỉ gắn cờ `lowSampleSize` — OOS-003 spec.md)
- [ ] T041 [Test] Chạy lại toàn bộ Acceptance Criteria trong spec.md §7 để verify end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Preset/Scope/Validation)**: Phụ thuộc Phase 2
- **Phase 4 (Aggregation)**: Phụ thuộc Phase 2; phụ thuộc Phase 3 để có kỳ + scope trước khi aggregate
- **Phase 5 (Wiring)**: Phụ thuộc Phase 3 + Phase 4
- **Phase 6 (Testing)**: Phụ thuộc Phase 5
- **Phase 7 (Polish)**: Phụ thuộc Phase 6

### Parallel Opportunities

- Phase 1: T001-T006 song song (khác file)
- Phase 4: T020-T022 song song (3 hàm ranking độc lập trong cùng repository file)
- Phase 6: T026-T033 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 + Phase 4 — Business logic đầy đủ (preset, scope phòng ban/phòng, KPI, 3 nhánh ranking đúng tiêu chí sort riêng, cờ lowSampleSize, EX1)
3. Phase 5 — Controller hoàn chỉnh, audit log
4. Phase 6 — Unit test toàn bộ nhánh (đặc biệt T029 định-nghĩa-no-show và T030 sort-3-nhánh là 2 điểm rủi ro cao nhất của feature này)
5. Phase 7 — Polish, verify không seed trùng permission, verify không còn trend/groupBy, verify không loại mẫu nhỏ

MVP = Phase 1 → Phase 5.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001, FR-002 | T010, T019, T024 |
| FR-003 | T019 |
| FR-004 | T009 |
| FR-005–FR-007 | T012 |
| FR-008–FR-010 | T014, T015 |
| FR-011 | T016, T017 |
| FR-012 | T018 |
| FR-013, FR-014 | T023, T024 |
| FR-015, FR-016 | T020, T021, T022 |
| FR-017 | T024 |
| FR-018 | T023 |
| FR-019 | T018 |
| FR-020 | T015, T017, T019 |
| FR-021–FR-030 | T007, T013, T015, T017 |
| FR-031, FR-032 | T014, T016 |
| FR-033–FR-035 | T019, T024 |
| FR-036–FR-038 | T020, T021, T022 |
| FR-039 | T023 |
| FR-040 | T025 |
| FR-041, FR-042 | T014, T013 |
