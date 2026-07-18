## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Tạo mới spec cho Role Management (RolesService + RolesController), theo mẫu Spec Kit của feat-permission-management | Toàn bộ file |

# Feature Specification: Quản lý Vai trò (Role Management)

- **Feature ID**: ACCOUNTS-ROLE-001
- **Feature Name**: Quản lý Vai trò (Role CRUD — RolesService + RolesController)
- **Module / Domain**: accounts
- **Created Date**: 2026-07-18
- **Status**: Draft
- **Source Documents**:
  - CLAUDE.md (Backend Agent Guide v1.1) — §22.2 Accounts endpoint grouping (`GET/POST/PATCH /roles`, `POST /roles/:id/permissions`)
  - Database v3.2 Compact — entity thật: `role.entity.ts`, `user-role.entity.ts`, `role-permission.entity.ts`, `permission.entity.ts`
  - Spec đã có: `spec/features/permission/feat-permission-management/` (mẫu Spec Kit + pattern PermissionsController/PermissionsService dùng làm khuôn copy)
  - Spec đã có: `spec/features/account/feat-update-account-role-permission/spec.md` (UC-08 — PUT `/users/:userId/roles`, đã implement với permission `accounts.user.update_roles`)
  - Khảo sát code hiện trạng: `src/modules/accounts/entities/role.entity.ts`, `role-permissions.controller.ts`, `role-permissions.service.ts`, `users.controller.ts`
  - User request: "Module roles — cần thêm RolesService + RolesController"

---

## 0. Trạng thái khảo sát hiện trạng (BẮT BUỘC ĐỌC TRƯỚC)

| Thành phần | Hiện trạng | Vị trí |
| :--- | :--- | :--- |
| `RoleEntity` (bảng `roles`) | ✅ Đã có | [role.entity.ts](../../../../src/modules/accounts/entities/role.entity.ts) |
| Role CRUD (tạo/sửa/xóa/liệt kê role) | ❌ **Missing** | Không có `RolesController`/`RolesService`/DTO nào trong `src/modules/accounts` |
| Gán/gỡ permission cho role đã tồn tại (`role_permissions`) | ✅ Đã có (giữ nguyên, không sửa) | [role-permissions.controller.ts](../../../../src/modules/accounts/controllers/role-permissions.controller.ts), [role-permissions.service.ts](../../../../src/modules/accounts/services/role-permissions.service.ts) — guard `admin.manage_permissions` |
| Gán role cho user (`PUT /users/:userId/roles`, UC-08) | ✅ Đã có (giữ nguyên, không sửa) | [users.controller.ts:210-284](../../../../src/modules/accounts/controllers/users.controller.ts#L210-L284) — permission thật là `accounts.user.update_roles` |

### 0.1. Sửa lệch permission code so với đầu bài người dùng

Đầu bài liệt kê mục #7 (giữ nguyên) dùng permission `account.role.update` cho `PUT /users/{userId}/roles`. Khảo sát code thật cho thấy endpoint này đã implement với permission `accounts.user.update_roles` (xem [users.controller.ts:213](../../../../src/modules/accounts/controllers/users.controller.ts#L213) và spec [feat-update-account-role-permission/spec.md §5.1](../feat-update-account-role-permission/spec.md)). Spec này **ưu tiên code thật** (CLAUDE.md §1, thứ tự ưu tiên: code hiện tại chỉ đứng sau các tài liệu spec khi có mâu thuẫn về suy đoán, nhưng khi tài liệu suy đoán từ CLAUDE.md mâu thuẫn với code đã implement, spec phải phản ánh đúng thực tế). Mục #7 được ghi nhận là **đã tồn tại, không cần làm lại**, và **không đổi permission code hiện có** — xem §8 Out of Scope.

### 0.2. Ghi chú naming convention permission

Codebase hiện tại có 2 convention permission code song song cho module `accounts`:

- `accounts.<resource>.<action>` (số nhiều — đa số endpoint user: `accounts.user.create`, `accounts.user.update_roles`, ...).
- `account.<resource>.<action>` (số ít — xuất hiện ở `account.user.read.detail` và đã được dùng làm tiền lệ cho role trong `feat-update-account-role-permission/spec.md §5.1` khi nhắc tới `account.role.update`).

Đầu bài yêu cầu 4 permission mới dùng tiền tố số ít `account.role.*`. Spec này **giữ nguyên yêu cầu người dùng** (`account.role.create`, `account.role.read`, `account.role.update`, `account.role.delete`) để nhất quán với tiền lệ `account.role.update` đã xuất hiện trong tài liệu trước đó, dù biết codebase có sự không nhất quán này. **Không** tự ý thống nhất lại toàn bộ naming convention permission trong phạm vi feature này — xem §8 Out of Scope.

Giá trị cột `module_code` khi tạo bản ghi `permissions` cho 4 quyền mới này vẫn dùng `accounts` (số nhiều) vì đó là giá trị hợp lệ duy nhất liên quan tới domain accounts trong `MODULE_CODE_ALLOWLIST` ([permission-module-allowlist.constant.ts](../../../../src/modules/accounts/constants/permission-module-allowlist.constant.ts)) — `permissionCode` (chuỗi hiển thị/so khớp trong `@RequirePermissions`) và `moduleCode` (cột phân loại) là hai trường độc lập, không bắt buộc phải trùng tiền tố.

---

## Hướng dẫn viết EARS Requirements

Functional Requirements trong spec này phải ưu tiên viết theo EARS.
EARS giúp requirement rõ trigger, rõ điều kiện, rõ system response, dễ trace sang plan/task/test.

### EARS Keyword Rules

| Keyword | Vai trò | Khi nào dùng |
|---|---|---|
| `THE system SHALL` | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error | Ubiquitous Requirement |
| `WHEN` | Trigger/event xảy ra tại một thời điểm | Event-driven Requirement |
| `WHILE` | Hành vi đúng trong suốt một trạng thái | State-driven Requirement |
| `WHERE` | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại | Optional Feature Requirement |
| `IF ... THEN` | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn | Unwanted Behavior Requirement |

---

## 1. Context & Goal

### 1.1 Bối cảnh

Hệ thống Intelligent Meeting Lifecycle Management sử dụng RBAC (`roles`, `permissions`, `user_roles`, `role_permissions`) để kiểm soát truy cập. Feature `feat-permission-management` đã cung cấp Permission Catalog CRUD và Role-Permission Assignment (gán/gỡ permission cho role **đã tồn tại**). Tuy nhiên, hệ thống hiện **chưa có API để quản lý vòng đời của chính đối tượng `role`** (tạo role mới, sửa tên/mô tả, vô hiệu hóa, liệt kê, xem chi tiết) — bảng `roles` chỉ có Entity, chưa có Service/Controller.

Thiếu Role CRUD khiến việc tạo vai trò nghiệp vụ mới (ví dụ `ROOM_COORDINATOR`, `IT_SUPPORT`) phải thao tác trực tiếp trên database, không qua API, không có validation, không có audit log.

### 1.2 Mục tiêu

Cho phép System Administrator quản lý vòng đời của `role` (tạo, xem, sửa, vô hiệu hóa) một cách an toàn, có ghi vết (audit log), tái sử dụng đúng pattern đã kiểm chứng ở `PermissionsController`/`PermissionsService`, và bảo vệ các role hệ thống (`is_system_role = true`) khỏi bị chỉnh sửa/xóa gây lockout.

### 1.3 Giá trị mang lại

- **Cho Admin/Quản trị hệ thống**: Tự tạo và quản lý vai trò nghiệp vụ mới qua API, không cần can thiệp DB thủ công.
- **Cho toàn bộ hệ thống**: Hoàn thiện vòng RBAC — Role CRUD (feature này) + Role-Permission Assignment (đã có) + User-Role Assignment (đã có, UC-08) = đủ bộ RBAC management.
- **Cho vận hành và bảo mật**: Ghi vết đầy đủ ai tạo/sửa/xóa role nào; chặn thao tác nguy hiểm lên system role.
- **Cho dữ liệu**: `roles` được quản lý tập trung qua API thay vì thao tác DB trực tiếp.

### 1.4 Giả định

- Người dùng gọi API đã được xác thực qua JWT (Authenticated).
- Bảng `roles`, `user_roles`, `role_permissions` đã tồn tại trong database và có Entity TypeORM tương ứng (`RoleEntity`, `UserRoleEntity`, `RolePermissionEntity`).
- 4 permission code mới (`account.role.create`, `account.role.read`, `account.role.update`, `account.role.delete`) chưa tồn tại trong bảng `permissions` và cần được seed trước khi feature này có thể hoạt động đúng trong môi trường có PermissionsGuard bắt buộc (seed nằm trong scope Implementation — xem tasks.md; seed data cụ thể/migration script nằm ngoài phạm vi spec này, xem §8).
- roleCode dùng định dạng chữ hoa snake_case (ví dụ `ROOM_COORDINATOR`), nhất quán với dữ liệu role hiện có (`SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`, `EMPLOYEE` — xem `feat-update-account-role-permission/spec.md §5.2`).
- Hệ thống đã được bootstrap với ít nhất một active System Admin có đủ 4 permission `account.role.*`. Seed bootstrap RBAC là precondition, không nằm trong phạm vi feature này (đồng nhất với giả định của `feat-permission-management`).

### 1.5 Cần làm rõ

- **[Đã tự quyết, ghi nhận lại]** `isSystemRole` **không** được phép set qua `CreateRoleDto` — mọi role tạo mới qua API luôn có `isSystemRole = false`. Lý do: tránh một actor có `account.role.create` tự tạo ra role mang cờ `is_system_role = true` rồi lợi dụng cơ chế bảo vệ system role (§3.5) để leo thang đặc quyền. Việc gắn `isSystemRole = true` cho một role (ví dụ khi cần thêm role hệ thống mới) chỉ thực hiện qua migration/seed, ngoài phạm vi API này.
- **[Đã tự quyết, ghi nhận lại]** Endpoint xóa dùng `DELETE /roles/:id` (soft-delete, set `isActive = false`) — không dùng `PATCH /roles/:id/deactivate` (2 phương án đầu bài đưa ra) — để nhất quán với pattern soft-delete đã dùng ở `DELETE /users/:userId` ([users.controller.ts:583](../../../../src/modules/accounts/controllers/users.controller.ts#L583)).

---
## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| System Administrator | Người quản trị hệ thống, thực hiện tất cả thao tác quản lý role | Tạo/sửa/vô hiệu hóa role; xem danh sách và chi tiết role |
| Authenticated User (khác Admin, có `account.role.read`) | Người dùng đã đăng nhập, chỉ được xem | Chỉ xem danh sách/chi tiết role, không được ghi |

### 2.2 Role & Permission Rules

- Mọi thao tác ghi (POST, PATCH, DELETE) yêu cầu permission tương ứng: `account.role.create`, `account.role.update`, `account.role.delete`.
- Thao tác đọc (GET) yêu cầu permission `account.role.read`.
- Role có `is_system_role = true` được bảo vệ khỏi: (a) bị đổi `roleCode`/`isSystemRole`, (b) bị vô hiệu hóa (`isActive = false`) qua PATCH, (c) bị xóa (soft-delete) qua DELETE.

### 2.3 Actor Constraints

- Phải đăng nhập (JWT hợp lệ).
- Phải có permission tương ứng với từng hành động (`account.role.create`, `account.role.read`, `account.role.update`, `account.role.delete`).
- JWT phải chứa `userId` (hoặc `sub`) để ghi nhận actor trong audit log.

---
## 3. Functional Requirements

> Tất cả Functional Requirements phải viết theo EARS.
> Keyword EARS phải giữ bằng tiếng Anh. Nội dung nghiệp vụ viết bằng tiếng Việt.

### 3.1 Core Requirements

```text
FR-001: THE system SHALL cho phép System Administrator tạo role mới với các trường bắt buộc: roleCode, roleName.
FR-002: THE system SHALL đảm bảo roleCode là duy nhất trong toàn bộ hệ thống, không cho phép tạo hai role có cùng roleCode.
FR-003: THE system SHALL cho phép System Administrator xem danh sách role với phân trang, filter theo isActive, và search theo roleCode / roleName.
FR-004: THE system SHALL cho phép System Administrator xem chi tiết một role theo ID, kèm số lượng user đang được gán role đó (assignedUserCount, đếm trên user_roles.is_active = true).
FR-005: THE system SHALL cho phép System Administrator cập nhật role với các trường được phép sửa: roleName, description, isActive.
FR-006: THE system SHALL cấm cập nhật roleCode và isSystemRole của một role sau khi role đã được tạo, với mọi role (không riêng system role).
FR-007: THE system SHALL luôn tạo role mới với isSystemRole = false; CreateRoleDto không expose trường isSystemRole.
FR-008: THE system SHALL cho phép System Administrator vô hiệu hóa (soft-delete) một role thông qua DELETE /roles/:id, chuyển isActive = false.
```

### 3.2 Event-driven Requirements

```text
FR-009: WHEN System Administrator gửi yêu cầu tạo role mới, THE system SHALL kiểm tra tính duy nhất của roleCode trước khi tạo bản ghi.
FR-010: WHEN System Administrator gửi yêu cầu cập nhật role, THE system SHALL kiểm tra role có tồn tại trước khi cho phép cập nhật.
FR-011: WHEN System Administrator gửi yêu cầu xóa (soft-delete) một role, THE system SHALL kiểm tra role có tồn tại, sau đó kiểm tra role có phải system role hay không, sau đó kiểm tra role có đang được gán cho user active hay không — theo đúng thứ tự này trước khi xóa.
FR-012: WHEN System Administrator gửi yêu cầu xem chi tiết role, THE system SHALL đếm số lượng bản ghi user_roles đang active tham chiếu tới role đó và trả về trong assignedUserCount.
```

### 3.3 State-driven Requirements

```text
FR-013: WHILE một role có isSystemRole = true, THE system SHALL từ chối mọi yêu cầu PATCH đặt isActive = false lên role đó.
FR-014: WHILE một role có isSystemRole = true, THE system SHALL từ chối mọi yêu cầu DELETE (soft-delete) lên role đó.
FR-015: WHILE một role đang được gán cho ít nhất một user active (user_roles.is_active = true), THE system SHALL từ chối yêu cầu DELETE (soft-delete) role đó.
FR-016: WHILE một role có isActive = false, THE system SHALL vẫn cho phép GET chi tiết/GET danh sách role đó khi không áp dụng filter isActive=true.
```

### 3.4 Optional Feature Requirements

Không có optional feature requirement cho tính năng này.

### 3.5 Unwanted Behavior Requirements

```text
FR-017: IF roleCode đã tồn tại trong hệ thống, THEN THE system SHALL từ chối yêu cầu tạo role và trả về lỗi 409 với mã ROLE_CODE_DUPLICATE.
FR-018: IF roleCode không đúng định dạng chuẩn (không phải chữ hoa A-Z, số 0-9, underscore, bắt đầu bằng chữ cái), THEN THE system SHALL từ chối yêu cầu và trả về lỗi validation với mã INVALID_ROLE_CODE_FORMAT.
FR-019: IF body của yêu cầu PATCH /roles/:id chứa trường roleCode hoặc isSystemRole, THEN THE system SHALL từ chối toàn bộ yêu cầu và trả về lỗi 400 với mã VALIDATION_ERROR.
FR-020: IF role cần xóa có isSystemRole = true, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 422 với mã CANNOT_DELETE_SYSTEM_ROLE.
FR-021: IF role cần vô hiệu hóa qua PATCH (isActive=false) có isSystemRole = true, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 422 với mã CANNOT_MODIFY_SYSTEM_ROLE.
FR-022: IF role cần xóa đang được gán cho ít nhất một user active, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 409 với mã ROLE_IN_USE.
FR-023: IF role ID trong request không tồn tại trong hệ thống, THEN THE system SHALL từ chối yêu cầu và trả về lỗi 404 với mã ROLE_NOT_FOUND.
```

### 3.6 Workflow Requirements

Không có workflow phức tạp cho tính năng này.

### 3.7 Authorization Requirements

```text
FR-024: IF user chưa được xác thực (không có JWT hoặc JWT không hợp lệ), THEN THE system SHALL từ chối truy cập tất cả API endpoints của tính năng này với lỗi 401.
FR-025: IF user đã xác thực nhưng không có permission account.role.create, THEN THE system SHALL từ chối yêu cầu POST /roles và trả về lỗi 403.
FR-026: IF user đã xác thực nhưng không có permission account.role.update, THEN THE system SHALL từ chối yêu cầu PATCH /roles/:id và trả về lỗi 403.
FR-027: IF user đã xác thực nhưng không có permission account.role.delete, THEN THE system SHALL từ chối yêu cầu DELETE /roles/:id và trả về lỗi 403.
FR-028: IF user đã xác thực nhưng không có permission account.role.read, THEN THE system SHALL từ chối yêu cầu GET /roles và GET /roles/:id và trả về lỗi 403.
```

### 3.8 Data & State Requirements

```text
FR-029: WHEN một role được tạo mới thành công, THE system SHALL lưu bản ghi với isActive = true và isSystemRole = false mặc định.
FR-030: WHEN role được cập nhật (roleName/description/isActive) thành công, THE system SHALL cập nhật trường updatedAt tương ứng.
```

### 3.9 Notification / Audit Requirements

```text
FR-031: WHEN một thao tác tạo, cập nhật, hoặc xóa (soft-delete) role được thực hiện thành công, THE system SHALL ghi audit log vào bảng audit_logs với các trường: userId (actor), actionType (CREATE_ROLE / UPDATE_ROLE / DELETE_ROLE), entityType = 'role', entityId, oldValueJson/newValueJson nếu phù hợp, requestId, ipAddress, userAgent, severity, metadataJson. Audit log chỉ ghi sau khi thao tác nghiệp vụ thành công. Dùng AuditLogsService (administration module), không rải raw insert trong business service — nhất quán với PermissionsService.
```

### 3.10 Integration / Device Requirements

Không có yêu cầu tích hợp thiết bị cho tính năng này.

### 3.11 Complex / Combined Requirements

```text
FR-032: WHILE xử lý yêu cầu DELETE /roles/:id, THE system SHALL kiểm tra theo đúng thứ tự: (1) role tồn tại — nếu không, trả 404 ROLE_NOT_FOUND; (2) role.isSystemRole = true — nếu có, trả 422 CANNOT_DELETE_SYSTEM_ROLE; (3) role đang được gán active cho ít nhất một user — nếu có, trả 409 ROLE_IN_USE; chỉ khi cả 3 kiểm tra đều pass mới thực hiện soft-delete (isActive = false) và ghi audit log.
```

### 3.12 Requirement Notes

- FR-006, FR-019 quy định roleCode/isSystemRole immutable **với mọi role** (không chỉ system role) — nhất quán với cách permissionCode/moduleCode/actionCode bị khóa sau khi tạo trong `feat-permission-management` (FR-006 của spec đó).
- FR-013/FR-014/FR-020/FR-021 là 2 lớp bảo vệ riêng biệt cho system role: một cho PATCH (không được tắt active), một cho DELETE (không được xóa) — có 2 mã lỗi khác nhau (CANNOT_MODIFY_SYSTEM_ROLE vs CANNOT_DELETE_SYSTEM_ROLE) để client phân biệt được ngữ cảnh.
- roleCode format chuẩn: regex `^[A-Z][A-Z0-9_]{1,49}$`. Cho phép chữ hoa (A-Z), số (0-9), underscore (_); ký tự đầu tiên phải là chữ cái; tổng độ dài 2-50 ký tự (khớp `role.entity.ts` — `role_code varchar(50)`).

### 3.13 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | Role CRUD - Tạo role | Core requirement |
| FR-002 | Ubiquitous | BR-ROLE-01 | Unique constraint (application-level) |
| FR-003 | Ubiquitous | Role CRUD - List role | Pagination + filter + search |
| FR-004 | Ubiquitous | Role CRUD - Detail | Get by ID + assignedUserCount |
| FR-005 | Ubiquitous | Role CRUD - Update | Chỉ sửa roleName/description/isActive |
| FR-006 | Ubiquitous | BR-ROLE-04 | Cấm sửa roleCode/isSystemRole |
| FR-007 | Ubiquitous | BR-ROLE-05 | Chặn tạo role với isSystemRole=true qua API |
| FR-008 | Ubiquitous | Role CRUD - Delete | Soft-delete |
| FR-009 | Event-driven | BR-ROLE-01 | Validate unique code |
| FR-010 | Event-driven | Role CRUD - Update | Validate tồn tại |
| FR-011 | Event-driven | BR-ROLE-02, BR-ROLE-03 | Thứ tự kiểm tra khi xóa |
| FR-012 | Event-driven | Role CRUD - Detail | Tính assignedUserCount |
| FR-013 | State-driven | BR-ROLE-06 | Chặn deactivate system role |
| FR-014 | State-driven | BR-ROLE-06 | Chặn delete system role |
| FR-015 | State-driven | BR-ROLE-03 | Chặn delete role đang gán user |
| FR-016 | State-driven | Data visibility | Không ẩn role inactive khỏi GET |
| FR-017 | Unwanted Behavior | BR-ROLE-01 | roleCode trùng |
| FR-018 | Unwanted Behavior | BR-ROLE-07 | roleCode sai format |
| FR-019 | Unwanted Behavior | BR-ROLE-04 | Sửa field immutable |
| FR-020 | Unwanted Behavior | BR-ROLE-06 | Xóa system role |
| FR-021 | Unwanted Behavior | BR-ROLE-06 | Deactivate system role |
| FR-022 | Unwanted Behavior | BR-ROLE-03 | Xóa role đang dùng |
| FR-023 | Unwanted Behavior | Role lookup | Role không tồn tại |
| FR-024 | Authorization | NFR-Security | Yêu cầu xác thực |
| FR-025 | Authorization | NFR-Security | Quyền tạo role |
| FR-026 | Authorization | NFR-Security | Quyền cập nhật role |
| FR-027 | Authorization | NFR-Security | Quyền xóa role |
| FR-028 | Authorization | NFR-Security | Quyền đọc role |
| FR-029 | Data & State | Data lifecycle | Default isActive=true, isSystemRole=false |
| FR-030 | Data & State | Data lifecycle | Cập nhật updatedAt |
| FR-031 | Notification / Audit | Audit trail | Audit log cho create/update/delete role (CLAUDE.md §17) |
| FR-032 | Complex | Delete flow | Thứ tự kiểm tra 404 → 422 → 409 khi xóa |

---
## 4. Non-functional Requirements

### 4.1 Performance

```text
NFR-001: THE system SHALL phản hồi các thao tác CRUD role trong vòng dưới 2 giây ở điều kiện tải bình thường.
NFR-002: THE system SHALL hỗ trợ phân trang cho API danh sách role với page mặc định là 1, limit mặc định là 20, limit tối đa là 100.
```

### 4.2 Security

```text
NFR-003: THE system SHALL yêu cầu JWT hợp lệ trước khi cho phép truy cập bất kỳ API endpoint nào của tính năng này.
NFR-004: THE system SHALL kiểm tra permission account.role.* tương ứng cho mọi thao tác.
NFR-005: IF request gửi lên chứa JWT không hợp lệ hoặc đã hết hạn, THEN THE system SHALL từ chối request.
```

### 4.3 Reliability & Consistency

```text
NFR-006: THE system SHALL duy trì tính nhất quán giữa bảng roles và user_roles (không cho xóa role đang được tham chiếu active).
NFR-007: IF thao tác persist (lưu dữ liệu) thất bại, THEN THE system SHALL trả về lỗi phù hợp, không để bản ghi ở trạng thái nửa vời.
```

### 4.4 Usability

```text
NFR-008: THE system SHALL trả về thông báo lỗi bằng tiếng Việt rõ ràng, có mã lỗi nội bộ để client dễ dàng xử lý và hiển thị.
NFR-009: THE system SHALL sử dụng response format thống nhất theo chuẩn: { success, message, data, meta }.
```

### 4.5 Observability

```text
NFR-010: THE system SHALL ghi audit log vào bảng audit_logs (dùng AuditLogsService administration module) cho mọi thao tác tạo, cập nhật, xóa role.
NFR-011: WHEN có lỗi xảy ra trong quá trình xử lý, THE system SHALL ghi đủ thông tin chẩn đoán (request ID, action, lý do lỗi) để hỗ trợ troubleshooting.
```

### 4.6 Maintainability

```text
NFR-012: THE system SHALL giữ logic nghiệp vụ của role CRUD trong module accounts, tái sử dụng cấu trúc file/service/controller theo đúng pattern của PermissionsService/PermissionsController.
NFR-013: THE system SHALL cung cấp unit test cho các luồng success, validation failure, authorization failure, và business rule failure của tính năng này.
```

---
## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| roles | Entity chính — CRUD trực tiếp | Entity: RoleEntity (đã tồn tại, không cần migration) |
| user_roles | Chỉ đọc — check active assignment trước khi xóa role, đếm assignedUserCount | Entity: UserRoleEntity (đã tồn tại) |
| role_permissions | Không chạm trong feature này | Đã xử lý bởi RolePermissionsController/Service (giữ nguyên) |
| audit_logs | Chỉ ghi (audit) | Dùng AuditLogsService, không raw insert |

### 5.2 Dữ liệu đầu vào

#### CreateRoleDto

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| roleCode | string | Có | Mã vai trò duy nhất | Tối đa 50 ký tự, regex `^[A-Z][A-Z0-9_]{1,49}$`, unique |
| roleName | string | Có | Tên hiển thị của vai trò | Tối đa 100 ký tự |
| description | string | Không | Mô tả chi tiết vai trò | Text, nullable |

Không expose `isSystemRole` — luôn mặc định `false` (xem FR-007, §1.5).

#### UpdateRoleDto

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| roleName | string | Không | Tên hiển thị mới | Tối đa 100 ký tự |
| description | string | Không | Mô tả mới | Text, nullable |
| isActive | boolean | Không | Kích hoạt/vô hiệu hóa | Boolean; nếu role.isSystemRole=true và giá trị=false → từ chối (FR-021) |

`roleCode` và `isSystemRole` **không** được khai báo trong DTO này — nếu client vẫn gửi lên, ValidationPipe `forbidNonWhitelisted` hoặc kiểm tra thủ công trong controller (mirror cách `PermissionsController.update` chặn `permissionCode`) phải từ chối với `VALIDATION_ERROR` (FR-019).

#### ListRolesQueryDto

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| page | number | Không | Trang hiện tại, mặc định 1 | >= 1 |
| limit | number | Không | Số item/trang, mặc định 20 | 1-100 |
| sortBy | string | Không | Trường sắp xếp, mặc định createdAt | allowlist: createdAt, roleCode, roleName |
| sortOrder | string | Không | asc/desc, mặc định desc | asc \| desc |
| isActive | boolean | Không | Lọc theo trạng thái active | Boolean |
| search | string | Không | Tìm theo roleCode/roleName (ILIKE) | String |

### 5.3 Dữ liệu đầu ra

#### RoleResponseDto

| Field | Type dự kiến | Mô tả |
|---|---|---|
| id | string (UUID) | ID của role |
| roleCode | string | Mã vai trò |
| roleName | string | Tên vai trò |
| description | string \| null | Mô tả |
| isSystemRole | boolean | Có phải role hệ thống hay không |
| isActive | boolean | Trạng thái hoạt động |
| createdAt | string (ISO 8601) | Thời gian tạo |
| updatedAt | string (ISO 8601) | Thời gian cập nhật gần nhất |

#### RoleDetailResponseDto (GET /roles/:id)

Kế thừa toàn bộ field của `RoleResponseDto`, thêm:

| Field | Type dự kiến | Mô tả |
|---|---|---|
| assignedUserCount | number | Số lượng user đang được gán role này (user_roles.is_active = true) |

### 5.4 State / Status Model

Role có trạng thái nhị phân trên `isActive`:

| Status | Ý nghĩa | Có thể chuyển sang | Điều kiện chuyển |
|---|---|---|---|
| isActive = true | Role đang hoạt động, có thể gán cho user | isActive = false | Admin gửi PATCH isActive=false (role không phải system role) hoặc DELETE (soft-delete, ngoài điều kiện §3.11) |
| isActive = false | Role bị vô hiệu hóa | isActive = true | Admin gửi PATCH isActive=true |

`isSystemRole` không phải state machine — cố định tại thời điểm tạo (luôn `false` qua API này), chỉ thay đổi được ngoài phạm vi feature (migration/seed).

### 5.5 Data Constraints

- roles.roleCode nên là UNIQUE (kiểm tra ở tầng application/service, tương tự cách `PermissionsService` kiểm tra `permissionCode` — bảng `roles` hiện chưa có unique constraint ở DB, không thuộc scope thêm migration của feature này).
- user_roles.roleId tham chiếu roles.id (FK, đã tồn tại theo `user-role.entity.ts`).
- role_permissions.roleId tham chiếu roles.id (FK, đã tồn tại theo `role-permission.entity.ts`).
- Xóa role không dùng `ON DELETE CASCADE` phá dữ liệu — feature này **không hard-delete**, chỉ soft-delete (`isActive=false`) sau khi đã đảm bảo không còn active assignment (FR-015, FR-022).

### 5.6 Data Lifecycle

- **Role được tạo**: Khi Admin gửi POST /api/v1/roles với dữ liệu hợp lệ → isActive=true, isSystemRole=false.
- **Role được cập nhật**: Khi Admin gửi PATCH /api/v1/roles/:id (chỉ roleName, description, isActive).
- **Role bị vô hiệu hóa (soft-delete)**: Khi Admin gửi DELETE /api/v1/roles/:id và role pass đủ 3 điều kiện ở FR-032.

### 5.7 Data-related EARS Requirements

```text
FR-DATA-001: WHEN một role được tạo, THE system SHALL persist đầy đủ roleCode, roleName, description (nullable), isActive=true, isSystemRole=false.
FR-DATA-002: WHEN một role được cập nhật, THE system SHALL chỉ cho phép thay đổi roleName, description, isActive.
FR-DATA-003: IF roleId trong request không tồn tại trong bảng roles, THEN THE system SHALL từ chối request với ROLE_NOT_FOUND.
FR-DATA-004: IF roleCode bị trùng lặp, THEN THE system SHALL từ chối request với ROLE_CODE_DUPLICATE.
```

### 5.8 Cần làm rõ

Không có thêm ngoài các điểm đã tự quyết ở §1.5. Tất cả entity liên quan đã tồn tại trong Database v3.2 Compact, không cần migration mới.

---
## 6. Error Handling

### 6.1 Validation Errors

```text
ERR-001: IF roleCode bị thiếu trong request tạo role, THEN THE system SHALL từ chối request và trả về lỗi validation.
ERR-002: IF roleCode không đúng regex ^[A-Z][A-Z0-9_]{1,49}$ (chữ thường, khoảng trắng, ký tự đặc biệt, bắt đầu bằng số/underscore), THEN THE system SHALL từ chối request và trả về lỗi validation với mã INVALID_ROLE_CODE_FORMAT.
ERR-003: IF roleName vượt quá 100 ký tự, THEN THE system SHALL từ chối request và trả về lỗi validation.
ERR-004: IF roleName bị thiếu trong request tạo role, THEN THE system SHALL từ chối request và trả về lỗi validation.
ERR-005: IF body PATCH /roles/:id chứa trường roleCode hoặc isSystemRole, THEN THE system SHALL từ chối request và trả về lỗi validation với mã VALIDATION_ERROR.
ERR-006: IF page hoặc limit là số âm hoặc không phải số nguyên dương, THEN THE system SHALL từ chối request và trả về lỗi validation.
ERR-007: IF limit vượt quá 100, THEN THE system SHALL từ chối request và trả về lỗi validation.
```

### 6.2 Authentication / Authorization Errors

```text
ERR-008: IF user không gửi JWT token hoặc token không hợp lệ, THEN THE system SHALL trả về lỗi 401 Unauthorized.
ERR-009: IF JWT token đã hết hạn, THEN THE system SHALL trả về lỗi 401 với mã TOKEN_EXPIRED.
ERR-010: IF user không có permission tương ứng với hành động (account.role.create/read/update/delete), THEN THE system SHALL trả về lỗi 403 Forbidden.
```

### 6.3 Business Rule Errors

```text
ERR-011: IF roleCode đã tồn tại, THEN THE system SHALL trả về lỗi 409 Conflict với mã ROLE_CODE_DUPLICATE.
ERR-012: IF role cần xóa có isSystemRole = true, THEN THE system SHALL trả về lỗi 422 Unprocessable Entity với mã CANNOT_DELETE_SYSTEM_ROLE.
ERR-013: IF role cần PATCH isActive=false có isSystemRole = true, THEN THE system SHALL trả về lỗi 422 với mã CANNOT_MODIFY_SYSTEM_ROLE.
ERR-014: IF role cần xóa đang được gán active cho ít nhất một user, THEN THE system SHALL trả về lỗi 409 Conflict với mã ROLE_IN_USE.
ERR-015: IF roleId không tồn tại, THEN THE system SHALL trả về lỗi 404 Not Found với mã ROLE_NOT_FOUND.
```

### 6.4 Conflict Errors

```text
ERR-016: IF có xung đột dữ liệu do thay đổi đồng thời (ví dụ 2 request cùng tạo roleCode giống nhau gần như đồng thời), THEN THE system SHALL đảm bảo chỉ một request thành công, request còn lại nhận ROLE_CODE_DUPLICATE.
```

### 6.5 Error Response Expectations

| Field | Mô tả |
|---|---|
| success | false |
| message | Thông báo lỗi bằng tiếng Việt |
| error.code | Mã lỗi nội bộ (vd: ROLE_CODE_DUPLICATE) |
| error.details | Chi tiết lỗi validation/business nếu cần |
| timestamp | Thời điểm xảy ra lỗi (ISO 8601) |
| path | API path |

---
## 7. Acceptance Criteria

### 7.1 Happy Path

```text
AC-001: Tạo role thành công
Given Admin gửi request POST /api/v1/roles với dữ liệu hợp lệ (roleCode, roleName)
When hệ thống kiểm tra roleCode không trùng và dữ liệu hợp lệ
Then hệ thống tạo bản ghi role mới với isActive=true, isSystemRole=false, trả về 201 Created kèm dữ liệu role.

AC-002: Xem danh sách role
Given Admin gửi request GET /api/v1/roles với query hợp lệ
When hệ thống nhận request
Then hệ thống trả về danh sách role có phân trang, filter isActive, search theo yêu cầu.

AC-003: Xem chi tiết role
Given Admin gửi request GET /api/v1/roles/:id với ID hợp lệ
When hệ thống nhận request
Then hệ thống trả về 200 kèm dữ liệu chi tiết role, bao gồm assignedUserCount.

AC-004: Cập nhật role thành công
Given Admin gửi request PATCH /api/v1/roles/:id với roleName/description/isActive mới, role không phải system role
When hệ thống kiểm tra role tồn tại
Then hệ thống cập nhật thành công, trả về 200 kèm dữ liệu role đã cập nhật.

AC-005: Xóa (soft-delete) role thành công
Given Admin gửi request DELETE /api/v1/roles/:id, role không phải system role và không có user active nào đang gán
When hệ thống kiểm tra đủ 3 điều kiện ở FR-032
Then hệ thống chuyển isActive=false, trả về 200.
```

### 7.2 Validation Cases

```text
AC-006: Tạo role thiếu trường bắt buộc
Given Admin gửi request POST /api/v1/roles thiếu roleCode hoặc roleName
When hệ thống nhận request
Then hệ thống từ chối với 400 Bad Request và lỗi validation chi tiết.

AC-007: Tạo role với roleCode sai format
Given Admin gửi request POST /api/v1/roles với roleCode chữ thường hoặc chứa khoảng trắng
When hệ thống nhận request
Then hệ thống từ chối với 400 Bad Request và mã lỗi INVALID_ROLE_CODE_FORMAT.

AC-008: Cập nhật role với roleCode trong body
Given Admin gửi request PATCH /api/v1/roles/:id kèm trường roleCode
When hệ thống nhận request
Then hệ thống từ chối với 400 Bad Request và mã lỗi VALIDATION_ERROR.

AC-009: Limit vượt quá 100
Given Admin gửi request GET /api/v1/roles?limit=200
When hệ thống nhận request
Then hệ thống từ chối với 400 Bad Request.
```

### 7.3 Authorization Cases

```text
AC-010: Không gửi JWT token
Given user không gửi JWT token trong request
When user gửi request tới bất kỳ API endpoint nào của feature này
Then hệ thống từ chối với 401 Unauthorized.

AC-011: JWT hết hạn
Given user gửi request với JWT đã hết hạn
When hệ thống nhận request
Then hệ thống từ chối với 401 và mã lỗi TOKEN_EXPIRED.

AC-012: User không có quyền account.role.create
Given user có JWT hợp lệ nhưng không có permission account.role.create
When user gửi request POST /api/v1/roles
Then hệ thống từ chối với 403 Forbidden.
```

### 7.4 Business Rule Cases

```text
AC-013: Tạo role với roleCode trùng
Given đã tồn tại role với code ROOM_COORDINATOR
When Admin gửi request tạo role mới với code ROOM_COORDINATOR
Then hệ thống từ chối với 409 Conflict và mã lỗi ROLE_CODE_DUPLICATE.

AC-014: Xóa system role bị cấm
Given role có isSystemRole = true (ví dụ SYSTEM_ADMIN)
When Admin gửi request DELETE /api/v1/roles/:id
Then hệ thống từ chối với 422 và mã lỗi CANNOT_DELETE_SYSTEM_ROLE.

AC-015: Vô hiệu hóa system role qua PATCH bị cấm
Given role có isSystemRole = true
When Admin gửi request PATCH /api/v1/roles/:id với isActive=false
Then hệ thống từ chối với 422 và mã lỗi CANNOT_MODIFY_SYSTEM_ROLE.

AC-016: Xóa role đang được gán cho user active
Given role không phải system role nhưng đang có ít nhất 1 user_roles.is_active=true tham chiếu
When Admin gửi request DELETE /api/v1/roles/:id
Then hệ thống từ chối với 409 Conflict và mã lỗi ROLE_IN_USE.

AC-017: Xóa role hợp lệ (không system role, không còn user active)
Given role không phải system role và không còn user active nào gán
When Admin gửi request DELETE /api/v1/roles/:id
Then hệ thống cho phép xóa (soft-delete), trả về 200.

AC-018: Cập nhật roleName/description cho system role vẫn được phép
Given role có isSystemRole = true
When Admin gửi request PATCH /api/v1/roles/:id chỉ với roleName hoặc description (không đổi isActive)
Then hệ thống cho phép cập nhật thành công, trả về 200.
```

### 7.5 State Transition Cases

```text
AC-019: Vô hiệu hóa role nghiệp vụ (không phải system role)
Given role có isActive = true, isSystemRole = false
When Admin gửi PATCH /api/v1/roles/:id với isActive=false
Then hệ thống chuyển isActive thành false và cập nhật updatedAt.

AC-020: Kích hoạt lại role đã bị vô hiệu hóa
Given role có isActive = false
When Admin gửi PATCH /api/v1/roles/:id với isActive=true
Then hệ thống chuyển isActive thành true và cập nhật updatedAt.
```

### 7.6 Audit / Notification Cases

```text
AC-021: Audit log khi tạo role
Given Admin tạo role mới thành công
When hệ thống hoàn tất thao tác
Then hệ thống ghi audit log vào bảng audit_logs: userId, actionType = 'CREATE_ROLE', entityType = 'role', entityId, newValueJson, requestId, ipAddress.

AC-022: Audit log khi xóa (soft-delete) role
Given Admin xóa role thành công (pass đủ 3 điều kiện)
When hệ thống hoàn tất thao tác
Then hệ thống ghi audit log vào bảng audit_logs: actionType = 'DELETE_ROLE', entityType = 'role', entityId, oldValueJson chứa isActive cũ.
```

### 7.7 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-009, FR-029 | Tạo role thành công |
| AC-002 | FR-003 | List role phân trang/filter/search |
| AC-003 | FR-004, FR-012 | Xem chi tiết role + assignedUserCount |
| AC-004 | FR-005, FR-010, FR-030 | Cập nhật role |
| AC-005 | FR-008, FR-032 | Xóa role hợp lệ |
| AC-006 | ERR-001, ERR-004 | Thiếu trường bắt buộc |
| AC-007 | FR-018, ERR-002 | roleCode sai format |
| AC-008 | FR-006, FR-019, ERR-005 | Sửa field immutable |
| AC-009 | ERR-007 | Limit vượt quá 100 |
| AC-010 | FR-024, ERR-008 | Không gửi token |
| AC-011 | NFR-005, ERR-009 | Token hết hạn |
| AC-012 | FR-025, ERR-010 | Không có quyền account.role.create |
| AC-013 | FR-002, FR-017, ERR-011 | roleCode trùng |
| AC-014 | FR-014, FR-020, ERR-012 | Xóa system role |
| AC-015 | FR-013, FR-021, ERR-013 | Deactivate system role |
| AC-016 | FR-015, FR-022, ERR-014 | Xóa role đang dùng |
| AC-017 | FR-032 | Xóa role hợp lệ (đủ điều kiện) |
| AC-018 | FR-006 (chỉ chặn roleCode/isSystemRole, không chặn roleName/description) | Sửa tên/mô tả system role vẫn OK |
| AC-019 | FR-013 (không áp dụng — role không phải system) | Active → Inactive (role thường) |
| AC-020 | — | Inactive → Active |
| AC-021 | FR-031 | Audit log tạo role |
| AC-022 | FR-031 | Audit log xóa role |

---
## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

- Không tạo UI / giao diện người dùng cho tính năng quản lý role.
- Không tạo bảng database mới, không thêm migration cho unique constraint trên roleCode.
- Không sửa/đổi `RolePermissionsController`/`RolePermissionsService` (mục #6 trong đầu bài — giữ nguyên hoàn toàn).
- Không sửa/đổi `PUT /users/:userId/roles` (mục #7 trong đầu bài, UC-08 — giữ nguyên hoàn toàn, kể cả permission code thật `accounts.user.update_roles`, xem §0.1).
- Không cho phép tạo/gắn role với isSystemRole=true qua API (chỉ qua migration/seed ngoài phạm vi).
- Không hard-delete role — chỉ hỗ trợ soft-delete qua isActive.
- Không hỗ trợ import/export role từ file.
- Không hỗ trợ bulk create/update role.
- Không gửi notification khi có thay đổi role.
- Không thống nhất lại toàn bộ naming convention permission code trong dự án (giữ nguyên `account.role.*` như đầu bài yêu cầu, dù codebase có 2 convention song song — xem §0.2).
- Không viết migration/seed script cụ thể để insert 4 permission code mới vào bảng `permissions` — chỉ liệt kê yêu cầu seed trong tasks.md, thực thi seed nằm ngoài phạm vi spec.
- Không implement giới hạn department scope cho role visibility (khác với UC-08 vốn có department scope cho Business Admin khi gán role cho user) — Role CRUD trong feature này chỉ dùng permission check phẳng (account.role.*), không có scope theo phòng ban.

### 8.1 Không triển khai trong feature này

- Không implement UI/UX cho quản lý role.
- Không thêm bảng mới hoặc migration constraint vào database.
- Không implement lại Role-Permission Assignment (đã có).
- Không implement lại User-Role Assignment / UC-08 (đã có).
- Không implement bootstrap seed RBAC — seed là task riêng.

### 8.2 Có thể xem xét ở feature khác

- Bootstrap seed RBAC (bao gồm insert 4 permission `account.role.*` mới, gán cho SYSTEM_ADMIN) — task riêng, precondition của feature này (giống pattern đã áp dụng cho `feat-permission-management`).
- Cơ chế promote một role thường thành `isSystemRole = true` (nếu có nhu cầu nghiệp vụ) — cần RFC riêng vì rủi ro bảo mật.
- Thống nhất lại toàn bộ naming convention permission code (`accounts.*` vs `account.*`) trong toàn dự án.
- Dashboard quản lý role kèm UI.
- Department-scoped role visibility (nếu nghiệp vụ yêu cầu Business Admin chỉ thấy role trong scope của mình).

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT tạo UI/giao diện người dùng cho tính năng này.
OOS-002: THE system SHALL NOT tạo bảng database mới hoặc migration constraint mới trong feature này.
OOS-003: THE system SHALL NOT sửa đổi hành vi hiện có của RolePermissionsController/RolePermissionsService.
OOS-004: THE system SHALL NOT sửa đổi hành vi hiện có của PUT /users/:userId/roles (UC-08).
OOS-005: THE system SHALL NOT cho phép tạo hoặc promote role thành isSystemRole=true thông qua API của feature này.
OOS-006: THE system SHALL NOT hỗ trợ hard-delete role.
OOS-007: THE system SHALL NOT gửi notification khi có thay đổi role.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements đã viết theo EARS.
- [x] Requirement sử dụng keyword EARS bằng tiếng Anh.
- [x] Đã có đủ 5 EARS basic patterns.
- [x] Đã cân nhắc Complex / Combined EARS Requirements.
- [x] Mỗi requirement có mã ID rõ ràng.
- [x] Requirement có thể kiểm thử được.
- [x] Không mô tả quá sâu implementation.
- [x] Không tự ý thêm feature ngoài tài liệu nguồn (đầu bài + CLAUDE.md §22.2).
- [x] Không tự ý thêm database table/field mới.
- [x] Error handling đã bao gồm các trường hợp cần thiết.
- [x] Error requirements đã ưu tiên format IF ... THEN THE system SHALL.
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR/ERR/NFR liên quan.
- [x] Out of Scope đủ rõ để tránh agent tự mở rộng.
- [x] Các phần thiếu thông tin đã được đưa vào Cần làm rõ hoặc tự quyết có ghi chú lý do.
- [x] Đã ghi nhận và giải thích sự lệch giữa đầu bài (permission code, endpoint xóa) và code/tài liệu thật.
