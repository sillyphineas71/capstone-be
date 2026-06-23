## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-23 | Sửa lỗi mất ký tự đầu (H1) hàng loạt | Toàn bộ file |
| 2026-06-23 | Tạo implementation plan cho Permission Catalog & Role-Permission Assignment | Toàn bộ file |

---

# Implementation Plan: Permission Catalog & Role-Permission Assignment

**Feature Directory**: spec/features/permission/feat-permission-management/
**Spec**: spec/features/permission/feat-permission-management/spec.md
**Input**: Feature specification from spec.md (39 FR, 19 ERR, 25 AC)
**Status**: Draft

---

## 1. Feature Summary

Tính năng Quản lý Quyền (Permission Catalog) và Gán Quyền cho Vai trò (Role-Permission Assignment) thuộc module accounts. Cho phép System Administrator:

1. **Permission CRUD** — Quản lý vòng đời permission: tạo, xem, cập nhật (chỉ tên/mô tả), toggle-active, liệt kê (phân trang + filter moduleCode + search)
2. **Role-Permission Assignment** — Gán/gỡ permission cho role, ghi vết granted_by/granted_at, bulk assign với transaction, fatal/non-fatal semantics

Feature dựa trên database v3.2 Compact hiện tại: chỉ sử dụng 4 bảng permissions, role_permissions, roles, audit_logs. Không thêm bảng mới, không schema change.

---

## 2. Technical Context

**Language/Version**: TypeScript (NestJS framework)
**Primary Dependencies**: @nestjs/core, @nestjs/common, @nestjs/typeorm, class-validator, class-transformer, typeorm, pg
**Storage**: PostgreSQL (database v3.2 Compact) — 4 tables: permissions, role_permissions, roles, audit_logs
**Testing**: Jest + supertest (e2e)
**Target Platform**: Node.js LTS (Linux/Windows server)
**Project Type**: Backend API service (NestJS modular monolith)
**Performance Goals**: CRUD < 2s response time; bulk assign (≤50 permissions) < 5s
**Constraints**: 
- No new database tables or columns
- Only admin.manage_permissions permission can write
- JWT required for all endpoints
- Transaction required for bulk assign
- Audit logs go to audit_logs table via AuditLogsService
**Scale/Scope**: 1 API module (accounts), ~8 endpoints, no UI

### Existing Patterns (từ codebase analysis)

- **Module structure**: src/modules/accounts/ — có sẵn accounts.module.ts, controllers/, services/, dto/, entities/, validators/
- **Entity**: PermissionEntity, RolePermissionEntity, RoleEntity, UserEntity đã tồn tại
- **AuditLogsService**: Có sẵn tại src/modules/administration/services/audit-logs.service.ts — hỗ trợ logAction(), logEntityChange(), logSecurityEvent()
- **Common guards**: Chưa thấy JwtAuthGuard, PermissionsGuard trong common (cần kiểm tra hoặc tạo mới)
- **DTO pattern**: class-validator decorators; tách riêng create/update/response DTOs
- **Validator pattern**: Có custom validators tại src/modules/accounts/validators/ (ví dụ: IsDepartmentCodeUniqueValidator)
- **Controller pattern**: Decorators @Controller, @UseGuards, @Get, @Post, @Body, @Query, @Param
- **Service pattern**: @Injectable(), InjectRepository, business logic trong service layer

---

## 3. Scope Confirmation

### 3.1 Trong scope

- Permission CRUD: POST/GET/GET-by-ID/PATCH/toggle-active permissions (Feature 1)
- Role-Permission Assignment: GET/POST/DELETE role's permissions (Feature 2)
- DTO validation: permissionCode regex, moduleCode allowlist, field length limits
- Authorization: JwtAuthGuard + admin.manage_permissions check
- Transaction: bulk assign (fatal → rollback, non-fatal → skip)
- Audit log: ghi vào bảng audit_logs dùng AuditLogsService
- PermissionCode format: regex ^[a-z0-9_]+(\.[a-z0-9_]+)+$
- moduleCode allowlist: 23 module codes

### 3.2 Ngoài scope (Out of Scope — không implement)

- Không tạo UI/giao diện
- Không thêm bảng database mới
- Không Role CRUD (chỉ gán/gỡ permission cho role đã tồn tại)
- Không PermissionGuard cho module khác
- Không bootstrap seed RBAC (seed là task riêng, precondition)
- Không hard delete permission (chỉ toggle-active)
- Không import/export/bulk-update permission
- Không notification khi thay đổi permission

---

## 4. Data Model Impact

### 4.1 Database Impact

**Không thay đổi schema.** Chỉ sử dụng 4 bảng hiện có:

| Bảng | Tác động | Chi tiết |
|---|---|---|
| permissions | Chỉ đọc/ghi (CRUD) | Không thêm cột mới |
| role_permissions | Chỉ đọc/ghi (assign/revoke) | Không thêm cột mới |
| roles | Chỉ đọc (FK check, is_system_role check) | Không thay đổi |
| audit_logs | Chỉ ghi (audit) | Dùng AuditLogsService, không raw insert |

### 4.2 Entity Usage

- **PermissionEntity**: Đã tồn tại — fields: id, permissionCode, permissionName, moduleCode, actionCode, description, isActive, createdAt, updatedAt
- **RolePermissionEntity**: Đã tồn tại — fields: id, roleId, permissionId, grantedBy, grantedAt, relations với Role/Permission/User
- **RoleEntity**: Đã tồn tại — fields: id, roleCode, roleName, description, isSystemRole, isActive, createdAt, updatedAt
- **UserEntity**: Đã tồn tại — chỉ dùng id cho FK reference (grantedBy)
- **AuditLogEntity**: Đã tồn tại — fields: userId, actionType, entityType, entityId, oldValueJson, newValueJson, ipAddress, userAgent, requestId, severity, metadataJson

### 4.3 Không cần migration

Feature này không tạo migration mới. Tất cả entity đã có trong database.

---

## 5. API / Contract Plan

8 endpoints, tất cả prefix /api/v1:

### Feature 1 — Permission CRUD

| Method | Path | Mô tả | Request Body | Response |
|---|---|---|---|---|
| GET | /api/v1/permissions | List phân trang, filter moduleCode, search code/name | Query: page, limit, moduleCode, search | 200: PermissionResponseDto[] + meta |
| GET | /api/v1/permissions/:id | Chi tiết permission | — | 200: PermissionResponseDto |
| POST | /api/v1/permissions | Tạo permission mới | CreatePermissionDto | 201: PermissionResponseDto |
| PATCH | /api/v1/permissions/:id | Cập nhật permission (chỉ tên/mô tả) | UpdatePermissionDto | 200: PermissionResponseDto |
| POST | /api/v1/permissions/:id/toggle-active | Kích hoạt/vô hiệu hóa | — | 200: { isActive } |

### Feature 2 — Role-Permission Assignment

| Method | Path | Mô tả | Request Body | Response |
|---|---|---|---|---|
| GET | /api/v1/roles/:roleId/permissions | Danh sách permission của role | — | 200: RolePermissionResponseDto[] |
| POST | /api/v1/roles/:roleId/permissions | Gán permission hàng loạt | AssignPermissionsDto | 201: { assigned[], skippedAlreadyAssigned[], skippedDuplicatedInRequest[] } hoặc 200 nếu no-op |
| DELETE | /api/v1/roles/:roleId/permissions/:permissionId | Gỡ permission khỏi role | — | 200: success |

### Error Codes

| Mã lỗi | HTTP | Điều kiện |
|---|---|---|
| PERMISSION_CODE_DUPLICATE | 409 | permissionCode đã tồn tại |
| PERMISSION_NOT_FOUND | 404 | permissionId không tồn tại |
| ROLE_NOT_FOUND | 404 | roleId không tồn tại |
| PERMISSION_INACTIVE | 422 | permission isActive = false |
| PERMISSION_NOT_ASSIGNED | 404 | permission chưa gán cho role |
| CANNOT_REVOKE_SYSTEM_PERMISSION | 422 | gỡ admin permission khỏi system role |
| INVALID_PERMISSION_CODE_FORMAT | 400 | permissionCode sai regex |
| INVALID_MODULE_CODE | 400 | moduleCode không trong allowlist |
| VALIDATION_ERROR | 400 | missing fields, length exceeded |
| UNAUTHORIZED | 401 | không có JWT hoặc JWT hết hạn |
| FORBIDDEN | 403 | không có admin.manage_permissions |

---

## 6. Authorization Plan

### 6.1 Authentication

- Tất cả 8 endpoints yêu cầu JWT token hợp lệ (JwtAuthGuard)
- user_id lấy từ JWT sub claim, dùng cho granted_by và audit log userId

### 6.2 Authorization

- **READ endpoints** (GET /api/v1/permissions, GET /api/v1/permissions/:id, GET /api/v1/roles/:roleId/permissions): yêu cầu admin.manage_permissions hoặc permission.read
- **WRITE endpoints** (POST/PATCH/DELETE, toggle-active): yêu cầu admin.manage_permissions
- **Guard strategy**: Tạo PermissionsGuard kiểm tra eq.user.permissions hoặc dùng @RequirePermissions('admin.manage_permissions') decorator

### 6.3 Protected Operations

- Tạo permission: admin.manage_permissions
- Cập nhật permission: admin.manage_permissions
- Toggle-active: admin.manage_permissions
- Gán permission cho role: admin.manage_permissions + auto-deduct grantedBy từ JWT
- Gỡ permission khỏi role: admin.manage_permissions + check system role protection

---

## 7. Business Logic Plan

### 7.1 Permission CRUD Logic

- **Create**: Validate unique permissionCode + regex + moduleCode allowlist → save with isActive=true
- **Update**: Only permissionName + description allowed; permissionCode/moduleCode/actionCode NOT updatable
- **Toggle-active**: Flip isActive; if currently active → false, if inactive → true
- **List**: Pagination (default 20, max 100), optional filter by moduleCode, optional search by permissionCode/permissionName (ILIKE)
- **Detail**: Find by UUID, 404 if not found

### 7.2 Role-Permission Assignment Logic

- **Bulk assign với transaction**:
  - Phase 1 (validation before any write):
    - Check roleId exists → fatal (404 ROLE_NOT_FOUND)
    - Check all permissionIds exist and isActive=true → fatal (404 PERMISSION_NOT_FOUND / 422 PERMISSION_INACTIVE)
  - Phase 2 (process — trong transaction):
    - Filter out already assigned (skip non-fatal → skippedAlreadyAssigned)
    - Filter out duplicates in request body (skip non-fatal → skippedDuplicatedInRequest)
    - Insert new role_permission records with grantedBy from JWT, grantedAt = now()
    - Commit transaction
    - Ghi audit log tổng hợp
    - Return { assigned, skippedAlreadyAssigned, skippedDuplicatedInRequest }
  - Nếu tất cả đều skip → 200 success no-op, không insert any
- **Revoke single**:
  - Check roleId exists
  - Check role_permission exists → 404 PERMISSION_NOT_ASSIGNED
  - Check system role protection: if role.isSystemRole && permission.moduleCode === 'admin' → 422 CANNOT_REVOKE_SYSTEM_PERMISSION
  - Delete record
  - Ghi audit log

### 7.3 Audit Logic

- Dùng AuditLogsService (administration module) — inject qua module import
- Audit log ghi SAU KHI transaction thành công
- Bulk assign: ghi 1 record tổng hợp với metadataJson chứa assigned/skippedAlreadyAssigned/skippedDuplicatedInRequest
- Revoke: ghi 1 record riêng
- CRUD: ghi mỗi thao tác thành công

---

## 8. Validation Plan

### 8.1 Input Validation (class-validator DTO)

**CreatePermissionDto**:

| Field | Validator | Ghi chú |
|---|---|---|
| permissionCode | @IsString(), @Matches(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/) | Required, max 120 |
| permissionName | @IsString(), @MaxLength(150) | Required |
| moduleCode | @IsString(), @MaxLength(80), @IsIn(allowlist) | Required |
| actionCode | @IsString(), @MaxLength(80) | Required |
| description | @IsOptional(), @IsString() | Optional |

**UpdatePermissionDto**:

| Field | Validator | Ghi chú |
|---|---|---|
| permissionName | @IsOptional(), @IsString(), @MaxLength(150) | Optional |
| description | @IsOptional(), @IsString() | Optional |

**AssignPermissionsDto**:

| Field | Validator | Ghi chú |
|---|---|---|
| permissionIds | @IsArray(), @ArrayNotEmpty(), @IsUUID('4', { each: true }) | Required, min 1 |

### 8.2 Business Logic Validation

- Unique permissionCode: query DB trước khi insert
- moduleCode allowlist: constant array, validate trong service hoặc custom validator
- permissionCode immutability: check trong update — reject nếu body chứa permissionCode
- isSystemRole protection: check role.permission.moduleCode === 'admin' trước khi revoke

### 8.3 Pagination Validation

- page >= 1, limit between 1-100
- sortBy allowlist (mặc định: createdAt, permissionCode, permissionName, moduleCode)
- sortOrder: asc | desc

---

## 9. Error Handling Plan

### 9.1 Error Response Format

`json
{
  "success": false,
  "message": "Thông báo lỗi bằng tiếng Việt",
  "error": {
    "code": "PERMISSION_CODE_DUPLICATE",
    "details": {}
  },
  "timestamp": "2026-06-23T10:00:00.000Z",
  "path": "/api/v1/permissions"
}
`

### 9.2 Error Mapping

| Exception | HTTP | Error Code | Xử lý |
|---|---|---|---|
| ValidationPipe error | 400 | VALIDATION_ERROR | class-validator tự động |
| PermissionCode duplicate | 409 | PERMISSION_CODE_DUPLICATE | Service check → throw |
| Invalid permissionCode format | 400 | INVALID_PERMISSION_CODE_FORMAT | custom validator |
| Invalid moduleCode | 400 | INVALID_MODULE_CODE | custom validator |
| Permission not found | 404 | PERMISSION_NOT_FOUND | findOneOrFail → filter |
| Role not found | 404 | ROLE_NOT_FOUND | findOneOrFail → filter |
| Permission not assigned | 404 | PERMISSION_NOT_ASSIGNED | Service check → throw |
| Permission inactive | 422 | PERMISSION_INACTIVE | Service check → throw |
| System role revoke | 422 | CANNOT_REVOKE_SYSTEM_PERMISSION | Service check → throw |
| Unauthorized | 401 | UNAUTHORIZED | JwtAuthGuard tự động |
| Forbidden | 403 | FORBIDDEN | PermissionsGuard tự động |
| DB error | 500 | INTERNAL_ERROR | Exception filter chung |

### 9.3 Transaction Boundary

Bulk assign (POST /api/v1/roles/:roleId/permissions):
- Mở TypeORM transaction trước phase 1 validation
- Phase 1: validate (checkpoint trước khi write)
- Nếu fatal error → rollback, trả lỗi ngay
- Nếu pass → phase 2 (insert trong transaction)
- Nếu DB error → rollback
- Sau commit → ghi audit log (ngoài transaction)

---

## 10. Testing Strategy

### 10.1 Unit Tests

| Component | Test coverage | File |
|---|---|---|
| Permission DTOs | Validation rules (regex, required, maxLength, allowlist) | dto/*.spec.ts |
| AssignPermissionsDto | ArrayNotEmpty, IsUUID | dto/*.spec.ts |
| PermissionService | Create/update/toggle/list/detail — success + all error cases | services/permissions.service.spec.ts |
| RolePermissionService | Assign (fatal/non-fatal), revoke (system role check), list | services/role-permission.service.spec.ts |
| Controller | HTTP codes, response format, guard integration | controllers/permissions.controller.spec.ts |

### 10.2 Integration / E2E Tests (nếu có yêu cầu)

- Full flow: create permission → assign to role → list → revoke → toggle
- Duplicate code → 409
- Invalid permissionCode → 400
- Inactive permission assign → 422 rollback
- System role revoke admin permission → 422
- Non-admin user write → 403
- Unauthenticated request → 401

### 10.3 Test Focus Areas (theo AC)

- AC-001 → AC-008: Happy paths (8 tests)
- AC-009 → AC-012: Validation errors (4 tests)
- AC-013 → AC-015: Auth errors (3 tests)
- AC-016 → AC-021: Business rules (6 tests)
- AC-022 → AC-023: State transitions (2 tests)
- AC-024 → AC-025: Audit logging (2 tests)

---

## 11. Implementation Phases

### Phase 1 — Setup & Infrastructure (nền tảng)

Tạo các file cấu trúc, DTOs, custom validators, guards.

**Các file cần tạo**:
- DTOs: create-permission.dto.ts, update-permission.dto.ts, assign-permissions.dto.ts, permission-response.dto.ts, role-permission-response.dto.ts
- Validators: is-module-code-valid.validator.ts (allowlist check), is-permission-code-format.validator.ts (regex)
- Guard: permissions.guard.ts (kiểm tra admin.manage_permissions)
- Decorator: @RequirePermissions(), @CurrentUser()
- Constants: permission-module-allowlist.constant.ts, permission-sort-fields.constant.ts

### Phase 2 — Permission CRUD Service & Controller (Feature 1)

Service methods cho Permission CRUD + controller endpoints.

**File cần tạo**:
- Service: permissions.service.ts (create, update, toggleActive, findAll, findOne)
- Controller: permissions.controller.ts (5 endpoints)
- Module update: accounts.module.ts (register service, controller)

### Phase 3 — Role-Permission Assignment (Feature 2)

Service methods cho role-permission + controller endpoints.

**File cần tạo**:
- Service: role-permissions.service.ts (assign, revoke, findByRole)
- Controller: role-permissions.controller.ts (3 endpoints)
- Module update: accounts.module.ts (register)

### Phase 4 — Audit Integration

Tích hợp AuditLogsService vào các service methods.

**File cần sửa**:
- permissions.service.ts — thêm audit log sau mỗi thao tác ghi
- role-permissions.service.ts — thêm audit log cho assign/revoke

### Phase 5 — Testing

Unit tests cho DTOs, services, controllers.

**File cần tạo**:
- dto/*.spec.ts (5 files)
- services/permissions.service.spec.ts
- services/role-permissions.service.spec.ts
- controllers/permissions.controller.spec.ts

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Quên check is_system_role trước revoke | Có thể lockout admin | Kiểm tra trong service, unit test cho edge case |
| Transaction không rollback đúng khi bulk assign có fatal error | Dữ liệu không nhất quán | TypeORM QueryRunner + try/catch rollback |
| Audit log ghi trước khi transaction commit | Audit log sai nếu rollback | Audit log chỉ ghi sau khi transaction commit thành công |
| moduleCode allowlist outdated khi thêm module mới | Không tạo được permission cho module mới | Allowlist trong constant, dễ update, không cần DB change |
| Performance khi assign 50+ permissions | Timeout transaction | Limit 50 permissions mỗi request, transaction timeout config |
| Conflict khi xóa permission đang được gán cho role | FK CASCADE xóa luôn role_permissions | ON DELETE CASCADE đã có trong entity, design intent |

---

## 13. Acceptance Criteria Traceability

| Phase | AC ID | Scope | Test strategy |
|---|---|---|---|
| Phase 2 | AC-001 → AC-005 | Permission CRUD happy path | Unit: service + controller |
| Phase 2 | AC-009 → AC-012 | Validation errors | Unit: DTO validation |
| Phase 2 | AC-016 | Duplicate code | Unit: service |
| Phase 2 | AC-020 | Update code bị cấm | Unit: service |
| Phase 2 | AC-022 → AC-023 | Toggle state transition | Unit: service |
| Phase 3 | AC-006 → AC-008 | Assign/list/revoke happy path | Unit: service + controller |
| Phase 3 | AC-017 | Inactive assign fatal | Unit: service (transaction test) |
| Phase 3 | AC-018 → AC-019 | System role protection | Unit: service |
| Phase 3 | AC-021 | Non-fatal skip | Unit: service |
| Phase 4 | AC-024 → AC-025 | Audit logging | Unit: service spy on AuditLogsService |
| Phase 3 | AC-013 → AC-015 | Auth errors | Controller + guard test |

---

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Custom PermissionsGuard | Cần kiểm tra admin.manage_permissions trước mọi write endpoint | Dùng inline check trong controller sẽ duplicate code và khó maintain |
| Transaction trong bulk assign | Yêu cầu atomic: gán nhiều permission phải all-or-nothing | Không dùng transaction → dữ liệu không nhất quán nếu fail giữa chừng |
