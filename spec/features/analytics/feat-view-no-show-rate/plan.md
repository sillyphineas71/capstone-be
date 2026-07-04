# Implementation Plan: Xem thống kê tỷ lệ no-show (UC-AA-09 / UC-156)

**Branch**: `024-view-no-show-rate` | **Date**: 2026-07-02
**Spec**: spec/features/analytics/feat-view-no-show-rate/spec.md

## Summary

Tính năng cho phép Manager (giới hạn phạm vi phòng ban phụ trách), Business Admin, System Admin xem 2 chỉ số KPI tổng hợp (`noShowCount`, `noShowRate`) và 1 bảng xếp hạng phân trang theo 1 trong 3 tiêu chí (`rankBy=room|department|organizer`, mỗi tab có sort mặc định riêng: `room`/`organizer` theo `noShowCount`, `department` theo `noShowRate`). "No-show" = `no_show_cases.detection_status IN ('confirmed','released')` (tái dùng định nghĩa UC-AA-01/05), mốc thời gian lọc = `room_bookings.reserved_start_time`. Không có biểu đồ xu hướng (đã quyết định bỏ dù `API_CONTRACT` UC-156 gốc có `trend`/`groupBy`). 1 endpoint mở rộng: `GET /api/v1/analytics/rooms/no-show-rate` (đã có trong `API_CONTRACT`, thêm `rankBy/page/limit/departmentIds/organizerEmail`, bỏ `trend/groupBy/byRoom`). Read-only, không thêm bảng/config/permission mới — tái dùng permission `analytics.room.read` (đã seed ở UC-AA-02) và các pattern scope/preset/organizerEmail đã có ở UC-AA-01/02/07/08.

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT
**Storage**: PostgreSQL (read-only aggregate query, JOIN `no_show_cases + room_bookings + meetings + users` [+ `departments`/`rooms` tùy `rankBy`])
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 2s cho khoảng mặc định (tháng hiện tại)
**Constraints**: Read-only tuyệt đối; "no-show" chỉ tính `detection_status IN ('confirmed','released')`; mốc thời gian duy nhất là `reserved_start_time`; ranking không loại mẫu nhỏ, chỉ gắn cờ
**Scale**: Tối đa `analytics.dashboard_max_range_days` ngày mỗi request; `ranking` phân trang `limit` tối đa 100

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột/config key nào — tái dùng `analytics.dashboard_max_range_days` (UC-AA-01) |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('analytics.room.read')` (đã seed ở UC-AA-02, KHÔNG seed lại); scope enforce ở service |
| **Scope Gate** | PASS | Chỉ 1 endpoint UC-156 mở rộng; bỏ hẳn `trend`/`groupBy` theo quyết định spec §0.4 |
| **Module Gate** | PASS | Toàn bộ code trong `src/modules/analytics/`, không import chéo service của UC-AA-02/07/08 (duplicate SQL ngắn, giữ feature độc lập — theo đúng pattern đã chọn ở UC-AA-08) |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint khớp path `API_CONTRACT` UC-156 (field mở rộng/loại bỏ đã ghi RECON) |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Test Gate** | PASS | Unit test cho định nghĩa no-show, mốc thời gian, sort khác nhau theo `rankBy`, cờ `lowSampleSize`, EX1 (`noShowCount=0` dù có booking) |

## Project Structure

### Documentation (this feature)

```text
spec/features/analytics/feat-view-no-show-rate/
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
│   ├── room-usage-dashboard.controller.ts           # Đã có (UC-AA-02)
│   ├── meeting-cancel-rate.controller.ts            # Đã có (UC-AA-07)
│   ├── room-utilization-rate.controller.ts          # Đã có (UC-AA-08)
│   └── no-show-rate.controller.ts                   # NEW: /rooms/no-show-rate
├── services/
│   ├── dashboard-overview-config.service.ts         # Đã có — tái dùng getMaxRangeDays()
│   └── no-show-rate.service.ts                      # NEW: orchestrator — preset, scope, KPI, ranking phân trang
├── repositories/
│   └── no-show-rate.repository.ts                   # NEW: aggregate SQL KPI + 3 nhánh ranking (room/department/organizer)
├── dto/
│   ├── query-no-show-rate.dto.ts                    # NEW
│   └── no-show-rate-response.dto.ts                 # NEW
└── tests/
    ├── no-show-rate.service.spec.ts
    └── no-show-rate.repository.spec.ts
```

**Structure Decision**: Mở rộng module `analytics` đã có. **Không** seed lại permission (`analytics.room.read` đã seed ở UC-AA-02). Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` qua DI. Scope phòng ban (Manager) và scope phòng động theo kỳ lọc (cho `rankBy=room`) **viết lại SQL ngắn độc lập** trong repository mới, không import chéo service/repository của UC-AA-01/02/07/08 — nhất quán quyết định kiến trúc đã chọn ở UC-AA-08 (giữ mỗi feature độc lập, tránh coupling cho vài dòng SQL).

## Complexity Tracking

Không vi phạm constitution. Điểm phức tạp nhất là 3 nhánh `rankBy` dùng chung điều kiện lọc/scope nhưng khác `GROUP BY`/`ORDER BY`/entity resolve tên hiển thị (`roomName`/`departmentName`/`fullName+email`) — xử lý bằng 1 hàm `getKpiAggregate()` dùng chung cho phần KPI tổng, và 3 hàm repository riêng (`getRoomRanking`/`getDepartmentRanking`/`getOrganizerRanking`) chia sẻ chung 1 WHERE clause builder để tránh lệch điều kiện lọc giữa 3 nhánh. Không cần justify vi phạm constitution.

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/query-no-show-rate.dto.ts`, `dto/no-show-rate-response.dto.ts`, `services/no-show-rate.service.ts`, `repositories/no-show-rate.repository.ts`, `controllers/no-show-rate.controller.ts`, `tests/*.spec.ts`.

### Phase 2: Foundational

#### T-A: DTO

- `query-no-show-rate.dto.ts`: `@IsOptional() @IsEnum(['day','week','month','quarter','custom']) preset?`, `@IsOptional() @IsDateString() from?`, `to?`, `@IsOptional() @IsArray() @IsUUID('4',{each:true}) departmentIds?`, `@IsOptional() @IsUUID() roomId?`, `@IsOptional() @IsEmail() organizerEmail?`, `@IsOptional() @IsEnum(['room','department','organizer']) rankBy?`, `@IsOptional() @IsInt() @Min(1) page?`, `@IsOptional() @IsInt() @Min(1) @Max(100) limit?`.
- `no-show-rate-response.dto.ts`: `RankingItemDto {id, name, email?, noShowCount, totalBookings, noShowRate, lowSampleSize}`, `RankingDto {rankBy, items: RankingItemDto[], page, limit, total, totalPages}`, `NoShowRateResponseDto {period, noShowCount, totalBookings, noShowRate, ranking: RankingDto, message?}`.

#### T-B: Controller shell

- `no-show-rate.controller.ts`: `@Controller('analytics/rooms')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.room.read')` class-level, `@Get('no-show-rate')` → `service.getNoShowRate(currentUser, query)`.

#### T-C: Service shell

- `no-show-rate.service.ts`: inject `AuthzReadRepository`, `NoShowRateRepository`, `DashboardOverviewConfigService`. Method `getNoShowRate(currentUser, query)` — throw `NotImplementedException` tạm.

#### T-D: Module wiring

- Cập nhật `analytics.module.ts`: đăng ký controller/service/repository mới; xác nhận `TypeOrmModule.forFeature` đã có `NoShowCaseEntity`, `RoomBookingEntity`, `RoomEntity`, `MeetingEntity`, `UserEntity`, `DepartmentEntity`.

### Phase 3: Business Logic — Preset, Scope, Validation

#### T-E: Resolve khoảng thời gian (tái dùng pattern UC-AA-08, có `quarter`)

- `resolveDateRange(query)`: `preset` thiếu → mặc định `'month'`. `day/week/month` → tính như UC-AA-02. `quarter` → quý dương lịch hiện tại (tái dùng công thức UC-AA-06/08). `custom` → dùng `from`/`to`, validate `from<=to`.

#### T-F: Check `maxRangeDays`

- Tái dùng `DashboardOverviewConfigService.getMaxRangeDays()` → vượt → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`.

#### T-G: Resolve scope phòng ban Manager (tĩnh)

- `resolveDepartmentScope(currentUser)`: viết lại SQL độc lập `SELECT id FROM departments WHERE manager_user_id = :userId` (không import UC-AA-01).

#### T-H: Check `departmentIds` ownership

- MANAGER truyền `departmentIds` có phần tử ngoài scope → `ForbiddenException({code:'DEPARTMENT_OUT_OF_SCOPE'})`.

#### T-I: Resolve scope phòng động theo kỳ lọc (chỉ cần khi `rankBy=room` hoặc có `roomId`)

- `resolveRoomScope(currentUser, from, to)`: viết lại SQL độc lập theo đúng công thức UC-AA-02/08 (không import repository của UC-AA-08).

#### T-J: Check `roomId` ownership

- MANAGER truyền `roomId` ngoài scope kỳ lọc → `ForbiddenException({code:'ROOM_OUT_OF_SCOPE'})`.

#### T-K: Resolve `organizerEmail` → `organizerId`

- Tái dùng đúng pattern UC-AA-07: `LOWER(email) = LOWER(:organizerEmail)`; không khớp → đánh dấu "no-match", trả response rỗng (FR-017/FR-019) mà không query aggregation tiếp.

### Phase 4: Business Logic — Aggregation

#### T-L: Repository — `getKpiAggregate(params)`

- WHERE chung: `room_bookings.status IN ('approved','active','completed','released')`, `reserved_start_time BETWEEN :from AND :to`, scope + `departmentIds`/`roomId`/`organizerId` filter (qua JOIN `meetings.organizer_id → users.department_id`).
- `totalBookings = COUNT(DISTINCT room_bookings.id)`.
- `noShowCount = COUNT(DISTINCT no_show_cases.id) WHERE no_show_cases.detection_status IN ('confirmed','released')` (LEFT JOIN `no_show_cases ON no_show_cases.booking_id = room_bookings.id`).
- Parameterized, không nối chuỗi.

#### T-M: Repository — `getRoomRanking(params, page, limit)`

- Cùng WHERE clause builder ở T-L, thêm `INNER JOIN rooms ON rooms.id = room_bookings.room_id`, `GROUP BY rooms.id, rooms.room_name`.
- `ORDER BY noShowCount DESC, noShowRate DESC`, `LIMIT/OFFSET` theo `page/limit`, kèm `COUNT(*) OVER()` hoặc query đếm riêng cho `total`.

#### T-N: Repository — `getDepartmentRanking(params, page, limit)`

- Cùng WHERE clause builder, `GROUP BY users.department_id, departments.department_name` (JOIN `departments`).
- `ORDER BY noShowRate DESC, noShowCount DESC`.

#### T-O: Repository — `getOrganizerRanking(params, page, limit)`

- Cùng WHERE clause builder, `GROUP BY meetings.organizer_id, users.email, users.full_name`.
- `ORDER BY noShowCount DESC, noShowRate DESC`.

#### T-P: Service — tính `lowSampleSize` + build `ranking`

- Với mỗi item trả về từ T-M/T-N/T-O: `lowSampleSize = totalBookings < 3`.
- Gộp `{rankBy, items, page, limit, total, totalPages}` thành `RankingDto`.

#### T-Q: Service — build response tổng

- Gọi `getKpiAggregate` (T-L) → `noShowCount`, `totalBookings`, `noShowRate = round(noShowCount/totalBookings*100, 1)` (mẫu số 0 → `0`).
- Gọi đúng 1 trong 3 hàm ranking (T-M/T-N/T-O) theo `rankBy` (T-P).
- `noShowCount = 0` (bất kể `totalBookings`) → `ranking.items=[]`, thêm `message` đúng nguyên văn EX1: "Tuyệt vời! Không ghi nhận trường hợp lãng phí phòng họp nào trong khoảng thời gian này."

### Phase 5: Controller Wiring & Error Handling

#### T-R: Wire controller

- Thứ tự: `resolveDateRange` (T-E) → `maxRangeDays` check (T-F) → `resolveDepartmentScope` (T-G) → `departmentIds` ownership (T-H) → `resolveRoomScope` nếu cần (T-I) → `roomId` ownership (T-J) → `resolveOrganizerId` (T-K, nếu có) → nếu no-match → trả rỗng ngay → `getKpiAggregate` (T-L) → ranking theo `rankBy` (T-M/T-N/T-O, T-P) → build response (T-Q).
- Audit log non-blocking `action_type='read_analytics_no_show_rate'` (gated `AUDIT_LOG_ENABLED`).
- Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

### Phase 6: Testing

#### T-S: Unit test `resolveDateRange()` (tái dùng + `quarter`)

- 4 preset cũ + `quarter` đúng biên (Q1 Jan-Mar).

#### T-T: Unit test `resolveDepartmentScope`/`resolveRoomScope` + ownership checks

- Tái dùng test case UC-AA-01 (department) và UC-AA-02/08 (room, theo kỳ lọc).

#### T-U: Unit test `getKpiAggregate()` — định nghĩa no-show + mốc thời gian

- `detection_status='confirmed'`/`'released'` → tính vào `noShowCount`; `'risk'`/`'warning_sent'`/`'dismissed'`/`'resolved'` → KHÔNG tính (verify đúng §0.1).
- Lọc theo `room_bookings.reserved_start_time`, KHÔNG dùng `detected_at`/`meetings.start_time` (verify case biên: booking đầu/cuối kỳ).
- `totalBookings` chỉ đếm `status IN ('approved','active','completed','released')`.

#### T-V: Unit test `getRoomRanking()`/`getDepartmentRanking()`/`getOrganizerRanking()` — **quan trọng nhất**

- Mỗi nhánh sort đúng tiêu chí mặc định khác nhau: `room`/`organizer` theo `noShowCount` DESC, `department` theo `noShowRate` DESC (verify KHÔNG lẫn tiêu chí giữa 3 nhánh).
- Phân trang đúng `page`/`limit`/`total`/`totalPages`.
- `lowSampleSize=true` khi `totalBookings<3`, item vẫn xuất hiện trong danh sách (KHÔNG bị loại — verify khác cách UC-AA-07 xử lý ngưỡng).

#### T-W: Unit test EX1 (`noShowCount=0`)

- Kỳ có `totalBookings>0` nhưng `noShowCount=0` → vẫn trigger EX1 với message tích cực (verify KHÔNG nhầm với "không có dữ liệu" — khác các EX1 khác).
- `organizerEmail` không khớp user nào → trả response rỗng như EX1, không lỗi.

#### T-X: Unit test DTO validation + controller

- `preset`/`rankBy`/`page`/`limit`/`departmentIds`/`roomId`/`organizerEmail` sai format → lỗi.
- Request hợp lệ → 200 đúng cấu trúc; audit log gọi khi thành công.

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic |
|---|---|
| AC-001 | T-E, T-L, T-M, T-Q |
| AC-002 | T-G, T-N (Manager chỉ 1 dòng — hành vi tự nhiên) |
| AC-003 | T-O |
| AC-004 | T-J |
| AC-005 | T-A |
| AC-006 | T-Q, T-W |
| AC-007 | T-P, T-V |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Nhầm định nghĩa no-show (thiếu/thừa `detection_status`) | Sai số liệu KPI cốt lõi của toàn bộ feature | Unit test T-U liệt kê đủ 6 trạng thái, verify chỉ `confirmed`/`released` được tính |
| Dùng nhầm `detected_at`/`meetings.start_time` thay vì `reserved_start_time` | Lệch pha tử số/mẫu số, sai lệch dữ liệu theo ngưỡng phút cấu hình | Unit test T-U cụ thể verify mốc thời gian, đặc biệt case biên đầu/cuối kỳ |
| Lẫn tiêu chí sort giữa 3 nhánh `rankBy` (copy-paste sai `ORDER BY`) | Sai đúng yêu cầu nghiệp vụ nêu rõ trong Normal Flow bước 4 | Unit test T-V verify từng nhánh riêng biệt với dữ liệu có thể phân biệt rõ 2 tiêu chí |
| Vô tình loại item mẫu nhỏ khỏi `ranking.items` (nhầm sang pattern ngưỡng loại trừ của UC-AA-07) | Sai lệch với quyết định đã chọn ở feature này (§0.7) | Unit test T-V cụ thể verify item mẫu nhỏ (`totalBookings<3`) vẫn xuất hiện, chỉ có cờ |
| Lệch với `API_CONTRACT` UC-156 gốc (bỏ `trend`, đổi cấu trúc ranking) | FE code sai theo tài liệu cũ | Đề xuất đồng bộ tài liệu ở task riêng (CL-1 spec.md) |

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T-C, T-L |
| FR-004 | T-B |
| FR-005–FR-007 | T-E |
| FR-008–FR-010 | T-G, T-H |
| FR-011 | T-I, T-J |
| FR-012 | T-K |
| FR-013, FR-014 | T-P, T-Q |
| FR-015, FR-016 | T-M, T-N, T-O |
| FR-017 | T-Q, T-W |
| FR-018 | T-P |
| FR-019 | T-K |
| FR-020 | T-H, T-J, T-L |
| FR-021–FR-030 | T-A, T-F, T-H, T-J |
| FR-031, FR-032 | T-G, T-I |
| FR-033–FR-035 | T-L, T-Q |
| FR-036–FR-038 | T-M, T-N, T-O |
| FR-039 | T-P |
| FR-040 | T-R |
| FR-041, FR-042 | T-G, T-F |
