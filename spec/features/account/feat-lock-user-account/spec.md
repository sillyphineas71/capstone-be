# Feature Specification: Khóa tài khoản người dùng (Lock user account)

- **Feature ID**: UC-12
- **Feature Name**: Khóa tài khoản người dùng
- **Module / Domain**: accounts
- **Created Date**: 2026-07-12
- **Status**: Draft
- **Related UC**: UC-10 (xóa), UC-11 (ACTIVE/INACTIVE)
- **Source Documents**:
  - Use Case: UC-12 Khóa tài khoản người dùng
  - Database v3.2 Compact (39 tables) — bảng `users`, `audit_logs`
  - CLAUDE.md / AGENTS.md
  - spec/global/constitution.md (LOCKED v1.0.0)
  - Khảo sát code hiện trạng `src/modules/accounts`, `src/modules/auth`

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới spec cho UC-12 (khóa thủ công → LOCKED). Xác định **Missing**; phân biệt với UC-11 (INACTIVE) và auto-lock (rate-limit). | Toàn bộ file |

---

## 0. Trạng thái khảo sát hiện trạng (BẮT BUỘC ĐỌC TRƯỚC)

> Kết luận nhanh: **[Missing]** — chưa có endpoint/service khóa/mở khóa thủ công.

| Thành phần | Hiện trạng | Vị trí |
| :--- | :--- | :--- |
| Endpoint lock/unlock thủ công | ❌ **Missing** | [users.controller.ts](../../../../src/modules/accounts/controllers/users.controller.ts): chỉ có create/get/`PATCH :userId` (UC-09)/`PATCH :userId/status` (UC-11)/`PUT :userId/roles` (UC-08)/`DELETE :userId` (UC-10) |
| Method service lock/unlock | ❌ **Missing** | [users.service.ts](../../../../src/modules/accounts/services/users.service.ts) không có `lockUser`/`unlockUser` |
| Enum `AccountStatus.LOCKED` | ✅ Có | `LOCKED='locked'` ([user.entity.ts:24](../../../../src/modules/accounts/entities/user.entity.ts#L24)) |
| Cột `locked_until`, `failed_login_count` | ✅ Có (nhưng login KHÔNG dùng) | [user.entity.ts:100-107](../../../../src/modules/accounts/entities/user.entity.ts#L100) |
| Cột **lý do khóa** (`lock_reason`) | ❌ **Không tồn tại** | `user.entity.ts` không có cột lý do; cũng không có `metadata_json` trên `users` |
| Login chặn LOCKED | ✅ Có sẵn | `accountStatus === 'locked'` → `HTTP 423 AUTH_ACCOUNT_LOCKED` ([login.service.ts:98-105](../../../../src/modules/auth/services/login.service.ts#L98)) |
| Auto-lock brute-force | ✅ Có, nhưng qua **Redis rate-limit** (không dùng cột) | `rateLimitService.checkOrThrow(ip, email)` ([login.service.ts:50](../../../../src/modules/auth/services/login.service.ts#L50)) |
| Token revocation | ✅ Có sẵn (tái dùng) | Redis `auth:user:{id}:invalid_after` ([jwt-auth.guard.ts:50-61](../../../../src/modules/auth/guards/jwt-auth.guard.ts#L50-L61)) |

---

## 1. Phân biệt 3 khái niệm (chống nhầm lẫn — QUAN TRỌNG)

| # | Khái niệm | Cơ chế | Thuộc |
| :--- | :--- | :--- | :--- |
| (a) | **Vô hiệu hóa mềm** ACTIVE↔INACTIVE | `account_status = inactive`; có thể kích hoạt lại | **UC-11** (đã làm) |
| (b) | **Khóa thủ công** (kỷ luật/bảo mật) | `account_status = LOCKED` + thu hồi session; giữ dữ liệu lịch sử | **UC-12** (spec này) |
| (c) | **Auto-lock brute-force** | **Redis rate-limit** theo IP+email (`rateLimitService`); tạm thời, tự hết | Auth (đã có), **KHÔNG** dùng cột `locked_until`/`failed_login_count` |

### Ranh giới UC-12 vs auto-lock (c)
- Auto-lock hiện tại là **Redis rate-limit**, **không** ghi vào `account_status` và **không** dùng cột `locked_until`/`failed_login_count`. Do đó UC-12 (đặt `account_status=LOCKED`) **không phá** cơ chế auto-lock.
- Các cột `locked_until`, `failed_login_count` **hiện không được login flow sử dụng**. UC-12 khóa **thủ công vô thời hạn** (tới khi admin mở) → **đề xuất KHÔNG set `locked_until`** (giữ `null`); nếu tương lai có auto-lock theo thời hạn dùng `locked_until`, sẽ phân biệt bằng: `LOCKED` + `locked_until IS NULL` = khóa thủ công; `locked_until > now` = khóa tạm. **Cần chốt** (xem §12).

### Ranh giới UC-12 vs UC-11
- UC-12 thao tác **LOCKED** (và mở khóa về ACTIVE). **KHÔNG** thực hiện ACTIVE↔INACTIVE (địa hạt UC-11). UC-11 đã **chặn** set `locked` qua `PATCH :userId/status` → UC-12 **phải dùng endpoint riêng** (§4).

---

## 2. Thông tin Use Case

| Trường | Giá trị |
| :--- | :--- |
| **UC ID** | UC-12 |
| **Use Case Name** | Khóa tài khoản người dùng |
| **Module** | `accounts` |
| **Primary Actor** | Business Admin (department scope) / System Admin (không scope) |
| **Trigger** | Admin khóa (hoặc mở khóa) một tài khoản |
| **Pre-condition** | Tài khoản tồn tại, chưa soft-delete |
| **Expected Output** | Tài khoản chuyển `LOCKED`; **mọi session bị thu hồi**; **dữ liệu lịch sử giữ nguyên**; có bản ghi `audit_logs` |
| **Related** | UC-10, UC-11 |

---

## 3. Actor & Trigger

- **Primary Actor**: Business Admin (giới hạn department scope) và System Admin (không giới hạn).
- **Trigger**: Admin khóa một tài khoản vì lý do kỷ luật/bảo mật (và mở khóa khi cần).
- **Secondary Actor**: Redis (thu hồi token). Đồng bộ.

---

## 4. Endpoint liên quan (đề xuất mới — chờ duyệt)

UC-11 đã chặn set `locked` qua `PATCH :userId/status` → UC-12 dùng **endpoint riêng**:

```text
PATCH /api/v1/users/:userId/lock      Body (optional): { "reason": "..." }
PATCH /api/v1/users/:userId/unlock
```

- `lock`: khóa tài khoản. Body `reason` **tùy chọn** (lưu vào audit — §5.3, §11).
- `unlock`: mở khóa (đưa về `ACTIVE`).
- Param `userId` UUID (`ParseUUIDPipe`). Response chuẩn module `{ success, message, data: { id, accountStatus } }`.

> **Điểm cần chốt**:
> 1. UC-12 có **bao gồm unlock** không, hay unlock là UC riêng? Expected Output chỉ nói "khóa". **Đề xuất**: gộp lock + unlock trong UC-12 (cặp nghiệp vụ tự nhiên) — chờ duyệt.
> 2. `PATCH :userId/lock`+`/unlock` (đề xuất) vs `POST` action. Khuyến nghị PATCH.
> 3. **Route order**: `:userId/lock` và `:userId/unlock` (2 segment) không đụng `:userId` (1 segment) — an toàn; vẫn nên khai báo cùng nhóm sub-resource, xác minh khi implement (mirror lưu ý UC-11).

---

## 5. Cơ chế khóa / mở khóa

### 5.1. Khóa (lock)
- Set `users.account_status = LOCKED`. **KHÔNG** set `locked_until` (giữ `null` = vô thời hạn tới khi admin mở; §1). `updated_at` tự cập nhật. **KHÔNG** set `updated_by` (cột không tồn tại).
- **KHÔNG** chạm `user_roles` (role giữ nguyên — khác UC-10), **KHÔNG** đụng hồ sơ (UC-09), **KHÔNG** soft-delete. → thỏa "dữ liệu lịch sử giữ nguyên".

### 5.2. Thu hồi mọi session (Expected Output "mọi session bị thu hồi")
- Set Redis `auth:user:{userId}:invalid_after = now()` (tái dùng cơ chế UC-10/UC-11) → guard từ chối mọi access token `iat < invalid_after` ⇒ cắt session ngay. TTL ≥ TTL refresh token.
- Login đã chặn `LOCKED` (423) sẵn ⇒ không đăng nhập lại được tới khi mở khóa.
- Redis fail → log, **không throw/rollback** (mirror UC-10/UC-11 Phase C).

### 5.3. Lý do khóa (lock reason)
- `users` **không có** cột lý do khóa và không có `metadata_json`. **KHÔNG tự thêm cột** (ràng buộc).
- **Đề xuất (khuyến nghị)**: nhận `reason` tùy chọn ở body và ghi vào `audit_logs` (`new_value_json`/`metadata_json` của audit) — **không** cần cột mới. Chờ duyệt.
- *(Phương án thay thế, chờ duyệt nếu team yêu cầu lưu bền trên user)*: đề xuất thêm cột `lock_reason`/`locked_by`/`locked_at` — **đề xuất mới, chờ duyệt**, KHÔNG tự thêm ở bước này.

### 5.4. Mở khóa (unlock)
- Set `account_status = ACTIVE`. **Đề xuất** reset `failed_login_count = 0` và `locked_until = null` (dọn trạng thái khóa) — chờ chốt.
- **KHÔNG** thao tác token (không có session hợp lệ khi đang khóa; sau mở khóa user đăng nhập mới).
- ⚠️ **Điểm cần chốt**: mở khóa đưa về `ACTIVE` (đề xuất) hay về trạng thái trước khi khóa (hệ thống **không** lưu trạng thái trước → không khôi phục được INACTIVE cũ; đề xuất về ACTIVE).

---

## 6. Business Rules & Validation

| # | Rule | Xử lý khi vi phạm |
| :--- | :--- | :--- |
| BR-01 | **Không tự khóa chính mình** (lock, `targetUserId !== actorId`) | `422 CANNOT_LOCK_SELF` |
| BR-02 | **Không khóa SYSTEM_ADMIN active cuối cùng** (chống lockout hệ thống) | `422 LAST_SYSTEM_ADMIN` (mirror UC-10/UC-11) |
| BR-03 | Lock: no-op nếu đã `LOCKED` → `200` không WRITE/audit. Unlock: nếu **không** đang `LOCKED` → `409 NOT_LOCKED` (hoặc no-op — chờ chốt) | — |
| BR-04 | Có được khóa tài khoản đang `INACTIVE` không? **Đề xuất: có** (leo thang từ vô hiệu hóa mềm sang khóa kỷ luật) | — (chờ chốt) |
| BR-05 | Không thao tác trên tài khoản đã soft-delete | `404 USER_NOT_FOUND` |
| BR-06 | Business Admin chỉ khóa/mở khóa user trong department scope | `403 FORBIDDEN` |
| BR-07 | UC-12 chỉ set LOCKED (lock) / ACTIVE (unlock); KHÔNG làm ACTIVE↔INACTIVE (UC-11) | — |
| BR-08 | Input validation (SEC-03); `reason` (nếu có) giới hạn độ dài | `400` |

> **Điểm cần chốt**: BR-03 unlock khi chưa khóa (409 vs no-op); BR-04 khóa từ INACTIVE.

---

## 7. Main Flow (happy path — LOCK, `PATCH /users/:userId/lock`)

1. Admin gọi `PATCH /api/v1/users/:userId/lock` (± `{ reason }`).
2. `JwtAuthGuard` xác thực. `PermissionsGuard` kiểm `accounts.user.lock`.
3. Validate DTO (`reason` optional, độ dài).
4. Load target (`deleted_at IS NULL`) → không có: `404 USER_NOT_FOUND` (BR-05).
5. Nếu actor không phải System Admin: department scope (BR-06) → ngoài scope: `403`.
6. **BR-01**: `targetUserId === actorId` → `422 CANNOT_LOCK_SELF`.
7. **BR-03 no-op**: nếu `account_status` đã `LOCKED` → `200` không WRITE/audit.
8. **BR-02 last-admin**: nếu target là SYSTEM_ADMIN active cuối cùng → `422 LAST_SYSTEM_ADMIN`.
9. **Trong 1 transaction**: UPDATE `account_status = LOCKED`; ghi `audit_logs` atomic (`ACCOUNT_LOCK`, severity WARNING, old/new status + `reason`).
10. **Sau commit**: set Redis `invalid_after = now()` (thu hồi session). Redis fail → log, không throw.
11. Trả `200` với `{ id, accountStatus: 'locked' }`.

### 7.1. Unlock flow (nếu chốt gộp)
1. `PATCH /api/v1/users/:userId/unlock`; permission `accounts.user.unlock`.
2. Load target (deleted_at IS NULL) → 404 nếu không.
3. Scope Business Admin → 403 nếu ngoài.
4. BR-03: nếu không đang `LOCKED` → `409 NOT_LOCKED` (hoặc no-op — chờ chốt).
5. Transaction: UPDATE `account_status = ACTIVE` (+ reset `failed_login_count=0`, `locked_until=null` nếu chốt) + audit `ACCOUNT_UNLOCK` (INFO).
6. Không thao tác token.

---

## 8. Alternative / Exception Flows

| Tình huống | HTTP | error.code |
| :--- | :--- | :--- |
| Thiếu/sai JWT | 401 | `UNAUTHORIZED` |
| Thiếu permission | 403 | `FORBIDDEN` |
| Ngoài department scope (Business Admin) | 403 | `FORBIDDEN` |
| `userId` sai UUID | 400 | `INVALID_USER_ID` |
| User không tồn tại/đã xóa | 404 | `USER_NOT_FOUND` |
| Tự khóa mình | 422 | `CANNOT_LOCK_SELF` |
| SYSTEM_ADMIN cuối cùng | 422 | `LAST_SYSTEM_ADMIN` |
| Unlock tài khoản không bị khóa (nếu chốt 409) | 409 | `NOT_LOCKED` |
| Lỗi transaction | 500 | (không lộ stack trace — ENG-03) |

Body lỗi theo module: `{ success:false, message, error:{ code, details } }`.

---

## 9. Permission & RBAC

- Permission code (**đề xuất mới, chờ duyệt**): `accounts.user.lock` (lock) và `accounts.user.unlock` (unlock). *(Phương án gộp: `accounts.user.manage_lock` — chờ chốt.)*
- Role được gán: **`SYSTEM_ADMIN`** (không scope) + **`BUSINESS_ADMIN`** (department scope — mirror UC-11).
- Guard: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('accounts.user.lock' | 'accounts.user.unlock')`.

> **Điểm cần chốt**: 2 permission tách (lock/unlock) hay 1 permission chung; actor Business Admin có được khóa không (khóa là hành động ảnh hưởng lớn) — đề xuất theo UC list: cho phép Business Admin trong scope.

---

## 10. Audit (bắt buộc)

- CLAUDE.md §17 (thay đổi trạng thái/khóa tài khoản) bắt buộc audit. Severity cao.
- Bản ghi (field thật [audit-log.entity.ts](../../../../src/modules/administration/entities/audit-log.entity.ts)):
  - `user_id` = actor.
  - `action_type` = **`ACCOUNT_LOCK`** / **`ACCOUNT_UNLOCK`** *(đề xuất; đồng bộ `ACCOUNT_STATUS_UPDATE/DELETE`)*.
  - `entity_type` = `users`, `entity_id` = targetUserId.
  - `severity` = `WARNING` (lock), `INFO` (unlock).
  - `old_value_json = { accountStatus: <cũ> }`, `new_value_json = { accountStatus: <mới> }`; `metadata_json` (hoặc `new_value_json`) chứa `reason` nếu có.
  - **KHÔNG** log secret.
- Ghi audit **atomic trong transaction** với UPDATE (mirror UC-11).

---

## 11. Ảnh hưởng phụ & lưu ý

- **KHÔNG** sửa `login.service`/auth (đã chặn LOCKED sẵn; auto-lock rate-limit không đụng).
- **KHÔNG** chạm `user_roles`/hồ sơ/soft-delete ⇒ "dữ liệu lịch sử giữ nguyên".
- Thu hồi token tái dùng `invalid_after`; không viết cơ chế mới.
- **KHÔNG** dùng UC-12 để đặt INACTIVE/ACTIVE thường (UC-11).
- `reason` khóa: lưu ở `audit_logs` (khuyến nghị) — không thêm cột `users`.

---

## 12. Giả định & điểm cần chốt

1. **[Unlock]** UC-12 có gộp unlock không (đề xuất có), hay unlock là UC riêng.
2. **[locked_until]** Khóa thủ công để `locked_until=null` (vô thời hạn — đề xuất) hay có hạn.
3. **[Lý do khóa]** Lưu `reason` ở `audit_logs` (đề xuất) hay đề xuất thêm cột `lock_reason`/`locked_by`/`locked_at` (chờ duyệt, không tự thêm).
4. **[BR-03 unlock]** Unlock khi chưa khóa → 409 NOT_LOCKED hay no-op 200.
5. **[BR-04]** Cho khóa tài khoản đang INACTIVE không (đề xuất có).
6. **[Unlock target status]** Mở khóa → ACTIVE (đề xuất; không khôi phục INACTIVE cũ vì không lưu trạng thái trước).
7. **[Reset khi unlock]** Có reset `failed_login_count=0`/`locked_until=null` khi unlock không (đề xuất có).
8. **[Permission]** Tách `accounts.user.lock`/`unlock` hay gộp `manage_lock`; actor Business Admin.
9. **[Endpoint]** `PATCH :userId/lock|unlock` (đề xuất) vs POST action.

---

## 13. Trạng thái kết luận

**[Missing]**

- **Chưa có gì cho UC-12**: không endpoint lock/unlock, không service, không DTO. Hạ tầng có sẵn để tái dùng: login đã chặn `locked`; token revocation `invalid_after`; department scope; pattern transaction/audit của UC-11.
- **Cần làm (khi duyệt)**:
  1. DTO `LockUserDto` (`reason?` optional, độ dài) cho lock; unlock không cần body.
  2. Endpoint `PATCH /users/:userId/lock` (+ `/unlock` nếu chốt) + `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('accounts.user.lock'/'unlock')`.
  3. Service `lockUser`/`unlockUser`: validate (BR-01…BR-06), department scope, transaction UPDATE `account_status` + audit atomic (`ACCOUNT_LOCK`/`ACCOUNT_UNLOCK`); post-commit revoke token khi lock.
  4. Permission mới + seed (SYSTEM_ADMIN + BUSINESS_ADMIN — chờ chốt).
  5. Unit test: lock happy (LOCKED + revoke + audit + giữ role/dữ liệu), self-lock 422, last-admin 422, no-op đã LOCKED 200, scope 403, USER_NOT_FOUND 404, unlock happy (→ACTIVE, không revoke), unlock-not-locked (409/200 theo chốt), missing permission 403, Redis fail post-commit không throw.
- **Không đụng UC khác**: chỉ set LOCKED/ACTIVE (unlock); KHÔNG ACTIVE↔INACTIVE (UC-11); KHÔNG xóa/soft-delete (UC-10); KHÔNG chạm role (UC-08)/hồ sơ (UC-09); KHÔNG sửa login/auto-lock (auth).
- **Không thêm cột DB**: lý do khóa lưu ở audit (khuyến nghị); cột mới = đề xuất chờ duyệt.
- **Chặn trước khi code**: chốt 9 điểm §12 (đặc biệt: gộp unlock, locked_until, lưu reason, BR-03/BR-04, permission).
