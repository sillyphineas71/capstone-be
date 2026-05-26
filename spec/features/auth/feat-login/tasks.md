# Tasks: AUTH-001 Login

**Input**: Design documents from `/spec/features/auth/feat-login/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/login-api.md`, `quickstart.md`

**Tests**: Bao gồm test tasks vì spec và plan đã yêu cầu rõ test coverage cho validation, rate limit, error handling, integration và acceptance criteria.

**Organization**: Tasks được nhóm theo phase và 1 user story chính để feature Login có thể được implement, test và verify độc lập.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Có thể chạy song song (khác file, không phụ thuộc task chưa hoàn thành)
- **[Story]**: Task thuộc user story cụ thể
- Mọi task đều có file path rõ ràng

## Path Conventions

- Source code: `src/`
- Unit tests: `src/**/*.spec.ts`
- E2E tests: `test/*.e2e-spec.ts`
- Feature docs: `spec/features/auth/feat-login/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Tạo khung module và file structure cho feature Login trong NestJS project hiện tại.

- [ ] T001 Tạo `AuthModule` và skeleton thư mục feature trong `src/modules/auth/auth.module.ts`, `src/modules/auth/dto/`, `src/modules/auth/services/`, `src/modules/auth/controllers/`, `src/modules/auth/repositories/`, `src/modules/auth/types/`, `src/modules/auth/utils/`, `src/modules/auth/presenters/`
- [X] T002 [P] Tạo constants cho auth error codes và auth status mapping trong `src/modules/auth/constants/auth-error-codes.ts`
- [X] T003 [P] Tạo kiểu dữ liệu request/response và auth context models trong `src/modules/auth/types/login.types.ts`
- [X] T004 Cập nhật wiring module gốc để load `AuthModule` trong `src/app.module.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Chuẩn bị các building blocks dùng chung mà toàn bộ login flow phụ thuộc vào.

**⚠️ CRITICAL**: Chưa xong phase này thì không nên implement login endpoint hoàn chỉnh.

- [X] T005 Tạo `LoginDto` với strict validation rule cho chỉ `email` và `password` trong `src/modules/auth/dto/login.dto.ts`
- [X] T006 [P] Tạo custom validation/normalization helper cho email trim + lowercase và password raw preservation trong `src/modules/auth/utils/login-normalization.util.ts`
- [X] T007 [P] Tạo `AuthConfigService` để đọc session TTL / auth settings từ `system_configs` trong `src/modules/auth/services/auth-config.service.ts`
- [X] T008 [P] Tạo `RateLimitService` interface + implementation theo IP/email cho login trong `src/modules/auth/services/rate-limit.service.ts`
- [X] T009 [P] Tạo repository đọc `users` và update `last_login_at` trong `src/modules/auth/repositories/users-auth.repository.ts`
- [X] T010 [P] Tạo repository tổng hợp `roles[]` và `permissions[]` từ `user_roles`, `roles`, `role_permissions`, `permissions` trong `src/modules/auth/repositories/authz-read.repository.ts`
- [X] T011 [P] Tạo repository insert/revoke `user_sessions` trong `src/modules/auth/repositories/user-sessions.repository.ts`
- [X] T012 [P] Tạo repository ghi `audit_logs` cho login success trong `src/modules/auth/repositories/auth-audit.repository.ts`
- [X] T013 Tạo `TokenService` abstraction cho access token / refresh token generation gắn với session trong `src/modules/auth/services/token.service.ts`
- [X] T014 Tạo response/error mapper cho login theo contract dự án trong `src/modules/auth/presenters/login-response.presenter.ts`

**Checkpoint**: Foundation sẵn sàng để triển khai full login flow theo contract.

---

## Phase 3: User Story 1 - Đăng nhập hệ thống bằng email/password (Priority: P1) 🎯 MVP

**Goal**: Người dùng nội bộ có thể gọi `POST /api/v1/auth/login` với `email` và `password`, đi qua strict validation, rate limit, account verification, session creation, token issuance và nhận response thành công hoặc lỗi đúng contract.

**Independent Test**: Gọi `POST /api/v1/auth/login` bằng Supertest với các case success/failure chính; xác nhận status code, error code, response shape, session persistence, role/permission output, và non-blocking side effects đúng như spec.

### Tests for User Story 1

- [X] T015 [P] [US1] Viết unit test cho `LoginDto` strict validation và email/password normalization behavior trong `src/modules/auth/dto/login.dto.spec.ts`
- [X] T016 [P] [US1] Viết unit test cho `RateLimitService` với allow/deny theo IP/email trong `src/modules/auth/services/rate-limit.service.spec.ts`
- [X] T017 [P] [US1] Viết unit test cho `UsersAuthRepository` trong `src/modules/auth/repositories/users-auth.repository.spec.ts`
- [X] T018 [P] [US1] Viết unit test cho `UserSessionsRepository` trong `src/modules/auth/repositories/user-sessions.repository.spec.ts`
- [X] T019 [P] [US1] Viết unit test cho `AuthConfigService` đọc session TTL từ `system_configs` trong `src/modules/auth/services/auth-config.service.spec.ts`
- [X] T020 [P] [US1] Viết unit test cho authz aggregation chỉ trả `roles[]` và `permissions[]` còn hiệu lực trong `src/modules/auth/repositories/authz-read.repository.spec.ts`
- [X] T021 [P] [US1] Viết unit test cho `TokenService` và cleanup path khi token generation fail trong `src/modules/auth/services/token.service.spec.ts`
- [X] T022 [P] [US1] Viết unit test cho `LoginService` covering validation-to-session flow, status mapping, unified invalid credentials, user không có role/permission hiệu lực nhưng vẫn login success, non-blocking `last_login_at`/audit trong `src/modules/auth/services/login.service.spec.ts`
- [X] T023 [P] [US1] Viết unit test cho internal logging khi login fail do token/session/system error trong `src/modules/auth/services/login.service.spec.ts`
- [X] T024 [P] [US1] Viết e2e test verify contract của `POST /api/v1/auth/login` theo `spec/features/auth/feat-login/contracts/login-api.md` trong `test/auth-login.e2e-spec.ts`

### Implementation for User Story 1

- [X] T025 [US1] Implement `LoginService` orchestration trong `src/modules/auth/services/login.service.ts` theo đúng flow: strict validate assumptions, rate limit, user lookup, password verify, account status, session create, token issue, side effects
- [X] T026 [US1] Implement credential verification và status-to-error mapping trong `src/modules/auth/services/login.service.ts`
- [X] T027 [US1] Implement session-first token issuance và session cleanup/revoke path khi token generation fail trong `src/modules/auth/services/login.service.ts` và `src/modules/auth/repositories/user-sessions.repository.ts`
- [X] T028 [US1] Implement non-blocking `last_login_at` update và audit log write trong `src/modules/auth/services/login.service.ts`
- [X] T029 [US1] Implement `AuthController` cho `POST /api/v1/auth/login` trong `src/modules/auth/controllers/auth.controller.ts`
- [X] T030 [US1] Register providers/controllers của feature login trong `src/modules/auth/auth.module.ts`
- [X] T031 [US1] Implement response assembly cho success path và standardized error mapping trong `src/modules/auth/presenters/login-response.presenter.ts`
- [X] T032 [US1] Tích hợp repository reads cho `roles[]` và `permissions[]` vào login success response trong `src/modules/auth/services/login.service.ts`
- [X] T033 [US1] Bổ sung internal logging với request id/ip/user-agent cho failure paths và non-blocking side effects trong `src/modules/auth/services/login.service.ts`

### Verification for User Story 1

- [ ] T034 [US1] Hoàn thiện và fix unit test cho `LoginDto` trong `src/modules/auth/dto/login.dto.spec.ts`
- [ ] T035 [US1] Hoàn thiện và fix unit test cho `RateLimitService` và `AuthConfigService` trong `src/modules/auth/services/rate-limit.service.spec.ts` và `src/modules/auth/services/auth-config.service.spec.ts`
- [ ] T036 [US1] Hoàn thiện và fix unit test cho `LoginService`, `UsersAuthRepository`, `UserSessionsRepository`, `AuthzReadRepository` và `TokenService` trong `src/modules/auth/services/login.service.spec.ts`, `src/modules/auth/repositories/users-auth.repository.spec.ts`, `src/modules/auth/repositories/user-sessions.repository.spec.ts`, `src/modules/auth/repositories/authz-read.repository.spec.ts`, `src/modules/auth/services/token.service.spec.ts`
- [ ] T037 [US1] Hoàn thiện và fix e2e scenarios theo `spec/features/auth/feat-login/quickstart.md` trong `test/auth-login.e2e-spec.ts`
- [ ] T038 [US1] Verify response success không lộ `password_hash` hoặc `refresh_token_hash`, body lạ bị reject, và `roles[]` / `permissions[]` chỉ trả dữ liệu còn hiệu lực trong `test/auth-login.e2e-spec.ts`

**Checkpoint**: User Story 1 hoàn chỉnh khi endpoint login hoạt động độc lập và pass toàn bộ acceptance scenarios chính.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Hoàn thiện tài liệu, cleanup implementation details và kiểm tra consistency cuối cùng với spec/plan.

- [ ] T039 [P] Cập nhật `spec/features/auth/feat-login/quickstart.md` với command chạy test thực tế và expected verification steps của login flow
- [ ] T040 Rà soát `spec/features/auth/feat-login/plan.md`, `spec/features/auth/feat-login/data-model.md`, `spec/features/auth/feat-login/contracts/login-api.md` để đồng bộ tên error code, response fields và out-of-scope sau implementation
- [ ] T041 Chạy và xử lý lỗi unit test login trong `src/modules/auth/**/*.spec.ts`
- [ ] T042 Chạy và xử lý lỗi e2e test login trong `test/auth-login.e2e-spec.ts`
- [ ] T043 Chạy và xử lý lint cho các file login trong `src/modules/auth/` và `test/auth-login.e2e-spec.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Bắt đầu ngay.
- **Foundational (Phase 2)**: Phụ thuộc Phase 1; block toàn bộ implementation user story.
- **User Story 1 (Phase 3)**: Phụ thuộc Phase 2 hoàn tất.
- **Polish (Phase 4)**: Phụ thuộc User Story 1 hoàn tất.

### User Story Dependencies

- **User Story 1 (P1)**: Có thể bắt đầu ngay sau Foundational; không phụ thuộc user story khác.

### Within User Story 1

- Test tasks `T015`-`T024` nên được viết trước hoặc song song với implementation tương ứng.
- Repositories/services foundation (`T007`-`T014`) phải xong trước `T025`-`T033`.
- `LoginService` (`T025`-`T028`) phải xong trước khi hoàn thiện controller/module wiring (`T029`-`T030`) và e2e verification (`T037`-`T038`).
- Verification tasks `T034`-`T038` diễn ra sau implementation chính.

### Parallel Opportunities

- `T002`, `T003` có thể chạy song song sau `T001`.
- `T007`-`T012` có thể chạy song song vì khác file và cùng là foundational repositories/services.
- `T015`-`T024` có thể chia song song theo test target khác nhau.
- `T039` có thể chạy song song với `T040` sau khi implementation ổn định.

---

## Parallel Example: User Story 1

```bash
# Foundation parallel work
Task: "T007 Tạo AuthConfigService trong src/modules/auth/services/auth-config.service.ts"
Task: "T008 Tạo RateLimitService trong src/modules/auth/services/rate-limit.service.ts"
Task: "T009 Tạo users auth repository trong src/modules/auth/repositories/users-auth.repository.ts"
Task: "T010 Tạo authz read repository trong src/modules/auth/repositories/authz-read.repository.ts"
Task: "T011 Tạo user sessions repository trong src/modules/auth/repositories/user-sessions.repository.ts"
Task: "T012 Tạo auth audit repository trong src/modules/auth/repositories/auth-audit.repository.ts"

# Test parallel work
Task: "T015 Unit test LoginDto trong src/modules/auth/dto/login.dto.spec.ts"
Task: "T016 Unit test RateLimitService trong src/modules/auth/services/rate-limit.service.spec.ts"
Task: "T024 E2E test POST /api/v1/auth/login trong test/auth-login.e2e-spec.ts"
```

---

## Implementation Strategy

### MVP First

1. Hoàn thành Phase 1: Setup.
2. Hoàn thành Phase 2: Foundational.
3. Hoàn thành Phase 3: User Story 1.
4. Dừng lại và validate `POST /api/v1/auth/login` qua unit + e2e tests.

### Incremental Delivery

1. Setup + Foundational để dựng auth scaffolding.
2. Implement login flow cốt lõi: validation -> rate limit -> user/password/status -> session -> token.
3. Add non-blocking side effects: `last_login_at`, audit log.
4. Verify toàn bộ acceptance criteria bằng tests và quickstart scenarios.

### Parallel Team Strategy

1. Một người dựng module/repositories foundation.
2. Một người viết test suite song song cho DTO/service/e2e.
3. Một người implement login service/controller sau khi abstractions nền tảng đã ổn.

---

## Requirements Coverage

| FR / AC chính | Tasks cover |
|---|---|
| FR-001 / cung cấp endpoint `POST /api/v1/auth/login` | T024, T029, T030, T037 |
| FR-002 đến FR-006 / strict validation, email normalize, password raw | T005, T006, T015, T025 |
| FR-007, FR-008 / rate limit theo IP/email | T008, T016, T025, T024 |
| FR-009 đến FR-016 / user lookup, password verify, account status mapping | T009, T022, T025, T026, T024 |
| FR-017 đến FR-020 / session-first token issuance, session create failure, token cleanup | T011, T013, T021, T025, T027, T024 |
| FR-021, FR-027, FR-028 / session metadata + success response contract | T011, T014, T029, T031, T032, T024 |
| FR-023 đến FR-026 / non-blocking `last_login_at` và audit log | T012, T022, T023, T028, T033, T024 |
| FR-029 đến FR-031 / public endpoint + roles/permissions effective only | T010, T020, T022, T029, T032, T038 |
| FR-032 đến FR-037 / secure response và status-specific errors | T009, T014, T022, T026, T031, T038 |
| FR-038 đến FR-043 / audit success logging, internal logging, config from `system_configs` | T007, T012, T019, T023, T028, T033 |
| AC: success trả token + user | T024, T029, T031, T032, T037 |
| AC: reject extra field / invalid email | T015, T024, T025, T037 |
| AC: `401 AUTH_INVALID_CREDENTIALS` cho user not found / wrong password | T022, T024, T026, T037 |
| AC: `403/423` cho inactive/locked/unsupported status | T022, T024, T026, T037 |
| AC: `429 AUTH_TOO_MANY_ATTEMPTS` | T016, T024, T025, T037 |
| AC: `500 AUTH_SESSION_CREATE_FAILED` | T018, T022, T024, T027, T037 |
| AC: không lộ dữ liệu nhạy cảm | T014, T024, T031, T038 |
| AC: login success chỉ sau session create thành công | T011, T021, T027, T037 |
| AC: `roles[]` và `permissions[]` chỉ trả dữ liệu còn hiệu lực | T020, T024, T032, T038 |
| AC: user không có role/permission hiệu lực vẫn login success | T022, T024, T032, T037 |
| AC: `last_login_at` / audit fail không fail login | T022, T023, T028, T033, T037 |
