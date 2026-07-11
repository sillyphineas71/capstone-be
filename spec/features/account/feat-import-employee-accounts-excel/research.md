# Research: Tạo tài khoản nhân viên bằng import Excel

- **Feature ID**: ACCT-IMPORT-ACCOUNT-001
- **Created**: 2026-07-10

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo research: khảo sát luồng tạo tài khoản đơn lẻ, chốt hướng tái sử dụng | Toàn bộ file |

---

## 1. Mục tiêu
Xác định thành phần tái sử dụng để không viết lại nghiệp vụ tạo tài khoản, và làm rõ khác biệt giữa "tạo 1 tài khoản (UUID input)" và "import Excel (mã/tên input)".

---

## 2. Phát hiện chính (đã verify)

### 2.1 Luồng tạo tài khoản đơn lẻ — `users.service.ts` `createUser()`
Đã chứa đủ nghiệp vụ UC-AM-02 cần:
- Duplicate email → `ACCOUNT_EMAIL_ALREADY_EXISTS`; duplicate username (`=email`); employee_code unique.
- Department active check; roles active check; manager active check.
- Sinh mật khẩu: `PasswordGeneratorService.generateTemporaryPassword(12)` → bcrypt `genSalt(10)` + `hash`.
- Set `username = email`, `account_status='active'`, `employment_status='active'`, **`must_change_password=true`**.
- Gán `user_roles` (`assigned_by`, `is_active=true`).
- Audit `ACCOUNT_CREATE`.
- Sau transaction: `enqueueEmailNotification` gửi email credentials (email + mật khẩu tạm trong nội dung), **mỗi user một email** (`toEmails=[email]`), best-effort; lỗi enqueue ghi audit `NOTIFICATION_ENQUEUE_FAILED`, không rollback.

### 2.2 Ánh xạ Business Rules UC → code có sẵn
| BR | Mô tả | Đã có |
|---|---|---|
| BR1 | Mật khẩu ≥8 ký tự đủ 4 loại | `PasswordGeneratorService` (mặc định độ dài 12, đủ 4 loại) |
| BR2 | Partial success, dòng lỗi không chặn dòng khác | → thiết kế per-row transaction trong import |
| BR3 | Bắt buộc đổi mật khẩu lần đầu | `must_change_password=true` |
| BR4 | Email làm định danh, không dùng username | `username=email` (điền cột NOT NULL) |

### 2.3 Entity fields
- `users`: `username` **NOT NULL** (varchar 100), `email`, `password_hash` (`select:false`), `full_name`, `employee_code` (nullable), `department_id`, `direct_manager_id`, `position_title`, `phone_number`, `employment_status`, `account_status`, `must_change_password`.
- `departments`: `department_code` (unique index), `department_name` (unique index), `is_active`.
- `roles`: `role_code`, `role_name`, `is_active`, `is_system_role`.

### 2.4 Permission
- Tạo đơn lẻ dùng `accounts.user.create` (`users.controller.ts`).

### 2.5 Upload & Excel
- `FileInterceptor('file')` (avatar) — pattern upload chuẩn.
- `exceljs` sẵn có — parse + generate template.

---

## 3. Khác biệt "tạo 1" vs "import" & quyết định thiết kế

### 3.1 Định danh không phải UUID
`createUser` nhận `departmentId` (UUID) + `roleIds` (UUID[]). Excel do admin điền → không có UUID.
**Quyết định (đã chốt với team):**
- Department: resolve qua **`department_code`** (unique).
- Roles: cột **`role_codes`** (cho phép nhiều, phân tách `;`), resolve qua `role_code`.
- Manager (tuỳ chọn): resolve qua **`direct_manager_email`**.

### 3.2 Cột username NOT NULL vs BR4
DB bắt buộc `username`. Giữ nhất quán luồng đơn lẻ: import set `username = email`. BR4 (không dùng username để đăng nhập) vẫn thỏa vì login dùng email; username chỉ là cột nội bộ.

### 3.3 Preview 2 bước (yêu cầu cứng UC)
UC Normal Flow bước 5-6 = "Tải lên & Kiểm tra" (preview) → "Tiến hành tạo tài khoản" (commit).
**Quyết định:** 1 endpoint `POST /users/import` với cờ `commit` (default `false`):
- `commit=false` → validate + preview, **không ghi DB**.
- `commit=true` → tạo dòng hợp lệ, bỏ dòng lỗi (BR2).
- Server không lưu file giữa 2 lần → client gửi lại cùng file khi commit.

### 3.4 Sync + cap
Đồng bộ, `MAX_IMPORT_ROWS=200`, file ≤2MB. Lưu ý bcrypt per-row tốn CPU → cap giúp giữ thời gian phản hồi hợp lý.

### 3.5 Email bắt buộc, per-user, best-effort
Tài khoản mới chưa đăng nhập được → **không có kênh in-app**, email là bắt buộc (khác feature meeting import). Mỗi tài khoản 1 email credentials (chứa mật khẩu tạm), enqueue riêng, best-effort như luồng đơn lẻ.
- **Ràng buộc vận hành**: gói mail free có giới hạn/ngày → nếu lô lớn có thể chạm quota. v1 giữ best-effort + ghi audit khi lỗi; throttle/rate là cân nhắc tương lai (Out of Scope v1).

### 3.6 Refactor extract lõi tạo tài khoản
`createUser` gộp resolve-by-UUID + create + email trong 1 hàm. Import cần resolve-by-code (batch, ở preview) + create per-row (commit) + email per-row.
**Quyết định:** tách private method `persistAccount(em, resolvedData, creatorId, ctx): { userId, tempPassword }` (sinh mật khẩu + hash + insert user + user_roles + audit `ACCOUNT_CREATE`, **KHÔNG** email). Dùng chung:
- `createUser` đơn lẻ: resolve UUID → `persistAccount` → enqueue email (giữ hành vi cũ).
- Import: resolve code (preview) → per-row `persistAccount` → enqueue email per-row.
Không đổi contract/hành vi API đơn lẻ (cần test hồi quy).

---

## 4. Alternatives đã cân nhắc & lý do loại
| Alternative | Lý do loại |
|---|---|
| Resolve department qua tên | Dễ sai chính tả/khoảng trắng; code unique ổn định hơn (đã chọn code) |
| Gán role mặc định cứng | Kém linh hoạt; team chọn cột `role_codes` để đúng RBAC |
| All-or-nothing cả file | Vi phạm BR2 (partial success) |
| Async background job | Over-engineering cho capstone; ≤200 dòng sync đủ |
| Trả mật khẩu tạm trong response | Rủi ro bảo mật; chỉ gửi qua email (NFR-004) |
| Viết lại logic tạo trong import | Vi phạm CLAUDE.md §15; lệch nghiệp vụ |
| Thêm bảng lịch sử import | Vi phạm "không thêm bảng khi chưa cần" (§5.4) |

---

## 5. Rủi ro & lưu ý
- Refactor extract `persistAccount` phải giữ nguyên hành vi `createUser` đơn lẻ → test hồi quy bắt buộc.
- bcrypt per-row (200 dòng) có thể chậm → đo thời gian, cap dòng.
- Quota mail: log số email enqueue mỗi phiên để theo dõi.
- Không log mật khẩu tạm ở bất kỳ đâu (audit/log).
