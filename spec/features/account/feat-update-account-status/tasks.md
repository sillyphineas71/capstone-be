# Tasks: Cập nhật trạng thái tài khoản (Update account status ACTIVE↔INACTIVE)

**Feature**: UC-11
**Module**: accounts
**Priority**: P1
**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới tasks.md cho UC-11 theo spec.md + plan.md + 11 quyết định chốt + ràng buộc bảo vệ code + route-collision. | Toàn bộ file |

---

## 0. Ràng buộc chốt (áp cho mọi task — không mở lại)

1. **`PATCH /api/v1/users/:userId/status`**, body `{ status: 'active' | 'inactive' }`; response `{ id, accountStatus }`.
2. DTO **`@IsIn(['active','inactive'])` literal** (KHÔNG dùng full `AccountStatus` enum); reject `locked`/`pending_reset` → **400**.
3. Actor **SYSTEM_ADMIN** (không scope) + **BUSINESS_ADMIN** (department scope — chỉ check target user; UC-11 không đổi department).
4. **BR-02** tự deactivate (target==actor & →inactive) → **422 CANNOT_DEACTIVATE_SELF**.
5. **BR-03** no-op (nextStatus==current) → **200**, không WRITE/audit.
6. **BR-04** current `LOCKED`/`PENDING_RESET` → **409 INVALID_STATUS_TRANSITION**.
7. **BR-05** last SYSTEM_ADMIN active (khi →inactive) → **422 LAST_SYSTEM_ADMIN** (COUNT admin khác, mirror `deleteUser`).
8. **BR-06** soft-deleted/không tồn tại → **404 USER_NOT_FOUND** (`deleted_at IS NULL`).
9. **Transaction atomic**: UPDATE `account_status` + audit atomic (`ACCOUNT_STATUS_UPDATE`, old/new=`{accountStatus}`, severity `WARNING` khi INACTIVE / `INFO` khi ACTIVE, không secret). **KHÔNG** set `updated_by`.
10. **Post-commit CHỈ khi →INACTIVE**: Redis `setWithTtl('auth:user:{id}:invalid_after', now, getRefreshTokenTtlSeconds())`; fail → log, **không throw/rollback**. →ACTIVE: **không** thao tác token.
11. Permission `accounts.user.update_status` gán **SYSTEM_ADMIN + BUSINESS_ADMIN**; seed **KHÔNG execute / KHÔNG runner**.

### ⛔ KHÔNG được làm (áp toàn feature)
- KHÔNG execute seed, KHÔNG chạy migration, KHÔNG commit.
- KHÔNG sửa `createUser`, `getUserDetail`, `updateUser`, `updateUserRoles`, `deleteUser`, `listUsers`, `resolveDepartmentScope` — chỉ đọc tham chiếu.
- KHÔNG sửa `login.service`/module auth. Chỉ dùng `RedisService.setWithTtl` + `AuthConfigService.getRefreshTokenTtlSeconds()` (đã inject từ UC-10, API công khai).
- KHÔNG thêm constructor param (Redis/AuthConfig đã có sẵn — [users.service.ts:81-82](../../../../src/modules/accounts/services/users.service.ts#L81)). KHÔNG sửa `accounts.module.ts`.
- **KHÔNG** set `LOCKED` (UC-12) / `PENDING_RESET` (auth). KHÔNG chạm `user_roles` (UC-08)/hồ sơ (UC-09)/soft-delete (UC-10).

### 🔀 Route collision (bắt buộc)
- `@Patch(':userId/status')` (UC-11) **PHẢI khai báo TRƯỚC** `@Patch(':userId')` (UC-09) trong `UsersController`, để route cụ thể hơn không bị `:userId` nuốt. Xác minh thứ tự khi thêm.

### Format
- `[Txxx]` Task ID tuần tự · `[CREATE]`/`[MODIFY]` + đường dẫn · **DoD** = definition of done.

---

## Phase 1 — DTO

| Dependency | Task |
|---|---|
| — | T001 |

- [ ] **T001** `[CREATE]` `src/modules/accounts/dto/update-user-status.dto.ts` — `UpdateUserStatusDto`.
  - Field `status`: `@IsIn(['active', 'inactive'])` (literal — #2), `@IsString()`, `@IsNotEmpty()`. Message tiếng Việt: "Trạng thái chỉ được là active hoặc inactive".
  - **KHÔNG** dùng full `AccountStatus` enum cho `@IsIn` (tránh lọt `locked`/`pending_reset`).
  - **DoD**: file compile; đúng 1 field `status` với allowlist active/inactive; không field thừa.

---

## Phase 2 — Service `UsersService.updateUserStatus`

> Thêm method vào `UsersService`. Tái dùng `redisService`/`authConfigService` (đã inject), `resolveDepartmentScope`, `AccountStatus`, `AuditLogEntity`/`AuditLogSeverity`, `UserRoleEntity`, `RoleEntity`, `IsNull`. **KHÔNG** thêm constructor param. **KHÔNG** sửa method khác.

| Dependency | Task |
|---|---|
| T001 → | T002 |
| T002 → | T003 |
| T003 → | T004 |

- [ ] **T002** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — khung `updateUserStatus` + **Phase A validate (READ)**.
  - Chữ ký: `async updateUserStatus(targetUserId: string, status: 'active' | 'inactive', actorId: string, clientContext: UserClientContext): Promise<{ id: string; accountStatus: string }>`.
  - Map `nextStatus = status === 'active' ? AccountStatus.ACTIVE : AccountStatus.INACTIVE`.
  - A.1 Load target: `findOne(UserEntity, { where: { id: targetUserId, deletedAt: IsNull() } })` → null: `NotFoundException` **USER_NOT_FOUND** (BR-06).
  - A.2 **Department scope** (mirror `updateUser`): query active `user_roles` của actor → `isSystemAdmin` qua `role.is_system_role`. Nếu không System Admin: `scope = resolveDepartmentScope(actorId)`; `targetUser.departmentId && !scope.has(...)` → `ForbiddenException` **FORBIDDEN** (BR-07). *(Chỉ target — UC-11 không đổi department.)*
  - A.3 **BR-04**: `targetUser.accountStatus === AccountStatus.LOCKED || === AccountStatus.PENDING_RESET` → `ConflictException` **INVALID_STATUS_TRANSITION**.
  - A.4 **BR-03 no-op**: `nextStatus === targetUser.accountStatus` → trả `{ id: targetUserId, accountStatus: targetUser.accountStatus }` ngay, KHÔNG transaction/audit.
  - A.5 (chỉ khi `nextStatus === AccountStatus.INACTIVE`):
    - **BR-02**: `targetUserId === actorId` → `UnprocessableEntityException` **CANNOT_DEACTIVATE_SELF**.
    - **BR-05 last-admin**: nếu target giữ `SYSTEM_ADMIN` active, COUNT user khác target còn active giữ `SYSTEM_ADMIN` active (mirror `deleteUser` A.3 QueryBuilder: join `ur.role`+`ur.user`, `role_code='SYSTEM_ADMIN'`, `r.isActive`, `ur.isActive`, `expiredAt` NULL/>now, `u.deletedAt IS NULL`, `u.accountStatus=ACTIVE`, `u.id != target`); `0` → `UnprocessableEntityException` **LAST_SYSTEM_ADMIN**.
  - Exception format inline module.
  - **DoD**: method tồn tại, tsc pass; mọi nhánh ném đúng exception/HTTP (400/403/404/409/422); chưa có WRITE (trừ nhánh no-op chỉ READ trả về).

- [ ] **T003** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — **Phase B transaction (atomic)**.
  - `await this.dataSource.transaction(async (tem) => { ... })`:
    1. `tem.update(UserEntity, targetUserId, { accountStatus: nextStatus })`. **KHÔNG** set `updated_by`.
    2. Audit atomic: `tem.save(tem.create(AuditLogEntity, { userId: actorId, actionType: 'ACCOUNT_STATUS_UPDATE', entityType: 'users', entityId: targetUserId, severity: nextStatus === AccountStatus.INACTIVE ? AuditLogSeverity.WARNING : AuditLogSeverity.INFO, oldValueJson: { accountStatus: targetUser.accountStatus }, newValueJson: { accountStatus: nextStatus }, ipAddress: clientContext.ipAddress||null, userAgent: clientContext.userAgent||null, requestId: clientContext.requestId||null }))`. `action_type` hằng số cục bộ.
  - **DoD**: UPDATE + audit atomic (rollback nếu lỗi); severity đúng hướng chuyển; old/new = `{accountStatus}`, không secret; không set `updated_by`; tsc pass.

- [ ] **T004** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — **Phase C post-commit (revoke điều kiện)** + return.
  - **CHỈ khi `nextStatus === AccountStatus.INACTIVE`**: `try { await this.redisService.setWithTtl('auth:user:' + targetUserId + ':invalid_after', String(Date.now()), this.authConfigService.getRefreshTokenTtlSeconds()); } catch (e) { this.logger.error(...) }` — **không throw, không rollback** (mirror `deleteUser` Phase C).
  - Khi `nextStatus === AccountStatus.ACTIVE`: **KHÔNG** thao tác token.
  - `return { id: targetUserId, accountStatus: nextStatus }`.
  - **DoD**: revoke chỉ chạy khi →INACTIVE; →ACTIVE không gọi Redis; Redis fail không hỏng luồng; trả `{ id, accountStatus }`; tsc pass.

---

## Phase 3 — Controller (chú ý ROUTE ORDER)

| Dependency | Task |
|---|---|
| T004 → | T005 |

- [ ] **T005** `[MODIFY]` `src/modules/accounts/controllers/users.controller.ts` — thêm `@Patch(':userId/status')`.
  - 🔀 **Khai báo method `updateUserStatus` TRƯỚC method `updateUser` (`@Patch(':userId')` của UC-09)** trong class, để route cụ thể hơn không bị `:userId` nuốt. Xác minh không route collision.
  - Decorators: `@Patch(':userId/status')`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('accounts.user.update_status')`, `@ApiBearerAuth()`, `@ApiOperation`/`@ApiParam`/`@ApiBody`/`@ApiResponse`.
  - Param `userId` qua `ParseUUIDPipe` (code `INVALID_USER_ID`). Body `@Body(new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true })) dto: UpdateUserStatusDto`.
  - Actor + context: `request['user']` → `actorId`, `@Ip()`, `@Headers('user-agent')`, `@Headers('x-request-id')`.
  - Gọi `await this.usersService.updateUserStatus(userId, dto.status, actorId, { ipAddress, userAgent, requestId })`; trả `{ success: true, message: 'Cập nhật trạng thái tài khoản thành công', data: result }`.
  - Import `UpdateUserStatusDto`.
  - **DoD**: endpoint mount `PATCH /api/v1/users/:userId/status`; guards + permission đúng; **thứ tự route đúng** (declared trước `:userId`), không collision; KHÔNG đổi endpoint khác; tsc pass.

---

## Phase 4 — Seed permission (TẠO FILE, KHÔNG CHẠY)

| Dependency | Task |
|---|---|
| — (song song được) | T006 |

- [ ] **T006** `[CREATE]` `src/database/seeds/<timestamp>-SeedUserUpdateStatusPermission.ts` — permission `accounts.user.update_status`.
  - Mirror [SeedDepartmentReadPermission.ts](../../../../src/database/seeds/20260704000001-SeedDepartmentReadPermission.ts): `queryRunner` + transaction.
  - INSERT permission `permission_code='accounts.user.update_status'`, `permission_name='Cập nhật trạng thái tài khoản'`, `module_code='accounts'`, `action_code='update'`, `is_active=true`, `ON CONFLICT DO NOTHING RETURNING id`.
  - Gán role-set `['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` → INSERT `role_permissions ... ON CONFLICT DO NOTHING`.
  - Idempotent, rollback. Grep xác nhận code chưa tồn tại.
  - ⚠️ KHÔNG thêm runner; KHÔNG execute.
  - **DoD**: file tồn tại, tsc pass; role-set đúng 2 role; không lệnh chạy seed nào thực thi.

---

## Phase 5 — Unit test Service (S1–S13)

| Dependency | Task |
|---|---|
| T004 → | T007 |

- [ ] **T007** `[MODIFY]` `src/modules/accounts/services/users.service.spec.ts` — suite `updateUserStatus` phủ S1–S13 (plan §11.1). Mock `dataSource.transaction`/`manager`/`em` (`findOne/find/count|createQueryBuilder/update/create/save`) + `redisService.setWithTtl` + `authConfigService.getRefreshTokenTtlSeconds` (đã có provider từ UC-10).
  - S1 active→inactive (System Admin): `update(UserEntity, ..., {accountStatus:'inactive'})` + audit WARNING old/new; **revoke** `setWithTtl(...invalid_after...)`.
  - S2 inactive→active: `update(...,{accountStatus:'active'})` + audit INFO; **KHÔNG** revoke (setWithTtl không gọi).
  - S3 No-op (status==current): 200, không transaction/update/audit.
  - S4 BR-02 self-deactivate (target==actor, →inactive) → 422, không WRITE.
  - S5 BR-05 last SYSTEM_ADMIN (→inactive, count khác=0) → 422, không WRITE.
  - S6 BR-05 còn admin khác (count≥1) → thành công.
  - S7 BR-04 current=LOCKED → 409 INVALID_STATUS_TRANSITION, không WRITE.
  - S8 BR-04 current=PENDING_RESET → 409, không WRITE.
  - S9 BR-06 USER_NOT_FOUND (soft-deleted/không tồn tại) → 404.
  - S10 BR-07 Business Admin — target ngoài scope → 403, không WRITE.
  - S11 System Admin bỏ qua scope → thành công.
  - S12 Redis fail post-commit (→inactive) → không throw; account_status đã đổi (update đã gọi).
  - S13 Rollback — WRITE trong transaction lỗi → reject; revoke KHÔNG chạy.
  - **DoD**: các test pass; assert có/không WRITE, nội dung audit (severity+old/new), có/không revoke theo hướng; coverage nhánh ≥ ENG-01 (80%).

---

## Phase 6 — Controller test (SC1–SC5)

| Dependency | Task |
|---|---|
| T005 → | T008 |

- [ ] **T008** `[MODIFY]` `src/modules/accounts/controllers/users.controller.spec.ts` — test `PATCH :userId/status` phủ SC1–SC5 (plan §11.2). Mock `UsersService.updateUserStatus`; đọc metadata guard/permission.
  - SC1 Success: gọi `updateUserStatus(userId, dto.status, actorId, ctx)`; trả `{ success, message, data:{id,accountStatus} }`.
  - SC2 `userId` không UUID → 400 (`INVALID_USER_ID`).
  - SC3 `status` không hợp lệ (vd `'locked'`) → DTO `@IsIn` reject (test qua `validate()` DTO).
  - SC4 Guard metadata `updateUserStatus` = `[JwtAuthGuard, PermissionsGuard]`.
  - SC5 Permission metadata = `['accounts.user.update_status']`.
  - **DoD**: 5 test pass; xác nhận permission đúng; không phá test hiện có.

---

## Phase 7 — Cổng chất lượng

| Dependency | Task |
|---|---|
| T001–T008 → | T009 |

- [ ] **T009** Chạy cổng chất lượng trên file đã đụng (KHÔNG commit).
  1. **tsc**: `npx tsc --noEmit`. Kỳ vọng: 0 lỗi **mới** ở file production (dto/service/controller/seed).
  2. **eslint** file đã tạo/sửa (chạy `--fix` cho prettier): `update-user-status.dto.ts`, `users.service.ts`, `users.controller.ts`, seed, 2 spec.
  3. **jest**: `npx jest src/modules/accounts src/modules/auth/guards`.
  4. **Baseline vs mới**: nếu nghi lỗi có sẵn → `git stash` chạy lại lấy baseline, `git stash pop`; chỉ xử lý lỗi **mới** do UC-11. Ghi rõ lỗi baseline vs mới kèm bằng chứng `git stash`.
  - **DoD**: production files **tsc & eslint sạch** (hoặc chỉ lỗi trùng pattern seed/mock baseline đã chứng minh); jest phạm vi trên **pass**; lỗi còn lại chứng minh baseline; **KHÔNG commit**, **KHÔNG chạy seed/migration**.

---

## Bảng truy vết Task ↔ file ↔ ràng buộc

| Task | Loại | File | Ràng buộc/DoD chính |
|---|---|---|---|
| T001 | CREATE | `dto/update-user-status.dto.ts` | #2 @IsIn active/inactive |
| T002 | MODIFY | `services/users.service.ts` | Phase A; BR-04/06/07 + (INACTIVE: BR-02/05) |
| T003 | MODIFY | `services/users.service.ts` | Phase B transaction atomic (#9), không `updated_by` |
| T004 | MODIFY | `services/users.service.ts` | Phase C revoke điều kiện (#10), tái dùng Redis/AuthConfig |
| T005 | MODIFY | `controllers/users.controller.ts` | #1 endpoint; **route order trước `:userId`**; RBAC `accounts.user.update_status` |
| T006 | CREATE | `database/seeds/<ts>-SeedUserUpdateStatusPermission.ts` | #11 SYSTEM_ADMIN+BUSINESS_ADMIN, KHÔNG execute |
| T007 | MODIFY | `services/users.service.spec.ts` | S1–S13 |
| T008 | MODIFY | `controllers/users.controller.spec.ts` | SC1–SC5 |
| T009 | — | (các file trên) | tsc + eslint + jest, baseline vs mới |

---

> **Chưa code ở bước này** — tasks.md chờ duyệt trước khi implement. Thực thi tuần tự T001 → T009, tuân thủ "⛔ KHÔNG được làm" (đặc biệt: không sửa login/auth/method người khác, không set LOCKED/PENDING_RESET, khai báo route `:userId/status` TRƯỚC `:userId`).
