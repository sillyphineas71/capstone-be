# TKR-001 — plan.md (Thu hồi / xoay token face-server)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo plan TKR-001 (#11): helper `assertCallbackToken` gom 3 handler + revoke + rotate (hướng A). No migration, no module/env mới. | Toàn bộ |

## 0. Scope đã chốt
- **Revoke + Rotate (hướng A) + helper chung** `assertCallbackToken`.
- KHÔNG migration (tái dùng jsonb `metadata_json.face_server_config`). KHÔNG module mới. KHÔNG env mới.
- Endpoint + service method đặt **cạnh `configureFaceServer`** trong iot-devices controller/service.

## 1. RECON xác nhận (đọc KHÔNG sửa)
3 handler token-check **giống hệt shape** (đã đọc dòng nguồn):
- `receiveHeartbeat` ([:1101-1126](../../../../src/modules/iot/services/iot-devices.service.ts))
- `receiveVerifyEvent` ([:1254-1279](../../../../src/modules/iot/services/iot-devices.service.ts))
- `receiveStrangerEvent` ([:1532-1557](../../../../src/modules/iot/services/iot-devices.service.ts))

Mỗi block (sau khi đã resolve `faceConfig` + lấy `callbackToken`):
```ts
if (!faceConfig.callback_token_hash)
  throw new ConflictException({ code: 'CALLBACK_TOKEN_NOT_CONFIGURED', ... });   // 409
const incomingHash = sha256(callbackToken).hex;
// Buffer compare length + timingSafeEqual
if (len mismatch || !timingSafeEqual(...))
  throw new UnauthorizedException({ code: 'INVALID_CALLBACK_TOKEN', ... });       // 401
```
→ **3 block đồng nhất mã + shape ⇒ AN TOÀN rút helper** (điều kiện ở T1 đã thoả). `configureFaceServer` token-gen tại [:730-748](../../../../src/modules/iot/services/iot-devices.service.ts).

## 2. Helper `assertCallbackToken(faceConfig, incomingToken): void`
- Private method trong `IotDevicesService`. Gói **3 bước** đúng thứ tự:
  1. `!callback_token_hash` → `ConflictException(CALLBACK_TOKEN_NOT_CONFIGURED)` (giữ mã cũ).
  2. **MỚI**: `faceConfig.revoked_at` truthy → `ForbiddenException(CALLBACK_TOKEN_REVOKED)` (403).
  3. sha256 + Buffer length + `timingSafeEqual` → sai → `UnauthorizedException(INVALID_CALLBACK_TOKEN)` (giữ mã cũ).
- **Thứ tự revoked TRƯỚC timingSafeEqual**: token đã thu hồi thì reject ngay dù token đúng/sai (đỡ lộ tính hợp lệ token cũ).
- 3 handler thay block inline (bước not-configured + compare) bằng `this.assertCallbackToken(faceConfig, callbackToken);`. **Giữ nguyên** các bước khác trong handler (token-required, allowed_source_ip, store raw, business). KHÔNG đổi chữ ký/luồng handler.
- **Regression-guard (T1)**: nếu trong lúc code phát hiện 1 handler lệch (biến tên `callbackToken` khác, thêm/bớt bước) → **giữ inline handler đó, chỉ chèn revoked-gate** (`if (faceConfig.revoked_at) throw Forbidden(...)`) trước compare, ghi chú lý do trong code + tasks. (RECON hiện tại: cả 3 khớp → dự kiến thay cả 3.)

## 3. Revoke
- **Endpoint**: `POST /api/v1/iot-devices/:id/face-server/revoke` — admin-only (JwtAuthGuard + PermissionsGuard, **SEC-02**), pattern guard nhất quán controller iot hiện có. Permission: tái dùng `iot_devices:configure_face_server` (hoặc `face.token.revoke` nếu tách — chốt ở T5; mặc định tái dùng configure).
- **DTO**: `RevokeFaceServerTokenDto { reason?: string }` (optional, max length hợp lý).
- **Service** `revokeFaceServerToken(adminId, deviceId, dto)`:
  1. Load device (`findOne`); không tồn tại / `device_type != face_server` → `NotFoundException` / `ConflictException`.
  2. `faceConfig = metadata_json.face_server_config`; thiếu `callback_token_hash` → **409 `FACE_SERVER_NOT_CONFIGURED`** (không có gì để thu hồi).
  3. **Idempotent**: nếu `revoked_at` đã set → trả 200, **KHÔNG đổi** `revoked_at`/audit-noop (hoặc audit `already_revoked` flag — đơn giản: return device, không ghi đè).
  4. Set `faceConfig.revoked_at = new Date().toISOString()` (+ `revoked_reason = dto.reason` nếu có); `metadata_json.face_server_config = faceConfig`.
  5. Persist: `UPDATE iot_devices SET metadata_json = :json WHERE id = :id` qua TypeORM `save(device)` (hoặc QB update jsonb) — **jsonb, no migration**.
  6. Audit `face.token.revoke` (actor=adminId, deviceId, có/không reason — **KHÔNG** ghi token/hash).
- **Reject callback**: nhờ helper bước 2 ⇒ verify/stranger/heartbeat sau revoke đều 403 `CALLBACK_TOKEN_REVOKED`.

## 4. Rotate (hướng A)
- **Endpoint**: `POST /api/v1/iot-devices/:id/face-server/rotate` — admin-only (SEC-02). KHÔNG body (hoặc rỗng).
- **Service** `rotateFaceServerToken(adminId, deviceId)`:
  1. Load device + validate face_server (như revoke).
  2. Thiếu `callback_token_hash` (chưa từng config) → **409 `FACE_SERVER_NOT_CONFIGURED`** (rotate cần đã config; tạo mới dùng `configureFaceServer`).
  3. **Tái dùng token-gen** của `configureFaceServer` ([:730-735]): `plainToken = randomBytes(16).base64url` → `callback_token_hash = sha256(hex)`, `callback_token_last4 = slice(-4)`.
  4. Cập nhật trong `faceConfig`: hash + last4 mới, **`configured_at = now`**, **`revoked_at = undefined` (clear)** + clear `revoked_reason`. Giữ nguyên các field config khác (paths/allowed_ip/enabled).
  5. Persist `save(device)`.
  6. Audit `face.token.rotate` (actor, deviceId — **KHÔNG** token/hash).
  7. Trả `{ device, oneTimeCallbackToken: plainToken }` (plaintext **1 lần**, như configure). Token cũ chết (hash đã thay) → callback token cũ → 401.
- Cân nhắc: rút token-gen thành helper nhỏ `generateCallbackToken()` để configure+rotate dùng chung (tùy chọn, không bắt buộc nếu copy 3 dòng rõ ràng).

## 5. Không làm
- KHÔNG migration; KHÔNG `token_version`/lịch sử token; KHÔNG env mới; KHÔNG module mới.
- KHÔNG log plaintext/hash ở mọi nhánh (revoke/rotate/helper).
- KHÔNG đổi business của verify/stranger ngoài việc chèn revoked-gate.

## 6. File đụng tới
- `src/modules/iot/services/iot-devices.service.ts` — helper + 3 handler + `revokeFaceServerToken` + `rotateFaceServerToken`.
- `src/modules/iot/controllers/iot-devices.controller.ts` — 2 endpoint cạnh `configureFaceServer`.
- `src/modules/iot/dto/revoke-face-server-token.dto.ts` — **MỚI** (reason optional).
- `src/modules/iot/services/iot-devices.service.spec.ts` — tests (T6).
- (Audit) tái dùng `IotAuditRepository` nếu có method phù hợp; nếu thiếu → thêm `logTokenRevoke/logTokenRotate` cùng pattern các `log*` hiện có (no schema change — ghi vào `audit_logs`).

## 7. Risk
- Rút helper có thể đổi nhẹ coverage 3 handler → T6 phải phủ lại configured/không + valid/invalid/revoked cho ít nhất verify+stranger.
- jsonb update phải nhắm đúng path `metadata_json.face_server_config` (T7 live SELECT xác nhận path trước khi tin UPDATE).
