## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | API contract cho Role Management feature | Toàn bộ file |

---

# API Contract: Role Management

**Base URL**: /api/v1
**Auth**: JWT Bearer token (all endpoints)
**Response Format**: { success: boolean, message: string, data: T, meta?: object }
**Error Format**: { success: false, message: string, error: { code: string, details?: object }, timestamp: string, path: string }

---

## Endpoints

### 1. List Roles

```
GET /api/v1/roles
```

**Permission**: `account.role.read`

**Query Parameters**:

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| page | number | No | 1 | Page number (>= 1) |
| limit | number | No | 20 | Items per page (1-100) |
| sortBy | string | No | createdAt | Sort field (allowlist: createdAt, roleCode, roleName) |
| sortOrder | string | No | desc | asc or desc |
| isActive | boolean | No | — | Filter theo trạng thái active |
| search | string | No | — | Search roleCode hoặc roleName (ILIKE) |

**Response 200**:
```json
{
  "success": true,
  "message": "Danh sách role",
  "data": [
    {
      "id": "uuid",
      "roleCode": "ROOM_COORDINATOR",
      "roleName": "Room Coordinator",
      "description": "Quản lý đặt phòng và thiết bị theo khu vực",
      "isSystemRole": false,
      "isActive": true,
      "createdAt": "2026-07-18T10:00:00.000Z",
      "updatedAt": "2026-07-18T10:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 8, "totalPages": 1 }
}
```

### 2. Get Role Detail

```
GET /api/v1/roles/:id
```

**Permission**: `account.role.read`

**Path Parameters**: id — UUID của role

**Response 200**:
```json
{
  "success": true,
  "message": "Chi tiết role",
  "data": {
    "id": "uuid",
    "roleCode": "ROOM_COORDINATOR",
    "roleName": "Room Coordinator",
    "description": "Quản lý đặt phòng và thiết bị theo khu vực",
    "isSystemRole": false,
    "isActive": true,
    "assignedUserCount": 3,
    "createdAt": "2026-07-18T10:00:00.000Z",
    "updatedAt": "2026-07-18T10:00:00.000Z"
  }
}
```

**Error 404**: `{ "error": { "code": "ROLE_NOT_FOUND" } }`

### 3. Create Role

```
POST /api/v1/roles
```

**Permission**: `account.role.create`

**Request Body**:
```json
{
  "roleCode": "ROOM_COORDINATOR",
  "roleName": "Room Coordinator",
  "description": "Quản lý đặt phòng và thiết bị theo khu vực"
}
```

**Validation Rules**:
- roleCode: required, regex `^[A-Z][A-Z0-9_]{1,49}$`, max 50, unique
- roleName: required, max 100
- description: optional, text
- isSystemRole: KHÔNG được gửi (không có trong DTO) — luôn mặc định `false`

**Response 201**: Single RoleResponseDto (isActive = true, isSystemRole = false)

**Error 400**: `{ "error": { "code": "INVALID_ROLE_CODE_FORMAT" } }`
**Error 409**: `{ "error": { "code": "ROLE_CODE_DUPLICATE" } }`

### 4. Update Role

```
PATCH /api/v1/roles/:id
```

**Permission**: `account.role.update`

**Path Parameters**: id — UUID của role

**Request Body**:
```json
{
  "roleName": "Updated Name",
  "description": "Updated description",
  "isActive": false
}
```

**Validation Rules**:
- Chỉ chấp nhận roleName, description, isActive
- roleName: optional, max 100
- description: optional, text
- isActive: optional, boolean
- roleCode, isSystemRole: KHÔNG ĐƯỢC PHÉP cập nhật — nếu có trong body → 400 VALIDATION_ERROR
- Nếu `isActive=false` VÀ role hiện tại có `isSystemRole=true` → 422 CANNOT_MODIFY_SYSTEM_ROLE

**Response 200**: Single RoleResponseDto

**Error 404**: ROLE_NOT_FOUND
**Error 400**: VALIDATION_ERROR (nếu body chứa roleCode/isSystemRole)
**Error 422**: CANNOT_MODIFY_SYSTEM_ROLE

### 5. Delete Role (soft-delete)

```
DELETE /api/v1/roles/:id
```

**Permission**: `account.role.delete`

**Path Parameters**: id — UUID của role

**Business Logic** (thứ tự kiểm tra bắt buộc):
1. Role tồn tại? Không → 404 ROLE_NOT_FOUND
2. `role.isSystemRole === true`? Có → 422 CANNOT_DELETE_SYSTEM_ROLE
3. `COUNT(user_roles WHERE role_id=:id AND is_active=true) > 0`? Có → 409 ROLE_IN_USE
4. Ngược lại → set `isActive = false`, ghi audit log

**Response 200**:
```json
{
  "success": true,
  "message": "Role đã được xóa (vô hiệu hóa) thành công"
}
```

**Error 404**: ROLE_NOT_FOUND
**Error 422**: CANNOT_DELETE_SYSTEM_ROLE
**Error 409**: ROLE_IN_USE

---

## Endpoints không đổi (tham chiếu — KHÔNG thuộc phạm vi implement của feature này)

### 6. Role-Permission Assignment (giữ nguyên)

```
GET    /api/v1/roles/:roleId/permissions
POST   /api/v1/roles/:roleId/permissions
DELETE /api/v1/roles/:roleId/permissions/:permissionId
```

**Permission**: `admin.manage_permissions` — xem [permission-management-api.md](../../../permission/feat-permission-management/contracts/permission-management-api.md) mục 6-8.

### 7. User-Role Assignment / UC-08 (giữ nguyên)

```
PUT /api/v1/users/:userId/roles
```

**Permission thật**: `accounts.user.update_roles` (không phải `account.role.update` như suy đoán ban đầu — xem spec.md §0.1). Body: `{ "roleIds": ["<uuid>", ...] }` (replace-set toàn bộ tập role của user).

---

## Common Error Codes Summary

| HTTP | Error Code | Condition |
|---|---|---|
| 401 | UNAUTHORIZED | Missing/invalid/expired JWT |
| 403 | FORBIDDEN | Missing account.role.create/read/update/delete tương ứng |
| 400 | VALIDATION_ERROR | class-validator failures hoặc gửi roleCode/isSystemRole trong PATCH |
| 400 | INVALID_ROLE_CODE_FORMAT | Regex mismatch |
| 404 | ROLE_NOT_FOUND | roleId not exist |
| 409 | ROLE_CODE_DUPLICATE | Duplicate roleCode |
| 409 | ROLE_IN_USE | Role đang được gán active cho user, không xóa được |
| 422 | CANNOT_DELETE_SYSTEM_ROLE | DELETE lên role có isSystemRole=true |
| 422 | CANNOT_MODIFY_SYSTEM_ROLE | PATCH isActive=false lên role có isSystemRole=true |
| 500 | INTERNAL_ERROR | Unexpected server error |
