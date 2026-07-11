# Implementation Plan: Tạo tài khoản nhân viên bằng import Excel

- **Feature ID**: ACCT-IMPORT-ACCOUNT-001
- **Created**: 2026-07-10
- **Status**: Draft

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo plan cho import tài khoản Excel (UC-AM-02) | Toàn bộ file |

---

## 1. Feature Summary
Cho phép Business Admin import hàng loạt tài khoản nhân viên từ `.xlsx`: preview kiểm tra (không ghi DB) → xác nhận commit tạo dòng hợp lệ (bỏ dòng lỗi, BR2), sinh mật khẩu tạm (BR1), bắt buộc đổi mật khẩu lần đầu (BR3), định danh email (BR4), gửi email credentials từng người. Đồng bộ, cap 200 dòng, tái sử dụng nghiệp vụ `createUser`.

---

## 2. Technical Context
- **Module**: `accounts` (`src/modules/accounts/`)
- **Framework**: NestJS, TypeORM
- **Excel**: `exceljs` (đã có)
- **Upload**: `FileInterceptor('file')` (memoryStorage)
- **Auth**: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('accounts.user.import')`
- **Reuse**: `PasswordGeneratorService`, `NotificationsService.enqueueEmailNotification`, lõi create của `UsersService`
- **Database**: PostgreSQL v3.2 Compact — KHÔNG đổi schema

---

## 3. Constitution Check
- **DB Gate**: PASS — không thêm/xóa bảng, không đổi cột
- **Security Gate**: PASS — JWT, bcrypt hash, không trả/không log mật khẩu, validate file
- **Scope Gate**: PASS — sync only, không bảng lịch sử, không đổi hành vi `createUser` đơn lẻ
- **Module Gate**: PASS — logic trong `accounts`; notification/audit qua module import
- **API Gate**: PASS — response chuẩn, HTTP codes đúng
- **Auth Gate**: PASS — permission `accounts.user.import`
- **Test Gate**: PASS — unit test parser/resolver/preview/commit/notification + regression `createUser`

**Complexity Justification**:
- Refactor **extract `persistAccount`** khỏi `createUser` là thay đổi nhạy cảm nhất. Lý do bắt buộc: import cần create per-row (partial success) và resolve-by-code (khác resolve-by-UUID trong `createUser`), nhưng phải dùng chung logic sinh mật khẩu + insert + roles + audit để không lệch nghiệp vụ.

---

## 4. Scope Confirmation

### In scope
- Endpoint import (multipart, cờ `commit`) + endpoint tải template
- Parse `.xlsx`, validate cấu trúc, cap 200 dòng, file ≤2MB
- Resolve `department_code` / `role_codes` (nhiều, `;`) / `direct_manager_email`
- Duplicate-in-file + duplicate-in-DB (email, employee_code)
- Preview 2 bước (`commit=false` → không ghi DB; `commit=true` → tạo)
- Reuse sinh mật khẩu (BR1), must_change_password (BR3), username=email (BR4)
- Partial success per-row transaction (BR2)
- Email credentials từng người (best-effort)
- Audit per-row `ACCOUNT_CREATE` + tổng `ACCOUNT_IMPORT`
- Permission mới `accounts.user.import`

### Out of scope
- `.xls` legacy; async job; bảng lịch sử import
- Update tài khoản đã tồn tại qua import
- Throttle email theo quota; trả mật khẩu qua API

---

## 5. Data Model Impact
**Không đổi schema.** Chi tiết `data-model.md`. Ghi `users`, `user_roles`, `notifications`, `background_jobs`, `audit_logs`.

---

## 6. API / Contract Plan
Chi tiết `contracts/import-accounts-api.md`.

| Endpoint | Method | Permission |
|---|---|---|
| `/users/import` | POST (multipart, `commit` flag) | `accounts.user.import` |
| `/users/import/template` | GET | `accounts.user.import` |

### DTO: `ImportAccountsDto`
```
commit?: boolean   // @IsOptional @Transform(string->boolean) @IsBoolean
```
(File nhận qua `@UploadedFile()`.)

### Permission note
- Khuyến nghị **tạo mới `accounts.user.import`** (granular, đúng convention + nhất quán feature import khác). Có thể tái dùng `accounts.user.create` nếu team muốn gọn — nếu vậy bỏ task seed T001.

---

## 7. Authorization Plan
1. `JwtAuthGuard` → `request['user']`.
2. `PermissionsGuard` → check `accounts.user.import`.
3. Không có ràng buộc scope phòng ban đặc thù ở v1 (Business Admin tạo tài khoản toàn hệ thống); nếu sau này cần department-scope, bổ sung tương tự `getUserDetail`.

### Permission seed
- `accounts.user.import` — gán cho role đang có `accounts.user.create` (ADMIN / BUSINESS_ADMIN).

---

## 8. Business Logic Plan

### Service mới: `AccountImportService`
Constructor inject: `DataSource`, `UsersService` (hoặc lõi extract), `PasswordGeneratorService`, `NotificationsService`, `Logger`.

#### `generateTemplate(): Promise<Buffer>`
- `exceljs` workbook: sheet "Accounts" (8 header + ví dụ), sheet "Huong dan".

#### `importAccounts(file, options, actor, clientContext): Promise<ImportAccountReport>`

**Step 0 — Request-level validation**
1. File tồn tại + MIME `.xlsx` → `400 INVALID_FILE_FORMAT`.
2. Size ≤ limit → `400 FILE_TOO_LARGE`.

**Step 1 — Parse & structural validation**
3. `exceljs` load buffer, đọc sheet đầu, map header. Sai/rỗng → `400 INVALID_TEMPLATE`; > MAX → `400 IMPORT_ROW_LIMIT_EXCEEDED`.
4. Chuẩn hóa từng dòng → `ParsedAccountRow` (trim, email lowercase, tách `role_codes` theo `;`).

**Step 2 — Static per-row validation**
5. Thiếu bắt buộc → `invalid MISSING_REQUIRED_FIELD`.
6. Email sai định dạng → `invalid INVALID_EMAIL`.
7. Duplicate email trong file → dòng sau `invalid DUPLICATE_IN_FILE`.

**Step 3 — Batch resolve (query gom)**
8. Query `departments` theo tập `department_code` → map; không khớp/inactive → `DEPARTMENT_NOT_FOUND`.
9. Query `roles` theo tập `role_code` → map; role nào không khớp/inactive → `ROLE_NOT_FOUND`.
10. Query `users` theo tập email → email tồn tại → `EMAIL_ALREADY_EXISTS`; theo tập employee_code → `EMPLOYEE_CODE_ALREADY_EXISTS`; theo tập manager email → resolve managerId, không khớp → `MANAGER_NOT_FOUND`.

**Step 4 — Preview gate**
11. Nếu `options.commit !== true`:
    - Trả `mode='preview'` + `results[]` (valid/invalid) + `validCount`/`invalidCount`. **Không ghi DB.**

**Step 5 — Commit (per-row transaction, chỉ dòng valid)**
12. Với mỗi dòng valid:
    - `persistAccount(em, resolvedData, actor.id, ctx)` (lõi extract): sinh mật khẩu (BR1) + bcrypt hash, insert `users` (`username=email`, `must_change_password=true`, status active), insert `user_roles`, audit `ACCOUNT_CREATE`; return `{ userId, tempPassword }`.
    - Thành công → `success` + userId; lỗi runtime (vd race duplicate) → `failed` + reason.
13. Thu thập `createdAccounts[] = { userId, email, fullName, tempPassword }`.

**Step 6 — Email (best-effort, ngoài transaction)**
14. Với mỗi tài khoản tạo mới → `enqueueEmailNotification({ toEmails:[email], subject, content: credentials + tempPassword, ... })` (mỗi người một email).
15. Lỗi enqueue → audit `NOTIFICATION_ENQUEUE_FAILED`, KHÔNG rollback.

**Step 7 — Audit tổng + return**
16. Ghi `audit_logs` `ACCOUNT_IMPORT` (totalRows, successCount, failedCount).
17. Return `ImportAccountReport` (mode='commit').

### Refactor extract
- Tách `persistAccount(em, data, creatorId, ctx): Promise<{ userId, tempPassword }>` từ `createUser` (không email).
- `createUser` cũ: resolve-by-UUID → `persistAccount` → enqueue email (giữ nguyên hành vi + test hồi quy).

---

## 9. Validation Plan

### DTO (`ImportAccountsDto`)
| Field | Rule | Decorator |
|---|---|---|
| `commit` | optional boolean (multipart string) | `@IsOptional()` `@Transform(...)` `@IsBoolean()` |

### File / structural
| Check | Error |
|---|---|
| MIME `.xlsx` | `INVALID_FILE_FORMAT` |
| Size ≤ limit | `FILE_TOO_LARGE` |
| Header đúng | `INVALID_TEMPLATE` |
| ≤ MAX rows | `IMPORT_ROW_LIMIT_EXCEEDED` |

---

## 10. Error Handling Plan
- Lỗi cấp request → throw exception chuẩn.
- Lỗi cấp dòng → đưa vào `results[]`, không throw.
- Per-row transaction fail → dòng `failed`, không rollback dòng khác (BR2).
- Email fail → audit + log, không ảnh hưởng report.
- KHÔNG log/không trả mật khẩu tạm.

---

## 11. Testing Strategy

### 11.1 Unit — Parser & Resolver (`account-import.service.spec.ts`)
- Header sai/rỗng/quá dòng.
- Static: missing required, invalid email, duplicate-in-file.
- Resolve: department_code khớp/không, role_codes nhiều giá trị, email exists, employee_code exists, manager email.

### 11.2 Unit — Preview & Commit
- `commit=false` → không ghi DB, đúng validCount/invalidCount.
- `commit=true` → tạo dòng valid, bỏ dòng invalid (BR2).
- Password sinh đúng chuẩn (BR1), `must_change_password=true` (BR3), `username=email` (BR4).
- Mật khẩu không có trong response (NFR-004).

### 11.3 Unit — Notification
- Mỗi tài khoản tạo mới → 1 enqueueEmailNotification; enqueue fail → account vẫn tạo, audit ghi.

### 11.4 Regression
- `createUser` đơn lẻ giữ nguyên hành vi sau refactor extract `persistAccount`.

### 11.5 Controller
- 200 preview format; 200 commit format; 400 file errors; guard/permission; template xlsx content-type.

---

## 12. Implementation Phases

### Phase A: Foundation (T001–T004)
- **T001** Seed permission `accounts.user.import` (grant role có `accounts.user.create`).
- **T002** DTO `ImportAccountsDto` (`commit` transform boolean).
- **T003** Response DTO/interface `ImportAccountReport`, `ImportAccountRowResult`.
- **T004** Constants: `MAX_IMPORT_ROWS`, headers, file limits, error codes.

### Phase B: Refactor extract (T005)
- **T005** Tách `persistAccount` khỏi `createUser`; giữ hành vi đơn lẻ.

### Phase C: Import service (T006–T008)
- **T006** Excel parser + structural validation + `generateTemplate`.
- **T007** Static validation + batch resolver (department/role/manager/duplicate).
- **T008** `importAccounts()` orchestration (preview gate, commit per-row, email, audit).

### Phase D: Controller & Module (T009–T010)
- **T009** 2 endpoint (import + template).
- **T010** Wire `AccountImportService` vào `accounts.module.ts`.

### Phase E: Testing (T011–T013)
- **T011** Service unit tests.
- **T012** Regression `createUser`.
- **T013** Controller tests.

### Phase F: Verification (T014–T015)
- **T014** `npm run build`.
- **T015** `npm run lint`.

---

## 13. Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Refactor extract phá hành vi `createUser` | Medium | High | Regression T012 trước merge |
| bcrypt per-row chậm với 200 dòng | Medium | Medium | Cap dòng + đo thời gian; cân nhắc salt rounds hiện tại (10) |
| Lộ/log mật khẩu tạm | Low | High | Không đưa vào response/log/audit value |
| Quá quota mail free | Medium | Medium | Best-effort + audit khi lỗi; throttle là future |
| Duplicate race per-row | Low | Low | Transaction + unique constraint → dòng failed, không 500 |
| `role_codes` nhiều giá trị parse sai | Low | Medium | Chuẩn hóa tách `;`, trim, bỏ rỗng |

---

## 14. Acceptance Criteria Traceability
| AC | Task |
|---|---|
| AC-001..005 (file/template) | T004, T006 |
| AC-006..011 (preview/validation) | T007, T008 |
| AC-012..013 (commit/BR) | T005, T008 |
| AC-014..015 (email) | T008 |
| AC-016 (audit tổng) | T008 |
| AC-017 (no password in response) | T003, T008 |

---

## 15. Files to Create / Modify
| File | Action | Mục đích |
|---|---|---|
| `src/database/seeds/2026071000000Y-SeedImportAccountsPermission.ts` | CREATE | Seed permission |
| `src/modules/accounts/dto/import-accounts.dto.ts` | CREATE | DTO `commit` |
| `src/modules/accounts/dto/import-accounts-response.dto.ts` | CREATE | Report/RowResult |
| `src/modules/accounts/constants/import-accounts.constants.ts` | CREATE | MAX rows, headers, error codes |
| `src/modules/accounts/services/account-import.service.ts` | CREATE | Parser + orchestration + template |
| `src/modules/accounts/services/users.service.ts` | MODIFY | Extract `persistAccount` |
| `src/modules/accounts/controllers/users.controller.ts` | MODIFY | 2 endpoint mới |
| `src/modules/accounts/accounts.module.ts` | MODIFY | Provider mới |
| `src/modules/accounts/services/account-import.service.spec.ts` | CREATE | Unit tests |
| `src/modules/accounts/services/users.service.spec.ts` | MODIFY | Regression createUser |
| `src/modules/accounts/controllers/users.controller.spec.ts` | MODIFY | Controller tests |

---

## 16. Dependencies & Integration Points
| Dependency | Integration | Ghi chú |
|---|---|---|
| `exceljs` | Parse + template | Đã có |
| `@nestjs/platform-express` | `FileInterceptor` | Đã dùng ở avatar |
| `PasswordGeneratorService` | Sinh mật khẩu (BR1) | Đã có |
| `bcryptjs` | Hash mật khẩu | Đã có |
| `NotificationsService` | Email credentials | `enqueueEmailNotification` |
| `AdministrationModule` | `AuditLogEntity` | Audit |
| `AuthModule` | Guards + permission | Auth |
