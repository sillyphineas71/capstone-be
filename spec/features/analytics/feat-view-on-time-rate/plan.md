# Implementation Plan: Xem thống kê tỷ lệ tham dự đúng giờ (UC-AA-10 / UC-157)

**Branch**: `025-view-on-time-rate` | **Date**: 2026-07-02
**Spec**: spec/features/analytics/feat-view-on-time-rate/spec.md

## Summary

Tính năng cho phép Manager (giới hạn phạm vi phòng ban phụ trách, scope theo **phòng ban của người tham dự** — khác pattern organizer-based của mọi UC-AA trước), Business Admin, System Admin xem KPI `onTimeRate` (= `onTimeCount ÷ totalRequiredParticipants`, mẫu số gồm cả `absent` — công thức riêng của UC-157, khác UC-AA-01), biểu đồ xu hướng theo tuần, và 2 khu vực Pattern Analytics (`lateByHourOfDay` 24 bucket theo giờ lịch gốc, `lateByDepartment` xếp hạng phòng ban). Chỉ tính trên `meetings.status='completed'`. Hỗ trợ `graceMinutes` (mặc định `0`, tính lại tại tầng phân tích, không sửa dữ liệu gốc). 2 endpoint: `GET /api/v1/analytics/attendance/on-time-rate` (đã có trong `API_CONTRACT` UC-157, mở rộng `lateByHourOfDay/lateByDepartment/meetingId/search`) và `GET /api/v1/analytics/attendance/on-time-rate/users/{userId}/late-history` (drill-down AF1, bổ sung mới hoàn toàn). Read-only. Cần seed permission mới `analytics.attendance.read` (chưa tồn tại, khác `analytics.meeting.read`/`analytics.room.read` đã có sẵn từ UC-AA-04/02).

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT
**Storage**: PostgreSQL (read-only aggregate query, JOIN `meetings + meeting_participants + attendance_records + users` [+ `departments`])
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 2s cho khoảng mặc định (tháng hiện tại) ở endpoint tổng quan
**Constraints**: Read-only tuyệt đối; chỉ tính `meetings.status='completed'`; scope theo phòng ban người tham dự (không phải organizer); `graceMinutes` chỉ ảnh hưởng tầng phân tích, không mutate `attendance_records`
**Scale**: Tối đa `analytics.dashboard_max_range_days` ngày mỗi request; `lateByHourOfDay` cố định 24 bucket; `trend` tối đa ~53 bucket tuần/năm

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột — chỉ seed 1 permission mới `analytics.attendance.read` (đã có sẵn tên trong `API_CONTRACT`, chưa từng seed) |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('analytics.attendance.read')` (permission MỚI, cần seed ở feature này); scope enforce ở service |
| **Scope Gate** | PASS | 2 endpoint đúng UC-AA-10 (tổng quan + drill-down AF1); không đụng UC-AA-01 dù cùng khái niệm "onTimeRate" (2 công thức tách biệt, đã ghi RECON) |
| **Module Gate** | PASS | Toàn bộ code trong `src/modules/analytics/`, không import chéo service của UC-AA-01/07/09 (viết SQL scope độc lập, theo đúng pattern kiến trúc đã chọn từ UC-AA-08) |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint tổng quan khớp path `API_CONTRACT` UC-157 (field mở rộng đã ghi RECON); endpoint drill-down là bổ sung mới đã ghi rõ |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Test Gate** | PASS | Unit test cho phân loại 6 trạng thái → 3 nhóm, `graceMinutes` override, scope theo người tham dự, công thức `onTimeRate` khớp số liệu mẫu contract, EX1 |

## Project Structure

### Documentation (this feature)

```text
spec/features/analytics/feat-view-on-time-rate/
├── spec.md
├── plan.md              # File này
└── tasks.md
```

> Ghi chú: `research.md`/`data-model.md`/`quickstart.md`/`contracts/` chưa tạo ở vòng này — nội dung tương đương đã có trong `spec.md` §0 (RECON) và §5 (Data Model).

### Source Code (repository root)

```text
src/modules/analytics/
├── analytics.module.ts                             # Update: đăng ký thêm controller/service/repository mới
├── controllers/
│   ├── meeting-cancel-rate.controller.ts            # Đã có (UC-AA-07)
│   ├── room-utilization-rate.controller.ts          # Đã có (UC-AA-08)
│   ├── no-show-rate.controller.ts                   # Đã có (UC-AA-09)
│   └── on-time-rate.controller.ts                   # NEW: /attendance/on-time-rate + /attendance/on-time-rate/users/:userId/late-history
├── services/
│   ├── dashboard-overview-config.service.ts         # Đã có — tái dùng getMaxRangeDays()
│   └── on-time-rate.service.ts                      # NEW: orchestrator — preset, scope theo người tham dự, KPI, trend, pattern analytics, drill-down
├── repositories/
│   └── on-time-rate.repository.ts                   # NEW: aggregate SQL population/trend/lateByHourOfDay/lateByDepartment/lateHistory
├── dto/
│   ├── query-on-time-rate.dto.ts                    # NEW
│   ├── query-late-history.dto.ts                    # NEW
│   └── on-time-rate-response.dto.ts                 # NEW
└── tests/
    ├── on-time-rate.service.spec.ts
    └── on-time-rate.repository.spec.ts

src/database/seeds/
└── <timestamp>-SeedAnalyticsAttendanceReadPermission.ts  # NEW: seed permission analytics.attendance.read + gán MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN
```

**Structure Decision**: Mở rộng module `analytics` đã có. Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` qua DI. Scope Manager theo phòng ban người tham dự **viết SQL độc lập** (không import chéo repository/service của UC-AA-01/07/09), nhất quán quyết định kiến trúc đã chọn từ UC-AA-08. **Bắt buộc thêm seed migration mới** cho permission `analytics.attendance.read` — đây là permission đầu tiên trong nhóm phân tích chưa từng được seed (khác `analytics.meeting.read`/`analytics.room.read` đã có từ UC-AA-04/UC-AA-02).

## Complexity Tracking

Không vi phạm constitution. 2 điểm phức tạp nhất:

1. **Phân loại population 6 trạng thái → 3 nhóm** (`present→onTime`, `late→late`, `absent→absent`, `left_early→theo cờ is_late`, `invalidated/pending_review→loại`, thiếu `attendance_records`→`absent`) — cần 1 hàm `classifyParticipant()` dùng chung cho mọi query (KPI, trend, lateByHourOfDay, lateByDepartment) để tránh lệch logic giữa các nơi.
2. **`graceMinutes` override không mutate dữ liệu gốc** — mọi nơi tính onTime/late phải áp cùng 1 công thức `CASE WHEN is_present AND (late_minutes IS NULL OR late_minutes <= :graceMinutes) THEN onTime ELSE late END` khi `graceMinutes>0`, khác hẳn khi `graceMinutes=0` (dùng thẳng `is_late`).

Cả 2 điểm có kế hoạch xử lý rõ ràng (1 hàm SQL/service dùng chung), không cần justify vi phạm constitution.

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/query-on-time-rate.dto.ts`, `dto/query-late-history.dto.ts`, `dto/on-time-rate-response.dto.ts`, `services/on-time-rate.service.ts`, `repositories/on-time-rate.repository.ts`, `controllers/on-time-rate.controller.ts`, `tests/*.spec.ts`, seed migration mới.

### Phase 2: Foundational

#### T-A: DTO

- `query-on-time-rate.dto.ts`: `@IsOptional() @IsEnum(['day','week','month','quarter','custom']) preset?`, `@IsOptional() @IsDateString() from?`, `to?`, `@IsOptional() @IsUUID() departmentId?`, `@IsOptional() @IsUUID() meetingId?`, `@IsOptional() @IsString() @MaxLength(150) search?`, `@IsOptional() @Type(()=>Number) @IsInt() @Min(0) graceMinutes?`.
- `query-late-history.dto.ts`: `preset?/from?/to?/graceMinutes?` (không có `departmentId`/`meetingId`/`search` — `userId` qua path param).
- `on-time-rate-response.dto.ts`: `TrendPointDto {period, onTimeCount, lateCount, absentCount, totalRequiredParticipants, onTimeRate}`, `HourBucketDto {hourOfDay, lateCount, totalRequiredParticipants, lateRate}`, `DepartmentLateItemDto {departmentId, departmentName, lateCount, totalRequiredParticipants, lateRate}`, `OnTimeRateResponseDto {period, graceMinutes, onTimeCount, lateCount, absentCount, totalRequiredParticipants, onTimeRate, trend, lateByHourOfDay, lateByDepartment, message?}`, `LateMeetingItemDto {meetingId, meetingTitle, scheduledStartTime, checkInTime, lateMinutes}`, `LateHistoryResponseDto {user, period, lateMeetings}`.

#### T-B: Controller shell

- `on-time-rate.controller.ts`: `@Controller('analytics/attendance')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.attendance.read')` class-level.
  - `@Get('on-time-rate')` → `service.getOnTimeRate(currentUser, query)`
  - `@Get('on-time-rate/users/:userId/late-history')` → `service.getLateHistory(currentUser, userId, query)` (`userId` qua `ParseUUIDPipe`)

#### T-C: Service shell

- `on-time-rate.service.ts`: inject `AuthzReadRepository`, `OnTimeRateRepository`, `DashboardOverviewConfigService`. 2 method — throw `NotImplementedException` tạm.

#### T-D: Module wiring

- Cập nhật `analytics.module.ts`: đăng ký controller/service/repository mới; xác nhận `TypeOrmModule.forFeature` đã có `AttendanceRecordEntity`, `MeetingParticipantEntity`, `MeetingEntity`, `UserEntity`, `DepartmentEntity`.

### Phase 3: Business Logic — Preset, Scope, Validation

#### T-E: Resolve khoảng thời gian (tái dùng pattern UC-AA-08, có `quarter`)

- `resolveDateRange(query)`: `preset` thiếu → mặc định `'month'`. `day/week/month` → tính như UC-AA-02. `quarter` → tái dùng công thức UC-AA-06/08. `custom` → `from`/`to`, validate `from<=to`.

#### T-F: Check `maxRangeDays`

- Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` → vượt → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`.

#### T-G: Resolve scope phòng ban Manager theo NGƯỜI THAM DỰ (MỚI — khác pattern organizer)

- `resolveDepartmentScope(currentUser)`: viết SQL độc lập `SELECT id FROM departments WHERE manager_user_id = :userId`. Áp dụng để lọc `users.department_id` (người tham dự), KHÔNG lọc qua `meetings.organizer_id`.

#### T-H: Check `departmentId` ownership

- MANAGER truyền `departmentId` ngoài scope → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`.

#### T-I: Check `userId` (drill-down) ownership

- MANAGER truy cập `userId` không thuộc phòng ban mình quản lý → `ForbiddenException({code:'USER_OUT_OF_SCOPE'})`. `userId` không tồn tại → `NotFoundException({code:'USER_NOT_FOUND'})` (check tồn tại trước ownership).

#### T-J: Default `graceMinutes=0`

- Query thiếu `graceMinutes` → mặc định `0` (đúng quy ước "không grace period").

### Phase 4: Business Logic — Aggregation

#### T-K: Repository — `getPopulationAggregate(params)` (dùng chung cho KPI/trend/pattern)

- Base query: `meeting_participants mp` INNER JOIN `meetings m ON m.id=mp.meeting_id AND m.status='completed'` INNER JOIN `users u ON u.id=mp.user_id` LEFT JOIN `attendance_records ar ON ar.meeting_id=m.id AND ar.user_id=mp.user_id`.
- WHERE: `mp.invitation_status <> 'declined'`, `m.start_time BETWEEN :from AND :to`, scope (`u.department_id IN scopeDepartmentIds`) + `departmentId`/`meetingId`/`search` filter, loại `ar.attendance_status IN ('invalidated','pending_review')`.
- Phân loại mỗi dòng (SQL `CASE` hoặc tính ở service sau khi lấy raw rows — chọn SQL `CASE` để tận dụng `GROUP BY`):
  - `ar IS NULL` → `absent`.
  - `ar.attendance_status = 'absent'` → `absent`.
  - `graceMinutes = 0`: `ar.is_present AND NOT ar.is_late` → `onTime`; `ar.is_present AND ar.is_late` → `late`.
  - `graceMinutes > 0`: `ar.is_present AND (ar.late_minutes IS NULL OR ar.late_minutes <= :graceMinutes)` → `onTime`; `ar.is_present` (còn lại) → `late`.
- Parameterized, không nối chuỗi.

#### T-L: Repository — `getKpiTotals(params)`

- Gọi T-K không `GROUP BY` → `{onTimeCount, lateCount, absentCount, totalRequiredParticipants}` cho toàn `[from,to]`.

#### T-M: Repository — `getTrendByWeek(params)`

- Gọi T-K với `GROUP BY date_trunc('week', m.start_time)` → map vào đủ bucket tuần trong `[from,to]` (kể cả `totalRequiredParticipants=0`).

#### T-N: Repository — `getLateByHourOfDay(params)`

- Gọi T-K (chỉ đếm nhóm `late` + tổng participant) với `GROUP BY EXTRACT(HOUR FROM m.start_time)` → map vào đủ 24 bucket 0-23 (bucket không có dữ liệu → `lateCount=0, totalRequiredParticipants=0, lateRate=0`).

#### T-O: Repository — `getLateByDepartment(params)`

- Gọi T-K với `GROUP BY u.department_id, d.department_name` (JOIN `departments d`), sort `ORDER BY lateRate DESC`.

#### T-P: Repository — `getLateHistory(userId, from, to, graceMinutes)`

- Query `attendance_records` + `meetings` cho đúng `userId`, `meetings.status='completed'`, `start_time BETWEEN :from AND :to`, chỉ lấy record thuộc nhóm `late` (theo cùng công thức `graceMinutes` ở T-K).
- Trả `{meetingId, meetingTitle, scheduledStartTime, checkInTime, lateMinutes}[]`.

#### T-Q: Service — build response tổng quan

- `onTimeRate = round(onTimeCount/totalRequiredParticipants*100, 1)` (mẫu số 0 → `0`).
- `totalRequiredParticipants=0` → `message` đúng nguyên văn EX1: "Không tìm thấy dữ liệu điểm danh hợp lệ cho các điều kiện lọc được chọn."
- Mỗi bucket `trend`/`lateByHourOfDay`/`lateByDepartment` tính `onTimeRate`/`lateRate` riêng (mẫu số 0 → `0`).

#### T-R: Service — build response drill-down

- Gộp `user` info (`UserEntity` cơ bản), `period`, `lateMeetings` (T-P) thành `LateHistoryResponseDto`.

### Phase 5: Controller Wiring & Error Handling

#### T-S: Wire endpoint tổng quan

- Thứ tự: `resolveDateRange` (T-E) → `maxRangeDays` check (T-F) → `resolveDepartmentScope` (T-G) → `departmentId` ownership (T-H) → `graceMinutes` default (T-J) → `getKpiTotals` (T-L) → `getTrendByWeek`/`getLateByHourOfDay`/`getLateByDepartment` (T-M/N/O) → build response (T-Q).
- Audit log non-blocking `action_type='read_analytics_on_time_rate'`.

#### T-T: Wire endpoint drill-down

- Thứ tự: `resolveDateRange` → `maxRangeDays` check → check `userId` tồn tại + ownership (T-I) → `graceMinutes` default (T-J) → `getLateHistory` (T-P) → build response (T-R).
- Audit log non-blocking `action_type='read_analytics_on_time_rate_late_history'`.
- Cả 2: catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

#### T-U: Seed permission mới

- Tạo `src/database/seeds/<timestamp>-SeedAnalyticsAttendanceReadPermission.ts`: tạo `analytics.attendance.read`, gán `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (theo đúng `API_CONTRACT` UC-157), theo pattern seed đã dùng ở UC-AA-02 (`analytics.room.read`).

### Phase 6: Testing

#### T-V: Unit test `resolveDateRange()` (tái dùng + `quarter`)

- 4 preset cũ + `quarter` đúng biên (Q1 Jan-Mar).

#### T-W: Unit test `resolveDepartmentScope()`/ownership — **quan trọng, verify đúng cơ sở NGƯỜI THAM DỰ**

- Manager quản lý phòng ban X: nhân sự thuộc X tham dự meeting do phòng ban Y tổ chức → VẪN được tính vào scope Manager (vì scope dựa trên người tham dự, không phải organizer) — verify đây là điểm khác biệt cốt lõi so với UC-AA-04–09.
- Nhân sự thuộc phòng ban Y (không phải X) tham dự meeting do phòng ban X tổ chức → KHÔNG được tính vào scope Manager X.

#### T-X: Unit test `getPopulationAggregate()` — **quan trọng nhất, định nghĩa cốt lõi**

- 6 trạng thái `attendance_status` phân loại đúng theo §0.5 spec.md: `present`→onTime, `late`→late, `absent`→absent, `left_early` với `is_late=false`→onTime, `left_early` với `is_late=true`→late, `invalidated`/`pending_review`→loại khỏi population hoàn toàn.
- Participant không có `attendance_records` nào (meeting đã `completed`) → `absent` (verify fallback).
- Chỉ tính `meetings.status='completed'`, loại `scheduled`/`in_progress`/`cancelled`/`draft`/`pending_approval`.

#### T-Y: Unit test `graceMinutes` override — **quan trọng, dễ sai**

- `graceMinutes=0`: dùng thẳng `is_late` gốc.
- `graceMinutes=5`, record `is_present=true, late_minutes=3` → `onTime` (KHÔNG PHẢI `late`, dù `is_late` gốc = `true`).
- `graceMinutes=5`, record `is_present=true, late_minutes=10` → vẫn `late`.
- Verify KHÔNG có bất kỳ `UPDATE`/mutation nào lên `attendance_records.is_late`/`late_minutes` sau khi test (chỉ đọc).

#### T-Z: Unit test công thức `onTimeRate` — khớp số liệu mẫu contract

- `onTimeCount=385, totalRequiredParticipants=467` → `onTimeRate=82.4` (verify mẫu số GỒM `absentCount`, không loại trừ như UC-AA-01).

#### T-AA: Unit test `getTrendByWeek()`/`getLateByHourOfDay()`/`getLateByDepartment()`

- `trend`: đủ bucket tuần trong `[from,to]`, kể cả `totalRequiredParticipants=0`.
- `lateByHourOfDay`: đủ 24 bucket, nhóm theo giờ của `meetings.start_time` (không phải giờ check-in).
- `lateByDepartment`: nhóm theo phòng ban NGƯỜI THAM DỰ, sort giảm dần theo `lateRate`.

#### T-BB: Unit test endpoint drill-down + EX1

- `getLateHistory()` chỉ trả record nhóm `late` (không có `onTime`/`absent`), đúng `graceMinutes` truyền vào.
- Manager truy cập `userId` ngoài scope → `USER_OUT_OF_SCOPE`.
- `userId` không tồn tại → `USER_NOT_FOUND`.
- `totalRequiredParticipants=0` (endpoint tổng quan) → `message` đúng nguyên văn EX1.

#### T-CC: Unit test DTO validation + controller + seed

- `preset`/`departmentId`/`meetingId`/`graceMinutes` sai format → lỗi.
- Request hợp lệ (cả 2 endpoint) → 200 đúng cấu trúc; audit log gọi khi thành công.
- Seed permission tạo đúng `analytics.attendance.read`, gán đúng 3 role.

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic |
|---|---|
| AC-001 | T-E, T-K, T-L, T-M, T-N, T-O, T-Q |
| AC-002 | T-G, T-W |
| AC-003 | T-P, T-R |
| AC-004 | T-H |
| AC-005 | T-I |
| AC-006 | T-K, T-X |
| AC-007 | T-K, T-Y |
| AC-008 | T-Q |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Nhầm scope theo organizer thay vì người tham dự (copy nhầm pattern từ UC-AA-04–09) | Sai hoàn toàn phạm vi dữ liệu Manager thấy được | Unit test T-W dùng dữ liệu cố ý chéo (nhân sự dept X tham dự meeting do dept Y tổ chức) để phân biệt rõ 2 cách scope |
| `graceMinutes` vô tình mutate `attendance_records` gốc | Phá vỡ dữ liệu nguồn của module `attendance` (ngoài phạm vi `analytics`) | Code review + test T-Y verify tuyệt đối không có câu `UPDATE` nào trong repository/service của feature này |
| Nhầm công thức `onTimeRate` (loại `absent` giống UC-AA-01) | Sai số liệu KPI cốt lõi, lệch với chính contract UC-157 | Unit test T-Z dùng đúng số liệu mẫu trong contract để verify |
| Bỏ sót participant không có `attendance_records` (không tính vào `absentCount`) | Đánh giá sai tỷ lệ tuân thủ (undercounting vi phạm nặng nhất) | Unit test T-X cụ thể cho case participant hoàn toàn không có record |
| Permission mới quên seed hoặc seed sai role | Toàn bộ feature 403 dù code đúng | Task T-U riêng biệt + test T-CC verify seed |
| Lệch với `API_CONTRACT` UC-157 gốc (thiếu `lateByHourOfDay`/`lateByDepartment`, thêm endpoint drill-down) | FE code sai theo tài liệu cũ | Đề xuất đồng bộ tài liệu ở task riêng (CL-1 spec.md) |

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T-C, T-K |
| FR-004 | T-B |
| FR-005–FR-007 | T-E |
| FR-008–FR-010 | T-G, T-H |
| FR-011, FR-012 | T-K |
| FR-013, FR-014 | T-J, T-K |
| FR-015–FR-017 | T-B, T-I, T-P, T-R |
| FR-018–FR-020 | T-K, T-Q |
| FR-021 | T-K |
| FR-022–FR-031 | T-A, T-F, T-H, T-I |
| FR-032, FR-033 | T-G |
| FR-034–FR-038 | T-K, T-L, T-Q |
| FR-039 | T-M |
| FR-040 | T-N |
| FR-041 | T-O |
| FR-042 | T-S, T-T |
| FR-043, FR-044 | T-G, T-F |
