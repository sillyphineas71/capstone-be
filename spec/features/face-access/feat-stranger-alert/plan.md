# SAL-001 — PLAN

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo plan SAL-001 — hook port stranger, StrangerAlertService (throttle/WS/notif/email-opt-in), iot wiring (strip-tại-nguồn + hook try/catch), read-list admin. KHÔNG migration. | Toàn bộ |

## 1. Technical Context (verified — §RECON spec)
- `receiveStrangerEvent` (iot) lưu raw `iot_device_events` (`event_type='face_stranger'`) + `device.metadataJson.{last,recent}_stranger_event_sample`. `newSample.raw_payload_sample = maskSensitiveMetadata({...body})` feed **CẢ** payload_json **LẪN** recent samples (cùng nguồn) → strip 1 chỗ phủ cả hai.
- Chưa có hook stranger (chỉ `FACE_VERIFY_HOOK`). `WebsocketService.emitToRoom(room,event,data)`; `NotificationsService.createNotification(dto)` / `enqueueEmailNotification(dto)`.
- `iot_device_events` không có cột review → review-state defer (migration Tài).
- face-access `@Global` (đã có), cần `AuthModule`/`JwtModule` cho read-list `JwtAuthGuard` (mẫu iot/rooms/UMR).

## 2. Kiến trúc (tái dùng, KHÔNG module mới, KHÔNG migration)
```
Door Terminal stranger (sf/:deviceCode/:token)
  → iot.receiveStrangerEvent
      → [FR-008] stripSanpPic(payloadToMask)  ← TRƯỚC build newSample (phủ payload_json + recent samples)
      → store raw + update device metadata (giữ nguyên, chạy TRƯỚC)
      → [hook] @Optional STRANGER_ALERT_HOOK.onStranger(evt)  trong try/catch (không hỏng 200)
            → StrangerAlertService (face-access):
               throttle Map<deviceId,lastAlertAt> (gate ALERT, KHÔNG gate raw)
               trong window → bỏ qua
               ngoài window → WS emitToRoom('room:<roomId>',...) (null-room-safe)
                            + createNotification(admins, 'stranger_alert', metadata-only)
                            + nếu STRANGER_ALERT_EMAIL_ENABLED → enqueueEmailNotification
Admin
  GET /api/v1/face-access/stranger-alerts  → StrangerAlertService.list()
      → query iot_device_events (face_stranger, window) — KHÔNG select payload/base64
```

## 3. Files
### Mới
| File | Nội dung |
| :--- | :--- |
| `src/common/ports/stranger-alert-hook.ts` | token `STRANGER_ALERT_HOOK` (Symbol) + `interface StrangerAlertHook { onStranger(evt: StrangerAlertInput): Promise<void> }` + `StrangerAlertInput { deviceId, deviceCode, roomId, strangerId, similarity, capturedAt }`. **Mẫu y hệt `face-verify-hook.ts`** (leaf, no import → no cycle). |
| `src/modules/face-access/services/stranger-alert.service.ts` | `StrangerAlertService implements StrangerAlertHook`. throttle Map + WS + createNotification + email-opt-in. `list(query)` cho read-list. Inject `DataSource`, `ConfigService`, `WebsocketService`, `NotificationsService`. |
| `src/modules/face-access/controllers/stranger-alert.controller.ts` | `GET /api/v1/face-access/stranger-alerts` — `JwtAuthGuard` + Mock PermissionsGuard + `@Permissions('face.stranger.read')` (mẫu UMR controller). |
| `src/modules/face-access/dto/list-stranger-alerts.query.dto.ts` | page/limit (max 100) + windowMinutes optional (mẫu UMR list DTO). |

### Sửa
| File | Hành động |
| :--- | :--- |
| `src/modules/iot/services/iot-devices.service.ts` | (a) **FR-008** `stripSanpPic(payloadToMask)` ngay sau khi tạo `payloadToMask` (trước truncate/mask/newSample) → phủ payload_json + recent samples. (b) Sau khi commit lưu raw, `@Optional() @Inject(STRANGER_ALERT_HOOK)` → `onStranger({...})` trong **try/catch** (log lỗi, không throw). KHÔNG đổi logic stranger khác. |
| `src/modules/face-access/face-access.module.ts` | +controller `StrangerAlertController`; +provider `StrangerAlertService`; +`{ provide: STRANGER_ALERT_HOOK, useExisting: StrangerAlertService }`; +export hook token; +imports `WebsocketModule`/`NotificationsModule` (cho WS/Notif), `AuthModule`/`JwtModule` (read-list guard — nếu chưa có). |
| `src/config/env.validation.ts` | +`STRANGER_ALERT_THROTTLE_SECONDS` (Joi int default 300), +`STRANGER_ALERT_WINDOW_MINUTES` (int default 1440), +`STRANGER_ALERT_EMAIL_ENABLED` (bool default false). Chỉ chèn dòng scoped, KHÔNG prettier cả file. |
| `.env.example` | +3 env trên. |

## 4. StrangerAlertService.onStranger(evt)
```
now = Date.now()
last = this.lastAlertAt.get(evt.deviceId)
throttleMs = config.STRANGER_ALERT_THROTTLE_SECONDS * 1000
if (last && now - last < throttleMs) return     // throttle hit → bỏ qua (raw vẫn đã lưu ở iot)
this.lastAlertAt.set(evt.deviceId, now)
if (evt.roomId) ws.emitToRoom(`room:${evt.roomId}`, 'face.stranger.alert', metadata)  // null-room-safe
await notifications.createNotification({ notificationType:'stranger_alert', recipientScope: admins,
    payloadJson: { deviceId, roomId, strangerId, similarity, capturedAt } })           // metadata-only
if (config.STRANGER_ALERT_EMAIL_ENABLED) await notifications.enqueueEmailNotification({... admins, metadata-only})
```
- throttle **chỉ gate ALERT** — KHÔNG gate lưu raw (raw lưu ở iot trước hook) → read-list vẫn thấy đủ event.
- mọi nhánh metadata-only (không base64).

## 5. StrangerAlertService.list(query) (mẫu UMR list)
```sql
SELECT e.device_id,
       e.payload_json->'extracted_fields'->>'stranger_id' AS stranger_id,
       MAX(e.created_at) AS last_seen,
       COUNT(*)::int     AS hit_count,
       (array_agg(e.room_id ORDER BY e.created_at DESC))[1] AS room_id,
       (array_agg(e.payload_json->'extracted_fields'->>'similarity' ORDER BY e.created_at DESC))[1] AS similarity
  FROM iot_device_events e
 WHERE e.event_type = 'face_stranger'
   AND e.created_at >= now() - ($1 * interval '1 minute')
 GROUP BY e.device_id, stranger_id
 ORDER BY last_seen DESC
 LIMIT $2 OFFSET $3
```
- **KHÔNG** select `payload_json` thô / `raw_payload_sample` → không lộ base64 (SEC-02).
- Response: `{ deviceId, strangerId, roomId, similarity, lastSeen, hitCount }`.

## 6. Quyết định
- Hook ở `common` (no-cycle) + face-access `@Global useExisting` (mẫu FAT-001).
- strip-tại-nguồn (1 chỗ) phủ cả 2 nơi lưu (payload_json + recent samples).
- throttle in-memory (MVP, limitation single-instance/restart đã ghi spec §3.1 FR-003).
- review/dismiss = out-of-scope (migration Tài).
- KHÔNG migration; raw parameterized; KHÔNG đụng verify path.
