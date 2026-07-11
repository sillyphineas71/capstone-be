# Feature Specification: Tạo tài khoản nhân viên bằng import Excel

- **Feature ID**: ACCT-IMPORT-ACCOUNT-001
- **Feature Name**: Tạo tài khoản nhân viên bằng import Excel (Bulk Create Employee Accounts via Excel)
- **Module / Domain**: accounts
- **Created Date**: 2026-07-10
- **Status**: Draft
- **Source Documents**:
  - UC-AM-02 Tạo tài khoản nhân viên bằng import Excel
  - ACCT-CREATE-ACCOUNT-001 (Tạo tài khoản đơn lẻ — `users.service.createUser`)
  - Database v3.2 Compact (39 Tables)
  - CLAUDE.md / AGENTS.md (Backend Agent Guide v1.1)

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo spec cho tính năng tạo tài khoản nhân viên bằng import Excel (UC-AM-02) | Toàn bộ file |

---

## 1. Context & Goal

### 1.1 Bối cảnh
Khi có danh sách nhân sự mới cần cấp tài khoản đồng loạt, việc tạo từng tài khoản một qua giao diện đơn lẻ rất tốn thời gian. Business Admin cần một cách nạp danh sách từ file Excel để tạo hàng loạt, kèm bản xem trước (preview) kiểm tra hợp lệ trước khi tạo thật.

### 1.2 Mục tiêu
Cho phép **Business Admin** tải lên file Excel danh sách nhân viên, hệ thống kiểm tra hợp lệ, hiển thị preview, và sau khi admin xác nhận thì khởi tạo tài khoản cho các dòng hợp lệ, sinh mật khẩu tạm ngẫu nhiên và gửi email credentials cho từng người — tái sử dụng toàn bộ nghiệp vụ của luồng tạo tài khoản đơn lẻ.

### 1.3 Giá trị mang lại
- **Hiệu suất**: Tạo hàng chục tài khoản trong một thao tác.
- **An toàn**: Preview trước khi tạo, giảm rủi ro tạo nhầm; dòng lỗi bị loại, không chặn dòng hợp lệ (BR2).
- **Chuẩn hóa**: Mật khẩu tạm đạt chuẩn (BR1), bắt buộc đổi mật khẩu lần đầu (BR3), định danh bằng email (BR4).

### 1.4 Giả định
- Danh sách `departments` và `roles` đã tồn tại và active để resolve theo `department_code` / `role_code`.
- Dịch vụ gửi email hoạt động (qua `notifications` + `background_jobs`), dùng gói miễn phí có giới hạn/ngày.
- Thư viện `exceljs` (đã có) dùng để parse/generate template.

---

## 2. Actor & Roles

### 2.1 Danh sách actor
| Actor | Vai trò | Quyền |
|---|---|---|
| Business Admin | Người thực hiện import | Có permission `accounts.user.import` (mới) — tương đương phạm vi `accounts.user.create` |

### 2.2 Role & Permission Rules
- Phải có permission **`accounts.user.import`** (khuyến nghị tạo mới, granular; có thể tái dùng `accounts.user.create` nếu team muốn gọn — xem `plan.md`).
- Gán permission mới cho các role hiện đang có `accounts.user.create` (Business Admin / ADMIN).

### 2.3 Actor Constraints
- Actor đã đăng nhập và đang `active`.

---

## 2.4 User Scenarios & Workflow

### 2.4.1 Preconditions
- PRE-1: Actor đã đăng nhập, có quyền quản lý tài khoản (`accounts.user.import`).
- PRE-2: Actor có file Excel đúng cấu trúc template.

### 2.4.2 Postconditions
- POST-1: Các tài khoản hợp lệ được tạo, `account_status='active'`, sẵn sàng hoạt động.
- POST-2: Hệ thống đã phát lệnh gửi email chứa email đăng nhập + mật khẩu tạm cho từng tài khoản mới.

### 2.4.3 Normal Flow (khớp UC)
1. Actor vào "Quản lý tài khoản" → chọn "Nhập danh sách từ Excel".
2. Hệ thống hiển thị giao diện upload + tùy chọn tải template mẫu.
3. Actor chọn file, nhấn "Tải lên & Kiểm tra" (`POST .../import` với `commit=false`).
4. Hệ thống parse file, validate toàn bộ dữ liệu (cấu trúc, resolve department/role, duplicate, email tồn tại).
5. Hệ thống trả **preview**: tổng số dòng hợp lệ + danh sách dòng lỗi kèm lý do. **Không ghi DB.**
6. Actor xem báo cáo, xác nhận, gọi lại (`commit=true`) để "Tiến hành tạo tài khoản" cho các dòng hợp lệ.
7. Hệ thống tạo từng tài khoản: sinh mật khẩu tạm ngẫu nhiên đạt chuẩn (BR1), hash, `must_change_password=true` (BR3), `username=email` (BR4), gán role, ghi audit.
8. Hệ thống enqueue email credentials (email + mật khẩu tạm) cho từng tài khoản mới.
9. Hệ thống trả thông báo tổng kết (`successCount`, `failedCount`) và client làm mới danh sách.

### 2.4.4 Alternative Flow — AF1: Tải template
- Tại bước 2, actor nhấn "Tải tệp mẫu" → `GET .../import/template` trả file `.xlsx` chuẩn (header + ví dụ + hướng dẫn).

### 2.4.5 Exceptions (khớp UC)
- **EX1**: File không phải `.xlsx`/`.xls` hoặc vượt dung lượng → hệ thống từ chối, trả lỗi request-level (`INVALID_FILE_FORMAT` / `FILE_TOO_LARGE`).
- **EX2**: Dòng thiếu thông tin bắt buộc, sai cấu trúc, hoặc email đã tồn tại → bôi đỏ trong preview, nêu lý do, **tự động loại** khỏi luồng tạo (không chặn dòng hợp lệ khác).

> Ghi chú định dạng: UC nêu chấp nhận `.xls`. DB/hạ tầng hiện dùng `exceljs` (tối ưu `.xlsx`). Phạm vi v1 hỗ trợ `.xlsx`; `.xls` xem mục Out of Scope.

---

## 3. Functional Requirements

### 3.1 File & Parsing
- **FR-001**: THE system SHALL cung cấp endpoint tải template `.xlsx` chứa header chuẩn + dòng ví dụ + sheet hướng dẫn.
- **FR-002**: THE system SHALL chỉ nhận `.xlsx` (MIME xlsx); định dạng khác → `400 INVALID_FILE_FORMAT`.
- **FR-003**: THE system SHALL giới hạn dung lượng file (mặc định ≤ 2MB); vượt → `400 FILE_TOO_LARGE`.
- **FR-004**: THE system SHALL parse bằng `exceljs`, đọc sheet đầu, map header: `full_name`, `email`, `department_code`, `role_codes`, `employee_code`, `phone_number`, `position_title`, `direct_manager_email`.
- **FR-005**: THE system SHALL từ chối file rỗng/sai header (`400 INVALID_TEMPLATE`) và file > `MAX_IMPORT_ROWS` (mặc định 200) (`400 IMPORT_ROW_LIMIT_EXCEEDED`).
- **FR-006**: THE system SHALL gắn số dòng gốc Excel vào từng kết quả.

### 3.2 Row Validation & Resolution
- **FR-007**: FOR EACH dòng, THE system SHALL bắt buộc `full_name`, `email`, `department_code`, `role_codes`; thiếu → lỗi dòng `MISSING_REQUIRED_FIELD`.
- **FR-008**: THE system SHALL validate `email` đúng định dạng (chuẩn hóa lowercase + trim); sai → `INVALID_EMAIL`.
- **FR-009**: THE system SHALL resolve `department_code` → `departments` active; không khớp/inactive → `DEPARTMENT_NOT_FOUND`.
- **FR-010**: THE system SHALL resolve `role_codes` (cho phép nhiều, phân tách bằng `;`) → `roles` active; bất kỳ code nào không khớp/inactive → `ROLE_NOT_FOUND`.
- **FR-011**: IF `direct_manager_email` có giá trị, THE system SHALL resolve → user active; không khớp → `MANAGER_NOT_FOUND`.
- **FR-012**: THE system SHALL phát hiện email trùng **trong file** → dòng sau `DUPLICATE_IN_FILE`, và trùng **trong DB** → `EMAIL_ALREADY_EXISTS`.
- **FR-013**: IF `employee_code` có giá trị và đã tồn tại trong DB, THE system SHALL đánh dòng lỗi `EMPLOYEE_CODE_ALREADY_EXISTS`.

### 3.3 Two-step Preview & Confirm
- **FR-014**: WHEN `commit=false` (mặc định), THE system SHALL trả **preview** (validCount + dòng lỗi + lý do) và **KHÔNG ghi bất kỳ dữ liệu nào**.
- **FR-015**: WHEN `commit=true`, THE system SHALL tạo tài khoản cho các dòng hợp lệ, bỏ qua dòng lỗi (BR2), trả báo cáo kết quả từng dòng.

### 3.4 Account Creation (reuse luồng đơn lẻ)
- **FR-016**: FOR EACH dòng hợp lệ, THE system SHALL sinh mật khẩu tạm ngẫu nhiên ≥ 8 ký tự đủ 4 loại (hoa/thường/số/đặc biệt) — reuse `PasswordGeneratorService` (BR1), hash bằng bcrypt.
- **FR-017**: THE system SHALL đặt `account_status='active'`, `employment_status='active'`, `must_change_password=true` (BR3), `username = email` (BR4).
- **FR-018**: THE system SHALL gán `user_roles` theo role đã resolve, `assigned_by = actor.id`.
- **FR-019**: THE system SHALL xử lý mỗi dòng trong **transaction riêng** (partial success theo BR2); một dòng lỗi runtime không rollback các dòng khác.
- **FR-020**: THE system SHALL ghi `audit_logs` `ACCOUNT_CREATE` cho mỗi tài khoản tạo mới và một audit tổng `ACCOUNT_IMPORT` cho phiên import.

### 3.5 Notification
- **FR-021**: WHEN một tài khoản được tạo, THE system SHALL enqueue **một email credentials riêng** cho tài khoản đó (email đăng nhập + mật khẩu tạm) qua `notifications` + `background_jobs`.
- **FR-022**: THE system SHALL xử lý gửi email best-effort; lỗi enqueue/gửi email KHÔNG rollback tài khoản đã tạo (ghi audit `NOTIFICATION_ENQUEUE_FAILED` như luồng đơn lẻ).

### 3.6 Processing Constraints
- **FR-023**: THE system SHALL xử lý **đồng bộ** trong giới hạn `MAX_IMPORT_ROWS`.

---

## 4. Non-functional Requirements
- **NFR-001**: THE system SHALL xử lý file ≤ 200 dòng và phản hồi dưới 15 giây trong điều kiện bình thường (bao gồm bcrypt hashing per-row).
- **NFR-002**: THE system SHALL không lưu file vào DB; chỉ parse trong memory (memoryStorage).
- **NFR-003**: THE system SHALL đảm bảo mỗi tài khoản tạo là atomic (user + user_roles + audit trong cùng transaction).
- **NFR-004**: THE system SHALL KHÔNG trả mật khẩu tạm trong response API; mật khẩu chỉ đi qua email.
- **NFR-005**: THE system SHALL KHÔNG log mật khẩu tạm/hash.

---

## 5. Data Model

### 5.1 Entity liên quan
| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `users` | Tạo tài khoản mới | INSERT. `username=email`, `password_hash`, `must_change_password=true` |
| `departments` | Resolve `department_code` | READ (active) |
| `roles` | Resolve `role_codes` | READ (active) |
| `user_roles` | Gán vai trò | INSERT |
| `notifications` | Email credentials | INSERT (mỗi user) |
| `background_jobs` | Job gửi email | INSERT (mỗi user) |
| `audit_logs` | `ACCOUNT_CREATE` per-row + `ACCOUNT_IMPORT` tổng | INSERT |

### 5.2 Business Rules Impact
- **KHÔNG thay đổi schema.** Mọi bảng đã có trong v3.2 Compact.
- Cột `users.username` NOT NULL vẫn được điền `= email` (BR4: định danh đăng nhập là email, không expose username).
- Không thêm bảng lịch sử import (trả kết quả trong response + audit tổng).

---

## 6. Error Handling & Validation Rules

### 6.1 Lỗi cấp request (toàn file)
| Case | HTTP | Mã lỗi |
|---|---|---|
| Không phải `.xlsx` | 400 | `INVALID_FILE_FORMAT` |
| Vượt dung lượng | 400 | `FILE_TOO_LARGE` |
| File rỗng / sai header | 400 | `INVALID_TEMPLATE` |
| Vượt số dòng tối đa | 400 | `IMPORT_ROW_LIMIT_EXCEEDED` |
| Thiếu quyền | 403 | `FORBIDDEN_ACCESS` |

### 6.2 Lỗi cấp dòng (bôi đỏ trong preview, loại khỏi tạo — EX2)
| Row Error | Mã lỗi dòng |
|---|---|
| Thiếu trường bắt buộc | `MISSING_REQUIRED_FIELD` |
| Email sai định dạng | `INVALID_EMAIL` |
| Trùng email trong file | `DUPLICATE_IN_FILE` |
| Email đã tồn tại DB | `EMAIL_ALREADY_EXISTS` |
| Mã NV đã tồn tại | `EMPLOYEE_CODE_ALREADY_EXISTS` |
| Không tìm thấy phòng ban | `DEPARTMENT_NOT_FOUND` |
| Không tìm thấy vai trò | `ROLE_NOT_FOUND` |
| Không tìm thấy quản lý | `MANAGER_NOT_FOUND` |

---

## 7. API Contract (Proposed)

### 7.1 Tải template
`GET /api/v1/users/import/template` → file `.xlsx`.

### 7.2 Import (preview + commit chung endpoint)
`POST /api/v1/users/import`
- **Content-Type**: `multipart/form-data`
- **Fields**: `file` (binary .xlsx, required), `commit` (boolean, default `false`)

**Response 200 (preview — `commit=false`):**
```json
{
  "success": true,
  "message": "Kiểm tra hoàn tất",
  "data": {
    "mode": "preview",
    "totalRows": 10,
    "validCount": 8,
    "invalidCount": 2,
    "results": [
      { "row": 2, "email": "an@company.com", "status": "valid" },
      { "row": 3, "email": "bad-email", "status": "invalid", "reason": "INVALID_EMAIL" },
      { "row": 4, "email": "existing@company.com", "status": "invalid", "reason": "EMAIL_ALREADY_EXISTS" }
    ]
  }
}
```

**Response 200 (commit — `commit=true`):**
```json
{
  "success": true,
  "message": "Tạo tài khoản hoàn tất",
  "data": {
    "mode": "commit",
    "totalRows": 10,
    "successCount": 8,
    "failedCount": 2,
    "results": [
      { "row": 2, "email": "an@company.com", "status": "success", "userId": "uuid" },
      { "row": 3, "email": "bad-email", "status": "failed", "reason": "INVALID_EMAIL" }
    ]
  }
}
```

> Mật khẩu tạm KHÔNG xuất hiện trong response (NFR-004) — chỉ gửi qua email.

---

## 8. Acceptance Criteria

### 8.1 Template & Parsing
- **AC-001**: Given file `.pdf`, hệ thống trả `400 INVALID_FILE_FORMAT`.
- **AC-002**: Given file > 2MB, hệ thống trả `400 FILE_TOO_LARGE`.
- **AC-003**: Given file sai header, hệ thống trả `400 INVALID_TEMPLATE`.
- **AC-004**: Given `GET .../template`, trả `.xlsx` đúng header chuẩn.
- **AC-005**: Given file 201 dòng, hệ thống trả `400 IMPORT_ROW_LIMIT_EXCEEDED`.

### 8.2 Preview & Validation (EX2)
- **AC-006**: Given file có dòng thiếu `full_name`, dòng đó `invalid MISSING_REQUIRED_FIELD` trong preview, không được tạo.
- **AC-007**: Given dòng có email đã tồn tại DB, dòng đó `invalid EMAIL_ALREADY_EXISTS`.
- **AC-008**: Given 2 dòng cùng email, dòng thứ hai `invalid DUPLICATE_IN_FILE`.
- **AC-009**: Given `department_code` không tồn tại, dòng `invalid DEPARTMENT_NOT_FOUND`.
- **AC-010**: Given `role_codes` chứa code không tồn tại, dòng `invalid ROLE_NOT_FOUND`.
- **AC-011**: Given `commit=false`, không có bản ghi nào được ghi vào DB.

### 8.3 Commit & Business Rules
- **AC-012**: Given file có dòng hợp lệ và dòng lỗi, khi `commit=true`, các dòng hợp lệ được tạo, dòng lỗi bị bỏ qua (BR2).
- **AC-013**: Given tài khoản được tạo, mật khẩu tạm ≥ 8 ký tự đủ 4 loại (BR1), `must_change_password=true` (BR3), `username=email` (BR4).
- **AC-014**: Given tài khoản được tạo, một email credentials được enqueue cho tài khoản đó (POST-2).
- **AC-015**: Given enqueue email lỗi, tài khoản vẫn được tạo (best-effort), audit `NOTIFICATION_ENQUEUE_FAILED` được ghi.
- **AC-016**: Given phiên import commit, một audit `ACCOUNT_IMPORT` tổng được ghi.
- **AC-017**: Mật khẩu tạm không xuất hiện trong response API (NFR-004).

---

## 9. Out of Scope
- Hỗ trợ định dạng `.xls` (legacy) — v1 chỉ `.xlsx`.
- Xử lý bất đồng bộ qua `background_jobs` cho parse/import (chỉ sync + cap dòng).
- Bảng lưu lịch sử import riêng.
- Cập nhật (update) tài khoản đã tồn tại qua import — chỉ tạo mới; email tồn tại bị loại.
- Import avatar/khuôn mặt.
- Throttle/rate-limit gửi email theo quota (ghi nhận là cân nhắc vận hành, không thuộc v1 core).
- Rollback toàn bộ khi có dòng lỗi (BR2 yêu cầu partial success, không all-or-nothing).

---

## 10. Assumptions
- Client gọi 2 bước: `commit=false` để xem preview, rồi gửi lại **cùng file** với `commit=true` để tạo (server không lưu file giữa 2 lần gọi).
- `department_code` và `role_code` là định danh ổn định do admin nắm được khi điền template.
- Số lượng tài khoản mỗi lô nằm trong quota email/ngày; nếu vượt, email lỗi được ghi audit và có thể gửi lại thủ công (ngoài phạm vi v1).
