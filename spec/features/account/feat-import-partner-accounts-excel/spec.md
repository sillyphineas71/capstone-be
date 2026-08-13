# Feature Specification: Import Excel tài khoản Đối tác/Khách hàng tạm thời (Bulk Create Partner Accounts via Excel)

- **Feature ID**: PTA-IMPORT-001
- **Feature Name**: Import Excel tài khoản Đối tác tạm thời (Bulk Create Partner Accounts via Excel)
- **Module / Domain**: `accounts` (chính) — tái dùng hạ tầng của `PTA-001` (tạo đối tác đơn lẻ) và `ACCT-IMPORT-ACCOUNT-001` (import nhân viên)
- **Created Date**: 2026-08-12
- **Status**: Draft — chờ duyệt trước khi implement (Thiếu Chủ đã chốt 7 quyết định thiết kế qua hội thoại, xem mục 1.5)
- **Source Documents**:
  - `KE_HOACH_BE_IMPORT_EXCEL_TAI_KHOAN_DOI_TAC_2026-08-12.md` (thư mục gốc repo — phân tích ban đầu + 7 câu hỏi đã được Thiếu Chủ trả lời qua hội thoại cùng ngày)
  - `spec/features/account/feat-partner-temporary-account/` (PTA-001 — tạo tài khoản đối tác đơn lẻ, nguồn của mọi hành vi nghiệp vụ đối tác được tái dùng ở đây)
  - `spec/features/account/feat-import-employee-accounts-excel/` (ACCT-IMPORT-ACCOUNT-001 — khung sườn import Excel 2 bước preview/commit, và tính năng `photosZip`/`license_plate` vừa bổ sung 2026-08-12 được tái dùng ở đây)
  - `CLAUDE.md` (quy tắc backend — đặc biệt mục 5.4 schema, mục 26 coding rules)

> **Vì sao tách riêng khỏi `ACCT-IMPORT-ACCOUNT-001` thay vì thêm `accountType` vào import nhân viên hiện có** — đã phân tích chi tiết trong `KE_HOACH_BE_IMPORT_EXCEL_TAI_KHOAN_DOI_TAC_2026-08-12.md` mục 1: 2 luồng có ngữ nghĩa validate **trái ngược nhau** ở phần rủi ro nhất (ảnh sinh trắc học — nhân viên là tùy chọn/best-effort, đối tác là bắt buộc/chặn dòng), khác khóa khớp ảnh (`employee_code` vs `email`), khác cấp phòng ban/role (tự do chọn vs ép cứng), và là hành động rủi ro bảo mật cao hơn (tạo hàng loạt tài khoản mật khẩu = email, đã được Thiếu Chủ chấp nhận đánh đổi ở PTA-001). Tách riêng giúp `AccountImportService` (phục vụ tuyển dụng — chạy thường xuyên) không bị phình thêm nhánh rẽ, và áp permission hẹp riêng cho hành động rủi ro cao hơn.

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | Khởi tạo spec, chuyển thể từ `KE_HOACH_BE_IMPORT_EXCEL_TAI_KHOAN_DOI_TAC_2026-08-12.md` sau khi Thiếu Chủ trả lời đủ 7 câu hỏi thiết kế qua hội thoại trực tiếp cùng ngày. | Toàn bộ file |

---

## 1. Context & Goal

### 1.1 Bối cảnh

`PTA-001` (2026-08-11) đã cho phép Administrator tạo **từng** tài khoản đối tác/khách hàng tạm thời (user thật, role `EMPLOYEE`, `department = "Đối tác"`, mật khẩu = email, tự hết hạn theo `account_expires_at`) qua `POST /api/v1/users` với `accountType='partner'`. Trong thực tế vận hành, đối tác thường đến theo **đoàn/sự kiện** (ví dụ đoàn khách dự hội nghị 1 ngày) — tạo từng tài khoản một qua form đơn lẻ không hiệu quả bằng cách nạp cả danh sách từ Excel, tương tự cách `ACCT-IMPORT-ACCOUNT-001` đã làm cho tuyển dụng nhân viên.

### 1.2 Mục tiêu

Cho phép Administrator/Business Admin (và Manager, nếu được cấp quyền — xem mục 2.2) tải lên file Excel danh sách đối tác kèm ảnh sinh trắc học (bắt buộc mỗi người), hệ thống kiểm tra hợp lệ, hiển thị preview, và sau khi xác nhận thì khởi tạo hàng loạt tài khoản đối tác — tái sử dụng toàn bộ nghiệp vụ đã có ở `PTA-001` (mật khẩu = email, `must_change_password=false`, `account_expires_at`, `face_profiles.status=active` bỏ qua hàng chờ duyệt) và khung sườn preview/commit + xử lý ảnh `.zip` đã có ở `ACCT-IMPORT-ACCOUNT-001`.

### 1.3 Giá trị mang lại

- **Hiệu suất**: cấp tài khoản cho cả đoàn khách trong một thao tác, thay vì lặp lại form đơn lẻ nhiều lần.
- **Nhất quán nghiệp vụ**: mọi tài khoản tạo qua import đi qua đúng `persistAccount()` — không lệch hành vi so với tạo đơn lẻ.
- **An toàn hơn tạo đơn lẻ ở 1 điểm**: ép cứng role `EMPLOYEE` cho mọi dòng (đơn lẻ hiện tại về mặt kỹ thuật vẫn cho chọn `roleIds` tùy ý ngay cả khi `accountType='partner'` — một khoảng hở nhỏ, xem `research.md` mục 3). Import hàng loạt siết chặt hơn ngay từ đầu vì rủi ro nhân rộng lớn hơn.
- **Tiện lợi**: `defaultExpiresInDays` ở cấp request — cả đoàn khách dùng chung 1 hạn dùng mặc định, chỉ cần override riêng lẻ cho cá nhân đặc biệt.

### 1.4 Giả định

- `PARTNER_DEPARTMENT_ID` (UUID cố định, seed từ `20260811000001-SeedPartnerDepartment.ts`) và role `EMPLOYEE` (`role_code='EMPLOYEE'`, active) đã tồn tại trong DB.
- Admin có sẵn ảnh khuôn mặt của TỪNG đối tác trong đoàn tại thời điểm import (điều kiện bắt buộc — không có ảnh khớp, dòng đó bị loại, không tạo tài khoản).
- Thư viện `exceljs` và `jszip` (đã thêm vào `package.json` cho `ACCT-IMPORT-ACCOUNT-001` cùng ngày 2026-08-12) dùng để parse Excel và giải nén `.zip` ảnh.
- 2 global guard `BiometricEnforcementGuard`/`MustChangePasswordGuard` **giữ nguyên không sửa** — giống nguyên tắc đã chốt ở PTA-001, thoả mãn bằng dữ liệu tạo sẵn (ảnh `active` ngay, `must_change_password=false` ngay), không sửa guard.

### 1.5 Nhật ký Quyết định đã chốt (Q&A trực tiếp với Thiếu Chủ, 2026-08-12)

Toàn bộ điểm dưới đây đã được Thiếu Chủ xác nhận qua hội thoại (không phải suy đoán của agent), trả lời cho 7 câu hỏi nêu trong `KE_HOACH_BE_IMPORT_EXCEL_TAI_KHOAN_DOI_TAC_2026-08-12.md` mục 3:

1. **Route — Phương án A**: giữ trong `UsersController` hiện có, route `POST /api/v1/users/import-partners` (cạnh `POST /users/import` của nhân viên), **không** tạo controller/resource riêng.
2. **Giới hạn số dòng — trong khoảng 50–100**: chốt `MAX_PARTNER_IMPORT_ROWS = 50` làm mặc định (xem lý do chọn cận dưới của khoảng đã đồng ý ở mục 3.6 NFR) — mỗi dòng luôn tốn 1 lượt upload Cloudinary thật (khác nhân viên là optional), nên chọn cận an toàn hơn; có thể nới lên tới 100 sau khi đo thời gian thật nếu cần (xem `research.md` mục 4).
3. **Role — ép cứng `EMPLOYEE`**: không có cột `role_codes` trong sheet; mọi dòng resolve `role_code='EMPLOYEE'` (1 lần cho cả batch, không phải mỗi dòng).
4. **`defaultExpiresInDays` — có**: field cấp-request (multipart), áp dụng cho dòng nào để trống cột `account_expires_at`; cột trong sheet dùng để **override riêng lẻ**.
5. **Permission — tạo mới `account.partner.import`**: không tái dùng `accounts.user.import` (rộng, dành cho HR/tuyển dụng) lẫn `account.partner.manage` (dành cho hành động gia hạn/khoá sớm đơn lẻ qua `PATCH`, không phải tạo hàng loạt).
6. **Cột `license_plate` — có**: tái dùng nguyên logic vừa viết cho `ACCT-IMPORT-ACCOUNT-001` cùng ngày (best-effort, không chặn dòng nếu sai/trùng).
7. **Audit riêng — có, `actionType='PARTNER_ACCOUNT_IMPORT'`**: đúng đề xuất, mirror cách `ACCT-IMPORT-ACCOUNT-001` tách `ACCOUNT_IMPORT` khỏi `ACCOUNT_CREATE` per-row.

### 1.6 Cần làm rõ (không chặn implement, ghi lại để không mất ngữ cảnh)

- **Role `MANAGER` với permission mới**: nếu seed `account.partner.import` cho cả `MANAGER` (mirror danh sách role của `account.partner.manage`: `MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`), `MANAGER` sẽ **thực sự dùng được** route import hàng loạt này — khác với tình huống PTA-001 đơn lẻ, nơi `MANAGER` có `account.partner.manage` nhưng vẫn bị chặn ở `POST /users` vì thiếu `accounts.user.create` (xem báo cáo `BAO_CAO_BE_TAI_KHOAN_DOI_TAC_SAN_SANG_BAN_GIAO_FE_2026-08-11.md` mục 6.1). Vì route mới này **độc lập**, chỉ gate bởi 1 permission duy nhất `account.partner.import`, sẽ **không** dính hạn chế đó. Đề xuất seed cho cả 3 role để nhất quán với `account.partner.manage`, nhưng đây là điểm khác biệt hành vi cần Thiếu Chủ biết trước khi seed migration (xem `plan.md` mục 7).
- **`positionTitle`/`directManagerId`**: cố ý **không** đưa vào sheet đối tác — đối tác không có khái niệm chức danh/quản lý trực tiếp trong tổ chức. Nếu sau này cần, có thể bổ sung như cột optional tương tự `phone_number`.

---

## 2. Actor & Roles

### 2.1 Danh sách actor
| Actor | Vai trò | Quyền |
|---|---|---|
| Business Admin / System Admin (/ Manager nếu được seed — mục 1.6) | Người thực hiện import hàng loạt đối tác | Permission `account.partner.import` (mới) |
| Đối tác (từng dòng trong Excel) | Chủ thể được tạo tài khoản | Không thao tác trong luồng này — nhận email sau khi tạo |

### 2.2 Role & Permission Rules
- Phải có permission **`account.partner.import`** (mới, seed qua migration — xem mục 7 `plan.md`).
- Không tái dùng `accounts.user.import` (phạm vi nhân viên) hay `account.partner.manage` (phạm vi gia hạn/khoá sớm đơn lẻ).

### 2.3 Actor Constraints
- Actor đã đăng nhập, `account_status='active'`, không phải chính tài khoản đối tác (đối tác không có permission quản trị).

---

## 2.4 User Scenarios & Workflow

### 2.4.1 Preconditions
- PRE-1: Actor có permission `account.partner.import`.
- PRE-2: Actor có file Excel đúng cấu trúc template đối tác + ảnh khuôn mặt cho từng người (file rời hoặc gộp `.zip`).

### 2.4.2 Postconditions
- POST-1: Các tài khoản hợp lệ được tạo — `department_id=PARTNER_DEPARTMENT_ID`, role `EMPLOYEE`, `account_status='active'`, `must_change_password=false`, `account_expires_at` đã set, `face_profiles.status='active'`.
- POST-2: Hệ thống đã phát lệnh gửi email cho từng đối tác (email đăng nhập + nhắc mật khẩu = chính email đó + hạn dùng) — tái dùng `buildPartnerAccountWelcomeEmail()` đã có.

### 2.4.3 Normal Flow
1. Actor vào "Quản lý tài khoản" → chọn "Nhập danh sách đối tác từ Excel" (mục menu MỚI, tách khỏi "Nhập danh sách nhân viên").
2. Hệ thống hiển thị giao diện upload (file Excel + ảnh rời/`.zip` + `defaultExpiresInDays`) + tùy chọn tải template mẫu.
3. Actor chọn file + ảnh, nhấn "Tải lên & Kiểm tra" (`POST .../import-partners` với `commit=false`).
4. Hệ thống parse file, validate: cấu trúc, email hợp lệ/không trùng, `account_expires_at` (dòng hoặc mặc định) ở tương lai, **có ảnh khớp email**.
5. Hệ thống trả **preview**: tổng số dòng hợp lệ + danh sách dòng lỗi kèm lý do (bao gồm lý do "thiếu ảnh"). **Không ghi DB, không upload ảnh lên Cloudinary.**
6. Actor xem báo cáo, xác nhận, gọi lại (`commit=true`, gửi lại đúng file Excel + ảnh) để tạo tài khoản cho các dòng hợp lệ.
7. Hệ thống tạo từng tài khoản: upload ảnh → tạo `face_profiles(status=active)` → `persistAccount()` với `data.partner` đã điền (mật khẩu=email, `must_change_password=false`, `account_expires_at`), gán role `EMPLOYEE`, ghi audit `account.partner.create` per-row.
8. Nếu dòng có `license_plate`, đăng ký hộ biển số (best-effort, không chặn dòng — tái dùng nguyên logic `ACCT-IMPORT-ACCOUNT-001`).
9. Hệ thống enqueue email cho từng tài khoản mới (`buildPartnerAccountWelcomeEmail`).
10. Hệ thống ghi audit tổng `PARTNER_ACCOUNT_IMPORT` và trả báo cáo kết quả (`successCount`, `failedCount`).

### 2.4.4 Alternative Flow — AF1: Tải template
- Tại bước 2, actor nhấn "Tải tệp mẫu" → `GET .../import-partners/template` trả file `.xlsx` (header đối tác + ví dụ + hướng dẫn, khác hẳn template nhân viên).

### 2.4.5 Exceptions
- **EX1**: File không phải `.xlsx`, vượt dung lượng, hoặc `.zip` ảnh không đọc được/quá lớn → từ chối cấp request (`INVALID_FILE_FORMAT`/`FILE_TOO_LARGE`/`INVALID_PHOTOS_ZIP`).
- **EX2**: Dòng thiếu trường bắt buộc, sai định dạng, trùng email, hoặc **thiếu ảnh khớp** → bôi đỏ trong preview, nêu lý do, tự động loại khỏi luồng tạo (không chặn dòng hợp lệ khác — mirror BR2 của `ACCT-IMPORT-ACCOUNT-001`).
- **EX3**: `account_expires_at` (dòng hoặc `defaultExpiresInDays` suy ra) không ở tương lai → dòng lỗi, không chặn dòng khác.

---

## 3. Functional Requirements

### 3.1 File & Parsing
- **FR-PIA-001**: THE system SHALL cung cấp endpoint tải template `.xlsx` riêng cho đối tác (`GET /users/import-partners/template`), header: `full_name`, `email`, `account_expires_at`, `phone_number`, `license_plate`.
- **FR-PIA-002**: THE system SHALL chỉ nhận `.xlsx`; định dạng khác → `400 INVALID_FILE_FORMAT`.
- **FR-PIA-003**: THE system SHALL giới hạn dung lượng file Excel ≤ 2MB (mirror `MAX_IMPORT_FILE_BYTES`); vượt → `400 FILE_TOO_LARGE`.
- **FR-PIA-004**: THE system SHALL từ chối file rỗng/sai header (`400 INVALID_TEMPLATE`) và file > `MAX_PARTNER_IMPORT_ROWS` (mặc định 50) (`400 IMPORT_ROW_LIMIT_EXCEEDED`).
- **FR-PIA-005**: THE system SHALL nhận ảnh sinh trắc học qua `photos[]` (nhiều file rời) và/hoặc `photosZip` (1 file `.zip`) — tái dùng nguyên `extractPhotosFromZip()` (giới hạn dung lượng/entry giống `ACCT-IMPORT-ACCOUNT-001`).
- **FR-PIA-006**: THE system SHALL khớp ảnh theo **`email`** của dòng (basename không đuôi mở rộng, không phân biệt hoa/thường) — KHÁC khóa khớp `employee_code` của import nhân viên (đối tác không có `employee_code`).

### 3.2 Row Validation & Resolution
- **FR-PIA-007**: FOR EACH dòng, THE system SHALL bắt buộc `full_name`, `email`; thiếu → `MISSING_REQUIRED_FIELD`.
- **FR-PIA-008**: THE system SHALL validate `email` đúng định dạng (chuẩn hóa lowercase + trim); sai → `INVALID_EMAIL`.
- **FR-PIA-009**: THE system SHALL phát hiện email trùng **trong file** → dòng sau `DUPLICATE_IN_FILE`, và trùng **trong DB** → `EMAIL_ALREADY_EXISTS` (bao gồm cả user thường lẫn đối tác khác, vì đều chung bảng `users`).
- **FR-PIA-010**: THE system SHALL resolve **`account_expires_at` hiệu lực** của mỗi dòng = giá trị cột (nếu có, parse ISO date) HOẶC `now() + defaultExpiresInDays ngày` (nếu cột trống và request có `defaultExpiresInDays`); nếu cả hai đều thiếu → `MISSING_ACCOUNT_EXPIRES_AT`.
- **FR-PIA-011**: THE system SHALL validate giá trị cột `account_expires_at` (nếu có) là ngày hợp lệ; không parse được → `INVALID_ACCOUNT_EXPIRES_AT`.
- **FR-PIA-012**: THE system SHALL validate `account_expires_at` hiệu lực (sau khi resolve FR-PIA-010) ở **tương lai** tại thời điểm xử lý; không thoả → `ACCOUNT_EXPIRES_AT_MUST_BE_FUTURE`.
- **FR-PIA-013**: THE system SHALL bắt buộc mỗi dòng có **đúng 1 ảnh khớp** theo `email` (FR-PIA-006); không có ảnh khớp → dòng lỗi `PARTNER_PHOTO_REQUIRED` — **KHÁC HẲN** hành vi `not_provided` không chặn của import nhân viên.
- **FR-PIA-014**: THE system SHALL ép cứng `department_id = PARTNER_DEPARTMENT_ID` và `role = EMPLOYEE` (resolve 1 lần theo `role_code='EMPLOYEE'` active) cho MỌI dòng — không có cột `department_code`/`role_codes` trong sheet đối tác.
- **FR-PIA-015 (kế thừa từ `ACCT-IMPORT-ACCOUNT-001`)**: IF dòng có điền `license_plate`, THE system SHALL cố gắng đăng ký hộ biển số qua `VehicleRegistrationService.register()` sau khi tài khoản tạo thành công — **best-effort**, KHÔNG BAO GIỜ chặn dòng (biển sai định dạng/trùng chỉ set `vehiclePlateStatus`, không đổi `status` của dòng).

### 3.3 Two-step Preview & Confirm
- **FR-PIA-016**: WHEN `commit=false` (mặc định), THE system SHALL trả preview (validCount + dòng lỗi + lý do, bao gồm cả check "có ảnh khớp không" — KHÔNG upload/gọi Cloudinary) và **KHÔNG ghi bất kỳ dữ liệu nào**.
- **FR-PIA-017**: WHEN `commit=true`, THE system SHALL tạo tài khoản cho các dòng hợp lệ (đã có ảnh khớp + `account_expires_at` tương lai), bỏ qua dòng lỗi, trả báo cáo kết quả từng dòng.

### 3.4 Account Creation (reuse `persistAccount` + PTA-001)
- **FR-PIA-018**: FOR EACH dòng hợp lệ, THE system SHALL upload ảnh khớp lên Cloudinary, validate magic-bytes (JPEG/PNG/WEBP, ≤5MB) — lỗi ở bước này (`invalid_image`/`file_too_large`) làm dòng đó **thất bại** (khác biometric optional của nhân viên — ảnh là điều kiện bắt buộc để tạo tài khoản đối tác).
- **FR-PIA-019**: THE system SHALL tạo `face_profiles` với `status=active` (bỏ qua `pending_review`), `enrolledBy=actor.id` — mirror đúng hành vi `PTA-001` tạo đơn lẻ.
- **FR-PIA-020**: THE system SHALL gọi `UsersService.persistAccount()` với `ResolvedAccountData.partner` đã điền (`accountExpiresAt`, `mediaFileId`, `faceProfileId`, ...) — **KHÔNG viết lại logic tạo user**, tái dùng nguyên hàm đã dùng cho cả tạo đơn lẻ lẫn import nhân viên.
- **FR-PIA-021**: THE system SHALL xử lý mỗi dòng trong **transaction riêng** (partial success — mirror BR2 của `ACCT-IMPORT-ACCOUNT-001`).
- **FR-PIA-022**: THE system SHALL ghi `audit_logs` per-row `action.partner.create` (tự động qua `persistAccount`, không cần code thêm) và một audit tổng `PARTNER_ACCOUNT_IMPORT` cho phiên import.

### 3.5 Notification
- **FR-PIA-023**: WHEN một tài khoản đối tác được tạo, THE system SHALL enqueue email dùng `buildPartnerAccountWelcomeEmail()` (đã có từ PTA-001) — nội dung: email đăng nhập + nhắc mật khẩu = email + hạn dùng.
- **FR-PIA-024**: THE system SHALL xử lý gửi email best-effort; lỗi enqueue KHÔNG rollback tài khoản đã tạo (audit `NOTIFICATION_ENQUEUE_FAILED` như luồng hiện có).

### 3.6 Processing Constraints
- **FR-PIA-025**: THE system SHALL xử lý đồng bộ trong giới hạn `MAX_PARTNER_IMPORT_ROWS = 50` (cận dưới khoảng 50–100 Thiếu Chủ đã đồng ý — chọn cận an toàn vì mỗi dòng luôn tốn 1 lượt upload Cloudinary thật, xem `research.md` mục 4 để biết cách nới lên 100 nếu đo thời gian thật cho phép).

---

## 4. Non-functional Requirements
- **NFR-PIA-001**: THE system SHALL xử lý file ≤ 50 dòng (mỗi dòng có upload Cloudinary thật) và phản hồi trong thời gian hợp lý cho 1 request HTTP đồng bộ — cần đo thời gian thật khi implement (xem rủi ro `plan.md` mục 10), không có cam kết số giây cụ thể ở giai đoạn spec vì phụ thuộc độ trễ mạng Cloudinary thật.
- **NFR-PIA-002**: THE system SHALL không lưu file Excel/ảnh vào DB trước khi xử lý; chỉ parse/giữ trong memory (memoryStorage), giống `ACCT-IMPORT-ACCOUNT-001`.
- **NFR-PIA-003**: THE system SHALL đảm bảo mỗi tài khoản tạo là atomic (user + user_roles + media_files + face_profiles + audit trong cùng transaction).
- **NFR-PIA-004**: THE system SHALL KHÔNG trả mật khẩu trong response API (dù mật khẩu = email, không phải bí mật sinh ngẫu nhiên, vẫn không nên lặp lại trong response theo nguyên tắc NFR-004 của `ACCT-IMPORT-ACCOUNT-001`).
- **NFR-PIA-005**: THE system SHALL không log ảnh khuôn mặt raw buffer hay nội dung nhạy cảm khác ra log server.
- **NFR-PIA-006**: THE system SHALL chặn zip-bomb qua `.zip` ảnh bằng đúng giới hạn đã áp dụng cho `ACCT-IMPORT-ACCOUNT-001` (`MAX_PHOTOS_ZIP_BYTES=100MB`, tổng giải nén ≤250MB, ≤200 entry).

---

## 5. Data Model

### 5.1 Entity liên quan
| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `users` | Tạo tài khoản mới | INSERT qua `persistAccount()`. `department_id=PARTNER_DEPARTMENT_ID` (ép cứng), `account_expires_at` đã resolve, `must_change_password=false` |
| `departments` | Đọc `PARTNER_DEPARTMENT_ID` để xác nhận còn active | READ (1 lần, không phải mỗi dòng) |
| `roles` | Resolve `role_code='EMPLOYEE'` | READ (1 lần cho cả batch) |
| `user_roles` | Gán vai trò `EMPLOYEE` | INSERT |
| `media_files` | Metadata ảnh đã upload Cloudinary | INSERT (mỗi dòng thành công) |
| `face_profiles` | Hồ sơ khuôn mặt `status=active` | INSERT (mỗi dòng thành công) |
| `notifications` | Email chào mừng đối tác | INSERT (mỗi user) |
| `background_jobs` | Job gửi email | INSERT (mỗi user) |
| `audit_logs` | `account.partner.create` per-row (tự động qua `persistAccount`) + `PARTNER_ACCOUNT_IMPORT` tổng | INSERT |
| `vehicle_registrations` | Nếu dòng có `license_plate` | INSERT (best-effort, tái dùng `VehicleRegistrationService`) |

### 5.2 Business Rules Impact
- **KHÔNG thay đổi schema.** Mọi cột (`users.account_expires_at`, v.v.) đã có sẵn từ `PTA-001` (2026-08-11).
- Không thêm bảng lịch sử import riêng (mirror `ACCT-IMPORT-ACCOUNT-001`).

---

## 6. Error Handling & Validation Rules

### 6.1 Lỗi cấp request (toàn file)
| Case | HTTP | Mã lỗi |
|---|---|---|
| Không phải `.xlsx` | 400 | `INVALID_FILE_FORMAT` |
| Vượt dung lượng Excel | 400 | `FILE_TOO_LARGE` |
| File rỗng / sai header | 400 | `INVALID_TEMPLATE` |
| Vượt số dòng tối đa (50) | 400 | `IMPORT_ROW_LIMIT_EXCEEDED` |
| `.zip` ảnh lỗi/quá lớn/quá số lượng | 400 | `INVALID_PHOTOS_ZIP` |
| `defaultExpiresInDays` không phải số nguyên dương | 400 | `INVALID_DEFAULT_EXPIRES_IN_DAYS` |
| Thiếu quyền | 403 | `FORBIDDEN_ACCESS` |

### 6.2 Lỗi cấp dòng (bôi đỏ trong preview, loại khỏi tạo)
| Row Error | Mã lỗi dòng |
|---|---|
| Thiếu `full_name`/`email` | `MISSING_REQUIRED_FIELD` |
| Email sai định dạng | `INVALID_EMAIL` |
| Trùng email trong file | `DUPLICATE_IN_FILE` |
| Email đã tồn tại DB | `EMAIL_ALREADY_EXISTS` |
| `account_expires_at` cột không parse được | `INVALID_ACCOUNT_EXPIRES_AT` |
| Không có `account_expires_at` (cột trống VÀ không có `defaultExpiresInDays`) | `MISSING_ACCOUNT_EXPIRES_AT` |
| `account_expires_at` hiệu lực không ở tương lai | `ACCOUNT_EXPIRES_AT_MUST_BE_FUTURE` |
| Không có ảnh khớp email dòng này | `PARTNER_PHOTO_REQUIRED` |
| Ảnh khớp nhưng không phải JPEG/PNG/WEBP hợp lệ | `PARTNER_PHOTO_INVALID_IMAGE` |
| Ảnh khớp nhưng > 5MB | `PARTNER_PHOTO_TOO_LARGE` |

### 6.3 Trạng thái biển số xe (`vehiclePlateStatus`, best-effort — KHÔNG làm lỗi dòng)
Tái dùng nguyên enum `ImportAccountVehiclePlateStatus` của `ACCT-IMPORT-ACCOUNT-001`: `pending_commit | attached | invalid_plate | duplicate_plate | attach_failed`.

---

## 7. API Contract (Proposed)
Chi tiết đầy đủ ở `contracts/import-partner-accounts-api.md`. Tóm tắt:

### 7.1 Tải template
`GET /api/v1/users/import-partners/template` → file `.xlsx`.

### 7.2 Import (preview + commit chung endpoint)
`POST /api/v1/users/import-partners`
- **Content-Type**: `multipart/form-data`
- **Fields**: `file` (binary .xlsx, required), `commit` (boolean, default `false`), `photos` (binary[], optional), `photosZip` (binary, optional), `defaultExpiresInDays` (number, optional)

---

## 8. Acceptance Criteria

### 8.1 Template & Parsing
- **AC-PIA-001**: Given file `.pdf`, hệ thống trả `400 INVALID_FILE_FORMAT`.
- **AC-PIA-002**: Given file 51 dòng, hệ thống trả `400 IMPORT_ROW_LIMIT_EXCEEDED`.
- **AC-PIA-003**: Given `GET .../import-partners/template`, trả `.xlsx` đúng 5 cột header đối tác.

### 8.2 Preview & Validation
- **AC-PIA-004**: Given dòng không có ảnh khớp `email`, dòng đó `invalid PARTNER_PHOTO_REQUIRED` trong preview, KHÔNG gọi Cloudinary.
- **AC-PIA-005**: Given dòng để trống `account_expires_at` VÀ request không có `defaultExpiresInDays`, dòng đó `invalid MISSING_ACCOUNT_EXPIRES_AT`.
- **AC-PIA-006**: Given request có `defaultExpiresInDays=1`, dòng để trống `account_expires_at` được resolve thành `now()+1 ngày` và coi là hợp lệ (nếu có ảnh khớp).
- **AC-PIA-007**: Given `commit=false`, không có bản ghi nào được ghi vào DB, KHÔNG có lượt gọi Cloudinary nào.

### 8.3 Commit & Business Rules
- **AC-PIA-008**: Given dòng hợp lệ (đủ ảnh + hạn dùng tương lai), khi `commit=true`, tài khoản được tạo với `department_id=PARTNER_DEPARTMENT_ID`, role `EMPLOYEE`, `must_change_password=false`, `account_expires_at` đúng giá trị đã resolve, `face_profiles.status='active'`.
- **AC-PIA-009**: Given dòng có `license_plate` hợp lệ, sau khi tạo tài khoản, `vehicle_registrations` được tạo, `vehiclePlateStatus='attached'`.
- **AC-PIA-010**: Given dòng có `license_plate` trùng, tài khoản vẫn tạo thành công, `vehiclePlateStatus='duplicate_plate'`.
- **AC-PIA-011**: Given phiên import commit, một audit `PARTNER_ACCOUNT_IMPORT` tổng được ghi, và mỗi tài khoản có audit `account.partner.create` riêng.
- **AC-PIA-012**: Given actor chỉ có `accounts.user.import` (không có `account.partner.import`), request bị `403 FORBIDDEN_ACCESS`.

---

## 9. Out of Scope
- Hỗ trợ `.xls` legacy (giống `ACCT-IMPORT-ACCOUNT-001`).
- Xử lý bất đồng bộ (`background_jobs`) cho parse/import.
- Cập nhật (gia hạn/khoá sớm) hàng loạt qua Excel — vẫn dùng `PATCH /users/:userId` từng cái (đã có từ PTA-001).
- Cột `role_codes`/`department_code`/`employee_code`/`position_title`/`direct_manager_email` — không áp dụng cho đối tác (xem mục 1.6).
- Lọc đối tác khỏi participant-picker/danh sách enroll khuôn mặt cửa ra vào — vẫn **HOÃN** theo quyết định gốc ở PTA-001, import hàng loạt không đổi thực trạng này, chỉ khiến rủi ro đó xảy ra nhanh hơn với số lượng lớn hơn.

---

## 10. Assumptions
- Client gọi 2 bước: `commit=false` để xem preview (bao gồm check ảnh, KHÔNG upload), rồi gửi lại **cùng file Excel + ảnh** với `commit=true` để tạo thật.
- `defaultExpiresInDays` là số nguyên dương hợp lý (ví dụ 1–30) — không giới hạn cứng trong spec, nhưng khuyến nghị FE gợi ý giá trị ngắn (1 ngày) theo đúng khuyến nghị bảo mật đã có ở PTA-001.
- Batch đối tác thực tế nhỏ hơn nhiều so với đợt tuyển dụng nhân viên (vài chục người/sự kiện) — cơ sở cho giới hạn 50 dòng.
