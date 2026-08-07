# Implementation Plan: Guest External Live Meeting Access (GLA-001)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-07 | Khởi tạo plan cho feat-external-guest-live-meeting-access | Toàn bộ file |
| 2026-08-07 | **[Sửa trước khi code]** Phát hiện `NotificationsService.enqueueEmailNotification()` lưu `content`/`emailHtml` VĨNH VIỄN vào bảng `notifications` — không dùng được cho mail chứa link/OTP của khách (sẽ lưu plaintext bí mật mãi trong DB, vi phạm chính nguyên tắc thiết kế). Đổi sang gọi `MailService.sendMail()` trực tiếp qua `GuestEmailService` mới, mirror đúng `AuthEmailService` (luồng OTP đặt lại mật khẩu hiện có cũng làm vậy, cùng lý do). Ảnh hưởng mục 2.2, 7.1, 7.3, 14. | Mục 2.2, 7.1, 7.3, 14 |

**Branch**: `feat-guest-live-meeting-access` (đề xuất) | **Date**: 2026-08-07 | **Spec**: spec.md

---

## 1. Feature Summary

Thêm module mới `src/modules/guest-access` cho phép khách ngoài công ty (`meeting_external_participants`, không có tài khoản `users`) tự xác thực bằng magic link + OTP để truy cập bản rút gọn của live-meeting, thông qua nhóm route công khai `/api/v1/guest/...` tách biệt hoàn toàn khỏi hệ thống RBAC nội bộ (secret JWT riêng, guard riêng, không permission nào). Có phòng chờ do host duyệt, host quản lý được lời mời (gửi lại/thu hồi), ghi điểm danh khách vào `attendance_events` bằng `event_type` riêng, và bắt buộc khóa xác thực WebSocket kèm theo (điều kiện chặn release). Không thêm bảng database — toàn bộ trạng thái bền nằm trong `meeting_external_participants.metadata_json`, trạng thái tạm thời nằm trong Redis.

## 2. Technical Context

### 2.1 Tech Stack

NestJS + TypeORM + PostgreSQL + Redis (`ioredis` qua `RedisService`) + `@nestjs/jwt`. Không dependency npm mới. 1 migration seed permission (3 permission mới `meeting.guest.*`). Không migration schema (không CREATE TABLE, không ALTER TABLE).

### 2.2 Existing Codebase Analysis

| Thành phần | Vị trí | Vai trò trong feature này |
| :--- | :--- | :--- |
| `MeetingExternalParticipantEntity` | `meetings/entities/meeting-external-participant.entity.ts` | Ghi `metadata_json.guestInvite` |
| `MeetingRequestReviewService.approve()` | `meetings/services/meeting-request-review.service.ts:87+` | **Điểm hook sinh lời mời** — dòng 414-430 (transaction load external participants), dòng 570-599 (gửi email hiện có) |
| `MeetingsService.cancelMeeting()` | `meetings/services/meetings.service.ts:2415` | **Điểm hook thu hồi phiên khách** khi meeting cancelled |
| `LiveMeetingService.endMeeting()` | `live-meeting/services/live-meeting.service.ts:1884` | **Điểm hook thu hồi phiên khách** khi meeting completed |
| `JwtAuthGuard` | `auth/guards/jwt-auth.guard.ts` | KHÔNG dùng cho route khách — nhưng phải xác nhận route khách **không** vô tình lọt qua guard này |
| `PermissionsGuard` | `auth/guards/permissions.guard.ts` | KHÔNG dùng cho route khách |
| `RateLimitGuard` | `auth/guards/rate-limit.guard.ts` | **CẤM DÙNG** — stub `return true` |
| `RedisService` | `redis/redis.service.ts` | Toàn bộ OTP/rate-limit/phiên/lobby |
| `PasswordResetCacheService` | `auth/services/password-reset-cache.service.ts` | Pattern mẫu cho OTP session + rate-limit + `invalidateUserTokens` |
| `AuthConfigService` | `auth/services/auth-config.service.ts` | Pattern mẫu cho 1 config service đọc secret/TTL từ `ConfigService` |
| `TokenService` | `auth/services/token.service.ts` | Pattern mẫu cho service sinh JWT bằng `JwtService.signAsync` với secret riêng |
| `EventsGateway` | `websocket/events.gateway.ts` | **Điểm sửa bắt buộc** — `handleConnection()`, `handleMeetingSubscribe()` |
| `AttendanceEventEntity` | `attendance/entities/attendance-event.entity.ts` | Ghi `guest_join`/`guest_leave` |
| `AuditLogEntity` | `administration/` (module `@Global`, export `AuditLogsService`) | Ghi audit cho mọi hành động |
| `mail/templates/builders.ts` + `layout.ts` | `mail/` | Thêm 2 builder mới: lời mời + OTP |
| `AuthEmailService` | `auth/services/auth-email.service.ts` | **Pattern mẫu bắt buộc theo** — gọi `MailService.sendMail()` trực tiếp (KHÔNG qua `NotificationsService`) vì mail này chứa bí mật, không được persist `content` vĩnh viễn vào bảng `notifications` |
| `MailService` | `mail/mail.service.ts` | Gọi trực tiếp từ `GuestEmailService` mới |
| `env.validation.ts` | `config/env.validation.ts:49-88` | Thêm block config mới nối tiếp block D/E (JWT/OTP) |
| Migration mẫu seed permission | `20260717100001-SeedMeetingMinutesSharePermissions.ts` | Copy pattern cho `meeting.guest.*` |
| `masking.util.ts` | `common/utils/masking.util.ts` | Tham khảo (không dùng trực tiếp cho email-mask hiển thị khách) |

### 2.3 Patterns to Follow

- Controller trả `{ success, message, data }` (và `meta` cho list có phân trang).
- Guard 2 tầng riêng cho khách: `GuestSessionGuard` (verify JWT + Redis revoke check, gán `request.guest`) rồi `GuestMeetingScopeGuard` (so `params.meetingId` với `token.mid`) — mirror kiến trúc 2 tầng `JwtAuthGuard` + `PermissionsGuard` hiện có, nhưng KHÔNG kế thừa/tái sử dụng trực tiếp 2 class đó (khác secret, khác nguồn dữ liệu authorization).
- Ownership-or-admin check cho API phía host (mirror `issueMinutes`/`shareMinutes`): `isAdmin = roles includes SYSTEM_ADMIN/BUSINESS_ADMIN`; `isHost = meeting.hostId === userId`.
- Redis key namespace theo domain, TTL rõ ràng cho từng key — mirror `password-reset-cache.service.ts`.
- Toàn bộ ghi `metadata_json` qua raw SQL `jsonb_set` (`DataSource.query(...)` hoặc `QueryBuilder.update().set({ metadataJson: () => "jsonb_set(...)" })`), KHÔNG qua `repository.save(entity)` sau khi gán field trong JS.

## 3. Scope Confirmation

### 3.1 In Scope

- Module `guest-access` mới: config service, token util (hash/verify secret), guest JWT service, Redis cache service, guard 2 tầng, controller công khai (3 route), controller phía host (4-5 route, gắn vào `LiveMeetingController` hoặc controller mới cùng module `live-meeting`/`guest-access` — quyết định cụ thể ở mục 5.1).
- Hook sinh lời mời tại `approve()`.
- Hook thu hồi phiên tại `cancelMeeting()`/`endMeeting()`.
- 2 mail builder mới.
- Sửa `EventsGateway` (auth handshake + scope check subscribe).
- Ghi `attendance_events` cho guest join/leave.
- Migration seed 3 permission `meeting.guest.*`.
- Thêm biến môi trường mới vào `env.validation.ts`.
- Unit test cho toàn bộ service/guard mới + regression test cho 3 điểm hook bị sửa.

### 3.2 Out of Scope

Xem `spec.md` mục 8. Nhắc lại 2 điểm quan trọng nhất: KHÔNG thêm bảng, KHÔNG dùng `RateLimitGuard` hiện có.

### 3.3 Constitution Gate Check

| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS — `GUEST_TOKEN_SECRET` qua env, không log; mã bí mật/OTP chỉ tồn tại dạng hash (SHA-256) |
| SEC-02 (auth bắt buộc cho mutating endpoint) | **Deviation có chủ đích, đã document**: 3 endpoint công khai (`GET invite`, `POST otp`, `POST verify`) là mutating (ghi Redis/DB) nhưng KHÔNG yêu cầu JWT — vì đối tượng gọi (khách) không có JWT theo định nghĩa của tính năng. Bù đắp bằng: xác minh sở hữu email qua OTP, rate-limit riêng, cửa sổ thời gian, gộp response lỗi để chống enumeration (spec mục 4.2, FR-GLA-028). Toàn bộ endpoint host-side (admit/reject/resend/revoke/list) VẪN bắt buộc `JwtAuthGuard`+`PermissionsGuard`+ownership. |
| SEC-03 (input validation) | PASS — DTO validate OTP 6 chữ số, `ParseUUIDPipe`/regex cho `meetingId`/`externalParticipantId`, token link parse an toàn (không dùng trực tiếp trong query, tách rồi validate format trước khi query) |
| DATA-01 (soft-delete cho business-critical entity) | **Không áp dụng trực tiếp** — feature này không tạo entity/bảng mới. `guestInvite` trong `metadata_json` không phải bản ghi độc lập cần soft-delete; "xóa" một lời mời = ghi đè bằng lời mời mới hoặc set `status='revoked'`, dữ liệu gốc (`meeting_external_participants`) không bị xóa. Lịch sử revoke/resend được bù bằng `audit_logs` (mirror lý do đã dùng ở `feat-share-meeting-minutes`). |
| ARCH-01 (service boundary) | PASS — chỉ dùng entity/service đã có qua injection, không truy cập DB module khác trực tiếp ngoài `DataSource` cho raw SQL (đã có tiền lệ nhiều nơi trong repo) |
| ARCH-02 (async cho >2s) | **Deviation có tiền lệ**: mail chứa link/OTP của khách gọi `MailService.sendMail()` đồng bộ trực tiếp (KHÔNG qua hàng đợi `NotificationsService`), mirror đúng `AuthEmailService.sendOtp()` hiện có cho luồng đặt lại mật khẩu — lý do: hàng đợi persist `content`/`emailHtml` vĩnh viễn vào bảng `notifications`, sẽ lưu bí mật plaintext mãi trong DB. 1 lệnh SMTP gửi 1 email thường dưới 2s trong điều kiện bình thường (đúng tiền lệ đã chấp nhận ở `feat-password-reset-otp`); nếu SMTP treo, `MailService` có `connectionTimeout`/`socketTimeout` riêng (mặc định 10s) để không treo vô hạn. |
| ARCH-03 (idempotency) | PASS — "Gửi lại link" ghi đè `guestInvite` (natural idempotency, không tạo dòng trùng); verify OTP đúng nhiều lần liên tiếp (trước khi hết hạn) trả cùng 1 phiên hợp lệ về mặt ngữ nghĩa (không lỗi, nhưng KHÔNG cấp lại `jti` mới mỗi lần — xem mục 7.3) |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng — toàn bộ endpoint có `@ApiOperation`/`@ApiResponse` |
| ENG-03 (error không lộ stack trace) | PASS — lỗi Redis/DB catch và map sang mã lỗi chuẩn hóa, không lộ nguyên văn |

### 3.4 Complexity Tracking

Đây là feature phức tạp nhất tính tới thời điểm hiện tại của module `live-meeting`/`meetings` vì: (a) tạo **toàn bộ hệ thống xác thực song song** (không phải mở rộng RBAC hiện có), (b) đụng vào 3 method nghiệp vụ lớn sẵn có (`approve`, `cancelMeeting`, `endMeeting`), (c) sửa hạ tầng dùng chung (`EventsGateway`). Không cần ADR riêng theo yêu cầu Constitution (không có Layer 2 violation), nhưng khuyến nghị review kỹ hơn bình thường ở 3 điểm hook và ở `EventsGateway` trước khi merge.

## 4. Data Model Impact

Tóm tắt: **0 bảng mới, 0 cột mới**. Chỉ ghi nhánh `metadata_json.guestInvite` (đã tồn tại cột `jsonb`), sinh dữ liệu Redis theo `data-model.md` mục 3, 3 permission mới (migration).

### 4.1 Migration duy nhất: seed permission

```
src/database/migrations/<timestamp>-SeedGuestAccessPermissions.ts
```
Copy pattern từ `20260717100001-SeedMeetingMinutesSharePermissions.ts`: seed `meeting.guest.invite.manage`, `meeting.guest.session.read`, `meeting.guest.admit` (module_code=`guest-access`), gán role `INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.

### 4.2 Điểm cần xác nhận TRƯỚC khi code (đánh dấu trong `data-model.md` mục 1)

`meetings` có cột `metadata_json` không? Cần đọc `MeetingEntity` đầy đủ để xác nhận trước khi quyết định nơi lưu override `lobby_enabled` theo từng cuộc họp (FR-GLA-027). Nếu không có, dùng phương án dự phòng `system_configs` key theo `meetingId` (đã ghi trong `data-model.md`).

## 5. API / Contract Plan

### 5.1 Vị trí đặt route

- **Nhóm công khai** (không JWT): `GuestAccessController`, module `guest-access`, prefix `guest`:
  - `GET /api/v1/guest/invites/:token`
  - `POST /api/v1/guest/invites/:token/otp`
  - `POST /api/v1/guest/invites/:token/verify`
  - `GET /api/v1/guest/meetings/:meetingId` (nội dung cuộc họp rút gọn — dùng `GuestSessionGuard`+`GuestMeetingScopeGuard`)
- **Nhóm phía host** (JWT nội bộ): thêm route mới vào `LiveMeetingController` hiện có (nhất quán vị trí `live-meetings/:meetingId/...` đã dùng cho các thao tác điều hành phiên họp khác) hoặc 1 controller riêng `GuestManagementController` cùng module `live-meeting` để tránh phình file `live-meeting.controller.ts` (hiện đã 815 dòng) — **khuyến nghị: controller riêng**, import `AuthzReadRepository` giống `LiveMeetingController` để tái dùng permission-check pattern:
  - `GET /api/v1/live-meetings/:meetingId/guests` — danh sách khách + trạng thái (mời/đã vào/đang chờ)
  - `GET /api/v1/live-meetings/:meetingId/guests/lobby` — hàng chờ hiện tại
  - `POST /api/v1/live-meetings/:meetingId/guests/:externalParticipantId/admit`
  - `POST /api/v1/live-meetings/:meetingId/guests/:externalParticipantId/reject`
  - `POST /api/v1/live-meetings/:meetingId/guests/:externalParticipantId/resend-invite`
  - `DELETE /api/v1/live-meetings/:meetingId/guests/:externalParticipantId/access`

### 5.2 Request / Response (tóm tắt — chi tiết field khi implement theo `data-model.md`)

**`GET /guest/invites/:token`** → `200`:
```jsonc
{
  "success": true,
  "message": "Thong tin loi moi",
  "data": {
    "meetingTitle": "string",
    "startTime": "ISO", "endTime": "ISO",
    "hostName": "string",
    "maskedEmail": "ng***@abc.com",
    "verificationMode": "otp"
  }
}
```

**`POST /guest/invites/:token/otp`** → `200`: `{ success: true, message: "Ma xac nhan da duoc gui" }` (KHÔNG trả email/OTP).

**`POST /guest/invites/:token/verify`** body `{ otp: string }` → `200`:
```jsonc
{
  "success": true,
  "message": "Xac thuc thanh cong",
  "data": { "guestToken": "jwt", "lobbyRequired": true, "meetingId": "uuid" }
}
```

**`GET /guest/meetings/:meetingId`** → `200`: nội dung Mức B (agenda, participants rút gọn, trạng thái phiên, notes chia sẻ) — schema chi tiết định nghĩa khi implement (không lặp lại toàn bộ `MeetingResponseDto` nội bộ, viết DTO riêng `GuestMeetingViewDto`).

**Host — `GET .../guests`** → `200` list `{ externalParticipantId, fullName, organizationName, invitationStatus, guestInvite: { status }, lobbyStatus, lastJoinedAt }`.

### 5.3 Error Responses

Theo `spec.md` mục 6, dùng đúng error code đã liệt kê (`GUEST_INVITE_INVALID`, `GUEST_INVITE_EXPIRED`, `GUEST_INVITE_REVOKED`, `GUEST_JOIN_WINDOW_CLOSED`, `GUEST_MEETING_CANCELLED`, `GUEST_OTP_INVALID`, `GUEST_OTP_BLOCKED`, `GUEST_OTP_TOO_MANY_REQUESTS`, `GUEST_SESSION_INVALID`, `GUEST_MEETING_SCOPE_MISMATCH`).

## 6. Authorization Plan

### 6.1 Nhóm công khai (khách)

```
GuestSessionGuard (chỉ áp dụng cho GET /guest/meetings/:meetingId, KHÔNG áp dụng cho 3 route invite/otp/verify — 3 route đó tự xác thực bằng token trong path, chưa có JWT ở bước này)
  1. Đọc header Authorization: Bearer <guestJwt> (KHÔNG dùng cùng header pattern gây nhầm lẫn — cân nhắc header riêng `X-Guest-Token` nếu FE cần phân biệt rõ, quyết định cụ thể khi implement, mặc định dùng chung `Authorization: Bearer` để tái dùng thói quen FE hiện có)
  2. Verify bằng GUEST_TOKEN_SECRET, kiểm tra claim typ='guest'
  3. Kiểm tra guest:revoked:<jti> KHÔNG tồn tại trong Redis
  4. Kiểm tra guest:invite:<sub>:invalid_after — now phải <= giá trị đó (nếu có)
  5. Gán request.guest = { externalParticipantId: sub, meetingId: mid, jti }
  6. KHÔNG gán request.user
GuestMeetingScopeGuard (chạy sau GuestSessionGuard)
  1. So request.guest.meetingId với params.meetingId
  2. Lệch → 403 GUEST_MEETING_SCOPE_MISMATCH
  3. Đọc tươi meetings.status/endTime từ DB — kiểm tra chưa cancelled/completed VÀ trong cửa sổ [startTime-30', endTime+15']
```

### 6.2 Nhóm phía host

```
1. JwtAuthGuard (xác thực nhân viên)
2. PermissionsGuard + @RequirePermissions('meeting.guest.invite.manage' | 'meeting.guest.session.read' | 'meeting.guest.admit')
3. Service: isAdmin (AuthzReadRepository) OR isHost (meeting.hostId === userId) — else 403 NOT_MEETING_HOST
```

## 7. Business Logic Plan

### 7.1 Flow — Sinh lời mời (hook trong `approve()`)

```text
TRONG transaction hiện có của approve(), SAU khi load externalParticipants (dòng ~417-421):
1. FOR EACH ep IN externalParticipants WHERE ep.email IS NOT NULL:
     secret = randomBytes(32).toString('base64url')
     tokenHash = sha256(secret).hex
     guestInvite = {
       tokenHash, issuedAt: now, issuedBy: authUser.userId,
       expiresAt: meeting.endTime + 24h,
       status: 'active', invalidAfter: null,
       firstJoinedAt: null, lastJoinedAt: null,
     }
     UPDATE meeting_external_participants SET metadata_json = jsonb_set(...) WHERE id = ep.id
       (raw query trong CÙNG transaction/EntityManager của approve())
     ghi nhớ { epId: ep.id, email: ep.email, secret } vào 1 mảng tạm (secret KHÔNG rời khỏi bộ nhớ này)
2. Transaction commit như luồng hiện có
3. SAU KHI commit (như đoạn gửi mail hiện tại dòng 570-599, nhưng gọi `GuestEmailService.sendInviteLink()` → `MailService.sendMail()` trực tiếp, KHÔNG qua `NotificationsService`):
     FOR EACH item trong mảng tạm bước 1:
       link = `${GUEST_ACCESS_INVITE_BASE_URL}/${item.epId}.${item.secret}`
       await guestEmailService.sendInviteLink({ to: item.email, meetingTitle, startTime, endTime, hostName, link })
       (best-effort — lỗi gửi mail KHÔNG rollback bước 1, catch + audit lỗi giống pattern writeNotificationFailureAudit hiện có)
     ghi audit_logs action=guest_invite_issued cho từng khách (user_id=NULL)
```

### 7.2 Flow — Xem thông tin lời mời (`GET /guest/invites/:token`)

```text
1. Parse token: split theo dấu '.', phần đầu = epId (UUID), phần sau = secret
   Format sai → 400 GUEST_INVITE_INVALID (KHÔNG query DB)
2. SELECT meeting_external_participants JOIN meetings WHERE ep.id = :epId
   Không tìm thấy → thực hiện "dummy hash compare" (chống timing enumeration, xem research.md rủi ro #3) → 400 GUEST_INVITE_INVALID
3. guestInvite = metadata_json.guestInvite; không tồn tại → 400 GUEST_INVITE_INVALID
4. computedHash = sha256(secret).hex
   timingSafeEqual(computedHash, guestInvite.tokenHash) === false → 400 GUEST_INVITE_INVALID
5. now > guestInvite.expiresAt → 410 GUEST_INVITE_EXPIRED
   guestInvite.invalidAfter VÀ now > invalidAfter → 410 GUEST_INVITE_REVOKED
6. meeting.status === CANCELLED → 409 GUEST_MEETING_CANCELLED
7. Trả thông tin (mục 5.2) — KHÔNG đổi state nào
```

### 7.3 Flow — Gửi OTP (`POST /guest/invites/:token/otp`)

```text
1-6. Giống bước 1-6 của mục 7.2 (validate lại từ đầu, không tin trạng thái đã validate ở bước trước)
7. Kiểm tra cửa sổ thời gian [meeting.startTime - joinWindowBefore, meeting.endTime + joinWindowAfter]
   Ngoài cửa sổ → 409 GUEST_JOIN_WINDOW_CLOSED
8. guest:otp_blocked:<epId> tồn tại → 423/429 GUEST_OTP_BLOCKED (chốt mã HTTP cụ thể khi implement — đề xuất 429 để nhất quán với GUEST_OTP_TOO_MANY_REQUESTS, phân biệt bằng error.code)
9. INCR guest:otp_send:<epId>; nếu vượt max (mặc định 3/5 phút) → 429 GUEST_OTP_TOO_MANY_REQUESTS (không gửi mail)
10. Sinh OTP 6 số bằng CSPRNG, SETEX guest:otp:<epId> = sha256(otp), TTL 10 phút
11. RESET guest:otp_attempt:<epId> về 0 (OTP mới → cho phép thử lại từ đầu)
12. await guestEmailService.sendOtp({ to: ep.email, otp, meetingTitle }) → MailService.sendMail() trực tiếp (mirror AuthEmailService.sendOtp, KHÔNG qua NotificationsService) tới ep.email (KHÔNG tới email nào khác)
13. Ghi audit_logs action=guest_otp_requested (user_id=NULL)
14. Trả 200 (không nội dung nhạy cảm)
```

### 7.4 Flow — Xác minh OTP (`POST /guest/invites/:token/verify`)

```text
1-7. Giống bước 1-7 của mục 7.3
8. guest:otp_blocked:<epId> tồn tại → 429 GUEST_OTP_BLOCKED
9. storedHash = GET guest:otp:<epId>
   Không tồn tại (hết hạn/chưa từng gửi) → 409 GUEST_OTP_INVALID
10. sha256(dto.otp) !== storedHash (timing-safe) →
      INCR guest:otp_attempt:<epId>
      NẾU đạt 5 → SETEX guest:otp_blocked:<epId> TTL 15 phút; DEL guest:otp:<epId>
      → 409 GUEST_OTP_INVALID (ghi audit guest_otp_verify_failed)
11. Đúng OTP:
      DEL guest:otp:<epId>, guest:otp_attempt:<epId>
      UPDATE metadata_json.guestInvite: status='used' (nếu đang 'active'), firstJoinedAt=firstJoinedAt||now, lastJoinedAt=now (qua jsonb_set)
      jti = uuidv4()
      guestToken = sign({ typ:'guest', sub:epId, mid:meetingId, scope:['meeting.guest.view'], jti }, GUEST_TOKEN_SECRET, { expiresIn: '4h' })
      SETEX guest:session:<jti> = { deviceHint }, TTL 4h
      lobbyEnabled = resolveLobbyEnabled(meetingId)  // đọc system_configs + override
      IF lobbyEnabled:
        SADD guest:lobby:<meetingId> epId
        SET guest:lobby:status:<epId> = 'waiting'
      ELSE:
        SET guest:lobby:status:<epId> = 'admitted'  // bỏ qua chờ duyệt
      ghi audit_logs action=guest_otp_verified (user_id=NULL)
      Trả 200 { guestToken, lobbyRequired: lobbyEnabled, meetingId }
```

### 7.5 Flow — Đọc nội dung cuộc họp (`GET /guest/meetings/:meetingId`)

```text
1. GuestSessionGuard + GuestMeetingScopeGuard đã pass (mục 6.1)
2. lobbyStatus = GET guest:lobby:status:<sub>
   IF lobbyStatus === 'waiting' → 403 GUEST_LOBBY_PENDING (chờ host duyệt — mã lỗi bổ sung, thêm vào spec.md khi review)
   IF lobbyStatus === 'rejected' → 401 GUEST_SESSION_INVALID
3. Ghi 1 lần duy nhất attendance_events(event_type='guest_join') NẾU đây là lần đầu tiên trong phiên
   (dùng cờ trong guest:session:<jti> để tránh ghi trùng mỗi lần gọi API, ví dụ field `attendanceLogged: true` set sau lần ghi đầu)
4. Query dữ liệu Mức B: meeting info, agenda, participants rút gọn (chỉ fullName+organizationName cho khách khác, fullName+department cho nhân viên — theo đúng giới hạn field), session status, notes có cờ chia sẻ=true
5. Trả 200
```

### 7.6 Flow — Host duyệt/từ chối phòng chờ

```text
Admit:
1. Ownership-or-admin check
2. SREM guest:lobby:<meetingId> epId; SET guest:lobby:status:<epId> = 'admitted'
3. audit_logs action=guest_admitted (user_id=host)
Reject:
1. Ownership-or-admin check
2. SREM guest:lobby:<meetingId> epId; SET guest:lobby:status:<epId> = 'rejected'
3. Thu hồi phiên hiện tại: cần biết jti hiện tại của khách đó — lưu jti mới nhất theo epId (thêm key `guest:invite:<epId>:current_jti` khi verify OTP thành công) để tra và SET guest:revoked:<jti>
4. audit_logs action=guest_rejected (user_id=host)
```
> **Cập nhật `data-model.md`**: cần bổ sung key `guest:invite:<epId>:current_jti` (string, TTL = TTL phiên) để hỗ trợ luồng reject/revoke tra ngược từ epId sang jti hiện tại — bổ sung khi implement, đã ghi chú tại đây để không sót.

### 7.7 Flow — Host resend / revoke

```text
Resend: giống mục 7.1 bước 1 cho MỘT khách cụ thể (không cần transaction lồng approve), rồi:
  - Thu hồi jti hiện tại (nếu có) qua guest:invite:<epId>:current_jti
  - Xóa các key OTP/attempt/blocked cũ của epId (reset sạch)
  - Gửi lại email link mới
  - audit_logs action=guest_invite_resent (user_id=host)
Revoke:
  - SET guest:invite:<epId>:invalid_after = now() (TTL 24h)
  - Thu hồi jti hiện tại nếu có
  - UPDATE metadata_json.guestInvite.status = 'revoked'
  - audit_logs action=guest_access_revoked (user_id=host)
```

### 7.8 Flow — Thu hồi khi meeting cancelled/completed

```text
SAU KHI transaction chính (cancelMeeting/endMeeting) commit thành công:
1. SELECT ep FROM meeting_external_participants WHERE meeting_id=:id AND metadata_json->'guestInvite' IS NOT NULL
2. FOR EACH ep:
     SET guest:invite:<ep.id>:invalid_after = now() (TTL 24h)
     Thu hồi jti hiện tại nếu có (guest:invite:<ep.id>:current_jti)
     UPDATE metadata_json.guestInvite.status = 'revoked' (qua jsonb_set)
3. audit_logs action=guest_access_auto_revoked (user_id=NULL) — có thể gộp 1 dòng cho cả meeting thay vì 1 dòng/khách, quyết định khi implement dựa trên volume thực tế
Toàn bộ bước này BEST-EFFORT — lỗi ở đây chỉ log, KHÔNG throw, KHÔNG ảnh hưởng response chính của cancelMeeting/endMeeting.
```

## 8. Validation Plan

| Field | Validation |
|---|---|
| `token` (path, invite) | Regex `^[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,}$` (UUID + base64url), reject sớm nếu không khớp |
| `otp` (body verify) | `@IsString()`, regex `^\d{6}$` |
| `meetingId` (path) | `ParseUUIDPipe` |
| `externalParticipantId` (path, host-side) | `ParseUUIDPipe` |
| Guest JWT | Verify chữ ký + `typ==='guest'` + `exp` chưa qua |

## 9. Error Handling Plan

| Điều kiện | Exception | HTTP | Code |
|---|---|---|---|
| Token sai định dạng/không tồn tại/hash sai | `BadRequestException` | 400 | `GUEST_INVITE_INVALID` |
| Lời mời hết hạn | `GoneException` | 410 | `GUEST_INVITE_EXPIRED` |
| Lời mời bị thu hồi | `GoneException` | 410 | `GUEST_INVITE_REVOKED` |
| Ngoài cửa sổ thời gian | `ConflictException` | 409 | `GUEST_JOIN_WINDOW_CLOSED` |
| Meeting cancelled | `ConflictException` | 409 | `GUEST_MEETING_CANCELLED` |
| OTP sai/hết hạn | `ConflictException` | 409 | `GUEST_OTP_INVALID` |
| Lời mời bị khóa do nhập sai quá nhiều | `TooManyRequestsException`/`429` | 429 | `GUEST_OTP_BLOCKED` |
| Gửi OTP quá nhiều lần | `TooManyRequestsException` | 429 | `GUEST_OTP_TOO_MANY_REQUESTS` |
| Token phiên khách thiếu/sai/hết hạn/thu hồi | `UnauthorizedException` | 401 | `GUEST_SESSION_INVALID` |
| Sai phạm vi meeting | `ForbiddenException` | 403 | `GUEST_MEETING_SCOPE_MISMATCH` |
| Đang chờ host duyệt | `ForbiddenException` | 403 | `GUEST_LOBBY_PENDING` |
| Host không sở hữu meeting | `ForbiddenException` | 403 | `NOT_MEETING_HOST` |

## 10. Testing Strategy

### 10.1 Unit Tests — Service mới

Happy path toàn bộ luồng (issue → view invite → request otp → verify → lobby → admit → view content → attendance event ghi đúng 1 lần). Enumeration: id không tồn tại vs hash sai trả cùng response. Rate-limit: gửi OTP quá giới hạn, nhập sai quá giới hạn. Cửa sổ thời gian: trước/trong/sau. Resend ghi đè lời mời cũ (link cũ chết). Revoke tức thời. Meeting cancelled/completed thu hồi toàn bộ.

### 10.2 Unit Tests — Guard mới

`GuestSessionGuard`: từ chối token nhân viên (khác secret), từ chối token hết hạn, từ chối token trong `revoked` set, gán đúng `request.guest`, KHÔNG gán `request.user`. `GuestMeetingScopeGuard`: từ chối lệch `meetingId`.

### 10.3 Unit Tests — Regression tại 3 điểm hook

`approve()`: xác nhận luồng hiện có (booking approve, notification nội bộ, email khách) KHÔNG đổi hành vi khi khách không có email (không sinh lời mời, không lỗi). `cancelMeeting()`/`endMeeting()`: xác nhận response/side-effect hiện có không đổi khi thêm bước thu hồi guest (kể cả khi meeting không có khách nào — no-op sạch).

### 10.4 Unit Tests — WebSocket

Kết nối không token bị từ chối. Token khách subscribe đúng `meetingId` → join room. Token khách subscribe sai `meetingId` → bị từ chối, không join.

## 11. Implementation Phases

| Phase | Nội dung | Output |
|---|---|---|
| 1 | Nền móng: config service, token util, guest JWT service, Redis cache service, 2 guard, migration seed permission, env vars mới | Không route nào hoạt động, không đụng code hiện có |
| 2 | Luồng xác thực E2E: 3 route công khai + hook sinh lời mời tại `approve()` + 2 mail builder | Khách xác minh được OTP, nhận guest token |
| 3 | Phòng chờ + API nội dung cho khách + API quản lý phía host | Khách xem được nội dung, host quản lý được |
| 4 | Khóa WebSocket + ghi `attendance_events` + hook thu hồi tại `cancelMeeting`/`endMeeting` | Điều kiện chặn release hoàn tất |

(Khớp với 4 task đã tạo trong task tracker của phiên làm việc này.)

## 12. Risks & Mitigations

Xem `research.md` mục 3 — đầy đủ 6 rủi ro đã phân tích, đặc biệt rủi ro #1 (WebSocket là điều kiện chặn release) và #6 (TTL động của guest JWT).

## 13. Acceptance Criteria Traceability

Xem `spec.md` mục 7.5.

## 14. File Structure Changes

### New files

```
src/modules/guest-access/
  guest-access.module.ts
  constants/guest-access.constants.ts
  constants/guest-access-error.constant.ts
  config/guest-access-config.service.ts
  utils/guest-invite-token.util.ts        (sinh/hash/parse token link)
  services/guest-invite.service.ts        (issue/resend/revoke, đọc/ghi metadata_json)
  services/guest-email.service.ts         (gọi MailService.sendMail() trực tiếp — mirror AuthEmailService, KHÔNG qua NotificationsService)
  services/guest-otp.service.ts           (request/verify OTP)
  services/guest-session.service.ts       (sign/verify guest JWT, revoke)
  services/guest-lobby.service.ts         (admit/reject, Redis SET)
  services/guest-access-cache.service.ts  (toàn bộ thao tác Redis, key theo data-model.md mục 3)
  guards/guest-session.guard.ts
  guards/guest-meeting-scope.guard.ts
  controllers/guest-access.controller.ts  (3 route công khai + GET nội dung)
  controllers/guest-management.controller.ts (route phía host)
  dto/... (request/response DTO theo mục 5.2)
  types/... (guest-jwt-payload.type.ts, guest-invite-metadata.type.ts)

src/database/migrations/
  <timestamp>-SeedGuestAccessPermissions.ts

src/modules/mail/templates/builders.ts   (thêm buildGuestInviteEmail, buildGuestOtpEmail)
```

### Modified files

```
src/config/env.validation.ts             (thêm GUEST_TOKEN_SECRET + GUEST_ACCESS_* config)
src/app.module.ts                        (import GuestAccessModule)
src/modules/meetings/services/meeting-request-review.service.ts  (hook sinh lời mời trong approve())
src/modules/meetings/services/meetings.service.ts                (hook thu hồi trong cancelMeeting())
src/modules/live-meeting/services/live-meeting.service.ts        (hook thu hồi trong endMeeting())
src/modules/websocket/events.gateway.ts  (auth handshake + scope check subscribe)
src/modules/attendance/attendance.module.ts (nếu cần export thêm gì cho guest-access dùng AttendanceEventEntity)
```

### No change

- Database schema (không migration CREATE/ALTER TABLE).
- `JwtAuthGuard`, `PermissionsGuard`, `RateLimitGuard` (không sửa, chỉ không dùng cho route khách).
- `meeting_external_participants` entity (không thêm cột — chỉ dùng cột `metadata_json` đã có).

## Artifacts Produced
`spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `tasks.md`.
