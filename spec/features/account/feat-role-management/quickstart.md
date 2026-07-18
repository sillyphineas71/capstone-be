## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Quickstart test scenarios cho Role Management feature | Toàn bộ file |

---

# Quickstart: Role Management (RolesService + RolesController)

**Feature**: Role Management
**Spec**: spec/features/account/feat-role-management/spec.md

---

## Test Scenarios

### 1. Role CRUD Happy Path

```text
PREREQ: JWT token với user có đủ account.role.create/read/update/delete
1. POST /api/v1/roles  →  body: { roleCode: "ROOM_COORDINATOR", roleName: "Room Coordinator" }
   → Expect: 201, isActive=true, isSystemRole=false, id returned
2. GET /api/v1/roles    →  Expect: 200, list contains the new role
3. GET /api/v1/roles/:id  →  Expect: 200, same data as created, assignedUserCount=0
4. PATCH /api/v1/roles/:id  →  body: { roleName: "Updated Name" }
   → Expect: 200, roleName updated
5. PATCH /api/v1/roles/:id  →  body: { isActive: false }
   → Expect: 200, isActive=false (role không phải system role)
6. DELETE /api/v1/roles/:id  →  Expect: 200 (role không còn user active nào gán)
```

**Verify**: roleCode unique, isActive/isSystemRole default đúng, update chỉ đổi field cho phép, delete là soft-delete

### 2. Role CRUD Error Cases

```text
PREREQ: JWT với account.role.create
1. POST /api/v1/roles  →  body: { roleCode: "room_coordinator" } (chữ thường)
   → Expect: 400, INVALID_ROLE_CODE_FORMAT
2. POST /api/v1/roles  →  body: { roleCode: "ROOM_COORDINATOR", ... } (roleCode đã tồn tại)
   → Expect: 409, ROLE_CODE_DUPLICATE
3. PATCH /api/v1/roles/:id  →  body: { roleCode: "NEW_CODE" }
   → Expect: 400, VALIDATION_ERROR (roleCode không được sửa)
4. PATCH /api/v1/roles/:id  →  body: { isSystemRole: true }
   → Expect: 400, VALIDATION_ERROR (isSystemRole không được sửa)
```

### 3. System Role Protection

```text
PREREQ: JWT admin, role SYSTEM_ADMIN có isSystemRole=true
1. DELETE /api/v1/roles/:systemRoleId
   → Expect: 422, CANNOT_DELETE_SYSTEM_ROLE
2. PATCH /api/v1/roles/:systemRoleId  →  body: { isActive: false }
   → Expect: 422, CANNOT_MODIFY_SYSTEM_ROLE
3. PATCH /api/v1/roles/:systemRoleId  →  body: { roleName: "System Administrator (renamed)" }
   → Expect: 200 (đổi tên/mô tả vẫn được phép, chỉ chặn roleCode/isSystemRole/deactivate)
```

### 4. Role-in-use Protection

```text
PREREQ: JWT admin, role R1 (không system role) đang được gán active cho ít nhất 1 user (qua PUT /users/:userId/roles)
1. DELETE /api/v1/roles/:R1
   → Expect: 409, ROLE_IN_USE
2. (Gỡ role R1 khỏi user đó qua PUT /users/:userId/roles với roleIds không còn R1)
3. DELETE /api/v1/roles/:R1
   → Expect: 200 (không còn user active nào gán)
```

### 5. Authorization

```text
1. Any endpoint without JWT → Expect: 401, UNAUTHORIZED
2. GET /api/v1/roles with expired JWT → Expect: 401, TOKEN_EXPIRED
3. POST /api/v1/roles with JWT lacking account.role.create → Expect: 403, FORBIDDEN
4. GET /api/v1/roles with JWT lacking account.role.read → Expect: 403, FORBIDDEN
```

### 6. Audit Log

```text
1. Create role → Check audit_logs table: actionType = 'CREATE_ROLE', entityType='role'
2. Update role → Check audit_logs: actionType = 'UPDATE_ROLE', oldValueJson/newValueJson chứa diff
3. Delete role → Check audit_logs: actionType = 'DELETE_ROLE', oldValueJson.isActive=true, newValueJson.isActive=false
```

### 7. Endpoints không đổi (regression check — đảm bảo feature này không phá vỡ)

```text
1. GET/POST/DELETE /api/v1/roles/:roleId/permissions vẫn hoạt động đúng như trước (RolePermissionsController không đổi)
2. PUT /api/v1/users/:userId/roles vẫn hoạt động đúng như trước, vẫn dùng permission accounts.user.update_roles (UsersController không đổi)
```

---

## Verification Checklist

- [ ] roleCode format validation works (regex uppercase snake)
- [ ] Duplicate roleCode returns 409
- [ ] Immutable roleCode/isSystemRole enforced on update (400)
- [ ] Role tạo mới luôn isSystemRole=false dù client không gửi field này
- [ ] isActive toggle works both ways cho role thường
- [ ] System role không deactivate được qua PATCH (422 CANNOT_MODIFY_SYSTEM_ROLE)
- [ ] System role không xóa được (422 CANNOT_DELETE_SYSTEM_ROLE)
- [ ] Role đang gán active cho user không xóa được (409 ROLE_IN_USE)
- [ ] Role không còn user active gán thì xóa được (200)
- [ ] GET detail trả đúng assignedUserCount
- [ ] Audit logs được ghi cho create/update/delete
- [ ] Unauthenticated requests return 401
- [ ] Thiếu permission tương ứng trả về 403
- [ ] RolePermissionsController và PUT /users/:userId/roles không bị ảnh hưởng (regression)
