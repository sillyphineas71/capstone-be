# Implementation Plan: Cập nhật vai trò tài khoản (Update account roles)

> Feature ID: UC-08
> Module: accounts
> Created: 2026-07-12
> Status: Draft
> Spec nguồn: [spec.md](./spec.md) (đã duyệt, có áp các quyết định chốt bên dưới)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới plan.md cho UC-08 dựa trên spec.md + 5 quyết định đã chốt (chỉ SYSTEM_ADMIN, PUT replace-set, soft-remove, permission mới, BR-08). | Toàn bộ file |

---

## 0. Quyết định đã chốt (ràng buộc — không mở lại)

| # | Quyết định | Ảnh hưởng plan |
| :--- | :--- | :--- |
| 1 | Actor **CHỈ SYSTEM_ADMIN**; Business Admin không được phép | **BỎ** toàn bộ department scope, **BỎ** BR-05 (role-elevation) & BR-06, bỏ nhánh A3. Không dùng `resolveDepartmentScope` |
| 2 | Endpoint `PUT /api/v1/users/:userId/roles` — replace-set, nhận full `roleIds[]` | Idempotent tự nhiên (thỏa ARCH-03), không cần idempotency-key |
| 3 | `user_roles`: **SOFT-REMOVE** (`is_active=false` + `expired_at=now()`) cho role bị bỏ; add role mới | Không hard-delete → thỏa DATA-01 |
| 4 | Permission mới `accounts.user.update_roles`, gán **CHỈ SYSTEM_ADMIN**; cần seed (không tự chạy) | Thêm 1 seed file, mô tả trong plan, KHÔNG execute |
| 5 | **BR-08 áp dụng**: chặn đổi role nếu tài khoản mục tiêu không active → `422 ACCOUNT_INACTIVE` | Thêm check `account_status` trong service |

---

## 1. Feature Summary

Cho phép **SYSTEM_ADMIN** cập nhật (replace) toàn bộ tập vai trò của một tài khoản đã tồn tại thông qua `PUT /api/v1/users/:userId/roles`. Service tính diff giữa tập role active hiện tại và tập role mong muốn, **soft-remove** role bị bỏ và **kích hoạt/thêm** role được thêm — tất cả trong một transaction. Quyền hiệu lực (effective permissions) của user thay đổi tương ứng theo RBAC ngay lập tức (guard đọc live từ DB, không cache). Ghi `audit_logs` với before/after roleIds. Không thay đổi schema, không thêm bảng/field.

---

## 2. Technical Context

### 2.1 Stack & pattern hiện có (đã xác minh trong codebase)

| Layer | Chi tiết | Nguồn |
| :--- | :--- | :--- |
| Controller | `UsersController` (`@Controller('users')`), pattern `request['user']` + `@Ip()` + `@Headers()` để lấy client context | [users.controller.ts](../../../../src/modules/accounts/controllers/users.controller.ts) |
| Service | `UsersService` đã quản lý `user_roles` khi `createUser` (INSERT row, bước 9); dùng `dataSource.transaction(async em => ...)` | [users.service.ts:66-268](../../../../src/modules/accounts/services/users.service.ts#L66-L268) |
| Audit | `AuditLogsService.logEntityChange({...oldValueJson,newValueJson})` — fail-safe, dùng repo riêng (ghi ngoài transaction QueryRunner) | [audit-logs.service.ts:125-140](../../../../src/modules/administration/services/audit-logs.service.ts#L125-L140) |
| RBAC guard | `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions(...)`; guard resolve quyền qua raw SQL | [permissions.guard.ts](../../../../src/modules/auth/guards/permissions.guard.ts), [authz-read.repository.ts](../../../../src/modules/auth/repositories/authz-read.repository.ts) |
| Module wiring | `AccountsModule` đã `forFeature([UserEntity, RoleEntity, UserRoleEntity, ...])`, đã import `AdministrationModule`, đã đăng ký `UsersController`+`UsersService` | [accounts.module.ts:45-90](../../../../src/modules/accounts/accounts.module.ts#L45-L90) |

### 2.2 Điểm mấu chốt đã xác minh

- **`user_roles` có UNIQUE `(user_id, role_id)`** (ghi nhận tại [feat-view-detail-account/spec.md:240](../feat-view-detail-account/spec.md#L240)). ⇒ Khi "add" một role từng bị soft-remove, **KHÔNG được INSERT trùng** — phải **reactivate** row cũ. Xem §5.2.
- **Guard không cache**: `AuthzReadRepository.getEffectiveRolesAndPermissions` chạy raw SQL mỗi request và đã filter `ur.is_active = true AND (ur.expired_at IS NULL OR ur.expired_at > now())` ([authz-read.repository.ts:16-30](../../../../src/modules/auth/repositories/authz-read.repository.ts#L16-L30)). ⇒ Soft-remove có hiệu lực **ngay** ở request kế tiếp. **Authz cache invalidation = N/A** (xem §8).
- `AccountStatus.ACTIVE` enum tồn tại và đã được import trong `UsersService` ([users.service.ts:12-16](../../../../src/modules/accounts/services/users.service.ts#L12-L16)) → dùng cho BR-08.

### 2.3 Constitution / Rule gate

| Gate | Status | Ghi chú |
| :--- | :--- | :--- |
| SEC-02 (auth cho mutating) | ✅ | PUT có `JwtAuthGuard` + `PermissionsGuard` |
| SEC-03 (input validation) | ✅ | `UpdateUserRolesDto` + `ParseUUIDPipe`, không raw SQL nối chuỗi |
| DATA-01 (soft-delete) | ✅ | Soft-remove `user_roles`, không hard-delete |
| ARCH-03 (idempotency) | ✅ | `PUT` replace-set idempotent tự nhiên |
| ENG-03 (error format) | ✅ | `{success,message,error:{code,details}}`, không lộ stack trace |
| DB Gate | ✅ | Không thêm bảng/field; chỉ thêm 1 permission row qua seed |
| Scope Gate | ✅ | Chỉ UC-08 |

---

## 3. Kiến trúc & luồng

```
PUT /api/v1/users/:userId/roles
  │
  ├─ JwtAuthGuard                → 401 nếu thiếu/sai token
  ├─ PermissionsGuard
  │    @RequirePermissions('accounts.user.update_roles')  → 403 nếu thiếu quyền
  │
  ▼
UsersController.updateUserRoles(userId, dto, request, ip, headers)
  │   ParseUUIDPipe(userId) · ValidationPipe(UpdateUserRolesDto)
  ▼
UsersService.updateUserRoles(targetUserId, desiredRoleIds, actorId, clientContext)
  │   1. load+validate target user (tồn tại, active)     → users (READ)
  │   2. validate desired roles (tồn tại, active)          → roles (READ)
  │   3. load current active roles + diff                  → user_roles (READ)
  │   4. business rules (BR-04 self-lockout, no-op)
  │   5. TRANSACTION: soft-remove + reactivate/insert      → user_roles (WRITE)
  │   6. (sau commit) ghi audit                            → audit_logs (WRITE, qua AuditLogsService)
  │   7. trả tập role active mới
  ▼
Response 200 { success, message, data:{ userId, roles[] } }
```

Layered pattern giữ nguyên như module hiện tại: **Controller** chỉ nhận request + guard + gọi service; **Service** chứa toàn bộ business rule + transaction; truy vấn qua `EntityManager`/repository của TypeORM (không tạo repository class riêng — nhất quán với `UsersService` hiện tại vốn dùng `dataSource.manager`/`dataSource.transaction`).

> **Quyết định vị trí code**: thêm method `updateUserRoles` vào **`UsersService`** hiện có (không tạo service mới) vì `UsersService` đã sở hữu logic ghi `user_roles` (`createUser`) và validate role — giữ cohesion, tối thiểu thay đổi wiring. Cần bổ sung inject `AuditLogsService` vào `UsersService` (hiện `UsersService` ghi audit bằng `em.create(AuditLogEntity)` inline; để mirror `role-permissions.service`, ta dùng `AuditLogsService.logEntityChange`). `AuditLogsService` đã khả dụng qua `AdministrationModule` (đã import) nên **không cần sửa `accounts.module.ts`**.
> *Phương án thay thế (không chọn):* tách `UserRolesService` + đăng ký trong module — sạch hơn về SRP nhưng thêm wiring; để dành nếu team muốn refactor.

---

## 4. DTO Plan

### 4.1 `UpdateUserRolesDto` (TẠO MỚI)

`src/modules/accounts/dto/update-user-roles.dto.ts`

```
class UpdateUserRolesDto {
  @IsArray()
  @ArrayNotEmpty()                          // BR-01: tài khoản phải giữ ≥1 role
  @IsUUID('4', { each: true })              // mỗi phần tử là UUID v4
  roleIds: string[];
}
```

- **Loại trùng** thực hiện trong service (`[...new Set(dto.roleIds)]`) — mirror [role-permissions.service.ts:83-89](../../../../src/modules/accounts/services/role-permissions.service.ts#L83-L89). (Không dùng validator để dedup để còn báo cáo `skippedDuplicatedInRequest` nếu muốn; tối thiểu là dedup im lặng.)
- Message tiếng Việt theo phong cách `CreateUserDto` (VD "Danh sách vai trò không được rỗng").

> **Lưu ý mâu thuẫn nhỏ với spec**: spec ghi BR-01 → `422 ROLE_SET_EMPTY`. Nhưng `@ArrayNotEmpty` ở DTO cho **400** (ValidationPipe), không phải 422. Chọn: enforce ở DTO (**400**, chuẩn NestJS). Ghi rõ trong contract. Nếu team bắt buộc 422 semantic thì mới thêm check thủ công trong service.

### 4.2 `UpdateUserRolesResponseDto` (TẠO MỚI — optional)

`src/modules/accounts/dto/update-user-roles-response.dto.ts` — hình dạng `{ userId: string; roles: { id; roleCode; roleName }[] }`. Có thể tái dùng `UserRoleResponseDto` (đã có trong [user-response.dto.ts](../../../../src/modules/accounts/dto/user-response.dto.ts)) cho phần `roles`.

---

## 5. Service Design

### 5.1 Chữ ký method

```
async updateUserRoles(
  targetUserId: string,
  desiredRoleIds: string[],
  actorId: string,
  clientContext: UserClientContext,   // { ipAddress?, userAgent?, requestId? } — đã có sẵn
): Promise<UpdateUserRolesResponseDto>
```

### 5.2 Thuật toán (thứ tự thao tác)

**Phase A — Validate (ngoài transaction, fail sớm):**
1. `desired = [...new Set(desiredRoleIds)]`.
2. Load target user: `findOne(UserEntity, { where: { id: targetUserId, deletedAt: IsNull() } })`.
   - Không có → `NotFoundException` **USER_NOT_FOUND** (BR-07).
3. **BR-08**: nếu `target.accountStatus !== AccountStatus.ACTIVE` → `UnprocessableEntityException` **ACCOUNT_INACTIVE**.
4. Validate từng `roleId ∈ desired` (mirror `createUser` bước 4):
   - `findOne(RoleEntity, { where: { id } })` không có → `NotFoundException` **ROLE_NOT_FOUND** (BR-02).
   - `role.isActive === false` → `UnprocessableEntityException` **ROLE_INACTIVE** (BR-03).
   - Giữ lại `role.isSystemRole` để dùng ở BR-04.
5. Load current active roles: `find(UserRoleEntity, { where: { userId: targetUserId, isActive: true } })` → `currentRoleIds`.
6. Tính diff:
   - `toAdd = desired \ currentRoleIds`
   - `toRemove = currentRoleIds \ desired`
7. **BR-04 self-lockout**: nếu `actorId === targetUserId` **và** tồn tại role thuộc `toRemove` có `is_system_role = true` (tức admin tự gỡ chính role hệ thống của mình) → `UnprocessableEntityException` **CANNOT_MODIFY_OWN_ADMIN_ROLE**.
   - *(Cần load `is_system_role` cho các role trong `toRemove` — query `roles` theo `In(toRemove)`.)*
8. **No-op (A1 idempotent)**: nếu `toAdd.length === 0 && toRemove.length === 0` → trả về 200 với tập role hiện tại, **không** ghi DB, **không** ghi audit change (tùy chọn ghi audit `info` "no-op"; mặc định bỏ qua để tránh nhiễu).

**Phase B — Transaction** (`this.dataSource.transaction(async (em) => {...})`, mirror `createUser`):
9. **Soft-remove** role bị bỏ:
   `UPDATE user_roles SET is_active=false, expired_at=now() WHERE user_id=:target AND role_id IN (:toRemove) AND is_active=true` (qua `em.update(UserRoleEntity, {...}, {...})` hoặc query builder có parameter binding — **không nối chuỗi**).
10. **Add** role mới — do UNIQUE `(user_id, role_id)` (§2.2), với mỗi `roleId ∈ toAdd`:
    - Tìm row tồn tại bất kể trạng thái: `findOne(UserRoleEntity, { where: { userId, roleId } })`.
    - **Nếu có row (đang inactive từ lần soft-remove trước) → REACTIVATE**: set `is_active=true, expired_at=null, assigned_by=actorId, assigned_at=now()`.
    - **Nếu chưa có row → INSERT** mới (`is_active=true`, `assigned_by=actorId`).
    - ⇒ Tránh vi phạm unique constraint.
11. Commit.

**Phase C — Sau commit:**
12. Ghi audit (§7) qua `AuditLogsService.logEntityChange(...)`.
13. Query lại active roles → map `UpdateUserRolesResponseDto` và trả về.

### 5.3 Transaction boundary

- Toàn bộ WRITE `user_roles` nằm trong **1** `dataSource.transaction` (atomic). Nếu lỗi giữa chừng → rollback toàn bộ, tập role không đổi.
- **Audit ghi NGOÀI transaction (sau commit)** — nhất quán với `role-permissions.service` (gọi `auditLogsService` sau `commitTransaction`) và với cơ chế `AuditLogsService` (dùng repo/connection riêng, có fail-safe). Trade-off: nếu ghi audit fail thì thay đổi role đã commit — chấp nhận được vì `AUDIT_LOG_FAIL_SAFE` chỉ log lỗi, không rollback nghiệp vụ. Ghi rõ ở §10 rủi ro.

---

## 6. Validation & Business Rules mapping

| Rule (từ spec) | Áp dụng? | Nơi enforce | Kết quả |
| :--- | :--- | :--- | :--- |
| BR-01 tập role ≥ 1 | ✅ | DTO `@ArrayNotEmpty` | 400 (xem §4.1) |
| BR-02 role không tồn tại | ✅ | Service Phase A.4 | 404 ROLE_NOT_FOUND |
| BR-03 role inactive | ✅ | Service Phase A.4 | 422 ROLE_INACTIVE |
| BR-04 self-lockout (tự gỡ role hệ thống của mình) | ✅ | Service Phase A.7 | 422 CANNOT_MODIFY_OWN_ADMIN_ROLE |
| BR-05 role-elevation | ❌ BỎ | — | Không áp (chỉ SYSTEM_ADMIN) |
| BR-06 department scope | ❌ BỎ | — | Không áp (chỉ SYSTEM_ADMIN) |
| BR-07 không thao tác tài khoản đã soft-delete | ✅ | Service Phase A.2 (`deletedAt: IsNull()`) | 404 USER_NOT_FOUND |
| BR-08 tài khoản không active | ✅ | Service Phase A.3 | 422 ACCOUNT_INACTIVE |
| BR-09 idempotency | ✅ | PUT replace-set + no-op A1 | — |
| BR-10 no raw SQL / validate input | ✅ | DTO + parameter binding | — |

---

## 7. Audit Plan

- Dùng **`AuditLogsService.logEntityChange`** (mirror ý tưởng ghi của `role-permissions.service`, nhưng dùng biến thể có before/after):
  ```
  await this.auditLogsService.logEntityChange({
    userId: actorId,                     // người thực hiện (SYSTEM_ADMIN)
    actionType: 'ACCOUNT_ROLE_UPDATE',   // hằng số cục bộ
    entityType: 'users',
    entityId: targetUserId,
    oldValueJson: { roleIds: [...currentRoleIds] },   // trước
    newValueJson: { roleIds: [...desired] },          // sau
    ipAddress: clientContext.ipAddress,
    userAgent: clientContext.userAgent,
    requestId: clientContext.requestId,
    severity: AuditLogSeverity.WARNING,  // thay đổi RBAC = nhạy cảm
  });
  ```
- Chỉ log **roleIds** (và tùy chọn roleCode) — **KHÔNG** log secret/token/password (SEC-01, comment trong `AuditLogsService`).
- Bảng `audit_logs` không đổi schema; các field dùng: `user_id, action_type, entity_type, entity_id, old_value_json, new_value_json, ip_address, user_agent, request_id, severity`.
- CLAUDE.md §17 liệt kê "Role/permission change" là hành động **bắt buộc** audit → đáp ứng.

---

## 8. RBAC & Authz cache

### 8.1 Guard
```
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('accounts.user.update_roles')
```
Mirror `UsersController.createUser` ([users.controller.ts:47-73](../../../../src/modules/accounts/controllers/users.controller.ts#L47-L73)).

### 8.2 Permission seed (MÔ TẢ — KHÔNG chạy ở bước này)

File mới `src/database/seeds/<timestamp>-SeedUserUpdateRolesPermission.ts`, mirror [SeedDepartmentReadPermission.ts](../../../../src/database/seeds/20260704000001-SeedDepartmentReadPermission.ts) / SeedUserListPermission:
- INSERT permission: `permission_code='accounts.user.update_roles'`, `module_code='accounts'` (trong MODULE_CODE_ALLOWLIST), `action_code='update'`, `is_active=true`, `ON CONFLICT (permission_code) DO NOTHING`.
- Gán vào role-set **CHỈ** `['SYSTEM_ADMIN']` (khác các seed 4-role) → INSERT `role_permissions` với `ON CONFLICT DO NOTHING`.
- Idempotent, có transaction.
- ⚠️ **Không** thêm vào runner tự động; **không** execute. Chỉ tạo file + chờ team duyệt & chạy theo quy trình migration/seed của dự án.

### 8.3 Authz cache invalidation → **N/A**

`AuthzReadRepository` truy vấn **live raw SQL mỗi request**, không có lớp cache; query đã lọc `is_active`/`expired_at`. Do đó sau khi `updateUserRoles` commit, request kế tiếp của target user tự phản ánh quyền mới. **Không cần bước invalidate.** *(Nếu tương lai thêm cache cho authz thì phải bổ sung invalidate theo `userId` — ghi lại như tech-debt note.)*

---

## 9. Error Handling Plan

Theo convention **inline exception object** của module (giống `createUser`/`role-permissions.service`) — **không** tạo file error-codes tập trung (module hiện chưa có; giữ nhất quán). `action_type` để hằng số cục bộ trong service (`const ACTION_TYPE = 'ACCOUNT_ROLE_UPDATE'`).

| error.code | HTTP | Exception | Nơi phát |
| :--- | :--- | :--- | :--- |
| (validation) | 400 | ValidationPipe/ParseUUIDPipe | DTO/param (roleIds rỗng, UUID sai) |
| UNAUTHORIZED | 401 | (JwtAuthGuard) | Guard |
| FORBIDDEN | 403 | ForbiddenException | PermissionsGuard (thiếu `accounts.user.update_roles`) |
| USER_NOT_FOUND | 404 | NotFoundException | Service A.2 |
| ROLE_NOT_FOUND | 404 | NotFoundException | Service A.4 |
| ROLE_INACTIVE | 422 | UnprocessableEntityException | Service A.4 |
| ACCOUNT_INACTIVE | 422 | UnprocessableEntityException | Service A.3 (BR-08) |
| CANNOT_MODIFY_OWN_ADMIN_ROLE | 422 | UnprocessableEntityException | Service A.7 (BR-04) |
| (500) | 500 | (exception filter) | Không lộ stack trace (ENG-03) |

Định dạng body lỗi: `{ success:false, message, error:{ code, details } }` (kèm `timestamp`,`path` nếu đi qua global filter) — như phần còn lại của module.

> **Đề xuất (optional, chờ duyệt)**: nếu team muốn tập trung hoá, tạo `src/modules/accounts/constants/account-error-codes.constant.ts`. Mặc định plan **không** tạo, để bám convention hiện có.

---

## 10. Testing Strategy (chỉ liệt kê — không viết code test ở bước này)

### 10.1 Unit test — `UsersService.updateUserRoles` (`users.service.spec.ts`, MODIFY)

| # | Test case | Kỳ vọng |
| :--- | :--- | :--- |
| U1 | Happy path: desired trộn add+remove | soft-remove đúng role bị bỏ (`is_active=false`,`expired_at` set), reactivate/insert role thêm, audit `logEntityChange` được gọi với old/new roleIds đúng, trả tập role mới |
| U2 | No-op idempotent (desired == current) | không WRITE `user_roles`, không audit change, trả 200 |
| U3 | USER_NOT_FOUND (user không tồn tại/đã soft-delete) | throw NotFound, không WRITE |
| U4 | ACCOUNT_INACTIVE (BR-08, `account_status` ≠ active) | throw 422, không WRITE |
| U5 | ROLE_NOT_FOUND (một desired role không tồn tại) | throw 404, không WRITE |
| U6 | ROLE_INACTIVE (desired role `is_active=false`) | throw 422, không WRITE |
| U7 | BR-04 self-lockout (actor == target, toRemove chứa role `is_system_role=true`) | throw 422 CANNOT_MODIFY_OWN_ADMIN_ROLE |
| U8 | Reactivate: role từng bị soft-remove được add lại | update row cũ (không INSERT trùng → không vi phạm UNIQUE) |
| U9 | Transaction rollback khi WRITE lỗi | tập role không đổi, không audit |

### 10.2 Controller test — `UsersController` (`users.controller.spec.ts`, MODIFY)

| # | Test case | Kỳ vọng |
| :--- | :--- | :--- |
| C1 | PUT success (guards pass) | gọi `service.updateUserRoles` với đúng tham số, trả `{success:true,...}` |
| C2 | `userId` không phải UUID | 400 (ParseUUIDPipe) |
| C3 | `roleIds` rỗng | 400 (DTO `@ArrayNotEmpty`) |
| C4 | Thiếu token | 401 |
| C5 | Thiếu permission `accounts.user.update_roles` | 403 |

### 10.3 (Tùy chọn) Integration test
- Full flow: request → guard → service → DB → audit; verify effective permissions của target đổi ngay (query lại authz) & row `user_roles` đúng trạng thái.

> Constitution ENG-01: ≥80% coverage business logic → tập trung test service (nơi chứa business rule).

---

## 11. Rủi ro & điểm cần xác minh khi code

| # | Rủi ro / cần xác minh | Hành động |
| :--- | :--- | :--- |
| R1 | **UNIQUE `(user_id, role_id)`** trên `user_roles` — quyết định insert vs reactivate | Xác minh tên/constraint thực trong DB (spec feat-view-detail khẳng định có). Code theo hướng **reactivate-if-exists** để an toàn dù constraint tồn tại hay không |
| R2 | Audit ghi ngoài transaction (sau commit) | Chấp nhận theo pattern hiện có + fail-safe; nếu team muốn atomic thì chuyển sang `em.create(AuditLogEntity)` trong transaction như `createUser` |
| R3 | BR-01 trả 400 (DTO) thay vì 422 (spec) | Xác nhận với team; mặc định 400 |
| R4 | `AccountStatus` có giá trị nào coi là "được phép" ngoài `ACTIVE`? | Xác minh enum trong `user.entity.ts`; hiện chốt: chỉ `ACTIVE` mới cho đổi role |
| R5 | Inject `AuditLogsService` vào `UsersService` | Xác nhận `AdministrationModule` export `AuditLogsService` (đã import sẵn; `RolePermissionsService` inject thành công ⇒ khả dụng) |
| R6 | `@RequirePermissions` naming | Dùng đúng chuỗi `accounts.user.update_roles`, khớp seed |
| R7 | Cache authz tương lai | Hiện N/A; ghi tech-debt nếu thêm cache sau |

---

## 12. Checklist file cần TẠO / SỬA

### 🆕 TẠO MỚI
- [ ] `src/modules/accounts/dto/update-user-roles.dto.ts` — `UpdateUserRolesDto` (`roleIds: string[]`, `@ArrayNotEmpty`, `@IsUUID` each)
- [ ] `src/modules/accounts/dto/update-user-roles-response.dto.ts` — `UpdateUserRolesResponseDto` *(optional; có thể tái dùng `UserRoleResponseDto`)*
- [ ] `src/database/seeds/<timestamp>-SeedUserUpdateRolesPermission.ts` — seed permission `accounts.user.update_roles` → gán CHỈ `SYSTEM_ADMIN` *(mô tả sẵn; **KHÔNG execute**)*

### ✏️ SỬA (file đã tồn tại)
- [ ] `src/modules/accounts/services/users.service.ts` — thêm method `updateUserRoles(...)`; inject `AuditLogsService`
- [ ] `src/modules/accounts/controllers/users.controller.ts` — thêm `@Put(':userId/roles')` + guards + `@RequirePermissions('accounts.user.update_roles')`
- [ ] `src/modules/accounts/services/users.service.spec.ts` — unit test U1–U9
- [ ] `src/modules/accounts/controllers/users.controller.spec.ts` — controller test C1–C5

### ⛔ KHÔNG đổi
- `src/modules/accounts/accounts.module.ts` — không cần (entities + `UsersService` + `AdministrationModule` đã đăng ký/khả dụng)
- Không sửa `role-permissions.*` (thuộc UC khác), không migration đổi schema, không hard-delete.

---

> Kết thúc plan. Bước tiếp theo (khi được duyệt): tách `tasks.md` chi tiết theo checklist trên. **Chưa code, chưa chạy seed/migration ở bước này.**
