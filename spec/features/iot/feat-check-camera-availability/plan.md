---
name: "Implementation Plan: Kiểm tra trạng thái khả dụng của camera"
description: "Kế hoạch triển khai IOT-005 / A5: nâng nhánh IP Camera sang runtime RTSP probe thuần Nest (ffprobe), util probe mới, env timeout riêng. Không đụng face_server/REC-005/IOT-014."
version: "2.0"
date: "2026-06-30"
author: "Antigravity"
---

# CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-01 | Khởi tạo plan.md dựa trên đặc tả của IOT-005 | Toàn bộ file |
| 2026-06-30 | **A5 (PLAN)**: kế hoạch nâng nhánh `ip_camera` của `checkAvailability` sang runtime RTSP probe qua util mới `rtsp-runtime-probe.util.ts` (spawn ffprobe, phân loại 7 nhóm §8.2). Thêm env `RTSP_RUNTIME_PROBE_TIMEOUT_MS` (Joi, default 10000). Wiring route controller còn thiếu. Giữ nguyên `face_server`/REC-005/`probeTcp` IOT-014. RECON code thật. | Toàn bộ file |
| 2026-06-30 | **Revise chốt OQ**: OQ-P1 → (a) **guard auth THẬT** (`JwtAuthGuard`+`PermissionsGuard`+`@RequirePermissions`) cho route mới, KHÔNG mirror mock; OQ-P2 → tra role-set thật của `iot_devices:*` ở **TASKS** rồi người duyệt. Ghi nợ MockPermissionsGuard toàn module iot. §12 hết câu mở. | §2.2, §7, §11, §12 |

> **PLAN-ONLY.** Bám [spec.md](./spec.md) đã khóa (v2.0, §12 hết câu mở). Chưa tasks/code. KHÔNG đổi API surface (giữ path), KHÔNG cột/enum/migration, KHÔNG async.

---

## 0. BƯỚC 0 — RECON code thật (đã đọc, không đoán)

### 0.1. `IotDevicesService.checkAvailability` ([iot-devices.service.ts:1110-1236](../../../../src/modules/iot/services/iot-devices.service.ts))
- Đã tồn tại. Load device → 404 `IOT_DEVICE_NOT_FOUND` → 409 `DEVICE_TYPE_NOT_CAMERA` nếu không ∈ {`FACE_SERVER`,`IP_CAMERA`}.
- **Nhánh `FACE_SERVER`** (1141-1169): heartbeat theo `lastSeenAt`, ngưỡng 5'. → **GIỮ NGUYÊN**.
- **Nhánh `IP_CAMERA`** (1170-1197): **chỉ config-readiness** — đủ `metadata_json.rtsp_config` + `stream_url` + `rtsp_enabled` → `is_available=true`, `runtime_verified=false`, message "…not performed in this version", `health=unknown`. → **A5 SỬA CHÍNH Ở ĐÂY**.
- **Persist đã có** (1200-1236): merge `metadata_json.last_availability_check` + `queryRunner` transaction `save(IoTDeviceEntity)`, không audit. → tái dùng.
- Đọc config qua `this.configService.get<number>('RTSP_PROBE_TIMEOUT_MS', 3000)` (1350) — pattern có sẵn để A5 đọc env mới.

### 0.2. ffprobe REC-005 ([recording/utils/ffprobe.util.ts](../../../../src/modules/recording/utils/ffprobe.util.ts))
- `probeMedia(filePath): Promise<MediaProbe|null>` — spawn `process.env.FFPROBE_PATH||'ffprobe'`, args `-v quiet -print_format json -show_format -show_streams`, `FFPROBE_TIMEOUT_MS=10000`, kill khi timeout, **mọi lỗi → resolve(null)** (KHÔNG ném, KHÔNG phân loại). → Đây là probe FILE, gộp lỗi → null, **không đủ cho A5** (A5 cần phân loại 7 nhóm trên RTSP). → **KHÔNG sửa REC-005**; util A5 viết riêng, mirror cách spawn/kill nhưng bắt `exit code`+`stderr`.

### 0.3. Tiện ích tái dùng (không sửa)
- `redactUrl(s: string): string` ([recording/utils/ffmpeg.util.ts:37](../../../../src/modules/recording/utils/ffmpeg.util.ts)) — `//user:pass@` → `//***@`. Tái dùng import (KHÔNG sửa).
- `decryptSecret(blob: string): string` ([common/utils/secret-crypto.util.ts:36](../../../../src/common/utils/secret-crypto.util.ts)) — giải mã AES-256-GCM (`RTSP_CRED_KEY`). Dùng để dựng URL có auth.

### 0.4. env.validation.ts ([config/env.validation.ts:152](../../../../src/config/env.validation.ts))
- Cơ chế **Joi schema**. IOT-014: `RTSP_PROBE_TIMEOUT_MS: Joi.number().integer().min(100).default(3000)` (mục K2). → A5 thêm `RTSP_RUNTIME_PROBE_TIMEOUT_MS: Joi.number().integer().min(100).default(10000)` cùng mục, đúng pattern.

### 0.5. Entity `iot_devices` ([iot/entities/iot-device.entity.ts](../../../../src/modules/iot/entities/iot-device.entity.ts))
- `streamUrl` (text, `rtsp://host:port/path` — **KHÔNG chứa pwd**), `metadataJson` (jsonb, `rtsp_config` chứa `rtsp_username`/`rtsp_password_encrypted`/`rtsp_enabled`), `roomId`, `lastSeenAt`.
- Enum thật: `IoTDeviceStatus`{`online`,`offline`,`disabled`,`maintenance`}, `IoTDeviceHealthStatus`{`healthy`,`warning`,`faulty`,`unknown`}, `IoTDeviceType`{`ip_camera`,`face_server`,…}. → đủ cho mapping §8.2, **không enum mới**.

### 0.6. ⚠ Wiring + RBAC — 2 phát hiện cần lưu ý
- **Route CHƯA wired**: `checkAvailability` (service) **không có route controller** nào gọi (grep toàn module: chỉ định nghĩa ở service). Endpoint `POST :id/check-availability` trong spec **chưa tồn tại thật** → A5 phải **wiring route mới** ở `iot-devices.controller.ts`.
- **RBAC mock**: controller iot dùng **stub no-op cục bộ** `MockPermissionsGuard` (`canActivate()=>true`) + `@Permissions` (decorator rỗng, KHÔNG SetMetadata) — comment "PermissionsGuard chưa implement". Thực tế auth module **đã có** `PermissionsGuard`+`RequirePermissions` thật (B21 dùng). → spec §4 yêu cầu guard thật ⇒ **xung đột spec-vs-code** → Open Question OQ-P1.
- **Permission seed**: `iot_devices:check_availability` **chưa seed** (không thấy trong seeds/ lẫn migrations/). → owed cho tasks (giống B21).

---

## 1. Tổng quan & cách tiếp cận
A5 nâng **nhánh `ip_camera`** của `checkAvailability` từ config-readiness → **runtime RTSP probe thuần Nest**. Ánh xạ spec → component:

| Spec | Component | Hành động |
|---|---|---|
| §6.2 probe + §8.2 taxonomy | **Util mới** `iot/utils/rtsp-runtime-probe.util.ts` | TẠO MỚI — spawn ffprobe + phân loại 7 nhóm |
| §6.2 luồng ip_camera | `IotDevicesService.checkAvailability` nhánh `IP_CAMERA` | SỬA — thay config-readiness bằng config-gate→probe→map |
| §8.1 timeout | `env.validation.ts` + service | THÊM env `RTSP_RUNTIME_PROBE_TIMEOUT_MS` + đọc qua configService |
| §7 endpoint | `iot-devices.controller.ts` | WIRING route `POST :id/check-availability` (đang thiếu) |
| §8.3 persist | persist hiện có | TÁI DÙNG (merge metadata + transaction) |

**Nguyên tắc không-hồi-quy**: KHÔNG đụng nhánh `face_server` (heartbeat v1.0), KHÔNG sửa `ffprobe.util.ts` (REC-005), KHÔNG sửa `probeTcp`/`detectOfflineDevices` (IOT-014), KHÔNG đổi `RTSP_PROBE_TIMEOUT_MS`.

## 2. Danh sách file đụng tới

### 2.1. Tạo mới
| Đường dẫn | Vai trò |
|---|---|
| `src/modules/iot/utils/rtsp-runtime-probe.util.ts` | Hàm thuần: nhận URL (đã dựng) + timeout → spawn ffprobe → phân loại 7 nhóm §8.2 → trả object kết quả. KHÔNG phụ thuộc Nest, KHÔNG bao giờ ném. |
| `src/modules/iot/utils/rtsp-runtime-probe.util.spec.ts` | Unit test 7 nhóm (mock `child_process.spawn`). |

### 2.2. Sửa (bounded — chỉ phần A5)
| Đường dẫn | Sửa gì | KHÔNG đụng |
|---|---|---|
| `iot/services/iot-devices.service.ts` | **Chỉ nhánh `IP_CAMERA`** trong `checkAvailability`: thay block config-readiness bằng config-gate→dựng URL→probe→map→persist. | Nhánh `FACE_SERVER`, `detectOfflineDevices`/`probeTcp` (IOT-014), persist helper khác |
| `iot/controllers/iot-devices.controller.ts` | Thêm route `POST :id/check-availability` gọi `checkAvailability` + **guard auth THẬT** (`@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('iot_devices:check_availability')`, import từ `../../auth/guards/jwt-auth.guard.js`, `../../auth/guards/permissions.guard.js`, `../../auth/decorators/require-permissions.decorator.js` — mirror B21) + `@CurrentUser` + `ParseUUIDPipe` + envelope `{success,message,data}`. | Các route khác (giữ Mock cũ — không migrate) |
| `config/env.validation.ts` | Thêm 1 dòng Joi `RTSP_RUNTIME_PROBE_TIMEOUT_MS` (default 10000). | `RTSP_PROBE_TIMEOUT_MS` (giữ 3000) |
| `iot/services/iot-devices.service.spec.ts` | Thêm test nhánh ip_camera A5 (mock util), giữ test cũ. | — |

> KHÔNG sửa: `recording/utils/ffprobe.util.ts`, `recording/utils/ffmpeg.util.ts` (chỉ import `redactUrl`), `common/utils/secret-crypto.util.ts`.

## 3. Thiết kế util probe mới (`rtsp-runtime-probe.util.ts`)
- **Input**: `(url: string, timeoutMs: number)` — `url` là RTSP URL ĐÃ dựng credential (service lo decrypt; util không chạm DB/secret store).
- **Output** (object thuần): `{ group, reasonCode, isAvailable, runtimeVerified, healthStatus, statusAction }` — `statusAction` ∈ {`set_online`,`set_offline`,`keep`} để service map sang `status` mà không hard-code trong util.
- **Cách làm** (mirror REC-005 spawn, KHÔNG tái dùng probeMedia vì nó nuốt lỗi):
  - spawn `process.env.FFPROBE_PATH||'ffprobe'` với args `-rtsp_transport tcp -v error -print_format json -show_streams <url>` (lấy stream để xác định "có video").
  - `setTimeout(timeoutMs)` → `kill()` → nhóm **Timeout** (`RTSP_PROBE_TIMEOUT`).
  - `on('error', ENOENT)` → nhóm **Tool unavailable** (`PROBE_TOOL_UNAVAILABLE`).
  - `on('close', code)`: phân loại **BEST-EFFORT** — ưu tiên `exit code`, dùng `stderr` (đã gom) làm phụ:
    - exit 0 + có video stream → **Alive**.
    - stderr khớp 401/403/Unauthorized → **Auth fail** (`RTSP_AUTH_FAILED`).
    - stderr khớp refused/no route/Name or service not known → **Unreachable** (`RTSP_UNREACHABLE`).
    - stderr khớp Invalid data/404/không có video stream → **Not a stream** (`RTSP_INVALID_STREAM`).
    - còn lại → **Default** (`RTSP_PROBE_FAILED`).
  - Bọc try/catch + cờ `settled`: **KHÔNG bao giờ ném/không reject** (mọi nhánh resolve một group).
- **Bảo mật trong util**: nếu util tự log (debug), phải `redactUrl(url)`; KHÔNG trả `stderr` thô ra ngoài (service chỉ lấy `group`/`reasonCode`). Mapping group→`message` cố định đặt ở service hoặc 1 hằng map (không nhúng stderr).

## 4. Luồng service nhánh `ip_camera` (thiết kế, KHÔNG code)
1. **Config-gate** (giữ pre-check v1.0): thiếu `room_id`→`DEVICE_ROOM_ASSIGNMENT_REQUIRED`; thiếu `rtsp_config`/`stream_url`→`RTSP_CONFIG_MISSING`; `rtsp_enabled=false`→`RTSP_DISABLED`. (health=warning, runtime_verified=false, KHÔNG probe, KHÔNG set online).
2. **Dựng URL có credential (in-memory)**: từ `streamUrl` + `rtsp_config.rtsp_username` + `decryptSecret(rtsp_config.rtsp_password_encrypted)` (nếu có) → `rtsp://user:pass@host:port/path`. Biến cục bộ, KHÔNG ghi DB/log; log (nếu có) qua `redactUrl`.
3. **Đọc timeout**: `configService.get<number>('RTSP_RUNTIME_PROBE_TIMEOUT_MS', 10000)`.
4. **Probe**: gọi util §3 → nhận `{group, reasonCode, isAvailable, runtimeVerified, healthStatus, statusAction}`.
5. **Map taxonomy → entity** (§8.2): set `is_available`/`reason_code`/`health_status`; `status`: `set_online` (Alive) / `set_offline` (Unreachable, Timeout) / `keep` (Auth fail, Not-a-stream, Tool-unavailable, Default). `check_type='rtsp_runtime_probe'`. `message` = chuỗi cố định theo `reason_code`.
6. **Persist** (tái dùng): merge `metadata_json.last_availability_check` (`checked_by=userId`) + cập nhật `status`/`health_status`, transaction. KHÔNG audit (§10).

## 5. Env var
- Thêm vào `env.validation.ts` (mục K2, cạnh IOT-014): `RTSP_RUNTIME_PROBE_TIMEOUT_MS: Joi.number().integer().min(100).default(10000)`.
- Service đọc qua `configService.get<number>('RTSP_RUNTIME_PROBE_TIMEOUT_MS', 10000)`.
- KHÔNG đụng `RTSP_PROBE_TIMEOUT_MS` (3000, IOT-014). (Khuyến nghị tasks: thêm dòng tương ứng vào `.env.example` nếu repo có.)

## 6. Persist & mapping
- **Merge an toàn**: đọc `device.metadataJson || {}` → spread + ghi đè đúng khóa `last_availability_check` (giữ `rtsp_config`/`face_server_config`/`vendor`/`connection`…). Pattern y hệt persist hiện có (1200-1213).
- **Mapping status/health**: theo bảng §8.2 (đã liệt ở §4.5 trên). Chỉ dùng enum sẵn có.

## 7. RBAC & permission
- **Guard (chốt OQ-P1 = a)**: route mới dùng **guard auth THẬT** `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('iot_devices:check_availability')` (import từ auth module — mirror B21). **KHÔNG** dùng `MockPermissionsGuard`/`@Permissions` rỗng cục bộ. Chấp nhận controller iot **tạm trộn** (route mới guard thật, route cũ còn mock) — chủ ý; migrate cả module = nợ riêng (§11).
- Permission string `iot_devices:check_availability` (spec §4; đồng nhất kiểu colon với `iot_devices:assign_room`/`iot_devices:configure_rtsp`).
- **Seed permission (chốt OQ-P2 = tra ở tasks, người duyệt)**: `iot_devices:check_availability` **chưa seed**. Ở **pha TASKS**, agent phải **RECON role-set thật** mà các permission `iot_devices:*` hiện đang gán (đặc biệt `iot_devices:assign_room`, `iot_devices:configure_rtsp` — tìm trong seeds/migrations) → **mirror đúng role-set vận hành IoT đó** cho `check_availability`, rồi **báo lại danh sách để người duyệt TRƯỚC khi seed** (KHÔNG tự quyết — mô hình giống B21 tra `EMPLOYEE` từ seed thật). Owed: tạo seed/migration ở tasks (giống B21).

## 8. Bảo mật (spec §8.4)
- `decryptSecret` chỉ để dựng URL probe; URL credential **không** log/trả/lưu.
- Mọi log có thể chứa URL → `redactUrl` trước.
- `message` client = chuỗi cố định theo `reason_code`, KHÔNG nhúng `stderr`.
- Response không trả `rtsp_password*`/`callback_token*`/secret trong metadata; không trả `checked_by`. (Tái dùng mapper masked hiện có của module nếu đã có; nếu chưa mask đủ → tasks bổ sung filter.)

## 9. Chiến lược test (kế hoạch — KHÔNG viết test ở pha này)
- **Unit util** (mock `child_process.spawn`, KHÔNG cần camera thật): 7 nhóm → AC-9..13, AC-17, AC-18.
  - exit 0 + có video → Alive (AC-9); stderr 401 → Auth fail (AC-12); refused → Unreachable (AC-10); timeout kill → Timeout (AC-11); Invalid data/no-video → Not-a-stream (AC-13); ENOENT → Tool-unavailable (AC-17); không khớp → Default (AC-18).
- **Service nhánh ip_camera** (mock util): config-gate (AC-6,7,8), alive→status online (AC-9), giữ status các nhóm warning, persist merge (AC-15), không enum/cột mới (AC-16).
- **Không hồi quy `face_server`**: giữ test heartbeat AC-3,4,5; 404/409 AC-1,2.
- **Bảo mật** (AC-14): assert URL/credential không xuất hiện trong log/response/message (redact).

## 10. Thứ tự thực hiện đề xuất (chi tiết ở tasks)
1. Util `rtsp-runtime-probe.util.ts` (+ unit test 7 nhóm).
2. Env var `RTSP_RUNTIME_PROBE_TIMEOUT_MS` (Joi).
3. Service nhánh `ip_camera` (+ test) — config-gate→URL→probe→map→persist.
4. Wiring route controller `POST :id/check-availability` (+ guard/permission theo OQ-P1).
5. (owed) Seed permission `iot_devices:check_availability` (tasks, cần duyệt role).
6. Cổng chất lượng (tsc/eslint/jest, không hồi quy face_server/REC-005/IOT-014).

## 11. Rủi ro & lưu ý
- **Brittle stderr**: text ffprobe đổi theo version → đã có **catch-all `RTSP_PROBE_FAILED`** + ưu tiên exit code (best-effort), không đoán bừa thành alive.
- **Không phá** `face_server`/REC-005/`probeTcp` IOT-014 (đều dùng chung file/service) → sửa bounded, test hồi quy.
- **ffprobe thiếu binary** → nhóm `PROBE_TOOL_UNAVAILABLE`, 200, không 500.
- **Transaction persist**: rollback nếu save lỗi (đã có sẵn).
- **Route chưa wired**: A5 thêm route mới (đã chốt) — không phải rủi ro, chỉ là phạm vi.
- **Nợ tồn đọng — MockPermissionsGuard toàn module iot**: toàn bộ controller iot hiện dùng `MockPermissionsGuard` (`canActivate()=>true`) + `@Permissions` rỗng (không SetMetadata) → **RBAC chưa thực thi cho các route iot khác** (chỉ JWT). A5 đi **guard thật** cho route mới `check-availability`; **migrate cả module iot sang guard thật = nợ riêng, NGOÀI A5** (người dùng xử sau). Hệ quả: trong thời gian quá độ, 1 controller iot trộn guard thật (route mới) + mock (route cũ) — chủ ý, chấp nhận được.

## 12. Open Questions — Cần người chốt
**Không còn câu hỏi mở.** OQ-P1 chốt **(a) guard auth thật** (§7, §2.2); OQ-P2 chốt **tra role-set thật ở TASKS rồi người duyệt** trước khi seed (§7). Nợ migrate MockPermissionsGuard toàn module = ngoài A5 (§11).
