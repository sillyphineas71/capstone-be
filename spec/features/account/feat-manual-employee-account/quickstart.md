# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-04 | Khởi tạo tài liệu hướng dẫn kiểm thử (quickstart.md) cho tính năng Tạo tài khoản thủ công | Toàn bộ tài liệu |

# Quickstart & Verification Guide: Tạo tài khoản thủ công

Tài liệu này cung cấp hướng dẫn kiểm thử và xác minh tính đúng đắn cho tính năng Tạo tài khoản thủ công, bao gồm cả kiểm thử tự động (Unit Test) và kiểm thử thủ công (Manual Verification).

## 1. Test Scenarios (Kịch bản kiểm thử)

Các kịch bản kiểm thử bao gồm cả trường hợp thành công (Happy Path) và các trường hợp lỗi (Error Cases):

### 1.1 Happy Path Scenario (Kịch bản thành công)
- **Kịch bản**: Tạo thành công tài khoản cho nhân viên mới.
- **Dữ liệu đầu vào**:
  - Manager có token JWT hợp lệ với quyền `account.user.create`.
  - Body:
    ```json
    {
      "fullName": "Nguyen Van Happy",
      "email": " happy.nva@company.com ",
      "departmentId": "<uuid_active_dept>",
      "roleIds": ["<uuid_active_role>"],
      "employeeCode": "EMP-HAPPY",
      "phoneNumber": "+84 999 111 222",
      "positionTitle": "Senior Analyst"
    }
    ```
- **Kết quả mong muốn (HTTP 201)**:
  1. Trả về thông tin user đã được tạo. Email được làm sạch thành `"happy.nva@company.com"`. Không chứa thông tin mật khẩu tạm hay hash.
  2. Bảng `users` ghi nhận bản ghi mới có `username = 'happy.nva@company.com'`, `account_status = 'active'`, `must_change_password = true`.
  3. Bảng `user_roles` ghi nhận vai trò được liên kết chính xác, `assigned_by` khớp với ID Manager tạo.
  4. Bảng `background_jobs` ghi nhận job loại `'send_email'` với `status = 'queued'`, `input_json` chứa đầy đủ thông tin: họ tên, email, mật khẩu tạm thời ngẫu nhiên (độ dài >= 12 ký tự, đủ chữ hoa, thường, số, ký tự đặc biệt).
  5. Bảng `audit_logs` ghi nhận log với `action_type = 'ACCOUNT_CREATE'`, `entity_id = <new_user_id>`, `new_value_json` chứa thông tin user nhưng tuyệt đối không chứa password hash hoặc mật khẩu tạm thời.

### 1.2 Error Scenarios (Các kịch bản lỗi)

#### TS-01: Thiếu Quyền Hạn (HTTP 403 Forbidden)
- **Mô tả**: Gọi API bằng tài khoản không có quyền `account.user.create`.
- **Kết quả**: Trả về 403, lỗi `FORBIDDEN`. Không có bản ghi nào được tạo trong DB.

#### TS-02: Sai Định Dạng Dữ Liệu (HTTP 400 Bad Request)
- **Mô tả**: Dữ liệu email sai định dạng (ví dụ `"nva@"` hoặc `"nva"`), hoặc số điện thoại chứa ký tự đặc biệt lạ (ví dụ `"0987abc#$"`).
- **Kết quả**: Trả về 400, lỗi `VALIDATION_ERROR` kèm chi tiết lỗi của từng field.

#### TS-03: Rỗng Danh Sách Vai Trò (HTTP 422 Unprocessable Entity)
- **Mô tả**: Gửi request với `roleIds = []`.
- **Kết quả**: Trả về 422, lỗi `ROLE_IDS_EMPTY`.

#### TS-04: Phòng Ban Không Hợp Lệ (HTTP 404 hoặc 422)
- **Mô tả**: Gửi `departmentId` không tồn tại (trả về 404 `DEPARTMENT_NOT_FOUND`), hoặc tồn tại nhưng `is_active = false`/đã xóa mềm (trả về 422 `DEPARTMENT_INACTIVE_OR_DELETED`).

#### TS-05: Vai Trò Không Hợp Lệ (HTTP 404 hoặc 422)
- **Mô tả**: Gửi một `roleId` không tồn tại (trả về 404 `ROLE_NOT_FOUND`), hoặc tồn tại nhưng `is_active = false` (trả về 422 `ROLE_INACTIVE`).

#### TS-06: Trùng Lặp Email (HTTP 409 Conflict)
- **Mô tả**: Gửi request với email `"happy.nva@company.com"` sau khi tài khoản ở Happy Path đã được tạo.
- **Kết quả**: Trả về 409, lỗi `ACCOUNT_EMAIL_ALREADY_EXISTS`. Kiểm tra cả so khớp case-insensitive (ví dụ gửi `"HAPPY.NVA@COMPANY.COM"` cũng phải trả về 409).

#### TS-07: Trùng Lặp Mã Nhân Viên (HTTP 409 Conflict)
- **Mô tả**: Gửi mã nhân viên `employeeCode = "EMP-HAPPY"` đã tồn tại.
- **Kết quả**: Trả về 409, lỗi `ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS`.

#### TS-08: Lỗi Tạo Background Job Gây Rollback (HTTP 500)
- **Mô tả**: Giả lập lỗi khi lưu `BackgroundJobEntity` vào DB.
- **Kết quả**: Trả về 500, toàn bộ transaction được rollback. Kiểm tra bảng `users` đảm bảo user đó **không được tạo**.

---

## 2. Verification Steps (Các bước xác minh thủ công)

Sau khi triển khai, bạn có thể thực hiện kiểm tra thủ công bằng cách sử dụng các công cụ quản lý database (như pgAdmin, DBeaver) chạy các câu lệnh SQL để đối soát:

### Bước 2.1: Kiểm tra User & User Roles
Truy vấn bảng `users` và `user_roles` để đảm bảo tài khoản được gán đúng role:
```sql
SELECT id, username, email, account_status, employment_status, must_change_password 
FROM users 
WHERE email = 'happy.nva@company.com';

-- Lấy các vai trò của user vừa tạo
SELECT r.role_code, r.role_name, ur.assigned_by, ur.is_active
FROM user_roles ur
INNER JOIN roles r ON r.id = ur.role_id
WHERE ur.user_id = (SELECT id FROM users WHERE email = 'happy.nva@company.com');
```

### Bước 2.2: Kiểm tra Hàng đợi Gửi Email
Xác nhận rằng email gửi thông tin đăng nhập đã được xếp hàng đợi nền:
```sql
SELECT job_type, status, input_json, retry_count
FROM background_jobs
WHERE related_entity_id = (SELECT id FROM users WHERE email = 'happy.nva@company.com');
```
*Yêu cầu check*: `input_json` phải có trường chứa mật khẩu tạm ngẫu nhiên, không được rỗng hoặc hiển thị chuỗi hash.

### Bước 2.3: Kiểm tra Nhật ký Hoạt động (Audit Log)
Xác minh vết ghi log hệ thống:
```sql
SELECT action_type, entity_type, entity_id, new_value_json, severity
FROM audit_logs
WHERE entity_id = (SELECT id FROM users WHERE email = 'happy.nva@company.com');
```
*Yêu cầu check*: `new_value_json` phải có thông tin user vừa tạo, không được có password hoặc hash mật khẩu.
```json
// Ví dụ new_value_json mong muốn:
{
  "email": "happy.nva@company.com",
  "fullName": "Nguyen Van Happy",
  "employeeCode": "EMP-HAPPY",
  "departmentId": "48f73111-9a7c-4735-901a-cf2a4d95267b",
  "roleIds": ["fa84617c-02cf-4b9f-b984-7a32810a9526"]
}
```
Nếu audit log chèn bị lỗi (ví dụ do cột quá dài hoặc DB timeout), API vẫn phải trả về 201 cho user và in log lỗi lên console.
