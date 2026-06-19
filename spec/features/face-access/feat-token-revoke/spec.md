# TKR-001 — Thu hồi / xoay token face-server (token revoke/rotate)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo spec TKR-001 (Face-access #11): revoke token callback face-server (set revoked_at trong jsonb → mọi callback REJECT) + rotate [NEEDS CLARIFICATION]. KHÔNG migration (tái dùng face_server_config). | Toàn bộ |

## 1. Mục tiêu
Admin cần **thu hồi** (vô hiệu) token callback của một Face Terminal khi token bị lộ/đổi thiết bị, và (tùy chọn) **xoay** (sinh token mới). Hiện `configureFaceServer` sinh token 1 lần nhưng **không có cách vô hiệu** token đã cấp (ngoài việc cấu hình lại toàn bộ). TKR-001 (MVP):
1. **Revoke**: endpoint admin set `revoked_at` trong `face_server_config` → **mọi callback (verify + stranger [+ heartbeat]) bị REJECT** khi `revoked_at != null`.
2. **Rotate**: sinh token mới + clear revoked — **[NEEDS CLARIFICATION]** làm MVP hay tách ticket (§6).

**DATA-01: KHÔNG migration** — tái dùng `metadataJson.face_server_config` (jsonb), chỉ thêm field `revoked_at`/`revoked_reason`. **SEC-02 admin-only.** Token vẫn `timingSafeEqual`; **KHÔNG log plaintext/token**. KHÔNG phá verify/stranger đang chạy.

> Lưu ý NC-1: revoke **deny ở tầng AUTH callback** (backend từ chối nhận callback của device) — KHÁC "deny cửa theo điểm danh" (NC-1). Đây là hành động bảo mật hợp lệ, không vi phạm NC-1.

## 2. RECON (đã đọc, KHÔNG sửa)
- **`configureFaceServer`** ([iot-devices.service.ts:693-784](../../../../src/modules/iot/services/iot-devices.service.ts)): sinh `plainToken = crypto.randomBytes(16).toString('base64url')` → `tokenHash = sha256(plainToken).hex`, `tokenLast4 = plainToken.slice(-4)`, `configured_at`. Lưu vào `device.metadataJson.face_server_config`:
  ```ts
  {
    callback_enabled, callback_protocol, callback_base_url,
    heartbeat_path, verify_path, stranger_path, allowed_source_ip,
    callback_token_hash,      // SHA-256 hex
    callback_token_last4,
    configured_at,
  }
  ```
  Trả `{ device, oneTimeCallbackToken: plainToken }` (plaintext chỉ trả 1 lần).
- **Token verify — INLINE ở 3 handler (KHÔNG có guard chung)**:
  - `receiveHeartbeat` (~[:1102-1123](../../../../src/modules/iot/services/iot-devices.service.ts)),
  - `receiveVerifyEvent` (~[:1255-1276](../../../../src/modules/iot/services/iot-devices.service.ts)),
  - `receiveStrangerEvent` (~[:1533-1554](../../../../src/modules/iot/services/iot-devices.service.ts)).
  Mỗi chỗ: `if (!faceConfig.callback_token_hash)` → `CALLBACK_TOKEN_NOT_CONFIGURED`; tính `incomingHash = sha256(token)`; `crypto.timingSafeEqual(incomingBuf, storedBuf)` → sai → `INVALID_CALLBACK_TOKEN` (401). **Lặp 3 lần, không tách helper.**
- **`revoked_at` / `token_version` / `revoked_reason`: CHƯA CÓ** (grep rỗng) — sẽ thêm vào jsonb (no migration).

## 3. Functional Requirements (EARS)

### 3.1. Revoke
- **FR-TKR-001-001**: Endpoint `POST /api/v1/iot-devices/:id/face-server/revoke` — **admin-only** (`JwtAuthGuard` + `@Permissions('iot_devices:configure_face_server')` — tái dùng permission cấu hình face-server, hoặc `'face.token.revoke'` riêng; chốt khi tasks). Body optional `{ reason?: string }`.
- **FR-TKR-001-002**: Validate device tồn tại + `device_type='face_server'` + đã có `face_server_config.callback_token_hash` (đã configure). Thiếu → lỗi (§4 edge).
- **FR-TKR-001-003**: Set `face_server_config.revoked_at = now()` (+ `revoked_reason = reason` nếu có), giữ nguyên các field khác; `save(device)`. Ghi **`audit_logs`** (action `face.token.revoke`, actor=adminId). **KHÔNG** xoá `callback_token_hash` (để audit/last4 còn truy vết) — chỉ `revoked_at` quyết định.
- **FR-TKR-001-004** (reject callback): tại **mỗi** chỗ token check (verify + stranger **bắt buộc**; heartbeat **nên**), thêm gate **trước/ngay** `timingSafeEqual`:
  ```
  if (faceConfig.revoked_at) → ForbiddenException(code 'CALLBACK_TOKEN_REVOKED')  // 403
  ```
  Đặt sau khi resolve `faceConfig`, KHÔNG đổi logic token cũ. (Cân nhắc tách 1 private helper `assertCallbackTokenValid(faceConfig, token)` để gom 3 chỗ — tùy chọn, không bắt buộc MVP.)
- **FR-TKR-001-005**: Mã lỗi `CALLBACK_TOKEN_REVOKED` (403) tách khỏi `INVALID_CALLBACK_TOKEN` (401) để admin phân biệt "đã thu hồi" vs "token sai".

### 3.2. Rotate — [NEEDS CLARIFICATION] (§6)
- **FR-TKR-001-006**: xem §6 — chốt hướng trước khi tasks.

### 3.3. Ràng buộc
- **FR-TKR-001-007**: token vẫn so `timingSafeEqual`; revoke chỉ là **gate THÊM**. KHÔNG log plaintext/token/hash. SEC-03 (nếu có raw SQL) parameterized; ở đây dùng `save(IoTDeviceEntity)` (TypeORM) như `configureFaceServer`.
- **FR-TKR-001-008**: KHÔNG migration; KHÔNG đổi struct verify/stranger ngoài việc chèn gate revoked.

## 4. Edge cases (ý định test — chi tiết để tasks)
- **revoke khi chưa config** (`face_server_config` null / `callback_token_hash` null): **409** `FACE_SERVER_NOT_CONFIGURED` (không có gì để thu hồi). (Thay thế: 404 hoặc no-op 200 — chốt khi review; đề xuất 409.)
- **double-revoke** (đã `revoked_at != null`): **idempotent** → 200, **giữ nguyên `revoked_at` gốc** (không refresh), không lỗi.
- **verify/stranger SAU revoke** (`revoked_at != null`): **REJECT 403** `CALLBACK_TOKEN_REVOKED` (dù token đúng).
- **verify/stranger TRƯỚC revoke** (`revoked_at == null`): **PASS** (logic cũ).
- **device không phải face_server / không tồn tại**: 404/409 ở revoke endpoint.

## 5. Acceptance Criteria
- **AC-001**: POST revoke (device đã config) → `face_server_config.revoked_at` set, audit ghi; 200.
- **AC-002**: revoke có `reason` → `revoked_reason` lưu.
- **AC-003**: verify callback SAU revoke (token đúng) → **403** `CALLBACK_TOKEN_REVOKED` (không tạo attendance).
- **AC-004**: stranger callback SAU revoke → **403** (không cảnh báo).
- **AC-005**: verify/stranger khi `revoked_at == null` → PASS như cũ (không hồi quy).
- **AC-006**: double-revoke → 200 idempotent, `revoked_at` không đổi.
- **AC-007**: revoke khi chưa config → 409 (hoặc theo chốt §4).
- **AC-008**: revoke không phải admin → 401/403 (guard).
- **AC-009** (SEC): response/log KHÔNG chứa plaintext token/hash.

## 6. [NEEDS CLARIFICATION] — Rotate có làm MVP không?
| Hướng | Mô tả | Ưu / Nhược |
|---|---|---|
| **(A) Làm rotate trong MVP** | Endpoint `POST /api/v1/iot-devices/:id/face-server/rotate` → sinh `plainToken` mới + `callback_token_hash`/`last4` mới + **clear `revoked_at`** + `configured_at` cập nhật; trả `oneTimeCallbackToken` (như configure). Token cũ chết (hash thay). Tái dùng logic sinh token của `configureFaceServer` nhưng **chỉ đổi token**, giữ nguyên các field config khác (verify_path/allowed_ip…). | + Trọn vẹn vòng đời (thu hồi → xoay lại). + Không cần truyền full DTO config. − Thêm endpoint + test. |
| **(B) Defer — dùng `configureFaceServer` sẵn có** | MVP chỉ **revoke**. Muốn token mới → gọi lại `configureFaceServer` (đã sinh token mới + ghi đè `face_server_config` → mới không có `revoked_at` ⇒ tự un-revoke). | + Không thêm code. − Phải truyền lại full DTO config (callback_path/allowed_ip…); dễ mất field nếu DTO thiếu; un-revoke ngầm khó audit. |

→ **Đề xuất (A)** (rotate-token-only, clean, clear revoked_at, audit rõ). Chờ Thiếu Chủ chốt; nếu (B) thì §3.2 + endpoint rotate bỏ.

## 7. Out of scope
- `token_version` / lịch sử nhiều token (chỉ 1 hash sống) — defer.
- Tự động rotate theo lịch — defer.
- Thông báo cho device khi revoke (device tự vận hành local) — ngoài phạm vi backend.

> Trạng thái: **CHỜ REVIEW spec** (đặc biệt chốt §6 rotate). Chưa plan/tasks/code.
