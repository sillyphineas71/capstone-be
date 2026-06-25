# Tasks: Nhắc nhở và tự nộp ảnh đại diện/khuôn mặt (ACCT-AVATAR-SUBMIT-001)

**Feature Directory**: `spec/features/account/feat-user-avatar-submission-reminder`
**Date**: 2026-06-24
**Input**: `spec.md` (required), `plan.md` (required)

> **Ghi chú nguồn**: feature này KHÔNG có file `research.md`, `data-model.md`, `contracts/`, `quickstart.md` riêng — toàn bộ nội dung tương đương (data model, API contract, business logic, validation, error handling, testing strategy) đã được viết đầy đủ trong `spec.md` (mục 6–20) và `plan.md` (mục 2–13). Mọi task dưới đây trace trực tiếp về 2 file đó, không bịa thêm nguồn.

**Tests**: Có yêu cầu test coverage rõ ràng từ người dùng → các task test được giữ lại đầy đủ (không bỏ qua).

---

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo tasks.md lần đầu cho ACCT-AVATAR-SUBMIT-001, dựa trên spec.md + plan.md đã chốt | Toàn bộ file |

---

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Có thể làm song song (file khác nhau, không phụ thuộc trực tiếp kết quả của nhau).
- **[Story]**: `US1` = Xem trạng thái avatar & nhắc nhở (login + GET avatar-status). `US2` = Tự nộp/nộp lại avatar (POST avatar-submission).
- Task không có `[Story]` = task hạ tầng dùng chung (Setup/Foundational) hoặc cross-cutting (Polish).

## Mapping User Story trong spec.md → nhóm task

| Spec User Story | Nhóm task | Ghi chú |
|---|---|---|
| US-01 (nhắc khi đăng nhập), US-04 (không bị nhắc nộp lại khi pending), US-05 (được nhắc khi rejected, phần đọc), US-06 (hết popup khi approved) | **US1** | Toàn bộ là hệ quả của đúng 1 logic resolve trạng thái (BR-004), hiển thị ở login response + GET avatar-status |
| US-02 (tắt popup, tiếp tục dùng hệ thống) | **Không có backend task** | Theo BR-015, backend KHÔNG lưu trạng thái dismiss — hành vi này hoàn toàn ở FE. Việc "tiếp tục dùng hệ thống" đã tự nhiên đúng vì plan này không có task nào chặn truy cập (OOS-005) |
| US-03 (tự upload), US-04 (phần ghi — block resubmit khi pending), US-05 (phần ghi — cho resubmit khi rejected) | **US2** | Cùng 1 service `AvatarSubmissionService.submit()` |

---

## Phase 1: Setup

**Mục đích**: Chuẩn bị dependency/env cho toàn feature trước khi viết code nghiệp vụ.

- [x] T001 Cài npm package `cloudinary` (SDK chính thức, CommonJS-compatible) vào `package.json`/`package-lock.json` (plan.md §2, §7.5)
- [x] T002 [P] Thêm vào `.env.example`: `CLOUDINARY_CLOUD_NAME=`, `CLOUDINARY_API_KEY=`, `CLOUDINARY_API_SECRET=`, `CLOUDINARY_AVATAR_FOLDER=avatars`; xác nhận giữ nguyên dùng lại `FACE_PORTRAIT_MAX_BYTES=5242880` cho giới hạn 5MB (FR-016, plan.md §7.5) — không tạo biến trùng lặp

**Checkpoint**: Dependency và biến môi trường đã sẵn sàng cho Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Mục đích**: Hạ tầng dùng chung mà CẢ US1 và US2 đều phụ thuộc. Không story nào được implement trước khi phase này xong.

**⚠️ CRITICAL**: Không bắt đầu Phase 3/4 trước khi Phase 2 hoàn tất.

### Database / Schema

- [x] T003 [P] Tạo migration DDL `src/database/migrations/<timestamp>-AddFaceProfilesUserPendingUniqueIndex.ts`: `CREATE UNIQUE INDEX IF NOT EXISTS ux_face_profiles_user_pending ON face_profiles(user_id) WHERE status = 'pending_review' AND deleted_at IS NULL;` + `down()` drop index (BR-010, DM-01, spec.md §18.5, plan.md §4.2)
- [x] T004 [P] Tạo migration data-seed `src/database/migrations/<timestamp>-SeedProfileAvatarPermissions.ts`: INSERT idempotent 2 permission `profile.avatar.read_status`/`profile.avatar.submit` (module_code=`accounts`) + gán qua `role_permissions` cho `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`, dùng `ON CONFLICT DO NOTHING` + fallback `SELECT` để đảm bảo idempotent thật (AR-01, spec.md §10, plan.md §4.3) — **không** đặt trong `src/database/seeds/` (không có runner xác nhận hoạt động)
- [x] T005 [P] Thêm `REJECTED = 'rejected'` vào enum `FaceProfileStatus` trong `src/modules/accounts/entities/face-profile.entity.ts` (BR-014, không cần migration DDL vì cột là `varchar(30)` không CHECK constraint)

### Shared utilities (pure function / không DI)

- [x] T006 [P] Tạo `src/modules/accounts/utils/face-profile-code.util.ts` với `generateFaceProfileCode(): string` trả về `` `FP-${randomUUID().replace(/-/g,'').toUpperCase()}` `` (BR-PROFILE-CODE, plan.md §7.2)
- [x] T007 Cập nhật `src/modules/accounts/services/face-profile.service.ts` (`FaceProfileService.enrollPortrait`, UC-17): thay biểu thức inline `` `FP-${randomUUID().slice(0, 8)}` `` bằng `generateFaceProfileCode()` từ T006 — chỉ đổi cách sinh `profile_code`, không đổi behavior/permission/API của UC-17 (phụ thuộc T006)
- [x] T008 [P] Tạo `src/common/utils/avatar-status-resolver.util.ts` với type `FaceProfileStatusRow`, `AvatarReviewResolution` và hàm pure `resolveAvatarReviewStatus(rows): AvatarReviewResolution` implement đúng thứ tự ưu tiên BR-004 (pending_review > active > rejected/disabled/revoked > not_uploaded), `avatarRequired` theo BR-006, `shouldShowAvatarPopup` theo BR-005 (plan.md §7.1) — đặt ở `common` (không phải `accounts` hay `auth`) để cả 2 module dùng chung mà không tạo cross-module import
- [x] T009 [P] Tạo `src/modules/accounts/utils/image-magic-bytes.util.ts` với `detectImageMimeType(buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null`, check magic bytes JPEG (`FF D8 FF`), PNG (8-byte signature), WEBP (`RIFF`...`WEBP`) — không thêm npm dependency (VL-02, plan.md §7.4)

### Cloudinary integration

- [x] T010 Tạo `src/modules/storage/cloudinary.service.ts` (`CloudinaryService`) với `uploadImage(buffer, folder): Promise<{publicId, secureUrl}>` và `deleteImage(publicId): Promise<void>`, config qua `ConfigService` đọc `CLOUDINARY_*` (phụ thuộc T001, T002; BR-013, plan.md §7.5) — **không** sửa `StorageService` hiện có
- [x] T011 Đăng ký `CloudinaryService` vào `src/modules/storage/storage.module.ts` (providers + exports) để `accounts` module import dùng (phụ thuộc T010)

### Unit test cho hạ tầng dùng chung

- [x] T012 [P] Viết `src/common/utils/avatar-status-resolver.util.spec.ts`: không có row → `not_uploaded`; chỉ `pending_review` → `pending_review`/popup=false; chỉ `active` → `approved`/required=false; chỉ `rejected` → `rejected`/popup=true; chỉ `disabled` → `rejected`; chỉ `revoked` → `rejected`; `active`+`pending_review` → `pending_review` (case trọng yếu — AC-003/AC-006b); `pending_review`+`revoked` → `pending_review`; `active`+`revoked` (không pending) → `approved`; hỗn hợp active+rejected+disabled (không pending) → `approved` (phụ thuộc T008; trace AC-001,003,003b,004,006,016,017, EC-007)
- [x] T013 [P] Viết `src/modules/accounts/utils/image-magic-bytes.util.spec.ts`: buffer JPEG/PNG/WEBP thật → đúng MIME; buffer PDF/random/rỗng/quá ngắn → `null` (phụ thuộc T009; trace AC-008, FR-015)
- [x] T014 [P] Viết `src/modules/accounts/utils/face-profile-code.util.spec.ts`: format đúng `FP-` + 32 hex uppercase, không trùng giữa 2 lần gọi (phụ thuộc T006)
- [x] T015 [P] Chạy lại `src/modules/accounts/services/face-profile.service.spec.ts` (test có sẵn của UC-17) sau T007, xác nhận KHÔNG fail; bổ sung 1 assertion format `profile_code` mới nếu cần (phụ thuộc T007; regression UC-17)
- [x] T016 [P] Viết `src/modules/storage/cloudinary.service.spec.ts`: mock Cloudinary SDK, test `uploadImage` trả đúng `{publicId, secureUrl}`, `deleteImage` gọi đúng API, cả hai throw lỗi đúng cách khi SDK lỗi (phụ thuộc T010)

**Checkpoint**: Migration sẵn sàng chạy, enum/util/Cloudinary service đầy đủ và có test — US1 và US2 có thể bắt đầu song song.

---

## Phase 3: User Story 1 — Xem trạng thái avatar & nhắc nhở khi đăng nhập (Priority: P1) 🎯 MVP

**Goal**: User xem được `avatarReviewStatus`/`avatarRequired`/`shouldShowAvatarPopup` đúng theo BR-004 ở cả response login và `GET /api/v1/me/avatar-status`, không bị ảnh hưởng bởi `users.avatar_url` cũ hay nhiều row `face_profiles` lịch sử.

**Independent Test**: Seed sẵn vài user với các tổ hợp row `face_profiles` khác nhau (none/pending/active/rejected/disabled/revoked/active+pending) → gọi `GET /api/v1/me/avatar-status` và đăng nhập (`POST /api/v1/auth/login`) cho từng user → so khớp với bảng AC-001..AC-006b, AC-016, AC-017 trong spec.md mà KHÔNG cần endpoint submission tồn tại.

### Accounts module — GET avatar-status

- [x] T017 [P] [US1] Tạo `src/modules/accounts/dto/avatar-status-response.dto.ts` (`AvatarStatusResponseDto`): `avatarReviewStatus`, `avatarUrl`, `avatarRequired`, `shouldShowAvatarPopup`, `message` (spec.md §8.1)
- [x] T018 [US1] Tạo method đọc trạng thái trong `src/modules/accounts/services/avatar-status.service.ts` (`AvatarStatusService.getStatus(userId)`): query `FaceProfileEntity` repository (`WHERE user_id = :id`, chưa soft-delete) → gọi `resolveAvatarReviewStatus()` (T008) → kết hợp `users.avatar_url` (đọc qua `UserEntity`/`UsersService`, KHÔNG ghi) → build message Việt theo từng status (mục 8.1 spec) (phụ thuộc T008, T017)
- [x] T019 [US1] Tạo `src/modules/accounts/controllers/avatar.controller.ts` (`AvatarController`, `@Controller('me')`) với route `GET avatar-status`: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('profile.avatar.read_status')` (guard THẬT, không dùng `MockPermissionsGuard` như `FaceProfileController`/`MediaFilesController`), lấy `userId` từ `@CurrentUser()`, thêm Swagger decorators (`@ApiTags`, `@ApiOperation`, `@ApiResponse`) theo đúng style `UsersController` (phụ thuộc T018; FR-003, FR-021, FR-022, AC-011)
- [x] T020 [US1] Đăng ký `AvatarController` + `AvatarStatusService` vào `src/modules/accounts/accounts.module.ts` (controllers/providers) (phụ thuộc T019)

### Auth module — login response

- [x] T021 [P] [US1] Tạo `src/modules/auth/repositories/avatar-status-raw.repository.ts` (`AvatarStatusRawRepository`): `getFaceProfileRows(userId)` dùng `DataSource.query()` parameterized, `SELECT status, last_updated_at, enrolled_at FROM face_profiles WHERE user_id = $1 AND deleted_at IS NULL` (SB-01; **không** import gì từ `AccountsModule`)
- [x] T022 [P] [US1] Cập nhật `src/modules/auth/types/login.types.ts`: thêm `avatarReviewStatus`, `avatarRequired`, `shouldShowAvatarPopup` vào interface `AuthUserSummary`
- [x] T023 [US1] Cập nhật `src/modules/auth/presenters/login-response.presenter.ts` (`userSummary()`): copy 3 field mới từ input vào output (phụ thuộc T022)
- [x] T024 [US1] Cập nhật `src/modules/auth/services/login.service.ts` (`LoginService.login`): gọi `AvatarStatusRawRepository.getFaceProfileRows(user.id)` (T021) → `resolveAvatarReviewStatus()` (T008) → gán vào `summary`; bọc try/catch resilience — lỗi đọc avatar status KHÔNG làm fail toàn bộ login, fallback `avatarReviewStatus='not_uploaded'` + log warning (phụ thuộc T021, T022; BR-016)
- [x] T025 [US1] Đăng ký `AvatarStatusRawRepository` vào `src/modules/auth/auth.module.ts` (providers) (phụ thuộc T021)

### Test cho User Story 1

- [x] T026 [P] [US1] Viết `src/modules/accounts/services/avatar-status.service.spec.ts`: đủ các case ở T012 áp lên qua repository thật (mock TypeORM repository trả về rows), cộng case `avatarUrl` lấy đúng từ `users.avatar_url` khi `approved`, `null` khi không phải (phụ thuộc T018; trace AC-001, AC-003, AC-003b, AC-004, AC-006, AC-016, AC-017)
- [x] T027 [P] [US1] Viết `src/modules/accounts/controllers/avatar.controller.spec.ts` (route GET): gọi đúng service với `userId` từ `@CurrentUser()`, verify metadata `@RequirePermissions('profile.avatar.read_status')` (phụ thuộc T019; trace FR-003, AC-011)
- [x] T028 [P] [US1] Viết `src/modules/auth/repositories/avatar-status-raw.repository.spec.ts`: mock `DataSource.query`, assert SQL có `WHERE user_id = $1 AND deleted_at IS NULL`, đúng tham số binding (phụ thuộc T021)
- [x] T029 [US1] Cập nhật `src/modules/auth/services/login.service.spec.ts`: thêm case response login chứa đúng 3 field mới theo rows mock (not_uploaded/pending_review/active/rejected), và case lỗi đọc avatar status không làm fail login (phụ thuộc T024; trace AC-001, AC-004, AC-006)

**Checkpoint**: US1 hoàn chỉnh, test độc lập — `GET /api/v1/me/avatar-status` và login response trả đúng `avatarReviewStatus` cho mọi tổ hợp row `face_profiles` mà KHÔNG cần endpoint submission.

---

## Phase 4: User Story 2 — Tự nộp / nộp lại avatar (Priority: P1)

**Goal**: User tự upload ảnh (lần đầu, sau reject, hoặc thay thế ảnh đã approve) qua `POST /api/v1/me/avatar-submission`, đúng transaction boundary, validation precedence, và audit logging theo spec.md mục 11.2/18.7.

**Independent Test**: Gọi `POST /api/v1/me/avatar-submission` với file hợp lệ cho user ở từng trạng thái (not_uploaded/rejected/approved/pending_review) → kiểm tra response, `face_profiles`/`media_files`/`audit_logs` đúng theo AC-002, AC-005, AC-006b, AC-013 — độc lập với US1 (không cần gọi GET trước, dù có thể gọi GET SAU để xác nhận theo AC-006b).

### DTO & Exception filter

- [x] T030 [P] [US2] Tạo `src/modules/accounts/dto/submit-avatar.dto.ts` (`SubmitAvatarDto`): field `consentAccepted` với `@Transform(({value}) => value === true || value === 'true')` + `@Equals(true, {message:...})` (BR-011, VL-01, AC-010, AC-010b)
- [x] T031 [P] [US2] Tạo `src/modules/accounts/dto/avatar-submission-response.dto.ts` (`AvatarSubmissionResponseDto`): `faceProfileId`, `avatarReviewStatus`, `submittedAt` (spec.md §8.2)
- [x] T032 [P] [US2] Tạo `src/modules/accounts/filters/avatar-http-exception.filter.ts` (`AvatarHttpExceptionFilter`, `@Catch(HttpException)`): reshape `{code,message}` body thành envelope `{success:false, message, error:{code,details:{}}, timestamp, path}` đúng `spec.md` §11 — scoped chỉ cho `AvatarController`, không sửa `CommonModule`/`QueryFailedFilter` toàn cục (plan.md §9.2)

### Business logic — submission flow

- [x] T033 [US2] Implement `AvatarSubmissionService.submit(userId, file, consentAccepted)` trong `src/modules/accounts/services/avatar-submission.service.ts`, đúng 12 bước spec.md §18.7 (phụ thuộc T005, T006, T008 không trực tiếp nhưng cùng module, T009, T010, T030):
  1. Load user, check `account_status='active'` + `deleted_at IS NULL` → `ACCOUNT_NOT_ACTIVE` (FR-018, ERR-007)
  2. Validate file tồn tại → `AVATAR_FILE_REQUIRED` (FR-014, ERR-001)
  3. Validate size ≤ `FACE_PORTRAIT_MAX_BYTES` → `AVATAR_FILE_TOO_LARGE` (FR-016, ERR-002)
  4. `detectImageMimeType()` (T009) → nếu `null` → `AVATAR_FILE_TYPE_INVALID` (FR-015, ERR-003)
  5. Validate `consentAccepted` đã transform = `true` → `AVATAR_CONSENT_REQUIRED` (FR-017, ERR-004)
  6. SELECT `face_profiles` theo `user_id` (chưa soft-delete) → nếu có `status='pending_review'` → `AVATAR_ALREADY_PENDING_REVIEW` (BR-007, ERR-008), dừng TRƯỚC khi gọi Cloudinary
  7. Xác định `actionType` = `avatar.upload` nếu chưa từng có row, ngược lại `avatar.reupload` (BR-012)
  8. Pre-generate `faceProfileId`, `mediaFileId` (`randomUUID()`) (spec.md §18.7 bước 3-4)
  9. `CloudinaryService.uploadImage()` (T010) — lỗi → `AVATAR_STORAGE_FAILED` (502, ERR-009), KHÔNG mở transaction
  10. `dataSource.transaction()`: re-check pending_review (lưới đầu) → INSERT `media_files` (storage_provider=`cloud_provider`, FR-012) → INSERT `face_profiles` (`status='pending_review'`, `consent_at=now()`, `profile_code=generateFaceProfileCode()` T006) → INSERT `audit_logs` (action_type, entity_id=faceProfileId)
  11. Catch `QueryFailedError` `code='23505'` + `constraint='ux_face_profiles_user_pending'` → map `AVATAR_ALREADY_PENDING_REVIEW` (409, EC-003); catch lỗi khác → best-effort `CloudinaryService.deleteImage()` (log info/warning, EH-01) → `AVATAR_UPLOAD_FAILED` (500, ERR-010)
  12. Return `{faceProfileId, avatarReviewStatus:'pending_review', submittedAt}`

### Controller & wiring

- [x] T034 [US2] Mở rộng `src/modules/accounts/controllers/avatar.controller.ts` (file đã tạo ở T019) thêm route `POST avatar-submission`: `@UseInterceptors(FileInterceptor('file', {limits:{fileSize: FACE_PORTRAIT_MAX_BYTES}}))`, `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('profile.avatar.submit')` (guard thật), `@UseFilters(AvatarHttpExceptionFilter)` (T032), `@Body() dto: SubmitAvatarDto` (T030), Swagger decorators (phụ thuộc T019, T030, T032, T033; FR-021, FR-023, AC-011, AC-012)
- [x] T035 [US2] Đăng ký `AvatarSubmissionService` (+ `CloudinaryService` từ `storage` module nếu chưa export sẵn) vào `src/modules/accounts/accounts.module.ts` (phụ thuộc T020, T033) — sửa tiếp file đã sửa ở T020, KHÔNG đánh `[P]`

### Test cho User Story 2

- [x] T036 [P] [US2] Viết `src/modules/accounts/services/avatar-submission.service.spec.ts` (mock `DataSource`, Repository, `CloudinaryService`, theo style `face-profile.service.spec.ts`), bao gồm toàn bộ case sau (phụ thuộc T033):
  - Happy path lần đầu (chưa có row) → upload Cloudinary, INSERT đủ 3 bảng, `avatar.upload` (AC-002)
  - Happy path reupload sau reject (có row `rejected`) → row mới `pending_review`, row cũ giữ nguyên, `avatar.reupload` (AC-005)
  - Happy path replace khi đã approved (có row `active`) → row mới `pending_review`, row `active` giữ nguyên, không touch `users.avatar_url` (AC-006b)
  - Block khi đang `pending_review` → `AVATAR_ALREADY_PENDING_REVIEW`, KHÔNG gọi Cloudinary (AC-013)
  - Thiếu file / sai magic bytes / quá 5MB / consent sai (`false`, thiếu field) → đúng lỗi theo đúng thứ tự precedence mục 11.2 (AC-007, AC-008, AC-009, AC-010)
  - `consentAccepted="true"` (string) → hợp lệ, không reject (AC-010b)
  - Account không active → `ACCOUNT_NOT_ACTIVE`, không gọi Cloudinary (AC-014)
  - Cloudinary upload throw → `AVATAR_STORAGE_FAILED`, không insert gì (ERR-009)
  - Transaction lỗi thường (không phải unique violation) → rollback + gọi `CloudinaryService.deleteImage` với đúng `publicId` → `AVATAR_UPLOAD_FAILED` (EC-004)
  - Transaction lỗi unique violation `23505` đúng constraint → map `AVATAR_ALREADY_PENDING_REVIEW`, KHÔNG cleanup Cloudinary (đã insert hợp lệ ở nhánh thắng) (EC-003)
- [x] T037 [P] [US2] Mở rộng `src/modules/accounts/controllers/avatar.controller.spec.ts` (file đã tạo ở T027) thêm test route POST: gọi đúng service với `file`/`dto.consentAccepted`/`userId`, verify metadata `@RequirePermissions('profile.avatar.submit')` (phụ thuộc T034; AC-011, AC-012)
- [x] T038 [P] [US2] Viết `src/modules/accounts/filters/avatar-http-exception.filter.spec.ts`: input `HttpException({code,message}, status)` → output đúng envelope `{success:false, message, error:{code,details:{}}, timestamp, path}` (phụ thuộc T032)

**Checkpoint**: US2 hoàn chỉnh, test độc lập — submission flow đúng transaction boundary, validation precedence, audit logging, không phụ thuộc US1 để hoạt động (dù 2 story dùng chung hạ tầng Phase 2).

---

## Phase 5: Polish & Cross-Cutting Concerns

**Mục đích**: Đảm bảo chất lượng tổng thể trước khi coi feature hoàn tất, không thêm hành vi nghiệp vụ mới.

- [x] T039 [P] Chạy `npm run lint` cho toàn bộ file mới/sửa (accounts, auth, storage, common) — sửa lỗi lint nếu có
- [x] T040 Chạy `npm run test` cho 2 module `accounts` và `auth` — xác nhận toàn bộ test cũ (bao gồm UC-17, login) vẫn pass sau các thay đổi (phụ thuộc toàn bộ T003–T038)
- [x] T041 [P] Đối chiếu thủ công từng AC trong `spec.md` mục 14 (AC-001 → AC-017 + biến thể a/b) với test đã viết ở T012, T026, T027, T036, T037 — điền/cập nhật bảng Requirements Coverage cuối file nếu phát hiện thiếu
- [x] T042 [P] Kiểm tra `.env.example` đã có đủ `CLOUDINARY_*` (T002) và README/setup doc liên quan storage (nếu có) được cập nhật nhắc đến Cloudinary là storage provider mới cho avatar (chỉ cập nhật docs hiện có, không tạo doc mới ngoài yêu cầu)

**Checkpoint**: Feature ACCT-AVATAR-SUBMIT-001 sẵn sàng review/merge.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: không phụ thuộc gì — bắt đầu ngay.
- **Foundational (Phase 2)**: phụ thuộc Phase 1 hoàn tất (T010/T011 cần T001/T002) — **CHẶN** toàn bộ Phase 3/4.
- **US1 (Phase 3)** và **US2 (Phase 4)**: cả hai phụ thuộc Phase 2 hoàn tất; sau đó có thể làm **song song** (2 nhóm task không đụng file nhau, trừ T034/T035/T037 mở rộng file đã tạo ở Phase 3 — xem ghi chú dưới).
- **Polish (Phase 5)**: phụ thuộc cả Phase 3 và Phase 4 hoàn tất.

### Lưu ý phụ thuộc chéo US1 ↔ US2 (không phá independence, chỉ chia sẻ file)

- `avatar.controller.ts` được **tạo** ở T019 (US1, route GET) và **mở rộng** ở T034 (US2, thêm route POST) — về mặt thực thi, T034 phải chạy SAU T019 (cùng file), nhưng về mặt nghiệp vụ US2 không cần US1 "hoạt động đúng" để tự nó đúng (route GET và POST độc lập về logic).
- `avatar.controller.spec.ts` tương tự: tạo ở T027 (US1), mở rộng ở T037 (US2).
- `accounts.module.ts` được sửa ở T020 (US1) rồi T035 (US2) — sửa tiếp nối, không đánh `[P]` cho T035.

### Parallel Opportunities

- Phase 1: T001, T002 chạy song song.
- Phase 2: T003, T004, T005, T006, T008, T009 chạy song song (file độc lập); T007 chờ T006; T010 chờ T001/T002; T011 chờ T010; nhóm test T012–T016 chạy song song sau khi util/service tương ứng xong.
- Phase 3 & 4: sau khi Phase 2 xong, 2 nhóm developer có thể nhận US1 và US2 đồng thời. Trong US1: T017/T021/T022 song song; T018 chờ T017; T019 chờ T018; T020 chờ T019; T023 chờ T022; T024 chờ T021+T022; T025 chờ T021. Trong US2: T030/T031/T032 song song; T033 là task lớn trung tâm (chờ Phase 2 đầy đủ); T034 chờ T033+T030+T032 (và chờ T019 vì cùng file); T035 chờ T034.
- Test tasks T012–T016, T026–T029, T036–T038 đều có thể chạy song song với NHAU (file test khác nhau), miễn implementation tương ứng đã xong.

---

## Parallel Example

```bash
# Sau khi Phase 2 hoàn tất, launch song song toàn bộ DTO/filter của US2:
Task: "Tạo SubmitAvatarDto trong src/modules/accounts/dto/submit-avatar.dto.ts"
Task: "Tạo AvatarSubmissionResponseDto trong src/modules/accounts/dto/avatar-submission-response.dto.ts"
Task: "Tạo AvatarHttpExceptionFilter trong src/modules/accounts/filters/avatar-http-exception.filter.ts"

# Song song toàn bộ phần raw-SQL của US1 (auth module) với phần TypeORM của US1 (accounts module):
Task: "Tạo AvatarStatusRawRepository trong src/modules/auth/repositories/avatar-status-raw.repository.ts"
Task: "Tạo AvatarStatusResponseDto trong src/modules/accounts/dto/avatar-status-response.dto.ts"
```

---

## Requirements Coverage

| Task ID | FR / BR liên quan | AC liên quan | Component |
|---|---|---|---|
| T001–T002 | BR-013 | AC-015 | npm dependency, env vars |
| T003 | BR-010, DM-01 | AC-015 | Migration: partial unique index |
| T004 | AR-01 | AC-015 | Migration: permission seed |
| T005 | BR-014 | AC-015 | `FaceProfileStatus` enum |
| T006, T007 | BR-PROFILE-CODE | — | `profile_code` generator dùng chung + UC-17 regression |
| T008 | BR-004, BR-005, BR-006 | AC-001, AC-003, AC-003b, AC-004, AC-006, AC-016, AC-017 | `resolveAvatarReviewStatus()` |
| T009 | FR-015, VL-02 | AC-008 | Magic bytes detector |
| T010, T011 | BR-013 | AC-002 | `CloudinaryService` |
| T012 | BR-004 | AC-001,003,003b,004,006,016,017 | Unit test resolver |
| T013 | FR-015 | AC-008 | Unit test magic bytes |
| T014, T015 | BR-PROFILE-CODE | — | Unit test generator + regression UC-17 |
| T016 | BR-013 | — | Unit test Cloudinary |
| T017 | FR-005 | — | `AvatarStatusResponseDto` |
| T018 | FR-001, FR-002, FR-005, BR-002, BR-003 | AC-001,003,003b,004,006,016,017 | `AvatarStatusService` |
| T019, T020 | FR-003, FR-021, FR-022 | AC-011 | `AvatarController` (GET) + wiring |
| T021 | BR-016, SB-01 | — | `AvatarStatusRawRepository` |
| T022, T023 | BR-016 | — | `AuthUserSummary` + presenter |
| T024, T025 | FR-004, FR-011, BR-016 | AC-001, AC-004, AC-006 | `LoginService` integration |
| T026 | FR-001, FR-005 | AC-001,003,003b,004,006,016,017 | Test `AvatarStatusService` |
| T027 | FR-003, FR-021, FR-022 | AC-011 | Test `AvatarController` GET |
| T028 | BR-016 | — | Test `AvatarStatusRawRepository` |
| T029 | FR-004, BR-016 | AC-001, AC-004, AC-006 | Test `LoginService` |
| T030 | FR-017, BR-011, VL-01 | AC-010, AC-010b | `SubmitAvatarDto` |
| T031 | FR-024 | AC-002 | `AvatarSubmissionResponseDto` |
| T032 | EH-02 (envelope) | — | `AvatarHttpExceptionFilter` |
| T033 | FR-006,007,008,009,010,013–020,024,025,026; BR-007,008,009,010,011,012; EH-01; DM-02 | AC-002,005,006b,013,014 | `AvatarSubmissionService.submit()` |
| T034, T035 | FR-003,021,023 | AC-002,011,012,013 | `AvatarController` (POST) + wiring |
| T036 | Toàn bộ FR-006..026, BR liên quan submission | AC-002,005,006b,007,008,009,010,010b,013,014 | Test `AvatarSubmissionService` |
| T037 | FR-003,023 | AC-011, AC-012 | Test `AvatarController` POST |
| T038 | EH-02 | — | Test exception filter |
| T039–T042 | — | Toàn bộ AC-001..017 | Lint/regression/traceability/docs |

---

## Checklist tự kiểm tra trước khi bắt đầu implementation

- [x] Đã đọc `AGENTS.md` trước khi viết tasks.md (RULE TỐI THƯỢNG 1).
- [x] Bám sát `spec.md` + `plan.md`, không tự mở rộng scope (không có task ngoài 2 endpoint + login integration + hạ tầng tối thiểu).
- [x] Không có task nào thuộc Out of Scope của spec.md §19 (admin review, notification, face recognition thật, bảng mới...).
- [x] Mỗi task có outcome cụ thể, file path rõ ràng.
- [x] Dependency giữa task được nêu rõ (mục Dependencies & Execution Order).
- [x] `[P]` chỉ gắn cho task khác file và không chờ kết quả nhau.
- [x] Cover đủ: database (T003-T005), DTO (T017,T030,T031), validation (T030, lồng trong T033), authorization (T019,T034, migration T004), service logic (T018,T033), API/controller (T019,T034), error handling (T032, lồng trong T033), integration (T021-T025), test (T012-T016,T026-T029,T036-T038), documentation (T002,T042).
- [x] Có bảng Requirements Coverage map Task ↔ FR/BR ↔ AC.
- [x] CHANGELOG đã ghi ở đầu file theo RULE TỐI THƯỢNG 2.
