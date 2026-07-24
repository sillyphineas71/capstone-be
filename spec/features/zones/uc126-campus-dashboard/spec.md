# CDB-001 — UC-126 (Zones / SAVP): Dashboard điều hành khuôn viên

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec CDB-001 (UC-126): module mới `campus-dashboard` (read-only, KHÔNG entity riêng) tổng hợp hiện diện + ra/vào + trạng thái camera theo phân cấp Tòa→Tầng→Zone. Quyết định qua AskUserQuestion: (1) tọa độ zone — đề nghị Hải thêm cột `latitude`/`longitude` (BLOCKED, chưa code phần này), (2) "mất kết nối" kết hợp `iot_devices.status` (ưu tiên nếu thiết bị có heartbeat) + độ mới `zone_presence_events` (fallback cho IVSS không heartbeat). | Toàn bộ |

> Module nền tảng cho cả UC-119 ([../uc119-zone-presence-timeline/](../uc119-zone-presence-timeline/)) và UC-120 ([../uc120-zone-traffic-heatmap/](../uc120-zone-traffic-heatmap/)) — 2 cụm đó THÊM controller/service/dto vào CÙNG module `campus-dashboard`, KHÔNG tạo module riêng. Code UC-126 (scaffold module) TRƯỚC, UC-119/120 code SAU (phụ thuộc module đã tồn tại).
>
> Độc lập với UC-121 (module `crowd-alert` riêng, không phụ thuộc nhau).
>
> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. `ZoneEntity` ([zone.entity.ts](../../../../src/modules/zones/entities/zone.entity.ts)) — KHÔNG có cột tọa độ
Chỉ có `zoneCode/zoneName/zoneType/building/floor/description/metadataJson/status/deletedAt`. `building`/`floor` là `varchar` tự do (KHÔNG FK riêng bảng building/floor) — đủ để GROUP BY dựng phân cấp Tòa→Tầng→Zone, nhưng **KHÔNG có tọa độ (lat/lng hoặc x/y)** — xem §2.1 (Đã chốt: đề nghị Hải thêm cột, KHÔNG dùng `metadata_json` tạm).

### 0.2. `IoTDeviceEntity` ([iot-device.entity.ts](../../../../src/modules/iot/entities/iot-device.entity.ts))
`zoneId` (nullable FK), `status` (`enum IoTDeviceStatus`: `online/offline/disabled/maintenance`), `deviceType` (`enum IoTDeviceType`: gồm `face_server`, `door_camera` — CÓ heartbeat theo [iot-devices.service.ts](../../../../src/modules/iot/services/iot-devices.service.ts) dòng 1268-1293 — VÀ `ip_camera`/`occupancy_sensor` — IVSS/room camera, KHÔNG có cơ chế heartbeat nào cập nhật `status` tự động, `status` có thể "đứng yên" mãi ở giá trị set thủ công lúc tạo).

### 0.3. `ZonePresenceEventEntity` — `IDX_zpe_count` (đã dùng ở UC-121 §0.1) tận dụng lại cho occupancy mới nhất/gần nhất theo zone.

### 0.4. `GateAccessLogEntity` ([gate-access-log.entity.ts](../../../../src/modules/zones/entities/gate-access-log.entity.ts)) — `zoneId` (NOT NULL), `direction` (`'in'|'out'`), `accessTime`. Dùng đếm "số lượt ra/vào trong ngày" — quyết định §2.4: đếm RAW log rows (KHÔNG phụ thuộc cron ghép cặp UC-116 `SCHEDULER_GATE_ACCESS_PAIRING_ENABLED` hiện đang OFF mặc định).

### 0.5. Pattern module `analytics` ([dashboard-overview.service.ts](../../../../src/modules/analytics/services/dashboard-overview.service.ts)) — cấu trúc `repository + service + controller + dto` theo TỪNG metric riêng (1 controller/service/dto-file cho 1 endpoint, dùng chung 1 module). `campus-dashboard` mirror ĐÚNG pattern này: UC-126/119/120 là 3 bộ controller/service/dto riêng trong CÙNG 1 module.

### 0.6. Permission pattern ([zones.controller.ts](../../../../src/modules/zones/controllers/zones.controller.ts) dòng 38) — `@RequirePermissions('<module>.<resource>.<action>')` BẮT BUỘC trên MỌI route, thiếu decorator = hở 403 im lặng.

---

## 1. Quyết định nghiệp vụ đã chốt (AskUserQuestion, phiên Bước 4)

1. **Tọa độ zone**: đề nghị Hải thêm cột `latitude numeric`/`longitude numeric` (hoặc tương đương) vào `zones` qua migration riêng của Hải — **KHÔNG dùng `metadata_json` tạm**. UC-126 code XONG toàn bộ phần còn lại (occupancy/gate traffic/camera status), field `coordinates` trong response LUÔN trả `null` cho tới khi cột thật tồn tại — ghi rõ dependency §7.
2. **"Mất kết nối" (EX1, áp dụng cho occupancy)**: kết hợp CẢ HAI tín hiệu — ưu tiên `iot_devices.status` nếu zone có device loại CÓ heartbeat (`face_server`/`door_camera`); nếu zone CHỈ có device loại KHÔNG heartbeat (`ip_camera`/`occupancy_sensor`) hoặc KHÔNG có device nào, fallback qua độ mới sự kiện `zone_presence_events` (`event_type='count'`) — xem thuật toán chi tiết §2.3.

## 2. Quyết định thiết kế suy luận thêm

1. **Tọa độ = BLOCKED, KHÔNG workaround**: response luôn có field `coordinates: {lat, lng} | null`, hiện tại LUÔN `null` (đọc từ cột chưa tồn tại). Khi Hải thêm cột thật, chỉ cần 1 thay đổi nhỏ ở repository (đọc cột mới) — KHÔNG đổi contract JSON.
2. **2 metric TÁCH BIỆT, KHÔNG gộp logic "no data"**:
   - `cameraStatus`: đếm LITERAL số lượng device theo `status` (online/offline/disabled/maintenance) trong zone — KHÔNG áp dụng suy luận "no_data" gì thêm, hiển thị đúng giá trị cột (biết trước residual: giá trị có thể sai/cũ với IVSS không heartbeat — ghi §7, KHÔNG sửa ở đây vì ngoài phạm vi module `iot`).
   - `occupancy`: metric DUY NHẤT áp dụng EX1 ("Không có dữ liệu" thay vì 0) — thuật toán §2.3.
3. **Thuật toán `occupancy.status`** (pure function `resolveOccupancyStatus`, test độc lập):
   ```
   const heartbeatDevices = devicesInZone.filter(d => HEARTBEAT_TYPES.includes(d.deviceType));
   if (heartbeatDevices.length > 0) {
     // Có ít nhất 1 device loại tin cậy — dùng LÀM tín hiệu chính
     if (heartbeatDevices.some(d => d.status === 'online')) → 'ok' (kể cả nếu event hơi cũ — thiết bị còn sống)
     else → 'no_data' (mọi device tin cậy đều offline/disabled/maintenance)
   } else {
     // KHÔNG có device tin cậy (chỉ IVSS/room camera hoặc không có device nào) — fallback độ mới event
     if (latestCountEvent EXISTS && (now - latestCountEvent.eventTime) <= STALENESS_MINUTES → 'ok'
     else → 'no_data'
   }
   ```
   `STALENESS_MINUTES` đọc `system_configs` (`config_group='campus_dashboard', config_key='campus_dashboard.occupancy_staleness_minutes'`), fallback mặc định **15 phút** nếu chưa cấu hình (đề xuất suy luận riêng, KHÔNG có trong SRS — có thể chỉnh qua `system_configs`, KHÔNG hard-code cứng để dễ tinh chỉnh sau demo).
   `occupancy.count` LUÔN trả giá trị đếm mới nhất tìm được (kể cả khi `status='no_data'`) để FE tùy chọn hiển thị mờ/gạch — KHÔNG trả `null` cho `count`, chỉ `status` mới quyết định cách FE diễn giải (giữ đúng tinh thần "0 gây hiểu nhầm" — số liệu vẫn có nhưng đi kèm cờ cảnh báo độ tin cậy).
4. **`gateTraffic.entriesToday`/`exitsToday`**: đếm RAW rows `gate_access_logs` (`zoneId, direction, accessTime >= startOfDay(server local tz)`), KHÔNG dùng phiên đã ghép cặp (Bước 2 UC-116) — lý do: cron ghép cặp mặc định OFF, dashboard không nên phụ thuộc 1 tính năng optional khác đang tắt.
5. **`cameraStatus.overall`** (tổng hợp hiển thị nhanh): `'no_device'` (zone không có device nào) → `'online'` (≥1 device `status=online`) → `'degraded'` (không ai online nhưng có `maintenance`) → `'offline'` (còn lại, tất cả offline/disabled).
6. **Cấu trúc module**: `campus-dashboard` module MỚI, tự `TypeOrmModule.forFeature([ZoneEntity, ZonePresenceEventEntity, GateAccessLogEntity, IoTDeviceEntity])` (import entity trực tiếp từ `zones`/`iot`, KHÔNG import `ZonesModule`/`IotModule` — mirror lý do `restricted-zone` đã dùng: tránh kéo theo provider/controller không cần, tránh rủi ro vòng phụ thuộc). Import `AuthModule` (guard thật).
7. **Auto-refresh 10-30s (SRS)**: HOÀN TOÀN phía client polling — BE KHÔNG cần WebSocket/push riêng cho UC-126 (SRS Normal Flow bước 5 chỉ nói "tự động làm mới... mà không cần người dùng tải lại trang", không bắt buộc realtime push). Đảm bảo query đủ nhanh (tận dụng index có sẵn) là đủ.

---

## 3. Scope (UC-126)

### TRONG scope
1. Module mới `campus-dashboard` (scaffold — dùng chung cho cả UC-119/120 sau).
2. `CampusDashboardOverviewService.getOverview(query: {building?, floor?})`:
   1. Load zone hierarchy (`ZoneEntity` where `deletedAt IS NULL`, filter `building`/`floor` nếu có).
   2. Với mỗi zone: load occupancy mới nhất (`ZonePresenceEventEntity` order `eventTime DESC` limit 1, `eventType='count'`, tận dụng `IDX_zpe_count`), load devices theo `zoneId` (`IoTDeviceEntity`), tính `resolveOccupancyStatus` (§2.3) + `cameraStatus` (§2.5), đếm `gateTraffic` hôm nay (§2.4).
   3. Trả JSON phân cấp `buildings[].floors[].zones[]` (mỗi zone kèm `coordinates: null`).
3. `GET /api/v1/campus-dashboard/overview` (permission `campus_dashboard.overview.read`, guard `JwtAuthGuard + PermissionsGuard`, Admin/Manager).
4. Seed permission `campus_dashboard.overview.read` (migration mới, mirror `SeedZoneReadPermission`).

### NGOÀI scope (KHÔNG làm ở đây)
- Đọc/ghi cột tọa độ thật — BLOCKED chờ Hải (§2.1).
- Bản đồ GIS trực quan — FE (Nam), BE chỉ trả JSON.
- Timeline khu vực (UC-119), lưu lượng+heatmap (UC-120) — cụm khác, dùng CHUNG module này.
- WebSocket push cho dashboard — SRS không yêu cầu, client tự polling.
- Sửa `IoTDeviceEntity`/heartbeat mechanism cho IVSS — ngoài phạm vi module `iot`.

---

## 4. Requirements (EARS)

- **R1**: **WHEN** người dùng gọi `GET /api/v1/campus-dashboard/overview` **→** hệ thống trả JSON phân cấp Tòa→Tầng→Zone, mỗi zone kèm `occupancy`, `gateTraffic`, `cameraStatus`, `coordinates`.
- **R2 (crux)**: **IF** zone có ≥1 device loại `face_server`/`door_camera` với `status='online'` **→** `occupancy.status = 'ok'`.
- **R3 (crux)**: **IF** zone KHÔNG có device loại có-heartbeat online (hoặc không có device loại đó) VÀ event `count` gần nhất CŨ HƠN ngưỡng staleness (mặc định 15 phút) HOẶC KHÔNG tồn tại **→** `occupancy.status = 'no_data'`.
- **R4**: **WHEN** `occupancy.status = 'no_data'` **→** hệ thống VẪN trả `occupancy.count` (giá trị cũ nhất tìm được, có thể `null` nếu chưa từng có event) — KHÔNG tự ý trả `0`.
- **R5**: **WHEN** tính `gateTraffic` **→** hệ thống đếm RAW rows `gate_access_logs` trong ngày hiện tại (server local timezone), KHÔNG dùng phiên đã ghép cặp.
- **R6**: **WHERE** `coordinates` chưa có cột thật trong DB **→** hệ thống LUÔN trả `null`, KHÔNG lỗi, KHÔNG bỏ field khỏi response.
- **R7**: **WHEN** người dùng KHÔNG có permission `campus_dashboard.overview.read` **→** hệ thống trả `403`.

## 5. Constitution

- **ARCH-01**: Business logic nằm trong `CampusDashboardOverviewService`, controller chỉ nhận query + gọi service.
- **ARCH-02**: Module `campus-dashboard` tự `forFeature` entity (KHÔNG import `ZonesModule`/`IotModule` để tránh kéo dư provider/controller không cần).
- **DATA-01**: KHÔNG INSERT/UPDATE/DELETE bất kỳ bảng nào — module 100% READ-ONLY.
- **SEC-01**: MỌI route PHẢI có `@RequirePermissions` — thiếu = hở 403 im lặng (RECON §0.6).
- **NO-SCOPE-01**: KHÔNG thêm cột `zones`, KHÔNG sửa heartbeat `iot`, KHÔNG code UC-119/120/121 ở đây (chỉ scaffold module cho 119/120 dùng sau).

## 6. Residuals / known-gaps

- **Tọa độ zone BLOCKED** — cần Hải thêm cột `latitude`/`longitude` (hoặc `x`/`y`) vào `zones` qua migration riêng của Hải. Cho tới lúc đó, FE (Nam) KHÔNG thể dựng bản đồ GIS thật, chỉ có building/floor dạng text + occupancy/traffic/camera số liệu.
- **`cameraStatus` dựa `iot_devices.status`** — biết trước KHÔNG đáng tin cho device loại `ip_camera`/`occupancy_sensor` (không có heartbeat cập nhật tự động) — hiển thị literal, KHÔNG áp `no_data` cho metric này (khác quyết định với `occupancy`, xem §2.2 lý do tách biệt).
- **`STALENESS_MINUTES=15` mặc định** — số suy luận riêng, không có trong SRS, cần Admin tinh chỉnh qua `system_configs` sau demo nếu không phù hợp thực tế.
- **`gateTraffic` đếm RAW logs, không phải phiên ghép cặp** — nhất quán riêng với "Chưa hoàn tất" của UC-116/117 (Bước 2), KHÔNG loại trừ log lỗi ghép cặp khỏi con số này (SRS UC-126 chỉ nói "số lượt ra/vào", không yêu cầu phân biệt phiên hoàn tất/chưa).

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.
