# IRP-001 — PLAN (#40 realtime presence)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo plan IRP-001 (#40): hook sau persist matched → WebsocketService.emitToRoom (gate OFF default). OQ-3 WS auth TÁCH ticket (owed-blocker C2). RECON wiring: WebsocketModule export WebsocketService, KHÔNG circular. | Toàn bộ |

> **PLAN+TASKS only.** Chưa code. Spec ĐÃ DUYỆT. OQ KHÓA (KHÔNG mở lại): OQ-1 mirror infra · OQ-2=(A) inject WebsocketService · **OQ-3 WS auth TÁCH ticket riêng** · OQ-4 per-meeting · OQ-5 chỉ matched · OQ-6 không emit-test · OQ-7 broadcast SAU persist.

---

## 0. RECON wiring (T0 crux — ĐÃ chạy)
- **WebsocketService export**: [websocket.module.ts:21](../../../../src/modules/websocket/websocket.module.ts) `exports: [WebsocketService]` ✅. `imports: [ConfigModule]` thôi → KHÔNG phụ thuộc module nghiệp vụ.
- **Circular check**: WebsocketModule KHÔNG import IvssModule (chỉ ConfigModule). IvssModule import WebsocketModule ⇒ **một chiều, KHÔNG cycle, KHÔNG forwardRef**.
- **Hook point**: [ivss-presence-ingestion.service.ts](../../../../src/modules/ivss/services/ivss-presence-ingestion.service.ts) — sau INSERT iot_device_events (dòng ~108), trong nhánh `matchState === 'matched'`. Service hiện inject `DataSource` → thêm `WebsocketService` + `ConfigService`.
- **API broadcast**: `WebsocketService.emitToRoom(room, event, data)` ([websocket.service.ts:27](../../../../src/modules/websocket/websocket.service.ts)).
- **Subscribe**: EventsGateway hiện KHÔNG có `@SubscribeMessage` → thêm `ivss:subscribe`/`ivss:unsubscribe` (KHÔNG auth — owed C2).

---

## 1. ⚠️ OWED-BLOCKER (C2) — đọc trước khi bật prod
> **WS auth handshake là TIỀN-ĐIỀU-KIỆN bật `IVSS_REALTIME_ENABLED` trên prod.** WS hiện **vô danh** (handleConnection chỉ TODO JWT). Nếu bật realtime presence khi chưa auth → **rò vị trí/định danh cá nhân** cho bất kỳ client nào connect được. Vì vậy #40 **gate default OFF (C1)** và auth = **ticket riêng** (OQ-3 tách). KHÔNG bật `IVSS_REALTIME_ENABLED=true` trên prod cho tới khi ticket WS auth xong.

---

## 2. Thiết kế (folds C1–C4)

### 2.1. Hook trong IvssPresenceIngestionService (C2-arch ARCH-01)
Sau persist (KHÔNG đổi store logic #38/#39), thêm bước **chỉ khi matched + có meetingId**:
```
... INSERT iot_device_events (giữ nguyên) ...
if (matchState === 'matched' && meetingId) {
  if (this.config.get('IVSS_REALTIME_ENABLED') === true) {   // C1 gate
    void this.broadcastPresence({ meetingId, roomId, userId, ... });  // best-effort
  }
}
```
- `broadcastPresence` (private):
  - resolve `users.full_name` (1 query bind, SEC-03) — fullName optional.
  - build payload **C4** `{ meetingId, roomId, userId, fullName?, direction, matchState:'matched', at }` (at = eventTime.toISOString()). **KHÔNG** szUid/imageBase64/similarity (SEC-01/C4).
  - `try { this.ws.emitToRoom('ivss:meeting:'+meetingId, 'ivss.presence', payload) } catch (e) { log; }` — **C3 best-effort, KHÔNG throw/rollback**.
- ARCH-01: ingestion chỉ biết `WebsocketService` (boundary infra), KHÔNG EventsGateway/NetSDK. Chỉ HOOK sau persist.
- OQ-7: broadcast SAU persist thành công (cùng try ngoài cũng đã ôm; nếu INSERT fail → vào catch → KHÔNG tới broadcast).
- OQ-5: unmatched → KHÔNG emit (chỉ matched). meetingId null (không có họp đang diễn) → KHÔNG emit (per-meeting room vô nghĩa).

### 2.2. Subscribe handler (EventsGateway) — OQ-4
- `@SubscribeMessage('ivss:subscribe')` body `{ meetingId: string }` → validate uuid → `client.join('ivss:meeting:'+meetingId)`; ack `{ ok: true, room }`.
- `@SubscribeMessage('ivss:unsubscribe')` body `{ meetingId }` → `client.leave(...)`.
- **KHÔNG auth** (owed C2). KHÔNG đụng logic connect/disconnect hiện có.

### 2.3. Env gate (C1)
- `IVSS_REALTIME_ENABLED` Joi `boolean().default(false)` — scoped, wrap tay nếu dài, **KHÔNG prettier cả env.validation**.
- ConfigService đọc trong ingestion. Default false ⇒ subscribe vẫn đăng ký nhưng **emit gated OFF**.

### 2.4. Wiring (DI)
- `IvssModule.imports += WebsocketModule` (RECON: an toàn, no cycle).
- `IvssPresenceIngestionService` constructor: `+ WebsocketService, + ConfigService`. ConfigModule global → ConfigService inject sẵn (mirror các service khác).
- KHÔNG đổi binding `IVSS_EVENT_HANDLER` (vẫn useExisting IvssPresenceIngestionService).

---

## 3. Payload schema (C4 / SEC-01)
| field | nguồn | ghi chú |
|---|---|---|
| meetingId | resolved | bắt buộc (gate per-meeting) |
| roomId | channel-map | matched ⇒ có |
| userId | szUid→mapping | matched ⇒ có |
| fullName? | users.full_name (query) | optional, có thể null |
| direction | normalizeDirection | enter/leave/seen (owed eventAction thật) |
| matchState | 'matched' | luôn matched (OQ-5) |
| at | eventTime ISO | thời điểm event |
**KHÔNG**: szUid, imageBase64, similarity-thô.

---

## 4. Gate plan (STOP, no commit)
- `npm run build` = 0 error.
- **eslint per-file** (KHÔNG `npm run lint`): ingestion service, events.gateway, env.validation, ivss.module, + spec test files.
- **baseline-proof**: `git stash` (ingestion service + gateway + env.validation + ivss.module) → build/eslint baseline xanh → unstash. Chứng minh lỗi (nếu có) là của mình.
- **jest**: mock `WebsocketService.emitToRoom` — KHÔNG socket/thiết bị thật.
- **coverage ≥80%** phần mới (broadcastPresence + subscribe handler logic).
- **DI-proof**: compile AppModule throwaway `_di-proof.spec.ts` (Redis ECONNREFUSED = infra-OK; 0 circular/UnknownDependencies) → xóa sau.
- prettier `--write` chỉ file mới/đụng (KHÔNG env.validation).
- **KHÔNG live** (không bridge/WS round-trip thật).

---

## 5. Test strategy (mock — KHÔNG thiết bị)
Ingestion (inject mock ws + config):
- gate ON + matched + meetingId → `emitToRoom('ivss:meeting:<id>','ivss.presence', payload)` gọi đúng 1 lần; payload đúng + **KHÔNG szUid/imageBase64/similarity** (SEC-01/C4).
- **unmatched → KHÔNG emit** (OQ-5).
- **gate OFF (default) → KHÔNG emit** (C1).
- **meetingId null → KHÔNG emit**.
- **persist (INSERT) fail → KHÔNG emit** (OQ-7) — query mock throw.
- **emit throw → KHÔNG vỡ ingest** (C3) — onFaceEvent vẫn resolve, không reject.
- fullName: query trả null → payload.fullName null, vẫn emit.

Gateway:
- `ivss:subscribe {meetingId}` → `client.join('ivss:meeting:'+meetingId)` (mock socket).
- `ivss:unsubscribe` → `client.leave`.
- uuid sai → KHÔNG join (ack lỗi/no-op).

---

## 6. Kỷ luật
no-migration (chỉ +1 query đọc full_name) · SEC-01/C4 (payload KHÔNG szUid/ảnh/similarity) · SEC-02 (chưa-auth = owed-blocker C2; gate OFF C1) · SEC-03 (bind query fullName) · ARCH-01 (qua WebsocketService boundary, KHÔNG gateway/NetSDK; HOOK sau persist, KHÔNG đổi store #38/#39) · C3 (emit best-effort không vỡ ingest).

---

## 7. Owed sau #40
- **WS auth handshake ticket** (C2 blocker — TIỀN-ĐIỀU-KIỆN bật prod).
- **live-runbook**: WS round-trip thật (client subscribe → bridge event → ingest → broadcast → client nhận) khi bridge chạy.
- kế thừa owed: eventAction thật (direction) · channel-map thật (meetingId resolve) · szUid round-trip.
- multi-instance: socket.io redis-adapter (hiện single-instance) — ghi gap.

> **STOP sau plan+tasks.** Chờ duyệt rồi mới CODE (T0→T-GATE, STOP gate, KHÔNG commit).
