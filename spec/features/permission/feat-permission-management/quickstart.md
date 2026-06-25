## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-23 | Quickstart test scenarios cho Permission Management feature | Toàn bộ file |

---

# Quickstart: Permission Catalog & Role-Permission Assignment

**Feature**: Permission Catalog & Role-Permission Assignment
**Spec**: spec/features/permission/feat-permission-management/spec.md

---

## Test Scenarios

### 1. Permission CRUD Happy Path

`	ext
PREREQ: JWT token với user có admin.manage_permissions
1. POST /api/v1/permissions  →  body: { permissionCode: "meetings.create", permissionName: "Create Meeting", moduleCode: "meetings", actionCode: "create" }
   → Expect: 201, isActive = true, id returned
2. GET /api/v1/permissions    →  Expect: 200, list contains the new permission
3. GET /api/v1/permissions/:id  →  Expect: 200, same data as created
4. PATCH /api/v1/permissions/:id  →  body: { permissionName: "Updated Name" }
   → Expect: 200, permissionName updated
5. POST /api/v1/permissions/:id/toggle-active  →  Expect: 200, isActive = false
6. POST /api/v1/permissions/:id/toggle-active  →  Expect: 200, isActive = true
`

**Verify**: permissionCode unique, isActive default true, toggle flips state

### 2. Permission CRUD Error Cases

`	ext
PREREQ: JWT với admin.manage_permissions
1. POST /api/v1/permissions  →  body: { permissionCode: "invalid" } (no dot)
   → Expect: 400, INVALID_PERMISSION_CODE_FORMAT
2. POST /api/v1/permissions  →  body: { permissionCode: "meetings.create", ... } (duplicate code)
   → Expect: 409, PERMISSION_CODE_DUPLICATE
3. POST /api/v1/permissions  →  body: { moduleCode: "nonexistent" }
   → Expect: 400, INVALID_MODULE_CODE
4. PATCH /api/v1/permissions/:id  →  body: { permissionCode: "new.code" }
   → Expect: 400, VALIDATION_ERROR (code không được sửa)
`

### 3. Role-Permission Assignment Happy Path

`	ext
PREREQ: JWT admin + existing role (id=ROLE_ID) + existing permissions (PID1, PID2)
1. POST /api/v1/roles/:roleId/permissions  →  body: { permissionIds: [PID1, PID2] }
   → Expect: 201, assigned: [PID1, PID2]
2. GET /api/v1/roles/:roleId/permissions  →  Expect: 200, 2 items
3. DELETE /api/v1/roles/:roleId/permissions/:PID1  →  Expect: 200
4. GET /api/v1/roles/:roleId/permissions  →  Expect: 200, 1 item
`

### 4. Role-Permission Bulk Assign — Fatal Error

`	ext
PREREQ: JWT admin
1. POST /api/v1/roles/:roleId/permissions  →  body: { permissionIds: ["nonexistent-uuid"] }
   → Expect: 404, PERMISSION_NOT_FOUND (rollback, no records created)
2. POST /api/v1/roles/:roleId/permissions  →  body with inactive permission id
   → Expect: 422, PERMISSION_INACTIVE (rollback)
`

### 5. Role-Permission Bulk Assign — Non-fatal Skip

`	ext
PREREQ: JWT admin, role=R1, permission=P1 đã gán cho R1
1. POST /api/v1/roles/:roleId/permissions  →  body: { permissionIds: [P1, P1] }
   → Expect: 201, assigned: [], skippedAlreadyAssigned: [P1], skippedDuplicatedInRequest: [P1]
`

### 6. System Role Protection

`	ext
PREREQ: JWT admin, role có is_system_role=true, permission admin.manage_permissions
1. DELETE /api/v1/roles/:systemRoleId/permissions/:adminPermissionId
   → Expect: 422, CANNOT_REVOKE_SYSTEM_PERMISSION
2. DELETE /api/v1/roles/:systemRoleId/permissions/:meetingPermissionId
   → Expect: 200 (permission nghiệp vụ vẫn gỡ được)
`

### 7. Authorization

`	ext
1. Any endpoint without JWT → Expect: 401, UNAUTHORIZED
2. GET /api/v1/permissions with expired JWT → Expect: 401, TOKEN_EXPIRED
3. POST /api/v1/permissions with JWT lacking admin.manage_permissions → Expect: 403, FORBIDDEN
`

### 8. Audit Log

`	ext
1. Create permission → Check audit_logs table: actionType = 'CREATE_PERMISSION'
2. Bulk assign → Check audit_logs: actionType = 'ASSIGN_PERMISSION', metadataJson chứa assigned/skipped lists
`

---

## Verification Checklist

- [ ] Permission code format validation works (regex)
- [ ] moduleCode allowlist validation works
- [ ] Duplicate permissionCode returns 409
- [ ] Immutable permissionCode enforced on update
- [ ] isActive toggle works both ways
- [ ] Bulk assign creates records in transaction
- [ ] Fatal errors in bulk assign rollback all changes
- [ ] Non-fatal skips continue processing
- [ ] All-skipped returns 200 (not 201)
- [ ] System role cannot revoke admin module permissions
- [ ] System role CAN revoke non-admin module permissions
- [ ] Audit logs written for all write operations
- [ ] Audit log contains userId, actionType, entityType, entityId
- [ ] Unauthenticated requests return 401
- [ ] Non-admin requests return 403 for write endpoints
- [ ] GET endpoints work with permission.read or admin.manage_permissions
