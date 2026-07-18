## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Data model cho Role Management feature | Toàn bộ file |

---

# Data Model: Role Management (RolesService + RolesController)

## Entities

### RoleEntity (roles) — đọc/ghi

| Field | Type | Length | Required | Default | Notes |
|---|---|---|---|---|---|
| id | uuid (PK) | — | Yes | uuid v4 (`@PrimaryGeneratedColumn('uuid')`) | |
| roleCode | varchar | 50 | Yes | — | Nên UNIQUE (application-level check, DB chưa có constraint). Regex: `^[A-Z][A-Z0-9_]{1,49}$` |
| roleName | varchar | 100 | Yes | — | Display name |
| description | text | — | No | null | |
| isSystemRole | boolean | — | No | false | Immutable qua API — không tạo/sửa được thành true qua feature này |
| isActive | boolean | — | No | true | |
| createdAt | timestamptz | — | No | now() | |
| updatedAt | timestamptz | — | No | now() | |

**Indexes hiện tại**: Không có UNIQUE/INDEX bổ sung ngoài PK (theo `role.entity.ts` hiện trạng — giống `PermissionEntity`, không thuộc scope thêm migration).

### UserRoleEntity (user_roles) — chỉ đọc

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| userId | uuid (FK → users.id) | |
| roleId | uuid (FK → roles.id) | Dùng để COUNT active assignment |
| assignedBy | uuid/null (FK → users.id) | |
| assignedAt | timestamptz | |
| expiredAt | timestamptz/null | |
| isActive | boolean | default true — dùng trong điều kiện COUNT |
| metadataJson | jsonb/null | |

### RolePermissionEntity (role_permissions) — không chạm

Không đọc/ghi trong feature này. Đã xử lý đầy đủ bởi `RolePermissionsController`/`RolePermissionsService` hiện có.

### AuditLogEntity (audit_logs) — chỉ ghi

| Field | Type | Notes |
|---|---|---|
| id | uuid | PK |
| userId | uuid/null | Actor |
| actionType | varchar(80) | CREATE_ROLE, UPDATE_ROLE, DELETE_ROLE |
| entityType | varchar(80) | role |
| entityId | uuid/null | Target role ID |
| oldValueJson | jsonb/null | Cho update/delete |
| newValueJson | jsonb/null | Cho create/update |
| ipAddress | varchar(100)/null | |
| userAgent | text/null | |
| requestId | varchar(120)/null | |
| severity | varchar(20) | info |
| metadataJson | jsonb/null | |
| createdAt | timestamptz | Auto |

---

## State Transitions

### Role.isActive

```
  [true] ──PATCH isActive=false──→ [false]   (chặn nếu role.isSystemRole = true)
  [false] ──PATCH isActive=true──→ [true]
  [true] ──DELETE /roles/:id──→ [false]        (chặn nếu isSystemRole=true HOẶC đang gán active cho user)
```

### Role.isSystemRole

Không có state machine — cố định `false` tại thời điểm tạo qua API này; không đổi được qua Role Management feature (thay đổi chỉ có thể qua migration/seed, ngoài scope).

---

## Business Logic Constraints

1. **roleCode UNIQUE** — không trùng trong hệ thống (application-level check trước insert).
2. **roleCode format** — uppercase snake_case, regex `^[A-Z][A-Z0-9_]{1,49}$`, tối đa 50 ký tự.
3. **roleCode immutability** — không sửa sau khi tạo (không nằm trong UpdateRoleDto; nếu client cố gửi → 400 VALIDATION_ERROR).
4. **isSystemRole immutability** — không set được `true` qua Create; không sửa được qua Update (không nằm trong UpdateRoleDto; nếu client cố gửi → 400 VALIDATION_ERROR).
5. **System role protection (deactivate)**: `role.isSystemRole=true` + PATCH `isActive=false` → 422 CANNOT_MODIFY_SYSTEM_ROLE.
6. **System role protection (delete)**: `role.isSystemRole=true` + DELETE → 422 CANNOT_DELETE_SYSTEM_ROLE.
7. **Role-in-use protection**: DELETE chỉ thành công khi `COUNT(user_roles WHERE role_id=:id AND is_active=true) = 0`, ngược lại → 409 ROLE_IN_USE.
8. **Thứ tự kiểm tra khi DELETE**: (1) role tồn tại (404 nếu không) → (2) isSystemRole check (422) → (3) role-in-use check (409) → chỉ khi cả 3 pass mới set `isActive=false`.
9. **Audit log**: ghi sau khi thao tác DB thành công, dùng `AuditLogsService`, không raw insert.
10. **assignedUserCount** (chỉ ở GET detail): `COUNT(user_roles WHERE role_id=:id AND is_active=true)` — tính real-time tại thời điểm request, không cache/denormalize.
