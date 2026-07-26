# UC-109 — Ghi nhận hiện diện theo khu vực · vòng `appear` (Zone Presence Writer · `ZPW-001`)

> FT-21 · module chính: `ivss` (điểm chèn) + `zones` (bảng đích `zone_presence_events`).
> Loại tài liệu: **SPEC** — mô tả *cái gì* + *ràng buộc*, KHÔNG mô tả *code thế nào*.

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo spec UC-109 vòng `appear` (ZPW-001): nhật ký bắt gặp người-đã-định-danh vào `zone_presence_events`. 4 QĐ nền (QĐ-1→4), 7 OPEN QUESTIONS. Phát hiện then chốt: `zone_presence_events` **chưa có cột `event_id`** ⇒ QĐ-4 cần migration `20260725000002` (OQ-1). | Toàn file |
| 2026-07-26 | Review duyệt có điều kiện: (A.1) camera trùng cả room_map lẫn presence_zone_map → **vẫn ghi + log WARN** (không chặn); (A.2) **CÓ** kiểm `zone.type`, chỉ `corridor`/`lobby`/`parking`, sai loại → `zone_wrong_type`; (A.3) `metadata_json` bỏ `name`, giữ `{channelId, szUid, similarity}`. §7 OPEN QUESTIONS → 6 QUYẾT ĐỊNH ĐÃ CHỐT (QC). ⚠ **LỆCH QC-1**: RECON tái xác minh — bảng KHÔNG có cột `event_id` (prompt ghi `:47` SAI, đó là `confidence_score`); QĐ-4 vẫn cần migration hoặc bỏ link — chưa chốt. | CHANGELOG, §5.2/5.3/5.4/5.6, §6, §7 |

---

## 1. Bối cảnh & mục tiêu

Camera nhận diện khuôn mặt đặt tại khu vực (hành lang, sảnh, bãi xe) thấy một người **đã định danh** → ghi **một dòng** vào `zone_presence_events`: *người X, zone Y, lúc T*. Đây là **nhật ký bắt gặp** (sighting log) — dữ liệu nền cho `RestrictedZoneIntrusionService` (UC-124: phát hiện người không được phép ở khu vực hạn chế).

Hiện `zone_presence_events` **rỗng, không có writer**; consumer `RestrictedZoneIntrusionService` (đọc `event_type='appear'`) đã có code + test, đang chờ dữ liệu.

## 2. Mô hình nghiệp vụ — DẤU VẾT BẮT GẶP (đã chốt, KHÔNG diễn giải lại)

Mô hình là **dấu vết rời rạc**. Các đặc điểm sau **KHÔNG** thuộc UC-109:

| KHÔNG có | Vì sao |
| :--- | :--- |
| sự kiện "biến mất" | camera bắn khi **thấy** mặt, không bắn khi người rời khung |
| ghép cặp / phiên / thời lượng | chỉ là dấu vết rời rạc, không phải session |
| chiều đi qua | nhật ký bắt gặp không có chiều |
| gắn cuộc họp | camera khu vực ≠ camera phòng họp |
| đếm số người / occupancy | vòng riêng, **KHÔNG thuộc lượt này** (§9) |

**Chỉ ghi MỘT loại: `event_type = 'appear'`, và CHỈ khi `userId != NULL`.**

Ba loại người qua camera — xử lý khác nhau:

| Ai | IVSS gửi | Writer |
| :--- | :--- | :--- |
| Nhân viên đã định danh (có `device_user_mappings`) | `personUid` hợp lệ → `resolveUser` ra `userId` | **ghi `appear`** |
| Có trên IVSS nhưng BE chưa map | `personUid` → `resolveUser` NULL | **KHÔNG ghi**, `presenceSkipped='unmatched_identity'` |
| Người lạ hoàn toàn | bridge vứt (`nCandidateNum=0`) | BE không thấy — ngoài phạm vi |

## 3. Quyết định nền đã chốt (KHÔNG mở lại)

| # | Nội dung |
| :--- | :--- |
| **QĐ-1** | `zones` phơi method ghi; `ivss` **GỌI**. CẤM `ivss` bắn raw SQL vào `zone_presence_events`. Mirror UC-105 (`anpr → zones`, `writeGateLog`). Bảng một chủ. |
| **QĐ-2** ⭐ | `zone_id` lấy từ config **`ivss.channel_presence_zone_map`** — **KEY RIÊNG**, KHÔNG dùng chung `ivss.channel_zone_map` của UC-105. Camera một-vai-một-channel: cổng / phòng họp / hành lang là thiết bị + channel khác nhau. Trùng cấu trúc, khác ý nghĩa ⇒ tách để tên tự giải thích + seed độc lập. |
| **QĐ-3** | Điểm móc `onFaceEvent` ([ivss-presence-ingestion.service.ts:85](../../../../src/modules/ivss/services/ivss-presence-ingestion.service.ts#L85)), chèn **SAU** INSERT `iot_device_events`. Hai đường **độc lập**: (a) điểm danh phòng họp hiện có — GIỮ NGUYÊN; (b) ghi presence — MỚI. Một sự kiện mặt kích cả hai hoặc chỉ một, tuỳ channel (room-map vs presence-map độc lập). |
| **QĐ-4** | Điền `event_id`: thêm `RETURNING id` vào INSERT `iot_device_events`, truyền vào method ghi presence. Cứu chẩn đoán nghiệm thu (`LEFT JOIN ON event_id`). ⚠ Bảng **chưa có cột `event_id`** ⇒ cần migration thêm cột (QC-1). |

## 4. RECON đã xác minh (dùng lại)

- `onFaceEvent` `:85`. Có sẵn: `resolveBridgeDeviceId` `:265`, `resolveUser(personUid)` `:273` (query `device_user_mappings` theo `device_person_id`+`metadata_json->>'source'='ivss'`+`deleted_at IS NULL`, **KHÔNG lọc group** ⇒ mặt enroll group tracking cũng ra userId), `resolveRoom(channelId)` `:283` (qua `channel_room_map`), `parseUtc` `:254` (trả `{eventTime, utcFallback}`; ISO sai / lệch >`SKEW_MS`(1h) → `now()` + `utcFallback=true`).
- INSERT `iot_device_events` `event_type='ivss_face_event'` `:142-145`, **hiện KHÔNG `RETURNING id`**.
- `onFaceEvent` **always-ack**, try/catch bao toàn bộ `:86-179`, **không throw**.
- `RestrictedZoneIntrusionService` đọc `event_type=ZONE_PRESENCE_EVENT_TYPES[0]`(`'appear'`), dùng `user_id`; `isViolation :160` `if (!userId) return true` ⇒ **NULL = vi phạm** ⇒ writer BẮT BUỘC chỉ ghi khi `userId != NULL`.
- Reader mẫu `getChannelRoomMap` `:289`: `SELECT config_json FROM system_configs WHERE config_key=$1 AND is_active=true LIMIT 1`, validate UUID từng entry, **không cache**, lỗi → `{}`, **không throw**.
- Route webhook face: `@Controller()` rỗng + `@Post('internal/ivss/events')` + prefix `api/v1` ⇒ `/api/v1/internal/ivss/events`; guard `IvssInternalTokenGuard` (header `X-Internal-Token`=`IVSS_BRIDGE_TOKEN`); body `FaceEventDto`.
- **Baseline (jest sau `npm install` khôi phục ts-jest):** `ivss` **15 suite / 151 test** · `zones` **14 / 185** · `restricted-zone` **1 / 12**.
- Migration mới nhất `20260725000001` (UC-105) ⇒ kế tiếp **`20260725000002`**.

## 5. Điểm spec phải xử

### 5.1. Schema đích — dán thật

`CREATE TABLE` (migration `20260721000005`):
```sql
CREATE TABLE "zone_presence_events" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "zone_id" uuid NOT NULL,
  "device_id" uuid,
  "user_id" uuid,
  "event_type" varchar(20) NOT NULL,
  "occupancy_count" integer,
  "confidence_score" numeric(5,4),
  "event_time" timestamptz NOT NULL,
  "source_type" varchar(30) NOT NULL DEFAULT 'ivss',
  "metadata_json" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_zone_presence_events_id" PRIMARY KEY ("id"),
  CONSTRAINT "FK_..._zone"   FOREIGN KEY ("zone_id")   REFERENCES "zones"("id")       ON DELETE RESTRICT,
  CONSTRAINT "FK_..._device" FOREIGN KEY ("device_id") REFERENCES "iot_devices"("id") ON DELETE SET NULL,
  CONSTRAINT "FK_..._user"   FOREIGN KEY ("user_id")   REFERENCES "users"("id")       ON DELETE SET NULL
);
-- index: IDX_zpe_zone_time (zone_id, event_time DESC)
--        IDX_zpe_user_time (user_id, event_time DESC) WHERE user_id IS NOT NULL
--        IDX_zpe_count     (zone_id, event_time DESC) WHERE event_type = 'count'
```

- **NOT NULL không default:** `zone_id`, `event_type`, `event_time`.
- `event_type varchar(20)` **KHÔNG có CHECK** (chốt chặn duy nhất = hằng `ZONE_PRESENCE_EVENT_TYPES` + `@IsIn` tầng app).
- **Nullable:** `device_id`, `user_id`, `occupancy_count`, `confidence_score`, `metadata_json`.
- `source_type` default `'ivss'`. **Append-only** — không `deleted_at`.
- 🔴 **KHÔNG có cột `event_id`** (không trong CREATE TABLE lẫn entity). ⇒ **QĐ-4 (link `event_id`) cần migration `20260725000002` thêm cột `event_id uuid NULL` + FK → `iot_device_events(id)` ON DELETE SET NULL** (mirror `gate_access_logs.event_id`). Xem **QC-1**.

Entity: [zone-presence-event.entity.ts](../../../../src/modules/zones/entities/zone-presence-event.entity.ts) — `zoneId/deviceId/userId/eventType/occupancyCount/confidenceScore(string|null)/eventTime/sourceType/metadataJson`. Không `event_id`.

### 5.2. Hợp đồng method bên `zones`

**Chưa có service `zones` nào quản `zone_presence_events`** (entity schema-only). ⇒ **service MỚI `ZonePresenceWriterService`** trong module `zones` (QC-4), phơi method:

```
writeAppearEvent(input: WriteAppearInput): Promise<WriteAppearResult>
```
- **Input (mức spec):** `zoneId`, `userId` (bắt buộc NOT NULL — caller đã lọc), `eventTime` (từ `parseUtc`, KHÔNG `now()`), `deviceId?`, `eventId?` (QĐ-4), `sourceType?`, `metadata?`. `event_type` cố định `'appear'`, `occupancy_count` cố định NULL (vòng này không đếm).
- **Validate bên trong (QC-5):** zone tồn tại + chưa xoá mềm + **`zone.type ∈ {corridor, lobby, parking}`** (chỉ zone khu vực). Zone `gate`/`room`/khác → **không insert**, trả `skipReason='zone_wrong_type'`. Bên ghi (`zones`) là chủ khái niệm zone-type (mirror ngược UC-105: UC-105 chặn zone **không phải** gate; UC-109 chặn zone **là** gate/room).
- **Return:** `{ written: boolean; eventId?: string; skipReason?: string }`.
- **Transaction:** INSERT đơn dòng, tx riêng của method, COMMIT trước khi trả (append-only, không pairing). **KHÔNG** `deletedAt` trên `zone_presence_events`.

### 5.3. Điều kiện ghi `appear` — bảng rõ ràng

Ghi **CHỈ KHI TẤT CẢ đúng**:

| Điều kiện | Fail → |
| :--- | :--- |
| channel có trong `ivss.channel_presence_zone_map` (ra `zoneId`) | `presenceSkipped='zone_unmapped'` |
| `userId != NULL` (resolveUser ra người) | `presenceSkipped='unmatched_identity'` |
| `utcFallback == false` (utc tin cậy — mirror UC-105, `now()` bị cấm) | `presenceSkipped='bad_utc'` |
| (method zones) zone tồn tại + `zone.type ∈ {corridor, lobby, parking}` (QC-5) | `presenceSkipped='zone_wrong_type'` |

Mọi fail → **KHÔNG ghi** `zone_presence_events`, đánh dấu `presenceSkipped` (§5.4).

⚠ **Camera một-vai-một-channel (A.1):** `channel_room_map` (điểm danh phòng họp) và `channel_presence_zone_map` (presence khu vực) **lẽ ra loại trừ nhau** — một camera vật lý một vai. Nếu một `channelId` nằm trong **CẢ HAI** map (lỗi cấu hình), writer **VẪN ghi `appear` bình thường** (không chặn, không nuốt sự kiện) nhưng **log WARN**: `channel {N} có trong CẢ room_map lẫn presence_zone_map — kiểm cấu hình, camera nên một vai.` Writer KHÔNG tự sửa map — chỉ cảnh báo để người vận hành sửa.

### 5.4. Đánh dấu skip

Ghi lý do vào `iot_device_events.payload_json`, khoá **`presenceSkipped`**. **Tập giá trị đầy đủ (4):** `zone_unmapped` · `unmatched_identity` · `bad_utc` · `zone_wrong_type`. Ba giá trị đầu biết-TRƯỚC INSERT raw (đưa thẳng vào payload); `zone_wrong_type` chỉ biết SAU khi gọi method `zones` (kiểm type) → ghi bằng UPDATE bổ sung. Mục đích: chẩn đoán "chạy mà không thấy row" lúc nghiệm thu, giống `gateLogSkipped` UC-105.

⚠ Lưu ý va chạm tên: `unmatched_identity` đã là một giá trị `matchState` sẵn có trong payload (nghĩa "có userId nhưng không thuộc họp", `matchStateOf :236`). `presenceSkipped='unmatched_identity'` mang nghĩa khác ("userId NULL"). Xem OQ (đặt tên) — có thể dùng `identity_unresolved` để tránh nhầm.

### 5.5. 🔴 Tương thích ngược — ACCEPTANCE CRITERION RIÊNG

> **AC-BACKCOMPAT:** Khi `ivss.channel_presence_zone_map` **trống** (hiện trạng hôm nay), hành vi của `onFaceEvent` **giống hệt** trước UC-109 cho **điểm danh phòng họp** (resolveRoom → resolveMeeting → isParticipant → matchState → INSERT raw → broadcast realtime), **ngoại trừ**: (a) mỗi dòng `iot_device_events` nay có thêm khoá `presenceSkipped` trong `payload_json` (QĐ-3) và (b) INSERT nay kèm `RETURNING id` (QĐ-4, không đổi nội dung ghi). **Không** dòng `zone_presence_events` nào được tạo; **không** exception; webhook ack 200; luồng điểm danh phòng họp **đã nghiệm thu phần cứng** không đổi kết quả.

Đây là tiêu chí **bắt buộc kiểm** (test + verify curl khi presence-map trống), không phải ghi chú.

### 5.6. Thứ tự thao tác trong `onFaceEvent`

Đánh số (giữ nguyên vs chèn mới):

1. `resolveBridgeDeviceId` — GIỮ. Không có → skip toàn bộ.
2. `resolveUser(personUid)` → `userId` — GIỮ.
3. `resolveRoom(channelId)` → `roomId`; `parseUtc` → `{eventTime, utcFallback}`; resolveMeeting/direction/isParticipant/matchState — **GIỮ NGUYÊN** (điểm danh phòng họp).
4. Resolve `zoneId` từ `channel_presence_zone_map` (MỚI); tính `presenceSkipped` biết-trước (`zone_unmapped`/`unmatched_identity`/`bad_utc`). **A.1:** nếu `channelId` non-null ở **cả** `roomId` (room_map) **lẫn** `zoneId` (presence_map) → log WARN camera-hai-map (không chặn).
5. Xây payload (GIỮ) + thêm khoá `presenceSkipped` (MỚI).
6. **INSERT `iot_device_events` … `RETURNING id`** (QĐ-4) → `eventId`. *(Tx #1 — raw event, luôn-luôn-xảy-ra.)*
7. Nhánh điểm danh phòng họp (warn/broadcast) — **GIỮ NGUYÊN**.
8. Nhánh presence (MỚI): nếu **không** có `presenceSkipped` biết-trước → gọi `zones.writeAppearEvent({zoneId, userId, eventTime, deviceId, eventId, metadata})`. *(Tx #2 — của method zones, độc lập.)* Trả `written=false, skipReason='zone_wrong_type'` → UPDATE bổ sung `presenceSkipped='zone_wrong_type'`.
9. Trả về (webhook ack 200).

**Ranh giới tx:** raw event (Tx #1) và presence (Tx #2) **tách rời** — lỗi presence KHÔNG được rollback raw event (mirror UC-105 QĐ-8 tinh thần: ghi thô trước, ghi phụ sau).

### 5.7. Xử lý lỗi

`onFaceEvent` always-ack. Ghi presence hỏng → **nuốt lỗi, log, KHÔNG throw** — KHÔNG được làm vỡ điểm danh phòng họp (đã nghiệm thu) hay ack webhook. Bọc riêng lời gọi `writeAppearEvent` trong try/catch (hoặc dựa outer try/catch của `onFaceEvent` — chốt ở plan, miễn không throw).

### 5.8. Kịch bản verify KHÔNG cần phần cứng ⭐

Bộ script **vận hành**, đặt ở **`scripts/ivss-livetest/`** (đã có), KHÔNG phải migration.

**(1) Dữ liệu nền:**
- 1 zone khu vực (`zone_type='corridor'` hoặc `'lobby'`), active, chưa xoá mềm.
- `system_configs['ivss.channel_presence_zone_map']` = `{"<CHANNEL>": "<area_zone_id>"}` (DELETE-then-INSERT, mirror template ivss-livetest).
- 1 `device_user_mappings` (`device_person_id=<szUid>`, `metadata_json->>'source'='ivss'`, `deleted_at IS NULL`) → 1 user.
- 1 `szUid` **không** có mapping (test skip).
- device `IVSS-BRIDGE` đã seed.

**(2) `curl` mẫu (payload `FaceEventDto`):**
```bash
# Bắt gặp người ĐÃ định danh tại khu vực
curl -s -X POST http://localhost:3000/api/v1/internal/ivss/events \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $IVSS_BRIDGE_TOKEN" \
  -d '{"type":"face_recognized","channelId":<CHANNEL>,"personUid":"<SZUID_MAPPED>","utc":"<ISO_NOW>","name":"Nguyen Van A","similarity":92}'
```

**(3) Query kiểm (mirror `LEFT JOIN ON event_id` — sau khi migration QC-1 thêm cột (nếu chốt giữ link)):**
```sql
SELECT e.id, e.event_time,
       e.payload_json->>'presenceSkipped' AS skip_reason,
       z.id AS presence_id, z.event_type, z.user_id, z.zone_id
FROM iot_device_events e
LEFT JOIN zone_presence_events z ON z.event_id = e.id
WHERE e.event_type = 'ivss_face_event'
ORDER BY e.event_time DESC LIMIT 20;
```
Kỳ vọng: 1 dòng `zone_presence_events` `event_type='appear'`, `user_id` đúng, `skip_reason` NULL.

**(4) Ca skip:** `personUid` **không** có mapping → `resolveUser` NULL → `presenceSkipped='unmatched_identity'`, không dòng presence.

### 5.9. Ranh giới với vòng sau & với Tài

- Vòng **`count`** (occupancy → `occupancy_count` từ `IvssOccupancyIngestService`) **KHÔNG thuộc UC-109 lượt này** — scope kế tiếp.
- Cấp phát DB "2" (enroll toàn nhân viên để camera tracking thấy) **KHÔNG thuộc** — việc riêng, cần nới group cho `enrollAttendee`/`cleanupEnded`.
- `zone-presence-timeline.service.ts` (UC-110, của Tài) ghép cặp hai loại sự kiện thành phiên ⇒ với mô hình chỉ-`appear` nó sẽ hiển thị phiên không đóng. **Ghi nhận là việc Tài phải sửa khi làm UC-110 — KHÔNG đề xuất sửa code Tài trong spec này.**

## 6. Bảng cột bắt buộc writer phải điền (để `RestrictedZoneIntrusionService` chạy đúng)

| Cột | Bắt buộc | Giá trị | Vì sao |
| :--- | :--- | :--- | :--- |
| `zone_id` | CÓ (NOT NULL) | từ `channel_presence_zone_map` | WHERE zoneId |
| `event_type` | CÓ (NOT NULL) | `'appear'` | WHERE eventType=[0] |
| `event_time` | CÓ (NOT NULL) | `eventTime` (parseUtc, KHÔNG now()) | WHERE eventTime > watermark |
| `user_id` | **CÓ — phải NOT NULL** | `userId` | `isViolation`: NULL → luôn vi phạm ⇒ chỉ ghi khi userId != NULL |
| `occupancy_count` | KHÔNG | NULL | sự kiện định danh, không đếm |
| `source_type` | tự default | `'ivss'` | — |
| `confidence_score` | KHÔNG | NULL | không consumer đọc (similarity để trong metadata) |
| `device_id` | nên | bridge id | truy vết |
| `event_id` | 🔴 **cột CHƯA tồn tại** (LỆCH QC-1) | id raw event (nếu thêm cột) | truy vết `LEFT JOIN` — **cần migration `20260725000002`** nếu giữ QĐ-4 |
| `metadata_json` | CÓ (QC-3) | `{ channelId, szUid, similarity }` — **bỏ `name`** | truy vết; `name` thừa (đã có `user_id`) + nhạy cảm. SEC: KHÔNG imageBase64 |

## 7. QUYẾT ĐỊNH ĐÃ CHỐT (QC)

| # | Vấn đề | Quyết định | Lý do |
| :--- | :--- | :--- | :--- |
| **QC-1** 🔴 **LỆCH** | `event_id` | **CHƯA CHỐT — dữ kiện prompt sai.** Prompt review ghi "bảng đã có cột `event_id` (`:47`) ⇒ không cần migration". **RECON tái xác minh: SAI** — `zone_presence_events` **KHÔNG có** cột `event_id` (entity `:47` là `confidence_score`; migration `20260721000005` không có; không ALTER nào thêm). ⇒ QĐ-4 (link `event_id`) **vẫn cần migration `20260725000002`** (thêm `event_id uuid NULL` FK→`iot_device_events` SET NULL), HOẶC **bỏ link** (không `event_id`, chẩn đoán chỉ dựa `presenceSkipped`). | Không ghi sai thành đã-chốt. Người duyệt phải chọn: giữ QĐ-4 + migration, hay bỏ link. Đây là điểm **duy nhất** quyết định có schema. |
| **QC-2** | `source_type` | `'ivss'` (default cột). Đủ. | Nguồn presence chỉ từ IVSS face. |
| **QC-3** | `metadata_json` | `{ channelId, szUid, similarity }` — **bỏ `name`**. | `name` thừa (đã có `user_id` → `users`) + nhạy cảm. `similarity` giữ (tín hiệu chất lượng nhận diện, debug). |
| **QC-4** | Method ghi đặt đâu | **Service MỚI `ZonePresenceWriterService` trong module `zones`.** | RECON §5.2: chưa có service nào quản `zone_presence_events` (entity schema-only) ⇒ không có chỗ mở rộng, phải tạo mới. Một chủ bảng (QĐ-1). |
| **QC-5** | Kiểm `zone.type` | **CÓ** — chỉ `corridor`/`lobby`/`parking`; `gate`/`room`/khác → `zone_wrong_type` (§A.2). Bên ghi (`zones`) kiểm. | `channel_presence_zone_map` seed tay; trỏ nhầm zone `gate` → restricted-zone nhận `appear` ở cổng → cảnh báo sai. Mirror ngược UC-105. |
| **QC-6** | Cron `SCHEDULER_RESTRICTED_ZONE_ENABLED` | **NGOÀI phạm vi UC-109** — bước vận hành riêng, bật SAU khi verify writer sạch. | Bật cron = restricted-zone quét + đẻ cảnh báo ngay khi có `appear` đầu; tách để lúc cảnh báo sai còn phân biệt lỗi writer vs lỗi rule. |

**Danh sách `presenceSkipped` đầy đủ (4):** `zone_unmapped` · `unmatched_identity` · `bad_utc` · `zone_wrong_type`.

**Ghi chú đặt tên:** `presenceSkipped='unmatched_identity'` va chạm với `matchState='unmatched_identity'` (nghĩa khác — §5.4). Prompt review giữ tên `unmatched_identity`; nếu gây nhầm lúc chẩn đoán, cân nhắc `identity_unresolved` (chưa chốt, ghi nhận).

**Kiểm luật §0:** không mâu thuẫn. QĐ-1 củng cố module boundary CLAUDE.md; QĐ-4 (sửa dòng production) hợp lệ nếu có test bắt buộc — nhưng vướng QC-1 (thiếu cột đích).

## 8. Out of scope / ràng buộc

- **KHÔNG** `ivss` bắn raw SQL vào `zone_presence_events` (QĐ-1).
- **KHÔNG** ghi khi `userId == NULL` / channel không map / `utcFallback` (§5.3).
- **KHÔNG** sửa `parseUtc`/`resolveUser`/`resolveRoom`/`resolveBridgeDeviceId`.
- **KHÔNG** đụng luồng điểm danh phòng họp ngoài phần thêm `presenceSkipped` + `RETURNING id`.
- **KHÔNG** nhắc `disappear`/`count`/phiên/ghép cặp/chiều trong nghiệp vụ (§2).
- **KHÔNG** đề xuất sửa code Tài (`zone-presence-timeline`, `restricted-zone`).
- Zone JOIN (nếu có ở đường ghi/kiểm) kèm `zones.deleted_at IS NULL` (luật SAVP 5.5).
