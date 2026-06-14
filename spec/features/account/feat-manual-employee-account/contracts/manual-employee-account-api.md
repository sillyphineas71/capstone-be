# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-04 | Khởi tạo tài liệu đặc tả API (manual-employee-account-api.md) cho tính năng Tạo tài khoản thủ công | Toàn bộ tài liệu |

# API Contract: Tạo tài khoản thủ công (Manual Account Creation)

Đặc tả chi tiết endpoint API, các tham số đầu vào, cấu trúc phản hồi khi thành công và các mã lỗi nghiệp vụ tương ứng.

## 1. Request Details

- **Endpoint**: `POST /api/v1/users`
- **Authentication**: JWT Bearer Token (Yêu cầu permission: `account.user.create`)
- **Headers**:
  - `Authorization`: `Bearer <jwt_token>` (Bắt buộc)
  - `Content-Type`: `application/json` (Bắt buộc)
  - `x-request-id`: `<string>` (Không bắt buộc, dùng để tracing log)
  - `user-agent`: `<string>` (Không bắt buộc, dùng để audit log)

### Request Body Schema (JSON)

| Field | Type | Required | Max Length | Description / Validation Rules |
|---|---|---|---|---|
| `fullName` | string | Yes | 255 | Họ tên nhân viên. Trimmed. Không được trống. |
| `email` | string | Yes | 255 | Email định danh. Trimmed & converted to lowercase. Phải đúng định dạng email cơ bản. |
| `departmentId` | string (UUID) | Yes | - | ID của phòng ban. Phải tồn tại, đang hoạt động (`is_active = true`), chưa bị xóa mềm. |
| `roleIds` | string[] (UUID) | Yes | - | Mảng chứa ít nhất 1 role ID. Tất cả role phải tồn tại và đang hoạt động. |
| `employeeCode` | string | No | 50 | Mã số nhân viên. Trimmed. Phải là duy nhất nếu được cung cấp. |
| `phoneNumber` | string | No | 30 | Số điện thoại. Trimmed. Chỉ cho phép chữ số, khoảng trắng, dấu cộng, dấu gạch ngang, dấu ngoặc đơn. |
| `positionTitle`| string | No | 150 | Chức danh công việc. |
| `directManagerId`| string (UUID) | No | - | ID của người quản lý trực tiếp. Phải tồn tại, đang hoạt động, không ở trạng thái nghỉ việc (`resigned`). |

#### Example Request Body
```json
{
  "fullName": "Nguyễn Văn A",
  "email": "nva@company.com",
  "departmentId": "48f73111-9a7c-4735-901a-cf2a4d95267b",
  "roleIds": [
    "fa84617c-02cf-4b9f-b984-7a32810a9526"
  ],
  "employeeCode": "EMP-09823",
  "phoneNumber": "+84 987 654 321",
  "positionTitle": "Software Engineer",
  "directManagerId": "a243a411-9a7c-4735-901a-cf2a4d95267a"
}
```

---

## 2. Success Response (HTTP 201 Created)

Khi tài khoản được tạo thành công, mật khẩu tạm thời được gửi qua email. Mật khẩu tạm thời và hash mật khẩu **tuyệt đối không** được trả về trong payload của API response để bảo mật thông tin.

#### Example Response Body
```json
{
  "success": true,
  "message": "Nhân viên đã được tạo thành công và thông tin đăng nhập đã được gửi tới email.",
  "data": {
    "id": "c055eeab-12bd-481b-80df-89264fa5bc1b",
    "employeeCode": "EMP-09823",
    "email": "nva@company.com",
    "fullName": "Nguyễn Văn A",
    "accountStatus": "active",
    "mustChangePassword": true,
    "roles": [
      {
        "id": "fa84617c-02cf-4b9f-b984-7a32810a9526",
        "roleCode": "employee",
        "roleName": "Employee"
      }
    ],
    "createdAt": "2026-06-04T09:30:00.000Z"
  },
  "meta": {}
}
```

---

## 3. Error Responses

Lỗi trả về tuân thủ cấu trúc thống nhất của backend:
```json
{
  "success": false,
  "message": "<Mô tả lỗi tiếng Việt>",
  "error": {
    "code": "<INTERNAL_ERROR_CODE>",
    "details": {}
  },
  "timestamp": "2026-06-04T02:30:00.000Z",
  "path": "/api/v1/users"
}
```

### 3.1 Validation Errors (HTTP 400 Bad Request)
- **Mã lỗi**: `VALIDATION_ERROR`
- **Ví dụ chi tiết lỗi (E1)**:
  ```json
  {
    "success": false,
    "message": "Dữ liệu đầu vào không hợp lệ",
    "error": {
      "code": "VALIDATION_ERROR",
      "details": [
        {
          "field": "email",
          "issue": "email must be a valid email"
        },
        {
          "field": "fullName",
          "issue": "fullName should not be empty"
        }
      ]
    },
    "timestamp": "2026-06-04T02:30:00.000Z",
    "path": "/api/v1/users"
  }
  ```

### 3.2 Authentication / Authorization Errors (HTTP 401 & 403)
- **HTTP 401 Unauthorized**: Token JWT hết hạn hoặc không hợp lệ.
  ```json
  {
    "success": false,
    "message": "Yêu cầu xác thực nhưng không cung cấp thông tin hợp lệ.",
    "error": {
      "code": "UNAUTHORIZED",
      "details": {}
    },
    "timestamp": "2026-06-04T02:30:00.000Z",
    "path": "/api/v1/users"
  }
  ```
- **HTTP 403 Forbidden**: Người dùng không có quyền `account.user.create`.
  ```json
  {
    "success": false,
    "message": "Bạn không có quyền thực hiện hành động này.",
    "error": {
      "code": "FORBIDDEN",
      "details": {}
    },
    "timestamp": "2026-06-04T02:30:00.000Z",
    "path": "/api/v1/users"
  }
  ```

### 3.3 Resource Not Found Errors (HTTP 404 Not Found)
Xảy ra khi các thực thể liên kết được chỉ định không tồn tại.

| Trường hợp lỗi | Message đề xuất | error.code |
|---|---|---|
| Phòng ban không tồn tại | Phòng ban được chỉ định không tồn tại. | `DEPARTMENT_NOT_FOUND` |
| Vai trò không tồn tại | Một hoặc nhiều vai trò được chỉ định không tồn tại. | `ROLE_NOT_FOUND` |
| Người quản lý không tồn tại | Người quản lý trực tiếp không tồn tại trong hệ thống. | `MANAGER_NOT_FOUND` |

### 3.4 Conflict Errors (HTTP 409 Conflict)
Xảy ra khi vi phạm các ràng buộc dữ liệu duy nhất (Unique Constraints).

| Trường hợp lỗi | Message đề xuất | error.code |
|---|---|---|
| Email đã tồn tại | Địa chỉ email này đã được sử dụng cho một tài khoản khác. | `ACCOUNT_EMAIL_ALREADY_EXISTS` |
| Mã nhân viên đã tồn tại | Mã nhân viên này đã được đăng ký bởi tài khoản khác. | `ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS` |
| Username đã tồn tại | Tên người dùng này đã tồn tại trong hệ thống. | `ACCOUNT_USERNAME_ALREADY_EXISTS` |

### 3.5 Unprocessable Entity Errors (HTTP 422)
Xảy ra khi dữ liệu hợp lệ về cú pháp nhưng vi phạm các logic nghiệp vụ.

| Trường hợp lỗi | Message đề xuất | error.code |
|---|---|---|
| Phòng ban bị khóa/xóa | Phòng ban được chỉ định không hoạt động hoặc đã bị xóa. | `DEPARTMENT_INACTIVE_OR_DELETED` |
| Vai trò không hoạt động | Một hoặc nhiều vai trò được chọn đang ở trạng thái không hoạt động. | `ROLE_INACTIVE` |
| Danh sách vai trò trống | Tài khoản nhân viên mới phải được gán ít nhất một vai trò. | `ROLE_IDS_EMPTY` |
| Người quản lý không khả dụng | Người quản lý trực tiếp đang bị khóa, chưa kích hoạt hoặc đã nghỉ việc. | `MANAGER_INACTIVE_OR_UNAVAILABLE` |

### 3.6 System Errors (HTTP 500 Internal Server Error)
- **Mã lỗi**: `INTERNAL_SERVER_ERROR`
- **Chi tiết**: Xảy ra khi việc chèn job gửi email vào queue `background_jobs` gặp lỗi hoặc có sự cố cơ sở dữ liệu nghiêm trọng. Giao dịch sẽ được rollback toàn bộ.
  ```json
  {
    "success": false,
    "message": "Không thể tạo tài khoản do lỗi hệ thống khi xử lý email đăng nhập. Vui lòng thử lại sau.",
    "error": {
      "code": "INTERNAL_SERVER_ERROR",
      "details": {}
    },
    "timestamp": "2026-06-04T02:30:00.000Z",
    "path": "/api/v1/users"
  }
  ```
