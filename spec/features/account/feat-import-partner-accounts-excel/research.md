# Research: Import Excel tài khoản Đối tác/Khách hàng tạm thời

- **Feature ID**: PTA-IMPORT-001
- **Created**: 2026-08-12

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | Khởi tạo research: khảo sát code thật của `PTA-001` (tạo đối tác đơn lẻ) và `ACCT-IMPORT-ACCOUNT-001` (import nhân viên) để xác định phần tái dùng | Toàn bộ file |

---

## 1. Mục tiêu
Xác định chính xác (đọc code thật, không suy đoán từ tài liệu) phần nào của `PTA-001` có thể tái dùng nguyên vẹn cho import hàng loạt, và phần nào của `ACCT-IMPORT-ACCOUNT-001` (khung sườn preview/commit, `.zip`, `license_plate`) tái dùng được.

---

## 2. Phát hiện chính (đã verify bằng đọc code thật)

### 2.1 `UsersService.persistAccount()` đã được thiết kế sẵn để dùng chung
File `src/modules/accounts/services/users.service.ts:506-...`. Comment ngay trong code: *"Core persist tài khoản ... Dùng chung cho tạo đơn lẻ và import Excel."* Nhận `ResolvedAccountData` với field `partner?: PartnerProvisionData` — nếu có, tự động:
- Mật khẩu = `data.email` thay vì sinh ngẫu nhiên (dòng 513-515).
- `accountExpiresAt = data.partner?.accountExpiresAt ?? null` (dòng 531).
- `mustChangePassword = !data.partner` (dòng 532) — `false` cho đối tác.
- Insert `media_files` + `face_profiles` (`status=active`, KHÔNG qua `pending_review`) nếu `data.partner` có giá trị (dòng 546-575).
- Audit `actionType = data.partner ? 'account.partner.create' : 'ACCOUNT_CREATE'` (dòng 582) — **tự động phân biệt**, không cần code thêm ở service mới.

**Kết luận**: service mới chỉ cần build đúng `ResolvedAccountData.partner` (upload ảnh trước, lấy `mediaFileId`/`faceProfileId`/`storageKey`/...) rồi gọi `persistAccount()` y hệt cách `createUser()` đang làm — KHÔNG viết lại logic tạo user.

### 2.2 `validatePartnerProvisionPayload()` — luật validate ảnh + hạn dùng của luồng đơn lẻ
File `users.service.ts:448-490`. Áp dụng đúng các luật:
- `accountExpiresAt` bắt buộc + phải ở tương lai (`ACCOUNT_EXPIRES_AT_REQUIRED`/`ACCOUNT_EXPIRES_AT_MUST_BE_FUTURE`).
- Ảnh bắt buộc (`AVATAR_FILE_REQUIRED`), ≤5MB (`AVATAR_FILE_TOO_LARGE`), đúng magic-bytes JPEG/PNG/WEBP (`AVATAR_FILE_TYPE_INVALID`).

Service import mới **áp dụng đúng luật tương tự cho từng dòng**, nhưng đổi tên mã lỗi theo namespace riêng (`PARTNER_PHOTO_REQUIRED` thay vì `AVATAR_FILE_REQUIRED`, v.v. — xem `contracts/import-partner-accounts-api.md` mục 4) vì đây là lỗi **cấp dòng** trong `results[]`, không phải lỗi **cấp request** như luồng đơn lẻ.

### 2.3 `PARTNER_DEPARTMENT_ID` — hằng số cố định, không resolve từ input
File `src/common/utils/partner-account.util.ts`. `= '7c3e2f1a-4b6a-4f2e-9d8c-1a2b3c4d5e6f'`, seed cố định qua migration `20260811000001-SeedPartnerDepartment.ts`. Import hàng loạt dùng thẳng hằng số này, **không** đọc cột `department_code` từ Excel (khác hẳn `ACCT-IMPORT-ACCOUNT-001`).

### 2.4 Role `EMPLOYEE` — KHÔNG có UUID cố định, phải resolve theo `role_code`
Không tìm thấy UUID cố định seed sẵn cho role `EMPLOYEE` (khác `PARTNER_DEPARTMENT_ID`). Phải resolve bằng query `roles WHERE role_code='EMPLOYEE' AND is_active=true` — đúng pattern `resolveRows()` đã dùng trong `account-import.service.ts`, chỉ khác là chỉ resolve **1 lần cho cả batch** (không phải theo cột mỗi dòng, vì mọi dòng đều dùng chung role này).

### 2.5 `CreateUserDto` — lỗ hổng nhỏ chưa khai thác (ghi nhận, không thuộc scope sửa ở đây)
File `src/modules/accounts/dto/create-user.dto.ts:42-49`. `roleIds` **không** bị ràng buộc theo `accountType` — về mặt kỹ thuật, `POST /users` với `accountType='partner'` vẫn chấp nhận `roleIds` bất kỳ (kể cả `BUSINESS_ADMIN`/`SYSTEM_ADMIN`), không có `@ValidateIf` nào ép về `EMPLOYEE`. Đây là khoảng hở **có sẵn từ trước** ở luồng đơn lẻ, không phải lỗi do feature này gây ra. Feature này (import hàng loạt) **chủ động không lặp lại khoảng hở đó** — bằng cách không có cột `role_codes` trong sheet, ép cứng `EMPLOYEE` phía server, không nhận role từ client dưới bất kỳ hình thức nào.

### 2.6 Permission hiện có cho đối tác — không cái nào phù hợp để tái dùng
- `accounts.user.create`/`accounts.user.update`: gate `POST/PATCH /users` — phạm vi RỘNG (mọi loại tài khoản), không nên gán thêm ý nghĩa "import hàng loạt đối tác".
- `account.partner.manage`: theo migration `20260811000002`, mục đích ghi rõ là "tạo, gia hạn và khoá sớm tài khoản đối tác" — nhưng thực tế chỉ dùng để gate nhánh sửa `accountExpiresAt` trong `PATCH /users/:userId` (`users.service.ts:1515`), KHÔNG gate `POST /users`. Dùng permission này cho route import mới sẽ gây hiểu nhầm phạm vi.
- → Xác nhận quyết định tạo permission mới `account.partner.import` (đã chốt với Thiếu Chủ) là đúng, không có permission sẵn nào khớp nghĩa.

### 2.7 `extractPhotosFromZip()` — tái dùng được, viết cùng ngày cho `ACCT-IMPORT-ACCOUNT-001`
File `src/modules/accounts/services/account-import.service.ts` (method private, thêm 2026-08-12). Hoàn toàn generic — nhận buffer `.zip`, trả `UploadedAccountPhoto[]` (buffer + originalname + size), không phụ thuộc `employee_code`. Khóa khớp theo tên file được xử lý ở tầng gọi (`buildPhotoMap`/`matchPhotoForRow`), không nằm trong hàm giải nén — nghĩa là đổi khóa khớp từ `employee_code` sang `email` **không đụng** tới logic giải nén zip, chỉ đổi tầng khớp.

---

## 3. Khác biệt "import nhân viên" vs "import đối tác" — bảng đối chiếu đầy đủ

Đã trình bày ở `KE_HOACH_BE_IMPORT_EXCEL_TAI_KHOAN_DOI_TAC_2026-08-12.md` mục 1 và `spec.md` phần mở đầu — không lặp lại ở đây, xem 2 tài liệu đó để tránh trùng lặp nội dung.

---

## 4. Ước tính thời gian xử lý — cơ sở chọn cap 50 dòng

Chưa đo thời gian thật (feature chưa code) — đây là ước tính dựa trên đối chiếu với `NFR-001` của `ACCT-IMPORT-ACCOUNT-001` (200 dòng, ≤15s, nhưng ảnh optional nên phần lớn dòng KHÔNG tốn thời gian upload Cloudinary). Với import đối tác, **100% dòng hợp lệ đều tốn 1 lượt upload Cloudinary thật** (khác biệt cốt lõi) — nếu mỗi lượt upload mất trung bình 300-800ms (tuỳ băng thông + kích thước ảnh), 50 dòng tuần tự có thể mất 15-40s, 100 dòng có thể mất 30-80s. Đây là lý do đề xuất cap 50 làm mặc định an toàn thay vì 100 (Thiếu Chủ đã đồng ý khoảng 50-100, chọn cận dưới cho lần đầu triển khai).

**Khuyến nghị khi implement**: đo thời gian thật với batch 50 dòng ảnh thật trước khi công bố cho FE; nếu nhanh hơn dự kiến, có thể nới `MAX_PARTNER_IMPORT_ROWS` lên 100 bằng cách đổi 1 hằng số, không cần refactor gì thêm.

---

## 5. Alternatives đã cân nhắc & lý do loại
| Alternative | Lý do loại |
|---|---|
| Thêm `accountType`/`account_expires_at`/ảnh bắt buộc vào `AccountImportService` hiện có | Trộn lẫn ngữ nghĩa validate trái ngược nhau (optional vs mandatory) — xem `spec.md` phần mở đầu + `KE_HOACH_...` mục 1 |
| Tái dùng permission `accounts.user.import` hoặc `account.partner.manage` | Không khớp phạm vi (mục 2.6) |
| Upload ảnh song song (Promise.all) để giảm thời gian | Cân nhắc tối ưu sau nếu cap 50-100 dòng vẫn chậm — KHÔNG đưa vào scope v1 để giữ đơn giản (per-row transaction tuần tự dễ debug/rollback hơn) |
| Xử lý bất đồng bộ qua `background_jobs` | Vi phạm nguyên tắc "không thêm hạ tầng khi chưa cần" (CLAUDE.md); cap 50-100 dòng đủ nhỏ để xử lý sync |
| Cho phép chọn role tùy ý (như luồng đơn lẻ hiện đang cho phép về mặt kỹ thuật) | Import hàng loạt nên siết chặt hơn vì rủi ro nhân rộng — đã chốt ép cứng `EMPLOYEE` |

---

## 6. Rủi ro & lưu ý
- Thời gian xử lý 1 request HTTP đồng bộ với nhiều lượt Cloudinary — cần đo thật, không chỉ suy đoán (mục 4).
- `role_code='EMPLOYEE'` bị vô hiệu hoá đột ngột (rất khó xảy ra, nhưng về lý thuyết có thể) → toàn batch lỗi cấp request, không phải lỗi từng dòng — cần message rõ ràng để không gây hoang mang cho actor.
- Nhân bản `extractPhotosFromZip`/hằng số zip (quyết định ở `plan.md` mục 9) — cần đồng bộ giá trị tại thời điểm viết, ghi rõ nguồn gốc trong comment để dev sau biết đây là bản sao có chủ đích.
