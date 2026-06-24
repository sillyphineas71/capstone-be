# Feature Specification: Nhắc nhở và tự nộp ảnh đại diện/khuôn mặt (User Avatar Submission Reminder)

- **Feature ID**: ACCT-AVATAR-SUBMIT-001
- **Feature Name**: Nhắc nhở và tự nộp ảnh đại diện/khuôn mặt (phía user)
- **Module / Domain**: accounts (self-service profile)
- **Created Date**: 2026-06-24
- **Status**: Draft
- **Source Documents**:
  - `AGENTS.md` (Backend Agent Guide v1.1) — đọc toàn bộ trước khi viết spec theo RULE TỐI THƯỢNG 1.
  - `database_v3_2_compact_39_tables.md` — bảng `face_profiles` (mục 7), `media_files` (mục 33), `users` (mục 2), `audit_logs` (mục 39).
  - `docs/API_CONTRACT_v1.0_with_system_roles.md` — UC-17 "Đăng ký và liên kết dữ liệu khuôn mặt" (admin-driven, permission `account.face.register`), UC "Cập nhật thông tin cá nhân (self)" (permission `profile.update.self`).
  - `docs/spec_typeorm_aligned.md`, `docs/SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md` — đối chiếu mapping `face_profiles`/`media_files`/consent.
  - Code hiện tại: `src/modules/accounts/entities/face-profile.entity.ts`, `src/modules/accounts/services/face-profile.service.ts`, `src/modules/accounts/controllers/face-profile.controller.ts`, `src/modules/recording/entities/media-file.entity.ts`, `src/modules/auth/types/login.types.ts`, `src/modules/auth/presenters/login-response.presenter.ts`.
  - Feature liên quan đã thảo luận trước: `spec/features/live-meeting/feat-request-meeting-extension` (UC-IMM-02) — tham khảo convention viết Business Rules/API Contract/Out of Scope, không phải dependency nghiệp vụ trực tiếp.
  - Feature song song (do agent khác phụ trách, chỉ tham chiếu phụ thuộc): `feat-admin-avatar-review-workflow` (chưa tồn tại tại thời điểm viết spec này).

> **Gợi ý đặt tên folder feature**: tên `feat-user-avatar-submission-reminder` (đã dùng làm đường dẫn của file này) là phù hợp vì bao trùm đúng 2 hành vi cốt lõi của feature — "reminder" (popup nhắc theo trạng thái) và "submission" (user tự nộp/nộp lại ảnh). Một phương án thay thế cũng hợp lý nếu muốn nhấn mạnh tính "self-service" để phân biệt rõ hơn với UC-17 (admin-driven) là `feat-self-avatar-upload-and-reminder`. Khuyến nghị: giữ nguyên `feat-user-avatar-submission-reminder` như đã tạo, không đổi lại trừ khi team có convention khác.

---

## 📝 CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo spec lần đầu cho ACCT-AVATAR-SUBMIT-001 (Nhắc nhở và tự nộp ảnh đại diện/khuôn mặt) | Toàn bộ file |
| 2026-06-24 | Thống nhất model face_profiles theo submission: mỗi lần submit tạo row mới pending_review; old active giữ nguyên; approved user submit thay thế tạo row pending mới thay vì update row active; chuẩn hóa audit action avatar.upload/avatar.reupload; cập nhật BR-008, BR-009, BR-010, BR-012, FR-006, FR-009, FR-025, FR-DATA-002, FR-DATA-003, NFR-008, EC-003, mục 18.5, 18.6, 20.1 | BR-008, BR-009, BR-010, BR-012, FR-006, FR-009, FR-025, FR-DATA-002, FR-DATA-003, NFR-008, EC-003, mục 18.5, 18.6, 20.1 |
| 2026-06-24 | Giải quyết toàn bộ clarify pass (BL-01..03, AR-01..02, VL-01..02, DM-01..02, EH-01..02, SB-01..02): thêm avatar status resolution priority; consent_at chỉ ghi vào row mới; rule sinh profile_code dùng chung; permission seed qua migration idempotent; chỉ SYSTEM_ADMIN approve avatar; consentAccepted transform cho multipart; MIME validate bằng magic bytes; partial unique index ux_face_profiles_user_pending bắt buộc; pre-generate UUID + insert order media_files/face_profiles; best-effort cleanup Cloudinary orphan; validation/error precedence; auth dùng raw SQL không import AccountsService; popup không throttle | BR-004..006, BR-010, BR-011, BR-016, BR-PROFILE-CODE (mới), BR-REMINDER-FREQUENCY (mới), FR-001, FR-004..007, FR-011, FR-015, FR-017, mục 9, 10, 11 (thêm 11.2), 14 (AC-003, AC-003b mới, AC-006b, AC-008, AC-010, AC-010b mới, AC-015, AC-016/017 mới), 15 (EC-003..005, EC-007 mới), 16 (NFR-004, NFR-008, NFR-010), 17, 18 (banner, 18.2, 18.5, 18.6, 18.7 mới), 20 (thêm 20.4) |

---

## EARS Requirement Keywords

Functional Requirements trong spec này viết theo EARS. Keyword EARS giữ nguyên bằng tiếng Anh, nội dung nghiệp vụ viết bằng tiếng Việt.

| Keyword | Vai trò |
|---|---|
| `THE system SHALL` | Yêu cầu luôn đúng, không phụ thuộc event/state/option/error |
| `WHEN` | Trigger/event xảy ra tại một thời điểm |
| `WHILE` | Hành vi đúng trong suốt một trạng thái |
| `WHERE` | Yêu cầu chỉ áp dụng khi feature/capability/config tồn tại |
| `IF ... THEN` | Xử lý lỗi, ngoại lệ, điều kiện không mong muốn |

---

## 1. Feature Overview

Feature này phục vụ bước "chuẩn bị dữ liệu" cho khả năng nhận diện khuôn mặt trong tương lai của hệ thống Intelligent Meeting Lifecycle Management System, ở **phía user** (self-service). Feature gồm hai phần gắn chặt với nhau:

1. **Reminder**: Mỗi lần user đăng nhập, hệ thống tính toán trạng thái avatar/face profile hiện tại của chính user đó và trả về các field derived (`avatarReviewStatus`, `avatarRequired`, `shouldShowAvatarPopup`) để frontend quyết định có hiển thị popup nhắc nhở hay không. Popup chỉ mang tính nhắc nhở, không chặn user sử dụng hệ thống.
2. **Submission**: User tự upload ảnh đại diện/khuôn mặt của chính mình. Ảnh được lưu trên Cloudinary (MVP), backend tạo metadata trong `media_files` và tạo/cập nhật `face_profiles` với trạng thái `pending_review`.

Feature này **không** xử lý việc admin approve/reject — phần đó thuộc feature song song `feat-admin-avatar-review-workflow`. Feature này cũng **không** triển khai face recognition/embedding/AI pipeline thật, đúng theo giới hạn MVP của `AGENTS.md`.

---

## 2. Business Context

- Tổ chức cần một nguồn ảnh khuôn mặt đã được chuẩn hóa (qua quy trình admin duyệt) để phục vụ các tính năng nhận diện khuôn mặt sau này (điểm danh camera, Face Server). Nguồn ảnh "thô" ban đầu đến từ chính user tự nộp.
- Hiện tại hệ thống đã có UC-17 ("Đăng ký và liên kết dữ liệu khuôn mặt", `POST /api/v1/users/{userId}/face-profile`, permission `account.face.register`) — đây là luồng **admin-driven**: admin/manager chủ động enroll ảnh chân dung cho một user khác. Feature ACCT-AVATAR-SUBMIT-001 bổ sung luồng **self-driven** còn thiếu: chính user tự nộp ảnh của mình, không cần admin thực hiện hộ.
- Ghi nhận đối chiếu code hiện tại: bảng seed `seed_permissions.sql` đang gán `account.face.register` cho cả role `EMPLOYEE`, khác với `API_CONTRACT_v1.0_with_system_roles.md` (chỉ `BUSINESS_ADMIN`, `SYSTEM_ADMIN`). Đây là một sai khác code-vs-spec đã tồn tại từ trước, **không thuộc phạm vi sửa của feature này** (xem mục 20 — Open Questions). Feature này chủ động dùng permission code riêng (`profile.avatar.*`) để tránh phụ thuộc vào sự nhầm lẫn đó.
- Liên hệ với feature đã thảo luận trước "Yêu cầu gia hạn phiên họp" (UC-IMM-02): không có phụ thuộc dữ liệu trực tiếp, nhưng spec này áp dụng cùng convention đã thống nhất ở UC-IMM-02 — đọc policy/trạng thái từ bảng hiện có (không thêm bảng), tách rõ "submit request" (UC-IMM-02: Host submit) khỏi "xử lý/duyệt" (UC-IMM-02: Manager approve — feature khác), đúng cấu trúc mà ACCT-AVATAR-SUBMIT-001 đang áp dụng: tách "user submit avatar" (feature này) khỏi "admin approve/reject avatar" (`feat-admin-avatar-review-workflow`).

---

## 3. Scope / Out of Scope

### 3.1 Trong phạm vi (In Scope)

- API cho user xem trạng thái avatar/face profile của chính mình.
- API cho user tự upload/re-upload avatar.
- Tích hợp field derived vào response login hiện có.
- Validate file, consent, account status.
- Audit log cho hành vi upload/re-upload.
- Chuẩn hóa status model của `face_profiles` ở mức ứng dụng để hỗ trợ `pending_review`, `active`, `rejected`, `disabled`, `revoked`.

### 3.2 Ngoài phạm vi (Out of Scope) — xem chi tiết mục 17

- Admin approve/reject avatar (thuộc `feat-admin-avatar-review-workflow`).
- Notification khi reject (thuộc feature admin review).
- Face recognition thật, embedding/vector pipeline, gọi Face Server enrollment thật.
- Email notification.
- Chặn user sử dụng hệ thống khi chưa có avatar.
- Thay đổi RBAC ngoài 2 permission cần cho feature này.
- Lưu trạng thái "đã dismiss popup" ở backend (xử lý phía FE, theo phiên).

---

## 4. Actors

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Internal Employee (System Role `INTERNAL_USER`) | Self-service: xem trạng thái và tự nộp avatar của chính mình | `profile.avatar.read_status`, `profile.avatar.submit` |
| Manager (System Role `MANAGER`) | Tương tự Internal Employee, áp dụng cho chính tài khoản Manager | `profile.avatar.read_status`, `profile.avatar.submit` |
| Business Admin (System Role `BUSINESS_ADMIN`) | Tự quản lý avatar của chính mình giống mọi user khác (không phải hành vi quản trị) | `profile.avatar.read_status`, `profile.avatar.submit` |
| System Admin (System Role `SYSTEM_ADMIN`) | Tự quản lý avatar của chính mình; là actor duy nhất có quyền approve/reject ở feature khác (không thuộc scope này) | `profile.avatar.read_status`, `profile.avatar.submit` |

### 4.1 Actor Constraints

- Phải đăng nhập thành công (JWT access token hợp lệ).
- Chỉ thao tác trên dữ liệu avatar/face profile của **chính mình** — không có tham số `userId` truyền từ client; user id luôn lấy từ token.
- `users.account_status` phải `active` khi thực hiện hành vi ghi dữ liệu (submit); không áp dụng giới hạn này cho hành vi chỉ đọc (xem trạng thái).
- Tài khoản không được ở trạng thái soft-delete (`users.deleted_at IS NULL`).

---

## 5. User Stories

- **US-01**: Là một Internal Employee, tôi muốn được nhắc khi đăng nhập nếu tôi chưa nộp ảnh đại diện, để tôi biết cần bổ sung thông tin phục vụ nhận diện khuôn mặt sau này.
- **US-02**: Là một user bất kỳ, tôi muốn có thể tắt popup nhắc nhở và tiếp tục sử dụng hệ thống ngay, để công việc của tôi không bị gián đoạn.
- **US-03**: Là một user, tôi muốn tự upload ảnh đại diện của mình, để không phải chờ admin thực hiện hộ.
- **US-04**: Là một user đã nộp ảnh và đang chờ duyệt, tôi muốn không bị yêu cầu nộp lại mỗi lần đăng nhập, để tránh lặp lại công việc không cần thiết.
- **US-05**: Là một user bị admin từ chối ảnh đã nộp, tôi muốn được nhắc và cho phép nộp lại, để tôi có thể khắc phục.
- **US-06**: Là một user đã được approve, tôi muốn không còn thấy popup nhắc nữa, để xác nhận quy trình đã hoàn tất.

---

## 6. Business Rules

BR-001: Chỉ chính user (qua JWT) mới được xem/nộp avatar của bản thân; không hỗ trợ tham số target user khác trong feature này (khác với UC-17 admin-driven).

BR-002: Trạng thái avatar hiển thị cho user (`avatarReviewStatus`) được suy ra từ bản ghi `face_profiles` hiện tại của user, KHÔNG dùng `users.avatar_url` để xác định workflow status.

BR-003: `users.avatar_url` chỉ chứa avatar đã được admin approve. Feature này (submit mới) KHÔNG được set/update `users.avatar_url` trong bất kỳ trường hợp nào.

BR-004: **Avatar status resolution priority.** Vì một user có thể có NHIỀU row `face_profiles` theo lịch sử submission (mỗi lần submit tạo row mới — BR-008/BR-009), `avatarReviewStatus` PHẢI được tính theo đúng thứ tự ưu tiên sau, áp dụng trên TOÀN BỘ row `face_profiles` của user (KHÔNG dùng khái niệm "một row hiện hành" đơn lẻ):
  1. Nếu user có ÍT NHẤT một row `face_profiles` với `status = pending_review` và `deleted_at IS NULL` → `avatarReviewStatus = pending_review`.
  2. Ngược lại, nếu user có ÍT NHẤT một row `face_profiles` với `status = active` và `deleted_at IS NULL` → `avatarReviewStatus = approved`.
  3. Ngược lại, nếu row `face_profiles` gần nhất liên quan (xác định theo `last_updated_at`, hoặc `enrolled_at` khi `last_updated_at` null, giá trị lớn nhất; `deleted_at IS NULL`) có `status IN (rejected, disabled, revoked)` → `avatarReviewStatus = rejected`.
  4. Ngược lại (user không có bất kỳ row `face_profiles` hợp lệ nào) → `avatarReviewStatus = not_uploaded`.

  Thứ tự ưu tiên 1 → 2 → 3 → 4 là BẮT BUỘC và độc lập với thời điểm tạo row: `pending_review` LUÔN được ưu tiên cao nhất kể cả khi user đang có row `active` cũ, để frontend luôn hiển thị đúng "đang chờ duyệt" ngay khi user vừa nộp ảnh thay thế cho ảnh đã approve (xem AC-003, AC-006b). Tương tự, nếu user có cả row `pending_review` lẫn row `revoked`/`disabled`/`rejected` cũ thì vẫn trả `pending_review` (bước 1 thắng); nếu user có cả row `active` lẫn row `revoked` cũ (không có `pending_review`) thì trả `approved` (bước 2 thắng). Ý nghĩa nghiệp vụ của từng giá trị `face_profiles.status` xem mục 18.4.

BR-005: Popup chỉ hiển thị (`shouldShowAvatarPopup = true`) khi `avatarReviewStatus` — sau khi đã resolve theo đúng thứ tự ưu tiên ở BR-004 — là `not_uploaded` hoặc `rejected`. Khi `avatarReviewStatus` resolve ra `pending_review` hoặc `approved`, popup KHÔNG hiển thị, bất kể user có đồng thời các row `active`/`rejected`/`disabled`/`revoked` cũ nào khác.

BR-006: `avatarRequired = true` cho mọi `avatarReviewStatus` đã resolve (theo BR-004) khác `approved`; `avatarRequired = false` chỉ khi `avatarReviewStatus = approved`. Field này phản ánh "tổ chức yêu cầu user có avatar đã được duyệt", khác với `shouldShowAvatarPopup` (chỉ phản ánh "có nên làm gián đoạn UI bằng popup ngay bây giờ không").

BR-007: User ở trạng thái `pending_review` KHÔNG được phép submit avatar mới; API trả lỗi `AVATAR_ALREADY_PENDING_REVIEW` (409).

BR-008: User ở trạng thái `not_uploaded`, `rejected` (bao gồm mapping từ `disabled`/`revoked` theo BR-004) được phép submit; submission hợp lệ luôn tạo một bản ghi `face_profiles` mới với `status = pending_review`.

BR-009: User ở trạng thái `approved` (đang có row `face_profiles` với `status = active`) được phép submit ảnh thay thế (replacement). Submission hợp lệ tạo một bản ghi `face_profiles` **mới** với `status = pending_review` — KHÔNG cập nhật row `active` hiện tại sang `pending_review`. Row `active` cũ giữ nguyên `status = active` trong suốt thời gian ảnh mới đang chờ duyệt. `users.avatar_url` giữ nguyên ảnh cũ đã approve cho đến khi feature `feat-admin-avatar-review-workflow` approve ảnh mới và cập nhật `users.avatar_url`.

BR-010: Mỗi user chỉ có tối đa một bản ghi `face_profiles` có `status = pending_review` tại một thời điểm. Đây là ràng buộc BẮT BUỘC ở CẢ HAI tầng: (a) tầng ứng dụng — submission service kiểm tra và block (BR-007) trước khi tạo row mới; (b) tầng database — partial unique index `ux_face_profiles_user_pending` (mục 18.5), không còn là đề xuất tùy chọn mà là migration bắt buộc để chống race condition khi 2 request submit gửi gần như đồng thời (xem EC-003). Không dùng pattern upsert (cập nhật row cũ). Mỗi submission hợp lệ luôn là INSERT row mới theo đúng thứ tự ở mục 18.7.

BR-011: `consentAccepted` là bắt buộc cho mọi lần submit (mới hoặc nộp lại) và PHẢI được transform về boolean trước khi validate, vì request là `multipart/form-data` (mọi form field trên wire đều là string). Backend SHALL coi cả giá trị boolean `true` và string `"true"` là hợp lệ (transform thành `true`); mọi giá trị khác — `false`, `"false"`, thiếu field, `null`, `undefined`, `"1"`, `"yes"`, hoặc bất kỳ giá trị nào khác — đều bị reject với lỗi `AVATAR_CONSENT_REQUIRED`. Khi hợp lệ, hệ thống ghi `face_profiles.consent_at = now()` **chỉ trên row `face_profiles` MỚI vừa được tạo trong lần submit đó**; hệ thống KHÔNG cập nhật/ghi đè `consent_at` của bất kỳ row `face_profiles` cũ nào (active/rejected/disabled/revoked/pending_review khác đã tồn tại trước đó).

BR-PROFILE-CODE: Khi tạo row `face_profiles` mới (áp dụng cho cả self-service avatar submission của feature này VÀ UC-17 admin-driven face enrollment), hệ thống SHALL sinh `profile_code` bằng một generator dùng chung cho cả hai luồng (ví dụ `FaceProfileCodeGenerator`), KHÔNG tự tạo format riêng cho từng feature. Ghi chú đối chiếu code hiện tại: `FaceProfileService.enrollPortrait` (UC-17) hiện sinh `profile_code` bằng biểu thức inline `` `FP-${randomUUID().slice(0, 8)}` `` (8 ký tự hex đầu của UUID) — đây CHƯA phải một generator dùng chung/đã tách riêng. Do đó: nếu plan.md xác nhận tách được biểu thức này thành generator dùng chung trước khi triển khai, feature này SHALL reuse generator đó; nếu chưa tách được trong phạm vi MVP, feature này SHALL dùng format mặc định `FP-${UUID_WITHOUT_DASHES_UPPERCASE}` (ví dụ `FP-550E8400E29B41D4A716446655440000`), và plan.md phải ghi rõ rằng UC-17 hiện vẫn dùng format ngắn hơn — sự khác biệt format này không thuộc lỗi của feature này, cần team thống nhất lại riêng (xem mục 20.2).

BR-012: Mọi lần submit hợp lệ phải ghi `audit_logs`: `action_type = avatar.upload` khi user chưa từng có bất kỳ bản ghi `face_profiles` nào (lần đầu tiên hoàn toàn); `action_type = avatar.reupload` khi user đã có bản ghi `face_profiles` từ trước dù ở bất kỳ status nào (rejected/disabled/revoked/active → tạo row pending_review mới).

BR-013: Ảnh lưu trên Cloudinary trong MVP. Mapping vào `media_files` KHÔNG cần thêm cột/bảng mới: dùng `media_files.storage_provider = 'cloud_provider'` (giá trị đã có sẵn trong enum ứng dụng `StorageProvider`), `media_files.storage_key` lưu Cloudinary `public_id`, `media_files.file_url` lưu Cloudinary `secure_url`, các thông tin Cloudinary phụ khác (nếu cần) lưu trong `media_files.metadata_json`.

BR-014: `face_profiles.status` cần hỗ trợ thêm giá trị `rejected` ở mức ứng dụng (enum TypeScript `FaceProfileStatus` hiện tại chỉ có `active`, `pending_review`, `disabled`, `revoked`). Vì cột `status` là `varchar(30)` không có CHECK constraint ở DB, việc bổ sung `rejected` KHÔNG cần migration database, chỉ cần bổ sung giá trị enum ở tầng ứng dụng (ghi chú cho plan.md).

BR-015: Backend KHÔNG lưu trạng thái "user đã dismiss popup" — việc tắt popup là hành vi tạm thời phía frontend trong phạm vi phiên làm việc hiện tại; lần đăng nhập/làm mới dữ liệu tiếp theo, nếu trạng thái vẫn là `not_uploaded`/`rejected`, hệ thống vẫn trả `shouldShowAvatarPopup = true`.

BR-REMINDER-FREQUENCY: Trong MVP, backend KHÔNG throttle tần suất nhắc avatar. Nếu `avatarReviewStatus` (đã resolve theo BR-004) là `not_uploaded` hoặc `rejected`, `shouldShowAvatarPopup` SHALL là `true` trên MỌI response login và MỌI response `GET /api/v1/me/avatar-status`, không giới hạn số lần, không có cơ chế "nhắc lại sau X ngày". Trạng thái dismiss popup chỉ tồn tại phía frontend/trong phiên làm việc hiện tại và KHÔNG được backend lưu trữ (xem BR-015).

BR-016: Login response (auth module) phải bổ sung 3 field derived (`avatarReviewStatus`, `avatarRequired`, `shouldShowAvatarPopup`) tính theo đúng BR-004/005/006, nằm cùng cấp với field `avatarUrl` hiện có trong object `user` của response login. Theo ADR-001 (Hybrid Database Access Architecture, `docs/ARCHITECTURE_DECISIONS.md`), module `auth` là ngoại lệ có chủ đích dùng raw SQL qua `DataSource.query()` và KHÔNG được refactor sang TypeORM. Do đó: auth module SHALL tính `avatarReviewStatus` bằng parameterized raw SQL (đọc trực tiếp `face_profiles`/`users` qua `DataSource.query()` với tham số binding, áp dụng đúng logic ưu tiên BR-004) ngay trong `AuthModule`, và KHÔNG được import `AccountsService`, `FaceProfileService`, hay bất kỳ TypeORM Repository nào của `AccountsModule` vào `AuthModule`. Các endpoint self-service avatar khác của feature này (`GET /api/v1/me/avatar-status`, `POST /api/v1/me/avatar-submission`) thuộc module `accounts` và được phép dùng TypeORM Repository theo convention business module thông thường (đúng ADR-001).

---

## 7. Functional Requirements

### 7.1 Core (Ubiquitous) Requirements

```text
FR-001: THE system SHALL xác định avatarReviewStatus của một user bằng cách áp dụng thứ tự ưu tiên resolution (pending_review > active > rejected/disabled/revoked > không có row) trên TOÀN BỘ row face_profiles chưa soft-delete của user đó, theo BR-004 — KHÔNG dựa vào một row "hiện hành" duy nhất.
FR-002: THE system SHALL coi users.avatar_url là nguồn duy nhất cho ảnh đại diện đã approve, không dùng trường này để tính avatarReviewStatus.
FR-003: THE system SHALL giới hạn API xem/nộp avatar trong feature này chỉ áp dụng cho chính user đã xác thực (self), không nhận tham số userId từ client.
```

### 7.2 Event-driven Requirements

```text
FR-004: WHEN user đăng nhập thành công, THE system SHALL trả về avatarReviewStatus (resolve theo thứ tự ưu tiên BR-004 trên toàn bộ row face_profiles của user), avatarRequired và shouldShowAvatarPopup trong response login theo BR-016.
FR-005: WHEN user gửi yêu cầu GET avatar-status, THE system SHALL trả về avatarReviewStatus (resolve theo thứ tự ưu tiên BR-004 trên toàn bộ row face_profiles của user), avatarUrl, avatarRequired, shouldShowAvatarPopup và message tương ứng.
FR-006: WHEN user gửi yêu cầu submit avatar hợp lệ (file đúng MIME type theo magic bytes detection, đúng kích thước, consentAccepted transform về true theo BR-011, account active) và user chưa có bất kỳ row face_profiles nào đang ở status = pending_review, THE system SHALL lưu ảnh lên Cloudinary, tạo bản ghi media_files tương ứng, tạo bản ghi face_profiles MỚI với status = pending_review và consent_at = now() trên row mới đó (theo thứ tự pre-generate UUID + insert ở mục 18.7).
FR-007: WHEN submission thành công, THE system SHALL ghi audit log với action_type avatar.upload hoặc avatar.reupload theo BR-012.
```

### 7.3 State-driven Requirements

```text
FR-008: WHILE face_profiles.status của user là pending_review, THE system SHALL chặn việc tạo submission mới và chỉ cho phép hiển thị status notice (không phải popup yêu cầu upload lại).
FR-009: WHILE user có face_profiles row với status = active (approved), THE system SHALL cho phép user submit ảnh thay thế bằng cách tạo một face_profiles row MỚI với status = pending_review; row active hiện tại giữ nguyên status cho đến khi feature feat-admin-avatar-review-workflow approve ảnh mới và revoke row cũ; users.avatar_url giữ nguyên trong suốt thời gian ảnh mới đang pending.
FR-010: WHILE user chưa có bản ghi face_profiles hợp lệ, THE system SHALL trả avatarReviewStatus = not_uploaded và cho phép submit avatar mới.
```

### 7.4 Optional Feature Requirements

```text
FR-011: WHERE auth module hiện đọc dữ liệu user bằng raw SQL (ADR-001), THE system SHALL bổ sung phần đọc avatarReviewStatus bằng parameterized raw SQL theo đúng convention hiện có của module auth, KHÔNG import AccountsService/FaceProfileService/Repository vào AuthModule, và không refactor kiến trúc auth hiện tại (BR-016).
FR-012: WHERE media_files.storage_provider hỗ trợ giá trị cloud_provider có sẵn, THE system SHALL sử dụng giá trị này cho mọi file avatar lưu trên Cloudinary, không bổ sung giá trị enum mới cho storage_provider.
```

### 7.5 Unwanted Behavior Requirements

```text
FR-013: IF user gửi submission khi đang ở trạng thái pending_review, THEN THE system SHALL từ chối với lỗi AVATAR_ALREADY_PENDING_REVIEW và không thay đổi dữ liệu.
FR-014: IF file ảnh không được gửi kèm, THEN THE system SHALL từ chối với lỗi AVATAR_FILE_REQUIRED.
FR-015: IF MIME type thực tế của file — xác định bằng magic bytes detection trên buffer file, KHÔNG chỉ tin vào file.mimetype của Multer hay extension do client khai báo — không thuộc danh sách cho phép (image/jpeg, image/png, image/webp), THEN THE system SHALL từ chối với lỗi AVATAR_FILE_TYPE_INVALID.
FR-016: IF file ảnh vượt quá 5MB, THEN THE system SHALL từ chối với lỗi AVATAR_FILE_TOO_LARGE.
FR-017: IF consentAccepted sau khi transform theo BR-011 (chấp nhận boolean true hoặc string "true") không phải true — bao gồm false, "false", thiếu field, null, undefined, hoặc bất kỳ giá trị khác — THEN THE system SHALL từ chối với lỗi AVATAR_CONSENT_REQUIRED và không lưu file.
FR-018: IF users.account_status của user hiện tại không phải active, THEN THE system SHALL từ chối submission với lỗi ACCOUNT_NOT_ACTIVE.
FR-019: IF việc lưu ảnh lên Cloudinary thất bại, THEN THE system SHALL không tạo bản ghi media_files/face_profiles và trả lỗi AVATAR_STORAGE_FAILED.
FR-020: IF có lỗi không xác định trong quá trình xử lý submission sau khi ảnh đã lưu thành công lên Cloudinary, THEN THE system SHALL trả lỗi AVATAR_UPLOAD_FAILED và không để dữ liệu face_profiles ở trạng thái không nhất quán (dùng transaction).
```

### 7.6 Authorization Requirements

```text
FR-021: IF user chưa đăng nhập (thiếu/invalid JWT), THEN THE system SHALL trả lỗi authentication (401 UNAUTHORIZED) cho cả hai endpoint của feature này.
FR-022: IF user không có permission profile.avatar.read_status, THEN THE system SHALL từ chối truy cập endpoint xem trạng thái avatar.
FR-023: IF user không có permission profile.avatar.submit, THEN THE system SHALL từ chối truy cập endpoint submit avatar và không thay đổi dữ liệu.
```

### 7.7 Data & Audit Requirements

```text
FR-024: WHEN face_profiles được tạo mới do submission (bao gồm cả submission đầu tiên và submission thay thế ảnh đã approved), THE system SHALL lưu profile_code duy nhất, user_id, status = pending_review, primary_image_file_id, consent_at, enrolled_at = now().
FR-025: WHEN submission hợp lệ xảy ra, THE system SHALL luôn tạo bản ghi face_profiles MỚI với status = pending_review; không cập nhật bất kỳ row face_profiles nào đang tồn tại sang pending_review.
FR-026: THE system SHALL không xóa hoặc làm thay đổi bản ghi media_files của lần submit trước khi lần submit mới đó thất bại.
```

### 7.8 Requirement Traceability

| Requirement ID | EARS Pattern | Nguồn / Business Rule liên quan |
|---|---|---|
| FR-001..003 | Ubiquitous | BR-002, BR-004 |
| FR-004..007 | Event-driven | BR-005, BR-006, BR-012, BR-016 |
| FR-008..010 | State-driven | BR-005, BR-007, BR-009 |
| FR-011..012 | Optional Feature | BR-013, BR-016 |
| FR-013..020 | Unwanted Behavior | BR-007, BR-011, BR-013, mục 9 Validation |
| FR-021..023 | Authorization | Mục 10 |
| FR-024..026 | Data & Audit | BR-010, BR-012 |

---

## 8. API Contract Draft

### 8.1 `GET /api/v1/me/avatar-status`

| Field | Value |
|---|---|
| Method | `GET` |
| Endpoint | `/api/v1/me/avatar-status` |
| Permission | `profile.avatar.read_status` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Auth | JWT access token (self, không nhận `userId` param) |
| Async | No |

**Response 200 — ví dụ `not_uploaded`:**
```json
{
  "success": true,
  "data": {
    "avatarReviewStatus": "not_uploaded",
    "avatarUrl": null,
    "avatarRequired": true,
    "shouldShowAvatarPopup": true,
    "message": "Bạn cần cập nhật ảnh đại diện để phục vụ nhận diện khuôn mặt."
  }
}
```

**Response 200 — ví dụ `pending_review`:**
```json
{
  "success": true,
  "data": {
    "avatarReviewStatus": "pending_review",
    "avatarUrl": null,
    "avatarRequired": true,
    "shouldShowAvatarPopup": false,
    "message": "Ảnh đại diện của bạn đang chờ quản trị viên duyệt."
  }
}
```

**Response 200 — ví dụ `rejected`:**
```json
{
  "success": true,
  "data": {
    "avatarReviewStatus": "rejected",
    "avatarUrl": null,
    "avatarRequired": true,
    "shouldShowAvatarPopup": true,
    "message": "Ảnh đại diện trước đó đã bị từ chối. Vui lòng nộp lại ảnh khác."
  }
}
```

**Response 200 — ví dụ `approved`:**
```json
{
  "success": true,
  "data": {
    "avatarReviewStatus": "approved",
    "avatarUrl": "https://res.cloudinary.com/.../avatar.jpg",
    "avatarRequired": false,
    "shouldShowAvatarPopup": false,
    "message": "Ảnh đại diện của bạn đã được duyệt."
  }
}
```

### 8.2 `POST /api/v1/me/avatar-submission`

| Field | Value |
|---|---|
| Method | `POST` |
| Endpoint | `/api/v1/me/avatar-submission` |
| Content-Type | `multipart/form-data` |
| Permission | `profile.avatar.submit` |
| System Role | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| Auth | JWT access token (self, không nhận `userId` param) |
| Async | No |

**Request Body (multipart/form-data):**
| Field | Type | Bắt buộc | Mô tả |
|---|---|---|---|
| `file` | binary (image) | Có | Ảnh đại diện/khuôn mặt, jpg/jpeg/png/webp (xác thực bằng magic bytes — VL-02), tối đa 5MB |
| `consentAccepted` | boolean hoặc string (vì multipart/form-data) | Có | Phải transform được thành `true`: chấp nhận boolean `true` hoặc string `"true"`; mọi giá trị khác bị reject (BR-011, VL-01) |

**Response 201 — submit thành công:**
```json
{
  "success": true,
  "data": {
    "faceProfileId": "uuid",
    "avatarReviewStatus": "pending_review",
    "submittedAt": "2026-06-24T10:00:00+07:00"
  }
}
```

**Response lỗi — ví dụ đang pending_review (409):**
```json
{
  "success": false,
  "message": "Ảnh đại diện của bạn đang chờ duyệt, vui lòng đợi kết quả trước khi nộp ảnh khác.",
  "error": {
    "code": "AVATAR_ALREADY_PENDING_REVIEW",
    "details": {}
  },
  "timestamp": "2026-06-24T10:00:00+07:00",
  "path": "/api/v1/me/avatar-submission"
}
```

### 8.3 Login response — bổ sung field derived

Theo BR-016, response của `POST /api/v1/auth/login` (cấu trúc `LoginSuccessData.user`) bổ sung 3 field cùng cấp với `avatarUrl` hiện có:

```json
{
  "success": true,
  "data": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresIn": 900,
    "user": {
      "id": "uuid",
      "email": "user@company.com",
      "fullName": "Nguyễn Văn A",
      "avatarUrl": null,
      "avatarReviewStatus": "not_uploaded",
      "avatarRequired": true,
      "shouldShowAvatarPopup": true,
      "departmentId": "uuid",
      "roles": ["INTERNAL_USER"],
      "permissions": ["..."]
    }
  }
}
```

---

## 9. Validation Rules

| Rule | Mô tả |
|---|---|
| File bắt buộc | Request submit phải có field `file`, không rỗng |
| MIME type | Chỉ nhận `image/jpeg`, `image/png`, `image/webp`. `file.mimetype` của Multer và extension MAY được dùng để reject sớm (fail-fast), nhưng validation cuối cùng PHẢI dùng **magic bytes detection** (ví dụ thư viện `file-type` hoặc tương đương) đọc trực tiếp buffer file — không tin tưởng tuyệt đối vào mimetype/extension client khai báo |
| Kích thước file | Tối đa 5MB (5 * 1024 * 1024 bytes) |
| Consent | Vì request là `multipart/form-data`, backend SHALL transform `consentAccepted` trước khi validate: chấp nhận boolean `true` hoặc string `"true"`; mọi giá trị khác (`false`, `"false"`, thiếu field, `null`, `undefined`, `"1"`, `"yes"`, ...) đều bị reject với `AVATAR_CONSENT_REQUIRED` (BR-011) |
| Account status | `users.account_status = active` mới được submit; không áp dụng cho GET avatar-status |
| Soft-delete | `users.deleted_at IS NULL` mới được submit |
| Không log raw file | Không log nội dung binary của file trong log/audit |
| Không lưu binary vào DB | Ảnh không lưu trực tiếp vào PostgreSQL, chỉ lưu metadata trong `media_files` |
| Trạng thái hiện tại | Không cho submit mới khi user đang có bất kỳ row `face_profiles.status = pending_review` nào (BR-007, BR-010) |
| Thứ tự kiểm tra | Các validation trên được áp dụng theo đúng thứ tự deterministic ở mục 11.2 (Validation/Error Precedence) |

Spec này KHÔNG yêu cầu auto-detect khuôn mặt trong ảnh ở bước submit; chất lượng ảnh (có khuôn mặt rõ, đúng người...) do System Administrator đánh giá thủ công ở feature admin review.

---

## 10. Authorization & Permissions

| Permission Code | Module Code | Mô tả | System Role được cấp |
|---|---|---|---|
| `profile.avatar.read_status` | `accounts` | Xem trạng thái avatar/face profile của chính mình | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |
| `profile.avatar.submit` | `accounts` | Tự nộp/nộp lại avatar của chính mình | `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` |

Ghi chú:
- Hai permission trên độc lập với `account.face.register` (UC-17, admin-driven) — không tái sử dụng permission đó để tránh nhập nhằng giữa hành vi "admin enroll hộ user khác" và "user tự nộp cho chính mình".
- `module_code = accounts` để khớp `MODULE_CODE_ALLOWLIST` hiện có trong code (`profile` không có trong allowlist này); `permission_code` vẫn dùng tiền tố `profile.` để nhất quán với permission đã có `profile.update.self`.
- Cả hai endpoint đều bắt buộc xác thực JWT trước khi kiểm tra permission (FR-021).
- **Nguồn triển khai permission seed (bắt buộc)**: hai permission `profile.avatar.read_status` và `profile.avatar.submit` SHALL được tạo bằng một TypeORM seed/migration **idempotent**, theo đúng pattern đã có sẵn trong `src/database/seeds/*SeedXxxPermission*.ts` (ví dụ `20260623000001-SeedMeetingRequestReadPermission.ts`): `INSERT INTO permissions (...) VALUES (...) ON CONFLICT (permission_code) DO NOTHING RETURNING id`, sau đó với mỗi role trong `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` thực hiện `INSERT INTO role_permissions (...) VALUES (...) ON CONFLICT (role_id, permission_id) DO NOTHING`. KHÔNG insert mù gây duplicate. File `seed_permissions.sql` ở root repo (nếu có) chỉ hỗ trợ dev/test cục bộ, KHÔNG phải nguồn triển khai chính thức thay cho migration/seed này.

---

## 11. Error Handling

| HTTP Status | Error Code | Mô tả |
|---:|---|---|
| 400 | `AVATAR_FILE_REQUIRED` | Thiếu file ảnh trong request |
| 400 | `AVATAR_FILE_TOO_LARGE` | File vượt quá 5MB |
| 400 | `AVATAR_FILE_TYPE_INVALID` | MIME type không hợp lệ (xác định bằng magic bytes detection, không chỉ dựa vào mimetype/extension client khai báo) |
| 400 | `AVATAR_CONSENT_REQUIRED` | `consentAccepted` không phải `true` |
| 401 | `UNAUTHORIZED` | Chưa đăng nhập / token không hợp lệ |
| 403 | `FORBIDDEN` | Không có permission cần thiết |
| 403 | `ACCOUNT_NOT_ACTIVE` | Tài khoản không ở trạng thái active |
| 404 | `USER_NOT_FOUND` | Không tìm thấy user tương ứng với token (trường hợp dữ liệu bất thường) |
| 409 | `AVATAR_ALREADY_PENDING_REVIEW` | Đang có submission chờ duyệt |
| 502 | `AVATAR_STORAGE_FAILED` | Lưu ảnh lên Cloudinary thất bại |
| 500 | `AVATAR_UPLOAD_FAILED` | Lỗi xử lý submission sau khi đã lưu ảnh thành công |

**Cấu trúc response lỗi** (theo `AGENTS.md` §8.2):
```json
{
  "success": false,
  "message": "string",
  "error": { "code": "string", "details": {} },
  "timestamp": "ISO-8601",
  "path": "/api/v1/me/avatar-submission"
}
```

### 11.1 Error Requirements (EARS)

```text
ERR-001: IF request submit thiếu file, THEN THE system SHALL trả 400 AVATAR_FILE_REQUIRED.
ERR-002: IF file vượt quá 5MB, THEN THE system SHALL trả 400 AVATAR_FILE_TOO_LARGE.
ERR-003: IF MIME type không thuộc jpg/jpeg/png/webp, THEN THE system SHALL trả 400 AVATAR_FILE_TYPE_INVALID.
ERR-004: IF consentAccepted không phải true, THEN THE system SHALL trả 400 AVATAR_CONSENT_REQUIRED.
ERR-005: IF user chưa đăng nhập, THEN THE system SHALL trả 401 UNAUTHORIZED.
ERR-006: IF user không có permission tương ứng, THEN THE system SHALL trả 403 FORBIDDEN.
ERR-007: IF account_status khác active khi submit, THEN THE system SHALL trả 403 ACCOUNT_NOT_ACTIVE.
ERR-008: IF face_profiles.status hiện tại là pending_review khi submit, THEN THE system SHALL trả 409 AVATAR_ALREADY_PENDING_REVIEW.
ERR-009: IF lưu file lên Cloudinary thất bại, THEN THE system SHALL trả 502 AVATAR_STORAGE_FAILED và không tạo media_files/face_profiles.
ERR-010: IF có lỗi server không xác định sau khi ảnh đã lưu thành công, THEN THE system SHALL trả 500 AVATAR_UPLOAD_FAILED và rollback toàn bộ thay đổi face_profiles/media_files của lần submit đó.
```

### 11.2 Validation / Error Precedence

Để đảm bảo các test case có nhiều lỗi xảy ra đồng thời vẫn cho kết quả deterministic, `POST /api/v1/me/avatar-submission` PHẢI kiểm tra theo đúng thứ tự sau, dừng ngay tại bước đầu tiên phát hiện lỗi:

1. Auth guard → 401 `UNAUTHORIZED` nếu chưa đăng nhập / token không hợp lệ.
2. Permission guard → 403 `FORBIDDEN` nếu thiếu permission `profile.avatar.submit`.
3. Load current user từ token → 404 `USER_NOT_FOUND` nếu dữ liệu user bất thường (token hợp lệ nhưng user tương ứng không còn tồn tại).
4. Account status check → 403 `ACCOUNT_NOT_ACTIVE` nếu `users.account_status != active` hoặc `users.deleted_at IS NOT NULL`.
5. Multipart/file presence → 400 `AVATAR_FILE_REQUIRED` nếu thiếu field `file`.
6. File size → 400 `AVATAR_FILE_TOO_LARGE` nếu vượt quá 5MB.
7. Magic bytes MIME validation → 400 `AVATAR_FILE_TYPE_INVALID` nếu không phải image/jpeg, image/png, image/webp (mục 9, VL-02).
8. `consentAccepted` transform + validate → 400 `AVATAR_CONSENT_REQUIRED` nếu không hợp lệ sau transform (BR-011, VL-01).
9. Pending-review check → 409 `AVATAR_ALREADY_PENDING_REVIEW` nếu user đã có row `face_profiles.status = pending_review` (BR-007, BR-010).
10. Storage upload (Cloudinary) / DB transaction → theo đúng thứ tự pre-generate UUID + insert ở mục 18.7; lỗi ở bước này trả `AVATAR_STORAGE_FAILED` (502) hoặc `AVATAR_UPLOAD_FAILED` (500) tùy giai đoạn thất bại, kèm best-effort cleanup theo EC-004.

`GET /api/v1/me/avatar-status` chỉ áp dụng bước 1–3 ở trên (không có bước 4–10 vì là hành vi chỉ đọc, không ghi dữ liệu — xem EC-006).

---

## 12. Audit Logging

| Action Type | Entity Type | Khi nào ghi | Nội dung tối thiểu |
|---|---|---|---|
| `avatar.upload` | `face_profile` | Submission thành công lần đầu (chưa từng có `face_profiles` row) | `user_id` (actor = chính user), `entity_id = face_profiles.id`, `new_value_json = { status: 'pending_review', mediaFileId }` |
| `avatar.reupload` | `face_profile` | Submission thành công khi đã có `face_profiles` row từ trước (rejected/disabled/revoked/active → pending_review) | `user_id`, `entity_id = face_profiles.id`, `old_value_json = { status: <trạng thái trước> }`, `new_value_json = { status: 'pending_review', mediaFileId }` |

Quy tắc:
- Không ghi nội dung binary file vào audit log.
- Không ghi audit log cho hành vi GET avatar-status (chỉ đọc, không phải hành vi ghi/security/admin/export theo quy ước audit của `AGENTS.md` §17).
- Audit log ghi sau khi transaction submission commit thành công; nếu submission thất bại thì không ghi `avatar.upload`/`avatar.reupload` (có thể ghi log lỗi hệ thống riêng nếu cần, không thuộc audit nghiệp vụ).

---

## 13. Notification Impact

Feature này **không** tự gửi notification nào (không tạo bản ghi `notifications`, không gọi `NotificationsService`/BullMQ/`MailService`). Lý do:
- Reminder ở feature này là **derived data hiển thị trong response** (login response + GET avatar-status), không phải notification asynchronous.
- Notification khi avatar bị reject thuộc trách nhiệm của `feat-admin-avatar-review-workflow` (do hành động reject xảy ra ở feature đó).

Nếu sau này cần thêm in-app notification khi user nộp ảnh thành công (ví dụ thông báo "đã nhận ảnh, đang chờ duyệt"), đó là mở rộng ngoài phạm vi MVP của spec này (xem mục 17).

---

## 14. Acceptance Criteria

### 14.1 Happy Path

```text
AC-001:
Given user chưa từng có bản ghi face_profiles,
When user đăng nhập,
Then response login trả avatarReviewStatus = "not_uploaded", avatarRequired = true, shouldShowAvatarPopup = true.

AC-002:
Given user ở trạng thái not_uploaded,
When user gọi POST /api/v1/me/avatar-submission với file hợp lệ và consentAccepted = true,
Then the system trả 201, tạo media_files mới, tạo face_profiles với status = pending_review, không cập nhật users.avatar_url, và ghi audit log action_type = avatar.upload.

AC-003:
Given user có đồng thời 1 row face_profiles với status = active VÀ 1 row face_profiles với status = pending_review (ví dụ: user đã được approve trước đó, sau đó submit ảnh thay thế),
When user gọi GET /api/v1/me/avatar-status,
Then the system áp dụng thứ tự ưu tiên BR-004 và trả avatarReviewStatus = "pending_review" (KHÔNG phải "approved"), shouldShowAvatarPopup = false, avatarRequired = true.

AC-003b:
Given user chỉ có 1 row face_profiles với status = pending_review (không có row active/rejected/disabled/revoked nào khác),
When user gọi GET /api/v1/me/avatar-status,
Then the system trả avatarReviewStatus = "pending_review", shouldShowAvatarPopup = false, avatarRequired = true.

AC-004:
Given user đang ở trạng thái rejected,
When user đăng nhập,
Then the system trả avatarReviewStatus = "rejected", shouldShowAvatarPopup = true.

AC-005:
Given user đang ở trạng thái rejected (có row face_profiles với status = rejected),
When user gọi POST /api/v1/me/avatar-submission với file hợp lệ,
Then the system tạo một row face_profiles MỚI với status = pending_review, trả 201, và ghi audit log action_type = avatar.reupload.
  And row face_profiles cũ (status = rejected) giữ nguyên, không bị cập nhật.

AC-006:
Given user đang ở trạng thái approved (có row face_profiles với status = active),
When user đăng nhập,
Then the system trả avatarReviewStatus = "approved", avatarRequired = false, shouldShowAvatarPopup = false, avatarUrl khác null (lấy từ users.avatar_url).

AC-006b:
Given user đang ở trạng thái approved (có row face_profiles với status = active),
When user gọi POST /api/v1/me/avatar-submission với file hợp lệ (ảnh thay thế),
Then the system tạo một row face_profiles MỚI với status = pending_review, trả 201, và ghi audit log action_type = avatar.reupload.
  And row face_profiles cũ (status = active) giữ nguyên, users.avatar_url không thay đổi.
  And khi user gọi tiếp GET /api/v1/me/avatar-status ngay sau đó, the system trả avatarReviewStatus = "pending_review" theo thứ tự ưu tiên BR-004 (xem AC-003), KHÔNG trả "approved".
```

### 14.2 Validation Cases

```text
AC-007:
Given user gửi submission không kèm file,
When request được xử lý,
Then the system trả 400 AVATAR_FILE_REQUIRED.

AC-008:
Given user gửi file mà extension/Content-Type khai báo là ảnh (ví dụ đặt tên "photo.jpg" hoặc khai Content-Type "image/jpeg") nhưng magic bytes thực tế của file không phải image hợp lệ (ví dụ file .pdf hoặc .exe đổi tên thành .jpg),
When request được xử lý,
Then the system phát hiện qua magic bytes detection (không tin vào extension/Content-Type khai báo) và trả 400 AVATAR_FILE_TYPE_INVALID.

AC-009:
Given user gửi file 8MB,
When request được xử lý,
Then the system trả 400 AVATAR_FILE_TOO_LARGE.

AC-010:
Given user gửi consentAccepted = false (hoặc string "false", hoặc thiếu field consentAccepted),
When request được xử lý,
Then the system trả 400 AVATAR_CONSENT_REQUIRED và không lưu file lên Cloudinary.

AC-010b:
Given user gửi consentAccepted = "true" (string, vì request là multipart/form-data),
When request được xử lý,
Then the system transform giá trị này thành boolean true theo BR-011 và coi là hợp lệ (KHÔNG reject vì lý do "string thay vì boolean").
```

### 14.3 Authorization Cases

```text
AC-011:
Given user chưa đăng nhập,
When gọi GET /api/v1/me/avatar-status hoặc POST /api/v1/me/avatar-submission,
Then the system trả 401 UNAUTHORIZED.

AC-012:
Given user đã đăng nhập nhưng không có permission profile.avatar.submit,
When user gọi POST /api/v1/me/avatar-submission,
Then the system trả 403 FORBIDDEN và không tạo dữ liệu.
```

### 14.4 Business Rule Cases

```text
AC-013:
Given user đang ở trạng thái pending_review,
When user gọi POST /api/v1/me/avatar-submission,
Then the system trả 409 AVATAR_ALREADY_PENDING_REVIEW và không thay đổi face_profiles/media_files hiện có.

AC-014:
Given users.account_status khác active,
When user gọi POST /api/v1/me/avatar-submission,
Then the system trả 403 ACCOUNT_NOT_ACTIVE.
```

### 14.5 Schema / Migration Footprint Case

```text
AC-015:
Given feature này được triển khai,
When kiểm tra migration được tạo,
Then không có bảng database mới nào được tạo,
  And có 1 migration DDL nhỏ tạo partial unique index ux_face_profiles_user_pending nếu index chưa tồn tại (CREATE UNIQUE INDEX IF NOT EXISTS ... — DM-01, mục 18.5),
  And có 1 seed/migration idempotent tạo 2 permission profile.avatar.read_status và profile.avatar.submit, gán cho INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN qua role_permissions theo pattern src/database/seeds/*SeedXxxPermission*.ts hiện có (AR-01),
  And app enum FaceProfileStatus (TypeScript) bổ sung giá trị rejected, KHÔNG cần migration DDL riêng cho việc này vì cột face_profiles.status là varchar(30) không có CHECK constraint ở DB (BR-014).
```

### 14.6 Disabled / Revoked Mapping Cases

```text
AC-016:
Given user không có row face_profiles nào ở status = pending_review hoặc status = active,
  And row face_profiles gần nhất liên quan (theo BR-004 bước 3) có status = disabled,
When user gọi GET /api/v1/me/avatar-status,
Then the system trả avatarReviewStatus = "rejected",
  And shouldShowAvatarPopup = true,
  And message sử dụng wording trung tính: "Ảnh/hồ sơ khuôn mặt hiện tại không còn hợp lệ. Vui lòng upload lại ảnh khác." (không nói rõ là bị admin reject hay bị disable).

AC-017:
Given user không có row face_profiles nào ở status = pending_review hoặc status = active,
  And row face_profiles gần nhất liên quan (theo BR-004 bước 3) có status = revoked,
When user gọi GET /api/v1/me/avatar-status,
Then the system trả avatarReviewStatus = "rejected",
  And shouldShowAvatarPopup = true,
  And message sử dụng wording trung tính tương tự AC-016, không tiết lộ chi tiết nội bộ lý do revoke.
```

Ghi chú (nhắc lại BR-004): nếu user có CẢ row `active` LẪN row `revoked`/`disabled` cũ (không có `pending_review`) → ưu tiên bước 2 thắng, trả `approved` (không phải `rejected`). Nếu user có CẢ row `pending_review` LẪN row `revoked`/`disabled` cũ → ưu tiên bước 1 thắng, trả `pending_review`.

### 14.7 Acceptance Criteria Traceability

| AC ID | Requirement/BR liên quan |
|---|---|
| AC-001 | FR-004, BR-004, BR-005, BR-006 |
| AC-002 | FR-006, FR-007, BR-003, BR-012 |
| AC-003, AC-003b | FR-001, FR-005, BR-004, BR-005 |
| AC-004 | FR-004, BR-004 |
| AC-005 | FR-006, BR-008, BR-012 |
| AC-006 | FR-004, BR-006 |
| AC-006b | FR-006, FR-009, BR-004, BR-009 |
| AC-007, AC-009 | FR-014, FR-016, ERR-001, ERR-002 |
| AC-008 | FR-015, ERR-003 (magic bytes — VL-02) |
| AC-010, AC-010b | FR-017, ERR-004, BR-011 (consent transform — VL-01) |
| AC-011..012 | FR-021..023, ERR-005, ERR-006 |
| AC-013 | FR-013, BR-007, BR-010, ERR-008 |
| AC-014 | FR-018, ERR-007 |
| AC-015 | BR-010, BR-013, BR-014, mục 18.5 (DM-01), mục 10 (AR-01) |
| AC-016, AC-017 | BR-004, mục 18.4 |

---

## 15. Edge Cases

EC-001: User vừa được admin approve avatar trong khi access token hiện tại được phát hành trước thời điểm approve → field derived trong JWT/login response cũ KHÔNG tự refresh; FE cần gọi lại `GET /api/v1/me/avatar-status` hoặc chờ lần login kế tiếp để thấy `approved`. Feature này không triển khai cơ chế push realtime cho riêng trường hợp này.

EC-002: `users.avatar_url` đã có giá trị cũ (dữ liệu legacy) nhưng user chưa từng có bản ghi `face_profiles` → `avatarReviewStatus = not_uploaded` theo BR-004 (ưu tiên tuyệt đối theo `face_profiles`), bất kể `users.avatar_url` đang khác null. Hệ thống vẫn trả `avatarUrl` đúng giá trị hiện có của `users.avatar_url` trong response GET avatar-status, nhưng `avatarReviewStatus`/`shouldShowAvatarPopup` không bị ảnh hưởng bởi giá trị này.

EC-003: Hai request submit gửi gần như đồng thời từ cùng một user (double-click hoặc retry) → service phải đảm bảo không tạo 2 bản ghi `face_profiles` có `status = pending_review` cho cùng `user_id`. Đây được đảm bảo ở CẢ HAI tầng (BR-010): tầng ứng dụng kiểm tra trước khi insert, VÀ tầng database bằng partial unique index `ux_face_profiles_user_pending` (BẮT BUỘC, không phải đề xuất — mục 18.5) làm lưới an toàn cuối cùng. Nếu request thứ hai đến sau khi request thứ nhất đã tạo row `pending_review` thành công (đã commit), request thứ hai bị chặn ở bước kiểm tra ứng dụng (BR-007) và trả lỗi `AVATAR_ALREADY_PENDING_REVIEW` (409). Nếu cả hai request "lọt" qua kiểm tra ứng dụng gần như đồng thời (race condition thật), request INSERT thứ hai vi phạm unique index ở tầng DB; service PHẢI bắt lỗi unique violation đó và dịch sang response `409 AVATAR_ALREADY_PENDING_REVIEW` giống như BR-007 (không để lộ lỗi DB thô/500 ra client).

EC-004: Cloudinary upload thành công nhưng bước ghi `media_files`/`face_profiles` thất bại (lỗi DB) → best-effort cleanup theo EH-01: (1) rollback DB transaction; (2) ngay lập tức gọi Cloudinary API để xóa object vừa upload theo `public_id` đã pre-generate (mục 18.7); (3) nếu cleanup thành công, log mức `info`; (4) nếu cleanup thất bại, log mức `warning`/`error` kèm `public_id` và `request_id` để tra cứu/dọn dẹp thủ công sau; (5) response trả về cho client vẫn là `AVATAR_UPLOAD_FAILED` (500) bất kể cleanup thành công hay không; (6) MVP KHÔNG bắt buộc tạo background job tự động quét/dọn orphan file định kỳ — đây có thể là future improvement (xem mục 19.2).

EC-005: User gửi `consentAccepted` hợp lệ (true hoặc "true") ở lần submit thứ N sau khi đã từng consent ở (các) lần submit trước → vì mỗi submission tạo một row `face_profiles` MỚI (BR-008/BR-009/BR-010), `consent_at` của lần submit thứ N được ghi **trên row mới đó** tại thời điểm submit thứ N; `consent_at` của các row `face_profiles` cũ (từ các lần submit trước, dù đang ở status `active`/`rejected`/`disabled`/`revoked`) giữ nguyên giá trị đã ghi từ lúc row đó được tạo, KHÔNG bị ghi đè hay thay đổi (BR-011). Nói cách khác: mỗi row có `consent_at` độc lập, phản ánh đúng lần consent tương ứng với lần submit đã tạo ra row đó.

EC-006: User gọi `GET /api/v1/me/avatar-status` khi `account_status` không phải `active` (ví dụ `locked`) → vẫn cho phép xem trạng thái (read-only, không rủi ro ghi dữ liệu); giới hạn `ACCOUNT_NOT_ACTIVE` chỉ áp dụng cho hành vi submit (ghi dữ liệu).

EC-007: User có đồng thời nhiều row `face_profiles` ở các status khác nhau theo lịch sử submission (ví dụ: 1 row `revoked` cũ nhất, 1 row `active`, không có `pending_review`) → áp dụng đúng thứ tự ưu tiên BR-004: nếu có `active` → trả `approved` dù có `revoked`/`rejected` cũ hơn (bước 2 thắng bước 3). Ngược lại nếu user có `pending_review` VÀ `revoked` (không có `active`) → trả `pending_review` (bước 1 thắng bước 3). Hệ thống KHÔNG được trả `rejected` trong hai trường hợp này dù có row `revoked`/`disabled`/`rejected` tồn tại, vì các row đó không phải kết quả ưu tiên cao nhất theo BR-004 (xem AC-016, AC-017 cho trường hợp CHỈ có `disabled`/`revoked` mà không có `active`/`pending_review`).

---

## 16. Non-functional Requirements

### 16.1 Performance

```text
NFR-001: THE system SHALL phản hồi GET /api/v1/me/avatar-status trong vòng 1 giây ở điều kiện tải bình thường.
NFR-002: THE system SHALL phản hồi POST /api/v1/me/avatar-submission trong vòng 5 giây ở điều kiện tải bình thường, không tính thời gian network upload file của client.
```

### 16.2 Security

```text
NFR-003: THE system SHALL yêu cầu JWT hợp lệ cho cả hai endpoint của feature này.
NFR-004: THE system SHALL validate MIME type bằng magic bytes detection (đọc buffer thực tế của file, ví dụ qua thư viện `file-type` hoặc tương đương) và validate kích thước file ở phía server; KHÔNG chỉ tin tưởng vào `file.mimetype` của Multer, extension, hoặc Content-Type do client khai báo (VL-02).
NFR-005: THE system SHALL NOT log nội dung binary của file ảnh trong log ứng dụng hoặc audit log.
NFR-006: THE system SHALL NOT lưu binary ảnh trực tiếp vào PostgreSQL.
```

### 16.3 Reliability & Consistency

```text
NFR-007: THE system SHALL đảm bảo việc tạo media_files và cập nhật face_profiles diễn ra trong cùng một transaction logic; nếu một phần thất bại, không để lại dữ liệu nửa vời.
NFR-008: THE system SHALL ngăn việc tạo nhiều hơn một bản ghi face_profiles có status = pending_review cho cùng một user tại một thời điểm, BẮT BUỘC ở cả tầng ứng dụng VÀ tầng database (partial unique index ux_face_profiles_user_pending — BR-010, mục 18.5, không còn là đề xuất tùy chọn); đồng thời đảm bảo mỗi user chỉ có tối đa một bản ghi có status = active tại một thời điểm (do feat-admin-avatar-review-workflow revoke old active khi approve).
```

### 16.4 Observability

```text
NFR-009: THE system SHALL ghi audit log đầy đủ cho mọi submission thành công (BR-012).
NFR-010: THE system SHALL log lỗi AVATAR_STORAGE_FAILED và AVATAR_UPLOAD_FAILED với đủ thông tin để debug (không bao gồm nội dung file); khi xảy ra AVATAR_UPLOAD_FAILED sau khi ảnh đã lưu thành công lên Cloudinary, THE system SHALL log kết quả của thao tác best-effort cleanup Cloudinary (thành công ở mức info, thất bại ở mức warning/error) kèm public_id và request_id để hỗ trợ dọn dẹp/tra cứu thủ công sau (EH-01, EC-004).
```

### 16.5 Maintainability

```text
NFR-011: THE system SHALL tách rõ logic self-service (feature này) khỏi logic admin-driven hiện có (UC-17, FaceProfileService.enrollPortrait) ở tầng permission/endpoint, để tránh nhầm lẫn actor khi bảo trì sau này (xem mục 20.2).
```

---

## 17. Dependencies / Integration Points

- **`auth` module (login flow)**: cần đọc thêm `avatarReviewStatus`/`avatarRequired`/`shouldShowAvatarPopup` và đưa vào `LoginSuccessData.user` (hiện định nghĩa tại `src/modules/auth/types/login.types.ts`, build response tại `src/modules/auth/presenters/login-response.presenter.ts`). Đây là điểm tích hợp bắt buộc của feature này nhưng không thuộc quyền sở hữu dữ liệu của module `accounts`. Theo ADR-001, việc đọc này SHALL dùng parameterized raw SQL ngay trong `AuthModule`, KHÔNG import `AccountsService`/`FaceProfileService`/Repository từ `AccountsModule` (SB-01, BR-016).
- **`accounts` module — `face_profiles`/`media_files` hiện có**: feature này dùng lại đúng bảng `face_profiles` (entity `FaceProfileEntity`, enum `FaceProfileStatus`) và `media_files` (entity `MediaFileEntity`, enum `StorageProvider`) đã tồn tại trong code, không tạo entity/bảng mới.
- **UC-17 / `account.face.register` (admin-driven enroll)**: cùng dùng `face_profiles`/`media_files` nhưng là actor và permission khác (admin enroll hộ user khác). Feature này KHÔNG sửa đổi UC-17; chỉ ghi nhận là một luồng tồn tại song song, ghi dữ liệu vào cùng bảng. Đề xuất extract chung `profile_code` generator giữa UC-17 và feature này — xem BR-PROFILE-CODE.
- **`feat-admin-avatar-review-workflow` (feature song song, agent khác phụ trách)**: là nơi duy nhất được phép chuyển `face_profiles.status` từ `pending_review` sang `active`/`rejected`, và là nơi duy nhất được phép cập nhật `users.avatar_url`. Feature này phụ thuộc vào kết quả của feature đó để vòng đời trạng thái hoàn chỉnh (not_uploaded → pending_review → approved/rejected), nhưng không triển khai phần đó. **Trong MVP, approval actor của feature đó là `SYSTEM_ADMIN` duy nhất — KHÔNG phải `BUSINESS_ADMIN`** (đã xác nhận khớp với `feat-admin-avatar-review-workflow/spec.md` hiện tại, OOS-005 của feature đó). Feature này KHÔNG mở rộng quyền approve/reject cho actor nào khác.
- **Cloudinary**: feature này giả định đã có cấu hình tích hợp Cloudinary ở tầng storage/infrastructure (credentials, SDK) — việc khởi tạo cấu hình Cloudinary cụ thể là chi tiết triển khai (plan.md), không thuộc spec.
- **RBAC / `permissions` table**: cần thêm 2 permission mới (`profile.avatar.read_status`, `profile.avatar.submit`) gán cho 4 system role hiện có. Nguồn triển khai chính thức SHALL là TypeORM seed/migration idempotent theo pattern `src/database/seeds/*SeedXxxPermission*.ts` (mục 10, AR-01) — không thay đổi cấu trúc RBAC.
- **Partial unique index `ux_face_profiles_user_pending`**: cả feature này và `feat-admin-avatar-review-workflow` đều tham chiếu cùng 1 index. Ghi chú đối chiếu: tại thời điểm viết spec này, `feat-admin-avatar-review-workflow/spec.md` (mục 10.4) vẫn ghi index này là "đề xuất"; spec hiện tại (DM-01) đã chốt index này là BẮT BUỘC. Khuyến nghị team đồng bộ wording ở cả 2 spec khi có dịp cập nhật, để tránh hiểu nhầm rằng index là tùy chọn.

---

## 18. Data Model Impact

> Không thêm bảng mới. Có 2 thay đổi schema/data nhỏ BẮT BUỘC (không còn là đề xuất tùy chọn): (1) migration DDL tạo partial unique index `ux_face_profiles_user_pending` (DM-01, mục 18.5); (2) seed/migration idempotent tạo 2 permission `profile.avatar.read_status`/`profile.avatar.submit` (AR-01, mục 10). Ngoài 2 thay đổi nhỏ này, phần còn lại (bổ sung giá trị `rejected` cho enum `FaceProfileStatus`) chỉ ở mức app-level enum, không cần migration DDL riêng.

### 18.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `users` | Chứa `avatar_url` (chỉ đọc trong feature này), `account_status`, `deleted_at` dùng để validate | Không ghi `avatar_url` trong feature này (BR-003) |
| `face_profiles` | Source of truth cho trạng thái avatar/face candidate | Dùng lại `FaceProfileEntity`/`FaceProfileStatus` hiện có; cần bổ sung giá trị enum `rejected` |
| `media_files` | Lưu metadata ảnh Cloudinary | Dùng lại `MediaFileEntity`/`StorageProvider` hiện có; dùng giá trị có sẵn `cloud_provider`, không thêm enum mới |
| `audit_logs` | Ghi nhận `avatar.upload`/`avatar.reupload` | Dùng lại `AuditLogEntity` hiện có |
| `permissions`, `role_permissions` | Thêm 2 permission mới cho self-service avatar | Theo cơ chế seed hiện tại, không đổi schema |

### 18.2 `face_profiles` — mapping field dùng trong feature này

| Field | Dùng cho | Ghi chú |
|---|---|---|
| `user_id` | Xác định chủ sở hữu hồ sơ | Luôn lấy từ JWT, không nhận từ client |
| `status` | Source of truth trạng thái | Mỗi submission hợp lệ tạo row MỚI với `status = pending_review`; cần thêm giá trị app-level `rejected` (BR-014) |
| `profile_code` | Mã hồ sơ duy nhất của row mới | Sinh bằng generator dùng chung cho self-service và UC-17 — xem BR-PROFILE-CODE |
| `primary_image_file_id` | Liên kết tới `media_files` của row vừa tạo | Set một lần khi tạo row (pre-generated `mediaFileId` — mục 18.7), không update lại |
| `quality_score` | Không ghi trong feature này | Do feature admin review xử lý (ngoài scope) |
| `consent_at` | Ghi nhận thời điểm user xác nhận consent | **Chỉ ghi trên row `face_profiles` MỚI vừa được tạo trong lần submit đó** (BR-011); KHÔNG cập nhật/ghi đè `consent_at` của bất kỳ row cũ nào (xem EC-005) |
| `enrolled_at` | Thời điểm tạo row | Set = `now()` khi tạo row (mọi lần submit hợp lệ đều là tạo row mới, không có khái niệm "cập nhật enrolled_at" trong feature này) |
| `last_updated_at` | Thời điểm cập nhật gần nhất của row đó | Set khi tạo row; dùng làm tiêu chí xác định "row gần nhất" ở BR-004 bước 3 |
| `metadata_json` | Không bắt buộc dùng trong MVP | Có thể để trống |

### 18.3 `media_files` — mapping field dùng trong feature này

| Field | Giá trị/Quy tắc |
|---|---|
| `file_type` | `image` |
| `storage_provider` | `cloud_provider` (giá trị có sẵn, đại diện cho Cloudinary trong MVP) |
| `storage_key` | Cloudinary `public_id` |
| `file_url` | Cloudinary `secure_url` |
| `related_entity_type` | `face_profile` |
| `related_entity_id` | `face_profiles.id` tương ứng |
| `uploaded_by` | `user_id` của chính user (self-upload) |
| `is_active` | `true` |

### 18.4 State / Status Model — `face_profiles.status` (chuẩn hóa cho feature này và các feature liên quan)

| Status | Ý nghĩa | Ai chuyển trạng thái này | Trong scope feature này? |
|---|---|---|---|
| (không có bản ghi) | `not_uploaded` | — | Có (đọc) |
| `pending_review` | Đã nộp, chờ duyệt | User submit (feature này) | Có (ghi) |
| `active` | Đã được duyệt (approved) | Admin approve (feature khác) | Chỉ đọc |
| `rejected` | Bị admin từ chối | Admin reject (feature khác) | Chỉ đọc + cho phép resubmit |
| `disabled` | Bị admin tạm khóa hồ sơ khuôn mặt | Admin (feature khác/ngoài scope) | Chỉ đọc (mapping sang `rejected` ở response, BR-004) + cho phép resubmit |
| `revoked` | Consent/hồ sơ bị thu hồi vĩnh viễn | Admin hoặc user request (ngoài scope) | Chỉ đọc (mapping sang `rejected` ở response, BR-004) + cho phép resubmit |

### 18.5 Data Constraints

- Mỗi user chỉ có tối đa 1 row `face_profiles` có `status = pending_review` tại một thời điểm (BR-010) — ràng buộc này là BẮT BUỘC, không phải đề xuất tùy chọn.
- Mỗi user chỉ có tối đa 1 row `face_profiles` có `status = active` tại một thời điểm (đảm bảo bởi feat-admin-avatar-review-workflow khi approve).
- Không dùng upsert — mọi submission hợp lệ đều INSERT row mới, theo đúng thứ tự pre-generate UUID + insert ở mục 18.7 (DM-02).
- **Partial unique index BẮT BUỘC** (DM-01 — migration DDL nhỏ, không tạo bảng mới, dùng `IF NOT EXISTS` để idempotent khi chạy lại migration):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_face_profiles_user_pending
ON face_profiles(user_id)
WHERE status = 'pending_review' AND deleted_at IS NULL;
```
Mục đích: chống race condition khi 2 request submit gửi gần như đồng thời cho cùng user (EC-003) — đây là lưới an toàn ở tầng DB, bổ sung cho kiểm tra ở tầng ứng dụng (BR-007), không thay thế kiểm tra đó.
- **Permission seed BẮT BUỘC** (AR-01 — không phải DDL nhưng vẫn là migration/seed cần ghi nhận ở đây): 2 permission `profile.avatar.read_status`, `profile.avatar.submit` được tạo bằng seed idempotent (`ON CONFLICT (permission_code) DO NOTHING`), gán cho `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` qua `role_permissions` (`ON CONFLICT (role_id, permission_id) DO NOTHING`) — chi tiết xem mục 10.
- `media_files.related_entity_type = 'face_profile'` dùng polymorphic association đã có sẵn trong baseline, không thêm cột FK riêng.
- Không xóa cứng (`DELETE`) bản ghi `face_profiles`/`media_files` trong feature này.

### 18.6 Data-related EARS Requirements

```text
FR-DATA-001: WHEN face_profiles được tạo mới do submission, THE system SHALL lưu đầy đủ user_id, profile_code, status = pending_review, primary_image_file_id, consent_at, enrolled_at = now().
FR-DATA-002: WHEN submission hợp lệ xảy ra (kể cả khi user đã có row face_profiles active hoặc rejected), THE system SHALL INSERT một row face_profiles MỚI với status = pending_review; KHÔNG UPDATE row face_profiles nào đang tồn tại sang pending_review.
FR-DATA-003: IF user đã có bất kỳ row face_profiles nào với status = pending_review, THEN THE system SHALL từ chối submission với lỗi AVATAR_ALREADY_PENDING_REVIEW (BR-007).
FR-DATA-004: WHEN xử lý một submission hợp lệ, THE system SHALL pre-generate faceProfileId và mediaFileId (UUID) trước khi ghi DB, sau đó INSERT media_files (với related_entity_id = faceProfileId) TRƯỚC, rồi INSERT face_profiles (với primary_image_file_id = mediaFileId) SAU, cả hai trong cùng một transaction — theo đúng thứ tự ở mục 18.7 (DM-02).
```

### 18.7 Transaction & Insert Order (DM-02 — bắt buộc)

`media_files.related_entity_id` là một polymorphic reference trỏ tới `face_profiles.id`. Để tránh vướng circular dependency khi cả hai bản ghi đều cần ID của nhau, hệ thống SHALL **pre-generate UUID cho cả `faceProfileId` và `mediaFileId` trước khi ghi DB**, sau đó ghi theo đúng thứ tự cố định sau:

```text
1. Validate auth/permission/account/file/consent theo đúng precedence ở mục 11.2.
2. Kiểm tra user chưa có row face_profiles nào ở status = pending_review (BR-007).
3. Generate faceProfileId = UUID (application-level, trước khi chạm DB).
4. Generate mediaFileId = UUID (application-level, trước khi chạm DB).
5. Upload file lên Cloudinary (ngoài transaction DB).
6. BEGIN TRANSACTION.
7. Re-check pending_review trong transaction (hoặc dựa vào việc partial unique index ux_face_profiles_user_pending sẽ tự chặn ở bước 9 nếu có race condition — EC-003).
8. INSERT media_files với:
   - id = mediaFileId
   - related_entity_type = 'face_profile'
   - related_entity_id = faceProfileId
   - file_url / storage_key / storage_provider = 'cloud_provider' / metadata_json theo mục 18.3
9. INSERT face_profiles với:
   - id = faceProfileId
   - primary_image_file_id = mediaFileId
   - status = 'pending_review'
   - consent_at = now()
   - profile_code sinh theo BR-PROFILE-CODE
10. INSERT audit_logs với action_type = avatar.upload hoặc avatar.reupload (BR-012), entity_id = faceProfileId.
11. COMMIT.
12. Nếu transaction DB thất bại sau khi Cloudinary upload đã thành công (bước 5) → thực hiện best-effort cleanup Cloudinary object theo EH-01/EC-004, sau đó trả lỗi AVATAR_UPLOAD_FAILED.
```

Lưu ý: `media_files` được INSERT TRƯỚC `face_profiles` (bước 8 trước bước 9) vì `face_profiles.primary_image_file_id` tham chiếu tới `media_files.id` — thứ tự này đảm bảo không có giai đoạn nào mà `face_profiles.primary_image_file_id` trỏ tới một `media_files.id` chưa tồn tại. Việc pre-generate UUID ở bước 3–4 (trước khi mở transaction) cho phép cả hai INSERT dùng ID đã biết trước, tránh phải SELECT lại ID vừa insert giữa hai câu lệnh.

---

## 19. Out of Scope

### 19.1 Không triển khai trong feature này

- Admin approve/reject avatar — đã có/sẽ có ở `feat-admin-avatar-review-workflow`.
- Notification (in-app/email) khi avatar bị reject hoặc được approve.
- Face recognition thật, face embedding, AI/vector pipeline.
- Gọi Face Server enrollment thật (khác hoàn toàn với việc lưu ảnh lên Cloudinary trong feature này).
- Email notification dưới mọi hình thức.
- Chặn user sử dụng các tính năng khác của hệ thống khi chưa có avatar hoặc avatar bị reject.
- Thay đổi RBAC ngoài việc thêm 2 permission `profile.avatar.read_status`/`profile.avatar.submit`.
- Lưu trạng thái "đã dismiss popup" ở backend.
- Sửa đổi UC-17 (`account.face.register`) hoặc hành vi admin-driven enrollment hiện có.
- Tạo bảng lịch sử các lần submit/reject trước đó (không có versioning trong MVP).
- Dọn dẹp file orphan trên Cloudinary khi transaction thất bại (chi tiết vận hành, không thuộc spec).

### 19.2 Có thể xem xét ở feature khác

- Push realtime (WebSocket) khi avatar được approve, để cập nhật `shouldShowAvatarPopup` không cần đăng nhập lại.
- Lưu lịch sử các lần submit/reject (versioning) nếu cần audit chi tiết hơn.
- Thống nhất lại phạm vi role được phép dùng `account.face.register` (UC-17) giữa code và `API_CONTRACT_v1.0_with_system_roles.md` (xem mục 20.2) — không sửa trong feature này.

### 19.3 Out-of-Scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT implement admin approve/reject logic as part of this feature.
OOS-002: THE system SHALL NOT create new database tables or columns as part of this feature.
OOS-003: THE system SHALL NOT implement real face recognition, embedding extraction, or Face Server enrollment in this feature.
OOS-004: THE system SHALL NOT send email notifications as part of this feature.
OOS-005: THE system SHALL NOT block access to any other system feature based on avatar status.
OOS-006: THE system SHALL NOT persist a "popup dismissed" state on the backend for this feature.
```

---

## 20. Open Questions

### 20.1 Quyết định đã chốt nhưng cần team xác nhận lại nếu có thông tin mới

- **Mapping `disabled`/`revoked` → response `rejected`** (BR-004): đã quyết định để tránh mở rộng enum response ngoài 4 giá trị mà yêu cầu gốc đã chốt (`not_uploaded`, `pending_review`, `rejected`, `approved`). Nếu `feat-admin-avatar-review-workflow` cần phân biệt rõ message hiển thị giữa "bị reject" và "bị disabled/revoked", có thể cần bổ sung field phụ (ví dụ `avatarReviewReason`) ở một spec sau — KHÔNG thêm trong spec này để tránh mở rộng scope.
- **Submit lại khi đang `approved` (BR-009)**: đã quyết định cho phép, tạo row `face_profiles` MỚI với `status = pending_review`. Row `active` cũ giữ nguyên trong thời gian ảnh mới đang chờ duyệt. Khi admin approve ảnh mới, `feat-admin-avatar-review-workflow` sẽ revoke old active row và update `users.avatar_url`. Admin có thể nhận diện đây là ảnh thay thế vì cùng `user_id` đang có cả row `active` lẫn row `pending_review` cùng tồn tại. `users.avatar_url` giữ nguyên cho đến khi approve.

### 20.2 Sai khác code-vs-spec cần team xử lý riêng (không thuộc scope sửa của feature này)

- `seed_permissions.sql` đang cấp `account.face.register` cho role `EMPLOYEE`, khác với `API_CONTRACT_v1.0_with_system_roles.md` (chỉ `BUSINESS_ADMIN`, `SYSTEM_ADMIN`). Đề nghị team rà soát lại UC-17 trong một thay đổi riêng, không gộp vào feature này.
- `FaceProfileService.enrollPortrait` (UC-17) hiện sinh `profile_code` bằng format ngắn `FP-${randomUUID().slice(0, 8)}`, khác với format mặc định `FP-${UUID_WITHOUT_DASHES_UPPERCASE}` mà feature này dùng làm fallback khi chưa có generator dùng chung (BR-PROFILE-CODE). Đề nghị team xác nhận trong plan.md: hoặc (a) extract một `FaceProfileCodeGenerator` dùng chung và cập nhật UC-17 dùng lại, hoặc (b) chấp nhận 2 format khác nhau tồn tại song song trong giai đoạn chuyển tiếp. Không tự sửa UC-17 trong phạm vi spec này.
- `feat-admin-avatar-review-workflow/spec.md` (mục 10.4, tại thời điểm viết spec này) vẫn ghi partial unique index `ux_face_profiles_user_pending` là "đề xuất", trong khi spec hiện tại (DM-01) đã chốt index này là BẮT BUỘC. Hai spec dùng chung 1 index nên cần đồng bộ wording — đề nghị team cập nhật spec admin-review khi có dịp, không thuộc phạm vi sửa của feature này.

### 20.3 Đề xuất bổ sung UC chính thức

- `API_CONTRACT_v1.0_with_system_roles.md` hiện chưa có mã UC chính thức cho 2 endpoint của feature này. Đề xuất bổ sung (ví dụ `UC-AVT-01` cho GET avatar-status, `UC-AVT-02` cho POST avatar-submission) khi tài liệu API Contract được cập nhật chính thức — không tự đánh số UC vào tài liệu nguồn trong phạm vi spec này.

### 20.4 Clarifications đã giải quyết trong revision này (2026-06-24)

Toàn bộ các điểm `clarify` sau đã được giải quyết và đưa vào các mục tương ứng của spec; không còn là open question:

| Mã clarify | Nội dung | Đã giải quyết tại |
|---|---|---|
| BL-01 | `consent_at` chỉ ghi vào row mới, không ghi đè row cũ | BR-011, mục 18.2, EC-005 |
| BL-02 | Rule sinh `profile_code` dùng chung | BR-PROFILE-CODE, mục 18.2, 20.2 |
| BL-03 | Avatar status resolution priority khi user có nhiều row | BR-004, BR-005, BR-006, FR-001, FR-004, FR-005, AC-003, AC-003b, AC-006b, EC-007 |
| AR-01 | Permission seed qua migration/seed idempotent | Mục 10, mục 18.5, AC-015 |
| AR-02 | Chỉ SYSTEM_ADMIN approve/reject avatar (feature khác) | Mục 17 (Dependencies) |
| VL-01 | `consentAccepted` transform cho multipart/form-data | BR-011, mục 9, FR-017, AC-010, AC-010b |
| VL-02 | Validate MIME type bằng magic bytes detection | Mục 9, FR-015, NFR-004, AC-008 |
| DM-01 | Partial unique index `ux_face_profiles_user_pending` là bắt buộc | BR-010, mục 18.5, NFR-008, EC-003, AC-015 |
| DM-02 | Thứ tự insert `media_files`/`face_profiles` với pre-generated UUID | Mục 18.6 (FR-DATA-004), mục 18.7 |
| EH-01 | Best-effort cleanup Cloudinary orphan file | EC-004, NFR-010 |
| EH-02 | Validation/Error precedence | Mục 11.2 |
| SB-01 | Auth module dùng parameterized raw SQL, không import AccountsService/FaceProfileService | BR-016, FR-011, mục 17 |
| SB-02 | Popup reminder không throttle trong MVP | BR-REMINDER-FREQUENCY |

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Đã đọc `AGENTS.md` trước khi viết spec (RULE TỐI THƯỢNG 1).
- [x] Đã đối chiếu `database_v3_2_compact_39_tables.md`, `docs/API_CONTRACT_v1.0_with_system_roles.md`, `docs/spec_typeorm_aligned.md`, `docs/SPEC_ALIGNMENT_WITH_DB_V3_2_COMPACT.md`.
- [x] Đã đối chiếu code hiện có (`face-profile.entity.ts`, `face-profile.service.ts`, `media-file.entity.ts`, `login.types.ts`) để tránh xung đột với UC-17 đã tồn tại.
- [x] Functional Requirements viết theo EARS, giữ keyword tiếng Anh.
- [x] Không thêm bảng database mới; mọi thay đổi chỉ ở mức app-level enum, có ghi chú rõ không cần migration.
- [x] Error handling theo đúng convention response lỗi của `AGENTS.md` §8.2.
- [x] Acceptance Criteria dùng Given/When/Then, có traceability về FR/BR/ERR.
- [x] Out of Scope đủ rõ, có EARS guardrail.
- [x] Các điểm chưa chắc chắn đã đưa vào mục 20 — Open Questions, không tự quyết định âm thầm.
- [x] CHANGELOG đã được ghi ở đầu file theo RULE TỐI THƯỢNG 2.
- [x] Đã thêm avatar status resolution priority (BR-004) áp dụng trên toàn bộ row face_profiles, không còn mâu thuẫn active-cũ/pending-mới (BL-03).
- [x] `consent_at` chỉ ghi vào row mới được tạo, không ghi đè row cũ (BL-01, BR-011, EC-005).
- [x] `profile_code` có rule sinh dùng chung rõ ràng, có fallback format và ghi nhận sai khác với UC-17 hiện tại (BL-02, BR-PROFILE-CODE).
- [x] `consentAccepted` chấp nhận cả boolean `true` và string `"true"` trong multipart/form-data (VL-01).
- [x] MIME type validate bằng magic bytes detection, không chỉ tin extension/Content-Type (VL-02).
- [x] Partial unique index `ux_face_profiles_user_pending` đã chốt là BẮT BUỘC, không còn là đề xuất (DM-01).
- [x] AC-015 không còn nói "không có DDL" tuyệt đối — đã liệt kê rõ index + permission seed bắt buộc.
- [x] Thứ tự insert `media_files`/`face_profiles` đã rõ bằng pre-generated UUID (DM-02, mục 18.7).
- [x] Có best-effort cleanup Cloudinary orphan file khi transaction thất bại (EH-01, EC-004).
- [x] Có validation/error precedence deterministic (EH-02, mục 11.2).
- [x] Auth module dùng parameterized raw SQL, không import AccountsService/FaceProfileService (SB-01, ADR-001).
- [x] Popup reminder không throttle trong MVP (SB-02, BR-REMINDER-FREQUENCY).
- [x] Không thêm bảng database mới.
- [x] Không viết code, không tạo plan.md/tasks.md trong revision này.
