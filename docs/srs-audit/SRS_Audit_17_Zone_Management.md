# Đánh giá SRS — Zone Management

## Tổng quan

Số UC: 4 | Khớp hoàn toàn: 1 | Khớp 1 phần: 2 | Sai hoàn toàn: 1 | Không có code: 0

Ghi chú: CLAUDE.md (mục "Entity đã tồn tại") mô tả module `zones` là "hiện schema-only, nghiệp vụ bổ sung theo UC-90→94" — thông tin này **đã lỗi thời**: `src/modules/zones/` có đầy đủ controller/service/DTO CRUD hoàn chỉnh (7 route), gắn nhãn nội bộ đúng theo tài liệu SAVP riêng (UC-90→94, khác đánh số UC-104→107 của SRS đang audit — 2 hệ đánh số song song, không phải sai lệch).

---

## UC-104 — Tạo khu vực

**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi:** Bắt buộc Mã/Tên/Loại (EX1); Mã trùng bị từ chối (EX2); Loại chỉ trong tập cố định room/gate/corridor/lobby/parking (BR2); Tòa nhà/Tầng không bắt buộc.

**Code thực tế (bằng chứng):**
- Route: `POST zones`, permission `zones.zone.create` — `src/modules/zones/controllers/zones.controller.ts:85-101`.
- `CreateZoneDto` (`src/modules/zones/dto/create-zone.dto.ts:25-63`): `zoneCode`/`zoneName`/`zoneType` bắt buộc (`@IsNotEmpty`/không có `@IsOptional`, dòng 26-41 — comment dòng 38 "OQ-4: required — CỐ Ý KHÔNG có `@IsOptional`"); `building`/`floor`/`description`/`metadataJson` đều optional (dòng 44-62) — khớp đúng EX1.
- `ZONE_TYPES = ['room','gate','corridor','lobby','parking']` (`zone-type.constant.ts:11-17`), enforce qua `@IsIn` — khớp chính xác BR2 (không thể tạo loại tùy ý qua API).
- `zones.service.ts create()` (dòng 111-...): kiểm tra `zoneCode` trùng (`ZONE_CODE_EXISTS`, dòng 118-121) trước khi tạo — khớp EX2.

**Nhận xét:** Không phát hiện sai lệch.

---

## UC-105 — Cập nhật khu vực

**Trạng thái:** ❌ SAI HOÀN TOÀN

**SRS hiện tại ghi:** BR1: "Mã khu vực (`zone_id`) **không được phép chỉnh sửa** sau khi khởi tạo, để đảm bảo tính toàn vẹn tham chiếu." EX2: nếu đổi Loại khu vực trong khi đang có thiết bị/sự kiện liên kết, hệ thống phải hiển thị cảnh báo và **yêu cầu xác nhận rõ ràng** trước khi cho phép.

**Code thực tế (bằng chứng):**
- `UpdateZoneDto` (`src/modules/zones/dto/update-zone.dto.ts:45-51`): field `zoneCode` là **field có thể sửa** (`@SkipWhenAbsent()` — chỉ bỏ qua khi client không gửi, không có bất kỳ cơ chế chặn nào nếu client CÓ gửi).
- `update()` (`zones.service.ts:194-276`): dòng 205-207 chuẩn hóa `zoneCode` mới nếu được gửi; dòng 219-233 chỉ kiểm tra **trùng lặp** với zone khác (`ZONE_CODE_EXISTS`) — **hoàn toàn không có bất kỳ điều kiện chặn "đổi mã sau khi tạo"** nào. `zoneCode` được ghi đè trực tiếp vào entity (dòng 250) và lưu.
- Đổi `zoneType`: cùng logic no-op-diff chung (dòng 235-251) — **không có bất kỳ bước kiểm tra thiết bị/sự kiện đang liên kết, không có cảnh báo, không yêu cầu xác nhận** — đổi `zoneType` được xử lý y hệt như đổi bất kỳ field nào khác, áp dụng ngay lập tức.

**Nhận xét:**
Đây không phải một chi tiết nhỏ bị thiếu — chính BUSINESS RULE TRUNG TÂM của UC-105 (BR1: bất biến của mã khu vực) bị **đảo ngược hoàn toàn**: SRS khẳng định "không được phép chỉnh sửa", code cho phép sửa tự do (chỉ chặn trùng lặp, không chặn thay đổi). Đồng thời cơ chế cảnh báo bắt buộc của EX2 hoàn toàn không tồn tại.

**Đề xuất sửa SRS:**
> BR1: Loại bỏ ràng buộc bất biến — `zone_code` **có thể được sửa** qua `PATCH /zones/:id` bất kỳ lúc nào, miễn không trùng với mã của một khu vực khác đang hoạt động (`ZONE_CODE_EXISTS` nếu trùng). Không có cơ chế "khóa mã sau khi tạo".
> EX2: Việc đổi `zone_type` được áp dụng **ngay lập tức, không cảnh báo, không yêu cầu xác nhận** — kể cả khi khu vực đang có thiết bị gán vào. Nếu team muốn giữ hành vi cảnh báo như SRS mô tả, cần bổ sung logic kiểm tra `iot_devices.zone_id`/sự kiện liên quan trước khi cho phép đổi loại — hiện chưa có.

---

## UC-106 — Xóa khu vực

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** EX1: chặn xóa nếu khu vực còn **"N thiết bị / M sự kiện"** đang tham chiếu, hiển thị chi tiết cả hai loại tham chiếu.

**Code thực tế (bằng chứng):**
- Route: `DELETE zones/:id`, permission `zones.zone.delete` — `zones.controller.ts:192-206`.
- `remove()` (`zones.service.ts:382-415`): CHỈ kiểm tra `iotDevicesService.countByZoneId(id)` (dòng 387-394) — nếu > 0 → `ConflictException` code `ZONE_HAS_DEVICES`. **Không có bất kỳ truy vấn nào tới `zone_presence_events` hoặc `gate_access_logs`** để kiểm tra tham chiếu sự kiện lịch sử trước khi xóa mềm (`softDelete`, dòng 401).
- Đúng như CLAUDE.md mục 5.5 đã cảnh báo (quy tắc 1): FK `zone_id` trên các bảng log KHÔNG tự NULL khi zone bị xóa mềm — nghĩa là một khu vực có lịch sử `zone_presence_events`/`gate_access_logs` phong phú nhưng **hiện không còn thiết bị nào gán** vẫn xóa được bình thường, để lại các bản ghi log cũ trỏ tới 1 zone đã `deleted_at != NULL`.

**Nhận xét:**
Nhánh kiểm tra thiết bị khớp đúng SRS. Nhánh kiểm tra "sự kiện đang liên kết" mà SRS yêu cầu tường minh trong EX1 hoàn toàn không được implement.

**Đề xuất sửa SRS:**
> EX1: Hệ thống chỉ chặn xóa khi khu vực **còn thiết bị đang gán** (`iot_devices.zone_id`, lỗi `ZONE_HAS_DEVICES` kèm số lượng). **Không kiểm tra** số lượng sự kiện lịch sử (`zone_presence_events`/`gate_access_logs`) đã từng ghi nhận tại khu vực — một khu vực không còn thiết bị vẫn xóa mềm được dù còn rất nhiều log lịch sử trỏ tới nó (các bản ghi log cũ giữ nguyên `zone_id`, không bị ảnh hưởng, nhưng sẽ trỏ tới một zone đã bị xóa mềm).

---

## UC-107 — Xem & tra cứu khu vực

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** POST-1: danh sách kèm "số lượng thiết bị đang gán" cho mỗi khu vực. Bước 5: xem chi tiết kèm "số lượng sự kiện gần nhất". BR1: mặc định chỉ hiện khu vực hoạt động, **trừ khi** người dùng bật bộ lọc "Hiển thị khu vực đã xóa".

**Code thực tế (bằng chứng):**
- `GET zones` (list, `zones.controller.ts:56-69`) và `GET zones/:id` (detail, dòng 72-83).
- `toZoneResponse()` (`src/modules/zones/dto/zone-response.dto.ts:47-87`): field `iot_devices`/`equipments` **chỉ được điền khi caller truyền `devices`** — comment dòng 13-15 xác nhận tường minh: **"Route GET /zones (list) không truyền [devices] để tránh N+1 query"**. Nghĩa là danh sách khu vực (list) **không có số lượng thiết bị** cho từng dòng — chỉ endpoint chi tiết 1 khu vực (`GET /zones/:id`) mới trả kèm `iot_devices`/`equipments`.
- Ngay cả ở endpoint chi tiết, response chỉ có danh sách thiết bị + equipment tóm tắt — **không có trường "số lượng sự kiện gần nhất"** nào (không truy vấn `zone_presence_events`/`gate_access_logs`).
- `ListZonesQueryDto` (`src/modules/zones/dto/list-zones-query.dto.ts:35-72`): hỗ trợ filter `zone_type`/`building`/`floor`/`status`/`search` — khớp bước 3 Normal Flow. Nhưng **cố ý không có tham số `include_deleted`** — comment dòng 32-33: "CỐ Ý KHÔNG khai... `include_deleted` (OQ-7)" — nghĩa là **không có cách nào bật xem lại khu vực đã xóa** qua API này; danh sách LUÔN loại trừ khu vực đã xóa, không có toggle như BR1 mô tả.

**Nhận xét:**
1. POST-1 (số lượng thiết bị trong DANH SÁCH) sai — dữ liệu này chỉ có ở màn hình chi tiết từng khu vực, không có ở danh sách, vì lý do hiệu năng (tránh N+1 query) đã được ghi chú rõ trong code.
2. "Số lượng sự kiện gần nhất" ở màn hình chi tiết hoàn toàn không tồn tại.
3. BR1 (toggle hiển thị khu vực đã xóa) không được expose qua API — về mặt thực thi, quy tắc "mặc định ẩn, trừ khi bật" bị đơn giản hóa thành "luôn luôn ẩn, không có lựa chọn khác".

**Đề xuất sửa SRS:**
> POST-1: Danh sách khu vực (`GET /zones`) trả về Mã, Tên, Loại, Tòa nhà, Tầng, Trạng thái — **không kèm số lượng thiết bị** (để tránh truy vấn N+1). Muốn xem thiết bị/equipment gắn với 1 khu vực cụ thể phải gọi riêng `GET /zones/:id`. Không có trường "số lượng sự kiện gần nhất" ở bất kỳ endpoint nào của module `zones`. Không có tham số bật/tắt hiển thị khu vực đã xóa — danh sách luôn loại trừ khu vực đã xóa mềm, không có cách nào tra cứu lại qua API `zones` hiện có.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Gán thiết bị vào khu vực CHO ĐÈ zone cũ một cách có chủ đích** (`assignDevices()`, `zones.service.ts:435+`, comment dòng 428-431) — nếu 1 thiết bị đang gán ở zone khác, gán vào zone mới sẽ **tự động chuyển** (ghi `old_zone_id → new_zone_id` vào audit) thay vì bị chặn — khác hẳn hành vi `IotDevicesService.assignRoom()` (chặn chuyển phòng nếu đã gán) mà Mục 9 đã ghi nhận. Đây là một khác biệt ngữ nghĩa cố ý (zone = nhóm logic, room = vị trí lắp vật lý) hoàn toàn không được SRS nhắc tới.
2. **Audit log riêng cho từng thao tác CRUD trên zone** (`ZonesAuditRepository.logZoneUpdate/logZoneDeletion`) — ghi vết before/after chi tiết cho mọi lần tạo/sửa/xóa khu vực, không có trong SRS.
3. **Toàn bộ field API dùng snake_case** (`zone_code`, `zone_type`, `metadata_json`...) qua `@Expose` — khác quy ước camelCase phổ biến ở các module khác trong cùng backend — không phải sai lệch nghiệp vụ nhưng là điểm khác biệt convention đáng chú ý nếu FE tích hợp nhiều module cùng lúc.
