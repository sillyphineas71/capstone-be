# IRP-001 — IVSS realtime per-person presence (#40): đẩy presence event qua WebSocket

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-23 | Tạo spec IRP-001 (#40): hook sau ingest (matched) → broadcast realtime presence qua WS. WS infra ĐÃ CÓ (no blocker). Auth WS + room-subscribe hiện là stub → #40 hiện thực tối thiểu. RECON code thật. OQ chờ chốt. | Toàn bộ |

> **SPEC-ONLY.** Chưa plan/tasks/code. Chỉ thêm "ống realtime" song song — **KHÔNG thay store** (IPI-001 #38/#39 giữ nguyên), KHÔNG đụng #41/#42/#43. Hook SAU khi persist.

---

## ✅ KHÔNG có BLOCKER dependency
WS infra **đã có sẵn** (RECON 0.1) → **KHÔNG thêm lib** (khác #43 pdfkit). Mirror gateway + `WebsocketService` hiện có.

---

## 0. RECON findings (đọc CODE THẬT)

### 0.1. WS infra — ĐÃ CÓ (crux, no blocker)
- `package.json`: **`@nestjs/websockets`** + **`@nestjs/platform-socket.io`** + **`socket.io`** (đều có sẵn).
- `src/modules/websocket/`: **`EventsGateway`** ([events.gateway.ts](../../../../src/modules/websocket/events.gateway.ts)) — Socket.IO gateway (`path: /ws`, CORS theo env), lifecycle connect/disconnect. **`WebsocketService`** ([websocket.service.ts:27](../../../../src/modules/websocket/websocket.service.ts)): `emitToRoom(room, event, data)` (`server.to(room).emit`), `emitToUser(userId,…)` (`room user:<id>`), `emitToAll`.
- Đã dùng rộng: stranger-alert/no-show/early-vacancy inject `WebsocketService.emitToRoom`. ⇒ **mirror, KHÔNG thêm dependency.**

### 0.2. WS auth — CHƯA hiện thực (stub)
`EventsGateway.handleConnection` ([:53-57](../../../../src/modules/websocket/events.gateway.ts)): **TODO "Validate JWT nếu WS_AUTH_REQUIRED=true"** — chưa có code xác thực handshake. WS hiện **không auth** (ai cũng connect được). ⇒ #40 phải **hiện thực auth handshake tối thiểu** (mirror JwtAuthGuard logic) — net-new (không phải dependency).

### 0.3. Subscribe/room-join — CHƯA có handler
Gateway **không có** `@SubscribeMessage('…')` để client `join` room. `emitToRoom('room:X', …)` phát tới socket.io-room `room:X` nhưng **client chưa có cách JOIN** → hiện không ai nhận. ⇒ #40 phải thêm **subscribe handler** (`client.join('<scope>')`) — net-new gateway code.

### 0.4. Hook point từ ingestion
`IvssPresenceIngestionService.onFaceEvent` (IPI-001): sau khi persist matched → hiện **chỉ log**. Để broadcast cần điểm nối. **`@nestjs/event-emitter` KHÔNG có** trong package.json ⇒ decouple bằng EventEmitter = thêm dep. Pattern decouple sẵn có trong repo = **inject `WebsocketService`** (generic infra service, 3+ service đã dùng) HOẶC **port/hook leaf** (mẫu IVSS_EVENT_HANDLER/FACE_VERIFY_HOOK). → OQ-2.

### 0.5. NotificationsService realtime
`NotificationChannel.WEBSOCKET` tồn tại nhưng push realtime thực tế = qua `WebsocketService.emitToRoom` (notifications enqueue email/in-app, không phải kênh presence). **KHÔNG tái dùng trực tiếp** cho presence (payload khác) — dùng chung hạ tầng `WebsocketService`/gateway thôi.

### 0.6. fullName + payload
Ingestion có `userId` (matched). `fullName` cần resolve `users.full_name` (1 query nhẹ) — ingestion hoặc broadcaster lo. Payload client **KHÔNG** szUid/imageBase64 (SEC-01).

---

## 1. Scope #40
1. **Hook**: khi face event ingest **matched** (có userId+roomId) → phát realtime (SAU persist — OQ-7).
2. **Broadcast** tới client đang theo dõi scope (room/meeting — OQ-4): payload `{ meetingId, roomId, userId, fullName?, direction, matchState, at }`.
3. **Gateway**: thêm subscribe handler (client join scope) + auth handshake (hiện thực stub 0.2/0.3).

KHÔNG: duration/timeline (#41/#42), thay ingestion store logic (chỉ HOOK sau persist), report (#43).

## 2. Hook ingestion → broadcast (OQ-2 decouple)
- IPI-001 ingestion **KHÔNG được biết gateway** (ARCH-01). Lựa chọn (OQ-2):
  - **(A) inject `WebsocketService`** vào ingestion → sau persist matched → `emitToRoom(scope, 'ivss.presence', payload)` (mirror stranger-alert/no-show — pattern sẵn có, ít ceremony). `WebsocketService` là boundary infra, không phải gateway trực tiếp.
  - **(B) port/hook leaf** `IVSS_PRESENCE_BROADCASTER` (interface ở common/ports, mẫu IVSS_EVENT_HANDLER) → ingestion gọi hook → impl broadcaster dùng `WebsocketService`. Decouple chặt hơn, không-op nếu chưa bind.
  - **(C) `@nestjs/event-emitter`** (thêm dep) → emit event → `@OnEvent` listener broadcast. Decouple nhưng **thêm dependency**.
- Đề xuất **(A)** (nhất quán codebase, không thêm dep, ingestion chỉ biết `emitToRoom` generic). Best-effort: lỗi emit KHÔNG vỡ ingest (try/catch, mirror các service khác).

## 3. Gateway: subscribe + auth (OQ-3/4)
- **Subscribe** (OQ-4): `@SubscribeMessage('ivss:subscribe')` → body `{ meetingId }` (per-meeting đề xuất) → `client.join('ivss:meeting:<meetingId>')`. (Per-room là tùy chọn OQ-4.) Có `ivss:unsubscribe`.
- **Auth handshake (OQ-3)**: hiện thực stub 0.2 — handshake gửi JWT (`handshake.auth.token` / query) → verify (mirror `JwtAuthGuard`: JwtService + RedisService blacklist + AuthConfigService) → gắn `client.data.user`. Sai/thiếu → `client.disconnect()`. Ai nghe scope nào: **admin-gated v1** (mirror endpoint khác) HOẶC user chỉ join meeting mình dự (kiểm `meeting_participants`) — chốt OQ-3.
- Broadcast: `emitToRoom('ivss:meeting:<meetingId>', 'ivss.presence', payload)`.

## 4. Payload (SEC-01)
`{ meetingId, roomId, userId, fullName?, direction: 'enter'|'leave'|'seen', matchState: 'matched', at: ISO }`. **KHÔNG** `szUid`, **KHÔNG** `imageBase64`, không similarity-thô nếu nhạy cảm (cân nhắc). SEC-01: client chỉ thấy định danh user nội bộ + hướng + thời điểm.

## 5. Ordering (OQ-7)
Broadcast **SAU khi persist thành công** (consistency — không phát nếu persist fail). Trong `onFaceEvent`: persist → (matched) resolve fullName → emit. Emit best-effort (lỗi emit log, không rollback/không vỡ ingest).

## 6. Test (mock — KHÔNG thiết bị/bridge)
- **Hook**: mock `WebsocketService.emitToRoom` (hoặc broadcaster) → gọi `onFaceEvent(evt matched giả)` → assert `emitToRoom('ivss:meeting:<id>', 'ivss.presence', payload)` gọi đúng 1 lần với payload đúng; **unmatched → KHÔNG emit** (OQ-5); persist fail → KHÔNG emit (OQ-7); emit lỗi → KHÔNG vỡ ingest.
- **SEC-01**: payload assert KHÔNG chứa szUid/imageBase64.
- **Gateway**: subscribe handler → `client.join` gọi đúng scope; auth sai → disconnect (mock socket); (smoke — không cần socket thật).
- **OQ-6 no-event**: WS hoạt động độc lập event thật → test emit giả qua service (không cần bridge).
- Coverage ≥80% phần mới (broadcaster/hook + gateway handler logic).

## 7. Constitution
- **SEC-01**: payload client KHÔNG szUid/imageBase64 — chỉ metadata (userId/fullName/direction/at).
- **SEC-02**: WS auth handshake (JWT) — không cho client vô danh nghe presence; scope-gating (OQ-3).
- **ARCH-01**: ingestion **KHÔNG biết gateway** — qua `WebsocketService` (boundary infra) hoặc port-hook (OQ-2); KHÔNG NetSDK; chỉ HOOK sau persist (KHÔNG đổi store logic #38/#39).
- **DATA-01**: no-migration (realtime, không ghi DB mới ngoài 1 query đọc fullName).
- **DEP**: KHÔNG thêm dependency (WS infra sẵn có); nếu OQ-2 chọn (C) event-emitter → mới cần duyệt — đề xuất tránh.

## 8. OPEN QUESTIONS (chốt trước plan/tasks)
- **OQ-1 (crux) WS infra**: **(a) ĐÃ CÓ → mirror** `WebsocketService`/gateway, **KHÔNG thêm lib** [xác nhận — RECON 0.1]. (Không có nhánh (b) blocker.) Chốt: mirror.
- **OQ-2 hook decouple**: **(A) inject `WebsocketService`** [đề xuất — nhất quán codebase, no dep] vs (B) port-hook leaf `IVSS_PRESENCE_BROADCASTER` (decouple chặt) vs (C) `@nestjs/event-emitter` (thêm dep — tránh). Chốt A/B.
- **OQ-3 auth WS + scope-gating**: hiện thực JWT handshake (mirror JwtAuthGuard) [bắt buộc — hiện stub]. Ai nghe: **admin nghe mọi meeting** [đề xuất v1, mirror endpoint admin] vs user chỉ nghe meeting mình dự (`meeting_participants`)? Mức auth handshake làm tới đâu v1 (full verify + blacklist vs verify chữ ký cơ bản)?
- **OQ-4 subscribe scope**: **per-meeting** (`ivss:meeting:<id>`) [đề xuất] vs per-room vs cả hai.
- **OQ-5 chỉ matched**: chỉ broadcast **matched** [đề xuất] (unmatched vô nghĩa client). Xác nhận.
- **OQ-6 no-event/test**: WS hoạt động độc lập event thật — test bằng emit giả qua service. Có cần endpoint admin "emit test presence" để QA round-trip không? (đề xuất KHÔNG — test bằng mock; live-runbook dùng bridge thật).
- **OQ-7 persist-then-broadcast**: broadcast **SAU persist thành công** [đề xuất, consistency] vs song song best-effort. Xác nhận.

## 9. Residuals / known-gaps
- **Live-runbook owed**: WS round-trip thật (client subscribe → bridge gửi event → ingest → broadcast → client nhận) chỉ chứng minh khi bridge chạy; #40 test bằng mock. Cùng owed kế thừa: **eventAction thật** (direction), **channel-map thật** (meeting_id resolve), **szUid round-trip** (matched mới broadcast).
- WS auth hiện stub → #40 hiện thực; nếu scope auth lớn (full JWT+blacklist+participant-gating) có thể tách thành hardening riêng — chốt OQ-3 mức v1.
- `WS_AUTH_REQUIRED`/`WS_ENABLED` env đã có — tôn trọng (gate disabled).
- direction còn defensive (IPI-001) → realtime "enter/leave" có thể là "seen" phần lớn giai đoạn đầu — client hiển thị rõ.
- Không lưu lịch sử broadcast (realtime thuần) — client miss khi offline; #41/#42 store là nguồn truy vết.
- Scale multi-instance: socket.io cần adapter (redis) để broadcast cross-instance — hiện single-instance; ghi gap (giống các cron in-instance).

> **STOP.** Spec-only. Chờ Thiếu Chủ review + chốt OQ-2 (hook decouple) + OQ-3 (auth/scope mức v1) + OQ-4…7, rồi mới plan/tasks.
