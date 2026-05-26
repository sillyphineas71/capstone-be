# spec/modules/account/api.md
# Owner: TaiND | Version: 1.0.0

## 1. Purpose
This document defines the API contract for the **Account Management** module.

Tài liệu này mô tả các API chính của `modules/account` để phục vụ 8 use case trong account manager, bao gồm:
- create new account
- update own profile
- change account status
- enroll face profile
- view account list
- view account detail
- update account
- delete account

## 2. Scope
This API document covers the following business features inside **FE-02 Account Management**:
- UC-AM-01 Create New Account
- UC-AM-02 Update User Profile
- UC-AM-03 Change Account Status
- UC-AM-04 Enroll Face Profile
- UC-AM-05 View Account List
- UC-AM-06 View Account Detail
- UC-AM-07 Update Account
- UC-AM-08 Delete Account

### Out of scope
The following concerns are intentionally outside this API document:
- login / logout / refresh token / reset password execution
- runtime authorization enforcement
- attendance runtime processing
- unknown-face review workflow
- notification delivery execution
- meeting scheduling / meeting ownership reassignment workflow

## 3. Base Contract
- Base URL: `/api/v1/accounts`
- Content type: `application/json`
- File upload content type: `multipart/form-data`
- Auth: `JWT Bearer`
- Required scopes:
  - `accounts:read`
  - `accounts:write`
- Default time format: ISO-8601 UTC timestamp
- Default pagination:
  - `page`: zero-based index
  - `size`: default `20`, max `100`

## 4. Design Principles
- The API follows a resource-oriented REST style where possible.
- Sensitive values such as `password_hash`, reset token data, refresh token data, and raw biometric vectors MUST NEVER be returned by this module.
- Administrative changes MUST be audit logged.
- Account deactivation is the default operational removal strategy.
- Physical delete is an exceptional path and MUST be blocked when business dependencies still exist.
- Face enrollment is handled as a user-owned sub-resource under `/me`.

## 5. Data Ownership and Main Tables
### Core write tables
- `users`
- `user_profiles`
- `user_roles`
- `face_profiles`
- `face_profile_samples`

### Reference / lookup tables
- `departments`
- `roles`
- `permissions`
- `role_permissions`

### Shared governance tables
- `audit_logs`

### Cross-module but related tables
- `user_sessions` (used indirectly when deactivation requires session revocation)
- `meeting_participants` / `meetings` (used indirectly for dependency validation before delete)

## 6. Common Enumerations

### 6.1 AccountStatus
- `ACTIVE`
- `INACTIVE`

### 6.2 FaceProfileStatus
- `NOT_ENROLLED`
- `PROCESSING`
- `ACTIVE`
- `REJECTED`
- `DISABLED`

### 6.3 SortDirection
- `asc`
- `desc`

## 7. Common Response Shapes

### 7.1 Success envelope
```json
{
  "data": {},
  "meta": {},
  "message": "Operation completed successfully"
}
```

### 7.2 Error envelope
```json
{
  "error": {
    "code": "ACCOUNT_NOT_FOUND",
    "message": "Account does not exist",
    "details": []
  },
  "traceId": "2b02f1f8-9d75-4b46-8d36-0bb5bcabf0d4"
}
```

### 7.3 AccountSummary
```json
{
  "id": "usr_123",
  "employeeCode": "EMP-00045",
  "username": "linh.tran",
  "fullName": "Tran Linh",
  "email": "linh.tran@company.com",
  "phoneNumber": "+84-901-000-111",
  "avatarUrl": "https://cdn.example.com/avatar/usr_123.png",
  "department": {
    "id": "dep_01",
    "code": "HR",
    "name": "Human Resources"
  },
  "roles": [
    {
      "id": "role_admin",
      "code": "ADMIN",
      "name": "Administrator"
    }
  ],
  "positionTitle": "HR Executive",
  "status": "ACTIVE",
  "faceProfileStatus": "ACTIVE",
  "lastLoginAt": "2026-04-22T08:15:00Z",
  "createdAt": "2026-04-01T01:00:00Z",
  "updatedAt": "2026-04-20T09:30:00Z"
}
```

### 7.4 AccountDetail
```json
{
  "id": "usr_123",
  "employeeCode": "EMP-00045",
  "username": "linh.tran",
  "fullName": "Tran Linh",
  "email": "linh.tran@company.com",
  "phoneNumber": "+84-901-000-111",
  "avatarUrl": "https://cdn.example.com/avatar/usr_123.png",
  "positionTitle": "HR Executive",
  "status": "ACTIVE",
  "department": {
    "id": "dep_01",
    "code": "HR",
    "name": "Human Resources"
  },
  "roles": [
    {
      "id": "role_manager",
      "code": "MANAGER",
      "name": "Manager"
    }
  ],
  "profile": {
    "dateOfBirth": "1998-10-20",
    "gender": "female",
    "address": "Hoan Kiem, Ha Noi",
    "bio": "Project coordinator",
    "emergencyContact": "Nguyen Van A - 090xxxxxxx",
    "preferences": {}
  },
  "faceProfile": {
    "status": "ACTIVE",
    "profileName": "primary-face-profile",
    "qualityScore": 94.2,
    "isPrimary": true,
    "consentAt": "2026-04-20T10:00:00Z",
    "updatedAt": "2026-04-20T10:05:00Z"
  },
  "createdAt": "2026-04-01T01:00:00Z",
  "updatedAt": "2026-04-20T09:30:00Z",
  "createdBy": "usr_admin_01",
  "updatedBy": "usr_admin_01"
}
```

## 8. Endpoint Catalog

| Feature | Endpoint | Method | Main Actor | Purpose |
|---|---|---|---|---|
| UC-AM-01 | `/api/v1/accounts` | POST | Administrator | Create new internal account |
| UC-AM-02 | `/api/v1/accounts/me/profile` | PATCH | User | Update own profile |
| UC-AM-03 | `/api/v1/accounts/{accountId}/status` | PATCH | Administrator | Activate / deactivate one account |
| UC-AM-03 | `/api/v1/accounts/status:batch` | POST | Administrator | Bulk activate / deactivate accounts |
| UC-AM-04 | `/api/v1/accounts/me/face-profile` | GET | User | View face enrollment status |
| UC-AM-04 | `/api/v1/accounts/me/face-profile` | POST | User | Enroll or re-enroll face profile |
| UC-AM-05 | `/api/v1/accounts` | GET | Administrator | View account list |
| UC-AM-06 | `/api/v1/accounts/me` | GET | User | View own account detail |
| UC-AM-06 | `/api/v1/accounts/{accountId}` | GET | Administrator | View account detail |
| UC-AM-07 | `/api/v1/accounts/{accountId}` | PATCH | Administrator | Update managed account fields |
| UC-AM-08 | `/api/v1/accounts/{accountId}` | DELETE | Administrator | Delete / retire account with dependency checks |
| Support | `/api/v1/accounts/lookups/departments` | GET | Administrator | Load department catalog |
| Support | `/api/v1/accounts/lookups/roles` | GET | Administrator | Load role catalog |

## 9. Support Lookup APIs

### 9.1 Get department lookup
**GET** `/api/v1/accounts/lookups/departments`

Purpose:
- Load department catalog for create / update / filter screens.
- Dùng để load danh mục phòng ban cho form quản trị tài khoản.

Response:
```json
{
  "data": [
    {
      "id": "dep_01",
      "code": "HR",
      "name": "Human Resources",
      "parentDepartmentId": null
    }
  ]
}
```

### 9.2 Get role lookup
**GET** `/api/v1/accounts/lookups/roles`

Purpose:
- Load assignable role catalog for account creation and update.
- Dùng để load danh mục role khi tạo hoặc sửa account.

Response:
```json
{
  "data": [
    {
      "id": "role_admin",
      "code": "ADMIN",
      "name": "Administrator"
    }
  ]
}
```

## 10. UC-AM-01 Create New Account

### Endpoint
**POST** `/api/v1/accounts`

### Purpose
Create a new internal user account and assign initial roles.

Tạo tài khoản nội bộ mới, gán vai trò ban đầu, và yêu cầu gửi thông báo provisioning.

### Authorization
- Required scope: `accounts:write`
- Allowed actor: Administrator

### Request body
```json
{
  "employeeCode": "EMP-00045",
  "username": "linh.tran",
  "fullName": "Tran Linh",
  "email": "linh.tran@company.com",
  "phoneNumber": "+84-901-000-111",
  "positionTitle": "HR Executive",
  "departmentId": "dep_01",
  "roleIds": ["role_manager"],
  "sendProvisioningNotification": true
}
```

### Field rules
- `username`: required, unique, no whitespace, no special characters beyond allowed username pattern.
- `fullName`: required.
- `email`: required, valid format, unique.
- `employeeCode`: optional, but unique when present.
- `roleIds`: required, at least 1 role.
- `departmentId`: optional.
- `phoneNumber`: optional, valid format when present.
- `sendProvisioningNotification`: optional, default `true`.

### Processing notes
- System generates a temporary password internally.
- Temporary password MUST NOT be returned in API response.
- Force-change-password-on-first-login policy is handled downstream by auth.

### Success response
**201 Created**
```json
{
  "data": {
    "account": {
      "id": "usr_123",
      "employeeCode": "EMP-00045",
      "username": "linh.tran",
      "fullName": "Tran Linh",
      "email": "linh.tran@company.com",
      "status": "ACTIVE",
      "department": {
        "id": "dep_01",
        "code": "HR",
        "name": "Human Resources"
      },
      "roles": [
        {
          "id": "role_manager",
          "code": "MANAGER",
          "name": "Manager"
        }
      ],
      "createdAt": "2026-04-22T09:00:00Z"
    },
    "provisioningNotificationRequested": true
  },
  "message": "Account created successfully"
}
```

### Main tables touched
- `users`
- `user_roles`
- `audit_logs`

### Events published
- `account.created`
- `account.roles_changed`
- `account.provisioning_notification_requested`

### Error codes
- `DUPLICATE_USERNAME`
- `DUPLICATE_EMAIL`
- `DUPLICATE_EMPLOYEE_CODE`
- `ROLE_NOT_FOUND`
- `DEPARTMENT_NOT_FOUND`
- `INVALID_PHONE_NUMBER`
- `INVALID_USERNAME_FORMAT`

## 11. UC-AM-02 Update User Profile

### Endpoint
**PATCH** `/api/v1/accounts/me/profile`

### Purpose
Update editable self-profile fields only.

Cho phép người dùng tự cập nhật phần hồ sơ cá nhân được phép chỉnh sửa.

### Authorization
- Required scope: `accounts:write`
- Allowed actor: authenticated user

### Content type
`multipart/form-data`

### Request fields
- `phoneNumber`: optional string
- `address`: optional string
- `bio`: optional string
- `emergencyContact`: optional string
- `dateOfBirth`: optional date
- `gender`: optional string
- `preferencesJson`: optional JSON string
- `avatarFile`: optional file (`.jpg`, `.jpeg`, `.png`, max 5 MB)

### Immutable fields in this flow
- `fullName`
- `email`
- `employeeCode`
- `roleIds`
- `departmentId`
- `status`

### Success response
**200 OK**
```json
{
  "data": {
    "account": {
      "id": "usr_123",
      "fullName": "Tran Linh",
      "email": "linh.tran@company.com",
      "phoneNumber": "+84-901-000-111",
      "avatarUrl": "https://cdn.example.com/avatar/usr_123_v2.png"
    },
    "profile": {
      "address": "Hoan Kiem, Ha Noi",
      "bio": "Project coordinator",
      "emergencyContact": "Nguyen Van A - 090xxxxxxx",
      "dateOfBirth": "1998-10-20",
      "gender": "female",
      "updatedAt": "2026-04-22T09:10:00Z"
    }
  },
  "message": "Profile updated successfully"
}
```

### Main tables touched
- `users` (for `phone_number`, `avatar_url`, `updated_at`)
- `user_profiles`
- `audit_logs`

### Events published
- `profile.updated`

### Error codes
- `INVALID_PHONE_NUMBER`
- `INVALID_AVATAR_FORMAT`
- `AVATAR_FILE_TOO_LARGE`
- `BIO_TOO_LONG`
- `ACCOUNT_NOT_FOUND`

## 12. UC-AM-03 Change Account Status

### 12.1 Change one account status
**PATCH** `/api/v1/accounts/{accountId}/status`

### Request body
```json
{
  "targetStatus": "INACTIVE",
  "reason": "Employee has left the company"
}
```

### Rules
- `targetStatus` must be `ACTIVE` or `INACTIVE`.
- `reason` is mandatory when `targetStatus = INACTIVE`.
- Self-deactivation is forbidden.

### Success response
**200 OK**
```json
{
  "data": {
    "id": "usr_123",
    "status": "INACTIVE",
    "statusChangedAt": "2026-04-22T09:20:00Z",
    "sessionRevocationRequested": true
  },
  "message": "Account status changed successfully"
}
```

### 12.2 Bulk status change
**POST** `/api/v1/accounts/status:batch`

### Request body
```json
{
  "accountIds": ["usr_101", "usr_102", "usr_103"],
  "targetStatus": "INACTIVE",
  "reason": "Temporary workforce reduction"
}
```

### Success response
**200 OK**
```json
{
  "data": {
    "processedCount": 3,
    "updatedAccountIds": ["usr_101", "usr_102", "usr_103"],
    "sessionRevocationRequested": true
  },
  "message": "Bulk account status change completed"
}
```

### Main tables touched
- `users`
- `audit_logs`
- indirect downstream effect on `user_sessions`

### Events published
- `account.status_changed`

### Error codes
- `ACCOUNT_NOT_FOUND`
- `INVALID_ACCOUNT_STATUS`
- `REASON_REQUIRED_FOR_DEACTIVATION`
- `SELF_DEACTIVATION_NOT_ALLOWED`
- `BULK_OPERATION_PARTIALLY_FAILED`

## 13. UC-AM-04 Enroll Face Profile

### 13.1 View own face profile status
**GET** `/api/v1/accounts/me/face-profile`

### Success response
**200 OK**
```json
{
  "data": {
    "status": "ACTIVE",
    "profileName": "primary-face-profile",
    "qualityScore": 94.2,
    "isPrimary": true,
    "consentAt": "2026-04-20T10:00:00Z",
    "sampleCount": 3,
    "updatedAt": "2026-04-20T10:05:00Z"
  }
}
```

### 13.2 Enroll or re-enroll face profile
**POST** `/api/v1/accounts/me/face-profile`

### Content type
`multipart/form-data`

### Request fields
- `profileName`: required string
- `consentAccepted`: required boolean, must be `true`
- `replaceExisting`: optional boolean, default `false`
- `samples[]`: required 3..10 image files
- `captureMetadataJson`: optional JSON string

### Rules
- User must explicitly accept privacy notice.
- Minimum recommended sample count: `3`.
- Invalid image quality may cause rejection.
- If an active face profile exists and `replaceExisting=false`, API returns conflict.

### Success response
**201 Created**
```json
{
  "data": {
    "status": "ACTIVE",
    "profileName": "primary-face-profile",
    "qualityScore": 94.2,
    "isPrimary": true,
    "consentAt": "2026-04-22T09:30:00Z",
    "sampleCount": 3,
    "updatedAt": "2026-04-22T09:31:00Z"
  },
  "message": "Face profile enrolled successfully"
}
```

### Main tables touched
- `face_profiles`
- `face_profile_samples`
- `audit_logs`

### Events published
- `face_profile.enrolled`
- `face_profile.reenrolled` (when replacing an existing profile)

### Error codes
- `CONSENT_REQUIRED`
- `FACE_PROFILE_ALREADY_EXISTS`
- `INVALID_SAMPLE_COUNT`
- `INVALID_IMAGE_FORMAT`
- `IMAGE_QUALITY_TOO_LOW`
- `FACE_AI_SERVICE_UNAVAILABLE`
- `CAMERA_CAPTURE_METADATA_INVALID`

## 14. UC-AM-05 View Account List

### Endpoint
**GET** `/api/v1/accounts`

### Purpose
Return a paginated account list for administrative management.

Trả về danh sách tài khoản có phân trang, tìm kiếm, lọc và sắp xếp.

### Query parameters
- `keyword`: search by `fullName`, `email`, `employeeCode`, optional
- `departmentId`: optional
- `roleId`: optional
- `status`: optional (`ACTIVE` / `INACTIVE`)
- `page`: optional, default `0`
- `size`: optional, default `20`, max `100`
- `sortBy`: optional, allowed values:
  - `fullName`
  - `email`
  - `employeeCode`
  - `status`
  - `createdAt`
  - `updatedAt`
- `sortDir`: optional (`asc` / `desc`)

### Example
`GET /api/v1/accounts?keyword=linh&departmentId=dep_01&status=ACTIVE&page=0&size=20&sortBy=fullName&sortDir=asc`

### Success response
**200 OK**
```json
{
  "data": {
    "items": [
      {
        "id": "usr_123",
        "employeeCode": "EMP-00045",
        "username": "linh.tran",
        "fullName": "Tran Linh",
        "email": "linh.tran@company.com",
        "department": {
          "id": "dep_01",
          "code": "HR",
          "name": "Human Resources"
        },
        "roles": [
          {
            "id": "role_manager",
            "code": "MANAGER",
            "name": "Manager"
          }
        ],
        "status": "ACTIVE",
        "faceProfileStatus": "ACTIVE",
        "updatedAt": "2026-04-22T09:31:00Z"
      }
    ]
  },
  "meta": {
    "page": 0,
    "size": 20,
    "totalItems": 1,
    "totalPages": 1,
    "sortBy": "fullName",
    "sortDir": "asc"
  }
}
```

### Main tables read
- `users`
- `departments`
- `user_roles`
- `roles`
- optional `face_profiles`

### Error codes
- `INVALID_PAGINATION`
- `INVALID_SORT_FIELD`
- `INVALID_FILTER_VALUE`

## 15. UC-AM-06 View Account Detail

### 15.1 View own account detail
**GET** `/api/v1/accounts/me`

### 15.2 View any account detail (admin only)
**GET** `/api/v1/accounts/{accountId}`

### Purpose
Return full account detail with identity, profile, department, role, and face-profile status.

Hiển thị đầy đủ thông tin tài khoản, hồ sơ mở rộng, trạng thái và thông tin đăng ký khuôn mặt.

### Success response
**200 OK**
```json
{
  "data": {
    "id": "usr_123",
    "employeeCode": "EMP-00045",
    "username": "linh.tran",
    "fullName": "Tran Linh",
    "email": "linh.tran@company.com",
    "phoneNumber": "+84-901-000-111",
    "avatarUrl": "https://cdn.example.com/avatar/usr_123.png",
    "positionTitle": "HR Executive",
    "status": "ACTIVE",
    "department": {
      "id": "dep_01",
      "code": "HR",
      "name": "Human Resources"
    },
    "roles": [
      {
        "id": "role_manager",
        "code": "MANAGER",
        "name": "Manager"
      }
    ],
    "profile": {
      "dateOfBirth": "1998-10-20",
      "gender": "female",
      "address": "Hoan Kiem, Ha Noi",
      "bio": "Project coordinator",
      "emergencyContact": "Nguyen Van A - 090xxxxxxx"
    },
    "faceProfile": {
      "status": "ACTIVE",
      "profileName": "primary-face-profile",
      "qualityScore": 94.2,
      "isPrimary": true,
      "consentAt": "2026-04-20T10:00:00Z"
    },
    "createdAt": "2026-04-01T01:00:00Z",
    "updatedAt": "2026-04-22T09:31:00Z"
  }
}
```

### Read rules
- Normal users may access only `/me`.
- Administrators may access `/api/v1/accounts/{accountId}`.
- Sensitive authentication data must never be returned.

### Main tables read
- `users`
- `user_profiles`
- `departments`
- `user_roles`
- `roles`
- optional `face_profiles`

### Error codes
- `ACCOUNT_NOT_FOUND`
- `ACCESS_DENIED`

## 16. UC-AM-07 Update Account

### Endpoint
**PATCH** `/api/v1/accounts/{accountId}`

### Purpose
Update account fields that are managed by administrators and are not user-editable in self-profile flow.

Cho phép quản trị viên cập nhật các trường quản trị như họ tên, mã nhân viên, phòng ban, role, chức danh.

### Authorization
- Required scope: `accounts:write`
- Allowed actor: Administrator

### Request body
```json
{
  "fullName": "Tran Thi Linh",
  "employeeCode": "EMP-00045",
  "departmentId": "dep_02",
  "positionTitle": "Project Coordinator",
  "roleIds": ["role_manager"],
  "phoneNumber": "+84-901-000-111"
}
```

### Rules
- `email` is immutable in this flow.
- `username` SHOULD be immutable in the normal admin update flow unless a separate dedicated process is later defined.
- `employeeCode` must remain unique when changed.
- If admin is promoting another user to a high-privilege role, implementation MAY require current admin password confirmation.

### Success response
**200 OK**
```json
{
  "data": {
    "id": "usr_123",
    "fullName": "Tran Thi Linh",
    "employeeCode": "EMP-00045",
    "department": {
      "id": "dep_02",
      "code": "PMO",
      "name": "Project Management Office"
    },
    "positionTitle": "Project Coordinator",
    "roles": [
      {
        "id": "role_manager",
        "code": "MANAGER",
        "name": "Manager"
      }
    ],
    "updatedAt": "2026-04-22T09:40:00Z"
  },
  "message": "Account updated successfully"
}
```

### Main tables touched
- `users`
- `user_roles`
- `audit_logs`

### Events published
- `account.updated`
- `account.roles_changed`

### Error codes
- `ACCOUNT_NOT_FOUND`
- `DUPLICATE_EMPLOYEE_CODE`
- `DEPARTMENT_NOT_FOUND`
- `ROLE_NOT_FOUND`
- `EMAIL_IMMUTABLE`
- `HIGH_PRIVILEGE_CONFIRMATION_REQUIRED`

## 17. UC-AM-08 Delete Account

### Endpoint
**DELETE** `/api/v1/accounts/{accountId}`

### Purpose
Remove an account from the active system only when dependency checks pass.

Xóa hoặc retire account khỏi danh sách hoạt động sau khi đã kiểm tra hết ràng buộc nghiệp vụ.

### Authorization
- Required scope: `accounts:write`
- Allowed actor: Administrator

### Query parameters
- `mode`: optional
  - `retire` (default)
  - `hard-delete` (exception path only)

### Request body
```json
{
  "reason": "Account was created by mistake"
}
```

### Rules
- Self-delete is forbidden.
- If the account is referenced by unresolved future responsibilities, delete MUST be blocked.
- `retire` mode SHOULD be preferred over physical delete.
- `hard-delete` should be restricted to orphan / erroneous accounts with no business references.

### Success response
**200 OK**
```json
{
  "data": {
    "id": "usr_123",
    "mode": "retire",
    "removedFromActiveList": true,
    "dependencyCheckPassed": true,
    "processedAt": "2026-04-22T09:50:00Z"
  },
  "message": "Account removal completed"
}
```

### Main tables touched
- `users`
- `audit_logs`
- indirect dependency checks against `meetings`, `meeting_participants`, and other user-owned business data

### Events published
- `account.removal_completed`

### Error codes
- `ACCOUNT_NOT_FOUND`
- `SELF_DELETE_NOT_ALLOWED`
- `ACCOUNT_HAS_ACTIVE_DEPENDENCIES`
- `HARD_DELETE_NOT_ALLOWED`
- `INVALID_DELETE_MODE`

## 18. Validation Summary

### 18.1 Identity validation
- `username` unique, format-safe, no whitespace
- `email` unique, valid email format
- `employeeCode` unique when present

### 18.2 Profile validation
- avatar: `.jpg`, `.jpeg`, `.png`, maximum 5 MB
- `phoneNumber`: valid phone format
- `bio`: configurable max length

### 18.3 Status validation
- deactivate requires reason
- self-deactivate forbidden
- self-delete forbidden

### 18.4 Face profile validation
- explicit consent required
- minimum sample count required
- image format and quality validation required

## 19. Security and Privacy Notes
- Password hashes, raw passwords, reset tokens, refresh tokens, and biometric feature vectors are never exposed via response payloads.
- Face profile responses should expose metadata only, not raw biometric vectors.
- Audit logging is mandatory for privileged actions.
- Authorization must be enforced at endpoint and record-access level.

## 20. Suggested HTTP Status Mapping
- `200 OK`: successful read / update / status change / delete
- `201 Created`: successful creation or face enrollment
- `400 Bad Request`: validation error
- `401 Unauthorized`: missing or invalid token
- `403 Forbidden`: insufficient permission or cross-user access denied
- `404 Not Found`: account / role / department / face profile not found
- `409 Conflict`: duplicate data or existing face profile conflict
- `422 Unprocessable Entity`: dependency or business-rule violation
- `500 Internal Server Error`: unexpected server failure
- `503 Service Unavailable`: downstream AI / notification / auth dependency unavailable

## 21. Open Decisions
The following items should be finalized before implementation:
- exact ID format: UUID or bigint exposure strategy
- whether username is fully immutable after creation
- whether `DELETE` in production is always mapped to retire behavior
- whether high-privilege role assignment requires password re-confirmation
- whether avatar storage is handled directly or via pre-signed upload flow