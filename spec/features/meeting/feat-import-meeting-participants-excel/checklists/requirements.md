# Requirements Checklist: Import thành viên cuộc họp bằng Excel

- **Feature ID**: MEET-IMPORT-PARTICIPANT-001
- **Created**: 2026-07-10

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo checklist yêu cầu cho import Excel | Toàn bộ file |

---

## 1. Scope & Constitution
- [ ] Không thêm/xóa/đổi bảng DB (v3.2 Compact giữ nguyên)
- [ ] Không thêm bảng lưu lịch sử import
- [ ] Không xử lý async/background cho parse-import (chỉ sync + cap dòng)
- [ ] Không sửa hành vi email của `addExternalParticipant` đơn lẻ
- [ ] Không sửa worker mail sang BCC/loop
- [ ] Dùng `exceljs` sẵn có, không thêm thư viện parse mới

## 2. API & Contract
- [ ] `POST /meetings/:meetingId/participants/import` (multipart, field `file`)
- [ ] `GET /meetings/:meetingId/participants/import/template` trả `.xlsx`
- [ ] Response bọc `{ success, message, data, error }`
- [ ] `422 WARNING_CONFIRMATION_REQUIRED` khi có cảnh báo & chưa xác nhận
- [ ] `200` với `ImportReport` khi commit

## 3. Auth & Permission
- [ ] Permission mới `meeting.participant.import` được seed
- [ ] Gán ADMIN, MANAGER, EMPLOYEE
- [ ] Endpoint gate bằng `JwtAuthGuard` + `PermissionsGuard`
- [ ] Private meeting: chỉ Organizer/Host/Admin → 403 nếu vi phạm
- [ ] Capacity override tôn trọng `meeting.participant.override_capacity`

## 4. Parsing & Validation
- [ ] Chỉ nhận `.xlsx`, sai định dạng → `INVALID_FILE_FORMAT`
- [ ] Header đúng 6 cột, sai → `INVALID_TEMPLATE`
- [ ] File rỗng → `INVALID_TEMPLATE`
- [ ] > `MAX_IMPORT_ROWS` (200) → `IMPORT_ROW_LIMIT_EXCEEDED`
- [ ] Giới hạn kích thước file → `FILE_TOO_LARGE`
- [ ] Gắn số dòng gốc vào kết quả

## 5. Identity Resolution
- [ ] Internal resolve ưu tiên `email`, fallback `employee_code`
- [ ] Batch query `users` (1 lần) thay vì query từng dòng
- [ ] Chỉ nhận user `account_status='active'`
- [ ] Thiếu định danh → `MISSING_IDENTIFIER`
- [ ] Không tìm thấy → `USER_NOT_FOUND`
- [ ] External bắt buộc `full_name` + `email`
- [ ] Duplicate-in-file → `DUPLICATE_IN_FILE`
- [ ] Duplicate-in-DB (internal + external) → `PARTICIPANT_ALREADY_EXISTS`

## 6. Warning & Two-step
- [ ] Reuse `checkParticipantConflicts` cho conflict lịch
- [ ] Capacity tính **lũy kế** cả lô vs `rooms.capacity`
- [ ] policy=`block` → lỗi cứng `ROOM_CAPACITY_EXCEEDED` (không bypass)
- [ ] policy=`warning` + không override perm → lỗi cứng
- [ ] Có warning + `force=false` → 422, KHÔNG ghi DB
- [ ] `force=true` → commit dòng cảnh báo, giữ chặn lỗi cứng

## 7. Persistence & Partial Success
- [ ] Per-row transaction (không all-or-nothing)
- [ ] Reuse lõi `persistInternalParticipant`/`persistExternalParticipant`
- [ ] Pessimistic lock + re-check duplicate mỗi dòng
- [ ] Report `totalRows/successCount/failedCount/warningCount/results[]`

## 8. Notification
- [ ] Internal thành công → **1** in-app gom (`recipient_user_ids_json`)
- [ ] Internal **KHÔNG** gửi email (tiết kiệm quota)
- [ ] External thành công → email riêng **từng khách** (không lộ địa chỉ)
- [ ] Notification best-effort, lỗi không hỏng report

## 9. Audit
- [ ] Audit per-row từ lõi add giữ nguyên
- [ ] Audit tổng `IMPORT_PARTICIPANTS` với số liệu tổng

## 10. Testing
- [ ] Unit test parser (header/rỗng/limit)
- [ ] Unit test resolver (email/employee_code/missing/not found/duplicate)
- [ ] Unit test warning + two-step + capacity lũy kế
- [ ] Unit test partial success
- [ ] Unit test notification (internal gom in-app, external email từng người)
- [ ] Regression test add đơn lẻ sau refactor extract
- [ ] Controller test (200/422/template)
- [ ] `npm run build` pass
- [ ] `npm run lint` pass

## 11. Security & Data
- [ ] Không log email/nội dung nhạy cảm
- [ ] File chỉ parse trong memory, không lưu DB
- [ ] Validate MIME + size trước khi parse
- [ ] Không tin `type`/định danh từ file — validate ở boundary
