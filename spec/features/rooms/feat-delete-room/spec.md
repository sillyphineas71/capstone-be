# Feature Specification: Xóa phòng họp

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-16 | **[ĐẢO NGƯỢC BR2 CŨ]** Phát hiện bug nghiệp vụ nghiêm trọng: xóa phòng đang âm thầm gỡ địa điểm khỏi cả cuộc họp TƯƠNG LAI ĐÃ DUYỆT (status=SCHEDULED), khiến người tham dự chỉ biết mất phòng khi đến nơi. Chốt lại cùng người dùng: (1) THÊM EX2 — chặn xóa hoàn toàn nếu còn ≥1 cuộc họp tương lai đã duyệt, không có ngoại lệ force-delete; (2) BR2 cũ (null roomId + báo organizer) CHỈ còn áp dụng cho DRAFT/PENDING_APPROVAL (chưa duyệt); (3) THÊM chặn phê duyệt (`MEETING_ROOM_REMOVED`, 409) tại `MeetingRequestReviewService.approve()` khi phòng đã bị xóa và request chưa chọn phòng mới; (4) mở rộng notify sang CẢ direct manager của organizer/host (không chỉ organizer); (5) `deletion-impact` trả thêm `canDelete`/`blockingMeetings[]`/`pendingMeetingCount` thay vì chỉ đếm số. Xem §0.10. | §0.10 (mới), §1.2, §3.1 (FR-002/FR-003), §3.3 (FR-009a mới, FR-010, FR-013), §3.4 (FR-014), §3.8 (FR-022), §5.3, §6.3 (ERR-005a mới), §7 (AC-002 sửa, AC-009/AC-010/AC-011 mới) |
| 2026-07-09 | Đánh giá chéo với `feat-update-room-info`/`feat-search-room-list` phát hiện thiếu WebSocket broadcast cho POST-1 (lưới lịch phòng). Bổ sung §0.9, FR-030, AC-008. | §0.9, §3.3 (FR-030), §7.1 (AC-008), §3.11, §7.3 |
| 2026-07-09 | Tạo spec lần đầu cho UC-ROOM-03. Đã chốt 2 điểm mơ hồ cốt lõi (biểu diễn "Cần đổi phòng", tín hiệu chặn EX1) cùng người dùng trước khi viết — xem §0. Phát hiện rủi ro kỹ thuật quan trọng về soft-delete + JOIN mặc định (§0.7), ghi rõ để không phá BR1. | Toàn bộ file |

---

- **Feature ID**: ROOM-DELETE-ROOM-001
- **Feature Name**: Xóa phòng họp (Delete Meeting Room)
- **Use Case**: UC-ROOM-03
- **Module / Domain**: rooms (orchestrator), phối hợp `meetings`, `notifications`, `administration` (background_jobs), `scheduling` (gợi ý phòng thay thế)
- **Created Date**: 2026-07-09
- **Status**: Draft
- **Source Documents**:
  - Đặc tả UC-ROOM-03 do người dùng cung cấp.
  - `src/modules/meetings/services/meetings.service.ts` (`getAvailableRoomsForMeeting`, `updateMeetingRoom` — UC-MM-03, đã implement, tái dùng từng mảnh).
  - `src/modules/rooms/entities/room.entity.ts`, `room-booking.entity.ts`, `room-event.entity.ts`.
  - `src/modules/meetings/entities/meeting.entity.ts`, `meeting-event.entity.ts`.
  - `src/modules/notifications/entities/notification.entity.ts`.
  - `src/modules/administration/entities/background-job.entity.ts`.
  - `spec/features/scheduler/feat-scheduling-room-suggestions/spec.md` (nguồn gợi ý phòng thay thế).
  - `CLAUDE.md` (root backend).

---

## 0. RECON — Đối chiếu nguồn + quyết định đã chốt cùng người dùng

### 0.1. Endpoint chưa tồn tại — nhưng tái dùng được ~80% logic từ UC-MM-03 (đã có)

`rooms.controller.ts` chưa có `DELETE /:roomId`. Tuy nhiên **UC-MM-03 "Cập nhật phòng họp" (đã implement)** cung cấp gần đủ các mảnh cần thiết, đã verify trực tiếp trong code (không chỉ dựa báo cáo research):

- [`MeetingsService.getAvailableRoomsForMeeting(meetingId, options)`](../../../../src/modules/meetings/services/meetings.service.ts:1433) — nhận 1 `meetingId`, tự lấy `startTime/endTime` của meeting đó, trả về phòng trống đúng khung giờ + cờ cảnh báo sức chứa. **Không tự sort theo độ lệch sức chứa** (khác với 1 giả định sai trong báo cáo research ban đầu — đã tự đọc code sửa lại).
- [`MeetingsService.updateMeetingRoom()`](../../../../src/modules/meetings/services/meetings.service.ts:1539) — pattern transaction đầy đủ: release booking cũ (`RoomBookingStatus.RELEASED`), ghi `MeetingEventEntity` (`MeetingEventType.ROOM_CHANGED` đã có sẵn), ghi `RoomEventEntity` (`eventType` là `varchar` tự do, không ràng buộc enum — thêm giá trị mới không cần migration), ghi `AuditLogEntity`, gửi notification sau khi transaction commit. **Không gọi thẳng được** vì hàm này thiết kế cho 1-meeting-đổi-sang-1-phòng-mới-đã-chọn-sẵn — khác bản chất với xóa phòng (N meeting cùng lúc mất phòng, KHÔNG có phòng mới tự động). Chỉ tái dùng các bước con (release booking, ghi event, ghi audit, gửi notification).
- `MeetingEntity.roomId` đã nullable (xác nhận trực tiếp).
- `spec/features/scheduler/feat-scheduling-room-suggestions/spec.md` — API `GET /scheduling/room-suggestions` đã có filter `capacity >= attendeeCount` + sort theo độ lệch sức chứa tăng dần rồi tên phòng — **khớp chính xác** yêu cầu "Other Information" của UC-ROOM-03 (gợi ý 2-3 phòng cùng sức chứa, trống cùng khung giờ) — tốt hơn `getAvailableRoomsForMeeting` cho mục đích này vì đã có sẵn logic sort/filter đúng ý.

### 0.2. Biểu diễn "Cần đổi phòng" — đã chốt: suy ra từ `roomId = NULL`

Không có `MeetingStatus` nào khớp sẵn (`DRAFT|PENDING_APPROVAL|SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED`). **Quyết định đã duyệt cùng người dùng**: BR2 tự mô tả rõ "chỉ có trường Địa điểm bị xóa rỗng" — nghĩa là `roomId = NULL` (đã nullable sẵn) **chính là** tín hiệu, không thêm cột/enum mới. `status` **giữ nguyên `SCHEDULED`** — không thêm `NEEDS_ROOM_REASSIGNMENT`, tránh rủi ro rà soát lại mọi nơi đang check `status === SCHEDULED` (duyệt, live-meeting start, hủy...). "Cờ cảnh báo bắt buộc cập nhật" là giá trị **suy ra động** khi hiển thị (`status = SCHEDULED AND roomId IS NULL AND startTime > now()`), không lưu trong DB.

### 0.3. EX1 (chặn xóa nếu phòng đang có cuộc họp diễn ra) — đã chốt: cả 2 tín hiệu

**Quyết định đã duyệt**: chặn nếu `meeting.status = IN_PROGRESS` **HOẶC** (`meeting.status = SCHEDULED` **AND** `now() BETWEEN startTime AND endTime`) — an toàn hơn chỉ dựa `IN_PROGRESS` (không lọt trường hợp cuộc họp đang trong giờ nhưng chưa ai bấm "Start" trên live-meeting).

### 0.4. Luồng xác nhận 2 bước (Normal Flow bước 3-5) — cần 2 endpoint riêng

UC gốc mô tả: hệ thống **rà soát trước** → hiển thị hộp thoại kèm số X cuộc họp bị ảnh hưởng → người dùng **xác nhận riêng** ("Đồng ý xóa"). Đây là pattern preview-then-confirm, cần 2 endpoint:
- `GET /api/v1/rooms/:roomId/deletion-impact` — tính trước số cuộc họp tương lai bị ảnh hưởng + cờ có đang bị chặn bởi EX1 hay không, **không thay đổi dữ liệu** (read-only).
- `DELETE /api/v1/rooms/:roomId` — thực thi xóa thật, **tính lại EX1 tại đúng thời điểm xóa** (không tin số liệu preview cũ — tránh race condition giữa lúc xem hộp thoại và lúc bấm xác nhận).

### 0.5. Xử lý bất đồng bộ cho cascade (nhiều meeting + gửi email)

Khác UC-MM-03 (1 meeting), xóa phòng có thể ảnh hưởng **nhiều meeting cùng lúc**. **Quyết định**: tách 2 phần —
- **Đồng bộ, trong 1 transaction** (đảm bảo POST-1/POST-2 đúng ngay khi API trả về thành công, đúng Normal Flow bước 8 "đóng hộp thoại, hiển thị thông báo thành công" không cần chờ): soft-delete `rooms`, release toàn bộ `room_bookings` tương lai liên quan (`RoomBookingStatus.RELEASED`), set `meetings.roomId = NULL` cho các meeting tương lai đó, ghi `MeetingEventEntity`/`RoomEventEntity`/`AuditLogEntity`.
- **Bất đồng bộ, qua `background_jobs`** (POST-3, "Other Information" — có thể chậm vì phải gọi gợi ý phòng cho từng meeting + gửi email): enqueue 1 job mới, worker xử lý sau khi transaction đã commit. Thêm 1 giá trị `BackgroundJobType` mới (cột DB là `varchar`, xác nhận thêm giá trị enum không cần migration — theo đúng tiền lệ `MEETING_TIME_WARNING`/`AI_MEETING_SUMMARY`).

### 0.6. Permission mới: `room.delete`

Không có permission `room.delete` trong seed hiện tại. **Quyết định**: seed mới, `moduleCode: 'rooms'`, `actionCode: 'delete'`, `roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` — nhất quán `room.create`/`room.update`.

### 0.7. RỦI RO KỸ THUẬT QUAN TRỌNG: soft-delete + JOIN mặc định có thể phá BR1

BR1 yêu cầu cuộc họp quá khứ vẫn hiển thị đúng tên phòng. Nhưng soft-delete `rooms` (`deletedAt`) khiến **TypeORM mặc định loại bản ghi soft-deleted khỏi mọi `find()`/JOIN** trừ khi gọi tường minh `withDeleted: true` (hoặc raw SQL không filter `deleted_at IS NULL`). **Bất kỳ read-path nào hiện tại đang JOIN `rooms` theo cách mặc định để hiển thị tên phòng của cuộc họp quá khứ (chi tiết cuộc họp, báo cáo, minutes, và đặc biệt là feature "Lịch sử sử dụng phòng" [UC-RUM-04](../../analytics/feat-view-room-usage-history/spec.md) vừa được đặc tả) sẽ ngầm hiển thị tên phòng bị mất/null sau khi phòng đó bị xóa, vi phạm BR1 một cách âm thầm.** Đây KHÔNG phải rủi ro lý thuyết — cần audit rõ ràng (§8.2, out-of-scope nhưng bắt buộc theo dõi) trước khi coi BR1 là tự động thỏa mãn.

### 0.9. Bổ sung sau đánh giá chéo: thiếu WebSocket broadcast cho POST-1

Đánh giá chéo với `feat-update-room-info` (đã có event `room.updated` qua `WebsocketService.broadcast()` cho yêu cầu tương tự POST-2 của UC-ROOM-02) phát hiện: spec bản đầu của feature này **chưa có yêu cầu broadcast WebSocket** cho POST-1 ("Phòng họp bị gỡ bỏ hoàn toàn khỏi... giao diện lưới lịch phòng của tất cả nhân viên"). Nếu thiếu, FE chỉ biết phòng đã bị xóa ở lần gọi `GET /rooms/search` tiếp theo, không phải ngay lập tức. **Quyết định bổ sung**: phát 1 event mới `room.deleted` (KHÔNG tái dùng `room.updated` để tránh FE hiểu nhầm là phòng chỉ đổi thông tin, không phải đã biến mất), payload tối thiểu `{roomId, deletedAt}`, broadcast toàn cục ngay sau khi transaction FR-010 + audit FR-010f hoàn tất — cùng thời điểm với việc enqueue background job (FR-011), không chờ job đó chạy xong.

### 0.10. REVISION 2026-08-16 — Đảo ngược BR2 cũ: chặn xóa nếu còn cuộc họp đã duyệt

**Vấn đề phát hiện**: thiết kế ban đầu (§0.2) coi `roomId = NULL` là đủ để báo "cần đổi phòng" cho MỌI cuộc họp tương lai, kể cả cuộc họp đã `SCHEDULED` (đã duyệt, người tham dự đã lên lịch). Trên thực tế production, admin xóa phòng khiến các cuộc họp đã duyệt "mất phòng" một cách âm thầm — chỉ có email thông báo (best-effort, có thể vào spam/bị bỏ qua), không có gì NGĂN cuộc họp đó tiếp tục hiển thị như bình thường cho tới sát giờ họp. Đây là lỗi nghiệp vụ nghiêm trọng, không phải bug kỹ thuật.

**Quyết định mới (đã chốt cùng người dùng)**:

1. **EX2 (mới)** — chặn xóa **hoàn toàn** nếu còn ≥1 cuộc họp tương lai `status = SCHEDULED`. Không có flag "force delete" — admin bắt buộc phải tự đổi phòng/hủy các cuộc họp đó trước (qua UC-MM-03 cập nhật phòng họp có sẵn), tương tự cách EX1 chặn cuộc họp đang diễn ra.
2. **BR2 cũ được thu hẹp phạm vi**: chỉ còn áp dụng cho cuộc họp `DRAFT`/`PENDING_APPROVAL` (chưa được duyệt chính thức) — các cuộc họp này vẫn được phép "mất phòng" (null hóa `roomId`, giữ status, release booking) vì chưa ai chính thức dựa vào lịch đó.
3. **Chặn phê duyệt (mới)**: với cuộc họp `PENDING_APPROVAL` bị mất phòng theo (2), nếu Manager cố `POST .../approve` trong khi request KHÔNG mang theo phòng mới (không phải `UPDATE_ROOM` với `targetRoomId` đã chọn), hệ thống trả 409 `MEETING_ROOM_REMOVED` — chặn duyệt tới khi host chọn lại phòng. Đặt guard tại [`MeetingRequestReviewService.approve()`](../../../../src/modules/meetings/services/meeting-request-review.service.ts) (module `meetings`, không phải `rooms` — đây là điểm phối hợp chéo module). CHỈ áp dụng cho `approve()`, KHÔNG áp dụng cho `reject()` (từ chối một yêu cầu không cần phòng còn tồn tại).
4. **Người nhận thông báo mở rộng**: ngoài organizer, còn thông báo `host` (nếu khác organizer) và **direct manager** (`UserEntity.directManagerId`) của cả hai — dùng field có sẵn, không thêm cột "assigned approver" (hệ thống hiện tại duyệt theo permission `meeting_request.approve`, không có approver gán cứng theo từng request — xác nhận qua code, không suy đoán).
5. **`GET /deletion-impact` đổi shape response**: `affectedMeetingCount` (đếm gộp, mơ hồ) → tách thành `canDelete` (boolean, để FE biết có nên hiện nút xóa hay không), `blockingMeetings[]` (danh sách đầy đủ id/title/startTime/endTime của các cuộc họp ĐÃ DUYỆT đang chặn — để FE hiển thị cho admin biết chính xác cuộc họp nào), `pendingMeetingCount` (số DRAFT/PENDING_APPROVAL sẽ bị ảnh hưởng nếu xóa — thông tin phụ, không chặn).

**Không đổi**: BR1 (dữ liệu quá khứ không đụng tới), EX1 (chặn cuộc họp đang diễn ra), soft-delete, atomicity transaction, pattern audit fail-safe.

### 0.8. Field/entity xác nhận tồn tại thật

- `RoomEntity`: `deletedAt` (soft-delete), `isActive` — cả 2 đã có sẵn.
- `RoomBookingEntity.status`: đã có `RELEASED`.
- `MeetingEntity.roomId`: nullable (xác nhận trực tiếp).
- `MeetingEntity.status`: `DRAFT|PENDING_APPROVAL|SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED` — không đổi.
- `MeetingEventType.ROOM_CHANGED`: đã có, tái dùng (hoặc thêm `ROOM_UNASSIGNED` mới — cột cũng `varchar`, an toàn thêm).
- `RoomEventEntity.eventType`: `varchar` tự do, không ràng buộc enum TypeScript — tự do thêm giá trị mới `room_deleted`.
- `NotificationType`: chưa có type khớp nghĩa "phòng bị xóa, cần chọn lại" (`MEETING_ROOM_UPDATED` có sẵn nhưng semantics khác — update đã có phòng mới sẵn). Thêm type mới `MEETING_ROOM_REMOVED`.
- `NotificationChannel`: `EMAIL | IN_APP | WEBSOCKET | SMS` — dùng `EMAIL` (+ có thể `IN_APP`) theo đúng Secondary Actor "Hệ thống Thông báo/Email".
- `BackgroundJobType`: cột `varchar`, thêm giá trị mới an toàn không cần migration.
- **Không có bảng/cột nào cần thêm** — chỉ thêm 1 permission mới, 1-2 giá trị enum-as-string mới (không migration), không đổi schema.

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `rooms`, nhưng có tác động cascade sang `meetings` (giải phóng phòng khỏi các cuộc họp tương lai), `notifications` (thông báo người tổ chức bị ảnh hưởng), và gọi tới `scheduling` (gợi ý phòng thay thế). Đây là thao tác **có side-effect lớn nhất** trong 3 feature `rooms` đã đặc tả (so với Update ở [feat-update-room-info](../feat-update-room-info/spec.md) chỉ đổi 1 bản ghi).

### 1.2 Mục tiêu

Cho phép Business Admin/System Admin gỡ bỏ 1 phòng họp khỏi danh mục không gian khả dụng, đồng thời đảm bảo (sửa 2026-08-16 — xem §0.10): (a) cuộc họp tương lai ĐÃ DUYỆT (`SCHEDULED`) chặn xóa hoàn toàn, admin phải tự đổi phòng/hủy trước; (a') cuộc họp tương lai CHƯA DUYỆT (`DRAFT`/`PENDING_APPROVAL`) KHÔNG bị hủy, chỉ mất địa điểm và được gắn cờ cần cập nhật, đồng thời Manager bị chặn không cho duyệt cho tới khi phòng được chọn lại; (b) người tổ chức, host VÀ direct manager của họ nhận thông báo kèm gợi ý phòng thay thế; (c) lịch sử quá khứ không bị ảnh hưởng; (d) không cho xóa nếu phòng đang có cuộc họp diễn ra ngay lúc đó.

### 1.3 Giá trị mang lại

- Business Admin dọn dẹp danh mục phòng (phòng đóng cửa, ngừng sử dụng) mà không làm gián đoạn lịch làm việc của nhân viên.
- Người tổ chức được chủ động chọn lại phòng thay vì phát hiện muộn khi đến nơi mới biết phòng không còn tồn tại.

### 1.4 Giả định

- "Cần đổi phòng" suy ra động từ `roomId IS NULL`, không lưu cờ riêng (§0.2).
- EX1 chặn dựa cả `status=IN_PROGRESS` lẫn khung giờ thực tế (§0.3).
- Chỉ ảnh hưởng cuộc họp **tương lai** — định nghĩa "tương lai" = `startTime > now()` VÀ `status NOT IN (CANCELLED, COMPLETED)`. Cuộc họp `DRAFT`/`PENDING_APPROVAL` tại phòng đó cũng coi là bị ảnh hưởng nếu `startTime > now()`.
- Cuộc họp định kỳ (recurring): áp dụng theo từng occurrence cụ thể (mỗi occurrence là 1 `MeetingEntity` riêng với `roomId` riêng, đúng theo pattern `updateMeetingRoom` đã chặn sửa phòng ở cấp series — ở đây xóa phòng ảnh hưởng occurrence cụ thể, không đụng `meeting_recurrence_rules`).
- Gửi thông báo bất đồng bộ qua `background_jobs`, không block response của API xóa (§0.5).
- Gợi ý phòng thay thế lấy từ `scheduling/room-suggestions` (đã có sẵn, đúng semantics), giới hạn 2-3 phòng mỗi email (Other Information).

### 1.5 Clarifications Resolved

Tổng hợp tại §0.2, §0.3 (đã chốt qua trao đổi trực tiếp với người dùng). Rủi ro kỹ thuật §0.7 đã ghi nhận, xử lý ở mức "phải audit" thay vì tự ý sửa các feature khác ngoài phạm vi.

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Business Admin | Quản trị viên doanh nghiệp | Xem tác động + xóa bất kỳ phòng họp nào |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin (nhất quán `room.create`/`room.update`) |
| Hệ thống Thông báo/Email | Secondary Actor | Gửi email/notification tới người tổ chức bị ảnh hưởng (xử lý qua `background_jobs` + `NotificationsService`) |

### 2.2 Role & Permission Rules

- Permission bắt buộc: `room.delete` (mới, §0.6), seed cho `SYSTEM_ADMIN`, `BUSINESS_ADMIN`. Dùng chung cho cả 2 endpoint (preview + xóa thật).

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `room.delete`.

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL thực hiện xóa phòng dưới dạng **soft-delete** (`rooms.deleted_at`), KHÔNG hard-delete bản ghi `rooms`.

FR-002: THE system SHALL KHÔNG hủy (`CANCELLED`) bất kỳ `MeetingEntity` `DRAFT`/`PENDING_APPROVAL` nào bị ảnh hưởng — chỉ set `roomId = NULL` (BR2, **thu hẹp phạm vi 2026-08-16 — xem §0.10**: KHÔNG còn áp dụng cho `SCHEDULED`, xem FR-009a).

FR-003: THE system SHALL KHÔNG thay đổi bất kỳ `MeetingEntity`/`RoomBookingEntity` nào đã `COMPLETED` hoặc có `startTime <= now()` (BR1 — chỉ ảnh hưởng tương lai).

### 3.2 Event-driven Requirements — Endpoint xem trước tác động

FR-004: WHEN người dùng gửi `GET /api/v1/rooms/:roomId/deletion-impact`, THE system SHALL kiểm tra authentication và permission `room.delete` trước khi xử lý.

FR-005: WHEN `roomId` không tồn tại/soft-deleted, THE system SHALL trả về 404, error code `ROOM_NOT_FOUND`.

FR-006 (sửa 2026-08-16): WHEN yêu cầu hợp lệ, THE system SHALL trả về `canDelete` (boolean — `true` khi không có `blockingMeetings` và không `blockedByInProgressMeeting`), `blockingMeetings[]` (id/title/startTime/endTime của cuộc họp `SCHEDULED` tương lai — xem FR-009a), `pendingMeetingCount` (số `DRAFT`/`PENDING_APPROVAL` tương lai, không chặn) và `blockedByInProgressMeeting` (boolean, theo §0.3), **không thay đổi bất kỳ dữ liệu nào** (read-only).

### 3.3 Event-driven Requirements — Endpoint xóa thật

FR-007: WHEN người dùng gửi `DELETE /api/v1/rooms/:roomId`, THE system SHALL kiểm tra authentication và permission `room.delete` trước khi xử lý.

FR-008: WHEN `roomId` không tồn tại/soft-deleted, THE system SHALL trả về 404, error code `ROOM_NOT_FOUND`.

FR-009: WHEN phòng đang có cuộc họp thỏa điều kiện EX1 (§0.3), THE system SHALL từ chối với 409, error code `ROOM_IN_USE`, message: "Phòng họp đang được sử dụng ở thời điểm hiện tại. Vui lòng chờ cuộc họp kết thúc trước khi thực hiện thao tác xóa." — **tính lại tại đúng thời điểm xóa**, không tin kết quả preview cũ (§0.4).

FR-009a (mới 2026-08-16, EX2 — xem §0.10): WHEN phòng có ≥1 cuộc họp tương lai `status = SCHEDULED` (`startTime > now()`), THE system SHALL từ chối với 409, error code `ROOM_HAS_SCHEDULED_MEETINGS`, message nêu rõ số lượng cuộc họp, `error.details.meetings[]` chứa id/title/startTime/endTime của TỪNG cuộc họp chặn — **tính lại tại đúng thời điểm xóa**, không tin kết quả preview cũ, cùng nguyên tắc §0.4 với EX1. KHÔNG có ngoại lệ "force delete".

FR-010 (sửa 2026-08-16): WHEN mọi kiểm tra hợp lệ (bao gồm FR-009a không chặn), THE system SHALL trong 1 transaction: (a) soft-delete `rooms`; (b) với mỗi `room_bookings` tương lai liên quan **của cuộc họp `DRAFT`/`PENDING_APPROVAL`** có status hợp lệ (`pending|approved|active`), chuyển sang `RELEASED`; (c) với mỗi `meetings` tương lai **`DRAFT`/`PENDING_APPROVAL`** liên quan, set `roomId = NULL`; (d) ghi `MeetingEventEntity` (loại `ROOM_CHANGED` hoặc `ROOM_UNASSIGNED`) cho từng meeting bị ảnh hưởng; (e) ghi `RoomEventEntity` (`eventType='room_deleted'`) 1 lần cho phòng; (f) ghi `AuditLogEntity`. Cuộc họp `SCHEDULED` KHÔNG BAO GIỜ xuất hiện ở bước này vì FR-009a đã chặn từ trước.

FR-011: WHEN transaction FR-010 commit thành công, THE system SHALL enqueue 1 `background_jobs` mới (loại mới, §0.5) chứa danh sách `meetingId` bị ảnh hưởng (chỉ `DRAFT`/`PENDING_APPROVAL`), để xử lý gợi ý phòng thay thế + gửi notification bất đồng bộ.

FR-012: WHEN transaction FR-010 commit thành công, THE system SHALL trả về response 200 chứa `affectedMeetingCount` (số `DRAFT`/`PENDING_APPROVAL` bị ảnh hưởng) và message: "Xóa phòng họp thành công".

FR-013 (sửa 2026-08-16): WHEN background job (FR-011) chạy, THE system SHALL với mỗi meeting bị ảnh hưởng: gọi `scheduling/room-suggestions` (capacity + khung giờ của đúng meeting đó) để lấy tối đa 2-3 phòng thay thế, rồi enqueue notification (`NotificationType.MEETING_ROOM_REMOVED`, channel `EMAIL`) tới TẬP HỢP đã dedupe gồm `organizerId`, `hostId` (nếu khác organizer) VÀ `directManagerId` (`UserEntity.directManagerId`) của cả hai người đó (nếu có + có email) — mở rộng từ "chỉ organizer" để manager biết và không cố duyệt yêu cầu đã mất phòng (xem FR-013a). Nếu meeting đang `PENDING_APPROVAL`, nội dung email PHẢI nêu rõ yêu cầu duyệt sẽ bị chặn cho tới khi chọn lại phòng.

FR-013a (mới 2026-08-16, cross-module — module `meetings`): WHEN Manager gọi `POST /meeting-requests/:requestId/approve` cho 1 request mà `meeting.roomId IS NULL` VÀ `request.targetRoomId IS NULL` (phòng đã bị xóa theo FR-010c, host chưa chọn phòng mới), THE system SHALL từ chối với 409, error code `MEETING_ROOM_REMOVED`, TRƯỚC khi kiểm tra booking. KHÔNG áp dụng cho `reject()`. Request `UPDATE_ROOM` đã tự chọn `targetRoomId` mới thì KHÔNG bị chặn (host đã tự khắc phục).

FR-030: WHEN transaction FR-010 và audit FR-010f hoàn tất thành công, THE system SHALL phát WebSocket event `room.deleted` (broadcast toàn cục, không chờ background job FR-011) chứa `{roomId, deletedAt}`, đáp ứng POST-1 (§0.9).

### 3.4 State-driven Requirements

FR-014 (sửa 2026-08-16): WHILE phòng không có bất kỳ cuộc họp `DRAFT`/`PENDING_APPROVAL`/`SCHEDULED` tương lai nào, THE system SHALL cho phép xóa bình thường, `affectedMeetingCount = 0`, KHÔNG enqueue background job thông báo (không có gì để gửi).

### 3.5 Optional Feature Requirements

FR-015: WHERE gợi ý phòng thay thế (FR-013) không tìm được phòng nào phù hợp (0 kết quả), THE system SHALL vẫn gửi notification cho người tổ chức nhưng KHÔNG kèm danh sách gợi ý (không chặn/lỗi vì thiếu gợi ý).

### 3.6 Unwanted Behavior Requirements

FR-016: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401 (cả 2 endpoint).

FR-017: IF người dùng không có permission `room.delete`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-018: IF `roomId` không tồn tại/soft-deleted, THEN THE system SHALL trả về 404, error code `ROOM_NOT_FOUND` (cả 2 endpoint).

FR-019: IF phòng thỏa điều kiện EX1 tại thời điểm gọi `DELETE`, THEN THE system SHALL trả về 409 `ROOM_IN_USE`, KHÔNG thực hiện bất kỳ thay đổi nào (toàn bộ transaction FR-010 không chạy).

FR-019a (mới 2026-08-16): IF phòng thỏa điều kiện EX2 (FR-009a) tại thời điểm gọi `DELETE`, THEN THE system SHALL trả về 409 `ROOM_HAS_SCHEDULED_MEETINGS`, KHÔNG thực hiện bất kỳ thay đổi nào (toàn bộ transaction FR-010 không chạy, kể cả với các cuộc họp `DRAFT`/`PENDING_APPROVAL` khác cùng phòng — xóa vẫn atomic, hoặc xóa được hết hoặc không xóa gì cả).

FR-020: IF phòng đã bị soft-delete từ trước (gọi `DELETE` 2 lần), THEN THE system SHALL trả về 404 `ROOM_NOT_FOUND` (soft-delete khiến phòng không còn "tồn tại" theo query mặc định) — không có lỗi 409 trùng lặp riêng.

### 3.7 Authorization Requirements

FR-021: WHEN người dùng thực hiện xem trước tác động hoặc xóa thật, THE system SHALL verify authentication và authorization (`room.delete`) trước khi thực thi bất kỳ truy vấn/ghi nào.

### 3.8 Data & State Requirements

FR-022 (sửa 2026-08-16 — tách 1 query thành 2): WHEN xác định "cuộc họp tương lai bị ảnh hưởng", THE system SHALL dùng 2 truy vấn riêng biệt, dùng chung cho cả preview (FR-006) và xóa thật (FR-010):
- **Chặn (EX2, FR-009a)**: `meetings.room_id = :roomId AND meetings.start_time > now() AND meetings.status = 'scheduled'`.
- **Không chặn, bị null hóa (FR-010)**: `meetings.room_id = :roomId AND meetings.start_time > now() AND meetings.status IN ('draft','pending_approval')`.

FR-023: WHEN xác định điều kiện chặn EX1 (FR-009), THE system SHALL kiểm tra `EXISTS (meeting WHERE room_id=:roomId AND (status='in_progress' OR (status='scheduled' AND now() BETWEEN start_time AND end_time)))`.

FR-024: WHEN release `room_bookings` liên quan (FR-010b), THE system SHALL chỉ áp dụng cho booking có `status IN ('pending','approved','active')` — bỏ qua booking đã `completed`/`cancelled`/`released` từ trước.

FR-025: WHEN ghi audit log (FR-010f), THE system SHALL lưu `actionType='delete'`, `entityType='room'`, `entityId=roomId`, `newValueJson` chứa `{deletedAt, affectedMeetingIds: [...]}`.

### 3.9 Notification / Audit Requirements

FR-026: WHEN background job (FR-011) hoàn tất xử lý toàn bộ meeting bị ảnh hưởng, THE system SHALL cập nhật `background_jobs.status = 'completed'`, `outputJson` chứa số lượng notification đã gửi thành công/thất bại.

FR-027: IF gửi notification cho 1 meeting cụ thể thất bại (vd lỗi SMTP), THEN THE system SHALL log lỗi cho meeting đó, tiếp tục xử lý các meeting còn lại (không để 1 lỗi làm hỏng toàn bộ job) — cập nhật `background_jobs.status = 'completed'` với `outputJson` ghi rõ danh sách thất bại (không dùng `'failed'` cho lỗi từng phần).

### 3.10 Complex / Combined Requirements

FR-028: WHILE đang trong transaction FR-010, IF bất kỳ bước con nào (release booking, null hóa roomId, ghi event/audit) lỗi, THEN THE system SHALL rollback toàn bộ transaction — phòng KHÔNG bị xóa, không có meeting nào bị ảnh hưởng (atomic).

FR-029: WHERE phòng có cả cuộc họp tương lai bị ảnh hưởng VÀ đồng thời thỏa điều kiện EX1 (hiếm nhưng có thể — 1 cuộc họp đang diễn ra + N cuộc khác trong tương lai), THE system SHALL ưu tiên chặn EX1 (FR-009) — không xóa được cho tới khi cuộc họp đang diễn ra kết thúc, bất kể có bao nhiêu cuộc họp tương lai khác.

FR-029a (mới 2026-08-16): WHERE phòng thỏa cả EX1 VÀ EX2, THE system SHALL vẫn ưu tiên chặn EX1 trước (kiểm tra theo đúng thứ tự trong `deleteRoom()`: EX1 → EX2 → transaction) — thông báo lỗi cho admin luôn là "đang được dùng ngay bây giờ" trước, dù về sau (sau khi cuộc họp hiện tại kết thúc) EX2 vẫn có thể tiếp tục chặn nếu còn cuộc họp `SCHEDULED` khác trong tương lai.

### 3.11 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-ROOM-03 POST-1, BR1, BR2 (BR2 thu hẹp — §0.10) |
| FR-004–FR-013a | Event-driven | UC-ROOM-03 Normal Flow bước 1-8; FR-009a/FR-013a mới (EX2, §0.10) |
| FR-014 | State-driven | Trường hợp phòng không có meeting nào |
| FR-015 | Optional Feature | Other Information (gợi ý phòng) |
| FR-016–FR-020, FR-019a | Unwanted Behavior | EX1, EX2 (mới), validation |
| FR-021 | Authorization | PRE-1 |
| FR-022–FR-025 | Data & State | BR2 (thu hẹp), EX1, EX2, audit convention |
| FR-026, FR-027 | Notification/Audit | POST-3, Other Information |
| FR-028, FR-029, FR-029a | Complex | Atomicity, EX1 ưu tiên hơn EX2 |
| FR-030 | Event-driven (bổ sung) | POST-1 — WebSocket broadcast (§0.9) |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả lời `GET .../deletion-impact` trong dưới 1 giây.
NFR-002: THE system SHALL hoàn tất transaction xóa (FR-010) trong dưới 3 giây kể cả khi có tới ~100 meeting bị ảnh hưởng (không gọi gợi ý phòng/gửi email trong transaction này — đã tách async, §0.5).
NFR-003: THE system SHALL xử lý background job gửi thông báo không giới hạn thời gian cứng (best-effort), nhưng phải log tiến độ để có thể theo dõi qua `background_jobs`.

### 4.2 Security

NFR-004: THE system SHALL yêu cầu authentication cho mọi request (cả 2 endpoint).
NFR-005: THE system SHALL dùng parameterized query cho mọi truy vấn (không nối chuỗi roomId vào SQL).

### 4.3 Reliability & Consistency

NFR-006: THE system SHALL đảm bảo transaction FR-010 atomic — không có trạng thái nửa xóa (rooms đã soft-delete nhưng meetings chưa null hóa roomId, hoặc ngược lại).
NFR-007: THE system SHALL đảm bảo audit log (FR-025) không làm rollback thao tác chính nếu ghi log thất bại — nhất quán pattern `RoomsService.create()`/`update()`.

### 4.4 Usability

NFR-008: THE system SHALL trả về `affectedMeetingCount` chính xác ở bước preview để FE hiển thị đúng số X trong hộp thoại xác nhận (Normal Flow bước 4).

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `rooms` | Soft-delete | `deletedAt` |
| `room_bookings` | Release booking tương lai | Chuyển `status → released` |
| `meetings` | Null hóa `roomId` | Không đổi `status` |
| `meeting_events` | Audit trail cấp meeting | `eventType='room_changed'` hoặc mới |
| `room_events` | Audit trail cấp phòng | `eventType='room_deleted'` (varchar tự do) |
| `audit_logs` | Audit trail hệ thống | Tái dùng pattern `create()`/`update()` |
| `background_jobs` | Xử lý bất đồng bộ | Loại mới (varchar, không migration) |
| `notifications` | Gửi thông báo | `NotificationType.MEETING_ROOM_REMOVED` (mới) |

### 5.2 Dữ liệu đầu vào

**`GET /api/v1/rooms/:roomId/deletion-impact`**

| Field | Type | Bắt buộc | Mô tả |
|---|---:|---:|---|
| roomId (path param) | UUID | Có | Phòng cần xem tác động |

**`DELETE /api/v1/rooms/:roomId`**

| Field | Type | Bắt buộc | Mô tả |
|---|---:|---:|---|
| roomId (path param) | UUID | Có | Phòng cần xóa |

### 5.3 Dữ liệu đầu ra

**Preview (sửa 2026-08-16 — xem §0.10):**

| Field | Type | Mô tả |
|---|---:|---|
| roomId, roomName | uuid/string | |
| canDelete | boolean | FR-006 — `true` khi `blockingMeetings=[]` và `blockedByInProgressMeeting=false` |
| blockingMeetings | `{id,title,startTime,endTime}[]` | FR-006, FR-009a, FR-022 — cuộc họp `SCHEDULED` tương lai đang chặn xóa |
| pendingMeetingCount | number | FR-006, FR-022 — số `DRAFT`/`PENDING_APPROVAL` tương lai, KHÔNG chặn |
| blockedByInProgressMeeting | boolean | FR-006, FR-023 |

**Xóa thật:**

| Field | Type | Mô tả |
|---|---:|---|
| roomId | uuid | |
| deletedAt | datetime | |
| affectedMeetingCount | number | Số meeting `DRAFT`/`PENDING_APPROVAL` đã được null hóa roomId (KHÔNG bao giờ gồm `SCHEDULED` — bị FR-009a chặn từ trước) |
| notificationJobId | uuid | id của background job đã enqueue (FR-011), để FE có thể theo dõi nếu cần |

### 5.4 Data Constraints

- Không hard-delete bất kỳ bản ghi nào.
- Không thêm bảng/cột — chỉ 1 permission mới + enum-as-string mới (`BackgroundJobType`, `NotificationType`, event type strings) — tất cả đều `varchar`, không cần migration.
- Cuộc họp quá khứ (`startTime <= now()` hoặc `status IN (completed, cancelled)`) **không bị đụng tới**.

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN truy vấn "cuộc họp tương lai bị ảnh hưởng", THE system SHALL dùng đúng điều kiện tại FR-022, tái sử dụng cho cả preview (FR-006) và xóa thật (FR-010) để đảm bảo nhất quán số liệu.

FR-DATA-002: WHEN gọi `scheduling/room-suggestions` cho từng meeting (FR-013), THE system SHALL truyền đúng `attendeeCount`/`startTime`/`endTime` của CHÍNH meeting đó (không dùng chung 1 khung giờ cho tất cả meeting bị ảnh hưởng).

### 5.6 Cần làm rõ

- **CL-1 (quan trọng)**: Rủi ro §0.7 — cần audit các read-path hiển thị tên phòng cho cuộc họp quá khứ (đặc biệt feature `feat-view-room-usage-history` vừa đặc tả) để đảm bảo dùng `withDeleted: true` hoặc JOIN không lọc `deleted_at`. Đây là dependency chéo feature, **không sửa trong phạm vi feature này** nhưng phải có task theo dõi riêng trước khi release.
- **CL-2 (đã chốt 2026-08-16 — xem §0.10)**: Cuộc họp `DRAFT`/`PENDING_APPROVAL` tại phòng bị xóa vẫn coi là "bị ảnh hưởng" (null hóa `roomId`, không chặn xóa) — CHỈ khác với `SCHEDULED` là KHÔNG chặn xóa phòng (EX2, FR-009a chỉ áp dụng cho `SCHEDULED`). Không loại trừ.
- **CL-3**: Giới hạn "tối đa 2-3 phòng gợi ý" trong email — chưa rõ con số chính xác là 2 hay 3 hay để `min(3, số phòng tìm được)`. Đề xuất mặc định `top 3`.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `roomId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.

### 6.2 Authentication / Authorization Errors

ERR-002: IF chưa đăng nhập, THEN 401.
ERR-003: IF không có permission `room.delete`, THEN 403 `PERMISSION_DENIED`.

### 6.3 Business Rule Errors

ERR-004: IF `roomId` không tồn tại/soft-deleted, THEN 404 `ROOM_NOT_FOUND`.
ERR-005: IF phòng thỏa điều kiện EX1, THEN 409 `ROOM_IN_USE`.
ERR-005a (mới 2026-08-16): IF phòng thỏa điều kiện EX2 (còn cuộc họp `SCHEDULED` tương lai), THEN 409 `ROOM_HAS_SCHEDULED_MEETINGS` (FR-009a).
ERR-008 (mới 2026-08-16, module `meetings` — FR-013a): IF Manager gọi `approve()` cho request mà `meeting.roomId IS NULL` và `request.targetRoomId IS NULL`, THEN 409 `MEETING_ROOM_REMOVED`.

### 6.4 System Errors

ERR-006: IF lỗi hệ thống không lường trước trong transaction chính, THEN 500 `INTERNAL_ERROR`, rollback toàn bộ (FR-028).
ERR-007: IF background job xử lý notification lỗi từng phần, THEN KHÔNG trả lỗi cho request `DELETE` gốc (đã trả 200 trước đó) — chỉ ghi nhận trong `background_jobs.outputJson` (FR-027).

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001 (sửa 2026-08-16):
Given phòng "P101" có 3 cuộc họp tương lai `status=pending_approval` (chưa duyệt) và không có cuộc họp nào đang diễn ra hay đã `scheduled`,
When Business Admin gọi `GET .../deletion-impact`,
Then trả về `canDelete=true`, `blockingMeetings=[]`, `pendingMeetingCount=3`, `blockedByInProgressMeeting=false`.

AC-002 (sửa 2026-08-16):
Given tình huống AC-001, Business Admin xác nhận gọi `DELETE`,
Then phòng "P101" bị soft-delete, cả 3 meeting có `roomId=NULL` nhưng `status` vẫn `pending_approval`, response trả `affectedMeetingCount=3` + `notificationJobId`.

AC-008:
Given tình huống AC-002 vừa xóa thành công,
When kiểm tra WebSocket ngay sau khi API trả về (không chờ background job),
Then mọi client đang kết nối nhận đúng 1 event `room.deleted` với `roomId` khớp phòng "P101" (FR-030, §0.9).

AC-003 (sửa 2026-08-16):
Given background job (từ AC-002) đã chạy xong, mỗi trong 3 meeting có organizer với `directManagerId` khác nhau,
When kiểm tra `notifications`,
Then mỗi organizer VÀ direct manager tương ứng của 3 meeting nhận đúng 1 notification `MEETING_ROOM_REMOVED` (dedupe theo user id) kèm tối đa 3 phòng gợi ý đúng khung giờ + sức chứa của meeting đó, nội dung nêu rõ yêu cầu duyệt sẽ bị chặn (FR-013).

AC-009 (mới 2026-08-16, EX2):
Given phòng "P105" có 1 cuộc họp tương lai `status=scheduled` (đã duyệt) và 2 cuộc họp `pending_approval` khác,
When Business Admin gọi `GET .../deletion-impact` rồi `DELETE`,
Then preview trả `canDelete=false`, `blockingMeetings` chứa đúng 1 phần tử (cuộc họp `scheduled`); `DELETE` trả 409 `ROOM_HAS_SCHEDULED_MEETINGS`, phòng KHÔNG bị xóa, KHÔNG có meeting nào (kể cả 2 `pending_approval`) bị đụng tới (atomic, FR-019a).

AC-010 (mới 2026-08-16, FR-013a):
Given phòng của meeting "M1" (`status=pending_approval`) đã bị xóa (roomId=NULL) theo kịch bản AC-002, request liên quan chưa có `targetRoomId` mới,
When Manager gọi `POST /meeting-requests/:requestId/approve`,
Then hệ thống trả 409 `MEETING_ROOM_REMOVED`, request KHÔNG được duyệt, `meeting.status` vẫn `pending_approval`.

AC-011 (mới 2026-08-16, FR-013a):
Given tình huống AC-010, nhưng host đã gửi 1 request `UPDATE_ROOM` mới với `targetRoomId` hợp lệ,
When Manager gọi `approve()` cho request `UPDATE_ROOM` đó,
Then hệ thống KHÔNG bị chặn bởi FR-013a (có targetRoomId), tiếp tục xử lý bình thường theo luồng approve có sẵn (UC-MM-03).

### 7.2 Validation & Business Rule Cases

AC-004:
Given phòng "P102" đang có 1 cuộc họp `status=in_progress`,
When gọi `DELETE`,
Then hệ thống trả 409 `ROOM_IN_USE`, không xóa, không ảnh hưởng meeting nào (EX1).

AC-005:
Given phòng "P103" có 1 cuộc họp `status=scheduled` với `now()` nằm trong `[startTime, endTime]` nhưng chưa ai bấm Start (chưa `in_progress`),
When gọi `DELETE`,
Then hệ thống VẪN trả 409 `ROOM_IN_USE` (§0.3 — cả 2 tín hiệu).

AC-006:
Given phòng "P104" có 1 cuộc họp đã `COMPLETED` trong quá khứ và không có cuộc họp tương lai nào,
When gọi `DELETE`,
Then hệ thống xóa thành công (`affectedMeetingCount=0`), cuộc họp quá khứ không bị đụng tới, không enqueue background job (FR-014).

AC-007:
Given người dùng không có permission `room.delete`,
When gọi bất kỳ endpoint nào trong 2 endpoint,
Then hệ thống trả 403 `PERMISSION_DENIED`.

### 7.3 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-004–FR-006, FR-022 |
| AC-002 | FR-010–FR-012 |
| AC-003 | FR-011, FR-013, FR-DATA-002 |
| AC-004 | FR-009, FR-019, FR-023 |
| AC-005 | FR-009, FR-023, §0.3 |
| AC-006 | FR-003, FR-014 |
| AC-007 | FR-017, ERR-003 |
| AC-008 | FR-030 |
| AC-009 | FR-006, FR-009a, FR-019a, ERR-005a |
| AC-010 | FR-013a, ERR-008 |
| AC-011 | FR-013a |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Sửa các read-path của feature khác (vd `feat-view-room-usage-history`) để tương thích soft-delete — chỉ ghi nhận rủi ro (§0.7, CL-1), theo dõi riêng.
- Cho phép người tổ chức bấm trực tiếp trong email để đổi phòng ngay (email chỉ gợi ý, thao tác đổi phòng thật vẫn qua UC-MM-03 có sẵn).
- Khôi phục phòng đã xóa (restore/undelete) — use case riêng nếu cần.
- Xóa cứng (hard-delete) phòng — không nằm trong phạm vi, và vi phạm BR1 nếu làm.
- Xử lý đặc biệt cho meeting định kỳ ở cấp series (`meeting_recurrence_rules`) — chỉ xử lý theo từng occurrence (§1.4).

### 8.2 Có thể xem xét ở feature khác

- Audit toàn bộ read-path hiển thị tên phòng cho dữ liệu lịch sử, đảm bảo dùng `withDeleted: true` (bắt buộc trước khi feature này lên production — CL-1).
- Feature khôi phục phòng đã xóa.
- Cho phép chọn phòng thay thế ngay trong email (deep-link).

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT hard-delete the room record.
OOS-002: THE system SHALL NOT cancel or change the status of affected future meetings.
OOS-003: THE system SHALL NOT modify meetings with startTime in the past or status IN (completed, cancelled).
OOS-004: THE system SHALL NOT create new database tables or columns for this feature.
OOS-005: THE system SHALL NOT block the DELETE response waiting for notification emails to be sent.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS, đủ 5 pattern cơ bản + Complex.
- [x] Mỗi requirement có mã ID rõ ràng, có traceability.
- [x] Error handling bao gồm validation, authentication, authorization, business rule, system error.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Out of Scope có EARS guardrails.
- [x] Không tự ý thêm bảng/cột database mới (chỉ 1 permission + enum-as-string mới, không migration).
- [x] Các điểm thiếu thông tin đưa vào mục 5.6 "Cần làm rõ".
- [x] 2 điểm mơ hồ chính đã chốt cùng người dùng trước khi viết (§0.2, §0.3).
- [x] Rủi ro kỹ thuật quan trọng (§0.7) đã ghi nhận rõ ràng, không bị bỏ sót.
