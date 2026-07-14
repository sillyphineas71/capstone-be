# Implementation Plan: Lọc danh sách tài khoản (Filter user accounts)

> Feature ID: UC-14
> Module: accounts
> Created: 2026-07-13
> Status: Draft
> Spec nguồn: [spec.md](./spec.md) (đã duyệt — Phương án B: endpoint quản trị tách riêng)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-13 | Tạo mới plan.md cho UC-14 (Phương án B — endpoint `GET /users/manage` tách riêng, query builder + scope + roles). | Toàn bộ file |

---

## 0. Quyết định đã chốt (ràng buộc — không mở lại)

| # | Quyết định | Ảnh hưởng plan |
| :--- | :--- | :--- |
| 1 | **Phương án B**: endpoint MỚI `GET /api/v1/users/manage` + DTO query mới + service method mới `listUsersForManagement`. KHÔNG đụng `GET /users`/`listUsers` | Code tách hoàn toàn |
| 2 | Filter optional AND: `departmentId`(uuid), `roleId`(uuid), `accountStatus`(enum), `search`(ILIKE fullName/email/employeeCode) | DTO + query builder |
| 3 | Mặc định chỉ `deletedAt IS NULL` (mọi trạng thái); `accountStatus` chỉ lọc khi truyền | Base where |
| 4 | Filter `roleId`: user có `user_roles` **active** trỏ role đó; dùng **query builder** (join/subquery) | Không dùng findAndCount where-object |
| 5 | Department scope: Business Admin scoped (`resolveDepartmentScope`, gồm phòng con); `departmentId` ngoài scope → 403; System Admin không scope | Tái dùng resolveDepartmentScope (đọc) |
| 6 | Sort: `sortBy` allowlist `[fullName,email,employeeCode,accountStatus,createdAt]`; `sortOrder∈[asc,desc]`; default `fullName ASC`; ngoài allowlist → 400 INVALID_SORT_FIELD | DTO `@IsIn` + map column |
| 7 | Phân trang page/limit (default 1/20, min 1, max 100), skip/take, total+totalPages | Tái dùng convention |
| 8 | Output item `{ id, fullName, email, employeeCode, accountStatus, departmentId, roles[] }` (roles = roleCode active) | Output DTO mới + batch roles |
| 9 | Permission MỚI `accounts.user.manage` gán SYSTEM_ADMIN+BUSINESS_ADMIN; seed KHÔNG execute | Seed file |
| 10 | KHÔNG audit/mutation/migration/index | Chỉ READ |

---

## 1. Feature Summary

Thêm **endpoint quản trị mới** `GET /api/v1/users/manage` để admin lọc danh sách tài khoản theo `departmentId` / `roleId` / `accountStatus` (+ kết hợp search keyword), có **sắp xếp** (sortBy/sortOrder allowlist) và **phân trang**. Business Admin bị giới hạn department scope; System Admin không giới hạn. Mặc định trả **mọi trạng thái** (chỉ loại tài khoản đã soft-delete). Endpoint + DTO + service method **hoàn toàn tách riêng** khỏi `GET /users` (autocomplete meetings) — chỉ THÊM code mới, **không đụng** `listUsers`.

---

## 2. Technical Context (đã xác minh)

| Thành phần | Chi tiết | Nguồn |
| :--- | :--- | :--- |
| Route order hiện tại | `@Get()` (545) → `@Get(':userId')` (587) → `@Get(':userId/public-profile')` (655) | [users.controller.ts](../../../../src/modules/accounts/controllers/users.controller.ts) |
| ⚠️ Route collision | `GET /users/manage` (path tĩnh) **PHẢI khai báo TRƯỚC** `@Get(':userId')` — nếu không, `:userId` sẽ nuốt `"manage"` | §6 R1 |
| Department scope | `resolveDepartmentScope(adminUserId): Promise<Set<string>>` — trả dept id + phòng con (depth ≤ 5) | [users.service.ts:1652+](../../../../src/modules/accounts/services/users.service.ts#L1652) (chỉ ĐỌC/tái dùng) |
| System Admin detect | query `user_roles` active + `role.is_system_role` (mirror `updateUserStatus` A.2) | [users.service.ts:810-828](../../../../src/modules/accounts/services/users.service.ts#L810) |
| Filter role | `user_roles`(`user_id`,`role_id`,`is_active`,`expired_at`) + `roles`(`role_code`) | [user-role.entity.ts](../../../../src/modules/accounts/entities/user-role.entity.ts) |
| Enum status | `AccountStatus` active/inactive/locked/pending_reset | [user.entity.ts:21-26](../../../../src/modules/accounts/entities/user.entity.ts#L21) |
| Field user | `department_id`, `employee_code`, `full_name`, `email`, `account_status`, `deleted_at`, `created_at` | [user.entity.ts](../../../../src/modules/accounts/entities/user.entity.ts) |

### 2.1 Constitution / Rule gate
| Gate | Status | Ghi chú |
| :--- | :--- | :--- |
| SEC-02 (auth) | ✅ | Jwt + Permissions guard |
| SEC-03 (validate/no raw SQL) | ✅ | DTO validate; query builder parameter binding; **sortBy allowlist** (chống inject field) |
| ENG-03 (error format) | ✅ | inline `{success,message,error}` |
| DATA-01 | ✅ (N/A) | READ, giữ `deleted_at IS NULL` |
| Scope Gate | ✅ | Chỉ UC-14; không mutation/UC-13 |

---

## 3. Kiến trúc & luồng

```
GET /api/v1/users/manage?departmentId=&roleId=&accountStatus=&search=&sortBy=&sortOrder=&page=&limit=
  │  JwtAuthGuard → 401 ; PermissionsGuard @RequirePermissions('accounts.user.manage') → 403
  ▼
UsersController.listUsersForManagement(query, request)   [endpoint MỚI, TRƯỚC @Get(':userId')]
  │  ValidationPipe(ManageUsersQueryDto)
  ▼
UsersService.listUsersForManagement(query, actorId): { data: ManageUserItemDto[]; total }
  │  A. Xác định System Admin; nếu không → scope = resolveDepartmentScope(actorId)
  │  B. Query builder trên UserEntity 'u': base u.deleted_at IS NULL
  │     + scope (u.department_id IN scope) nếu Business Admin
  │     + filter AND: departmentId, accountStatus, roleId (subquery), search (ILIKE OR group)
  │     + orderBy(map[sortBy], sortOrder) ; skip/take ; getManyAndCount()
  │  C. Batch roles: 1 query user_roles(active)+roles theo danh sách userId của trang → map roleCode[]
  │  D. Map ManageUserItemDto[]
  ▼
Controller: { success, message, data, meta{page,limit,total,totalPages} }
```

> **Tách hoàn toàn**: method mới `listUsersForManagement` — KHÔNG sửa `listUsers`. Endpoint mới `@Get('manage')` — KHÔNG sửa `@Get()`/`@Get(':userId')`.

---

## 4. DTO Plan

### 4.1 `ManageUsersQueryDto` (TẠO MỚI) — `src/modules/accounts/dto/manage-users-query.dto.ts`
```
class ManageUsersQueryDto {
  @IsOptional() @IsUUID('4') departmentId?: string;
  @IsOptional() @IsUUID('4') roleId?: string;
  @IsOptional() @IsIn(['active','inactive','locked','pending_reset']) accountStatus?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(['fullName','email','employeeCode','accountStatus','createdAt']) sortBy?: string = 'fullName';
  @IsOptional() @IsIn(['asc','desc']) sortOrder?: 'asc' | 'desc' = 'asc';
  @IsOptional() @Type(()=>Number) @Min(1) page?: number = 1;
  @IsOptional() @Type(()=>Number) @Min(1) @Max(100) limit?: number = 20;
}
```
- `accountStatus` dùng `@IsIn` literal (không set locked-safety như UC-11 — đây là filter đọc, mọi status hợp lệ).
- `sortBy` `@IsIn` allowlist → giá trị ngoài → 400 (mã hoá thành `INVALID_SORT_FIELD` ở controller/filter nếu cần message riêng).

### 4.2 `ManageUserItemDto` (TẠO MỚI) — `src/modules/accounts/dto/manage-user-item.dto.ts`
```
class ManageUserItemDto {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string | null;
  accountStatus: string;
  departmentId: string | null;
  roles: string[];   // roleCode active
}
```
- **KHÔNG** tái dùng `UserListItemDto` (thuộc endpoint autocomplete — không đụng).

---

## 5. Service Design — `listUsersForManagement`

```
async listUsersForManagement(
  query: ManageUsersQueryDto,
  actorId: string,
): Promise<{ data: ManageUserItemDto[]; total: number }>
```

### 5.1 A — Scope
- Query actor `user_roles` active + `role.is_system_role` → `isSystemAdmin` (mirror `updateUserStatus` A.2, chỉ READ).
- Nếu **không** System Admin: `scope = await this.resolveDepartmentScope(actorId)`.
  - Nếu `query.departmentId` truyền và `!scope.has(query.departmentId)` → `ForbiddenException` **FORBIDDEN**.
  - Nếu `scope` rỗng → trả `{ data: [], total: 0 }` (admin không có phòng ban → không thấy ai). *(Chờ chốt: rỗng vs 403 — đề xuất rỗng.)*

### 5.2 B — Query builder (base + filters)
`const qb = this.dataSource.getRepository(UserEntity).createQueryBuilder('u')`:
1. Base: `.where('u.deleted_at IS NULL')`.
2. Scope (Business Admin): `.andWhere('u.department_id IN (:...scopeIds)', { scopeIds: [...scope] })`.
3. `departmentId`: `.andWhere('u.department_id = :departmentId', {...})`.
4. `accountStatus`: `.andWhere('u.account_status = :accountStatus', {...})`.
5. `roleId` (**subquery — tránh nhân dòng làm sai total/pagination**):
   `.andWhere('u.id IN (SELECT ur.user_id FROM user_roles ur WHERE ur.role_id = :roleId AND ur.is_active = true AND (ur.expired_at IS NULL OR ur.expired_at > now()))', { roleId })`.
   *(Dùng subquery thay vì innerJoin để KHÔNG nhân dòng user → `getManyAndCount` đếm đúng số user.)*
6. `search`: nhóm OR — `.andWhere(new Brackets(qb => qb.where('u.full_name ILIKE :s',{s:'%'+search+'%'}).orWhere('u.email ILIKE :s').orWhere('u.employee_code ILIKE :s')))`.
7. Sort: **map allowlist → cột thật** (không đưa input trực tiếp vào orderBy):
   `const SORT_MAP = { fullName:'u.full_name', email:'u.email', employeeCode:'u.employee_code', accountStatus:'u.account_status', createdAt:'u.created_at' }`; `.orderBy(SORT_MAP[sortBy] ?? 'u.full_name', sortOrder.toUpperCase())`.
8. Pagination: `.skip((page-1)*limit).take(limit)`.
9. `const [users, total] = await qb.getManyAndCount()`.

> **Chọn `select`**: chỉ lấy field cần (`id, full_name, email, employee_code, account_status, department_id`) qua `.select([...])` để nhẹ payload.

### 5.3 C — Batch roles (tránh N+1)
- **KHÔNG** join roles vào qb chính (join collection → nhân dòng → sai `take`/`total`/pagination).
- Sau khi có `users` của trang: lấy `userIds = users.map(u=>u.id)`; **1 query duy nhất**:
  `user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id IN (:...userIds) AND ur.is_active=true AND (ur.expired_at IS NULL OR ur.expired_at>now())` → gom `Map<userId, roleCode[]>`.
- Map vào từng item. ⇒ Tổng cộng **2 query** cho cả trang (users + roles), **không N+1**.
- Nếu `userIds` rỗng → bỏ qua query roles.

### 5.4 D — Map output
`ManageUserItemDto[]`: `{ id, fullName, email, employeeCode, accountStatus, departmentId, roles: rolesMap.get(u.id) ?? [] }`. Return `{ data, total }`.

---

## 6. Business rules & Validation

| Rule | Enforce | Kết quả |
| :--- | :--- | :--- |
| Filter optional, AND | Service (chỉ andWhere khi truyền) | — |
| `sortBy` allowlist (chống inject) | DTO `@IsIn` + service SORT_MAP | 400 INVALID_SORT_FIELD |
| `sortOrder ∈ {asc,desc}` | DTO `@IsIn` | 400 |
| `accountStatus` enum | DTO `@IsIn` | 400 |
| `departmentId`/`roleId` UUID | DTO `@IsUUID` | 400 |
| Business Admin scope; `departmentId` ngoài scope | Service A | 403 FORBIDDEN |
| `deleted_at IS NULL` luôn giữ | Service base | — |
| No raw SQL nối chuỗi | Query builder parameter binding | — |

---

## 7. Error Handling

| error.code | HTTP | Nơi |
| :--- | :--- | :--- |
| (validation) / INVALID_SORT_FIELD | 400 | ValidationPipe (DTO) |
| UNAUTHORIZED | 401 | JwtAuthGuard |
| FORBIDDEN | 403 | PermissionsGuard / scope (Service A) |
| (500) | 500 | filter (không lộ stack trace) |

Body lỗi inline module.

---

## 8. RBAC & Seed

- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('accounts.user.manage')`.
- Seed (MÔ TẢ, KHÔNG chạy): `src/database/seeds/<ts>-SeedUserManagePermission.ts` — permission `accounts.user.manage` (`module_code=accounts`, `action_code=read` hoặc `list`), gán `['SYSTEM_ADMIN','BUSINESS_ADMIN']`, `ON CONFLICT DO NOTHING`. Mirror [SeedDepartmentReadPermission.ts](../../../../src/database/seeds/20260704000001-SeedDepartmentReadPermission.ts). Grep xác nhận code chưa tồn tại. KHÔNG runner, KHÔNG execute.

---

## 9. Test Plan (liệt kê — không code)

### 9.1 Unit — `UsersService.listUsersForManagement` (`users.service.spec.ts`, MODIFY — thêm describe)
Mock `dataSource.getRepository().createQueryBuilder()` (chainable) + query roles. Assert qb nhận đúng điều kiện.

| # | Test | Kỳ vọng |
| :--- | :--- | :--- |
| M1 | filter departmentId | andWhere department_id |
| M2 | filter accountStatus | andWhere account_status |
| M3 | filter roleId | andWhere subquery user_roles active |
| M4 | filter search | Brackets OR fullName/email/employeeCode |
| M5 | tổ hợp nhiều filter (AND) | tất cả andWhere áp dụng |
| M6 | mặc định (không filter) | chỉ deleted_at IS NULL (+ scope nếu BA); mọi trạng thái |
| M7 | sort allowlist map đúng | orderBy = cột map[sortBy], hướng sortOrder |
| M8 | Business Admin — trong scope | andWhere department_id IN scope |
| M9 | Business Admin — departmentId ngoài scope | 403 FORBIDDEN |
| M10 | System Admin — bỏ scope | không andWhere scope |
| M11 | phân trang | skip=(page-1)*limit, take=limit; total từ getManyAndCount |
| M12 | roles map đúng + không N+1 | 1 query roles cho cả trang (userIds), map roleCode[] |
| M13 | trang rỗng (userIds=[]) | không query roles; data=[] |

### 9.2 Controller — `users.controller.spec.ts` (MODIFY)
| # | Test | Kỳ vọng |
| :--- | :--- | :--- |
| MC1 | success | gọi `listUsersForManagement(query, actorId)`; trả `{success,message,data,meta}` |
| MC2 | guard metadata | `[JwtAuthGuard, PermissionsGuard]` |
| MC3 | permission metadata | `['accounts.user.manage']` |
| MC4 | sortBy ngoài allowlist | 400 (DTO `@IsIn`) — test qua validate DTO |

---

## 10. Rủi ro & điểm cần xác minh

| # | Rủi ro | Hành động |
| :--- | :--- | :--- |
| R1 | **Route collision**: `GET /users/manage` bị `@Get(':userId')` nuốt | Khai báo `@Get('manage')` **TRƯỚC** `@Get(':userId')` (dòng 587); xác minh sau khi thêm |
| R2 | **Join roles/role-filter nhân dòng** → sai `total`/pagination | roleId filter = **subquery** (không join); roles output = **batch query riêng** (không join collection vào qb phân trang) |
| R3 | N+1 khi lấy roles | 1 query gom theo `userIds` của trang (§5.3) |
| R4 | sortBy inject | DTO allowlist + service SORT_MAP (không truyền input vào orderBy trực tiếp) |
| R5 | Đụng nhầm `listUsers`/endpoint dùng chung | Chỉ thêm method/endpoint/DTO mới; không sửa listUsers/ListUsersQueryDto/UserListItemDto |
| R6 | Scope rỗng (BA không phòng ban) | Trả `{data:[],total:0}` (đề xuất) — chờ chốt |

---

## 11. Tác động lên code người khác (bảo vệ)

- **KHÔNG đụng** `GET /users` autocomplete: **không** sửa `listUsers`, `ListUsersQueryDto`, `UserListItemDto`, permission `accounts.user.list`.
- **KHÔNG** sửa method khác của `UsersService` (`createUser/getUserDetail/updateUser/updateUserRoles/deleteUser/updateUserStatus/lockUser/unlockUser/listUsers`) — chỉ **đọc** `resolveDepartmentScope`/`collectDepartmentScope` để **tái dùng**.
- **KHÔNG** thêm constructor param (dataSource đã có). **KHÔNG** sửa `accounts.module.ts`.
- **Chỉ THÊM (additive)**: `ManageUsersQueryDto` + `ManageUserItemDto` + `listUsersForManagement` + endpoint `@Get('manage')` + seed + test.
- **Không đụng UC khác**: không làm lại search UC-13 (chỉ tái dùng logic ILIKE trong method mới); không mutation/migration/index/audit.

---

## 12. Checklist file cần TẠO / SỬA

### 🆕 TẠO MỚI
- [ ] `src/modules/accounts/dto/manage-users-query.dto.ts` — `ManageUsersQueryDto` (filter + sort allowlist + pagination)
- [ ] `src/modules/accounts/dto/manage-user-item.dto.ts` — `ManageUserItemDto` (output)
- [ ] `src/database/seeds/<timestamp>-SeedUserManagePermission.ts` — permission `accounts.user.manage` → SYSTEM_ADMIN+BUSINESS_ADMIN (**KHÔNG execute**)

### ✏️ SỬA (additive)
- [ ] `src/modules/accounts/controllers/users.controller.ts` — thêm `@Get('manage')` **TRƯỚC** `@Get(':userId')` + guards + `@RequirePermissions('accounts.user.manage')`. KHÔNG đổi endpoint khác.
- [ ] `src/modules/accounts/services/users.service.ts` — thêm `listUsersForManagement(...)` (query builder + scope + batch roles). KHÔNG sửa `listUsers`/method khác.
- [ ] `src/modules/accounts/services/users.service.spec.ts` — M1–M13.
- [ ] `src/modules/accounts/controllers/users.controller.spec.ts` — MC1–MC4.

### ⛔ KHÔNG đổi
- `listUsers`, `ListUsersQueryDto`, `UserListItemDto`, `GET /users`, permission `accounts.user.list`, `accounts.module.ts`, method khác.
- KHÔNG mutation/migration/index/audit; KHÔNG làm lại search UC-13.

---

> Kết thúc plan. Bước tiếp theo (khi duyệt): tách `tasks.md` theo checklist §12. Chưa code, chưa chạy seed/migration.
