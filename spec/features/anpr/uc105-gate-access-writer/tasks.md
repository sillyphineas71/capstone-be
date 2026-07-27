# GAW-001 — tasks.md (UC-105 ANPR: ghi nhận ra/vào khuôn viên)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-24 | Tạo tasks GAW-001 từ plan DUYỆT (5 bước B1→B5). 6 giá trị `gateLogSkipped`. B4 (chạm production) mở đầu bằng test AC-BACKCOMPAT. Kèm GATE giữa nhóm + mục vận hành tách riêng. | Toàn bộ |

> Spec: [spec.md](./spec.md) · Plan: [plan.md](./plan.md). Tasks KHÔNG mở lại 10 QĐ (§2 spec) + 8 QC (§10 spec).

---

## 🔴 RÀNG BUỘC SỐNG-CÒN (đọc trước khi code — giả định bạn CHỈ đọc file này)

> - **`access_time` PHẢI là `eventTime` trả về từ `parseUtc(evt.utc)`, kèm đọc cờ `utcFallback`. `utcFallback === true` → skip `bad_utc`, KHÔNG ghi gate log. TUYỆT ĐỐI KHÔNG `now()` / `CURRENT_TIMESTAMP` / thời điểm nhận request.** Đổi sang `now()` = lớp chống trùng B′ chết âm thầm — không lỗi, chỉ dữ liệu sai. **KHÔNG viết parser thứ hai, KHÔNG sửa `parseUtc`** (chỉ đọc thêm cờ nó đã trả).
> - **`anpr` KHÔNG được bắn raw SQL vào `gate_access_logs`.** Chỉ gọi `GateAccessLogService.writeGateLog` (QĐ-1/QC-3). Việc `iot_device_events` (INSERT/UPDATE payload) thì `anpr` vẫn tự làm như hiện tại.
> - **KHÔNG gọi `pairForLeaveLog` trong cùng transaction với ghi gate log.** Tx riêng, **không** truyền `manager`, `try/catch` NUỐT lỗi (QĐ-8).
> - **KHÔNG sửa `parseUtc`, `resolveBridgeDeviceId`, `normalizePlate`.** `resolveUserByPlate` **chỉ** mở rộng cột trả về (thêm `vehicle_registration_id`).
> - **AC-BACKCOMPAT bắt buộc:** `channel_zone_map` trống → hành vi giống hệt trước UC-105 (không dòng gate log, không exception, webhook ack 200).
> - Migration mang số **`20260725000001`**.
> - **6 giá trị `gateLogSkipped`:** `zone_unmapped` · `direction_seen` · `zone_not_gate` · `plate_too_long` · `bad_utc` · `duplicate`.
> - **Baseline KHÔNG được giảm (SỐ THẬT đo 2026-07-24):** `anpr` **14 suite / 183 test** · `zones` **14 suite / 178 test**. ⚠ Số cũ `anpr 11/131` trong bản tasks đầu **đã lỗi thời** (đồng đội thêm test sau khi plan viết) — dùng 14/183.
> - **Gate check:** `npm run build`; eslint **CHỈ file đã chạm** (KHÔNG `npm run lint` toàn repo — nó `--fix` cả repo).

---

## Nhóm B1 — Hạ tầng thuần thêm mới (KHÔNG chạm luồng production)

### T1.1 — Constant config-key + tập `GATE_LOG_SKIPPED`
- **File:** `src/modules/anpr/constants/ivss-config-keys.constant.ts` — **NEW** (hoặc gộp vào constant sẵn có của `anpr` nếu tồn tại — kiểm trước).
- **Làm gì:** khai hằng `IVSS_CHANNEL_ZONE_MAP = 'ivss.channel_zone_map'`, `IVSS_CHANNEL_DIRECTION_MAP = 'ivss.channel_direction_map'`; union/enum `GATE_LOG_SKIPPED` gồm đúng **6 giá trị** (`zone_unmapped`,`direction_seen`,`zone_not_gate`,`plate_too_long`,`bad_utc`,`duplicate`).
- **Tiêu chí hoàn thành:** `npm run build` không lỗi; file export đúng 6 giá trị.
- **Test:** không bắt buộc (hằng thuần).
- **Phụ thuộc:** không.

### T1.2 — Migration partial unique index B′
- **File:** `src/database/migrations/20260725000001-AddGateLogsContentUniqueIndex.ts` — **NEW**.
- **Làm gì:** `up()` tạo `CREATE UNIQUE INDEX "UQ_gate_logs_content" ON "gate_access_logs" ("zone_id","plate_number","direction","access_time") WHERE "plate_number" IS NOT NULL;`. `down()` `DROP INDEX "UQ_gate_logs_content"`. Header ghi cảnh báo: **thất bại nếu bảng đã có dòng trùng bộ 4 khoá** (hiện rỗng nên an toàn); ngoại lệ DATA-02 (chỉ 1 index).
- **Tiêu chí hoàn thành:** `npm run build` không lỗi; migration đúng tên class `AddGateLogsContentUniqueIndex20260725000001`; KHÔNG `CONCURRENTLY`.
- **Test:** không (migration).
- **Phụ thuộc:** không. **KHÔNG chạy migration ở bước code** (mục vận hành).

### T1.3 — Method `GateAccessLogService.writeGateLog`
- **File:** `src/modules/zones/services/gate-access-log.service.ts` — **MODIFIED**.
- **Làm gì:** thêm method `writeGateLog(input: WriteGateLogInput): Promise<WriteGateLogResult>` (chữ ký + kiểu ở plan §2). Tự kiểm `zone` tồn tại + `zone.type='gate'` + `zone.deleted_at IS NULL` → không đạt trả `{written:false, skipReason:'zone_not_gate'}` (KHÔNG insert). Đạt → INSERT `gate_access_logs` trong **queryRunner tx riêng, COMMIT trước khi return**, trả `{written:true, logId}`. Bound param (SEC-03). **KHÔNG** `deletedAt` trên `gate_access_logs`; **KHÔNG** đụng 2 method đọc UC-107; **KHÔNG** gọi pairing bên trong.
- **⚠ Quản lý `queryRunner` (BẮT BUỘC — rò kết nối lộ sau vài trăm sự kiện, không lộ trong test/demo):**
  - `catch` bắt **`23505`** → **`rollbackTransaction()`** → trả `{written:false, skipReason:'duplicate'}` (KHÔNG ném). *(Postgres huỷ transaction khi `23505` — mọi lệnh sau đều lỗi tới khi rollback.)*
  - `catch` lỗi **khác** → `rollbackTransaction()` → **ném lại** (caller nuốt theo spec §8.1).
  - **`release()` trong `finally`** — áp cho **MỌI** nhánh thoát: thành công, `duplicate`, lỗi-khác, và cả nhánh `zone_not_gate` (nhánh có tạo queryRunner). Nếu nhánh `zone_not_gate` kiểm zone **trước khi** tạo/connect queryRunner thì không cần release cho nhánh đó — nêu rõ cách chọn khi code.
- **Tiêu chí hoàn thành:** test T1.4 xanh; `npm run build` không lỗi.
- **Test:** (ở T1.4).
- **Phụ thuộc:** T1.1.

### T1.4 — Test `writeGateLog`
- **File:** `src/modules/zones/services/gate-access-log.service.spec.ts` — **MODIFIED**.
- **Làm gì:** mock repo/`queryRunner`. Case: (a) zone gate hợp lệ → INSERT + trả `logId`; (b) zone `type='room'` → `zone_not_gate`, không insert; (c) zone `deleted_at` NOT NULL → `zone_not_gate`; (d) zone không tồn tại → `zone_not_gate`; (e) `23505` → `{written:false, skipReason:'duplicate'}`, không ném; (f) `plate_number=NULL` truyền vào vẫn INSERT (không lỗi).
- **Tiêu chí hoàn thành:** 6 case xanh; suite `zones` **> 178 test**.
- **Phụ thuộc:** T1.3.

### 🚦 GATE B1
- `npm run build` không lỗi.
- eslint file đã chạm (T1.1/T1.2/T1.3/T1.4) sạch (đối chiếu HEAD nếu có lint nền).
- Test `zones` xanh, **> 178**. `anpr` **không đổi** (chưa chạm) = 183.
- `VehicleResolveService` CHƯA đổi — xác nhận `git diff` không chạm file đó.

---

## Nhóm B2 — Wiring module

### T2.1 — `anpr.module` import `ZonesModule` + test compile module
- **File:** `src/modules/anpr/anpr.module.ts` — **MODIFIED**; `src/modules/anpr/anpr.module.spec.ts` — **NEW** (nếu chưa có).
- **Làm gì:** thêm `ZonesModule` vào `imports` (lấy `GateAccessLogService` + `GateLogPairingService` — đã export ở `zones.module.ts:59`). Cạnh `anpr → zones` một chiều.
- **⚠ `npm run build` (tsc) KHÔNG chứng minh không-circular:** phụ thuộc vòng NestJS là lỗi **lúc khởi tạo module runtime**, `tsc` không thấy; spec khởi tạo service bằng mock trực tiếp cũng không thấy. Phải có **test compile module tối thiểu**:
  ```ts
  const moduleRef = await Test.createTestingModule({ imports: [AnprModule] })
    // override provider cần DB thật (DataSource/repo) bằng mock để compile không cần DB
    .compile();
  ```
  (theo khuôn `*.module.spec.ts` sẵn có trong repo nếu tìm được; không có khuôn → dùng mẫu tối thiểu trên + override những gì cần.)
- **Nếu KHÔNG compile module được trong test** (lý do kỹ thuật): **KHÔNG bỏ qua** — đổi GATE B2 sang **"boot app một lần ở local xác nhận không lỗi khởi tạo module"** và ghi rõ đây là bước THỦ CÔNG (báo trước khi boot, không để chạy nền).
- **Tiêu chí hoàn thành:** `npm run build` không lỗi; test compile module xanh (không `Nest can't resolve dependencies` / không circular); suite `anpr` hiện có vẫn xanh.
- **Phụ thuộc:** T1.3.

### 🚦 GATE B2
- `npm run build` không lỗi. Test `anpr` 183 + `zones` (>178) xanh. Không circular (build đã chứng minh).

---

## Nhóm B3 — Readers + mở rộng `resolveUserByPlate` (ĐỌC, ít rủi ro)

### T3.1 — Private reader `channel_zone_map` / `channel_direction_map`
- **File:** `src/modules/anpr/services/vehicle-resolve.service.ts` — **MODIFIED**.
- **Làm gì:** thêm private method đọc `system_configs` (mirror `getChannelRoomMap` [ivss-presence-ingestion.service.ts:288]): `SELECT config_json FROM system_configs WHERE config_key=$1 AND is_active=true LIMIT 1` (bound param); validate từng entry (`channel_zone_map`: value UUID hợp lệ; `channel_direction_map`: value ∈ enter/leave/seen); **không cache**; đọc lỗi → trả `{}` (KHÔNG throw). Khuyến nghị helper chung `readChannelMap(configKey, validate)`. **Ghi comment chéo nợ A.6** (path:dòng của reader luồng face) ở cả hai nơi.
- **Tiêu chí hoàn thành:** test T3.3 phần reader xanh; build không lỗi. CHƯA nối vào luồng ghi.
- **Test:** (ở T3.3).
- **Phụ thuộc:** T1.1, T2.1.

### T3.2 — Mở rộng `resolveUserByPlate` trả `{ userId, vehicleRegistrationId }`
- **File:** `src/modules/anpr/services/vehicle-resolve.service.ts` — **MODIFIED**.
- **Làm gì:** đổi query `SELECT user_id ...` → `SELECT id, user_id ...` (một query, QC-7), đổi return type sang `{ userId, vehicleRegistrationId } | null`. Cập nhật chỗ dùng trong `onVehicleEvent` (hiện chỉ lấy `userId`). **KHÔNG** đổi điều kiện `status='active' AND deleted_at IS NULL`.
- **Tiêu chí hoàn thành:** build không lỗi; test T3.3 xanh; hành vi `iot_device_events.payload.userId` giữ nguyên như cũ.
- **Test:** (ở T3.3).
- **Phụ thuộc:** không (độc lập T3.1, cùng file).

### T3.3 — Test readers + resolveUserByPlate
- **File:** `src/modules/anpr/services/vehicle-resolve.service.spec.ts` — **MODIFIED**.
- **Làm gì:** test reader: config trống/thiếu → `{}`; entry value sai (không-UUID / direction lạ) → bỏ entry; JSON hỏng → `{}` không throw. Test `resolveUserByPlate`: matched → `{userId, vehicleRegistrationId}`; không match → `null`.
- **Tiêu chí hoàn thành:** các case xanh; suite `anpr` **> 183**.
- **Phụ thuộc:** T3.1, T3.2.

### 🚦 GATE B3
- `npm run build` không lỗi. eslint file đã chạm sạch. `anpr` (>183) + `zones` (>178) xanh. Luồng ghi gate log CHƯA bật (chưa gọi `writeGateLog`) — `onVehicleEvent` hành vi runtime chưa đổi ngoài reader/return type.

---

## Nhóm B4 — Chạm production (RỦI RO CAO NHẤT — luồng đã nghiệm thu phần cứng)

> Bước **duy nhất** đổi hành vi runtime của luồng ANPR. Mỗi task ghi rõ **hành vi CŨ → MỚI**. Chia nhỏ nhất.

### T4.1 — Test AC-BACKCOMPAT (characterization — VIẾT TRƯỚC, là lưới an toàn)
- **File:** `src/modules/anpr/services/vehicle-resolve.service.spec.ts` — **MODIFIED**.
- **Làm gì:** test **đặc tả hành vi HIỆN TẠI** (characterization) — chỉ khẳng định những gì đúng ở **cả hai đầu** (trước và sau B4), với payload hợp lệ + `channel_zone_map` trống (hiện trạng hôm nay):
  - `onVehicleEvent` **không ném**.
  - `iot_device_events` **vẫn được INSERT** với **đúng các trường/giá trị như hiện nay**: `event_type='ivss_vehicle_event'`, `device_id` (IVSS-BRIDGE), `event_time`, và các khoá payload hiện có (`plateNumber`, `plateRaw`, `userId`, `channelId`, `direction`, `matchState`…).
  - Webhook ack 200 (nếu test ở tầng controller; ở tầng service thì bỏ qua vế này).
- **⚠ RÀNG BUỘC KỸ THUẬT (quyết định test sống hay chết):** **Khẳng định payload theo kiểu "CHỨA các khoá cũ với giá trị cũ" — dùng `toMatchObject` / kiểm từng khoá. TUYỆT ĐỐI KHÔNG so bằng toàn bộ object (`toEqual` trên cả payload).** Lý do: T4.2 sẽ **thêm** khoá `gateLogSkipped` vào payload; `toEqual` tuyệt đối ⇒ T4.2 làm đỏ chính lưới an toàn của nó ⇒ người code sẽ sửa lưới cho vừa code thay vì ngược lại (mất toàn bộ giá trị T4.1).
- **Tiêu chí hoàn thành:** test xanh **trên code HIỆN TẠI** (trước T4.2+), và vẫn xanh sau toàn bộ B4.
- **Phụ thuộc:** T3.3.
- **Ghi chú:** khẳng định *"không gọi `writeGateLog` khi `channel_zone_map` trống"* **KHÔNG** đặt ở đây (writeGateLog chưa được nối) — nằm ở **T4.3**.

### T4.2 — INSERT `iot_device_events` thêm `RETURNING id` + khoá skip biết-trước
- **File:** `src/modules/anpr/services/vehicle-resolve.service.ts` — **MODIFIED**.
- **CŨ:** INSERT `iot_device_events` KHÔNG `RETURNING`; payload không có `gateLogSkipped`.
- **MỚI:** thêm `RETURNING id` (QĐ-6) → `eventId`; tính trước `gateLogSkipped` ∈ {`zone_unmapped`,`direction_seen`,`plate_too_long`,`bad_utc`} và đưa vào `payload_json` khi INSERT. `accessTime = eventTime` từ `parseUtc`; `utcFallback===true` → `bad_utc`. Biển: hợp lệ ≤16 → giữ; rỗng → `NULL`; >16 → `plate_too_long`.
- **Tiêu chí hoàn thành:** test AC-BACKCOMPAT (T4.1) vẫn xanh; build không lỗi.
- **Phụ thuộc:** T4.1.

### T4.3 — Gọi `writeGateLog` + UPDATE `zone_not_gate`/`duplicate`
- **File:** `src/modules/anpr/services/vehicle-resolve.service.ts` — **MODIFIED**.
- **CŨ:** không ghi `gate_access_logs`.
- **MỚI:** nếu KHÔNG có `gateLogSkipped` biết-trước → gọi `zones.writeGateLog({zoneId, direction, accessTime, deviceId, eventId, userId, vehicleRegistrationId, plateNumber, metadata:{channelId, plateRaw}})` (**Tx #2** của zones). `written=false, skipReason='zone_not_gate'` → **UPDATE** `payload_json.gateLogSkipped='zone_not_gate'`; `='duplicate'` → **UPDATE** `='duplicate'`, không pairing. Đặt **guard điểm-quyết-định-ghi** ngay trước lời gọi (chỗ này để bổ sung cửa sổ thời gian sau rẻ — plan §5.1).
- **Tiêu chí hoàn thành:** test T4.5 (nhánh skip + zone_not_gate + duplicate + metadata) xanh; AC-BACKCOMPAT (T4.1) vẫn xanh; **thêm khẳng định `channel_zone_map` trống → KHÔNG gọi `writeGateLog`** (chuyển từ T4.1 xuống đây — giờ `writeGateLog` đã được nối nên khẳng định mới có nghĩa).
- **Phụ thuộc:** T4.2, T1.3.

### T4.4 — Gọi `pairForLeaveLog` tx riêng (QĐ-8)
- **File:** `src/modules/anpr/services/vehicle-resolve.service.ts` — **MODIFIED**.
- **CŨ:** không pairing.
- **MỚI:** nếu `written=true` và `direction='leave'` → gọi `pairForLeaveLog(logId)` **không truyền manager**, bọc `try/catch` NUỐT lỗi (**Tx #3**). `direction='enter'` → không pairing.
- **Tiêu chí hoàn thành:** test QĐ-8 (pairing ném lỗi → `onVehicleEvent` không ném, gate log vẫn còn) xanh.
- **Phụ thuộc:** T4.3.

### T4.5 — Test luồng ghi đầy đủ
- **File:** `src/modules/anpr/services/vehicle-resolve.service.spec.ts` — **MODIFIED**.
- **Làm gì:** mock `GateAccessLogService.writeGateLog` + `GateLogPairingService.pairForLeaveLog`. Phủ:
  - **6 giá trị `gateLogSkipped`:** `zone_unmapped`, `direction_seen`, `zone_not_gate` (UPDATE), `plate_too_long`, `bad_utc` (**2 case:** ISO hỏng + lệch > `SKEW_MS`; khẳng định KHÔNG `now()`), `duplicate` (UPDATE, không pairing).
  - **QĐ-6:** INSERT có `RETURNING id`, `eventId` truyền vào `writeGateLog`.
  - **QC-8:** `utc` hợp lệ → `accessTime` truyền vào `writeGateLog` **bằng** giá trị parse (KHÔNG phải thời điểm test chạy).
  - **QC-5:** `writeGateLog` nhận `metadata={channelId, plateRaw}`.
  - **A.5:** biển rỗng → `writeGateLog` nhận `plateNumber=NULL`, **vẫn ghi**.
  - **QC-1:** gọi 2 lần cùng payload → lần 2 `duplicate` → 1 dòng gate log, không pairing lần 2.
  - **QĐ-8:** `pairForLeaveLog` ném → không ném ra, `writeGateLog` đã gọi (gate log không rollback).
  - **`writeGateLog` ném lỗi THƯỜNG (không phải 23505 — vd mất kết nối/timeout/constraint khác) → `onVehicleEvent` KHÔNG ném; dòng `iot_device_events` vẫn còn; KHÔNG gọi pairing** (spec §8.1).
  - **enter không pairing** (FR-07).
- **Tiêu chí hoàn thành:** tất cả xanh; suite `anpr` **> 183**.
- **Phụ thuộc:** T4.4.

### T4.6 — Đối chiếu baseline
- **File:** không (chỉ chạy test).
- **Làm gì:** chạy suite `anpr` + `zones`, đối chiếu số với baseline.
- **Tiêu chí hoàn thành:** `anpr` **> 183** / `zones` **> 178**, KHÔNG suite/test nào đỏ hoặc biến mất. AC-BACKCOMPAT xanh.
- **Phụ thuộc:** T4.5.

### 🚦 GATE B4
- `npm run build` không lỗi.
- eslint **CHỈ** file đã chạm (`vehicle-resolve.service.ts` + spec) sạch (đối chiếu lint nền HEAD nếu có).
- `anpr` (>183) + `zones` (>178) xanh, số **không giảm**.
- **AC-BACKCOMPAT xanh** (T4.1).

---

## Nhóm B5 — Script vận hành (KHÔNG ảnh hưởng code/test)

### T5.1 — Bộ script `scripts/anpr-livetest/`
- **File:** `scripts/anpr-livetest/` — **NEW**: `01_seed_gate_zone.sql` (gợi ý, hoặc dùng API UC-90), `02_channel_zone_map.TEMPLATE.sql` (DELETE-then-INSERT, mirror template `03` của ivss-livetest), `03_curl_examples.sh` (route `/api/v1/internal/ivss/vehicle-events`, header `X-Internal-Token: $IVSS_BRIDGE_TOKEN`, payload `VehicleEventDto`), `04_check_gate_logs.sql` (query `LEFT JOIN gate_access_logs ON event_id` + bảng đọc kết quả, plan §9.1), `README.md`.
- **Tiêu chí hoàn thành:** file tồn tại, README nêu thứ tự chạy + cảnh báo đồng hồ camera. KHÔNG phải migration, KHÔNG chạy tự động.
- **Test:** không.
- **Phụ thuộc:** không (làm song song được, nhưng nội dung khớp code B4).

### 🚦 GATE B5
- Script đọc-only / template; không đụng code/test. Repo vẫn xanh như GATE B4.

---

## Việc VẬN HÀNH (KHÔNG phải code — làm sau khi merge, theo thứ tự)

0. **⚠ Boot app một lần ở local TRƯỚC KHI MERGE — xác nhận không lỗi khởi tạo module.** Lý do: cạnh DI mới `anpr → zones` không thể kiểm bằng unit test (đã thử `createTestingModule({imports:[AnprModule]}).compile()` → fail vì thiếu `TypeOrmModule.forRoot`/DB, KHÔNG phải circular — xem `anpr.module.spec.ts`). `tsc` cũng không bắt phụ thuộc vòng NestJS. Chỉ app boot mới chứng minh. Cách: `npm run start:dev` một lần, thấy log "Nest application successfully started" (không `UnknownDependenciesException`/circular) → tắt. (Chứng minh tĩnh: không module nào import `anpr` nên cạnh `anpr→zones` không thể tạo vòng — nhưng vẫn boot xác nhận.)
1. **Chạy migration `20260725000001`** — người phụ trách DB, trên môi trường đã thống nhất (KHÔNG tự chạy lên RDS chung nếu chưa được duyệt). Kiểm index `UQ_gate_logs_content` tồn tại.
2. **Tạo zone `type='gate'`** qua API UC-90. Kiểm `zone_type='gate'`, `status='active'`, chưa xoá mềm.
3. **Seed `ivss.channel_zone_map`** trỏ `channelId` cổng → `id` zone gate (`02_channel_zone_map.TEMPLATE.sql`).
4. (Khuyến nghị) **Seed `ivss.channel_direction_map`** cho channel vào/ra.
5. **⚠ Kiểm đồng bộ đồng hồ camera/IVSS** — lệch > 1h ⇒ mọi sự kiện `bad_utc`, không dòng gate log nào (plan §9-4).
6. **Chạy `scripts/anpr-livetest/`** verify: 2 `curl` vào/ra → query `04` kỳ vọng 2 dòng gate log ghép cặp, `duration_seconds` > 0.
7. **⚠ Đếm số `iot_device_events` sinh ra khi MỘT xe qua MỘT lần** (plan §5.1 / A.2): `=1` → B′ đủ; `>1` → camera bắn multi-frame ⇒ cần bổ sung cửa sổ thời gian tại guard đã bố trí (T4.3), KHÔNG đập kiến trúc.

---

## Ngoài phạm vi (KHÔNG làm)
- Logic UC-103/UC-108 (chỉ đọc bảng, không chèn hook — QĐ-9).
- Thuật toán ghép cặp UC-106 (chỉ gọi `pairForLeaveLog`).
- 2 method đọc UC-107 của `GateAccessLogService`.
- Sửa `vehicle_registrations.plate_number` (spec §8.3).
- Refactor `parseUtc`/`resolveBridgeDeviceId`/`normalizePlate`.
- Lệnh `git` (commit/push do người thực hiện quyết định).
