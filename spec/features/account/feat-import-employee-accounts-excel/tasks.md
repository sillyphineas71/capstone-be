# Tasks: Tạo tài khoản nhân viên bằng import Excel

- **Feature ID**: ACCT-IMPORT-ACCOUNT-001
- **Created**: 2026-07-10
- **Based on**: spec.md, plan.md, research.md, data-model.md, contracts/import-accounts-api.md, quickstart.md

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo tasks cho import tài khoản Excel (UC-AM-02) | Toàn bộ file |

---

## Phase 1: Foundation

### 1.1 Seed Permission
- [ ] **T001** Tạo seed `src/database/seeds/2026071000000Y-SeedImportAccountsPermission.ts`
  - Permission `accounts.user.import` (`module_code='accounts'`, `action_code='user_import'`)
  - Gán role đang có `accounts.user.create` (ADMIN / BUSINESS_ADMIN)
  - Pattern: giống seed permission account hiện có
  - (Nếu team chọn tái dùng `accounts.user.create` → bỏ task này, xem plan §6)
  - Outcome: permission + role_permissions mapping

### 1.2 DTO & Response
- [ ] **T002** [P] `src/modules/accounts/dto/import-accounts.dto.ts`
  - `commit?: boolean` — `@IsOptional()`, `@Transform(({value}) => value === 'true' || value === true)`, `@IsBoolean()`
  - Outcome: DTO ready

- [ ] **T003** [P] `src/modules/accounts/dto/import-accounts-response.dto.ts`
  - `ImportAccountRowResult { row, email, status, reason?, userId? }`
  - `ImportAccountReportDto { mode, totalRows, validCount?, invalidCount?, successCount?, failedCount?, results }`
  - **KHÔNG** chứa trường mật khẩu (NFR-004)
  - Outcome: Response DTO ready

### 1.3 Constants
- [ ] **T004** [P] `src/modules/accounts/constants/import-accounts.constants.ts`
  - `MAX_IMPORT_ROWS = 200`; `MAX_IMPORT_FILE_BYTES = 2*1024*1024`
  - `IMPORT_TEMPLATE_HEADERS = ['full_name','email','department_code','role_codes','employee_code','phone_number','position_title','direct_manager_email']`
  - `XLSX_MIME`; `ROLE_CODES_SEPARATOR = ';'`
  - Enum mã lỗi (request-level + row-level theo contracts)
  - Outcome: constants tập trung

---

## Phase 2: Refactor Extract (nhạy cảm)

- [ ] **T005** [US1] Extract `persistAccount` trong `src/modules/accounts/services/users.service.ts`
  - Private method `persistAccount(em: EntityManager, data: ResolvedAccountData, creatorId: string, ctx): Promise<{ userId: string; tempPassword: string }>`
    - `data`: `{ fullName, email, departmentId, roleIds, employeeCode?, phoneNumber?, positionTitle?, directManagerId? }` (đã resolve)
    - Nội dung: sinh mật khẩu (`PasswordGeneratorService`) + bcrypt hash; `em.create/save(UserEntity, { username: email, must_change_password: true, account_status: active, employment_status: active, ... })`; insert `UserRoleEntity` cho từng role; audit `ACCOUNT_CREATE`
    - **KHÔNG** enqueue email
  - Sửa `createUser`: giữ nguyên resolve-by-UUID + duplicate checks, gọi `persistAccount`, sau đó enqueue email như cũ
  - **Điều kiện**: hành vi `createUser` không đổi (verify T012)
  - Outcome: lõi dùng chung cho import

---

## Phase 3: Import Service

- [ ] **T006** [US1] Parser + template trong `src/modules/accounts/services/account-import.service.ts`
  - `parseWorkbook(buffer): ParsedAccountRow[]` — validate header khớp `IMPORT_TEMPLATE_HEADERS`; rỗng → `INVALID_TEMPLATE`; > MAX → `IMPORT_ROW_LIMIT_EXCEEDED`; chuẩn hóa trim + email lowercase + tách `role_codes` theo `;`
  - `generateTemplate(): Promise<Buffer>` — header + ví dụ + sheet hướng dẫn
  - Outcome: parser + template

- [ ] **T007** [US1] Static validation + batch resolver (cùng service)
  - Static: missing required, invalid email, duplicate-in-file
  - Batch query: `departments` theo code, `roles` theo code, `users` theo email/employee_code/manager email
  - Map từng dòng → resolvedData hoặc mã lỗi tương ứng
  - Outcome: mỗi dòng có phân loại valid/invalid + resolvedData

- [ ] **T008** [US1] Orchestration `importAccounts(file, options, actor, ctx)` (cùng service)
  - Step 0: file/MIME/size validation (throw request-level)
  - Step 1-3: parse → static validate → batch resolve (T006/T007)
  - Step 4: preview gate — `commit!=true` → trả report `mode='preview'`, không ghi DB
  - Step 5: commit — per-row transaction gọi lõi `persistAccount`
  - Step 6: email — enqueue credentials từng tài khoản (best-effort); fail → audit `NOTIFICATION_ENQUEUE_FAILED`
  - Step 7: audit `ACCOUNT_IMPORT` tổng + return report `mode='commit'`
  - Đảm bảo KHÔNG log/không trả mật khẩu
  - Outcome: import hoàn chỉnh

---

## Phase 4: Controller & Module

- [ ] **T009** [US1] Endpoint trong `src/modules/accounts/controllers/users.controller.ts`
  - `POST users/import`
    - `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('accounts.user.import')`
    - `@UseInterceptors(FileInterceptor('file'))`, `@UploadedFile() file`, `@Body() dto: ImportAccountsDto`
    - `@ApiConsumes('multipart/form-data')` + `@ApiBody`
    - Trả `{ success, message, data: ImportAccountReport }`
  - `GET users/import/template`
    - Guard + permission như trên; set header xlsx + `Content-Disposition attachment`; trả buffer `generateTemplate()`
  - Outcome: 2 endpoint hoạt động

- [ ] **T010** Wire `src/modules/accounts/accounts.module.ts`
  - Add `AccountImportService` vào `providers`
  - Kiểm tra `NotificationsModule`, `AdministrationModule` (AuditLog), `AuthModule` import đủ; `PasswordGeneratorService` đã provide
  - Outcome: DI resolved

---

## Phase 5: Testing

- [ ] **T011** [P] Unit tests `src/modules/accounts/services/account-import.service.spec.ts`
  - Parser: header sai/rỗng/quá dòng
  - Static: missing required, invalid email, duplicate-in-file
  - Resolver: department_code, role_codes (nhiều), email exists, employee_code exists, manager email
  - Preview: `commit=false` không ghi DB, đúng validCount/invalidCount
  - Commit: tạo dòng valid, bỏ dòng invalid (BR2)
  - BR: password đủ chuẩn (BR1), must_change_password=true (BR3), username=email (BR4)
  - Notification: mỗi account 1 enqueue; enqueue fail → account vẫn tạo, audit ghi
  - NFR-004: mật khẩu không có trong response
  - Audit tổng `ACCOUNT_IMPORT`
  - Outcome: coverage > 90%

- [ ] **T012** [P] Regression tests `src/modules/accounts/services/users.service.spec.ts`
  - `createUser` giữ nguyên: tạo user + roles + audit + email sau refactor `persistAccount`
  - Outcome: hành vi cũ không đổi

- [ ] **T013** [P] Controller tests `src/modules/accounts/controllers/users.controller.spec.ts`
  - 200 preview; 200 commit; 400 file errors; guard/permission; template xlsx content-type
  - Outcome: controller spec pass

---

## Phase 6: Verification
- [ ] **T014** [P] `npm run build`
- [ ] **T015** [P] `npm run lint`

---

## Requirements Coverage

| FR | Task |
|---|---|
| FR-001..006 file/parse | T004, T006 |
| FR-007..013 validation/resolve | T007 |
| FR-014, FR-015 preview/commit | T008 |
| FR-016..020 create/BR/audit | T005, T008 |
| FR-021, FR-022 email | T008 |
| FR-023 sync | T006, T008 |
| NFR-001..005 | T005, T006, T008 |

| AC | Task |
|---|---|
| AC-001..005 | T004, T006 |
| AC-006..011 | T007, T008 |
| AC-012..013 | T005, T008 |
| AC-014..017 | T008 |

---

## Dependency Graph
```
Phase 1            Phase 2         Phase 3                 Phase 4            Phase 5              Phase 6
T001 (seed) ─┐
T002 (dto) ──┤
T003 (resp) ─┼─→ T005 (extract) ─→ T006 (parse) ─→ T007 (resolve) ─→ T008 (orchestrate) ─→ T009 (controller) ─→ T011/T012/T013 ─→ T014 → T015
T004 (const)─┘                                                                              T010 (module)
```

## Parallel Execution Opportunities
| Task | Song song với | Lý do |
|---|---|---|
| T002 | T003, T004 | File độc lập |
| T011 | T012, T013 | Khác file test |
| T014 | T015 | Build/lint độc lập |

## Implementation Strategy (MVP)
- **Wave 1** (Foundation): T001 → (T002 + T003 + T004)
- **Wave 2** (Extract): T005 + regression T012 ngay sau
- **Wave 3** (Service): T006 → T007 → T008
- **Wave 4** (Controller): T009 + T010
- **Wave 5** (Test): T011 + T013
- **Wave 6** (Verify): T014 → T015

Lưu ý: T005 (extract `persistAccount`) là điểm rủi ro cao nhất — hoàn thành regression T012 ngay sau để chốt an toàn.
