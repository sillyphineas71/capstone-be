# Feature Specification: Khách ngoài công ty tham gia Live Meeting (Guest Magic Link + OTP)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-07 | Khởi tạo spec, phát sinh từ yêu cầu trực tiếp của Product Owner (Thiếu Chủ) qua trao đổi hội thoại — không có UC gốc trong Feature Table. | Toàn bộ file |
| 2026-08-07 | **[Sửa khi implement]** Thu hẹp phạm vi FR-GLA-035 khi code thật: KHÔNG disconnect mọi kết nối WebSocket thiếu token ở handshake (sẽ phá vỡ 2 luồng khác đang dùng chung `EventsGateway` — `ivss:subscribe` có OWED-BLOCKER riêng ghi rõ auth là ticket khác, và `agenda:present`). Thay vào đó chặn cứng đúng tại `meeting:subscribe` — nơi lỗ hổng thật sự nằm. Xem `events.gateway.ts` doc-comment class để biết lý do đầy đủ. | Mục 3.7 (FR-GLA-035) |

> Nguồn gốc: **Không có UC gốc trong Feature Table.** Product Owner nêu trực tiếp: host mời được cả nhân viên và khách ngoài công ty vào cuộc họp, nhưng khách ngoài (không có tài khoản hệ thống) hiện không có cách nào truy cập live-meeting. Tạm đặt tên **GLA-001 (mới)**, chờ Product Owner gán số chính thức trong Feature Table — theo đúng tiền lệ đã áp dụng ở `feat-share-meeting-minutes`.
>
> Tài liệu phân tích nghiệp vụ gốc (đã được Product Owner chốt từng quyết định qua hội thoại): `KE_HOACH_MAGIC_LINK_KHACH_NGOAI_2026-08-07.md` (thư mục gốc repo). Spec này diễn giải lại các quyết định đó thành EARS requirements để triển khai.

- **Feature ID**: GLA-001
- **Feature Name**: Guest External Live Meeting Access (Magic Link + OTP)
- **Module / Domain**: `guest-access` (module mới) + điểm chạm ở `meetings`, `live-meeting`, `websocket`, `attendance`
- **Created Date**: 2026-08-07
- **Status**: Draft — chờ duyệt trước khi implement
- **Source Documents**:
  - `KE_HOACH_MAGIC_LINK_KHACH_NGOAI_2026-08-07.md` (phân tích nghiệp vụ + 7 quyết định đã chốt)
  - `CLAUDE.md` (quy tắc backend, đặc biệt mục 5.4 — không lưu token thô; mục seed permission qua migration)
  - `db_schema.sql` (schema thật, đã đối chiếu `meeting_external_participants`, `attendance_events`, `audit_logs`)

---

## 1. Context & Goal

### 1.1 Bối cảnh

Khi host đặt lịch họp, họ mời được cả nhân viên nội bộ (`meeting_participants`, có tài khoản `users`) lẫn khách ngoài công ty (`meeting_external_participants`, **không** có tài khoản hệ thống). Sau khi booking được duyệt (`MeetingRequestReviewService.approve()`), hệ thống gửi mail thông báo cho cả hai nhóm.

Nhân viên đăng nhập bằng tài khoản hệ thống rồi vào live-meeting bình thường. Khách ngoài công ty nhận được mail rồi **không có đường nào vào** — không có tài khoản, không có route, không có cơ chế xác thực nào dành cho họ.

Đã xác nhận bằng cách đọc code thật (không chỉ đọc spec): "live-meeting" của dự án **không phải cuộc gọi video** (không WebRTC/SFU/Agora/LiveKit) mà là **màn hình điều hành phiên họp** — hiển thị agenda, danh sách người tham dự, ghi chú, timeline, trạng thái ghi âm. Vì vậy bài toán thực chất là **cấp quyền đọc có phạm vi (scoped read access)** cho một danh tính không có tài khoản, không phải "cho vào phòng gọi".

Route FE `/public/in-meeting/:id` (`FE_SmarTracking/src/routers/index.js:85`) đã tồn tại nhưng là vỏ rỗng — vẫn gọi API cần Bearer token nên sẽ 401. Không có backend nào phía sau.

### 1.2 Mục tiêu

Cho phép khách ngoài công ty được host mời (có trong `meeting_external_participants`, có email) **tự xác thực danh tính bằng OTP gửi tới đúng email đã mời**, sau đó truy cập **bản rút gọn** của màn hình live-meeting cho **đúng cuộc họp mà họ được mời** — mà **không** tạo tài khoản, **không** vi phạm hệ thống RBAC hiện có, và **không** thêm bảng database mới.

### 1.3 Giá trị mang lại

- **Cho khách hàng/đối tác**: tham gia được cuộc họp mà không cần tài khoản, không cần liên hệ IT.
- **Cho host**: kiểm soát được ai đang xem (phòng chờ duyệt), thu hồi được quyền truy cập bất cứ lúc nào.
- **Cho bảo mật hệ thống**: khách không bao giờ trở thành một dòng `users`, không đi qua RBAC, không có đường leo thang sang API nội bộ (2 secret ký JWT tách biệt).
- **Cho vận hành**: không cần schema mới, không cần review migration bảng — chỉ seed permission cho host qua migration (đúng quy trình đã có).

### 1.4 Giả định

- Khách ngoài công ty đã có `email` khác NULL trong `meeting_external_participants` tại thời điểm booking được duyệt (khách không có email thì không sinh được lời mời — xem FR-GLA-004).
- Hệ thống email (Brevo/SMTP qua `MailService`) hoạt động ổn định, gửi được trong vài giây.
- Redis khả dụng cho toàn bộ trạng thái tạm thời (OTP, rate-limit, phiên, phòng chờ) — nếu Redis mất dữ liệu, khách phải xác thực lại từ đầu (link mời trong `metadata_json` không mất).
- WebSocket auth (mục 3.7) là **điều kiện chặn release** của toàn bộ feature — không release nếu chưa xong, vì nó vô hiệu hóa mọi lớp bảo mật khác (xem `research.md` mục 3).

### 1.5 Nhật ký Quyết định đã chốt (Q&A trực tiếp với Product Owner)

Toàn bộ 7 điểm dưới đây đã được Product Owner xác nhận qua hội thoại (không phải suy đoán của agent):

1. **Phạm vi dữ liệu khách xem (Mức B)**: thông tin họp + agenda + danh sách người dự (chỉ họ tên + tổ chức, KHÔNG email/phòng ban nhân viên) + trạng thái phiên + ghi chú host **chủ động** đánh dấu chia sẻ. KHÔNG transcript, KHÔNG recording, KHÔNG biên bản chưa published, KHÔNG bảng điểm danh nhân sự.
2. **Phòng chờ (lobby)**: CÓ, mặc định BẬT (`system_configs`), host tắt được cho từng cuộc họp.
3. **Lưu trữ**: **KHÔNG thêm bảng mới**. Toàn bộ trạng thái bền nằm trong `meeting_external_participants.metadata_json` (khóa con `guestInvite`); trạng thái tạm thời (OTP, đếm, phiên, phòng chờ) nằm trong Redis.
4. **Xác thực**: **OTP 2 bước** (link chỉ là địa chỉ, OTP mới là chìa khóa), mặc định. Có "ghi nhớ thiết bị" để giảm phiền cho họp định kỳ.
5. **WebSocket auth**: TRONG SCOPE, điều kiện chặn release. Nếu không kịp → bỏ realtime ở trang khách, dùng polling HTTP (đã qua guard).
6. **Điểm danh khách**: ghi `attendance_events` với `event_type = 'guest_join'/'guest_leave'`, `user_id = NULL`, `source_type = 'guest_portal'`. KHÔNG vào `attendance_records` (cột `user_id` NOT NULL), KHÔNG tính vào báo cáo chuyên cần nhân sự.
7. **Thời gian hiệu lực**: vào được từ `T-30'` đến `T_end+15'`; phiên `min(cấp_lúc + 4h, meeting.end_time + 15')`; OTP 10 phút. **Thời hạn bám theo trạng thái cuộc họp** — meeting `cancelled`/`completed` thì thu hồi mọi phiên khách ngay, không chờ hết hạn.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| **Khách ngoài công ty (Guest)** | Chủ thể chính, không có tài khoản hệ thống | Bấm link mời, yêu cầu OTP, nhập OTP, xin vào phòng chờ, xem nội dung cuộc họp rút gọn |
| **Host** | Chủ trì cuộc họp (`meetings.host_id` hoặc `participant_role = 'host'`) | Quản lý lời mời khách (gửi lại/thu hồi), duyệt/từ chối khách ở phòng chờ, bật/tắt phòng chờ cho cuộc họp của mình |
| **Business Admin / System Admin** | Quản trị hệ thống | Bypass ownership check cho các thao tác quản lý lời mời (giống pattern `issueMinutes`/`shareMinutes`) |
| **Hệ thống Email** | Actor phụ trợ | Gửi mail chứa link mời và mail chứa mã OTP |
| **Nhân viên tham dự khác** | Actor bị ảnh hưởng gián tiếp | Nhìn thấy banner "Có khách ngoài công ty đang xem" khi có khách trong phiên |

### 2.2 Role & Permission Rules

- Guest **không sở hữu bất kỳ permission RBAC nào** — endpoint của khách nằm ngoài hoàn toàn hệ thống `permissions`/`role_permissions`. Phân quyền của khách là **capability tĩnh trong JWT** (khóa cứng vào 1 `meetingId`), không tra DB theo role.
- 3 permission mới cho **host/admin** (module_code=`guest-access`, seed qua migration, theo đúng convention granularity đã dùng ở `meeting.minutes.share.*`):
  - `meeting.guest.invite.manage` — gửi lại link / thu hồi lời mời khách
  - `meeting.guest.session.read` — xem danh sách khách đang online
  - `meeting.guest.admit` — duyệt/từ chối khách ở phòng chờ
- Role mặc định được cấp cả 3: `INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN` (sở hữu permission là điều kiện cần nhưng chưa đủ — service còn kiểm tra ownership, mirror `feat-share-meeting-minutes`).

### 2.3 Actor Constraints

- `INTERNAL_USER`/`MANAGER` chỉ quản lý được lời mời khách của cuộc họp mà họ thỏa `userId === meeting.hostId` (hoặc `participant_role = 'host'`). `BUSINESS_ADMIN`/`SYSTEM_ADMIN` bypass ownership.
- Guest chỉ thao tác được qua nhóm route công khai `/api/v1/guest/...` — không bao giờ nhận được token có thể gọi bất kỳ route nội bộ nào (xem FR-GLA-020, NFR-GLA-002).
- Guest chỉ truy cập được đúng `meetingId` đã khóa cứng trong token phiên — không đi ngang sang cuộc họp khác dù đổi path param (FR-GLA-021).

---

## 3. Functional Requirements

### 3.1 Core Requirements (Ubiquitous) — Vòng đời lời mời

- **FR-GLA-001**: THE system SHALL lưu toàn bộ trạng thái bền của lời mời khách trong `meeting_external_participants.metadata_json` dưới khóa con `guestInvite` — KHÔNG tạo bảng vật lý mới cho mục đích này (quyết định đã chốt mục 1.5.3).
- **FR-GLA-002**: THE system SHALL sinh một mã bí mật ngẫu nhiên có độ an toàn mã hóa cao (tối thiểu 32 byte, dùng CSPRNG) cho mỗi lời mời, và CHỈ lưu bản băm SHA-256 của mã này (`tokenHash`) vào `metadata_json` — KHÔNG lưu mã gốc dưới bất kỳ hình thức nào (đúng CLAUDE.md mục 5.4 "không lưu token raw nếu có thể hash").
- **FR-GLA-003**: THE system SHALL cấu trúc link mời dạng `<external_participant_id>.<mã-bí-mật>` để tra cứu bằng khóa chính (`SELECT ... WHERE id = :id`) rồi mới đối chiếu hash — KHÔNG được thiết kế cách tra cứu nào đòi hỏi quét toàn bảng theo `tokenHash` (vì không có bảng/index riêng cho token).
- **FR-GLA-004**: THE system SHALL NOT sinh lời mời cho khách có `email IS NULL` trong `meeting_external_participants` — trả lỗi nghiệp vụ rõ ràng cho host thay vì âm thầm bỏ qua.
- **FR-GLA-005**: THE system SHALL đảm bảo mỗi khách chỉ có **đúng 1 lời mời hiệu lực tại một thời điểm** — sinh lời mời mới (kể cả do "Gửi lại") ghi đè `guestInvite` cũ, khiến mã cũ mất hiệu lực ngay lập tức.

### 3.2 Event-driven Requirements

- **FR-GLA-006**: WHEN booking được duyệt (`MeetingRequestReviewService.approve()`, chỉ nhánh CREATE_MEETING) VÀ meeting có khách ngoài công ty có email, THE system SHALL sinh `guestInvite` cho từng khách (FR-GLA-001..003) VÀ gửi email chứa link mời cho từng khách, độc lập với email thông báo mời chung hiện có.
- **FR-GLA-007**: WHEN khách bấm link mời (`GET /api/v1/guest/invites/:token`), THE system SHALL tách token thành `(externalParticipantId, secret)`, tra cứu theo khóa chính, đối chiếu `SHA-256(secret)` với `tokenHash` bằng so sánh hằng-thời-gian (`crypto.timingSafeEqual`), và nếu hợp lệ trả về: tên cuộc họp, thời gian, tên host, và email đã che (`ng***@abc.com`) — KHÔNG có trường nào cho phép khách tự nhập email để đối chiếu.
- **FR-GLA-008**: WHEN khách bấm "Gửi mã xác nhận" (`POST /api/v1/guest/invites/:token/otp`), THE system SHALL sinh OTP 6 chữ số bằng CSPRNG, lưu bản băm vào Redis với TTL 10 phút (`guest:otp:<inviteId>`), và gửi email chứa OTP tới **đúng email đã lưu trong DB** (không phải email do client cung cấp).
- **FR-GLA-009**: WHEN khách nhập đúng OTP còn hiệu lực (`POST /api/v1/guest/invites/:token/verify`), THE system SHALL xóa OTP khỏi Redis, cập nhật `guestInvite.status = 'used'` + `firstJoinedAt`/`lastJoinedAt` (qua `jsonb_set`), và cấp token phiên khách (JWT, secret riêng — xem FR-GLA-020).
- **FR-GLA-010**: WHEN phòng chờ đang BẬT cho cuộc họp VÀ khách vừa có phiên hợp lệ, THE system SHALL thêm khách vào hàng chờ Redis (`guest:lobby:<meetingId>`) và chờ host duyệt trước khi cấp quyền đọc nội dung cuộc họp.
- **FR-GLA-011**: WHEN host duyệt một khách trong phòng chờ (`POST /api/v1/live-meetings/:meetingId/guests/:externalParticipantId/admit`), THE system SHALL đánh dấu khách đó "đã vào" và cho phép các API nội dung (mục 3.3) trả dữ liệu cho phiên đó.
- **FR-GLA-012**: WHEN host từ chối một khách trong phòng chờ, THE system SHALL thu hồi phiên khách đó ngay lập tức (thêm vào `guest:revoked:<jti>`).
- **FR-GLA-013**: WHEN host gửi lại link mời (`POST .../guests/:externalParticipantId/resend-invite`), THE system SHALL sinh `guestInvite` mới (ghi đè cũ theo FR-GLA-005), vô hiệu hóa mọi phiên khách đang hoạt động của lời mời cũ, và gửi lại email link mời.
- **FR-GLA-014**: WHEN host thu hồi quyền truy cập của một khách (`DELETE .../guests/:externalParticipantId/access`), THE system SHALL đặt `guest:invite:<inviteId>:invalid_after = now()` (mirror pattern `auth:user:<id>:invalid_after`), khiến mọi phiên hiện có và tương lai của lời mời đó bị từ chối ngay.
- **FR-GLA-015**: WHEN cuộc họp chuyển sang `cancelled` (`MeetingsService.cancelMeeting()`) HOẶC `completed` (`LiveMeetingService.endMeeting()`), THE system SHALL thu hồi NGAY LẬP TỨC mọi phiên khách đang hoạt động của cuộc họp đó (đặt `invalid_after` cho từng lời mời có `guestInvite.status` khác rỗng) — không chờ TTL tự nhiên hết hạn.
- **FR-GLA-016**: WHEN cuộc họp được gia hạn thành công (UC-IMM-02, `requestExtension`/`decideExtension` áp dụng), THE system SHALL cho phép phiên khách hiện có tiếp tục hợp lệ theo `end_time` mới (không cần cấp lại token) — vì hạn hiệu lực được tính động là `min(issuedAt+4h, meeting.endTime+15')`, không lưu cứng vào JWT.

### 3.3 State-driven Requirements

- **FR-GLA-017**: WHILE thời điểm hiện tại nằm ngoài cửa sổ `[meeting.startTime - 30 phút, meeting.endTime + 15 phút]`, THE system SHALL từ chối mọi yêu cầu gửi OTP hoặc xác minh OTP mới (không chặn xem thông tin lời mời ở FR-GLA-007), trả `GUEST_JOIN_WINDOW_CLOSED`.
- **FR-GLA-018**: WHILE một lời mời đã bị khóa tạm thời do nhập sai OTP quá số lần cho phép, THE system SHALL từ chối mọi yêu cầu xác minh OTP mới cho lời mời đó cho tới khi hết thời gian khóa.
- **FR-GLA-019**: WHILE phòng chờ đang TẮT cho một cuộc họp (`system_configs` + override theo meeting), THE system SHALL cấp quyền đọc nội dung ngay sau khi xác minh OTP thành công, bỏ qua bước chờ host duyệt.

### 3.4 Authorization Requirements

- **FR-GLA-020**: THE system SHALL ký token phiên khách bằng secret RIÊNG (`GUEST_TOKEN_SECRET`), khác hoàn toàn `AUTH_ACCESS_TOKEN_SECRET`/`AUTH_REFRESH_TOKEN_SECRET` của nhân viên — một token khách đưa vào bất kỳ endpoint nào dùng `JwtAuthGuard` PHẢI bị từ chối ngay ở bước verify chữ ký.
- **FR-GLA-021**: THE system SHALL tạo `GuestSessionGuard` xác thực token phiên khách và gán `request.guest = { externalParticipantId, meetingId, jti }` — **KHÔNG BAO GIỜ** gán `request.user`, để mọi controller nội bộ hiện có (đọc `request['user'].userId`) tự động trả 401 nếu bị gọi nhầm bởi guest token (fail-closed theo thiết kế).
- **FR-GLA-022**: THE system SHALL tạo `GuestMeetingScopeGuard` so khớp `params.meetingId` với `token.meetingId` — lệch thì trả `403 GUEST_MEETING_SCOPE_MISMATCH`, kể cả khi token còn hợp lệ về mặt chữ ký/thời hạn.
- **FR-GLA-023**: THE system SHALL NOT cấp bất kỳ permission code nào (bảng `permissions`) cho khách — toàn bộ endpoint khách nằm ở nhóm route riêng `/api/v1/guest/...`, không dùng `PermissionsGuard`.
- **FR-GLA-024**: THE system SHALL yêu cầu 3 permission mới (`meeting.guest.invite.manage`, `meeting.guest.session.read`, `meeting.guest.admit`) cho MỌI endpoint quản lý lời mời/phòng chờ phía host, kết hợp ownership-or-admin check (host của đúng meeting đó, hoặc Business/System Admin).

### 3.5 Optional Feature Requirements

- **FR-GLA-025**: WHERE `system_configs: guest_access.verification_mode = 'magic_click'` được cấu hình, THE system MAY bỏ qua bước OTP và cấp phiên trực tiếp khi khách bấm link — mặc định vẫn là `'otp'` (quyết định mục 1.5.4); cấu hình này KHÔNG bắt buộc phải implement trong v1, chỉ cần đọc được config key mà không throw lỗi nếu bị đặt khác `'otp'` (documented, deferred — xem mục 8).
- **FR-GLA-026**: WHERE thiết bị đã xác minh OTP thành công trước đó trong vòng 30 ngày (`guest:device:<inviteId>:<deviceId>` còn tồn tại trong Redis), THE system MAY cho phép bỏ qua bước nhập OTP ở lần truy cập tiếp theo của CÙNG lời mời — vẫn phải qua bước bấm link.
- **FR-GLA-027**: WHERE `system_configs: guest_access.lobby_enabled = false` cho một cuộc họp cụ thể (override cấp meeting do host đặt), THE system SHALL tôn trọng override đó thay vì giá trị mặc định toàn hệ thống (FR-GLA-019).

### 3.6 Unwanted Behavior Requirements

- **FR-GLA-028**: IF token trong link không đúng định dạng, `externalParticipantId` không tồn tại, HOẶC hash không khớp, THEN THE system SHALL trả **CÙNG MỘT** mã lỗi `400 GUEST_INVITE_INVALID` cho cả 3 trường hợp — tuyệt đối không phân biệt response để tránh biến endpoint công khai thành công cụ dò `externalParticipantId` hợp lệ.
- **FR-GLA-029**: IF lời mời đã hết hạn (`expiresAt < now`) HOẶC đã bị host thu hồi (`invalid_after` đã set VÀ `now > invalid_after`), THEN THE system SHALL trả `410 GUEST_INVITE_EXPIRED` hoặc `410 GUEST_INVITE_REVOKED` tương ứng — 2 trường hợp NÀY được phép phân biệt (khác lỗi xác thực, không rò thông tin nhạy cảm).
- **FR-GLA-030**: IF khách nhập sai OTP, THEN THE system SHALL tăng bộ đếm `guest:otp_attempt:<inviteId>` bằng `INCR` (atomic), và IF bộ đếm đạt 5 lần THEN khóa lời mời đó 15 phút (`guest:otp_blocked:<inviteId>`) VÀ xóa OTP hiện tại khỏi Redis.
- **FR-GLA-031**: IF khách yêu cầu gửi OTP quá giới hạn (mặc định 3 lần / 5 phút cho 1 lời mời — mirror `AUTH_OTP_REQUEST_RATE_LIMIT_*`), THEN THE system SHALL trả `429 GUEST_OTP_TOO_MANY_REQUESTS`, KHÔNG gửi thêm email.
- **FR-GLA-032**: IF cuộc họp đã `cancelled`, THEN THE system SHALL từ chối mọi yêu cầu OTP/verify/truy cập nội dung mới cho lời mời của cuộc họp đó, trả `409 GUEST_MEETING_CANCELLED`, bất kể `guestInvite.status` là gì.
- **FR-GLA-033**: IF token phiên khách bị thiếu, sai chữ ký, hết hạn, HOẶC nằm trong `guest:revoked:<jti>`, THEN THE system SHALL trả `401 GUEST_SESSION_INVALID` — KHÔNG phân biệt lý do cụ thể trong response.
- **FR-GLA-034**: IF một nhân viên vô tình gửi token nhân viên tới nhóm route `/api/v1/guest/...`, THEN THE system SHALL từ chối như một guest token không hợp lệ (verify chữ ký thất bại vì khác secret) — không có nhánh xử lý đặc biệt nào coi token nhân viên là hợp lệ ở route khách.

### 3.7 Workflow Requirements — WebSocket & Attendance

- **FR-GLA-035**: THE system SHALL xác thực mọi kết nối WebSocket ở bước handshake (`socket.handshake.auth.token`), phân loại token nhân viên (verify bằng `AUTH_ACCESS_TOKEN_SECRET`) hoặc token khách (verify bằng `GUEST_TOKEN_SECRET`) — kết nối không có token hợp lệ ở MỘT trong 2 loại bị từ chối (`disconnect`).
- **FR-GLA-036**: WHEN client gửi `meeting:subscribe` với `meetingId`, THE system SHALL kiểm tra: (a) nếu là nhân viên — user phải là participant/host của `meetingId` đó; (b) nếu là khách — `meetingId` phải khớp `mid` trong token khách. Không khớp → từ chối subscribe, không join room.
- **FR-GLA-037**: THE system SHALL NOT phát (emit) bất kỳ payload nào chứa dữ liệu bị hạn chế theo Mức B (mục 1.5.1: ghi chú không chia sẻ, transcript, danh sách nhân viên đầy đủ trường) vào room mà khách đã join.
- **FR-GLA-038**: WHEN khách vào được nội dung cuộc họp lần đầu (sau khi qua OTP + phòng chờ nếu bật), THE system SHALL ghi 1 dòng `attendance_events` với `event_type = 'guest_join'`, `user_id = NULL`, `meeting_id`, `source_type = 'guest_portal'`, `metadata_json = { externalParticipantId, fullName, organizationName }`.
- **FR-GLA-039**: WHEN phiên khách kết thúc (đóng tab, hết hạn, bị thu hồi, hoặc rời trang), THE system SHALL cố gắng ghi 1 dòng `attendance_events` với `event_type = 'guest_leave'` tương ứng (best-effort, không block luồng khác nếu ghi thất bại).
- **FR-GLA-040**: THE system SHALL NOT ghi sự kiện của khách bằng `event_type` trùng với `'check_in'`/`'check_out'` — bắt buộc dùng `'guest_join'`/`'guest_leave'` để không lẫn vào các truy vấn hiện có đang lọc theo 2 giá trị đó (timeline UC-99, fallback điểm danh).

### 3.8 Data & State Requirements

- **FR-GLA-041**: THE system SHALL đọc/ghi `meeting_external_participants.metadata_json` bằng `jsonb_set(COALESCE(metadata_json, '{}'::jsonb), '{guestInvite}', $1::jsonb, true)` trong SQL — KHÔNG được đọc toàn bộ object trong JavaScript rồi ghi đè lại (rủi ro mất dữ liệu do race condition + xóa nhầm các key khác của `metadata_json`).
- **FR-GLA-042**: THE system SHALL lưu bộ đếm nhập sai OTP và bộ đếm yêu cầu gửi OTP TRONG REDIS (dùng `INCR`), KHÔNG lưu trong `metadata_json` — vì thao tác đọc-sửa-ghi trên JSON không atomic, sẽ đếm sai khi bị dò mã hàng loạt đồng thời.
- **FR-GLA-043**: THE system SHALL định nghĩa hình dạng `guestInvite` cố định trong `metadata_json`: `{ tokenHash, issuedAt, issuedBy, expiresAt, status, firstJoinedAt, lastJoinedAt }` — xem `data-model.md` mục 2.

### 3.9 Notification / Audit Requirements

- **FR-GLA-044**: WHEN một lời mời được sinh/gửi lại/thu hồi, HOẶC một khách xác minh OTP thành công/thất bại, HOẶC host duyệt/từ chối khách ở phòng chờ, THE system SHALL ghi 1 bản ghi `audit_logs` tương ứng với `user_id = NULL` (theo FK `ON DELETE SET NULL` của bảng), và đưa toàn bộ danh tính khách (`externalParticipantId`, `fullName`, `email` đã mask nếu cần) vào `metadata_json` của audit log.
- **FR-GLA-045**: WHEN host thực hiện hành động quản lý lời mời (gửi lại/thu hồi/duyệt/từ chối), THE system SHALL ghi `audit_logs` với `user_id = <host.userId>` (đây là hành động của nhân viên, không phải khách), `action_type` phân biệt rõ theo từng loại hành động.

### 3.10 Complex / Combined Requirements

- **FR-GLA-046**: IF `expiresAt > now` AND `invalid_after` chưa set (hoặc `now <= invalid_after`) AND meeting chưa `cancelled` AND thời điểm hiện tại nằm trong cửa sổ `[startTime-30', endTime+15']` AND OTP nhập đúng AND lời mời chưa bị khóa do nhập sai quá nhiều, THEN THE system SHALL cấp token phiên khách hợp lệ, TTL = `min(now+4h, meeting.endTime+15')`, VÀ ghi audit log verify thành công — tất cả trong 1 lần gọi `POST .../verify`.

### 3.11 Traceability

| Requirement ID | EARS Pattern | Nguồn / Quyết định liên quan |
|---|---|---|
| FR-GLA-001..005 | Ubiquitous | Quyết định 3 (không thêm bảng) |
| FR-GLA-006 | Event-driven | Hook điểm: `meeting-request-review.service.ts` (approve, nhánh CREATE_MEETING) |
| FR-GLA-007..009 | Event-driven | Quyết định 4 (OTP 2 bước) |
| FR-GLA-010..014 | Event-driven | Quyết định 2 (phòng chờ) |
| FR-GLA-015..016 | Event-driven | Quyết định 7 (thời hạn bám theo trạng thái cuộc họp) |
| FR-GLA-017..019 | State-driven | Quyết định 7 (cửa sổ thời gian) + quyết định 2 (lobby on/off) |
| FR-GLA-020..024 | Authorization | Ranh giới bảo mật cốt lõi — khách không bao giờ là `users` row |
| FR-GLA-025..027 | Optional | Quyết định 4 (ghi nhớ thiết bị), quyết định 2 (override lobby theo meeting) |
| FR-GLA-028..034 | Unwanted Behavior | Chống enumeration + brute-force + leo thang quyền |
| FR-GLA-035..040 | Workflow | Quyết định 5 (WebSocket) + quyết định 6 (điểm danh) |
| FR-GLA-041..043 | Data & State | Ràng buộc kỹ thuật (h) trong KE_HOACH — `jsonb_set`, Redis cho counter |
| FR-GLA-044..045 | Notification/Audit | Ràng buộc (e) — `audit_logs.user_id` FK NULL-able |
| FR-GLA-046 | Complex/Combined | Luồng verify OTP đầy đủ |

---

## 4. Non-functional Requirements

### 4.1 Performance

- `NFR-GLA-001`: THE system SHALL trả lời `GET /guest/invites/:token` và `POST .../otp` trong dưới 1 giây dưới tải thông thường (không tính thời gian gửi mail thật sự, việc gửi mail SHALL được đưa vào tiến trình bất đồng bộ/queue nếu hạ tầng notification hiện có hỗ trợ).
- `NFR-GLA-002`: THE system SHALL xác thực token phiên khách (`GuestSessionGuard`) trong dưới 50ms (chỉ verify JWT + kiểm tra Redis, không query DB nặng).

### 4.2 Security

- `NFR-GLA-003`: THE system SHALL KHÔNG BAO GIỜ trả mã bí mật gốc hoặc OTP gốc trong bất kỳ response API nào (chỉ trả trạng thái thành công/thất bại).
- `NFR-GLA-004`: THE system SHALL dùng `crypto.timingSafeEqual` khi so sánh hash — không dùng `===`/`==` cho bất kỳ so sánh bí mật nào (token hash, OTP hash).
- `NFR-GLA-005`: THE system SHALL đảm bảo `GUEST_TOKEN_SECRET` là biến môi trường bắt buộc, tối thiểu 16 ký tự (mirror `AUTH_ACCESS_TOKEN_SECRET`), và KHÁC giá trị với `AUTH_ACCESS_TOKEN_SECRET`/`AUTH_REFRESH_TOKEN_SECRET` (validate tại startup nếu khả thi, ít nhất phải tài liệu hóa rõ ràng).
- `NFR-GLA-006`: THE system SHALL KHÔNG cắm cơ chế chống brute-force OTP vào `RateLimitGuard` hiện có (`auth/guards/rate-limit.guard.ts`) — file này hiện là `return true` (stub rỗng), dùng nó sẽ khiến chống brute-force vô hiệu hoàn toàn. Toàn bộ rate-limit của feature này SHALL tự viết bằng `RedisService`.
- `NFR-GLA-007`: THE system SHALL đảm bảo mọi endpoint dưới `/api/v1/guest/...` không dùng `JwtAuthGuard`/`PermissionsGuard` của nhân viên.

### 4.3 Reliability & Consistency

- `NFR-GLA-008`: THE system SHALL thực hiện cập nhật `metadata_json` bằng `jsonb_set` nguyên tử ở tầng SQL (FR-GLA-041), tránh mất dữ liệu khi 2 request ghi đồng thời (ví dụ: 2 lần "Gửi lại link" gần nhau).
- `NFR-GLA-009`: THE system SHALL đảm bảo việc thu hồi phiên khi meeting `cancelled`/`completed` (FR-GLA-015) là hành động **fail-safe theo hướng an toàn hơn** — nếu không xác định được chắc chắn trạng thái meeting, ưu tiên từ chối truy cập khách thay vì cho qua.

### 4.4 Usability

- `NFR-GLA-010`: THE system SHALL trả thông báo lỗi bằng tiếng Việt, theo đúng format response chuẩn của dự án (`{ success, message, error: { code, details } }`).

### 4.5 Observability

- `NFR-GLA-011`: THE system SHALL ghi log (không phải audit_logs, mà application log) cho mọi lần từ chối WebSocket handshake và mọi lần `GUEST_MEETING_SCOPE_MISMATCH`, vì đây là tín hiệu khả nghi (dò quét/leo thang).

---

## 5. Data Model

Xem chi tiết đầy đủ ở `data-model.md`. Tóm tắt:

### 5.1 Entity liên quan

| Entity / Table | Vai trò trong tính năng | Ghi chú |
|---|---|---|
| `meeting_external_participants` | Lưu `guestInvite` trong `metadata_json` | KHÔNG thêm cột, KHÔNG thêm bảng |
| `meetings` | Đọc `status`, `startTime`, `endTime`, `hostId` | Không ghi |
| `attendance_events` | Ghi `guest_join`/`guest_leave` | `user_id = NULL` |
| `audit_logs` | Ghi vết mọi hành động | `user_id = NULL` cho hành vi khách, `user_id = host` cho hành vi host |
| `system_configs` | Đọc feature flag `guest_access.*` | Không ghi (trừ khi Admin đổi cấu hình qua API sẵn có của module `administration`) |
| Redis | OTP, rate-limit, phiên, phòng chờ, ghi nhớ thiết bị | Xem `data-model.md` mục 3 |

### 5.2 Dữ liệu đầu vào (tóm tắt — chi tiết ở `plan.md` mục 5)

- `GET /api/v1/guest/invites/:token` — không body.
- `POST /api/v1/guest/invites/:token/otp` — không body.
- `POST /api/v1/guest/invites/:token/verify` — `{ otp: string }`.
- `POST /api/v1/live-meetings/:meetingId/guests/:externalParticipantId/admit|reject` — không body (host).
- `POST /api/v1/live-meetings/:meetingId/guests/:externalParticipantId/resend-invite` — không body (host).
- `DELETE /api/v1/live-meetings/:meetingId/guests/:externalParticipantId/access` — không body (host).
- `GET /api/v1/live-meetings/:meetingId/guests` — query params phân trang (host).

### 5.3 Dữ liệu đầu ra

Xem `plan.md` mục 5 cho response shape đầy đủ từng endpoint.

### 5.4 State / Status Model

`guestInvite.status`:

| Trạng thái | Điều kiện chuyển | Mô tả |
|---|---|---|
| `active` | Sinh lời mời (FR-GLA-006/013) | Chưa xác minh OTP lần nào, hoặc đã xác minh nhưng chưa hết hạn |
| `used` | Xác minh OTP thành công lần đầu (FR-GLA-009) | Đã có ít nhất 1 lần vào — vẫn cho phép vào lại nhiều lần trong hạn `expiresAt` |
| `revoked` | Host thu hồi (FR-GLA-014) HOẶC meeting cancelled/completed (FR-GLA-015) | Không thể xác minh/vào lại nữa dù còn `expiresAt` |

Trạng thái phòng chờ (Redis, không lưu trong `metadata_json`): `waiting` → `admitted` | `rejected`.

---

## 6. Error Handling

### 6.1 Validation Errors
- `400 GUEST_INVITE_INVALID`: token sai định dạng/không tồn tại/hash không khớp (gộp chung, FR-GLA-028).
- `400 VALIDATION_ERROR`: OTP không đúng định dạng 6 chữ số.

### 6.2 Authentication / Authorization Errors
- `401 GUEST_SESSION_INVALID`: token phiên khách thiếu/sai/hết hạn/đã thu hồi (FR-GLA-033).
- `403 GUEST_MEETING_SCOPE_MISMATCH`: token hợp lệ nhưng sai `meetingId` (FR-GLA-022).
- `403 FORBIDDEN` / `403 NOT_MEETING_HOST`: host-side API bị gọi bởi người không thỏa ownership-or-admin.

### 6.3 Business Rule Errors
- `410 GUEST_INVITE_EXPIRED` / `410 GUEST_INVITE_REVOKED` (FR-GLA-029).
- `409 GUEST_MEETING_CANCELLED` (FR-GLA-032).
- `409 GUEST_JOIN_WINDOW_CLOSED` (FR-GLA-017).
- `400 GUEST_EMAIL_MISSING` (FR-GLA-004, khi host cố sinh lời mời cho khách không có email).

### 6.4 Conflict Errors
- `409 GUEST_OTP_INVALID`: OTP sai/hết hạn (gộp chung, không phân biệt).
- `423 GUEST_OTP_BLOCKED` (hoặc `429`, xem `plan.md` mục 9 để chốt mã HTTP cụ thể): khóa tạm do nhập sai quá nhiều (FR-GLA-030).

### 6.5 Rate Limit Errors
- `429 GUEST_OTP_TOO_MANY_REQUESTS` (FR-GLA-031).

### 6.6 Integration / External Service Errors
- Gửi email thất bại (SMTP lỗi): ghi log mức `error`, trả `500` cho request tương ứng nếu là bước bắt buộc (gửi OTP); KHÔNG rollback trạng thái đã ghi nếu là bước phụ (gửi lại link mời sau khi đã update `metadata_json` thành công).

---

## 7. Acceptance Criteria

### 7.1 Happy Path

- **AC-001**: GIVEN booking có 1 khách ngoài công ty với email hợp lệ, WHEN booking được duyệt, THEN hệ thống sinh `guestInvite` cho khách đó VÀ gửi email chứa link mời.
- **AC-002**: GIVEN khách bấm link mời hợp lệ, WHEN gọi `GET /guest/invites/:token`, THEN trả `200` với tên cuộc họp/thời gian/host/email đã mask, KHÔNG có ô nhập email trong response (không có field nào gợi ý cần nhập email).
- **AC-003**: GIVEN khách đã xem thông tin lời mời, WHEN bấm "Gửi mã xác nhận", THEN nhận được email OTP tại đúng email đã lưu, KHÔNG phải email tự nhập.
- **AC-004**: GIVEN khách nhập đúng OTP trong 10 phút, WHEN gọi verify, THEN nhận được token phiên khách, `guestInvite.status` chuyển `used`, có audit log verify thành công.
- **AC-005**: GIVEN phòng chờ đang BẬT, WHEN khách xác minh OTP thành công, THEN khách vào hàng chờ, CHƯA đọc được nội dung cuộc họp cho tới khi host duyệt.
- **AC-006**: GIVEN host duyệt khách ở phòng chờ, WHEN khách gọi API nội dung cuộc họp, THEN trả `200` với dữ liệu đúng Mức B (mục 1.5.1).
- **AC-007**: GIVEN khách đã vào phòng thành công, THEN có 1 dòng `attendance_events` với `event_type = 'guest_join'`, `user_id = NULL`.

### 7.2 Security & Enumeration Cases

- **AC-008**: GIVEN token với `externalParticipantId` không tồn tại, WHEN gọi `GET /guest/invites/:token`, THEN trả `400 GUEST_INVITE_INVALID`.
- **AC-009**: GIVEN token với `externalParticipantId` tồn tại nhưng mã bí mật sai, WHEN gọi `GET /guest/invites/:token`, THEN trả `400 GUEST_INVITE_INVALID` — **response body/HTTP status giống hệt AC-008**, không có cách nào phân biệt 2 trường hợp từ bên ngoài.
- **AC-010**: GIVEN token phiên khách hợp lệ của cuộc họp A, WHEN gọi API nội dung của cuộc họp B (đổi `meetingId` trên path), THEN trả `403 GUEST_MEETING_SCOPE_MISMATCH`.
- **AC-011**: GIVEN token phiên khách hợp lệ, WHEN dùng token đó gọi bất kỳ endpoint nội bộ nào dùng `JwtAuthGuard` (ví dụ `GET /api/v1/meetings`), THEN trả `401` (verify chữ ký thất bại vì khác secret).
- **AC-012**: GIVEN khách nhập sai OTP 5 lần liên tiếp, WHEN nhập lần thứ 6 (kể cả đúng), THEN bị từ chối vì lời mời đang bị khóa tạm.

### 7.3 Business Rule & State Cases

- **AC-013**: GIVEN thời điểm hiện tại trước `meeting.startTime - 30 phút`, WHEN khách yêu cầu OTP, THEN trả `409 GUEST_JOIN_WINDOW_CLOSED`.
- **AC-014**: GIVEN meeting đã `cancelled` SAU KHI khách đã có phiên hợp lệ, WHEN khách tiếp tục gọi API nội dung, THEN trả `409 GUEST_MEETING_CANCELLED` (phiên bị thu hồi ngay khi meeting cancelled, không chờ TTL).
- **AC-015**: GIVEN meeting được gia hạn thêm 30 phút, WHEN khách gọi API nội dung ở phút thứ 100 (sau `endTime` gốc nhưng trước `endTime` mới), THEN vẫn trả `200` (phiên tự nới theo `endTime` mới).
- **AC-016**: GIVEN host bấm "Gửi lại link" cho một khách đã có lời mời active, WHEN khách dùng link CŨ, THEN trả `400 GUEST_INVITE_INVALID` (link cũ đã bị ghi đè, không còn khớp hash).
- **AC-017**: GIVEN host thu hồi quyền truy cập của khách đang có phiên hoạt động, WHEN khách gọi API nội dung ngay sau đó, THEN trả `401 GUEST_SESSION_INVALID`.

### 7.4 WebSocket Cases

- **AC-018**: GIVEN kết nối WebSocket không có token hợp lệ (nhân viên hoặc khách), WHEN client gửi `meeting:subscribe`, THEN kết nối bị từ chối/disconnect.
- **AC-019**: GIVEN token phiên khách hợp lệ cho `meetingId = A`, WHEN client gửi `meeting:subscribe` với `meetingId = B`, THEN không được join room, không nhận được bất kỳ event nào của room B.

### 7.5 Acceptance Criteria Traceability

| AC ID | FR liên quan |
|---|---|
| AC-001 | FR-GLA-006 |
| AC-002, AC-003 | FR-GLA-007, FR-GLA-008 |
| AC-004 | FR-GLA-009, FR-GLA-046 |
| AC-005, AC-006 | FR-GLA-010, FR-GLA-011, FR-GLA-019 |
| AC-007 | FR-GLA-038, FR-GLA-040 |
| AC-008, AC-009 | FR-GLA-028 |
| AC-010 | FR-GLA-022 |
| AC-011 | FR-GLA-020, FR-GLA-021 |
| AC-012 | FR-GLA-030 |
| AC-013 | FR-GLA-017 |
| AC-014 | FR-GLA-015, FR-GLA-032 |
| AC-015 | FR-GLA-016 |
| AC-016 | FR-GLA-005, FR-GLA-013 |
| AC-017 | FR-GLA-014 |
| AC-018, AC-019 | FR-GLA-035, FR-GLA-036 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- `OOS-001`: THE system SHALL NOT tạo bảng database mới cho lời mời khách (quyết định đã chốt).
- `OOS-002`: THE system SHALL NOT tạo tài khoản `users` hoặc role RBAC cho khách ngoài công ty.
- `OOS-003`: THE system SHALL NOT cho khách xem transcript, recording, biên bản chưa `published`, hoặc bất kỳ trường nào của `attendance_records`/`presence_snapshots`/nhân viên khác ngoài họ tên + tổ chức.
- `OOS-004`: THE system SHALL NOT triển khai đầy đủ chế độ `magic_click` (one-click, không OTP) trong v1 — chỉ chừa chỗ cấu hình (FR-GLA-025), không implement luồng thật.
- `OOS-005`: THE system SHALL NOT hỗ trợ gửi OTP qua SMS/OTT — chỉ email.
- `OOS-006`: THE system SHALL NOT cho khách tự tạo/sửa/xóa ghi chú cuộc họp (chỉ đọc ghi chú host chủ động chia sẻ).
- `OOS-007`: THE system SHALL NOT tính khách vào bất kỳ báo cáo chuyên cần/analytics nhân sự nào.

### 8.2 Có thể xem xét ở feature khác

- Chế độ `magic_click` đầy đủ.
- Cho phép khách participate voice/video thật (ngoài phạm vi — dự án hiện không có hạ tầng WebRTC).
- Multi-language cho email/trang khách (v1 chỉ tiếng Việt, mirror `feat-password-reset-otp`).
- Cho phép Manager (không phải Host) cũng quản lý được lời mời khách của mọi cuộc họp (hiện tại chỉ Host/Admin).

### 8.3 Out-of-scope EARS Guardrails

- **FR-OOS-001**: THE system SHALL NOT lưu mã bí mật gốc hoặc OTP gốc ở bất kỳ đâu ngoài bộ nhớ xử lý tức thời của request.
- **FR-OOS-002**: THE system SHALL NOT cho phép guest token gọi thành công bất kỳ endpoint nào ngoài nhóm `/api/v1/guest/...`.
- **FR-OOS-003**: THE system SHALL NOT dùng `RateLimitGuard` hiện có (`auth/guards/rate-limit.guard.ts`) cho bất kỳ mục đích chống lạm dụng nào của feature này.

## Assumptions
Xem mục 1.4 và 1.5.
