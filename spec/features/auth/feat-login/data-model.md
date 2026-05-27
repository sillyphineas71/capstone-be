## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-05-27 | Loại bỏ bảng `user_sessions` và di chuyển sang cơ chế stateless JWT. | Phần Entities và Relationships |

# Data Model: AUTH-001 Login

## Entities

### users
- Purpose: Nguồn dữ liệu tài khoản đăng nhập.
- Fields used:
  - `id`
  - `email`
  - `password_hash`
  - `full_name`
  - `avatar_url`
  - `department_id`
  - `account_status`
  - `last_login_at`
- Validation/usage:
  - lookup bằng email đã trim + lowercase
  - `account_status` dùng để map `active`, `inactive`, `locked`, `other_status`
  - `last_login_at` update sau login success, non-blocking

### roles
- Purpose: Role metadata trả về response.
- Fields used:
  - `id`
  - `role_code`
  - `role_name`
  - `is_active`

### user_roles
- Purpose: Link user-role hiệu lực.
- Fields used:
  - `user_id`
  - `role_id`
  - `is_active`
  - `expired_at`

### permissions
- Purpose: Permission metadata trả về response.
- Fields used:
  - `id`
  - `permission_code`
  - `permission_name`
  - `is_active`

### role_permissions
- Purpose: Link role-permission hiệu lực.
- Fields used:
  - `role_id`
  - `permission_id`

### audit_logs
- Purpose: Ghi audit cho login success.
- Fields used:
  - `user_id`
  - `action_type`
  - `entity_type`
  - `entity_id`
  - `ip_address`
  - `user_agent`
  - `request_id`
  - `created_at`
  - `severity`
  - `metadata_json`
- Behavior:
  - failure không fail login

### system_configs
- Purpose: Nguồn config cho session TTL/auth settings trong scope feature.
- Fields used:
  - `config_key`
  - `config_value`
  - `is_active` nếu có ở implementation mapping

## Relationships
- `users` 1-n `user_roles`
- `user_roles` n-1 `roles`
- `roles` n-n `permissions` qua `role_permissions`
- `users` 1-n `audit_logs`

## Input Model
- `email: string`
  - required
  - valid email format
  - trim + lowercase
- `password: string`
  - required
  - no trim

## Output Model
- `accessToken: string`
- `refreshToken: string`
- `expiresIn: number`
- `user: { id, email, fullName, avatarUrl, departmentId, roles[], permissions[] }`

## State Mapping
- `active` -> proceed login
- `inactive` -> `403 AUTH_ACCOUNT_INACTIVE`
- `locked` -> `423 AUTH_ACCOUNT_LOCKED`
- other -> `403 AUTH_ACCOUNT_STATUS_NOT_ALLOWED`
