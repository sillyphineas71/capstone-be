# 📝 CHANGELOG & REVISION HISTORY

| Ngay cap nhat | Tom tat thay doi | Cac dong thay doi |
| :--- | :--- | :--- |
| 2026-07-29 | Khoi tao task list chi tiet cho viec tach avatar/biometric | Toan bo tai lieu |
| 2026-07-29 | T08-T11 DA HOAN THANH (tang spec, chua dung toi code): rename folder `feat-user-avatar-submission-reminder` -> `feat-user-biometric-submission-reminder` (git mv); sua noi dung 4 file spec theo dung muc tieu tung task. | T08, T09, T10, T11 (danh dau DONE), muc "Trang thai" moi trong tung task |
| 2026-07-29 | T01-T07, T12 DA HOAN THANH (tang code). Phat hien khi code T03: BUG-01 KHONG CON TON TAI (da vao truoc do o commit `b2c34ce`/FPB-001, 2026-06-30) — dinh chinh lai T10/T11 (bo `getActivePortraitBytes`, dung thang `getPortraitBytes` da loc status). Da git mv + sua noi dung 20 file (controller/service/dto/filter/pipe/util) rename avatar->biometric; xoa auto-sync `users.avatar_url` khoi approve; them `AvatarPhotoController/Service` moi (POST /api/v1/me/avatar). Build + lint (chi file da sua) + 104 unit test lien quan deu xanh. | Toan bo T01-T07, T12 |

---

# Tasks: Tach bach Avatar va Sinh trac hoc (Biometric)

Tham chieu: `plan.md` cung thu muc. Danh sach nay liet ke chinh xac tung viec, co the giao rieng le.

## T01 — Migration: rename permission code (avatar → biometric) [✅ DONE 2026-07-29]

- File moi: `src/database/migrations/<timestamp>-RenameAvatarPermissionsToBiometric.ts`
- Nội dung: xem `plan.md` §3.1. Viết `up()`/`down()` đối xứng, kiểm tra tồn tại trước khi update (idempotent).
- Phụ thuộc: không.
- Rủi ro: nếu code cũ (chưa rename ở T04-T06) vẫn đang dùng string `'account.avatar.review'` để check permission thì sẽ gãy 403 ngay sau khi chạy migration này — **phải deploy cùng lúc với T04-T06**, không tách rời.

## T02 — Migration: seed permission avatar mới [✅ DONE 2026-07-29]

- File mới: `src/database/migrations/<timestamp>-SeedAvatarPhotoUpdatePermission.ts`
- Nội dung: xem `plan.md` §3.2.
- Phụ thuộc: không.

## T03 — Vá BUG-01 (face-provisioning chưa gate theo status active) [❌ KHÔNG CẦN LÀM — ĐÍNH CHÍNH 2026-07-29]

**Kết luận sau khi verify bằng `git log -S "R2 + VAL-01" -- src/modules/accounts/services/face-profile.service.ts`**: BUG-01 KHÔNG tồn tại trong code thật. `FaceProfileService.getPortraitBytes(userId)` đã lọc `status = 'active'` từ TRƯỚC, tại commit `b2c34ce` ("fix(accounts): getPortraitBytes lấy ảnh ACTIVE từ Cloudinary cho IVSS enroll (FPB-001)", 2026-06-30) — trước cả khi feature tách avatar/biometric này bắt đầu. `face-provisioning.service.ts` gọi đúng `getPortraitBytes` (đã an toàn), test `face-profile.service.spec.ts` đã có case cho hành vi lọc status.

**KHÔNG tạo method `getActivePortraitBytes`** — sẽ là trùng lặp vô nghĩa với `getPortraitBytes` đã đúng. Việc duy nhất cần làm là sửa 2 spec `feat-meeting-face-provisioning`/`feat-portrait-enrollment` cho khớp thực tế — đã làm (xem changelog 2 file, mục "ĐÍNH CHÍNH 2026-07-29").

Bài học: khi khảo sát ban đầu (agent Explore), báo cáo dựa trên đọc spec.md cũ thay vì code thật — trước khi tin bug report từ spec, phải verify lại bằng code/git log.

## T04 — Rename luồng self-service submission (avatar → biometric) [✅ DONE 2026-07-29]

File cần đổi tên + nội dung (theo `plan.md` §5):
- `controllers/avatar.controller.ts` + `.spec.ts`
- `services/avatar-submission.service.ts` + `.spec.ts`
- `services/avatar-status.service.ts` + `.spec.ts`
- `dto/submit-avatar.dto.ts`
- `dto/avatar-status-response.dto.ts`
- `dto/avatar-submission-response.dto.ts`
- `filters/avatar-http-exception.filter.ts` + `.spec.ts`
- `pipes/avatar-submission-id.pipe.ts`
- `src/common/utils/avatar-status-resolver.util.ts` (kiểm tra call site trong `auth` module — spec ghi rõ auth module dùng raw SQL riêng, đổi tên field trả về theo T04b)

Đổi endpoint path: `/me/avatar-status` → `/me/biometric-status`, `/me/avatar-submission` → `/me/biometric-submission`.

Đổi error code: `AVATAR_FILE_REQUIRED` → `BIOMETRIC_FILE_REQUIRED`, `AVATAR_FILE_TOO_LARGE` → `BIOMETRIC_FILE_TOO_LARGE`, `AVATAR_FILE_TYPE_INVALID` → `BIOMETRIC_FILE_TYPE_INVALID`, `AVATAR_CONSENT_REQUIRED` → `BIOMETRIC_CONSENT_REQUIRED`, `AVATAR_ALREADY_PENDING_REVIEW` → `BIOMETRIC_ALREADY_PENDING_REVIEW`, `AVATAR_STORAGE_FAILED` → `BIOMETRIC_STORAGE_FAILED`, `AVATAR_UPLOAD_FAILED` → `BIOMETRIC_UPLOAD_FAILED`.

Đổi audit action: `avatar.upload` → `biometric.upload`, `avatar.reupload` → `biometric.reupload`.

## T04b — Đổi field response (login + status) [✅ DONE 2026-07-29]

- Response `GET /api/v1/me/biometric-status` và object `user` trong `POST /api/v1/auth/login`: `avatarReviewStatus` → `biometricReviewStatus`, `avatarRequired` → `biometricRequired`, `shouldShowAvatarPopup` → `shouldShowBiometricPopup`.
- Field `avatarUrl`: **giữ nguyên tên**, nhưng đổi nguồn — không còn tính từ `face_profiles`, chỉ đọc thẳng `users.avatar_url` (sau T07, field này chỉ được ghi bởi luồng avatar mới).
- Sửa raw SQL trong `auth` module (theo ADR-001, không refactor sang TypeORM) tương ứng.

## T05 — Rename luồng admin review (avatar → biometric) [✅ DONE 2026-07-29]

File cần đổi tên + nội dung (theo `plan.md` §5):
- `controllers/admin-avatar-review.controller.ts`
- `services/admin-avatar-review.service.ts` + `.spec.ts`
- `dto/avatar-submission-detail.dto.ts`
- `dto/avatar-submission-list-item.dto.ts`
- `dto/list-avatar-submissions-query.dto.ts`
- `dto/approve-avatar-submission-response.dto.ts`
- `dto/reject-avatar-submission.dto.ts`
- `dto/reject-avatar-submission-response.dto.ts`
- `dto/avatar-download-url-response.dto.ts`
- `filters/admin-avatar-review-http-exception.filter.ts`

Đổi endpoint path: `/admin/avatar-submissions*` → `/admin/biometric-submissions*` (giữ nguyên toàn bộ sub-path `/{id}`, `/{id}/download-url`, `/{id}/approve`, `/{id}/reject`).

Đổi error code: `AVATAR_SUBMISSION_NOT_FOUND` → `BIOMETRIC_SUBMISSION_NOT_FOUND`, `AVATAR_MEDIA_NOT_FOUND` → `BIOMETRIC_MEDIA_NOT_FOUND`, `AVATAR_SUBMISSION_NOT_PENDING` → `BIOMETRIC_SUBMISSION_NOT_PENDING`, `AVATAR_REJECTION_REASON_REQUIRED` → `BIOMETRIC_REJECTION_REASON_REQUIRED`, `AVATAR_REJECTION_REASON_TOO_LONG` → `BIOMETRIC_REJECTION_REASON_TOO_LONG`, `AVATAR_DOWNLOAD_URL_FAILED` → `BIOMETRIC_DOWNLOAD_URL_FAILED`, `AVATAR_REJECT_FAILED` → `BIOMETRIC_REJECT_FAILED`, `AVATAR_APPROVE_FAILED` → `BIOMETRIC_APPROVE_FAILED`, `INVALID_AVATAR_SUBMISSION_STATUS` → `INVALID_BIOMETRIC_SUBMISSION_STATUS`.

Đổi audit action: `avatar.approve` → `biometric.approve`, `avatar.reject` → `biometric.reject`, `avatar.download` → `biometric.download`.

Đổi notification type: `avatar_rejected` → `biometric_rejected`.

## T06 — Xoá auto-sync `users.avatar_url` khỏi approve (admin-biometric-review.service.ts) [✅ DONE 2026-07-29]

- Xoá bước "UPDATE users SET avatar_url = ..." khỏi transaction approve.
- Xoá `avatarUrlUpdated: true` khỏi `new_value_json` của audit `biometric.approve`.
- Cập nhật test tương ứng (không còn assert `users.avatar_url` thay đổi sau approve).

## T07 — Code mới: luồng avatar thật [✅ DONE 2026-07-29 — AvatarPhotoController/Service]

- Tạo `src/modules/accounts/controllers/avatar-photo.controller.ts`, `services/avatar-photo.service.ts`, `dto/update-avatar-photo.dto.ts`, `dto/avatar-photo-response.dto.ts` theo `plan.md` §7.
- Endpoint: `POST /api/v1/me/avatar`, permission `profile.avatar.update`.
- Tái dùng `utils/image-magic-bytes.util.ts` cho validate MIME.
- Viết test mới (`*.spec.ts`) cho controller + service.

## T08 — Sửa spec: `feat-admin-avatar-review-workflow/spec.md` [✅ DONE 2026-07-29]

Thực hiện SAU T01-T06 để nội dung spec khớp code thật:

1. Header: `Feature ID: ACCT-AVATAR-REVIEW-001` → `ACCT-BIOMETRIC-REVIEW-001`; `Feature Name` → "Admin Biometric Review Workflow".
2. Mục 1.1/1.2: đổi "avatar" → "sinh trắc học/biometric" ở các câu mô tả bối cảnh/mục tiêu (KHÔNG đổi các câu nhắc tới `users.avatar_url` — giữ nguyên tên cột).
3. Mục 2.2 Authorization Rules + 2.3: đổi toàn bộ endpoint path và permission code sang biometric (theo T05); **sửa OOS-005 tương ứng** — MANAGER được phép (đã sửa 1 phần trong đợt này, xem changelog file, cần đồng bộ nốt bảng Authorization Rules nếu thêm role MANAGER vào bảng role/permission ở mục 2.2).
4. Mục 3 (FR-001 → FR-039): đổi các FR liên quan endpoint/permission/error code sang biometric; **XOÁ hoặc sửa lại FR-006, FR-007, BR-AVATAR-URL, và bước 6 trong FR-027** (không còn update `users.avatar_url` khi approve — theo T06).
5. Mục 5 Data Model: bỏ dòng "`users` — Chứa `avatar_url` được update khi approve" khỏi bảng 5.1; cập nhật 5.4 audit payload (bỏ `avatarUrlUpdated`).
6. Mục 6 API Contract: đổi toàn bộ path/permission/error code.
7. Mục 7 Error Handling + Mục 8 Acceptance Criteria: đổi mã lỗi, xoá/sửa AC-002/AC-002b (không còn assert `users.avatar_url` update).
8. Mục 9.1/9.2 Out of Scope: xác nhận lại OOS-005 khớp thực tế.
9. Mục 10.3 permissions table: đổi `permission_code` sang biometric.
10. Mục 11 Dependencies: đổi tên feature liên quan.
11. Mục 13 Transaction: xoá bước 6 (update avatar_url) khỏi pseudocode approve transaction ở §13.1.
12. Thêm dòng changelog ở đầu file theo đúng format hiện có (RULE TỐI THƯỢNG 2 của AGENTS.md).

## T09 — Sửa spec: `feat-user-avatar-submission-reminder/spec.md` [✅ DONE 2026-07-29 — folder đã đổi tên thành `feat-user-biometric-submission-reminder` qua git mv]

1. Header: `Feature ID: ACCT-AVATAR-SUBMIT-001` → `ACCT-BIOMETRIC-SUBMIT-001`; tên feature đổi sang "Nhắc nhở và tự nộp ảnh sinh trắc học".
2. Mục 1 Feature Overview: làm rõ đây là dữ liệu **bắt buộc cho FaceGate**, không phải avatar hiển thị; thêm câu dẫn chiếu `feat-update-avatar-photo` là nơi quản lý avatar hiển thị (độc lập, không cần duyệt).
3. Mục 6 Business Rules: BR-002/BR-003 giữ nguyên tinh thần (không đụng `users.avatar_url`) nhưng đổi thuật ngữ "avatar" → "sinh trắc học" trong diễn giải; đổi field `avatarReviewStatus`/`avatarRequired`/`shouldShowAvatarPopup` → `biometricReviewStatus`/`biometricRequired`/`shouldShowBiometricPopup` xuyên suốt BR-004, BR-005, BR-006, BR-016.
4. Mục 7 FR: đổi endpoint/error code/field response theo T04.
5. Mục 8 API Contract: đổi `GET /api/v1/me/avatar-status` → `GET /api/v1/me/biometric-status`, `POST /api/v1/me/avatar-submission` → `POST /api/v1/me/biometric-submission`; đổi JSON response field.
6. Mục 8.3 Login response: đổi field, thêm ghi chú `avatarUrl` nay do `feat-update-avatar-photo` sở hữu.
7. Mục 10 Authorization: đổi `profile.avatar.read_status`/`profile.avatar.submit` → `profile.biometric.read_status`/`profile.biometric.submit`.
8. Mục 11 Error Handling: đổi mã lỗi theo T04.
9. Mục 12 Audit Logging: đổi `avatar.upload`/`avatar.reupload` → `biometric.upload`/`biometric.reupload`.
10. Mục 14 Acceptance Criteria: đổi field/endpoint trong toàn bộ AC.
11. Thêm dòng changelog đầu file.

## T10 — Sửa spec: `feat-meeting-face-provisioning/spec.md` [✅ DONE 2026-07-29]

1. Thêm Business Rule/FR mới: "Chỉ dùng portrait cho FaceGate provisioning khi `face_profiles.status = 'active'`; nếu `pending_review`/`rejected`/`disabled`/`revoked` thì SKIP giống như trường hợp không có portrait."
2. Thêm Acceptance Criteria: given face profile `pending_review` (không có profile `active` khác của cùng user) → provisioning phải skip, không upload ảnh.
3. Cập nhật đoạn mô tả `FaceProvisioningService.provisionMeeting` để phản ánh việc gọi `getActivePortraitBytes` thay vì `getPortraitBytes` (theo T03).
4. Thêm dòng changelog đầu file.

## T11 — Sửa spec: `feat-portrait-enrollment/spec.md` (FPE-001, UC-17) [✅ DONE 2026-07-29]

1. Cập nhật mục NC-1 (câu hỏi mở "status sau enroll → dùng ngay hay chờ duyệt — chốt ở B"): đánh dấu đã chốt = **chờ duyệt** (nhờ fix ở T03/T10), không còn là open question.
2. Không đổi tên feature/endpoint (đã đúng bản chất "portrait"/"face-profile" từ đầu).
3. Thêm dòng changelog đầu file.

## T12 — Kiểm tra hồi quy sau toàn bộ thay đổi [✅ DONE 2026-07-29 — build sạch, lint sạch (file mới/sửa), 104 unit test liên quan pass]

- `npm run lint`
- `npm run test` (tập trung `accounts`, `face-access`)
- `npm run build`
- Grep lại `avatar` trong `src/modules/accounts` và `src/modules/face-access` để đảm bảo không còn sót chỗ nào đáng lẽ phải đổi thành `biometric` nhưng bị bỏ quên (loại trừ những chỗ cố ý giữ nguyên: `users.avatar_url`, `avatar-photo.*`, `utils/image-magic-bytes.util.ts`, `utils/face-profile-code.util.ts`).
