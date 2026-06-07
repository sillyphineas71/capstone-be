# Tasks: Xem chi tiết hồ sơ tài khoản

**Feature**: UC-AM-10 (UC-15 API Contract)
**Module**: accounts
**Priority**: P1 — Core feature

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/feat-view-detail-account-api.md, quickstart.md

---

## Format

- `[ID]` — Task ID tuần tự
- `[P]` — Task có thể chạy song song (khác file, không dependency)
- `[US1]` — User Story 1: Xem chi tiết hồ sơ tài khoản

---

## Phase 1: DTO & Data Layer

**Mục tiêu**: Tạo Data Transfer Object cho response.

| Dependency | Task |
|---|---|
| — | T001 |

- [x] T001 [US1] Tạo `UserDetailResponseDto` với nested DTOs: `DepartmentInfoDto`, `DirectManagerInfoDto`, `RoleInfoDto` tại `src/modules/accounts/dto/user-detail-response.dto.ts`
  - **Outcome**: File mới với 4 class, tất cả field mapping theo `data-model.md` Response DTO section
  - **Lưu ý**: `lastLoginAt` và `createdAt` dùng `string` (ISO-8601), `roles` luôn là array (không undefined), `department` và `directManager` nullable nhưng field luôn present

---

## Phase 2: Service Layer

**Mục tiêu**: Implement business logic — fetch user, department scope check, tổng hợp data, audit log.

| Dependency | Task |
|---|---|
| T001 → | T002 |
| T001 → | T003 |
| T002, T003 → | T004 |

- [x] T002 [US1] Implement phương thức `getUserDetail(targetUserId, authenticatedUserId, clientContext?)` trong `UsersService` — fetch target user với department relation, kiểm tra existence và soft-delete (`deletedAt: IsNull()`), nếu không tìm thấy throw `NotFoundException` với code `USER_NOT_FOUND` tại `src/modules/accounts/services/users.service.ts`
  - **Outcome**: Method mới với input validation guard, user query, error handling cho not-found case
  - **Cover**: AC-007, AC-008

- [x] T003 [US1] Implement private method `resolveDepartmentScope(adminUserId: string): Promise<Set<string>>` trong `UsersService` — lấy `departmentId` từ authenticated user, resolve recursive active child departments qua `departments.parent_department_id` (max 5 levels) tại `src/modules/accounts/services/users.service.ts`
  - **Outcome**: Method resolve scope trả về Set chứa tất cả department IDs trong scope
  - **Edge case**: Nếu user không có department (`departmentId = null`) → trả về Set rỗng

- [x] T004 [US1] Hoàn thiện `getUserDetail` — sau khi có target user và department scope:
  1. Xác định role của authenticated user (System Admin hay Business Admin)
  2. Nếu Business Admin và không phải self-view → kiểm tra target user's departmentId ∈ scope, nếu không → throw `ForbiddenException` với code `FORBIDDEN`
  3. Query active roles của target user (`user_roles` với `isActive = true` + join `roles`)
  4. Query direct manager info (nếu `directManagerId` không null) — select `[id, fullName]`
  5. Query face profile existence — `hasFaceProfile = true` nếu có record
  6. Assemble `UserDetailResponseDto` với tất cả fields
  7. Write audit log (non-blocking try/catch) với `actionType: 'view_detail'`, `entityType: 'users'`, `entityId: targetUserId`
  tại `src/modules/accounts/services/users.service.ts`
  - **Outcome**: Method hoàn chỉnh, coverage đầy đủ business logic
  - **Cover**: AC-001, AC-002, AC-006, AC-012, AC-013, AC-014, AC-015, AC-016, AC-017, AC-018, AC-011

---

## Phase 3: Controller Layer

**Mục tiêu**: Expose endpoint `GET /api/v1/users/:userId` với guards và validation.

| Dependency | Task |
|---|---|
| T004 → | T005 |

- [x] T005 [US1] Thêm endpoint `@Get(':userId')` trong `UsersController` với guards `@UseGuards(JwtAuthGuard, PermissionsGuard)` và `@RequirePermissions('account.user.read.detail')` tại `src/modules/accounts/controllers/users.controller.ts`
  - **Outcome**: Route handler mới
  - **Cover**: AC-004 (JwtAuthGuard handles 401), AC-005 (PermissionsGuard handles 403)

- [x] T006 [US1] Hoàn thiện controller — thêm `ParseUUIDPipe` cho `userId` param, extract authenticated user từ `request['user']`, gọi `usersService.getUserDetail()`, trả response format `{ success, message, data }` tại `src/modules/accounts/controllers/users.controller.ts`
  - **Outcome**: Full endpoint hoạt động
  - **Cover**: AC-003 (ParseUUIDPipe handles 400)

---

## Phase 4: Testing

**Mục tiêu**: Đảm bảo coverage cho tất cả acceptance criteria.

| Dependency | Task |
|---|---|---|
| T004 → | T007, T008, T009 |
| T006 → | T010 |

### Unit Tests — UsersService

- [x] T007 [P] [US1] Viết unit test cho `UsersService.getUserDetail` — **happy path** (`src/modules/accounts/services/users.service.spec.ts`):
  - System Admin xem user detail → HTTP 200, đầy đủ 17 fields (AC-001, AC-012)
  - Business Admin xem user cùng department (AC-013)
  - Business Admin xem user ở child department (AC-013)
  - Self-view (Business Admin xem chính mình) — bypass scope (AC-014)
  - **Pattern**: Theo test pattern hiện có (mock DataSource, mock EntityManager)

- [x] T008 [P] [US1] Viết unit test cho `UsersService.getUserDetail` — **error cases** (`src/modules/accounts/services/users.service.spec.ts`):
  - User không tồn tại → 404 USER_NOT_FOUND (AC-007)
  - User soft-deleted → 404 USER_NOT_FOUND, verify SAME error code với non-existent (AC-008)
  - Business Admin ngoài scope → 403 FORBIDDEN (AC-006)
  - Audit log failure không block response (non-blocking try/catch)
  - Mock `findOne` throw unexpected Error → verify 500 INTERNAL_ERROR (NFR-006)

- [x] T009 [P] [US1] Viết unit test cho `UsersService.getUserDetail` — **data format** (`src/modules/accounts/services/users.service.spec.ts`):
  - `hasFaceProfile: false` khi không có face_profile (AC-002)
  - `directManager: null` khi direct_manager_id = null (AC-015)
  - `avatarUrl: null` khi avatar_url = null (AC-016)
  - `avatarUrl` có giá trị từ DB (AC-017)
  - `employmentStatus` chỉ nhận 4 enum values (AC-018)
  - No INSERT/UPDATE/DELETE operations (AC-009, AC-010)

### Unit Tests — UsersController

- [x] T010 [US1] Viết unit test cho `UsersController.getUserDetail` (`src/modules/accounts/controllers/users.controller.spec.ts`):
  - Happy path — gọi service đúng params, response format (AC-001)
  - Invalid UUID → ParseUUIDPipe reject (AC-003)
  - Mock guard reject → verify 403 FORBIDDEN (AC-005)
  - **Pattern**: Override guards như test hiện có

### Integration Test

- [ ] T011 [P] [US1] Viết integration test cho full flow (`src/modules/accounts/tests/users-detail.integration.spec.ts`):
  - ⚠️ **Skipped**: Requires running database + supertest setup; not yet executed in current session
  - Seed: System Admin, Business Admin, department tree (parent + 2 children), target users, face_profile
  - Full flow: auth → permission → scope → query → response → audit log (AC-011)
  - Verify audit log tồn tại sau successful request
  - Verify read-only: không có INSERT/UPDATE/DELETE trên users/departments/user_roles/roles/face_profiles

---

## Phase 5: Polish & Verification

**Mục tiêu**: Đảm bảo code quality, build pass, quickstart scenarios pass.

| Dependency | Task |
|---|---|
| T011 → | T012 |
| T012 → | T013 |

- [x] T012 Chạy lint và typecheck: `npm run lint` + `npm run build` — fix all errors
  - ✅ `npm run build` passed clean
  - ⚠️ `npm run lint` — pre-existing linter errors outside scope

- [ ] T013 Verify tất cả test scenarios từ `quickstart.md`:
  - ⚠️ **Blocked**: Requires running database for HP1–HP7 scenarios; unit test coverage verified through T007–T010 (27/27 user tests passing)
  - 7 Happy Path scenarios (HP1–HP7)
  - 6 Error cases (E1–E6)
  - 1 Audit case (A1)
  - Benchmark: đo response time mỗi scenario, verify < 2s (NFR-001)
  - Đảm bảo tất cả AC pass

---

## Dependencies & Execution Order

```
Phase 1: T001 (DTO)
              │
              ├──→ T002 (Service: fetch user)
              │         │
               └──→ T003 (Service: scope resolver)
                        │
                        ↓
              T004 (Service: full logic + audit)
                        │
                        ↓
Phase 3:      T005 + T006 (Controller)
                        │
                        ↓
Phase 4: T007 ─┤ T008 ─┤ T009 ─┤ T011 (Tests) — [P]; T010 (serial, depends on T006)
                        │
                        ↓
Phase 5:      T012 (Lint + Build) → T013 (QS Verify)
```

### Parallel Opportunities

| Nhóm | Tasks | Điều kiện |
|---|---|---|
| Unit tests — service | T007, T008, T009 | Cùng file `users.service.spec.ts` nhưng khác `describe` block, không conflict |
| Integration test | T011 | File riêng `users-detail.integration.spec.ts`, song song với service tests |
| Controller test | T010 | Serial — phải đợi T006 (controller implementation) hoàn thành |
| Lint + Build | — | Chạy một lần cuối cùng |

### Sequential Constraints

| Sequence | Lý do |
|---|---|---|
| T001 → T002 | Service import DTO |
| T001 → T003 | Service import DTO |
| T002 → T004 | T004 cần target user data từ T002 |
| T003 → T004 | T004 cần department scope từ T003 |
| T004 → T005/T006 | Controller gọi service method |
| T006 → T010 | Controller test cần endpoint hoàn chỉnh |
| T011 → T012 | Integration test cần code ổn định |

---

## Implementation Strategy

### MVP Scope

Toàn bộ feature là **1 user story** duy nhất — implement đủ tất cả tasks theo thứ tự:

1. T001 (DTO) → T002 → T003 (Service foundation) → T004 (Service complete)
2. T005 → T006 (Controller) — T010 phải đợi T006
3. T007/T008/T009 (Service tests, [P]) + T011 (Integration, [P]) — song song
4. T010 (Controller test) — sau T006
5. T012/T013 (Polish)

Sau **Phase 3**, endpoint đã hoạt động và có thể test thủ công qua Postman/Curl.
Sau **Phase 4**, full test coverage cho 19 ACs.

---

## Requirements Coverage

### Functional Requirements → Tasks

| FR ID | Mô tả | Task liên quan |
|---|---|---|
| FR-001 | Read-only mode | T004 (no save/update/delete), T009 (test verify) |
| FR-002 | Trả về 17 fields | T001 (DTO), T004 (assemble), T007 (test) |
| FR-003 | Self-view bypass scope | T004 (logic), T007 (test) |
| FR-004 | Tổng hợp từ 5 bảng | T004 (queries) |
| FR-005 | No data mutation | T004 (SELECT only) |
| FR-006 | Read-only với permission | T004, T005 (guards) |
| FR-007 | Unauthenticated → 401 | T005 (JwtAuthGuard) |
| FR-008 | No permission → 403 | T005 (PermissionsGuard), T010 (controller test) |
| FR-009 | BA department scope resolve | T003 (resolver), T004 (check) |
| FR-010 | BA ngoài scope → 403 | T004 (ForbiddenException) |
| FR-011 | User not found → 404 | T002 (NotFoundException) |
| FR-012 | Soft-deleted → 404 | T002 (deletedAt filter) |
| FR-013 | System error → 500 + audit | T004 (try/catch), T008 (db failure test), T011 (integration) |

### Acceptance Criteria → Tasks

| AC ID | Mô tả | Task | Type |
|---|---|---|---|
| AC-001 | System Admin full detail | T004, T006, T007, T010 | Happy path |
| AC-002 | hasFaceProfile = false | T004, T009 | Data format |
| AC-003 | Invalid UUID → 400 | T006, T010 | Validation |
| AC-004 | Unauthenticated → 401 | T005 (guard auto) | Auth |
| AC-005 | No permission → 403 | T005 (guard auto), T010 (controller test) | Auth |
| AC-006 | BA ngoài scope → 403 | T004, T008 | Auth |
| AC-007 | User not found → 404 | T002, T008 | Business rule |
| AC-008 | Soft-deleted → 404 | T002, T008 | Business rule |
| AC-009 | No data mutation | T004, T009, T011 | Read-only |
| AC-010 | Data unchanged | T009, T011 | Read-only |
| AC-011 | Audit log recorded | T004, T011 | Audit |
| AC-012 | System Admin — every user | T004, T007 | Happy path |
| AC-013 | BA trong scope | T004, T007 | Happy path |
| AC-014 | BA self-view | T004, T007 | Happy path |
| AC-015 | directManager null | T004, T009 | Data format |
| AC-016 | avatarUrl null | T004, T009 | Data format |
| AC-017 | avatarUrl có giá trị | T004, T009 | Data format |
| AC-018 | employmentStatus enum | T004, T009 | Data format |

### Non-functional Requirements → Tasks

| NFR ID | Mô tả | Task |
|---|---|---|
| NFR-001 | Response trong 2s | T013 — verify response time trong quickstart scenarios (benchmark với `Date.now()` trước/sau request) |
| NFR-002 | Không expose sensitive fields | T001 (DTO design không có password_hash) |
| NFR-003 | JWT enforcement | T005 (JwtAuthGuard) |
| NFR-004 | Permission enforcement | T005 (PermissionsGuard) |
| NFR-005 | Data consistency | T004 (single fetch pattern) |
| NFR-006 | Partial failure → error | T004 (let exception propagate) |
| NFR-007 | Audit log on access | T004 (write audit log) |
| NFR-008 | Log failed attempts | Auto from guards (existing infrastructure) |

---

## Task Count Summary

| Phase | Tasks | [P] Tasks | Total |
|---|---|---|---|---|
| Phase 1: DTO | 1 | 0 | 1 |
| Phase 2: Service | 3 | 0 | 3 |
| Phase 3: Controller | 2 | 0 | 2 |
| Phase 4: Tests | 5 | 4 | 5 |
| Phase 5: Polish | 2 | 0 | 2 |
| **Total** | **13** | **4** | **13** |

---

## Independent Test Criteria

Sau Phase 2 (T004 hoàn thành):
- Có thể test business logic qua unit test
- `getUserDetail` trả về đúng dữ liệu với mock repository

Sau Phase 3 (T006 hoàn thành):
- Có thể test manual qua curl: `GET /api/v1/users/{uuid}` với JWT token
- Guards hoạt động: 401 nếu không có token, 403 nếu thiếu permission

Sau Phase 4 (T011 hoàn thành):
- 100% acceptance criteria coverage
- Full integration test với database thật
