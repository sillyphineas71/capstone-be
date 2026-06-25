# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-25 | Khởi tạo implementation plan cho tính năng Public Profile API | Toàn bộ tài liệu |

# Implementation Plan: Xem hồ sơ công khai tài khoản (Public Profile)

> Feature ID: ACCT-PUBLIC-PROFILE-001
> Module: accounts
> Created: 2026-06-25
> Status: Draft
> Spec: [spec.md](./spec.md)

---

## 1. Feature Summary

Bổ sung endpoint mới `GET /api/v1/users/:userId/public-profile` vào `UsersController` hiện có, cho phép **bất kỳ user đã đăng nhập** (chỉ cần `JwtAuthGuard`, không cần permission/role) xem một tập dữ liệu công khai rút gọn gồm 6 fields: `id`, `fullName`, `email`, `employeeCode`, `department { id, departmentName }`, `avatarUrl`. Đây là endpoint chỉ-đọc (read-only), không transaction, không audit log, không department scope — khác biệt rõ ràng so với endpoint chi tiết hồ sơ hiện có `GET /api/v1/users/:userId` (UC-AM-10) vốn yêu cầu permission `account.user.read.detail` và trả về các field quản trị nhạy cảm.

---

## 2. Technical Context

### 2.1 Stack hiện tại

| Layer | Technology | Ghi chú |
|---|---|---|
| Framework | NestJS (modular monolith) | `AccountsModule` |
| ORM | TypeORM | `DataSource.manager` (entity manager pattern, giống `UsersService` hiện có) |
| Auth | JWT (access token) | Chỉ `JwtAuthGuard`, **không** `PermissionsGuard`, **không** `RolesGuard` |
| Database | PostgreSQL (UUID PK, timestamptz) | Đọc 2 bảng hiện có: `users`, `departments` |
| Validation | NestJS built-in pipes | `ParseUUIDPipe` cho `userId` param |

### 2.2 Module dependencies

```
UsersController → UsersService → DataSource (TypeORM)
                                → UserEntity, DepartmentEntity (chỉ đọc)

Auth layer: JwtAuthGuard → check JWT (KHÔNG có PermissionsGuard)
```

### 2.3 Codebase context

- `UsersController` (`src/modules/accounts/controllers/users.controller.ts`) đã có sẵn 3 endpoint: `POST /users`, `GET /users`, `GET /users/:userId`. Endpoint mới sẽ là route con thứ 4: `GET /users/:userId/public-profile`.
- `UsersService` (`src/modules/accounts/services/users.service.ts`) đã có method `getUserDetail()` dùng pattern `this.dataSource.manager.findOne(UserEntity, { where, relations, select })` — tái sử dụng đúng pattern này cho method mới, chỉ khác là **không** cần resolve role/department scope, **không** fetch `user_roles`/`face_profiles`/`directManager`, **không** ghi `audit_logs`.
- `UserEntity` (`src/modules/accounts/entities/user.entity.ts`) có field `avatarUrl` (cột `avatar_url`, nullable) — chỉ được set khi avatar được duyệt qua `feat-admin-avatar-review-workflow`; method mới chỉ đọc, không cần biết gì về `face_profiles`.
- `DepartmentEntity` (`src/modules/accounts/entities/department.entity.ts`) có `id`, `departmentName` — đủ dữ liệu cần cho field `department` trong response.
- Route `:userId/public-profile` không xung đột với route `:userId` đã tồn tại: Express/NestJS param `:userId` chỉ khớp **một** path segment (không khớp dấu `/`), nên `/users/{uuid}/public-profile` (2 segment sau `/users/`) không bao giờ rơi vào route `:userId` (1 segment) dù khai báo trước hay sau. Không cần lo thứ tự đăng ký route.

---

## 3. Scope Confirmation

### 3.1 In Scope

- GET endpoint `/api/v1/users/:userId/public-profile` trả về public profile rút gọn.
- Authentication: JWT token bắt buộc (`JwtAuthGuard`).
- Authorization: **không** có permission hoặc role check nào khác — quyết định thiết kế có chủ đích (FR-009 trong spec).
- Truy vấn dữ liệu từ `users` (relation `department`).
- DTO mới `UserPublicProfileResponseDto` với đúng 6 field whitelist.
- Validate `userId` là UUID hợp lệ.
- Trả 404 `USER_NOT_FOUND` nếu không tồn tại hoặc đã soft-delete.

### 3.2 Out of Scope (xác nhận từ spec)

- Không sửa/thay đổi hành vi endpoint `GET /api/v1/users/:userId` (UC-AM-10).
- Không thêm permission/role/department-scope check.
- Không trả về `accountStatus`, `employmentStatus`, `mustChangePassword`, `lastLoginAt`, `roles`, `phoneNumber`, `positionTitle`, `directManager`, `hasFaceProfile`, `createdAt`, `updatedAt`.
- Không ghi `audit_logs` cho hành động xem public profile.
- Không thêm bảng/cột mới vào database.
- Không implement danh sách/tìm kiếm nhiều public profile (đã có `GET /users`).

### 3.3 Constitution Check

| Gate | Status | Justification |
|---|---|---|
| DB Gate | ✅ PASS | Không thêm bảng/field, chỉ đọc `users`, `departments` hiện có |
| Security Gate | ✅ PASS | Whitelist field tường minh, không expose field nhạy cảm; SEC-02 (auth bắt buộc cho mutating endpoint) không áp dụng vì đây là GET, nhưng vẫn enforce JWT theo thiết kế |
| Scope Gate | ✅ PASS | Chỉ implement ACCT-PUBLIC-PROFILE-001, không động vào UC-AM-10 |
| Module Gate | ✅ PASS | `AccountsModule`, route con của `UsersController` hiện có |
| API Gate | ✅ PASS | Response format đúng convention `{ success, message, data }` |
| Auth Gate | ✅ PASS | `JwtAuthGuard` — không cần permission/role theo đúng spec |
| Test Gate | ✅ PASS | Unit test + controller test plan tại Mục 10 |

---

## 4. Data Model Impact

### 4.1 No Schema Change

Feature này **không thay đổi** database schema. Dữ liệu lấy từ 2 bảng hiện có:
- `users` — `id`, `full_name`, `email`, `employee_code`, `avatar_url`, `department_id`, `deleted_at`
- `departments` — `id`, `department_name` (qua relation `users.department`)

### 4.2 New DTO

Tạo `UserPublicProfileResponseDto` (file mới, không sửa `UserDetailResponseDto` hiện có):

```typescript
export class PublicProfileDepartmentDto {
  id: string;
  departmentName: string;
}

export class UserPublicProfileResponseDto {
  id: string;
  fullName: string;
  email: string;
  employeeCode: string | null;
  department: PublicProfileDepartmentDto | null;
  avatarUrl: string | null;
}
```

Lưu ý: DTO này **độc lập** với `UserDetailResponseDto` — không kế thừa/`Pick<>` để tránh vô tình lộ field khi `UserDetailResponseDto` được mở rộng trong tương lai (mỗi response shape của hai endpoint phải tự khai báo whitelist riêng).

---

## 5. API / Contract Plan

### 5.1 Endpoint

**GET** `/api/v1/users/:userId/public-profile`

### 5.2 Guards

```typescript
@UseGuards(JwtAuthGuard)
```

Không có `PermissionsGuard`, không có `@RequirePermissions(...)`.

### 5.3 Validation

- `userId` validated qua NestJS `ParseUUIDPipe` (cùng pattern với `getUserDetail`, error code `INVALID_USER_ID`, HTTP 400).
- Không có request body (GET).

### 5.4 Response format

Success:
```json
{
  "success": true,
  "message": "Lấy hồ sơ công khai thành công",
  "data": {
    "id": "uuid",
    "fullName": "Nguyen Van A",
    "email": "a.nguyen@company.com",
    "employeeCode": "EMP001",
    "department": { "id": "uuid", "departmentName": "Phòng Kỹ Thuật" },
    "avatarUrl": "https://res.cloudinary.com/.../image.jpg"
  }
}
```

Error: `{ success: false, message, error: { code, details }, timestamp, path }` — cùng format với các endpoint khác trong `UsersController`.

---

## 6. Authorization Plan

### 6.1 Authentication

- `JwtAuthGuard` — verify JWT token (cùng cơ chế với endpoint `GET /users/:userId` hiện có).

### 6.2 Permission / Role

- **Không áp dụng.** Đây là điểm khác biệt cốt lõi so với UC-AM-10. Bất kỳ user đã đăng nhập, bất kể role (`INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`), đều truy cập được như nhau.
- Không kiểm tra `account.user.read.detail` hoặc bất kỳ permission account nào khác.

### 6.3 Department Scope

- **Không áp dụng.** Không có khái niệm Business Admin scope cho endpoint này — mọi authenticated user xem được public profile của mọi user khác (target chưa bị soft-delete).

### 6.4 Self-view

- Không cần xử lý đặc biệt: actor xem chính mình đi qua đúng luồng như xem user khác, không có nhánh logic riêng (khác với `getUserDetail` phải bypass department scope cho self-view).

---

## 7. Business Logic Plan

### 7.1 Service Method: `getPublicProfile`

```typescript
async getPublicProfile(
  targetUserId: string,
): Promise<UserPublicProfileResponseDto>
```

#### Steps:

1. **Fetch target user** (với relation `department`, chưa soft-delete):
   ```typescript
   const targetUser = await em.findOne(UserEntity, {
     where: { id: targetUserId, deletedAt: IsNull() },
     relations: { department: true },
   });
   ```
2. Nếu không tìm thấy → throw `NotFoundException` (`USER_NOT_FOUND`).
3. Assemble `department` field: `targetUser.department ? { id, departmentName } : null`.
4. Trả về DTO với đúng 6 field whitelist (`id`, `fullName`, `email`, `employeeCode`, `department`, `avatarUrl`).

Không có bước fetch roles, direct manager, face profile, không có bước resolve department scope, không có bước ghi audit log — đúng theo Out of Scope của spec.

### 7.2 Read-only Guarantee

- Method chỉ dùng `findOne` (SELECT). Không có `save`, `update`, `delete`, `insert`.

### 7.3 Transaction Boundary

- Không cần transaction — chỉ 1 query SELECT duy nhất (kèm relation `department` qua JOIN tự động của TypeORM).

---

## 8. Validation Plan

### 8.1 Input Validation

| Field | Validator | When | Error Code |
|---|---|---|---|
| `userId` | `ParseUUIDPipe` (NestJS built-in) | Controller param | `INVALID_USER_ID` (400) |

### 8.2 Business Validation

| Rule | Check Location | Error Code |
|---|---|---|
| Target user tồn tại & không soft-deleted | Service (`findOne` với `deletedAt: IsNull()`) | `USER_NOT_FOUND` (404) |

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

Service level:
  404 USER_NOT_FOUND          ← User không tồn tại / đã soft-delete

Exception filter:
  500 INTERNAL_ERROR          ← Lỗi không xác định
```

Không có nhánh 403 — endpoint không có permission/role/scope check.

### 9.2 Error Response Format

```json
{
  "success": false,
  "message": "Không tìm thấy tài khoản.",
  "error": { "code": "USER_NOT_FOUND", "details": {} },
  "timestamp": "ISO-8601",
  "path": "/api/v1/users/{uuid}/public-profile"
}
```

### 9.3 Soft-delete Handling

- Query luôn filter `deletedAt: IsNull()`.
- Trả về `USER_NOT_FOUND` giống như user không tồn tại — không tiết lộ lý do soft-delete (cùng quy ước với UC-AM-10).

---

## 10. Testing Strategy

### 10.1 Unit Tests (UsersService)

| Test Case | Description | AC |
|---|---|---|
| `getPublicProfile: success` | Happy path, đầy đủ 6 field, target có department và avatarUrl | AC-001 |
| `getPublicProfile: self-view` | targetUserId === authenticatedUserId vẫn trả 200 bình thường | AC-002 |
| `getPublicProfile: user not found` | userId không tồn tại | AC-006 |
| `getPublicProfile: soft-deleted user` | user có `deleted_at != null` | AC-007 |
| `getPublicProfile: department null` | `department_id = null` → `department: null`, không omit | AC-008 |
| `getPublicProfile: avatarUrl null` | `avatar_url = null` (chưa được duyệt) → `avatarUrl: null` | AC-009 |
| `getPublicProfile: avatarUrl has value` | `avatar_url` đã được duyệt | AC-010 |
| `getPublicProfile: employeeCode null` | `employee_code = null` → không omit field | AC-011 |
| `getPublicProfile: response excludes sensitive fields` | Kiểm tra response object không có `accountStatus`, `roles`, `lastLoginAt`,... | AC-013 |

### 10.2 Controller Tests

| Test Case | Description | AC |
|---|---|---|
| `GET :userId/public-profile success` | Happy path với guard JWT | AC-001 |
| `GET :userId/public-profile invalid UUID` | UUID sai format → 400 | AC-004 |
| `GET :userId/public-profile no auth` | Không có token → 401 | AC-005 |
| `GET :userId/public-profile any role succeeds` | User có role bất kỳ (không cần permission account) vẫn trả 200 | AC-003 |

### 10.3 Integration Tests

- Full flow: request → JWT guard → service query → response.
- Verify không có INSERT/UPDATE/DELETE nào xảy ra (AC-012).
- Verify route mới không phá vỡ hoặc làm thay đổi hành vi route `GET /users/:userId` hiện có (regression check cho UC-AM-10).

### 10.4 Test Data Requirements

- User với department_id hợp lệ và user với department_id null.
- User với avatar_url đã approve và user với avatar_url null.
- User với employee_code null.
- Soft-deleted user.
- User thuộc các role khác nhau (`INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`) để xác nhận không bị chặn bởi permission.

---

## 11. Implementation Phases

### Phase 1: DTO

**Tasks:**
1. Tạo `UserPublicProfileResponseDto` + `PublicProfileDepartmentDto`.

**Files:** `src/modules/accounts/dto/user-public-profile-response.dto.ts` (file mới)

### Phase 2: Service Layer

**Tasks:**
1. Thêm method `getPublicProfile(targetUserId: string): Promise<UserPublicProfileResponseDto>` trong `UsersService`.
2. Implement logic: fetch user (với relation department) → kiểm tra tồn tại → assemble DTO.

**Files:** `src/modules/accounts/services/users.service.ts` (sửa file hiện có — chỉ thêm method, không sửa method khác)

### Phase 3: Controller Layer

**Tasks:**
1. Thêm `@Get(':userId/public-profile')` trong `UsersController`.
2. `@UseGuards(JwtAuthGuard)` — **không** thêm `PermissionsGuard`/`@RequirePermissions`.
3. `ParseUUIDPipe` cho `userId` param (tái sử dụng cùng `exceptionFactory` pattern với `getUserDetail`).
4. Gọi `usersService.getPublicProfile()`.

**Files:** `src/modules/accounts/controllers/users.controller.ts` (sửa file hiện có — chỉ thêm endpoint mới)

### Phase 4: Testing

**Tasks:**
1. Viết unit test cho `UsersService.getPublicProfile` (tất cả scenario tại Mục 10.1).
2. Viết controller test cho endpoint mới (Mục 10.2).
3. Regression test xác nhận `GET /users/:userId` (UC-AM-10) không bị ảnh hưởng.

**Files:**
- `src/modules/accounts/services/users.service.spec.ts` (sửa file hiện có)
- `src/modules/accounts/controllers/users.controller.spec.ts` (sửa file hiện có)

---

## 12. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Nhầm lẫn whitelist field khi copy-paste từ `getUserDetail`/`UserDetailResponseDto` dẫn đến lộ field nhạy cảm | Security | Medium | DTO mới khai báo độc lập (không kế thừa `UserDetailResponseDto`); test `AC-013` kiểm tra response object bằng `toEqual`/field-list assertion, không chỉ kiểm tra field mong đợi tồn tại |
| Route mới `:userId/public-profile` xung đột thứ tự với route `:userId` hiện có | Functional | Rất thấp | Đã xác nhận tại Mục 2.3: `:userId` chỉ khớp 1 segment, không khớp `/users/{uuid}/public-profile` (2 segment) dù khai báo trước/sau |
| Endpoint không permission có thể bị hiểu nhầm là lỗi thiếu guard khi review code | Process | Low | Spec đã ghi rõ FR-009/OOS-002 là quyết định thiết kế có chủ đích; thêm comment ngắn tại controller trỏ về spec nếu cần |
| Thiếu audit log có thể gây thắc mắc khi so với UC-AM-10 | Process | Low | Spec đã ghi rõ tại Mục 8.1 (Out of Scope) lý do không cần audit cho dữ liệu không nhạy cảm |

---

## 13. Acceptance Criteria Traceability

| AC ID | FR Link | Test Case | Implementation Phase |
|---|---|---|---|
| AC-001 | FR-001, FR-002, FR-004 | Happy path | Phase 2+3 |
| AC-002 | FR-006 | Self-view | Phase 2 |
| AC-003 | FR-006, FR-009 | Mọi role đều truy cập được | Phase 3 |
| AC-004 | ERR-001 | Invalid UUID | Phase 3 |
| AC-005 | FR-008, ERR-002 | Unauthenticated | Phase 3 (guard) |
| AC-006 | FR-011, ERR-003 | User không tồn tại | Phase 2 |
| AC-007 | FR-012, ERR-004 | Soft-deleted user | Phase 2 |
| AC-008 | FR-013 | department null | Phase 2 |
| AC-009 | FR-014 | avatarUrl null | Phase 2 |
| AC-010 | FR-007, FR-014 | avatarUrl có giá trị | Phase 2 |
| AC-011 | FR-015 | employeeCode null | Phase 2 |
| AC-012 | FR-005 | Read-only verification | Phase 4 (test) |
| AC-013 | FR-003, NFR-003, NFR-004 | Không lộ field nhạy cảm | Phase 1+4 |

---

## Complexity Tracking

> Không có violation nào cần justification. Feature đơn giản hơn UC-AM-10 (ít field, không permission/scope/audit), hoàn toàn trong scope, không vi phạm database baseline, không thêm bảng/field, không thay đổi kiến trúc hiện tại.
