# Data Model: Khởi tạo phòng ban mới (UC-AM-03)

---

## 1. Entity: Department (departments)

### Columns

| Column | Type | Required | Default | Constraints | Notes |
|---|---|---|---|---|---|
| id | uuid PK | Yes | gen_random_uuid() | | Khóa chính |
| department_code | varchar(50) | Yes | | UNIQUE (non-deleted), pattern ^[A-Z0-9][A-Z0-9_-]{1,49}$ | Normalize sang uppercase |
| department_name | varchar(150) | Yes | | UNIQUE (non-deleted) | Trim, safe charset |
| parent_department_id | uuid | No | null | FK → departments.id, self-ref | No circular ref, depth ≤ 5 |
| manager_user_id | uuid | No | null | FK → users.id | Must exist, active, non-deleted |
| description | text | No | null | | Empty/whitespace → null |
| is_active | boolean | Yes | true | | Mặc định true |
| created_by | uuid | No | null | FK → users.id | Gán từ token |
| updated_by | uuid | No | null | FK → users.id | null lúc tạo |
| created_at | timestamptz | Yes | now() | | |
| updated_at | timestamptz | Yes | now() | | = created_at lúc tạo |
| deleted_at | timestamptz | No | null | | Soft delete |

### TypeORM Entity Status
- Entity DepartmentEntity đã tồn tại ở src/modules/accounts/entities/department.entity.ts.
- Cần cập nhật: unique constraints, self-referencing relationship đã có.
- Chưa có partial unique index (cần migration cho WHERE deleted_at IS NULL).

### Indexes

| Index Name | Columns | Condition | Purpose |
|---|---|---|---|
| ux_departments_code | department_code | WHERE deleted_at IS NULL | Unique code (non-deleted) |
| ux_departments_name | department_name | WHERE deleted_at IS NULL | Unique name (non-deleted) |
| ix_departments_parent | parent_department_id | — | FK lookup |
| ix_departments_manager | manager_user_id | — | FK lookup |
| ix_departments_active | is_active | — | Filter active |

### Migration Impact
- Cần TypeORM migration mới để thêm partial unique indexes.

---

## 2. Entity: User (users) — Reference Only

| Column | Use in this feature | Note |
|---|---|---|
| id | FK reference cho manager_user_id | Phải tồn tại, account_status = active, deleted_at IS NULL |
| account_status | Validate active | active / inactive / locked / pending_reset |
| deleted_at | Validate non-deleted | |

---

## 3. Entity: Audit Log (audit_logs)

Created by AdministrationModule when FR-025 triggers:
- action_type: 'create'
- entity_type: 'department'
- entity_id: department.id
- user_id: creator

---

## 4. State Transitions

Department chỉ có 1 trạng thái đơn giản:
- is_active = true (khi tạo)
- (Không thuộc phạm vi: chuyển sang is_active = false hoặc soft delete)

---

## 5. Validation Rules (Input → Persistence)

### departmentCode flow
1. Trim input
2. Convert to uppercase
3. Check empty/whitespace → 400
4. Check regex ^[A-Z0-9][A-Z0-9_-]{1,49}$ + length 2-50 → 422
5. Check unique non-deleted → 409 DEPARTMENT_ALREADY_EXISTS

### departmentName flow
1. Trim input
2. Check empty/whitespace → 400
3. Check length 2-150 → 422
4. Check emoji/control/unsafe content → 422
5. Check unique non-deleted → 409 DEPARTMENT_ALREADY_EXISTS

### parentDepartmentId flow
1. Check tồn tại → 404
2. Check is_active = true → 404
3. Check deleted_at IS NULL → 404
4. Check circular reference → 422
5. Check depth ≤ 5 → 422

### managerUserId flow
1. Check tồn tại → 404
2. Check account_status = 'active' → 404
3. Check deleted_at IS NULL → 404

### description flow
1. If empty/whitespace → convert to null
2. No other validation (free text)

### Authorization flow
1. Check JWT → 401
2. Check permission 'department.create' → 403
