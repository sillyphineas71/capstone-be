## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-23 | Cập nhật spec theo clarification: permission code format dot, inactive permission semantics, system role protection scope, bulk assign fatal/non-fatal, audit log detail, moduleCode allowlist, bootstrap precondition | Toàn bộ file |

# Feature Specification: Permission Catalog & Role-Permission Assignment

- **Feature ID**: ACCOUNTS-PERM-001
- **Feature Name**: Quản lý Quyền (Permission Catalog) và Gán Quyền cho Vai trò (Role-Permission Assignment)
- **Module / Domain**: accounts
- **Created Date**: 2026-06-23
- **Status**: Draft
- **Source Documents**:
  - AGENTS.md (Backend Agent Guide v1.1)
  - Database v3.2 Compact (Entity definitions: permission.entity.ts, role-permission.entity.ts, role.entity.ts, user.entity.ts)
  - User request: Xây dựng phân hệ Quản lý Quyền và Gán Quyền cho Vai trò

---

## Hướng dẫn viết EARS Requirements

Functional Requirements trong spec này phải ưu tiên viết theo EARS.
EARS giúp requirement rõ trigger, rõ điều kiện, rõ system response, dễ trace sang plan/task/test.

### EARS Keyword Rules

| Keyword | Vai trò | Khi nào dùng |
|---|---|---|
| \THE system SHALL\ | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error | Ubiquitous Requirement |
| \WHEN\ | Trigger/event xảy ra tại một thời điểm | Event-driven Requirement |
| \WHILE\ | Hành vi đúng trong suốt một trạng thái | State-driven Requirement |
| \WHERE\ | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại | Optional Feature Requirement |
| \IF ... THEN\ | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn | Unwanted Behavior Requirement |

---

## 1. Context & Goal

### 1.1 Bối cảnh

Hệ thống Intelligent Meeting Lifecycle Management sử dụng cơ chế phân quyền dựa trên vai trò (RBAC) để kiểm soát truy cập tới các tài nguyên và chức năng. Mỗi tác vụ nghiệp vụ trong hệ thống (tạo cuộc họp, duyệt yêu cầu, quản lý phòng, xem báo cáo, v.v.) cần được ánh xạ tới một quyền cụ thể nhằm đảm bảo chỉ những người dùng có vai trò phù hợp mới được thực hiện.

Hiện tại, hệ thống đã có các bảng permissions, role_permissions, roles trong Database v3.2 Compact thuộc module accounts, nhưng chưa có API để:
- Quản lý danh mục quyền (Permission Catalog): tạo, sửa, vô hiệu hóa, liệt kê, xem chi tiết quyền.
- Gán hoặc gỡ quyền cho vai trò (Role-Permission Assignment) có ghi vết người thực hiện.

Tính năng này nằm ở giai đoạn xuyên suốt hệ thống — nó cung cấp hạ tầng phân quyền cho toàn bộ các module khác. Nó là tiền đề để các module như meetings, rooms, approvals, recording, v.v. có thể triển khai kiểm tra quyền theo chuẩn RBAC.

### 1.2 Mục tiêu

Mục tiêu của tính năng này là cho phép System Administrator quản lý vòng đời của permission (tạo, sửa, vô hiệu hóa, liệt kê, xem chi tiết) và gán các permission đó cho role một cách an toàn, có ghi vết, đảm bảo không phá vỡ các ràng buộc bảo vệ hệ thống.

### 1.3 Giá trị mang lại

- **Cho Admin/Quản trị hệ thống**: Có khả năng định nghĩa và duy trì danh mục quyền chi tiết theo từng module, từng hành động cụ thể.
- **Cho toàn bộ hệ thống**: Đảm bảo cơ chế RBAC hoạt động nhất quán, mọi API endpoint có thể dựa vào permission check đã được định nghĩa trước.
- **Cho vận hành và bảo mật**: Ghi vết rõ ràng người đã gán quyền nào cho vai trò nào, hỗ trợ kiểm toán (audit) và truy vết khi cần.
- **Cho dữ liệu**: Permission và role-permission mapping được quản lý tập trung, tránh tình trạng quyền bị định nghĩa rải rác trong code.

### 1.4 Giả định

- Người dùng gọi API đã được xác thực qua JWT (Authenticated).
- Chỉ System Administrator (kiểm tra qua permission admin.manage_permissions hoặc role phù hợp) mới được phép thao tác với các API này.
- Các bảng permissions, role_permissions, roles đã tồn tại trong database và có Entity TypeORM tương ứng.
- Permission code sử dụng định dạng <module_code>.<action_code>, viết thường, cho phép underscore và nhiều segment cách nhau bằng dấu chấm.
- Hệ thống đã được bootstrap với ít nhất một active System Admin role/user có permission admin.manage_permissions. Seed bootstrap RBAC là task riêng, không nằm trong phạm vi feature này.

### 1.5 Cần làm rõ

Không có. Thông tin đầu vào đã đủ để xây dựng spec.

---
## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| System Administrator | Người quản trị hệ thống, thực hiện tất cả thao tác quản lý permission và gán quyền cho role | Tạo/sửa/vô hiệu hóa permission; gán/gỡ permission cho role; xem danh sách permission và role-permission mapping |
| Authenticated User (khác Admin) | Người dùng đã đăng nhập nhưng không có quyền admin | Chỉ được xem danh sách permission (nếu được cấp quyền permission:read), không được thực hiện các thao tác ghi |

### 2.2 Role & Permission Rules

- System Administrator phải có ít nhất một trong các permission sau để thao tác:
  - admin.manage_permissions — toàn quyền quản lý permission catalog và gán quyền cho role.
- Role is_system_role = true không được gỡ bỏ các quyền thuộc module admin để tránh lockout.
- Mọi thao tác ghi (POST, PATCH, DELETE) đều yêu cầu quyền admin tương ứng.

### 2.3 Actor Constraints

- Phải đăng nhập (JWT hợp lệ).
- Phải có permission admin.manage_permissions hoặc permission tương ứng với từng hành động cụ thể (permission.create, permission.update, permission.delete, role_permission.assign).
- JWT phải chứa userId (hoặc sub) để ghi nhận granted_by.

---
## 3. Functional Requirements

> Tất cả Functional Requirements phải viết theo EARS.
> Keyword EARS phải giữ bằng tiếng Anh. Nội dung nghiệp vụ viết bằng tiếng Việt.

### 3.1 Core Requirements

\\\	ext
FR-001: THE system SHALL cho phép System Administrator tạo permission mới với các trường bắt buộc: permissionCode, permissionName, moduleCode, actionCode.
FR-002: THE system SHALL đảm bảo permissionCode là duy nhất trong toàn bộ hệ thống, không cho phép tạo hai permission có cùng permissionCode.
FR-003: THE system SHALL cho phép System Administrator xem danh sách permission với phân trang, filter theo moduleCode, và search theo permissionCode / permissionName.
FR-004: THE system SHALL cho phép System Administrator xem chi tiết một permission theo ID.
FR-005: THE system SHALL cho phép System Administrator cập nhật thông tin permission với các trường được phép sửa: permissionName, description.
FR-006: THE system SHALL cấm cập nhật permissionCode, moduleCode, actionCode sau khi permission đã được tạo.
FR-007: THE system SHALL cho phép System Administrator kích hoạt hoặc vô hiệu hóa một permission thông qua toggle isActive.
FR-008: THE system SHALL cho phép System Administrator xem danh sách permission đã gán cho một role cụ thể thông qua roleId.
FR-009: THE system SHALL cho phép System Administrator gán một hoặc nhiều permission vào một role, tự động ghi nhận grantedBy từ JWT của người thực hiện.
FR-010: THE system SHALL cho phép System Administrator gỡ một permission khỏi một role.
FR-011: THE system SHALL ghi nhận thời điểm gán permission (grantedAt) khi thực hiện gán permission cho role.
\\\

### 3.2 Event-driven Requirements

\\\	ext
FR-012: WHEN System Administrator gửi yêu cầu tạo permission mới, THE system SHALL kiểm tra tính duy nhất của permissionCode trước khi tạo bản ghi.
FR-013: WHEN System Administrator gửi yêu cầu gán permission hàng loạt vào role với mảng permissionIds, THE system SHALL phân biệt fatal vs non-fatal: IF bất kỳ permissionId không tồn tại hoặc permission inactive (isActive = false), THEN THE system SHALL coi là fatal error, rollback toàn bộ transaction, không tạo bất kỳ bản ghi mới nào. Non-fatal cases (permission đã gán trước đó, permission bị lặp trong request) được skip và tiếp tục xử lý các permission còn lại.
FR-014: WHEN System Administrator gửi yêu cầu gỡ permission khỏi role, THE system SHALL kiểm tra: IF role có is_system_role = true AND permission có moduleCode = 'admin', THEN THE system SHALL từ chối gỡ. Các permission thuộc module khác (meetings, rooms, attendance, v.v.) vẫn cho phép gỡ khỏi system role.
FR-015: WHEN System Administrator gửi yêu cầu toggle-active permission, THE system SHALL kiểm tra permission có tồn tại trước khi thực hiện thay đổi trạng thái.
FR-016: WHEN System Administrator gửi yêu cầu cập nhật permission, THE system SHALL kiểm tra permission có tồn tại trước khi cho phép cập nhật.
\\\

### 3.3 State-driven Requirements

\\\	ext
FR-017: WHILE một permission có isActive = false, THE system SHALL không cho phép gán mới permission đó cho bất kỳ role nào. PermissionGuard ở feature khác, nếu kiểm tra permission inactive, SHALL treat it as not granted and deny access (default deny); feature này không implement PermissionGuard.
FR-018: WHILE một role có thuộc tính is_system_role = true, THE system SHALL chỉ ngăn chặn việc gỡ các permission có moduleCode = 'admin' khỏi role đó. Các permission thuộc module khác không bị giới hạn bởi rule này.
FR-019: WHILE một role đang có ít nhất một permission được gán, THE system SHALL duy trì tính toàn vẹn của bản ghi role_permissions tương ứng.
\\\

### 3.4 Optional Feature Requirements

Không có optional feature requirement cho tính năng này.

### 3.5 Unwanted Behavior Requirements

\\\	ext
FR-020: IF permissionCode đã tồn tại trong hệ thống, THEN THE system SHALL từ chối yêu cầu tạo permission và trả về lỗi với mã PERMISSION_CODE_DUPLICATE.
FR-021: IF permissionCode không đúng định dạng <module_code>.<action_code> (chứa khoảng trắng, ký tự đặc biệt, hoặc không có dấu chấm), THEN THE system SHALL từ chối yêu cầu và trả về lỗi validation.
FR-022: IF permission cần gán đã được gán cho role trước đó (đã tồn tại trong role_permissions) hoặc bị lặp trong chính request body, THEN THE system SHALL coi là non-fatal case: skip permission đó, không tạo bản ghi trùng, tiếp tục xử lý các permission còn lại, ghi nhận vào response dưới dạng skippedAlreadyAssigned / skippedDuplicatedInRequest.
FR-023: IF role có is_system_role = true AND permission có moduleCode = 'admin', THEN THE system SHALL từ chối yêu cầu gỡ và trả về lỗi với mã CANNOT_REVOKE_SYSTEM_PERMISSION. Đặc biệt không cho phép gỡ permission admin.manage_permissions khỏi system role để tránh lockout.
FR-024: IF permission được yêu cầu gán đang ở trạng thái isActive = false, THEN THE system SHALL từ chối toàn bộ yêu cầu gán (trong cả single và bulk assign), rollback transaction, và trả về lỗi với mã PERMISSION_INACTIVE.
FR-025: IF permission cần gỡ chưa được gán cho role, THEN THE system SHALL từ chối yêu cầu và trả về lỗi với mã PERMISSION_NOT_ASSIGNED.
FR-026: IF role ID không tồn tại trong hệ thống, THEN THE system SHALL từ chối yêu cầu và trả về lỗi với mã ROLE_NOT_FOUND.
FR-027: IF permission ID không tồn tại trong hệ thống, THEN THE system SHALL từ chối yêu cầu và trả về lỗi với mã PERMISSION_NOT_FOUND.
\\\

### 3.6 Workflow Requirements

Không có workflow phức tạp cho tính năng này.

### 3.7 Authorization Requirements

\\\	ext
FR-028: IF user chưa được xác thực (không có JWT hoặc JWT không hợp lệ), THEN THE system SHALL từ chối truy cập tất cả API endpoints của tính năng này.
FR-029: IF user đã xác thực nhưng không có quyền admin.manage_permissions, THEN THE system SHALL từ chối các thao tác ghi (POST, PATCH, DELETE) và trả về lỗi 403.
FR-030: WHEN System Administrator thực hiện bất kỳ thao tác ghi nào, THE system SHALL kiểm tra quyền trước khi xử lý nghiệp vụ.
FR-031: WHERE user chỉ có quyền permission.read, THE system SHALL chỉ cho phép truy cập các API GET, không cho phép các thao tác ghi.
\\\

### 3.8 Data & State Requirements

\\\	ext
FR-032: WHEN một permission được tạo mới thành công, THE system SHALL lưu bản ghi với trạng thái isActive mặc định là true.
FR-033: WHEN trạng thái isActive của permission thay đổi, THE system SHALL cập nhật trường updatedAt tương ứng.
FR-034: WHEN một role_permission được tạo thành công, THE system SHALL ghi nhận grantedBy từ userId của JWT và grantedAt là thời điểm hiện tại.
\\\

### 3.9 Notification / Audit Requirements

\\\	ext
FR-035: WHEN một thao tác tạo, cập nhật, toggle-active permission được thực hiện thành công, THE system SHALL ghi audit log vào bảng audit_logs với các trường: userId (actor), actionType (CREATE_PERMISSION / UPDATE_PERMISSION / TOGGLE_PERMISSION), entityType = 'permission', entityId, oldValueJson / newValueJson nếu phù hợp, requestId, ipAddress, userAgent, severity, metadataJson. Audit log chỉ ghi sau khi transaction nghiệp vụ thành công. Dùng AuditLogsService (administration module) nếu có sẵn; không rải raw insert trong business service.
FR-036: WHEN một thao tác gán hoặc gỡ permission cho role được thực hiện thành công, THE system SHALL ghi audit log vào bảng audit_logs. Với bulk assign, ghi một record tổng hợp: userId (actor), actionType = 'ASSIGN_PERMISSION', entityType = 'role_permission', entityId = roleId, metadataJson chứa assignedPermissionIds, skippedAlreadyAssigned, skippedDuplicatedInRequest. Với revoke, ghi actionType = 'REVOKE_PERMISSION', entityId = permissionId, metadataJson chứa roleId. Audit log chỉ ghi sau khi transaction nghiệp vụ thành công.
\\\

### 3.10 Integration / Device Requirements

Không có yêu cầu tích hợp thiết bị cho tính năng này.

### 3.11 Complex / Combined Requirements

\\\	ext
FR-037: WHILE gán permission hàng loạt cho role, THE system SHALL phân biệt fatal vs non-fatal: (1) Fatal cases — roleId không tồn tại (ROLE_NOT_FOUND, 404), bất kỳ permissionId không tồn tại (PERMISSION_NOT_FOUND, 404), bất kỳ permission inactive (PERMISSION_INACTIVE, 422), lỗi persist DB — rollback toàn bộ transaction. (2) Non-fatal cases — permission đã gán trước đó (skip), permission bị lặp trong request (skip) — không rollback, tiếp tục xử lý các permission còn lại. Response chứa assigned, skippedAlreadyAssigned, skippedDuplicatedInRequest. Nếu tất cả đều skip, trả success no-op (200), không tạo duplicate.
FR-038: WHILE một permission có isActive = true, WHEN System Administrator gửi yêu cầu toggle-active, THE system SHALL chuyển isActive thành false và ghi audit log.
FR-039: WHILE một permission có isActive = false, WHEN System Administrator gửi yêu cầu toggle-active, THE system SHALL chuyển isActive thành true và ghi audit log.
\\\

### 3.12 Requirement Notes

- Các FR từ 012-016 là event-driven mô tả phản ứng hệ thống khi nhận request.
- FR-037 yêu cầu sử dụng transaction khi gán permission hàng loạt để đảm bảo tính nhất quán.
- Định dạng permissionCode chuẩn: regex ^[a-z0-9_]+(\.[a-z0-9_]+)+$. Cho phép chữ thường (a-z), số (0-9), underscore (_) và dấu chấm (.). Không cho phép khoảng trắng, dấu hai chấm (:), ký tự đặc biệt khác. permissionCode phải có ít nhất một dấu chấm.
- moduleCode được validate theo allowlist module chính thức. Allowlist nằm trong constant/config code. Không cần DB change cho feature này.
- moduleCode allowlist đề xuất: auth, accounts, meetings, meeting_requests, approvals, scheduling, rooms, equipment, iot, attendance, presence, utilization, live_meeting, recording, transcription, minutes, notifications, reports, analytics, administration, admin, internal, system.

### 3.13 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | Permission CRUD - Tạo permission | Core requirement |
| FR-002 | Ubiquitous | BR-PERM-01 | Unique constraint |
| FR-003 | Ubiquitous | Permission CRUD - List permission | Pagination + filter + search |
| FR-004 | Ubiquitous | Permission CRUD - Detail | Get by ID |
| FR-005 | Ubiquitous | Permission CRUD - Update | Chỉ sửa tên và mô tả |
| FR-006 | Ubiquitous | BR-PERM-04 | Cấm sửa code sau khi tạo |
| FR-007 | Ubiquitous | Permission CRUD - Toggle active | Kích hoạt/vô hiệu hóa |
| FR-008 | Ubiquitous | Role-Permission Assignment - List | Xem permission của role |
| FR-009 | Ubiquitous | Role-Permission Assignment - Assign | Gán hàng loạt + ghi vết |
| FR-010 | Ubiquitous | Role-Permission Assignment - Revoke | Gỡ permission khỏi role |
| FR-011 | Ubiquitous | BR-PERM-03 | Ghi vết granted_at |
| FR-012 | Event-driven | BR-PERM-01 | Validate unique code |
| FR-013 | Event-driven | BR-PERM-02, BR-PERM-03 | Validate trước khi gán hàng loạt |
| FR-014 | Event-driven | BR-PERM-04 | Bảo vệ system role |
| FR-015 | Event-driven | Permission CRUD - Toggle | Validate tồn tại |
| FR-016 | Event-driven | Permission CRUD - Update | Validate tồn tại |
| FR-017 | State-driven | BR-PERM-02 | Chặn gán permission inactive |
| FR-018 | State-driven | BR-PERM-04 | Bảo vệ system role |
| FR-019 | State-driven | Data integrity | Duy trì toàn vẹn dữ liệu |
| FR-020 | Unwanted Behavior | BR-PERM-01 | Permission code trùng |
| FR-021 | Unwanted Behavior | BR-PERM-01 | Format không hợp lệ |
| FR-022 | Unwanted Behavior | Role-Permission - Assign | Permission đã gán trước đó |
| FR-023 | Unwanted Behavior | BR-PERM-04 | Không gỡ được quyền admin khỏi system role |
| FR-024 | Unwanted Behavior | BR-PERM-02 | Permission inactive |
| FR-025 | Unwanted Behavior | Role-Permission - Revoke | Permission chưa được gán |
| FR-026 | Unwanted Behavior | Role lookup | Role không tồn tại |
| FR-027 | Unwanted Behavior | Permission lookup | Permission không tồn tại |
| FR-028 | Authorization | NFR-Security | Yêu cầu xác thực |
| FR-029 | Authorization | NFR-Security | Yêu cầu quyền admin |
| FR-030 | Authorization | NFR-Security | Kiểm tra quyền trước xử lý |
| FR-031 | Authorization | NFR-Security | Phân quyền đọc/ghi |
| FR-032 | Data & State | Data lifecycle | Mặc định isActive = true |
| FR-033 | Data & State | Data lifecycle | Cập nhật updatedAt |
| FR-034 | Data & State | BR-PERM-03 | Ghi vết granted_by và granted_at |
| FR-035 | Notification / Audit | Audit trail | Audit log cho thao tác permission |
| FR-036 | Notification / Audit | Audit trail | Audit log cho thao tác gán permission |
| FR-037 | Complex | Transaction | Rollback nếu gán hàng loạt thất bại |
| FR-038 | Complex | Toggle active | Active -> Inactive |
| FR-039 | Complex | Toggle active | Inactive -> Active |

---
## 4. Non-functional Requirements

### 4.1 Performance

\\\	ext
NFR-001: THE system SHALL phản hồi các thao tác CRUD permission và gán permission trong vòng dưới 2 giây ở điều kiện tải bình thường.
NFR-002: THE system SHALL hỗ trợ phân trang cho API danh sách permission với page mặc định là 1, limit mặc định là 20, limit tối đa là 100.
NFR-003: WHEN số lượng permission trong request gán hàng loạt vượt quá 50, THE system SHALL vẫn xử lý trong cùng một giao dịch transaction và hoàn thành trong vòng 5 giây.
\\\

### 4.2 Security

\\\	ext
NFR-004: THE system SHALL yêu cầu JWT hợp lệ trước khi cho phép truy cập bất kỳ API endpoint nào của tính năng này.
NFR-005: THE system SHALL kiểm tra quyền admin.manage_permissions hoặc permission cụ thể cho mọi thao tác ghi.
NFR-006: THE system SHALL KHÔNG trả về thông tin nhạy cảm hơn mức cần thiết.
NFR-007: IF request gửi lên chứa JWT không hợp lệ hoặc đã hết hạn, THEN THE system SHALL từ chối request.
\\\

### 4.3 Reliability & Consistency

\\\	ext
NFR-008: THE system SHALL sử dụng database transaction khi thực hiện gán hàng loạt nhiều permission cho role để tránh cập nhật một phần.
NFR-009: THE system SHALL duy trì tính nhất quán giữa bảng permissions và role_permissions.
NFR-010: IF thao tác persist (lưu dữ liệu) thất bại trong quá trình gán permission, THEN THE system SHALL rollback toàn bộ transaction và trả về lỗi phù hợp.
\\\

### 4.4 Usability

\\\	ext
NFR-011: THE system SHALL trả về thông báo lỗi bằng tiếng Việt rõ ràng, có mã lỗi nội bộ để client dễ dàng xử lý và hiển thị.
NFR-012: THE system SHALL sử dụng response format thống nhất theo chuẩn: { success, message, data, meta }.
\\\

### 4.5 Observability

\\\	ext
NFR-013: THE system SHALL ghi log các lỗi xử lý quan trọng của tính năng này.
NFR-014: THE system SHALL ghi audit log vào bảng audit_logs (dùng AuditLogsService administration module nếu có sẵn) cho mọi thao tác tạo, cập nhật, toggle-active permission và gán/gỡ permission cho role.
NFR-015: WHEN có lỗi xảy ra trong quá trình xử lý, THE system SHALL ghi đủ thông tin chẩn đoán (request ID, action, lý do lỗi) để hỗ trợ troubleshooting.
\\\

### 4.6 Maintainability

\\\	ext
NFR-016: THE system SHALL giữ logic nghiệp vụ của permission và role-permission assignment trong module accounts, không trộn lẫn với module khác.
NFR-017: THE system SHALL cung cấp unit test cho các luồng success, validation failure, authorization failure, và business rule failure của tính năng này.
\\\

---
## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| permissions | Lưu định nghĩa các quyền chi tiết với mã quyền, tên, module, action, trạng thái active | Entity: PermissionEntity |
| role_permissions | Lưu quan hệ N-N giữa role và permission, kèm thông tin người gán và thời gian gán | Entity: RolePermissionEntity |
| roles | Vai trò người dùng, dùng để xác định role được gán permission và kiểm tra is_system_role | Entity: RoleEntity |
| users | Tham chiếu tới userId qua granted_by trong role_permissions để ghi vết | Entity: UserEntity |

### 5.2 Dữ liệu đầu vào

#### CreatePermissionDto

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| permissionCode | string | Có | Mã quyền duy nhất, định dạng <module_code>.<action_code>, có thể nhiều segment | Tối đa 120 ký tự, regex: ^[a-z0-9_]+(\.[a-z0-9_]+)+$, chữ thường, số, underscore, dấu chấm |
| permissionName | string | Có | Tên hiển thị của quyền | Tối đa 150 ký tự |
| moduleCode | string | Có | Mã module (vd: meetings, rooms, admin, attendance) | Tối đa 80 ký tự, chữ thường không dấu. Validate theo allowlist module chính thức |
| actionCode | string | Có | Mã hành động (vd: create, read, update, delete) | Tối đa 80 ký tự, chữ thường không dấu |
| description | string | Không | Mô tả chi tiết về quyền | Text, nullable |

#### UpdatePermissionDto

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| permissionName | string | Không | Tên hiển thị mới | Tối đa 150 ký tự |
| description | string | Không | Mô tả mới | Text, nullable |

#### AssignPermissionsDto

| Field | Type dự kiến | Bắt buộc | Mô tả | Validation |
|---|---|---|---|---|
| permissionIds | string[] | Có | Mảng các UUID của permission cần gán cho role | Tối thiểu 1 phần tử, mỗi phần tử là UUID hợp lệ |

### 5.3 Dữ liệu đầu ra

#### PermissionResponseDto

| Field | Type dự kiến | Mô tả |
|---|---|---|
| id | string (UUID) | ID của permission |
| permissionCode | string | Mã quyền |
| permissionName | string | Tên quyền |
| moduleCode | string | Mã module |
| actionCode | string | Mã hành động |
| description | string | Mô tả (nullable) |
| isActive | boolean | Trạng thái hoạt động |
| createdAt | string (ISO 8601) | Thời gian tạo |
| updatedAt | string (ISO 8601) | Thời gian cập nhật gần nhất |

#### RolePermissionResponseDto

| Field | Type dự kiến | Mô tả |
|---|---|---|
| id | string (UUID) | ID của bản ghi role_permission |
| roleId | string (UUID) | ID của role |
| permissionId | string (UUID) | ID của permission |
| grantedBy | string (UUID) | UUID của người gán (nullable) |
| grantedAt | string (ISO 8601) | Thời gian gán |
| permission | PermissionResponseDto | Thông tin chi tiết của permission |

### 5.4 State / Status Model

Permission có trạng thái nhị phân:

| Status | Ý nghĩa | Có thể chuyển sang | Điều kiện chuyển |
|---|---|---|---|
| isActive = true | Permission đang hoạt động, có thể được gán cho role | isActive = false | Admin gửi toggle-active request |
| isActive = false | Permission bị vô hiệu hóa, không được gán mới cho role | isActive = true | Admin gửi toggle-active request |

### 5.5 Data Constraints

- permissions.permissionCode là UNIQUE.
- permissions.id được tham chiếu bởi role_permissions.permissionId (FK).
- role_permissions không cho phép gán trùng (check trong business logic).
- role_permissions.grantedBy tham chiếu tới users.id (FK nullable, ON DELETE SET NULL).
- role_permissions.roleId tham chiếu tới roles.id (FK, ON DELETE CASCADE).
- role_permissions.permissionId tham chiếu tới permissions.id (FK, ON DELETE CASCADE).

### 5.6 Data Lifecycle

- **Permission được tạo**: Khi Admin gửi POST /api/v1/permissions với dữ liệu hợp lệ.
- **Permission được cập nhật**: Khi Admin gửi PATCH /api/v1/permissions/:id (chỉ sửa permissionName, description).
- **Permission bị vô hiệu hóa/kích hoạt lại**: Khi Admin gửi POST /api/v1/permissions/:id/toggle-active.
- **Role-permission được tạo**: Khi Admin gửi POST /api/v1/roles/:roleId/permissions.
- **Role-permission bị xóa**: Khi Admin gửi DELETE /api/v1/roles/:roleId/permissions/:permissionId.

### 5.7 Data-related EARS Requirements

\\\	ext
FR-DATA-001: WHEN một permission được tạo, THE system SHALL persist đầy đủ các trường bắt buộc.
FR-DATA-002: WHEN một permission được cập nhật, THE system SHALL chỉ cho phép thay đổi permissionName và description.
FR-DATA-003: IF roleId trong request không tồn tại trong bảng roles, THEN THE system SHALL từ chối request.
FR-DATA-004: IF permissionCode bị trùng lặp, THEN THE system SHALL từ chối request.
\\\

### 5.8 Cần làm rõ

Không có. Tất cả entity đã tồn tại trong Database v3.2 Compact.

---
## 6. Error Handling

### 6.1 Validation Errors

\\\	ext
ERR-001: IF permissionCode bị thiếu trong request tạo permission, THEN THE system SHALL từ chối request và trả về lỗi validation.
ERR-002: IF permissionCode không đúng regex ^[a-z0-9_]+(\.[a-z0-9_]+)+$ (thiếu dấu chấm, chứa khoảng trắng, chứa ký tự đặc biệt như dấu hai chấm), THEN THE system SHALL từ chối request và trả về lỗi validation với mã INVALID_PERMISSION_CODE_FORMAT.
ERR-003: IF permissionName vượt quá 150 ký tự, THEN THE system SHALL từ chối request và trả về lỗi validation.
ERR-004: IF moduleCode vượt quá 80 ký tự, THEN THE system SHALL từ chối request và trả về lỗi validation.
ERR-005: IF actionCode vượt quá 80 ký tự, THEN THE system SHALL từ chối request và trả về lỗi validation.
ERR-006: IF permissionIds là mảng rỗng trong request gán permission, THEN THE system SHALL từ chối request và trả về lỗi validation.
ERR-007: IF permissionIds chứa UUID không hợp lệ, THEN THE system SHALL từ chối request và trả về lỗi validation.
ERR-008: IF page hoặc limit là số âm hoặc không phải số nguyên dương, THEN THE system SHALL từ chối request và trả về lỗi validation.
ERR-009: IF limit vượt quá 100, THEN THE system SHALL từ chối request và trả về lỗi validation.
\\\

### 6.2 Authentication / Authorization Errors

\\\	ext
ERR-010: IF user không gửi JWT token hoặc token không hợp lệ, THEN THE system SHALL trả về lỗi 401 Unauthorized.
ERR-011: IF user không có quyền admin.manage_permissions, THEN THE system SHALL trả về lỗi 403 Forbidden.
ERR-012: IF JWT token đã hết hạn, THEN THE system SHALL trả về lỗi 401 với mã TOKEN_EXPIRED.
\\\

### 6.3 Business Rule Errors

\\\	ext
ERR-013: IF permissionCode đã tồn tại, THEN THE system SHALL trả về lỗi 409 Conflict với mã PERMISSION_CODE_DUPLICATE.
ERR-014: IF permission cần gán đang ở trạng thái isActive = false, THEN THE system SHALL trả về lỗi 422 Unprocessable Entity với mã PERMISSION_INACTIVE.
ERR-015: IF role có is_system_role = true AND permission có moduleCode = 'admin', THEN THE system SHALL trả về lỗi 422 với mã CANNOT_REVOKE_SYSTEM_PERMISSION. Các permission thuộc module khác không bị chặn bởi rule này.
ERR-016: IF permission chưa được gán cho role trước khi yêu cầu gỡ, THEN THE system SHALL trả về lỗi 404 với mã PERMISSION_NOT_ASSIGNED.
ERR-017: IF yêu cầu gán permission bị trùng lặp (đã tồn tại trong role_permissions hoặc bị lặp trong request body), THEN THE system SHALL coi là non-fatal case: bỏ qua permission trùng, ghi nhận vào response (skippedAlreadyAssigned / skippedDuplicatedInRequest), tiếp tục xử lý các permission còn lại. KHÔNG rollback.
\\\

### 6.4 Conflict Errors

\\\	ext
ERR-018: IF có xung đột dữ liệu do thay đổi đồng thời, THEN THE system SHALL áp dụng cơ chế phù hợp và trả về lỗi yêu cầu thử lại.
ERR-019: IF moduleCode không nằm trong allowlist module chính thức, THEN THE system SHALL từ chối request và trả về lỗi validation với mã INVALID_MODULE_CODE.
\\\

### 6.6 Error Response Expectations

| Field | Mô tả |
|---|---|
| success | false |
| message | Thông báo lỗi bằng tiếng Việt |
| error.code | Mã lỗi nội bộ (vd: PERMISSION_CODE_DUPLICATE) |
| error.details | Chi tiết lỗi validation/business nếu cần |
| timestamp | Thời điểm xảy ra lỗi (ISO 8601) |
| path | API path |

---
## 7. Acceptance Criteria

### 7.1 Happy Path

\\\	ext
AC-001: Tạo permission thành công
Given Admin gửi request POST /api/v1/permissions với dữ liệu hợp lệ
When hệ thống kiểm tra permissionCode không trùng và dữ liệu hợp lệ
Then hệ thống tạo bản ghi permission mới với isActive = true, trả về 201 Created kèm dữ liệu permission.

AC-002: Xem danh sách permission
Given Admin gửi request GET /api/v1/permissions với query hợp lệ
When hệ thống nhận request
Then hệ thống trả về danh sách permission có phân trang, filter, search theo yêu cầu.

AC-003: Xem chi tiết permission
Given Admin gửi request GET /api/v1/permissions/:id với ID hợp lệ
When hệ thống nhận request
Then hệ thống trả về 200 kèm dữ liệu chi tiết permission.

AC-004: Cập nhật permission thành công
Given Admin gửi request PATCH /api/v1/permissions/:id với permissionName hoặc description mới
When hệ thống kiểm tra permission tồn tại
Then hệ thống cập nhật thành công, trả về 200 kèm dữ liệu permission đã cập nhật.

AC-005: Toggle-active permission
Given Admin gửi request POST /api/v1/permissions/:id/toggle-active
When hệ thống kiểm tra permission tồn tại
Then hệ thống đảo ngược trạng thái isActive, trả về 200 kèm trạng thái mới.

AC-006: Gán permission cho role thành công (mixed fatal/non-fatal)
Given Admin gửi request POST /api/v1/roles/:roleId/permissions với mảng permissionIds
When fatal cases (roleId/permissionId không tồn tại, permission inactive, lỗi DB): rollback toàn bộ, trả lỗi tương ứng
When non-fatal cases (permission đã gán trước đó, bị lặp trong request): skip, không rollback
Then hệ thống tạo bản ghi role_permissions cho các permission mới, trả về 201 kèm assigned, skippedAlreadyAssigned, skippedDuplicatedInRequest
Then nếu tất cả đều skip, trả về 200 success no-op

AC-007: Gỡ permission khỏi role thành công
Given Admin gửi request DELETE /api/v1/roles/:roleId/permissions/:permissionId
When role không phải system_role hoặc permission không thuộc module admin
Then hệ thống xóa bản ghi role_permissions, trả về 200.

AC-008: Xem danh sách permission của role
Given Admin gửi request GET /api/v1/roles/:roleId/permissions
When hệ thống nhận request
Then hệ thống trả về danh sách permission đã gán cho role đó.
\\\

### 7.2 Validation Cases

\\\	ext
AC-009: Tạo permission thiếu trường bắt buộc
Given Admin gửi request POST /api/v1/permissions thiếu permissionCode
When hệ thống nhận request
Then hệ thống từ chối với 400 Bad Request và lỗi validation chi tiết.

AC-010: Tạo permission với permissionCode sai format
Given Admin gửi request POST /api/v1/permissions với permissionCode chứa khoảng trắng
When hệ thống nhận request
Then hệ thống từ chối với 400 Bad Request và mã lỗi INVALID_PERMISSION_CODE_FORMAT.

AC-011: Gán permission với mảng rỗng
Given Admin gửi request POST /api/v1/roles/:roleId/permissions với permissionIds là []
When hệ thống nhận request
Then hệ thống từ chối với 400 Bad Request.

AC-012: Limit vượt quá 100
Given Admin gửi request GET /api/v1/permissions?limit=200
When hệ thống nhận request
Then hệ thống từ chối với 400 Bad Request.
\\\

### 7.3 Authorization Cases

\\\	ext
AC-013: Không gửi JWT token
Given user không gửi JWT token trong request
When user gửi request tới bất kỳ API endpoint nào
Then hệ thống từ chối với 401 Unauthorized.

AC-014: JWT hết hạn
Given user gửi request với JWT đã hết hạn
When hệ thống nhận request
Then hệ thống từ chối với 401 và mã lỗi TOKEN_EXPIRED.

AC-015: User không có quyền admin
Given user có JWT hợp lệ nhưng không có quyền admin.manage_permissions
When user gửi request POST /api/v1/permissions
Then hệ thống từ chối với 403 Forbidden.
\\\

### 7.4 Business Rule Cases

\\\	ext
AC-016: Tạo permission với permissionCode trùng
Given đã tồn tại permission với code meetings.create
When Admin gửi request tạo permission mới với code meetings.create
Then hệ thống từ chối với 409 Conflict và mã lỗi PERMISSION_CODE_DUPLICATE.

AC-017: Gán permission inactive cho role (fatal rollback)
Given permission có isActive = false
When Admin gửi request gán permission này cho role (cả single và bulk)
Then hệ thống từ chối toàn bộ yêu cầu với 422 và mã lỗi PERMISSION_INACTIVE, rollback không tạo bất kỳ bản ghi mới nào.

AC-018: Gỡ permission module admin khỏi system role bị cấm
Given role có is_system_role = true và đã được gán permission có moduleCode = 'admin'
When Admin gửi request gỡ permission này
Then hệ thống từ chối với 422 và mã lỗi CANNOT_REVOKE_SYSTEM_PERMISSION.

AC-019: Gỡ permission nghiệp vụ khỏi system role được phép
Given role có is_system_role = true và đã được gán permission có moduleCode = 'meetings'
When Admin gửi request gỡ permission này
Then hệ thống cho phép gỡ và trả về 200 thành công.

AC-020: Cập nhật permissionCode sau khi tạo
Given permission đã tồn tại
When Admin gửi request PATCH với permissionCode mới
Then hệ thống từ chối yêu cầu thay đổi permissionCode.

AC-021: Gán permission đã được gán trước đó cho cùng role (non-fatal skip)
Given role đã có permission A
When Admin gửi request gán permission A cho role đó lần nữa
Then hệ thống bỏ qua bản ghi trùng (skip non-fatal), ghi nhận vào skippedAlreadyAssigned, trả về assigned + skippedAlreadyAssigned trong response.
\\\

### 7.5 State Transition Cases

\\\	ext
AC-022: Toggle từ active sang inactive
Given permission có isActive = true
When Admin gửi POST /api/v1/permissions/:id/toggle-active
Then hệ thống chuyển isActive thành false và cập nhật updatedAt.

AC-023: Toggle từ inactive sang active
Given permission có isActive = false
When Admin gửi POST /api/v1/permissions/:id/toggle-active
Then hệ thống chuyển isActive thành true và cập nhật updatedAt.
\\\

### 7.6 Audit / Notification Cases

\\\	ext
AC-024: Audit log khi tạo permission
Given Admin tạo permission mới thành công
When hệ thống hoàn tất thao tác
Then hệ thống ghi audit log vào bảng audit_logs: userId, actionType = 'CREATE_PERMISSION', entityType = 'permission', entityId, newValueJson, requestId, ipAddress.

AC-025: Audit log khi gán permission cho role (bulk)
Given Admin gán permission cho role thành công (có assigned và skipped)
When hệ thống hoàn tất thao tác
Then hệ thống ghi audit log vào bảng audit_logs: actionType = 'ASSIGN_PERMISSION', entityType = 'role_permission', entityId = roleId, metadataJson chứa assignedPermissionIds, skippedAlreadyAssigned, skippedDuplicatedInRequest.
\\\

### 7.8 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan | Kịch bản test chính |
|---|---|---|
| AC-001 | FR-001, FR-012, FR-032 | Tạo permission thành công |
| AC-002 | FR-003 | List permission phân trang |
| AC-003 | FR-004 | Xem chi tiết permission |
| AC-004 | FR-005, FR-016 | Cập nhật permission |
| AC-005 | FR-007, FR-015, FR-038, FR-039 | Toggle-active permission |
| AC-006 | FR-009, FR-011, FR-013, FR-034, FR-037 | Gán permission hàng loạt |
| AC-007 | FR-010, FR-014, FR-023 | Gỡ permission khỏi role |
| AC-008 | FR-008 | List permission của role |
| AC-009 | ERR-001 | Thiếu trường bắt buộc |
| AC-010 | FR-021, ERR-002 | Permission code sai format |
| AC-011 | ERR-006 | Mảng permissionIds rỗng |
| AC-012 | ERR-009 | Limit vượt quá 100 |
| AC-013 | FR-028, ERR-010 | Không gửi token |
| AC-014 | NFR-007, ERR-012 | Token hết hạn |
| AC-015 | FR-029, FR-030, ERR-011 | Không có quyền admin.manage_permissions |
| AC-016 | FR-002, FR-020, ERR-013 | Permission code trùng |
| AC-017 | FR-017, FR-024, ERR-014 | Gán permission inactive |
| AC-018 | FR-018, FR-023, ERR-015 | Gỡ quyền admin khỏi system role bị cấm |
| AC-019 | FR-018 | Gỡ permission nghiệp vụ khỏi system role được phép |
| AC-020 | FR-006 | Cập nhật permissionCode bị cấm |
| AC-021 | FR-022 | Gán permission trùng (non-fatal skip) |
| AC-022 | FR-038 | Active -> Inactive |
| AC-023 | FR-039 | Inactive -> Active |
| AC-024 | FR-035 | Audit log tạo permission |
| AC-025 | FR-036 | Audit log gán permission (bulk) |

---
## 8. Out of Scope

Các nội dung sau **không thuộc phạm vi** của feature này:

- Không tạo UI / giao diện người dùng cho tính năng quản lý permission.
- Không tạo bảng database mới.
- Không tạo role CRUD API (chỉ gán/gỡ permission cho role đã tồn tại).
- Không tự động seed permission mặc định khi hệ thống khởi tạo.
- Không tích hợp kiểm tra permission vào các module khác.
- Bootstrap seed RBAC là precondition, không phải feature requirement.
- Không xóa cứng (hard delete) permission — chỉ hỗ trợ toggle-active.
- Không hỗ trợ import/export permission từ file.
- Không hỗ trợ bulk update permission.
- Không gửi notification khi có thay đổi permission.

### 8.1 Không triển khai trong feature này

- Không implement UI/UX cho quản lý permission.
- Không thêm bảng mới vào database.
- Không implement Role CRUD.
- Không implement PermissionGuard cho module khác — chỉ quản lý danh mục quyền và gán quyền.
- Không implement bootstrap seed RBAC — seed là task riêng.

### 8.2 Có thể xem xét ở feature khác

- Bootstrap seed RBAC (tạo role admin, permission admin.manage_permissions, user admin, gán quyền) — task riêng, precondition của feature này.
- Tích hợp PermissionGuard vào các module khác để kiểm tra permission trong request.
- Dashboard quản lý permission và role kèm UI.
- Bulk import/export permission từ CSV/JSON.
- Audit report và thống kê thay đổi permission.

### 8.3 Out-of-scope EARS Guardrails

\\\	ext
OOS-001: THE system SHALL NOT tạo UI/giao diện người dùng cho tính năng này.
OOS-002: THE system SHALL NOT tạo bảng database mới trong feature này.
OOS-003: THE system SHALL NOT tự động kiểm tra permission trong Auth Guards của module khác.
OOS-004: THE system SHALL NOT seed permission mặc định khi hệ thống khởi tạo. Bootstrap RBAC seed là task riêng, precondition của feature này.
OOS-005: THE system SHALL NOT hỗ trợ xóa cứng permission.
OOS-006: THE system SHALL NOT gửi notification khi có thay đổi permission.
\\\

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
- [x] Không tự ý thêm feature ngoài tài liệu nguồn.
- [x] Không tự ý thêm database table/field mới.
- [x] Error handling đã bao gồm các trường hợp cần thiết.
- [x] Error requirements đã ưu tiên format IF ... THEN THE system SHALL.
- [x] Acceptance Criteria dùng Given / When / Then.
- [x] Traceability đã liên kết AC với FR/ERR/NFR liên quan.
- [x] Out of Scope đủ rõ để tránh agent tự mở rộng.
- [x] Các phần thiếu thông tin đã được đưa vào Cần làm rõ.
