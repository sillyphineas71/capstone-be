# Implementation Plan: Nhắc nhở và tự nộp ảnh đại diện/khuôn mặt (ACCT-AVATAR-SUBMIT-001)

**Feature Directory**: spec/features/account/feat-user-avatar-submission-reminder
**Date**: 2026-06-24
**Spec**: spec.md
**Status**: Draft (chờ `$speckit-tasks`)

---

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo plan.md lần đầu cho ACCT-AVATAR-SUBMIT-001, dựa trên spec.md (đã chốt toàn bộ clarify BL/AR/VL/DM/EH/SB) và đối chiếu code hiện có (accounts/auth/storage modules) | Toàn bộ file |

---

## 1. Feature Summary

Plan này hiện thực hóa 2 endpoint self-service avatar (`GET /api/v1/me/avatar-status`, `POST /api/v1/me/avatar-submission`) trong module `accounts`, và bổ sung 3 field derived (`avatarReviewStatus`, `avatarRequired`, `shouldShowAvatarPopup`) vào response login của module `auth`, đúng theo `spec.md` (ACCT-AVATAR-SUBMIT-001).

Cốt lõi kỹ thuật cần giải quyết:
- **Avatar status resolution priority (BR-004)**: một user có thể có nhiều row `face_profiles` (lịch sử submission); cần một hàm pure-function duy nhất, dùng chung cho cả `accounts` (TypeORM) và `auth` (raw SQL), để tránh hai nơi tính logic priority lệch nhau.
- **Submission flow (mục 18.7 spec)**: pre-generate UUID cho `faceProfileId`/`mediaFileId`, upload Cloudinary trước, sau đó INSERT `media_files` rồi `face_profiles` rồi `audit_logs` trong cùng 1 transaction, có best-effort cleanup Cloudinary khi transaction fail (EH-01).
- **Ràng buộc dữ liệu bắt buộc**: partial unique index `ux_face_profiles_user_pending` (DM-01) + 2 permission mới qua migration idempotent (AR-01).
- **Tách bạch kiến trúc**: `auth` module tiếp tục dùng raw SQL (ADR-001, SB-01), không import service/repository TypeORM từ `accounts`; `accounts` module dùng TypeORM Repository theo convention business module.

Plan này **không** mở rộng phạm vi ngoài những gì `spec.md` đã chốt — mọi quyết định kỹ thuật (HOW) trong plan đều ánh xạ trực tiếp về một BR/FR/AC cụ thể trong spec.

---

## 2. Technical Context

| Aspect | Detail |
|---|---|
| **Framework** | NestJS (TypeScript), module `accounts` (đã tồn tại) và `auth` (đã tồn tại) |
| **ORM** | TypeORM cho `accounts` (Repository pattern, đúng ADR-002/ADR-003); **raw SQL qua `DataSource.query()`** cho `auth` (ADR-001 — ngoại lệ có chủ đích, không refactor) |
| **Database** | PostgreSQL, DB v3.2 Compact (39 bảng) — không thêm bảng, chỉ 1 migration DDL (partial unique index) + 1 migration data-seed (permissions) |
| **Storage (avatar)** | **Cloudinary — dependency MỚI**, project hiện tại CHƯA có tích hợp Cloudinary (`StorageService` hiện chỉ hỗ trợ `local`, S3/MinIO còn là `TODO`). Cần thêm npm package `cloudinary` (SDK chính thức, CommonJS-compatible) |
| **File validation (magic bytes)** | **Không thêm dependency mới.** Tự viết utility check magic bytes nội bộ cho đúng 3 định dạng được phép (`image/jpeg`, `image/png`, `image/webp`) — xem mục 7.4. Tránh rủi ro ESM-only của thư viện `file-type` (v17+) trong project dùng `module: nodenext` không có `"type": "module"` |
| **Auth** | JWT Bearer qua `JwtAuthGuard` + `PermissionsGuard` (đã có, dùng `AuthzReadRepository.getEffectiveRolesAndPermissions`) |
| **Permission mới** | `profile.avatar.read_status`, `profile.avatar.submit` (module_code = `accounts`, đúng regex `IsPermissionCodeFormatConstraint`) |
| **Target Module** | `accounts` (2 endpoint mới) + `auth` (bổ sung field login response) |
| **Module phụ thuộc** | `accounts` (FaceProfileEntity, MediaFileEntity, AuditLogEntity, PermissionEntity/RolePermissionEntity), `auth` (LoginService, login.types, login-response.presenter — KHÔNG import ngược từ `accounts`), `administration` (AuditLogEntity — đã được `AccountsModule` import sẵn) |
| **Cấu trúc module hiện có quan trọng** | `AccountsModule` **đã import** `AuthModule` (để dùng `JwtAuthGuard`/`PermissionsGuard`). Do đó `AuthModule` import ngược `AccountsModule`/`FaceProfileService` sẽ tạo **circular module dependency** — đây là lý do kỹ thuật cứng (không chỉ convention ADR-001) buộc phải tuân thủ SB-01 |
| **Testing** | Jest (unit test theo pattern `*.spec.ts` đã có trong `accounts`/`auth`), mock `DataSource`/Repository theo đúng style `face-profile.service.spec.ts` |

---

## 3. Scope Confirmation

Plan chỉ triển khai đúng phạm vi đã chốt ở `spec.md` mục 3.1/3.2/19. Không bổ sung gì ngoài danh sách dưới đây.

### IN SCOPE (bám `spec.md` §3.1, §7, §8, §18)

- `GET /api/v1/me/avatar-status` — permission `profile.avatar.read_status` (FR-005, mục 8.1).
- `POST /api/v1/me/avatar-submission` (multipart/form-data) — permission `profile.avatar.submit` (FR-006, mục 8.2).
- Bổ sung `avatarReviewStatus`/`avatarRequired`/`shouldShowAvatarPopup` vào response `POST /api/v1/auth/login` (BR-016, mục 8.3).
- Validate file (size, magic bytes), validate `consentAccepted` (transform multipart), validate account active/soft-delete (mục 9, 11.2).
- Audit log `avatar.upload`/`avatar.reupload` (BR-012, mục 12).
- Migration DDL: partial unique index `ux_face_profiles_user_pending` (DM-01, mục 18.5).
- Migration data-seed idempotent: 2 permission mới + role_permissions (AR-01, mục 10).
- Bổ sung giá trị `rejected` vào enum TypeScript `FaceProfileStatus` (BR-014).
- Trích xuất `profile_code` generator dùng chung cho UC-17 và feature này (BR-PROFILE-CODE — xem mục 7.2 quyết định cụ thể).
- Cloudinary integration tối thiểu: upload ảnh + xóa ảnh (cho best-effort cleanup EH-01).

### OUT OF SCOPE (bám `spec.md` §19.1/19.3 — liệt kê lại để plan không vô tình lấn vào)

- Admin approve/reject avatar, mọi logic của `feat-admin-avatar-review-workflow`.
- Notification (in-app/email) khi reject hoặc approve.
- Face recognition thật, embedding, gọi Face Server enrollment thật.
- Sửa đổi hành vi nghiệp vụ của UC-17 (`account.face.register`) — plan chỉ đổi **cách sinh `profile_code`** (chi tiết kỹ thuật nội bộ, không đổi API contract/permission/actor của UC-17).
- Tạo bảng mới, cột mới, bảng lịch sử versioning.
- Background job quét/dọn Cloudinary orphan file định kỳ.
- Lưu trạng thái "đã dismiss popup" ở backend.
- Sửa global exception filter / `CommonModule` dùng chung cho toàn hệ thống (xem quyết định scoped filter ở mục 9).
- Sửa `seed_permissions.sql` hoặc UC-17 permission scope hiện tại (mục 20.2 của spec — vấn đề riêng, không thuộc feature này).

---

## 4. Data Model Impact

> Khớp `spec.md` mục 18. Không tạo bảng mới. 2 thay đổi migration bắt buộc + 1 thay đổi app-level enum.

### 4.1 Entity tái sử dụng (không đổi schema)

| Entity | File | Thay đổi |
|---|---|---|
| `FaceProfileEntity` | `src/modules/accounts/entities/face-profile.entity.ts` | Thêm `REJECTED = 'rejected'` vào enum `FaceProfileStatus` (TypeScript only, không migration DDL — cột là `varchar(30)` không CHECK constraint, BR-014) |
| `MediaFileEntity` | `src/modules/recording/entities/media-file.entity.ts` | KHÔNG đổi. Dùng giá trị có sẵn `StorageProvider.CLOUD_PROVIDER` (`'cloud_provider'`) cho mọi file avatar Cloudinary (BR-013, FR-012) |
| `AuditLogEntity` | `src/modules/administration/entities/audit-log.entity.ts` | KHÔNG đổi. Dùng `actionType = 'avatar.upload' \| 'avatar.reupload'`, `entityType = 'face_profile'` |
| `PermissionEntity`, `RolePermissionEntity` | `src/modules/accounts/entities/*.ts` | KHÔNG đổi schema. Thêm 2 row qua migration (mục 4.3) |

### 4.2 Migration 1 — Partial unique index (DM-01, bắt buộc)

File mới: `src/database/migrations/<timestamp>-AddFaceProfilesUserPendingUniqueIndex.ts`, theo đúng pattern `20260616-AddRoomNameUniqueIndex.ts` đã có:

```ts
export class AddFaceProfilesUserPendingUniqueIndex<timestamp> implements MigrationInterface {
  name = 'AddFaceProfilesUserPendingUniqueIndex<timestamp>';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_face_profiles_user_pending
       ON face_profiles(user_id)
       WHERE status = 'pending_review' AND deleted_at IS NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS ux_face_profiles_user_pending;');
  }
}
```

### 4.3 Migration 2 — Permission seed idempotent (AR-01, bắt buộc)

**Quyết định**: implement dưới dạng **TypeORM migration thường** trong `src/database/migrations/` (KHÔNG đặt trong `src/database/seeds/`). Lý do: rà soát codebase cho thấy các file `src/database/seeds/*SeedXxxPermission*.ts` hiện tại **không có runner/CLI nào gọi tới** (không xuất hiện trong `package.json`, không có file index/CLI invoke) — đặt logic seed permission ở đó không có gì đảm bảo nó thực sự được chạy. Đặt trong `migrations/` đảm bảo seed permission chạy chắc chắn qua `npm run migration:run` (cơ chế duy nhất đã verify hoạt động trong repo).

```ts
export class SeedProfileAvatarPermissions<timestamp> implements MigrationInterface {
  name = 'SeedProfileAvatarPermissions<timestamp>';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissions = [
      { code: 'profile.avatar.read_status', name: 'Xem trạng thái avatar', action: 'avatar_read_status' },
      { code: 'profile.avatar.submit', name: 'Tự nộp avatar', action: 'avatar_submit' },
    ];
    const roles = ['INTERNAL_USER', 'MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN'];

    for (const p of permissions) {
      const inserted: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO permissions (permission_code, permission_name, module_code, action_code, description, is_active)
         VALUES ($1, $2, 'accounts', $3, $2, true)
         ON CONFLICT (permission_code) DO NOTHING
         RETURNING id;`,
        [p.code, p.name, p.action],
      );
      // ON CONFLICT DO NOTHING không trả row nếu đã tồn tại → cần SELECT lại để idempotent khi re-run.
      const permissionId = inserted[0]?.id ?? (
        await queryRunner.query(`SELECT id FROM permissions WHERE permission_code = $1`, [p.code])
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
         SELECT id FROM permissions WHERE permission_code IN ('profile.avatar.read_status','profile.avatar.submit')
       );`,
    );
    await queryRunner.query(
      `DELETE FROM permissions WHERE permission_code IN ('profile.avatar.read_status','profile.avatar.submit');`,
    );
  }
}
```

> Ghi chú quan trọng: `ON CONFLICT (permission_code) DO NOTHING RETURNING id` **không trả row** khi permission đã tồn tại — code trên xử lý bằng `SELECT` fallback để vẫn lấy được `permissionId` khi migration được chạy lại (idempotency thật, không chỉ "không lỗi"). Task khi viết code thật phải giữ đúng hành vi này.

### 4.4 INSERT/UPDATE/READ theo transaction (chi tiết xem mục 7.3)

| Bảng | Hành vi | Khi nào |
|---|---|---|
| `media_files` | INSERT (id pre-generated) | Mỗi submission hợp lệ |
| `face_profiles` | INSERT (id pre-generated, KHÔNG UPDATE row cũ) | Mỗi submission hợp lệ |
| `audit_logs` | INSERT (`avatar.upload`/`avatar.reupload`) | Sau khi 2 INSERT trên thành công, cùng transaction |
| `users` | KHÔNG ghi (chỉ đọc `avatar_url`, `account_status`, `deleted_at`) | — |
| `face_profiles` (đọc) | SELECT toàn bộ row chưa soft-delete theo `user_id`, dùng cho resolver BR-004 | GET avatar-status, login |

---

## 5. API / Contract Plan

| Method | Path | Permission | Controller | Ghi chú |
|---|---|---|---|---|
| GET | `/api/v1/me/avatar-status` | `profile.avatar.read_status` | `AvatarController.getStatus` | Đúng response shape mục 8.1 spec |
| POST | `/api/v1/me/avatar-submission` | `profile.avatar.submit` | `AvatarController.submit` | `multipart/form-data`, đúng response shape mục 8.2 spec |
| POST | `/api/v1/auth/login` (đã có) | — | `AuthController` (đã có) | Bổ sung field trong `AuthUserSummary` — KHÔNG đổi route/method, chỉ mở rộng payload (mục 8.3 spec) |

**File mới**:
- `src/modules/accounts/controllers/avatar.controller.ts` — `@Controller('me')`, route con `avatar-status` và `avatar-submission`.
- `src/modules/accounts/dto/submit-avatar.dto.ts` — `SubmitAvatarDto` (field `consentAccepted`).
- `src/modules/accounts/dto/avatar-status-response.dto.ts` — shape response GET.
- `src/modules/accounts/dto/avatar-submission-response.dto.ts` — shape response POST.

**File cần sửa**:
- `src/modules/auth/types/login.types.ts` — thêm 3 field vào `AuthUserSummary`.
- `src/modules/auth/presenters/login-response.presenter.ts` — copy 3 field vào `userSummary()`.
- `src/modules/auth/services/login.service.ts` — gọi repository mới để lấy 3 field, gán vào `summary`.

Chi tiết request/response/error code: xem `spec.md` mục 8 (API Contract Draft) và mục 11 (Error Handling) — plan này không lặp lại JSON mẫu, chỉ tham chiếu.

---

## 6. Authorization Plan

- Cả 2 endpoint dùng **guard thật** `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('profile.avatar.read_status' | 'profile.avatar.submit')`, đúng pattern của `UsersController`/`DepartmentsController`.
  - **Cảnh báo triển khai quan trọng**: file gần nhất về mặt domain (`face-profile.controller.ts`, `media-files.controller.ts`) dùng `MockPermissionsGuard` (luôn `return true`) — đây là tech debt riêng của UC-17/recording, **KHÔNG được copy pattern này** cho `AvatarController`. Phải dùng `PermissionsGuard` thật để thỏa FR-021/022/023 và AC-011/012.
- `userId` của actor luôn lấy từ `@CurrentUser()` (tương đương `request.user.userId` đã set bởi `JwtAuthGuard`) — không nhận `userId` từ param/body/query (BR-001, FR-003).
- Permission seed: xem mục 4.3 (migration), gán cho 4 role `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`.
- Auth module (login) **không** thêm permission check mới — chỉ đọc dữ liệu avatar status cho user đã authenticate thành công, không phải hành vi cần authorization riêng.
- Auth module (SB-01): repository mới `AvatarStatusRawRepository` (raw SQL, đặt trong `src/modules/auth/repositories/`) — **không** import `AccountsService`/`FaceProfileService`/Repository từ `AccountsModule`. Về mặt kiến trúc, điều này còn là **bắt buộc kỹ thuật** vì `AccountsModule` đã import `AuthModule` — import ngược sẽ tạo circular dependency.

---

## 7. Business Logic Plan

### 7.1 Avatar status resolution — pure function dùng chung (BR-004)

**Quyết định kiến trúc cốt lõi**: tạo 1 function pure, không phụ thuộc DI/DB, đặt tại:

```text
src/common/utils/avatar-status-resolver.util.ts
```

```ts
export type FaceProfileStatusValue = 'pending_review' | 'active' | 'rejected' | 'disabled' | 'revoked';

export interface FaceProfileStatusRow {
  status: FaceProfileStatusValue;
  lastUpdatedAt: Date | null;
  enrolledAt: Date | null;
}

export interface AvatarReviewResolution {
  avatarReviewStatus: 'not_uploaded' | 'pending_review' | 'rejected' | 'approved';
  avatarRequired: boolean;
  shouldShowAvatarPopup: boolean;
}

export function resolveAvatarReviewStatus(rows: FaceProfileStatusRow[]): AvatarReviewResolution {
  // Bước 1: pending_review thắng tuyệt đối (BR-004.1)
  if (rows.some((r) => r.status === 'pending_review')) {
    return build('pending_review');
  }
  // Bước 2: active (BR-004.2)
  if (rows.some((r) => r.status === 'active')) {
    return build('approved');
  }
  // Bước 3: row gần nhất trong (rejected, disabled, revoked) (BR-004.3)
  if (rows.length > 0) {
    return build('rejected');
  }
  // Bước 4: không có row nào (BR-004.4)
  return build('not_uploaded');
}

function build(status: AvatarReviewResolution['avatarReviewStatus']): AvatarReviewResolution {
  return {
    avatarReviewStatus: status,
    avatarRequired: status !== 'approved', // BR-006
    shouldShowAvatarPopup: status === 'not_uploaded' || status === 'rejected', // BR-005
  };
}
```

> Lý do đặt ở `src/common/utils/` (không phải `accounts/utils/` hay `auth/utils/`): cả 2 module đều cần dùng, và `common` là nơi quy định cho shared util theo cấu trúc thư mục ở `AGENTS.md` §6. Tham số đầu vào của function này **không quan tâm row lấy từ TypeORM hay raw SQL** — đây chính là cách thỏa SB-01 (auth không cần TypeORM) mà vẫn không trùng lặp logic BR-004 ở 2 nơi (tránh rủi ro 2 implementation lệch nhau theo thời gian).
>
> Hàm chỉ cần `rows.length > 0` ở bước 3 vì sau khi loại `pending_review`/`active` ở bước 1–2, các row còn lại CHỈ có thể là `rejected`/`disabled`/`revoked` (đã loại các giá trị khác) — không cần tính "row gần nhất" để CHỌN GIÁ TRỊ trả về (vì cả 3 đều map ra `rejected`), trường `lastUpdatedAt`/`enrolledAt` trong interface được giữ lại cho khả năng mở rộng sau (ví dụ field phụ `avatarReviewReason` đã ghi ở `spec.md` mục 20.1 — không implement trong feature này) và để query rõ ràng đúng những cột cần (tránh SELECT *).

### 7.2 `profile_code` generator dùng chung (BR-PROFILE-CODE)

**Quyết định**: trích xuất generator dùng chung ngay trong phạm vi feature này (effort nhỏ, rủi ro thấp — xem mục 12).

File mới: `src/modules/accounts/utils/face-profile-code.util.ts`

```ts
import { randomUUID } from 'crypto';

export function generateFaceProfileCode(): string {
  return `FP-${randomUUID().replace(/-/g, '').toUpperCase()}`;
}
```

- `AvatarSubmissionService` (mới) dùng function này khi INSERT `face_profiles`.
- `FaceProfileService.enrollPortrait` (UC-17, file `src/modules/accounts/services/face-profile.service.ts`) **đổi 1 dòng**: thay `` `FP-${randomUUID().slice(0, 8)}` `` bằng `generateFaceProfileCode()`. Đây là thay đổi tối thiểu, không đổi behavior/API/permission của UC-17, chỉ đổi format chuỗi `profile_code` sinh ra — đã rà soát `face-profile.service.spec.ts` hiện tại, test không assert literal format cũ nên không bị break (xem Risk mục 12).

### 7.3 Submission flow — `AvatarSubmissionService.submit(userId, file, consentAccepted)`

File mới: `src/modules/accounts/services/avatar-submission.service.ts`. Triển khai đúng 12 bước ở `spec.md` mục 18.7:

```text
1. (Đã làm ở Guard/Controller) Auth + Permission + DTO validation cơ bản.
2. Load user (TypeORM UserEntity hoặc query nhẹ) → check account_status=active, deleted_at IS NULL (FR-018, ERR-007).
3. Validate file: bắt buộc có file (ERR-001), size <= FACE_PORTRAIT_MAX_BYTES (tái dùng env var hiện có, ERR-002),
   magic bytes hợp lệ qua util mục 7.4 (ERR-003).
4. Validate consentAccepted đã transform (DTO @Transform — mục 8 Validation Plan) = true (ERR-004).
5. Query face_profiles theo user_id (chưa soft-delete) → nếu có status=pending_review → throw ConflictException
   (AVATAR_ALREADY_PENDING_REVIEW, ERR-008) — KHÔNG gọi Cloudinary.
6. Xác định actionType: 'avatar.upload' nếu rows.length === 0, ngược lại 'avatar.reupload' (BR-012).
7. faceProfileId = randomUUID(); mediaFileId = randomUUID() (pre-generate, mục 18.7 bước 3-4).
8. Upload buffer lên Cloudinary qua CloudinaryService.uploadImage() → { publicId, secureUrl } (ngoài transaction DB).
   - Lỗi ở bước này → throw BadGatewayException(AVATAR_STORAGE_FAILED, ERR-009), KHÔNG mở transaction.
9. dataSource.transaction(async (manager) => {
     a. (Re-check) SELECT ... WHERE user_id=:id AND status='pending_review' FOR UPDATE — phòng race condition
        trước khi insert (lưới đầu); partial unique index là lưới cuối (DM-01/EC-003).
     b. INSERT media_files (id=mediaFileId, related_entity_type='face_profile', related_entity_id=faceProfileId,
        storage_provider='cloud_provider', storage_key=publicId, file_url=secureUrl, uploaded_by=userId, ...).
     c. INSERT face_profiles (id=faceProfileId, user_id=userId, profile_code=generateFaceProfileCode(),
        status='pending_review', primary_image_file_id=mediaFileId, consent_at=now(), enrolled_at=now(),
        last_updated_at=now()).
     d. INSERT audit_logs (action_type=actionType, entity_type='face_profile', entity_id=faceProfileId,
        user_id=userId, new_value_json={status:'pending_review', mediaFileId}, [old_value_json nếu reupload]).
   })
10. Bắt lỗi unique violation trong transaction (driverError.code==='23505' &&
    constraint==='ux_face_profiles_user_pending') → rollback (tự động bởi transaction callback throw) →
    map thành ConflictException(AVATAR_ALREADY_PENDING_REVIEW) — KHÔNG để lộ lỗi DB thô (EC-003).
11. Lỗi khác trong transaction → rollback tự động → best-effort cleanup Cloudinary
    (CloudinaryService.deleteImage(publicId), log info/warning theo EH-01) → throw
    InternalServerErrorException(AVATAR_UPLOAD_FAILED, ERR-010).
12. Thành công → return { faceProfileId, avatarReviewStatus: 'pending_review', submittedAt: now }.
```

### 7.4 Magic bytes validator (VL-02, không thêm dependency)

File mới: `src/modules/accounts/utils/image-magic-bytes.util.ts`

```ts
export function detectImageMimeType(buffer: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
```

Dùng trực tiếp byte signature chuẩn (JPEG SOI `FF D8 FF`, PNG signature 8 byte, WEBP `RIFF....WEBP`) — đủ và chính xác cho đúng 3 định dạng `spec.md` yêu cầu, không cần thư viện ngoài.

### 7.5 `CloudinaryService` (BR-013)

File mới: `src/modules/storage/cloudinary.service.ts` (đặt cạnh `StorageService` hiện có, KHÔNG sửa `StorageService` để tránh ảnh hưởng các feature đang dùng storage local khác).

```ts
@Injectable()
export class CloudinaryService {
  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get('CLOUDINARY_API_SECRET'),
    });
  }

  async uploadImage(buffer: Buffer, folder: string): Promise<{ publicId: string; secureUrl: string }> { ... }
  async deleteImage(publicId: string): Promise<void> { ... } // best-effort, EH-01
}
```

Env var mới cần thêm vào `.env.example` (Phase 1):
```env
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_AVATAR_FOLDER=avatars
```
**Tái dùng** env var đã có `FACE_PORTRAIT_MAX_BYTES=5242880` cho giới hạn 5MB (FR-016) — không tạo env var trùng lặp, vì UC-17 và feature này có cùng giới hạn kích thước ảnh khuôn mặt.

### 7.6 Auth module — đọc avatar status (SB-01)

File mới: `src/modules/auth/repositories/avatar-status-raw.repository.ts`

```ts
@Injectable()
export class AvatarStatusRawRepository {
  constructor(private readonly dataSource: DataSource) {}

  async getFaceProfileRows(userId: string): Promise<FaceProfileStatusRow[]> {
    const rows = await this.dataSource.query(
      `SELECT status, last_updated_at, enrolled_at FROM face_profiles
       WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    return rows.map((r: any) => ({
      status: r.status,
      lastUpdatedAt: r.last_updated_at,
      enrolledAt: r.enrolled_at,
    }));
  }
}
```

`LoginService.login()` gọi `avatarStatusRawRepository.getFaceProfileRows(user.id)` rồi `resolveAvatarReviewStatus(rows)` (từ `src/common/utils/`), gán 3 field vào `summary` trước khi return — **không** sửa cấu trúc transaction/luồng login hiện có, chỉ thêm 1 bước đọc (best-effort: nếu lỗi, log và set `avatarReviewStatus = 'not_uploaded'` mặc định để không làm fail toàn bộ login — quyết định resilience, vì avatar status không phải điều kiện chặn đăng nhập theo `spec.md` §3.1).

---

## 8. Validation Plan

| Validation | Layer | Code | HTTP | Ghi chú |
|---|---|---|---|---|
| JWT hợp lệ | Guard (`JwtAuthGuard`) | `UNAUTHORIZED` | 401 | FR-021 |
| Permission `profile.avatar.read_status`/`profile.avatar.submit` | Guard (`PermissionsGuard`) | `FORBIDDEN` | 403 | FR-022/023 |
| `account_status = active` | Service (chỉ áp dụng cho POST) | `ACCOUNT_NOT_ACTIVE` | 403 | FR-018, không áp dụng cho GET (EC-006) |
| `file` bắt buộc | Service | `AVATAR_FILE_REQUIRED` | 400 | FR-014 |
| Kích thước file <= 5MB | Service (so với `FACE_PORTRAIT_MAX_BYTES`) | `AVATAR_FILE_TOO_LARGE` | 400 | FR-016 |
| Magic bytes thuộc {jpeg, png, webp} | Service (util mục 7.4) | `AVATAR_FILE_TYPE_INVALID` | 400 | FR-015, VL-02 |
| `consentAccepted` transform = true | DTO (`@Transform` + `@Equals(true)`) | `AVATAR_CONSENT_REQUIRED` | 400 | FR-017, BR-011, VL-01 |
| Không có row `pending_review` | Service (SELECT trước transaction + re-check trong transaction) | `AVATAR_ALREADY_PENDING_REVIEW` | 409 | BR-007/BR-010, ERR-008 |

**Thứ tự kiểm tra** PHẢI đúng `spec.md` mục 11.2 (Validation/Error Precedence): Auth → Permission → Load user/Account status → File presence → File size → Magic bytes → Consent → Pending-review check → Storage/transaction. Đây là thứ tự cài đặt bắt buộc trong `AvatarSubmissionService.submit()`, không được đảo (để test case nhiều lỗi đồng thời luôn trả đúng 1 lỗi xác định).

`SubmitAvatarDto` (chỉ chứa `consentAccepted`, `file` xử lý qua `@UploadedFile()` riêng):

```ts
export class SubmitAvatarDto {
  @Transform(({ value }) => value === true || value === 'true')
  @Equals(true, { message: 'Bạn phải đồng ý sử dụng ảnh cho mục đích nhận diện khuôn mặt.' })
  consentAccepted: boolean;
}
```

> Lưu ý: lỗi từ `class-validator`/`ValidationPipe` mặc định KHÔNG tự ra đúng `error.code = AVATAR_CONSENT_REQUIRED` theo envelope `spec.md` — xem quyết định ở mục 9 (scoped exception filter) để đảm bảo đúng contract.

---

## 9. Error Handling Plan

### 9.1 Mapping exception → HTTP (đúng `spec.md` mục 11)

| Tình huống | Exception NestJS | Code |
|---|---|---|
| Thiếu/sai JWT | (mặc định từ `JwtAuthGuard`) | `UNAUTHORIZED` |
| Thiếu permission | (mặc định từ `PermissionsGuard`, đã có sẵn shape `{success:false,...}` — xem `permissions.guard.ts`) | `FORBIDDEN` |
| Account không active | `ForbiddenException({code:'ACCOUNT_NOT_ACTIVE', message})` | `ACCOUNT_NOT_ACTIVE` |
| File thiếu/sai/size | `BadRequestException({code, message})` | `AVATAR_FILE_REQUIRED` / `AVATAR_FILE_TOO_LARGE` / `AVATAR_FILE_TYPE_INVALID` |
| Consent không hợp lệ | `BadRequestException({code:'AVATAR_CONSENT_REQUIRED', message})` | `AVATAR_CONSENT_REQUIRED` |
| Đang pending_review (cả app-check và DB unique violation) | `ConflictException({code:'AVATAR_ALREADY_PENDING_REVIEW', message})` | `AVATAR_ALREADY_PENDING_REVIEW` |
| Cloudinary upload fail | `BadGatewayException({code:'AVATAR_STORAGE_FAILED', message})` | `AVATAR_STORAGE_FAILED` (502) |
| Lỗi không xác định sau upload | `InternalServerErrorException({code:'AVATAR_UPLOAD_FAILED', message})` | `AVATAR_UPLOAD_FAILED` (500) |

### 9.2 Quyết định: scoped exception filter cho đúng envelope `spec.md` §11

Rà soát codebase: chỉ có `QueryFailedFilter` (`@Catch(QueryFailedError)`, đăng ký global qua `CommonModule`/`APP_FILTER`) tạo đúng envelope `{success, message, error:{code,...}, timestamp, path}`, và nó **chỉ xử lý lỗi unique constraint của `departments`**. Các `HttpException` thường (`BadRequestException({code,message})` v.v.) hiện tại trả về NGUYÊN payload `{code, message}` + `statusCode` mặc định của NestJS — KHÔNG khớp envelope `spec.md` đã chốt ở mục 8.2/11.

**Quyết định**: tạo 1 filter nhỏ, **scoped chỉ cho `AvatarController`** (không sửa `CommonModule`/`QueryFailedFilter` toàn cục, tránh ảnh hưởng module khác — đúng nguyên tắc không tự mở rộng scope):

File mới: `src/modules/accounts/filters/avatar-http-exception.filter.ts`

```ts
@Catch(HttpException)
export class AvatarHttpExceptionFilter implements ExceptionFilter {
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

Áp dụng tại controller: `@UseFilters(AvatarHttpExceptionFilter)` trên `AvatarController`. Vì filter `@Catch(HttpException)` ở method/class scope chạy **trước** global filter cho cùng request, việc này không ảnh hưởng `QueryFailedFilter` hay controller khác.

### 9.3 Race condition (EC-003) — xử lý trong service, không phụ thuộc global filter

Trong `try/catch` quanh `dataSource.transaction(...)` của `AvatarSubmissionService.submit()`: nếu lỗi là `QueryFailedError` với `driverError.code === '23505'` và `driverError.constraint === 'ux_face_profiles_user_pending'` → throw `ConflictException({code:'AVATAR_ALREADY_PENDING_REVIEW', ...})` (không phải lỗi DB thô). Lỗi khác → thực hiện cleanup Cloudinary (mục 7.3 bước 11) rồi throw `InternalServerErrorException({code:'AVATAR_UPLOAD_FAILED', ...})`.

---

## 10. Testing Strategy

### 10.1 Unit test — pure function (ưu tiên cao nhất, nền tảng đúng đắn của toàn feature)

File: `src/common/utils/avatar-status-resolver.util.spec.ts`

- Không có row → `not_uploaded` (AC-001/AC-004 implied "no row" case).
- 1 row `pending_review` → `pending_review`, `shouldShowAvatarPopup=false` (AC-003b).
- 1 row `active` → `approved`, `avatarRequired=false` (AC-006).
- 1 row `rejected` → `rejected`, `shouldShowAvatarPopup=true` (AC-004).
- 1 row `disabled` → `rejected` (AC-016).
- 1 row `revoked` → `rejected` (AC-017).
- 1 row `active` + 1 row `pending_review` → `pending_review` (AC-003, AC-006b — case trọng yếu nhất).
- 1 row `pending_review` + 1 row `revoked` → `pending_review` (EC-007).
- 1 row `active` + 1 row `revoked` (không có pending) → `approved` (EC-007).
- Nhiều row hỗn hợp (active + rejected + disabled, không pending) → `approved`.

### 10.2 Unit test — `AvatarSubmissionService`

File: `src/modules/accounts/services/avatar-submission.service.spec.ts` (mock `DataSource`, `CloudinaryService`, Repository — theo đúng style `face-profile.service.spec.ts`).

- Happy path lần đầu: chưa có row nào → upload Cloudinary, INSERT media_files + face_profiles + audit_logs (`avatar.upload`) (AC-002).
- Happy path reupload sau reject: có row `rejected` → tạo row mới, row cũ giữ nguyên, audit `avatar.reupload` (AC-005).
- Happy path replace khi đã approved: có row `active` → tạo row mới `pending_review`, row `active` giữ nguyên, `users.avatar_url` không bị service này touch (AC-006b).
- Block khi đang pending: có row `pending_review` → `ConflictException AVATAR_ALREADY_PENDING_REVIEW`, KHÔNG gọi Cloudinary (AC-013).
- Thiếu file / sai magic bytes / quá size / consent sai → đúng lỗi tương ứng theo đúng thứ tự precedence (AC-007..010, AC-010b).
- Account không active → `ACCOUNT_NOT_ACTIVE`, không gọi Cloudinary (AC-014).
- Cloudinary upload throw → `AVATAR_STORAGE_FAILED`, không mở transaction, không insert gì (ERR-009).
- DB transaction throw lỗi thường (không phải unique violation) → rollback, **gọi `CloudinaryService.deleteImage`** (assert mock called với đúng `publicId`), throw `AVATAR_UPLOAD_FAILED` (EC-004).
- DB transaction throw unique violation (`23505`, constraint đúng tên) → map thành `AVATAR_ALREADY_PENDING_REVIEW`, KHÔNG gọi cleanup Cloudinary thật (vì ảnh đã insert được ở nhánh khác, không phải orphan) — **giả lập race condition test** (EC-003).
- `profile_code` sinh đúng format `FP-` + 32 hex uppercase, không trùng giữa 2 lần gọi liên tiếp.

### 10.3 Unit test — `AvatarController`

File: `src/modules/accounts/controllers/avatar.controller.spec.ts`

- `getStatus()` gọi đúng service method với `userId` từ `@CurrentUser()`.
- `submit()` gọi đúng service method với `file`/`dto.consentAccepted`/`userId`.
- Verify decorator `@RequirePermissions` gắn đúng permission code cho mỗi route (đọc metadata qua `Reflector` trong test, theo pattern test guard hiện có nếu repo có ví dụ, hoặc test thông qua e2e nhẹ nếu cần).

### 10.4 Unit test — `face-profile-code.util.ts`, `image-magic-bytes.util.ts`

- `generateFaceProfileCode()`: format đúng, độ dài cố định, không có dấu `-`.
- `detectImageMimeType()`: đúng cho 3 buffer mẫu hợp lệ (JPEG/PNG/WEBP signature thật), trả `null` cho buffer PDF/random/empty/buffer quá ngắn.

### 10.5 Unit test — `FaceProfileService` (regression UC-17)

File đã có: `face-profile.service.spec.ts` — chạy lại để confirm KHÔNG fail sau khi đổi sang `generateFaceProfileCode()` (Risk mục 12). Thêm 1 assertion mới: `profile_code` sinh ra khớp format mới (nếu cần, không bắt buộc literal string).

### 10.6 Unit test — `AvatarStatusRawRepository` + `LoginService` (auth)

- `AvatarStatusRawRepository.getFaceProfileRows()`: mock `DataSource.query`, assert SQL có `WHERE user_id = $1 AND deleted_at IS NULL`, parameterized đúng.
- `login.service.spec.ts` (đã có, cần bổ sung case): response login chứa 3 field mới đúng giá trị theo rows mock; lỗi khi đọc avatar status KHÔNG làm fail toàn bộ login (resilience, mục 7.6).

---

## 11. Implementation Phases

### Phase 1 — Foundation (migration, enum, generator dùng chung, dependency)
- T001: Cài npm package `cloudinary`; thêm `CLOUDINARY_*` vào `.env.example`.
- T002: Migration DDL `ux_face_profiles_user_pending` (mục 4.2).
- T003: Migration seed permission `profile.avatar.read_status`/`profile.avatar.submit` (mục 4.3).
- T004: Thêm `REJECTED` vào enum `FaceProfileStatus` (`face-profile.entity.ts`).
- T005: Tạo `generateFaceProfileCode()` (`face-profile-code.util.ts`); cập nhật `FaceProfileService.enrollPortrait` dùng lại; chạy lại test UC-17 hiện có để confirm không break.
- T006: Tạo `resolveAvatarReviewStatus()` + test (`src/common/utils/avatar-status-resolver.util.ts`).
- T007: Tạo `detectImageMimeType()` + test (`image-magic-bytes.util.ts`).

### Phase 2 — Cloudinary integration
- T008: `CloudinaryService` (`uploadImage`, `deleteImage`) trong module `storage`.
- T009: Unit test `CloudinaryService` (mock SDK).

### Phase 3 — Avatar status read (accounts) + DTO/response shape
- T010: `AvatarStatusResponseDto`, `AvatarSubmissionResponseDto`, `SubmitAvatarDto`.
- T011: Service method đọc status cho `accounts` (TypeORM Repository `FaceProfileEntity` → `resolveAvatarReviewStatus`).

### Phase 4 — Submission flow + controller + filter
- T012: `AvatarSubmissionService.submit()` đầy đủ 12 bước (mục 7.3).
- T013: `AvatarHttpExceptionFilter` (mục 9.2).
- T014: `AvatarController` (2 route, guard thật, `@UseFilters`).
- T015: Wire `AvatarController`/`AvatarSubmissionService`/`CloudinaryService` vào `accounts.module.ts`.

### Phase 5 — Auth/login integration (SB-01)
- T016: `AvatarStatusRawRepository` (raw SQL, module `auth`).
- T017: Sửa `login.types.ts` (`AuthUserSummary` + 3 field), `login-response.presenter.ts`.
- T018: Sửa `login.service.ts` gọi repository + resolver, gán vào `summary`, xử lý resilience (lỗi đọc avatar status không fail login).

### Phase 6 — Testing & Acceptance
- T019: Toàn bộ unit test mục 10 (service/controller/util/repository).
- T020: Chạy lại `npm run lint` + `npm run test` cho 2 module `accounts`, `auth` — đảm bảo không phá test cũ.
- T021: Đối chiếu thủ công từng AC trong `spec.md` mục 14 với test đã viết (mục 13 dưới đây).

---

## 12. Risks & Mitigations

| Risk | Mức độ | Mitigation |
|---|---|---|
| Cloudinary SDK/credential chưa có trong project, cần xác nhận với team trước khi merge | Cao | T001 cô lập ở Phase 1; mock `CloudinaryService` hoàn toàn trong test, không gọi network thật; nêu rõ cần `.env` thật ở môi trường staging/production |
| Copy nhầm `MockPermissionsGuard` từ `FaceProfileController`/`MediaFilesController` (file gần nhất) | Trung bình | Đã ghi rõ cảnh báo ở mục 6; review code bắt buộc kiểm tra `AvatarController` dùng `PermissionsGuard` thật |
| `AccountsModule` đã import `AuthModule` → nguy cơ circular dependency nếu lỡ tay import ngược | Cao nếu xảy ra | Thiết kế resolver dùng chung đặt ở `common/utils` (mục 7.1), `auth` chỉ thêm repository raw SQL nội bộ, không import gì từ `accounts` |
| Đổi `profile_code` generator ảnh hưởng UC-17 đang chạy | Thấp | Thay đổi 1 dòng, đã rà soát `face-profile.service.spec.ts` không assert literal string cũ; chạy lại test trong T005 trước khi tiếp tục |
| `src/database/seeds/*.ts` không có runner xác nhận được — seed permission có thể không bao giờ chạy nếu đặt sai chỗ | Cao nếu đặt nhầm | Quyết định đặt seed permission trong `src/database/migrations/` (mục 4.3), không phải `seeds/` |
| Không có global exception filter chuẩn hóa envelope cho `HttpException` thường | Trung bình | Scoped `AvatarHttpExceptionFilter` chỉ áp dụng cho `AvatarController` (mục 9.2), không sửa hạ tầng chung |
| Race condition 2 request submit cùng lúc vượt qua app-level check | Thấp (đã có lưới DB) | Partial unique index (Phase 1) + catch `23505` trong transaction (mục 7.3 bước 10) |
| File-type detection tự viết có thể thiếu edge case (ảnh hợp lệ nhưng signature lạ) | Thấp | Chỉ cần đúng 3 format đã chốt trong spec; test với buffer mẫu thật của từng format; nếu sau này cần thêm format, mở rộng function thay vì đổi kiến trúc |
| Login response thêm field có thể bị FE cache/không refresh ngay sau khi admin approve | Đã ghi nhận ở spec (EC-001), không thuộc rủi ro kỹ thuật của plan này | Không cần mitigation thêm — đã là quyết định nghiệp vụ chốt |
| Quên rollback Cloudinary cleanup khi lỗi xảy ra ngoài transaction (trước khi mở transaction) | Thấp | Bước 8 (upload) xảy ra TRƯỚC transaction; nếu transaction fail ở bước 9, cleanup luôn được gọi ở catch (bước 11) — không có khoảng hở |

---

## 13. Acceptance Criteria Traceability

| AC ID | Verification | Phase |
|---|---|---|
| AC-001 | Login: chưa có row → `not_uploaded`/`avatarRequired=true`/`shouldShowAvatarPopup=true` | Phase 5 (T018) + Phase 1 (T006 resolver test) |
| AC-002 | Submit lần đầu: 201, media_files+face_profiles tạo mới, audit `avatar.upload`, không đổi `users.avatar_url` | Phase 4 (T012) |
| AC-003 | GET status khi có cả `active`+`pending_review` → trả `pending_review` | Phase 1 (T006) + Phase 3 (T011) |
| AC-003b | GET status chỉ có `pending_review` → `pending_review` | Phase 1 (T006) |
| AC-004 | Login khi `rejected` → `rejected`/popup=true | Phase 5 (T018) |
| AC-005 | Submit khi `rejected` → row mới `pending_review`, audit `avatar.reupload`, row cũ giữ nguyên | Phase 4 (T012) |
| AC-006 | Login khi `approved` → `approved`/`avatarRequired=false`/`avatarUrl` khác null | Phase 5 (T018) |
| AC-006b | Submit khi `approved` → row mới pending, row active giữ nguyên, GET sau đó trả `pending_review` | Phase 4 (T012) + Phase 1 (T006) |
| AC-007 | Submit thiếu file → 400 `AVATAR_FILE_REQUIRED` | Phase 4 (T012) |
| AC-008 | Magic bytes sai (PDF đổi tên .jpg) → 400 `AVATAR_FILE_TYPE_INVALID` | Phase 1 (T007) + Phase 4 (T012) |
| AC-009 | File 8MB → 400 `AVATAR_FILE_TOO_LARGE` | Phase 4 (T012) |
| AC-010 | `consentAccepted=false`/thiếu → 400 `AVATAR_CONSENT_REQUIRED` | Phase 3 (T010 DTO) + Phase 4 (T012) |
| AC-010b | `consentAccepted="true"` (string) → transform hợp lệ, không reject | Phase 3 (T010 DTO) |
| AC-011 | Chưa đăng nhập → 401 cả 2 endpoint | Phase 4 (T014, guard) |
| AC-012 | Thiếu permission submit → 403, không tạo dữ liệu | Phase 4 (T014, guard) |
| AC-013 | Đang `pending_review` → 409 `AVATAR_ALREADY_PENDING_REVIEW`, không đổi dữ liệu | Phase 4 (T012) |
| AC-014 | `account_status` khác active → 403 `ACCOUNT_NOT_ACTIVE` | Phase 4 (T012) |
| AC-015 | Không bảng mới; có index + permission seed + enum `rejected` | Phase 1 (T002, T003, T004) |
| AC-016 | GET status khi chỉ có `disabled` → `rejected`, popup=true, message trung tính | Phase 1 (T006) |
| AC-017 | GET status khi chỉ có `revoked` → `rejected`, popup=true, message trung tính | Phase 1 (T006) |

---

## Checklist tự kiểm tra trước khi chạy `$speckit-tasks`

- [x] Đã đọc `AGENTS.md` trước khi viết plan (RULE TỐI THƯỢNG 1).
- [x] Bám sát `spec.md` và toàn bộ clarification đã chốt (BL/AR/VL/DM/EH/SB) — không quyết định gì mâu thuẫn với spec.
- [x] Không mở rộng scope: mọi mục Out of Scope của spec được liệt kê lại nguyên trạng ở mục 3.
- [x] Database impact: chỉ 1 migration DDL (index) + 1 migration data-seed (permission), không bảng mới (mục 4).
- [x] API contract: khớp 100% endpoint/method/permission ở `spec.md` mục 8 (mục 5).
- [x] Validation rules: đủ 8 rule + đúng thứ tự precedence mục 11.2 spec (mục 8).
- [x] Permission/authorization: dùng guard thật, không Mock; permission mới seed qua migration; cảnh báo rủi ro circular dependency (mục 6).
- [x] Transaction boundary: rõ ràng pre-generate UUID, thứ tự insert, rollback + cleanup Cloudinary (mục 7.3, 9.3).
- [x] Error handling: mapping đủ 11 error code, có quyết định cụ thể cho đúng response envelope (mục 9).
- [x] Test coverage: có unit test cho pure function (ưu tiên cao nhất), service, controller, util, repository, regression UC-17 (mục 10).
- [x] Consistency với Acceptance Criteria: traceability đủ 19 AC, map về Phase cụ thể (mục 13).
- [x] Đã ghi CHANGELOG ở đầu file theo RULE TỐI THƯỢNG 2.
- [x] Không viết code thật, chỉ đặc tả implementation plan để `$speckit-tasks` sinh task chi tiết.
