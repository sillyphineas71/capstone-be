# Feature Specification: Cập nhật trạng thái tài khoản (Update account status ACTIVE/INACTIVE)

- **Feature ID**: UC-11
- **Feature Name**: Cập nhật trạng thái tài khoản
- **Module / Domain**: accounts
- **Created Date**: 2026-07-12
- **Status**: Draft
- **Related UC**: UC-12 (Khóa tài khoản — LOCKED), UC-09 (cập nhật thông tin), UC-10 (xóa tài khoản)
- **Source Documents**:
  - Use Case: UC-11 Cập nhật trạng thái tài khoản
  - Database v3.2 Compact (39 tables) — bảng `users`, `audit_logs`
  - CLAUDE.md / AGENTS.md
  - spec/global/constitution.md (LOCKED v1.0.0)
  - Khảo sát code hiện trạng `src/modules/accounts`, `src/modules/auth`

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới spec cho UC-11 (ACTIVE ↔ INACTIVE). Xác định **Missing**; phân định ranh giới với UC-12 (LOCKED). | Toàn bộ file |

---

## 0. Trạng thái khảo sát hiện trạng (BẮT BUỘC ĐỌC TRƯỚC)

> Kết luận nhanh: **[Missing]** — chưa có endpoint/service đổi `account_status`.

| Thành phần | Hiện trạng | Vị trí |
| :--- | :--- | :--- |
| Endpoint đổi `account_status` (activate/deactivate) | ❌ **Missing** | [users.controller.ts](../../../../src/modules/accounts/controllers/users.controller.ts): chỉ có `POST`, `GET`, `PATCH :userId` (thông tin, UC-09), `PUT :userId/roles` (UC-08), `DELETE :userId` (UC-10) |
| Method service đổi status | ❌ **Missing** | [users.service.ts](../../../../src/modules/accounts/services/users.service.ts): không có `updateUserStatus`/`activate`/`deactivate` |
| `UpdateUserDto` (UC-09) | ✅ **Cố tình loại** `account_status` | [update-user.dto.ts](../../../../src/modules/accounts/dto/update-user.dto.ts) — 5 field profile, KHÔNG có status → UC-09 không đổi status |
| Enum `AccountStatus` | ✅ Có 4 giá trị | `ACTIVE='active'`, `INACTIVE='inactive'`, `LOCKED='locked'`, `PENDING_RESET='pending_reset'` ([user.entity.ts:21-26](../../../../src/modules/accounts/entities/user.entity.ts#L21)) |
| Login chặn theo status | ✅ Có sẵn | `active`→OK; `inactive`→`ForbiddenException AUTH_ACCOUNT_INACTIVE`; `locked`→`HTTP 423 AUTH_ACCOUNT_LOCKED`; khác→`AUTH_ACCOUNT_STATUS_NOT_ALLOWED` ([login.service.ts:90-111](../../../../src/modules/auth/services/login.service.ts#L90)) |
| Token revocation | ✅ Có sẵn (tái dùng) | Redis `auth:user:{id}:invalid_after` ([jwt-auth.guard.ts:50-61](../../../../src/modules/auth/guards/jwt-auth.guard.ts#L50-L61)) |

> Hệ quả quan trọng: **INACTIVE đã bị chặn đăng nhập sẵn** ở `login.service` → Expected Output "INACTIVE bị chặn đăng nhập" được đáp ứng mà **không cần sửa luồng login**. UC-11 chỉ cần đổi giá trị `account_status` (và tùy chọn thu hồi token đang hoạt động — §5.2).

---

## 1. Phân định UC-11 vs UC-12 (chống trùng lặp — QUAN TRỌNG)

Dựa enum thật `AccountStatus` (4 giá trị):

| Giá trị enum | Thuộc UC | Vai trò |
| :--- | :--- | :--- |
| `ACTIVE` | **UC-11** | Tài khoản hoạt động bình thường |
| `INACTIVE` | **UC-11** | Vô hiệu hóa (deactivate) — chặn đăng nhập; hành động quản trị "mềm", có thể kích hoạt lại |
| `LOCKED` | **UC-12** (KHÔNG thuộc spec này) | Khóa tài khoản (vi phạm/bảo mật) + thu hồi session |
| `PENDING_RESET` | Luồng auth (password reset) | Không do UC-11/UC-12 quản; hệ thống auth set |

**Ranh giới UC-11:**
- UC-11 **chỉ** chuyển **ACTIVE ↔ INACTIVE**. TUYỆT ĐỐI không set `LOCKED` (địa hạt UC-12) và không set `PENDING_RESET` (auth).
- UC-11 **không** thực hiện cơ chế "khóa/thu hồi toàn bộ session bắt buộc + lý do khóa" của UC-12. Nếu UC-11 chọn thu hồi token khi INACTIVE, đó là để chặn truy cập ngay — **cùng cơ chế kỹ thuật** (`invalid_after`) nhưng **khác ngữ nghĩa nghiệp vụ** (deactivate mềm, không phải khóa kỷ luật).
- UC-11 **không** đổi role (`user_roles` — UC-08) và **không** đổi thông tin hồ sơ (UC-09).

> ✅ Enum thật đã đủ giá trị để phân biệt (INACTIVE cho UC-11, LOCKED cho UC-12) → không cần đề xuất thêm giá trị. Không có mâu thuẫn.

---

## 2. Thông tin Use Case

| Trường | Giá trị |
| :--- | :--- |
| **UC ID** | UC-11 |
| **Use Case Name** | Cập nhật trạng thái tài khoản |
| **Module** | `accounts` |
| **Primary Actor** | Business Admin / System Admin *(xem §7 — Business Admin giới hạn department scope)* |
| **Trigger** | Admin chuyển trạng thái tài khoản ACTIVE ↔ INACTIVE |
| **Pre-condition** | Tài khoản tồn tại, chưa soft-delete; trạng thái hiện tại là `ACTIVE` hoặc `INACTIVE` (không phải `LOCKED`/`PENDING_RESET` — §6 BR-04) |
| **Expected Output** | `users.account_status` được đổi; tài khoản `INACTIVE` bị chặn đăng nhập (đã có sẵn ở login); có bản ghi `audit_logs` |
| **Related** | UC-12 |

---

## 3. Actor & Trigger

- **Primary Actor**: Business Admin (giới hạn department scope) và System Admin (không giới hạn).
- **Trigger**: Admin bật/tắt trạng thái hoạt động của một tài khoản.
- **Secondary Actor**: Redis (nếu thu hồi token — §5.2). Đồng bộ.

---

## 4. Endpoint liên quan (đề xuất mới — chờ duyệt)

**Phương án chính (khuyến nghị):** một endpoint đổi trạng thái, body chứa status (allowlist chỉ `active`/`inactive`).

```text
PATCH /api/v1/users/:userId/status
Body: { "status": "active" | "inactive" }
```

- Sub-resource `status` của `users`, nhất quán style `PUT /users/:userId/roles` (UC-08).
- Body validate bằng DTO: `status` là enum, **chỉ nhận `active`/`inactive`** (reject `locked`/`pending_reset` → 400/422, chống lấn UC-12).
- Param `userId` UUID (`ParseUUIDPipe`).

**Phương án thay thế (chờ chốt):** hai action endpoint rõ nghĩa:
```text
POST /api/v1/users/:userId/activate
POST /api/v1/users/:userId/deactivate
```
- Ưu: ngữ nghĩa rõ, dễ phân quyền tách biệt. Nhược: 2 endpoint.

> **Điểm cần chốt**: `PATCH :userId/status` (1 endpoint, body enum — khuyến nghị) vs cặp `activate`/`deactivate`.

Response chuẩn module (CLAUDE.md §8):
```json
{ "success": true, "message": "Cập nhật trạng thái tài khoản thành công", "data": { "id": "...", "accountStatus": "inactive" } }
```

> **Điểm cần chốt (response DTO)**: trả DTO gọn `{ id, accountStatus }` (đề xuất) hay tái dùng `UserDetailResponseDto` (như UC-09). Khuyến nghị: DTO gọn cho thao tác status.

---

## 5. Cơ chế đổi trạng thái

### 5.1. Đổi `account_status`
- UPDATE `users.account_status` giữa `ACTIVE` ↔ `INACTIVE`. `updated_at` tự cập nhật (`@UpdateDateColumn`). **KHÔNG** set `updated_by` (cột không tồn tại trong `user.entity.ts` — như UC-09).
- **KHÔNG** chạm `user_roles` (role không đổi — UC-08), **KHÔNG** chạm hồ sơ (UC-09), **KHÔNG** soft-delete (UC-10).

### 5.2. Thu hồi token khi chuyển sang INACTIVE (cần chốt)
- Login **đã** chặn `inactive` ở lần đăng nhập kế tiếp ([login.service.ts:93-97](../../../../src/modules/auth/services/login.service.ts#L93)). Tuy nhiên **access token đang hoạt động** vẫn hợp lệ tới khi hết hạn (guard không tự đọc `account_status`).
- **Đề xuất (khuyến nghị)**: khi `ACTIVE → INACTIVE`, set Redis `auth:user:{userId}:invalid_after = now()` (tái dùng cơ chế UC-10) để **thu hồi ngay** token đang hoạt động → chặn truy cập tức thì (đúng tinh thần "INACTIVE bị chặn"). TTL ≥ TTL refresh token.
- Khi `INACTIVE → ACTIVE` (kích hoạt lại): **không** cần thao tác token (không có session hợp lệ để thu hồi). Không cần xóa key `invalid_after` (key chỉ chặn token cũ hơn mốc; token mới sau khi kích hoạt lại có `iat` mới hơn nên hợp lệ).
- ⚠️ **Điểm cần chốt**: có thu hồi token ngay khi INACTIVE không (khuyến nghị: có), hay chỉ dựa vào chặn ở login lần sau. Nếu chỉ dựa login-next → access token cũ còn hiệu lực tới khi hết hạn (hạn chế cần nêu rõ với team).

> Đây là **cùng cơ chế kỹ thuật** với UC-10/UC-12 nhưng UC-11 dùng cho ngữ nghĩa "vô hiệu hóa mềm"; không kèm lý do khóa/kỷ luật của UC-12.

---

## 6. Business Rules & Validation

| # | Rule | Xử lý khi vi phạm |
| :--- | :--- | :--- |
| BR-01 | `status` chỉ nhận `active`/`inactive` (chặn `locked`/`pending_reset`) | `400`/`422 INVALID_STATUS` (chống lấn UC-12) |
| BR-02 | **Không tự vô hiệu hóa chính mình** (`targetUserId !== actorId` khi chuyển sang INACTIVE) | `422 CANNOT_DEACTIVATE_SELF` |
| BR-03 | No-op idempotent: status mới trùng status hiện tại | `200` "Không có thay đổi", không WRITE/không audit |
| BR-04 | Không đổi status của tài khoản đang `LOCKED` hoặc `PENDING_RESET` qua UC-11 | `409 INVALID_STATUS_TRANSITION` — *đề xuất, chờ chốt* |
| BR-05 | Không vô hiệu hóa **SYSTEM_ADMIN active cuối cùng** (chống lockout hệ thống) | `422 LAST_SYSTEM_ADMIN` — *đề xuất, chờ chốt* (mirror UC-10 BR-02) |
| BR-06 | Không thao tác trên tài khoản đã soft-delete | `404 USER_NOT_FOUND` |
| BR-07 | Business Admin chỉ đổi status user trong department scope | `403 FORBIDDEN` |
| BR-08 | Input validation, không raw SQL (SEC-03) | — |

> **Điểm cần chốt**: BR-04 (chặn chuyển trạng thái từ LOCKED/PENDING_RESET) và BR-05 (last SYSTEM_ADMIN). BR-04 quan trọng để không cho UC-11 vô tình "mở khóa" tài khoản LOCKED (phải qua UC-12).

---

## 7. Permission & RBAC

- Permission code (**đề xuất mới, chờ duyệt**): `accounts.user.update_status`, `module_code=accounts`, `action_code=update`.
- Role được gán: **`SYSTEM_ADMIN`** (không giới hạn) + **`BUSINESS_ADMIN`** (giới hạn department scope — mirror UC-09/`resolveDepartmentScope`).
- Guard: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('accounts.user.update_status')`.

> **Xác nhận với RBAC thật**: Actor UC list = Business Admin / System Admin. Nhất quán với UC-09 (Business Admin có department scope ở luồng cập nhật). **Điểm cần chốt**: Business Admin có được vô hiệu hóa tài khoản trong scope không, hay chỉ System Admin (do deactivate là hành động ảnh hưởng lớn). Đề xuất: cho phép Business Admin trong scope; chờ team xác nhận.

---

## 8. Main Flow (happy path — `PATCH /users/:userId/status`)

1. Actor gọi `PATCH /api/v1/users/:userId/status` với `{ status }`.
2. `JwtAuthGuard` xác thực. `PermissionsGuard` kiểm `accounts.user.update_status`.
3. Validate DTO: `status ∈ {active, inactive}` (BR-01) → sai: `400/422`.
4. Load target user (`deleted_at IS NULL`) → không có: `404 USER_NOT_FOUND` (BR-06).
5. Nếu actor **không** phải System Admin: kiểm department scope (BR-07) → ngoài scope: `403`.
6. BR-04: nếu status hiện tại là `LOCKED`/`PENDING_RESET` → `409 INVALID_STATUS_TRANSITION`.
7. BR-03: nếu `status` mới == hiện tại → `200` no-op, không WRITE/không audit.
8. Nếu chuyển sang `INACTIVE`:
   - BR-02: `targetUserId === actorId` → `422 CANNOT_DEACTIVATE_SELF`.
   - BR-05 (nếu chốt): nếu là SYSTEM_ADMIN active cuối cùng → `422 LAST_SYSTEM_ADMIN`.
9. **Trong 1 transaction**: UPDATE `account_status`; ghi `audit_logs` atomic (`ACCOUNT_STATUS_UPDATE`, old/new status).
10. **Sau commit** (nếu chuyển INACTIVE và chốt thu hồi token): set Redis `auth:user:{userId}:invalid_after = now()`. Redis fail → log, không throw (mirror UC-10).
11. Trả `200` với `{ id, accountStatus }`.

---

## 9. Alternative / Exception Flows

| Tình huống | HTTP | error.code |
| :--- | :--- | :--- |
| Thiếu/sai JWT | 401 | `UNAUTHORIZED` |
| Thiếu permission | 403 | `FORBIDDEN` |
| Ngoài department scope (Business Admin) | 403 | `FORBIDDEN` |
| `userId` sai UUID | 400 | `INVALID_USER_ID` |
| `status` không hợp lệ (không phải active/inactive) | 400/422 | `INVALID_STATUS` |
| User không tồn tại/đã xóa | 404 | `USER_NOT_FOUND` |
| Tài khoản đang LOCKED/PENDING_RESET (BR-04) | 409 | `INVALID_STATUS_TRANSITION` |
| Tự vô hiệu hóa mình | 422 | `CANNOT_DEACTIVATE_SELF` |
| SYSTEM_ADMIN cuối cùng (BR-05 nếu chốt) | 422 | `LAST_SYSTEM_ADMIN` |
| Lỗi transaction | 500 | (không lộ stack trace — ENG-03) |

Body lỗi theo module: `{ success:false, message, error:{ code, details } }`.

---

## 10. Audit (bắt buộc)

- CLAUDE.md §17 liệt kê "Create/update/delete user" và thay đổi trạng thái quản trị là hành động phải audit. UC-11 **PHẢI** ghi `audit_logs`.
- Bản ghi (field thật [audit-log.entity.ts](../../../../src/modules/administration/entities/audit-log.entity.ts)):
  - `user_id` = actor.
  - `action_type` = **`ACCOUNT_STATUS_UPDATE`** *(đề xuất; đồng bộ `ACCOUNT_CREATE/UPDATE/ROLE_UPDATE/DELETE`)*.
  - `entity_type` = `users`, `entity_id` = targetUserId.
  - `old_value_json` = `{ accountStatus: <cũ> }`, `new_value_json` = `{ accountStatus: <mới> }`.
  - `severity` = `WARNING` khi vô hiệu hóa (INACTIVE), `INFO` khi kích hoạt lại — *đề xuất, chờ chốt*.
  - **KHÔNG** log secret.
- Ghi audit **atomic trong transaction** với UPDATE (mirror UC-09/UC-10).

---

## 11. Ảnh hưởng phụ & lưu ý

- **KHÔNG** sửa `login.service` (đã chặn `inactive` sẵn) — tránh đụng module auth.
- **KHÔNG** chạm `user_roles`/role, hồ sơ, soft-delete.
- Thu hồi token (§5.2) tái dùng cơ chế `invalid_after` — không viết mới cơ chế auth.
- **Không** trùng UC-12: UC-11 không set LOCKED, không quản lý lý do khóa/quy trình mở khóa.

---

## 12. Giả định & điểm cần chốt

1. **[Endpoint]** `PATCH :userId/status` (body enum) vs `activate`/`deactivate`. Khuyến nghị PATCH status.
2. **[Thu hồi token khi INACTIVE]** Có set `invalid_after` để cắt session ngay không (khuyến nghị có), hay chỉ chặn login lần sau.
3. **[BR-04]** Chặn đổi status khi đang LOCKED/PENDING_RESET (khuyến nghị chặn — bảo vệ ranh giới UC-12).
4. **[BR-05]** Chặn vô hiệu hóa SYSTEM_ADMIN active cuối cùng (mirror UC-10).
5. **[Permission/actor]** Business Admin có được deactivate trong scope không, hay chỉ System Admin. Đề xuất: Business Admin trong scope.
6. **[Permission code]** `accounts.user.update_status` (mới) — cần seed (không tạo ở bước spec).
7. **[Response DTO]** `{ id, accountStatus }` gọn vs tái dùng `UserDetailResponseDto`.
8. **[Severity audit]** WARNING (deactivate) / INFO (activate) hay đồng nhất.

---

## 13. Trạng thái kết luận

**[Missing]**

- **Chưa có gì cho UC-11**: không endpoint đổi status, không service, không DTO status. Hạ tầng có sẵn để tái dùng: login đã chặn `inactive`; token revocation `invalid_after`; department scope resolver.
- **Cần làm (khi duyệt)**:
  1. DTO `UpdateUserStatusDto` (`status: 'active' | 'inactive'`, allowlist chặn locked/pending_reset).
  2. Endpoint `PATCH /api/v1/users/:userId/status` + `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('accounts.user.update_status')`.
  3. Service `updateUserStatus`: validate (BR-01…BR-07), department scope cho Business Admin, transaction UPDATE `account_status` + audit atomic (`ACCOUNT_STATUS_UPDATE`, old/new); post-commit revoke token nếu INACTIVE (nếu chốt).
  4. Permission `accounts.user.update_status` + seed (SYSTEM_ADMIN + BUSINESS_ADMIN — chờ chốt).
  5. Unit test: active↔inactive happy path, no-op (BR-03), self-deactivate (BR-02), invalid status (BR-01), LOCKED transition chặn (BR-04), scope (BR-07), USER_NOT_FOUND, revoke token khi INACTIVE, missing permission 403, (last-admin nếu chốt).
- **Không đụng UC khác**: chỉ set ACTIVE/INACTIVE; KHÔNG set LOCKED (UC-12); KHÔNG chạm role (UC-08)/hồ sơ (UC-09)/soft-delete (UC-10); KHÔNG sửa login (đã chặn inactive sẵn).
- **Chặn trước khi code**: chốt 8 điểm §12 (đặc biệt: thu hồi token, BR-04 ranh giới LOCKED, BR-05 last-admin, actor Business Admin).
