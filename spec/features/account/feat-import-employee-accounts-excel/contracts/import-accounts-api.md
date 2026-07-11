# API Contract: Tạo tài khoản nhân viên bằng import Excel

- **Feature ID**: ACCT-IMPORT-ACCOUNT-001
- **Created**: 2026-07-10

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo API contract cho import tài khoản Excel | Toàn bộ file |

---

## 1. Endpoint: Tải template

### `GET /api/v1/users/import/template`
| Aspect | Detail |
|---|---|
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `accounts.user.import` |
| Response | `200` file `.xlsx` |
| Content-Type | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| Content-Disposition | `attachment; filename="employee-accounts-template.xlsx"` |

Template gồm 8 cột header: `full_name`, `email`, `department_code`, `role_codes`, `employee_code`, `phone_number`, `position_title`, `direct_manager_email`; 1-2 dòng ví dụ; sheet hướng dẫn.

---

## 2. Endpoint: Import (preview + commit)

### `POST /api/v1/users/import`
| Aspect | Detail |
|---|---|
| Method | POST |
| Auth | `JwtAuthGuard` + `PermissionsGuard` |
| Permission | `accounts.user.import` |
| Content-Type | `multipart/form-data` |
| Interceptor | `FileInterceptor('file')` (memoryStorage) |

### Request (multipart form fields)
| Field | Type | Required | Ghi chú |
|---|---|---|---|
| `file` | binary (.xlsx) | ✅ | Danh sách nhân viên |
| `commit` | boolean | ❌ (default `false`) | `false`=preview (không ghi DB); `true`=tạo tài khoản |

### Swagger body schema
```json
{
  "type": "object",
  "properties": {
    "file": { "type": "string", "format": "binary" },
    "commit": { "type": "boolean" }
  },
  "required": ["file"]
}
```

---

## 3. Responses

### 3.1 `200` — Preview (`commit=false`)
```json
{
  "success": true,
  "message": "Kiểm tra hoàn tất",
  "data": {
    "mode": "preview",
    "totalRows": 10,
    "validCount": 8,
    "invalidCount": 2,
    "results": [
      { "row": 2, "email": "an@company.com", "status": "valid" },
      { "row": 3, "email": "bad-email", "status": "invalid", "reason": "INVALID_EMAIL" },
      { "row": 4, "email": "existing@company.com", "status": "invalid", "reason": "EMAIL_ALREADY_EXISTS" }
    ]
  }
}
```

### 3.2 `200` — Commit (`commit=true`)
```json
{
  "success": true,
  "message": "Tạo tài khoản hoàn tất",
  "data": {
    "mode": "commit",
    "totalRows": 10,
    "successCount": 8,
    "failedCount": 2,
    "results": [
      { "row": 2, "email": "an@company.com", "status": "success", "userId": "uuid" },
      { "row": 3, "email": "bad-email", "status": "failed", "reason": "INVALID_EMAIL" }
    ]
  }
}
```
> Mật khẩu tạm KHÔNG có trong response (NFR-004) — chỉ gửi qua email.

### 3.3 Error responses cấp request
| Status | Code | Điều kiện |
|---|---|---|
| 400 | `INVALID_FILE_FORMAT` | Không phải `.xlsx` |
| 400 | `FILE_TOO_LARGE` | Vượt dung lượng |
| 400 | `INVALID_TEMPLATE` | File rỗng / sai header |
| 400 | `IMPORT_ROW_LIMIT_EXCEEDED` | > 200 dòng |
| 401 | — | Chưa đăng nhập |
| 403 | `FORBIDDEN_ACCESS` | Thiếu permission `accounts.user.import` |

---

## 4. Mã lỗi cấp dòng (`results[].reason`)
| Reason | Ý nghĩa |
|---|---|
| `MISSING_REQUIRED_FIELD` | Thiếu full_name/email/department_code/role_codes |
| `INVALID_EMAIL` | Email sai định dạng |
| `DUPLICATE_IN_FILE` | Trùng email trong file |
| `EMAIL_ALREADY_EXISTS` | Email đã tồn tại DB |
| `EMPLOYEE_CODE_ALREADY_EXISTS` | Mã NV đã tồn tại |
| `DEPARTMENT_NOT_FOUND` | department_code không khớp/inactive |
| `ROLE_NOT_FOUND` | role_code không khớp/inactive |
| `MANAGER_NOT_FOUND` | direct_manager_email không khớp/inactive |

---

## 5. Ghi chú tuân thủ
- Response bọc format chuẩn `{ success, message, data, error }` (AGENTS.md §8).
- Endpoint là API người dùng (JWT) → DTO/validation ở boundary; file parse trong memory.
- KHÔNG trả/không log mật khẩu tạm (NFR-004, NFR-005).
