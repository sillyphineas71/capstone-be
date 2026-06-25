# Tasks: Admin Avatar Review Workflow (ACCT-AVATAR-REVIEW-001)

**Feature Directory**: `spec/features/account/feat-admin-avatar-review-workflow`
**Date**: 2026-06-24
**Input**: `spec.md` (required), `plan.md` (required)

> **Ghi chú nguồn**: feature này KHÔNG có file `research.md`, `data-model.md`, `contracts/`, `quickstart.md` riêng — toàn bộ nội dung tương đương (data model, API contract, business logic, validation, error handling, testing strategy) đã được viết đầy đủ trong `spec.md` (mục 3–14) và `plan.md` (mục 2–13). Mọi task dưới đây trace trực tiếp về 2 file đó, không bịa thêm nguồn.

**Tests**: Có yêu cầu test coverage rõ ràng từ người dùng → các task test được giữ lại đầy đủ (không bỏ qua).

---

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo tasks.md lần đầu cho ACCT-AVATAR-REVIEW-001, dựa trên spec.md + plan.md đã chốt | Toàn bộ file |

---

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Có thể làm song song (file khác nhau, không phụ thuộc trực tiếp kết quả của nhau).
- **[Story]**: `US1` = List & xem chi tiết submission. `US2` = Sinh download URL. `US3` = Approve. `US4` = Reject (kèm notification).
- Task không có `[Story]` = task hạ tầng dùng chung (Setup/Foundational) hoặc cross-cutting (Polish).

## Mapping endpoint trong spec.md → User Story

| Endpoint (spec.md §6) | User Story | Permission | Ghi chú |
|---|---|---|---|
| `GET /admin/avatar-submissions` (list) | **US1** | `account.avatar.review` | Browse, không sửa dữ liệu |
| `GET /admin/avatar-submissions/:id` (detail) | **US1** | `account.avatar.review` | Cùng service/controller với list, không signed `imageUrl` |
| `GET /admin/avatar-submissions/:id/download-url` | **US2** | `account.avatar.download` | Permission riêng, capability riêng (signed URL) — tách User Story để test/triển khai độc lập |
| `POST /admin/avatar-submissions/:id/approve` | **US3** | `account.avatar.review` | Transaction approve, revoke old active |
| `POST /admin/avatar-submissions/:id/reject` | **US4** | `account.avatar.review` | Transaction reject + notification, rollback toàn bộ nếu notification fail |

Cả 4 User Story đều **Priority: P1** — đây là 1 workflow thống nhất (System Administrator duyệt avatar), không có phần nào là "nice-to-have" tách biệt theo spec.md.

---

## Phase 1: Setup

**Mục đích**: Chuẩn bị env var cho capability mới (signed download URL) trước khi viết code hạ tầng.

- [x] T001 Thêm vào `.env.example`: `MEDIA_DOWNLOAD_TOKEN_SECRET=change_me`, `MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS=600`, `API_PUBLIC_BASE_URL=http://localhost:3000` (plan.md §4.6) — không tạo biến trùng lặp với `STORAGE_*`/`JWT_*` đã có

**Checkpoint**: Env var sẵn sàng cho Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Mục đích**: Hạ tầng dùng chung mà CẢ 4 User Story đều phụ thuộc (role-check, schema enum, signed-URL capability, pipe/filter chung). Không story nào được implement trước khi phase này xong.

**⚠️ CRITICAL**: Không bắt đầu Phase 3/4/5/6 trước khi Phase 2 hoàn tất.

### Database / Schema

- [x] T002 [P] Tạo migration `src/database/migrations/20260624010000-SeedAdminAvatarReviewPermissions.ts`: INSERT idempotent 2 permission `account.avatar.review`/`account.avatar.download` (`module_code='accounts'` — KHÔNG dùng `'account'` như bảng spec.md §10.3 viết, vì `MODULE_CODE_ALLOWLIST` thật chỉ chấp nhận `'accounts'`, xem plan.md §4.3) + gán qua `role_permissions` CHỈ cho role `SYSTEM_ADMIN` (Q-AR-01), dùng `ON CONFLICT DO NOTHING` + fallback `SELECT` để idempotent thật + `down()` xóa 2 permission đó (spec.md §10.3, plan.md §4.3) — **không** đặt trong `src/database/seeds/` (không có runner xác nhận hoạt động)
- [x] T003 [P] Thêm `REJECTED = 'rejected'` vào enum `FaceProfileStatus` trong `src/modules/accounts/entities/face-profile.entity.ts` (FR-005, không cần migration DDL vì cột `status` là `varchar(30)` không CHECK constraint)
- [x] T004 [P] Thêm `AVATAR_REJECTED = 'avatar_rejected'` vào enum `NotificationType` trong `src/modules/notifications/entities/notification.entity.ts` (FR-013, không cần migration DDL vì cột `notification_type` là `varchar(60)`)

### RolesGuard — hạ tầng auth dùng chung (Q-AR-01)

- [x] T005 [P] Tạo `src/modules/auth/decorators/require-roles.decorator.ts`: `ROLES_KEY` + `RequireRoles(...roles: string[])` dùng `SetMetadata`, mirror đúng style `require-permissions.decorator.ts` (plan.md §6.1)
- [x] T006 Tạo `src/modules/auth/guards/roles.guard.ts` (`RolesGuard implements CanActivate`): đọc metadata qua `Reflector`, lấy `roles` từ `AuthzReadRepository.getEffectiveRolesAndPermissions(userId)`, throw `ForbiddenException({success:false, message, error:{code:'FORBIDDEN', details:{}}})` đúng envelope giống `PermissionsGuard`, pass-through (`return true`) nếu không có `@RequireRoles` metadata (phụ thuộc T005; plan.md §6.1)
- [x] T007 Đăng ký `RolesGuard` vào `providers` + `exports` của `src/modules/auth/auth.module.ts` (cùng vị trí `JwtAuthGuard`/`PermissionsGuard`) — KHÔNG sửa `PermissionsGuard`/`JwtAuthGuard` hiện có (phụ thuộc T006)

### Signed Download URL — capability mới (FR-010/NFR-006)

- [x] T008 [P] Thêm 2 method vào `src/modules/storage/storage.service.ts` (file đã có, chỉ bổ sung): `generateSignedDownloadToken(mediaFileId, ttlSeconds): {token, expiresAt}` (HMAC-SHA256 qua `crypto` built-in, payload `${mediaFileId}|${expiresAtEpochMs}`, secret từ `MEDIA_DOWNLOAD_TOKEN_SECRET`) và `verifySignedDownloadToken(token): {mediaFileId} | null` (verify bằng `timingSafeEqual`, check hết hạn) — không thêm npm dependency mới (phụ thuộc T001; plan.md §4.6, §7.3)
- [x] T009 Thêm route `GET media-files/:fileId/secure-download` vào `src/modules/recording/controllers/media-files.controller.ts` (file đã có): verify token qua T008, check `payload.mediaFileId === fileId`, tái dùng `MediaFilesService.resolvePlayback(fileId)` đã có sẵn để lấy `{path, mimeType, size}`, set `Content-Disposition: attachment`, stream qua `createReadStream` — **không** dùng `JwtAuthGuard` (bảo mật bằng chữ ký token), trả `403 FORBIDDEN` nếu token sai/hết hạn/mismatch fileId (phụ thuộc T008; plan.md §4.6, §7.3)

### Pipe/Filter dùng chung cho `AdminAvatarReviewController` (4/5 route đều cần)

- [x] T010 [P] Tạo `src/modules/accounts/pipes/avatar-submission-id.pipe.ts`: factory `avatarSubmissionIdPipe()` trả `ParseUUIDPipe` với `exceptionFactory` ném `UnprocessableEntityException({success:false, message, error:{code:'VALIDATION_ERROR', details:{}}})` — thay thế hành vi mặc định của `ParseUUIDPipe` (400) để khớp đúng spec.md §2.3 bước 3 (422) (plan.md §8)
- [x] T011 [P] Tạo `src/modules/accounts/filters/admin-avatar-review-http-exception.filter.ts` (`AdminAvatarReviewHttpExceptionFilter`, `@Catch(HttpException)`): reshape `{code,message}` body thành envelope `{success:false, message, error:{code,details:{}}, timestamp, path}` đúng spec.md §7.2 — scoped chỉ cho `AdminAvatarReviewController`, không sửa `CommonModule`/`QueryFailedFilter` toàn cục (plan.md §9.2)

### Unit test cho hạ tầng dùng chung

- [ ] T012 [P] Viết `src/modules/auth/guards/roles.guard.spec.ts`: không có `@RequireRoles` metadata → pass; thiếu role yêu cầu → `ForbiddenException` đúng envelope; có role yêu cầu (trong số nhiều role) → pass (phụ thuộc T006; trace AC-011, AC-013)
- [ ] T013 [P] Viết test cho `generateSignedDownloadToken`/`verifySignedDownloadToken` trong `src/modules/storage/storage.service.spec.ts`: round-trip thành công trong TTL; token hết hạn → `null`; token bị tamper 1 ký tự → `null`; thiếu `MEDIA_DOWNLOAD_TOKEN_SECRET` → throw rõ ràng (phụ thuộc T008)
- [ ] T014 [P] Mở rộng `src/modules/recording/controllers/media-files.controller.spec.ts` thêm test route `secureDownload`: token hợp lệ + đúng fileId → stream đúng `Content-Type`/`Content-Disposition`; token hợp lệ nhưng `mediaFileId` khác `:fileId` → 403; token sai/hết hạn → 403 (phụ thuộc T009)
- [ ] T015 [P] Viết `src/modules/accounts/filters/admin-avatar-review-http-exception.filter.spec.ts`: input `HttpException({code,message}, status)` → output đúng envelope `{success:false, message, error:{code,details:{}}, timestamp, path}` (phụ thuộc T011)

**Checkpoint**: Migration sẵn sàng chạy, `RolesGuard`/signed-URL capability/pipe/filter đầy đủ và có test — US1/US2/US3/US4 có thể bắt đầu song song.

---

## Phase 3: User Story 1 — List & xem chi tiết avatar submissions (Priority: P1)

**Goal**: System Administrator xem được danh sách avatar đang chờ duyệt (hoặc filter theo status khác) có pagination/sort/search/filter đúng whitelist, và xem chi tiết 1 submission (không có signed `imageUrl`).

**Independent Test**: Seed sẵn nhiều `face_profiles` ở các status/department khác nhau → gọi `GET /api/v1/admin/avatar-submissions` với các combo `status`/`q`/`departmentId`/`sortBy`/`sortOrder`/`page`/`limit` và `GET /api/v1/admin/avatar-submissions/:id` → so khớp AC-001, AC-007 (phần detail), AC-008, AC-009, AC-010, AC-011, AC-012, AC-013, AC-DEPTID-EMPTY, AC-SEARCH-ILIKE, AC-PRIMARY-NULL-DOWNLOAD (phần áp dụng cho detail) — **không cần** US2/US3/US4 tồn tại.

### DTO

- [x] T016 [P] [US1] Tạo `src/modules/accounts/dto/list-avatar-submissions-query.dto.ts` (`ListAvatarSubmissionsQueryDto`): `status` (`@IsIn(['pending_review','rejected','active'])`, default `pending_review`, lỗi `INVALID_AVATAR_SUBMISSION_STATUS`), `page`/`limit` (`@Max(100)`, lỗi `INVALID_PAGINATION_LIMIT`, default 20), `sortBy` (`@IsIn` whitelist 6 field, lỗi `INVALID_SORT_BY`), `sortOrder` (`@IsIn(['asc','desc'])`, lỗi `INVALID_SORT_ORDER`), `q` (trim trước validate, `@MinLength(2) @MaxLength(100)`, lỗi `INVALID_SEARCH_QUERY`, rỗng thì bỏ qua search), `departmentId` (`@IsUUID()`, lỗi `INVALID_DEPARTMENT_ID`) (spec.md §6.1, FR-036..039)
- [x] T017 [P] [US1] Tạo `src/modules/accounts/dto/avatar-submission-list-item.dto.ts` (`AvatarSubmissionListItemDto`): `faceProfileId`, `userId`, `fullName`, `email`, `employeeCode`, `departmentName`, `status`, `submittedAt`, `primaryImageFileId`, `qualityScore` (spec.md §6.1)
- [x] T018 [P] [US1] Tạo `src/modules/accounts/dto/avatar-submission-detail.dto.ts` (`AvatarSubmissionDetailDto`): `faceProfileId`, `userId`, `userFullName`, `userEmail`, `status`, `primaryImageFileId`, `imageFile{fileName,mimeType,fileSizeBytes,storageProvider}`, `hasPreview`, `submittedAt`, `consentAt`, `reviewMetadata` — **không** có field `imageUrl` (OOS-007, spec.md §6.2)

### Service & Controller

- [x] T019 [US1] Tạo `src/modules/accounts/services/admin-avatar-review.service.ts` (`AdminAvatarReviewService`, constructor inject `Repository<FaceProfileEntity>`, `DataSource`, `AuditLogsService`, `StorageService`, `ConfigService`) với method `listAvatarSubmissions(query)`: QueryBuilder `FaceProfileEntity` join `UserEntity`/`DepartmentEntity` theo điều kiện tường minh (không có `@ManyToOne` relation sẵn — join bằng entity class + condition), áp `SORT_FIELD_MAP` whitelist (`submittedAt→fp.enrolledAt`, `userFullName→u.fullName`, `employeeCode→u.employeeCode`, `departmentName→d.departmentName`, `status→fp.status`, `qualityScore→fp.qualityScore` với `NULLS LAST`), filter `status`/`departmentId`/`q` (ILIKE parameterized trên `full_name`/`email`/`employee_code`), pagination `skip/take` + `getManyAndCount()` (phụ thuộc T016, T017; FR-008, plan.md §7.1)
- [x] T020 [US1] Thêm method `getAvatarSubmissionDetail(faceProfileId)` vào `AdminAvatarReviewService` (file đã tạo ở T019, sửa tiếp — KHÔNG đánh `[P]`): `findOne` theo id + `deletedAt IS NULL` → 404 `AVATAR_SUBMISSION_NOT_FOUND` nếu không có; join `users`; nếu `primaryImageFileId` null hoặc `media_files` không tồn tại → 404 `AVATAR_MEDIA_NOT_FOUND` (áp dụng nhất quán với FR-023); đọc `metadataJson.review` vào `reviewMetadata` nếu có; **không** trả `imageUrl` (phụ thuộc T018, T019; FR-009, FR-018, FR-023, Q-SB-02)
- [x] T021 [US1] Tạo `src/modules/accounts/controllers/admin-avatar-review.controller.ts` (`AdminAvatarReviewController`, `@Controller('admin/avatar-submissions')`) với 2 route `GET ''` (list) và `GET ':faceProfileId'` (detail): `@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)` + `@RequireRoles('SYSTEM_ADMIN')` + `@RequirePermissions('account.avatar.review')`, `@Param('faceProfileId', avatarSubmissionIdPipe())` (T010) cho route detail, `@UseFilters(AdminAvatarReviewHttpExceptionFilter)` (T011) ở class-level, Swagger decorators theo style `UsersController` (phụ thuộc T019, T020, T006, T007, T010, T011; FR-001, AC-011, AC-012, AC-013)
- [x] T022 [US1] Đăng ký `AdminAvatarReviewController` + `AdminAvatarReviewService` vào `controllers`/`providers` của `src/modules/accounts/accounts.module.ts` (phụ thuộc T021)

### Test cho User Story 1

- [ ] T023 [P] [US1] Viết `src/modules/accounts/services/admin-avatar-review.service.spec.ts` (mock Repository/DataSource) phần `listAvatarSubmissions`: trả đúng `meta` pagination; `sortBy`/`sortOrder` áp đúng `SORT_FIELD_MAP`; `departmentId` hợp lệ không có data → `data=[]` không lỗi (AC-DEPTID-EMPTY); `q` ILIKE match `full_name`/`email`/`employee_code` case-insensitive (AC-SEARCH-ILIKE) (phụ thuộc T019; trace AC-001, AC-008, AC-009, AC-010)
- [ ] T024 [P] [US1] Mở rộng file test T023 phần `getAvatarSubmissionDetail`: 404 `AVATAR_SUBMISSION_NOT_FOUND` khi không tồn tại; `primaryImageFileId` null → 404 `AVATAR_MEDIA_NOT_FOUND`; response không có field `imageUrl` (phụ thuộc T020; trace AC-007, AC-PRIMARY-NULL-DOWNLOAD áp dụng tương tự cho detail)
- [ ] T025 [P] [US1] Viết `src/modules/accounts/controllers/admin-avatar-review.controller.spec.ts` phần route list/detail: gọi đúng service với query/param tương ứng; verify metadata `@RequireRoles('SYSTEM_ADMIN')` + `@RequirePermissions('account.avatar.review')`; UUID sai format → pipe throw `UnprocessableEntityException` code `VALIDATION_ERROR` (phụ thuộc T021; trace AC-011, AC-012, AC-013)

**Checkpoint**: US1 hoàn chỉnh, test độc lập — list/detail trả đúng dữ liệu, đúng filter/sort/pagination, đúng authorization.

---

## Phase 4: User Story 2 — Sinh download URL (Priority: P1)

**Goal**: System Administrator sinh được signed/temporary URL (TTL 5-15 phút) để xem/tải ảnh gốc của 1 submission, có audit log `avatar.download`.

**Independent Test**: Gọi `GET /api/v1/admin/avatar-submissions/:id/download-url` cho submission có/không có `primaryImageFileId`, với/không có permission `account.avatar.download` → so khớp AC-004, AC-018, AC-PRIMARY-NULL-DOWNLOAD, AC-AUTH-ORDER-NO-PERM — độc lập với US1/US3/US4 (chỉ cần Phase 2 + service/controller khung từ US1 đã tồn tại để mở rộng).

### DTO & Service & Controller

- [x] T026 [P] [US2] Tạo `src/modules/accounts/dto/avatar-download-url-response.dto.ts` (`AvatarDownloadUrlResponseDto`): `downloadUrl`, `expiresAt` (ISO 8601, spec.md §6.3)
- [x] T027 [US2] Thêm method `getAvatarDownloadUrl(faceProfileId, adminUserId)` vào `AdminAvatarReviewService` (file đã tạo ở T019, sửa tiếp): `findOne` submission → 404 nếu không có; `primaryImageFileId` null → 404 `AVATAR_MEDIA_NOT_FOUND` (AC-PRIMARY-NULL-DOWNLOAD); lấy `MediaFileEntity` qua `dataSource.getRepository(MediaFileEntity)` → không tồn tại → 404 `AVATAR_MEDIA_NOT_FOUND`; gọi `storageService.generateSignedDownloadToken(mediaFile.id, ttlSeconds)` (T008) — lỗi → 500 `AVATAR_DOWNLOAD_URL_FAILED`; build `downloadUrl` từ `API_PUBLIC_BASE_URL`; ghi audit qua `AuditLogsService.logAction()` (standalone, không cần transaction) với `actionType='avatar.download'`, `metadataJson={targetUserId, mediaFileId, expiresAt}` (phụ thuộc T008, T019, T026; FR-010, FR-029, plan.md §7.3)
- [x] T028 [US2] Thêm route `GET ':faceProfileId/download-url'` vào `AdminAvatarReviewController` (file đã tạo ở T021, sửa tiếp): `@RequirePermissions('account.avatar.download')` (khác permission route list/detail), `@Param('faceProfileId', avatarSubmissionIdPipe())` (T010) (phụ thuộc T021, T027; FR-002, AC-AUTH-ORDER-NO-PERM)

### Test cho User Story 2

- [ ] T029 [P] [US2] Mở rộng `admin-avatar-review.service.spec.ts` (T023) phần `getAvatarDownloadUrl`: happy path trả đúng `downloadUrl`/`expiresAt` + audit ghi đúng (AC-004, AC-018); `primaryImageFileId` null → 404 `AVATAR_MEDIA_NOT_FOUND` (AC-PRIMARY-NULL-DOWNLOAD); `storageService` throw → 500 `AVATAR_DOWNLOAD_URL_FAILED` (phụ thuộc T027)
- [ ] T030 [P] [US2] Mở rộng `admin-avatar-review.controller.spec.ts` (T025) phần route `download-url`: verify metadata permission `account.avatar.download` (khác `account.avatar.review`), gọi đúng service (phụ thuộc T028; trace AC-AUTH-ORDER-NO-PERM)

**Checkpoint**: US2 hoàn chỉnh — download URL sinh đúng, có TTL, có audit, đúng phân quyền riêng.

---

## Phase 5: User Story 3 — Approve avatar submission (Priority: P1)

**Goal**: System Administrator approve 1 submission `pending_review` trong transaction đầy đủ: lock row, revoke old active (nếu có), update `face_profiles`/`users.avatar_url`, ghi audit — rollback toàn bộ nếu bất kỳ bước nào thất bại.

**Independent Test**: Seed `face_profiles.status=pending_review` (có/không có old active cùng user) → gọi `POST /api/v1/admin/avatar-submissions/:id/approve` → so khớp AC-002, AC-002b, AC-006, AC-007 (phần approve), AC-016, AC-PRIMARY-NULL-APPROVE, AC-LOCK-TIMEOUT (phần approve) — độc lập với US1/US2/US4 (chỉ cần Phase 2 + khung controller/service từ US1).

### DTO & Service & Controller

- [x] T031 [P] [US3] Tạo `src/modules/accounts/dto/approve-avatar-submission-response.dto.ts` (`ApproveAvatarSubmissionResponseDto`): `faceProfileId`, `userId`, `status`, `approvedAt` (spec.md §6.4)
- [x] T032 [US3] Thêm method `approveAvatarSubmission(faceProfileId, adminUserId)` vào `AdminAvatarReviewService` (file đã tạo ở T019, sửa tiếp) — `dataSource.transaction()` đúng 7 bước spec.md §13.1: (1) `SELECT...FOR UPDATE` lock pending profile (QueryBuilder `.setLock('pessimistic_write')`) → 404 nếu không có; (2) check `status==pending_review` → 409 `AVATAR_SUBMISSION_NOT_PENDING` nếu sai (LOCK TRƯỚC rồi mới CHECK, không đảo thứ tự — tránh race condition); (3) `SELECT...FOR UPDATE` lock owning user → 404 `USER_NOT_FOUND` nếu không tồn tại/không active/đã soft-delete; (3b) lấy `MediaFileEntity` qua `primaryImageFileId` — null hoặc không có `fileUrl` → 500 `AVATAR_APPROVE_FAILED` (AC-PRIMARY-NULL-APPROVE); (4) tìm old active cùng `user_id` → `UPDATE status='revoked'` nếu có; (5) `UPDATE` pending profile `status='active'`; (6) `UPDATE users.avatar_url = mediaFile.fileUrl` (BR-AVATAR-URL — permanent URL, KHÔNG signed URL); (7) `manager.getRepository(AuditLogEntity).insert(...)` với `actionType='avatar.approve'`, `oldValueJson/newValueJson` đúng spec.md §5.4 — **ghi trực tiếp qua `manager`, KHÔNG qua `AuditLogsService`** (lý do atomicity, plan.md §2/§7.4); catch lock timeout/lỗi infra ngoài transaction → 500 `AVATAR_APPROVE_FAILED` (không map 409, AC-LOCK-TIMEOUT) (phụ thuộc T019, T031; FR-011, FR-027, FR-035, FR-007, BR-AVATAR-URL, plan.md §7.4)
- [x] T033 [US3] Thêm route `POST ':faceProfileId/approve'` vào `AdminAvatarReviewController` (file đã tạo ở T021, sửa tiếp): `@RequirePermissions('account.avatar.review')`, `@CurrentUser()` lấy `adminUserId`, body rỗng (phụ thuộc T021, T032; FR-011)

### Test cho User Story 3

- [ ] T034 [P] [US3] Mở rộng `admin-avatar-review.service.spec.ts` (T023) phần `approveAvatarSubmission`: happy path không có old active — đúng update + audit `oldActiveFaceProfileId=null` (AC-002); happy path có old active — old → `revoked` cùng transaction, audit có `oldActiveFaceProfileId` đúng id (AC-002b); status≠pending → 409, KHÔNG update gì (AC-006); user not found/inactive/deleted → 404 `USER_NOT_FOUND` (AC-007); `primaryImageFileId` null → 500 `AVATAR_APPROVE_FAILED` (AC-PRIMARY-NULL-APPROVE); audit `old/new_value_json` đúng spec.md §5.4 (AC-016); lỗi infra/lock timeout → 500 không phải 409 (AC-LOCK-TIMEOUT) (phụ thuộc T032)
- [ ] T035 [P] [US3] Mở rộng `admin-avatar-review.controller.spec.ts` (T025) phần route `approve`: gọi đúng service với `faceProfileId`/`adminUserId`; verify metadata permission `account.avatar.review` (phụ thuộc T033)

**Checkpoint**: US3 hoàn chỉnh — approve transaction đúng thứ tự, đúng rollback, đúng audit.

---

## Phase 6: User Story 4 — Reject avatar submission kèm notification (Priority: P1)

**Goal**: System Administrator reject 1 submission `pending_review` kèm `reason` hợp lệ, trong transaction: update `face_profiles.status='rejected'` + `metadata_json.review`, ghi audit, tạo `notifications` record — rollback toàn bộ nếu notification insert thất bại.

**Independent Test**: Seed `face_profiles.status=pending_review` → gọi `POST /api/v1/admin/avatar-submissions/:id/reject` với `reason` hợp lệ/rỗng/quá dài → so khớp AC-003, AC-005, AC-007 (phần reject), AC-014, AC-015, AC-017, AC-LOCK-TIMEOUT (phần reject) — độc lập với US1/US2/US3.

### DTO & Service & Controller

- [x] T036 [P] [US4] Tạo `src/modules/accounts/dto/reject-avatar-submission.dto.ts` (`RejectAvatarSubmissionDto`): field `reason` với custom validator — trim + `normalize('NFC')` (built-in `String.prototype.normalize`, không thêm dependency) trước khi validate; rỗng sau trim → lỗi `AVATAR_REJECTION_REASON_REQUIRED`; đếm theo Unicode code point (`Array.from(str).length`, không phải `str.length`) > 500 → lỗi `AVATAR_REJECTION_REASON_TOO_LONG` (FR-020, FR-021, Q-VL-01)
- [x] T037 [P] [US4] Tạo `src/modules/accounts/dto/reject-avatar-submission-response.dto.ts` (`RejectAvatarSubmissionResponseDto`): `faceProfileId`, `userId`, `status`, `rejectedAt` (spec.md §6.5)
- [x] T038 [US4] Thêm method `rejectAvatarSubmission(faceProfileId, reason, adminUserId)` vào `AdminAvatarReviewService` (file đã tạo ở T019, sửa tiếp) — `dataSource.transaction()` đúng spec.md §13.2: (1)-(3) lock pending + check status + lock user (giống T032, dùng `.setLock('pessimistic_write')`, LOCK TRƯỚC CHECK SAU); (4) build `reviewJson = {review:{rejectionReason, reviewedBy:adminUserId, reviewedAt:now}}`, merge vào `metadataJson` hiện có (Q-DM-01 — KHÔNG history array); (5) `UPDATE face_profiles SET status='rejected', metadataJson=...`; (6) `manager.getRepository(AuditLogEntity).insert(...)` với `actionType='avatar.reject'` đúng payload §5.4 — ghi trực tiếp qua `manager`; (7) `manager.getRepository(NotificationEntity).insert(...)` với `notificationType=AVATAR_REJECTED` (T004), `channel='in_app'`, `relatedEntityType='face_profile'`, `relatedEntityId=faceProfileId`, `recipientUserIdsJson=[profile.userId]` (jsonb array, KHÔNG object format — Q-DM-02), `deliveryStatus='queued'` (set trực tiếp, KHÔNG qua `NotificationsService.createNotification()` vì service đó default `draft` và dùng repo riêng không transaction-aware — lý do atomicity, plan.md §2/§7.5); nếu INSERT notification throw → toàn bộ transaction tự rollback (kể cả UPDATE face_profiles và INSERT audit_logs) → 500 `AVATAR_REJECT_FAILED`; catch lock timeout/lỗi infra ngoài transaction → 500 (không map 409) (phụ thuộc T019, T036, T037, T004; FR-012, FR-028, FR-032, FR-034, plan.md §7.5)
- [x] T039 [US4] Thêm route `POST ':faceProfileId/reject'` vào `AdminAvatarReviewController` (file đã tạo ở T021, sửa tiếp): `@RequirePermissions('account.avatar.review')`, `@Body() dto: RejectAvatarSubmissionDto` (T036), `ValidationPipe` global (`whitelist:true, transform:true`) đã có sẵn ở `main.ts` (phụ thuộc T021, T036, T038; FR-012)

### Test cho User Story 4

- [ ] T040 [P] [US4] Mở rộng `admin-avatar-review.service.spec.ts` (T023) phần `rejectAvatarSubmission`: happy path — `metadata_json.review` đúng format không history array (AC-003); `recipientUserIdsJson=[userId]` array không object, `deliveryStatus=QUEUED` (AC-014); reason rỗng/chỉ whitespace sau trim → 422 `AVATAR_REJECTION_REASON_REQUIRED` (AC-005); reason > 500 Unicode chars (test với ký tự có dấu tổ hợp tiếng Việt, không chỉ ASCII) → 422 `AVATAR_REJECTION_REASON_TOO_LONG`; status≠pending → 409; user not found → 404; audit `old/new_value_json` đúng §5.4 (AC-017); giả lập notification insert throw trong transaction → rollback toàn bộ, `face_profiles.status` không đổi, 500 `AVATAR_REJECT_FAILED` (AC-015); lỗi infra/lock timeout → 500 không phải 409 (AC-LOCK-TIMEOUT) (phụ thuộc T038)
- [ ] T041 [P] [US4] Mở rộng `admin-avatar-review.controller.spec.ts` (T025) phần route `reject`: gọi đúng service với `reason` đã qua DTO transform; verify metadata permission; DTO reject `reason` sai format đúng lỗi tương ứng (phụ thuộc T039)

**Checkpoint**: US4 hoàn chỉnh — reject transaction đúng atomicity, notification đúng format, rollback đúng khi fail.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Mục đích**: Đảm bảo chất lượng tổng thể và tính nhất quán giữa 2 transaction (approve/reject) trước khi coi feature hoàn tất, không thêm hành vi nghiệp vụ mới.

- [x] T042 [P] Chạy `npm run lint` cho toàn bộ file mới/sửa (`accounts`, `auth`, `storage`, `recording`, `notifications`) — sửa lỗi lint nếu có
- [x] T043 Chạy `npm run test` cho 5 module `accounts`, `auth`, `storage`, `recording`, `notifications`, `administration` — xác nhận toàn bộ test cũ (kể cả UC-17, `PermissionsGuard`, `media-files.controller` cũ) vẫn pass sau các thay đổi (phụ thuộc toàn bộ T002–T041)
- [ ] T044 [P] Viết test concurrency: mô phỏng 2 transaction gọi `approveAvatarSubmission`/`rejectAvatarSubmission` gần như đồng thời trên cùng `faceProfileId` (mock: transaction 1 commit trước, transaction 2 đọc lại `status` đã đổi sau khi acquire lock) → transaction 2 nhận 409 `AVATAR_SUBMISSION_NOT_PENDING`, KHÔNG tạo audit/notification trùng (phụ thuộc T032, T038; trace AC-CONCURRENT-001)
- [x] T045 [P] Chạy `npm run migration:run` trên DB dev cho migration T002, verify idempotent (chạy lại lần 2 không lỗi, không tạo duplicate permission/role_permission)
- [ ] T046 [P] Đối chiếu thủ công toàn bộ AC trong `spec.md` mục 8 (8.1–8.7) với test đã viết ở T012–T015, T023–T025, T029–T030, T034–T035, T040–T041, T044 — điền/xác nhận lại bảng Requirements Coverage cuối file nếu phát hiện thiếu
- [x] T047 [P] Xác nhận `.env.example` đã có đủ `MEDIA_DOWNLOAD_TOKEN_SECRET`/`MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS`/`API_PUBLIC_BASE_URL` (T001) — không tạo doc mới ngoài yêu cầu

**Checkpoint**: Feature ACCT-AVATAR-REVIEW-001 sẵn sàng review/merge.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: không phụ thuộc gì — bắt đầu ngay.
- **Foundational (Phase 2)**: phụ thuộc Phase 1 (T008 cần T001) — **CHẶN** toàn bộ Phase 3/4/5/6.
- **US1 (Phase 3)**: phụ thuộc Phase 2 hoàn tất. Tạo khung `AdminAvatarReviewController`/`AdminAvatarReviewService` lần đầu.
- **US2 (Phase 4)**, **US3 (Phase 5)**, **US4 (Phase 6)**: phụ thuộc Phase 2 hoàn tất VÀ phụ thuộc khung controller/service đã tạo ở US1 (T019, T021) vì cùng mở rộng 2 file đó — về mặt **thực thi** phải chạy SAU T019/T021, nhưng về mặt **nghiệp vụ** mỗi story độc lập đúng (route/method riêng, không gọi chéo lẫn nhau).
- **Polish (Phase 7)**: phụ thuộc cả 4 User Story hoàn tất.

### Lưu ý phụ thuộc chéo giữa 4 User Story (không phá independence, chỉ chia sẻ file)

- `admin-avatar-review.service.ts` được **tạo** ở T019 (US1) và **mở rộng** thêm method ở T020 (US1, detail), T027 (US2), T032 (US3), T038 (US4) — mỗi method độc lập về logic, chỉ chung 1 file/1 class.
- `admin-avatar-review.controller.ts` tương tự: tạo ở T021 (US1), mở rộng route ở T028 (US2), T033 (US3), T039 (US4).
- `admin-avatar-review.service.spec.ts` và `admin-avatar-review.controller.spec.ts` cũng theo mô hình tạo-ở-US1/mở-rộng-ở-US2-3-4 (T023/T025 tạo, T029/T030/T034/T035/T040/T041 mở rộng).
- `accounts.module.ts` chỉ sửa **1 lần** ở T022 (đăng ký đủ controller + service) — US2/US3/US4 không cần sửa lại file này vì chỉ thêm method/route vào class đã đăng ký.

### Parallel Opportunities

- Phase 2: T002, T003, T004, T005, T008, T010, T011 chạy song song (file độc lập); T006 chờ T005; T007 chờ T006; T009 chờ T008; nhóm test T012–T015 chạy song song sau khi hạ tầng tương ứng xong.
- Phase 3 (US1): T016/T017/T018 song song; T019 chờ T016+T017; T020 chờ T018 (và cùng file T019, không [P]); T021 chờ T019+T020+T006+T007+T010+T011; T022 chờ T021; T023/T024/T025 song song sau khi T019-T021 xong.
- Sau khi US1 xong (T019, T021 có sẵn): **3 nhóm developer có thể nhận US2, US3, US4 đồng thời** — mỗi nhóm chỉ thêm method/route riêng, không đụng logic của nhau (dù chung file). Trong từng story: DTO task song song, method-service task chờ DTO, route-controller task chờ method-service, test task song song sau cùng.
- Phase 7: T042, T044, T045, T046, T047 chạy song song; T043 nên chạy sau khi merge code từ cả 4 story (không bắt buộc [P] vì là bước xác nhận tổng).

---

## Parallel Example

```bash
# Sau khi Phase 2 hoàn tất, launch song song toàn bộ DTO của US1:
Task: "Tạo ListAvatarSubmissionsQueryDto trong src/modules/accounts/dto/list-avatar-submissions-query.dto.ts"
Task: "Tạo AvatarSubmissionListItemDto trong src/modules/accounts/dto/avatar-submission-list-item.dto.ts"
Task: "Tạo AvatarSubmissionDetailDto trong src/modules/accounts/dto/avatar-submission-detail.dto.ts"

# Sau khi US1 (T019, T021) xong, launch song song 3 User Story còn lại:
Task: "Thêm method getAvatarDownloadUrl vào AdminAvatarReviewService (US2)"
Task: "Thêm method approveAvatarSubmission vào AdminAvatarReviewService (US3)"
Task: "Thêm method rejectAvatarSubmission vào AdminAvatarReviewService (US4)"
```

---

## Requirements Coverage

| Task ID | FR / BR liên quan | AC liên quan | Component |
|---|---|---|---|
| T001 | FR-010, NFR-006 | — | Env var signed URL |
| T002 | FR-001, FR-002 | AC-011, AC-013 | Migration: permission seed |
| T003 | FR-005 | — | `FaceProfileStatus.REJECTED` |
| T004 | FR-013 | — | `NotificationType.AVATAR_REJECTED` |
| T005–T007 | FR-001, FR-002, Q-AR-01 | AC-011, AC-013 | `RequireRoles` + `RolesGuard` |
| T008–T009 | FR-010, NFR-006 | AC-004 | Signed download token + `secure-download` endpoint |
| T010 | §2.3 (UUID validation) | — | `avatarSubmissionIdPipe` |
| T011 | §7.2 (error envelope) | — | `AdminAvatarReviewHttpExceptionFilter` |
| T012 | Q-AR-01 | AC-011, AC-013 | Test `RolesGuard` |
| T013 | FR-010, NFR-006 | — | Test signed token |
| T014 | FR-010 | — | Test `secureDownload` route |
| T015 | §7.2 | — | Test exception filter |
| T016 | FR-036–039 | AC-008, AC-009, AC-010 | `ListAvatarSubmissionsQueryDto` |
| T017 | FR-008 | AC-001 | `AvatarSubmissionListItemDto` |
| T018 | FR-009, Q-SB-02 | — | `AvatarSubmissionDetailDto` |
| T019 | FR-008, FR-036–039 | AC-001, AC-008, AC-009, AC-010, AC-DEPTID-EMPTY, AC-SEARCH-ILIKE | `listAvatarSubmissions` |
| T020 | FR-009, FR-018, FR-023 | AC-007, AC-PRIMARY-NULL-DOWNLOAD (detail) | `getAvatarSubmissionDetail` |
| T021–T022 | FR-001, FR-025, FR-026 | AC-011, AC-012, AC-013 | `AdminAvatarReviewController` (list/detail) + wiring |
| T023–T025 | FR-008, FR-009 | AC-001, AC-007, AC-008, AC-009, AC-010, AC-011, AC-012, AC-013, AC-DEPTID-EMPTY, AC-SEARCH-ILIKE | Test US1 |
| T026 | FR-010 | AC-004 | `AvatarDownloadUrlResponseDto` |
| T027 | FR-010, FR-024, FR-029 | AC-004, AC-018, AC-PRIMARY-NULL-DOWNLOAD | `getAvatarDownloadUrl` |
| T028 | FR-002 | AC-AUTH-ORDER-NO-PERM | Route `download-url` |
| T029–T030 | FR-010, FR-029 | AC-004, AC-018, AC-PRIMARY-NULL-DOWNLOAD, AC-AUTH-ORDER-NO-PERM | Test US2 |
| T031 | FR-011 | AC-002 | `ApproveAvatarSubmissionResponseDto` |
| T032 | FR-007, FR-011, FR-027, FR-035, BR-AVATAR-URL | AC-002, AC-002b, AC-006, AC-007, AC-016, AC-PRIMARY-NULL-APPROVE, AC-LOCK-TIMEOUT | `approveAvatarSubmission` |
| T033 | FR-011 | AC-002 | Route `approve` |
| T034–T035 | FR-007, FR-011, FR-027, FR-035 | AC-002, AC-002b, AC-006, AC-007, AC-016, AC-PRIMARY-NULL-APPROVE, AC-LOCK-TIMEOUT | Test US3 |
| T036 | FR-020, FR-021, Q-VL-01 | AC-005 | `RejectAvatarSubmissionDto` |
| T037 | FR-012 | AC-003 | `RejectAvatarSubmissionResponseDto` |
| T038 | FR-012, FR-028, FR-032, FR-034 | AC-003, AC-005, AC-007, AC-014, AC-015, AC-017, AC-LOCK-TIMEOUT | `rejectAvatarSubmission` |
| T039 | FR-012 | AC-003 | Route `reject` |
| T040–T041 | FR-012, FR-020, FR-021, FR-028, FR-032, FR-034 | AC-003, AC-005, AC-007, AC-014, AC-015, AC-017, AC-LOCK-TIMEOUT | Test US4 |
| T042–T043 | — | Toàn bộ AC | Lint/regression |
| T044 | Q-EC-02 | AC-CONCURRENT-001 | Test concurrency approve vs reject |
| T045 | — | — | Migration idempotency check |
| T046 | — | Toàn bộ AC | Traceability review |
| T047 | FR-010 | — | Env var doc check |

---

## Checklist tự kiểm tra trước khi bắt đầu implementation

- [x] Đã đọc `AGENTS.md` trước khi viết tasks.md (RULE TỐI THƯỢNG 1).
- [x] Bám sát `spec.md` + `plan.md`, không tự mở rộng scope (không có task ngoài 5 endpoint + hạ tầng tối thiểu bắt buộc theo plan.md).
- [x] Không có task nào thuộc Out of Scope của spec.md §9 (user upload avatar, face recognition thật, email notification, BUSINESS_ADMIN/MANAGER approve, batch approve/reject, bảng mới, WebSocket mới, signed `imageUrl` trong detail...).
- [x] Mỗi task có outcome cụ thể, file path rõ ràng.
- [x] Dependency giữa task được nêu rõ (mục Dependencies & Execution Order + ghi chú phụ thuộc chéo file dùng chung).
- [x] `[P]` chỉ gắn cho task khác file/không chờ kết quả nhau trực tiếp.
- [x] Cover đủ: database (T002–T004), DTO (T016–T018, T026, T031, T036–T037), validation (T016, T036, lồng trong T019/T038), authorization (T005–T007, T021, T028, T033, T039, migration T002), service logic (T019, T020, T027, T032, T038), API/controller (T021, T028, T033, T039), error handling (T010, T011, lồng trong T019–T038), integration (T008–T009 cross-module signed URL), test (T012–T015, T023–T025, T029–T030, T034–T035, T040–T041, T044), documentation (T001, T047).
- [x] Có bảng Requirements Coverage map Task ↔ FR/BR ↔ AC, cover đủ toàn bộ AC từ AC-001 đến AC-LOCK-TIMEOUT.
- [x] CHANGELOG đã ghi ở đầu file theo RULE TỐI THƯỢNG 2.
