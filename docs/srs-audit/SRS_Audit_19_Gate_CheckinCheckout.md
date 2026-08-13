# Đánh giá SRS — Gate Check-in/Check-out

## Tổng quan

Số UC: 3 | Khớp hoàn toàn: 1 | Khớp 1 phần: 2 | Sai hoàn toàn: 0 | Không có code: 0

---

## UC-115 — Ghi nhận ra/vào khuôn viên

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** EX2: "Nếu khu vực cổng chưa được cấu hình vai trò rõ ràng... hệ thống **lưu sự kiện với chiều 'Chưa xác định'** và ghi log cảnh báo cấu hình" (không chặn ghi nhận).

**Code thực tế (bằng chứng):**
- Logic xác định chiều nằm ở `VehicleResolveService` (module `anpr`, không phải `gate-access`/`zones`) — `src/modules/anpr/services/vehicle-resolve.service.ts:41-133`. `Direction` có 3 giá trị `'enter' | 'leave' | 'seen'` (dòng 41); `gateDirection` được resolve ưu tiên từ `channel_direction_map` cấu hình sẵn, fallback về `eventAction` thô (dòng 118-126).
- Dòng 129-134: danh sách điều kiện **bỏ qua-không-ghi-gate-log** (`preSkip`) liệt kê `zone_unmapped → bad_utc → direction_seen → plate_too_long`; cụ thể dòng 133: `else if (gateDirection === 'seen') preSkip = 'direction_seen'`. Giá trị `preSkip` này được lưu vào field `gateLogSkipped` trong `payload_json` (dòng 162-164) của chính bản ghi sự kiện.
- **Đính chính sau khi đọc kỹ hơn dòng 190-256:** bản ghi sự kiện gốc (`INSERT INTO iot_device_events`, dòng 211-223) **luôn được ghi**, kể cả khi `preSkip` có giá trị — không hề bị mất. Chỉ riêng bước ghi tiếp sang bảng `gate_access_logs` (dòng 256: `if (preSkip || !zoneId || !eventId) return;`, nằm SAU đoạn insert `iot_device_events`) mới bị bỏ qua khi `preSkip` khác null. Vậy: sự kiện KHÔNG bị mất hoàn toàn — vẫn có 1 bản ghi trong `iot_device_events` (đọc được qua UC-112 "danh sách biển số lạ"/lịch sử), kèm cờ `gateLogSkipped='direction_seen'` để biết lý do — nhưng KHÔNG có bản ghi tương ứng nào trong `gate_access_logs` (bảng UC-115/116/117 thực sự dùng để tính ra/vào cổng).
- `GateAccessLogService` (`src/modules/zones/services/gate-access-log.service.ts:14-16`) xác nhận input đầu vào của nó đã "resolve sạch: direction chỉ enter/leave (đã loại seen)" — tầng `gate_access_logs` chỉ chấp nhận 2 giá trị, không có khái niệm "chưa xác định" nào tồn tại ở bảng này.

**Nhận xét:**
Luồng chính (xác định enter/leave dựa trên cấu hình cổng, ghi gate log, cập nhật trạng thái hiện diện phương tiện) hoạt động đúng tinh thần SRS. Nhánh ngoại lệ EX2 khớp **một phần**: sự kiện KHÔNG bị mất (vẫn lưu ở `iot_device_events` kèm lý do `direction_seen`, đúng tinh thần "không chặn ghi nhận" ở mức event gốc) — nhưng KHÔNG hề tạo ra bản ghi "chiều Chưa xác định" trong bảng `gate_access_logs` như SRS mô tả cụ thể; bảng này chỉ có 2 giá trị `enter`/`leave`, không có giá trị thứ 3 nào cho trường hợp không xác định.

**Đề xuất sửa SRS:**
> EX2: Nếu không xác định được chiều di chuyển (`eventAction`/`channel_direction_map` trả về `'seen'`), sự kiện gốc vẫn được lưu vào nhật ký thiết bị (`iot_device_events`, kèm cờ lý do `gateLogSkipped='direction_seen'`) — **nhưng hệ thống không tạo bản ghi nào trong `gate_access_logs`** cho sự kiện đó (bảng này chỉ có 2 giá trị chiều `enter`/`leave`, không có "chiều Chưa xác định" như bản mô tả hiện tại). Sự kiện coi như không tồn tại đối với việc điểm danh ra/vào cổng, dù vẫn tra cứu được ở nhật ký thiết bị gốc.

---

## UC-116 — Tính thời gian trong khuôn viên

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Ghép cặp Vào–Ra cho "phương tiện" nói chung (không phân biệt đã đăng ký hay chưa). EX2: bản ghi "Ra" không có "Vào" tương ứng trong ngày → ghép với phiên "Vào" gần nhất trong 24 giờ trước đó nếu có. EX1: phiên "Chưa hoàn tất" tự động đóng tại giờ đóng cửa quy định khi hết ngày làm việc.

**Code thực tế (bằng chứng):**
- `GateLogPairingService.pairBatch()` (`src/modules/zones/services/gate-log-pairing.service.ts:57-85`): quét các bản ghi `direction='leave'` chưa ghép — dòng 62 nêu rõ điều kiện lọc **`user_id NOT NULL`**, kèm comment tường minh: **"OQ-7: xe chưa đăng ký không ghép ở v1"**.
- Thuật toán ghép: với mỗi `leave`, tìm `enter` gần nhất trước đó trong cửa sổ `windowH` (mặc định 24h, cấu hình qua `GATE_PAIRING_WINDOW_HOURS`) — `ORDER BY access_time DESC` (dòng 148-156) — khớp đúng EX2 ("ghép với phiên Vào gần nhất trong 24 giờ trước đó").
- Ghi `paired_log_id` + `duration_seconds` vào CẢ HAI bản ghi (dòng 171-175) — khớp POST-1.
- Không tìm thấy cơ chế "tự động đóng phiên tại giờ đóng cửa quy định" (EX1) trong phạm vi đã đọc — các bản ghi "Vào" không tìm được "Ra" tương ứng dường như chỉ ở lại trạng thái chưa ghép vô thời hạn (cho tới khi 1 `leave` phù hợp xuất hiện), không có tiến trình chủ động đóng phiên khi hết ngày.

**Nhận xét:**
Thuật toán ghép cặp lõi (FIFO theo thời gian gần nhất, cửa sổ 24h) khớp SRS. Nhưng có 1 giới hạn phạm vi quan trọng SRS không hề nhắc tới: **chỉ ghép cặp cho phương tiện đã định danh được chủ xe** (`user_id` khớp qua đăng ký ANPR) — phương tiện lạ/chưa đăng ký (`user_id = NULL`) hoàn toàn không được đưa vào quy trình ghép cặp trong v1, dù vẫn có bản ghi ra/vào riêng lẻ trong `gate_access_logs`. Cơ chế tự động đóng phiên cuối ngày (EX1) chưa xác nhận được bằng chứng triển khai.

**Đề xuất sửa SRS:**
> BR bổ sung: Việc ghép cặp Vào–Ra (v1) **chỉ áp dụng cho phương tiện đã được đối chiếu thành công với một tài khoản nhân viên** (`user_id NOT NULL`) — phương tiện chưa đăng ký/không xác định chủ chỉ có bản ghi ra/vào rời rạc, không được tính thời gian trong khuôn viên. EX1 (tự động đóng phiên cuối ngày làm việc) hiện chưa xác nhận được trong code — cần đội BE xác nhận lại.

---

## UC-117 — Xem & tra cứu lịch sử ra vào cổng

**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi:** BR1: nhân viên chỉ xem lịch sử của mình; Admin/Manager tra cứu được người khác, lọc theo thời gian/cổng/phòng ban. Bước 5: xem chi tiết kèm ảnh chụp.

**Code thực tế (bằng chứng):**
- `GET gate-access/history` (own, chỉ `JwtAuthGuard`) và route admin tương ứng (permission `gate_access.history.read_all`) — `src/modules/gate-access/controllers/gate-access-history.controller.ts:22-50+`, comment gắn nhãn trực tiếp "GAH-001 / UC-117".
- `ListGateAccessHistoryAdminQueryDto` bổ sung `department_id`/`user_id` so với query của chính mình (`list-gate-access-history-admin-query.dto.ts:7,15-18`, comment "BR1 SRS: chỉ Admin/Manager tra cứu người khác") — khớp đúng BR1.
- `GateAccessHistoryDetailDto` có field `image_url` (`gate-access-history-detail-response.dto.ts:8-23`) — khớp bước 5 "xem thêm ảnh chụp".

**Nhận xét:** Không phát hiện sai lệch.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **2 tầng API song song cho cùng dữ liệu gate log**: tầng thấp `GateAccessLogService` (module `zones`, "GAL-001 / UC-107" nội bộ) trả log THÔ (từng dòng enter/leave riêng lẻ) phục vụ nhu cầu kỹ thuật/nội bộ, và tầng cao `GateAccessHistoryService` (module `gate-access`, chính là UC-117 SRS) trả **phiên đã ghép cặp** (thời lượng, trạng thái hoàn tất/chưa hoàn tất) phục vụ người dùng cuối — SRS chỉ mô tả 1 lớp duy nhất.
2. **Chống ghép trùng 2 lớp** (`FOR UPDATE SKIP LOCKED` + partial unique index `UQ_gate_logs_paired`, `gate-log-pairing.service.ts:28-31`) — cơ chế đồng thời/an toàn dữ liệu ở mức hạ tầng, không có trong SRS.
3. **Ghép-ngay khi ingest** (`pairForLeaveLog()`, gọi trực tiếp từ writer `UC-105` khi có bản ghi `leave` mới) song song với **ghép theo lô định kỳ** (`pairBatch()`, chạy qua cron `gate-log-pairing`) — 2 cơ chế trigger bổ sung cho nhau, SRS chỉ mô tả 1 cách kích hoạt ("có bản ghi mới, hoặc tiến trình định kỳ") mà không phân biệt rõ 2 luồng riêng biệt cùng tồn tại.
