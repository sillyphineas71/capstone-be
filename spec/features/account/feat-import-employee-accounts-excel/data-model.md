# Data Model: Tạo tài khoản nhân viên bằng import Excel

- **Feature ID**: ACCT-IMPORT-ACCOUNT-001
- **Created**: 2026-07-10

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo data-model cho import tài khoản Excel | Toàn bộ file |

---

## 1. Entity Impact

### 1.1 Entities đọc (READ)
| Entity / Table | Fields đọc | Mục đích |
|---|---|---|
| `users` | `id`, `email`, `employee_code`, `username`, `account_status`, `deleted_at` | Duplicate email/username/employee_code; resolve manager |
| `departments` | `id`, `department_code`, `is_active` | Resolve `department_code` |
| `roles` | `id`, `role_code`, `is_active` | Resolve `role_codes` |

### 1.2 Entities ghi (CREATE)
| Entity / Table | Action | Fields ghi |
|---|---|---|
| `users` | INSERT (mỗi dòng hợp lệ khi commit) | `full_name`, `email`, `username=email`, `password_hash` (bcrypt), `department_id`, `employee_code?`, `phone_number?`, `position_title?`, `direct_manager_id?`, `employment_status='active'`, `account_status='active'`, `must_change_password=true` |
| `user_roles` | INSERT (mỗi role) | `user_id`, `role_id`, `assigned_by=actor.id`, `is_active=true` |
| `notifications` | INSERT (mỗi user) | `notification_type='ACCOUNT_WELCOME'`, `channel='EMAIL'`, `recipient_emails=[email]`, `subject`, `content` (chứa mật khẩu tạm) |
| `background_jobs` | INSERT (mỗi user) | `job_type='SEND_EMAIL'`, `related_entity_type='users'`, `related_entity_id=userId` |
| `audit_logs` | INSERT | per-row `action_type='ACCOUNT_CREATE'`; tổng `action_type='ACCOUNT_IMPORT'` (`new_value_json={ totalRows, successCount, failedCount }`) |

---

## 2. Không thay đổi Schema
Feature này **KHÔNG thay đổi database schema**. Mọi entity đã tồn tại trong v3.2 Compact (39 tables). Không thêm bảng lịch sử import.

---

## 3. Ràng buộc & lưu ý dữ liệu
- `users.username` NOT NULL → điền `= email` (BR4: login bằng email, không expose username).
- `password_hash` cột `select:false` → không lộ khi query thường.
- Duplicate check dùng `deleted_at IS NULL` (bỏ qua soft-deleted) — nhất quán `createUser`.
- Duplicate email/employee_code chống trùng cả trong file (static) lẫn trong DB (query).
- `role_codes` cho phép nhiều giá trị, phân tách `;` (vd `EMPLOYEE;MANAGER`).

---

## 4. Cấu trúc file Excel (contract dữ liệu đầu vào)

Sheet 1 — dữ liệu:

| Cột (header) | Bắt buộc | Resolve/Ghi chú |
|---|---|---|
| `full_name` | ✅ | Họ tên |
| `email` | ✅ | Định danh đăng nhập; `username=email` |
| `department_code` | ✅ | → `departments.department_code` (active) |
| `role_codes` | ✅ | → `roles.role_code`, nhiều giá trị phân tách `;` |
| `employee_code` | ❌ | Unique nếu có |
| `phone_number` | ❌ | |
| `position_title` | ❌ | |
| `direct_manager_email` | ❌ | → user active theo email |

Sheet 2 (tuỳ chọn) — hướng dẫn + danh sách `department_code`/`role_code` hợp lệ để tra cứu.

---

## 5. Kết quả import (in-memory DTO, không lưu DB)

```ts
interface ImportAccountRowResult {
  row: number;                    // số dòng gốc Excel
  email: string;
  status: 'valid' | 'invalid' | 'success' | 'failed';
  reason?: string;                // mã lỗi (vd EMAIL_ALREADY_EXISTS)
  userId?: string;                // khi status='success'
}

interface ImportAccountReport {
  mode: 'preview' | 'commit';
  totalRows: number;
  validCount?: number;            // preview
  invalidCount?: number;          // preview
  successCount?: number;          // commit
  failedCount?: number;           // commit
  results: ImportAccountRowResult[];
}
```

- **preview** (`commit=false`): `status` ∈ {`valid`, `invalid`}.
- **commit** (`commit=true`): `status` ∈ {`success`, `failed`}.
- **Không** chứa mật khẩu tạm ở bất kỳ trường nào (NFR-004).

---

## 6. Redis / Cache không dùng
Không dùng cache/Redis. Không lưu file giữa 2 lần gọi — client gửi lại file khi `commit=true`.
