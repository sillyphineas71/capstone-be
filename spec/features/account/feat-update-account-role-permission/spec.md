# Feature Specification: Cập nhật vai trò & quyền tài khoản (Update account role/permission)

- **Feature ID**: UC-08
- **Feature Name**: Cập nhật vai trò và quyền tài khoản
- **Module / Domain**: accounts
- **Created Date**: 2026-07-12
- **Status**: Draft
- **Related UC**: UC-09, UC-13
- **Source Documents**:
  - Use Case: UC-08 Cập nhật vai trò và quyền tài khoản
  - Database v3.2 Compact (39 tables) — bảng `users`, `user_roles`, `roles`, `role_permissions`, `audit_logs`
  - CLAUDE.md / AGENTS.md
  - spec/global/constitution.md (LOCKED v1.0.0)
  - Khảo sát code hiện trạng module `src/modules/accounts`

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới spec cho UC-08 sau khi khảo sát hiện trạng module `accounts`. Xác định trạng thái **Missing** cho phần lõi (đổi role của tài khoản đã tồn tại). | Toàn bộ file |
| 2026-07-12 | Chuyển file vào đúng module `spec/features/account/` và căn header theo house-style (Feature ID / Source Documents). | Header |

---

## 0. Trạng thái khảo sát hiện trạng (BẮT BUỘC ĐỌC TRƯỚC)

> Kết luận nhanh: **[Partial → thực chất Missing cho đúng ý UC-08]**

| Thành phần liên quan UC-08 | Hiện trạng | Vị trí |
| :--- | :--- | :--- |
| Gán role cho user **khi tạo** tài khoản | ✅ Đã có | [users.service.ts:229-237](../../../../src/modules/accounts/services/users.service.ts#L229-L237) (bước 9 trong `createUser`) |
| **Cập nhật/đổi role của tài khoản đã tồn tại** (add/remove/replace `user_roles`) | ❌ **Missing** | Không có controller/service/endpoint nào |
| Gán/gỡ **permission cho một ROLE** (`role_permissions`) | ✅ Đã có (nhưng là UC khác) | [role-permissions.controller.ts](../../../../src/modules/accounts/controllers/role-permissions.controller.ts), [role-permissions.service.ts](../../../../src/modules/accounts/services/role-permissions.service.ts) — guard `admin.manage_permissions` |
| Grant **permission trực tiếp cho một USER** | ❌ Không tồn tại trong schema | RBAC hiện tại: permission chỉ gắn vào role qua `role_permissions` |

### 0.1. Làm rõ phạm vi & một mâu thuẫn cần chốt

UC-08 mô tả "Cập nhật vai trò **và quyền** tài khoản". Trong RBAC hiện tại của dự án, "quyền" của một tài khoản **không** được gán trực tiếp cho user; quyền đến **gián tiếp qua role** (`users` → `user_roles` → `roles` → `role_permissions` → `permissions`). Xác nhận qua [permissions.guard.ts:43-48](../../../../src/modules/auth/guards/permissions.guard.ts#L43-L48) (resolve `getEffectiveRolesAndPermissions(userId)`).

Do đó UC-08 tách thành 2 khả năng, **phải chốt với team**:

- **(A) Đổi tập role của một tài khoản** (`user_roles`) — đây là đúng nghĩa "cập nhật vai trò & quyền truy cập của tài khoản theo RBAC" như phần *Expected Output* mô tả. **Đây là phần Missing và là trọng tâm của spec này.**
- **(B) Chỉnh sửa ma trận permission của một role** (`role_permissions`) — **đã được implement** ở [role-permissions.controller.ts](../../../../src/modules/accounts/controllers/role-permissions.controller.ts). Tuy nhiên hành động này thay đổi quyền cho **TẤT CẢ** user mang role đó (system-wide config), không phải "cập nhật quyền của một tài khoản". Về bản chất nó thuộc nhóm quản trị RBAC (gần UC-13 "quản lý permission/role"), **không phải** UC-08. Spec này **KHÔNG** đặc tả lại (B) như thứ làm mới.

> ⚠️ **Mâu thuẫn với đầu bài**: đầu bài liệt kê `role_permissions` là bảng UC-08 chạm tới. Nhưng theo code/schema thật, việc "cập nhật vai trò & quyền của một tài khoản" tác động vào **`user_roles`**, không phải `role_permissions`. Ưu tiên luật + schema thật (CLAUDE.md §1, precedence: database baseline > feature table). Spec này lấy `user_roles` làm bảng trung tâm; `role_permissions` chỉ được **đọc** để hiển thị hiệu lực quyền, **không ghi**.

---

## 1. Thông tin Use Case

| Trường | Giá trị |
| :--- | :--- |
| **UC ID** | UC-08 |
| **Use Case Name** | Cập nhật vai trò và quyền tài khoản (Update account role/permission) |
| **Module** | `accounts` (Account Management) |
| **Primary Actor** | Business Admin *(xem §5 — cần chốt phạm vi so với System Admin)* |
| **Trigger** | Admin thay đổi role của một tài khoản (thêm/bớt/thay thế role) |
| **Pre-condition** | Tài khoản mục tiêu tồn tại và chưa bị soft-delete (`users.deleted_at IS NULL`); actor đã đăng nhập và có permission phù hợp |
| **Expected Output** | Tập role của tài khoản được cập nhật; quyền truy cập hiệu lực (effective permissions) thay đổi tương ứng theo RBAC; có bản ghi `audit_logs` |
| **Related** | UC-09, UC-13 |

---

## 2. Actor & Trigger

- **Primary Actor**: Business Admin (và/hoặc System Admin — xem §5).
- **Trigger**: Admin mở hồ sơ một tài khoản và thay đổi danh sách vai trò (ví dụ nâng `EMPLOYEE` → `MANAGER`, hoặc gỡ một role).
- **Secondary Actor**: Không có (đồng bộ, không phụ thuộc thiết bị/hệ thống ngoài).

---

## 3. Endpoint liên quan (đề xuất mới — chờ duyệt)

> Chưa tồn tại endpoint cho UC-08. Đề xuất theo convention hiện có (prefix global `/api/v1`, resource plural, sub-resource `roles` của `users`). Bám sát cách `createUser` nhận `roleIds: string[]`.

**Phương án chính (khuyến nghị) — thay thế toàn bộ tập role (idempotent, thỏa ARCH-03):**

```text
PUT /api/v1/users/:userId/roles
Body: { "roleIds": ["<uuid>", ...] }
```

- Nhận **full desired set** role của tài khoản; service tự tính phần thêm/bớt so với trạng thái hiện tại.
- Idempotent tự nhiên (gọi lại cùng payload không đổi kết quả) → thỏa **ARCH-03 Idempotency**.

**Phương án thay thế (nếu team muốn thao tác từng role, giống pattern `role_permissions`):**

```text
POST   /api/v1/users/:userId/roles           Body: { "roleIds": ["<uuid>", ...] }   # add
DELETE /api/v1/users/:userId/roles/:roleId                                          # remove
```

> **Quyết định cần chốt**: dùng `PUT` replace-set (khuyến nghị) hay cặp `POST/DELETE`. Spec này mô tả main flow theo **`PUT` replace-set**.

Response format bám chuẩn dự án (CLAUDE.md §8):

```json
{ "success": true, "message": "Cập nhật vai trò tài khoản thành công", "data": { "userId": "...", "roles": [ { "id": "...", "roleCode": "MANAGER", "roleName": "..." } ] } }
```

---

## 4. Data touched (tên bảng/field snake_case theo schema thật)

| Bảng | Thao tác | Cột liên quan | Ghi chú |
| :--- | :--- | :--- | :--- |
| `users` | READ (+ optional WRITE audit) | `id`, `deleted_at`, `account_status`, `department_id`, `updated_by`, `updated_at` | Kiểm tra tồn tại/scope; có thể cập nhật `updated_by`/`updated_at` nếu team yêu cầu |
| `user_roles` | INSERT / cập nhật hiệu lực | `id`, `user_id`, `role_id`, `assigned_by`, `assigned_at`, `expired_at`, `is_active`, `metadata_json` | Bảng trung tâm của UC-08. Entity: [user-role.entity.ts](../../../../src/modules/accounts/entities/user-role.entity.ts) |
| `roles` | READ | `id`, `role_code`, `role_name`, `is_active`, `is_system_role` | Validate role tồn tại & active (mirror `createUser`) |
| `role_permissions` | **READ-only (không ghi)** | — | Chỉ để suy ra effective permissions khi cần hiển thị/audit. UC-08 KHÔNG chỉnh bảng này |
| `audit_logs` | INSERT (bắt buộc) | `user_id`, `action_type`, `entity_type`, `entity_id`, `old_value_json`, `new_value_json`, `ip_address`, `user_agent`, `request_id`, `severity`, `metadata_json` | Entity: [audit-log.entity.ts](../../../../src/modules/administration/entities/audit-log.entity.ts) |

> Không bịa thêm bảng/field. Mọi field trên đều tồn tại trong entity hiện tại.

### 4.1. Chiến lược ghi `user_roles` (cần chốt — liên quan DATA-01)

Constitution **DATA-01** yêu cầu soft-delete cho entity business-critical. Có 2 lựa chọn khi "gỡ" role khỏi user:

- **(a) Soft-remove (khuyến nghị)**: set `is_active = false` và `expired_at = now()` cho row role bị bỏ; INSERT row mới cho role được thêm. Giữ lịch sử.
- **(b) Hard-delete row** `user_roles`: đơn giản hơn nhưng mất vết. Row `user_roles` là bảng nối RBAC — cần team xác nhận có coi là "business-critical" theo DATA-01 không.

> **Đề xuất mới, chờ duyệt**: dùng phương án (a) soft-remove để phù hợp DATA-01 và giữ audit trail.

---

## 5. Permission cần thiết & mô hình RBAC

### 5.1. Permission code (đề xuất mới — chờ duyệt)

Hiện **chưa có** permission code nào cho việc đổi role của user (đã grep toàn bộ `src` — không có `account.user.update_roles` / `accounts.user.update.role`). Đề xuất:

```text
accounts.user.update_roles      # đề xuất mới, chờ duyệt
  module_code = accounts   (nằm trong MODULE_CODE_ALLOWLIST)
  action_code = update
```

> Ghi chú: hành động cần permission **riêng**, KHÔNG tái dùng `admin.manage_permissions` (permission đó dành cho chỉnh `role_permissions` — quản trị RBAC toàn cục, khác nghiệp vụ UC-08).

### 5.2. Role-set được gán permission (cần chốt)

| Role | Có nên được `accounts.user.update_roles`? | Ghi chú |
| :--- | :--- | :--- |
| `SYSTEM_ADMIN` | ✅ Có | Toàn quyền RBAC |
| `BUSINESS_ADMIN` | ⚠️ **Cần chốt** | Primary Actor của UC-08 là Business Admin. Nếu cho phép, **phải giới hạn department scope** (xem §5.3) và **không được** cho phép gán/gỡ role quản trị hệ thống (ví dụ không được tự gán `SYSTEM_ADMIN` cho ai) |
| `MANAGER` | ❌ Mặc định không | Trừ khi team yêu cầu |
| `EMPLOYEE` | ❌ Không | |

> ⚠️ **Lệch cần nêu rõ**: đầu bài đặt Primary Actor = Business Admin. Nhưng trong code hiện tại, các thao tác chạm RBAC (`role_permissions`) đang gate bằng `admin.manage_permissions` (thiên về System Admin). Việc **có cho Business Admin đổi role của user hay không, và trong phạm vi nào** là **quyết định chính sách chưa được chốt** — cần team/RFC xác nhận trước khi implement. Spec giả định "Business Admin được phép, nhưng bị giới hạn department scope và không được cấp/thu role cấp hệ thống".

### 5.3. Department scope cho Business Admin (tái dùng pattern đã có)

Module đã có logic scope theo phòng ban cho Business Admin ở [users.service.ts:557-600](../../../../src/modules/accounts/services/users.service.ts#L557-L600) (`resolveDepartmentScope` / `collectDepartmentScope`, độ sâu tối đa `MAX_DEPARTMENT_SCOPE_DEPTH = 5`) và cách phân biệt System Admin qua `role.is_system_role` ([users.service.ts:378-393](../../../../src/modules/accounts/services/users.service.ts#L378-L393)). UC-08 **nên tái dùng** cơ chế này: Business Admin chỉ đổi role cho user thuộc department (và department con) trong scope của mình.

---

## 6. Main Flow (happy path — theo `PUT /users/:userId/roles`)

1. Actor gọi `PUT /api/v1/users/:userId/roles` với `roleIds` (tập role mong muốn).
2. `JwtAuthGuard` xác thực token (SEC-02). `PermissionsGuard` kiểm tra `accounts.user.update_roles`.
3. Validate DTO: `userId` là UUID; `roleIds` là mảng UUID, **không rỗng** (`ArrayNotEmpty`), loại trùng.
4. Load user mục tiêu: tồn tại và `deleted_at IS NULL` → nếu không: `404 USER_NOT_FOUND`.
5. Nếu actor **không** phải System Admin: kiểm tra department scope (§5.3) → ngoài scope: `403 FORBIDDEN`.
6. Validate mọi `roleId`: tồn tại (`404 ROLE_NOT_FOUND`) và `is_active = true` (`422 ROLE_INACTIVE`) — mirror `createUser` bước 4.
7. Áp business rules §8 (self-lockout, cấm nâng cấp vượt cấp, không để mất hết role...).
8. **Trong 1 transaction** (CLAUDE.md §14.4):
   - Tính diff giữa tập role hiện tại (`user_roles.is_active = true`) và `roleIds`.
   - Với role bị bỏ: soft-remove (`is_active = false`, `expired_at = now()`) — §4.1(a).
   - Với role được thêm: INSERT `user_roles` (`assigned_by = actorId`, `assigned_at = now()`, `is_active = true`).
   - Nếu diff rỗng (không thay đổi): trả `200` với message "Không có thay đổi" (idempotent), không tạo audit thừa (hoặc tạo audit severity `info` tùy chính sách).
9. Ghi `audit_logs` (bắt buộc — §9): `action_type = ACCOUNT_ROLE_UPDATE`, `entity_type = users`, `entity_id = userId`, `old_value_json = { roleIds: [...cũ] }`, `new_value_json = { roleIds: [...mới] }`.
10. Trả response `200` với danh sách role mới.
11. *(Tùy chọn)* Vô hiệu hóa cache authz của user mục tiêu để effective permissions cập nhật ngay (xem §11).

---

## 7. Alternative Flows

- **A1 — Không thay đổi**: `roleIds` trùng đúng tập hiện tại → `200`, message "Không có thay đổi vai trò", không ghi role mới. Idempotent.
- **A2 — Dùng POST/DELETE thay vì PUT**: nếu team chọn phương án cặp add/remove (§3), main flow tách thành 2 luồng riêng, mỗi luồng validate + audit độc lập.
- **A3 — Actor là System Admin**: bỏ qua kiểm tra department scope (bước 5).

---

## 8. Business Rules & Validation

| # | Rule | Xử lý khi vi phạm |
| :--- | :--- | :--- |
| BR-01 | `roleIds` không rỗng — tài khoản phải giữ **≥ 1 role** | `422 ROLE_SET_EMPTY` |
| BR-02 | Không gán role **không tồn tại** | `404 ROLE_NOT_FOUND` (mirror `createUser`) |
| BR-03 | Không gán role **inactive** (`is_active = false`) | `422 ROLE_INACTIVE` |
| BR-04 | **Không tự hạ/thu quyền chính mình**: actor không được tự gỡ role quản trị của bản thân (chống self-lockout) | `422 CANNOT_MODIFY_OWN_ADMIN_ROLE` |
| BR-05 | Business Admin **không được** gán/gỡ role cấp hệ thống (`is_system_role = true`, ví dụ `SYSTEM_ADMIN`) | `403 FORBIDDEN_ROLE_ELEVATION` |
| BR-06 | Business Admin chỉ thao tác trên user **trong department scope** | `403 FORBIDDEN` |
| BR-07 | Không thao tác trên tài khoản đã soft-delete | `404 USER_NOT_FOUND` |
| BR-08 | *(cần chốt)* Không cho đổi role của tài khoản đang `account_status` khóa/nghỉ việc? | `422 ACCOUNT_INACTIVE` — **đề xuất, chờ duyệt** |
| BR-09 | Endpoint mutating phải idempotent (ARCH-03) — dùng `PUT` replace-set hoặc idempotency-key | — |
| BR-10 | Input validation trước khi chạm DB (SEC-03), không raw SQL nối chuỗi | — |

> Domain error code đặt theo phong cách hiện có (CLAUDE.md §16): `ROLE_NOT_FOUND`, `ROLE_INACTIVE`, `USER_NOT_FOUND`, `FORBIDDEN`...

---

## 9. Exception Flows

| Tình huống | HTTP | error.code |
| :--- | :--- | :--- |
| Thiếu/sai JWT | 401 | `UNAUTHORIZED` |
| Thiếu permission `accounts.user.update_roles` | 403 | `FORBIDDEN` |
| Ngoài department scope (Business Admin) | 403 | `FORBIDDEN` |
| Business Admin cố gán/gỡ role hệ thống | 403 | `FORBIDDEN_ROLE_ELEVATION` |
| `userId`/`roleIds` sai định dạng | 400 | `INVALID_INPUT` / `INVALID_USER_ID` |
| User mục tiêu không tồn tại/đã xóa | 404 | `USER_NOT_FOUND` |
| Role không tồn tại | 404 | `ROLE_NOT_FOUND` |
| Role inactive | 422 | `ROLE_INACTIVE` |
| Tập role rỗng | 422 | `ROLE_SET_EMPTY` |
| Tự gỡ role admin của chính mình | 422 | `CANNOT_MODIFY_OWN_ADMIN_ROLE` |
| Lỗi transaction | 500 | (không lộ stack trace — ENG-03) |

---

## 10. Audit (bắt buộc)

- UC-08 là hành động RBAC nhạy cảm → **PHẢI** ghi `audit_logs` (CLAUDE.md §17 liệt kê "Role/permission change" là hành động phải audit; constitution SEC/ENG).
- Bản ghi tối thiểu:
  - `user_id` = actor (người thực hiện).
  - `action_type` = `ACCOUNT_ROLE_UPDATE` *(đề xuất; đồng bộ phong cách `ACCOUNT_CREATE`, `ASSIGN_PERMISSION` đã có)*.
  - `entity_type` = `users`, `entity_id` = userId mục tiêu.
  - `old_value_json` = tập role trước, `new_value_json` = tập role sau (chỉ lưu `roleIds`/`roleCode`, **không** lưu secret).
  - `ip_address`, `user_agent`, `request_id`, `severity = info` (hoặc `warning` nếu là thay đổi role hệ thống).
- Ghi audit đặt **trong hoặc ngay sau** transaction thành công (mirror [role-permissions.service.ts:159-169](../../../../src/modules/accounts/services/role-permissions.service.ts#L159-L169)).
- **Không** log token/password.

---

## 11. Ảnh hưởng phụ & lưu ý kỹ thuật

- **Effective permission cache**: `PermissionsGuard` gọi `AuthzReadRepository.getEffectiveRolesAndPermissions(userId)` ([permissions.guard.ts:43](../../../../src/modules/auth/guards/permissions.guard.ts#L43)). Nếu tầng này có cache, sau khi đổi role phải **invalidate** để quyền mới có hiệu lực ngay. *(Cần kiểm tra `authz-read.repository.ts` khi implement — ngoài phạm vi spec.)*
- **Không** chạm `role_permissions` trong UC-08.
- **Notification** (tùy chọn, chờ duyệt): có thể thông báo cho user khi role thay đổi — nhưng không bắt buộc cho UC-08, để tránh mở rộng scope.

---

## 12. Giả định & điểm chưa chắc (cần team xác nhận)

1. **[Chốt phạm vi]** UC-08 = đổi `user_roles` của một tài khoản (phương án A), KHÔNG phải chỉnh `role_permissions` (đã có). ✔ giả định theo schema thật.
2. **[Chốt actor]** Business Admin có được phép đổi role của user không? Trong scope nào? Có bị cấm cấp/thu role hệ thống không? (§5).
3. **[Chốt permission code]** Tên `accounts.user.update_roles` — **đề xuất mới, chờ duyệt** + cần seed riêng (không tạo ở bước này).
4. **[Chốt endpoint]** `PUT /users/:userId/roles` (replace-set) vs cặp `POST/DELETE`.
5. **[Chốt strategy]** Soft-remove (`is_active=false`+`expired_at`) vs hard-delete row `user_roles` (§4.1, liên quan DATA-01).
6. **[Chốt BR-08]** Có chặn đổi role khi tài khoản đang bị khóa/nghỉ việc không?
7. **[Chưa xác minh]** Cơ chế cache của `AuthzReadRepository` — cần xem khi implement.

---

## 13. Trạng thái kết luận

**[Partial → Missing cho đúng ý UC-08]**

- **Đã có (không làm lại)**: gán role khi *tạo* user; chỉnh `role_permissions` của một role (thuộc UC khác, gate `admin.manage_permissions`).
- **Cần làm (Missing)**: chức năng **cập nhật tập role của một tài khoản đã tồn tại** (`user_roles`) — gồm:
  1. DTO `UpdateUserRolesDto` (`roleIds: string[]`, non-empty, UUID).
  2. Endpoint `PUT /api/v1/users/:userId/roles` (hoặc cặp POST/DELETE — chờ chốt).
  3. Service: validate role tồn tại/active + department scope + business rules §8, transaction diff add/soft-remove `user_roles`.
  4. Permission mới `accounts.user.update_roles` + seed (chờ duyệt).
  5. Guard `JwtAuthGuard` + `PermissionsGuard`.
  6. Ghi `audit_logs` (`ACCOUNT_ROLE_UPDATE`).
  7. Invalidate authz cache của user mục tiêu (nếu có).
  8. Unit test: validate role, self-lockout (BR-04), role elevation (BR-05), department scope (BR-06), idempotent no-op (A1).
- **Chặn trước khi code**: chốt 7 điểm ở §12 (đặc biệt actor/permission/endpoint/strategy). Không tự quyết, không tự tạo migration/seed ở bước spec này.
