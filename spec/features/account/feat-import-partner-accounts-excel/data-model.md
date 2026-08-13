# Data Model: Import Excel tài khoản Đối tác/Khách hàng tạm thời

- **Feature ID**: PTA-IMPORT-001
- **Created**: 2026-08-12

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-12 | Khởi tạo data-model | Toàn bộ file |

---

## 1. Entity Impact

### 1.1 Entities đọc (READ)
| Entity / Table | Fields đọc | Mục đích |
|---|---|---|
| `users` | `id`, `email`, `deleted_at` | Duplicate email (chung mọi loại tài khoản) |
| `departments` | `id`, `is_active` | Xác nhận `PARTNER_DEPARTMENT_ID` còn active |
| `roles` | `id`, `role_code`, `is_active` | Resolve `role_code='EMPLOYEE'` (1 lần/batch) |

### 1.2 Entities ghi (CREATE) — mỗi dòng hợp lệ khi `commit=true`
| Entity / Table | Action | Fields ghi |
|---|---|---|
| `users` | INSERT (qua `persistAccount`) | `full_name`, `email`, `username=email`, `password_hash=bcrypt(email)`, `department_id=PARTNER_DEPARTMENT_ID`, `employee_code=null`, `phone_number?`, `position_title=null`, `direct_manager_id=null`, `employment_status='active'`, `account_status='active'`, `must_change_password=false`, `account_expires_at` (đã resolve — cột hoặc `defaultExpiresInDays`) |
| `user_roles` | INSERT | `user_id`, `role_id` (= id role `EMPLOYEE`), `assigned_by=actor.id`, `is_active=true` |
| `media_files` | INSERT (qua `persistAccount`) | `file_type='image'`, `storage_provider='cloud_provider'`, `storage_key`, `file_url`, `related_entity_type='face_profile'`, `uploaded_by=actor.id` |
| `face_profiles` | INSERT (qua `persistAccount`) | `status='active'`, `enrolled_by=actor.id`, `metadata_json={importSource:'partner-account-provisioning'}` |
| `vehicle_registrations` | INSERT (best-effort, nếu có `license_plate`) | `user_id`, `plate_raw`, `plate_number` (normalized), `status='active'` |
| `notifications` | INSERT (mỗi user) | `notification_type='ACCOUNT_WELCOME'`, `channel='EMAIL'`, nội dung dùng `buildPartnerAccountWelcomeEmail` |
| `background_jobs` | INSERT (mỗi user) | `job_type='SEND_EMAIL'`, `related_entity_type='users'` |
| `audit_logs` | INSERT | per-row `action_type='account.partner.create'` (tự động qua `persistAccount`, KHÔNG cần code thêm); tổng `action_type='PARTNER_ACCOUNT_IMPORT'` (`new_value_json={totalRows, successCount, failedCount}`) |

---

## 2. Không thay đổi Schema
Feature này **KHÔNG thay đổi database schema**. Toàn bộ cột cần thiết (`users.account_expires_at`, `departments` row PARTNER) đã tồn tại từ `PTA-001` (migration `20260811000001`/`20260811000002`, đã áp lên RDS chung). Chỉ thêm **1 permission mới** (`account.partner.import`, migration mới) — không đụng bảng.

---

## 3. Ràng buộc & lưu ý dữ liệu
- `department_id` **luôn** = `PARTNER_DEPARTMENT_ID` (hằng số cố định, KHÔNG resolve từ input) — khác hẳn import nhân viên (resolve tự do từ `department_code`).
- `role_id` resolve **1 lần cho cả batch** (không phải mỗi dòng) theo `role_code='EMPLOYEE'` — nếu role này bị vô hiệu hoá (`is_active=false`), TOÀN BỘ batch lỗi cấp request (không riêng từng dòng), vì đây là điều kiện tiên quyết chung.
- `password_hash = bcrypt(data.email)` — do `persistAccount()` tự quyết định khi `data.partner` có giá trị, KHÔNG cần service mới tự hash.
- `account_expires_at` **hiệu lực** = giá trị cột Excel (nếu có, đã validate tương lai) HOẶC `now() + defaultExpiresInDays` (tính lại tại từng thời điểm gọi — preview và commit có thể lệch vài phút, chấp nhận được, KHÔNG lưu snapshot giữa 2 lần gọi).
- Duplicate email check dùng `deleted_at IS NULL`, **không phân biệt loại tài khoản** — 1 email chỉ gắn được 1 user dù là nhân viên hay đối tác (đúng ràng buộc unique hiện có của `users.email`).
- `license_plate` (nếu có) đi qua đúng `VehicleRegistrationService.register()` — không có bảng/cột mới, dùng nguyên `vehicle_registrations` đã có từ trước.

---

## 4. Cấu trúc file Excel (contract dữ liệu đầu vào)

Sheet 1 — dữ liệu:

| Cột (header) | Bắt buộc | Ghi chú |
|---|---|---|
| `full_name` | ✅ | Họ tên đối tác |
| `email` | ✅ | Định danh đăng nhập; `username=email`; **cũng là mật khẩu ban đầu** |
| `account_expires_at` | ⚠️ Có điều kiện | ISO date/datetime. Bỏ trống được **CHỈ KHI** request có `defaultExpiresInDays` |
| `phone_number` | ❌ | Tùy chọn |
| `license_plate` | ❌ | Tùy chọn, best-effort — biển số xe (tái dùng `ACCT-IMPORT-ACCOUNT-001`) |

**KHÔNG có** `department_code`, `role_codes`, `employee_code`, `position_title`, `direct_manager_email` — không áp dụng cho tài khoản đối tác (xem `spec.md` mục 1.6, mục 9 Out of Scope).

Sheet 2 (hướng dẫn) — giải thích từng cột + nhắc rõ: **ảnh sinh trắc học là bắt buộc**, đặt tên file = email của dòng tương ứng (không phân biệt hoa/thường, bỏ đuôi mở rộng).

---

## 5. Kết quả import (in-memory DTO, không lưu DB)

```ts
interface ImportPartnerAccountRowResult {
  row: number;
  email: string;
  status: 'valid' | 'invalid' | 'success' | 'failed';
  reason?: string;                  // mã lỗi, vd PARTNER_PHOTO_REQUIRED
  userId?: string;                  // khi status='success'
  accountExpiresAt?: string;        // ISO — khi status='valid'|'success', giá trị ĐÃ resolve
  vehiclePlateStatus?: string;      // chỉ có khi dòng điền license_plate — tái dùng enum ImportAccountVehiclePlateStatus
}

interface ImportPartnerAccountReportDto {
  mode: 'preview' | 'commit';
  totalRows: number;
  validCount?: number;              // preview
  invalidCount?: number;            // preview
  successCount?: number;            // commit
  failedCount?: number;             // commit
  results: ImportPartnerAccountRowResult[];
}
```

- **preview** (`commit=false`): `status` ∈ {`valid`, `invalid`}; `accountExpiresAt` hiển thị giá trị đã resolve để admin xác nhận trước khi commit thật.
- **commit** (`commit=true`): `status` ∈ {`success`, `failed`}.
- **Không** chứa mật khẩu ở bất kỳ trường nào (dù mật khẩu = email, không lặp lại trong response để giữ nguyên tắc NFR-004 của `ACCT-IMPORT-ACCOUNT-001`).

---

## 6. Redis / Cache không dùng
Không dùng cache/Redis. Không lưu file/ảnh giữa 2 lần gọi — client gửi lại đúng file Excel + ảnh khi `commit=true` (mirror `ACCT-IMPORT-ACCOUNT-001`).
