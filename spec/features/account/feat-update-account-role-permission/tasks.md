# Tasks: Cập nhật vai trò tài khoản (Update account roles)

**Feature**: UC-08
**Module**: accounts
**Priority**: P1
**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới tasks.md cho UC-08 theo spec.md + plan.md + 8 quyết định chốt. | Toàn bộ file |

---

## 0. Ràng buộc chốt (áp cho mọi task — không mở lại)

1. Actor **CHỈ SYSTEM_ADMIN** — không department scope, không role-elevation check.
2. Endpoint **`PUT /api/v1/users/:userId/roles`** — replace-set, full `roleIds[]`.
3. `user_roles`: **SOFT-REMOVE** (`is_active=false`+`expired_at=now()`) role bị bỏ; role thêm dùng **REACTIVATE-IF-EXISTS** (update row cũ do UNIQUE `(user_id, role_id)`, INSERT nếu chưa có). KHÔNG hard-delete, KHÔNG INSERT trùng.
4. Permission mới **`accounts.user.update_roles`** gán CHỈ `SYSTEM_ADMIN`; tạo seed nhưng **KHÔNG execute / KHÔNG thêm runner**.
5. **BR-08**: `target.account_status ≠ ACTIVE` → **422 ACCOUNT_INACTIVE**.
6. **BR-01**: `roleIds` rỗng → **400** qua DTO `@ArrayNotEmpty` (KHÔNG 422).
7. **Audit**: ghi **ATOMIC TRONG transaction** bằng `em.create(AuditLogEntity)` (như `createUser`), KHÔNG ghi sau commit. `action_type='ACCOUNT_ROLE_UPDATE'`, `old/new value_json = { roleIds }`.
8. **Response**: TÁI DÙNG `UserRoleResponseDto` có sẵn — KHÔNG tạo response DTO mới.

### ⛔ KHÔNG được làm (áp toàn feature)
- KHÔNG execute seed, KHÔNG chạy migration, KHÔNG commit.
- KHÔNG sửa `role-permissions.*` (thuộc UC khác).
- KHÔNG đổi schema DB (không thêm bảng/field).
- KHÔNG sửa `accounts.module.ts` — trừ khi T-quality xác minh thực sự thiếu provider/entity (hiện đã đủ: `UserEntity/RoleEntity/UserRoleEntity` trong `forFeature`, `AuditLogEntity` dùng qua `EntityManager` trong transaction, `UsersService`+`UsersController` đã đăng ký).

### Format
- `[Txxx]` Task ID tuần tự · `[CREATE]`/`[MODIFY]` + đường dẫn · **DoD** = definition of done.

---

## Phase 1 — DTO

| Dependency | Task |
|---|---|
| — | T001 |

- [ ] **T001** `[CREATE]` `src/modules/accounts/dto/update-user-roles.dto.ts` — tạo `UpdateUserRolesDto`.
  - Nội dung: field `roleIds: string[]` với `@IsArray()`, `@ArrayNotEmpty()` (BR-01 → 400), `@IsUUID('4', { each: true })`. Message tiếng Việt theo phong cách `CreateUserDto` (VD "Danh sách vai trò không được rỗng", "Mỗi vai trò phải là định dạng UUID").
  - **KHÔNG** tạo response DTO (ràng buộc #8 — tái dùng `UserRoleResponseDto`).
  - **DoD**: file compile; class có đúng 1 field `roleIds` với 3 validator trên; không import thừa; không có logic dedup ở DTO (dedup làm ở service).

---

## Phase 2 — Service (`UsersService.updateUserRoles`)

> Bám thuật toán plan §5.2: Phase A validate → Phase B transaction (reactivate-if-exists) → audit trong transaction → trả active roles. Method thêm vào `UsersService` (đã import sẵn `UserEntity`, `RoleEntity`, `UserRoleEntity`, `AuditLogEntity`, `AuditLogSeverity`, `AccountStatus`, `UserRoleResponseDto`, `IsNull`, `In`). **KHÔNG** inject `AuditLogsService` (dùng `em.create(AuditLogEntity)`).

| Dependency | Task |
|---|---|
| T001 → | T002 |
| T002 → | T003 |

- [ ] **T002** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — thêm khung method + **Phase A (validate, ngoài transaction)**.
  - Chữ ký: `async updateUserRoles(targetUserId: string, desiredRoleIds: string[], actorId: string, clientContext: UserClientContext): Promise<{ userId: string; roles: UserRoleResponseDto[] }>`.
  - Bước:
    1. `desired = [...new Set(desiredRoleIds)]` (dedup).
    2. Load target: `findOne(UserEntity, { where: { id: targetUserId, deletedAt: IsNull() } })` → không có: `NotFoundException` code **USER_NOT_FOUND** (BR-07).
    3. **BR-08**: `target.accountStatus !== AccountStatus.ACTIVE` → `UnprocessableEntityException` code **ACCOUNT_INACTIVE**.
    4. Validate từng `roleId ∈ desired` (mirror `createUser` bước 4): không tồn tại → `NotFoundException` **ROLE_NOT_FOUND** (BR-02); `role.isActive === false` → `UnprocessableEntityException` **ROLE_INACTIVE** (BR-03). Giữ map `roleId → role` để đọc `isSystemRole`.
    5. Load current active: `find(UserRoleEntity, { where: { userId: targetUserId, isActive: true } })` → `currentRoleIds: string[]`.
    6. Diff: `toAdd = desired \ currentRoleIds`, `toRemove = currentRoleIds \ desired`.
    7. **BR-04 self-lockout**: nếu `actorId === targetUserId` và tồn tại role ∈ `toRemove` có `is_system_role = true` → `UnprocessableEntityException` code **CANNOT_MODIFY_OWN_ADMIN_ROLE`. (Lấy `is_system_role` các role ∈ `toRemove` qua `find(RoleEntity, { where: { id: In(toRemove) } })`.)
    8. **No-op (A1)**: nếu `toAdd.length === 0 && toRemove.length === 0` → query active roles hiện tại, trả `{ userId, roles }` ngay, KHÔNG mở transaction, KHÔNG ghi audit.
  - Tất cả exception theo format inline module: `{ success:false, message, error:{ code, details } }`.
  - **DoD**: method tồn tại, tsc pass; mọi nhánh validate ném đúng exception/HTTP code (404/422) theo bảng plan §9; chưa có WRITE nào ngoài nhánh no-op read.

- [ ] **T003** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — **Phase B (transaction) + audit atomic + return**.
  - Dùng `await this.dataSource.transaction(async (em) => { ... })` (mirror `createUser`). Trong transaction:
    1. **Soft-remove**: nếu `toRemove.length > 0` → `em.update(UserRoleEntity, { userId: targetUserId, roleId: In(toRemove), isActive: true }, { isActive: false, expiredAt: new Date() })`. (Parameter binding, không nối chuỗi — SEC-03.)
    2. **Reactivate-if-exists / insert** với mỗi `roleId ∈ toAdd`:
       - `existing = await em.findOne(UserRoleEntity, { where: { userId: targetUserId, roleId } })`.
       - Nếu `existing` → set `existing.isActive = true; existing.expiredAt = null; existing.assignedBy = actorId; existing.assignedAt = new Date();` rồi `em.save`.
       - Nếu không → `em.save(em.create(UserRoleEntity, { userId: targetUserId, roleId, assignedBy: actorId, isActive: true }))`.
       - ⇒ Không vi phạm UNIQUE `(user_id, role_id)` (ràng buộc #3).
    3. **Audit ATOMIC (ràng buộc #7)** — trong cùng transaction:
       `em.save(em.create(AuditLogEntity, { userId: actorId, actionType: 'ACCOUNT_ROLE_UPDATE', entityType: 'users', entityId: targetUserId, oldValueJson: { roleIds: currentRoleIds }, newValueJson: { roleIds: desired }, severity: AuditLogSeverity.WARNING, ipAddress: clientContext.ipAddress ?? null, userAgent: clientContext.userAgent ?? null, requestId: clientContext.requestId ?? null }))`.
       - Đặt trong transaction để rollback cùng thay đổi `user_roles` nếu lỗi. Chỉ log `roleIds` — KHÔNG log secret/token (SEC-01).
       - `action_type` để hằng số cục bộ: `const ACTION_TYPE = 'ACCOUNT_ROLE_UPDATE';`.
    4. Sau commit: query lại `find(UserRoleEntity, { where: { userId: targetUserId, isActive: true }, relations: { role: true } })`, map sang `UserRoleResponseDto[]` `{ id: ur.role.id, roleCode: ur.role.roleCode, roleName: ur.role.roleName }`, trả `{ userId: targetUserId, roles }`.
  - **DoD**: happy path đổi role đúng (soft-remove + reactivate/insert), audit ghi trong transaction, trả tập role active mới; rollback nguyên tử khi WRITE lỗi; không hard-delete, không insert trùng; tsc pass.

---

## Phase 3 — Controller (`UsersController`)

| Dependency | Task |
|---|---|
| T003 → | T004 |

- [ ] **T004** `[MODIFY]` `src/modules/accounts/controllers/users.controller.ts` — thêm endpoint `PUT :userId/roles`.
  - Decorators: `@Put(':userId/roles')`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('accounts.user.update_roles')`, `@ApiBearerAuth()`, `@ApiOperation`/`@ApiParam`/`@ApiResponse` (ENG-02 OpenAPI).
  - Param `userId` qua `ParseUUIDPipe` (mirror `getUserDetail`, trả code `INVALID_USER_ID` 400 nếu sai). Body `@Body() dto: UpdateUserRolesDto` (ValidationPipe global whitelist/transform).
  - Lấy actor + client context theo pattern hiện có: `request['user']` → `actorId`, `@Ip() ipAddress`, `@Headers('user-agent')`, `@Headers('x-request-id')`.
  - Gọi `this.usersService.updateUserRoles(userId, dto.roleIds, actorId, { ipAddress, userAgent, requestId })`.
  - Trả `{ success: true, message: 'Cập nhật vai trò tài khoản thành công', data: { userId, roles } }`.
  - **DoD**: endpoint mount đúng path `PUT /api/v1/users/:userId/roles`; guards + permission áp đúng; tsc pass; Swagger doc có mặt; không đổi các endpoint khác trong controller.

---

## Phase 4 — Seed permission (TẠO FILE, KHÔNG CHẠY)

| Dependency | Task |
|---|---|
| — (song song được) | T005 |

- [ ] **T005** `[CREATE]` `src/database/seeds/<timestamp>-SeedUserUpdateRolesPermission.ts` — seed permission `accounts.user.update_roles`.
  - Mirror cấu trúc [SeedDepartmentReadPermission.ts](../../../../src/database/seeds/20260704000001-SeedDepartmentReadPermission.ts): hàm `export async function seedUserUpdateRolesPermission(dataSource)` dùng `queryRunner` + transaction.
  - INSERT permission: `permission_code='accounts.user.update_roles'`, `permission_name='Cập nhật vai trò tài khoản'`, `module_code='accounts'`, `action_code='update'`, `description=...`, `is_active=true`, `ON CONFLICT (permission_code) DO NOTHING RETURNING id`.
  - Gán role-set **CHỈ** `['SYSTEM_ADMIN']` (khác các seed 4-role): với mỗi role lấy `id FROM roles WHERE role_code=$1 AND is_active=true`, INSERT `role_permissions (role_id, permission_id, granted_at) ... ON CONFLICT (role_id, permission_id) DO NOTHING`.
  - Idempotent, có rollback.
  - ⚠️ **KHÔNG** thêm vào runner/index seed tự động; **KHÔNG** execute. Chỉ tạo file, chờ team duyệt & chạy theo quy trình dự án.
  - **DoD**: file tồn tại, tsc pass, đọc rõ ràng; grep xác nhận role-set chỉ chứa `SYSTEM_ADMIN`; KHÔNG có lệnh chạy seed nào được thực thi trong task này.

---

## Phase 5 — Unit test Service (U1–U9)

| Dependency | Task |
|---|---|
| T003 → | T006 |

- [ ] **T006** `[MODIFY]` `src/modules/accounts/services/users.service.spec.ts` — thêm suite cho `updateUserRoles` phủ U1–U9 (plan §10.1). Mock `dataSource.transaction`/`manager`/repository theo pattern spec hiện có.
  - U1 Happy path (add+remove trộn): soft-remove role bỏ (`isActive=false`,`expiredAt` set), reactivate/insert role thêm, `AuditLogEntity` được `em.save` với `oldValueJson.roleIds`/`newValueJson.roleIds` đúng, trả tập role mới.
  - U2 No-op idempotent (`desired == current`): không WRITE `user_roles`, không ghi audit, trả 200 với role hiện tại.
  - U3 USER_NOT_FOUND (không tồn tại/soft-deleted) → NotFound, không WRITE.
  - U4 ACCOUNT_INACTIVE (BR-08) → 422, không WRITE.
  - U5 ROLE_NOT_FOUND (một desired role không tồn tại) → 404, không WRITE.
  - U6 ROLE_INACTIVE (desired role `isActive=false`) → 422, không WRITE.
  - U7 BR-04 self-lockout (`actorId===targetUserId`, `toRemove` chứa role `isSystemRole=true`) → 422 CANNOT_MODIFY_OWN_ADMIN_ROLE.
  - U8 Reactivate: role từng soft-remove được add lại → update row cũ (không INSERT trùng).
  - U9 Rollback: WRITE trong transaction ném lỗi → transaction rollback, không audit "thành công".
  - **DoD**: 9 test pass; assert rõ có/không WRITE và nội dung audit; coverage nhánh business ≥ mục tiêu ENG-01 (80%).

---

## Phase 6 — Controller test (C1–C5)

| Dependency | Task |
|---|---|
| T004 → | T007 |

- [ ] **T007** `[MODIFY]` `src/modules/accounts/controllers/users.controller.spec.ts` — thêm test PUT `:userId/roles` phủ C1–C5 (plan §10.2). Mock `UsersService.updateUserRoles`; guard override như pattern spec hiện có.
  - C1 Success: gọi service đúng tham số `(userId, dto.roleIds, actorId, clientContext)`, trả `{ success:true, message, data:{ userId, roles } }`.
  - C2 `userId` không phải UUID → 400 (ParseUUIDPipe / `INVALID_USER_ID`).
  - C3 `roleIds` rỗng → 400 (DTO `@ArrayNotEmpty`).
  - C4 Thiếu token → 401.
  - C5 Thiếu permission `accounts.user.update_roles` → 403.
  - **DoD**: 5 test pass; xác nhận `@RequirePermissions('accounts.user.update_roles')` được áp; không phá test hiện có của controller.

---

## Phase 7 — Cổng chất lượng

| Dependency | Task |
|---|---|
| T001–T007 → | T008 |

- [ ] **T008** Chạy cổng chất lượng trên các file đã đụng (KHÔNG commit).
  1. **Type-check**: `npx tsc --noEmit` (hoặc script `build`/`typecheck` thực tế của project). Kỳ vọng: 0 lỗi mới.
  2. **Lint** các file đã tạo/sửa:
     `npx eslint src/modules/accounts/dto/update-user-roles.dto.ts src/modules/accounts/services/users.service.ts src/modules/accounts/controllers/users.controller.ts src/database/seeds/<timestamp>-SeedUserUpdateRolesPermission.ts src/modules/accounts/services/users.service.spec.ts src/modules/accounts/controllers/users.controller.spec.ts`
  3. **Test** module liên quan (accounts + auth guard):
     `npx jest src/modules/accounts src/modules/auth/guards` (hoặc script `test` của project, giới hạn path).
  4. **Phân biệt baseline vs lỗi mới**: nếu nghi ngờ lỗi có sẵn trước khi sửa → `git stash` (đưa working tree về trạng thái gốc) chạy lại cùng lệnh để chụp baseline, rồi `git stash pop`; chỉ các lỗi **mới xuất hiện** so với baseline mới cần xử lý. Ghi rõ trong báo cáo lỗi nào baseline / lỗi nào do UC-08.
  - **DoD**: tsc/eslint/jest cho phạm vi trên **pass**; mọi lỗi còn lại được chứng minh là **baseline** (tồn tại trước thay đổi) kèm bằng chứng `git stash`; KHÔNG commit, KHÔNG chạy seed/migration.

---

## Bảng truy vết Task ↔ file ↔ ràng buộc

| Task | Loại | File | Ràng buộc/DoD chính |
|---|---|---|---|
| T001 | CREATE | `dto/update-user-roles.dto.ts` | #6 (400), #8 (không tạo response DTO) |
| T002 | MODIFY | `services/users.service.ts` | Phase A validate; BR-01/02/03/04/07/08 |
| T003 | MODIFY | `services/users.service.ts` | #3 soft-remove+reactivate; #7 audit atomic; #8 reuse `UserRoleResponseDto` |
| T004 | MODIFY | `controllers/users.controller.ts` | #2 endpoint; RBAC guard + `accounts.user.update_roles` |
| T005 | CREATE | `database/seeds/<ts>-SeedUserUpdateRolesPermission.ts` | #4 chỉ SYSTEM_ADMIN, KHÔNG execute |
| T006 | MODIFY | `services/users.service.spec.ts` | U1–U9 |
| T007 | MODIFY | `controllers/users.controller.spec.ts` | C1–C5 |
| T008 | — | (các file trên) | tsc + eslint + jest, baseline vs mới |

---

> **Chưa code ở bước này** — tasks.md chờ duyệt trước khi implement. Khi được duyệt, thực thi tuần tự T001 → T008, tuân thủ mục "⛔ KHÔNG được làm".
