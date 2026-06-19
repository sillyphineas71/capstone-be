# TKR-001 — tasks.md (Thu hồi / xoay token face-server)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-19 | Tạo tasks TKR-001 (#11): T1 helper + T2 revoke + T3 rotate + T4 DTO + T5 wiring + T6 tests + T7 gate. | Toàn bộ |

> Scope chốt: **Revoke + Rotate (A) + helper chung**. No migration / no module / no env mới. Map: plan.md §2–§6.

## T1 — Helper `assertCallbackToken` + 3 handler gọi (regression-guard)
- Thêm private `assertCallbackToken(faceConfig, incomingToken): void` trong `IotDevicesService`:
  1. `!callback_token_hash` → `ConflictException(CALLBACK_TOKEN_NOT_CONFIGURED)`.
  2. **MỚI** `faceConfig.revoked_at` → `ForbiddenException({code:'CALLBACK_TOKEN_REVOKED'})` (403).
  3. sha256 + Buffer-length + `timingSafeEqual` → sai → `UnauthorizedException(INVALID_CALLBACK_TOKEN)`.
- **Trước khi thay**: xác nhận lại 3 block ([:1101-1126],[:1254-1279],[:1532-1557]) cùng shape/mã (RECON: khớp). Khớp → thay cả 3 bằng `this.assertCallbackToken(faceConfig, callbackToken);`. Lệch chỗ nào → giữ inline chỗ đó, chỉ chèn revoked-gate, ghi chú code + cập nhật task này.
- KHÔNG đổi các bước khác trong handler (token-required, allowed_source_ip, store raw, business).
- **AC**: AC-003, AC-004, AC-005 (handler reject revoked / pass khi null).

## T2 — Revoke: service + persist + audit
- `revokeFaceServerToken(adminId, deviceId, dto)`:
  - load + validate face_server; chưa config → **409 `FACE_SERVER_NOT_CONFIGURED`**.
  - idempotent: `revoked_at` đã set → return 200, KHÔNG đổi `revoked_at`.
  - set `revoked_at = now ISO` (+ `revoked_reason` nếu có), `save(device)` (jsonb).
  - audit `face.token.revoke` (KHÔNG token/hash).
- **AC**: AC-001, AC-002, AC-006, AC-007.

## T3 — Rotate: service + persist + audit
- `rotateFaceServerToken(adminId, deviceId)`:
  - load + validate; chưa config → **409**.
  - sinh token mới (tái dùng token-gen configureFaceServer) → hash+last4 mới, `configured_at=now`, **clear `revoked_at`+`revoked_reason`**, giữ field config khác.
  - `save(device)`; audit `face.token.rotate`.
  - trả `{ device, oneTimeCallbackToken }` (plaintext 1 lần).
- **AC**: rotate token-mới + clear-revoked; token-cũ chết.

## T4 — DTO
- `src/modules/iot/dto/revoke-face-server-token.dto.ts`: `RevokeFaceServerTokenDto { reason?: string }` (`@IsOptional @IsString @MaxLength(...)`). Rotate: không cần body (hoặc DTO rỗng).

## T5 — Controller wiring
- iot-devices controller (cạnh `configureFaceServer`):
  - `POST :id/face-server/revoke` → `revokeFaceServerToken(currentUser.id, id, dto)`.
  - `POST :id/face-server/rotate` → `rotateFaceServerToken(currentUser.id, id)`.
- Guard admin (SEC-02) nhất quán endpoint configure hiện có; `@Permissions('iot_devices:configure_face_server')` (hoặc chốt `face.token.revoke`). Response format chuẩn `{success,message,data}`.
- **AC**: AC-008 (non-admin → 401/403).

## T6 — Tests ≥80% (`iot-devices.service.spec.ts`)
Helper/handler (mock device face_server + token hash):
- not-configured → 409; valid → pass; invalid → 401; **revoked (revoked_at set) → 403** (cho verify + stranger, ít nhất).
Revoke:
- revoke device đã config → `revoked_at` set, audit gọi; có `reason` → `revoked_reason` lưu.
- **idempotent**: revoke lần 2 → 200, `revoked_at` KHÔNG đổi.
- chưa-config → **409**.
Rotate:
- rotate → hash/last4 mới khác cũ, `revoked_at` cleared, trả `oneTimeCallbackToken`.
- **verify SAU revoke → 403**; **verify SAU rotate (token mới) → pass**; **token CŨ sau rotate → 401/403**.
Cross/SEC:
- response/audit/log KHÔNG chứa plaintext token/hash (AC-009).
- Branch ≥80% cho các nhánh mới.

## T7 — Gate (STOP, KHÔNG commit)
- `npm run build` = 0.
- eslint **per-file** (changed files) = 0 lỗi mới (KHÔNG `npm run lint`).
- `npx jest` iot service spec + regression `npx jest src/modules/face-access src/modules/iot src/modules/scheduler` xanh; branch ≥80%.
- **Live read-only** (xác nhận path jsonb trước khi tin UPDATE): `SELECT id, metadata_json->'face_server_config' FROM iot_devices WHERE device_type='face_server' LIMIT 1` → dán struct, xác nhận key `face_server_config` + chỗ chèn `revoked_at` đúng path. Script diag xoá sau dùng.
- Báo cáo: helper thay 3 hay giữ inline chỗ nào; revoke/rotate kết quả test; jsonb path live; coverage. **STOP — không commit, không migration.**

## Thứ tự
T4 → T1 → T2 → T3 → T5 → T6 → T7.
