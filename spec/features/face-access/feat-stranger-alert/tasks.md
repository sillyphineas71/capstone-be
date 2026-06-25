# SAL-001 — TASKS

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo tasks SAL-001 — T1 hook, T2 service, T3 iot wiring, T4 read-list, T5 module/env, T6 tests, T7 gate. | Toàn bộ |

## Implementation
- [ ] **T1** — `common/ports/stranger-alert-hook.ts`: token `STRANGER_ALERT_HOOK` (Symbol) + `interface StrangerAlertHook { onStranger(evt: StrangerAlertInput): Promise<void> }` + `StrangerAlertInput { deviceId, deviceCode, roomId, strangerId, similarity, capturedAt }`. Mẫu y hệt `face-verify-hook.ts` (leaf, no import).
- [ ] **T2** — `face-access/services/stranger-alert.service.ts` (`implements StrangerAlertHook`):
  - `onStranger`: throttle `Map<deviceId,lastAlertAt>` (gate ALERT, KHÔNG gate raw) → window-hit: bỏ qua; window-miss: `ws.emitToRoom('room:<roomId>',…)` (null-room-safe) + `createNotification(admins,'stranger_alert', metadata-only)` + nếu `STRANGER_ALERT_EMAIL_ENABLED` → `enqueueEmailNotification`.
  - `list(query)`: SQL §5 plan (face_stranger, window, KHÔNG select payload/base64).
  - inject `DataSource, ConfigService, WebsocketService, NotificationsService`.
- [ ] **T3** — `iot-devices.service.ts` `receiveStrangerEvent`:
  - (a) **FR-008** `stripSanpPic(payloadToMask)` TRƯỚC build `newSample` (phủ payload_json + recent_stranger_event_samples).
  - (b) sau commit lưu raw → `@Optional() @Inject(STRANGER_ALERT_HOOK)` gọi `onStranger({...})` trong **try/catch** (log, không throw → response 200 nguyên). KHÔNG đổi logic khác.
- [ ] **T4** — read-list: `stranger-alert.controller.ts` (`GET /face-access/stranger-alerts`, JwtAuthGuard + MockPermissionsGuard + `@Permissions('face.stranger.read')`) + `list-stranger-alerts.query.dto.ts` (page/limit max 100, windowMinutes optional).
- [ ] **T5** — `face-access.module.ts`: +controller, +`StrangerAlertService`, +`{provide: STRANGER_ALERT_HOOK, useExisting: StrangerAlertService}`, +imports `WebsocketModule`/`NotificationsModule`/`AuthModule`/`JwtModule` (nếu thiếu). env: 3 dòng Joi scoped + `.env.example`. KHÔNG prettier cả file.
- [ ] **T6** — tests ≥80% branch (xem checklist).
- [ ] **T7** — gate: build=0; eslint file mới/sửa 0 lỗi mới; jest ≥80% + regression `jest face-access iot scheduler`; **schema-verify** read-list SQL khớp entity `iot_device_events` (device_id/room_id/payload_json/created_at/event_type); **live read-only SELECT** câu read-list (window rộng, LIMIT 5) xác nhận EXECUTE không lỗi. STOP code-review gate, KHÔNG commit.

## Test checklist (≥80% branch)
### StrangerAlertService.onStranger
- [ ] **throttle miss** (chưa có / quá window): WS emit + createNotification gọi 1 lần; Map cập nhật.
- [ ] **throttle hit** (trong window): KHÔNG WS, KHÔNG createNotification (bỏ qua).
- [ ] **room null**: KHÔNG emitToRoom nhưng vẫn createNotification (admins).
- [ ] **email off** (`STRANGER_ALERT_EMAIL_ENABLED=false`): KHÔNG enqueueEmailNotification.
- [ ] **email on** (`=true`): có enqueueEmailNotification (metadata-only).
- [ ] payload notification/WS metadata-only (KHÔNG base64/snapshot).

### iot wiring (receiveStrangerEvent)
- [ ] **strip** → sau xử lý, `payload_json.raw_payload_sample` **VÀ** `recent_stranger_event_samples[].raw_payload_sample` đều `SanpPic='[stripped]'` (KHÔNG base64).
- [ ] **hook chưa-wired an toàn**: `@Optional` không có provider → bỏ qua, vẫn lưu raw + 200.
- [ ] **hook lỗi**: onStranger throw → try/catch nuốt → response 200 vẫn trả.
- [ ] lưu raw chạy TRƯỚC hook (raw có dù alert lỗi).

### read-list (controller + service)
- [ ] admin-only: guard gắn (JwtAuthGuard + permission).
- [ ] list trả stranger trong window (dedupe device+stranger, last_seen, hit_count); ngoài window → loại.
- [ ] response **KHÔNG** chứa `payload_json`/`raw_payload_sample`/base64 — chỉ device/room/time/similarity/stranger_id.
- [ ] phân trang LIMIT/OFFSET đúng; limit>100 chặn (DTO).

## Ràng buộc
- DATA-01 KHÔNG migration; SEC-02 admin-only; SEC-03 parameterized; NC-1 không deny; import `.js`.
- KHÔNG đụng verify path (FAT/DCO/UMR); hook `common` no-cycle (mẫu FACE_VERIFY_HOOK).
- review/dismiss state = out-of-scope (migration Tài). STOP code-review gate, chưa commit.
