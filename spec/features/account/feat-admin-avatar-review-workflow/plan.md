# Implementation Plan: Admin Avatar Review Workflow (ACCT-AVATAR-REVIEW-001)

**Feature Directory**: spec/features/account/feat-admin-avatar-review-workflow
**Date**: 2026-06-24
**Spec**: spec.md (Status: Draft — Clarified)
**Status**: Draft (chờ `$speckit-tasks`)

---

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo plan.md lần đầu cho ACCT-AVATAR-REVIEW-001, dựa trên spec.md (đã chốt 13 clarify Q-BL/Q-AR/Q-VL/Q-DM/Q-EC/Q-AC/Q-SB) và đối chiếu trực tiếp với code thật trong `src/` (entities, guards, services, storage, migrations) | Toàn bộ file |

---

## 1. Feature Summary

Plan này hiện thực hóa 5 endpoint cho System Administrator quản lý avatar review trong module `accounts`, đúng theo `spec.md` (ACCT-AVATAR-REVIEW-001):

| Endpoint | Mục đích |
|---|---|
| `GET /api/v1/admin/avatar-submissions` | List avatar submissions có pagination/filter/sort |
| `GET /api/v1/admin/avatar-submissions/{faceProfileId}` | Chi tiết 1 submission (không có signed imageUrl) |
| `GET /api/v1/admin/avatar-submissions/{faceProfileId}/download-url` | Sinh signed/temporary download URL (TTL 5-15 phút) |
| `POST /api/v1/admin/avatar-submissions/{faceProfileId}/approve` | Approve trong transaction |
| `POST /api/v1/admin/avatar-submissions/{faceProfileId}/reject` | Reject trong transaction + notification |

Toàn bộ dữ liệu dùng lại 5 bảng có sẵn: `face_profiles`, `users`, `media_files`, `notifications`, `audit_logs`. **Không tạo bảng mới** (FR-004).

Sau khi đối chiếu trực tiếp với code hiện tại (không chỉ với spec), plan này phải giải quyết **5 vấn đề kỹ thuật cốt lõi** mà spec.md giả định là có sẵn nhưng thực tế **chưa tồn tại** trong codebase:

1. **Không có cơ chế role-check riêng biệt.** Codebase hiện tại chỉ có `PermissionsGuard` (check permission qua `AuthzReadRepository.getEffectiveRolesAndPermissions`), **không có `RolesGuard`/`@Roles` decorator nào** để check cứng role `SYSTEM_ADMIN` như Q-AR-01 yêu cầu ("Authorization yêu cầu **cả** role `SYSTEM_ADMIN` **và** permission code"). Plan này phải tạo `RolesGuard` mới (mục 6).
2. **Không có cơ chế signed/temporary URL nào trong storage layer.** `StorageService` hiện tại (`src/modules/storage/storage.service.ts`) chỉ có `saveFile`/`deleteFile`/`getFile`/`getPublicUrl` — **không có TTL, không có signature, không có Cloudinary/S3**. FR-010/NFR-006 yêu cầu signed URL TTL 5-15 phút — đây là capability hoàn toàn mới phải xây (mục 4, 5, 7.3).
3. **`AuditLogsService`/`NotificationsService` hiện tại không phù hợp để dùng trực tiếp trong transaction atomicity mà spec yêu cầu** (FR-027/028, AC-015): `AuditLogsService.write()` có `fail-safe` mode (swallow lỗi, không throw) theo default config — trái với yêu cầu "rollback toàn bộ nếu bất kỳ bước nào thất bại"; `NotificationsService.createNotification()` mặc định set `delivery_status = 'draft'` (không phải `'queued'` như spec mục 13.2 yêu cầu) và dùng repository riêng không gắn với transaction manager. Plan này quyết định ghi trực tiếp qua `manager.getRepository(...)` trong transaction callback, **không gọi qua 2 service đó** cho approve/reject (mục 7.4, 7.5).
4. **Mismatch `module_code`**: spec.md mục 10.3 viết `module_code = 'account'` (số ít) cho 2 permission mới, nhưng `MODULE_CODE_ALLOWLIST` thật trong code (`src/modules/accounts/constants/permission-module-allowlist.constant.ts`) chỉ chấp nhận `'accounts'` (số nhiều), không có `'account'`. Plan quyết định dùng `module_code = 'accounts'` để khớp allowlist hiện có, còn `permission_code` vẫn giữ đúng chữ `account.avatar.review`/`account.avatar.download` như spec (mục 4.3, 6).
5. **Gap nhỏ trong spec.md**: mục 2.3 bước 3 yêu cầu UUID không hợp lệ trả `422 VALIDATION_ERROR`, nhưng mã lỗi `VALIDATION_ERROR` **không xuất hiện** trong bảng Error Codes mục 7.1. NestJS `ParseUUIDPipe` mặc định trả `400`, không phải `422`. Plan dùng `ParseUUIDPipe` với `exceptionFactory` tùy chỉnh để khớp đúng mục 2.3 (mục 8).

Plan này **không** mở rộng phạm vi ngoài spec — cả 5 vấn đề trên là **điều kiện kỹ thuật bắt buộc** để hiện thực đúng FR/NFR/AC đã chốt, không phải tính năng tự thêm.

---

## 2. Technical Context

| Aspect | Detail (đã verify trực tiếp trong code) |
|---|---|
| **Framework** | NestJS (TypeScript), module `accounts` (đã tồn tại) |
| **ORM** | TypeORM Repository/QueryBuilder. `FaceProfileEntity`, `UserEntity`, `DepartmentEntity` đã đăng ký trong `AccountsModule` (`TypeOrmModule.forFeature([...])`, file `src/modules/accounts/accounts.module.ts`). `MediaFileEntity` (module `recording`), `NotificationEntity` (module `notifications`), `AuditLogEntity` (module `administration`) **chưa** đăng ký trong `AccountsModule` — dùng `DataSource.getRepository(Entity)` trực tiếp (không cần `TypeOrmModule.forFeature` cross-module), theo đúng pattern `FaceProfileService` đã làm với `media_files` (`src/modules/accounts/services/face-profile.service.ts:73-87`, dùng `dataSource.manager.query` cho cross-module table) |
| **Database** | PostgreSQL, DB v3.2 Compact — không thêm bảng. 1 migration data-seed (2 permission + role_permissions). Enum thay đổi chỉ ở tầng TypeScript (cột `status`/`notification_type` là `varchar`, không có CHECK constraint ở DB) |
| **`face_profiles.status` hiện tại** | Enum `FaceProfileStatus` tại `src/modules/accounts/entities/face-profile.entity.ts:11-16` chỉ có `ACTIVE`, `PENDING_REVIEW`, `DISABLED`, `REVOKED`. **Chưa có `REJECTED`** — phải thêm (BR theo spec mục 3.1 FR-005) |
| **Storage** | `StorageService` (`src/modules/storage/storage.service.ts`) chỉ hỗ trợ local filesystem: `saveFile`, `deleteFile`, `getFile` (đọc bytes, có chống path-traversal), `getPublicUrl` (build URL permanent, KHÔNG TTL/signature). **Không có Cloudinary/S3, không có signed URL** — đây là gap lớn nhất, xem mục 4.6/5.3/7.3 |
| **Audit** | `AuditLogsService` (`src/modules/administration/services/audit-logs.service.ts`) có `logAction`/`logEntityChange`/`logSecurityEvent`, nhưng **fail-safe by default** (`AUDIT_LOG_FAIL_SAFE=true` → lỗi bị swallow, không throw) — KHÔNG dùng được cho approve/reject (cần atomicity thật). Dùng được cho `avatar.download` (standalone, không cần atomicity với write khác) |
| **Notification** | `NotificationsService.createNotification()` (`src/modules/notifications/notifications.service.ts:69-92`) mặc định `deliveryStatus = DRAFT`, dùng repository riêng (không transaction-aware). Spec mục 13.2 yêu cầu `delivery_status = 'queued'` ngay khi insert, trong cùng transaction reject — phải insert trực tiếp qua `manager`, không qua service này |
| **Auth** | `JwtAuthGuard` (`src/modules/auth/guards/jwt-auth.guard.ts`) + `PermissionsGuard` (`src/modules/auth/guards/permissions.guard.ts`, dùng `AuthzReadRepository.getEffectiveRolesAndPermissions`, đã export sẵn từ `AuthModule`). **Không có `RolesGuard`** — phải tạo mới (mục 6) |
| **Exception envelope** | `QueryFailedFilter` (`src/common/filters/query-failed.filter.ts`, global qua `APP_FILTER` trong `CommonModule`) **chỉ xử lý `QueryFailedError`** (lỗi DB, ví dụ unique violation `23505`). `HttpException` thường (`NotFoundException({code,message})`, v.v.) **không** tự có `timestamp`/`path` theo đúng envelope spec mục 7.2 — cần filter scoped riêng (mục 9) |
| **Pattern controller cần tránh** | `FaceProfileController` (`face-profile.controller.ts:16-24`) và `MediaFilesController` (`media-files.controller.ts:23-31`) dùng `MockPermissionsGuard` (`canActivate() { return true; }`) — tech debt riêng của UC-17/recording. **KHÔNG copy pattern này.** Controller mới phải dùng `JwtAuthGuard`/`PermissionsGuard` thật, đúng pattern `UsersController` (`users.controller.ts:43-46`) |
| **Dependency với feat-user-avatar-submission-reminder** | Feature đó **chưa được code** (chỉ có spec/plan). Tuy nhiên feature này **không bị block**: `FaceProfileService.enrollPortrait()` (UC-17, đã code, `face-profile.service.ts:39-122`) đã tạo được row `face_profiles.status = pending_review` (dù bằng upsert, không phải insert-mới như sibling spec giả định) — đủ để build & test admin review workflow độc lập với sibling feature |
| **Partial unique index `ux_face_profiles_user_pending`** | Spec mục 10.4/5.3 nêu là "đề xuất". Plan **không tạo** migration này — đây là trách nhiệm của `feat-user-avatar-submission-reminder` (đã lên kế hoạch ở plan của feature đó, mục DM-01). Feature review này chỉ UPDATE row đã tồn tại, không INSERT row `pending_review` mới, nên không có rủi ro phụ thuộc index này |
| **Testing** | Jest, theo pattern `*.spec.ts` đã có trong `accounts` (`face-profile.service.spec.ts`, `users.controller.spec.ts`) |

---

## 3. Scope Confirmation

Bám đúng `spec.md` mục 9 (Out of Scope). Không bổ sung gì ngoài danh sách dưới.

### IN SCOPE (bám spec.md §3, §6, §8, §13)

- 5 endpoint mục 1 (list/detail/download-url/approve/reject).
- Authorization role `SYSTEM_ADMIN` + permission (`account.avatar.review`, `account.avatar.download`), đúng auth order mục 2.3.
- Validate: pagination (`page`/`limit` max 100), `status` filter (3 giá trị), `sortBy` whitelist 6 field, `sortOrder`, `q` search (min 2/max 100 Unicode, ILIKE parameterized), `departmentId` (UUID), `reason` reject (trim+NFC, max 500 Unicode chars).
- Transaction approve (mục 13.1 spec) + reject (mục 13.2 spec), row locking `FOR UPDATE`.
- Audit log cho `avatar.approve`/`avatar.reject`/`avatar.download` đúng payload mục 5.4 spec.
- Notification `avatar_rejected` trong cùng transaction reject.
- Schema change tối thiểu: thêm `rejected` vào `FaceProfileStatus` enum (TS-only), thêm `avatar_rejected` vào `NotificationType` enum (TS-only), seed 2 permission + role_permissions qua migration.
- Signed/temporary download URL mechanism tối thiểu (capability mới, bắt buộc bởi FR-010/NFR-006 — xem mục 4.6).
- `RolesGuard` mới (bắt buộc bởi Q-AR-01 — xem mục 6).

### OUT OF SCOPE (bám spec.md §9.1/9.2 — liệt kê lại để plan không vô tình lấn vào)

- User upload avatar (thuộc `feat-user-avatar-submission-reminder`).
- Face recognition thật, embedding, Face Server enrollment thật.
- Email notification cho reject (optional/future — MVP chỉ in-app DB record).
- BUSINESS_ADMIN/MANAGER approve/reject avatar.
- Tự động kiểm tra chất lượng ảnh bằng AI/CV.
- Chặn user sử dụng hệ thống khi chưa có avatar approved.
- Batch approve/reject nhiều submission.
- Lưu file binary vào DB.
- WebSocket/realtime event mới cho approve/reject (chỉ tạo notification record trong DB).
- Trả signed `imageUrl` trong GET detail response (chỉ trả metadata; xem ảnh phải gọi `/download-url`).
- Lưu signed URL/temporary URL vào `users.avatar_url` (luôn permanent display URL).
- Tạo migration `ux_face_profiles_user_pending` (thuộc `feat-user-avatar-submission-reminder`, xem mục 2).
- Sửa hành vi nghiệp vụ UC-17 (`FaceProfileService.enrollPortrait`) — plan này chỉ ĐỌC dữ liệu UC-17 tạo ra, không sửa luồng enroll.
- Cloudinary/S3 integration thật — signed URL mục 4.6 chỉ là cơ chế nội bộ (HMAC token) cho local storage, không phải tích hợp cloud provider mới.

---

## 4. Data Model Impact

> Khớp `spec.md` mục 5 và mục 10. Không tạo bảng mới.

### 4.1 Entity tái sử dụng (không đổi DB schema)

| Entity | File | Field dùng trong feature này | Thay đổi |
|---|---|---|---|
| `FaceProfileEntity` | `src/modules/accounts/entities/face-profile.entity.ts` | `id`, `userId`, `status`, `primaryImageFileId`, `metadataJson`, `qualityScore`, `enrolledAt`, `lastUpdatedAt`, `deletedAt` | Thêm `REJECTED = 'rejected'` vào enum `FaceProfileStatus` (dòng 11-16). Cột DB là `varchar(30)` không CHECK constraint → **không cần migration DDL** |
| `UserEntity` | `src/modules/accounts/entities/user.entity.ts` | `id`, `avatarUrl`, `accountStatus`, `deletedAt`, `fullName`, `email`, `employeeCode`, `departmentId` | KHÔNG đổi schema |
| `DepartmentEntity` | `src/modules/accounts/entities/department.entity.ts` | `id`, `departmentName` | KHÔNG đổi schema. Dùng cho filter `departmentId` + sort `departmentName` |
| `MediaFileEntity` | `src/modules/recording/entities/media-file.entity.ts` | `id`, `fileName`, `mimeType`, `storageProvider`, `storageKey`, `fileUrl`, `fileSizeBytes` | KHÔNG đổi schema. `users.avatar_url` lấy từ `fileUrl` khi approve (BR-AVATAR-URL) |
| `NotificationEntity` | `src/modules/notifications/entities/notification.entity.ts` | `notificationType`, `channel`, `subject`, `content`, `relatedEntityType`, `relatedEntityId`, `recipientUserIdsJson` (đã là `string[] \| null`, jsonb array — khớp đúng spec mục 13.2 "Không dùng object format"), `deliveryStatus`, `priority`, `createdBy`, `payloadJson` | Thêm `AVATAR_REJECTED = 'avatar_rejected'` vào enum `NotificationType` (dòng 11-29 hiện tại). Cột `notification_type` là `varchar(60)` → không cần migration DDL |
| `AuditLogEntity` | `src/modules/administration/entities/audit-log.entity.ts` | `userId`, `actionType`, `entityType`, `entityId`, `oldValueJson`, `newValueJson`, `severity`, `metadataJson` | KHÔNG đổi schema. Field TypeScript khớp 100% với payload mẫu spec mục 5.4 |
| `PermissionEntity`, `RoleEntity`, `RolePermissionEntity` | `src/modules/accounts/entities/{permission,role,role-permission}.entity.ts` | — | KHÔNG đổi schema. Thêm 2 row `permissions` + role_permissions qua migration (mục 4.3) |

### 4.2 Enum updates (TypeScript only, không migration DDL)

```ts
// src/modules/accounts/entities/face-profile.entity.ts
export enum FaceProfileStatus {
  ACTIVE = 'active',
  PENDING_REVIEW = 'pending_review',
  DISABLED = 'disabled',
  REVOKED = 'revoked',
  REJECTED = 'rejected', // MỚI — FR-005
}
```

```ts
// src/modules/notifications/entities/notification.entity.ts
export enum NotificationType {
  // ... giữ nguyên các giá trị hiện có ...
  AVATAR_REJECTED = 'avatar_rejected', // MỚI — FR-013
}
```

### 4.3 Migration — Permission seed idempotent (bắt buộc)

**Quyết định vị trí**: đặt trong `src/database/migrations/` (KHÔNG đặt trong `src/database/seeds/`). Lý do đã verify trực tiếp: `package.json` chỉ có `migration:run|revert|show|generate` (chạy qua `npm run typeorm -- migration:run -d src/database/data-source.ts`), **không có script nào gọi `src/database/seeds/`** — đặt seed permission ở đó sẽ không đảm bảo chạy.

**Quyết định `module_code`**: dùng `'accounts'` (khớp `MODULE_CODE_ALLOWLIST` thật trong `permission-module-allowlist.constant.ts:6-30`), **không dùng `'account'`** như bảng ở spec.md mục 10.3 viết — đây là technical correction cần thiết để tránh việc sau này dùng "Update Permission" API (nếu có, validate qua `CreatePermissionDto`/`UpdatePermissionDto` với allowlist) sẽ reject giá trị `'account'`. `permission_code` vẫn giữ đúng nguyên văn `account.avatar.review`/`account.avatar.download` như spec — đây chỉ là 1 chuỗi label, không bị validate theo allowlist (allowlist chỉ áp dụng cho cột `module_code` riêng).

File mới: `src/database/migrations/20260624010000-SeedAdminAvatarReviewPermissions.ts` (timestamp theo đúng convention 2 ví dụ đã có: `1716800000000-CreateIotDevicesTable.ts`, `20260608025416-AddDepartmentUniqueIndexes.ts`):

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedAdminAvatarReviewPermissions20260624010000
  implements MigrationInterface
{
  name = 'SeedAdminAvatarReviewPermissions20260624010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissions = [
      {
        code: 'account.avatar.review',
        name: 'Xem và duyệt/từ chối avatar',
        action: 'review',
      },
      {
        code: 'account.avatar.download',
        name: 'Tải ảnh avatar submission',
        action: 'download',
      },
    ];
    // Q-AR-01: chỉ SYSTEM_ADMIN được seed cho feature này (khác sibling feature
    // seed cho 4 role tự-quản-lý-avatar-của-mình).
    const roles = ['SYSTEM_ADMIN'];

    for (const p of permissions) {
      const inserted: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         VALUES ($1, $2, 'accounts', $3, $2, true)
         ON CONFLICT (permission_code) DO NOTHING
         RETURNING id;`,
        [p.code, p.name, p.action],
      );
      const permissionId =
        inserted[0]?.id ??
        (
          await queryRunner.query(
            `SELECT id FROM permissions WHERE permission_code = $1`,
            [p.code],
          )
        )[0]?.id;
      if (!permissionId) continue;

      for (const roleCode of roles) {
        await queryRunner.query(
          `INSERT INTO role_permissions (role_id, permission_id, granted_at)
           SELECT r.id, $2, NOW() FROM roles r WHERE r.role_code = $1 AND r.is_active = true
           ON CONFLICT (role_id, permission_id) DO NOTHING;`,
          [roleCode, permissionId],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM role_permissions WHERE permission_id IN (
         SELECT id FROM permissions WHERE permission_code IN ('account.avatar.review','account.avatar.download')
       );`,
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code IN ('account.avatar.review','account.avatar.download');`,
    );
  }
}
```

> Ghi chú idempotency (giống pattern đã verify ở sibling plan): `ON CONFLICT DO NOTHING RETURNING id` không trả row khi đã tồn tại — fallback `SELECT` đảm bảo `permissionId` luôn lấy được khi migration chạy lại.

### 4.4 Migration KHÔNG tạo trong plan này

`ux_face_profiles_user_pending` — xem mục 2 (Technical Context) và mục 3 (Out of Scope). Đây là ranh giới rõ giữa 2 feature cùng chạm `face_profiles`.

### 4.5 Read/Write footprint theo từng operation

| Operation | Bảng đọc | Bảng ghi | Transaction? |
|---|---|---|---|
| List | `face_profiles`, `users`, `departments` (JOIN, SELECT only) | — | Không |
| Detail | `face_profiles`, `users`, `media_files` (SELECT only) | — | Không |
| Download URL | `face_profiles`, `media_files` (SELECT) | `audit_logs` (INSERT, qua `AuditLogsService`) | Không (single write, không cần atomicity với write khác) |
| Approve | `face_profiles` (SELECT FOR UPDATE x2: pending + old active), `users` (SELECT FOR UPDATE), `media_files` (SELECT) | `face_profiles` (UPDATE x1-2), `users` (UPDATE), `audit_logs` (INSERT qua `manager`) | **Có** — `dataSource.transaction()` |
| Reject | `face_profiles` (SELECT FOR UPDATE), `users` (SELECT FOR UPDATE) | `face_profiles` (UPDATE), `audit_logs` (INSERT qua `manager`), `notifications` (INSERT qua `manager`) | **Có** — `dataSource.transaction()` |

### 4.6 Capability mới: Signed Download URL (bắt buộc bởi FR-010/NFR-006)

**Vấn đề**: `StorageService` hiện tại không có cơ chế tạo URL có TTL/signature. `getPublicUrl()` chỉ build 1 URL permanent không xác thực — dùng cho download-url sẽ vi phạm NFR-006 ("signed URL có TTL 5-15 phút") và để lộ ảnh face profile (dữ liệu nhạy cảm theo AGENTS.md §20.2) qua URL không hết hạn.

**Quyết định thiết kế** (tối thiểu, không thêm dependency ngoài, không tích hợp Cloudinary/S3 thật — đúng nguyên tắc "không tự ý thêm framework/infra mới"):

1. Thêm 2 method vào `StorageService` (file đã có, chỉ bổ sung — không sửa method cũ):
   - `generateSignedDownloadToken(mediaFileId: string, ttlSeconds: number): { token: string; expiresAt: Date }` — ký HMAC-SHA256 bằng `crypto` built-in của Node (không cần npm package mới), payload `${mediaFileId}|${expiresAtEpochMs}`, secret từ env `MEDIA_DOWNLOAD_TOKEN_SECRET`.
   - `verifySignedDownloadToken(token: string): { mediaFileId: string } | null` — verify signature bằng `timingSafeEqual`, check hết hạn.
2. Thêm 1 endpoint mới **trong module `recording` đã có** (không tạo module mới, đúng module boundary AGENTS.md §11.8 — `recording` đã sở hữu `media_files` HTTP surface): `GET /api/v1/media-files/:fileId/secure-download?token=...` trong `MediaFilesController` (`src/modules/recording/controllers/media-files.controller.ts`), tái dùng `MediaFilesService.resolvePlayback(fileId)` đã có sẵn (trả `{path, mimeType, size}`, dùng trong method `playback` hiện tại dòng 79).
3. Endpoint này **không dùng `JwtAuthGuard`** (giống tinh thần system-to-system endpoint AGENTS.md §11.4) — xác thực bằng chính token đã ký, không phải JWT user. Token tự chứa `mediaFileId` + hạn dùng, validate khớp với `:fileId` path param trước khi stream.

Chi tiết code xem mục 5.3 và 7.3. Env var mới (Phase 1, `.env.example`):

```env
MEDIA_DOWNLOAD_TOKEN_SECRET=change_me
MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS=600
API_PUBLIC_BASE_URL=http://localhost:3000
```

`API_PUBLIC_BASE_URL` dùng để build URL tuyệt đối trả về trong `downloadUrl` (kết hợp `API_PREFIX=/api/v1` đã có sẵn theo AGENTS.md §21).

---

## 5. API / Contract Plan

| Method | Path | Role | Permission | Controller method |
|---|---|---|---|---|
| GET | `/api/v1/admin/avatar-submissions` | `SYSTEM_ADMIN` | `account.avatar.review` | `AdminAvatarReviewController.list` |
| GET | `/api/v1/admin/avatar-submissions/:faceProfileId` | `SYSTEM_ADMIN` | `account.avatar.review` | `AdminAvatarReviewController.detail` |
| GET | `/api/v1/admin/avatar-submissions/:faceProfileId/download-url` | `SYSTEM_ADMIN` | `account.avatar.download` | `AdminAvatarReviewController.getDownloadUrl` |
| POST | `/api/v1/admin/avatar-submissions/:faceProfileId/approve` | `SYSTEM_ADMIN` | `account.avatar.review` | `AdminAvatarReviewController.approve` |
| POST | `/api/v1/admin/avatar-submissions/:faceProfileId/reject` | `SYSTEM_ADMIN` | `account.avatar.review` | `AdminAvatarReviewController.reject` |
| GET (mới, module `recording`) | `/api/v1/media-files/:fileId/secure-download` | — (token-based) | — | `MediaFilesController.secureDownload` |

Response shape JSON: xem `spec.md` mục 6 (API Contract Draft) và mục 7 (Error Handling) — plan không lặp lại JSON mẫu, chỉ tham chiếu, ngoại trừ phần mới (5.3 dưới đây) chưa có trong spec.

### 5.1 File mới — module `accounts`

- `src/modules/accounts/controllers/admin-avatar-review.controller.ts` — `AdminAvatarReviewController`, `@Controller('admin/avatar-submissions')`.
- `src/modules/accounts/services/admin-avatar-review.service.ts` — `AdminAvatarReviewService`.
- `src/modules/accounts/dto/list-avatar-submissions-query.dto.ts` — `ListAvatarSubmissionsQueryDto`.
- `src/modules/accounts/dto/reject-avatar-submission.dto.ts` — `RejectAvatarSubmissionDto` (field `reason`).
- `src/modules/accounts/dto/avatar-submission-list-item.dto.ts`, `avatar-submission-detail.dto.ts`, `avatar-download-url-response.dto.ts` — response DTO, đúng shape spec mục 6.1/6.2/6.3.
- `src/modules/accounts/pipes/avatar-submission-id.pipe.ts` — factory tạo `ParseUUIDPipe` với `exceptionFactory` tùy chỉnh (mục 8).
- `src/modules/accounts/filters/admin-avatar-review-http-exception.filter.ts` — scoped exception filter (mục 9).

### 5.2 File sửa — module `accounts`

- `src/modules/accounts/accounts.module.ts` — đăng ký controller/service/pipe mới vào `controllers`/`providers`.
- `src/modules/accounts/entities/face-profile.entity.ts` — thêm `REJECTED` (mục 4.2).

### 5.3 File sửa — module `notifications`, `auth`, `storage`, `recording`

- `src/modules/notifications/entities/notification.entity.ts` — thêm `AVATAR_REJECTED` (mục 4.2).
- `src/modules/auth/auth.module.ts` — đăng ký + export `RolesGuard` mới (mục 6).
- `src/modules/storage/storage.service.ts` — thêm `generateSignedDownloadToken`/`verifySignedDownloadToken` (mục 4.6, 7.3).
- `src/modules/recording/controllers/media-files.controller.ts` — thêm route `secureDownload` (mục 4.6, 7.3).
- `src/modules/recording/services/media-files.service.ts` — tái dùng `resolvePlayback` đã có, không cần method mới nếu shape `{path, mimeType, size}` đủ dùng cho streaming download.

---

## 6. Authorization Plan

### 6.1 `RolesGuard` mới (bắt buộc bởi Q-AR-01)

Codebase hiện tại **không có** cơ chế check role riêng — `PermissionsGuard` chỉ check `permissions`, dù `AuthzReadRepository.getEffectiveRolesAndPermissions()` (`src/modules/auth/repositories/authz-read.repository.ts`) đã trả về cả `roles` (dòng 15, 32-37) nhưng chưa guard nào dùng tới field đó.

File mới: `src/modules/auth/decorators/require-roles.decorator.ts`

```ts
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'requireRoles';
export const RequireRoles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

File mới: `src/modules/auth/guards/roles.guard.ts` (mirror đúng style `PermissionsGuard` — cùng error envelope, cùng cách lấy `request['user']`):

```ts
import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthzReadRepository } from '../repositories/authz-read.repository.js';
import { ROLES_KEY } from '../decorators/require-roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authzRepo: AuthzReadRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request['user'] as { userId?: string } | undefined;
    if (!user?.userId) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền thực hiện hành động này.',
        error: { code: 'FORBIDDEN', details: {} },
      });
    }

    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(user.userId);
    const hasRole = requiredRoles.some((r) => roles.includes(r));
    if (!hasRole) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không có quyền thực hiện hành động này.',
        error: { code: 'FORBIDDEN', details: {} },
      });
    }
    return true;
  }
}
```

Đăng ký vào `AuthModule` (`auth.module.ts`): thêm `RolesGuard` vào `providers` và `exports` (cùng vị trí với `JwtAuthGuard`, `PermissionsGuard` — dòng 52-53/80-81 hiện tại), theo đúng pattern đã có.

**Đánh đổi đã biết và chấp nhận**: `RolesGuard` và `PermissionsGuard` mỗi guard tự gọi `getEffectiveRolesAndPermissions()` riêng → 2 query DB/request thay vì 1. Với quy mô "ít nhất 5 System Administrator thao tác đồng thời" (NFR-002), overhead này không đáng kể; không tối ưu sớm (gộp 2 guard thành 1) để giữ guard nhỏ, tái dùng được cho feature khác cần check role tương tự.

### 6.2 Áp dụng trên controller

```ts
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequireRoles('SYSTEM_ADMIN')
@RequirePermissions('account.avatar.review') // hoặc 'account.avatar.download' cho download-url
```

Thứ tự `@UseGuards` quyết định thứ tự chạy guard (NestJS chạy lần lượt). Cả 2 guard role+permission đều chạy **trước** `ParseUUIDPipe`/handler (đúng lifecycle Nest: Guards → Pipes → Handler) — tự động khớp đúng spec mục 2.3 (role+permission check trước UUID validation trước resource lookup) **mà không cần code thêm gì** để enforce thứ tự, chỉ cần đặt đúng guard trước param pipe.

### 6.3 Mapping đầy đủ (đúng spec mục 2.2)

| Endpoint | `@RequireRoles` | `@RequirePermissions` |
|---|---|---|
| `list` | `SYSTEM_ADMIN` | `account.avatar.review` |
| `detail` | `SYSTEM_ADMIN` | `account.avatar.review` |
| `getDownloadUrl` | `SYSTEM_ADMIN` | `account.avatar.download` |
| `approve` | `SYSTEM_ADMIN` | `account.avatar.review` |
| `reject` | `SYSTEM_ADMIN` | `account.avatar.review` |

Permission seed: xem mục 4.3 — chỉ gán cho role `SYSTEM_ADMIN` (khác sibling feature gán cho 4 role tự-quản avatar của mình).

---

## 7. Business Logic Plan

### 7.1 List — `AdminAvatarReviewService.listAvatarSubmissions(query)`

QueryBuilder trên `FaceProfileEntity` (alias `fp`), join sang `UserEntity`/`DepartmentEntity` bằng entity class trực tiếp (không có `@ManyToOne` relation sẵn giữa `FaceProfileEntity`↔`UserEntity` — `userId` chỉ là cột uuid thuần, không phải relation — nên dùng `.innerJoin(UserEntity, 'u', 'u.id = fp.userId')` kiểu join theo điều kiện tường minh, đúng cách TypeORM hỗ trợ join entity không có relation định nghĩa sẵn):

```ts
const qb = this.faceProfileRepo
  .createQueryBuilder('fp')
  .innerJoin(UserEntity, 'u', 'u.id = fp.userId')
  .leftJoin(DepartmentEntity, 'd', 'd.id = u.departmentId')
  .where('fp.deletedAt IS NULL')
  .andWhere('fp.status = :status', { status: query.status ?? 'pending_review' });

if (query.departmentId) qb.andWhere('u.departmentId = :deptId', { deptId: query.departmentId });
if (query.q) {
  qb.andWhere(
    '(u.fullName ILIKE :q OR u.email ILIKE :q OR u.employeeCode ILIKE :q)',
    { q: `%${query.q}%` },
  );
}
```

**sortBy mapping (whitelist server-side, đúng spec mục 6.1)** — KHÔNG cho phép client truyền tên cột trực tiếp vào SQL:

```ts
const SORT_FIELD_MAP: Record<string, string> = {
  submittedAt: 'fp.enrolledAt',
  userFullName: 'u.fullName',
  employeeCode: 'u.employeeCode',
  departmentName: 'd.departmentName',
  status: 'fp.status',
  qualityScore: 'fp.qualityScore',
};
const column = SORT_FIELD_MAP[query.sortBy ?? 'submittedAt'];
const order = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
qb.orderBy(column, order, query.sortBy === 'qualityScore' ? 'NULLS LAST' : undefined);
```

Pagination: `qb.skip((page - 1) * limit).take(limit)`, `getManyAndCount()` (hoặc `.select([...])` rút gọn field cần — tránh `SELECT *` không cần thiết qua nhiều bảng).

> Cú pháp join/orderBy chính xác (alias property path TypeORM dịch sang snake_case cột DB) cần verify khi code thật — đây là thiết kế đúng hướng, không phải code production-ready.

### 7.2 Detail — `getAvatarSubmissionDetail(faceProfileId)`

1. `findOne` `face_profiles` theo id + `deletedAt IS NULL` → 404 `AVATAR_SUBMISSION_NOT_FOUND` nếu không có (FR-018).
2. Join `users` lấy `fullName`/`email`.
3. Nếu `primaryImageFileId` không null: lấy `media_files` (`fileName`, `mimeType`, `fileSizeBytes`, `storageProvider`) — nếu `primaryImageFileId` null hoặc `media_files` không tồn tại → field `imageFile` trả `null`/`hasPreview=false` (không throw lỗi ở GET detail trừ khi spec yêu cầu khác; theo spec FR-023 lỗi `AVATAR_MEDIA_NOT_FOUND` áp dụng khi GET detail **và cần file** — đối chiếu AC-PRIMARY-NULL-DOWNLOAD chỉ test cho `/download-url`, không có AC riêng cho GET detail khi `primaryImageFileId` null. Quyết định: GET detail vẫn trả 200 với `imageFile: null`, vì FR-023 liệt kê "GET /download-url hoặc GET detail" cùng nhóm — **plan chọn áp dụng đồng nhất**: nếu `primaryImageFileId IS NULL` hoặc `media_files` không tồn tại, GET detail cũng trả 404 `AVATAR_MEDIA_NOT_FOUND`, khớp đúng nguyên văn FR-023).
4. **Không** trả `imageUrl`/signed URL (OOS-007, Q-SB-02).
5. `reviewMetadata`: đọc từ `metadata_json.review` nếu có (chỉ có khi `status = rejected`), trả `null` nếu chưa từng reject.

### 7.3 Download URL — `getAvatarDownloadUrl(faceProfileId, adminUserId)`

```ts
async getAvatarDownloadUrl(faceProfileId: string, adminUserId: string) {
  const profile = await this.faceProfileRepo.findOne({ where: { id: faceProfileId, deletedAt: IsNull() } });
  if (!profile) throw new NotFoundException({ code: 'AVATAR_SUBMISSION_NOT_FOUND', message: '...' });
  if (!profile.primaryImageFileId) {
    throw new NotFoundException({ code: 'AVATAR_MEDIA_NOT_FOUND', message: '...' }); // AC-PRIMARY-NULL-DOWNLOAD
  }
  const mediaFile = await this.dataSource.getRepository(MediaFileEntity)
    .findOne({ where: { id: profile.primaryImageFileId } });
  if (!mediaFile) throw new NotFoundException({ code: 'AVATAR_MEDIA_NOT_FOUND', message: '...' });

  let signed: { token: string; expiresAt: Date };
  try {
    signed = this.storageService.generateSignedDownloadToken(mediaFile.id, this.ttlSeconds); // 600s mặc định (trong khoảng 5-15 phút)
  } catch (err) {
    throw new InternalServerErrorException({ code: 'AVATAR_DOWNLOAD_URL_FAILED', message: '...' }); // ERR/FR-024
  }

  const downloadUrl = `${this.apiPublicBaseUrl}/api/v1/media-files/${mediaFile.id}/secure-download?token=${signed.token}`;

  await this.auditLogsService.logAction({
    userId: adminUserId,
    actionType: 'avatar.download',
    entityType: 'face_profile',
    entityId: faceProfileId,
    severity: AuditLogSeverity.INFO,
    metadataJson: { targetUserId: profile.userId, mediaFileId: mediaFile.id, expiresAt: signed.expiresAt.toISOString() },
  });

  return { downloadUrl, expiresAt: signed.expiresAt.toISOString() };
}
```

Dùng `AuditLogsService.logAction()` (shared service, fail-safe OK) vì đây là **write đơn lẻ**, không cần atomicity với write khác (khác approve/reject) — đúng nhận định mục 2.

**`secure-download` endpoint mới (module `recording`)**:

```ts
@Get('media-files/:fileId/secure-download')
async secureDownload(
  @Param('fileId', new ParseUUIDPipe()) fileId: string,
  @Query('token') token: string,
  @Res() res: Response,
) {
  const payload = this.storageService.verifySignedDownloadToken(token);
  if (!payload || payload.mediaFileId !== fileId) {
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Token không hợp lệ hoặc đã hết hạn.' });
  }
  const m = await this.mediaFilesService.resolvePlayback(fileId); // đã có sẵn, trả {path, mimeType, size}
  res.setHeader('Content-Type', m.mimeType);
  res.setHeader('Content-Disposition', 'attachment');
  res.setHeader('Content-Length', String(m.size));
  createReadStream(m.path).pipe(res);
}
```

Không dùng `JwtAuthGuard` — bảo mật dựa trên chữ ký HMAC + TTL của token (giống cơ chế signed URL Cloudinary/S3 thật), nhất quán với spec coi đây là "signed/temporary URL" độc lập với session JWT của admin.

### 7.4 Approve transaction — `approveAvatarSubmission(faceProfileId, adminUserId, requestId)`

Triển khai đúng 8 bước `spec.md` mục 13.1, dùng TypeORM QueryBuilder `.setLock('pessimistic_write')` để dịch ra `SELECT ... FOR UPDATE` (không dùng raw SQL vì `FaceProfileEntity`/`UserEntity` đều nằm trong `AccountsModule`, có Repository sẵn — khác tình huống `FaceProfileService` cũ phải dùng raw SQL cho `media_files` ở module khác):

```ts
async approveAvatarSubmission(faceProfileId: string, adminUserId: string) {
  return this.dataSource.transaction(async (manager) => {
    // Bước 1: lock pending profile — PHẢI lock trước rồi mới check status (tránh race
    // giữa "check" và "lock" — đúng thứ tự spec, không check-rồi-lock).
    const profile = await manager
      .getRepository(FaceProfileEntity)
      .createQueryBuilder('fp')
      .setLock('pessimistic_write')
      .where('fp.id = :id', { id: faceProfileId })
      .andWhere('fp.deletedAt IS NULL')
      .getOne();
    if (!profile) throw new NotFoundException({ code: 'AVATAR_SUBMISSION_NOT_FOUND', message: '...' });
    // Bước 2
    if (profile.status !== FaceProfileStatus.PENDING_REVIEW) {
      throw new ConflictException({ code: 'AVATAR_SUBMISSION_NOT_PENDING', message: '...' });
    }
    // Bước 3: lock owning user
    const user = await manager
      .getRepository(UserEntity)
      .createQueryBuilder('u')
      .setLock('pessimistic_write')
      .where('u.id = :id', { id: profile.userId })
      .getOne();
    if (!user || user.accountStatus !== AccountStatus.ACTIVE || user.deletedAt) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: '...' });
    }
    // Bước 3b: lấy media file → permanent display URL (BR-AVATAR-URL)
    if (!profile.primaryImageFileId) {
      throw new InternalServerErrorException({ code: 'AVATAR_APPROVE_FAILED', message: '...' }); // AC-PRIMARY-NULL-APPROVE
    }
    const mediaFile = await manager.getRepository(MediaFileEntity).findOne({ where: { id: profile.primaryImageFileId } });
    if (!mediaFile?.fileUrl) {
      throw new InternalServerErrorException({ code: 'AVATAR_APPROVE_FAILED', message: '...' });
    }
    // Bước 4: revoke old active (nếu có)
    const oldActive = await manager.getRepository(FaceProfileEntity).findOne({
      where: { userId: profile.userId, status: FaceProfileStatus.ACTIVE, deletedAt: IsNull() },
    });
    if (oldActive) {
      await manager.getRepository(FaceProfileEntity).update(oldActive.id, {
        status: FaceProfileStatus.REVOKED,
        lastUpdatedAt: new Date(),
      });
    }
    // Bước 5
    await manager.getRepository(FaceProfileEntity).update(faceProfileId, {
      status: FaceProfileStatus.ACTIVE,
      lastUpdatedAt: new Date(),
    });
    // Bước 6: BR-AVATAR-URL — permanent display URL, KHÔNG signed URL
    await manager.getRepository(UserEntity).update(user.id, { avatarUrl: mediaFile.fileUrl });
    // Bước 7: audit log GHI TRỰC TIẾP qua manager (không qua AuditLogsService —
    // lý do atomicity, xem mục 2 Technical Context điểm 3)
    await manager.getRepository(AuditLogEntity).insert({
      userId: adminUserId,
      actionType: 'avatar.approve',
      entityType: 'face_profile',
      entityId: faceProfileId,
      oldValueJson: { status: 'pending_review' },
      newValueJson: { status: 'active', avatarUrlUpdated: true },
      severity: AuditLogSeverity.INFO,
      metadataJson: {
        targetUserId: user.id,
        oldActiveFaceProfileId: oldActive?.id ?? null,
        mediaFileId: mediaFile.id,
        requestId: this.currentRequestId,
      },
    });
    return { faceProfileId, userId: user.id, status: 'active', approvedAt: new Date().toISOString() };
  });
}
```

Lỗi unique violation/lock timeout trong transaction → catch ở ngoài, map theo mục 9 (KHÔNG để lộ lỗi DB thô).

### 7.5 Reject transaction — `rejectAvatarSubmission(faceProfileId, reason, adminUserId)`

Cùng cấu trúc lock pending+user (bước 1-3 giống 7.4), khác từ bước 4:

```ts
    // Validate + normalize reason TRƯỚC khi mở transaction (đã làm ở Validation layer,
    // xem mục 8) — trong transaction chỉ còn build JSON.
    const reviewJson = {
      review: {
        rejectionReason: normalizedReason, // đã trim + NFC + check <=500 chars ở DTO/service layer
        reviewedBy: adminUserId,
        reviewedAt: new Date().toISOString(),
      },
    };
    await manager.getRepository(FaceProfileEntity).update(faceProfileId, {
      status: FaceProfileStatus.REJECTED,
      metadataJson: { ...(profile.metadataJson ?? {}), ...reviewJson }, // Q-DM-01: không history array
      lastUpdatedAt: new Date(),
    });

    await manager.getRepository(AuditLogEntity).insert({
      userId: adminUserId,
      actionType: 'avatar.reject',
      entityType: 'face_profile',
      entityId: faceProfileId,
      oldValueJson: { status: 'pending_review' },
      newValueJson: { status: 'rejected' },
      severity: AuditLogSeverity.INFO,
      metadataJson: { targetUserId: profile.userId, reason: normalizedReason, notificationCreated: true },
    });

    // INSERT notifications TRỰC TIẾP qua manager — KHÔNG qua NotificationsService.createNotification()
    // vì service đó mặc định deliveryStatus=DRAFT (spec mục 13.2 yêu cầu 'queued' ngay) và dùng
    // repository riêng không gắn transaction hiện tại (lý do mục 2 Technical Context điểm 3).
    await manager.getRepository(NotificationEntity).insert({
      notificationType: NotificationType.AVATAR_REJECTED,
      channel: NotificationChannel.IN_APP,
      subject: 'Ảnh đại diện không được chấp nhận',
      content: `Ảnh của bạn không được chấp nhận. Lý do: ${normalizedReason}`,
      relatedEntityType: 'face_profile',
      relatedEntityId: faceProfileId,
      recipientUserIdsJson: [profile.userId], // jsonb array — Q-DM-02, KHÔNG dùng object format
      deliveryStatus: NotificationDeliveryStatus.QUEUED,
      priority: NotificationPriority.NORMAL,
      createdBy: adminUserId,
    });

    return { faceProfileId, userId: profile.userId, status: 'rejected', rejectedAt: new Date().toISOString() };
```

Nếu `INSERT notifications` throw (DB lỗi) → `dataSource.transaction()` tự rollback toàn bộ (kể cả UPDATE `face_profiles` và INSERT `audit_logs` ở trên) vì cùng 1 transaction callback — đúng yêu cầu FR-028/AC-015 "rollback toàn bộ".

### 7.6 Concurrency (EC, AC-CONCURRENT-001, AC-LOCK-TIMEOUT)

- `SELECT ... FOR UPDATE` (bước 1) chặn transaction thứ 2 cho đến khi transaction thứ 1 commit/rollback — **đây là lý do bắt buộc phải lock TRƯỚC rồi mới đọc `status` để check** (không đọc-rồi-lock), nếu không sẽ có khoảng hở race condition giữa lúc đọc và lúc lock.
- Sau khi transaction 1 commit, transaction 2 (đang chờ lock) được tiếp tục, đọc lại `status` mới nhất (đã là `active`/`rejected`) → check ở bước 2 fail → throw 409 — đúng AC-CONCURRENT-001 ("Admin B nhận 409 AVATAR_SUBMISSION_NOT_PENDING").
- Lock timeout/infrastructure error (Postgres lock_timeout hoặc connection error) → catch ở service layer ngoài transaction callback, map thành 500 `AVATAR_APPROVE_FAILED`/`AVATAR_REJECT_FAILED`, **không** map thành 409 (đúng AC-LOCK-TIMEOUT).

---

## 8. Validation Plan

| Validation | Layer | Code | HTTP | Ghi chú |
|---|---|---|---|---|
| JWT hợp lệ | `JwtAuthGuard` | `UNAUTHORIZED` | 401 | FR-026 |
| Role `SYSTEM_ADMIN` + Permission | `RolesGuard` + `PermissionsGuard` | `FORBIDDEN` | 403 | FR-025, Q-AR-01, chạy trước UUID pipe (mục 6.2) |
| `faceProfileId` là UUID hợp lệ | Controller param pipe | `VALIDATION_ERROR` | 422 | Spec §2.3 bước 3. **Không dùng `ParseUUIDPipe` mặc định** (trả 400) — dùng `exceptionFactory` tùy chỉnh (xem dưới) |
| `faceProfileId` tồn tại | Service | `AVATAR_SUBMISSION_NOT_FOUND` | 404 | FR-018, AC-007 |
| `status` (query filter) | DTO (`@IsIn`) | `INVALID_AVATAR_SUBMISSION_STATUS` | 422 | FR-038, chỉ nhận `pending_review`/`rejected`/`active` |
| `sortBy` | DTO (`@IsIn` whitelist 6 field) | `INVALID_SORT_BY` | 422 | FR-036 |
| `sortOrder` | DTO (`@IsIn(['asc','desc'])`) | `INVALID_SORT_ORDER` | 422 | FR-037 |
| `limit` <= 100 | DTO (`@Max(100)`) | `INVALID_PAGINATION_LIMIT` | 422 | FR-039, default 20 |
| `q` (search) | DTO (`@MinLength(2) @MaxLength(100)`, trim trước validate) | `INVALID_SEARCH_QUERY` | 422 | Mục 6.1 spec — empty string bỏ qua search (không lỗi) |
| `departmentId` | DTO (`@IsUUID()`) | `INVALID_DEPARTMENT_ID` | 422 | Mục 6.1 spec — UUID hợp lệ nhưng dept không tồn tại → 200 `data=[]` (AC-DEPTID-EMPTY), KHÔNG lỗi |
| `reason` (reject) | DTO custom validator: trim + `normalize('NFC')` (built-in `String.prototype.normalize`, không cần thư viện ngoài) trước khi check rỗng/length | `AVATAR_REJECTION_REASON_REQUIRED` (422) / `AVATAR_REJECTION_REASON_TOO_LONG` (422) | 422 | FR-020/021, Q-VL-01. Đếm theo Unicode code point (`Array.from(str).length`), không phải UTF-16 code unit (`str.length`) — quan trọng với ký tự có dấu tiếng Việt tổ hợp |
| Submission đang `pending_review`/lifecycle state | Service (trong transaction) | `AVATAR_SUBMISSION_NOT_PENDING` | 409 | FR-019, FR-014..017 |
| User sở hữu hợp lệ | Service (trong transaction) | `USER_NOT_FOUND` | 404 | FR-022 |
| `primary_image_file_id` tồn tại | Service | `AVATAR_MEDIA_NOT_FOUND` (404, GET) / `AVATAR_APPROVE_FAILED` (500, POST approve) | 404/500 | FR-023 |

**`ParseUUIDPipe` với `exceptionFactory` đúng spec §2.3** (dùng lại cho cả 4 endpoint có `:faceProfileId`):

```ts
// src/modules/accounts/pipes/avatar-submission-id.pipe.ts
import { ParseUUIDPipe, UnprocessableEntityException } from '@nestjs/common';

export function avatarSubmissionIdPipe(): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () =>
      new UnprocessableEntityException({
        success: false,
        message: 'faceProfileId không hợp lệ.',
        error: { code: 'VALIDATION_ERROR', details: {} },
      }),
  });
}
```

> Ghi chú: `VALIDATION_ERROR` không có trong bảng Error Codes §7.1 của spec.md — đây là gap nhỏ giữa §2.3 (mô tả luồng) và §7.1 (bảng tổng hợp). Plan áp dụng theo §2.3 vì đó là phần mô tả hành vi chi tiết hơn cho đúng yêu cầu "UUID validation => 422". Cần xác nhận lại với team khi viết spec lần sau (ghi vào Risk mục 12).

**Thứ tự kiểm tra tổng thể** (đúng §2.3 + áp dụng nhất quán cho POST reject): Auth → Role+Permission (guard) → UUID format (pipe) → DTO validation khác (body) → Resource lookup (service) → Business state check (service, trong transaction).

---

## 9. Error Handling Plan

### 9.1 Mapping exception → HTTP (đúng `spec.md` mục 7.1)

| Tình huống | Exception NestJS | Code | HTTP |
|---|---|---|---|
| Thiếu/sai JWT | (mặc định `JwtAuthGuard`) | `UNAUTHORIZED` | 401 |
| Thiếu role/permission | (mặc định `RolesGuard`/`PermissionsGuard`, đã đúng envelope sẵn) | `FORBIDDEN` | 403 |
| UUID sai format | `UnprocessableEntityException` (custom pipe mục 8) | `VALIDATION_ERROR` | 422 |
| Không tìm thấy submission | `NotFoundException({code,message})` | `AVATAR_SUBMISSION_NOT_FOUND` | 404 |
| User sở hữu không hợp lệ | `NotFoundException({code,message})` | `USER_NOT_FOUND` | 404 |
| File ảnh gốc không tồn tại | `NotFoundException({code,message})` | `AVATAR_MEDIA_NOT_FOUND` | 404 |
| Submission không ở `pending_review` | `ConflictException({code,message})` | `AVATAR_SUBMISSION_NOT_PENDING` | 409 |
| Thiếu/sai `reason` | `UnprocessableEntityException({code,message})` | `AVATAR_REJECTION_REASON_REQUIRED`/`_TOO_LONG` | 422 |
| `sortBy`/`sortOrder`/`status`/`q`/`departmentId`/`limit` sai | `UnprocessableEntityException({code,message})` (qua `ValidationPipe` + custom message map, hoặc check tay trong DTO) | tương ứng | 422 |
| Storage lỗi khi sinh signed URL | `InternalServerErrorException({code,message})` | `AVATAR_DOWNLOAD_URL_FAILED` | 500 |
| Lỗi không xác định khi approve (data integrity: `primary_image_file_id` null, lock timeout) | `InternalServerErrorException({code,message})` | `AVATAR_APPROVE_FAILED` | 500 |
| Lỗi không xác định khi reject (kể cả notification insert fail, lock timeout) | `InternalServerErrorException({code,message})` | `AVATAR_REJECT_FAILED` | 500 |

### 9.2 Scoped exception filter cho đúng envelope `spec.md` §7.2

Lý do (đã verify mục 2): `QueryFailedFilter` toàn cục chỉ xử lý `QueryFailedError`; `HttpException` thường không tự có `timestamp`/`path`.

File mới: `src/modules/accounts/filters/admin-avatar-review-http-exception.filter.ts`

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch(HttpException)
export class AdminAvatarReviewHttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const body = exception.getResponse() as { code?: string; message?: string };

    response.status(status).json({
      success: false,
      message: body?.message ?? exception.message,
      error: { code: body?.code ?? 'INTERNAL_ERROR', details: {} },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

Áp dụng: `@UseFilters(AdminAvatarReviewHttpExceptionFilter)` trên `AdminAvatarReviewController` — scoped, không sửa `CommonModule`/`QueryFailedFilter` toàn cục, không ảnh hưởng controller khác (đúng nguyên tắc không tự ý mở rộng scope hạ tầng chung).

### 9.3 Unique violation / lock timeout trong transaction approve/reject

```ts
try {
  return await this.dataSource.transaction(async (manager) => { /* ... mục 7.4/7.5 ... */ });
} catch (err) {
  if (err instanceof NotFoundException || err instanceof ConflictException) throw err; // đã map đúng ở trong transaction
  this.logger.error(`Approve/Reject avatar failed: ${err instanceof Error ? err.message : err}`);
  throw new InternalServerErrorException({ code: 'AVATAR_APPROVE_FAILED' /* hoặc REJECT */, message: 'Có lỗi xảy ra, vui lòng thử lại.' });
}
```

Không để lộ message lỗi DB thô ra client (đúng AGENTS.md §20.1 "không expose stack trace").

---

## 10. Testing Strategy

### 10.1 Unit test — `AdminAvatarReviewService`

File: `src/modules/accounts/services/admin-avatar-review.service.spec.ts` (mock `DataSource`/Repository/`StorageService`/`AuditLogsService`, theo style `face-profile.service.spec.ts`).

- List: trả đúng `meta` pagination, áp dụng đúng `SORT_FIELD_MAP`, không cho `sortBy` ngoài whitelist lọt qua tầng service (AC-008).
- List: filter `departmentId` hợp lệ nhưng không có data → `data=[]`, KHÔNG lỗi (AC-DEPTID-EMPTY).
- List: `q` ILIKE match `full_name`/`email`/`employee_code` (AC-SEARCH-ILIKE).
- Detail: `primaryImageFileId` null → 404 `AVATAR_MEDIA_NOT_FOUND` (theo quyết định mục 7.2).
- Detail: response không có field `imageUrl` (OOS-007).
- Download URL: gọi đúng `storageService.generateSignedDownloadToken` với `mediaFile.id`; ghi audit `avatar.download`; `primaryImageFileId` null → 404 `AVATAR_MEDIA_NOT_FOUND` (AC-PRIMARY-NULL-DOWNLOAD); storage throw → 500 `AVATAR_DOWNLOAD_URL_FAILED`.
- Approve happy path không có old active (AC-002): đúng thứ tự UPDATE, `users.avatar_url` = `mediaFile.fileUrl`, audit `avatar.approve` với `oldActiveFaceProfileId: null`.
- Approve happy path có old active (AC-002b): old active → `revoked` cùng transaction, audit có `oldActiveFaceProfileId` đúng id.
- Approve khi `primary_image_file_id` null → 500 `AVATAR_APPROVE_FAILED` (AC-PRIMARY-NULL-APPROVE), KHÔNG update gì.
- Approve khi status != pending_review → 409 `AVATAR_SUBMISSION_NOT_PENDING`, KHÔNG gọi update nào (AC-006).
- Approve khi user not found/inactive/deleted → 404 `USER_NOT_FOUND`.
- Reject happy path (AC-003): `metadata_json.review` đúng format (không history array — Q-DM-01), notification insert với `recipientUserIdsJson = [userId]` (array, không object — Q-DM-02), `deliveryStatus = QUEUED`, `users.avatar_url` KHÔNG đổi.
- Reject: reason rỗng/chỉ whitespace sau trim → 422 `AVATAR_REJECTION_REASON_REQUIRED` (AC-005).
- Reject: reason > 500 Unicode chars (test với ký tự có dấu tổ hợp, không chỉ ASCII) → 422 `AVATAR_REJECTION_REASON_TOO_LONG`.
- Reject: giả lập notification insert throw trong transaction → toàn bộ rollback, `face_profiles.status` không đổi, 500 `AVATAR_REJECT_FAILED` (AC-015).
- Concurrent: giả lập transaction 2 đọc lại status sau khi transaction 1 commit → 409, không tạo audit/notification trùng (AC-CONCURRENT-001).
- Lock timeout: giả lập lỗi infra trong transaction → 500, KHÔNG map thành 409 (AC-LOCK-TIMEOUT).

### 10.2 Unit test — `AdminAvatarReviewController`

File: `src/modules/accounts/controllers/admin-avatar-review.controller.spec.ts`

- Mỗi route gọi đúng service method với đúng tham số (`faceProfileId` từ pipe, `adminUserId` từ `@CurrentUser()`).
- Verify metadata `@RequireRoles`/`@RequirePermissions` gắn đúng cho từng route (qua `Reflector` trong test, theo pattern guard test hiện có nếu repo có ví dụ).
- UUID sai format → pipe throw `UnprocessableEntityException` với `code=VALIDATION_ERROR` (test trực tiếp pipe, không cần spin lên HTTP layer).

### 10.3 Unit test — `RolesGuard` (mới, infra dùng chung)

File: `src/modules/auth/guards/roles.guard.spec.ts`

- Không có `@RequireRoles` metadata → cho qua (return true).
- User không có role yêu cầu → `ForbiddenException` đúng envelope.
- User có role yêu cầu (trong số nhiều role) → pass.
- Test regression: `PermissionsGuard` hiện tại không bị ảnh hưởng (không sửa file đó).

### 10.4 Unit test — `StorageService` (bổ sung 2 method mới)

File: `src/modules/storage/storage.service.spec.ts` (file mới nếu chưa có, hoặc bổ sung nếu đã có)

- `generateSignedDownloadToken` + `verifySignedDownloadToken`: round-trip thành công trong TTL.
- Token hết hạn → `verifySignedDownloadToken` trả `null`.
- Token bị sửa (tamper 1 ký tự) → trả `null` (constant-time compare qua `timingSafeEqual`, không throw lỗi lộ thông tin timing).
- Thiếu `MEDIA_DOWNLOAD_TOKEN_SECRET` → `generateSignedDownloadToken` throw rõ ràng (map thành 500 ở service caller).

### 10.5 Unit test — `MediaFilesController.secureDownload` (module `recording`)

- Token hợp lệ + đúng `fileId` → stream đúng `Content-Type`/`Content-Disposition`.
- Token hợp lệ nhưng `mediaFileId` trong token khác `:fileId` param → 403 `FORBIDDEN` (chống reuse token cho file khác).
- Token sai/hết hạn → 403 `FORBIDDEN`.

### 10.6 Integration/manual check

- Chạy lại toàn bộ test `accounts`/`auth`/`recording`/`notifications`/`administration` hiện có sau khi sửa enum/`AuthModule` để confirm không break (đặc biệt `face-profile.service.spec.ts`, `permissions.guard.spec.ts` nếu có).
- Chạy `npm run migration:run` trên DB dev, verify migration idempotent (chạy lại lần 2 không lỗi, không tạo duplicate permission).

---

## 11. Implementation Phases

### Phase 1 — Foundation (enum, guard, migration, DTO/pipe khung)
- T001: Thêm `REJECTED` vào `FaceProfileStatus` (`face-profile.entity.ts`); thêm `AVATAR_REJECTED` vào `NotificationType` (`notification.entity.ts`).
- T002: Tạo `RequireRoles` decorator + `RolesGuard`; đăng ký/export trong `AuthModule`; unit test (mục 10.3).
- T003: Migration seed 2 permission (`account.avatar.review`, `account.avatar.download`) + role_permissions cho `SYSTEM_ADMIN` (mục 4.3).
- T004: `ListAvatarSubmissionsQueryDto`, `RejectAvatarSubmissionDto`, response DTO (list item/detail/download-url), `avatarSubmissionIdPipe()`.

### Phase 2 — Signed Download URL capability (mới, cross-module)
- T005: Thêm `generateSignedDownloadToken`/`verifySignedDownloadToken` vào `StorageService`; env var `MEDIA_DOWNLOAD_TOKEN_SECRET`/`MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS`/`API_PUBLIC_BASE_URL`; unit test (mục 10.4).
- T006: Thêm route `GET /media-files/:fileId/secure-download` vào `MediaFilesController` (module `recording`), tái dùng `MediaFilesService.resolvePlayback`; unit test (mục 10.5).

### Phase 3 — Read endpoints (list, detail, download-url)
- T007: `AdminAvatarReviewService.listAvatarSubmissions` + QueryBuilder/sort whitelist/search/filter.
- T008: `AdminAvatarReviewService.getAvatarSubmissionDetail`.
- T009: `AdminAvatarReviewService.getAvatarDownloadUrl` (gọi `StorageService` + `AuditLogsService.logAction`).
- T010: `AdminAvatarReviewController` 3 route GET, guard thật, `@UseFilters`.

### Phase 4 — Write endpoints (approve, reject) + transaction
- T011: `AdminAvatarReviewService.approveAvatarSubmission` đầy đủ 7 bước (mục 7.4).
- T012: `AdminAvatarReviewService.rejectAvatarSubmission` đầy đủ (mục 7.5), validate `reason` (trim+NFC+length) ở DTO/service trước khi mở transaction.
- T013: `AdminAvatarReviewController` 2 route POST.
- T014: `AdminAvatarReviewHttpExceptionFilter`; wire toàn bộ vào `accounts.module.ts`.

### Phase 5 — Testing & Acceptance
- T015: Toàn bộ unit test mục 10.1/10.2.
- T016: Chạy lại `npm run lint` + `npm run test` cho `accounts`, `auth`, `recording`, `notifications`, `administration`.
- T017: Chạy `npm run migration:run` (idempotency check thủ công) trên DB dev.
- T018: Đối chiếu từng AC trong `spec.md` mục 8 với test đã viết (mục 13 dưới).

---

## 12. Risks & Mitigations

| Risk | Mức độ | Mitigation |
|---|---|---|
| Signed Download URL là capability hoàn toàn mới, chưa có pattern tương tự trong repo để đối chiếu | Cao | Thiết kế tối thiểu bằng `crypto` built-in (không thêm dependency), test round-trip kỹ (mục 10.4); cô lập trong `StorageService` (method mới, không sửa method cũ) + 1 route mới trong `recording` (không sửa route cũ) |
| `RolesGuard` là thay đổi vào `AuthModule` (shared infra) — rủi ro ảnh hưởng module khác | Trung bình | Chỉ thêm guard mới (không sửa `PermissionsGuard`/`JwtAuthGuard` hiện có); guard mặc định pass-through nếu controller khác không gắn `@RequireRoles` (giống `PermissionsGuard` không có `@RequirePermissions`) → an toàn cho mọi controller cũ |
| Mismatch `module_code` (`account` spec vs `accounts` allowlist) có thể gây nhầm lẫn khi review code với spec.md | Thấp | Đã ghi rõ quyết định + lý do ở mục 4.3; `permission_code` vẫn đúng nguyên văn spec, chỉ `module_code` (field nội bộ riêng) đổi |
| `VALIDATION_ERROR` không có trong bảng §7.1 — rủi ro FE/test viết theo bảng đó sẽ không khớp | Thấp | Đã flag rõ trong mục 8; đề xuất bổ sung dòng `422 VALIDATION_ERROR` vào bảng §7.1 ở lần cập nhật spec tiếp theo (không tự sửa spec.md trong phạm vi plan này) |
| 2 query DB/request do `RolesGuard` + `PermissionsGuard` tách biệt | Thấp | Quy mô nhỏ (NFR-002: 5 admin đồng thời), chấp nhận; không tối ưu sớm |
| Ghi `audit_logs`/`notifications` trực tiếp qua `manager.getRepository()` thay vì qua `AuditLogsService`/`NotificationsService` — lệch khỏi pattern "dùng shared service" thường thấy trong repo | Trung bình | Đã giải thích rõ lý do (atomicity + giá trị field chính xác) ở mục 2/7.4/7.5; không phải lỗi thiết kế mà là lựa chọn có chủ đích cho đúng FR-027/028/AC-015 |
| `FaceProfileEntity` không có `@ManyToOne` relation tới `UserEntity`/`DepartmentEntity` — cú pháp join trong QueryBuilder (mục 7.1) cần verify chính xác khi code thật | Thấp | Đã ghi chú rõ trong mục 7.1; fallback an toàn nếu join entity-class không chạy đúng: dùng raw SQL parameterized qua `manager.query()` (đã có precedent ở `face-profile.service.ts`) |
| Trùng lặp khái niệm với `feat-user-avatar-submission-reminder` (cả 2 đều chạm `face_profiles`/`media_files`/permission `account.*`) | Trung bình | Đã phân ranh giới rõ ở mục 2/3 (ai sở hữu index, ai sở hữu enum addition trùng tên `REJECTED` — **cả 2 feature đều cần thêm `REJECTED` vào enum, đây là thay đổi TS-only, ai code trước sẽ thêm, ai code sau chỉ cần xác nhận giá trị đã tồn tại, không thêm trùng**) |
| Test "concurrent 2 admin" (AC-CONCURRENT-001) khó giả lập đúng thật với `FOR UPDATE` trong unit test (cần 2 connection thật) | Trung bình | Unit test chỉ giả lập qua mock (service đọc lại status đã đổi); test thật 2-transaction-song-song nên để ở integration test riêng (ngoài phạm vi Jest unit, có thể bổ sung sau nếu CI hỗ trợ DB thật) |

---

## 13. Acceptance Criteria Traceability

| AC ID | Verification | Phase |
|---|---|---|
| AC-001 | List trả 200 + pending_review + meta pagination | Phase 3 (T007) |
| AC-002 | Approve không có old active: 200, status=active, avatar_url update, audit ghi | Phase 4 (T011) |
| AC-002b | Approve có old active: old → revoked cùng transaction | Phase 4 (T011) |
| AC-003 | Reject: status=rejected, metadata_json có reason, notification tạo, avatar_url không đổi, audit ghi | Phase 4 (T012) |
| AC-004 | Download URL: 200 + downloadUrl + expiresAt ISO8601 + audit `avatar.download` | Phase 3 (T009) |
| AC-005 | Reason missing/rỗng → 422 `AVATAR_REJECTION_REASON_REQUIRED` | Phase 4 (T012) |
| AC-006 | Approve khi status=active → 409 `AVATAR_SUBMISSION_NOT_PENDING` | Phase 4 (T011) |
| AC-007 | UUID hợp lệ nhưng không tồn tại (sau khi pass auth) → 404 `AVATAR_SUBMISSION_NOT_FOUND` | Phase 3/4 (T007-T012) |
| AC-008 | `sortBy` sai → 422 `INVALID_SORT_BY` | Phase 1 (T004) + Phase 3 (T007) |
| AC-009 | `limit=200` → 422 `INVALID_PAGINATION_LIMIT` | Phase 1 (T004) |
| AC-010 | `status=all` → 422 `INVALID_AVATAR_SUBMISSION_STATUS` | Phase 1 (T004) |
| AC-011 | INTERNAL_USER không có role SYSTEM_ADMIN → 403 | Phase 1 (T002) + Phase 3 (T010) |
| AC-012 | Chưa đăng nhập → 401 | Phase 3 (T010)/Phase 4 (T013) |
| AC-013 | SYSTEM_ADMIN thiếu permission `account.avatar.review` → 403 | Phase 1 (T002, T003) |
| AC-014 | Reject thành công → notification insert đúng field trong transaction | Phase 4 (T012) |
| AC-015 | Notification insert fail → rollback toàn bộ, 500 `AVATAR_REJECT_FAILED` | Phase 4 (T012) |
| AC-016 | Audit `avatar.approve` đúng `old/new_value_json` | Phase 4 (T011) |
| AC-017 | Audit `avatar.reject` đúng `old/new_value_json` | Phase 4 (T012) |
| AC-018 | Audit `avatar.download` đúng `entity_id`/`action_type` | Phase 3 (T009) |
| AC-CONCURRENT-001 | 2 admin đồng thời → 1 thành công, 1 nhận 409, không trùng audit/notification | Phase 4 (T011/T012) + test mục 10.1 |
| AC-PRIMARY-NULL-APPROVE | `primary_image_file_id` null → 500 `AVATAR_APPROVE_FAILED` | Phase 4 (T011) |
| AC-PRIMARY-NULL-DOWNLOAD | `primary_image_file_id` null → 404 `AVATAR_MEDIA_NOT_FOUND` | Phase 3 (T009) |
| AC-AUTH-ORDER-NO-PERM | Thiếu permission download → 403 trước khi check tồn tại | Phase 1 (T002) + Phase 3 (T010), tự nhiên đúng nhờ guard chạy trước pipe (mục 6.2) |
| AC-SEARCH-ILIKE | `q=nguyen` → match case-insensitive 3 field | Phase 3 (T007) |
| AC-DEPTID-EMPTY | `departmentId` hợp lệ, không data → 200 `data=[]` | Phase 3 (T007) |
| AC-LOCK-TIMEOUT | Lỗi infra → 500, không phải 409 | Phase 4 (T011/T012) + mục 7.6/9.3 |

---

## Checklist tự kiểm tra trước khi chạy `$speckit-tasks`

- [x] Đã đọc `AGENTS.md`/`CLAUDE.md` trước khi viết plan (RULE TỐI THƯỢNG 1).
- [x] Đã đối chiếu spec.md với code thật (entities, guards, services, storage, migrations) — không suy đoán, có trích dẫn file/dòng cụ thể.
- [x] Bám sát spec.md và toàn bộ 13 clarification đã chốt (Q-BL/Q-AR/Q-VL/Q-DM/Q-EC/Q-AC/Q-SB) — không quyết định gì mâu thuẫn với spec.
- [x] Không mở rộng scope: mọi mục Out of Scope của spec được liệt kê lại nguyên trạng ở mục 3; phần ngoài "5 capability mới" (mục 1) đều bắt nguồn trực tiếp từ FR/NFR đã chốt, không tự thêm tính năng.
- [x] **Database impact**: không bảng mới; 1 migration data-seed (permission); 2 enum TS-only; bảng read/write footprint rõ theo từng operation (mục 4.5).
- [x] **API contract**: khớp 100% 5 endpoint + 1 endpoint hỗ trợ mới (secure-download) có lý do kỹ thuật rõ ràng (mục 5).
- [x] **Validation rules**: đủ toàn bộ rule + error code từ spec, có flag rõ 1 gap nhỏ (`VALIDATION_ERROR`) và cách xử lý (mục 8).
- [x] **Permission/authorization**: role+permission dual-check qua `RolesGuard` mới + `PermissionsGuard` có sẵn; permission seed qua migration; mapping đầy đủ 5 endpoint (mục 6).
- [x] **Transaction boundary**: rõ ràng thứ tự lock-trước-check, audit/notification ghi trực tiếp qua transaction manager (không qua shared service không transaction-aware), rollback toàn bộ khi 1 bước fail (mục 7.4/7.5).
- [x] **Error handling**: mapping đủ toàn bộ error code spec §7.1, có scoped filter đảm bảo đúng envelope (mục 9).
- [x] **Test coverage**: unit test cho service/controller/guard/storage/endpoint mới, có map rõ tới AC (mục 10).
- [x] **Consistency với Acceptance Criteria**: traceability đủ toàn bộ AC (kể cả AC bổ sung ở §8.7), map về Phase cụ thể (mục 13).
- [x] Đã ghi CHANGELOG ở đầu file theo RULE TỐI THƯỢNG 2.
- [x] Không viết code thật, chỉ đặc tả implementation plan để `$speckit-tasks` sinh task chi tiết.
