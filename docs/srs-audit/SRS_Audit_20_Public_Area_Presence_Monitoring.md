# Đánh giá SRS — Public Area Presence Monitoring

## Tổng quan

Số UC: 4 | Khớp hoàn toàn: 1 | Khớp 1 phần: 3 | Sai hoàn toàn: 0 | Không có code: 0

**Ghi chú đính chính (sau khi đọc sâu thêm tầng service, không chỉ controller):** Đợt đọc đầu tiên chỉ xác nhận route/DTO/comment gắn nhãn UC khớp tên, dẫn tới đánh giá "4/4 khớp hoàn toàn" quá lạc quan. Sau khi đọc trực tiếp logic bên trong 3 service cốt lõi, phát hiện 3 điểm lệch cụ thể ở UC-119/120/121 — đã cập nhật lại bên dưới với bằng chứng dòng-theo-dòng.

---

## UC-118 — Ghi nhận hiện diện theo khu vực

**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**Code thực tế (bằng chứng):**
- Route: `POST internal/ivss/occupancy-events`, xác thực `IvssInternalTokenGuard` (header `X-Internal-Token`, không phải JWT) — `src/modules/ivss/controllers/ivss-occupancy.controller.ts:23-51`, comment gắn nhãn "IVSS-OCC-001 / A-OCC". Ack-always 200.
- `IvssOccupancyIngestService.ingest()` (`src/modules/ivss/services/ivss-occupancy-ingest.service.ts:50-91`): thứ tự xử lý đã đọc trực tiếp — (1) resolve bridge device, chưa seed → skip có log; (2) ghi raw `iot_device_events` (`event_type='ivss_occupancy_event'`) TRƯỚC khi biết zone có map hay không (dòng 63-80); (3) `resolveRoom()`/`resolveZone()` qua `system_configs['ivss.channel_room_map']`/`['ivss.channel_presence_zone_map']` RIÊNG BIỆT, không map → skip + log cảnh báo cấu hình, không cập nhật số liệu (khớp chính xác EX1: "ghi log cảnh báo cấu hình và không cập nhật số liệu hiện diện"); (4) có map → `ZonePresenceWriterService.writeCountEvent()` ghi `zone_presence_events`.

**Nhận xét:** Không phát hiện sai lệch — đã đọc trực tiếp toàn bộ luồng `ingest()`.

---

## UC-119 — Timeline & thời gian lưu lại theo khu vực

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** POST-2: "Nếu có định danh cá nhân liên kết (qua face mapping), **tổng thời gian lưu lại** của người đó tại khu vực được tính và hiển thị." BR1: "chỉ hiển thị được số liệu tổng theo khu vực (không theo cá nhân)" khi không có định danh.

**Code thực tế (bằng chứng):**
- `ZonePresenceTimelineService` (`src/modules/campus-dashboard/services/zone-presence-timeline.service.ts:19-89`) — docblock đầu class (dòng 19-29) khẳng định trực tiếp: **"Mô hình dữ liệu là NHẬT KÝ BẮT GẶP (sighting log): camera IVSS bắn `zone_presence_events` mỗi khi *thấy* một người trong khung hình... KHÔNG bắn khi người đó rời khung. Vì vậy service này KHÔNG THỂ (và không cố) ghép cặp 'vào/ra' để tính thời lượng lưu lại — nguồn dữ liệu không đủ thông tin cho việc đó."**
- `getTimeline()` (dòng 42-89): khi có `userId`, trả về `sightingCount` (**số lần bị camera "bắt gặp"**, dòng 87: `sightingCount: userId ? events.length : null`) — **không phải** một khoảng thời gian (duration/phút/giờ) như "tổng thời gian lưu lại" mà SRS yêu cầu. `personDataAvailable` chỉ là cờ boolean (có/không có dữ liệu định danh), không phải số liệu thời lượng.
- `NO_DATA_MESSAGE = 'Không có dữ liệu hiện diện trong khoảng thời gian này.'` (dòng 16-17, dùng ở dòng 76) — khớp chính xác EX1.

**Nhận xét:**
Phần Timeline chung (POST-1: xem biến động theo mốc thời gian, lọc theo zone+khoảng thời gian, EX1) khớp tốt. Nhưng **POST-2 — nội dung cốt lõi mà chính tên UC nhấn mạnh ("...và thời gian lưu lại")** — không thể thực hiện được về mặt kiến trúc dữ liệu: nguồn `zone_presence_events` chỉ là log "nhìn thấy" rời rạc (appear/disappear/count), không phải cặp vào-ra như `gate_access_logs` (Mục 19), nên không có cách nào tính "tổng thời gian lưu lại" — thứ trả về khi lọc theo 1 cá nhân chỉ là **số lần bị camera bắt gặp**, một đại lượng hoàn toàn khác.

**Đề xuất sửa SRS:**
> POST-2: Khi lọc theo 1 cá nhân cụ thể (`userId`), hệ thống trả về **số lần người đó được camera nhận diện/bắt gặp** (`sightingCount`) trong khoảng thời gian đã chọn tại khu vực — **không phải tổng thời gian lưu lại**. Nguồn dữ liệu `zone_presence_events` là nhật ký "bắt gặp" rời rạc (appear/disappear/count theo camera), không ghi nhận thời điểm rời đi tương ứng với từng người, nên về nguyên tắc không đủ thông tin để tính thời lượng hiện diện liên tục của 1 cá nhân tại khu vực công cộng (khác với `gate_access_logs` ở Mục 19, vốn có cặp enter/leave rõ ràng).

---

## UC-120 — Phân tích lưu lượng + heatmap khu vực

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** POST-2: "Bản đồ mặt bằng (sơ đồ tòa/tầng) hiển thị mức độ đông người bằng màu sắc..." EX1: "Nếu khu vực **chưa có** sơ đồ mặt bằng (layout) được thiết lập, hệ thống chỉ hiển thị dạng bảng/biểu đồ số liệu, không hiển thị heatmap trực quan **cho khu vực đó**" (ngụ ý: một số khu vực CÓ layout, một số thì chưa).

**Code thực tế (bằng chứng):**
- `ZoneTrafficHeatmapService.getTraffic()` (`src/modules/campus-dashboard/services/zone-traffic-heatmap.service.ts:69-83`): mọi khu vực đều trả `coordinates: null` (dòng 81, comment **"BLOCKED — kế thừa UC-126 §2.1"**).
- `ZoneHeatmapDto.coordinates` (`src/modules/campus-dashboard/dto/zone-traffic-response.dto.ts:17-18`): comment xác nhận trực tiếp **"BLOCKED (kế thừa UC-126 §2.1): LUÔN `null` cho tới khi `zones` có cột tọa độ thật."**
- `ZoneEntity` (`src/modules/zones/entities/zone.entity.ts`): grep `coordinate|layout|position` → **0 kết quả** — bảng `zones` trong DB **hoàn toàn không có cột lưu tọa độ/sơ đồ mặt bằng nào**.
- Unit test tự xác nhận hành vi này là chủ đích, không phải bug: `zone-traffic-heatmap.service.spec.ts:85` — `expect(z1.coordinates).toBeNull()`.

**Nhận xét:**
Phần thống kê số liệu (avg/peak occupancy theo giờ, theo khu vực — POST-1) khớp tốt, có tính `relativeDensity` phục vụ tô màu heatmap. Nhưng khác với khung EX1 của SRS (ngụ ý CHỈ MỘT SỐ khu vực thiếu layout), thực tế là **KHÔNG khu vực nào từng có tọa độ** — bảng `zones` chưa từng có cột lưu vị trí, đây là giới hạn toàn cục ở tầng schema, không phải tình trạng dữ liệu thiếu-cho-từng-khu-vực-riêng-lẻ. Vì vậy phần "sơ đồ mặt bằng tô màu" của POST-2 hiện **không thể hiển thị cho bất kỳ khu vực nào**, không chỉ những khu vực "chưa cấu hình layout" như SRS ngụ ý.

**Đề xuất sửa SRS:**
> EX1/POST-2: Trường `coordinates` **luôn trả về `null` cho MỌI khu vực** ở phiên bản hiện tại — bảng `zones` chưa có cột lưu tọa độ/vị trí trong mặt bằng. BE chỉ cung cấp số liệu tổng hợp dạng bảng/biểu đồ (avg/peak occupancy theo giờ và theo khu vực, `relativeDensity` để tô màu tương đối); phần vẽ sơ đồ mặt bằng trực quan **hiện chưa khả thi cho bất kỳ khu vực nào**, không phải tính năng "áp dụng có điều kiện tùy khu vực" như mô tả hiện tại — cần bổ sung cột tọa độ vào schema `zones` trước khi có thể triển khai.

---

## UC-121 — Cảnh báo tụ tập đông người

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** EX1: "Nếu khu vực vẫn duy trì tình trạng vượt ngưỡng trong các sự kiện liên tiếp, hệ thống không tạo cảnh báo mới lặp lại... cho đến khi **số người giảm xuống dưới ngưỡng rồi vượt lại** (khi đó mới sinh cảnh báo mới)."

**Code thực tế (bằng chứng):**
- `CrowdAlertService` (`src/modules/crowd-alert/services/crowd-alert.service.ts:46-53`, comment gắn nhãn "ACR-001 (UC-121)") — dòng 52-53 tự xác nhận tường minh: **"Dedup dùng NGUYÊN `recordAlert()` có sẵn (UC-123) — deviation so với chữ SRS EX1 đã chốt + ghi rõ trong spec §2.2, KHÔNG tự chế state-tracking riêng ở đây."**
- `AlertsService.recordAlert()` (`src/modules/alerts/services/alerts.service.ts:85-112`): khi 1 alert cùng `alertType`+`zoneId` đã tồn tại và **status khác `'resolved'`** (`findOpenAlert()`, dòng 139-149: `status: Not('resolved')`), hệ thống gọi `bumpOccurrence()` (cập nhật `occurrenceCount`, thêm vào lịch sử `payload_json.occurrences`) thay vì tạo alert mới.
- Cron `crowd-alert` mỗi phút, gate mặc định **OFF** (`SCHEDULER_CROWD_ALERT_ENABLED`).

**Nhận xét:**
Kết quả bề ngoài (không spam alert khi vẫn đang vượt ngưỡng liên tục) trông giống SRS, nhưng **cơ chế thật khác về bản chất** — chính code tự thừa nhận đây là "deviation": SRS gắn điều kiện dedup vào **giá trị đo được** (số người phải giảm dưới ngưỡng rồi vượt lại mới tính là lần vi phạm mới), còn code gắn điều kiện dedup vào **trạng thái xử lý của chính cảnh báo** (`status != 'resolved'`). Hệ quả khác biệt cụ thể: nếu Admin bấm "Đã xử lý" (`resolve`) cho 1 cảnh báo tụ tập trong khi khu vực **trên thực tế vẫn đang đông vượt ngưỡng** (chưa hề giảm xuống), lần quét tiếp theo của cron sẽ **tạo alert MỚI ngay** (vì `findOpenAlert()` không còn thấy alert nào `status != 'resolved'`) — khác với kỳ vọng của SRS rằng việc sinh cảnh báo mới chỉ nên gắn với biến động thật của số người, không phụ thuộc hành động quản trị.

**Đề xuất sửa SRS:**
> EX1: Cơ chế chống lặp cảnh báo dựa trên **trạng thái xử lý** của cảnh báo hiện có (`status != 'resolved'`), KHÔNG dựa trên việc số người có giảm xuống dưới ngưỡng hay không — đây là quyết định thiết kế có chủ đích (tái dùng cơ chế dedup chung `recordAlert()` của Trung tâm cảnh báo, Mục 21 UC-123) thay vì tự xây state machine riêng theo dõi ngưỡng. Nếu Admin đánh dấu "Đã xử lý" trong khi khu vực trên thực tế vẫn đang vượt ngưỡng, lần quét tiếp theo sẽ tạo một cảnh báo mới ngay, bất kể số người đã từng giảm xuống dưới ngưỡng hay chưa.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Toàn bộ luồng cảnh báo tụ tập bị tắt mặc định qua feature flag** (`SCHEDULER_CROWD_ALERT_ENABLED` mặc định `false`) — SRS không đề cập tính năng này cần bật thủ công qua cấu hình môi trường trước khi hoạt động.
2. **Chụp ảnh chủ động khi vượt ngưỡng** (`crowd-alert.service.ts:19-35`, gọi bridge chụp ảnh best-effort, timeout 6.5s, lưu vào `crowd-alert-snapshots`) — một tính năng bổ sung (2026-08-09) hoàn toàn không có trong SRS UC-121.
3. **Giới hạn khoảng thời gian truy vấn 31 ngày** (`MAX_RANGE_MS`, dùng chung cho cả UC-119 và UC-120) — không có trong SRS.
