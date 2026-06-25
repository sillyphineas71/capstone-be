# VWH-001 — tasks.md (UC4 ANPR: webhook nhận vehicle event + normalize)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo tasks VWH-001: T0 verify → T1 port → T2 guard → T3 DTO → T4 default handler → T5 controller → T6 wiring → T-GATE. Mỗi task 1 AC, code/test tách. Mirror face webhook. No-migration, không resolve/persist (UC5). | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. No-migration, KHÔNG resolve/persist (UC5). KHÔNG đổi env · KHÔNG đụng UC1-3 · KHÔNG import IvssInternalTokenGuard cross-module. UC1-3 KHÔNG hồi quy.

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T4 → T5 → T5b → T6 → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận đọc CODE THẬT: `IVSS_BRIDGE_TOKEN` CÓ trong `env.validation.ts` (KHÔNG thêm); `IvssInternalTokenGuard` (timingSafeEqual + ConfigService.get) để mirror; port mẫu `common/ports/ivss-event-hook.ts`; `default-ivss-event.handler.ts` để mirror; `normalizePlate` (UC1) còn nguyên; `AnprModule` UC1-3 (controller/service/dto) còn nguyên.
- **AC**: dán xác nhận 6 mục; thiếu/path sai → **DỪNG báo Thiếu Chủ** (không bịa).

## T1 — Port `vehicle-event-hook.ts` (code, leaf) — plan §2, OQ-3
- `src/common/ports/vehicle-event-hook.ts`: `export const VEHICLE_EVENT_HANDLER = Symbol('VEHICLE_EVENT_HANDLER')`; `export interface VehicleEventHandlerPort { onVehicleEvent(evt: VehicleEvent): Promise<void> }`; `export interface VehicleEvent { plateRaw; plateNumber; channelId; utc; eventAction?; plateColor?; vehicleColor?; vehicleType?; imageBase64? }`.
- **AC**: file leaf — KHÔNG import module nghiệp vụ; Symbol + interface + type đủ field.

## T2 — Guard `AnprInternalTokenGuard` (code) — plan §3, SEC-01, OQ-1
- `src/modules/anpr/guards/anpr-internal-token.guard.ts`: inject `ConfigService`, đọc `IVSS_BRIDGE_TOKEN` (KHÔNG env mới), header `x-internal-token`, `timingSafeEqual`, fail-closed (env rỗng/sai/thiếu → 401), KHÔNG log token, KHÔNG JWT. **KHÔNG import `IvssInternalTokenGuard`**.
- **AC**: guard riêng trong anpr; đọc đúng env `IVSS_BRIDGE_TOKEN`; constant-time + fail-closed.

## T2b — Guard test — SEC-01
- token đúng → `canActivate` true; token sai → 401; thiếu header → 401; env `IVSS_BRIDGE_TOKEN` rỗng → 401 (fail-closed). (mock ConfigService + request headers.)
- **AC**: 4 nhánh xanh; assert KHÔNG log token.

## T3 — DTO `VehicleEventDto` (code) — plan §4, VAL-01, OQ-2
- `src/modules/anpr/dto/vehicle-event.dto.ts`: `plateNumber` (`@IsString @IsNotEmpty`), `channelId` (`@Type(()=>Number) @IsInt`), `utc` (`@IsISO8601`); optional `eventAction`/`plateColor`/`vehicleColor`/`vehicleType`/`imageBase64` (`@IsOptional @IsString`).
- **AC**: required 3 field + optional 5; `channelId` ép Number, `utc` ISO-8601.

## T4 — Default handler `DefaultVehicleEventHandler` (code) — plan §5, ARCH-01, SEC-01
- `src/modules/anpr/handlers/default-vehicle-event.handler.ts`: `@Injectable implements VehicleEventHandlerPort`; `onVehicleEvent` log metadata (`channelId`, `plateNumber` — **KHÔNG `imageBase64`**) → `Promise.resolve()`.
- **AC**: log-only, KHÔNG throw, KHÔNG log imageBase64; resolve void.

## T5 — Controller `VehicleWebhookController` (code) — plan §6, ARCH-01, DATA-01, R1-R7
- `src/modules/anpr/controllers/vehicle-webhook.controller.ts`: `@Controller()` `@Post('internal/ivss/vehicle-events')` `@HttpCode(200)` `@UseGuards(AnprInternalTokenGuard)` `@UsePipes(new ValidationPipe({whitelist:true,transform:true}))`. Inject `@Inject(VEHICLE_EVENT_HANDLER) handler`.
- Luồng: `plateNumber = normalizePlate(dto.plateNumber)` → dựng `VehicleEvent {plateRaw: dto.plateNumber, plateNumber, channelId, utc, eventAction?, plateColor?, vehicleColor?, vehicleType?, imageBase64?}` → `try { await handler.onVehicleEvent(event) } catch { log metadata }` → trả `{success:true, message:'Vehicle event accepted', data:{accepted:true}}`. SEC-01 KHÔNG log imageBase64.
- **AC**: always-ack 200; normalize qua `normalizePlate` (UC1); KHÔNG resolve/persist/đụng DB.

## T5b — Controller test (mock handler port + mock guard) — DATA-01, ARCH-01, SEC-01
- payload hợp lệ → 200 + `handler.onVehicleEvent` gọi với `plateNumber` chuẩn + `plateRaw` gốc.
- **normalize**: `"30A-123.45"` → `event.plateNumber="30A12345"`, `event.plateRaw="30A-123.45"`.
- **always-ack**: handler ném lỗi → controller vẫn trả 200 (`accepted:true`).
- optional fields (eventAction/màu/type) truyền qua event khi có.
- SEC-01: `imageBase64` KHÔNG xuất hiện trong log (assert logger không nhận imageBase64).
- guard wiring: route có `AnprInternalTokenGuard`.
- **AC**: các assert xanh; normalize + always-ack chứng minh.

## T6 — Module wiring `anpr.module.ts` (code) — plan §7
- `controllers: [...UC1-3, VehicleWebhookController]`; `providers: [...UC1-3, AnprInternalTokenGuard, DefaultVehicleEventHandler, { provide: VEHICLE_EVENT_HANDLER, useClass: DefaultVehicleEventHandler }]`. KHÔNG đổi env, KHÔNG đụng UC1-3 method.
- **AC**: AppModule compile, 0 circular/UnknownDependencies; `VEHICLE_EVENT_HANDLER` resolve (default log-only).

## T-GATE — (STOP, KHÔNG commit) — plan §10
- build=0; eslint touched (port + guard + dto + handler + controller + module + 2 spec) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh (**UC1-3 KHÔNG hồi quy + UC4 mới**); coverage **≥80%** controller + guard mới; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies); throwaway xóa. **KHÔNG live, KHÔNG DB, KHÔNG commit.**
- Nếu sửa eslint: **đọc lại file sau khi sửa**, KHÔNG sed/regex hàng loạt làm rỗng assertion.
- In: code đầy đủ file + jest + coverage + báo cáo gate.
- **Owed (ghi, KHÔNG chạy)**: UC5 (resolve biển→user + persist `iot_device_events`, override `VEHICLE_EVENT_HANDLER` sang `useExisting` impl thật) · UC8 bridge gửi payload theo §3 contract · live round-trip · imageBase64 lưu hay không (UC5) · replay/rate-limit defer.
- **AC**: bảng gate đầy đủ + báo cáo: guard mirror cùng env fail-closed (401 sai/thiếu/rỗng) ✓ · port leaf ✓ · always-ack (handler throw→200) ✓ · normalize single-source UC1 (30A-123.45→30A12345) ✓ · validate 400 ✓ · SEC-01 không log imageBase64/token ✓ · default handler log-only ✓ · KHÔNG resolve/persist/migration/đổi env ✓ · UC1-3 không hồi quy ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC4
- T0 → verify env/guard-mẫu/port-mẫu/handler-mẫu/UC1-3 còn nguyên
- T1 → port `VEHICLE_EVENT_HANDLER` (boundary UC4→UC5, leaf)
- T2/T2b → guard `AnprInternalTokenGuard` (token nội bộ fail-closed)
- T3 → DTO `VehicleEventDto` (contract §3)
- T4 → default handler log-only (UC5 thay)
- T5/T5b → controller webhook (always-ack + normalize single-source)
- T6 → wiring anpr.module (controller + guard + port binding)
- T-GATE → gate + STOP + Owed (UC5 · UC8 · live · imageBase64 · replay)
