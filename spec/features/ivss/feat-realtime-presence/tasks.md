# IRP-001 — TASKS (#40 realtime presence)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo tasks IRP-001 (#40): atomic T0 RECON wiring → hook broadcast → subscribe handler → env gate → wiring → tests → gate. 1 AC/task, code/test tách. | Toàn bộ |

> Atomic, 1 AC/task. Code vs test TÁCH. OQ khóa (plan §0). Gate cuối STOP, **KHÔNG commit**.

---

### T0 — RECON wiring (DONE)
**AC**: xác nhận WebsocketModule export WebsocketService + KHÔNG circular với IvssModule.
**Kết quả**: export ✅ (websocket.module.ts:21); WebsocketModule chỉ import ConfigModule → một chiều, KHÔNG cycle, KHÔNG forwardRef. Hook point = sau INSERT, nhánh matched. ✅

---

### T1 — Env gate `IVSS_REALTIME_ENABLED` (C1)
**File**: `src/config/env.validation.ts` (scoped, wrap tay — KHÔNG prettier cả file).
**AC**: thêm `IVSS_REALTIME_ENABLED: Joi.boolean().default(false)`. Build pass.

### T2 — Subscribe handler trong EventsGateway (OQ-4, KHÔNG auth — owed C2)
**File**: `src/modules/websocket/events.gateway.ts`.
**AC**: `@SubscribeMessage('ivss:subscribe')` body `{meetingId}` validate uuid → `client.join('ivss:meeting:'+meetingId)` + ack `{ok,room}`; `ivss:unsubscribe` → `client.leave`. uuid sai → no-op/ack lỗi. KHÔNG đụng connect/disconnect cũ.

### T3 — Hook broadcast trong IvssPresenceIngestionService (C2-arch/C3/C4/OQ-5/OQ-7)
**File**: `src/modules/ivss/services/ivss-presence-ingestion.service.ts`.
**AC**: sau INSERT, nếu `matchState==='matched' && meetingId` và gate ON → gọi `broadcastPresence`. KHÔNG đổi store logic cũ.

### T4 — `broadcastPresence` private + resolve fullName (C4/SEC-01/SEC-03)
**File**: cùng ingestion service.
**AC**: query `users.full_name` (bind) → build payload `{meetingId,roomId,userId,fullName?,direction,matchState:'matched',at}` (KHÔNG szUid/ảnh/similarity) → `try{ ws.emitToRoom('ivss:meeting:'+meetingId,'ivss.presence',payload) }catch{ log }` (C3 không throw).

### T5 — Wiring DI (crux)
**Files**: `src/modules/ivss/ivss.module.ts` (+import WebsocketModule), ingestion constructor (+WebsocketService, +ConfigService).
**AC**: AppModule compile, 0 circular/UnknownDependencies (DI-proof).

### T6 — Test: ingestion broadcast (mock — KHÔNG thiết bị)
**File**: `...ivss-presence-ingestion.service.spec.ts` (mở rộng nếu có, hoặc mới).
**AC** (mỗi nhánh 1 assert): gate ON+matched+meetingId → emit đúng room+payload (KHÔNG szUid/ảnh/similarity) · unmatched→KHÔNG emit · gate OFF→KHÔNG emit · meetingId null→KHÔNG emit · INSERT fail→KHÔNG emit · emit throw→KHÔNG vỡ ingest · fullName null→vẫn emit.

### T7 — Test: gateway subscribe (mock socket)
**File**: `src/modules/websocket/events.gateway.spec.ts` (mới hoặc mở rộng).
**AC**: `ivss:subscribe` → `client.join('ivss:meeting:'+id)`; `ivss:unsubscribe`→`client.leave`; uuid sai→KHÔNG join.

### T-GATE — Gate (STOP, KHÔNG commit)
**AC**:
- build 0 error.
- eslint per-file: env.validation, events.gateway, ivss-presence-ingestion.service, ivss.module, 2 spec → 0.
- baseline-proof (stash 4 file code) xanh.
- jest spec mới xanh; coverage ≥80% phần mới.
- DI-proof xóa file throwaway.
- prettier --write file mới/đụng (KHÔNG env.validation).
- **STOP — KHÔNG commit.** Dán cây thay đổi + kết quả gate.
- **Owed ghi rõ**: (1) **WS auth ticket** (C2 blocker, tiền-điều-kiện bật prod) · (2) live-runbook WS round-trip · (3) kế thừa eventAction/channel-map/szUid · (4) multi-instance redis-adapter.

---

## Map scope #40
| Scope | Task |
|---|---|
| Hook sau persist matched → broadcast | T3, T4 |
| Subscribe per-meeting | T2 |
| Gate default OFF | T1 |
| Wiring WebsocketService→ingestion | T5 |
| Test mock | T6, T7 |
| Gate + owed | T-GATE |

> **STOP.** Chờ duyệt → CODE T0→T-GATE, STOP gate, KHÔNG commit.
