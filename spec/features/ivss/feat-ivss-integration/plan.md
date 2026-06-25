# IVS-001 — plan.md (#36 nửa NestJS: bridge client + webhook + config)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-22 | Tạo plan IVS-001 sau spec DUYỆT (6 OQ + R1–R4). Module mới `ivss`, guard riêng, OQ-3=A (no-persist), Node http, env. No-migration. | Toàn bộ |

> Spec duyệt: [spec.md](./spec.md). Plan KHÔNG mở lại OQ.

## 0. Quyết định đã chốt
- **OQ-1** module mới `ivss`. **OQ-2** `IvssInternalTokenGuard` riêng (mirror internal-token.guard, KHÔNG refactor guard no-show). **OQ-3=A** receive + validate + handoff port + log, **no-persist / no-migration**. **OQ-4** Node `http`/`https`. **OQ-5** env (Joi scoped). **OQ-6** passive `GET /ivss/health` admin-gated.
- **R1**: **1 secret `IVSS_BRIDGE_TOKEN`** dùng cả 2 chiều — guard inbound đọc nó; client outbound gửi nó làm header `X-Internal-Token`. (KHÔNG có `IVSS_INTERNAL_TOKEN` riêng.)
- **R2**: webhook **luôn ack 200/202** bất kể handler; `try/catch` quanh `onFaceEvent` (handler lỗi → vẫn ack + log).
- **R3**: nâng body-limit route webhook (~5–10mb) cho `imageBase64` (optional — xem §6).
- **R4**: `channelId` → **number** (transform + validate); `utc` validate **ISO-8601**.

## 1. Cây module (net-new)
```
src/common/ports/
  ivss-event-hook.ts                 (NET-NEW: IVSS_EVENT_HANDLER token + IvssEventHandlerPort + IvssFaceEvent — leaf, no-cycle)

src/modules/ivss/
  ivss.module.ts                     (NET-NEW: wiring + provide IVSS_EVENT_HANDLER useClass DefaultIvssEventHandler + export client)
  ports/
    ivss-bridge.port.ts              (NET-NEW: IvssBridgePort, IvssResult<T>, IvssBridgeError, input/status types)
  clients/
    ivss-bridge.client.ts            (NET-NEW: impl IvssBridgePort — Node http, timeout, typed result/error, KHÔNG throw)
    ivss-bridge.client.spec.ts       (NET-NEW)
  ivss-bridge.factory.ts             (NET-NEW: đọc env → deps {baseUrl,token,timeoutMs} → dựng client)
  guards/
    ivss-internal-token.guard.ts     (NET-NEW: mirror internal-token.guard, đọc IVSS_BRIDGE_TOKEN)
  controllers/
    ivss-webhook.controller.ts       (NET-NEW: POST /api/v1/internal/ivss/events)
    ivss-webhook.controller.spec.ts  (NET-NEW)
    ivss-health.controller.ts        (NET-NEW: GET /api/v1/ivss/health)
  handlers/
    default-ivss-event.handler.ts    (NET-NEW: impl IvssEventHandlerPort — log-only metadata)
    default-ivss-event.handler.spec.ts (NET-NEW)
  dto/
    face-event.dto.ts                (NET-NEW: FaceEventDto)
```

### Modified
- `src/app.module.ts` — import `IvssModule`.
- `src/config/env.validation.ts` — Joi scoped (4 key, KHÔNG prettier cả file).
- `.env.example` — 4 key.
- `src/main.ts` — (R3, optional) raise body limit cho path webhook (xem §6).

## 2. IvssBridgePort + IvssResult (mirror FaceGate)
```ts
export type IvssResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IvssBridgeError };
export interface IvssBridgeError {
  code: 'BRIDGE_UNREACHABLE' | 'BRIDGE_TIMEOUT' | 'BRIDGE_HTTP_ERROR' | 'BRIDGE_BAD_RESPONSE';
  status?: number;
  message: string;
}
export interface IvssBridgePort {
  createGroup(input: CreateGroupInput): Promise<IvssResult<IvssGroup>>;
  enrollFace(input: EnrollFaceInput): Promise<IvssResult<IvssFaceRef>>;
  deleteFace(input: DeleteFaceInput): Promise<IvssResult<{ deleted: boolean }>>;
  status(): Promise<IvssResult<IvssStatus>>;
}
```
- **Client** (`IvssBridgeClient implements IvssBridgePort`): Node `http`/`https` (chọn theo baseUrl scheme), `req.setTimeout(timeoutMs)` → `BRIDGE_TIMEOUT`; `req.on('error')` ECONNREFUSED/DNS → `BRIDGE_UNREACHABLE`; status ≥400 → `BRIDGE_HTTP_ERROR` (+status); JSON parse fail → `BRIDGE_BAD_RESPONSE`. **KHÔNG throw** ra flow (mọi nhánh → `IvssResult`). Header `X-Internal-Token: <token>` mọi request. SEC-01: KHÔNG log token (debug chỉ method/path/status).
- **Factory** đọc env: `{ baseUrl: IVSS_BRIDGE_BASE_URL, token: IVSS_BRIDGE_TOKEN, timeoutMs: IVSS_BRIDGE_TIMEOUT_MS }`. (`IVSS_DEFAULT_GROUP` truyền vào createGroup/enroll khi caller cần — #37 dùng.)
- Endpoints map contract: `POST /api/ivss/groups`, `POST /api/ivss/faces`, `DELETE /api/ivss/faces`, `GET /api/ivss/status`.

## 3. IvssInternalTokenGuard (R1, OQ-2)
- Mirror [internal-token.guard.ts](../../../../src/modules/rooms/guards/internal-token.guard.ts): header `X-Internal-Token`, **constant-time** `timingSafeEqual`, **fail-closed** (env rỗng → 401), KHÔNG log token. Khác key: đọc **`IVSS_BRIDGE_TOKEN`** (R1 — cùng secret 2 chiều). File riêng (KHÔNG sửa guard no-show).

## 4. Webhook controller + DTO
- `@Controller()` route `internal/ivss/events` → full `POST /api/v1/internal/ivss/events` (global prefix `/api/v1`). `@UseGuards(IvssInternalTokenGuard)` + `@UsePipes(new ValidationPipe({ whitelist:true, transform:true }))`.
- **FaceEventDto** (R4): `type @IsString @IsNotEmpty`; `channelId @Type(()=>Number) @IsInt`; `personUid @IsString @IsNotEmpty`; `utc @IsISO8601`; `name? @IsString`; `similarity? @IsNumber`; `eventAction? @IsString`; `imageBase64? @IsString` (KHÔNG log).
- **R2 handoff**: `try { await handler.onFaceEvent(normalized) } catch (e) { logger.warn(metadata-only) }` → **luôn** trả `{success:true,message,data:{accepted:true}}` (200/202). normalized KHÔNG kèm imageBase64 vào log; truyền nguyên cho handler (handler tự lo, #38–40).

## 5. IvssEventHandlerPort + default handler
- `src/common/ports/ivss-event-hook.ts`: `IVSS_EVENT_HANDLER = Symbol(...)` + `interface IvssEventHandlerPort { onFaceEvent(evt: IvssFaceEvent): Promise<void> }` + `IvssFaceEvent` (type, channelId:number, personUid, name?, similarity?, eventAction?, utc, imageBase64?). Leaf (mirror FACE_VERIFY_HOOK/STRANGER_ALERT_HOOK, NC-4 no-cycle).
- `DefaultIvssEventHandler implements IvssEventHandlerPort`: **log/đếm metadata-only** (type/channelId/personUid/utc — **KHÔNG** imageBase64). #38–40 override bằng `useExisting` impl thật.
- `ivss.module`: `{ provide: IVSS_EVENT_HANDLER, useClass: DefaultIvssEventHandler }`; controller inject `@Inject(IVSS_EVENT_HANDLER)`.

## 6. Config + health + body-limit
- **Env (Joi scoped)**: `IVSS_BRIDGE_BASE_URL` (string, required khi bật? → default '' fail-safe; client baseUrl rỗng → trả `BRIDGE_UNREACHABLE`), `IVSS_BRIDGE_TOKEN` (string, allow '' default — guard fail-closed nếu rỗng), `IVSS_DEFAULT_GROUP` (string default ''), `IVSS_BRIDGE_TIMEOUT_MS` (number, min 1000 max 30000, default 8000 — mirror FACEGATE).
- **Health**: `GET /api/v1/ivss/health` admin-gated (`JwtAuthGuard + MockPermissionsGuard`, `@Permissions('ivss.health.read')`) → `client.status()` → `{success,message,data:{ bridge:'up'|'down', detail? }}` (passive, OQ-6).
- **R3 body-limit (optional)**: `main.ts` — raise express json limit cho path webhook (vd `app.use('/api/v1/internal/ivss/events', json({ limit: '10mb' }))` đặt trước Nest parser, hoặc bump `NestFactory.create(AppModule,{ bodyParser })`). ⚠ chạm `main.ts` (file shared) — chỉ thêm dòng scoped path, KHÔNG đổi global limit. Nếu rủi ro → defer (handler log-only #36 không cần imageBase64; ghi residual).

## 7. Wiring
- `IvssModule`: imports `ConfigModule` (+ AuthModule nếu health cần JwtAuthGuard — mirror các controller admin khác); providers: factory→`IvssBridgeClient` (provide port token), `IvssInternalTokenGuard`, `DefaultIvssEventHandler` (+ bind `IVSS_EVENT_HANDLER`); controllers: webhook + health; exports: `IvssBridgeClient`/port token (cho #37/#38–40).
- `app.module` import `IvssModule`.

## 8. Test (mock Node http + mock guard/handler — KHÔNG bridge/thiết bị)
- **client**: seam cho `http.request` (vd inject `httpRequestFn` hoặc `jest.mock('http')`) → 200 JSON → `ok:true`; timeout → `BRIDGE_TIMEOUT`; ECONNREFUSED → `BRIDGE_UNREACHABLE`; 500 → `BRIDGE_HTTP_ERROR`; body rác → `BRIDGE_BAD_RESPONSE`. Assert KHÔNG throw + header token gắn (KHÔNG lộ trong assert log).
- **handler**: default log-only → spy logger, assert log KHÔNG chứa imageBase64/token.
- **webhook controller**: handler mock → body hợp lệ → handler 1 lần + ack; **handler throw → vẫn ack (R2)**; thiếu field → 400; channelId string '5' → coerce number 5 (R4); guard wiring (JwtAuth/IvssInternalToken metadata).
- **guard**: mirror internal-token test — IVSS_BRIDGE_TOKEN đúng→true, sai/rỗng→401.
- Coverage **≥80%** `ivss-bridge.client.ts` + `default-ivss-event.handler.ts`.

## 9. Gate (STOP, KHÔNG commit)
- `npm run build`=0.
- eslint touched + spec → baseline-proof (stash cho `app.module`/`env.validation`/`main.ts`), **0 lỗi rule mới**; file mới 0.
- `npx jest src/modules/ivss` + regression nhẹ (chỉ app.module/main.ts/env đụng → smoke build + DI-proof). DI-proof: compile AppModule (Redis infra-fail OK, 0 circular/UnknownDependencies).
- Coverage ≥80% client + handler. **KHÔNG live** (bridge chưa chạy).
- Owed: live-runbook (client↔bridge thật) + harden (xem tasks T-cuối).

## 10. Kỷ luật
- **No-migration** (#36): chạm cột/bảng mới → DỪNG báo. KHÔNG tạo `ivss_events`.
- **SEC-01** token + imageBase64 KHÔNG log/audit; **SEC-02** webhook internal-guard, health admin-guard; **SEC-03** validate DTO boundary (không raw SQL ở #36); **ARCH-01** #36 KHÔNG chạm presence/attendance/booking, KHÔNG đọc NetSDK trong NestJS (bridge lo).
- Envelope thủ công `{success,message,data}`; ValidationPipe per-route; KHÔNG global pipe.

> **STOP.** Plan + tasks chờ review trước khi code.
