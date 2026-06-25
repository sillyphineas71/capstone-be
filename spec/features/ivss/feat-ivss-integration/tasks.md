# IVS-001 — tasks.md (#36 nửa NestJS)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-22 | Tạo tasks IVS-001: T1 ports → T2 client+factory → T3 guard → T4 handler → T5 DTO+webhook → T6 health → T7 config+wiring → tests → T-GATE. Map scope #36. No-migration. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. Plumbing only (no nghiệp vụ, no-migration).

## Thứ tự
T1 → T2 → T2b → T3 → T3b → T4 → T4b → T5 → T5b → T6 → T7 → T-GATE.

---

## T1 — Ports (code) — §1/§2/§5
- `src/modules/ivss/ports/ivss-bridge.port.ts`: `IvssBridgePort`, `IvssResult<T>`, `IvssBridgeError` (4 code), input/status types.
- `src/common/ports/ivss-event-hook.ts`: `IVSS_EVENT_HANDLER` Symbol + `IvssEventHandlerPort` + `IvssFaceEvent` (leaf, no import module).
- **AC**: build OK; types export; common/ports không import module nào (no-cycle).

## T2 — IvssBridgeClient + factory (code) — §2, OQ-4, R1
- `clients/ivss-bridge.client.ts` impl `IvssBridgePort`: Node `http`/`https`, `req.setTimeout(timeoutMs)`, header `X-Internal-Token=token`, baseUrl từ deps. Map lỗi → `IvssResult` (UNREACHABLE/TIMEOUT/HTTP_ERROR/BAD_RESPONSE), **KHÔNG throw**. 4 method theo contract.
- `ivss-bridge.factory.ts`: đọc env (`IVSS_BRIDGE_BASE_URL/TOKEN/TIMEOUT_MS`) → dựng client.
- **AC**: `status()` khi bridge trả 200 → `{ok:true}`; baseUrl rỗng/ECONNREFUSED → `{ok:false, error.code:'BRIDGE_UNREACHABLE'}`; KHÔNG throw.

## T2b — Client test — §8
- mock `http.request` seam: 200→ok; timeout→TIMEOUT; ECONNREFUSED→UNREACHABLE; 500→HTTP_ERROR(+status); body rác→BAD_RESPONSE; header token gắn; KHÔNG throw.
- **AC**: ≥80% branch client.

## T3 — IvssInternalTokenGuard (code) — OQ-2, R1
- `guards/ivss-internal-token.guard.ts` mirror internal-token.guard: header `X-Internal-Token`, constant-time, fail-closed, đọc **`IVSS_BRIDGE_TOKEN`**, KHÔNG log token.
- **AC**: token đúng→true; sai/thiếu/env rỗng→401.

## T3b — Guard test
- 4 ca: đúng→true, sai→401, thiếu header→401, env rỗng→401.
- **AC**: 4 ca xanh.

## T4 — DefaultIvssEventHandler (code) — §5, OQ-3=A, SEC-01
- `handlers/default-ivss-event.handler.ts` impl `IvssEventHandlerPort`: log/đếm **metadata-only** (type/channelId/personUid/utc), **KHÔNG** log imageBase64.
- **AC**: `onFaceEvent` chạy không throw; log KHÔNG chứa imageBase64.

## T4b — Handler test — SEC-01
- gọi với evt có imageBase64 → spy logger: log KHÔNG chứa base64; resolves.
- **AC**: ≥80% branch handler; SEC log sạch.

## T5 — FaceEventDto + webhook controller (code) — §4, R2, R4, SEC-02
- `dto/face-event.dto.ts`: R4 (`channelId @Type Number @IsInt`, `utc @IsISO8601`, required type/personUid, optional name/similarity/eventAction/imageBase64).
- `controllers/ivss-webhook.controller.ts`: `POST internal/ivss/events`, `@UseGuards(IvssInternalTokenGuard)` + ValidationPipe per-route; **R2**: try/catch quanh `handler.onFaceEvent` → **luôn ack** `{success,message,data:{accepted:true}}`.
- **AC**: body hợp lệ → handler gọi 1 lần + ack; handler throw → **vẫn ack** (R2); channelId '5'→5 (R4).

## T5b — Webhook controller test — R2, R4
- valid→handler 1 lần + accepted:true; handler reject→vẫn accepted:true (R2); channelId coerce number; guard wiring (IvssInternalTokenGuard metadata).
- **AC**: các ca xanh.

## T6 — Health controller (code) — OQ-6, SEC-02
- `controllers/ivss-health.controller.ts`: `GET ivss/health` admin-gated (`JwtAuthGuard+MockPermissionsGuard`, `@Permissions('ivss.health.read')`) → `client.status()` → `{bridge:'up'|'down',detail?}`.
- **AC**: status ok→`bridge:'up'`; status error→`bridge:'down'`; guard JwtAuthGuard wiring.

## T7 — Config + wiring (code) — §6/§7, R3
- `env.validation.ts` (scoped): `IVSS_BRIDGE_BASE_URL`/`IVSS_BRIDGE_TOKEN`/`IVSS_DEFAULT_GROUP`/`IVSS_BRIDGE_TIMEOUT_MS`. `.env.example`: 4 key.
- `ivss.module.ts`: factory→client (provide port token + export), guard, `DefaultIvssEventHandler` bind `IVSS_EVENT_HANDLER`, 2 controller; import ConfigModule(+Auth nếu cần). `app.module` import `IvssModule`.
- **R3 (optional)**: `main.ts` raise body-limit scoped path webhook (~10mb); rủi ro → defer + ghi residual.
- **AC**: build resolve DI; app.module có IvssModule; env validate default.

## T-GATE — (STOP, KHÔNG commit) — §9
- build=0; eslint touched+spec baseline-proof (stash app.module/env/main.ts) 0 rule mới, file mới 0; `npx jest src/modules/ivss` xanh; coverage ≥80% client+handler; DI-proof compile AppModule (Redis infra-fail OK, 0 circular/UnknownDependencies). **KHÔNG live.**
- **Owed (ghi, KHÔNG chạy gate)**:
  - live-runbook: client↔bridge thật (createGroup/enrollFace/deleteFace/status) + webhook round-trip khi sidecar chạy.
  - harden: rà lại secret `IVSS_BRIDGE_TOKEN` (rotate/độ dài), body-limit R3 nếu defer, seed permission `ivss.health.read`.
- **AC**: bảng gate đầy đủ + báo cáo: scope xong, IvssResult typed (bridge-down KHÔNG throw), guard secret = IVSS_BRIDGE_TOKEN (R1), webhook luôn ack (R2), channelId number/utc ISO (R4), coverage, DI-proof. STOP.

## Map task → scope #36
- T1/T2/T2b → IvssBridgeClient (outbound)
- T3/T3b/T5/T5b → webhook (inbound) + guard + DTO
- T4/T4b → handler port + default (OQ-3=A)
- T6 → health (OQ-6)
- T7 → config + module wiring
