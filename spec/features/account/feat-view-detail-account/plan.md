# Implementation Plan: Xem chi tiết hồ sơ tài khoản

> Feature ID: UC-AM-10 (UC-15 API Contract)
> Module: accounts
> Created: 2026-06-08
> Status: Draft

---

## 1. Feature Summary

Tính năng cho phép **Business Admin** và **System Admin** xem chi tiết toàn bộ hồ sơ của một tài khoản nhân sự ở chế độ read-only. Dữ liệu được tổng hợp từ 5 bảng: `users`, `departments`, `user_roles`, `roles`, `face_profiles`. Endpoint trả về HTTP 200 với 17 fields. Yêu cầu JWT + permission `account.user.read.detail`. Business Admin bị giới hạn department scope (tự thân + child departments). System Admin không bị giới hạn scope. Self-view bypass department scope. Ghi audit log khi thành công.

---

## 2. Technical Context

### 2.1 Stack hiện tại

| Layer | Technology | Ghi chú |
|---|---|---|
| Framework | NestJS (modular monolith) | AccountsModule, AuthModule, AdministrationModule |
| ORM | TypeORM | Entity + Repository pattern |
| Auth | JWT (access token) + RBAC | JwtAuthGuard + PermissionsGuard |
| Database | PostgreSQL (UUID PK, timestamptz) | 39 tables (v3.2 Compact) |
| Validation | class-validator + built-in pipes | ParseUUIDPipe |
| Audit | AuditLogEntity (actionType, entityType, entityId, userId) | AdministrationModule |

### 2.2 Module dependencies

```
UsersController → UsersService → DataSource (TypeORM)
                                → DepartmentEntity, UserEntity, UserRoleEntity, RoleEntity, FaceProfileEntity
                                → AuditLogEntity (AdministrationModule)

Auth layer: JwtAuthGuard → check JWT
            PermissionsGuard → check account.user.read.detail
```

### 2.3 Codebase context

- `UsersService` đã tồn tại với method `createUser()`
- `UserResponseDto` hiện tại chỉ có 7 fields — cần tạo DTO mới cho detail view
- `AccountsModule` đã import `AdministrationModule` (có thể dùng `AuditLogEntity`)
- `AuthzReadRepository` dùng cho permission check (PermissionsGuard handle)
- Không có `@CurrentUser()` decorator — dùng pattern `request['user']`

---

## 3. Scope Confirmation

### 3.1 In Scope

- GET endpoint `/api/v1/users/:userId` trả về detail profile
- Authentication: JWT token bắt buộc
- Authorization: permission `account.user.read.detail` bắt buộc
- Department scope check cho Business Admin (self + active child departments)
- Self-view bypass department scope
- Tổng hợp dữ liệu từ users, departments, user_roles, roles, face_profiles
- Audit log ghi lại khi view thành công
- DTO `UserDetailResponseDto` mới với 17 fields

### 3.2 Out of Scope (confirmed từ spec)

- Chỉnh sửa, khóa, xóa, cập nhật role/status — không implement
- Xem lịch sử hoạt động, đăng ký face profile — không implement
- UI navigation, nút Quay lại — frontend responsibility
- Tìm kiếm, filter danh sách — đã có endpoint riêng
- Thêm bảng/field mới vào database — không được phép
- AI/vector/embedding — không liên quan

### 3.3 Constitution Check

| Gate | Status | Justification |
|---|---|---|
| DB Gate | ✅ PASS | Không thêm bảng/field |
| Security Gate | ✅ PASS | Không expose sensitive fields |
| Scope Gate | ✅ PASS | Chỉ implement UC-AM-10 |
| Module Gate | ✅ PASS | AccountsModule, bounded by existing pattern |
| API Gate | ✅ PASS | Response format đúng convention |
| Auth Gate | ✅ PASS | JwtAuthGuard + PermissionsGuard |
| Test Gate | ✅ PASS | Unit test + integration test plan |

---

## 4. Data Model Impact

### 4.1 No Schema Change

Feature này **không thay đổi** database schema. Tất cả dữ liệu lấy từ 5 bảng hiện có:
- `users` — personal + account info
- `departments` — department name (via `users.department_id`)
- `user_roles` — join table (filter `isActive = true`)
- `roles` — role code + name
- `face_profiles` — existence check for `hasFaceProfile`

### 4.2 New DTO

Tạo `UserDetailResponseDto` với cấu trúc:

```typescript
class DepartmentInfoDto { id: string; departmentName: string; }
class DirectManagerInfoDto { id: string; fullName: string; }
class RoleInfoDto { id: string; roleCode: string; roleName: string; }

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
  lastLoginAt: string | null;     // ISO-8601
  roles: RoleInfoDto[];
  hasFaceProfile: boolean;
  createdAt: string;               // ISO-8601
}
```

Chi tiết xem `data-model.md`.

---

## 5. API / Contract Plan

### 5.1 Endpoint

**GET** `/api/v1/users/:userId`

### 5.2 Guards

```typescript
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('account.user.read.detail')
```

### 5.3 Validation

- `userId` validated via NestJS `ParseUUIDPipe`
- Không có request body (GET)

### 5.4 Response format

Success: `{ success: true, message, data: UserDetailResponseDto }`
Error: `{ success: false, message, error: { code, details }, timestamp, path }`

Chi tiết response codes xem `contracts/feat-view-detail-account-api.md`.

---

## 6. Authorization Plan

### 6.1 Authentication

- `JwtAuthGuard` — verify JWT token, extract `userId` from `payload.sub`
- Token blacklist check (stateless)
- User-level invalidation check (password change)

### 6.2 Permission

- `PermissionsGuard` + `@RequirePermissions('account.user.read.detail')`
- Check via `AuthzReadRepository.getEffectiveRolesAndPermissions()`

### 6.3 Department Scope (Business Admin)

- Chỉ áp dụng khi authenticated user là Business Admin
- **Không** áp dụng cho System Admin (mọi user đều accessible)

**Logic flow**:
```
1. Get authenticated user's departmentId from DB
2. If departmentId is null → scope = empty (không thể xem ai)
3. Resolve scope: deptId + all active child departments via parentDepartmentId (recursive, max 5 levels)
4. If target user's departmentId ∉ scope AND target !== self → return 403 FORBIDDEN
```

### 6.4 Self-view Bypass

- Nếu `targetUserId === authenticatedUserId` → skip department scope check
- **Không** skip permission check

### 6.5 Implementation

Logic department scope được implement trong service method (không phải guard) vì cần DB query để resolve scope. Controller sẽ gọi service method sau guard checks.

---

## 7. Business Logic Plan

### 7.1 Service Method: `getUserDetail`

```typescript
async getUserDetail(
  targetUserId: string,
  authenticatedUserId: string,
  clientContext?: UserClientContext,
): Promise<UserDetailResponseDto>
```

#### Steps:

1. **Fetch target user** (with department relation, không soft-deleted)
   - Nếu không tìm thấy → throw `NotFoundException` (`USER_NOT_FOUND`)

2. **Fetch authenticated user's role + department**
   - Cần xác định role để quyết định có check department scope không
   - Có thể check qua `user_roles` + `roles`

3. **Department scope check** (only if not System Admin AND not self-view)
   - Kiểm tra nếu authenticated user có Business Admin role
   - Resolve department scope từ department tree
   - Nếu target user ngoài scope → throw `ForbiddenException`

4. **Fetch active roles** của target user
   - Query `user_roles` với `isActive = true` + join `roles`

5. **Fetch direct manager** info (nếu `directManagerId` không null)
   - Query `users` với select `[id, fullName]`

6. **Fetch face profile** existence
   - Query `face_profiles` với `where: { userId }` — nếu có record → `hasFaceProfile = true`

7. **Assemble response** DTO

8. **Write audit log** (non-blocking try/catch)
   - actionType: `view_detail`
   - entityType: `users`
   - entityId: targetUserId

### 7.2 Read-only Guarantee

- Service method **chỉ dùng** `findOne`, `find` (SELECT operations)
- Không có `save`, `update`, `delete`, `insert` — đảm bảo FR-005

### 7.3 Transaction Boundary

- **Không cần transaction** vì feature chỉ đọc dữ liệu (read-only)
- Các query có thể chạy độc lập, partial failure trả về error (NFR-006)

---

## 8. Validation Plan

### 8.1 Input Validation

| Field | Validator | When | Error Code |
|---|---|---|---|
| `userId` | `ParseUUIDPipe` (NestJS built-in) | Controller param | `INVALID_USER_ID` (400) |

### 8.2 Business Validation

| Rule | Check Location | Error Code |
|---|---|---|
| Target user tồn tại & không soft-deleted | Service (findOne with deletedAt: IsNull()) | `USER_NOT_FOUND` (404) |
| Target user trong department scope (Business Admin) | Service (after user fetched) | `FORBIDDEN` (403) |

### 8.3 No DTO Validation (request body)

Không có request body — chỉ có path param UUID.

---

## 9. Error Handling Plan

### 9.1 Error Hierarchy

```
Controller level:
  400 INVALID_USER_ID        ← ParseUUIDPipe (NestJS)

Guard level:
  401 UNAUTHORIZED            ← JwtAuthGuard
  403 FORBIDDEN               ← PermissionsGuard (missing permission)

Service level:
  404 USER_NOT_FOUND          ← User does not exist / soft-deleted
  403 FORBIDDEN               ← Business Admin out of scope

Exception filter:
  500 INTERNAL_ERROR          ← Any unhandled error
```

### 9.2 Error Response Format

Tất cả errors dùng format thống nhất:
```json
{
  "success": false,
  "message": "Human-readable message",
  "error": { "code": "ERROR_CODE", "details": {} },
  "timestamp": "ISO-8601",
  "path": "/api/v1/users/uuid"
}
```

### 9.3 Soft-delete Handling

- Query luôn filter `deletedAt: IsNull()`
- Không tiết lộ lý do "soft-deleted" trong error message (FR-012)
- Trả về `USER_NOT_FOUND` giống như user không tồn tại

### 9.4 Partial Failure

- Nếu 1 trong các query phụ thất bại, toàn bộ request fail (NFR-006)
- Không trả về dữ liệu incomplete

### 9.5 System Error

- Ghi log server error
- Trả về 500 `INTERNAL_ERROR`
- Ghi audit log nếu có thể (NFR-007, FR-013)

---

## 10. Testing Strategy

### 10.1 Unit Tests (UsersService)

| Test Case | Description | AC |
|---|---|---|
| `getUserDetail: success (System Admin)` | System Admin xem user detail, không bị scope check | AC-001, AC-012 |
| `getUserDetail: success (Business Admin, same depth)` | Target cùng department | AC-013 |
| `getUserDetail: success (Business Admin, child depth)` | Target ở child department | AC-013 |
| `getUserDetail: success (self-view)` | targetUserId === authenticatedUserId, bypass scope | AC-014 |
| `getUserDetail: user not found` | userId không tồn tại | AC-007 |
| `getUserDetail: soft-deleted user` | user có deleted_at != null | AC-008 |
| `getUserDetail: Business Admin out of scope` | Target department ngoài scope | AC-006 |
| `getUserDetail: hasFaceProfile = false` | User không có face_profile | AC-002 |
| `getUserDetail: directManager null` | direct_manager_id = null | AC-015 |
| `getUserDetail: avatarUrl null` | avatar_url = null | AC-016 |
| `getUserDetail: avatarUrl has value` | avatar_url có giá trị | AC-017 |
| `getUserDetail: employmentStatus enum` | Kiểm tra 4 giá trị enum | AC-018 |

### 10.2 Controller Tests

| Test Case | Description | AC |
|---|---|---|
| `GET :userId success` | Happy path với guards | AC-001 |
| `GET :userId invalid UUID` | UUID sai format | AC-003 |
| `GET :userId no auth` | Không có token | AC-004 |
| `GET :userId no permission` | Thiếu permission | AC-005 |

### 10.3 Integration Tests

- Full flow: request → auth → permission → scope → query → response → audit log
- Verify no INSERT/UPDATE/DELETE occurs (AC-009, AC-010)
- Verify audit log created after success (AC-011)

### 10.4 Test Data Requirements

- System Admin user with `account.user.read.detail`
- Business Admin user with `account.user.read.detail` + department_id
- Department tree: parent + 2 children
- Target users in parent department, child department, unrelated department
- User with face_profile, user without face_profile
- User with null direct_manager, user with null avatar_url
- Soft-deleted user

---

## 11. Implementation Phases

### Phase 1: DTO & Data Layer

**Tasks:**
1. Tạo `UserDetailResponseDto` (với nested DTOs: `DepartmentInfoDto`, `DirectManagerInfoDto`, `RoleInfoDto`)
2. Export DTO từ module barrel nếu cần

**Files:** `src/modules/accounts/dto/user-detail-response.dto.ts`

### Phase 2: Service Layer

**Tasks:**
1. Thêm method `getUserDetail(targetUserId, authenticatedUserId, clientContext)` trong `UsersService`
2. Implement logic: fetch user → check scope → fetch roles/manager/face → assemble DTO
3. Implement department scope resolver (helper private method)
4. Implement audit log write (non-blocking)

**Files:** `src/modules/accounts/services/users.service.ts` (modify existing)

### Phase 3: Controller Layer

**Tasks:**
1. Thêm `@Get(':userId')` endpoint trong `UsersController`
2. Add `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('account.user.read.detail')`
3. ParseUUIDPipe cho `userId` param
4. Gọi `usersService.getUserDetail()`

**Files:** `src/modules/accounts/controllers/users.controller.ts` (modify existing)

### Phase 4: Testing

**Tasks:**
1. Viết unit test cho UsersService.getUserDetail (all scenarios)
2. Viết unit test cho controller endpoint
3. Integration test cho full flow

**Files:** 
- `src/modules/accounts/services/users.service.spec.ts` (modify existing)
- `src/modules/accounts/controllers/users.controller.spec.ts` (modify existing)

---

## 12. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| N+1 queries khi fetch roles, manager, face profile separately | Performance | Medium | Có thể dùng single query với TypeORM relations nếu performance không đạt 2s (NFR-001) |
| Department scope recursion depth có thể gây performance issue | Performance | Low | Giới hạn depth = 5 (consistent với existing code) |
| Audit log failure blocking response | Reliability | Low | Non-blocking try/catch (existing pattern) |
| Thêm method vào service khiến file quá lớn | Maintainability | Low | Service method riêng biệt, không ảnh hưởng existing code |
| Business Admin có department_id null | Business rule | Low | Fallback: scope = empty, admin không thể xem ai (đúng behavior) |

---

## 13. Acceptance Criteria Traceability

| AC ID | FR Link | Test Case | Implementation Phase |
|---|---|---|---|
| AC-001 | FR-001, FR-002, FR-004 | HP1 (System Admin full detail) | Phase 2+3 |
| AC-002 | FR-002 | HP4 (hasFaceProfile = false) | Phase 2 |
| AC-003 | ERR-001 | E1 (Invalid UUID) | Phase 3 |
| AC-004 | FR-007, ERR-002 | E2 (Unauthenticated) | Phase 3 (guard) |
| AC-005 | FR-008, ERR-003 | E3 (No permission) | Phase 3 (guard) |
| AC-006 | FR-010, ERR-006 | E4 (BA out of scope) | Phase 2 |
| AC-007 | FR-011, ERR-004 | E5 (User not found) | Phase 2 |
| AC-008 | FR-012, ERR-005 | E6 (Soft-deleted) | Phase 2 |
| AC-009 | FR-001, FR-005, FR-006 | Read-only verification | Phase 4 (test) |
| AC-010 | FR-001, FR-005 | Data unchanged | Phase 4 (test) |
| AC-011 | NFR-007 | A1 (Audit log) | Phase 2+4 |
| AC-012 | FR-001, FR-002, FR-009 | HP1 (System Admin — every user) | Phase 2 |
| AC-013 | FR-009 | HP2 (BA in scope) | Phase 2 |
| AC-014 | FR-003 | HP3 (BA self-view) | Phase 2 |
| AC-015 | FR-002 | HP5 (directManager null) | Phase 2 |
| AC-016 | FR-002 | HP6 (avatarUrl null) | Phase 2 |
| AC-017 | FR-002 | HP7 (avatarUrl has value) | Phase 2 |
| AC-018 | FR-002 | EmploymentStatus enum | Phase 2+4 |

---

## Complexity Tracking

> Không có violation nào cần justification. Feature hoàn toàn trong scope, không vi phạm database baseline, không thêm bảng/field, không thay đổi kiến trúc hiện tại.
