# ZPW-001 — plan.md (UC-109 IVSS: ghi nhận hiện diện theo khu vực · vòng `appear`)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo plan ZPW-001 sau spec DUYỆT (4 QĐ + 6 QC). Writer chèn vào `onFaceEvent` (production điểm danh phòng họp đã nghiệm thu): resolve zone qua `ivss.channel_presence_zone_map` (key riêng, QĐ-2) → gọi `ZonePresenceWriterService.writeAppearEvent` (QC-4, một chủ bảng). Chỉ ghi khi channel-map ra zoneId + userId≠NULL + utcFallback=false + `zone.type ∈ {corridor,lobby,parking}` (QC-5). 4 giá trị `presenceSkipped`. Camera-hai-map → WARN không chặn (A.1). AC-BACKCOMPAT khi presence-map trống. | Toàn bộ |
| 2026-07-26 | Review duyệt có điều kiện: (A.1) **TÁCH quyết định khỏi ghi** — MỌI `presenceSkipped` (gồm `zone_wrong_type`) tính TRƯỚC INSERT raw, chỉ phần GHI nằm sau; chốt **nhánh (a)** — `zones` phơi thêm `resolvePresenceZone(zoneId)` read-only để `ivss` biết type-hợp-lệ trước INSERT ⇒ **KHÔNG còn UPDATE bù** (siêu việt hơn spec §5.4). (A.2) WARN camera-hai-map kiểm **KEY tồn tại trong cả hai map**, KHÔNG kiểm giá trị resolve. (A.3) thêm nợ **TD-ZPW-1** (4 reader trùng khuôn). | §2, §3, §5, §6, §11 |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại 4 QĐ + 6 QC.
> **RÀNG BUỘC SỐNG-CÒN:** **`event_time` = `eventTime` từ `parseUtc`; `utcFallback === true` → skip `bad_utc`. CẤM `now()`.** **KHÔNG sửa `parseUtc`/`resolveUser`/`resolveRoom`/`resolveBridgeDeviceId`.** **KHÔNG `ivss` bắn raw SQL vào `zone_presence_events`** — chỉ gọi `writeAppearEvent` (QĐ-1).

## 0. ⚠ LỆCH QC-1 PHẢI CHỐT TRƯỚC KHI CODE — `event_id` không có cột đích

RECON tái xác minh (grep entity + migration): `zone_presence_events` **KHÔNG có cột `event_id`** (entity `:47` là `confidence_score`). QĐ-4 muốn truyền `event_id` vào writer để `LEFT JOIN` chẩn đoán, nhưng **không có chỗ lưu**. Hai nhánh — **người duyệt chốt trước bước B4**:

- **Nhánh A (giữ link):** migration `20260725000002` thêm `event_id uuid NULL` FK→`iot_device_events(id)` SET NULL. INSERT raw thêm `RETURNING id`, writer nhận + ghi `event_id`. UC-109 phát sinh **1 migration schema**.
- **Nhánh B (bỏ link):** không migration, không cột `event_id`. INSERT raw **không** cần `RETURNING id`. Chẩn đoán chỉ dựa `presenceSkipped` trong `iot_device_events.payload_json` (query lọc `event_type='ivss_face_event'`, không JOIN được sang presence). Query verify §9 phải đổi (không `LEFT JOIN ON event_id`).

Plan dưới viết cho **cả hai**, đánh dấu chỗ rẽ. **KHÔNG tự chọn.**

## 1. Phạm vi thay đổi — bảng file

| File | Loại | Thay đổi | Rủi ro |
| :--- | :--- | :--- | :--- |
| `src/modules/ivss/services/ivss-presence-ingestion.service.ts` | **MODIFIED** | **RỦI RO CAO NHẤT** (điểm danh phòng họp đã nghiệm thu). Thêm: reader `channel_presence_zone_map`; nhánh ghi presence (userId≠NULL + zone + utc); WARN camera-hai-map; (nhánh A) `RETURNING id`. | Cao — đổi dòng production. Giới hạn: AC-BACKCOMPAT + tách bước B4. |
| `src/modules/ivss/ivss.module.ts` | **MODIFIED** | Import `ZonesModule` (lấy `ZonePresenceWriterService`). Kiểm: hiện `ivss.module` **CHƯA** import `zones` (RECON §A). | Thấp — cạnh `ivss→zones` một chiều, không circular. |
| `src/modules/zones/services/zone-presence-writer.service.ts` | **NEW** | `ZonePresenceWriterService.writeAppearEvent` (QC-4). Kiểm `zone.type` (QC-5), INSERT 1 dòng tx riêng. | Trung bình — service mới, không đụng service zones cũ. |
| `src/modules/zones/zones.module.ts` | **MODIFIED** | Provider + **export** `ZonePresenceWriterService` (để `ivss` inject — bài học UC-105: quên export = không inject được). | Thấp. |
| `src/database/migrations/20260725000002-AddEventIdToZonePresenceEvents.ts` | **NEW — CHỈ nhánh A** | Thêm cột `event_id` + FK. | Trung bình — migration schema. **Bỏ nếu chốt nhánh B.** |
| `src/modules/ivss/constants/*presence*.constant.ts` *(hoặc gộp constant ivss sẵn có)* | **NEW** | Hằng `config_key` `ivss.channel_presence_zone_map` + tập `PRESENCE_SKIPPED` (4 giá trị) + `PRESENCE_ZONE_TYPES` (`corridor`/`lobby`/`parking`). | Thấp. |
| `src/modules/ivss/services/ivss-presence-ingestion.service.spec.ts` | **MODIFIED** | Bổ sung test (§6). | Thấp. |
| `src/modules/zones/services/zone-presence-writer.service.spec.ts` | **NEW** | Test `writeAppearEvent` (zone hợp lệ/wrong_type/không tồn tại). | Thấp. |
| `scripts/ivss-livetest/` | **NEW/thêm** | Script verify (§9 spec). KHÔNG migration. | Thấp. |

> **Reader `channel_presence_zone_map` đặt làm private method TRONG `IvssPresenceIngestionService`** (mirror `getChannelRoomMap` `:289`). **KHÔNG gom** với các reader khác lượt này — gom = chạm `VehicleResolveService` (vừa nghiệm thu phần cứng UC-105) + `ivss-occupancy-ingest`, rủi ro lan rộng. Nợ "6 bản reader" (RECON §F) ghi nhận, xử sau. Lý do đặt trong service tiêu thụ: đọc `system_configs` qua `dataSource` đã inject, không cần provider mới.

## 2. Hợp đồng `ZonePresenceWriterService` — HAI method (QC-4, A.1 nhánh a)

`zones` là chủ khái niệm zone-type (QC-5) ⇒ phơi **một method ĐỌC** (để `ivss` biết type hợp lệ **trước** INSERT raw) + **một method GHI**:

```ts
// ĐỌC — thuần validate zone.type, KHÔNG ghi. ivss gọi TRƯỚC INSERT để tính presenceSkipped một lần.
resolvePresenceZone(zoneId: string): Promise<{ valid: boolean; reason?: 'zone_wrong_type' }>;

// GHI — sau INSERT (đã có eventId). Chỉ gọi khi KHÔNG skip.
writeAppearEvent(input: WriteAppearInput): Promise<{ presenceId: string }>;

interface WriteAppearInput {
  zoneId: string;
  userId: string;             // caller đảm bảo NOT NULL (restricted-zone: NULL = vi phạm)
  eventTime: Date;            // TỪ parseUtc — KHÔNG now()
  deviceId?: string | null;
  eventId?: string | null;    // event_id (QC-1 nhánh A) — có cột thì điền
  metadata?: Record<string, unknown> | null; // { channelId, szUid, similarity } — QC-3, KHÔNG name
}
```

- **`resolvePresenceZone` (ĐỌC):** SELECT `zone` theo `zoneId` **kèm `deleted_at IS NULL`**; không tồn tại / `zone_type NOT IN ('corridor','lobby','parking')` → `{valid:false, reason:'zone_wrong_type'}`; đạt → `{valid:true}`. **Không ghi, không tx.** Đây là chỗ `ivss` biết `zone_wrong_type` **TRƯỚC** INSERT ⇒ nhét vào payload một lần, KHÔNG UPDATE bù.
- **`writeAppearEvent` (GHI):** INSERT `zone_presence_events` (`event_type='appear'`, `occupancy_count=NULL`, `source_type='ivss'`, bound param SEC-03) trong tx riêng, COMMIT trước khi trả. **Vẫn tự validate type** (defense-in-depth: chỉ có `ivss` gọi + đã resolve, nhưng method phải an toàn nếu gọi trực tiếp) — nếu type sai thì ném lỗi (caller đã lọc nên không xảy ra ở luồng thật). **KHÔNG** `deletedAt` (append-only), **KHÔNG** pairing/unique (nhật ký bắt gặp cho phép trùng).
- **Vì sao nhánh (a) thay vì UPDATE bù (spec §5.4):** UC-105 đã chịu vòng vo `zone_not_gate` qua UPDATE. `resolvePresenceZone` (1 query đọc, chỉ chạy trên event đã lọc channel-map+userId+utc) rẻ hơn + sạch hơn: mọi `presenceSkipped` vào payload trong MỘT lần ghi, không UPDATE. **Plan này siêu việt spec §5.4** (spec ghi UPDATE bù — plan refine sang resolve-before).

## 3. Thứ tự thao tác trong `onFaceEvent` — GIỮ vs CHÈN

**Nguyên tắc A.1: MỌI quyết định `presenceSkipped` (gồm `zone_wrong_type`) tính TRƯỚC INSERT; chỉ phần GHI presence nằm sau. KHÔNG UPDATE bù.**

1. `resolveBridgeDeviceId` — **GIỮ**. Không có → skip toàn bộ.
2. `resolveUser(personUid)` → `userId` — **GIỮ**.
3. `resolveRoom(channelId)` → `roomId`; `parseUtc` → `{eventTime, utcFallback}`; resolveMeeting/direction/isParticipant/`matchStateOf` — **GIỮ NGUYÊN** (điểm danh phòng họp).
4. **CHÈN (TRƯỚC INSERT) — quyết định presence, tính `presenceSkipped` đầy đủ:**
   - đọc `presenceMap` = `getChannelPresenceZoneMap()`; `zoneId = presenceMap[String(channelId)] ?? null`.
   - **WARN camera-hai-map (A.2):** nếu `String(channelId)` **có KEY trong cả** `roomMap` **lẫn** `presenceMap` → `logger.warn(...)`. Kiểm **sự tồn tại của key**, KHÔNG kiểm giá trị resolve (room-map trỏ zone xoá → resolve null nhưng key vẫn còn → vẫn phải WARN). Không chặn.
   - `presenceSkipped`: `zone_unmapped` (channel không có key trong presenceMap) · `unmatched_identity` (userId NULL) · `bad_utc` (utcFallback=true).
   - nếu **chưa** có skip nào (có zoneId + userId + utc ok) → gọi **`zones.resolvePresenceZone(zoneId)`** (ĐỌC); `!valid` → `presenceSkipped='zone_wrong_type'`.
5. **CHÈN:** thêm khoá `presenceSkipped` (giá trị cuối cùng hoặc `null`) vào `payload` — **MỘT lần**, cùng lúc build payload cũ.
6. INSERT `iot_device_events` — **GIỮ nội dung** + thêm **`RETURNING id`** (QĐ-4) → `eventId`. *(Tx #1 — raw event.)*
7. Nhánh điểm danh phòng họp (warn/broadcast realtime) — **GIỮ NGUYÊN**.
8. **CHÈN (chỉ GHI):** nếu `presenceSkipped == null` → `zones.writeAppearEvent({zoneId, userId, eventTime, deviceId, eventId, metadata})` *(Tx #2 — zones, độc lập)*. Bọc try/catch **nuốt lỗi** (§5.7 spec) — KHÔNG throw, KHÔNG vỡ điểm danh. **KHÔNG UPDATE** (mọi `presenceSkipped` đã nằm trong payload từ bước 5).
9. Trả về (webhook ack 200).

**Ranh giới tx:** Tx #1 (raw event) và Tx #2 (presence) **tách rời** — lỗi presence KHÔNG rollback raw event (mirror UC-105).

## 4. Reader `channel_presence_zone_map`
Private method trong `IvssPresenceIngestionService`, mirror `getChannelRoomMap` `:289`: `SELECT config_json FROM system_configs WHERE config_key='ivss.channel_presence_zone_map' AND is_active=true LIMIT 1`; validate mỗi value bằng `UUID_RE` (bỏ entry sai); **không cache**; đọc lỗi → `{}`, **không throw** → channel không map → `zone_unmapped` (an toàn, AC-BACKCOMPAT).

## 5. Logic camera-hai-map (A.2) — kiểm KEY tồn tại, KHÔNG kiểm giá trị resolve
Điều kiện WARN: `String(channelId) in roomMap && String(channelId) in presenceMap` — tức `channelId` có **KEY** trong **cả hai** config map. **KHÔNG** dùng `roomId != null && zoneId != null` (resolve có thể ra null dù key tồn tại — vd room-map trỏ zone đã xoá; WARN phải bắt được lỗi cấu hình đó).
```
if (Object.hasOwn(roomMap, String(channelId)) && Object.hasOwn(presenceMap, String(channelId)))
  logger.warn('channel {channelId} có trong CẢ room_map lẫn presence_zone_map — kiểm cấu hình, camera nên một vai.')
```
**Không chặn** — vẫn ghi `appear` (nếu điều kiện khác đạt) và vẫn điểm danh phòng họp. Điểm kiểm: bước 4, sau khi đọc cả `roomMap` (đã có sẵn trong `resolveRoom`) và `presenceMap`. ⚠ `resolveRoom` hiện chỉ trả `roomId` (không lộ map) — reader `getChannelRoomMap` `:289` là private; WARN cần **map thô**, nên bước 4 đọc `getChannelPresenceZoneMap` + (nếu cần map room thô) tái dùng `getChannelRoomMap` — KHÔNG sửa `resolveRoom`. Chốt cách lấy 2 map thô ở lúc code, KHÔNG đụng `resolveRoom`/`resolveUser`.

## 6. Chiến lược test (mock, KHÔNG DB)
- **AC-BACKCOMPAT (§5.5 spec) — test riêng:** `channel_presence_zone_map` trống → điểm danh phòng họp y hệt (resolveRoom/meeting/matchState/INSERT raw/broadcast), **không** gọi `writeAppearEvent`, không dòng presence, không exception. `toMatchObject` trên payload cũ (KHÔNG `toEqual` — payload thêm `presenceSkipped`).
- **(nhánh A) `RETURNING id`:** khẳng định INSERT raw có `RETURNING id`, `eventId` truyền vào writer.
- **Mỗi `presenceSkipped` (4 test) — TẤT CẢ nằm trong payload INSERT (KHÔNG UPDATE):** `zone_unmapped` · `unmatched_identity` (userId NULL) · `bad_utc` (utcFallback=true, **khẳng định KHÔNG now()**) · `zone_wrong_type` (`resolvePresenceZone` trả `{valid:false}` TRƯỚC INSERT → payload có `presenceSkipped='zone_wrong_type'`, **KHÔNG** gọi `writeAppearEvent`, **KHÔNG** UPDATE).
- **Ghi `appear` thành công:** channel trong presence-map + userId≠NULL + zone `corridor` (`resolvePresenceZone` valid) → `writeAppearEvent` gọi 1 lần, event_type='appear', occupancy_count NULL, metadata `{channelId, szUid, similarity}` (KHÔNG `name`); `payload.presenceSkipped` null.
- **QC-5:** `resolvePresenceZone` cho zone `gate` → `{valid:false, reason:'zone_wrong_type'}` → không gọi `writeAppearEvent`, không dòng presence.
- **A.2 WARN:** channel có KEY trong CẢ room_map lẫn presence_map (kể cả khi resolveRoom ra null) → **assert `logger.warn` gọi** thông điệp camera-hai-map; vẫn ghi appear.
- **QĐ-8 tinh thần:** `writeAppearEvent` ném lỗi → `onFaceEvent` KHÔNG ném, raw event vẫn còn.
- `zone-presence-writer.service.spec`: `resolvePresenceZone` corridor/lobby/parking → `{valid:true}`; gate/room/không-tồn-tại/deleted → `{valid:false, reason:'zone_wrong_type'}`. `writeAppearEvent` zone hợp lệ → INSERT + presenceId.
- **Baseline (số thật RECON):** `ivss` 15/151 · `zones` 14/185 · `restricted-zone` 1/12. Kỳ vọng sau: `ivss` > 151, `zones` > 185 (thêm writer + spec), **không giảm**.

## 7. Thứ tự thực hiện (sau mỗi bước build + test xanh)
1. **B1 — hạ tầng thuần thêm mới:** constant (config-key + `PRESENCE_SKIPPED` + `PRESENCE_ZONE_TYPES`); `ZonePresenceWriterService` + spec; export ở `zones.module`. *(nhánh A: + migration `20260725000002`.)* `IvssPresenceIngestionService` CHƯA đổi.
2. **B2 — wiring:** `ivss.module` import `ZonesModule`. Build + ivss test xanh (chưa dùng).
3. **B3 — reader (đọc, ít rủi ro):** thêm private reader `channel_presence_zone_map` + test. Chưa nối nhánh ghi.
4. **B4 — chạm production (RỦI RO CAO, nhỏ nhất):** **task ĐẦU = viết test AC-BACKCOMPAT trước** (xanh trên code hiện tại). Rồi: (nhánh A) `RETURNING id`; resolve zone + WARN hai-map; nhánh `presenceSkipped`; gọi `writeAppearEvent` + UPDATE `zone_wrong_type`. Kèm toàn bộ test §6.
5. **B5 — script vận hành** `scripts/ivss-livetest/`.
6. **Gate mỗi bước:** `npm run build`; eslint **file đã chạm** (KHÔNG `npm run lint` toàn repo); `ivss`+`zones` test xanh không giảm; B4 thêm AC-BACKCOMPAT xanh.

## 8. Rollback (tắt khẩn, KHÔNG revert code)
Xoá (hoặc `is_active=false`) `system_configs['ivss.channel_presence_zone_map']` → reader trả `{}` → mọi sự kiện `zone_unmapped` → writer ngừng ghi presence hoàn toàn. **Điểm danh phòng họp KHÔNG ảnh hưởng** (đường độc lập). Reader **không cache** (mirror UC-105) → hiệu lực ngay, không restart. Đây là phương án tắt khẩn khuyến nghị.

## 9. Tiền điều kiện vận hành
1. **Tạo zone khu vực** (`corridor`/`lobby`/`parking`) qua API UC-90. Kiểm `zone_type` đúng, active, chưa xoá mềm.
2. **Seed `ivss.channel_presence_zone_map`** trỏ channel camera khu vực → zone đó (DELETE-then-INSERT).
3. **Đảm bảo `device_user_mappings`** có mapping cho `szUid` test (`source='ivss'`, chưa xoá mềm).
4. **Cron `SCHEDULER_RESTRICTED_ZONE_ENABLED`** — **bật SAU khi verify writer sạch** (QC-6), KHÔNG thuộc code UC-109.
5. (nhánh A) chạy migration `20260725000002`.
Thiếu bước 1/2 → `zone_unmapped`/`zone_wrong_type` → skip im lặng (chẩn đoán qua `presenceSkipped`).

## 10. Ngoài phạm vi (KHÔNG làm)
- `disappear`/`count`/phiên/ghép cặp/chiều (§2 spec).
- Cấp phát DB "2" (enroll toàn nhân viên).
- Sửa `parseUtc`/`resolveUser`/`resolveRoom`/`resolveBridgeDeviceId`.
- Sửa code Tài (`zone-presence-timeline` UC-110, `restricted-zone`).
- Bật cron restricted-zone (QC-6 — vận hành riêng).

## 11. Nợ kỹ thuật — TD-ZPW-1 (4 reader trùng khuôn `system_configs` channel-map)

Sau UC-109 có **4 bản sao** khuôn đọc `system_configs` cho channel-map (đọc + validate UUID + không cache + lỗi→rỗng). **KHÔNG gom lượt này** (gom = chạm `VehicleResolveService` vừa nghiệm thu phần cứng UC-105). Gom thành util dùng chung **sau khi scope ổn định**. Tới lúc đó **sửa logic validate ở MỘT chỗ phải sửa CẢ 4**:

| # | Reader | path:dòng | config_key |
| :--- | :--- | :--- | :--- |
| 1 | `getChannelRoomMap` | ivss-occupancy-ingest.service.ts:119 | `ivss.channel_room_map` |
| 2 | `getChannelRoomMap` | ivss-presence-ingestion.service.ts:289 | `ivss.channel_room_map` |
| 3 | `getChannelZoneMap` | anpr/vehicle-resolve.service.ts:265 | `ivss.channel_zone_map` |
| 4 | `getChannelPresenceZoneMap` (MỚI UC-109) | ivss-presence-ingestion.service.ts (thêm) | `ivss.channel_presence_zone_map` |

*(+ `getChannelDirectionMap` ×2 cũng cùng khuôn nhưng validate khác — enum thay vì UUID.)*
