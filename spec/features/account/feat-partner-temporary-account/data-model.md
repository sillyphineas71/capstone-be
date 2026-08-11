# Data Model: Partner Temporary Account (PTA-001)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-11 | Khởi tạo data-model, chuyển thể từ `KE_HOACH_TAI_KHOAN_DOI_TAC_TAM_THOI_2026-08-11.md` | Toàn bộ file |

## 1. User (`users`)

### Purpose
Lưu tài khoản đối tác như một user thật, phân biệt với nhân viên thường bằng `department_id` + có thêm hạn dùng.

### Fields used in this feature

| Field | Thay đổi trong feature này |
|---|---|
| `id` | Không đổi |
| `department_id` | Trỏ tới `PARTNER_DEPARTMENT_ID` (hằng số cố định, mục 3) cho tài khoản đối tác |
| `email` | Không đổi format/validation; dùng làm input để hash thành `password_hash` (chỉ riêng luồng tạo tài khoản đối tác) |
| `password_hash` | **Đối tác**: `bcrypt.hash(email, salt)`. **User thường**: giữ nguyên `generateTemporaryPassword()` (không đổi) |
| `must_change_password` | **Đối tác**: `false` (không ép đổi). **User thường**: giữ nguyên `true` (không đổi) |
| `account_status` | Không đổi ý nghĩa — vẫn `active`/`inactive`/`locked` như hiện có |
| `account_expires_at` | **CỘT MỚI** — `timestamptz NULL`. `NULL` = không giới hạn (user thường). Có giá trị = hạn dùng tài khoản đối tác |
| `employee_code`, `position_title`, `phone_number`, ... | Không đổi, dùng như user thường (có thể để trống nếu không áp dụng cho đối tác) |

### Constraints
- `account_expires_at` không có ràng buộc DB-level đặc biệt (không CHECK constraint) — validate ở tầng ứng dụng (phải là thời điểm tương lai lúc tạo/gia hạn).
- Không có unique constraint mới liên quan cột này.

## 2. Department (`departments`)

### Purpose
Đóng vai trò "nhãn" đánh dấu tài khoản đối tác, thông qua 1 row cố định được seed sẵn.

### Fields used in this feature

| Field | Giá trị seed |
|---|---|
| `id` | UUID cố định, hard-code trong migration VÀ trong `common/utils/partner-account.util.ts` (KHÔNG dùng `uuid_generate_v4()`) |
| `department_code` | `PARTNER` |
| `department_name` | `Đối tác` |
| `is_active` | `true` |

### Constraints
- **Bảo vệ ở tầng service** (không phải DB constraint): `DepartmentsService.update()`/`remove()` phải từ chối thao tác nếu `id === PARTNER_DEPARTMENT_ID`, bất kể actor là ai (kể cả `SYSTEM_ADMIN`).
- Row này KHÔNG có cột đặc biệt đánh dấu "protected" trong schema hiện tại — bảo vệ hoàn toàn bằng logic code, không bằng DB.

## 3. Face Profile (`face_profiles`)

### Purpose
Thoả mãn `BiometricEnforcementGuard` cho tài khoản đối tác ngay từ lúc tạo, không qua hàng chờ duyệt.

### Fields used in this feature

| Field | Giá trị khi tạo tài khoản đối tác |
|---|---|
| `user_id` | Id tài khoản đối tác vừa tạo |
| `status` | `FaceProfileStatus.ACTIVE` (KHÔNG phải `PENDING_REVIEW` mặc định của luồng self-submit) |
| `enrolled_by` | Id của admin/host thực hiện tạo tài khoản |
| `enrolled_at` | `now()` |
| `consent_at` | `NULL`, hoặc ghi chú trong `metadata_json` rằng đây là ảnh do admin import hộ (KHÔNG giả lập như đối tác tự bấm "đồng ý") |
| `primary_image_file_id` | Id file ảnh đã upload (tái dùng pipeline `CloudinaryService` của luồng self-submit) |
| `metadata_json` | Đề xuất: `{ "importedBy": "admin", "importSource": "partner-account-provisioning" }` |

### Constraints
- Ràng buộc `ux_face_profiles_user_pending` (unique index CHỈ áp dụng cho row `status = pending_review`) **không bị ảnh hưởng** — luồng này chèn thẳng `status = active`, không tạo row `pending_review` nào.

## 4. User Role (`user_roles`)

### Purpose
Gán role `EMPLOYEE` cho tài khoản đối tác — không khác gì luồng gán role cho user thường.

### Constraints
- Không có thay đổi so với luồng hiện có.

## 5. Audit Log (`audit_logs`)

### Purpose
Lưu vết vòng đời tài khoản đối tác (tạo/gia hạn/khoá sớm).

### Fields expected
- `actor_id` = admin/host thực hiện hành động.
- `action` = `account.partner.create` | `account.partner.extend` | `account.partner.lock_early`.
- `target_id` = id tài khoản đối tác.
- `occurred_at`, metadata liên quan (`accountExpiresAt` cũ/mới nếu là gia hạn).

## 6. Meeting Participant (`meeting_participants`)

### Purpose
Không có thay đổi schema/logic — tài khoản đối tác được thêm vào đúng như user thường qua `addInternalParticipant` (FR-PTA-008).

## 7. Derived / transient values

- `isPartnerAccount(user)`: giá trị tính toán runtime (`department_id === PARTNER_DEPARTMENT_ID`), không phải cột persisted.
- `effectiveStatus` (hiển thị cho admin: `active` | `expired`): tính tại thời điểm đọc từ `account_status` + `account_expires_at`, KHÔNG ghi ngược vào `account_status` (tránh 2 nguồn sự thật lệch nhau).

## 8. Không có Redis / cache mới

Khác `GLA-001` (dùng nhiều key Redis cho OTP/lobby/session), feature này **không cần Redis** — toàn bộ enforcement (hết hạn, giới hạn phạm vi) đọc trực tiếp từ `users.account_expires_at`/`department_id` mỗi request, đúng pattern "query DB mỗi request, không cache" mà `BiometricEnforcementGuard`/`MustChangePasswordGuard` hiện có đã chấp nhận.

## 9. Cần làm rõ khi implement

- `departments` hiện không có cột đánh dấu "protected/system row" — xác nhận có cần thêm cột này (ví dụ `is_protected boolean`) hay bảo vệ hoàn toàn bằng code là đủ (khuyến nghị: đủ, không thêm cột mới ngoài phạm vi đã duyệt).
- DTO của endpoint tạo/update user hiện có (`create-user.dto.ts` hoặc tương đương) cần audit để xác nhận cấu trúc mở rộng phù hợp cho field `accountType`, `accountExpiresAt`, `avatarFile`.
