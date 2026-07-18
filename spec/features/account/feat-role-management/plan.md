## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Tạo implementation plan cho Role Management (RolesService + RolesController) | Toàn bộ file |

---

# Implementation Plan: Role Management (RolesService + RolesController)

**Feature Directory**: spec/features/account/feat-role-management/
**Spec**: spec/features/account/feat-role-management/spec.md
**Input**: Feature specification from spec.md (32 FR, 16 ERR, 22 AC)
**Status**: Draft

---

## 1. Feature Summary

Tính năng Role Management thuộc module `accounts`, bổ sung phần còn thiếu trong RBAC: CRUD cho chính đối tượng `role` (bảng `roles` hiện chỉ có Entity, chưa có Service/Controller). Cho phép System Administrator:

1. **Role CRUD** — Tạo, xem danh sách (phân trang + filter isActive + search), xem chi tiết (kèm assignedUserCount), cập nhật (roleName/description/isActive), xóa mềm (soft-delete, có bảo vệ system role và role đang được dùng).

Feature dựa trên database v3.2 Compact hiện tại: chỉ sử dụng 3 bảng `roles`, `user_roles` (read-only), `audit_logs`. Không thêm bảng mới, không schema change. Copy nguyên cấu trúc file/pattern từ `PermissionsController`/`PermissionsService` (feature `feat-permission-management`) theo đúng yêu cầu người dùng.

**Không đụng tới**: `RolePermissionsController`/`RolePermissionsService` (mục #6 đầu bài) và `PUT /users/:userId/roles` (mục #7 đầu bài, UC-08) — cả hai giữ nguyên.

---

## 2. Technical Context

**Language/Version**: TypeScript (NestJS framework)
**Primary Dependencies**: @nestjs/core, @nestjs/common, @nestjs/typeorm, class-validator, class-transformer, typeorm, pg
**Storage**: PostgreSQL (database v3.2 Compact) — 3 bảng: roles (R/W), user_roles (read-only), audit_logs (write-only)
**Testing**: Jest (unit) — mirror `permissions.service.spec.ts` / `permissions.controller.spec.ts`
**Target Platform**: Node.js LTS (Linux/Windows server)
**Project Type**: Backend API service (NestJS modular monolith)
**Performance Goals**: CRUD < 2s response time
**Constraints**:
- Không thêm bảng/cột database mới
- Chỉ user có `account.role.*` tương ứng mới thao tác được
- JWT bắt buộc cho toàn bộ endpoint
- Audit log ghi vào `audit_logs` qua `AuditLogsService`
- roleCode/isSystemRole immutable sau khi tạo (không nằm trong UpdateRoleDto)
- Không tạo được role với isSystemRole=true qua API (luôn false)
**Scale/Scope**: 1 API module (accounts), 5 endpoint mới, không có UI

### Existing Patterns (từ codebase analysis — xem research.md)

- **Module structure**: `src/modules/accounts/` — đã có `accounts.module.ts`, `controllers/`, `services/`, `dto/`, `entities/`, `validators/`, `constants/`
- **Entity**: `RoleEntity` đã tồn tại (`src/modules/accounts/entities/role.entity.ts`); `UserRoleEntity` đã tồn tại (dùng read-only để check assignment)
- **AuditLogsService**: có sẵn tại `src/modules/administration/services/audit-logs.service.ts` — dùng `logAction()`
- **Guard**: `JwtAuthGuard` + `PermissionsGuard` (`src/modules/auth/guards/`) đã có, dùng lại nguyên trạng
- **Decorator**: `@RequirePermissions()`, `@CurrentUser()` (`src/modules/auth/decorators/`) đã có, dùng lại nguyên trạng
- **DTO pattern**: tách riêng create/update/response/query DTOs, class-validator decorators — mirror `create-permission.dto.ts`, `update-permission.dto.ts`, `permission-response.dto.ts`, `pagination-query.dto.ts`
- **Controller pattern**: `@Controller('roles')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)` ở class level, `@RequirePermissions()` ở method level — mirror `permissions.controller.ts`
- **Service pattern**: `@Injectable()`, `@InjectRepository()`, business logic + audit log trong service — mirror `permissions.service.ts`

---

## 3. Scope Confirmation

### 3.1 Trong scope

- Role CRUD: POST/GET/GET-by-ID/PATCH/DELETE `/roles` (5 endpoints)
- DTO validation: roleCode regex (uppercase snake), roleName length, immutable field rejection
- Authorization: JwtAuthGuard + `account.role.create/read/update/delete` theo từng action
- Business rules: unique roleCode, system role protection (không deactivate/xóa), block xóa role đang gán user active
- Audit log: ghi vào `audit_logs` dùng `AuditLogsService`
- 4 permission code mới: `account.role.create`, `account.role.read`, `account.role.update`, `account.role.delete` (định nghĩa yêu cầu seed, thực thi seed ngoài scope)

### 3.2 Ngoài scope (Out of Scope — không implement)

- Không tạo UI/giao diện
- Không thêm bảng database mới / migration constraint
- Không sửa `RolePermissionsController`/`RolePermissionsService`
- Không sửa `PUT /users/:userId/roles` (UC-08)
- Không cho tạo/promote role với isSystemRole=true qua API
- Không hard delete role (chỉ soft-delete)
- Không import/export/bulk-create role
- Không notification khi thay đổi role
- Không viết migration/seed script thật (chỉ liệt kê yêu cầu trong tasks.md)
- Không thống nhất lại toàn bộ permission naming convention (`accounts.*` vs `account.*`)

---

## 4. Data Model Impact

### 4.1 Database Impact

**Không thay đổi schema.** Chỉ sử dụng 3 bảng hiện có:

| Bảng | Tác động | Chi tiết |
|---|---|---|
| roles | Đọc/ghi (CRUD) | Không thêm cột mới |
| user_roles | Chỉ đọc | Check `is_active=true` theo `roleId` trước khi xóa; đếm assignedUserCount |
| audit_logs | Chỉ ghi (audit) | Dùng AuditLogsService, không raw insert |

### 4.2 Entity Usage

- **RoleEntity**: Đã tồn tại — fields: `id, roleCode, roleName, description, isSystemRole, isActive, createdAt, updatedAt`
- **UserRoleEntity**: Đã tồn tại — dùng field `roleId`, `isActive` để COUNT/EXISTS check
- **AuditLogEntity**: Đã tồn tại — fields: `userId, actionType, entityType, entityId, oldValueJson, newValueJson, ipAddress, userAgent, requestId, severity, metadataJson`

### 4.3 Không cần migration

Feature này không tạo migration mới. Tất cả entity đã có trong database. Việc thêm unique constraint DB-level cho `roleCode` (nếu team muốn) là cải tiến riêng, ngoài scope — hiện tại uniqueness chỉ enforce ở tầng application (giống `permissionCode`).

---

## 5. API / Contract Plan

5 endpoints mới, tất cả prefix `/api/v1`:

| Method | Path | Mô tả | Permission | Request Body | Response |
|---|---|---|---|---|---|
| POST | /api/v1/roles | Tạo role mới | account.role.create | CreateRoleDto | 201: RoleResponseDto |
| GET | /api/v1/roles | List phân trang, filter isActive, search | account.role.read | Query: page, limit, sortBy, sortOrder, isActive, search | 200: RoleResponseDto[] + meta |
| GET | /api/v1/roles/:id | Chi tiết role + assignedUserCount | account.role.read | — | 200: RoleDetailResponseDto |
| PATCH | /api/v1/roles/:id | Cập nhật role (roleName/description/isActive) | account.role.update | UpdateRoleDto | 200: RoleResponseDto |
| DELETE | /api/v1/roles/:id | Soft-delete role | account.role.delete | — | 200: success |

**Không đổi** (giữ nguyên, chỉ tham chiếu):

| Method | Path | Permission | Ghi chú |
|---|---|---|---|
| GET/POST/DELETE | /api/v1/roles/:roleId/permissions | admin.manage_permissions | RolePermissionsController hiện tại |
| PUT | /api/v1/users/:userId/roles | accounts.user.update_roles | users.controller.ts, UC-08 |

### Error Codes

| Mã lỗi | HTTP | Điều kiện |
|---|---|---|
| ROLE_CODE_DUPLICATE | 409 | roleCode đã tồn tại |
| ROLE_NOT_FOUND | 404 | roleId không tồn tại |
| ROLE_IN_USE | 409 | role đang gán active cho user, không xóa được |
| CANNOT_DELETE_SYSTEM_ROLE | 422 | xóa role có isSystemRole=true |
| CANNOT_MODIFY_SYSTEM_ROLE | 422 | PATCH isActive=false lên role có isSystemRole=true |
| INVALID_ROLE_CODE_FORMAT | 400 | roleCode sai regex |
| VALIDATION_ERROR | 400 | thiếu field, vượt length, hoặc gửi roleCode/isSystemRole trong PATCH |
| UNAUTHORIZED | 401 | không có JWT hoặc JWT hết hạn |
| FORBIDDEN | 403 | thiếu permission account.role.* tương ứng |

---

## 6. Authorization Plan

### 6.1 Authentication

- Tất cả 5 endpoint yêu cầu JWT token hợp lệ (JwtAuthGuard)
- user_id lấy từ JWT sub claim, dùng cho audit log userId

### 6.2 Authorization

- **READ endpoints** (GET /roles, GET /roles/:id): yêu cầu `account.role.read`
- **WRITE endpoints**: POST → `account.role.create`; PATCH → `account.role.update`; DELETE → `account.role.delete`
- **Guard strategy**: tái sử dụng `PermissionsGuard` + `@RequirePermissions()` hiện có (không tạo guard mới, khác với `feat-permission-management` vốn phải tạo guard từ đầu — ở đây guard đã tồn tại)

### 6.3 Protected Operations

- Tạo role: `account.role.create`
- Cập nhật role: `account.role.update` + chặn field immutable + chặn deactivate system role
- Xóa role: `account.role.delete` + chặn xóa system role + chặn xóa role đang dùng

---

## 7. Business Logic Plan

### 7.1 Role CRUD Logic

- **Create**: Validate unique roleCode + regex → save với `isActive=true`, `isSystemRole=false` (cứng, không đọc từ DTO)
- **Update**: Chỉ `roleName` + `description` + `isActive`; nếu body chứa `roleCode`/`isSystemRole` → 400 VALIDATION_ERROR; nếu `isActive=false` và `role.isSystemRole=true` → 422 CANNOT_MODIFY_SYSTEM_ROLE
- **Delete**: Theo đúng thứ tự — (1) tồn tại? không → 404; (2) isSystemRole=true? có → 422 CANNOT_DELETE_SYSTEM_ROLE; (3) còn user active gán? có → 409 ROLE_IN_USE; ngược lại → set isActive=false
- **List**: Pagination (default 20, max 100), filter isActive (exact), search roleCode/roleName (ILIKE)
- **Detail**: Find by UUID, 404 nếu không có; COUNT `user_roles` where `roleId=id AND isActive=true` → assignedUserCount

### 7.2 Audit Logic

- Dùng `AuditLogsService` (administration module) — module đã import sẵn trong `AccountsModule`, không cần thêm import
- Audit log ghi SAU KHI thao tác DB thành công
- CREATE_ROLE: newValueJson = { roleCode, roleName, isActive, isSystemRole }
- UPDATE_ROLE: oldValueJson/newValueJson = { roleName, description, isActive } trước/sau
- DELETE_ROLE: oldValueJson = { isActive: true } → newValueJson = { isActive: false }

---

## 8. Validation Plan

### 8.1 Input Validation (class-validator DTO)

**CreateRoleDto**:

| Field | Validator | Ghi chú |
|---|---|---|
| roleCode | @IsString(), @Matches(/^[A-Z][A-Z0-9_]{1,49}$/), @MaxLength(50) | Required |
| roleName | @IsString(), @MaxLength(100) | Required |
| description | @IsOptional(), @IsString() | Optional |

**UpdateRoleDto**:

| Field | Validator | Ghi chú |
|---|---|---|
| roleName | @IsOptional(), @IsString(), @MaxLength(100) | Optional |
| description | @IsOptional(), @IsString() | Optional |
| isActive | @IsOptional(), @IsBoolean() | Optional |

**ListRolesQueryDto** (kế thừa style `PaginationQueryDto` hiện có, đổi allowlist sortBy cho role):

| Field | Validator | Ghi chú |
|---|---|---|
| page | @Type(Number), @Min(1), @IsOptional() | Default 1 |
| limit | @Type(Number), @Min(1), @Max(100), @IsOptional() | Default 20 |
| sortBy | @IsOptional(), @IsIn(['createdAt','roleCode','roleName']) | Default createdAt |
| sortOrder | @IsOptional(), @IsIn(['asc','desc']) | Default desc |
| isActive | @IsOptional(), @Type(Boolean), @IsBoolean() | — |
| search | @IsOptional(), @IsString() | — |

### 8.2 Business Logic Validation

- Unique roleCode: query DB trước khi insert (mirror `PermissionsService.create`)
- roleCode/isSystemRole immutability: check thủ công trong controller (mirror `PermissionsController.update` chặn `permissionCode`) — vì `UpdateRoleDto` không khai báo 2 field này, dùng `(dto as any).roleCode`/`(dto as any).isSystemRole` để phát hiện client cố tình gửi thêm
- System role protection: check `role.isSystemRole === true` trước khi cho phép `isActive=false` (update) hoặc DELETE
- Role-in-use protection: `COUNT user_roles WHERE role_id = :id AND is_active = true` > 0 → chặn xóa

### 8.3 Pagination Validation

- page >= 1, limit 1-100
- sortBy allowlist riêng cho role: `createdAt, roleCode, roleName`
- sortOrder: asc | desc

---

## 9. Error Handling Plan

### 9.1 Error Response Format

```json
{
  "success": false,
  "message": "Thông báo lỗi bằng tiếng Việt",
  "error": {
    "code": "ROLE_CODE_DUPLICATE",
    "details": {}
  },
  "timestamp": "2026-07-18T10:00:00.000Z",
  "path": "/api/v1/roles"
}
```

### 9.2 Error Mapping

| Exception | HTTP | Error Code | Xử lý |
|---|---|---|---|
| ValidationPipe error | 400 | VALIDATION_ERROR | class-validator tự động |
| roleCode duplicate | 409 | ROLE_CODE_DUPLICATE | Service check → throw ConflictException |
| Invalid roleCode format | 400 | INVALID_ROLE_CODE_FORMAT | @Matches() trong DTO |
| roleCode/isSystemRole trong PATCH body | 400 | VALIDATION_ERROR | Controller check thủ công → throw BadRequestException |
| Role not found | 404 | ROLE_NOT_FOUND | findOne → throw NotFoundException |
| Delete system role | 422 | CANNOT_DELETE_SYSTEM_ROLE | Service check → throw UnprocessableEntityException |
| Deactivate system role | 422 | CANNOT_MODIFY_SYSTEM_ROLE | Service check → throw UnprocessableEntityException |
| Role in use (delete) | 409 | ROLE_IN_USE | Service check COUNT → throw ConflictException |
| Unauthorized | 401 | UNAUTHORIZED | JwtAuthGuard tự động |
| Forbidden | 403 | FORBIDDEN | PermissionsGuard tự động |
| DB error | 500 | INTERNAL_ERROR | Exception filter chung |

---

## 10. Testing Strategy

### 10.1 Unit Tests

| Component | Test coverage | File |
|---|---|---|
| CreateRoleDto / UpdateRoleDto | Validation rules (regex, required, maxLength) | dto/*.spec.ts |
| RolesService | Create/findAll/findOne/update/delete — success + tất cả error cases | services/roles.service.spec.ts |
| RolesController | HTTP codes, response format, guard integration | controllers/roles.controller.spec.ts |

### 10.2 Test Focus Areas (theo AC)

- AC-001 → AC-005: Happy paths (5 tests)
- AC-006 → AC-009: Validation errors (4 tests)
- AC-010 → AC-012: Auth errors (3 tests)
- AC-013 → AC-018: Business rules (6 tests)
- AC-019 → AC-020: State transitions (2 tests)
- AC-021 → AC-022: Audit logging (2 tests)

---

## 11. Implementation Phases

### Phase 1 — DTOs & Constants

**File cần tạo**:
- DTOs: `create-role.dto.ts`, `update-role.dto.ts`, `role-response.dto.ts`, `role-detail-response.dto.ts`, `list-roles-query.dto.ts`
- Constants (nếu tách riêng thay vì tái dùng `PERMISSION_SORT_FIELDS`): `role-sort-fields.constant.ts` (`ROLE_SORT_FIELDS = ['createdAt','roleCode','roleName']`)

### Phase 2 — RolesService

**File cần tạo**:
- `services/roles.service.ts` — inject `RoleEntity`, `UserRoleEntity` repositories + `AuditLogsService`
- Methods: `create`, `findAll`, `findOne` (kèm assignedUserCount), `update`, `remove` (soft-delete)

### Phase 3 — RolesController

**File cần tạo**:
- `controllers/roles.controller.ts` — 5 endpoints, guard + `@RequirePermissions()` theo §6

### Phase 4 — Module Registration

**File cần sửa**:
- `accounts.module.ts` — thêm `RolesController` vào `controllers`, `RolesService` vào `providers`. `RoleEntity`/`UserRoleEntity` đã có sẵn trong `TypeOrmModule.forFeature(...)`, không cần thêm.

### Phase 5 — Permission Seed Requirement (tài liệu, không code)

- Ghi nhận yêu cầu seed 4 permission mới (`account.role.create/read/update/delete`, moduleCode=`accounts`) vào bảng `permissions` — thực thi thuộc task seed riêng, ngoài scope code của feature này (xem tasks.md).

### Phase 6 — Testing

**File cần tạo**:
- `dto/create-role.dto.spec.ts`, `dto/update-role.dto.spec.ts`
- `services/roles.service.spec.ts`
- `controllers/roles.controller.spec.ts`

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Quên check isSystemRole trước khi deactivate/xóa | Có thể lockout admin | Kiểm tra tường minh trong service, unit test riêng cho cả 2 nhánh (deactivate vs delete) |
| Cho phép tạo role với isSystemRole=true qua API | Leo thang đặc quyền | CreateRoleDto không có field isSystemRole; service luôn hard-code `isSystemRole: false` khi insert |
| Xóa role đang được user dùng | Mất quyền truy cập đột ngột cho user đang có role đó | COUNT check user_roles active trước khi set isActive=false |
| roleCode allowlist casing không nhất quán (role hiện có dùng UPPER_SNAKE) | Dữ liệu roleCode lẫn lộn hoa/thường | Regex bắt buộc uppercase-only ở DTO |
| Permission `account.role.*` chưa được seed | Guard trả 403 cho mọi user kể cả admin thật | Ghi rõ precondition seed trong spec §1.4 và tasks.md; không thuộc code phase |
| Trùng logic với `PermissionsService` dẫn tới copy-paste lỗi (quên đổi entity/field) | Bug tinh vi khó phát hiện khi review | Review chéo với `permissions.service.ts` khi implement, đối chiếu từng method |

---

## 13. Acceptance Criteria Traceability

| Phase | AC ID | Scope | Test strategy |
|---|---|---|---|
| Phase 2+3 | AC-001 → AC-003 | Create/List/Detail happy path | Unit: service + controller |
| Phase 2+3 | AC-006 → AC-009 | Validation errors | Unit: DTO validation |
| Phase 2+3 | AC-004, AC-018, AC-019, AC-020 | Update + state transition | Unit: service |
| Phase 2+3 | AC-013 | Duplicate roleCode | Unit: service |
| Phase 2+3 | AC-008 | Update field immutable bị cấm | Unit: controller |
| Phase 2+3 | AC-005, AC-016, AC-017 | Delete + business rules | Unit: service |
| Phase 2+3 | AC-014, AC-015 | System role protection | Unit: service |
| Phase 2+3 | AC-010 → AC-012 | Auth errors | Controller + guard test |
| Phase 2 | AC-021, AC-022 | Audit logging | Unit: service spy on AuditLogsService |

---

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 2 mã lỗi 422 riêng biệt cho system role (CANNOT_DELETE_SYSTEM_ROLE vs CANNOT_MODIFY_SYSTEM_ROLE) | Client cần phân biệt ngữ cảnh PATCH vs DELETE để hiển thị thông báo đúng | Dùng chung 1 mã lỗi sẽ làm FE khó phân biệt hành động nào bị chặn |
| Kiểm tra thứ tự cố định 404 → 422 → 409 khi xóa (FR-032) | Đảm bảo hành vi nhất quán, dễ test, tránh lộ thông tin business rule trước khi xác nhận resource tồn tại | Kiểm tra song song/không thứ tự có thể trả sai mã lỗi tùy implementation, khó test ổn định |
