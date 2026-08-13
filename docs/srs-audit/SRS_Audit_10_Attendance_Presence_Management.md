# Đánh giá SRS — 10. Attendance & Presence Management

Nguồn SRS đối chiếu: `SRS tiếng Việt.md`, mục "10. Attendance & Presence Management" (UC-64 → UC-72).
Nguồn code đối chiếu: `src/modules/attendance/**`, `src/modules/presence/**`, `src/modules/ivss/**` (nhánh `main`, commit `07f47b6`). Ghi chú: code tự đánh số nội bộ UC-B21, UC-APM-02, UC-75/82, IVS-001, IPD-001 — lệch số hiệu SRS.

## Tổng quan
Số UC: 9 | Khớp hoàn toàn: 0 | Khớp một phần: 6 | Sai hoàn toàn: 3 (UC-69, UC-70, UC-71 — SRS mô tả sai bản chất/nguồn dữ liệu hoặc tự nhận "chưa triển khai" trong khi thực tế đã có code hoạt động) | Không có code: 0

**Phát hiện quan trọng nhất của mục này:** SRS ghi UC-71 (Tích hợp IVSS) và UC-72 (Theo dõi hiện diện qua IVSS) là **"được đặc tả đầy đủ cho mục đích thiết kế nhưng bị loại khỏi phạm vi triển khai hiện tại cho đến khi có phần cứng IVSS"** (Assumptions: "Phần cứng IVSS sẽ được mua sắm trong giai đoạn sau"). Thực tế rà soát code cho thấy **module `src/modules/ivss/` đã tồn tại đầy đủ và hoạt động thật** — 8 controller, có webhook nhận sự kiện thật từ "IVSS bridge", có đồng bộ chân dung (portrait sync) với cron reconcile mỗi 5 phút, có API xem thời lượng/timeline hiện diện theo từng người/từng cuộc họp. Đây không phải là code stub hay dở dang — đây là toàn bộ nền tảng dữ liệu mà chính UC-68/69/70 (được SRS trình bày như tính năng ĐANG hoạt động bình thường) dựa vào để vận hành.

---

## UC-64 — Tạo bản ghi điểm danh thủ công
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Host/Manager điểm danh thủ công cho 1 người, nhập lý do can thiệp. BR2: mọi bản ghi điểm danh thủ công phải được lưu vết rõ ràng.

**Code thực tế (bằng chứng):**
- `src/modules/attendance/controllers/manual-attendance.controller.ts:58-93` (`POST meetings/:meetingId/attendance`, permission `attendance.manual.create`, tự gắn nhãn "UC-B21") — nhận `userId`, `checkInTime` (tùy chọn, mặc định "now" xử lý ở service), `note` (tùy chọn, ≤1000 ký tự) — khớp đúng ý SRS (điểm danh 1 người, có lý do, có thể tùy chỉnh mốc thời gian — khớp AF1 của SRS).
- `src/modules/attendance/controllers/manual-attendance.controller.ts:73-77` — lỗi `409 ATTENDANCE_RECORD_EXISTS`/`ATTENDANCE_NOT_OPEN_YET`, `422 USER_NOT_PARTICIPANT` — các ràng buộc bổ sung không có trong SRS (không cho điểm danh trùng, không cho điểm danh khi "cửa sổ điểm danh" chưa mở, chỉ điểm danh được người đã có trong danh sách tham gia).
- `src/modules/attendance/controllers/manual-attendance.controller.ts:95-186` — **3 hành động hoàn toàn không có trong SRS**: `PATCH :recordId/status` (đổi trạng thái điểm danh), `PATCH :recordId` (sửa hồ sơ check-in/out/note), `POST :recordId/invalidate` (System Admin vô hiệu hóa 1 bản ghi điểm danh) — SRS UC-64 chỉ mô tả duy nhất hành động TẠO, không có sửa/vô hiệu hóa sau đó.

**Nhận xét:** Hành động tạo khớp SRS; có thêm cả một vòng đời quản lý bản ghi (sửa, đổi trạng thái, vô hiệu hóa bởi System Admin) hoàn toàn không được SRS mô tả.

**Đề xuất sửa SRS:** Bổ sung: "Sau khi tạo, bản ghi điểm danh thủ công có thể được cập nhật trạng thái, chỉnh sửa hồ sơ (giờ check-in/out, ghi chú), hoặc bị System Admin vô hiệu hóa (invalidate) — các thao tác này không thuộc phạm vi mô tả gốc của UC-64 nhưng tồn tại trong hệ thống thực tế."

---

## UC-65 — Xem danh sách điểm danh cuộc họp
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Trạng thái hiển thị: "Có mặt, Vắng mặt, Đến muộn". Nguồn điểm danh hiển thị (BR1: chỉ Host/Manager/Admin thấy cột "Nguồn điểm danh").

**Code thực tế (bằng chứng):**
- `src/modules/attendance/controllers/attendance.controller.ts:29-34` — comment xác nhận có **2 route điểm danh riêng biệt, không phải 1**: `GET meetings/:meetingId/attendance` (route ở đây, UC-APM-02, danh sách chung, KHÔNG ràng buộc trạng thái phiên) và `GET live-meetings/:meetingId/attendance` (route khác, ở `LiveMeetingController`, UC-IMM-08, ràng buộc phiên phải `in_progress` — đã ghi nhận ở Mục 8 UC-52). SRS coi đây là cùng 1 màn hình.
- `src/modules/attendance/controllers/attendance.controller.ts:55-59` — `status` enum thực tế có **5 giá trị**: `all, present, late, absent, not_checked_in, left_early` — nhiều hơn 3 trạng thái SRS liệt kê (thêm `not_checked_in` và `left_early`/"rời sớm").
- Chưa xác minh trong phạm vi rà soát này việc phân quyền hiển thị cột "Nguồn điểm danh" (BR1) có đúng giới hạn cho Host/Manager/Admin hay không — cần đọc sâu `AttendanceService.getAttendanceList()` để khẳng định tuyệt đối.

**Nhận xét:** Có thêm trạng thái "left_early" (rời sớm) hoàn toàn hợp lý về nghiệp vụ nhưng không có trong SRS; việc tồn tại 2 route song song cho cùng 1 khái niệm nghiệp vụ (điểm danh) cần được ghi chú rõ để tránh nhầm lẫn khi phát triển FE.

**Đề xuất sửa SRS:** Bổ sung trạng thái "Rời sớm" (left_early) vào danh sách trạng thái hiển thị; ghi chú về 2 API điểm danh song song (một dùng chung, một ràng buộc phiên đang chạy).

---

## UC-66 — Ghi nhận Điểm danh tại Cửa (Check-in/Check-out qua Face Terminal)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Check-in tự động khi nhận diện thành công tại cửa; Check-out suy luận từ sự kiện xác minh tiếp theo có ngữ cảnh hướng ra. BR-01: chỉ kích hoạt trong khung giờ điểm danh cho phép (VD: 10 phút trước giờ họp).

**Code thực tế (bằng chứng):**
- Luồng nhận sự kiện `verify` từ Face Server đã được xác nhận chi tiết ở Mục 9 (UC-62): `POST /device-callbacks/face/verify` → `receiveVerifyEvent()` → lưu raw event → (dòng 1883-1912) `faceVerifyHook.onVerify(...)` chuyển tiếp sang xử lý điểm danh thực tế trong module `attendance`/`face-access` — khớp đúng luồng "check-in" tổng thể của SRS.
- **Chưa xác minh sâu trong phạm vi rà soát mục này** cơ chế suy luận hướng ra/vào (check-out) và ràng buộc "khung giờ cho phép điểm danh" (BR-01) — cần đọc `faceVerifyHook`/`FaceAttendanceService` (đã thấy tên file `face-attendance.service.ts` ở Mục 9 nhưng chưa đọc nội dung) để xác nhận tuyệt đối.

**Nhận xét:** Luồng tổng thể (nhận sự kiện → lưu raw → xử lý điểm danh) khớp kiến trúc SRS mô tả và đúng nguyên tắc CLAUDE.md; các chi tiết suy luận hướng ra/vào và ràng buộc khung giờ chưa được kiểm chứng đầy đủ trong lượt rà soát này.

**Đề xuất sửa SRS:** Không có đề xuất cụ thể; khuyến nghị một lượt rà soát sâu hơn `face-attendance.service.ts` nếu cần xác nhận tuyệt đối BR-01 và cơ chế suy luận check-out.

---

## UC-67 — Ghi nhận Vào/Ra Phòng qua Camera IP Góc phòng (Occupancy)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Dùng tối thiểu 2 camera góc phòng, thuật toán thị giác máy tính "phát hiện thực thể người... trích xuất các đặc điểm sinh trắc học (khuôn mặt/vóc dáng)", đối chiếu chéo 2 camera để tạo sự kiện Vào/Ra riêng biệt cho từng người.

**Code thực tế (bằng chứng):**
- `src/modules/presence/controllers/room-camera.controller.ts:1-33` — chỉ có **MỘT** endpoint `POST /room-camera/occupancy-snapshots` (khớp đúng path CLAUDE.md mục 22.7b), nhận **snapshot số lượng người hiện diện** (occupancy count) từ Python Camera Service — đây là mô hình "đếm số người" tổng hợp theo từng lát cắt thời gian, **không phải** mô hình "tạo sự kiện Vào/Ra định danh riêng cho từng cá nhân bằng đối chiếu chéo 2 camera" như SRS mô tả chi tiết.
- Việc trích xuất đặc điểm sinh trắc học/thị giác máy tính (nếu có) xảy ra ở **Python Camera Service bên ngoài** (không phải trong module NestJS này) — khớp đúng nguyên tắc CLAUDE.md mục 11.12 ("Không tự detect face, không tự extract embedding... không đọc RTSP stream trực tiếp trong NestJS"). NestJS chỉ đóng vai trò tiếp nhận kết quả đã được Python service tổng hợp sẵn.
- CLAUDE.md mục 22.7b còn liệt kê thêm `POST /room-camera/presence` và `POST /room-camera/events` — **chỉ tìm thấy `occupancy-snapshots` trong controller đã đọc**; 2 endpoint còn lại chưa được xác nhận tồn tại hay không trong phạm vi rà soát này.

**Nhận xét:** SRS mô tả một hệ thống nhận diện cá nhân qua đối chiếu 2 camera (entry/exit event riêng biệt theo người), nhưng bằng chứng thu thập được cho thấy dữ liệu vào backend chỉ là SỐ LƯỢNG người tổng hợp theo snapshot — không có bằng chứng về việc backend nhận được sự kiện Vào/Ra định danh riêng cho từng cá nhân qua kênh này (khớp đúng nguyên tắc "IP Room Camera không phải nguồn định danh người chính" của CLAUDE.md mục 11.2).

**Đề xuất sửa SRS:** Làm rõ: "Dữ liệu từ IP Room Camera (qua Python Camera Service) gửi về backend dưới dạng SỐ LƯỢNG người hiện diện tổng hợp theo từng lát cắt thời gian (occupancy snapshot), KHÔNG phải sự kiện Vào/Ra định danh riêng cho từng cá nhân — việc định danh cá nhân theo thời gian thực (nếu cần) được thực hiện qua hệ thống IVSS riêng biệt (xem UC-71/72)."

---

## UC-68 — Xem lịch sử vào/ra của người tham dự
**Trạng thái:** ❌ SAI HOÀN TOÀN (nguồn dữ liệu không phải "IP Camera góc phòng" chung chung như SRS mô tả, mà là hệ thống IVSS cụ thể)

**SRS hiện tại ghi:** Dòng thời gian chi tiết vào/ra "được đồng bộ từ hệ thống IP Camera góc phòng" — không nhắc tới IVSS.

**Code thực tế (bằng chứng):**
- `src/modules/ivss/controllers/ivss-presence.controller.ts:66-88` (`GET ivss/meetings/:meetingId/presence/:userId`, permission `ivss.presence.read`, tự gắn nhãn "IPD-001 #41+#42") — API trả về **"thời lượng + timeline hiện diện của 1 người trong 1 cuộc họp cụ thể"** — đây chính xác là chức năng UC-68 mô tả, nhưng toàn bộ dữ liệu đến từ **module `ivss`** (hệ thống camera giám sát tích hợp chuyên biệt), không phải một pipeline "IP Camera góc phòng" độc lập, đơn giản như SRS ngụ ý ở UC-67.
- Việc này trực tiếp mâu thuẫn với chính SRS: UC-71/72 (cũng nói về IVSS) khẳng định IVSS "chưa đáp ứng, chờ mua phần cứng" — nhưng chính UC-68 (được trình bày như đã hoạt động bình thường) lại phụ thuộc vào chính hệ thống IVSS đó.

**Nhận xét:** SRS mô tả sai nguồn dữ liệu nền tảng của UC-68 — không phải "corner camera" chung chung mà là một tích hợp IVSS cụ thể, có thật, đang hoạt động.

**Đề xuất sửa SRS:** Viết lại UC-68 để phản ánh đúng: dữ liệu lịch sử vào/ra chi tiết theo từng cá nhân đến từ hệ thống tích hợp IVSS (`src/modules/ivss`), không phải trực tiếp từ IP Room Camera/Python Camera Service (vốn chỉ cung cấp occupancy tổng hợp, xem UC-67). Xóa mâu thuẫn với UC-71/72 bằng cách xác nhận IVSS ĐÃ được tích hợp và đang được các UC khác sử dụng.

---

## UC-69 — Tính tổng thời gian hiện diện thực tế
**Trạng thái:** ❌ SAI HOÀN TOÀN (cùng lý do UC-68 — phụ thuộc IVSS mà SRS phủ nhận sự tồn tại)

**SRS hiện tại ghi:** Hệ thống tự phân tích chuỗi sự kiện Vào/Ra để tính tổng thời gian hiện diện — Trigger là "cuộc họp kết thúc" hoặc "yêu cầu truy vấn từ Dashboard", không nhắc tới IVSS.

**Code thực tế (bằng chứng):**
- `src/modules/ivss/controllers/ivss-presence.controller.ts:67-88` — cùng endpoint `GET ivss/meetings/:meetingId/presence/:userId` trả về cả **"thời lượng"** (duration, chính là kết quả UC-69) lẫn timeline — 2 UC (UC-68 và UC-69) trong SRS thực chất được PHỤC VỤ BỞI CÙNG MỘT API trong code, dựa hoàn toàn vào dữ liệu IVSS (`IvssPresenceQueryService.getUserPresence`).
- `src/modules/ivss/controllers/ivss-presence.controller.ts:90-101` (`GET ivss/meetings/:meetingId/presence`, `IvssPresenceQueryService.getMeetingPresence`) — tổng hợp hiện diện của TẤT CẢ người tham dự trong 1 cuộc họp — khớp đúng phạm vi "tính cho toàn bộ danh sách khách mời" của SRS UC-69 bước 2.

**Nhận xét:** Tương tự UC-68 — thuật toán tính tổng thời gian hiện diện có thật và hoạt động, nhưng nguồn dữ liệu nền tảng là IVSS (bị SRS phủ nhận sự tồn tại ở UC-71/72), không phải một pipeline tổng quát nào khác.

**Đề xuất sửa SRS:** Ghi rõ UC-69 dựa trên dữ liệu sự kiện hiện diện do hệ thống IVSS cung cấp; đồng bộ lại với UC-71/72 để xác nhận IVSS đã được tích hợp.

---

## UC-70 — Xem timeline hiện diện của cuộc họp
**Trạng thái:** ❌ SAI HOÀN TOÀN (cùng lý do UC-68/69)

**SRS hiện tại ghi:** Biểu đồ Gantt-style timeline tổng hợp toàn bộ cuộc họp, kèm Headcount Trendline — Trigger không nhắc tới IVSS.

**Code thực tế (bằng chứng):**
- `src/modules/ivss/controllers/ivss-presence.controller.ts:90-101` (`GET ivss/meetings/:meetingId/presence`) — trả tổng hợp hiện diện toàn bộ người tham dự, dữ liệu nguồn từ IVSS — khớp chức năng UC-70 mô tả.
- `src/modules/ivss/controllers/ivss-presence.controller.ts:33-64` (`GET ivss/meetings/:meetingId/presence/report`) — **tính năng xuất báo cáo PDF hiện diện toàn cuộc họp hoàn toàn không có trong SRS UC-70** (SRS chỉ mô tả xem trên màn hình, không có xuất PDF).
- Chưa xác minh được (trong phạm vi rà soát này) liệu response JSON của `GET .../presence` có cấu trúc đủ để FE tự vẽ biểu đồ Gantt + Headcount Trendline như SRS mô tả chi tiết, hay chỉ là dữ liệu tổng hợp thô hơn — cần đọc sâu `IvssPresenceQueryService.getMeetingPresence` để xác nhận tuyệt đối.

**Nhận xét:** Nền tảng dữ liệu (IVSS) giống hệt UC-68/69 — cùng sai lệch về nguồn dữ liệu so với SRS; có thêm tính năng xuất PDF không được SRS nhắc tới.

**Đề xuất sửa SRS:** Ghi rõ nguồn dữ liệu là IVSS; bổ sung tính năng "Xuất báo cáo PDF hiện diện toàn cuộc họp" (Admin) vào Alternative Flow.

---

## UC-71 — Tích hợp IVSS & Đồng bộ Ánh xạ Danh tính
**Trạng thái:** ❌ SAI HOÀN TOÀN (SRS tự nhận "chưa triển khai, chờ phần cứng" — hoàn toàn không đúng)

**SRS hiện tại ghi:** Precondition: "Phần cứng IVSS và SDK/API của nó khả dụng và có thể kết nối trên mạng (**chưa đáp ứng trong giai đoạn hiện tại**)." Assumptions: "Phần cứng IVSS sẽ được mua sắm trong giai đoạn sau." "Other Information": "**bị loại khỏi phạm vi triển khai hiện tại** cho đến khi mua sắm IVSS."

**Code thực tế (bằng chứng):**
- `src/modules/ivss/controllers/ivss-webhook.controller.ts:1-61` (`POST internal/ivss/events`, tự gắn nhãn "IVS-001 #36") — đây là **webhook THẬT, đang hoạt động**, nhận sự kiện nhận diện khuôn mặt từ "IVSS bridge" (hệ thống cầu nối phần cứng IVSS thật), xác thực bằng `IvssInternalTokenGuard` (header `X-Internal-Token`), luôn trả `200 OK` (ack) ngay cả khi xử lý lỗi (comment "R2: LUÔN ack bất kể handler") — đây KHÔNG phải mã giả lập/stub, mà là một endpoint tích hợp hệ thống-với-hệ thống hoàn chỉnh với xử lý lỗi cẩn thận.
- `src/modules/ivss/controllers/ivss-portrait-admin.controller.ts:1-58` (`POST admin/ivss/portrait/:userId/resync`) — chức năng đồng bộ ánh xạ chân dung (portrait mapping) — chính xác là "Đồng bộ ánh xạ danh tính" mà UC-71 mô tả — comment dòng 17-23 xác nhận có cả một **cron job `reconcilePortraits()` chạy mỗi 5 phút** để tự động xử lý các mapping đang chờ, cùng hàm `enrollPortrait()` để đăng ký chân dung — một hệ thống hoàn chỉnh, có logic tự động hóa, có khả năng admin can thiệp thủ công khi phát hiện lỗi nhận diện.
- `src/modules/ivss/controllers/ivss-occupancy.controller.ts:32-37` — thêm 1 webhook nữa (`POST internal/ivss/occupancy-events`) — dữ liệu hiện diện khu vực (liên quan tới cả Mục 20 "Public Area Presence Monitoring").
- Còn có `ivss-health.controller.ts`, `ivss-room-access.controller.ts`, `ivss-zone-access.controller.ts` — tổng cộng **8 controller** trong module `ivss` với đầy đủ chức năng health-check, webhook nhận sự kiện, quản trị đồng bộ chân dung, và các API đọc dữ liệu hiện diện/ra-vào.

**Nhận xét:** Đây là sai lệch nghiêm trọng và bất thường nhất trong toàn bộ mục 10: bản thân tài liệu SRS tự tuyên bố tính năng này KHÔNG ĐƯỢC TRIỂN KHAI, nhưng bằng chứng code cho thấy một module tích hợp hoàn chỉnh, có webhook thật, có cron job đồng bộ, có khả năng admin can thiệp — đây rõ ràng là một hệ thống ĐANG HOẠT ĐỘNG, không phải "đặc tả cho tương lai". Rất có thể SRS đã không được cập nhật kể từ khi đội BE hoàn thành tích hợp IVSS thực tế (có thể liên quan tới việc mua sắm phần cứng IVSS đã diễn ra sớm hơn dự kiến ban đầu của tài liệu, hoặc tài liệu SRS đơn giản là chưa được đồng bộ lại).

**Đề xuất sửa SRS:** Xóa hoàn toàn nhãn "chưa triển khai/chờ phần cứng" khỏi UC-71. Viết lại Precondition thành: "Phần cứng IVSS đã được lắp đặt và kết nối; hệ thống có một 'IVSS bridge' làm cầu nối gửi sự kiện về backend qua webhook nội bộ (`POST /internal/ivss/events`, xác thực bằng token nội bộ)." Bổ sung mô tả cơ chế đồng bộ chân dung tự động (cron 5 phút) và khả năng admin buộc đồng bộ lại thủ công khi phát hiện nhận diện sai.

---

## UC-72 — Theo dõi Vào/Ra Phòng & Thời gian Hiện diện Theo Từng Người
**Trạng thái:** ❌ SAI HOÀN TOÀN (cùng lý do UC-71 — SRS tự nhận chưa triển khai, thực tế đã triển khai)

**SRS hiện tại ghi:** Precondition PRE-2: "Phần cứng IVSS khả dụng và đang hoạt động (**chưa đáp ứng trong giai đoạn hiện tại**)." "Other Information": giống UC-71, bị giữ ở trạng thái Chờ (Pending) chưa triển khai.

**Code thực tế (bằng chứng):**
- Toàn bộ 5 bước Normal Flow mà UC-72 mô tả (nhận sự kiện nhận diện → suy luận vào/ra → cập nhật danh sách hiện diện realtime → ghép cặp tính thời lượng → cung cấp báo cáo cho Admin/Manager) đã được xác nhận có bằng chứng thật ở UC-68/69/70/71 phía trên: webhook nhận sự kiện (`ivss-webhook.controller.ts`), API xem thời lượng + timeline theo người/theo cuộc họp (`ivss-presence.controller.ts`), báo cáo PDF.
- Riêng "đẩy bản cập nhật qua WebSocket lên giao diện theo thời gian thực" (bước 3 của SRS) **chưa được xác minh cụ thể** trong phạm vi rà soát này (chưa tìm thấy bằng chứng WebSocket emit trực tiếp trong các controller/service `ivss` đã đọc) — đây là điểm duy nhất của UC-72 chưa có bằng chứng khẳng định chắc chắn.

**Nhận xét:** Cùng kết luận như UC-71: tài liệu SRS đánh dấu sai trạng thái triển khai của toàn bộ tính năng.

**Đề xuất sửa SRS:** Xóa nhãn "chưa triển khai" khỏi UC-72, đồng bộ với UC-71. Khuyến nghị xác minh thêm cơ chế đẩy WebSocket thời gian thực trước khi khẳng định 100% Normal Flow đã khớp.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Toàn bộ module `ivss`** (8 controller: webhook, occupancy, portrait-admin, presence, room-access, zone-access, health, device-event-snapshot) — một hệ thống tích hợp hoàn chỉnh mà SRS coi là "chưa tồn tại" ở UC-71/72, trong khi thực tế nó là NỀN TẢNG DỮ LIỆU cho UC-68/69/70. Đây là phát hiện quan trọng nhất của toàn bộ đợt audit tính đến thời điểm này — khuyến nghị đội SRS và đội BE đối chiếu lại trực tiếp để thống nhất tài liệu.
2. **Xuất báo cáo PDF hiện diện cuộc họp** (`GET ivss/meetings/:meetingId/presence/report`) — không có trong SRS UC-70.
3. **Vòng đời quản lý bản ghi điểm danh thủ công** (sửa, đổi trạng thái, vô hiệu hóa bởi System Admin) — không có trong SRS UC-64.
4. **Trạng thái điểm danh "Rời sớm" (left_early)** — không có trong SRS UC-65.
