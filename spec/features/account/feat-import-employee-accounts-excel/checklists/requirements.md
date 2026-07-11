# Requirements Checklist: Tạo tài khoản nhân viên bằng import Excel

- **Feature ID**: ACCT-IMPORT-ACCOUNT-001
- **Created**: 2026-07-10

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo checklist yêu cầu cho import tài khoản Excel | Toàn bộ file |

---

## 1. Scope & Constitution
- [ ] Không thêm/xóa/đổi bảng DB (v3.2 Compact giữ nguyên)
- [ ] Không thêm bảng lịch sử import
- [ ] Không xử lý async/background cho parse-import (sync + cap dòng)
- [ ] Không đổi hành vi `createUser` đơn lẻ
- [ ] Dùng `exceljs`, `PasswordGeneratorService`, `NotificationsService` sẵn có

## 2. API & Contract
- [ ] `POST /users/import` (multipart, cờ `commit`)
- [ ] `GET /users/import/template` trả `.xlsx`
- [ ] `commit=false` → preview, không ghi DB
- [ ] `commit=true` → tạo dòng hợp lệ, bỏ dòng lỗi
- [ ] Response bọc `{ success, message, data, error }`

## 3. Auth & Permission
- [ ] Permission `accounts.user.import` được seed (hoặc tái dùng `accounts.user.create` nếu team chốt)
- [ ] Gán role có `accounts.user.create` (Business Admin/ADMIN)
- [ ] Endpoint gate `JwtAuthGuard` + `PermissionsGuard`

## 4. Parsing & Validation (EX1/EX2)
- [ ] Chỉ nhận `.xlsx` → `INVALID_FILE_FORMAT`
- [ ] Giới hạn dung lượng → `FILE_TOO_LARGE`
- [ ] Header đúng 8 cột, sai → `INVALID_TEMPLATE`
- [ ] > `MAX_IMPORT_ROWS` (200) → `IMPORT_ROW_LIMIT_EXCEEDED`
- [ ] Gắn số dòng gốc vào kết quả
- [ ] Dòng lỗi bôi đỏ trong preview + loại khỏi tạo (EX2)

## 5. Resolution & Duplicate
- [ ] Resolve `department_code` → department active
- [ ] Resolve `role_codes` (nhiều, `;`) → roles active
- [ ] Resolve `direct_manager_email` → user active (nếu có)
- [ ] Thiếu bắt buộc → `MISSING_REQUIRED_FIELD`
- [ ] Email sai định dạng → `INVALID_EMAIL`
- [ ] Trùng email trong file → `DUPLICATE_IN_FILE`
- [ ] Email tồn tại DB → `EMAIL_ALREADY_EXISTS`
- [ ] Mã NV tồn tại → `EMPLOYEE_CODE_ALREADY_EXISTS`

## 6. Business Rules (UC)
- [ ] BR1: mật khẩu ngẫu nhiên ≥8 ký tự đủ 4 loại (reuse PasswordGeneratorService)
- [ ] BR2: partial success — dòng lỗi không chặn dòng hợp lệ (per-row transaction)
- [ ] BR3: `must_change_password=true`
- [ ] BR4: `username=email`, không dùng username để đăng nhập

## 7. Persistence
- [ ] Reuse lõi `persistAccount` (extract từ `createUser`)
- [ ] Mỗi tài khoản atomic (user + user_roles + audit)
- [ ] `account_status='active'`, `employment_status='active'`
- [ ] Report `totalRows/validCount/invalidCount` (preview) và `successCount/failedCount` (commit)

## 8. Notification (POST-2)
- [ ] Mỗi tài khoản tạo mới → 1 email credentials (email + mật khẩu tạm)
- [ ] Email best-effort; lỗi không rollback account, ghi audit `NOTIFICATION_ENQUEUE_FAILED`

## 9. Audit
- [ ] Audit per-row `ACCOUNT_CREATE`
- [ ] Audit tổng `ACCOUNT_IMPORT` với số liệu

## 10. Security
- [ ] KHÔNG trả mật khẩu tạm trong response (NFR-004)
- [ ] KHÔNG log mật khẩu tạm/hash (NFR-005)
- [ ] File parse trong memory, không lưu DB
- [ ] Validate MIME + size trước khi parse

## 11. Testing
- [ ] Unit test parser (header/rỗng/limit)
- [ ] Unit test resolver (department/role/manager/duplicate/email exists)
- [ ] Unit test preview (không ghi DB) + commit (partial success)
- [ ] Unit test BR1/BR3/BR4 + NFR-004
- [ ] Unit test notification per-account + best-effort
- [ ] Regression `createUser` sau refactor extract
- [ ] Controller test (preview/commit/file errors/template)
- [ ] `npm run build` pass
- [ ] `npm run lint` pass
