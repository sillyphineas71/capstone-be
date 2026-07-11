# Research: Import thành viên cuộc họp bằng Excel

- **Feature ID**: MEET-IMPORT-PARTICIPANT-001
- **Created**: 2026-07-10

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo research: khảo sát codebase, chốt hướng tái sử dụng | Toàn bộ file |

---

## 1. Mục tiêu research
Xác định các thành phần đã có để **tái sử dụng tối đa**, tránh viết lại nghiệp vụ, và làm rõ các khác biệt giữa "thêm 1 người" và "import hàng loạt".

---

## 2. Phát hiện chính (đã verify trong code)

### 2.1 Hạ tầng có sẵn
| Thành phần | Vị trí | Kết luận |
|---|---|---|
| `exceljs` | `package.json` (dep), dùng ở `reports/renderers/*`, `minutes.service.ts` | Dùng luôn để parse + generate template, không thêm lib |
| `FileInterceptor` (multer) | `accounts/controllers/avatar.controller.ts` | Pattern upload multipart chuẩn: `@UseInterceptors(FileInterceptor('file'))`, `@UploadedFile()` |
| Add internal participant | `meetings.service.ts` `addInternalParticipant()` | Chứa toàn bộ pre-check + warning + transaction + audit + notification cần tái sử dụng |
| Add external participant | `meetings.service.ts` `addExternalParticipant()` | Chứa logic ghi external + audit + meeting_event |
| Conflict check | `meetings.service.ts` `checkParticipantConflicts()` | Dùng lại nguyên cho phần warning conflict |
| Attendee count | `meetings.service.ts` `getAttendeeCount()` | Dùng cho capacity check |
| Warning token 2-step | `meetings/utils/warning-token.util.ts` | Pattern tham chiếu; import dùng cờ batch thay token |
| Permission seed pattern | `database/seeds/20260610000001-SeedAddParticipantPermissions.ts` | Mẫu seed permission + role mapping |

### 2.2 `users` có đủ trường resolve
`accounts/entities/user.entity.ts`:
- `email` (varchar 255, not null)
- `employee_code` (varchar, **nullable**)
- `account_status` (enum) — cần `= active`

→ Resolve "ưu tiên email, fallback employee_code" khả thi. Vì `employee_code` nullable, **email là khóa chính đáng tin cậy hơn** → ưu tiên email.

### 2.3 Notification — khả năng gom & rủi ro lộ địa chỉ
`notifications/notifications.service.ts`:
- `enqueueEmailNotification({ toEmails: string[], ... })` tạo **1 notification + 1 background_job + 1 BullMQ job**, nhận mảng email.
- `createNotification({ recipientUserIds: string[], recipientScope })` — in-app lưu per-user qua `recipient_user_ids_json`.

`notifications/notification-worker.service.ts` (dòng ~84-88):
```ts
const recipients = Array.isArray(toEmails) ? toEmails : [toEmails];
const result = await this.mailService.sendMail({ to: recipients, subject, html });
```
→ **Worker nhét tất cả email vào field `To` của MỘT email** → nếu gom nhiều khách ngoài vào 1 job sẽ **lộ danh sách địa chỉ của nhau**.

**Kết luận:**
- In-app (internal): an toàn để **gom 1 notification** với `recipientUserIds=[all]`.
- Email (external): phải **enqueue riêng từng khách** (`toEmails=[1 email]`) để không lộ địa chỉ. Không gom, không sửa worker (giữ scope).

### 2.4 GAP quan trọng: external add hiện KHÔNG gửi email
`addExternalParticipant()` (`meetings.service.ts` ~3459-3729) chỉ ghi `meeting_external_participants` + `meeting_events` + `audit_logs`, **không** gọi `enqueueEmailNotification`/`createNotification`.
→ Yêu cầu "gửi mail khách ngoài" là **hành vi MỚI**, chỉ được thêm **trong import service**, không sửa hàm đơn lẻ (tránh mở rộng scope theo CLAUDE.md §26.4).

### 2.5 GAP: internal add gửi CẢ in-app + email
`addInternalParticipant()` (post-transaction ~2673-2712) gửi in-app **và** email cho user.
→ Muốn "internal chỉ in-app", import **không thể tái dùng nguyên** phần notification của hàm này.

---

## 3. Quyết định thiết kế (grounded)

### 3.1 Refactor tách lõi (bắt buộc)
Tách phần **"pre-check + tính warnings + transaction ghi participant + audit"** ra khỏi phần notification trong `addInternalParticipant`/`addExternalParticipant`:
- Endpoint đơn lẻ: giữ nguyên hành vi hiện tại (internal in-app+email; external không email).
- Import: gọi lõi per-row, rồi tự lo notification theo chiến lược riêng (internal gom in-app, external email từng người).

Cách an toàn nhất: **extract private method** (vd `persistInternalParticipant(em, ...)` / `persistExternalParticipant(em, ...)`) không kèm notification, dùng chung cho cả 2 luồng. Endpoint lẻ và import đều gọi lõi này rồi áp notification riêng. Không đổi contract/hành vi API đơn lẻ.

### 3.2 Warning theo lô
Cơ chế `warningToken` (hỏi–xác nhận từng người) không scale cho lô → thay bằng **cờ boolean cấp file `forceAddWithWarnings`**:
- Lần 1 (`false`): dry-run toàn bộ, nếu có dòng warning → `422` + preview, không ghi DB.
- Lần 2 (`true`): commit tất cả dòng không lỗi cứng.
- Lỗi cứng (USER_NOT_FOUND, duplicate, capacity block, no override perm) **không bao giờ** bị bypass bởi cờ này.

### 3.3 Sync + cap dòng
Đồng bộ, `MAX_IMPORT_ROWS=200`, per-row transaction (partial success). Không dùng background_jobs cho phần import (chỉ dùng cho gửi email external như hiện có).

### 3.4 Capacity theo lô
Đánh giá sức chứa **lũy kế**: `currentCount + số dòng internal hợp lệ trong lô` vs `rooms.capacity`. Tránh trường hợp từng dòng đều "vừa đủ" nhưng tổng thì vượt.

---

## 4. Alternatives đã cân nhắc & lý do loại

| Alternative | Lý do loại |
|---|---|
| Gom tất cả email external vào 1 job | Worker dùng `to:` → lộ địa chỉ người nhận |
| Async qua background_jobs cho toàn bộ import | Over-engineering cho capstone; file ≤200 dòng xử lý sync đủ nhanh |
| All-or-nothing transaction cho cả file | Sai semantic import; 1 dòng lỗi làm hỏng cả lô, UX kém |
| Viết lại logic add trong import service | Vi phạm CLAUDE.md §15 (không lặp business rule); dễ lệch nghiệp vụ |
| Dùng UUID trong Excel | Người dùng không gõ UUID; phải resolve qua email/employee_code |
| Thêm bảng lưu lịch sử import | Vi phạm nguyên tắc "không thêm bảng khi chưa có yêu cầu" (CLAUDE.md §5.4) |

---

## 5. Rủi ro & lưu ý
- Refactor extract lõi phải giữ **nguyên hành vi** endpoint đơn lẻ → cần test hồi quy cho `addInternalParticipant`/`addExternalParticipant`.
- Email external là hành vi mới → cần test riêng đảm bảo mỗi khách 1 job.
- Giới hạn mail free/ngày → chỉ external mới tốn quota; cần log số email enqueue để theo dõi.
