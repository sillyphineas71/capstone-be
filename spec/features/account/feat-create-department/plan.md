# Implementation Plan: Khởi tạo phòng ban mới (UC-AM-03)

**Feature ID**: ORG-DEPT-CREATE-001
**Spec**: spec/features/account/feat-create-department/spec.md
**Module**: accounts
**Tech Stack**: NestJS + TypeORM + PostgreSQL + JWT + class-validator

---

## 1. Feature Summary

Cho phép Business Admin (ADMIN/MANAGER) khởi tạo phòng ban mới với departmentCode (unique, uppercase, regex pattern), departmentName (unique, safe charset), parentDepartmentId (optional, depth ≤ 5, no circular ref), managerUserId (optional), và description. Hệ thống validate input, kiểm tra unique/app-level + DB constraint, ghi audit log, trả về 201 với 9 fields.

Implementation gồm 1 endpoint duy nhất: POST /api/v1/departments.

---

## 2. Technical Context

### Stack hiện tại
- **NestJS** modular monolith, ccounts module đã tồn tại.
- **TypeORM** với DepartmentEntity đã có (self-referencing, soft delete).
- **auth** module: JwtAuthGuard + PermissionsGuard + RequirePermissions decorator.
- **class-validator**: dùng trong DTO.
- **Swagger**: @nestjs/swagger decorators trên controller + DTO.
- **AdministrationModule**: cung cấp audit logging.
- **Database**: PostgreSQL v3.2 Compact (39 tables), departments table đã tồn tại.

### Existing code reuse
| Component | File | Reuse |
|---|---|---|
| DepartmentEntity | src/modules/accounts/entities/department.entity.ts | Có sẵn, cần thêm unique constraints |
| UsersController pattern | src/modules/accounts/controllers/users.controller.ts | Mẫu cho DepartmentsController |
| CreateUserDto pattern | src/modules/accounts/dto/create-user.dto.ts | Mẫu cho CreateDepartmentDto |
| UserResponseDto pattern | src/modules/accounts/dto/user-response.dto.ts | Mẫu cho DepartmentResponseDto |
| UsersService pattern | src/modules/accounts/services/users.service.ts | Mẫu cho DepartmentsService |
| Guards | src/modules/auth/guards/ | Reuse JwtAuthGuard + PermissionsGuard |
| Admin audit | src/modules/administration/ | Audit logging service |

---

## 3. Scope Confirmation

### In scope
- [x] POST /api/v1/departments — tạo phòng ban mới.
- [x] Validation: departmentCode regex + uppercase normalize, departmentName safe charset + trim.
- [x] Empty/whitespace → treated as missing for required fields.
- [x] Unique check: app-level + DB partial unique index (non-deleted).
- [x] Hierarchy: parentDepartmentId check existence, active, non-deleted, circular ref, depth ≤ 5.
- [x] managerUserId: check existence, active, non-deleted.
- [x] description: empty/whitespace → null.
- [x] Authorization: JWT + department.create permission.
- [x] Audit log ghi khi tạo thành công.
- [x] Race condition: DB unique constraint violation mapped to 409 DEPARTMENT_ALREADY_EXISTS.
- [x] Response 9 fields: id, departmentCode, departmentName, parentDepartmentId, managerUserId, description, isActive, createdAt, updatedAt.
- [x] DB migration: partial unique indexes for department_code, department_name (WHERE deleted_at IS NULL).
- [x] Seed: permission department.create cho ADMIN và MANAGER roles.

### Out of scope (specified in spec.md §8)
- [ ] GET /api/v1/departments — danh sách phòng ban.
- [ ] PATCH /api/v1/departments/:id — cập nhật phòng ban.
- [ ] DELETE /api/v1/departments/:id — xóa phòng ban.
- [ ] Import departments từ Excel.
- [ ] displayOrder field.
- [ ] Phân quyền theo phòng ban (data scoping).
- [ ] Notification khi tạo phòng ban.

---

## 4. Data Model Impact

### Entity changes
- DepartmentEntity đã tồn tại — không cần thêm column mới.
- Cần cập nhật: thêm @Index / @Unique decorators cho department_code và department_name.

### Migration required
1. Partial unique index: CREATE UNIQUE INDEX ux_departments_code ON departments(department_code) WHERE deleted_at IS NULL;
2. Partial unique index: CREATE UNIQUE INDEX ux_departments_name ON departments(department_name) WHERE deleted_at IS NULL;

### Detail: data-model.md
→ Xem data-model.md tại spec/features/account/feat-create-department/data-model.md

> **Task numbering note**: task IDs in this plan follow tasks.md canonical numbering (T001–T014). See tasks.md for authoritative task list with full descriptions and dependencies.

---

## 5. API / Contract Plan

### Endpoint
| Method | Path | Permission | Auth |
|---|---|---|---|
| POST | /api/v1/departments | department.create | JwtAuthGuard + PermissionsGuard |

### Request → Response
Chi tiết request body, field validation, response codes xem tại:
→ contracts/departments-api.md

### Error codes mapping

| HTTP | Error Code | When |
|---|---|---|
| 201 | — | Success |
| 400 | VALIDATION_ERROR | Missing/empty/whitespace required field |
| 401 | UNAUTHORIZED | No/invalid JWT |
| 403 | PERMISSION_DENIED | Missing permission |
| 404 | RESOURCE_NOT_FOUND | parent/manager not found/inactive/deleted |
| 409 | DEPARTMENT_ALREADY_EXISTS | Duplicate code/name (app or DB) |
| 422 | VALIDATION_ERROR | Regex fail, length, circular ref, depth > 5, emoji/control |
| 500 | INTERNAL_ERROR | Server error |

---

## 6. Authorization Plan

### Guard chain
`	ypescript
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('department.create')
`

### Permission seeding
- Permission code: department.create
- Module: ccounts
- Action: create
- Gán cho role: **ADMIN**, **MANAGER**
- Cần kiểm tra / seed trong bảng permissions và ole_permissions.

### Audit enforcement
- Sau khi tạo thành công, gọi AdministrationService ghi audit log.

---

## 7. Business Logic Plan

### Service method: DepartmentsService.createDepartment(dto, creatorId, auditContext)

Flow:

`
1. Trim + normalize input
   → departmentCode.toUpperCase()
   → trim departmentName, description
   → check empty/whitespace → throw ValidationException (400)

2. Validate format
   → departmentCode regex test → throw ValidationException (422)
   → departmentName length 2-150 + emoji/control check → throw (422)

3. Authorization (handled by guard — reach here only if permitted)

4. Check unique (app-level)
   → query department by code (non-deleted) → exists → throw 409
   → query department by name (non-deleted) → exists → throw 409

5. Validate optional references
   → if parentDepartmentId: check exists + active + non-deleted → throw 404
   → if parentDepartmentId: check circular ref (loop through ancestors) → throw 422
   → if parentDepartmentId: calculate depth (recursive query) ≤ 5 → throw 422
   → if managerUserId: check user exists + account_status=active + non-deleted → throw 404

6. Convert description: empty/whitespace → null

7. Transaction:
   a. Create DepartmentEntity with isActive=true, createdBy=creatorId
   b. Save to database
   c. Ghi audit_logs (action_type=create, entity_type=department)
   d. Commit transaction

8. Return DepartmentResponseDto (9 fields)
`

### Circular reference check algorithm
`
function wouldCreateCircularRef(parentDeptId, newDeptId):
  current = parentDeptId
  while current is not null:
    if current == newDeptId: return true (circular)
    current = getParentDept(current).parentDepartmentId
  return false
`

### Depth check algorithm
`
function calcDepth(deptId):
  depth = 1
  current = deptId
  while current.parentDepartmentId is not null:
    current = getParentDept(current.parentDepartmentId)
    depth++
  return depth

// Before insert: depth = calcDepth(parentDepartmentId) + 1
// if depth > 5 → throw 422
`

### Race condition handling
App-level unique check trước insert → vẫn có gap. Dùng DB unique constraint làm safety net. Catch QueryFailedError với unique violation code, map sang 409.

---

## 8. Validation Plan

Dùng class-validator decorators trên CreateDepartmentDto:

`	ypescript
// departmentCode
@IsString()
@IsNotEmpty()                    // empty/whitespace → fails
@Transform(({ value }) => (value as string)?.trim()?.toUpperCase())
@Matches(/^[A-Z0-9][A-Z0-9_-]{1,49}$/)
@Length(2, 50)

// departmentName
@IsString()
@IsNotEmpty()
@Transform(({ value }) => (value as string)?.trim())
@Length(2, 150)
@Matches(/^[\p{L}\p{N}\s&\-_.\/(),]+$/u)  // Unicode letters, numbers, spaces, common separators
// Riêng emoji/control check → custom validator hoặc regex bổ sung

// parentDepartmentId
@IsOptional()
@IsUUID()

// managerUserId
@IsOptional()
@IsUUID()

// description
@IsOptional()
@IsString()
@Transform(({ value }) => {
  const v = (value as string)?.trim();
  return v === '' || v === undefined || v === null ? null : v;
})
`

Custom validators cần tạo:
- @IsDepartmentCodeUnique() — gọi service check unique (app-level)
- @IsDepartmentNameUnique() — gọi service check unique (app-level)
- @NoEmojiOrControl() — kiểm tra không có emoji/control chars trong name

---

## 9. Error Handling Plan

### Exception mapping

| Exception | HTTP | Error Code | Source |
|---|---|---|---|
| BadRequestException | 400 | VALIDATION_ERROR | class-validator (missing/empty) |
| UnauthorizedException | 401 | UNAUTHORIZED | JwtAuthGuard |
| ForbiddenException | 403 | PERMISSION_DENIED | PermissionsGuard |
| NotFoundException | 404 | RESOURCE_NOT_FOUND | Service (parent/manager not found) |
| ConflictException | 409 | DEPARTMENT_ALREADY_EXISTS | Service (duplicate check) |
| UnprocessableEntityException | 422 | VALIDATION_ERROR | Service (regex, length, circular, depth, emoji) |
| QueryFailedError (23505) | 409 | DEPARTMENT_ALREADY_EXISTS | Catch filter (DB constraint) |

### Error response format
`json
{
  "success": false,
  "message": "User-friendly message",
  "error": {
    "code": "ERROR_CODE",
    "details": { "field": "departmentCode" }
  },
  "requestId": "req_xxx",
  "timestamp": "ISO-8601",
  "path": "/api/v1/departments"
}
`

### Constitution compliance (ENG-03)
- Stack trace NOT exposed in response — only in server logs.
- Error format includes error_code + message + request_id.

---

## 10. Testing Strategy

### Unit Tests

| Target | Cases | Coverage |
|---|---|---|
| CreateDepartmentDto | valid values, missing fields, empty/whitespace, regex fail, emoji, length bounds | FR-003, FR-004, FR-013→016, FR-CLR-003 |
| DepartmentsService | happy path create, unique conflict, parent check, manager check, circular ref, depth > 5, description → null | FR-005→008, FR-011, FR-012, FR-017, FR-018, FR-CLR-001, FR-CLR-002, FR-CLR-004, FR-CLR-005 |
| DepartmentsService (auth) | unauthorized, forbidden | FR-019, FR-020 |

### Integration Tests

| Scenario | HTTP | Expected | AC |
|---|---|---|---|
| Tạo department basic | 201 | Success | AC-001 |
| Tạo department con | 201 | parentDepartmentId set | AC-002 |
| Tạo department có manager | 201 | managerUserId set | AC-003 |
| Thiếu code/name | 400 | VALIDATION_ERROR | AC-004→005 |
| Empty/whitespace code/name | 400 | VALIDATION_ERROR | AC-004→005 |
| Code sai format | 422 | VALIDATION_ERROR | AC-006 |
| Code < 2 / > 50 | 422 | VALIDATION_ERROR | AC-007→008 |
| Name < 2 / > 150 | 422 | VALIDATION_ERROR | AC-009→010 |
| Emoji trong name | 422 | VALIDATION_ERROR | AC-011 |
| Không JWT | 401 | UNAUTHORIZED | AC-012 |
| Thiếu permission | 403 | PERMISSION_DENIED | AC-013 |
| Duplicate code | 409 | DEPARTMENT_ALREADY_EXISTS | AC-014 |
| Duplicate name | 409 | DEPARTMENT_ALREADY_EXISTS | AC-015 |
| Concurrent duplicate | 1×201 + 1×409 | DEPARTMENT_ALREADY_EXISTS | AC-016 |
| Parent not found | 404 | RESOURCE_NOT_FOUND | AC-017 |
| Circular ref | 422 | VALIDATION_ERROR | AC-018 |
| Depth > 5 | 422 | VALIDATION_ERROR | AC-019 |
| Audit log ghi nhận | 201 + check DB | Audit record exists | AC-020 |

Chi tiết test scenarios → quickstart.md

---

## 11. Implementation Phases

### Phase 1: Foundation (Setup)

| Task | Files | Detail |
|---|---|---|
| T001: Create migration | src/database/migrations/...-add-department-unique-indexes.ts | Partial unique indexes cho department_code, department_name (WHERE deleted_at IS NULL) |
| T002: Update DepartmentEntity | src/modules/accounts/entities/department.entity.ts | Thêm @Index decorators cho unique constraints |
| T003: Seed permission & roles | Seed script / data | Thêm permission department.create, gán ADMIN + MANAGER |

### Phase 2: DTO & Validation

| Task | Files | Detail |
|---|---|---|
| T004: Create CreateDepartmentDto | src/modules/accounts/dto/create-department.dto.ts | class-validator decorators, Transform cho trim + uppercase, custom validators |
| T005: Create DepartmentResponseDto | src/modules/accounts/dto/department-response.dto.ts | 9 fields response DTO + @ApiProperty |
| T006: Custom validators | src/modules/accounts/validators/is-department-code-unique.validator.ts, is-department-name-unique.validator.ts, 
o-emoji-or-control.validator.ts | Async validators + regex/unicode check |

### Phase 3: Service Layer

| Task | Files | Detail |
|---|---|---|
| T007: Create DepartmentsService | src/modules/accounts/services/departments.service.ts | createDepartment method với full business flow |
| T008: Implement createDepartment logic | src/modules/accounts/services/departments.service.ts | Trim → validate → unique check → ref check → circular check → depth check → transaction → audit |

### Phase 4: Controller & Routing

| Task | Files | Detail |
|---|---|---|
| T009: Create DepartmentsController | src/modules/accounts/controllers/departments.controller.ts | POST /departments với guards, pipes, swagger decorators |
| T010: Register in AccountsModule | src/modules/accounts/accounts.module.ts | Thêm DepartmentsController + DepartmentsService vào module |

### Phase 5: Error Handling

| Task | Files | Detail |
|---|---|---|
| T011: Update exception filter | src/common/filters/http-exception.filter.ts hoặc file mới | Catch QueryFailedError (23505) → map sang 409 DEPARTMENT_ALREADY_EXISTS |

### Phase 6: Testing

| Task | Files | Detail |
|---|---|---|
| T012: Unit test DepartmentsService | src/modules/accounts/services/departments.service.spec.ts | Mock repository, test all FRs |
| T013: Unit test CreateDepartmentDto | src/modules/accounts/dto/create-department.dto.spec.ts | Validate decorators |
| T014: Integration test | E2E test file | Test endpoint with all error codes |

---

## 12. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Circular reference detection O(n) cho deep hierarchy | Low | Medium | Giới hạn depth 5, loop tối đa 5 vòng |
| Race condition duplicate code/name | Medium | Medium | App-level check + DB unique constraint + catch error |
| Concurrent migration conflicts | Low | Low | Tạo migration riêng, không chạm table khác |
| Permission department.create chưa seed | Medium | High | Check seed script trước khi test integration |

---

## 13. Acceptance Criteria Traceability

| AC | Phase | Task | How to verify |
|---|---|---|---|
| AC-001 | Phase 4 | T008 | POST hợp lệ → 201 |
| AC-002 | Phase 3 | T007 | POST với parent → 201 |
| AC-003 | Phase 3 | T007 | POST với manager → 201 |
| AC-004→005 | Phase 2 | T004 | DTO validation |
| AC-006→011 | Phase 2 | T004, T006 | DTO + custom validators |
| AC-012 | Phase 4 | T008 | Guard rejects no JWT |
| AC-013 | Phase 4 | T008 | Guard rejects no permission |
| AC-014→015 | Phase 3 | T007 | App check → 409 |
| AC-016 | Phase 3+5 | T007, T010 | DB constraint catch → 409 |
| AC-017 | Phase 3 | T007 | Reference check → 404 |
| AC-018→019 | Phase 3 | T007 | Hierarchy validation → 422 |
| AC-020 | Phase 3 | T007 | Audit log written |

---

## Artifact Index

| Artifact | Path |
|---|---|
| Spec | spec/features/account/feat-create-department/spec.md |
| Plan (this) | spec/features/account/feat-create-department/plan.md |
| Research | spec/features/account/feat-create-department/research.md |
| Data Model | spec/features/account/feat-create-department/data-model.md |
| API Contract | spec/features/account/feat-create-department/contracts/departments-api.md |
| Quickstart | spec/features/account/feat-create-department/quickstart.md |




