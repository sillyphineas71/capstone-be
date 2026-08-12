# Implementation Plan: Import Excel tài khoản Đối tác/Khách hàng tạm thời

- **Feature ID**: PTA-IMPORT-001
- **Created**: 2026-08-12
- **Status**: Draft — **CHƯA implement, chờ Thiếu Chủ cho phép** (theo chỉ thị trực tiếp 2026-08-12)

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | Khởi tạo plan sau khi Thiếu Chủ chốt 7 quyết định thiết kế qua hội thoại | Toàn bộ file |

---

## 1. Feature Summary
Cho phép Business/System Admin (và có thể Manager — mục 7) import hàng loạt tài khoản đối tác/khách hàng tạm thời từ `.xlsx` kèm ảnh sinh trắc học bắt buộc (rời hoặc `.zip`): preview kiểm tra (không ghi DB, không upload ảnh) → commit tạo dòng hợp lệ. Tái dùng `UsersService.persistAccount()` (đã hỗ trợ nhánh `partner` từ PTA-001) và khung sườn 2-bước + xử lý `.zip`/`license_plate` từ `ACCT-IMPORT-ACCOUNT-001`. Route mới `POST /users/import-partners`, permission mới `account.partner.import`, cap 50 dòng.

---

## 2. Technical Context
- **Module**: `accounts` (`src/modules/accounts/`)
- **Framework**: NestJS, TypeORM
- **Excel**: `exceljs` (đã có)
- **Zip**: `jszip` (đã thêm vào `package.json` cùng ngày 2026-08-12 cho `ACCT-IMPORT-ACCOUNT-001`)
- **Upload ảnh**: `FileFieldsInterceptor([{file},{photos},{photosZip}])` (memoryStorage) — mirror `ACCT-IMPORT-ACCOUNT-001`
- **Auth**: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('account.partner.import')`
- **Reuse**:
  - `UsersService.persistAccount()` — core tạo user, đã hỗ trợ `ResolvedAccountData.partner` (KHÔNG cần sửa)
  - `CloudinaryService`, `detectImageMimeType()`, `generateFaceProfileCode()` — pipeline ảnh, y hệt PTA-001 đơn lẻ
  - `buildPartnerAccountWelcomeEmail()` — template email đối tác (đã có từ PTA-001)
  - `PARTNER_DEPARTMENT_ID` (`common/utils/partner-account.util.ts`)
  - Cấu trúc zip-extraction (`extractPhotosFromZip`) và biển số xe (`VehicleRegistrationService.register()`, `ImportAccountVehiclePlateStatus`) — có thể **tái dùng trực tiếp** (import) hoặc **nhân bản nhỏ** trong service mới (xem mục 9, "Chia sẻ vs nhân bản")
- **Database**: PostgreSQL v3.2 Compact — KHÔNG đổi schema

---

## 3. Constitution Check
- **DB Gate**: PASS — không thêm/xóa/đổi bảng, không đổi cột. Chỉ dùng cột `users.account_expires_at` đã có từ PTA-001.
- **Security Gate**: PASS — JWT, permission riêng hẹp (`account.partner.import`), validate ảnh bắt buộc + magic-bytes, không trả mật khẩu, chặn zip-bomb (mirror NFR đã áp cho `ACCT-IMPORT-ACCOUNT-001`).
- **Scope Gate**: PASS — sync only, cap 50 dòng, không bảng lịch sử, không đổi hành vi `persistAccount`/`createUser`/`AccountImportService` hiện có.
- **Module Gate**: PASS — logic mới nằm trong `accounts`; không đụng `anpr` (chỉ gọi `VehicleRegistrationService` đã export sẵn cho `AccountsModule` từ hôm nay), không đụng `auth`.
- **API Gate**: PASS — response chuẩn `{success, message, data, error}`, HTTP codes đúng.
- **Auth Gate**: PASS — permission mới, seed migration riêng (không seeds/).
- **Test Gate**: PASS — unit test mirror `account-import.service.spec.ts`, thêm case riêng cho ảnh bắt buộc + `defaultExpiresInDays` + ép cứng role/department.

**Complexity Justification**:
- Đây là service **mới hoàn toàn**, không refactor code hiện có (khác `ACCT-IMPORT-ACCOUNT-001` từng phải extract `persistAccount` — lần này `persistAccount` đã tồn tại sẵn, chỉ cần tái sử dụng). Rủi ro thấp hơn hẳn so với đợt làm `ACCT-IMPORT-ACCOUNT-001` ban đầu.
- Điểm phức tạp nhất: ảnh là **điều kiện bắt buộc để tạo tài khoản** (không phải side-effect optional) — nghĩa là bước "khớp ảnh" phải chạy **trước** khi quyết định dòng có `valid` hay không, khác thứ tự xử lý của `ACCT-IMPORT-ACCOUNT-001` (nơi ảnh luôn xử lý sau khi đã biết dòng valid/tạo xong).

---

## 4. Scope Confirmation

### In scope
- Endpoint import (multipart, cờ `commit`, field `photos`/`photosZip`/`defaultExpiresInDays`) + endpoint tải template riêng
- Parse `.xlsx` (5 cột: `full_name`, `email`, `account_expires_at`, `phone_number`, `license_plate`), cap 50 dòng, file ≤2MB
- Validate: required fields, email hợp lệ + không trùng (file/DB), `account_expires_at` resolve (cột hoặc `defaultExpiresInDays`) + phải tương lai
- **Ảnh bắt buộc** — khớp theo `email`, thiếu → chặn dòng ngay từ preview
- Ép cứng `department_id=PARTNER_DEPARTMENT_ID`, role `EMPLOYEE` (resolve 1 lần/batch)
- `license_plate` optional, best-effort (tái dùng `ACCT-IMPORT-ACCOUNT-001`)
- Preview 2 bước (`commit=false` không ghi DB/không gọi Cloudinary; `commit=true` tạo thật)
- Reuse `persistAccount()` với `data.partner` đã điền — mật khẩu=email, `must_change_password=false`, `account_expires_at`
- Partial success per-row transaction
- Email chào mừng đối tác (best-effort, `buildPartnerAccountWelcomeEmail`)
- Audit per-row (tự động qua `persistAccount`: `account.partner.create`) + tổng `PARTNER_ACCOUNT_IMPORT`
- Permission mới `account.partner.import`

### Out of scope
- `.xls` legacy; async job; bảng lịch sử import
- Update/gia hạn/khoá sớm hàng loạt qua Excel (vẫn dùng `PATCH /users/:userId` đơn lẻ)
- Cột `role_codes`/`department_code`/`employee_code`/`position_title`/`direct_manager_email`
- Lọc đối tác khỏi participant-picker (đã HOÃN ở PTA-001, không nằm trong phạm vi ở đây)

---

## 5. Data Model Impact
**Không đổi schema.** Chi tiết `data-model.md`. Ghi `users`, `user_roles`, `media_files`, `face_profiles`, `notifications`, `background_jobs`, `audit_logs`, và (best-effort) `vehicle_registrations`.

---

## 6. API / Contract Plan
Chi tiết `contracts/import-partner-accounts-api.md`.

| Endpoint | Method | Permission |
|---|---|---|
| `/users/import-partners` | POST (multipart, `commit` flag) | `account.partner.import` |
| `/users/import-partners/template` | GET | `account.partner.import` |

### DTO: `ImportPartnerAccountsDto`
```
commit?: boolean                 // @IsOptional @Transform(string->boolean) @IsBoolean
defaultExpiresInDays?: number    // @IsOptional @Transform(string->number) @IsInt @Min(1)
```
(File + ảnh nhận qua `@UploadedFiles()`.)

---

## 7. Authorization Plan
1. `JwtAuthGuard` → `request['user']`.
2. `PermissionsGuard` → check `account.partner.import`.
3. **Không** kèm điều kiện permission thứ 2 nào khác (khác `POST /users` hiện tại cần `accounts.user.create`) — vì đây là route riêng, độc lập hoàn toàn với luồng tạo nhân viên.

### Permission seed — điểm cần Thiếu Chủ xác nhận trước khi migration chạy
- Đề xuất seed `account.partner.import` cho **`MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`** — mirror đúng danh sách role của `account.partner.manage` (migration `20260811000002-SeedPartnerAccountManagePermission.ts`) để nhất quán "ai quản được đối tác thì import được đối tác".
- **Khác biệt hành vi cần lưu ý** (đã nêu ở `spec.md` mục 1.6): vì route này **không** yêu cầu thêm `accounts.user.create` như `POST /users`, `MANAGER` sẽ **thực sự import được** ngay khi permission được seed — không bị vướng khoảng hở đã ghi nhận ở PTA-001 (báo cáo `BAO_CAO_BE_TAI_KHOAN_DOI_TAC_SAN_SANG_BAN_GIAO_FE_2026-08-11.md` mục 6.1). Nếu Thiếu Chủ **không** muốn `MANAGER` có quyền này, chỉ seed cho `BUSINESS_ADMIN`/`SYSTEM_ADMIN` — 1 dòng khác trong migration, dễ đổi trước khi chạy lên RDS chung.

---

## 8. Business Logic Plan

### Service mới: `PartnerAccountImportService`
Constructor inject: `DataSource`, `UsersService`, `NotificationsService`, `CloudinaryService`, `VehicleRegistrationService`, `Logger`.

#### `generateTemplate(): Promise<Buffer>`
- `exceljs` workbook: sheet "Partners" (5 header + 1-2 ví dụ), sheet "Huong dan" (giải thích `account_expires_at` optional khi có `defaultExpiresInDays`, ảnh bắt buộc khớp theo email).

#### `importPartnerAccounts(file, photos, photosZip, options, actor, clientContext): Promise<ImportPartnerAccountReportDto>`

**Step 0 — Request-level validation**
1. File tồn tại + MIME `.xlsx` → `400 INVALID_FILE_FORMAT`; size ≤ limit → `400 FILE_TOO_LARGE`.
2. `defaultExpiresInDays` (nếu có) là số nguyên dương → `400 INVALID_DEFAULT_EXPIRES_IN_DAYS`.
3. Nếu có `photosZip`, giải nén (tái dùng/nhân bản `extractPhotosFromZip`) → gộp với `photos[]` thành `allPhotos`.

**Step 1 — Parse & structural validation**
4. `exceljs` load buffer, đọc sheet đầu, map 5 header. Sai/rỗng → `400 INVALID_TEMPLATE`; > 50 dòng → `400 IMPORT_ROW_LIMIT_EXCEEDED`.
5. Chuẩn hóa từng dòng → `ParsedPartnerRow` (trim, email lowercase).

**Step 2 — Static per-row validation**
6. Thiếu `full_name`/`email` → `invalid MISSING_REQUIRED_FIELD`.
7. Email sai định dạng → `invalid INVALID_EMAIL`.
8. Duplicate email trong file → dòng sau `invalid DUPLICATE_IN_FILE`.
9. Resolve `account_expires_at` hiệu lực (cột hoặc `defaultExpiresInDays`) → thiếu cả 2 → `MISSING_ACCOUNT_EXPIRES_AT`; cột có nhưng không parse được → `INVALID_ACCOUNT_EXPIRES_AT`; không ở tương lai → `ACCOUNT_EXPIRES_AT_MUST_BE_FUTURE`.
10. Khớp ảnh theo `email` trong `allPhotos` (không upload) — không khớp → `PARTNER_PHOTO_REQUIRED`.

**Step 3 — Batch resolve (1 lần cho cả batch, KHÔNG phải mỗi dòng)**
11. Query `departments` xác nhận `PARTNER_DEPARTMENT_ID` còn active (an toàn nếu ai đó lỡ vô hiệu hoá — dù đã có bảo vệ ở `departments.service.ts` từ PTA-001).
12. Query `roles` theo `role_code='EMPLOYEE'` active → 1 `roleId` dùng chung mọi dòng.
13. Query `users` theo tập email → email tồn tại → `EMAIL_ALREADY_EXISTS`.

**Step 4 — Preview gate**
14. Nếu `options.commit !== true`: trả `mode='preview'` + `results[]` (valid/invalid) + `validCount`/`invalidCount`. **Không ghi DB, không gọi Cloudinary** (khớp ảnh ở bước 10 chỉ kiểm tra sự tồn tại, không upload).

**Step 5 — Commit (per-row transaction, chỉ dòng valid)**
15. Với mỗi dòng valid:
    - Upload ảnh khớp lên Cloudinary; validate magic-bytes + size (mirror `attachBiometricPhoto` của `ACCT-IMPORT-ACCOUNT-001`, nhưng lỗi ở đây làm dòng **thất bại** thay vì chỉ set status phụ).
    - Build `ResolvedAccountData` với `partner: { accountExpiresAt, mediaFileId, faceProfileId, detectedMime, storageKey, fileUrl, fileName, uploadedBy: actor.id }`.
    - `persistAccount(em, resolvedData, actor.id, ctx)` — TÁI DÙNG NGUYÊN, không sửa.
    - Nếu dòng có `license_plate`, gọi `VehicleRegistrationService.register()` best-effort (mirror `ACCT-IMPORT-ACCOUNT-001`).
    - Thành công → `success` + userId + `accountExpiresAt`; lỗi runtime → `failed` + reason; nếu Cloudinary/DB lỗi SAU khi đã upload ảnh → cleanup Cloudinary orphan (mirror `cleanupCloudinary`).

**Step 6 — Email (best-effort, ngoài transaction)**
16. Với mỗi tài khoản tạo mới → `enqueueEmailNotification` dùng `buildPartnerAccountWelcomeEmail()`.

**Step 7 — Audit tổng + return**
17. Ghi `audit_logs` `PARTNER_ACCOUNT_IMPORT` (totalRows, successCount, failedCount).
18. Return report `mode='commit'`.

---

## 9. Chia sẻ vs nhân bản logic đã có (điểm cần quyết định khi bắt tay code)

| Thành phần | Tùy chọn A: import lại từ `account-import.service.ts` | Tùy chọn B: nhân bản nhỏ trong service mới |
|---|---|---|
| `extractPhotosFromZip()` | Ít trùng lặp code hơn | Giữ đúng tinh thần "tách riêng" của tài liệu này — không tạo phụ thuộc chéo giữa 2 service import |
| Hằng số zip (`MAX_PHOTOS_ZIP_BYTES`, ...) | Dùng chung 1 nguồn sự thật | Có thể lệch giá trị nếu 1 bên đổi mà quên đổi bên kia |

**Khuyến nghị**: **Tùy chọn B** (nhân bản) cho `extractPhotosFromZip` + hằng số liên quan — hàm này nhỏ (~70 dòng), ổn định, và nhân bản giữ đúng ranh giới module độc lập mà mục tiêu "tách riêng" của tài liệu gốc hướng tới (không muốn 2 service import phụ thuộc lẫn nhau, để thay đổi 1 bên không rủi ro bên kia). Nếu sau này xuất hiện consumer thứ 3 cần giải nén zip ảnh (rule of three), tách ra `common/utils/extract-photos-zip.util.ts` dùng chung. Đây là điểm mở — Thiếu Chủ có thể quyết khác khi review.

---

## 10. Error Handling Plan
- Lỗi cấp request → throw exception chuẩn.
- Lỗi cấp dòng (bao gồm `PARTNER_PHOTO_REQUIRED`) → đưa vào `results[]`, không throw.
- Per-row transaction fail (kể cả lỗi upload ảnh) → dòng `failed`, không rollback dòng khác.
- `license_plate` lỗi → KHÔNG đổi `status` dòng, chỉ set `vehiclePlateStatus`.
- Email fail → audit + log, không ảnh hưởng report.
- KHÔNG log/trả mật khẩu (dù = email, vẫn tuân NFR-004 tương tự).

---

## 11. Testing Strategy

### 11.1 Unit — Parser & Resolver (`partner-account-import.service.spec.ts`)
- Header sai/rỗng/quá 50 dòng.
- Static: missing required, invalid email, duplicate-in-file.
- `account_expires_at`: cột có giá trị hợp lệ/không hợp lệ/quá khứ; cột trống + có/không `defaultExpiresInDays`.
- Ảnh: khớp/không khớp theo email (KHÔNG phân biệt hoa thường/đuôi file), qua `photos[]` và qua `photosZip`.

### 11.2 Unit — Preview & Commit
- `commit=false` → không ghi DB, KHÔNG gọi Cloudinary (assert mock `uploadImage` không được gọi).
- `commit=true` → tạo dòng valid với đúng `department_id=PARTNER_DEPARTMENT_ID`, role `EMPLOYEE`, `must_change_password=false`, `account_expires_at` đúng.
- Ảnh lỗi (magic-bytes sai/quá 5MB) ở bước commit → dòng `failed`, KHÔNG tạo user (khác hành vi optional của nhân viên).
- `license_plate`: hợp lệ → `attached`; trùng → `duplicate_plate`, tài khoản vẫn `success`.

### 11.3 Unit — Notification
- Mỗi tài khoản tạo mới → 1 `enqueueEmailNotification` dùng đúng template partner.

### 11.4 Regression
- `persistAccount()`/`createUser()` (đơn lẻ) giữ nguyên hành vi — KHÔNG sửa 2 hàm này, chỉ verify bằng cách chạy lại test suite hiện có, không cần viết test mới.
- `AccountImportService` (import nhân viên) không bị đụng — chạy lại `account-import.service.spec.ts` xác nhận vẫn xanh.

### 11.5 Controller
- 200 preview/commit format; 400 file/zip/defaultExpiresInDays errors; guard/permission `account.partner.import`; template xlsx content-type.

---

## 12. Implementation Phases

### Phase A: Foundation
- **T-PIA-001** Migration seed permission `account.partner.import` + gán role (mục 7 — chờ xác nhận danh sách role).
- **T-PIA-002** DTO `ImportPartnerAccountsDto` (`commit`, `defaultExpiresInDays`).
- **T-PIA-003** Response DTO `ImportPartnerAccountReportDto`, `ImportPartnerAccountRowResult`.
- **T-PIA-004** Constants: `MAX_PARTNER_IMPORT_ROWS=50`, headers, mã lỗi, hằng số zip (nhân bản theo mục 9).

### Phase B: Import service
- **T-PIA-005** Parser + template (`generateTemplate`, `parseWorkbook`).
- **T-PIA-006** Static validation + resolve `account_expires_at` + khớp ảnh (không upload).
- **T-PIA-007** `importPartnerAccounts()` orchestration (preview gate, commit per-row gọi `persistAccount`, license_plate best-effort, email, audit).

### Phase C: Controller & Module
- **T-PIA-008** 2 endpoint trong `UsersController` (`POST/GET .../import-partners`).
- **T-PIA-009** Wire `PartnerAccountImportService` vào `accounts.module.ts` (đã có sẵn `AnprModule` import từ hôm nay cho `VehicleRegistrationService`).

### Phase D: Testing
- **T-PIA-010** Service unit tests (mục 11.1–11.3).
- **T-PIA-011** Regression (mục 11.4).
- **T-PIA-012** Controller tests (mục 11.5).

### Phase E: Verification
- **T-PIA-013** `npm run build`.
- **T-PIA-014** `npm run lint`.

---

## 13. Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Upload Cloudinary chậm với 50 dòng đồng bộ trong 1 request | Medium | Medium | Đo thời gian thật khi implement; cap 50 (cận dưới khoảng đã đồng ý) thay vì 100 ngay từ đầu |
| Nhầm lẫn giữa preview "đã khớp ảnh" và commit "ảnh thực sự hợp lệ" (magic-bytes chỉ check lúc commit) | Medium | Low | Ghi rõ trong response/tài liệu: preview chỉ đảm bảo CÓ file khớp tên, không đảm bảo file đó là ảnh hợp lệ |
| `MANAGER` vô tình có quyền import hàng loạt ngoài ý muốn | Low | Medium | Xác nhận danh sách role trước khi chạy migration (mục 7) |
| Nhân bản `extractPhotosFromZip` lệch hằng số so với bản gốc | Low | Low | Copy nguyên giá trị hằng số tại thời điểm viết, ghi rõ nguồn gốc trong comment |
| Đối tác trùng email với nhân viên thật đã có | Low | Low | Check `EMAIL_ALREADY_EXISTS` đã cover — 1 email chỉ 1 user dù là loại nào |

---

## 14. Acceptance Criteria Traceability
| AC | Task |
|---|---|
| AC-PIA-001..003 (file/template) | T-PIA-004, T-PIA-005 |
| AC-PIA-004..007 (preview/validation) | T-PIA-006, T-PIA-007 |
| AC-PIA-008..010 (commit/BR) | T-PIA-007 |
| AC-PIA-011 (audit) | T-PIA-007 |
| AC-PIA-012 (permission) | T-PIA-001, T-PIA-008 |

---

## 15. Files to Create (KHÔNG modify file nào của `ACCT-IMPORT-ACCOUNT-001`/PTA-001)
| File | Action | Mục đích |
|---|---|---|
| `src/database/migrations/<timestamp>-SeedPartnerImportPermission.ts` | CREATE | Seed permission `account.partner.import` |
| `src/modules/accounts/dto/import-partner-accounts.dto.ts` | CREATE | DTO `commit`/`defaultExpiresInDays` |
| `src/modules/accounts/dto/import-partner-accounts-response.dto.ts` | CREATE | Report/RowResult |
| `src/modules/accounts/constants/import-partner-accounts.constants.ts` | CREATE | Headers, cap, mã lỗi, hằng số zip |
| `src/modules/accounts/services/partner-account-import.service.ts` | CREATE | Parser + orchestration + template |
| `src/modules/accounts/controllers/users.controller.ts` | MODIFY | +2 endpoint mới (route riêng, không đổi route cũ) |
| `src/modules/accounts/accounts.module.ts` | MODIFY | +provider `PartnerAccountImportService` |
| `src/modules/accounts/services/partner-account-import.service.spec.ts` | CREATE | Unit tests |
| `src/modules/accounts/controllers/users.controller.spec.ts` | MODIFY | +test 2 endpoint mới |

**Xác nhận không đụng**: `src/modules/accounts/services/account-import.service.ts`, `src/modules/accounts/services/users.service.ts` (`persistAccount`/`createUser` giữ nguyên 100%), toàn bộ code `PTA-001`.

---

## 16. Dependencies & Integration Points
| Dependency | Integration | Ghi chú |
|---|---|---|
| `exceljs` | Parse + template | Đã có |
| `jszip` | Giải nén `.zip` ảnh | Đã thêm `package.json` 2026-08-12 (`ACCT-IMPORT-ACCOUNT-001`) |
| `UsersService.persistAccount()` | Tạo user + partner branch | Đã có từ PTA-001, KHÔNG sửa |
| `CloudinaryService` | Upload ảnh | Đã có |
| `VehicleRegistrationService` (module `anpr`) | `license_plate` best-effort | `AnprModule` đã export cho `AccountsModule` từ 2026-08-12 |
| `NotificationsService` + `buildPartnerAccountWelcomeEmail` | Email chào mừng | Đã có từ PTA-001 |
| `AdministrationModule` | `AuditLogEntity` | Audit |
