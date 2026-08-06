# Data Model: Import thành viên cuộc họp bằng Excel

- **Feature ID**: MEET-IMPORT-PARTICIPANT-001
- **Created**: 2026-07-10

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-06 | Theo yêu cầu FE (`Docs/Nam_Sent/BE_REQUIREMENTS.md`): thêm cột `STT` đầu tiên, header hiển thị đổi sang tiếng Việt (STT/Loại/Email/Mã nhân viên/Họ và tên/Tổ chức/Số điện thoại), cột `Loại` chấp nhận thêm giá trị tiếng Việt (Nội bộ/Khách ngoài), validate số cột thực tế + bỏ qua dòng chỉ có STT | Mục 4 |
| 2026-07-10 | Khởi tạo data-model cho tính năng import Excel | Toàn bộ file |

---

## 1. Entity Impact

### 1.1 Entities đọc (READ)

| Entity / Table | Fields đọc | Mục đích |
|---|---|---|
| `meetings` | `id`, `status`, `visibility_level`, `organizer_id`, `host_id`, `room_id`, `start_time`, `end_time` | Kiểm tra trạng thái, quyền, phòng, thời gian |
| `users` | `id`, `email`, `employee_code`, `account_status`, `full_name` | Resolve internal (batch) theo email/employee_code |
| `rooms` | `id`, `capacity` | Kiểm tra sức chứa lũy kế |
| `meeting_participants` | `meeting_id`, `user_id` | Duplicate check + đếm số lượng hiện có |
| `meeting_external_participants` | `meeting_id`, `email` | Duplicate check external |
| `system_configs` | `config_value` WHERE `config_key='meeting.capacity_policy'` | Đọc policy (`warning`/`block`) |
| `roles`/`permissions`/`user_roles`/`role_permissions` | qua authz check | Kiểm tra `meeting.participant.override_capacity`, `admin.all` |

### 1.2 Entities ghi (CREATE)

| Entity / Table | Action | Fields ghi |
|---|---|---|
| `meeting_participants` | INSERT (mỗi dòng internal hợp lệ) | `meeting_id`, `user_id`, `participant_role='attendee'`, `invitation_status='pending'`, `attendance_required=true`, `is_required=true`, `invited_by=[Actor.id]` |
| `meeting_external_participants` | INSERT (mỗi dòng external hợp lệ) | `meeting_id`, `full_name`, `email`, `organization_name?`, `phone_number?`, `participant_role='attendee'`, `invitation_status='pending'` |
| `notifications` | INSERT | (internal) 1 record `notification_type='MEETING_INVITE'`, `channel='IN_APP'`, `recipient_scope='user_list'`, `recipient_user_ids_json=[all internal userIds]`; (external) 1 record/khách `channel='EMAIL'`, `recipient_emails=[1 email]` |
| `background_jobs` | INSERT | 1 job/khách external `job_type='SEND_EMAIL'` |
| `audit_logs` | INSERT | (per-row) reuse audit của lõi add; (tổng) `action_type='IMPORT_PARTICIPANTS'`, `entity_type='meeting'`, `entity_id=meetingId`, `new_value_json={ totalRows, successCount, failedCount, warningCount }` |

---

## 2. Không thay đổi Schema
Feature này **KHÔNG thay đổi database schema**. Tất cả entities đã tồn tại trong v3.2 Compact (39 tables). Không thêm bảng lưu lịch sử import.

---

## 3. Unique Constraints tận dụng
- `meeting_participants`: UNIQUE `(meeting_id, user_id)` — chống duplicate internal (kể cả race condition per-row).
- Duplicate external: kiểm tra theo `(meeting_id, LOWER(email))` như logic đơn lẻ hiện có.

---

## 4. Cấu trúc file Excel (không phải DB, là contract dữ liệu đầu vào)

Sheet 1 — dữ liệu. Header hiển thị (tiếng Việt) từ trái qua phải, đúng thứ tự, tối đa 7 cột:

| # | Header hiển thị | Field nội bộ | Bắt buộc | Áp dụng | Ghi chú |
|---|---|---|---|---|---|
| 1 | `STT` | `stt` | ❌ | cả 2 | Chỉ tham khảo, không dùng trong logic |
| 2 | `Loại` | `type` | ✅ | cả 2 | `internal`/`Nội bộ` \| `external`/`Khách ngoài` |
| 3 | `Email` | `email` | internal: ✅* / external: ✅ | cả 2 | Định danh chính internal; liên hệ external |
| 4 | `Mã nhân viên` | `employee_code` | ❌ | internal | Fallback khi `Email` trống |
| 5 | `Họ và tên` | `full_name` | external: ✅ | external | Bắt buộc với khách ngoài |
| 6 | `Tổ chức` | `organization_name` | ❌ | external | |
| 7 | `Số điện thoại` | `phone_number` | ❌ | external | |

\* Internal cần **ít nhất một** trong `Email` / `Mã nhân viên`.

Validate cấu trúc:
- Nếu số cột thực tế (`sheet.columnCount`) > 7, hoặc tên cột không khớp chuẩn theo đúng thứ tự trên → throw `INVALID_TEMPLATE`, message: `"Sai nguyên mẫu. Vui lòng không tự ý thêm cột."`.
- Dòng hoàn toàn trống, hoặc chỉ có `STT` mà các cột còn lại đều trống → bỏ qua (skip), không tính là dòng lỗi.

Sheet 2 (tuỳ chọn) — hướng dẫn điền + danh sách giá trị hợp lệ cho `Loại`.

---

## 5. Kết quả import (in-memory DTO, không lưu DB)

```ts
interface ImportRowResult {
  row: number;              // số dòng gốc trong Excel (1-based, tính cả header)
  type: 'internal' | 'external';
  identifier: string;       // email hoặc employee_code hoặc full_name
  status: 'valid' | 'warning' | 'error' | 'success' | 'failed';
  reason?: string;          // mã lỗi/cảnh báo (vd USER_NOT_FOUND, SCHEDULE_CONFLICT)
  participantId?: string;   // khi status='success'
}

interface ImportReport {
  totalRows: number;
  successCount: number;
  failedCount: number;
  warningCount: number;
  results: ImportRowResult[];
}
```

- Ở **dry-run** (lần 1): `status` ∈ {`valid`, `warning`, `error`}.
- Ở **commit** (lần 2): `status` ∈ {`success`, `failed`}.

---

## 6. Redis / Cache không dùng
Không dùng cache/Redis. Không lưu file giữa 2 lần gọi — client gửi lại file khi xác nhận (`forceAddWithWarnings=true`).
