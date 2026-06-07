# Research: Khởi tạo phòng ban mới (UC-AM-03)

**Feature**: ORG-DEPT-CREATE-001 | **Date**: 2026-06-08
**Spec**: spec/features/account/feat-create-department/spec.md
**Source**: UC-AM-03, UC-07 API Contract v1.0, Database v3.2 Compact

---

## 1. Codebase Analysis

### Existing patterns trong accounts module
- Module ccounts đã có entity DepartmentEntity, UserEntity, RoleEntity, PermissionEntity, UserRoleEntity, RolePermissionEntity, FaceProfileEntity.
- Controller pattern: UsersController dùng JwtAuthGuard + PermissionsGuard + RequirePermissions.
- Service pattern: UsersService inject repository, return DTO.
- DTO pattern: CreateUserDto dùng class-validator decorators (@IsString, @IsOptional, @MaxLength, etc.).
- Audit: AdministrationModule cung cấp audit logging.
- Response pattern: { success, message, data } — thống nhất toàn dự án.

### DepartmentEntity hiện tại
- Đã có đầy đủ columns: id, departmentCode, departmentName, parentDepartmentId, managerUserId, description, isActive, createdBy, updatedBy, createdAt, updatedAt, deletedAt.
- Relations: self-referencing parentDepartment / children.
- Chưa có unique constraints ở entity level (cần migration).
- Chưa có validators cho regex pattern của departmentCode.

### Guards
- JwtAuthGuard — check authentication.
- PermissionsGuard + RequirePermissions — check permission code.
- Cần permission department.create (chưa có seed data).

### Swagger docs
- Controller hiện tại dùng @ApiTags, @ApiOperation, @ApiBody, @ApiResponse.
- DTO dùng @ApiProperty.

---

## 2. Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| ORM | TypeORM (existing) | Khớp codebase, không introduce tech mới |
| Validation | class-validator + class-transformer | Khớp pattern DTO hiện tại |
| Auth guard | JwtAuthGuard + PermissionsGuard | Reuse guards có sẵn |
| Permission code | department.create | Theo API Contract UC-07 |
| Audit logging | AdministrationModule (audit_logs table) | Reuse existing module |
| Entity | DepartmentEntity (đã tồn tại) | Chỉ cần cập nhật constraints |
| API response | { success, message, data } | Convention chung |
| OpenAPI | @nestjs/swagger decorators | Khớp pattern UsersController |
| Soft delete | deletedAt column (existing) | Khớp DATA-01 constitution |
| Transaction | TypeORM QueryRunner / transactional | Đảm bảo rollback consistency |

---

## 3. Dependencies

- AdministrationModule — audit log service.
- uth module — JwtAuthGuard, PermissionsGuard.
- ccounts module — DepartmentEntity, UserEntity.

---

## 4. Risks

| Risk | Mitigation |
|---|---|
| Circular reference khi insert parent | Validate trước insert bằng recursive query hoặc CTE |
| Race condition duplicate code | App-level check + DB partial unique index |
| Soft-delete conflict unique | Partial unique index với WHERE deleted_at IS NULL |
| Depth exceed 5 levels | Tính depth chain trên app layer trước insert |

---

## 5. Reuse Opportunities

- UsersController pattern (guards, pipes, swagger) → copy cho DepartmentsController.
- CreateUserDto validation pattern → CreateDepartmentDto.
- UserResponseDto pattern → DepartmentResponseDto.
- UsersService.createUser pattern (audit, transaction) → DepartmentsService.createDepartment.
