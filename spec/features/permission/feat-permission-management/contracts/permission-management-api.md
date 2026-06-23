## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-23 | Sửa lỗi chính tả oleId thành roleId | 151, 186, 238 |
| 2026-06-23 | API contract cho Permission Management feature | Toàn bộ file |

---

# API Contract: Permission Management

**Base URL**: /api/v1
**Auth**: JWT Bearer token (all endpoints)
**Response Format**: { success: boolean, message: string, data: T, meta?: object }
**Error Format**: { success: false, message: string, error: { code: string, details?: object }, timestamp: string, path: string }

---

## Endpoints

### 1. List Permissions

`
GET /api/v1/permissions
`

**Query Parameters**:

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| page | number | No | 1 | Page number (>= 1) |
| limit | number | No | 20 | Items per page (1-100) |
| sortBy | string | No | createdAt | Sort field (allowlist: createdAt, permissionCode, permissionName, moduleCode) |
| sortOrder | string | No | desc | asc or desc |
| moduleCode | string | No | — | Filter by exact moduleCode |
| search | string | No | — | Search permissionCode or permissionName (ILIKE) |

**Response 200**:
`json
{
  "success": true,
  "message": "Danh sách permission",
  "data": [
    {
      "id": "uuid",
      "permissionCode": "meetings.create",
      "permissionName": "Create Meeting",
      "moduleCode": "meetings",
      "actionCode": "create",
      "description": "Permission to create meetings",
      "isActive": true,
      "createdAt": "2026-06-23T10:00:00.000Z",
      "updatedAt": "2026-06-23T10:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 125, "totalPages": 7 }
}
`

### 2. Get Permission Detail

`
GET /api/v1/permissions/:id
`

**Path Parameters**: id — UUID của permission

**Response 200**: Single PermissionResponseDto (same structure as list item)

**Error 404**: { "error": { "code": "PERMISSION_NOT_FOUND" } }

### 3. Create Permission

`
POST /api/v1/permissions
`

**Request Body**:
`json
{
  "permissionCode": "meetings.create",
  "permissionName": "Create Meeting",
  "moduleCode": "meetings",
  "actionCode": "create",
  "description": "Permission to create new meetings"
}
`

**Validation Rules**:
- permissionCode: required, regex ^[a-z0-9_]+(\.[a-z0-9_]+)+$, max 120, unique
- permissionName: required, max 150
- moduleCode: required, max 80, must be in allowlist
- actionCode: required, max 80

**Response 201**: Single PermissionResponseDto (isActive = true)

**Error 400**: { "error": { "code": "INVALID_PERMISSION_CODE_FORMAT" } }
**Error 400**: { "error": { "code": "INVALID_MODULE_CODE" } }
**Error 409**: { "error": { "code": "PERMISSION_CODE_DUPLICATE" } }

### 4. Update Permission

`
PATCH /api/v1/permissions/:id
`

**Path Parameters**: id — UUID của permission

**Request Body**:
`json
{
  "permissionName": "Updated Name",
  "description": "Updated description"
}
`

**Validation Rules**:
- Only permissionName and description allowed
- permissionName: optional, max 150
- description: optional, text
- permissionCode, moduleCode, actionCode: NOT ALLOWED to update

**Response 200**: Single PermissionResponseDto

**Error 404**: PERMISSION_NOT_FOUND
**Error 400**: VALIDATION_ERROR (if permissionCode sent in body)

### 5. Toggle Permission Active Status

`
POST /api/v1/permissions/:id/toggle-active
`

**Path Parameters**: id — UUID của permission

**Response 200**:
`json
{
  "success": true,
  "message": "Permission status toggled successfully",
  "data": { "isActive": false }
}
`

**Error 404**: PERMISSION_NOT_FOUND

### 6. List Role Permissions

`
GET /api/v1/roles/:roleId/permissions
`

**Path Parameters**: roleId — UUID của role

**Response 200**:
`json
{
  "success": true,
  "message": "Danh sách permission của role",
  "data": [
    {
      "id": "uuid",
      "roleId": "uuid",
      "permissionId": "uuid",
      "grantedBy": "uuid",
      "grantedAt": "2026-06-23T10:00:00.000Z",
      "permission": {
        "id": "uuid",
        "permissionCode": "meetings.create",
        "permissionName": "Create Meeting",
        "moduleCode": "meetings",
        "actionCode": "create",
        "isActive": true
      }
    }
  ]
}
`

**Error 404**: ROLE_NOT_FOUND

### 7. Assign Permissions to Role

`
POST /api/v1/roles/:roleId/permissions
`

**Path Parameters**: roleId — UUID của role

**Request Body**:
`json
{
  "permissionIds": ["uuid1", "uuid2", "uuid3"]
}
`

**Validation Rules**:
- permissionIds: array of UUIDs, min 1 item, all must be valid UUIDs

**Business Logic**:
- Fatal errors (rollback): roleId not found (404), any permissionId not found (404), any permission inactive (422), DB error (500)
- Non-fatal (skip, no rollback): permission already assigned, permission duplicated in request body

**Response 201** (when at least 1 new assignment created):
`json
{
  "success": true,
  "message": "Permissions assigned successfully",
  "data": {
    "assigned": ["uuid1"],
    "skippedAlreadyAssigned": ["uuid2"],
    "skippedDuplicatedInRequest": ["uuid3"]
  }
}
`

**Response 200** (when all skipped, no-op):
`json
{
  "success": true,
  "message": "No new permissions to assign (all skipped)",
  "data": {
    "assigned": [],
    "skippedAlreadyAssigned": ["uuid1", "uuid2"],
    "skippedDuplicatedInRequest": ["uuid3"]
  }
}
`

**Error 404**: ROLE_NOT_FOUND / PERMISSION_NOT_FOUND
**Error 422**: PERMISSION_INACTIVE

### 8. Revoke Permission from Role

`
DELETE /api/v1/roles/:roleId/permissions/:permissionId
`

**Path Parameters**:
- roleId — UUID của role
- permissionId — UUID của permission

**Business Logic**:
- Check roleId exists (404 ROLE_NOT_FOUND)
- Check role_permission exists (404 PERMISSION_NOT_ASSIGNED)
- Check system role protection: if role.isSystemRole AND permission.moduleCode === 'admin' → 422 CANNOT_REVOKE_SYSTEM_PERMISSION

**Response 200**:
`json
{
  "success": true,
  "message": "Permission revoked from role successfully"
}
`

**Error 404**: ROLE_NOT_FOUND / PERMISSION_NOT_ASSIGNED
**Error 422**: CANNOT_REVOKE_SYSTEM_PERMISSION

---

## Common Error Codes Summary

| HTTP | Error Code | Condition |
|---|---|---|
| 401 | UNAUTHORIZED | Missing/invalid/expired JWT |
| 403 | FORBIDDEN | Missing admin.manage_permissions |
| 400 | VALIDATION_ERROR | class-validator failures |
| 400 | INVALID_PERMISSION_CODE_FORMAT | Regex mismatch |
| 400 | INVALID_MODULE_CODE | Not in allowlist |
| 404 | PERMISSION_NOT_FOUND | permissionId not exist |
| 404 | ROLE_NOT_FOUND | roleId not exist |
| 404 | PERMISSION_NOT_ASSIGNED | Permission not assigned to role |
| 409 | PERMISSION_CODE_DUPLICATE | Duplicate permissionCode |
| 422 | PERMISSION_INACTIVE | Permission isActive = false |
| 422 | CANNOT_REVOKE_SYSTEM_PERMISSION | Revoke admin permission from system role |
| 500 | INTERNAL_ERROR | Unexpected server error |
