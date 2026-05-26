# Tasks: UC-AM-01 Create New Account

**Input**: Design documents from `/spec/features/account/feat-create-account/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/create-account.openapi.yaml`

## Phase 1: Setup

**Purpose**: Chuẩn bị cấu trúc tài liệu và module backend tối thiểu để triển khai feature mà không mở rộng scope.

- [ ] T001 Tạo cấu trúc thư mục `src/modules/accounts/{controllers,dto,services,repositories,policies,mappers,integrations}` và `test/accounts/{unit,integration,e2e}`
- [ ] T002 [P] Tạo skeleton module `src/modules/accounts/accounts.module.ts` để đăng ký controller/service/repository/policy/notifier của UC-AM-01
- [ ] T003 [P] Hoàn tất baseline contract trong `spec/features/account/feat-create-account/contracts/create-account.openapi.yaml` với `roleId`, `departmentId` optional và warning response semantics

**Checkpoint**: Codebase có cấu trúc đích cho `accounts` module và contract feature-level đủ rõ để bắt đầu phase nền tảng.

---

## Phase 2: Foundational

**Purpose**: Hoàn thiện các thành phần blocking cho schema, validation foundation, authorization foundation và error contract trước khi làm core flow.

- [ ] T004 Tạo migration/schema update cho `users.force_change_password` và các unique constraints cần thiết tại `database/migrations/feat-create-account-force-change-password.sql`
- [ ] T005 [P] Tạo hằng số error codes UC-AM-01 trong `src/modules/accounts/constants/account-error-codes.ts` gồm duplicate, invalid reference, whitelist violation và `USERNAME_GENERATION_FAILED`
- [ ] T006 [P] Tạo DTO request/response cơ sở trong `src/modules/accounts/dto/create-account.dto.ts` và `src/modules/accounts/dto/create-account-response.dto.ts` theo contract feature-level với `departmentId` optional
- [ ] T007 [P] Tạo utility normalize input trong `src/modules/accounts/services/account-normalization.service.ts` cho `fullName`, `email`, `employeeCode` và username base generation
- [ ] T008 [P] Tạo policy service trong `src/modules/accounts/policies/account-assignment-policy.service.ts` để check permission chính và whitelist role assignment
- [ ] T009 Tạo repository contract cho `users`, `user_roles`, `roles`, `departments`, `audit_logs` trong `src/modules/accounts/repositories/create-account.repository.ts`
- [ ] T010 Tạo exception mapping layer trong `src/modules/accounts/mappers/create-account-error.mapper.ts` để map DB unique/reference failures sang business error codes của UC-AM-01

**Checkpoint**: Schema, DTO nền tảng, normalize rules, authorization policy, repository contract và error mapping đã sẵn sàng; user story có thể bắt đầu.

---

## Phase 3: User Story 1 - Administrator tạo mới account nội bộ (Priority: P1) 🎯 MVP

**Goal**: Cho phép `Administrator` tạo mới account qua `POST /api/v1/accounts` với đầy đủ validation, authorization, transaction boundary, username auto-generate, audit log và warning path khi email fail.

**Independent Test**: Gọi `POST /api/v1/accounts` bằng token `Administrator` hợp lệ với payload đúng; hệ thống tạo record ở `users`, `user_roles`, `audit_logs`, trả `201`, sinh `username`, set `status = ACTIVE`, `force_change_password = true`, và không trả plaintext temporary password.

### Tests for User Story 1

- [ ] T011 [P] [US1] Tạo unit test cho normalize rules và `employeeCode`/`phoneNumber` validation tại `test/accounts/unit/account-normalization.service.spec.ts`
- [ ] T012 [P] [US1] Tạo unit test cho username generation + retry tối đa 10 lần tại `test/accounts/unit/username-generation.service.spec.ts`
- [ ] T013 [P] [US1] Tạo unit test cho whitelist role assignment policy tại `test/accounts/unit/account-assignment-policy.service.spec.ts`
- [ ] T014 [P] [US1] Tạo integration test cho transaction write `users` + `user_roles` + `audit_logs` và rollback path tại `test/accounts/integration/create-account.transaction.spec.ts`
- [ ] T015 [P] [US1] Tạo integration test cho mapping DB unique conflict sang `DUPLICATE_EMAIL`, `DUPLICATE_USERNAME`, `DUPLICATE_EMPLOYEE_CODE` tại `test/accounts/integration/create-account.duplicates.spec.ts`
- [ ] T016 [P] [US1] Tạo integration test cho invalid/inactive role, invalid/inactive department và whitelist violation tại `test/accounts/integration/create-account.authorization-boundary.spec.ts`
- [ ] T017 [P] [US1] Tạo e2e test happy path cho `POST /api/v1/accounts` tại `test/accounts/e2e/create-account.success.e2e-spec.ts`
- [ ] T018 [P] [US1] Tạo e2e test validation errors cho required/format fields tại `test/accounts/e2e/create-account.validation.e2e-spec.ts`
- [ ] T019 [P] [US1] Tạo e2e test forbidden path và email fail warning path tại `test/accounts/e2e/create-account.error-warning.e2e-spec.ts`
- [ ] T020 [P] [US1] Tạo contract verification test cho `POST /api/v1/accounts` tại `test/accounts/e2e/create-account.contract.e2e-spec.ts` để verify request body, success response, validation errors, duplicate errors, invalid role/department errors, `USERNAME_GENERATION_FAILED` và email failure behavior khớp `contracts/create-account.openapi.yaml`
- [ ] T021 [P] [US1] Tạo integration test xác nhận account mới có thể truy vấn lại qua Account List API contract tại `test/accounts/integration/create-account.list-queryability.spec.ts`

### Implementation for User Story 1

- [ ] T022 [US1] Implement username generation service trong `src/modules/accounts/services/username-generation.service.ts` theo rule `short_name_base + random_4_digits` với retry tối đa 10 lần
- [ ] T023 [P] [US1] Implement temporary password bootstrap service trong `src/modules/accounts/services/temporary-password.service.ts` để sinh password trong memory và hash trước khi persist
- [ ] T024 [P] [US1] Implement Brevo notifier port/adapter trong `src/modules/accounts/integrations/account-provisioning-notifier.service.ts` theo cơ chế async và không lộ plaintext password
- [ ] T025 [US1] Implement repository logic cho create-account trong `src/modules/accounts/repositories/create-account.repository.ts` gồm load role/department, insert `users`, insert `user_roles`, insert `audit_logs`, và transaction wrapper
- [ ] T026 [US1] Implement business service chính trong `src/modules/accounts/services/create-account.service.ts` để điều phối validate, normalize, authorization boundary, username generation, password hashing, stale reference re-check cho `roleId`/`departmentId`, transaction và post-commit notification
- [ ] T027 [US1] Implement controller endpoint `POST /api/v1/accounts` trong `src/modules/accounts/controllers/accounts.controller.ts` và bind DTO, auth guard, response shape theo contract
- [ ] T028 [US1] Đăng ký `AccountsModule` vào `src/app.module.ts` và wiring các provider cần thiết cho UC-AM-01
- [ ] T029 [US1] Bổ sung response mapper trong `src/modules/accounts/mappers/create-account-response.mapper.ts` để trả account summary + warnings mà không expose temporary password
- [ ] T030 [US1] Bổ sung server-side validation chi tiết trong `src/modules/accounts/dto/create-account.dto.ts` cho required fields, regex, lowercase/normalize hooks, `departmentId` optional và field-level errors
- [ ] T031 [US1] Bổ sung authorization guard/pipeline cho permission chính `accounts:create` hoặc `accounts:write` tại `src/modules/accounts/controllers/accounts.controller.ts` và `src/modules/accounts/policies/account-assignment-policy.service.ts`
- [ ] T032 [US1] Hoàn thiện business error mapping trong `src/modules/accounts/mappers/create-account-error.mapper.ts` cho `INVALID_ROLE_SELECTION`, `INVALID_DEPARTMENT_SELECTION`, `ROLE_ASSIGNMENT_NOT_ALLOWED`, `USERNAME_GENERATION_FAILED`

**Checkpoint**: UC-AM-01 backend hoàn chỉnh và testable độc lập, bao phủ đầy đủ happy path, validation, authorization, transaction boundary, duplicate handling và warning path khi email fail.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Rà soát consistency cuối, cập nhật tài liệu liên quan trong feature scope, và xác nhận acceptance coverage.

- [ ] T033 Cập nhật `spec/modules/account/api.md` cho phần UC-AM-01 để align với `roleId`, `employeeCode` required, `departmentId` optional, username system-generated và warning response semantics
- [ ] T034 [P] Cập nhật `spec/features/account/feat-create-account/quickstart.md` nếu cần để phản ánh command/test path thực tế sau implementation
- [ ] T035 Chạy và ghi nhận kết quả test unit/integration/e2e cho UC-AM-01 trong ghi chú triển khai của feature tại `spec/features/account/feat-create-account/quickstart.md`
- [ ] T036 Rà soát performance path đồng bộ của `POST /api/v1/accounts` trong `src/modules/accounts/services/create-account.service.ts` để bảo đảm logic đồng bộ không phụ thuộc thời gian gửi email async

**Checkpoint**: Tài liệu contract/module và quickstart nhất quán với implementation; acceptance coverage đã được soát; feature sẵn sàng sang implementation execution hoàn chỉnh.

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 không phụ thuộc task trước đó.
- Phase 2 phụ thuộc hoàn tất Phase 1.
- Phase 3 phụ thuộc hoàn tất Phase 2.
- Phase 4 phụ thuộc hoàn tất Phase 3.

### Task Dependencies

- `T002` phụ thuộc `T001`.
- `T004` nên hoàn tất trước `T025` và các integration/e2e tests cần DB schema đúng.
- `T005`, `T006`, `T007`, `T008` có thể bắt đầu sau `T001`.
- `T009` phụ thuộc `T001` và nên hoàn tất trước `T025`.
- `T010` phụ thuộc `T005` và `T009`.
- `T011` phụ thuộc `T007`.
- `T012` phụ thuộc `T007` và hoàn tất trước `T020` nếu đi theo test-first.
- `T013` phụ thuộc `T008`.
- `T014`, `T015`, `T016`, `T021` phụ thuộc `T004`, `T009`, `T010`.
- `T017`, `T018`, `T019`, `T020` phụ thuộc `T006` và skeleton module từ `T002`.
- `T022` phụ thuộc `T007`.
- `T023` phụ thuộc `T001`.
- `T024` phụ thuộc `T001`.
- `T025` phụ thuộc `T004`, `T009`, `T010`.
- `T026` phụ thuộc `T022`, `T023`, `T024`, `T025`, `T008`, `T010`.
- `T027` phụ thuộc `T006`, `T026`, `T029`, `T031`, `T032`.
- `T028` phụ thuộc `T002`, `T026`, `T027`.
- `T029` phụ thuộc `T006` và `T026`.
- `T030` phụ thuộc `T006`, `T007`.
- `T031` phụ thuộc `T008`.
- `T032` phụ thuộc `T010` và `T026`.
- `T033` phụ thuộc hoàn tất `T027` để contract tài liệu bám implementation cuối.
- `T034` phụ thuộc `T017` đến `T021` và `T027`.
- `T035` phụ thuộc hoàn tất test tasks `T011` đến `T021` và implementation tasks `T022` đến `T032`.
- `T036` phụ thuộc `T026` và `T027`.

### Parallel Opportunities

- Có thể chạy song song `T002` và `T003` sau `T001`.
- Trong Phase 2 có thể chạy song song `T005`, `T006`, `T007`, `T008` sau `T001`.
- Trong Phase 3 có thể chạy song song nhóm test `T011` đến `T021` theo từng lớp test.
- Trong Phase 3 có thể chạy song song `T023` và `T024` sau khi foundation sẵn sàng.

---

## Parallel Example

```bash
# Foundation song song
T005 src/modules/accounts/constants/account-error-codes.ts
T006 src/modules/accounts/dto/create-account.dto.ts + src/modules/accounts/dto/create-account-response.dto.ts
T007 src/modules/accounts/services/account-normalization.service.ts
T008 src/modules/accounts/policies/account-assignment-policy.service.ts

# Test song song cho US1
T011 test/accounts/unit/account-normalization.service.spec.ts
T012 test/accounts/unit/username-generation.service.spec.ts
T013 test/accounts/unit/account-assignment-policy.service.spec.ts
T014 test/accounts/integration/create-account.transaction.spec.ts
T015 test/accounts/integration/create-account.duplicates.spec.ts
T016 test/accounts/integration/create-account.authorization-boundary.spec.ts
T017 test/accounts/e2e/create-account.success.e2e-spec.ts
T018 test/accounts/e2e/create-account.validation.e2e-spec.ts
T019 test/accounts/e2e/create-account.error-warning.e2e-spec.ts
T020 test/accounts/e2e/create-account.contract.e2e-spec.ts
T021 test/accounts/integration/create-account.list-queryability.spec.ts
```

---

## Implementation Strategy

### MVP First

1. Hoàn tất Phase 1 và Phase 2.
2. Hoàn tất core implementation của US1: `T022` đến `T032`.
3. Chạy ít nhất `T017`, `T018`, `T019`, `T020`, `T021` để xác nhận endpoint hoạt động end-to-end, khớp contract và account có thể được truy vấn lại.
4. Sau đó mới làm polish/documentation alignment.

### Incremental Delivery

1. Schema + foundation.
2. Repository + service transaction.
3. Controller + response/warning semantics.
4. Test matrix cho validation, authorization, duplicates, email fail.
5. Documentation alignment và coverage review.

---

## Requirements Coverage

- `FR-Auth/Create Permission`: `T008`, `T026`, `T031`, `T013`, `T019`
- `FR-Lookup Reuse`: `T003`, `T024`, `T025`
- `FR-Validation Required/Format/Normalize`: `T006`, `T007`, `T030`, `T011`, `T018`
- `FR-Unique Email/Username/EmployeeCode`: `T004`, `T010`, `T022`, `T025`, `T015`
- `FR-Username Auto Generate + Retry 10`: `T007`, `T022`, `T012`, `T026`
- `FR-Role Whitelist Boundary`: `T008`, `T026`, `T031`, `T013`, `T016`
- `FR-Create Users + UserRoles + AuditLogs`: `T004`, `T009`, `T025`, `T026`, `T014`, `T017`
- `FR-Set ACTIVE + force_change_password`: `T004`, `T025`, `T026`, `T017`
- `FR-Temporary Password Security`: `T023`, `T024`, `T026`, `T029`, `T019`
- `FR-Email Notification + Warning on Failure`: `T024`, `T026`, `T027`, `T029`, `T019`
- `FR-Error Handling Invalid Role/Department`: `T005`, `T010`, `T016`, `T032`
- `FR-Response Clarity for success / validation failure / success with warning`: `T006`, `T020`, `T027`, `T029`, `T019`
- `AC-Only Administrator`: `T008`, `T027`, `T031`, `T013`, `T019`
- `AC-Form Data Validation`: `T006`, `T007`, `T030`, `T011`, `T018`
- `AC-Username Generated`: `T022`, `T012`, `T017`, `T020`
- `AC-Whitelist Role Assignment`: `T008`, `T013`, `T016`, `T026`
- `AC-EmployeeCode Regex + Unique`: `T004`, `T030`, `T015`, `T018`
- `AC-Invalid Role/Department Codes`: `T005`, `T016`, `T020`, `T032`
- `AC-Users + UserRole + Active`: `T025`, `T026`, `T014`, `T017`
- `AC-Password Hash + First Login Change`: `T004`, `T023`, `T026`, `T017`
- `AC-Email Success or Warning`: `T024`, `T026`, `T027`, `T019`, `T020`
- `AC-Email Fail Keeps Account`: `T014`, `T019`, `T026`
- `AC-Account Readiness`: `T017`, `T026`, `T029`
- `AC-Account Persisted and Queryable via Account List API`: `T021`, `T025`, `T026`, `T033`
