# GAW-001 — plan.md (UC-105 ANPR: ghi nhận ra/vào khuôn viên)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-24 | Tạo plan GAW-001 sau spec DUYỆT + chốt 10 QĐ (§2 spec) + 8 QC (§10 spec). Writer chèn vào `VehicleResolveService.onVehicleEvent` (production đã nghiệm thu phần cứng): resolve zone qua `channel_zone_map` + direction qua `channel_direction_map` → gọi method mở rộng `GateAccessLogService.writeGateLog` (QC-3, một chủ bảng) → pairing tx riêng (QĐ-8). Chống trùng B′ = partial unique `20260725000001` (QC-1). 3 transaction tách rời. **`access_time` từ `evt.utc`, CẤM `now()`.** 5 giá trị `gateLogSkipped`. AC-BACKCOMPAT khi `channel_zone_map` trống. | Toàn bộ |
| 2026-07-24 | Review duyệt có điều kiện: (A.1) `accessTime` DÙNG LẠI `eventTime` từ `parseUtc` + cờ `utcFallback` sẵn có — KHÔNG viết parser thứ hai, KHÔNG sửa `parseUtc`; thêm kiểm đồng hồ camera vào §9. (A.2) §5 thêm "Hạn chế đã biết của B′" (multi-frame một lượt xe) + điểm chèn cửa sổ thời gian rẻ. (A.3) §9 query đổi sang `LEFT JOIN gate_access_logs ON event_id` để phân biệt skip vs ghi-hỏng. (A.4) `duplicate` thành giá trị `gateLogSkipped` **thứ 6**. (A.5) biển rỗng sau chuẩn hoá → `plate_number=NULL` (vẫn ghi). (A.6) §4 ghi nợ "hai bản đọc `channel_direction_map`". | CHANGELOG, §0, §2, §3, §4, §5, §6, §9 |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại 10 QĐ (§2 spec) + 8 QC (§10 spec).
> **RÀNG BUỘC SỐNG-CÒN (nhắc lại từ spec §8.4):** **`access_time` PHẢI là `eventTime` trả về từ `parseUtc` (dùng lại, KHÔNG parse lần hai). `utcFallback === true` → `bad_utc`, KHÔNG ghi gate log. TUYỆT ĐỐI KHÔNG `now()` / `CURRENT_TIMESTAMP` / thời điểm nhận request.** Đổi sang `now()` = lớp chống trùng B′ chết âm thầm.

## 0. RECON bổ sung (đọc CODE THẬT)

- **Điểm móc** [vehicle-resolve.service.ts:43](../../../../src/modules/anpr/services/vehicle-resolve.service.ts) `onVehicleEvent`: hiện resolve `deviceId` (:45) → `resolveUserByPlate` (:54, **chỉ trả `user_id`**) → `normalizeVehicleDirection(eventAction)` (:55) → `parseUtc(evt.utc)` (:58) → build `payload` (:61-74) → INSERT `iot_device_events` **KHÔNG `RETURNING`** (:77-82). Bọc `try/catch` NotThrow (:44/:90). Inject `DataSource` (:41).
- **`resolveUserByPlate`** (:109-119): `SELECT user_id FROM vehicle_registrations WHERE plate_number=$1 AND status='active' AND deleted_at IS NULL LIMIT 1`. QC-7 nới thành `SELECT id, user_id ...`, đổi return `{ userId, vehicleRegistrationId } | null`.
- **`parseUtc`** (:143-153): chữ ký `{ eventTime: Date; utcFallback: boolean }`. `utcFallback=true` bao **CẢ HAI** nguyên nhân: ISO không hợp lệ **và** lệch giờ > `SKEW_MS` (1h). Usage hiện tại (:58) `const { eventTime } = this.parseUtc(...)` — **bỏ qua** cờ `utcFallback`. ⚠ QC-8 (cách xử ĐÚNG): **DÙNG LẠI** `eventTime` cho `accessTime` + **đọc thêm cờ `utcFallback`** — `utcFallback===true` → `bad_utc`, KHÔNG ghi gate log. **KHÔNG viết parser thứ hai, KHÔNG sửa `parseUtc`.** Lý do bác parser thứ hai: (1) "parse chặt" không nói rõ có kiểm skew — bỏ skew thì đồng hồ camera lệch 3h ⇒ `event_time=now()` nhưng `access_time=giờ-sai-thiết-bị`, hai mốc khác nhau cùng sự kiện, âm thầm; (2) hai parser sẽ lệch nhau khi ai đó đổi `SKEW_MS` một chỗ. `eventTime` khi `utcFallback=false` chính là `evt.utc` đã parse (tin được), thoả ràng buộc "access_time từ dữ liệu thiết bị".
- **Khuôn reader config** [ivss-presence-ingestion.service.ts:288 `getChannelRoomMap`](../../../../src/modules/ivss/services/ivss-presence-ingestion.service.ts) / `:310 getChannelDirectionMap`: `SELECT config_json FROM system_configs WHERE config_key=$1 AND is_active=true LIMIT 1`, validate từng entry (uuid regex cho zone / value ∈ {enter,leave,seen} cho direction), **không cache**, đọc lỗi → **trả `{}` (không throw)**.
- **`GateAccessLogService`** [gate-access-log.service.ts](../../../../src/modules/zones/services/gate-access-log.service.ts) (UC-107): inject `Repository<GateAccessLogEntity>`; hiện chỉ có `listForUser`/`listAll` (read). QC-3 thêm `writeGateLog`. **KHÔNG `deletedAt`** (append-only).
- **`pairForLeaveLog(leaveId, manager?)`** [gate-log-pairing.service.ts:91](../../../../src/modules/zones/services/gate-log-pairing.service.ts): nhánh **không** `manager` tự mở tx, nuốt `23505`; nhánh **có** `manager` ném thẳng. QĐ-8 ⇒ writer gọi **không truyền manager** + `try/catch` nuốt.
- **`ZonesModule`** [zones.module.ts:59](../../../../src/modules/zones/zones.module.ts) **export** `GateAccessLogService` + `GateLogPairingService`. `anpr.module.ts` hiện import **chỉ** `AuthModule` → thêm `ZonesModule`. Cạnh `anpr → zones` một chiều (zones không import anpr module) ⇒ không circular (RECON đã xác nhận).
- **Migration cuối** `20260722000010`; **UC-105 = `20260725000001`** (QC-1, dải mới tránh chồng RDS).
- **Mẫu migration partial unique index** [20260722000008-AddGateLogsPairedUniqueIndex.ts](../../../../src/database/migrations/20260722000008-AddGateLogsPairedUniqueIndex.ts): `CREATE UNIQUE INDEX ... WHERE ...` / `down` DROP. Viết TAY.
- **`23505` nhận diện** [vehicle-registration.service.ts:212 `isUniqueViolation`](../../../../src/modules/anpr/services/vehicle-registration.service.ts): `(e as {driverError?:{code?:string}})?.driverError?.code === '23505'`.
- **Baseline**: `anpr` 11 suite / 131 test · `zones` 14 suite / 178 test.
- **Route** `/api/v1/internal/ivss/vehicle-events` (spec §9, đã xác minh controller + prefix).

## 1. Phạm vi thay đổi — bảng file

| File | Loại | Thay đổi | Rủi ro |
| :--- | :--- | :--- | :--- |
| `src/modules/anpr/services/vehicle-resolve.service.ts` | **MODIFIED** | **RỦI RO CAO NHẤT** (luồng nghiệm thu phần cứng). Thêm: reader `channel_zone_map`/`channel_direction_map`; nới `resolveUserByPlate`→`{userId, vehicleRegistrationId}`; thêm `RETURNING id` cho INSERT (QĐ-6); tính `accessTime` từ `evt.utc` chặt; quyết định skip 5 nguyên nhân; gọi `zones.writeGateLog`; gọi `pairForLeaveLog` tx riêng. | Cao — đổi dòng production. Giới hạn bằng: tương thích ngược (AC-BACKCOMPAT) + tách bước thực hiện (§7). |
| `src/modules/anpr/anpr.module.ts` | **MODIFIED** | Import `ZonesModule` (lấy `GateAccessLogService`). | Thấp — thêm import một chiều, không circular. |
| `src/modules/zones/services/gate-access-log.service.ts` | **MODIFIED** | Thêm method `writeGateLog` (QC-3). Tự kiểm `zone.type='gate'` + `deleted_at IS NULL`, tx riêng COMMIT, bắt `23505`. | Trung bình — thêm write vào service read-only cũ; không đụng 2 method đọc UC-107. |
| `src/database/migrations/20260725000001-AddGateLogsContentUniqueIndex.ts` | **NEW** | Partial unique index B′ (QC-1). | Trung bình — migration schema thật (ngoại lệ có chủ đích). Cần review + áp RDS chung. |
| `src/modules/anpr/constants/ivss-config-keys.constant.ts` *(hoặc file constant sẵn có của anpr — chốt khi code)* | **NEW/MODIFIED** | Hằng `config_key` (`ivss.channel_zone_map`, `ivss.channel_direction_map`) + tập giá trị `GATE_LOG_SKIPPED` (6 giá trị). | Thấp. |
| `src/modules/anpr/services/vehicle-resolve.service.spec.ts` | **MODIFIED** | Bổ sung test (mock DataSource + GateAccessLogService + pairing). Xem §6. | Thấp. |
| `src/modules/zones/services/gate-access-log.service.spec.ts` | **MODIFIED** | Test `writeGateLog` (zone gate/không-gate/deleted, 23505). | Thấp. |
| `scripts/anpr-livetest/` (`01_seed_gate_zone.sql`, `02_channel_zone_map.TEMPLATE.sql`, `03_curl_examples.sh`, `04_check_gate_logs.sql`, `README.md`) | **NEW** | Script **vận hành** (spec §9). KHÔNG migration, KHÔNG chạy tự động. | Thấp. |

> Reader `channel_zone_map`/`channel_direction_map` **đặt làm private method TRONG `VehicleResolveService`** (không tạo provider/module mới, không import `IvssModule`). **Vì sao ở đó:** mirror đúng khuôn `getChannelRoomMap` vốn là private của chính service tiêu thụ ([ivss-presence-ingestion.service.ts:288]); reader đọc `system_configs` qua `dataSource` đã inject sẵn; đặt trong anpr giữ `anpr` không phụ thuộc `IvssModule` (nguyên tắc "reader qua util/nội bộ, không import service module khác").

## 2. Hợp đồng method `GateAccessLogService.writeGateLog` (QC-3)

Chữ ký + kiểu (không phải code hoàn chỉnh):

```ts
interface WriteGateLogInput {
  zoneId: string;
  direction: 'enter' | 'leave';        // seen đã bị loại phía anpr (QĐ-4)
  accessTime: Date;                    // TỪ evt.utc — KHÔNG now() (QC-1/QC-8)
  deviceId?: string | null;
  eventId?: string | null;             // QĐ-6 (nullable)
  userId?: string | null;              // QĐ-5
  vehicleRegistrationId?: string | null;
  plateNumber?: string | null;         // đã normalize + đã đảm bảo ≤16 phía anpr (QC-2)
  metadata?: Record<string, unknown> | null; // { channelId, plateRaw } (QC-5)
}
type WriteGateLogResult =
  | { written: true;  logId: string }
  | { written: false; skipReason: 'zone_not_gate' | 'duplicate' };
```

- **Validate bên trong (QC-4):** SELECT `zone` theo `zoneId` **kèm `deleted_at IS NULL`**; không tồn tại / `type != 'gate'` → `{ written:false, skipReason:'zone_not_gate' }` (KHÔNG insert).
- **Ghi:** INSERT `gate_access_logs` (bound param — SEC-03) trong **transaction riêng của method** (`queryRunner` mirror [zones.service.ts:131](../../../../src/modules/zones/services/zones.service.ts)), **COMMIT trước khi return** (nền QĐ-8). Trả `{ written:true, logId }`.
- **Chống trùng:** bắt `23505` (vi phạm `UQ_gate_logs_content`) → rollback-bỏ-qua → `{ written:false, skipReason:'duplicate' }`. KHÔNG ném (webhook always-ack). Caller ghi `gateLogSkipped='duplicate'` (giá trị **thứ 6**) qua **UPDATE bổ sung** — cùng cơ chế `zone_not_gate` (QC-7) — để người vận hành phân biệt "lần 2 bị dedup" với "lần 2 rơi vì lý do khác". Sau đó KHÔNG pairing.
- **KHÔNG** gọi pairing bên trong (pairing là việc phía gọi, tx riêng — QĐ-8).
- **KHÔNG** `deletedAt` trên `gate_access_logs` (append-only). Điều kiện `deleted_at IS NULL` chỉ áp cho bảng `zones` được kiểm.

## 3. Thứ tự thao tác trong `onVehicleEvent` — 3 transaction tách rời

Chi tiết hoá §7 spec. Ba tx **độc lập**, không tx nào bao trùm tx khác:

1. `resolveBridgeDeviceId()` — không có → skip toàn bộ (hành vi cũ).
2. `resolveUserByPlate(evt.plateNumber)` → `{ userId, vehicleRegistrationId }` (QC-7, một query).
3. `direction`: `channelDirectionMap[channelId]` (∈ enter/leave) **trước** → `normalizeVehicleDirection(evt.eventAction)` fallback → có thể `seen` (QĐ-3).
4. `zoneId`: `channelZoneMap[channelId]` (QĐ-2) — không có → đánh dấu `zone_unmapped`.
5. Lấy `{ eventTime, utcFallback } = parseUtc(evt.utc)` (một lần, dùng chung). `accessTime = eventTime`. **Nếu `utcFallback === true` → `bad_utc`** (KHÔNG ghi gate log; `iot_device_events.event_time` vẫn dùng `eventTime` như cũ). Xử `plateNumber` (sau `normalizePlate`) theo **ba trường hợp**:
   - **hợp lệ, `1..16` ký tự** → ghi bình thường, có bảo vệ B′.
   - **rỗng (`''`)** → truyền `plate_number = NULL` vào `writeGateLog` (A.5) — **vẫn ghi** gate log, B′ không bảo vệ dòng này (đúng ý đồ, giống `plate_number IS NULL` ở QC-1). Đây KHÔNG phải skip.
   - **> 16 ký tự** → `plate_too_long`, KHÔNG ghi gate log (QC-2).
   Xác định `gateLogSkipped` biết-trước ∈ {`zone_unmapped`,`direction_seen`,`plate_too_long`,`bad_utc`}.
6. **Tx #1** — INSERT `iot_device_events … RETURNING id` (QĐ-6) → `eventId`, kèm `gateLogSkipped` biết-trước (nếu có). COMMIT. *(Ghi luôn-luôn-xảy-ra; hành vi thô giữ nguyên, chỉ thêm `RETURNING id` + khoá skip.)*
7. Nếu có `gateLogSkipped` biết-trước → **dừng** (không gọi zones). Ngược lại → **Tx #2**: `zones.writeGateLog({... eventId, accessTime, metadata:{channelId, plateRaw} ...})`. Method tự mở+COMMIT tx.
   - `written=false, skipReason='zone_not_gate'` → **UPDATE bổ sung** `iot_device_events.payload_json.gateLogSkipped='zone_not_gate'` cho dòng ở bước 6 (QC-7). Dừng.
   - `written=false, skipReason='duplicate'` → **UPDATE bổ sung** `gateLogSkipped='duplicate'` (A.4), không pairing. Dừng.
   - `written=true` → tiếp bước 8.
8. Nếu `direction='leave'` → **Tx #3**: `pairForLeaveLog(logId)` **không manager**, `try/catch` nuốt lỗi (QĐ-8). `direction='enter'` → không pairing (FR-07).
9. Trả về (webhook đã ack 200).

**Toàn bộ `onVehicleEvent` bọc `try/catch` NotThrow** (giữ nguyên). Mỗi bước hỏng theo bảng §8.1 spec — không trạng thái "không xác định".

## 4. Reader `channel_zone_map` (+ `channel_direction_map`)

Private method trong `VehicleResolveService`, mirror `getChannelRoomMap`:

- SQL: `SELECT config_json FROM system_configs WHERE config_key=$1 AND is_active=true LIMIT 1` (bound param).
- Validate từng entry: `channel_zone_map` — value phải là **UUID hợp lệ** (regex như khuôn ivss); entry sai → bỏ entry đó (không làm hỏng cả map). `channel_direction_map` — value ∈ {`enter`,`leave`,`seen`}.
- **Không cache** — theo đúng khuôn hiện tại (config đổi lúc vận hành phải có hiệu lực ngay; tần suất webhook không cao tới mức cần cache; nếu sau này thành hot path thì tối ưu riêng, ngoài scope UC-105).
- Đọc lỗi (config thiếu/JSON hỏng) → **trả `{}`, KHÔNG throw** → map rỗng → `zone_unmapped` (an toàn, đúng AC-BACKCOMPAT).
- Có thể gom một helper private `readChannelMap(configKey, validateValue)` dùng chung cho hai map (DRY), chốt hình thức khi code.

**⚠ Nợ đã biết (A.6) — hai bản đọc `ivss.channel_direction_map`:** sau UC-105, config này có **hai** nơi đọc + tự validate độc lập:
- luồng khuôn mặt: [ivss-presence-ingestion.service.ts:310 `getChannelDirectionMap`](../../../../src/modules/ivss/services/ivss-presence-ingestion.service.ts#L310)
- luồng xe (mới): private reader trong [vehicle-resolve.service.ts](../../../../src/modules/anpr/services/vehicle-resolve.service.ts)

Chấp nhận (để `anpr` không phải import `IvssModule`). **Rủi ro:** hai bên diễn giải cùng một config khác nhau nếu logic validate lệch. **Ràng buộc bắt buộc:** sửa logic validate `channel_direction_map` ở đâu thì **phải sửa cả hai chỗ trên**. Ghi comment chéo `path:dòng` ở cả hai reader để người sau tìm được ngay.

## 5. Migration QC-1 — `20260725000001-AddGateLogsContentUniqueIndex.ts`

- Class `AddGateLogsContentUniqueIndex20260725000001`.
- `up()`:
  ```sql
  CREATE UNIQUE INDEX "UQ_gate_logs_content"
    ON "gate_access_logs" ("zone_id", "plate_number", "direction", "access_time")
    WHERE "plate_number" IS NOT NULL;
  ```
- `down()`: `DROP INDEX "UQ_gate_logs_content"`.
- **Hành vi nếu bảng đã có dòng trùng sẵn:** `CREATE UNIQUE INDEX` sẽ **thất bại** nếu tồn tại ≥2 dòng trùng bộ 4 khoá (với `plate_number` NOT NULL). **Hiện `gate_access_logs` rỗng** (chưa có writer) ⇒ tạo được. Nếu tương lai áp lên môi trường đã có dữ liệu trùng → phải dedup trước; ghi cảnh báo này trong header migration. KHÔNG dùng `CONCURRENTLY` (chạy trong transaction của TypeORM migration).
- Ngoại lệ DATA-02: chỉ THÊM 1 index; KHÔNG cột/bảng/CHECK/index khác.

### 5.1. Hạn chế đã biết của B′ (A.2)
B′ dedup theo `(zone_id, plate_number, direction, access_time)` ⇒ **chỉ chặn khi trùng cả dấu thời gian**. Hạn chế: nếu camera ANPR bắn **nhiều sự kiện cho MỘT lượt xe** (multi-frame / bắn lại khi nhận diện biển), mỗi cái cách nhau ~1 giây → `access_time` khác nhau → B′ **KHÔNG chặn** → nhiều dòng gate log cho một lượt → ghép cặp sai → `duration_seconds` sai. Camera có bắn nhiều lần hay không **chỉ buổi nghiệm thu phần cứng trả lời được**.

1. **Nêu thẳng** (không giấu): B′ giả định camera bắn ≤1 sự kiện cho mỗi lượt-chiều. Chưa xác nhận trên phần cứng thật.
2. **Cách xác minh:** cho **một** xe chạy qua **một** lần, đếm số dòng `iot_device_events` (`event_type='ivss_vehicle_event'`) sinh ra. `=1` ⇒ B′ đủ. `>1` ⇒ cần bổ sung.
3. **Phương án bổ sung nếu `>1`:** cửa sổ thời gian (phương án C, spec §8.4) — bỏ qua nếu cùng `plate + channel + direction` trong N giây.
4. **Yêu cầu thiết kế (làm ngay ở B4 để bổ sung về sau RẺ):** đặt một **guard điểm-quyết-định-ghi ngay TRƯỚC lời gọi `writeGateLog`** (trong `onVehicleEvent`, sau khi đã có `zoneId`+`direction`+`plateNumber`+`accessTime`). Thêm cửa sổ thời gian sau này = chèn một truy vấn "đã có dòng cùng `plate/channel/direction` trong N giây?" tại đúng guard đó — **không** đụng `writeGateLog`, **không** đụng migration/schema. Điểm chèn: giữa bước 6 và bước 7 của §3.

## 6. Chiến lược test (mục quan trọng nhất — mock, KHÔNG DB)

Mock `DataSource`/`queryRunner` + `GateAccessLogService` + `GateLogPairingService`. Bắt buộc phủ:

- **AC-BACKCOMPAT (§8.2 spec) — test riêng:** `channel_zone_map` **trống** → **không** gọi `writeGateLog`; `iot_device_events` vẫn INSERT (kèm `gateLogSkipped='zone_unmapped'`); không exception; không dòng gate log. Đây là bằng chứng luồng nghiệm thu phần cứng không đổi.
- **QĐ-6 (`RETURNING id`):** khẳng định INSERT `iot_device_events` có `RETURNING id` và `eventId` được truyền vào `writeGateLog`.
- **Mỗi giá trị `gateLogSkipped` (6 test):**
  - `zone_unmapped` — channel không có trong `channel_zone_map`.
  - `direction_seen` — direction resolve ra `seen` (map trống + eventAction lạ).
  - `zone_not_gate` — `writeGateLog` trả `skipReason='zone_not_gate'` → khẳng định có **UPDATE bổ sung** payload.
  - `plate_too_long` — `plateNumber` > 16 ký tự → không gọi `writeGateLog`.
  - `bad_utc` — **hai case:** (a) `evt.utc` ISO hỏng, (b) `evt.utc` lệch giờ > `SKEW_MS` (1h) — cả hai cho `utcFallback=true` → không gọi `writeGateLog`, **khẳng định KHÔNG ghi `now()`**.
  - `duplicate` — `writeGateLog` trả `skipReason='duplicate'` → khẳng định có **UPDATE bổ sung** `gateLogSkipped='duplicate'`, không pairing (A.4).
- **Biển rỗng (A.5):** `plateNumber=''` sau chuẩn hoá → `writeGateLog` được gọi với `plateNumber=NULL` (**vẫn ghi**, không skip).
- **QC-1 (chống trùng):** gọi `onVehicleEvent` 2 lần cùng payload → lần 2 `writeGateLog` trả `duplicate` (mock ném 23505 ở tầng zones-service-spec) → chỉ 1 dòng gate log, không pairing lần 2. Ở `gate-access-log.service.spec`: mock repo/queryRunner ném `23505` → `writeGateLog` trả `{written:false, skipReason:'duplicate'}`, không ném.
- **QC-8 (access_time từ utc):** payload `utc` hợp lệ → khẳng định `accessTime` truyền vào `writeGateLog` **bằng** giá trị parse từ `utc` (KHÔNG phải thời điểm test chạy).
- **QĐ-8 (pairing không kéo rollback):** `pairForLeaveLog` ném lỗi → `onVehicleEvent` **không** ném; khẳng định `writeGateLog` đã được gọi (gate log vẫn còn — không rollback).
- **QC-5 (metadata):** khẳng định `writeGateLog` nhận `metadata={channelId, plateRaw}`.
- **`writeGateLog` (zones spec):** zone gate hợp lệ → INSERT + trả `logId`; zone `type='room'` → `zone_not_gate`; zone `deleted_at` không NULL → `zone_not_gate`; 23505 → `duplicate`.

**Kỳ vọng số sau khi xong (KHÔNG được giảm):** `anpr` ≥ 11 suite / **> 131** test; `zones` 14 suite / **> 178** test. Baseline hiện tại phải giữ xanh nguyên vẹn.

## 7. Thứ tự thực hiện (sau mỗi bước repo chạy + test xanh)

Đưa phần chạm production ra **bước riêng, nhỏ nhất**:

1. **B1 — hạ tầng thuần thêm mới (không chạm production flow):** constant config-key + `GATE_LOG_SKIPPED`; migration `20260725000001`; method `writeGateLog` + test `gate-access-log.service.spec`. Repo build + zones test xanh. `VehicleResolveService` CHƯA đổi.
2. **B2 — wiring module:** `anpr.module` import `ZonesModule`. Build xanh (chưa dùng tới).
3. **B3 — readers + nới `resolveUserByPlate` (đọc, ít rủi ro):** thêm private reader `channel_zone_map`/`channel_direction_map`; đổi `resolveUserByPlate` trả `{userId, vehicleRegistrationId}` (cập nhật chỗ dùng). Test đọc. Chưa ghi gate log.
4. **B4 — chạm production (RỦI RO CAO, nhỏ nhất):** thêm `RETURNING id`, tính `accessTime` từ `utc`, nhánh skip 5 nguyên nhân, gọi `writeGateLog`, UPDATE `zone_not_gate`, gọi `pairForLeaveLog`. Kèm **toàn bộ** test §6 (đặc biệt AC-BACKCOMPAT). Đây là bước duy nhất đổi hành vi runtime của luồng ANPR.
5. **B5 — script vận hành** `scripts/anpr-livetest/` (không ảnh hưởng code/test).
6. **Gate:** `npm run build`; eslint trên **file đã chạm** (KHÔNG `npm run lint` toàn repo); `anpr` + `zones` test xanh, số không giảm.

## 8. Rollback (tắt KHẨN mà KHÔNG revert code)

- **Cách chính:** **xoá `system_configs['ivss.channel_zone_map']`** (hoặc set `is_active=false`) → reader trả `{}` → mọi sự kiện `zone_unmapped` → **writer skip toàn bộ**, `gate_access_logs` ngừng nhận dòng mới. Luồng thô `iot_device_events` vẫn chạy như trước UC-105. **Đã kiểm logic:** đúng — không cần revert code, không cần restart (reader không cache). Đây là phương án tắt khẩn được khuyến nghị.
- Cron pairing đã env-gated `SCHEDULER_GATE_PAIRING_ENABLED` (default OFF) — không tự chạy.
- Index `UQ_gate_logs_content`: nếu cần gỡ, chạy `down()` migration (không nên — chỉ khi index gây sự cố thật).

## 9. Tiền điều kiện vận hành (spec §11)

Sau khi code xong, writer **chưa ghi dòng nào** cho tới khi làm **theo thứ tự**:
1. **Tạo zone `type='gate'`** qua API UC-90. Kiểm: `GET` zone thấy `zone_type='gate'`, `status='active'`, chưa xoá mềm.
2. **Seed `ivss.channel_zone_map`** trỏ `channelId` camera cổng → `id` zone gate (DELETE-then-INSERT, mirror `scripts/anpr-livetest/02_channel_zone_map.TEMPLATE.sql`). Kiểm: query `system_configs` thấy config `is_active=true`, value là UUID zone gate.
3. (Khuyến nghị) seed `ivss.channel_direction_map` cho channel vào/ra để `direction` chính xác thay vì phụ thuộc `eventAction`.
4. **⚠ Kiểm đồng bộ đồng hồ camera/IVSS TRƯỚC buổi nghiệm thu (A.1).** Lệch quá `SKEW_MS` (1h) so với giờ server ⇒ `utcFallback=true` cho **mọi** sự kiện ⇒ **không dòng gate log nào** (tất cả ra `bad_utc`). Kiểm và chỉnh NTP trước, đừng phát hiện giữa buổi.

Thiếu bước 1 hoặc 2 → `zone_unmapped`/`zone_not_gate` → skip im lặng; lệch đồng hồ (bước 4) → `bad_utc`. Chẩn đoán tất cả qua query dưới.

### 9.1. Query chẩn đoán — `LEFT JOIN` trên `event_id` (A.3)
Nội dung chính của `scripts/anpr-livetest/04_check_gate_logs.sql`. Thay cho `SELECT * FROM gate_access_logs` đơn thuần — vì raw event **không có** `gateLogSkipped` có thể là "ghi thành công" HOẶC "ghi hỏng/crash giữa Tx#1 và Tx#2", hai trạng thái khác hẳn cùng một dấu vết. `event_id` luôn được điền (QĐ-6) nên `LEFT JOIN` phân biệt được:

```sql
SELECT e.id, e.event_time,
       e.payload_json->>'gateLogSkipped' AS skip_reason,
       g.id AS gate_log_id, g.direction, g.access_time, g.paired_log_id
FROM iot_device_events e
LEFT JOIN gate_access_logs g ON g.event_id = e.id
WHERE e.event_type = 'ivss_vehicle_event'
ORDER BY e.event_time DESC
LIMIT 20;
```

| `skip_reason` | `gate_log_id` | Nghĩa |
| :--- | :--- | :--- |
| NULL | có | ✅ ghi thành công |
| có giá trị | NULL | ⏭ skip đúng thiết kế — đọc lý do (6 giá trị) |
| **NULL** | **NULL** | 🔴 **ghi HỎNG** — phải điều tra (crash giữa Tx#1/Tx#2) |

## 10. Ngoài phạm vi (KHÔNG làm ở plan/code UC-105)

- Logic UC-103 (control-list) / UC-108 (cảnh báo) — chỉ ĐỌC `gate_access_logs`, không chèn hook (QĐ-9).
- Thuật toán ghép cặp UC-106 — chỉ **gọi** `pairForLeaveLog`, không sửa.
- Đọc/tra cứu gate log UC-107 — không đụng 2 method đọc của `GateAccessLogService`.
- Sửa `vehicle_registrations.plate_number` (rủi ro độ dài có sẵn — ngoài scope, spec §8.3).
- Không refactor `resolveBridgeDeviceId`/`parseUtc`/chuẩn hoá biển ngoài phần QC-7/QC-8 nêu trên.
