# Implementation Plan: Khóa/Mở khóa tài khoản người dùng (Lock / Unlock user account)

> Feature ID: UC-12
> Module: accounts
> Created: 2026-07-12
> Status: Draft
> Spec nguồn: [spec.md](./spec.md) (đã duyệt, áp 13 quyết định chốt)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới plan.md cho UC-12 (lock + unlock) dựa trên spec.md + 13 quyết định chốt + ràng buộc bảo vệ code. | Toàn bộ file |

---

## 0. Quyết định đã chốt (ràng buộc — không mở lại)

| # | Quyết định | Ảnh hưởng plan |
| :--- | :--- | :--- |
| 1 | Gộp lock+unlock; 2 endpoint `PATCH :userId/lock` (body `{reason?}`) + `PATCH :userId/unlock` (no body); response `{id, accountStatus}` | 2 endpoint + 1 DTO |
| 2 | Lock: `account_status=LOCKED`, `locked_until=null`; KHÔNG chạm user_roles/hồ sơ/soft-delete; KHÔNG `updated_by` | Phase B lock |
| 3 | `reason` (optional) → `audit_logs`, KHÔNG thêm cột `users` | audit metadataJson |
| 4 | Lock post-commit: Redis `invalid_after`; fail→log, không throw/rollback. Unlock: KHÔNG revoke | Phase C chỉ lock |
| 5 | Unlock: `account_status=ACTIVE` + reset `failed_login_count=0`, `locked_until=null` | Phase B unlock |
| 6 | BR-01 tự khóa → 422 CANNOT_LOCK_SELF | Phase A lock |
| 7 | BR-02 last SYSTEM_ADMIN → 422 (mirror deleteUser/updateUserStatus COUNT) | Phase A lock |
| 8 | BR-03 lock no-op đã LOCKED → 200; unlock chưa LOCKED → 409 NOT_LOCKED | Phase A |
| 9 | BR-04 cho khóa tài khoản đang INACTIVE (leo thang) | không chặn INACTIVE |
| 10 | BR-05 soft-deleted/không tồn tại → 404 | Phase A |
| 11 | BR-06 Business Admin department scope (chỉ target); System Admin không scope | Phase A |
| 12 | Audit atomic: `ACCOUNT_LOCK` (WARNING+reason) / `ACCOUNT_UNLOCK` (INFO); old/new={accountStatus} | Phase B |
| 13 | Permission TÁCH: `accounts.user.lock` + `accounts.user.unlock`, cả 2 gán SYSTEM_ADMIN+BUSINESS_ADMIN; seed KHÔNG execute | seed 2 permission |

---

## 1. Feature Summary

Cho phép SYSTEM_ADMIN (toàn hệ thống) và BUSINESS_ADMIN (department scope) **khóa** (`PATCH :userId/lock`) và **mở khóa** (`PATCH :userId/unlock`) một tài khoản. Khóa đặt `account_status=LOCKED` (`locked_until=null`, vô thời hạn) và thu hồi mọi session (Redis `invalid_after`); giữ nguyên `user_roles`/hồ sơ/dữ liệu lịch sử (khác UC-10). Mở khóa đưa về `ACTIVE`, reset `failed_login_count`/`locked_until`, không thao tác token. Ghi `audit_logs` atomic (`ACCOUNT_LOCK`/`ACCOUNT_UNLOCK`, kèm `reason`). Login đã chặn `LOCKED` sẵn; UC-12 không đụng UC-11 (ACTIVE/INACTIVE) và không đụng auto-lock rate-limit của auth.

---

## 2. Technical Context (đã xác minh)

| Thành phần | Chi tiết | Nguồn |
| :--- | :--- | :--- |
| Enum `AccountStatus` | `ACTIVE/INACTIVE/LOCKED/PENDING_RESET` | [user.entity.ts:21-26](../../../../src/modules/accounts/entities/user.entity.ts#L21) |
| Cột `locked_until`, `failed_login_count` | `lockedUntil` (nullable), `failedLoginCount` (int, default 0) — login KHÔNG dùng (auto-lock qua Redis rate-limit) | [user.entity.ts:100-107](../../../../src/modules/accounts/entities/user.entity.ts#L100) |
| Login chặn LOCKED | `accountStatus==='locked'` → 423 (sẵn) | [login.service.ts:98-105](../../../../src/modules/auth/services/login.service.ts#L98) |
| Token revocation | Redis `auth:user:{id}:invalid_after` | [jwt-auth.guard.ts:50-61](../../../../src/modules/auth/guards/jwt-auth.guard.ts#L50-L61) |
| `RedisService` + `AuthConfigService` | **ĐÃ inject sẵn** vào `UsersService` (constructor dòng 81-82, từ UC-10) → TÁI DÙNG, không thêm param/module | [users.service.ts:77-83](../../../../src/modules/accounts/services/users.service.ts#L77) |
| Scope + last-admin + transaction/audit/revoke | Mirror `updateUserStatus` (UC-11) / `deleteUser` (UC-10) | [users.service.ts](../../../../src/modules/accounts/services/users.service.ts) |
| Cột lý do khóa | **Không tồn tại** → reason lưu ở `audit_logs`, KHÔNG thêm cột | — |

### 2.1 Constitution / Rule gate
| Gate | Status | Ghi chú |
| :--- | :--- | :--- |
| SEC-02 (auth mutating) | ✅ | 2 PATCH có Jwt + Permissions guard |
| SEC-03 (validate) | ✅ | `ParseUUIDPipe` + LockUserDto |
| DATA-01 | ✅ (N/A) | Không xóa; giữ dữ liệu lịch sử |
| ARCH-03 (idempotency) | ✅ | lock no-op (BR-03) |
| ENG-03 (error format) | ✅ | inline `{success,message,error}` |
| Scope Gate | ✅ | Chỉ UC-12; không ACTIVE↔INACTIVE/xóa/auto-lock |

---

## 3. Kiến trúc & luồng

### 3.1 LOCK
```
PATCH /api/v1/users/:userId/lock  { reason? }
  │  JwtAuthGuard → 401 ; PermissionsGuard @RequirePermissions('accounts.user.lock') → 403
  ▼
UsersController.lockUser(userId, dto, request, ip, headers)
  │  ParseUUIDPipe(userId) · ValidationPipe(LockUserDto: reason optional)
  ▼
UsersService.lockUser(targetUserId, reason, actorId, clientContext)
  │  Phase A (READ): A.1 load target (deleted_at IS NULL)→404 ; A.2 scope→403 ;
  │                   A.3 BR-01 self→422 ; A.4 BR-03 no-op nếu đã LOCKED→200 ;
  │                   A.5 BR-02 last SYSTEM_ADMIN→422
  │  Phase B (transaction): UPDATE account_status=LOCKED, locked_until=null
  │                          + audit ACCOUNT_LOCK (WARNING, reason)
  │  Phase C (post-commit): Redis invalid_after=now (TTL=refresh TTL); fail→log
  ▼
Response 200 { success, message, data:{ id, accountStatus:'locked' } }
```

### 3.2 UNLOCK
```
PATCH /api/v1/users/:userId/unlock
  │  JwtAuthGuard → 401 ; PermissionsGuard @RequirePermissions('accounts.user.unlock') → 403
  ▼
UsersService.unlockUser(targetUserId, actorId, clientContext)
  │  Phase A (READ): load target→404 ; scope→403 ; BR-03 nếu KHÔNG LOCKED→409 NOT_LOCKED
  │  Phase B (transaction): UPDATE account_status=ACTIVE, failed_login_count=0,
  │                          locked_until=null + audit ACCOUNT_UNLOCK (INFO)
  │  (KHÔNG Phase C — không revoke)
  ▼
Response 200 { success, message, data:{ id, accountStatus:'active' } }
```

> **Vị trí code**: thêm `lockUser` + `unlockUser` vào `UsersService` (mirror `updateUserStatus`). **KHÔNG** sửa `createUser/getUserDetail/updateUser/updateUserRoles/deleteUser/updateUserStatus/listUsers/resolveDepartmentScope`. **KHÔNG** thêm constructor param (Redis/AuthConfig đã có). **KHÔNG** sửa `accounts.module.ts`.

---

## 4. DTO Plan

### 4.1 `LockUserDto` (TẠO MỚI) — `src/modules/accounts/dto/lock-user.dto.ts`

```
class LockUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)   // lý do khóa, tùy chọn
  reason?: string;
}
```

- `@Body(new ValidationPipe({ whitelist:true, forbidNonWhitelisted:true, transform:true }))` (mirror `updateUser`) → field lạ → 400.
- **Unlock KHÔNG cần DTO** (no body). Controller `unlockUser` không nhận `@Body`.

> Response: object literal `{ id, accountStatus }` (không tạo response DTO — quyết định #1).

---

## 5. Service Design

### 5.1 `lockUser`
```
async lockUser(
  targetUserId: string,
  reason: string | undefined,
  actorId: string,
  clientContext: UserClientContext,
): Promise<{ id: string; accountStatus: string }>
```

**Phase A — Validate (READ):**
1. **A.1** `findOne(UserEntity, { where: { id: targetUserId, deletedAt: IsNull() } })` → null: `NotFoundException` **USER_NOT_FOUND** (BR-05).
2. **A.2 Scope** (mirror `updateUserStatus` A.2): query active `user_roles` actor → `isSystemAdmin` qua `role.is_system_role`. Nếu không System Admin: `scope=resolveDepartmentScope(actorId)`; `targetUser.departmentId && !scope.has(...)` → `ForbiddenException` **FORBIDDEN** (BR-06).
3. **A.3 BR-01**: `targetUserId === actorId` → `UnprocessableEntityException` **CANNOT_LOCK_SELF**.
4. **A.4 BR-03 no-op**: `targetUser.accountStatus === AccountStatus.LOCKED` → trả `{ id, accountStatus: 'locked' }` ngay, KHÔNG transaction/audit. *(BR-04: INACTIVE không bị chặn — vẫn khóa được.)*
5. **A.5 BR-02 last-admin**: nếu target giữ `SYSTEM_ADMIN` active, COUNT admin khác active (mirror `updateUserStatus`/`deleteUser` QueryBuilder); `0` → `UnprocessableEntityException` **LAST_SYSTEM_ADMIN**.

**Phase B — Transaction (atomic):**
```
await this.dataSource.transaction(async (tem) => {
  await tem.update(UserEntity, targetUserId, {
    accountStatus: AccountStatus.LOCKED,
    lockedUntil: null,           // vô thời hạn (#2)
  });
  const auditLog = tem.create(AuditLogEntity, {
    userId: actorId,
    actionType: 'ACCOUNT_LOCK',
    entityType: 'users',
    entityId: targetUserId,
    severity: AuditLogSeverity.WARNING,
    oldValueJson: { accountStatus: <cũ> },
    newValueJson: { accountStatus: 'locked' },
    metadataJson: reason ? { reason } : null,   // #3 reason -> audit, không cột users
    ipAddress, userAgent, requestId,
  });
  await tem.save(AuditLogEntity, auditLog);
});
```
- KHÔNG set `updated_by`. KHÔNG chạm `user_roles`/hồ sơ (giữ dữ liệu lịch sử).

**Phase C — Post-commit (revoke):** mirror `deleteUser`/`updateUserStatus`:
```
try { await this.redisService.setWithTtl(`auth:user:${targetUserId}:invalid_after`, String(Date.now()), this.authConfigService.getRefreshTokenTtlSeconds()); }
catch (e) { this.logger.error(...); }   // không throw/rollback
```
Return `{ id: targetUserId, accountStatus: 'locked' }`.

### 5.2 `unlockUser`
```
async unlockUser(targetUserId, actorId, clientContext): Promise<{ id; accountStatus }>
```

**Phase A — Validate (READ):**
1. Load target (deleted_at IS NULL) → 404 USER_NOT_FOUND.
2. Scope (mirror A.2) → 403 FORBIDDEN.
3. **BR-03**: `targetUser.accountStatus !== AccountStatus.LOCKED` → `ConflictException` **NOT_LOCKED**.

**Phase B — Transaction (atomic):**
```
await this.dataSource.transaction(async (tem) => {
  await tem.update(UserEntity, targetUserId, {
    accountStatus: AccountStatus.ACTIVE,   // #5 (không khôi phục INACTIVE cũ)
    failedLoginCount: 0,
    lockedUntil: null,
  });
  const auditLog = tem.create(AuditLogEntity, {
    userId: actorId,
    actionType: 'ACCOUNT_UNLOCK',
    entityType: 'users',
    entityId: targetUserId,
    severity: AuditLogSeverity.INFO,
    oldValueJson: { accountStatus: 'locked' },
    newValueJson: { accountStatus: 'active' },
    ipAddress, userAgent, requestId,
  });
  await tem.save(AuditLogEntity, auditLog);
});
```
- **KHÔNG** Phase C (không revoke token — không có session hợp lệ khi khóa).
Return `{ id: targetUserId, accountStatus: 'active' }`.

---

## 6. Business Rules mapping

| Rule (spec §6) | Áp dụng? | Nơi enforce | Kết quả |
| :--- | :--- | :--- | :--- |
| BR-01 không tự khóa (lock) | ✅ | lockUser A.3 | 422 CANNOT_LOCK_SELF |
| BR-02 last SYSTEM_ADMIN (lock) | ✅ | lockUser A.5 | 422 LAST_SYSTEM_ADMIN |
| BR-03 lock no-op / unlock not-locked | ✅ | lockUser A.4 / unlockUser A.3 | 200 / 409 NOT_LOCKED |
| BR-04 khóa từ INACTIVE cho phép | ✅ | lockUser (không chặn INACTIVE) | — |
| BR-05 không thao tác user soft-deleted | ✅ | A.1 (cả 2) | 404 USER_NOT_FOUND |
| BR-06 department scope (Business Admin) | ✅ | A.2 (cả 2) | 403 FORBIDDEN |
| BR-07 chỉ LOCKED/ACTIVE, không ACTIVE↔INACTIVE | ✅ | thiết kế (chỉ 2 method) | — |
| BR-08 input validation / reason maxlen | ✅ | LockUserDto | 400 |

---

## 7. Error Handling Plan

Convention inline module. Error codes hằng số cục bộ.

| error.code | HTTP | Exception | Nơi |
| :--- | :--- | :--- | :--- |
| INVALID_USER_ID | 400 | ParseUUIDPipe | param |
| (reason invalid) | 400 | ValidationPipe | LockUserDto |
| UNAUTHORIZED | 401 | JwtAuthGuard | guard |
| FORBIDDEN | 403 | PermissionsGuard / scope A.2 | guard/service |
| USER_NOT_FOUND | 404 | NotFoundException | A.1 |
| CANNOT_LOCK_SELF | 422 | UnprocessableEntityException | lockUser A.3 |
| LAST_SYSTEM_ADMIN | 422 | UnprocessableEntityException | lockUser A.5 |
| NOT_LOCKED | 409 | ConflictException | unlockUser A.3 |
| (500) | 500 | filter | không lộ stack trace |

---

## 8. Audit Plan

- `em.create(AuditLogEntity)` **trong transaction** (atomic).
- **Lock**: `action_type='ACCOUNT_LOCK'`, `severity=WARNING`, `old/new={accountStatus}`, `metadata_json={reason}` nếu có. KHÔNG secret.
- **Unlock**: `action_type='ACCOUNT_UNLOCK'`, `severity=INFO`, `old={accountStatus:'locked'}`/`new={accountStatus:'active'}`.
- CLAUDE.md §17 (khóa/đổi trạng thái tài khoản) bắt buộc audit.

---

## 9. RBAC & Seed

- Guard lock: `@RequirePermissions('accounts.user.lock')`. Guard unlock: `@RequirePermissions('accounts.user.unlock')`.
- Seed (MÔ TẢ, KHÔNG chạy): `src/database/seeds/<ts>-SeedUserLockPermissions.ts` — INSERT **2** permission (`accounts.user.lock`, `accounts.user.unlock`, `module_code=accounts`, `action_code=update`), mỗi permission gán role-set `['SYSTEM_ADMIN','BUSINESS_ADMIN']`, `ON CONFLICT DO NOTHING`. Mirror [SeedDepartmentReadPermission.ts](../../../../src/database/seeds/20260704000001-SeedDepartmentReadPermission.ts). Grep xác nhận 2 code chưa tồn tại. KHÔNG runner, KHÔNG execute.

---

## 10. Department scope (tái dùng)

Tái dùng `resolveDepartmentScope(actorId)` + phân biệt System Admin qua `role.is_system_role` (mirror `updateUserStatus`). **Chỉ kiểm `targetUser.departmentId ∈ scope`** khi actor là Business Admin (cả lock lẫn unlock). System Admin bỏ qua.

---

## 11. Test Plan (liệt kê — không code)

### 11.1 Unit — `UsersService.lockUser` / `unlockUser` (`users.service.spec.ts`, MODIFY)
| # | Test | Kỳ vọng |
| :--- | :--- | :--- |
| L1 | lock happy (System Admin) | `update(...,{accountStatus:'locked', lockedUntil:null})` + audit WARNING (reason nếu có) + revoke `invalid_after`; **KHÔNG** đụng user_roles |
| L2 | lock BR-01 self | 422 CANNOT_LOCK_SELF, không WRITE |
| L3 | lock BR-02 last SYSTEM_ADMIN (count khác=0) | 422 LAST_SYSTEM_ADMIN, không WRITE |
| L4 | lock BR-02 còn admin khác | thành công |
| L5 | lock no-op đã LOCKED | 200, không transaction/update/audit |
| L6 | lock từ INACTIVE (BR-04) | thành công → LOCKED |
| L7 | lock scope 403 (Business Admin ngoài scope) | 403, không WRITE |
| L8 | lock System Admin bỏ scope | thành công |
| L9 | lock Redis fail post-commit | không throw; status đã LOCKED |
| L10 | lock rollback (WRITE lỗi) | reject; revoke KHÔNG chạy |
| L11 | lock USER_NOT_FOUND | 404 |
| U1 | unlock happy | `update(...,{accountStatus:'active', failedLoginCount:0, lockedUntil:null})` + audit INFO; **KHÔNG** revoke |
| U2 | unlock NOT_LOCKED (đang active/inactive) | 409, không WRITE |
| U3 | unlock scope 403 | 403 |
| U4 | unlock USER_NOT_FOUND | 404 |

### 11.2 Controller — `users.controller.spec.ts` (MODIFY)
| # | Test | Kỳ vọng |
| :--- | :--- | :--- |
| LC1 | lock success | gọi `lockUser(userId, dto.reason, actorId, ctx)`; trả `{success,message,data:{id,accountStatus}}` |
| LC2 | userId không UUID (lock) | 400 INVALID_USER_ID |
| LC3 | lock guard metadata | `[JwtAuthGuard, PermissionsGuard]` |
| LC4 | lock permission metadata | `['accounts.user.lock']` |
| UC1 | unlock success | gọi `unlockUser(userId, actorId, ctx)`; trả chuẩn |
| UC2 | unlock permission metadata | `['accounts.user.unlock']` |

---

## 12. Rủi ro & điểm cần xác minh

| # | Rủi ro / xác minh | Hành động |
| :--- | :--- | :--- |
| R1 | Route order: `:userId/lock` & `:userId/unlock` (2 segment) vs `:userId` (1 segment) | Khai báo cả 2 method TRƯỚC `updateUser` (`:userId`); xác minh không collision (mirror UC-11) |
| R2 | `RedisService`/`AuthConfigService` đã inject (UC-10) | ✅ constructor dòng 81-82 — tái dùng, không thêm param |
| R3 | `reason` lưu đúng field audit (`metadata_json`) | Dùng `metadataJson` (entity có field này) |
| R4 | Reset `failedLoginCount`/`lockedUntil` khi unlock (props thật) | ✅ `user.entity.ts:100-107` |
| R5 | `AuditLogEntity` có `metadataJson` | ✅ [audit-log.entity.ts](../../../../src/modules/administration/entities/audit-log.entity.ts) (`metadata_json`) |
| R6 | last-admin COUNT query (mirror updateUserStatus) | Tái dùng đúng điều kiện |

---

## 13. Tác động lên code người khác (bảo vệ)

- **CHỈ ĐỌC (không sửa)**: `createUser`, `getUserDetail`, `updateUser`, `updateUserRoles`, `deleteUser`, `updateUserStatus`, `listUsers`, `resolveDepartmentScope` — đọc để mirror pattern.
- **Module auth**: **KHÔNG sửa** `login.service`/auth (đã chặn `LOCKED` sẵn; auto-lock là Redis rate-limit, **không** đụng). Chỉ dùng `RedisService.setWithTtl` + `AuthConfigService.getRefreshTokenTtlSeconds()` (đã inject từ UC-10, API công khai).
- **KHÔNG** sửa `accounts.module.ts` (không thêm dependency mới).
- **KHÔNG** thêm cột DB (reason → audit).
- **Chỉ THÊM (additive)**: `LockUserDto` + `lockUser` + `unlockUser` + 2 endpoint + seed + test.
- **Không đụng UC khác**: KHÔNG ACTIVE↔INACTIVE (UC-11), KHÔNG xóa/soft-delete (UC-10), KHÔNG chạm `user_roles` (UC-08)/hồ sơ (UC-09), KHÔNG phá auto-lock (auth).

---

## 14. Checklist file cần TẠO / SỬA

### 🆕 TẠO MỚI
- [ ] `src/modules/accounts/dto/lock-user.dto.ts` — `LockUserDto` (`reason?` optional @IsString @MaxLength)
- [ ] `src/database/seeds/<timestamp>-SeedUserLockPermissions.ts` — 2 permission `accounts.user.lock` + `accounts.user.unlock` → SYSTEM_ADMIN + BUSINESS_ADMIN (**KHÔNG execute**)

### ✏️ SỬA (additive)
- [ ] `src/modules/accounts/services/users.service.ts` — thêm `lockUser(...)` + `unlockUser(...)`. **KHÔNG** thêm constructor param. **KHÔNG** sửa method khác.
- [ ] `src/modules/accounts/controllers/users.controller.ts` — thêm `@Patch(':userId/lock')` + `@Patch(':userId/unlock')` **khai báo TRƯỚC** `@Patch(':userId')` (UC-09) + guards + `@RequirePermissions(...)`.
- [ ] `src/modules/accounts/services/users.service.spec.ts` — L1–L11, U1–U4.
- [ ] `src/modules/accounts/controllers/users.controller.spec.ts` — LC1–LC4, UC1–UC2.

### ⛔ KHÔNG đổi
- `accounts.module.ts`, `login.service`/module auth, các method người khác, không thêm cột DB.
- KHÔNG set INACTIVE (UC-11)/xóa (UC-10), KHÔNG migration đổi schema, KHÔNG seed execute.

> ⚠️ Route: khai báo `@Patch(':userId/lock')` và `@Patch(':userId/unlock')` TRƯỚC `@Patch(':userId')`. Khác số segment nên không nuốt nhau, nhưng giữ thứ tự để an toàn (xác minh khi implement).

---

> Kết thúc plan. Bước tiếp theo (khi duyệt): tách `tasks.md` theo checklist §14. Chưa code, chưa chạy seed/migration.
