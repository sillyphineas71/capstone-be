# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-04 | Khởi tạo tài liệu nghiên cứu kỹ thuật (research.md) cho tính năng Tạo tài khoản thủ công | Toàn bộ tài liệu |

# Technical Research & Codebase Analysis

## 1. Codebase Analysis (Phân tích Codebase hiện tại)

### 1.1 Accounts Module & Entities
Hiện tại, module `accounts` (`src/modules/accounts`) chỉ chứa các entity định nghĩa schema database:
- `UserEntity` (`users`): Chứa các trường thông tin tài khoản nhân viên.
  - `id` (UUID, primary key)
  - `employeeCode` (nullable, unique if provided)
  - `username` (unique, lowercase email)
  - `email` (unique, lowercase)
  - `passwordHash` (stored in `password_hash` column, hidden in JSON select by default)
  - `fullName` (`full_name`)
  - `phoneNumber` (`phone_number`, nullable)
  - `departmentId` (`department_id`, nullable FK)
  - `directManagerId` (`direct_manager_id`, nullable FK)
  - `positionTitle` (`position_title`, nullable)
  - `employmentStatus` (`employment_status`, enum: `active`, `probation`, `resigned`, `transferred`)
  - `accountStatus` (`account_status`, enum: `active`, `inactive`, `locked`, `pending_reset`)
  - `mustChangePassword` (`must_change_password`, default: `false`)
- `DepartmentEntity` (`departments`): Quản lý thông tin phòng ban.
  - `id` (UUID)
  - `isActive` (`is_active`, boolean)
  - `deletedAt` (`deleted_at`, nullable)
- `RoleEntity` (`roles`): Các vai trò trong hệ thống.
  - `id` (UUID)
  - `isActive` (`is_active`, boolean)
- `UserRoleEntity` (`user_roles`): Bảng trung gian gán role cho user.
  - `id` (UUID)
  - `userId` (`user_id`, UUID FK)
  - `roleId` (`role_id`, UUID FK)
  - `assignedBy` (`assigned_by`, UUID FK to creator)
  - `assignedAt` (`assigned_at`, default `now()`)
  - `isActive` (`is_active`, default `true`)

Chưa tồn tại:
- `UsersController`
- `UsersService`
- `CreateUserDto`
- `UserResponseDto`

### 1.2 Audit Log Mechanism
Trong hệ thống, các module ghi nhận log hoạt động thông qua `AuditLogEntity` (`audit_logs`) thuộc module `administration`. 
Nghiên cứu cách ghi audit log trong `AuthModule` (`src/modules/auth/repositories/change-password-audit.repository.ts`):
- Sử dụng raw SQL query trực tiếp qua `this.dataSource.query` để thực hiện ghi nhận log nhằm tối ưu hiệu năng và tách biệt logic.
- Dữ liệu ghi log gồm: `user_id`, `action_type`, `entity_type`, `entity_id`, `ip_address`, `user_agent`, `request_id`, `severity` (info/warn/error), và `metadata_json` (jsonb).
- Tuyệt đối không ghi nhận các thông tin nhạy cảm như raw password hay password hash.
- Đối với `manual-employee-account`, ta sẽ ghi audit log với `action_type = 'ACCOUNT_CREATE'`, `entity_type = 'users'`, `entity_id = <new_user_id>`. Việc ghi log này sẽ được đưa vào transaction chính. Tuy nhiên, nếu việc ghi audit log thất bại do vấn đề bên ngoài, ta sẽ bắt lỗi (catch) và ghi log lỗi vào application log, giữ nguyên kết quả tạo tài khoản (non-blocking audit log) để không làm gián đoạn luồng nghiệp vụ chính của người dùng.

### 1.3 Background Jobs Mechanism
Hệ thống quản lý hàng đợi và tác vụ nền qua bảng `background_jobs` (`BackgroundJobEntity`) thuộc module `administration`. 
- `job_type` hỗ trợ enum `BackgroundJobType.SEND_EMAIL = 'send_email'`.
- `input_json` chứa payload gửi email:
  ```json
  {
    "to": "employee@company.com",
    "subject": "Thông tin tài khoản Smart Meeting mới của bạn",
    "template": "welcome-credential",
    "context": {
      "fullName": "Nguyen Van A",
      "username": "nva@company.com",
      "temporaryPassword": "safeTemporaryPassword123!",
      "mustChangePassword": true
    }
  }
  ```
- Việc đẩy job gửi email vào DB bắt buộc phải nằm trong cùng transaction với việc tạo user. Nếu tạo job thất bại (DB error), toàn bộ transaction sẽ rollback để tránh tình trạng tài khoản được tạo nhưng thông tin đăng nhập không bao giờ được gửi tới nhân viên.

---

## 2. Technology & Architectural Decisions

### 2.1 Temporary Password Generator (Bộ sinh mật khẩu tạm thời)
- **Quyết định**: Sử dụng module `crypto` có sẵn của Node.js để sinh chuỗi ký tự ngẫu nhiên an toàn (cryptographically secure pseudorandom number generator - CSPRNG).
- **Yêu cầu password policy**:
  - Độ dài tối thiểu: 12 ký tự.
  - Phải chứa ít nhất: 1 chữ hoa, 1 chữ thường, 1 chữ số, và 1 ký tự đặc biệt (ví dụ: `@#$%^&*!`).
- **Giải pháp**: Sinh các ký tự ngẫu nhiên từ 4 nhóm ký tự (hoa, thường, số, đặc biệt) để đảm bảo tối thiểu mỗi nhóm có 1 ký tự, sau đó lấp đầy các vị trí còn lại bằng ký tự ngẫu nhiên tổng hợp, và xáo trộn ngẫu nhiên chuỗi kết quả bằng Fisher-Yates shuffle.

### 2.2 Permissions Checking
- **Quyết định**: Xây dựng một decorator `@RequirePermissions(...permissions: string[])` và một guard `PermissionsGuard` dùng chung trong hệ thống để kiểm tra quyền hạn của Manager/Admin.
- **Logic hoạt động**:
  - `JwtAuthGuard` sẽ xác thực JWT và gán user payload vào `request.user`.
  - `PermissionsGuard` sẽ chạy ngay sau `JwtAuthGuard`. Nó lấy danh sách permissions được yêu cầu từ reflector.
  - Sử dụng `AuthzReadRepository` (đã được export từ `AuthModule`) để lấy các permission thực tế đang hoạt động của `request.user.userId`.
  - Nếu user có permission `account.user.create`, guard trả về `true`. Ngược lại, ném lỗi `ForbiddenException` (HTTP 403) với định dạng error response chuẩn.

### 2.3 Transaction Boundary (Ranh giới Transaction)
- **Quyết định**: Sử dụng `this.dataSource.transaction(async (entityManager) => { ... })` để quản lý giao dịch.
- **Phạm vi Transaction**:
  1. Tạo bản ghi `UserEntity` trong bảng `users`.
  2. Tạo các bản ghi `UserRoleEntity` tương ứng trong bảng `user_roles`.
  3. Tạo bản ghi `BackgroundJobEntity` trong bảng `background_jobs`.
  4. Tạo bản ghi `AuditLogEntity` trong bảng `audit_logs`.
- **Xử lý lỗi**:
  - Nếu bất kỳ bước 1, 2, 3 nào thất bại, hệ thống sẽ tự động throw error để rollback transaction.
  - Đối với bước 4 (Audit Log), để đáp ứng yêu cầu `FR-ACCT-038` (non-blocking audit log), ta có thể bắt lỗi cục bộ quanh câu lệnh ghi log hoặc thực hiện ghi log sau transaction dưới dạng fire-and-forget. Tuy nhiên, đặc tả spec yêu cầu ghi audit log cùng transaction. Để vừa đảm bảo cùng transaction vừa non-blocking: ta sẽ wrap câu lệnh ghi audit log bằng block `try-catch` bên trong transaction. Nếu ghi audit log lỗi, ta catch lỗi đó, log bằng `Logger` của NestJS, và cho phép transaction tiếp tục commit bình thường.
  ```typescript
  await this.dataSource.transaction(async (em) => {
    // 1. Create User
    // 2. Assign Roles
    // 3. Queue Email Job
    // 4. Record Audit Log inside try-catch
    try {
      await em.save(auditLogRecord);
    } catch (auditError) {
      this.logger.error('Failed to write audit log in transaction', auditError);
      // Do not rethrow to keep user creation intact
    }
  });
  ```

---

## 3. Risks & Mitigations (Rủi ro và Giải pháp giảm thiểu)

| Rủi ro | Mức độ | Giải pháp giảm thiểu |
|---|---|---|
| **Race Condition trùng Email**: Hai Admin tạo cùng lúc tài khoản với 1 email, hệ thống SELECT kiểm tra đều báo chưa tồn tại trước khi insert. | Trung bình | Tận dụng DB-level UNIQUE constraint trên cột `users.email` và `users.username`. TypeORM sẽ ném ra lỗi `QueryFailedError` khi vi phạm constraint. Bắt lỗi này và chuyển thành lỗi `ConflictException` (HTTP 409) với error code `ACCOUNT_EMAIL_ALREADY_EXISTS` hoặc `ACCOUNT_USERNAME_ALREADY_EXISTS`. |
| **Gửi Email thất bại**: Mail server gặp sự cố khiến email không gửi được, nhân viên không nhận được mật khẩu tạm. | Cao | Sử dụng cơ chế async-only email queue thông qua bảng `background_jobs`. Transaction tạo tài khoản chỉ cần chèn bản ghi job vào DB thành công (đảm bảo tính toàn vẹn dữ liệu). Việc gửi email thực tế sẽ do Background Worker xử lý riêng biệt với cơ chế retry tự động. |
| **Độ mạnh mật khẩu tạm thời**: Mật khẩu được sinh ra không đủ độ mạnh hoặc dễ đoán. | Thấp | Sử dụng thuật toán sinh chuỗi ký tự ngẫu nhiên CSPRNG kết hợp với regex kiểm tra nghiêm ngặt trước khi trả về. |
