# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-25 | Khởi tạo task breakdown cho tính năng Public Profile API, dựa trên spec.md và plan.md | Toàn bộ tài liệu |
| 2026-06-25 | Implement xong T001–T007, T009–T010 (DTO, service, controller, unit test, lint, build). T008 (integration test) skip vì chưa có Postgres test container/infra integration test sẵn có trong repo | Phase 1–5, đánh dấu [x] |

# Tasks: Xem hồ sơ công khai tài khoản (Public Profile)

**Feature**: ACCT-PUBLIC-PROFILE-001
**Module**: accounts
**Priority**: P2 — Supporting feature (không thay thế UC-AM-10, bổ sung cho các nhu cầu hiển thị thông tin cơ bản)

**Input**: `spec.md`, `plan.md`
**Ghi chú**: Feature này không có `data-model.md`/`contracts/`/`quickstart.md`/`research.md` riêng vì `plan.md` đã bao gồm đủ chi tiết Data Model (Mục 4), API Contract (Mục 5), và Testing Strategy (Mục 10) cần thiết cho một feature read-only đơn giản, 1 endpoint, không transaction, không thay đổi schema.

---

## Format

- `[ID]` — Task ID tuần tự
- `[P]` — Task có thể chạy song song (khác file hoặc khác `describe` block, không dependency)
- `[US1]` — User Story 1: Xem hồ sơ công khai của một tài khoản khác (toàn bộ feature là 1 user story duy nhất)

---

## Phase 1: DTO

**Mục tiêu**: Tạo DTO response độc lập với whitelist 6 field, không kế thừa `UserDetailResponseDto` (theo Risk đã ghi trong plan.md Mục 12).

| Dependency | Task |
|---|---|
| — | T001 |

- [x] T001 [US1] Tạo `UserPublicProfileResponseDto` và `PublicProfileDepartmentDto` tại `src/modules/accounts/dto/user-public-profile-response.dto.ts`
  - **Outcome**: File mới, 2 class, field: `id`, `fullName`, `email`, `employeeCode` (nullable), `department` (nullable, `{ id, departmentName }`), `avatarUrl` (nullable). Không khai báo thêm field nào ngoài whitelist.
  - **Cover**: FR-002, FR-003 (plan.md Mục 4.2)

---

## Phase 2: Service Layer

**Mục tiêu**: Implement business logic chỉ-đọc — fetch target user kèm department, kiểm tra tồn tại/soft-delete, assemble DTO. Không resolve permission/department-scope, không ghi audit log (out of scope theo spec.md Mục 8.1).

| Dependency | Task |
|---|---|
| T001 → | T002 |

- [x] T002 [US1] Implement phương thức `getPublicProfile(targetUserId: string): Promise<UserPublicProfileResponseDto>` trong `UsersService` tại `src/modules/accounts/services/users.service.ts`
  - **Steps**: fetch `UserEntity` qua `dataSource.manager.findOne` với `where: { id: targetUserId, deletedAt: IsNull() }`, `relations: { department: true }` → nếu không tìm thấy throw `NotFoundException` (`code: USER_NOT_FOUND`) → assemble `department` thành `{ id, departmentName }` hoặc `null` → trả DTO với đúng 6 field.
  - **Outcome**: Method mới, single SELECT query, không có `save`/`update`/`delete`/`insert`, không transaction.
  - **Cover**: FR-001, FR-004, FR-005, FR-007, FR-011, FR-012, FR-013, FR-014, FR-015 (plan.md Mục 7.1)

---

## Phase 3: Controller Layer

**Mục tiêu**: Expose endpoint `GET /api/v1/users/:userId/public-profile` chỉ với `JwtAuthGuard`, không `PermissionsGuard`.

| Dependency | Task |
|---|---|
| T002 → | T003 |

- [x] T003 [US1] Thêm endpoint `@Get(':userId/public-profile')` trong `UsersController` tại `src/modules/accounts/controllers/users.controller.ts`
  - **Guards**: `@UseGuards(JwtAuthGuard)` — **không** thêm `PermissionsGuard`/`@RequirePermissions(...)` (quyết định thiết kế có chủ đích, FR-009/OOS-002).
  - **Validation**: `ParseUUIDPipe` cho `userId` param, cùng `exceptionFactory` pattern (`code: INVALID_USER_ID`, HTTP 400) với endpoint `getUserDetail` hiện có.
  - **Logic**: gọi `usersService.getPublicProfile(userId)`, trả response `{ success: true, message: 'Lấy hồ sơ công khai thành công', data }`.
  - **Lưu ý route**: Không xung đột với `@Get(':userId')` đã tồn tại — `:userId` chỉ khớp 1 path segment, không khớp `/users/{uuid}/public-profile` (2 segment). Có thể đặt route này trước hoặc sau `@Get(':userId')` trong file.
  - **Outcome**: Endpoint hoạt động đầy đủ.
  - **Cover**: FR-006, FR-008, FR-009, ERR-001, ERR-002 (plan.md Mục 5, 6)

---

## Phase 4: Testing

**Mục tiêu**: Đảm bảo coverage cho tất cả 13 acceptance criteria trong spec.md.

| Dependency | Task |
|---|---|
| T002 → | T004, T005, T006 |
| T003 → | T007, T008 |

### Unit Tests — UsersService

- [x] T004 [P] [US1] Viết unit test cho `UsersService.getPublicProfile` — **happy path & data format** (`src/modules/accounts/services/users.service.spec.ts`):
  - Trả đủ 6 field khi target user có department và avatarUrl (AC-001)
  - Self-view: targetUserId === authenticatedUserId vẫn xử lý bình thường, không có nhánh logic riêng (AC-002)
  - `department: null` khi `department_id = null`, không omit field (AC-008)
  - `avatarUrl: null` khi `avatar_url = null` — chưa được duyệt (AC-009)
  - `avatarUrl` có giá trị khi `avatar_url` đã được duyệt (AC-010)
  - `employeeCode: null` khi `employee_code = null`, không omit field (AC-011)
  - **Pattern**: Mock `DataSource`/`EntityManager` theo pattern hiện có trong `users.service.spec.ts`

- [x] T005 [P] [US1] Viết unit test cho `UsersService.getPublicProfile` — **error cases** (`src/modules/accounts/services/users.service.spec.ts`):
  - `userId` không tồn tại → 404 `USER_NOT_FOUND` (AC-006)
  - Target user đã soft-delete → 404 `USER_NOT_FOUND`, verify cùng error code với trường hợp không tồn tại, không tiết lộ lý do soft-delete (AC-007)

- [x] T006 [P] [US1] Viết unit test cho `UsersService.getPublicProfile` — **read-only & sensitive field exclusion** (`src/modules/accounts/services/users.service.spec.ts`):
  - Verify method chỉ gọi `findOne` (SELECT), không gọi `save`/`update`/`delete`/`insert` nào (AC-012)
  - Verify response object **không** chứa các key: `accountStatus`, `employmentStatus`, `mustChangePassword`, `lastLoginAt`, `failedLoginCount`, `lockedUntil`, `passwordUpdatedAt`, `roles`, `directManager`, `positionTitle`, `phoneNumber`, `hasFaceProfile`, `createdAt`, `updatedAt` — dùng assertion theo field-list (ví dụ `Object.keys(result)` hoặc `expect(result).toEqual({...6 field...})`), không chỉ kiểm tra field mong đợi tồn tại (AC-013)

### Unit Tests — UsersController

- [x] T007 [US1] Viết unit test cho `UsersController` endpoint `public-profile` (`src/modules/accounts/controllers/users.controller.spec.ts`):
  - Happy path — gọi `usersService.getPublicProfile` đúng tham số, response format `{ success, message, data }` (AC-001)
  - `userId` không phải UUID hợp lệ → `ParseUUIDPipe` reject với 400 `INVALID_USER_ID` (AC-004)
  - Không có JWT token → 401 `UNAUTHORIZED` qua `JwtAuthGuard` (AC-005)
  - User có role bất kỳ (`INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`) và **không có** permission account nào vẫn nhận 200, không bị 403 (AC-003)
  - **Pattern**: Override guard như test hiện có của `users.controller.spec.ts`

### Integration Test

- [ ] T008 [P] [US1] Viết integration test cho full flow (`src/modules/accounts/tests/users-public-profile.integration.spec.ts`)
  - Seed: user với department, user với `department_id = null`, user với `avatar_url` đã approve, user với `avatar_url = null`, user soft-deleted, user thuộc các role khác nhau
  - Full flow: request → `JwtAuthGuard` → service query → response
  - Verify không có INSERT/UPDATE/DELETE nào trên `users`/`departments` (AC-012)
  - **Regression check**: gọi `GET /api/v1/users/:userId` (UC-AM-10) trong cùng test suite, xác nhận hành vi/response của endpoint đó không bị ảnh hưởng bởi route mới
  - ⚠️ **Skipped**: Không có Postgres container đang chạy trong môi trường hiện tại (chỉ có Redis/MinIO) và repo chưa có pattern `*.integration.spec.ts` nào tồn tại sẵn (cùng tình trạng với `feat-view-detail-account` T011). Cần running database + supertest setup trước khi viết file này.

---

## Phase 5: Polish & Verification

**Mục tiêu**: Đảm bảo code quality và build pass trước khi coi feature hoàn tất.

| Dependency | Task |
|---|---|
| T004, T005, T006, T007, T008 → | T009 |
| T009 → | T010 |

- [x] T009 Chạy `npm run lint` + `npm run build` — fix toàn bộ lỗi phát sinh từ code mới (DTO, service method, controller endpoint)
  - ✅ `npm run build` passed clean
  - ✅ `npm run lint` trên 5 file đã sửa/tạo — 0 lỗi mới; 31 lỗi pre-existing không liên quan (đã đối chiếu qua `git stash` để xác nhận cùng baseline trước khi sửa)
  - ✅ `npx jest src/modules/accounts` — 44/44 test mới (T004–T007) pass; 5 suite fail khác (`create-permission.dto.spec.ts`, `role-permissions.service.spec.ts`, `is-department-code-unique.validator.spec.ts`, `is-department-name-unique.validator.spec.ts`, `create-department.dto.spec.ts`) là pre-existing, không liên quan đến file nào được sửa trong feature này

- [ ] T010 Verify thủ công qua Postman/curl theo các scenario trong spec.md Mục 7:
  - AC-001, AC-002, AC-003 (happy path, self-view, mọi role)
  - AC-004, AC-005 (validation, auth)
  - AC-006, AC-007 (not found, soft-deleted)
  - AC-008 → AC-011 (data format: department/avatarUrl/employeeCode null & có giá trị)
  - Đo response time, xác nhận < 1 giây (NFR-001)
  - Xác nhận `GET /api/v1/users/:userId` (UC-AM-10) vẫn hoạt động đúng như trước (regression thủ công)
  - ⚠️ **Chưa thực hiện**: cần server đang chạy + Postman/curl + JWT token thật; coverage logic tương đương đã được đảm bảo qua unit test T004–T007

---

## Dependencies & Execution Order

```
Phase 1:      T001 (DTO)
                  │
                  ↓
Phase 2:      T002 (Service: getPublicProfile)
                  │
                  ↓
Phase 3:      T003 (Controller: endpoint + guards)
                  │
        ┌─────────┼─────────┬──────────┐
        ↓         ↓         ↓          ↓
Phase 4:  T004 [P]   T005 [P]   T006 [P]   T007 (serial, depends on T003)
        (depend on T002)                        │
                  │                              │
                  └──────────────┬───────────────┘
                                  ↓
                              T008 [P] (Integration, depends on T003)
                                  │
                                  ↓
Phase 5:                       T009 (Lint + Build)
                                  │
                                  ↓
                              T010 (Manual verify)
```

### Parallel Opportunities

| Nhóm | Tasks | Điều kiện |
|---|---|---|
| Unit tests — service | T004, T005, T006 | Cùng file `users.service.spec.ts` nhưng khác `describe` block, không conflict |
| Integration test | T008 | File riêng `users-public-profile.integration.spec.ts`, song song với service tests |
| Controller test | T007 | Serial — phải đợi T003 (controller implementation) hoàn thành |

### Sequential Constraints

| Sequence | Lý do |
|---|---|
| T001 → T002 | Service import DTO mới |
| T002 → T003 | Controller gọi service method |
| T002 → T004/T005/T006 | Test service cần method đã implement |
| T003 → T007/T008 | Test controller/integration cần endpoint hoàn chỉnh |
| T004–T008 → T009 | Lint/build chạy sau khi toàn bộ code (bao gồm test) đã viết |

---

## Implementation Strategy

### MVP Scope

Toàn bộ feature là **1 user story** duy nhất — implement theo thứ tự:

1. T001 (DTO) → T002 (Service) → T003 (Controller)
2. T004/T005/T006 (Service tests, [P]) — song song sau T002
3. T007 (Controller test) — sau T003
4. T008 (Integration test, [P]) — song song với T007, sau T003
5. T009 → T010 (Polish)

Sau **Phase 3**, endpoint đã hoạt động và có thể test thủ công qua Postman/curl.
Sau **Phase 4**, full test coverage cho 13 ACs.

---

## Requirements Coverage

### Functional Requirements → Tasks

| FR ID | Mô tả | Task liên quan |
|---|---|---|
| FR-001 | Endpoint mới `GET /users/:userId/public-profile` | T003 |
| FR-002 | Whitelist 6 field trong response | T001, T002 |
| FR-003 | Loại trừ field quản trị nhạy cảm | T001, T006 (test verify) |
| FR-004 | Truy vấn users + departments, trả response thành công | T002 |
| FR-005 | Không mutation dữ liệu | T002 (chỉ SELECT), T006 (test verify) |
| FR-006 | Mọi authenticated user, không phân biệt role, đều truy cập được | T003 (chỉ JwtAuthGuard), T007 (test) |
| FR-007 | avatarUrl có giá trị khi đã được duyệt | T002, T004 (test) |
| FR-008 | Chưa đăng nhập → reject | T003 (JwtAuthGuard), T007 (test) |
| FR-009 | Không kiểm tra permission/role | T003 (không có PermissionsGuard), T007 (test) |
| FR-010 | Invalid UUID → reject | T003 (ParseUUIDPipe), T007 (test) |
| FR-011 | userId không tồn tại → not found | T002, T005 (test) |
| FR-012 | Soft-deleted → not found | T002, T005 (test) |
| FR-013 | department null → không omit | T002, T004 (test) |
| FR-014 | avatarUrl null → không omit | T002, T004 (test) |
| FR-015 | employeeCode null → không omit | T002, T004 (test) |

### Acceptance Criteria → Tasks

| AC ID | Mô tả | Task | Type |
|---|---|---|---|
| AC-001 | Happy path | T002, T003, T004, T007 | Happy path |
| AC-002 | Self-view | T002, T004 | Happy path |
| AC-003 | Mọi role đều truy cập được | T003, T007 | Authorization |
| AC-004 | Invalid UUID → 400 | T003, T007 | Validation |
| AC-005 | Unauthenticated → 401 | T003 (guard tự động), T007 | Authentication |
| AC-006 | User không tồn tại → 404 | T002, T005 | Business rule |
| AC-007 | Soft-deleted → 404 | T002, T005 | Business rule |
| AC-008 | department null | T002, T004 | Data format |
| AC-009 | avatarUrl null | T002, T004 | Data format |
| AC-010 | avatarUrl có giá trị | T002, T004 | Data format |
| AC-011 | employeeCode null | T002, T004 | Data format |
| AC-012 | Read-only — không mutation | T002, T006, T008 | Read-only |
| AC-013 | Không lộ field nhạy cảm | T001, T006 | Security |

### Non-functional Requirements → Tasks

| NFR ID | Mô tả | Task |
|---|---|---|
| NFR-001 | Response < 1 giây | T010 (đo response time thủ công) |
| NFR-002 | JWT enforcement | T003 (JwtAuthGuard) |
| NFR-003 | Không expose field nhạy cảm | T001 (DTO whitelist), T006 (test) |
| NFR-004 | Áp dụng đúng whitelist field | T001, T006 |
| NFR-005 | Department data consistency | T002 (single query + relation) |
| NFR-006 | Lỗi hệ thống → error rõ ràng, không trả dữ liệu thiếu | T002 (let exception propagate) |
| NFR-007 | Response envelope thống nhất | T003 |

---

## Task Count Summary

| Phase | Tasks | [P] Tasks | Total |
|---|---|---|---|
| Phase 1: DTO | 1 | 0 | 1 |
| Phase 2: Service | 1 | 0 | 1 |
| Phase 3: Controller | 1 | 0 | 1 |
| Phase 4: Tests | 5 | 4 | 5 |
| Phase 5: Polish | 2 | 0 | 2 |
| **Total** | **10** | **4** | **10** |

---

## Independent Test Criteria

Sau Phase 2 (T002 hoàn thành):
- Có thể test business logic qua unit test với mock repository.
- `getPublicProfile` trả về đúng 6 field whitelist, không lộ field nhạy cảm.

Sau Phase 3 (T003 hoàn thành):
- Có thể test manual qua curl: `GET /api/v1/users/{uuid}/public-profile` với JWT token bất kỳ (không cần permission account).
- Guard hoạt động: 401 nếu không có token; **không** có nhánh 403 vì endpoint không check permission.

Sau Phase 4 (T008 hoàn thành):
- 100% acceptance criteria coverage (13/13 AC).
- Full integration test với database thật, kèm regression check cho UC-AM-10.
