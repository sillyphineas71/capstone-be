# Feature Specification: Cập nhật thông tin tài khoản nhân sự (Update account information)

- **Feature ID**: UC-09
- **Feature Name**: Cập nhật thông tin tài khoản nhân sự
- **Module / Domain**: accounts
- **Created Date**: 2026-07-12
- **Status**: Draft
- **Related UC**: UC-08 (đổi vai trò — đã implement), UC-11 (khóa/mở tài khoản — nếu có)
- **Source Documents**:
  - Use Case: UC-09 Cập nhật thông tin tài khoản nhân sự
  - Database v3.2 Compact (39 tables) — bảng `users`, `departments`, `audit_logs`
  - CLAUDE.md / AGENTS.md
  - spec/global/constitution.md (LOCKED v1.0.0)
  - Khảo sát code hiện trạng module `src/modules/accounts`

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới spec cho UC-09 sau khi khảo sát hiện trạng module `accounts`. Xác định trạng thái **Missing**. | Toàn bộ file |

---

## 0. Trạng thái khảo sát hiện trạng (BẮT BUỘC ĐỌC TRƯỚC)

> Kết luận nhanh: **[Missing]** — chưa có endpoint/service cập nhật thông tin hồ sơ tài khoản.

| Thành phần liên quan UC-09 | Hiện trạng | Vị trí |
| :--- | :--- | :--- |
| DTO cập nhật thông tin user (`UpdateUserDto`/`UpdateUserProfileDto`) | ❌ **Missing** | Thư mục `dto/` chỉ có `create-user.dto.ts`, `update-user-roles.dto.ts` (UC-08), và các response DTO |
| Endpoint `PATCH`/`PUT` cập nhật thông tin user | ❌ **Missing** | [users.controller.ts](../../../../src/modules/accounts/controllers/users.controller.ts) chỉ có `POST /users`, `GET /users`, `GET /users/:userId`, `GET /users/:userId/public-profile`, `PUT /users/:userId/roles` (UC-08) |
| Method service cập nhật thông tin | ❌ **Missing** | [users.service.ts](../../../../src/modules/accounts/services/users.service.ts) chỉ có `createUser`, `getUserDetail`, `getPublicProfile`, `listUsers`, `updateUserRoles` |
| Logic uniqueness (email/username/employee_code) khi tạo | ✅ Có (tham chiếu để tái dùng) | `createUser` bước 1–5 ([users.service.ts:79-171](../../../../src/modules/accounts/services/users.service.ts#L79-L171)) |
| Department scope resolver cho Business Admin | ✅ Có (tham chiếu để tái dùng) | `resolveDepartmentScope`/`collectDepartmentScope` ([users.service.ts:557-600](../../../../src/modules/accounts/services/users.service.ts#L557-L600)) |

### 0.1. Phân biệt phạm vi với UC-08 (chống trùng lặp)

- **UC-08 (đã làm)**: đổi **vai trò** của tài khoản → bảng `user_roles`. Endpoint `PUT /users/:userId/roles`.
- **UC-09 (spec này)**: đổi **thông tin hồ sơ** của tài khoản → **chỉ** bảng `users`. **KHÔNG** đụng `user_roles`, `roles`, `role_permissions`.

> UC-09 tuyệt đối không chạm role/permission. Mọi thay đổi vai trò đi qua UC-08.

---

## 1. Thông tin Use Case

| Trường | Giá trị |
| :--- | :--- |
| **UC ID** | UC-09 |
| **Use Case Name** | Cập nhật thông tin tài khoản nhân sự (Update account information) |
| **Module** | `accounts` (Account Management) |
| **Primary Actor** | Business Admin *(xem §5 — cần chốt phạm vi so với System Admin)* |
| **Trigger** | Admin chỉnh sửa thông tin một tài khoản nhân sự |
| **Pre-condition** | Tài khoản mục tiêu tồn tại và chưa bị soft-delete (`users.deleted_at IS NULL`); actor đã đăng nhập và có permission phù hợp |
| **Expected Output** | Các trường thông tin (mã NV, SĐT, email, phòng ban, chức danh) được cập nhật trong `users`; có bản ghi `audit_logs` với old/new value |
| **Related** | UC-08 |

---

## 2. Actor & Trigger

- **Primary Actor**: Business Admin (và/hoặc System Admin — xem §5).
- **Trigger**: Admin mở hồ sơ một tài khoản và sửa một hoặc nhiều trường thông tin (mã NV, SĐT, email, phòng ban, chức danh).
- **Secondary Actor**: Không có (đồng bộ, không phụ thuộc thiết bị/hệ thống ngoài).

---

## 3. Endpoint liên quan (đề xuất mới — chờ duyệt)

> Chưa tồn tại endpoint cho UC-09. Theo convention CLAUDE.md §22.2 (`PATCH /api/v1/users/:id`) và §7.3 (partial update dùng `PATCH`):

```text
PATCH /api/v1/users/:userId
Body: UpdateUserDto (partial — chỉ các trường muốn đổi)
```

- **PATCH** (partial update) phù hợp hơn PUT vì admin thường chỉ sửa một vài trường.
- Prefix global `/api/v1`. Param `userId` là UUID (validate qua `ParseUUIDPipe`, mirror `getUserDetail`).

Response bám chuẩn dự án (CLAUDE.md §8.1):

```json
{
  "success": true,
  "message": "Cập nhật thông tin tài khoản thành công",
  "data": { "id": "...", "employeeCode": "...", "email": "...", "fullName": "...", "phoneNumber": "...", "positionTitle": "...", "department": { "id": "...", "departmentName": "..." } }
}
```

> **Điểm cần chốt**: response trả về DTO chi tiết mới (đề xuất `UserUpdatedResponseDto`) hay tái dùng cấu trúc `UserDetailResponseDto` đã có ([user-detail-response.dto.ts](../../../../src/modules/accounts/dto/user-detail-response.dto.ts)). Khuyến nghị tái dùng `UserDetailResponseDto` cho nhất quán.

---

## 4. Data touched (tên field snake_case theo schema THẬT — [user.entity.ts](../../../../src/modules/accounts/entities/user.entity.ts))

### 4.1. Field ĐƯỢC phép cập nhật qua UC-09

| Field DB | Entity prop | Kiểu | Ràng buộc | Nguồn trong Expected Output |
| :--- | :--- | :--- | :--- | :--- |
| `employee_code` | `employeeCode` | varchar(50), nullable | UNIQUE (loại self) nếu có giá trị | mã NV ✓ |
| `phone_number` | `phoneNumber` | varchar(30), nullable | format số điện thoại (mirror `CreateUserDto`) | SĐT ✓ |
| `email` | `email` | varchar(255) | email hợp lệ + UNIQUE (loại self) | email ✓ |
| `department_id` | `departmentId` | uuid, nullable | department tồn tại & `is_active=true` | phòng ban ✓ |
| `position_title` | `positionTitle` | varchar(150), nullable | maxLength 150 | chức danh ✓ |

### 4.2. Field ĐỀ XUẤT cho phép cập nhật (optional — chờ duyệt, KHÔNG có trong Expected Output gốc)

| Field DB | Entity prop | Ghi chú |
| :--- | :--- | :--- |
| `full_name` | `fullName` | Sửa họ tên là nhu cầu profile-edit phổ biến; không nằm trong 5 field expected output. **Đề xuất thêm, chờ duyệt.** |
| `direct_manager_id` | `directManagerId` | Đổi người quản lý trực tiếp; validate manager tồn tại & khả dụng (mirror `createUser` bước 6). **Đề xuất thêm, chờ duyệt.** |

### 4.3. Field TUYỆT ĐỐI KHÔNG cập nhật qua UC-09 (chống scope creep)

| Field / nhóm | Thuộc luồng | Lý do loại trừ |
| :--- | :--- | :--- |
| `user_roles` (vai trò) | **UC-08** | Đổi role đi qua `PUT /users/:userId/roles` |
| `account_status` | **UC-11** (khóa/mở tài khoản) | Khóa/mở là hành động quản trị riêng, cần audit riêng |
| `password_hash`, `must_change_password`, `password_updated_at` | Luồng auth (reset/đổi mật khẩu) | Không sửa qua profile update |
| `failed_login_count`, `locked_until`, `last_login_at` | Hệ thống auth quản lý | Trường hệ thống, không do admin nhập |
| `avatar_url` | Luồng avatar submission/review | Đã có `avatar.controller` + `admin-avatar-review.controller` |
| `employment_status` | HR flow (**cần chốt**) | Không nằm trong Expected Output; đề nghị tách. **Chờ duyệt.** |
| `username` | Dẫn xuất từ email | Xem §8 BR-07 (đồng bộ khi đổi email) — **cần chốt** |
| `id`, `created_at`, `updated_at`, `deleted_at` | Bất biến / hệ thống | Không cho client đổi |

### 4.4. Bảng bị ghi

| Bảng | Thao tác | Ghi chú |
| :--- | :--- | :--- |
| `users` | UPDATE (các field §4.1/§4.2) + `updated_at` (auto), `updated_by` nếu team dùng | Bảng trung tâm |
| `departments` | READ | Validate `department_id` tồn tại & active |
| `users` (self-lookup) | READ | Validate `direct_manager_id` nếu §4.2 được duyệt |
| `audit_logs` | INSERT (bắt buộc) | old/new value cho field thay đổi — §10 |

> Không bịa thêm field/bảng. Mọi field trên đều tồn tại trong `user.entity.ts`.

---

## 5. Permission cần thiết & mô hình RBAC

### 5.1. Permission code (đề xuất mới — chờ duyệt)

Hiện **chưa có** permission cho cập nhật thông tin user (đã grep `src`). Đề xuất:

```text
accounts.user.update            # đề xuất mới, chờ duyệt
  module_code = accounts   (nằm trong MODULE_CODE_ALLOWLIST)
  action_code = update
```

> Ghi chú: KHÔNG tái dùng `accounts.user.update_roles` (UC-08) — đó là quyền đổi vai trò, khác nghiệp vụ. Naming nên nhất quán tiền tố `accounts.` (lưu ý hệ thống hiện có sự pha trộn `account.user.read.detail` vs `accounts.user.create` — nên chuẩn hóa về `accounts.` nhưng đó là việc ngoài UC-09).

### 5.2. Role được gán & phạm vi (cần chốt)

| Role | Được `accounts.user.update`? | Phạm vi |
| :--- | :--- | :--- |
| `SYSTEM_ADMIN` | ✅ Có | Toàn bộ tài khoản, không giới hạn scope |
| `BUSINESS_ADMIN` | ⚠️ **Cần chốt** (Primary Actor) | Nếu cho phép → **giới hạn department scope** (chỉ user thuộc department + department con của mình), tái dùng `resolveDepartmentScope` như UC-15/getUserDetail |
| `MANAGER` / `EMPLOYEE` | ❌ Mặc định không | Trừ khi team yêu cầu |

> ⚠️ **Xác nhận/lệch cần nêu rõ**: UC list ghi Primary Actor = **Business Admin**. Code hiện tại đã hỗ trợ Business Admin ở luồng **đọc** chi tiết (`getUserDetail`) với **department scope** ([users.service.ts:378-393](../../../../src/modules/accounts/services/users.service.ts#L378-L393)). Vì vậy cho Business Admin **sửa** thông tin trong phạm vi department là hợp lý và nhất quán. Tuy nhiên đây là **quyết định chính sách chưa chốt** (khác UC-08 vốn đã chốt chỉ System Admin). Spec giả định: **Business Admin được phép, giới hạn department scope; System Admin không giới hạn** — **chờ team xác nhận**.

### 5.3. Department scope cho Business Admin (tái dùng)

Tái dùng `resolveDepartmentScope` / `collectDepartmentScope` (`MAX_DEPARTMENT_SCOPE_DEPTH = 5`) và cách phân biệt System Admin qua `role.is_system_role`. Nếu target user ngoài scope → `403 FORBIDDEN`.

> **Điểm cần chốt bổ sung**: khi đổi `department_id`, department **mới** có bắt buộc nằm trong scope của Business Admin không (tránh Business Admin "chuyển" nhân sự sang phòng ban ngoài quyền quản lý)? Đề xuất: **cả department cũ lẫn mới phải trong scope** — chờ duyệt.

---

## 6. Main Flow (happy path — `PATCH /users/:userId`)

1. Actor gọi `PATCH /api/v1/users/:userId` với body partial (chỉ field muốn đổi).
2. `JwtAuthGuard` xác thực (SEC-02). `PermissionsGuard` kiểm tra `accounts.user.update`.
3. Validate DTO (`UpdateUserDto`): mọi field optional; field nào có mặt phải hợp lệ (email, phone format, độ dài, UUID cho `department_id`/`direct_manager_id`). `whitelist + forbidNonWhitelisted` để chặn field ngoài phạm vi (§4.3).
4. Load target user (`deleted_at IS NULL`) → không có: `404 USER_NOT_FOUND`.
5. Nếu actor **không** phải System Admin: kiểm tra department scope (§5.3) → ngoài scope: `403 FORBIDDEN`.
6. Validate nghiệp vụ cho từng field có mặt (§8): uniqueness loại self (email/username/employee_code), department active, manager khả dụng.
7. Nếu không có thay đổi thực chất (giá trị mới trùng giá trị cũ toàn bộ) → trả `200` "Không có thay đổi" (idempotent, không ghi audit — hoặc audit `info` tùy chính sách).
8. **Trong 1 transaction** (CLAUDE.md §14.4): cập nhật các field vào `users`; nếu đổi `email` thì đồng bộ `username` (BR-07, chờ chốt); ghi `audit_logs` với `old_value_json`/`new_value_json` chỉ chứa **các field đã đổi**.
9. Trả `200` với thông tin tài khoản sau cập nhật.

---

## 7. Alternative Flows

- **A1 — No-op**: body trùng toàn bộ giá trị hiện tại → `200`, message "Không có thay đổi", không UPDATE/không audit.
- **A2 — Cập nhật một phần**: chỉ 1 field (vd `phone_number`) → chỉ field đó đổi + audit chỉ chứa field đó.
- **A3 — Actor là System Admin**: bỏ qua kiểm tra department scope (bước 5).

---

## 8. Business Rules & Validation

| # | Rule | Xử lý khi vi phạm |
| :--- | :--- | :--- |
| BR-01 | `email` hợp lệ và **UNIQUE** trong số user chưa soft-delete, **loại trừ chính user đang sửa** | `409 ACCOUNT_EMAIL_ALREADY_EXISTS` |
| BR-02 | `employee_code` (nếu có) **UNIQUE** (loại self) | `409 ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS` |
| BR-03 | `phone_number` đúng format (mirror regex `CreateUserDto`) | `400` validation |
| BR-04 | `department_id` (nếu đổi) tồn tại & `is_active=true` | `404 DEPARTMENT_NOT_FOUND` / `422 DEPARTMENT_INACTIVE_OR_DELETED` |
| BR-05 | `position_title` ≤ 150 ký tự; `full_name` ≤ 255 (nếu §4.2 duyệt) | `400` validation |
| BR-06 | Không cho cập nhật field ngoài §4.1/§4.2 (chặn `account_status`, `roleIds`, `password`, `avatar_url`, `username` trực tiếp…) | `400` (forbidNonWhitelisted) |
| BR-07 | Khi đổi `email`: đồng bộ `username = email` và kiểm tra `username` UNIQUE (loại self). **Cần chốt**: có cho đổi email không, hay email là bất biến? | `409 ACCOUNT_USERNAME_ALREADY_EXISTS` / hoặc chặn nếu chốt bất biến |
| BR-08 | `direct_manager_id` (nếu §4.2 duyệt) trỏ tới user active, không nghỉ việc; không tự trỏ vào chính mình (chống self-manager loop) | `404 MANAGER_NOT_FOUND` / `422 MANAGER_INACTIVE_OR_UNAVAILABLE` / `422 INVALID_MANAGER_SELF` |
| BR-09 | Không thao tác trên tài khoản đã soft-delete | `404 USER_NOT_FOUND` |
| BR-10 | Business Admin chỉ sửa user trong department scope; department **mới** (nếu đổi) cũng trong scope (chờ chốt §5.3) | `403 FORBIDDEN` |
| BR-11 | DTO partial: tất cả field optional, nhưng phải có **≥ 1** field để cập nhật | `400 EMPTY_UPDATE` (đề xuất) hoặc coi như A1 no-op |
| BR-12 | Input validation trước khi chạm DB (SEC-03); không raw SQL nối chuỗi | — |

> Uniqueness (BR-01/02/07) hiện được `createUser` xử lý inline với `deletedAt: IsNull()` — UC-09 tái dùng nhưng **thêm điều kiện loại trừ `id != :targetUserId`** (khác biệt then chốt so với create).

---

## 9. Exception Flows

| Tình huống | HTTP | error.code |
| :--- | :--- | :--- |
| Thiếu/sai JWT | 401 | `UNAUTHORIZED` |
| Thiếu permission `accounts.user.update` | 403 | `FORBIDDEN` |
| Ngoài department scope (Business Admin) | 403 | `FORBIDDEN` |
| `userId` sai định dạng UUID | 400 | `INVALID_USER_ID` |
| Body chứa field ngoài phạm vi | 400 | (forbidNonWhitelisted) |
| Không field nào để cập nhật | 400 | `EMPTY_UPDATE` (đề xuất) |
| User mục tiêu không tồn tại/đã xóa | 404 | `USER_NOT_FOUND` |
| Email trùng user khác | 409 | `ACCOUNT_EMAIL_ALREADY_EXISTS` |
| Username (email) trùng | 409 | `ACCOUNT_USERNAME_ALREADY_EXISTS` |
| Employee code trùng | 409 | `ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS` |
| Department không tồn tại | 404 | `DEPARTMENT_NOT_FOUND` |
| Department inactive/deleted | 422 | `DEPARTMENT_INACTIVE_OR_DELETED` |
| Manager không tồn tại/không khả dụng (nếu §4.2) | 404/422 | `MANAGER_NOT_FOUND` / `MANAGER_INACTIVE_OR_UNAVAILABLE` |
| Lỗi transaction | 500 | (không lộ stack trace — ENG-03) |

Định dạng body lỗi theo module: `{ success:false, message, error:{ code, details } }` (+ `timestamp`,`path` nếu qua global filter).

---

## 10. Audit (bắt buộc)

- CLAUDE.md §17 liệt kê **"Create/update/delete user"** là hành động phải audit → UC-09 **PHẢI** ghi `audit_logs`.
- Bản ghi tối thiểu (dùng field thật của [audit-log.entity.ts](../../../../src/modules/administration/entities/audit-log.entity.ts)):
  - `user_id` = actor.
  - `action_type` = `ACCOUNT_UPDATE` *(đề xuất; đồng bộ phong cách `ACCOUNT_CREATE`, `ACCOUNT_ROLE_UPDATE` đã có)*.
  - `entity_type` = `users`, `entity_id` = targetUserId.
  - `old_value_json` / `new_value_json` = **chỉ các field đã thay đổi** (diff), KHÔNG dump toàn bộ user.
  - `ip_address`, `user_agent`, `request_id`, `severity = info`.
- **TUYỆT ĐỐI KHÔNG** log `password_hash`/token/secret. Chỉ log các field profile trong §4.1/§4.2.
- Ghi audit **trong cùng transaction** với UPDATE (mirror `createUser` — atomic) để nhất quán vết thay đổi.

---

## 11. Ảnh hưởng phụ & lưu ý kỹ thuật

- **Đổi email**: ảnh hưởng đăng nhập (username = email). Cần chốt BR-07 (đồng bộ username, có gửi thông báo/verify không). Mặc định spec: đồng bộ `username`, **không** gửi verify (giữ scope tối thiểu) — chờ duyệt.
- **Không** chạm `user_roles`/`role_permissions` (đó là UC-08). Không chạm authz cache (UC-09 không đổi quyền).
- **Notification** (tùy chọn, chờ duyệt): có thể thông báo cho user khi thông tin bị thay đổi — không bắt buộc cho UC-09.
- **Concurrency**: hai admin sửa cùng lúc — cân nhắc optimistic check bằng `updated_at`/version. **Đề xuất optional, chờ duyệt** (baseline chưa có cột version).

---

## 12. Giả định & điểm chưa chắc (cần team chốt)

1. **[Actor/phạm vi]** Business Admin có được sửa thông tin user không, và có bị giới hạn department scope không (§5.2). Spec giả định: có, giới hạn scope.
2. **[Permission code]** `accounts.user.update` — đề xuất mới, cần seed riêng (không tạo ở bước spec).
3. **[Email bất biến?]** BR-07 — cho đổi email + đồng bộ username, hay khóa email? Expected Output liệt kê email ⇒ giả định **cho đổi**.
4. **[Field mở rộng]** `full_name`, `direct_manager_id`, `employment_status` — có nằm trong UC-09 không (§4.2/§4.3). Giả định: full_name/manager là optional đề xuất; employment_status **loại trừ**.
5. **[Scope của department mới]** Business Admin đổi `department_id` sang phòng ban ngoài scope có bị chặn không (§5.3). Giả định: chặn.
6. **[Response DTO]** Tái dùng `UserDetailResponseDto` hay tạo mới. Khuyến nghị tái dùng.
7. **[Empty update]** Body rỗng → `400 EMPTY_UPDATE` hay coi như no-op `200`. Cần chốt (BR-11).
8. **[Concurrency]** Có cần optimistic locking không (§11).

---

## 13. Trạng thái kết luận

**[Missing]**

- **Chưa có gì cho UC-09**: không DTO update, không endpoint `PATCH /users/:userId`, không method service cập nhật thông tin.
- **Cần làm (khi được duyệt)**:
  1. DTO `UpdateUserDto` (partial: `employeeCode?`, `phoneNumber?`, `email?`, `departmentId?`, `positionTitle?` + optional `fullName?`, `directManagerId?` nếu duyệt) với validation + `whitelist/forbidNonWhitelisted`.
  2. Endpoint `PATCH /api/v1/users/:userId` + `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('accounts.user.update')`.
  3. Service `updateUser`: validate (uniqueness loại self, department active, manager khả dụng), department scope cho Business Admin, transaction UPDATE + audit atomic (`ACCOUNT_UPDATE`, old/new diff).
  4. Permission mới `accounts.user.update` + seed (chờ duyệt).
  5. Unit test: uniqueness loại self (BR-01/02/07), department invalid (BR-04), scope (BR-10), no-op (A1), forbidden field (BR-06), USER_NOT_FOUND, missing permission 403.
- **Không đụng UC khác**: KHÔNG chạm `user_roles`/role (UC-08), KHÔNG chạm `account_status` (UC-11), KHÔNG chạm password/avatar.
- **Chặn trước khi code**: chốt 8 điểm ở §12 (đặc biệt actor/scope, email/username, tập field, permission code). Không tự quyết, không tạo migration/seed ở bước spec.
