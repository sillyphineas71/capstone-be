# Data Model: Xem chi tiết hồ sơ tài khoản

> Phase 1 output — Entities, queries, state transitions.

---

## Entities Involved

### 1. `users` (main entity)

| Field | Type | Source | Notes |
|---|---|---|---|
| `id` | UUID | `users.id` | PK |
| `employee_code` | string/null | `users.employee_code` | |
| `email` | string | `users.email` | |
| `full_name` | string | `users.full_name` | |
| `phone_number` | string/null | `users.phone_number` | |
| `avatar_url` | string/null | `users.avatar_url` | Return null if DB null |
| `position_title` | string/null | `users.position_title` | |
| `department_id` | UUID/null | `users.department_id` | FK → departments.id |
| `direct_manager_id` | UUID/null | `users.direct_manager_id` | FK → users.id (self-ref) |
| `employment_status` | enum | `users.employment_status` | active/probation/resigned/transferred |
| `account_status` | enum | `users.account_status` | active/inactive/locked/pending_reset |
| `must_change_password` | bool | `users.must_change_password` | |
| `last_login_at` | timestamptz/null | `users.last_login_at` | |
| `created_at` | timestamptz | `users.created_at` | |
| `deleted_at` | timestamptz/null | `users.deleted_at` | Soft-delete filter |

**NOT exposed**: `password_hash`, `username`, `failed_login_count`, `locked_until`, `password_updated_at`, `updated_at`.

### 2. `departments` (related via users.department_id)

| Field | Type | Source | Notes |
|---|---|---|---|
| `id` | UUID | `departments.id` | |
| `department_name` | string | `departments.department_name` | Return as `department.departmentName` |
| `parent_department_id` | UUID/null | `departments.parent_department_id` | Only needed for scope resolution |

### 3. `user_roles` (join table)

| Field | Type | Source | Notes |
|---|---|---|---|
| `user_id` | UUID | `user_roles.user_id` | |
| `role_id` | UUID | `user_roles.role_id` | |
| `is_active` | bool | `user_roles.is_active` | Filter active only |

### 4. `roles` (related via user_roles.role_id)

| Field | Type | Source | Notes |
|---|---|---|---|
| `id` | UUID | `roles.id` | |
| `role_code` | string | `roles.role_code` | |
| `role_name` | string | `roles.role_name` | |

### 5. `face_profiles` (related via face_profiles.user_id)

| Field | Type | Source | Notes |
|---|---|---|---|
| `user_id` | UUID | `face_profiles.user_id` | |
| `id` | UUID | `face_profiles.id` | Existence check = hasFaceProfile true |

---

## Query Plan

### Main query: Find user by ID (non-deleted)

```typescript
const user = await userRepo.findOne({
  where: { id: userId, deletedAt: IsNull() },
  relations: ['department'],
});
```

If `user === null` → throw `NotFoundException` with code `USER_NOT_FOUND`.

### Related queries (if not using eager/deep relations):

1. **Department**: Already loaded via `relations: ['department']`
2. **Direct Manager**: `userRepo.findOne({ where: { id: user.directManagerId }, select: ['id', 'fullName'] })` if `directManagerId` is not null
3. **Active Roles**: 
```typescript
const userRoles = await userRoleRepo.find({
  where: { userId: userId, isActive: true },
  relations: ['role'],
});
```
4. **Face Profile**:
```typescript
const faceProfile = await faceProfileRepo.findOne({
  where: { userId: userId },
});
```

### Department Scope Resolution (for Business Admin)

```typescript
// Step 1: Get admin's own department
const admin = await userRepo.findOne({
  where: { id: currentUserId, deletedAt: IsNull() },
  select: ['departmentId'],
});

// Step 2: Resolve all children recursively via parentDepartmentId
async function resolveDeptScope(deptId: string): Promise<Set<string>> {
  const scope = new Set<string>();
  scope.add(deptId);
  
  const children = await deptRepo.find({
    where: { parentDepartmentId: deptId, deletedAt: IsNull(), isActive: true },
    select: ['id'],
  });
  
  for (const child of children) {
    const childScope = await resolveDeptScope(child.id);
    childScope.forEach(id => scope.add(id));
  }
  
  return scope;
}
```

**Max depth**: 5 levels (consistent with `DepartmentsService.MAX_DEPTH = 5`).

---

## Response DTO

```typescript
class DepartmentInfoDto {
  id: string;
  departmentName: string;
}

class DirectManagerInfoDto {
  id: string;
  fullName: string;
}

class RoleInfoDto {
  id: string;
  roleCode: string;
  roleName: string;
}

class UserDetailResponseDto {
  id: string;
  employeeCode: string | null;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  positionTitle: string | null;
  department: DepartmentInfoDto | null;
  directManager: DirectManagerInfoDto | null;
  accountStatus: string;
  employmentStatus: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;       // ISO-8601
  roles: RoleInfoDto[];
  hasFaceProfile: boolean;
  createdAt: string;                 // ISO-8601
}
```

---

## Audit Log Entry

Upon successful access:

| Field | Value |
|---|---|
| `actionType` | `view_detail` |
| `entityType` | `users` |
| `entityId` | target user's UUID |
| `userId` | authenticated user's UUID (actor) |
| `severity` | `info` |
| `newValueJson` | `{ "actorId": "...", "targetId": "...", "timestamp": "..." }` |

---

## State Transitions

Không có state transition nào trong feature này — feature là **read-only** (FR-005, OOS-001).

---

## Data Constraints Summary

| Constraint | Enforcement |
|---|---|
| UUID format for userId | `ParseUUIDPipe` at controller level |
| User must exist & not soft-deleted | `deletedAt: IsNull()` in WHERE |
| Only active roles returned | `isActive: true` in user_roles query |
| Face profile may not exist | `findOne` returns null → `hasFaceProfile = false` |
| Department scope depth ≤ 5 | Recursion guard (same as existing) |
