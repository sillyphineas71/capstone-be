# Tasks: Xóa tài khoản người dùng (Delete user account — soft-delete)

**Feature**: UC-10
**Module**: accounts
**Priority**: P1
**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới tasks.md cho UC-10 (soft-delete) theo spec.md + plan.md + 8 quyết định chốt + ràng buộc bảo vệ code + quy tắc an toàn cứng. | Toàn bộ file |

---

## 0. Ràng buộc chốt (áp cho mọi task — không mở lại)

1. **SOFT-DELETE** (`users.deleted_at = now()`), KHÔNG hard-delete (DATA-01).
2. Actor **CHỈ SYSTEM_ADMIN**; permission mới `accounts.user.delete`.
3. **`DELETE /api/v1/users/:userId`**; response `200 { success, message }`.
4. **5 ràng buộc chặn xóa** → `409 USER_HAS_DEPENDENCIES` (details liệt kê **tất cả** loại vi phạm): (a) organizer/host meeting `status IN ('scheduled','in_progress') AND end_time > now()`; (b) participant meeting tương tự; (c) `booked_by` booking `status IN ('pending','approved','active') AND reserved_end_time > now()`; (d) là `direct_manager_id` của user khác active; (e) là `departments.manager_user_id` active. **Gom hết loại vi phạm rồi mới ném 409.**
5. **BR-01** self → `422 CANNOT_DELETE_SELF`; **BR-02** last SYSTEM_ADMIN active → `422 LAST_SYSTEM_ADMIN`; **BR-03** đã xóa/không tồn tại → `404 USER_NOT_FOUND`.
6. **Phase B transaction atomic**: `softDelete users` + `update user_roles` (is_active=false, expired_at=now) + `softDelete face_profiles` + `softDelete device_user_mappings` + audit atomic (`ACCOUNT_DELETE`, severity `WARNING`, `old_value_json = {id,email,fullName,employeeCode,departmentId,roleIds}`, không secret). **`roleIds` đọc TRƯỚC khi vô hiệu user_roles.**
7. **Phase C post-commit** (ngoài transaction): Redis `setWithTtl('auth:user:{userId}:invalid_after', now, getRefreshTokenTtlSeconds())`. Redis fail → **log, KHÔNG throw, KHÔNG rollback**.
8. Permission `accounts.user.delete` gán **CHỈ SYSTEM_ADMIN**; seed **KHÔNG execute / KHÔNG thêm runner**.

### ⛔ KHÔNG được làm (áp toàn feature)
- KHÔNG execute seed, KHÔNG chạy migration, KHÔNG commit.
- KHÔNG sửa `createUser`, `getUserDetail`, `updateUser` (UC-09), `updateUserRoles` (UC-08), `listUsers`, `resolveDepartmentScope` — chỉ đọc tham chiếu.
- Module **meetings/rooms/departments/iot**: CHỈ READ entity qua `EntityManager`. KHÔNG gọi/sửa service của chúng.
- Module **auth**: KHÔNG sửa (không có endpoint refresh). Chỉ dùng `RedisService.setWithTtl` (API công khai).
- Chỉ THÊM (additive): `deleteUser` + constructor param + `@Delete` endpoint + seed + test. KHÔNG động method/endpoint khác.

### 🛑 Quy tắc an toàn cứng
- Nếu wiring `RedisService`/`AuthConfigService` vào `UsersService` gây **CIRCULAR DEPENDENCY** (accounts ↔ auth/redis) → **DỪNG NGAY** (T001), KHÔNG tự sửa sâu/không phá module, ghi báo cáo + đề xuất phương án (provider trung gian / event) cho người review quyết.
- Trước khi thêm import vào `accounts.module.ts`: PHẢI kiểm `@Global()`. Nếu Global → chỉ thêm constructor param, KHÔNG sửa module.

### Format
- `[Txxx]` Task ID tuần tự · `[VERIFY]`/`[CREATE]`/`[MODIFY]` + đường dẫn · **DoD** = definition of done.

---

## Phase 0 — Tiền kiểm wiring (CỔNG AN TOÀN, làm TRƯỚC mọi thứ)

| Dependency | Task |
|---|---|
| — | T001 |

- [ ] **T001** `[VERIFY]` Xác minh khả năng inject `RedisService` + `AuthConfigService` vào `UsersService` mà không gây circular dependency.
  - Đọc module khai báo `RedisService` (`src/modules/redis/redis.module.ts` hoặc tương đương) và `AuthConfigService` (trong `auth`): kiểm có `@Global()` không, và có `exports` chúng không.
  - Vẽ nhanh chuỗi phụ thuộc: `AccountsModule` → (import gì để có RedisService/AuthConfigService) → có tạo vòng `accounts → auth → accounts` / `accounts → redis → accounts` không. Lưu ý `AccountsModule` hiện đã import `AuthModule` ([accounts.module.ts:57](../../../../src/modules/accounts/accounts.module.ts#L57)) → nếu `AuthConfigService` nằm trong `AuthModule` và được export, có thể đã sẵn dùng; nhưng `AuthModule` có import ngược `AccountsModule` không → nếu có thì THÊM dependency mới vẫn an toàn (đã tồn tại quan hệ) nhưng phải xác nhận không tạo vòng mới ở tầng provider.
  - **Kết luận 1 trong 3 nhánh, ghi rõ vào báo cáo:**
    - **(A) An toàn — Global/đã export, không circular** → tiếp T002, chỉ thêm constructor param (KHÔNG sửa `accounts.module.ts` nếu Global).
    - **(B) An toàn nhưng cần thêm import module** vào `accounts.module.ts` (không Global, không circular) → được phép sửa `accounts.module.ts` **additive** (chỉ thêm import), tiếp T002.
    - **(C) CIRCULAR / rủi ro** → **DỪNG toàn bộ UC-10 implement**, KHÔNG viết `deleteUser`, ghi báo cáo: vị trí vòng phụ thuộc + đề xuất (vd tách `TokenRevocationService` ở module redis/global, hoặc emit event `UserDeletedEvent` cho auth xử lý revoke). Chờ người review quyết.
  - Phụ: xác nhận `getRefreshTokenTtlSeconds()` khả dụng qua `AuthConfigService`; nếu không, dùng cấu hình TTL khác (ghi rõ) hoặc hằng số cấu hình.
  - Phụ: grep xác nhận permission `accounts.user.delete` **chưa tồn tại** (chuẩn bị T006).
  - **DoD**: có kết luận nhánh (A/B/C) kèm bằng chứng (file/dòng module, quan hệ import). Nếu (C) → dừng, không thực thi T002–T007, chỉ giữ T001 báo cáo. Nếu (A/B) → ghi rõ chiến lược wiring cho T002.

---

## Phase 1 — Service `UsersService.deleteUser`

> Thêm method `deleteUser` vào `UsersService`. Import (READ-only) entity cross-module: `MeetingEntity`, `MeetingParticipantEntity`, `RoomBookingEntity` (+ status enum), `DepartmentEntity` (đã có trong accounts), `DeviceUserMappingEntity`, `FaceProfileEntity`. Thêm constructor param theo kết luận T001. **KHÔNG** sửa method khác. Truy vấn qua `this.dataSource.manager`/`EntityManager` (entity đã đăng ký trong data-source).

| Dependency | Task |
|---|---|
| T001 (nhánh A/B) → | T002 |
| T002 → | T003 |
| T003 → | T004 |

- [ ] **T002** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — khung `deleteUser` + **Phase A validate (READ)**.
  - Chữ ký: `async deleteUser(targetUserId: string, actorId: string, clientContext: UserClientContext): Promise<void>`.
  - A.1 Load target: `findOne(UserEntity, { where: { id: targetUserId, deletedAt: IsNull() } })` → null: `NotFoundException` **USER_NOT_FOUND** (BR-03).
  - A.2 **BR-01**: `targetUserId === actorId` → `UnprocessableEntityException` **CANNOT_DELETE_SELF**.
  - A.3 **BR-02 last SYSTEM_ADMIN**: nếu target đang giữ `SYSTEM_ADMIN` active, COUNT user **khác** target còn active giữ `SYSTEM_ADMIN` active; `0` → `UnprocessableEntityException` **LAST_SYSTEM_ADMIN**. Query READ (join `user_roles`+`roles`+`users`, filter `role_code='SYSTEM_ADMIN'`, `r.is_active`, `ur.is_active`, `ur.expired_at IS NULL OR > now()`, `u.deleted_at IS NULL`, `u.account_status='active'`, `u.id <> target`).
  - A.4 **5 ràng buộc** (mỗi loại 1 query EXISTS/COUNT, CHỈ READ; gom loại vi phạm vào mảng `dependencies` rồi ném 1 lần):

    | Loại (details key) | Query READ |
    |---|---|
    | `upcoming_meeting_host` | `MeetingEntity` WHERE `(organizer_id=:t OR host_id=:t) AND status IN ('scheduled','in_progress') AND end_time > now()` |
    | `upcoming_meeting_participant` | `MeetingParticipantEntity` JOIN `MeetingEntity` WHERE `mp.user_id=:t AND m.status IN ('scheduled','in_progress') AND m.end_time > now()` |
    | `active_booking` | `RoomBookingEntity` WHERE `booked_by=:t AND status IN ('pending','approved','active') AND reserved_end_time > now()` |
    | `manages_users` | `UserEntity` WHERE `direct_manager_id=:t AND deleted_at IS NULL AND account_status='active'` |
    | `manages_department` | `DepartmentEntity` WHERE `manager_user_id=:t AND deleted_at IS NULL AND is_active=true` |

    - Nếu `dependencies.length > 0` → `ConflictException` **USER_HAS_DEPENDENCIES**, `error.details = { dependencies }`.
    - Dùng status enum thật: `MeetingStatus` ([meeting.entity.ts:34-40](../../../../src/modules/meetings/entities/meeting.entity.ts#L34)), `RoomBookingStatus` ([room-booking.entity.ts](../../../../src/modules/rooms/entities/room-booking.entity.ts)). **Xác minh** tập "chưa kết thúc" nếu có value khác.
  - Exception format inline module `{ success:false, message, error:{ code, details } }`.
  - **DoD**: method tồn tại, tsc pass; các nhánh ném đúng exception/HTTP; chưa có WRITE; 5 query chỉ READ; import entity cross-module chỉ để query.

- [ ] **T003** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — **Phase B transaction (atomic)**.
  - Đọc `roleIds` active của target **TRƯỚC** khi vô hiệu (cho audit snapshot): `find(UserRoleEntity, { where: { userId: targetUserId, isActive: true } })` → `roleIds`.
  - `await this.dataSource.transaction(async (tem) => { ... })`:
    1. `tem.softDelete(UserEntity, targetUserId)` (set `deleted_at`).
    2. `tem.update(UserRoleEntity, { userId: targetUserId, isActive: true }, { isActive: false, expiredAt: new Date() })`.
    3. `tem.softDelete(FaceProfileEntity, { userId: targetUserId })`.
    4. `tem.softDelete(DeviceUserMappingEntity, { userId: targetUserId })` (entity có `deletedAt`).
    5. Audit atomic: `tem.save(tem.create(AuditLogEntity, { userId: actorId, actionType: 'ACCOUNT_DELETE', entityType: 'users', entityId: targetUserId, severity: AuditLogSeverity.WARNING, oldValueJson: { id, email, fullName, employeeCode, departmentId, roleIds }, ipAddress: clientContext.ipAddress||null, userAgent: clientContext.userAgent||null, requestId: clientContext.requestId||null }))`. `action_type` hằng số cục bộ. KHÔNG log secret.
  - **DoD**: transaction thực hiện đủ 5 thao tác, atomic (rollback nếu 1 bước lỗi); `old_value_json` đúng snapshot, không secret; softDelete dùng `@DeleteDateColumn` (không hard-delete); tsc pass.

- [ ] **T004** `[MODIFY]` `src/modules/accounts/services/users.service.ts` — **Phase C post-commit (revoke token)** + constructor wiring.
  - Sau khi transaction commit: `await this.redisService.setWithTtl('auth:user:' + targetUserId + ':invalid_after', String(Date.now()), <ttl>)` với `<ttl> = this.authConfigService.getRefreshTokenTtlSeconds()` (theo T001).
  - Bọc try/catch: Redis fail → `this.logger.error(...)`, **KHÔNG throw, KHÔNG rollback** (user đã soft-delete).
  - Constructor: thêm `RedisService` (+ `AuthConfigService` nếu cần TTL) theo nhánh T001 (A: chỉ param; B: kèm import module ở T00x accounts.module). **KHÔNG** đổi các dependency/method hiện có.
  - **DoD**: revoke chạy sau commit; Redis fail không làm hỏng luồng; constructor chỉ THÊM param; không sửa method khác; tsc pass.

- [ ] **T004b** `[MODIFY — CHỈ NHÁNH B]` `src/modules/accounts/accounts.module.ts` — thêm import module cung cấp `RedisService`/`AuthConfigService` (additive) **chỉ khi** T001 kết luận nhánh (B). Nếu nhánh (A) Global → **BỎ QUA task này**.
  - **DoD**: chỉ thêm 1 import module (additive), không đổi controllers/providers khác, không circular; app khởi tạo được (tsc pass). Nếu phát sinh circular khi thêm → DỪNG, quay lại quy tắc an toàn cứng (báo cáo).

---

## Phase 2 — Controller

| Dependency | Task |
|---|---|
| T004 → | T005 |

- [ ] **T005** `[MODIFY]` `src/modules/accounts/controllers/users.controller.ts` — thêm `@Delete(':userId')`.
  - Decorators: `@Delete(':userId')`, `@HttpCode(HttpStatus.OK)`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('accounts.user.delete')`, `@ApiBearerAuth()`, `@ApiOperation`/`@ApiParam`/`@ApiResponse` (ENG-02).
  - Param `userId` qua `ParseUUIDPipe` (mirror `getUserDetail`, code `INVALID_USER_ID`). Không body.
  - Lấy actor + context: `request['user']` → `actorId`, `@Ip()`, `@Headers('user-agent')`, `@Headers('x-request-id')`.
  - Gọi `await this.usersService.deleteUser(userId, actorId, { ipAddress, userAgent, requestId })`; trả `{ success: true, message: 'Đã xóa tài khoản thành công' }`.
  - **DoD**: endpoint mount `DELETE /api/v1/users/:userId`; guards + permission đúng; KHÔNG đổi endpoint khác; tsc pass.

---

## Phase 3 — Seed permission (TẠO FILE, KHÔNG CHẠY)

| Dependency | Task |
|---|---|
| — (song song được) | T006 |

- [ ] **T006** `[CREATE]` `src/database/seeds/<timestamp>-SeedUserDeletePermission.ts` — permission `accounts.user.delete`.
  - Mirror [SeedDepartmentReadPermission.ts](../../../../src/database/seeds/20260704000001-SeedDepartmentReadPermission.ts): `queryRunner` + transaction.
  - INSERT permission `permission_code='accounts.user.delete'`, `permission_name='Xóa tài khoản người dùng'`, `module_code='accounts'`, `action_code='delete'`, `is_active=true`, `ON CONFLICT DO NOTHING RETURNING id`.
  - Gán role-set **CHỈ `['SYSTEM_ADMIN']`** → INSERT `role_permissions ... ON CONFLICT DO NOTHING`.
  - Idempotent, rollback. Grep xác nhận code chưa tồn tại (T001 phụ).
  - ⚠️ KHÔNG thêm runner; KHÔNG execute.
  - **DoD**: file tồn tại, tsc pass; role-set chỉ `SYSTEM_ADMIN`; không lệnh chạy seed nào thực thi.

---

## Phase 4 — Unit test Service (D1–D12)

| Dependency | Task |
|---|---|
| T004 → | T007 |

- [ ] **T007** `[MODIFY]` `src/modules/accounts/services/users.service.spec.ts` — suite `deleteUser` phủ D1–D12 (plan §8.1). Mock `dataSource.transaction`/`manager`/`em` (`findOne/find/count/softDelete/update/create/save`) + mock `RedisService.setWithTtl` + `AuthConfigService.getRefreshTokenTtlSeconds`.
  - D1 Happy path: `softDelete(UserEntity)` + `update(UserRoleEntity, ..., {isActive:false})` + `softDelete(FaceProfileEntity)` + `softDelete(DeviceUserMappingEntity)` + audit `ACCOUNT_DELETE`/WARNING với `old_value_json` đúng snapshot; `redisService.setWithTtl('auth:user:...:invalid_after', ...)` gọi **sau** commit.
  - D2 BR-01 self → 422 CANNOT_DELETE_SELF, không WRITE.
  - D3 BR-02 last SYSTEM_ADMIN (count khác = 0) → 422 LAST_SYSTEM_ADMIN, không WRITE.
  - D4 BR-02 còn admin khác (count ≥ 1) → không chặn (đi tiếp).
  - D5 BR-03 đã xóa/không tồn tại → 404 USER_NOT_FOUND.
  - D6 Ràng buộc (a) → 409, `details.dependencies` chứa `upcoming_meeting_host`.
  - D7 Ràng buộc (b) → 409, `upcoming_meeting_participant`.
  - D8 Ràng buộc (c) → 409, `active_booking`.
  - D9 Ràng buộc (d) → 409, `manages_users`.
  - D10 Ràng buộc (e) → 409, `manages_department`.
  - (khuyến nghị) D10b nhiều loại vi phạm cùng lúc → `details.dependencies` chứa đủ các loại.
  - D11 Rollback: WRITE trong transaction lỗi → reject; `redisService.setWithTtl` **KHÔNG** được gọi (post-commit).
  - D12 Redis set fail post-commit → **không throw** (resolve), DB vẫn soft-deleted (transaction đã commit).
  - **DoD**: các test pass; assert có/không WRITE, nội dung audit, thứ tự revoke sau commit; coverage nhánh ≥ ENG-01 (80%).

---

## Phase 5 — Controller test (DC1–DC4)

| Dependency | Task |
|---|---|
| T005 → | T008 |

- [ ] **T008** `[MODIFY]` `src/modules/accounts/controllers/users.controller.spec.ts` — test `DELETE :userId` phủ DC1–DC4 (plan §8.2). Mock `UsersService.deleteUser`; đọc metadata guard/permission như pattern hiện có.
  - DC1 Success: gọi `deleteUser(userId, actorId, ctx)`; trả `{ success:true, message }`.
  - DC2 `userId` không UUID → 400 (`INVALID_USER_ID`).
  - DC3 Guard metadata `deleteUser` = `[JwtAuthGuard, PermissionsGuard]`.
  - DC4 Permission metadata = `['accounts.user.delete']`.
  - **DoD**: 4 test pass; xác nhận permission đúng; không phá test hiện có.

---

## Phase 6 — Cổng chất lượng

| Dependency | Task |
|---|---|
| T001–T008 → | T009 |

- [ ] **T009** Chạy cổng chất lượng trên file đã đụng (KHÔNG commit).
  1. **tsc**: `npx tsc --noEmit`. Kỳ vọng: 0 lỗi **mới** ở file production (service/controller/seed).
  2. **eslint** file đã tạo/sửa (chạy `--fix` cho prettier): dto không có (DELETE không body); gồm `users.service.ts`, `users.controller.ts`, seed, 2 spec, (accounts.module.ts nếu nhánh B).
  3. **jest**: `npx jest src/modules/accounts src/modules/auth/guards`.
  4. **Baseline vs mới**: nếu nghi lỗi có sẵn → `git stash` chạy lại lấy baseline, `git stash pop`; chỉ xử lý lỗi **mới** do UC-10. Ghi rõ lỗi baseline vs mới kèm bằng chứng `git stash`.
  - **DoD**: production files **tsc & eslint sạch** (hoặc chỉ lỗi trùng pattern seed/mock baseline đã chứng minh); jest phạm vi trên **pass**; lỗi còn lại chứng minh baseline; **KHÔNG commit**, **KHÔNG chạy seed/migration**.

---

## Bảng truy vết Task ↔ file ↔ ràng buộc

| Task | Loại | File | Ràng buộc/DoD chính |
|---|---|---|---|
| T001 | VERIFY | (đọc redis/auth module) | Quy tắc an toàn cứng: @Global? circular? → A/B/C |
| T002 | MODIFY | `services/users.service.ts` | Phase A; BR-01/02/03; 5 ràng buộc §4 (READ) |
| T003 | MODIFY | `services/users.service.ts` | Phase B transaction atomic (#6), softDelete, audit |
| T004 | MODIFY | `services/users.service.ts` | Phase C revoke (#7), constructor additive |
| T004b | MODIFY (chỉ B) | `accounts.module.ts` | thêm import module (additive) chỉ khi không Global |
| T005 | MODIFY | `controllers/users.controller.ts` | `@Delete(':userId')` (#3) + RBAC `accounts.user.delete` |
| T006 | CREATE | `database/seeds/<ts>-SeedUserDeletePermission.ts` | #8 CHỈ SYSTEM_ADMIN, KHÔNG execute |
| T007 | MODIFY | `services/users.service.spec.ts` | D1–D12 |
| T008 | MODIFY | `controllers/users.controller.spec.ts` | DC1–DC4 |
| T009 | — | (các file trên) | tsc + eslint + jest, baseline vs mới |

---

> **Chưa code ở bước này** — tasks.md chờ duyệt trước khi implement. Thực thi tuần tự T001 → T009, tuân thủ "⛔ KHÔNG được làm".
> 🛑 **Nếu T001 phát hiện circular dependency khi wiring RedisService/AuthConfigService → DỪNG NGAY, KHÔNG viết `deleteUser`, ghi báo cáo + đề xuất phương án (provider trung gian / event), chờ người review quyết.**
