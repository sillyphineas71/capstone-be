# VUN-001 — plan.md (UC6 ANPR: xem danh sách biển lạ)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-25 | Tạo plan VUN-001 sau spec DUYỆT + chốt OQ-1…5. `VehicleUnknownService` (raw SQL query JSON top-level) + DTO + GET admin route (thêm vào VehicleRegistrationController). C1-isolation, read-only, admin-gate. No-migration. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. RECON (đọc CODE THẬT, xác nhận đủ để code)
- **Face unmapped-review query JSON** ([unmapped-review.service.ts:59-93](../../../../src/modules/face-access/services/unmapped-review.service.ts)): `dataSource.manager.query` raw SQL, JSON path `payload_json->...->>'...'`, `WHERE event_type='...'`, time-window, `ORDER BY ... DESC LIMIT $ OFFSET $`, bind params, map→field cho phép. ⇒ UC6 mirror; KHÁC: UC5 lưu **top-level** → `payload_json->>'plateNumber'` (1 mũi tên `->>`), **KHÔNG nest** `extracted_fields`.
- **UC5 payload** ([vehicle-resolve.service.ts](../../../../src/modules/anpr/services/vehicle-resolve.service.ts)): top-level `{plateNumber, channelId, direction, matchState, plateColor, vehicleColor, vehicleType, utc, …}` + cột `event_time`. ⇒ JSON path xác nhận top-level.
- **Admin-gate UC1** ([vehicle-registration.controller.ts](../../../../src/modules/anpr/controllers/vehicle-registration.controller.ts)): `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('anpr.vehicle.admin_register')` (route `anpr/admin/vehicle-registrations`). ⇒ UC6 thêm route `anpr/admin/unknown-vehicles` cùng controller, permission `anpr.vehicle.unknown_view`.
- **Pagination UC3** ([list-vehicle-registrations-query.dto.ts]/[vehicle-registration.service.ts list]): page/limit `@Type Number` + meta `{page,limit,total,totalPages}`. ⇒ UC6 mirror (total qua COUNT).
- **AnprModule**: controllers `[VehicleRegistrationController, VehicleWebhookController]`, providers UC1-5 → UC6 thêm provider `VehicleUnknownService` + route trong VehicleRegistrationController (KHÔNG controller mới).

## 1. Quyết định đã chốt (OQ + Constitution)
OQ-1 raw SQL `payload_json->>'matchState'='unmatched'` (top-level, bind) · OQ-2 time-range from/to v1 (channel owed) · OQ-3 `anpr.vehicle.unknown_view` · OQ-4 output plateNumber/channelId/direction/eventTime/utc/plateColor/vehicleType + meta total · OQ-5 admin-only.
- **SEC-01** admin-only (PermissionsGuard thật + `@RequirePermissions`); userId từ JWT chỉ để auth. **SEC-03** raw SQL bind. **ARCH-01** controller→service→DataSource raw (mirror face/UC5, KHÔNG VehicleRegistrationService). **DATA-01 (C1)** CHỈ `event_type='ivss_vehicle_event' AND payload_json->>'matchState'='unmatched'`, read-only. **DATA-02** no-migration. **VAL-01** query DTO validate.

## 2. Service — `VehicleUnknownService` (raw SQL, mirror face)
`src/modules/anpr/services/vehicle-unknown.service.ts` — inject `DataSource`. `listUnknown(query): Promise<{items, meta}>`:
- WHERE base: `event_type='ivss_vehicle_event' AND payload_json->>'matchState'='unmatched'`; nếu `from` → `AND event_time >= $`; `to` → `AND event_time <= $` (bind, push param động).
- **rows**: `SELECT payload_json->>'plateNumber' AS plate_number, (payload_json->>'channelId') AS channel_id, payload_json->>'direction' AS direction, event_time, payload_json->>'utc' AS utc, payload_json->>'plateColor' AS plate_color, payload_json->>'vehicleType' AS vehicle_type FROM iot_device_events WHERE <base> ORDER BY event_time DESC LIMIT $ OFFSET $`.
- **total**: `SELECT COUNT(*)::int AS total FROM iot_device_events WHERE <base>` (cùng WHERE, KHÔNG limit/offset).
- `meta = {page, limit, total, totalPages: Math.ceil(total/limit)}`. Map → field cho phép (KHÔNG imageBase64). SEC-03 bind. KHÔNG dùng VehicleRegistrationService.

## 3. DTO — `ListUnknownVehiclesQueryDto`
`src/modules/anpr/dto/list-unknown-vehicles-query.dto.ts`: `page`(`@Type Number @IsOptional @IsInt @Min(1)` def 1), `limit`(`@Type Number @IsOptional @IsInt @Min(1) @Max(100)` def 20), `from?`/`to?`(`@IsOptional @IsISO8601`). KHÔNG field khác.

## 4. Controller — GET admin route (thêm vào `VehicleRegistrationController`)
- `@Get('admin/unknown-vehicles')` `@UseGuards(JwtAuthGuard, PermissionsGuard)` `@RequirePermissions('anpr.vehicle.unknown_view')` `@UsePipes(ValidationPipe{whitelist,transform})` `@Query() query` → `vehicleUnknownService.listUnknown(query)` → `{ success:true, message:'Unknown vehicles retrieved', data: items, meta }` (200).
- Inject `VehicleUnknownService` vào controller (thêm constructor param). KHÔNG đụng route UC1-3/UC2.

## 5. Module wiring — `anpr.module.ts` (Modified)
- providers: thêm `VehicleUnknownService`. controllers giữ nguyên (route thêm vào VehicleRegistrationController). KHÔNG đổi env/migration.

## 6. File list
### Net-new
- `src/modules/anpr/services/vehicle-unknown.service.ts` (+ `.spec.ts`)
- `src/modules/anpr/dto/list-unknown-vehicles-query.dto.ts`
### Modified
- `src/modules/anpr/controllers/vehicle-registration.controller.ts` (+ GET admin route + inject service) (+ `.spec.ts` thêm test)
- `src/modules/anpr/anpr.module.ts` (+ provider `VehicleUnknownService`)
> Tổng **3 net-new (2 code + 1 spec) + 3 modified** (controller + controller.spec + module). 0 migration. 0 đổi env. 0 đụng logic UC1-5.

## 7. Test (mock DataSource — KHÔNG DB)
- **list unmatched**: mock rows + COUNT → assert `data` map đúng field (plateNumber/channelId/direction/eventTime/utc/plateColor/vehicleType) + `meta` (total/totalPages tính đúng, vd total=25 limit=20→2).
- **C1-isolation (BẮT BUỘC)**: SQL chứa `event_type = 'ivss_vehicle_event'` AND `payload_json->>'matchState'` = `'unmatched'`; **KHÔNG** `face_verify`/`face_stranger`.
- **time-range**: `from`/`to` set → SQL có `event_time >=`/`<=` + param; không set → KHÔNG có điều kiện event_time.
- **list rỗng**: COUNT 0 + rows [] → `data:[]` + `meta.total=0` + `totalPages=0`.
- **pagination**: page=2 limit=20 → LIMIT 20 OFFSET 20.
- **SEC-03**: assert bind params (KHÔNG nối chuỗi giá trị vào SQL).
- **controller**: route gọi `listUnknown(query)`; envelope+meta; **admin-gate** assert `__guards__` chứa `PermissionsGuard` + metadata `@RequirePermissions=['anpr.vehicle.unknown_view']`.
- **validate**: `limit>100`/`from` không ISO/`page` không số → 400.
- **read-only**: KHÔNG INSERT/UPDATE/DELETE trong service.
- **UC1-5 KHÔNG hồi quy**: `jest src/modules/anpr` xanh.
- Coverage **≥80%** `vehicle-unknown.service.ts`.

## 8. Gate (STOP, KHÔNG commit)
- build=0; eslint touched (service + dto + controller + module + 2 spec) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh (UC1-5 + UC6); coverage ≥80% service mới; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies). **KHÔNG live, KHÔNG DB.**
- **Owed (ghi, KHÔNG chạy)**: seed permission `anpr.vehicle.unknown_view` (cùng nhóm `anpr.vehicle.admin_register`) — chưa seed → 403 · cảnh báo real-time biển lạ (push/WS) · group-by plateNumber+count (như face GROUP BY) · channel filter + channel→tên cổng · UC7 lịch sử đầy đủ · live khi bridge UC8.

## 9. Kỷ luật
- **No-migration** (đọc iot_device_events đã có). **C1-isolation** `event_type='ivss_vehicle_event' AND matchState='unmatched'` — KHÔNG nhiễm face. **Read-only** (chỉ SELECT). **Admin-gate** PermissionsGuard thật. **SEC-03** raw SQL bind. **Mirror face JSON query** (top-level `->>`, KHÔNG nest).
- KHÔNG phát hiện lại (UC5) · KHÔNG cảnh báo real-time (owed) · KHÔNG đụng UC1-5/VehicleRegistrationService logic.

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan → sang tasks. KHÔNG code.
