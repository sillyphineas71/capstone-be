# UC-105 — Ghi nhận ra/vào khuôn viên (Gate Access Writer · `GAW-001`)

> FT-20 · scope SCMPTS · module chính: `anpr` (điểm chèn) + `zones` (bảng đích).
> Loại tài liệu: **SPEC** (chưa phải plan/tasks). Chỉ mô tả *cái gì* + *ràng buộc*, KHÔNG mô tả *code thế nào*.

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt thay đổi | Vị trí |
| :--- | :--- | :--- |
| 2026-07-24 | Tạo mới spec UC-105 (GAW-001): writer sinh `gate_access_logs` từ sự kiện biển số tại zone `gate`. 10 quyết định nền đã chốt (QĐ-1→10), 7 OPEN QUESTIONS. | Toàn file |
| 2026-07-24 | Review duyệt có điều kiện: loại chống-trùng A→B′ (khoá bất biến từ dữ liệu thiết bị, `access_time` từ `evt.utc`); gỡ mâu thuẫn `zone_not_gate` (UPDATE bổ sung); đổi dải migration → `20260725000001`; sửa route webhook `/api/v1/internal/ivss/vehicle-events`; thêm nhánh `bad_utc`; §10 OPEN QUESTIONS → 8 QUYẾT ĐỊNH ĐÃ CHỐT (QC-1→8). | CHANGELOG, §3, FR-04/08/09, §5, §6, §7, §8.1/8.3/8.4/8.6, §9, §10 |

---

## 1. Bối cảnh & mục tiêu

Hệ thống đã có luồng ANPR nghiệm thu phần cứng: camera IPC/IVSS đọc biển → bridge → webhook `POST /internal/ivss/vehicle-events` → `VehicleResolveService.onVehicleEvent()` → ghi thô vào `iot_device_events` (event_type `ivss_vehicle_event`). Đến nay **chưa có** bản ghi nghiệp vụ nào trong `gate_access_logs`.

**UC-105** bổ sung đúng một việc: từ mỗi sự kiện biển số xảy ra tại một **zone loại `gate`**, xác định **chiều ra/vào** (`enter`/`leave`) và sinh **một dòng `gate_access_logs`**. Đây là *nguồn ghi duy nhất* của bảng này; các UC sau (UC-106 ghép cặp, UC-107 tra cứu, UC-103/UC-108 kiểm soát) chỉ **đọc** bảng.

Ranh giới bản chất của UC-105: đây là **điểm nối thiết bị ↔ phần mềm**. Vì thế nó vừa nhạy cảm (chèn vào service đã nghiệm thu phần cứng) vừa **verify được thật** bằng `curl` (§9), không cần mock như các UC cron.

### 1.1. UC-105 khác 13 UC trước ở điểm nào (đọc trước khi làm)
| | 13 UC trước | UC-105 |
| :--- | :--- | :--- |
| Kích hoạt | HTTP người dùng / cron | **webhook thiết bị** (always-ack 200) |
| Vị trí code | tự đứng trong module | **chèn giữa service production đã nghiệm thu** |
| Bảng đích | bảng của chính module | **bảng của module khác (`zones`)** |
| Verify | mock | **`curl` vào webhook thật** |

---

## 2. Quyết định nền đã chốt (KHÔNG mở lại — chỉ tham chiếu)

Các quyết định dưới đây do RECON (13/13 giả thuyết khớp) + người duyệt chốt. Spec tuân theo, **không bàn lại**.

| # | Nội dung (rút gọn) |
| :--- | :--- |
| **QĐ-1** | `zones` phơi method ghi; `anpr` import `ZonesModule` và **GỌI** method. **CẤM** `anpr` bắn raw SQL vào `gate_access_logs`. Bảng có **một chủ duy nhất**. |
| **QĐ-2** | `zone_id` lấy từ config `ivss.channel_zone_map` (`config_group='ivss'`), reader mirror `getChannelRoomMap`. **Chưa map channel → KHÔNG ghi gate log** (vẫn ghi `iot_device_events`). |
| **QĐ-3** | Thứ tự quyết định `direction`: `ivss.channel_direction_map` **TRƯỚC** → `eventAction` fallback → `seen` cuối. |
| **QĐ-4** | `direction = 'seen'` → **KHÔNG ghi** gate log. |
| **QĐ-5** | Xe không đăng ký (`user_id = NULL`) → **VẪN ghi** gate log (có `plate_number`). |
| **QĐ-6** | Điền `event_id`: thêm `RETURNING id` vào INSERT `iot_device_events`. Là sửa dòng production ⇒ bắt buộc có test. |
| **QĐ-7** | `vehicle_registration_id`: mở rộng `resolveUserByPlate` → `SELECT id, user_id` cùng một query, đổi kiểu trả về. |
| **QĐ-8** ⭐ | **Ghi gate log + COMMIT TRƯỚC. Gọi `pairForLeaveLog` SAU, transaction RIÊNG (không truyền `manager`), bọc `try/catch` NUỐT lỗi.** Chỉ gọi khi `direction='leave'`. |
| **QĐ-9** | `onVehicleEvent` có **HAI điểm chèn cố định**: (1) cảnh báo control-list (UC-108/`VehicleControlAlertService.evaluate`) **TRƯỚC** khi ghi, và (2) writer gate log (UC-105) **SAU** INSERT raw event. **Thứ tự này là hợp đồng.** Mọi UC sau phải là **consumer đọc bảng**, KHÔNG thêm điểm chèn thứ ba. *(Lý do: `VehicleControlAlertService` do thành viên khác thêm vào TRƯỚC UC-105 — quyết định giữ nguyên, không gỡ, không đổi vị trí lời gọi.)* |
| **QĐ-10** | Khi **skip** không ghi gate log, ghi **lý do** vào `iot_device_events.payload_json` (khoá `gateLogSkipped`, giá trị phân biệt từng nguyên nhân). |

---

## 3. Dữ kiện RECON đã xác minh (dùng lại, không dò lại)

- Điểm móc: [`VehicleResolveService.onVehicleEvent()`](../../../../src/modules/anpr/services/vehicle-resolve.service.ts) — `vehicle-resolve.service.ts:43`. Đã có: `resolveUserByPlate` (`:109`, hiện chỉ trả `user_id`), `normalizeVehicleDirection` (`:122`, trả 3 giá trị `enter|leave|seen`), `parseUtc` (`:132`), INSERT `iot_device_events` (`:77-82`, **không** `RETURNING`). Service hiện **không** có logic zone.
- Bảng `gate_access_logs` (migration `20260721000004`): NOT NULL không DEFAULT = **`zone_id`, `direction`, `access_time`**. `direction varchar(10)` **không CHECK constraint**. `plate_number varchar(16)` nullable. `event_id`/`user_id`/`vehicle_registration_id`/`device_id` FK nullable `ON DELETE SET NULL`. `zone_id` FK `ON DELETE RESTRICT`. **KHÔNG có `deleted_at`** (append-only). Index: `IDX_gate_logs_user_time`, `IDX_gate_logs_zone_time`, `IDX_gate_logs_plate`, `IDX_gate_logs_unpaired (user_id, direction) WHERE paired_log_id IS NULL`, `UQ_gate_logs_paired` (migration `...0008`).
- [`GateLogPairingService`](../../../../src/modules/zones/services/gate-log-pairing.service.ts) **có** trong `exports` của `zones.module.ts:59`. `pairForLeaveLog(leaveId, manager?)` trả `'paired'|'skipped'`; nhánh **có** `manager` **ném thẳng** lỗi cho caller (nền tảng của QĐ-8); nhánh không manager tự mở tx, nuốt `23505`.
- `zones.module.ts` import `Auth`+`Iot`, **không** import `anpr` ⇒ cạnh `anpr → zones` một chiều, không vòng (RECON §A). `GateLogPairingService` **không** import gì từ `anpr`.
- Khuôn config: [`getChannelRoomMap`/`getChannelDirectionMap`](../../../../src/modules/ivss/services/ivss-presence-ingestion.service.ts) (`ivss-presence-ingestion.service.ts:288`/`:305`) — `SELECT config_json FROM system_configs WHERE config_key=... AND is_active=true LIMIT 1`, validate từng entry, **không cache**, đọc lỗi → trả rỗng, **không throw**.
- `system_configs.config_key` **KHÔNG unique** ⇒ seed DELETE-then-INSERT (`scripts/ivss-livetest/03_channel_direction_map.TEMPLATE.sql`).
- `GATE_DIRECTIONS = ['enter','leave']` (`gate-direction.constant.ts:14`), **không** có `seen`.
- Webhook `POST /internal/ivss/vehicle-events` **luôn ack 200** (ARCH-01), guard `AnprInternalTokenGuard`; body = `VehicleEventDto`. Bridge `NestForwarder` hiện fire-and-forget (**không** dựa được vào điều này — §8.4).
- `normalizePlate()` = `trim().toUpperCase().replace(/[^A-Z0-9]/g,'')` — **không cap độ dài** (rủi ro §8.3).
- Migration mới nhất `20260722000010`; **dải số của nhánh này bắt đầu từ `20260725000001`** (một thành viên khác đã dùng `20260722000006/0007/0008` trên RDS trùng số với repo — tránh chồng lấn). **Chưa có** zone `type='gate'` seed, **chưa có** `channel_zone_map`.

---

## 4. Yêu cầu chức năng (FR)

- **FR-01** — Với mỗi sự kiện vehicle nhận tại `onVehicleEvent`, hệ thống resolve `zone_id` từ `evt.channelId` qua config `ivss.channel_zone_map`. Không có ánh xạ → **không ghi** gate log (QĐ-2), ghi lý do skip (FR-08).
- **FR-02** — Xác định `direction` theo thứ tự QĐ-3: `channel_direction_map[channelId]` nếu có và hợp lệ (`enter`/`leave`) → dùng; ngược lại `normalizeVehicleDirection(evt.eventAction)`; kết quả cuối cùng có thể là `seen`.
- **FR-03** — `direction = 'seen'` → **không ghi** gate log (QĐ-4), ghi lý do skip (FR-08).
- **FR-04** — Khi `zone_id` hợp lệ và `direction ∈ {enter, leave}`: ghi **một** dòng `gate_access_logs` với các trường: `zone_id`, `direction`, `access_time` (**= `evt.utc` đã parse — TUYỆT ĐỐI KHÔNG `now()`**, xem §8.4), `device_id` (IVSS-BRIDGE), `event_id` (id của dòng `iot_device_events` vừa ghi — QĐ-6), `user_id` (có thể NULL — QĐ-5), `vehicle_registration_id` (có thể NULL — QĐ-7), `plate_number` (đã chuẩn hoá, xử theo §8.3), `metadata_json` (`{ channelId, plateRaw }` — QC-5).
- **FR-05** — Việc ghi gate log thực hiện qua **method của `zones`** (QĐ-1); `anpr` chỉ chuẩn bị dữ liệu và gọi. `anpr` **không** chạm SQL của `gate_access_logs`.
- **FR-06** — Sau khi ghi gate log đã **COMMIT** và `direction='leave'`, gọi `pairForLeaveLog(newLogId)` **không truyền manager**, bọc `try/catch` nuốt lỗi (QĐ-8). Kết quả ghép cặp (`'paired'`/`'skipped'`) không ảnh hưởng trạng thái ghi.
- **FR-07** — `direction='enter'` **không** kích hoạt ghép cặp (bản `enter` sẽ được ghép khi `leave` tương ứng tới, hoặc bởi cron `pairBatch`).
- **FR-08** — Mọi trường hợp skip phải ghi khoá `gateLogSkipped` vào `iot_device_events.payload_json` với giá trị **phân biệt được nguyên nhân** — QĐ-10. **Tập giá trị đầy đủ (5 giá trị):** `zone_unmapped` · `direction_seen` · `zone_not_gate` · `plate_too_long` · `bad_utc`. Bốn giá trị `zone_unmapped`/`direction_seen`/`plate_too_long`/`bad_utc` biết **trước** bước INSERT `iot_device_events` nên đưa thẳng vào `payload_json` khi ghi (một lần); riêng `zone_not_gate` chỉ biết **sau** khi gọi method `zones` nên ghi bằng UPDATE bổ sung (QC-7, §8.6). Query kiểu `04_check_events.sql` đọc ra được ngay.
- **FR-09** — Chống trùng sự kiện: partial unique index B′ đã chốt (QC-1, §8.4).

---

## 5. Hợp đồng method bên `zones` (§5.1)

**Đề xuất: mở rộng `GateAccessLogService`** (đã có từ UC-107) bằng một method ghi, thay vì tạo `GateAccessWriterService` mới.

*Lý do đề xuất:*
- `GateAccessLogService` đã là **chủ** của `gate_access_logs` (hiện chỉ có read); thêm write vào cùng service giữ nguyên tắc "một bảng một chủ" (QĐ-1) rõ ràng nhất, không phân mảnh.
- Service đã inject `Repository<GateAccessLogEntity>` — writer dùng lại repo/entity, không cần wiring provider mới.
- Tên `GateAccessLogService` trung tính (không phải `...ReadService`), chứa cả đọc lẫn ghi là hợp lý.

*Phản đề (đã cân, bị loại):* service mới `GateAccessWriterService` tách đọc/ghi theo CQRS-lite, dễ test cô lập, nhưng thêm một provider + trùng inject repo. **Người duyệt chốt: mở rộng `GateAccessLogService` (QC-3).**

**Hợp đồng method (mức spec, không phải chữ ký cuối):**
- **Input**: một đối tượng đã-resolve (không phải raw `VehicleEvent`) gồm: `zoneId`, `direction` (`'enter'|'leave'` — đã loại `seen` ở phía gọi), `accessTime`, `deviceId?`, `eventId?`, `userId?`, `vehicleRegistrationId?`, `plateNumber?`, `metadata?`. Việc loại `seen` và resolve zone/direction là **trách nhiệm phía `anpr`**; method `zones` nhận dữ liệu đã sạch.
- **Validate bên trong method (§5.2)**: method **tự kiểm** `zone` tồn tại, **`zone.type = 'gate'`**, và `zone.deleted_at IS NULL`. Không đạt → **không insert**, trả tín hiệu để phía gọi ghi `gateLogSkipped` (giá trị ví dụ `zone_not_gate`). Lý do đặt kiểm ở đây: `zones` là chủ bảng + chủ khái niệm "gate", không nên tin channel-map do người khác seed.
- **Return**: `{ written: boolean; logId?: string; skipReason?: string }` (hình thức cuối chốt ở plan). `logId` cần cho FR-06 (pairing).
- **Transaction**: method tự đóng gói INSERT trong một tx **của riêng nó và COMMIT** trước khi trả về (nền QĐ-8). **Không** gọi pairing bên trong (pairing là việc của phía gọi, tx riêng).

---

## 6. Ai kiểm `zone.type = 'gate'` (§5.2)

**Bên ghi (`zones`)** chịu trách nhiệm kiểm (đã nêu §5, chốt QC-4). Nếu `channel_zone_map` trỏ nhầm vào zone `type='room'`:
- Method `zones` phát hiện `type != 'gate'` → **không ghi**, trả `skipReason='zone_not_gate'`.
- ⚠ `zone_not_gate` **chỉ biết được SAU khi gọi method `zones`** (tức sau bước INSERT `iot_device_events`) ⇒ phía `anpr` ghi `gateLogSkipped='zone_not_gate'` vào `payload_json` bằng **UPDATE bổ sung** (QC-7, §8.6), không phải ghi kèm lúc INSERT như bốn nguyên nhân còn lại. Nhờ đó người vận hành vẫn thấy được cấu hình sai khi soi `iot_device_events`.
- **Không** ném lỗi (webhook always-ack), **không** tự "đoán lại" zone khác.

---

## 7. Thứ tự thao tác trong `onVehicleEvent` (§5.5) + ranh giới transaction

Đánh số rõ (mức spec — plan sẽ chi tiết hoá):

1. Resolve `deviceId` (IVSS-BRIDGE) — như hiện tại. Không có → skip toàn bộ (giữ nguyên hành vi cũ).
2. Resolve `userId` **và** `vehicleRegistrationId` từ biển (QĐ-7, một query).
3. Resolve `direction` (QĐ-3): `channel_direction_map` trước → `eventAction` → `seen`.
4. Resolve `zoneId` từ `channel_zone_map` (QĐ-2).
5. Parse `evt.utc` → `accessTime`; kiểm độ dài `plateNumber`. Xây `payload_json` (như hiện tại) + tính trước **`gateLogSkipped`** cho các nguyên nhân biết-trước: `direction_seen` (bước 3), `zone_unmapped` (bước 4), `plate_too_long` (kiểm ở bước này), `bad_utc` (parse hỏng ở bước này).
6. **INSERT `iot_device_events` … `RETURNING id`** (QĐ-6) → có `eventId`, kèm `gateLogSkipped` biết-trước (nếu có). *(Tx #1 — riêng cho dòng thô; đây là ghi luôn-luôn-xảy-ra, giữ đúng tinh thần "raw event luôn được lưu".)*
7. Quyết định ghi gate log:
   - Nếu đã xác định skip biết-trước (`direction='seen'`, `zoneId` không map, `plate_too_long`, `bad_utc`) → **không** gọi method `zones`. `gateLogSkipped` đã nằm trong dòng ở bước 6. Kết thúc.
   - Ngược lại: gọi method `zones` (§5) để ghi `gate_access_logs`. *(Tx #2 — của method `zones`, COMMIT trước khi trả.)* Nếu method trả `written=false` với `skipReason='zone_not_gate'` → **UPDATE bổ sung** `payload_json.gateLogSkipped='zone_not_gate'` vào dòng ở bước 6 (QC-7, §8.6).
8. Nếu `written=true` **và** `direction='leave'`: gọi `pairForLeaveLog(logId)` **không manager**, `try/catch` nuốt lỗi (QĐ-8). *(Tx #3 — do chính `pairForLeaveLog` tự mở.)*
9. Trả về (webhook đã ack 200 từ trước).

**Ranh giới tx:** ba transaction **tách rời** (raw event / gate log / pairing). Không có tx nào bao trùm bước khác. Đây là điểm cốt lõi của QĐ-8: gate log không bị pairing kéo rollback.

---

## 8. Xử lý lỗi, tương thích ngược & rủi ro

### 8.1. Xử lý lỗi từng bước (§5.6) — không trạng thái "không xác định"
| Bước hỏng | Trạng thái hệ thống | Hành vi |
| :--- | :--- | :--- |
| Resolve device/user/zone/direction (đọc) hỏng | Chưa ghi gì | Nuốt lỗi, log warn, webhook vẫn ack 200. Không gate log. |
| `evt.utc` méo / rỗng / sai định dạng (parse `access_time` thất bại) | Có raw event, **không** gate log | `gateLogSkipped='bad_utc'` (biết trước bước 6 → ghi kèm INSERT). **CẤM fallback `now()`** — vừa sai `access_time` vừa vô hiệu hoá lớp chống trùng B′ (§8.4/QC-1). |
| INSERT `iot_device_events` hỏng | Không có raw event | Nuốt lỗi (như hiện tại), ack 200. Không gate log (không có `eventId`). |
| Ghi `gate_access_logs` hỏng | **Có** raw event, **không** gate log | Nuốt lỗi, log error kèm plate/channel. Raw event còn nguyên để truy vết + tái dựng thủ công. **Không** ném. |
| `pairForLeaveLog` hỏng | **Có** gate log (đã COMMIT), **chưa** ghép cặp | Nuốt lỗi (QĐ-8). Cron `pairBatch` 5 phút sẽ ghép sau. Không mất dữ liệu. |

Nguyên tắc: **raw event và gate log là hai lần ghi độc lập**; mất bước sau không xoá bước trước. Toàn bộ `onVehicleEvent` **không bao giờ ném** (webhook always-ack).

### 8.2. Tương thích ngược — **Acceptance Criterion riêng** (§5.7)
> **AC-BACKCOMPAT**: Khi `ivss.channel_zone_map` **trống** (hiện trạng hôm nay), hành vi của `VehicleResolveService` **giống hệt** trước khi có UC-105, **ngoại trừ**: (a) mỗi dòng `iot_device_events` nay có thêm khoá `gateLogSkipped` trong `payload_json` (QĐ-10) và (b) dòng đó nay được INSERT kèm `RETURNING id` (QĐ-6, không đổi nội dung ghi). **Không** dòng `gate_access_logs` nào được tạo; **không** có exception; webhook vẫn ack 200; luồng ANPR đã nghiệm thu phần cứng **không đổi kết quả**.

Đây là tiêu chí **bắt buộc kiểm** (test + verify curl khi map trống), không phải ghi chú.

### 8.3. `plate_number` vượt `varchar(16)` 🔴 (§5.3)
`normalizePlate()` không cap độ dài ⇒ biển nước ngoài / đọc lỗi có thể > 16 ký tự ⇒ INSERT `gate_access_logs.plate_number` (varchar 16) **lỗi 500 lúc chạy thật**.

- **Phạm vi UC-105**: chỉ xử ở đường ghi gate log. **KHÔNG** sửa lan sang `vehicle_registrations.plate_number` (cùng rủi ro có sẵn từ trước, ngoài scope).
- **Ghi rõ**: đây là **rủi ro có sẵn từ trước**, UC-105 chỉ phải đảm bảo đường ghi của mình không vỡ.
- **Phương án — chốt QC-2: (b) bỏ ghi gate log + `gateLogSkipped='plate_too_long'`.** (a) truncate 16 ký tự tạo biển sai lệch có thể khớp nhầm biển khác khi đối chiếu control-list; (c) ghi `plate_number = NULL` làm mất khả năng tra cứu theo biển cho chính lượt đó **và** vô hiệu hoá lớp chống trùng B′ (điều kiện `WHERE plate_number IS NOT NULL`). Vì vậy chọn (b).

### 8.4. Chống trùng sự kiện ⭐ CRUX (§5.4)
**CẤM** thiết kế dựa trên giả định "bridge không retry" — bridge ở source riêng, có thể đổi bất cứ lúc nào. Thiết kế phải chịu được **cả hai** trường hợp (retry và không). Trùng ở `gate_access_logs` ⇒ ghép cặp sai ⇒ `duration_seconds` sai ⇒ UC-107 hiển thị số bịa mà không ai biết.

**Nguyên tắc chốt:** khoá bất biến chống trùng phải lấy từ **dữ liệu THIẾT BỊ gửi**, KHÔNG lấy từ id do DB sinh. Thứ giữ nguyên qua mọi lần bridge retry là `channelId` + `plateNumber` + `utc` (dấu thời gian thiết bị đóng), **không** phải `iot_device_events.id`.

| Phương án | Lợi | Hại | Migration schema? |
| :--- | :--- | :--- | :--- |
| **A. Unique trên `event_id`** ❌ **ĐÃ LOẠI** | (tưởng) 1 raw event ↔ 1 gate log | **Không giải được mối đe doạ thật**: bridge retry ⇒ webhook được gọi lại ⇒ INSERT `iot_device_events` sinh dòng mới id=Y≠X (bảng này KHÔNG có dedup — RECON xác nhận) ⇒ hai gate log mang `event_id` khác nhau ⇒ unique trên `event_id` không phát hiện gì. A chỉ chặn "cùng raw event xử 2 lần" — tình huống **không bao giờ xảy ra** trong luồng webhook. | (Có, nhưng vô dụng) |
| **B′. Partial unique nội dung (CHỐT)** `(zone_id, plate_number, direction, access_time) WHERE plate_number IS NOT NULL` | Retry → cả 4 trường giống hệt (vì `access_time` suy từ `evt.utc`, không phải `now()`) → conflict → bỏ qua. Hai lượt xe thật khác nhau → `utc` khác → không chặn nhầm. | `plate_number IS NULL` không được bảo vệ — **chấp nhận có chủ ý** (dòng đó dù sao không ghép cặp được: QĐ-5 + UC-106 lọc `userId NOT NULL`). | **Có** — `20260725000001` |
| **C. Cửa sổ thời gian** (bỏ nếu cùng `plate+channel+direction` trong N giây) | Không cần schema | Cần đọc-trước (thêm query); chọn N sai → chặn nhầm hoặc lọt; không nguyên tử | Không |
| **D. Không làm gì** | Đơn giản nhất | Trùng lọt hoàn toàn khi bridge retry | Không |

**Chốt QC-1: B′** — partial unique `(zone_id, plate_number, direction, access_time) WHERE plate_number IS NOT NULL`, migration schema thật **`20260725000001`**. `23505` (conflict) → bỏ qua lặng, không ném (webhook always-ack).

> **⚠ RÀNG BUỘC SỐNG-CÒN: `access_time` PHẢI suy ra từ `evt.utc` (dấu thời gian thiết bị). TUYỆT ĐỐI KHÔNG dùng `now()` / `CURRENT_TIMESTAMP` / thời điểm nhận request.** Nếu ai đó đổi sang `now()`, toàn bộ lớp chống trùng B′ **chết âm thầm** — không lỗi, không cảnh báo, chỉ là dữ liệu sai (mỗi retry thành một dòng mới). Ràng buộc này lặp lại ở `plan.md`.

### 8.5. Rủi ro vận hành khác
- **Hai tiền điều kiện vận hành** (§residual 11): thiếu zone `gate` hoặc thiếu `channel_zone_map` → writer skip im lặng. `gateLogSkipped` (QĐ-10) là cứu cánh để chẩn đoán.
- **`iot_device_events` không dedup** (nợ sẵn) — B′ (QC-1) chỉ chống trùng ở `gate_access_logs`; raw event vẫn có thể trùng khi bridge retry (chấp nhận: raw log append-only, không ảnh hưởng ghép cặp/duration). UC-105 **không** mở rộng dedup sang `iot_device_events`.

### 8.6. Ghi `gateLogSkipped` — hai đường tách bạch (QC-7)
`gateLogSkipped` có hai loại nguyên nhân, biết ở hai thời điểm khác nhau:

- **Biết TRƯỚC INSERT (một lần ghi):** `zone_unmapped`, `direction_seen`, `plate_too_long`, `bad_utc`. Mọi dữ kiện (zone map, direction, độ dài biển, parse utc) đã có từ bước 3-5 ⇒ đưa thẳng vào `payload_json` khi INSERT `iot_device_events` (bước 6). KHÔNG cần UPDATE.
- **Biết SAU khi gọi method `zones`:** `zone_not_gate`. Method `zones` mới là bên kiểm `zone.type='gate'` (QC-4) — chỉ trả kết quả **sau** bước 6 ⇒ ghi bằng **UPDATE bổ sung** `payload_json` (phương án b). 

> Bản spec cũ đề xuất "ưu tiên (i): tính trước bước 6" cho **mọi** nguyên nhân — **SAI** với `zone_not_gate`, vì nguyên nhân này không thể biết trước khi gọi `zones`. QC-7 chốt dùng UPDATE bổ sung riêng cho nó. Đây là **nhánh cấu hình sai** (channel-map trỏ nhầm zone `room`), hiếm và tạm thời, không phải đường nóng ⇒ chi phí một UPDATE thêm chấp nhận được, đổi lại giữ ranh giới trách nhiệm QC-4 (`zones` là bên kiểm gate).

---

## 9. Kịch bản verify KHÔNG cần phần cứng (§5.8) ⭐

UC-105 verify được thật vì webhook chính là ranh giới thiết bị/phần mềm. Bộ script thuộc phạm vi **vận hành**, đặt ở **`scripts/anpr-livetest/`**, **KHÔNG** phải migration.

**(1) Dữ liệu nền cần seed:**
- 1 zone `type='gate'` (tạo qua API UC-90).
- `system_configs['ivss.channel_zone_map']` = `{"<CHANNEL>": "<gate_zone_id>"}` (DELETE-then-INSERT, mirror template `03`).
- `system_configs['ivss.channel_direction_map']` — tối thiểu để `<CHANNEL>` ra `enter`/`leave` (hoặc test 2 channel vào/ra).
- 1 `vehicle_registration` `status='active'` (biển hợp lệ, có `user_id`).
- 1 biển **không** đăng ký (để test QĐ-5).
- device `IVSS-BRIDGE` đã seed (đã có sẵn trong luồng hiện tại).

**(2) `curl` mẫu (payload = `VehicleEventDto`):**

Lượt **vào** (biển đã đăng ký):
```bash
curl -s -X POST http://localhost:3000/api/v1/internal/ivss/vehicle-events \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $IVSS_BRIDGE_TOKEN" \
  -d '{"plateNumber":"51F-12345","channelId":<CHANNEL_IN>,"utc":"<ISO_NOW>","eventAction":"enter"}'
```
Lượt **ra** (cùng biển, ~vài giây sau):
```bash
curl -s -X POST http://localhost:3000/api/v1/internal/ivss/vehicle-events \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $IVSS_BRIDGE_TOKEN" \
  -d '{"plateNumber":"51F-12345","channelId":<CHANNEL_OUT>,"utc":"<ISO_LATER>","eventAction":"leave"}'
```
> Route thật: `@Controller()` rỗng + `@Post('internal/ivss/vehicle-events')` + global prefix `api/v1` ([vehicle-webhook.controller.ts:37](../../../../src/modules/anpr/controllers/vehicle-webhook.controller.ts#L37), [main.ts:11](../../../../src/main.ts#L11)) ⇒ `/api/v1/internal/ivss/vehicle-events` — KHÔNG có đoạn `anpr`. Guard đọc env `IVSS_BRIDGE_TOKEN`, header `X-Internal-Token` ([anpr-internal-token.guard.ts:26](../../../../src/modules/anpr/guards/anpr-internal-token.guard.ts#L26)).

**(3) Query kiểm chứng (mirror `04_check_events.sql`, đọc-only, đặt ở `scripts/anpr-livetest/`):**
- `SELECT ... FROM gate_access_logs ORDER BY access_time DESC LIMIT 10;` — kỳ vọng 2 dòng (`enter`, `leave`).
- `SELECT payload_json->>'gateLogSkipped' ... FROM iot_device_events WHERE event_type='ivss_vehicle_event' ...;` — kỳ vọng NULL (không skip) cho 2 sự kiện trên.

**(4) Kỳ vọng:** 2 dòng `gate_access_logs`; dòng `leave` có `paired_log_id` trỏ dòng `enter` và `duration_seconds` > 0 (ghép cặp bởi FR-06); dòng `enter` được cập nhật `paired_log_id`/`duration_seconds` tương ứng. Biển **không** đăng ký → vẫn có dòng gate log nhưng `user_id=NULL`, không ghép cặp.

---

## 10. QUYẾT ĐỊNH ĐÃ CHỐT (QC)

Người duyệt đã chốt 8 quyết định dưới (bổ sung cho 10 QĐ nền ở §2). **KHÔNG mở lại.**

| # | Vấn đề | Quyết định | Lý do |
| :--- | :--- | :--- | :--- |
| **QC-1** ⭐ | Chống trùng | **B′**: partial unique `(zone_id, plate_number, direction, access_time) WHERE plate_number IS NOT NULL`. Migration `20260725000001`. `access_time` từ `evt.utc`, KHÔNG `now()`. | Khoá bất biến lấy từ dữ liệu thiết bị, không từ id DB sinh. **A (unique `event_id`) đã bị loại** — bridge retry sinh raw event id mới ⇒ A không phát hiện trùng (§8.4). |
| **QC-2** | `plate_number` > 16 ký tự | **Bỏ ghi gate log + `gateLogSkipped='plate_too_long'`** | Truncate tạo biển sai lệch, khớp nhầm biển khác lúc đối chiếu control-list. NULL làm mất tra cứu theo biển **và** vô hiệu hoá QC-1 cho dòng đó. |
| **QC-3** | Method ghi đặt ở đâu | **Mở rộng `GateAccessLogService`** (không tạo service mới) | Giữ nguyên tắc "một bảng một chủ" rõ nhất; đã inject sẵn repo; không thêm provider. |
| **QC-4** | Ai kiểm `zone.type='gate'` | **Bên ghi (`zones`)** | `zones` là chủ bảng và chủ khái niệm "gate"; không tin channel-map do người khác seed. |
| **QC-5** | `metadata_json` chứa gì | **`{ channelId, plateRaw }`** — bỏ khoá nào không có giá trị; cả hai đều thiếu thì để NULL | `event_id` **nullable** ⇒ không chắc link ngược raw event. Giữ `channelId` để biết camera vật lý nào bắn (vàng lúc nghiệm thu phần cứng). Không nhân bản toàn bộ payload. |
| **QC-6** | Permission | **`AnprInternalTokenGuard` là đủ**, không thêm permission mới | Writer là đường system-to-system, không phải endpoint người dùng. |
| **QC-7** | `zone_not_gate` ghi lý do lúc nào | **UPDATE bổ sung** (phương án b, §8.6) | Nhánh cấu hình sai, hiếm và tạm; không đáng đánh đổi ranh giới trách nhiệm ở QC-4. |
| **QC-8** | `parseUtc` hỏng | **Skip gate log + `gateLogSkipped='bad_utc'`.** CẤM fallback `now()` | `now()` vừa sai `access_time` vừa vô hiệu hoá lớp chống trùng B′ (§8.1/§8.4). |

**Kiểm luật §0:** không phát hiện mâu thuẫn giữa UC-105 và `CLAUDE.md`/`constitution.md`. QĐ-1/QC-3/QC-4 (một chủ bảng, không raw SQL chéo) **củng cố** module boundary của `CLAUDE.md`; QĐ-6 (sửa dòng production) hợp lệ vì có test bắt buộc (§ chiến lược test ở `plan.md`).

---

## 11. Residual / tiền điều kiện vận hành (bắt buộc — §5.9)

Sau khi code xong, **UC-105 vẫn chưa ghi được dòng `gate_access_logs` nào** cho tới khi hoàn tất **hai bước vận hành**:

- **(a)** Tạo ít nhất một zone `type='gate'` qua API UC-90.
- **(b)** Seed `system_configs['ivss.channel_zone_map']` trỏ `channelId` của camera cổng → `id` của zone gate đó (DELETE-then-INSERT).

Thiếu **một** trong hai → writer **skip im lặng** (chỉ ghi `gateLogSkipped` trong raw event). **Đây là nguyên nhân số một** của tình huống "chạy mà không thấy log" lúc demo. Người vận hành kiểm bằng query `gateLogSkipped` ở bước verify (§9-3).

---

## 12. Ranh giới với UC-103 / UC-108 (người khác làm — §5.10, QĐ-9)

UC-105 **chỉ ghi** `gate_access_logs`. UC-103 (kiểm control-list) và UC-108 (cảnh báo xe không quyền) là **consumer ĐỌC** bảng này, **KHÔNG** chèn thêm hook vào `onVehicleEvent`. `VehicleResolveService` được sửa **đúng một lần** bởi UC-105.

**Hợp đồng dữ liệu UC-108 có thể dựa vào** (với dòng do UC-105 ghi):
| Cột | Đảm bảo |
| :--- | :--- |
| `id`, `zone_id`, `direction`, `access_time`, `created_at` | **Luôn có** (NOT NULL / có default). `direction ∈ {enter, leave}` (không bao giờ `seen`). |
| `device_id` | Luôn có (IVSS-BRIDGE) trong luồng hiện tại — nhưng schema cho NULL; consumer không nên giả định NOT NULL. |
| `event_id` | Có khi ghi thành công (QĐ-6), nhưng schema nullable ⇒ consumer coi là *có thể* NULL. |
| `plate_number` | **Có thể NULL** (nếu §8.3 chọn NULL, hoặc biển rỗng). Consumer đối chiếu control-list phải xử NULL. |
| `user_id`, `vehicle_registration_id` | **Có thể NULL** (xe không đăng ký — QĐ-5). |
| `paired_log_id`, `duration_seconds` | NULL cho tới khi ghép cặp (UC-106); dòng `enter` chưa có `leave` sẽ NULL. |

---

## 13. Out of scope / ràng buộc

- **KHÔNG** refactor `VehicleResolveService` ngoài phạm vi UC-105: không đổi `resolveBridgeDeviceId`, không đổi cách chuẩn hoá biển, không đổi `parseUtc`. `resolveUserByPlate` **chỉ** mở rộng cột trả về (QĐ-7).
- **KHÔNG** `anpr` bắn raw SQL vào `gate_access_logs` (QĐ-1).
- **KHÔNG** gọi `pairForLeaveLog` trong cùng tx với ghi gate log (QĐ-8).
- **KHÔNG** ghi gate log khi `direction='seen'` hoặc zone chưa map (QĐ-2/4).
- **KHÔNG** sửa `vehicle_registrations` (§8.3).
- **KHÔNG** thêm hook cho UC-103/108 (QĐ-9).
- **KHÔNG** đụng UC-90→94, 96, 101, 106, 107 đã commit.
- Zone JOIN (nếu có ở đường ghi/kiểm) phải kèm điều kiện `zones.deleted_at IS NULL` (luật SAVP mục 5.5).
