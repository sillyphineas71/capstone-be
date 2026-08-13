# Đánh giá SRS — 7. Room Utilization Management

Nguồn SRS đối chiếu: `SRS tiếng Việt.md`, mục "7. Room Utilization Management" (UC-43 → UC-47).
Nguồn code đối chiếu: `src/modules/rooms/**` (controllers/services liên quan: `room-status.service.ts`, `no-show.controller.ts`, `no-show.service.ts`, `no-show-lifecycle.service.ts`, `no-show-config.controller.ts`, `early-vacancy.service.ts`, `early-vacancy-config.controller.ts`) — nhánh `main`, commit `07f47b6`. Ghi chú: nội bộ code gắn nhãn "RMS-001", "UC-36+38", "UC-41/42/45", "EVD-001 #34" — hoàn toàn không khớp số hiệu UC-43→47 của SRS; đã đối chiếu theo nội dung nghiệp vụ, không theo số hiệu. Hai endpoint `GET /rooms/realtime-status` và `GET /rooms/:roomId/status` đã được xác nhận thuộc mục này (không phải mục 4 như nghi vấn ở file audit Mục 4).

## Tổng quan
Số UC: 5 | Khớp hoàn toàn: 0 | Khớp một phần: 4 | Sai hoàn toàn: 1 (UC-47) | Không có code: 0

---

## UC-43 — Xem Trạng thái Phòng theo Thời gian thực (Tổng quan, Tìm kiếm & Chi tiết)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** 3 mức độ chi tiết: Dashboard tổng quan, Tìm kiếm/Lọc, Chi tiết phòng (so sánh "Thời gian đã đặt" vs "Thời gian sử dụng thực tế"). BR-01: mã màu nhất quán cho trạng thái (Trống=Xanh lá, Đang sử dụng=Đỏ, Cảnh báo No-show=Vàng/Cam).

**Code thực tế (bằng chứng):**
- `src/modules/rooms/controllers/rooms.controller.ts:239-266` (`GET /rooms/realtime-status`, `GET /rooms/:roomId/status`) + `src/modules/rooms/services/room-status.service.ts:70-157` (`RoomStatusService`, tự gắn nhãn nội bộ "RMS-001 / UC-36+38") — đọc read-only, dùng `LEFT JOIN LATERAL` để lấy đồng thời: `occupancyCount`/`lastPresenceAt` (từ `room_events`), booking đang chạy (`title`, `hostName`, `reservedStartTime/EndTime`), và `noShowStatus` (detection_status của no-show case mới nhất) trong 1 truy vấn — khớp đúng ý "3 mức độ trên cùng 1 nguồn dữ liệu" của SRS.
- `src/modules/rooms/services/room-status.service.ts:42-57` (`RoomStatusDetail`) — có `reservedStartTime/EndTime` (đã đặt) và `lastPresenceAt`/`occupancyCount` (tín hiệu hiện diện thực tế), nhưng **KHÔNG có trường tính sẵn "Actual Start/End Time" hay % chênh lệch giữa đặt và dùng thực tế** — việc "so sánh Thời gian đã đặt vs. Thời gian sử dụng thực tế" (SRS BR-03) phải được FE tự suy ra từ các trường thô này, không có sẵn 1 trường tổng hợp.
- **Mã màu (BR-01) hoàn toàn không xuất hiện trong code BE** (`currentStatus` trả về là chuỗi enum thô, ví dụ `available`/`occupied`/...) — đây là chi tiết hiển thị thuộc trách nhiệm FE, không phải điều BE cần hiện thực; không tính là mâu thuẫn nhưng SRS đặt BR-01 như một Business Rule của hệ thống nói chung.
- Endpoint yêu cầu permission `room.utilization.read` — SRS ghi Primary Actor là "Manager, Business Admin" — khớp hợp lý.

**Nhận xét:** Dữ liệu nền tảng đầy đủ và đúng nguồn, nhưng phần "so sánh trực tiếp thời gian đặt vs. thời gian dùng thực tế" mà SRS mô tả như một khả năng có sẵn của màn hình chi tiết chưa có trường tổng hợp tương ứng ở BE.

**Đề xuất sửa SRS:** Ghi chú: "Việc so sánh Thời gian đã đặt và Thời gian sử dụng thực tế được tính toán ở phía giao diện dựa trên dữ liệu thô (thời gian đặt phòng, thời điểm phát hiện hiện diện gần nhất) do backend cung cấp — backend hiện không trả sẵn một trường 'khoảng chênh lệch' đã tính toán." Mã màu trạng thái là quy ước hiển thị của giao diện, không phải dữ liệu do backend quy định.

---

## UC-44 — Phát hiện No-show & Tự động Giải phóng Phòng
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Vòng đời case: DETECTED → WARNING_SENT → RELEASED, mỗi bước có dấu thời gian. Giả định: dùng Cron job/background worker.

**Code thực tế (bằng chứng):**
- `src/modules/rooms/entities/no-show-case.entity.ts:13-20` (`NoShowDetectionStatus`) — thực tế có **6 trạng thái**: `RISK, CONFIRMED, WARNING_SENT, RELEASED, DISMISSED, RESOLVED` — nhiều hơn 3 trạng thái SRS mô tả (SRS chỉ có DETECTED/WARNING_SENT/RELEASED, cộng DISMISSED được nhắc ở UC-45). Cụ thể `RISK` (nghi ngờ, chưa xác nhận) tách biệt khỏi `CONFIRMED` (đã xác nhận no-show) — một tầng phòng ngừa báo động giả (false-positive) không có trong SRS.
- `src/modules/rooms/services/no-show-lifecycle.service.ts:108-149` (`warnBatch`) — quét case ở `risk`, chưa có hiện diện, đã đủ `warning_grace` → chuyển `warning_sent` + gửi thông báo (idempotent) — khớp đúng cơ chế bước 3 của SRS.
- `src/modules/rooms/services/no-show-lifecycle.service.ts:248-292` (`autoReleaseBatch`) — **dòng 254-257: đọc cờ cấu hình `autoReleaseEnabled`; nếu `false` → BỎ QUA TOÀN BỘ batch, không release bất kỳ case nào.** Điều này khớp với `CLAUDE.md` mục 23 (Feature flags): `auto_release_no_show_enabled=false` — tính năng tự động giải phóng phòng **mặc định TẮT**, không "luôn luôn chạy" như giọng văn khẳng định của SRS UC-44 (SRS mô tả pipeline như một hành vi mặc định luôn hoạt động, không hề nhắc tới khả năng bị tắt qua cấu hình).
- `src/modules/rooms/services/no-show-lifecycle.service.ts:259-268` — điều kiện ứng viên auto-release: `detection_status = 'warning_sent'`, đã tới `auto_release_eligible_at`, booking vẫn `approved/active`, và **`u.first_presence_at IS NULL`** (chưa từng có ai được ghi nhận hiện diện) — khớp đúng "không có bất kỳ tín hiệu sử dụng thực tế nào" của SRS Trigger.
- `src/modules/rooms/services/no-show-lifecycle.service.ts:150-245` (`release`) — trong 1 transaction: cập nhật case → `released`, cập nhật `room_bookings.status = 'released'`, cập nhật `room_booking_usages`, ghi `room_events` (`room_auto_released`), rồi gửi thông báo — khớp đúng POST-2/POST-3 của SRS (thu hồi phòng, ghi log, gửi thông báo).
- Ngưỡng `warning_grace`/`auto_release_eligible_at` là **cấu hình được** qua `no-show-config.controller.ts` (`GET`/`PUT`, Admin xem/sửa ngưỡng) — khớp đúng PRE-3 của SRS ("Ngưỡng thời gian ân hạn No-show đã được cấu hình trước bởi quản trị viên").

**Nhận xét:** Cơ chế lõi (phát hiện → cảnh báo → tự động giải phóng) được hiện thực đúng và còn có thêm tầng "RISK trước khi CONFIRMED" để giảm báo động giả — nhưng điểm quan trọng nhất SRS bỏ sót là: **toàn bộ bước tự động giải phóng phòng (`autoReleaseBatch`) bị gate bởi 1 feature flag mặc định TẮT** (đúng theo quy ước "provisional feature" của CLAUDE.md mục 23) — nghĩa là trên một môi trường mới/mặc định, no-show chỉ dừng ở mức cảnh báo (WARNING_SENT), KHÔNG tự động giải phóng phòng trừ khi Admin bật cấu hình.

**Đề xuất sửa SRS:** Bổ sung Precondition: "Tính năng tự động giải phóng phòng khi phát hiện No-show phải được quản trị viên hệ thống BẬT tường minh qua cấu hình (`auto_release_no_show_enabled`); nếu tắt, hệ thống vẫn gửi cảnh báo đến Người chủ trì (đến bước WARNING_SENT) nhưng sẽ KHÔNG tự động thu hồi phòng — cần một quản trị viên thao tác giải phóng thủ công (xem UC-46)." Bổ sung ghi chú về trạng thái `RISK` (nghi ngờ ban đầu) trước khi được xác nhận thành case chính thức.

---

## UC-45 — Cập nhật trạng thái xử lý no-show
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Primary Actor: Business Admin. PRE-2: "Người dùng phải đăng nhập bằng tài khoản Business Admin hoặc có đặc quyền quản lý cơ sở vật chất (Facility Manager)." BR2: Bảng lịch sử append-only, case đã đóng (RELEASED/DISMISSED) không thể mở lại.

**Code thực tế (bằng chứng):**
- `src/modules/rooms/controllers/no-show.controller.ts:83-109` (`PATCH no-show-cases/:id`) — comment dòng 84-88 xác nhận: route này **KHÔNG dùng `PermissionsGuard`/`@RequirePermissions` như mọi route khác** — thay vào đó, `NoShowService.update()` tự kiểm tra quyền để mở thêm một lối cho phép **Host/Organizer của chính cuộc họp đó tự "dismiss" (hủy cảnh báo) case của mình MÀ KHÔNG CẦN quyền `room.noshow.update`** — đây là một luồng tự-phục-vụ (self-service) hoàn toàn không có trong SRS (SRS chỉ mô tả Business Admin/Facility Manager thao tác).
- `src/modules/rooms/services/no-show.service.ts:295-326` (`assertAuthorized`) — lối tự-dismiss này **CHỈ áp dụng cho đúng giá trị `dto.detectionStatus === 'dismissed'`**, không áp dụng cho `'confirmed'` hay `'resolved'` — phạm vi hẹp, có kiểm soát.
- `src/modules/rooms/services/no-show.service.ts:232-239` — nếu case đã ở trạng thái `TERMINAL_STATUSES` (đóng), từ chối cập nhật với `INVALID_NO_SHOW_TRANSITION` — khớp chính xác BR2 (không mở lại case đã đóng).
- `src/modules/rooms/services/no-show.service.ts:243-256` — `warning_sent`/`released` là `SYSTEM_OWNED_STATUSES`, không thể set thủ công qua endpoint này (chỉ hệ thống tự động mới được đặt) — chi tiết bảo vệ hợp lý, không có trong SRS nhưng không mâu thuẫn.
- `src/modules/rooms/controllers/no-show.controller.ts:111-137` (`POST no-show-cases/:id/release`, permission `room.noshow.release`) — đây mới là API "giải phóng phòng thủ công" thực sự (UC-46), tách biệt khỏi API "cập nhật trạng thái" chung (UC-45) — 2 UC dùng 2 endpoint riêng, khác với việc SRS UC-45 mô tả "Xác nhận giải phóng phòng" như MỘT trong các action của cùng 1 màn hình cập nhật.

**Nhận xét:** Sai lệch chính: SRS khẳng định chỉ Business Admin/Facility Manager mới thao tác được, nhưng code cho phép chính Host/Organizer tự hủy cảnh báo (dismiss) case của cuộc họp mình mà không cần quyền quản trị — một cơ chế tự-phục-vụ hợp lý về nghiệp vụ (để không làm phiền chủ trì) nhưng hoàn toàn vắng mặt trong SRS.

**Đề xuất sửa SRS:** Bổ sung PRE-2: "Ngoài Business Admin/Facility Manager, chính Người chủ trì (Host) hoặc Người tổ chức (Organizer) của cuộc họp liên quan cũng có thể tự thực hiện hành động 'Hủy cảnh báo' (Dismiss) cho case no-show của cuộc họp mình mà không cần quyền quản trị — chỉ giới hạn ở hành động Hủy cảnh báo, không áp dụng cho việc xác nhận (Confirm) hay giải quyết (Resolve) chính thức."

---

## UC-46 — Giải phóng phòng họp thủ công
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Admin/Manager buộc giải phóng phòng đang bận, nhập lý do, hệ thống ghi log "Bị thu hồi bởi Quản trị viên: [Tên Admin]". BR1: chỉ tác động Room Booking, KHÔNG xóa Meeting Event gốc.

**Code thực tế (bằng chứng):**
- `src/modules/rooms/controllers/no-show.controller.ts:111-137` (`POST no-show-cases/:id/release`, permission `room.noshow.release`) → `no-show-lifecycle.service.ts:295+` (`manualRelease`) → gọi chung hàm `release()` (dòng 150-245) với `mode: 'manual'`.
- `src/modules/rooms/services/no-show-lifecycle.service.ts:154-155` — nguồn hợp lệ để giải phóng thủ công: case phải đang ở `risk` HOẶC `warning_sent` — **không giải phóng thủ công được nếu case đã ở trạng thái khác** (ví dụ đã `released`/`dismissed`) — chi tiết ràng buộc không có trong SRS nhưng hợp lý (chống double-release, khớp comment "R2: 0 row → đã released/transition khác → chống double-release").
- `src/modules/rooms/services/no-show-lifecycle.service.ts:182-192` — chỉ release được booking đang `approved`/`active`; nếu booking đã đổi trạng thái (ví dụ Host đã tự check-out trước đó), trả `skipped: 'booking_changed'` — khớp đúng Exception E1 của SRS ("Phòng này vừa được giải phóng bởi Người chủ trì. Vui lòng làm mới trang.").
- `src/modules/rooms/services/no-show-lifecycle.service.ts:206-219` — ghi `room_events` với `event_type: 'room_manual_released'`, `actor_user_id`, `description = reason` — khớp đúng BR2 của SRS (ghi log nhãn người thu hồi + lý do); code lấy `actor` (userId) chứ chưa hẳn là "Tên Admin" hiển thị sẵn — việc hiển thị tên là trách nhiệm FE tra cứu từ `actor_user_id`.
- **Không đụng vào `MeetingEntity`/trạng thái cuộc họp** trong toàn bộ `release()` — chỉ sửa `room_bookings`, `room_booking_usages`, `no_show_cases`, `room_events` → khớp chính xác BR1 (không xóa Meeting Event gốc trên lịch của người tham dự).
- `src/modules/rooms/services/no-show-lifecycle.service.ts:228-237` — chỉ ghi `AuditLogEntity` khi `mode === 'manual'` (không ghi audit riêng cho nhánh tự động) — chi tiết hợp lý, không mâu thuẫn SRS.

**Nhận xét:** Khớp khá sát với SRS, bao gồm cả tình huống đua (race condition) giữa Admin và Host tự check-out. Chưa xác minh được nội dung chính xác của email/thông báo gửi cho Host (SRS "Other Information" yêu cầu nội dung cụ thể) do chưa đọc sâu template email trong phạm vi mục này.

**Đề xuất sửa SRS:** Không cần sửa nội dung chính; có thể bổ sung: "Chỉ có thể giải phóng thủ công khi case no-show đang ở trạng thái 'Nghi ngờ' (Risk) hoặc 'Đã gửi cảnh báo' (Warning Sent); nếu phòng đã được giải phóng bởi hành động khác trước đó (ví dụ Host tự check-out), hệ thống từ chối và yêu cầu làm mới dữ liệu."

---

## UC-47 — Phát hiện phòng họp trống sớm
**Trạng thái:** ❌ SAI HOÀN TOÀN (thiếu đúng phần cốt lõi: tự động giải phóng phòng)

**SRS hiện tại ghi:** Bước 5: hệ thống gửi thông báo cho Host kèm đếm ngược "3 phút". Bước 6-8: hết 3 phút không phản hồi → hệ thống **tự động thực thi lệnh "Kết thúc sớm"**, chốt "Giờ kết thúc thực tế", **gỡ liên kết cuộc họp khỏi phòng, chuyển phòng sang "Trống"**, làm mới Dashboard.

**Code thực tế (bằng chứng):**
- `src/modules/rooms/services/early-vacancy.service.ts:35` — comment tự mô tả chính xác phạm vi triển khai: **"Hướng A (flag-only): usage_status='early_empty' + room_event + notify."** — tức là code CHỦ ĐÍCH chỉ dừng ở việc: đánh dấu `room_booking_usages.usage_status = 'early_empty'` (dòng 121-128), ghi 1 `room_events` (dòng 135-146), và gửi thông báo (dòng 151, `notify()`).
- **Không có bất kỳ đoạn code nào** trong `early-vacancy.service.ts` thực hiện: cập nhật "Giờ kết thúc thực tế" của cuộc họp, gỡ liên kết `meeting↔room`, đổi trạng thái phòng (`rooms.current_status`) sang "Trống", hay bất kỳ hình thức đếm ngược 3 phút chờ phản hồi nào. Không tìm thấy lời gọi chéo nào từ `early-vacancy.service.ts` sang `no-show-lifecycle.service.ts`'s `release()` (đã grep xác nhận không có tham chiếu `early_empty`/`EarlyVacancy` nào trong `no-show-lifecycle.service.ts`).
- `src/modules/rooms/services/early-vacancy.service.ts:42` — code tự nhận đây là "known-gap" (N2): thậm chí chức năng "flag" (đánh dấu) cũng KHÔNG tự động bỏ đánh dấu nếu người dùng quay lại phòng sau đó — dữ liệu vẫn giữ nguyên "trống sớm" dù phòng đã có người trở lại.
- `src/modules/rooms/services/early-vacancy.service.ts:59-85` (`detect`) — các ngưỡng (`emptyMinutes`, `minRemainingMinutes`, `minElapsedMinutes`) đều lấy từ cấu hình (`EarlyVacancyConfigService`), không hard-code — về mặt cơ chế phát hiện (phòng trống liên tục ≥X phút trong khi cuộc họp còn ≥Y phút) khớp đúng ý tưởng SRS bước 1-4, chỉ khác các con số cụ thể SRS đưa ra (10 phút/15 phút) không hard-code trong code — hợp lý vì cấu hình được, nhưng nghĩa là giá trị mặc định thực tế cần tra `EarlyVacancyConfigService` để xác nhận có đúng 10/15 phút hay không (chưa xác minh trong phạm vi rà soát này).

**Nhận xét:** SRS UC-47 hứa hẹn một đường ống tự động hoàn chỉnh (phát hiện → cảnh báo có đếm ngược → tự động giải phóng phòng), nhưng code hiện tại **chỉ triển khai một nửa đầu** (phát hiện + gắn cờ dữ liệu + gửi thông báo) — phần "tự động kết thúc sớm cuộc họp và trả phòng về Trống" hoàn toàn không tồn tại. Đây là sai lệch ở mức có thể ảnh hưởng nghiêm trọng tới kỳ vọng người dùng nếu không được làm rõ.

**Đề xuất sửa SRS:**
- Sửa Postcondition POST-1/POST-2 thành: "Hệ thống đánh dấu phiên sử dụng phòng là 'Trống sớm' (`early_empty`) và ghi nhận sự kiện; hệ thống gửi thông báo cho Người chủ trì. **Hiện tại hệ thống KHÔNG tự động cập nhật Giờ kết thúc thực tế, KHÔNG tự động gỡ liên kết cuộc họp khỏi phòng, và KHÔNG tự động chuyển phòng sang trạng thái Trống** — việc giải phóng phòng vẫn cần thao tác thủ công của Quản trị viên (xem UC-46) hoặc Người chủ trì tự kết thúc sớm cuộc họp qua chức năng riêng (xem mục In-Meeting Management)."
- Xóa hoàn toàn bước 6-8 (tự động "Kết thúc sớm" sau đếm ngược 3 phút) khỏi Normal Flow, hoặc đánh dấu là "chưa triển khai — đề xuất cho giai đoạn sau" tương tự cách UC-30/31 (Mục 3) đã được đánh dấu.
- Xóa AF1 ("Host phản hồi giữ phòng") vì không có cơ chế đếm ngược/phản hồi nào tồn tại để hủy.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Trạng thái `RISK` (nghi ngờ, chưa xác nhận) trước `CONFIRMED`** trong vòng đời no-show case — một tầng chống báo động giả hoàn toàn không có trong SRS UC-44.
2. **Feature flag `auto_release_no_show_enabled`** (mặc định TẮT theo CLAUDE.md) gate toàn bộ bước tự động giải phóng phòng của UC-44 — SRS mô tả như hành vi mặc định luôn bật.
3. **Cơ chế tự-dismiss của Host/Organizer** (UC-45) không cần quyền quản trị — hoàn toàn không có trong SRS.
4. **"Known-gap" N2** (`early-vacancy.service.ts:42`): dữ liệu "trống sớm" không tự phục hồi khi người dùng quay lại phòng — một hạn chế kỹ thuật được chính đội BE ghi nhận, đáng đưa vào tài liệu như một giới hạn đã biết.
