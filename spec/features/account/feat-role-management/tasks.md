## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-18 | Tạo tasks.md cho Role Management (RolesService + RolesController) | Toàn bộ file |

---

# Tasks: Role Management (RolesService + RolesController)

**Feature Directory**: spec/features/account/feat-role-management/
**Plan**: plan.md
**Spec**: spec.md
**Data Model**: data-model.md
**API Contract**: contracts/role-management-api.md
**Quickstart**: quickstart.md

---

## Phase 1 — Setup (DTOs & Constants)

*Phase này tạo DTOs và constants. Không có user story label. Copy 1:1 cấu trúc từ `feat-permission-management` Phase 1.*

- [ ] T001 [P] Create `role-sort-fields.constant.ts` in `src/modules/accounts/constants/` exposing `ROLE_SORT_FIELDS = ['createdAt', 'roleCode', 'roleName']`
- [ ] T002 [P] Create `create-role.dto.ts` in `src/modules/accounts/dto/` with class-validator: `@Transform` (trim + uppercase roleCode), `@IsString`, `@Matches(/^[A-Z][A-Z0-9_]{1,49}$/)`, `@MaxLength(50)` for roleCode; `@IsString`, `@MaxLength(100)` for roleName; `@IsOptional`, `@IsString` for description. KHÔNG khai báo field `isSystemRole`.
- [ ] T003 [P] Create `update-role.dto.ts` in `src/modules/accounts/dto/` with `@IsOptional`, `@MaxLength(100)` for roleName; `@IsOptional`, `@IsString` for description; `@IsOptional`, `@IsBoolean` for isActive. KHÔNG khai báo `roleCode`/`isSystemRole`.
- [ ] T004 [P] Create `role-response.dto.ts` in `src/modules/accounts/dto/` exposing `id, roleCode, roleName, description, isSystemRole, isActive, createdAt, updatedAt`
- [ ] T005 [P] Create `role-detail-response.dto.ts` in `src/modules/accounts/dto/` extending RoleResponseDto shape + `assignedUserCount: number`
- [ ] T006 [P] Create `list-roles-query.dto.ts` in `src/modules/accounts/dto/` with `page`/`limit` (mirror `pagination-query.dto.ts`), `sortBy` (`@IsIn(ROLE_SORT_FIELDS)`), `sortOrder`, `isActive` (`@IsOptional`, `@Type(() => Boolean)`, `@IsBoolean`), `search` (`@IsOptional`, `@IsString`)

---

## Phase 2 — RolesService (Role CRUD business logic)

*US1: System Administrator quản lý vòng đời role (tạo, xem, sửa, xóa). Copy pattern từ `permissions.service.ts`.*

**Story Goal**: Admin có thể tạo, xem, cập nhật, xóa (soft-delete) role với đầy đủ business rule bảo vệ system role và role đang được dùng.

**Independent Test Criteria**:
- Gọi tất cả 5 method service (create/findAll/findOne/update/remove) với dữ liệu hợp lệ và không hợp lệ
- Duplicate roleCode → ConflictException (ROLE_CODE_DUPLICATE)
- Update/Delete system role → UnprocessableEntityException tương ứng
- Delete role đang dùng → ConflictException (ROLE_IN_USE)
- Audit log được gọi sau mỗi thao tác ghi thành công

- [ ] T007 Create `services/roles.service.ts` in `src/modules/accounts/services/` injecting `@InjectRepository(RoleEntity)`, `@InjectRepository(UserRoleEntity)`, và `AuditLogsService` (mirror constructor của `PermissionsService`)
- [ ] T008 Implement `create(dto: CreateRoleDto, userId: string)` in roles.service.ts: check `roleRepo.findOne({ where: { roleCode: dto.roleCode } })` → throw `ConflictException({ error: { code: 'ROLE_CODE_DUPLICATE' } })` nếu tồn tại; `roleRepo.create({ ...dto, isActive: true, isSystemRole: false })`; save; gọi `auditLogsService.logAction({ userId, actionType: 'CREATE_ROLE', entityType: 'role', entityId: saved.id, metadataJson: { roleCode: saved.roleCode } })`; return response
- [ ] T009 Implement `findAll(query: ListRolesQueryDto)` in roles.service.ts: paginate page/limit; filter `isActive` nếu query có; search `roleCode`/`roleName` bằng `ILIKE` (2 điều kiện OR, mirror cách `DepartmentsService.listDepartments` dùng mảng where OR); order theo sortBy/sortOrder; return `{ data, total }`
- [ ] T010 Implement `findOne(id: string)` in roles.service.ts: `roleRepo.findOne({ where: { id } })` → throw `NotFoundException({ error: { code: 'ROLE_NOT_FOUND' } })` nếu không có; `userRoleRepo.count({ where: { roleId: id, isActive: true } })` → gán vào `assignedUserCount`; return RoleDetailResponseDto
- [ ] T011 Implement `update(id: string, dto: UpdateRoleDto, userId: string)` in roles.service.ts: tìm role → 404 nếu không có; nếu `dto.isActive === false && entity.isSystemRole === true` → throw `UnprocessableEntityException({ error: { code: 'CANNOT_MODIFY_SYSTEM_ROLE' } })`; cập nhật `roleName`/`description`/`isActive` nếu có trong dto (giữ nguyên field không gửi, mirror `PermissionsService.update`); save; ghi audit log `UPDATE_ROLE` với oldValueJson/newValueJson chứa `{ roleName, description, isActive }` trước/sau
- [ ] T012 Implement `remove(id: string, userId: string)` in roles.service.ts theo đúng thứ tự FR-032: (1) tìm role → 404 `ROLE_NOT_FOUND` nếu không có; (2) nếu `entity.isSystemRole === true` → 422 `CANNOT_DELETE_SYSTEM_ROLE`; (3) `userRoleRepo.count({ where: { roleId: id, isActive: true } })` > 0 → 409 `ROLE_IN_USE`; (4) set `isActive = false`, save, ghi audit log `DELETE_ROLE` với `oldValueJson: { isActive: true }, newValueJson: { isActive: false }`

---

## Phase 3 — RolesController

*Copy pattern từ `permissions.controller.ts`. Guard/decorator đã tồn tại, không cần tạo mới (khác feat-permission-management).*

- [ ] T013 [P] Create `controllers/roles.controller.ts` in `src/modules/accounts/controllers/` with `@Controller('roles')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)` ở class level, 5 endpoints: `GET /roles`, `GET /roles/:id`, `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id`
- [ ] T014 Add `@RequirePermissions('account.role.read')` trên `GET /roles` và `GET /roles/:id`; `@RequirePermissions('account.role.create')` trên `POST /roles`; `@RequirePermissions('account.role.update')` trên `PATCH /roles/:id`; `@RequirePermissions('account.role.delete')` trên `DELETE /roles/:id`
- [ ] T015 Trong `update()` handler của roles.controller.ts: kiểm tra thủ công `(dto as any).roleCode` hoặc `(dto as any).isSystemRole` tồn tại trong body → throw `BadRequestException({ error: { code: 'VALIDATION_ERROR', details: { field } } })` TRƯỚC khi gọi `rolesService.update()` (mirror `PermissionsController.update` chặn `permissionCode`)
- [ ] T016 Trong các write endpoint (`create`, `update`, `remove`): lấy `userId` từ `@CurrentUser()`, nếu thiếu → throw `BadRequestException({ error: { code: 'UNAUTHORIZED' } })` (mirror `PermissionsController`); trả response theo format `{ success, message, data }` với message tiếng Việt phù hợp từng action

---

## Phase 4 — Module Registration

*Wiring vào AccountsModule. Không cần import module mới (AdministrationModule/AuthModule đã có sẵn).*

- [ ] T017 Update `accounts.module.ts`: import `RolesController` vào mảng `controllers`, `RolesService` vào mảng `providers`. `RoleEntity` và `UserRoleEntity` đã có sẵn trong `TypeOrmModule.forFeature([...])` — không cần thêm.

---

## Phase 5 — Permission Seed (data seed, không phải schema migration)

*Ghi nhận yêu cầu seed 4 permission mới. Mirror chính xác pattern file `20260712000001-SeedUserUpdateRolesPermission.ts` (dùng `INSERT ... ON CONFLICT (permission_code) DO NOTHING`, transaction qua QueryRunner, gán cho role `SYSTEM_ADMIN`). Các seed file trong `src/database/seeds/*SeedXxxPermission.ts` HIỆN KHÔNG có runner tự động — chỉ tạo file, chạy thủ công theo quy trình seed của dự án sau khi được duyệt (ghi rõ cảnh báo này trong file, mirror seed mẫu).*

- [ ] T018 [P] Create seed file (đặt tên theo convention `YYYYMMDDHHMMSS-SeedRoleCreatePermission.ts` trong `src/database/seeds/`) insert permission `account.role.create` (`module_code='accounts', action_code='create'`), gán cho role `SYSTEM_ADMIN`
- [ ] T019 [P] Create seed file insert permission `account.role.read` (`module_code='accounts', action_code='read'`), gán cho role `SYSTEM_ADMIN`
- [ ] T020 [P] Create seed file insert permission `account.role.update` (`module_code='accounts', action_code='update'`), gán cho role `SYSTEM_ADMIN`
- [ ] T021 [P] Create seed file insert permission `account.role.delete` (`module_code='accounts', action_code='delete'`), gán cho role `SYSTEM_ADMIN`

---

## Phase 6 — Testing

*Unit tests cho DTOs, service, controller. Mirror `permissions.service.spec.ts` / `permissions.controller.spec.ts`.*

- [ ] T022 [P] Write `dto/create-role.dto.spec.ts` testing: valid input passes, missing roleCode/roleName fails, invalid roleCode format (lowercase/space) fails, roleCode length > 50 fails
- [ ] T023 [P] Write `dto/update-role.dto.spec.ts` testing: empty body passes, roleName/description/isActive update passes, roleCode/isSystemRole in body rejected via whitelist (nếu dùng `forbidNonWhitelisted`) hoặc bị strip
- [ ] T024 [P] Write `services/roles.service.spec.ts` testing: create success + audit log called, duplicate roleCode → 409, findAll pagination/filter isActive/search, findOne found (kèm assignedUserCount đúng) / not-found, update success (roleName/description/isActive), update isActive=false trên system role → 422, remove success (audit log called), remove system role → 422, remove role đang có user active → 409, remove role hợp lệ → soft-delete thành công
- [ ] T025 [P] Write `controllers/roles.controller.spec.ts` testing: GET /roles → 200, GET /roles/:id → 200, POST /roles → 201, PATCH /roles/:id → 200, PATCH với roleCode trong body → 400, DELETE /roles/:id → 200, guard triggers unauthenticated → 401, guard triggers thiếu permission → 403 cho từng endpoint tương ứng

---

## Phase 7 — Polish & Cross-Cutting

*Final phase: response format, error codes, regression check với các endpoint liên quan không đổi.*

- [ ] T026 Verify response format matches convention (`{ success, message, data, meta }`) across all 5 endpoints
- [ ] T027 Verify error responses include `error.code`, `timestamp`, `path` fields
- [ ] T028 Verify pagination meta format (`page, limit, total, totalPages`) on GET /roles
- [ ] T029 Regression check: `RolePermissionsController`/`RolePermissionsService` và `PUT /users/:userId/roles` (UsersController) không bị ảnh hưởng — chạy lại test suite hiện có của 2 thành phần này sau khi wiring `RolesController`/`RolesService` vào `accounts.module.ts`

---

## Dependency Graph

```
Phase 1 (T001-T006) ──→ Phase 2 (T007-T012) ──→ Phase 3 (T013-T016) ──→ Phase 4 (T017) ──→ Phase 6 (T022-T025) ──→ Phase 7 (T026-T029)
                                                                              │
Phase 5 (T018-T021) ──────────────────────────────────────────────────────────┘ (độc lập, chỉ cần chạy trước khi QA/integration test thật với PermissionsGuard)
```

**T001-T006**: Không phụ thuộc — parallel trong phase
**T007-T012**: Phụ thuộc T001-T006 (cần DTO/constant tồn tại để import type)
**T013-T016**: Phụ thuộc T007-T012 (cần RolesService tồn tại để inject)
**T017**: Phụ thuộc T007-T016
**T018-T021**: Độc lập với code phase — có thể làm song song bất kỳ lúc nào, nhưng phải chạy trước khi test integration thật (PermissionsGuard cần permission đã seed để không luôn deny)
**T022-T025**: Phụ thuộc T007-T017
**T026-T029**: Phụ thuộc T022-T025

---

## Parallel Execution Opportunities

| Batch | Tasks | Reason |
|---|---|---|
| Batch A | T001, T002, T003, T004, T005, T006 | Tất cả Phase 1 — DTOs/constants độc lập |
| Batch B | T018, T019, T020, T021 | Tất cả Phase 5 — 4 seed file độc lập nhau |
| Batch C | T022, T023, T024, T025 | Tất cả Phase 6 — test file độc lập |

---

## Implementation Strategy

1. **MVP (Phase 1 + 2 + 3 + 4)**: Role CRUD đầy đủ — create, list, detail, update, delete với business rule bảo vệ system role/role-in-use. Đã đủ để test tính năng qua Postman/Swagger (permission check sẽ luôn 403 cho tới khi Phase 5 chạy).
2. **Incremental 1 (Phase 5)**: Seed 4 permission mới, gán cho SYSTEM_ADMIN — bắt buộc trước khi test thật với JWT có PermissionsGuard.
3. **Incremental 2 (Phase 6)**: Unit test đầy đủ cho DTO/service/controller.
4. **Final (Phase 7)**: Polish response format + regression check các thành phần liên quan không đổi.

---

## Requirements Coverage

### Functional Requirements → Tasks

| FR ID | Task(s) | Mô tả |
|---|---|---|
| FR-001 | T008, T013, T014 | Create role |
| FR-002 | T008, T024 | Unique roleCode |
| FR-003 | T009, T013, T014 | List với pagination + filter + search |
| FR-004 | T010, T013, T014 | Detail role + assignedUserCount |
| FR-005 | T011, T013, T014 | Update roleName/description/isActive |
| FR-006 | T011, T015, T023 | Immutable roleCode/isSystemRole |
| FR-007 | T002, T008 | Chặn tạo role isSystemRole=true qua API |
| FR-008 | T012, T013, T014 | Delete (soft) role |
| FR-009 | T008 | Validate unique code trước khi tạo |
| FR-010 | T011 | Validate tồn tại trước khi update |
| FR-011 | T012 | Thứ tự kiểm tra khi xóa |
| FR-012 | T010 | Tính assignedUserCount |
| FR-013 | T011, T024 | Chặn deactivate system role |
| FR-014 | T012, T024 | Chặn delete system role |
| FR-015 | T012, T024 | Chặn delete role đang gán user active |
| FR-016 | T009, T010 | Không ẩn role inactive khỏi GET |
| FR-017 | T008, T024 | roleCode trùng → 409 |
| FR-018 | T002, T022 | roleCode sai format → 400 |
| FR-019 | T015, T025 | Update field immutable → 400 |
| FR-020 | T012, T024 | Xóa system role → 422 |
| FR-021 | T011, T024 | Deactivate system role → 422 |
| FR-022 | T012, T024 | Xóa role đang dùng → 409 |
| FR-023 | T010, T011, T012 | Role không tồn tại → 404 |
| FR-024 | T014, T025 | Unauthenticated → 401 (guard có sẵn) |
| FR-025 | T014, T025 | Thiếu account.role.create → 403 |
| FR-026 | T014, T025 | Thiếu account.role.update → 403 |
| FR-027 | T014, T025 | Thiếu account.role.delete → 403 |
| FR-028 | T014, T025 | Thiếu account.role.read → 403 |
| FR-029 | T008 | Default isActive=true, isSystemRole=false |
| FR-030 | T011 | updatedAt khi update |
| FR-031 | T008, T011, T012 | Audit log create/update/delete |
| FR-032 | T012, T024 | Thứ tự 404 → 422 → 409 khi xóa |

### Error Requirements → Tasks

| ERR ID | Task(s) | Mô tả |
|---|---|---|
| ERR-001 | T002, T022 | Missing roleCode → validation error |
| ERR-002 | T002, T022 | Invalid roleCode format → INVALID_ROLE_CODE_FORMAT |
| ERR-003 | T002, T022 | roleName > 100 chars |
| ERR-004 | T002, T022 | Missing roleName |
| ERR-005 | T015, T025 | roleCode/isSystemRole trong PATCH body → VALIDATION_ERROR |
| ERR-006 | T006 | page/limit âm |
| ERR-007 | T006 | limit > 100 |
| ERR-008 | T014, T025 | Unauthenticated → 401 |
| ERR-009 | T014, T025 | Expired JWT → 401 |
| ERR-010 | T014, T025 | Thiếu permission tương ứng → 403 |
| ERR-011 | T008, T024 | roleCode trùng → 409 |
| ERR-012 | T012, T024 | Xóa system role → 422 |
| ERR-013 | T011, T024 | Deactivate system role → 422 |
| ERR-014 | T012, T024 | Xóa role đang dùng → 409 |
| ERR-015 | T010, T011, T012 | Role không tồn tại → 404 |
| ERR-016 | T008 | Race condition tạo trùng roleCode (known limitation, không auto-retry) |

### Acceptance Criteria → Tasks

| AC ID | Task(s) | Mô tả |
|---|---|---|
| AC-001 | T008, T013, T025 | Create role success |
| AC-002 | T009, T013, T025 | List roles |
| AC-003 | T010, T013, T025 | Get role detail + assignedUserCount |
| AC-004 | T011, T013, T025 | Update role |
| AC-005 | T012, T013, T025 | Delete role hợp lệ |
| AC-006 | T002, T022, T025 | Thiếu field bắt buộc → 400 |
| AC-007 | T002, T022, T025 | roleCode sai format → 400 |
| AC-008 | T015, T025 | Update field immutable → 400 |
| AC-009 | T006, T025 | Limit > 100 → 400 |
| AC-010 | T014, T025 | Không JWT → 401 |
| AC-011 | T014, T025 | JWT hết hạn → 401 |
| AC-012 | T014, T025 | Thiếu account.role.create → 403 |
| AC-013 | T008, T024 | roleCode trùng → 409 |
| AC-014 | T012, T024 | Xóa system role → 422 |
| AC-015 | T011, T024 | Deactivate system role → 422 |
| AC-016 | T012, T024 | Xóa role đang dùng user active → 409 |
| AC-017 | T012, T024 | Xóa role hợp lệ (đủ điều kiện) |
| AC-018 | T011, T024 | Sửa roleName/description system role vẫn OK |
| AC-019 | T011, T024 | Active → Inactive (role thường) |
| AC-020 | T011, T024 | Inactive → Active |
| AC-021 | T008, T024 | Audit log tạo role |
| AC-022 | T012, T024 | Audit log xóa role |

---

## Task Summary

| Phase | Task IDs | Count | Description |
|---|---|---|---|
| Phase 1 — Setup | T001–T006 | 6 | DTOs, constants |
| Phase 2 — RolesService | T007–T012 | 6 | Service methods + audit integration |
| Phase 3 — RolesController | T013–T016 | 4 | Controller endpoints + guard wiring |
| Phase 4 — Module Registration | T017 | 1 | accounts.module.ts wiring |
| Phase 5 — Permission Seed | T018–T021 | 4 | 4 seed file cho permission mới |
| Phase 6 — Testing | T022–T025 | 4 | Unit tests DTO/service/controller |
| Phase 7 — Polish | T026–T029 | 4 | Response format + regression check |
| **Total** | T001–T029 | **29** | |

**Parallel tasks**: 14 (marked [P])
**User story tasks**: 10 (T007–T016 — Role CRUD)
