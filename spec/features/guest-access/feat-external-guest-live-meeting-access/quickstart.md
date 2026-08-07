# Quickstart: Guest External Live Meeting Access (GLA-001)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-07 | Khởi tạo tài liệu (Phase 1 output). | Toàn bộ file |
| 2026-08-07 | Sửa checklist WebSocket cho khớp phạm vi implement thật (chặn tại `meeting:subscribe`, không disconnect toàn bộ kết nối thiếu token). | Mục "Verification Checklist" |

**Feature**: GLA-001 | **Phase 1 output**

---

## Test Scenarios

### S1: Happy path — Toàn bộ luồng khách vào được cuộc họp

Steps:
1. Tạo meeting request có 1 khách ngoài công ty `guest@partner.com`.
2. Duyệt booking (`approve()`).
3. Xác nhận `meeting_external_participants.metadata_json.guestInvite` tồn tại, `status='active'`.
4. Xác nhận có email chứa link mời được enqueue.
5. Gọi `GET /guest/invites/:token` với token đúng → 200, `maskedEmail` đúng dạng che.
6. Gọi `POST /guest/invites/:token/otp` → 200, có email OTP được enqueue tới `guest@partner.com`.
7. Gọi `POST /guest/invites/:token/verify` với OTP đúng → 200, nhận `guestToken`.
8. Nếu lobby bật: gọi `GET /guest/meetings/:meetingId` bằng `guestToken` → 403 `GUEST_LOBBY_PENDING`.
9. Host gọi `POST .../guests/:epId/admit` → 200.
10. Gọi lại `GET /guest/meetings/:meetingId` → 200, dữ liệu đúng Mức B.
11. Kiểm tra `attendance_events` có đúng 1 dòng `event_type='guest_join'`, `user_id=NULL`.

Expect: toàn bộ bước trên pass, không có bước nào tạo `users` row hay `role` mới cho khách.

### S2: Enumeration bị chặn

Steps:
1. Gọi `GET /guest/invites/:randomUuid.anything` (id không tồn tại).
2. Gọi `GET /guest/invites/:validEpId.wrongsecret` (id tồn tại, secret sai).

Expect: cả 2 trả **cùng** `400 GUEST_INVITE_INVALID`, cùng response body shape, thời gian phản hồi không chênh lệch đáng kể (không đủ để phân biệt bằng timing).

### S3: Leo thang quyền bị chặn

Steps:
1. Xác minh OTP thành công, nhận `guestToken` cho `meetingId = A`.
2. Dùng `guestToken` gọi `GET /api/v1/meetings` (endpoint nội bộ dùng `JwtAuthGuard`).
3. Dùng `guestToken` gọi `GET /guest/meetings/:meetingIdB` (meeting khác).

Expect: (2) → 401 (verify chữ ký thất bại, khác secret). (3) → 403 `GUEST_MEETING_SCOPE_MISMATCH`.

### S4: Rate-limit & khóa OTP

Steps:
1. Gọi `POST .../otp` 4 lần liên tiếp trong 5 phút cho cùng 1 lời mời.
2. Verify với OTP sai 5 lần liên tiếp.

Expect: (1) lần thứ 4 → 429 `GUEST_OTP_TOO_MANY_REQUESTS`, không có email thứ 4 được gửi. (2) sau lần sai thứ 5 → lời mời bị khóa 15 phút, lần thử thứ 6 (dù đúng OTP) vẫn bị từ chối `GUEST_OTP_BLOCKED`.

### S5: Cửa sổ thời gian

Steps:
1. Meeting `startTime` = now + 2 giờ.
2. Gọi `POST .../otp`.

Expect: 409 `GUEST_JOIN_WINDOW_CLOSED` (ngoài cửa sổ `T-30'`).

### S6: Gửi lại link vô hiệu hóa link cũ

Steps:
1. Khách nhận link A (chưa dùng).
2. Host gọi "Gửi lại link" cho khách đó → link B được sinh.
3. Khách dùng link A (cũ).

Expect: (3) → 400 `GUEST_INVITE_INVALID` (hash không còn khớp `guestInvite.tokenHash` hiện tại).

### S7: Thu hồi tức thời khi meeting bị hủy

Steps:
1. Khách đã có `guestToken` hợp lệ, đang xem nội dung cuộc họp.
2. Host/Admin hủy cuộc họp (`cancelMeeting`).
3. Khách gọi lại `GET /guest/meetings/:meetingId` ngay sau đó (trước khi `guestToken` JWT hết hạn tự nhiên).

Expect: 409 `GUEST_MEETING_CANCELLED` — phiên bị vô hiệu hóa ngay, không chờ TTL 4h.

### S8: Gia hạn cuộc họp không đá khách ra

Steps:
1. Meeting `endTime` gốc = now + 10 phút. Khách đã có phiên.
2. Host gia hạn cuộc họp thêm 60 phút (UC-IMM-02).
3. Ở phút thứ 40 (đã qua `endTime` gốc, còn trong `endTime` mới), khách gọi `GET /guest/meetings/:meetingId`.

Expect: 200 — phiên vẫn hợp lệ vì kiểm tra cửa sổ thời gian đọc `meeting.endTime` tươi từ DB, không dùng giá trị nhúng cứng trong JWT.

### S9: WebSocket — không có token bị từ chối

Steps:
1. Kết nối WebSocket không kèm `auth.token`.
2. Gửi `meeting:subscribe` với `meetingId` hợp lệ bất kỳ.

Expect: kết nối bị từ chối ở bước handshake hoặc `meeting:subscribe` trả `{ ok: false }`, không join room.

### S10: WebSocket — token khách đúng scope

Steps:
1. Kết nối WebSocket với `auth.token = guestToken` (cho `meetingId = A`).
2. Gửi `meeting:subscribe` với `meetingId = A`.
3. Gửi `meeting:subscribe` với `meetingId = B`.

Expect: (2) join room thành công. (3) bị từ chối, không join.

### S11: Điểm danh khách không lẫn vào truy vấn hiện có

Steps:
1. Khách vào phòng thành công (ghi `guest_join`).
2. Gọi `GET /api/v1/live-meetings/:meetingId/attendance` (UC-IMM-08, dành cho nhân viên).
3. Gọi `GET /api/v1/meetings/:meetingId/timeline` (UC-99).

Expect: (2) danh sách điểm danh nhân viên KHÔNG chứa dòng của khách (query lọc theo `userId` cụ thể). (3) timeline KHÔNG hiện dòng "check_in" vô danh nào phát sinh từ khách (vì `event_type` khác `check_in`/`check_out`).

### S12: Phòng chờ TẮT bỏ qua bước duyệt

Steps:
1. Đặt `system_configs: guest_access.lobby_enabled = false` (hoặc override cấp meeting nếu đã implement).
2. Khách xác minh OTP thành công.
3. Gọi ngay `GET /guest/meetings/:meetingId`.

Expect: 200 ngay lập tức, không cần host duyệt.

---

## Verification Checklist

- [ ] Không có bảng mới nào được tạo trong migration.
- [ ] `meeting_external_participants` không có cột mới.
- [ ] Guest token dùng `GUEST_TOKEN_SECRET`, khác `AUTH_ACCESS_TOKEN_SECRET`.
- [ ] `RateLimitGuard` (`auth/guards/rate-limit.guard.ts`) không được import/dùng ở bất kỳ đâu trong module `guest-access`.
- [ ] Mọi thao tác ghi `metadata_json` dùng `jsonb_set`, không có đoạn code nào `repository.save()` sau khi gán `entity.metadataJson = {...}` trực tiếp trong JS.
- [ ] Bộ đếm OTP (gửi/sai) nằm hoàn toàn trong Redis, không nằm trong `metadata_json`.
- [ ] `audit_logs` cho hành vi khách có `user_id = NULL`, có `externalParticipantId` trong `metadata_json`.
- [ ] `attendance_events` của khách có `event_type` khác `check_in`/`check_out`.
- [ ] `meeting:subscribe` từ chối khi không có identity hợp lệ hoặc sai phạm vi (không join room) — chặn cứng ĐÚNG tại điểm phát dữ liệu, không disconnect toàn bộ kết nối thiếu token (xem `events.gateway.ts` doc-comment class + spec.md changelog 2026-08-07 cho lý do thu hẹp phạm vi so với FR-GLA-035 đọc theo nghĩa đen).
- [ ] Response của `GET /guest/invites/:token` với id-sai và hash-sai giống hệt nhau.
- [ ] Không có endpoint nào dưới `/api/v1/guest/...` seed permission trong bảng `permissions` (khách không cần permission).
- [ ] 3 permission `meeting.guest.*` chỉ áp dụng cho endpoint phía host.
