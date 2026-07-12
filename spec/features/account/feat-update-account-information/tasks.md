# Tasks: Cập nhật thông tin tài khoản nhân sự (Update account information)

**Feature**: UC-09
**Module**: accounts
**Priority**: P1
**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới tasks.md cho UC-09 theo spec.md + plan.md + 12 quyết định chốt. | Toàn bộ file |

---

## 0. Ràng buộc chốt (áp cho mọi task — không mở lại)

1. Actor **SYSTEM_ADMIN** (không scope) + **BUSINESS_ADMIN** (department scope; ngoài scope → 403).
2. Endpoint **`PATCH /api/v1/users/:userId`** (partial update).
3. Tập field **ĐÚNG 5**: `fullName`, `employeeCode`, `phoneNumber`, `positionTitle`, `departmentId`. **BỎ** `directManagerId`.
4. **EMAIL BẤT BIẾN** — không có `email` trong DTO/update, không chạm `username`, không check email-unique.
5. KHÔNG đụng `user_roles`/role (UC-08), `account_status` (UC-11), password/avatar/username, field hệ thống. **`whitelist + forbidNonWhitelisted`** → field cấm trả **400**.
6. Đổi `departmentId`: department mới phải (a) tồn tại & `is_active=true`, (b) trong scope Business Admin (System Admin bỏ qua b).
7. Empty update → **400 EMPTY_UPDATE** (enforce ở service).
8. `employeeCode` UNIQUE loại self (`id != target`, `deletedAt IS NULL`), chỉ check khi có mặt & khác giá trị cũ.
9. Audit **ATOMIC trong transaction** (`em.create(AuditLogEntity)`), `action_type='ACCOUNT_UPDATE'`, `old/new value_json` = **CHỈ field đã đổi** (diff), không dump toàn user, không log secret.
10. Permission mới **`accounts.user.update`** gán `SYSTEM_ADMIN` + `BUSINESS_ADMIN`; tạo seed nhưng **KHÔNG execute / KHÔNG thêm runner**.
11. Response **tái dùng `UserDetailResponseDto`**.
12. Lắp `UserDetailResponseDto` bằng **RE-QUERY INLINE** trong `updateUser` — **KHÔNG** tách helper, **KHÔNG** sửa `getUserDetail`. Chấp nhận trùng lặp map nhỏ để đổi lấy an toàn.

### ⛔ KHÔNG được làm (áp toàn feature)
- KHÔNG execute seed, KHÔNG chạy migration, KHÔNG commit.
- KHÔNG sửa `getUserDetail` (chỉ đọc tham chiếu cách map [users.service.ts:608-637](../../../../src/modules/accounts/services/users.service.ts#L608-L637)).
- KHÔNG sửa `role-permissions.*` / `user_roles` / `account_status` / password / email / username / avatar.
- KHÔNG đổi schema DB. KHÔNG set `updated_by` (cột không tồn tại trong `user.entity.ts`).
- KHÔNG sửa `accounts.module.ts` — trừ khi xác minh thực sự thiếu provider/entity (hiện đã đủ: `UserEntity/DepartmentEntity/UserRoleEntity/RoleEntity/FaceProfileEntity` trong `forFeature`, `AuditLogEntity` dùng qua `EntityManager` trong transaction, `UsersService`+`UsersController` đã đăng ký).

### Format
- `[Txxx]` Task ID tuần tự · `[CREATE]`/`[MODIFY]` + đường dẫn · **DoD** = definition of done.

---

## Phase 1 — DTO

| Dependency | Task |
|---|---|
| — | T001 |

- [ ] **T001** `[CREATE]` `src/modules/accounts/dto/update-user.dto.ts` — `UpdateUserDto` (partial).
  - 5 field **optional** (mirror validator/`@Transform(trim)` của `CreateUserDto`):
    - `fullName?` — `@IsOptional() @IsString() @MaxLength(255)`
    - `employeeCode?` — `@IsOptional() @IsString() @MaxLength(50)`
    - `phoneNumber?` — `@IsOptional() @IsString() @Matches(/^[\d\s+\-()]*$/) @MaxLength(30)`
    - `positionTitle?` — `@IsOptional() @IsString() @MaxLength(150)`
    - `departmentId?` — `@IsOptional() @IsUUID('4')`
  - **KHÔNG** có `email`, `directManagerId`, `roleIds`, `accountStatus`, `username`, `avatarUrl` (#3/#4/#5).
  - **DoD**: file compile; đúng 5 field như trên; message tiếng Việt theo phong cách `CreateUserDto`; không enforce empty-update ở DTO (làm ở service — T002).

---

## Phase 2 — Service (`UsersService.updateUser`)

> Bám thuật toán plan §5.2/§5.3. Thêm method vào `UsersService` (đã import sẵn `UserEntity`, `DepartmentEntity`, `RoleEntity`, `UserRoleEntity`, `FaceProfileEntity`, `AuditLogEntity`, `AuditLogSeverity`, `AccountStatus`, `UserDetailResponseDto` + nested DTO, `IsNull`). **KHÔNG** inject `AuditLogsService`. **KHÔNG** sửa `getUserDetail`.

| Dependency | Task |
|---|---|
| T001 → | T002 |
| T002 → | T003 |

- [ ] **T002** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — thêm import `Not` + khung method + **Phase A (validate, ngoài transaction)**.
  - Thêm `Not` vào import `typeorm` (hiện: `DataSource, ILike, IsNull, In` → `... , Not`).
  - Chữ ký: `async updateUser(targetUserId: string, dto: UpdateUserDto, actorId: string, clientContext: UserClientContext): Promise<UserDetailResponseDto>`.
  - Bước:
    1. **A.1 Empty update (#7)**: nếu `fullName/employeeCode/phoneNumber/positionTitle/departmentId` đều `undefined` → `BadRequestException` code **EMPTY_UPDATE**.
    2. **A.2 Load target**: `findOne(UserEntity, { where: { id: targetUserId, deletedAt: IsNull() }, relations: { department: true } })` → không có: `NotFoundException` **USER_NOT_FOUND**.
    3. **A.3 Xác định System Admin & scope target**: query active `user_roles` + `role.is_system_role` của `actorId` (mirror `getUserDetail` bước 2). Nếu **không** System Admin: `scope = await this.resolveDepartmentScope(actorId)`; nếu `targetUser.departmentId ∉ scope` → `ForbiddenException` **FORBIDDEN** (BR-10 target).
    4. **A.4 Per-field validate** (chỉ field có mặt & khác giá trị cũ, `.trim()` string trước so sánh):
       - `employeeCode` (#8): `findOne(UserEntity, { where: { employeeCode: <trim>, deletedAt: IsNull(), id: Not(targetUserId) } })` tồn tại → `ConflictException` **ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS**.
       - `departmentId` (#6): `findOne(DepartmentEntity, { where: { id, deletedAt: IsNull() } })` không có → `NotFoundException` **DEPARTMENT_NOT_FOUND**; `!isActive` → `UnprocessableEntityException` **DEPARTMENT_INACTIVE_OR_DELETED**; nếu không System Admin & department mới `∉ scope` → `ForbiddenException` **FORBIDDEN** (BR-10 department mới).
    5. **A.5 Diff**: dựng `changed = {}` gồm field có mặt và khác giá trị cũ (sau trim). Trả kèm `oldValues`/`newValues` để audit.
    6. **A.6 No-op (A1)**: nếu `changed` rỗng → re-query + map `UserDetailResponseDto` (như T003 bước map) và trả về ngay, KHÔNG mở transaction, KHÔNG audit.
  - Exception theo format inline module: `{ success:false, message, error:{ code, details } }`.
  - **DoD**: method tồn tại, tsc pass; mọi nhánh validate ném đúng exception/HTTP code (400/403/404/409/422); chưa có WRITE nào (trừ nhánh no-op chỉ READ).

- [ ] **T003** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — **Phase B (transaction) + audit atomic + re-query inline map**.
  - `await this.dataSource.transaction(async (tem) => { ... })`:
    1. **B.1 UPDATE**: `tem.update(UserEntity, targetUserId, changed)` (chỉ field đã đổi). **KHÔNG** set `updated_by` (cột không tồn tại); `@UpdateDateColumn` tự lo `updated_at`.
    2. **B.2 Audit atomic (#9)**: `tem.save(tem.create(AuditLogEntity, { userId: actorId, actionType: 'ACCOUNT_UPDATE', entityType: 'users', entityId: targetUserId, severity: AuditLogSeverity.INFO, oldValueJson: <oldValues diff>, newValueJson: <newValues diff>, ipAddress: clientContext.ipAddress || null, userAgent: clientContext.userAgent || null, requestId: clientContext.requestId || null }))`. `action_type` để hằng số cục bộ `const ACTION_TYPE = 'ACCOUNT_UPDATE'`. Chỉ log field đã đổi — KHÔNG dump toàn user, KHÔNG secret.
  - **Re-query INLINE map (#11/#12)** — sau commit, dùng `this.dataSource.manager`, mô phỏng cách `getUserDetail` lắp DTO (KHÔNG gọi `getUserDetail`, KHÔNG tách helper):
    - `findOne(UserEntity, { where: { id: targetUserId, deletedAt: IsNull() }, relations: { department: true } })`.
    - `find(UserRoleEntity, { where: { userId: targetUserId, isActive: true }, relations: { role: true } })` → `roles[]`.
    - direct manager (nếu `directManagerId`): `findOne(UserEntity, { where: { id: directManagerId }, select: { id, fullName } })`.
    - face profile existence: `findOne(FaceProfileEntity, { where: { userId: targetUserId } })`.
    - Assemble `UserDetailResponseDto` đúng 16 field như [users.service.ts:618-637](../../../../src/modules/accounts/services/users.service.ts#L618-L637) (bao gồm `email`, `avatarUrl`, `accountStatus`, `employmentStatus`, `mustChangePassword`, `lastLoginAt`, `roles`, `hasFaceProfile`, `createdAt` — đọc read-only, KHÔNG chỉnh).
  - **DoD**: happy path UPDATE đúng field đã đổi, audit ghi trong transaction với old/new diff, trả `UserDetailResponseDto` đầy đủ; rollback nguyên tử khi WRITE lỗi; không set `updated_by`; tsc pass.

---

## Phase 3 — Controller (`UsersController`)

| Dependency | Task |
|---|---|
| T003 → | T004 |

- [ ] **T004** `[MODIFY]` `src/modules/accounts/controllers/users.controller.ts` — thêm endpoint `PATCH :userId`.
  - Decorators: `@Patch(':userId')`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('accounts.user.update')`, `@ApiBearerAuth()`, `@ApiOperation`/`@ApiParam`/`@ApiBody`/`@ApiResponse` (ENG-02).
  - Param `userId` qua `ParseUUIDPipe` (mirror `getUserDetail`, code `INVALID_USER_ID` 400). Body `@Body(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })) dto: UpdateUserDto` (mirror `createUser` — field cấm → 400).
  - Lấy actor + context theo pattern hiện có: `request['user']` → `actorId`, `@Ip()`, `@Headers('user-agent')`, `@Headers('x-request-id')`.
  - Gọi `this.usersService.updateUser(userId, dto, actorId, { ipAddress, userAgent, requestId })`.
  - Trả `{ success: true, message: 'Cập nhật thông tin tài khoản thành công', data: <UserDetailResponseDto> }`.
  - Import `UpdateUserDto` + `UserDetailResponseDto` (nếu cần cho kiểu trả về).
  - **DoD**: endpoint mount `PATCH /api/v1/users/:userId`; guards + permission áp đúng; tsc pass; Swagger doc có mặt; không đổi các endpoint khác.

---

## Phase 4 — Seed permission (TẠO FILE, KHÔNG CHẠY)

| Dependency | Task |
|---|---|
| — (song song được) | T005 |

- [ ] **T005** `[CREATE]` `src/database/seeds/<timestamp>-SeedUserUpdatePermission.ts` — seed permission `accounts.user.update`.
  - Mirror [SeedDepartmentReadPermission.ts](../../../../src/database/seeds/20260704000001-SeedDepartmentReadPermission.ts): `export async function seedUserUpdatePermission(dataSource)` dùng `queryRunner` + transaction.
  - INSERT permission: `permission_code='accounts.user.update'`, `permission_name='Cập nhật thông tin tài khoản'`, `module_code='accounts'`, `action_code='update'`, `is_active=true`, `ON CONFLICT (permission_code) DO NOTHING RETURNING id`.
  - Gán role-set `['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` (#10): với mỗi role `SELECT id FROM roles WHERE role_code=$1 AND is_active=true`, INSERT `role_permissions ... ON CONFLICT (role_id, permission_id) DO NOTHING`.
  - Idempotent, có rollback.
  - Trước khi tạo: grep xác nhận `accounts.user.update` **chưa tồn tại** (R6 plan).
  - ⚠️ **KHÔNG** thêm vào runner/index; **KHÔNG** execute.
  - **DoD**: file tồn tại, tsc pass; role-set đúng 2 role; không có lệnh chạy seed nào được thực thi.

---

## Phase 5 — Unit test Service (U1–U12)

| Dependency | Task |
|---|---|
| T003 → | T006 |

- [ ] **T006** `[MODIFY]` `src/modules/accounts/services/users.service.spec.ts` — thêm suite `updateUser` phủ U1–U12 (plan §10.1). Mock `dataSource.transaction`/`manager`/`em` theo pattern spec hiện có (`findOne/find/create/save`; bổ sung `em.update` cho B.1).
  - U1 Happy path — 1 field (`phoneNumber`): UPDATE đúng field, audit diff chỉ chứa field đó, trả `UserDetailResponseDto`.
  - U2 Happy path — nhiều field (`fullName`+`positionTitle`+`departmentId`): UPDATE + audit diff nhiều field.
  - U3 No-op (A1) — field gửi trùng giá trị cũ: không WRITE, không audit, 200.
  - U4 EMPTY_UPDATE — không field nào → 400, không WRITE.
  - U5 employeeCode unique loại-self — trùng user khác → 409, không WRITE.
  - U5b employeeCode = giá trị cũ của **chính mình** → KHÔNG lỗi (bị loại khỏi diff/không check unique).
  - U6 department không tồn tại → 404 DEPARTMENT_NOT_FOUND.
  - U7 department inactive → 422 DEPARTMENT_INACTIVE_OR_DELETED.
  - U8 Business Admin — target user ngoài scope → 403, không WRITE.
  - U9 Business Admin — department **mới** ngoài scope → 403.
  - U10 System Admin — bỏ qua scope (target/department khác phòng) → thành công.
  - U11 USER_NOT_FOUND (không tồn tại/soft-deleted) → 404.
  - U12 Rollback — WRITE trong transaction lỗi → reject, không audit "thành công".
  - **DoD**: 13 test pass; assert rõ có/không WRITE + nội dung audit diff; coverage nhánh business ≥ ENG-01 (80%).

---

## Phase 6 — Controller test (C1–C5)

| Dependency | Task |
|---|---|
| T004 → | T007 |

- [ ] **T007** `[MODIFY]` `src/modules/accounts/controllers/users.controller.spec.ts` — thêm test `PATCH :userId` phủ C1–C5 (plan §10.2). Mock `UsersService.updateUser`; đọc metadata guard/permission như pattern hiện có (`GUARDS_METADATA`, `PERMISSIONS_KEY`).
  - C1 Success: gọi service đúng `(userId, dto, actorId, clientContext)`; trả `{ success:true, message, data }`.
  - C2 `userId` không UUID → 400 (ParseUUIDPipe / `INVALID_USER_ID`).
  - C3 Body chứa field cấm (vd `roleIds`/`email`/`accountStatus`) → 400 (forbidNonWhitelisted) — test qua `validate()` DTO hoặc mô tả pipe.
  - C4 Guard metadata `updateUser` = `[JwtAuthGuard, PermissionsGuard]`.
  - C5 Permission metadata = `['accounts.user.update']`.
  - **DoD**: 5 test pass; xác nhận `@RequirePermissions('accounts.user.update')`; không phá test hiện có.

---

## Phase 7 — Cổng chất lượng

| Dependency | Task |
|---|---|
| T001–T007 → | T008 |

- [ ] **T008** Chạy cổng chất lượng trên file đã đụng (KHÔNG commit).
  1. **Type-check**: `npx tsc --noEmit`. Kỳ vọng: 0 lỗi **mới** ở file production (dto/service/controller/seed).
  2. **Lint** file đã tạo/sửa:
     `npx eslint src/modules/accounts/dto/update-user.dto.ts src/modules/accounts/services/users.service.ts src/modules/accounts/controllers/users.controller.ts src/database/seeds/<timestamp>-SeedUserUpdatePermission.ts src/modules/accounts/services/users.service.spec.ts src/modules/accounts/controllers/users.controller.spec.ts` (chạy `--fix` cho prettier).
  3. **Test**: `npx jest src/modules/accounts src/modules/auth/guards`.
  4. **Phân biệt baseline vs mới**: nếu nghi lỗi có sẵn → `git stash` chạy lại lấy baseline, `git stash pop`; chỉ xử lý lỗi **mới** do UC-09. Ghi rõ lỗi nào baseline / lỗi nào mới kèm bằng chứng `git stash`.
  - **DoD**: production files (dto/service/controller/seed) **tsc & eslint sạch** (hoặc chỉ lỗi trùng pattern seed/mock baseline đã chứng minh); jest cho phạm vi trên **pass**; mọi lỗi còn lại chứng minh là **baseline**; KHÔNG commit, KHÔNG chạy seed/migration.

---

## Bảng truy vết Task ↔ file ↔ ràng buộc

| Task | Loại | File | Ràng buộc/DoD chính |
|---|---|---|---|
| T001 | CREATE | `dto/update-user.dto.ts` | #3 (5 field), #4 (không email), #5 (whitelist) |
| T002 | MODIFY | `services/users.service.ts` | Phase A; #6/#7/#8; BR-02/04/09/10/11 |
| T003 | MODIFY | `services/users.service.ts` | #9 audit atomic; #11/#12 re-query inline map; không `updated_by` |
| T004 | MODIFY | `controllers/users.controller.ts` | #2 endpoint; RBAC + `accounts.user.update` |
| T005 | CREATE | `database/seeds/<ts>-SeedUserUpdatePermission.ts` | #10 SYSTEM_ADMIN+BUSINESS_ADMIN, KHÔNG execute |
| T006 | MODIFY | `services/users.service.spec.ts` | U1–U12 |
| T007 | MODIFY | `controllers/users.controller.spec.ts` | C1–C5 |
| T008 | — | (các file trên) | tsc + eslint + jest, baseline vs mới |

---

> **Chưa code ở bước này** — tasks.md chờ duyệt trước khi implement. Khi được duyệt, thực thi tuần tự T001 → T008, tuân thủ mục "⛔ KHÔNG được làm" (đặc biệt: không sửa `getUserDetail`, không execute seed/migration, không commit).
