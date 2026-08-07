# Research: Guest External Live Meeting Access (GLA-001)

**Phase 0 output** | **Date**: 2026-08-07

---

## 1. Codebase Analysis

### 1.1 Điểm hook — sinh lời mời khi booking approved

File: `src/modules/meetings/services/meeting-request-review.service.ts`

- Trong `approve()`, đoạn transaction (khoảng dòng 414-430) đã load đầy đủ entity `MeetingExternalParticipantEntity[]` (biến `externalParticipants`), nhưng chỉ trích `.email` ra thành `result.externalEmails: string[]` trước khi transaction commit và trả `result` ra ngoài.
- Đoạn gửi mail cho khách ngoài (dòng 570-599) chỉ lặp qua `result.externalEmails` (string[]) — **không có `externalParticipantId`** ở điểm này.
- **Hệ quả cho implementation**: phải sửa `result` type (dòng ~70, field `externalEmails: string[]`) thành mang theo cả `id`, hoặc thêm field mới `externalParticipantsForInvite: { id: string; email: string }[]`, VÀ sinh + ghi `guestInvite` vào `metadata_json` **NGAY TRONG transaction** (trước dòng ~430, khi entity đã có sẵn trong tay) — không load lại ngoài transaction để tránh race với thao tác khác trên cùng dòng.
- Chỉ áp dụng cho nhánh `!isUpdateRequest` (CREATE_MEETING) — đúng như email thông báo chung hiện tại, vì UPDATE_TIME/UPDATE_ROOM không đổi danh sách khách ngoài.

### 1.2 Điểm hook — thu hồi phiên khi meeting cancelled/completed

| Sự kiện | File | Vị trí |
|---|---|---|
| `cancelled` | `src/modules/meetings/services/meetings.service.ts` | `cancelMeeting()`, dòng 2415 |
| `completed` | `src/modules/live-meeting/services/live-meeting.service.ts` | `endMeeting()`, dòng 1884, set `status: MeetingStatus.COMPLETED` (dòng 1995) |

Lưu ý: enum thật là `MeetingStatus.COMPLETED`, KHÔNG phải `'ended'` như cách gọi thông tục trong tài liệu nghiệp vụ (`KE_HOACH_MAGIC_LINK_KHACH_NGOAI_2026-08-07.md`) — cần dùng đúng tên enum khi code.

Cả 2 nơi cần thêm bước: sau khi transaction đổi status thành công, load toàn bộ `meeting_external_participants` của meeting đó có `guestInvite` không rỗng, và set `invalid_after = now()` cho từng cái (qua `jsonb_set`, không cần xóa `guestInvite`, chỉ cần thêm/update field `invalidAfter` — xem `data-model.md`).

**Rủi ro cần lưu ý khi implement**: đây là 2 method rất lớn, nghiệp vụ dày đặc (transaction, notification, audit). Thêm logic guest-invalidation vào phải đặt SAU khi transaction chính commit thành công (best-effort, non-blocking — lỗi ở bước này không được làm rollback việc hủy/kết thúc cuộc họp).

### 1.3 Ràng buộc kỹ thuật đã kiểm chứng (mirror KE_HOACH mục 1.4, xác nhận lại bằng code)

| # | Ràng buộc | File:dòng |
|---|---|---|
| (a) | `JwtAuthGuard` gán `request['user'] = { userId: payload.sub, ... }`, mọi controller nội bộ coi đây là `users.id` | `auth/guards/jwt-auth.guard.ts:63` |
| (b) | `PermissionsGuard` bắt buộc tra `user_roles`/`role_permissions` qua `AuthzReadRepository.getEffectiveRolesAndPermissions()` | `auth/guards/permissions.guard.ts:43` |
| (c) | `RateLimitGuard` là stub — `canActivate() { return true; }` | `auth/guards/rate-limit.guard.ts:5` |
| (d) | `EventsGateway.handleConnection()` chỉ log, có `// TODO: Validate JWT`; `meeting:subscribe`/`ivss:subscribe` chỉ validate format UUID rồi `client.join(room)` | `websocket/events.gateway.ts:67-135` |
| (e) | `audit_logs.user_id` có FK `ON DELETE SET NULL` tới `users` | `db_schema.sql:2636-2637` (`fk_audit_logs_user_id_users`) |
| (f) | `attendance_records.user_id` là `NOT NULL`; `attendance_events.user_id` là nullable, FK `ON DELETE SET NULL` | `db_schema.sql:83-109` (records), `db_schema.sql:57-76` + `2591-2592` (events) |
| (g) | Timeline UC-99 (`getMeetingTimeline`) query `attendance_events` lọc `eventType IN ('check_in','check_out')`, KHÔNG lọc `userId` | `live-meeting.service.ts:3427-3447` |
| (h) | Danh sách điểm danh UC-IMM-08 lọc theo `ae.userId = :userId` cho từng nhân viên (fallback nhánh) | `live-meeting.service.ts:2827-2839` |
| (i) | Repo có sẵn pattern OTP + Redis TTL hoàn chỉnh (email, không phải guest) | `auth/services/password-reset-cache.service.ts` toàn file |
| (j) | Repo có sẵn pattern `invalid_after` cho invalidate token theo user | `password-reset-cache.service.ts:160-174` (`invalidateUserTokens`), đọc lại ở `jwt-auth.guard.ts:50-61` |
| (k) | `RedisService` hỗ trợ `incr`, `expire`, `exists`, `get/setWithTtl`, `getJson/setJsonWithTtl`, `sadd/sismember/smembers` — đủ cho toàn bộ nhu cầu OTP/rate-limit/lobby (Redis SET) | `redis/redis.service.ts` toàn file |
| (l) | Thư mục `src/database/seeds/` KHÔNG có runner — permission phải seed qua `src/database/migrations/` | Xác nhận qua tiền lệ nhiều migration `Seed*Permission*.ts` trong `migrations/`, không có trong `seeds/` |
| (m) | `env.validation.ts` đã có block D (JWT/Auth) và E (OTP) riêng — pattern thêm secret/OTP config mới nên nối tiếp 2 block này, không tạo block rời rạc | `config/env.validation.ts:49-88` |

### 1.4 Pattern tái sử dụng (house style)

| Pattern | Nguồn tham chiếu |
|---|---|
| Cấu trúc Redis key namespace theo domain (`otp:password_reset:{email}`, `otp_limit:...`, `otp_blocked:...`) | `password-reset-cache.service.ts` |
| Guard riêng cho loại token khác (`must-change-password.guard.ts` — chạy sau `JwtAuthGuard`, đọc `request['user']`, có route whitelist) | `auth/guards/must-change-password.guard.ts` |
| Guard đọc token khác qua query/header (`jwt-query-or-header-auth.guard.ts`) — ví dụ cho việc 1 guard có thể chấp nhận token từ nhiều nguồn | `auth/guards/jwt-query-or-header-auth.guard.ts` |
| Migration seed permission 3-CRUD-action cho 1 nhóm chức năng mới | `20260717100001-SeedMeetingMinutesSharePermissions.ts` (mirror `meeting.minutes.share.*`) |
| Migration CREATE TABLE viết tay, UUID PK + timestamptz + FK CASCADE + index | `20260717100000-CreateMeetingMinutesSharesTable.ts` — **KHÔNG áp dụng trực tiếp** ở feature này (quyết định không thêm bảng), nhưng vẫn tham khảo convention cho các migration seed permission còn lại |
| Ownership-or-admin check (host/preparedBy OR Admin bypass) | `minutes.service.ts` (`issueMinutes`), `feat-share-meeting-minutes/plan.md` mục 6 |
| Mail builder function theo layout chung | `mail/templates/builders.ts` + `layout.ts` |
| Masking utility có sẵn cho `metadata_json` nhạy cảm khi trả về/log | `common/utils/masking.util.ts` (`maskSensitiveMetadata`) — có thể tái dùng khi trả `guestInvite` cho mục đích debug/log, KHÔNG dùng để mask email hiển thị cho khách (cần logic riêng: giữ vài ký tự đầu, `***@domain`) |

### 1.5 Xác nhận cấu trúc dữ liệu liên quan

`MeetingExternalParticipantEntity` (`meetings/entities/meeting-external-participant.entity.ts`): `id, meetingId, fullName, email, phoneNumber, organizationName, participantRole, invitationStatus, responseAt, notes, metadataJson, createdAt`. Cột `metadataJson` map `jsonb`, nullable — đúng chỗ cần.

`MeetingEntity` liên quan: `organizerId, hostId, status (enum MeetingStatus), startTime, endTime` — đủ để tính cửa sổ thời gian và ownership.

---

## 2. Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Lưu trữ lời mời | `metadata_json.guestInvite` + `jsonb_set` | Quyết định đã chốt — không thêm bảng |
| Trạng thái tạm thời | Redis (OTP, đếm, phiên, lobby, device-remember) | Atomic `INCR`, TTL tự dọn, đúng pattern có sẵn |
| Cấu trúc token phiên khách | JWT ký bằng `GUEST_TOKEN_SECRET` riêng, claim `typ='guest'`, `sub=externalParticipantId`, `mid=meetingId` | Tách hoàn toàn khỏi luồng nhân viên — không cần sửa `JwtAuthGuard` hiện có |
| Cấu trúc link mời | `<externalParticipantId>.<secret>` (base64url secret) | Tra cứu O(1) bằng khóa chính, không cần index trên hash |
| So khớp bí mật | SHA-256 hash + `crypto.timingSafeEqual` | Không lưu token thô (CLAUDE.md 5.4), chống timing attack |
| Guard khách | `GuestSessionGuard` (verify + gán `request.guest`) + `GuestMeetingScopeGuard` (so `meetingId`) | Tách 2 trách nhiệm, mirror style `JwtAuthGuard` + `PermissionsGuard` 2 tầng hiện có |
| Rate-limit | Tự viết bằng `RedisService.incr`/`expire`, KHÔNG dùng `RateLimitGuard` | `RateLimitGuard` là stub rỗng (mục 1.3.c) |
| Ghi điểm danh khách | `attendance_events`, `event_type` riêng (`guest_join`/`guest_leave`) | Không đụng `attendance_records` (NOT NULL user_id), không lẫn vào query hiện có (mục 1.3.g/h) |
| WebSocket auth | Sửa `EventsGateway.handleConnection()` + `handleMeetingSubscribe()` | Điểm chạm duy nhất, không cần gateway mới |
| Feature flag | `system_configs` (`guest_access.verification_mode`, `guest_access.lobby_enabled`, ...) | Đúng pattern feature-flag hiện có của dự án (CLAUDE.md mục 4.2) |
| Permission mới | 3 permission, seed qua migration trong `src/database/migrations/` | Bắt buộc theo CLAUDE.md (folder `seeds/` không có runner) |

---

## 3. Risks

1. **WebSocket auth là điều kiện chặn release** — nếu bỏ qua, mọi lớp OTP/token/lobby bị đi vòng chỉ bằng 1 lệnh `socket.emit('meeting:subscribe', { meetingId })` vì gateway hiện không xác thực gì. Đây là rủi ro cao nhất của toàn bộ feature, không phải rủi ro phụ.
2. **Sửa `meeting-request-review.service.ts` (approve) và 2 method lớn khác (`cancelMeeting`, `endMeeting`)** — đây đều là method nghiệp vụ dày đặc, nhiều side-effect hiện có (notification, audit, booking status). Thêm logic guest-invite/guest-invalidate phải làm **best-effort, không rollback nghiệp vụ chính** nếu lỗi — mirror cách `writeNotificationFailureAudit` xử lý lỗi notification hiện tại (catch + ghi audit lỗi, không throw).
3. **Enumeration qua timing** — nếu implement không cẩn thận, thời gian phản hồi giữa "id không tồn tại" (trả ngay) và "id tồn tại nhưng hash sai" (phải hash rồi so sánh) có thể khác nhau đủ để dò được. Giảm thiểu: luôn thực hiện đủ bước hash + so sánh timing-safe kể cả khi không tìm thấy record (dùng giá trị hash "dummy" cố định làm vế so sánh khi record không tồn tại).
4. **Đếm sai OTP dùng Redis nhưng lời mời dùng DB** — 2 nguồn trạng thái tách rời (Redis cho phần tạm, DB cho phần bền) đòi hỏi thiết kế rõ: Redis mất dữ liệu (restart, eviction) → khách chỉ mất OTP session hiện tại, KHÔNG mất lời mời; nhưng bộ đếm rate-limit cũng mất theo → tạm thời "quên" số lần đã thử. Chấp nhận được (đã ghi trong spec mục Giả định), nhưng cần tài liệu hóa rõ cho reviewer.
5. **`MeetingStatus.COMPLETED` không phải giá trị "meeting đã diễn ra xong" duy nhất theo nghĩa thời gian** — 1 meeting có thể quá `endTime` mà chưa được `endMeeting()` gọi (status vẫn `in_progress` hoặc `scheduled`). Cửa sổ thời gian (`endTime + 15'`) ở FR-GLA-017 xử lý phần này độc lập với FR-GLA-015 (dựa vào status) — 2 cơ chế bổ sung nhau, không thay thế nhau.
6. **Guest JWT TTL động (`min(issuedAt+4h, meeting.endTime+15')`)** — không thể nhúng cứng vào claim `exp` nếu `endTime` có thể đổi do gia hạn (FR-GLA-016). Giải pháp: đặt `exp` JWT = `issuedAt + 4h` (chặn trên tuyệt đối, không đổi được), nhưng **luôn kiểm tra thêm** `now <= meeting.endTime + 15'` ở tầng `GuestMeetingScopeGuard`/service mỗi request (đọc `meetings.endTime` tươi từ DB, không tin giá trị cũ). Vừa an toàn (JWT không sống mãi nếu Redis/DB hỏng), vừa phản ánh đúng gia hạn.

---

## 4. Alternatives Considered

| Approach | Rejected Because |
|---|---|
| Thêm bảng `meeting_guest_invites` | Product Owner đã chốt KHÔNG thêm bảng (spec mục 1.5.3) |
| Tạo `users` row + role `GUEST` | Ô nhiễm bảng nhân sự, rủi ro seed role sai (tiền lệ đã có trong repo) — xem `KE_HOACH...md` mục 3.2 phương án B |
| One-click magic link (không OTP) | Mail gateway doanh nghiệp tự động quét/GET link, đốt token trước khi khách bấm — xem `KE_HOACH...md` mục 4.4 |
| Dùng `RateLimitGuard` hiện có cho OTP rate-limit | Guard này là `return true` — dùng nhầm sẽ tạo cảm giác an toàn giả |
| Reuse `visibility='participants'` cho note chia sẻ khách | Sẽ làm lộ hồi tố toàn bộ note cũ đang gắn visibility đó — phải dùng cờ chia sẻ riêng (deferred, xem spec mục 8, không thuộc scope BE lõi của feature này nếu FE part note-sharing tách riêng) |
