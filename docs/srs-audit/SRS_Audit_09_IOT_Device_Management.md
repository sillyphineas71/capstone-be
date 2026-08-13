# Đánh giá SRS — 9. IOT Device Management

Nguồn SRS đối chiếu: `SRS tiếng Việt.md`, mục "9. IOT Device Management" (UC-55 → UC-63).
Nguồn code đối chiếu: `src/modules/iot/**`, `src/modules/face-access/**` (nhánh `main`, commit `07f47b6`). Ghi chú: code tự đánh số nội bộ IOT-005/011/012/013/014/015, TKR-001, IAC-001, FAT-001 — lệch số hiệu SRS, đã đối chiếu theo nội dung nghiệp vụ.

## Tổng quan
Số UC: 9 | Khớp hoàn toàn: 2 | Khớp một phần: 6 | Sai hoàn toàn: 0 | Không có code: 1 (một phần của UC-58)

---

## UC-55 — Đăng ký & Gán Thiết bị IoT
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** "Other Information" khẳng định rõ: gộp từ UC-IOT-01 (đăng ký) và UC-RM-05 (gán camera vào phòng) — "**việc gán phòng diễn ra ngay tại thời điểm đăng ký**". Normal Flow bước 4: "Admin chọn phòng họp mục tiêu cho thiết bị này" như một phần của CÙNG một biểu mẫu tạo mới.

**Code thực tế (bằng chứng):**
- `src/modules/iot/dto/create-iot-device.dto.ts:15-47` (`CreateIotDeviceDto`) — các trường: `deviceName`, `deviceCode`, `deviceType`, `ipAddress` (tùy chọn), `macAddress` (tùy chọn), `metadataJson` — **KHÔNG có trường `roomId`** trong payload tạo thiết bị.
- `src/modules/iot/controllers/iot-devices.controller.ts:82-150` — việc gán phòng là một **API riêng biệt**: `POST /iot-devices/:id/assign-room` (permission `iot_devices:assign_room`), tách hoàn toàn khỏi `POST /iot-devices` (permission `iot_devices:create`) dùng để tạo thiết bị. → **Mâu thuẫn trực tiếp với khẳng định "gán phòng diễn ra ngay tại thời điểm đăng ký" của SRS** — thực tế là 2 lệnh gọi API tuần tự, không phải một hành động nguyên tử/một biểu mẫu duy nhất.

**Nhận xét:** Quyết định hợp nhất UC được SRS ghi lại (gộp đăng ký + gán phòng thành 1 hành động) không khớp với kiến trúc API thực tế — 2 bước tách rời với 2 permission khác nhau.

**Đề xuất sửa SRS:** Sửa "Other Information" và Normal Flow: "Việc đăng ký thiết bị (tạo mã, tên, loại, địa chỉ mạng) và việc gán thiết bị vào phòng họp là 2 thao tác API riêng biệt (2 permission khác nhau: `iot_devices:create` và `iot_devices:assign_room`), dù giao diện người dùng có thể trình bày chúng như 2 bước liên tiếp trong cùng một luồng màn hình."

---

## UC-56 — Cấu hình Kết nối Thiết bị & Callback Token
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** AF-1: cập nhật cấu hình hiện có bằng cách lặp lại các bước tạo mới (ghi đè). AF-2: xoay vòng hoặc thu hồi callback token.

**Code thực tế (bằng chứng):**
- `src/modules/iot/controllers/iot-devices.controller.ts:243-275` (`POST :id/face-server/configure`) — comment dòng 240-242 xác nhận: **"tạo mới HOẶC ghi đè config hiện có — service `configureFaceServer()` KHÔNG check 'đã config' nên gọi lại là upsert, không throw"** → khớp chính xác AF-1 (endpoint dùng chung cho cả 2 trường hợp, không có exception khi cấu hình lại).
- `src/modules/iot/controllers/iot-devices.controller.ts:278-334` (`POST :id/face-server/revoke`, `POST :id/face-server/rotate`) — 2 endpoint riêng biệt cho thu hồi/xoay vòng token, đều trả `one_time_callback_token` (plaintext, 1 lần duy nhất) khi rotate — khớp chính xác AF-2 và POST-3 của SRS ("token trước đó bị vô hiệu hóa và token mới có hiệu lực").
- `src/modules/iot/controllers/iot-devices.controller.ts:183-207` (`PATCH :id/rtsp-config`) — nhánh cấu hình cho IP Room Camera (khác Face Server) — khớp nhánh 4b của SRS; mật khẩu RTSP được **mã hóa AES-256-GCM** (comment dòng 180) và response luôn mask trường `rtsp_password_encrypted` — khớp đúng tinh thần BR-01 của SRS (thông tin nhạy cảm phải mã hóa khi lưu, làm mờ khi hiển thị).
- **`PATCH :id/ai-config`** (dòng 209-238, tự gắn nhãn nội bộ "IAC-001 (UC-96)") — một loại cấu hình THỨ BA hoàn toàn không có trong SRS: "bật/tắt chức năng AI của camera" (chỉ ghi vào `metadata_json.ai_config`, không đẩy xuống thiết bị) — không thuộc về Face Server (nhánh 4a) hay RTSP (nhánh 4b) mà SRS mô tả.

**Nhận xét:** 2 nhánh chính (Face Server, RTSP) khớp tốt với SRS bao gồm cả cơ chế mã hóa/token; có thêm 1 nhánh cấu hình AI hoàn toàn mới không được SRS nhắc tới.

**Đề xuất sửa SRS:** Bổ sung nhánh cấu hình thứ 3: "4c. Đối với cấu hình AI của camera: Admin bật/tắt cờ chức năng AI (chỉ lưu vào metadata cấu hình trong hệ thống, KHÔNG đẩy lệnh xuống thiết bị vật lý)."

---

## UC-57 — Cập nhật thông tin thiết bị IoT
**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi:** Chỉ sửa thông tin cơ bản (Tên, Mô tả, Firmware) — không đổi định danh kỹ thuật (Device Code/MAC).

**Code thực tế (bằng chứng):**
- `src/modules/iot/controllers/iot-devices.controller.ts:152-178` (`PATCH /iot-devices/:id`) — comment dòng 152-153: **"cập nhật thông tin mô tả/kết nối (allowlist 4 field)"**, dùng `forbidNonWhitelisted: true` → field ngoài danh sách cho phép (bao gồm `deviceCode` chắc chắn không nằm trong allowlist cập nhật) sẽ bị từ chối 400 → khớp chính xác BR-01 của SRS ("việc đổi Tên thiết bị không làm thay đổi định danh kỹ thuật cốt lõi").

**Nhận xét:** Không phát hiện sai lệch.

**Đề xuất sửa SRS:** Không cần.

---

## UC-58 — Vô hiệu hóa/Kích hoạt/Gỡ thiết bị IoT
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (thiếu hẳn 1 trong 3 hành động)

**SRS hiện tại ghi:** 3 hành động: (1) Vô hiệu hóa tạm thời (giữ hồ sơ, ngừng nhận tín hiệu); (2) Kích hoạt lại; (3) **Gỡ bỏ hoàn toàn** (xóa thiết bị khỏi hệ thống khi thanh lý/hỏng vĩnh viễn — xóa bản ghi, cắt liên kết phòng).

**Code thực tế (bằng chứng):**
- `src/modules/iot/controllers/iot-devices.controller.ts:338-369` — `POST :id/disable` (comment "IOT-012: vô hiệu hóa thiết bị, status → disabled") và `POST :id/enable` (comment "kích hoạt lại thiết bị, disabled → offline") — khớp đúng hành động (1) và (2). Lưu ý: sau khi enable, trạng thái chuyển về `offline` (không phải `active`/`online` ngay) — thiết bị cần tự gửi heartbeat tiếp theo mới thực sự "online" — chi tiết hợp lý, không mâu thuẫn cốt lõi với SRS.
- **Đã rà soát toàn bộ `src/modules/iot/controllers/*.ts` (`grep "@Delete"`) — không tìm thấy BẤT KỲ route `DELETE` nào.** Hành động (3) "Gỡ bỏ hoàn toàn" của SRS **không tồn tại dưới dạng API** trong phạm vi các controller đã rà soát.

**Nhận xét:** 2/3 hành động khớp tốt; hành động "Gỡ bỏ hoàn toàn" (xóa thiết bị) mà SRS mô tả chi tiết (kèm cảnh báo xác nhận khi thiết bị đang online, BR-01 về không mất dữ liệu điểm danh lịch sử) không tìm thấy endpoint tương ứng.

**Đề xuất sửa SRS:** Đánh dấu hành động "Gỡ bỏ hoàn toàn" (xóa vĩnh viễn thiết bị) là **CHƯA TRIỂN KHAI** ở backend hiện tại — chỉ có "Vô hiệu hóa" (ẩn/ngừng nhận) khả dụng làm giải pháp thay thế khi cần loại bỏ thiết bị hỏng/thanh lý khỏi vận hành.

---

## UC-59 — Xem & tìm kiếm danh sách/chi tiết thiết bị IoT
**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**Code thực tế (bằng chứng):**
- `src/modules/iot/controllers/iot-devices.controller.ts:38-80` — `GET /iot-devices` (danh sách, filter + phân trang), `GET /iot-devices/:id` (chi tiết) — khớp đúng shape SRS.
- `src/modules/iot/controllers/iot-devices.controller.ts:55-66` — có thêm `GET /iot-devices/status-summary` (dashboard tổng hợp trạng thái) — bổ sung hợp lý, không mâu thuẫn, khớp tinh thần "rà soát kiểm kê tài sản thiết bị hiện tại" của SRS Trigger.

**Nhận xét:** Không phát hiện sai lệch.

**Đề xuất sửa SRS:** Có thể bổ sung ghi chú về endpoint tổng hợp trạng thái (`status-summary`) phục vụ dashboard nhanh.

---

## UC-60 — Kiểm tra trạng thái khả dụng thiết bị (Probe)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Admin bấm "Kiểm tra kết nối" cho 1 thiết bị cụ thể → hệ thống ping/probe → trả kết quả tức thời (thành công/thất bại + độ trễ).

**Code thực tế (bằng chứng):**
- `src/modules/iot/controllers/iot-devices.controller.ts:372-399` (`POST :id/check-availability`, permission `iot.device.check_availability`) — khớp đúng luồng per-device của SRS; có xử lý bảo mật riêng: trường `checked_by` bị xóa khỏi response (chỉ lưu DB, không trả ra ngoài) — chi tiết hợp lý không mâu thuẫn.
- `src/modules/iot/controllers/iot-devices.controller.ts:108-124` (`POST /iot-devices/probe-status`, permission `iot.device.probe`) — **một endpoint THỨ HAI hoàn toàn không có trong SRS**: chạy một lượt probe HÀNG LOẠT (`detectOfflineDevices`) cho TẤT CẢ thiết bị cùng lúc — về bản chất là phiên bản có-thể-gọi-thủ-công của cơ chế tự động ở UC-61 (Automatic offline-detection flow), chứ không phải kiểm tra riêng lẻ 1 thiết bị như UC-60 mô tả.

**Nhận xét:** Luồng per-device khớp SRS; có thêm 1 endpoint bulk-probe không được mô tả, về bản chất là phiên bản thủ công của cơ chế tự động UC-61.

**Đề xuất sửa SRS:** Bổ sung ghi chú: "Ngoài kiểm tra từng thiết bị, hệ thống còn cung cấp một API chạy tay một lượt quét khả dụng cho TOÀN BỘ thiết bị cùng lúc — về bản chất là kích hoạt thủ công cơ chế phát hiện offline tự động (xem UC-61)."

---

## UC-61 — Nhận Heartbeat & Giám sát Trạng thái Online/Offline
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Luồng nhận Heartbeat (thụ động, thiết bị tự gửi). Luồng phát hiện Offline tự động (Cron job/scheduled quét last-seen timestamp).

**Code thực tế (bằng chứng):**
- `src/modules/iot/controllers/device-callbacks.controller.ts:9-17` (`GET` + `POST /device-callbacks/face/heartbeat`) — **có cả GET lẫn POST** cho cùng logic xử lý (`handleHeartbeat`) — CLAUDE.md mục 22.7a chỉ liệt kê `POST /device-callbacks/face/heartbeat`; SRS cũng chỉ mô tả nhận (không phân biệt method) — việc chấp nhận cả GET là một nhân nhượng tương thích thiết bị, không mâu thuẫn nghiệp vụ nhưng đáng lưu ý.
- `src/modules/iot/controllers/iot-devices.controller.ts:110-124` (`POST /iot-devices/probe-status` → `detectOfflineDevices`) — logic phát hiện offline có thể chạy qua cron **hoặc** kích hoạt thủ công qua API (đã nêu ở UC-60) — SRS chỉ mô tả cơ chế cron thuần túy, không đề cập khả năng kích hoạt thủ công.

**Nhận xét:** Về nghiệp vụ, khớp; điểm khác biệt kỹ thuật là bề mặt API rộng hơn SRS mô tả (hỗ trợ GET, hỗ trợ kích hoạt thủ công).

**Đề xuất sửa SRS:** Không bắt buộc; có thể ghi chú thêm 2 điểm trên nếu cần tài liệu kỹ thuật đầy đủ.

---

## UC-62 — Nhận, Lưu trữ & Chuẩn hóa Dữ liệu Sự kiện Thiết bị
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR-01: "Mọi sự kiện nhận diện được gửi bởi thiết bị phải được lưu trữ ở dạng thô, nguyên bản NGAY KHOẢNH KHẮC nó đến hệ thống." (nhấn mạnh: lưu trước, xử lý sau). CLAUDE.md mục 11.4 quy định thứ tự bắt buộc: "raw body nhận tại boundary → store raw payload vào `iot_device_events` → normalize payload → validate device và mapping → xử lý business logic."

**Code thực tế (bằng chứng):**
- `src/modules/iot/services/iot-devices.service.ts:1665-1748` (`receiveVerifyEvent`, các bước 1-7) — thứ tự xử lý thực tế: (1) trích `device_code` → (2) tìm thiết bị (404 nếu không có) → (3) kiểm tra `deviceType === FACE_SERVER` → (4) kiểm tra `callback_enabled` → (5) trích `callback_token` → (6) xác thực token → (7) kiểm tra `allowed_source_ip` — **TẤT CẢ các bước xác thực/validate này chạy TRƯỚC bước lưu trữ raw event**.
- `src/modules/iot/services/iot-devices.service.ts:1846-1875` — mãi tới bước 9 (sau khi đã vượt qua toàn bộ 7 bước xác thực ở trên) mới thực sự gọi `this.iotDeviceEventsService.storeRawEvent(...)` để ghi vào bảng `iot_device_events` (qua `IotDeviceEventsService`, xác nhận bảng này có tồn tại và được dùng đúng, không phải bịa đặt).
- **Hệ quả:** nếu một request bị từ chối ở bất kỳ bước nào trong 7 bước xác thực đầu (device không tồn tại, sai loại thiết bị, callback chưa bật, token sai/hết hạn, IP không hợp lệ), **request đó KHÔNG BAO GIỜ được ghi vào `iot_device_events`** — trái với tinh thần BR-01 của SRS (và mục 11.4 của CLAUDE.md) vốn yêu cầu lưu trữ raw payload NGAY KHI ĐẾN HỆ THỐNG, trước cả bước xác thực — với lý do rõ ràng: dữ liệu thô của các lần gọi bị từ chối chính là bằng chứng quan trọng nhất để điều tra tấn công/lỗi cấu hình/thiết bị giả mạo.
- `src/modules/iot/services/iot-devices.service.ts:1883-1912` (comment "FAT-001 (NC-4)") — sau khi lưu raw event thành công, hệ thống mới chuyển tiếp sang xử lý nghiệp vụ điểm danh (`faceVerifyHook.onVerify`), và lỗi ở bước điểm danh **không làm hỏng response 200** của callback — khớp đúng tinh thần "raw storage trước, business logic sau, lỗi business logic không ảnh hưởng việc đã lưu raw" của CLAUDE.md.

**Nhận xét:** Phần "chuẩn hóa payload → xử lý nghiệp vụ sau khi lưu" khớp tốt với SRS/CLAUDE.md; điểm lệch quan trọng là bước LƯU TRỮ đến SAU bước XÁC THỰC, nghĩa là các request không xác thực được (có thể là tấn công dò token, thiết bị giả mạo, lỗi cấu hình) hoàn toàn không để lại dấu vết trong `iot_device_events`.

**Đề xuất sửa SRS:** Bổ sung ghi chú/khoảng trống kỹ thuật: "Lưu ý triển khai hiện tại: việc lưu trữ raw payload vào nhật ký sự kiện chỉ xảy ra SAU KHI request đã vượt qua đầy đủ các bước xác thực (tồn tại thiết bị, đúng loại thiết bị, callback đã bật, token hợp lệ, IP hợp lệ) — các request bị từ chối ở bước xác thực (kể cả nghi vấn tấn công/giả mạo) hiện KHÔNG được ghi vào nhật ký sự kiện. Nếu yêu cầu nghiệp vụ cần lưu vết cả các lần gọi bị từ chối để phục vụ điều tra bảo mật, cần một thay đổi kiến trúc bổ sung."

---

## UC-63 — Tự động Cấp phát & Thu hồi Quyền Truy cập Khuôn mặt trên Thiết bị
**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi:** 3 luồng — Cấp phát (trước giờ họp, trong lead window), Thu hồi (sau khi họp kết thúc + khoảng ân hạn), Đối soát (chạy định kỳ sửa các trường hợp bỏ sót).

**Code thực tế (bằng chứng):**
- `src/modules/face-access/services/face-provisioning.service.ts:67-132` (`provisionUpcomingMeetings`, `provisionMeeting`, `provisionParticipant`) — khớp đúng Luồng cấp phát.
- `src/modules/face-access/services/face-provisioning.service.ts:224-278` (`deprovisionEndedMeetings`, `deprovisionMeeting`) — dùng `FACE_SYNC_GRACE_MINUTES` (cấu hình được, mặc định 5 phút) làm khoảng ân hạn; comment dòng 224-226 ghi chú rõ đã SỬA một lỗi cũ ("cửa sổ bỏ sót vĩnh viễn" khi họp trôi quá grace không bao giờ được quét lại) bằng cách chuyển sang lọc theo mapping thay vì theo khung giờ họp — khớp đúng Luồng thu hồi, còn thể hiện lịch sử vá lỗi kỹ càng hơn SRS mô tả.
- `src/modules/face-access/services/face-provisioning.service.ts:279-350` (`reconcile`) — phát hiện mapping "STALE" (đã đồng bộ nhưng họp đã kết thúc quá grace) — khớp đúng Luồng đối soát.

**Nhận xét:** Khớp rất sát với cấu trúc 3 luồng mà SRS mô tả, kể cả chi tiết kỹ thuật về grace period và cơ chế chống bỏ sót.

**Đề xuất sửa SRS:** Không cần.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Cấu hình AI cho camera** (`PATCH :id/ai-config`, nhãn nội bộ "IAC-001 (UC-96)") — một loại cấu hình thiết bị hoàn toàn mới, không thuộc Face Server hay RTSP.
2. **`GET /iot-devices/status-summary`** — dashboard tổng hợp trạng thái thiết bị.
3. **Endpoint callback dạng rút gọn** (`short-device-callbacks.controller.ts`, `stranger-short-device-callbacks.controller.ts`, `verify-short-device-callbacks.controller.ts`, pattern `:deviceCode/:callbackToken` trong URL) — các biến thể URL ngắn gọn hơn cho cùng logic xử lý heartbeat/verify/stranger, phục vụ thiết bị khó tùy biến header — không có trong SRS.
4. **Chấp nhận cả `GET` lẫn `POST`** cho 3 callback chính (`face/heartbeat`, `face/verify`, `face/stranger`) — CLAUDE.md mục 22.7a chỉ liệt kê `POST`.
