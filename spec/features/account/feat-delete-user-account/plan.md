# Implementation Plan: Xóa tài khoản người dùng (Delete user account — soft-delete)

> Feature ID: UC-10
> Module: accounts
> Created: 2026-07-12
> Status: Draft
> Spec nguồn: [spec.md](./spec.md) (đã duyệt, áp 11 quyết định chốt)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới plan.md cho UC-10 (soft-delete) dựa trên spec.md + 11 quyết định chốt + ràng buộc bảo vệ code thành viên khác. | Toàn bộ file |

---

## 0. Quyết định đã chốt (ràng buộc — không mở lại)

| # | Quyết định | Ảnh hưởng plan |
| :--- | :--- | :--- |
| 1 | SOFT-DELETE (`users.deleted_at = now()`), KHÔNG hard-delete | Dùng `softDelete`/`@DeleteDateColumn` (DATA-01) |
| 2 | Actor CHỈ SYSTEM_ADMIN; permission mới `accounts.user.delete` | Guard + seed 1 role |
| 3 | `DELETE /api/v1/users/:userId`, response 200 `{ success, message }` | 1 endpoint mới |
| 4 | 5 ràng buộc chặn xóa → 409 USER_HAS_DEPENDENCIES (details liệt kê loại) | 5 query READ ở Phase A |
| 5 | BR-01 tự xóa mình → 422 CANNOT_DELETE_SELF | check `targetUserId === actorId` |
| 6 | BR-02 SYSTEM_ADMIN cuối cùng → 422 LAST_SYSTEM_ADMIN | 1 query COUNT |
| 7 | BR-03 đã xóa/không tồn tại → 404 USER_NOT_FOUND | load `deletedAt IS NULL` |
| 8 | 1 transaction: soft-delete users + soft-remove user_roles + soft-delete face_profiles + vô hiệu device_user_mappings + audit atomic | Phase B |
| 9 | Post-commit: Redis `auth:user:{userId}:invalid_after = now()`, TTL ≥ refresh TTL | Phase C (RedisService) |
| 10 | Refresh flow: khảo sát → **KHÔNG tồn tại endpoint refresh** ⇒ không sửa auth (xem §2.2) | Không đụng auth |
| 11 | Permission `accounts.user.delete` gán CHỈ SYSTEM_ADMIN; seed KHÔNG execute | 1 seed file |

---

## 1. Feature Summary

Cho phép SYSTEM_ADMIN xóa (soft-delete) một tài khoản chưa phát sinh dữ liệu ràng buộc active qua `DELETE /api/v1/users/:userId`. Service kiểm tra tự-xóa, admin cuối cùng, và 5 ràng buộc tham chiếu (READ trên meetings/room_bookings/departments/users self-ref); nếu hợp lệ, trong một transaction: soft-delete `users`, vô hiệu `user_roles`, soft-delete `face_profiles`, vô hiệu `device_user_mappings`, và ghi `audit_logs` atomic. Sau commit, thu hồi toàn bộ token của user qua Redis `invalid_after` (tái dùng cơ chế có sẵn). Không hard-delete (DATA-01).

---

## 2. Technical Context (đã xác minh)

### 2.1 Hạ tầng tái dùng

| Thành phần | Chi tiết | Nguồn |
| :--- | :--- | :--- |
| Soft-delete `users` | `@DeleteDateColumn deletedAt`; mọi query filter `deletedAt: IsNull()` | [user.entity.ts:115](../../../../src/modules/accounts/entities/user.entity.ts#L115) |
| Token revocation | Guard từ chối access token có `iat*1000 < auth:user:{id}:invalid_after` | [jwt-auth.guard.ts:50-61](../../../../src/modules/auth/guards/jwt-auth.guard.ts#L50-L61); setter mẫu: [change-password.service.ts:161](../../../../src/modules/auth/services/change-password.service.ts#L161), [password-reset-cache.service.ts:162](../../../../src/modules/auth/services/password-reset-cache.service.ts#L162) |
| Transaction + audit atomic | `dataSource.transaction` + `em.create(AuditLogEntity)` | mirror `createUser` [users.service.ts](../../../../src/modules/accounts/services/users.service.ts) |
| `face_profiles`, `device_user_mappings` | đều có `@DeleteDateColumn deletedAt` ⇒ soft-delete được | [face-profile.entity.ts:78](../../../../src/modules/accounts/entities/face-profile.entity.ts#L78), [device-user-mapping.entity.ts:85](../../../../src/modules/iot/entities/device-user-mapping.entity.ts#L85) |

### 2.2 Refresh flow — KHÔNG tồn tại (quyết định #10 kết luận)

Các route của `auth.controller`: `POST login`, `POST logout`, `POST password-reset/request`, `POST password-reset/confirm`, `GET me` — **không có endpoint refresh**. `TokenService.generateRefreshToken` chỉ được gọi lúc login ([login.service.ts:123](../../../../src/modules/auth/services/login.service.ts#L123)); không có luồng đổi refresh→access.

> ⇒ **Không cần và KHÔNG sửa code auth.** `invalid_after` đã đủ thu hồi mọi access token qua `JwtAuthGuard`. Refresh token hiện là artifact không tiêu thụ được (không có endpoint). **Yêu cầu tương lai (ghi chú, không thuộc UC-10)**: khi thêm endpoint refresh, PHẢI kiểm `invalid_after` trước khi cấp access token mới — nêu trong spec auth tương lai, không xử lý ở đây.

### 2.3 Enum/field thật cho ràng buộc §4 (đã xác minh)

| Bảng | Field | Enum/giá trị |
| :--- | :--- | :--- |
| `meetings` | `organizer_id` (NOT NULL), `host_id`, `start_time`, `end_time`, `status` | `MeetingStatus`: `scheduled`, `in_progress`, `completed`, `cancelled` ([meeting.entity.ts:34-40,103-106](../../../../src/modules/meetings/entities/meeting.entity.ts#L34)) |
| `meeting_participants` | `user_id`, `meeting_id` | (join meetings) |
| `room_bookings` | `booked_by`, `reserved_start_time`, `reserved_end_time`, `status` | `RoomBookingStatus`: `pending`, `approved`, `active`, `completed`, `cancelled`, `released` ([room-booking.entity.ts:52-62](../../../../src/modules/rooms/entities/room-booking.entity.ts#L52)) |
| `users` | `direct_manager_id`, `account_status`, `deleted_at` | self-ref |
| `departments` | `manager_user_id`, `is_active`, `deleted_at` | [department.entity.ts:36,42](../../../../src/modules/accounts/entities/department.entity.ts#L36) |

### 2.4 Constitution / Rule gate

| Gate | Status | Ghi chú |
| :--- | :--- | :--- |
| DATA-01 (soft-delete) | ✅ | `softDelete`, không hard-delete |
| SEC-02 (auth mutating) | ✅ | DELETE có Jwt + Permissions guard |
| SEC-03 (validate) | ✅ | `ParseUUIDPipe` |
| ENG-03 (error format) | ✅ | inline `{success,message,error}` |
| Scope Gate | ✅ | Chỉ UC-10 |

---

## 3. Kiến trúc & luồng

```
DELETE /api/v1/users/:userId
  │  JwtAuthGuard → 401 ; PermissionsGuard @RequirePermissions('accounts.user.delete') → 403
  ▼
UsersController.deleteUser(userId, request, ip, headers)
  │  ParseUUIDPipe(userId)
  ▼
UsersService.deleteUser(targetUserId, actorId, clientContext)
  │  Phase A — validate (READ):
  │    A.1 load target (deleted_at IS NULL) → 404 USER_NOT_FOUND
  │    A.2 BR-01 self → 422 CANNOT_DELETE_SELF
  │    A.3 BR-02 last SYSTEM_ADMIN → 422 LAST_SYSTEM_ADMIN
  │    A.4 5 ràng buộc tham chiếu (EXISTS/COUNT) → 409 USER_HAS_DEPENDENCIES
  │  Phase B — transaction (atomic):
  │    softDelete users + update user_roles (is_active=false, expired_at=now)
  │    + softDelete face_profiles + softDelete device_user_mappings + audit ACCOUNT_DELETE
  │  Phase C — post-commit:
  │    Redis SET auth:user:{userId}:invalid_after = now (TTL ≥ refresh TTL)
  ▼
Response 200 { success, message }
```

> **Vị trí code**: thêm method `deleteUser` vào `UsersService` (mirror pattern transaction/audit). **KHÔNG** sửa `createUser/getUserDetail/updateUser/updateUserRoles/listUsers/resolveDepartmentScope` — chỉ **đọc tham chiếu**. Cần **thêm** dependency `RedisService` vào constructor `UsersService` (additive; xem §9 tác động code người khác).

---

## 4. Service Design chi tiết

### 4.1 Chữ ký
```
async deleteUser(
  targetUserId: string,
  actorId: string,
  clientContext: UserClientContext,
): Promise<void>   // controller tự bọc { success, message }
```

### 4.2 Phase A — Validate (READ, ngoài transaction)

1. **A.1** `findOne(UserEntity, { where: { id: targetUserId, deletedAt: IsNull() } })` → null: `NotFoundException` **USER_NOT_FOUND** (BR-03).
2. **A.2 BR-01**: `targetUserId === actorId` → `UnprocessableEntityException` **CANNOT_DELETE_SELF**.
3. **A.3 BR-02 last SYSTEM_ADMIN**: nếu target đang giữ role `SYSTEM_ADMIN` active, đếm số user **khác** target còn active giữ `SYSTEM_ADMIN` active; nếu `0` → `UnprocessableEntityException` **LAST_SYSTEM_ADMIN**.
   - Query (READ): `user_roles ur JOIN roles r ON r.id=ur.role_id JOIN users u ON u.id=ur.user_id WHERE r.role_code='SYSTEM_ADMIN' AND r.is_active AND ur.is_active AND (ur.expired_at IS NULL OR ur.expired_at > now()) AND u.deleted_at IS NULL AND u.account_status='active' AND u.id <> :targetUserId` → COUNT. Chỉ chạy nếu target thuộc SYSTEM_ADMIN.
4. **A.4 Ràng buộc tham chiếu** (mỗi loại 1 query EXISTS/COUNT, **CHỈ READ**; gom tất cả loại vi phạm vào `details` rồi mới ném 409):

| Loại | Query READ | Điều kiện "active/sắp tới" |
| :--- | :--- | :--- |
| (a) organizer/host meeting | `meetings WHERE (organizer_id=:t OR host_id=:t) AND status IN ('scheduled','in_progress') AND end_time > now()` | chưa kết thúc/chưa hủy |
| (b) participant meeting | `meeting_participants mp JOIN meetings m ON m.id=mp.meeting_id WHERE mp.user_id=:t AND m.status IN ('scheduled','in_progress') AND m.end_time > now()` | như trên |
| (c) booked_by booking | `room_bookings WHERE booked_by=:t AND status IN ('pending','approved','active') AND reserved_end_time > now()` | booking còn hiệu lực |
| (d) direct_manager | `users WHERE direct_manager_id=:t AND deleted_at IS NULL AND account_status='active'` | còn cấp dưới active |
| (e) department manager | `departments WHERE manager_user_id=:t AND deleted_at IS NULL AND is_active=true` | đang là trưởng phòng |

   - Nếu bất kỳ loại nào có bản ghi → `ConflictException` **USER_HAS_DEPENDENCIES**, `details = { dependencies: ['upcoming_meeting_host','upcoming_meeting_participant','active_booking','manages_users','manages_department'] }` (chỉ liệt kê loại vi phạm).
   - Truy vấn qua `EntityManager` (import entity class các module khác **chỉ để READ**): `MeetingEntity`, `MeetingParticipantEntity`, `RoomBookingEntity`, `DepartmentEntity`, `UserEntity`. **KHÔNG** gọi service của module khác, **KHÔNG** sửa code module đó.
   - ⚠️ **Xác minh khi implement**: tập status "chưa kết thúc" chính xác (có value nào khác `scheduled`/`in_progress` cần tính không, vd trạng thái tạm hoãn); mốc thời gian dùng `end_time`/`reserved_end_time > now()`.

### 4.3 Phase B — Transaction (atomic)

`await this.dataSource.transaction(async (tem) => { ... })`:
1. **Soft-delete users**: `tem.softDelete(UserEntity, targetUserId)` (set `deleted_at`).
2. **Vô hiệu user_roles active**: `tem.update(UserRoleEntity, { userId: targetUserId, isActive: true }, { isActive: false, expiredAt: new Date() })`.
3. **Soft-delete face_profiles**: `tem.softDelete(FaceProfileEntity, { userId: targetUserId })` (entity có `deletedAt`).
4. **Vô hiệu device_user_mappings**: `tem.softDelete(DeviceUserMappingEntity, { userId: targetUserId })` (entity có `deletedAt`). Import entity class **chỉ để ghi trong transaction xóa của ta** — không sửa code module iot.
5. **Audit atomic**: `tem.save(tem.create(AuditLogEntity, { userId: actorId, actionType: 'ACCOUNT_DELETE', entityType: 'users', entityId: targetUserId, severity: AuditLogSeverity.WARNING, oldValueJson: <hồ sơ user + roleIds snapshot>, ipAddress, userAgent, requestId }))`. **KHÔNG** log `password_hash`/token/secret.

> `oldValueJson` snapshot gợi ý: `{ id, email, fullName, employeeCode, departmentId, roleIds }` (roleIds lấy từ user_roles active trước khi vô hiệu — đọc ở Phase A hoặc đầu transaction).

### 4.4 Phase C — Post-commit (thu hồi token)

- `await this.redisService.setWithTtl('auth:user:' + targetUserId + ':invalid_after', String(Date.now()), <ttl>)` — `<ttl>` = `authConfigService.getRefreshTokenTtlSeconds()` (hoặc ≥ đó) để đảm bảo bao trùm vòng đời token.
- Đặt **sau commit** (tránh thu hồi khi rollback). Nếu set Redis fail → log cảnh báo (không rollback DB; user đã soft-delete). **Xác minh**: cân nhắc retry/log — không throw để tránh trạng thái nửa vời.
- API `setWithTtl` đã có ([logout.service.ts:24](../../../../src/modules/auth/services/logout.service.ts#L24) dùng `redisService.setWithTtl`).

---

## 5. Error Handling Plan

Convention inline module. Error codes hằng số cục bộ.

| error.code | HTTP | Exception | Nơi |
| :--- | :--- | :--- | :--- |
| (validation) | 400 | ParseUUIDPipe (`INVALID_USER_ID`) | param |
| UNAUTHORIZED | 401 | JwtAuthGuard | guard |
| FORBIDDEN | 403 | PermissionsGuard | guard |
| USER_NOT_FOUND | 404 | NotFoundException | A.1 |
| CANNOT_DELETE_SELF | 422 | UnprocessableEntityException | A.2 |
| LAST_SYSTEM_ADMIN | 422 | UnprocessableEntityException | A.3 |
| USER_HAS_DEPENDENCIES | 409 | ConflictException (details liệt kê loại) | A.4 |
| (500) | 500 | filter | không lộ stack trace |

---

## 6. Audit Plan

- `em.create(AuditLogEntity)` **trong transaction** (atomic). `action_type='ACCOUNT_DELETE'`, `entity_type='users'`, `entity_id=targetUserId`, `severity=AuditLogSeverity.WARNING`, `old_value_json` = hồ sơ user (không secret). CLAUDE.md §17 ("delete user") bắt buộc audit.

---

## 7. RBAC & Seed

- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('accounts.user.delete')`.
- Seed (MÔ TẢ, KHÔNG chạy): `src/database/seeds/<ts>-SeedUserDeletePermission.ts`, mirror [SeedDepartmentReadPermission.ts](../../../../src/database/seeds/20260704000001-SeedDepartmentReadPermission.ts). Permission `accounts.user.delete` (`module_code=accounts`, `action_code=delete`), gán role-set **CHỈ `['SYSTEM_ADMIN']`**. `ON CONFLICT DO NOTHING`. KHÔNG thêm runner, KHÔNG execute. Grep xác nhận `accounts.user.delete` chưa tồn tại trước khi tạo.

---

## 8. Test Plan (liệt kê — không code)

### 8.1 Unit — `UsersService.deleteUser` (`users.service.spec.ts`, MODIFY)
| # | Test | Kỳ vọng |
| :--- | :--- | :--- |
| D1 | Happy path | softDelete users + update user_roles (is_active=false) + softDelete face_profiles + softDelete device_user_mappings + audit ACCOUNT_DELETE (WARNING); Redis `invalid_after` set post-commit |
| D2 | BR-01 self-delete | 422 CANNOT_DELETE_SELF, không WRITE |
| D3 | BR-02 last SYSTEM_ADMIN | 422 LAST_SYSTEM_ADMIN, không WRITE |
| D4 | BR-02 còn admin khác | thành công (không chặn) |
| D5 | BR-03 đã xóa/không tồn tại | 404 USER_NOT_FOUND |
| D6 | Ràng buộc (a) meeting host/organizer | 409 USER_HAS_DEPENDENCIES (details có `upcoming_meeting_host`) |
| D7 | Ràng buộc (b) participant | 409 (`upcoming_meeting_participant`) |
| D8 | Ràng buộc (c) booking | 409 (`active_booking`) |
| D9 | Ràng buộc (d) direct_manager | 409 (`manages_users`) |
| D10 | Ràng buộc (e) department manager | 409 (`manages_department`) |
| D11 | Rollback — WRITE lỗi trong transaction | reject; Redis revoke KHÔNG chạy (post-commit) |
| D12 | Redis set fail post-commit | không throw (log), DB vẫn soft-deleted |

### 8.2 Controller — `users.controller.spec.ts` (MODIFY)
| # | Test | Kỳ vọng |
| :--- | :--- | :--- |
| DC1 | Success | gọi `service.deleteUser(userId, actorId, ctx)`, trả `{ success, message }` |
| DC2 | userId không UUID | 400 INVALID_USER_ID |
| DC3 | Guard metadata | `[JwtAuthGuard, PermissionsGuard]` |
| DC4 | Permission metadata | `['accounts.user.delete']` |

---

## 9. Tác động lên code người khác (BẮT BUỘC — bảo vệ)

### 9.1 CHỈ ĐỌC (không sửa)
- `createUser`, `getUserDetail`, `updateUser` (UC-09), `updateUserRoles` (UC-08), `listUsers`, `resolveDepartmentScope` trong `UsersService` — **chỉ đọc để mirror pattern**, KHÔNG sửa.
- Module **meetings/rooms/departments**: chỉ **READ** qua `MeetingEntity`/`MeetingParticipantEntity`/`RoomBookingEntity`/`DepartmentEntity` (import entity class cho query EntityManager). **KHÔNG** gọi/sửa service của các module này.
- Module **iot**: import `DeviceUserMappingEntity` để soft-delete trong transaction xóa của ta. **KHÔNG** sửa code iot.
- Module **auth**: **KHÔNG sửa** (không có endpoint refresh — §2.2). Chỉ dùng `RedisService.setWithTtl` (API công khai có sẵn).

### 9.2 THÊM tối thiểu (additive, không đổi logic hiện có)
- `UsersService` (constructor): **thêm** dependency `RedisService` (và có thể `AuthConfigService` để lấy refresh TTL). Chỉ thêm tham số constructor + method mới `deleteUser` — KHÔNG động method khác.
- `UsersController`: **thêm** method `@Delete(':userId')` — KHÔNG động endpoint khác.
- `accounts.module.ts`: **có thể phải thêm** import module cung cấp `RedisService` (và `AuthConfigService`) NẾU chúng không phải `@Global()`. → **Xác minh R1**. Nếu là `@Global()` → chỉ cần thêm constructor param, KHÔNG sửa module. Đây là thay đổi **additive** duy nhất tới file dùng chung; nếu phát sinh **circular dependency** (accounts ↔ auth/redis) → **DỪNG, báo cáo, đề xuất** (vd chuyển revoke sang một provider trung gian), KHÔNG tự ý sửa sâu.

---

## 10. Rủi ro & điểm cần xác minh

| # | Rủi ro / xác minh | Hành động |
| :--- | :--- | :--- |
| R1 | `RedisService`/`AuthConfigService` có `@Global()` không → quyết định có sửa `accounts.module.ts` | Kiểm module khai báo; ưu tiên phương án không sửa module nếu Global; nếu cần import → kiểm circular dep, nếu có → DỪNG + báo cáo |
| R2 | Tập `status` "chưa kết thúc" của meeting/booking chính xác (ngoài scheduled/in_progress, pending/approved/active) | Đọc lại enum + rule nghiệp vụ; ghi rõ trong code |
| R3 | `device_user_mappings` soft-delete bằng `deletedAt` (đã xác minh có cột) | `tem.softDelete(DeviceUserMappingEntity, { userId })` |
| R4 | Refresh flow tương lai phải honor `invalid_after` | Ghi chú yêu cầu; UC-10 không xử lý |
| R5 | TTL key `invalid_after` ≥ refresh TTL | `getRefreshTokenTtlSeconds()` |
| R6 | `EntityManager` truy cập entity cross-module (đăng ký trong data-source) | Xác nhận entity nằm trong `data-source.ts` entities (đều là @Entity đã đăng ký) |
| R7 | Redis set fail post-commit | log cảnh báo, không throw, không rollback |

---

## 11. Checklist file cần TẠO / SỬA

### 🆕 TẠO MỚI
- [ ] `src/database/seeds/<timestamp>-SeedUserDeletePermission.ts` — permission `accounts.user.delete` → CHỈ `SYSTEM_ADMIN` (**KHÔNG execute**)

### ✏️ SỬA (additive)
- [ ] `src/modules/accounts/services/users.service.ts` — thêm `deleteUser(...)`; thêm import entity READ (Meeting/MeetingParticipant/RoomBooking) + DeviceUserMapping/FaceProfile; thêm `RedisService` (và `AuthConfigService`) vào constructor. **KHÔNG** sửa method khác.
- [ ] `src/modules/accounts/controllers/users.controller.ts` — thêm `@Delete(':userId')` + guards. **KHÔNG** sửa endpoint khác.
- [ ] `src/modules/accounts/accounts.module.ts` — **CHỈ NẾU** RedisService/AuthConfigService không `@Global()`: thêm import module tương ứng (additive). Nếu Global → không sửa. (R1)
- [ ] `src/modules/accounts/services/users.service.spec.ts` — D1–D12.
- [ ] `src/modules/accounts/controllers/users.controller.spec.ts` — DC1–DC4.

### ⛔ KHÔNG đổi
- `createUser/getUserDetail/updateUser/updateUserRoles/listUsers/resolveDepartmentScope`.
- Code module **meetings/rooms/departments/iot/auth** (chỉ READ entity / dùng API công khai).
- KHÔNG hard-delete, KHÔNG migration đổi schema, KHÔNG seed execute.

---

> Kết thúc plan. Bước tiếp theo (khi duyệt): tách `tasks.md` theo checklist §11. Chưa code, chưa chạy seed/migration. Nếu R1 dẫn tới circular dependency khi wiring RedisService → DỪNG và báo cáo trước khi implement.
