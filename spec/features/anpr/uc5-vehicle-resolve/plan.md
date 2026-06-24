# VRE-001 — plan.md (UC5 ANPR: resolve biển→user + persist iot_device_events)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo plan VRE-001 sau spec DUYỆT + chốt OQ-1…5. `VehicleResolveService` (impl port) mirror face ingestion: resolveBridgeDevice→resolveUserByPlate→direction→INSERT iot_device_events (event_type='ivss_vehicle_event', C1). Override binding sang useExisting. No-migration. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. RECON (đọc CODE THẬT, xác nhận đủ để code)
Mọi mục mirror [ivss-presence-ingestion.service.ts](../../../../src/modules/ivss/services/ivss-presence-ingestion.service.ts):
- **resolveBridgeDeviceId**: `SELECT id FROM iot_devices WHERE device_code='IVSS-BRIDGE' AND device_type='ivss_bridge' LIMIT 1` → `rows[0]?.id ?? null` → null → log + skip. ⇒ UC5 mirror (OQ-5 tái dùng IVSS-BRIDGE).
- **INSERT iot_device_events** ([:96-108 vùng](../../../../src/modules/ivss/services/ivss-presence-ingestion.service.ts)): cột `(device_id, room_id, meeting_id, event_type, event_time, source_protocol, severity, payload_json, processed_status)` VALUES `($1,$2,$3,'ivss_face_event',$4,'ivss','info',$5::jsonb,$6)` — bind tham số, `JSON.stringify(payload)` cho `$5`. ⇒ UC5 đổi event_type='ivss_vehicle_event', room/meeting=null.
- **parseUtc**: `new Date(raw)`; ISO hợp lệ + `|now-t| ≤ 1h` → t; else → `new Date()` + fallback flag. ⇒ UC5 mirror.
- **normalizeDirection**: `ENTER_ACTIONS={enter,in,1}`, `LEAVE_ACTIONS={leave,out,exit,2}`, else→`'seen'`. ⇒ UC5 mirror (OQ-3 + entry/exit).
- **NotThrow**: `onFaceEvent` bọc try/catch toàn thân, log metadata. ⇒ UC5 mirror (webhook UC4 always-ack).
- **Port** [vehicle-event-hook.ts](../../../../src/common/ports/vehicle-event-hook.ts): `VehicleEventHandlerPort.onVehicleEvent(evt)`; UC4 binding hiện `{provide: VEHICLE_EVENT_HANDLER, useClass: DefaultVehicleEventHandler}` ([anpr.module.ts](../../../../src/modules/anpr/anpr.module.ts)) → UC5 đổi `useExisting: VehicleResolveService`.
- **vehicle_registrations** [entity](../../../../src/modules/anpr/entities/vehicle-registration.entity.ts): `plate_number`/`user_id`/`status`/`deleted_at` → resolve query (§4 spec).
- **Schema**: `iot_device_events` device_id NOT NULL, room/meeting nullable, KHÔNG cột user_id (payload_json), event_type/source_protocol no-CHECK ([iot-device-event.entity.ts](../../../../src/modules/iot/entities/iot-device-event.entity.ts)).

## 1. Quyết định đã chốt (OQ + Constitution)
OQ-1 resolve active+living (disabled→unmatched) · OQ-2 room/meeting null · OQ-3 direction map tạm + owed live UC9 · OQ-4 ghi row unmatched · OQ-5 tái dùng IVSS-BRIDGE (chưa seed→skip+log).
- **DATA-01 (C1-isolation)** `event_type='ivss_vehicle_event'` → query vehicle filter event_type, KHÔNG nhiễm face. **DATA-02 (no-migration)** tái dùng iot_device_events + vehicle_registrations; device seed (data). **DATA-03 (normalize đã UC4)** UC5 nhận `evt.plateNumber` đã chuẩn — KHÔNG normalize lại. **ARCH-01 (port override)** impl `VehicleEventHandlerPort` + `useExisting`; mirror face (raw SQL bind, NotThrow). **SEC-01** KHÔNG imageBase64 log/payload; **SEC-03** bind raw SQL. **SEC-02** unmatched KHÔNG gắn user.

## 2. Service `VehicleResolveService` (impl port, mirror face ingestion)
`src/modules/anpr/services/vehicle-resolve.service.ts` — `@Injectable implements VehicleEventHandlerPort`, inject `DataSource`.
`onVehicleEvent(evt)` (toàn thân **try/catch NotThrow**, log metadata khi lỗi):
1. `deviceId = resolveBridgeDeviceId()` → null → log "IVSS-BRIDGE chưa seed" + return.
2. `userId = resolveUserByPlate(evt.plateNumber)` (§4).
3. `direction = normalizeVehicleDirection(evt.eventAction)` (§5).
4. `matchState = userId ? 'matched' : 'unmatched'`; `processedStatus = userId ? 'processed' : 'unmatched'`.
5. `eventTime = parseUtc(evt.utc)`.
6. `payload = { plateRaw, plateNumber, userId, channelId, direction, matchState, eventActionRaw: evt.eventAction ?? null, plateColor: evt.plateColor ?? null, vehicleColor: evt.vehicleColor ?? null, vehicleType: evt.vehicleType ?? null, utc: evt.utc, receivedAt: new Date().toISOString() }` — **KHÔNG imageBase64**.
7. INSERT iot_device_events (§3).
- Private helpers `resolveBridgeDeviceId`/`resolveUserByPlate`/`normalizeVehicleDirection`/`parseUtc` (mirror face). KHÔNG đụng `VehicleRegistrationService` (raw query riêng — tránh coupling; mirror face).

## 3. Persist mapping — `iot_device_events` (INSERT bind)
```
INSERT INTO iot_device_events
  (device_id, room_id, meeting_id, event_type, event_time, source_protocol, severity, payload_json, processed_status)
VALUES ($1, NULL, NULL, 'ivss_vehicle_event', $2, 'ivss', 'info', $3::jsonb, $4)
```
bind `[deviceId, eventTime, JSON.stringify(payload), processedStatus]`. room_id/meeting_id literal NULL (OQ-2).

## 4. Resolve query
```
SELECT user_id FROM vehicle_registrations
WHERE plate_number = $1 AND status = 'active' AND deleted_at IS NULL
LIMIT 1
```
bind `[evt.plateNumber]` → `rows[0]?.user_id ?? null`. disabled/đã-xóa/không-có → null → unmatched (OQ-1).

## 5. direction mapping (OQ-3, owed live UC9)
`normalizeVehicleDirection(action?)`: lower+trim; `{in,entry,enter,1}`→`enter`; `{out,exit,leave,2}`→`leave`; absent/lạ→`seen`.

## 6. Module wiring — `anpr.module.ts` (Modified)
- providers: thêm `VehicleResolveService`; đổi binding `{ provide: VEHICLE_EVENT_HANDLER, useExisting: VehicleResolveService }` (thay `useClass: DefaultVehicleEventHandler`). Giữ `DefaultVehicleEventHandler` registered (fallback, mirror face giữ DefaultIvssEventHandler). KHÔNG đụng UC1-4 controller/service khác.
- KHÔNG đổi env. KHÔNG migration.

## 7. File list
### Net-new
- `src/modules/anpr/services/vehicle-resolve.service.ts` (+ `.spec.ts`)
### Modified
- `src/modules/anpr/anpr.module.ts` — provider `VehicleResolveService` + đổi `VEHICLE_EVENT_HANDLER` binding sang `useExisting`.
> Tổng **2 net-new (1 code + 1 spec) + 1 modified**. 0 migration. 0 đổi env. 0 đụng logic UC1-4.

## 8. Test (mock DataSource — KHÔNG thiết bị)
- **matched**: bridge OK + biển active (resolveUserByPlate trả userId) → INSERT với `processed_status='processed'` + payload.userId; assert event_type='ivss_vehicle_event' (C1), room/meeting NULL.
- **unmatched**: biển không có / disabled / đã-xóa (resolve trả null) → INSERT `unmatched` + payload.userId=null (OQ-4).
- **C1-isolation**: SQL chứa `'ivss_vehicle_event'`.
- **direction**: eventAction `'in'`→enter, `'out'`→leave, absent/lạ→`'seen'`.
- **parseUtc**: utc rác/lệch xa → eventTime = now (không NaN).
- **NotThrow**: INSERT/resolve ném lỗi → onVehicleEvent KHÔNG ném (resolve undefined), log.
- **device chưa seed**: resolveBridgeDeviceId null → KHÔNG INSERT, log + return.
- **SEC-01**: payload (param) KHÔNG chứa imageBase64.
- **UC1-4 KHÔNG hồi quy**: `jest src/modules/anpr` xanh — đặc biệt webhook UC4 giờ gọi `VehicleResolveService` thật (qua port) thay default log-only (controller test UC4 mock handler → vẫn xanh).
- Coverage **≥80%** `vehicle-resolve.service.ts`.

## 9. Gate (STOP, KHÔNG commit)
- build=0; eslint touched (service + spec + module) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh (UC1-4 + UC5); coverage ≥80% service mới; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies — `VEHICLE_EVENT_HANDLER` resolve `VehicleResolveService`). **KHÔNG live, KHÔNG DB.**
- **Owed runbook (ghi, KHÔNG chạy)**: seed device `IVSS-BRIDGE` (device_code/device_type='ivss_bridge') nếu chưa có — nếu thiếu UC5 skip+log · chốt direction mapping khi live (UC9) · UC8 bridge gửi event theo §3-contract UC4 · UC6 biển-lạ-cảnh-báo (đọc row unmatched) · UC7 query lịch sử.

## 10. Kỷ luật
- **No-migration** (tái dùng iot_device_events + vehicle_registrations; device seed=data). **C1-isolation** `event_type='ivss_vehicle_event'` (KHÔNG nhiễm face). **NotThrow** always-ack (webhook UC4). **DATA-03** normalize đã làm UC4 — KHÔNG normalize lại. **SEC-01/03** KHÔNG imageBase64 + bind raw SQL. Tái dùng device IVSS-BRIDGE (OQ-5).
- KHÔNG cảnh báo biển lạ (UC6) · KHÔNG đụng logic UC1-4 (chỉ đổi port binding) · KHÔNG đụng `VehicleRegistrationService` (raw query riêng).

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan → sang tasks. KHÔNG code.
