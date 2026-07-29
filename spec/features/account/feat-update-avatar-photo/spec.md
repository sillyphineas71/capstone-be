# 📝 CHANGELOG & REVISION HISTORY

| Ngay cap nhat | Tom tat thay doi | Cac dong thay doi |
| :--- | :--- | :--- |
| 2026-07-29 | Khoi tao dac ta feature Avatar tu do (khong duyet), tach biet khoi luong sinh trac hoc | Toan bo tai lieu |

---

# Feature Specification: Tự cập nhật ảnh đại diện (Avatar Photo Self-Update)

- **Feature ID**: ACCT-AVATAR-PHOTO-001
- **Feature Name**: Tự cập nhật ảnh đại diện (avatar hiển thị, không cần duyệt)
- **Module / Domain**: `accounts` (self-service profile)
- **Created Date**: 2026-07-29
- **Status**: Draft
- **Source Documents**:
  - `AGENTS.md` — quy tắc RBAC, response convention, transaction, audit.
  - `spec/features/account/feat-split-avatar-and-biometric/plan.md` — quyết định tách avatar/biometric.
  - `src/modules/accounts/entities/user.entity.ts` — cột `avatar_url`.
  - `src/modules/accounts/utils/image-magic-bytes.util.ts` — validate MIME dùng lại.
  - Tương phản trực tiếp với `spec/features/account/feat-admin-avatar-review-workflow/spec.md` (sẽ đổi tên thành biometric) — feature đó xử lý ảnh **sinh trắc học bắt buộc + phải duyệt**; feature này xử lý ảnh **đại diện tuỳ chọn + không duyệt**. Hai feature độc lập hoàn toàn, không chia sẻ bảng `face_profiles`.

---

## 1. Bối cảnh & Mục tiêu

### 1.1 Bối cảnh

Trước đây, ảnh đại diện (`users.avatar_url`) bị gộp chung với luồng sinh trắc học: chỉ khi System Administrator/Manager duyệt ảnh sinh trắc học thì `avatar_url` mới được cập nhật. Điều này sai về nghiệp vụ — avatar là ảnh hiển thị UI thuần tuý, không cần kiểm soát chất lượng cho mục đích nhận diện khuôn mặt, và không nên bắt buộc user phải "được duyệt" mới có ảnh đại diện.

Feature này tách avatar ra thành một luồng độc lập: user tự upload, hệ thống lưu và hiển thị ngay, không qua bước duyệt của quản lý nào.

### 1.2 Mục tiêu

Cho phép user tự thay đổi ảnh đại diện của chính mình bất kỳ lúc nào, hiệu lực ngay lập tức, không phụ thuộc và không ảnh hưởng tới trạng thái sinh trắc học (`face_profiles`).

### 1.3 Giá trị mang lại

- **Cho user**: đổi ảnh đại diện tức thì, không phải chờ ai duyệt.
- **Cho hệ thống**: tách rõ 2 loại dữ liệu ảnh có mục đích khác nhau (hiển thị vs định danh an ninh), giảm rủi ro nhầm lẫn khi audit/bảo trì.

### 1.4 Giả định

- User đã đăng nhập, có JWT hợp lệ.
- `users.avatar_url` không còn bị ghi bởi bất kỳ luồng nào khác ngoài feature này (theo `feat-split-avatar-and-biometric/plan.md` §6, luồng admin-biometric-review đã bỏ việc tự động ghi field này).
- Storage dùng chung Cloudinary như luồng biometric (MVP), qua service lưu trữ hiện có.
- Không giới hạn số lần đổi avatar.

---

## 2. Actor & Phạm vi

| Actor | Vai trò |
|---|---|
| Bất kỳ user đã đăng nhập (mọi role: EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN) | Tự upload/thay ảnh đại diện của chính mình |

### 2.1 Trong phạm vi (In Scope)

- API tự upload/thay avatar của chính mình.
- Validate file (định dạng, kích thước) tái dùng bộ validate hiện có.
- Ghi audit log cho hành vi đổi avatar.
- Cập nhật `users.avatar_url` ngay lập tức, không qua trạng thái chờ duyệt.

### 2.2 Ngoài phạm vi (Out of Scope)

- Duyệt/từ chối avatar bởi quản lý — **không tồn tại trong feature này**.
- Bất kỳ liên hệ nào với `face_profiles`/sinh trắc học/FaceGate.
- Kiểm duyệt nội dung ảnh bằng AI (NSFW filter, v.v.) — không yêu cầu trong MVP.
- Giới hạn số lần đổi avatar theo thời gian.
- Xoá avatar (set về null) — MVP chỉ hỗ trợ thay thế bằng ảnh mới; xoá hẳn avatar không thuộc phạm vi trừ khi có yêu cầu riêng.

---

## 3. Business Rules

BR-001: `users.avatar_url` chỉ được ghi bởi feature này. Không có luồng nào khác (kể cả admin-biometric-review) được phép cập nhật field này.

BR-002: Đổi avatar có hiệu lực ngay lập tức, không có trạng thái trung gian (không có "pending_review" cho avatar).

BR-003: Không giới hạn tần suất đổi avatar trong MVP.

BR-004: File avatar tái sử dụng đúng bộ validate của luồng biometric hiện có: MIME type xác định bằng magic-bytes (`image-magic-bytes.util.ts`), chỉ chấp nhận `image/jpeg`, `image/png`, `image/webp`, kích thước tối đa 5MB (`AVATAR_PHOTO_MAX_BYTES`, mặc định 5 * 1024 * 1024, đọc qua config — không hard-code).

BR-005: Ảnh cũ (nếu có) trên storage không bắt buộc phải xoá ngay trong MVP (tránh rủi ro race condition/rollback phức tạp); có thể dọn dẹp bằng job riêng sau này nếu cần — không thuộc phạm vi feature này.

---

## 4. Functional Requirements

```text
FR-001: THE system SHALL cho phép user đã xác thực (JWT hợp lệ) tự cập nhật avatar_url của chính mình, không nhận tham số userId từ client.
FR-002: WHEN user gửi POST /api/v1/me/avatar với file hợp lệ (đúng MIME theo magic-bytes, đúng kích thước), THE system SHALL lưu file lên storage, tạo bản ghi media_files (related_entity_type = 'user_avatar', related_entity_id = userId), cập nhật users.avatar_url ngay lập tức, và ghi audit log action_type = 'avatar.updated'.
FR-003: THE system SHALL KHÔNG tạo hoặc cập nhật bất kỳ bản ghi face_profiles nào khi xử lý request avatar.
FR-004: IF file không được gửi kèm, THEN THE system SHALL trả 400 AVATAR_PHOTO_FILE_REQUIRED.
FR-005: IF MIME type thực tế (magic-bytes) không thuộc image/jpeg, image/png, image/webp, THEN THE system SHALL trả 400 AVATAR_PHOTO_FILE_TYPE_INVALID.
FR-006: IF file vượt quá kích thước tối đa cấu hình, THEN THE system SHALL trả 400 AVATAR_PHOTO_FILE_TOO_LARGE.
FR-007: IF users.account_status khác 'active' hoặc users.deleted_at IS NOT NULL, THEN THE system SHALL trả 403 ACCOUNT_NOT_ACTIVE.
FR-008: IF lưu file lên storage thất bại, THEN THE system SHALL trả 502 AVATAR_PHOTO_STORAGE_FAILED và không cập nhật users.avatar_url.
FR-009: IF user chưa đăng nhập, THEN THE system SHALL trả 401 UNAUTHORIZED.
FR-010: IF user không có permission profile.avatar.update, THEN THE system SHALL trả 403 FORBIDDEN.
```

---

## 5. API Contract Draft

### 5.1 `POST /api/v1/me/avatar`

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/me/avatar` |
| Content-Type | `multipart/form-data` |
| Permission | `profile.avatar.update` |
| System Role | mọi role đã đăng nhập |
| Auth | JWT access token (self, không nhận `userId` param) |

**Request Body (multipart/form-data):**

| Field | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| `file` | binary (image) | Có | Ảnh đại diện, jpg/jpeg/png/webp (magic-bytes), tối đa 5MB |

**Response 200:**
```json
{
  "success": true,
  "message": "Cập nhật ảnh đại diện thành công",
  "data": {
    "avatarUrl": "https://res.cloudinary.com/.../avatar.jpg",
    "updatedAt": "2026-07-29T10:00:00+07:00"
  }
}
```

---

## 6. Error Handling

| HTTP Status | Error Code | Mô tả |
|---:|---|---|
| 400 | `AVATAR_PHOTO_FILE_REQUIRED` | Thiếu file trong request |
| 400 | `AVATAR_PHOTO_FILE_TYPE_INVALID` | MIME type không hợp lệ (magic-bytes) |
| 400 | `AVATAR_PHOTO_FILE_TOO_LARGE` | File vượt quá kích thước tối đa |
| 401 | `UNAUTHORIZED` | Chưa đăng nhập / token không hợp lệ |
| 403 | `FORBIDDEN` | Thiếu permission `profile.avatar.update` |
| 403 | `ACCOUNT_NOT_ACTIVE` | Tài khoản không active hoặc đã soft-delete |
| 502 | `AVATAR_PHOTO_STORAGE_FAILED` | Lưu ảnh lên storage thất bại |

Cấu trúc response lỗi theo `AGENTS.md` §8.2 (chuẩn chung toàn hệ thống).

---

## 7. Acceptance Criteria

```text
AC-001 (happy path):
Given user đã đăng nhập, có permission profile.avatar.update, account active,
When user gọi POST /api/v1/me/avatar với file hợp lệ,
Then hệ thống trả 200, users.avatar_url được cập nhật ngay lập tức, audit log action_type = 'avatar.updated' được ghi, KHÔNG có bản ghi face_profiles nào được tạo/sửa.

AC-002 (đổi avatar nhiều lần):
Given user đã có avatar_url từ trước,
When user gọi POST /api/v1/me/avatar với ảnh mới hợp lệ,
Then hệ thống ghi đè users.avatar_url bằng ảnh mới ngay lập tức, không có trạng thái chờ duyệt nào.

AC-003 (file sai định dạng):
When user gửi file có nội dung không phải ảnh hợp lệ (magic-bytes không khớp jpeg/png/webp) dù đặt tên đuôi .jpg,
Then hệ thống trả 400 AVATAR_PHOTO_FILE_TYPE_INVALID.

AC-004 (không đụng face_profiles):
Given user đang có face_profiles.status = 'pending_review' (đang chờ duyệt sinh trắc học),
When user gọi POST /api/v1/me/avatar,
Then hệ thống cập nhật users.avatar_url bình thường, face_profiles.status của user KHÔNG thay đổi.

AC-005 (không có quyền):
Given user chưa được cấp permission profile.avatar.update,
When user gọi POST /api/v1/me/avatar,
Then hệ thống trả 403 FORBIDDEN.
```

---

## 8. Audit Logging

| Action Type | Entity Type | Khi nào ghi | Nội dung tối thiểu |
|---|---|---|---|
| `avatar.updated` | `user` | Mỗi lần cập nhật avatar thành công | `user_id` (actor = chính user), `entity_id = userId`, `new_value_json = { avatarUrl, mediaFileId }` |

---

## 9. Authorization & Permissions

| Permission Code | Module Code | Mô tả | System Role được cấp |
|---|---|---|---|
| `profile.avatar.update` | `accounts` | Tự cập nhật ảnh đại diện của chính mình | `EMPLOYEE`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |

Seed permission qua migration idempotent (xem `feat-split-avatar-and-biometric/plan.md` §3.2), không dùng thư mục `seeds/` (dead code theo quy ước repo).

---

## 10. Dependencies / Ghi chú tách biệt

- **Không phụ thuộc** `feat-admin-avatar-review-workflow`/`feat-user-avatar-submission-reminder` (sẽ đổi tên biometric) — hai nhóm feature độc lập hoàn toàn về bảng dữ liệu (`users.avatar_url` vs `face_profiles`).
- `media_files.related_entity_type = 'user_avatar'` là giá trị mới, khác `'face_profile'` đã dùng cho luồng biometric — để phân biệt khi truy vấn/audit.
- Nếu tương lai cần avatar mặc định (khi user chưa từng upload), đó là quyết định hiển thị phía FE, không thuộc phạm vi BE spec này.
