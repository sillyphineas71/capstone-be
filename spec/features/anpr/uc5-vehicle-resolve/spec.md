# VRE-001 — UC5 (ANPR): resolve biển→user + persist iot_device_events

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo spec VRE-001 (UC5): override `VEHICLE_EVENT_HANDLER` (UC4) sang impl thật — nhận VehicleEvent (đã normalize) → tra `vehicle_registrations` theo plateNumber → matched/unmatched → persist `iot_device_events` (event_type='ivss_vehicle_event', C1-isolation). Mirror face ingestion (IPI-001). RECON schema thật. OQ chờ chốt. | Toàn bộ |
| 2026-06-24 | Thiếu Chủ CHỐT OQ-1…5: OQ-1=resolve active+living, disabled→unmatched · OQ-2=room/meeting ghi null · OQ-3=map tạm enter/leave/seen + owed live UC9 · OQ-4=ghi row unmatched (userId null) · OQ-5=tái dùng device IVSS-BRIDGE (chưa seed→skip+log). §8 ĐÃ CHỐT. | §8 |

> **SPEC-ONLY.** Chưa plan/tasks/code. Nền UC1-4 đã commit: entity + service biển + `normalizePlate` + webhook + **port `VEHICLE_EVENT_HANDLER`** (UC4 default log-only). UC5 = **override binding** sang `VehicleResolveService` (impl thật). Test bằng **mock VehicleEvent** (webhook giả), KHÔNG thiết bị. KHÔNG biển-lạ-cảnh-báo (UC6), KHÔNG query lịch sử (UC7), KHÔNG bridge (UC8), KHÔNG migration, KHÔNG sửa UC1-4 (chỉ đổi port binding).

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Face ingestion — KHUÔN MẪU CHÍNH ([ivss-presence-ingestion.service.ts:95-128](../../../../src/modules/ivss/services/ivss-presence-ingestion.service.ts))
- `onFaceEvent`: resolveBridgeDeviceId → resolveUser(szUid→`device_user_mappings`) → resolveRoom → matchState → **INSERT `iot_device_events`** (raw SQL, `DataSource.manager.query`, bind tham số):
  ```
  INSERT INTO iot_device_events (device_id, room_id, meeting_id, event_type, event_time,
    source_protocol, severity, payload_json, processed_status)
  VALUES ($1,$2,$3,'ivss_face_event',$4,'ivss','info',$5::jsonb,$6)
  ```
- **NotThrow** (webhook always-ack). `processed_status='processed'` khi matched, `'unmatched'` khi không. **userId nằm trong `payload_json`** (KHÔNG cột riêng). ⇒ UC5 mirror y hệt, đổi `event_type='ivss_vehicle_event'`, resolve theo plateNumber.

### 0.2. Schema `iot_device_events` ([iot-device-event.entity.ts](../../../../src/modules/iot/entities/iot-device-event.entity.ts))
- **`device_id` uuid NOT NULL** (FK `iot_devices` ON DELETE CASCADE) — cột domain DUY NHẤT bắt buộc.
- **`room_id` nullable** ✓, **`meeting_id` nullable** ✓ → ANPR ghi `null` (KHÔNG cần sentinel — giải OQ-2).
- `event_type` varchar(60), `source_protocol` varchar(30), `processed_status` varchar(30), `severity` varchar(20) — **KHÔNG DB CHECK** (face dùng giá trị ngoài enum `'ivss_face_event'`/`'ivss'`) → vehicle dùng `'ivss_vehicle_event'`/`'ivss'` OK.
- `payload_json` jsonb nullable, `event_time` default now(), `error_message` nullable, `created_at` auto.
- **KHÔNG cột `user_id`** — userId/plateNumber/direction/matchState lưu trong `payload_json` (mirror face).

### 0.3. Bridge device resolve (cho device_id NOT NULL)
- Face `resolveBridgeDeviceId()`: `SELECT id FROM iot_devices WHERE device_code='IVSS-BRIDGE' AND device_type='ivss_bridge' LIMIT 1` → null → log + skip. ⇒ UC5 cần `device_id` → **tái dùng device `IVSS-BRIDGE`** (cùng 1 bridge gửi face+vehicle) (OQ-5).

### 0.4. vehicle_registrations + service ([vehicle-registration.entity.ts](../../../../src/modules/anpr/entities/vehicle-registration.entity.ts), [vehicle-registration.service.ts](../../../../src/modules/anpr/services/vehicle-registration.service.ts))
- Cột: `plate_number`(varchar16, partial-unique WHERE deleted_at IS NULL), `user_id`, `status`('active'/'disabled'), `deleted_at`. ⇒ resolve: `WHERE plate_number=$1 AND status='active' AND deleted_at IS NULL`.
- `VehicleRegistrationService`: có `register`/`updateMetadata`/`setStatus`/`softDeleteOwned`/`list`/`getDetail`/`loadOwned`(private) — **KHÔNG method query-by-plate** → UC5 cần resolve riêng (raw SQL mirror face, hoặc method mới). Partial-unique đảm bảo **≤1 living row/plate** → tra LIMIT 1 an toàn (OQ-1).

### 0.5. Port UC4 ([vehicle-event-hook.ts](../../../../src/common/ports/vehicle-event-hook.ts))
- `VEHICLE_EVENT_HANDLER` + `VehicleEventHandlerPort.onVehicleEvent(evt: VehicleEvent)`. `VehicleEvent = { plateRaw, plateNumber(đã normalize), channelId, utc, eventAction?, plateColor?, vehicleColor?, vehicleType?, imageBase64? }`. ⇒ UC5 `VehicleResolveService implements VehicleEventHandlerPort`.

### 0.6. eventAction→direction (mẫu face `normalizeDirection`)
- Face: `ENTER_ACTIONS={enter,in,1}`, `LEAVE_ACTIONS={leave,out,exit,2}`, else→`'seen'`. ⇒ UC5 mirror cho vehicle (OQ-3); giá trị thật camera chưa biết → owed chốt khi live (UC9).

---

## 1. Scope (UC5)
1. **`VehicleResolveService implements VehicleEventHandlerPort`** (module `anpr`): `onVehicleEvent(evt)` → resolve + persist.
2. **Resolve**: tra `vehicle_registrations` theo `evt.plateNumber` (đã normalize từ UC4) + `status='active'` + `deleted_at IS NULL` → khớp → `matched` + `userId`; không khớp → `unmatched` + `userId=null` (biển lạ — UC5 CHỈ ghi unmatched).
3. **Persist** `iot_device_events`: `event_type='ivss_vehicle_event'` (C1-isolation), `device_id`=IVSS-BRIDGE, `room_id`/`meeting_id`=null, payload_json (plate/user/direction/matchState…), `processed_status` matched→`processed`/unmatched→`unmatched`. NotThrow (always-ack UC4).
4. **direction** từ `evt.eventAction` (map tạm, OQ-3); absent/lạ → `'seen'` (KHÔNG vứt event).
5. **Override binding**: `{ provide: VEHICLE_EVENT_HANDLER, useExisting: VehicleResolveService }` (thay default log-only UC4).

### NGOÀI scope (UC sau)
- KHÔNG biển-lạ-cảnh-báo chi tiết (UC6 — UC5 chỉ ghi unmatched). KHÔNG query lịch sử (UC7). KHÔNG bridge (UC8). KHÔNG camera. KHÔNG migration. KHÔNG sửa logic UC1-4.

## 2. VehicleResolveService (đề xuất — mirror face ingestion)
- Inject `DataSource` (raw SQL bind, mirror face). `onVehicleEvent(evt)`:
  1. `deviceId = resolveBridgeDeviceId()` (IVSS-BRIDGE) → null → log + return (chưa seed bridge).
  2. `userId = resolveUserByPlate(evt.plateNumber)` (§4).
  3. `direction = normalizeVehicleDirection(evt.eventAction)` (§5).
  4. `matchState = userId ? 'matched' : 'unmatched'`; `processedStatus = matched ? 'processed' : 'unmatched'`.
  5. `eventTime = parseUtc(evt.utc)` (mirror face: ISO + skew → fallback now).
  6. INSERT `iot_device_events` (§3). **NotThrow** (try/catch, log metadata — webhook UC4 always-ack).
- SEC-01: payload KHÔNG `imageBase64`; KHÔNG log ảnh.

## 3. Persist mapping — `iot_device_events`
| Cột | Giá trị |
| :--- | :--- |
| `device_id` | IVSS-BRIDGE device id (OQ-5) |
| `room_id` / `meeting_id` | **null** (ANPR không gắn phòng/họp — nullable §0.2) |
| `event_type` | `'ivss_vehicle_event'` (C1-isolation) |
| `event_time` | parseUtc(evt.utc) |
| `source_protocol` | `'ivss'` |
| `severity` | `'info'` |
| `processed_status` | matched→`'processed'` / unmatched→`'unmatched'` |
| `payload_json` | `{ plateRaw, plateNumber, userId, channelId, direction, matchState, eventActionRaw, plateColor?, vehicleColor?, vehicleType?, utc, receivedAt }` — **KHÔNG imageBase64** |

## 4. Resolve query (đề xuất)
```
SELECT user_id FROM vehicle_registrations
WHERE plate_number = $1 AND status = 'active' AND deleted_at IS NULL
LIMIT 1
```
- Partial-unique (deleted_at null) → ≤1 living row/plate (OQ-1). `status='active'` → biển `disabled` KHÔNG khớp (treat unmatched — biển bị chủ tắt). Khớp → userId; không → null.

## 5. direction mapping (OQ-3 — owed chốt khi live)
- `normalizeVehicleDirection(eventAction)`: `{in, entry, enter, 1}`→`enter`; `{out, exit, leave, 2}`→`leave`; absent/lạ→`seen`. Mirror face. ⚠ Giá trị thật camera CHƯA biết → **owed chốt mapping khi live (UC9)**.

## 6. Requirements (EARS)
- **R1**: **WHEN** `onVehicleEvent(evt)` với biển khớp 1 `vehicle_registrations` active **→** persist row `matched` + `userId` trong payload, `processed_status='processed'`.
- **R2**: **IF** biển KHÔNG khớp (không có / disabled / đã xóa-mềm) **→** persist row `unmatched` + `userId=null`, `processed_status='unmatched'` (UC6 xử cảnh báo).
- **R3 (C1-isolation)**: **WHILE** persist, `event_type='ivss_vehicle_event'` — KHÔNG đụng/nhiễm dữ liệu face (`ivss_face_event`).
- **R4 (no room/meeting)**: **WHILE** persist, `room_id`/`meeting_id`=null (ANPR không gắn phòng/họp).
- **R5 (direction)**: **WHEN** event có `eventAction` map được **→** direction enter/leave; absent/lạ **→** `'seen'` (KHÔNG vứt event).
- **R6 (NotThrow)**: **IF** lỗi (DB/resolve) **→** log metadata, KHÔNG ném ra (webhook UC4 always-ack). KHÔNG log imageBase64.
- **R7 (device)**: **IF** device IVSS-BRIDGE chưa seed **→** log + skip (KHÔNG crash).
- **R8 (boundary)**: UC5 chỉ resolve+persist — KHÔNG cảnh báo biển lạ (UC6), KHÔNG đụng UC1-4 logic.

## 7. Constitution
- **DATA-01 (C1-isolation)**: `event_type='ivss_vehicle_event'`; mọi query vehicle filter theo event_type → KHÔNG nhiễm face. `source_protocol='ivss'`.
- **DATA-02 (no-migration)**: tái dùng `iot_device_events` + `vehicle_registrations` (đã có). device_id = seed IVSS-BRIDGE (data, không migration).
- **DATA-03 (normalize đã làm UC4)**: UC5 nhận `evt.plateNumber` ĐÃ normalize (UC4) → tra DB khớp `plate_number` (UC1 đăng-ký cùng `normalizePlate`). UC5 KHÔNG normalize lại.
- **ARCH-01 (port override)**: UC5 implement `VehicleEventHandlerPort`; bind `useExisting` (thay default UC4). Mirror face ingestion (raw SQL bind, NotThrow).
- **SEC-01**: payload/log KHÔNG `imageBase64`; raw SQL bind tham số (SEC-03).
- **SEC-02 (unmatched privacy)**: row unmatched KHÔNG gắn user; cảnh báo/giải biển lạ là UC6.

## 8. OPEN QUESTIONS — ĐÃ CHỐT
- **OQ-1 resolve — CHỐT**: `plate_number=$1 AND status='active' AND deleted_at IS NULL LIMIT 1`. Biển **`disabled` → unmatched** (chủ đã tắt). Partial-unique → ≤1 living row.
- **OQ-2 room/meeting — CHỐT**: ghi `null` (nullable, KHÔNG sentinel).
- **OQ-3 direction — CHỐT**: map tạm `{in,entry,enter,1}→enter / {out,exit,leave,2}→leave / else→'seen'`; fallback `'seen'` KHÔNG vứt event. **Owed: chốt mapping thật khi live (UC9)** — giá trị `eventAction` camera chưa biết.
- **OQ-4 unmatched — CHỐT**: ghi row `unmatched` (userId null trong payload) để UC6/UC7 thấy biển lạ. KHÔNG bỏ qua.
- **OQ-5 device_id — CHỐT**: tái dùng device `IVSS-BRIDGE` (cùng bridge, C1-isolation theo event_type). Seed device = owed runbook; chưa seed → UC5 **skip+log** (KHÔNG crash).

## 9. Residuals / known-gaps
- **Live owed**: luồng thật khi bridge (UC8) gửi event theo §3-contract UC4; UC5 test bằng **mock VehicleEvent**.
- **Seed IVSS-BRIDGE device** (OQ-5): owed runbook (mirror face) — `device_code='IVSS-BRIDGE'` phải tồn tại, nếu không UC5 skip+log.
- **direction mapping**: chốt khi live (UC9) — giá trị `eventAction` thật camera/bridge.
- **Biển disabled**: UC5 coi unmatched (OQ-1) — nếu cần phân biệt "biển có đăng ký nhưng tắt" thì thêm state sau (UC6/UC7).
- **Multi-plate/user**: 1 user nhiều biển (UC1) — UC5 resolve theo biển → ra đúng user; không cần xử multi.
- **Channel→cổng map**: UC5 KHÔNG map channel→phòng (khác face) — chỉ lưu channelId trong payload; diễn giải cổng để UC7/analytics.

> **STOP.** Spec-only. Chờ Thiếu Chủ review §0 RECON (đặc biệt schema + C1-isolation) + chốt OQ-1…OQ-5 trước khi plan/tasks. KHÔNG tự code.
