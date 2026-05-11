# Data Model: UC-AM-01 Create New Account

## 1. User (`users`)

### Purpose
Lưu account nội bộ mới được tạo và trạng thái sẵn sàng sử dụng của account.

### Fields used in this feature
- `id`: primary key
- `employee_code`: required, unique, normalized uppercase, regex `^[A-Z0-9]{4,20}$`
- `username`: system-generated, unique, normalized
- `email`: required, unique, lowercase
- `password_hash`: required, lưu sau khi hash temporary password
- `full_name`: required, trim/collapse spaces
- `phone_number`: optional, regex `^\+?[0-9]{10,15}$`
- `department_id`: foreign key to `departments.id`, phải tham chiếu department còn hiệu lực nếu được gửi
- `status`: set `ACTIVE` ngay sau khi tạo thành công
- `force_change_password`: boolean, set `true`
- `created_by`: id của Administrator tạo account
- `updated_by`: id của Administrator tạo account
- `created_at`, `updated_at`: timestamps

### Constraints
- Unique index: `email`, `username`, `employee_code`
- Không lưu plaintext temporary password trong bất kỳ field nào

## 2. User Role (`user_roles`)

### Purpose
Liên kết account mới với đúng 1 role chính tại thời điểm tạo.

### Fields used in this feature
- `user_id`
- `role_id`
- `created_at` / audit fields nếu schema hiện có hỗ trợ

### Constraints
- `role_id` phải tồn tại và còn hiệu lực
- `role_id` phải nằm trong whitelist assignable của actor
- Với UC-AM-01 chỉ insert đúng 1 role chính

## 3. Department (`departments`)

### Purpose
Reference entity để validate `department_id` trong create account.

### Fields used in this feature
- `id`
- `code`
- `name`
- trạng thái hiệu lực nếu schema có cột tương ứng

### Constraints
- Department boundary theo manager scope không áp dụng
- Chỉ chấp nhận department còn hiệu lực tại thời điểm submit

## 4. Role (`roles`)

### Purpose
Reference entity để validate role được chọn và enforce whitelist assignment.

### Fields used in this feature
- `id`
- `code`
- `name`
- trạng thái hiệu lực nếu schema có cột tương ứng

### Constraints
- Chỉ 1 role chính tại thời điểm tạo
- Role phải thuộc danh sách assignable của actor

## 5. Audit Log (`audit_logs`)

### Purpose
Lưu vết hành động create account phục vụ auditability.

### Fields expected
- `actor_id`
- `action` = `account.create`
- `target_id` = user id mới tạo
- `occurred_at`
- metadata tối thiểu về employeeCode/email/roleId/departmentId hoặc trace tương đương theo schema hiện có

## 6. Derived / transient values

- `temporary_password`: chỉ tồn tại trong application memory, không persist plaintext
- `username_generation_attempt_count`: transient trong service logic, không persist
- `notification_warning`: chỉ là response/runtime state, không phải persisted domain field trong UC này
