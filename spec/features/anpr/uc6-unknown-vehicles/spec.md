# VUN-001 — UC6 (ANPR): xem danh sách biển lạ (unknown plates)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-25 | Tạo spec VUN-001 (UC6): admin xem danh sách biển lạ (unmatched) đã ghi bởi UC5 — query `iot_device_events` WHERE event_type='ivss_vehicle_event' AND payload_json->>'matchState'='unmatched', phân trang + time-filter. Mirror face unmapped-review (JSON query) + UC3 pagination + UC1 admin-gate. RECON code thật. OQ chờ chốt. | Toàn bộ |
| 2026-06-25 | Thiếu Chủ CHỐT OQ-1…5: OQ-1=raw SQL `payload_json->>'matchState'` (top-level, KHÔNG nest) bind · OQ-2=time-range from/to v1 (channel owed) · OQ-3=`anpr.vehicle.unknown_view` · OQ-4=output plateNumber/channelId/direction/eventTime/utc/plateColor/vehicleType + meta total (UC3) · OQ-5=admin-only v1. §7 ĐÃ CHỐT. | §7 |

> **SPEC-ONLY.** Chưa plan/tasks/code. UC5 đã **phát hiện + ghi** biển lạ (row `unmatched` trong `iot_device_events`). UC6 = **XEM** danh sách biển lạ (admin/bảo vệ biết xe lạ nào vào cổng lúc nào). KHÔNG phát hiện lại (UC5 làm). **Read-only.** KHÔNG cảnh báo real-time (owed), KHÔNG lịch sử matched+unmatched đầy đủ (UC7), KHÔNG bridge/camera, KHÔNG migration, KHÔNG sửa UC1-5.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. UC5 ghi unmatched — dữ liệu UC6 query ([vehicle-resolve.service.ts](../../../../src/modules/anpr/services/vehicle-resolve.service.ts))
- INSERT `iot_device_events`: `event_type='ivss_vehicle_event'`, `source_protocol='ivss'`, room/meeting=NULL, `processed_status` matched→`'processed'`/unmatched→`'unmatched'`.
- **`payload_json`** (top-level): `{ plateRaw, plateNumber, userId(null khi unmatched), channelId, direction, matchState('matched'|'unmatched'), eventActionRaw, plateColor, vehicleColor, vehicleType, utc, receivedAt }`. **`event_time`** là cột (timestamptz).
- ⇒ UC6 lọc `event_type='ivss_vehicle_event' AND payload_json->>'matchState'='unmatched'`; lấy `payload_json->>'plateNumber'/'channelId'/'direction'/...` + `event_time`.

### 0.2. Face unmapped-review — KHUÔN MẪU query JSON ([unmapped-review.service.ts:59-93](../../../../src/modules/face-access/services/unmapped-review.service.ts))
- **Raw SQL** `dataSource.manager.query` với **JSON path** `e.payload_json->'extracted_fields'->>'person_id'`, filter `WHERE e.event_type='face_verify'`, time-window `e.created_at >= now() - ($1 * interval '1 minute')`, `ORDER BY last_seen DESC LIMIT $2 OFFSET $3`, **bind params** (SEC-03). Map → field cho phép (SEC: KHÔNG base64/secret). `meta:{page,limit}`.
- ⇒ UC6 mirror: raw SQL JSON path `payload_json->>'matchState'`/`->>'plateNumber'`, filter event_type vehicle, ORDER BY `event_time DESC`, LIMIT/OFFSET bind.

### 0.3. Admin-gate THẬT ([departments.controller.ts:40](../../../../src/modules/accounts/controllers/departments.controller.ts), UC1 admin route)
- `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('...')` (PermissionsGuard thật, AuthModule export). UC1 admin route đã dùng `@RequirePermissions('anpr.vehicle.admin_register')`. ⇒ UC6 mirror với permission riêng.

### 0.4. Pagination (UC3 mirror iot-devices, CLAUDE.md §8.4)
- `page`/`limit` (`@Type Number`, default 20 max 100) + `meta:{page,limit,total,totalPages}`. ⇒ UC6 mirror UC3 (nhất quán ANPR). (Face dùng `meta:{page,limit}` không total — UC6 theo UC3 có total, OQ.)

### 0.5. Schema `iot_device_events` (UC5 RECON) ([iot-device-event.entity.ts](../../../../src/modules/iot/entities/iot-device-event.entity.ts))
- `device_id`/`event_type`/`event_time`/`payload_json`(jsonb)/`processed_status`/`created_at`. ANPR vehicle: room/meeting NULL, userId trong payload_json (KHÔNG cột). C1-isolation theo `event_type`.

---

## 1. Scope (UC6)

### TRONG scope
1. **GET endpoint list biển lạ** (admin): query `iot_device_events` WHERE `event_type='ivss_vehicle_event' AND payload_json->>'matchState'='unmatched'`, sort `event_time DESC`, phân trang (mirror UC3). Optional filter time-range (OQ-2).
2. **Admin-gated**: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('anpr.vehicle.unknown_view')` (OQ-3). KHÔNG cho user thường (chức năng an ninh).
3. **Output** mỗi row: `plateNumber, channelId, direction, eventTime` (+ utc/plateColor/vehicleType? — OQ-4). Envelope + meta.

### NGOÀI scope (UC sau / owed)
- KHÔNG phát hiện biển lạ (UC5 làm). KHÔNG cảnh báo push/real-time (owed). KHÔNG lịch sử đầy đủ matched+unmatched (UC7). KHÔNG tạo/sửa/xóa (read-only). KHÔNG bridge/camera. KHÔNG migration. KHÔNG sửa UC1-5.

## 2. DTO (đề xuất — mô tả, KHÔNG code)
`ListUnknownVehiclesQueryDto` (mirror UC3 + face time-window):
- `page` (`@Type(()=>Number) @IsOptional @IsInt @Min(1)` default 1), `limit` (`@Type Number @IsOptional @IsInt @Min(1) @Max(100)` default 20).
- (OQ-2) optional `from`/`to` (`@IsOptional @IsISO8601`) — time-range theo `event_time`. (Cân nhắc `channelId` optional — OQ-2.)
- KHÔNG nhận field nhạy cảm. `whitelist:true`.

## 3. Service (đề xuất — `VehicleUnknownService`, mirror face raw SQL)
- `src/modules/anpr/services/vehicle-unknown.service.ts` — inject `DataSource`. `listUnknown(query)`:
  - `WHERE event_type='ivss_vehicle_event' AND payload_json->>'matchState'='unmatched'` (+ `event_time >= $from`/`<= $to` nếu có).
  - `SELECT payload_json->>'plateNumber' AS plate_number, payload_json->>'channelId' AS channel_id, payload_json->>'direction' AS direction, event_time, payload_json->>'utc' AS utc` … `ORDER BY event_time DESC LIMIT $ OFFSET $` (bind).
  - total qua `COUNT(*)` cùng WHERE (OQ-4 meta) → `meta:{page,limit,total,totalPages}`.
  - Map → field cho phép (SEC: KHÔNG imageBase64 — UC5 vốn không lưu). KHÔNG dùng VehicleRegistrationService (raw query riêng, mirror face/UC5).

## 4. Controller (đề xuất)
- Route admin: `GET /api/v1/anpr/admin/unknown-vehicles` (path admin mirror UC1 `anpr/admin/...`). `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('anpr.vehicle.unknown_view')` + `@UsePipes(ValidationPipe{whitelist,transform})` + `@Query() dto`.
- Trả `{ success:true, message:'Unknown vehicles retrieved', data: rows, meta }` (200). (Thêm vào `VehicleRegistrationController` — có sẵn admin precedent — hoặc controller mới; chốt plan.)

## 5. Requirements (EARS)
- **R1**: **WHEN** admin (có quyền) gọi `GET /anpr/admin/unknown-vehicles` **→** trả danh sách row `unmatched` (event_type vehicle), sort `event_time DESC`, phân trang + meta.
- **R2 (filter)**: **IF** query có `from`/`to` **→** lọc thêm `event_time` trong khoảng; không có → trả tất cả (phân trang).
- **R3 (C1-isolation)**: **WHILE** query, CHỈ `event_type='ivss_vehicle_event'` + `matchState='unmatched'` — KHÔNG đụng face stranger/`face_verify`.
- **R4 (SEC admin)**: **IF** không đăng nhập / thiếu quyền `anpr.vehicle.unknown_view` **→** 401/403 (PermissionsGuard). User thường KHÔNG xem được.
- **R5 (read-only)**: **WHILE** UC6, KHÔNG tạo/sửa/xóa — chỉ đọc.
- **R6 (list rỗng)**: **IF** không có biển lạ **→** `data:[]` + 200 + `meta.total=0`.
- **R7 (VAL)**: **IF** `page`/`limit` sai / `limit>100` / `from`/`to` không ISO **→** 400.

## 6. Constitution
- **SEC-01 (admin-only)**: PermissionsGuard thật + `@RequirePermissions('anpr.vehicle.unknown_view')` — chức năng an ninh, KHÔNG user thường (OQ-5). userId từ JWT (chỉ để auth, KHÔNG lọc theo user).
- **ARCH-01**: controller→service→`DataSource` raw SQL (mirror face unmapped-review + UC5); KHÔNG dùng `VehicleRegistrationService`.
- **DATA-01 (C1-isolation)**: query CHỈ `event_type='ivss_vehicle_event' AND payload_json->>'matchState'='unmatched'` — KHÔNG nhiễm face. Read-only.
- **DATA-02**: no-migration (đọc `iot_device_events` đã có).
- **SEC-03**: raw SQL bind tham số (JSON path + time-range + LIMIT/OFFSET).
- **VAL-01**: query DTO `class-validator` + `ValidationPipe({whitelist,transform})`.

## 7. OPEN QUESTIONS — ĐÃ CHỐT
- **OQ-1 (crux) query JSON — CHỐT**: **raw SQL** `dataSource.manager.query`, `WHERE event_type='ivss_vehicle_event' AND payload_json->>'matchState'='unmatched'`, `SELECT payload_json->>'plateNumber'` … **bind params** (SEC-03). `->>` trả text. **KHÔNG nest** (UC5 lưu top-level — KHÁC face `extracted_fields`).
- **OQ-2 filter — CHỐT**: time-range `from`/`to` (theo `event_time`, optional `@IsISO8601`) v1. Channel filter = owed.
- **OQ-3 permission — CHỐT**: `anpr.vehicle.unknown_view` (owed seed cùng nhóm `anpr.vehicle.admin_register`).
- **OQ-4 output — CHỐT**: `plateNumber, channelId, direction, eventTime, utc, plateColor, vehicleType` (từ payload). `meta` có **`total`** (mirror UC3, COUNT cùng WHERE). **KHÔNG imageBase64** (UC5 vốn không lưu).
- **OQ-5 admin-only — CHỐT**: admin-only v1 (PermissionsGuard, an ninh tập trung).

## 8. Residuals / known-gaps
- **Cảnh báo real-time owed**: UC6 chỉ list (pull); push/WebSocket cảnh báo biển lạ ngay khi vào cổng = owed (mirror stranger-alert face nếu cần).
- **Seed permission `anpr.vehicle.unknown_view`** owed (mirror UC1 admin permission) — chưa seed → 403 mọi admin.
- **UC7 lịch sử đầy đủ**: matched+unmatched, theo cổng/thời gian, thống kê — ngoài UC6 (UC6 chỉ unmatched).
- **Group-by biển lạ**: UC6 list từng event (mỗi lần vào = 1 row) — nếu cần gom theo plateNumber + count (như face GROUP BY person_id) → cân nhắc OQ/owed (đề xuất list-từng-event v1, gom là owed).
- **channel→cổng tên**: payload chỉ có channelId số; map channel→tên cổng để hiển thị = owed (analytics/UC7).
- **Live owed**: dữ liệu thật khi bridge (UC8) gửi biển lạ; UC6 test bằng mock query.

> **STOP.** Spec-only. Chờ Thiếu Chủ review §0 RECON (đặc biệt query JSON §0.2) + chốt OQ-1…OQ-5 trước khi plan/tasks. KHÔNG tự code.
