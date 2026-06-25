# VRE-001 — tasks.md (UC5 ANPR: resolve biển→user + persist iot_device_events)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo tasks VRE-001: T0 verify → T1 VehicleResolveService (onVehicleEvent + 4 helper) → T1b test → T2 wiring (override binding useExisting) → T-GATE. Mỗi task 1 AC, code/test tách. Mirror face ingestion. No-migration, C1-isolation. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. No-migration. KHÔNG đụng logic UC1-4 (chỉ đổi port binding) · KHÔNG dùng `VehicleRegistrationService` (raw query riêng). UC1-4 KHÔNG hồi quy.

## Thứ tự
T0 → T1 → T1b → T2 → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận đọc CODE THẬT: `ivss-presence-ingestion.service.ts` (INSERT cột + bind params + `parseUtc` + `normalizeDirection` để mirror); schema `iot_device_events` (`device_id` NOT NULL, `room_id`/`meeting_id` nullable, **KHÔNG cột `user_id`**, `event_type` no-CHECK); `DataSource` inject pattern; port `VEHICLE_EVENT_HANDLER` + binding hiện `useClass: DefaultVehicleEventHandler` trong `anpr.module`; `vehicle_registrations` cột `plate_number`/`user_id`/`status`/`deleted_at`.
- **AC**: dán xác nhận 5 mục; thiếu/path sai → **DỪNG báo Thiếu Chủ** (không bịa).

## T1 — Service `VehicleResolveService` (code) — plan §2-5, DATA-01/03, SEC-01/03, OQ-1/3/5
- `src/modules/anpr/services/vehicle-resolve.service.ts`: `@Injectable implements VehicleEventHandlerPort`, inject `DataSource`.
- `onVehicleEvent(evt)` (toàn thân **try/catch NotThrow**, log metadata khi lỗi):
  1. `resolveBridgeDeviceId()` (`SELECT id FROM iot_devices WHERE device_code='IVSS-BRIDGE' AND device_type='ivss_bridge' LIMIT 1`) → null → log + return (KHÔNG INSERT).
  2. `resolveUserByPlate(evt.plateNumber)` (`WHERE plate_number=$1 AND status='active' AND deleted_at IS NULL LIMIT 1`) → userId | null. **KHÔNG normalize lại** (DATA-03).
  3. `normalizeVehicleDirection(evt.eventAction)` → enter/leave/seen.
  4. `matchState = userId ? 'matched':'unmatched'`; `processedStatus = userId ? 'processed':'unmatched'`.
  5. `parseUtc(evt.utc)` (ISO + |skew|≤1h → t; else now).
  6. payload `{plateRaw, plateNumber, userId, channelId, direction, matchState, eventActionRaw, plateColor?, vehicleColor?, vehicleType?, utc, receivedAt}` — **KHÔNG imageBase64**.
  7. INSERT `iot_device_events` (`event_type='ivss_vehicle_event'`, room/meeting literal NULL, bind params).
- 4 private helper: `resolveBridgeDeviceId`/`resolveUserByPlate`/`normalizeVehicleDirection`/`parseUtc` (mirror face). SEC-03 bind, KHÔNG nối chuỗi.
- **AC**: matched→INSERT processed+userId; unmatched→INSERT unmatched+null; event_type='ivss_vehicle_event'; room/meeting NULL; NotThrow; device null→skip; KHÔNG imageBase64.

## T1b — Service test (mock DataSource) — DATA-01, OQ-1/3/4, SEC-01
- **matched**: bridge OK + resolveUserByPlate trả userId → INSERT `processed_status='processed'`, payload.userId set.
- **unmatched** (×3 nhánh hợp 1: resolve trả null = không có/disabled/đã-xóa) → INSERT `unmatched`, payload.userId=null (OQ-4).
- **C1**: SQL INSERT chứa `'ivss_vehicle_event'` (KHÔNG `ivss_face_event`).
- **room/meeting NULL**: assert INSERT literal NULL (hoặc bind null) cho room_id/meeting_id.
- **direction**: eventAction `'in'`→enter · `'out'`→leave · absent/lạ→`'seen'` (3 ca).
- **parseUtc**: utc rác / lệch >1h → eventTime = Date now (không NaN).
- **NotThrow**: query/INSERT ném lỗi → `onVehicleEvent` resolve (KHÔNG ném), log.
- **device chưa seed**: resolveBridgeDeviceId trả [] → KHÔNG INSERT (assert INSERT không gọi), log+return.
- **SEC-01**: payload (param JSON) KHÔNG chứa `imageBase64` dù evt có.
- **AC**: các nhánh xanh; coverage ≥80% (gộp T-GATE).

## T2 — Module wiring `anpr.module.ts` (code) — plan §6, ARCH-01
- providers: thêm `VehicleResolveService`; đổi `{ provide: VEHICLE_EVENT_HANDLER, useExisting: VehicleResolveService }` (thay `useClass: DefaultVehicleEventHandler`). **Giữ `DefaultVehicleEventHandler` registered** (fallback, mirror face). KHÔNG đụng UC1-4 controller/service khác.
- **AC**: AppModule compile, 0 circular/UnknownDependencies; `VEHICLE_EVENT_HANDLER` resolve `VehicleResolveService` (KHÔNG còn log-only).

## T-GATE — (STOP, KHÔNG commit) — plan §9
- build=0; eslint touched (service + spec + module) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh (**UC1-4 KHÔNG hồi quy + UC5 mới**; đặc biệt UC4 webhook test vẫn xanh — mock handler port); coverage **≥80%** `vehicle-resolve.service.ts`; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies, `VEHICLE_EVENT_HANDLER`→VehicleResolveService); throwaway xóa. **KHÔNG live, KHÔNG DB, KHÔNG commit.**
- Nếu sửa eslint: **đọc lại file sau khi sửa**, KHÔNG sed/regex hàng loạt làm rỗng assertion.
- In: code đầy đủ file + jest + coverage + báo cáo gate.
- **Owed runbook (ghi, KHÔNG chạy)**: seed device `IVSS-BRIDGE` (`ivss_bridge`) nếu chưa có — thiếu → UC5 skip+log · chốt direction mapping khi live (UC9) · UC8 bridge gửi event theo §3-contract UC4 · UC6 biển-lạ-cảnh-báo (đọc row unmatched) · UC7 query lịch sử.
- **AC**: bảng gate đầy đủ + báo cáo: C1-isolation event_type ✓ · room/meeting NULL ✓ · resolve matched/unmatched (disabled→unmatched) ✓ · userId trong payload (không cột) ✓ · direction map ✓ · parseUtc fallback ✓ · NotThrow ✓ · device chưa seed skip ✓ · SEC-01 không imageBase64 + SEC-03 bind ✓ · binding override useExisting (Default giữ fallback) ✓ · KHÔNG đụng UC1-4/VehicleRegistrationService ✓ · DATA-03 không normalize lại ✓ · UC1-4 không hồi quy ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC5
- T0 → verify face-ingestion-mẫu/schema/port-binding/vehicle_registrations
- T1/T1b → `VehicleResolveService` (resolve+persist, mirror face, C1-isolation, NotThrow)
- T2 → wiring đổi binding `useExisting: VehicleResolveService` (giữ Default fallback)
- T-GATE → gate + STOP + Owed runbook (seed IVSS-BRIDGE · direction live UC9 · UC8 · UC6 · UC7)
