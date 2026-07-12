# Implementation Plan: Cập nhật thông tin tài khoản nhân sự (Update account information)

> Feature ID: UC-09
> Module: accounts
> Created: 2026-07-12
> Status: Draft
> Spec nguồn: [spec.md](./spec.md) (đã duyệt, có áp 11 quyết định chốt bên dưới)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới plan.md cho UC-09 dựa trên spec.md + 11 quyết định chốt. | Toàn bộ file |

---

## 0. Quyết định đã chốt (ràng buộc — không mở lại)

| # | Quyết định | Ảnh hưởng plan |
| :--- | :--- | :--- |
| 1 | Actor: SYSTEM_ADMIN (không scope) + BUSINESS_ADMIN (giới hạn department scope) | Tái dùng `resolveDepartmentScope`; ngoài scope → 403 |
| 2 | Endpoint `PATCH /api/v1/users/:userId` (partial) | 1 endpoint mới trong `UsersController` |
| 3 | Tập field: `employee_code`, `phone_number`, `department_id`, `position_title`, `full_name` (đúng 5) | BỎ `direct_manager_id` |
| 4 | **Email BẤT BIẾN** | BỎ `email` khỏi DTO/update, BỎ đồng bộ `username`, BỎ check email-unique |
| 5 | Không đụng `user_roles`/role, `account_status`, password/avatar/username, field hệ thống | `whitelist + forbidNonWhitelisted` |
| 6 | Đổi `department_id`: (a) tồn tại & `is_active=true`, (b) trong scope Business Admin | Validate 2 lớp; System Admin bỏ qua (b) |
| 7 | Empty update (0 field) → `400 EMPTY_UPDATE` | Enforce ở service |
| 8 | `employee_code` UNIQUE loại self, chỉ check khi có mặt & khác giá trị cũ | `Not`/`id != target` + `deletedAt IS NULL` |
| 9 | Audit ATOMIC trong transaction, `ACCOUNT_UPDATE`, old/new = **chỉ field đã đổi** | `em.create(AuditLogEntity)` trong transaction |
| 10 | Permission mới `accounts.user.update` gán SYSTEM_ADMIN + BUSINESS_ADMIN; seed KHÔNG chạy | 1 seed file, không thêm runner |
| 11 | Response tái dùng `UserDetailResponseDto` | Không tạo response DTO mới |

---

## 1. Feature Summary

Cho phép SYSTEM_ADMIN và BUSINESS_ADMIN cập nhật một phần thông tin hồ sơ của một tài khoản đã tồn tại qua `PATCH /api/v1/users/:userId`. Chỉ 5 trường được sửa: `employee_code`, `phone_number`, `department_id`, `position_title`, `full_name`. Business Admin bị giới hạn department scope (cả target user lẫn department mới đều phải trong scope). Service tính diff các field thực sự đổi, cập nhật trong một transaction và ghi `audit_logs` (old/new diff) atomic. Email/username/role/account_status/password/avatar **không** thuộc UC-09. Không thay đổi schema.

---

## 2. Technical Context

### 2.1 Stack & pattern hiện có (đã xác minh)

| Layer | Chi tiết | Nguồn |
| :--- | :--- | :--- |
| Controller | `UsersController` (`@Controller('users')`), pattern `request['user']` + `@Ip()` + `@Headers()` lấy client context; `ParseUUIDPipe` cho param | [users.controller.ts](../../../../src/modules/accounts/controllers/users.controller.ts) |
| Service | `UsersService` dùng `dataSource.transaction`; đã có uniqueness inline (`createUser`), department scope (`resolveDepartmentScope`), phân biệt System Admin qua `role.is_system_role`, và lắp `UserDetailResponseDto` (`getUserDetail`) | [users.service.ts](../../../../src/modules/accounts/services/users.service.ts) |
| Audit | Ghi inline bằng `em.create(AuditLogEntity)` trong transaction (mirror `createUser` [users.service.ts:240-267](../../../../src/modules/accounts/services/users.service.ts#L240-L267)) | [audit-log.entity.ts](../../../../src/modules/administration/entities/audit-log.entity.ts) |
| RBAC | `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions(...)`; guard resolve quyền live raw SQL | [permissions.guard.ts](../../../../src/modules/auth/guards/permissions.guard.ts) |
| Module wiring | `AccountsModule` đã `forFeature([UserEntity, DepartmentEntity, ...])`, đã import `AdministrationModule`, đã đăng ký `UsersController`+`UsersService` | [accounts.module.ts:45-90](../../../../src/modules/accounts/accounts.module.ts#L45-L90) |

### 2.2 Field thật (đã xác minh — [user.entity.ts](../../../../src/modules/accounts/entities/user.entity.ts))

`employeeCode` (varchar 50, nullable), `phoneNumber` (varchar 30, nullable), `positionTitle` (varchar 150, nullable), `fullName` (varchar 255), `departmentId` (uuid, nullable), `accountStatus` (enum `AccountStatus`), `deletedAt` (DeleteDateColumn). Validation format tham chiếu `CreateUserDto`: phone `@Matches(/^[\d\s+\-()]*$/)` maxLength 30; positionTitle maxLength 150; fullName maxLength 255; employeeCode maxLength 50. `DepartmentEntity` có `isActive`, `parentDepartmentId` (dùng trong `collectDepartmentScope`).

### 2.3 Constitution / Rule gate

| Gate | Status | Ghi chú |
| :--- | :--- | :--- |
| SEC-02 (auth cho mutating) | ✅ | PATCH có `JwtAuthGuard` + `PermissionsGuard` |
| SEC-03 (input validation) | ✅ | `UpdateUserDto` + `ParseUUIDPipe`, không raw SQL |
| DATA-01 (soft-delete) | ✅ | Chỉ UPDATE field profile; không xoá; filter `deleted_at IS NULL` |
| ARCH-03 (idempotency) | ✅ | PATCH cùng payload → no-op idempotent (A1) |
| ENG-03 (error format) | ✅ | `{success,message,error:{code,details}}` |
| DB Gate | ✅ | Không thêm bảng/field; chỉ 1 permission row qua seed |
| Scope Gate | ✅ | Chỉ UC-09; không chạm user_roles/account_status |

---

## 3. Kiến trúc & luồng

```
PATCH /api/v1/users/:userId
  │
  ├─ JwtAuthGuard                → 401
  ├─ PermissionsGuard
  │    @RequirePermissions('accounts.user.update')  → 403 nếu thiếu quyền
  │
  ▼
UsersController.updateUser(userId, dto, request, ip, headers)
  │   ParseUUIDPipe(userId) · ValidationPipe(UpdateUserDto: whitelist+forbidNonWhitelisted)
  ▼
UsersService.updateUser(targetUserId, dto, actorId, clientContext)
  │   Phase A (ngoài transaction):
  │     A.1 empty update → 400 EMPTY_UPDATE
  │     A.2 load target (deleted_at IS NULL) → 404 USER_NOT_FOUND        [users]
  │     A.3 department scope cho Business Admin (target user) → 403       [user_roles/roles/departments READ]
  │     A.4 per-field validate: employee_code unique-loại-self,          [users/departments READ]
  │         department tồn tại+active (+ trong scope), độ dài
  │     A.5 tính diff field thực đổi; diff rỗng → 200 no-op (A1)
  │   Phase B (transaction):
  │     B.1 UPDATE users field đã đổi                                     [users WRITE]
  │     B.2 audit atomic ACCOUNT_UPDATE (old/new diff)                    [audit_logs WRITE]
  │   → re-map UserDetailResponseDto
  ▼
Response 200 { success, message, data: UserDetailResponseDto }
```

Layered pattern giữ nguyên như module: Controller nhận request + guard + gọi service; Service chứa business rule + transaction; truy vấn qua `EntityManager` (nhất quán `UsersService` hiện tại).

> **Quyết định vị trí code**: thêm method `updateUser` vào **`UsersService`** hiện có (không tạo service mới) — mirror `createUser` cho transaction/uniqueness/audit và mirror `getUserDetail` cho department scope + lắp `UserDetailResponseDto`. `AuditLogsService` không cần (dùng `em.create(AuditLogEntity)` trong transaction) ⇒ **không sửa `accounts.module.ts`**.

---

## 4. DTO Plan

### 4.1 `UpdateUserDto` (TẠO MỚI) — `src/modules/accounts/dto/update-user.dto.ts`

Partial, tất cả field optional (chỉ gửi field muốn đổi). Mirror validator/`@Transform(trim)` của `CreateUserDto`:

```
class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(255) fullName?: string;
  @IsOptional() @IsString() @MaxLength(50) employeeCode?: string;
  @IsOptional() @IsString() @Matches(/^[\d\s+\-()]*$/) @MaxLength(30) phoneNumber?: string;
  @IsOptional() @IsString() @MaxLength(150) positionTitle?: string;
  @IsOptional() @IsUUID('4') departmentId?: string;
}
```

- **KHÔNG** có `email`, `directManagerId`, `roleIds`, `accountStatus`, `username`, `avatarUrl` (quyết định #3/#4/#5).
- `whitelist: true` + `forbidNonWhitelisted: true` (áp ở `@Body(new ValidationPipe(...))`, mirror `createUser`) → field ngoài danh sách → **400** (BR-06).
- **EMPTY_UPDATE (BR-11)**: enforce ở **service** (kiểm mọi field `=== undefined`) → `400 EMPTY_UPDATE`. (Không dùng class-validator vì partial hợp lệ khi rỗng; check ở service rõ ràng hơn.)

> Response: KHÔNG tạo DTO mới — tái dùng `UserDetailResponseDto` (quyết định #11).

---

## 5. Service Design

### 5.1 Chữ ký

```
async updateUser(
  targetUserId: string,
  dto: UpdateUserDto,
  actorId: string,
  clientContext: UserClientContext,
): Promise<UserDetailResponseDto>
```

Cần thêm import `Not` vào `typeorm` (hiện có `DataSource, ILike, IsNull, In`) cho uniqueness loại-self.

### 5.2 Phase A — Validate (ngoài transaction)

1. **A.1 Empty update (BR-11)**: nếu tất cả field trong `dto` là `undefined` → `BadRequestException` code **EMPTY_UPDATE**.
2. **A.2 Load target**: `findOne(UserEntity, { where: { id: targetUserId, deletedAt: IsNull() }, relations: { department: true } })` → không có: `NotFoundException` **USER_NOT_FOUND** (BR-09).
3. **A.3 Department scope (Business Admin)** — mirror `getUserDetail` bước 2-3:
   - Xác định actor có phải System Admin: query `user_roles` (active) + `role.is_system_role`.
   - Nếu **không** phải System Admin: `scope = resolveDepartmentScope(actorId)`; nếu `targetUser.departmentId ∉ scope` → `ForbiddenException` **FORBIDDEN** (BR-10, phần target).
4. **A.4 Per-field validate** (chỉ field có mặt):
   - `employeeCode` (nếu có & khác giá trị cũ): `findOne(UserEntity, { where: { employeeCode: dto.employeeCode, deletedAt: IsNull(), id: Not(targetUserId) } })` tồn tại → `ConflictException` **ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS** (BR-02/#8).
   - `departmentId` (nếu có & khác giá trị cũ):
     - `findOne(DepartmentEntity, { where: { id, deletedAt: IsNull() } })` không có → `NotFoundException` **DEPARTMENT_NOT_FOUND** (BR-04).
     - `!department.isActive` → `UnprocessableEntityException` **DEPARTMENT_INACTIVE_OR_DELETED** (BR-04).
     - Nếu actor không phải System Admin và department mới `∉ scope` → `ForbiddenException` **FORBIDDEN** (BR-10, phần department mới, #6b).
   - Độ dài (`fullName`/`positionTitle`/`phoneNumber`/`employeeCode`) và format phone: đã enforce ở DTO (BR-03/BR-05) — service không lặp lại.
5. **A.5 Tính diff**: với mỗi field có mặt, so với giá trị hiện tại của `targetUser`; chỉ giữ field **khác** giá trị cũ (áp `.trim()` cho string như `createUser`). Nếu diff rỗng → **200 no-op (A1)**: trả `UserDetailResponseDto` hiện tại, KHÔNG mở transaction, KHÔNG audit.

### 5.3 Phase B — Transaction (atomic: users + audit)

`await this.dataSource.transaction(async (tem) => { ... })`:
1. **B.1 UPDATE**: gán các field trong diff vào `targetUser` (hoặc dùng `tem.update(UserEntity, targetUserId, changedFields)`), `tem.save`/`tem.update`. `updated_at` tự cập nhật (`@UpdateDateColumn`). (`updated_by` nếu team dùng — hiện `UserEntity` chưa có cột này → **không** set; xem R-审.)
2. **B.2 Audit atomic (BR/#9)**:
   `tem.save(tem.create(AuditLogEntity, { userId: actorId, actionType: 'ACCOUNT_UPDATE', entityType: 'users', entityId: targetUserId, severity: AuditLogSeverity.INFO, oldValueJson: <diff old>, newValueJson: <diff new>, ipAddress, userAgent, requestId }))`.
   - `oldValueJson`/`newValueJson` **chỉ chứa các field đã đổi** (diff), KHÔNG dump toàn user, KHÔNG log secret.

### 5.4 Trả response

Sau commit, re-map `UserDetailResponseDto`. **Khuyến nghị**: trích phần lắp DTO (bước 4-8 của `getUserDetail`) thành private `mapUserDetail(em, targetUser)` để **tái dùng** cho cả `getUserDetail` và `updateUser` (coding-standards: reuse). **KHÔNG** gọi trực tiếp `getUserDetail` từ `updateUser` (tránh ghi thêm audit `view_detail` và chạy lại scope). Nếu không muốn refactor `getUserDetail`, phương án thay thế: re-query + map inline trong `updateUser` (chấp nhận trùng lặp nhỏ). → **Điểm cần xác minh R1.**

---

## 6. Business Rules mapping

| Rule (spec) | Áp dụng? | Nơi enforce | Kết quả |
| :--- | :--- | :--- | :--- |
| BR-02 employee_code unique loại-self | ✅ | Service A.4 | 409 ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS |
| BR-03 phone format | ✅ | DTO `@Matches` | 400 |
| BR-04 department tồn tại + active | ✅ | Service A.4 | 404 / 422 |
| BR-05 độ dài field | ✅ | DTO `@MaxLength` | 400 |
| BR-06 forbidNonWhitelisted (field cấm) | ✅ | ValidationPipe | 400 |
| BR-09 không sửa user soft-deleted | ✅ | Service A.2 (`deletedAt IS NULL`) | 404 USER_NOT_FOUND |
| BR-10 department scope (target + department mới) | ✅ | Service A.3 + A.4 | 403 FORBIDDEN |
| BR-11 empty update | ✅ | Service A.1 | 400 EMPTY_UPDATE |
| BR-12 no raw SQL | ✅ | Repository/parameter binding | — |
| BR-01 email unique / BR-07 username sync | ❌ BỎ | — | Email bất biến (#4) |
| BR-08 direct_manager_id | ❌ BỎ | — | Ngoài tập field (#3) |

---

## 7. Audit Plan

- `AuditLogEntity` qua `em.create` **trong transaction** (atomic với UPDATE — quyết định #9), mirror `createUser`.
- `action_type = 'ACCOUNT_UPDATE'` (hằng số cục bộ), `entity_type='users'`, `entity_id=targetUserId`, `severity=info`.
- `old_value_json` / `new_value_json` = **chỉ field đã đổi** (diff), ví dụ `{ phoneNumber: '...cũ' }` / `{ phoneNumber: '...mới' }`.
- KHÔNG log `password_hash`/token/secret; các field profile không nhạy cảm.
- CLAUDE.md §17 liệt kê "update user" là hành động bắt buộc audit → đáp ứng.

---

## 8. RBAC, Seed & Department scope

### 8.1 Guard
```
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('accounts.user.update')
```
Mirror `UsersController.createUser`.

### 8.2 Permission seed (MÔ TẢ — KHÔNG chạy)

File mới `src/database/seeds/<timestamp>-SeedUserUpdatePermission.ts`, mirror [SeedDepartmentReadPermission.ts](../../../../src/database/seeds/20260704000001-SeedDepartmentReadPermission.ts):
- INSERT permission `permission_code='accounts.user.update'`, `module_code='accounts'`, `action_code='update'`, `is_active=true`, `ON CONFLICT DO NOTHING`.
- Gán role-set `['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` (quyết định #10) → INSERT `role_permissions` `ON CONFLICT DO NOTHING`.
- Idempotent, có transaction.
- ⚠️ KHÔNG thêm vào runner; KHÔNG execute (pattern `seeds/*SeedXxxPermission*.ts` không có runner tự động).

### 8.3 Department scope (tái dùng)

Tái dùng `resolveDepartmentScope(actorId)` + `collectDepartmentScope` (`MAX_DEPARTMENT_SCOPE_DEPTH = 5`) và phân biệt System Admin qua `role.is_system_role`. Kiểm **CẢ** `targetUser.departmentId` (A.3) **CẢ** `dto.departmentId` mới (A.4) đều `∈ scope` khi actor là Business Admin. System Admin bỏ qua toàn bộ.

---

## 9. Error Handling Plan

Convention inline exception object của module (mirror `createUser`). `action_type`/error codes để hằng số cục bộ trong service.

| error.code | HTTP | Exception | Nơi phát |
| :--- | :--- | :--- | :--- |
| EMPTY_UPDATE | 400 | BadRequestException | Service A.1 |
| (validation/forbidNonWhitelisted) | 400 | ValidationPipe/ParseUUIDPipe | DTO/param |
| UNAUTHORIZED | 401 | (JwtAuthGuard) | Guard |
| FORBIDDEN | 403 | ForbiddenException | Guard (thiếu quyền) / scope (A.3, A.4) |
| USER_NOT_FOUND | 404 | NotFoundException | Service A.2 |
| ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS | 409 | ConflictException | Service A.4 |
| DEPARTMENT_NOT_FOUND | 404 | NotFoundException | Service A.4 |
| DEPARTMENT_INACTIVE_OR_DELETED | 422 | UnprocessableEntityException | Service A.4 |
| (500) | 500 | (filter) | Không lộ stack trace (ENG-03) |

Body lỗi: `{ success:false, message, error:{ code, details } }` (+ `timestamp`/`path` nếu qua global filter).

---

## 10. Testing Strategy (liệt kê — không code ở bước này)

### 10.1 Unit test — `UsersService.updateUser` (`users.service.spec.ts`, MODIFY)

| # | Test case | Kỳ vọng |
| :--- | :--- | :--- |
| U1 | Happy path — cập nhật 1 field (vd `phoneNumber`) | UPDATE đúng field, audit diff chỉ chứa field đó, trả `UserDetailResponseDto` |
| U2 | Happy path — nhiều field (`fullName`+`positionTitle`+`departmentId`) | UPDATE + audit diff nhiều field |
| U3 | No-op (A1) — field gửi trùng giá trị cũ | không WRITE, không audit, 200 |
| U4 | EMPTY_UPDATE — không field nào | 400 EMPTY_UPDATE, không WRITE |
| U5 | employee_code unique loại-self — trùng user khác | 409, không WRITE |
| U5b | employee_code trùng **chính mình** (giá trị cũ) | KHÔNG lỗi (bị loại khỏi diff/không check) |
| U6 | department không tồn tại | 404 DEPARTMENT_NOT_FOUND |
| U7 | department inactive | 422 DEPARTMENT_INACTIVE_OR_DELETED |
| U8 | Business Admin — target user ngoài scope | 403 FORBIDDEN, không WRITE |
| U9 | Business Admin — department **mới** ngoài scope | 403 FORBIDDEN |
| U10 | System Admin — bỏ qua scope (target/department khác phòng) | thành công |
| U11 | USER_NOT_FOUND (không tồn tại/soft-deleted) | 404 |
| U12 | Rollback — WRITE trong transaction lỗi | reject, không audit "thành công" |

### 10.2 Controller test — `UsersController` (`users.controller.spec.ts`, MODIFY)

| # | Test case | Kỳ vọng |
| :--- | :--- | :--- |
| C1 | PATCH success (guards pass) | gọi `service.updateUser` đúng tham số, response chuẩn |
| C2 | `userId` không UUID | 400 (ParseUUIDPipe / INVALID_USER_ID) |
| C3 | Body chứa field cấm (vd `roleIds`/`email`/`accountStatus`) | 400 (forbidNonWhitelisted) |
| C4 | Guard metadata: `[JwtAuthGuard, PermissionsGuard]` | assert metadata |
| C5 | Permission metadata: `['accounts.user.update']` | assert metadata |

> Constitution ENG-01: ≥80% coverage business logic → tập trung test service.

---

## 11. Rủi ro & điểm cần xác minh khi code

| # | Rủi ro / cần xác minh | Hành động |
| :--- | :--- | :--- |
| R1 | Tái dùng lắp `UserDetailResponseDto`: refactor tách `mapUserDetail` từ `getUserDetail` vs re-query inline | Chọn tách helper (reuse); chạy lại test `getUserDetail` để đảm bảo không đổi hành vi |
| R2 | Cột `updated_by` KHÔNG tồn tại trong `user.entity.ts` | KHÔNG set `updated_by`; chỉ dựa `@UpdateDateColumn` + audit `userId` |
| R3 | Cơ chế whitelist: xác nhận `@Body(new ValidationPipe({whitelist,forbidNonWhitelisted,transform}))` áp đúng (mirror `createUser`), không phụ thuộc global pipe | Đặt ValidationPipe ngay trên `@Body` |
| R4 | Import `Not` từ `typeorm` cho uniqueness loại-self | Thêm vào import hiện có (`DataSource, ILike, IsNull, In, Not`) |
| R5 | Tên field diff phải khớp entity prop (`employeeCode`, `phoneNumber`, `positionTitle`, `fullName`, `departmentId`) | Bám `user.entity.ts`; không map nhầm snake_case |
| R6 | Xác nhận `accounts.user.update` chưa tồn tại (tránh trùng seed) | grep trước khi tạo seed |
| R7 | So sánh diff cho string cần `.trim()` nhất quán với `createUser` | Trim trước khi so sánh & lưu |

---

## 12. Checklist file cần TẠO / SỬA

### 🆕 TẠO MỚI
- [ ] `src/modules/accounts/dto/update-user.dto.ts` — `UpdateUserDto` (5 field optional: `fullName?`, `employeeCode?`, `phoneNumber?`, `positionTitle?`, `departmentId?`)
- [ ] `src/database/seeds/<timestamp>-SeedUserUpdatePermission.ts` — seed `accounts.user.update` → gán `SYSTEM_ADMIN` + `BUSINESS_ADMIN` *(**KHÔNG execute**)*

### ✏️ SỬA (file đã tồn tại)
- [ ] `src/modules/accounts/services/users.service.ts` — thêm `updateUser(...)`; thêm import `Not`; (khuyến nghị) tách private `mapUserDetail` dùng chung với `getUserDetail`
- [ ] `src/modules/accounts/controllers/users.controller.ts` — thêm `@Patch(':userId')` + guards + `@RequirePermissions('accounts.user.update')`
- [ ] `src/modules/accounts/services/users.service.spec.ts` — unit test U1–U12
- [ ] `src/modules/accounts/controllers/users.controller.spec.ts` — controller test C1–C5

### ⛔ KHÔNG đổi
- `src/modules/accounts/accounts.module.ts` — không cần (entities + `UsersService` + `AdministrationModule` đã đăng ký; audit qua `em.create`)
- KHÔNG chạm `user_roles`/role (UC-08), `account_status` (UC-11), password/email/username/avatar; KHÔNG migration đổi schema; KHÔNG hard-delete.

---

> Kết thúc plan. Bước tiếp theo (khi duyệt): tách `tasks.md` chi tiết theo checklist §12. Chưa code, chưa chạy seed/migration.
