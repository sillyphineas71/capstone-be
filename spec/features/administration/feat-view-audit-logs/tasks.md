# Tasks: Xem nhật ký kiểm tra hệ thống (UC-AA-11)

**Feature**: ADM-VIEW-AUDIT-LOGS-001 — View System Audit Logs
**Module**: administration
**Branch**: `026-view-audit-logs`
**Date**: 2026-07-02

**Input documents**:
- spec.md, plan.md

## Path Conventions

- Source files: `src/modules/administration/` (module đã tồn tại — chỉ thêm file mới)
- Seed file: `src/database/seeds/`
- Tái dùng: `AuditLogEntity`, `UserEntity` (đã import ở module khác)
- **KHÔNG sửa** `src/modules/administration/services/audit-logs.service.ts` (service GHI hiện có, dùng chung bởi mọi module khác) — tạo `AuditLogQueryService`/`AuditLogQueryRepository` hoàn toàn riêng biệt
- **PHẢI seed permission mới** `audit.system.read`, chỉ gán `SYSTEM_ADMIN`

---

## Phase 1: Setup

- [X] T001 [P] Tạo `src/modules/administration/dto/query-audit-logs.dto.ts`
- [X] T002 [P] Tạo `src/modules/administration/dto/audit-log-response.dto.ts`
- [X] T003 [P] Tạo `src/modules/administration/repositories/audit-log-query.repository.ts`
- [X] T004 [P] Tạo `src/modules/administration/controllers/audit-logs.controller.ts`
- [X] T005 [P] Tạo `src/modules/administration/services/audit-log-query.service.ts`
- [X] T006 [P] Tạo `src/modules/administration/tests/audit-log-query.service.spec.ts` và `audit-log-query.repository.spec.ts`

---

## Phase 2: Foundational

- [X] T007 [FR-017-FR-022] [P] Implement `QueryAuditLogsDto` trong `query-audit-logs.dto.ts`
  - `@IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number`
  - `@IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number`
  - `@IsOptional() @IsDateString() from?: string`
  - `@IsOptional() @IsDateString() to?: string`
  - `@IsOptional() @IsUUID() userId?: string`
  - `@IsOptional() @IsString() @MaxLength(80) actionType?: string`
  - `@IsOptional() @IsString() @MaxLength(80) entityType?: string`
  - `@IsOptional() @IsEnum(['info','warning','error','critical']) severity?: string`

- [X] T008 [FR-025-FR-027] [P] Implement DTO response trong `audit-log-response.dto.ts`
  - `AuditLogItemDto { id: string; createdAt: Date; actorUserId: string|null; actorName: string; actionType: string; entityType: string; entityId: string|null; severity: string }`
  - `AuditLogListResponseDto { data: AuditLogItemDto[]; meta: { page: number; limit: number; total: number; totalPages: number } }`

- [X] T009 [FR-004] Tạo `AuditLogsController` (shell) trong `audit-logs.controller.ts`
  - `@Controller('audit-logs')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('audit.system.read')` class-level
  - `@Get() listAuditLogs(@Query() query: QueryAuditLogsDto)`

- [X] T010 [FR-001] Tạo `AuditLogQueryService` (shell) trong `audit-log-query.service.ts`
  - Inject: `AuditLogQueryRepository`
  - `listAuditLogs(query)` — throw `NotImplementedException` tạm

- [X] T011 [Module] Cập nhật `src/modules/administration/administration.module.ts`
  - Đăng ký `AuditLogsController` vào `controllers`
  - Đăng ký `AuditLogQueryService`, `AuditLogQueryRepository` vào `providers`
  - Xác nhận `TypeOrmModule.forFeature` đã có `AuditLogEntity`, `UserEntity`

---

## Phase 3: Business Logic — Validation & Filter Building

- [X] T012 [FR-005, FR-006] Implement default `page=1, limit=20` trong `AuditLogQueryService` khi query thiếu

- [X] T013 [FR-020] Implement validate `from > to` trong `AuditLogQueryService`
  - Cả 2 truyền và `from > to` → `BadRequestException({code:'VALIDATION_ERROR'})`

- [X] T014 [FR-008-FR-013, FR-016] Implement `buildFilters(query)` trong `AuditLogQueryService`
  - Gộp `from/to/userId/actionType/entityType/severity` thành object điều kiện, bỏ qua field không truyền
  - Không truyền gì → object rỗng (không filter, đúng Normal Flow bước 2)

---

## Phase 4: Business Logic — Query & Response

- [X] T015 [FR-003, FR-008-FR-013] Implement `findPaginated(filters, page, limit)` trong `audit-log-query.repository.ts`
  - `audit_logs al` LEFT JOIN `users u ON u.id = al.user_id`
  - WHERE: áp từng điều kiện trong `filters` nếu có (`al.created_at BETWEEN :from AND :to`, `al.user_id = :userId`, `al.action_type = :actionType`, `al.entity_type = :entityType`, `al.severity = :severity`) — kết hợp AND
  - `ORDER BY al.created_at DESC` (cố định, không tham số đổi chiều)
  - `LIMIT :limit OFFSET (:page-1)*:limit`
  - Parameterized, không nối chuỗi
  - Trả `{ rows: AuditLogEntity[] }`

- [X] T016 [FR-027] Implement `countMatching(filters)` trong repository
  - Cùng WHERE ở T015, `COUNT(*)`, KHÔNG `JOIN`/`ORDER BY`/`LIMIT`
  - Trả `total: number`

- [X] T017 [FR-014, FR-026] Implement resolve `actorName` trong `AuditLogQueryService`
  - `row.userId === null` → `actorUserId=null`, `actorName="Hệ thống"`
  - Ngược lại → `actorUserId=row.userId`, `actorName=row.user.fullName` (từ LEFT JOIN T015)

- [X] T018 [FR-025] Implement map mỗi row thành `AuditLogItemDto` trong `AuditLogQueryService`
  - Chỉ map đúng 5 trường: `createdAt`, `actorUserId`/`actorName`, `actionType`, `entityType`/`entityId`, `severity`
  - **KHÔNG** map `oldValueJson`/`newValueJson`/`metadataJson`/`ipAddress`/`userAgent`/`requestId`

- [X] T019 [FR-015, FR-027] Implement `buildResponse(rows, total, page, limit)` trong `AuditLogQueryService`
  - `meta = {page, limit, total, totalPages: Math.ceil(total/limit)}`
  - `data=[]` khi không khớp filter nào → KHÔNG thêm `message` (khác pattern EX1 của feature `analytics.*`)

---

## Phase 5: Controller Wiring, Error Handling & Seed

- [X] T020 [FR-004, FR-023, FR-028] Hoàn thiện `AuditLogsController.listAuditLogs()` / `AuditLogQueryService.listAuditLogs()`
  - Thứ tự: validate DTO (`ValidationPipe`, T007) → `page/limit` default (T012) → validate `from>to` (T013) → `buildFilters` (T014) → `findPaginated` (T015) → `countMatching` (T016) → resolve `actorName` (T017) → map DTO (T018) → `buildResponse` (T019)
  - **KHÔNG** gọi `AuditLogsService.logAction()`/`logSecurityEvent()`/`logEntityChange()` ở bất kỳ đâu trong luồng này (verify kỹ — dễ thêm nhầm theo thói quen từ feature `analytics.*`)
  - Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

- [X] T021 [Seed] Tạo `src/database/migrations/20260703000000-SeedAuditSystemReadPermission.ts`
  - Tạo permission `audit.system.read`
  - Gán **CHỈ** cho role `SYSTEM_ADMIN` (KHÔNG gán `MANAGER`/`BUSINESS_ADMIN`)

---

## Phase 6: Testing

- [X] T022 [Test, AC-005] [P] Unit test `QueryAuditLogsDto` validation
  - `page`/`limit` sai format, `limit>100` → lỗi
  - `from`/`to` sai định dạng ISO, `from>to` → lỗi
  - `userId` không phải UUID → lỗi
  - `severity` sai enum → lỗi

- [X] T023 [Test, AC-001, AC-002] [P] Unit test `findPaginated()`/`countMatching()` — filter kết hợp AND
  - Không filter → trả toàn bộ, mới nhất trước (`created_at DESC`)
  - Từng filter riêng lẻ lọc đúng: `from/to`, `userId`, `actionType`, `entityType`, `severity`
  - Kết hợp nhiều filter cùng lúc → đúng AND (verify không lẫn OR)
  - Phân trang: `page=2, limit=20` trên 45 bản ghi → trả đúng bản ghi 21-40, `total=45`
  - Sort luôn `created_at DESC`, không có param nào đổi được chiều

- [X] T024 [Test, AC-003] [P] Unit test resolve `actorName` — **quan trọng**
  - `user_id` khác null → `actorName` đúng `full_name` của user tương ứng
  - `user_id = NULL` → `actorUserId=null`, `actorName="Hệ thống"` (verify nguyên văn)

- [X] T025 [Test] [P] Unit test response shape — verify KHÔNG lộ field nhạy cảm
  - Mỗi item response chỉ có đúng các field: `id, createdAt, actorUserId, actorName, actionType, entityType, entityId, severity`
  - Verify KHÔNG có `oldValueJson`/`newValueJson`/`metadataJson`/`ipAddress`/`userAgent`/`requestId`

- [X] T026 [Test, AC-006] [P] Unit test empty result
  - Filter không khớp bản ghi nào → `data=[]`, `meta.total=0`, response KHÔNG có trường `message`

- [X] T027 [Test, AC-007] [P] Unit test KHÔNG tự ghi audit log — **quan trọng, dễ sai theo thói quen**
  - Spy `AuditLogsService.logAction`/`logSecurityEvent`/`logEntityChange` → gọi API thành công → verify KHÔNG hàm nào trong 3 hàm này được gọi

- [X] T028 [Test, AC-004] [P] Unit test authorization + controller
  - Chưa đăng nhập → 401
  - Thiếu permission `audit.system.read` → 403 `PERMISSION_DENIED`
  - Request hợp lệ → 200 đúng cấu trúc `{data, meta}`
  - Lỗi không lường trước → 500 `INTERNAL_ERROR`

- [X] T029 [Test] [P] Unit test seed permission `audit.system.read`
  - Tạo đúng permission, gán **CHỈ** `SYSTEM_ADMIN`
  - Verify KHÔNG có bản ghi `role_permissions` nào gán permission này cho `MANAGER`/`BUSINESS_ADMIN`

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T030 [Polish] Verify response format `{success, message, data, meta}`
- [X] T031 [Polish, FR-001, FR-002] Verify read-only tuyệt đối: không có bất kỳ endpoint PATCH/PUT/DELETE nào cho `audit_logs`, không có write operation nào trong service/repository của feature này
- [X] T032 [Polish] Verify raw SQL dùng parameter binding, không nối chuỗi
- [X] T033 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `PERMISSION_DENIED`, `INTERNAL_ERROR`
- [X] T034 [Polish] Verify KHÔNG sửa file `audit-logs.service.ts` hiện có (service ghi) trong toàn bộ quá trình implement feature này
- [X] T035 [Polish] Verify KHÔNG JOIN sang bất kỳ bảng nghiệp vụ nào khác theo `entity_type` để resolve tên thân thiện (OOS-003 spec.md)
- [X] T036 [Test] Chạy lại toàn bộ Acceptance Criteria trong spec.md §7 để verify end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Validation & Filter)**: Phụ thuộc Phase 2
- **Phase 4 (Query & Response)**: Phụ thuộc Phase 2; phụ thuộc Phase 3 để có filter object trước khi query
- **Phase 5 (Wiring & Seed)**: Phụ thuộc Phase 3 + Phase 4
- **Phase 6 (Testing)**: Phụ thuộc Phase 5
- **Phase 7 (Polish)**: Phụ thuộc Phase 6

### Parallel Opportunities

- Phase 1: T001-T006 song song (khác file)
- Phase 6: T022-T029 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 + Phase 4 — Business logic đầy đủ (filter AND, phân trang, resolve actorName, response gọn 5 trường)
3. Phase 5 — Controller hoàn chỉnh (KHÔNG tự ghi audit log), seed permission mới chỉ SYSTEM_ADMIN
4. Phase 6 — Unit test toàn bộ nhánh (đặc biệt T024 resolve-actorName và T027 không-tự-ghi-log là 2 điểm rủi ro cao nhất của feature này)
5. Phase 7 — Polish, verify không sửa service ghi hiện có, verify không JOIN bảng nghiệp vụ khác

MVP = Phase 1 → Phase 5.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001, FR-002, FR-003 | T010, T015 |
| FR-004 | T009 |
| FR-005, FR-006 | T012 |
| FR-007–FR-013 | T014, T015 |
| FR-014 | T017 |
| FR-015 | T019 |
| FR-016 | T014 |
| FR-017–FR-022 | T007, T013 |
| FR-023, FR-024 | T009 |
| FR-025–FR-027 | T016, T018, T019 |
| FR-028 | T020 |
