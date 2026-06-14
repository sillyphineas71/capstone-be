# Research: Xem chi tiết hồ sơ tài khoản

> Phase 0 output — Codebase analysis & technology decisions.

---

## Codebase Analysis

### Existing Patterns

| Pattern | Implementation | Reference |
|---|---|---|
| Controller auth | `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions(...)` | `users.controller.ts:40-41` |
| User extraction | `request['user']` with `{ userId, jti, exp }` | `jwt-auth.guard.ts:73-78` |
| Response format | `{ success, message, data }` | `users.controller.ts:85-91` |
| Error format | `{ success, message, error: { code, details }, timestamp, path }` | `permissions.guard.ts:33-39` |
| Audit log | `AuditLogEntity` via AdministrationModule | `users.service.ts:250-277` |
| Transaction | `this.dataSource.transaction(async (em) => { ... })` | `users.service.ts:63` |
| Read-only query | `em.findOne()` or `em.find()` with relations/joins | `users.service.ts:65-68` |
| Soft-delete check | `deletedAt: IsNull()` in WHERE | `users.service.ts:66` |

### Entity Relationships

```
users.department_id → departments.id
users.direct_manager_id → users.id (self-referencing)
user_roles.user_id → users.id
user_roles.role_id → roles.id
face_profiles.user_id → users.id
departments.parent_department_id → departments.id (tree)
```

### Available Reuse

- `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions` — full reuse
- `AuditLogEntity` + `AdministrationModule` — full reuse (accounts module already imports it)
- `UserRoleEntity`, `RoleEntity`, `FaceProfileEntity`, `DepartmentEntity` — full reuse via `AccountsModule`
- `UserEntity` with `deletedAt` soft-delete — full reuse
- `QueryFailedFilter` — not needed for read-only feature

### What Must Be Created

1. **New DTO**: `UserDetailResponseDto` với đầy đủ các field theo FR-002
2. **New service method**: `getUserDetail(userId, currentUserId)` trong `UsersService`
3. **New controller method**: `getUserDetail(@Param('userId'), @Req() request)` trong `UsersController`
4. **Department scope resolver**: Logic resolve department scope cho Business Admin (self + children)
5. **Audit log write**: Ghi audit log khi view detail thành công
6. **Validation**: Pipe validate UUID params (built-in NestJS)

### Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| UUID validation | Built-in NestJS `ParseUUIDPipe` | Không cần custom validator |
| Department scope resolution | Runtime query using `Repository<DepartmentEntity>` with recursive CTE or loop | Not frequent enough to warrant caching |
| Face profile check | `findOne` on `FaceProfileEntity` with `where: { userId }` | Simple existence check |
| Response DTO | Custom `UserDetailResponseDto` class | Separate from `UserResponseDto` (different fields) |
| Permission check | Existing `PermissionsGuard` | Reuse pattern |
| Audit logging | Non-blocking inside service method | Same pattern as existing code |

### Risks

| Risk | Mitigation |
|---|---|
| N+1 queries for roles + department + manager + face profile | Use single query with relations via TypeORM `FindOptionsRelations` |
| Department scope resolution complexity | Limit depth to 5 levels max (already enforced in dept service) |
| Audit log failure blocks response | Non-blocking try/catch (existing pattern) |
| Direct manager self-reference loop | Query joins handle it naturally; return id + fullName only |

---

## Constitution Check

- **Gate status**: PASS — feature không vi phạm bất kỳ principle nào
- **DB Gate**: Không thêm bảng/field mới
- **Security Gate**: Không expose password hash hay sensitive data
- **Scope Gate**: Chỉ làm đúng use case UC-AM-10
- **Module Gate**: Thuộc AccountsModule, dùng AdministrationModule cho audit log
- **Auth Gate**: Dùng JwtAuthGuard + PermissionsGuard
- **API Gate**: Format response tuân thủ AGENTS.md
- **Test Gate**: Unit test cho service method, controller cần test integration
