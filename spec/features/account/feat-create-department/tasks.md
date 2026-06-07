# Tasks: Khởi tạo phòng ban mới (UC-AM-03)

**Feature**: ORG-DEPT-CREATE-001 | **Module**: accounts
**Spec**: spec/features/account/feat-create-department/spec.md
**Plan**: spec/features/account/feat-create-department/plan.md

---

## Phase 1: Foundation & Database

> Mục tiêu: chuẩn bị database schema + entity + seed data trước khi code business logic.
> Dependency: T001 → T002, T003 (T002 và T003 có thể chạy song song).

- [x] T001 Tạo TypeORM migration thêm partial unique indexes cho department_code và department_name với WHERE deleted_at IS NULL
      Files: src/database/migrations/####-add-department-unique-indexes.ts
      Outcome: migration file chạy được, tạo 2 indexes: ux_departments_code (department_code WHERE deleted_at IS NULL) và ux_departments_name (department_name WHERE deleted_at IS NULL)

- [x] T002 [P] Cập nhật DepartmentEntity thêm @Index decorator cho departmentCode và departmentName tương ứng với partial unique indexes
      File: src/modules/accounts/entities/department.entity.ts
      Outcome: entity có @Index('ux_departments_code', { synchronize: false }) và tương tự cho name

- [x] T003 [P] Seed permission department.create vào bảng permissions và gán cho roles ADMIN và MANAGER trong ole_permissions
      Files: seed script (ví dụ src/database/seeds/####-seed-department-permission.ts)
      Outcome: permission_code = 'department.create', module = 'accounts', action = 'create' tồn tại trong DB, gán cho ADMIN + MANAGER

---

## Phase 2: DTO & Validation

> Mục tiêu: định nghĩa DTO request/response + custom validators.
> Dependency: T004, T005, T006 độc lập nhau — chạy song song.

- [x] T004 [P] Tạo CreateDepartmentDto với class-validator decorators và @Transform cho trim + uppercase normalize
      File: src/modules/accounts/dto/create-department.dto.ts
      Details:
      - departmentCode: @IsString, @IsNotEmpty, @Transform(trim → uppercase), @Matches(/^[A-Z0-9][A-Z0-9_-]{1,49}$/ đề xuất), @Length(2,50), @Validate(IsDepartmentCodeUniqueConstraint)
      - departmentName: @IsString, @IsNotEmpty, @Transform(trim), @Length(2,150), @Validate(NoEmojiOrControlConstraint), @Validate(IsDepartmentNameUniqueConstraint)
      - parentDepartmentId: @IsOptional, @IsUUID
      - managerUserId: @IsOptional, @IsUUID
      - description: @IsOptional, @IsString, @Transform(trim → null nếu empty/whitespace)

- [x] T005 [P] Tạo DepartmentResponseDto với 9 fields và @ApiProperty decorators
      File: src/modules/accounts/dto/department-response.dto.ts
      Fields: id (uuid), departmentCode (string), departmentName (string), parentDepartmentId (uuid | null), managerUserId (uuid | null), description (string | null), isActive (boolean), createdAt (Date), updatedAt (Date)
      Outcome: DTO có đủ 9 fields với ApiProperty + example values

- [x] T006 [P] Tạo 3 custom validators cho unique check và safe content check
      Files:
      - src/modules/accounts/validators/is-department-code-unique.validator.ts — ValidatorConstraint + inject DepartmentRepository, kiểm tra code chưa tồn tại trong non-deleted records
      - src/modules/accounts/validators/is-department-name-unique.validator.ts — tương tự cho name
      - src/modules/accounts/validators/no-emoji-or-control.validator.ts — regex / unicode check để block emoji, control chars
      Outcome: 3 class-validator constraint classes sẵn sàng dùng trong DTO

---

## Phase 3: Service Layer

> Mục tiêu: implement toàn bộ business logic tạo phòng ban.
> Dependency: T007 ← T004, T005, T006.

- [x] T007 Implement DepartmentsService.createDepartment với full business flow
      File: src/modules/accounts/services/departments.service.ts
      Details:
      - Inject: DepartmentRepository, UserRepository (cho manager check), AdministrationService (cho audit)
      - Flow:
        1. Trim + normalize input (departmentCode → uppercase)
        2. Check unique code (non-deleted) → 409 nếu tồn tại
        3. Check unique name (non-deleted) → 409 nếu tồn tại
        4. Validate parentDepartmentId: exists + active + non-deleted → 404; circular ref check → 422; depth ≤ 5 → 422
        5. Validate managerUserId: exists + account_status='active' + non-deleted → 404
        5b. Sanitize: strip hoặc escape HTML/script tags khỏi departmentName và description (chống XSS)
6. description: empty/whitespace → null
        7. Transaction: create DepartmentEntity + audit log (action_type='create', entity_type='department')
        8. Return DepartmentResponseDto (9 fields)
      Outcome: service method hoàn chỉnh, xử lý tất cả FR và ERR từ spec

---

## Phase 4: Controller, Routing & Error Handling

> Mục tiêu: expose endpoint, kết nối module, xử lý DB exception.
> Dependency: T008 ← T007. T009 ← T008. T010 [P] — độc lập, chạy song song.

- [x] T008 Tạo DepartmentsController với endpoint POST /api/v1/departments
      File: src/modules/accounts/controllers/departments.controller.ts
      Details:
      - Route: @Controller('departments')
      - Method: @Post() với @HttpCode(HttpStatus.CREATED)
      - Guards: @UseGuards(JwtAuthGuard, PermissionsGuard), @RequirePermissions('department.create')
      - Pipe: ValidationPipe với whitelist + transform
      - Parameters: @Body() createDepartmentDto: CreateDepartmentDto, @Req() request, @Ip(), @Headers('user-agent'), @Headers('x-request-id')
      - Swagger: @ApiTags('Accounts'), @ApiBearerAuth(), @ApiOperation(), @ApiBody(), @ApiResponse() cho 201, 400, 401, 403, 404, 409, 422, 500
      - Response: { success: true, message: 'Khởi tạo phòng ban thành công', data: DepartmentResponseDto }
      Outcome: endpoint hoàn chỉnh, có auth + swagger docs

- [x] T009 Đăng ký DepartmentsController và DepartmentsService trong AccountsModule
      File: src/modules/accounts/accounts.module.ts
      Changes:
      - Thêm DepartmentsController vào controllers: []
      - Thêm DepartmentsService vào providers: []
      - Thêm custom validators vào providers: [] nếu cần register
      - Export DepartmentsService nếu module khác cần
      Outcome: module build được, endpoint accessible

- [x] T010 [P] Cập nhật global exception filter để catch QueryFailedError (PostgreSQL error code 23505) → map sang 409 DEPARTMENT_ALREADY_EXISTS
      File: src/common/filters/http-exception.filter.ts hoặc tạo mới src/common/filters/query-failed.filter.ts
      Details:
      - Catch QueryFailedError với driverError.code === '23505'
      - Parse constraint name từ error message để xác định field (department_code hay department_name)
      - Trả về { success: false, message: '...', error: { code: 'DEPARTMENT_ALREADY_EXISTS', details: { field } }, timestamp, path }
      Outcome: DB unique constraint violation → response 409 thay vì 500

---

## Phase 5: Testing

> Mục tiêu: đảm bảo coverage cho tất cả FR, ERR, AC.
> Dependency: T011 [P] ← T004. T012 [P] ← T006. T013 ← T007. T014 ← T009.

- [x] T011 [P] Viết unit tests cho CreateDepartmentDto validation decorators
      File: src/modules/accounts/dto/create-department.dto.spec.ts
      Coverage:
      - Valid values: 'IT', 'HR_DEPT', 'DEV-TEAM', 'A1' (2 chars min)
      - Invalid: empty string, whitespace-only, 'A' (1 char), 'A'.repeat(51), 'IT DEPT' (space), 'it@dept', 'abc™', Vietnamese 'PHÒNG_IT'
      - Name: valid Vietnamese 'Phòng Công nghệ', invalid emoji 'Test 😊', '<script>' XSS
      - parentDepartmentId: valid uuid, invalid string, undefined
      - managerUserId: valid uuid, null
      - description: valid string, empty → null, whitespace → null
      Outcome: tất cả validate cases pass

- [x] T012 [P] Viết unit tests cho 3 custom validators
      Files:
      - src/modules/accounts/validators/is-department-code-unique.validator.spec.ts
      - src/modules/accounts/validators/is-department-name-unique.validator.spec.ts
      - src/modules/accounts/validators/no-emoji-or-control.validator.spec.ts
      Coverage:
      - Unique validators: mock repository trả về null (unique) / entity (duplicate)
      - NoEmojiOrControl: valid text, emoji, control chars (\u0000, \u001F), XSS payloads
      Outcome: 3 validator spec files pass

- [x] T013 Viết unit tests cho DepartmentsService
      File: src/modules/accounts/services/departments.service.spec.ts
      Coverage (mock repository + audit service):
      - Happy path: tạo thành công → trả DTO, audit log ghi
      - Happy path + parent: parent tồn tại + active → success
      - Happy path + manager: manager tồn tại + active → success
      - Duplicate code → throw ConflictException (409)
      - Duplicate name → throw ConflictException (409)
      - Parent not found → throw NotFoundException (404)
      - Parent inactive → throw NotFoundException (404)
      - Parent deleted → throw NotFoundException (404)
      - Circular ref → throw UnprocessableEntityException (422)
      - Depth > 5 → throw UnprocessableEntityException (422)
      - Manager not found → throw NotFoundException (404)
      - Manager inactive → throw NotFoundException (404)
      - Description empty → null khi persist
      - Race condition → DB unique violation → throw ConflictException (409)
      Outcome: service spec với 13+ test cases pass

- [x] T014 Viết integration test cho endpoint POST /api/v1/departments
      File: 	est/departments.e2e-spec.ts hoặc src/modules/accounts/tests/departments.controller.integration.spec.ts
      Coverage (E2E với test DB hoặc supertest):
      - [AC-001] POST hợp lệ → 201, response đúng 9 fields
      - [AC-002] POST với parentDepartmentId → 201, parentDepartmentId set
      - [AC-003] POST với managerUserId → 201, managerUserId set
      - [AC-004→005] POST thiếu code/name → 400
      - [AC-006] POST code sai format (space, ký tự đặc biệt) → 422
      - [AC-007→008] POST code < 2 / > 50 → 422
      - [AC-009→010] POST name < 2 / > 150 → 422
      - [AC-011] POST name có emoji → 422
      - [AC-012] POST không JWT → 401
      - [AC-013] POST JWT không có permission → 403
      - [AC-014→015] POST duplicate code/name → 409 DEPARTMENT_ALREADY_EXISTS
      - [AC-017] POST parent not found → 404
      - [AC-018→019] POST circular ref / depth > 5 → 422
      - [AC-020] POST thành công → audit_logs có record
      Outcome: E2E test phủ 19 AC scenarios

---


---

## Phase 6: Idempotency & Performance

> Dependency: T015 ← T008 (controller layer). T016 — optional, độc lập.

- [x] T015 Implement idempotency-key handling for POST /api/v1/departments
      Files:
      - `src/modules/accounts/controllers/departments.controller.ts` (đọc Idempotency-Key header)
      - `src/modules/accounts/services/departments.service.ts` (check + cache logic)
      - Có thể dùng middleware riêng `src/common/interceptors/idempotency.interceptor.ts`
      Details:
      - Đọc `Idempotency-Key` từ request header (nếu có)
      - Nếu key tồn tại:
        a. Tra cache/Redis (hoặc in-memory cache với TTL phù hợp cho capstone) theo key + userId
        b. Nếu tìm thấy response cached → return response đó, không tạo department mới
        c. Nếu key đã tồn tại nhưng payload khác → throw 409 IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD
        d. Nếu key chưa tồn tại → tiếp tục xử lý, sau khi thành công → cache response với TTL (vd: 24h)
      - Nếu không có Idempotency-Key → xử lý bình thường (vẫn dựa vào unique constraint)
      - Không tạo bảng database mới — dùng in-memory cache hoặc Redis cho capstone
      Outcome: idempotency hoạt động cho cùng key + payload → 201 cached; key + payload khác → 409

- [ ] T016 [P] Add simple performance check for POST /api/v1/departments under normal load (OPTIONAL — ưu tiên thấp)
      File: `test/departments.performance.spec.ts`
      Detail: Gọi POST hợp lệ 10 lần, verify response time < 2s mỗi lần (NFR-001)
      Outcome: performance check script, không block implementation nếu skip

## Requirements Coverage

### FR → Task mapping

| FR ID | EARS Pattern | Task phụ trách | Ghi chú |
|---|---|---|---|
| FR-001 | Ubiquitous | T001, T002, T007 | Schema + entity + service persist |
| FR-002 | Ubiquitous | T007 | Gán created_by từ token |
| FR-003 | Ubiquitous | T001, T002, T004, T006, T007 | Unique code + regex + uppercase normalize |
| FR-004 | Ubiquitous | T001, T002, T004, T006, T007 | Unique name + safe charset + trim |
| FR-005 | Event-driven | T007 | Tạo department với is_active = true |
| FR-006 | Event-driven | T007 | Parent check + circular ref + depth |
| FR-007 | Event-driven | T007 | Manager check |
| FR-008 | Event-driven | T005, T007, T008 | Response 9 fields |
| FR-009 | State-driven | T007 | Parent phải active + non-deleted |
| FR-010 | State-driven | T007 | Manager phải active + non-deleted |
| FR-011 | Unwanted Behavior | T006, T007 | Trùng code → 409 |
| FR-012 | Unwanted Behavior | T006, T007 | Trùng name → 409 |
| FR-013 | Unwanted Behavior | T004, T011 | Thiếu/empty code → 400 |
| FR-014 | Unwanted Behavior | T004, T011 | Thiếu/empty name → 400 |
| FR-015 | Unwanted Behavior | T004, T011 | Code sai format/length → 422 |
| FR-016 | Unwanted Behavior | T004, T011 | Name sai length → 422 |
| FR-017 | Unwanted Behavior | T007, T013 | Parent not found/inactive → 404 |
| FR-018 | Unwanted Behavior | T007, T013 | Manager not found/inactive → 404 |
| FR-CLR-001 | Unwanted Behavior | T007, T013 | Circular ref → 422 |
| FR-CLR-002 | Unwanted Behavior | T007, T013 | Depth > 5 → 422 |
| FR-CLR-003 | Unwanted Behavior | T004, T006, T011, T012 | Emoji/control content → 422 |
| FR-019 | Unwanted Behavior | T008 | Guard: chưa xác thực → 401 |
| FR-020 | Unwanted Behavior | T003, T008 | Guard: thiếu permission → 403 |
| FR-021 | Ubiquitous | T001, T002 | UUID primary key |
| FR-022 | Ubiquitous | T005, T007 | is_active = true |
| FR-023 | Ubiquitous | T001, T002 | created_at, updated_at |
| FR-024 | Unwanted Behavior | T007 | Rollback transaction |
| FR-CLR-004 | Ubiquitous | T001, T007, T010 | App check + DB constraint + catch |
| FR-CLR-005 | Ubiquitous | T004, T007 | Description empty → null |
| FR-025 | Event-driven | T007, T013 | Audit log ghi nhận |

### AC → Task mapping

| AC ID | Task kiểm tra | Cách verify |
|---|---|---|
| AC-001 | T014 | POST hợp lệ → 201 + response 9 fields |
| AC-002 | T014 | POST có parentDepartmentId → 201 |
| AC-003 | T014 | POST có managerUserId → 201 |
| AC-004→005 | T011, T014 | POST missing/empty code/name → 400 |
| AC-006 | T011, T014 | POST code sai format → 422 |
| AC-007→008 | T011, T014 | POST code < 2 / > 50 → 422 |
| AC-009→010 | T011, T014 | POST name < 2 / > 150 → 422 |
| AC-011 | T012, T014 | POST emoji name → 422 |
| AC-012 | T014 | POST không JWT → 401 |
| AC-013 | T014 | POST thiếu permission → 403 |
| AC-014→015 | T013, T014 | POST duplicate code/name → 409 |
| AC-016 | T013, T014 | Concurrent request → 1×201 + 1×409 |
| AC-017 | T013, T014 | POST parent not found → 404 |
| AC-018 | T013, T014 | POST circular ref → 422 |
| AC-019 | T013, T014 | POST depth > 5 → 422 |
| AC-020 | T013, T014 | POST thành công → audit_log checked |




