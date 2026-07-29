# 📝 CHANGELOG & REVISION HISTORY

| Ngay cap nhat | Tom tat thay doi | Cac dong thay doi |
| :--- | :--- | :--- |
| 2026-07-29 | Khoi tao plan: tach bach "avatar" (hien thi, khong bat buoc, khong duyet) khoi "sinh trac hoc/biometric" (bat buoc cho FaceGate, bat buoc duyet manager) — dang bi gop lam mot trong luong `ACCT-AVATAR-SUBMIT-001`/`ACCT-AVATAR-REVIEW-001` hien tai | Toan bo tai lieu |
| 2026-07-29 | T08-T11 (tasks.md) da thuc thi xong o tang spec: doi ten toan bo `feat-admin-avatar-review-workflow` va `feat-user-avatar-submission-reminder` (+ doi ten folder) sang "biometric"; xoa hanh vi auto-update `users.avatar_url` khi approve; va BUG-01 (them `getActivePortraitBytes`, cap nhat `feat-meeting-face-provisioning` va `feat-portrait-enrollment`, chot NC-1). Code (T01-T07) VAN CHUA lam — chi moi xong phan tai lieu spec. | Muc 8 (bang trang thai cap nhat) |

---

# Plan: Tach bach Avatar va Sinh trac hoc (Biometric)

- **Loai tai lieu**: PLAN.md (cross-cutting, khong phai 1 feature don le — dieu phoi thay doi tren 2 feature hien co + 1 feature moi)
- **Module / Domain**: `accounts` (chinh), `face-access` (lien quan)
- **Ngay tao**: 2026-07-29
- **Status**: Approved — san sang trien khai
- **Nguon quyet dinh**: Hoi thoai truc tiep voi nguoi dung (Product Owner phia BE), da chot qua 4 cau hoi lam ro (xem muc 1).

---

## 0. TL;DR

Đội đang gọi nhầm khái niệm: luồng `avatar-submission` + `admin-avatar-review` hiện tại (bảng `face_profiles`, có duyệt, revoke-active-cũ, đẩy ảnh cho FaceGate) **về bản chất đã là luồng sinh trắc học**, không phải avatar hiển thị. Việc này cần:

1. Đổi tên đúng bản chất (avatar → biometric) cho luồng hiện có, không đổi database/entity.
2. Bỏ hành vi tự động đồng bộ `users.avatar_url` khi duyệt sinh trắc học (2 khái niệm tách biệt hoàn toàn).
3. Vá lỗ hổng phát hiện được: `face-provisioning.service.ts` hiện đẩy ảnh cho FaceGate **không kiểm tra `face_profiles.status === 'active'`** — nghĩa là ảnh chưa được duyệt vẫn có thể lọt ra thiết bị. Đây là lỗi cần sửa để "bắt buộc phải duyệt" có hiệu lực thật.
4. Xây mới 1 luồng avatar thật (tự do, không duyệt, ghi thẳng `users.avatar_url`).
5. Cập nhật lại nội dung các spec hiện có đang mô tả sai/lẫn khái niệm.

**Không cần migration schema** (không bảng mới, không cột mới) — chỉ cần migration đổi permission code + seed permission mới.

---

## 1. Quyết định đã chốt (nguồn: hội thoại với PO)

| # | Câu hỏi | Quyết định |
|---|---|---|
| D1 | "Bắt buộc sinh trắc học" có cần BE chặn thêm ở API khác không? | **Không** — ràng buộc tự nhiên qua thiết bị FaceGate (không có profile active thì không nhận diện được). Không thêm guard mới ở module khác. |
| D2 | Khi duyệt (approve) sinh trắc học, có tự set `users.avatar_url` không? | **Không** — tách biệt hoàn toàn, approve sinh trắc học không còn đụng đến `avatar_url`. |
| D3 | Luồng code hiện tại đặt tên "avatar" nhưng bản chất là sinh trắc học — có đổi tên không? | **Có** — đổi tên đúng bản chất (`avatar` → `biometric`) trong code lẫn spec, chấp nhận breaking API path, báo FE cập nhật. |
| D4 | Avatar mới (tự do, không duyệt) có giữ nguyên validate cũ không? | **Có** — tái dùng nguyên bộ validate (magic-bytes, JPEG/PNG/WEBP, ≤5MB), bỏ bước `pending_review`, set active ngay, vẫn ghi audit log. |

### 1.1 Phát hiện kỹ thuật bổ sung trong lúc khảo sát (không phải câu hỏi gốc, nhưng bắt buộc xử lý cùng đợt)

- **BUG-01**: `src/modules/face-access/services/face-provisioning.service.ts` gọi `FaceProfileService.getPortraitBytes(userId)` và đẩy thẳng ảnh cho FaceGate nếu có bytes, **không kiểm tra `face_profiles.status === 'active'`**. Vì D1 xác nhận ràng buộc "bắt buộc duyệt" phải là thật (qua việc FaceGate chỉ nên nhận ảnh đã duyệt), bug này phải được vá trong đợt này — nếu không, ảnh `pending_review`/`rejected` vẫn có thể bị đẩy ra thiết bị, làm vô hiệu hoá toàn bộ mục đích "phải qua manager duyệt" của yêu cầu gốc.
- **DRIFT-01**: Spec `feat-admin-avatar-review-workflow` mục OOS-005 ghi "KHÔNG cho MANAGER approve", nhưng migration `20260727000006-GrantManagerAvatarReviewPermission.ts` đã cấp quyền này cho `MANAGER` trong thực tế. Vì yêu cầu gốc của PO là "vẫn qua bước **manager** duyệt", quyết định: **sửa spec cho khớp code** (cho phép MANAGER duyệt), không revert code.
- **DRIFT-02** (chỉ ghi nhận, không xử lý trong đợt này): tồn tại 2 luồng tạo `face_profiles` song song — UC-17 admin-driven (`feat-portrait-enrollment`, dùng **upsert**) và self-service (dùng **insert-only**), khác `profile_code` generator. Không nằm trong yêu cầu của PO lần này, không tự ý sửa.

---

## 2. Phạm vi thay đổi Database / Entity

**Không có thay đổi bảng, không có cột mới.** Đúng theo AGENTS.md §5.4 (không tự ý thêm bảng/cột khi không có yêu cầu rõ ràng).

| Đối tượng | Thay đổi | Lý do |
|---|---|---|
| `face_profiles` (entity `FaceProfileEntity`) | Không đổi | Tiếp tục là bảng "sinh trắc học" đúng nghĩa, chỉ đổi tên gọi ở tầng API/code, không đổi schema |
| `users.avatar_url` | Không đổi cấu trúc, đổi **chủ sở hữu ghi dữ liệu** | Từ nay chỉ luồng avatar mới (không duyệt) được ghi field này; luồng duyệt sinh trắc học không còn ghi |
| `media_files` | Không đổi | Dùng chung cho cả 2 luồng (biometric + avatar), phân biệt qua `related_entity_type` |

---

## 3. Migration cần tạo

Không có migration schema (DDL). Chỉ có 2 migration data/permission, đặt trong `src/database/migrations/` (bắt buộc theo AGENTS.md §5.5 quy tắc 4 — seed permission phải nằm migrations, không dùng `seeds/`):

### 3.1 Migration A — Đổi tên permission code (rename in-place, giữ nguyên `role_permissions`)

Tên gợi ý: `<timestamp>-RenameAvatarPermissionsToBiometric.ts`

```sql
UPDATE permissions SET permission_code = 'profile.biometric.read_status' WHERE permission_code = 'profile.avatar.read_status';
UPDATE permissions SET permission_code = 'profile.biometric.submit'      WHERE permission_code = 'profile.avatar.submit';
UPDATE permissions SET permission_code = 'account.biometric.review'     WHERE permission_code = 'account.avatar.review';
UPDATE permissions SET permission_code = 'account.biometric.download'   WHERE permission_code = 'account.avatar.download';
```

Dùng `UPDATE` thay vì insert-mới+xoá-cũ để giữ nguyên `id` và toàn bộ liên kết `role_permissions` hiện có (không cần seed lại role nào). Viết migration idempotent (kiểm tra `WHERE permission_code = '...'` trước khi update, `down()` đảo ngược lại).

### 3.2 Migration B — Seed permission avatar mới (tự do, không duyệt)

Tên gợi ý: `<timestamp>-SeedAvatarPhotoUpdatePermission.ts`

```text
permission_code = 'profile.avatar.update'
module_code     = 'accounts'
action_code     = 'update'
permission_name = 'Tu cap nhat anh dai dien (khong can duyet)'
```

Gán cho toàn bộ role hiện đang có quyền tự phục vụ hồ sơ cá nhân: `EMPLOYEE` (tên role thật trong DB, xem ghi chú migration `20260624000001`), `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`. Idempotent theo đúng pattern `ON CONFLICT ... DO NOTHING` như các migration permission trước đó.

---

## 4. Endpoint thay đổi

| Cũ | Mới | Ghi chú |
|---|---|---|
| `GET /api/v1/me/avatar-status` | `GET /api/v1/me/biometric-status` | Breaking path change — báo FE |
| `POST /api/v1/me/avatar-submission` | `POST /api/v1/me/biometric-submission` | Breaking path change |
| `GET /api/v1/admin/avatar-submissions` | `GET /api/v1/admin/biometric-submissions` | Breaking path change |
| `GET /api/v1/admin/avatar-submissions/{id}` | `GET /api/v1/admin/biometric-submissions/{id}` | |
| `GET /api/v1/admin/avatar-submissions/{id}/download-url` | `GET /api/v1/admin/biometric-submissions/{id}/download-url` | |
| `POST /api/v1/admin/avatar-submissions/{id}/approve` | `POST /api/v1/admin/biometric-submissions/{id}/approve` | |
| `POST /api/v1/admin/avatar-submissions/{id}/reject` | `POST /api/v1/admin/biometric-submissions/{id}/reject` | |
| — (mới) | `POST /api/v1/me/avatar` | User tự upload/thay avatar, không duyệt, set `users.avatar_url` ngay |

Response login (`POST /api/v1/auth/login`) và `user` object nói chung: đổi field `avatarReviewStatus`/`avatarRequired`/`shouldShowAvatarPopup` → `biometricReviewStatus`/`biometricRequired`/`shouldShowBiometricPopup`. Field `avatarUrl` **giữ nguyên tên**, nhưng từ nay chỉ phản ánh ảnh user tự set qua endpoint avatar mới, không còn tự động đổi khi duyệt sinh trắc học.

---

## 5. File-by-file: đổi tên (rename)

Toàn bộ nằm trong `src/modules/accounts/` trừ khi ghi chú khác. Rename = đổi tên file + đổi tên class/symbol bên trong + cập nhật import ở nơi dùng.

| File hiện tại | File mới |
|---|---|
| `controllers/avatar.controller.ts` (+ `.spec.ts`) | `controllers/biometric-submission.controller.ts` |
| `controllers/admin-avatar-review.controller.ts` | `controllers/admin-biometric-review.controller.ts` |
| `services/avatar-submission.service.ts` (+ `.spec.ts`) | `services/biometric-submission.service.ts` |
| `services/avatar-status.service.ts` (+ `.spec.ts`) | `services/biometric-status.service.ts` |
| `services/admin-avatar-review.service.ts` (+ `.spec.ts`) | `services/admin-biometric-review.service.ts` |
| `dto/submit-avatar.dto.ts` | `dto/submit-biometric.dto.ts` |
| `dto/avatar-status-response.dto.ts` | `dto/biometric-status-response.dto.ts` |
| `dto/avatar-submission-response.dto.ts` | `dto/biometric-submission-response.dto.ts` |
| `dto/avatar-submission-detail.dto.ts` | `dto/biometric-submission-detail.dto.ts` |
| `dto/avatar-submission-list-item.dto.ts` | `dto/biometric-submission-list-item.dto.ts` |
| `dto/list-avatar-submissions-query.dto.ts` | `dto/list-biometric-submissions-query.dto.ts` |
| `dto/approve-avatar-submission-response.dto.ts` | `dto/approve-biometric-submission-response.dto.ts` |
| `dto/reject-avatar-submission.dto.ts` | `dto/reject-biometric-submission.dto.ts` |
| `dto/reject-avatar-submission-response.dto.ts` | `dto/reject-biometric-submission-response.dto.ts` |
| `dto/avatar-download-url-response.dto.ts` | `dto/biometric-download-url-response.dto.ts` |
| `filters/avatar-http-exception.filter.ts` (+ `.spec.ts`) | `filters/biometric-http-exception.filter.ts` |
| `filters/admin-avatar-review-http-exception.filter.ts` | `filters/admin-biometric-review-http-exception.filter.ts` |
| `pipes/avatar-submission-id.pipe.ts` | `pipes/biometric-submission-id.pipe.ts` |
| `src/common/utils/avatar-status-resolver.util.ts` | `src/common/utils/biometric-status-resolver.util.ts` |

`utils/face-profile-code.util.ts`, `utils/image-magic-bytes.util.ts`: **không đổi tên** — tên đã trung lập/đúng bản chất, dùng chung cho cả biometric lẫn avatar mới.

Error codes: `AVATAR_*` (submission) → `BIOMETRIC_*` tương ứng (`AVATAR_ALREADY_PENDING_REVIEW` → `BIOMETRIC_ALREADY_PENDING_REVIEW`, `AVATAR_SUBMISSION_NOT_FOUND` → `BIOMETRIC_SUBMISSION_NOT_FOUND`, v.v. — danh sách đầy đủ nằm trong TASKS.md).

Audit `action_type`: `avatar.upload`/`avatar.reupload`/`avatar.approve`/`avatar.reject`/`avatar.download` → `biometric.upload`/`biometric.reupload`/`biometric.approve`/`biometric.reject`/`biometric.download`.

Notification `notification_type`: `avatar_rejected` → `biometric_rejected`.

---

## 6. File-by-file: sửa logic (không đổi tên, đổi hành vi)

| File | Thay đổi |
|---|---|
| `services/admin-biometric-review.service.ts` (approve method) | **Xoá** bước `UPDATE users SET avatar_url = ...` khỏi transaction approve. Xoá field `avatarUrlUpdated` khỏi `new_value_json` của audit log. |
| `src/modules/face-access/services/face-provisioning.service.ts` | Vá BUG-01: trước khi dùng portrait bytes, kiểm tra `face_profiles.status === 'active'`. Đề xuất: đổi `FaceProfileService.getPortraitBytes(userId)` thành phương thức mới `getActivePortraitBytes(userId)` chỉ trả bytes khi status là `active`, trả `null` cho mọi status khác (bao gồm `pending_review`) — giữ nguyên hành vi "skip nếu null" đã có sẵn ở `face-provisioning.service.ts` dòng ~160, không cần đổi logic gọi. |
| `src/modules/accounts/services/face-profile.service.ts` | Thêm phương thức `getActivePortraitBytes` (xem trên); giữ nguyên `getPortraitBytes` hiện có nếu còn chỗ khác dùng, hoặc thay thế hẳn nếu chỉ có 1 call site (xác nhận lại trước khi xoá). |

---

## 7. File mới: luồng Avatar thật (không duyệt)

| File | Vai trò |
|---|---|
| `src/modules/accounts/controllers/avatar-photo.controller.ts` | `POST /api/v1/me/avatar` — nhận multipart file, gọi service |
| `src/modules/accounts/services/avatar-photo.service.ts` | Validate (tái dùng `image-magic-bytes.util.ts`, size ≤5MB, JPEG/PNG/WEBP) → lưu Cloudinary → tạo `media_files` (`related_entity_type = 'user_avatar'`) → `UPDATE users SET avatar_url = ...` ngay lập tức → ghi audit log `avatar.updated` |
| `src/modules/accounts/dto/update-avatar-photo.dto.ts` | DTO request (chỉ cần file, không cần `consentAccepted` — đây không phải dữ liệu sinh trắc học) |
| `src/modules/accounts/dto/avatar-photo-response.dto.ts` | DTO response (`avatarUrl`, `updatedAt`) |

Permission: `profile.avatar.update` (migration B, mục 3.2). Không cần bảng mới — không tạo `face_profiles` row nào cho luồng này.

---

## 8. Spec hiện có cần sửa nội dung

| Spec | Việc cần làm | Trạng thái |
|---|---|---|
| `spec/features/account/feat-admin-avatar-review-workflow/spec.md` (giữ nguyên tên FOLDER — chỉ đổi nội dung) | (a) Sửa OOS-005 cho khớp thực tế code (MANAGER được phép duyệt). (b) Đổi toàn bộ Feature ID/tên/endpoint/error code/audit action/permission code sang "biometric". (c) Xoá hành vi auto update `users.avatar_url` khi approve (FR-006/FR-007/BR-BIOMETRIC-URL/FR-027 bước 6/§13.1). | **✅ ĐÃ ÁP DỤNG (T08, 2026-07-29)** |
| `spec/features/account/feat-user-biometric-submission-reminder/spec.md` (đã **đổi tên FOLDER** từ `feat-user-avatar-submission-reminder` bằng `git mv`) | Đổi Feature ID/tên/endpoint/error code/audit action/permission code sang "biometric"; đổi field response `avatarReviewStatus`/`avatarRequired`/`shouldShowAvatarPopup` → `biometricReviewStatus`/`biometricRequired`/`shouldShowBiometricPopup`; sửa BR-002/003/FR-002/FR-009/AC-006 — các chỗ ngầm định `avatar_url` sẽ đổi khi biometric approve, nay xác nhận độc lập hoàn toàn (chủ sở hữu thật là `feat-update-avatar-photo`). | **✅ ĐÃ ÁP DỤNG (T09, 2026-07-29)** |
| `spec/features/face-access/feat-meeting-face-provisioning/spec.md` | Thêm yêu cầu: chỉ dùng portrait khi `face_profiles.status = 'active'` (vá BUG-01, dùng `getActivePortraitBytes` mới); thêm AC-FMP-001-010 skip khi `pending_review`/`rejected`/`disabled`/`revoked`. | **✅ ĐÃ ÁP DỤNG (T10, 2026-07-29)** |
| `spec/features/face-access/feat-portrait-enrollment/spec.md` (UC-17, FPE-001) | Không đổi tên (đã đúng bản chất). Chốt NC-1 = **chờ duyệt**; thêm định nghĩa `getActivePortraitBytes` (FR-FPE-001-005b, AC-FPE-001-009) mà Ticket B (feat-meeting-face-provisioning) phải dùng thay `getPortraitBytes`. | **✅ ĐÃ ÁP DỤNG (T11, 2026-07-29)** |
| `spec/features/account/feat-update-avatar-photo/spec.md` | Spec mới hoàn toàn cho luồng avatar tự do. | **✅ ĐÃ TẠO (2026-07-29)** |

### 8.1 Ghi chú thực thi T08-T11 (2026-07-29)

Việc rename `avatar` → `biometric` trong 2 file lớn (`feat-admin-avatar-review-workflow/spec.md` 997 dòng, `feat-user-biometric-submission-reminder/spec.md` 942 dòng) được thực hiện qua 2 lớp: (1) bulk rename **có kiểm soát ranh giới từ** (`\bavatar\b` regex — tự động BỎ QUA mọi chỗ dính liền `avatar_url`/`avatarUrl` vì underscore/chữ hoa liền sau không tạo word-boundary) cho các định danh kỹ thuật (endpoint, error code, permission code, audit action, notification type); (2) sửa thủ công từng đoạn cho các câu mô tả logic nghiệp vụ liên quan `users.avatar_url` (FR-006/007, BR-BIOMETRIC-URL, FR-027, AC-002/002b, data model, transaction pseudocode, notification text) — nơi ý nghĩa thay đổi hẳn (không còn tự động update avatar_url) chứ không chỉ đổi tên gọi. Toàn bộ có ghi `[SỬA 2026-07-29]`/`[DRIFT-FIX 2026-07-29]` inline để dễ tra soát, đúng RULE TỐI THƯỢNG 2 (AGENTS.md) — không xoá lịch sử quyết định cũ, chỉ đánh dấu obsolete/superseded.

Code thật (T01-T07 trong tasks.md) **CHƯA được triển khai** — mọi thay đổi ở trên chỉ nằm ở tầng tài liệu spec, chuẩn bị cho bước code tiếp theo.

---

## 9. Thứ tự triển khai đề xuất

1. Migration A (rename permission code) + Migration B (seed permission avatar mới) — không phá code hiện tại vì `role_permissions` giữ nguyên id.
2. Vá BUG-01 (`face-provisioning.service.ts` + `face-profile.service.ts`) — có thể làm độc lập, không phụ thuộc rename.
3. Rename code theo mục 5 (avatar → biometric cho luồng review/submission hiện có) + sửa logic mục 6 (bỏ auto-sync avatar_url).
4. Code mới luồng avatar thật theo mục 7.
5. Cập nhật 4 spec hiện có theo TASKS.md.
6. Cập nhật test (`*.spec.ts` đi kèm mỗi file rename ở mục 5, viết test mới cho mục 7).
7. Báo FE danh sách endpoint đổi path (mục 4) + field response đổi tên.

Không cần chạy migration schema, không cần backfill dữ liệu (dữ liệu `face_profiles`/`users.avatar_url` hiện có giữ nguyên ý nghĩa).
