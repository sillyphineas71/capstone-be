# Tasks: Lọc danh sách tài khoản (Filter user accounts)

**Feature**: UC-14
**Module**: accounts
**Priority**: P2
**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới tasks.md cho UC-14 (Phương án B — endpoint `GET /users/manage` tách riêng). | Toàn bộ file |

---

## 0. Ràng buộc chốt (áp cho mọi task — không mở lại)

1. Endpoint **MỚI** `GET /api/v1/users/manage` + `ManageUsersQueryDto` + `ManageUserItemDto` + method `listUsersForManagement`. **KHÔNG đụng** `GET /users`/`listUsers`.
2. Filter optional **AND**: `departmentId`(uuid), `roleId`(uuid), `accountStatus`(enum), `search`(ILIKE `fullName`/`email`/`employeeCode`, nhóm `Brackets`).
3. Mặc định chỉ `deleted_at IS NULL` (mọi trạng thái); `accountStatus` chỉ lọc khi truyền.
4. **`roleId` filter = SUBQUERY** `u.id IN (SELECT ur.user_id FROM user_roles ur WHERE ur.role_id=:roleId AND ur.is_active=true AND (ur.expired_at IS NULL OR ur.expired_at>now()))` — **KHÔNG innerJoin** (tránh nhân dòng làm sai `total`/pagination).
5. **Department scope**: Business Admin scoped (`resolveDepartmentScope` gồm phòng con); `departmentId` ngoài scope → **403 FORBIDDEN**; scope rỗng → `{data:[],total:0}`; System Admin không scope.
6. **Sort**: `sortBy` allowlist `[fullName,email,employeeCode,accountStatus,createdAt]` qua `@IsIn` + **SORT_MAP** ở service (KHÔNG đưa input trực tiếp vào `orderBy`); `sortOrder∈[asc,desc]`; default `fullName ASC`.
7. Phân trang `page/limit` (default 1/20, min 1, **max 100**), `skip`/`take`, trả `total`+`totalPages`.
8. **`roles[]` output = BATCH query riêng** theo `userIds` của trang (1 query, **KHÔNG N+1**, **KHÔNG join collection** vào qb phân trang). Trang rỗng (`userIds=[]`) → bỏ query roles.
9. Permission **MỚI** `accounts.user.manage` gán `SYSTEM_ADMIN`+`BUSINESS_ADMIN`; seed **KHÔNG execute / KHÔNG runner**.
10. KHÔNG audit / mutation / migration / index.

### ⛔ KHÔNG được làm (áp toàn feature)
- KHÔNG execute seed, KHÔNG chạy migration/index, KHÔNG commit.
- KHÔNG sửa `listUsers`, `ListUsersQueryDto`, `UserListItemDto`, `GET /users`, permission `accounts.user.list`.
- KHÔNG sửa method khác của `UsersService` (`createUser/getUserDetail/updateUser/updateUserRoles/deleteUser/updateUserStatus/lockUser/unlockUser`) — chỉ **đọc** `resolveDepartmentScope`/`collectDepartmentScope` để tái dùng.
- KHÔNG sửa `accounts.module.ts` (dataSource đã có), KHÔNG thêm constructor param.
- KHÔNG làm lại search UC-13 (chỉ tái dùng logic ILIKE trong method mới); KHÔNG mutation.

### 🔀 Route order (bắt buộc)
- `@Get('manage')` (path tĩnh) **PHẢI khai báo TRƯỚC** `@Get(':userId')` (getUserDetail, ~dòng 587) — nếu không `:userId` nuốt `"manage"`. Xác minh không collision.

### Format
- `[Txxx]` Task ID tuần tự · `[CREATE]`/`[MODIFY]` + đường dẫn · **DoD** = definition of done.

---

## Phase 1 — DTO

| Dependency | Task |
|---|---|
| — | T001, T002 |

- [ ] **T001** `[CREATE]` `src/modules/accounts/dto/manage-users-query.dto.ts` — `ManageUsersQueryDto`.
  - Fields (tất cả optional):
    - `departmentId?` — `@IsOptional() @IsUUID('4')`
    - `roleId?` — `@IsOptional() @IsUUID('4')`
    - `accountStatus?` — `@IsOptional() @IsIn(['active','inactive','locked','pending_reset'])`
    - `search?` — `@IsOptional() @IsString()`
    - `sortBy?` — `@IsOptional() @IsIn(['fullName','email','employeeCode','accountStatus','createdAt'])` (default `'fullName'`)
    - `sortOrder?` — `@IsOptional() @IsIn(['asc','desc'])` (default `'asc'`)
    - `page?` — `@IsOptional() @Type(()=>Number) @Min(1)` (default 1)
    - `limit?` — `@IsOptional() @Type(()=>Number) @Min(1) @Max(100)` (default 20)
  - **DoD**: file compile; đúng các validator/allowlist; message tiếng Việt; không field thừa.

- [ ] **T002** `[CREATE]` `src/modules/accounts/dto/manage-user-item.dto.ts` — `ManageUserItemDto`.
  - Fields: `id: string; fullName: string; email: string; employeeCode: string | null; accountStatus: string; departmentId: string | null; roles: string[];` (+ `@ApiProperty`).
  - **KHÔNG** tái dùng/sửa `UserListItemDto`.
  - **DoD**: file compile; 7 field như trên.

---

## Phase 2 — Service `listUsersForManagement`

> Thêm method vào `UsersService`. Import `Brackets` từ `typeorm` nếu chưa có. Tái dùng `resolveDepartmentScope` (đọc). **KHÔNG** sửa `listUsers`/method khác. **KHÔNG** thêm constructor param.

| Dependency | Task |
|---|---|
| T001, T002 → | T003 |
| T003 → | T004 |

- [ ] **T003** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — khung method + scope + query builder (filter/sort/pagination).
  - Chữ ký: `async listUsersForManagement(query: ManageUsersQueryDto, actorId: string): Promise<{ data: ManageUserItemDto[]; total: number }>`.
  - **A. Scope**: query actor `user_roles` active + `role.is_system_role` → `isSystemAdmin` (mirror `updateUserStatus` A.2). Nếu không System Admin:
    - `scope = await this.resolveDepartmentScope(actorId)`.
    - Nếu `query.departmentId` truyền và `!scope.has(query.departmentId)` → `ForbiddenException` **FORBIDDEN** (BR §5).
    - Nếu `scope.size === 0` → trả `{ data: [], total: 0 }` ngay (không query).
  - **B. Query builder** `getRepository(UserEntity).createQueryBuilder('u')`:
    1. `.where('u.deleted_at IS NULL')`.
    2. Scope (Business Admin): `.andWhere('u.department_id IN (:...scopeIds)', { scopeIds: [...scope] })`.
    3. `departmentId`: `.andWhere('u.department_id = :departmentId', { departmentId })`.
    4. `accountStatus`: `.andWhere('u.account_status = :accountStatus', { accountStatus })`.
    5. **`roleId` = SUBQUERY** (#4): `.andWhere('u.id IN (SELECT ur.user_id FROM user_roles ur WHERE ur.role_id = :roleId AND ur.is_active = true AND (ur.expired_at IS NULL OR ur.expired_at > now()))', { roleId })`. **KHÔNG** innerJoin.
    6. `search`: `.andWhere(new Brackets(qb => qb.where('u.full_name ILIKE :s', { s: \`%${search}%\` }).orWhere('u.email ILIKE :s').orWhere('u.employee_code ILIKE :s')))`.
    7. **Sort SORT_MAP** (#6): `const SORT_MAP = { fullName:'u.full_name', email:'u.email', employeeCode:'u.employee_code', accountStatus:'u.account_status', createdAt:'u.created_at' }`; `.orderBy(SORT_MAP[query.sortBy ?? 'fullName'], (query.sortOrder ?? 'asc').toUpperCase() as 'ASC'|'DESC')`. **KHÔNG** đưa `query.sortBy` trực tiếp vào orderBy.
    8. `.select(['u.id','u.fullName','u.email','u.employeeCode','u.accountStatus','u.departmentId'])`.
    9. `.skip((page-1)*limit).take(limit)`.
    10. `const [users, total] = await qb.getManyAndCount()`.
  - **DoD**: method tồn tại, tsc pass; filter chỉ áp khi truyền; roleId dùng subquery (không join); sort qua SORT_MAP; scope 403 đúng; chưa map roles (T004); không WRITE.

- [ ] **T004** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — batch roles + map output.
  - **C. Batch roles (#8, tránh N+1)**: `const userIds = users.map(u=>u.id)`. Nếu `userIds.length === 0` → `rolesMap = new Map()` (bỏ query). Ngược lại **1 query**:
    `user_roles ur` join `roles r` (`r.id=ur.role_id`) WHERE `ur.user_id IN (:...userIds) AND ur.is_active = true AND (ur.expired_at IS NULL OR ur.expired_at > now())` → gom `Map<userId, roleCode[]>` (qua query builder hoặc `find` + relations `role`).
  - **D. Map** `ManageUserItemDto[]`: `{ id, fullName, email, employeeCode, accountStatus, departmentId, roles: rolesMap.get(u.id) ?? [] }`. Return `{ data, total }`.
  - **DoD**: đúng 1 query roles cho cả trang (không N+1, không join collection vào qb phân trang); trang rỗng không query roles; output đủ 7 field + roles[] active; tsc pass.

---

## Phase 3 — Controller (route order)

| Dependency | Task |
|---|---|
| T004 → | T005 |

- [ ] **T005** `[MODIFY]` `src/modules/accounts/controllers/users.controller.ts` — thêm `@Get('manage')`.
  - 🔀 **Khai báo method `listUsersForManagement` (`@Get('manage')`) TRƯỚC method `getUserDetail` (`@Get(':userId')`, ~dòng 587)**. Xác minh không route collision.
  - Decorators: `@Get('manage')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('accounts.user.manage')`, `@ApiBearerAuth()`, Swagger (`@ApiOperation`/`@ApiResponse`).
  - `@Query() query: ManageUsersQueryDto`; lấy actor: `request['user'] → actorId` (hoặc `@CurrentUser()` nếu pattern controller dùng — hiện dùng `request['user']`).
  - Gọi `const { data, total } = await this.usersService.listUsersForManagement(query, actorId)`.
  - Trả `{ success: true, message: 'Lấy danh sách tài khoản thành công', data, meta: { page, limit, total, totalPages: Math.ceil(total/limit) } }` (mirror cách listUsers tính meta ở controller).
  - Import `ManageUsersQueryDto`.
  - **DoD**: endpoint mount `GET /api/v1/users/manage`; **route order** (trước `:userId`) — không bị nuốt; guards + permission đúng; KHÔNG đổi endpoint khác; tsc pass.

---

## Phase 4 — Seed permission (TẠO FILE, KHÔNG CHẠY)

| Dependency | Task |
|---|---|
| — (song song được) | T006 |

- [ ] **T006** `[CREATE]` `src/database/seeds/<timestamp>-SeedUserManagePermission.ts` — permission `accounts.user.manage`.
  - Mirror [SeedDepartmentReadPermission.ts](../../../../src/database/seeds/20260704000001-SeedDepartmentReadPermission.ts): `queryRunner` + transaction.
  - INSERT permission `permission_code='accounts.user.manage'`, `permission_name='Quản trị/lọc danh sách tài khoản'`, `module_code='accounts'`, `action_code='read'`, `is_active=true`, `ON CONFLICT DO NOTHING RETURNING id`.
  - Gán role-set `['SYSTEM_ADMIN','BUSINESS_ADMIN']` → INSERT `role_permissions ... ON CONFLICT DO NOTHING`.
  - Idempotent, rollback. Grep xác nhận code chưa tồn tại.
  - ⚠️ KHÔNG thêm runner; KHÔNG execute.
  - **DoD**: file tồn tại, tsc pass; role-set đúng 2 role; không lệnh chạy seed nào thực thi.

---

## Phase 5 — Unit test Service (M1–M13)

| Dependency | Task |
|---|---|
| T004 → | T007 |

- [ ] **T007** `[MODIFY]` `src/modules/accounts/services/users.service.spec.ts` — suite `listUsersForManagement` phủ M1–M13 (plan §9.1). Mock `dataSource.getRepository().createQueryBuilder()` trả **chainable qb** (`where/andWhere/orderBy/select/skip/take/getManyAndCount` return this / resolved); mock query roles batch; mock `resolveDepartmentScope`/actor roles cho scope.
  - M1 filter `departmentId` → `andWhere` department_id.
  - M2 filter `accountStatus` → `andWhere` account_status.
  - M3 filter `roleId` → `andWhere` **subquery** `user_roles` (assert chuỗi chứa `SELECT ur.user_id` + `is_active`); KHÔNG innerJoin.
  - M4 filter `search` → `andWhere(Brackets)` OR fullName/email/employeeCode.
  - M5 tổ hợp nhiều filter → tất cả `andWhere` áp dụng.
  - M6 mặc định (không filter) → chỉ `deleted_at IS NULL` (+ scope nếu BA); mọi trạng thái (không andWhere account_status).
  - M7 sort allowlist → `orderBy` = `SORT_MAP[sortBy]` (cột thật), hướng `sortOrder`.
  - M8 Business Admin — trong scope → `andWhere` department_id IN scope.
  - M9 Business Admin — `departmentId` ngoài scope → **403 FORBIDDEN**, không query.
  - M10 System Admin → **không** `andWhere` scope.
  - M11 phân trang → `skip=(page-1)*limit`, `take=limit`; `total` từ `getManyAndCount`.
  - M12 roles map + **không N+1** → đúng **1** query roles cho `userIds` của trang; map `roleCode[]` đúng theo user.
  - M13 trang rỗng (`getManyAndCount` trả `[[],0]`) → **không** query roles; `data=[]`.
  - **DoD**: M1–M13 pass; assert subquery roleId (M3), batch roles 1 query (M12), scope 403 (M9)/bypass (M10), sort map (M7); coverage nhánh ≥ ENG-01.

---

## Phase 6 — Controller test (MC1–MC4)

| Dependency | Task |
|---|---|
| T005 → | T008 |

- [ ] **T008** `[MODIFY]` `src/modules/accounts/controllers/users.controller.spec.ts` — test `listUsersForManagement` phủ MC1–MC4 (plan §9.2). Mock `UsersService.listUsersForManagement`; đọc metadata guard/permission.
  - MC1 success: gọi `listUsersForManagement(query, actorId)`; trả `{ success, message, data, meta{page,limit,total,totalPages} }`.
  - MC2 guard metadata = `[JwtAuthGuard, PermissionsGuard]`.
  - MC3 permission metadata = `['accounts.user.manage']`.
  - MC4 `sortBy` ngoài allowlist → 400 (test qua `validate()` `ManageUsersQueryDto`).
  - **DoD**: 4 test pass; permission đúng; không phá test hiện có.

---

## Phase 7 — Cổng chất lượng

| Dependency | Task |
|---|---|
| T001–T008 → | T009 |

- [ ] **T009** Chạy cổng chất lượng trên file đã đụng (KHÔNG commit).
  1. **tsc**: `npx tsc --noEmit`. Kỳ vọng: 0 lỗi **mới** ở file production (2 DTO / service / controller / seed).
  2. **eslint** file đã tạo/sửa (chạy `--fix` cho prettier): `manage-users-query.dto.ts`, `manage-user-item.dto.ts`, `users.service.ts`, `users.controller.ts`, seed, 2 spec.
  3. **jest**: `npx jest src/modules/accounts src/modules/auth/guards`.
  4. **Baseline vs mới**: nếu nghi lỗi có sẵn → `git stash` chạy lại lấy baseline, `git stash pop`; chỉ xử lý lỗi **mới** do UC-14. Ghi rõ lỗi baseline vs mới kèm bằng chứng `git stash`.
  - **DoD**: production files **tsc & eslint sạch** (hoặc chỉ lỗi trùng pattern seed/mock baseline đã chứng minh); jest phạm vi trên **pass** (gồm test `listUsers` cũ — không hồi quy); lỗi còn lại chứng minh baseline; **KHÔNG commit**, **KHÔNG chạy seed/migration**.

---

## Bảng truy vết Task ↔ file ↔ ràng buộc

| Task | Loại | File | Ràng buộc/DoD chính |
|---|---|---|---|
| T001 | CREATE | `dto/manage-users-query.dto.ts` | #2/#6 filter + sort allowlist + pagination |
| T002 | CREATE | `dto/manage-user-item.dto.ts` | #8 output 7 field + roles[] |
| T003 | MODIFY | `services/users.service.ts` | #4 subquery roleId, #5 scope, #6 SORT_MAP, #3 base, #2 filters |
| T004 | MODIFY | `services/users.service.ts` | #8 batch roles không N+1, map output |
| T005 | MODIFY | `controllers/users.controller.ts` | #1 endpoint; **route order TRƯỚC :userId**; #9 permission |
| T006 | CREATE | `database/seeds/<ts>-SeedUserManagePermission.ts` | #9 SYSTEM_ADMIN+BUSINESS_ADMIN, KHÔNG execute |
| T007 | MODIFY | `services/users.service.spec.ts` | M1–M13 |
| T008 | MODIFY | `controllers/users.controller.spec.ts` | MC1–MC4 |
| T009 | — | (các file trên) | tsc + eslint + jest, baseline vs mới |

---

> **Chưa code ở bước này** — tasks.md chờ duyệt trước khi implement. Thực thi tuần tự T001 → T009, tuân thủ "⛔ KHÔNG được làm" (đặc biệt: không đụng listUsers/GET /users/method khác/module; `@Get('manage')` TRƯỚC `:userId`; roleId subquery; roles batch không N+1; sortBy qua SORT_MAP).
