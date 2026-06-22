# IVS-001 — IVSS integration layer (#36, nửa NestJS): bridge client + event webhook + config

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-22 | Tạo spec IVS-001 (#36 nửa NestJS): IvssBridgeClient + webhook nhận event + config + health. Plumbing only (KHÔNG enroll #37, KHÔNG map presence #38–40). RECON code thật, no-migration. OQ chờ chốt. | Toàn bộ |

> **SPEC-ONLY.** Chưa plan/tasks/code. Phạm vi = lớp tích hợp (plumbing) cho IVSS bridge sidecar (Option A, Java NetSDK đã build). KHÔNG logic nghiệp vụ.

---

## 0. RECON findings (đã đọc code thật)

### 0.1. Outbound HTTP — Node `http`/`https` module (KHÔNG axios)
KHÔNG có `axios`/`@nestjs/axios`/`got`/`undici`/`node-fetch` trong repo (grep + package.json rỗng). Pattern outbound sẵn có = **FaceGate client** ([facegate.client.ts](../../../../src/modules/face-access/clients/facegate.client.ts)): dùng `import * as http` + `http.request(options, cb)` + `req.setTimeout(timeoutMs, …)`; tổ chức **port + client + config-factory**:
- Port interface ở `ports/` (vd `FaceDeviceProviderPort`), trả kiểu typed (`FaceGateResponse`) / lỗi typed (`FaceDeviceError`).
- Client impl ở `clients/`, nhận `deps` (baseUrl, timeoutMs, …) — KHÔNG tự đọc ConfigService.
- Factory ([face-device-provider.factory.ts:54](../../../../src/modules/face-access/face-device-provider.factory.ts)) đọc config (`FACEGATE_TIMEOUT_MS` v.v.) rồi dựng client.
- ⇒ **IvssBridgeClient mirror pattern này** (Node http, timeout config, typed result, bridge-down → typed error, KHÔNG throw vỡ flow).

### 0.2. InternalTokenGuard (tái dùng cho webhook)
[internal-token.guard.ts](../../../../src/modules/rooms/guards/internal-token.guard.ts): đọc env **`NOSHOW_INTERNAL_TOKEN`** (hard-code key), header **`X-Internal-Token`**, so sánh **constant-time** (`timingSafeEqual`), **fail-closed** (env rỗng / sai → 401), KHÔNG log token. Khớp đúng contract bridge (header `X-Internal-Token`). ⚠ Hiện key cố định `NOSHOW_INTERNAL_TOKEN` → tái dùng nguyên = **chia sẻ chung 1 secret** với no-show internal (xem OQ-2).

### 0.3. Config pattern
- **Infra config** (giống IVSS bridge): theo env, dựng qua factory — như `FACEGATE_TIMEOUT_MS` (env.validation Joi scoped + factory đọc). FaceGate baseUrl/creds đến từ device record (per-device); IVSS bridge là **1 sidecar duy nhất** → env hợp lý hơn per-device.
- **Tunable config** (ngưỡng vận hành): precedence `system_configs → env → default` (NoShowConfigService / readThreshold). IVSS base-url/token/group là infra → đề xuất **env** (xem OQ-5); nếu cần đổi runtime thì bọc thêm system_configs precedence như tunable.

### 0.4. Envelope + ValidationPipe
Chuẩn dự án: response thủ công `{ success, message, data }`; `@UsePipes(new ValidationPipe({ whitelist:true, transform:true }))` **per-route** (KHÔNG global pipe). Controller internal mẫu ([no-show.controller.ts](../../../../src/modules/rooms/controllers/no-show.controller.ts)): `@Controller()` + route `internal/...` + `@UseGuards(InternalTokenGuard)` + `@Res({passthrough:true})` set status.

### 0.5. OQ-3 feasibility (live read-only)
- **`ivss_events` KHÔNG tồn tại** (DB v3.2 Compact 39 bảng không có) → tạo bảng = **migration** (ngoài no-migration của #36).
- `iot_device_events` tồn tại nhưng **`device_id` NOT NULL** (`room_id`/`meeting_id`/`payload_json` nullable). ⇒ Lưu raw IVSS event vào `iot_device_events` **chỉ khả thi nếu** có `iot_devices` row cho bridge/từng channel (đăng ký thiết bị trước). Chưa có → option "persist raw" vướng ràng buộc này. (Chi tiết hệ quả ở OQ-3.)

### 0.6. No-migration
#36 **KHÔNG migration**. Nếu OQ-3 chốt cần bảng `ivss_events` → đó là việc của #38–40 (có migration riêng, được duyệt), KHÔNG làm trong #36; nếu buộc phải có cột/bảng mới → **DỪNG báo Thiếu Chủ**.

---

## 1. Bridge contract (cố định — từ README ivss-bridge)
- **NestJS → bridge (REST)**, header `X-Internal-Token`:
  - `POST /api/ivss/groups` — tạo group.
  - `POST /api/ivss/faces` — enroll face (person).
  - `DELETE /api/ivss/faces` — xoá face.
  - `GET /api/ivss/status` — trạng thái bridge/SDK.
- **bridge → NestJS (webhook)**, header `X-Internal-Token`, body:
  `{ type, channelId, personUid, name?, similarity?, eventAction?, utc, imageBase64? }`.

## 2. Scope #36 (plumbing) — KHÔNG nghiệp vụ
1. **IvssBridgeClient** (outbound): `createGroup` / `enrollFace` / `deleteFace` / `status`.
2. **Webhook endpoint** (inbound): `POST /api/v1/internal/ivss/events` — guard + validate DTO + bàn giao 1 handler (port).
3. **Config keys + health**.
4. **Module mới + wiring**.

KHÔNG thuộc #36: enroll person nghiệp vụ (#37); map event → presence/attendance (#38–40). Handler ở #36 chỉ là điểm cắm (port) + impl mặc định nhẹ (xem OQ-3).

## 3. IvssBridgeClient (port + client + factory)
- **Port** `IvssBridgePort` (ở `src/modules/ivss/ports/`):
  ```ts
  createGroup(input): Promise<IvssResult<...>>
  enrollFace(input): Promise<IvssResult<...>>
  deleteFace(input): Promise<IvssResult<...>>
  status(): Promise<IvssResult<IvssStatus>>
  ```
- **Result typed** (KHÔNG throw vỡ flow): `type IvssResult<T> = { ok: true; data: T } | { ok: false; error: IvssBridgeError }` với `IvssBridgeError = { code: 'BRIDGE_UNREACHABLE'|'BRIDGE_TIMEOUT'|'BRIDGE_HTTP_ERROR'|'BRIDGE_BAD_RESPONSE'; status?: number; message: string }`. Bridge-down/timeout → `ok:false` (caller quyết định), **KHÔNG** ném exception ra flow.
- **Transport**: Node `http`/`https` (mirror FaceGate), `req.setTimeout(timeoutMs)`, gắn header `X-Internal-Token` từ config; baseUrl từ config.
- **Deps** (factory đọc env): `{ baseUrl, token, timeoutMs }`. SEC-01: KHÔNG log token (chỉ log method/path/status khi debug).

## 4. Webhook endpoint
- **Route**: `POST /api/v1/internal/ivss/events` (system-to-system, KHÔNG JWT user).
- **Guard**: InternalTokenGuard-style, header `X-Internal-Token` (OQ-2: tái dùng guard chung vs guard IVSS riêng).
- **DTO** `FaceEventDto` (`whitelist:true, transform:true` per-route):
  - `type: string` (required), `channelId: string|number` (required), `personUid: string` (required), `utc: string` (required, ISO/epoch — validate format), `name?: string`, `similarity?: number`, `eventAction?: string`, `imageBase64?: string`.
  - SEC-01: `imageBase64` là dữ liệu lớn/nhạy cảm → **KHÔNG log**, KHÔNG đẩy vào audit; nếu cần lưu thì chỉ metadata (strip base64), giống `stripSanpPic` pattern.
- **Xử lý**: validate → bàn giao `IvssEventHandlerPort.onFaceEvent(normalizedDto)` → trả envelope `{success,message,data:{accepted:true}}` (202/200). Handler là điểm cắm cho #38–40 (xem OQ-3 cho hành vi #36).

## 5. Handler port (điểm cắm cho #38–40)
- `IVSS_EVENT_HANDLER` (Symbol token) + interface `IvssEventHandlerPort { onFaceEvent(evt): Promise<void> }` ở `src/common/ports/` (leaf, mirror `FACE_VERIFY_HOOK`/`STRANGER_ALERT_HOOK` NC-4 no-cycle).
- #36 cung cấp **default impl** (theo OQ-3): chỉ log/đếm (metadata-only) — defer mapping. #38–40 sẽ override bằng impl thật (provider `useExisting`).

## 6. Config keys + health
- **Config (đề xuất env, OQ-5)**: `IVSS_BRIDGE_BASE_URL`, `IVSS_BRIDGE_TOKEN` (outbound → bridge), `IVSS_DEFAULT_GROUP`, `IVSS_BRIDGE_TIMEOUT_MS` (default vd 8000, mirror FACEGATE), `IVSS_INTERNAL_TOKEN` (inbound webhook — nếu OQ-2 chọn token riêng). Joi scoped, KHÔNG prettier cả file. Map khái niệm: `ivss.bridge.base-url`→`IVSS_BRIDGE_BASE_URL`, `ivss.bridge.token`→`IVSS_BRIDGE_TOKEN`, `ivss.default-group`→`IVSS_DEFAULT_GROUP`.
- **Health**: `GET /api/v1/ivss/health` (admin-gated) → gọi `client.status()` → trả `{ bridge: 'up'|'down', detail? }`. Passive vs indicator riêng = OQ-6.

## 7. Module + wiring
- Module mới `src/modules/ivss/` (OQ-1): controller (webhook + health), `IvssBridgeClient` (+ factory), default `IvssEventHandler`, providers + export client cho #37/#38–40 dùng. Import `ConfigModule`. Đăng ký vào `app.module`.

## 8. Test (mock HTTP + mock guard — KHÔNG cần bridge/thiết bị)
- **IvssBridgeClient**: mock Node `http.request` (hoặc inject 1 transport seam) → giả lập 200/timeout/ECONNREFUSED/HTTP-500 → assert `IvssResult` typed (ok / error code đúng), KHÔNG throw. Mirror cách test FaceGate client.
- **Webhook controller**: mock handler port + (guard) — body hợp lệ → handler gọi 1 lần + envelope; body thiếu field → 400 (ValidationPipe); guard sai token → 401 (test guard riêng hoặc metadata wiring).
- **SEC**: assert log/handler payload KHÔNG chứa `imageBase64`/token.
- Coverage ≥80% file mới (client + handler).

## 9. Constitution
- **SEC-01**: token (bridge + internal) metadata-only, KHÔNG log; `imageBase64` KHÔNG log/audit.
- **SEC-02**: webhook + health là internal/admin-gated (InternalTokenGuard / JwtAuthGuard).
- **SEC-03**: nếu (theo OQ-3) có raw SQL lưu event → bind tham số; validate DTO ở boundary.
- **DATA-01**: no-migration (#36). Không tạo `ivss_events` trong #36.
- **ARCH-01**: IVSS là module riêng; client/handler qua port boundary; #36 KHÔNG chạm presence/attendance/booking (để #38–40). KHÔNG đọc NetSDK trực tiếp trong NestJS (bridge lo).
- Envelope thủ công `{success,message,data}`; ValidationPipe per-route.

## 10. OPEN QUESTIONS (chốt trước plan/tasks)
- **OQ-1**: module **mới `ivss`** (đề xuất) hay nhét vào `face-access`? (đề xuất mới — IVSS là nguồn/đời sống riêng, tránh phình face-access.)
- **OQ-2**: webhook auth — **tái dùng `InternalTokenGuard`** (chung secret `NOSHOW_INTERNAL_TOKEN`, đơn giản) hay **guard IVSS riêng** đọc `IVSS_INTERNAL_TOKEN` (tách blast-radius, secret riêng cho bridge)? (đề xuất guard riêng — bridge là bên thứ 3, nên secret tách.)
- **OQ-3 (crux)**: ở #36 xử event tới đâu?
  - **(A) receive + validate + log/đếm** (defer persist + mapping cho #38–40). Không-migration sạch, plumbing thuần. **Đề xuất cho #36.**
  - **(B) persist raw vào `iot_device_events`** — ⚠ vướng `device_id NOT NULL` (RECON 0.5): cần đăng ký bridge/channel thành `iot_devices` trước → kéo theo scope ngoài #36.
  - **(C) bảng `ivss_events` mới** = **migration** → KHÔNG thuộc #36 (để #38–40 có migration được duyệt). Nếu chốt C → DỪNG, làm ở ticket có migration.
- **OQ-4**: client HTTP — xác nhận dùng **Node `http`/`https`** (RECON 0.1, KHÔNG thêm axios). (đề xuất theo lib sẵn có.)
- **OQ-5**: config ở **env** (đề xuất, infra 1-sidecar) hay `system_configs` precedence (nếu cần đổi runtime)?
- **OQ-6**: health — **passive** (gọi `client.status()` khi hit endpoint) hay **indicator/endpoint riêng** (Nest Terminus health-check)? (đề xuất passive endpoint `GET /ivss/health` cho v1.)

## 11. Residuals / known-gaps
- **Live-runbook owed**: client ↔ bridge thật (createGroup/enrollFace/deleteFace/status) + webhook round-trip chỉ chứng minh được khi bridge sidecar chạy; #36 chỉ test bằng mock HTTP. Chạy khi bridge sẵn sàng.
- `imageBase64` có thể rất lớn → cân nhắc giới hạn body size cho webhook route (defer nếu chưa cần).
- Idempotency/dedupe event (cùng event gửi lại) — để #38–40 khi có chỗ lưu.
- Time-skew `utc` từ bridge (giống device callbacks) — validate/normalize ở #38–40 khi map thời gian.
- Nếu OQ-2 chọn tái dùng guard chung: guard hiện hard-code `NOSHOW_INTERNAL_TOKEN` → muốn dùng cho IVSS phải generalize guard (nhận key) — ghi rõ khi plan.

> **STOP.** Spec-only. Chờ Thiếu Chủ review + chốt OQ-1…OQ-6 trước khi plan/tasks.
