# ZPW-001 — tasks.md (UC-109 IVSS: ghi nhận hiện diện theo khu vực · vòng `appear`)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo tasks ZPW-001 từ plan DUYỆT (A.1 quyết-định-trước-INSERT + `resolvePresenceZone`; A.2 WARN kiểm KEY; A.3 nợ TD-ZPW-1). **Đi nhánh B (QC-1 LỆCH + "KHÔNG migration"): không cột `event_id`, không RETURNING id, không migration.** B4 chạm `onFaceEvent` mở đầu bằng test AC-BACKCOMPAT. | Toàn bộ |

> Spec: [spec.md](./spec.md) · Plan: [plan.md](./plan.md). KHÔNG mở lại 4 QĐ + 6 QC.

---

## 🔴 RÀNG BUỘC SỐNG-CÒN (đọc trước khi code — giả định bạn CHỈ đọc file này)

> - **`event_time` = `eventTime` từ `parseUtc`; `utcFallback == true` → skip `bad_utc`. TUYỆT ĐỐI KHÔNG `now()`.**
> - **`ivss` KHÔNG bắn raw SQL vào `zone_presence_events`** — chỉ gọi method bên `zones` (QĐ-1).
> - **Chỉ ghi `appear` khi: channel ∈ presence-map · userId != NULL · utcFallback == false · zone.type ∈ {corridor,lobby,parking}.** Thiếu bất kỳ điều nào → skip + đánh dấu lý do.
> - **Quyết định skip (gồm `zone_wrong_type` qua `resolvePresenceZone`) tính TRƯỚC INSERT raw; chỉ phần GHI nằm sau (A.1). KHÔNG UPDATE bù.**
> - **KHÔNG sửa** `parseUtc`, `resolveUser`, `resolveRoom`, `resolveBridgeDeviceId`, `matchStateOf`, `broadcastPresence`, và **toàn bộ nhánh điểm danh phòng họp**.
> - **AC-BACKCOMPAT:** `channel_presence_zone_map` trống → `onFaceEvent` hành xử y hệt trước UC-109 (chỉ thêm khoá `presenceSkipped` trong payload).
> - **🔴 QC-1 LỆCH — nhánh B (chốt + 3 chỉnh):** `zone_presence_events` **KHÔNG có cột `event_id`** (migration `20260721000005`). **KHÔNG migration.** Link raw event qua **`metadata_json.sourceEventId`** (JSONB), KHÔNG cột FK. **VẪN giữ `RETURNING id`** ở `onFaceEvent` — `id` đi vào `metadata_json.sourceEventId` thay vì cột. `writeAppearEvent` nhận thêm `sourceEventId`, ghi vào `metadata_json` cùng `{channelId, szUid, similarity}`. Script verify: `WHERE z.metadata_json->>'sourceEventId' = e.id::text` (KHÔNG `LEFT JOIN ON event_id`).
> - `presenceSkipped` ∈ { `zone_unmapped`, `unmatched_identity`, `bad_utc`, `zone_wrong_type` }.
> - **Baseline (số thật RECON):** `ivss` 15/151 · `zones` 14/185 · `restricted-zone` 1/12. **KHÔNG được giảm.**
> - **Gate:** `npm run build`; eslint **CHỈ file đã chạm** (KHÔNG `npm run lint` toàn repo).

---

## Nhóm B1 — Hạ tầng thuần thêm mới (KHÔNG chạm `onFaceEvent`)

### T1.1 — Constant config-key + tập giá trị
- **File:** `src/modules/ivss/constants/zone-presence.constant.ts` — **NEW** (hoặc gộp constant ivss sẵn có — kiểm trước).
- **Làm gì:** hằng `IVSS_CHANNEL_PRESENCE_ZONE_MAP_KEY = 'ivss.channel_presence_zone_map'`; `PRESENCE_SKIPPED_REASONS` (union 4 giá trị); `PRESENCE_ZONE_TYPES = ['corridor','lobby','parking'] as const` + type.
- **Tiêu chí:** `npm run build` OK; export đúng 4 skip + 3 zone-type.
- **Test:** không bắt buộc (hằng).
- **Phụ thuộc:** không.

### T1.2 — `ZonePresenceWriterService` (2 method: resolvePresenceZone + writeAppearEvent)
- **File:** `src/modules/zones/services/zone-presence-writer.service.ts` — **NEW**.
- **Làm gì:** service mới (QC-4). `resolvePresenceZone(zoneId)` (ĐỌC): SELECT zone `deleted_at IS NULL` + `zone_type ∈ PRESENCE_ZONE_TYPES` → `{valid, reason?:'zone_wrong_type'}` (không tồn tại/sai type → invalid). `writeAppearEvent(input)` (GHI): validate type lần nữa (defense), INSERT `zone_presence_events` (`event_type='appear'`, `occupancy_count=NULL`, `source_type='ivss'`, **KHÔNG `event_id`** — nhánh B, bound param) trong queryRunner tx riêng COMMIT trước khi trả `{presenceId}`; release finally. **KHÔNG** `deletedAt`, **KHÔNG** unique/pairing.
- **Tiêu chí:** test T1.3 xanh; build OK.
- **Phụ thuộc:** T1.1.

### T1.3 — Test `ZonePresenceWriterService`
- **File:** `src/modules/zones/services/zone-presence-writer.service.spec.ts` — **NEW**.
- **Làm gì:** mock DataSource/queryRunner. `resolvePresenceZone`: corridor/lobby/parking → `{valid:true}`; gate/room/không-tồn-tại/deleted → `{valid:false, reason:'zone_wrong_type'}`. `writeAppearEvent`: zone hợp lệ → INSERT (khẳng định SQL có `event_type`/`occupancy_count` NULL, KHÔNG có `event_id`) + trả presenceId; release gọi.
- **Tiêu chí:** case xanh; suite `zones` > 185.
- **Phụ thuộc:** T1.2.

### T1.4 — Provider + export ở `zones.module`
- **File:** `src/modules/zones/zones.module.ts` — **MODIFIED**.
- **Làm gì:** thêm `ZonePresenceWriterService` vào `providers` **và `exports`** (bài học UC-105: quên export = ivss không inject được).
- **Tiêu chí:** build OK; zones test xanh.
- **Phụ thuộc:** T1.2.

### 🚦 GATE B1
- build OK · eslint file chạm sạch · `zones` > 185 · `ivss`/`restricted-zone` không đổi · `IvssPresenceIngestionService` CHƯA chạm (git diff xác nhận).

---

## Nhóm B2 — Wiring module

### T2.1 — `ivss.module` import `ZonesModule` + test compile module
- **File:** `src/modules/ivss/ivss.module.ts` — **MODIFIED**; `src/modules/ivss/ivss.module.spec.ts` — **NEW** (reflect-metadata khoá `imports` chứa `ZonesModule`, mirror `anpr.module.spec.ts` của UC-105 — compile thật fail vì thiếu forRoot, chứng minh không-circular bằng tĩnh: `zones` không import `ivss`).
- **Làm gì:** thêm `ZonesModule` vào `imports`. Cạnh `ivss → zones` một chiều (RECON §A).
- **Tiêu chí:** build OK; test metadata xanh; `ivss` test cũ xanh.
- **Phụ thuộc:** T1.4.

### 🚦 GATE B2
- build OK · `ivss` (+2 metadata) + `zones` xanh · không circular (chứng minh tĩnh + metadata test).

---

## Nhóm B3 — Reader `channel_presence_zone_map` (ĐỌC, ít rủi ro)

### T3.1 — Private reader trong `IvssPresenceIngestionService`
- **File:** `src/modules/ivss/services/ivss-presence-ingestion.service.ts` — **MODIFIED** (chỉ THÊM method private, CHƯA nối vào `onFaceEvent`).
- **Làm gì:** `getChannelPresenceZoneMap()` mirror `getChannelRoomMap` `:289`: query `system_configs` key `ivss.channel_presence_zone_map` `is_active=true`, validate UUID mỗi value, không cache, lỗi → `{}` không throw. Ghi comment **nợ TD-ZPW-1** (path 4 reader).
- **Tiêu chí:** test T3.2 xanh; build OK; `onFaceEvent` chưa đổi hành vi.
- **Phụ thuộc:** T1.1.

### T3.2 — Test reader
- **File:** `src/modules/ivss/services/ivss-presence-ingestion.service.spec.ts` — **MODIFIED**.
- **Làm gì:** config trống/thiếu → `{}`; value không-UUID → bỏ entry; JSON hỏng → `{}` không throw.
- **Tiêu chí:** xanh; `ivss` > 151.
- **Phụ thuộc:** T3.1.

### 🚦 GATE B3
- build OK · eslint sạch · `ivss` > 151 · `zones` > 185 · `onFaceEvent` runtime chưa đổi (chỉ thêm reader chưa gọi).

---

## Nhóm B4 — Chạm production `onFaceEvent` (RỦI RO CAO NHẤT — điểm danh đã nghiệm thu phần cứng)

> Bước **duy nhất** đổi hành vi runtime luồng điểm danh. Mỗi task ghi **CŨ → MỚI**.

### T4.1 — Test AC-BACKCOMPAT (VIẾT TRƯỚC — lưới an toàn)
- **File:** `ivss-presence-ingestion.service.spec.ts` — **MODIFIED**.
- **Làm gì:** characterization test: `channel_presence_zone_map` trống → điểm danh phòng họp y hệt (INSERT `iot_device_events` `ivss_face_event` với đúng trường cũ: `device_id`/`room_id`/`meeting_id`/`event_time`/`processed_status` + payload chứa `szUid`/`userId`/`channelId`/`matchState`/`direction`), **KHÔNG** gọi `writeAppearEvent`, không exception. **`toMatchObject` trên payload — KHÔNG `toEqual`** (payload sẽ thêm `presenceSkipped`).
- **Tiêu chí:** xanh **trên code hiện tại** (trước T4.2) và sau B4.
- **Phụ thuộc:** T3.2.

### T4.2 — Tính `presenceSkipped` TRƯỚC INSERT + WARN camera-hai-map
- **File:** `ivss-presence-ingestion.service.ts` — **MODIFIED**.
- **CŨ:** payload không có `presenceSkipped`; không resolve zone.
- **MỚI:** sau khi có `userId`/`roomId`/`{eventTime,utcFallback}` (GIỮ), đọc `presenceMap`; WARN nếu `channelId` có KEY trong **cả** roomMap lẫn presenceMap (A.2, dùng `getChannelRoomMap` + `getChannelPresenceZoneMap`, KHÔNG sửa `resolveRoom`); tính `presenceSkipped` (`zone_unmapped`/`unmatched_identity`/`bad_utc`); nếu chưa skip → `zones.resolvePresenceZone(zoneId)` → `!valid` ⇒ `zone_wrong_type`. Nhét `presenceSkipped` (hoặc null) vào payload **một lần**. **THÊM `RETURNING id`** vào INSERT raw → `sourceEventId` (chỉnh #1: id vào JSONB, không cột). **KHÔNG** đụng nhánh điểm danh.
- **Tiêu chí:** AC-BACKCOMPAT (T4.1) vẫn xanh; build OK.
- **Phụ thuộc:** T4.1, T3.1, T1.2.

### T4.3 — Gọi `writeAppearEvent` SAU INSERT (chỉ GHI)
- **File:** `ivss-presence-ingestion.service.ts` — **MODIFIED**.
- **CŨ:** không ghi `zone_presence_events`.
- **MỚI:** sau INSERT raw + sau nhánh điểm danh (GIỮ), nếu `presenceSkipped == null` → `zones.writeAppearEvent({zoneId, userId, eventTime, deviceId, metadata:{channelId, szUid, similarity}})` bọc try/catch **nuốt lỗi** (không throw, không vỡ điểm danh). **KHÔNG** UPDATE (skip đã ở payload). `metadata` KHÔNG `name` (QC-3).
- **Tiêu chí:** test T4.4 xanh; AC-BACKCOMPAT vẫn xanh.
- **Phụ thuộc:** T4.2.

### T4.4 — Test luồng ghi đầy đủ
- **File:** `ivss-presence-ingestion.service.spec.ts` — **MODIFIED**.
- **Làm gì:** mock `ZonePresenceWriterService` (resolvePresenceZone + writeAppearEvent). Phủ:
  - 4 `presenceSkipped` trong payload (KHÔNG UPDATE): `zone_unmapped`, `unmatched_identity`, `bad_utc` (**khẳng định KHÔNG now()**), `zone_wrong_type` (resolvePresenceZone `{valid:false}` → không gọi writeAppearEvent).
  - ghi `appear` thành công: presence-map + userId + corridor → writeAppearEvent gọi 1 lần, metadata `{channelId, szUid, similarity}` (KHÔNG name), payload.presenceSkipped null.
  - A.2 WARN: channel có KEY cả 2 map (kể cả resolveRoom→null) → assert `logger.warn`.
  - writeAppearEvent ném lỗi → `onFaceEvent` KHÔNG ném (raw event còn).
- **Tiêu chí:** xanh; `ivss` > 151.
- **Phụ thuộc:** T4.3.

### T4.5 — Đối chiếu baseline
- **File:** không (chạy test).
- **Làm gì:** chạy `ivss`+`zones`+`restricted-zone`, đối chiếu baseline.
- **Tiêu chí:** `ivss`>151 · `zones`>185 · `restricted-zone`=12, không suite/test biến mất; AC-BACKCOMPAT xanh.
- **Phụ thuộc:** T4.4.

### 🚦 GATE B4
- build OK · eslint CHỈ file chạm sạch · 3 module xanh không giảm · **AC-BACKCOMPAT XANH**.

---

## Nhóm B5 — Script vận hành (KHÔNG code)

### T5.1 — `scripts/ivss-livetest/` bổ sung verify presence
- **File:** `scripts/ivss-livetest/` — **NEW/thêm**: template seed `channel_presence_zone_map`, curl face event (`/api/v1/internal/ivss/events`, `X-Internal-Token`), query kiểm (nhánh B: lọc `payload_json->>'presenceSkipped'` + `SELECT ... FROM zone_presence_events WHERE event_type='appear'` — KHÔNG `LEFT JOIN ON event_id` vì không có cột), README.
- **Tiêu chí:** file tồn tại, README nêu thứ tự + cron bật SAU (QC-6). KHÔNG migration, KHÔNG hook npm.
- **Phụ thuộc:** không.

### 🚦 GATE B5
- Script đọc-only/template; repo xanh như GATE B4.

---

## Việc VẬN HÀNH (KHÔNG phải code — sau merge)
1. Tạo zone khu vực (`corridor`/`lobby`/`parking`) qua API UC-90.
2. Seed `ivss.channel_presence_zone_map` (channel camera khu vực → zone).
3. Đảm bảo `device_user_mappings` có mapping cho szUid test (`source='ivss'`, chưa xoá mềm).
4. Chạy `scripts/ivss-livetest/` verify.
5. **Cron `SCHEDULER_RESTRICTED_ZONE_ENABLED` — bật SAU khi verify writer sạch** (QC-6).
6. (Nếu team chọn nhánh A) migration `20260725000002` thêm `event_id` — lượt sau.

## Ngoài phạm vi (KHÔNG làm)
- `disappear`/`count`/phiên/ghép cặp; cấp phát DB "2"; sửa `parseUtc`/`resolveUser`/`resolveRoom`/nhánh điểm danh; sửa code Tài; gom 4 reader (TD-ZPW-1); migration (nhánh A).
