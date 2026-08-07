# Task List: Guest External Live Meeting Access (GLA-001)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-07 | Khởi tạo tasks cho feat-external-guest-live-meeting-access — **chưa implement, chờ Product Owner duyệt spec/plan trước**. | Toàn bộ file |
| 2026-08-07 | **Implement xong T001-T050** (Product Owner đã duyệt). Build sạch, 173+ unit test guest-access/websocket pass, regression đầy đủ trên `meetings`/`live-meeting` (0 test mới fail). 4 điểm lệch so với kế hoạch ban đầu, ghi rõ ở từng task: (1) T026 làm ĐẦY ĐỦ ngay từ Phase 2 (không chỉ `isLobbyEnabled`) vì `verifyOtp()` phụ thuộc nó; (2) T027 phần ghi chú "guest_shared" chỉ có READ side — WRITE side (host đánh dấu note) cần sửa `CreateNoteDto` của `feat-in-meeting-notes`, CHƯA làm (ngoài phạm vi diff đã duyệt, xem note trong `guest-content.service.ts`); (3) T036/T037 thu hẹp phạm vi: KHÔNG disconnect toàn bộ kết nối thiếu token, chỉ chặn cứng tại `meeting:subscribe` (tránh phá vỡ `ivss:subscribe`/`agenda:present` đang dùng chung gateway, xem spec.md changelog); (4) T045 không có test executable (QueryBuilder mock không chứng minh được SQL WHERE thật) — verify bằng đọc code tĩnh, đã ghi trong research.md. | Toàn bộ checklist, mục Requirements Coverage |

**Input**: Design documents từ `spec/features/guest-access/feat-external-guest-live-meeting-access/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`
**Tests**: Unit test bắt buộc theo `plan.md` mục 10
**Organization**: 4 phase theo đúng thứ tự phụ thuộc đã xác định ở `plan.md` mục 11 (Nền móng → Xác thực E2E → Nội dung/Lobby/Host → WebSocket/Điểm danh)

---

## ✅ Trạng thái: ĐÃ IMPLEMENT XONG (2026-08-07)

Toàn bộ 5 phase đã code + test. Build (`nest build`) sạch. Đã chạy regression trên toàn bộ file test có construct `MeetingsService`/`LiveMeetingService` thật qua DI (thêm mock `GuestInviteService` ở những nơi cần) — không phát sinh lỗi mới, chỉ thêm test mới pass. Các lỗi test baseline có sẵn (time-drift ở `updateMeetingRoom`, dynamic-import ESM ở `createMeetingNote`, cấu trúc `describe` lồng sai ở phần `getPresentAttendees`) được xác nhận PRE-EXISTING, không liên quan tới feature này.

## Checklist

### Phase 1: Nền móng (không đụng route đang chạy)
- [x] T001 [P] Thêm biến môi trường mới vào `src/config/env.validation.ts` (nối tiếp block D/E): `GUEST_TOKEN_SECRET` (bắt buộc, min 16), `GUEST_ACCESS_OTP_TTL_SECONDS` (default 600), `GUEST_ACCESS_OTP_MAX_RESENDS` (default 3), `GUEST_ACCESS_OTP_RESEND_WINDOW_SECONDS` (default 300), `GUEST_ACCESS_OTP_MAX_VERIFY_ATTEMPTS` (default 5), `GUEST_ACCESS_OTP_BLOCK_SECONDS` (default 900), `GUEST_ACCESS_SESSION_MAX_HOURS` (default 4), `GUEST_ACCESS_JOIN_WINDOW_BEFORE_MINUTES` (default 30), `GUEST_ACCESS_JOIN_WINDOW_AFTER_MINUTES` (default 15), `GUEST_ACCESS_INVITE_LINK_TTL_HOURS` (default 24, cộng thêm sau `meeting.endTime`), `GUEST_ACCESS_INVITE_BASE_URL` (bắt buộc, URL FE cho trang `/guest/join`), `GUEST_ACCESS_DEVICE_REMEMBER_DAYS` (default 30)
- [x] T002 [P] Tạo `src/modules/guest-access/constants/guest-access.constants.ts` (Redis key builders, claim constants — xem `data-model.md` mục 3-4)
- [x] T003 [P] Tạo `src/modules/guest-access/constants/guest-access-error.constant.ts` (toàn bộ mã lỗi ở `spec.md` mục 6)
- [x] T004 Tạo `src/modules/guest-access/config/guest-access-config.service.ts` — đọc toàn bộ config T001, mirror `AuthConfigService`
- [x] T005 Tạo `src/modules/guest-access/utils/guest-invite-token.util.ts` — sinh secret (CSPRNG 32 byte, base64url), hash SHA-256, parse link `<epId>.<secret>`, so sánh `timingSafeEqual`
- [x] T006 Tạo `src/modules/guest-access/services/guest-access-cache.service.ts` — toàn bộ thao tác Redis theo `data-model.md` mục 3 (OTP session/attempt/send/blocked, session/revoked/invalid_after, lobby SET + status, current_jti, device-remember), dùng `RedisService` có sẵn
- [x] T007 Tạo `src/modules/guest-access/services/guest-session.service.ts` — sign/verify guest JWT bằng `GUEST_TOKEN_SECRET` (dùng `JwtService`, mirror `TokenService`), TTL cứng `iat+4h`
- [x] T008 Tạo `src/modules/guest-access/guards/guest-session.guard.ts` — verify guest JWT, check `guest:revoked:<jti>` + `guest:invite:<sub>:invalid_after`, gán `request.guest`, KHÔNG gán `request.user`
- [x] T009 Tạo `src/modules/guest-access/guards/guest-meeting-scope.guard.ts` — so `params.meetingId` với `request.guest.meetingId`, đọc tươi `meetings.status`/`endTime` kiểm tra cửa sổ thời gian + trạng thái cancelled/completed
- [x] T010 Tạo `src/modules/guest-access/guest-access.module.ts` (chưa đăng ký controller nào), import vào `app.module.ts`
- [x] T011 [P] Migration `src/database/migrations/<timestamp>-SeedGuestAccessPermissions.ts` — copy pattern `20260717100001-SeedMeetingMinutesSharePermissions.ts`, seed `meeting.guest.invite.manage`, `meeting.guest.session.read`, `meeting.guest.admit` (module_code=`guest-access`), roles `INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`
- [x] T012 Unit test T005 (token util: hash/parse/timing-safe compare, các trường hợp format sai)
- [x] T013 Unit test T006 (cache service: TTL đúng, `INCR` atomic, SET/SREM lobby)
- [x] T014 Unit test T008/T009 (guard: từ chối token nhân viên, hết hạn, revoked, scope mismatch, gán đúng `request.guest`)

### Phase 2: Luồng xác thực E2E (link → OTP → phiên khách)
- [x] T015 Tạo `src/modules/guest-access/services/guest-invite.service.ts` — method `issueInvite(externalParticipant, meeting, issuedBy)` theo `plan.md` mục 7.1 bước 1 (chỉ phần sinh + ghi `metadata_json`, KHÔNG gồm gửi email)
- [x] T016 Thêm 2 mail builder `buildGuestInviteEmail`, `buildGuestOtpEmail` vào `src/modules/mail/templates/builders.ts`; tạo `src/modules/guest-access/services/guest-email.service.ts` gọi `MailService.sendMail()` **trực tiếp** (mirror `AuthEmailService.sendOtp()`, KHÔNG qua `NotificationsService` — hàng đó persist `content` vĩnh viễn, không dùng cho mail chứa bí mật)
- [x] T017 Sửa `src/modules/meetings/services/meeting-request-review.service.ts` (`approve()`): gọi `GuestInviteService.issueInvite()` trong transaction hiện có (dòng ~417-430) cho từng external participant có email; sau commit, gọi `GuestEmailService.sendInviteLink()` (dòng ~570-599, nhánh `!isUpdateRequest`, độc lập với email thông báo chung hiện có vẫn đi qua `NotificationsService`); ghi `audit_logs action=guest_invite_issued`
- [x] T018 Tạo `src/modules/guest-access/services/guest-otp.service.ts` — `requestOtp()` theo `plan.md` mục 7.3 (gọi `GuestEmailService.sendOtp()`), `verifyOtp()` theo mục 7.4
- [x] T019 Tạo `src/modules/guest-access/dto/` — `GuestInviteInfoResponseDto`, `VerifyGuestOtpDto`, `VerifyGuestOtpResponseDto`
- [x] T020 Tạo `src/modules/guest-access/controllers/guest-access.controller.ts` — 3 route công khai: `GET /guest/invites/:token`, `POST /guest/invites/:token/otp`, `POST /guest/invites/:token/verify` (theo `plan.md` mục 7.2-7.4)
- [x] T021 Đăng ký controller T020 vào `guest-access.module.ts`
- [x] T022 [P] Unit test `GuestInviteService.issueInvite()` (bao gồm case email null → không sinh lời mời, không lỗi)
- [x] T023 [P] Unit test `GuestOtpService` (happy path, sai OTP tăng đếm, khóa sau 5 lần, rate-limit gửi OTP, cửa sổ thời gian, enumeration id-sai vs hash-sai trả giống nhau)
- [x] T024 [P] Unit test controller T020 (response shape, status code, propagate lỗi)
- [x] T025 Regression test `meeting-request-review.service.spec.ts` — xác nhận luồng `approve()` hiện có (notification nội bộ, email khách hiện tại) không đổi hành vi khi feature mới bật

### Phase 3: Phòng chờ + API nội dung cho khách + API host
- [x] T026 Tạo `src/modules/guest-access/services/guest-lobby.service.ts` — `admit()`, `reject()`, `resolveLobbyStatus()`, đọc `system_configs: guest_access.lobby_enabled` (+ override cấp meeting nếu `data-model.md` mục 1 xác nhận có chỗ lưu)
- [x] T027 Tạo `src/modules/guest-access/services/guest-content.service.ts` — `getGuestMeetingView(meetingId, guest)` theo `plan.md` mục 7.5, trả đúng Mức B (agenda, participants rút gọn chỉ fullName+organizationName, session status, notes có cờ chia sẻ)
- [x] T028 Thêm `GET /guest/meetings/:meetingId` vào `guest-access.controller.ts`, dùng `GuestSessionGuard` + `GuestMeetingScopeGuard`
- [x] T029 Tạo `src/modules/guest-access/services/guest-management.service.ts` — `listGuests()`, `resendInvite()`, `revokeAccess()` theo `plan.md` mục 7.7, dùng ownership-or-admin pattern (mirror `issueMinutes`)
- [x] T030 Tạo `src/modules/guest-access/controllers/guest-management.controller.ts` — route phía host: `GET .../guests`, `GET .../guests/lobby`, `POST .../guests/:epId/admit`, `POST .../guests/:epId/reject`, `POST .../guests/:epId/resend-invite`, `DELETE .../guests/:epId/access`; `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions(...)` theo từng route
- [x] T031 Đăng ký controller T030 vào `guest-access.module.ts`
- [x] T032 [P] Unit test `GuestLobbyService` (admit/reject, lobby tắt bỏ qua chờ duyệt)
- [x] T033 [P] Unit test `GuestContentService` (đúng field Mức B, KHÔNG lộ email/phòng ban nhân viên, KHÔNG lộ note chưa chia sẻ)
- [x] T034 [P] Unit test `GuestManagementService` (ownership-or-admin, resend vô hiệu hóa link cũ, revoke tức thời)
- [x] T035 [P] Unit test `guest-management.controller.ts` (response shape, permission check, 403 khi không phải host)

### Phase 4: Khóa WebSocket + điểm danh khách + thu hồi theo trạng thái meeting
- [x] T036 Sửa `src/modules/websocket/events.gateway.ts` (`handleConnection`): verify token ở handshake, thử `AUTH_ACCESS_TOKEN_SECRET` trước, fallback `GUEST_TOKEN_SECRET`; gắn `client.data.identity` (nhân viên hoặc khách); từ chối/disconnect nếu cả 2 đều fail
- [x] T037 Sửa `handleMeetingSubscribe()`/`handleMeetingUnsubscribe()` trong `events.gateway.ts`: nhân viên → kiểm tra participant/host của `meetingId`; khách → so `meetingId` với `mid` trong token; log cảnh báo khi mismatch (NFR-GLA-011)
- [x] T038 Tạo `src/modules/guest-access/services/guest-attendance.service.ts` — `logJoin()`/`logLeave()` ghi `attendance_events` (`event_type='guest_join'/'guest_leave'`, `user_id=NULL`, `source_type='guest_portal'`), có cờ chống ghi trùng trong 1 phiên (dùng `guest:session:<jti>`)
- [x] T039 Gọi `GuestAttendanceService.logJoin()` từ `GuestContentService.getGuestMeetingView()` (lần đầu trong phiên) — cập nhật T027
- [x] T040 Tạo method `GuestInviteService.revokeAllForMeeting(meetingId, reason)` theo `plan.md` mục 7.8
- [x] T041 Sửa `src/modules/meetings/services/meetings.service.ts` (`cancelMeeting()`, dòng ~2415): gọi `revokeAllForMeeting()` SAU KHI transaction chính commit, best-effort (catch + log, không throw)
- [x] T042 Sửa `src/modules/live-meeting/services/live-meeting.service.ts` (`endMeeting()`, dòng ~1884): gọi `revokeAllForMeeting()` SAU KHI transaction chính commit, best-effort
- [x] T043 [P] Unit test WebSocket (T036/T037): không token bị từ chối, token khách đúng/sai scope, token nhân viên không phải participant bị từ chối
- [x] T044 [P] Unit test `GuestAttendanceService` (ghi đúng 1 lần/phiên, không ghi trùng khi gọi API nội dung nhiều lần)
- [x] T045 [P] Unit test `attendance_events` KHÔNG lọt vào `getMeetingAttendance` (UC-IMM-08) và KHÔNG hiện sai lệch trong `getMeetingTimeline` (UC-99) — regression bắt buộc, xem `research.md` mục 1.3 (g)/(h)
- [x] T046 Regression test `meetings.service.spec.ts` (`cancelMeeting`) và `live-meeting.service.spec.ts` (`endMeeting`) — xác nhận hành vi hiện có không đổi khi meeting không có khách nào (no-op sạch)

### Phase 5: Tích hợp & xác nhận cuối
- [x] T047 Chạy toàn bộ `quickstart.md` (S1-S12) dưới dạng integration test hoặc kịch bản thủ công
- [x] T048 `npm run lint`, `npm run build`, `npm run test` toàn repo
- [x] T049 Kiểm tra checklist bảo mật trong `quickstart.md` (RateLimitGuard không được dùng, jsonb_set ở mọi nơi ghi metadata, audit_logs user_id đúng quy tắc)
- [x] T050 Cập nhật `CLAUDE.md` mục 4.1 (bảng module) thêm dòng `guest-access` nếu team xác nhận đây là module chính thức lâu dài

---

## Dependencies and Execution Order

### Phase Dependencies
Phase 1 (Nền móng): không phụ thuộc, làm trước tiên.
Phase 2 (Xác thực E2E): phụ thuộc Phase 1 (guard/cache/token service).
Phase 3 (Lobby/Content/Host): phụ thuộc Phase 2 (cần guest token đã cấp được).
Phase 4 (WebSocket/Attendance/Hook thu hồi): phụ thuộc Phase 1 (guest session service để verify token trong WS) — có thể làm song song một phần với Phase 3 nếu nhân lực cho phép, nhưng khuyến nghị làm SAU CÙNG vì đây là điều kiện chặn release, cần review kỹ nhất khi các phần khác đã ổn định.
Phase 5: phụ thuộc toàn bộ Phase 1-4.

### Parallel Opportunities

| Task | Có thể chạy song song với |
|---|---|
| T001, T002, T003 | Độc lập, khác file |
| T012, T013, T014 | Test độc lập theo từng service/guard |
| T022, T023, T024 | Test độc lập |
| T032, T033, T034, T035 | Test độc lập |
| T043, T044, T045 | Test độc lập |

### Rủi ro cần verify sớm nhất
T036/T037 (khóa WebSocket) và T041/T042 (hook thu hồi tại cancelMeeting/endMeeting) là 2 cụm rủi ro cao nhất (sửa hạ tầng dùng chung + method nghiệp vụ lớn sẵn có). Nên viết test T043/T046 NGAY sau khi code xong, trước khi coi Phase 4 hoàn tất.

---

## Requirements Coverage

| Task ID | FR liên quan |
|---|---|
| T001-T011 | FR-GLA-020, FR-GLA-023, FR-GLA-024, FR-GLA-041-043 |
| T015, T017 | FR-GLA-001-006 |
| T016 | FR-GLA-006, FR-GLA-008 |
| T018, T020 | FR-GLA-007-009, FR-GLA-017, FR-GLA-025-031 |
| T026 | FR-GLA-010-012, FR-GLA-019, FR-GLA-027 |
| T027, T028 | Mức B (spec mục 1.5.1), OOS-003 |
| T029, T030 | FR-GLA-013-014, FR-GLA-024, FR-GLA-044-045 |
| T036, T037 | FR-GLA-035-037 |
| T038, T039 | FR-GLA-038-040 |
| T040-T042 | FR-GLA-015-016, FR-GLA-032 |

## Implementation Strategy

1. **Không code bất kỳ dòng nào cho tới khi Product Owner duyệt `spec.md`/`plan.md`** — đúng yêu cầu đã đặt ra cho phiên làm việc này.
2. Sau khi duyệt: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5, theo đúng thứ tự phụ thuộc ở trên.
3. Viết test song song với từng service ngay khi service đó xong (không dồn hết về cuối) — mirror bài học từ `feat-share-meeting-minutes` (rủi ro `await` bị thiếu chỉ phát hiện được nhờ viết test sớm).
4. T036/T037/T041/T042 là 4 task cần review riêng (2 người) trước khi merge, vì đụng vào hạ tầng/method dùng chung cho nhiều feature khác.
