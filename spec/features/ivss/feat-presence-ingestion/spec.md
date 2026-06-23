# IPI-001 — IVSS per-person presence ingestion (#38 enter/leave + #39 per-identity events)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo spec IPI-001 (#38+#39): thay IVSS_EVENT_HANDLER log-only bằng impl thật — resolve identity (szUid→user) + location (channel→room) → persist per-identity event → derive enter/leave. RECON code thật. OQ chờ chốt. | Toàn bộ |

> **SPEC-ONLY.** Chưa plan/tasks/code. Tái dùng webhook + port IVS-001 (#36) + mapping IPS-001 (#37, đã commit). KHÔNG realtime WS (#40), KHÔNG report #43.

---

## 0. RECON findings (đọc CODE THẬT)

### 0.1. Handler override (cách thay log-only bằng impl thật)
[ivss.module.ts:27](../../../../src/modules/ivss/ivss.module.ts): `{ provide: IVSS_EVENT_HANDLER, useExisting: DefaultIvssEventHandler }`. Port [ivss-event-hook.ts](../../../../src/common/ports/ivss-event-hook.js): `IvssEventHandlerPort { onFaceEvent(evt: IvssFaceEvent): Promise<void> }`, `IvssFaceEvent = { type, channelId:number, personUid, name?, similarity?, eventAction?, utc, imageBase64? }`.
- ⇒ Thay = **đổi provider** `useExisting: IvssPresenceIngestionService` (impl mới, leaf port). `DefaultIvssEventHandler` giữ lại (provider) làm fallback/log nếu cần. Webhook đã handoff + always-ack (R2 #36) → handler mới chỉ cần impl `onFaceEvent`, **lỗi vẫn ack** (webhook bọc try/catch sẵn).

### 0.2. szUid → user (resolve identity)
IPS-001 (#37) lưu mapping `device_user_mappings`: `device_person_id = szUid`, `device_person_code = personUid-gửi`, `metadata_json->>'source'='ivss'`, `device_id = bridge`, soft-delete `deleted_at`. Event `personUid = szUid` (theo #37 C3).
- ⇒ Resolve: `SELECT user_id FROM device_user_mappings WHERE device_person_id = $szUid AND metadata_json->>'source'='ivss' AND deleted_at IS NULL LIMIT 1` (mirror cách #37 đọc mapping; lọc source + soft-delete). Không khớp → **unknown person → log+skip** (OQ-5).

### 0.3. Storage per-identity event (CRUX — feasibility)
- **`ivss_events` KHÔNG tồn tại** → tạo = **migration** (ticket này được phép — OQ-1).
- **`iot_device_events` tồn tại** (cột thật): `id, device_id (NOT NULL), room_id (null), meeting_id (null), event_type (NOT NULL), event_time (NOT NULL), source_protocol (NOT NULL), severity (NOT NULL), payload_json (jsonb null), processed_status (NOT NULL), error_message (null), created_at`. #37 đã seed `iot_devices` bridge ⇒ **lưu per-identity với `device_id=bridge` né migration**: `event_type='ivss_face_event'`, `room_id`/`meeting_id` resolved, `payload_json={ szUid, userId, channelId, eventAction, similarity, name, utc, direction }`, `source_protocol='ivss'`, `severity='info'`, `processed_status='processed'`. **Đủ chứa per-identity** (định danh nằm trong payload_json, không có cột user_id riêng).

### 0.4. Presence storage hiện có — chiều WHO
- `presence_snapshots` **CÓ cột `user_id` (null) + `participant_id` (null)** + `occupancy_count` + `presence_status` — **nhưng `meeting_id` NOT NULL**, `snapshot_time` NOT NULL. Occupancy-ingest hiện CHỈ ghi `occupancy_count` + `presence_status='present'` (count = HOW MANY), **user_id để null** (không ghi WHO). ⇒ Cột `user_id` tồn tại nhưng **chưa dùng cho per-person** → đây là đường "augment" khả dĩ (OQ-4) NHƯNG: (a) đòi `meeting_id` (resolve active meeting — OQ-7); (b) trộn row per-person với row occupancy-count → **rủi ro hồi quy** query no-show/early-vacancy đang đọc `occupancy_count`/`MAX(snapshot_time)`.
- `room_booking_usages` (first/last_presence_at = thời điểm, không WHO). `room_events` (occupancy_count, không WHO).
- ⇒ **Per-person identity là chiều MỚI**; không bảng nào hiện ghi WHO theo cách dùng được. Đề xuất tách (OQ-4).

### 0.5. channel → room map — HIỆN TRẠNG
- **KHÔNG có** bảng/config map camera-channel → room. `capture_session_channel.channel_id` (varchar) là channel của **capture/recording session**, KHÔNG phải map vật lý camera→room. `iot_devices.room_id` gắn device→room nhưng bridge là **1 device tổng hợp nhiều channel** (room_id=NULL) → không suy được channel→room từ đó.
- ⇒ **Cần config MỚI** map `channelId → room_id` (OQ-2). Channel lạ → **log+skip** (OQ-5).

### 0.6. eventAction (defensive)
`eventAction` chỉ là `string` optional từ DTO; **giá trị thực bridge gửi CHƯA biết** (VERIFY-LIVE owed). Spec phải **defensive**: nếu eventAction khớp tập biết (enter/leave) → dùng; lạ/thiếu → fallback (OQ-3).

### 0.7. Meeting context (cho #43 sau)
`meetings` có `room_id`, `status`, `start_time`, `end_time`. Map event→meeting đang diễn ra: `SELECT id FROM meetings WHERE room_id=$room AND status='in_progress' AND $utc BETWEEN start_time AND end_time LIMIT 1`. Sẵn dùng → có thể gắn `meeting_id` lúc ingest (OQ-7).

### 0.8. No-migration?
Ticket này **được phép migration** (khác #36/#37). Nếu OQ-1 chọn bảng mới → migration **sạch, reversible** (DATA-01). Nếu chọn iot_device_events → **né migration**.

---

## 1. Scope #38 + #39
1. **IvssPresenceIngestionService** impl `IvssEventHandlerPort` (thay DefaultIvssEventHandler).
2. **Resolve identity**: szUid → user (0.2). Unknown → log+skip.
3. **Resolve location**: channelId → room (config OQ-2). Unknown → log+skip.
4. **Persist per-identity event (#39)**: ai / channel / room / utc / eventAction / similarity (storage OQ-1).
5. **Derive enter/leave (#38)**: defensive (OQ-3).

KHÔNG thuộc ticket: WS realtime (#40); report per-person per-meeting (#43); đẩy vào attendance/no-show (defer trừ khi RECON ép — RECON cho thấy KHÔNG ép).

## 2. Handler impl (luồng)
`onFaceEvent(evt)`:
1. **Identity**: `szUid = evt.personUid` → resolve user (0.2). Không khớp → `log + metric(unknownPerson) + return` (OQ-5).
2. **Location**: `room = channelMap[evt.channelId]` (OQ-2). Không khớp → `log + metric(unknownChannel) + return`.
3. **Meeting** (OQ-7): resolve active meeting (0.7) — gắn `meeting_id` nếu có (null nếu không).
4. **Direction (OQ-3)**: normalize `evt.eventAction` → `'enter'|'leave'|'seen'` (defensive).
5. **Persist (#39)**: lưu per-identity event (OQ-1) với { szUid, userId, channelId, roomId, meetingId, eventAction-raw, direction, similarity, utc }. SEC-01: **KHÔNG lưu/log imageBase64**; szUid là định danh nội bộ (metadata-only-log).
6. **Derive enter/leave (#38)**: theo OQ-3 (v1 có thể chỉ ghi `direction` đã normalize; leave-by-timeout defer).
- **KHÔNG throw** (webhook đã always-ack); lỗi DB → log + return. SEC-03 bind tham số.

## 3. Storage per-identity event (OQ-1)
Xem OQ-1 cho 2 hướng (iot_device_events vs ivss_events). Dù hướng nào, **payload/cột KHÔNG chứa imageBase64**; chứa: szUid, userId, channelId, roomId, meetingId?, direction, eventActionRaw, similarity, utc, receivedAt.

## 4. channel → room config (OQ-2)
Map `channelId(number) → room_id(uuid)`. Đề xuất `system_configs` key `ivss.channel_room_map` (config_json = `{ "1": "<room_uuid>", "2": "<room_uuid>" }`), runtime-tunable (đổi theo lắp đặt vật lý). Đọc precedence system_configs → (env?) → empty. Channel không có trong map → skip.

## 5. enter/leave derivation (OQ-3, defensive)
- eventAction biết (vd '1'/'enter' → enter; '2'/'leave' → leave) → dùng.
- Lạ/thiếu → `direction='seen'` (chỉ biết "nhận diện tại thời điểm này"), KHÔNG bịa enter/leave.
- (Tùy chọn defer) leave-by-timeout: không thấy lại trong N giây → leave (cần cron/state — defer khỏi v1 trừ khi OQ-3 chốt làm).

## 6. Defensive design
- channelId lạ → skip + metric. szUid không map → skip + metric. eventAction lạ → `seen`. utc lệch xa → dùng `receivedAt` (note). Tất cả best-effort, KHÔNG vỡ webhook (always-ack).

## 7. Test (mock — KHÔNG thiết bị/bridge)
- Gọi `onFaceEvent(evt giả)` → assert: resolve identity (mock DataSource keyword: mapping query → user), resolve location (mock channel-map config), persist (assert INSERT đúng store + KHÔNG có imageBase64), direction normalize (enter/leave/seen).
- Ca: known person+channel → persist + direction; unknown szUid → skip (no persist); unknown channel → skip; eventAction lạ → 'seen'; DB lỗi → KHÔNG throw; SEC: payload KHÔNG chứa imageBase64.
- Coverage ≥80% service mới.

## 8. Constitution
- **SEC-01**: imageBase64 + szUid metadata-only — KHÔNG log ảnh; persist KHÔNG chứa base64.
- **SEC-03**: bind tham số mọi raw SQL (mirror #37); channel-map đọc an toàn (validate uuid).
- **ARCH-01**: qua port `IVSS_EVENT_HANDLER`; KHÔNG đọc NetSDK trong NestJS (bridge lo). KHÔNG đụng occupancy/no-show path (OQ-4 tách).
- **DATA-01**: nếu OQ-1=bảng mới → migration **sạch, reversible** (up/down). Nếu iot_device_events → no-migration.
- **ARCH-02**: nếu OQ-3 chốt leave-by-timeout cron → gated default OFF + try/catch + no-throw + log (defer mặc định).

## 9. OPEN QUESTIONS (chốt trước plan/tasks)
- **OQ-1 (crux) storage**: **(A) iot_device_events** (device_id=bridge, per-identity trong payload_json — **né migration**, nhất quán raw-event-store occupancy-ingest; nhược: query per-person cho #43 phải đào jsonb) **[đề xuất v1]** vs **(B) bảng mới `ivss_events`** (migration sạch; cột: `id, szUid, user_id, channel_id, room_id, meeting_id(null), event_action, direction, similarity, occurred_at, received_at, raw_json(KHÔNG ảnh), created_at`; ergonomic cho #43; nhược: thêm schema). Chốt A/B; nếu B → duyệt cột.
- **OQ-2 channel→room map**: **system_configs** key `ivss.channel_room_map` (config_json) **[đề xuất]** vs env vs bảng mới. system_configs hợp vì map đổi theo lắp đặt vật lý (runtime-tunable). Xác nhận.
- **OQ-3 enter/leave**: **defensive lai** — dùng eventAction nếu khớp tập biết, else `seen` **[đề xuất]** (vì eventAction VERIFY-LIVE). vs tin tuyệt đối eventAction (1=enter/2=leave) vs suy luồng (first-seen=enter/timeout=leave). Có làm leave-by-timeout v1 không (cần cron+state)? Đề xuất **defer**.
- **OQ-4 presence target**: **tách track riêng** (store OQ-1 là nguồn per-person; KHÔNG ghi vào presence_snapshots) **[đề xuất]** — tránh hồi quy no-show/early-vacancy đọc occupancy_count. vs augment `presence_snapshots.user_id` (cột có sẵn nhưng meeting_id NOT NULL + trộn row). Xác nhận tách.
- **OQ-5 unknown channel/szUid**: **log + metric + skip** (đếm, không vỡ) **[đề xuất]**. Có cần lưu "unknown event" để debug (vd iot_device_events processed_status='unmatched')? Đề xuất lưu raw unknown vào store với `direction='unknown'`/processed_status đánh dấu — chốt.
- **OQ-6 idempotency/dedup**: webhook always-ack + bridge best-effort → event trùng. Dedup key `(szUid, channelId, utc, eventAction)`? Cần ở v1 (skip nếu đã có) hay chấp nhận trùng (event-log, không phải state)? Đề xuất **chấp nhận trùng v1** (đây là event log, #43 tự DISTINCT) — xác nhận.
- **OQ-7 meeting binding**: gắn `meeting_id` lúc ingest (join meetings by room+utc — 0.7) **ngay** [đề xuất, rẻ, cho #43 sau] vs defer #43. Đề xuất gắn ngay (best-effort, null nếu không có).

## 10. Residuals / known-gaps
- **Live-runbook owed (nặng)**: (a) **channel→room map thật** (cần biết IVSS channel id vật lý ↔ phòng); (b) **eventAction thật** bridge gửi (1/2? string?) — VERIFY-LIVE rồi chốt OQ-3 mapping; (c) **szUid round-trip** — szUid trong event có khớp `device_person_id` #37 lưu không (phụ thuộc bridge trả szUid đúng field — đã là owed của #37).
- C6 (#37): enroll vô dụng nếu group Face Comparison chưa arm → không có event để ingest.
- leave-by-timeout (true leave detection) defer — v1 chỉ `direction` từ eventAction.
- presence_snapshots.user_id augmentation để dành tương lai (nếu cần per-person vào occupancy path).
- Dedup/idempotency (OQ-6) nếu chấp nhận trùng → #43 phải xử.
- Concurrency: webhook nhiều event đồng thời (no lock) — event-log append-only nên ít rủi ro.

> **STOP.** Spec-only. Chờ Thiếu Chủ review + chốt OQ-1…OQ-7 trước khi plan/tasks.
