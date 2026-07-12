# Implementation Plan: Cập nhật trạng thái tài khoản (Update account status ACTIVE↔INACTIVE)

> Feature ID: UC-11
> Module: accounts
> Created: 2026-07-12
> Status: Draft
> Spec nguồn: [spec.md](./spec.md) (đã duyệt, áp 11 quyết định chốt)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới plan.md cho UC-11 (ACTIVE↔INACTIVE) dựa trên spec.md + 11 quyết định chốt + ràng buộc bảo vệ code. | Toàn bộ file |

---

## 0. Quyết định đã chốt (ràng buộc — không mở lại)

| # | Quyết định | Ảnh hưởng plan |
| :--- | :--- | :--- |
| 1 | `PATCH /api/v1/users/:userId/status`, body `{ status: 'active' \| 'inactive' }`, response `{ id, accountStatus }` | 1 endpoint mới + DTO |
| 2 | Chỉ ACTIVE↔INACTIVE; DTO allowlist chặn `locked`/`pending_reset` → 400/422 | `@IsIn(['active','inactive'])` |
| 3 | SYSTEM_ADMIN (không scope) + BUSINESS_ADMIN (department scope) | Tái dùng `resolveDepartmentScope` |
| 4 | BR-02 tự deactivate → 422 CANNOT_DEACTIVATE_SELF | check khi chuyển INACTIVE |
| 5 | BR-03 no-op (status mới == cũ) → 200, không WRITE/audit | so sánh trước khi WRITE |
| 6 | BR-04 status hiện tại LOCKED/PENDING_RESET → 409 INVALID_STATUS_TRANSITION | chặn lấn UC-12/auth |
| 7 | BR-05 last SYSTEM_ADMIN active (khi INACTIVE) → 422 LAST_SYSTEM_ADMIN | COUNT admin khác (mirror UC-10) |
| 8 | BR-06 đã soft-delete/không tồn tại → 404 USER_NOT_FOUND | load `deleted_at IS NULL` |
| 9 | Transaction atomic: UPDATE account_status + audit atomic (`ACCOUNT_STATUS_UPDATE`, old/new={accountStatus}, WARNING khi INACTIVE / INFO khi ACTIVE); KHÔNG set `updated_by` | Phase B |
| 10 | Post-commit: CHỈ khi INACTIVE → Redis `invalid_after`=now, TTL=`getRefreshTokenTtlSeconds()`; Redis fail→log, không throw/rollback. ACTIVE lại: không thao tác token | Phase C có điều kiện |
| 11 | Permission `accounts.user.update_status` gán SYSTEM_ADMIN + BUSINESS_ADMIN; seed KHÔNG execute | 1 seed file |

---

## 1. Feature Summary

Cho phép SYSTEM_ADMIN (toàn hệ thống) và BUSINESS_ADMIN (giới hạn department scope) chuyển trạng thái một tài khoản giữa `ACTIVE` và `INACTIVE` qua `PATCH /api/v1/users/:userId/status`. Chỉ đổi `users.account_status` (không chạm role/hồ sơ/soft-delete). Chuyển sang `INACTIVE` → chặn đăng nhập (login đã chặn sẵn) và thu hồi token đang hoạt động (Redis `invalid_after`); kích hoạt lại (`ACTIVE`) không thao tác token. Ghi `audit_logs` atomic. Không set `LOCKED`/`PENDING_RESET` (địa hạt UC-12/auth).

---

## 2. Technical Context (đã xác minh)

| Thành phần | Chi tiết | Nguồn |
| :--- | :--- | :--- |
| Enum `AccountStatus` | `ACTIVE='active'`, `INACTIVE='inactive'`, `LOCKED='locked'`, `PENDING_RESET='pending_reset'` | [user.entity.ts:21-26](../../../../src/modules/accounts/entities/user.entity.ts#L21) |
| Login chặn status | `inactive`→Forbidden, `locked`→423 (đã sẵn) ⇒ INACTIVE tự chặn login | [login.service.ts:90-111](../../../../src/modules/auth/services/login.service.ts#L90) |
| Token revocation | Redis `auth:user:{id}:invalid_after`; guard từ chối token `iat < invalid_after` | [jwt-auth.guard.ts:50-61](../../../../src/modules/auth/guards/jwt-auth.guard.ts#L50-L61) |
| `RedisService` + `AuthConfigService` | **ĐÃ inject sẵn** vào `UsersService` (constructor dòng 81-82, từ UC-10) → **TÁI DÙNG, không thêm param/không sửa module** | [users.service.ts:77-83](../../../../src/modules/accounts/services/users.service.ts#L77) |
| Department scope | `resolveDepartmentScope`/phân biệt System Admin qua `role.is_system_role` | [users.service.ts](../../../../src/modules/accounts/services/users.service.ts) (mirror `updateUser`) |
| Transaction + audit atomic | `dataSource.transaction` + `em.create(AuditLogEntity)` | mirror `updateUser`/`deleteUser` |

### 2.1 Constitution / Rule gate
| Gate | Status | Ghi chú |
| :--- | :--- | :--- |
| SEC-02 (auth mutating) | ✅ | PATCH có Jwt + Permissions guard |
| SEC-03 (validate) | ✅ | DTO `@IsIn` + `ParseUUIDPipe` |
| ARCH-03 (idempotency) | ✅ | no-op (BR-03) |
| ENG-03 (error format) | ✅ | inline `{success,message,error}` |
| DATA-01 | ✅ (N/A) | Không xóa; chỉ đổi status |
| Scope Gate | ✅ | Chỉ UC-11; không LOCKED/role/hồ sơ/soft-delete |

---

## 3. Kiến trúc & luồng

```
PATCH /api/v1/users/:userId/status  { status }
  │  JwtAuthGuard → 401 ; PermissionsGuard @RequirePermissions('accounts.user.update_status') → 403
  ▼
UsersController.updateUserStatus(userId, dto, request, ip, headers)
  │  ParseUUIDPipe(userId) · ValidationPipe(UpdateUserStatusDto: @IsIn active/inactive)
  ▼
UsersService.updateUserStatus(targetUserId, status, actorId, clientContext)
  │  Phase A — validate (READ):
  │    A.1 load target (deleted_at IS NULL) → 404 USER_NOT_FOUND
  │    A.2 department scope Business Admin (target) → 403
  │    A.3 BR-04: current LOCKED/PENDING_RESET → 409 INVALID_STATUS_TRANSITION
  │    A.4 BR-03 no-op (status == current) → 200 (không WRITE/audit)
  │    A.5 nếu -> INACTIVE: BR-02 self → 422 ; BR-05 last SYSTEM_ADMIN → 422
  │  Phase B — transaction (atomic):
  │    UPDATE users.account_status + audit ACCOUNT_STATUS_UPDATE (old/new)
  │  Phase C — post-commit (điều kiện):
  │    CHỈ khi -> INACTIVE: Redis invalid_after=now (TTL=refresh TTL); fail→log
  ▼
Response 200 { success, message, data: { id, accountStatus } }
```

> **Vị trí code**: thêm method `updateUserStatus` vào `UsersService` (mirror scope của `updateUser`, transaction/audit/revoke của `deleteUser`). **KHÔNG** sửa `createUser/getUserDetail/updateUser/updateUserRoles/deleteUser/listUsers/resolveDepartmentScope`. **KHÔNG** thêm constructor param (Redis/AuthConfig đã có). **KHÔNG** sửa `accounts.module.ts`.

---

## 4. DTO Plan

### 4.1 `UpdateUserStatusDto` (TẠO MỚI) — `src/modules/accounts/dto/update-user-status.dto.ts`

```
class UpdateUserStatusDto {
  @IsIn(['active', 'inactive'])   // BR-01/#2: chỉ nhận active/inactive; locked/pending_reset -> 400
  status: 'active' | 'inactive';
}
```

- `whitelist: true` + `forbidNonWhitelisted: true` ở `@Body(new ValidationPipe(...))` (mirror `updateUser`) → field lạ → 400.
- **KHÔNG** dùng full `AccountStatus` enum cho `@IsIn` (sẽ cho phép `locked`/`pending_reset`); dùng literal allowlist `['active','inactive']`.
- Message tiếng Việt: "Trạng thái chỉ được là active hoặc inactive".

> Response: DTO gọn `{ id: string; accountStatus: string }` (đề xuất `UpdateUserStatusResponseDto` hoặc trả object literal). Không tái dùng `UserDetailResponseDto` (quyết định #1).

---

## 5. Service Design

### 5.1 Chữ ký
```
async updateUserStatus(
  targetUserId: string,
  status: 'active' | 'inactive',
  actorId: string,
  clientContext: UserClientContext,
): Promise<{ id: string; accountStatus: string }>
```

### 5.2 Phase A — Validate (READ, ngoài transaction)
1. **A.1** `findOne(UserEntity, { where: { id: targetUserId, deletedAt: IsNull() } })` → null: `NotFoundException` **USER_NOT_FOUND** (BR-06).
2. **A.2 Department scope** (mirror `updateUser`): query active `user_roles` của actor → `isSystemAdmin` qua `role.is_system_role`. Nếu không System Admin: `scope = resolveDepartmentScope(actorId)`; `targetUser.departmentId && !scope.has(...)` → `ForbiddenException` **FORBIDDEN** (BR-07). *(UC-11 không đổi department nên chỉ kiểm target, không cần kiểm "department mới" như UC-09.)*
3. **A.3 BR-04**: nếu `targetUser.accountStatus === LOCKED || === PENDING_RESET` → `ConflictException` **INVALID_STATUS_TRANSITION** (không cho UC-11 mở khóa/đổi).
4. **A.4 BR-03 no-op**: `nextStatus = status === 'active' ? AccountStatus.ACTIVE : AccountStatus.INACTIVE`. Nếu `nextStatus === targetUser.accountStatus` → trả `{ id, accountStatus }` hiện tại ngay, KHÔNG transaction/audit.
5. **A.5** (chỉ khi `nextStatus === INACTIVE`):
   - **BR-02**: `targetUserId === actorId` → `UnprocessableEntityException` **CANNOT_DEACTIVATE_SELF**.
   - **BR-05 last admin**: nếu target giữ `SYSTEM_ADMIN` active, COUNT user **khác** target còn active giữ `SYSTEM_ADMIN` active; `0` → `UnprocessableEntityException` **LAST_SYSTEM_ADMIN**. Query READ mirror UC-10 (`deleteUser` A.3): join `user_roles`+`roles`+`users`, `role_code='SYSTEM_ADMIN'`, active, `expired_at` NULL/>now, `u.deleted_at IS NULL`, `u.account_status='active'`, `u.id != target`.

### 5.3 Phase B — Transaction (atomic)
`await this.dataSource.transaction(async (tem) => { ... })`:
1. `tem.update(UserEntity, targetUserId, { accountStatus: nextStatus })`. **KHÔNG** set `updated_by`; `@UpdateDateColumn` tự lo.
2. Audit atomic: `tem.save(tem.create(AuditLogEntity, { userId: actorId, actionType: 'ACCOUNT_STATUS_UPDATE', entityType: 'users', entityId: targetUserId, severity: nextStatus===INACTIVE ? WARNING : INFO, oldValueJson: { accountStatus: <cũ> }, newValueJson: { accountStatus: nextStatus }, ipAddress, userAgent, requestId }))`. `action_type` hằng số cục bộ. KHÔNG secret.

### 5.4 Phase C — Post-commit (revoke token, điều kiện)
- **CHỈ khi `nextStatus === INACTIVE`**: `await this.redisService.setWithTtl('auth:user:'+targetUserId+':invalid_after', String(Date.now()), this.authConfigService.getRefreshTokenTtlSeconds())`. Bọc try/catch: Redis fail → `logger.error`, **không throw, không rollback** (mirror UC-10 Phase C).
- Khi `nextStatus === ACTIVE`: **không** thao tác token.

### 5.5 Trả response
`return { id: targetUserId, accountStatus: nextStatus }`.

---

## 6. Business Rules mapping

| Rule (spec §6) | Áp dụng? | Nơi enforce | Kết quả |
| :--- | :--- | :--- | :--- |
| BR-01 status chỉ active/inactive | ✅ | DTO `@IsIn` | 400 (INVALID_STATUS) |
| BR-02 không tự deactivate | ✅ | Service A.5 | 422 CANNOT_DEACTIVATE_SELF |
| BR-03 no-op idempotent | ✅ | Service A.4 | 200 no-op |
| BR-04 chặn LOCKED/PENDING_RESET | ✅ | Service A.3 | 409 INVALID_STATUS_TRANSITION |
| BR-05 last SYSTEM_ADMIN | ✅ | Service A.5 | 422 LAST_SYSTEM_ADMIN |
| BR-06 không thao tác user soft-deleted | ✅ | Service A.1 | 404 USER_NOT_FOUND |
| BR-07 department scope (Business Admin) | ✅ | Service A.2 | 403 FORBIDDEN |
| BR-08 input validation / no raw SQL | ✅ | DTO + parameter binding | — |

---

## 7. Error Handling Plan

Convention inline module. Error codes hằng số cục bộ.

| error.code | HTTP | Exception | Nơi |
| :--- | :--- | :--- | :--- |
| INVALID_STATUS | 400 | ValidationPipe (`@IsIn`) | DTO |
| INVALID_USER_ID | 400 | ParseUUIDPipe | param |
| UNAUTHORIZED | 401 | JwtAuthGuard | guard |
| FORBIDDEN | 403 | PermissionsGuard / scope A.2 | guard/service |
| USER_NOT_FOUND | 404 | NotFoundException | A.1 |
| INVALID_STATUS_TRANSITION | 409 | ConflictException | A.3 (BR-04) |
| CANNOT_DEACTIVATE_SELF | 422 | UnprocessableEntityException | A.5 (BR-02) |
| LAST_SYSTEM_ADMIN | 422 | UnprocessableEntityException | A.5 (BR-05) |
| (500) | 500 | filter | không lộ stack trace |

---

## 8. Audit Plan

- `em.create(AuditLogEntity)` **trong transaction** (atomic). `action_type='ACCOUNT_STATUS_UPDATE'`, `entity_type='users'`, `entity_id=targetUserId`.
- `severity` = `WARNING` khi chuyển INACTIVE (vô hiệu hóa), `INFO` khi chuyển ACTIVE (kích hoạt lại).
- `old_value_json = { accountStatus: <cũ> }`, `new_value_json = { accountStatus: <mới> }`. KHÔNG secret. CLAUDE.md §17 (thay đổi trạng thái tài khoản) bắt buộc audit.

---

## 9. RBAC & Seed

- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('accounts.user.update_status')`.
- Seed (MÔ TẢ, KHÔNG chạy): `src/database/seeds/<ts>-SeedUserUpdateStatusPermission.ts`, mirror [SeedDepartmentReadPermission.ts](../../../../src/database/seeds/20260704000001-SeedDepartmentReadPermission.ts). Permission `accounts.user.update_status` (`module_code=accounts`, `action_code=update`), gán role-set `['SYSTEM_ADMIN','BUSINESS_ADMIN']`, `ON CONFLICT DO NOTHING`. Grep xác nhận code chưa tồn tại. KHÔNG runner, KHÔNG execute.

---

## 10. Department scope (tái dùng)

Tái dùng `resolveDepartmentScope(actorId)` + phân biệt System Admin qua `role.is_system_role` (mirror `updateUser`/`getUserDetail`). **Chỉ kiểm `targetUser.departmentId ∈ scope`** khi actor là Business Admin. UC-11 **không** đổi department → **không** cần kiểm "department mới" (khác UC-09). System Admin bỏ qua scope.

---

## 11. Test Plan (liệt kê — không code)

### 11.1 Unit — `UsersService.updateUserStatus` (`users.service.spec.ts`, MODIFY)
| # | Test | Kỳ vọng |
| :--- | :--- | :--- |
| S1 | active→inactive (System Admin) | UPDATE account_status=inactive; audit WARNING old/new; **revoke** Redis invalid_after |
| S2 | inactive→active | UPDATE=active; audit INFO; **KHÔNG** revoke |
| S3 | No-op (status == current) | 200, không transaction/UPDATE/audit |
| S4 | BR-02 self-deactivate (target==actor, →inactive) | 422 CANNOT_DEACTIVATE_SELF, không WRITE |
| S5 | BR-05 last SYSTEM_ADMIN (→inactive, count khác=0) | 422 LAST_SYSTEM_ADMIN, không WRITE |
| S6 | BR-05 còn admin khác (count≥1) | thành công |
| S7 | BR-04 current=LOCKED | 409 INVALID_STATUS_TRANSITION, không WRITE |
| S8 | BR-04 current=PENDING_RESET | 409 INVALID_STATUS_TRANSITION |
| S9 | BR-06 USER_NOT_FOUND (soft-deleted/không tồn tại) | 404 |
| S10 | BR-07 Business Admin — target ngoài scope | 403, không WRITE |
| S11 | System Admin bỏ qua scope | thành công |
| S12 | Redis fail post-commit (→inactive) | không throw; account_status đã đổi |
| S13 | Rollback — WRITE trong transaction lỗi | reject; revoke KHÔNG chạy |

*(BR-01 invalid status test ở DTO/controller level — S-list tập trung service.)*

### 11.2 Controller — `users.controller.spec.ts` (MODIFY)
| # | Test | Kỳ vọng |
| :--- | :--- | :--- |
| SC1 | Success | gọi `updateUserStatus(userId, dto.status, actorId, ctx)`, trả `{ success, message, data:{id,accountStatus} }` |
| SC2 | userId không UUID | 400 INVALID_USER_ID |
| SC3 | status không hợp lệ (vd 'locked') | DTO `@IsIn` reject (validate) |
| SC4 | Guard metadata | `[JwtAuthGuard, PermissionsGuard]` |
| SC5 | Permission metadata | `['accounts.user.update_status']` |

---

## 12. Rủi ro & điểm cần xác minh

| # | Rủi ro / xác minh | Hành động |
| :--- | :--- | :--- |
| R1 | `RedisService`/`AuthConfigService` đã inject sẵn (UC-10) | ✅ Đã xác nhận constructor dòng 81-82 — tái dùng, không thêm param |
| R2 | Enum value thật `AccountStatus.LOCKED/PENDING_RESET` cho BR-04 | ✅ Xác nhận user.entity.ts:21-26 |
| R3 | Severity mapping WARNING/INFO | Theo hướng chuyển (INACTIVE=WARNING, ACTIVE=INFO) |
| R4 | `@IsIn(['active','inactive'])` chặn đúng locked/pending_reset | Không dùng full enum cho @IsIn |
| R5 | So sánh `nextStatus` với `accountStatus` (kiểu enum string) | Map literal→enum trước so sánh |
| R6 | last-admin COUNT query (mirror deleteUser A.3) | Tái dùng đúng điều kiện |

---

## 13. Tác động lên code người khác (bảo vệ)

- **CHỈ ĐỌC (không sửa)**: `createUser`, `getUserDetail`, `updateUser`, `updateUserRoles`, `deleteUser`, `listUsers`, `resolveDepartmentScope` — chỉ đọc để mirror pattern.
- **Module auth**: **KHÔNG sửa** `login.service`/auth (login đã chặn `inactive` sẵn). Chỉ dùng `RedisService.setWithTtl` + `AuthConfigService.getRefreshTokenTtlSeconds()` (đã inject từ UC-10, API công khai).
- **KHÔNG** sửa `accounts.module.ts` (không thêm dependency mới — Redis/AuthConfig đã có).
- **Chỉ THÊM (additive)**: `UpdateUserStatusDto` + method `updateUserStatus` + endpoint `@Patch(':userId/status')` + seed + test.
- **Không đụng UC khác**: KHÔNG set LOCKED (UC-12), KHÔNG chạm `user_roles` (UC-08), hồ sơ (UC-09), soft-delete (UC-10).

---

## 14. Checklist file cần TẠO / SỬA

### 🆕 TẠO MỚI
- [ ] `src/modules/accounts/dto/update-user-status.dto.ts` — `UpdateUserStatusDto` (`status` @IsIn active/inactive)
- [ ] `src/database/seeds/<timestamp>-SeedUserUpdateStatusPermission.ts` — permission `accounts.user.update_status` → SYSTEM_ADMIN + BUSINESS_ADMIN (**KHÔNG execute**)

### ✏️ SỬA (additive)
- [ ] `src/modules/accounts/services/users.service.ts` — thêm `updateUserStatus(...)`. **KHÔNG** thêm constructor param (Redis/AuthConfig đã có). **KHÔNG** sửa method khác.
- [ ] `src/modules/accounts/controllers/users.controller.ts` — thêm `@Patch(':userId/status')` + guards + `@RequirePermissions('accounts.user.update_status')`.
- [ ] `src/modules/accounts/services/users.service.spec.ts` — S1–S13.
- [ ] `src/modules/accounts/controllers/users.controller.spec.ts` — SC1–SC5.

### ⛔ KHÔNG đổi
- `accounts.module.ts`, `login.service`/module auth, các method người khác.
- KHÔNG set LOCKED/PENDING_RESET, KHÔNG migration đổi schema, KHÔNG seed execute.

> ⚠️ Lưu ý route: `@Patch(':userId/status')` phải phân biệt với `@Patch(':userId')` (UC-09). NestJS match theo path cụ thể hơn — cần đảm bảo thứ tự/định nghĩa route không nuốt nhau (xác minh khi implement).

---

> Kết thúc plan. Bước tiếp theo (khi duyệt): tách `tasks.md` theo checklist §14. Chưa code, chưa chạy seed/migration.
