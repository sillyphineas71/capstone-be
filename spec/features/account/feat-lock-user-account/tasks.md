# Tasks: Khóa/Mở khóa tài khoản người dùng (Lock / Unlock user account)

**Feature**: UC-12
**Module**: accounts
**Priority**: P1
**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới tasks.md cho UC-12 (lock + unlock) theo spec.md + plan.md + 13 quyết định chốt + ràng buộc bảo vệ code + route-order. | Toàn bộ file |

---

## 0. Ràng buộc chốt (áp cho mọi task — không mở lại)

1. **2 endpoint**: `PATCH /api/v1/users/:userId/lock` (body `{reason?}`) + `PATCH /api/v1/users/:userId/unlock` (no body). Response `{ id, accountStatus }`.
2. **Lock**: `account_status=LOCKED`, `locked_until=null`. KHÔNG chạm `user_roles`/hồ sơ/soft-delete. KHÔNG `updated_by`.
3. **Reason** optional → `audit_logs.metadataJson`, KHÔNG thêm cột `users`.
4. **Lock post-commit revoke**: Redis `setWithTtl('auth:user:{id}:invalid_after', now, getRefreshTokenTtlSeconds())`; fail → log, không throw/rollback. **Unlock KHÔNG revoke**.
5. **Unlock**: `account_status=ACTIVE` + `failed_login_count=0` + `locked_until=null`.
6. **BR-01** tự khóa → **422 CANNOT_LOCK_SELF**.
7. **BR-02** khóa SYSTEM_ADMIN active cuối → **422 LAST_SYSTEM_ADMIN** (mirror `updateUserStatus` COUNT).
8. **BR-03** lock no-op đã LOCKED → **200**; unlock chưa LOCKED → **409 NOT_LOCKED**.
9. **BR-04** khóa được từ INACTIVE (không chặn).
10. **BR-05** soft-deleted/không tồn tại → **404 USER_NOT_FOUND**.
11. **BR-06** Business Admin department scope (chỉ target, cả lock lẫn unlock); System Admin không scope.
12. **Audit atomic**: `ACCOUNT_LOCK` (WARNING, reason ở `metadataJson`) / `ACCOUNT_UNLOCK` (INFO). `old/new={accountStatus}`, không secret.
13. **Permission TÁCH**: `accounts.user.lock` + `accounts.user.unlock`, cả 2 gán SYSTEM_ADMIN + BUSINESS_ADMIN; seed **KHÔNG execute / KHÔNG runner** (1 file 2 permission).

### ⛔ KHÔNG được làm (áp toàn feature)
- KHÔNG execute seed, KHÔNG chạy migration, KHÔNG commit.
- KHÔNG sửa `createUser`, `getUserDetail`, `updateUser`, `updateUserRoles`, `deleteUser`, `updateUserStatus`, `listUsers`, `resolveDepartmentScope` — chỉ đọc tham chiếu.
- KHÔNG sửa `login.service`/module auth (đã chặn `LOCKED` sẵn; auto-lock là Redis rate-limit — KHÔNG đụng). Chỉ dùng `RedisService.setWithTtl` + `AuthConfigService.getRefreshTokenTtlSeconds()` (đã inject từ UC-10, API công khai).
- KHÔNG thêm constructor param (Redis/AuthConfig đã có — [users.service.ts:81-82](../../../../src/modules/accounts/services/users.service.ts#L81)). KHÔNG sửa `accounts.module.ts`. **KHÔNG thêm cột DB**.
- KHÔNG set INACTIVE (UC-11) / xóa-soft-delete (UC-10); KHÔNG chạm `user_roles` (UC-08)/hồ sơ (UC-09).

### 🔀 Route order (bắt buộc)
- `@Patch(':userId/lock')` và `@Patch(':userId/unlock')` (2 segment) **PHẢI khai báo TRƯỚC** `@Patch(':userId')` (UC-09). Xác minh không collision.

### Format
- `[Txxx]` Task ID tuần tự · `[CREATE]`/`[MODIFY]` + đường dẫn · **DoD** = definition of done.

---

## Phase 1 — DTO

| Dependency | Task |
|---|---|
| — | T001 |

- [ ] **T001** `[CREATE]` `src/modules/accounts/dto/lock-user.dto.ts` — `LockUserDto`.
  - Field `reason?`: `@IsOptional()`, `@IsString()`, `@MaxLength(500)`. Message tiếng Việt.
  - Unlock KHÔNG cần DTO (no body).
  - **DoD**: file compile; đúng 1 field optional `reason`; không field thừa.

---

## Phase 2 — Service `lockUser`

> Thêm method vào `UsersService`. Tái dùng `redisService`/`authConfigService` (đã inject), `resolveDepartmentScope`, `AccountStatus`, `AuditLogEntity`/`AuditLogSeverity`, `UserRoleEntity`, `IsNull`. **KHÔNG** thêm constructor param. **KHÔNG** sửa method khác.

| Dependency | Task |
|---|---|
| T001 → | T002 |
| T002 → | T003 |
| T003 → | T004 |

- [ ] **T002** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — khung `lockUser` + **Phase A validate (READ)**.
  - Chữ ký: `async lockUser(targetUserId: string, reason: string | undefined, actorId: string, clientContext: UserClientContext): Promise<{ id: string; accountStatus: string }>`.
  - A.1 Load target: `findOne(UserEntity, { where: { id: targetUserId, deletedAt: IsNull() } })` → null: `NotFoundException` **USER_NOT_FOUND** (BR-05).
  - A.2 **Scope** (mirror `updateUserStatus` A.2): query active `user_roles` actor → `isSystemAdmin` qua `role.is_system_role`. Nếu không System Admin: `scope=resolveDepartmentScope(actorId)`; `targetUser.departmentId && !scope.has(...)` → `ForbiddenException` **FORBIDDEN** (BR-06).
  - A.3 **BR-01**: `targetUserId === actorId` → `UnprocessableEntityException` **CANNOT_LOCK_SELF**.
  - A.4 **BR-03 no-op**: `targetUser.accountStatus === AccountStatus.LOCKED` → trả `{ id: targetUserId, accountStatus: 'locked' }` ngay, KHÔNG transaction/audit. *(BR-04: INACTIVE KHÔNG bị chặn — vẫn khóa được.)*
  - A.5 **BR-02 last-admin**: nếu target giữ `SYSTEM_ADMIN` active, COUNT admin khác active (mirror `updateUserStatus`/`deleteUser` QueryBuilder: join `ur.role`+`ur.user`, `role_code='SYSTEM_ADMIN'`, `r.isActive`, `ur.isActive`, `expiredAt` NULL/>now, `u.deletedAt IS NULL`, `u.accountStatus=ACTIVE`, `u.id != target`); `0` → `UnprocessableEntityException` **LAST_SYSTEM_ADMIN**.
  - Exception format inline module.
  - **DoD**: method tồn tại, tsc pass; nhánh ném đúng exception/HTTP (403/404/422); no-op trả sớm không WRITE; chưa có WRITE khác.

- [ ] **T003** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — `lockUser` **Phase B transaction (atomic)**.
  - `await this.dataSource.transaction(async (tem) => { ... })`:
    1. `tem.update(UserEntity, targetUserId, { accountStatus: AccountStatus.LOCKED, lockedUntil: null })`. **KHÔNG** `updated_by`; **KHÔNG** chạm `user_roles`/hồ sơ.
    2. Audit atomic: `tem.save(tem.create(AuditLogEntity, { userId: actorId, actionType: 'ACCOUNT_LOCK', entityType: 'users', entityId: targetUserId, severity: AuditLogSeverity.WARNING, oldValueJson: { accountStatus: targetUser.accountStatus }, newValueJson: { accountStatus: AccountStatus.LOCKED }, metadataJson: reason ? { reason } : null, ipAddress: clientContext.ipAddress||null, userAgent: clientContext.userAgent||null, requestId: clientContext.requestId||null }))`. `action_type` hằng số cục bộ.
  - **DoD**: UPDATE LOCKED + `locked_until=null`; audit WARNING + reason ở `metadataJson`, không secret; atomic (rollback nếu lỗi); giữ nguyên `user_roles`; tsc pass.

- [ ] **T004** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — `lockUser` **Phase C post-commit (revoke)** + return.
  - `try { await this.redisService.setWithTtl('auth:user:' + targetUserId + ':invalid_after', String(Date.now()), this.authConfigService.getRefreshTokenTtlSeconds()); } catch (e) { this.logger.error(...) }` — **không throw, không rollback** (mirror `deleteUser`/`updateUserStatus` Phase C).
  - `return { id: targetUserId, accountStatus: AccountStatus.LOCKED }`.
  - **DoD**: revoke chạy sau commit; Redis fail không hỏng luồng; trả `{ id, accountStatus:'locked' }`; tsc pass.

---

## Phase 3 — Service `unlockUser`

| Dependency | Task |
|---|---|
| T004 → | T005 |

- [ ] **T005** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — thêm `unlockUser` (Phase A validate + Phase B transaction, **KHÔNG revoke**).
  - Chữ ký: `async unlockUser(targetUserId: string, actorId: string, clientContext: UserClientContext): Promise<{ id: string; accountStatus: string }>`.
  - **Phase A**:
    1. Load target (deleted_at IS NULL) → `NotFoundException` **USER_NOT_FOUND** (BR-05).
    2. Scope (mirror A.2 lockUser) → `ForbiddenException` **FORBIDDEN** (BR-06).
    3. **BR-03**: `targetUser.accountStatus !== AccountStatus.LOCKED` → `ConflictException` **NOT_LOCKED**.
  - **Phase B transaction**:
    1. `tem.update(UserEntity, targetUserId, { accountStatus: AccountStatus.ACTIVE, failedLoginCount: 0, lockedUntil: null })` (#5; không khôi phục INACTIVE cũ).
    2. Audit atomic: `tem.create(AuditLogEntity, { ..., actionType: 'ACCOUNT_UNLOCK', severity: AuditLogSeverity.INFO, oldValueJson: { accountStatus: AccountStatus.LOCKED }, newValueJson: { accountStatus: AccountStatus.ACTIVE }, ... })` + `tem.save`.
  - **KHÔNG** Phase C (không revoke token). `return { id: targetUserId, accountStatus: AccountStatus.ACTIVE }`.
  - **DoD**: unlock đưa về ACTIVE + reset `failedLoginCount=0`/`lockedUntil=null`; audit INFO; NOT_LOCKED khi chưa khóa; **không** gọi Redis; tsc pass.

---

## Phase 4 — Controller (2 endpoint, ROUTE ORDER)

| Dependency | Task |
|---|---|
| T005 → | T006 |

- [ ] **T006** `[MODIFY]` `src/modules/accounts/controllers/users.controller.ts` — thêm `@Patch(':userId/lock')` + `@Patch(':userId/unlock')`.
  - 🔀 **Khai báo cả 2 method (`lockUser`, `unlockUser`) TRƯỚC method `updateUser` (`@Patch(':userId')` của UC-09)** trong class. Xác minh không route collision.
  - **lock**: `@Patch(':userId/lock')`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('accounts.user.lock')`, Swagger. Param `userId` `ParseUUIDPipe` (`INVALID_USER_ID`). Body `@Body(new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true })) dto: LockUserDto`. Actor + context (`request['user']`, `@Ip()`, `@Headers(...)`). Gọi `this.usersService.lockUser(userId, dto.reason, actorId, ctx)`; trả `{ success:true, message:'Đã khóa tài khoản thành công', data: result }`.
  - **unlock**: `@Patch(':userId/unlock')`, guards + `@RequirePermissions('accounts.user.unlock')`, Swagger. Param `userId` `ParseUUIDPipe`. **Không** `@Body`. Gọi `this.usersService.unlockUser(userId, actorId, ctx)`; trả `{ success:true, message:'Đã mở khóa tài khoản thành công', data: result }`.
  - Import `LockUserDto`.
  - **DoD**: 2 endpoint mount đúng path; **route order** (lock/unlock TRƯỚC `:userId`), không collision; guards + permission đúng từng endpoint; KHÔNG đổi endpoint khác; tsc pass.

---

## Phase 5 — Seed permission (TẠO FILE, KHÔNG CHẠY)

| Dependency | Task |
|---|---|
| — (song song được) | T007 |

- [ ] **T007** `[CREATE]` `src/database/seeds/<timestamp>-SeedUserLockPermissions.ts` — 2 permission `accounts.user.lock` + `accounts.user.unlock`.
  - Mirror [SeedDepartmentReadPermission.ts](../../../../src/database/seeds/20260704000001-SeedDepartmentReadPermission.ts): `queryRunner` + transaction.
  - INSERT 2 permission (`module_code='accounts'`, `action_code='update'`, `is_active=true`, `ON CONFLICT DO NOTHING RETURNING id`): `accounts.user.lock` ("Khóa tài khoản"), `accounts.user.unlock` ("Mở khóa tài khoản").
  - Mỗi permission gán role-set `['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` → INSERT `role_permissions ... ON CONFLICT DO NOTHING`.
  - Idempotent, rollback. Grep xác nhận 2 code chưa tồn tại.
  - ⚠️ KHÔNG thêm runner; KHÔNG execute.
  - **DoD**: file tồn tại, tsc pass; 2 permission, mỗi cái gán đúng 2 role; không lệnh chạy seed nào thực thi.

---

## Phase 6 — Unit test Service (L1–L11, U1–U4)

| Dependency | Task |
|---|---|
| T005 → | T008 |

- [ ] **T008** `[MODIFY]` `src/modules/accounts/services/users.service.spec.ts` — suite `lockUser`/`unlockUser` phủ L1–L11 + U1–U4 (plan §11.1). Mock `dataSource.transaction`/`manager`/`em` (`findOne/find/createQueryBuilder/update/create/save`) + `redisService.setWithTtl` + `authConfigService.getRefreshTokenTtlSeconds` (đã có provider từ UC-10).
  - **lockUser**:
    - L1 Happy (System Admin): `update(...,{accountStatus:'locked', lockedUntil:null})` + audit WARNING (reason ở metadataJson) + revoke `invalid_after`; **KHÔNG** đụng `user_roles`.
    - L2 BR-01 self → 422 CANNOT_LOCK_SELF, không WRITE.
    - L3 BR-02 last SYSTEM_ADMIN (count khác=0) → 422 LAST_SYSTEM_ADMIN, không WRITE.
    - L4 BR-02 còn admin khác (count≥1) → thành công.
    - L5 No-op đã LOCKED → 200, không transaction/update/audit.
    - L6 Lock từ INACTIVE (BR-04) → thành công → LOCKED.
    - L7 Scope 403 (Business Admin ngoài scope) → 403, không WRITE.
    - L8 System Admin bỏ scope (target khác phòng) → thành công.
    - L9 Redis fail post-commit → không throw; status đã LOCKED.
    - L10 Rollback (WRITE lỗi) → reject; revoke KHÔNG chạy.
    - L11 USER_NOT_FOUND → 404.
  - **unlockUser**:
    - U1 Happy → `update(...,{accountStatus:'active', failedLoginCount:0, lockedUntil:null})` + audit INFO; **KHÔNG** revoke.
    - U2 NOT_LOCKED (đang active/inactive) → 409, không WRITE.
    - U3 Scope 403 → 403.
    - U4 USER_NOT_FOUND → 404.
  - **DoD**: các test pass; assert có/không WRITE, nội dung audit (severity+reason+old/new), có/không revoke; coverage nhánh ≥ ENG-01 (80%).

---

## Phase 7 — Controller test (LC1–LC4, UC1–UC2)

| Dependency | Task |
|---|---|
| T006 → | T009 |

- [ ] **T009** `[MODIFY]` `src/modules/accounts/controllers/users.controller.spec.ts` — test `lockUser`/`unlockUser` phủ LC1–LC4 + UC1–UC2 (plan §11.2). Mock `UsersService.lockUser`/`unlockUser`; đọc metadata guard/permission.
  - LC1 lock success: gọi `lockUser(userId, dto.reason, actorId, ctx)`; trả `{ success, message, data:{id,accountStatus} }`.
  - LC2 `userId` không UUID (lock) → 400 `INVALID_USER_ID`.
  - LC3 lock guard metadata = `[JwtAuthGuard, PermissionsGuard]`.
  - LC4 lock permission metadata = `['accounts.user.lock']`.
  - UC1 unlock success: gọi `unlockUser(userId, actorId, ctx)`; trả chuẩn.
  - UC2 unlock permission metadata = `['accounts.user.unlock']`.
  - **DoD**: các test pass; permission đúng từng endpoint; không phá test hiện có.

---

## Phase 8 — Cổng chất lượng

| Dependency | Task |
|---|---|
| T001–T009 → | T010 |

- [ ] **T010** Chạy cổng chất lượng trên file đã đụng (KHÔNG commit).
  1. **tsc**: `npx tsc --noEmit`. Kỳ vọng: 0 lỗi **mới** ở file production (dto/service/controller/seed).
  2. **eslint** file đã tạo/sửa (chạy `--fix` cho prettier): `lock-user.dto.ts`, `users.service.ts`, `users.controller.ts`, seed, 2 spec.
  3. **jest**: `npx jest src/modules/accounts src/modules/auth/guards`.
  4. **Baseline vs mới**: nếu nghi lỗi có sẵn → `git stash` chạy lại lấy baseline, `git stash pop`; chỉ xử lý lỗi **mới** do UC-12. Ghi rõ lỗi baseline vs mới kèm bằng chứng `git stash`.
  - **DoD**: production files **tsc & eslint sạch** (hoặc chỉ lỗi trùng pattern seed/mock baseline đã chứng minh); jest phạm vi trên **pass**; lỗi còn lại chứng minh baseline; **KHÔNG commit**, **KHÔNG chạy seed/migration**.

---

## Bảng truy vết Task ↔ file ↔ ràng buộc

| Task | Loại | File | Ràng buộc/DoD chính |
|---|---|---|---|
| T001 | CREATE | `dto/lock-user.dto.ts` | #1/#3 reason optional |
| T002 | MODIFY | `services/users.service.ts` | lockUser Phase A; BR-01/02/03/04/05/06 |
| T003 | MODIFY | `services/users.service.ts` | lockUser Phase B (#2 LOCKED+locked_until=null, #12 audit LOCK+reason) |
| T004 | MODIFY | `services/users.service.ts` | lockUser Phase C revoke (#4) |
| T005 | MODIFY | `services/users.service.ts` | unlockUser (#5 ACTIVE+reset, #8 NOT_LOCKED, không revoke) |
| T006 | MODIFY | `controllers/users.controller.ts` | #1 2 endpoint; **route order TRƯỚC :userId**; #13 permission tách |
| T007 | CREATE | `database/seeds/<ts>-SeedUserLockPermissions.ts` | #13 2 permission × (SYSTEM_ADMIN+BUSINESS_ADMIN), KHÔNG execute |
| T008 | MODIFY | `services/users.service.spec.ts` | L1–L11, U1–U4 |
| T009 | MODIFY | `controllers/users.controller.spec.ts` | LC1–LC4, UC1–UC2 |
| T010 | — | (các file trên) | tsc + eslint + jest, baseline vs mới |

---

> **Chưa code ở bước này** — tasks.md chờ duyệt trước khi implement. Thực thi tuần tự T001 → T010, tuân thủ "⛔ KHÔNG được làm" (đặc biệt: không sửa login/auth/method người khác, không thêm cột DB, không set INACTIVE/xóa, khai báo route lock/unlock TRƯỚC `:userId`).
