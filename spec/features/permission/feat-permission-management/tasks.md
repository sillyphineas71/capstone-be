## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-23 | Sửa lỗi mô tả task T034, sửa số lượng task Phase 4 và tổng số task trong summary | Bảng log, T034, Summary |
| 2026-06-23 | Tạo tasks.md cho Permission Catalog & Role-Permission Assignment | Toàn bộ file |

---

# Tasks: Permission Catalog & Role-Permission Assignment

**Feature Directory**: spec/features/permission/feat-permission-management/
**Plan**: plan.md
**Spec**: spec.md
**Data Model**: data-model.md
**API Contract**: contracts/permission-management-api.md
**Quickstart**: quickstart.md

---

## Phase 1 — Setup & Infrastructure

*Phase này tạo nền tảng: DTOs, constants, validators, guards. Không có user story label.*

- [x] T001 Create permission-module-allowlist.constant.ts in src/modules/accounts/constants/ exposing MODULE_CODE_ALLOWLIST array (23 codes)
- [x] T002 [P] Create permission-sort-fields.constant.ts in src/modules/accounts/constants/ exposing PERMISSION_SORT_FIELDS allowlist
- [x] T003 [P] Create create-permission.dto.ts in src/modules/accounts/dto/ with class-validator: @IsString, @Matches(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/), @MaxLength(120), @IsIn(allowlist), @MaxLength(150), @MaxLength(80), @IsOptional
- [x] T004 [P] Create update-permission.dto.ts in src/modules/accounts/dto/ with @IsOptional, @MaxLength(150) for permissionName and description only (permissionCode/moduleCode/actionCode NOT allowed)
- [x] T005 [P] Create assign-permissions.dto.ts in src/modules/accounts/dto/ with @IsArray, @ArrayNotEmpty, @IsUUID('4', { each: true }) for permissionIds
- [x] T006 [P] Create permission-response.dto.ts in src/modules/accounts/dto/ exposing id, permissionCode, permissionName, moduleCode, actionCode, description, isActive, createdAt, updatedAt
- [x] T007 [P] Create role-permission-response.dto.ts in src/modules/accounts/dto/ exposing id, roleId, permissionId, grantedBy, grantedAt, nested permission object
- [x] T008 [P] Create IsPermissionCodeFormatConstraint custom validator in src/modules/accounts/validators/ implementing ValidatorConstraintInterface with regex ^[a-z0-9_]+(\.[a-z0-9_]+)+$
- [x] T009 [P] Create IsModuleCodeInAllowlistConstraint custom validator in src/modules/accounts/validators/ using MODULE_CODE_ALLOWLIST
- [x] T010 [P] Create pagination-query.dto.ts in src/modules/accounts/dto/ with page (Type → int, @Min 1), limit (Type → int, @Min 1, @Max 100), sortBy, sortOrder, moduleCode, search

---

## Phase 2 — Foundational

*Phase này tạo guard, decorator, module wiring. Blocking prerequisite cho tất cả user stories.*

- [x] T011 Create @RequirePermissions decorator in src/common/decorators/require-permissions.decorator.ts accepting ...permissions: string[]
- [x] T012 Create PermissionsGuard in src/common/guards/permissions.guard.ts implementing CanActivate, reading @RequirePermissions metadata, checking req.user.permissions
- [x] T013 Add @CurrentUser decorator in src/common/decorators/current-user.decorator.ts extracting user from request
- [x] T014 Update accounts.module.ts to import AdministrationModule (or forwardRef) for AuditLogsService injection
- [x] T015 Create custom HttpExceptionFilter or extend existing one in src/common/filters/ to handle business error codes (PERMISSION_CODE_DUPLICATE, etc.)
- [x] T016 [P] Create permissions.service.ts in src/modules/accounts/services/ with method stubs: create, findAll, findOne, update, toggleActive
- [x] T017 [P] Create role-permissions.service.ts in src/modules/accounts/services/ with method stubs: assign, revoke, findByRole

---

## Phase 3 — User Story 1: Permission CRUD

*US1: System Administrator quản lý vòng đời permission (tạo, xem, sửa, toggle, liệt kê).*

**Story Goal**: Admin có thể tạo, xem, cập nhật, kích hoạt/vô hiệu hóa, và liệt kê permissions.

**Independent Test Criteria**:
- Gọi tất cả 5 endpoints của Permission CRUD với JWT admin hợp lệ
- Validation fail trả về 4xx với error code tương ứng
- Duplicate permissionCode trả về 409
- Toggle-active thay đổi isActive

- [x] T018 [US1] Implement PermissionEntity injection in permissions.service.ts via @InjectRepository(PermissionEntity)
- [x] T019 [US1] Implement create method in permissions.service.ts: validate unique permissionCode → throw PERMISSION_CODE_DUPLICATE if exists; save entity with isActive=true; return response
- [x] T020 [US1] Implement findAll method in permissions.service.ts: paginate with page/limit/sortBy/sortOrder; filter by moduleCode (exact match); search by permissionCode/permissionName (ILIKE); return paginated result
- [x] T021 [US1] Implement findOne method in permissions.service.ts: findById → throw PERMISSION_NOT_FOUND if not exist
- [x] T022 [US1] Implement update method in permissions.service.ts: findById → check permissionCode not in body → throw VALIDATION_ERROR if sent; update only permissionName and description; save
- [x] T023 [US1] Implement toggleActive method in permissions.service.ts: findById → flip isActive → save; return new isActive
- [x] T024 [P] [US1] Create permissions.controller.ts in src/modules/accounts/controllers/ with 5 endpoints: GET /permissions, GET /permissions/:id, POST /permissions, PATCH /permissions/:id, POST /permissions/:id/toggle-active
- [x] T025 [US1] Add @UseGuards(JwtAuthGuard, PermissionsGuard) and @RequirePermissions('admin.manage_permissions') on all write endpoints; @RequirePermissions('admin.manage_permissions', 'permission.read') on GET endpoints
- [x] T026 [US1] In accounts.module.ts: register PermissionsController and PermissionsService in module providers/controllers

---

## Phase 4 — User Story 2: Role-Permission Assignment

*US2: System Administrator gán/gỡ permission cho role, bulk assign với transaction, fatal/non-fatal semantics.*

**Story Goal**: Admin có thể xem, gán (bulk), và gỡ permission cho role, với transaction bảo vệ và system role protection.

**Independent Test Criteria**:
- Bulk assign tạo role_permission records trong transaction
- Fatal error (permission not found/inactive) rollback toàn bộ
- Non-fatal (duplicate) skip và tiếp tục
- System role không gỡ được admin module permissions
- Audit log được ghi cho mọi thao tác ghi

- [x] T027 [US2] Implement findByRole method in role-permissions.service.ts: find by roleId, join permission relation; throw ROLE_NOT_FOUND if role not exist
- [x] T028 [US2] Implement assign method in role-permissions.service.ts: Phase 1 (validate) — check roleId exists, check all permissionIds exist and isActive=true → fatal errors throw immediately; Phase 2 (process with QueryRunner transaction) — filter already-assigned (skip), filter request-duplicates (skip), insert new records with grantedBy from JWT and grantedAt=now(); commit; return { assigned, skippedAlreadyAssigned, skippedDuplicatedInRequest }
- [x] T029 [US2] Implement revoke method in role-permissions.service.ts: find role_permission by roleId+permissionId → throw PERMISSION_NOT_ASSIGNED if not exist; check role.isSystemRole AND permission.moduleCode === 'admin' → throw CANNOT_REVOKE_SYSTEM_PERMISSION; delete record
- [x] T030 [P] [US2] Create role-permissions.controller.ts in src/modules/accounts/controllers/ with 3 endpoints: GET /roles/:roleId/permissions, POST /roles/:roleId/permissions, DELETE /roles/:roleId/permissions/:permissionId
- [x] T031 [US2] Add @UseGuards(JwtAuthGuard, PermissionsGuard) and @RequirePermissions('admin.manage_permissions') on all endpoints
- [x] T032 [US2] In accounts.module.ts: register RolePermissionsController and RolePermissionsService in module providers/controllers
- [x] T033 [US2] Implement AssignPermissionsResponseDto in src/modules/accounts/dto/ with assigned string[], skippedAlreadyAssigned string[], skippedDuplicatedInRequest string[]
- [x] T034 Add NFR coverage table to Requirements Coverage section in tasks.md documenting NFR-001 through NFR-017 with corresponding task mappings

---

## Phase 5 — Audit Integration

*Phase này tích hợp AuditLogsService vào cả 2 services.*

- [x] T035 [US1] Inject AuditLogsService into permissions.service.ts; after successful create → log CREATE_PERMISSION with userId, entityType='permission', entityId, newValueJson; after update → log UPDATE_PERMISSION with oldValueJson/newValueJson; after toggleActive → log TOGGLE_PERMISSION with oldValueJson/newValueJson
- [x] T036 [US2] Inject AuditLogsService into role-permissions.service.ts; after successful bulk assign (only when at least 1 assigned) → log ASSIGN_PERMISSION with entityType='role_permission', entityId=roleId, metadataJson={ assignedPermissionIds, skippedAlreadyAssigned, skippedDuplicatedInRequest }; after revoke → log REVOKE_PERMISSION with entityId=permissionId, metadataJson={ roleId }

---

## Phase 6 — Testing

*Unit tests cho DTOs, services, controllers.*

- [x] T037 [P] Write create-permission.dto.spec.ts testing: valid input passes, missing fields fail, invalid permissionCode format fails, invalid moduleCode fails, length overflow fails
- [x] T038 [P] Write update-permission.dto.spec.ts testing: empty body passes, permissionName update passes, permissionCode in body rejected via whitelist
- [x] T039 [P] Write assign-permissions.dto.spec.ts testing: valid UUID array passes, empty array fails, invalid UUID fails
- [x] T040 [P] Write permissions.service.spec.ts testing: create success, duplicate code → 409, findAll pagination/filter/search, findOne found/not-found, update success/permissionCode-immutable, toggleActive success/not-found, audit log called on write operations
- [x] T041 [P] Write role-permissions.service.spec.ts testing: assign success with transaction, fatal errors (role not found → 404, permission not found → 404, inactive permission → 422) rollback and no records created, non-fatal skip (already assigned, duplicate in request), all-skipped returns success no-op, revoke success, revoke system role admin permission → 422, revoke system role non-admin permission → 200, audit log called on successful assign/revoke
- [x] T042 [P] Write permissions.controller.spec.ts testing: GET /permissions returns 200, POST /permissions returns 201, PATCH /permissions/:id returns 200, POST /permissions/:id/toggle-active returns 200, DELETE not implemented (not in spec), guard triggers on unauthenticated request → 401, guard triggers on missing permission → 403
- [x] T043 [P] Write role-permissions.controller.spec.ts testing: GET returns 200, POST returns 201/200, DELETE returns 200, guard triggers → 401/403

---

## Phase 7 — Polish & Cross-Cutting

*Final phase: API prefix, CORS, error filter, documentation.*

- [x] T044 Ensure all controllers use @Controller() with path matching spec (e.g., @Controller('permissions'), @Controller('roles/:roleId/permissions'))
- [x] T045 Verify response format matches convention ({ success, message, data, meta }) across all endpoints
- [x] T046 Verify error responses include error.code, timestamp, path fields
- [x] T047 Verify pagination meta format (page, limit, total, totalPages) on list endpoints
- [x] T048 Verify moduleCode allowlist constant is exported for reuse in other modules if needed

---

## Dependency Graph

`
Phase 1 (T001-T010) ──→ Phase 2 (T011-T017) ──→ Phase 3 (T018-T026) ──→ Phase 5 (T035-T036)
                                          │                                         
                                          └──→ Phase 4 (T027-T033) ──→ Phase 5 (T036)
                                                                        │
                                                                        └──→ Phase 6 (T037-T043) ──→ Phase 7 (T044-T048)
`

**T001-T010**: No dependencies — parallel within phase
**T011-T017**: Depends on T001-T010 — T011/T012 independent, T014 depends on audit service discovery
**T018-T026**: Depends on T011-T017 — T024 parallel
**T027-T033**: Depends on T011-T017 — T030 parallel
**T035-T036**: Depends on T018-T026 and T027-T033 respectively — T035 parallel with T036
**T037-T043**: Depends on T035-T036 — all parallel within phase
**T044-T048**: Depends on T037-T043

---

## Parallel Execution Opportunities

| Batch | Tasks | Reason |
|---|---|---|
| Batch A | T002, T003, T004, T005, T006, T007, T008, T009, T010 | All Phase 1 — independent DTOs/constants/validators |
| Batch B | T011, T012, T013, T015, T016, T017 | All Phase 2 — independent guards/decorators/services |
| Batch C | T018–T023, T024 | Service logic + controller — different files |
| Batch D | T027–T029, T030 | Service logic + controller — different files |
| Batch E | T035, T036 | Different services — independent audit integration |
| Batch F | T037, T038, T039, T040, T041, T042, T043 | All tests — independent spec files |

---

## Implementation Strategy

1. **MVP (Phase 1 + 2 + 3)**: Permission CRUD cơ bản — create, list, detail, update, toggle. Đã đủ để test permission catalog.
2. **Incremental 1 (Phase 4)**: Role-permission assign/revoke — bulk assign với transaction.
3. **Incremental 2 (Phase 5)**: Audit log integration — ghi vết mọi thao tác.
4. **Incremental 3 (Phase 6)**: Tests cho tất cả components.
5. **Final (Phase 7)**: Polish — response format, error codes, pagination meta.

---

## Requirements Coverage

### Functional Requirements → Tasks

| FR ID | Task(s) | Mô tả |
|---|---|---|
| FR-001 | T019, T024, T025 | Create permission |
| FR-002 | T019, T037 | Unique permissionCode |
| FR-003 | T020, T024, T025 | List with pagination + filter + search |
| FR-004 | T021, T024, T025 | Detail permission |
| FR-005 | T022, T024, T025 | Update permissionName/description |
| FR-006 | T022, T038 | Immutable permissionCode |
| FR-007 | T023, T024, T025 | Toggle active |
| FR-008 | T027, T030, T031 | List role permissions |
| FR-009 | T028, T030, T031, T033 | Bulk assign with grantedBy/grantedAt |
| FR-010 | T029, T030, T031 | Revoke permission from role |
| FR-011 | T028, T034 | grantedAt auto-set |
| FR-012 | T019 | Validate unique code before create |
| FR-013 | T028, T041 | Bulk assign fatal/non-fatal validation |
| FR-014 | T029, T041 | System role revoke check (only admin module) |
| FR-015 | T023 | Validate toggle permission exists |
| FR-016 | T022 | Validate update permission exists |
| FR-017 | T028, T041 | Inactive permission → not assignable (fatal) |
| FR-018 | T029, T041 | System role — only protect admin module permissions |
| FR-019 | T028 | Maintain role_permissions integrity |
| FR-020 | T019, T040 | Duplicate → 409 |
| FR-021 | T008, T037 | Invalid format → validation error |
| FR-022 | T028, T041 | Duplicate → non-fatal skip |
| FR-023 | T029, T041 | System role + admin module → reject revoke |
| FR-024 | T028, T041 | Inactive permission → fatal rollback |
| FR-025 | T029, T041 | Permission not assigned → 404 |
| FR-026 | T028, T029, T041 | Role not found → 404 |
| FR-027 | T019, T021, T028, T040, T041 | Permission not found → 404 |
| FR-028 | T011, T012, T025, T031, T042, T043 | Unauthenticated → 401 |
| FR-029 | T011, T012, T025, T031, T042, T043 | No admin.manage_permissions → 403 |
| FR-030 | T025, T031 | Check permission before write |
| FR-031 | T025 | permission.read for GET endpoints |
| FR-032 | T019 | isActive = true on create |
| FR-033 | T023 | updatedAt on isActive change |
| FR-034 | T028 | grantedBy from JWT, grantedAt = now() |
| FR-035 | T035, T040 | Audit log for CRUD operations |
| FR-036 | T036, T041 | Audit log for assign/revoke (bulk summary) |
| FR-037 | T028, T041 | Fatal vs non-fatal in bulk assign |
| FR-038 | T023, T040 | Active → Inactive on toggle |
| FR-039 | T023, T040 | Inactive → Active on toggle |

### Error Requirements → Tasks

| ERR ID | Task(s) | Mô tả |
|---|---|---|
| ERR-001 | T003, T037 | Missing permissionCode → validation error |
| ERR-002 | T008, T037 | Invalid format → INVALID_PERMISSION_CODE_FORMAT |
| ERR-003 | T003, T037 | permissionName > 150 chars |
| ERR-004 | T003, T037 | moduleCode > 80 chars |
| ERR-005 | T003, T037 | actionCode > 80 chars |
| ERR-006 | T005, T039 | Empty permissionIds |
| ERR-007 | T005, T039 | Invalid UUID in permissionIds |
| ERR-008 | T010, T037 | page/limit negative |
| ERR-009 | T010, T037 | limit > 100 |
| ERR-010 | T011, T012, T042, T043 | Unauthenticated → 401 |
| ERR-011 | T012, T042, T043 | No admin.manage_permissions → 403 |
| ERR-012 | T011, T042, T043 | Expired JWT → 401 |
| ERR-013 | T019, T040 | Duplicate → 409 |
| ERR-014 | T028, T041 | Inactive permission → 422 |
| ERR-015 | T029, T041 | System role + admin module → 422 |
| ERR-016 | T029, T041 | Permission not assigned → 404 |
| ERR-017 | T028, T041 | Duplicate assign → non-fatal skip |
| ERR-018 | T028 | Concurrency conflict → retry error |
| ERR-019 | T009, T037 | moduleCode not in allowlist → 400 |

### Acceptance Criteria → Tasks

| AC ID | Task(s) | Mô tả |
|---|---|---|
| AC-001 | T019, T024, T042 | Create permission success |
| AC-002 | T020, T024, T042 | List permissions |
| AC-003 | T021, T024, T042 | Get permission detail |
| AC-004 | T022, T024, T042 | Update permission |
| AC-005 | T023, T024, T042 | Toggle-active |
| AC-006 | T028, T030, T033, T043 | Bulk assign fatal/non-fatal |
| AC-007 | T029, T030, T043 | Revoke permission |
| AC-008 | T027, T030, T043 | List role permissions |
| AC-009 | T003, T037, T042 | Missing field → 400 |
| AC-010 | T008, T037, T042 | Invalid format → 400 |
| AC-011 | T005, T039, T043 | Empty array → 400 |
| AC-012 | T010, T037, T042 | Limit > 100 → 400 |
| AC-013 | T011, T012, T042, T043 | No JWT → 401 |
| AC-014 | T011, T042, T043 | Expired JWT → 401 |
| AC-015 | T011, T012, T042, T043 | No permission → 403 |
| AC-016 | T019, T040 | Duplicate code → 409 |
| AC-017 | T028, T041 | Inactive assign → 422 rollback |
| AC-018 | T029, T041 | Admin module revoke → 422 |
| AC-019 | T029, T041 | Non-admin module revoke → 200 |
| AC-020 | T022, T038, T040 | Update code → rejected |
| AC-021 | T028, T041 | Duplicate assign → non-fatal skip |
| AC-022 | T023, T040 | Active → Inactive |
| AC-023 | T023, T040 | Inactive → Active |
| AC-024 | T035, T040 | Audit log for create |
| AC-025 | T036, T041 | Audit log for bulk assign |

---

## Task Summary

| Phase | Task IDs | Count | Description |
|---|---|---|---|
| Phase 1 — Setup | T001–T010 | 10 | DTOs, constants, custom validators |
| Phase 2 — Foundational | T011–T017 | 7 | Guards, decorators, module wiring |
| Phase 3 — US1: Permission CRUD | T018–T026 | 9 | Service + controller + module registration |
| Phase 4 — Role-Permission | T027–T034 | 8 | Service + controller + response DTO |
| Phase 5 — Audit | T035–T036 | 2 | AuditLogsService integration |
| Phase 6 — Testing | T037–T043 | 7 | Unit tests for DTOs, services, controllers |
| Phase 7 — Polish | T044–T048 | 5 | API prefix, response format, pagination |
| **Total** | T001–T048 | **48** | |

**Parallel tasks**: 20 (marked [P])
**User story tasks**: 20 (T018–T033 — US1 + US2)







