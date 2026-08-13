# Tasks: Import Excel tài khoản Đối tác/Khách hàng tạm thời

- **Feature ID**: PTA-IMPORT-001
- **Created**: 2026-08-12
- **Based on**: spec.md, plan.md, research.md, data-model.md, contracts/import-partner-accounts-api.md, quickstart.md
- **Status**: ⛔ **CHƯA được phép implement** — chờ Thiếu Chủ xác nhận bắt đầu code (chỉ thị trực tiếp 2026-08-12). Danh sách task dưới đây là kế hoạch, KHÔNG phải tiến độ đã làm.

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | Khởi tạo tasks | Toàn bộ file |

---

## Phase 1: Foundation

### 1.1 Seed Permission
- [ ] **T-PIA-001** Migration `src/database/migrations/<timestamp>-SeedPartnerImportPermission.ts`
  - Permission `account.partner.import` (`module_code='accounts'`, `action_code='partner.import'`)
  - Gán role: **cần Thiếu Chủ xác nhận danh sách cuối** — đề xuất mirror `account.partner.manage` (`MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`), nhưng lưu ý khác biệt hành vi ở `plan.md` mục 7 (MANAGER sẽ thực sự dùng được, không như PTA-001 đơn lẻ)
  - Pattern: mirror `20260811000002-SeedPartnerAccountManagePermission.ts`
  - Outcome: permission + role_permissions mapping

### 1.2 DTO & Response
- [ ] **T-PIA-002** [P] `src/modules/accounts/dto/import-partner-accounts.dto.ts`
  - `commit?: boolean` — `@IsOptional()`, `@Transform(...)`, `@IsBoolean()`
  - `defaultExpiresInDays?: number` — `@IsOptional()`, `@Transform(string->number)`, `@IsInt()`, `@Min(1)`
  - Outcome: DTO ready

- [ ] **T-PIA-003** [P] `src/modules/accounts/dto/import-partner-accounts-response.dto.ts`
  - `ImportPartnerAccountRowResult { row, email, status, reason?, userId?, accountExpiresAt?, vehiclePlateStatus? }`
  - `ImportPartnerAccountReportDto { mode, totalRows, validCount?, invalidCount?, successCount?, failedCount?, results }`
  - **KHÔNG** chứa trường mật khẩu (mirror NFR-004 của `ACCT-IMPORT-ACCOUNT-001`)
  - Outcome: Response DTO ready

### 1.3 Constants
- [ ] **T-PIA-004** [P] `src/modules/accounts/constants/import-partner-accounts.constants.ts`
  - `MAX_PARTNER_IMPORT_ROWS = 50`; `MAX_IMPORT_FILE_BYTES = 2*1024*1024` (mirror employee); `MAX_BIOMETRIC_PHOTO_BYTES = 5*1024*1024`
  - `MAX_PHOTOS_ZIP_BYTES = 100*1024*1024`; `MAX_PHOTOS_ZIP_TOTAL_UNCOMPRESSED_BYTES = 250*1024*1024` (nhân bản giá trị từ `import-accounts.constants.ts`, xem `plan.md` mục 9)
  - `IMPORT_PARTNER_HEADERS = ['full_name','email','account_expires_at','phone_number','license_plate']`
  - `XLSX_MIME`
  - Enum mã lỗi request-level + row-level (theo `contracts/import-partner-accounts-api.md` mục 3.3/4)
  - Outcome: constants tập trung

---

## Phase 2: Import Service (KHÔNG refactor code hiện có — persistAccount() đã dùng chung sẵn)

- [ ] **T-PIA-005** [US1] Zip-extraction helper + template trong `src/modules/accounts/services/partner-account-import.service.ts`
  - `extractPhotosFromZip(buffer)` — nhân bản từ `AccountImportService` (quyết định Tùy chọn B, `plan.md` mục 9), comment rõ nguồn gốc
  - `generateTemplate(): Promise<Buffer>` — 5 cột header + ví dụ + sheet hướng dẫn (nhấn mạnh ảnh bắt buộc)
  - Outcome: helper + template

- [ ] **T-PIA-006** [US1] Parser trong cùng service
  - `parseWorkbook(buffer): ParsedPartnerRow[]` — validate header khớp `IMPORT_PARTNER_HEADERS`; rỗng → `INVALID_TEMPLATE`; > 50 → `IMPORT_ROW_LIMIT_EXCEEDED`; chuẩn hóa trim + email lowercase
  - Outcome: parser sẵn sàng

- [ ] **T-PIA-007** [US1] Static validation + resolve `account_expires_at` + khớp ảnh (KHÔNG upload)
  - Missing required → `MISSING_REQUIRED_FIELD`; invalid email → `INVALID_EMAIL`; duplicate-in-file → `DUPLICATE_IN_FILE`
  - Resolve `account_expires_at` hiệu lực (cột hoặc `defaultExpiresInDays`) → `MISSING_ACCOUNT_EXPIRES_AT`/`INVALID_ACCOUNT_EXPIRES_AT`/`ACCOUNT_EXPIRES_AT_MUST_BE_FUTURE`
  - Khớp ảnh theo `email` trong `allPhotos` (map đã build từ T-PIA-005) — không khớp → `PARTNER_PHOTO_REQUIRED`
  - Batch query 1 lần: `departments` (xác nhận `PARTNER_DEPARTMENT_ID` active), `roles` (`role_code='EMPLOYEE'`), `users` theo tập email → `EMAIL_ALREADY_EXISTS`
  - Outcome: mỗi dòng có phân loại valid/invalid + resolvedData (chưa upload ảnh)

- [ ] **T-PIA-008** [US1] Orchestration `importPartnerAccounts(file, photos, photosZip, options, actor, ctx)` (cùng service)
  - Step 0: file/MIME/size/`defaultExpiresInDays` validation (throw request-level); giải nén `photosZip` nếu có
  - Step 1-3: parse → static validate → batch resolve (T-PIA-006/T-PIA-007)
  - Step 4: preview gate — `commit!=true` → trả report `mode='preview'`, KHÔNG ghi DB, KHÔNG gọi Cloudinary
  - Step 5: commit — per-row transaction: upload ảnh khớp → validate magic-bytes/size (lỗi → dòng `failed`) → build `ResolvedAccountData.partner` → gọi `UsersService.persistAccount()` (TÁI DÙNG, không sửa) → nếu có `license_plate`, gọi `VehicleRegistrationService.register()` best-effort
  - Step 6: email — enqueue `buildPartnerAccountWelcomeEmail()` từng tài khoản (best-effort)
  - Step 7: audit `PARTNER_ACCOUNT_IMPORT` tổng + return report `mode='commit'`
  - Đảm bảo KHÔNG log/trả mật khẩu
  - Outcome: import hoàn chỉnh

---

## Phase 3: Controller & Module

- [ ] **T-PIA-009** [US1] Endpoint trong `src/modules/accounts/controllers/users.controller.ts` (route MỚI, không đổi route cũ)
  - `POST users/import-partners`
    - `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('account.partner.import')`
    - `@UseInterceptors(FileFieldsInterceptor([{file},{photos},{photosZip}]))`, `@UploadedFiles()`, `@Body() dto: ImportPartnerAccountsDto`
    - `@ApiConsumes('multipart/form-data')` + `@ApiBody`
    - Trả `{ success, message, data: ImportPartnerAccountReportDto }`
  - `GET users/import-partners/template`
    - Guard + permission như trên; header xlsx + `Content-Disposition attachment; filename="partner-accounts-template.xlsx"`
  - Outcome: 2 endpoint hoạt động, KHÔNG đổi 2 endpoint import nhân viên hiện có

- [ ] **T-PIA-010** Wire `src/modules/accounts/accounts.module.ts`
  - Add `PartnerAccountImportService` vào `providers`
  - Xác nhận `AnprModule` (đã import từ 2026-08-12 cho `license_plate` của import nhân viên) export sẵn `VehicleRegistrationService` — không cần import thêm module nào mới
  - Outcome: DI resolved

---

## Phase 4: Testing

- [ ] **T-PIA-011** [P] Unit tests `src/modules/accounts/services/partner-account-import.service.spec.ts`
  - Parser: header sai/rỗng/quá 50 dòng
  - Static: missing required, invalid email, duplicate-in-file
  - `account_expires_at`: cột hợp lệ/không hợp lệ/quá khứ; trống + có/không `defaultExpiresInDays`
  - Ảnh: khớp/không khớp theo email qua `photos[]` và `photosZip`; magic-bytes sai/quá 5MB CHỈ phát hiện ở commit
  - Preview: `commit=false` không ghi DB, KHÔNG gọi Cloudinary (assert mock)
  - Commit: `department_id=PARTNER_DEPARTMENT_ID`, role `EMPLOYEE`, `must_change_password=false`, `account_expires_at` đúng
  - `license_plate`: hợp lệ → `attached`; trùng → `duplicate_plate`, account vẫn `success`
  - Notification: mỗi account 1 enqueue dùng đúng template partner
  - Audit tổng `PARTNER_ACCOUNT_IMPORT`
  - Outcome: coverage tương đương `account-import.service.spec.ts`

- [ ] **T-PIA-012** [P] Regression — chạy lại (KHÔNG cần viết mới)
  - `src/modules/accounts/services/users.service.spec.ts` (persistAccount/createUser không đổi)
  - `src/modules/accounts/services/account-import.service.spec.ts` (import nhân viên không đổi)
  - Outcome: cả 2 suite vẫn xanh, xác nhận KHÔNG hồi quy

- [ ] **T-PIA-013** [P] Controller tests `src/modules/accounts/controllers/users.controller.spec.ts`
  - 200 preview; 200 commit; 400 file/zip/defaultExpiresInDays errors; guard/permission `account.partner.import`; template xlsx content-type
  - Outcome: controller spec pass

---

## Phase 5: Verification
- [ ] **T-PIA-014** [P] `npm run build`
- [ ] **T-PIA-015** [P] `npm run lint`
- [ ] **T-PIA-016** Đo thời gian thật với batch 50 dòng ảnh thật (mirror `research.md` mục 4) — quyết định có nới `MAX_PARTNER_IMPORT_ROWS` lên 100 hay không, dựa trên số đo thật

---

## Requirements Coverage

| FR | Task |
|---|---|
| FR-PIA-001..006 file/parse/zip | T-PIA-004, T-PIA-005, T-PIA-006 |
| FR-PIA-007..015 validation/resolve/plate | T-PIA-007 |
| FR-PIA-016, FR-PIA-017 preview/commit | T-PIA-008 |
| FR-PIA-018..022 create/BR/audit | T-PIA-008 (reuse persistAccount) |
| FR-PIA-023, FR-PIA-024 email | T-PIA-008 |
| FR-PIA-025 sync cap | T-PIA-004, T-PIA-006 |
| NFR-PIA-001..006 | T-PIA-005, T-PIA-008, T-PIA-016 |

| AC | Task |
|---|---|
| AC-PIA-001..003 | T-PIA-004, T-PIA-005, T-PIA-006 |
| AC-PIA-004..007 | T-PIA-007, T-PIA-008 |
| AC-PIA-008..010 | T-PIA-008 |
| AC-PIA-011 | T-PIA-008 |
| AC-PIA-012 | T-PIA-001, T-PIA-009 |

---

## Dependency Graph
```
Phase 1              Phase 2                                          Phase 3              Phase 4                Phase 5
T-PIA-001 (seed) ─┐
T-PIA-002 (dto) ──┤
T-PIA-003 (resp) ─┼─→ T-PIA-005 (zip+template) ─→ T-PIA-006 (parse) ─→ T-PIA-007 (resolve) ─→ T-PIA-008 (orchestrate) ─→ T-PIA-009 (controller) ─→ T-PIA-011/012/013 ─→ T-PIA-014 → T-PIA-015 → T-PIA-016
T-PIA-004 (const)─┘                                                                                                     T-PIA-010 (module)
```

## Parallel Execution Opportunities
| Task | Song song với | Lý do |
|---|---|---|
| T-PIA-002 | T-PIA-003, T-PIA-004 | File độc lập |
| T-PIA-011 | T-PIA-012, T-PIA-013 | Khác file test |
| T-PIA-014 | T-PIA-015 | Build/lint độc lập |

## Implementation Strategy (MVP)
- **Wave 1** (Foundation): T-PIA-001 → (T-PIA-002 + T-PIA-003 + T-PIA-004)
- **Wave 2** (Service): T-PIA-005 → T-PIA-006 → T-PIA-007 → T-PIA-008
- **Wave 3** (Controller): T-PIA-009 + T-PIA-010
- **Wave 4** (Test): T-PIA-011 + T-PIA-012 (regression trước) + T-PIA-013
- **Wave 5** (Verify): T-PIA-014 → T-PIA-015 → T-PIA-016

Lưu ý: KHÁC `ACCT-IMPORT-ACCOUNT-001` (từng phải extract `persistAccount` — điểm rủi ro cao nhất đợt đó), lần này **không có refactor nhạy cảm** — rủi ro cao nhất của đợt này là **thứ tự xử lý ảnh** (phải biết "có khớp không" TRƯỚC khi quyết định dòng valid, nhưng chỉ thực sự upload/validate magic-bytes SAU khi đã qua preview) — cần test kỹ T-PIA-007/T-PIA-008 để không lẫn 2 giai đoạn này.
