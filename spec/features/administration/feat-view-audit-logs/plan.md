# Implementation Plan: Xem nhật ký kiểm tra hệ thống (UC-AA-11)

**Branch**: `026-view-audit-logs` | **Date**: 2026-07-02
**Spec**: spec/features/administration/feat-view-audit-logs/spec.md

## Summary

Tính năng cho phép System Admin (duy nhất role được cấp quyền) xem danh sách phân trang toàn bộ `audit_logs`, sắp xếp cố định giảm dần theo `created_at`, kèm bộ lọc tùy chọn (`from/to/userId/actionType/entityType/severity`) bổ sung ngoài Normal Flow literal. Mỗi bản ghi chỉ trả đúng 5 trường hiển thị (Timestamp, Actor, Action, Entity, Severity — map vào cột "Trạng thái"), không trả `old_value_json`/`new_value_json`/`metadata_json`. 1 endpoint mới hoàn toàn: `GET /api/v1/audit-logs` (không có UC-1xx baseline trong `API_CONTRACT` — thiết kế mới dựa trên schema `audit_logs` + permission `audit.system.read` đã có tên sẵn nhưng chưa seed). Read-only tuyệt đối, không thêm bảng/cột, chỉ seed 1 permission mới. Không tự ghi audit log cho chính hành động xem (khác pattern `analytics.*`).

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT
**Storage**: PostgreSQL (read-only query, LEFT JOIN `audit_logs + users`, tận dụng index sẵn có)
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 2s cho trang đầu tiên không lọc
**Constraints**: Read-only tuyệt đối; không PATCH/PUT/DELETE cho `audit_logs`; không tự ghi audit log cho chính hành động đọc; không JOIN sang bảng nghiệp vụ theo `entity_type`
**Scale**: Không giới hạn cứng khoảng thời gian `from/to`; `limit` tối đa 100/trang

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột — chỉ seed 1 permission mới `audit.system.read` (tên đã có sẵn trong bảng permission tổng của `API_CONTRACT`) |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('audit.system.read')` (permission MỚI, seed ở feature này); không scope phòng ban (toàn hệ thống) |
| **Scope Gate** | PASS | Chỉ 1 endpoint mới; không thêm endpoint chi tiết/sửa/xóa (BR1) |
| **Module Gate** | PASS | Code trong `src/modules/administration/`; KHÔNG sửa `AuditLogsService` hiện có (service ghi) — tạo repository/service đọc riêng, tách bạch trách nhiệm ghi/đọc |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint mới hoàn toàn, không có contract cũ để lệch |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Test Gate** | PASS | Unit test cho filter kết hợp AND, phân trang, resolve actorName, KHÔNG tự ghi audit log cho chính request đọc |

## Project Structure

### Documentation (this feature)

```text
spec/features/administration/feat-view-audit-logs/
├── spec.md
├── plan.md              # File này
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/administration/
├── administration.module.ts                        # Update: đăng ký thêm controller/service/repository mới
├── controllers/
│   ├── background-jobs.controller.ts                # Đã có
│   └── audit-logs.controller.ts                     # NEW: GET /audit-logs
├── services/
│   ├── audit-logs.service.ts                        # Đã có — service GHI, KHÔNG sửa
│   └── audit-log-query.service.ts                   # NEW: orchestrator ĐỌC — validate filter, phân trang, build response
├── repositories/
│   └── audit-log-query.repository.ts                # NEW: query phân trang + LEFT JOIN users
├── dto/
│   ├── query-audit-logs.dto.ts                      # NEW
│   └── audit-log-response.dto.ts                    # NEW
└── tests/
    ├── audit-log-query.service.spec.ts
    └── audit-log-query.repository.spec.ts

src/database/seeds/
└── <timestamp>-SeedAuditSystemReadPermission.ts       # NEW: seed permission audit.system.read + gán SYSTEM_ADMIN (chỉ role này)
```

**Structure Decision**: Mở rộng module `administration` đã có. Tạo `AuditLogQueryService`/`AuditLogQueryRepository` **tách biệt hoàn toàn** khỏi `AuditLogsService` hiện có (service ghi, dùng bởi mọi module khác) — tránh trộn trách nhiệm ghi/đọc trong cùng 1 class, và tránh rủi ro vô tình phá vỡ hành vi ghi log đang được toàn hệ thống phụ thuộc.

## Complexity Tracking

Không vi phạm constitution. Feature này đơn giản hơn hẳn nhóm `analytics.*` (không có scope Manager, không có công thức tổng hợp/so sánh kỳ) — chỉ là 1 query phân trang có filter kết hợp AND. Điểm cần chú ý duy nhất là đảm bảo **không vô tình gọi `AuditLogsService.logAction()`** ở bất kỳ đâu trong luồng xử lý request này (§0.10 spec.md) — dễ bị thêm nhầm nếu lập trình viên copy pattern audit-logging đã quen từ các feature `analytics.*` trước đó.

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/query-audit-logs.dto.ts`, `dto/audit-log-response.dto.ts`, `repositories/audit-log-query.repository.ts`, `controllers/audit-logs.controller.ts`, `services/audit-log-query.service.ts`, `tests/*.spec.ts`, seed migration mới.

### Phase 2: Foundational

#### T-A: DTO

- `query-audit-logs.dto.ts`: `@IsOptional() @Type(()=>Number) @IsInt() @Min(1) page?`, `@IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) limit?`, `@IsOptional() @IsDateString() from?`, `to?`, `@IsOptional() @IsUUID() userId?`, `@IsOptional() @IsString() @MaxLength(80) actionType?`, `@IsOptional() @IsString() @MaxLength(80) entityType?`, `@IsOptional() @IsEnum(['info','warning','error','critical']) severity?`.
- `audit-log-response.dto.ts`: `AuditLogItemDto {id, createdAt, actorUserId, actorName, actionType, entityType, entityId, severity}`, `AuditLogListResponseDto {data: AuditLogItemDto[], meta: {page, limit, total, totalPages}}`.

#### T-B: Controller shell

- `audit-logs.controller.ts`: `@Controller('audit-logs')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('audit.system.read')` class-level, `@Get()` → `service.listAuditLogs(query)`.

#### T-C: Service shell

- `audit-log-query.service.ts`: inject `AuditLogQueryRepository`. Method `listAuditLogs(query)` — throw `NotImplementedException` tạm.

#### T-D: Module wiring

- Cập nhật `administration.module.ts`: đăng ký `AuditLogsController`, `AuditLogQueryService`, `AuditLogQueryRepository`; xác nhận `TypeOrmModule.forFeature` đã có `AuditLogEntity`, `UserEntity`.

### Phase 3: Business Logic — Validation & Filter Building

#### T-E: Validate `page`/`limit`

- Thiếu → mặc định `page=1, limit=20`. `limit` vượt `100` hoặc không phải số nguyên dương → `BadRequestException({code:'VALIDATION_ERROR'})` (DTO tự validate qua `ValidationPipe`).

#### T-F: Validate `from`/`to`

- Cả 2 phải là ISO date hợp lệ nếu truyền; `from > to` → `BadRequestException({code:'VALIDATION_ERROR'})`. Không truyền → không áp filter thời gian (khác các feature `analytics.*`, KHÔNG có giới hạn `max_range_days`).

#### T-G: Build filter object

- `buildFilters(query)`: gộp `from/to/userId/actionType/entityType/severity` thành object điều kiện AND, bỏ qua field không truyền.

### Phase 4: Business Logic — Query & Response

#### T-H: Repository — `findPaginated(filters, page, limit)`

- Base query: `audit_logs al` LEFT JOIN `users u ON u.id = al.user_id`.
- WHERE: áp từng điều kiện trong `filters` nếu có (`al.created_at BETWEEN`, `al.user_id =`, `al.action_type =`, `al.entity_type =`, `al.severity =`).
- `ORDER BY al.created_at DESC` (cố định, không tham số).
- `LIMIT :limit OFFSET (:page-1)*:limit`.
- Query riêng `COUNT(*)` (cùng WHERE, không `JOIN`/`ORDER BY`/`LIMIT`) để lấy `total`.
- Parameterized, không nối chuỗi.
- Trả `{rows: AuditLogEntity[], total: number}`.

#### T-I: Service — resolve `actorName`

- Với mỗi row: `actorUserId = row.userId`; `actorUserId === null` → `actorName = "Hệ thống"`; ngược lại → `actorName = row.user.fullName` (từ LEFT JOIN).

#### T-J: Service — build response

- Map mỗi row thành `AuditLogItemDto` (đúng 5 trường — KHÔNG bao gồm `oldValueJson`/`newValueJson`/`metadataJson`/`ipAddress`/`userAgent`/`requestId`).
- `meta = {page, limit, total, totalPages: Math.ceil(total/limit)}`.
- Không tính bất kỳ `message` đặc biệt nào khi `data=[]` (UC gốc không có Exceptions cho case này — khác mọi feature `analytics.*`).

### Phase 5: Controller Wiring, Error Handling & Seed

#### T-K: Wire controller

- Thứ tự: validate DTO (T-E, T-F qua `ValidationPipe`) → `buildFilters` (T-G) → `findPaginated` (T-H) → resolve `actorName` (T-I) → build response (T-J).
- **KHÔNG** gọi `AuditLogsService.logAction()` hay bất kỳ audit-write nào (§0.10 spec.md — verify kỹ ở review, dễ bị thêm nhầm theo thói quen từ feature `analytics.*`).
- Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

#### T-L: Seed permission mới

- Tạo `src/database/seeds/<timestamp>-SeedAuditSystemReadPermission.ts`: tạo permission `audit.system.read`, gán **CHỈ** cho role `SYSTEM_ADMIN` (không gán `MANAGER`/`BUSINESS_ADMIN` — khác `audit.user.read`).

### Phase 6: Testing

#### T-M: Unit test DTO validation

- `page`/`limit` sai format, `limit>100`, `from>to`, `userId` không phải UUID, `severity` sai enum → lỗi `VALIDATION_ERROR`.

#### T-N: Unit test `findPaginated()` — filter kết hợp AND

- Không filter → trả toàn bộ, mới nhất trước.
- Từng filter riêng lẻ (`from/to`, `userId`, `actionType`, `entityType`, `severity`) lọc đúng.
- Kết hợp nhiều filter cùng lúc → áp dụng đúng AND (verify không lẫn OR).
- Phân trang đúng `page`/`limit`, `total` khớp `COUNT(*)` thật (không bị ảnh hưởng bởi `LIMIT`).
- Sort luôn `created_at DESC`, không có cách nào đổi chiều qua query param.

#### T-O: Unit test resolve `actorName` — **quan trọng**

- `user_id` khác null → `actorName` = đúng `full_name` của user đó.
- `user_id = NULL` → `actorUserId=null`, `actorName="Hệ thống"` (verify chính xác nguyên văn).

#### T-P: Unit test response shape — verify KHÔNG lộ field nhạy cảm

- Response mỗi item chỉ có đúng 5 trường (`createdAt`, `actorUserId`, `actorName`, `actionType`, `entityType`, `entityId`, `severity`) — verify KHÔNG có `oldValueJson`/`newValueJson`/`metadataJson`/`ipAddress`/`userAgent`/`requestId`.

#### T-Q: Unit test empty result

- Filter không khớp bản ghi nào → `data=[]`, `meta.total=0`, KHÔNG có `message` (verify khác EX1 pattern của các feature `analytics.*`).

#### T-R: Unit test KHÔNG tự ghi audit log — **quan trọng, dễ sai theo thói quen**

- Gọi API thành công (mock/spy `AuditLogsService.logAction`) → verify **KHÔNG được gọi** ở bất kỳ đâu trong luồng xử lý.

#### T-S: Unit test authorization + controller

- 401 khi chưa đăng nhập.
- 403 `PERMISSION_DENIED` khi thiếu permission `audit.system.read`.
- Request hợp lệ → 200 đúng cấu trúc `{data, meta}`.
- Lỗi không lường trước → 500 `INTERNAL_ERROR`.

#### T-T: Unit test seed permission

- Tạo đúng `audit.system.read`, gán **CHỈ** `SYSTEM_ADMIN` (verify KHÔNG gán `MANAGER`/`BUSINESS_ADMIN`).

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic |
|---|---|
| AC-001 | T-H, T-I, T-J |
| AC-002 | T-H (phân trang + COUNT riêng) |
| AC-003 | T-I |
| AC-004 | T-B (guard), T-S |
| AC-005 | T-A, T-M |
| AC-006 | T-J, T-Q |
| AC-007 | T-K, T-R |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Vô tình gọi `AuditLogsService.logAction()` theo thói quen pattern từ feature `analytics.*` | Sinh vòng lặp ghi log vô nghĩa, đi ngược quyết định đã chốt (§0.10 spec.md) | Unit test T-R spy verify không gọi; code review checklist Phase 7 |
| `COUNT(*)` riêng cho `total` chậm nếu `audit_logs` rất lớn (bảng tăng vô hạn theo thời gian) | Vượt NFR-001 (<2s) khi dữ liệu lớn | Tận dụng index `ix_audit_logs_created`/theo filter; nếu cần tối ưu thêm sau này có thể dùng ước lượng `total` — ghi nhận là cải tiến tương lai, không block launch |
| Nhầm sửa `AuditLogsService` (service ghi) thay vì tạo service đọc riêng | Rủi ro phá vỡ hành vi ghi log của toàn hệ thống (mọi module khác đang phụ thuộc) | Quyết định kiến trúc rõ ràng: tạo `AuditLogQueryService`/`AuditLogQueryRepository` hoàn toàn tách biệt (Structure Decision) |
| Seed permission gán nhầm cho `MANAGER`/`BUSINESS_ADMIN` | Vi phạm quyết định phạm vi role đã chốt (§0.4 spec.md), lộ dữ liệu audit toàn hệ thống ngoài ý muốn | Unit test T-T verify rõ ràng chỉ `SYSTEM_ADMIN` |
| Không có `API_CONTRACT` baseline để đối chiếu | Rủi ro FE/BE hiểu khác nhau về response shape | Đề xuất bổ sung `API_CONTRACT` ở task riêng (CL-1 spec.md) |

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001, FR-002, FR-003 | T-H |
| FR-004 | T-B |
| FR-005, FR-006 | T-E |
| FR-007–FR-013 | T-F, T-G, T-H |
| FR-014 | T-I |
| FR-015 | T-J, T-Q |
| FR-016 | T-G |
| FR-017–FR-022 | T-A, T-E, T-F |
| FR-023, FR-024 | T-B |
| FR-025–FR-027 | T-J |
| FR-028 | T-K, T-R |
