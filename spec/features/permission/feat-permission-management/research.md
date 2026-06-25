## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-23 | Research decisions cho Permission Management feature | Toàn bộ file |

---

# Research: Permission Catalog & Role-Permission Assignment

**Feature**: spec/features/permission/feat-permission-management/spec.md
**Phase**: Phase 0 — Codebase Analysis & Technology Decisions

---

## 1. Codebase Analysis

### 1.1 Project Structure

- NestJS modular monolith tại /src
- Module ccounts đã có: 6 entities, 3 services, 3 controllers, custom validators
- Module dministration có: AuditLogEntity + AuditLogsService
- Common module: guards, filters, utils

### 1.2 Entities Available (không cần tạo mới)

- PermissionEntity (src/modules/accounts/entities/permission.entity.ts): permissionCode, permissionName, moduleCode, actionCode, description, isActive, createdAt, updatedAt
- RolePermissionEntity (src/modules/accounts/entities/role-permission.entity.ts): roleId, permissionId, grantedBy, grantedAt, relations
- RoleEntity (src/modules/accounts/entities/role.entity.ts): roleCode, roleName, isSystemRole, isActive
- UserEntity (src/modules/accounts/entities/user.entity.ts): chỉ dùng id cho FK
- AuditLogEntity (src/modules/administration/entities/audit-log.entity.ts): userId, actionType, entityType, entityId, oldValueJson, newValueJson, ipAddress, userAgent, requestId, severity, metadataJson

### 1.3 Existing Services

- AuditLogsService (src/modules/administration/services/audit-logs.service.ts): có các method logAction(), logEntityChange(), logSecurityEvent() — có thể inject vào service của accounts module
- DepartmentsService, UsersService, FaceProfileService: pattern tham khảo

### 1.4 Existing DTO Patterns

- DTO files tách riêng: create-xxx.dto.ts, xxx-response.dto.ts
- Sử dụng class-validator decorators: @IsString(), @IsOptional(), @MaxLength(), @IsUUID(), @IsArray(), @ArrayNotEmpty()
- Custom validators: đặt trong alidators/ folder, implement ValidatorConstraintInterface

### 1.5 Controller Patterns

- @Controller('departments') với path tự động prefix
- @UseGuards(JwtAuthGuard) trên class hoặc method
- @Get(), @Post(), @Patch(), @Delete(), @Param(), @Query(), @Body()

---

## 2. Technology Decisions

### Decision 1: Guard Strategy

**Decision**: Tạo PermissionsGuard dùng chung kiểm tra @RequirePermissions() decorator
**Rationale**: AGENTS.md yêu cầu RBAC với guard pattern. Dùng decorator cho phép kiểm tra permission theo tên linh hoạt hơn hard-code role check.
**Alternatives considered**:
- Inline check trong controller — rejected vì duplicate code
- RolesGuard dựa trên role name — rejected vì không granular

### Decision 2: Transaction Strategy

**Decision**: Dùng TypeORM QueryRunner + transaction cho bulk assign
**Rationale**: Cần atomic operation — nếu fatal thì rollback toàn bộ
**Implementation**: QueryRunner tạo connection riêng, queryRunner.connect() + startTransaction(), commit/rollback
**Note**: Transaction chỉ bao phủ DB operations; audit log ghi sau commit

### Decision 3: Audit Log Integration

**Decision**: Inject AuditLogsService từ administration module vào permission service
**Rationale**: Codebase đã có AuditLogsService với interface rõ ràng; không cần tạo service mới
**Implementation**: Import AdministrationModule (hoặc export AuditLogsService) vào AccountsModule

### Decision 4: Module Code Allowlist

**Decision**: Tạo constant array trong src/modules/accounts/constants/permission-module-allowlist.constant.ts
**Rationale**: Không cần DB table; dễ update; spec đã list 23 module codes
**Implementation**: Export array, dùng trong custom validator

### Decision 5: Permission Code Regex

**Decision**: ^[a-z0-9_]+(\.[a-z0-9_]+)+$
**Rationale**: Cho phép underscore, multiple segments, lowercase only
**Implementation**: @Matches() decorator trong DTO + custom validator

---

## 3. Dependencies

| Dependency | Purpose | Already exists? |
|---|---|---|
| @nestjs/typeorm | ORM integration | Yes |
| typeorm | QueryRunner, Repository | Yes |
| class-validator | DTO validation | Yes |
| class-transformer | DTO serialization | Yes |
| AdministrationModule | AuditLogsService | Yes |

**No new dependencies needed.**

---

## 4. Risks

| Risk | Rating | Decision |
|---|---|---|
| Circular import nếu AccountsModule import AdministrationModule | Medium | AdministrationModule export AuditLogsService, AccountsModule chỉ import module/service đó |
| AuditLogsService chưa public API (method signature chưa confirm) | Low | Đã đọc source — LogActionDto, LogEntityChangeDto, LogSecurityEventDto đều clear |
