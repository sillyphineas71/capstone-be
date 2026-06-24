# VWH-001 — plan.md (UC4 ANPR: webhook nhận vehicle event + normalize)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-24 | Tạo plan VWH-001 sau spec DUYỆT + chốt OQ-1…4. Webhook internal (mirror face): guard mirror trong anpr + DTO + normalize(UC1) + port VEHICLE_EVENT_HANDLER (default log-only) + controller always-ack. No-migration, không resolve/persist (UC5). | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. RECON (đọc CODE THẬT, xác nhận đủ để code)
- **Default handler mẫu** ([default-ivss-event.handler.ts](../../../../src/modules/ivss/handlers/default-ivss-event.handler.ts)): `@Injectable class … implements IvssEventHandlerPort` + `Logger`, `onFaceEvent` log metadata → `Promise.resolve()`. ⇒ mirror `DefaultVehicleEventHandler`.
- **Registration**: [ivss.module.ts](../../../../src/modules/ivss/ivss.module.ts) provider `DefaultIvssEventHandler` + bind token `{ provide: IVSS_EVENT_HANDLER, useExisting: <impl> }`. ⇒ UC4 bind `{ provide: VEHICLE_EVENT_HANDLER, useClass: DefaultVehicleEventHandler }` (UC5 đổi sang `useExisting` impl thật).
- **Guard mẫu** ([ivss-internal-token.guard.ts](../../../../src/modules/ivss/guards/ivss-internal-token.guard.ts)): inject `ConfigService`, `get('IVSS_BRIDGE_TOKEN','')`, header `x-internal-token`, `timingSafeEqual`, fail-closed 401. ⇒ mirror `AnprInternalTokenGuard` (cùng env, file riêng trong anpr).
- **Env**: `IVSS_BRIDGE_TOKEN` **đã có** [env.validation.ts:176](../../../../src/config/env.validation.ts) (`Joi.string().allow('').default('')`); ConfigModule global → guard anpr inject ConfigService đọc được → **KHÔNG đổi env**.
- **Controller/DTO/port mẫu** ([ivss-webhook.controller.ts](../../../../src/modules/ivss/controllers/ivss-webhook.controller.ts), [face-event.dto.ts](../../../../src/modules/ivss/dto/face-event.dto.ts), [ivss-event-hook.ts](../../../../src/common/ports/ivss-event-hook.ts)) — mirror trực tiếp. `normalizePlate` (UC1) sẵn.
- **AnprModule**: hiện `imports:[forFeature, AuthModule]`, controllers/providers UC1-3 → UC4 thêm controller + guard + default handler + port binding. Không cần AuthModule cho webhook (internal token, không JWT) nhưng giữ nguyên import.

## 1. Quyết định đã chốt (OQ + Constitution)
OQ-1 cùng `IVSS_BRIDGE_TOKEN` + path `internal/ivss/vehicle-events`, guard mirror trong anpr · OQ-2 nhận tất cả field optional (eventAction sẵn UC7) · OQ-3 port `VEHICLE_EVENT_HANDLER` (UC4 log-only→UC5 override) · OQ-4 unknown channel vẫn nhận+ack.
- **SEC-01** token nội bộ constant-time fail-closed, KHÔNG JWT, KHÔNG log token/imageBase64. **ARCH-01** mirror face: `@HttpCode(200)` always-ack + handler qua port (leaf common/ports) + try/catch; UC4 default log-only, UC5 override (decouple). **DATA-01** normalize single-source `normalizePlate` (UC1); event mang `plateRaw`+`plateNumber`. **DATA-02** no-migration (UC4 không chạm DB). **VAL-01** `VehicleEventDto` validate.

## 2. Port — `common/ports/vehicle-event-hook.ts` (leaf, mirror §0)
- `export const VEHICLE_EVENT_HANDLER = Symbol('VEHICLE_EVENT_HANDLER')`.
- `export interface VehicleEventHandlerPort { onVehicleEvent(evt: VehicleEvent): Promise<void> }`.
- `export interface VehicleEvent { plateRaw: string; plateNumber: string; channelId: number; utc: string; eventAction?: string; plateColor?: string; vehicleColor?: string; vehicleType?: string; imageBase64?: string }`.
- KHÔNG import module nghiệp vụ (tránh circular).

## 3. Guard — `AnprInternalTokenGuard` (mirror §0 guard, file riêng anpr)
- `src/modules/anpr/guards/anpr-internal-token.guard.ts`: inject `ConfigService`, đọc `IVSS_BRIDGE_TOKEN`, header `x-internal-token`, `timingSafeEqual`, fail-closed (env rỗng/sai → 401), KHÔNG log token. KHÔNG import IvssInternalTokenGuard.

## 4. DTO — `VehicleEventDto` (mirror FaceEventDto)
- `src/modules/anpr/dto/vehicle-event.dto.ts`: `plateNumber` (`@IsString @IsNotEmpty`), `channelId` (`@Type(()=>Number) @IsInt`), `utc` (`@IsISO8601`); optional `eventAction`/`plateColor`/`vehicleColor`/`vehicleType`/`imageBase64` (`@IsOptional @IsString`).

## 5. Default handler — `DefaultVehicleEventHandler` (UC4 tự cấp, UC5 thay)
- `src/modules/anpr/handlers/default-vehicle-event.handler.ts`: `@Injectable implements VehicleEventHandlerPort`; `onVehicleEvent` log metadata (`channel`, `plateNumber` — KHÔNG imageBase64) → `Promise.resolve()`.

## 6. Controller — `VehicleWebhookController` (mirror §0 controller)
- `src/modules/anpr/controllers/vehicle-webhook.controller.ts`: `@Controller()` `@Post('internal/ivss/vehicle-events')` `@HttpCode(200)` `@UseGuards(AnprInternalTokenGuard)` `@UsePipes(new ValidationPipe({whitelist:true,transform:true}))`.
- Inject `@Inject(VEHICLE_EVENT_HANDLER) handler: VehicleEventHandlerPort`. Luồng: `plateNumber = normalizePlate(dto.plateNumber)` → dựng `VehicleEvent {plateRaw: dto.plateNumber, plateNumber, channelId, utc, eventAction?, plateColor?, …}` → `try { await handler.onVehicleEvent(event) } catch { log metadata }` → trả `{success:true, message:'Vehicle event accepted', data:{accepted:true}}`. SEC-01 KHÔNG log imageBase64.

## 7. Module wiring — `anpr.module.ts` (Modified)
- `controllers: [...UC1-3, VehicleWebhookController]`.
- `providers: [...UC1-3, AnprInternalTokenGuard, DefaultVehicleEventHandler, { provide: VEHICLE_EVENT_HANDLER, useClass: DefaultVehicleEventHandler }]`.
- KHÔNG đổi env (IVSS_BRIDGE_TOKEN có sẵn). KHÔNG đụng UC1-3 method.

## 8. File list
### Net-new
- `src/common/ports/vehicle-event-hook.ts`
- `src/modules/anpr/guards/anpr-internal-token.guard.ts` (+ `.spec.ts`)
- `src/modules/anpr/dto/vehicle-event.dto.ts`
- `src/modules/anpr/handlers/default-vehicle-event.handler.ts`
- `src/modules/anpr/controllers/vehicle-webhook.controller.ts` (+ `.spec.ts`)
### Modified
- `src/modules/anpr/anpr.module.ts` — controller + guard + default handler + port binding.
> Tổng **7 net-new (5 code + 2 spec) + 1 modified**. 0 migration. 0 đổi env. 0 đụng UC1-3 method.

## 9. Test (mock — KHÔNG thiết bị, POST payload giả)
- **guard**: token đúng → pass; thiếu/sai → 401; env `IVSS_BRIDGE_TOKEN` rỗng → 401 (fail-closed). (mock ConfigService + request headers.)
- **controller** (mock handler port): payload hợp lệ → 200 + `handler.onVehicleEvent` gọi với `plateNumber` chuẩn + `plateRaw` gốc; **normalize đúng** (`"30A-123.45"` → `event.plateNumber="30A12345"`, dùng `normalizePlate` UC1); handler ném lỗi → **vẫn 200** (always-ack); `imageBase64` KHÔNG log; event mang optional fields khi có.
- **DTO/validate**: `plateNumber` rỗng / `channelId` không int / `utc` không ISO-8601 → 400 (qua ValidationPipe).
- **default handler**: `onVehicleEvent` resolve void, KHÔNG throw.
- **UC1-3 KHÔNG hồi quy**: `jest src/modules/anpr` xanh cũ + mới.
- Coverage **≥80%** controller + guard mới.

## 10. Gate (STOP, KHÔNG commit)
- build=0; eslint touched (port + guard + dto + handler + controller + module + 2 spec) baseline-proof **0 rule mới**, file mới 0; `npx jest src/modules/anpr` xanh (cũ + mới); coverage ≥80% controller+guard mới; DI-proof compile AppModule (Redis infra-OK, 0 circular/UnknownDependencies — port binding resolve). **KHÔNG live, KHÔNG DB.**
- **Owed (ghi, KHÔNG chạy)**: UC5 (resolve biển→user + persist `iot_device_events`, override `VEHICLE_EVENT_HANDLER` sang impl thật) · UC8 bridge gửi payload theo §3 contract · live round-trip · imageBase64 lưu hay không (UC5) · replay/rate-limit defer.

## 11. Kỷ luật
- **No-migration** (UC4 không chạm DB). **SEC-01** token nội bộ fail-closed, KHÔNG JWT, KHÔNG log token/imageBase64. **ARCH-01** mirror face: always-ack + port decouple (UC4 KHÔNG biết UC5). **DATA-01** normalize single-source UC1 (`plateRaw`+`plateNumber`). **VAL-01** DTO validate.
- KHÔNG resolve user / KHÔNG persist (UC5) · KHÔNG import IvssInternalTokenGuard cross-module (guard mirror) · KHÔNG đổi env · KHÔNG đụng UC1-3.

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan → sang tasks. KHÔNG code.
