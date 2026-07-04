# Tasks: Xem thống kê tỷ lệ tham dự đúng giờ (UC-AA-10 / UC-157)

**Feature**: AA-ON-TIME-RATE-001 — View On-time Attendance Rate
**Module**: analytics
**Branch**: `025-view-on-time-rate`
**Date**: 2026-07-02

**Input documents**:
- spec.md, plan.md

## Path Conventions

- Source files: `src/modules/analytics/` (thư mục con đã tồn tại từ UC-AA-01/02/04/05/06/07/08/09 — chỉ thêm file mới)
- Seed file: `src/database/seeds/`
- Tái dùng: `DashboardOverviewConfigService.getMaxRangeDays()` (UC-AA-01), `AuthzReadRepository`, `AuditLogsService`, `AttendanceRecordEntity`/`MeetingParticipantEntity`/`MeetingEntity`/`UserEntity`/`DepartmentEntity` (đã import từ module khác)
- **KHÔNG** import repository/service của UC-AA-01/07/09 — viết SQL scope resolution độc lập trong repository mới (xem plan.md Structure Decision)
- **PHẢI seed permission mới** `analytics.attendance.read` — KHÁC các feature UC-AA-04–09 trước đó (chỉ tái dùng permission đã có)

---

## Phase 1: Setup

- [ ] T001 [P] Tạo `src/modules/analytics/dto/query-on-time-rate.dto.ts`
- [ ] T002 [P] Tạo `src/modules/analytics/dto/query-late-history.dto.ts`
- [ ] T003 [P] Tạo `src/modules/analytics/dto/on-time-rate-response.dto.ts`
- [ ] T004 [P] Tạo `src/modules/analytics/repositories/on-time-rate.repository.ts`
- [ ] T005 [P] Tạo `src/modules/analytics/controllers/on-time-rate.controller.ts`
- [ ] T006 [P] Tạo `src/modules/analytics/services/on-time-rate.service.ts`
- [ ] T007 [P] Tạo `src/modules/analytics/tests/on-time-rate.service.spec.ts` và `on-time-rate.repository.spec.ts`

---

## Phase 2: Foundational

- [ ] T008 [FR-026-FR-029] [P] Implement `QueryOnTimeRateDto` trong `query-on-time-rate.dto.ts`
  - `@IsOptional() @IsEnum(['day','week','month','quarter','custom']) preset?: string`
  - `@IsOptional() @IsDateString() from?: string`
  - `@IsOptional() @IsDateString() to?: string`
  - `@IsOptional() @IsUUID() departmentId?: string`
  - `@IsOptional() @IsUUID() meetingId?: string`
  - `@IsOptional() @IsString() @MaxLength(150) search?: string`
  - `@IsOptional() @Type(() => Number) @IsInt() @Min(0) graceMinutes?: number`

- [ ] T009 [FR-026, FR-029] [P] Implement `QueryLateHistoryDto` trong `query-late-history.dto.ts`
  - Giống T008 nhưng KHÔNG có `departmentId`/`meetingId`/`search` (`userId` qua path param)

- [ ] T010 [FR-039-FR-041] [P] Implement DTO response trong `on-time-rate-response.dto.ts`
  - `TrendPointDto { period: string; onTimeCount: number; lateCount: number; absentCount: number; totalRequiredParticipants: number; onTimeRate: number }`
  - `HourBucketDto { hourOfDay: number; lateCount: number; totalRequiredParticipants: number; lateRate: number }`
  - `DepartmentLateItemDto { departmentId: string; departmentName: string; lateCount: number; totalRequiredParticipants: number; lateRate: number }`
  - `OnTimeRateResponseDto { period: {from,to}; graceMinutes: number; onTimeCount: number; lateCount: number; absentCount: number; totalRequiredParticipants: number; onTimeRate: number; trend: TrendPointDto[]; lateByHourOfDay: HourBucketDto[]; lateByDepartment: DepartmentLateItemDto[]; message?: string }`
  - `LateMeetingItemDto { meetingId: string; meetingTitle: string; scheduledStartTime: Date; checkInTime: Date; lateMinutes: number }`
  - `LateHistoryResponseDto { user: {userId,fullName,email}; period: {from,to}; lateMeetings: LateMeetingItemDto[] }`

- [ ] T011 [FR-004, FR-015] Tạo `OnTimeRateController` (shell) trong `on-time-rate.controller.ts`
  - `@Controller('analytics/attendance')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.attendance.read')` class-level
  - `@Get('on-time-rate') getOnTimeRate(@Query() query: QueryOnTimeRateDto, @CurrentUser() currentUser)`
  - `@Get('on-time-rate/users/:userId/late-history') getLateHistory(@Param('userId', ParseUUIDPipe) userId: string, @Query() query: QueryLateHistoryDto, @CurrentUser() currentUser)`

- [ ] T012 [FR-001, FR-002] Tạo `OnTimeRateService` (shell) trong `on-time-rate.service.ts`
  - Inject: `AuthzReadRepository`, `OnTimeRateRepository`, `DashboardOverviewConfigService`
  - `getOnTimeRate(currentUser, query)` và `getLateHistory(currentUser, userId, query)` — throw `NotImplementedException` tạm

- [ ] T013 [Module] Cập nhật `src/modules/analytics/analytics.module.ts`
  - Đăng ký `OnTimeRateController` vào `controllers`
  - Đăng ký `OnTimeRateService`, `OnTimeRateRepository` vào `providers`
  - Xác nhận `TypeOrmModule.forFeature` đã có `AttendanceRecordEntity`, `MeetingParticipantEntity`, `MeetingEntity`, `UserEntity`, `DepartmentEntity`

---

## Phase 3: Business Logic — Preset, Scope, Validation

- [ ] T014 [FR-005-FR-007] Implement `resolveDateRange(query)` trong `OnTimeRateService`
  - `preset` thiếu → mặc định `'month'`
  - `day/week/month` → tính theo timezone `Asia/Ho_Chi_Minh` (tái dùng logic UC-AA-02)
  - `quarter` → quý dương lịch hiện tại (tái dùng công thức UC-AA-06/08)
  - `custom` → dùng `from`/`to`; thiếu hoặc `from>to` → `BadRequestException({code:'VALIDATION_ERROR'})`

- [ ] T015 [FR-030, NFR-002] Implement check `maxRangeDays` trong `OnTimeRateService`
  - Gọi `DashboardOverviewConfigService.getMaxRangeDays()` (tái dùng, KHÔNG tạo config mới)
  - Vượt ngưỡng → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`

- [ ] T016 [FR-008-FR-010, FR-032, FR-DATA-001] Implement `resolveDepartmentScope(currentUser)` trong `OnTimeRateService` — **MỚI, khác pattern organizer**
  - Viết SQL độc lập `SELECT id FROM departments WHERE manager_user_id = :userId` (không import UC-AA-01/07/09)
  - `SYSTEM_ADMIN`/`BUSINESS_ADMIN` → `null` (không giới hạn)
  - Scope áp dụng lọc `users.department_id` của NGƯỜI THAM DỰ, KHÔNG qua `meetings.organizer_id`

- [ ] T017 [FR-024, ERR-008] Implement check `departmentId` ownership trong `OnTimeRateService`
  - MANAGER truyền `departmentId` ngoài scope → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`

- [ ] T018 [FR-016, FR-025, FR-031, ERR-009, ERR-010] Implement check `userId` (drill-down) tồn tại + ownership trong `OnTimeRateService`
  - `userId` không tồn tại → `NotFoundException({code:'USER_NOT_FOUND'})` (check trước)
  - MANAGER và `userId.department_id NOT IN scopeDepartmentIds` → `ForbiddenException({code:'USER_OUT_OF_SCOPE'})`

- [ ] T019 [FR-013] Implement default `graceMinutes=0` trong `OnTimeRateService` (nếu query thiếu)

---

## Phase 4: Business Logic — Aggregation

- [ ] T020 [FR-003, FR-019, FR-020, FR-034] Implement `getPopulationAggregate(params)` (WHERE clause builder dùng chung) trong `on-time-rate.repository.ts`
  - `meeting_participants mp` INNER JOIN `meetings m ON m.id=mp.meeting_id AND m.status='completed'` INNER JOIN `users u ON u.id=mp.user_id` LEFT JOIN `attendance_records ar ON ar.meeting_id=m.id AND ar.user_id=mp.user_id`
  - WHERE: `mp.invitation_status <> 'declined'`, `m.start_time BETWEEN :from AND :to`, scope (`u.department_id = ANY(:scopeDepartmentIds)` nếu có) + `departmentId`/`meetingId`/`search` filter (search trên `u.full_name`/`u.email`/`u.employee_code`)
  - Loại `ar.attendance_status IN ('invalidated','pending_review')` khỏi kết quả
  - Cột phân loại (SQL `CASE`, tham số `:graceMinutes`):
    - `ar.id IS NULL OR ar.attendance_status = 'absent'` → `'absent'`
    - `graceMinutes = 0`: `ar.is_present AND NOT ar.is_late` → `'on_time'`; `ar.is_present AND ar.is_late` → `'late'`
    - `graceMinutes > 0`: `ar.is_present AND (ar.late_minutes IS NULL OR ar.late_minutes <= :graceMinutes)` → `'on_time'`; `ar.is_present` (còn lại) → `'late'`
  - Parameterized, không nối chuỗi

- [ ] T021 [FR-035-FR-038] Implement `getKpiTotals(params)` trong repository
  - Gọi T020 không `GROUP BY` → `{onTimeCount, lateCount, absentCount, totalRequiredParticipants}` cho toàn `[from,to]`

- [ ] T022 [FR-039] Implement `getTrendByWeek(params)` trong repository
  - Gọi T020 với `GROUP BY date_trunc('week', m.start_time)` → trả `Map<weekKey, {onTimeCount,lateCount,absentCount,totalRequiredParticipants}>`

- [ ] T023 [FR-040] Implement `getLateByHourOfDay(params)` trong repository
  - Gọi T020 với `GROUP BY EXTRACT(HOUR FROM m.start_time)` → trả `Map<hourOfDay, {lateCount, totalRequiredParticipants}>`

- [ ] T024 [FR-041] Implement `getLateByDepartment(params)` trong repository
  - Gọi T020 với `GROUP BY u.department_id, d.department_name` (JOIN `departments d`) → trả `{departmentId, departmentName, lateCount, totalRequiredParticipants}[]`

- [ ] T025 [FR-017] Implement `getLateHistory(userId, from, to, graceMinutes)` trong repository
  - Query `attendance_records ar` JOIN `meetings m` (`m.status='completed'`, `m.start_time BETWEEN :from AND :to`) WHERE `ar.user_id = :userId`
  - Chỉ lấy record thuộc nhóm `late` theo đúng công thức `graceMinutes` ở T020
  - Trả `{meetingId, meetingTitle, scheduledStartTime, checkInTime, lateMinutes}[]`

- [ ] T026 [FR-018, FR-039, FR-040, FR-041] Implement build `trend`/`lateByHourOfDay`/`lateByDepartment` (fill đủ bucket) trong `OnTimeRateService`
  - `trend`: map kết quả T022 vào đủ bucket tuần trong `[from,to]`, bucket thiếu → toàn `0`, tính `onTimeRate` mỗi bucket (mẫu số 0 → `0`)
  - `lateByHourOfDay`: map kết quả T023 vào đủ 24 bucket (0-23), bucket thiếu → `lateCount=0, totalRequiredParticipants=0, lateRate=0`
  - `lateByDepartment`: map kết quả T024, tính `lateRate` mỗi phòng ban, `ORDER BY lateRate DESC`

- [ ] T027 [FR-002, FR-018, FR-038] Implement `buildOverviewResponse(kpi, trend, lateByHourOfDay, lateByDepartment, graceMinutes)` trong `OnTimeRateService`
  - `onTimeRate = round(kpi.onTimeCount/kpi.totalRequiredParticipants*100, 1)` (mẫu số 0 → `0`) — **verify khớp công thức mẫu contract (gồm absent)**
  - `kpi.totalRequiredParticipants === 0` → thêm `message`: "Không tìm thấy dữ liệu điểm danh hợp lệ cho các điều kiện lọc được chọn."

- [ ] T028 [FR-017] Implement `buildLateHistoryResponse(user, period, lateMeetings)` trong `OnTimeRateService`

---

## Phase 5: Controller Wiring, Error Handling & Seed

- [ ] T029 [FR-004, FR-032, FR-042] Hoàn thiện `OnTimeRateController.getOnTimeRate()` / `OnTimeRateService.getOnTimeRate()`
  - Thứ tự: `resolveDateRange` (T014) → `maxRangeDays` check (T015) → `resolveDepartmentScope` (T016) → `departmentId` ownership (T017) → `graceMinutes` default (T019) → `getKpiTotals` (T021) → `getTrendByWeek`/`getLateByHourOfDay`/`getLateByDepartment` (T022-T024, T026) → `buildOverviewResponse` (T027)
  - Audit log non-blocking `action_type='read_analytics_on_time_rate'` (gated `AUDIT_LOG_ENABLED`), `metadata_json` gồm `{viewerUserId, viewerRole, from, to, departmentId, meetingId, search, graceMinutes, resolvedScopeDepartmentIds}`

- [ ] T030 [FR-015, FR-042] Hoàn thiện `OnTimeRateController.getLateHistory()` / `OnTimeRateService.getLateHistory()`
  - Thứ tự: `resolveDateRange` → `maxRangeDays` check → check `userId` tồn tại + ownership (T018) → `graceMinutes` default (T019) → `getLateHistory` (T025) → `buildLateHistoryResponse` (T028)
  - Audit log non-blocking `action_type='read_analytics_on_time_rate_late_history'`
  - Cả 2 handler: catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

- [ ] T031 [Seed] Tạo `src/database/seeds/<timestamp>-SeedAnalyticsAttendanceReadPermission.ts`
  - Tạo permission `analytics.attendance.read`
  - Gán cho 3 role `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (đúng `API_CONTRACT` UC-157)
  - Theo đúng pattern seed đã dùng ở UC-AA-02 (`analytics.room.read`)

---

## Phase 6: Testing

- [ ] T032 [Test, AC-001] [P] Unit test `resolveDateRange()`
  - 4 preset cũ (day/week/month/custom) + `quarter` đúng biên (Q1 Jan-Mar)

- [ ] T033 [Test, AC-002] [P] Unit test `resolveDepartmentScope()` + ownership — **quan trọng, verify đúng cơ sở NGƯỜI THAM DỰ**
  - Nhân sự thuộc phòng ban X (Manager quản lý) tham dự meeting do phòng ban Y tổ chức → VẪN nằm trong scope Manager X
  - Nhân sự thuộc phòng ban Y tham dự meeting do phòng ban X tổ chức → KHÔNG nằm trong scope Manager X
  - Verify KHÔNG dùng `meetings.organizer_id` ở bất kỳ đâu trong logic scope

- [ ] T034 [Test, AC-004, AC-005] [P] Unit test `DEPARTMENT_OUT_OF_SCOPE`/`USER_OUT_OF_SCOPE`/`USER_NOT_FOUND` (T017, T018)

- [ ] T035 [Test, AC-006] [P] Unit test `getPopulationAggregate()` — **quan trọng nhất, định nghĩa cốt lõi**
  - `present`→onTime, `late`→late, `absent`→absent
  - `left_early` với `is_late=false`→onTime, `left_early` với `is_late=true`→late
  - `invalidated`/`pending_review`→loại khỏi population hoàn toàn (không tính cả tử số lẫn mẫu số)
  - Participant không có `attendance_records` nào (meeting `completed`) → `absent` (verify fallback FR-019)
  - Chỉ tính `meetings.status='completed'` — loại `scheduled`/`in_progress`/`cancelled`/`draft`/`pending_approval`

- [ ] T036 [Test, AC-007] [P] Unit test `graceMinutes` override — **quan trọng, dễ sai**
  - `graceMinutes=0`: dùng thẳng `is_late` gốc
  - `graceMinutes=5`, `is_present=true, late_minutes=3` → `onTime` (KHÔNG PHẢI `late`, dù `is_late` gốc=`true`)
  - `graceMinutes=5`, `is_present=true, late_minutes=10` → vẫn `late`
  - Verify KHÔNG có câu `UPDATE` nào lên `attendance_records` trong repository/service của feature này

- [ ] T037 [Test, AC-008] [P] Unit test công thức `onTimeRate` — khớp số liệu mẫu contract
  - `onTimeCount=385, totalRequiredParticipants=467` → `onTimeRate=82.4` (verify mẫu số GỒM `absentCount`)

- [ ] T038 [Test, AC-001] [P] Unit test `getTrendByWeek()`/`getLateByHourOfDay()`/`getLateByDepartment()`
  - `trend`: đủ bucket tuần trong `[from,to]`, kể cả `totalRequiredParticipants=0`
  - `lateByHourOfDay`: đủ 24 bucket, nhóm theo giờ của `meetings.start_time` (KHÔNG phải giờ check-in thực tế)
  - `lateByDepartment`: nhóm theo phòng ban NGƯỜI THAM DỰ, `ORDER BY lateRate DESC`

- [ ] T039 [Test, AC-003] [P] Unit test `getLateHistory()` + drill-down
  - Chỉ trả record nhóm `late` (không lẫn `onTime`/`absent`), đúng `graceMinutes` truyền vào
  - Đủ field `meetingTitle`, `scheduledStartTime`, `checkInTime`, `lateMinutes`

- [ ] T040 [Test] [P] Unit test EX1 + DTO validation + controller
  - `totalRequiredParticipants=0` → `message` đúng nguyên văn EX1
  - `preset`/`departmentId`/`meetingId`/`graceMinutes` sai format → lỗi `VALIDATION_ERROR`
  - Request hợp lệ (cả 2 endpoint) → 200 đúng cấu trúc; audit log gọi khi thành công

- [ ] T041 [Test] [P] Unit test seed permission `analytics.attendance.read`
  - Tạo đúng permission, gán đúng 3 role `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T042 [Polish] Verify response format `{success, message, data, meta}` cho cả 2 endpoint
- [ ] T043 [Polish, FR-001] Verify read-only: không có write operation nào trong service/repository (ngoại trừ audit log dùng chung)
- [ ] T044 [Polish] Verify raw SQL dùng parameter binding, không nối chuỗi
- [ ] T045 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `DATE_RANGE_TOO_LARGE`, `PERMISSION_DENIED`, `DEPARTMENT_OUT_OF_SCOPE`, `USER_OUT_OF_SCOPE`, `USER_NOT_FOUND`, `INTERNAL_ERROR`
- [ ] T046 [Polish] Verify KHÔNG tái sử dụng công thức `onTimeRate` của UC-AA-01 (OOS-001 spec.md)
- [ ] T047 [Polish] Verify KHÔNG mutate `attendance_records.is_late`/`late_minutes` ở bất kỳ đâu (OOS-002 spec.md)
- [ ] T048 [Polish] Verify scope Manager KHÔNG dùng `meetings.organizer_id` ở bất kỳ đâu trong feature này (OOS-003 spec.md)
- [ ] T049 [Test] Chạy lại toàn bộ Acceptance Criteria trong spec.md §7 để verify end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Preset/Scope/Validation)**: Phụ thuộc Phase 2
- **Phase 4 (Aggregation)**: Phụ thuộc Phase 2; phụ thuộc Phase 3 để có kỳ + scope trước khi aggregate
- **Phase 5 (Wiring & Seed)**: Phụ thuộc Phase 3 + Phase 4
- **Phase 6 (Testing)**: Phụ thuộc Phase 5
- **Phase 7 (Polish)**: Phụ thuộc Phase 6

### Parallel Opportunities

- Phase 1: T001-T007 song song (khác file)
- Phase 4: T022-T025 song song (4 hàm repository độc lập, cùng dùng chung T020)
- Phase 6: T032-T041 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 + Phase 4 — Business logic đầy đủ (preset, scope theo người tham dự, phân loại 6 trạng thái, graceMinutes override, KPI/trend/pattern analytics, drill-down)
3. Phase 5 — Controller hoàn chỉnh, audit log, seed permission mới
4. Phase 6 — Unit test toàn bộ nhánh (đặc biệt T033 scope-theo-người-tham-dự và T035 phân-loại-population là 2 điểm rủi ro cao nhất của feature này)
5. Phase 7 — Polish, verify không tái dùng công thức UC-AA-01, verify không mutate dữ liệu gốc, verify không lẫn scope organizer

MVP = Phase 1 → Phase 5.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T012, T020 |
| FR-004 | T011 |
| FR-005–FR-007 | T014 |
| FR-008–FR-010 | T016, T017 |
| FR-011, FR-012 | T020 |
| FR-013, FR-014 | T019, T020 |
| FR-015–FR-017 | T011, T018, T025, T028 |
| FR-018–FR-020 | T020, T027 |
| FR-021 | T020 |
| FR-022–FR-031 | T008, T009, T015, T017, T018 |
| FR-032, FR-033 | T016 |
| FR-034–FR-038 | T020, T021, T027 |
| FR-039 | T022, T026 |
| FR-040 | T023, T026 |
| FR-041 | T024, T026 |
| FR-042 | T029, T030 |
| FR-043, FR-044 | T016, T015 |
