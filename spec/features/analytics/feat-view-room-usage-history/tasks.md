# Tasks: Xem lịch sử sử dụng phòng họp theo khoảng thời gian (UC-RUM-04)

**Feature**: RUM-ROOM-USAGE-HISTORY-001 — View Room Usage History
**Module**: analytics
**Branch**: `028-view-room-usage-history`
**Date**: 2026-07-09

**Input documents**:
- spec.md, plan.md

**Path Conventions**:
- Source files: `src/modules/analytics/` (module + `dto/services/repositories/controllers/tests` đã tồn tại từ UC-AA-01/UC-AA-02 — chỉ thêm file mới)
- Tái dùng: `RoomUsageDashboardService.resolveScope()`/`resolveDateRange()`, `DashboardOverviewConfigService.getMaxRangeDays()`, `AuthzReadRepository`, `AuditLogsService` (đã có)
- **Không** cần seed permission mới (`analytics.room.read` đã seed ở UC-AA-02)

---

## Phase 1: Setup

- [ ] T001 [P] Tạo `src/modules/analytics/dto/query-room-usage-history.dto.ts`
- [ ] T002 [P] Tạo `src/modules/analytics/dto/room-usage-history-response.dto.ts`
- [ ] T003 [P] Tạo `src/modules/analytics/services/room-usage-history-config.service.ts`
- [ ] T004 [P] Tạo `src/modules/analytics/repositories/room-usage-history.repository.ts`
- [ ] T005 [P] Tạo `src/modules/analytics/controllers/room-usage-history.controller.ts`
- [ ] T006 [P] Tạo `src/modules/analytics/services/room-usage-history.service.ts`
- [ ] T007 [P] Tạo `src/modules/analytics/tests/room-usage-history.service.spec.ts` và `room-usage-history.repository.spec.ts`

---

## Phase 2: Foundational

- [ ] T008 [FR-019–FR-024] [P] Implement `QueryRoomUsageHistoryDto` trong `query-room-usage-history.dto.ts`
  - `@IsOptional() @IsEnum(['day','week','month','custom']) preset?: string`
  - `@IsOptional() @IsDateString() from?: string`
  - `@IsOptional() @IsDateString() to?: string`
  - `@IsOptional() @IsUUID() roomId?: string`
  - `@IsOptional() @IsString() @MaxLength(150) siteName?: string`
  - `@IsOptional() @IsString() @MaxLength(150) areaName?: string`
  - `@IsOptional() @IsEnum(['reservedStartTime','sessionStatus']) sortBy?: string`
  - `@IsOptional() @IsEnum(['asc','desc']) sortOrder?: string`
  - `@IsOptional() @IsInt() @Min(1) page?: number`
  - `@IsOptional() @IsInt() @Min(1) @Max(100) limit?: number`

- [ ] T009 [FR-027–FR-032] [P] Implement DTO response trong `room-usage-history-response.dto.ts`
  - `RoomUsageSessionDto`: `roomId, roomName, meetingId, meetingTitle, hostName, reservedStartTime, reservedEndTime, actualStartTime (Date|null), actualEndTime (Date|null), sessionStatus (enum)`
  - `RoomUsageHistorySummaryDto`: `totalReservedHours, totalActualHours (number|null), noShowCount, reservationUtilizationRate, roomOccupancyRate (number|null)`
  - `RoomUsageHistoryResponseDto`: `period, summary, sessions: RoomUsageSessionDto[]`
  - `PaginationMetaDto`: `page, limit, total, totalPages`
  - Định nghĩa enum `SessionStatus`: `completed | no_show | early_empty | released | cancelled_late | cancelled | not_started | in_progress | pending_evaluation`

- [ ] T010 [FR-DATA-003] Implement `RoomUsageHistoryConfigService.getLateCancellationThresholdMinutes()` trong `room-usage-history-config.service.ts`
  - Precedence: `system_configs['analytics.late_cancellation_threshold_minutes']` → env `ANALYTICS_LATE_CANCELLATION_THRESHOLD_MINUTES` → default `60`
  - Mirror `RoomUsageConfigService.getOperatingHoursPerDay()` đã có (UC-AA-02)

- [ ] T011 [FR-004] Tạo `RoomUsageHistoryController` (shell) trong `room-usage-history.controller.ts`
  - `@Controller('analytics/rooms')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('analytics.room.read')`
  - `@Get('usage-history') getHistory(@Query() query: QueryRoomUsageHistoryDto, @CurrentUser() currentUser)`

- [ ] T012 [FR-001] Tạo `RoomUsageHistoryService` (shell) trong `room-usage-history.service.ts`
  - Inject: `RoomUsageDashboardService` (tái dùng `resolveScope`/`resolveDateRange`), `DashboardOverviewConfigService` (tái dùng `getMaxRangeDays`), `RoomUsageHistoryConfigService`, `RoomUsageHistoryRepository`
  - `getUsageHistory(currentUser, query)` — throw `NotImplementedException` tạm

- [ ] T013 [Refactor] Kiểm tra/đổi visibility `resolveScope`/`resolveDateRange` trong `RoomUsageDashboardService` từ private-by-convention sang `public` (nếu cần) để service mới gọi được — KHÔNG đổi logic bên trong, chỉ đổi khả năng truy cập

- [ ] T014 [Module] Cập nhật `src/modules/analytics/analytics.module.ts`
  - Đăng ký `RoomUsageHistoryController` vào `controllers`
  - Đăng ký `RoomUsageHistoryService`, `RoomUsageHistoryRepository`, `RoomUsageHistoryConfigService` vào `providers`
  - Xác nhận `RoomUsageDashboardService` khả dụng để inject (cùng module, không cần export thêm)

---

## Phase 3: Business Logic — Date Range, Scope & Validation

- [ ] T015 [FR-005–FR-007, FR-003] Gọi `RoomUsageDashboardService.resolveDateRange(query)` trong `RoomUsageHistoryService` — KHÔNG viết lại logic preset

- [ ] T016 [FR-022, FR-036, NFR-002] Gọi `DashboardOverviewConfigService.getMaxRangeDays()` sau khi có `from/to`
  - Vượt ngưỡng → `BadRequestException({code:'DATE_RANGE_TOO_LARGE'})`, message build động theo giá trị config thật (không hard-code "6 tháng")

- [ ] T017 [FR-003, FR-026, FR-DATA-001] Gọi `RoomUsageDashboardService.resolveScope(currentUser.userId, from, to)` — KHÔNG viết lại logic scope Manager

- [ ] T018 [FR-023, ERR-006] Validate `sortBy`/`sortOrder` trong DTO (đã validate ở T008) + double-check ở service nếu cần default fallback khi field undefined

- [ ] T019 [FR-024, ERR-007] Validate `page`/`limit` trong DTO (đã validate ở T008), áp default `page=1, limit=20` nếu không truyền

---

## Phase 4: Business Logic — Query & Derive Status

- [ ] T020 [FR-008, FR-009, FR-015, FR-016, FR-010–FR-012] Implement `listSessions(params)` trong `room-usage-history.repository.ts`
  - JOIN `room_bookings` + `meetings` + `rooms` + LEFT JOIN `room_booking_usages` (theo `booking_id`) + LEFT JOIN `users` (host, fallback organizer)
  - Filter: scope (`scopeRoomIds`), `roomId`, `siteName`, `areaName`, khoảng `[from, to]` chồng lấn `reservedStartTime/reservedEndTime`
  - **KHÔNG loại `status=cancelled`** (khác `RoomUsageDashboardRepository`)
  - Sort theo `sortBy`/`sortOrder` (map `reservedStartTime` → cột SQL thật, `sessionStatus` → cần derive trước khi sort HOẶC sort theo cột proxy đơn giản ở DB rồi service tự sort lại theo `sessionStatus` đã derive — quyết định: derive trước ở service rồi sort ở service khi `sortBy=sessionStatus`, sort ở SQL khi `sortBy=reservedStartTime`)
  - `LIMIT/OFFSET` theo `page/limit` — CHỈ áp dụng khi `sortBy=reservedStartTime`; khi `sortBy=sessionStatus`, lấy toàn bộ scope+filter (không LIMIT ở SQL), derive rồi sort+paginate ở service (ghi rõ trade-off hiệu năng trong code comment ngắn, không viết doc dài)

- [ ] T021 [FR-029, FR-030, FR-031, FR-032, NFR-005] Implement `getSummaryAggregate(params)` trong repository
  - Cùng scope + filter như T020 nhưng KHÔNG `LIMIT/OFFSET`
  - Trả `{totalReservedMinutes, totalActualMinutes, hasActualData, statusCounts: Record<SessionStatus, number>}`
  - `statusCounts` cần tính bằng cách derive `sessionStatus` cho toàn bộ tập kết quả (không chỉ đếm theo `usage_status` thô, vì `cancelled_late` không nằm trong `usage_status`) — có thể implement bằng cách gọi lại hàm derive (T022) trên toàn bộ raw rows, không cần query riêng

- [ ] T022 [FR-028, FR-DATA-002] Implement `deriveSessionStatus(row, lateCancellationThresholdMinutes, now)` trong `RoomUsageHistoryService`
  - Input row tối thiểu: `bookingStatus, bookingUpdatedAt, reservedStartTime, reservedEndTime, usageStatus (nullable)`
  - Thứ tự kiểm tra (đúng bảng §0.2 spec.md):
    1. `bookingStatus === 'cancelled'` → tính `diffMinutes = (reservedStartTime - bookingUpdatedAt) phút`; nếu `diffMinutes <= threshold` (kể cả âm, tức đã hủy sau giờ bắt đầu) → `cancelled_late`; ngược lại → `cancelled`
    2. Ngược lại, nếu `usageStatus` tồn tại → map 1-1: `completed→completed, no_show→no_show, early_empty→early_empty, released→released, in_use→in_progress, not_started→not_started`
    3. Ngược lại, nếu `reservedEndTime < now` → `pending_evaluation`
    4. Ngược lại → `not_started`

- [ ] T023 [FR-033] Implement resolve `hostName` trong query T020: `COALESCE(host.full_name, organizer.full_name)` (ưu tiên `meetings.host_id`, fallback `meetings.organizer_id`)

- [ ] T024 [FR-013, FR-014, FR-035] Implement empty state trong `RoomUsageHistoryService`
  - `resolvedScopeRoomIds = []` (MANAGER không có phòng) HOẶC không có `room_bookings` nào khớp → `sessions=[]`, `summary` toàn `0`/`totalActualHours=null`/`roomOccupancyRate=null`, `message` build động theo E1: `"Không có dữ liệu sử dụng phòng họp nào được ghi nhận trong khoảng thời gian từ {from} đến {to}."`

- [ ] T025 [FR-029–FR-032] Implement `buildSummary(aggregate, operatingHoursPerDay, from, to)` trong `RoomUsageHistoryService`
  - `totalReservedHours = totalReservedMinutes / 60`
  - `totalActualHours = hasActualData ? totalActualMinutes / 60 : null`
  - `noShowCount = statusCounts['no_show'] ?? 0`
  - `reservationUtilizationRate`/`roomOccupancyRate`: tái dùng đúng công thức `RoomUsageDashboardService` (UC-AA-02) — gọi lại hàm có sẵn nếu đã export dạng static/pure function, hoặc inject `RoomUsageConfigService` để lấy `operatingHoursPerDay`

- [ ] T026 [FR-027] Implement `buildResponse(sessions, summary, period, meta)` trong `RoomUsageHistoryService` — gộp thành `RoomUsageHistoryResponseDto`

---

## Phase 5: Controller Wiring & Error Handling

- [ ] T027 [FR-004, FR-034] Hoàn thiện `RoomUsageHistoryController.getHistory()`
  - Thứ tự: `resolveDateRange` (T015) → `maxRangeDays` check (T016) → `resolveScope` (T017) → query song song (T020, T021) → `deriveSessionStatus` cho từng row (T022) → `buildSummary` (T025) → `buildResponse` (T026)
  - Audit log non-blocking `action_type='read_analytics_room_usage_history'` (gated `AUDIT_LOG_ENABLED`), `metadata_json` gồm `{viewerUserId, viewerRole, from, to, roomId?, page, limit, resolvedScopeRoomIds}`
  - Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 6: Testing

- [ ] T028 [Test, AC-003, AC-004] [P] Unit test `deriveSessionStatus()` — đủ nhánh
  - `cancelled` trong ngưỡng (trước giờ bắt đầu) → `cancelled_late`
  - `cancelled` sau khi giờ bắt đầu đã qua (updatedAt > reservedStartTime) → `cancelled_late`
  - `cancelled` ngoài ngưỡng (hủy sớm) → `cancelled`
  - `usageStatus=completed` → `completed`
  - `usageStatus=no_show` → `no_show`
  - `usageStatus=early_empty` → `early_empty`
  - `usageStatus=released` → `released`
  - `usageStatus=in_use` → `in_progress`
  - `usageStatus=not_started` → `not_started`
  - Không có usage, `reservedEndTime < now` → `pending_evaluation`
  - Không có usage, `reservedEndTime >= now` → `not_started`

- [ ] T029 [Test, NFR-005] [P] Unit test summary tách biệt phân trang
  - `summary.noShowCount`/`totalReservedHours` tính đúng dù `limit=1&page=3` (so sánh với tính trên toàn bộ tập không phân trang)

- [ ] T030 [Test, AC-010] [P] Unit test sort + pagination
  - `sortBy=reservedStartTime&sortOrder=asc` → sort SQL đúng chiều
  - `sortBy=sessionStatus&sortOrder=desc` → sort ở service đúng chiều (sau derive)
  - `page=2&limit=10` → đúng offset, `meta.totalPages` đúng

- [ ] T031 [Test, AC-008, AC-009] [P] Unit test empty state (E1) + scope rỗng (BR1)
  - MANAGER scope rỗng → `sessions=[]`, không lỗi
  - Không có `room_bookings` nào khớp filter → `sessions=[]` + `message` đúng nội dung E1 (kiểm tra `from`/`to` được nội suy đúng vào message)

- [ ] T032 [Test, AC-005, AC-006, AC-007] [P] Unit test validation
  - `preset=custom` thiếu `to` → `VALIDATION_ERROR`
  - Range vượt `maxRangeDays` → `DATE_RANGE_TOO_LARGE`
  - `sortBy` không hợp lệ → `VALIDATION_ERROR`
  - `page<1`/`limit>100` → `VALIDATION_ERROR`

- [ ] T033 [Test] [P] Unit test `RoomUsageHistoryConfigService`
  - Precedence `system_configs → env → default 60`

- [ ] T034 [Test] [P] Unit test controller
  - Request hợp lệ → 200 đúng cấu trúc `{success, message, data, meta}`
  - Audit log gọi khi thành công, KHÔNG gọi khi lỗi 400/401/403
  - Lỗi không lường trước → 500 `INTERNAL_ERROR`

- [ ] T035 [Test, AC-002] [P] Unit test scope Manager theo kỳ lọc (tái dùng UC-AA-02, verify wiring đúng)
  - Manager chỉ thấy session của phòng trong scope tháng đang xem, không thấy phòng ngoài scope

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T036 [Polish] Verify response format `{success, message, data, meta}`
- [ ] T037 [Polish, FR-001] Verify read-only: không có write operation nào trong service/repository (ngoại trừ audit log dùng chung)
- [ ] T038 [Polish] Verify mọi raw SQL dùng parameter binding, không nối chuỗi
- [ ] T039 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `DATE_RANGE_TOO_LARGE`, `PERMISSION_DENIED`, `INTERNAL_ERROR`
- [ ] T040 [Polish] Verify KHÔNG có logic export (.xlsx/.csv) nào bị viết nhầm vào feature này — AF1 ngoài phạm vi (OOS-001)
- [ ] T041 [Polish] Verify KHÔNG copy-paste logic `resolveScope`/`resolveDateRange` từ `RoomUsageDashboardService` — phải gọi qua injection
- [ ] T042 [Docs] Cập nhật/ghi chú vào `docs/API_CONTRACT_v1.0_with_system_roles.md` rằng `GET /api/v1/analytics/rooms/usage-history` là endpoint mới bổ sung cho UC-RUM-04 (chưa có trong contract gốc)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Date range, Scope, Validation)**: Phụ thuộc Phase 2
- **Phase 4 (Query & Derive)**: Phụ thuộc Phase 2; T020/T021 độc lập, chạy song song; T022 độc lập (pure function), có thể code trước
- **Phase 5 (Wiring)**: Phụ thuộc Phase 3 + Phase 4
- **Phase 6 (Testing)**: Phụ thuộc Phase 5
- **Phase 7 (Polish)**: Phụ thuộc Phase 6

### Parallel Opportunities

- Phase 1: T001-T007 song song (khác file)
- Phase 4: T020, T021, T022, T023 song song (method độc lập); T024-T026 sau khi có raw data
- Phase 6: T028-T035 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 — Date range, scope, validation (tái dùng tối đa UC-AA-02)
3. Phase 4 — Query danh sách + summary + derive `sessionStatus` (điểm phức tạp nhất — ưu tiên T022 trước vì là pure function dễ test độc lập)
4. Phase 5 — Controller hoàn chỉnh, audit log
5. Phase 6 — Unit test toàn bộ nhánh (đặc biệt T028 derive status và T029 summary-tách-phân-trang)
6. Phase 7 — Polish, verify, đồng bộ tài liệu

MVP = Phase 1 → Phase 5.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T012, T015, T017 |
| FR-004, FR-017, FR-018 | T011 (guard có sẵn) |
| FR-005–FR-007 | T015 |
| FR-008, FR-009, FR-015, FR-016 | T020 |
| FR-010–FR-012 | T008, T020 |
| FR-013, FR-014, FR-035 | T024 |
| FR-019–FR-024 | T008, T016, T018, T019 |
| FR-025, FR-026 | T017 |
| FR-027 | T020, T026 |
| FR-028, FR-DATA-002 | T022 |
| FR-029–FR-032 | T021, T025 |
| FR-033 | T023 |
| FR-034 | T027 |
| FR-DATA-003 | T010 |
| NFR-001, NFR-006 | T020, T021 |
| NFR-005 | T021, T025 |
