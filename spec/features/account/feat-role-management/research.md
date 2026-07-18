## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Research decisions cho Role Management feature | Toàn bộ file |

---

# Research: Role Management (RolesService + RolesController)

**Feature**: spec/features/account/feat-role-management/spec.md
**Phase**: Phase 0 — Codebase Analysis & Technology Decisions

---

## 1. Codebase Analysis

### 1.1 Project Structure

- NestJS modular monolith tại `/src`
- Module `accounts` đã có: 7 entities (bao gồm `RoleEntity`, `UserRoleEntity`), 3 services CRUD-style (Departments/Permissions/RolePermissions), nhiều controller
- Module `administration` có: `AuditLogEntity` + `AuditLogsService`
- Module `auth` có: `JwtAuthGuard`, `PermissionsGuard`, `@RequirePermissions`, `@CurrentUser` — dùng lại nguyên trạng, không cần tạo mới (khác `feat-permission-management` vốn phải tạo các thành phần này lần đầu)

### 1.2 Entities Available (không cần tạo mới)

- `RoleEntity` ([role.entity.ts](../../../../src/modules/accounts/entities/role.entity.ts)): `roleCode(50), roleName(100), description, isSystemRole(default false), isActive(default true), createdAt, updatedAt`
- `UserRoleEntity` ([user-role.entity.ts](../../../../src/modules/accounts/entities/user-role.entity.ts)): `userId, roleId, assignedBy, assignedAt, expiredAt, isActive(default true), metadataJson`
- `AuditLogEntity` ([audit-log.entity.ts](../../../../src/modules/administration/entities/audit-log.entity.ts)): `userId, actionType, entityType, entityId, oldValueJson, newValueJson, ipAddress, userAgent, requestId, severity, metadataJson`

### 1.3 Existing Services — pattern để copy

- `PermissionsService` ([permissions.service.ts](../../../../src/modules/accounts/services/permissions.service.ts)): pattern chuẩn nhất để copy — `create/findAll/findOne/update/toggleActive`, dùng `@InjectRepository`, throw `ConflictException`/`NotFoundException` với payload `{ success, message, error: { code } }`, gọi `auditLogsService.logAction(...)` sau mỗi thao tác ghi
- `DepartmentsService` ([departments.service.ts](../../../../src/modules/accounts/services/departments.service.ts)): pattern dùng `DataSource.transaction` — không bắt buộc cho Role CRUD vì không có multi-table write phức tạp như department (parent depth check), nhưng có thể tham khảo cho phần audit-log-trong-transaction nếu cần

### 1.4 Existing DTO Patterns

- DTO tách riêng: `create-xxx.dto.ts`, `update-xxx.dto.ts`, `xxx-response.dto.ts`, `pagination-query.dto.ts`
- class-validator decorators: `@IsString()`, `@IsOptional()`, `@MaxLength()`, `@Matches()`, `@IsIn()`, `@Type()`
- `create-permission.dto.ts` dùng `@Transform` để trim/lowercase input trước validate — Role sẽ dùng `@Transform` để trim/uppercase `roleCode`

### 1.5 Controller Patterns

- `@Controller('roles')` — path đã match sẵn base cho feature này (không trùng với `RolePermissionsController` vốn dùng `@Controller('roles/:roleId/permissions')`, NestJS route theo path cụ thể trước path có param nên không xung đột)
- `@UseGuards(JwtAuthGuard, PermissionsGuard)` ở class level
- `@RequirePermissions('account.role.xxx')` ở method level
- `@CurrentUser()` lấy `{ userId }` từ JWT — check `if (!userId) throw BadRequestException(...)` mirror `PermissionsController`

### 1.6 Route ordering note

`RolesController` dùng `@Controller('roles')` với các route `GET /roles`, `GET /roles/:id`, `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id`. `RolePermissionsController` dùng `@Controller('roles/:roleId/permissions')`. Hai controller không đụng route (`/roles/:id` khác `/roles/:roleId/permissions`), NestJS resolve bình thường theo path segment — không cần đặc biệt lưu ý thứ tự đăng ký như case `':userId/status'` trước `':userId'` trong `UsersController`.

---

## 2. Technology Decisions

### Decision 1: Guard/Decorator — tái sử dụng, không tạo mới

**Decision**: Dùng lại `JwtAuthGuard`, `PermissionsGuard`, `@RequirePermissions`, `@CurrentUser` hiện có trong `src/modules/auth`.
**Rationale**: Các thành phần này đã được tạo và kiểm chứng khi implement `feat-permission-management`; không có lý do tạo bản sao riêng cho Role.
**Alternatives considered**: Tạo RolesGuard riêng — rejected, không cần thiết, PermissionsGuard đã generic theo `@RequirePermissions(...codes)`.

### Decision 2: Không dùng transaction cho Role CRUD

**Decision**: Không bọc `create`/`update`/`delete` role trong `DataSource.transaction` (khác `DepartmentsService`).
**Rationale**: Mỗi thao tác Role CRUD chỉ ghi 1 bảng (`roles`), không có multi-step write như department (tính depth cây) hay bulk-assign permission. Audit log ghi sau khi save thành công, tương tự pattern đơn giản của `PermissionsService` (không transaction).
**Note**: Việc COUNT `user_roles` trước khi DELETE là read-only, không cần transaction để đảm bảo atomicity với write tiếp theo trong phạm vi rủi ro chấp nhận được của feature này (tương tự permission's revoke không dùng transaction).

### Decision 3: roleCode format — UPPER_SNAKE_CASE

**Decision**: Regex `^[A-Z][A-Z0-9_]{1,49}$`.
**Rationale**: Dữ liệu role hiện có trong dự án (`SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`, `EMPLOYEE` — theo `feat-update-account-role-permission/spec.md §5.2`) đều là uppercase snake_case, khác hẳn `permissionCode` (lowercase dot-separated). Giữ nhất quán với dữ liệu thật thay vì copy y nguyên format của permission.
**Alternatives considered**: Copy y nguyên regex permissionCode (lowercase dot) — rejected vì không khớp dữ liệu role thật đang tồn tại trong hệ thống.

### Decision 4: isSystemRole immutable, không expose trong DTO

**Decision**: `CreateRoleDto` không có field `isSystemRole`; `UpdateRoleDto` cũng không có. Service luôn set `isSystemRole: false` khi tạo.
**Rationale**: Tránh leo thang đặc quyền — nếu để field này editable qua API dù chỉ set được `true→true`, một actor có `account.role.create`/`account.role.update` có thể tạo/biến một role thành system role rồi lợi dụng cơ chế bảo vệ system role để tự bảo vệ role đó khỏi bị xóa/sửa bởi admin khác.
**Alternatives considered**: Cho phép set `isSystemRole` chỉ khi actor có thêm permission đặc biệt — rejected vì phức tạp hóa scope, không có yêu cầu rõ ràng từ đầu bài; để ngoài scope, xử lý qua migration/seed khi cần.

### Decision 5: Audit Log Integration — tái sử dụng AuditLogsService

**Decision**: Inject `AuditLogsService` (đã import sẵn qua `AdministrationModule` trong `AccountsModule`) vào `RolesService`.
**Rationale**: Module wiring đã có sẵn (từ khi implement `feat-permission-management`), không cần sửa `accounts.module.ts` phần import module, chỉ cần thêm `RolesService`/`RolesController` vào `providers`/`controllers`.

---

## 3. Dependencies

| Dependency | Purpose | Already exists? |
|---|---|---|
| @nestjs/typeorm | ORM integration | Yes |
| typeorm | Repository, ILike | Yes |
| class-validator | DTO validation | Yes |
| class-transformer | DTO serialization (@Type, @Transform) | Yes |
| AdministrationModule | AuditLogsService | Yes (đã import trong AccountsModule) |
| AuthModule | JwtAuthGuard, PermissionsGuard, decorators | Yes (đã import trong AccountsModule) |

**Không cần dependency mới.**

---

## 4. Risks

| Risk | Rating | Decision |
|---|---|---|
| Permission `account.role.*` chưa tồn tại trong DB khi feature được deploy | Medium | Ghi rõ yêu cầu seed trong spec.md §1.4 và tasks.md; PermissionsGuard sẽ deny-by-default nếu permission chưa được gán cho role nào — đúng hành vi mong muốn (fail-safe), không phải bug |
| Nhầm lẫn giữa `account.role.*` (mới, cho Role CRUD) và `admin.manage_permissions` (đã có, cho Role-Permission Assignment) khi review/QA | Low | Đã ghi chú rõ trong spec.md §0.2 và contracts/role-management-api.md mục "Endpoints không đổi" |
| roleCode không có UNIQUE constraint ở DB — race condition khi 2 request đồng thời tạo cùng roleCode | Low | Chấp nhận rủi ro như đã chấp nhận với `permissionCode` (không có DB constraint); ghi nhận ERR-016 trong spec như known limitation, không thuộc scope thêm migration |
