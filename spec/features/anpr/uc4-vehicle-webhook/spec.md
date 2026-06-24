# VWH-001 — UC4 (ANPR): webhook nhận vehicle event + normalize biển

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo spec VWH-001 (UC4): webhook internal (token nội bộ, KHÔNG JWT) nhận vehicle event từ bridge → validate + normalize biển bằng `normalizePlate` (UC1) → handoff qua port. Mirror IVSS face webhook (#36). Định CONTRACT payload cho UC8. RECON code thật. OQ chờ chốt. | Toàn bộ |
| 2026-06-24 | Thiếu Chủ CHỐT OQ-1…4: OQ-1=cùng `IVSS_BRIDGE_TOKEN` + path `internal/ivss/vehicle-events`, guard MIRROR trong anpr (`AnprInternalTokenGuard`, KHÔNG import cross-module) · OQ-2=nhận tất cả field optional (eventAction sẵn cho UC7) · OQ-3=port `VEHICLE_EVENT_HANDLER` (UC4 log-only→UC5 override) · OQ-4=unknown channel vẫn nhận+ack. §8 ĐÃ CHỐT. | §8 |

> **SPEC-ONLY.** Chưa plan/tasks/code. Nền UC1 đã commit: entity + `VehicleRegistrationService` + **`normalizePlate` util**. UC4 thêm: webhook controller (internal, mirror face) + DTO payload + normalize + port handoff. **UC4 KẾT THÚC ở nhận+auth+validate+normalize** — resolve biển→user + persist event = **UC5** (tách rõ). KHÔNG bridge code (UC8), KHÔNG camera, KHÔNG migration.
>
> ⚠ **§3 Webhook contract là output quan trọng nhất** — bridge thật (UC8) PHẢI tuân.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Face webhook controller — KHUÔN MẪU CHÍNH ([ivss-webhook.controller.ts](../../../../src/modules/ivss/controllers/ivss-webhook.controller.ts))
- `@Controller()` (no prefix; global `/api/v1` từ main) + `@Post('internal/ivss/events')` + `@HttpCode(200)` (**LUÔN ack 200**) + `@UseGuards(IvssInternalTokenGuard)` + `@UsePipes(new ValidationPipe({whitelist:true, transform:true}))`.
- Handler inject qua **port** `@Inject(IVSS_EVENT_HANDLER) handler: IvssEventHandlerPort`; gọi `handler.onFaceEvent(dto)` trong **try/catch** (R2: handler lỗi KHÔNG vỡ ack). Trả `{success:true, message:'IVSS event accepted', data:{accepted:true}}`. SEC-01: log chỉ metadata, KHÔNG imageBase64.

### 0.2. Internal token guard ([ivss-internal-token.guard.ts](../../../../src/modules/ivss/guards/ivss-internal-token.guard.ts))
- Header **`X-Internal-Token`** == `IVSS_BRIDGE_TOKEN` (env), so sánh **constant-time** (`timingSafeEqual`), **FAIL-CLOSED** (env rỗng / sai / thiếu → `401 UnauthorizedException`), KHÔNG log token. **KHÔNG JWT** (system-to-system).
- ⇒ Vehicle webhook dùng cùng cơ chế. Bridge thật (UC8) là **cùng 1 IVSS bridge** gửi cả face + vehicle event → cùng token `IVSS_BRIDGE_TOKEN` (OQ-1).

### 0.3. Payload DTO mẫu ([face-event.dto.ts](../../../../src/modules/ivss/dto/face-event.dto.ts))
- `type` (`@IsString @IsNotEmpty`), `channelId` (`@Type(()=>Number) @IsInt`), `personUid` (`@IsString @IsNotEmpty`), `utc` (`@IsISO8601`), optional `name`/`similarity`(`@Type Number @IsNumber`)/`eventAction`/`imageBase64` (`@IsOptional @IsString`). ⇒ VehicleEventDto mirror cấu trúc (đổi `personUid`→`plateNumber`).

### 0.4. Port handoff pattern ([ivss-event-hook.ts](../../../../src/common/ports/ivss-event-hook.ts))
- `IVSS_EVENT_HANDLER = Symbol(...)` + `interface IvssEventHandlerPort { onFaceEvent(evt): Promise<void> }` đặt ở **`common/ports` (leaf, không import module nghiệp vụ → tránh circular)**. #36 default log-only; #38–40 override `useExisting`. ⇒ **UC4→UC5 boundary mirror y hệt**: port `VEHICLE_EVENT_HANDLER`; UC4 default no-op/log; UC5 override impl thật (resolve+persist).

### 0.5. normalizePlate util (UC1) — SINGLE SOURCE ([normalize-plate.ts](../../../../src/modules/anpr/utils/normalize-plate.ts))
- `normalizePlate(raw) = trim → toUpperCase → strip [^A-Z0-9]`. Comment: "KHÔNG map O/0,I/1 — xử OCR ở UC4". ⇒ UC4 đọc-vào PHẢI gọi **đúng hàm này** thì `plate_number` mới khớp DB (UC1 đăng-ký ↔ UC4/UC5 đọc). Đây là lý do UC1 tách util chung.

---

## 1. Scope (UC4)

### TRONG scope
1. **Webhook route internal** (mirror face): nhận vehicle event từ bridge; auth = token nội bộ (`X-Internal-Token`), KHÔNG JWT; luôn ack 200.
2. **VehicleEventDto** — validate payload (`plateNumber` không rỗng, `channelId` int, `utc` ISO-8601). Sai → 400, KHÔNG crash.
3. **Normalize**: `normalizePlate(dto.plateNumber)` (UC1) → `plateNumber` chuẩn.
4. **Handoff** qua port `VEHICLE_EVENT_HANDLER`: dựng `VehicleEvent` (raw + normalized + channelId + utc + …) → gọi `onVehicleEvent` best-effort. UC4 default handler = **log-only no-op** (UC5 override).

### NGOÀI scope (UC sau — KHÔNG làm)
- KHÔNG resolve biển→user (UC5). KHÔNG persist `iot_device_events` (UC5). KHÔNG xử biển lạ/unknown (UC6). KHÔNG bridge code (UC8). KHÔNG camera. KHÔNG migration.

## 2. Webhook controller (đề xuất — mirror §0.1)
- `VehicleWebhookController` (module `anpr`): `@Post('internal/ivss/vehicle-events')` (OQ-1 path) `@HttpCode(200)` `@UseGuards(<internal token guard>)` `@UsePipes(ValidationPipe{whitelist,transform})`.
- Inject `@Inject(VEHICLE_EVENT_HANDLER) handler: VehicleEventHandlerPort`. Luồng:
  1. Guard pass (token hợp lệ) — nếu sai → 401 (fail-closed).
  2. ValidationPipe validate `VehicleEventDto` — sai → 400.
  3. `plateNumber = normalizePlate(dto.plateNumber)` (§0.5).
  4. Dựng `VehicleEvent { plateRaw: dto.plateNumber, plateNumber, channelId, utc, eventAction?, … }`.
  5. `try { await handler.onVehicleEvent(event) } catch { log metadata }` → **LUÔN ack** `{success:true, message:'Vehicle event accepted', data:{accepted:true}}`.
- SEC-01: KHÔNG log `imageBase64` (nếu có).

## 3. ⭐ WEBHOOK CONTRACT — payload bridge gửi (UC8 PHẢI tuân)
`POST /api/v1/internal/ivss/vehicle-events` · header `X-Internal-Token: <IVSS_BRIDGE_TOKEN>` · body JSON:

| Field | Kiểu | Bắt buộc | Validate | Ghi chú |
| :--- | :--- | :---: | :--- | :--- |
| `plateNumber` | string | ✅ | `@IsString @IsNotEmpty` | **Biển RAW từ camera, CHƯA normalize** (vd `"30A-123.45"`). UC4 normalize. |
| `channelId` | number | ✅ | `@Type(()=>Number) @IsInt` | Channel camera IVSS thấy xe. |
| `utc` | string | ✅ | `@IsISO8601` | Thời điểm event (ISO-8601). |
| `eventAction` | string | ❌ | `@IsOptional @IsString` | Hướng/cổng (vào/ra) nếu bridge gửi — UC5 diễn giải (OQ-2). |
| `plateColor` | string | ❌ | `@IsOptional @IsString` | `szPlateColor` (mirror DEV_EVENT_TRAFFIC...) — lấy không? (OQ-2). |
| `vehicleColor` | string | ❌ | `@IsOptional @IsString` | `szVehicleColor` — OQ-2. |
| `vehicleType` | string | ❌ | `@IsOptional @IsString` | Loại xe camera đoán — OQ-2. |
| `imageBase64` | string | ❌ | `@IsOptional @IsString` | Ảnh — SEC-01 KHÔNG log/persist (UC5 quyết lưu hay không). OQ-2. |

> Tối thiểu **`plateNumber` + `channelId` + `utc`** (mirror face: personUid+channelId+utc). Các field màu/ảnh/type là OQ-2.

## 4. Normalize (CRUX — single source UC1)
`plateNumber (raw) → normalizePlate() → plateNumber (chuẩn)`. UC4 KHÔNG tự viết logic normalize — gọi đúng `normalizePlate` (UC1). `VehicleEvent` mang **cả** `plateRaw` (gốc, để UC5 lưu hiển thị/debug) **và** `plateNumber` (chuẩn, để UC5 khớp DB). ⚠ Đồng bộ: nếu UC1 đổi normalize (vd OQ O/0) thì UC4/UC5 tự khớp vì cùng hàm.

## 5. UC4 → UC5 boundary (port — mirror §0.4)
- Port `VEHICLE_EVENT_HANDLER` (Symbol) + `interface VehicleEventHandlerPort { onVehicleEvent(evt: VehicleEvent): Promise<void> }` ở **`common/ports/vehicle-event-hook.ts`** (leaf).
- **UC4** cung cấp **default handler log-only** (no-op, chỉ log "vehicle event received channel=X") — để webhook chạy độc lập trước khi UC5 xong.
- **UC5** override `useExisting` impl thật (resolve biển→user qua `vehicle_registrations` + persist `iot_device_events`). UC4 KHÔNG biết UC5 (decouple, tránh circular).

## 6. Requirements (EARS)
- **R1**: **WHEN** bridge POST `/internal/ivss/vehicle-events` với `X-Internal-Token` hợp lệ + payload hợp lệ **→** UC4 normalize `plateNumber`, dựng `VehicleEvent`, gọi `onVehicleEvent`, trả **200** `{success:true,…accepted:true}`.
- **R2 (SEC auth)**: **IF** token thiếu/sai (hoặc `IVSS_BRIDGE_TOKEN` env rỗng) **→** **401**, KHÔNG xử event (fail-closed). KHÔNG JWT.
- **R3 (VAL)**: **IF** payload sai (`plateNumber` rỗng / `channelId` không int / `utc` không ISO-8601) **→** **400**, KHÔNG crash, KHÔNG gọi handler.
- **R4 (always-ack)**: **IF** `onVehicleEvent` (handler UC5) ném lỗi **→** UC4 vẫn trả **200** (log metadata), KHÔNG để lỗi handler vỡ webhook (mirror face R2).
- **R5 (normalize single-source)**: **WHILE** xử mọi event, UC4 PHẢI dùng `normalizePlate` (UC1) — KHÔNG tự viết normalize.
- **R6 (SEC-01)**: **IF** payload có `imageBase64` **→** KHÔNG log; (persist hay không là UC5).
- **R7 (boundary)**: **WHILE** ở UC4, KHÔNG resolve user / KHÔNG persist event — chỉ handoff qua port.

## 7. Constitution
- **SEC-01 (auth webhook)**: token nội bộ `X-Internal-Token` constant-time, fail-closed, **KHÔNG JWT** — chỉ bridge gọi được (mirror `IvssInternalTokenGuard`). KHÔNG log token/imageBase64.
- **ARCH-01 (mirror face webhook)**: controller `@HttpCode(200)` luôn ack + handler qua **port** (`VEHICLE_EVENT_HANDLER`, leaf `common/ports`) + try/catch best-effort. UC4 default log-only, UC5 override (decouple, no circular).
- **DATA-01 (normalize single-source)**: dùng `normalizePlate` (UC1) — `VehicleEvent` mang `plateRaw` + `plateNumber`(chuẩn). KHÔNG tự normalize.
- **DATA-02**: no-migration (UC4 không chạm DB; persist là UC5).
- **VAL-01**: `VehicleEventDto` `class-validator` + `ValidationPipe({whitelist,transform})`; `channelId` `@Type Number`, `utc` `@IsISO8601`, `plateNumber` `@IsNotEmpty`.

## 8. OPEN QUESTIONS — ĐÃ CHỐT
- **OQ-1 (crux) auth + path — CHỐT**: **cùng `IVSS_BRIDGE_TOKEN`** (một bridge, một token — KHÔNG tạo env mới) + path `POST /api/v1/internal/ivss/vehicle-events`. Guard **MIRROR trong anpr** (`AnprInternalTokenGuard` đọc cùng env `IVSS_BRIDGE_TOKEN`, constant-time, fail-closed) — **KHÔNG import `IvssInternalTokenGuard` cross-module** (anpr độc lập, không phụ thuộc IvssModule).
- **OQ-2 payload field — CHỐT**: nhận TẤT CẢ field như optional. Bắt buộc `plateNumber`(raw)/`channelId`/`utc`; optional `eventAction`/`plateColor`/`vehicleColor`/`vehicleType`/`imageBase64`. Validate optional. SEC-01: KHÔNG log `imageBase64`. (`eventAction` nhận sẵn cho UC7 hướng vào/ra.)
- **OQ-3 boundary — CHỐT**: port `VEHICLE_EVENT_HANDLER` ở `common/ports/vehicle-event-hook.ts` (leaf). UC4 default handler log-only no-op; UC5 override `useExisting`. Mirror IVSS #36→#38.
- **OQ-4 unknown channel — CHỐT**: vẫn nhận+ack+handoff — UC4 KHÔNG validate channel có thật (chỉ `@IsInt`). UC5 xử resolve.

## 9. Residuals / known-gaps
- **Live round-trip owed**: webhook chỉ chứng minh thật khi bridge (UC8) gửi payload thật; UC4 test bằng **POST payload giả** (biển mẫu), KHÔNG cần thiết bị.
- **Contract là hợp đồng UC8**: mọi đổi §3 phải đồng bộ bridge (UC8). Field optional (OQ-2) chốt sớm để UC8 khỏi sửa nhiều.
- **direction/eventAction**: giá trị thật bridge gửi (vào/ra) chưa biết — UC5/UC6 diễn giải; UC4 chỉ truyền raw.
- **normalize O/0,I/1**: theo UC1 (KHÔNG map) — nếu OCR camera nhầm nhiều, tuning ở UC4/UC5 sau (đổi `normalizePlate` ảnh hưởng cả đăng-ký) — defer.
- **imageBase64 lưu trữ**: UC4 không lưu; nếu UC5 cần lưu ảnh biển → quyết ở UC5 (media_files? hay bỏ).
- **Rate/replay**: webhook chưa chống replay/rate-limit; mirror face (cũng chưa) — defer.

> **STOP.** Spec-only. Chờ Thiếu Chủ review §0 RECON + §3 contract + chốt OQ-1…OQ-4 trước khi plan/tasks. KHÔNG tự code.
