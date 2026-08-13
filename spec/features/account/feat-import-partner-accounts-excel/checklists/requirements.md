# Requirements Checklist: Import Excel tài khoản Đối tác/Khách hàng tạm thời

- **Feature ID**: PTA-IMPORT-001
- **Created**: 2026-08-12

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | Khởi tạo checklist yêu cầu | Toàn bộ file |

---

## 1. Scope & Constitution
- [ ] Không thêm/xóa/đổi bảng DB (dùng nguyên cột `users.account_expires_at` + department PARTNER đã có từ PTA-001)
- [ ] Không thêm bảng lịch sử import
- [ ] Không xử lý async/background cho parse-import (sync + cap 50 dòng)
- [ ] Không đổi hành vi `persistAccount()`/`createUser()` đơn lẻ (PTA-001)
- [ ] Không đổi hành vi `AccountImportService` (import nhân viên, `ACCT-IMPORT-ACCOUNT-001`)
- [ ] Dùng `exceljs`, `jszip`, `CloudinaryService`, `buildPartnerAccountWelcomeEmail` sẵn có

## 2. API & Contract
- [ ] `POST /users/import-partners` (multipart, cờ `commit`, field `photos`/`photosZip`/`defaultExpiresInDays`)
- [ ] `GET /users/import-partners/template` trả `.xlsx` 5 cột
- [ ] `commit=false` → preview, không ghi DB, KHÔNG gọi Cloudinary
- [ ] `commit=true` → tạo dòng hợp lệ, bỏ dòng lỗi
- [ ] Response bọc `{ success, message, data, error }`
- [ ] KHÔNG có field `biometricConsentConfirmed` (khác import nhân viên, theo đúng hành vi PTA-001)

## 3. Auth & Permission
- [ ] Permission MỚI `account.partner.import` được seed (KHÔNG tái dùng `accounts.user.import`/`account.partner.manage`)
- [ ] Danh sách role được gán đã xác nhận với Thiếu Chủ (mặc định đề xuất: MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN)
- [ ] Endpoint gate `JwtAuthGuard` + `PermissionsGuard`, KHÔNG cần thêm permission thứ 2

## 4. Parsing & Validation
- [ ] Chỉ nhận `.xlsx` → `INVALID_FILE_FORMAT`
- [ ] Giới hạn dung lượng Excel (2MB) → `FILE_TOO_LARGE`
- [ ] Header đúng 5 cột, sai → `INVALID_TEMPLATE`
- [ ] > `MAX_PARTNER_IMPORT_ROWS` (50) → `IMPORT_ROW_LIMIT_EXCEEDED`
- [ ] `.zip` ảnh lỗi/quá lớn/quá entry → `INVALID_PHOTOS_ZIP`
- [ ] `defaultExpiresInDays` không phải số nguyên dương → `INVALID_DEFAULT_EXPIRES_IN_DAYS`
- [ ] Gắn số dòng gốc vào kết quả
- [ ] Dòng lỗi bôi đỏ trong preview + loại khỏi tạo

## 5. Resolution & Duplicate
- [ ] `department_id` LUÔN ép cứng `PARTNER_DEPARTMENT_ID` (không đọc từ input)
- [ ] `role` LUÔN ép cứng `EMPLOYEE` (resolve 1 lần/batch qua `role_code`, không có cột `role_codes`)
- [ ] Thiếu bắt buộc (`full_name`/`email`) → `MISSING_REQUIRED_FIELD`
- [ ] Email sai định dạng → `INVALID_EMAIL`
- [ ] Trùng email trong file → `DUPLICATE_IN_FILE`
- [ ] Email tồn tại DB (bất kỳ loại tài khoản) → `EMAIL_ALREADY_EXISTS`
- [ ] `account_expires_at` resolve đúng: cột HOẶC `defaultExpiresInDays`, thiếu cả 2 → `MISSING_ACCOUNT_EXPIRES_AT`
- [ ] `account_expires_at` không parse được → `INVALID_ACCOUNT_EXPIRES_AT`
- [ ] `account_expires_at` không ở tương lai → `ACCOUNT_EXPIRES_AT_MUST_BE_FUTURE`

## 6. Ảnh sinh trắc học — BẮT BUỘC (khác hẳn import nhân viên)
- [ ] Khớp ảnh theo `email` (basename, không phân biệt hoa/thường, bỏ đuôi mở rộng) — KHÔNG phải `employee_code`
- [ ] Không có ảnh khớp → dòng lỗi `PARTNER_PHOTO_REQUIRED`, CHẶN tạo tài khoản (không phải best-effort)
- [ ] Preview CHỈ kiểm tra sự tồn tại của ảnh khớp, KHÔNG upload/gọi Cloudinary
- [ ] Commit: upload + validate magic-bytes (JPEG/PNG/WEBP) + size ≤5MB — lỗi ở bước này làm dòng `failed`
- [ ] `face_profiles` tạo thẳng `status=active` (bỏ qua `pending_review`) — mirror PTA-001

## 7. Persistence
- [ ] Reuse NGUYÊN `UsersService.persistAccount()` — KHÔNG viết lại logic tạo user
- [ ] Mỗi tài khoản atomic (user + user_roles + media_files + face_profiles + audit)
- [ ] `account_status='active'`, `employment_status='active'`, `must_change_password=false`
- [ ] Report `totalRows/validCount/invalidCount` (preview) và `successCount/failedCount` (commit)

## 8. Biển số xe (tùy chọn, best-effort — tái dùng `ACCT-IMPORT-ACCOUNT-001`)
- [ ] Cột `license_plate` optional trong sheet
- [ ] Đăng ký qua `VehicleRegistrationService.register()` sau khi tài khoản tạo thành công
- [ ] Lỗi biển số KHÔNG BAO GIỜ làm fail dòng tài khoản — chỉ set `vehiclePlateStatus`

## 9. Notification
- [ ] Mỗi tài khoản tạo mới → 1 email dùng `buildPartnerAccountWelcomeEmail()` (KHÁC template nhân viên)
- [ ] Email best-effort; lỗi không rollback account, ghi audit `NOTIFICATION_ENQUEUE_FAILED`

## 10. Audit
- [ ] Audit per-row `account.partner.create` (TỰ ĐỘNG qua `persistAccount`, không code thêm)
- [ ] Audit tổng `PARTNER_ACCOUNT_IMPORT` với số liệu (totalRows, successCount, failedCount)

## 11. Security
- [ ] KHÔNG trả mật khẩu trong response (dù = email)
- [ ] KHÔNG log ảnh buffer/nội dung nhạy cảm
- [ ] File/ảnh parse trong memory, không lưu DB trước khi commit
- [ ] Chặn zip-bomb: `MAX_PHOTOS_ZIP_BYTES` + tổng giải nén + số entry (mirror `ACCT-IMPORT-ACCOUNT-001`)
- [ ] Validate MIME + size trước khi parse Excel

## 12. Testing
- [ ] Unit test parser (header/rỗng/limit)
- [ ] Unit test resolver (`account_expires_at`, khớp ảnh, email exists)
- [ ] Unit test preview (không ghi DB, không gọi Cloudinary) + commit (partial success)
- [ ] Unit test department/role ép cứng + must_change_password=false
- [ ] Unit test `license_plate` best-effort
- [ ] Unit test notification per-account + best-effort
- [ ] Regression: `users.service.spec.ts` + `account-import.service.spec.ts` vẫn xanh, không sửa
- [ ] Controller test (preview/commit/file errors/template/permission)
- [ ] `npm run build` pass
- [ ] `npm run lint` pass
- [ ] Đo thời gian thật với 50 dòng ảnh thật trước khi công bố cho FE
