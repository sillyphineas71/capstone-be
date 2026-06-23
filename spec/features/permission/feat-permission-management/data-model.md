## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-23 | Data model cho Permission Management feature | Toàn bộ file |

---

# Data Model: Permission Catalog & Role-Permission Assignment

## Entities

### PermissionEntity (permissions)

| Field | Type | Length | Required | Default | Notes |
|---|---|---|---|---|---|
| id | uuid (PK) | — | Yes | gen_random_uuid() | |
| permissionCode | varchar | 120 | Yes | — | UNIQUE. Regex: ^[a-z0-9_]+(\.[a-z0-9_]+)+$ |
| permissionName | varchar | 150 | Yes | — | Display name |
| moduleCode | varchar | 80 | Yes | — | Validate theo allowlist |
| actionCode | varchar | 80 | Yes | — | Action name |
| description | text | — | No | null | |
| isActive | boolean | — | No | true | |
| createdAt | timestamptz | — | No | now() | |
| updatedAt | timestamptz | — | No | now() | |

**Indexes**: UNIQUE on permissionCode, INDEX on moduleCode, INDEX on isActive

### RolePermissionEntity (role_permissions)

| Field | Type | Length | Required | Default | Notes |
|---|---|---|---|---|---|
| id | uuid (PK) | — | Yes | gen_random_uuid() | |
| roleId | uuid (FK → roles.id) | — | Yes | — | ON DELETE CASCADE |
| permissionId | uuid (FK → permissions.id) | — | Yes | — | ON DELETE CASCADE |
| grantedBy | uuid (FK → users.id) | — | No | null | ON DELETE SET NULL |
| grantedAt | timestamptz | — | No | now() | |

**Indexes**: INDEX on roleId, INDEX on permissionId, INDEX on (roleId, permissionId)

### RoleEntity (roles) — chỉ đọc

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| roleCode | varchar(50) | Unique |
| roleName | varchar(100) | Display name |
| isSystemRole | boolean | default false |
| isActive | boolean | default true |

### AuditLogEntity (audit_logs) — chỉ ghi

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| userId | uuid/null | Actor |
| actionType | varchar(80) | CREATE_PERMISSION, ASSIGN_PERMISSION, etc. |
| entityType | varchar(80) | permission, role_permission |
| entityId | uuid/null | Target entity ID |
| oldValueJson | jsonb/null | For update/toggle |
| newValueJson | jsonb/null | For create/update/toggle |
| ipAddress | varchar(100)/null | Client IP |
| userAgent | text/null | Client UA |
| requestId | varchar(120)/null | Trace ID |
| severity | varchar(20) | info |
| metadataJson | jsonb/null | Extra context |
| createdAt | timestamptz | Auto |

---

## State Transitions

### Permission.isActive

`
  [true] ──toggle-active──→ [false]
  [false] ──toggle-active──→ [true]
`

### Role-Permission Assignment

Không có state machine riêng — mỗi bản ghi role_permission được tạo (assign) hoặc xóa (revoke).

---

## Business Logic Constraints

1. **permissionCode UNIQUE** — không trùng trong hệ thống
2. **permissionCode immutability** — không sửa sau khi tạo
3. **moduleCode allowlist** — 23 module codes predefined
4. **Bulk assign fatal**: roleId/permissionId not found → rollback; permission inactive → rollback
5. **Bulk assign non-fatal**: duplicate/permission already assigned → skip, không rollback
6. **System role protection**: role.isSystemRole=true + permission.moduleCode='admin' → không gỡ
7. **Inactive permission**: không gán mới cho role
8. **Audit log**: ghi sau transaction success
