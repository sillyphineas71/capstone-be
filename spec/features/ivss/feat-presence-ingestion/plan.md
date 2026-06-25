# IPI-001 — plan.md (#38+#39 IVSS per-person presence ingestion)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo plan IPI-001 sau spec DUYỆT (OQ-1…7 + C1–C3). Handler thật impl IvssEventHandlerPort: resolve identity+location → persist iot_device_events (device=bridge) → derive direction defensive. Né migration. C1 RECON occupancy isolation. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. C1 — Occupancy/no-show isolation (RECON code thật, KẾT LUẬN)
Grep + đọc **mọi** nơi đọc `iot_device_events`:
- **occupancy-ingest** ([occupancy-ingest.service.ts:130](../../../../src/modules/presence/services/occupancy-ingest.service.ts)): **chỉ INSERT**, KHÔNG SELECT → không bị nhiễm.
- **stranger-alert** ([stranger-alert.service.ts:164-165](../../../../src/modules/face-access/services/stranger-alert.service.ts)): `WHERE e.event_type = 'face_stranger'`.
- **unmapped-review** ([unmapped-review.service.ts:67-68](../../../../src/modules/face-access/services/unmapped-review.service.ts) + [:153-154](../../../../src/modules/face-access/services/unmapped-review.service.ts)): cả 2 query `WHERE e.event_type = 'face_verify'`.
- **no-show / early-vacancy / reports**: **KHÔNG đọc `iot_device_events`** (đọc `presence_snapshots` / `room_booking_usages` / `room_events`).

**KẾT LUẬN**: mọi SELECT hiện có trên `iot_device_events` **đã lọc `event_type` cụ thể** (`face_verify` / `face_stranger`). IVSS dùng **`event_type='ivss_face_event'` (mới, distinct)** ⇒ **KHÔNG query nào vợt nhầm row IVSS**. occupancy/no-show/early-vacancy **không chạm bảng này**. ⇒ **Tự cô lập bằng `event_type`, KHÔNG cần patch** (không có query nào cần thêm WHERE). Test 2 chiều: (a) IVSS INSERT dùng `event_type='ivss_face_event'`; (b) (ghi nhận) các query face-access lọc `face_verify`/`face_stranger` — KHÔNG sửa, KHÔNG nới lỏng. (Nếu sau này có query vợt mọi event_type → mới cần patch; hiện KHÔNG.)

## 1. Quyết định đã chốt (OQ)
OQ-1 `iot_device_events` device_id=bridge, per-identity trong payload_json (`event_type='ivss_face_event'`, `source_protocol='ivss'`) — **né migration** · OQ-2 `system_configs` key `ivss.channel_room_map` (config_json) · OQ-3 defensive lai (eventAction biết→enter/leave, lạ→seen; leave-by-timeout **DEFER**) · OQ-4 tách track riêng (KHÔNG đụng presence_snapshots/occupancy) · OQ-5 log+metric+skip + **lưu unknown** (`processed_status='unmatched'`, `direction='unknown'`) · OQ-6 chấp nhận trùng v1 (no dedup) · OQ-7 gắn `meeting_id` best-effort lúc ingest.

## 2. IvssPresenceIngestionService (impl IvssEventHandlerPort)
- Inject: `DataSource`, `ConfigService` (đọc channel-map qua `system_configs`).
- Implements `onFaceEvent(evt: IvssFaceEvent): Promise<void>` — **KHÔNG throw** (webhook always-ack). SEC-03 bind tham số.
- Helpers: `resolveUser(szUid)`, `getChannelRoomMap()`, `resolveBridgeDeviceId()` (find only — #37 đã tạo), `resolveMeeting(roomId, eventTime)`, `normalizeDirection(eventAction)`, `parseUtc(evt.utc)` (C3), `persistEvent(...)`.

## 3. Luồng `onFaceEvent(evt)`
1. **Bridge device**: `SELECT id FROM iot_devices WHERE device_code='IVSS-BRIDGE' AND device_type='ivss_bridge' LIMIT 1`. Không có → log+skip (không thể INSERT vì `device_id` NOT NULL; #37 đáng lẽ đã tạo).
2. **Identity**: `szUid = evt.personUid` → `SELECT user_id FROM device_user_mappings WHERE device_person_id=$1 AND metadata_json->>'source'='ivss' AND deleted_at IS NULL LIMIT 1` → `userId | null`.
3. **Location**: `roomId = channelMap[String(evt.channelId)]` (validate uuid) → `roomId | null`.
4. **utc (C3)**: `parseUtc(evt.utc)` → Date hợp lệ (ISO, |skew|≤1h) → `eventTime`; sai/lệch xa → `eventTime = receivedAt(now)` + cờ `utcFallback:true` trong payload. KHÔNG để utc rác làm sai join.
5. **Meeting (OQ-7)**: nếu có roomId → `SELECT id FROM meetings WHERE room_id=$1 AND status='in_progress' AND $2 BETWEEN start_time AND end_time LIMIT 1` → `meetingId | null` (best-effort).
6. **Direction (OQ-3)**: `normalizeDirection(evt.eventAction)` → biết→`enter`/`leave`; lạ/thiếu→`seen`; (unmatched→`unknown`).
7. **Matched?** `userId && roomId` → `processed_status='processed'`; thiếu 1 trong 2 → **OQ-5 unmatched**: `processed_status='unmatched'`, `direction='unknown'`, vẫn persist (debuggable) + log+metric.
8. **Persist (#39, §7)**: INSERT `iot_device_events`.
9. catch DB lỗi → log, return (KHÔNG throw).

## 4. channel→room config (OQ-2)
`getChannelRoomMap(): Promise<Record<string,string>>`:
- `SELECT config_json FROM system_configs WHERE config_key='ivss.channel_room_map' AND is_active=true LIMIT 1`.
- Parse `config_json` = `{ "<channelId>": "<room_uuid>" }`. **Validate value là uuid** (regex) — bỏ entry sai. Thiếu config → `{}` (mọi channel → unmatched).
- (Tùy chọn) cache TTL ngắn để giảm query — v1 đọc mỗi event chấp nhận (volume thấp); ghi note.

## 5. Provider swap (C2)
`ivss.module.ts`: providers thêm `IvssPresenceIngestionService`; đổi `{ provide: IVSS_EVENT_HANDLER, useExisting: DefaultIvssEventHandler }` → `useExisting: IvssPresenceIngestionService`. **Giữ `DefaultIvssEventHandler` registered** (trong providers, không bind token) — fallback/log. Webhook spec (#36) mock handler port → swap KHÔNG ảnh hưởng; chạy lại `npx jest src/modules/ivss` chứng minh 0 hồi quy. IvssModule cần import gì? chỉ DataSource (global TypeOrm) + ConfigService (global) → KHÔNG thêm import module.

## 6. utc parse (C3)
`parseUtc(raw)`: `new Date(raw)` → `isNaN` hoặc `|now - t| > 1h` → `{ eventTime: now, fallback: true }`; else `{ eventTime: t, fallback: false }`. eventTime dùng cho `event_time` (tstz) + join meeting; payload ghi `utc:raw` + `utcFallback`.

## 7. Storage payload (OQ-1) — iot_device_events
INSERT cột NOT NULL + payload:
- `device_id = <bridge>`, `room_id = roomId|null`, `meeting_id = meetingId|null`, `event_type='ivss_face_event'`, `event_time = eventTime`, `source_protocol='ivss'`, `severity='info'`, `processed_status = 'processed'|'unmatched'`, `payload_json = { szUid, userId, channelId, roomId, meetingId, direction, eventActionRaw, similarity, name, utc, utcFallback, receivedAt }`.
- **SEC-01: KHÔNG `imageBase64`** trong payload/log; szUid metadata-only.

## 8. File list
### Net-new
- `src/modules/ivss/services/ivss-presence-ingestion.service.ts` (+ `.spec.ts`).
### Modified
- `src/modules/ivss/ivss.module.ts` — provider swap (C2) + add service.
> **KHÔNG** đụng face-access/occupancy/no-show files (C1 = không cần patch). KHÔNG env mới, KHÔNG migration, KHÔNG scheduler.

## 9. Test (mock DataSource keyword + mock channel-map — KHÔNG thiết bị)
- known person+channel → INSERT `iot_device_events` `event_type='ivss_face_event'` + payload có userId/roomId/direction, `processed_status='processed'`.
- unknown szUid (mapping rỗng) → `unmatched` + `direction='unknown'` (vẫn persist).
- unknown channel (map rỗng) → `unmatched`.
- eventAction lạ → `direction='seen'`; eventAction biết → enter/leave.
- DB lỗi (INSERT throw) → **KHÔNG throw** (resolves).
- **SEC**: payload KHÔNG chứa imageBase64.
- **C1**: assert INSERT dùng `event_type='ivss_face_event'` (≠ face_verify/face_stranger).
- **C3**: utc rác → eventTime fallback now + payload `utcFallback:true`.
- bridge device không có → skip (no INSERT).
- Coverage **≥80%** `ivss-presence-ingestion.service.ts`.

## 10. Gate (STOP, KHÔNG commit)
- build=0; eslint touched+spec baseline-proof (stash `ivss.module.ts`) 0 rule mới, file mới 0; `npx jest src/modules/ivss` xanh (gồm webhook spec #36 — C2 0 hồi quy); coverage ≥80% service; DI-proof compile AppModule (Redis infra-fail OK, 0 circular/UnknownDependencies). **KHÔNG live.**
- **Owed live (C1-runbook)**: channel→room map thật (channelId vật lý ↔ room_id) ghi vào `system_configs`; eventAction thật bridge gửi (chốt mapping enter/leave); szUid round-trip (event szUid khớp `device_person_id` #37).

## 11. Kỷ luật
- **Né migration**: dùng `iot_device_events`; nếu phát hiện buộc cột mới → **DỪNG báo**. KHÔNG tạo `ivss_events`.
- **SEC-01** imageBase64 KHÔNG lưu/log; szUid metadata-only. **SEC-03** bind tham số mọi raw SQL + validate channel-map uuid. **ARCH-01** qua port `IVSS_EVENT_HANDLER`, KHÔNG NetSDK; **KHÔNG đụng occupancy/no-show path** (OQ-4 — C1 xác nhận distinct event_type). **DATA-01** no-migration.
- Handler KHÔNG throw (webhook always-ack). KHÔNG WS (#40)/report (#43).

> **STOP.** Plan + tasks chờ review trước khi code.
